"""Shooter + Open World RPG launch: seed original greybox demos, register
truthful runtime v2 capabilities, contract-test and promote to live.
Idempotent — safe to re-run. Usage: python scripts/launch_shooter_owr.py [--publish]
"""
import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

FOUNDER_USERNAME = "stealth"


def _iso():
    return datetime.now(timezone.utc).isoformat()


SHOOTER_SPEC = {
    "runtime": "shooter", "title": "Neon Breach: Sector Zero",
    "description": ("Original OurRealm demo — a top-down arena shooter. Hold the line as your "
                    "auto-blaster targets the nearest breach drone; clear every wave, then take the portal."),
    "player_representation": "robot",
    "stages": [
        {"title": "Perimeter Grid", "environment": "grid", "waves": 2, "enemies_per_wave": 4,
         "enemy_speed": 60, "enemy_hp": 2, "gunner_ratio": 0.2, "player_hp": 6,
         "fire_rate": 0.3, "bullet_speed": 420},
        {"title": "Orbital Relay", "environment": "space", "waves": 3, "enemies_per_wave": 5,
         "enemy_speed": 72, "enemy_hp": 2, "gunner_ratio": 0.3, "player_hp": 6,
         "fire_rate": 0.28, "bullet_speed": 440},
        {"title": "Core Meltdown", "environment": "lava", "waves": 3, "enemies_per_wave": 7,
         "enemy_speed": 86, "enemy_hp": 3, "gunner_ratio": 0.4, "player_hp": 6,
         "fire_rate": 0.26, "bullet_speed": 460},
    ],
}

OWR_SPEC = {
    "runtime": "open_world_rpg", "title": "Emberwild: The Roaming Vale",
    "description": ("Original OurRealm demo — roam a seamless open vale, take quests from wandering "
                    "keepers, gather sun relics, drive off roamers and unlock the world gate."),
    "player_representation": "explorer",
    "stages": [
        {"title": "The Roaming Vale", "environment": "sunset", "world_w": 2200, "world_h": 1400,
         "zones": [
             {"name": "Meadow Reach", "x": 0, "y": 0, "w": 1100, "h": 1400, "environment": "sunset"},
             {"name": "Ember Hollow", "x": 1100, "y": 0, "w": 1100, "h": 700, "environment": "lava"},
             {"name": "Crystal Shelf", "x": 1100, "y": 700, "w": 1100, "h": 700, "environment": "crystal"},
         ],
         "npcs": [
             {"name": "Keeper Lyra", "x": 320, "y": 360, "dialog": "The vale hides sun relics — gather them for the gate.",
              "quest": {"type": "collect", "target": 3, "reward_points": 40}},
             {"name": "Warden Bramm", "x": 1500, "y": 380, "dialog": "Roamers stalk the hollow. Drive them off!",
              "quest": {"type": "defeat", "target": 2, "reward_points": 40}},
         ],
         "enemies": [
             {"type": "raider", "x": 900, "y": 500, "speed": 66},
             {"type": "raider", "x": 1600, "y": 300, "speed": 72},
             {"type": "raider", "x": 1400, "y": 1100, "speed": 62},
         ],
         "collectibles": 6, "goal": {"x": 2050, "y": 1250}},
        {"title": "The Deepwild", "environment": "crystal", "world_w": 2600, "world_h": 1700,
         "zones": [
             {"name": "Glimmer Fen", "x": 0, "y": 0, "w": 1300, "h": 1700, "environment": "crystal"},
             {"name": "Night Steppe", "x": 1300, "y": 0, "w": 1300, "h": 850, "environment": "space"},
             {"name": "Ashen Rim", "x": 1300, "y": 850, "w": 1300, "h": 850, "environment": "lava"},
         ],
         "npcs": [
             {"name": "Scout Nyra", "x": 360, "y": 420, "dialog": "Deeper relics shine brighter — find four more.",
              "quest": {"type": "collect", "target": 4, "reward_points": 50}},
             {"name": "Elder Thorne", "x": 1700, "y": 500, "dialog": "Three roamers guard the rim. End their watch.",
              "quest": {"type": "defeat", "target": 3, "reward_points": 50}},
         ],
         "enemies": [
             {"type": "raider", "x": 1000, "y": 600, "speed": 74},
             {"type": "raider", "x": 1800, "y": 400, "speed": 80},
             {"type": "raider", "x": 1600, "y": 1300, "speed": 70},
             {"type": "raider", "x": 2200, "y": 1200, "speed": 76},
         ],
         "collectibles": 8, "goal": {"x": 2450, "y": 1550}},
    ],
}

DEMOS = [
    ("demo-shooter-neon-breach-v1", SHOOTER_SPEC, "shooter",
     "Original demo build: waves, chaser & gunner AI, auto-fire, exit portals."),
    ("demo-owr-emberwild-v1", OWR_SPEC, "open_world_rpg",
     "Original demo build: seamless world, zones, NPC quests, roamers, world gate."),
]


async def main(publish: bool):
    from core.db import db
    from services import game_studio as gs
    from services import engine_registry as er

    founder = await db.users.find_one({"username": FOUNDER_USERNAME}, {"_id": 0, "id": 1, "username": 1})
    now = _iso()

    for gid, spec, rt, note in DEMOS:
        errs = gs.validate_spec(spec, complexity=1, expected_runtime=rt)
        if errs:
            print(f"VALIDATION FAILED for {gid}: {errs}")
            return 1
        existing = await db.games.find_one({"id": gid}, {"_id": 0, "id": 1, "status": 1})
        if not existing:
            await db.games.insert_one({
                "id": gid, "title": spec["title"], "status": "approved", "stage": "preview_ready",
                "complexity": 1, "ai_power": 1, "runtime": rt, "spec": spec,
                "request": note, "plan": {"runtime": rt, "title": spec["title"]},
                "test_results": {"passed": True, "errors": [],
                                 "checks": ["runtime schema", "stage content", "deterministic greybox demo"]},
                "plays": 0, "saves": 0,
                "created_by": founder["id"], "created_by_username": founder["username"],
                "created_at": now, "updated_at": now, "review": {},
                "controls": {"desktop_enabled": True, "mobile_enabled": True},
                "gamemaker": {"style": "low_poly", "runtime_choice": rt, "created_via": "runtime_demo_seed"},
                "resource_manifest": ["fire"], "age_rating": "13+", "genre": rt,
                "access": {"mode": "published", "users": [], "badges": [], "badge_match": "any",
                           "levels": [], "min_level": None, "max_level": None,
                           "flags": {"fire": True, "keys": True, "saves": True,
                                     "leaderboard": True, "reports": True},
                           "filters": {}, "founder_bypass": True,
                           "visible_when_blocked": False, "maintenance_message": ""},
            })
            print(f"seeded demo game {gid} ({spec['title']})")
        else:
            print(f"demo game {gid} already present ({existing['status']})")
        await er.pin_game(gid, founder["username"])

        if publish:
            await db.games.update_one({"id": gid, "status": {"$ne": "published"}}, {"$set": {
                "status": "published", "published_at": now, "updated_at": now,
                "rollback_status": "approved"}})
            print(f"published {gid}")

    # ── Registry: truthful v2 + contract test + promote to live ──────────
    for rt in ("shooter", "open_world_rpg"):
        live = await db.gm_registry_versions.find_one(
            {"family": "runtime", "key": rt, "status": "live"}, {"_id": 0, "version": 1})
        if live:
            print(f"runtime {rt} already live at v{live['version']}")
            continue
        draft = await db.gm_registry_versions.find_one(
            {"family": "runtime", "key": rt, "status": "draft"}, {"_id": 0, "version": 1},
            sort=[("version", -1)])
        if draft:
            v = draft["version"]
        else:
            doc = await er.create_version("runtime", rt, founder["username"], clone_from_version=1)
            v = doc["version"]
        caps = {c: (c in er.RUNTIME_MECHANICS[rt]) for c in er.CAPABILITY_KEYS}
        await er.edit_draft("runtime", rt, v, {
            "engine_key": "orc_canvas_v1", "engine_version": 1,
            "capabilities": caps,
            "controls": {"keyboard": True, "touch": True, "gamepad": False},
            "asset_slots": er._asset_slots(rt),
            "spec_schema": f"spec_{rt}@1", "save_schema": "save_game_progress@1",
            "resource_manifest": "resource_manifest_engagement@1",
            "validation_suite": ["engine_binding", "impl_exists", "capability_truthfulness",
                                 "schemas_pinned", "controls_declared", "reference_spec"],
        }, founder["username"])
        result = await er.run_contract_checks(rt, v)
        await db.gm_registry_versions.update_one(
            {"family": "runtime", "key": rt, "version": v},
            {"$set": {"last_contract_test": result}})
        print(f"{rt} v{v} contract test: {'PASS' if result['passed'] else 'FAIL'}")
        for chk in result["checks"]:
            print(f"   {'✓' if chk['passed'] else '✗'} {chk['check']}: {chk['detail']}")
        if not result["passed"]:
            return 1
        for status in ("internal", "beta", "live"):
            await er.promote("runtime", rt, v, status, founder["username"])
        await db.gm_registry_items.update_one(
            {"family": "runtime", "key": rt},
            {"$set": {"description": "Implemented in orc_canvas_v1"}})
        print(f"{rt} v{v} promoted to LIVE")
    return 0


if __name__ == "__main__":
    rc = asyncio.run(main(publish="--publish" in sys.argv))
    sys.exit(rc)
