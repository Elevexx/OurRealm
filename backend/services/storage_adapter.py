"""Storage adapter layer (P1 scaffold — Feb 19 2026).

Why this module exists
----------------------
`services/storage.py` already abstracts the on-disk root used by every
media store (audio/images/videos). This file scaffolds the *next* layer
— swapping that local filesystem for an object store (Cloudflare R2 or
AWS S3) without touching any callers.

The current production deployment writes to the local persistent
volume at `/data/ourrealm` and that stays the default. When R2 / S3
credentials are added to the backend `.env` file, the adapter selected
by `get_storage_adapter()` flips automatically and uploads start
landing in the configured bucket. Reads keep working through the
existing `/api/<kind>/file/<id>` endpoints because the adapter is
content-addressed (the same logical filename is used both locally and
in the bucket).

Environment variables — drop into `backend/.env` to enable the cloud
adapter (the local adapter remains active until a provider is set):

    # Pick the provider — values: "local" (default), "r2", "s3"
    STORAGE_PROVIDER=r2

    # Cloudflare R2
    R2_ACCOUNT_ID=...
    R2_ACCESS_KEY_ID=...
    R2_SECRET_ACCESS_KEY=...
    R2_BUCKET=ourrealm-media
    R2_PUBLIC_BASE_URL=https://media.ourrealm.app   # CDN/public origin

    # AWS S3 (alternative)
    AWS_ACCESS_KEY_ID=...
    AWS_SECRET_ACCESS_KEY=...
    AWS_REGION=us-east-1
    S3_BUCKET=ourrealm-media
    S3_PUBLIC_BASE_URL=https://cdn.ourrealm.app

The adapter interface is intentionally minimal — `put`, `get_url`,
`exists`, `delete` — so adding GCS or Backblaze later is a
single-class addition. Streaming reads (HTTP 206) keep flowing through
the existing routers, which read straight from disk; the cloud
adapters expose a public CDN URL so 206 streaming is delegated to the
provider's edge.
"""
from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import Optional

from .storage import media_dir, uploads_root

log = logging.getLogger("ourrealm.storage_adapter")


# Canonical browser-friendly Content-Types. Used when uploading to R2/S3
# so the response carries a MIME every browser accepts — critically,
# `.m4a` MUST be served as `audio/mp4` (NOT the legacy `audio/x-m4a`,
# which Chrome / Edge / Brave reject with MEDIA_ERR_SRC_NOT_SUPPORTED).
# Keep this list explicit and minimal; falls through to `binary/octet-stream`.
_CANONICAL_MIME: dict[str, str] = {
    # Audio
    "mp3":  "audio/mpeg",
    "m4a":  "audio/mp4",        # canonical (NOT audio/x-m4a)
    "mp4a": "audio/mp4",
    "aac":  "audio/aac",
    "wav":  "audio/wav",
    "wave": "audio/wav",
    "ogg":  "audio/ogg",
    "oga":  "audio/ogg",
    "opus": "audio/ogg",
    "flac": "audio/flac",
    "webm": "audio/webm",       # ambiguous w/ video — caller can override
    # Images
    "jpg":  "image/jpeg",
    "jpeg": "image/jpeg",
    "png":  "image/png",
    "gif":  "image/gif",
    "webp": "image/webp",
    "avif": "image/avif",
    # Videos
    "mp4":  "video/mp4",
    "m4v":  "video/mp4",
    "mov":  "video/quicktime",
    "qt":   "video/quicktime",
    "mkv":  "video/x-matroska",
    "3gp":  "video/3gpp",
}


def _canonical_mime_for(filename: str) -> str:
    """Return the canonical Content-Type for an extension, or
    `binary/octet-stream` when we don't recognise it."""
    if "." not in filename:
        return "binary/octet-stream"
    ext = filename.rsplit(".", 1)[-1].lower()
    return _CANONICAL_MIME.get(ext, "binary/octet-stream")


class StorageAdapter:
    """Abstract storage backend. Implementations need not be thread-
    safe; the FastAPI request workers serialise uploads via the
    `services/<kind>_store.py` helpers."""

    name: str = "abstract"

    def put(self, kind: str, filename: str, src_path: Path) -> str:
        """Move/upload `src_path` into the backing store under
        `<kind>/<filename>`. Returns a public URL or path that can be
        served back to clients (relative URL for local, absolute CDN
        URL for cloud)."""
        raise NotImplementedError

    def get_local_path(self, kind: str, filename: str) -> Optional[Path]:
        """Best-effort local file path for HTTP-Range streaming. Local
        adapters always return a real path; cloud adapters return
        None and rely on `get_url()` for client redirects instead."""
        raise NotImplementedError

    def exists(self, kind: str, filename: str) -> bool:
        raise NotImplementedError

    def delete(self, kind: str, filename: str) -> bool:
        raise NotImplementedError

    def get_url(self, kind: str, filename: str) -> str:
        """Public URL clients can fetch directly. For the local
        adapter this is `/api/<kind>/file/<filename>`."""
        raise NotImplementedError


class LocalAdapter(StorageAdapter):
    """Default adapter — writes into the persistent volume at
    `${UPLOADS_ROOT}/<kind>/<filename>` and serves through the
    existing FastAPI routers."""

    name = "local"

    def put(self, kind: str, filename: str, src_path: Path) -> str:
        dst = media_dir(kind) / filename
        if src_path.resolve() != dst.resolve():
            import shutil
            shutil.move(str(src_path), str(dst))
        return f"/api/{kind}/file/{filename}"

    def get_local_path(self, kind: str, filename: str) -> Optional[Path]:
        p = media_dir(kind) / filename
        return p if p.exists() else None

    def exists(self, kind: str, filename: str) -> bool:
        return (media_dir(kind) / filename).exists()

    def delete(self, kind: str, filename: str) -> bool:
        p = media_dir(kind) / filename
        try:
            if p.exists():
                p.unlink()
                return True
        except (PermissionError, OSError):
            return False
        return False

    def get_url(self, kind: str, filename: str) -> str:
        return f"/api/{kind}/file/{filename}"


class S3CompatibleAdapter(StorageAdapter):
    """Shared logic for AWS S3 and Cloudflare R2 — both speak the S3
    API. This is a *scaffold*: `put / delete` raise until the
    `boto3` dependency is installed and credentials are provided in
    `.env`. The local persistent volume remains the active adapter
    until then, so the application never silently degrades."""

    def __init__(
        self,
        *,
        name: str,
        endpoint_url: Optional[str],
        access_key: Optional[str],
        secret_key: Optional[str],
        bucket: Optional[str],
        public_base_url: Optional[str],
        region: Optional[str] = None,
    ):
        self.name = name
        self.endpoint_url = endpoint_url
        self.access_key   = access_key
        self.secret_key   = secret_key
        self.bucket       = bucket
        self.public_base  = (public_base_url or "").rstrip("/")
        self.region       = region

    # Internal — initialise the boto3 S3 client lazily so a missing
    # boto3 install only crashes when the cloud adapter is actually
    # selected at runtime.
    def _client(self):
        try:
            import boto3  # noqa: WPS433 — optional dependency
        except ImportError as e:  # noqa: BLE001
            raise RuntimeError(
                f"Cloud storage adapter '{self.name}' requires the "
                "`boto3` package. Install with `pip install boto3` "
                "and add the credentials to backend/.env."
            ) from e
        return boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            region_name=self.region or "auto",
        )

    def put(self, kind: str, filename: str, src_path: Path,
            content_type: Optional[str] = None) -> str:
        """Upload `src_path` to `<kind>/<filename>` in the bucket.

        `content_type` is the **canonical** MIME the browser expects to
        see in the response. R2 (and S3-clones in general) sniff
        unknown extensions inconsistently — most notably `.m4a` is
        served as `audio/x-m4a` which Chrome rejects with
        `MEDIA_ERR_SRC_NOT_SUPPORTED`. Passing a canonical type here
        pins the response header so playback works in every browser.
        Falls back to extension-based inference when not supplied.
        """
        if content_type is None:
            content_type = _canonical_mime_for(filename)
        key = f"{kind}/{filename}"
        extra = {"ContentType": content_type} if content_type else {}
        with src_path.open("rb") as fh:
            self._client().upload_fileobj(fh, self.bucket, key, ExtraArgs=extra)
        # Caller is responsible for deleting the src file after upload
        # — leaving it in place lets the local persistent layer keep
        # serving the same asset until the CDN warms up.
        return self.get_url(kind, filename)

    def get_local_path(self, kind: str, filename: str) -> Optional[Path]:
        # Cloud adapter does not expose a local path — routers should
        # redirect to `get_url()` for direct client fetches.
        return None

    def exists(self, kind: str, filename: str) -> bool:
        try:
            self._client().head_object(Bucket=self.bucket, Key=f"{kind}/{filename}")
            return True
        except Exception:  # noqa: BLE001 — boto raises 404 via ClientError
            return False

    def delete(self, kind: str, filename: str) -> bool:
        try:
            self._client().delete_object(Bucket=self.bucket, Key=f"{kind}/{filename}")
            return True
        except Exception:  # noqa: BLE001
            return False

    def get_url(self, kind: str, filename: str) -> str:
        if self.public_base:
            return f"{self.public_base}/{kind}/{filename}"
        # Fall back to a presigned URL when no public CDN base is set.
        try:
            return self._client().generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": f"{kind}/{filename}"},
                ExpiresIn=3600,
            )
        except Exception:  # noqa: BLE001
            return f"/api/{kind}/file/{filename}"


# --------------------------------------------------------------------- #
# Adapter selection — single read at module import so swapping
# providers requires a backend restart (acceptable for credentials).
# --------------------------------------------------------------------- #
def _build_active_adapter() -> StorageAdapter:
    provider = (os.environ.get("STORAGE_PROVIDER") or "local").strip().lower()
    if provider == "r2":
        # Accept either an explicit endpoint URL (preferred, matches
        # the Cloudflare dashboard copy-paste) or a bare account id.
        endpoint = (os.environ.get("R2_ENDPOINT_URL") or "").strip() or None
        account  = os.environ.get("R2_ACCOUNT_ID")
        if not endpoint and account:
            endpoint = f"https://{account}.r2.cloudflarestorage.com"
        # Bucket lookup accepts both R2_BUCKET_NAME (Cloudflare's
        # canonical name) and the legacy R2_BUCKET fallback.
        bucket = os.environ.get("R2_BUCKET_NAME") or os.environ.get("R2_BUCKET")
        adapter = S3CompatibleAdapter(
            name="r2",
            endpoint_url=endpoint,
            access_key=os.environ.get("R2_ACCESS_KEY_ID"),
            secret_key=os.environ.get("R2_SECRET_ACCESS_KEY"),
            bucket=bucket,
            public_base_url=os.environ.get("R2_PUBLIC_BASE_URL"),
        )
        if not all([adapter.access_key, adapter.secret_key, adapter.bucket, endpoint]):
            log.warning("STORAGE_PROVIDER=r2 but credentials incomplete — falling back to local")
            return LocalAdapter()
        # NEVER log credentials. Bucket + public base are safe.
        log.info("Storage adapter: R2 bucket=%s base=%s", adapter.bucket, adapter.public_base)
        return adapter
    if provider == "s3":
        adapter = S3CompatibleAdapter(
            name="s3",
            endpoint_url=None,  # let boto3 resolve the regional endpoint
            access_key=os.environ.get("AWS_ACCESS_KEY_ID"),
            secret_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
            bucket=os.environ.get("S3_BUCKET"),
            public_base_url=os.environ.get("S3_PUBLIC_BASE_URL"),
            region=os.environ.get("AWS_REGION") or "us-east-1",
        )
        if not all([adapter.access_key, adapter.secret_key, adapter.bucket]):
            log.warning("STORAGE_PROVIDER=s3 but credentials incomplete — falling back to local")
            return LocalAdapter()
        log.info("Storage adapter: S3 bucket=%s region=%s", adapter.bucket, adapter.region)
        return adapter
    log.info("Storage adapter: local (root=%s)", uploads_root())
    return LocalAdapter()


_ACTIVE_ADAPTER: Optional[StorageAdapter] = None


def get_storage_adapter() -> StorageAdapter:
    global _ACTIVE_ADAPTER  # noqa: PLW0603 — single module-level cache
    if _ACTIVE_ADAPTER is None:
        _ACTIVE_ADAPTER = _build_active_adapter()
    return _ACTIVE_ADAPTER


def storage_status() -> dict:
    """Tiny snapshot for admin diagnostics."""
    a = get_storage_adapter()
    return {
        "provider": a.name,
        "uploads_root": str(uploads_root()),
        "public_base": getattr(a, "public_base", "") or None,
        "bucket": getattr(a, "bucket", "") or None,
    }
