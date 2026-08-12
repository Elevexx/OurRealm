"""Build Nexus Central — Spawn Zone (reference-driven layout) into draft, set as default
entry, then publish with snapshot. Reuses validated entity types + plaza kit GLB."""
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


def E(i, t, pos, scale, color, label=None, rot=0, **props):
    p = {**props}
    if label:
        p["label"] = label
    return {"id": i, "type": t, "pos": pos, "rot": [0, rot, 0], "scale": scale, "color": color, "props": p}


def build_zone(plaza_kit_url):
    ents = []
    # 1. Arrival platform (clear spawn, view down boulevard toward -z)
    ents.append(E("nc_platform", "box", [0, 0, 84], [40, 0.4, 22], "#16213e", "Arrival Platform"))
    # 2. Central boulevard nav lines + lanes
    for i in range(9):
        z = 70 - i * 17
        ents.append(E(f"nc_nav{i}", "box", [0, 0, z], [1.2, 0.12, 10], "#37c8ff", spin=0))
        ents.append(E(f"nc_navl{i}", "light", [-7, 0, z], [1, 1, 1], "#37c8ff", intensity=14))
        ents.append(E(f"nc_navr{i}", "light", [7, 0, z], [1, 1, 1], "#2ee87a", intensity=14))
    for s in (-14, 14):  # pedestrian lane edges
        for i in range(5):
            ents.append(E(f"nc_lane{s}_{i}", "box", [s, 0, 60 - i * 30], [0.6, 0.1, 16], "#8a5cff"))
    # 3. Nexus Crown — overhead ring (floating segments + supports)
    import math
    for k in range(12):
        a = k * math.pi / 6
        x, z = 34 * math.cos(a), 34 * math.sin(a) - 10
        ents.append(E(f"nc_crown{k}", "box", [round(x, 1), 26, round(z, 1)], [16, 2.2, 4], "#1d2f5e", rot=round(-a, 2)))
        ents.append(E(f"nc_crownl{k}", "light", [round(x, 1), 0, round(z, 1)], [1, 1, 1], "#37c8ff", intensity=20))
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        x, z = 34 * math.cos(a), 34 * math.sin(a) - 10
        ents.append(E(f"nc_sup{k}", "pillar", [round(x, 1), 0, round(z, 1)], [2.4, 26, 2.4], "#26355f", "Crown Support"))
    # 4. ORAi landmark on central axis
    ents.append(E("nc_orai_base", "pillar", [0, 0, -46], [8, 3, 8], "#1d2f5e", "ORAi Core Plaza"))
    ents.append(E("nc_orai", "pillar", [0, 3, -46], [3.2, 22, 3.2], "#37c8ff", "ORAi Monument"))
    ents.append(E("nc_orai_l1", "light", [-5, 0, -42], [1, 1, 1], "#37c8ff", intensity=26))
    ents.append(E("nc_orai_l2", "light", [5, 0, -42], [1, 1, 1], "#c26bff", intensity=26))
    ents.append(E("nc_orai_npc", "npc", [4, 0, -38], [1, 1, 1], "#37c8ff", "ORAi Guide",
                  dialog="Welcome to Nexus Central. Portals to every OurRealm district line this boulevard."))
    # 5. Portal districts (working + reserved), color-coded, off the boulevard
    ents.append(E("nc_p_plaza", "portal", [-24, 0, -70], [1, 1, 1], "#2ee87a", "Community Plaza",
                  action="zone", target_zone="plaza", spin=0.9))
    ents.append(E("nc_p_gardens", "portal", [24, 0, -70], [1, 1, 1], "#37c8ff", "Emerald Gardens",
                  action="zone", target_zone="emerald_gardens", spin=0.9))
    ents.append(E("nc_p_games", "portal", [-52, 0, -20], [1, 1, 1], "#c26bff", "Gaming Realm (Expansion)", action="expansion", spin=0.5))
    ents.append(E("nc_p_maker", "portal", [52, 0, -20], [1, 1, 1], "#ff9a5c", "GameMaker Realm (Expansion)", action="expansion", spin=0.5))
    ents.append(E("nc_p_events", "portal", [-52, 0, 30], [1, 1, 1], "#ffd95c", "Events District (Expansion)", action="expansion", spin=0.5))
    ents.append(E("nc_p_biz", "portal", [52, 0, 30], [1, 1, 1], "#5cffe2", "Business Realm (Expansion)", action="expansion", spin=0.5))
    # 6. Social terraces + gardens (both flanks) with plaza-kit pavilions
    for s, tag in ((-1, "w"), (1, "e")):
        ents.append(E(f"nc_ter_{tag}", "box", [s * 34, 0, 46], [22, 1.6, 18], "#22304f", "Social Terrace"))
        ents.append(E(f"nc_ramp_{tag}", "ramp", [s * 21, 0, 46], [5, 1.6, 6], "#2c3a5e", rot=s * 1.57))
        ents.append(E(f"nc_pav_{tag}", "model", [s * 34, 1.6, 46], [9, 5.5, 9], "#2ee87a", "Terrace Pavilion", url=plaza_kit_url))
        for b in range(3):
            ents.append(E(f"nc_bench_{tag}{b}", "box", [s * (26 + b * 6), 1.6, 38], [2.4, 0.6, 0.9], "#6b5a3f"))
        ents.append(E(f"nc_gard_{tag}", "box", [s * 34, 1.6, 56], [16, 0.5, 3], "#2c6b3f", "Terrace Garden"))
        ents.append(E(f"nc_terl_{tag}", "light", [s * 30, 1.6, 46], [1, 1, 1], "#ffd9a0", intensity=18))
    # large layered buildings on both sides
    dims = [(18, 34, 14, "#1a2747"), (14, 52, 12, "#20305c"), (22, 26, 16, "#182238"), (12, 58, 12, "#243768")]
    for s, tag in ((-1, "w"), (1, "e")):
        for j, (w, h, d, col) in enumerate(dims):
            z = 60 - j * 42
            ents.append(E(f"nc_bld_{tag}{j}", "box", [s * (58 + (j % 2) * 12), 0, z], [w, h, d], col, rot=s * 0.08))
            ents.append(E(f"nc_bldl_{tag}{j}", "light", [s * 48, 0, z], [1, 1, 1], ["#37c8ff", "#c26bff", "#2ee87a", "#ff9a5c"][j], intensity=16))
    # 7. distant skyline (far edges, simple LOD boxes)
    for k in range(8):
        x = -84 + k * 24
        ents.append(E(f"nc_sky{k}", "box", [x, 0, -92], [10, 28 + (k % 4) * 10, 6], "#10182e"))
    return {"id": "nexus_central", "name": "Nexus Central — Spawn Zone", "sky": "#070d20",
            "ground_color": "#0d1530", "size": [200, 200], "spawn": {"x": 0, "z": 84},
            "ambient": 0.5, "sun": 0.9, "entities": ents}


async def main():
    from core.db import db
    from services import nexus_world as nw
    rep = json.load(open("/app/artifacts/nexus/canary_report.json"))
    plaza_kit = rep["assets"]["plaza_kit"]["runtime_url"]
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"})
    draft = doc["draft"]
    zone = build_zone(plaza_kit)
    zone["entities"] = [nw._clean_entity(e) for e in zone["entities"]]
    draft["zones"] = [z for z in draft["zones"] if z["id"] != "nexus_central"]
    draft["zones"].insert(0, zone)
    draft["meta"]["default_zone"] = "nexus_central"
    # add return portals from plaza + gardens to central
    for z in draft["zones"]:
        if z["id"] == "plaza" and not any(e["id"] == "e_portal_central" for e in z["entities"]):
            z["entities"].append(nw._clean_entity(E("e_portal_central", "portal", [0, 0, 22], [1, 1, 1], "#8a5cff",
                                                    "Nexus Central", action="zone", target_zone="nexus_central", spin=0.9)))
        if z["id"] == "emerald_gardens" and not any(e["id"] == "eg_portal_central" for e in z["entities"]):
            z["entities"].append(nw._clean_entity(E("eg_portal_central", "portal", [-14, 0, 24], [1, 1, 1], "#8a5cff",
                                                    "Nexus Central", action="zone", target_zone="nexus_central", spin=0.9)))
    snap_ver = doc["published_version"]
    await db.nexus_versions.update_one({"world_id": "nexus-v1", "version": snap_ver},
        {"$set": {"world_id": "nexus-v1", "version": snap_ver, "world": doc["published"],
                  "label": f"pre-publish snapshot v{snap_ver}", "created_at": iso()}}, upsert=True)
    await db.nexus_worlds.update_one({"world_id": "nexus-v1"}, {"$set": {
        "draft": draft, "draft_version": doc["draft_version"] + 1,
        "published": draft, "published_version": snap_ver + 1, "updated_at": iso()}})
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": "stealth",
                                     "action": "nexus_central_build",
                                     "detail": {"entities": len(zone["entities"]), "published_version": snap_ver + 1},
                                     "at": iso()})
    print(f"[central] {len(zone['entities'])} entities, published v{snap_ver + 1}, default zone nexus_central")


if __name__ == "__main__":
    asyncio.run(main())
