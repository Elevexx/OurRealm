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

# FOUNDER STEALTH — private founder-only avatar (durable asset already in R2; never re-uploaded).
# Shipped with code so production Republish needs no manual DB work. Embedded Walking/Running
# clips are addressed with `url#Clip@speed` fragments; idle = Walking frozen at speed 0.
_FS_URL = "/api/media/models/e1f28ff8f8fe3ea0df4b6b0cf848b756.glb"
FOUNDER_STEALTH_AVATAR = {
    "id": "founder_stealth_private",
    "label": "Founder Stealth",
    "slug": "founder-stealth",
    "status": "founder_private",
    "is_default": False,
    "eligibility": "founder_only",
    "asset_id": "e1f28ff8f8fe3ea0df4b6b0cf848b756",
    "sha256": "e1f28ff8f8fe3ea0df4b6b0cf848b75684d171d3b44e4dde6eb6cd40119d4a69",
    "rigged_base_url": _FS_URL,
    "url": _FS_URL,
    "animation_urls": {
        "idle": f"{_FS_URL}#Walking@0",
        "walk": f"{_FS_URL}#Walking",
        "run": f"{_FS_URL}#Running",
    },
    "anim_source": "embedded",
    "gen": "founder-v1",
    "ktx2": False,
    "thumb": "/api/media/images/5bb0ed4349f6ae92e29fe338e8944470.webp",
    "thumbs": {
        "w512": "/api/media/images/32b2a40b229a4059e481678467872b99.webp",
        "w1024": "/api/media/images/5bb0ed4349f6ae92e29fe338e8944470.webp",
        "w2048": "/api/media/images/ff92c9004ad2d16e7a30f6b9b9a363f7.webp",
        "avif512": "/api/media/images/11e2366471df670098a35f4472c17a92.avif",
        "avif1024": "/api/media/images/92ff6f8bb7aaabae8d895e4379e55496.avif",
        "avif2048": "/api/media/images/98818b6a91cbc30a0813cff7823d7b7f.avif",
        "master8k": "/api/media/images/42c37b6f2254cab51a01c0ac70c4dd42.webp",
    },
    "thumb_gen": "v33-studio-render",
}


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def apply_nexus_release(db):
    # FOUNDER STEALTH — runs EVERY startup (idempotent, 2 cheap ops) so it applies even when the
    # release manifest itself is already current: ensure record + one-time founder default seed.
    await db.nexus_avatars.update_one({"id": FOUNDER_STEALTH_AVATAR["id"]},
                                      {"$set": FOUNDER_STEALTH_AVATAR}, upsert=True)
    seed = await db.users.update_one(
        {"username": "stealth",
         "$or": [{"is_founder": True}, {"role": "founder"}, {"admin_role": "founder"}],
         "founder_stealth_seeded": {"$ne": True}},
        {"$set": {"nexus_avatar_id": FOUNDER_STEALTH_AVATAR["id"], "founder_stealth_seeded": True}})
    if seed.modified_count:
        log.info("[nexus.release] founder stealth default seeded")
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
