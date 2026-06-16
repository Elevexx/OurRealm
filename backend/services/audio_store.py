"""Centralized AUDIO hosting for OurRealm.

Mirrors the design of `services.image_store` so we never duplicate
storage primitives — same disk-backed pattern, same call surface, ready
to swap for S3 / R2 later.

Public surface:
    save_upload(file_bytes, filename, mime, owner_id) → AudioRecord
    audio_dir()                                       → Path

`AudioRecord` exposes the hosted url (`/api/sounds/{id}.{ext}`) plus
duration_seconds extracted server-side via mutagen.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Optional

from mutagen import File as MutagenFile

from core.db import db


logger = logging.getLogger("ourrealm.audiostore")

# ── Config ────────────────────────────────────────────────────────────
MAX_BYTES = 50 * 1024 * 1024  # 50 MB (matches spec)

# MIME → extension. Accepted: mp3, m4a/aac, wav, ogg, flac, webm.
ALLOWED_MIMES = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/vorbis": "ogg",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
    "audio/webm": "webm",
}
EXT_FALLBACK = {
    ".mp3": ("audio/mpeg", "mp3"),
    ".m4a": ("audio/mp4", "m4a"),
    ".aac": ("audio/aac", "aac"),
    ".wav": ("audio/wav", "wav"),
    ".ogg": ("audio/ogg", "ogg"),
    ".flac": ("audio/flac", "flac"),
    ".webm": ("audio/webm", "webm"),
}

ROOT = Path(os.environ.get("AUDIO_STORAGE_DIR", "/app/backend/uploads/audio"))
ROOT.mkdir(parents=True, exist_ok=True)


def audio_dir() -> Path:
    return ROOT


# ── Data ──────────────────────────────────────────────────────────────
@dataclass
class AudioRecord:
    id: str
    user_id: str
    file_url: str            # /api/sounds/{id}.{ext}
    bytes: int
    mime: str
    ext: str
    duration_seconds: float  # 0.0 if mutagen couldn't read
    sha256: str
    created_at: str

    def to_dict(self) -> dict:
        return asdict(self)


# ── Helpers ───────────────────────────────────────────────────────────
def _sniff_mime(raw: bytes) -> Optional[str]:
    # Magic-byte sniffing for the common audio containers
    if raw[:3] == b"ID3" or raw[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg"
    if raw[:4] == b"fLaC":
        return "audio/flac"
    if raw[:4] == b"OggS":
        return "audio/ogg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        return "audio/wav"
    if raw[4:8] == b"ftyp":
        # ISO base media — M4A / MP4 audio
        return "audio/mp4"
    if raw[:4] == b"\x1aE\xdf\xa3":
        return "audio/webm"
    return None


def _resolve_mime(raw: bytes, declared_mime: Optional[str], filename: Optional[str]) -> str:
    sniffed = _sniff_mime(raw)
    if sniffed and sniffed in ALLOWED_MIMES:
        return sniffed
    declared = (declared_mime or "").lower().split(";")[0].strip()
    if declared in ALLOWED_MIMES:
        return declared
    # Last resort — file extension
    if filename:
        ext = os.path.splitext(filename.lower())[1]
        if ext in EXT_FALLBACK:
            return EXT_FALLBACK[ext][0]
    raise ValueError("Unsupported audio format. Allowed: MP3, M4A/AAC, WAV, OGG, FLAC, WebM.")


def _extract_duration(raw: bytes, ext: str, on_disk_path: Optional[Path] = None) -> float:
    """Best-effort duration in seconds. 0.0 on failure.

    `mutagen.File()` reads from BytesIO for most formats but needs a real
    file path to identify some (notably WAV / AIFF). We pass the path
    that's already on disk to maximise format coverage.
    """
    # 1) Try a real path first (highest accuracy).
    if on_disk_path is not None:
        try:
            mf = MutagenFile(str(on_disk_path))
            if mf and mf.info and getattr(mf.info, "length", None):
                return float(mf.info.length)
        except Exception:
            pass
    # 2) Fall back to BytesIO (works for ID3-tagged MP3 / FLAC / OGG).
    try:
        mf = MutagenFile(BytesIO(raw))
        if mf and mf.info and getattr(mf.info, "length", None):
            return float(mf.info.length)
    except Exception:
        pass
    # 3) Last resort — uncompressed WAV: derive from RIFF/WAVE header.
    if ext == "wav" and len(raw) > 44 and raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        try:
            import struct
            # Standard WAV — fmt chunk at offset 12 if `fmt ` chunk is next
            # Walk chunks to find "fmt " and "data".
            i = 12
            fmt = None
            data_size = None
            while i + 8 <= len(raw):
                chunk_id = raw[i:i+4]
                chunk_size = struct.unpack_from("<I", raw, i+4)[0]
                if chunk_id == b"fmt ":
                    fmt = raw[i+8:i+8+chunk_size]
                elif chunk_id == b"data":
                    data_size = chunk_size
                    break
                i += 8 + chunk_size + (chunk_size % 2)
            if fmt and data_size and len(fmt) >= 16:
                channels = struct.unpack_from("<H", fmt, 2)[0]
                sample_rate = struct.unpack_from("<I", fmt, 4)[0]
                bits_per_sample = struct.unpack_from("<H", fmt, 14)[0]
                bytes_per_sample = max(1, (bits_per_sample // 8) * max(1, channels))
                if sample_rate > 0:
                    return data_size / float(sample_rate * bytes_per_sample)
        except Exception:
            pass
    return 0.0


async def _check_rate_limit(owner_id: str) -> None:
    """At most 6 audio uploads per rolling 5 minutes per user."""
    since = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    n = await db.tracks.count_documents({
        "user_id": owner_id, "created_at": {"$gte": since},
    })
    if n >= 6:
        raise ValueError("Too many uploads — please wait a few minutes before trying again.")


# ── Public API ────────────────────────────────────────────────────────
async def save_audio(
    raw: bytes,
    owner_id: str,
    declared_mime: Optional[str] = None,
    filename: Optional[str] = None,
) -> AudioRecord:
    if len(raw) > MAX_BYTES:
        raise ValueError(f"Audio file is too large (max {MAX_BYTES // (1024 * 1024)} MB)")
    if len(raw) < 256:
        raise ValueError("Empty or invalid audio file")
    mime = _resolve_mime(raw, declared_mime, filename)
    ext = ALLOWED_MIMES[mime]
    await _check_rate_limit(owner_id)

    audio_id = uuid.uuid4().hex
    sha = hashlib.sha256(raw).hexdigest()
    path = ROOT / f"{audio_id}.{ext}"
    path.write_bytes(raw)
    duration = _extract_duration(raw, ext, on_disk_path=path)

    rec = AudioRecord(
        id=audio_id,
        user_id=owner_id,
        file_url=f"/api/sounds/{audio_id}.{ext}",
        bytes=len(raw),
        mime=mime,
        ext=ext,
        duration_seconds=round(duration, 2),
        sha256=sha,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    logger.info(
        f"Stored audio {audio_id} ({mime}, {len(raw)}b, {duration:.1f}s) for {owner_id}"
    )
    return rec


# Path traversal guard for the public file-serving endpoint
_FILENAME_RE = re.compile(r"^[a-f0-9]{32}\.(mp3|m4a|aac|wav|ogg|flac|webm)$")


def is_safe_audio_filename(name: str) -> bool:
    return bool(_FILENAME_RE.match((name or "").strip().lower()))


def media_type_for_ext(ext: str) -> str:
    return {
        "mp3": "audio/mpeg",
        "m4a": "audio/mp4",
        "aac": "audio/aac",
        "wav": "audio/wav",
        "ogg": "audio/ogg",
        "flac": "audio/flac",
        "webm": "audio/webm",
    }.get(ext, "application/octet-stream")
