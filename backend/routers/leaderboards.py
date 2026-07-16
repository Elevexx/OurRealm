"""Leaderboards — public rankings (real members only) + founder settings.
Backend-computed, cached snapshots (db.leaderboard_cache), never trusts client scores.
"""
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from core.analytics_filters import real_member_filter

router = APIRouter(prefix="/api", tags=["leaderboards"])

CATEGORIES = ["reputation", "level", "achievements", "posts", "likes",
              "comments", "followers", "realms", "weekly_activity", "alltime_activity"]
PERIODS = ["today", "week", "month", "all"]
DEFAULT_SETTINGS = {
    "enabled_categories": CATEGORIES, "category_order": CATEGORIES,
    "public": True, "friends_enabled": True, "realm_enabled": True,
    "cache_seconds": 300, "hidden_usernames": [], "show_movement": False,
    "show_profile_rank_summary": True, "top3_highlight": True,
    "tie_breaker": "reputation",
}


def _now():
    return datetime.now(timezone.utc)


async def get_settings() -> dict:
    doc = await db.leaderboard_settings.find_one({"_id": "settings"}) or {}
    return {**DEFAULT_SETTINGS, **{k: v for k, v in doc.items() if k in DEFAULT_SETTINGS}}


_indexes_ready = False


async def _ensure_indexes():
    global _indexes_ready
    if _indexes_ready:
        return
    _indexes_ready = True
    await db.user_level_progress.create_index([("current_level_number", -1)])
    await db.reputation_transactions.create_index([("created_at", 1), ("status", 1)])
    await db.user_activity_days.create_index([("day", 1)])


def _period_start(period: str):
    now = _now()
    if period == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    if period == "week":
        return (now - timedelta(days=7)).isoformat()
    if period == "month":
        return (now - timedelta(days=30)).isoformat()
    return None


async def _compute_rows(category: str, period: str) -> list[dict]:
    """Compute score per real member for a category. Bounded + indexed.
    NOTE: hidden users are INCLUDED here (kept in cache) so they retain a
    private rank; they are stripped from public results at serving time."""
    await _ensure_indexes()
    settings = await get_settings()
    q = real_member_filter()
    q["username"] = {"$exists": True, "$nin": [None, ""]}
    q["account_status"] = {"$nin": ["deleted_pending_restore", "purged", "deleted"]}
    users = {u["id"]: u async for u in db.users.find(
        q, {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1,
            "reputation_points": 1, "follower_count": 1, "friends": 1,
            "is_vip": 1, "role": 1}).limit(5000)}
    scores = {}
    since = _period_start(period)

    if category == "reputation":
        if since:
            pipe = [{"$match": {"created_at": {"$gte": since}, "status": "applied"}},
                    {"$group": {"_id": "$user_id", "s": {"$sum": "$amount"}}}]
            async for r in db.reputation_transactions.aggregate(pipe):
                scores[r["_id"]] = r["s"]
        else:
            scores = {uid: int(u.get("reputation_points") or 0) for uid, u in users.items()}
    elif category == "level":
        async for p in db.user_level_progress.find({}, {"_id": 0, "user_id": 1, "current_level_number": 1, "progress_percentage": 1}):
            if p["user_id"] in users:
                scores[p["user_id"]] = (p.get("current_level_number") or 0) * 1000 + (p.get("progress_percentage") or 0)
    elif category == "achievements":
        pipe = [{"$group": {"_id": "$user_id", "s": {"$sum": 1}}}]
        async for r in db.user_level_history.aggregate(pipe):
            scores[r["_id"]] = r["s"]
    elif category == "posts":
        match = {"deleted_at": {"$exists": False}}
        if since:
            match["created_at"] = {"$gte": since}
        pipe = [{"$match": match}, {"$group": {"_id": "$author_id", "s": {"$sum": 1}}}]
        async for r in db.posts.aggregate(pipe):
            scores[r["_id"]] = r["s"]
    elif category == "likes":
        pipe = [{"$match": {"deleted_at": {"$exists": False}}},
                {"$project": {"author_id": 1, "n": {"$size": {"$ifNull": ["$liked_by", []]}}}},
                {"$group": {"_id": "$author_id", "s": {"$sum": "$n"}}}]
        async for r in db.posts.aggregate(pipe):
            scores[r["_id"]] = r["s"]
    elif category == "comments":
        pipe = [{"$group": {"_id": "$post_id", "n": {"$sum": 1}}},
                {"$lookup": {"from": "posts", "localField": "_id", "foreignField": "id", "as": "p"}},
                {"$unwind": "$p"},
                {"$group": {"_id": "$p.author_id", "s": {"$sum": "$n"}}}]
        async for r in db.comments.aggregate(pipe):
            scores[r["_id"]] = r["s"]
    elif category == "followers":
        scores = {uid: int(u.get("follower_count") or 0) for uid, u in users.items()}
    elif category == "realms":
        pipe = [{"$group": {"_id": "$user_id", "s": {"$sum": 1}}}]
        async for r in db.community_memberships.aggregate(pipe):
            scores[r["_id"]] = r["s"]
    elif category in ("weekly_activity", "alltime_activity"):
        match = {}
        if category == "weekly_activity":
            match["day"] = {"$gte": (_now() - timedelta(days=7)).date().isoformat()}
        pipe = ([{"$match": match}] if match else []) + [{"$group": {"_id": "$user_id", "s": {"$sum": 1}}}]
        async for r in db.user_activity_days.aggregate(pipe):
            scores[r["_id"]] = r["s"]

    # level info for badges on rows
    levels = {}
    async for p in db.user_level_progress.find({}, {"_id": 0, "user_id": 1, "current_level_id": 1, "current_level_number": 1}):
        levels[p["user_id"]] = p
    level_names = {l["id"]: {"name": l["name"], "graphics": l.get("graphics") or {}}
                   async for l in db.progression_levels.find({}, {"_id": 0, "id": 1, "name": 1, "graphics": 1})}

    rows = []
    for uid, u in users.items():
        s = scores.get(uid, 0)
        lvl = levels.get(uid) or {}
        lname = level_names.get(lvl.get("current_level_id")) or {}
        rows.append({
            "user_id": uid, "username": u.get("username"), "name": u.get("name"),
            "avatar_url": u.get("avatar_url"), "score": s,
            "is_vip": bool(u.get("is_vip")), "role": u.get("role"),
            "level_name": lname.get("name"), "level_number": lvl.get("current_level_number"),
            "level_accent": (lname.get("graphics") or {}).get("accent_color"),
            "reputation": int(u.get("reputation_points") or 0),
        })
    if settings.get("tie_breaker") == "alphabetical":
        rows.sort(key=lambda r: (-r["score"], r["username"] or ""))
    else:
        rows.sort(key=lambda r: (-r["score"], -r["reputation"], r["username"] or ""))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows


async def _cached_rows(category: str, period: str) -> tuple[list, str]:
    settings = await get_settings()
    key = f"{category}:{period}"
    doc = await db.leaderboard_cache.find_one({"_id": key})
    if doc and (time.time() - doc.get("ts", 0)) < settings["cache_seconds"]:
        return doc["rows"], doc.get("updated_at")
    rows = await _compute_rows(category, period)
    updated = _now().isoformat()
    await db.leaderboard_cache.update_one(
        {"_id": key}, {"$set": {"rows": rows, "ts": time.time(), "updated_at": updated}}, upsert=True)
    return rows, updated


@router.get("/leaderboards")
async def leaderboards(current: CurrentUser,
                       category: str = "reputation", period: str = "all",
                       audience: str = "global", realm_id: Optional[str] = None,
                       q: Optional[str] = None, page: int = Query(1, ge=1),
                       page_size: int = Query(25, ge=5, le=50)):
    settings = await get_settings()
    if category not in CATEGORIES or category not in settings["enabled_categories"]:
        raise HTTPException(status_code=400, detail="Category not available")
    if period not in PERIODS:
        period = "all"
    rows, updated = await _cached_rows(category, period)

    # Hidden users: excluded from PUBLIC results only. Their own private
    # rank is preserved via the `me` field and /leaderboards/me.
    hidden = set(settings["hidden_usernames"])
    me_row = next((r for r in rows if r["user_id"] == current["id"]), None)
    if me_row and me_row["username"] in hidden:
        me_row = {**me_row, "hidden": True, "display_rank": me_row["rank"]}
    if hidden:
        rows = [r for r in rows if r["username"] not in hidden]

    if audience == "friends" and settings["friends_enabled"]:
        me = await db.users.find_one({"id": current["id"]}, {"_id": 0, "friends": 1})
        allowed = set((me or {}).get("friends") or []) | {current["id"]}
        rows = [r for r in rows if r["user_id"] in allowed]
    elif audience == "realm" and settings["realm_enabled"]:
        rq = {"community_id": realm_id} if realm_id else {"user_id": current["id"]}
        if not realm_id:
            m = await db.community_memberships.find_one(rq, {"_id": 0, "community_id": 1})
            realm_id = (m or {}).get("community_id")
        member_ids = {m["user_id"] async for m in db.community_memberships.find(
            {"community_id": realm_id}, {"_id": 0, "user_id": 1})} if realm_id else set()
        rows = [r for r in rows if r["user_id"] in member_ids]
    if q:
        ql = q.lower().strip()
        rows = [r for r in rows if ql in (r["username"] or "").lower() or ql in (r["name"] or "").lower()]
    # local rerank after filtering
    for i, r in enumerate(rows):
        r["display_rank"] = i + 1
    if not (me_row and me_row.get("hidden")):
        me_row = next((r for r in rows if r["user_id"] == current["id"]), None)
    total = len(rows)
    start = (page - 1) * page_size
    return {"category": category, "period": period, "audience": audience,
            "updated_at": updated, "total": total, "page": page, "page_size": page_size,
            "me": me_row, "rows": rows[start:start + page_size],
            "settings": {"top3_highlight": settings["top3_highlight"],
                         "friends_enabled": settings["friends_enabled"],
                         "realm_enabled": settings["realm_enabled"]}}


@router.get("/leaderboards/me")
async def my_rank(current: CurrentUser):
    rep_rows, _ = await _cached_rows("reputation", "all")
    week_rows, _ = await _cached_rows("reputation", "week")
    me = next((r for r in rep_rows if r["user_id"] == current["id"]), None)
    me_week = next((r for r in week_rows if r["user_id"] == current["id"]), None)
    return {"reputation": int((await db.users.find_one({"id": current["id"]},
                                                       {"_id": 0, "reputation_points": 1}) or {}).get("reputation_points") or 0),
            "global_rank": (me or {}).get("rank"), "total_ranked": len(rep_rows),
            "weekly_reputation": (me_week or {}).get("score") or 0}


# ── Founder settings ───────────────────────────────────────────────────
@router.get("/admin/leaderboards/settings")
async def settings_get(current: CurrentUser):
    require_founder(current)
    return {"settings": await get_settings(), "categories": CATEGORIES}


@router.patch("/admin/leaderboards/settings")
async def settings_patch(payload: dict, current: CurrentUser):
    require_founder(current)
    clean = {k: v for k, v in (payload or {}).items() if k in DEFAULT_SETTINGS}
    if "cache_seconds" in clean:
        clean["cache_seconds"] = max(30, min(int(clean["cache_seconds"]), 86400))
    if "enabled_categories" in clean:
        clean["enabled_categories"] = [c for c in CATEGORIES if c in clean["enabled_categories"]]
    if "tie_breaker" in clean and clean["tie_breaker"] not in ("reputation", "alphabetical"):
        clean["tie_breaker"] = "reputation"
    if "hidden_usernames" in clean:
        clean["hidden_usernames"] = [str(u).lower().strip() for u in clean["hidden_usernames"] if str(u).strip()]
    if not clean:
        raise HTTPException(status_code=400, detail="No valid settings")
    before = await get_settings()
    await db.leaderboard_settings.update_one({"_id": "settings"}, {"$set": clean}, upsert=True)
    if "tie_breaker" in clean and clean["tie_breaker"] != before.get("tie_breaker"):
        await db.leaderboard_cache.delete_many({})
    await db.progression_audit_logs.insert_one({
        "id": uuid.uuid4().hex, "founder_id": current["id"],
        "founder_username": current.get("username"), "action": "leaderboard_settings",
        "target_type": "leaderboards", "target_id": "settings",
        "before": {k: before.get(k) for k in clean}, "after": clean,
        "created_at": _now().isoformat(), "result": "ok"})
    return {"settings": await get_settings()}


@router.post("/admin/leaderboards/refresh")
async def refresh(current: CurrentUser):
    require_founder(current)
    await db.leaderboard_cache.delete_many({})
    await db.progression_audit_logs.insert_one({
        "id": uuid.uuid4().hex, "founder_id": current["id"],
        "founder_username": current.get("username"), "action": "leaderboard_refresh",
        "target_type": "leaderboards", "target_id": "cache",
        "created_at": _now().isoformat(), "result": "ok"})
    return {"ok": True}
