"""V33 visuals publish: store masters+derivatives durable (local + R2 'images'), update
nexus_avatars.thumb/thumbs, write canonical image manifest for the release builder. Idempotent."""
import asyncio, json, shutil, sys
from pathlib import Path
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")

PUB = Path("/tmp/v33/pub")
MANIFEST_IN = PUB / "images_manifest.json"
MANIFEST_OUT = Path("/app/backend/release/nexus_v33_images.json")


async def main():
    from core.db import db
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    adapter = get_storage_adapter()
    md = media_dir("images")
    assets = json.loads(MANIFEST_IN.read_text())
    out = []
    for a in assets:
        rec = {"id": a["id"], "kind": a["kind"], "files": {}}
        for role, f in a["files"].items():
            src = PUB / f["file"]
            dst = md / f["file"]
            if not dst.exists():
                shutil.copyfile(src, dst)
            if not adapter.exists("images", f["file"]):
                adapter.put("images", f["file"], dst)
            durable = adapter.exists("images", f["file"])
            rec["files"][role] = {**f, "url": f"/api/media/images/{f['file']}",
                                  "status": "DURABLE" if durable else "UPLOAD_FAILED"}
            if not durable:
                raise RuntimeError(f"{a['id']} {role} failed durable upload")
        out.append(rec)
        if a["kind"] == "avatar":
            fr = rec["files"]
            thumbs = {k: fr[k]["url"] for k in ("w512", "w1024", "w2048", "avif512", "avif1024", "avif2048", "master8k")}
            await db.nexus_avatars.update_one({"id": a["id"]}, {"$set": {
                "thumb": fr["w1024"]["url"], "thumbs": thumbs, "thumb_gen": "v33-studio-render"}})
            print(f"[v33] {a['id']} thumb -> {fr['w1024']['url']}", flush=True)
        else:
            print(f"[v33] game_art {a['id']} published ({rec['files']['w1024']['url']})", flush=True)
    MANIFEST_OUT.write_text(json.dumps({"release": "nexus-v33-visuals", "images": out}, indent=1))
    print(f"[v33] {sum(len(r['files']) for r in out)} image files durable; manifest -> {MANIFEST_OUT}", flush=True)

asyncio.run(main())
