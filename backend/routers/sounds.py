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
from fastapi.responses import FileResponse, StreamingResponse, Response

from core.db import db
from core.deps import CurrentUser
from core.geo import (
    ALLOWED_RADII, haversine_miles, parse_radius, resolve_zip,
)
from services.audio_store import (
    MAX_BYTES, audio_dir, is_safe_audio_filename, media_type_for_ext, save_audio,
)
from services.upload_limits import enforce_pre_upload, enforce_duration
from services.preferences import (
    bump as prefs_bump,
    summarise as prefs_summarise,
    personalization_active,
    boost as prefs_boost,
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
    # Centralized per-user caps (5 MB / 10-per-day / 60s for non-founder; @stealth exempt).
    await enforce_pre_upload(current, "audio", len(raw))

    try:
        rec = await save_audio(raw, current["id"], declared_mime=file.content_type, filename=file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Duration cap is enforced AFTER mutagen reads the file. If it's over,
    # delete the just-written file and surface a 400 so the user can re-encode.
    try:
        enforce_duration(current, "audio", rec.duration_seconds)
    except HTTPException:
        try:
            (audio_dir() / f"{rec.id}.{rec.ext}").unlink(missing_ok=True)
        except Exception:
            pass
        raise

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
async def serve(name: str, request: Request):
    if not is_safe_audio_filename(name):
        raise HTTPException(status_code=400, detail="Invalid audio name")
    path = audio_dir() / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    ext = name.rsplit(".", 1)[-1]
    media_type = media_type_for_ext(ext)
    file_size = path.stat().st_size

    # HTTP Range support — required by iOS Safari for scrub-seek on audio.
    # FastAPI's FileResponse does NOT honour Range on the installed
    # starlette version, so we parse it ourselves and return 206 with a
    # Content-Range header when the client asks for a slice.
    range_header = request.headers.get("range") or request.headers.get("Range")
    if range_header and range_header.startswith("bytes="):
        try:
            spec = range_header[6:].split(",")[0].strip()
            start_s, end_s = (spec.split("-") + [""])[:2]
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else file_size - 1
            if start < 0 or end >= file_size or start > end:
                raise ValueError("range out of bounds")
        except (ValueError, IndexError):
            return Response(
                status_code=416,
                headers={"Content-Range": f"bytes */{file_size}"},
            )
        length = end - start + 1

        def _stream():
            with path.open("rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            _stream(),
            status_code=206,
            media_type=media_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(length),
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        )

    headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Accept-Ranges": "bytes",
    }
    return FileResponse(path, media_type=media_type, headers=headers)


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
    q: Optional[str] = None,
    limit: int = 50,
):
    query: dict = {"is_ai_generated": False}
    if category and category != "All":
        query["category"] = category
    if genre and genre != "All":
        query["genre"] = genre
    if mood and mood != "Any":
        query["mood"] = mood
    # Phase 4B — case-insensitive search across title + genre
    if q and q.strip():
        import re as _re
        term = _re.escape(q.strip())
        query["$or"] = [
            {"title": {"$regex": term, "$options": "i"}},
            {"genre": {"$regex": term, "$options": "i"}},
        ]

    cursor = db.tracks.find(query).limit(max(1, min(int(limit), 200)))
    items = [doc async for doc in cursor]

    # Base sort per chart selection
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
    # Bump radius preference signal (Phase 4B)
    if radius and radius != "any":
        await prefs_bump(current["id"], radius=str(radius), signal="play")

    # ── Phase 4B — Personalization (70% global / 30% user signal)
    items = await _apply_personalization(current["id"], items, chart=chart)

    return {"tracks": [_public(t, viewer_id=current["id"]) for t in items]}


async def _apply_personalization(user_id: str, items, chart: str = "Top 100"):
    """Phase 4B — Blend a 70% global ranking with 30% personal signal.

    Global rank stays the source of truth — we only re-order within the
    same shortlist. Anonymous-style charts (New Releases / Up & Coming)
    deliberately skip personalization to preserve their meaning.
    """
    if not items:
        return items
    if chart in ("New Releases", "Up & Coming"):
        return items
    summary = await prefs_summarise(user_id)
    if not personalization_active(summary):
        return items
    # Pre-compute the max global score for normalisation
    scored = [(t, _score(t)) for t in items]
    max_score = max((s for _, s in scored), default=0) or 1
    blended = []
    for t, s in scored:
        global_norm = s / max_score
        personal = prefs_boost(t, summary)
        # 70/30 blend
        rank_signal = 0.7 * global_norm + 0.3 * personal
        blended.append((t, rank_signal))
    blended.sort(key=lambda kv: kv[1], reverse=True)
    return [t for t, _ in blended]


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
    q: Optional[str] = None,
    page: int = 1,
):
    page = max(1, min(int(page or 1), 5))
    query: dict = {"is_ai_generated": False}
    if category and category != "All":
        query["category"] = category
    if genre and genre != "All":
        query["genre"] = genre
    if mood and mood != "Any":
        query["mood"] = mood
    if q and q.strip():
        import re as _re
        term = _re.escape(q.strip())
        query["$or"] = [
            {"title": {"$regex": term, "$options": "i"}},
            {"genre": {"$regex": term, "$options": "i"}},
        ]

    # Always fetch the engagement-sorted top 200 then narrow down — keeps
    # the ranking stable across filter combinations without an expensive
    # aggregation.
    cursor = db.tracks.find(query).limit(200)
    items = [doc async for doc in cursor]
    items.sort(key=_score, reverse=True)

    miles = parse_radius(radius)
    viewer_geo = await _viewer_geo(current)
    items = _apply_radius(items, viewer_geo, miles)
    if radius and radius != "any":
        await prefs_bump(current["id"], radius=str(radius), signal="play")

    # ── Phase 4B — Personalization (70/30) — applied BEFORE truncation so
    # tracks ranked just outside top-100 globally can surface when they
    # match user preferences strongly.
    items = await _apply_personalization(current["id"], items, chart="Top 100")

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
    track = await db.tracks.find_one(
        {"id": track_id}, {"_id": 0, "plays": 1, "category": 1, "genre": 1, "mood": 1}
    )
    # Phase 4B — personalization signal
    if track:
        await prefs_bump(
            current["id"],
            category=track.get("category"),
            genre=track.get("genre"),
            mood=track.get("mood"),
            signal="play",
        )
    return {"ok": True, "plays": (track or {}).get("plays", 0)}


@router.post("/{track_id}/like")
async def like_track(track_id: str, current: CurrentUser):
    uid = current["id"]
    track = await db.tracks.find_one(
        {"id": track_id},
        {"_id": 0, "liked_by": 1, "likes": 1, "category": 1, "genre": 1, "mood": 1},
    )
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
    # Phase 4B — personalization signal (stronger weight than play)
    await prefs_bump(
        uid,
        category=track.get("category"),
        genre=track.get("genre"),
        mood=track.get("mood"),
        signal="like",
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


@router.get("/me/personalized")
async def my_personalization_status(current: CurrentUser):
    """Phase 4B follow-up — drives the 'Made for You' rail visibility.
    Active once the user has crossed the engagement threshold.
    """
    summary = await prefs_summarise(current["id"])
    return {
        "active": personalization_active(summary),
        "total_plays": summary.get("total_plays", 0),
        "total_likes": summary.get("total_likes", 0),
    }
