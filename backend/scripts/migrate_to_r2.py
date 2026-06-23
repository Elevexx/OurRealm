"""One-shot R2 migration script — uploads everything from
/data/ourrealm/{audio,images,videos}/ into the R2 bucket using the
same `{kind}/{filename}` key shape the storage adapter expects.

Also sets the CORS policy on the bucket so the production origin
can issue GET/HEAD with Range headers for video streaming.

Safe to re-run: uses ``head_object`` to skip files already present
in R2 at the same key (idempotent), so a partial run can be resumed.

Usage:
    python3 scripts/migrate_to_r2.py
"""
from __future__ import annotations
import json
import mimetypes
import os
import sys
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


LOCAL_ROOT = Path("/data/ourrealm")
KINDS = ("audio", "images", "videos")

# Explicit MIME map so we don't ship the wrong Content-Type to the
# browser (mimetypes.guess_type misses common video container types).
MIME_OVERRIDES = {
    ".mp4":  "video/mp4",
    ".mov":  "video/quicktime",
    ".webm": "video/webm",
    ".m4v":  "video/x-m4v",
    ".wav":  "audio/wav",
    ".mp3":  "audio/mpeg",
    ".m4a":  "audio/mp4",
    ".ogg":  "audio/ogg",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".gif":  "image/gif",
    ".webp": "image/webp",
    ".heic": "image/heic",
}


def _need(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.exit(f"Missing required env var {name}")
    return v


def _build_client():
    endpoint = os.environ.get("R2_ENDPOINT_URL") or (
        f"https://{_need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com"
    )
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=_need("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=_need("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
        # Larger multipart threshold for the 30 MB video file set.
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def _guess_mime(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in MIME_OVERRIDES:
        return MIME_OVERRIDES[ext]
    guess, _ = mimetypes.guess_type(str(path))
    return guess or "application/octet-stream"


def _exists(client, bucket: str, key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def main() -> int:
    bucket = os.environ.get("R2_BUCKET_NAME") or os.environ.get("R2_BUCKET")
    if not bucket:
        sys.exit("Missing R2_BUCKET_NAME / R2_BUCKET")
    client = _build_client()

    print(f"[migrate] target bucket: {bucket}")
    print(f"[migrate] source root:   {LOCAL_ROOT}")
    print("")

    summary: dict[str, dict[str, int]] = {}
    total_uploaded = 0
    total_skipped  = 0
    total_failed   = 0

    for kind in KINDS:
        kdir = LOCAL_ROOT / kind
        if not kdir.is_dir():
            print(f"[migrate] {kind:6} — directory missing, skipping")
            continue
        files = sorted([p for p in kdir.iterdir() if p.is_file()])
        ok = skipped = failed = 0
        for p in files:
            key = f"{kind}/{p.name}"
            if _exists(client, bucket, key):
                skipped += 1
                continue
            try:
                client.upload_file(
                    Filename=str(p),
                    Bucket=bucket,
                    Key=key,
                    ExtraArgs={
                        "ContentType": _guess_mime(p),
                        # Immutable cache — same uuid filenames as
                        # local; safe to cache forever.
                        "CacheControl": "public, max-age=31536000, immutable",
                    },
                )
                ok += 1
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"[migrate] FAIL {key}: {e}")
        summary[kind] = {"total": len(files), "uploaded": ok, "already_present": skipped, "failed": failed}
        print(f"[migrate] {kind:6}  total={len(files):4}  uploaded={ok:4}  skipped={skipped:4}  failed={failed}")
        total_uploaded += ok
        total_skipped  += skipped
        total_failed   += failed

    # ----------------------------------------------------------------- #
    # CORS — allow ourrealm.social (and preview origin) to issue GET +
    # HEAD with Range headers so <video> playback works cross-origin.
    # ----------------------------------------------------------------- #
    cors = {
        "CORSRules": [
            {
                "AllowedOrigins": [
                    "https://ourrealm.social",
                    "https://www.ourrealm.social",
                    "https://realm-deploy.preview.emergentagent.com",
                ],
                "AllowedMethods": ["GET", "HEAD"],
                "AllowedHeaders": ["Range", "If-Modified-Since", "If-None-Match", "Origin"],
                "ExposeHeaders": [
                    "Accept-Ranges",
                    "Content-Range",
                    "Content-Length",
                    "Content-Type",
                    "ETag",
                    "Last-Modified",
                ],
                "MaxAgeSeconds": 86400,
            },
        ],
    }
    try:
        client.put_bucket_cors(Bucket=bucket, CORSConfiguration=cors)
        print("\n[migrate] CORS applied to bucket:")
        print(json.dumps(cors, indent=2))
    except Exception as e:  # noqa: BLE001
        print(f"\n[migrate] CORS apply FAILED: {e}")
        total_failed += 1

    print("\n[migrate] SUMMARY")
    print(json.dumps(summary, indent=2))
    print(f"  TOTAL uploaded   = {total_uploaded}")
    print(f"  TOTAL skipped    = {total_skipped} (already in bucket — idempotent)")
    print(f"  TOTAL failed     = {total_failed}")
    return 0 if total_failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
