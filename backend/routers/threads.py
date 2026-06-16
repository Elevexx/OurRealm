"""Phase-3 unified Groups + Realms threads.

ONE collection (`db.messages`) backs DMs, Groups, and Realms. Group/Realm
messages tag `context_type` ('group'|'realm') + `context_id` so the same
read paths work for any container. DMs continue to use `conv_id` and the
existing `/api/messages/*` endpoints — those are NOT touched here.

Groups and Realms are structurally identical (members + name); the only
difference is the label. We share a single helper to keep code tight.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser


router = APIRouter(prefix="/api/threads", tags=["threads"])

ContextType = Literal["group", "realm"]


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _collection(ctx: ContextType):
    return db.groups if ctx == "group" else db.realms


async def _require_member(ctx: ContextType, container_id: str, user_id: str) -> dict:
    doc = await _collection(ctx).find_one({"id": container_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail=f"{ctx.title()} not found")
    if user_id not in (doc.get("members") or []):
        raise HTTPException(status_code=403, detail=f"Join the {ctx} first")
    return doc


def _container_out(doc: dict) -> dict:
    return {
        "id": doc.get("id"),
        "name": doc.get("name"),
        "members": doc.get("members") or [],
        "member_count": len(doc.get("members") or []),
        "created_at": doc.get("created_at"),
        "created_by": doc.get("created_by"),
        "last_activity_at": doc.get("last_activity_at"),
        "last_message_preview": doc.get("last_message_preview"),
        "unread_count": doc.get("_unread_count", 0),
    }


async def _maybe_serialize_member(uid: str) -> dict:
    u = await db.users.find_one(
        {"id": uid},
        {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1, "is_founder": 1, "is_verified": 1},
    )
    return u or {"id": uid}


# ─────────────────────────────────────────────────────────────────────
# Containers — groups & realms
# ─────────────────────────────────────────────────────────────────────
class CreateContainer(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    # Optional list of friend usernames invited at creation time.
    invite_usernames: list[str] = Field(default_factory=list)


@router.post("/{ctx}")
async def create_container(ctx: ContextType, payload: CreateContainer, current: CurrentUser):
    now_iso = datetime.now(timezone.utc).isoformat()
    # Resolve invited usernames → ids (silently drop unknown handles).
    member_ids = {current["id"]}
    if payload.invite_usernames:
        cursor = db.users.find(
            {"username": {"$in": [u.lower() for u in payload.invite_usernames]}},
            {"_id": 0, "id": 1},
        )
        async for u in cursor:
            if u.get("id"):
                member_ids.add(u["id"])
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "members": list(member_ids),
        "created_by": current["id"],
        "created_at": now_iso,
        "last_activity_at": now_iso,
        "last_message_preview": "",
    }
    await _collection(ctx).insert_one(doc)
    doc.pop("_id", None)
    return {ctx: _container_out(doc)}


@router.get("/{ctx}/me")
async def list_mine(ctx: ContextType, current: CurrentUser):
    cursor = _collection(ctx).find(
        {"members": current["id"]}, {"_id": 0},
    ).sort("last_activity_at", -1)
    out = []
    async for doc in cursor:
        out.append(_container_out(doc))
    return {ctx + "s": out}


@router.get("/{ctx}/discover")
async def discover(ctx: ContextType, current: CurrentUser, limit: int = 20):
    """Recent containers the user has NOT joined — for the Discover/Join surface."""
    cursor = _collection(ctx).find(
        {"members": {"$ne": current["id"]}}, {"_id": 0},
    ).sort("last_activity_at", -1).limit(min(max(1, limit), 60))
    return {ctx + "s": [_container_out(d) async for d in cursor]}


@router.post("/{ctx}/{container_id}/join")
async def join_container(ctx: ContextType, container_id: str, current: CurrentUser):
    doc = await _collection(ctx).find_one({"id": container_id}, {"_id": 0, "members": 1})
    if not doc:
        raise HTTPException(status_code=404, detail=f"{ctx.title()} not found")
    await _collection(ctx).update_one(
        {"id": container_id}, {"$addToSet": {"members": current["id"]}},
    )
    fresh = await _collection(ctx).find_one({"id": container_id}, {"_id": 0})
    return {ctx: _container_out(fresh)}


@router.post("/{ctx}/{container_id}/leave")
async def leave_container(ctx: ContextType, container_id: str, current: CurrentUser):
    await _collection(ctx).update_one(
        {"id": container_id}, {"$pull": {"members": current["id"]}},
    )
    return {"ok": True}


@router.get("/{ctx}/{container_id}")
async def get_container(ctx: ContextType, container_id: str, current: CurrentUser):
    doc = await _require_member(ctx, container_id, current["id"])
    members = [await _maybe_serialize_member(uid) for uid in (doc.get("members") or [])]
    out = _container_out(doc)
    out["member_details"] = members
    return {ctx: out}


# ─────────────────────────────────────────────────────────────────────
# Unified messages — write/read for groups & realms.
# Reuses db.messages collection (same one DMs use).
# ─────────────────────────────────────────────────────────────────────
class SendMessage(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/{ctx}/{container_id}/messages")
async def send_message(ctx: ContextType, container_id: str, payload: SendMessage, current: CurrentUser):
    await _require_member(ctx, container_id, current["id"])
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty message")
    now_iso = datetime.now(timezone.utc).isoformat()
    msg = {
        "id": str(uuid.uuid4()),
        "context_type": ctx,
        "context_id": container_id,
        "from_user_id": current["id"],
        "from_username": current.get("username"),
        "from_name": current.get("name"),
        "from_avatar": current.get("avatar_url"),
        "text": text,
        "created_at": now_iso,
    }
    await db.messages.insert_one(msg)
    msg.pop("_id", None)
    # Bump container activity for the list sort.
    await _collection(ctx).update_one(
        {"id": container_id},
        {"$set": {
            "last_activity_at": now_iso,
            "last_message_preview": text[:120],
        }},
    )
    return {"message": msg}


@router.get("/{ctx}/{container_id}/messages")
async def list_messages(ctx: ContextType, container_id: str, current: CurrentUser, limit: int = 200):
    await _require_member(ctx, container_id, current["id"])
    cursor = db.messages.find(
        {"context_type": ctx, "context_id": container_id}, {"_id": 0},
    ).sort("created_at", 1).limit(min(max(1, limit), 500))
    items = [m async for m in cursor]
    return {"messages": items}
