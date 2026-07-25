"""Post endpoints (/api/posts/*)."""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser, OptionalUser
from core.geo import parse_radius, radius_filter
from models.schemas import PostCreate
from routers.notifications import emit_notification
from services.post_limits import enforce_post_content_limit
from services.moderation import scan_and_apply

log = logging.getLogger("ourrealm.posts")

router = APIRouter(prefix="/api/posts", tags=["posts"])

FOUNDER_USERNAME = "stealth"
ALLOWED_VISIBILITIES = {"public", "friends", "custom", "stealth", "private"}


def _is_founder(user: Optional[dict]) -> bool:
    """@stealth is the only account with admin-style delete rights."""
    if not user:
        return False
    return (user.get("username") or "").lower() == FOUNDER_USERNAME or bool(user.get("is_founder"))


def _normalize_visibility(v: Optional[str]) -> str:
    """Map the public "stealth" label to the existing stored value "private".
    Both terms now refer to the same semantic: post visible only to the owner.
    """
    if not v:
        return "public"
    v = v.lower().strip()
    if v == "stealth":
        return "private"
    if v in ALLOWED_VISIBILITIES:
        return v
    return "public"


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
    # Reject truly empty posts (no text, no media, no poll). This replaces
    # the previous schema-level `min_length=1` on content so video/image/
    # link uploads with no caption are still allowed.
    if not (payload.content or "").strip() \
       and not (payload.media_url or payload.image_url or payload.video_url or payload.link_url
                or payload.sound_url or (payload.image_urls and len(payload.image_urls) > 0)) \
       and not payload.poll:
        raise HTTPException(status_code=400, detail="Post is empty — add text, media, or a poll.")

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
        # Normalize: a post with an attached poll IS a poll — store it as
        # media_type="poll" so feed filters separate Polls from Thoughts.
        "media_type": "poll" if payload.poll else payload.media_type,
        "media_url": payload.media_url,
        # Optional rich-media URLs (any combination, all additive).
        "image_url": payload.image_url,
        "image_urls": payload.image_urls or [],
        "video_url": payload.video_url,
        "link_url": payload.link_url,
        # Sound post fields — when media_type='sound' these reference
        # an existing track uploaded via /api/sounds/upload.
        "sound_track_id": payload.sound_track_id,
        "sound_url": payload.sound_url,
        "sound_title": payload.sound_title,
        "sound_cover_url": payload.sound_cover_url,
        "sound_duration": payload.sound_duration,
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
    # Canonical Sound unification — a For You sound post becomes THE
    # canonical record for its track when the uploader posts it and no
    # canonical post exists yet. Re-posts (own or others') stay regular
    # posts with their own separate Fire.
    if payload.sound_track_id and (payload.media_type == "sound"):
        try:
            from services import sound_posts as sp
            track = await db.tracks.find_one({"id": payload.sound_track_id}, {"_id": 0})
            if track:
                doc["content_type"] = "sound"
                doc["sound_classification_id"] = (track.get("classification_id")
                    or sp.classification_id_for_category(track.get("category")))
                if (track.get("user_id") == current["id"]
                        and not await sp.canonical_post_for_track(track["id"])):
                    doc["is_canonical_sound"] = True
                    doc["source_composer"] = "foryou"
                    # Track mirrors the post audience so the Sounds page
                    # respects the same privacy setting.
                    await db.tracks.update_one({"id": track["id"]}, {"$set": {
                        "visibility": audience.get("visibility") or "public",
                        "custom_user_ids": list(audience.get("user_ids") or []),
                    }})
        except Exception as e:
            log.warning(f"[sound-canonical] create_post link failed: {e}")
    await db.posts.insert_one(doc)
    # Phase F — hashtag indexing.
    try:
        from routers.hashtags import index_post_hashtags
        await index_post_hashtags(doc["id"], doc.get("content") or "")
    except Exception as e:
        log.warning(f"[hashtags] indexing failed for post {doc.get('id')}: {e}")
    # Progression hook — post created (idempotent by post id; non-fatal).
    try:
        from services.progression.events import notify as progression_notify
        await progression_notify(current["id"], "post_created", doc["id"])
    except Exception:
        pass
    # Moderation scan — sets moderation_* fields on the just-inserted doc.
    await scan_and_apply(
        coll_name="posts",
        doc_id_field="id",
        doc=doc,
        text_fields=("content",),
        link_fields=("link_url", "video_url"),
        user_id=current["id"],
    )
    # Pull the now-moderated record back so the response carries fresh state.
    fresh = await db.posts.find_one({"id": doc["id"]}, {"_id": 0})
    if isinstance(fresh.get("created_at"), str):
        try:
            fresh["created_at"] = datetime.fromisoformat(fresh["created_at"])
        except Exception:
            pass
    return {"post": _public_post(fresh or doc, viewer_id=current["id"])}


class PostUpdatePayload(BaseModel):
    """Owner-only visibility updates (Phase 5+ post management)."""
    visibility: Optional[str] = None
    custom_user_ids: Optional[list[str]] = None


@router.patch("/{post_id}")
async def update_post(post_id: str, payload: PostUpdatePayload, current: CurrentUser):
    """Owner-only visibility + custom-audience update. @stealth cannot
    change visibility on other users' posts (delete-only privilege)."""
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.get("author_id") != current["id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own posts")

    set_ops: dict = {}
    if payload.visibility is not None:
        set_ops["audience.visibility"] = _normalize_visibility(payload.visibility)
    if payload.custom_user_ids is not None:
        # Clean: only keep stringy ids; drop empties.
        ids = [s for s in (payload.custom_user_ids or []) if isinstance(s, str) and s.strip()]
        set_ops["audience.user_ids"] = ids
    if not set_ops:
        return {"post": _public_post(post, viewer_id=current["id"])}

    await db.posts.update_one({"id": post_id}, {"$set": set_ops})
    fresh = await db.posts.find_one({"id": post_id}, {"_id": 0})
    # Canonical sound — mirror the new audience onto the track so the
    # Sounds page enforces the same privacy.
    try:
        from services import sound_posts as sp
        await sp.sync_track_from_post(fresh or {})
    except Exception:
        pass
    if isinstance(fresh.get("created_at"), str):
        try:
            fresh["created_at"] = datetime.fromisoformat(fresh["created_at"])
        except Exception:
            pass
    return {"post": _public_post(fresh, viewer_id=current["id"])}


@router.delete("/{post_id}")
async def delete_post(post_id: str, current: CurrentUser):
    """Owners can delete their own posts; @stealth can delete ANY post
    (covers AI-generated, seed, demo, regression-test, and future posts)."""
    post = await db.posts.find_one({"id": post_id},
                                   {"_id": 0, "author_id": 1, "is_canonical_sound": 1,
                                    "sound_track_id": 1})
    if not post:
        return {"ok": True, "deleted": post_id}
    is_owner = post.get("author_id") == current["id"]
    if not (is_owner or _is_founder(current)):
        raise HTTPException(status_code=403, detail="You can only delete your own posts")
    # Decrement hashtag counters so trending stays in sync with reality.
    # Done BEFORE the delete so `index_post_hashtags` can read the
    # current hashtag set off the post row.
    try:
        from routers.hashtags import index_post_hashtags
        await index_post_hashtags(post_id, "")
    except Exception:  # noqa: BLE001 — never block deletion on a counter
        pass
    await db.posts.delete_one({"id": post_id})
    # Clean dependent rows so likes/comments don't dangle.
    await db.comments.delete_many({"post_id": post_id})
    # Canonical sound post — the track (and audio file) goes with it so the
    # Sound disappears from the Sounds page, charts, and search too.
    if post.get("is_canonical_sound") and post.get("sound_track_id"):
        try:
            track = await db.tracks.find_one({"id": post["sound_track_id"]}, {"_id": 0})
            if track:
                await db.tracks.delete_one({"id": track["id"]})
                from services.audio_store import audio_dir, is_safe_audio_filename
                url = (track.get("file_url") or "")
                if url.startswith("/api/sounds/file/"):
                    name = url.rsplit("/", 1)[-1]
                    if is_safe_audio_filename(name):
                        (audio_dir() / name).unlink(missing_ok=True)
        except Exception as e:
            log.warning(f"[sound-canonical] track cleanup failed: {e}")
    return {"ok": True, "deleted": post_id}



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

    # ── Moderation gate: hide auto-hidden / rejected posts from everyone
    # except their author (and `@stealth`, who can view the moderation
    # queue separately on /admin).
    is_admin = bool(viewer and (
        (viewer.get("username") or "").lower() == "stealth" or viewer.get("is_founder")
    ))
    if not is_admin:
        mod_clause = {
            "$or": [
                {"moderation_status": {"$in": [None, "approved", "pending_review"]}},
                {"moderation_status": {"$exists": False}},
                {"author_id": viewer["id"] if viewer else None},
            ],
        }
        q = {"$and": [q, mod_clause]}
    return q


@router.get("/feed/by-user/{username}")
async def feed_by_user(username: str, current: OptionalUser, limit: int = 100,
                       sort: Optional[str] = None):
    """My Feed widget data — list of posts by a single user, respecting
    audience visibility (anonymous viewer = only public; authenticated
    viewers additionally see friend/custom-audience posts they qualify
    for). `?sort=fire` returns the author's Fire-powered posts ranked by
    fire_total (existing Fire-ranked logic; posts with 0 fire excluded)."""
    user = await db.users.find_one({"username": username.lower()},
                                    {"_id": 0, "id": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    viewer_doc = None
    if current:
        viewer_doc = await db.users.find_one(
            {"id": current["id"]},
            {"_id": 0, "id": 1, "friends": 1, "username": 1, "is_founder": 1})
    query = _visibility_query(viewer_doc, author_id=user["id"])
    if sort == "fire":
        query = {"$and": [query, {"fire_total": {"$gt": 0}}]}
        cursor = db.posts.find(query, {"_id": 0}).sort(
            [("fire_total", -1), ("created_at", -1)]).limit(min(limit, 100))
    else:
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
    sort: Optional[str] = None,
    window: str = "24h",
):
    """List posts. Phase-2: optional `?radius=10|20|50|100|250|500|any`.

    Radius filtering uses the viewer's stored ZIP coords (looked up by
    `?viewer=<username>`) and matches posts whose author has stored
    coords within the requested miles. Posts without author coords are
    EXCLUDED from a non-Any radius (cannot be measured).
    """
    # Lookup viewer up-front so we can apply visibility filtering even when
    # no radius is requested. Hardens /api/posts against bypassing private/
    # custom audience rules via the raw list endpoint.
    viewer_doc = None
    if viewer:
        viewer_doc = await db.users.find_one(
            {"username": (viewer or "").lower()},
            {"_id": 0, "id": 1, "zip_lat": 1, "zip_lng": 1, "friends": 1},
        )
    # Fire-ranked feeds need a wider chronological slice to rank within.
    if sort == "fire":
        limit = max(limit, 200)

    query: dict = {}
    if media_type and media_type != "all":
        if media_type == "poll":
            # Match by attached poll object so legacy polls stored with
            # media_type="thought" (pre-migration) are still included.
            query["poll"] = {"$ne": None}
        elif media_type == "thought":
            # Thoughts must EXCLUDE polls (polls have their own filter).
            query["media_type"] = "thought"
            query["poll"] = None
        else:
            query["media_type"] = media_type
    # Compose the visibility filter directly into the Mongo query so private
    # posts authored by others never travel over the wire.
    vis_clause = _visibility_query(viewer_doc)
    if vis_clause:
        query = {"$and": [query, vis_clause]} if query else vis_clause

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
    # Phase F.4 — Interest-based 48-hour prioritisation. Pure re-rank: no
    # items added or removed, no engagement score, still time-based.
    try:
        from routers.hashtags import interest_hashtags_for_user, boost_posts_by_interest
        if viewer_doc:
            # Need the full user doc for interests.
            viewer_full = await db.users.find_one({"id": viewer_id}, {"_id": 0, "interests": 1})
            interests = interest_hashtags_for_user(viewer_full or {})
            items = boost_posts_by_interest(items, interests, window_hours=48)
    except Exception as e:
        log.warning(f"[interest-boost] failed: {e}")

    items = [_public_post(p, viewer_id=viewer_id) for p in items]

    # Phase G — merge real uploaded sounds into the For You "Sounds"
    # filter. Tracks live in `db.tracks` (driven by /api/sounds/upload),
    # not `db.posts`, so the existing post query never surfaced them.
    # When the caller is asking for sound items we transform each
    # visible track into a feed-post shape and merge it into `items`,
    # then re-sort newest-first. Dedupes by id so a track that ALSO
    # has a companion post row (rare — composer-driven) only appears
    # once.
    if media_type == "sound":
        try:
            from routers.sounds import _can_view_track
            t_cursor = db.tracks.find({}, {"_id": 0}).sort("created_at", -1).limit(200)
            already = {p.get("id") for p in items if p.get("id")}
            # Canonical sound posts already carry the track — never merge
            # the raw track again (one canonical record, zero duplicates).
            already |= {p.get("sound_track_id") for p in items if p.get("sound_track_id")}
            full_viewer = None
            if viewer_id:
                full_viewer = await db.users.find_one(
                    {"id": viewer_id},
                    {"_id": 0, "id": 1, "friends": 1, "admin_role": 1},
                )
            visible_tracks: list[dict] = []
            async for t in t_cursor:
                tid = t.get("id")
                if not tid or tid in already:
                    continue
                if t.get("moderation_status") in ("rejected", "hidden", "removed"):
                    continue
                if t.get("deleted_at"):
                    continue
                if not _can_view_track(t, full_viewer):
                    continue
                visible_tracks.append(t)

            # Global canonical check (not just current page) — a track with
            # a canonical post is ALWAYS represented by that post.
            if visible_tracks:
                canon_ids = set(await db.posts.distinct(
                    "sound_track_id",
                    {"sound_track_id": {"$in": [t["id"] for t in visible_tracks]},
                     "is_canonical_sound": True}))
                visible_tracks = [t for t in visible_tracks if t["id"] not in canon_ids]

            # Any straggler here has NO canonical post (legacy row that
            # pre-dates unification, or an abandoned deferred upload).
            # Heal it on the spot — backfill_canonical_for_track is
            # idempotent per track — so EVERY Sound in the feed is a
            # canonical post carrying the unified Fire Power control.
            # Raw track rows (is_sound_track) are never injected anymore.
            healed: list[dict] = []
            if visible_tracks:
                from services import sound_posts as sp
                for t in visible_tracks:
                    try:
                        p, _ = await sp.backfill_canonical_for_track(t, source="feed_heal")
                        healed.append(p)
                    except Exception as e:
                        log.warning(f"[sounds-feed-merge] heal failed for {t.get('id')}: {e}")
            if healed:
                try:
                    from services.fire_power import get_fire_flags, attach_fire
                    if (await get_fire_flags()).get("fire_reactions"):
                        await attach_fire(healed, viewer_id)
                except Exception as e:
                    log.warning(f"[sounds-feed-merge] attach_fire failed: {e}")
                items.extend(_public_post(p, viewer_id=viewer_id) for p in healed)
                def _ts(p):
                    v = p.get("created_at")
                    if isinstance(v, datetime):
                        return v.isoformat()
                    return v or ""
                items.sort(key=_ts, reverse=True)
        except Exception as e:
            log.warning(f"[sounds-feed-merge] failed: {e}")

    # Phase F.6 — prepend the global pinned announcement, if any. Decoded
    # to the same _public_post shape and tagged with `is_pinned: true` so
    # the client can render the Founder-Announcement banner.
    try:
        from routers.announcements import fetch_active_pin
        active = await fetch_active_pin()
        if active and (not media_type or media_type == "all" or
                       active["post"].get("media_type") == media_type):
            pinned_post = _public_post(active["post"], viewer_id=viewer_id)
            pinned_post["is_pinned"] = True
            pinned_post["pinned_by"] = active["pin"].get("pinned_by")
            pinned_post["pinned_at"] = active["pin"].get("pinned_at")
            # De-duplicate if the pinned post also surfaced naturally.
            items = [pinned_post] + [p for p in items if p.get("id") != pinned_post.get("id")]
    except Exception as e:
        log.warning(f"[pinned-post] failed: {e}")

    # Attach emoji reaction summaries (batch query — one round-trip).
    try:
        from routers.reactions import reaction_summaries_for
        ids = [p.get("id") for p in items if p.get("id")]
        if ids:
            rmap = await reaction_summaries_for("post", ids, viewer_id=viewer_id)
            for p in items:
                pid = p.get("id")
                p["reactions"] = rmap.get(pid, {"summary": [], "my_reaction": None})
    except Exception as e:
        log.warning(f"[reactions] post summary attach failed: {e}")

    # Fire Power — attach summaries + optional fire-ranked ordering.
    # Both are founder-flag gated (default OFF) so production behaviour
    # is unchanged until explicitly activated.
    try:
        from services.fire_power import get_fire_flags, attach_fire, window_fire_map
        fflags = await get_fire_flags()
        if fflags.get("fire_reactions"):
            await attach_fire(items, viewer_id)
            if sort == "fire" and fflags.get("fire_ranked_feed"):
                pinned = [p for p in items if p.get("is_pinned")]
                rest = [p for p in items if not p.get("is_pinned")]
                fmap = await window_fire_map([p.get("id") for p in rest], window)

                def _fire_of(p):
                    if fmap is None:  # window == "all" → lifetime totals
                        return int(p.get("fire_total") or 0)
                    return fmap.get(p.get("id"), 0)

                def _created(p):
                    v = p.get("created_at")
                    return v.isoformat() if isinstance(v, datetime) else (v or "")

                rest.sort(key=_created, reverse=True)
                rest.sort(key=_fire_of, reverse=True)
                items = pinned + rest
    except Exception as e:
        log.warning(f"[fire] feed attach/rank failed: {e}")

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
    public = _public_post(p, viewer_id=viewer_id)
    try:
        from routers.reactions import reaction_summary_for
        public["reactions"] = await reaction_summary_for("post", post_id, viewer_id=viewer_id)
    except Exception as e:
        log.warning(f"[reactions] single post attach failed: {e}")
    try:
        from services.fire_power import get_fire_flags, attach_fire
        if (await get_fire_flags()).get("fire_reactions"):
            await attach_fire([public], viewer_id)
    except Exception as e:
        log.warning(f"[fire] single post attach failed: {e}")
    return {"post": public}


@router.get("/{post_id}/comments")
async def list_comments(post_id: str, limit: int = 200, viewer: Optional[str] = None):
    """Top-level comments + their (one level deep) replies.

    Reply ordering: newest replies stay below their parent in chronological
    order, mirroring the post-list reading rhythm. Likes are denormalised
    onto each comment as `likes` and `liked` (per-viewer).
    """
    viewer_id = None
    if viewer:
        vd = await db.users.find_one({"username": viewer.lower()}, {"_id": 0, "id": 1})
        viewer_id = (vd or {}).get("id")

    def hydrate(c: dict) -> dict:
        lb = c.get("liked_by") or []
        c["likes"] = c.get("likes") if c.get("likes") is not None else len(lb)
        c["liked"] = bool(viewer_id and viewer_id in lb)
        c.pop("liked_by", None)
        return c

    cursor = db.comments.find({"post_id": post_id}, {"_id": 0}).sort("created_at", 1).limit(limit)
    all_items = [c async for c in cursor]
    parents = [hydrate(c) for c in all_items if not c.get("parent_id")]
    by_parent: dict = {}
    for c in all_items:
        pid = c.get("parent_id")
        if pid:
            by_parent.setdefault(pid, []).append(hydrate(c))
    for p in parents:
        p["replies"] = by_parent.get(p["id"], [])

    # Attach emoji reaction summaries for every comment + reply in one
    # round-trip. Same `comment` target_type for both because they share
    # the `comments` collection and id space.
    try:
        from routers.reactions import reaction_summaries_for
        ids = [c["id"] for c in all_items if c.get("id")]
        if ids:
            rmap = await reaction_summaries_for("comment", ids, viewer_id=viewer_id)
            empty = {"summary": [], "my_reaction": None}
            for p in parents:
                p["reactions"] = rmap.get(p["id"], empty)
                for r in p.get("replies") or []:
                    r["reactions"] = rmap.get(r["id"], empty)
    except Exception as e:
        log.warning(f"[reactions] comment summary attach failed: {e}")

    return {"comments": parents}


@router.post("/{post_id}/comment")
async def comment_post(post_id: str, current: CurrentUser, body: dict):
    text = (body or {}).get("text", "").strip()
    parent_id = (body or {}).get("parent_id")
    if not text:
        raise HTTPException(status_code=400, detail="Comment text required")
    if len(text) > 178:
        raise HTTPException(status_code=400, detail="Comments are limited to 178 characters")
    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "author_id": 1, "content": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    # One-level-only replies. Replying to a reply is rewritten to reply to
    # the same parent so the tree never deepens beyond two rows.
    parent = None
    if parent_id:
        parent = await db.comments.find_one(
            {"id": parent_id, "post_id": post_id},
            {"_id": 0, "id": 1, "parent_id": 1, "author_id": 1},
        )
        if not parent:
            raise HTTPException(status_code=404, detail="Parent comment not found")
        if parent.get("parent_id"):
            parent_id = parent["parent_id"]

    comment = {
        "id": str(uuid.uuid4()),
        "post_id": post_id,
        "parent_id": parent_id,
        "author_id": current["id"],
        "author_username": current.get("username"),
        "author_name": current.get("name", ""),
        "author_avatar": current.get("avatar_url"),
        "text": text,
        "likes": 0,
        "liked_by": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.comments.insert_one(comment)
    comment.pop("_id", None)
    await db.posts.update_one({"id": post_id}, {"$inc": {"comments": 1}})
    new_count_doc = await db.posts.find_one({"id": post_id}, {"_id": 0, "comments": 1})

    # Notify the post author for a top-level comment, the parent comment's
    # author for a reply. Skip self-notifications.
    if parent_id and parent and parent.get("author_id") and parent["author_id"] != current["id"]:
        await emit_notification(
            parent["author_id"], "reply",
            actor_username=current.get("username"),
            payload={"preview": text[:80], "post_id": post_id, "comment_id": parent_id},
        )
    elif post.get("author_id") and post["author_id"] != current["id"]:
        await emit_notification(
            post["author_id"], "comment",
            actor_username=current.get("username"),
            payload={"preview": text[:80], "post_id": post_id},
        )

    comment["liked"] = False
    comment.pop("liked_by", None)
    return {"comment": comment, "comments": (new_count_doc or {}).get("comments", 0)}


@router.post("/{post_id}/comments/{comment_id}/like")
async def like_comment(post_id: str, comment_id: str, current: CurrentUser):
    """Toggle like on a comment OR reply (single endpoint handles both).

    Mirrors `/posts/{id}/like`: `liked_by[]` for per-user uniqueness,
    `likes` counter denormalised. Fires a `comment_like` notification on
    transition to liked.
    """
    c = await db.comments.find_one(
        {"id": comment_id, "post_id": post_id},
        {"_id": 0, "author_id": 1, "text": 1, "liked_by": 1, "likes": 1},
    )
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    uid = current["id"]
    liked_by = c.get("liked_by") or []
    if uid in liked_by:
        await db.comments.update_one(
            {"id": comment_id},
            {"$pull": {"liked_by": uid}, "$inc": {"likes": -1}},
        )
        new_likes = max(0, (c.get("likes") or 0) - 1)
        return {"liked": False, "likes": new_likes}
    await db.comments.update_one(
        {"id": comment_id},
        {"$addToSet": {"liked_by": uid}, "$inc": {"likes": 1}},
    )
    new_likes = (c.get("likes") or 0) + 1
    if c.get("author_id") and c["author_id"] != uid:
        await emit_notification(
            c["author_id"], "comment_like",
            actor_username=current.get("username"),
            payload={"preview": (c.get("text") or "")[:60], "post_id": post_id, "comment_id": comment_id},
        )
    return {"liked": True, "likes": new_likes}


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
