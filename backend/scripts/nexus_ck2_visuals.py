"""CK2 zero-credit visuals: overhead canopy (X-rotation) + slow flight paths for ships/vehicles."""
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
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"})
    draft = copy.deepcopy(doc["draft"])
    z = next(zz for zz in draft["zones"] if zz["id"] == "nexus_central")
    flights = {
        "m_b2_bship": {"fradius": 12.0, "fspeed": 0.035},
        "m_b2_gship": {"fradius": 12.0, "fspeed": 0.03},
        "m_b2_fv0": {"fradius": 26.0, "fspeed": 0.09},
        "m_b2_fv1": {"fradius": 32.0, "fspeed": 0.07},
        "m_b2_fv2": {"fradius": 40.0, "fspeed": 0.08},
    }
    for e in z["entities"]:
        if e["id"] == "m_canopy":
            e["pos"] = [0.0, 26.0, -8.0]; e["rot"] = [1.5708, 0.0, 0.0]; e["scale"] = [46.0] * 3
            e["props"]["no_collide"] = 1.0
        if e["id"] == "m_canopy2":
            e["pos"] = [0.0, 33.0, -52.0]; e["rot"] = [1.35, 0.0, 0.0]; e["scale"] = [34.0] * 3
            e["props"]["no_collide"] = 1.0
        if e["id"] in flights:
            e["props"].update({"flight": "orbit", **flights[e["id"]]})
    snap = doc["published_version"]
    await db.nexus_versions.update_one({"world_id": "nexus-v1", "version": snap},
        {"$set": {"world_id": "nexus-v1", "version": snap, "world": doc["published"],
                  "label": f"pre-publish snapshot v{snap}", "created_at": iso()}}, upsert=True)
    await db.nexus_worlds.update_one({"world_id": "nexus-v1"}, {"$set": {
        "draft": draft, "draft_version": doc["draft_version"] + 1,
        "published": draft, "published_version": snap + 1, "updated_at": iso()}})
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": "stealth", "action": "ck2_visuals",
                                     "detail": {"canopy_overhead": True, "flights": list(flights),
                                                "published_version": snap + 1}, "at": iso()})
    print(f"[ck2] published v{snap + 1}: overhead canopy + {len(flights)} flight paths")


if __name__ == "__main__":
    asyncio.run(main())
