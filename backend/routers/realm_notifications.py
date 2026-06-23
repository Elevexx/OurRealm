"""Realm activity notifications — aggregated single-row-per-realm.

Spec (Feb 20, 2026): instead of one notification per realm message,
each user gets a SINGLE row per realm that increments its `unread_count`
as new activity arrives (messages, posts, comments, media uploads).
Tapping the notification routes the user to that specific realm; the
row is then marked seen so it stops contributing to the star-bar badge.

Storage: piggy-backs on the existing `db.notifications` collection so
the star-bar badge (which counts `seen=false`) automatically picks up
realm activity without any client change.

Schema for these rows (`kind=realm_activity`):
{
  id:             "realm-activity:{realm_id}:{recipient_id}"  (deterministic),
  recipient_id:   <user id>,
  kind:           "realm_activity",
  payload: {
    realm_id, realm_slug, realm_name, realm_avatar,
    unread_count, last_actor_id, last_actor_username,
    counters: { message: int, post: int, comment: int, media: int, other: int },
  },
  created_at:     <ISO of first bump in this aggregation>,
  updated_at:     <ISO of most recent bump>,
  seen:           bool,
}
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Literal, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser

router = APIRouter(prefix="/api/realm-notifications", tags=["realm-notifications"])

ACTIVITY_KINDS = {"message", "post", "comment", "media", "other"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_id(realm_id: str, recipient_id: str) -> str:
    """Deterministic id so we can upsert a single aggregated row per
    (realm, recipient). Lets the producer fan out to many recipients
    without ever creating duplicates."""
    return f"realm-activity:{realm_id}:{recipient_id}"


async def bump_realm_activity(
    realm_id: str,
    actor_id: str,
    activity_type: str = "message",
) -> int:
    """Producer — call from any realm-activity event (message send,
    post create, comment create, media upload). Increments the
    aggregated row for every realm member EXCEPT the actor. Returns
    the number of recipients touched.

    Best-effort: any failure is logged and swallowed so the caller's
    own action (the message send, the post create, …) is never blocked
    by a notification bug.
    """
    try:
        if activity_type not in ACTIVITY_KINDS:
            activity_type = "other"
        realm = await db.realms.find_one(
            {"id": realm_id},
            {"_id": 0, "id": 1, "name": 1, "slug": 1, "emoji": 1},
        )
        if not realm:
            return 0
        actor = await db.users.find_one(
            {"id": actor_id},
            {"_id": 0, "id": 1, "username": 1},
        )
        actor_username = (actor or {}).get("username")
        # Fan out to every realm member except the actor.
        member_ids: list[str] = []
        async for m in db.community_memberships.find(
            {"community_type": "realm", "community_id": realm_id, "user_id": {"$ne": actor_id}},
            {"_id": 0, "user_id": 1},
        ):
            member_ids.append(m["user_id"])
        now_iso = _now_iso()
        for recipient_id in member_ids:
            row_id = _row_id(realm_id, recipient_id)
            # `$inc` accepts a single dict so the per-bucket counter
            # only touches the field for the activity_type we got.
            await db.notifications.update_one(
                {"id": row_id},
                {
                    "$setOnInsert": {
                        "id":           row_id,
                        "recipient_id": recipient_id,
                        "kind":         "realm_activity",
                        "created_at":   now_iso,
                        # Realm metadata lives inside payload, but we
                        # also keep the realm_id at the top level so
                        # /clear can target it without a payload scan.
                        "realm_id":     realm_id,
                    },
                    "$set": {
                        "updated_at":           now_iso,
                        "seen":                 False,
                        "actor_username":       actor_username,
                        "payload.realm_id":     realm_id,
                        "payload.realm_slug":   realm.get("slug"),
                        "payload.realm_name":   realm.get("name"),
                        "payload.realm_avatar": realm.get("emoji") or "🌐",
                        "payload.last_actor_id":       actor_id,
                        "payload.last_actor_username": actor_username,
                        "payload.last_activity_at":    now_iso,
                    },
                    "$inc": {
                        "payload.unread_count":         1,
                        f"payload.counters.{activity_type}": 1,
                    },
                },
                upsert=True,
            )
        return len(member_ids)
    except Exception:  # noqa: BLE001 — never block the producer
        return 0


class BumpPayload(BaseModel):
    realm_id: str = Field(min_length=1)
    activity_type: Literal["message", "post", "comment", "media", "other"] = "message"


@router.post("/bump")
async def bump(payload: BumpPayload, current: CurrentUser):
    """Public producer endpoint — called by the frontend after sending
    a realm chat message in Supabase (since that path is client-driven
    and never hits FastAPI). Other surfaces (posts, comments) call
    `bump_realm_activity()` server-side directly.
    """
    n = await bump_realm_activity(
        realm_id=payload.realm_id,
        actor_id=current["id"],
        activity_type=payload.activity_type,
    )
    return {"ok": True, "recipients": n}


@router.post("/{realm_id}/clear")
async def clear(realm_id: str, current: CurrentUser):
    """Mark the user's aggregated realm-activity row as seen + zero
    out the unread counter. Called when the user opens that realm so
    the badge stops contributing to the star-bar count."""
    row_id = _row_id(realm_id, current["id"])
    res = await db.notifications.update_one(
        {"id": row_id},
        {
            "$set": {
                "seen":                 True,
                "payload.unread_count": 0,
                "payload.counters":     {},
                "updated_at":           _now_iso(),
            },
        },
    )
    return {"ok": True, "cleared": res.modified_count}


@router.get("/list")
async def list_realm_notifications(current: CurrentUser):
    """Realm-only notification list — used by the dedicated Realms
    activity surface in the notifications page. The generic
    `/api/notifications/list` already includes these rows."""
    items: list[dict] = []
    async for n in db.notifications.find(
        {"recipient_id": current["id"], "kind": "realm_activity"},
        {"_id": 0},
    ).sort("updated_at", -1):
        items.append(n)
    return {"notifications": items}
