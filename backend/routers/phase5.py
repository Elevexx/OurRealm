"""Phase 5 — Home Dashboard layout + Admin Analytics.

Endpoints:
  GET    /api/dashboard/layout       — Read viewer's saved layout (creates default on first load).
  PUT    /api/dashboard/layout       — Persist the full layout.
  GET    /api/admin/analytics?range= — Admin (@stealth) only; aggregated metrics.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser


router = APIRouter(prefix="/api", tags=["dashboard", "admin"])


# ─── Dashboard layout ────────────────────────────────────────────────
ALLOWED_VISIBILITY = {"public", "friends", "private", "custom"}
ALLOWED_WIDGETS = {
    "for_you_feed", "weather", "realms", "groups", "top_news",
    "friend_activity", "notifications_summary", "trending_sounds",
    "trending_posts", "suggested_friends", "recently_viewed", "bookmarks",
    "events", "top_communities",
}
DEFAULT_LAYOUT: List[Dict[str, Any]] = [
    {"id": "for_you_feed", "type": "for_you_feed", "visibility": "private", "size": "lg", "config": {}},
    {"id": "weather",      "type": "weather",      "visibility": "private", "size": "md", "config": {}},
    {"id": "realms",       "type": "realms",       "visibility": "private", "size": "md", "config": {}},
    {"id": "groups",       "type": "groups",       "visibility": "private", "size": "md", "config": {}},
    {"id": "top_news",     "type": "top_news",     "visibility": "public",  "size": "md", "config": {}},
]


class WidgetIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=64)
    visibility: str = Field(default="private")
    size: str = Field(default="md")
    config: Dict[str, Any] = Field(default_factory=dict)
    custom_user_ids: List[str] = Field(default_factory=list)


class LayoutIn(BaseModel):
    widgets: List[WidgetIn] = Field(default_factory=list)


@router.get("/dashboard/layout")
async def get_layout(current: CurrentUser):
    doc = await db.dashboards.find_one({"user_id": current["id"]}, {"_id": 0})
    if doc and isinstance(doc.get("widgets"), list):
        return {"widgets": doc["widgets"]}
    # Seed default layout (first visit)
    await db.dashboards.update_one(
        {"user_id": current["id"]},
        {"$set": {"user_id": current["id"], "widgets": DEFAULT_LAYOUT,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"widgets": DEFAULT_LAYOUT}


@router.put("/dashboard/layout")
async def put_layout(current: CurrentUser, payload: LayoutIn):
    cleaned = []
    for w in payload.widgets[:32]:
        if w.type not in ALLOWED_WIDGETS:
            continue
        vis = w.visibility if w.visibility in ALLOWED_VISIBILITY else "private"
        cleaned.append({
            "id": w.id, "type": w.type, "visibility": vis,
            "size": w.size if w.size in {"sm", "md", "lg", "xl"} else "md",
            "config": w.config or {},
            "custom_user_ids": [x for x in (w.custom_user_ids or []) if isinstance(x, str)][:200]
                if vis == "custom" else [],
        })
    await db.dashboards.update_one(
        {"user_id": current["id"]},
        {"$set": {"user_id": current["id"], "widgets": cleaned,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"widgets": cleaned}


# ─── Admin analytics ─────────────────────────────────────────────────
ADMIN_USERNAME = "stealth"


def _range_to_since(rng: str) -> Optional[datetime]:
    now = datetime.now(timezone.utc)
    return {
        "24h":  now - timedelta(hours=24),
        "7d":   now - timedelta(days=7),
        "30d":  now - timedelta(days=30),
        "all":  None,
    }.get(rng, now - timedelta(days=7))


async def _series(collection, since: Optional[datetime], days: int, date_field: str = "created_at"):
    """Return list of {date, count} buckets — coarse, fast aggregate."""
    points = []
    for i in range(days):
        start = (datetime.now(timezone.utc) - timedelta(days=days - 1 - i)).replace(
            hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        q = {date_field: {"$gte": start.isoformat(), "$lt": end.isoformat()}}
        c = await collection.count_documents(q)
        points.append({"date": start.date().isoformat(), "count": c})
    return points


def _require_admin(current: dict):
    if (current.get("username") or "").lower() != ADMIN_USERNAME:
        raise HTTPException(status_code=403, detail="Admin access required")


@router.get("/admin/analytics")
async def admin_analytics(current: CurrentUser, range: str = "7d"):
    _require_admin(current)
    since = _range_to_since(range)
    days = {"24h": 1, "7d": 7, "30d": 30, "all": 30}.get(range, 7)

    # ── User metrics
    total_users = await db.users.count_documents({})
    new_signups = await db.users.count_documents(
        {"created_at": {"$gte": (since or datetime(2000, 1, 1, tzinfo=timezone.utc)).isoformat()}}
    ) if since else total_users
    # DAU/MAU approximated via post or message activity in window
    dau_since = datetime.now(timezone.utc) - timedelta(hours=24)
    mau_since = datetime.now(timezone.utc) - timedelta(days=30)
    dau_authors = await db.posts.distinct(
        "author_id", {"created_at": {"$gte": dau_since.isoformat()}})
    mau_authors = await db.posts.distinct(
        "author_id", {"created_at": {"$gte": mau_since.isoformat()}})

    # ── Content metrics
    q_since = {"created_at": {"$gte": since.isoformat()}} if since else {}
    posts_in_range = await db.posts.count_documents(q_since)
    media_pipe = [
        {"$match": q_since},
        {"$group": {"_id": "$media_type", "n": {"$sum": 1}}},
    ]
    media_dist = {r["_id"] or "thought": r["n"] async for r in db.posts.aggregate(media_pipe)}
    posts_series = await _series(db.posts, since, days)

    # ── Messaging metrics (best-effort across legacy threads/messages if present)
    messages_count = 0
    chats_count    = 0
    groups_count   = 0
    realms_count   = 0
    try:
        messages_count = await db.messages.count_documents(q_since)
        chats_count    = await db.chats.count_documents({})
        groups_count   = await db.groups.count_documents({})
        realms_count   = await db.realms.count_documents({})
    except Exception:
        pass

    # ── Sounds metrics
    tracks_in_range = await db.tracks.count_documents(q_since)
    sounds_pipe = [
        {"$match": q_since},
        {"$group": {"_id": "$category", "n": {"$sum": 1}}},
    ]
    sounds_dist = {r["_id"] or "Music": r["n"] async for r in db.tracks.aggregate(sounds_pipe)}
    top_sounds = []
    async for t in db.tracks.find({}, {"_id": 0, "id": 1, "title": 1, "plays": 1, "likes": 1, "category": 1})\
            .sort([("plays", -1), ("likes", -1)]).limit(10):
        top_sounds.append(t)
    total_plays = 0
    async for r in db.tracks.aggregate([{"$group": {"_id": None, "p": {"$sum": "$plays"}}}]):
        total_plays = r.get("p", 0)
    sounds_series = await _series(db.tracks, since, days)

    # ── Engagement
    likes_pipe = [{"$match": q_since},
                  {"$group": {"_id": None, "l": {"$sum": "$likes"}, "c": {"$sum": "$comments"}}}]
    engagement = {"likes": 0, "comments": 0}
    async for r in db.posts.aggregate(likes_pipe):
        engagement = {"likes": r.get("l", 0) or 0, "comments": r.get("c", 0) or 0}

    return {
        "range": range,
        "users": {
            "total": total_users, "new_signups": new_signups,
            "dau": len(dau_authors), "mau": len(mau_authors),
            "retention_pct": round(100 * len(dau_authors) / max(1, len(mau_authors)), 1),
        },
        "content": {
            "posts": posts_in_range,
            "media_distribution": media_dist,
            "engagement": engagement,
            "series": posts_series,
        },
        "messaging": {
            "messages": messages_count, "chats": chats_count,
            "groups": groups_count, "realms": realms_count,
        },
        "sounds": {
            "uploads_in_range": tracks_in_range,
            "category_distribution": sounds_dist,
            "total_plays": total_plays,
            "top": top_sounds,
            "series": sounds_series,
        },
    }
