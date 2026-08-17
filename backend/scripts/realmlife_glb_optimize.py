"""Optimize stored RealmLife AAA GLBs: draco + webp 1K textures.
Updates asset_library url to the optimized derivative (keeps original)."""
import asyncio
import os
import subprocess
import sys

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from services.storage import media_dir  # noqa: E402
from services.storage_adapter import get_storage_adapter  # noqa: E402


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    rows = await db.asset_library.find(
        {"context.project": "realmlife_aaa"}).to_list(500)
    mdir = media_dir("models")
    adapter = get_storage_adapter()

    for r in rows:
        url = r.get("url") or ""
        fname = url.rsplit("/", 1)[-1]
        if fname.endswith("_opt.glb"):
            print(f"skip {r['context']['slot']} already optimized", flush=True)
            continue
        src = mdir / fname
        if not src.exists():
            print(f"MISSING local {fname}", flush=True)
            continue
        out_name = fname.replace(".glb", "_opt.glb")
        out = mdir / out_name
        if not out.exists():
            res = subprocess.run(
                ["npx", "-y", "@gltf-transform/cli", "optimize",
                 str(src), str(out),
                 "--compress", "draco",
                 "--texture-compress", "webp",
                 "--texture-size", "1024"],
                capture_output=True, text=True, timeout=300)
            if res.returncode != 0 or not out.exists():
                print(f"FAIL {fname}: {res.stderr[-200:]}", flush=True)
                continue
        try:
            adapter.put("models", out_name, out)
        except Exception as e:  # noqa: BLE001
            print(f"cloud put warn {out_name}: {e}", flush=True)
        await db.asset_library.update_one(
            {"_id": r["_id"]},
            {"$set": {"url": f"/api/media/models/{out_name}",
                      "meta.bytes_optimized": out.stat().st_size,
                      "original_url": url}})
        print(f"OK {r['context']['slot']}: {src.stat().st_size} -> {out.stat().st_size}",
              flush=True)

asyncio.run(main())
