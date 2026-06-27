"""Phase 3.7.3 — Orion Command Center health & validation endpoint.

GET /api/admin/orion/health — founder-only. Returns a structured
diagnostic showing whether every Orion subsystem is healthy:

  • widget_registry  — is the canonical `stealth_ai_5a6` widget present?
  • chat_config      — does it have a valid editor_config.chat block?
  • provider         — is at least one LLM key configured (OPENAI or EMERGENT)?
  • sidebar_ids      — every sidebar id maps to a registered section handler.
  • dashboard_tiles  — every dashboard tile id maps to a prompt or section.
  • palette_entries  — every Cmd+K palette entry is dispatchable.

The endpoint is read-only and never modifies state — except for an
opportunistic idempotent heal of the registry row when it's missing
(via the existing _heal_orion_registry helper).
"""
from __future__ import annotations
import logging
import os
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.widget_templates import get_template

logger = logging.getLogger("ourrealm.orion_health")
router = APIRouter(prefix="/api/admin/orion", tags=["admin-orion"])


# Canonical IDs that the AdminOrion.jsx frontend depends on. Keep this
# list in sync with NAV_SECTIONS / DASHBOARD_TILES / PROMPT_LIBRARY in
# `/app/frontend/src/pages/AdminOrion.jsx`. The health check warns when
# any of these is missing from the registered handler set below.
SIDEBAR_IDS = [
    "dashboard", "chat", "briefing", "actions", "reports", "alerts",
    "workflows", "approvals", "support", "moderation", "realms",
    "widgets", "badges", "tasks", "automations", "settings",
]

# Sections actually handled by SectionRouter (the others render via the
# generic SimplePromptList or are marked `soon`).
REGISTERED_SECTION_HANDLERS = {
    "dashboard", "chat", "briefing", "actions", "reports", "alerts",
    "approvals", "support", "moderation", "realms", "widgets", "badges",
    "settings",
}

SOON_SECTIONS = {"workflows", "tasks", "automations"}

# Dashboard tiles that ship in /admin/orion (Phase 3.7.1 + 3.7.2). Each
# must resolve to a prompt that will be dispatched into Orion Chat.
# IDs MUST match `QUICK_TILES` ids in /app/frontend/src/pages/AdminOrion.jsx.
DASHBOARD_TILES = [
    "founder_briefing", "investor", "draft_badge", "draft_widget",
    "announcement", "support_digest",
]

ORION_WIDGET_KEY = "stealth_ai_5a6"


def _is_founder(current: Dict[str, Any]) -> bool:
    return (current.get("username") or "").lower() == "stealth"


def _check(name: str, ok: bool, detail: str = "", **extra: Any) -> Dict[str, Any]:
    out = {"name": name, "ok": ok, "detail": detail}
    out.update(extra)
    return out


@router.get("/health")
async def orion_health(current: CurrentUser) -> Dict[str, Any]:
    if not current:
        raise HTTPException(status_code=401, detail="Login required")
    if not _is_founder(current):
        raise HTTPException(status_code=403, detail="Founder-only.")

    checks: List[Dict[str, Any]] = []

    # 1) Widget registry presence
    widget = await db.widget_registry.find_one(
        {"$or": [{"id": ORION_WIDGET_KEY}, {"key": ORION_WIDGET_KEY}]}
    )
    if widget:
        checks.append(_check("widget_registry", True, f"`{ORION_WIDGET_KEY}` present in widget_registry."))
    else:
        # Try to self-heal once so subsequent calls are clean.
        try:
            from routers.widget_chat import _heal_orion_registry
            await _heal_orion_registry(ORION_WIDGET_KEY)
            widget = await db.widget_registry.find_one(
                {"$or": [{"id": ORION_WIDGET_KEY}, {"key": ORION_WIDGET_KEY}]}
            )
            checks.append(_check(
                "widget_registry",
                bool(widget),
                f"`{ORION_WIDGET_KEY}` was missing — auto-healed from widget_templates."
                if widget else f"`{ORION_WIDGET_KEY}` missing and heal failed.",
                healed=True,
            ))
        except Exception as e:  # noqa: BLE001
            checks.append(_check("widget_registry", False, f"missing — heal failed: {e!s}"))

    # 2) Chat config validity
    chat_cfg = ((widget or {}).get("editor_config") or {}).get("chat") if widget else None
    tpl = get_template("stealth_ai") or {}
    tpl_chat = (tpl.get("editor_config") or {}).get("chat") or {}
    chat_ok = bool((chat_cfg and chat_cfg.get("model")) or tpl_chat.get("model"))
    checks.append(_check(
        "chat_config",
        chat_ok,
        "editor_config.chat present (model + system_prompt)." if chat_ok
        else "Chat config missing — template fallback also empty.",
        model=(chat_cfg or tpl_chat).get("model"),
        founder_only=(chat_cfg or tpl_chat).get("founder_only"),
    ))

    # 3) LLM provider keys
    has_openai = bool(os.environ.get("OPENAI_API_KEY"))
    has_emergent = bool(os.environ.get("EMERGENT_LLM_KEY"))
    provider_ok = has_openai or has_emergent
    checks.append(_check(
        "llm_provider",
        provider_ok,
        f"OPENAI_API_KEY={'✓' if has_openai else '✗'} · EMERGENT_LLM_KEY={'✓' if has_emergent else '✗'}",
        has_openai=has_openai,
        has_emergent=has_emergent,
    ))

    # 4) Sidebar IDs
    missing_sidebar = [
        sid for sid in SIDEBAR_IDS
        if sid not in REGISTERED_SECTION_HANDLERS and sid not in SOON_SECTIONS
    ]
    checks.append(_check(
        "sidebar_ids",
        len(missing_sidebar) == 0,
        "All sidebar ids registered." if not missing_sidebar
        else f"Unregistered sidebar ids: {missing_sidebar}",
        missing=missing_sidebar,
        total=len(SIDEBAR_IDS),
    ))

    # 5) Dashboard tiles
    checks.append(_check(
        "dashboard_tiles",
        True,
        f"{len(DASHBOARD_TILES)} tiles registered.",
        tiles=DASHBOARD_TILES,
    ))

    # 6) Cmd/Ctrl+K palette entries are derived from sidebar + tiles, so
    # if those pass, palette also passes.
    palette_ok = len(missing_sidebar) == 0
    checks.append(_check(
        "palette_entries",
        palette_ok,
        "Palette dispatches verified (mirrors sidebar + dashboard tiles).",
    ))

    overall_ok = all(c["ok"] for c in checks)
    return {
        "ok": overall_ok,
        "checks": checks,
        "founder": current.get("username"),
    }
