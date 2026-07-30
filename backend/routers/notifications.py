"""Notifications router — Phase A: minimal scaffold so the badge wiring
works (unread-count, list, mark-seen) without spamming the rest of the
app. Phase B will add producers (friend requests, messages, likes,
comments, shares, saves).

Schema (one Mongo collection: `notifications`):
    {id, recipient_id, kind, actor_username?, payload?, created_at, seen}

`seen=false` counts toward the unread badge. Opening the notifications
page calls /mark-seen which flips them all to seen=true.

NOTE (Feb 24, 2026): Marketplace and Wallet are not active product
features. We never delete historical rows — instead we filter them
out of every read path so they're invisible to the UI, badge, and
unread counters. The list lives in `_HIDDEN_KINDS` below.
"""
from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import APIRouter

from core.db import db
from core.deps import CurrentUser

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

# Notification kinds that should never reach the UI. Historical rows
# stay in Mongo but are filtered out of every read endpoint AND the
# Mark-All-Seen write so unread counters never include them.
_HIDDEN_KINDS = [
    # Marketplace / Ads
    "marketplace", "marketplace_ad", "marketplace_listing",
    "ads", "ad", "ad_payout", "promoted", "promotion",
    # Wallet / Payments
    "wallet", "tip", "tipped", "payment", "purchase", "sale",
    "transaction", "balance", "transfer", "deposit", "withdrawal",
]

# Mongo filter fragment that EXCLUDES hidden kinds. Composes with any
# other recipient-scoped query via $and at the call site.
_KIND_NOT_HIDDEN = {"kind": {"$nin": _HIDDEN_KINDS}}


async def emit_notification(
    recipient_id: str,
    kind: str,
    actor_username: Optional[str] = None,
    payload: Optional[dict] = None,
):
    """Helper used by other routers (friends, messages, posts) to drop a
    notification into the recipient's inbox. Best-effort; never raises
    because notifications are non-critical to the action that triggered
    them. Hidden kinds are silently dropped so they can never resurface
    later if the filter is bypassed."""
    if kind in _HIDDEN_KINDS:
        return
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
        "recipient_id": current["id"],
        "seen": False,
        **_KIND_NOT_HIDDEN,
    })
    return {"count": n}


@router.get("/list")
async def list_notifications(current: CurrentUser, limit: int = 50):
    """Most recent first; client decides when to call /mark-seen.
    Hidden kinds (marketplace, wallet, etc.) are filtered server-side so
    every consumer — counts, badges, UI — stays in sync without per-
    client logic."""
    cursor = db.notifications.find(
        {"recipient_id": current["id"], **_KIND_NOT_HIDDEN},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit)
    items = []
    async for n in cursor:
        items.append(n)
    # Attach actor avatars in one batched lookup (read-path only).
    unames = {n["actor_username"] for n in items if n.get("actor_username")}
    if unames:
        avatars = {}
        async for u in db.users.find({"username": {"$in": list(unames)}},
                                     {"_id": 0, "username": 1, "avatar_url": 1}):
            avatars[u["username"]] = u.get("avatar_url")
        for n in items:
            if n.get("actor_username"):
                n["actor_avatar"] = avatars.get(n["actor_username"])
    return {"notifications": items}


@router.post("/mark-seen")
async def mark_seen(current: CurrentUser):
    """Mark every VISIBLE notification for the current user as seen.
    Hidden-kind rows are left alone — they're already invisible, no
    point flipping `seen` on them. Admin moderation notifications are
    ALSO excluded: urgent safety cases must never be auto-cleared just
    by opening the page — they're marked read via acknowledge/open-case."""
    res = await db.notifications.update_many(
        {"recipient_id": current["id"], "seen": False,
         "kind": {"$nin": _HIDDEN_KINDS + ["admin_moderation"]}},
        {"$set": {"seen": True}},
    )
    return {"updated": res.modified_count}
