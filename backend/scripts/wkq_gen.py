"""WKQ AAA asset generation via founder's OpenAI key (separately authorized).
Retains raw masters in /app/artifacts/wkq/, builds 8K upscaled masters, wires
optimized runtime derivatives into spec.assets. Max 3 paid attempts per asset."""
import io
import os
import sys
import base64
import json

import httpx
import numpy as np
from PIL import Image

CHROMA_HINT = ("isolated on a perfectly flat, solid, uniform pure magenta background "
               "(#FF00FF), nothing else in the background")


def key_out(path):
    """Full-res key: border flood + global chroma-magenta removal + defringe."""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.int16)
    edge = np.concatenate([a[0, :, :3], a[-1, :, :3], a[:, 0, :3], a[:, -1, :3]])
    med = np.median(edge, axis=0)
    match = (np.abs(a[:, :, :3] - med).max(axis=2) < 42)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    magenta = (r > 140) & (b > 140) & (g < r - 55) & (g < b - 55)
    kill = match | magenta
    out = np.asarray(im).copy()
    out[kill, 3] = 0
    # defringe: desaturate magenta cast on remaining semi-magenta halo pixels
    halo = (~kill) & (r > 90) & (b > 90) & (g < r - 25) & (g < b - 25)
    gg = out[:, :, 1].astype(np.int16)
    out[halo, 0] = np.minimum(out[halo, 0], gg[halo] + 30).astype(np.uint8)
    out[halo, 2] = np.minimum(out[halo, 2], gg[halo] + 30).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(path)
    return float(kill.mean())

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

RAW_DIR = "/app/artifacts/wkq/raw"
MASTER_DIR = "/app/artifacts/wkq/master8k"
os.makedirs(RAW_DIR, exist_ok=True)
os.makedirs(MASTER_DIR, exist_ok=True)
KEY = os.environ["OPENAI_API_KEY"]
LEDGER = "/app/artifacts/wkq/attempts.json"
MANIFEST = "/app/artifacts/wkq/manifest.json"


def _ledger():
    try:
        return json.load(open(LEDGER))
    except Exception:
        return {}


def _bump(slug, detail=None):
    d = _ledger()
    d[slug] = d.get(slug, 0) + 1
    json.dump(d, open(LEDGER, "w"), indent=1)
    try:
        import datetime
        man = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else []
        man.append({"slug": slug, "attempt": d[slug], "provider": "openai",
                    "ts": datetime.datetime.utcnow().isoformat(), **(detail or {})})
        json.dump(man, open(MANIFEST, "w"), indent=1)
    except Exception:
        pass
    return d[slug]


def attempts(slug):
    return _ledger().get(slug, 0)


def generate(slug, prompt, size="1024x1024", transparent=False, quality="high",
             ref_paths=None, model=None):
    """One paid attempt. Saves raw PNG to RAW_DIR/slug.png, returns path."""
    n = attempts(slug) + 1
    if n > 3:
        raise RuntimeError(f"{slug}: paid attempt limit (3) exceeded — change strategy")
    model = model or os.environ.get("OPENAI_IMAGE_MODEL_OVERRIDE", "gpt-image-2")
    headers = {"Authorization": f"Bearer {KEY}"}
    if transparent:
        prompt = prompt.rstrip(". \n") + ". The character/object is " + CHROMA_HINT + "."
    if ref_paths:
        files = [("image[]", (os.path.basename(p), open(p, "rb"), "image/png")) for p in ref_paths]
        data = {"model": model, "prompt": prompt[:3900], "size": size, "quality": quality}
        r = httpx.post("https://api.openai.com/v1/images/edits", headers=headers,
                       data=data, files=files, timeout=300)
    else:
        body = {"model": model, "prompt": prompt[:3900], "size": size, "quality": quality,
                "output_format": "png"}
        r = httpx.post("https://api.openai.com/v1/images/generations", headers=headers,
                       json=body, timeout=300)
    if r.status_code >= 400:
        print(f"[gen] {slug} HTTP {r.status_code}: {r.text[:300]}")
    r.raise_for_status()
    _bump(slug, {"model": model, "size": size, "quality": quality,
                 "edit": bool(ref_paths), "task_id": r.json().get("created")})
    b64 = r.json()["data"][0]["b64_json"]
    raw = base64.b64decode(b64)
    path = f"{RAW_DIR}/{slug}.png"
    open(path, "wb").write(raw)
    if transparent:
        frac = key_out(path)
        print(f"[gen] {slug} attempt {n} ok, keyed {round(frac, 2)} -> {path}")
    else:
        print(f"[gen] {slug} attempt {n} ok -> {path} ({len(raw)//1024}KB)")
    return path


def master_8k(slug):
    """High-quality 8K upscale of the approved raw; retained as the master."""
    im = Image.open(f"{RAW_DIR}/{slug}.png")
    scale = 8192 / max(im.size)
    tgt = (round(im.width * scale), round(im.height * scale))
    up = im.resize(tgt, Image.LANCZOS)
    path = f"{MASTER_DIR}/{slug}_8k.png"
    up.save(path, "PNG", optimize=True)
    return path


def runtime_png(slug, max_px=768, trim=True):
    """Optimized runtime derivative from the approved raw (alpha-trimmed)."""
    im = Image.open(f"{RAW_DIR}/{slug}.png").convert("RGBA")
    if trim:
        bbox = im.getchannel("A").getbbox()
        if bbox:
            m = max(4, int(max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 0.03))
            im = im.crop((max(0, bbox[0] - m), max(0, bbox[1] - m),
                          min(im.width, bbox[2] + m), min(im.height, bbox[3] + m)))
    im.thumbnail((max_px, max_px), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "PNG", optimize=True)
    return out.getvalue()


async def wire_slot(game_id, slot, slug, is_sprite=True, max_px=768, trim=None):
    from core.db import db
    from services import image_store
    from services.asset_validator import transparent_fraction, checkerboard_score
    data = runtime_png(slug, max_px=max_px, trim=is_sprite if trim is None else trim)
    if is_sprite:
        tf = transparent_fraction(data)
        if not 0.05 < tf < 0.97:
            return f"{slot}: REJECT transparent_fraction={round(tf, 2)}"
    else:
        if checkerboard_score(data) >= 0.55:
            return f"{slot}: REJECT baked checkerboard"
    founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
    rec = await image_store.save_bytes(data, founder["id"], declared_mime="image/png")
    m8 = master_8k(slug)
    await db.games.update_one({"id": game_id}, {"$set": {f"spec.assets.{slot}": {
        "url": rec.original_url,
        "meta": {"source": "original_generated", "model": "gpt-image (founder key)",
                 "master_8k": m8, "slug": slug}}}})
    return f"{slot}: wired {rec.original_url}"
