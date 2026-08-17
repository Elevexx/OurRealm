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
import subprocess
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


def playable_info(rec, *, provider: str = None, model: str = None,
                  duration: float = None, status: str = "ready") -> dict:
    """Single normalized video output contract. Always returns a playable
    URL (public cloud URL or API route) — never a filesystem path."""
    return {"url": rec.url, "thumbnail": getattr(rec, "thumbnail_url", None),
            "mime": rec.mime, "provider": provider, "model": model,
            "duration": duration, "status": status}

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


# ── Phase 3 — Sound-replaced derivative (video audio replacement) ──────
def _probe_duration_seconds(path: Path) -> Optional[float]:
    import re
    try:
        proc = subprocess.run([_ffmpeg(), "-hide_banner", "-i", str(path)],
                              capture_output=True, timeout=60)
        m = re.search(rb"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", proc.stderr)
        if m:
            h, mnt, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
            return h * 3600 + mnt * 60 + s
    except Exception:
        pass
    return None


def _fetch_from_cloud(kind: str, filename: str, dest: Path) -> bool:
    """Pull a mirrored media file back to local disk for processing."""
    try:
        from services.storage_adapter import get_storage_adapter, S3CompatibleAdapter
        adapter = get_storage_adapter()
        if not isinstance(adapter, S3CompatibleAdapter):
            return False
        url = adapter.presigned_get(kind, filename, ttl=600)
        import urllib.request
        urllib.request.urlretrieve(url, dest)
        return dest.exists() and dest.stat().st_size > 0
    except Exception as e:
        logger.warning(f"[replace-audio] cloud fetch failed {kind}/{filename}: {e}")
        return False


async def create_sound_replaced_derivative(video_doc: dict, track: dict,
                                           settings: dict, snapshot: dict,
                                           owner_id: str) -> dict:
    """Create a NEW processed derivative: base video's VIDEO STREAM ONLY
    (original audio structurally excluded via -map 0:v:0) + the licensed
    OurRealm Sound. The base video and any private original are never
    overwritten. Idempotent per (base, track, settings)."""
    import asyncio as _aio
    import hashlib

    start = float(settings.get("start_seconds") or 0.0)
    seg = settings.get("duration_seconds")
    vol = float(settings.get("volume") or 1.0)
    fi = float(settings.get("fade_in") or 0.0)
    fo = float(settings.get("fade_out") or 0.0)
    key = (f"{video_doc['id']}|{track['id']}|{start:.3f}|{(seg or 0):.3f}"
           f"|{vol:.3f}|{fi:.3f}|{fo:.3f}")
    params_hash = hashlib.sha256(key.encode()).hexdigest()

    existing = await db.videos.find_one(
        {"derived_from": video_doc["id"], "replace_params_hash": params_hash,
         "user_id": owner_id}, {"_id": 0})
    if existing:
        return existing

    ext = video_doc.get("ext") or "mp4"
    base = video_dir() / f"{video_doc['id']}.{ext}"
    if not base.exists() and not _fetch_from_cloud("videos", base.name, base):
        raise ValueError("The base video file is unavailable. Please re-upload the video.")

    from services.audio_store import audio_dir
    audio_name = (track.get("file_url") or "").rsplit("/", 1)[-1]
    if not audio_name or "/" in audio_name or ".." in audio_name:
        raise ValueError("That Sound's audio file is unavailable.")
    audio = audio_dir() / audio_name
    if not audio.exists() and not _fetch_from_cloud("audio", audio_name, audio):
        raise ValueError("That Sound's audio file is unavailable. Please select another Sound.")

    video_dur = await _aio.to_thread(_probe_duration_seconds, base) or 60.0
    effective_seg = min(seg, video_dur) if seg else video_dur

    new_id = uuid.uuid4().hex
    out = video_dir() / f"{new_id}.{ext}"
    af = f"volume={vol}"
    if fi > 0:
        af += f",afade=t=in:st=0:d={fi}"
    if fo > 0:
        af += f",afade=t=out:st={max(0.0, effective_seg - fo):.3f}:d={fo}"
    args = [_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(base),
            "-ss", f"{start:.3f}", "-t", f"{effective_seg:.3f}", "-i", str(audio),
            "-filter:a", af,
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart", "-shortest", str(out)]

    def _render():
        proc = subprocess.run(args, capture_output=True, timeout=300)
        return proc.returncode == 0 and out.exists() and out.stat().st_size > 0

    ok = await _aio.to_thread(_render)
    if not ok:
        out.unlink(missing_ok=True)
        raise ValueError("Could not combine the video with that Sound. Please try again.")

    now = datetime.now(timezone.utc).isoformat()
    rec = VideoRecord(id=new_id, user_id=owner_id, ext=ext, bytes=out.stat().st_size,
                      mime=video_doc.get("mime") or f"video/{ext}", created_at=now)
    from services.r2_mirror import mirror_to_cloud
    cloud = mirror_to_cloud("videos", f"{new_id}.{ext}", out, "")
    if cloud and (cloud.startswith("http") or cloud.startswith("/api/media/")):
        rec.cloud_url = cloud
    doc = {
        "id": rec.id, "user_id": rec.user_id, "ext": rec.ext, "bytes": rec.bytes,
        "mime": rec.mime, "created_at": rec.created_at, "url": rec.url,
        "upload_session_id": None,
        "audio_detected": True,
        "audio_published": True,
        "audio_rights_status": "replaced_with_ourrealm_sound",
        "derived_from": video_doc["id"],
        "sound_track_id": track["id"],
        "replace_params_hash": params_hash,
        "sound_settings": settings,
    }
    await db.videos.insert_one(doc)
    await db.video_audio_rights.insert_one({
        "id": uuid.uuid4().hex,
        "user_id": owner_id,
        "video_id": rec.id,
        "post_id": None,
        "upload_session_id": None,
        "original_filename": None,
        "audio_detected": True,
        "audio_choice": "replace",
        "rights_confirmed": False,
        "rights_confirmed_at": None,
        "terms_version": TERMS_VERSION,
        "rights_source": "ourrealm_sound_reuse",
        "replacement_sound_id": track["id"],
        "original_audio_volume": 0.0,
        "replacement_sound_volume": vol,
        "permission_snapshot": snapshot,
        "original_asset_ref": None,
        "derived_from": video_doc["id"],
        "public_derivative_id": f"{rec.id}.{ext}",
        "processing_status": "completed",
        "created_at": now,
        "updated_at": now,
    })
    doc.pop("_id", None)
    logger.info(f"[replace-audio] derivative {rec.id}.{ext} from {video_doc['id']} "
                f"with sound {track['id']} for user={owner_id}")
    return doc
