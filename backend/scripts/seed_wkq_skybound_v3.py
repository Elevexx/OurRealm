"""Skybound Chef v3 — founder's revised 3-level AAA minimum.
Active playable chapters (unique routes): Sky Harbor Market (opening),
Neon Sushi District (middle), Arcane Hearth Nexus (finale, boss-gated portal).
The other 8 greybox stages are preserved untouched in spec.wip_stages.
Also seeds the Emerald Realm Key registry (server-authoritative, idempotent).
Preserves spec.assets across reseeds. Idempotent."""
import asyncio
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

GID = "wkq-skybound-chef-v2"
ARC_GID = "wkq-arcane-hearth-3d-v1"
G = 880


def base(n, title, zone, intro):
    return {
        "schema_version": 2, "mode": "side_scroll", "title": title, "zone": zone,
        "world_w": 3600, "world_h": 1000, "view_h": 420,
        "player_hp": 34, "player_mana": 14, "hero_h": 74, "portal_h": 150,
        "spawn": {"x": 90, "y": G}, "intro": intro,
        "one_way": [], "ladders": [], "stairs": [], "hazards": [], "rooms": [],
        "keys": [{"key_id": f"ch{n}_emerald_key", "label": "Emerald Realm Key",
                  "x": 0, "y": 0}],
        "portals": [{"portal_id": f"ch{n}_gate", "label": "Exit Portal",
                     "x": 3450, "y": G, "required_key_id": f"ch{n}_emerald_key",
                     "color": "#37C8FF", "target": "next"}],
    }


def stage1():
    st = base(1, "Sky Harbor Market", "skyharbor",
              "Chapter 1/3 — Sky Harbor Market. Climb the market crates, claim the "
              "Emerald Realm Key and open the exit portal!")
    st["solids"] = ([{"x": 0, "y": G, "w": 3600, "h": 60}] +
                    [{"x": x, "y": y, "w": w, "h": 40} for x, y, w in
                     [(500, 780, 180), (760, 700, 160), (1020, 620, 160), (1240, 545, 200)]])
    st["one_way"] = [{"x": 2200, "y": 760, "w": 140}, {"x": 2400, "y": 680, "w": 140}]
    st["stairs"] = [{"x": 1520, "yl": 585, "yr": 878, "w": 340}]
    st["keys"][0].update({"x": 1350, "y": 505})
    st["checkpoints"] = [{"id": "c1a", "x": 1900, "y": G}, {"id": "c1b", "x": 2900, "y": G}]
    st["pickups"] = (
        [{"x": 350 + i * 260, "y": G - 40, "kind": "coin"} for i in range(6)] +
        [{"x": 585, "y": 740, "kind": "coin"}, {"x": 1100, "y": 580, "kind": "coin"},
         {"x": 2265, "y": 720, "kind": "coin"},
         {"x": 2465, "y": 640, "kind": "star"},
         {"x": 840, "y": 660, "kind": "gem"},
         {"x": 2650, "y": G - 40, "kind": "potion"},
         {"x": 3080, "y": G - 40, "kind": "chest"}])
    st["hazards"] = [{"x": 2050, "y": G - 20, "w": 110, "h": 20, "dmg": 2}]
    st["torches"] = [{"x": 260, "y": G}, {"x": 1450, "y": G}, {"x": 2750, "y": G}, {"x": 3380, "y": G}]
    st["enemies"] = [
        {"x": 1180, "y": G, "type": "walker", "hp": 12, "attack": 2, "speed": 42, "xp": 9},
        {"x": 2320, "y": G, "type": "walker", "hp": 14, "attack": 2, "speed": 46, "xp": 10},
        {"x": 1900, "y": 700, "type": "bat", "hp": 9, "attack": 2, "speed": 50, "xp": 9, "anchor_y": 700}]
    st["rooms"] = [{"id": "s1", "label": "SKY HARBOR MARKET", "x": 0, "y": 400, "w": 3600,
                    "h": 480, "tint": "rgba(80,140,200,0.05)"}]
    return st


def stage2():
    st = base(2, "Neon Sushi District", "neon",
              "Chapter 2/3 — Neon Sushi District. Scale the glowing rooftops, take the "
              "Emerald Realm Key from the high sign and reach the portal!")
    st["solids"] = ([{"x": 0, "y": G, "w": 3600, "h": 60}] +
                    [{"x": x, "y": y, "w": w, "h": 40} for x, y, w in
                     [(450, 760, 150), (700, 660, 150), (980, 580, 170),
                      (1560, 560, 260), (1880, 500, 140), (2080, 470, 120),
                      (2800, 700, 140), (3040, 620, 130)]])
    st["one_way"] = [{"x": 1230, "y": 640, "w": 150}, {"x": 2450, "y": 760, "w": 150}]
    st["ladders"] = [{"x": 1660, "y": 560, "h": 320}]
    st["keys"][0].update({"x": 2140, "y": 430})
    st["checkpoints"] = [{"id": "c2a", "x": 1450, "y": G}, {"id": "c2b", "x": 2700, "y": G}]
    st["pickups"] = (
        [{"x": 300 + i * 280, "y": G - 40, "kind": "coin"} for i in range(6)] +
        [{"x": 775, "y": 620, "kind": "coin"}, {"x": 1065, "y": 540, "kind": "coin"},
         {"x": 1690, "y": 520, "kind": "coin"}, {"x": 1950, "y": 460, "kind": "coin"},
         {"x": 3105, "y": 580, "kind": "star"},
         {"x": 1305, "y": 600, "kind": "gem"},
         {"x": 2450, "y": G - 40, "kind": "potion"},
         {"x": 3200, "y": G - 40, "kind": "chest"}])
    st["hazards"] = [{"x": 1200, "y": G - 20, "w": 140, "h": 20, "dmg": 2},
                     {"x": 2600, "y": G - 20, "w": 160, "h": 20, "dmg": 2}]
    st["torches"] = [{"x": 300, "y": G}, {"x": 1500, "y": G}, {"x": 2400, "y": G}, {"x": 3380, "y": G}]
    st["enemies"] = [
        {"x": 900, "y": G, "type": "walker", "hp": 16, "attack": 3, "speed": 50, "xp": 11},
        {"x": 2350, "y": G, "type": "walker", "hp": 18, "attack": 3, "speed": 52, "xp": 12},
        {"x": 2950, "y": G, "type": "brute", "hp": 42, "attack": 4, "speed": 40, "xp": 22},
        {"x": 1400, "y": 720, "type": "bat", "hp": 11, "attack": 2, "speed": 56, "xp": 10, "anchor_y": 720},
        {"x": 2500, "y": 640, "type": "bat", "hp": 12, "attack": 3, "speed": 58, "xp": 11, "anchor_y": 640}]
    st["rooms"] = [{"id": "s2", "label": "NEON SUSHI DISTRICT", "x": 0, "y": 400, "w": 3600,
                    "h": 480, "tint": "rgba(160,80,220,0.05)"}]
    return st


def stage3():
    st = base(3, "Arcane Hearth Nexus", "nexus",
              "Chapter 3/3 — Arcane Hearth Nexus. Claim the Emerald Realm Key, defeat "
              "the Hearth Guardian and restore the Arcane Hearth!")
    st["solids"] = ([{"x": 0, "y": G, "w": 3600, "h": 60}] +
                    [{"x": x, "y": y, "w": w, "h": 40} for x, y, w in
                     [(600, 760, 170), (900, 680, 170), (1250, 600, 190),
                      (2380, 700, 170), (3050, 680, 120), (3210, 600, 110)]])
    st["stairs"] = [{"x": 1480, "yl": 640, "yr": 878, "w": 300}]
    st["keys"][0].update({"x": 2465, "y": 660})
    st["portals"][0]["required_boss"] = True
    st["checkpoints"] = [{"id": "c3a", "x": 1500, "y": G}, {"id": "c3b", "x": 2600, "y": G}]
    st["pickups"] = (
        [{"x": 320 + i * 270, "y": G - 40, "kind": "coin"} for i in range(6)] +
        [{"x": 985, "y": 640, "kind": "coin"}, {"x": 1340, "y": 560, "kind": "coin"},
         {"x": 3110, "y": 640, "kind": "coin"},
         {"x": 3265, "y": 560, "kind": "star"},
         {"x": 1340, "y": 555, "kind": "gem"},
         {"x": 2250, "y": G - 40, "kind": "potion"},
         {"x": 3320, "y": G - 40, "kind": "chest"}])
    st["hazards"] = [{"x": 1950, "y": G - 20, "w": 120, "h": 20, "dmg": 3},
                     {"x": 2150, "y": G - 20, "w": 120, "h": 20, "dmg": 3}]
    st["torches"] = [{"x": 250, "y": G}, {"x": 1200, "y": G}, {"x": 2050, "y": G},
                     {"x": 2750, "y": G}, {"x": 3300, "y": G}, {"x": 3400, "y": G}]
    st["enemies"] = [
        {"x": 800, "y": G, "type": "walker", "hp": 18, "attack": 3, "speed": 50, "xp": 12},
        {"x": 1800, "y": G, "type": "walker", "hp": 20, "attack": 3, "speed": 52, "xp": 13},
        {"x": 1200, "y": 700, "type": "bat", "hp": 12, "attack": 3, "speed": 56, "xp": 11, "anchor_y": 700},
        {"x": 2900, "y": G, "type": "golem", "hp": 140, "attack": 7, "speed": 44,
         "xp": 90, "boss": True, "label": "Hearth Guardian", "range": 260}]
    st["rooms"] = [{"id": "s3", "label": "ARCANE HEARTH NEXUS", "x": 0, "y": 400, "w": 3600,
                    "h": 480, "tint": "rgba(255,140,60,0.05)"}]
    return st


async def main():
    from core.db import db
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
    now = datetime.now(timezone.utc).isoformat()
    cur = await db.games.find_one({"id": GID}, {"_id": 0, "spec": 1}) or {}
    prev_spec = cur.get("spec") or {}
    assets = prev_spec.get("assets") or {}
    # preserve the 8 unfinished greybox stages as WIP (never deleted)
    wip = prev_spec.get("wip_stages")
    if not wip:
        old = prev_spec.get("stages") or []
        keep_titles = {"Sky Harbor Market", "Neon Sushi District", "Arcane Hearth Nexus"}
        wip = [s for s in old if s.get("title") not in keep_titles]
    spec = {
        "runtime": "action_rpg_2_5d", "title": "World Kitchen Quest: Skybound Chef",
        "complexity": 10, "ai_power": 10, "founder_max_quality": True,
        "description": "Aurora the Skybound Chef fights across the floating sky-city to "
                       "restore the Arcane Hearth. Three fully-finished AAA chapters; "
                       "further worlds in production.",
        "player_representation": "explorer", "visual_theme": "sky_city",
        "learning_objective": "Claim each chapter's Emerald Realm Key, defeat the guardians and restore the Arcane Hearth",
        "controls": "Arrows/WASD move · Space jump · J attack · K spice blast · L dodge",
        "assets": assets,
        "completion_reward": {"kind": "fire_power", "amount": 10000,
                              "rule": "finale_verified_once_per_user"},
        "stages": [stage1(), stage2(), stage3()],
        "wip_stages": wip,
        "wip_note": "8 additional worlds preserved as WIP greyboxes (founder directive).",
    }
    await db.games.update_one({"id": GID}, {"$set": {
        "id": GID, "title": spec["title"], "runtime": "action_rpg_2_5d",
        "description": spec["description"], "spec": spec,
        "status": "published", "access": {"mode": "founder_only"},
        "created_by": founder["id"], "creator_id": founder["id"],
        "complexity": 10, "ai_power": 10, "founder_max_quality": True,
        "updated_at": now}}, upsert=True)
    # ── Emerald Realm Key registry (server-authoritative; browser never picks) ──
    await db.user_realm_keys.create_index([("user_id", 1), ("key_id", 1)], unique=True)
    await db.realm_keys.create_index("key_id", unique=True)
    regs = (
        [(GID, i, t) for i, t in enumerate(
            ["Sky Harbor Market", "Neon Sushi District", "Arcane Hearth Nexus"])] +
        [(ARC_GID, i, t) for i, t in
         [(0, "Sky Harbor Kitchens"), (2, "Copper Stormworks"), (4, "Festival Citadel")]])
    for game_id, idx, title in regs:
        key_id = f"erk:{game_id}:L{idx + 1}:v1"
        await db.realm_keys.update_one({"key_id": key_id}, {"$set": {
            "key_id": key_id, "series": "world_kitchen_quest", "game_id": game_id,
            "level_index": idx, "level_title": title, "version": 1, "active": True,
            "requirable": True, "name": "Emerald Realm Key",
            "description": f"Awarded once for completing {title}.",
            "updated_at": now}}, upsert=True)
    print(f"seeded {GID}: 3 AAA chapters, {len(spec['wip_stages'])} WIP stages preserved, "
          f"{len(regs)} realm-key registry entries")

asyncio.run(main())
