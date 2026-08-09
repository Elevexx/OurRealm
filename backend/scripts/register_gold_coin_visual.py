"""One-off idempotent registration: the canonical animated gold coin
(cell 0 of the founder collectible sheet used by published Dragon Realm)
becomes the active Coins visual version. No provider generation."""
import asyncio
import io
import sys

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

CANONICAL_ASSET_ID = "58a9475819604948be068969a228e120"
SHEET_FILE = "3be1c0d624b748ed99507e6d19c57775.png"
ASSET_REF = f"orai_asset:{CANONICAL_ASSET_ID}"


async def main():
    from core.db import db
    from services import resource_visuals as rv
    import httpx
    from PIL import Image

    existing = await db.resource_visuals.find_one({"resource_key": "coins", "asset_ref": ASSET_REF})
    if existing:
        print(f"Already registered (id={existing['id']} v{existing['version']} active={existing['active']})")
        if not existing["active"]:
            await rv.activate("coins", existing["id"], "system")
            print("Re-activated.")
    else:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as cl:
            r = await cl.get(f"http://localhost:8001/api/public/game-assets/{SHEET_FILE}")
            r.raise_for_status()
        sheet = Image.open(io.BytesIO(r.content)).convert("RGBA")
        w, h = sheet.size
        cell = sheet.crop((0, 0, w // 4, h // 2))  # cell 0 = coin (idx map in GameRuntime)
        side = max(cell.size)
        sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        sq.paste(cell, ((side - cell.width) // 2, (side - cell.height) // 2), cell)
        buf = io.BytesIO()
        sq.save(buf, format="PNG")
        doc = await rv.create_version(
            "coins", buf.getvalue(), source="reused", created_by="system",
            prompt="Canonical gold coin — founder collectible sheet cell 0 (Dragon Realm published icon_set)",
            provider_cost=0.0, accessibility_label="Gold Coin", asset_ref=ASSET_REF)
        await db.resource_visuals.update_one({"id": doc["id"]}, {"$set": {"animation": "gold-coin"}})
        await rv.activate("coins", doc["id"], "system")
        print(f"Registered + activated coins visual id={doc['id']} v{doc['version']}")

    # Mark the canonical animation on the version + registry (data-driven for all surfaces)
    await db.resource_visuals.update_one({"resource_key": "coins", "asset_ref": ASSET_REF},
                                         {"$set": {"animation": "gold-coin"}})
    await db.resource_registry.update_one({"key": "coins"},
                                          {"$set": {"active_visual.animation": "gold-coin"}})
    reg = await db.resource_registry.find_one({"key": "coins"}, {"_id": 0, "active_visual": 1})
    print("registry.active_visual:", reg["active_visual"])

asyncio.run(main())
