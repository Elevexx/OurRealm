"""Communities router — Realms + Groups + Memberships + Chats (Phase 1).

Endpoints (all prefixed with `/api`)
-----------------------------------
List / detail
    GET    /communities/realms                       (public)
    GET    /communities/realms/{id_or_slug}          (public)
    GET    /communities/groups                       (auth — user's groups only)
    GET    /communities/groups/{id}                  (auth — must be member)

Create
    POST   /communities/realms                       (auth)
    POST   /communities/groups                       (auth, private invite-only)

Membership
    POST   /communities/{type}/{id}/join             (auth)
    POST   /communities/{type}/{id}/leave            (auth)
    GET    /communities/{type}/{id}/members          (auth, paginated, presence-overlay)
    PATCH  /communities/{type}/{id}/favorite         (auth — toggle pin/favorite)

Main chat
    GET    /communities/{type}/{id}/chats            (auth member)
    PATCH  /communities/{type}/{id}/chats/{chat_id}  (admin only — rename / desc / pinned)
    GET    /community-chats/{chat_id}/messages       (auth member, paginated by `before`)
    POST   /community-chats/{chat_id}/messages       (auth member)
    WS     /ws/community-chat/{chat_id}              (auth member; realtime fan-out)

Design notes
------------
* Community chats live in Mongo with WebSocket fan-out — independent of
  Supabase DMs (Supabase remains untouched for 1:1 DM threads).
* Permissions: realm `admin_ids` includes founder usernames + per-realm
  admins. A user is "creator/admin" iff `current.id in admin_ids` or
  `current.id == owner_id` or `current.username == "stealth"` (global
  founder).
* The router never returns raw Mongo `_id` fields. Every response is
  projected to plain JSON.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import jwt
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from core.community_chat import broadcast as room_broadcast, join as room_join, leave as room_leave
from core.config import JWT_ALGORITHM, get_jwt_secret
from core.db import db
from core.deps import CurrentUser
from core import presence as presence_reg

logger = logging.getLogger("ourrealm.communities")

router = APIRouter(prefix="/api", tags=["communities"])


# --------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------- #
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_admin(community: dict, current: dict) -> bool:
    if not community or not current:
        return False
    if (current.get("username") or "").lower() == "stealth":
        return True
    if current["id"] == community.get("owner_id"):
        return True
    return current["id"] in (community.get("admin_ids") or [])


async def _load_community(community_type: str, id_or_slug: str) -> Optional[dict]:
    coll = db.realms if community_type == "realm" else db.groups
    return await coll.find_one(
        {"$or": [{"id": id_or_slug}, {"slug": id_or_slug}]},
        {"_id": 0},
    )


async def _ensure_member(community_type: str, community_id: str, user_id: str) -> Optional[dict]:
    return await db.community_memberships.find_one(
        {"community_type": community_type, "community_id": community_id, "user_id": user_id},
        {"_id": 0},
    )


async def _project_member_card(membership: dict) -> dict:
    u = await db.users.find_one({"id": membership["user_id"]}, {"_id": 0, "id": 1, "username": 1, "avatar_url": 1, "display_name": 1, "presence_status_choice": 1})
    if not u:
        return {**membership, "_missing": True}
    return {
        "user_id":      u["id"],
        "username":     u.get("username"),
        "display_name": u.get("display_name") or u.get("username"),
        "avatar_url":   u.get("avatar_url"),
        "presence_choice": u.get("presence_status_choice") or "online",
        "is_online":    presence_reg.is_online(u["id"]),
        "role":         membership.get("role", "member"),
        "joined_at":    membership.get("joined_at"),
        "favorite":     bool(membership.get("favorite", False)),
    }


# --------------------------------------------------------------------- #
# Realm endpoints
# --------------------------------------------------------------------- #
@router.get("/communities/realms")
async def list_realms(q: Optional[str] = None, limit: int = 50):
    filt: dict[str, Any] = {}
    if q:
        filt["$or"] = [
            {"name":        {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
            {"tags":        {"$regex": q, "$options": "i"}},
        ]
    cursor = db.realms.find(filt, {"_id": 0}).limit(min(limit, 200))
    realms = [r async for r in cursor]
    return {"realms": realms}


@router.get("/communities/realms/{id_or_slug}")
async def get_realm(id_or_slug: str):
    realm = await _load_community("realm", id_or_slug)
    if not realm:
        raise HTTPException(404, "Realm not found")
    realm["online_count"] = await _online_count("realm", realm["id"])
    realm["member_count"] = await db.community_memberships.count_documents({
        "community_type": "realm", "community_id": realm["id"],
    })
    return realm


class RealmCreate(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    description: Optional[str] = Field(default=None, max_length=400)
    banner: Optional[str] = None
    accent: Optional[str] = "#10E670"
    tags: list[str] = []
    privacy: str = "public"


@router.post("/communities/realms")
async def create_realm(payload: RealmCreate, current: CurrentUser):
    slug = (payload.name or "").strip().lower().replace(" ", "-")[:60]
    rid = uuid.uuid4().hex[:12]
    now = _now_iso()
    doc = {
        "id":             rid,
        "slug":           slug,
        "name":           payload.name.strip(),
        "description":    (payload.description or "").strip() or None,
        "banner":         payload.banner,
        "accent":         payload.accent or "#10E670",
        "tags":           payload.tags or [],
        "privacy":        payload.privacy if payload.privacy in {"public", "private", "invite_only"} else "public",
        "owner_id":       current["id"],
        "admin_ids":      [current["id"]],
        "created_at":     now,
        "updated_at":     now,
        "member_count_estimate": 1,
    }
    await db.realms.insert_one(doc)
    doc.pop("_id", None)
    # Auto-join the creator as owner.
    await db.community_memberships.insert_one({
        "community_type": "realm", "community_id": rid,
        "user_id": current["id"], "role": "owner", "joined_at": now,
        "favorite": True,
    })
    # Default "General Chat".
    chat = {
        "id":             uuid.uuid4().hex,
        "community_type": "realm",
        "community_id":   rid,
        "title":          "General Chat",
        "is_main":        True,
        "created_at":     now,
        "updated_at":     now,
    }
    await db.community_chats.insert_one(chat)
    # Phase 2 — default Poll widget for every new realm.
    widget = {
        "id":             uuid.uuid4().hex,
        "community_type": "realm",
        "community_id":   rid,
        "type":           "poll",
        "config": {
            "question": "What should we do this Friday?",
            "options": [
                {"id": uuid.uuid4().hex, "label": "🎮 Game Night"},
                {"id": uuid.uuid4().hex, "label": "🎬 Movie Watch Party"},
                {"id": uuid.uuid4().hex, "label": "🎙️ Live Podcast"},
            ],
        },
        "size":      "medium", "pinned": False, "collapsed": False, "position": 0,
        "created_by": current["id"], "created_at": now, "updated_at": now,
    }
    await db.community_widgets.insert_one(widget)
    return {**doc, "_main_chat_id": chat["id"], "_poll_widget_id": widget["id"]}


class RealmUpdate(BaseModel):
    name:          Optional[str]       = Field(default=None, min_length=2, max_length=60)
    description:   Optional[str]       = Field(default=None, max_length=400)
    banner:        Optional[str]       = None
    profile_image: Optional[str]       = None
    accent:        Optional[str]       = None
    tags:          Optional[list[str]] = None
    privacy:       Optional[str]       = None
    rules:         Optional[str]       = Field(default=None, max_length=4000)


@router.patch("/communities/realms/{id_or_slug}")
async def update_realm(id_or_slug: str, payload: RealmUpdate, current: CurrentUser):
    """Owner / founder / admin only — partial update of realm metadata.

    Touches ONLY the realm doc itself. Member lists, posts, widgets,
    chats, permissions, and other realm-scoped data are preserved.
    """
    realm = await _load_community("realm", id_or_slug)
    if not realm:
        raise HTTPException(404, "Realm not found")
    if not _is_admin(realm, current):
        raise HTTPException(403, "Owner or admin only")

    updates: dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if payload.description is not None:
        updates["description"] = (payload.description or "").strip() or None
    if payload.banner is not None:
        updates["banner"] = payload.banner or None
    if payload.profile_image is not None:
        updates["profile_image"] = payload.profile_image or None
    if payload.accent is not None:
        updates["accent"] = payload.accent or "#10E670"
    if payload.tags is not None:
        updates["tags"] = [t.strip() for t in payload.tags if (t or "").strip()][:20]
    if payload.privacy is not None:
        if payload.privacy not in {"public", "private", "invite_only"}:
            raise HTTPException(400, "privacy must be public | private | invite_only")
        updates["privacy"] = payload.privacy
    if payload.rules is not None:
        updates["rules"] = (payload.rules or "").strip() or None

    if not updates:
        return {**realm, "online_count": await _online_count("realm", realm["id"])}

    updates["updated_at"] = _now_iso()
    await db.realms.update_one({"id": realm["id"]}, {"$set": updates})

    # Audit log — keep edits traceable.
    try:
        await db.audit_log.insert_one({
            "id":         uuid.uuid4().hex,
            "action":     "realm.update",
            "actor_id":   current["id"],
            "actor_user": current.get("username"),
            "realm_id":   realm["id"],
            "fields":     list(updates.keys()),
            "at":         _now_iso(),
        })
    except Exception:  # pylint: disable=broad-except
        logger.exception("[communities] audit log insert failed for realm.update")

    refreshed = await db.realms.find_one({"id": realm["id"]}, {"_id": 0})
    return {
        **(refreshed or {}),
        "online_count": await _online_count("realm", realm["id"]),
        "member_count": await db.community_memberships.count_documents({
            "community_type": "realm", "community_id": realm["id"],
        }),
    }


@router.delete("/communities/realms/{id_or_slug}")
async def delete_realm(id_or_slug: str, current: CurrentUser):
    """Owner / founder / admin only — permanent cascading delete.

    Hard-deletes the realm itself, all memberships, chats, messages,
    widgets, polls, hub posts, notifications, and audit refs scoped
    to the realm. Idempotent: a second call on the same id returns
    404 cleanly.
    """
    realm = await _load_community("realm", id_or_slug)
    if not realm:
        raise HTTPException(404, "Realm not found")
    if not _is_admin(realm, current):
        raise HTTPException(403, "Owner or admin only")

    rid = realm["id"]

    # 1. Collect chat ids first so we can fan out their messages.
    chat_ids = [c["id"] async for c in db.community_chats.find(
        {"community_type": "realm", "community_id": rid},
        {"_id": 0, "id": 1},
    )]

    # 2. Cascading deletes. Each step swallows its own errors so a
    #    partial failure on a non-critical collection doesn't strand
    #    the realm in a half-deleted state.
    deletes_summary: dict[str, int] = {}

    async def _safe_delete(coll, filt, key):
        try:
            res = await coll.delete_many(filt)
            deletes_summary[key] = res.deleted_count
        except Exception:  # pylint: disable=broad-except
            logger.exception("[communities] delete cascade failed for %s", key)
            deletes_summary[key] = -1

    await _safe_delete(db.community_messages,    {"chat_id": {"$in": chat_ids}}, "messages")
    await _safe_delete(db.community_chats,       {"community_type": "realm", "community_id": rid}, "chats")
    await _safe_delete(db.community_widgets,    {"community_type": "realm", "community_id": rid}, "widgets")
    await _safe_delete(db.community_hub_posts,  {"realm_id": rid},   "hub_posts")
    await _safe_delete(db.community_memberships,{"community_type": "realm", "community_id": rid}, "memberships")
    await _safe_delete(db.realm_invites,        {"realm_id": rid},    "invites")
    await _safe_delete(db.notifications,        {"realm_id": rid},   "notifications")
    await _safe_delete(db.poll_votes,           {"realm_id": rid},   "poll_votes")
    # Finally drop the realm itself.
    res = await db.realms.delete_one({"id": rid})
    deletes_summary["realm"] = res.deleted_count

    # Audit log — survives the delete cascade because audit_log isn't
    # filtered by realm_id here.
    try:
        await db.audit_log.insert_one({
            "id":         uuid.uuid4().hex,
            "action":     "realm.delete",
            "actor_id":   current["id"],
            "actor_user": current.get("username"),
            "realm_id":   rid,
            "realm_name": realm.get("name"),
            "summary":    deletes_summary,
            "at":         _now_iso(),
        })
    except Exception:  # pylint: disable=broad-except
        logger.exception("[communities] audit log insert failed for realm.delete")

    return {"ok": True, "deleted": rid, "summary": deletes_summary}


# --------------------------------------------------------------------- #
# Group endpoints — private mini-Realms.
# --------------------------------------------------------------------- #
@router.get("/communities/groups")
async def list_my_groups(current: CurrentUser):
    """Only groups the caller is a member of (groups are private by default)."""
    memberships = db.community_memberships.find(
        {"user_id": current["id"], "community_type": "group"},
        {"_id": 0, "community_id": 1, "favorite": 1, "role": 1},
    )
    ids = [m async for m in memberships]
    if not ids:
        return {"groups": []}
    cursor = db.groups.find({"id": {"$in": [m["community_id"] for m in ids]}}, {"_id": 0})
    out = [g async for g in cursor]
    by_id = {m["community_id"]: m for m in ids}
    for g in out:
        m = by_id.get(g["id"], {})
        g["favorite"] = m.get("favorite", False)
        g["role"] = m.get("role", "member")
    return {"groups": out}


@router.get("/communities/groups/{group_id}")
async def get_group(group_id: str, current: CurrentUser):
    group = await db.groups.find_one({"id": group_id}, {"_id": 0})
    if not group:
        raise HTTPException(404, "Group not found")
    membership = await _ensure_member("group", group_id, current["id"])
    if not membership and not _is_admin(group, current):
        raise HTTPException(403, "Members only")
    group["online_count"] = await _online_count("group", group_id)
    group["member_count"] = await db.community_memberships.count_documents({
        "community_type": "group", "community_id": group_id,
    })
    return group


class GroupCreate(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    description: Optional[str] = Field(default=None, max_length=400)
    privacy: str = "invite_only"
    tags: list[str] = []
    accent: Optional[str] = "#10E670"


@router.post("/communities/groups")
async def create_group(payload: GroupCreate, current: CurrentUser):
    gid = uuid.uuid4().hex[:12]
    now = _now_iso()
    doc = {
        "id":          gid,
        "name":        payload.name.strip(),
        "description": (payload.description or "").strip() or None,
        "accent":      payload.accent or "#10E670",
        "tags":        payload.tags or [],
        "privacy":     payload.privacy if payload.privacy in {"private", "invite_only"} else "invite_only",
        "owner_id":    current["id"],
        "admin_ids":   [current["id"]],
        "invite_code": uuid.uuid4().hex[:10],
        "created_at":  now,
        "updated_at":  now,
    }
    await db.groups.insert_one(doc)
    doc.pop("_id", None)
    await db.community_memberships.insert_one({
        "community_type": "group", "community_id": gid,
        "user_id": current["id"], "role": "owner", "joined_at": now,
        "favorite": True,
    })
    chat = {
        "id":             uuid.uuid4().hex,
        "community_type": "group",
        "community_id":   gid,
        "title":          "General Chat",
        "is_main":        True,
        "created_at":     now,
        "updated_at":     now,
    }
    await db.community_chats.insert_one(chat)
    return {**doc, "_main_chat_id": chat["id"]}


# --------------------------------------------------------------------- #
# Membership
# --------------------------------------------------------------------- #
@router.post("/communities/{community_type}/{community_id}/join")
async def join_community(community_type: str, community_id: str, current: CurrentUser):
    if community_type not in {"realm", "group"}:
        raise HTTPException(400, "type must be realm or group")
    community = await _load_community(community_type, community_id)
    if not community:
        raise HTTPException(404, "Community not found")
    # Groups are invite-only by default — `join` only works if the
    # group has been explicitly marked as public, or the caller is
    # already an admin (e.g. accepted an invite).
    if community_type == "group" and community.get("privacy") in {"invite_only", "private"} and not _is_admin(community, current):
        raise HTTPException(403, "Group is invite-only")
    existing = await _ensure_member(community_type, community["id"], current["id"])
    if existing:
        return {"ok": True, "already_member": True}
    await db.community_memberships.insert_one({
        "community_type": community_type,
        "community_id":   community["id"],
        "user_id":        current["id"],
        "role":           "member",
        "joined_at":      _now_iso(),
        "favorite":       False,
    })
    return {"ok": True, "joined": True}


@router.post("/communities/{community_type}/{community_id}/leave")
async def leave_community(community_type: str, community_id: str, current: CurrentUser):
    if community_type not in {"realm", "group"}:
        raise HTTPException(400, "type must be realm or group")
    community = await _load_community(community_type, community_id)
    if not community:
        raise HTTPException(404, "Community not found")
    # Owners cannot leave their own community — they must transfer or delete it.
    if community.get("owner_id") == current["id"]:
        raise HTTPException(400, "Owners cannot leave their own community")
    res = await db.community_memberships.delete_one({
        "community_type": community_type,
        "community_id":   community["id"],
        "user_id":        current["id"],
    })
    return {"ok": True, "removed": res.deleted_count}


@router.patch("/communities/{community_type}/{community_id}/favorite")
async def toggle_favorite(community_type: str, community_id: str, current: CurrentUser):
    community = await _load_community(community_type, community_id)
    if not community:
        raise HTTPException(404, "Community not found")
    m = await _ensure_member(community_type, community["id"], current["id"])
    if not m:
        raise HTTPException(403, "Members only")
    new_val = not m.get("favorite", False)
    await db.community_memberships.update_one(
        {"community_type": community_type, "community_id": community["id"], "user_id": current["id"]},
        {"$set": {"favorite": new_val}},
    )
    return {"ok": True, "favorite": new_val}


@router.get("/communities/{community_type}/{community_id}/members")
async def list_members(
    community_type: str, community_id: str, current: CurrentUser,
    q: Optional[str] = None, limit: int = 50, after: Optional[str] = None,
):
    if community_type not in {"realm", "group"}:
        raise HTTPException(400, "type must be realm or group")
    community = await _load_community(community_type, community_id)
    if not community:
        raise HTTPException(404, "Community not found")
    # Realms are public for member browsing; groups require membership.
    if community_type == "group":
        m = await _ensure_member("group", community["id"], current["id"])
        if not m and not _is_admin(community, current):
            raise HTTPException(403, "Members only")
    filt = {"community_type": community_type, "community_id": community["id"]}
    if after:
        filt["joined_at"] = {"$gt": after}
    cursor = db.community_memberships.find(filt, {"_id": 0}).sort("joined_at", 1).limit(min(limit, 200))
    raw = [m async for m in cursor]
    cards = []
    for m in raw:
        card = await _project_member_card(m)
        if q:
            ql = q.lower()
            if ql not in ((card.get("username") or "").lower() + " " + (card.get("display_name") or "").lower()):
                continue
        cards.append(card)
    next_after = raw[-1]["joined_at"] if raw else None
    return {"members": cards, "next_after": next_after}


# --------------------------------------------------------------------- #
# Chats
# --------------------------------------------------------------------- #
@router.get("/communities/{community_type}/{community_id}/chats")
async def list_chats(community_type: str, community_id: str, current: CurrentUser):
    if community_type not in {"realm", "group"}:
        raise HTTPException(400, "type must be realm or group")
    community = await _load_community(community_type, community_id)
    if not community:
        raise HTTPException(404, "Community not found")
    # Anyone can read realm chat list (realms are public); groups require membership.
    if community_type == "group":
        m = await _ensure_member("group", community["id"], current["id"])
        if not m and not _is_admin(community, current):
            raise HTTPException(403, "Members only")
    cursor = db.community_chats.find(
        {"community_type": community_type, "community_id": community["id"]},
        {"_id": 0},
    ).sort("is_main", -1)
    return {"chats": [c async for c in cursor]}


class ChatPatch(BaseModel):
    title: Optional[str] = Field(default=None, max_length=50)
    description: Optional[str] = Field(default=None, max_length=200)
    welcome_message: Optional[str] = Field(default=None, max_length=400)
    pinned_message_id: Optional[str] = None


@router.patch("/communities/{community_type}/{community_id}/chats/{chat_id}")
async def patch_chat(
    community_type: str, community_id: str, chat_id: str,
    payload: ChatPatch, current: CurrentUser,
):
    community = await _load_community(community_type, community_id)
    if not community:
        raise HTTPException(404, "Community not found")
    if not _is_admin(community, current):
        raise HTTPException(403, "Admin only")
    update = {}
    if payload.title is not None:
        t = payload.title.strip()
        if not (1 <= len(t) <= 50):
            raise HTTPException(400, "Title must be 1–50 chars")
        update["title"] = t
    if payload.description is not None:
        update["description"] = payload.description.strip() or None
    if payload.welcome_message is not None:
        update["welcome_message"] = payload.welcome_message.strip() or None
    if payload.pinned_message_id is not None:
        update["pinned_message_id"] = payload.pinned_message_id or None
    if not update:
        return {"ok": True, "noop": True}
    update["updated_at"] = _now_iso()
    res = await db.community_chats.update_one({"id": chat_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Chat not found")
    # Broadcast title change so members see it live.
    await room_broadcast(chat_id, {"type": "chat:updated", "chat_id": chat_id, "patch": update})
    fresh = await db.community_chats.find_one({"id": chat_id}, {"_id": 0})
    return fresh


# --------------------------------------------------------------------- #
# Messages
# --------------------------------------------------------------------- #
@router.get("/community-chats/{chat_id}/messages")
async def list_messages(
    chat_id: str, current: CurrentUser,
    before: Optional[str] = None, limit: int = 50,
):
    chat = await db.community_chats.find_one({"id": chat_id}, {"_id": 0})
    if not chat:
        raise HTTPException(404, "Chat not found")
    # Group chats need membership; realms allow anyone authenticated to read.
    if chat["community_type"] == "group":
        m = await _ensure_member("group", chat["community_id"], current["id"])
        if not m:
            community = await _load_community("group", chat["community_id"])
            if not _is_admin(community or {}, current):
                raise HTTPException(403, "Members only")
    filt = {"chat_id": chat_id, "deleted_at": {"$exists": False}}
    if before:
        filt["created_at"] = {"$lt": before}
    cursor = db.community_messages.find(filt, {"_id": 0}).sort("created_at", -1).limit(min(limit, 200))
    msgs = [m async for m in cursor]
    msgs.reverse()  # ascending for the UI
    return {"messages": msgs}


class MessagePayload(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    attachments: list[dict] = []


@router.post("/community-chats/{chat_id}/messages")
async def send_message(chat_id: str, payload: MessagePayload, current: CurrentUser):
    chat = await db.community_chats.find_one({"id": chat_id}, {"_id": 0})
    if not chat:
        raise HTTPException(404, "Chat not found")
    if chat["community_type"] == "group":
        m = await _ensure_member("group", chat["community_id"], current["id"])
        if not m:
            community = await _load_community("group", chat["community_id"])
            if not _is_admin(community or {}, current):
                raise HTTPException(403, "Members only")
    msg = {
        "id":           uuid.uuid4().hex,
        "chat_id":      chat_id,
        "community_type": chat["community_type"],
        "community_id":   chat["community_id"],
        "user_id":      current["id"],
        "username":     current.get("username"),
        "avatar_url":   current.get("avatar_url"),
        "display_name": current.get("display_name") or current.get("username"),
        "body":         payload.body.strip(),
        "attachments":  payload.attachments or [],
        "created_at":   _now_iso(),
    }
    await db.community_messages.insert_one(msg)
    msg.pop("_id", None)
    await room_broadcast(chat_id, {"type": "message:new", "message": msg})
    return msg


# --------------------------------------------------------------------- #
# Realtime — community chat WebSocket
# --------------------------------------------------------------------- #
async def _ws_auth(ws: WebSocket) -> Optional[dict]:
    token = ws.query_params.get("token") or ws.cookies.get("access_token")
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
    return await db.users.find_one({"id": payload["sub"]}, {"_id": 0})


@router.websocket("/ws/community-chat/{chat_id}")
async def community_chat_socket(ws: WebSocket, chat_id: str):
    await ws.accept()
    user = await _ws_auth(ws)
    if not user:
        return
    # Auth-gate: ensure chat exists + (for groups) caller is a member.
    chat = await db.community_chats.find_one({"id": chat_id}, {"_id": 0})
    if not chat:
        await ws.close(code=4404)
        return
    if chat["community_type"] == "group":
        m = await _ensure_member("group", chat["community_id"], user["id"])
        if not m:
            community = await _load_community("group", chat["community_id"])
            if not _is_admin(community or {}, user):
                await ws.close(code=4403)
                return
    await room_join(chat_id, user["id"], ws)
    try:
        await ws.send_json({"type": "chat:hello", "chat_id": chat_id})
        while True:
            try:
                msg = await ws.receive_json()
            except WebSocketDisconnect:
                break
            kind = msg.get("type") or msg.get("event")
            if kind in {"ping", "heartbeat"}:
                await ws.send_json({"type": "pong"})
                continue
            if kind == "typing":
                await room_broadcast(chat_id, {
                    "type": "typing",
                    "user_id":  user["id"],
                    "username": user.get("username"),
                }, exclude_ws=ws)
                continue
            # Unknown messages ignored
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        logger.warning("community_chat ws error: %s", e)
    finally:
        await room_leave(chat_id, user["id"], ws)


# --------------------------------------------------------------------- #
# Misc helpers
# --------------------------------------------------------------------- #
async def _online_count(community_type: str, community_id: str) -> int:
    """Count members of this community who are currently in the
    presence registry. O(members) — fine for Phase 1 community sizes."""
    cursor = db.community_memberships.find(
        {"community_type": community_type, "community_id": community_id},
        {"_id": 0, "user_id": 1},
    )
    n = 0
    async for m in cursor:
        if presence_reg.is_online(m["user_id"]):
            n += 1
    return n
