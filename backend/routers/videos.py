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

from fastapi import APIRouter, File, Form, HTTPException, Request
from fastapi import UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse

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
        raise HTTPException(status_code=400, detail="Invalid video name")
    path = video_dir() / name
    if not path.exists():
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
