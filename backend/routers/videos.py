"""Video hosting endpoints — mirrors images.py.

  POST /api/videos/upload    multipart `file` field
  GET  /api/videos/{name}    serves stored file with HTTP-Range support
  GET  /api/videos/me/list   list current user's uploaded videos

Server-side duration enforcement is best-effort: most browsers don't ship
ffprobe-class metadata for free, so we trust the optional `duration`
form field sent by the client (it inspects the file via `<video>.duration`
before upload) AND the LIMITS["video"]["max_seconds"] = 60 cap is still
enforced on the post creation path via enforce_duration.
"""
from __future__ import annotations

import os
from typing import Optional

import logging

from fastapi import APIRouter, File, Form, HTTPException, Request
from fastapi import UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser, require_admin
from core.permissions import require_founder
from services.upload_limits import enforce_duration, enforce_pre_upload
from services.video_store import (
    MAX_BYTES, ALLOWED_EXTS, is_safe_video_filename, save_video, video_dir,
)


router = APIRouter(prefix="/api/videos", tags=["videos"])
log = logging.getLogger("ourrealm.videos")


@router.post("/upload")
async def upload_video(
    current: CurrentUser,
    file: UploadFile = File(...),
    # Client passes the HTMLVideoElement.duration it measured locally so we
    # can reject too-long clips early (server doesn't bundle ffprobe).
    duration: Optional[float] = Form(default=None),
    # AUDIO RIGHTS — server re-verifies everything; these are requests,
    # not authoritative. Default is always "mute".
    audio_choice: str = Form(default="mute"),
    rights_confirmed: bool = Form(default=False),
    upload_session_id: Optional[str] = Form(default=None),
):
    if audio_choice not in ("mute", "original", "replace"):
        audio_choice = "mute"
    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_BYTES // (1024*1024)} MB limit")

    # Centralized per-user cap (100 MB / 3-per-day for non-founder; @stealth exempt).
    await enforce_pre_upload(current, "video", len(raw))

    # Duration cap — only enforced when the client could measure it.
    if duration is not None:
        enforce_duration(current, "video", float(duration))

    try:
        rec = await save_video(
            raw,
            current["id"],
            declared_mime=file.content_type,
            filename=file.filename,
            audio_choice=audio_choice,
            rights_confirmed=rights_confirmed,
            upload_session_id=upload_session_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    meta = await db.videos.find_one({"id": rec.id}, {"_id": 0, "audio_detected": 1,
                                                     "audio_published": 1,
                                                     "audio_rights_status": 1})
    return {"video": rec.to_dict(), "url": rec.url, "audio": meta or {}}


# ── Phase 3 — Replace video audio with an eligible OurRealm Sound ──────
class ReplaceAudioBody(BaseModel):
    track_id: str
    start_seconds: float = 0.0
    duration_seconds: Optional[float] = None
    volume: float = 1.0
    fade_in: float = 0.0
    fade_out: float = 0.0


@router.post("/{video_id}/replace-audio")
async def replace_audio(video_id: str, body: ReplaceAudioBody, current: CurrentUser):
    """Creates a NEW derivative video whose audio is the selected Sound.
    The base video (and any private original) is never modified. Server
    revalidates the Sound owner's reuse permission here — never trusts
    the browser's earlier search result."""
    from services.sound_attachments import sanitize_settings, validate_attachment
    from services.video_store import create_sound_replaced_derivative
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if video.get("user_id") != current["id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own videos")
    if video.get("derived_from"):
        raise HTTPException(status_code=400, detail="This video is already a processed derivative")
    track, snapshot = await validate_attachment(body.track_id, "video_posts", current)
    settings = sanitize_settings(body.model_dump(), track, "video_posts")
    try:
        doc = await create_sound_replaced_derivative(video, track, settings, snapshot,
                                                     current["id"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "video": {k: doc.get(k) for k in ("id", "ext", "bytes", "mime", "created_at", "url")},
        "url": doc.get("url"),
        "audio": {"audio_detected": True, "audio_published": True,
                  "audio_rights_status": "replaced_with_ourrealm_sound"},
        "sound": {"track_id": track["id"], "title": track.get("title"),
                  "settings": settings},
    }


@router.get("/me/list")
async def list_mine(current: CurrentUser, limit: int = 60):
    from core.db import db
    cursor = (
        db.videos.find({"user_id": current["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(min(max(1, limit), 200))
    )
    items = [doc async for doc in cursor]
    return {"videos": items}


_CHUNK = 1024 * 1024  # 1 MB streaming chunks for ranged responses


def _iterfile(path, start: int, length: int):
    """Yield `length` bytes from `path` starting at `start`, in 1 MB chunks.

    Used for HTTP-Range responses so mobile Safari can scrub video and so
    we never load the whole file into memory.
    """
    with open(path, "rb") as f:
        f.seek(start)
        remaining = length
        while remaining > 0:
            chunk = f.read(min(_CHUNK, remaining))
            if not chunk:
                break
            yield chunk
            remaining -= len(chunk)


def _parse_range(header: str, file_size: int):
    """Return (start, end) for a single-range request, or None if invalid.

    We deliberately support only the single-range form (`bytes=START-END?`)
    because that's what every browser, including mobile Safari, sends for
    `<video>` playback. Multi-range is rare and not worth the complexity.
    """
    try:
        unit, _, spec = header.strip().partition("=")
        if unit.lower() != "bytes" or "," in spec:
            return None
        start_s, _, end_s = spec.partition("-")
        if start_s == "":
            # Suffix range: `bytes=-500` → last 500 bytes
            suffix = int(end_s)
            if suffix <= 0:
                return None
            start = max(0, file_size - suffix)
            end = file_size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else file_size - 1
        if start < 0 or end < start or start >= file_size:
            return None
        return start, min(end, file_size - 1)
    except (ValueError, TypeError):
        return None


@router.get("/{name}")
async def serve(name: str, request: Request):
    """Stream a stored video with full HTTP-Range / 206 support.

    Mobile Safari (and Chrome on cellular) REQUIRES a 206 Partial Content
    response for `<video>` to start playback at all — without it the
    element shows the crossed-out play badge and never fires the
    `loadedmetadata` event. We honour `Range` headers manually because
    Starlette's `FileResponse` returns the whole file with HTTP 200.
    """
    if not is_safe_video_filename(name):
        log.warning("[videos.serve] invalid filename rejected: %s", name)
        raise HTTPException(status_code=400, detail="Invalid video name")
    path = video_dir() / name
    if not path.exists():
        # Production diagnostic — when an existing post's video file is
        # missing on disk (e.g. ephemeral pod, lost on redeploy) we log
        # the requested URL + resolved path so admins can correlate
        # client failures with the storage state.
        log.error(
            "[videos.serve] file missing on disk: %s (resolved=%s, dir=%s)",
            name, str(path), str(video_dir()),
        )
        raise HTTPException(status_code=404, detail="Not found")

    file_size = os.path.getsize(path)
    ext = name.rsplit(".", 1)[-1].lower()
    media_type = {"mp4": "video/mp4", "mov": "video/quicktime", "webm": "video/webm"}[ext]

    common_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
    }

    range_header = request.headers.get("range") or request.headers.get("Range")
    if range_header:
        rng = _parse_range(range_header, file_size)
        if rng is None:
            # Malformed → 416 Range Not Satisfiable.
            return Response(
                status_code=416,
                headers={**common_headers, "Content-Range": f"bytes */{file_size}"},
            )
        start, end = rng
        length = end - start + 1
        headers = {
            **common_headers,
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(length),
        }
        return StreamingResponse(
            _iterfile(path, start, length),
            status_code=206,
            media_type=media_type,
            headers=headers,
        )

    # No Range header → whole file. Still emit Accept-Ranges so the
    # browser knows it CAN range on subsequent requests.
    return FileResponse(
        path,
        media_type=media_type,
        headers={**common_headers, "Content-Length": str(file_size)},
    )



# ─── Admin diagnostics (Phase 5 production hotfix #2) ──────────────────
# Mobile-friendly endpoints so production triage is possible from a phone.
# All require @stealth / @support / role=admin via require_admin.

@router.get("/admin/diagnostics")
async def video_diagnostics(current: CurrentUser):
    """Report storage + DB state so admins can confirm whether uploaded
    videos are intact on the production pod. Designed to be tap-friendly
    from a mobile Emergent dashboard.

    Returns:
      storage_dir, dir_exists, file_count, total_bytes
      posts_with_video_url, posts_pointing_to_missing_files (capped 20),
      posts_with_absolute_urls_remaining (should be 0 after migration).
    """
    require_founder(current)
    vdir = video_dir()
    files_on_disk = set()
    total_bytes = 0
    if vdir.exists():
        for p in vdir.iterdir():
            if p.is_file():
                files_on_disk.add(p.name)
                try:
                    total_bytes += p.stat().st_size
                except OSError:
                    pass

    fields = ("video_url", "image_url", "media_url")
    # Counts ANY post whose URL starts with `http://` — includes YouTube /
    # Vimeo embeds (which are SUPPOSED to be absolute) and any leftover
    # preview-host URLs we'd want to rewrite. Useful as a "did anything
    # slip through the migration" signal; the manual migrate endpoint
    # only touches /api/videos/ + /api/images/ paths.
    abs_with_internal_path = await db.posts.count_documents(
        {"$or": [
            {f: {"$regex": r"^https?://[^/]+/api/(?:videos|images)/"}}
            for f in fields
        ]}
    )

    posts_with_video = []
    cursor = db.posts.find(
        {"video_url": {"$regex": "^/api/videos/"}},
        {"_id": 0, "id": 1, "video_url": 1, "author_username": 1, "created_at": 1},
    ).sort("created_at", -1).limit(200)
    missing = []
    seen = 0
    async for p in cursor:
        seen += 1
        url = p.get("video_url") or ""
        # Extract just the filename after /api/videos/
        name = url.rsplit("/api/videos/", 1)[-1]
        if name and name not in files_on_disk:
            if len(missing) < 20:
                missing.append({
                    "post_id": p.get("id"),
                    "author": p.get("author_username"),
                    "created_at": p.get("created_at"),
                    "video_url": url,
                    "expected_file": name,
                })
        posts_with_video.append(name)

    return {
        "storage_dir": str(vdir),
        "dir_exists": vdir.exists(),
        "file_count": len(files_on_disk),
        "total_bytes": total_bytes,
        "posts_with_video_url_sampled": seen,
        "posts_pointing_to_missing_files_count": len(posts_with_video) - len([n for n in posts_with_video if n in files_on_disk]),
        "examples_pointing_to_missing_files": missing,
        "posts_with_absolute_urls_remaining": abs_with_internal_path,
    }


@router.post("/admin/migrate-urls")
async def admin_run_url_migration(current: CurrentUser):
    """Manually re-run the relative-URL migration on demand.

    This is the same logic as `core.seed.migrate_video_urls_to_relative`
    — exposed here so admins can rerun it without redeploying. Returns
    `{updated: <int>}`.
    """
    require_founder(current)
    import re as _re
    re_strip = _re.compile(r"^https?://[^/]+(/api/(?:videos|images)/.+)$")
    fields = ("video_url", "image_url", "media_url")
    cursor = db.posts.find(
        {"$or": [{f: {"$regex": "^https?://"}} for f in fields]},
        {"_id": 0, "id": 1, **{f: 1 for f in fields}},
    )
    updated = 0
    async for doc in cursor:
        upd = {}
        for f in fields:
            v = doc.get(f)
            if not v:
                continue
            m = re_strip.match(v)
            if m:
                upd[f] = m.group(1)
        if upd:
            await db.posts.update_one({"id": doc["id"]}, {"$set": upd})
            updated += 1
    log.info("[videos.admin] manual URL migration ran", extra={"updated": updated})
    return {"ok": True, "updated": updated}
