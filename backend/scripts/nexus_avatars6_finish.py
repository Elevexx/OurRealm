"""Avatar batch FINISHER — consolidates all nx-av-* Meshy tasks into the nexus_avatars registry.
Reuses succeeded tasks by idem_key (immune to payload-hash conflicts from the duplicate-process race).
Only creates NEW paid tasks for missing jump anims (candidates 641/605/13). Masters preserved."""
import asyncio, json, sys, urllib.request
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")
from scripts.nexus_citizen_canary import wait, opt, store

IDS = [("av_streetwear","STREETWEAR"),("av_tech_operative","TECH OPERATIVE"),("av_realm_guardian","REALM GUARDIAN"),
       ("av_aether_champion","AETHER CHAMPION"),("av_arcane_sovereign","ARCANE SOVEREIGN"),("av_void_wizard","LEGENDARY VOID WIZARD")]
ANIM_NAMES = ["idle","walk","run","jump","fall","land","greet"]
CANDS = {"idle":[0],"walk":[1],"run":[6],"jump":[641,605,13],"fall":[502],"land":[506],"greet":[28]}
FLOOR = 3299

async def task_by_key(db, key):
    return await db.meshy_tasks.find_one({"idem_key": key, "status": {"$ne": "FAILED"}}, {"_id":0}) \
        or await db.meshy_tasks.find_one({"idem_key": key}, {"_id":0})

async def wait_done(mp, db, wf, tid):
    st = await wait(mp, db, wf, tid)
    return st.get("status") == "SUCCEEDED"

async def one(db, mp, media_dir, adapter, founder, aid, label):
    rig = None
    async for t in db.meshy_tasks.find({"idem_key": f"nx-av-{aid}-rig-v1"}, {"_id":0}):
        if t.get("status") == "SUCCEEDED": rig = t["meshy_task_id"]; break
        if await wait_done(mp, db, "rig", t["meshy_task_id"]): rig = t["meshy_task_id"]; break
    if not rig: raise RuntimeError("no successful rig")
    raw = await mp._call("GET", f"/openapi/v1/rigging/{rig}")
    rurl = (raw.get("result") or {}).get("rigged_character_glb_url")
    master = f"/app/artifacts/nexus/{aid}_rig_master.glb"
    with urllib.request.urlopen(rurl) as h, open(master, "wb") as f: f.write(h.read())

    async def store_anim(name, task_id):
        ra = await mp._call("GET", f"/openapi/v1/animations/{task_id}")
        wurl = (ra.get("result") or {}).get("animation_glb_url")
        if not wurl: return None
        mp2 = f"/tmp/{aid}_{name}_m.glb"
        with urllib.request.urlopen(wurl) as h, open(mp2, "wb") as f: f.write(h.read())
        dst = f"/tmp/{aid}_{name}.glb"; opt(mp2, dst, None, 512)
        u, meta = await store(db, mp, media_dir, adapter, dst, f"{label} ({name})", f"{aid}_{name}", task_id, "animation")
        return u if meta.get("animations") else None

    anims = {}
    for name in ANIM_NAMES:
        got = None
        for v in ("v1","v2","v3","v4"):
            t = await task_by_key(db, f"nx-av-{aid}-{name}-{v}")
            if not t: continue
            if t.get("status") == "SUCCEEDED" or await wait_done(mp, db, "animation", t["meshy_task_id"]):
                got = await store_anim(name, t["meshy_task_id"])
                if got: break
        if not got:
            bal = (await mp.health()).get("balance") or 0
            for ci, act in enumerate(CANDS[name]):
                if bal - 3 < FLOOR: break
                try:
                    a = await mp.create_task(db, founder, "animation", {"rig_task_id": rig, "action_id": act},
                                             f"nx-av-{aid}-{name}-v{ci+2}", {"project":"nexus","slot":aid})
                    if await wait_done(mp, db, "animation", a["task_id"]):
                        got = await store_anim(name, a["task_id"])
                        if got: break
                except Exception as e: print(f"[fin] {aid} {name}({act}): {e}", flush=True)
        if got: anims[name] = got
    lods = {}
    for lod, ratio, tex in (("lod0", None, 1024), ("lod1", 0.4, 512), ("lod2", 0.13, 256)):
        dst = f"/tmp/{aid}_{lod}.glb"; opt(master, dst, ratio, tex)
        u, meta = await store(db, mp, media_dir, adapter, dst, f"{label} ({lod})", f"{aid}_{lod}", rig, "rig")
        if lod == "lod0" and not meta.get("skins"): raise RuntimeError("lod0 has no skin — rejected")
        lods[lod] = u
    await db.nexus_avatars.update_one({"id": aid}, {"$set": {
        "id": aid, "label": label, "status": "premium", "eligibility": "unlock",
        "rigged_base_url": lods["lod0"], "lod_urls": lods, "animation_urls": anims,
        "thumb": f"/nexus/{aid}.webp",
        "master_file": master, "rig_task": rig, "created_at": "2026-06"}}, upsert=True)
    return {"rig": rig, "anims": sorted(anims), "lods": lods}

async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    founder = await db.users.find_one({"username":"stealth"}, {"_id":0,"id":1,"username":1})
    res = {"balance_start": (await mp.health()).get("balance")}
    async def run(aid, label):
        try:
            res[aid] = await one(db, mp, media_dir, get_storage_adapter, founder, aid, label)
            print(f"[fin] {aid} DONE anims={res[aid]['anims']}", flush=True)
        except Exception as e:
            res[aid] = {"error": str(e)[:200]}; print(f"[fin] {aid} FAILED {e}", flush=True)
        json.dump(res, open("/app/artifacts/nexus/avatars6.json","w"), indent=1)
    await asyncio.gather(*(run(a, l) for a, l in IDS))
    res["balance_end"] = (await mp.health()).get("balance")
    json.dump(res, open("/app/artifacts/nexus/avatars6.json","w"), indent=1)
    print(f"[fin] ALL DONE balance {res['balance_end']}", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
