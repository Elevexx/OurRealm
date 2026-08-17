"""Universal Game Asset Library — provider-neutral, runtime-aware asset
records. References existing media storage (image_store / orai_assets refs);
never duplicates files. Collection: game_asset_library."""
import hashlib
import logging
import re
import uuid
from datetime import datetime, timezone

from core.db import db

log = logging.getLogger("ourrealm.asset_library")

LIBRARY_SCHEMA_VERSION = 1

ASSET_CATEGORIES = [
    "character", "enemy", "boss", "npc", "creature", "dragon",
    "tileset", "environment", "building", "prop", "weapon", "spell",
    "visual_effect", "ui_kit", "icon", "sprite_sheet", "animation",
    "model_3d", "material", "texture", "music", "sound_effect", "voice",
    "cinematic", "loading_screen", "logo", "cover_art", "screenshot", "trailer",
]

# legacy game_assets slot keys -> universal category
SLOT_CATEGORY = {
    "player_sprite": "character", "enemy_sprite": "enemy", "boss_sprite": "boss",
    "npc_sprite": "npc", "tileset": "tileset", "background": "environment",
    "battle_scene": "environment", "ui_frame": "ui_kit", "icon_set": "icon",
    "effect_fx": "visual_effect", "character_portrait": "character",
}
KIND_CATEGORY = {"spritesheet": "sprite_sheet", "sprite": "character", "tileset": "tileset",
                 "background": "environment", "ui": "ui_kit", "effect": "visual_effect"}


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _tokens(text) -> set:
    return {w for w in re.findall(r"[a-z0-9]+", str(text or "").lower()) if len(w) > 2}


def fingerprint(storage_ref: dict) -> str:
    basis = str((storage_ref or {}).get("image_id") or (storage_ref or {}).get("url")
                or (storage_ref or {}).get("file_url") or uuid.uuid4().hex)
    return hashlib.sha1(basis.encode()).hexdigest()


def new_record(owner: dict, *, name, category, description="", tags=None, visual_style="",
               dimensions=None, file_format="", source="", provider="", source_project_id=None,
               compatible_runtimes=None, compatible_families=None, animation_states=None,
               preview_url=None, storage_ref=None, usage_rights="owner_only",
               moderation_status="clean") -> dict:
    cat = category if category in ASSET_CATEGORIES else "prop"
    ref = storage_ref or {}
    return {
        "id": uuid.uuid4().hex, "schema_version": LIBRARY_SCHEMA_VERSION,
        "name": str(name or "Untitled asset")[:140],
        "description": str(description or "")[:600],
        "category": cat,
        "tags": [str(t)[:40] for t in (tags or []) if t][:15],
        "visual_style": str(visual_style or "")[:200],
        "dimensions": dimensions or {},
        "file_format": str(file_format or "")[:20],
        "source": str(source or "unknown")[:60],
        "provider": str(provider or "")[:60],
        "source_project_id": source_project_id,
        "compatible_runtimes": [str(r)[:40] for r in (compatible_runtimes or [])][:25],
        "compatible_families": [str(f)[:40] for f in (compatible_families or [])][:25],
        "animation_states": [str(a)[:40] for a in (animation_states or [])][:12],
        "version": 1, "status": "ready",
        "preview_url": preview_url,
        "storage_ref": ref,
        "favorite": False, "usage_count": 0, "last_used_at": None,
        "fingerprint": fingerprint(ref),
        "usage_rights": str(usage_rights)[:200],
        "moderation_status": moderation_status,
        "owner_id": owner["id"], "owner_username": owner.get("username"),
        "archived": False,
        "created_at": _iso(), "updated_at": _iso(),
    }


async def register_asset(owner: dict, **fields) -> dict:
    """Idempotent by fingerprint — re-registering the same storage ref
    updates metadata instead of creating a duplicate record."""
    rec = new_record(owner, **fields)
    existing = await db.game_asset_library.find_one(
        {"owner_id": owner["id"], "fingerprint": rec["fingerprint"]}, {"_id": 0})
    if existing:
        keep = {k: existing[k] for k in ("id", "version", "favorite", "usage_count",
                                         "last_used_at", "created_at") if k in existing}
        merged = {**rec, **keep, "updated_at": _iso()}
        await db.game_asset_library.update_one({"id": existing["id"]}, {"$set": merged})
        return {**merged, "duplicate_of_existing": True}
    await db.game_asset_library.insert_one({**rec})
    return rec


async def search_assets(owner_id: str, q: str = "", category: str = None,
                        runtime: str = None, family: str = None, limit: int = 20,
                        tags: list = None, favorites_only: bool = False,
                        sort: str = "updated") -> list:
    flt = {"owner_id": owner_id, "archived": {"$ne": True},
           "moderation_status": {"$nin": ["rejected", "removed"]}}
    if category and category in ASSET_CATEGORIES:
        flt["category"] = category
    if favorites_only:
        flt["favorite"] = True
    if tags:
        flt["tags"] = {"$in": [str(t)[:40] for t in tags][:8]}
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()[:60]), "$options": "i"}
        flt["$or"] = [{"name": rx}, {"description": rx}, {"tags": rx}, {"visual_style": rx}]
    sort_key = "last_used_at" if sort == "recent" else \
               "usage_count" if sort == "popular" else "updated_at"
    rows = await db.game_asset_library.find(flt, {"_id": 0}).sort(sort_key, -1).to_list(120)
    if runtime:
        rows = [r for r in rows if not r.get("compatible_runtimes") or runtime in r["compatible_runtimes"]]
    if family:
        rows = [r for r in rows if not r.get("compatible_families") or family in r["compatible_families"]]
    return rows[:max(1, min(int(limit), 50))]


async def set_favorite(asset_id: str, owner_id: str, fav: bool) -> bool:
    r = await db.game_asset_library.update_one(
        {"id": asset_id, "owner_id": owner_id},
        {"$set": {"favorite": bool(fav), "updated_at": _iso()}})
    return r.matched_count > 0


async def recent_assets(owner_id: str, limit: int = 12) -> list:
    return await db.game_asset_library.find(
        {"owner_id": owner_id, "archived": {"$ne": True}, "last_used_at": {"$ne": None}},
        {"_id": 0}).sort("last_used_at", -1).to_list(max(1, min(int(limit), 30)))


async def find_duplicates(owner_id: str) -> list:
    """Groups of records sharing a storage fingerprint (duplicate detection)."""
    pipe = [{"$match": {"owner_id": owner_id, "archived": {"$ne": True}}},
            {"$group": {"_id": "$fingerprint", "count": {"$sum": 1},
                        "ids": {"$push": "$id"}, "names": {"$push": "$name"}}},
            {"$match": {"count": {"$gt": 1}}}, {"$limit": 30}]
    return [{"fingerprint": g["_id"], "count": g["count"], "asset_ids": g["ids"],
             "names": g["names"]} async for g in db.game_asset_library.aggregate(pipe)]


def _match_score(asset: dict, req: dict) -> float:
    """Rank suggestions conservatively.

    Category-only similarity is enough to SHOW a suggestion, but never enough
    to auto-wire it. Exact slot tags and explicit runtime compatibility are
    the high-confidence signals used for automatic reuse.
    """
    score = 0.0

    category_match = asset.get("category") == req.get("category")
    if category_match:
        score += 0.35

    tags = {str(t).lower() for t in (asset.get("tags") or []) if t}
    slot = str(req.get("slot") or "").lower()
    slot_match = bool(slot and slot in tags)
    if slot_match:
        score += 0.35

    a_tok = _tokens(" ".join([
        asset.get("name", ""),
        asset.get("description", ""),
        asset.get("visual_style", ""),
        " ".join(asset.get("tags") or []),
    ]))
    r_tok = _tokens(" ".join([
        req.get("description", ""),
        req.get("visual_style", ""),
        req.get("label", ""),
        req.get("slot", ""),
    ]))
    if r_tok:
        score += 0.20 * (len(a_tok & r_tok) / len(r_tok))

    rt = req.get("target_runtime")
    compat = asset.get("compatible_runtimes") or []

    if rt and compat:
        if rt in compat:
            score += 0.10
        else:
            # Explicitly incompatible assets must never become strong matches.
            score *= 0.25

    return round(min(score, 1.0), 3)


def _auto_reuse_safe(asset: dict, req: dict, score: float) -> bool:
    """True only when wiring this asset automatically is deterministic."""
    if asset.get("category") != req.get("category"):
        return False

    slot = str(req.get("slot") or "").lower()
    tags = {str(t).lower() for t in (asset.get("tags") or []) if t}
    if not slot or slot not in tags:
        return False

    rt = req.get("target_runtime")
    compat = asset.get("compatible_runtimes") or []
    if not rt or rt not in compat:
        return False

    return float(score) >= 0.80


async def match_requirement(owner_id: str, req: dict, limit: int = 3) -> list:
    """Search the library BEFORE recommending generation. Returns scored matches."""
    pool = await search_assets(owner_id, category=req.get("category"),
                               runtime=req.get("target_runtime"), limit=50)
    if not pool:  # widen: same category regardless of runtime tag
        pool = await search_assets(owner_id, category=req.get("category"), limit=50)
    scored = sorted(({**a, "match_score": _match_score(a, req)} for a in pool),
                    key=lambda x: x["match_score"], reverse=True)
    return [{
        "asset_id": a["id"],
        "name": a["name"],
        "category": a["category"],
        "preview_url": a.get("preview_url"),
        "visual_style": a.get("visual_style"),
        "match_score": a["match_score"],
        "source": a.get("source"),
        "compatible_runtimes": a.get("compatible_runtimes"),
        "slot_match": bool(
            req.get("slot") and
            str(req.get("slot")).lower() in
            {str(t).lower() for t in (a.get("tags") or []) if t}
        ),
        "runtime_match": bool(
            req.get("target_runtime") and
            req.get("target_runtime") in (a.get("compatible_runtimes") or [])
        ),
        "auto_reuse_safe": _auto_reuse_safe(a, req, a["match_score"]),
    } for a in scored if a["match_score"] >= 0.35][:limit]


async def touch_usage(asset_id: str):
    await db.game_asset_library.update_one(
        {"id": asset_id}, {"$inc": {"usage_count": 1}, "$set": {"last_used_at": _iso()}})


async def backfill_from_orai_assets(owner: dict) -> dict:
    """Index existing orai_assets records into the universal library.
    References the SAME storage — no file duplication. Idempotent."""
    cur = db.orai_assets.find({"creator_id": owner["id"], "archived": {"$ne": True},
                               "type": {"$in": ["game_asset", "image"]}}, {"_id": 0})
    indexed = updated = 0
    async for a in cur:
        refs = a.get("refs") or {}
        slot = (a.get("settings") or {}).get("slot")
        cat = SLOT_CATEGORY.get(slot) or KIND_CATEGORY.get(a.get("subtype")) or \
            ("cover_art" if a.get("type") == "image" else "prop")
        meta = refs.get("meta") or {}
        rec = await register_asset(
            owner, name=a.get("title"), category=cat,
            description=(a.get("prompt") or "")[:400],
            tags=[t for t in (a.get("tags") or []) if t],
            visual_style="", dimensions={k: meta[k] for k in ("width", "height") if k in meta},
            file_format="png", source="orai_assets_backfill",
            provider=a.get("provider") or "", source_project_id=a.get("project_id"),
            compatible_runtimes=[
                t for t in (a.get("tags") or [])
                if t in __import__("services.game_studio", fromlist=["RUNTIMES"]).RUNTIMES
            ][:3],
            preview_url=refs.get("thumb") or a.get("public_url") or refs.get("url"),
            storage_ref={k: refs[k] for k in ("image_id", "url", "thumb") if k in refs} or
                        {"orai_asset_id": a.get("id")},
        )
        if rec.get("duplicate_of_existing"):
            updated += 1
        else:
            indexed += 1
    return {"indexed": indexed, "updated": updated}
