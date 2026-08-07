"""Author the reference-quality 2-level side_scroll spec for JUNGLE RUINS TO NEXUS PORTAL.
v3: vertical multi-tier world (surface / underground ruins / deep caves), scrolling camY,
no death pits in L1, key-locked grand portals, floating Nexus L2."""
import asyncio
import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

GID = "a1fa88be6bdf48c5bf28b0fab18fb1dc"

L1_PLATS = [
    {"x": 0, "y": 300, "w": 760, "depth": 120},          # 0 surface start
    {"x": 820, "y": 258, "w": 110, "depth": 100},        # 1 stone step
    {"x": 960, "y": 216, "w": 120, "depth": 100},        # 2 stone step
    {"x": 1100, "y": 216, "w": 240, "depth": 90},        # 3 upper ruins
    {"x": 1360, "y": 216, "w": 140, "bridge": True},     # 4 rope bridge
    {"x": 1520, "y": 216, "w": 200, "depth": 90},        # 5 ruins
    {"x": 1770, "y": 258, "w": 110, "depth": 90},        # 6 pyramid base (up)
    {"x": 1900, "y": 216, "w": 110, "depth": 90},        # 7 pyramid step
    {"x": 2030, "y": 174, "w": 110, "depth": 90},        # 8 pyramid step
    {"x": 2160, "y": 132, "w": 170, "depth": 90},        # 9 PYRAMID SUMMIT
    {"x": 2350, "y": 174, "w": 100, "depth": 90},        # 10 descend
    {"x": 2470, "y": 216, "w": 100, "depth": 90},        # 11 descend
    {"x": 2590, "y": 258, "w": 220, "depth": 100},       # 12 upper approach
    {"x": 2840, "y": 300, "w": 560, "depth": 120},       # 13 boss grounds
    {"x": 600, "y": 480, "w": 900, "depth": 110},        # 14 UNDERGROUND ruins
    {"x": 1560, "y": 540, "w": 90, "depth": 80},         # 15 down-stair
    {"x": 1660, "y": 600, "w": 90, "depth": 80},         # 16 down-stair
    {"x": 0, "y": 660, "w": 3400},                       # 17 DEEP CAVE safety floor
    {"x": 2250, "y": 600, "w": 90, "depth": 80},         # 18 return stair
    {"x": 2360, "y": 540, "w": 90, "depth": 80},         # 19
    {"x": 2470, "y": 480, "w": 90, "depth": 80},         # 20
    {"x": 2580, "y": 420, "w": 90, "depth": 80},         # 21
    {"x": 2690, "y": 360, "w": 90, "depth": 80},         # 22
    {"x": 2790, "y": 330, "w": 90, "depth": 80},         # 23 rejoin surface
]
LEVEL1 = {
    "title": "Ancient Jungle Ruins", "mode": "side_scroll", "zone": "forest",
    "width": 3400, "world_h": 720, "ground_default": 660,
    "ambient": "bright", "hero_scale": 1.25, "hazard": "water",
    "player_hp": 34, "player_mana": 14, "start_x": 60,
    "intro": "Find the Ancient Key in the deep ruins, then awaken the Nexus portal \u2192",
    "platforms": L1_PLATS,
    "features": [
        {"type": "waterfall", "x": 520, "w": 56, "top": 40},
        {"type": "cave", "x": 1000, "y": 480, "w": 200},
        {"type": "arch", "x": 1250, "y": 480, "color": "#B14BF4"},
        {"type": "cave", "x": 2000, "y": 660, "w": 220},
        {"type": "crystal", "x": 760, "y": 660}, {"type": "crystal", "x": 2050, "y": 660},
    ],
    "checkpoints_x": [840, 1800, 2600, 2900],
    "pickups": [
        {"x": 430, "y": 270, "kind": "coin"}, {"x": 1180, "y": 186, "kind": "coin"},
        {"x": 2410, "y": 144, "kind": "coin"}, {"x": 3000, "y": 270, "kind": "coin"},
        {"x": 2245, "y": 96, "kind": "gem"},
        {"x": 1050, "y": 450, "kind": "potion"}, {"x": 900, "y": 630, "kind": "potion"},
        {"x": 700, "y": 450, "kind": "fire"}, {"x": 2650, "y": 228, "kind": "mana"},
        {"x": 2050, "y": 628, "kind": "key"},                 # THE ANCIENT KEY — deep caves
    ],
    "props": [{"x": 1010, "y": 480}, {"x": 2200, "y": 132}, {"x": 880, "y": 660}],
    "enemies": [
        {"x": 520, "type": "walker", "hp": 12, "attack": 3, "speed": 46, "xp": 9, "pi": 0},
        {"x": 1200, "type": "spitter", "hp": 12, "attack": 4, "speed": 40, "xp": 11, "pi": 3},
        {"x": 1600, "type": "walker", "hp": 14, "attack": 4, "speed": 50, "xp": 10, "pi": 5},
        {"x": 2100, "type": "bat", "hp": 10, "attack": 3, "speed": 55, "xp": 10, "anchor_y": 96},
        {"x": 900, "type": "walker", "hp": 14, "attack": 4, "speed": 48, "xp": 11, "pi": 14},
        {"x": 1750, "type": "brute", "hp": 26, "attack": 6, "speed": 44, "xp": 18, "pi": 17},
        {"x": 2150, "type": "spitter", "hp": 14, "attack": 4, "speed": 42, "xp": 12, "pi": 17},
        {"x": 3050, "type": "walker", "hp": 16, "attack": 5, "speed": 52, "xp": 12, "pi": 13},
    ],
    "boss": {"name": "Jungle Titan", "x": 3180, "y": 170, "hp": 95, "attack": 8,
             "phases": 3, "enrage_pct": 0.25, "xp": 60, "summons": True},
    "arena_x": 2950,
    "exit": {"x": 3280, "requires_keys": 1, "size": 2.0},
}

L2_PLATS = [
    {"x": 0, "y": 320, "w": 240, "deep": False},
    {"x": 320, "y": 290, "w": 120, "deep": False},
    {"x": 500, "y": 250, "w": 110, "deep": False},
    {"x": 670, "y": 300, "w": 100, "deep": False, "move": {"amp": 26, "speed": 1.2}},
    {"x": 840, "y": 258, "w": 120, "deep": False},
    {"x": 1020, "y": 308, "w": 100, "crumble": True},
    {"x": 1190, "y": 258, "w": 130, "deep": False},
    {"x": 1390, "y": 218, "w": 110, "deep": False},
    {"x": 1560, "y": 278, "w": 100, "deep": False, "move": {"amp": 30, "speed": 1.0}},
    {"x": 1730, "y": 238, "w": 130, "deep": False},
    {"x": 1920, "y": 298, "w": 100, "crumble": True},
    {"x": 2090, "y": 258, "w": 120, "deep": False},
    {"x": 2280, "y": 218, "w": 140, "deep": False},
    {"x": 2470, "y": 278, "w": 100, "deep": False, "move": {"amp": 24, "speed": 1.3}},
    {"x": 2640, "y": 318, "w": 300, "deep": False},
]
LEVEL2 = {
    "title": "Nexus Portal Realm", "mode": "side_scroll", "zone": "nexus",
    "width": 3000, "world_h": 540, "hero_scale": 1.25, "hazard": "void",
    "player_hp": 34, "player_mana": 14, "start_x": 60,
    "intro": "No ground below \u2014 leap the floating ruins to the final portal",
    "platforms": L2_PLATS,
    "features": [{"type": "crystal", "x": 120, "y": 320}, {"type": "crystal", "x": 1250, "y": 258},
                 {"type": "crystal", "x": 2910, "y": 318}],
    "checkpoints_x": [1240, 2140],
    "pickups": [
        {"x": 380, "y": 260, "kind": "coin"}, {"x": 900, "y": 228, "kind": "coin"},
        {"x": 2700, "y": 288, "kind": "coin"},
        {"x": 1240, "y": 226, "kind": "potion"}, {"x": 1440, "y": 186, "kind": "gem"},
        {"x": 1780, "y": 206, "kind": "key"},                 # THE NEXUS KEY
    ],
    "props": [{"x": 2340, "y": 218}],
    "enemies": [
        {"x": 950, "type": "bat", "hp": 12, "attack": 4, "speed": 60, "xp": 12, "anchor_y": 190},
        {"x": 1700, "type": "bat", "hp": 14, "attack": 4, "speed": 62, "xp": 13, "anchor_y": 170},
        {"x": 2450, "type": "bat", "hp": 14, "attack": 5, "speed": 64, "xp": 14, "anchor_y": 160},
        {"x": 2800, "type": "walker", "hp": 18, "attack": 5, "speed": 52, "xp": 14, "pi": 14},
    ],
    "exit": {"x": 2880, "requires_keys": 1, "size": 2.2, "color": "#B26BFF"},
    "ending": True, "ending_title": "PART 2", "ending_subtitle": "COMING SOON",
}


async def main():
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    g = await db.games.find_one({"id": GID}, {"_id": 0, "spec": 1, "edit_version": 1})
    spec = g["spec"]
    spec["stages"] = [LEVEL1, LEVEL2]
    spec["description"] = ("A premium 2.5D side-scrolling platform adventure: descend through ancient "
                           "jungle ruins into torch-lit caves, climb the great pyramid, defeat the Jungle "
                           "Titan and cross the Nexus into a floating realm among the stars.")
    spec["controls"] = ("\u25C0 \u25B6 run \u00b7 \u2B06/Space jump (double jump!) \u00b7 \u2694 attack \u00b7 "
                        "\u2726 ability \u00b7 \u27A0 dodge \u00b7 keyboard + gamepad on desktop")
    from services.game_studio import validate_spec
    errs = validate_spec(spec, 5, expected_runtime="action_rpg_2_5d")
    print("validate_spec:", errs or "PASS")
    if errs:
        return
    now = datetime.now(timezone.utc).isoformat()
    await db.games.update_one({"id": GID}, {"$set": {
        "spec": spec, "updated_at": now,
        "edit_version": (g.get("edit_version") or 0) + 1,
        "build_meta.map_author": "reference_match_v3_vertical_world"}})
    print("spec updated: v3 vertical multi-tier world authored")

asyncio.run(main())
