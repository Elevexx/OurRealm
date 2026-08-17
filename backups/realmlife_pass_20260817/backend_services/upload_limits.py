"""Centralized upload-limits enforcement (Phase 5).

Server-enforced caps applied to all users except the founder `@stealth`.

Caps (per rolling 24h):
    images : 3 MB / file, 20 uploads / 24h
    videos : 100 MB / file, 3 uploads / 24h, 60s max
    sounds : 50 MB / file, 10 uploads / 24h, 10 min max

Per-post caps are enforced where posts are composed:
    images per post : 4
    videos per post : 1

Externally linked URLs (no file uploaded by us) are NOT counted.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from core.db import db


FOUNDER_USERNAME = "stealth"

LIMITS = {
    "image": {"max_bytes": 3   * 1024 * 1024, "per_day": 20, "max_seconds": None},
    "video": {"max_bytes": 100 * 1024 * 1024, "per_day":  3, "max_seconds": 60},
    "audio": {"max_bytes": 50  * 1024 * 1024, "per_day": 10, "max_seconds": 600},
}

# Mongo collections keyed by kind — must exist for the count window to work.
_COLLECTION = {
    "image": "images",
    "video": "videos",    # uploaded videos (independent of whether a post was created)
    "audio": "tracks",
}


def is_founder(user: dict) -> bool:
    return (user or {}).get("username", "").lower() == FOUNDER_USERNAME


async def enforce_pre_upload(user: dict, kind: str, size_bytes: int) -> None:
    """Throw HTTPException with a friendly message if the user is over a cap.
    Call this BEFORE writing anything to disk / Mongo.

    Founder (@stealth) is exempt — for testing.
    """
    if is_founder(user):
        return
    cfg = LIMITS.get(kind)
    if not cfg:
        return
    if size_bytes > cfg["max_bytes"]:
        mb = cfg["max_bytes"] // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"{kind.title()} too large — max {mb} MB per upload.")
    # Rolling 24h count
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    collection_name = _COLLECTION[kind]
    coll = getattr(db, collection_name)
    q = {"user_id": user["id"], "created_at": {"$gte": since}}
    n = await coll.count_documents(q)
    if n >= cfg["per_day"]:
        raise HTTPException(
            status_code=429,
            detail=f"Daily {kind} upload limit reached ({cfg['per_day']} per 24h). Try again later.",
        )


def enforce_duration(user: dict, kind: str, seconds: Optional[float]) -> None:
    """Reject content whose duration exceeds the per-kind cap.
    Call this AFTER duration is known (post-mutagen / ffprobe / client claim).
    """
    if is_founder(user):
        return
    cfg = LIMITS.get(kind)
    if not cfg or cfg["max_seconds"] is None:
        return
    if seconds is not None and seconds > cfg["max_seconds"] + 0.5:
        cap = cfg["max_seconds"]
        human = f"{cap // 60} minutes" if cap >= 120 and cap % 60 == 0 else f"{cap} seconds"
        raise HTTPException(
            status_code=400,
            detail=f"{kind.title()} too long — max {human}.",
        )


async def remaining_for_user(user: dict) -> dict:
    """For client UIs that want to show 'N images left today' before submit."""
    out = {}
    if is_founder(user):
        for k in LIMITS:
            out[k] = {"used": 0, "remaining": "unlimited", "per_day": LIMITS[k]["per_day"]}
        return out
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    for kind, cfg in LIMITS.items():
        collection_name = _COLLECTION[kind]
        coll = getattr(db, collection_name)
        q = {"user_id": user["id"], "created_at": {"$gte": since}}
        used = await coll.count_documents(q)
        out[kind] = {
            "used": used,
            "remaining": max(0, cfg["per_day"] - used),
            "per_day": cfg["per_day"],
        }
    return out


def per_post_cap(media_type: str) -> int:
    return {"image": 4, "video": 1}.get(media_type, 0)
