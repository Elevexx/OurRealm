"""Trim excess transparent padding from wired demo sprite assets so they
render at their intended visual size. Idempotent: skips already-tight sprites."""
import asyncio
import io
import sys
import urllib.request

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")
from PIL import Image  # noqa: E402

GAMES = ["demo-shooter-neon-breach-v1", "demo-owr-emberwild-v1"]


def trim(raw: bytes):
    im = Image.open(io.BytesIO(raw))
    if im.mode != "RGBA":
        return None
    bbox = im.getchannel("A").getbbox()
    if not bbox:
        return None
    w, h = im.size
    bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    if bw * bh > 0.72 * w * h:
        return None  # already tight
    m = max(4, int(max(bw, bh) * 0.04))
    box = (max(0, bbox[0] - m), max(0, bbox[1] - m), min(w, bbox[2] + m), min(h, bbox[3] + m))
    out = io.BytesIO()
    im.crop(box).save(out, "PNG")
    return out.getvalue()


async def main():
    from core.db import db
    from services import image_store
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
    for gid in GAMES:
        g = await db.games.find_one({"id": gid}, {"_id": 0, "spec": 1})
        assets = (g.get("spec") or {}).get("assets") or {}
        for slot, a in assets.items():
            url = a.get("url") or ""
            src = "http://localhost:8001" + url if url.startswith("/") else url
            raw = urllib.request.urlopen(src, timeout=30).read()
            trimmed = trim(raw)
            if not trimmed:
                print(f"{gid}/{slot}: skip (opaque or already tight)")
                continue
            rec = await image_store.save_bytes(trimmed, founder["id"], declared_mime="image/png")
            meta = dict(a.get("meta") or {})
            meta["note"] = (meta.get("note") or "") + "; alpha-trimmed"
            await db.games.update_one({"id": gid}, {"$set": {
                f"spec.assets.{slot}": {"url": rec.original_url, "meta": meta}}})
            print(f"{gid}/{slot}: trimmed -> {rec.original_url}")

asyncio.run(main())
