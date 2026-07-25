"""Phase 3 — Media Sound Selector: browse, eligibility, attachment.

All attachment decisions run server-side. The browser NEVER decides
eligibility — `validate_attachment()` re-checks the canonical track at
final publication time (post create / video replace-audio).
"""
import logging
from datetime import datetime, timezone

from fastapi import HTTPException

from core.db import db
from services.sound_permissions import can_reuse, default_permissions, permission_snapshot, preset_for

log = logging.getLogger("ourrealm.sound_attachments")

BAD_MODERATION = ("rejected", "hidden", "removed", "suspended")
BADGE_ELIGIBLE = "Available for OurRealm Reuse"
BADGE_PLAYABLE_ONLY = "Playable Only"
MAX_SEGMENT_SECONDS = 600.0


def _row(track: dict, owner: dict, use_type: str) -> dict:
    perms = track.get("reuse_permissions") or default_permissions()
    eligible = can_reuse(track, use_type)
    return {
        "id": track["id"],
        "title": track.get("title") or "Untitled",
        "creator_id": track.get("user_id"),
        "creator_username": (owner or {}).get("username"),
        "creator_name": (owner or {}).get("name"),
        "cover_url": track.get("cover_url"),
        "file_url": track.get("file_url"),
        "duration_seconds": track.get("duration_seconds"),
        "category": track.get("category"),
        "genre": track.get("genre") or None,
        "mood": track.get("mood") or None,
        "plays": int(track.get("plays") or 0),
        "reuse_eligible": eligible,
        "reuse_preset": track.get("reuse_preset") or preset_for(perms),
        "reuse_badge": BADGE_ELIGIBLE if eligible else BADGE_PLAYABLE_ONLY,
    }


async def browse_sounds(current: dict, use_type: str, q: str = "", category: str = "",
                        genre: str = "", mood: str = "", sort: str = "trending",
                        tab: str = "all", limit: int = 30,
                        include_facets: bool = False) -> dict:
    limit = min(max(1, int(limit)), 60)
    base: dict = {
        "deleted_at": {"$exists": False},
        "moderation_status": {"$nin": list(BAD_MODERATION)},
    }
    if tab == "mine":
        base["user_id"] = current["id"]
    else:
        base["$or"] = [{"visibility": "public"}, {"user_id": current["id"]}]
    if category:
        base["category"] = category
    if genre:
        base["genre"] = genre
    if mood:
        base["mood"] = mood
    if q.strip():
        base["title"] = {"$regex": q.strip()[:80], "$options": "i"}

    ordered_ids = None
    if tab == "saved":
        base["liked_by"] = current["id"]
    elif tab == "recent":
        recents = await db.user_recent_sounds.find(
            {"user_id": current["id"]}, {"_id": 0, "track_id": 1}
        ).sort("used_at", -1).limit(limit).to_list(limit)
        ordered_ids = [r["track_id"] for r in recents]
        base["id"] = {"$in": ordered_ids}

    sort_spec = [("plays", -1), ("likes", -1)] if sort == "trending" else [("created_at", -1)]
    tracks = await db.tracks.find(base, {"_id": 0}).sort(sort_spec).limit(limit).to_list(limit)
    if ordered_ids:
        pos = {tid: i for i, tid in enumerate(ordered_ids)}
        tracks.sort(key=lambda t: pos.get(t["id"], 999))

    owner_ids = list({t.get("user_id") for t in tracks if t.get("user_id")})
    owners = {u["id"]: u async for u in db.users.find(
        {"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "username": 1, "name": 1})}
    out = {"sounds": [_row(t, owners.get(t.get("user_id")), use_type) for t in tracks],
           "use_type": use_type, "badge_eligible": BADGE_ELIGIBLE,
           "badge_playable_only": BADGE_PLAYABLE_ONLY}
    if include_facets:
        facet_base = {"deleted_at": {"$exists": False},
                      "$or": [{"visibility": "public"}, {"user_id": current["id"]}]}
        genres = [g for g in await db.tracks.distinct("genre", facet_base) if g]
        moods = [m for m in await db.tracks.distinct("mood", facet_base) if m]
        out["genres"] = sorted(genres)
        out["moods"] = sorted(moods)
    return out


async def validate_attachment(track_id: str, use_type: str, current: dict) -> tuple[dict, dict]:
    """Authoritative server-side gate, called at FINAL publication time.
    Raises HTTPException with a user-actionable message on any failure."""
    track = await db.tracks.find_one({"id": track_id}, {"_id": 0})
    if not track or track.get("deleted_at"):
        raise HTTPException(status_code=410,
                            detail="That Sound is no longer available — please select another Sound.")
    if track.get("moderation_status") in BAD_MODERATION:
        raise HTTPException(status_code=410,
                            detail="That Sound is unavailable — please select another Sound.")
    if track.get("visibility") != "public" and track.get("user_id") != current["id"]:
        raise HTTPException(status_code=410,
                            detail="That Sound is now private — please select another Sound.")
    owner = await db.users.find_one({"id": track.get("user_id")},
                                    {"_id": 0, "id": 1, "username": 1, "name": 1,
                                     "account_status": 1})
    if not owner or (owner.get("account_status") or "active") not in ("active",):
        raise HTTPException(status_code=410,
                            detail="That Sound's creator is unavailable — please select another Sound.")
    if not can_reuse(track, use_type):
        raise HTTPException(status_code=403,
                            detail="The Sound owner hasn't enabled this Sound for that use.")
    return track, permission_snapshot(track)


def sanitize_settings(raw: dict, track: dict, use_type: str) -> dict:
    def _f(key, default, lo, hi):
        try:
            v = float(raw.get(key) if raw.get(key) is not None else default)
        except (TypeError, ValueError):
            v = default
        return round(min(max(v, lo), hi), 3)
    track_dur = float(track.get("duration_seconds") or MAX_SEGMENT_SECONDS)
    start = _f("start_seconds", 0.0, 0.0, max(0.0, track_dur - 0.5))
    duration = raw.get("duration_seconds") or raw.get("segment_seconds")
    if duration is not None:
        try:
            duration = round(min(max(float(duration), 0.5), MAX_SEGMENT_SECONDS), 3)
        except (TypeError, ValueError):
            duration = None
    return {
        "start_seconds": start,
        "duration_seconds": duration,
        "volume": _f("volume", 1.0, 0.0, 2.0),
        "fade_in": _f("fade_in", 0.0, 0.0, 10.0),
        "fade_out": _f("fade_out", 0.0, 0.0, 10.0),
        "loop": bool(raw.get("loop")) if use_type == "image_posts" else False,
    }


def attachment_doc(track: dict, owner_username, snapshot: dict, settings: dict,
                   use_type: str) -> dict:
    return {
        "track_id": track["id"],
        "title": track.get("title"),
        "cover_url": track.get("cover_url"),
        "file_url": track.get("file_url"),
        "track_duration_seconds": track.get("duration_seconds"),
        "owner_id": track.get("user_id"),
        "owner_username": owner_username,
        "use_type": use_type,
        **settings,
        "permission_snapshot": snapshot,
        "attached_at": datetime.now(timezone.utc).isoformat(),
    }


async def record_recent_use(user_id: str, track_id: str) -> None:
    await db.user_recent_sounds.update_one(
        {"user_id": user_id, "track_id": track_id},
        {"$set": {"used_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)
