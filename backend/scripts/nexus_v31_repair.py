"""V31 avatar repair: (A) zero-credit ninja emissive-mask LOD rebuilds; (B) targeted paid RUN
animation repair — root cause: action_id 6 = BackRight_Run strafe clip. Replacement: forward
in-place run (659, fallbacks 657/16). Founder-authorized for V31 only."""
import asyncio, json, sys, urllib.request
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")
from scripts.nexus_citizen_canary import wait, opt, store

RUN_CANDS = [659, 657, 16]
AV8 = ["av_ninja", "av_ninja_f", "av_streetwear", "av_tech_operative", "av_realm_guardian",
       "av_aether_champion", "av_arcane_sovereign", "av_void_wizard"]

async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
    bal0 = (await mp.health()).get("balance")
    ledger = {"balance_start": bal0, "directive": "nexus-v31-avatar-repair", "tasks": []}
    # A) ninja glow masks -> rebuilt LODs (zero credit)
    for aid, src in (("av_ninja", "/tmp/ninja_m_mask.glb"), ("av_ninja_f", "/tmp/ninja_f_mask.glb")):
        lods = {}
        for lod, ratio, tex in (("lod0", None, 1024), ("lod1", 0.4, 512), ("lod2", 0.13, 256)):
            dst = f"/tmp/{aid}_mask_{lod}.glb"; opt(src, dst, ratio, tex)
            u, meta = await store(db, mp, media_dir, get_storage_adapter, dst, f"{aid} glowmask ({lod})", f"{aid}_mask_{lod}", "v31-mask", "derivative")
            if lod == "lod0" and not meta.get("skins"): raise RuntimeError(f"{aid} mask lost skin")
            lods[lod] = u
        await db.nexus_avatars.update_one({"id": aid}, {"$set": {
            "lod_urls": lods, "rigged_base_url": lods["lod0"], "glow_mask": True, "ktx2": False}})
        print(f"[v31] {aid} glow-mask LODs live", flush=True)
    # B) run repair per avatar (paid, targeted)
    async def fix_run(aid):
        av = await db.nexus_avatars.find_one({"id": aid}, {"_id": 0, "rig_task": 1, "label": 1})
        rig = (av or {}).get("rig_task")
        if not rig:
            t = await db.meshy_tasks.find_one({"idem_key": {"$regex": f"nx-av2?-{aid}-rig"}, "status": "SUCCEEDED"}, {"meshy_task_id": 1})
            rig = t and t["meshy_task_id"]
        if not rig: print(f"[v31] {aid} NO RIG — skipped", flush=True); return
        for ci, act in enumerate(RUN_CANDS):
            try:
                a = await mp.create_task(db, founder, "animation", {"rig_task_id": rig, "action_id": act},
                                         f"nx-av31-{aid}-run-v{ci+1}", {"project": "nexus", "slot": aid, "purpose": "v31 run repair"})
                st = await wait(mp, db, "animation", a["task_id"])
                if st.get("status") != "SUCCEEDED": continue
                ra = await mp._call("GET", f"/openapi/v1/animations/{a['task_id']}")
                wurl = (ra.get("result") or {}).get("animation_glb_url")
                srcf = f"/tmp/{aid}_runfix_m.glb"
                with urllib.request.urlopen(wurl) as h, open(srcf, "wb") as f: f.write(h.read())
                dst = f"/tmp/{aid}_runfix.glb"; opt(srcf, dst, None, 512)
                u, meta = await store(db, mp, media_dir, get_storage_adapter, dst, f"{aid} run fix", f"{aid}_runfix", a["task_id"], "animation")
                if not meta.get("animations"): continue
                await db.nexus_avatars.update_one({"id": aid}, {"$set": {"animation_urls.run": u}})
                ledger["tasks"].append({"task": a["task_id"], "avatar": aid, "action_id": act, "purpose": "run repair", "credits": 3, "result": "ok"})
                print(f"[v31] {aid} run fixed (action {act})", flush=True); return
            except Exception as e: print(f"[v31] {aid} run({act}): {e}", flush=True)
        ledger["tasks"].append({"avatar": aid, "purpose": "run repair", "result": "FAILED"})
    await asyncio.gather(*(fix_run(a) for a in AV8))
    ledger["balance_end"] = (await mp.health()).get("balance")
    json.dump(ledger, open("/app/artifacts/nexus/v31_ledger.json", "w"), indent=1)
    from datetime import datetime, timezone
    await db.nexus_audit.insert_one({"id": "v31-approval", "actor": "stealth", "action": "founder_credit_approval_v31",
        "detail": {"authorized_by": "FOUNDER V31 DIRECTIVE", "scope": "targeted animation repair + zero-credit masks",
                   "estimate": 24, "ledger": ledger["tasks"], "balance_start": bal0, "balance_end": ledger["balance_end"]},
        "at": datetime.now(timezone.utc).isoformat()})
    print(f"[v31] DONE balance {bal0} -> {ledger['balance_end']}", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
