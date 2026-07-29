"""Image hosting endpoints.

  POST /api/images/upload     multipart `file` field
  POST /api/images/from-url   {"url": "https://..."}
  GET  /api/images/{name}     serves stored file (no auth — public CDN-style)
  GET  /api/images/me/list    list current user's images
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from core.deps import CurrentUser
from services.image_store import (
    save_bytes, save_from_url, image_dir, MAX_BYTES,
)
from services.upload_limits import enforce_pre_upload


router = APIRouter(prefix="/api/images", tags=["images"])

# Filename matcher: 32-hex + optional _thumb + .ext  (no path traversal)
ALLOWED_FILENAME_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789_.")
ALLOWED_EXT = {"jpg", "jpeg", "png", "webp", "gif"}


def _safe_filename(name: str) -> str:
    name = (name or "").strip().lower()
    if not name or any(c not in ALLOWED_FILENAME_CHARS for c in name):
        raise HTTPException(status_code=400, detail="Invalid image name")
    if "/" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid image name")
    if "." not in name:
        raise HTTPException(status_code=400, detail="Invalid image name")
    ext = name.rsplit(".", 1)[-1]
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    return name


@router.post("/upload")
async def upload(current: CurrentUser, file: UploadFile = File(...)):
    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_BYTES // (1024*1024)} MB limit")
    # Centralized per-user cap (3 MB / 20-per-day for non-founder; @stealth exempt).
    await enforce_pre_upload(current, "image", len(raw))
    try:
        rec = await save_bytes(raw, current["id"], declared_mime=file.content_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Content-safety vision scan — async, scan-once, cached on the doc.
    import asyncio as _aio
    from services.content_safety import scan_image_record
    _aio.create_task(scan_image_record(rec.id))
    return {"image": rec.to_dict(), "url": rec.original_url, "thumbnail_url": rec.thumbnail_url}


class FromUrlPayload(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


@router.post("/from-url")
async def from_url(payload: FromUrlPayload, current: CurrentUser):
    # `from-url` re-hosts a remote image — counts against the user's daily image quota.
    # We fetch first so we can pass the real size to enforce_pre_upload (per-file 3 MB cap).
    url = payload.url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="URL must be http(s)://")
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch image: {e}")
    raw = r.content
    await enforce_pre_upload(current, "image", len(raw))
    try:
        rec = await save_bytes(raw, current["id"], declared_mime=r.headers.get("content-type", ""))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    import asyncio as _aio
    from services.content_safety import scan_image_record
    _aio.create_task(scan_image_record(rec.id))
    return {"image": rec.to_dict(), "url": rec.original_url, "thumbnail_url": rec.thumbnail_url}


@router.get("/me/list")
async def list_mine(current: CurrentUser, limit: int = 60):
    cursor = (
        # type: ignore[attr-defined]
        __import__("core.db", fromlist=["db"]).db.images
        .find({"user_id": current["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(min(max(1, limit), 200))
    )
    items = [doc async for doc in cursor]
    return {"images": items}


@router.get("/{name}")
async def serve(name: str):
    safe = _safe_filename(name)
    path = image_dir() / safe
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    ext = safe.rsplit(".", 1)[-1]
    media_type = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
        "webp": "image/webp", "gif": "image/gif",
    }[ext]
    # Aggressive caching — files are immutable once written (filename = uuid).
    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    return FileResponse(path, media_type=media_type, headers=headers)
