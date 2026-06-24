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

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ConfigDict

from core.deps import CurrentUser, is_admin_user
from core.api_providers import (
    PROVIDERS, get_provider, get_endpoint, public_provider_view,
)
from services.api_widget_proxy import call_api

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
    bypass_cache: bool = True   # builder test always bypasses cache.


class ApiCallPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    widget_id: Optional[str] = None
    widget_key: Optional[str] = None
    provider: Optional[str] = None
    endpoint: Optional[str] = None
    params: Optional[Dict[str, Any]] = None
    response_map: Optional[Dict[str, str]] = None
    cache_seconds: Optional[int] = None


# ─────────────────────────────────────────────────────────────────────
# /api/admin/widgets/api-providers — list providers (admin)
# ─────────────────────────────────────────────────────────────────────

@router.get("/admin/widgets/api-providers")
async def list_api_providers(current: CurrentUser):
    _require_admin(current)
    return {"providers": [public_provider_view(p) for p in PROVIDERS]}


# ─────────────────────────────────────────────────────────────────────
# /api/admin/widgets/test-api — stealth-only test call
# ─────────────────────────────────────────────────────────────────────

@router.post("/admin/widgets/test-api")
async def test_api(payload: ApiTestPayload, current: CurrentUser):
    _require_stealth(current)
    try:
        result = await call_api(
            payload.provider,
            payload.endpoint,
            payload.params,
            widget_id=None,           # builder tests don't count toward per-widget burst
            cache_seconds=0,          # don't pollute cache from the test surface
            bypass_cache=payload.bypass_cache,
            response_map=payload.response_map,
        )
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
async def widget_api_call(payload: ApiCallPayload, current: CurrentUser):
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
        cache_seconds = payload.cache_seconds if payload.cache_seconds is not None else ds.get("cache_seconds")
        widget_id = widget["id"]
    else:
        # No widget context — restricted to @stealth (matches test-api).
        # Live widgets MUST go through widget_id/widget_key so the
        # editor_config provides the trusted params + response_map.
        _require_stealth(current)
        provider = payload.provider
        endpoint_key = payload.endpoint
        params = payload.params or {}
        response_map = payload.response_map
        cache_seconds = payload.cache_seconds
        widget_id = None

    if not provider or not endpoint_key:
        raise HTTPException(status_code=400, detail="provider + endpoint are required")

    result = await call_api(
        provider, endpoint_key, params,
        widget_id=widget_id,
        cache_seconds=cache_seconds,
        bypass_cache=False,
        response_map=response_map,
    )
    return result


__all__ = ["router"]
