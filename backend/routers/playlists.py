"""Bundle 1 — Personal Sound Playlist Foundation.

Private, user-owned organizational collections of canonical Sounds.
DB-level uniqueness prevents duplicate entries; deleting a playlist
NEVER deletes canonical Sounds. Limits come from core.config.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.config import MAX_PLAYLISTS_PER_USER, MAX_TRACKS_PER_PLAYLIST
from core.db import db
from core.deps import CurrentUser

log = logging.getLogger("ourrealm.playlists")
router = APIRouter(prefix="/api/playlists", tags=["playlists"])

_index_ready = False

RESTRICTED_STATUSES = ("rejected", "hidden", "removed", "suspended")


async def _ensure_indexes():
    global _index_ready
    if _index_ready:
        return
    await db.playlist_items.create_index(
        [("playlist_id", 1), ("track_id", 1)], unique=True)
    await db.playlists.create_index([("owner_id", 1)])
    _index_ready = True


def _now():
    return datetime.now(timezone.utc).isoformat()


class PlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class PlaylistPatch(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ItemBody(BaseModel):
    track_id: str


class ReorderBody(BaseModel):
    track_ids: List[str]


async def _owned(playlist_id: str, current: dict) -> dict:
    pl = await db.playlists.find_one({"id": playlist_id}, {"_id": 0})
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if pl["owner_id"] != current["id"]:
        raise HTTPException(status_code=403, detail="You can only manage your own playlists")
    return pl


async def _summary(pl: dict) -> dict:
    items = await db.playlist_items.count_documents({"playlist_id": pl["id"]})
    return {**pl, "item_count": items}


async def _check_addable(track_id: str, current: dict) -> dict:
    """Server-side reuse/permission gate for adding a Sound to a playlist."""
    track = await db.tracks.find_one(
        {"id": track_id},
        {"_id": 0, "id": 1, "user_id": 1, "visibility": 1,
         "deleted_at": 1, "moderation_status": 1})
    if not track or track.get("deleted_at"):
        raise HTTPException(status_code=410, detail="That Sound is no longer available")
    if track.get("moderation_status") in RESTRICTED_STATUSES:
        raise HTTPException(status_code=403, detail="That Sound is restricted and can't be added right now")
    if track.get("visibility") != "public" and track.get("user_id") != current["id"]:
        raise HTTPException(status_code=403, detail="That Sound is private — only its owner can add it to a playlist")
    return track


@router.post("")
async def create_playlist(body: PlaylistCreate, current: CurrentUser):
    await _ensure_indexes()
    owned = await db.playlists.count_documents({"owner_id": current["id"]})
    if owned >= MAX_PLAYLISTS_PER_USER:
        raise HTTPException(
            status_code=409,
            detail=f"Playlist limit reached ({MAX_PLAYLISTS_PER_USER} max)")
    doc = {
        "id": uuid.uuid4().hex, "owner_id": current["id"],
        "owner_username": current.get("username"),
        "name": body.name.strip(), "visibility": "private",
        "created_at": _now(), "updated_at": _now(),
    }
    await db.playlists.insert_one(doc)
    doc.pop("_id", None)
    return {"playlist": {**doc, "item_count": 0}}


@router.get("/mine")
async def my_playlists(current: CurrentUser):
    rows = await db.playlists.find({"owner_id": current["id"]},
                                   {"_id": 0}).sort("created_at", -1).to_list(MAX_PLAYLISTS_PER_USER)
    return {"playlists": [await _summary(p) for p in rows]}


@router.get("/containing/{track_id}")
async def playlists_containing(track_id: str, current: CurrentUser):
    rows = await db.playlists.find({"owner_id": current["id"]},
                                   {"_id": 0}).sort("created_at", -1).to_list(MAX_PLAYLISTS_PER_USER)
    member = {r["playlist_id"] async for r in db.playlist_items.find(
        {"track_id": track_id,
         "playlist_id": {"$in": [p["id"] for p in rows]}}, {"_id": 0, "playlist_id": 1})}
    return {"playlists": [{**await _summary(p), "has_track": p["id"] in member} for p in rows]}


@router.get("/{playlist_id}")
async def playlist_detail(playlist_id: str, current: CurrentUser):
    pl = await db.playlists.find_one({"id": playlist_id}, {"_id": 0})
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if pl["owner_id"] != current["id"]:
        raise HTTPException(status_code=403, detail="This playlist is private")
    items = await db.playlist_items.find({"playlist_id": playlist_id},
                                         {"_id": 0}).sort("position", 1).to_list(MAX_TRACKS_PER_PLAYLIST)
    tracks = {t["id"]: t async for t in db.tracks.find(
        {"id": {"$in": [i["track_id"] for i in items]}},
        {"_id": 0, "id": 1, "title": 1, "cover_url": 1, "file_url": 1, "category": 1,
         "genre": 1, "mood": 1, "duration_seconds": 1, "user_id": 1, "visibility": 1,
         "artist_username": 1, "deleted_at": 1, "moderation_status": 1})}
    out, total = [], 0.0
    for i in items:
        t = tracks.get(i["track_id"])
        unavailable = (not t or bool(t.get("deleted_at"))
                       or t.get("moderation_status") in RESTRICTED_STATUSES
                       or (t.get("visibility") != "public" and t.get("user_id") != pl["owner_id"]))
        if t and not unavailable:
            total += float(t.get("duration_seconds") or 0)
        out.append({"track_id": i["track_id"], "position": i.get("position", 0),
                    "added_at": i.get("added_at"), "unavailable": unavailable,
                    "track": None if unavailable else t})
    return {"playlist": {**pl, "item_count": len(items),
                         "total_duration_seconds": round(total, 1)}, "items": out}


@router.patch("/{playlist_id}")
async def rename_playlist(playlist_id: str, body: PlaylistPatch, current: CurrentUser):
    await _owned(playlist_id, current)
    await db.playlists.update_one(
        {"id": playlist_id},
        {"$set": {"name": body.name.strip(), "updated_at": _now()}})
    fresh = await db.playlists.find_one({"id": playlist_id}, {"_id": 0})
    return {"playlist": await _summary(fresh)}


@router.delete("/{playlist_id}")
async def delete_playlist(playlist_id: str, current: CurrentUser):
    """Deletes the playlist + its item rows. Canonical Sounds are NEVER
    deleted — items only reference tracks."""
    await _owned(playlist_id, current)
    await db.playlist_items.delete_many({"playlist_id": playlist_id})
    await db.playlists.delete_one({"id": playlist_id})
    return {"ok": True, "deleted": True}


@router.post("/{playlist_id}/items")
async def add_item(playlist_id: str, body: ItemBody, current: CurrentUser):
    await _ensure_indexes()
    await _owned(playlist_id, current)
    await _check_addable(body.track_id, current)
    pos = await db.playlist_items.count_documents({"playlist_id": playlist_id})
    if pos >= MAX_TRACKS_PER_PLAYLIST:
        raise HTTPException(
            status_code=409,
            detail=f"This playlist is full ({MAX_TRACKS_PER_PLAYLIST} Sounds max)")
    try:
        await db.playlist_items.insert_one({
            "playlist_id": playlist_id, "track_id": body.track_id,
            "position": pos, "added_at": _now()})
    except Exception:
        # unique (playlist_id, track_id) index — duplicate entry
        raise HTTPException(status_code=409, detail="That Sound is already in this playlist")
    await db.playlists.update_one({"id": playlist_id}, {"$set": {"updated_at": _now()}})
    return {"ok": True, "item_count": pos + 1}


@router.delete("/{playlist_id}/items/{track_id}")
async def remove_item(playlist_id: str, track_id: str, current: CurrentUser):
    await _owned(playlist_id, current)
    r = await db.playlist_items.delete_one({"playlist_id": playlist_id, "track_id": track_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="That Sound isn't in this playlist")
    await db.playlists.update_one({"id": playlist_id}, {"$set": {"updated_at": _now()}})
    return {"ok": True}


@router.patch("/{playlist_id}/items/reorder")
async def reorder_items(playlist_id: str, body: ReorderBody, current: CurrentUser):
    await _owned(playlist_id, current)
    for idx, tid in enumerate(body.track_ids):
        await db.playlist_items.update_one(
            {"playlist_id": playlist_id, "track_id": tid}, {"$set": {"position": idx}})
    await db.playlists.update_one({"id": playlist_id}, {"$set": {"updated_at": _now()}})
    return {"ok": True}
