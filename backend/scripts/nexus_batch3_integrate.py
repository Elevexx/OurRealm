"""Integrate Architecture Batch 3 into nexus_central + zero-credit density pass
(deep skyline ring, extra flying traffic, billboard signs). Publishes with pre-publish snapshot."""
import asyncio, copy, json, sys, uuid
from datetime import datetime, timezone
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")

def iso(): return datetime.now(timezone.utc).isoformat()

def M(eid, url, pos, s, rot=0.0, lod2=None):
    props = {"url": url, "no_collide": 1.0}
    if lod2: props["lod2"] = lod2
    return {"id": eid, "type": "model", "pos": [float(p) for p in pos], "rot": [0.0, float(rot), 0.0],
            "scale": [float(s)] * 3, "color": "#1d2f5e", "props": props}

async def main():
    from core.db import db
    from services import nexus_world as nw
    b3 = json.load(open("/app/artifacts/nexus/batch3.json"))
    b2 = json.load(open("/app/artifacts/nexus/batch2.json"))
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"})
    draft = copy.deepcopy(doc["draft"])
    z = next(zz for zz in draft["zones"] if zz["id"] == "nexus_central")
    ids = {e["id"] for e in z["entities"]}
    add = []

    def u(slug): return (b3.get(slug) or {}).get("runtime_url")
    def l2(slug): return (b3.get(slug) or {}).get("lod2_url")

    if u("led_tower"):
        for i, (x, zz2, s, r) in enumerate([(-70, -62, 42, 0.5), (70, -62, 42, -0.5), (-96, 40, 36, 1.3), (96, 40, 36, -1.3)]):
            add.append(M(f"m_b3_led{i}", u("led_tower"), [x, 0, zz2], s, r, l2("led_tower")))
    if u("terrace_block"):
        for i, (x, zz2, s, r) in enumerate([(-30, 22, 13, 1.57), (30, 22, 13, -1.57), (-30, -30, 13, 1.57), (30, -30, 13, -1.57)]):
            add.append(M(f"m_b3_ter{i}", u("terrace_block"), [x, 0, zz2], s, r, l2("terrace_block")))
    if u("spire_cluster"):
        for i, (x, zz2, s, r) in enumerate([(-120, -130, 58, 0.4), (120, -130, 58, -0.4), (-150, 10, 52, 1.2),
                                            (150, 10, 52, -1.2), (0, -155, 60, 0.0), (-120, 120, 50, 2.6), (120, 120, 50, -2.6)]):
            add.append(M(f"m_b3_spire{i}", u("spire_cluster"), [x, 0, zz2], s, r, l2("spire_cluster")))
    if u("holo_club"):
        for i, (x, zz2, s, r) in enumerate([(-60, 60, 16, 0.9), (60, 60, 16, -0.9)]):
            add.append(M(f"m_b3_club{i}", u("holo_club"), [x, 0, zz2], s, r, l2("holo_club")))

    # zero-credit: deep skyline second ring (reuse batch2 bg_skyline runtime)
    sky = (b2.get("bg_skyline") or {}).get("runtime_url")
    if sky:
        for i, (x, zz2, s, r) in enumerate([(-140, -60, 56, 0.9), (140, -60, 56, -0.9), (-95, -140, 60, 0.35),
                                            (95, -140, 60, -0.35), (-160, 80, 52, 1.8), (160, 80, 52, -1.8),
                                            (-60, 140, 48, 2.8), (60, 140, 48, -2.8)]):
            add.append(M(f"m_b3_dsky{i}", sky, [x, 0, zz2], s, r))
    # zero-credit: extra flying traffic (reuse batch2 flying_vehicle runtime)
    fv = (b2.get("flying_vehicle") or {}).get("runtime_url")
    if fv:
        for i, (x, y, zz2, rad, sp) in enumerate([(-50, 28, 40, 34, 0.06), (55, 44, -40, 48, 0.05), (0, 52, 0, 66, 0.045),
                                                  (-20, 36, 70, 30, 0.08), (20, 24, -80, 26, 0.1)]):
            e = M(f"m_b3_fv{i}", fv, [x, y, zz2], 4, 0.0)
            e["props"].update({"flight": "orbit", "fradius": float(rad), "fspeed": float(sp)})
            add.append(e)
    # zero-credit: billboard signs on the new LED towers
    add.append({"id": "b3_sign_or", "type": "sign", "pos": [-70, 36, -62], "rot": [0, 0, 0],
                "scale": [16, 4, 1], "color": "#37c8ff", "props": {"text": "OURREALM"}})
    add.append({"id": "b3_sign_nx", "type": "sign", "pos": [70, 36, -62], "rot": [0, 0, 0],
                "scale": [16, 4, 1], "color": "#c26bff", "props": {"text": "NEXUS"}})

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
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": "stealth", "action": "batch3_integrate",
                                     "detail": {"added": [a["id"] for a in add], "published_version": snap + 1}, "at": iso()})
    print(f"[b3-int] published v{snap + 1}: +{len(add)} entities")

if __name__ == "__main__":
    asyncio.run(main())
