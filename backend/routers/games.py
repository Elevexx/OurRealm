"""OurRealm Games routes — founder Game Studio + public games hub."""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import game_studio as gs

log = logging.getLogger("ourrealm.games.routes")
admin = APIRouter(prefix="/api/admin/games", tags=["games-admin"])
public = APIRouter(prefix="/api/games", tags=["games"])


def _iso():
    return datetime.now(timezone.utc).isoformat()


@admin.post("/import-showcase")
async def import_showcase_games(current: CurrentUser):
    """Founder-only, insert-only transfer of the packaged showcase games.
    Never overwrites or modifies an existing game record."""
    require_founder(current)
    import json
    from pathlib import Path
    seed_path = Path(__file__).resolve().parent.parent / "seeds" / "showcase_games.json"
    if not seed_path.exists():
        raise HTTPException(status_code=404, detail="showcase seed file not present in this build")
    games = json.loads(seed_path.read_text())
    inserted, skipped = [], []
    for g in games:
        if not g.get("id"):
            continue
        existing = await db.games.find_one({"id": g["id"]}, {"_id": 1})
        if existing:
            skipped.append(g.get("title"))
            continue
        await db.games.insert_one(dict(g))
        inserted.append(g.get("title"))
    log.info(f"[import-showcase] inserted={len(inserted)} skipped={len(skipped)} by={current.get('username')}")
    return {"inserted": inserted, "skipped": skipped,
            "total_in_seed": len(games)}


# ─── Founder Game Studio ─────────────────────────────────────────────────
@admin.post("/import-batch")
async def import_batch(body: dict, current: CurrentUser):
    """Founder-only, INSERT-ONLY migration endpoint. Copies full game
    documents from another environment. Never updates, replaces or deletes
    an existing record — existing IDs are skipped. `dry_run` reports what
    would happen (incl. duplicate-title warnings) without writing.
    Optional per-game `cover_b64` re-hosts the cover through image_store."""
    require_founder(current)
    games = body.get("games") or []
    dry_run = bool(body.get("dry_run", True))
    if not isinstance(games, list) or len(games) > 100:
        raise HTTPException(status_code=400, detail="games must be a list (max 100)")
    count_before = await db.games.count_documents({})
    existing_ids = {g["id"] async for g in db.games.find({}, {"id": 1})}
    existing_titles = {(g.get("title") or "").strip().lower()
                       async for g in db.games.find({}, {"title": 1})}
    report = {"dry_run": dry_run, "examined": 0, "inserted": 0, "skipped_existing": 0,
              "duplicate_title_warnings": [], "failed": [], "titles_inserted": [],
              "count_before": count_before}
    batch_titles = set()
    for g in games:
        report["examined"] += 1
        gid = str(g.get("id") or "").strip()
        title = str(g.get("title") or "").strip()
        try:
            if not gid or not title or not (g.get("runtime") or g.get("spec")):
                raise ValueError("missing id/title/runtime")
            if gid in existing_ids:
                report["skipped_existing"] += 1
                continue
            tkey = title.lower()
            if tkey in existing_titles or tkey in batch_titles:
                report["duplicate_title_warnings"].append(
                    {"id": gid, "title": title,
                     "note": "same title already exists (different id) — inserted anyway" if not dry_run
                             else "same title already exists (different id)"})
            batch_titles.add(tkey)
            if dry_run:
                report["titles_inserted"].append(title)
                report["inserted"] += 1
                continue
            doc = {k: v for k, v in g.items() if k not in ("_id", "cover_b64", "cover_mime")}
            doc["plays"], doc["saves"] = 0, 0  # never carry preview play data
            doc["migrated_from"] = "preview"
            doc["migrated_at"] = _iso()
            if g.get("cover_b64"):
                import base64
                from services.image_store import save_bytes
                rec = await save_bytes(base64.b64decode(g["cover_b64"]), current["id"],
                                       declared_mime=g.get("cover_mime") or "image/jpeg")
                doc["cover_url"] = rec.original_url
                doc["cover_original_url"] = rec.original_url
            await db.games.insert_one(doc)
            existing_ids.add(gid)
            report["inserted"] += 1
            report["titles_inserted"].append(title)
        except Exception as e:  # noqa: BLE001
            report["failed"].append({"id": gid, "title": title, "error": str(e)[:200]})
    report["count_after"] = await db.games.count_documents({})
    if not dry_run:
        await gs.audit(current, "games_import_batch",
                       detail=f"inserted {report['inserted']}, skipped {report['skipped_existing']}, failed {len(report['failed'])}")
    return report


@admin.get("")
async def studio_overview(current: CurrentUser):
    require_founder(current)
    games = await db.games.find({}, {"_id": 0, "spec": 0, "build_log": 0}).sort("created_at", -1).to_list(100)
    estimates = await db.game_estimates.find(
        {"status": "awaiting_approval"}, {"_id": 0}).sort("created_at", -1).to_list(20)
    settings = await gs.get_studio_settings()
    # Founders always get the full 1-10; the configured access applies to
    # everyone else (wired into the game_creator access policy flow).
    return {"games": games, "pending_estimates": estimates,
            "complexity_levels": gs.COMPLEXITY_LEVELS, "max_complexity": gs.MAX_COMPLEXITY,
            "runtimes": gs.RUNTIMES, "studio_access": settings,
            "allowed_complexity": list(range(1, 11)), "allowed_power": list(range(1, 11))}


@admin.get("/settings")
async def get_studio_access(current: CurrentUser):
    require_founder(current)
    return await gs.get_studio_settings()


@admin.patch("/settings")
async def patch_studio_access(body: dict, current: CurrentUser):
    require_founder(current)
    settings = await gs.get_studio_settings()
    for key in ("complexity_access", "ai_power_access"):
        if key in body and isinstance(body[key], dict):
            cfg = {**settings[key], **{k: body[key][k] for k in ("mode", "min", "max", "levels") if k in body[key]}}
            if cfg.get("mode") not in ("all", "range", "custom"):
                cfg["mode"] = "all"
            settings[key] = cfg
    await db.game_studio_settings.update_one({"_id": "settings"}, {"$set": settings}, upsert=True)
    await gs.audit(current, "game_studio_access_updated",
                   detail=f"complexity={settings['complexity_access']['mode']} power={settings['ai_power_access']['mode']}")
    return settings


@admin.post("/estimate")
async def create_estimate(body: dict, current: CurrentUser):
    require_founder(current)
    from services.access_policy import require_access
    await require_access("game_creator", current, consume=False)
    complexity = min(max(int(body.get("complexity") or 10), 1), 10)
    ai_power = min(max(int(body.get("ai_power") or 10), 1), 10)
    # Founders bypass level access; configured levels gate everyone else
    # once game creation opens beyond founders (policy-driven).
    settings = await gs.get_studio_settings()
    is_founder = True  # require_founder above guarantees it today
    if not is_founder:
        if complexity not in gs.levels_from(settings["complexity_access"]):
            raise HTTPException(status_code=403, detail=f"Complexity level {complexity} is not enabled for your account")
        if ai_power not in gs.levels_from(settings["ai_power_access"]):
            raise HTTPException(status_code=403, detail=f"AI Power level {ai_power} is not enabled for your account")
    if not str(body.get("request") or "").strip():
        raise HTTPException(status_code=400, detail="Describe the game first")
    est = await gs.create_estimate(body, current)
    return {"estimate": est}


@admin.post("/estimate/{est_id}/build")
async def approve_and_build(est_id: str, current: CurrentUser):
    require_founder(current)
    from services.access_policy import require_access
    await require_access("game_creator", current, consume=True)
    est = await db.game_estimates.find_one({"id": est_id}, {"_id": 0})
    if not est or est["status"] != "awaiting_approval":
        raise HTTPException(status_code=404, detail="Estimate not found or already used")
    sim = (est.get("plan") or {}).get("showcase_similarity") or {}
    if sim.get("blocked"):
        raise HTTPException(status_code=400, detail=(
            f"Showcase Diversity Validation blocked this build: {round(sim.get('score', 0) * 100)}% structural overlap "
            f"with \"{sim.get('top_match')}\". Change the runtime, control model or player representation and re-estimate."))
    await gs.audit(current, "game_build_approved", detail=est["plan"].get("title"))
    game = await gs.start_build(est, current)
    return {"game": {k: v for k, v in game.items() if k != "spec"}}


@admin.post("/estimate/{est_id}/cancel")
async def cancel_estimate(est_id: str, current: CurrentUser):
    require_founder(current)
    await db.game_estimates.update_one({"id": est_id, "status": "awaiting_approval"},
                                       {"$set": {"status": "cancelled"}})
    return {"ok": True}


@admin.get("/audit")
async def games_audit(current: CurrentUser):
    require_founder(current)
    rows = await db.game_audit.find({}, {"_id": 0}).sort("at", -1).to_list(100)
    return {"audit": rows}


@admin.get("/{game_id}")
async def game_detail(game_id: str, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    return {"game": g}


@admin.post("/{game_id}/action")
async def game_action(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    action = body.get("action")
    feedback = str(body.get("feedback") or "")[:600]
    if action == "approve":
        if g["status"] != "pending_approval":
            raise HTTPException(status_code=400, detail="Game is not awaiting approval")
        await db.games.update_one({"id": game_id}, {"$set": {
            "status": "approved", "review": {"decided_by": current.get("username"), "at": _iso()},
            "updated_at": _iso()}})
    elif action == "decline":
        await db.games.update_one({"id": game_id}, {"$set": {
            "status": "declined", "review": {"decided_by": current.get("username"), "at": _iso(), "feedback": feedback},
            "updated_at": _iso()}})
    elif action == "publish":
        if g["status"] not in ("approved", "pending_approval"):
            raise HTTPException(status_code=400, detail="Approve the game before publishing")
        from routers.games_plus import game_controls, validate_controls
        cerrs = validate_controls(game_controls(g), g.get("runtime"))
        if cerrs:
            raise HTTPException(status_code=400, detail="Controls validation blocks publishing: " + "; ".join(cerrs[:3]))
        from services.game_platform.asset_wiring import validate_wiring
        vw = validate_wiring(g)
        if vw["publish_blockers"] and not body.get("allow_placeholder_art"):
            raise HTTPException(status_code=400, detail="Required assets missing — publishing blocked: "
                                + ", ".join(vw["publish_blockers"][:6]))
        await db.games.update_one({"id": game_id}, {"$set": {
            "status": "published", "published_at": _iso(),
            "review": {"decided_by": current.get("username"), "at": _iso()}, "updated_at": _iso()}})
    elif action == "unpublish":
        await db.games.update_one({"id": game_id}, {"$set": {"status": "approved", "updated_at": _iso()}})
    elif action == "archive":
        await db.games.update_one({"id": game_id}, {"$set": {"status": "archived", "updated_at": _iso()}})
    elif action == "regenerate":
        if g["status"] not in ("failed", "declined", "pending_approval"):
            raise HTTPException(status_code=400, detail="Nothing to regenerate")
        from services.access_policy import require_access
        await require_access("game_creator", current, consume=True)
        import asyncio
        await db.games.update_one({"id": game_id}, {"$set": {
            "status": "building", "stage": "designing", "error": None,
            "request": g["request"] + (f"\nFounder feedback: {feedback}" if feedback else ""),
            "updated_at": _iso()}})
        asyncio.create_task(gs._run_build(game_id))
    elif action == "delete":
        if g["status"] == "published":
            raise HTTPException(status_code=400, detail="Unpublish before deleting")
        await db.games.delete_one({"id": game_id})
        await db.game_progress.delete_many({"game_id": game_id})
    else:
        raise HTTPException(status_code=400, detail="Unknown action")
    await gs.audit(current, f"game_{action}", game_id, detail=feedback[:120] or g["title"])
    return {"game": await db.games.find_one({"id": game_id}, {"_id": 0, "spec": 0, "build_log": 0}), "ok": True}


# ─── Public games hub ────────────────────────────────────────────────────
@public.get("")
async def games_hub(current: CurrentUser, q: str = "", subject: str = ""):
    from services.access_policy import check_access
    pol = await check_access("games_play", current, consume=False)
    platform_blocked = not pol["allowed"]  # explicit per-game access configs override this gate
    query = {"status": "published"}
    if q:
        query["title"] = {"$regex": q[:60], "$options": "i"}
    if subject:
        query["spec.subject"] = {"$regex": subject[:60], "$options": "i"}
    rows = await db.games.find(query, {"_id": 0, "id": 1, "title": 1, "runtime": 1, "complexity": 1,
                                       "plays": 1, "published_at": 1, "spec.description": 1,
                                       "age_rating": 1, "foryou_post_id": 1,
                                       "spec.subject": 1, "spec.grade_level": 1, "spec.stages": 1,
                                       "cover_url": 1, "genre": 1, "showcase": 1, "fire_economy": 1,
                                       "spec.achievements": 1, "release": 1, "access": 1,
                                       "spec.learning_objective": 1}).sort("published_at", -1).to_list(60)
    from services.game_access_ctl import evaluate, load_user_ctx
    _ctx = await load_user_ctx(current)
    visible_rows = []
    for r in rows:
        has_explicit = isinstance(r.get("access"), dict)
        acc = await evaluate(r, current, _ctx)
        if platform_blocked and not (has_explicit and (acc["allowed"] or acc["visible"])):
            continue  # platform is invite-only; only founder-configured games pass through
        if not (acc["allowed"] or acc["visible"]):
            continue
        r["access"] = {"mode": acc["mode"], "label": acc["label"], "allowed": acc["allowed"],
                       "view_only": acc["view_only"], "message": acc["message"]}
        r.pop("release", None)
        visible_rows.append(r)
    rows = visible_rows
    if platform_blocked and not rows:
        raise HTTPException(status_code=403, detail={"reason": "platform_restricted", "message": pol["reason"]})
    from routers.games_plus import fire_econ, econ_preview
    for r in rows:
        econ = fire_econ(r)
        if econ["enabled"] and not econ["paused"]:
            r["fire_max"] = econ_preview(econ, r.get("spec") or {})["max_per_player"]
        else:
            r["fire_max"] = 0
        r.pop("fire_economy", None)
        (r.get("spec") or {}).pop("stages", None)
        (r.get("spec") or {}).pop("achievements", None)
    mine = await db.game_progress.find({"user_id": current["id"]}, {"_id": 0}).sort("last_played", -1).to_list(60)
    visible_ids = {r["id"] for r in rows}
    mine = [m for m in mine if m["game_id"] in visible_ids]
    return {"games": rows, "my_progress": mine}


@public.get("/{game_id}")
async def play_game(game_id: str, current: CurrentUser):
    proj = {"_id": 0, "build_log": 0, "request": 0, "est_cost": 0, "actual_cost": 0, "estimates": 0}
    creator_preview = False
    g = await db.games.find_one({"id": game_id, "status": "published"}, proj)
    if not g:
        from core.permissions import get_admin_role, ROLE_FOUNDER
        if get_admin_role(current) == ROLE_FOUNDER:
            # founders can play approved (unpublished) validation games
            g = await db.games.find_one({"id": game_id, "status": {"$in": ["approved", "published"]}}, proj)
    if not g:
        # creators get a private authenticated preview of their own unpublished games
        g = await db.games.find_one({"id": game_id,
                                     "status": {"$in": ["approved", "pending_approval"]},
                                     "$or": [{"created_by": current["id"]}, {"creator_id": current["id"]}]},
                                    proj)
        if g:
            creator_preview = True
    if not g:
        # course mini-games: playable if not published but user can access the course lesson
        g = await db.games.find_one({"id": game_id, "status": {"$in": ["approved", "published"]},
                                     "course_context.center_id": {"$exists": True}}, proj)
        if not g:
            raise HTTPException(status_code=404, detail="Game not found")
    if creator_preview:
        from routers.games_plus import game_controls
        prog = await db.game_progress.find_one({"game_id": game_id, "user_id": current["id"]}, {"_id": 0})
        g["controls"] = game_controls(g)
        return {"game": g, "progress": prog,
                "access": {"mode": "private_preview", "label": "Private Preview", "view_only": False,
                           "flags": {"fire": False, "keys": False, "saves": True,
                                     "leaderboard": False, "reports": True},
                           "message": "Private Preview — only you (and admins) can play this game "
                                      "until it's published."}}
    if not isinstance(g.get("access"), dict):
        # legacy game with no explicit per-game config — platform-wide gate applies
        from services.access_policy import check_access
        pol = await check_access("games_play", current, consume=False)
        if not pol["allowed"]:
            raise HTTPException(status_code=403, detail={"reason": "platform_restricted",
                                                         "message": pol["reason"]})
    from services.game_access_ctl import evaluate
    acc = await evaluate(g, current)
    if not acc["allowed"]:
        raise HTTPException(status_code=403, detail={"reason": acc["reason"],
                                                     "message": acc["message"] or "You don't have access to this game"})
    prog = await db.game_progress.find_one({"game_id": game_id, "user_id": current["id"]}, {"_id": 0})
    from routers.games_plus import game_controls
    g["controls"] = game_controls(g)
    return {"game": g, "progress": prog,
            "access": {"mode": acc["mode"], "label": acc["label"], "view_only": acc["view_only"],
                       "flags": acc["flags"], "message": acc["message"]}}


@public.post("/{game_id}/progress")
async def save_progress(game_id: str, body: dict, current: CurrentUser):
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "id": 1, "status": 1, "access": 1, "release": 1})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    from services.game_access_ctl import evaluate
    acc = await evaluate(g, current)
    if not acc["allowed"]:
        raise HTTPException(status_code=403, detail={"reason": acc["reason"], "message": acc["message"]})
    if acc["view_only"] or not acc["flags"]["saves"]:
        raise HTTPException(status_code=403, detail={
            "reason": "view_only" if acc["view_only"] else "saves_disabled",
            "message": acc["message"] or "Saves are disabled for this game"})
    score = max(0, int(body.get("score") or 0))
    completed = bool(body.get("completed"))
    prev = await db.game_progress.find_one({"game_id": game_id, "user_id": current["id"]}, {"_id": 0})
    await db.game_progress.update_one(
        {"game_id": game_id, "user_id": current["id"]},
        {"$set": {"username": current.get("username"), "last_score": score,
                  "best_score": max(score, (prev or {}).get("best_score") or 0),
                  "saved_state": (body.get("state") or None), "last_played": _iso(),
                  "game_title": str(body.get("title") or "")[:150]},
         "$inc": {"completions": 1 if completed else 0, "attempts": 1}}, upsert=True)
    await db.games.update_one({"id": game_id}, {"$inc": {"plays": 1}})
    return {"ok": True, "best_score": max(score, (prev or {}).get("best_score") or 0)}


@public.post("/{game_id}/report")
async def report_game(game_id: str, body: dict, current: CurrentUser):
    await db.game_reports.insert_one({
        "id": uuid.uuid4().hex, "game_id": game_id, "user_id": current["id"],
        "username": current.get("username"), "reason": str(body.get("reason") or "")[:400],
        "at": _iso(), "status": "open"})
    await gs.audit(current, "game_reported", game_id, detail=str(body.get("reason") or "")[:100])
    return {"ok": True}
