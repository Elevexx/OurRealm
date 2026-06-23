"""Stable media proxy — 307-redirects to a fresh R2 presigned GET URL.

Why this exists
---------------
The old pipeline stored Cloudflare R2 public CDN URLs
(`https://media.ourrealm.social/<kind>/<name>`) directly in Mongo and
let the browser fetch them. Cloudflare's R2 "public access" toggle
kept flipping off (CI deploys, dashboard edits, etc.), 403'ing every
piece of media. The bucket's data plane is still healthy on every
flip — only the public CDN binding is unstable.

This router gives the app a **stable URL** that never depends on
public bucket access. The frontend stores `/api/media/<kind>/<name>`
in `track.file_url` / `image_url` / `video_url` and asks the backend
to resolve to a fresh signed GET URL each time it needs the bytes.
Signed URLs:

  • Are minted server-side from R2 credentials we control.
  • Work even when `media.ourrealm.social` is misbehaving.
  • Honour HTTP Range requests (so `<audio>` / `<video>` seeking work).
  • Carry the same `Content-Type` we set during the backfill.
  • Expire after `MEDIA_PROXY_TTL_SECONDS` (default 1 hour) — long
    enough for normal playback, short enough that a leaked URL is
    bounded in blast radius.

Frontend impact
---------------
Existing rows that still carry `https://media.ourrealm.social/...`
URLs continue to work because `lib/mediaUrl.js` transparently rewrites
them to `/api/media/<kind>/<name>`. New uploads land with the proxy
URL in Mongo. No client-side state, no DB migration required for
playback to recover — though the migration script that follows this
file backfills DB rows for log cleanliness.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response

from services.storage_adapter import (
    get_storage_adapter, S3CompatibleAdapter, _canonical_mime_for,
)
from services.storage import media_dir


log = logging.getLogger("ourrealm.media_proxy")

router = APIRouter(prefix="/api/media", tags=["media"])

# Allow-list of media kinds — keep this tight so we never proxy
# unexpected bucket prefixes (e.g. logs, exports).
_ALLOWED_KINDS: frozenset[str] = frozenset(["audio", "images", "videos"])

_MEDIA_PROXY_TTL = int(os.environ.get("MEDIA_PROXY_TTL_SECONDS") or "3600")
# Browsers will cache the 307 (and therefore reuse the same signed URL)
# for this many seconds. Keep it well below `_MEDIA_PROXY_TTL` so we
# never hand out a redirect that's about to expire mid-playback.
_REDIRECT_CACHE_MAX_AGE = max(60, _MEDIA_PROXY_TTL - 600)


def _safe_filename(name: str) -> str:
    """Reject path traversal + percent-encoded sneaks. Filenames in our
    storage layout are `<uuid>.<ext>` or `<uuid>_thumb.<ext>` — no
    slashes, no `..`, no NULs."""
    if not name or "/" in name or "\\" in name or ".." in name or "\x00" in name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    return name


@router.get("/{kind}/{name}")
async def media_proxy(
    kind: str,
    name: str,
    request: Request,
    range_header: Optional[str] = Header(None, alias="Range"),
):
    if kind not in _ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail="Unknown media kind")
    safe = _safe_filename(name)

    adapter = get_storage_adapter()
    canonical_ct = _canonical_mime_for(safe)

    # ── Cloud path: 307 to a fresh R2 presigned URL ──────────────────
    if isinstance(adapter, S3CompatibleAdapter):
        try:
            signed = adapter.presigned_get(
                kind, safe, ttl=_MEDIA_PROXY_TTL,
                content_type=canonical_ct if canonical_ct != "binary/octet-stream" else None,
            )
        except Exception as e:  # noqa: BLE001
            log.warning(f"[media-proxy] presigned mint failed for {kind}/{safe}: {e}")
            raise HTTPException(status_code=502, detail="Storage backend unreachable") from e

        # 307 preserves the request method AND any Range header set by
        # <audio>/<video> elements, which is exactly what we need for
        # progressive playback + seeking. Cache the redirect briefly so
        # we don't hammer the backend on every byte range.
        resp = RedirectResponse(url=signed, status_code=307)
        resp.headers["Cache-Control"] = f"private, max-age={_REDIRECT_CACHE_MAX_AGE}"
        # Hint to caches that the right value depends on the Range header
        # — different ranges of the same object are independent fetches.
        resp.headers["Vary"] = "Range, Origin"
        return resp

    # ── Local path: stream the file from disk (preview/dev fallback) ─
    local: Path = media_dir(kind) / safe
    if not local.exists() or not local.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(
        local,
        media_type=canonical_ct,
        headers={
            "Accept-Ranges":  "bytes",
            "Cache-Control":  "public, max-age=31536000, immutable",
        },
    )


@router.head("/{kind}/{name}")
async def media_proxy_head(kind: str, name: str):
    # Mirror GET so browsers that probe with HEAD before <audio> load
    # get the same redirect (some older WebKit builds do this).
    if kind not in _ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail="Unknown media kind")
    safe = _safe_filename(name)
    adapter = get_storage_adapter()
    if isinstance(adapter, S3CompatibleAdapter):
        try:
            signed = adapter.presigned_get(kind, safe, ttl=_MEDIA_PROXY_TTL)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=str(e)) from e
        resp = RedirectResponse(url=signed, status_code=307)
        resp.headers["Cache-Control"] = f"private, max-age={_REDIRECT_CACHE_MAX_AGE}"
        return resp
    local: Path = media_dir(kind) / safe
    if not local.exists():
        raise HTTPException(status_code=404, detail="Not found")
    # Return canonical type + size for clients that HEAD before fetching.
    return Response(
        status_code=200,
        headers={
            "Content-Type":   _canonical_mime_for(safe),
            "Content-Length": str(local.stat().st_size),
            "Accept-Ranges":  "bytes",
            "Cache-Control":  "public, max-age=31536000, immutable",
        },
    )
