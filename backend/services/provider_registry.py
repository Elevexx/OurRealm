"""Provider registry service (Phase 3.4).

Adds the OPERATIONAL layer on top of the static provider catalog
(`core/api_providers.py`):

  • Per-provider `enabled` flag persisted in Mongo (`provider_settings`).
    `configured` (env-key present) and `enabled` (admin toggle) are
    independent — a provider is USABLE only when BOTH are true and
    `coming_soon` is false.
  • Lightweight health probes that hit a cheap endpoint per provider
    and cache the result for 5 minutes in `provider_health`. Status
    is one of `healthy | error | unconfigured | disabled | coming_soon`.
  • Provider analytics: `provider_calls`, `provider_errors`,
    `provider_latency` counters incremented from the proxy, queried
    by `/api/admin/analytics/providers`.

Adding a new provider's health probe = appending one entry to
HEALTH_PROBES. Anything not declared there returns `healthy` when
configured + enabled (best-effort guess).
"""
from __future__ import annotations
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from core.db import db
from core.api_providers import PROVIDERS, get_provider, has_credential

logger = logging.getLogger("ourrealm.provider_registry")

HEALTH_TTL_SECONDS = 300  # 5 minutes — matches spec.

# Per-provider lightweight health probe. Maps provider key →
# (endpoint_key, params). The proxy is called with bypass_cache=True
# so we get a real signal (and the result gets cached separately by
# our health-cache layer below).
HEALTH_PROBES: Dict[str, Dict[str, Any]] = {
    "openai":       {"endpoint": "chat",          "params": {"model": "gpt-4o-mini", "prompt": "ping", "max_tokens": 1}},
    "newsapi":      {"endpoint": "top_headlines", "params": {"country": "us", "pageSize": 1}},
    "openweather":  {"endpoint": "current",       "params": {"q": "London,uk", "units": "metric"}},
    "alphavantage": {"endpoint": "global_quote",  "params": {"function": "GLOBAL_QUOTE", "symbol": "AAPL"}},
    "coingecko":    {"endpoint": "simple_price",  "params": {"ids": "bitcoin", "vs_currencies": "usd"}},
    "nasa":         {"endpoint": "apod",          "params": {}},
    "github":       {"endpoint": "user",          "params": {"username": "torvalds"}},
    "reddit":       {"endpoint": "subreddit_top", "params": {"subreddit": "programming", "limit": 1, "t": "day"}},
}


# ─────────────────────────────────────────────────────────────────────
# Enabled toggle
# ─────────────────────────────────────────────────────────────────────

async def is_enabled(provider_key: str) -> bool:
    """Default: enabled=True for providers that aren't coming_soon.
    Admin can toggle this off without touching env vars."""
    doc = await db.provider_settings.find_one({"_id": provider_key})
    if doc is None:
        provider = get_provider(provider_key)
        return bool(provider) and not provider.get("coming_soon")
    return bool(doc.get("enabled", True))


async def set_enabled(provider_key: str, enabled: bool, actor: Optional[str] = None) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    await db.provider_settings.update_one(
        {"_id": provider_key},
        {"$set": {
            "_id": provider_key, "enabled": bool(enabled),
            "updated_at": now, "updated_by": actor,
        }},
        upsert=True,
    )
    # Invalidate cached health row — toggling can change the effective state.
    await db.provider_health.delete_one({"_id": provider_key})
    return {"id": provider_key, "enabled": bool(enabled), "updated_at": now.isoformat()}


async def all_enabled_map() -> Dict[str, bool]:
    out: Dict[str, bool] = {}
    cursor = db.provider_settings.find({}, {"_id": 1, "enabled": 1})
    async for d in cursor:
        out[d["_id"]] = bool(d.get("enabled", True))
    return out


# ─────────────────────────────────────────────────────────────────────
# Health probe
# ─────────────────────────────────────────────────────────────────────

async def get_health(provider_key: str, *, force: bool = False) -> Dict[str, Any]:
    provider = get_provider(provider_key)
    if not provider:
        return {"id": provider_key, "status": "unknown", "healthy": False, "last_checked": None}

    if provider.get("coming_soon"):
        return {"id": provider_key, "status": "coming_soon", "healthy": False, "last_checked": None}
    if not has_credential(provider):
        return {"id": provider_key, "status": "unconfigured", "healthy": False, "last_checked": None}
    if not await is_enabled(provider_key):
        return {"id": provider_key, "status": "disabled", "healthy": False, "last_checked": None}

    now = time.time()
    if not force:
        cached = await db.provider_health.find_one({"_id": provider_key})
        if cached and cached.get("expires_at_epoch", 0) > now:
            return {
                "id": provider_key,
                "status": cached.get("status", "unknown"),
                "healthy": cached.get("healthy", False),
                "latency_ms": cached.get("latency_ms"),
                "error": cached.get("error"),
                "last_checked": cached.get("checked_at"),
                "cached": True,
            }

    probe = HEALTH_PROBES.get(provider_key)
    if not probe:
        # No probe registered — best-effort assume healthy when configured + enabled.
        await _store_health(provider_key, status="healthy", healthy=True, latency_ms=None, error=None)
        return {"id": provider_key, "status": "healthy", "healthy": True, "latency_ms": None, "error": None, "last_checked": datetime.now(timezone.utc).isoformat()}

    from services.api_widget_proxy import call_api  # Avoid circular import on module load.
    started = time.monotonic()
    try:
        await call_api(
            provider_key, probe["endpoint"], probe["params"],
            widget_id=None, cache_seconds=0, bypass_cache=True,
        )
        latency = int((time.monotonic() - started) * 1000)
        await _store_health(provider_key, status="healthy", healthy=True, latency_ms=latency, error=None)
        await _bump_metric(provider_key, "calls", latency)
        return {"id": provider_key, "status": "healthy", "healthy": True, "latency_ms": latency, "error": None, "last_checked": datetime.now(timezone.utc).isoformat()}
    except Exception as e:  # noqa: BLE001
        latency = int((time.monotonic() - started) * 1000)
        msg = getattr(e, "detail", str(e))
        if isinstance(msg, dict):
            msg = msg.get("message") or msg.get("error") or str(msg)
        await _store_health(provider_key, status="error", healthy=False, latency_ms=latency, error=str(msg)[:300])
        await _bump_metric(provider_key, "errors", latency)
        return {"id": provider_key, "status": "error", "healthy": False, "latency_ms": latency, "error": str(msg)[:300], "last_checked": datetime.now(timezone.utc).isoformat()}


async def _store_health(provider_key: str, *, status: str, healthy: bool,
                        latency_ms: Optional[int], error: Optional[str]) -> None:
    now = datetime.now(timezone.utc)
    expires_at = time.time() + HEALTH_TTL_SECONDS
    await db.provider_health.update_one(
        {"_id": provider_key},
        {"$set": {
            "_id": provider_key,
            "status": status, "healthy": healthy,
            "latency_ms": latency_ms, "error": error,
            "checked_at": now.isoformat(),
            "expires_at_epoch": expires_at,
        }},
        upsert=True,
    )


# ─────────────────────────────────────────────────────────────────────
# Analytics (provider_calls, provider_errors, provider_latency)
# ─────────────────────────────────────────────────────────────────────

async def _bump_metric(provider_key: str, kind: str, latency_ms: Optional[int]) -> None:
    """Bump per-provider running counters. Used by health probe and
    can be wired into the proxy call_api for production traffic."""
    now = datetime.now(timezone.utc)
    update = {"$inc": {f"{kind}_count": 1}, "$set": {"updated_at": now}}
    if latency_ms is not None:
        update["$inc"]["latency_ms_total"] = int(latency_ms)
        update["$inc"]["latency_samples"] = 1
    try:
        await db.provider_metrics.update_one({"_id": provider_key}, update, upsert=True)
    except Exception:  # noqa: BLE001
        pass


async def analytics_snapshot() -> Dict[str, Any]:
    cursor = db.provider_metrics.find({})
    rows = []
    async for d in cursor:
        latency_avg = None
        if d.get("latency_samples"):
            latency_avg = round((d.get("latency_ms_total") or 0) / d["latency_samples"], 1)
        rows.append({
            "id": d["_id"],
            "calls": d.get("calls_count", 0),
            "errors": d.get("errors_count", 0),
            "avg_latency_ms": latency_avg,
            "updated_at": d.get("updated_at").isoformat() if d.get("updated_at") else None,
        })
    rows.sort(key=lambda x: -x["calls"])
    return {"providers": rows}


# ─────────────────────────────────────────────────────────────────────
# High-level "providers + status" view used by /admin/providers
# ─────────────────────────────────────────────────────────────────────

async def full_provider_view() -> Dict[str, Any]:
    enabled_map = await all_enabled_map()
    out = []
    for p in PROVIDERS:
        configured = has_credential(p)
        coming_soon = bool(p.get("coming_soon"))
        # Default to enabled=True unless the row exists and is False.
        if p["key"] in enabled_map:
            enabled = enabled_map[p["key"]]
        else:
            enabled = not coming_soon
        if coming_soon:
            status = "coming_soon"
        elif not configured:
            status = "unconfigured"
        elif not enabled:
            status = "disabled"
        else:
            # Read the last known health without forcing a probe.
            cached = await db.provider_health.find_one({"_id": p["key"]})
            if cached and cached.get("expires_at_epoch", 0) > time.time():
                status = cached.get("status", "untested")
            else:
                status = "untested"
        out.append({
            "id": p["key"],
            "name": p.get("name"),
            "icon": p.get("icon"),
            "category": p.get("category"),
            "description": p.get("description"),
            "docs_url": p.get("docs_url"),
            "capabilities": p.get("capabilities", []),
            "configured": configured,
            "enabled": enabled,
            "coming_soon": coming_soon,
            "status": status,
            "auth_env_var": (p.get("auth_env_var") if not coming_soon else None),
        })
    return {"providers": out}


__all__ = [
    "is_enabled", "set_enabled", "all_enabled_map",
    "get_health", "analytics_snapshot", "full_provider_view",
    "HEALTH_TTL_SECONDS",
]
