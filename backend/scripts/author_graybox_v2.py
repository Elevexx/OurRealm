"""GRAY-BOX vertical slice for the XY Engine V2 (schema_version:2) — no production art.
Proves: surface travel -> descend into lower ruins -> underground route -> hidden key
-> backtrack left -> ladder ascent -> surface backtrack right -> pyramid ramp climb
-> guardian/portal approach -> exact key_id unlock -> Nexus test area."""
import asyncio
import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

SRC = "a1fa88be6bdf48c5bf28b0fab18fb1dc"
GRAYBOX_ID = "9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b01"

L1 = {
    "title": "Jungle Ruins (Gray-box)", "mode": "side_scroll", "schema_version": 2,
    "zone": "forest", "world_w": 4200, "world_h": 1200, "view_h": 420,
    "player_hp": 34, "player_mana": 14, "hero_h": 64, "portal_h": 130,
    "spawn": {"x": 90, "y": 700},
    "intro": "Head right — find a way down into the lower ruins",
    "solids": [
        {"x": 0, "y": 1140, "w": 4200, "h": 60},            # deep floor — NO death pits
        {"x": 0, "y": 700, "w": 280, "h": 60},              # surface slab A (start)
        {"x": 360, "y": 700, "w": 1200, "h": 60},           # surface slab B -> descent edge 1560
        {"x": 1700, "y": 700, "w": 2500, "h": 60},          # surface slab C (east, pyramid + plateau)
        {"x": 1210, "y": 1060, "w": 56, "h": 80},           # cave pillar (jump over)
        {"x": 2560, "y": 760, "w": 80, "h": 380},           # cave east wall (closes underground)
        {"x": 2750, "y": 520, "w": 150, "h": 180},          # PYRAMID SUMMIT (solid block)
    ],
    "stairs": [
        {"x": 2380, "y": 0, "w": 370, "yl": 700, "yr": 520},  # pyramid west ramp up to summit
        {"x": 2900, "y": 0, "w": 280, "yl": 520, "yr": 700},  # pyramid east ramp down to plateau
    ],
    "one_way": [
        {"x": 276, "y": 700, "w": 88},                      # plank over ladder shaft
        {"x": 1575, "y": 900, "w": 130},                    # descent shaft rest platform
        {"x": 660, "y": 1040, "w": 90},                     # key pedestal
    ],
    "ladders": [
        {"x": 318, "y": 700, "h": 440},                     # return shaft: cave -> surface
    ],
    "rooms": [
        {"id": "surface", "label": "JUNGLE SURFACE", "x": 0, "y": 500, "w": 2380, "h": 200,
         "tint": "rgba(70,130,70,0.06)"},
        {"id": "ruins", "label": "LOWER RUINS", "x": 300, "y": 760, "w": 2260, "h": 380,
         "tint": "rgba(130,95,45,0.09)"},
        {"id": "pyramid", "label": "GREAT PYRAMID", "x": 2380, "y": 420, "w": 760, "h": 280,
         "tint": "rgba(150,120,55,0.07)"},
        {"id": "plateau", "label": "PORTAL PLATEAU", "x": 3140, "y": 500, "w": 1060, "h": 200,
         "tint": "rgba(115,75,205,0.07)"},
    ],
    "hazards": [
        {"x": 880, "y": 1120, "w": 120, "h": 20, "dmg": 2},  # cave spikes (jump over)
    ],
    "checkpoints": [
        {"id": "cp_descent", "x": 1470, "y": 700},
        {"id": "cp_cave", "x": 1570, "y": 1140},
        {"id": "cp_key", "x": 860, "y": 1140},
        {"id": "cp_pyramid", "x": 2300, "y": 700},
        {"id": "cp_plateau", "x": 3250, "y": 700},
    ],
    "keys": [
        {"key_id": "ancient_key", "label": "Ancient Key", "x": 705, "y": 1000},
    ],
    "portals": [
        {"portal_id": "nexus_gate", "label": "Nexus Gate", "x": 3950, "y": 700,
         "required_key_id": "ancient_key", "color": "#7A5CFF", "target": "next"},
    ],
    "pickups": [
        {"x": 700, "y": 660, "kind": "coin"}, {"x": 1100, "y": 660, "kind": "coin"},
        {"x": 1610, "y": 860, "kind": "coin"},
        {"x": 1500, "y": 1100, "kind": "potion"},
        {"x": 2820, "y": 480, "kind": "gem"},               # pyramid summit reward
        {"x": 3400, "y": 660, "kind": "potion"},
    ],
    "enemies": [
        {"x": 950, "y": 700, "type": "walker", "hp": 12, "attack": 3, "speed": 44, "xp": 9},
        {"x": 1420, "y": 1140, "type": "walker", "hp": 12, "attack": 3, "speed": 40, "xp": 10},
        {"x": 1900, "y": 980, "type": "bat", "hp": 10, "attack": 2, "speed": 50, "xp": 10, "anchor_y": 980},
        {"x": 620, "y": 1140, "type": "walker", "hp": 10, "attack": 2, "speed": 34, "xp": 9, "range": 60},
        {"x": 3350, "y": 700, "type": "walker", "hp": 16, "attack": 4, "speed": 50, "xp": 12},
        {"x": 3620, "y": 700, "type": "brute", "hp": 40, "attack": 7, "speed": 46, "xp": 24, "range": 140},
    ],
}

L2 = {
    "title": "Nexus Test Area (Gray-box)", "mode": "side_scroll", "schema_version": 2,
    "zone": "nexus", "world_w": 1800, "world_h": 800, "view_h": 380,
    "player_hp": 34, "player_mana": 14, "hero_h": 64, "portal_h": 130,
    "spawn": {"x": 80, "y": 640},
    "intro": "Level 2 loaded — the Rift Home lies right",
    "palette": {"sky": "#141033", "bg": "#0a0820", "glow": "#B98BFF"},
    "solids": [
        {"x": 0, "y": 640, "w": 1800, "h": 160},            # full floor — no pits
        {"x": 400, "y": 520, "w": 160, "h": 24},
        {"x": 680, "y": 430, "w": 150, "h": 24},
        {"x": 960, "y": 520, "w": 150, "h": 24},
    ],
    "stairs": [], "one_way": [{"x": 1200, "y": 540, "w": 120}], "ladders": [],
    "rooms": [{"id": "nexus", "label": "NEXUS TEST AREA", "x": 0, "y": 380, "w": 1800, "h": 260,
               "tint": "rgba(150,110,255,0.06)"}],
    "hazards": [], "checkpoints": [{"id": "cp_mid", "x": 900, "y": 640}],
    "keys": [],
    "portals": [{"portal_id": "nexus_end", "label": "Rift Home", "x": 1620, "y": 640,
                 "color": "#B98BFF", "target": "end"}],
    "pickups": [{"x": 470, "y": 480, "kind": "coin"}, {"x": 750, "y": 390, "kind": "gem"}],
    "enemies": [
        {"x": 600, "y": 400, "type": "bat", "hp": 10, "attack": 3, "speed": 55, "xp": 10, "anchor_y": 400},
        {"x": 1300, "y": 640, "type": "walker", "hp": 14, "attack": 4, "speed": 46, "xp": 11},
    ],
    "ending": True, "ending_title": "PART 2", "ending_subtitle": "COMING SOON",
}


async def main():
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    src = await db.games.find_one({"id": SRC}, {"_id": 0})
    spec = dict(src["spec"])
    spec["stages"] = [L1, L2]
    spec["title"] = "GRAYBOX XY ENGINE V2"
    prev = await db.games.find_one({"id": GRAYBOX_ID}, {"_id": 0, "spec.assets": 1})
    spec["assets"] = ((prev or {}).get("spec") or {}).get("assets") or {}  # keep wired production art
    spec["debug_collision"] = False
    from services.game_studio import validate_spec
    errs = validate_spec(spec, 5, expected_runtime="action_rpg_2_5d")
    print("validate_spec:", errs or "PASS")
    if errs:
        return
    now = datetime.now(timezone.utc).isoformat()
    doc = {**src, "id": GRAYBOX_ID, "title": "GRAYBOX XY ENGINE V2", "spec": spec,
           "status": src.get("status", "pending_approval"), "created_at": now, "updated_at": now}
    await db.games.delete_one({"id": GRAYBOX_ID})
    await db.games.insert_one(doc)
    print("graybox game ready:", GRAYBOX_ID)

asyncio.run(main())
