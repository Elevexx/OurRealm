"""Release-versioned idempotent Nexus migration. Runs at backend startup in EVERY environment
(preview + production) so the next Republish promotes the complete v29 parity release.
Never clones users; computes environment-specific migration counts; never duplicates grants."""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("nexus.release")
MANIFEST_PATH = Path(__file__).resolve().parent.parent / "release" / "nexus_release.json"
LEGACY_STARTERS = ["starter_m", "starter_f", "av_d5b60b3e"]


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def apply_nexus_release(db):
    if not MANIFEST_PATH.exists():
        return
    man = json.loads(MANIFEST_PATH.read_text())
    rid, ver = man["release_id"], man["version"]
    state = await db.nexus_release_state.find_one({"_id": "state"}) or {}
    if state.get("release_id") == rid:
        return
    counts = {}
    # 1) avatar catalog (stable IDs; upsert exact docs, ownership untouched)
    for av in man.get("avatars", []):
        av.pop("_id", None)
        await db.nexus_avatars.update_one({"id": av["id"]}, {"$set": av}, upsert=True)
    counts["avatars_upserted"] = len(man.get("avatars", []))
    await db.nexus_avatars.update_many({"id": {"$in": LEGACY_STARTERS}},
                                       {"$set": {"status": "archived", "is_default": False}})
    await db.nexus_avatars.update_many({"id": {"$ne": "av_ninja"}}, {"$set": {"is_default": False}})
    await db.nexus_avatars.update_one({"id": "av_ninja"}, {"$set": {"is_default": True}})
    # 2) world promotion (snapshot whatever was live, then promote if older)
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"})
    wv = man["world_version"]
    if not doc or (doc.get("published_version") or 0) < wv:
        if doc and doc.get("published"):
            await db.nexus_versions.update_one(
                {"world_id": "nexus-v1", "version": doc["published_version"]},
                {"$set": {"world_id": "nexus-v1", "version": doc["published_version"],
                          "world": doc["published"], "label": f"pre-release snapshot v{doc['published_version']}",
                          "created_at": _iso()}}, upsert=True)
        await db.nexus_worlds.update_one({"world_id": "nexus-v1"}, {"$set": {
            "world_id": "nexus-v1", "published": man["world"], "published_version": wv,
            "draft": man["world"], "draft_version": (doc or {}).get("draft_version", 0) + 1,
            "updated_at": _iso()}}, upsert=True)
        counts["world_promoted_to"] = wv
    # 3) starter migration — legacy/empty users only, gender-preserving; premium selections preserved
    r1f = await db.users.update_many({"nexus_avatar_id": "starter_f"},
                                     {"$set": {"nexus_avatar_id": "av_ninja_f", "nexus_glow": "lime"}})
    r1m = await db.users.update_many({"nexus_avatar_id": {"$in": ["starter_m", "av_d5b60b3e"]}},
                                     {"$set": {"nexus_avatar_id": "av_ninja", "nexus_glow": "lime"}})
    r2 = await db.users.update_many({"nexus_avatar_id": {"$in": [None, ""]}},
                                    {"$set": {"nexus_avatar_id": "av_ninja"}})
    await db.users.update_many({"nexus_glow": {"$in": [None, ""]}}, {"$set": {"nexus_glow": "lime"}})
    counts["users_migrated_legacy"] = r1f.modified_count + r1m.modified_count
    counts["users_migrated_empty"] = r2.modified_count
    # 4) founder vault backfill — role-based, idempotent, zero burn
    premium_ids = [a["id"] for a in man.get("avatars", []) if a.get("eligibility") == "unlock"]
    granted = 0
    async for founder in db.users.find({"$or": [{"is_founder": True}, {"role": "founder"}]}, {"id": 1}):
        for aid in premium_ids:
            r = await db.nexus_avatar_unlocks.update_one(
                {"user_id": founder["id"], "avatar_id": aid},
                {"$setOnInsert": {"user_id": founder["id"], "avatar_id": aid, "fp_burned": 0,
                                  "founder_grant": True, "tx_id": "founder-vault", "at": _iso()}}, upsert=True)
            if r.upserted_id: granted += 1
    counts["founder_grants_backfilled"] = granted
    await db.nexus_release_state.update_one({"_id": "state"}, {"$set": {
        "release_id": rid, "version": ver, "applied_at": _iso(), "counts": counts,
        "world_version": wv, "runtime_files": man.get("counts", {}).get("runtime_files")}}, upsert=True)
    log.info("[nexus.release] applied %s: %s", rid, counts)
