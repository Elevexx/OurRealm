"""Editable public game URLs — founder-controlled slugs with redirect history.

Permanent game id stays the internal identifier; slugs are public aliases.
/games/{parent_slug}/{game_slug} resolves server-side; old paths redirect.
"""
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import game_access_ctl as gac

router = APIRouter(prefix="/api/admin/games", tags=["game-urls"])
public_router = APIRouter(prefix="/api/public/game-path", tags=["game-path-public"])

RESERVED = {"admin", "api", "create", "edit", "preview", "settings", "login", "signup",
            "account", "undefined", "null", "new", "hub", "play", "id", "static", "assets"}
_indexed = False


def _iso():
    return datetime.now(timezone.utc).isoformat()


def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9-]", "", re.sub(r"[\s_]+", "-", str(s or "").strip().lower()))
    return re.sub(r"-{2,}", "-", s).strip("-")[:60]


async def _ensure_indexes():
    global _indexed
    if _indexed:
        return
    await db.game_urls.create_index("full_path")
    await db.game_urls.create_index("game_id")
    await db.game_urls.create_index([("parent_slug", 1), ("game_slug", 1)])
    _indexed = True


async def _availability(parent: str, slug: str, game_id: str) -> dict:
    if not parent or not slug:
        return {"available": False, "reason": "Both slugs are required"}
    if parent in RESERVED or slug in RESERVED:
        return {"available": False, "reason": "Reserved path"}
    taken = await db.game_urls.find_one(
        {"full_path": f"/games/{parent}/{slug}", "active": True, "game_id": {"$ne": game_id}})
    if taken:
        return {"available": False, "reason": "Already used by another game"}
    return {"available": True, "reason": "Available"}


def _public_meta(g: dict, acc: dict, canonical: str | None, *, include_spec: bool) -> dict:
    spec = g.get("spec") or {}
    meta = {"id": g["id"], "title": g.get("title"), "cover_url": gac.resolve_cover(g),
            "description": spec.get("description"), "genre": g.get("genre"),
            "canonical": canonical or f"/games?play={g['id']}",
            "access_mode": acc["mode"], "access_label": acc["label"],
            "guest_allowed": bool(acc["allowed"]), "message": acc["message"]}
    if include_spec and acc["allowed"]:
        from routers.games_plus import game_controls
        meta["spec"] = spec
        meta["controls"] = game_controls(g)
        meta["flags"] = acc["flags"]
    return meta


@router.get("/url-availability")
async def url_availability(current: CurrentUser, parent: str = "", slug: str = "", game_id: str = ""):
    require_founder(current)
    return {**(await _availability(slugify(parent), slugify(slug), game_id)),
            "parent_slug": slugify(parent), "game_slug": slugify(slug),
            "full_path": f"/games/{slugify(parent)}/{slugify(slug)}"}


@router.get("/{game_id}/url")
async def get_url(game_id: str, current: CurrentUser):
    require_founder(current)
    cur = await db.game_urls.find_one({"game_id": game_id, "active": True}, {"_id": 0})
    hist = await db.game_urls.find({"game_id": game_id, "active": False}, {"_id": 0}) \
        .sort("updated_at", -1).to_list(30)
    return {"url": cur, "history": hist}


@router.put("/{game_id}/url")
async def set_url(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    await _ensure_indexes()
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "id": 1, "title": 1})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    parent, slug = slugify(body.get("parent_slug")), slugify(body.get("game_slug"))
    avail = await _availability(parent, slug, game_id)
    if not avail["available"]:
        raise HTTPException(status_code=400, detail=avail["reason"])
    old = await db.game_urls.find_one({"game_id": game_id, "active": True})
    full = f"/games/{parent}/{slug}"
    if old and old.get("full_path") == full:
        return {"url": {k: v for k, v in old.items() if k != "_id"}, "unchanged": True}
    version = int((old or {}).get("version") or 0) + 1
    if old:  # keep for redirects
        await db.game_urls.update_one({"_id": old["_id"]},
                                      {"$set": {"active": False, "replaced_at": _iso()}})
    doc = {"id": uuid.uuid4().hex, "game_id": game_id, "parent_slug": parent,
           "game_slug": slug, "full_path": full, "active": True, "version": version,
           "created_by": current.get("username"), "updated_at": _iso()}
    await db.game_urls.insert_one({**doc})
    await gac.audit_change(game_id, current, {"mode": (old or {}).get("full_path") or "(none)"},
                           {"mode": full}, body.get("reason") or "Public URL updated",
                           action="url_changed")
    return {"url": doc}


@router.post("/{game_id}/url/restore")
async def restore_url(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    old = await db.game_urls.find_one({"id": body.get("url_id"), "game_id": game_id}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="URL version not found")
    return await set_url(game_id, {"parent_slug": old["parent_slug"], "game_slug": old["game_slug"],
                                   "reason": f"Restored previous URL {old['full_path']}"}, current)


@router.delete("/{game_id}/url")
async def disable_url(game_id: str, current: CurrentUser):
    require_founder(current)
    r = await db.game_urls.update_many({"game_id": game_id, "active": True},
                                       {"$set": {"active": False, "replaced_at": _iso()}})
    await gac.audit_change(game_id, current, {}, {"mode": "(custom URL disabled)"},
                           "Custom URL disabled", action="url_disabled")
    return {"ok": True, "disabled": r.modified_count}


# ─── ORAi cover generator (reuses OPC image engine + image store) ──────────
@router.post("/{game_id}/generate-cover")
async def generate_cover(game_id: str, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "id": 1, "title": 1, "spec": 1, "genre": 1})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    from services.orai_images import generate_orai_image
    from services import image_store
    spec = g.get("spec") or {}
    prompt = (f"Video game cover art for '{g['title']}' ({g.get('genre') or spec.get('subject') or 'adventure'} game): "
              f"{(spec.get('description') or '')[:280]} — epic, vibrant, highly detailed digital painting, "
              "dramatic lighting, portrait composition, no text or lettering")
    try:
        raw, model = await generate_orai_image(prompt[:900], None)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cover generation failed: {e}")
    rec = await image_store.save_bytes(raw, current["id"])
    await db.games.update_one({"id": game_id}, {"$set": {"cover_url": rec.original_url, "updated_at": _iso()}})
    await gac.audit_change(game_id, current, {}, {"mode": "cover_generated"},
                           f"ORAi cover generated ({model})", action="cover_generated")
    return {"cover_url": rec.original_url, "model": model}


# ─── Public resolution (no account required; access-gated metadata) ────────
@public_router.get("/id/{game_id}")
async def canonical_for_id(game_id: str):
    cur = await db.game_urls.find_one({"game_id": game_id, "active": True}, {"_id": 0})
    return {"canonical": cur["full_path"] if cur else None}


@public_router.get("/{parent}/{slug}")
async def resolve_path(parent: str, slug: str):
    await _ensure_indexes()
    full = f"/games/{slugify(parent)}/{slugify(slug)}"
    rec = await db.game_urls.find_one({"full_path": full, "active": True}, {"_id": 0})
    redirected = False
    if not rec:  # old URL → newest canonical
        hist = await db.game_urls.find_one({"full_path": full, "active": False}, {"_id": 0},
                                           sort=[("updated_at", -1)])
        if not hist:
            raise HTTPException(status_code=404, detail="Game URL not found")
        rec = await db.game_urls.find_one({"game_id": hist["game_id"], "active": True}, {"_id": 0})
        if not rec:
            raise HTTPException(status_code=404, detail="This game URL is no longer available")
        redirected = True
    g = await db.games.find_one({"id": rec["game_id"], "status": "published"}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    acc = await gac.evaluate(g, None)  # guest decision
    cfg_mode = acc["mode"]
    # never leak restricted games through public metadata
    if cfg_mode not in ("published", "public_preview", "preview", "view_only"):
        raise HTTPException(status_code=404, detail="Game not found")
    return {"redirect": rec["full_path"] if redirected else None,
            "game": _public_meta(g, acc, rec["full_path"],
                                 include_spec=(cfg_mode == "public_preview"))}
