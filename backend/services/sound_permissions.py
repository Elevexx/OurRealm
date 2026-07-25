"""Sound reuse permissions (Phase 2 — OurRealm Media Studio).

Every Sound owner controls WHERE their Sound may be reused. Conservative
default: PLAYABLE ONLY — the Sound plays on the Sounds page / unified
player but may not be attached to new images, videos, or Realm
Soundscapes until the owner enables it.

Environment axes are forward-compatible with the Realm Audio Context
system (Phase 5+): new environment types map onto `future_environments`
until given their own flag.
"""
import logging
from datetime import datetime, timezone

from core.db import db

log = logging.getLogger("ourrealm.sound_permissions")

REUSE_FLAGS = (
    "image_posts", "video_posts",
    "personal_realm", "group_realm", "community_realm",
    "portal", "nexus_district", "world", "future_environments",
)

PRESETS = {
    "playable_only":    {f: False for f in REUSE_FLAGS},
    "media_posts":      {**{f: False for f in REUSE_FLAGS},
                         "image_posts": True, "video_posts": True},
    "realm_soundscapes": {**{f: False for f in REUSE_FLAGS},
                          "personal_realm": True, "group_realm": True,
                          "community_realm": True, "portal": True,
                          "nexus_district": True, "world": True,
                          "future_environments": True},
    "everywhere":       {f: True for f in REUSE_FLAGS},
    "no_new_reuse":     {f: False for f in REUSE_FLAGS},
}


def default_permissions() -> dict:
    return {f: False for f in REUSE_FLAGS}


def preset_for(perms: dict) -> str:
    for name in ("playable_only", "media_posts", "realm_soundscapes", "everywhere"):
        if all(bool(perms.get(f)) == PRESETS[name][f] for f in REUSE_FLAGS):
            return name
    return "custom"


def can_reuse(track: dict, use_type: str) -> bool:
    """Server-side gate for attaching a Sound to a new use. `use_type`
    is one of REUSE_FLAGS. Unavailable Sounds are never reusable."""
    if not track or track.get("deleted_at"):
        return False
    if track.get("moderation_status") in ("rejected", "hidden", "removed", "suspended"):
        return False
    perms = track.get("reuse_permissions") or default_permissions()
    if use_type not in REUSE_FLAGS:
        use_type = "future_environments"
    return bool(perms.get(use_type))


def permission_snapshot(track: dict) -> dict:
    """Frozen copy stored with each use — later permission changes never
    silently invalidate historical, legitimately-created uses."""
    return {
        "track_id": track.get("id"),
        "owner_id": track.get("user_id"),
        "permissions": dict(track.get("reuse_permissions") or default_permissions()),
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Migration (dry-run first; metadata-only, non-destructive) ─────────
async def migration_dry_run() -> dict:
    total = await db.tracks.count_documents({})
    missing_perms = await db.tracks.count_documents({"reuse_permissions": {"$exists": False}})
    legacy_videos = await db.videos.count_documents({"audio_rights_status": {"$exists": False}})
    videos_total = await db.videos.count_documents({})
    return {
        "mode": "dry_run", "destructive": False,
        "sounds_total": total,
        "sounds_missing_reuse_permissions": missing_perms,
        "sounds_default_after_migration": "playable_only",
        "videos_total": videos_total,
        "videos_to_label_legacy": legacy_videos,
        "legacy_label": "legacy_confirmation_not_collected",
    }


async def migration_execute() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    r1 = await db.tracks.update_many(
        {"reuse_permissions": {"$exists": False}},
        {"$set": {"reuse_permissions": default_permissions(),
                  "reuse_preset": "playable_only",
                  "reuse_migrated_at": now}})
    # Historical videos: LABEL ONLY — never claim uploaders confirmed
    # rights, never auto-mute, never alter media files.
    r2 = await db.videos.update_many(
        {"audio_rights_status": {"$exists": False}},
        {"$set": {"audio_rights_status": "legacy_confirmation_not_collected"}})
    report = {"mode": "execute", "sounds_defaulted_playable_only": r1.modified_count,
              "videos_labeled_legacy": r2.modified_count, "executed_at": now}
    await db.media_rights_migration_log.insert_one({**report})
    report.pop("_id", None)
    log.info(f"[media-rights-migration] {report}")
    return report


async def run_startup_migration() -> None:
    """Startup is DRY-RUN ONLY unless MEDIA_RIGHTS_MIGRATION_AUTORUN=true.
    Production execution requires explicit founder approval via the
    /api/sounds/admin/media-rights/execute endpoint."""
    import os
    report = await migration_dry_run()
    log.info(f"[media-rights-migration] startup dry-run: {report}")
    if os.environ.get("MEDIA_RIGHTS_MIGRATION_AUTORUN", "").lower() != "true":
        return
    if report["sounds_missing_reuse_permissions"] or report["videos_to_label_legacy"]:
        await migration_execute()
