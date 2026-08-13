"""Spawn Zone ARCHITECTURE BATCH 3 (founder continuous run): 4 modular families via Meshy
(preview->refine->store->draco runtime + lod2). Resume-safe idem keys nx-b3-*. Floor-guarded."""
import asyncio, json, subprocess, sys
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")

FLOOR = 3299
ASSETS = [
    ("led_tower", "Massive futuristic skyscraper tower with giant glowing blue and purple LED video billboard facades covering the walls, animated digital advertisement panels, dark metal structure, night cyberpunk city tower, game environment asset"),
    ("terrace_block", "Futuristic three-story shopping terrace building with open balconies, railings, glowing storefront windows on every level, purple and cyan neon signage, planters with small trees, dense architectural detail, modular corner building, game environment asset"),
    ("spire_cluster", "Cluster of three very tall futuristic spire skyscrapers of different heights, glowing cyan and green window light strips, antenna spires, dark metal and glass, distant night skyline landmark group, game environment asset"),
    ("holo_club", "Futuristic rounded corner entertainment building with a huge curved holographic screen facade glowing pink and cyan, neon trim outlines, elevated entrance with steps, cyberpunk live music club, game environment asset"),
]

async def wait(mp, db, wf, tid, max_s=2400):
    for _ in range(max_s // 15):
        st = await mp.poll_task(db, wf, tid)
        if st.get("status") in mp.TERMINAL:
            return st
        await asyncio.sleep(15)
    return {"status": "TIMEOUT"}

def derive(src, dst, ratio, tex):
    if ratio:
        mid = dst + ".s.glb"
        subprocess.run(["npx", "--yes", "@gltf-transform/cli", "simplify", src, mid,
                        "--ratio", str(ratio), "--error", "0.005"], check=True, capture_output=True, timeout=300)
        src = mid
    subprocess.run(["npx", "--yes", "@gltf-transform/cli", "optimize", src, dst,
                    "--compress", "draco", "--texture-size", str(tex), "--simplify", "false"],
                   check=True, capture_output=True, timeout=300)

async def one(db, mp, media_dir, adapter, founder, slug, prompt, results):
    p = await mp.create_task(db, founder, "text_preview",
                             {"mode": "preview", "prompt": prompt, "art_style": "realistic", "ai_model": "latest"},
                             f"nx-b3-{slug}-prev-v1", {"project": "nexus", "slot": f"b3_{slug}"})
    st = await wait(mp, db, "text_preview", p["task_id"])
    if st.get("status") != "SUCCEEDED": raise RuntimeError(f"preview {st.get('status')}")
    r = await mp.create_task(db, founder, "text_refine",
                             {"mode": "refine", "preview_task_id": p["task_id"], "enable_pbr": True},
                             f"nx-b3-{slug}-ref-v1", {"project": "nexus", "slot": f"b3_{slug}"})
    st = await wait(mp, db, "text_refine", r["task_id"])
    if st.get("status") != "SUCCEEDED": raise RuntimeError(f"refine {st.get('status')}")
    asset = await mp.store_glb(db, founder, "text_refine", r["task_id"],
                               f"nexus b3 {slug} (master)", {"project": "nexus", "slot": f"b3_{slug}"})
    mfile = str(media_dir("models") / asset["url"].split("/")[-1])
    out = {"task": r["task_id"]}
    for tier, ratio, tex in (("runtime", 0.4, 1024), ("lod2", 0.12, 256)):
        dst = f"/app/artifacts/nexus/b3_{slug}_{tier}.glb"
        derive(mfile, dst, ratio, tex)
        raw = open(dst, "rb").read()
        meta = mp.validate_glb(raw)
        fname = meta["checksum"][:32] + ".glb"
        (media_dir("models") / fname).write_bytes(raw)
        try: adapter().put("models", fname, media_dir("models") / fname)
        except Exception: pass
        url = f"/api/media/models/{fname}"
        await db.asset_library.update_one({"id": meta["checksum"][:32]}, {"$set": {
            "id": meta["checksum"][:32], "kind": "model_glb", "name": f"nexus b3 {slug} ({tier})",
            "url": url, "meta": meta, "provider": "meshy", "meshy_task_id": r["task_id"],
            "workflow": "text_refine", "license": "meshy-generated", "owner": "ourrealm",
            "context": {"project": "nexus", "slot": f"b3_{slug}"}}}, upsert=True)
        out[f"{tier}_url"] = url
        out[f"{tier}_kb"] = meta["bytes"] // 1024
    results[slug] = out
    print(f"[b3] {slug} DONE {out['runtime_url']} {out['runtime_kb']}KB", flush=True)

async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
    bal = (await mp.health()).get("balance") or 0
    results = {"_balance_start": bal}
    if bal - 30 * len(ASSETS) - 40 < FLOOR:
        print(f"[b3] ABORT — floor guard (balance {bal})", flush=True); return
    async def run(slug, prompt):
        try: await one(db, mp, media_dir, get_storage_adapter, founder, slug, prompt, results)
        except Exception as e:
            results[slug] = {"error": str(e)[:200]}; print(f"[b3] {slug} FAILED {e}", flush=True)
        json.dump(results, open("/app/artifacts/nexus/batch3.json", "w"), indent=1)
    await asyncio.gather(*(run(s, p) for s, p in ASSETS))
    results["_balance_end"] = (await mp.health()).get("balance")
    json.dump(results, open("/app/artifacts/nexus/batch3.json", "w"), indent=1)
    print(f"[b3] ALL DONE balance {results['_balance_end']}", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
