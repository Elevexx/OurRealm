"""Arcane Hearth v2 — founder's 3-level AAA minimum (genuine WebGL 3D).
Active levels (unique routes + textures): L1 Sky Harbor Kitchens, L3 Copper
Stormworks, L5 Festival Citadel. L2/L4 preserved in spec.wip_levels_3d.
ER: coins common, FP milestones modest, gems rare (1-2), exactly ONE star.
Realm-key registry level_index remapped to the active array (0,1,2) with
level_no preserving original numbering. Preserves spec.assets. Idempotent."""
import asyncio
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

GID = "wkq-arcane-hearth-3d-v1"

LEVELS = [
    {
        "title": "Sky Harbor Kitchens", "level_no": 1,
        "sky": "#7fc4e8", "ember_color": "#ffe9b0",
        "ground_tex": "arc_ground_l1", "wall_tex": "arc_wall_l1",
        "spawn": [-17, 13],
        "walls": [[-6, -10, 10, 2], [6, 2, 2, 12], [-14, 4, 8, 2], [12, -8, 6, 2]],
        "props": [[-2, 14, 3, 1.2, 1.4], [16, 12, 3, 1.2, 1.4]],
        "npc": [-16, -10], "npc_color": "#4f9e6b",
        "station": [14, -12],
        "guardian": [12, 10], "guardian_hp": 6, "guardian_color": "#8a5c2e",
        "key": [0, 12], "portal": [18, 0], "star": [-19, 12],
        "ingredients": [[-10, 6], [2, -6], [8, 6]],
        "coins": [[-12, -4], [-4, -14], [3, 9], [9, -4], [15, 5], [-8, 12], [0, 3], [18, -8]],
        "gems": [[-19, -14]],
        "accent_lights": [[-6, -10, "#ffdf9e"], [-14, 4, "#bfe8ff"]],
    },
    {
        "title": "Copper Stormworks", "level_no": 3,
        "sky": "#3a2a1e", "ember_color": "#ff9a3c",
        "ground_tex": "arc_ground_l3", "wall_tex": "arc_wall_l3",
        "spawn": [-18, 12],
        "walls": [[0, -8, 16, 2], [-12, 2, 2, 10], [8, 4, 10, 2], [-4, 10, 8, 2], [16, -2, 2, 8]],
        "props": [[-16, -4, 1.6, 1.6, 1.6], [4, -13, 2.4, 1.4, 1.6]],
        "npc": [-17, -12], "npc_color": "#a8703a",
        "station": [17, -13],
        "guardian": [14, 11], "guardian_hp": 8, "guardian_color": "#6a4a8a",
        "key": [-16, 12], "portal": [19, 3], "star": [-19, -2],
        "ingredients": [[-6, -12], [6, -4], [-2, 5], [12, 8]],
        "coins": [[-14, 7], [-8, -6], [2, -12], [10, 1], [18, -9], [6, 12], [-2, 13], [14, 6], [-19, 5]],
        "gems": [[19, -14], [-9, 13]],
        "accent_lights": [[0, -8, "#ff8a3c"], [8, 4, "#ff8a3c"], [-12, 2, "#ffb35c"]],
    },
    {
        "title": "Festival Citadel", "level_no": 5,
        "sky": "#1d1440", "ember_color": "#ffd98c",
        "ground_tex": "arc_ground_l5", "wall_tex": "arc_wall_l5",
        "spawn": [-18, -13],
        "walls": [[-8, -6, 2, 8], [8, -6, 2, 8], [0, 6, 12, 2], [-16, 0, 6, 2], [16, 8, 6, 2]],
        "props": [[-13, 12, 2, 1.4, 2], [12, -14, 2, 1.4, 2]],
        "npc": [-16, 10], "npc_color": "#d9a441",
        "station": [15, -12],
        "guardian": [0, -2], "guardian_hp": 12, "guardian_scale": 0.95,
        "guardian_color": "#b3702d",
        "key": [0, 13], "portal": [19, -4], "star": [-19, -13], "boss": True,
        "ingredients": [[-12, -8], [-4, 2], [4, -10], [12, 3], [-2, -13]],
        "coins": [[-10, 4], [-4, -4], [4, 8], [10, -8], [16, 2], [-14, -4], [2, 12], [18, 12], [-18, 4], [8, 13]],
        "gems": [[19, 13], [-19, 8]],
        "accent_lights": [[-8, -6, "#ffd98c"], [8, -6, "#ffd98c"], [0, 6, "#c9a2ff"]],
    },
]


async def main():
    from core.db import db
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
    now = datetime.now(timezone.utc).isoformat()
    cur = await db.games.find_one({"id": GID}, {"_id": 0, "spec": 1}) or {}
    prev = cur.get("spec") or {}
    assets = prev.get("assets") or {}
    wip = prev.get("wip_levels_3d")
    if not wip:
        old = prev.get("levels_3d") or []
        keep = {"Sky Harbor Kitchens", "Copper Stormworks", "Festival Citadel"}
        wip = [x for x in old if x.get("title") not in keep]
    spec = {
        "runtime": "open_world_3d", "renderer_id": "renderer_three_v1",
        "complexity": 10, "ai_power": 10, "founder_max_quality": True,
        "world_3d": {"sky": "#16213e", "hero_color": "#2e7d4f"},
        "levels_3d": LEVELS,
        "wip_levels_3d": wip,
        "wip_note": "Cloud Garden Cloisters + Frostfire Catacombs preserved as WIP (founder directive).",
        "assets": assets,
        "stages": [{"title": lv["title"]} for lv in LEVELS],
        "learning_objective": "Help each chef, cook the dish, defeat the guardian, claim the Emerald Realm Key and open the portal",
        "controls": "WASD/arrows or touch-drag to move · walk into pickups · charge the guardian to strike",
        "description": "Maeve O'Rourke journeys through three bright, firelit Irish kitchen-realms to relight the Arcane Hearth. Genuine WebGL 3D — validated 3D character models arriving via the Meshy pass.",
    }
    econ = {"enabled": True, "paused": False, "pool": 100000, "pool_initial": 100000, "distributed": 0,
            "rewards": {"completion": 50, "final_completion": 250, "perfect": 0, "speed": 0,
                        "speed_time_s": 0, "boss": 0, "achievement": 0, "hidden_objective": 0,
                        "daily": 0, "weekly": 0},
            "daily_player_cap": 0, "claim_cooldown_s": 0,
            "note": "Modest server-verified milestones (founder directive): +50 FP per level, +250 finale, once per user (idempotent)."}
    await db.games.update_one({"id": GID}, {"$set": {
        "id": GID, "title": "World Kitchen Quest — Arcane Hearth",
        "runtime": "open_world_3d", "description": spec["description"], "spec": spec,
        "status": "published", "access": {"mode": "founder_only"},
        "created_by": founder["id"], "creator_id": founder["id"],
        "complexity": 10, "ai_power": 10, "founder_max_quality": True,
        "fire_economy": econ, "updated_at": now}}, upsert=True)
    # realm-key registry: remap to active level indices (0,1,2), keep L1/L3/L5 ids
    await db.realm_keys.delete_many({"game_id": GID})
    for idx, lv in enumerate(LEVELS):
        key_id = f"erk:{GID}:L{lv['level_no']}:v1"
        await db.realm_keys.update_one({"key_id": key_id}, {"$set": {
            "key_id": key_id, "series": "world_kitchen_quest", "game_id": GID,
            "level_index": idx, "level_no": lv["level_no"], "level_title": lv["title"],
            "version": 1, "active": True, "requirable": True, "name": "Emerald Realm Key",
            "description": f"Awarded once for completing {lv['title']}.",
            "updated_at": now}}, upsert=True)
    print(f"seeded {GID}: 3 AAA 3D levels, {len(wip)} WIP levels preserved, registry remapped 0/1/2")

asyncio.run(main())
