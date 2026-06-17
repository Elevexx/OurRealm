"""
Centralized image hosting for OurRealm.

Local-disk backend that lives behind a single small abstraction so it can
be swapped for S3 / R2 / Cloudinary later without touching call sites.

Public surface:
    save_upload(file_bytes, mime, owner_id)          → ImageRecord
    save_from_url(remote_url, owner_id)              → ImageRecord
    image_dir()                                       → Path to disk dir

`ImageRecord` exposes the hosted url and thumbnail url (CDN-style absolute
paths under `/api/images/...`). All metadata is persisted to the `images`
collection so we can list / GC / report later.
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
import re
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

from core.db import db


logger = logging.getLogger("ourrealm.imagestore")

# ── Config ────────────────────────────────────────────────────────────
MAX_BYTES = 10 * 1024 * 1024  # 10 MB hard cap (matches spec)
THUMB_MAX = (480, 480)         # feed/profile thumb upper bound
ORIGINAL_MAX = (2048, 2048)    # we resize originals down so we never store
                               # camera-roll-sized blobs on disk
ALLOWED_MIMES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}
URL_EXT_RE = re.compile(r"\.(jpe?g|png|webp|gif)(\?|#|$)", re.IGNORECASE)

ROOT = Path(os.environ.get("IMAGE_STORAGE_DIR", "/app/backend/uploads/images"))
ROOT.mkdir(parents=True, exist_ok=True)


def image_dir() -> Path:
    return ROOT


# ── Data ──────────────────────────────────────────────────────────────
@dataclass
class ImageRecord:
    id: str
    user_id: str
    original_url: str       # /api/images/{id}.{ext}
    thumbnail_url: str      # /api/images/{id}_thumb.{ext}
    width: int
    height: int
    bytes: int
    mime: str
    sha256: str
    created_at: str

    def to_dict(self) -> dict:
        return asdict(self)


# ── Helpers ───────────────────────────────────────────────────────────
def _sniff_mime(raw: bytes) -> Optional[str]:
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def _normalize_and_save(raw: bytes, image_id: str, ext: str) -> Tuple[int, int, str, str, int]:
    """Resize-down original to ORIGINAL_MAX and write a square-ish thumb.

    Returns (width, height, original_rel_url, thumb_rel_url, bytes_written).
    """
    try:
        img = Image.open(io.BytesIO(raw))
    except UnidentifiedImageError as e:
        raise ValueError("Could not read image — corrupted or unsupported format") from e
    # Strip EXIF & honor orientation.
    img = ImageOps.exif_transpose(img)
    # Convert palette / RGBA-with-alpha for JPEG to RGB.
    save_kwargs = {"optimize": True}
    save_format = "JPEG"
    if ext == "png":
        save_format = "PNG"
    elif ext == "webp":
        save_format = "WEBP"
        save_kwargs["quality"] = 82
    elif ext == "gif":
        save_format = "GIF"
        save_kwargs = {}
    else:
        save_format = "JPEG"
        save_kwargs["quality"] = 84
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

    # Original (capped)
    orig = img.copy()
    orig.thumbnail(ORIGINAL_MAX, Image.LANCZOS)
    orig_path = ROOT / f"{image_id}.{ext}"
    orig.save(orig_path, format=save_format, **save_kwargs)
    bytes_written = orig_path.stat().st_size

    # Thumbnail (always jpeg for size, except gif preserve)
    thumb = img.copy()
    thumb.thumbnail(THUMB_MAX, Image.LANCZOS)
    thumb_ext = ext if ext == "gif" else "jpg"
    thumb_path = ROOT / f"{image_id}_thumb.{thumb_ext}"
    if thumb_ext == "gif":
        thumb.save(thumb_path, format="GIF")
    else:
        if thumb.mode not in ("RGB", "L"):
            thumb = thumb.convert("RGB")
        thumb.save(thumb_path, format="JPEG", quality=78, optimize=True)

    return (
        orig.width, orig.height,
        f"/api/images/{image_id}.{ext}",
        f"/api/images/{image_id}_thumb.{thumb_ext}",
        bytes_written,
    )


# Note: per-user daily/size caps are enforced centrally via
# `services.upload_limits.enforce_pre_upload` at the router layer.


# ── Public API ────────────────────────────────────────────────────────
async def save_bytes(raw: bytes, owner_id: str, declared_mime: Optional[str] = None) -> ImageRecord:
    if len(raw) > MAX_BYTES:
        raise ValueError(f"Image is too large (max {MAX_BYTES // (1024*1024)} MB)")
    if len(raw) < 32:
        raise ValueError("Empty or invalid image")
    sniffed = _sniff_mime(raw)
    mime = sniffed or (declared_mime or "").lower()
    if mime not in ALLOWED_MIMES:
        raise ValueError("Unsupported image format. Allowed: JPEG, PNG, WebP, GIF.")
    ext = ALLOWED_MIMES[mime]
    image_id = uuid.uuid4().hex
    sha = hashlib.sha256(raw).hexdigest()
    width, height, orig_url, thumb_url, bytes_written = _normalize_and_save(raw, image_id, ext)
    rec = ImageRecord(
        id=image_id,
        user_id=owner_id,
        original_url=orig_url,
        thumbnail_url=thumb_url,
        width=width,
        height=height,
        bytes=bytes_written,
        mime=mime,
        sha256=sha,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    await db.images.insert_one(rec.to_dict())
    logger.info(f"Stored image {image_id} ({mime}, {width}x{height}, {bytes_written}b) for {owner_id}")
    return rec


async def save_from_url(remote_url: str, owner_id: str) -> ImageRecord:
    if not (remote_url.startswith("http://") or remote_url.startswith("https://")):
        raise ValueError("URL must be http(s)://")
    if not URL_EXT_RE.search(remote_url):
        # Some URLs are dynamic — we still try, but the MIME sniffer below
        # is the real source of truth.
        pass
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            r = await client.get(remote_url)
            r.raise_for_status()
    except Exception as e:
        raise ValueError(f"Could not fetch image: {e}") from e
    raw = r.content
    return await save_bytes(raw, owner_id, declared_mime=r.headers.get("content-type", ""))
