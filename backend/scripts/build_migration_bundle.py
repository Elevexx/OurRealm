"""Build the insert-only production migration bundle from this (preview) DB.

Includes full game docs + their active public URL records + the orai_assets
metadata records (binaries live in shared R2 storage, so metadata is enough).
"""
import asyncio
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
from core.db import db  # noqa: E402

OUT = "/app/backend/data/games_migration_bundle.json"
ASSET_RE = re.compile(r"/api/public/game-assets/([A-Za-z0-9._-]+)")


async def main():
    games = []
    async for g in db.games.find({"status": "published"}):
        g.pop("_id", None)
        g.pop("plays", None)
        names = set(ASSET_RE.findall(json.dumps(g, default=str)))
        assets = []
        for n in names:
            a = await db.orai_assets.find_one({"file_name": n, "type": "game_asset"}, {"_id": 0})
            if a:
                assets.append(a)
        g["_asset_records"] = assets
        url = await db.game_urls.find_one({"game_id": g["id"], "active": True}, {"_id": 0})
        g["_url_record"] = url
        games.append(g)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({"created_at": datetime.now(timezone.utc).isoformat(), "games": games},
                  f, default=str)
    print(f"bundle: {len(games)} games -> {OUT} ({os.path.getsize(OUT)//1024} KB)")
    for g in games:
        print(" -", g["id"][:12], "|", g.get("title", "")[:44], "| assets:", len(g["_asset_records"]),
              "| url:", (g.get("_url_record") or {}).get("full_path"))


asyncio.run(main())
