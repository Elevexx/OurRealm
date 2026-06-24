"""API widget proxy router (Phase 3).

Three endpoints:
  • GET  /api/admin/widgets/api-providers  — list providers + endpoint specs (admin)
  • POST /api/admin/widgets/test-api       — stealth-only ad-hoc test
  • POST /api/widgets/api-call             — authed users (proxy for live widgets)

The proxy injects credentials from OS env, applies the two-tier cache,
enforces rate limits, and applies the field→jsonpath response_map.
Frontend NEVER sees a credential value — only `has_credential: bool`.
"""
from __future__ import annotations
import logging
from typing import Any, Dict, Optional, List

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, ConfigDict

from core.deps import CurrentUser, is_admin_user
from core.api_providers import (
    PROVIDERS, get_provider, get_endpoint, public_provider_view,
)
from services.api_widget_proxy import call_api
from services.provider_registry import (
    full_provider_view, set_enabled, get_health, analytics_snapshot,
    is_enabled as provider_is_enabled,
)
from utils.sliding_window_rate_limit import aggregate_recent_denials


class ProviderTogglePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    enabled: bool

logger = logging.getLogger("ourrealm.api_widgets")
router = APIRouter(prefix="/api", tags=["api-widgets"])


def _require_stealth(current: dict):
    if not current or (current.get("username") or "").lower() != "stealth":
        raise HTTPException(status_code=403, detail="Restricted to the founder account")


def _require_admin(current: dict):
    if not is_admin_user(current):
        raise HTTPException(status_code=403, detail="Admin access required")


# ─────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────

class ApiTestPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    provider: str
    endpoint: str
    params: Dict[str, Any] = Field(default_factory=dict)
    response_map: Optional[Dict[str, str]] = None
    array_bindings: Optional[List[Dict[str, Any]]] = None
    formatters: Optional[Dict[str, Dict[str, Any]]] = None
    bypass_cache: bool = True


class ApiCallPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    widget_id: Optional[str] = None
    widget_key: Optional[str] = None
    provider: Optional[str] = None
    endpoint: Optional[str] = None
    params: Optional[Dict[str, Any]] = None
    response_map: Optional[Dict[str, str]] = None
    array_bindings: Optional[List[Dict[str, Any]]] = None
    formatters: Optional[Dict[str, Dict[str, Any]]] = None
    cache_seconds: Optional[int] = None


def _set_rate_headers(response: Response, rl: Optional[Dict[str, Any]]) -> None:
    """Attach X-RateLimit-* headers from the limiter result."""
    if not rl:
        return
    if rl.get("limit") is not None:
        response.headers["X-RateLimit-Limit"] = str(rl["limit"])
    if rl.get("remaining") is not None:
        response.headers["X-RateLimit-Remaining"] = str(rl["remaining"])
    if rl.get("reset_in") is not None:
        response.headers["X-RateLimit-Reset"] = str(rl["reset_in"])


# ─────────────────────────────────────────────────────────────────────
# /api/admin/widgets/api-providers — list providers (admin)
# ─────────────────────────────────────────────────────────────────────

@router.get("/admin/widgets/api-providers")
async def list_api_providers(current: CurrentUser):
    """Phase 3.4 — merges enabled-flag state so the builder can grey
    out admin-disabled providers."""
    _require_admin(current)
    from services.provider_registry import all_enabled_map
    enabled = await all_enabled_map()
    out = []
    for p in PROVIDERS:
        view = public_provider_view(p)
        if p["key"] in enabled:
            view["enabled"] = enabled[p["key"]]
        else:
            view["enabled"] = not bool(p.get("coming_soon"))
        out.append(view)
    return {"providers": out}


# ─────────────────────────────────────────────────────────────────────
# Phase 3.4 — Provider management (admin/providers/*)
# ─────────────────────────────────────────────────────────────────────

@router.get("/admin/providers")
async def admin_providers_list(current: CurrentUser):
    """Returns the FULL provider view including configured/enabled/
    coming_soon/status flags. Used by the /admin/providers page."""
    _require_admin(current)
    return await full_provider_view()


@router.get("/admin/providers/status")
async def admin_providers_status(current: CurrentUser):
    _require_admin(current)
    view = await full_provider_view()
    return {"providers": [
        {k: p[k] for k in ("id", "configured", "enabled", "status", "coming_soon")}
        for p in view["providers"]
    ]}


@router.post("/admin/providers/toggle")
async def admin_provider_toggle(payload: ProviderTogglePayload, current: CurrentUser):
    """Enable/disable a provider. @stealth-only — toggling has
    cross-cutting effects on every widget using the provider."""
    _require_stealth(current)
    if not get_provider(payload.id):
        raise HTTPException(status_code=404, detail=f"Unknown provider '{payload.id}'")
    return await set_enabled(payload.id, payload.enabled, actor=current.get("username"))


@router.post("/admin/providers/test")
async def admin_provider_test(payload: ProviderTogglePayload, current: CurrentUser):
    """Run a fresh health probe (bypasses the 5-minute cache).
    Admin-tier (not @stealth-only) — any admin can verify status."""
    _require_admin(current)
    if not get_provider(payload.id):
        raise HTTPException(status_code=404, detail=f"Unknown provider '{payload.id}'")
    return await get_health(payload.id, force=True)


@router.get("/admin/analytics/providers")
async def admin_provider_analytics(current: CurrentUser):
    """Per-provider calls / errors / avg latency snapshot."""
    _require_admin(current)
    return await analytics_snapshot()


# ─────────────────────────────────────────────────────────────────────
# /api/admin/widgets/test-api — stealth-only test call
# ─────────────────────────────────────────────────────────────────────

@router.post("/admin/widgets/test-api")
async def test_api(payload: ApiTestPayload, current: CurrentUser, response: Response):
    _require_stealth(current)
    if not await provider_is_enabled(payload.provider):
        raise HTTPException(status_code=403, detail=f"Provider '{payload.provider}' is disabled by admin.")
    try:
        result = await call_api(
            payload.provider,
            payload.endpoint,
            payload.params,
            widget_id=None,
            cache_seconds=0,
            bypass_cache=payload.bypass_cache,
            response_map=payload.response_map,
            array_bindings=payload.array_bindings,
            formatters=payload.formatters,
        )
        _set_rate_headers(response, result.get("rate_limit"))
        return result
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.exception("test_api failed")
        raise HTTPException(status_code=500, detail=f"Test failed: {e}")


# ─────────────────────────────────────────────────────────────────────
# /api/widgets/api-call — authed proxy for live widgets
#
# Two modes:
#   1. widget_id/widget_key supplied → hydrate data_source from the
#      registry. Trusted source — admin already configured this widget.
#   2. provider/endpoint supplied directly (no widget_id) → admin-only
#      ad-hoc preview from a live profile draft. Refuses non-admin
#      callers because there's no registry to enforce safe params.
# ─────────────────────────────────────────────────────────────────────

@router.post("/widgets/api-call")
async def widget_api_call(payload: ApiCallPayload, current: CurrentUser, response: Response):
    # Authenticated users only.
    if not current:
        raise HTTPException(status_code=401, detail="Login required")

    if payload.widget_id or payload.widget_key:
        from core.db import db
        query = {}
        if payload.widget_id:
            query["id"] = payload.widget_id
        else:
            query["key"] = payload.widget_key
        widget = await db.widget_registry.find_one(query)
        if not widget:
            raise HTTPException(status_code=404, detail="Widget not found")
        if widget.get("status") != "live" and not is_admin_user(current):
            raise HTTPException(status_code=404, detail="Widget not live")
        ds = (widget.get("editor_config") or {}).get("data_source") or {}
        if ds.get("kind") != "api":
            raise HTTPException(status_code=400, detail="Widget is not an API-backed widget")
        provider = ds.get("provider")
        endpoint_key = ds.get("endpoint_key")
        params = {**(ds.get("params") or {}), **(payload.params or {})}
        response_map = payload.response_map or ds.get("response_map") or {}
        array_bindings = payload.array_bindings or ds.get("array_bindings") or []
        formatters = payload.formatters or ds.get("formatters") or {}
        cache_seconds = payload.cache_seconds if payload.cache_seconds is not None else ds.get("cache_seconds")
        widget_id = widget["id"]
    else:
        _require_stealth(current)
        provider = payload.provider
        endpoint_key = payload.endpoint
        params = payload.params or {}
        response_map = payload.response_map
        array_bindings = payload.array_bindings
        formatters = payload.formatters
        cache_seconds = payload.cache_seconds
        widget_id = None

    if not provider or not endpoint_key:
        raise HTTPException(status_code=400, detail="provider + endpoint are required")
    if not await provider_is_enabled(provider):
        raise HTTPException(status_code=403, detail=f"Provider '{provider}' is disabled by admin.")

    result = await call_api(
        provider, endpoint_key, params,
        widget_id=widget_id,
        cache_seconds=cache_seconds,
        bypass_cache=False,
        response_map=response_map,
        array_bindings=array_bindings,
        formatters=formatters,
    )
    _set_rate_headers(response, result.get("rate_limit"))
    return result


@router.get("/admin/analytics/rate-limits")
async def admin_rate_limit_analytics(current: CurrentUser, hours: int = 24):
    """Aggregated 429 activity over the last `hours` (default 24).
    Admin-only — surfaces top abused keys, IPs, users, endpoints."""
    if not is_admin_user(current):
        raise HTTPException(status_code=403, detail="Admin access required")
    hours = max(1, min(int(hours or 24), 168))
    return await aggregate_recent_denials(hours=hours)


__all__ = ["router"]
