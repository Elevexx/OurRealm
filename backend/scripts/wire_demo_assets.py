"""One-shot: key out baked checkerboard from generated sprites, persist via
image_store, wire assets into the two Beta runtime demo specs."""
import asyncio
import io
import sys
import urllib.request
from collections import deque

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")
from PIL import Image  # noqa: E402

J = "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/"
SPRITES = {
    "sht_player": J + "e04e629c63cbe5cd9676ee0cdc1115e6eddd68c30607114ecedb1ca567ac6ccc.jpeg",
    "sht_enemy": J + "71e1d3754f039465a0c083ed4b937a35a6f1d01b6214af710e4a988b346a2e02.jpeg",
    "owr_player": J + "8cfa878c78d57e50afb9fcf29226d1d955b9eaa27fbb0b479740897cafbf5661.jpeg",
    "owr_enemy": J + "b65ffffec6459960787f9900ef3f6f3085176e14d64305ac9148e54cc54c1a23.jpeg",
    "owr_npc": J + "37cc56432eb7fd2deb95e59a0e8e86a6c5987d3083431af68d14d0995c3fecee.jpeg",
}
BACKGROUNDS = {
    "sht_arena": J + "8ec97a3c066eec8bd5c82b90feff542cb67a77c8c040601bbdca3df632b5f6ba.jpeg",
    "owr_terrain": J + "b7faf084b7659b0a1b54be215ee73b9217a449a8dc485cde83ff8b0273456acd.jpeg",
}


def _is_checker_gray(p):
    r, g, b = p[:3]
    return abs(r - g) < 14 and abs(g - b) < 14 and abs(r - b) < 14 and 100 < (r + g + b) / 3 < 205


def key_checkerboard(raw: bytes) -> bytes:
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    im.thumbnail((768, 768))
    w, h = im.size
    px = im.load()
    seen = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if _is_checker_gray(px[x, y]):
                q.append((x, y)); seen[y][x] = True
    for y in range(h):
        for x in (0, w - 1):
            if _is_checker_gray(px[x, y]) and not seen[y][x]:
                q.append((x, y)); seen[y][x] = True
    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and _is_checker_gray(px[nx, ny]):
                seen[ny][nx] = True
                q.append((nx, ny))
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


async def main():
    from core.db import db
    from services import image_store
    from services.asset_validator import transparent_fraction, checkerboard_score
    founder = await db.users.find_one({"admin_role": "founder"}, {"_id": 0, "id": 1}) or \
        await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
    urls = {}
    for slug, src in SPRITES.items():
        raw = urllib.request.urlopen(src, timeout=30).read()
        keyed = key_checkerboard(raw)
        tf = transparent_fraction(keyed)
        if not 0.2 < tf < 0.95:
            print(f"{slug}: keying FAILED (transparent fraction {tf}) — skipping")
            continue
        rec = await image_store.save_bytes(keyed, founder["id"], declared_mime="image/png")
        urls[slug] = rec.original_url
        print(f"{slug}: keyed ok (transparent {round(tf,2)}) -> {rec.original_url}")
    for slug, src in BACKGROUNDS.items():
        raw = urllib.request.urlopen(src, timeout=30).read()
        cb = checkerboard_score(raw)
        if cb >= 0.55:
            print(f"{slug}: REJECTED baked checkerboard score {cb}")
            continue
        rec = await image_store.save_bytes(raw, founder["id"], declared_mime="image/jpeg")
        urls[slug] = rec.original_url
        print(f"{slug}: bg ok (cb {cb}) -> {rec.original_url}")
    wiring = {
        "demo-shooter-neon-breach-v1": {
            "player_sprite": urls.get("sht_player"), "enemy_sprite": urls.get("sht_enemy"),
            "background": urls.get("sht_arena")},
        "demo-owr-emberwild-v1": {
            "player_sprite": urls.get("owr_player"), "enemy_sprite": urls.get("owr_enemy"),
            "npc_sprite": urls.get("owr_npc"), "background": urls.get("owr_terrain")},
    }
    for gid, slots in wiring.items():
        assets = {k: {"url": v, "meta": {"source": "original_generated",
                                         "model": "gemini-3.1-flash-image",
                                         "note": "checkerboard keyed out, validated"}}
                  for k, v in slots.items() if v}
        if not assets:
            continue
        await db.games.update_one({"id": gid}, {"$set": {"spec.assets": assets}})
        print(f"{gid}: wired {list(assets.keys())}")

asyncio.run(main())
