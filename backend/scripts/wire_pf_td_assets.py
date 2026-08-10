"""Wire visual-pass assets for Platformer (Crystal Caverns) and Top-Down
(Cyber Heist) demos: flood-key backgrounds (checkerboard / uniform color),
alpha-trim, validate, persist via image_store, wire into spec.assets."""
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
PLAN = {
    "850b4ee4b6ed48899229355aa86d5e9a": {  # Crystal Caverns (platformer)
        "player_sprite": (J + "0834c30e65f0caf42137221e7c99a6d601d98be25e2600776241f18970f68eab.jpeg", True),
        "enemy_sprite": (J + "b18cd16854898b7d22c4703b3e133d915d7cad6e892f1c4c3968ce8cd1c789fa.jpeg", True),
        "background": (J + "17ce3b752e1210746094c82e20b0b0993f48a5a2a8727707531050e9e0823ab6.jpeg", False),
    },
    "af6cab00d0d2406892d8bcb0b419e234": {  # Cyber Heist (top_down)
        "player_sprite": (J + "85a9b49395f8437a854d87182741a4d90cec124886517a64ba92cc2180038069.jpeg", True),
        "enemy_sprite": (J + "84868c4ee2bee68bef1ffdf796ec963cf024cab4c62b240a42634a50558dc108.jpeg", True),
        "background": (J + "d1b7b6605c3f1784f1cba1be49dbc9345af9ce61bd520058233225da5e7508ca.jpeg", False),
    },
}


def _is_checker_gray(p):
    r, g, b = p[:3]
    return abs(r - g) < 16 and abs(g - b) < 16 and abs(r - b) < 16 and 60 < (r + g + b) / 3 < 252


def key_background(raw: bytes) -> bytes:
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    im.thumbnail((768, 768))
    w, h = im.size
    px = im.load()
    edge = [px[x, y] for x in range(0, w, 7) for y in (0, h - 1)] + \
           [px[x, y] for y in range(0, h, 7) for x in (0, w - 1)]
    checker = sum(1 for p in edge if _is_checker_gray(p)) / len(edge) > 0.5
    if checker:
        match = _is_checker_gray
    else:
        n = len(edge)
        er = sorted(p[0] for p in edge)[n // 2]
        eg = sorted(p[1] for p in edge)[n // 2]
        eb = sorted(p[2] for p in edge)[n // 2]

        def match(p, er=er, eg=eg, eb=eb):
            return abs(p[0] - er) < 34 and abs(p[1] - eg) < 34 and abs(p[2] - eb) < 34
    seen = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if match(px[x, y]) and not seen[y][x]:
                q.append((x, y)); seen[y][x] = True
    for y in range(h):
        for x in (0, w - 1):
            if match(px[x, y]) and not seen[y][x]:
                q.append((x, y)); seen[y][x] = True
    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and match(px[nx, ny]):
                seen[ny][nx] = True
                q.append((nx, ny))
    bbox = im.getchannel("A").getbbox()
    if bbox:
        bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        m = max(4, int(max(bw, bh) * 0.04))
        im = im.crop((max(0, bbox[0] - m), max(0, bbox[1] - m),
                      min(w, bbox[2] + m), min(h, bbox[3] + m)))
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


async def main():
    from core.db import db
    from services import image_store
    from services.asset_validator import transparent_fraction, checkerboard_score
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
    for gid, slots in PLAN.items():
        for slot, (src, is_sprite) in slots.items():
            raw = urllib.request.urlopen(src, timeout=40).read()
            if is_sprite:
                keyed = key_background(raw)
                tf = transparent_fraction(keyed)
                if not 0.12 < tf < 0.97:
                    print(f"{gid[:8]}/{slot}: keying FAILED (transparent {round(tf, 2)}) — SKIPPED")
                    continue
                data, note = keyed, f"bg keyed + trimmed (transparent {round(tf, 2)})"
            else:
                cb = checkerboard_score(raw)
                if cb >= 0.55:
                    print(f"{gid[:8]}/{slot}: background has baked checker ({cb}) — SKIPPED")
                    continue
                data, note = raw, "opaque background, validated"
            rec = await image_store.save_bytes(data, founder["id"], declared_mime="image/png")
            await db.games.update_one({"id": gid}, {"$set": {f"spec.assets.{slot}": {
                "url": rec.original_url,
                "meta": {"source": "original_generated", "model": "gemini-3.1-flash-image", "note": note}}}})
            print(f"{gid[:8]}/{slot}: wired -> {rec.original_url} ({note})")

asyncio.run(main())
