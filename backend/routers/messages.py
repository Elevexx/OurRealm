"""Direct messaging — friends-only, id-based conversation graph.

Conversation id is the sorted pair of user_ids joined by ':' which is
stable across username renames. Every message stores both ids and (for
display convenience) the snapshotted usernames at send time.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from models.schemas import MessageCreate, PinThreadPayload

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
    return {"messages": items, "peer": {
        "id": target["id"], "username": target.get("username"),
        "name": target.get("name"), "avatar_url": target.get("avatar_url"),
        "is_founder": bool(target.get("is_founder")),
    }}


@router.post("")
async def send_message(payload: MessageCreate, current: CurrentUser):
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
    doc = {
        "id": str(uuid.uuid4()),
        "conv_id": conv_id(current["id"], target["id"]),
        "from_user_id": current["id"],
        "to_user_id": target["id"],
        # Snapshot usernames (UX convenience for old clients)
        "from_username": current.get("username"),
        "to_username": target.get("username"),
        "text": payload.text,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.messages.insert_one(doc)
    doc.pop("_id", None)
    return {"message": doc}


# ----- Threads list (Pinned + DMs) -----
@router.get("/threads")
async def list_threads(current: CurrentUser):
    """Aggregate the latest message per conversation involving the
    current user, plus a stub for friends with no messages yet.
    Each thread is friend-only (since send_message already enforces it).
    """
    me_id = current["id"]
    pinned = set(current.get("pinned_threads") or [])

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
