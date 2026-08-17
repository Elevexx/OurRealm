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

# ── Data Map — single source of truth for per-category counts. Reused
# by the Privacy Center dashboard, category exports and Delete Preview.
DATA_CATEGORIES = [
    ("profile",       "Profile & settings"),
    ("posts",         "Posts"),
    ("comments",      "Comments"),
    ("messages",      "Messages"),
    ("media",         "Media (images, sounds, videos)"),
    ("friends",       "Friends & social graph"),
    ("fire_power",    "Fire Power history"),
    ("centers",       "Responsibility Center memberships"),
    ("games",         "Game progress"),
    ("courses",       "Course progress"),
    ("notifications", "Notifications"),
    ("sessions",      "Sessions & login history"),
]


async def data_map(user: dict) -> list[dict]:
    uid = user["id"]

    async def _c(coll, q):
        try:
            return await db[coll].count_documents(q)
        except Exception:  # noqa: BLE001
            return 0

    media = (await _c("images", {"user_id": uid})
             + await _c("sounds", {"user_id": uid})
             + await _c("videos", {"user_id": uid}))
    fire = (await _c("fire_wallet_transactions", {"user_id": uid})
            + await _c("fire_power_transactions", {"user_id": uid}))
    counts = {
        "profile": 1,
        "posts": await _c("posts", {"author_id": uid}),
        "comments": await _c("comments", {"author_id": uid}),
        "messages": await _c("messages", {"sender_id": uid}),
        "media": media,
        "friends": len(user.get("friends") or []),
        "fire_power": fire,
        "centers": await _c("responsibility_center_memberships", {"user_id": uid}),
        "games": await _c("game_progress", {"user_id": uid}),
        "courses": await _c("rc_course_progress", {"user_id": uid}),
        "notifications": await _c("notifications", {"recipient_id": uid}),
        "sessions": await _c("login_history", {"user_id": uid}),
    }
    return [{"key": k, "label": l, "count": counts.get(k, 0)}
            for k, l in DATA_CATEGORIES]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _collect(user: dict, categories: list[str] | None = None) -> dict:
    uid = user["id"]
    want = set(categories) if categories else None

    def _want(k):
        return want is None or k in want

    out = {
        "export_generated_at": _now().isoformat(),
        "categories": sorted(want) if want else "all",
        "note": "This export contains your own data only. Content belonging "
                "solely to other users is excluded.",
    }
    if _want("profile"):
        out["profile"] = {k: v for k, v in user.items()
                          if k not in ("password_hash", "_id", "friends")}
    if _want("friends"):
        out["friends"] = [u.get("username") async for u in db.users.find(
            {"id": {"$in": user.get("friends") or []}}, {"_id": 0, "username": 1})]
    if _want("posts"):
        out["posts"] = [p async for p in db.posts.find(
            {"author_id": uid}, {"_id": 0}).limit(2000)]
    if _want("comments"):
        out["comments"] = [c async for c in db.comments.find(
            {"author_id": uid}, {"_id": 0}).limit(2000)]
    if _want("messages"):
        out["messages"] = [m async for m in db.messages.find(
            {"sender_id": uid}, {"_id": 0}).limit(2000)]
    if _want("media"):
        out["media"] = {
            coll: [m async for m in db[coll].find(
                {"user_id": uid}, {"_id": 0, "data": 0, "bytes": 0}).limit(500)]
            for coll in ("images", "sounds", "videos")}
    if _want("fire_power"):
        out["fire_power"] = [t async for t in db.fire_wallet_transactions.find(
            {"user_id": uid}, {"_id": 0}).limit(2000)]
    if _want("centers"):
        out["centers"] = [m async for m in db.responsibility_center_memberships.find(
            {"user_id": uid}, {"_id": 0}).limit(200)]
    if _want("games"):
        out["games"] = [g async for g in db.game_progress.find(
            {"user_id": uid}, {"_id": 0}).limit(500)]
    if _want("courses"):
        out["courses"] = [c async for c in db.rc_course_progress.find(
            {"user_id": uid}, {"_id": 0}).limit(500)]
    if _want("notifications"):
        out["notifications"] = [n async for n in db.notifications.find(
            {"recipient_id": uid}, {"_id": 0}).limit(1000)]
    if _want("sessions"):
        out["sessions"] = [s async for s in db.login_history.find(
            {"user_id": uid}, {"_id": 0}).limit(200)]
    if want is None:
        out["account_audit_trail"] = [a async for a in db.audit_log.find(
            {"$or": [{"actor_id": uid}, {"target_id": uid}]}, {"_id": 0}).limit(1000)]
    return out


async def create_export(user: dict, categories: list[str] | None = None) -> dict:
    cats_sig = ",".join(sorted(categories)) if categories else "all"
    open_job = await db.data_export_jobs.find_one(
        {"user_id": user["id"], "status": "ready", "categories_sig": cats_sig,
         "expires_at": {"$gt": _now().isoformat()}}, {"_id": 0})
    if open_job:
        return {**open_job, "token": None,
                "note": "An export from the last 48 hours is still available."}
    token = secrets.token_urlsafe(24)
    data = await _collect(user, categories)
    raw = json.dumps(data, default=str, indent=1).encode()
    job = {
        "id": uuid.uuid4().hex,
        "user_id": user["id"],
        "status": "ready",
        "categories_sig": cats_sig,
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
                 export_id=job["id"], size_bytes=len(raw), categories=cats_sig)
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
