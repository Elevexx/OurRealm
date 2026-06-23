"""One-shot migration — rewrite legacy `file_url` values on `db.tracks`.

Symptom this fixes
------------------
Old sound rows in `db.tracks` carry `file_url` strings of the form

    /api/sounds/file/<id>.<ext>

which point at the local-disk fallback route. After the R2 migration
the files were copied to Cloudflare R2 at `audio/<id>.<ext>`, but the
DB rows themselves were never updated. In preview the local-disk route
still resolves because the volume is intact, so playback works. In
PRODUCTION the disk starts empty on every container rotation — the
file is 404 and the player silently fails with a blank 0:00 / 0:00
mini-player (no surface error).

This script:
  1. Finds every track row whose `file_url` starts with `/api/sounds/file/`.
  2. HEADs the equivalent R2 key (`audio/<filename>`).
  3. Rewrites `file_url` to the canonical R2 public URL when the R2
     object exists. When R2 doesn't have the file, the row is left
     alone (and logged) — the legacy URL is the only working pointer.
  4. Adds a `_legacy_file_url_migrated_at` audit field so re-runs are
     idempotent and we can roll-back if needed.

Idempotent. Safe to re-run.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone

# Make the script runnable both standalone (`python -m backend.scripts...`)
# and inside the backend container (`python scripts/migrate_legacy_sound_urls.py`).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.db import db
from services.storage_adapter import get_storage_adapter, S3CompatibleAdapter


LEGACY_PREFIX = "/api/sounds/file/"


async def main():
    adapter = get_storage_adapter()
    if not isinstance(adapter, S3CompatibleAdapter):
        print("STORAGE_PROVIDER is not 'r2' — no migration target. Aborting.")
        return

    public_base = (adapter.public_base or "").rstrip("/")
    if not public_base:
        print("R2 adapter has no public_base_url — cannot rewrite. Aborting.")
        return

    legacy_q = {"file_url": {"$regex": f"^{LEGACY_PREFIX}"}}
    total = await db.tracks.count_documents(legacy_q)
    print(f"Found {total} tracks with legacy file_url to evaluate.")

    rewritten = 0
    skipped_missing_in_r2 = 0
    skipped_missing_filename = 0
    seen = 0

    cursor = db.tracks.find(legacy_q, {"_id": 0, "id": 1, "file_url": 1, "title": 1})
    async for row in cursor:
        seen += 1
        legacy = row.get("file_url") or ""
        filename = legacy[len(LEGACY_PREFIX):].strip()
        if not filename or "/" in filename or ".." in filename:
            skipped_missing_filename += 1
            print(f"  [skip] bad filename in row {row.get('id')}: {legacy!r}")
            continue

        # R2 key uses the same shape that `r2_mirror.mirror_to_cloud` writes.
        try:
            r2_has = adapter.exists("audio", filename)
        except Exception as e:
            print(f"  [warn] head_object failed for {filename}: {e}")
            r2_has = False

        if not r2_has:
            skipped_missing_in_r2 += 1
            print(f"  [skip] R2 has no audio/{filename} for track {row.get('id')} — leaving legacy URL")
            continue

        new_url = f"{public_base}/audio/{filename}"
        await db.tracks.update_one(
            {"id": row["id"]},
            {
                "$set": {
                    "file_url": new_url,
                    "_legacy_file_url_migrated_at": datetime.now(timezone.utc).isoformat(),
                    "_legacy_file_url_was":         legacy,
                },
            },
        )
        rewritten += 1
        print(f"  [ok] {row['id']!s:<32} {legacy!s:<50} → {new_url}")

    print()
    print("Migration summary")
    print("=================")
    print(f"  Total legacy rows seen:          {seen}")
    print(f"  Rewritten to R2 URL:             {rewritten}")
    print(f"  Skipped (R2 missing the file):   {skipped_missing_in_r2}")
    print(f"  Skipped (bad filename):          {skipped_missing_filename}")


if __name__ == "__main__":
    asyncio.run(main())
