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
import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_analytics_access, require_founder

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
    await db.hashtags.create_index([("post_count", -1)])
    # Featured interest cards (promoted hashtags).
    try:
        await db.interest_cards.create_index("label", unique=True)
        await db.interest_cards.create_index([("sort_order", 1)])
    except Exception:  # noqa: BLE001 — defensive on legacy data
        pass


async def recompute_hashtag_post_counts() -> int:
    """Reconcile `db.hashtags.post_count` against actual posts.

    Fixes drift when posts were deleted before `delete_post` started
    decrementing counters (or any other historical data event that
    skipped the diff). Idempotent — safe to call on every startup.
    Returns the number of hashtag rows touched.
    """
    pipeline = [
        {"$match": {"hashtags": {"$exists": True, "$ne": []}}},
        {"$unwind": "$hashtags"},
        {"$group": {"_id": "$hashtags", "n": {"$sum": 1}}},
    ]
    actual: dict[str, int] = {}
    async for row in db.posts.aggregate(pipeline):
        actual[row["_id"]] = int(row.get("n") or 0)
    touched = 0
    async for h in db.hashtags.find({}, {"_id": 0, "tag": 1, "post_count": 1}):
        tag = h.get("tag")
        if not tag:
            continue
        want = actual.get(tag, 0)
        if int(h.get("post_count") or 0) != want:
            await db.hashtags.update_one({"tag": tag}, {"$set": {"post_count": want}})
            touched += 1
    # Insert rows for tags that exist on posts but not in db.hashtags
    # (legacy posts indexed before the counter table existed).
    missing = set(actual.keys()) - set(actual.keys()).intersection(
        {h["tag"] async for h in db.hashtags.find({}, {"_id": 0, "tag": 1})}
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    for tag in missing:
        await db.hashtags.update_one(
            {"tag": tag},
            {"$setOnInsert": {"tag": tag, "first_used_at": now_iso, "last_used_at": now_iso, "usage_count": actual[tag]},
             "$set": {"post_count": actual[tag]}},
            upsert=True,
        )
        touched += 1
    logger.info(f"[hashtags] post_count reconciliation touched {touched} rows")
    return touched


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
@router.get("/trending")
async def trending(window: str = "7d", limit: int = 6):
    """Public list of currently trending hashtags.

    Trending = hashtags used most often within the rolling window,
    measured by total usage_count of tags whose `last_used_at >= cutoff`.
    Cheap aggregate against the indexed `last_used_at` field — no
    post-text scans. Tags with `post_count == 0` are excluded so the
    rail can never link to a hashtag feed that would render the empty
    state ("No posts yet for #X").
    """
    days = {"1d": 1, "7d": 7, "30d": 30, "all": 36500}.get(window, 7)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    items = [h async for h in db.hashtags
             .find(
                 {"last_used_at": {"$gte": cutoff}, "post_count": {"$gt": 0}},
                 {"_id": 0},
             )
             .sort([("usage_count", -1), ("last_used_at", -1)])
             .limit(max(1, min(limit, 24)))]
    return {"window": window, "hashtags": items}


@router.get("/top")
async def top_hashtags(window: str = "30d", limit: int = 20):
    """Public top-N hashtags for the dedicated /hashtags page.

    Same filter as `/trending` but defaults to a 30-day window and a
    higher limit (cap 50). Only tags with at least one live post are
    returned so the corresponding hashtag feed always renders content.
    """
    days = {"1d": 1, "7d": 7, "30d": 30, "all": 36500}.get(window, 30)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    items = [h async for h in db.hashtags
             .find(
                 {"last_used_at": {"$gte": cutoff}, "post_count": {"$gt": 0}},
                 {"_id": 0},
             )
             .sort([("usage_count", -1), ("last_used_at", -1)])
             .limit(max(1, min(limit, 50)))]
    return {"window": window, "hashtags": items}


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
    require_analytics_access(current)
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
    require_analytics_access(current)
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
    require_founder(current)
    return await migrate_index_all_posts()


# ──────────────────────────────────────────────────────────────────────
# P1 — Promote hashtag → Interest Card
# ──────────────────────────────────────────────────────────────────────
# Storage:
#   db.interest_cards : {
#       id, label (lowercase, no '#'), source ('hashtag'|'static'),
#       use_count, is_enabled, is_featured, sort_order,
#       promoted_by, created_at, updated_at,
#   }
# `label` is the canonical key — uniqueness enforced via a unique
# index so re-promoting an existing hashtag is a no-op (idempotent).

async def _ensure_interest_index() -> None:
    try:
        await db.interest_cards.create_index("label", unique=True)
        await db.interest_cards.create_index([("sort_order", 1)])
    except Exception:  # noqa: BLE001 — startup never crashes on index
        pass


@router.post("/{tag}/promote-to-interest")
async def promote_hashtag_to_interest(tag: str, current: CurrentUser):
    """Promote a raw hashtag to a Featured Interest Card.

    Idempotent — re-promoting an existing tag refreshes the timestamp /
    promoter / popularity but never creates a duplicate card. Cards
    surface to the onboarding interest picker via
    `GET /api/hashtags/interest-cards`.
    """
    require_analytics_access(current)
    await _ensure_interest_index()
    label = (tag or "").strip().lstrip("#").lower()
    if not label or len(label) < 2 or len(label) > 40:
        raise HTTPException(400, "Tag must be 2–40 chars")

    now = datetime.now(timezone.utc).isoformat()
    # Carry the hashtag's popularity onto the card.
    h = await db.hashtags.find_one({"tag": label}, {"_id": 0, "usage_count": 1})
    use_count = (h or {}).get("usage_count", 0)

    existing = await db.interest_cards.find_one({"label": label})
    if existing:
        await db.interest_cards.update_one(
            {"label": label},
            {"$set": {
                "promoted_by": current["id"],
                "updated_at":  now,
                "use_count":   use_count,
                "is_enabled":  True,
                "is_featured": True,
            }},
        )
        card = await db.interest_cards.find_one({"label": label}, {"_id": 0})
        return {"card": card, "created": False}

    # New card → assign the next sort_order so it appears at the END of
    # the featured row by default (admin can reorder).
    max_doc = await db.interest_cards.find(
        {}, {"_id": 0, "sort_order": 1},
    ).sort("sort_order", -1).limit(1).to_list(1)
    next_order = ((max_doc[0]["sort_order"] if max_doc and "sort_order" in max_doc[0] else 0) + 1)

    card = {
        "id":          uuid.uuid4().hex,
        "label":       label,
        "source":      "hashtag",
        "use_count":   use_count,
        "is_enabled":  True,
        "is_featured": True,
        "sort_order":  next_order,
        "promoted_by": current["id"],
        "created_at":  now,
        "updated_at":  now,
    }
    await db.interest_cards.insert_one(card)
    card.pop("_id", None)
    return {"card": card, "created": True}


@router.delete("/interest-cards/{label}")
async def remove_interest_card(label: str, current: CurrentUser):
    """Un-promote / disable a Featured Interest Card. Founder + admin only."""
    require_analytics_access(current)
    key = (label or "").strip().lstrip("#").lower()
    if not key:
        raise HTTPException(400, "Label required")
    res = await db.interest_cards.delete_one({"label": key})
    if res.deleted_count == 0:
        raise HTTPException(404, "No promoted interest card with that label")
    return {"ok": True, "removed": key}


class ReorderPayload(BaseModel):
    order: list[str]  # ordered list of interest-card labels


@router.patch("/interest-cards/reorder")
async def reorder_interest_cards(payload: ReorderPayload, current: CurrentUser):
    """Persist a manual ordering of the promoted/featured interest cards.

    Only labels included in `order` are updated; any missing card keeps
    its prior `sort_order` (so partial reorders are safe).
    """
    require_analytics_access(current)
    if not payload.order:
        raise HTTPException(400, "order list required")
    now = datetime.now(timezone.utc).isoformat()
    seen: set[str] = set()
    updated = 0
    for i, raw in enumerate(payload.order):
        key = (raw or "").strip().lstrip("#").lower()
        if not key or key in seen:
            continue
        seen.add(key)
        res = await db.interest_cards.update_one(
            {"label": key},
            {"$set": {"sort_order": i, "updated_at": now}},
        )
        updated += res.modified_count
    return {"ok": True, "updated": updated}


@router.get("/interest-cards")
async def list_interest_cards():
    """Public list of enabled Interest Cards, sorted by manual `sort_order`
    (ascending) then by popularity. Used by the onboarding interest
    selector alongside the static labels."""
    cursor = db.interest_cards.find(
        {"is_enabled": True}, {"_id": 0},
    ).sort([("sort_order", 1), ("use_count", -1)])
    return {"cards": [c async for c in cursor]}


@router.get("/interest-cards/analytics")
async def interest_card_analytics(current: CurrentUser, window: str = "7d"):
    """Per-promoted-card metrics — users selecting it, posts under the
    same hashtag, engagement, and growth in the rolling window.

    All counts come from existing collections — no new write paths
    introduced here.
    """
    require_analytics_access(current)
    days = {"1d": 1, "7d": 7, "30d": 30, "all": 36500}.get(window, 7)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    cards = [c async for c in db.interest_cards.find(
        {"is_enabled": True}, {"_id": 0},
    ).sort([("sort_order", 1)])]
    out: list[dict] = []
    for c in cards:
        label = c["label"]
        # Users who chose this label as an interest (case-insensitive).
        users_selecting = await db.users.count_documents({
            "interests": {"$elemMatch": {"$regex": f"^{re.escape(label)}$", "$options": "i"}}
        })
        # Posts tagged with the matching hashtag (lowercase canonical).
        post_count = await db.posts.count_documents({"hashtags": label})
        growth_posts = await db.posts.count_documents({
            "hashtags": label, "created_at": {"$gte": cutoff},
        })
        # Engagement = likes + comments across posts containing this tag.
        eng_pipe = [
            {"$match": {"hashtags": label}},
            {"$project": {
                "likes_c":    {"$size": {"$ifNull": ["$likes", []]}},
                "comments_c": {"$size": {"$ifNull": ["$comments", []]}},
            }},
            {"$group": {"_id": None,
                        "likes":    {"$sum": "$likes_c"},
                        "comments": {"$sum": "$comments_c"}}},
        ]
        eng_doc = await db.posts.aggregate(eng_pipe).to_list(1)
        likes = (eng_doc[0]["likes"]    if eng_doc else 0) or 0
        comments = (eng_doc[0]["comments"] if eng_doc else 0) or 0
        out.append({
            **c,
            "metrics": {
                "users_selecting": users_selecting,
                "post_count":      post_count,
                "engagement":      {"likes": likes, "comments": comments,
                                     "total": likes + comments},
                "growth_posts":    growth_posts,
                "window":          window,
            },
        })
    return {"window": window, "cards": out}


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
