"""Post endpoints (/api/posts/*)."""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.geo import parse_radius, radius_filter
from models.schemas import PostCreate
from routers.notifications import emit_notification
from services.post_limits import enforce_post_content_limit

router = APIRouter(prefix="/api/posts", tags=["posts"])


def _build_poll(payload_poll) -> Optional[dict]:
    """Translate a `PollPayload` into the stored document shape (Phase 4B).

    Returns None if no poll attached. We assign stable ids to each option
    (carrying over any explicitly provided id) so vote tallies remain
    correct even if the user reorders options before posting.
    """
    if not payload_poll:
        return None
    options = []
    seen = set()
    for raw in payload_poll.options:
        oid = (raw.id or "").strip() or uuid.uuid4().hex[:12]
        # Defensive: avoid collisions in user-supplied ids
        while oid in seen:
            oid = uuid.uuid4().hex[:12]
        seen.add(oid)
        options.append({"id": oid, "text": raw.text.strip()})
    expires_at = None
    if payload_poll.duration_hours and payload_poll.duration_hours > 0:
        expires_at = (datetime.now(timezone.utc)
                      + timedelta(hours=int(payload_poll.duration_hours))).isoformat()
    return {
        "question": payload_poll.question.strip(),
        "options": options,
        "expires_at": expires_at,
        "votes": {},   # { user_id: option_id }
    }


@router.post("")
async def create_post(payload: PostCreate, current: CurrentUser):
    # Role-based content cap (founder 2000 / VIP 500 / default 300).
    # Applies to text content only — media-only posts (image/video/link/poll)
    # with no text are exempt.
    enforce_post_content_limit(current, payload.content or "")
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
        # Phase 4B — optional attached poll
        "poll": _build_poll(payload.poll),
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
    return {"post": _public_post(doc, viewer_id=current["id"])}


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


def _public_post(p: dict, viewer_id: Optional[str] = None) -> dict:
    """Strip private author-location fields from a post doc before returning.
    For polls (Phase 4B) compute tallies + indicate the viewer's vote.
    """
    p.pop("author_zip", None)
    p.pop("author_lat", None)
    p.pop("author_lng", None)
    poll = p.get("poll")
    if poll:
        votes = poll.get("votes") or {}
        total = len(votes)
        # tally by option_id
        tally: dict = {}
        for opt in (poll.get("options") or []):
            tally[opt["id"]] = 0
        for _uid, oid in votes.items():
            if oid in tally:
                tally[oid] += 1
        opts_out = [
            {**opt, "votes": tally.get(opt["id"], 0),
             "percent": round(100 * tally.get(opt["id"], 0) / total, 1) if total else 0}
            for opt in (poll.get("options") or [])
        ]
        expired = False
        if poll.get("expires_at"):
            try:
                expired = datetime.fromisoformat(poll["expires_at"]) <= datetime.now(timezone.utc)
            except Exception:
                expired = False
        p["poll"] = {
            "question": poll.get("question"),
            "options": opts_out,
            "total_votes": total,
            "expires_at": poll.get("expires_at"),
            "expired": expired,
            "my_vote": (votes.get(viewer_id) if viewer_id else None),
        }
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
    viewer_doc = None
    if viewer:
        viewer_doc = await db.users.find_one(
            {"username": (viewer or "").lower()},
            {"_id": 0, "id": 1, "zip_lat": 1, "zip_lng": 1},
        )
    if miles is not None:
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

    viewer_id = viewer_doc.get("id") if viewer_doc else None
    items = [_public_post(p, viewer_id=viewer_id) for p in items]
    return {"posts": items}


@router.post("/{post_id}/poll/vote")
async def vote_poll(post_id: str, current: CurrentUser, body: dict):
    """Cast or change a vote on the attached poll (Phase 4B).

    - One vote per user. Re-voting changes your selection.
    - Blocked after `poll.expires_at` (when set).
    - Idempotent in the sense that voting for the same option twice is a no-op.
    """
    option_id = (body or {}).get("option_id")
    if not isinstance(option_id, str) or not option_id.strip():
        raise HTTPException(status_code=400, detail="option_id is required")
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    poll = post.get("poll")
    if not poll:
        raise HTTPException(status_code=400, detail="This post has no poll")
    if poll.get("expires_at"):
        try:
            if datetime.fromisoformat(poll["expires_at"]) <= datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="Poll has expired")
        except HTTPException:
            raise
        except Exception:
            pass
    valid_ids = {o.get("id") for o in (poll.get("options") or [])}
    if option_id not in valid_ids:
        raise HTTPException(status_code=400, detail="Invalid option")
    uid = current["id"]
    await db.posts.update_one(
        {"id": post_id},
        {"$set": {f"poll.votes.{uid}": option_id}},
    )
    fresh = await db.posts.find_one({"id": post_id}, {"_id": 0, "poll": 1})
    if isinstance(fresh, dict):
        fresh.setdefault("id", post_id)
    return {"poll": _public_post(fresh or {}, viewer_id=uid).get("poll")}


@router.delete("/{post_id}/poll/vote")
async def unvote_poll(post_id: str, current: CurrentUser):
    """Withdraw the user's vote — only allowed while poll is open."""
    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "poll": 1})
    if not post or not post.get("poll"):
        raise HTTPException(status_code=404, detail="Poll not found")
    poll = post["poll"]
    if poll.get("expires_at"):
        try:
            if datetime.fromisoformat(poll["expires_at"]) <= datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="Poll has expired")
        except HTTPException:
            raise
        except Exception:
            pass
    uid = current["id"]
    await db.posts.update_one(
        {"id": post_id},
        {"$unset": {f"poll.votes.{uid}": ""}},
    )
    fresh = await db.posts.find_one({"id": post_id}, {"_id": 0, "poll": 1})
    return {"poll": _public_post(fresh or {}, viewer_id=uid).get("poll")}


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
async def get_post(post_id: str, viewer: Optional[str] = None):
    """Single post fetch — used by the post popup to refresh state.
    Optional `?viewer=<username>` so poll tallies can mark the user's own vote.
    """
    p = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    if isinstance(p.get("created_at"), str):
        try:
            p["created_at"] = datetime.fromisoformat(p["created_at"])
        except Exception:
            pass
    viewer_id = None
    if viewer:
        vd = await db.users.find_one({"username": viewer.lower()}, {"_id": 0, "id": 1})
        viewer_id = (vd or {}).get("id")
    return {"post": _public_post(p, viewer_id=viewer_id)}


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
