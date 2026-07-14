"""Founder-only production data audit & repair suite.

  /api/admin/data-health/*

Every endpoint requires the founder role. NOTHING here mutates data
unless the founder explicitly triggers a repair/cleanup with the
required confirmation phrase. All mutations write audit records to
`cleanup_audit`.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from core.analytics_filters import (
    real_member_filter, is_valid_email, LEGACY_ADMIN_EMAIL, count_real_members,
)
from services.storage_adapter import get_storage_adapter, S3CompatibleAdapter, storage_status

log = logging.getLogger("ourrealm.data_audit")
router = APIRouter(prefix="/api/admin/data-health", tags=["admin-data-health"])

CONFIRM_PHRASE = "DELETE CONFIRMED SYNTHETIC DATA"

# ── URL classification helpers ───────────────────────────────────────
R2_PUBLIC_HOST = "media.ourrealm.social"
PROXY_RE = re.compile(r"^/api/media/(audio|images|videos)/([A-Za-z0-9._-]+)$")
LEGACY_LOCAL_RE = re.compile(r"^/api/(images|videos|sounds)/([A-Za-z0-9._-]+)$")
ABS_API_RE = re.compile(r"^https?://[^/]+(/api/(?:media/(?:audio|images|videos)|images|videos|sounds)/[A-Za-z0-9._-]+)")
R2_PUBLIC_RE = re.compile(r"^https?://" + re.escape(R2_PUBLIC_HOST) + r"/(audio|images|videos)/([A-Za-z0-9._-]+)")
PRESIGNED_RE = re.compile(r"^https?://[^/]+/(?:[a-z0-9-]+/)?(audio|images|videos)/([A-Za-z0-9._-]+)\?.*X-Amz-", re.I)

_KIND_FOR_LEGACY = {"images": "images", "videos": "videos", "sounds": "audio"}


def _classify_media_value(value: Optional[str]) -> dict:
    """Return {status, kind, name, proposed} for a stored media value."""
    if not value or not str(value).strip():
        return {"status": "none", "kind": None, "name": None, "proposed": None}
    v = str(value).strip()
    m = PROXY_RE.match(v)
    if m:
        return {"status": "proxy", "kind": m.group(1), "name": m.group(2), "proposed": None}
    m = PRESIGNED_RE.match(v)
    if m:
        kind, name = m.group(1), m.group(2)
        return {"status": "expired_presigned", "kind": kind, "name": name,
                "proposed": f"/api/media/{kind}/{name}"}
    m = R2_PUBLIC_RE.match(v)
    if m:
        kind, name = m.group(1), m.group(2)
        return {"status": "legacy_r2_public", "kind": kind, "name": name,
                "proposed": f"/api/media/{kind}/{name}"}
    m = ABS_API_RE.match(v)
    if m:
        rel = m.group(1)
        sub = _classify_media_value(rel)
        return {"status": "absolute_host", "kind": sub.get("kind"), "name": sub.get("name"),
                "proposed": sub.get("proposed") or rel}
    m = LEGACY_LOCAL_RE.match(v)
    if m:
        kind = _KIND_FOR_LEGACY[m.group(1)]
        return {"status": "legacy_local", "kind": kind, "name": m.group(2),
                "proposed": f"/api/media/{kind}/{m.group(2)}"}
    if v.startswith("http://") or v.startswith("https://"):
        return {"status": "external", "kind": None, "name": None, "proposed": None}
    if v.startswith("data:"):
        return {"status": "data_uri", "kind": None, "name": None, "proposed": None}
    return {"status": "unknown", "kind": None, "name": None, "proposed": None}


def _object_exists(kind: Optional[str], name: Optional[str]) -> Optional[bool]:
    if not kind or not name:
        return None
    try:
        return get_storage_adapter().exists(kind, name)
    except Exception:  # noqa: BLE001
        return None


def _email_hash(email: str) -> str:
    return hashlib.sha256((email or "").lower().encode()).hexdigest()[:12]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── 1. Identity & environment ────────────────────────────────────────
@router.get("/identity")
async def identity(current: CurrentUser):
    require_founder(current)
    mongo_url = os.environ.get("MONGO_URL", "")
    host = re.sub(r"//[^@/]+@", "//***@", mongo_url).split("//")[-1].split("/")[0]
    frontend_url = os.environ.get("FRONTEND_URL", "")
    env_label = "preview" if "preview.emergentagent" in frontend_url else "production"
    counts = {}
    for coll in ("users", "posts", "comments", "messages", "realms",
                 "community_memberships", "community_messages", "images",
                 "videos", "tracks", "notifications", "user_badges", "tickets"):
        try:
            counts[coll] = await db[coll].count_documents({})
        except Exception:  # noqa: BLE001
            counts[coll] = None
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "email": 1})
    real_members = await count_real_members(db)
    return {
        "env_label": env_label,
        "frontend_url": frontend_url,
        "db_name": os.environ.get("DB_NAME"),
        "mongo_host": host,
        "storage": storage_status(),
        "r2_bucket": os.environ.get("R2_BUCKET_NAME"),
        "founder_present": bool(founder),
        "collection_counts": counts,
        "real_member_count": real_members,
        "checked_at": _now(),
    }


# ── 2. Media audit (avatars + post media) ────────────────────────────
async def _audit_user_media(limit: int) -> list[dict]:
    out = []
    cursor = db.users.find(
        {}, {"_id": 0, "id": 1, "username": 1, "email": 1,
             "avatar_url": 1, "banner_url": 1, "is_system": 1},
    ).limit(limit)
    async for u in cursor:
        for field in ("avatar_url", "banner_url"):
            val = u.get(field)
            if not val:
                continue
            cls = _classify_media_value(val)
            exists = _object_exists(cls["kind"], cls["name"])
            status = cls["status"]
            if status == "proxy":
                repair = "ok" if exists in (True, None) else "missing_object"
            elif cls["proposed"]:
                repair = "repairable" if exists in (True, None) else "unrecoverable_missing_object"
            elif status == "external":
                repair = "external_ok"
            else:
                repair = status
            out.append({
                "record_type": "user", "field": field,
                "user_id": u["id"], "username": u.get("username"),
                "email": u.get("email"),
                "stored_value": val[:300],
                "classification": status,
                "object_key": f"{cls['kind']}/{cls['name']}" if cls["name"] else None,
                "object_exists": exists,
                "proposed_repair": cls["proposed"],
                "repair_status": repair,
            })
    return out


async def _audit_post_media(limit: int) -> list[dict]:
    out = []
    cursor = db.posts.find(
        {"$or": [{"image_url": {"$nin": [None, ""]}},
                 {"video_url": {"$nin": [None, ""]}},
                 {"media_url": {"$nin": [None, ""]}}]},
        {"_id": 0, "id": 1, "author_id": 1, "author_name": 1,
         "image_url": 1, "video_url": 1, "media_url": 1, "media_type": 1},
    ).sort("created_at", -1).limit(limit)
    async for p in cursor:
        for field in ("image_url", "video_url", "media_url"):
            val = p.get(field)
            if not val:
                continue
            cls = _classify_media_value(val)
            exists = _object_exists(cls["kind"], cls["name"])
            status = cls["status"]
            if status == "proxy":
                repair = "ok" if exists in (True, None) else "missing_object"
            elif cls["proposed"]:
                repair = "repairable" if exists in (True, None) else "unrecoverable_missing_object"
            elif status == "external":
                repair = "external_ok"
            else:
                repair = status
            out.append({
                "record_type": "post", "field": field,
                "post_id": p["id"], "author_id": p.get("author_id"),
                "author_name": p.get("author_name"),
                "media_type": p.get("media_type"),
                "stored_value": val[:300],
                "classification": status,
                "object_key": f"{cls['kind']}/{cls['name']}" if cls["name"] else None,
                "object_exists": exists,
                "proposed_repair": cls["proposed"],
                "repair_status": repair,
            })
    return out


@router.get("/media-audit")
async def media_audit(current: CurrentUser, scope: str = "all", limit: int = 500):
    require_founder(current)
    limit = min(max(limit, 1), 2000)
    rows: list[dict] = []
    if scope in ("all", "avatars"):
        rows += await _audit_user_media(limit)
    if scope in ("all", "posts"):
        rows += await _audit_post_media(limit)
    summary: dict = {}
    for r in rows:
        summary[r["repair_status"]] = summary.get(r["repair_status"], 0) + 1
    return {"rows": rows, "summary": summary, "generated_at": _now()}


class MediaRepairPayload(BaseModel):
    dry_run: bool = True


@router.post("/media-repair")
async def media_repair(payload: MediaRepairPayload, current: CurrentUser):
    """Rewrite provably-broken stored media values (expired presigned
    URLs, legacy public-CDN URLs, absolute hostnames) to the stable
    /api/media proxy path. Never touches working values, never touches
    external URLs, never rewrites when the target object is missing."""
    require_founder(current)
    repaired, skipped = [], []

    async def _repair_doc(coll, doc_id_field, doc, fields, record_type):
        updates = {}
        for f in fields:
            val = doc.get(f)
            if not val:
                continue
            cls = _classify_media_value(val)
            if not cls["proposed"]:
                continue
            exists = _object_exists(cls["kind"], cls["name"])
            if exists is False:
                skipped.append({"type": record_type, "id": doc[doc_id_field],
                                "field": f, "reason": "object missing in R2"})
                continue
            updates[f] = cls["proposed"]
        if updates:
            if not payload.dry_run:
                await coll.update_one({doc_id_field: doc[doc_id_field]}, {"$set": updates})
            repaired.append({"type": record_type, "id": doc[doc_id_field], "updates": updates})

    async for u in db.users.find({}, {"_id": 0, "id": 1, "avatar_url": 1, "banner_url": 1}):
        await _repair_doc(db.users, "id", u, ("avatar_url", "banner_url"), "user")
    async for p in db.posts.find(
        {"$or": [{"image_url": {"$regex": "^http|\\?"}},
                 {"video_url": {"$regex": "^http|\\?"}},
                 {"media_url": {"$regex": "^http|\\?"}}]},
        {"_id": 0, "id": 1, "image_url": 1, "video_url": 1, "media_url": 1},
    ):
        await _repair_doc(db.posts, "id", p, ("image_url", "video_url", "media_url"), "post")

    if not payload.dry_run and repaired:
        await db.cleanup_audit.insert_one({
            "id": uuid.uuid4().hex, "at": _now(), "by": current.get("username"),
            "action": "media_repair", "repaired_count": len(repaired),
            "skipped_count": len(skipped), "details": repaired[:200],
        })
    return {"dry_run": payload.dry_run, "repaired": repaired,
            "skipped": skipped, "counts": {"repaired": len(repaired), "skipped": len(skipped)}}


# ── 3. Synthetic account scan (dry-run classifier) ───────────────────
STRONG_FAKE_DOMAINS = {
    "example.com", "example.org", "example.net", "test.com", "test.local",
    "mailinator.com", "fake.com", "invalid.com", "localhost",
}
NAME_PATTERN = re.compile(
    r"(?:^|[._-])(test|demo|mock|seed|bot|fake|sample|placeholder|staging|preview|synthetic|qa)(?:$|[0-9._-])",
    re.I,
)


async def _linked_counts(user_id: str, email: str) -> dict:
    async def _c(coll, q):
        try:
            return await db[coll].count_documents(q)
        except Exception:  # noqa: BLE001
            return 0
    return {
        "posts": await _c("posts", {"author_id": user_id}),
        "comments": await _c("comments", {"user_id": user_id}),
        "reactions": await _c("reactions", {"user_id": user_id}),
        "messages": await _c("messages", {"$or": [{"from_user_id": user_id}, {"to_user_id": user_id}]}),
        "community_messages": await _c("community_messages", {"$or": [{"user_id": user_id}, {"author_id": user_id}]}),
        "realm_memberships": await _c("community_memberships", {"user_id": user_id}),
        "images": await _c("images", {"user_id": user_id}),
        "videos": await _c("videos", {"user_id": user_id}),
        "tracks": await _c("tracks", {"user_id": user_id}),
        "notifications": await _c("notifications", {"$or": [{"user_id": user_id}, {"actor_id": user_id}]}),
        "badges": await _c("user_badges", {"user_id": user_id}),
        "tickets": await _c("tickets", {"$or": [{"user_id": user_id}, {"created_by": user_id}]}),
    }


def _classify_user(u: dict, review: Optional[dict]) -> tuple[str, list[str]]:
    reasons: list[str] = []
    username = (u.get("username") or "").lower()
    email = (u.get("email") or "").lower()

    if username == "stealth" or u.get("is_founder") or u.get("role") == "founder":
        return "system_required", ["founder account"]
    if u.get("is_system") or u.get("is_protected") or username == "support":
        return "system_required", ["protected system account"]

    if review:
        if review.get("decision") == "real":
            return "real", [f"founder-reviewed as real on {review.get('at')}"]
        if review.get("decision") == "synthetic":
            return "confirmed_synthetic", [f"founder-confirmed synthetic on {review.get('at')}"]

    if email == LEGACY_ADMIN_EMAIL:
        return "confirmed_synthetic", ["neutralised legacy seed admin account"]
    if u.get("is_synthetic") is True:
        return "confirmed_synthetic", ["explicit is_synthetic flag"]
    if (u.get("account_type") or "") in {"bot", "demo", "test", "seed", "mock"}:
        return "confirmed_synthetic", [f"account_type={u.get('account_type')}"]
    if u.get("seeded") is True or u.get("source") in {"seed", "fixture", "demo"}:
        return "confirmed_synthetic", ["created by seed/fixture script"]

    domain = email.split("@")[-1] if "@" in email else ""
    if domain in STRONG_FAKE_DOMAINS:
        return "confirmed_synthetic", [f"placeholder email domain '{domain}'"]
    if not is_valid_email(email):
        reasons.append("invalid or missing email address")
    local = email.split("@")[0] if "@" in email else email
    if NAME_PATTERN.search(local):
        reasons.append(f"email local-part matches synthetic pattern ('{local}')")
    if NAME_PATTERN.search(username):
        reasons.append(f"username matches synthetic pattern ('{username}')")
    if reasons:
        return "likely_synthetic", reasons + ["name patterns alone never auto-delete — requires founder review"]
    return "real", []


@router.get("/synthetic-scan")
async def synthetic_scan(current: CurrentUser, include_counts: bool = True, limit: int = 1000):
    require_founder(current)
    reviews = {r["user_id"]: r async for r in db.synthetic_review.find({}, {"_id": 0})}
    rows = []
    totals = {"real": 0, "likely_synthetic": 0, "confirmed_synthetic": 0, "system_required": 0}
    cursor = db.users.find({}, {"_id": 0, "password_hash": 0}).limit(min(limit, 5000))
    async for u in cursor:
        cls, reasons = _classify_user(u, reviews.get(u["id"]))
        totals[cls] += 1
        row = {
            "user_id": u["id"],
            "username": u.get("username"),
            "email": u.get("email"),
            "name": u.get("name"),
            "created_at": u.get("created_at"),
            "classification": cls,
            "reasons": reasons,
            "friendships": len(u.get("friends") or []),
            "proposed_action": (
                "delete_with_cascade" if cls == "confirmed_synthetic"
                else "founder_review_required" if cls == "likely_synthetic"
                else "keep"
            ),
        }
        if include_counts:
            row["linked"] = await _linked_counts(u["id"], u.get("email") or "")
        rows.append(row)

    # Non-user synthetic content: seeded default realm poll widgets.
    seed_polls = await db.community_widgets.count_documents({
        "created_by": None, "type": "poll",
        "config.question": "What should we do this Friday?",
    })
    return {
        "rows": rows, "totals": totals,
        "other_synthetic": {"seeded_realm_poll_widgets": seed_polls},
        "generated_at": _now(),
    }


class ReviewPayload(BaseModel):
    user_id: str
    decision: str = Field(pattern="^(real|synthetic|clear)$")


@router.post("/review")
async def review_account(payload: ReviewPayload, current: CurrentUser):
    require_founder(current)
    if payload.decision == "clear":
        await db.synthetic_review.delete_one({"user_id": payload.user_id})
        return {"ok": True, "cleared": payload.user_id}
    await db.synthetic_review.update_one(
        {"user_id": payload.user_id},
        {"$set": {"user_id": payload.user_id, "decision": payload.decision,
                  "by": current.get("username"), "at": _now()}},
        upsert=True,
    )
    return {"ok": True, "user_id": payload.user_id, "decision": payload.decision}


# ── 4. Cascade cleanup (dry-run + execute) ───────────────────────────
class CleanupPayload(BaseModel):
    user_ids: list[str] = []
    delete_seed_poll_widgets: bool = False
    confirm: str = ""


async def _cleanup_plan_for_user(user_id: str) -> dict:
    """Everything that would be deleted for one user, incl. media keys."""
    media_keys: set[tuple[str, str]] = set()

    def _collect(val):
        cls = _classify_media_value(val)
        if cls["kind"] and cls["name"]:
            media_keys.add((cls["kind"], cls["name"]))

    async for p in db.posts.find({"author_id": user_id},
                                 {"_id": 0, "image_url": 1, "video_url": 1, "media_url": 1}):
        for f in ("image_url", "video_url", "media_url"):
            if p.get(f):
                _collect(p[f])
    async for i in db.images.find({"user_id": user_id}, {"_id": 0, "id": 1, "ext": 1, "original_url": 1}):
        if i.get("original_url"):
            _collect(i["original_url"])
    async for v in db.videos.find({"user_id": user_id}, {"_id": 0, "url": 1}):
        if v.get("url"):
            _collect(v["url"])
    async for t in db.tracks.find({"user_id": user_id}, {"_id": 0, "file_url": 1}):
        if t.get("file_url"):
            _collect(t["file_url"])
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "avatar_url": 1, "banner_url": 1})
    for f in ("avatar_url", "banner_url"):
        if u and u.get(f):
            _collect(u[f])

    linked = await _linked_counts(user_id, "")
    return {"user_id": user_id, "linked": linked,
            "media_objects": [f"{k}/{n}" for k, n in sorted(media_keys)]}


@router.post("/cleanup/dry-run")
async def cleanup_dry_run(payload: CleanupPayload, current: CurrentUser):
    require_founder(current)
    reviews = {r["user_id"]: r async for r in db.synthetic_review.find({}, {"_id": 0})}
    plans, rejected = [], []
    totals: dict = {}
    for uid in payload.user_ids[:500]:
        u = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
        if not u:
            rejected.append({"user_id": uid, "reason": "not found"})
            continue
        cls, reasons = _classify_user(u, reviews.get(uid))
        if cls != "confirmed_synthetic":
            rejected.append({"user_id": uid, "username": u.get("username"),
                             "reason": f"classification is '{cls}' — only confirmed_synthetic can be deleted"})
            continue
        plan = await _cleanup_plan_for_user(uid)
        plan["username"] = u.get("username")
        plan["email"] = u.get("email")
        plan["reasons"] = reasons
        plans.append(plan)
        for k, v in plan["linked"].items():
            totals[k] = totals.get(k, 0) + v
        totals["media_objects"] = totals.get("media_objects", 0) + len(plan["media_objects"])
    totals["users"] = len(plans)
    return {"plans": plans, "rejected": rejected, "proposed_totals_by_collection": totals}


async def _collect_retained_media_names(excluding_user_ids: list[str]) -> set[str]:
    """One-pass collection of every media object name referenced by
    RETAINED records — replaces per-object regex queries."""
    name_re = re.compile(r"/([A-Za-z0-9_-]+\.[A-Za-z0-9]{2,5})(?:\?|$)")
    names: set[str] = set()

    def _grab(val):
        if not val:
            return
        m = name_re.search(str(val).split("?")[0])
        if m:
            names.add(m.group(1))

    async for u in db.users.find({"id": {"$nin": excluding_user_ids}},
                                 {"_id": 0, "avatar_url": 1, "banner_url": 1}):
        _grab(u.get("avatar_url")); _grab(u.get("banner_url"))
    async for p in db.posts.find({"author_id": {"$nin": excluding_user_ids}},
                                 {"_id": 0, "image_url": 1, "video_url": 1, "media_url": 1}):
        for f in ("image_url", "video_url", "media_url"):
            _grab(p.get(f))
    async for t in db.tracks.find({"user_id": {"$nin": excluding_user_ids}},
                                  {"_id": 0, "file_url": 1}):
        _grab(t.get("file_url"))
    return names


@router.post("/cleanup/execute")
async def cleanup_execute(payload: CleanupPayload, current: CurrentUser):
    require_founder(current)
    if payload.confirm != CONFIRM_PHRASE:
        raise HTTPException(400, f"Confirmation phrase required: '{CONFIRM_PHRASE}'")
    reviews = {r["user_id"]: r async for r in db.synthetic_review.find({}, {"_id": 0})}
    results, rejected = [], []
    all_media: set[tuple[str, str]] = set()
    deleted_user_ids: list[str] = []

    for uid in payload.user_ids[:500]:
        u = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
        if not u:
            rejected.append({"user_id": uid, "reason": "not found"})
            continue
        cls, reasons = _classify_user(u, reviews.get(uid))
        if cls != "confirmed_synthetic":
            rejected.append({"user_id": uid, "username": u.get("username"),
                             "reason": f"refused — classification '{cls}'"})
            continue

        plan = await _cleanup_plan_for_user(uid)
        for key in plan["media_objects"]:
            kind, name = key.split("/", 1)
            all_media.add((kind, name))

        deleted: dict = {}
        post_ids = [p["id"] async for p in db.posts.find({"author_id": uid}, {"_id": 0, "id": 1})]

        async def _del(coll, q, label):
            try:
                res = await db[coll].delete_many(q)
                if res.deleted_count:
                    deleted[label] = res.deleted_count
            except Exception as e:  # noqa: BLE001
                deleted[f"{label}_error"] = str(e)[:100]

        await _del("comments", {"$or": [{"user_id": uid}, {"post_id": {"$in": post_ids}}]}, "comments")
        await _del("reactions", {"$or": [{"user_id": uid}, {"post_id": {"$in": post_ids}}]}, "reactions")
        await _del("posts", {"author_id": uid}, "posts")
        await _del("messages", {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]}, "messages")
        await _del("community_messages", {"$or": [{"user_id": uid}, {"author_id": uid}]}, "community_messages")
        await _del("community_memberships", {"user_id": uid}, "realm_memberships")
        await _del("notifications", {"$or": [{"user_id": uid}, {"actor_id": uid}]}, "notifications")
        await _del("images", {"user_id": uid}, "image_records")
        await _del("videos", {"user_id": uid}, "video_records")
        await _del("tracks", {"user_id": uid}, "track_records")
        await _del("user_badges", {"user_id": uid}, "badges")
        await _del("tickets", {"$or": [{"user_id": uid}, {"created_by": uid}]}, "tickets")
        await _del("user_activity_days", {"user_id": uid}, "activity_days")
        await _del("refresh_tokens", {"user_id": uid}, "refresh_tokens")
        await _del("password_reset_tokens", {"user_id": uid}, "reset_tokens")
        await _del("poll_votes", {"user_id": uid}, "poll_votes")
        await _del("synthetic_review", {"user_id": uid}, "review_rows")
        if u.get("email"):
            await _del("otp_codes", {"email": u["email"]}, "otp_codes")
            await _del("login_attempts", {"identifier": {"$regex": re.escape(u["email"])}}, "login_attempts")

        # Pull from social graphs of retained users — no orphaned refs.
        affected_friend_ids = await db.users.distinct("id", {"friends": uid})
        pull = await db.users.update_many(
            {}, {"$pull": {"friends": uid, "friend_requests_in": uid,
                           "friend_requests_out": uid, "inner_8": uid}})
        if pull.modified_count:
            deleted["graph_references_pulled"] = pull.modified_count
        # Keep follower_count in sync for everyone who lost this friend.
        for fid in affected_friend_ids:
            fdoc = await db.users.find_one({"id": fid}, {"_id": 0, "friends": 1})
            if fdoc is not None:
                await db.users.update_one(
                    {"id": fid}, {"$set": {"follower_count": len(fdoc.get("friends") or [])}})
        # Remove likes by this user on retained posts.
        try:
            likes = await db.posts.update_many({}, {"$pull": {"liked_by": uid}})
            if likes.modified_count:
                deleted["post_likes_pulled"] = likes.modified_count
        except Exception:  # noqa: BLE001
            pass

        res = await db.users.delete_one({"id": uid})
        deleted["user"] = res.deleted_count
        deleted_user_ids.append(uid)
        results.append({"user_id": uid, "username": u.get("username"),
                        "email": u.get("email"), "reasons": reasons, "deleted": deleted})

    # Seeded realm poll widgets (demo fixtures, created_by=None).
    seed_polls_deleted = 0
    if payload.delete_seed_poll_widgets:
        res = await db.community_widgets.delete_many({
            "created_by": None, "type": "poll",
            "config.question": "What should we do this Friday?",
        })
        seed_polls_deleted = res.deleted_count

    # R2 objects — delete only when no retained record references them.
    import asyncio
    r2_deleted, r2_kept = [], []
    adapter = get_storage_adapter()
    retained_names = await _collect_retained_media_names(deleted_user_ids)

    def _delete_batch(keys: list[tuple[str, str]]):
        done, kept = [], []
        for kind, name in keys:
            try:
                adapter.delete(kind, name)
                done.append(f"{kind}/{name}")
                if kind == "images" and "." in name and "_thumb" not in name:
                    base = name.rsplit(".", 1)[0]
                    for thumb in (f"{base}_thumb.jpg", f"{base}_thumb.gif"):
                        try:
                            adapter.delete("images", thumb)
                        except Exception:  # noqa: BLE001
                            pass
            except Exception as e:  # noqa: BLE001
                kept.append(f"{kind}/{name} (error: {str(e)[:60]})")
        return done, kept

    to_delete = []
    for kind, name in sorted(all_media):
        if name in retained_names:
            r2_kept.append(f"{kind}/{name}")
        else:
            to_delete.append((kind, name))
    if to_delete:
        done, errs = await asyncio.to_thread(_delete_batch, to_delete)
        r2_deleted.extend(done)
        r2_kept.extend(errs)

    audit = {
        "id": uuid.uuid4().hex, "at": _now(), "by": current.get("username"),
        "action": "synthetic_cleanup",
        "users_deleted": len(results), "rejected": len(rejected),
        "seed_poll_widgets_deleted": seed_polls_deleted,
        "r2_objects_deleted": r2_deleted, "r2_objects_kept_shared": r2_kept,
        "details": results,
    }
    await db.cleanup_audit.insert_one(dict(audit))
    audit.pop("_id", None)
    log.warning("[cleanup] founder=%s deleted %d synthetic users", current.get("username"), len(results))
    return {"ok": True, "results": results, "rejected": rejected,
            "seed_poll_widgets_deleted": seed_polls_deleted,
            "r2_deleted": r2_deleted, "r2_kept_shared": r2_kept}


@router.get("/cleanup/audit")
async def cleanup_audit_log(current: CurrentUser, limit: int = 100):
    require_founder(current)
    rows = [r async for r in db.cleanup_audit.find({}, {"_id": 0})
            .sort("at", -1).limit(min(limit, 500))]
    return {"rows": rows}


# ── 5. Signup health ─────────────────────────────────────────────────
@router.get("/signup-health")
async def signup_health(current: CurrentUser, limit: int = 200):
    require_founder(current)
    rows = [r async for r in db.signup_events.find({}, {"_id": 0})
            .sort("at", -1).limit(min(limit, 1000))]
    by_category: dict = {}
    ok_count = fail_count = 0
    async for r in db.signup_events.aggregate([
        {"$group": {"_id": {"category": "$category", "ok": "$ok"}, "n": {"$sum": 1}}},
    ]):
        key = r["_id"].get("category") or "unknown"
        by_category[key] = by_category.get(key, 0) + r["n"]
        if r["_id"].get("ok"):
            ok_count += r["n"]
        else:
            fail_count += r["n"]
    return {"recent": rows, "by_category": by_category,
            "successful": ok_count, "failed": fail_count}


# ── 6. Analytics eligibility backfill ────────────────────────────────
@router.post("/backfill-eligibility")
async def backfill_eligibility(current: CurrentUser):
    """Stamp durable account_type / is_synthetic / analytics_eligible /
    signup_completed fields on every user, based on verified evidence
    only (explicit flags + founder reviews — never name patterns)."""
    require_founder(current)
    reviews = {r["user_id"]: r async for r in db.synthetic_review.find({}, {"_id": 0})}
    stamped = {"human": 0, "system": 0, "synthetic": 0}
    async for u in db.users.find({}, {"_id": 0, "password_hash": 0}):
        cls, _ = _classify_user(u, reviews.get(u["id"]))
        if cls == "system_required":
            founder = (u.get("username") or "").lower() == "stealth" or u.get("is_founder")
            sets = {"account_type": "human" if founder else "system",
                    "is_synthetic": False,
                    "analytics_eligible": bool(founder),
                    "signup_completed": True}
            stamped["human" if founder else "system"] += 1
        elif cls == "confirmed_synthetic":
            sets = {"account_type": u.get("account_type") or "test",
                    "is_synthetic": True, "analytics_eligible": False}
            stamped["synthetic"] += 1
        else:  # real or likely (likely stays eligible until founder-confirmed)
            sets = {"account_type": "human", "is_synthetic": False,
                    "analytics_eligible": is_valid_email(u.get("email")),
                    "signup_completed": True}
            stamped["human"] += 1
        await db.users.update_one({"id": u["id"]}, {"$set": sets})
    await db.cleanup_audit.insert_one({
        "id": uuid.uuid4().hex, "at": _now(), "by": current.get("username"),
        "action": "backfill_eligibility", "stamped": stamped,
    })
    real = await count_real_members(db)
    return {"ok": True, "stamped": stamped, "real_member_count": real}


# ── 7. Orphan detection ──────────────────────────────────────────────
@router.get("/orphans")
async def orphans(current: CurrentUser, limit: int = 200):
    require_founder(current)
    user_ids = {u["id"] async for u in db.users.find({}, {"_id": 0, "id": 1})}
    orphan_posts = []
    async for p in db.posts.find({}, {"_id": 0, "id": 1, "author_id": 1,
                                      "author_name": 1, "media_type": 1,
                                      "created_at": 1}).limit(5000):
        if p.get("author_id") and p["author_id"] not in user_ids:
            orphan_posts.append(p)
            if len(orphan_posts) >= limit:
                break
    post_ids = {p["id"] async for p in db.posts.find({}, {"_id": 0, "id": 1})}
    orphan_comments = 0
    async for c in db.comments.find({}, {"_id": 0, "post_id": 1}).limit(10000):
        if c.get("post_id") and c["post_id"] not in post_ids:
            orphan_comments += 1
    orphan_memberships = 0
    async for m in db.community_memberships.find({}, {"_id": 0, "user_id": 1}).limit(10000):
        if m.get("user_id") and m["user_id"] not in user_ids:
            orphan_memberships += 1
    # Media records whose R2 object is missing (bounded sample).
    missing_media = []
    adapter = get_storage_adapter()
    if isinstance(adapter, S3CompatibleAdapter):
        async for v in db.videos.find({}, {"_id": 0, "id": 1, "ext": 1, "user_id": 1}).limit(200):
            name = f"{v['id']}.{v.get('ext', 'mp4')}"
            try:
                if not adapter.exists("videos", name):
                    missing_media.append({"kind": "videos", "name": name, "user_id": v.get("user_id")})
            except Exception:  # noqa: BLE001
                pass
    return {
        "orphan_posts": orphan_posts,
        "orphan_comment_count": orphan_comments,
        "orphan_membership_count": orphan_memberships,
        "media_records_missing_object": missing_media,
        "generated_at": _now(),
    }


# ── 8. Poll media_type migration ─────────────────────────────────────
POLL_MIGRATION_CONFIRM = "MIGRATE POLLS"


@router.get("/poll-migration/dry-run")
async def poll_migration_dry_run(current: CurrentUser):
    """Posts that carry a poll but are stored under the wrong media_type
    (usually 'thought' from the pre-normalization composer)."""
    require_founder(current)
    rows = []
    async for p in db.posts.find(
        {"poll": {"$ne": None}, "media_type": {"$ne": "poll"}},
        {"_id": 0, "id": 1, "author_username": 1, "media_type": 1,
         "created_at": 1, "poll.question": 1, "comments": 1, "likes": 1},
    ).sort("created_at", -1).limit(2000):
        rows.append({
            "post_id": p["id"],
            "author": p.get("author_username"),
            "current_media_type": p.get("media_type"),
            "proposed_media_type": "poll",
            "question": (p.get("poll") or {}).get("question"),
            "created_at": p.get("created_at"),
            "comments": p.get("comments"),
            "likes": p.get("likes"),
        })
    return {"rows": rows, "count": len(rows),
            "note": "Only the media_type field changes — votes, comments, reactions, media, ownership, visibility and timestamps are untouched."}


class PollMigrationPayload(BaseModel):
    confirm: str = ""


@router.post("/poll-migration/execute")
async def poll_migration_execute(payload: PollMigrationPayload, current: CurrentUser):
    require_founder(current)
    if payload.confirm != POLL_MIGRATION_CONFIRM:
        raise HTTPException(400, f"Confirmation phrase required: '{POLL_MIGRATION_CONFIRM}'")
    res = await db.posts.update_many(
        {"poll": {"$ne": None}, "media_type": {"$ne": "poll"}},
        {"$set": {"media_type": "poll"}},
    )
    await db.cleanup_audit.insert_one({
        "id": uuid.uuid4().hex, "at": _now(), "by": current.get("username"),
        "action": "poll_media_type_migration", "migrated": res.modified_count,
    })
    return {"ok": True, "migrated": res.modified_count}


# ── 9. Realm widget type normalization ───────────────────────────────
@router.get("/realm-widgets/dry-run")
async def realm_widget_dry_run(current: CurrentUser):
    """Realm widgets saved with a registry UUID (picker bug) or the
    'polls' alias instead of the canonical type key."""
    require_founder(current)
    from routers.realm_widgets import REALM_SUPPORTED_TYPES
    reg_by_id = {}
    async for r in db.widget_registry.find({}, {"_id": 0, "id": 1, "key": 1, "editor_config": 1}):
        reg_by_id[r["id"]] = r
    rows = []
    async for w in db.community_widgets.find(
        {"community_type": "realm"},
        {"_id": 0, "id": 1, "community_id": 1, "type": 1, "created_at": 1},
    ):
        t = w.get("type") or ""
        proposed, reason = None, None
        if t == "polls":
            proposed, reason = "poll", "'polls' alias → canonical 'poll'"
        elif t in reg_by_id:
            key = reg_by_id[t].get("key")
            proposed = "poll" if key == "polls" else key
            reason = f"registry UUID → key '{key}'"
        elif t not in REALM_SUPPORTED_TYPES and t not in ("poll", "hub"):
            reg = await db.widget_registry.find_one({"key": t}, {"_id": 0, "editor_config": 1})
            if not (reg and reg.get("editor_config")):
                reason = "unsupported in Realm context (renders a 'not available' card — remove or replace)"
        if proposed or reason:
            rows.append({"widget_id": w["id"], "realm_id": w.get("community_id"),
                         "current_type": t, "proposed_type": proposed, "reason": reason})
    return {"rows": rows, "fixable": sum(1 for r in rows if r["proposed_type"])}


@router.post("/realm-widgets/execute")
async def realm_widget_execute(payload: PollMigrationPayload, current: CurrentUser):
    require_founder(current)
    if payload.confirm != "NORMALIZE WIDGETS":
        raise HTTPException(400, "Confirmation phrase required: 'NORMALIZE WIDGETS'")
    report = await realm_widget_dry_run(current)
    fixed = 0
    for r in report["rows"]:
        if r["proposed_type"]:
            await db.community_widgets.update_one(
                {"id": r["widget_id"]}, {"$set": {"type": r["proposed_type"], "updated_at": _now()}})
            fixed += 1
    await db.cleanup_audit.insert_one({
        "id": uuid.uuid4().hex, "at": _now(), "by": current.get("username"),
        "action": "realm_widget_normalization", "fixed": fixed,
        "details": report["rows"][:200],
    })
    return {"ok": True, "fixed": fixed}


# ── 10. Relationship audit & repair ──────────────────────────────────
async def _relationship_report() -> dict:
    """Full friends-graph audit: dangling refs, refs to confirmed-synthetic
    accounts, asymmetric friendships (with evidence-based proposals), and
    stored vs recalculated follower counts."""
    reviews = {r["user_id"]: r async for r in db.synthetic_review.find({}, {"_id": 0})}
    users: dict[str, dict] = {}
    async for u in db.users.find({}, {"_id": 0, "id": 1, "username": 1, "friends": 1,
                                      "friend_requests_in": 1, "friend_requests_out": 1,
                                      "inner_8": 1, "follower_count": 1, "is_system": 1,
                                      "is_synthetic": 1, "account_type": 1, "email": 1,
                                      "is_founder": 1, "role": 1, "is_protected": 1,
                                      "seeded": 1, "source": 1, "created_at": 1}):
        users[u["id"]] = u
    synthetic_ids = {uid for uid, u in users.items()
                     if _classify_user(u, reviews.get(uid))[0] == "confirmed_synthetic"}

    rows = []
    totals = {"users_with_issues": 0, "dangling_refs": 0, "synthetic_refs": 0,
              "asymmetric": 0, "count_drift": 0}
    for uid, u in users.items():
        friends = u.get("friends") or []
        dangling = [f for f in friends if f not in users]
        synth = [f for f in friends if f in synthetic_ids]
        valid = [f for f in friends if f in users and f not in synthetic_ids]
        asymmetric = []
        for fid in valid:
            other = users[fid]
            if uid in (other.get("friends") or []):
                continue
            # Evidence-based proposal (June 2026 rules):
            #  • pending request either way → the one-way ref is premature → remove
            #  • DM history between the pair → mutual friendship evidence → restore
            #  • otherwise → no reliable evidence → remove the one-way ref
            pending = (uid in (other.get("friend_requests_in") or [])
                       or uid in (other.get("friend_requests_out") or [])
                       or fid in (u.get("friend_requests_in") or [])
                       or fid in (u.get("friend_requests_out") or []))
            if pending:
                proposal, reason = "remove_one_way", "friend request still pending — friendship never accepted"
            else:
                dm = await db.messages.find_one(
                    {"$or": [{"from_user_id": uid, "to_user_id": fid},
                             {"from_user_id": fid, "to_user_id": uid}]},
                    {"_id": 0, "id": 1})
                if dm:
                    proposal, reason = "restore_reciprocal", "DM history between both users indicates an accepted friendship"
                else:
                    proposal, reason = "remove_one_way", "no DM history or acceptance evidence — stale one-way reference"
            asymmetric.append({"other_id": fid, "other_username": other.get("username"),
                               "proposal": proposal, "reason": reason})
        stored = u.get("follower_count")
        recalculated = len([f for f in friends if f in users])
        drift = (stored is not None and int(stored) != recalculated) or stored is None
        if dangling or synth or asymmetric or drift:
            totals["users_with_issues"] += 1
            totals["dangling_refs"] += len(dangling)
            totals["synthetic_refs"] += len(synth)
            totals["asymmetric"] += len(asymmetric)
            if drift:
                totals["count_drift"] += 1
            rows.append({
                "user_id": uid, "username": u.get("username"),
                "stored_follower_count": stored, "recalculated_count": recalculated,
                "dangling_refs": dangling,
                "synthetic_refs": [{"id": s, "username": users[s].get("username")} for s in synth],
                "asymmetric": asymmetric,
            })
    return {"rows": rows, "totals": totals, "generated_at": _now()}


@router.get("/relationships")
async def relationships_audit(current: CurrentUser):
    require_founder(current)
    return await _relationship_report()


class RelationshipRepairPayload(BaseModel):
    confirm: str = ""


@router.post("/relationships/repair")
async def relationships_repair(payload: RelationshipRepairPayload, current: CurrentUser):
    """Executes the exact proposals from the audit: strips dangling refs,
    applies evidence-based asymmetry fixes, and resyncs follower_count.
    Refs to confirmed-synthetic accounts are left for the cleanup engine
    (deleting those accounts pulls the refs automatically)."""
    require_founder(current)
    if payload.confirm != "REPAIR RELATIONSHIPS":
        raise HTTPException(400, "Confirmation phrase required: 'REPAIR RELATIONSHIPS'")
    report = await _relationship_report()
    actions = {"dangling_removed": 0, "reciprocal_restored": 0,
               "one_way_removed": 0, "counts_resynced": 0}
    for row in report["rows"]:
        uid = row["user_id"]
        if row["dangling_refs"]:
            await db.users.update_one(
                {"id": uid},
                {"$pull": {"friends": {"$in": row["dangling_refs"]},
                           "friend_requests_in": {"$in": row["dangling_refs"]},
                           "friend_requests_out": {"$in": row["dangling_refs"]},
                           "inner_8": {"$in": row["dangling_refs"]}}})
            actions["dangling_removed"] += len(row["dangling_refs"])
        for a in row["asymmetric"]:
            if a["proposal"] == "restore_reciprocal":
                await db.users.update_one({"id": a["other_id"]}, {"$addToSet": {"friends": uid}})
                actions["reciprocal_restored"] += 1
            else:
                await db.users.update_one(
                    {"id": uid}, {"$pull": {"friends": a["other_id"], "inner_8": a["other_id"]}})
                actions["one_way_removed"] += 1
    # Final pass — resync follower_count for every user from the repaired graph.
    user_ids = {u["id"] async for u in db.users.find({}, {"_id": 0, "id": 1})}
    async for u in db.users.find({}, {"_id": 0, "id": 1, "friends": 1, "follower_count": 1}):
        real = len([f for f in (u.get("friends") or []) if f in user_ids])
        if u.get("follower_count") != real:
            await db.users.update_one({"id": u["id"]}, {"$set": {"follower_count": real}})
            actions["counts_resynced"] += 1
    await db.cleanup_audit.insert_one({
        "id": uuid.uuid4().hex, "at": _now(), "by": current.get("username"),
        "action": "relationship_repair", "actions": actions,
        "details": report["rows"][:200],
    })
    return {"ok": True, "actions": actions}
