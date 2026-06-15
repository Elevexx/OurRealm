"""Post endpoints (/api/posts/*)."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from models.schemas import PostCreate

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
        "tags": payload.tags,
        "audience": audience,
        "likes": 0,
        "comments": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.posts.insert_one(doc)
    doc["created_at"] = datetime.fromisoformat(doc["created_at"])
    doc.pop("_id", None)
    return {"post": doc}


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
        items.append(p)
    return {"posts": items}


@router.get("")
async def list_posts(media_type: Optional[str] = None, limit: int = 50):
    query: dict = {}
    if media_type and media_type != "all":
        query["media_type"] = media_type
    cursor = db.posts.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = []
    async for p in cursor:
        if isinstance(p.get("created_at"), str):
            try:
                p["created_at"] = datetime.fromisoformat(p["created_at"])
            except Exception:
                pass
        items.append(p)
    return {"posts": items}


@router.post("/{post_id}/like")
async def like_post(post_id: str, current: CurrentUser):  # noqa: ARG001
    res = await db.posts.update_one({"id": post_id}, {"$inc": {"likes": 1}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"ok": True}
