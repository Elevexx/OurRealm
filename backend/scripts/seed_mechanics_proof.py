"""Seed tiny founder-only mechanics-proof games for shooter portal + OWR
quest/world-gate completion drives. Idempotent (fixed ids). Delete after use."""
import asyncio
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

SHOOTER_ID = "proof-shooter-portal-v1"
OWR_ID = "proof-owr-gate-v1"

SHOOTER_SPEC = {
    "runtime": "shooter", "title": "PROOF Shooter Portal",
    "description": "Mechanics proof: one weak enemy, then the exit portal.",
    "player_representation": "robot",
    "stages": [
        {"title": "Proof Arena", "environment": "grid", "waves": 1, "enemies_per_wave": 1,
         "enemy_speed": 10, "enemy_hp": 1, "gunner_ratio": 0, "player_hp": 6,
         "fire_rate": 0.2, "bullet_speed": 500},
        {"title": "Stage Two Reached", "environment": "space", "waves": 1, "enemies_per_wave": 1,
         "enemy_speed": 10, "enemy_hp": 1, "gunner_ratio": 0, "player_hp": 6,
         "fire_rate": 0.2, "bullet_speed": 500},
    ],
}

OWR_SPEC = {
    "runtime": "open_world_rpg", "title": "PROOF OWR Gate",
    "description": "Mechanics proof: NPC quest -> defeat roamer -> world gate.",
    "player_representation": "explorer",
    "stages": [
        {"title": "Proof Vale", "environment": "sunset", "world_w": 900, "world_h": 700,
         "zones": [{"name": "Proof Zone", "x": 0, "y": 0, "w": 900, "h": 700, "environment": "sunset"}],
         "npcs": [{"name": "Proof Keeper", "x": 250, "y": 350,
                   "dialog": "Defeat the roamer to open the gate.",
                   "quest": {"type": "defeat", "target": 1, "reward_points": 40}}],
         "enemies": [{"type": "raider", "x": 420, "y": 350, "speed": 10}],
         "collectibles": 3,
         "goal": {"x": 700, "y": 350}},
    ],
}


async def main():
    from core.db import db
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
    now = datetime.now(timezone.utc).isoformat()
    for gid, spec in ((SHOOTER_ID, SHOOTER_SPEC), (OWR_ID, OWR_SPEC)):
        await db.games.update_one({"id": gid}, {"$set": {
            "id": gid, "title": spec["title"], "runtime": spec["runtime"],
            "description": spec["description"], "spec": spec,
            "status": "published", "created_by": founder["id"], "creator_id": founder["id"],
            "access": {"mode": "founder_only"},
            "fire_economy": {"enabled": False},
            "created_at": now, "updated_at": now}}, upsert=True)
        print("seeded", gid)

asyncio.run(main())
