"""Avatar KTX2 runtime pass (zero credit): converts every nexus_avatars lod/animation GLB to
KTX2(etc1s)+draco derivatives and points the catalog at them. Originals stay in asset_library."""
import asyncio, sys
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")
from scripts.nexus_ktx2_pass import encode

async def conv(db, mp, media_dir, adapter, url):
    src = media_dir("models") / url.split("/")[-1]
    if not src.exists():
        import urllib.request
        with urllib.request.urlopen("http://localhost:8001" + url, timeout=120) as r: src.write_bytes(r.read())
    dst = f"/tmp/k_{src.name}"
    encode(str(src), dst)
    raw = open(dst, "rb").read()
    meta = mp.validate_glb(raw)
    fname = meta["checksum"][:32] + ".glb"
    (media_dir("models") / fname).write_bytes(raw)
    try: adapter().put("models", fname, media_dir("models") / fname)
    except Exception: pass
    ku = f"/api/media/models/{fname}"
    await db.asset_library.update_one({"id": meta["checksum"][:32]}, {"$set": {
        "id": meta["checksum"][:32], "kind": "model_glb", "name": f"ktx2 avatar {src.name}", "url": ku,
        "meta": meta, "provider": "derived", "workflow": "ktx2_etc1s", "license": "meshy-generated",
        "owner": "ourrealm", "context": {"project": "nexus", "source_url": url}}}, upsert=True)
    return ku, meta

async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    async for av in db.nexus_avatars.find({"status": {"$in": ["active", "premium"]}}):
        aid = av["id"]; sets = {}
        try:
            lods = av.get("lod_urls") or {}
            for k, u in list(lods.items()):
                if not u or "ktx" in (av.get("ktx_done") or []): continue
                ku, meta = await conv(db, mp, media_dir, get_storage_adapter, u)
                if k == "lod0" and not meta.get("skins"): raise RuntimeError("skin lost in ktx2")
                lods[k] = ku
            anims = av.get("animation_urls") or {}
            for k, u in list(anims.items()):
                ku, meta = await conv(db, mp, media_dir, get_storage_adapter, u)
                if not meta.get("animations"): continue
                anims[k] = ku
            sets = {"lod_urls": lods, "animation_urls": anims, "rigged_base_url": lods.get("lod0", av.get("rigged_base_url")), "ktx2": True}
            await db.nexus_avatars.update_one({"id": aid}, {"$set": sets})
            print(f"[aktx] {aid} OK", flush=True)
        except Exception as e:
            print(f"[aktx] {aid} SKIPPED {str(e)[:120]}", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
