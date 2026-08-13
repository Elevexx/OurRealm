"""Spawn Zone placement pass (audit follow-up, ZERO Meshy credits):
- storefront/tower models moved to dominate the first view
- canopy_ring reused as two walk-through boulevard gate rings (no_collide)
- 8 primitive box trees + trunks replaced by neon holo 'tree' entities
Publishes next version with pre-publish snapshot."""
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
    ents = z["entities"]

    drop = set()
    for e in ents:
        if e["id"].startswith(("nc_v2_tcw", "nc_v2_tce", "nc_v2_trw", "nc_v2_tre")):
            drop.add(e["id"])
    ents = [e for e in ents if e["id"] not in drop]

    moves = {
        # storefronts hug the boulevard, rotated to face it
        "m_nc_bld_w0": {"pos": [-30, 0, 50], "scale": 14, "rot": 1.57},
        "m_nc_bld_e0": {"pos": [30, 0, 50], "scale": 14, "rot": -1.57},
        "m_nc_bld_w2": {"pos": [-30, 0, -6], "scale": 14, "rot": 1.57},
        "m_nc_bld_e2": {"pos": [30, 0, -6], "scale": 14, "rot": -1.57},
        # display towers closer to skyline edge of view
        "m_nc_bld_w1": {"pos": [-50, 0, 18]},
        "m_nc_bld_e1": {"pos": [50, 0, 18]},
        "m_nc_bld_w3": {"pos": [-50, 0, -66]},
        "m_nc_bld_e3": {"pos": [50, 0, -66]},
        # canopy ring becomes a giant walk-through gate mid-boulevard
        "m_canopy": {"pos": [0, 0.2, 18], "scale": 24, "no_collide": 1},
    }
    for e in ents:
        mv = moves.get(e["id"])
        if not mv:
            continue
        if "pos" in mv:
            e["pos"] = [float(v) for v in mv["pos"]]
        if "scale" in mv:
            s = float(mv["scale"])
            e["scale"] = [s, s, s]
        if "rot" in mv:
            e["rot"] = [0, float(mv["rot"]), 0]
        if "no_collide" in mv:
            e.setdefault("props", {})["no_collide"] = 1.0

    canopy_url = next((e["props"]["url"] for e in ents if e["id"] == "m_canopy"), None)
    ids = {e["id"] for e in ents}
    add = []
    if canopy_url and "m_canopy2" not in ids:
        add.append({"id": "m_canopy2", "type": "model", "pos": [0, 0.2, -34], "rot": [0, 0, 0],
                    "scale": [24, 24, 24], "color": "#1d2f5e",
                    "props": {"url": canopy_url, "no_collide": 1}})
    tree_cols = {"w": "#2ee87a", "e": "#37c8ff"}
    for i, zz in enumerate([48, 16, -16, -48]):
        for side, x in (("w", -17), ("e", 17)):
            tid = f"nc_tree_{side}{i}"
            if tid not in ids:
                add.append({"id": tid, "type": "tree", "pos": [x, 0, zz], "rot": [0, 0, 0],
                            "scale": [1, 7.5, 1], "color": tree_cols[side], "props": {}})
    for e in add:
        ents.append(nw._clean_entity(e))
    z["entities"] = ents

    snap_ver = doc["published_version"]
    await db.nexus_versions.update_one({"world_id": "nexus-v1", "version": snap_ver},
        {"$set": {"world_id": "nexus-v1", "version": snap_ver, "world": doc["published"],
                  "label": f"pre-publish snapshot v{snap_ver}", "created_at": iso()}}, upsert=True)
    await db.nexus_worlds.update_one({"world_id": "nexus-v1"}, {"$set": {
        "draft": draft, "draft_version": doc["draft_version"] + 1,
        "published": draft, "published_version": snap_ver + 1, "updated_at": iso()}})
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": "stealth",
                                     "action": "asset_audit_placement_pass",
                                     "detail": {"dropped": sorted(drop), "moved": list(moves), "added": [a["id"] for a in add],
                                                "published_version": snap_ver + 1}, "at": iso()})
    print(f"[audit-placement] published v{snap_ver + 1}, entities {len(ents)}, dropped {len(drop)}, added {len(add)}")


if __name__ == "__main__":
    asyncio.run(main())
