"""Spawn Zone visual pass 2: rings, signage, crowd, traffic, trees, accent lines. Publishes."""
import asyncio
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")


def iso():
    return datetime.now(timezone.utc).isoformat()


def E(i, t, pos, scale, color, label=None, rot=0, **props):
    p = {**props}
    if label:
        p["label"] = label
    return {"id": i, "type": t, "pos": pos, "rot": [0, rot, 0], "scale": scale, "color": color, "props": p}


async def main():
    from core.db import db
    from services import nexus_world as nw
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"})
    draft = doc["draft"]
    z = next(zz for zz in draft["zones"] if zz["id"] == "nexus_central")
    ents = [e for e in z["entities"] if not e["id"].startswith(("nc_crown", "nc_v2_"))]
    add = []
    # canopy rings replacing crown boxes
    add.append(E("nc_v2_ring1", "ring", [0, 27, -10], [1, 4, 1], "#37c8ff", radius=42))
    add.append(E("nc_v2_ring2", "ring", [0, 30, -10], [1, 3, 1], "#8a5cff", radius=36))
    add.append(E("nc_v2_ring3", "ring", [0, 33, -10], [1, 2, 1], "#2ee87a", radius=30))
    # signage
    add.append(E("nc_v2_title", "sign", [0, 34, -6], [58, 14, 1], "#37c8ff", text="NEXUS SPAWN ZONE"))
    add.append(E("nc_v2_orai", "sign", [0, 24, -46], [24, 6, 1], "#5cffe2", text="ORAi CORE ONLINE"))
    add.append(E("nc_v2_s_games", "sign", [-52, 12, -20], [20, 5, 1], "#c26bff", text="GAMING REALM"))
    add.append(E("nc_v2_s_maker", "sign", [52, 12, -20], [20, 5, 1], "#ff9a5c", text="GAMEMAKER REALM"))
    add.append(E("nc_v2_s_events", "sign", [-52, 12, 30], [20, 5, 1], "#ffd95c", text="EVENTS DISTRICT"))
    add.append(E("nc_v2_s_biz", "sign", [52, 12, 30], [20, 5, 1], "#5cffe2", text="BUSINESS REALM"))
    add.append(E("nc_v2_s_club", "sign", [-34, 8, 46], [14, 4, 1], "#ff6bd5", text="LIVE CLUB"))
    add.append(E("nc_v2_s_plaza", "sign", [34, 8, 46], [14, 4, 1], "#2ee87a", text="SOCIAL TERRACE"))
    # animated population + aerial traffic
    add.append(E("nc_v2_crowd", "crowd", [0, 0, 0], [40, 1, 60], "#141b30", count=46, radius=150))
    add.append(E("nc_v2_traffic", "traffic", [0, 0, 0], [1, 1, 1], "#37c8ff", count=12))
    # orange/green accent pathway lines
    for i in range(6):
        zz = 55 - i * 24
        add.append(E(f"nc_v2_lo{i}", "box", [-10.5, 0, zz], [0.5, 0.14, 12], "#ff9a5c"))
        add.append(E(f"nc_v2_lg{i}", "box", [10.5, 0, zz], [0.5, 0.14, 12], "#2ee87a"))
    # boulevard trees (trunk + canopy)
    for i in range(4):
        zz = 48 - i * 32
        for s, tg in ((-1, "w"), (1, "e")):
            add.append(E(f"nc_v2_tr{tg}{i}", "pillar", [s * 17, 0, zz], [0.7, 3.2, 0.7], "#3a2c1e"))
            add.append(E(f"nc_v2_tc{tg}{i}", "box", [s * 17, 3.2, zz], [3.4, 2.6, 3.4], "#1f5c34"))
    z["entities"] = ents + [nw._clean_entity(e) for e in add]
    snap_ver = doc["published_version"]
    await db.nexus_versions.update_one({"world_id": "nexus-v1", "version": snap_ver},
        {"$set": {"world_id": "nexus-v1", "version": snap_ver, "world": doc["published"],
                  "label": f"pre-publish snapshot v{snap_ver}", "created_at": iso()}}, upsert=True)
    await db.nexus_worlds.update_one({"world_id": "nexus-v1"}, {"$set": {
        "draft": draft, "draft_version": doc["draft_version"] + 1,
        "published": draft, "published_version": snap_ver + 1, "updated_at": iso()}})
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": "stealth",
                                     "action": "spawn_zone_visual_pass2",
                                     "detail": {"entities": len(z["entities"]), "published_version": snap_ver + 1}, "at": iso()})
    print(f"[pass2] nexus_central {len(z['entities'])} entities, published v{snap_ver + 1}")


if __name__ == "__main__":
    asyncio.run(main())
