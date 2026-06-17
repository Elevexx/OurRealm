"""Phase F.6 — Founder announcement pinning.

Singleton design: exactly ONE globally-pinned post may exist at any time.
Stored in `db.system_pin` keyed by `_id="pinned_post"`. Pinning auto-replaces
the previous pinned announcement.

Permissions: only `@stealth` and `@support`. Anyone else gets 403.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser

router = APIRouter(prefix="/api/announcements", tags=["announcements"])

ADMIN_USERNAMES = {"stealth", "support"}


class PinPayload(BaseModel):
    post_id: str
    expires_at: Optional[str] = None   # ISO 8601, None = never


def _is_admin(u: dict) -> bool:
    return (u.get("username") or "").lower() in ADMIN_USERNAMES


async def fetch_active_pin() -> Optional[dict]:
    """Return the active pin doc or None if no pin / expired / target post
    was deleted / made private."""
    pin = await db.system_pin.find_one({"_id": "pinned_post"})
    if not pin or not pin.get("post_id"):
        return None
    # Check expiry.
    exp = pin.get("expires_at")
    if exp and exp <= datetime.now(timezone.utc).isoformat():
        await db.system_pin.delete_one({"_id": "pinned_post"})
        return None
    post = await db.posts.find_one({"id": pin["post_id"]}, {"_id": 0})
    if not post:
        await db.system_pin.delete_one({"_id": "pinned_post"})
        return None
    # Respect visibility — if author later changed the audience to
    # non-public the announcement self-removes.
    audience = post.get("audience") or {}
    if audience.get("visibility", "public") != "public":
        return None
    return {"pin": pin, "post": post}


@router.get("/pinned")
async def get_pinned():
    """Public — anyone can read the current pinned announcement."""
    active = await fetch_active_pin()
    if not active:
        return {"pinned": None}
    p = dict(active["post"])
    p["is_pinned"] = True
    p["pinned_by"] = active["pin"].get("pinned_by")
    p["pinned_at"] = active["pin"].get("pinned_at")
    p["pinned_expires_at"] = active["pin"].get("expires_at")
    return {"pinned": p}


@router.post("/pin")
async def pin_post(payload: PinPayload, current: CurrentUser):
    if not _is_admin(current):
        raise HTTPException(status_code=403, detail="Founder/support only")
    post = await db.posts.find_one({"id": payload.post_id}, {"_id": 0, "id": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.system_pin.update_one(
        {"_id": "pinned_post"},
        {"$set": {
            "post_id": payload.post_id,
            "pinned_by": current.get("username"),
            "pinned_at": now_iso,
            "expires_at": payload.expires_at,
        }},
        upsert=True,
    )
    return {"ok": True, "pinned_post_id": payload.post_id}


@router.post("/unpin")
async def unpin_post(current: CurrentUser):
    if not _is_admin(current):
        raise HTTPException(status_code=403, detail="Founder/support only")
    await db.system_pin.delete_one({"_id": "pinned_post"})
    return {"ok": True}
