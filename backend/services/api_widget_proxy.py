"""API widget proxy service (Phase 3).

Centralized backend proxy for all third-party API widget data.
Responsibilities:
  • Credential injection from OS env (frontend NEVER sees keys).
  • Two-tier cache: in-memory L1 (per-process) + Mongo L2 (persistent).
  • Rate limiting: provider-wide quota (per hour) + per-widget burst (per minute).
  • Response mapping via dotted-path accessors.
  • Loading/error normalization so widgets always get a consistent shape.

Cache key  = sha1(provider:endpoint:params_json) — instances sharing
the same config share the cache regardless of which widget called.

Rate-limit buckets use Mongo's `api_quota` collection with TTL'd
docs so old counters self-expire (no cron required).
"""
from __future__ import annotations
import asyncio
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import HTTPException

from core.db import db
from core.api_providers import get_provider, get_endpoint, has_credential
from utils.value_formatters import apply_formatters_dict
from utils.sliding_window_rate_limit import rate_limit as sliding_rate_limit

logger = logging.getLogger("ourrealm.api_proxy")

# In-memory L1 cache. Cleared on process restart — that's intentional;
# the Mongo L2 layer rehydrates on first miss.
_L1_CACHE: Dict[str, Tuple[float, Any]] = {}  # key -> (expires_at_epoch, body)
_L1_LOCK = asyncio.Lock()

# Per-widget burst limit (sliding window inside one minute).
PER_WIDGET_BURST_PER_MIN = 30
PROVIDER_BURST_PER_MIN = 60

MAX_RESPONSE_BYTES = 1_000_000  # Soft cap — don't bloat Mongo with massive payloads.
HTTP_TIMEOUT_SECONDS = 12.0


# ─────────────────────────────────────────────────────────────────────
# Dotted-path response mapping (mirrors the frontend helper)
# ─────────────────────────────────────────────────────────────────────

_PATH_SPLIT = re.compile(r"\.|\[(\d+)\]")


def get_path(obj: Any, path: str) -> Any:
    """Resolve a dotted/bracketed path against a JSON-ish object.
    Supports `a.b[0].c`, `a.b.0.c`, and segment names with spaces or
    dots-as-keys (the latter via the rare case where the segment
    itself contains a dot — we fall back to the literal key on miss).
    Returns None if any segment misses."""
    if not path or obj is None:
        return obj
    # First try the literal key path (handles weird Alpha Vantage keys
    # like "Global Quote.05. price" where dots are part of the name).
    if isinstance(obj, dict) and path in obj:
        return obj[path]
    # Normalize: replace [n] with .n
    norm = re.sub(r"\[(\d+)\]", r".\1", path).strip(".")
    parts = [p for p in norm.split(".") if p != ""]
    cur = obj
    for i, key in enumerate(parts):
        if cur is None:
            return None
        if isinstance(cur, list):
            try:
                cur = cur[int(key)]
            except (ValueError, IndexError):
                return None
        elif isinstance(cur, dict):
            if key in cur:
                cur = cur[key]
            else:
                # Try joining the rest of the parts in case the key
                # itself contains dots (Alpha Vantage).
                rest = ".".join(parts[i:])
                if rest in cur:
                    return cur[rest]
                return None
        else:
            return None
    return cur


# ─────────────────────────────────────────────────────────────────────
# Cache layer
# ─────────────────────────────────────────────────────────────────────

def _make_cache_key(provider_key: str, endpoint_key: str, params: Dict[str, Any]) -> str:
    raw = json.dumps({"p": provider_key, "e": endpoint_key, "params": params or {}},
                     sort_keys=True, default=str)
    return hashlib.sha1(raw.encode()).hexdigest()


async def _cache_get(key: str) -> Optional[Dict[str, Any]]:
    now = time.time()
    async with _L1_LOCK:
        hit = _L1_CACHE.get(key)
        if hit and hit[0] > now:
            return {"data": hit[1], "tier": "L1"}
        if hit:
            _L1_CACHE.pop(key, None)
    # L2 — Mongo
    doc = await db.api_cache.find_one({"_id": key})
    if not doc:
        return None
    expires_at = doc.get("expires_at_epoch") or 0
    if expires_at <= now:
        return None
    # Re-hydrate L1.
    async with _L1_LOCK:
        _L1_CACHE[key] = (expires_at, doc["data"])
    return {"data": doc["data"], "tier": "L2"}


async def _cache_put(key: str, data: Any, ttl_seconds: int,
                     provider_key: str, endpoint_key: str) -> None:
    ttl = max(1, int(ttl_seconds or 60))
    expires_at = time.time() + ttl
    async with _L1_LOCK:
        _L1_CACHE[key] = (expires_at, data)
    payload_size = len(json.dumps(data, default=str))
    if payload_size > MAX_RESPONSE_BYTES:
        logger.warning("api_proxy: skipping L2 cache (payload %d > %d) for %s:%s",
                       payload_size, MAX_RESPONSE_BYTES, provider_key, endpoint_key)
        return
    await db.api_cache.update_one(
        {"_id": key},
        {"$set": {
            "_id": key,
            "data": data,
            "provider": provider_key,
            "endpoint": endpoint_key,
            "expires_at_epoch": expires_at,
            "expires_at": datetime.fromtimestamp(expires_at, tz=timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )


# ─────────────────────────────────────────────────────────────────────
# Rate limiting
# ─────────────────────────────────────────────────────────────────────

async def _check_rate(provider_key: str, widget_id: Optional[str],
                      provider_quota_per_hour: int) -> Dict[str, Any]:
    """Raises HTTPException(429) if any bucket is exhausted.

    Sliding-window for per-minute caps (Phase 3.2) — no more
    minute-boundary exploit. Fixed-hour Mongo bucket retained for
    the cheap-to-evaluate hourly provider quota.

    Returns the most-constrained `remaining`/`reset_in` for the
    caller to emit X-RateLimit-* headers.
    """
    now = datetime.now(timezone.utc)
    hour_bucket = now.strftime("%Y%m%d%H")
    headers_meta = {"limit": None, "remaining": None, "reset_in": None}

    # 1) Provider hourly quota — fixed-window Mongo bucket (cheap, OK).
    prov_key_h = f"prov:{provider_key}:h:{hour_bucket}"
    h = await db.api_quota.find_one_and_update(
        {"_id": prov_key_h},
        {
            "$inc": {"count": 1},
            "$setOnInsert": {
                "scope": "provider", "provider": provider_key,
                "bucket": "hour", "expires_at": _ttl(now, 3600),
            },
        },
        upsert=True,
        return_document=True,
    )
    if h and (h.get("count") or 0) > provider_quota_per_hour:
        raise HTTPException(status_code=429, detail=f"Provider quota exceeded for {provider_key} ({provider_quota_per_hour}/hour)")

    # 2) Provider per-minute burst — sliding window.
    prov_res = await sliding_rate_limit(
        f"prov:{provider_key}:burst",
        max_requests=PROVIDER_BURST_PER_MIN,
        window_seconds=60,
        event_meta={"scope": "provider", "provider": provider_key, "endpoint": "burst"},
    )
    if not prov_res["allowed"]:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "scope": "provider_burst",
                "retry_after": prov_res["retry_after"],
                "message": f"Provider burst limit ({PROVIDER_BURST_PER_MIN}/min) on {provider_key}",
            },
            headers={"Retry-After": str(prov_res["retry_after"])},
        )
    headers_meta = {"limit": prov_res["limit"], "remaining": prov_res["remaining"], "reset_in": prov_res["reset_in"]}

    # 3) Per-widget burst — sliding window.
    if widget_id:
        wres = await sliding_rate_limit(
            f"widget:{widget_id}:burst",
            max_requests=PER_WIDGET_BURST_PER_MIN,
            window_seconds=60,
            event_meta={"scope": "widget", "widget_id": widget_id},
        )
        if not wres["allowed"]:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limit_exceeded",
                    "scope": "widget_burst",
                    "retry_after": wres["retry_after"],
                    "message": f"Widget burst limit ({PER_WIDGET_BURST_PER_MIN}/min)",
                },
                headers={"Retry-After": str(wres["retry_after"])},
            )
        # Tighter of the two surfaces what the caller can actually do.
        if wres["remaining"] < (headers_meta["remaining"] or 0):
            headers_meta = {"limit": wres["limit"], "remaining": wres["remaining"], "reset_in": wres["reset_in"]}
    return headers_meta


def _ttl(now: datetime, seconds: int) -> datetime:
    from datetime import timedelta
    return now + timedelta(seconds=seconds)


async def ensure_indexes() -> None:
    # TTL index — Mongo deletes docs whose `expires_at` has passed.
    await db.api_cache.create_index("expires_at", expireAfterSeconds=0)
    await db.api_quota.create_index("expires_at", expireAfterSeconds=0)


# ─────────────────────────────────────────────────────────────────────
# Request execution
# ─────────────────────────────────────────────────────────────────────

def _resolve_url_and_request(provider: Dict[str, Any], endpoint: Dict[str, Any],
                             params: Dict[str, Any]) -> Tuple[str, Dict[str, Any], Dict[str, Any], Optional[Dict[str, Any]], Dict[str, str]]:
    """Resolve provider+endpoint+params into (url, query, headers, body, debug).
    Auth credential is injected here from env."""
    base_url = (endpoint.get("base_url") or provider.get("base_url") or "").rstrip("/")
    path = endpoint.get("path") or ""
    query: Dict[str, Any] = {}
    body: Optional[Dict[str, Any]] = None
    # Reddit's CDN rejects non-browser UAs with 403; use a desktop-ish UA
    # for public endpoints that don't require auth.
    ua = provider.get("user_agent") or "OurRealm-Widget-Proxy/1.0"
    headers: Dict[str, str] = {"Accept": "application/json", "User-Agent": ua}
    debug: Dict[str, Any] = {"missing": []}

    # Distribute params into path/query/body/header.
    safe_params = dict(params or {})
    for spec in endpoint.get("params", []):
        name = spec["name"]
        loc = spec.get("location") or "query"
        val = safe_params.pop(name, spec.get("default"))
        if val in (None, "") and spec.get("required"):
            debug["missing"].append(name)
            continue
        if val in (None, ""):
            continue
        if loc == "path":
            path = path.replace("{" + name + "}", str(val))
        elif loc == "query":
            query[name] = val
        elif loc == "body":
            body = body or {}
            body[name] = val
        elif loc == "header":
            headers[name] = str(val)
    # Any remaining unknown params → query (forward as-is).
    for k, v in safe_params.items():
        query[k] = v

    # Provider auth injection.
    auth_kind = provider.get("auth_kind") or "none"
    if auth_kind == "api_key":
        env_var = provider.get("auth_env_var")
        token = os.environ.get(env_var) if env_var else None
        if provider["key"] == "nasa" and not token:
            token = "DEMO_KEY"  # NASA's public demo key works for low volume.
        if not token:
            debug["missing"].append(f"env:{env_var}")
        else:
            loc = provider.get("auth_param_location") or "query"
            name = provider.get("auth_param_name") or "key"
            if loc == "query":
                query[name] = token
            elif loc == "header":
                prefix = provider.get("auth_param_prefix") or ""
                headers[name] = f"{prefix}{token}"
    elif auth_kind == "bearer":
        env_var = provider.get("auth_env_var")
        token = os.environ.get(env_var) if env_var else None
        if not token:
            debug["missing"].append(f"env:{env_var}")
        else:
            headers["Authorization"] = f"Bearer {token}"
    elif auth_kind == "oauth":
        debug["missing"].append("oauth_not_implemented")

    # OpenAI special handling: collapse "prompt" param into chat messages.
    if provider["key"] == "openai" and endpoint["key"] == "chat" and body:
        prompt = body.pop("prompt", "")
        body["messages"] = [{"role": "user", "content": prompt}]

    url = f"{base_url}{path}"
    return url, query, headers, body, debug


async def _execute(url: str, method: str, query: Dict[str, Any],
                   headers: Dict[str, str], body: Optional[Dict[str, Any]]) -> Any:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        resp = await client.request(method, url, params=query, headers=headers, json=body if body else None)
    if resp.status_code >= 400:
        snippet = resp.text[:300]
        # Forward 429 (and other rate-limit-shaped codes) verbatim so
        # downstream callers can apply correct backoff. Other 4xx/5xx
        # upstream errors collapse to 502 so we don't leak provider
        # implementation details (e.g., "API key invalid" 401).
        if resp.status_code in (429, 503, 504):
            raise HTTPException(status_code=resp.status_code, detail=f"Upstream {resp.status_code}: {snippet}")
        raise HTTPException(status_code=502, detail=f"Upstream {resp.status_code}: {snippet}")
    try:
        return resp.json()
    except Exception:  # noqa: BLE001
        return {"raw": resp.text[:5000]}


# ─────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────

async def call_api(
    provider_key: str,
    endpoint_key: str,
    params: Dict[str, Any],
    *,
    widget_id: Optional[str] = None,
    cache_seconds: Optional[int] = None,
    bypass_cache: bool = False,
    response_map: Optional[Dict[str, str]] = None,
    array_bindings: Optional[List[Dict[str, Any]]] = None,
    formatters: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Returns {data, mapped, mapped_formatted, mapped_arrays, mapped_arrays_formatted,
    cached, tier, debug, rate_limit}.

    Phase 3.2 additions:
      • formatters — per-field formatter cfg; results land in mapped_formatted.
      • Array bindings can carry their own `item_formatters` dict; we apply
        it per-item and emit mapped_arrays_formatted[field_key] as a list of
        {field_key: {raw, formatted, color}, ...} item dicts.
      • Returns rate_limit headers metadata (limit/remaining/reset_in)
        so the route can attach X-RateLimit-* headers.
    """
    provider = get_provider(provider_key)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Unknown provider '{provider_key}'")
    endpoint = get_endpoint(provider_key, endpoint_key)
    if not endpoint:
        raise HTTPException(status_code=404, detail=f"Unknown endpoint '{endpoint_key}' on provider '{provider_key}'")
    if provider.get("coming_soon"):
        raise HTTPException(status_code=400, detail=f"Provider '{provider_key}' is not yet enabled (OAuth pending)")
    if not has_credential(provider):
        raise HTTPException(status_code=503, detail=f"Provider '{provider_key}' credential not configured on server")

    norm_params = params or {}
    ckey = _make_cache_key(provider_key, endpoint_key, norm_params)

    # Cache fast-path.
    cached = None if bypass_cache else await _cache_get(ckey)
    if cached:
        data = cached["data"]
        mapped = _apply_map(data, response_map)
        mapped_arrays = _apply_array_bindings(data, array_bindings)
        return {
            "data": data,
            "mapped": mapped,
            "mapped_formatted": apply_formatters_dict(mapped, formatters),
            "mapped_arrays": mapped_arrays,
            "mapped_arrays_formatted": _format_arrays(mapped_arrays, array_bindings),
            "cached": True,
            "cache_tier": cached["tier"],
            "debug": {"cache_key": ckey},
            "rate_limit": None,
        }

    # Rate limit BEFORE making the upstream call.
    rl_meta = await _check_rate(provider_key, widget_id, provider.get("provider_quota_per_hour") or 1000)

    url, query, headers, body, debug = _resolve_url_and_request(provider, endpoint, norm_params)
    if debug.get("missing"):
        raise HTTPException(status_code=400, detail=f"Missing required params: {', '.join(debug['missing'])}")

    method = endpoint.get("method") or "GET"
    data = await _execute(url, method, query, headers, body)

    ttl = cache_seconds if (cache_seconds is not None) else provider.get("default_cache_seconds", 300)
    await _cache_put(ckey, data, ttl, provider_key, endpoint_key)

    mapped = _apply_map(data, response_map)
    mapped_arrays = _apply_array_bindings(data, array_bindings)

    return {
        "data": data,
        "mapped": mapped,
        "mapped_formatted": apply_formatters_dict(mapped, formatters),
        "mapped_arrays": mapped_arrays,
        "mapped_arrays_formatted": _format_arrays(mapped_arrays, array_bindings),
        "cached": False,
        "cache_tier": "MISS",
        "debug": {"cache_key": ckey, "url": url, "method": method},
        "rate_limit": rl_meta,
    }


def _format_arrays(arrays: Dict[str, Any], bindings: Optional[List[Dict[str, Any]]]) -> Dict[str, List[Dict[str, Any]]]:
    """Apply per-item formatters declared on each array_binding.
    Returns {field_key: [{item_field: {raw, formatted, color}, ...}, ...]}.
    Items lacking formatters are NOT included to keep payload size small."""
    out: Dict[str, List[Dict[str, Any]]] = {}
    if not bindings:
        return out
    for b in bindings:
        if not isinstance(b, dict):
            continue
        fk = b.get("field_key")
        item_formatters = b.get("item_formatters") or {}
        if not fk or not item_formatters:
            continue
        items = arrays.get(fk)
        if not isinstance(items, list):
            continue
        out_items: List[Dict[str, Any]] = []
        for it in items:
            if not isinstance(it, dict):
                out_items.append({})
                continue
            formatted_row = apply_formatters_dict(it, item_formatters)
            out_items.append(formatted_row)
        out[fk] = out_items
    return out


def _apply_map(data: Any, response_map: Optional[Dict[str, str]]) -> Dict[str, Any]:
    if not response_map or not isinstance(response_map, dict):
        return {}
    out: Dict[str, Any] = {}
    for k, path in response_map.items():
        if isinstance(path, str):
            out[k] = get_path(data, path)
    return out


def _apply_array_bindings(data: Any, bindings: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
    """Phase 3.1 — map JSON arrays onto repeated-item widget fields.

    Each binding declares:
      • field_key  — which field on the widget (e.g. 'items', 'media')
      • array_path — dotted path to the source array
      • item_map   — {item_field: relative_path} per-item mapping
      • max_items  — cap (default 20)
      • empty_text — surfaced via the renderer when array is empty

    If item_map has the single key '_', items are emitted as scalars
    (used for media_grid where each item is just a URL string).
    Otherwise each item becomes a dict shaped for rich_item rendering.
    """
    out: Dict[str, Any] = {}
    if not bindings or not isinstance(bindings, list):
        return out
    for b in bindings:
        if not isinstance(b, dict):
            continue
        field_key = b.get("field_key")
        if not field_key:
            continue
        arr = get_path(data, b.get("array_path") or "")
        if not isinstance(arr, list):
            out[field_key] = []
            continue
        max_items = int(b.get("max_items") or 20)
        max_items = max(1, min(max_items, 100))
        item_map = b.get("item_map") or {}
        if not isinstance(item_map, dict):
            out[field_key] = []
            continue
        items: List[Any] = []
        scalar_mode = (len(item_map) == 1 and "_" in item_map)
        for idx, raw in enumerate(arr[:max_items]):
            if scalar_mode:
                items.append(get_path(raw, item_map["_"]))
                continue
            obj: Dict[str, Any] = {}
            for k, p in item_map.items():
                if isinstance(p, str):
                    obj[k] = get_path(raw, p)
            obj.setdefault("id", f"itm_{idx}")
            items.append(obj)
        out[field_key] = items
    return out


__all__ = ["call_api", "ensure_indexes", "get_path"]