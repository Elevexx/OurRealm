"""SIX-AVATAR PRODUCTION BATCH (founder approved, continuous run). Per avatar: preview->refine->
remesh40k->rig(max2)->7 anims (idle walk run jump fall land greet). Masters preserved; LOD0/1/2
runtimes; registry upsert. Idempotent — safe to re-run; replays burned tasks at zero credit."""
import asyncio, json, sys, urllib.request
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")
from scripts.nexus_citizen_canary import wait, opt, store
AVATARS = [
 ("av_streetwear", "STREETWEAR", "young male futuristic streetwear game character standing in perfect A-pose arms out 45 degrees, dark layered hoodie jacket and cargo pants with subtle glowing cyan tech accents on sleeves and shoes, original design, clean topology, separated limbs, symmetrical humanoid"),
 ("av_tech_operative", "TECH OPERATIVE", "korean female tech operative game character in perfect A-pose arms out 45 degrees, short blue-black bob haircut, white and cyan cropped high-tech jacket, dark tactical pants, original design, clean topology, separated limbs, symmetrical humanoid"),
 ("av_realm_guardian", "REALM GUARDIAN", "male guardian game character in perfect A-pose arms out 45 degrees, detailed black and green futuristic tactical armor with glowing green energy lines, original design, clean topology, separated limbs, symmetrical humanoid"),
 ("av_aether_champion", "AETHER CHAMPION", "african male champion game character in perfect A-pose arms out 45 degrees, powerful black and electric-blue advanced sci-fi armor with refined glowing blue accents, original design, clean topology, separated limbs, symmetrical humanoid"),
 ("av_arcane_sovereign", "ARCANE SOVEREIGN", "female arcane sovereign game character in perfect A-pose arms out 45 degrees, elegant black and purple advanced armor with layered short cape elements and subtle purple energy glow, original design, clean topology, separated limbs, symmetrical humanoid"),
 ("av_void_wizard", "LEGENDARY VOID WIZARD", "male wizard game character in perfect A-pose arms out 45 degrees, black hooded advanced sci-fi robe covered in glowing green ancient alien glyphs, no crown, no staff in hands, original design, clean topology, separated limbs, symmetrical humanoid"),
]

ANIMS = {"idle": 0, "walk": 1, "run": 6, "jump": 641, "fall": 502, "land": 506, "greet": 28}
JUMP_FALLBACKS = [641, 605, 13]
FLOOR = 3299
PER_AVATAR = 61

async def one(db, mp, media_dir, adapter, founder, aid, label, prompt):
    out = {}
    p = await mp.create_task(db, founder, "text_preview", {"mode":"preview","prompt":prompt,"art_style":"realistic","ai_model":"latest"}, f"nx-av-{aid}-prev-v1", {"project":"nexus","slot":aid})
    st = await wait(mp, db, "text_preview", p["task_id"])
    if st.get("status") != "SUCCEEDED": raise RuntimeError("preview "+str(st.get("status")))
    r = await mp.create_task(db, founder, "text_refine", {"mode":"refine","preview_task_id":p["task_id"],"enable_pbr":True}, f"nx-av-{aid}-ref-v1", {"project":"nexus","slot":aid})
    st = await wait(mp, db, "text_refine", r["task_id"])
    if st.get("status") != "SUCCEEDED": raise RuntimeError("refine "+str(st.get("status")))
    rm = await mp.create_task(db, founder, "remesh", {"input_task_id":r["task_id"],"target_formats":["glb"],"topology":"triangle","target_polycount":40000}, f"nx-av-{aid}-rm-v1", {"project":"nexus","slot":aid})
    st = await wait(mp, db, "remesh", rm["task_id"])
    if st.get("status") != "SUCCEEDED": raise RuntimeError("remesh "+str(st.get("status")))
    rig = None
    for attempt in ("v1","v2"):
        rg = await mp.create_task(db, founder, "rig", {"input_task_id":rm["task_id"],"character_height":1.75}, f"nx-av-{aid}-rig-{attempt}", {"project":"nexus","slot":aid})
        st = await wait(mp, db, "rig", rg["task_id"])
        if st.get("status") == "SUCCEEDED": rig = rg["task_id"]; break
    if not rig: raise RuntimeError("rig failed twice (uncharged)")
    raw = await mp._call("GET", f"/openapi/v1/rigging/{rig}")
    rurl = (raw.get("result") or {}).get("rigged_character_glb_url")
    master = f"/app/artifacts/nexus/{aid}_rig_master.glb"
    with urllib.request.urlopen(rurl) as h, open(master, "wb") as f: f.write(h.read())
    anims = {}
    for name, act in ANIMS.items():
        cands = JUMP_FALLBACKS if name == "jump" else [act]
        for ci, cact in enumerate(cands):
            try:
                a = await mp.create_task(db, founder, "animation", {"rig_task_id":rig,"action_id":cact}, f"nx-av-{aid}-{name}-v{ci+2 if name=='jump' else 1}", {"project":"nexus","slot":aid})
                st = await wait(mp, db, "animation", a["task_id"])
                if st.get("status") != "SUCCEEDED": continue
                ra = await mp._call("GET", f"/openapi/v1/animations/{a['task_id']}")
                wurl = (ra.get("result") or {}).get("animation_glb_url")
                mp2 = f"/tmp/{aid}_{name}_m.glb"
                with urllib.request.urlopen(wurl) as h, open(mp2, "wb") as f: f.write(h.read())
                dst = f"/tmp/{aid}_{name}.glb"; opt(mp2, dst, None, 512)
                u, meta = await store(db, mp, media_dir, adapter, dst, f"{label} ({name})", f"{aid}_{name}", a["task_id"], "animation")
                if not meta.get("animations"): continue
                anims[name] = u; break
            except Exception as e: print(f"[av6] {aid} anim {name}({cact}) skipped: {e}", flush=True)
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
    out.update({"rig_task": rig, "lods": lods, "anims": list(anims)})
    return out

async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    founder = await db.users.find_one({"username":"stealth"}, {"_id":0,"id":1,"username":1})
    bal = (await mp.health()).get("balance") or 0
    res = {"balance_start": bal}
    if bal - PER_AVATAR * len(AVATARS) < FLOOR:
        print(f"[av6] ABORT — worst-case spend would breach floor {FLOOR} (balance {bal})", flush=True)
        return
    async def run(aid, label, prompt):
        try:
            res[aid] = await one(db, mp, media_dir, get_storage_adapter, founder, aid, label, prompt)
            print(f"[av6] {aid} DONE", flush=True)
        except Exception as e:
            res[aid] = {"error": str(e)[:200]}; print(f"[av6] {aid} FAILED {e}", flush=True)
        json.dump(res, open("/app/artifacts/nexus/avatars6.json","w"), indent=1)
    await asyncio.gather(*(run(a, l, p) for a, l, p in AVATARS))
    res["balance_end"] = (await mp.health()).get("balance")
    json.dump(res, open("/app/artifacts/nexus/avatars6.json","w"), indent=1)
    print(f"[av6] ALL DONE balance {res['balance_end']}", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
