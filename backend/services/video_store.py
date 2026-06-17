"""Centralized video hosting for OurRealm — mirrors image_store.py.

Local-disk backend behind a single small abstraction so it can be swapped
for S3 / R2 / Cloudflare Stream later without touching call sites.

Public surface:
    save_video(file_bytes, mime, owner_id, filename) → VideoRecord
    video_dir()                                        → Path to disk dir

Records are persisted to the `videos` Mongo collection so the
upload_limits service can count uploads independently of post creation.
"""
from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from core.db import db


logger = logging.getLogger("ourrealm.videostore")

# ── Config — see services.upload_limits.LIMITS["video"] for the per-user caps.
MAX_BYTES = 100 * 1024 * 1024  # 100 MB hard ceiling

# Accept the formats requested by the spec + sensible aliases.
ALLOWED_MIMES = {
    "video/mp4":       "mp4",
    "video/quicktime": "mov",
    "video/webm":      "webm",
    # Common variants browsers/devices announce
    "video/x-m4v":     "mp4",
    "application/octet-stream": None,  # decided by extension fallback
}

ALLOWED_EXTS = {"mp4", "mov", "webm"}

ROOT = Path(os.environ.get("VIDEO_STORAGE_DIR", "/app/backend/uploads/videos"))
ROOT.mkdir(parents=True, exist_ok=True)


def video_dir() -> Path:
    return ROOT


# ── Data ──────────────────────────────────────────────────────────────
@dataclass
class VideoRecord:
    id: str
    user_id: str
    ext: str            # mp4 | mov | webm
    bytes: int
    mime: str
    created_at: str

    @property
    def url(self) -> str:
        return f"/api/videos/{self.id}.{self.ext}"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["url"] = self.url
        return d


def _resolve_ext(mime: Optional[str], filename: Optional[str]) -> str:
    """Map the upload's declared mime/filename to one of mp4/mov/webm.
    Raises ValueError when the format isn't supported.
    """
    if mime:
        ext = ALLOWED_MIMES.get(mime.lower())
        if ext:
            return ext
    # Fall back to filename extension when the browser sent a generic mime
    # (Safari often sends application/octet-stream for camera-roll videos).
    if filename:
        guess = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if guess in ALLOWED_EXTS:
            return guess
    raise ValueError("Unsupported video format. Allowed: MP4, MOV, WebM.")


# ── Public API ────────────────────────────────────────────────────────
async def save_video(
    raw: bytes,
    owner_id: str,
    declared_mime: Optional[str] = None,
    filename: Optional[str] = None,
) -> VideoRecord:
    if len(raw) > MAX_BYTES:
        raise ValueError(f"Video too large (max {MAX_BYTES // (1024 * 1024)} MB)")
    if len(raw) < 512:
        raise ValueError("Empty or invalid video file")

    ext = _resolve_ext(declared_mime, filename)
    video_id = uuid.uuid4().hex
    target = video_dir() / f"{video_id}.{ext}"
    with open(target, "wb") as f:
        f.write(raw)

    rec = VideoRecord(
        id=video_id,
        user_id=owner_id,
        ext=ext,
        bytes=len(raw),
        mime=(declared_mime or f"video/{ext}").lower(),
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    # Persist metadata so upload_limits.count_documents works and so we can
    # garbage-collect orphans later.
    doc = {
        "id": rec.id,
        "user_id": rec.user_id,
        "ext": rec.ext,
        "bytes": rec.bytes,
        "mime": rec.mime,
        "created_at": rec.created_at,
        "url": rec.url,
    }
    await db.videos.insert_one(doc)
    logger.info(f"saved video {rec.id}.{ext} bytes={rec.bytes} for user={owner_id}")
    return rec


def is_safe_video_filename(name: str) -> bool:
    """Path-traversal guard for the static serving endpoint."""
    if not name or "/" in name or ".." in name or "." not in name:
        return False
    if not name.endswith(tuple(f".{e}" for e in ALLOWED_EXTS)):
        return False
    stem = name.rsplit(".", 1)[0]
    if len(stem) != 32 or not all(c in "abcdef0123456789" for c in stem):
        return False
    return True
