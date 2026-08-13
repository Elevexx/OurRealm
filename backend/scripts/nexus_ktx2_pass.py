"""KTX2 MOBILE TEXTURE PASS (zero Meshy credits). For every unique model URL in nexus_central,
derive a KTX2/Basis(etc1s)+draco runtime from the existing runtime derivative (masters untouched),
register in asset_library, add props.ktx2 / props.lod2k to entities, publish v26 with snapshot."""
import asyncio, copy, json, subprocess, sys, uuid
from datetime import datetime, timezone
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")

def iso(): return datetime.now(timezone.utc).isoformat()

def encode(src, dst):
    mid = dst + ".k.glb"
    subprocess.run(["npx", "--yes", "@gltf-transform/cli", "etc1s", src, mid, "--quality", "128"],
                   check=True, capture_output=True, timeout=280)
    subprocess.run(["npx", "--yes", "@gltf-transform/cli", "draco", mid, dst],
                   check=True, capture_output=True, timeout=280)

async def main():
    from core.db import db
    from services import meshy_provider as mp
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    from services import nexus_world as nw
    doc = await db.nexus_worlds.find_one({"world_id": "nexus-v1"})
    draft = copy.deepcopy(doc["draft"])
    z = next(zz for zz in draft["zones"] if zz["id"] == "nexus_central")
    urls = set()
    for e in z["entities"]:
        if e["type"] == "model":
            for k in ("url", "lod2"):
                u = (e.get("props") or {}).get(k)
                if u and u.startswith("/api/media/models/"): urls.add(u)
    print(f"[ktx] {len(urls)} unique GLBs", flush=True)
    mapping = {}
    for u in sorted(urls):
        try:
            src = media_dir("models") / u.split("/")[-1]
            if not src.exists():
                print(f"[ktx] MISSING local {u}", flush=True); continue
            dst = f"/tmp/ktx_{src.name}"
            encode(str(src), dst)
            raw = open(dst, "rb").read()
            meta = mp.validate_glb(raw)
            fname = meta["checksum"][:32] + ".glb"
            (media_dir("models") / fname).write_bytes(raw)
            try: get_storage_adapter().put("models", fname, media_dir("models") / fname)
            except Exception: pass
            ku = f"/api/media/models/{fname}"
            await db.asset_library.update_one({"id": meta["checksum"][:32]}, {"$set": {
                "id": meta["checksum"][:32], "kind": "model_glb", "name": f"ktx2 derivative of {u.split('/')[-1]}",
                "url": ku, "meta": meta, "provider": "derived", "workflow": "ktx2_etc1s",
                "license": "meshy-generated", "owner": "ourrealm",
                "context": {"project": "nexus", "source_url": u}}}, upsert=True)
            mapping[u] = {"ktx2": ku, "kb": meta["bytes"] // 1024}
            print(f"[ktx] {u.split('/')[-1]} -> {fname} {meta['bytes']//1024}KB", flush=True)
        except Exception as e:
            print(f"[ktx] FAILED {u}: {str(e)[:150]}", flush=True)
    changed = 0
    for e in z["entities"]:
        if e["type"] != "model": continue
        p = e["props"]
        if p.get("url") in mapping: p["ktx2"] = mapping[p["url"]]["ktx2"]; changed += 1
        if p.get("lod2") in mapping: p["lod2k"] = mapping[p["lod2"]]["ktx2"]
    z["entities"] = [nw._clean_entity(e) for e in z["entities"]]
    snap = doc["published_version"]
    await db.nexus_versions.update_one({"world_id": "nexus-v1", "version": snap},
        {"$set": {"world_id": "nexus-v1", "version": snap, "world": doc["published"],
                  "label": f"pre-publish snapshot v{snap}", "created_at": iso()}}, upsert=True)
    await db.nexus_worlds.update_one({"world_id": "nexus-v1"}, {"$set": {
        "draft": draft, "draft_version": doc["draft_version"] + 1,
        "published": draft, "published_version": snap + 1, "updated_at": iso()}})
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": "stealth", "action": "ktx2_pass",
                                     "detail": {"converted": len(mapping), "entities_tagged": changed,
                                                "published_version": snap + 1}, "at": iso()})
    json.dump(mapping, open("/app/artifacts/nexus/ktx2_map.json", "w"), indent=1)
    print(f"[ktx] published v{snap + 1}: {len(mapping)} GLBs converted, {changed} entities tagged", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
