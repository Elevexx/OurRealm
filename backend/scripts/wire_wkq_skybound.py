"""Wire all generated Skybound assets (raw → validated runtime derivative +
retained 8K master) into spec.assets. Resumable; reports per-slot outcome."""
import asyncio
import sys

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")
from scripts.wkq_gen import wire_slot, RAW_DIR  # noqa: E402
import os  # noqa: E402

GID = "wkq-skybound-chef-v2"

SLOTS = [
    # (slot, slug, is_sprite, max_px)
    ("hero_idle", "hero_idle", True, 768),
    ("hero_master", "aurora_master", True, 512),
    ("hero_run", "hero_run", True, 768),
    ("hero_jump_rise", "hero_jump_rise", True, 768),
    ("hero_jump_fall", "hero_jump_fall", True, 768),
    ("hero_attack", "hero_attack", True, 768),
    ("hero_cast", "hero_cast", True, 768),
    ("hero_dash", "hero_dash", True, 768),
    ("hero_hurt", "hero_hurt", True, 768),
    ("hero_death", "hero_death", True, 768),
    ("foe_walker", "foe_walker", True, 512),
    ("foe_bat", "foe_bat", True, 512),
    ("foe_brute", "foe_brute", True, 640),
    ("foe_golem", "foe_golem", True, 768),
    ("item_key", "item_key", True, 512),
    ("item_gem", "item_gem", True, 384),
    ("item_potion", "item_potion", True, 384),
    ("item_chest", "item_chest", True, 448),
    ("checkpoint_obelisk", "checkpoint_obelisk", True, 512),
    ("torch_flame", "torch_flame", True, 384),
    ("portal_frame", "portal_frame", True, 640),
    ("portal_locked", "portal_locked", True, 640),
    ("portal_active", "portal_active", True, 640),
    ("bg_skyharbor_far", "bg_skyharbor_far", False, 1536),
    ("bg_neon_far", "bg_neon_far", False, 1536),
    ("bg_nexus_far", "bg_nexus_far", False, 1536),
    ("bg_skyharbor_mid", "bg_skyharbor_mid", True, 1536),
    ("bg_neon_mid", "bg_neon_mid", True, 1536),
    ("bg_nexus_mid", "bg_nexus_mid", True, 1536),
    ("tile_skyharbor", "tile_skyharbor", False, 512),
    ("tile_neon", "tile_neon", False, 512),
    ("tile_nexus", "tile_nexus", False, 512),
]


async def main():
    from core.db import db
    for slot, slug, is_sprite, max_px in SLOTS:
        if not os.path.exists(f"{RAW_DIR}/{slug}.png"):
            print(f"{slot}: MISSING raw {slug}")
            continue
        try:
            print(await wire_slot(GID, slot, slug, is_sprite=is_sprite, max_px=max_px))
        except Exception as e:
            print(f"{slot}: ERROR {e}")
    g = await db.games.find_one({"id": GID}, {"_id": 0, "spec.assets": 1})
    ast = (g.get("spec") or {}).get("assets") or {}
    if "portal_active" in ast:
        await db.games.update_one({"id": GID}, {"$set": {
            "spec.assets.portal_unlocking": ast["portal_active"]}})
        print("portal_unlocking: aliased to portal_active")
    if "item_key" in ast:
        await db.realm_keys.update_many({"series": "world_kitchen_quest"}, {"$set": {
            "art": {"runtime_url": ast["item_key"]["url"],
                    "master_8k": ast["item_key"]["meta"].get("master_8k")}}})
        print("realm-key registry art: Emerald Realm Key wired")
    print(f"assets wired: {len(ast)+1}")

asyncio.run(main())
