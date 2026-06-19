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

    def put(self, kind: str, filename: str, src_path: Path) -> str:
        key = f"{kind}/{filename}"
        with src_path.open("rb") as fh:
            self._client().upload_fileobj(fh, self.bucket, key)
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
        account = os.environ.get("R2_ACCOUNT_ID")
        endpoint = f"https://{account}.r2.cloudflarestorage.com" if account else None
        adapter = S3CompatibleAdapter(
            name="r2",
            endpoint_url=endpoint,
            access_key=os.environ.get("R2_ACCESS_KEY_ID"),
            secret_key=os.environ.get("R2_SECRET_ACCESS_KEY"),
            bucket=os.environ.get("R2_BUCKET"),
            public_base_url=os.environ.get("R2_PUBLIC_BASE_URL"),
        )
        if not all([adapter.access_key, adapter.secret_key, adapter.bucket, account]):
            log.warning("STORAGE_PROVIDER=r2 but credentials incomplete — falling back to local")
            return LocalAdapter()
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
