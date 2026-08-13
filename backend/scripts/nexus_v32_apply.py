"""V32 FINAL FIXES — idempotent release migration (ZERO Meshy credits).
1. Walk repair: store zero-credit retargeted natural-forward walk GLBs (built by
   scripts/v32_walk_retarget.js from the archived starter's walking_man clip) and point
   nexus_avatars.animation_urls.walk at them. Run animation untouched.
2. Legacy starter cleanup: archived starters stay archived; gender-preserving user migration
   (starter_f -> av_ninja_f, starter_m/av_d5b60b3e -> av_ninja, lime glow); av_ninja default.
3. Audit trail in nexus_audit (id v32-walk-retarget) + ledger artifact.
Safe to re-run: uploads are content-hash keyed, DB writes are $set upserts."""
import asyncio, json, os, sys
from datetime import datetime, timezone
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")
from scripts.nexus_citizen_canary import store

WALKS = {
    "av_ninja": "/tmp/v32/out/av_ninja_walk.glb",
    "av_ninja_f": "/tmp/v32/out/av_ninja_f_walk.glb",
    "av_streetwear": "/tmp/v32/out/av_streetwear_walk.glb",
    "av_tech_operative": "/tmp/v32/out/av_tech_operative_walk.glb",
    "av_realm_guardian": "/tmp/v32/out/av_realm_guardian_walk.glb",
    "av_aether_champion": "/tmp/v32/out/av_aether_champion_walk.glb",
    "av_arcane_sovereign": "/tmp/v32/out/av_arcane_sovereign_walk.glb",
    "av_void_wizard": "/tmp/v32/out/av_void_wizard_walk.glb",
}


async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    bal0 = (await mp.health()).get("balance")
    ledger = {"balance_start": bal0, "directive": "nexus-v32-final-fixes", "credits_spent": 0, "walks": {}}
    for aid, path in WALKS.items():
        if not os.path.exists(path):
            raise RuntimeError(f"{aid}: retargeted walk missing at {path} — run v32_walk_retarget.js first")
        u, meta = await store(db, mp, media_dir, get_storage_adapter, path,
                              f"{aid} natural forward walk (v32 zero-credit retarget)",
                              f"{aid}_walk_v32", "v32-walk-retarget", "animation")
        if not meta.get("animations"):
            raise RuntimeError(f"{aid}: stored walk GLB has no animation")
        prev = await db.nexus_avatars.find_one({"id": aid}, {"_id": 0, "animation_urls": 1})
        await db.nexus_avatars.update_one({"id": aid}, {"$set": {
            "animation_urls.walk": u, "walk_fix": "v32-natural-forward",
            "walk_prev": (prev.get("animation_urls") or {}).get("walk")}})
        ledger["walks"][aid] = u
        print(f"[v32] {aid} walk -> {u}", flush=True)
    # legacy starter cleanup (idempotent, gender-preserving)
    await db.nexus_avatars.update_many({"id": {"$in": ["starter_m", "starter_f", "av_d5b60b3e"]}},
                                       {"$set": {"status": "archived", "is_default": False}})
    await db.nexus_avatars.update_many({"id": {"$ne": "av_ninja"}}, {"$set": {"is_default": False}})
    await db.nexus_avatars.update_one({"id": "av_ninja"}, {"$set": {"is_default": True}})
    rf = await db.users.update_many({"nexus_avatar_id": "starter_f"},
                                    {"$set": {"nexus_avatar_id": "av_ninja_f", "nexus_glow": "lime"}})
    rm = await db.users.update_many({"nexus_avatar_id": {"$in": ["starter_m", "av_d5b60b3e"]}},
                                    {"$set": {"nexus_avatar_id": "av_ninja", "nexus_glow": "lime"}})
    re_ = await db.users.update_many({"nexus_avatar_id": {"$in": [None, ""]}},
                                     {"$set": {"nexus_avatar_id": "av_ninja"}})
    await db.users.update_many({"nexus_glow": {"$in": [None, ""]}}, {"$set": {"nexus_glow": "lime"}})
    ledger["users_migrated"] = {"female": rf.modified_count, "male": rm.modified_count, "empty": re_.modified_count}
    ledger["balance_end"] = (await mp.health()).get("balance")
    os.makedirs("/app/artifacts/nexus", exist_ok=True)
    json.dump(ledger, open("/app/artifacts/nexus/v32_ledger.json", "w"), indent=1)
    await db.nexus_audit.update_one({"id": "v32-walk-retarget"}, {"$set": {
        "id": "v32-walk-retarget", "actor": "stealth", "action": "v32_final_fixes",
        "detail": {"scope": "zero-credit walk retarget (walking_man clip) + legacy starter cleanup",
                   "credits_spent": 0, "balance_start": bal0, "balance_end": ledger["balance_end"],
                   "walks": ledger["walks"], "users_migrated": ledger["users_migrated"]},
        "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    print(f"[v32] DONE credits 0, balance {bal0} -> {ledger['balance_end']}, users {ledger['users_migrated']}", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
