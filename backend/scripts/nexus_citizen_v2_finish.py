"""Finish citizen v2: walk animation (action_id=1) on successful rig + runtime LODs."""
import asyncio
import json
import sys
import urllib.request

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")
from scripts.nexus_citizen_canary import wait, opt, store  # noqa: E402


async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
    rig = await db.meshy_tasks.find_one({"idem_key": "nx-cz2-rig-v1"}, {"_id": 0, "meshy_task_id": 1})
    rig_id = rig["meshy_task_id"]
    out = {"rig_task": rig_id}
    raw_task = await mp._call("GET", f"/openapi/v1/rigging/{rig_id}")
    rig_url = (raw_task.get("result") or {}).get("rigged_character_glb_url")
    rig_master = "/app/artifacts/nexus/citizen_v2_rig_master.glb"
    with urllib.request.urlopen(rig_url) as r, open(rig_master, "wb") as f:
        f.write(r.read())
    print("[cz2] rig master saved", flush=True)

    anim = await mp.create_task(db, founder, "animation", {"rig_task_id": rig_id, "action_id": 1},
                                "nx-cz2-walk-v2", {"project": "nexus", "slot": "citizen_v2"})
    st = await wait(mp, db, "animation", anim["task_id"])
    walk_master = None
    if st.get("status") == "SUCCEEDED":
        out["walk_task"] = anim["task_id"]
        raw_anim = await mp._call("GET", f"/openapi/v1/animations/{anim['task_id']}")
        wurl = (raw_anim.get("result") or {}).get("animation_glb_url")
        walk_master = "/app/artifacts/nexus/citizen_v2_walk_master.glb"
        with urllib.request.urlopen(wurl) as r, open(walk_master, "wb") as f:
            f.write(r.read())
        print(f"[cz2] walk OK {anim['task_id']}", flush=True)
    else:
        out["walk_error"] = f"{st.get('status')}: {st.get('task_error')}"

    for lod, ratio, tex in (("lod0", None, 1024), ("lod1", 0.4, 512), ("lod2", 0.13, 256)):
        dst = f"/tmp/cz2_{lod}.glb"
        opt(rig_master, dst, ratio, tex)
        url, meta = await store(db, mp, media_dir, get_storage_adapter, dst,
                                f"nexus citizen v2 ({lod})", f"citizen2_{lod}", rig_id, "rig")
        out[lod] = {"url": url, "kb": meta["bytes"] // 1024, "skins": meta.get("skins")}
        print(f"[cz2] {lod}: {meta['bytes']//1024}KB skins={meta.get('skins')}", flush=True)
    if walk_master:
        dst = "/tmp/cz2_walk.glb"
        opt(walk_master, dst, None, 512)
        url, meta = await store(db, mp, media_dir, get_storage_adapter, dst,
                                "nexus citizen v2 (walk)", "citizen2_walk", out.get("walk_task", ""), "animation")
        out["walk"] = {"url": url, "kb": meta["bytes"] // 1024, "anims": meta.get("animations")}
        print(f"[cz2] walk runtime {meta['bytes']//1024}KB anims={meta.get('animations')}", flush=True)
    h = await mp.health()
    out["balance_end"] = h.get("balance")
    json.dump(out, open("/app/artifacts/nexus/citizen_v2.json", "w"), indent=1)
    print(f"[cz2] DONE balance {h.get('balance')}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
