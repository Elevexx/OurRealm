"""Persistent media storage layer (PART 4 — Feb 18 2026).

A single helper that resolves the on-disk root path for any kind of user-
generated media (audio, images, videos, future kinds). The default is a
persistent-volume mount path that Emergent Support attaches at deploy time
so uploads survive every pod restart / rebuild / migration.

Resolution order (each store inherits this):
  1. Per-store env var if explicitly set, e.g. AUDIO_STORAGE_DIR.
  2. ${UPLOADS_ROOT}/<kind>            (recommended — single mount)
  3. /app/backend/uploads/<kind>       (LAST-RESORT ephemeral path —
                                       only used when neither env var
                                       is configured AND the persistent
                                       path doesn't exist).

The legacy path is kept solely for back-compat with already-deployed
pods that still write there; production deployments MUST set
`UPLOADS_ROOT=/data/ourrealm` (or wherever the persistent volume is
mounted). Existing media URLs continue resolving regardless of which
backend is selected — the URL pattern is `/api/<kind>/file/<id>` and
the router reads through this helper, so swapping the storage backend
to Cloudflare R2 / AWS S3 later is a one-file change in this module
without touching IDs, URLs, metadata, permissions, or playback code.
"""
from __future__ import annotations

import os
from pathlib import Path


# Single env that downstream stores read first.
_UPLOADS_ROOT_ENV = "UPLOADS_ROOT"
_LEGACY_FALLBACK  = Path("/app/backend/uploads")


def uploads_root() -> Path:
    """Return the directory where all media is stored.

    A production deployment should set UPLOADS_ROOT to a persistent
    mount path (e.g. /data/ourrealm). If the env var is unset we try
    /data/ourrealm (the canonical mount we recommend) and fall back to
    the ephemeral path only when /data isn't writable — keeping local
    dev and the historical container working without configuration.
    """
    explicit = os.environ.get(_UPLOADS_ROOT_ENV)
    if explicit:
        return Path(explicit)
    candidate = Path("/data/ourrealm")
    try:
        candidate.mkdir(parents=True, exist_ok=True)
        return candidate
    except (PermissionError, OSError):
        return _LEGACY_FALLBACK


def media_dir(kind: str, *, per_store_env: str | None = None) -> Path:
    """Resolve the persistent directory for a media kind ('audio'/'images'/'videos').

    `per_store_env` lets each store keep its existing env var name for
    back-compat — if set we honour it verbatim.
    """
    if per_store_env:
        explicit = os.environ.get(per_store_env)
        if explicit:
            p = Path(explicit)
            p.mkdir(parents=True, exist_ok=True)
            return p
    p = uploads_root() / kind
    p.mkdir(parents=True, exist_ok=True)
    return p


def is_persistent_storage_configured() -> bool:
    """True when uploads are NOT being written under the ephemeral
    legacy fallback. Used by admin diagnostics / startup logs."""
    return uploads_root() != _LEGACY_FALLBACK


def migrate_legacy_uploads() -> dict:
    """One-time copy of any files still living at the historical
    ephemeral path (`/app/backend/uploads/<kind>`) into the resolved
    persistent root. Safe to run on every boot — already-present files
    are left untouched (we only copy when the destination doesn't
    exist). Returns per-kind counts so the startup log records the
    outcome.
    """
    if not is_persistent_storage_configured():
        return {"skipped": "no persistent root configured"}
    out: dict = {}
    for kind in ("audio", "images", "videos"):
        src = _LEGACY_FALLBACK / kind
        dst = uploads_root() / kind
        if not src.exists() or src.resolve() == dst.resolve():
            out[kind] = 0
            continue
        dst.mkdir(parents=True, exist_ok=True)
        n = 0
        try:
            for f in src.iterdir():
                if not f.is_file():
                    continue
                target = dst / f.name
                if target.exists():
                    continue
                try:
                    # Use copy2 so mtime/permissions are preserved; the
                    # source file is left in place so any in-flight
                    # request can still resolve through the legacy path.
                    import shutil
                    shutil.copy2(f, target)
                    n += 1
                except (PermissionError, OSError):
                    continue
        except (PermissionError, OSError):
            pass
        out[kind] = n
    return out
