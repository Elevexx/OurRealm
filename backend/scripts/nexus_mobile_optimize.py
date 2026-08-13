"""ZERO-CREDIT mobile optimization pass.
City models: mesh simplify 0.35 + draco + 1K textures. Avatars: draco + 1K textures (NO simplify —
rigs/weights preserved). Masters untouched; outputs stored as NEW media files + asset_library records.
Writes mapping to /app/artifacts/nexus/mobile_optimize.json. Does NOT touch world or avatar registry."""
import asyncio
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

CITY = {
    "canopy_ring": "af24a26ae3c18a56ee544020ee357499.glb",
    "tower_blue": "da16590d1ca173860a7edc775e7e7bbe.glb",
    "tower_green": "1286a8e47fdcf1a862cde9ba314d18a2.glb",
    "orai_tower": "553432310253ff37af54e078ec50e8aa.glb",
    "storefront": "7abaa4c65b7a02b8e4b3ba2ec927da0f.glb",
    "portal_arch": "ba5a9521e6906a96b412962c7b3ba1c2.glb",
}
AVATAR = {
    "starter_m_rig": "acde5fdeb23d3f2bd38db53ef57a2ada.glb",
    "starter_m_walk": "9c4823f971c88d0ee474125430fac724.glb",
    "starter_m_run": "0f9242a00befd06d8a6ca689c0b3b99e.glb",
    "starter_f_rig": "4809d6f3faf71a7e7f36a84036cd952b.glb",
    "starter_f_walk": "72a0285b3fcdc10cd361b01716855c77.glb",
    "starter_f_run": "427f33ee91e4fb19db666f913600d3c6.glb",
}
BASE = "http://localhost:8001/api/media/models/"
WORK = Path("/app/artifacts/nexus/mobile_opt")
WORK.mkdir(parents=True, exist_ok=True)


def fetch(fname: str) -> Path:
    from services.storage import media_dir
    local = media_dir("models") / fname
    if local.exists():
        return local
    dst = WORK / fname
    if not dst.exists():
        req = urllib.request.Request(BASE + fname)
        with urllib.request.urlopen(req) as r, open(dst, "wb") as f:
            f.write(r.read())
    return dst


def run(cmd, timeout=420):
    r = subprocess.run(cmd, capture_output=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[:400])


async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    out = {}
    jobs = [(slug, f, True) for slug, f in CITY.items()] + [(slug, f, False) for slug, f in AVATAR.items()]
    for slug, fname, is_city in jobs:
        try:
            src = fetch(fname)
            before = src.stat().st_size
            dst = WORK / f"{slug}_mobile.glb"
            if is_city:
                mid = WORK / f"{slug}_simplified.glb"
                run(["npx", "--yes", "@gltf-transform/cli", "simplify", str(src), str(mid),
                     "--ratio", "0.35", "--error", "0.001"])
                run(["npx", "--yes", "@gltf-transform/cli", "optimize", str(mid), str(dst),
                     "--compress", "draco", "--texture-size", "1024", "--simplify", "false"])
            else:
                run(["npx", "--yes", "@gltf-transform/cli", "optimize", str(src), str(dst),
                     "--compress", "draco", "--texture-size", "1024", "--simplify", "false"])
            raw = dst.read_bytes()
            meta = mp.validate_glb(raw)
            if not is_city and (meta.get("skins", 0) < 1):
                out[slug] = {"error": f"optimized copy lost skin: {meta}"}
                print(f"[opt] {slug} REJECTED (skin lost)", flush=True)
                continue
            new_name = meta["checksum"][:32] + ".glb"
            (media_dir("models") / new_name).write_bytes(raw)
            try:
                get_storage_adapter().put("models", new_name, media_dir("models") / new_name)
            except Exception:  # noqa: BLE001
                pass
            url = f"/api/media/models/{new_name}"
            await db.asset_library.update_one({"id": meta["checksum"][:32]}, {"$set": {
                "id": meta["checksum"][:32], "kind": "model_glb",
                "name": f"nexus {slug} (mobile runtime, zero-credit optimize)",
                "url": url, "meta": meta, "provider": "gltf-transform",
                "source_file": fname, "context": {"project": "nexus", "slot": f"mobile_{slug}"}}}, upsert=True)
            out[slug] = {"src": fname, "url": url, "before_kb": before // 1024, "after_kb": len(raw) // 1024,
                         "skins": meta.get("skins"), "animations": meta.get("animations")}
            print(f"[opt] {slug}: {before//1024}KB -> {len(raw)//1024}KB {url}", flush=True)
        except Exception as e:  # noqa: BLE001
            out[slug] = {"error": str(e)[:300]}
            print(f"[opt] {slug} FAILED {str(e)[:200]}", flush=True)
    json.dump(out, open("/app/artifacts/nexus/mobile_optimize.json", "w"), indent=1)
    print("[opt] complete", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
