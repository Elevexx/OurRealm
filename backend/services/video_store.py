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

from services.storage import media_dir

ROOT = media_dir("videos", per_store_env="VIDEO_STORAGE_DIR")


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
    # When set (R2/S3 mirror succeeded), this is the canonical public
    # URL stored in MongoDB; the legacy /api/videos/{id}.{ext} stays
    # functional as a local fallback because the file is still on disk.
    cloud_url: Optional[str] = None

    @property
    def url(self) -> str:
        return self.cloud_url or f"/api/videos/{self.id}.{self.ext}"

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


# ── MOV → MP4 remux (iPhone uploads) ─────────────────────────────────
# QuickTime .mov containers do not reliably play in Chrome/Firefox/
# Android even when the codec inside is H.264. We REMUX (`-c copy`,
# no re-encode — takes seconds) into an MP4 container with faststart
# so uploads from iPhones play everywhere. If the remux fails (exotic
# codec), the upload is rejected with a clear message instead of
# silently creating a post that cannot play.
def _remux_mov_to_mp4(raw: bytes) -> bytes:
    import subprocess
    import tempfile
    from imageio_ffmpeg import get_ffmpeg_exe
    ffmpeg = get_ffmpeg_exe()
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.mov"
        dst = Path(tmp) / "out.mp4"
        src.write_bytes(raw)
        proc = subprocess.run(
            [ffmpeg, "-y", "-i", str(src), "-c", "copy",
             "-movflags", "+faststart", str(dst)],
            capture_output=True, timeout=120,
        )
        if proc.returncode != 0 or not dst.exists() or dst.stat().st_size < 512:
            raise ValueError(
                "This MOV file uses a format browsers can't play. Please upload "
                "an MP4 (H.264) instead — on iPhone: Settings → Camera → Formats "
                "→ 'Most Compatible', or export the clip as MP4."
            )
        return dst.read_bytes()


# ── Audio safety (Phase 1 — OurRealm Media Studio) ───────────────────
TERMS_VERSION = "2026-02-1"


def _ffmpeg():
    from imageio_ffmpeg import get_ffmpeg_exe
    return get_ffmpeg_exe()


def _probe_has_audio(path: Path) -> bool:
    """True when the file contains ANY audio stream (ffmpeg -i probe)."""
    import subprocess
    try:
        proc = subprocess.run([_ffmpeg(), "-hide_banner", "-i", str(path)],
                              capture_output=True, timeout=60)
        return b"Audio:" in (proc.stderr or b"")
    except Exception:
        # Unknown = assume audio present so the safe (muted) path is taken.
        return True


def _strip_audio(src: Path, dst: Path) -> bool:
    """Write a muted derivative (video stream copied, audio removed)."""
    import subprocess
    try:
        proc = subprocess.run(
            [_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
             "-i", str(src), "-c:v", "copy", "-an",
             "-movflags", "+faststart", str(dst)],
            capture_output=True, timeout=300)
        return proc.returncode == 0 and dst.exists() and dst.stat().st_size > 512
    except Exception:
        return False


# ── Public API ────────────────────────────────────────────────────────
async def save_video(
    raw: bytes,
    owner_id: str,
    declared_mime: Optional[str] = None,
    filename: Optional[str] = None,
    audio_choice: str = "mute",
    rights_confirmed: bool = False,
    upload_session_id: Optional[str] = None,
) -> VideoRecord:
    if len(raw) > MAX_BYTES:
        raise ValueError(f"Video too large (max {MAX_BYTES // (1024 * 1024)} MB)")
    if len(raw) < 512:
        raise ValueError("Empty or invalid video file")

    # Idempotent publish — a retried upload with the same session id
    # returns the already-stored video instead of creating a duplicate.
    if upload_session_id:
        existing = await db.videos.find_one(
            {"user_id": owner_id, "upload_session_id": upload_session_id}, {"_id": 0})
        if existing:
            rec = VideoRecord(id=existing["id"], user_id=owner_id, ext=existing["ext"],
                              bytes=existing["bytes"], mime=existing["mime"],
                              created_at=existing["created_at"],
                              cloud_url=existing.get("cloud_url"))
            if not rec.cloud_url and existing.get("url", "").startswith("/api/media/"):
                rec.cloud_url = existing["url"]
            return rec

    ext = _resolve_ext(declared_mime, filename)
    if ext == "mov":
        import asyncio
        raw = await asyncio.to_thread(_remux_mov_to_mp4, raw)
        ext = "mp4"
        declared_mime = "video/mp4"
        logger.info("remuxed MOV upload to MP4 (%d bytes) for user=%s", len(raw), owner_id)
    video_id = uuid.uuid4().hex
    target = video_dir() / f"{video_id}.{ext}"
    with open(target, "wb") as f:
        f.write(raw)

    # ── AUDIO SAFETY — server-side enforcement, never trusts the client.
    # Original audio publishes ONLY when the uploader affirmatively chose
    # "original" AND checked the rights confirmation. Otherwise the public
    # derivative is stripped of audio; the original moves to a private
    # file name that the serving endpoint and the CDN mirror both reject.
    import asyncio as _aio
    audio_detected = await _aio.to_thread(_probe_has_audio, target)
    audio_published = False
    original_ref = None
    if audio_detected:
        allow_original = (audio_choice == "original") and bool(rights_confirmed)
        if allow_original:
            audio_published = True
        else:
            private_orig = video_dir() / f"{video_id}.orig.{ext}"
            muted = video_dir() / f"{video_id}.muted.{ext}"
            ok = await _aio.to_thread(_strip_audio, target, muted)
            if ok:
                os.replace(target, private_orig)     # original: private, local-only
                os.replace(muted, target)            # public file: muted derivative
                original_ref = private_orig.name
            else:
                # Stripping failed — refuse to publish unlicensed audio.
                target.unlink(missing_ok=True)
                raise ValueError("Could not process this video's audio safely. Please try again.")

    rec = VideoRecord(
        id=video_id,
        user_id=owner_id,
        ext=ext,
        bytes=len(raw),
        mime=(declared_mime or f"video/{ext}").lower(),
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    # Mirror to cloud bucket (R2/S3) when configured. No-op for local.
    from services.r2_mirror import mirror_to_cloud
    cloud = mirror_to_cloud("videos", f"{video_id}.{ext}", target, "")
    # mirror_to_cloud returns the stable proxy path (`/api/media/videos/…`)
    # when R2 is active — accept both that and legacy absolute URLs so the
    # DB stores the durable URL instead of the ephemeral local-disk path.
    if cloud and (cloud.startswith("http") or cloud.startswith("/api/media/")):
        rec.cloud_url = cloud
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
        "upload_session_id": upload_session_id,
        "audio_detected": audio_detected,
        "audio_published": audio_published,
        "audio_rights_status": (
            "confirmed" if audio_published
            else ("muted_no_confirmation" if audio_detected else "no_audio")),
    }
    await db.videos.insert_one(doc)
    # Full audit record — a rights checkbox is a stored user representation,
    # not independent legal proof of ownership.
    now = datetime.now(timezone.utc).isoformat()
    await db.video_audio_rights.insert_one({
        "id": uuid.uuid4().hex,
        "user_id": owner_id,
        "video_id": rec.id,
        "post_id": None,
        "upload_session_id": upload_session_id,
        "original_filename": filename,
        "audio_detected": audio_detected,
        "audio_choice": audio_choice,
        "rights_confirmed": bool(rights_confirmed and audio_choice == "original"),
        "rights_confirmed_at": now if (rights_confirmed and audio_choice == "original") else None,
        "terms_version": TERMS_VERSION,
        "replacement_sound_id": None,
        "original_audio_volume": 1.0 if audio_published else 0.0,
        "replacement_sound_volume": None,
        "original_asset_ref": original_ref,
        "public_derivative_id": f"{rec.id}.{ext}",
        "processing_status": "completed",
        "created_at": now,
        "updated_at": now,
    })
    logger.info(f"saved video {rec.id}.{ext} bytes={rec.bytes} audio_detected={audio_detected} "
                f"audio_published={audio_published} for user={owner_id}")
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
