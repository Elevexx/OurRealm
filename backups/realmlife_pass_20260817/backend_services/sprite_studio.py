"""Sprite Sheet Studio — slice existing sheet assets into runtime-ready
animation manifests. Never generates images; operates on library assets."""
import io
import logging
from datetime import datetime, timezone

import httpx

from core.db import db

log = logging.getLogger("ourrealm.sprite_studio")

ANIMATION_STATES = ["idle", "walk", "run", "jump", "fall", "attack",
                    "cast", "hit", "death", "victory", "special"]
DEFAULT_HITBOX = {"x": 0.2, "y": 0.1, "w": 0.6, "h": 0.85}


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def _load_bytes(storage_ref: dict) -> bytes:
    url = (storage_ref or {}).get("url") or (storage_ref or {}).get("thumb") or ""
    fname = url.rsplit("/", 1)[-1].split("?")[0]
    try:
        from services.image_store import image_dir
        p = image_dir() / fname
        if fname and p.exists():
            return p.read_bytes()
    except Exception:  # noqa: BLE001
        pass
    if not url:
        raise ValueError("Asset has no storage URL to slice")
    candidates = []
    if fname:
        candidates.append(f"http://0.0.0.0:8001/api/public/game-assets/{fname}")
    candidates.append("http://0.0.0.0:8001" + url if url.startswith("/") else url)
    last = None
    async with httpx.AsyncClient(timeout=25) as c:
        for u in candidates:
            try:
                r = await c.get(u, follow_redirects=True)
                r.raise_for_status()
                return r.content
            except Exception as e:  # noqa: BLE001
                last = e
    raise ValueError(f"Could not load asset bytes: {last}")


def _dims(raw: bytes):
    from PIL import Image
    im = Image.open(io.BytesIO(raw))
    return im.width, im.height


def build_manifest(width: int, height: int, *, mode: str, frames: int = None,
                   cols: int = None, rows: int = None, fps: int = 8,
                   animations: list = None, hitbox: dict = None) -> dict:
    """auto: horizontal strip, frame count inferred from aspect ratio unless given.
    manual: explicit cols/rows grid with named row animations."""
    fps = min(max(int(fps or 8), 1), 30)
    if mode == "manual":
        cols = min(max(int(cols or 4), 1), 32)
        rows = min(max(int(rows or 1), 1), 16)
    else:
        cols = min(max(int(frames or max(1, round(width / max(height, 1)))), 1), 32)
        rows = 1
    fw, fh = width // cols, height // rows
    anims = {}
    for a in (animations or []):
        name = str(a.get("name") or "").lower().strip()
        if name not in ANIMATION_STATES:
            continue
        row = min(max(int(a.get("row") or 0), 0), rows - 1)
        n = min(max(int(a.get("frames") or cols), 1), cols)
        anims[name] = {"row": row, "frames": n, "fps": min(max(int(a.get("fps") or fps), 1), 30)}
    if not anims:
        anims["idle"] = {"row": 0, "frames": cols, "fps": fps}
    hb = hitbox or DEFAULT_HITBOX
    hb = {k: min(max(float(hb.get(k, DEFAULT_HITBOX[k])), 0.0), 1.0) for k in ("x", "y", "w", "h")}
    return {"mode": mode, "sheet_width": width, "sheet_height": height,
            "cols": cols, "rows": rows, "frame_width": fw, "frame_height": fh,
            "fps": fps, "animations": anims, "hitbox": hb,
            "supported_states": ANIMATION_STATES, "sliced_at": _iso()}


def runtime_export(asset: dict, manifest: dict) -> dict:
    """spec.assets-compatible entry consumed by the vetted runtimes."""
    ref = asset.get("storage_ref") or {}
    return {"url": asset.get("preview_url") or ref.get("url"),
            "meta": {"kind": "spritesheet", "width": manifest["sheet_width"],
                     "height": manifest["sheet_height"], "frames": manifest["cols"],
                     "fps": manifest["fps"], "frame_width": manifest["frame_width"],
                     "frame_height": manifest["frame_height"],
                     "animations": manifest["animations"], "hitbox": manifest["hitbox"]}}


async def slice_asset(asset_id: str, owner_id: str, params: dict) -> dict:
    asset = await db.game_asset_library.find_one(
        {"id": asset_id, "owner_id": owner_id}, {"_id": 0})
    if not asset:
        raise ValueError("Asset not found in library")
    raw = await _load_bytes(asset.get("storage_ref"))
    width, height = _dims(raw)
    manifest = build_manifest(
        width, height,
        mode="manual" if str(params.get("mode")) == "manual" else "auto",
        frames=params.get("frames"), cols=params.get("cols"), rows=params.get("rows"),
        fps=params.get("fps"), animations=params.get("animations"),
        hitbox=params.get("hitbox"))
    states = sorted(manifest["animations"].keys())
    await db.game_asset_library.update_one({"id": asset_id}, {
        "$set": {"sprite_manifest": manifest, "animation_states": states,
                 "category": "sprite_sheet" if asset["category"] not in
                 ("character", "enemy", "boss", "npc", "creature", "dragon") else asset["category"],
                 "updated_at": _iso()},
        "$inc": {"version": 1}})
    fresh = await db.game_asset_library.find_one({"id": asset_id}, {"_id": 0})
    return {"asset": fresh, "manifest": manifest,
            "runtime_export": runtime_export(fresh, manifest)}
