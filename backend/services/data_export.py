"""Download My Data — authenticated, expiring, download-limited exports.

Export files are JSON built from the user's OWN data only (no data
belonging solely to other users), stored as bytes in
`data_export_files` with a 48h TTL sweep, gated by auth + a per-export
token, capped at 5 downloads, and audit-logged on creation and access.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from core.db import db
from services.account_deletion import _audit

EXPORT_TTL_HOURS = 48
MAX_DOWNLOADS = 5


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _collect(user: dict) -> dict:
    uid = user["id"]
    profile = {k: v for k, v in user.items()
               if k not in ("password_hash", "_id", "friends")}
    posts = [p async for p in db.posts.find(
        {"author_id": uid}, {"_id": 0}).limit(2000)]
    comments = [c async for c in db.comments.find(
        {"author_id": uid}, {"_id": 0}).limit(2000)]
    friends_usernames = [u.get("username") async for u in db.users.find(
        {"id": {"$in": user.get("friends") or []}}, {"_id": 0, "username": 1})]
    audit = [a async for a in db.audit_log.find(
        {"$or": [{"actor_id": uid}, {"target_id": uid}]},
        {"_id": 0}).limit(1000)]
    return {
        "export_generated_at": _now().isoformat(),
        "profile": profile,
        "friends": friends_usernames,
        "posts": posts,
        "comments": comments,
        "account_audit_trail": audit,
        "note": "This export contains your own data only. Content belonging "
                "solely to other users is excluded.",
    }


async def create_export(user: dict) -> dict:
    open_job = await db.data_export_jobs.find_one(
        {"user_id": user["id"], "status": "ready",
         "expires_at": {"$gt": _now().isoformat()}}, {"_id": 0})
    if open_job:
        return {**open_job, "token": None,
                "note": "An export from the last 48 hours is still available."}
    token = secrets.token_urlsafe(24)
    data = await _collect(user)
    raw = json.dumps(data, default=str, indent=1).encode()
    job = {
        "id": uuid.uuid4().hex,
        "user_id": user["id"],
        "status": "ready",
        "token_hash": hashlib.sha256(token.encode()).hexdigest(),
        "created_at": _now().isoformat(),
        "expires_at": (_now() + timedelta(hours=EXPORT_TTL_HOURS)).isoformat(),
        "downloads": 0,
        "max_downloads": MAX_DOWNLOADS,
        "size_bytes": len(raw),
    }
    await db.data_export_jobs.insert_one(dict(job))
    await db.data_export_files.insert_one({"job_id": job["id"], "data": raw})
    await _audit("account.export_created", user["id"], user["id"],
                 export_id=job["id"], size_bytes=len(raw))
    job.pop("_id", None)
    return {**job, "token": token}


async def fetch_export(user: dict, export_id: str, token: str) -> bytes:
    job = await db.data_export_jobs.find_one(
        {"id": export_id, "user_id": user["id"]}, {"_id": 0})
    if not job or job.get("status") != "ready":
        raise ValueError("Export not found")
    if job["token_hash"] != hashlib.sha256((token or "").encode()).hexdigest():
        raise ValueError("Invalid export token")
    if _now().isoformat() > job["expires_at"]:
        raise ValueError("Export expired")
    if job["downloads"] >= job["max_downloads"]:
        raise ValueError("Download limit reached")
    f = await db.data_export_files.find_one({"job_id": export_id})
    if not f:
        raise ValueError("Export file no longer available")
    await db.data_export_jobs.update_one(
        {"id": export_id}, {"$inc": {"downloads": 1},
                            "$set": {"last_downloaded_at": _now().isoformat()}})
    await _audit("account.export_downloaded", user["id"], user["id"],
                 export_id=export_id)
    return bytes(f["data"])


async def run_export_expiry_pass() -> int:
    """Delete expired export files (audit rows preserved)."""
    now = _now().isoformat()
    removed = 0
    async for job in db.data_export_jobs.find(
            {"status": "ready", "expires_at": {"$lte": now}}, {"_id": 0, "id": 1}):
        await db.data_export_files.delete_many({"job_id": job["id"]})
        await db.data_export_jobs.update_one(
            {"id": job["id"]}, {"$set": {"status": "expired"}})
        removed += 1
    return removed
