"""One-shot migration — rewrite stored media URLs to the stable
`/api/media/<kind>/<name>` proxy path.

Why
---
Older rows persist Cloudflare R2 public CDN URLs
(`https://media.ourrealm.social/<kind>/<name>`). Those URLs depend on
the bucket's public-access toggle staying on, which has historically
flipped off on every deploy. The frontend already transparently
rewrites public CDN URLs through the new `/api/media/...` proxy, so
playback works regardless — this script just brings the persisted
URLs in line with the new canonical shape for log hygiene and so
future raw DB queries surface a self-describing path.

Scope:
  • db.tracks.file_url        (sounds)
  • db.images.original_url
  • db.images.thumbnail_url
  • db.videos.url             (if present)
  • db.posts.media_url        (when a sound/image/video is attached
                              directly on the post row)
  • db.posts.sound_url
  • db.posts.image_url
  • db.posts.video_url
  • db.community_messages.media_url
  • db.messages.media_url

The script is idempotent — re-running after a clean state is a no-op.

Usage
-----
    cd /app/backend
    python scripts/migrate_to_media_proxy.py
    python scripts/migrate_to_media_proxy.py --dry-run
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.db import db

PUBLIC_CDN_HOST = "media.ourrealm.social"
ALLOWED_KINDS = ("audio", "images", "videos")


def rewrite(url: str | None) -> str | None:
    """Return the proxy URL if `url` is a CDN URL we own; else None."""
    if not url or not isinstance(url, str):
        return None
    # Match `https://media.ourrealm.social/<kind>/<name>`
    m = re.match(r"^https?://" + re.escape(PUBLIC_CDN_HOST) + r"/([^/]+)/([^?#]+)$", url)
    if m and m.group(1) in ALLOWED_KINDS:
        return f"/api/media/{m.group(1)}/{m.group(2)}"
    # Also catch the legacy `/api/sounds/file/<name>` pattern.
    if url.startswith("/api/sounds/file/"):
        name = url[len("/api/sounds/file/"):]
        if name and "/" not in name and ".." not in name:
            return f"/api/media/audio/{name}"
    return None


async def migrate_collection(coll, field, dry_run: bool, label: str):
    q = {field: {"$regex": f"^https?://{re.escape(PUBLIC_CDN_HOST)}/"}}
    total = await coll.count_documents(q)
    # Plus legacy pattern
    q_legacy = {field: {"$regex": "^/api/sounds/file/"}}
    total_legacy = await coll.count_documents(q_legacy)
    if total == 0 and total_legacy == 0:
        print(f"  {label}.{field}: nothing to do")
        return 0
    print(f"  {label}.{field}: {total} CDN + {total_legacy} legacy rows")
    rewritten = 0
    for filt in (q, q_legacy):
        async for row in coll.find(filt, {field: 1, "id": 1}):
            new_val = rewrite(row.get(field))
            if not new_val:
                continue
            if dry_run:
                print(f"    [would] _id={row.get('_id')} {row.get(field)!r} → {new_val!r}")
            else:
                await coll.update_one({"_id": row["_id"]}, {"$set": {field: new_val}})
            rewritten += 1
    print(f"    rewritten: {rewritten}")
    return rewritten


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    print(f"Dry-run: {args.dry_run}")
    print()

    targets = [
        (db.tracks,             "file_url",      "tracks"),
        (db.images,             "original_url",  "images"),
        (db.images,             "thumbnail_url", "images"),
        (db.videos,             "url",           "videos"),
        (db.videos,             "thumbnail_url", "videos"),
        (db.posts,              "media_url",     "posts"),
        (db.posts,              "sound_url",     "posts"),
        (db.posts,              "image_url",     "posts"),
        (db.posts,              "video_url",     "posts"),
        (db.posts,              "sound_cover_url","posts"),
        (db.posts,              "cover_url",     "posts"),
        (db.community_messages, "media_url",     "community_messages"),
        (db.messages,           "media_url",     "messages"),
    ]
    grand_total = 0
    for coll, field, label in targets:
        try:
            grand_total += await migrate_collection(coll, field, args.dry_run, label)
        except Exception as e:
            print(f"  [warn] {label}.{field}: {e}")

    print()
    print("Summary")
    print("=======")
    print(f"  Total rows {'that would be' if args.dry_run else ''} rewritten: {grand_total}")


if __name__ == "__main__":
    asyncio.run(main())
