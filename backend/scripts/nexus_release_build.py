"""CANONICAL NEXUS RELEASE BUILDER (deployment parity, zero credits).
Collects every runtime file referenced by the published world + avatar catalog, verifies/uploads
each to durable R2 storage, and writes the versioned release manifest that ships WITH the code
(/app/backend/release/nexus_release.json). Preview and production both consume this manifest."""
import asyncio, hashlib, json, sys
from datetime import datetime, timezone
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")

RELEASE_ID = "nexus-v29-parity"
WORLD_VERSION_MIN = 28

def iso(): return datetime.now(timezone.utc).isoformat()

async def main():
    from core.db import db
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    adapter = get_storage_adapter()
    md = media_dir("models")
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"}, {"_id": 0, "published": 1, "published_version": 1})
    avatars = await db.nexus_avatars.find({"status": {"$in": ["active", "premium", "archived"]}}, {"_id": 0}).to_list(40)

    files = {}
    def need(url, category, aid=None, lod=None):
        if not url or not url.startswith("/api/media/models/"): return
        fn = url.split("/")[-1]
        e = files.setdefault(fn, {"file": fn, "url": url, "category": category, "refs": 0,
                                  "avatar": aid, "lod": lod, "ktx2": fn and "ktx2" in category})
        e["refs"] += 1

    for zone in doc["published"]["zones"]:
        for e in zone.get("entities", []):
            p = e.get("props") or {}
            need(p.get("url"), "world_model"); need(p.get("lod2"), "world_lod2")
            need(p.get("ktx2"), "world_ktx2"); need(p.get("lod2k"), "world_lod2_ktx2")
    for av in avatars:
        if av.get("status") == "archived": continue
        aid = av["id"]
        need(av.get("rigged_base_url"), "avatar_lod", aid, "lod0")
        for k, u in (av.get("lod_urls") or {}).items(): need(u, "avatar_lod", aid, k)
        for k, u in (av.get("animation_urls") or {}).items(): need(u, "avatar_anim_" + k, aid)

    ok = missing_local = uploaded = failed = 0
    for fn, e in sorted(files.items()):
        f = md / fn
        if not f.exists():
            try:
                import urllib.request
                with urllib.request.urlopen("http://localhost:8001/api/media/models/" + fn, timeout=120) as r:
                    f.write_bytes(r.read())
            except Exception:
                e["status"] = "MISSING_EVERYWHERE"; failed += 1; missing_local += 1
                print("[rel] MISSING", fn, flush=True); continue
        raw = f.read_bytes()
        e["sha256"] = hashlib.sha256(raw).hexdigest()
        e["bytes"] = len(raw)
        try:
            if not adapter.exists("models", fn):
                adapter.put("models", fn, f); uploaded += 1
            if adapter.exists("models", fn): e["status"] = "DURABLE"; ok += 1
            else: e["status"] = "UPLOAD_FAILED"; failed += 1
        except Exception as ex:
            e["status"] = f"ERR {str(ex)[:60]}"; failed += 1

    static_assets = []
    from pathlib import Path
    for rel in ["basis/basis_transcoder.js", "basis/basis_transcoder.wasm", "draco/draco_decoder.wasm",
                "draco/draco_wasm_wrapper.js", "draco/draco_decoder.js"] + \
               [f"nexus/{a['id']}.webp" for a in avatars if a.get("status") != "archived"]:
        p = Path("/app/frontend/public") / rel
        static_assets.append({"path": "/" + rel, "bytes": p.stat().st_size if p.exists() else 0,
                              "status": "BUNDLED" if p.exists() else "MISSING"})

    manifest = {
        "release_id": RELEASE_ID, "version": 29, "built_at": iso(),
        "world_version": max(doc["published_version"], WORLD_VERSION_MIN),
        "world": doc["published"],
        "avatars": [a for a in avatars],
        "files": list(files.values()),
        "static_assets": static_assets,
        "counts": {"runtime_files": len(files), "durable": ok, "uploaded_now": uploaded,
                   "failed": failed, "missing_local": missing_local},
        "decoders": {"draco": "/draco/", "ktx2_transcoder": "/basis/"},
        "meshy_balance_frozen": 3529,
    }
    out = "/app/backend/release/nexus_release.json"
    import os; os.makedirs("/app/backend/release", exist_ok=True)
    json.dump(manifest, open(out, "w"), default=str)
    await db.nexus_release.update_one({"release_id": RELEASE_ID}, {"$set": {
        "release_id": RELEASE_ID, "version": 29, "built_at": manifest["built_at"],
        "counts": manifest["counts"], "world_version": manifest["world_version"]}}, upsert=True)
    print(f"[rel] {RELEASE_ID}: files={len(files)} durable={ok} uploaded_now={uploaded} failed={failed} -> {out}", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
