"""Spawn Zone city asset batch: 6 modular families via Meshy (preview->refine->store->optimize).
Registers runtime GLBs in asset_library. Resume-safe via idempotency keys (v1)."""
import asyncio
import json
import subprocess
import sys

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

ASSETS = [
    ("canopy_ring", "Massive futuristic circular canopy ring structure, illuminated cyan neon rim lights, dark metal panels with glowing blue trim, architectural megastructure ring segment, game environment asset, clean stylized sci-fi"),
    ("tower_blue", "Large cylindrical futuristic display tower, glowing blue holographic panel facade with digital patterns, dark metal frame, night city skyscraper, game environment asset"),
    ("tower_green", "Large cylindrical futuristic display tower, glowing green holographic panel facade with digital patterns, dark metal frame, night city skyscraper, game environment asset"),
    ("orai_tower", "Futuristic AI core tower, tall elegant spire with glowing cyan lattice frame and holographic display panel at center, dark metal, sci-fi landmark monument, game asset"),
    ("storefront", "Futuristic two-story storefront terrace block with balconies, railings, stairs, neon purple and cyan signs, planters with trees, dense architectural detail, modular city building, game environment asset"),
    ("portal_arch", "Premium futuristic portal archway, glowing neon ring gate with ornate metal frame and base platform, cyan and purple lights, sci-fi game asset"),
]


async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
    h = await mp.health()
    print(f"[batch] balance start {h.get('balance')}", flush=True)
    results = {}
    # submit all previews first
    prevs = {}
    for slug, prompt in ASSETS:
        r = await mp.create_task(db, founder, "text_preview",
                                 {"mode": "preview", "prompt": prompt, "art_style": "realistic", "ai_model": "latest"},
                                 f"nx-city-{slug}-prev-v1", {"project": "nexus", "slot": f"city_{slug}"})
        prevs[slug] = r["task_id"]
        print(f"[batch] {slug} preview {r['task_id']}", flush=True)

    async def wait(wf, tid, max_s=2400):
        for _ in range(max_s // 15):
            st = await mp.poll_task(db, wf, tid)
            if st.get("status") in mp.TERMINAL:
                return st
            await asyncio.sleep(15)
        return {"status": "TIMEOUT"}

    for slug, prompt in ASSETS:
        try:
            st = await wait("text_preview", prevs[slug])
            if st.get("status") != "SUCCEEDED":
                results[slug] = {"error": f"preview {st.get('status')}"}
                continue
            rr = await mp.create_task(db, founder, "text_refine",
                                      {"mode": "refine", "preview_task_id": prevs[slug], "enable_pbr": True},
                                      f"nx-city-{slug}-ref-v1", {"project": "nexus", "slot": f"city_{slug}"})
            st = await wait("text_refine", rr["task_id"])
            if st.get("status") != "SUCCEEDED":
                results[slug] = {"error": f"refine {st.get('status')}"}
                continue
            asset = await mp.store_glb(db, founder, "text_refine", rr["task_id"],
                                       f"nexus city {slug} (master)", {"project": "nexus", "slot": f"city_{slug}"})
            mfile = media_dir("models") / asset["url"].split("/")[-1]
            drv = f"/app/artifacts/nexus/city_{slug}_draco.glb"
            subprocess.run(["npx", "--yes", "@gltf-transform/cli", "optimize", str(mfile), drv,
                            "--compress", "draco", "--texture-size", "1024"], check=True, capture_output=True, timeout=280)
            raw = open(drv, "rb").read()
            meta = mp.validate_glb(raw)
            fname = meta["checksum"][:32] + ".glb"
            (media_dir("models") / fname).write_bytes(raw)
            try:
                get_storage_adapter().put("models", fname, media_dir("models") / fname)
            except Exception:  # noqa: BLE001
                pass
            url = f"/api/media/models/{fname}"
            await db.asset_library.update_one({"id": meta["checksum"][:32]}, {"$set": {
                "id": meta["checksum"][:32], "kind": "model_glb", "name": f"nexus city {slug} (runtime)",
                "url": url, "meta": meta, "provider": "meshy", "meshy_task_id": rr["task_id"],
                "workflow": "text_refine", "context": {"project": "nexus", "slot": f"city_{slug}"}}}, upsert=True)
            results[slug] = {"runtime_url": url, "kb": meta["bytes"] // 1024, "task": rr["task_id"]}
            print(f"[batch] {slug} DONE {url} {meta['bytes']//1024}KB", flush=True)
        except Exception as e:  # noqa: BLE001
            results[slug] = {"error": str(e)[:200]}
            print(f"[batch] {slug} FAILED {e}", flush=True)
    h2 = await mp.health()
    results["_balance"] = {"start": h.get("balance"), "end": h2.get("balance")}
    json.dump(results, open("/app/artifacts/nexus/city_batch.json", "w"), indent=1)
    print(f"[batch] balance end {h2.get('balance')}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
