import asyncio
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv()
from core.db import db  # noqa: E402

GAME = {
    "id": "dragonrealm-firequest-v1",
    "title": "Dragon Realm: The Fire Quest",
    "runtime": "turn_based_creature_rpg",
    "genre": "creature-rpg",
    "status": "approved",
    "labels": ["dragon-realm", "founder-only"],
    "description": "Explore the Enchanted Forest, befriend wild dragons, master spells and defeat THORNBEAST in a retro pixel creature RPG.",
    "version": 1,
    "spec": {
        "runtime": "turn_based_creature_rpg",
        "runtime_id": "runtime_dragon_realm_rpg_v1",
        "template_id": "tpl_dragon_realm_fire_quest_v1",
        "renderer_id": "renderer_pixel_creature_rpg_v1",
        "title": "Dragon Realm: The Fire Quest",
        "description": "A polished retro pixel-art creature RPG. Explore, battle, befriend dragons and claim real Fire Power rewards.",
        "controls": "Arrow keys / WASD / tap to move · tap the dragon to cast spells",
        "learning_objective": "Adventure",
    },
    "complexity": 8, "ai_power": 8,
    "created_at": datetime.now(timezone.utc).isoformat(),
    "updated_at": datetime.now(timezone.utc).isoformat(),
}


async def main():
    r = await db.games.update_one({"id": GAME["id"]}, {"$setOnInsert": GAME}, upsert=True)
    print("seeded" if r.upserted_id else "already exists")

asyncio.run(main())
