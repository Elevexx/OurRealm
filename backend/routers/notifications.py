"""Notifications router — Phase A: minimal scaffold so the badge wiring
works (unread-count, list, mark-seen) without spamming the rest of the
app. Phase B will add producers (friend requests, messages, likes,
comments, shares, saves).

Schema (one Mongo collection: `notifications`):
    {id, recipient_id, kind, actor_username?, payload?, created_at, seen}

`seen=false` counts toward the unread badge. Opening the notifications
page calls /mark-seen which flips them all to seen=true.
"""
from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import APIRouter

from core.db import db
from core.deps import CurrentUser

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


async def emit_notification(
    recipient_id: str,
    kind: str,
    actor_username: Optional[str] = None,
    payload: Optional[dict] = None,
):
    """Helper used by other routers (friends, messages, posts) to drop a
    notification into the recipient's inbox. Best-effort; never raises
    because notifications are non-critical to the action that triggered
    them."""
    try:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "recipient_id": recipient_id,
            "kind": kind,
            "actor_username": actor_username,
            "payload": payload or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
            "seen": False,
        })
    except Exception:  # noqa: BLE001
        pass


@router.get("/unread-count")
async def unread_count(current: CurrentUser):
    n = await db.notifications.count_documents({
        "recipient_id": current["id"], "seen": False,
    })
    return {"count": n}


@router.get("/list")
async def list_notifications(current: CurrentUser, limit: int = 50):
    """Most recent first; client decides when to call /mark-seen."""
    cursor = db.notifications.find(
        {"recipient_id": current["id"]}, {"_id": 0},
    ).sort("created_at", -1).limit(limit)
    items = []
    async for n in cursor:
        items.append(n)
    return {"notifications": items}


@router.post("/mark-seen")
async def mark_seen(current: CurrentUser):
    """Mark every notification for the current user as seen."""
    res = await db.notifications.update_many(
        {"recipient_id": current["id"], "seen": False},
        {"$set": {"seen": True}},
    )
    return {"updated": res.modified_count}
