"""Founder Access & Visibility controls for /admin/games + public preview route."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pymongo import ReturnDocument

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import game_access_ctl as gac

router = APIRouter(prefix="/api/admin/games", tags=["game-access"])
public_router = APIRouter(prefix="/api/public/game-preview", tags=["game-preview-public"])


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def _game_or_404(game_id: str) -> dict:
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    return g


@router.get("/access/registry")
async def access_registry(current: CurrentUser):
    """Dynamic mode/badge/progression registries for the Access panel."""
    require_founder(current)
    badges = await db.badge_registry.find({}, {"_id": 0, "key": 1, "name": 1}).to_list(300)
    levels = await db.progression_levels.find(
        {"status": "published"}, {"_id": 0, "id": 1, "name": 1, "level_number": 1}) \
        .sort("level_number", 1).to_list(100)
    return {"modes": [{"key": m, "label": gac.MODE_LABELS[m]} for m in gac.MODES],
            "badges": badges, "levels": levels,
            "flag_keys": list(gac.FLAG_KEYS),
            "audiences": ["all", "teen_only", "adult_only"],
            "public_preview_message": gac.PUBLIC_PREVIEW_MESSAGE,
            "view_only_message": gac.VIEW_ONLY_MESSAGE}


@router.get("/access/user-search")
async def user_search(current: CurrentUser, q: str = ""):
    require_founder(current)
    q = q.strip().lstrip("@")
    if len(q) < 2:
        return {"users": []}
    rows = await db.users.find(
        {"username": {"$regex": f"^{q}", "$options": "i"},
         "account_status": {"$ne": "deleted_pending_restore"}},
        {"_id": 0, "id": 1, "username": 1}).limit(8).to_list(8)
    return {"users": rows}


@router.get("/{game_id}/access")
async def get_access(game_id: str, current: CurrentUser):
    require_founder(current)
    g = await _game_or_404(game_id)
    cfg = gac.get_config(g)
    link = await db.game_preview_links.find_one(
        {"game_id": game_id, "revoked": {"$ne": True}}, {"_id": 0})
    hist = await db.game_access_audit.count_documents({"game_id": game_id})
    return {"access": cfg, "summary": gac.summary_text(cfg),
            "preview_link": link, "history_count": hist,
            "is_legacy": "access" not in g}


@router.put("/{game_id}/access")
async def put_access(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await _game_or_404(game_id)
    raw = body.get("config") or body
    # resolve typed usernames → user ids (accept "@name", trims, dedupes)
    typed = raw.get("usernames")
    if typed is not None:
        names, seen = [], set()
        items = typed.split(",") if isinstance(typed, str) else list(typed)
        for t in items:
            n = str(t).strip().lstrip("@")
            if n and n.lower() not in seen:
                seen.add(n.lower())
                names.append(n)
        resolved, invalid = [], []
        for n in names:
            u = await db.users.find_one({"username": {"$regex": f"^{n}$", "$options": "i"}},
                                        {"_id": 0, "id": 1, "username": 1})
            if u:
                resolved.append({"id": u["id"], "username": u["username"]})
            else:
                invalid.append(n)
        if invalid:
            raise HTTPException(status_code=400, detail={
                "error": "invalid_users", "invalid_users": invalid,
                "message": "These usernames do not exist: " + ", ".join(invalid)})
        raw = {**raw, "users": resolved}
    try:
        cfg = gac.normalize_config(raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    reason = str(body.get("reason") or "").strip()
    prev = gac.get_config(g)
    cfg["updated_at"], cfg["updated_by"] = _iso(), current.get("username")
    await db.games.update_one({"id": game_id}, {"$set": {"access": cfg, "updated_at": _iso()}})
    entry = await gac.audit_change(game_id, current, prev, cfg, reason or "(no reason given)")
    return {"access": cfg, "summary": gac.summary_text(cfg), "audit_id": entry["id"]}


@router.get("/{game_id}/access/audit")
async def access_audit(game_id: str, current: CurrentUser):
    require_founder(current)
    rows = await db.game_access_audit.find(
        {"game_id": game_id}, {"_id": 0}).sort("at", -1).to_list(60)
    return {"audit": rows}


@router.post("/{game_id}/access/rollback")
async def access_rollback(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await _game_or_404(game_id)
    entry = await db.game_access_audit.find_one(
        {"id": body.get("audit_id"), "game_id": game_id}, {"_id": 0})
    if not entry or not entry.get("prev"):
        raise HTTPException(status_code=404, detail="Audit version not found")
    target = {k: v for k, v in entry["prev"].items() if k != "migrated_from_release"}
    try:
        cfg = gac.normalize_config(target)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Stored version invalid: {e}")
    prev = gac.get_config(g)
    cfg["updated_at"], cfg["updated_by"] = _iso(), current.get("username")
    await db.games.update_one({"id": game_id}, {"$set": {"access": cfg, "updated_at": _iso()}})
    await gac.audit_change(game_id, current, prev, cfg,
                           f"Rollback to version {entry['id'][:8]} ({entry['at']})",
                           action="access_rollback")
    return {"access": cfg, "summary": gac.summary_text(cfg)}


@router.post("/{game_id}/access/simulate")
async def access_simulate(game_id: str, body: dict, current: CurrentUser):
    """Safe server-side test bench — never impersonates, nothing is consumed."""
    require_founder(current)
    g = await _game_or_404(game_id)
    if body.get("guest"):
        res = await gac.evaluate(g, None)
        return {"as": "guest", **{k: res[k] for k in ("allowed", "reason", "mode", "label",
                                                      "view_only", "flags", "message", "visible", "trace")}}
    username = str(body.get("username") or "").strip().lstrip("@")
    u = await db.users.find_one({"username": {"$regex": f"^{username}$", "$options": "i"}}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="No user with that username")
    res = await gac.evaluate(g, u)
    return {"as": "@" + u["username"], **{k: res[k] for k in ("allowed", "reason", "mode", "label",
                                                              "view_only", "flags", "message", "visible", "trace")}}


@router.post("/{game_id}/access/preview-link")
async def make_preview_link(game_id: str, current: CurrentUser):
    """Generate (or regenerate — old links are revoked) the Public Preview token."""
    require_founder(current)
    await _game_or_404(game_id)
    await db.game_preview_links.update_many(
        {"game_id": game_id, "revoked": {"$ne": True}},
        {"$set": {"revoked": True, "revoked_at": _iso(), "revoked_by": current.get("username")}})
    doc = {"token": uuid.uuid4().hex, "game_id": game_id,
           "created_by": current.get("username"), "created_at": _iso(),
           "revoked": False, "expires_at": None}
    await db.game_preview_links.insert_one({**doc})
    await gac.audit_change(game_id, current, {}, {"mode": "public_preview_link"},
                           "Public preview link generated/regenerated", action="preview_link_created")
    return {"link": doc, "path": f"/preview/game/{doc['token']}"}


@router.delete("/{game_id}/access/preview-link")
async def revoke_preview_link(game_id: str, current: CurrentUser):
    require_founder(current)
    r = await db.game_preview_links.update_many(
        {"game_id": game_id, "revoked": {"$ne": True}},
        {"$set": {"revoked": True, "revoked_at": _iso(), "revoked_by": current.get("username")}})
    await gac.audit_change(game_id, current, {}, {"mode": "public_preview_link"},
                           "Public preview link revoked", action="preview_link_revoked")
    return {"ok": True, "revoked": r.modified_count}


# ─── Public (no account required) ─────────────────────────────────────────
async def _rate_ok(ip: str, limit: int = 40) -> bool:
    bucket = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    r = await db.preview_ratelimit.find_one_and_update(
        {"key": f"{ip}:{bucket}"}, {"$inc": {"n": 1}, "$setOnInsert": {"at": _iso()}},
        upsert=True, return_document=ReturnDocument.AFTER)
    return int((r or {}).get("n") or 1) <= limit


@public_router.get("/{token}")
async def public_preview(token: str, request: Request):
    ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() \
        or (request.client.host if request.client else "unknown")
    if not await _rate_ok(ip):
        raise HTTPException(status_code=429, detail="Too many requests — try again in a minute")
    link = await db.game_preview_links.find_one(
        {"token": token, "revoked": {"$ne": True}}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="Preview link not found or revoked")
    if link.get("expires_at") and link["expires_at"] < _iso():
        raise HTTPException(status_code=410, detail="Preview link expired")
    g = await db.games.find_one({"id": link["game_id"]}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    cfg = gac.get_config(g)
    if cfg.get("mode") != "public_preview":
        raise HTTPException(status_code=403, detail={
            "reason": "public_preview_disabled",
            "message": "This game is not currently in Public Preview mode."})
    from routers.games_plus import game_controls
    safe = {"id": g["id"], "title": g.get("title"), "runtime": g.get("runtime"),
            "cover_url": gac.resolve_cover(g), "spec": g.get("spec"),
            "controls": game_controls(g), "lives": g.get("lives")}
    return {"game": safe, "message": gac.PUBLIC_PREVIEW_MESSAGE,
            "flags": gac.default_flags("public_preview")}
