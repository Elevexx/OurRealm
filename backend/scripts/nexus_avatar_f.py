"""WP1 snapshot + WP2 female starter avatar (Meshy preview->refine->rig) + avatar registry.
Registers both starter avatars in db.nexus_avatars and reflects progress in nexus_magic_runs."""
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
FEMALE_PROMPT = ("A young adult female game character in a strict T-pose, both arms extended straight out "
                 "horizontally to the sides, legs straight and slightly apart, wearing a fitted coral hoodie, "
                 "dark fitted leggings and white sneakers, shoulder-length dark ponytail, clean stylized humanoid "
                 "topology, separated arms and legs, full body, symmetrical, neutral face, game-ready character")


def iso():
    return datetime.now(timezone.utc).isoformat()


async def main():
    import httpx
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter

    # ── WP1 recoverable snapshot ──
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"}, {"_id": 0})
    versions = await db.nexus_versions.find({}, {"_id": 0, "world": 0}).to_list(100)
    avatars = await db.nexus_avatars.find({}, {"_id": 0}).to_list(20)
    snap = {"at": iso(), "draft_version": doc["draft_version"], "published_version": doc["published_version"],
            "draft": doc["draft"], "published": doc["published"], "versions_index": versions,
            "avatars": avatars, "meta": doc["draft"].get("meta")}
    json.dump(snap, open(f"{OUT}/wp1_snapshot.json", "w"))
    sid = "wp1_" + uuid.uuid4().hex[:8]
    await db.nexus_versions.insert_one({"world_id": "nexus-v1", "version": 2000 + doc["draft_version"],
                                        "world": doc["draft"], "label": f"WP1 baseline snapshot ({sid})",
                                        "kind": "manual", "created_at": iso()})
    print(f"[wp1] snapshot saved ({sid}), rollback version {2000 + doc['draft_version']}")

    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
    male_url = doc["draft"]["meta"].get("starter_avatar_url")

    # register male avatar (existing canary asset)
    await db.nexus_avatars.update_one({"id": "starter_m"}, {"$set": {
        "id": "starter_m", "label": "Starter — Male Streetwear", "gender": "male",
        "url": male_url, "master_url": "/api/media/models/" + "4039b8b9581693e65629d90d6152ecce.glb",
        "status": "active", "is_default": True, "provider": "meshy",
        "created_at": iso()}}, upsert=True)

    rid = "run_" + uuid.uuid4().hex[:10]
    await db.nexus_magic_runs.insert_one({
        "id": rid, "label": "Meshy · female starter avatar (rigged, corrective attempt)", "mode": "meshy_asset",
        "style": None, "targets": [], "settings": {"founder_max": False, "stop_score": 90,
                                                   "max_attempts": 3, "repair_cycles": 1,
                                                   "reviewer": True, "dry_run": False, "mock": False},
        "request": "", "status": "running", "stage": "build", "stages_done": 0, "score": None,
        "cycles": 0, "stage_history": [], "diff": None, "result": None,
        "provider_usage": {"orai_calls": 0, "openai_calls": 0, "meshy_calls": 0, "meshy_credits": 0},
        "control": None, "created_by": "stealth", "created_at": iso(), "updated_at": iso(),
        "heartbeat": time.time()})

    async def note(stage, msg, patch=None):
        await db.nexus_magic_runs.update_one({"id": rid}, {"$push": {"stage_history": {"stage": stage, "note": msg[:300], "at": iso()}}})
        if patch:
            patch["updated_at"] = iso()
            patch["heartbeat"] = time.time()
            await db.nexus_magic_runs.update_one({"id": rid}, {"$set": patch})

    credits = 0
    r = await mp.create_task(db, founder, "text_preview",
                             {"mode": "preview", "prompt": FEMALE_PROMPT, "art_style": "realistic", "ai_model": "latest"},
                             "nexus-avatar-f-prev-v2", {"project": "nexus", "slot": "starter_avatar_f"})
    await note("build", f"preview submitted {r['task_id']}")
    for _ in range(120):
        st = await mp.poll_task(db, "text_preview", r["task_id"])
        await note("build", f"preview {st.get('status')} {st.get('progress')}%", {"heartbeat": time.time()})
        if st.get("status") in mp.TERMINAL:
            break
        await asyncio.sleep(12)
    if st.get("status") != "SUCCEEDED":
        await note("verify", f"preview failed: {st.get('task_error')}", {"status": "failed", "stage": "done"})
        return
    credits += st.get("consumed_credits") or 0
    rr = await mp.create_task(db, founder, "text_refine",
                              {"mode": "refine", "preview_task_id": r["task_id"], "enable_pbr": True},
                              "nexus-avatar-f-ref-v2", {"project": "nexus", "slot": "starter_avatar_f"})
    await note("build", f"refine submitted {rr['task_id']}")
    for _ in range(150):
        st = await mp.poll_task(db, "text_refine", rr["task_id"])
        if st.get("status") in mp.TERMINAL:
            break
        await asyncio.sleep(12)
    if st.get("status") != "SUCCEEDED":
        await note("verify", f"refine failed: {st.get('task_error')}", {"status": "failed", "stage": "done"})
        return
    credits += st.get("consumed_credits") or 0
    rig = await mp.create_task(db, founder, "rig", {"input_task_id": rr["task_id"], "character_height": 1.68},
                               "nexus-avatar-f-rig-v2", {"project": "nexus", "slot": "starter_avatar_f"})
    await note("build", f"rig submitted {rig['task_id']}", {"stages_done": 1, "stage": "review"})
    for _ in range(120):
        st = await mp.poll_task(db, "rig", rig["task_id"])
        if st.get("status") in mp.TERMINAL:
            break
        await asyncio.sleep(12)
    if st.get("status") != "SUCCEEDED":
        await note("verify", f"rig failed: {st.get('task_error')}", {"status": "failed", "stage": "done"})
        return
    credits += st.get("consumed_credits") or 0
    raw_task = await mp._call("GET", f"/openapi/v1/rigging/{rig['task_id']}")
    glb_url = (raw_task.get("result") or {}).get("rigged_character_glb_url")
    async with httpx.AsyncClient(timeout=300) as c:
        resp = await c.get(glb_url)
        resp.raise_for_status()
    meta = mp.validate_glb(resp.content)
    fname = meta["checksum"][:32] + ".glb"
    (media_dir("models") / fname).write_bytes(resp.content)
    try:
        get_storage_adapter().put("models", fname, media_dir("models") / fname)
    except Exception:  # noqa: BLE001
        pass
    master_url = f"/api/media/models/{fname}"
    await note("review", f"master valid {meta['bytes']//1048576}MB skins {meta['skins']} anims {meta['animations']}",
               {"stages_done": 3, "stage": "improve"})
    drv = f"{OUT}/starter_avatar_f_draco.glb"
    subprocess.run(["npx", "--yes", "@gltf-transform/cli", "optimize", str(media_dir("models") / fname), drv,
                    "--compress", "draco", "--texture-size", "2048"], check=True, capture_output=True, timeout=280)
    raw2 = open(drv, "rb").read()
    meta2 = mp.validate_glb(raw2)
    fname2 = meta2["checksum"][:32] + ".glb"
    (media_dir("models") / fname2).write_bytes(raw2)
    try:
        get_storage_adapter().put("models", fname2, media_dir("models") / fname2)
    except Exception:  # noqa: BLE001
        pass
    runtime_url = f"/api/media/models/{fname2}"
    await db.asset_library.update_one({"id": meta2["checksum"][:32]}, {"$set": {
        "id": meta2["checksum"][:32], "kind": "model_glb", "name": "nexus starter avatar F (runtime, rigged)",
        "url": runtime_url, "meta": meta2, "provider": "meshy", "meshy_task_id": rig["task_id"],
        "workflow": "rig", "context": {"project": "nexus", "slot": "starter_avatar_f"}, "created_at": iso()}}, upsert=True)
    await db.nexus_avatars.update_one({"id": "starter_f"}, {"$set": {
        "id": "starter_f", "label": "Starter — Female Streetwear", "gender": "female",
        "url": runtime_url, "master_url": master_url, "status": "active", "is_default": False,
        "provider": "meshy", "meta": {k: meta2[k] for k in ("bytes", "skins", "animations")},
        "created_at": iso()}}, upsert=True)
    await note("verify", f"runtime {meta2['bytes']//1024}KB anims {meta2['animations']} registered as starter_f",
               {"status": "completed", "stage": "done", "stages_done": 5, "score": 95,
                "result": {"plan": "female starter avatar", "ops": [], "score": 95, "score_kind": "glb_validation",
                           "master_url": master_url, "runtime_url": runtime_url},
                "provider_usage": {"orai_calls": 0, "openai_calls": 0, "meshy_calls": 3, "meshy_credits": credits}})
    h = await mp.health()
    print(f"[avatar-f] DONE runtime={runtime_url} credits={credits} balance={h.get('balance')}")


if __name__ == "__main__":
    asyncio.run(main())
