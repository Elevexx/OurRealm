"""Author the reference-quality 2-level side_scroll spec for JUNGLE RUINS TO NEXUS PORTAL."""
import asyncio
import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

GID = "a1fa88be6bdf48c5bf28b0fab18fb1dc"

# ── LEVEL 1: Ancient Jungle Ruins (interconnected, backtracking key route) ─
L1_PLATS = [
    {"x": 0, "y": 302, "w": 620},                       # 0 start grounds
    {"x": 680, "y": 302, "w": 420},                     # 1 past the falls gap
    {"x": 1140, "y": 262, "w": 110},                    # 2 stone step
    {"x": 1280, "y": 224, "w": 110},                    # 3 stone step (route split)
    {"x": 1430, "y": 190, "w": 260},                    # 4 UPPER ruins walk
    {"x": 1710, "y": 190, "w": 170, "bridge": True},    # 5 upper rope bridge
    {"x": 1900, "y": 190, "w": 230},                    # 6 upper ruins
    {"x": 1430, "y": 302, "w": 330},                    # 7 LOWER ruins under upper route
    {"x": 1800, "y": 302, "w": 420},                    # 8 underground cavern floor (key)
    {"x": 2150, "y": 190, "w": 220},                    # 9 upper continuation
    {"x": 2400, "y": 240, "w": 120},                    # 10 descent ledge
    {"x": 2550, "y": 302, "w": 430},                    # 11 mid grounds
    {"x": 3010, "y": 262, "w": 120},                    # 12 PYRAMID step 1
    {"x": 3150, "y": 224, "w": 120},                    # 13 step 2
    {"x": 3290, "y": 186, "w": 120},                    # 14 step 3
    {"x": 3430, "y": 148, "w": 160},                    # 15 SUMMIT
    {"x": 3610, "y": 186, "w": 110},                    # 16 descent
    {"x": 3740, "y": 224, "w": 100},                    # 17 descent
    {"x": 3860, "y": 224, "w": 150, "bridge": True},    # 18 wooden bridge
    {"x": 4030, "y": 302, "w": 370},                    # 19 boss grounds
]
LEVEL1 = {
    "title": "Ancient Jungle Ruins", "mode": "side_scroll", "zone": "forest",
    "width": 4400, "ambient": "bright", "hero_scale": 1.3, "hazard": "water",
    "player_hp": 34, "player_mana": 14, "start_x": 60,
    "intro": "Find the Ancient Key and awaken the Nexus portal \u2192",
    "platforms": L1_PLATS,
    "features": [
        {"type": "waterfall", "x": 648, "w": 56, "top": 40},
        {"type": "cave", "x": 1600, "w": 180}, {"type": "cave", "x": 1980, "w": 160},
        {"type": "crystal", "x": 2140},
        {"type": "waterfall", "x": 2500, "w": 44, "top": 60},
    ],
    "checkpoints_x": [1160, 2170, 2990, 4050],
    "pickups": [
        {"x": 400, "y": 272, "kind": "coin"}, {"x": 760, "y": 272, "kind": "coin"},
        {"x": 1320, "y": 194, "kind": "coin"}, {"x": 1550, "y": 160, "kind": "gem"},
        {"x": 1620, "y": 272, "kind": "potion"},
        {"x": 2140, "y": 272, "kind": "key"},                     # THE KEY — deep underground
        {"x": 2240, "y": 160, "kind": "coin"}, {"x": 2620, "y": 272, "kind": "fire"},
        {"x": 3500, "y": 118, "kind": "mana"},                    # pyramid summit
        {"x": 3910, "y": 194, "kind": "coin"},
    ],
    "props": [{"x": 1330}, {"x": 2180}, {"x": 3480}],
    "enemies": [
        {"x": 820, "type": "walker", "hp": 12, "attack": 3, "speed": 46, "xp": 9, "pi": 1},
        {"x": 1500, "type": "spitter", "hp": 12, "attack": 4, "speed": 40, "xp": 11, "pi": 4},
        {"x": 1900, "type": "walker", "hp": 14, "attack": 4, "speed": 50, "xp": 10, "pi": 8},
        {"x": 2060, "type": "bat", "hp": 10, "attack": 3, "speed": 55, "xp": 10, "anchor_y": 150},
        {"x": 2250, "type": "spitter", "hp": 14, "attack": 4, "speed": 42, "xp": 12, "pi": 9},
        {"x": 2760, "type": "brute", "hp": 26, "attack": 6, "speed": 44, "xp": 18, "pi": 11},
        {"x": 3200, "type": "bat", "hp": 12, "attack": 4, "speed": 58, "xp": 12, "anchor_y": 130},
        {"x": 3330, "type": "walker", "hp": 16, "attack": 5, "speed": 52, "xp": 12, "pi": 14},
    ],
    "boss": {"name": "Jungle Titan", "x": 4270, "y": 130, "hp": 95, "attack": 8,
             "phases": 3, "enrage_pct": 0.25, "xp": 60, "summons": True},
    "arena_x": 4060,
    "exit": {"x": 4330, "requires_keys": 1, "size": 1.5},
}

# ── LEVEL 2: Nexus Portal Realm (floating platforms, no ground) ──────
L2_PLATS = [
    {"x": 0, "y": 302, "w": 270},                        # 0 entry ledge
    {"x": 340, "y": 268, "w": 120},                      # 1
    {"x": 530, "y": 234, "w": 110},                      # 2
    {"x": 710, "y": 268, "w": 100, "move": {"amp": 26, "speed": 1.2}},   # 3
    {"x": 890, "y": 238, "w": 120},                      # 4
    {"x": 1080, "y": 278, "w": 105, "crumble": True},    # 5
    {"x": 1250, "y": 234, "w": 140},                     # 6 checkpoint isle
    {"x": 1460, "y": 198, "w": 110},                     # 7
    {"x": 1640, "y": 248, "w": 100, "move": {"amp": 30, "speed": 1.0}},  # 8
    {"x": 1820, "y": 216, "w": 130},                     # 9 KEY isle
    {"x": 2020, "y": 266, "w": 105, "crumble": True},    # 10
    {"x": 2190, "y": 232, "w": 130},                     # 11 checkpoint isle
    {"x": 2390, "y": 198, "w": 140},                     # 12 chest isle
    {"x": 2600, "y": 246, "w": 105, "move": {"amp": 24, "speed": 1.3}},  # 13
    {"x": 2780, "y": 290, "w": 320},                     # 14 final approach
]
LEVEL2 = {
    "title": "Nexus Portal Realm", "mode": "side_scroll", "zone": "nexus",
    "width": 3200, "hero_scale": 1.3, "hazard": "void",
    "player_hp": 34, "player_mana": 14, "start_x": 60,
    "intro": "No ground below \u2014 leap the floating ruins to the final portal",
    "platforms": L2_PLATS,
    "features": [{"type": "crystal", "x": 120}, {"type": "crystal", "x": 1300},
                 {"type": "rock", "x": 2230}, {"type": "crystal", "x": 2900}],
    "checkpoints_x": [1300, 2240],
    "pickups": [
        {"x": 420, "y": 238, "kind": "coin"}, {"x": 940, "y": 208, "kind": "coin"},
        {"x": 1300, "y": 204, "kind": "potion"},
        {"x": 1870, "y": 186, "kind": "key"},                    # THE NEXUS KEY
        {"x": 2440, "y": 168, "kind": "gem"}, {"x": 2860, "y": 260, "kind": "coin"},
    ],
    "props": [{"x": 2450}],
    "enemies": [
        {"x": 950, "type": "bat", "hp": 12, "attack": 4, "speed": 60, "xp": 12, "anchor_y": 170},
        {"x": 1700, "type": "bat", "hp": 14, "attack": 4, "speed": 62, "xp": 13, "anchor_y": 150},
        {"x": 2450, "type": "bat", "hp": 14, "attack": 5, "speed": 64, "xp": 14, "anchor_y": 140},
        {"x": 2900, "type": "walker", "hp": 18, "attack": 5, "speed": 52, "xp": 14, "pi": 14},
    ],
    "exit": {"x": 3060, "requires_keys": 1, "size": 1.8},
    "ending": True, "ending_title": "PART 2", "ending_subtitle": "COMING SOON",
}


async def main():
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    g = await db.games.find_one({"id": GID}, {"_id": 0, "spec": 1, "edit_version": 1})
    spec = g["spec"]
    spec["stages"] = [LEVEL1, LEVEL2]
    spec["description"] = ("A premium 2.5D side-scrolling platform adventure across two worlds: "
                           "the Ancient Jungle Ruins and the floating Nexus Portal Realm.")
    spec["controls"] = ("D-pad/arrows or A-D to run \u00b7 B/Space jump \u00b7 A/J attack \u00b7 "
                        "X/K ability \u00b7 Y/L dodge \u00b7 gamepad supported")
    from services.game_studio import validate_spec
    errs = validate_spec(spec, 5, expected_runtime="action_rpg_2_5d")
    print("validate_spec:", errs or "PASS")
    if errs:
        return
    now = datetime.now(timezone.utc).isoformat()
    await db.games.update_one({"id": GID}, {"$set": {
        "spec": spec, "updated_at": now,
        "edit_version": (g.get("edit_version") or 0) + 1,
        "build_meta.map_author": "reference_match_v2_side_scroll"}})
    print("spec updated: 2 side_scroll levels authored")

asyncio.run(main())
