"""Presence + real user discovery endpoints.

Surface area:
    • WebSocket  /api/ws/presence?token=<jwt>   — live presence socket
    • PATCH      /api/users/status              — set user-selectable status
    • GET        /api/presence/friends          — friends + live status
    • GET        /api/presence/me               — own current status
    • GET        /api/users/newest              — newest real users
    • GET        /api/users/trending            — trending real users
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from core import presence as presence_reg
from core.config import JWT_ALGORITHM, get_jwt_secret
from core.db import db
from core.deps import CurrentUser

logger = logging.getLogger("ourrealm.presence")
router = APIRouter(prefix="/api", tags=["presence"])

# ---------------------------------------------------------------
# Enum
# ---------------------------------------------------------------
# Statuses the USER may pick. `messenger` is auto-assigned by client
# focus and is not user-selectable. `offline` is implicit (no socket).
USER_PICKABLE_STATUSES = {"live", "online", "invisible"}
# All valid statuses that may appear in `presence_status` on a user doc.
ALL_STATUSES = {"live", "online", "messenger", "invisible", "offline"}

# Sort order for presence-aware lists (lower = higher priority).
STATUS_PRIORITY = {
    "live": 0,
    "online": 1,
    "messenger": 2,
    "invisible": 3,    # shown as offline to others, but sorted above true-offline
    "offline": 4,
}


# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------
def _public_status(doc: dict) -> str:
    """What other users SEE for this user. `invisible` masks to offline,
    and a user without an active socket is offline regardless of their
    stored preference."""
    stored = (doc.get("presence_status") or "offline").lower()
    if stored == "invisible":
        return "offline"
    if not presence_reg.is_online(doc.get("id")):
        return "offline"
    if stored not in ALL_STATUSES:
        return "offline"
    return stored


async def _set_status(user_id: str, status: str) -> None:
    """Write the stored status to Mongo and broadcast a presence update
    to every friend of the user."""
    if status not in ALL_STATUSES:
        return
    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "presence_status": status,
            "presence_last_seen": datetime.now(timezone.utc).isoformat(),
        }},
    )
    # Broadcast to friends
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "friends": 1})
    friends = (doc or {}).get("friends") or []
    public = "offline" if status == "invisible" else status
    if friends:
        await presence_reg.broadcast(
            friends,
            {"type": "presence:update", "user_id": user_id, "status": public},
        )


# ---------------------------------------------------------------
# Models
# ---------------------------------------------------------------
class StatusPayload(BaseModel):
    status: str = Field(..., description="live | online | invisible")


# ---------------------------------------------------------------
# REST routes
# ---------------------------------------------------------------
@router.patch("/users/status")
async def set_my_status(payload: StatusPayload, current: CurrentUser):
    s = (payload.status or "").lower().strip()
    if s not in USER_PICKABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="status must be one of: live, online, invisible",
        )
    # Persist the *preference*. The visible status may differ if no
    # active socket (then "offline").
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {"presence_status_choice": s}},
    )
    # If user has an active socket, push the new public status now.
    if presence_reg.is_online(current["id"]):
        await _set_status(current["id"], s)
    else:
        # Just persist; next connect will adopt this value.
        await db.users.update_one(
            {"id": current["id"]},
            {"$set": {"presence_status": s if s != "invisible" else "invisible"}},
        )
    return {"ok": True, "status": s}


@router.get("/presence/me")
async def my_presence(current: CurrentUser):
    return {
        "status": current.get("presence_status_choice") or "online",
        "public_status": _public_status(current),
    }


@router.get("/presence/friends")
async def friends_presence(current: CurrentUser):
    """Hydrated friend list with current public status, sorted by status
    priority then most-recently-seen."""
    friends = current.get("friends") or []
    if not friends:
        return {"friends": []}
    items: list[dict] = []
    async for u in db.users.find(
        {"id": {"$in": friends}},
        {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1,
         "is_founder": 1, "is_verified": 1, "is_vip": 1,
         "presence_status": 1, "presence_last_seen": 1},
    ):
        pub = _public_status(u)
        items.append({
            "id": u.get("id"),
            "username": u.get("username"),
            "name": u.get("name"),
            "avatar_url": u.get("avatar_url"),
            "is_founder": bool(u.get("is_founder")),
            "is_verified": bool(u.get("is_verified")),
            "is_vip": bool(u.get("is_vip")),
            "presence_status": pub,
            "last_seen": u.get("presence_last_seen"),
        })
    items.sort(key=lambda x: (STATUS_PRIORITY.get(x["presence_status"], 9),
                              -(0 if x.get("last_seen") is None
                                else _iso_to_epoch(x["last_seen"]))))
    return {"friends": items}


def _iso_to_epoch(iso: str) -> float:
    try:
        return datetime.fromisoformat(iso).timestamp()
    except Exception:
        return 0.0


# ---------------------------------------------------------------
# Discover (newest) & Trending (top followers)
# ---------------------------------------------------------------
async def _project_user_card(u: dict) -> dict:
    fc = u.get("follower_count")
    if fc is None:
        fc = len(u.get("friends") or [])
    return {
        "id": u.get("id"),
        "username": u.get("username"),
        "name": u.get("name") or u.get("username") or "",
        "avatar_url": u.get("avatar_url"),
        "bio": u.get("bio") or "",
        "is_founder": bool(u.get("is_founder")),
        "is_verified": bool(u.get("is_verified")),
        "is_vip": bool(u.get("is_vip")),
        "follower_count": int(fc),
        "presence_status": _public_status(u),
        "created_at": u.get("created_at"),
    }


# Protected accounts that should be hidden from public discovery lists.
HIDDEN_FROM_DISCOVERY = {"support"}


@router.get("/users/newest")
async def users_newest(limit: int = 24):
    limit = max(1, min(int(limit or 24), 60))
    cursor = db.users.find(
        {"username": {"$ne": None, "$nin": list(HIDDEN_FROM_DISCOVERY)}},
        {"_id": 0, "password_hash": 0},
    ).sort([("created_at", -1)]).limit(limit)
    users = []
    async for u in cursor:
        users.append(await _project_user_card(u))
    return {"users": users}


@router.get("/users/trending")
async def users_trending(limit: int = 24):
    limit = max(1, min(int(limit or 24), 60))
    # We sort by the precomputed `follower_count` when present; fall back
    # to the friends-array length via an aggregate so legacy docs with no
    # `follower_count` field still show up.
    pipeline = [
        {"$match": {"username": {"$ne": None, "$nin": list(HIDDEN_FROM_DISCOVERY)}}},
        {"$addFields": {
            "_fc": {"$ifNull": [
                "$follower_count",
                {"$size": {"$ifNull": ["$friends", []]}},
            ]},
        }},
        {"$sort": {"_fc": -1, "created_at": -1}},
        {"$limit": limit},
        {"$project": {"_id": 0, "password_hash": 0}},
    ]
    users = []
    async for u in db.users.aggregate(pipeline):
        users.append(await _project_user_card(u))
    return {"users": users}


# ---------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------
async def _ws_auth(ws: WebSocket) -> Optional[dict]:
    """Resolve the user from the access token. Token may arrive via the
    `token` query param (preferred for browsers) or via a cookie."""
    token = ws.query_params.get("token")
    if not token:
        token = ws.cookies.get("access_token")
    if not token:
        await ws.close(code=4401)
        return None
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        await ws.close(code=4401)
        return None
    if payload.get("type") != "access":
        await ws.close(code=4401)
        return None
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        await ws.close(code=4401)
        return None
    return user


@router.websocket("/ws/presence")
async def presence_socket(ws: WebSocket):
    await ws.accept()
    user = await _ws_auth(ws)
    if not user:
        return
    user_id = user["id"]
    # Initial status when the socket comes up adopts the user preference.
    initial = (user.get("presence_status_choice") or "online").lower()
    if initial not in USER_PICKABLE_STATUSES:
        initial = "online"
    await presence_reg.connect(user_id, ws)
    await _set_status(user_id, initial)
    # send hello with the current public status
    try:
        await ws.send_json({"type": "presence:hello", "status": initial})
    except Exception:
        pass
    try:
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=60.0)
            except asyncio.TimeoutError:
                # Server-side heartbeat — keeps the socket alive through
                # ingress idle-timeouts.
                try:
                    await ws.send_json({"type": "presence:ping"})
                except Exception:
                    break
                continue
            kind = msg.get("type") or msg.get("event")
            if kind in {"ping", "presence:ping", "heartbeat"}:
                await ws.send_json({"type": "presence:pong"})
                continue
            if kind == "presence:focus":
                # client signals it's actively in Messenger
                focused = bool(msg.get("messenger"))
                if focused:
                    await _set_status(user_id, "messenger")
                else:
                    # Revert to user preference
                    pref = (user.get("presence_status_choice") or "online").lower()
                    if pref not in USER_PICKABLE_STATUSES:
                        pref = "online"
                    await _set_status(user_id, pref)
                continue
            if kind == "presence:set":
                new = (msg.get("status") or "").lower()
                if new in USER_PICKABLE_STATUSES:
                    await db.users.update_one(
                        {"id": user_id},
                        {"$set": {"presence_status_choice": new}},
                    )
                    await _set_status(user_id, new)
                continue
            # ignore unknown messages
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("presence socket error: %s", e)
    finally:
        await presence_reg.disconnect(user_id, ws)
        # If this was the user's last socket, mark them offline.
        if not presence_reg.is_online(user_id):
            await _set_status(user_id, "offline")
