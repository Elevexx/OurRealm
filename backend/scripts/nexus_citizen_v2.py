"""CROWD CANARY V2 (replacement, founder authorized) (founder approved, max 20 credits; actual: remesh 5 + rig 5 + anim 3 = 13).
535k-face master preserved. Remesh -> ~30k faces -> rig once -> walk once. NO paid retries.
Zero-credit LODs afterwards. Writes /app/artifacts/nexus/citizen.json"""
import asyncio
import json
import subprocess
import sys
import urllib.request

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")


async def wait(mp, db, wf, tid, max_s=1800):
    for _ in range(max_s // 12):
        st = await mp.poll_task(db, wf, tid)
        if st.get("status") in mp.TERMINAL:
            return st
        await asyncio.sleep(12)
    return {"status": "TIMEOUT"}


def opt(src, dst, ratio, tex):
    if ratio:
        mid = dst + ".s.glb"
        subprocess.run(["npx", "--yes", "@gltf-transform/cli", "simplify", src, mid,
                        "--ratio", str(ratio), "--error", "0.005"], check=True, capture_output=True, timeout=300)
        src = mid
    subprocess.run(["npx", "--yes", "@gltf-transform/cli", "optimize", src, dst,
                    "--compress", "draco", "--texture-size", str(tex), "--simplify", "false"],
                   check=True, capture_output=True, timeout=300)


async def store(db, mp, media_dir, adapter, path, name, slot, task_id, wf):
    raw = open(path, "rb").read()
    meta = mp.validate_glb(raw)
    fname = meta["checksum"][:32] + ".glb"
    (media_dir("models") / fname).write_bytes(raw)
    try:
        adapter().put("models", fname, media_dir("models") / fname)
    except Exception:  # noqa: BLE001
        pass
    url = f"/api/media/models/{fname}"
    await db.asset_library.update_one({"id": meta["checksum"][:32]}, {"$set": {
        "id": meta["checksum"][:32], "kind": "model_glb", "name": name, "url": url, "meta": meta,
        "provider": "meshy", "meshy_task_id": task_id, "workflow": wf,
        "context": {"project": "nexus", "slot": slot}}}, upsert=True)
    return url, meta


async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
    h = await mp.health()
    print(f"[cz] balance start {h.get('balance')}", flush=True)
    ref = await db.meshy_tasks.find_one({"idem_key": "nx-b2-crowd_citizen-ref-v1"}, {"_id": 0, "meshy_task_id": 1})
    ref_id = ref["meshy_task_id"]
    out = {"refine_task": ref_id}

    prev = await mp.create_task(db, founder, "text_preview",
        {"mode": "preview", "prompt": "low poly stylized human game character standing in perfect A-pose, arms straight out at 45 degrees away from body, legs apart, futuristic dark casual techwear outfit with cyan trim, clean simple topology, clearly separated arms legs and head, symmetrical humanoid, mobile game NPC", "art_style": "realistic", "ai_model": "latest"},
        "nx-cz2-prev-v1", {"project": "nexus", "slot": "citizen_v2"})
    st = await wait(mp, db, "text_preview", prev["task_id"])
    if st.get("status") != "SUCCEEDED":
        raise RuntimeError(f"preview {st.get('status')}")
    refi = await mp.create_task(db, founder, "text_refine",
        {"mode": "refine", "preview_task_id": prev["task_id"], "enable_pbr": True},
        "nx-cz2-ref-v1", {"project": "nexus", "slot": "citizen_v2"})
    st = await wait(mp, db, "text_refine", refi["task_id"])
    if st.get("status") != "SUCCEEDED":
        raise RuntimeError(f"refine {st.get('status')}")
    rm = await mp.create_task(db, founder, "remesh",
        {"input_task_id": refi["task_id"], "target_formats": ["glb"], "topology": "triangle", "target_polycount": 40000},
        "nx-cz2-remesh-v1", {"project": "nexus", "slot": "citizen_v2"})
    st = await wait(mp, db, "remesh", rm["task_id"])
    if st.get("status") != "SUCCEEDED":
        raise RuntimeError(f"remesh {st.get('status')}")
    out["remesh_task"] = rm["task_id"]

    rig = await mp.create_task(db, founder, "rig", {"input_task_id": rm["task_id"], "character_height": 1.7},
                               "nx-cz2-rig-v1", {"project": "nexus", "slot": "b2_crowd_citizen"})
    st = await wait(mp, db, "rig", rig["task_id"])
    if st.get("status") != "SUCCEEDED":
        raise RuntimeError(f"rig {st.get('status')}: {st.get('task_error')} — STOPPING, no paid retry")
    out["rig_task"] = rig["task_id"]
    raw_task = await mp._call("GET", f"/openapi/v1/rigging/{rig['task_id']}")
    rig_url = (raw_task.get("result") or {}).get("rigged_character_glb_url")
    rig_master = "/app/artifacts/nexus/citizen30k_rig_master.glb"
    with urllib.request.urlopen(rig_url) as r, open(rig_master, "wb") as f:
        f.write(r.read())
    print(f"[cz] rig OK {rig['task_id']}", flush=True)

    anim = await mp.create_task(db, founder, "animation", {"rig_task_id": rig["task_id"], "action": "walking"},
                                "nx-cz2-walk-v1", {"project": "nexus", "slot": "b2_crowd_citizen"})
    st = await wait(mp, db, "animation", anim["task_id"])
    walk_master = None
    if st.get("status") == "SUCCEEDED":
        out["walk_task"] = anim["task_id"]
        raw_anim = await mp._call("GET", f"/openapi/v1/animations/{anim['task_id']}")
        wurl = (raw_anim.get("result") or {}).get("animation_glb_url")
        walk_master = "/app/artifacts/nexus/citizen30k_walk_master.glb"
        with urllib.request.urlopen(wurl) as r, open(walk_master, "wb") as f:
            f.write(r.read())
        print(f"[cz] walk OK {anim['task_id']}", flush=True)
    else:
        out["walk_error"] = f"{st.get('status')}: {st.get('task_error')}"

    # zero-credit runtime LODs (no simplify on LOD0 to keep weights pristine)
    for lod, ratio, tex, src in (("lod0", None, 1024, rig_master), ("lod1", 0.4, 512, rig_master), ("lod2", 0.13, 256, rig_master)):
        dst = f"/tmp/citizen_{lod}.glb"
        opt(src, dst, ratio, tex)
        url, meta = await store(db, mp, media_dir, get_storage_adapter, dst,
                                f"nexus crowd citizen ({lod})", f"citizen_{lod}", rig["task_id"], "rig")
        out[lod] = {"url": url, "kb": meta["bytes"] // 1024, "skins": meta.get("skins")}
        print(f"[cz] {lod}: {meta['bytes']//1024}KB skins={meta.get('skins')}", flush=True)
    if walk_master:
        dst = "/tmp/citizen_walk.glb"
        opt(walk_master, dst, None, 512)
        url, meta = await store(db, mp, media_dir, get_storage_adapter, dst,
                                "nexus crowd citizen (walk)", "citizen_walk", out.get("walk_task", ""), "animation")
        out["walk"] = {"url": url, "kb": meta["bytes"] // 1024, "anims": meta.get("animations")}
        print(f"[cz] walk runtime: {meta['bytes']//1024}KB anims={meta.get('animations')}", flush=True)

    h2 = await mp.health()
    out["balance"] = {"start": h.get("balance"), "end": h2.get("balance")}
    json.dump(out, open("/app/artifacts/nexus/citizen.json", "w"), indent=1)
    print(f"[cz] DONE balance {h2.get('balance')}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
