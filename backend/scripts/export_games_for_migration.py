"""Export preview games (approved/published) to a migration payload.
Embeds cover bytes (base64) for relative /api/ covers so production can
re-host them. Usage: python export_games_for_migration.py [--include-rttest]
"""
import asyncio
import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
import httpx  # noqa: E402

INCLUDE_RTTEST = "--include-rttest" in sys.argv
BASE = os.environ.get("PREVIEW_BASE_URL", "http://localhost:8001")
TOKEN = os.environ.get("MIGRATION_TOKEN", "")
HDRS = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    out = []
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        async for g in db.games.find({"status": {"$in": ["published", "approved"]}}):
            title = g.get("title") or ""
            if not INCLUDE_RTTEST and (title.startswith("RTTEST") or "(Clone)" in title):
                continue
            g.pop("_id", None)
            g.pop("plays", None)
            g.pop("saves", None)
            cu = g.get("cover_url") or ""
            if cu.startswith("/api/"):
                r = await client.get(f"{BASE}{cu}", headers=HDRS)
                if r.status_code == 200 and len(r.content) > 100:
                    g["cover_b64"] = base64.b64encode(r.content).decode()
                    g["cover_mime"] = r.headers.get("content-type", "image/jpeg")
                else:
                    print(f"WARN cover fetch failed for {title}: {r.status_code}")
            out.append(g)
    path = "/tmp/preview_games_export.json"
    with open(path, "w") as f:
        json.dump({"games": out}, f, default=str)
    print(f"exported {len(out)} games -> {path} ({os.path.getsize(path)//1024} KB)")
    for g in out:
        print(" -", g.get("status"), "|", g["id"][:14], "|", g["title"][:50],
              "| cover:", "embedded" if g.get("cover_b64") else ("url" if g.get("cover_url") else "none"))


asyncio.run(main())
