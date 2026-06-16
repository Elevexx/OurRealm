"""Sounds router — audio uploads, feed, charts, plays, likes.

Reuses:
  - services.audio_store for storage + validation
  - core.geo for radius filtering (ALLOWED_RADII, radius_filter, resolve_zip)
  - The same author-zip stamping pattern as routers.posts

Endpoints:
  POST   /api/sounds/upload              (multipart file + form metadata)
  GET    /api/sounds/{name}              public file stream (Range support)
  GET    /api/sounds/feed                filtered list
  GET    /api/sounds/charts/top100       Top 100 with pagination 1..5 (20/page)
  POST   /api/sounds/{id}/play           increment plays
  POST   /api/sounds/{id}/like           like (idempotent)
  DELETE /api/sounds/{id}/like           unlike
  GET    /api/sounds/me/tracks           current user's uploads
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from core.db import db
from core.deps import CurrentUser
from core.geo import (
    ALLOWED_RADII, haversine_miles, parse_radius, resolve_zip,
)
from services.audio_store import (
    MAX_BYTES, audio_dir, is_safe_audio_filename, media_type_for_ext, save_audio,
)


router = APIRouter(prefix="/api/sounds", tags=["sounds"])

CATEGORIES = {"Music", "Podcasts", "FX"}     # AI is intentionally NOT uploadable
PAGE_SIZE = 20                                 # 5 pages × 20 = Top 100


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _public(track: dict, viewer_id: Optional[str] = None) -> dict:
    """Strip private fields & add `distance_miles` if available."""
    t = dict(track)
    t.pop("_id", None)
    t.pop("author_zip", None)
    lat = t.pop("author_lat", None)
    lng = t.pop("author_lng", None)
    if viewer_id and isinstance(t.get("liked_by"), list):
        t["liked"] = viewer_id in t["liked_by"]
    t.pop("liked_by", None)
    # Pass through for the feed query — radius filter uses these via lat/lng keys
    if lat is not None:
        t["author_lat"] = lat
    if lng is not None:
        t["author_lng"] = lng
    return t


def _score(track: dict) -> float:
    """Ranking score: plays + 3·likes (engagement-weighted).
    Future: comments, completions, shares.
    """
    return float(track.get("plays", 0) or 0) + 3.0 * float(track.get("likes", 0) or 0)


async def _viewer_geo(viewer):
    if not viewer:
        return None
    z = viewer.get("zip_code")
    lat = viewer.get("zip_lat")
    lng = viewer.get("zip_lng")
    if lat is not None and lng is not None:
        return float(lat), float(lng)
    if z:
        return resolve_zip(z)
    return None


def _apply_radius(items, viewer_geo, miles: Optional[int]):
    """Annotate distance_miles + filter by radius if both viewer and item have geo."""
    out = []
    for t in items:
        lat = t.get("author_lat")
        lng = t.get("author_lng")
        dist = None
        if viewer_geo and lat is not None and lng is not None:
            try:
                dist = haversine_miles(viewer_geo, (float(lat), float(lng)))
            except (TypeError, ValueError):
                dist = None
        if miles is not None:
            if dist is None:
                # Skip items we can't measure when a radius is requested
                continue
            if dist > miles:
                continue
        if dist is not None:
            t["distance_miles"] = round(dist, 1)
        t.pop("author_lat", None)
        t.pop("author_lng", None)
        out.append(t)
    return out


# ─────────────────────────────────────────────────────────────────────
# Upload
# ─────────────────────────────────────────────────────────────────────
@router.post("/upload")
async def upload_track(
    current: CurrentUser,
    file: UploadFile = File(...),
    title: str = Form(...),
    category: str = Form(...),
    genre: str = Form(""),
    mood: str = Form(""),
    cover_url: str = Form(""),
):
    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    if len(title) > 140:
        raise HTTPException(status_code=400, detail="Title is too long (max 140)")
    category = (category or "").strip()
    if category not in CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail="Category must be one of Music, Podcasts, FX (AI is not uploadable).",
        )
    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_BYTES // (1024*1024)} MB limit")

    try:
        rec = await save_audio(raw, current["id"], declared_mime=file.content_type, filename=file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    doc = {
        "id": rec.id,
        "user_id": current["id"],
        "title": title,
        "category": category,
        "genre": (genre or "").strip()[:60],
        "mood": (mood or "").strip()[:60],
        "duration_seconds": rec.duration_seconds,
        "file_url": f"/api/sounds/file/{rec.id}.{rec.ext}",
        "file_size": rec.bytes,
        "mime": rec.mime,
        "cover_url": (cover_url or "").strip() or None,
        # Geo SNAPSHOT (private — author_zip never returned)
        "author_zip": current.get("zip_code"),
        "author_lat": current.get("zip_lat"),
        "author_lng": current.get("zip_lng"),
        # Engagement counters
        "plays": 0,
        "likes": 0,
        "liked_by": [],
        # Future-proofing — kept as inert defaults
        "is_ai_generated": False,
        "live_room_id": None,
        "remix_parent_id": None,
        "playlist_ids": [],
        "created_at": rec.created_at,
    }
    await db.tracks.insert_one(doc)
    return {"track": _public(doc, viewer_id=current["id"])}


# ─────────────────────────────────────────────────────────────────────
# File serve  (must come BEFORE the parameterized routes so it matches)
# ─────────────────────────────────────────────────────────────────────
@router.get("/file/{name}")
async def serve(name: str):
    if not is_safe_audio_filename(name):
        raise HTTPException(status_code=400, detail="Invalid audio name")
    path = audio_dir() / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    ext = name.rsplit(".", 1)[-1]
    headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Accept-Ranges": "bytes",
    }
    # FastAPI's FileResponse handles HTTP Range requests automatically.
    return FileResponse(path, media_type=media_type_for_ext(ext), headers=headers)


# Compatibility — also serve under /api/sounds/{name} so the file_url stored
# in DB ("/api/sounds/{id}.{ext}") works directly.
# (Disabled — would shadow /feed, /charts/top100 etc. We use /file/{name} only.)


# ─────────────────────────────────────────────────────────────────────
# Feed (filtered list)
# ─────────────────────────────────────────────────────────────────────
@router.get("/feed", operation_id="sounds_feed")
async def feed(
    current: CurrentUser,
    category: Optional[str] = None,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
    chart: Optional[str] = "Top 100",
    radius: Optional[str] = None,
    limit: int = 50,
):
    q: dict = {"is_ai_generated": False}
    if category and category != "All":
        q["category"] = category
    if genre and genre != "All":
        q["genre"] = genre
    if mood and mood != "Any":
        q["mood"] = mood

    cursor = db.tracks.find(q).limit(max(1, min(int(limit), 200)))
    items = [doc async for doc in cursor]

    # Sort per chart selection
    if chart == "Trending":
        items.sort(key=lambda t: float(t.get("plays", 0)) * 0.7 + float(t.get("likes", 0)) * 3.0, reverse=True)
    elif chart == "New Releases":
        items.sort(key=lambda t: t.get("created_at") or "", reverse=True)
    elif chart == "Up & Coming":
        items.sort(key=lambda t: float(t.get("plays", 0)))
    else:
        # Top 100 / Editor's Picks / default
        items.sort(key=_score, reverse=True)

    miles = parse_radius(radius)
    viewer_geo = await _viewer_geo(current)
    items = _apply_radius(items, viewer_geo, miles)

    return {"tracks": [_public(t, viewer_id=current["id"]) for t in items]}


# ─────────────────────────────────────────────────────────────────────
# Top 100 charts with explicit pagination 1..5 (20 per page)
# ─────────────────────────────────────────────────────────────────────
@router.get("/charts/top100")
async def top100(
    current: CurrentUser,
    category: Optional[str] = None,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
    radius: Optional[str] = None,
    page: int = 1,
):
    page = max(1, min(int(page or 1), 5))
    q: dict = {"is_ai_generated": False}
    if category and category != "All":
        q["category"] = category
    if genre and genre != "All":
        q["genre"] = genre
    if mood and mood != "Any":
        q["mood"] = mood

    # Always fetch the engagement-sorted top 200 then narrow down — keeps
    # the ranking stable across filter combinations without an expensive
    # aggregation.
    cursor = db.tracks.find(q).limit(200)
    items = [doc async for doc in cursor]
    items.sort(key=_score, reverse=True)

    miles = parse_radius(radius)
    viewer_geo = await _viewer_geo(current)
    items = _apply_radius(items, viewer_geo, miles)

    items = items[:100]                 # never publish beyond rank 100
    start = (page - 1) * PAGE_SIZE
    end = start + PAGE_SIZE
    page_items = items[start:end]

    return {
        "tracks": [
            {**_public(t, viewer_id=current["id"]), "rank": start + i + 1}
            for i, t in enumerate(page_items)
        ],
        "page": page,
        "page_size": PAGE_SIZE,
        "total": len(items),
        "pages": 5,
    }


# ─────────────────────────────────────────────────────────────────────
# Engagement: plays + likes
# ─────────────────────────────────────────────────────────────────────
@router.post("/{track_id}/play")
async def increment_play(track_id: str, current: CurrentUser):
    res = await db.tracks.update_one({"id": track_id}, {"$inc": {"plays": 1}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Track not found")
    track = await db.tracks.find_one({"id": track_id}, {"plays": 1})
    return {"ok": True, "plays": (track or {}).get("plays", 0)}


@router.post("/{track_id}/like")
async def like_track(track_id: str, current: CurrentUser):
    uid = current["id"]
    track = await db.tracks.find_one({"id": track_id}, {"liked_by": 1})
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    if uid in (track.get("liked_by") or []):
        return {"ok": True, "liked": True, "likes": track.get("likes", 0)}
    await db.tracks.update_one(
        {"id": track_id},
        {"$addToSet": {"liked_by": uid}, "$inc": {"likes": 1}},
    )
    await db.track_likes.update_one(
        {"user_id": uid, "track_id": track_id},
        {"$set": {"user_id": uid, "track_id": track_id,
                  "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    updated = await db.tracks.find_one({"id": track_id}, {"likes": 1})
    return {"ok": True, "liked": True, "likes": (updated or {}).get("likes", 0)}


@router.delete("/{track_id}/like")
async def unlike_track(track_id: str, current: CurrentUser):
    uid = current["id"]
    track = await db.tracks.find_one({"id": track_id}, {"liked_by": 1})
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    if uid not in (track.get("liked_by") or []):
        return {"ok": True, "liked": False, "likes": track.get("likes", 0)}
    await db.tracks.update_one(
        {"id": track_id},
        {"$pull": {"liked_by": uid}, "$inc": {"likes": -1}},
    )
    await db.track_likes.delete_one({"user_id": uid, "track_id": track_id})
    updated = await db.tracks.find_one({"id": track_id}, {"likes": 1})
    return {"ok": True, "liked": False, "likes": max(0, (updated or {}).get("likes", 0))}


@router.get("/me/tracks")
async def my_tracks(current: CurrentUser, limit: int = 60):
    cursor = (
        db.tracks.find({"user_id": current["id"]})
        .sort("created_at", -1)
        .limit(min(max(1, limit), 200))
    )
    items = [doc async for doc in cursor]
    return {"tracks": [_public(t, viewer_id=current["id"]) for t in items]}
