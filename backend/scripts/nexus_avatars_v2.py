"""FOUNDER AAA AVATAR REBUILD v2 — image-to-3D from permanent reference crops for the 6 premium
avatars + new free STARTER NINJA. Candidate-validate-swap: catalog docs only updated after the new
model passes validation (skins + all 7 anims). Masters preserved with _v2 suffixes."""
import asyncio, base64, json, sys, urllib.request
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")
from scripts.nexus_citizen_canary import wait, opt, store

AVATARS = [
    ("av_ninja", "STARTER NINJA"),
    ("av_ninja_f", "STARTER NINJA (FEMALE)"),
    ("av_streetwear", "STREETWEAR"),
    ("av_tech_operative", "TECH OPERATIVE"),
    ("av_realm_guardian", "REALM GUARDIAN"),
    ("av_aether_champion", "AETHER CHAMPION"),
    ("av_arcane_sovereign", "ARCANE SOVEREIGN"),
    ("av_void_wizard", "LEGENDARY VOID WIZARD"),
]
ANIMS = {"idle": [0], "walk": [1], "run": [6], "jump": [641, 605, 13], "fall": [502], "land": [506], "greet": [28]}
FLOOR = 80  # founder authorized full balance; keep a tiny operational reserve
PER_AVATAR = 70

def data_uri(aid):
    raw = open(f"/tmp/ref_{aid}.png", "rb").read()
    return "data:image/png;base64," + base64.b64encode(raw).decode()

async def one(db, mp, media_dir, adapter, founder, aid, label):
    img = await mp.create_task(db, founder, "image",
        {"image_url": data_uri(aid), "ai_model": "latest", "should_texture": True, "enable_pbr": True,
         "topology": "triangle", "target_polycount": 120000},
        f"nx-av2-{aid}-img-v1", {"project": "nexus", "slot": aid})
    st = await wait(mp, db, "image", img["task_id"])
    if st.get("status") != "SUCCEEDED": raise RuntimeError("image " + str(st.get("status")))
    rm = await mp.create_task(db, founder, "remesh",
        {"input_task_id": img["task_id"], "target_formats": ["glb"], "topology": "triangle", "target_polycount": 40000},
        f"nx-av2-{aid}-rm-v1", {"project": "nexus", "slot": aid})
    st = await wait(mp, db, "remesh", rm["task_id"])
    if st.get("status") != "SUCCEEDED": raise RuntimeError("remesh " + str(st.get("status")))
    rig = None
    for attempt in ("v1", "v2"):
        rg = await mp.create_task(db, founder, "rig", {"input_task_id": rm["task_id"], "character_height": 1.75},
                                  f"nx-av2-{aid}-rig-{attempt}", {"project": "nexus", "slot": aid})
        st = await wait(mp, db, "rig", rg["task_id"])
        if st.get("status") == "SUCCEEDED": rig = rg["task_id"]; break
    if not rig: raise RuntimeError("rig failed twice")
    raw = await mp._call("GET", f"/openapi/v1/rigging/{rig}")
    rurl = (raw.get("result") or {}).get("rigged_character_glb_url")
    master = f"/app/artifacts/nexus/{aid}_v2_rig_master.glb"
    with urllib.request.urlopen(rurl) as h, open(master, "wb") as f: f.write(h.read())
    anims = {}
    for name, cands in ANIMS.items():
        for ci, act in enumerate(cands):
            try:
                a = await mp.create_task(db, founder, "animation", {"rig_task_id": rig, "action_id": act},
                                         f"nx-av2-{aid}-{name}-v{ci+1}", {"project": "nexus", "slot": aid})
                st = await wait(mp, db, "animation", a["task_id"])
                if st.get("status") != "SUCCEEDED": continue
                ra = await mp._call("GET", f"/openapi/v1/animations/{a['task_id']}")
                wurl = (ra.get("result") or {}).get("animation_glb_url")
                src = f"/tmp/{aid}_v2_{name}_m.glb"
                with urllib.request.urlopen(wurl) as h, open(src, "wb") as f: f.write(h.read())
                dst = f"/tmp/{aid}_v2_{name}.glb"; opt(src, dst, None, 512)
                u, meta = await store(db, mp, media_dir, adapter, dst, f"{label} v2 ({name})", f"{aid}_v2_{name}", a["task_id"], "animation")
                if meta.get("animations"): anims[name] = u; break
            except Exception as e: print(f"[av2] {aid} anim {name}({act}): {e}", flush=True)
    lods = {}
    for lod, ratio, tex in (("lod0", None, 1024), ("lod1", 0.4, 512), ("lod2", 0.13, 256)):
        dst = f"/tmp/{aid}_v2_{lod}.glb"; opt(master, dst, ratio, tex)
        u, meta = await store(db, mp, media_dir, adapter, dst, f"{label} v2 ({lod})", f"{aid}_v2_{lod}", rig, "rig")
        if lod == "lod0" and not meta.get("skins"): raise RuntimeError("lod0 no skin — REJECTED")
        lods[lod] = u
    # VALIDATION GATE: swap the catalog doc only when everything critical exists
    if len(anims) < 7:
        raise RuntimeError(f"only {len(anims)}/7 anims — candidate NOT swapped (kept previous runtime)")
    prev = await db.nexus_avatars.find_one({"id": aid}, {"_id": 0}) or {}
    if prev:
        await db.nexus_avatars_archive.update_one({"id": aid, "gen": "v1"}, {"$set": {**prev, "gen": "v1"}}, upsert=True)
    base = {"id": aid, "label": label, "rigged_base_url": lods["lod0"], "lod_urls": lods,
            "animation_urls": anims, "thumb": f"/nexus/{aid}.webp", "master_file": master,
            "rig_task": rig, "gen": "v2", "created_at": "2026-06"}
    if aid == "av_ninja":
        base.update({"status": "active", "eligibility": "free", "is_default": True, "glow_channel": True, "body": "male"})
    elif aid == "av_ninja_f":
        base.update({"status": "active", "eligibility": "free", "glow_channel": True, "body": "female"})
    else:
        base.update({"status": "premium", "eligibility": "unlock"})
    await db.nexus_avatars.update_one({"id": aid}, {"$set": base}, upsert=True)
    return {"rig": rig, "anims": sorted(anims), "lods": lods, "img_task": img["task_id"]}

async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
    bal = (await mp.health()).get("balance") or 0
    res = {"balance_start": bal}
    if bal - PER_AVATAR * len(AVATARS) < FLOOR:
        print(f"[av2] ABORT — insufficient credits (balance {bal})", flush=True); return
    async def run(aid, label):
        try:
            res[aid] = await one(db, mp, media_dir, get_storage_adapter, founder, aid, label)
            print(f"[av2] {aid} DONE anims={res[aid]['anims']}", flush=True)
        except Exception as e:
            res[aid] = {"error": str(e)[:200]}; print(f"[av2] {aid} FAILED {e}", flush=True)
        json.dump(res, open("/app/artifacts/nexus/avatars_v2.json", "w"), indent=1)
    await asyncio.gather(*(run(a, l) for a, l in AVATARS))
    res["balance_end"] = (await mp.health()).get("balance")
    json.dump(res, open("/app/artifacts/nexus/avatars_v2.json", "w"), indent=1)
    print(f"[av2] ALL DONE balance {res['balance_end']}", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
