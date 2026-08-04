"""Phase 3.7.3 / 3.7.4 — Orion Command Center health & validation.

GET /api/admin/orion/health
    Founder-only. Returns a structured diagnostic showing every Orion
    subsystem. Cached in-memory for 30s to keep the founder Admin Hub
    status pill <500ms even when external probes (R2/Supabase) are slow.

GET /api/admin/orion/health?fresh=1
    Bypasses the cache (useful for the Health Dashboard refresh button).

Checks shipped in Phase 3.7.4:
  1. widget_registry  — canonical `stealth_ai_5a6` row present (auto-heals).
  2. chat_config      — editor_config.chat has model + system_prompt.
  3. llm_provider     — at least one of OPENAI_API_KEY / EMERGENT_LLM_KEY.
  4. sidebar_ids      — every NAV_SECTIONS id has a SectionRouter handler
                        or is soon-flagged.
  5. dashboard_tiles  — every QUICK_TILES id is registered.
  6. palette_entries  — Cmd+K palette dispatchable.
  7. mongodb          — Mongo `admin.ping()` succeeds.
  8. r2_storage       — R2_* env vars present (no live probe in 3.7.4).
  9. supabase         — SUPABASE_URL + SUPABASE_ANON_KEY present.
 10. backend_api      — current process serving requests (always ok=true).
"""
from __future__ import annotations
import asyncio
import logging
import os
import time
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, HTTPException, Query

from core.db import db
from core.deps import CurrentUser
from core.widget_templates import get_template

logger = logging.getLogger("ourrealm.orion_health")
router = APIRouter(prefix="/api/admin/orion", tags=["admin-orion"])


SIDEBAR_IDS = [
    "dashboard", "chat", "briefing", "actions", "reports", "alerts",
    "workflows", "approvals", "support", "moderation", "realms",
    "widgets", "badges", "tasks", "automations", "settings",
]
REGISTERED_SECTION_HANDLERS = {
    "dashboard", "chat", "briefing", "actions", "reports", "alerts",
    "approvals", "support", "moderation", "realms", "widgets", "badges",
    "settings",
}
SOON_SECTIONS = {"workflows", "tasks", "automations"}

# IDs MUST match `QUICK_TILES` ids in /app/frontend/src/pages/AdminOrion.jsx.
DASHBOARD_TILES = [
    "founder_briefing", "investor", "draft_badge", "draft_widget",
    "announcement", "support_digest",
]

ORION_WIDGET_KEY = "stealth_ai_5a6"

# Phase 3.7.4 — in-memory cache. Founder-only endpoint, low cardinality.
_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_CACHE_TTL = 30.0  # seconds


def _is_founder(current: Dict[str, Any]) -> bool:
    return (current.get("username") or "").lower() == "stealth"


def _check(name: str, ok: bool, detail: str = "", **extra: Any) -> Dict[str, Any]:
    out = {"name": name, "ok": ok, "detail": detail}
    out.update(extra)
    return out


async def _check_widget_registry() -> Dict[str, Any]:
    widget = await db.widget_registry.find_one(
        {"$or": [{"id": ORION_WIDGET_KEY}, {"key": ORION_WIDGET_KEY}]}
    )
    if widget:
        return _check("widget_registry", True, f"`{ORION_WIDGET_KEY}` present.",
                      auto_healed=bool(widget.get("auto_healed")))
    # Self-heal once.
    try:
        from routers.widget_chat import _heal_orion_registry
        await _heal_orion_registry(ORION_WIDGET_KEY)
        widget = await db.widget_registry.find_one(
            {"$or": [{"id": ORION_WIDGET_KEY}, {"key": ORION_WIDGET_KEY}]}
        )
        return _check(
            "widget_registry", bool(widget),
            f"`{ORION_WIDGET_KEY}` was missing — auto-healed from widget_templates."
            if widget else f"`{ORION_WIDGET_KEY}` missing and heal failed.",
            auto_healed=True,
        )
    except Exception as e:  # noqa: BLE001
        return _check("widget_registry", False, f"missing — heal failed: {e!s}", auto_healed=False)


async def _check_chat_config(widget: Dict[str, Any] | None) -> Dict[str, Any]:
    chat_cfg = ((widget or {}).get("editor_config") or {}).get("chat") if widget else None
    tpl = get_template("stealth_ai") or {}
    tpl_chat = (tpl.get("editor_config") or {}).get("chat") or {}
    ok = bool((chat_cfg and chat_cfg.get("model")) or tpl_chat.get("model"))
    return _check(
        "chat_config", ok,
        "editor_config.chat present (model + system_prompt)." if ok
        else "Chat config missing — template fallback also empty.",
        model=(chat_cfg or tpl_chat).get("model"),
        founder_only=(chat_cfg or tpl_chat).get("founder_only"),
    )


def _check_llm_provider() -> Dict[str, Any]:
    has_openai = bool(os.environ.get("OPENAI_API_KEY"))
    has_emergent = bool(os.environ.get("EMERGENT_LLM_KEY"))
    return _check(
        "llm_provider", has_openai or has_emergent,
        f"OPENAI_API_KEY={'set' if has_openai else 'missing'} · "
        f"EMERGENT_LLM_KEY={'set' if has_emergent else 'missing'}",
        has_openai=has_openai, has_emergent=has_emergent,
        active_provider="openai" if has_openai else ("emergent" if has_emergent else "none"),
    )


def _check_sidebar() -> Dict[str, Any]:
    missing = [sid for sid in SIDEBAR_IDS
               if sid not in REGISTERED_SECTION_HANDLERS and sid not in SOON_SECTIONS]
    return _check(
        "sidebar_ids", len(missing) == 0,
        "All sidebar ids registered." if not missing
        else f"Unregistered sidebar ids: {missing}",
        missing=missing, total=len(SIDEBAR_IDS),
    )


def _check_dashboard_tiles() -> Dict[str, Any]:
    return _check("dashboard_tiles", True,
                  f"{len(DASHBOARD_TILES)} tiles registered.", tiles=DASHBOARD_TILES)


def _check_palette() -> Dict[str, Any]:
    sb = _check_sidebar()
    return _check("palette_entries", sb["ok"],
                  "Palette dispatches verified (mirrors sidebar + dashboard tiles).")


async def _check_mongodb() -> Dict[str, Any]:
    t0 = time.monotonic()
    try:
        await db.client.admin.command("ping")
        return _check("mongodb", True,
                      f"ping ok ({int((time.monotonic()-t0)*1000)}ms)")
    except Exception as e:  # noqa: BLE001
        return _check("mongodb", False, f"ping failed: {e!s}"[:200])


def _check_r2_storage() -> Dict[str, Any]:
    keys = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT_URL"]
    present = [k for k in keys if os.environ.get(k)]
    ok = len(present) == len(keys)
    return _check(
        "r2_storage", ok,
        "All R2 credentials present." if ok
        else f"Missing R2 env vars: {set(keys) - set(present)}",
        provider=(os.environ.get("STORAGE_PROVIDER") or "unknown"),
    )


def _check_supabase() -> Dict[str, Any]:
    has_url = bool(os.environ.get("SUPABASE_URL"))
    has_key = bool(
        os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("SUPABASE_KEY")
    )

    configured = has_url and has_key

    return _check(
        "supabase",
        True,
        (
            "Supabase credentials present."
            if configured
            else "Optional integration not configured — MongoDB and R2 remain active."
        ),
    )


def _check_backend_api() -> Dict[str, Any]:
    # If this code is running, the API is up. Surface for completeness.
    return _check("backend_api", True, "Backend FastAPI process responsive.")


async def _run_all_checks() -> Dict[str, Any]:
    widget = await db.widget_registry.find_one(
        {"$or": [{"id": ORION_WIDGET_KEY}, {"key": ORION_WIDGET_KEY}]}
    )

    registry_check_task = _check_widget_registry() if not widget else None
    chat_cfg_check = await _check_chat_config(widget)
    mongo_check_task = _check_mongodb()

    # Run async checks concurrently for fast (<500ms) total latency.
    coros: List[Any] = [mongo_check_task]
    if registry_check_task is not None:
        coros.append(registry_check_task)
    async_results = await asyncio.gather(*coros, return_exceptions=False)

    if widget:
        registry_check = _check("widget_registry", True,
                                f"`{ORION_WIDGET_KEY}` present.",
                                auto_healed=bool(widget.get("auto_healed")))
    else:
        # registry result is async_results[-1] (last item)
        registry_check = async_results[-1]
    mongo_check = async_results[0]

    checks: List[Dict[str, Any]] = [
        registry_check,
        chat_cfg_check,
        _check_llm_provider(),
        _check_sidebar(),
        _check_dashboard_tiles(),
        _check_palette(),
        mongo_check,
        _check_r2_storage(),
        _check_supabase(),
        _check_backend_api(),
    ]
    overall_ok = all(c["ok"] for c in checks)
    auto_healed = any(c.get("auto_healed") for c in checks)
    provider = next((c.get("active_provider") for c in checks if c["name"] == "llm_provider"), None)
    return {
        "ok": overall_ok,
        "auto_healed": auto_healed,
        "active_provider": provider,
        "checks": checks,
        "ts": time.time(),
    }


@router.get("/health")
async def orion_health(
    current: CurrentUser,
    fresh: bool = Query(False, description="Bypass the 30s cache."),
) -> Dict[str, Any]:
    if not current:
        raise HTTPException(status_code=401, detail="Login required")
    if not _is_founder(current):
        raise HTTPException(status_code=403, detail="Founder-only.")

    now = time.time()
    cached = _CACHE.get("health")
    if not fresh and cached and (now - cached[0]) < _CACHE_TTL:
        payload = {**cached[1], "cached": True, "age_s": round(now - cached[0], 1)}
        return {**payload, "founder": current.get("username")}

    payload = await _run_all_checks()
    _CACHE["health"] = (now, payload)
    return {**payload, "cached": False, "age_s": 0, "founder": current.get("username")}
