"""Seed 'World Kitchen Quest: Skybound Chef' — 11-stage 2.5D greybox on the
proven arpgXY schema_version 2 engine (Jungle Ruins family).
Greybox-first: exact stage count, 1 key + 1 matching locked portal + 1 hidden
star + coins + checkpoint + complete route per stage. Final art wired later
slot-by-slot. Idempotent (fixed id). ER note: pickups are spec-declared;
Engagement Resource / Fire Power claims stay server-authoritative."""
import asyncio
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

GID = "wkq-skybound-chef-v2"
STAGES = [
    ("Sky Harbor Market", "forest"), ("Cloud Garden Terraces", "forest"),
    ("Copper Stormworks", "cave"), ("Frostfire Summit", "ice"),
    ("Neon Sushi District", "night"), ("Solar Spice Bazaar", "desert"),
    ("Celestial Pasta Towers", "night"), ("Monsoon Curry Docks", "forest"),
    ("Starlight Tagine Palace", "desert"), ("Aurora Festival Citadel", "night"),
    ("Arcane Hearth Nexus", "cave"),
]


def stage(n, title, zone):
    G = 880  # ground top
    key_id = f"stage{n}_key"
    diff = min(1 + n * 0.18, 3.0)
    # stair-step platform chain (gaps<=70, rises<=95 — comfortably jumpable)
    A, A2, B, C, E, D = (620, 770), (880, 695), (1140, 620), (1450, 770), (1720, 675), (1980, 580)
    plats = [(x, y, 200 if x not in (D[0], A2[0]) else 150) for x, y in (A, A2, B, C, E, D)]
    st = {
        "schema_version": 2, "mode": "side_scroll", "title": title, "zone": zone,
        "world_w": 3600, "world_h": 1000, "view_h": 420,
        "player_hp": 34, "player_mana": 14, "hero_h": 64, "portal_h": 130,
        "spawn": {"x": 90, "y": G},
        "intro": f"Stage {n}/11 — {title}. Find the {title} Key to unlock the exit portal!",
        "solids": [{"x": 0, "y": G, "w": 3600, "h": 60}] +
                  [{"x": x, "y": y, "w": w, "h": 40} for x, y, w in plats],
        "one_way": [], "ladders": [], "stairs": [],
        "rooms": [{"id": f"s{n}", "label": title.upper(), "x": 0, "y": 400,
                   "w": 3600, "h": 480, "tint": "rgba(80,120,180,0.06)"}],
        "keys": [{"key_id": key_id, "label": f"{title} Key",
                  "x": B[0] + 75, "y": B[1] - 40}],
        "portals": [{"portal_id": f"stage{n}_gate", "label": "Exit Portal",
                     "x": 3450, "y": G, "required_key_id": key_id,
                     "color": "#37C8FF", "target": "next"}],
        "checkpoints": [{"id": f"cp{n}_mid", "x": 1500, "y": G},
                        {"id": f"cp{n}_late", "x": 2700, "y": G}],
        "pickups": (
            [{"x": 400 + i * 300, "y": G - 40, "kind": "coin"} for i in range(8)] +
            [{"x": A[0] + 90, "y": A[1] - 40, "kind": "coin"},
             {"x": C[0] + 90, "y": C[1] - 40, "kind": "coin"},
             {"x": D[0] + 70, "y": D[1] - 40, "kind": "star"},   # exactly one hidden star
             {"x": E[0] + 60, "y": E[1] - 40, "kind": "gem"},    # rare optional
             {"x": 2500, "y": G - 40, "kind": "potion"},
             {"x": 3050, "y": G - 40, "kind": "chest"}]),
        "hazards": [{"x": 2050, "y": G - 20, "w": 120, "h": 20, "dmg": 2}],
        "torches": [{"x": 300, "y": G}, {"x": 1500, "y": G}, {"x": 2700, "y": G},
                    {"x": 3400, "y": G}],
        "enemies": (
            [{"x": 800 + i * 550, "y": G, "type": "walker",
              "hp": int(10 * diff), "attack": max(2, int(2 * diff)),
              "speed": 40 + n * 2, "xp": 8 + n} for i in range(2 + n // 4)] +
            [{"x": 1400, "y": 760, "type": "bat", "hp": int(8 * diff),
              "attack": 2, "speed": 50, "xp": 8 + n, "anchor_y": 760}]),
    }
    if n == 11:  # final guardian + restored Arcane Hearth finale
        st["enemies"].append({"x": 3100, "y": G, "type": "brute",
                              "hp": 120, "attack": 6, "speed": 46, "xp": 80,
                              "label": "Hearth Guardian"})
        st["torches"] += [{"x": 3300, "y": G}, {"x": 3360, "y": G}, {"x": 3420, "y": G}]
        st["intro"] = "Stage 11/11 — Arcane Hearth Nexus. Defeat the Hearth Guardian, claim the final key, restore the Hearth!"
    return st


async def main():
    from core.db import db
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
    now = datetime.now(timezone.utc).isoformat()
    spec = {
        "runtime": "action_rpg_2_5d", "title": "World Kitchen Quest: Skybound Chef",
        "complexity": 10, "ai_power": 10, "founder_max_quality": True,
        "description": "Aurora the Skybound Chef battles across 11 floating sky-city worlds to restore the Arcane Hearth. 2.5D action RPG — greybox build, final art pass in progress.",
        "player_representation": "explorer", "visual_theme": "sky_city",
        "assets": {},
        "completion_reward": {"kind": "fire_power", "amount": 10000,
                              "rule": "all_11_stages_verified_once_per_user"},
        "stages": [stage(i + 1, t, z) for i, (t, z) in enumerate(STAGES)],
    }
    await db.games.update_one({"id": GID}, {"$set": {
        "id": GID, "title": spec["title"], "runtime": "action_rpg_2_5d",
        "description": spec["description"], "spec": spec,
        "status": "published", "access": {"mode": "founder_only"},
        "created_by": founder["id"], "creator_id": founder["id"],
        "complexity": 10, "ai_power": 10, "founder_max_quality": True,
        "fire_economy": {"enabled": False,
                         "note": "banner removed per founder correction; modest server-verified milestones configured at final pass; 10,000 FP one-time completion reward stays in spec.completion_reward"},
        "created_at": now, "updated_at": now}}, upsert=True)
    print(f"seeded {GID}: {len(spec['stages'])} stages "
          f"(keys={sum(len(s['keys']) for s in spec['stages'])}, "
          f"portals={sum(len(s['portals']) for s in spec['stages'])}, "
          f"stars={sum(1 for s in spec['stages'] for p in s['pickups'] if p['kind'] == 'star')})")

asyncio.run(main())
