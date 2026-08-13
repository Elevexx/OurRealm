"""MASTER A composition pass (zero credit): NEXUS SPAWN ZONE identity signs, realm ship signs,
blue/green boulevard lane strips, extra portal-arch rows, denser crowd. Publishes with snapshot."""
import asyncio, copy, sys, uuid
from datetime import datetime, timezone
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")

def iso(): return datetime.now(timezone.utc).isoformat()

async def main():
    from core.db import db
    from services import nexus_world as nw
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"})
    draft = copy.deepcopy(doc["draft"])
    z = next(zz for zz in draft["zones"] if zz["id"] == "nexus_central")
    ids = {e["id"] for e in z["entities"]}
    add = [
        {"id": "ma_sign_nexus", "type": "sign", "pos": [0, 46, -78], "rot": [0, 0, 0], "scale": [26, 6, 1], "color": "#37c8ff", "props": {"text": "NEXUS"}},
        {"id": "ma_sign_spawn", "type": "sign", "pos": [0, 40, -78], "rot": [0, 0, 0], "scale": [18, 3.6, 1], "color": "#7dd3fc", "props": {"text": "SPAWN ZONE"}},
        {"id": "ma_sign_biz", "type": "sign", "pos": [-48, 27, -34], "rot": [0, 0.5, 0], "scale": [12, 3, 1], "color": "#8a5cff", "props": {"text": "BUSINESS REALM"}},
        {"id": "ma_sign_game", "type": "sign", "pos": [48, 27, -34], "rot": [0, -0.5, 0], "scale": [12, 3, 1], "color": "#ec4899", "props": {"text": "GAMING REALM"}},
        {"id": "ma_lane_blue0", "type": "box", "pos": [-7, 0.06, -56], "rot": [0, 0, 0], "scale": [0.8, 0.1, 44], "color": "#2f6bff", "props": {"intensity": 2.0, "no_collide": 1.0}},
        {"id": "ma_lane_green0", "type": "box", "pos": [7, 0.06, -56], "rot": [0, 0, 0], "scale": [0.8, 0.1, 44], "color": "#22c55e", "props": {"intensity": 2.0, "no_collide": 1.0}},
        {"id": "ma_lane_blue1", "type": "box", "pos": [-7, 0.06, -12], "rot": [0, 0, 0], "scale": [0.8, 0.1, 44], "color": "#2f6bff", "props": {"intensity": 2.0, "no_collide": 1.0}},
        {"id": "ma_lane_green1", "type": "box", "pos": [7, 0.06, -12], "rot": [0, 0, 0], "scale": [0.8, 0.1, 44], "color": "#22c55e", "props": {"intensity": 2.0, "no_collide": 1.0}},
        {"id": "ma_lane_blue2", "type": "box", "pos": [-7, 0.06, 32], "rot": [0, 0, 0], "scale": [0.8, 0.1, 44], "color": "#2f6bff", "props": {"intensity": 2.0, "no_collide": 1.0}},
        {"id": "ma_lane_green2", "type": "box", "pos": [7, 0.06, 32], "rot": [0, 0, 0], "scale": [0.8, 0.1, 44], "color": "#22c55e", "props": {"intensity": 2.0, "no_collide": 1.0}},
        
        {"id": "ma_arch5", "type": "portal", "pos": [-20, 0, 52], "rot": [0, 0, 0], "scale": [1, 1, 1], "color": "#f97316", "props": {"label": "Nexus Arch"}},
        {"id": "ma_arch6", "type": "portal", "pos": [20, 0, 52], "rot": [0, 0, 0], "scale": [1, 1, 1], "color": "#a3ff12", "props": {"label": "Nexus Arch"}},
        {"id": "ma_arch7", "type": "portal", "pos": [-20, 0, -38], "rot": [0, 0, 0], "scale": [1, 1, 1], "color": "#ec4899", "props": {"label": "Nexus Arch"}},
        {"id": "ma_arch8", "type": "portal", "pos": [20, 0, -38], "rot": [0, 0, 0], "scale": [1, 1, 1], "color": "#facc15", "props": {"label": "Nexus Arch"}},
        {"id": "ma_crowd_far", "type": "crowd", "pos": [0, 0, -44], "rot": [0, 0, 0], "scale": [56, 1, 40], "color": "#141b30", "props": {"count": 26, "radius": 150}},
    ]
    for e in z["entities"]:
        if e["id"] == "nc_v2_crowd":
            e["props"]["count"] = 60
    for e in add:
        if e["id"] not in ids:
            z["entities"].append(nw._clean_entity(e))
    snap = doc["published_version"]
    await db.nexus_versions.update_one({"world_id": "nexus-v1", "version": snap},
        {"$set": {"world_id": "nexus-v1", "version": snap, "world": doc["published"],
                  "label": f"pre-publish snapshot v{snap}", "created_at": iso()}}, upsert=True)
    await db.nexus_worlds.update_one({"world_id": "nexus-v1"}, {"$set": {
        "draft": draft, "draft_version": doc["draft_version"] + 1,
        "published": draft, "published_version": snap + 1, "updated_at": iso()}})
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": "stealth", "action": "master_a_composition",
                                     "detail": {"added": [a["id"] for a in add], "published_version": snap + 1}, "at": iso()})
    print(f"[ma] published v{snap + 1}: +{len(add)} entities, crowd 60")

if __name__ == "__main__":
    asyncio.run(main())
