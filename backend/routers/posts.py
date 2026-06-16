"""Post endpoints (/api/posts/*)."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.geo import parse_radius, radius_filter
from models.schemas import PostCreate
from routers.notifications import emit_notification

router = APIRouter(prefix="/api/posts", tags=["posts"])


@router.post("")
async def create_post(payload: PostCreate, current: CurrentUser):
    audience = payload.audience.model_dump() if payload.audience else {
        "visibility": "public", "user_ids": [], "friend_group_ids": None,
    }
    doc = {
        "id": str(uuid.uuid4()),
        "author_id": current["id"],
        "author_username": current.get("username"),
        "author_name": current.get("name", ""),
        "author_avatar": current.get("avatar_url"),
        "content": payload.content,
        "media_type": payload.media_type,
        "media_url": payload.media_url,
        # Optional rich-media URLs (any combination, all additive).
        "image_url": payload.image_url,
        "video_url": payload.video_url,
        "link_url": payload.link_url,
        "tags": payload.tags,
        "audience": audience,
        "likes": 0,
        "liked_by": [],
        "comments": 0,
        # Phase-2 — author location SNAPSHOT for radius filtering. PRIVATE:
        # `author_zip` is never serialized to consumers. `author_lat`/`author_lng`
        # are used at query time by `radius_filter` and otherwise omitted.
        "author_zip": current.get("zip_code"),
        "author_lat": current.get("zip_lat"),
        "author_lng": current.get("zip_lng"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.posts.insert_one(doc)
    doc["created_at"] = datetime.fromisoformat(doc["created_at"])
    doc.pop("_id", None)
    return {"post": _public_post(doc)}


def _visibility_query(viewer: Optional[dict], author_id: Optional[str] = None) -> dict:
    """Build a Mongo query filter so a viewer only sees posts they are
    allowed to: public ∪ (friends if they are friends) ∪ (custom if they are listed)
    ∪ (private only for the author).

    If author_id is supplied (My Feed by user), the query is restricted to
    that author with the same visibility rules.
    """
    if not viewer:
        base = {"audience.visibility": "public"}
        if author_id:
            base["author_id"] = author_id
        return base

    vid = viewer["id"]
    friend_ids = set(viewer.get("friends") or [])

    or_clauses: list[dict] = [
        {"audience.visibility": "public"},
        {"author_id": vid},  # own posts (any visibility)
        {"audience.visibility": "custom", "audience.user_ids": vid},
    ]
    if friend_ids:
        or_clauses.append({
            "audience.visibility": "friends",
            "author_id": {"$in": list(friend_ids)},
        })

    q: dict = {"$or": or_clauses}
    if author_id:
        q = {"$and": [q, {"author_id": author_id}]}
    return q


@router.get("/feed/by-user/{username}")
async def feed_by_user(username: str, limit: int = 100):
    """My Feed widget data — list of posts by a single user, newest first,
    respecting audience visibility (anonymous viewer = only public)."""
    user = await db.users.find_one({"username": username.lower()},
                                    {"_id": 0, "id": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    query = _visibility_query(None, author_id=user["id"])
    cursor = db.posts.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = []
    async for p in cursor:
        if isinstance(p.get("created_at"), str):
            try:
                p["created_at"] = datetime.fromisoformat(p["created_at"])
            except Exception:
                pass
        items.append(_public_post(p))
    return {"posts": items}


def _public_post(p: dict) -> dict:
    """Strip private author-location fields from a post doc before returning."""
    p.pop("author_zip", None)
    p.pop("author_lat", None)
    p.pop("author_lng", None)
    return p


@router.get("")
async def list_posts(
    media_type: Optional[str] = None,
    limit: int = 50,
    radius: Optional[str] = None,
    viewer: Optional[str] = None,
):
    """List posts. Phase-2: optional `?radius=10|20|50|100|250|500|any`.

    Radius filtering uses the viewer's stored ZIP coords (looked up by
    `?viewer=<username>`) and matches posts whose author has stored
    coords within the requested miles. Posts without author coords are
    EXCLUDED from a non-Any radius (cannot be measured).
    """
    query: dict = {}
    if media_type and media_type != "all":
        query["media_type"] = media_type
    cursor = db.posts.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    items: list = []
    async for p in cursor:
        if isinstance(p.get("created_at"), str):
            try:
                p["created_at"] = datetime.fromisoformat(p["created_at"])
            except Exception:
                pass
        items.append(p)

    miles = parse_radius(radius)
    if miles is not None:
        viewer_doc = None
        if viewer:
            viewer_doc = await db.users.find_one(
                {"username": (viewer or "").lower()},
                {"_id": 0, "zip_lat": 1, "zip_lng": 1},
            )
        if not viewer_doc or viewer_doc.get("zip_lat") is None or viewer_doc.get("zip_lng") is None:
            # The frontend is responsible for blocking the radius UI until
            # the viewer has a ZIP. We still hard-gate here so the API
            # can't be tricked into bypassing the requirement.
            raise HTTPException(
                status_code=400,
                detail="Radius Search requires a ZIP code in your Profile Settings.",
            )
        items = radius_filter(
            items,
            (float(viewer_doc["zip_lat"]), float(viewer_doc["zip_lng"])),
            miles,
            lat_key="author_lat",
            lng_key="author_lng",
        )

    items = [_public_post(p) for p in items]
    return {"posts": items}


@router.post("/{post_id}/like")
async def like_post(post_id: str, current: CurrentUser):
    """Idempotent toggle. Returns the new {liked, likes} state.

    Stores per-user likes in `posts.liked_by[]` so each user contributes
    at most one like and re-tapping removes it.
    """
    post = await db.posts.find_one(
        {"id": post_id},
        {"_id": 0, "author_id": 1, "content": 1, "liked_by": 1, "likes": 1},
    )
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    uid = current["id"]
    liked_by = post.get("liked_by") or []
    if uid in liked_by:
        # Unlike — pull + decrement, never below 0.
        await db.posts.update_one(
            {"id": post_id},
            {"$pull": {"liked_by": uid}, "$inc": {"likes": -1}},
        )
        new_likes = max(0, (post.get("likes") or 0) - 1)
        return {"liked": False, "likes": new_likes}
    # Like — addToSet + increment, then notify the author once.
    await db.posts.update_one(
        {"id": post_id},
        {"$addToSet": {"liked_by": uid}, "$inc": {"likes": 1}},
    )
    new_likes = (post.get("likes") or 0) + 1
    if post.get("author_id") and post["author_id"] != uid:
        await emit_notification(
            post["author_id"], "like",
            actor_username=current.get("username"),
            payload={"preview": (post.get("content") or "")[:60], "post_id": post_id},
        )
    return {"liked": True, "likes": new_likes}


@router.get("/{post_id}")
async def get_post(post_id: str):
    """Single post fetch — used by the post popup to refresh state."""
    p = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    if isinstance(p.get("created_at"), str):
        try:
            p["created_at"] = datetime.fromisoformat(p["created_at"])
        except Exception:
            pass
    return {"post": _public_post(p)}


@router.get("/{post_id}/comments")
async def list_comments(post_id: str, limit: int = 200):
    cursor = db.comments.find({"post_id": post_id}, {"_id": 0}).sort("created_at", 1).limit(limit)
    items = []
    async for c in cursor:
        items.append(c)
    return {"comments": items}


@router.post("/{post_id}/comment")
async def comment_post(post_id: str, current: CurrentUser, body: dict):
    text = (body or {}).get("text", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment text required")
    if len(text) > 178:
        raise HTTPException(status_code=400, detail="Comments are limited to 178 characters")
    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "author_id": 1, "content": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    comment = {
        "id": str(uuid.uuid4()),
        "post_id": post_id,
        "author_id": current["id"],
        "author_username": current.get("username"),
        "author_name": current.get("name", ""),
        "author_avatar": current.get("avatar_url"),
        "text": text,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.comments.insert_one(comment)
    comment.pop("_id", None)
    await db.posts.update_one({"id": post_id}, {"$inc": {"comments": 1}})
    new_count_doc = await db.posts.find_one({"id": post_id}, {"_id": 0, "comments": 1})
    if post.get("author_id") and post["author_id"] != current["id"]:
        await emit_notification(
            post["author_id"], "comment",
            actor_username=current.get("username"),
            payload={"preview": text[:80], "post_id": post_id},
        )
    return {"comment": comment, "comments": (new_count_doc or {}).get("comments", 0)}


@router.post("/{post_id}/share")
async def share_post(post_id: str, current: CurrentUser):
    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "author_id": 1, "content": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.get("author_id") and post["author_id"] != current["id"]:
        await emit_notification(
            post["author_id"], "share",
            actor_username=current.get("username"),
            payload={"preview": (post.get("content") or "")[:60]},
        )
    return {"ok": True}


@router.post("/{post_id}/save")
async def save_post(post_id: str, current: CurrentUser):
    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "author_id": 1, "content": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    # Record save on the user's profile (idempotent)
    await db.users.update_one({"id": current["id"]}, {"$addToSet": {"saved_posts": post_id}})
    if post.get("author_id") and post["author_id"] != current["id"]:
        await emit_notification(
            post["author_id"], "save",
            actor_username=current.get("username"),
            payload={"preview": (post.get("content") or "")[:60]},
        )
    return {"ok": True}
