"""Friend graph endpoints (id-based internally; username addressed via API).

All friend / request arrays on user documents store **user_ids**, not
usernames. This protects the social graph from username renames.
"""
from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from models.schemas import FriendActionPayload

router = APIRouter(prefix="/api", tags=["friends"])


# ----- helpers -----
async def _user_by_username(username: str) -> dict | None:
    return await db.users.find_one({"username": username.lower().strip()})


async def _hydrate_users(user_ids: list[str]) -> list[dict]:
    if not user_ids:
        return []
    out = []
    async for u in db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1,
         "bio": 1, "is_founder": 1, "is_verified": 1},
    ):
        out.append(u)
    return out


# ----- friends -----
@router.get("/friends/list")
async def friends_list(current: CurrentUser):
    return {
        "friends":  await _hydrate_users(current.get("friends") or []),
        "incoming": await _hydrate_users(current.get("friend_requests_in") or []),
        "outgoing": await _hydrate_users(current.get("friend_requests_out") or []),
    }


@router.get("/friends/status/{username}")
async def friend_status(username: str, current: CurrentUser):
    target = username.lower().strip()
    if target == (current.get("username") or "").lower():
        return {"status": "self"}
    target_user = await _user_by_username(target)
    if not target_user:
        return {"status": "none"}
    tid = target_user["id"]
    if tid in (current.get("friends") or []):
        return {"status": "friends"}
    if tid in (current.get("friend_requests_out") or []):
        return {"status": "outgoing"}
    if tid in (current.get("friend_requests_in") or []):
        return {"status": "incoming"}
    return {"status": "none"}


@router.post("/friends/request")
async def friend_request(payload: FriendActionPayload, current: CurrentUser):
    target_user = await _user_by_username(payload.username)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    if target_user["id"] == current["id"]:
        raise HTTPException(status_code=400, detail="Cannot friend yourself")
    me_id, tg_id = current["id"], target_user["id"]
    if tg_id in (current.get("friends") or []):
        return {"status": "friends"}
    if tg_id in (current.get("friend_requests_out") or []):
        return {"status": "outgoing"}
    await db.users.update_one({"id": me_id}, {"$addToSet": {"friend_requests_out": tg_id}})
    await db.users.update_one({"id": tg_id}, {"$addToSet": {"friend_requests_in": me_id}})
    return {"status": "outgoing"}


@router.post("/friends/accept")
async def friend_accept(payload: FriendActionPayload, current: CurrentUser):
    target_user = await _user_by_username(payload.username)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    me_id, tg_id = current["id"], target_user["id"]
    if tg_id not in (current.get("friend_requests_in") or []):
        raise HTTPException(status_code=400, detail="No pending request")
    await db.users.update_one(
        {"id": me_id},
        {"$pull": {"friend_requests_in": tg_id}, "$addToSet": {"friends": tg_id}},
    )
    await db.users.update_one(
        {"id": tg_id},
        {"$pull": {"friend_requests_out": me_id}, "$addToSet": {"friends": me_id}},
    )
    return {"status": "friends"}


@router.post("/friends/decline")
async def friend_decline(payload: FriendActionPayload, current: CurrentUser):
    target_user = await _user_by_username(payload.username)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    me_id, tg_id = current["id"], target_user["id"]
    await db.users.update_one(
        {"id": me_id}, {"$pull": {"friend_requests_in": tg_id, "friends": tg_id}}
    )
    await db.users.update_one(
        {"id": tg_id}, {"$pull": {"friend_requests_out": me_id, "friends": me_id}}
    )
    return {"status": "none"}


# ----- discovery -----
@router.get("/users/search")
async def users_search(q: str = ""):
    if not q or len(q) < 1:
        return {"users": []}
    qre = {"$regex": q, "$options": "i"}
    cursor = db.users.find(
        {"$or": [{"username": qre}, {"name": qre}]},
        {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1,
         "bio": 1, "is_founder": 1, "is_verified": 1},
    ).limit(20)
    users = []
    async for u in cursor:
        if u.get("username"):
            users.append(u)
    return {"users": users}


@router.get("/users/featured")
async def users_featured(limit: int = 12):
    cursor = db.users.find(
        {"username": {"$ne": None}},
        {"_id": 0, "password_hash": 0},
    ).sort([("is_founder", -1), ("is_verified", -1), ("created_at", -1)]).limit(limit)
    users = []
    async for u in cursor:
        users.append({
            "id": u.get("id"),
            "username": u.get("username"),
            "name": u.get("name"),
            "avatar_url": u.get("avatar_url"),
            "bio": u.get("bio"),
            "is_founder": bool(u.get("is_founder")),
            "is_verified": bool(u.get("is_verified")),
            "widgets": u.get("widgets") or [],
        })
    return {"users": users}
