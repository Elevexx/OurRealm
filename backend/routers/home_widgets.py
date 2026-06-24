"""Home widgets — per-user widget layout for the /home dashboard.

Mirrors the profile widgets model but lives on `users.home_widgets`
so the home dashboard can be customised independently of /profile.
Validation is intentionally narrower than profile widgets — we just
enforce the allow-list and a 24-widget cap. Per-type field validation
(notes char limits, videos cap, etc.) doesn't apply here because Home
widgets are display-only references to registry entries.
"""
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.widget_types import ALLOWED_WIDGET_TYPES

router = APIRouter(prefix="/api/home", tags=["home-widgets"])

HOME_WIDGETS_MAX = 24


class HomeWidgetsPayload(BaseModel):
    widgets: List[dict] = Field(default_factory=list)


@router.get("/widgets")
async def get_home_widgets(current: CurrentUser):
    """Returns the caller's home widget layout. Empty array if never set."""
    user = await db.users.find_one({"id": current["id"]}, {"_id": 0, "home_widgets": 1})
    return {"widgets": (user or {}).get("home_widgets") or []}


@router.patch("/widgets")
async def patch_home_widgets(payload: HomeWidgetsPayload, current: CurrentUser):
    """Replace the caller's home widgets array atomically.

    Allow-list comes from `widget_types.ALLOWED_WIDGET_TYPES` PLUS
    every CUSTOM widget marked status=live in the registry — this lets
    admins ship new custom widgets without bumping the allow-list.
    """
    custom_keys = set()
    async for w in db.widget_registry.find(
        {"status": "live", "is_system": False, "placements": "home"},
        {"_id": 0, "key": 1},
    ):
        custom_keys.add(w["key"])
    allowed = ALLOWED_WIDGET_TYPES | custom_keys

    cleaned: List[dict] = []
    for w in payload.widgets:
        if not isinstance(w, dict):
            continue
        t = w.get("type")
        if t not in allowed:
            continue
        cleaned.append(w)
    if len(cleaned) > HOME_WIDGETS_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"Home supports max {HOME_WIDGETS_MAX} widgets",
        )
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {"home_widgets": cleaned}},
    )
    return {"widgets": cleaned}
