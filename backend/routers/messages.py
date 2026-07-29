"""Direct messaging — friends-only, id-based conversation graph.

Conversation id is the sorted pair of user_ids joined by ':' which is
stable across username renames. Every message stores both ids and (for
display convenience) the snapshotted usernames at send time.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from models.schemas import MessageCreate, PinThreadPayload
from routers.notifications import emit_notification


class MessageEditPayload(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class MessageMediaPayload(BaseModel):
    # `image` and `link` are the original inline-media flavours; `post_share`
    # carries a reference to an existing post (post_id only — never a copy of
    # the post body) so the recipient renders the SAME post from
    # /api/posts/{id} and all engagement (likes, comments) stays on the
    # canonical post document.
    kind: str = Field(default="image")  # image | link | post_share
    url: Optional[str] = None
    preview: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    post_id: Optional[str] = None


class MessageCreatePlus(MessageCreate):
    """Extends MessageCreate with an optional inline media payload."""
    media: Optional[MessageMediaPayload] = None


router = APIRouter(prefix="/api/messages", tags=["messages"])


def conv_id(a_id: str, b_id: str) -> str:
    return ":".join(sorted([a_id, b_id]))


async def _user_by_username(username: str) -> dict | None:
    return await db.users.find_one({"username": username.lower().strip()})


@router.get("/can-message/{username}")
async def can_message(username: str, current: CurrentUser):
    target = await _user_by_username(username)
    if not target:
        return {"allowed": False, "reason": "not_found"}
    if target["id"] == current["id"]:
        return {"allowed": False, "reason": "self"}
    if target["id"] in (current.get("friends") or []):
        return {"allowed": True}
    return {"allowed": False, "reason": "not_friends"}


@router.get("/thread/{username}")
async def get_thread(username: str, current: CurrentUser):
    target = await _user_by_username(username)
    if not target:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if target["id"] == current["id"]:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    if target["id"] not in (current.get("friends") or []):
        raise HTTPException(
            status_code=403,
            detail="You can only message friends. Send a friend request first.",
        )
    cid = conv_id(current["id"], target["id"])
    cursor = db.messages.find({"conv_id": cid}, {"_id": 0}).sort("created_at", 1).limit(200)
    items = []
    async for m in cursor:
        items.append(m)

    # ── READ RECEIPTS ── mark every message FROM the peer TO me as read.
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.messages.update_many(
        {"conv_id": cid, "to_user_id": current["id"], "read_at": None},
        {"$set": {"read_at": now_iso, "delivered_at": now_iso}},
    )
    # Mirror onto the snapshot we just fetched so the response is consistent
    for m in items:
        if m.get("to_user_id") == current["id"] and not m.get("read_at"):
            m["read_at"] = now_iso
            if not m.get("delivered_at"):
                m["delivered_at"] = now_iso

    # Attach emoji reaction summaries — batch lookup over Mongo.
    try:
        from routers.reactions import reaction_summaries_for
        ids = [m["id"] for m in items if m.get("id")]
        if ids:
            rmap = await reaction_summaries_for("dm_message", ids, viewer_id=current["id"])
            empty = {"summary": [], "my_reaction": None}
            for m in items:
                m["reactions"] = rmap.get(m.get("id"), empty)
    except Exception:
        pass

    return {"messages": items, "peer": {
        "id": target["id"], "username": target.get("username"),
        "name": target.get("name"), "avatar_url": target.get("avatar_url"),
        "is_founder": bool(target.get("is_founder")),
    }}


@router.post("")
async def send_message(payload: MessageCreatePlus, current: CurrentUser):
    from services.moderation import ensure_not_limited
    await ensure_not_limited(current["id"], "messaging")
    target = await _user_by_username(payload.to_username)
    if not target:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if target["id"] == current["id"]:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    if target["id"] not in (current.get("friends") or []):
        raise HTTPException(
            status_code=403,
            detail="You can only message friends. Send a friend request first.",
        )
    now_iso = datetime.now(timezone.utc).isoformat()
    media_dict = payload.media.model_dump() if payload.media else None
    # Defense-in-depth: post_share carries ONLY {kind, post_id}. If a
    # caller sets url/preview, strip them server-side so private content
    # can never leak via this surface even if a future client misbehaves.
    if media_dict and media_dict.get("kind") == "post_share":
        media_dict = {"kind": "post_share", "post_id": media_dict.get("post_id")}
    doc = {
        "id": str(uuid.uuid4()),
        "conv_id": conv_id(current["id"], target["id"]),
        "from_user_id": current["id"],
        "to_user_id": target["id"],
        # Snapshot usernames (UX convenience for old clients)
        "from_username": current.get("username"),
        "to_username": target.get("username"),
        "text": payload.text,
        "media": media_dict,
        "created_at": now_iso,
        "edited_at": None,
        "delivered_at": now_iso,   # delivered as soon as server accepts
        "read_at": None,
    }
    await db.messages.insert_one(doc)
    doc.pop("_id", None)

    # Notify recipient
    await emit_notification(
        target["id"], "message",
        actor_username=current.get("username"),
        payload={"preview": payload.text[:80], "conv_id": doc["conv_id"]},
    )
    return {"message": doc}


@router.patch("/{message_id}")
async def edit_message(message_id: str, payload: MessageEditPayload, current: CurrentUser):
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.get("from_user_id") != current["id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own messages")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.messages.update_one(
        {"id": message_id},
        {"$set": {"text": payload.text, "edited_at": now_iso}},
    )
    msg["text"] = payload.text
    msg["edited_at"] = now_iso
    return {"message": msg}


@router.delete("/{message_id}")
async def delete_message(message_id: str, current: CurrentUser):
    """Hard-delete the message for BOTH sender and receiver. The spec
    requires that no placeholder remains — so we simply remove the row."""
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0, "from_user_id": 1})
    if not msg:
        return {"ok": True}
    if msg.get("from_user_id") != current["id"]:
        raise HTTPException(status_code=403, detail="You can only delete your own messages")
    await db.messages.delete_one({"id": message_id})
    return {"ok": True}


@router.post("/{message_id}/read")
async def mark_read(message_id: str, current: CurrentUser):
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.get("to_user_id") != current["id"]:
        return {"ok": True}
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.messages.update_one(
        {"id": message_id},
        {"$set": {"read_at": now_iso, "delivered_at": msg.get("delivered_at") or now_iso}},
    )
    return {"ok": True, "read_at": now_iso}


# ----- Threads list (Pinned + DMs) -----
@router.get("/threads")
async def list_threads(current: CurrentUser):
    """Aggregate the latest message per conversation involving the
    current user, plus a stub for friends with no messages yet.
    Each thread is friend-only (since send_message already enforces it).
    """
    me_id = current["id"]
    pinned = set(current.get("pinned_threads") or [])

    # Threads the user previously deleted from their list. Hide them
    # until a NEW message arrives in that conv after the hide moment.
    hidden_map: dict[str, str] = {}
    async for row in db.message_threads_hidden.find(
        {"user_id": me_id},
        {"_id": 0, "peer_id": 1, "hidden_at": 1},
    ):
        if row.get("peer_id") and row.get("hidden_at"):
            hidden_map[row["peer_id"]] = row["hidden_at"]

    # Pull every message I sent or received and group by conv_id
    pipeline = [
        {"$match": {"$or": [{"from_user_id": me_id}, {"to_user_id": me_id}]}},
        {"$sort": {"created_at": -1}},
        {"$group": {
            "_id": "$conv_id",
            "last": {"$first": "$$ROOT"},
        }},
    ]
    grouped = {}
    async for row in db.messages.aggregate(pipeline):
        grouped[row["_id"]] = row["last"]

    # All friend ids — these become threads (even if no messages yet)
    friend_ids = list(current.get("friends") or [])
    friends_map = {}
    if friend_ids:
        async for u in db.users.find(
            {"id": {"$in": friend_ids}},
            {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1, "is_founder": 1},
        ):
            friends_map[u["id"]] = u

    threads = []
    for fid, fdoc in friends_map.items():
        cid = conv_id(me_id, fid)
        last = grouped.get(cid)
        hidden_at = hidden_map.get(fid)
        # If hidden and no NEW activity after the hide, skip this thread.
        if hidden_at:
            last_at_str = last.get("created_at") if last else None
            if not last_at_str or last_at_str <= hidden_at:
                continue
        threads.append({
            "conv_id": cid,
            "peer": fdoc,
            "last_text": last.get("text") if last else None,
            "last_at": last.get("created_at") if last else None,
            "last_from_me": (last.get("from_user_id") == me_id) if last else False,
            "is_pinned": fid in pinned,
        })

    # Sort: pinned first, then by last_at desc (nulls last), then by username
    threads.sort(key=lambda t: (
        not t["is_pinned"],
        t["last_at"] is None,
        # Negate via reversed string trick: simply use empty for null
        -(_ts_int(t["last_at"])),
        (t["peer"].get("username") or "").lower(),
    ))
    return {"threads": threads}


def _ts_int(iso: str | None) -> int:
    if not iso:
        return 0
    try:
        return int(datetime.fromisoformat(iso).timestamp())
    except Exception:
        return 0


@router.post("/threads/pin")
async def pin_thread(payload: PinThreadPayload, current: CurrentUser):
    peer = await _user_by_username(payload.peer_username)
    if not peer:
        raise HTTPException(status_code=404, detail="User not found")
    if peer["id"] not in (current.get("friends") or []):
        raise HTTPException(status_code=403, detail="Not friends with this user")
    await db.users.update_one(
        {"id": current["id"]}, {"$addToSet": {"pinned_threads": peer["id"]}}
    )
    return {"ok": True, "pinned": True}


@router.post("/threads/unpin")
async def unpin_thread(payload: PinThreadPayload, current: CurrentUser):
    peer = await _user_by_username(payload.peer_username)
    if not peer:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one(
        {"id": current["id"]}, {"$pull": {"pinned_threads": peer["id"]}}
    )
    return {"ok": True, "pinned": False}


@router.delete("/threads/{username}")
async def delete_thread(username: str, current: CurrentUser):
    """Delete the entire DM thread between current user and `username`.

    Soft-deletes every message in the conversation by stamping
    `deleted_at` + `deleted_by` so the rows remain available for the
    peer (one-sided delete). Removes the thread from the current user's
    pinned list too. The peer's view is unaffected.
    """
    peer = await _user_by_username(username)
    if not peer:
        raise HTTPException(status_code=404, detail="User not found")
    cid = conv_id(current["id"], peer["id"])
    now = datetime.now(timezone.utc).isoformat()
    await db.messages.update_many(
        {"conv_id": cid, "from_user_id": current["id"]},
        {"$set": {"deleted_at": now, "deleted_by": current["id"]}},
    )
    # Hide the thread for the current user only — by tagging on a
    # `hidden_for` array. The thread list endpoint filters these out.
    await db.message_threads_hidden.update_one(
        {"user_id": current["id"], "peer_id": peer["id"]},
        {"$set": {"user_id": current["id"], "peer_id": peer["id"], "hidden_at": now}},
        upsert=True,
    )
    await db.users.update_one(
        {"id": current["id"]}, {"$pull": {"pinned_threads": peer["id"]}}
    )
    return {"ok": True, "deleted": True}
