"""Reusable demo-asset wiring: flood-key checker/uniform backgrounds,
alpha-trim, validate, persist via image_store, wire into spec.assets.
Import-safe (no side effects). Usage: await wire(plan) where
plan = {game_id: {slot: (source_url, is_sprite)}}"""
import io
import urllib.request
from collections import deque

from PIL import Image


def _is_checker_gray(p):
    r, g, b = p[:3]
    return abs(r - g) < 16 and abs(g - b) < 16 and abs(r - b) < 16 and (r + g + b) / 3 > 60


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


async def wire(plan, debug_dir=None):
    from core.db import db
    from services import image_store
    from services.asset_validator import transparent_fraction, checkerboard_score
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
    results = []
    for gid, slots in plan.items():
        for slot, (src, is_sprite) in slots.items():
            raw = urllib.request.urlopen(src, timeout=40).read()
            if is_sprite:
                data = key_background(raw)
                tf = transparent_fraction(data)
                if not 0.12 < tf < 0.97:
                    results.append((gid, slot, f"KEY-FAILED tf={round(tf, 2)}"))
                    continue
                note = f"bg keyed + trimmed (transparent {round(tf, 2)})"
            else:
                if checkerboard_score(raw) >= 0.55:
                    results.append((gid, slot, "CHECKER-BAKED background rejected"))
                    continue
                data, note = raw, "opaque background, validated"
            if debug_dir:
                Image.open(io.BytesIO(data)).save(f"{debug_dir}/{gid[:8]}_{slot}.png")
            rec = await image_store.save_bytes(data, founder["id"], declared_mime="image/png")
            await db.games.update_one({"id": gid}, {"$set": {f"spec.assets.{slot}": {
                "url": rec.original_url,
                "meta": {"source": "original_generated", "model": "gemini-3.1-flash-image", "note": note}}}})
            results.append((gid, slot, f"wired {rec.original_url} ({note})"))
    return results
