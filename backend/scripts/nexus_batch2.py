"""ARCHITECTURE BATCH TWO + CROWD CANARY (founder approved, one paid gen per asset, NO auto retries).
Env assets: preview->refine->master->optimized runtime. Citizen: +rig->walk animation.
Writes /app/artifacts/nexus/batch2.json with credits before/after."""
import asyncio
import json
import subprocess
import sys

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

ENV_ASSETS = [
    ("bg_skyline", "Dense futuristic night city skyline block, cluster of five varied dark skyscrapers with glowing blue cyan and purple window lights and neon edge trim, distant background architecture, game environment asset, stylized sci-fi", 0.4),
    ("sky_bridge", "Futuristic elevated pedestrian sky bridge with glass railings, cyan neon edge lighting, dark metal structure, modular walkway segment connecting buildings, game environment asset", 0.5),
    ("business_ship", "Futuristic flying airship blimp structure, sleek dark oval hull with glowing purple neon trim and large holographic display panel on the side, hovering sci-fi vehicle building, game asset", 0.5),
    ("gaming_ship", "Futuristic flying airship blimp structure, dark angular hull with glowing green and purple neon accents and large screen panel on the side, hovering sci-fi vehicle building, game asset", 0.5),
    ("flying_vehicle", "Small futuristic flying car shuttle, sleek dark body with cyan neon light strips and glowing thrusters, hovering sci-fi vehicle, game asset, low poly friendly", 0.5),
]
CITIZEN = ("crowd_citizen", "Stylized low-poly futuristic citizen character in dark casual techwear jacket and pants with subtle cyan accent trim, neutral T-pose, humanoid proportions, clean topology, game character asset, mobile optimized low detail")


async def wait(mp, db, wf, tid, max_s=2400):
    for _ in range(max_s // 15):
        st = await mp.poll_task(db, wf, tid)
        if st.get("status") in mp.TERMINAL:
            return st
        await asyncio.sleep(15)
    return {"status": "TIMEOUT"}


async def optimize_store(db, mp, media_dir, adapter, src_path, out_name, simplify, texsize, task_id, wf, slug):
    drv = f"/app/artifacts/nexus/{out_name}"
    cmd = ["npx", "--yes", "@gltf-transform/cli", "optimize", str(src_path), drv,
           "--compress", "draco", "--texture-size", str(texsize)]
    if simplify:
        mid = drv + ".simp.glb"
        subprocess.run(["npx", "--yes", "@gltf-transform/cli", "simplify", str(src_path), mid,
                        "--ratio", str(simplify), "--error", "0.001"], check=True, capture_output=True, timeout=420)
        cmd[4] = mid
        cmd += ["--simplify", "false"]
    else:
        cmd += ["--simplify", "false"]
    subprocess.run(cmd, check=True, capture_output=True, timeout=420)
    raw = open(drv, "rb").read()
    meta = mp.validate_glb(raw)
    fname = meta["checksum"][:32] + ".glb"
    (media_dir("models") / fname).write_bytes(raw)
    try:
        adapter().put("models", fname, media_dir("models") / fname)
    except Exception:  # noqa: BLE001
        pass
    url = f"/api/media/models/{fname}"
    await db.asset_library.update_one({"id": meta["checksum"][:32]}, {"$set": {
        "id": meta["checksum"][:32], "kind": "model_glb", "name": f"nexus b2 {slug} (runtime)",
        "url": url, "meta": meta, "provider": "meshy", "meshy_task_id": task_id,
        "workflow": wf, "context": {"project": "nexus", "slot": f"b2_{slug}"}}}, upsert=True)
    return url, meta


async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
    h = await mp.health()
    print(f"[b2] balance start {h.get('balance')}", flush=True)
    results = {"_balance": {"start": h.get("balance")}}

    prevs = {}
    for slug, prompt, _ in ENV_ASSETS:
        r = await mp.create_task(db, founder, "text_preview",
                                 {"mode": "preview", "prompt": prompt, "art_style": "realistic", "ai_model": "latest"},
                                 f"nx-b2-{slug}-prev-v1", {"project": "nexus", "slot": f"b2_{slug}"})
        prevs[slug] = r["task_id"]
        print(f"[b2] {slug} preview {r['task_id']}", flush=True)
    cz_slug, cz_prompt = CITIZEN
    r = await mp.create_task(db, founder, "text_preview",
                             {"mode": "preview", "prompt": cz_prompt, "art_style": "realistic", "ai_model": "latest"},
                             f"nx-b2-{cz_slug}-prev-v1", {"project": "nexus", "slot": f"b2_{cz_slug}"})
    prevs[cz_slug] = r["task_id"]
    print(f"[b2] {cz_slug} preview {r['task_id']}", flush=True)

    for slug, prompt, simp in ENV_ASSETS:
        try:
            st = await wait(mp, db, "text_preview", prevs[slug])
            if st.get("status") != "SUCCEEDED":
                results[slug] = {"error": f"preview {st.get('status')}"}
                print(f"[b2] {slug} preview failed — NO paid retry", flush=True)
                continue
            rr = await mp.create_task(db, founder, "text_refine",
                                      {"mode": "refine", "preview_task_id": prevs[slug], "enable_pbr": True},
                                      f"nx-b2-{slug}-ref-v1", {"project": "nexus", "slot": f"b2_{slug}"})
            st = await wait(mp, db, "text_refine", rr["task_id"])
            if st.get("status") != "SUCCEEDED":
                results[slug] = {"error": f"refine {st.get('status')}"}
                continue
            asset = await mp.store_glb(db, founder, "text_refine", rr["task_id"],
                                       f"nexus b2 {slug} (master)", {"project": "nexus", "slot": f"b2_{slug}"})
            mfile = media_dir("models") / asset["url"].split("/")[-1]
            url, meta = await optimize_store(db, mp, media_dir, get_storage_adapter, mfile,
                                             f"b2_{slug}_rt.glb", simp, 1024, rr["task_id"], "text_refine", slug)
            results[slug] = {"runtime_url": url, "master_url": asset["url"], "kb": meta["bytes"] // 1024, "task": rr["task_id"]}
            print(f"[b2] {slug} DONE {url} {meta['bytes']//1024}KB", flush=True)
        except Exception as e:  # noqa: BLE001
            results[slug] = {"error": str(e)[:200]}
            print(f"[b2] {slug} FAILED {e}", flush=True)

    # crowd canary: refine -> rig -> walk animation
    try:
        st = await wait(mp, db, "text_preview", prevs[cz_slug])
        if st.get("status") != "SUCCEEDED":
            raise RuntimeError(f"preview {st.get('status')}")
        rr = await mp.create_task(db, founder, "text_refine",
                                  {"mode": "refine", "preview_task_id": prevs[cz_slug], "enable_pbr": True},
                                  f"nx-b2-{cz_slug}-ref-v1", {"project": "nexus", "slot": f"b2_{cz_slug}"})
        st = await wait(mp, db, "text_refine", rr["task_id"])
        if st.get("status") != "SUCCEEDED":
            raise RuntimeError(f"refine {st.get('status')}")
        rig = await mp.create_task(db, founder, "rig", {"input_task_id": rr["task_id"], "character_height": 1.7},
                                   f"nx-b2-{cz_slug}-rig-v1", {"project": "nexus", "slot": f"b2_{cz_slug}"})
        st = await wait(mp, db, "rig", rig["task_id"])
        if st.get("status") != "SUCCEEDED":
            raise RuntimeError(f"rig {st.get('status')}: {st.get('task_error')}")
        raw_task = await mp._call("GET", f"/openapi/v1/rigging/{rig['task_id']}")
        rig_url = (raw_task.get("result") or {}).get("rigged_character_glb_url")
        import urllib.request
        rig_path = "/app/artifacts/nexus/b2_citizen_rig_master.glb"
        with urllib.request.urlopen(rig_url) as resp, open(rig_path, "wb") as f:
            f.write(resp.read())
        anim = await mp.create_task(db, founder, "animation",
                                    {"rig_task_id": rig["task_id"], "action": "walking"},
                                    f"nx-b2-{cz_slug}-walk-v1", {"project": "nexus", "slot": f"b2_{cz_slug}"})
        st2 = await wait(mp, db, "animation", anim["task_id"])
        walk_path = None
        if st2.get("status") == "SUCCEEDED":
            raw_anim = await mp._call("GET", f"/openapi/v1/animations/{anim['task_id']}")
            walk_url = (raw_anim.get("result") or {}).get("animation_glb_url")
            if walk_url:
                walk_path = "/app/artifacts/nexus/b2_citizen_walk_master.glb"
                with urllib.request.urlopen(walk_url) as resp, open(walk_path, "wb") as f:
                    f.write(resp.read())
        url_r, meta_r = await optimize_store(db, mp, media_dir, get_storage_adapter, rig_path,
                                             "b2_citizen_rig_rt.glb", None, 512, rig["task_id"], "rig", cz_slug)
        rec = {"rig_runtime": url_r, "rig_kb": meta_r["bytes"] // 1024, "skins": meta_r.get("skins"),
               "rig_task": rig["task_id"]}
        if walk_path:
            url_w, meta_w = await optimize_store(db, mp, media_dir, get_storage_adapter, walk_path,
                                                 "b2_citizen_walk_rt.glb", None, 512, anim["task_id"], "animation", cz_slug)
            rec.update({"walk_runtime": url_w, "walk_kb": meta_w["bytes"] // 1024, "anims": meta_w.get("animations")})
        results[cz_slug] = rec
        print(f"[b2] {cz_slug} DONE {rec}", flush=True)
    except Exception as e:  # noqa: BLE001
        results[cz_slug] = {"error": str(e)[:250]}
        print(f"[b2] {cz_slug} FAILED {e}", flush=True)

    h2 = await mp.health()
    results["_balance"]["end"] = h2.get("balance")
    json.dump(results, open("/app/artifacts/nexus/batch2.json", "w"), indent=1)
    print(f"[b2] balance end {h2.get('balance')}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
