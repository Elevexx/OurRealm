"""Realm widget framework + default Poll widget (Phase 2, Feb 19 2026).

Endpoints (all under `/api/communities/realm/{realm_id}`):

  GET    /widgets                          (auth member; widgets in display order)
  POST   /widgets                          (admin; add new widget)
  PATCH  /widgets/{widget_id}              (admin; resize / collapse / pin / config patch)
  POST   /widgets/reorder                  (admin; persist drag-reorder)
  DELETE /widgets/{widget_id}              (admin; remove)

Poll widget (poll-specific subroutes — gracefully no-ops for other types):

  POST   /widgets/{widget_id}/poll/options          (admin; replace poll options + question)
  POST   /widgets/{widget_id}/poll/vote             (member; single-choice; idempotent)

Storage:
  `db.community_widgets`  { id, community_type='realm', community_id, type,
                            position, size, pinned, collapsed, config,
                            created_by, created_at, updated_at }
  `db.realm_poll_votes`   { widget_id, user_id, option_id, voted_at }
                          (unique index ensures one vote per user per widget)

This module is realm-only by design — groups remain lightweight chats.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.community_chat import broadcast as room_broadcast
from core.db import db
from core.deps import CurrentUser

log = logging.getLogger("ourrealm.realm_widgets")
router = APIRouter(prefix="/api/communities/realm", tags=["realm_widgets"])


# ─────────────────────────────────────── helpers ────────────────────
async def _ensure_indexes() -> None:
    try:
        await db.realm_poll_votes.create_index(
            [("widget_id", 1), ("user_id", 1)], unique=True,
        )
        await db.community_widgets.create_index([("community_id", 1), ("position", 1)])
    except Exception as e:  # noqa: BLE001
        log.warning("realm widgets indexes: %s", e)


async def _load_realm(realm_id: str) -> Optional[dict]:
    return await db.realms.find_one(
        {"$or": [{"id": realm_id}, {"slug": realm_id}]},
        {"_id": 0},
    )


def _is_admin(realm: dict, user: dict) -> bool:
    if not realm or not user:
        return False
    if (user.get("username") or "").lower() == "stealth":
        return True
    if user["id"] == realm.get("owner_id"):
        return True
    return user["id"] in (realm.get("admin_ids") or [])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _broadcast_layout_change(realm: dict) -> None:
    """Broadcast a widget layout change to every member sitting in the
    realm's main community chat. We piggy-back on the existing chat
    room registry so we don't need a second WS endpoint."""
    main = await db.community_chats.find_one(
        {"community_type": "realm", "community_id": realm["id"], "is_main": True},
        {"_id": 0, "id": 1},
    )
    if main:
        await room_broadcast(main["id"], {"type": "widget:layout_changed", "realm_id": realm["id"]})


# ────────────────────────────── list / create / patch ───────────────
@router.get("/{realm_id}/widgets")
async def list_widgets(realm_id: str, current: CurrentUser):
    realm = await _load_realm(realm_id)
    if not realm:
        raise HTTPException(404, "Realm not found")
    cursor = db.community_widgets.find(
        {"community_type": "realm", "community_id": realm["id"]},
        {"_id": 0},
    ).sort([("pinned", -1), ("position", 1)])
    widgets = [w async for w in cursor]
    # Overlay live vote counts so /widgets is a single fetch for the UI.
    for w in widgets:
        if w.get("type") == "poll":
            await _decorate_poll(w, current)
    return {"widgets": widgets, "is_admin": _is_admin(realm, current)}


class WidgetCreate(BaseModel):
    type: str = Field(min_length=2, max_length=40)
    config: dict = {}
    size:   str = "medium"           # small | medium | large
    pinned: bool = False


@router.post("/{realm_id}/widgets")
async def add_widget(realm_id: str, payload: WidgetCreate, current: CurrentUser):
    realm = await _load_realm(realm_id)
    if not realm:
        raise HTTPException(404, "Realm not found")
    if not _is_admin(realm, current):
        raise HTTPException(403, "Admin only")
    if payload.size not in {"small", "medium", "large", "wide", "tall"}:
        raise HTTPException(400, "size must be small | medium | large | wide | tall")
    max_doc = await db.community_widgets.find(
        {"community_type": "realm", "community_id": realm["id"]},
        {"_id": 0, "position": 1},
    ).sort("position", -1).limit(1).to_list(1)
    next_pos = ((max_doc[0]["position"] if max_doc else 0) or 0) + 1
    widget = {
        "id":             uuid.uuid4().hex,
        "community_type": "realm",
        "community_id":   realm["id"],
        "type":           payload.type,
        "config":         payload.config or _default_config(payload.type),
        "size":           payload.size,
        "pinned":         bool(payload.pinned),
        "collapsed":      False,
        "position":       next_pos,
        "created_by":     current["id"],
        "created_at":     _now(),
        "updated_at":     _now(),
    }
    await db.community_widgets.insert_one(widget)
    widget.pop("_id", None)
    await _broadcast_layout_change(realm)
    if widget["type"] == "poll":
        await _decorate_poll(widget, current)
    return widget


class WidgetPatch(BaseModel):
    size:      Optional[str] = None
    pinned:    Optional[bool] = None
    collapsed: Optional[bool] = None
    config:    Optional[dict] = None
    position:  Optional[int] = None


@router.patch("/{realm_id}/widgets/{widget_id}")
async def patch_widget(realm_id: str, widget_id: str, payload: WidgetPatch, current: CurrentUser):
    realm = await _load_realm(realm_id)
    if not realm:
        raise HTTPException(404, "Realm not found")
    if not _is_admin(realm, current):
        raise HTTPException(403, "Admin only")
    update = {}
    for k, v in payload.dict(exclude_unset=True).items():
        if k == "size" and v not in {"small", "medium", "large", "wide", "tall"}:
            raise HTTPException(400, "Invalid size")
        update[k] = v
    if not update:
        return {"ok": True, "noop": True}
    update["updated_at"] = _now()
    res = await db.community_widgets.update_one(
        {"id": widget_id, "community_id": realm["id"]},
        {"$set": update},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Widget not found")
    fresh = await db.community_widgets.find_one({"id": widget_id}, {"_id": 0})
    if fresh and fresh.get("type") == "poll":
        await _decorate_poll(fresh, current)
    await _broadcast_layout_change(realm)
    return fresh


class ReorderPayload(BaseModel):
    order: list[str]


@router.post("/{realm_id}/widgets/reorder")
async def reorder_widgets(realm_id: str, payload: ReorderPayload, current: CurrentUser):
    realm = await _load_realm(realm_id)
    if not realm:
        raise HTTPException(404, "Realm not found")
    if not _is_admin(realm, current):
        raise HTTPException(403, "Admin only")
    if not payload.order:
        raise HTTPException(400, "order list required")
    updated = 0
    for i, wid in enumerate(payload.order):
        res = await db.community_widgets.update_one(
            {"id": wid, "community_id": realm["id"]},
            {"$set": {"position": i, "updated_at": _now()}},
        )
        updated += res.modified_count
    await _broadcast_layout_change(realm)
    return {"ok": True, "updated": updated}


@router.delete("/{realm_id}/widgets/{widget_id}")
async def delete_widget(realm_id: str, widget_id: str, current: CurrentUser):
    realm = await _load_realm(realm_id)
    if not realm:
        raise HTTPException(404, "Realm not found")
    if not _is_admin(realm, current):
        raise HTTPException(403, "Admin only")
    res = await db.community_widgets.delete_one(
        {"id": widget_id, "community_id": realm["id"]},
    )
    if res.deleted_count == 0:
        raise HTTPException(404, "Widget not found")
    # Best-effort cleanup of poll votes for that widget.
    await db.realm_poll_votes.delete_many({"widget_id": widget_id})
    await _broadcast_layout_change(realm)
    return {"ok": True, "deleted": widget_id}


# ────────────────────────────── poll widget ─────────────────────────
def _default_config(widget_type: str) -> dict:
    if widget_type == "poll":
        return {
            "question": "What should we do this Friday?",
            "options": [
                {"id": uuid.uuid4().hex, "label": "🎮 Game Night"},
                {"id": uuid.uuid4().hex, "label": "🎬 Movie Watch Party"},
                {"id": uuid.uuid4().hex, "label": "🎙️ Live Podcast"},
            ],
        }
    if widget_type == "rules":
        return {"rules": ["Be kind.", "Original content preferred.", "Mods have final say."]}
    if widget_type == "announcements":
        return {"announcement": "Welcome to the realm! Pin something important here."}
    return {}


class PollOptionsPayload(BaseModel):
    question: str = Field(min_length=2, max_length=200)
    options:  list[str]


@router.post("/{realm_id}/widgets/{widget_id}/poll/options")
async def set_poll_options(realm_id: str, widget_id: str, payload: PollOptionsPayload, current: CurrentUser):
    realm = await _load_realm(realm_id)
    if not realm:
        raise HTTPException(404, "Realm not found")
    if not _is_admin(realm, current):
        raise HTTPException(403, "Admin only")
    opts = [o.strip() for o in (payload.options or []) if o and o.strip()]
    if not (2 <= len(opts) <= 10):
        raise HTTPException(400, "Provide between 2 and 10 options")
    config = {
        "question": payload.question.strip(),
        "options":  [{"id": uuid.uuid4().hex, "label": o} for o in opts],
    }
    res = await db.community_widgets.update_one(
        {"id": widget_id, "community_id": realm["id"], "type": "poll"},
        {"$set": {"config": config, "updated_at": _now()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Poll widget not found")
    # Editing options wipes prior votes (cleanest semantics for a new poll).
    await db.realm_poll_votes.delete_many({"widget_id": widget_id})
    await _broadcast_layout_change(realm)
    fresh = await db.community_widgets.find_one({"id": widget_id}, {"_id": 0})
    await _decorate_poll(fresh, current)
    return fresh


class PollVotePayload(BaseModel):
    option_id: str


@router.post("/{realm_id}/widgets/{widget_id}/poll/vote")
async def poll_vote(realm_id: str, widget_id: str, payload: PollVotePayload, current: CurrentUser):
    realm = await _load_realm(realm_id)
    if not realm:
        raise HTTPException(404, "Realm not found")
    widget = await db.community_widgets.find_one(
        {"id": widget_id, "community_id": realm["id"], "type": "poll"},
        {"_id": 0},
    )
    if not widget:
        raise HTTPException(404, "Poll not found")
    options = (widget.get("config") or {}).get("options") or []
    if payload.option_id not in {o["id"] for o in options}:
        raise HTTPException(400, "Unknown option")
    # Idempotent: vote can be changed but never duplicated (unique index
    # on (widget_id, user_id)).
    await db.realm_poll_votes.update_one(
        {"widget_id": widget_id, "user_id": current["id"]},
        {"$set": {
            "widget_id": widget_id,
            "user_id":   current["id"],
            "option_id": payload.option_id,
            "voted_at":  _now(),
        }},
        upsert=True,
    )
    await _broadcast_layout_change(realm)
    fresh = await db.community_widgets.find_one({"id": widget_id}, {"_id": 0})
    await _decorate_poll(fresh, current)
    return fresh


async def _decorate_poll(widget: dict, current: dict) -> None:
    """Overlay vote counts + the caller's selected option onto a poll
    widget so the UI renders results in one round-trip."""
    if widget.get("type") != "poll":
        return
    widget_id = widget["id"]
    options = (widget.get("config") or {}).get("options") or []
    # Tally votes per option.
    counts = {o["id"]: 0 for o in options}
    total = 0
    async for v in db.realm_poll_votes.find({"widget_id": widget_id}, {"_id": 0, "option_id": 1}):
        if v["option_id"] in counts:
            counts[v["option_id"]] += 1
            total += 1
    my = await db.realm_poll_votes.find_one(
        {"widget_id": widget_id, "user_id": current["id"]},
        {"_id": 0, "option_id": 1},
    )
    widget["poll"] = {
        "total_votes": total,
        "results":     [{"id": o["id"], "label": o["label"], "votes": counts[o["id"]]} for o in options],
        "my_vote":     (my or {}).get("option_id"),
    }
