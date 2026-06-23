"""Mirror locally-saved media to the active cloud storage adapter.

When the storage adapter is `LocalAdapter` (STORAGE_PROVIDER unset),
this is a no-op — uploads stay on the persistent volume and serve via
the legacy `/api/{kind}/...` FileResponse routes.

When the adapter is `S3CompatibleAdapter` (e.g. `STORAGE_PROVIDER=r2`),
we copy the file up to the cloud bucket using the same `{kind}/{name}`
key shape that `migrate_to_r2.py` used. The local file is intentionally
LEFT IN PLACE so the `/api/{kind}/...` routes keep working as a
fallback for any browser session still pointing at relative URLs
(e.g. cached service-worker bundles or old DB rows).

Callers receive the public URL of the freshly mirrored object — the
upload routes use this to overwrite the legacy `/api/...` URL they
were about to persist into MongoDB, so EVERY new upload flowing
through this helper ends up with an R2-served URL in the database.

Failure path: any error during the mirror is logged and swallowed.
The local-only URL is returned in that case. This keeps the upload
endpoint resilient — the user still gets their file, the
`/api/{kind}/...` route still serves it, and we can re-mirror later
via `migrate_to_r2.py` (idempotent).
"""
from __future__ import annotations
import logging
from pathlib import Path
from typing import Optional

from .storage_adapter import get_storage_adapter, S3CompatibleAdapter

log = logging.getLogger("ourrealm.r2_mirror")


def mirror_to_cloud(kind: str, filename: str, src_path: Path, fallback_url: str) -> str:
    """Upload `src_path` to the active storage adapter and return the
    public URL. When the adapter is local, `fallback_url` is returned
    unchanged."""
    adapter = get_storage_adapter()
    if not isinstance(adapter, S3CompatibleAdapter):
        return fallback_url
    try:
        if not src_path.is_file():
            return fallback_url
        public_url = adapter.put(kind, filename, src_path)
        # Some adapters return None / empty — defend against that.
        if not public_url or not isinstance(public_url, str):
            return fallback_url
        return public_url
    except Exception as e:  # noqa: BLE001 — never block the user's upload
        log.warning(f"[r2_mirror] failed to mirror {kind}/{filename}: {e}")
        return fallback_url
