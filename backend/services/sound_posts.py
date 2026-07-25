"""Canonical Sound-post service (Sounds ⇄ For You unification).

One track = ONE canonical post record in db.posts (media_type="sound",
content_type="sound", is_canonical_sound=True). Fire, comments, caption,
hashtags and audience all live on the canonical post, so the entire
existing Fire Power stack works unchanged. db.tracks remains the audio
ASSET record (file, duration, plays, cover).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from core.db import db

log = logging.getLogger("sound_posts")

# Seeded once; admin-renameable afterwards. Stable ids (slugs) are stored
# on tracks/posts — display names resolve from this collection at read time.
DEFAULT_CLASSIFICATIONS = [
    {"id": "music",    "name": "Music",    "order": 1},
    {"id": "podcasts", "name": "Podcasts", "order": 2},
    {"id": "fx",       "name": "FX",       "order": 3},
    {"id": "other",    "name": "Other",    "order": 99},
]

_CATEGORY_TO_ID = {"Music": "music", "Podcasts": "podcasts", "FX": "fx"}

_class_cache: dict = {"at": None, "rows": []}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_classifications() -> None:
    for c in DEFAULT_CLASSIFICATIONS:
        await db.sound_classifications.update_one(
            {"id": c["id"]},
            {"$setOnInsert": {**c, "active": True, "created_at": _now_iso()}},
            upsert=True)


async def list_classifications(force: bool = False) -> list[dict]:
    now = datetime.now(timezone.utc)
    if not force and _class_cache["at"] and (now - _class_cache["at"]).total_seconds() < 60:
        return _class_cache["rows"]
    await ensure_classifications()
    rows = [c async for c in db.sound_classifications.find(
        {"active": True}, {"_id": 0}).sort("order", 1)]
    _class_cache["at"] = now
    _class_cache["rows"] = rows
    return rows


async def classification_name(cid: Optional[str]) -> Optional[str]:
    rows = await list_classifications()
    for c in rows:
        if c["id"] == cid:
            return c["name"]
    return None


def classification_id_for_category(category: Optional[str]) -> str:
    return _CATEGORY_TO_ID.get((category or "").strip(), "other")


def track_audience(track: dict) -> dict:
    """Track visibility → posts audience shape (same values by design)."""
    vis = (track.get("visibility") or "public").strip().lower()
    if vis == "stealth":
        vis = "private"
    if vis not in {"public", "friends", "private", "custom"}:
        vis = "public"
    return {"visibility": vis,
            "user_ids": list(track.get("custom_user_ids") or []),
            "friend_group_ids": None}


def _post_doc_for_track(track: dict, user: dict, *, caption: str = "",
                        tags: Optional[list] = None,
                        source_composer: str = "sounds",
                        created_at: Optional[str] = None,
                        migration_source: Optional[str] = None) -> dict:
    cid = track.get("classification_id") or classification_id_for_category(track.get("category"))
    doc = {
        "id": str(uuid.uuid4()),
        "author_id": track.get("user_id"),
        "author_username": user.get("username"),
        "author_name": user.get("display_name") or user.get("name", ""),
        "author_avatar": user.get("avatar_url"),
        "content": (caption or "").strip() or (track.get("title") or ""),
        "media_type": "sound",
        "content_type": "sound",
        "media_url": track.get("file_url"),
        "image_url": None, "image_urls": [], "video_url": None, "link_url": None,
        "sound_track_id": track.get("id"),
        "sound_url": track.get("file_url"),
        "sound_title": track.get("title"),
        "sound_cover_url": track.get("cover_url"),
        "sound_duration": track.get("duration_seconds"),
        "sound_classification_id": cid,
        "is_canonical_sound": True,
        "source_composer": source_composer,
        "tags": tags or [],
        "audience": track_audience(track),
        "likes": int(track.get("likes") or 0) if migration_source else 0,
        "liked_by": list(track.get("liked_by") or []) if migration_source else [],
        "comments": 0,
        "poll": None,
        "author_zip": track.get("author_zip") if track.get("author_zip") is not None else user.get("zip_code"),
        "author_lat": track.get("author_lat") if track.get("author_lat") is not None else user.get("zip_lat"),
        "author_lng": track.get("author_lng") if track.get("author_lng") is not None else user.get("zip_lng"),
        "created_at": created_at or track.get("created_at") or _now_iso(),
    }
    if migration_source:
        doc["migration_source"] = migration_source
    return doc


async def canonical_post_for_track(track_id: str) -> Optional[dict]:
    return await db.posts.find_one(
        {"sound_track_id": track_id, "is_canonical_sound": True}, {"_id": 0})


async def create_canonical_post(track: dict, current: dict, *, caption: str = "",
                                tags: Optional[list] = None,
                                source_composer: str = "sounds") -> dict:
    """Create the ONE canonical post for a track. Idempotent per track."""
    existing = await canonical_post_for_track(track["id"])
    if existing:
        return existing
    doc = _post_doc_for_track(track, current, caption=caption, tags=tags,
                              source_composer=source_composer)
    await db.posts.insert_one(doc)
    doc.pop("_id", None)
    try:
        from routers.hashtags import index_post_hashtags
        await index_post_hashtags(doc["id"], doc.get("content") or "")
    except Exception as e:  # noqa: BLE001
        log.warning(f"[sound-post] hashtag index failed: {e}")
    try:
        from services.progression.events import notify as progression_notify
        await progression_notify(track["user_id"], "post_created", doc["id"])
    except Exception:  # noqa: BLE001
        pass
    try:
        from services.moderation import scan_and_apply
        await scan_and_apply(coll_name="posts", doc_id_field="id", doc=doc,
                             text_fields=("content",), link_fields=(),
                             user_id=track["user_id"])
    except Exception as e:  # noqa: BLE001
        log.warning(f"[sound-post] moderation scan failed: {e}")
    return await db.posts.find_one({"id": doc["id"]}, {"_id": 0}) or doc


async def attach_posts_to_tracks(tracks: list[dict], viewer_id: Optional[str]) -> None:
    """Embed each track's canonical post (with live fire data) as t['post'].
    Batch: 2 queries + attach_fire, regardless of list size."""
    ids = [t.get("id") for t in tracks if t.get("id")]
    if not ids:
        return
    posts = [p async for p in db.posts.find(
        {"sound_track_id": {"$in": ids}, "is_canonical_sound": True}, {"_id": 0})]
    try:
        from services.fire_power import get_fire_flags, attach_fire
        if (await get_fire_flags()).get("fire_reactions") and posts:
            await attach_fire(posts, viewer_id)
    except Exception as e:  # noqa: BLE001
        log.warning(f"[sound-post] attach_fire failed: {e}")
    by_track = {p["sound_track_id"]: p for p in posts}
    names = {c["id"]: c["name"] for c in await list_classifications()}
    for t in tracks:
        p = by_track.get(t.get("id"))
        if p:
            t["post"] = {
                "id": p["id"],
                "fire_total": p.get("fire_total") or 0,
                "fire_count": p.get("fire_count") or 0,
                "fire": p.get("fire"),
                "comments": p.get("comments") or 0,
                "audience": p.get("audience"),
                "content": p.get("content"),
                "sound_classification_id": p.get("sound_classification_id"),
            }
        cid = t.get("classification_id") or classification_id_for_category(t.get("category"))
        t["classification_id"] = cid
        t["classification_name"] = names.get(cid, cid)


async def sync_canonical_from_track(track_id: str) -> None:
    """Track metadata edits → mirror onto the canonical post."""
    track = await db.tracks.find_one({"id": track_id}, {"_id": 0})
    if not track:
        return
    post = await canonical_post_for_track(track_id)
    if not post:
        return
    set_ops = {
        "sound_title": track.get("title"),
        "sound_cover_url": track.get("cover_url"),
        "sound_url": track.get("file_url"),
        "media_url": track.get("file_url"),
        "audience": track_audience(track),
        "sound_classification_id": track.get("classification_id")
            or classification_id_for_category(track.get("category")),
    }
    # Caption follows the title only while it still mirrors the old title.
    if (post.get("content") or "") in ("", post.get("sound_title") or ""):
        set_ops["content"] = track.get("title") or ""
    await db.posts.update_one({"id": post["id"]}, {"$set": set_ops})


async def sync_track_from_post(post: dict) -> None:
    """Canonical post audience edits → mirror onto the track."""
    tid = post.get("sound_track_id")
    if not (tid and post.get("is_canonical_sound")):
        return
    aud = post.get("audience") or {}
    await db.tracks.update_one({"id": tid}, {"$set": {
        "visibility": aud.get("visibility") or "public",
        "custom_user_ids": list(aud.get("user_ids") or []),
    }})


async def delete_canonical_for_track(track_id: str) -> Optional[str]:
    post = await canonical_post_for_track(track_id)
    if not post:
        return None
    pid = post["id"]
    try:
        from routers.hashtags import index_post_hashtags
        await index_post_hashtags(pid, "")
    except Exception:  # noqa: BLE001
        pass
    await db.posts.delete_one({"id": pid})
    await db.comments.delete_many({"post_id": pid})
    return pid


async def ensure_sound_indexes() -> None:
    try:
        await db.posts.create_index([("sound_track_id", 1), ("is_canonical_sound", 1)],
                                    name="by_sound_track")
        await db.posts.create_index([("media_type", 1), ("created_at", -1)],
                                    name="by_media_created")
        await db.sound_classifications.create_index([("id", 1)], unique=True,
                                                    name="uniq_classification")
    except Exception as e:  # noqa: BLE001
        log.warning(f"[sound-post] index ensure failed: {e}")
    # Hard guarantee — at most ONE canonical post per track. Created after
    # duplicate repair (see run_startup_migration ordering).
    try:
        await db.posts.create_index(
            [("sound_track_id", 1)], name="uniq_canonical_sound", unique=True,
            partialFilterExpression={"is_canonical_sound": True})
    except Exception as e:  # noqa: BLE001
        log.warning(f"[sound-post] uniq canonical index failed (dupes still present?): {e}")


# ── Legacy migration: tracks → canonical posts (+ likes → 1× Fire) ──────
def _track_blocked(t: dict) -> Optional[str]:
    """Reason a track must NOT get a canonical post, or None."""
    if t.get("deleted_at"):
        return "track_deleted"
    if t.get("moderation_status") in ("rejected", "hidden", "removed"):
        return f"moderation_{t.get('moderation_status')}"
    return None


async def backfill_canonical_for_track(t: dict, user: Optional[dict] = None,
                                       *, source: str = "sound_backfill") -> tuple[dict, int]:
    """Create the ONE canonical post for a legacy track and convert its
    hearts into 1× Fire from the same users (zero pool consumption —
    same convention as the global Like→Fire migration). Idempotent:
    re-running never duplicates the post or the Fire reactions.
    Returns (post, likes_converted)."""
    existing = await canonical_post_for_track(t["id"])
    if existing:
        return existing, 0
    if user is None:
        user = await db.users.find_one({"id": t.get("user_id")}, {"_id": 0}) or {}
    now = _now_iso()
    doc = _post_doc_for_track(t, user, source_composer="migration",
                              created_at=t.get("created_at"),
                              migration_source=source)
    try:
        await db.posts.insert_one(doc)
    except Exception:
        # Unique canonical index tripped — a concurrent request/startup
        # created it first. Converge on the existing canonical post.
        existing = await canonical_post_for_track(t["id"])
        if existing:
            return existing, 0
        raise
    doc.pop("_id", None)
    likes_converted = 0
    for uid in (t.get("liked_by") or []):
        if not uid or uid == t.get("user_id"):
            continue
        r = await db.post_fire_reactions.update_one(
            {"post_id": doc["id"], "user_id": uid},
            {"$setOnInsert": {"id": uuid.uuid4().hex, "fire_value": 1,
                              "boosted_cost": 0, "active": True,
                              "source": "sound_migration",
                              "created_at": now, "updated_at": now}},
            upsert=True)
        if r.upserted_id is not None:
            likes_converted += 1
    from services.fire_power import recompute_post_fire
    await recompute_post_fire(doc["id"])
    return doc, likes_converted


async def migration_dry_run() -> dict:
    total = await db.tracks.count_documents({})
    missing, have, likes_to_convert, no_class = 0, 0, 0, 0
    samples, dupes, skipped = [], [], []
    async for t in db.tracks.find({}, {"_id": 0}):
        n = await db.posts.count_documents(
            {"sound_track_id": t["id"], "is_canonical_sound": True})
        if n > 1:
            dupes.append(t["id"])
        if n >= 1:
            have += 1
            continue
        reason = _track_blocked(t)
        if reason:
            skipped.append({"track_id": t["id"], "reason": reason})
            continue
        missing += 1
        likes_to_convert += len(t.get("liked_by") or [])
        if not t.get("classification_id") and (t.get("category") or "") not in _CATEGORY_TO_ID:
            no_class += 1
        if len(samples) < 10:
            samples.append({"track_id": t["id"], "title": t.get("title"),
                            "likes": len(t.get("liked_by") or []),
                            "visibility": t.get("visibility")})
    # Fire reactions already living on canonical sound posts — preserved
    # untouched by the migration (converted hearts use $setOnInsert).
    canon_pids = await db.posts.distinct("id", {"is_canonical_sound": True})
    fire_preserved = await db.post_fire_reactions.count_documents(
        {"active": True, "post_id": {"$in": canon_pids}}) if canon_pids else 0
    return {"mode": "dry_run", "tracks_total": total,
            "tracks_already_canonical": have, "tracks_to_backfill": missing,
            "missing_post_links": missing,
            "likes_to_convert": likes_to_convert,
            "existing_fire_reactions_preserved": fire_preserved,
            "tracks_needing_default_classification": no_class,
            "duplicate_canonical_posts_detected": dupes,
            "records_skipped": skipped,
            "destructive": False, "samples": samples}


async def _merge_post_engagement(keep_id: str, dup_id: str) -> None:
    """Move ALL engagement from a duplicate post onto the keeper without
    ever double-counting a user."""
    # Fire — move non-conflicting reactions; a user already holding fire
    # on the keeper keeps that reaction and the duplicate's copy is dropped.
    async for r in db.post_fire_reactions.find({"post_id": dup_id}, {"_id": 0, "id": 1, "user_id": 1}):
        exists = await db.post_fire_reactions.find_one(
            {"post_id": keep_id, "user_id": r["user_id"]}, {"_id": 0, "id": 1})
        if exists:
            await db.post_fire_reactions.delete_one({"id": r["id"]})
        else:
            await db.post_fire_reactions.update_one({"id": r["id"]}, {"$set": {"post_id": keep_id}})
    # Comments / emoji reactions / saves / shares / notifications.
    await db.comments.update_many({"post_id": dup_id}, {"$set": {"post_id": keep_id}})
    async for r in db.reactions.find({"target_type": "post", "target_id": dup_id},
                                     {"_id": 0, "id": 1, "user_id": 1}):
        exists = await db.reactions.find_one(
            {"target_type": "post", "target_id": keep_id, "user_id": r["user_id"]}, {"_id": 0, "id": 1})
        if exists:
            await db.reactions.delete_one({"id": r["id"]})
        else:
            await db.reactions.update_one({"id": r["id"]}, {"$set": {"target_id": keep_id}})
    for coll in ("saved_posts", "bookmarks", "post_shares", "shares"):
        try:
            await db[coll].update_many({"post_id": dup_id}, {"$set": {"post_id": keep_id}})
        except Exception:  # noqa: BLE001
            pass
    try:
        await db.notifications.update_many({"payload.post_id": dup_id},
                                           {"$set": {"payload.post_id": keep_id}})
    except Exception:  # noqa: BLE001
        pass


async def repair_duplicate_sound_posts() -> int:
    """Merge duplicate canonical Sound posts (and demoted migration
    artifacts) into the OLDEST valid canonical, migrating all engagement,
    then delete the duplicates. Idempotent."""
    from services.fire_power import recompute_post_fire
    repaired = 0
    track_ids: set = set()
    # Groups of >1 canonical posts per track.
    pipeline = [
        {"$match": {"is_canonical_sound": True, "sound_track_id": {"$ne": None}}},
        {"$group": {"_id": "$sound_track_id", "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}},
    ]
    async for row in db.posts.aggregate(pipeline):
        track_ids.add(row["_id"])
    # Demoted artifacts from earlier repairs (never user reposts — those
    # carry no migration_source) whose track already has a canonical.
    async for p in db.posts.find(
            {"is_canonical_sound": {"$ne": True}, "sound_track_id": {"$ne": None},
             "migration_source": {"$in": ["sound_backfill", "feed_heal", "lazy_heal"]}},
            {"_id": 0, "sound_track_id": 1}):
        track_ids.add(p["sound_track_id"])
    for tid in track_ids:
        group = [p async for p in db.posts.find(
            {"sound_track_id": tid,
             "$or": [{"is_canonical_sound": True},
                     {"migration_source": {"$in": ["sound_backfill", "feed_heal", "lazy_heal"]}}]},
            {"_id": 0, "id": 1, "created_at": 1, "deleted_at": 1, "is_canonical_sound": 1})]
        if len(group) < 2:
            continue
        valid = [p for p in group if not p.get("deleted_at")] or group
        keep = sorted(valid, key=lambda p: p.get("created_at") or "")[0]
        for dup in group:
            if dup["id"] == keep["id"]:
                continue
            await _merge_post_engagement(keep["id"], dup["id"])
            await db.posts.delete_one({"id": dup["id"]})
            repaired += 1
        await db.posts.update_one({"id": keep["id"]}, {"$set": {"is_canonical_sound": True}})
        await recompute_post_fire(keep["id"])
    return repaired


# Retained name — migration_execute calls this.
_repair_duplicate_canonicals = repair_duplicate_sound_posts


async def migration_execute(founder: dict) -> dict:
    await ensure_sound_indexes()
    created, skipped_existing, likes_converted = 0, 0, 0
    skipped_records, failures = [], []
    now = _now_iso()
    duplicates_repaired = await _repair_duplicate_canonicals()
    async for t in db.tracks.find({}, {"_id": 0}):
        try:
            if await canonical_post_for_track(t["id"]):
                skipped_existing += 1
                continue
            reason = _track_blocked(t)
            if reason:
                skipped_records.append({"track_id": t["id"], "reason": reason})
                continue
            _, converted = await backfill_canonical_for_track(t)
            created += 1
            likes_converted += converted
        except Exception as e:  # noqa: BLE001
            failures.append({"track_id": t.get("id"), "error": str(e)[:200]})
    report = {"mode": "execute", "posts_created": created,
              "skipped_existing": skipped_existing,
              "records_skipped": skipped_records,
              "duplicates_repaired": duplicates_repaired,
              "likes_converted_to_fire": likes_converted, "failures": failures,
              "executed_by": founder.get("username"), "executed_at": now}
    await db.sound_migration_log.insert_one({"id": uuid.uuid4().hex, "action": "execute", **report})
    report.pop("_id", None)
    return report


async def run_startup_migration() -> None:
    """Restart-safe automatic backfill — repairs duplicate Sound posts
    FIRST (merge engagement into the oldest canonical, delete copies),
    then guarantees uniqueness with a partial unique index, then
    backfills any legacy tracks. Idempotent no-op when clean."""
    merged = await repair_duplicate_sound_posts()
    if merged:
        log.info(f"[sound-migration] startup merged {merged} duplicate sound post(s)")
    await ensure_sound_indexes()
    report = await migration_dry_run()
    log.info(f"[sound-migration] startup dry-run: {report}")
    if report["tracks_to_backfill"] or report["duplicate_canonical_posts_detected"]:
        result = await migration_execute({"username": "system_startup"})
        log.info(f"[sound-migration] startup execute: {result}")


async def migration_rollback(founder: dict) -> dict:
    pids = [p["id"] async for p in db.posts.find(
        {"migration_source": "sound_backfill"}, {"_id": 0, "id": 1})]
    fire_removed = 0
    if pids:
        res = await db.post_fire_reactions.delete_many(
            {"post_id": {"$in": pids}, "source": "sound_migration"})
        fire_removed = res.deleted_count
        await db.posts.delete_many({"id": {"$in": pids}})
        await db.comments.delete_many({"post_id": {"$in": pids}})
    report = {"mode": "rollback", "posts_removed": len(pids),
              "fire_reactions_removed": fire_removed,
              "executed_by": founder.get("username"), "executed_at": _now_iso()}
    await db.sound_migration_log.insert_one({"id": uuid.uuid4().hex, "action": "rollback", **report})
    report.pop("_id", None)
    return report
