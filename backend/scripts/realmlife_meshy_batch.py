"""RealmLife AAA Meshy batch generator.

Idempotent: reruns skip slots that already have a stored GLB in asset_library
(context.project == realmlife_aaa). Preview -> refine (PBR) -> store.
Run:  python scripts/realmlife_meshy_batch.py [--batch batch1] &
Logs: /app/artifacts/realmlife_aaa/<batch>.log
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from services import meshy_provider as mp  # noqa: E402

USER = {"id": "founder-script", "username": "realmlife-aaa-batch"}
ART_DIR = "/app/artifacts/realmlife_aaa"
os.makedirs(ART_DIR, exist_ok=True)

STYLE = (
    "AAA game-ready asset, clean silhouette, PBR materials, "
    "optimized low poly, no floating parts, upright orientation"
)

BATCH1 = [
    # family, slot, prompt, target_polycount
    ("nexus", "nexus_hero_tower",
     "Futuristic curved glass social hub tower, sleek white and dark panels, cyan neon accent light strips, landscaped plaza base, sci-fi hero architecture", 25000),
    ("nexus", "nexus_portal_gate",
     "Futuristic circular portal gateway arch, glowing cyan energy ring frame, brushed metal sci-fi structure on a stone plinth base", 12000),
    ("nexus", "nexus_arcade_pavilion",
     "Futuristic arcade pavilion building, curved sweeping roof, neon pink and cyan trim, glass storefront front", 15000),
    ("nexus", "nexus_transit_station",
     "Modern futuristic transit station, curved glass canopy roof, elevated platform, steel arches", 18000),
    ("residential", "house_med_villa_a",
     "Mediterranean Spanish villa, two story, white stucco walls, terracotta clay tile roof, arched windows, dark wooden door, small iron balcony", 12000),
    ("residential", "house_med_villa_b",
     "Mediterranean coastal house, two story, cream stucco, red clay tile roof, front porch with columns, shuttered windows", 12000),
    ("residential", "house_med_villa_c",
     "Large luxury Mediterranean mansion, two story, ornate arched entrance, clay tile roof, colonnade, attached garage", 15000),
    ("residential", "house_med_small_a",
     "Small cozy Mediterranean cottage, single story, white stucco, terracotta tile roof, wooden shutters, flower boxes", 8000),
    ("residential", "house_med_small_b",
     "Small Spanish style bungalow house, single story, sand colored stucco, clay tile roof, arched doorway", 8000),
    ("residential", "house_med_pool",
     "Mediterranean backyard swimming pool, blue water, stone deck, two lounge chairs and umbrella", 6000),
    ("business", "biz_cafe",
     "Charming street cafe storefront building, striped awning, outdoor bistro seating, warm glowing windows, blank sign board", 12000),
    ("business", "biz_restaurant",
     "Upscale waterfront restaurant building, large glass windows, terrace dining deck, warm interior glow", 14000),
    ("business", "biz_grocery",
     "Neighborhood grocery market storefront, produce stands under awning, blank sign board", 12000),
    ("business", "biz_nightclub",
     "Modern nightclub building exterior, dark facade, neon magenta trim lines, marquee entrance", 12000),
    ("marina", "boat_speed",
     "Modern speedboat, white fiberglass hull with blue trim, windshield, rear outboard motor", 6000),
    ("marina", "boat_sail",
     "Sailboat with raised white sails, wooden deck, small cabin", 6000),
    ("marina", "boat_yacht",
     "Luxury motor yacht, white hull, two decks, radar mast, rear swim platform", 10000),
    ("landscape", "tree_palm",
     "Tropical palm tree, gently curved trunk, detailed green fronds", 3000),
    ("landscape", "tree_cypress",
     "Mediterranean cypress tree, tall slender dark green conical foliage", 2000),
    ("landscape", "prop_fountain",
     "Stone plaza fountain, circular two tier, carved basin with water", 5000),
]

BATCHES = {"batch1": BATCH1}


def log(f, msg):
    line = f"[{datetime.now(timezone.utc).isoformat()}] {msg}"
    print(line, flush=True)
    f.write(line + "\n")
    f.flush()


async def poll_until_done(db, workflow, task_id, f, label, timeout_s=1500):
    start = asyncio.get_event_loop().time()
    while True:
        t = await mp.poll_task(db, workflow, task_id)
        st = t.get("status")
        if st == "SUCCEEDED":
            return t
        if st in ("FAILED", "CANCELED"):
            raise RuntimeError(f"{label} {st}: {t.get('task_error')}")
        if asyncio.get_event_loop().time() - start > timeout_s:
            raise RuntimeError(f"{label} timeout")
        await asyncio.sleep(12)


async def gen_one(db, family, slot, prompt, poly, f):
    existing = await db.asset_library.find_one(
        {"context.project": "realmlife_aaa", "context.slot": slot}, {"_id": 0})
    if existing:
        log(f, f"SKIP {slot} already stored -> {existing['url']}")
        return existing

    full_prompt = f"{prompt}, {STYLE}"
    ctx = {"project": "realmlife_aaa", "family": family, "slot": slot}

    prev = await mp.create_task(db, USER, "text_preview", {
        "mode": "preview", "prompt": full_prompt, "art_style": "realistic",
        "ai_model": "meshy-5", "topology": "triangle",
        "target_polycount": poly, "should_remesh": True,
    }, idem_key=f"realmlife-aaa-v1:{slot}:preview", context=ctx)
    log(f, f"{slot} preview task {prev['task_id']} (replayed={prev['replayed']})")
    pt = await poll_until_done(db, "text_preview", prev["task_id"], f, f"{slot} preview")
    log(f, f"{slot} preview done credits={pt.get('consumed_credits')}")

    ref = await mp.create_task(db, USER, "text_refine", {
        "mode": "refine", "preview_task_id": prev["task_id"], "enable_pbr": True,
    }, idem_key=f"realmlife-aaa-v1:{slot}:refine", context=ctx)
    log(f, f"{slot} refine task {ref['task_id']}")
    rt = await poll_until_done(db, "text_refine", ref["task_id"], f, f"{slot} refine")
    log(f, f"{slot} refine done credits={rt.get('consumed_credits')}")

    asset = await mp.store_glb(db, USER, "text_refine", ref["task_id"],
                               name=f"realmlife_{slot}", context=ctx)
    log(f, f"{slot} STORED {asset['url']} bytes={asset['meta']['bytes']} meshes={asset['meta']['meshes']}")
    return asset


async def main():
    batch = "batch1"
    for i, a in enumerate(sys.argv):
        if a == "--batch" and i + 1 < len(sys.argv):
            batch = sys.argv[i + 1]
    items = BATCHES[batch]

    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    f = open(os.path.join(ART_DIR, f"{batch}.log"), "a")

    h = await mp.health()
    log(f, f"meshy health: {h}")
    if not h.get("ok"):
        log(f, "ABORT: meshy not reachable")
        return

    results, failures = [], []
    sem = asyncio.Semaphore(4)

    async def run(item):
        family, slot, prompt, poly = item
        async with sem:
            try:
                r = await gen_one(db, family, slot, prompt, poly, f)
                results.append({"slot": slot, "url": r["url"]})
            except Exception as e:  # noqa: BLE001
                log(f, f"FAIL {slot}: {e}")
                failures.append({"slot": slot, "error": str(e)})

    await asyncio.gather(*[run(it) for it in items])

    bal = await mp.health()
    summary = {"batch": batch, "stored": results, "failed": failures,
               "balance_after": bal.get("balance"),
               "finished_at": datetime.now(timezone.utc).isoformat()}
    with open(os.path.join(ART_DIR, f"{batch}_result.json"), "w") as rf:
        json.dump(summary, rf, indent=2)
    log(f, f"SUMMARY {json.dumps(summary)}")


if __name__ == "__main__":
    asyncio.run(main())
