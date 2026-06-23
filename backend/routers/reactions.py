"""Universal emoji reactions — Mongo side (Feb 2026).

Reactions are one-emoji-per-user-per-target. The Mongo `reactions`
collection stores reactions for the four Mongo-backed surfaces:

  • `post`               — db.posts
  • `comment`            — db.comments (both top-level AND replies; they
                          share the same collection and the same id space)
  • `dm_message`         — db.messages (1:1 direct messages)
  • `community_message`  — db.community_messages (realm community chats)

Group messages and the `/messages` Realms-tab threads live in Supabase
(see /app/backend/supabase_migrations/01_message_reactions.sql for the
matching Postgres schema). The frontend talks to Supabase directly for
those surfaces and to this router for everything else.

Endpoints
---------
  POST  /api/reactions/set   {target_type, target_id, emoji}
      Idempotent. If the user already reacted to this target with the
      same emoji → reaction is REMOVED (tap-again-to-clear).
      Otherwise the row is upserted with the new emoji.
      Returns the fresh `{summary, my_reaction}` for the target.

  GET   /api/reactions/summary?target_type=…&target_ids=id1,id2,…
      Batch fetch reaction summaries for a list of targets. Used by
      list endpoints (feed, comments) when they don't embed summaries
      inline. Up to 200 ids per call.

Allowed emojis (server-validated):
    ❤️ 😍 😘 🔥 🙏 💪 ⚡️

The frontend renders this fixed set; sending anything else returns 400.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser


router = APIRouter(prefix="/api/reactions", tags=["reactions"])


# Allow-list (variant-selector-16 included for ❤️ and ⚡️, no skin tones).
ALLOWED_EMOJIS: frozenset[str] = frozenset([
    "❤️", "😍", "😘", "🔥", "🙏", "💪", "⚡️",
])

TARGET_TYPES: frozenset[str] = frozenset([
    "post", "comment", "dm_message", "community_message",
])

_INDEXES_READY = False


async def _ensure_indexes() -> None:
    """Idempotent index init — called lazily on the first request."""
    global _INDEXES_READY
    if _INDEXES_READY:
        return
    try:
        await db.reactions.create_index(
            [("target_type", 1), ("target_id", 1), ("user_id", 1)],
            unique=True,
            name="uniq_target_user",
        )
        await db.reactions.create_index(
            [("target_type", 1), ("target_id", 1)],
            name="by_target",
        )
    except Exception:
        # Index may already exist with a different name — ignore.
        pass
    _INDEXES_READY = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────── helpers (importable by other routers) ───────────
async def reaction_summary_for(target_type: str, target_id: str,
                               viewer_id: Optional[str] = None) -> dict:
    """Return `{summary: [{emoji, count}], my_reaction}` for ONE target."""
    if target_type not in TARGET_TYPES:
        return {"summary": [], "my_reaction": None}
    pipeline = [
        {"$match": {"target_type": target_type, "target_id": target_id}},
        {"$group": {"_id": "$emoji", "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    summary: list[dict] = []
    async for row in db.reactions.aggregate(pipeline):
        summary.append({"emoji": row["_id"], "count": int(row["count"])})
    my_reaction = None
    if viewer_id:
        own = await db.reactions.find_one(
            {"target_type": target_type, "target_id": target_id, "user_id": viewer_id},
            {"_id": 0, "emoji": 1},
        )
        if own:
            my_reaction = own.get("emoji")
    return {"summary": summary, "my_reaction": my_reaction}


async def reaction_summaries_for(target_type: str, target_ids: Iterable[str],
                                 viewer_id: Optional[str] = None) -> dict[str, dict]:
    """Batch version — returns `{target_id: {summary, my_reaction}}`."""
    ids = [tid for tid in target_ids if tid]
    if not ids or target_type not in TARGET_TYPES:
        return {}
    pipeline = [
        {"$match": {"target_type": target_type, "target_id": {"$in": ids}}},
        {"$group": {
            "_id": {"target_id": "$target_id", "emoji": "$emoji"},
            "count": {"$sum": 1},
        }},
    ]
    by_target: dict[str, dict[str, int]] = {tid: {} for tid in ids}
    async for row in db.reactions.aggregate(pipeline):
        tid = row["_id"]["target_id"]
        emoji = row["_id"]["emoji"]
        by_target.setdefault(tid, {})[emoji] = int(row["count"])

    mine: dict[str, str] = {}
    if viewer_id:
        async for row in db.reactions.find(
            {"target_type": target_type, "target_id": {"$in": ids}, "user_id": viewer_id},
            {"_id": 0, "target_id": 1, "emoji": 1},
        ):
            mine[row["target_id"]] = row["emoji"]

    out: dict[str, dict] = {}
    for tid in ids:
        counts = by_target.get(tid, {})
        summary = sorted(
            ({"emoji": e, "count": c} for e, c in counts.items()),
            key=lambda r: (-r["count"], r["emoji"]),
        )
        out[tid] = {"summary": summary, "my_reaction": mine.get(tid)}
    return out


async def _target_exists(target_type: str, target_id: str) -> bool:
    coll = {
        "post":              db.posts,
        "comment":           db.comments,
        "dm_message":        db.messages,
        "community_message": db.community_messages,
    }[target_type]
    found = await coll.find_one({"id": target_id}, {"_id": 0, "id": 1})
    return bool(found)


async def _community_chat_id_for(message_id: str) -> Optional[str]:
    """Look up `chat_id` for a community message so we can broadcast a
    `reaction:update` WS event to the right room."""
    msg = await db.community_messages.find_one(
        {"id": message_id}, {"_id": 0, "chat_id": 1},
    )
    return (msg or {}).get("chat_id")


# ─────────── endpoints ───────────
class SetReactionBody(BaseModel):
    target_type: str
    target_id:   str
    emoji:       str


@router.post("/set")
async def set_reaction(body: SetReactionBody, current: CurrentUser):
    await _ensure_indexes()
    if body.target_type not in TARGET_TYPES:
        raise HTTPException(status_code=400, detail="Unknown target_type")
    if body.emoji not in ALLOWED_EMOJIS:
        raise HTTPException(status_code=400, detail="Unsupported emoji")
    if not body.target_id or len(body.target_id) > 128:
        raise HTTPException(status_code=400, detail="Invalid target_id")

    # 404 if the target doesn't exist (prevents reactions to deleted rows).
    if not await _target_exists(body.target_type, body.target_id):
        raise HTTPException(status_code=404, detail="Target not found")

    uid = current["id"]
    existing = await db.reactions.find_one(
        {"target_type": body.target_type, "target_id": body.target_id, "user_id": uid},
        {"_id": 0, "emoji": 1},
    )
    removed = False
    if existing and existing.get("emoji") == body.emoji:
        # Same emoji tapped again → remove.
        await db.reactions.delete_one(
            {"target_type": body.target_type, "target_id": body.target_id, "user_id": uid},
        )
        removed = True
    else:
        # Upsert with new emoji (replaces previous reaction in-place).
        await db.reactions.update_one(
            {"target_type": body.target_type, "target_id": body.target_id, "user_id": uid},
            {
                "$set": {
                    "target_type": body.target_type,
                    "target_id":   body.target_id,
                    "user_id":     uid,
                    "emoji":       body.emoji,
                    "updated_at":  _now(),
                },
                "$setOnInsert": {"created_at": _now()},
            },
            upsert=True,
        )

    summary = await reaction_summary_for(body.target_type, body.target_id, viewer_id=uid)

    # Realtime fan-out for community chat messages over the existing
    # community-chat WS room. Best-effort — never blocks the response.
    if body.target_type == "community_message":
        try:
            from core.community_chat import broadcast as room_broadcast
            chat_id = await _community_chat_id_for(body.target_id)
            if chat_id:
                await room_broadcast(chat_id, {
                    "type":       "reaction:update",
                    "target_type": body.target_type,
                    "target_id":   body.target_id,
                    "summary":     summary["summary"],
                    "actor_id":    uid,
                })
        except Exception:
            pass

    return {
        "ok":           True,
        "target_type":  body.target_type,
        "target_id":    body.target_id,
        "removed":      removed,
        "summary":      summary["summary"],
        "my_reaction":  summary["my_reaction"],
    }


@router.get("/summary")
async def get_summary(
    current: CurrentUser,
    target_type: str = Query(...),
    target_ids:  str = Query(..., description="Comma-separated list of target ids"),
):
    await _ensure_indexes()
    if target_type not in TARGET_TYPES:
        raise HTTPException(status_code=400, detail="Unknown target_type")
    ids = [s.strip() for s in (target_ids or "").split(",") if s.strip()][:200]
    if not ids:
        return {"reactions": {}}
    summaries = await reaction_summaries_for(target_type, ids, viewer_id=current["id"])
    return {"reactions": summaries}
