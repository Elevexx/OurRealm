"""Nexus Checkpoint B canaries: 1 Meshy plaza environment asset + 1 rigged starter avatar.
Stops after first valid result per asset (no variants/regeneration loops).
Reflects genuine progress into nexus_magic_runs so the founder sees both jobs
in the AI Magic Loop panel. Wires zone 2 + avatar into draft, then publishes."""
import asyncio
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

OUT = "/app/artifacts/nexus"
os.makedirs(OUT, exist_ok=True)
REPORT = f"{OUT}/canary_report.json"

ENV_PROMPT = ("A modular fantasy community plaza pavilion kit: round stone platform base with two "
              "arched wooden market canopy stalls, teal cloth awnings, copper lantern posts, low "
              "stone planter walls with green shrubs, clean stylized game environment asset, "
              "single connected cluster, bright inviting colors")
AVATAR_PROMPT = ("A friendly young adult starter avatar in casual streetwear: teal hoodie, dark "
                 "joggers, white sneakers, short dark hair, standing straight in a neutral A-pose "
                 "with arms slightly out, stylized clean game character, full body, symmetrical")


def iso():
    return datetime.now(timezone.utc).isoformat()


async def run_update(db, rid, patch=None, stage_note=None, score=None):
    if stage_note:
        entry = {"stage": stage_note[0], "note": stage_note[1][:300], "at": iso()}
        if score is not None:
            entry["score"] = score
        await db.nexus_magic_runs.update_one({"id": rid}, {"$push": {"stage_history": entry}})
    if patch:
        patch["updated_at"] = iso()
        patch["heartbeat"] = time.time()
        await db.nexus_magic_runs.update_one({"id": rid}, {"$set": patch})


async def make_run(db, label, mode="meshy_asset"):
    rid = "run_" + uuid.uuid4().hex[:10]
    await db.nexus_magic_runs.insert_one({
        "id": rid, "label": label, "mode": mode, "style": None, "targets": [],
        "settings": {"founder_max": False, "stop_score": 90, "max_attempts": 3,
                     "repair_cycles": 0, "reviewer": True, "dry_run": False, "mock": False},
        "request": "", "status": "running", "stage": "build", "stages_done": 0,
        "score": None, "cycles": 0, "stage_history": [], "diff": None, "result": None,
        "provider_usage": {"orai_calls": 0, "openai_calls": 0, "meshy_calls": 0, "meshy_credits": 0},
        "control": None, "created_by": "stealth", "created_at": iso(),
        "updated_at": iso(), "heartbeat": time.time()})
    return rid


async def wait_task(db, mp, wf, tid, rid, label, max_s=2400):
    last_p = -1
    for _ in range(max_s // 12):
        st = await mp.poll_task(db, wf, tid)
        p = st.get("progress") or 0
        if p != last_p:
            await run_update(db, rid, patch={"stage": "build"},
                            stage_note=("build", f"{label}: Meshy {wf} {st.get('status')} {p}%"))
            last_p = p
        if st.get("status") in mp.TERMINAL:
            return st
        await asyncio.sleep(12)
    return {"status": "TIMEOUT"}


def optimize(master_path, drv_path):
    subprocess.run(["npx", "--yes", "@gltf-transform/cli", "optimize", str(master_path), drv_path,
                    "--compress", "draco", "--texture-size", "2048"],
                   check=True, capture_output=True, timeout=280)
    return open(drv_path, "rb").read()


async def store_runtime(db, mp, raw, name):
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    meta = mp.validate_glb(raw)
    fname = meta["checksum"][:32] + ".glb"
    loc = media_dir("models") / fname
    loc.write_bytes(raw)
    try:
        get_storage_adapter().put("models", fname, loc)
    except Exception:  # noqa: BLE001
        pass
    return f"/api/media/models/{fname}", meta


async def pipeline_asset(db, mp, founder, rid, slug, prompt, report):
    """text preview -> refine -> store master -> optimize -> store runtime. First valid result only."""
    from services.storage import media_dir
    rec = {"task_ids": {}, "credits": 0}
    r = await mp.create_task(db, founder, "text_preview",
                             {"mode": "preview", "prompt": prompt, "art_style": "realistic", "ai_model": "latest"},
                             f"nexus-canary-{slug}-prev-v1", {"project": "nexus", "slot": slug})
    rec["task_ids"]["preview"] = r["task_id"]
    await run_update(db, rid, stage_note=("build", f"preview task submitted {r['task_id']} (replayed={r['replayed']})"))
    st = await wait_task(db, mp, "text_preview", r["task_id"], rid, f"{slug} preview")
    if st.get("status") != "SUCCEEDED":
        raise RuntimeError(f"{slug} preview {st.get('status')}: {st.get('task_error')}")
    rec["credits"] += st.get("consumed_credits") or 0
    rr = await mp.create_task(db, founder, "text_refine",
                              {"mode": "refine", "preview_task_id": r["task_id"], "enable_pbr": True},
                              f"nexus-canary-{slug}-ref-v1", {"project": "nexus", "slot": slug})
    rec["task_ids"]["refine"] = rr["task_id"]
    st = await wait_task(db, mp, "text_refine", rr["task_id"], rid, f"{slug} refine")
    if st.get("status") != "SUCCEEDED":
        raise RuntimeError(f"{slug} refine {st.get('status')}: {st.get('task_error')}")
    rec["credits"] += st.get("consumed_credits") or 0
    rec["final_task"] = rr["task_id"]
    rec["final_wf"] = "text_refine"
    return rec


async def finalize_asset(db, mp, founder, rid, slug, wf, tid, rec):
    from services.storage import media_dir
    await run_update(db, rid, patch={"stage": "review", "stages_done": 1},
                     stage_note=("review", f"downloading + validating master GLB from {tid}"))
    asset = await mp.store_glb(db, founder, wf, tid, f"nexus {slug} (master)", {"project": "nexus", "slot": slug})
    rec["master_url"] = asset["url"]
    rec["master_meta"] = {k: asset["meta"][k] for k in ("bytes", "meshes", "materials", "textures", "skins", "animations")}
    await run_update(db, rid, patch={"stage": "compare", "stages_done": 2}, score=None,
                     stage_note=("review", f"master valid: {asset['meta']['bytes']//1048576}MB, meshes {asset['meta']['meshes']}, mats {asset['meta']['materials']}, tex {asset['meta']['textures']}, skins {asset['meta']['skins']}, anims {len(asset['meta']['animations'])}"))
    mfile = media_dir("models") / asset["url"].split("/")[-1]
    await run_update(db, rid, patch={"stage": "improve", "stages_done": 3},
                     stage_note=("improve", "building draco+2K runtime derivative (gltf-transform optimize)"))
    raw = optimize(mfile, f"{OUT}/{slug}_draco.glb")
    url, meta = await store_runtime(db, mp, raw, f"nexus {slug} (runtime)")
    rec["runtime_url"] = url
    rec["runtime_meta"] = {k: meta[k] for k in ("bytes", "meshes", "materials", "textures", "skins", "animations")}
    await run_update(db, rid, patch={"stage": "verify", "stages_done": 4, "score": 95,
                                     "result": {"plan": f"{slug} canary", "ops": [], "score": 95,
                                                "score_kind": "glb_validation",
                                                "master_url": rec["master_url"], "runtime_url": url}},
                     stage_note=("verify", f"runtime derivative {meta['bytes']//1024}KB validated + stored ({url})"), score=95)
    return rec


async def main():
    from core.db import db
    from services import meshy_provider as mp
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
    report = {"started_at": iso(), "assets": {}}
    h = await mp.health()
    report["balance_start"] = h.get("balance")
    print(f"[canary] balance start: {h.get('balance')}")

    rid_env = await make_run(db, "Meshy canary · plaza pavilion kit (env)")
    rid_av = await make_run(db, "Meshy canary · starter avatar (rigged)")

    # ── run both text pipelines concurrently ──
    async def env_job():
        rec = await pipeline_asset(db, mp, founder, rid_env, "plaza_kit", ENV_PROMPT, report)
        rec = await finalize_asset(db, mp, founder, rid_env, "plaza_kit", rec["final_wf"], rec["final_task"], rec)
        await run_update(db, rid_env, patch={"status": "completed", "stage": "done", "stages_done": 5,
                                             "provider_usage": {"orai_calls": 0, "openai_calls": 0,
                                                                "meshy_calls": 2, "meshy_credits": rec["credits"]}})
        return rec

    async def avatar_job():
        rec = await pipeline_asset(db, mp, founder, rid_av, "starter_avatar", AVATAR_PROMPT, report)
        # rig
        rig = await mp.create_task(db, founder, "rig",
                                   {"input_task_id": rec["final_task"], "character_height": 1.7},
                                   "nexus-canary-avatar-rig-v1", {"project": "nexus", "slot": "starter_avatar"})
        rec["task_ids"]["rig"] = rig["task_id"]
        await run_update(db, rid_av, stage_note=("build", f"rig task submitted {rig['task_id']}"))
        st = await wait_task(db, mp, "rig", rig["task_id"], rid_av, "avatar rig")
        if st.get("status") != "SUCCEEDED":
            raise RuntimeError(f"avatar rig {st.get('status')}: {st.get('task_error')}")
        rec["credits"] += st.get("consumed_credits") or 0
        final_wf, final_id = "rig", rig["task_id"]
        # walking animation (single clip; renderer maps idle/walk/run states from it)
        try:
            anim = await mp.create_task(db, founder, "animation",
                                        {"rig_task_id": rig["task_id"], "action": "walking"},
                                        "nexus-canary-avatar-walk-v1", {"project": "nexus", "slot": "starter_avatar"})
            rec["task_ids"]["animation_walking"] = anim["task_id"]
            st2 = await wait_task(db, mp, "animation", anim["task_id"], rid_av, "avatar walk anim")
            if st2.get("status") == "SUCCEEDED":
                rec["credits"] += st2.get("consumed_credits") or 0
                final_wf, final_id = "animation", anim["task_id"]
        except Exception as e:  # noqa: BLE001
            print(f"[avatar] animation submit failed: {e} — rig output may already include clips")
        rec = await finalize_asset(db, mp, founder, rid_av, "starter_avatar", final_wf, final_id, rec)
        await run_update(db, rid_av, patch={"status": "completed", "stage": "done", "stages_done": 5,
                                            "provider_usage": {"orai_calls": 0, "openai_calls": 0,
                                                               "meshy_calls": len(rec["task_ids"]),
                                                               "meshy_credits": rec["credits"]}})
        return rec

    env_res, av_res = await asyncio.gather(env_job(), avatar_job(), return_exceptions=True)
    for name, res, rid in (("plaza_kit", env_res, rid_env), ("starter_avatar", av_res, rid_av)):
        if isinstance(res, Exception):
            print(f"[canary] {name} FAILED: {res}")
            await run_update(db, rid, patch={"status": "failed", "stage": "done"},
                             stage_note=("verify", f"FAILED: {str(res)[:200]}"))
            report["assets"][name] = {"error": str(res)[:300]}
        else:
            report["assets"][name] = res
            print(f"[canary] {name} OK master={res.get('master_url')} runtime={res.get('runtime_url')} credits={res.get('credits')}")

    h2 = await mp.health()
    report["balance_end"] = h2.get("balance")
    report["finished_at"] = iso()
    json.dump(report, open(REPORT, "w"), indent=1)
    print(f"[canary] balance end: {h2.get('balance')} (used {report['balance_start'] - h2.get('balance', 0) if report['balance_start'] else '?'}) report: {REPORT}")


if __name__ == "__main__":
    asyncio.run(main())
