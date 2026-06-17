"""Phase F — Hashtag system: extraction, indexing, analytics, feeds.

Storage:
    db.hashtags  — one document per unique tag
        { tag: "crypto", first_used_at, last_used_at, usage_count, post_count }
    db.posts.hashtags — array on each post (lowercase, deduped). Indexed.
    db.system_pin   — singleton document with current pinned post id (Phase F.6).
        { _id: "pinned_post", post_id: "...", pinned_by: "stealth",
          pinned_at: ISO, expires_at: ISO | null }

The extractor is intentionally permissive: any `#<word>` token where `word`
matches `[A-Za-z0-9_]+` is normalised to lowercase and deduped per post.
Categories map 1:1 to slugified hashtag (lowercase, alphanumerics only).
"""
from __future__ import annotations

import re
import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from fastapi import APIRouter, HTTPException, Query

from core.db import db
from core.deps import CurrentUser

logger = logging.getLogger("ourrealm.hashtags")
router = APIRouter(prefix="/api/hashtags", tags=["hashtags"])

# Mapping of OurRealm INTEREST CATEGORIES → canonical hashtag slug.
# Preserved 1:1 with the existing "Pick Your Interests" cards. Adding a
# new category here makes its hashtag instantly recognised by feed
# prioritisation, with zero migration. New hashtags not in this map still
# get tracked but do NOT auto-create category cards (per spec).
CATEGORY_HASHTAGS = {
    "Crypto":        "crypto",
    "Gaming":        "gaming",
    "Music":         "music",
    "Sports":        "sports",
    "Technology":    "technology",
    "Art":           "art",
    "Fashion":       "fashion",
    "Travel":        "travel",
    "Food":          "food",
    "Fitness":       "fitness",
    "Movies":        "movies",
    "Books":         "books",
    "Photography":   "photography",
    "Cars":          "cars",
    "DJ":            "dj",
    "Festivals":     "festivals",
}

HASHTAG_RE = re.compile(r"#([A-Za-z0-9_]+)")
ADMIN_USERNAMES = {"stealth", "support"}


# ──────────────────────────────────────────────────────────────────
# Pure helpers
# ──────────────────────────────────────────────────────────────────
def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def extract_hashtags(text: Optional[str]) -> list[str]:
    """Return unique lowercase hashtags from `text`. Empty list if none."""
    if not text:
        return []
    found = HASHTAG_RE.findall(text)
    seen, out = set(), []
    for raw in found:
        tag = raw.lower()
        if tag and tag not in seen:
            seen.add(tag)
            out.append(tag)
    return out


async def index_post_hashtags(post_id: str, text: Optional[str]) -> list[str]:
    """Idempotently store + upsert hashtag counters for a single post.

    Returns the list of tags found (may be empty). Safe to call multiple
    times for the same post — counts are based on a per-post diff so we
    don't double-count when an edit changes the tag set.
    """
    new_tags = extract_hashtags(text)
    existing = await db.posts.find_one({"id": post_id}, {"_id": 0, "hashtags": 1})
    old_tags = (existing or {}).get("hashtags") or []
    if set(old_tags) == set(new_tags):
        return new_tags
    # Persist the array on the post (indexed; used by the hashtag feed).
    await db.posts.update_one({"id": post_id}, {"$set": {"hashtags": new_tags}})
    now_iso = datetime.now(timezone.utc).isoformat()
    # Per-tag counter diffs.
    added = set(new_tags) - set(old_tags)
    removed = set(old_tags) - set(new_tags)
    for tag in added:
        await db.hashtags.update_one(
            {"tag": tag},
            {
                "$setOnInsert": {"tag": tag, "first_used_at": now_iso},
                "$set": {"last_used_at": now_iso},
                "$inc": {"usage_count": 1, "post_count": 1},
            },
            upsert=True,
        )
    for tag in removed:
        await db.hashtags.update_one(
            {"tag": tag},
            {"$inc": {"post_count": -1}},
        )
    return new_tags


async def ensure_indexes() -> None:
    """Idempotent index creation; called at startup."""
    await db.posts.create_index("hashtags")
    await db.posts.create_index([("created_at", -1)])
    await db.hashtags.create_index("tag", unique=True)
    await db.hashtags.create_index([("usage_count", -1)])
    await db.hashtags.create_index([("last_used_at", -1)])


async def migrate_index_all_posts() -> dict:
    """Retroactively index every existing post. Idempotent."""
    n_posts, n_tags = 0, 0
    cursor = db.posts.find({}, {"_id": 0, "id": 1, "content": 1})
    async for p in cursor:
        tags = await index_post_hashtags(p["id"], p.get("content") or "")
        n_posts += 1
        n_tags += len(tags)
    logger.info(f"[hashtags] retro-indexed {n_posts} posts, found {n_tags} hashtag uses")
    return {"posts_indexed": n_posts, "hashtag_uses_total": n_tags}


# ──────────────────────────────────────────────────────────────────
# REST routes
# ──────────────────────────────────────────────────────────────────
@router.get("/{tag}/feed")
async def hashtag_feed(tag: str, limit: int = 30, before: Optional[str] = None):
    """Reverse-chronological feed of posts containing `#tag`.

    Public — no auth required to view (matches the public-post visibility
    rules). Posts with `audience.visibility != 'public'` are filtered out.
    """
    norm = (tag or "").lstrip("#").lower()
    if not norm:
        raise HTTPException(status_code=400, detail="Empty hashtag")
    filt: dict = {
        "hashtags": norm,
        # Public-only — same rule used by the main /posts/feed.
        "$or": [
            {"audience.visibility": "public"},
            {"audience": None},
            {"audience": {"$exists": False}},
        ],
    }
    if before:
        filt["created_at"] = {"$lt": before}
    cursor = db.posts.find(filt, {"_id": 0}).sort([("created_at", -1)]).limit(limit)
    posts = [p async for p in cursor]
    total = await db.posts.count_documents({"hashtags": norm})
    return {"tag": norm, "total": total, "posts": posts}


@router.get("")
async def list_hashtags(
    current: CurrentUser,
    q: Optional[str] = None,
    sort: str = "usage",
    limit: int = 50,
):
    """Admin-only catalogue of every known hashtag."""
    if current.get("username") not in ADMIN_USERNAMES:
        raise HTTPException(status_code=403, detail="Admin only")
    filt = {}
    if q:
        filt["tag"] = {"$regex": f"^{re.escape(q.lower())}"}
    sort_key = "usage_count" if sort == "usage" else "last_used_at"
    cursor = db.hashtags.find(filt, {"_id": 0}).sort([(sort_key, -1)]).limit(min(limit, 200))
    items = [h async for h in cursor]
    return {"hashtags": items, "categories": [
        {"label": k, "slug": v} for k, v in CATEGORY_HASHTAGS.items()
    ]}


@router.get("/analytics/summary")
async def hashtag_analytics(current: CurrentUser, window: str = "30d"):
    """Admin-only aggregate metrics."""
    if current.get("username") not in ADMIN_USERNAMES:
        raise HTTPException(status_code=403, detail="Admin only")
    now = datetime.now(timezone.utc)
    days = {"1d": 1, "7d": 7, "30d": 30, "all": 36500}.get(window, 30)
    cutoff = (now - timedelta(days=days)).isoformat()
    unique_tags = await db.hashtags.count_documents({})
    # Total uses = sum of usage_count
    pipeline_total = [{"$group": {"_id": None, "total": {"$sum": "$usage_count"}}}]
    total_uses = 0
    async for d in db.hashtags.aggregate(pipeline_total):
        total_uses = d.get("total", 0)
    # Most used
    most_used = [h async for h in db.hashtags
                 .find({}, {"_id": 0})
                 .sort([("usage_count", -1)]).limit(10)]
    # Fastest growing = highest usage_count among tags last_used_at >= cutoff
    growing = [h async for h in db.hashtags
               .find({"last_used_at": {"$gte": cutoff}}, {"_id": 0})
               .sort([("usage_count", -1)]).limit(10)]
    return {
        "window": window,
        "unique_hashtags": unique_tags,
        "total_uses": total_uses,
        "most_used": most_used,
        "fastest_growing": growing,
    }


@router.post("/migrate")
async def trigger_migration(current: CurrentUser):
    if current.get("username") not in ADMIN_USERNAMES:
        raise HTTPException(status_code=403, detail="Admin only")
    return await migrate_index_all_posts()


# ──────────────────────────────────────────────────────────────────
# Interest-boost helper — used by the main feed router.
# ──────────────────────────────────────────────────────────────────
def interest_hashtags_for_user(user: dict) -> set[str]:
    """Map a user's selected interest category labels onto canonical
    hashtag slugs that should be boosted in their feed."""
    interests = user.get("interests") or []
    out: set[str] = set()
    for label in interests:
        # Match by canonical mapping first, then slugify as fallback.
        slug = CATEGORY_HASHTAGS.get(label) or slugify(label)
        if slug:
            out.add(slug)
    return out


def boost_posts_by_interest(
    posts: list[dict],
    interest_tags: Iterable[str],
    window_hours: int = 48,
) -> list[dict]:
    """Stable re-rank that PROMOTES posts whose hashtags intersect the
    user's interests AND were created in the last `window_hours`.

    All other posts retain their original relative order (reverse-chron
    from the caller). This is purely a re-sort — no items added/removed.
    """
    interest_set = {t.lower() for t in interest_tags if t}
    if not interest_set or not posts:
        return posts
    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    cutoff_iso = cutoff.isoformat()

    def is_boost(p: dict) -> bool:
        ca = p.get("created_at") or ""
        if not ca or ca < cutoff_iso:
            return False
        tags = p.get("hashtags") or []
        return any(t in interest_set for t in tags)

    boosted = [p for p in posts if is_boost(p)]
    rest = [p for p in posts if not is_boost(p)]
    return boosted + rest
