"""Video hosting endpoints — mirrors images.py.

  POST /api/videos/upload    multipart `file` field
  GET  /api/videos/{name}    serves stored file (no auth — public CDN-style)
  GET  /api/videos/me/list   list current user's uploaded videos

Server-side duration enforcement is best-effort: most browsers don't ship
ffprobe-class metadata for free, so we trust the optional `duration`
form field sent by the client (it inspects the file via `<video>.duration`
before upload) AND the LIMITS["video"]["max_seconds"] = 60 cap is still
enforced on the post creation path via enforce_duration.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from core.deps import CurrentUser
from services.upload_limits import enforce_duration, enforce_pre_upload
from services.video_store import (
    MAX_BYTES, ALLOWED_EXTS, is_safe_video_filename, save_video, video_dir,
)


router = APIRouter(prefix="/api/videos", tags=["videos"])


@router.post("/upload")
async def upload_video(
    current: CurrentUser,
    file: UploadFile = File(...),
    # Client passes the HTMLVideoElement.duration it measured locally so we
    # can reject too-long clips early (server doesn't bundle ffprobe).
    duration: Optional[float] = Form(default=None),
):
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
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"video": rec.to_dict(), "url": rec.url}


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


@router.get("/{name}")
async def serve(name: str):
    if not is_safe_video_filename(name):
        raise HTTPException(status_code=400, detail="Invalid video name")
    path = video_dir() / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    ext = name.rsplit(".", 1)[-1]
    media_type = {"mp4": "video/mp4", "mov": "video/quicktime", "webm": "video/webm"}[ext]
    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    return FileResponse(path, media_type=media_type, headers=headers)
