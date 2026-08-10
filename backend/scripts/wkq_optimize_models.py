"""Re-derive all Arcane runtime GLBs from masters with draco+2K (gltf-transform
optimize), validate, store, rewire slots. Also handles the emerald key."""
import asyncio
import json
import os
import subprocess
import sys

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

GID = "wkq-arcane-hearth-3d-v1"
OUT = "/app/artifacts/wkq/models"


async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    rep = json.load(open("/app/artifacts/wkq/meshy_report.json"))
    jobs = [(slug, m["master_url"], m["runtime_url"].split("/")[-1],
             {"pantry_imp": "model_guardian", "maeve": "player_model",
              "npc_chef_base": "model_npc", "mask_guardian": "model_boss",
              "cooking_station": "model_station", "hazard_brazier": "model_hazard",
              "portal_hearth": "model_portal", "env_kit_counter": "model_env_kit",
              "ingredient_set": "model_ingredient"}[slug])
            for slug, m in rep["models"].items() if m.get("master_url")]
    jobs.append(("emerald_key", "/api/media/models/d2ce66282c7d00273b1db69b4554076e.glb",
                 None, "model_key"))
    for slug, master_url, _old, slot in jobs:
        mfile = media_dir("models") / master_url.split("/")[-1]
        if not mfile.exists():
            # emerald key master lives in R2 only; local copy kept in artifacts
            alt = "/app/artifacts/wkq/emerald_key_master.glb"
            mfile = alt if slug == "emerald_key" and os.path.exists(alt) else mfile
        drv = f"{OUT}/{slug}_draco.glb"
        try:
            subprocess.run(["npx", "--yes", "@gltf-transform/cli", "optimize", str(mfile), drv,
                            "--compress", "draco", "--texture-size", "2048"],
                           check=True, capture_output=True, timeout=280)
            raw = open(drv, "rb").read()
            meta = mp.validate_glb(raw)
            fname = meta["checksum"][:32] + ".glb"
            loc = media_dir("models") / fname
            loc.write_bytes(raw)
            try:
                get_storage_adapter().put("models", fname, loc)
            except Exception:  # noqa: BLE001
                pass
            url = f"/api/media/models/{fname}"
            await db.games.update_one({"id": GID}, {"$set": {
                f"spec.assets.{slot}.url": url,
                f"spec.assets.{slot}.meta.runtime_bytes": meta["bytes"],
                f"spec.assets.{slot}.meta.compression": "draco+2K",
                f"spec.assets.{slot}.meta.master_url": master_url}})
            print(f"[opt] {slug} -> {slot}: {meta['bytes']//1048576}MB ({url})")
        except subprocess.CalledProcessError as e:
            print(f"[opt-fail] {slug}: {e.stderr[-200:] if e.stderr else e}")
        except Exception as e:  # noqa: BLE001
            print(f"[opt-fail] {slug}: {e}")
    print("OPTIMIZE DONE")

asyncio.run(main())
