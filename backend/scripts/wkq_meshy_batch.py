"""Arcane Hearth — remaining 9 Meshy models (canary already done, never resubmit).
Submits tasks with idempotency keys, polls to terminal, stores + validates GLBs,
builds 2K runtime derivatives, wires spec.assets slots, writes a full report.
Founder limits: max 3 paid attempts/model, stop-and-report at 650 Meshy credits."""
import asyncio
import io
import json
import os
import subprocess
import sys

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

from PIL import Image  # noqa: E402

GID = "wkq-arcane-hearth-3d-v1"
RAW = "/app/artifacts/wkq/raw"
OUT = "/app/artifacts/wkq/models"
REPORT = "/app/artifacts/wkq/meshy_report.json"
os.makedirs(OUT, exist_ok=True)
PUB = os.environ.get("PUBLIC_BASE_URL") or "https://realm-deploy.preview.emergentagent.com"
CREDIT_STOP = 650


async def upload_ref(db, founder, path, name):
    from services import image_store
    im = Image.open(path).convert("RGBA")
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    rec = await image_store.save_bytes(buf.getvalue(), founder["id"], declared_mime="image/png")
    return PUB + rec.original_url


def crop_maeve_panels():
    im = Image.open(f"{RAW}/maeve_ref.png").convert("RGBA")
    w = im.width // 3
    paths = []
    for i, tag in enumerate(["front", "side", "back"]):
        p = f"{RAW}/maeve_panel_{tag}.png"
        im.crop((i * w, 0, (i + 1) * w, im.height)).save(p)
        paths.append(p)
    return paths


# slug -> (workflow, slot, target_h_note, payload builder key)
TEXT_MODELS = {
    "hazard_brazier": ("model_hazard", "A freestanding copper ember brazier on a wrought iron tripod stand, glowing coals, Celtic knot engravings on the bowl rim, fantasy game prop, bright warm firelit look"),
    "portal_hearth": ("model_portal", "A circular standing portal gate of carved emerald-green stone and copper, Celtic knotwork arch, upright ring shape with open center, glowing rune inlays, fantasy game prop"),
    "ingredient_set": ("model_ingredient", "A small bundle of fresh green herbs tied with twine next to a tiny round cheese wheel, stylized bright fantasy cooking ingredient pickup, single compact cluster"),
    "env_kit_counter": ("model_env_kit", "A sturdy rustic Irish kitchen counter table of warm oak wood with copper pots and a folded teal cloth on top, Celtic carvings on the legs, bright fantasy game prop"),
    "cooking_station": ("model_station", "A round copper cauldron cooking station over a small stone fire bowl with glowing embers, wooden ladle resting on the rim, bright Irish fantasy kitchen prop"),
}
IMAGE_MODELS = {
    "pantry_imp": ("model_guardian", f"{RAW}/foe_walker.png"),
    "mask_guardian": ("model_boss", f"{RAW}/foe_mask_guardian.png"),
    "npc_chef_base": ("model_npc", f"{RAW}/npc_sean.png"),
}


async def main():
    from core.db import db
    from services import meshy_provider as mp
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
    report = {"models": {}, "credits": {}}

    async def balance():
        h = await mp.health()
        return h.get("balance")

    bal0 = await balance()
    report["credits"]["balance_start"] = bal0
    print(f"[meshy] balance at batch start: {bal0}")

    # ── submit ──
    tasks = {}
    panels = crop_maeve_panels()
    urls = [await upload_ref(db, founder, p, f"maeve_{i}") for i, p in enumerate(panels)]
    r = await mp.create_task(db, founder, "multi_image",
                             {"image_urls": urls, "ai_model": "latest", "should_texture": True,
                              "enable_pbr": True},
                             "wkq-arcane-maeve-mi-v1",
                             {"game_id": GID, "slot": "player_model", "name": "Maeve O'Rourke"})
    tasks["maeve"] = {"workflow": "multi_image", "task_id": r["task_id"], "slot": "player_model",
                      "replayed": r["replayed"]}
    print(f"[submit] maeve multi_image -> {r['task_id']} (replayed={r['replayed']})")

    for slug, (slot, ref) in IMAGE_MODELS.items():
        url = await upload_ref(db, founder, ref, slug)
        r = await mp.create_task(db, founder, "image",
                                 {"image_url": url, "ai_model": "latest", "should_texture": True,
                                  "enable_pbr": True},
                                 f"wkq-arcane-{slug}-v1",
                                 {"game_id": GID, "slot": slot, "name": slug})
        tasks[slug] = {"workflow": "image", "task_id": r["task_id"], "slot": slot,
                       "replayed": r["replayed"]}
        print(f"[submit] {slug} image -> {r['task_id']} (replayed={r['replayed']})")

    for slug, (slot, prompt) in TEXT_MODELS.items():
        r = await mp.create_task(db, founder, "text_preview",
                                 {"mode": "preview", "prompt": prompt, "art_style": "realistic",
                                  "ai_model": "latest"},
                                 f"wkq-arcane-{slug}-prev-v1",
                                 {"game_id": GID, "slot": slot, "name": slug})
        tasks[slug] = {"workflow": "text_preview", "task_id": r["task_id"], "slot": slot,
                       "stage": "preview", "prompt": prompt, "replayed": r["replayed"]}
        print(f"[submit] {slug} text preview -> {r['task_id']} (replayed={r['replayed']})")

    # ── poll / advance ──
    done = {}
    for _ in range(240):  # up to ~2h
        pending = {k: v for k, v in tasks.items() if k not in done}
        if not pending:
            break
        for slug, t in list(pending.items()):
            try:
                st = await mp.poll_task(db, "text_refine" if t["workflow"] == "text_refine" else t["workflow"], t["task_id"])
            except Exception as e:  # noqa: BLE001
                print(f"[poll] {slug}: {e}")
                continue
            s = st.get("status")
            if s == "SUCCEEDED":
                if t["workflow"] == "text_preview":
                    rr = await mp.create_task(db, founder, "text_refine",
                                              {"mode": "refine", "preview_task_id": t["task_id"],
                                               "enable_pbr": True},
                                              f"wkq-arcane-{slug}-refine-v1",
                                              {"game_id": GID, "slot": t["slot"], "name": slug})
                    tasks[slug] = {**t, "workflow": "text_refine", "task_id": rr["task_id"], "stage": "refine"}
                    print(f"[advance] {slug} preview done -> refine {rr['task_id']}")
                else:
                    done[slug] = {**t, "status": "SUCCEEDED", "credits": st.get("consumed_credits")}
                    print(f"[done] {slug} SUCCEEDED credits={st.get('consumed_credits')}")
            elif s in ("FAILED", "CANCELED"):
                done[slug] = {**t, "status": s, "error": st.get("task_error")}
                print(f"[done] {slug} {s} err={st.get('task_error')}")
        bal = await balance()
        if bal0 and bal and (bal0 - bal) >= CREDIT_STOP:
            print(f"[STOP] credit threshold reached: consumed {bal0 - bal}")
            break
        await asyncio.sleep(30)

    # ── maeve rig + walk animation ──
    if done.get("maeve", {}).get("status") == "SUCCEEDED":
        try:
            r = await mp.create_task(db, founder, "rig",
                                     {"input_task_id": done["maeve"]["task_id"],
                                      "character_height": 1.7},
                                     "wkq-arcane-maeve-rig-v1",
                                     {"game_id": GID, "slot": "player_model", "name": "maeve rig"})
            print(f"[submit] maeve rig -> {r['task_id']}")
            rig_id = r["task_id"]
            for _ in range(60):
                st = await mp.poll_task(db, "rig", rig_id)
                if st.get("status") in mp.TERMINAL:
                    print(f"[rig] {st.get('status')} credits={st.get('consumed_credits')}")
                    if st.get("status") == "SUCCEEDED":
                        done["maeve_rig"] = {"workflow": "rig", "task_id": rig_id,
                                             "slot": "player_model", "status": "SUCCEEDED",
                                             "credits": st.get("consumed_credits")}
                    break
                await asyncio.sleep(20)
        except Exception as e:  # noqa: BLE001
            print(f"[rig] failed: {e} — will wire static Maeve model instead")

    # ── store + derive + wire ──
    for slug, t in done.items():
        if t.get("status") != "SUCCEEDED" or slug == "maeve" and "maeve_rig" in done:
            if not (slug == "maeve" and "maeve_rig" in done):
                if t.get("status") != "SUCCEEDED":
                    report["models"][slug] = t
                    continue
        if slug == "maeve" and "maeve_rig" in done:
            report["models"][slug] = {**t, "note": "superseded by rigged version"}
            continue
        try:
            wf = t["workflow"]
            asset = await mp.store_glb(db, founder, wf, t["task_id"], f"wkq-arcane {slug}",
                                       {"game_id": GID, "slot": t["slot"]})
            master_url = asset["url"]
            master_local = f"/app/backend/media/models/{asset['id']}.glb"
            if not os.path.exists(master_local):
                from services.storage import media_dir
                master_local = str(media_dir("models") / f"{asset['id']}.glb")
            drv = f"{OUT}/{slug}_2k.glb"
            subprocess.run(["npx", "--yes", "@gltf-transform/cli", "resize",
                            "--width", "2048", "--height", "2048", master_local, drv],
                           check=True, capture_output=True, timeout=280)
            raw = open(drv, "rb").read()
            meta = mp.validate_glb(raw)
            from services.storage import media_dir
            from services.storage_adapter import get_storage_adapter
            fname = meta["checksum"][:32] + ".glb"
            loc = media_dir("models") / fname
            loc.write_bytes(raw)
            try:
                get_storage_adapter().put("models", fname, loc)
            except Exception:  # noqa: BLE001
                pass
            rt_url = f"/api/media/models/{fname}"
            await db.games.update_one({"id": GID}, {"$set": {f"spec.assets.{t['slot']}": {
                "url": rt_url, "meta": {"source": f"meshy:{t['task_id']}", "master_url": master_url,
                                        "master_bytes": asset["meta"]["bytes"],
                                        "runtime_bytes": meta["bytes"], "slug": slug}}}})
            report["models"][slug] = {**t, "master_url": master_url,
                                      "master_bytes": asset["meta"]["bytes"],
                                      "runtime_url": rt_url, "runtime_bytes": meta["bytes"],
                                      "validation": {k: meta[k] for k in ("version", "meshes", "materials", "textures", "animations")}}
            print(f"[wired] {slug} -> {t['slot']} master={asset['meta']['bytes']//1048576}MB runtime={meta['bytes']//1048576}MB")
        except Exception as e:  # noqa: BLE001
            report["models"][slug] = {**t, "store_error": str(e)[:300]}
            print(f"[store-fail] {slug}: {e}")

    report["credits"]["balance_end"] = await balance()
    if report["credits"]["balance_start"] and report["credits"]["balance_end"]:
        report["credits"]["consumed_this_batch"] = report["credits"]["balance_start"] - report["credits"]["balance_end"]
    json.dump(report, open(REPORT, "w"), indent=1)
    print("REPORT ->", REPORT)
    print("BATCH COMPLETE")

asyncio.run(main())
