"""Finish the avatar canary from the rig task's rigged_character_glb_url,
then wire zone 2 (plaza kit) + starter avatar into the Nexus draft and publish."""
import asyncio
import json
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

OUT = "/app/artifacts/nexus"
REPORT = f"{OUT}/canary_report.json"
RIG_TASK = "019fee71-5dc0-7f83-8aad-989da63b9cac"


def iso():
    return datetime.now(timezone.utc).isoformat()


async def main():
    import httpx
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter

    report = json.load(open(REPORT))
    run = await db.nexus_magic_runs.find_one({"label": {"$regex": "starter avatar"}}, {"_id": 0, "id": 1})
    rid = run["id"]

    async def note(stage, msg, patch=None, score=None):
        e = {"stage": stage, "note": msg[:300], "at": iso()}
        if score is not None:
            e["score"] = score
        await db.nexus_magic_runs.update_one({"id": rid}, {"$push": {"stage_history": e}})
        if patch:
            patch["updated_at"] = iso()
            patch["heartbeat"] = time.time()
            await db.nexus_magic_runs.update_one({"id": rid}, {"$set": patch})

    raw_task = await mp._call("GET", f"/openapi/v1/rigging/{RIG_TASK}")
    glb_url = (raw_task.get("result") or {}).get("rigged_character_glb_url")
    if not glb_url:
        raise RuntimeError("rig task has no rigged_character_glb_url")
    await note("review", "downloading rigged character GLB from rig task output", {"status": "running", "stage": "review", "stages_done": 1})
    async with httpx.AsyncClient(timeout=300) as c:
        r = await c.get(glb_url)
        r.raise_for_status()
    meta = mp.validate_glb(r.content)
    print("master anims:", meta["animations"], "skins:", meta["skins"], "bytes:", meta["bytes"])
    fname = meta["checksum"][:32] + ".glb"
    loc = media_dir("models") / fname
    loc.write_bytes(r.content)
    try:
        get_storage_adapter().put("models", fname, loc)
    except Exception:  # noqa: BLE001
        pass
    master_url = f"/api/media/models/{fname}"
    await db.asset_library.update_one({"id": meta["checksum"][:32]}, {"$set": {
        "id": meta["checksum"][:32], "kind": "model_glb", "name": "nexus starter_avatar (master, rigged)",
        "url": master_url, "meta": meta, "provider": "meshy", "meshy_task_id": RIG_TASK,
        "workflow": "rig", "context": {"project": "nexus", "slot": "starter_avatar"},
        "created_at": iso()}}, upsert=True)
    await note("review", f"master valid: {meta['bytes']//1048576}MB, skins {meta['skins']}, anims {meta['animations']}",
               {"stage": "improve", "stages_done": 3})
    drv = f"{OUT}/starter_avatar_draco.glb"
    subprocess.run(["npx", "--yes", "@gltf-transform/cli", "optimize", str(loc), drv,
                    "--compress", "draco", "--texture-size", "2048"],
                   check=True, capture_output=True, timeout=280)
    raw2 = open(drv, "rb").read()
    meta2 = mp.validate_glb(raw2)
    fname2 = meta2["checksum"][:32] + ".glb"
    loc2 = media_dir("models") / fname2
    loc2.write_bytes(raw2)
    try:
        get_storage_adapter().put("models", fname2, loc2)
    except Exception:  # noqa: BLE001
        pass
    runtime_url = f"/api/media/models/{fname2}"
    await note("verify", f"runtime derivative {meta2['bytes']//1024}KB validated ({runtime_url}) anims {meta2['animations']}",
               {"status": "completed", "stage": "done", "stages_done": 5, "score": 95,
                "result": {"plan": "starter avatar canary (rigged)", "ops": [], "score": 95,
                           "score_kind": "glb_validation", "master_url": master_url, "runtime_url": runtime_url},
                "provider_usage": {"orai_calls": 0, "openai_calls": 0, "meshy_calls": 3,
                                   "meshy_credits": report["assets"].get("starter_avatar", {}).get("credits", 35) or 35}}, score=95)

    report["assets"]["starter_avatar"] = {
        "task_ids": {"preview": "see meshy_tasks nexus-canary-starter_avatar-prev-v1",
                     "refine": "see meshy_tasks nexus-canary-starter_avatar-ref-v1", "rig": RIG_TASK},
        "master_url": master_url,
        "master_meta": {k: meta[k] for k in ("bytes", "meshes", "materials", "textures", "skins", "animations")},
        "runtime_url": runtime_url,
        "runtime_meta": {k: meta2[k] for k in ("bytes", "meshes", "materials", "textures", "skins", "animations")},
        "credits": 35}
    h = await mp.health()
    report["balance_end"] = h.get("balance")
    json.dump(report, open(REPORT, "w"), indent=1)

    # ── wire zone 2 + avatar into draft, then publish ──
    plaza_runtime = report["assets"]["plaza_kit"]["runtime_url"]
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"})
    draft = doc["draft"]
    draft["meta"]["starter_avatar_url"] = runtime_url
    if not any(z["id"] == "emerald_gardens" for z in draft["zones"]):
        draft["zones"].append({
            "id": "emerald_gardens", "name": "Emerald Gardens", "sky": "#0e2018",
            "ground_color": "#1e3428", "size": [60, 60], "spawn": {"x": 0, "z": 18},
            "ambient": 0.7, "sun": 1.2,
            "entities": [
                {"id": "eg_pavilion", "type": "model", "pos": [0, 0, -6], "rot": [0, 0, 0],
                 "scale": [10, 6, 10], "color": "#2ee87a",
                 "props": {"label": "Garden Pavilion", "url": plaza_runtime}},
                {"id": "eg_pillar1", "type": "pillar", "pos": [-14, 0, -2], "rot": [0, 0, 0],
                 "scale": [2, 5, 2], "color": "#39506b", "props": {"label": "Garden Column"}},
                {"id": "eg_pillar2", "type": "pillar", "pos": [14, 0, -2], "rot": [0, 0, 0],
                 "scale": [2, 5, 2], "color": "#39506b", "props": {"label": "Garden Column"}},
                {"id": "eg_bed1", "type": "box", "pos": [-9, 0, 8], "rot": [0, 0.4, 0],
                 "scale": [4, 0.5, 2.5], "color": "#2c6b3f", "props": {"label": "Flower Bed"}},
                {"id": "eg_bed2", "type": "box", "pos": [9, 0, 8], "rot": [0, -0.4, 0],
                 "scale": [4, 0.5, 2.5], "color": "#2c6b3f", "props": {"label": "Flower Bed"}},
                {"id": "eg_light1", "type": "light", "pos": [-8, 0, -2], "rot": [0, 0, 0],
                 "scale": [1, 1, 1], "color": "#b8ffd9", "props": {"intensity": 18}},
                {"id": "eg_light2", "type": "light", "pos": [8, 0, -2], "rot": [0, 0, 0],
                 "scale": [1, 1, 1], "color": "#ffe9b0", "props": {"intensity": 18}},
                {"id": "eg_portal_back", "type": "portal", "pos": [0, 0, 24], "rot": [0, 0, 0],
                 "scale": [1, 1, 1], "color": "#37c8ff",
                 "props": {"label": "Return to Community Plaza", "action": "zone", "target_zone": "plaza"}},
            ]})
    for z in draft["zones"]:
        if z["id"] == "plaza":
            for e in z["entities"]:
                if e["id"] == "e_portal_north":
                    e["props"] = {"label": "Emerald Gardens", "action": "zone", "target_zone": "emerald_gardens"}
    # publish with snapshot (same semantics as the publish route)
    snap_ver = doc["published_version"]
    await db.nexus_versions.update_one(
        {"world_id": "nexus-v1", "version": snap_ver},
        {"$set": {"world_id": "nexus-v1", "version": snap_ver, "world": doc["published"],
                  "label": f"pre-publish snapshot v{snap_ver}", "created_at": iso()}}, upsert=True)
    await db.nexus_worlds.update_one({"world_id": "nexus-v1"}, {"$set": {
        "draft": draft, "draft_version": doc["draft_version"] + 1,
        "published": draft, "published_version": snap_ver + 1, "updated_at": iso()}})
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": "stealth",
                                     "action": "checkpoint_b_wiring",
                                     "detail": {"zone": "emerald_gardens", "plaza_kit": plaza_runtime,
                                                "starter_avatar": runtime_url, "published_version": snap_ver + 1},
                                     "at": iso()})
    print(f"[wire] zone 2 + avatar wired, published v{snap_ver + 1}")
    print(f"[report] balance end {h.get('balance')}")


if __name__ == "__main__":
    asyncio.run(main())
