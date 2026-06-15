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
    doc = {
        "id": str(uuid.uuid4()),
        "author_id": current["id"],
        "author_name": current.get("name", ""),
        "author_avatar": current.get("avatar_url"),
        "content": payload.content,
        "media_type": payload.media_type,
        "media_url": payload.media_url,
        "tags": payload.tags,
        "likes": 0,
        "comments": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.posts.insert_one(doc)
    doc["created_at"] = datetime.fromisoformat(doc["created_at"])
    doc.pop("_id", None)
    return {"post": doc}


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
