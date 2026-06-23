"""One-shot backfill — fix `Content-Type` metadata on existing R2 objects.

Why
---
Older R2 uploads were written via `upload_fileobj` WITHOUT an explicit
`ContentType`, so R2 sniffed the type from the filename extension. For
some extensions it picks legacy MIMEs that Chromium browsers reject:

    .m4a  → `audio/x-m4a`   (Chrome rejects, Safari accepts)

This script walks every object under `audio/`, `images/`, and
`videos/` in the configured R2 bucket and, when the stored
Content-Type differs from the canonical one declared in
`storage_adapter._CANONICAL_MIME`, issues an in-place
`copy_object` to overwrite the metadata. The byte payload is
unchanged. Idempotent — re-running after a clean state is a no-op.

Usage
-----
    cd /app/backend
    python scripts/backfill_r2_content_types.py            # all prefixes
    python scripts/backfill_r2_content_types.py --dry-run  # report only
    python scripts/backfill_r2_content_types.py audio      # specific prefix(es)
"""
from __future__ import annotations

import os
import sys
import argparse

# Allow `python scripts/...` invocation.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.storage_adapter import (
    get_storage_adapter, S3CompatibleAdapter, _canonical_mime_for,
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "prefixes", nargs="*", default=["audio", "images", "videos"],
        help="Bucket prefixes to walk (default: audio images videos)",
    )
    ap.add_argument("--dry-run", action="store_true",
                    help="Don't issue copy_object; just report what would change")
    args = ap.parse_args()

    adapter = get_storage_adapter()
    if not isinstance(adapter, S3CompatibleAdapter):
        print("STORAGE_PROVIDER is not 'r2' — nothing to backfill. Aborting.")
        return
    client = adapter._client()
    bucket = adapter.bucket
    print(f"Bucket: {bucket}")
    print(f"Endpoint: {adapter.endpoint_url}")
    print(f"Prefixes: {args.prefixes}")
    print(f"Dry-run: {args.dry_run}")
    print()

    grand_changed = 0
    grand_ok = 0
    grand_skipped = 0
    grand_failed = 0

    for prefix in args.prefixes:
        print(f"=== walking {prefix}/ ===")
        token = None
        seen = 0
        changed = 0
        ok = 0
        skipped = 0
        failed = 0
        while True:
            kwargs = {"Bucket": bucket, "Prefix": f"{prefix}/", "MaxKeys": 1000}
            if token:
                kwargs["ContinuationToken"] = token
            resp = client.list_objects_v2(**kwargs)
            for obj in resp.get("Contents", []):
                seen += 1
                key = obj["Key"]
                filename = key.split("/", 1)[1] if "/" in key else key
                canonical = _canonical_mime_for(filename)
                if canonical == "binary/octet-stream":
                    skipped += 1
                    continue
                try:
                    meta = client.head_object(Bucket=bucket, Key=key)
                except Exception as e:
                    print(f"  [warn] head failed for {key}: {e}")
                    failed += 1
                    continue
                current = (meta.get("ContentType") or "").lower()
                if current == canonical:
                    ok += 1
                    continue
                if args.dry_run:
                    print(f"  [would] {key:<60} {current!r} → {canonical!r}")
                    changed += 1
                    continue
                # In-place copy with metadata replace. R2 (S3 API) requires
                # `CopySource` as `<bucket>/<key>` and `MetadataDirective`
                # of REPLACE to overwrite ContentType.
                try:
                    client.copy_object(
                        Bucket=bucket,
                        Key=key,
                        CopySource={"Bucket": bucket, "Key": key},
                        MetadataDirective="REPLACE",
                        ContentType=canonical,
                        # Preserve cache headers used by the storage adapter.
                        CacheControl="public, max-age=31536000, immutable",
                    )
                    changed += 1
                    print(f"  [ok] {key:<60} {current!r} → {canonical!r}")
                except Exception as e:
                    failed += 1
                    print(f"  [fail] {key}: {e}")
            token = resp.get("NextContinuationToken")
            if not resp.get("IsTruncated") or not token:
                break
        print(f"  prefix done: seen={seen} changed={changed} already_ok={ok} "
              f"skipped={skipped} failed={failed}")
        print()
        grand_changed += changed
        grand_ok += ok
        grand_skipped += skipped
        grand_failed += failed

    print("Summary")
    print("=======")
    print(f"  Changed:      {grand_changed}")
    print(f"  Already OK:   {grand_ok}")
    print(f"  Skipped:      {grand_skipped} (unrecognised extension)")
    print(f"  Failed:       {grand_failed}")


if __name__ == "__main__":
    main()
