"""RealmLife avatar batch: image-to-3d -> rig -> store (+thumbnails)."""
import asyncio, base64, io, json, os, sys
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import httpx
from PIL import Image
from motor.motor_asyncio import AsyncIOMotorClient
from services import meshy_provider as mp
from services.storage import media_dir
from services.storage_adapter import get_storage_adapter

USER = {"id": "founder-script", "username": "realmlife-avatar-batch"}
ART = "/app/artifacts/realmlife_avatars"
os.makedirs(ART, exist_ok=True)
R1 = "https://customer-assets-39nsmqrw.emergentagent.net/job_realm-deploy/artifacts/0psu72y6_RL_01.png"
R2 = "https://customer-assets-39nsmqrw.emergentagent.net/job_realm-deploy/artifacts/b0ijpfp7_RL_02.png"
R3 = "https://customer-assets-39nsmqrw.emergentagent.net/job_realm-deploy/artifacts/30biunl8_RL_03.png"

ROSTER = [  # (slot, grid col, row) row-major over RL_03 (6 cols x 3 rows)
    ("cyber_violet_a", 0, 0), ("cyber_violet_b", 1, 0),
    ("street_red_a", 2, 0), ("street_red_b", 3, 0),
    ("wizard_a", 4, 0), ("wizard_b", 5, 0),
    ("astro_a", 0, 1), ("astro_b", 1, 1),
    ("exec_a", 2, 1), ("exec_b", 3, 1),
    ("athlete_a", 4, 1), ("athlete_b", 5, 1),
    ("shadow_a", 0, 2), ("shadow_b", 1, 2),
    ("explorer_a", 2, 2), ("explorer_b", 3, 2),
    ("hero_cape_a", 4, 2), ("hero_cape_b", 5, 2),
]

def log(f, m):
    line = f"[{datetime.now(timezone.utc).isoformat()}] {m}"
    print(line, flush=True); f.write(line + "\n"); f.flush()

def to_data_uri(img):
    buf = io.BytesIO(); img.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

async def poll(db, wf, tid, f, label, timeout=1800):
    start = asyncio.get_event_loop().time()
    while True:
        t = await mp.poll_task(db, wf, tid)
        st = t.get("status")
        if st == "SUCCEEDED": return t
        if st in ("FAILED", "CANCELED"): raise RuntimeError(f"{label} {st}: {t.get('task_error')}")
        if asyncio.get_event_loop().time() - start > timeout: raise RuntimeError(f"{label} timeout")
        await asyncio.sleep(15)

async def gen(db, adapter, slot, data_uri, thumb_img, f):
    ctx = {"project": "realmlife_avatars", "slot": slot}
    if await db.asset_library.find_one({"context.project": "realmlife_avatars", "context.slot": slot}):
        log(f, f"SKIP {slot}"); return
    # thumbnail
    tname = f"rl_avatar_{slot}.png"
    tpath = media_dir("images") / tname
    thumb_img.save(tpath, "PNG")
    try: adapter.put("images", tname, tpath)
    except Exception as e: log(f, f"thumb put warn {e}")
    thumb_url = f"/api/media/images/{tname}"
    # image-to-3d
    task = await mp.create_task(db, USER, "image", {
        "image_url": data_uri, "ai_model": "meshy-5", "topology": "triangle",
        "target_polycount": 15000, "should_texture": True, "enable_pbr": True,
        "should_remesh": True,
    }, idem_key=f"rl-avatar-v1:{slot}:img", context=ctx)
    log(f, f"{slot} img task {task['task_id']}")
    it = await poll(db, "image", task["task_id"], f, f"{slot} img")
    log(f, f"{slot} img done credits={it.get('consumed_credits')}")
    # rig
    rigged = None
    try:
        rig = await mp.create_task(db, USER, "rig", {
            "input_task_id": task["task_id"], "character_height": 1.7,
        }, idem_key=f"rl-avatar-v1:{slot}:rig", context=ctx)
        log(f, f"{slot} rig task {rig['task_id']}")
        rt = await poll(db, "rig", rig["task_id"], f, f"{slot} rig", timeout=1800)
        rigged = rig["task_id"]
        log(f, f"{slot} rig done credits={rt.get('consumed_credits')}")
    except Exception as e:
        log(f, f"{slot} rig FAILED ({e}) — storing static model")
    wf, tid = ("rig", rigged) if rigged else ("image", task["task_id"])
    asset = await mp.store_glb(db, USER, wf, tid, name=f"rl_avatar_{slot}", context=ctx)
    await db.asset_library.update_one({"id": asset["id"]}, {"$set": {
        "meta.thumb_url": thumb_url, "meta.rigged": bool(rigged)}})
    log(f, f"{slot} STORED {asset['url']} rigged={bool(rigged)}")

async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    adapter = get_storage_adapter()
    f = open(os.path.join(ART, "batch.log"), "a")
    async with httpx.AsyncClient(timeout=60) as cx:
        imgs = {}
        for name, url in [("r1", R1), ("r2", R2), ("r3", R3)]:
            imgs[name] = Image.open(io.BytesIO((await cx.get(url)).content)).convert("RGB")
    jobs = [("starter_1", imgs["r1"], imgs["r1"]), ("starter_2", imgs["r2"], imgs["r2"])]
    r3 = imgs["r3"]; cw, ch = r3.width // 6, r3.height // 3
    for slot, cx_, cy in ROSTER:
        crop = r3.crop((cx_ * cw, cy * ch, (cx_ + 1) * cw, (cy + 1) * ch))
        jobs.append((slot, crop, crop))
    sem = asyncio.Semaphore(4)
    fails = []
    async def run(j):
        slot, src, thumb = j
        async with sem:
            try:
                await gen(db, adapter, slot, to_data_uri(src), thumb, f)
            except Exception as e:
                log(f, f"FAIL {slot}: {e}"); fails.append(slot)
    await asyncio.gather(*[run(j) for j in jobs])
    bal = await mp.health()
    log(f, f"DONE fails={fails} balance={bal.get('balance')}")

asyncio.run(main())
