"""Universal Game Asset Studio — runtime-aware manifests, prompt suggestions,
estimates with cost ceiling, metered generation jobs (semaphore-bound),
sprite/spritesheet/tileset processing (magenta chroma-key -> alpha),
versioning, library records, and runtime assembly (spec.assets map).
Reuses: orai_images, image_store, orai_assets library, game_studio audit.
"""
import asyncio
import base64
import io
import logging
import uuid
from datetime import datetime, timezone

from core.db import db

log = logging.getLogger("ourrealm.game_assets")

GEN_SEMAPHORE = asyncio.Semaphore(2)   # controlled concurrency
STALE_MINUTES = 15                     # stale-job cleanup window
# NOTE: no startup job resumption by design — interrupted jobs are marked
# stale on next read and must be retried explicitly.

ART_QUALITY = {
    1: {"label": "Standard", "cost": 0.04, "suffix": "clean game art"},
    2: {"label": "Detailed", "cost": 0.05, "suffix": "highly detailed polished game art, rich shading"},
    3: {"label": "Premium", "cost": 0.07, "suffix": "premium AAA-quality game art, intricate detail, dramatic lighting"},
}

CANVAS_ARCADE = ["top_down", "platformer", "dodge_collect"]

SLOTS = {
    "player_sprite": {"label": "Player Sprite", "kind": "spritesheet", "transparent": True,
                      "anim": {"frames": 4, "fps": 6}, "required": True,
                      "hint": "4-frame horizontal sprite sheet strip of the player character"},
    "enemy_sprite": {"label": "Enemy Sprite", "kind": "sprite", "transparent": True, "required": True,
                     "hint": "single enemy/hazard creature sprite"},
    "boss_sprite": {"label": "Boss Sprite", "kind": "sprite", "transparent": True, "required": False,
                    "hint": "large intimidating boss creature sprite"},
    "npc_sprite": {"label": "NPC Sprite", "kind": "sprite", "transparent": True, "required": False,
                   "hint": "friendly NPC character sprite"},
    "tileset": {"label": "Tileset", "kind": "tileset", "transparent": False, "required": True,
                "tile": {"cols": 4, "rows": 4},
                "hint": "seamless 4x4 grid tile sheet with 16 equal square terrain tiles"},
    "background": {"label": "Background", "kind": "background", "transparent": False, "required": False,
                   "hint": "wide parallax game background scene"},
    "battle_scene": {"label": "Battle Scene", "kind": "background", "transparent": False, "required": False,
                     "hint": "dramatic battle backdrop scene"},
    "ui_frame": {"label": "UI Frame / HUD", "kind": "ui", "transparent": True, "required": True,
                 "hint": "game HUD frame border panel, ornate edges, empty center"},
    "icon_set": {"label": "Icon Set", "kind": "ui", "transparent": True, "required": False,
                 "hint": "grid of 8 matching game UI icons"},
    "effect_fx": {"label": "Visual Effect", "kind": "effect", "transparent": True, "required": True,
                  "hint": "glowing energy burst spell effect"},
    "character_portrait": {"label": "Character Portrait", "kind": "sprite", "transparent": False, "required": False,
                           "hint": "character portrait bust"},
}

PROFILES = {
    "canvas_arcade": ["player_sprite", "enemy_sprite", "boss_sprite", "tileset",
                      "background", "ui_frame", "effect_fx"],
    "narrative": ["character_portrait", "enemy_sprite", "boss_sprite", "npc_sprite",
                  "battle_scene", "background", "ui_frame", "effect_fx"],
    "ui_based": ["background", "ui_frame", "icon_set", "character_portrait"],
}
NARRATIVE_RT = ["rpg", "quiz_adventure", "story", "adventure", "card", "tower_defense", "deckbuilder"]


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _fname(url: str) -> str:
    return (url or "").rsplit("/", 1)[-1]


def public_asset_url(original_url: str) -> str:
    """Sandboxed game iframes can't send credentials — serve game art
    through the public, filename-validated game-assets route."""
    return f"/api/public/game-assets/{_fname(original_url)}"


def profile_for(runtime: str) -> str:
    rt = (runtime or "").lower()
    if rt in CANVAS_ARCADE:
        return "canvas_arcade"
    if any(k in rt for k in NARRATIVE_RT):
        return "narrative"
    return "ui_based"


def build_manifest(game: dict) -> dict:
    prof = profile_for(game.get("runtime"))
    state = (game.get("asset_manifest") or {}).get("slots") or {}
    slots = []
    for key in PROFILES[prof]:
        d = SLOTS[key]
        st = state.get(key) or {}
        # required slots block "polished" status; canvas_arcade renderer consumes these live
        slots.append({
            "key": key, "label": d["label"], "kind": d["kind"],
            "transparent": d["transparent"], "required_for_polished": d["required"],
            "anim": d.get("anim"), "tile": d.get("tile"),
            "status": st.get("status") or "placeholder",
            "current": st.get("current"), "versions": st.get("versions") or [],
            "renderer_integrated": prof == "canvas_arcade" or key in ("background", "ui_frame"),
        })
    required = [s for s in slots if s["required_for_polished"]]
    ready = [s for s in required if s["status"] == "ready"]
    return {"game_id": game["id"], "runtime": game.get("runtime"), "profile": prof,
            "slots": slots,
            "cover": {"status": "ready" if game.get("cover_url") else "missing",
                      "url": game.get("cover_url"), "workflow": "existing_cover_panel"},
            "art_status": "polished" if required and len(ready) == len(required) else "placeholder",
            "required_ready": len(ready), "required_total": len(required)}


def suggest_prompt(game: dict, slot_key: str) -> str:
    d = SLOTS.get(slot_key) or {}
    spec = game.get("spec") or {}
    theme = (spec.get("visual_theme") or {})
    env = theme.get("environment") or spec.get("environment") or ""
    genre = game.get("genre") or ""
    style = theme.get("art_style") or "vibrant 2D game art"
    bits = [d.get("hint", slot_key), f"for the game '{game.get('title')}'"]
    if genre:
        bits.append(f"genre: {genre}")
    if env:
        bits.append(f"setting: {env}")
    desc = (game.get("description") or "")[:160]
    if desc:
        bits.append(f"game premise: {desc}")
    bits.append(f"style: {style}")
    if d.get("transparent"):
        bits.append("isolated on a pure solid magenta #FF00FF background, no shadow, no ground")
    if d.get("kind") == "tileset":
        bits.append("perfect 4x4 grid, 16 equal square tiles, top row = walkable ground/floor variants, "
                    "second row = walls/obstacles, third row = decorations, bottom row = hazards, "
                    "crisp tile borders, no labels")
    if d.get("anim"):
        bits.append(f"exactly {d['anim']['frames']} equal animation frames side by side in one horizontal strip, "
                    "same character in a walk/idle cycle, consistent size per frame")
    return ", ".join(bits)


def estimate_pack(game: dict, slot_keys: list, art_quality: int) -> dict:
    q = ART_QUALITY.get(min(max(int(art_quality or 1), 1), 3))
    manifest = build_manifest(game)
    valid = {s["key"] for s in manifest["slots"]}
    items = []
    for k in slot_keys:
        if k not in valid:
            continue
        items.append({"slot": k, "label": SLOTS[k]["label"], "cost": q["cost"],
                      "source": "configured_internal_estimate"})
    total = round(sum(i["cost"] for i in items), 3)
    return {"items": items, "total": total, "art_quality": q["label"],
            "suggested_ceiling": round(total * 1.5, 2),
            "disclaimer": "Internal configured estimate per generated image — actual provider usage may vary."}


# ── Image processing (memory-safe: ≤ ~2MP sources) ──────────────────
def _chroma_key(raw: bytes) -> bytes:
    """Magenta (#FF00FF-ish) -> transparent PNG."""
    from PIL import Image
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    if im.width > 1536:
        im.thumbnail((1536, 1536))
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if r > 150 and b > 150 and g < 110 and abs(r - b) < 90:
                px[x, y] = (0, 0, 0, 0)
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


def _square_pad(raw: bytes, size: int = 1024) -> bytes:
    from PIL import Image
    im = Image.open(io.BytesIO(raw))
    im.thumbnail((size, size))
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


def _asset_meta(slot_key: str, width: int, height: int) -> dict:
    d = SLOTS[slot_key]
    meta = {"kind": d["kind"], "width": width, "height": height}
    if d.get("anim"):
        meta["frames"] = d["anim"]["frames"]
        meta["fps"] = d["anim"]["fps"]
    if d.get("tile"):
        cols, rows = d["tile"]["cols"], d["tile"]["rows"]
        meta["tile"] = {
            "cols": cols, "rows": rows,
            "tile_w": width // cols, "tile_h": height // rows,
            # walkability contract: row0 walkable ground, row1 solid walls,
            # row2 walkable decoration, row3 hazard (editable later)
            "walkable": [True] * cols + [False] * cols + [True] * cols + [False] * cols,
            "collision": ["none"] * cols + ["solid"] * cols + ["none"] * cols + ["hazard"] * cols,
        }
    return meta


# ── Slot mutation + runtime assembly ─────────────────────────────────
async def set_slot_asset(game_id: str, slot_key: str, entry: dict, actor: dict, *, source: str):
    """Push a version + set current + assemble into spec.assets (runtime map)."""
    version = {**entry, "at": _iso(), "by": actor.get("username"), "source": source}
    game = await db.games.find_one({"id": game_id})
    slots = (game.get("asset_manifest") or {}).get("slots") or {}
    st = slots.get(slot_key) or {"versions": []}
    st["versions"] = ([version] + (st.get("versions") or []))[:10]
    st["current"] = version
    st["status"] = "ready"
    slots[slot_key] = st
    assets = dict(((game.get("spec") or {}).get("assets")) or {})
    assets[slot_key] = {"url": entry["url"], "meta": entry.get("meta") or {}}
    manifest_after = build_manifest({**game, "asset_manifest": {"slots": slots}})
    await db.games.update_one({"id": game_id}, {"$set": {
        "asset_manifest.slots": slots,
        "spec.assets": assets,
        "art_status": manifest_after["art_status"],
        "updated_at": _iso()}})
    return version


async def rollback_slot(game_id: str, slot_key: str, version_index: int, actor: dict):
    game = await db.games.find_one({"id": game_id})
    slots = (game.get("asset_manifest") or {}).get("slots") or {}
    st = slots.get(slot_key) or {}
    versions = st.get("versions") or []
    if not 0 <= version_index < len(versions):
        raise ValueError("Version not found")
    target = versions[version_index]
    return await set_slot_asset(game_id, slot_key,
                                {k: target[k] for k in ("url", "meta", "asset_id") if k in target},
                                actor, source=f"rollback_v{version_index}")


async def save_library_record(actor, game, slot_key, rec, meta, prompt, provider_model):
    doc = {
        "id": uuid.uuid4().hex, "type": "game_asset", "subtype": SLOTS[slot_key]["kind"],
        "title": f"{game.get('title')} — {SLOTS[slot_key]['label']}"[:140],
        "tags": [game.get("runtime"), slot_key, SLOTS[slot_key]["kind"]],
        "search_keywords": [game.get("genre") or "", slot_key],
        "creator_id": actor["id"], "creator_username": actor.get("username"),
        "project_id": None, "game_id": game["id"],
        "provider": "orai_image_engine", "model": provider_model,
        "prompt": prompt[:800], "settings": {"slot": slot_key},
        "refs": {"image_id": rec.id, "url": rec.original_url, "thumb": rec.thumbnail_url, "meta": meta},
        "privacy": "private", "eligibility": "owner_only", "moderation_status": "clean",
        "file_name": _fname(rec.original_url), "public_url": public_asset_url(rec.original_url),
        "archived": False, "usage_count": 0, "created_at": _iso(), "updated_at": _iso(),
    }
    await db.orai_assets.insert_one({**doc})
    return doc


# ── Generation job ───────────────────────────────────────────────────
async def create_job(game: dict, slot_keys: list, art_quality: int, cost_ceiling: float,
                     prompts: dict, actor: dict, idempotency_key: str) -> dict:
    existing = await db.game_asset_jobs.find_one(
        {"game_id": game["id"], "status": {"$in": ["queued", "running"]}}, {"_id": 0})
    if existing:
        # stale cleanup: heartbeat too old -> mark stale, allow new job
        hb = existing.get("heartbeat") or existing.get("created_at")
        stale = (datetime.now(timezone.utc) - datetime.fromisoformat(hb)).total_seconds() > STALE_MINUTES * 60
        if not stale:
            return {**existing, "already_running": True}
        await db.game_asset_jobs.update_one({"id": existing["id"]},
                                            {"$set": {"status": "stale", "finished_at": _iso()}})
    dup = await db.game_asset_jobs.find_one({"idempotency_key": idempotency_key}, {"_id": 0})
    if dup:
        return {**dup, "already_running": dup["status"] in ("queued", "running")}
    est = estimate_pack(game, slot_keys, art_quality)
    job = {"id": uuid.uuid4().hex, "game_id": game["id"], "idempotency_key": idempotency_key,
           "slots": [{"key": k, "status": "queued", "prompt": (prompts.get(k) or suggest_prompt(game, k))[:900]}
                     for k in slot_keys if k in {i["slot"] for i in est["items"]}],
           "art_quality": min(max(int(art_quality or 1), 1), 3),
           "cost_ceiling": float(cost_ceiling), "estimate": est, "spent": 0.0,
           "status": "queued", "error": None, "created_by": actor["id"],
           "created_at": _iso(), "heartbeat": _iso(), "finished_at": None}
    await db.game_asset_jobs.insert_one({**job})
    asyncio.create_task(run_job(job["id"], dict(actor)))
    job.pop("_id", None)
    return job


async def run_job(job_id: str, actor: dict):
    from services.orai_images import generate_orai_image
    from services import image_store
    job = await db.game_asset_jobs.find_one({"id": job_id})
    if not job:
        return
    game = await db.games.find_one({"id": job["game_id"]})
    q = ART_QUALITY[job["art_quality"]]
    spent = float(job.get("spent") or 0)
    await db.game_asset_jobs.update_one({"id": job_id}, {"$set": {"status": "running", "heartbeat": _iso()}})
    try:
        for i, sl in enumerate(job["slots"]):
            if sl.get("status") == "complete":
                continue
            fresh = await db.game_asset_jobs.find_one({"id": job_id}, {"cancel_requested": 1})
            if fresh and fresh.get("cancel_requested"):
                await db.game_asset_jobs.update_one({"id": job_id}, {"$set": {
                    "status": "canceled", "finished_at": _iso()}})
                return
            unit = q["cost"]
            if spent + unit > job["cost_ceiling"] + 1e-9:
                await db.game_asset_jobs.update_one({"id": job_id, "slots.key": sl["key"]},
                                                    {"$set": {"slots.$.status": "skipped_ceiling"}})
                continue
            await db.game_asset_jobs.update_one({"id": job_id, "slots.key": sl["key"]},
                                                {"$set": {"slots.$.status": "generating", "heartbeat": _iso()}})
            try:
                prompt = f"{sl['prompt']}, {q['suffix']}"
                async with GEN_SEMAPHORE:
                    raw, model = await generate_orai_image(prompt[:980])
                if SLOTS[sl["key"]]["transparent"]:
                    raw = await asyncio.to_thread(_chroma_key, raw)
                else:
                    raw = await asyncio.to_thread(_square_pad, raw, 1536)
                rec = await image_store.save_bytes(raw, actor["id"], declared_mime="image/png")
                meta = _asset_meta(sl["key"], rec.width, rec.height)
                lib = await save_library_record(actor, game, sl["key"], rec, meta, prompt, model)
                await set_slot_asset(game["id"], sl["key"],
                                     {"url": public_asset_url(rec.original_url), "meta": meta, "asset_id": lib["id"]},
                                     actor, source="generated")
                spent = round(spent + unit, 3)
                await db.game_asset_jobs.update_one({"id": job_id, "slots.key": sl["key"]}, {"$set": {
                    "slots.$.status": "complete", "slots.$.url": rec.original_url,
                    "slots.$.asset_id": lib["id"], "spent": spent, "heartbeat": _iso()}})
            except Exception as e:  # noqa: BLE001
                log.warning("asset gen failed %s/%s: %s", job["game_id"], sl["key"], e)
                await db.game_asset_jobs.update_one({"id": job_id, "slots.key": sl["key"]}, {"$set": {
                    "slots.$.status": "failed", "slots.$.error": str(e)[:200], "heartbeat": _iso()}})
        final = await db.game_asset_jobs.find_one({"id": job_id})
        st = [s["status"] for s in final["slots"]]
        status = "completed" if all(s == "complete" for s in st) else \
                 "partially_completed" if any(s == "complete" for s in st) else "failed"
        await db.game_asset_jobs.update_one({"id": job_id}, {"$set": {"status": status, "finished_at": _iso()}})
        from services.game_studio import audit
        await audit(actor, "game_assets_generated", job["game_id"],
                    detail=f"{sum(1 for s in st if s == 'complete')}/{len(st)} assets, ${spent}", cost=spent)
    except Exception as e:  # noqa: BLE001
        log.warning("asset job %s crashed: %s", job_id, e)
        await db.game_asset_jobs.update_one({"id": job_id}, {"$set": {
            "status": "failed", "error": str(e)[:250], "finished_at": _iso()}})
