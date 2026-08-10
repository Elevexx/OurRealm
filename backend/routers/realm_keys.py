"""Emerald Realm Key system — server-authoritative, idempotent key registry +
per-user ownership. One unique key per completed level; type/amount can never
be chosen by the browser. Forward-compatible: future WKQ titles may require
specific keys or a key count via the registry's `requirable` metadata."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser

log = logging.getLogger("ourrealm.realm_keys")
router = APIRouter(prefix="/api/realm-keys", tags=["realm-keys"])


def _iso():
    return datetime.now(timezone.utc).isoformat()


@router.get("/registry")
async def registry(current: CurrentUser, game_id: str = ""):
    q = {"active": True}
    if game_id:
        q["game_id"] = game_id
    items = await db.realm_keys.find(q, {"_id": 0}).sort("level_index", 1).to_list(200)
    return {"keys": items}


@router.post("/award")
async def award(body: dict, current: CurrentUser):
    game_id = str(body.get("game_id") or "")
    try:
        level_index = int(body.get("level_index"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="level_index required")
    reg = await db.realm_keys.find_one(
        {"game_id": game_id, "level_index": level_index, "active": True}, {"_id": 0})
    if not reg:
        raise HTTPException(status_code=404, detail="No Emerald Realm Key is registered for this level")
    existing = await db.user_realm_keys.find_one(
        {"user_id": current["id"], "key_id": reg["key_id"]}, {"_id": 0})
    if existing:
        return {"awarded": False, "already_owned": True, "key": reg}
    res = await db.user_realm_keys.update_one(
        {"user_id": current["id"], "key_id": reg["key_id"]},
        {"$setOnInsert": {
            "user_id": current["id"], "username": current.get("username"),
            "key_id": reg["key_id"], "game_id": game_id, "level_index": level_index,
            "series": reg.get("series"), "version": reg.get("version", 1),
            "awarded_at": _iso()}},
        upsert=True)
    awarded = bool(res.upserted_id)
    if awarded:
        log.info("realm-key awarded key=%s user=%s", reg["key_id"], current["id"])
    return {"awarded": awarded, "already_owned": not awarded, "key": reg}


@router.get("/mine")
async def mine(current: CurrentUser):
    owned = await db.user_realm_keys.find(
        {"user_id": current["id"]}, {"_id": 0}).sort("awarded_at", 1).to_list(500)
    return {"keys": owned, "count": len(owned)}
