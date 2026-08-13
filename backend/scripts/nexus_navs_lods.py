"""NAVS LOD generation (zero credit): for each optimized city runtime produce
LOD2 (simplify 0.12, 512px tex) + LOD3 (simplify 0.05, 256px tex). Adds lod2/lod3 URLs to
world model entities and publishes next version. Masters + LOD1 untouched."""
import asyncio
import copy
import json
import subprocess
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")


def iso():
    return datetime.now(timezone.utc).isoformat()


async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    opt = json.load(open("/app/artifacts/nexus/mobile_optimize.json"))
    city = {k: v for k, v in opt.items() if isinstance(v, dict) and "url" in v and not k.startswith("starter_")}
    lods = {}
    for slug, rec in city.items():
        src = f"/app/artifacts/nexus/mobile_opt/{slug}_simplified.glb"
        out = {}
        for lod, ratio, tex in (("lod2", 0.35, 512), ("lod3", 0.15, 256)):
            mid = f"/tmp/{slug}_{lod}_s.glb"
            dst = f"/tmp/{slug}_{lod}.glb"
            subprocess.run(["npx", "--yes", "@gltf-transform/cli", "simplify", str(src), mid,
                            "--ratio", str(ratio), "--error", "0.01"], check=True, capture_output=True, timeout=300)
            subprocess.run(["npx", "--yes", "@gltf-transform/cli", "optimize", mid, dst,
                            "--compress", "draco", "--texture-size", str(tex), "--simplify", "false"],
                           check=True, capture_output=True, timeout=300)
            raw = open(dst, "rb").read()
            meta = mp.validate_glb(raw)
            fname = meta["checksum"][:32] + ".glb"
            (media_dir("models") / fname).write_bytes(raw)
            try:
                get_storage_adapter().put("models", fname, media_dir("models") / fname)
            except Exception:  # noqa: BLE001
                pass
            url = f"/api/media/models/{fname}"
            await db.asset_library.update_one({"id": meta["checksum"][:32]}, {"$set": {
                "id": meta["checksum"][:32], "kind": "model_glb", "name": f"nexus {slug} ({lod})",
                "url": url, "meta": meta, "provider": "gltf-transform",
                "context": {"project": "nexus", "slot": f"{lod}_{slug}"}}}, upsert=True)
            out[lod] = {"url": url, "kb": len(raw) // 1024}
            print(f"[navs] {slug} {lod}: {len(raw)//1024}KB", flush=True)
        lods[rec["url"]] = out

    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"})
    draft = copy.deepcopy(doc["draft"])
    z = next(zz for zz in draft["zones"] if zz["id"] == "nexus_central")
    tagged = 0
    for e in z["entities"]:
        u = (e.get("props") or {}).get("url")
        if u in lods:
            e["props"]["lod2"] = lods[u]["lod2"]["url"]
            e["props"]["lod3"] = lods[u]["lod3"]["url"]
            tagged += 1
    snap = doc["published_version"]
    await db.nexus_versions.update_one({"world_id": "nexus-v1", "version": snap},
        {"$set": {"world_id": "nexus-v1", "version": snap, "world": doc["published"],
                  "label": f"pre-publish snapshot v{snap}", "created_at": iso()}}, upsert=True)
    await db.nexus_worlds.update_one({"world_id": "nexus-v1"}, {"$set": {
        "draft": draft, "draft_version": doc["draft_version"] + 1,
        "published": draft, "published_version": snap + 1, "updated_at": iso()}})
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": "stealth", "action": "navs_lods",
                                     "detail": {"tagged": tagged, "published_version": snap + 1}, "at": iso()})
    json.dump(lods, open("/app/artifacts/nexus/navs_lods.json", "w"), indent=1)
    print(f"[navs] published v{snap + 1}, tagged {tagged} entities", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
