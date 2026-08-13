"""Spawn Zone polish pass: rigged crowd rigs, lit spawn pad, arrival fill lights.
Publishes v(next) with a pre-publish snapshot of the current published world."""
import asyncio
import copy
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")


def iso():
    return datetime.now(timezone.utc).isoformat()


async def main():
    from core.db import db
    from services import nexus_world as nw
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"})
    draft = copy.deepcopy(doc["draft"])
    z = next(zz for zz in draft["zones"] if zz["id"] == "nexus_central")

    rigs = []
    for aid in ("starter_m", "starter_f"):
        av = await db.nexus_avatars.find_one({"id": aid}, {"_id": 0})
        if av and av.get("rigged_base_url"):
            rigs.append({"url": av["rigged_base_url"],
                         "walk": (av.get("animation_urls") or {}).get("walk") or ""})
    print("crowd rigs:", rigs)

    ids = {e["id"] for e in z["entities"]}
    for e in z["entities"]:
        if e["type"] == "crowd" and rigs:
            e["props"]["rigs"] = [{k: v for k, v in r.items() if v} for r in rigs]
        if e["id"] == "nc_platform":
            e["color"] = "#1c2a52"

    add = [
        {"id": "nc_spawn_pad", "type": "ring", "pos": [0, 0.18, 60], "rot": [0, 0, 0],
         "scale": [1, 1.1, 1], "color": "#37c8ff", "props": {"radius": 5}},
        {"id": "nc_spawnl_l", "type": "light", "pos": [-5, 0, 63], "rot": [0, 0, 0],
         "scale": [1, 1, 1], "color": "#37c8ff", "props": {"intensity": 22}},
        {"id": "nc_spawnl_r", "type": "light", "pos": [5, 0, 63], "rot": [0, 0, 0],
         "scale": [1, 1, 1], "color": "#8a5cff", "props": {"intensity": 22}},
        {"id": "nc_spawnl_b", "type": "light", "pos": [0, 0, 74], "rot": [0, 0, 0],
         "scale": [1, 1, 1], "color": "#5cffe2", "props": {"intensity": 18}},
    ]
    for e in add:
        if e["id"] not in ids:
            z["entities"].append(nw._clean_entity(e))
    z["ambient"] = 0.85

    snap_ver = doc["published_version"]
    await db.nexus_versions.update_one({"world_id": "nexus-v1", "version": snap_ver},
        {"$set": {"world_id": "nexus-v1", "version": snap_ver, "world": doc["published"],
                  "label": f"pre-publish snapshot v{snap_ver}", "created_at": iso()}}, upsert=True)
    await db.nexus_worlds.update_one({"world_id": "nexus-v1"}, {"$set": {
        "draft": draft, "draft_version": doc["draft_version"] + 1,
        "published": draft, "published_version": snap_ver + 1, "updated_at": iso()}})
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": "stealth",
                                     "action": "spawn_polish_pass",
                                     "detail": {"rigs": len(rigs), "published_version": snap_ver + 1}, "at": iso()})
    print(f"[polish] published v{snap_ver + 1}, entities {len(z['entities'])}")


if __name__ == "__main__":
    asyncio.run(main())
