"""Integrate Architecture Batch 2 + crowd citizen canary into nexus_central.
Reads /app/artifacts/nexus/batch2.json. Reuses each model for multiple placements (modular kit).
Adds white boulevard center-strip lights. Publishes next version with pre-publish snapshot."""
import asyncio
import copy
import json
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")


def iso():
    return datetime.now(timezone.utc).isoformat()


def M(eid, url, pos, s, rot=0.0, no_collide=False):
    props = {"url": url}
    if no_collide:
        props["no_collide"] = 1.0
    return {"id": eid, "type": "model", "pos": [float(p) for p in pos], "rot": [0.0, float(rot), 0.0],
            "scale": [float(s)] * 3, "color": "#1d2f5e", "props": props}


async def main():
    from core.db import db
    from services import nexus_world as nw
    b2 = json.load(open("/app/artifacts/nexus/batch2.json"))
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"})
    draft = copy.deepcopy(doc["draft"])
    z = next(zz for zz in draft["zones"] if zz["id"] == "nexus_central")
    ids = {e["id"] for e in z["entities"]}
    add = []

    def url(slug):
        rec = b2.get(slug) or {}
        return rec.get("runtime_url")

    if url("bg_skyline"):
        u = url("bg_skyline")
        for i, (x, zz2, s, r) in enumerate([(-62, -88, 46, 0.3), (0, -95, 55, 0), (62, -88, 46, -0.3),
                                            (-85, -20, 40, 1.2), (85, -20, 40, -1.2), (0, 96, 44, 3.14)]):
            add.append(M(f"m_b2_sky{i}", u, [x, 0, zz2], s, r, no_collide=True))
    if url("sky_bridge"):
        u = url("sky_bridge")
        add.append(M("m_b2_bridge0", u, [0, 10.5, 2], 7, 1.57, no_collide=True))
        add.append(M("m_b2_bridge1", u, [0, 13.5, -44], 7, 1.57, no_collide=True))
    if url("business_ship"):
        add.append(M("m_b2_bship", url("business_ship"), [-46, 24, 8], 14, 0.9, no_collide=True))
    if url("gaming_ship"):
        add.append(M("m_b2_gship", url("gaming_ship"), [46, 24, 8], 14, -0.9, no_collide=True))
    if url("flying_vehicle"):
        u = url("flying_vehicle")
        for i, (x, y, zz2, r) in enumerate([(-24, 30, -20, 0.6), (30, 34, 30, -1.2), (10, 40, -60, 2.2)]):
            add.append(M(f"m_b2_fv{i}", u, [x, y, zz2], 4, r, no_collide=True))

    # white center dashed strip (reference boulevard)
    for i, zz2 in enumerate(range(-40, 58, 7)):
        eid = f"nc_strip{i}"
        if eid not in ids:
            add.append({"id": eid, "type": "box", "pos": [0.0, 0.02, float(zz2)], "rot": [0, 0, 0],
                        "scale": [1.0, 0.06, 2.6], "color": "#e8f6ff", "props": {}})

    # crowd citizen canary swap (only if rig valid)
    cz = b2.get("crowd_citizen") or {}
    swapped_crowd = False
    if cz.get("rig_runtime") and (cz.get("skins") or 0) >= 1:
        for e in z["entities"]:
            if e["type"] == "crowd":
                rigs = [{"url": cz["rig_runtime"]}]
                if cz.get("walk_runtime"):
                    rigs[0]["walk"] = cz["walk_runtime"]
                e["props"]["rigs"] = rigs
                swapped_crowd = True

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
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": "stealth", "action": "batch2_integrate",
                                     "detail": {"added": [a["id"] for a in add], "crowd_swapped": swapped_crowd,
                                                "published_version": snap + 1}, "at": iso()})
    print(f"[b2-int] published v{snap + 1}: +{len(add)} entities, crowd citizen swapped={swapped_crowd}")


if __name__ == "__main__":
    asyncio.run(main())
