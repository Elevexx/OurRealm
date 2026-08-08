"""Phase-18 asset ingest: download generated sheets, slice grid -> keyed strip,
store in media dir, register orai_assets, wire into the graybox game spec."""
import asyncio
import os
import sys
import uuid
import io
from datetime import datetime, timezone

import requests
from PIL import Image
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

GID = "9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b01"
J = "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/"

# slot: (url, rows, cols, key_mode, fps, clamp_note)
SHEETS = {
    "hero_master":    (J+"f2adc6fc9b8cf12dee3950e74c53b5ffdcd51ed18bd94b5de9bfa6c529b0e2d4.jpeg", 1, 1, "white", 1),
    "hero_idle":      (J+"e46082d48e32beede41907cc78312d8b861f2410f62859d259635d934aef142e.jpeg", 2, 4, "magenta", 8),
    "hero_run":       (J+"2cb38814ffb78fd5d8a8b22b1dd3657efbe74f27799256c1e52a1097f001f5c2.jpeg", 2, 6, "magenta", 9),
    "hero_jump_rise": (J+"6d6b65908691550cc6517e03dbaacda9786fb316cc3f9216f73b7c330fd3d354.jpeg", 2, 2, "magenta", 10),
    "hero_jump_fall": (J+"3e523213542edcf74cf94c3adc51573b7c2ca9fc153479a615836d455ff06e90.jpeg", 2, 2, "magenta", 8),
    "hero_land":      (J+"fe864ad7498f4fc3dfb87f5fd740a68666ead30bb0e21ef7735d396ab3a607b1.jpeg", 2, 2, "magenta", 20),
    "hero_attack":    (J+"76d55122b1238eca267ce34566fedb7586b1e7dda9de7f216e9e1a30daa65a07.jpeg", 2, 5, "magenta", 30),
    "hero_dash":      (J+"73dc1f802b7e92ddc98e5f1be6e27422b30640216d460778c94b055328ea7be5.jpeg", 2, 4, "magenta", 30),
    "hero_cast":      (J+"5807020df13a5cfd9eb4d93a52a06c057b05d4436441d42f7bc1d1755b0e1146.jpeg", 2, 4, "magenta", 24),
    "hero_hurt":      (J+"a131679e852cab32e018dcc3378077c64290895a57aecbf14b03fbe99fb36627.jpeg", 2, 2, "magenta", 10),
    "hero_death":     (J+"61944a5e439479b992b84f4f1d76c063d25386265b9260b40978739061b8d7e4.jpeg", 2, 4, "magenta", 9),
    "hero_climb":     (J+"0ffc2f1bf2776289513465d0b46e7db2565397c5557bed7681bc373da754fbea.jpeg", 2, 3, "magenta", 8),
    "portal_active":  (J+"cf0ddd7e145aefa3ec17692898ba91ff3f0bcfa8df2bb50d96a057f9d655a4b6.jpeg", 2, 4, "none", 10),
    "portal_unlocking": (J+"49703bd1f134239c41362a1a9aa1e05d112b98dd82d49babe8619c2a41bd63e8.jpeg", 2, 4, "none", 5),
    "portal_locked":  (J+"cef1d9a5e5dbae9f17cc8aeff534fa0c9cf622759aa8e4ef9233625f6ea5b494.jpeg", 2, 2, "none", 4),
    "portal_frame":   (J+"32ef71beb32cdd7d79f3d9294b1265ba1d1bbac32b916210f32b9e6e1b9a18a9.jpeg", 1, 1, "magenta", 1),
}


def key_out(im, mode):
    im = im.convert("RGBA")
    if mode == "none":
        # floor near-black to pure black so screen-blend hides cell edges
        px = im.load()
        w, h = im.size
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if r < 46 and g < 46 and b < 46:
                    px[x, y] = (0, 0, 0, 255)
        return im
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if mode == "magenta":
                if r > 150 and b > 150 and g < 130 and (r - g) > 60 and (b - g) > 60:
                    px[x, y] = (0, 0, 0, 0)
                elif r > 120 and b > 120 and g < 160 and (r - g) > 30 and (b - g) > 30:
                    px[x, y] = (r, min(g, 80), b, 90)  # feather edge
            else:  # white
                if r > 240 and g > 240 and b > 240:
                    px[x, y] = (0, 0, 0, 0)
    return im


def bbox_alpha(im, mode):
    if mode == "none":
        # bright-content bbox for black-bg sheets
        gray = im.convert("L").point(lambda v: 255 if v > 26 else 0)
        return gray.getbbox()
    return im.split()[3].point(lambda v: 255 if v > 30 else 0).getbbox()


def process(slot, url, rows, cols, mode):
    raw = Image.open(io.BytesIO(requests.get(url, timeout=60).content)).convert("RGB")
    W, H = raw.size
    cw, ch = W // cols, H // rows
    cells = []
    for r in range(rows):
        for c in range(cols):
            cell = raw.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            cell = key_out(cell, mode)
            bb = bbox_alpha(cell, mode)
            if not bb:
                continue
            cells.append(cell.crop(bb))
    if not cells:
        return None
    fw = max(c.width for c in cells) + 8
    fh = max(c.height for c in cells) + 8
    strip = Image.new("RGBA", (fw * len(cells), fh), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        # bottom-center anchor (feet baseline)
        strip.paste(c, (i * fw + (fw - c.width) // 2, fh - c.height - 4), c if c.mode == "RGBA" else None)
    if mode == "none":
        # keep black bg for screen-blend assets
        bg = Image.new("RGBA", strip.size, (0, 0, 0, 255))
        bg.paste(strip, (0, 0), strip)
        strip = bg
    # downscale for web (max frame height 512)
    if fh > 512:
        sc = 512 / fh
        strip = strip.resize((int(strip.width * sc), 512), Image.LANCZOS)
    return strip, len(cells)


async def main():
    from motor.motor_asyncio import AsyncIOMotorClient
    from services.storage import media_dir
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    out_dir = media_dir("images")
    now = datetime.now(timezone.utc).isoformat()
    assets = {}
    for slot, (url, rows, cols, mode, fps) in SHEETS.items():
        res = process(slot, url, rows, cols, mode)
        if not res:
            print("SKIP (empty):", slot)
            continue
        strip, frames = res
        fname = uuid.uuid4().hex + ".png"
        strip.save(os.path.join(str(out_dir), fname), "PNG", optimize=True)
        await db.orai_assets.insert_one({
            "id": uuid.uuid4().hex, "type": "game_asset", "subtype": "spritesheet",
            "title": f"Jungle Nexus — {slot}", "tags": ["action_rpg_2_5d", slot, "spritesheet"],
            "search_keywords": [slot, "jungle", "nexus"], "creator_id": "e3cd1aab-6009-49f8-ac90-62736509699a",
            "creator_username": "stealth", "project_id": None, "game_id": GID,
            "provider": "orai_image_engine", "model": "gemini-3.1-flash-image",
            "prompt": f"phase18 production {slot}", "settings": {"slot": slot},
            "refs": {}, "privacy": "private", "eligibility": "owner_only",
            "moderation_status": "clean", "archived": False, "usage_count": 0,
            "file_name": fname, "created_at": now, "updated_at": now,
        })
        assets[slot] = {"url": f"/api/public/game-assets/{fname}",
                        "meta": {"kind": "spritesheet", "frames": frames, "fps": fps,
                                 "width": strip.width, "height": strip.height,
                                 "blend": "screen" if mode == "none" else "normal"}}
        print(f"OK {slot}: {frames}f {strip.width}x{strip.height} -> {fname}")
    g = await db.games.find_one({"id": GID}, {"_id": 0, "spec.assets": 1})
    merged = {**(g["spec"].get("assets") or {}), **assets}
    await db.games.update_one({"id": GID}, {"$set": {"spec.assets": merged, "updated_at": now}})
    print("wired", len(assets), "assets into", GID)

asyncio.run(main()) if __name__ == "__main__" else None
