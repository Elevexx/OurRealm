"""Integrate city batch GLBs into nexus_central: replace primitive buildings/monument/arches
with Meshy models. Run AFTER scripts/nexus_city_batch.py completes (city_batch.json)."""
import asyncio
import json
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
    batch = json.load(open("/app/artifacts/nexus/city_batch.json"))
    u = {k: v.get("runtime_url") for k, v in batch.items() if isinstance(v, dict) and v.get("runtime_url")}
    print("available:", list(u))
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"})
    draft = doc["draft"]
    z = next(zz for zz in draft["zones"] if zz["id"] == "nexus_central")

    def M(i, url, pos, h, rot=0, label=None, color="#1d2f5e"):
        return nw._clean_entity({"id": i, "type": "model", "pos": pos, "rot": [0, rot, 0],
                                 "scale": [h, h, h], "color": color,
                                 "props": {"url": url, **({"label": label} if label else {})}})

    ents = z["entities"]
    out = []
    for e in ents:
        eid = e["id"]
        # replace flanking buildings with storefront/tower models
        if eid.startswith("nc_bld_") and "storefront" in u:
            side = -1 if "_w" in eid else 1
            j = int(eid[-1])
            if j % 2 == 0 and "storefront" in u:
                out.append(M(f"m_{eid}", u["storefront"], [e["pos"][0], 0, e["pos"][2]], min(30, e["scale"][1] * 0.6), rot=side * 0.08))
            elif "tower_blue" in u and "tower_green" in u:
                out.append(M(f"m_{eid}", u["tower_blue"] if side < 0 else u["tower_green"], [e["pos"][0], 0, e["pos"][2]], min(55, e["scale"][1]), rot=side * 0.08))
            else:
                out.append(e)
        elif eid == "nc_orai" and "orai_tower" in u:
            out.append(M("m_orai_tower", u["orai_tower"], [0, 3, -46], 26, label="ORAi"))
        elif eid.startswith("nc_sky") and "tower_blue" in u:
            k = int(eid[-1])
            url = u.get("tower_blue") if k % 2 else u.get("tower_green", u["tower_blue"])
            out.append(M(f"m_{eid}", url, [e["pos"][0], 0, e["pos"][2]], min(58, e["scale"][1] + 8)))
        elif eid.startswith("nc_v3_arch") and "portal_arch" in u:
            out.append(M(f"m_{eid}", u["portal_arch"], [e["pos"][0], 0, e["pos"][2]], 8))
            out.append(e)  # keep functional portal ring inside the arch
        elif eid.startswith("nc_sup") and ("tower_blue" in u or "tower_green" in u):
            url = u.get("tower_green") if e["pos"][0] > 0 else u.get("tower_blue")
            out.append(M(f"m_{eid}", url or u.get("tower_blue"), [e["pos"][0], 0, e["pos"][2]], 30))
        else:
            out.append(e)
    # canopy model segments accent (keep emissive rings for glow)
    if "canopy_ring" in u:
        out.append(M("m_canopy", u["canopy_ring"], [0, 24, -10], 20))
    z["entities"] = out
    snap_ver = doc["published_version"]
    await db.nexus_versions.update_one({"world_id": "nexus-v1", "version": snap_ver},
        {"$set": {"world_id": "nexus-v1", "version": snap_ver, "world": doc["published"],
                  "label": f"pre-publish snapshot v{snap_ver}", "created_at": iso()}}, upsert=True)
    await db.nexus_worlds.update_one({"world_id": "nexus-v1"}, {"$set": {
        "draft": draft, "draft_version": doc["draft_version"] + 1,
        "published": draft, "published_version": snap_ver + 1, "updated_at": iso()}})
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": "stealth",
                                     "action": "city_asset_integration",
                                     "detail": {"models": list(u), "published_version": snap_ver + 1}, "at": iso()})
    print(f"[integrate] published v{snap_ver + 1}, entities {len(out)}")


if __name__ == "__main__":
    asyncio.run(main())
