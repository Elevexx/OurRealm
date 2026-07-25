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

from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.permissions import get_admin_role, ROLE_FOUNDER
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

# Phase α — Sound owner controls. Visibility values mirror posts so the
# UI can reuse the same chips. "private" is stored on the server; the UI
# surfaces it as "stealth". "custom" honours `custom_user_ids`.
VISIBILITY_VALUES = {"public", "friends", "private", "custom"}


def _normalise_visibility(raw: Optional[str]) -> str:
    v = (raw or "public").strip().lower()
    if v == "stealth":
        v = "private"
    return v if v in VISIBILITY_VALUES else "public"


def _can_view_track(track: dict, viewer: Optional[dict]) -> bool:
    """Visibility gate used by feed/detail lookups.

    public  → everyone
    friends → owner + accepted friends
    custom  → owner + ids in custom_user_ids
    private → owner only
    Founder (@stealth) can always view.
    """
    vis = _normalise_visibility(track.get("visibility"))
    owner_id = track.get("user_id")
    viewer_id = (viewer or {}).get("id")
    if vis == "public":
        return True
    if not viewer_id:
        return False
    if owner_id == viewer_id:
        return True
    if get_admin_role(viewer) == ROLE_FOUNDER:
        return True
    if vis == "private":
        return False
    if vis == "custom":
        return viewer_id in (track.get("custom_user_ids") or [])
    if vis == "friends":
        # Friend graph stored as user.friends (list of ids).
        owner_friends = set((viewer or {}).get("friends") or [])
        return owner_id in owner_friends
    return False


def _is_track_owner_or_founder(track: dict, user: dict) -> bool:
    if not track or not user:
        return False
    if track.get("user_id") == user.get("id"):
        return True
    return get_admin_role(user) == ROLE_FOUNDER


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
    # Phase α — surface ownership + visibility so the frontend can decide
    # whether to render the owner-controls menu. `custom_user_ids` is
    # only returned to the owner (to power the audience picker).
    is_owner = bool(viewer_id and viewer_id == t.get("user_id"))
    t["is_owner"] = is_owner
    t["visibility"] = _normalise_visibility(t.get("visibility"))
    if not is_owner:
        t.pop("custom_user_ids", None)
        # PART 5 — rights-confirmation record stays internal. Admins
        # read it via the admin endpoint below, never via the public
        # feed. Strip IP / UA / timestamps from non-owner responses.
        t.pop("rights_confirmation", None)
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
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(...),
    category: str = Form(...),
    genre: str = Form(""),
    mood: str = Form(""),
    cover_url: str = Form(""),
    # PART 5 — copyright rights confirmation. Backend enforces; never
    # trust the frontend gate alone.
    rights_confirmed: bool = Form(False),
    app_version: str = Form(""),
    classification_id: str = Form(""),
    caption: str = Form(""),
    visibility: str = Form("public"),
    # For You composer uploads defer the canonical post to the SHARE step
    # (create_post marks it canonical) so caption/hashtags/audience land
    # on the one shared record.
    defer_post: bool = Form(False),
):
    if not rights_confirmed:
        raise HTTPException(
            status_code=400,
            detail=(
                "You must confirm you own the rights to this audio or have "
                "permission to upload it."
            ),
        )
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
    # Centralized per-user caps (50 MB / 10-per-day / 10 min for non-founder; @stealth exempt).
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
        # Use whatever URL `save_audio` returned — that's already
        # R2-mirrored when STORAGE_PROVIDER=r2, and stays the legacy
        # /api/sounds/file/... when local. Keeps existing /api routes
        # functional as a fallback for old DB rows.
        "file_url": rec.file_url,
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
        # Phase α — owner visibility controls (mirrors post audience model)
        "visibility": "public",
        "custom_user_ids": [],
        # PART 5 — copyright rights confirmation record. Stored on the
        # track doc so admins/moderators can verify the user accepted
        # the rights statement at upload time.
        "rights_confirmation": {
            "accepted":    True,
            "user_id":     current["id"],
            "accepted_at": datetime.now(timezone.utc).isoformat(),
            "app_version": (app_version or "").strip()[:60] or None,
            "client_ip":   (request.client.host if request.client else None),
            "user_agent":  (request.headers.get("user-agent") or "")[:240] or None,
        },
        "created_at": rec.created_at,
    }
    from services import sound_posts as sp
    cid = (classification_id or "").strip() or sp.classification_id_for_category(category)
    valid_ids = {c["id"] for c in await sp.list_classifications()}
    doc["classification_id"] = cid if cid in valid_ids else "other"
    doc["visibility"] = _normalise_visibility(visibility)
    await db.tracks.insert_one(doc)
    doc.pop("_id", None)
    post = None
    if not defer_post:
        post = await sp.create_canonical_post(doc, current, caption=caption,
                                              source_composer="sounds")
    out = _public(doc, viewer_id=current["id"])
    if post:
        out["post"] = {"id": post["id"], "fire_total": 0, "fire_count": 0,
                       "comments": 0, "audience": post.get("audience"),
                       "sound_classification_id": post.get("sound_classification_id")}
    return {"track": out}


@router.get("/classifications")
async def sound_classifications():
    """Shared classification list — both composers load from here."""
    from services import sound_posts as sp
    return {"classifications": await sp.list_classifications()}


class ClassificationPatch(BaseModel):
    name: Optional[str] = Field(default=None, max_length=60)
    active: Optional[bool] = None
    order: Optional[int] = None


@router.patch("/admin/classifications/{cid}")
async def admin_patch_classification(cid: str, payload: ClassificationPatch, current: CurrentUser):
    """Founder rename — existing sound posts keep the stable id and pick
    up the new display name automatically."""
    if get_admin_role(current) != ROLE_FOUNDER:
        raise HTTPException(status_code=403, detail="Founder access only")
    set_ops = {}
    if payload.name is not None and payload.name.strip():
        set_ops["name"] = payload.name.strip()
    if payload.active is not None:
        set_ops["active"] = bool(payload.active)
    if payload.order is not None:
        set_ops["order"] = int(payload.order)
    if not set_ops:
        raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.sound_classifications.update_one({"id": cid}, {"$set": set_ops})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Classification not found")
    from services import sound_posts as sp
    return {"classifications": await sp.list_classifications(force=True)}


# ─────────────────────────────────────────────────────────────────────
# Phase α — Owner edit / delete / visibility
# ─────────────────────────────────────────────────────────────────────
class TrackUpdatePayload(BaseModel):
    title:           Optional[str] = Field(default=None, max_length=140)
    category:        Optional[str] = None
    genre:           Optional[str] = Field(default=None, max_length=60)
    mood:            Optional[str] = Field(default=None, max_length=60)
    cover_url:       Optional[str] = Field(default=None, max_length=1024)
    visibility:      Optional[str] = None     # public | friends | private | custom | stealth
    custom_user_ids: Optional[list[str]] = None


@router.patch("/{track_id}")
async def update_track(track_id: str, payload: TrackUpdatePayload, current: CurrentUser):
    track = await db.tracks.find_one({"id": track_id})
    if not track:
        raise HTTPException(status_code=404, detail="Sound not found")
    # Only the owner may edit metadata / visibility. Founder admins have
    # delete power (below) but do NOT silently rewrite other users'
    # sound metadata — matches the posts router contract.
    if track.get("user_id") != current.get("id"):
        raise HTTPException(status_code=403, detail="Only the owner can edit this sound")

    set_ops: dict = {}
    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        set_ops["title"] = title[:140]
    if payload.category is not None:
        if payload.category not in CATEGORIES:
            raise HTTPException(status_code=400, detail="Category must be one of Music, Podcasts, FX")
        set_ops["category"] = payload.category
    if payload.genre is not None:
        set_ops["genre"] = payload.genre.strip()[:60]
    if payload.mood is not None:
        set_ops["mood"] = payload.mood.strip()[:60]
    if payload.cover_url is not None:
        cu = payload.cover_url.strip()
        set_ops["cover_url"] = cu or None
    if payload.visibility is not None:
        set_ops["visibility"] = _normalise_visibility(payload.visibility)
        # When dropping out of custom mode, clear the audience list.
        if set_ops["visibility"] != "custom":
            set_ops["custom_user_ids"] = []
    if payload.custom_user_ids is not None:
        # Accept only when visibility is being set to (or already is) custom.
        target_vis = set_ops.get("visibility", _normalise_visibility(track.get("visibility")))
        if target_vis != "custom":
            raise HTTPException(status_code=400, detail="custom_user_ids only valid when visibility=custom")
        set_ops["custom_user_ids"] = [str(x) for x in payload.custom_user_ids if isinstance(x, str)][:200]

    if not set_ops:
        return {"track": _public(track, viewer_id=current["id"])}

    set_ops["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.tracks.update_one({"id": track_id}, {"$set": set_ops})
    # Keep the canonical post mirrored (title/cover/audience/classification).
    try:
        from services import sound_posts as sp
        if payload.category is not None:
            await db.tracks.update_one({"id": track_id}, {"$set": {
                "classification_id": sp.classification_id_for_category(payload.category)}})
        await sp.sync_canonical_from_track(track_id)
    except Exception:  # noqa: BLE001
        pass
    fresh = await db.tracks.find_one({"id": track_id})
    return {"track": _public(fresh, viewer_id=current["id"])}


@router.delete("/{track_id}")
async def delete_track(track_id: str, current: CurrentUser):
    track = await db.tracks.find_one({"id": track_id})
    if not track:
        raise HTTPException(status_code=404, detail="Sound not found")
    if not _is_track_owner_or_founder(track, current):
        raise HTTPException(status_code=403, detail="Only the owner or founder can delete this sound")
    await db.tracks.delete_one({"id": track_id})
    # Canonical post + comments go with the sound (no broken feed entries).
    try:
        from services import sound_posts as sp
        await sp.delete_canonical_for_track(track_id)
    except Exception:  # noqa: BLE001
        pass
    # Best-effort cleanup of the audio file on disk. We swallow errors so a
    # missing-file (e.g. pod restart wiped /uploads) never blocks deletion.
    try:
        from pathlib import Path as _Path
        url = (track.get("file_url") or "")
        if url.startswith("/api/sounds/file/"):
            name = url.rsplit("/", 1)[-1]
            if is_safe_audio_filename(name):
                (audio_dir() / name).unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "deleted": track_id}


# ─────────────────────────────────────────────────────────────────────
# PART 5 — Admin: rights-confirmation inspection
# ─────────────────────────────────────────────────────────────────────
@router.get("/admin/{track_id}/rights")
async def admin_rights_confirmation(track_id: str, current: CurrentUser):
    """Return the rights-confirmation record for a sound (admin only).

    Used by the moderation tools so admins can verify a user accepted
    the upload-rights statement before the sound was uploaded. Available
    to anyone with moderation access (founder + support_admin + moderator).
    """
    from core.permissions import require_moderation_access
    require_moderation_access(current)
    track = await db.tracks.find_one(
        {"id": track_id},
        {"_id": 0, "id": 1, "user_id": 1, "title": 1, "created_at": 1, "rights_confirmation": 1},
    )
    if not track:
        raise HTTPException(status_code=404, detail="Sound not found")
    return {"track": track}


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
    sort: Optional[str] = None,
    window: str = "24h",
    limit: int = 50,
):
    query: dict = {"is_ai_generated": {"$ne": True}}
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

    # Phase α — visibility gate. Public tracks always pass; non-public
    # tracks are visible only to owner / accepted friend / custom-audience
    # member / founder.
    items = [t for t in items if _can_view_track(t, current)]

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

    out = [_public(t, viewer_id=current["id"]) for t in items]
    # Canonical post + live Fire data on every card (batched).
    try:
        from services import sound_posts as sp
        await sp.attach_posts_to_tracks(out, current["id"])
    except Exception:  # noqa: BLE001
        pass

    # Fire-ranked Sounds — identical rules to the For You fire sort:
    # window fire desc → created desc (stable ids keep ties deterministic).
    if sort == "fire":
        try:
            from services.fire_power import get_fire_flags, window_fire_map
            fflags = await get_fire_flags()
            if fflags.get("fire_reactions") and fflags.get("fire_ranked_feed"):
                pids = [t["post"]["id"] for t in out if t.get("post")]
                fmap = await window_fire_map(pids, window)

                def _fire_of(t):
                    p = t.get("post")
                    if not p:
                        return 0
                    if fmap is None:  # window == "all" → lifetime totals
                        return int(p.get("fire_total") or 0)
                    return fmap.get(p["id"], 0)

                out.sort(key=lambda t: (t.get("created_at") or "", t.get("id") or ""), reverse=True)
                out.sort(key=_fire_of, reverse=True)
        except Exception:  # noqa: BLE001
            pass

    return {"tracks": out}


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
    query: dict = {"is_ai_generated": {"$ne": True}}
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
    # Phase α — visibility gate (same as feed).
    items = [t for t in items if _can_view_track(t, current)]
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

    ranked = [{**_public(t, viewer_id=current["id"]), "rank": start + i + 1}
              for i, t in enumerate(page_items)]
    try:
        from services import sound_posts as sp
        await sp.attach_posts_to_tracks(ranked, current["id"])
    except Exception:  # noqa: BLE001
        pass

    return {
        "tracks": ranked,
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


@router.get("/by-user/{username}")
async def tracks_by_username(
    username: str,
    category: Optional[str] = None,
    limit: int = 60,
):
    """Public — list a profile's uploaded sounds, optionally filtered by
    category (Music/Podcasts/FX). Used by the Music + Podcasts profile
    widgets to populate the owner's sound picker AND to render the
    pinned sounds on public profile views. Visibility filters mirror
    /sounds/feed."""
    user = await db.users.find_one(
        {"username": username.lower()}, {"_id": 0, "id": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    query: dict = {"user_id": user["id"], "is_ai_generated": {"$ne": True}}
    if category and category != "All":
        # Case-insensitive match — admin/users may upload with
        # "podcast"/"podcasts"/"PODCASTS" casing. Normalize before
        # validating + querying.
        normalized = (category or "").strip().lower()
        canonical_map = {"music": "Music", "podcast": "Podcasts",
                         "podcasts": "Podcasts", "fx": "FX"}
        canonical = canonical_map.get(normalized) or category
        if canonical not in CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid category")
        query["category"] = canonical
    cursor = (
        db.tracks.find(query)
        .sort("created_at", -1)
        .limit(min(max(1, int(limit)), 200))
    )
    items = [doc async for doc in cursor]
    # Filter for public-visible tracks. We pass viewer_id=None since this
    # is a public endpoint; only `visibility=public` rows will survive.
    items = [t for t in items if _can_view_track(t, None)]
    out = [_public(t, viewer_id=None) for t in items]
    try:
        from services import sound_posts as sp
        await sp.attach_posts_to_tracks(out, None)
    except Exception:  # noqa: BLE001
        pass
    return {"tracks": out}


@router.get("/resolve")
async def resolve_sound_ids(request: Request, ids: str = ""):
    """Phase 3.3 — bulk resolve sound IDs to playable track payloads.

    Used by the Custom Widget Builder so widgets that pin native
    OurRealm sounds (saved by sound_id) can hydrate cover / title /
    artist / file_url at render time without exposing the raw
    track collection.

    Optional auth: anonymous viewers see public tracks; authenticated
    viewers also see private tracks they're authorized for via
    _can_view_track. IDs that no longer exist or fail the gate are
    silently dropped — frontend shows a "sound unavailable" fallback.

    Pass `ids` as a comma-separated list. Cap 50 per call.
    """
    # Optional auth — mirrors the public /by-user/{username} endpoint.
    current = None
    try:
        from core.deps import get_current_user
        current = await get_current_user(request)
    except Exception:  # noqa: BLE001
        current = None

    raw_ids = [x.strip() for x in (ids or "").split(",") if x.strip()]
    raw_ids = raw_ids[:50]
    if not raw_ids:
        return {"tracks": []}
    cursor = db.tracks.find({"id": {"$in": raw_ids}})
    items = [t async for t in cursor]
    viewer_id = current.get("id") if current else None
    visible = [t for t in items if _can_view_track(t, current)]
    by_id = {t["id"]: _public(t, viewer_id=viewer_id) for t in visible}
    # Preserve the caller-supplied order so the renderer's array
    # indices line up with the saved field value.
    ordered = [by_id[i] for i in raw_ids if i in by_id]
    return {"tracks": ordered}



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


# ─────────────────────────────────────────────────────────────────────
# Legacy Sound migration — tracks → canonical posts (founder only)
# ─────────────────────────────────────────────────────────────────────
class SoundMigrationBody(BaseModel):
    confirmation_phrase: Optional[str] = None


def _require_founder_sound(current: dict) -> None:
    if get_admin_role(current) != ROLE_FOUNDER:
        raise HTTPException(status_code=403, detail="Founder access only")


@router.post("/admin/migration/dry-run")
async def sound_migration_dry_run(current: CurrentUser):
    _require_founder_sound(current)
    from services import sound_posts as sp
    return await sp.migration_dry_run()


@router.post("/admin/migration/execute")
async def sound_migration_execute(body: SoundMigrationBody, current: CurrentUser):
    _require_founder_sound(current)
    if (body.confirmation_phrase or "").strip() != "MIGRATE SOUNDS TO POSTS":
        raise HTTPException(status_code=400,
                            detail='Type "MIGRATE SOUNDS TO POSTS" to confirm')
    from services import sound_posts as sp
    return await sp.migration_execute(current)


@router.post("/admin/migration/rollback")
async def sound_migration_rollback(body: SoundMigrationBody, current: CurrentUser):
    _require_founder_sound(current)
    if (body.confirmation_phrase or "").strip() != "ROLLBACK SOUND MIGRATION":
        raise HTTPException(status_code=400,
                            detail='Type "ROLLBACK SOUND MIGRATION" to confirm')
    from services import sound_posts as sp
    return await sp.migration_rollback(current)


# ── Media rights migration (Phase 2 — founder-gated, dry-run first) ────
@router.post("/admin/media-rights/dry-run")
async def media_rights_dry_run(current: CurrentUser):
    _require_founder_sound(current)
    from services.sound_permissions import migration_dry_run, record_dry_run
    report = await migration_dry_run()
    await record_dry_run(current, report)
    return report


class MediaRightsExecuteBody(BaseModel):
    confirmation_phrase: Optional[str] = None
    target_environment: Optional[str] = None
    reason: Optional[str] = None


@router.post("/admin/media-rights/execute")
async def media_rights_execute(body: MediaRightsExecuteBody, current: CurrentUser):
    """Multi-factor gate: founder identity + exact phrase + explicit
    environment target + audit reason + a recent dry-run on record.
    Idempotent — only touches records missing the new fields."""
    _require_founder_sound(current)
    from services.sound_permissions import (MIGRATION_VERSION, current_environment,
                                            has_recent_dry_run, migration_execute)
    if (body.confirmation_phrase or "").strip() != "APPLY MEDIA RIGHTS MIGRATION":
        raise HTTPException(status_code=400,
                            detail='Type "APPLY MEDIA RIGHTS MIGRATION" to confirm')
    env = current_environment()
    if (body.target_environment or "").strip().lower() != env:
        raise HTTPException(status_code=400,
                            detail=f'target_environment must explicitly name this environment ("{env}")')
    if not (body.reason or "").strip():
        raise HTTPException(status_code=400, detail="An audit reason is required")
    if not await has_recent_dry_run():
        raise HTTPException(status_code=409,
                            detail="Run /admin/media-rights/dry-run first (within 24h)")
    return await migration_execute(executed_by=current, reason=body.reason.strip(),
                                   target_environment=env,
                                   migration_version=MIGRATION_VERSION)


# ── Phase 3 — Media Sound Selector: browse Sounds for attachment ────────
@router.get("/browse")
async def browse_sounds_for_attachment(
    current: CurrentUser,
    use_type: str = "image_posts",
    q: str = "",
    category: str = "",
    genre: str = "",
    mood: str = "",
    sort: str = "trending",
    tab: str = "all",
    limit: int = 30,
    include_facets: int = 0,
):
    from services.sound_attachments import browse_sounds
    if use_type not in ("image_posts", "video_posts"):
        use_type = "image_posts"
    if sort not in ("trending", "newest"):
        sort = "trending"
    if tab not in ("all", "saved", "mine", "recent"):
        tab = "all"
    return await browse_sounds(current, use_type, q=q, category=category, genre=genre,
                               mood=mood, sort=sort, tab=tab, limit=limit,
                               include_facets=bool(include_facets))


# ── Sound reuse permissions (Phase 2 — Where this Sound may be used) ────
@router.get("/{track_id}/reuse-permissions")
async def get_reuse_permissions(track_id: str, current: CurrentUser):
    from services.sound_permissions import default_permissions, preset_for, PRESETS
    t = await db.tracks.find_one({"id": track_id}, {"_id": 0, "id": 1, "user_id": 1,
                                                    "title": 1, "reuse_permissions": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Sound not found")
    perms = t.get("reuse_permissions") or default_permissions()
    return {"track_id": track_id, "title": t.get("title"),
            "is_owner": t.get("user_id") == current["id"],
            "permissions": perms, "preset": preset_for(perms),
            "presets": list(PRESETS.keys())}


@router.patch("/{track_id}/reuse-permissions")
async def set_reuse_permissions(track_id: str, payload: dict, current: CurrentUser):
    """Only the Sound owner (or founder admin) may change reuse rules."""
    from services.sound_permissions import (REUSE_FLAGS, PRESETS, default_permissions,
                                            preset_for)
    t = await db.tracks.find_one({"id": track_id}, {"_id": 0, "id": 1, "user_id": 1,
                                                    "reuse_permissions": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Sound not found")
    is_admin = (current.get("username") == "stealth" or current.get("admin_role") == "founder")
    if t.get("user_id") != current["id"] and not is_admin:
        raise HTTPException(status_code=403, detail="Only the Sound owner can change reuse permissions")
    perms = dict(t.get("reuse_permissions") or default_permissions())
    preset = payload.get("preset")
    if preset:
        if preset not in PRESETS:
            raise HTTPException(status_code=400, detail="Unknown preset")
        perms = dict(PRESETS[preset])
    for k, v in (payload.get("permissions") or {}).items():
        if k in REUSE_FLAGS:
            perms[k] = bool(v)
    from datetime import datetime, timezone
    await db.tracks.update_one(
        {"id": track_id},
        {"$set": {"reuse_permissions": perms, "reuse_preset": preset_for(perms),
                  "reuse_updated_at": datetime.now(timezone.utc).isoformat(),
                  "reuse_updated_by": current["id"]}})
    return {"ok": True, "permissions": perms, "preset": preset_for(perms)}
