"""Bounded repair: Maeve remesh (<=300k faces) -> rig -> walk animation.
Max 2 repair cycles per founder mandate. Wires rigged/animated GLB to player_model."""
import asyncio
import json
import subprocess
import sys

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

GID = "wkq-arcane-hearth-3d-v1"
MAEVE_TASK = "019fedb1-49c5-717b-a764-eefaab5c6a0f"


async def wait(db, mp, wf, tid, label, max_s=1800):
    for _ in range(max_s // 15):
        st = await mp.poll_task(db, wf, tid)
        if st.get("status") in mp.TERMINAL:
            print(f"[{label}] {st.get('status')} credits={st.get('consumed_credits')} err={st.get('task_error')}")
            return st
        await asyncio.sleep(15)
    return {"status": "TIMEOUT"}


async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
    try:
        r = await mp.create_task(db, founder, "remesh",
                                 {"input_task_id": MAEVE_TASK, "target_formats": ["glb"],
                                  "topology": "triangle", "target_polycount": 250000},
                                 "wkq-arcane-maeve-remesh-v1",
                                 {"game_id": GID, "slot": "player_model", "name": "maeve remesh"})
    except mp.MeshyError:
        mp.PATHS["remesh"] = "/openapi/v2/remesh"
        r = await mp.create_task(db, founder, "remesh",
                                 {"input_task_id": MAEVE_TASK, "target_formats": ["glb"],
                                  "topology": "triangle", "target_polycount": 250000},
                                 "wkq-arcane-maeve-remesh-v1b",
                                 {"game_id": GID, "slot": "player_model", "name": "maeve remesh"})
    print(f"[submit] remesh -> {r['task_id']} replayed={r['replayed']}")
    st = await wait(db, mp, "remesh", r["task_id"], "remesh")
    if st.get("status") != "SUCCEEDED":
        print("remesh failed — keeping static Maeve")
        return
    rig = await mp.create_task(db, founder, "rig",
                               {"input_task_id": r["task_id"], "character_height": 1.7},
                               "wkq-arcane-maeve-rig-v2",
                               {"game_id": GID, "slot": "player_model", "name": "maeve rig"})
    print(f"[submit] rig -> {rig['task_id']} replayed={rig['replayed']}")
    st = await wait(db, mp, "rig", rig["task_id"], "rig")
    if st.get("status") != "SUCCEEDED":
        print("rig failed — keeping static Maeve")
        return
    final_wf, final_id = "rig", rig["task_id"]
    try:
        anim = await mp.create_task(db, founder, "animation",
                                    {"rig_task_id": rig["task_id"], "action": "walking"},
                                    "wkq-arcane-maeve-walk-v1",
                                    {"game_id": GID, "slot": "player_model", "name": "maeve walk"})
        print(f"[submit] animation -> {anim['task_id']}")
        st2 = await wait(db, mp, "animation", anim["task_id"], "animation")
        if st2.get("status") == "SUCCEEDED":
            final_wf, final_id = "animation", anim["task_id"]
    except Exception as e:  # noqa: BLE001
        print(f"[animation] submit failed: {e} — rigged model may already include clips")
    asset = await mp.store_glb(db, founder, final_wf, final_id, "Maeve O'Rourke (rigged)",
                               {"game_id": GID, "slot": "player_model"})
    print(f"[stored] master {asset['url']} bytes={asset['meta']['bytes']} anims={asset['meta']['animations']}")
    mfile = media_dir("models") / asset["url"].split("/")[-1]
    drv = "/app/artifacts/wkq/models/maeve_rigged_draco.glb"
    subprocess.run(["npx", "--yes", "@gltf-transform/cli", "optimize", str(mfile), drv,
                    "--compress", "draco", "--texture-size", "2048"],
                   check=True, capture_output=True, timeout=280)
    raw = open(drv, "rb").read()
    meta = mp.validate_glb(raw)
    fname = meta["checksum"][:32] + ".glb"
    loc = media_dir("models") / fname
    loc.write_bytes(raw)
    try:
        get_storage_adapter().put("models", fname, loc)
    except Exception:  # noqa: BLE001
        pass
    await db.games.update_one({"id": GID}, {"$set": {"spec.assets.player_model": {
        "url": f"/api/media/models/{fname}",
        "meta": {"source": f"meshy:{final_id}", "master_url": asset["url"],
                 "master_bytes": asset["meta"]["bytes"], "runtime_bytes": meta["bytes"],
                 "animations": meta["animations"], "compression": "draco+2K"}}}})
    print(f"[wired] player_model rigged: {meta['bytes']//1048576}MB anims={meta['animations']}")
    print("MAEVE REPAIR DONE")

asyncio.run(main())
