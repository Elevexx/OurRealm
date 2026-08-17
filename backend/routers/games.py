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
    from services.quality_profile import apply_founder_max
    _qp = apply_founder_max({"complexity": body.get("complexity"), "ai_power": body.get("ai_power")}, current)
    complexity = min(max(int(_qp.get("complexity") or 10), 1), 10)
    ai_power = min(max(int(_qp.get("ai_power") or 10), 1), 10)
    body["founder_max_quality"] = _qp["founder_max_quality"]
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


@public.put("/{game_id}/state")
async def save_game_state(game_id: str, body: dict, current: CurrentUser):
    """Persist long-lived runtime state without counting a new play/attempt.

    Used by simulation-style runtimes that autosave frequently.
    """
    g = await db.games.find_one(
        {"id": game_id},
        {"_id": 0, "id": 1, "title": 1, "status": 1, "access": 1, "release": 1},
    )
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")

    from services.game_access_ctl import evaluate
    acc = await evaluate(g, current)

    if not acc["allowed"]:
        raise HTTPException(
            status_code=403,
            detail={"reason": acc["reason"], "message": acc["message"]},
        )

    if acc["view_only"] or not acc["flags"]["saves"]:
        raise HTTPException(
            status_code=403,
            detail={
                "reason": "view_only" if acc["view_only"] else "saves_disabled",
                "message": acc["message"] or "Saves are disabled for this game",
            },
        )

    state = body.get("state")
    if state is not None and not isinstance(state, dict):
        raise HTTPException(status_code=422, detail="state must be an object")

    now = _iso()

    await db.game_progress.update_one(
        {"game_id": game_id, "user_id": current["id"]},
        {
            "$set": {
                "username": current.get("username"),
                "saved_state": state,
                "last_played": now,
                "game_title": str(body.get("title") or g.get("title") or "")[:150],
            },
            "$setOnInsert": {
                "last_score": 0,
                "best_score": 0,
                "completions": 0,
                "attempts": 0,
            },
        },
        upsert=True,
    )

    return {"ok": True, "saved_at": now}



async def _realmlife_access(
    game_id: str,
    current: CurrentUser,
):
    g = await db.games.find_one(
        {"id": game_id},
        {
            "_id": 0,
            "id": 1,
            "status": 1,
            "runtime": 1,
            "spec.runtime": 1,
            "access": 1,
            "release": 1,
        },
    )

    if not g:
        raise HTTPException(
            status_code=404,
            detail="Game not found",
        )

    runtime = (
        (g.get("spec") or {}).get("runtime")
        or g.get("runtime")
    )

    if runtime != "life_sim_3d":
        raise HTTPException(
            status_code=400,
            detail=(
                "RealmLife economy is only "
                "available to life_sim_3d."
            ),
        )

    from services.game_access_ctl import evaluate

    acc = await evaluate(g, current)

    if not acc["allowed"]:
        raise HTTPException(
            status_code=403,
            detail={
                "reason": acc["reason"],
                "message": acc["message"],
            },
        )

    if acc["view_only"]:
        raise HTTPException(
            status_code=403,
            detail={
                "reason": "view_only",
                "message": (
                    "RealmLife Fire Power "
                    "requires playable access."
                ),
            },
        )

    from services import realmlife_environment as rlenv

    await rlenv.assert_play_allowed(
        game_id,
        current,
    )

    return g


@public.get("/{game_id}/realmlife/account")
async def realmlife_account(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_economy as rle

    account = await rle.account_status(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    account["housing"] = await rlp.ensure_housing(
        game_id,
        current,
    )

    return account


@public.get("/{game_id}/realmlife/aaa-assets")
async def realmlife_aaa_assets(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    rows = await db.asset_library.find(
        {"context.project": "realmlife_aaa"},
        {"_id": 0, "context": 1, "url": 1, "meta.bytes": 1},
    ).to_list(500)

    return {
        "assets": [
            {
                "slot": r["context"].get("slot"),
                "family": r["context"].get("family"),
                "url": r.get("url"),
                "bytes": (r.get("meta") or {}).get("bytes"),
            }
            for r in rows
            if (r.get("context") or {}).get("slot") and r.get("url")
        ]
    }


@public.post("/{game_id}/realmlife/vault-transfer")
async def realmlife_vault_transfer(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_economy as rle

    return await rle.transfer_from_vault(
        game_id,
        current,
        body.get("amount"),
        body.get("idempotency_key"),
    )



@public.post("/{game_id}/realmlife/vault-withdraw")
async def realmlife_vault_withdraw(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_economy as rle

    return await rle.withdraw_to_vault(
        game_id,
        current,
        body.get("amount"),
        body.get("idempotency_key"),
    )


@public.post("/{game_id}/realmlife/build-burn")
async def realmlife_build_burn(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_economy as rle

    result = await rle.burn_for_build(
        game_id,
        current,
        body.get("item_id"),
        body.get("idempotency_key"),
    )

    # Every successful home Build/Buy burn is permanently
    # attributed to the contributor + current property.
    burned = int(
        result.get("burned")
        or result.get("cost")
        or 0
    )

    if burned > 0:
        from services import realmlife_property as rlp

        await rlp.record_property_contribution(
            game_id,
            current,
            amount=burned,
            kind="build_buy",
            source_id=body.get("item_id"),
            idempotency_key=body.get(
                "idempotency_key"
            ),
        )

    return result



@public.post("/{game_id}/realmlife/action-burn")
async def realmlife_action_burn(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_economy as rle

    return await rle.burn_for_action(
        game_id,
        current,
        body.get("action_id"),
        body.get("idempotency_key"),
    )


@public.post("/{game_id}/realmlife/heartbeat")
async def realmlife_heartbeat(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_economy as rle

    return await rle.active_heartbeat(
        game_id,
        current,
        visible=bool(
            body.get("visible")
        ),
        focused=bool(
            body.get("focused")
        ),
        active=bool(
            body.get("active")
        ),
    )



# ============================================================
# REALMLIFE PROPERTY + HOUSEHOLD
# ============================================================


@public.get("/{game_id}/realmlife/housing")
async def realmlife_housing(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.ensure_housing(
        game_id,
        current,
    )



@public.get("/{game_id}/realmlife/property/inbox")
async def realmlife_property_inbox(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.property_inbox(
        game_id,
        current,
    )


@public.post("/{game_id}/realmlife/household/invite")
async def realmlife_household_invite(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.create_household_invite(
        game_id,
        current,
        body.get("target_user_id"),
    )


@public.post("/{game_id}/realmlife/household/request")
async def realmlife_household_request(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.request_household_join(
        game_id,
        current,
        body.get("property_id"),
    )


@public.post("/{game_id}/realmlife/household/invites/{offer_id}/accept")
async def realmlife_household_invite_accept(
    game_id: str,
    offer_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.accept_household_invite(
        game_id,
        current,
        offer_id,
    )


@public.post("/{game_id}/realmlife/household/requests/{offer_id}/approve")
async def realmlife_household_request_approve(
    game_id: str,
    offer_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.approve_household_request(
        game_id,
        current,
        offer_id,
    )


@public.post("/{game_id}/realmlife/household/offers/{offer_id}/decline")
async def realmlife_household_offer_decline(
    game_id: str,
    offer_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.decline_household_offer(
        game_id,
        current,
        offer_id,
    )


@public.post("/{game_id}/realmlife/household/leave")
async def realmlife_household_leave(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.leave_household(
        game_id,
        current,
    )


@public.post("/{game_id}/realmlife/property/access-check")
async def realmlife_property_access_check(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.property_access_check(
        game_id,
        current,
        body.get("property_id"),
    )


@public.post("/{game_id}/realmlife/property/invite")
async def realmlife_property_guest_invite(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.invite_guest(
        game_id,
        current,
        body.get("target_user_id"),
    )


@public.post("/{game_id}/realmlife/property/entry-request")
async def realmlife_property_entry_request(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.request_property_entry(
        game_id,
        current,
        body.get("property_id"),
    )


@public.post("/{game_id}/realmlife/property/entry-requests/{request_id}/approve")
async def realmlife_property_entry_approve(
    game_id: str,
    request_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.resolve_entry_request(
        game_id,
        current,
        request_id,
        True,
    )


@public.post("/{game_id}/realmlife/property/entry-requests/{request_id}/decline")
async def realmlife_property_entry_decline(
    game_id: str,
    request_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.resolve_entry_request(
        game_id,
        current,
        request_id,
        False,
    )


@public.post("/{game_id}/realmlife/property/leave")
async def realmlife_property_leave(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.leave_property(
        game_id,
        current,
        body.get("property_id"),
    )


@public.post("/{game_id}/realmlife/property/evict")
async def realmlife_property_evict(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.evict_guest(
        game_id,
        current,
        body.get("target_user_id"),
    )


@public.post("/{game_id}/realmlife/property/destroy")
async def realmlife_property_destroy(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_property as rlp

    return await rlp.destroy_property(
        game_id,
        current,
        body.get("confirmation"),
    )



# ============================================================
# REALMLIFE V6A SHARED UNIVERSE
# ============================================================


@public.get(
    "/{game_id}/realmlife/world"
)
async def realmlife_world_status(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_world as rlw
    )

    return await rlw.status(
        game_id,
        current,
    )


@public.post(
    "/{game_id}/realmlife/world/presence"
)
async def realmlife_world_presence(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_world as rlw
    )

    return await rlw.presence(
        game_id,
        current,
        body,
    )


@public.post(
    "/{game_id}/realmlife/world/presence/leave"
)
async def realmlife_world_presence_leave(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_world as rlw
    )

    return await (
        rlw.leave_presence(
            game_id,
            current,
        )
    )


# ============================================================
# REALMLIFE ENVIRONMENT + STEALTH FOUNDER CONTROL
# ============================================================



@public.get("/{game_id}/realmlife/player")
async def realmlife_player_state(game_id: str, current: CurrentUser):
    await _realmlife_access(game_id, current)
    from services import realmlife_players as rlp
    from core.permissions import get_admin_role, ROLE_FOUNDER
    from core.db import db as _db
    u = await _db.users.find_one(
        {"id": current["id"]},
        {"_id": 0, "is_founder": 1, "role": 1, "admin_role": 1, "username": 1}) or {}
    founder = bool(
        u.get("is_founder")
        or get_admin_role({**current, **u}) == ROLE_FOUNDER)
    return await rlp.get_state(current["id"], is_founder=founder)


@public.post("/{game_id}/realmlife/player")
async def realmlife_player_create(game_id: str, body: dict, current: CurrentUser):
    await _realmlife_access(game_id, current)
    from services import realmlife_players as rlp
    from core.permissions import get_admin_role, ROLE_FOUNDER
    from core.db import db as _db
    u = await _db.users.find_one(
        {"id": current["id"]},
        {"_id": 0, "is_founder": 1, "role": 1, "admin_role": 1, "username": 1}) or {}
    founder = bool(
        str(u.get("username") or current.get("username") or "").lower() == "stealth"
        and (u.get("is_founder")
             or get_admin_role({**current, **u}) == ROLE_FOUNDER))
    player = await rlp.create_or_update(
        current["id"],
        current.get("username") or "",
        body.get("style"),
        body.get("custom"),
        is_founder=founder)
    return {"ok": True, "player": player}


@public.put("/{game_id}/realmlife/player/customize")
async def realmlife_player_customize(game_id: str, body: dict, current: CurrentUser):
    await _realmlife_access(game_id, current)
    from services import realmlife_players as rlp
    player = await rlp.customize(
        current["id"],
        custom=body.get("custom"),
        style=body.get("style"))
    return {"ok": True, "player": player}


@public.post("/{game_id}/realmlife/player/unlock")
async def realmlife_player_unlock(game_id: str, body: dict, current: CurrentUser):
    await _realmlife_access(game_id, current)
    from services import realmlife_players as rlp
    from core.permissions import get_admin_role, ROLE_FOUNDER
    from core.db import db as _db
    u = await _db.users.find_one(
        {"id": current["id"]},
        {"_id": 0, "is_founder": 1, "role": 1, "admin_role": 1}) or {}
    founder = bool(
        u.get("is_founder")
        or get_admin_role({**current, **u}) == ROLE_FOUNDER)
    return await rlp.unlock(
        current["id"], str(body.get("item_id") or ""), is_founder=founder)


@public.post("/{game_id}/realmlife/player/select")
async def realmlife_player_select(game_id: str, body: dict, current: CurrentUser):
    await _realmlife_access(game_id, current)
    from services import realmlife_players as rlp
    from core.permissions import get_admin_role, ROLE_FOUNDER
    from core.db import db as _db
    u = await _db.users.find_one(
        {"id": current["id"]},
        {"_id": 0, "is_founder": 1, "role": 1, "admin_role": 1, "username": 1}) or {}
    founder = bool(
        str(u.get("username") or current.get("username") or "").lower() == "stealth"
        and (u.get("is_founder")
             or get_admin_role({**current, **u}) == ROLE_FOUNDER))
    return await rlp.select_avatar(
        current["id"], str(body.get("avatar_id") or ""), is_founder=founder)


@public.get("/{game_id}/realmlife/avatar")
async def realmlife_avatar(
    game_id: str,
    current: CurrentUser,
):
    """
    RealmLife uses the authenticated user's Nexus avatar.

    There is NO independent RealmLife avatar selection.

    Stealth Founder receives the private Founder avatar.
    Everyone else receives the same currently equipped Nexus
    avatar already authorized for their account.
    """

    await _realmlife_access(
        game_id,
        current,
    )

    from core.db import db
    from core.permissions import (
        get_admin_role,
        ROLE_FOUNDER,
    )

    user = await db.users.find_one(
        {
            "id":
                current["id"]
        },
        {
            "_id": 0,

            "id": 1,
            "username": 1,

            "is_founder": 1,
            "role": 1,
            "admin_role": 1,

            "nexus_avatar_id": 1,
            "nexus_glow": 1,
        },
    ) or {}

    username = str(
        user.get("username")
        or current.get("username")
        or ""
    ).lower()

    stealth_founder = bool(
        username == "stealth"
        and (
            user.get("is_founder")
            or get_admin_role(
                {
                    **current,
                    **user,
                }
            )
            == ROLE_FOUNDER
        )
    )


    # ---------------------------------------------------------
    # REALMLIFE AVATAR IDENTITY — INDEPENDENT FROM NEXUS.
    #
    # Priority:
    #   Stealth Founder default  -> private Founder body (unchanged)
    #   RealmLife player profile -> starter / premium RealmLife avatar
    #   No profile               -> default RealmLife starter
    # Nexus avatar selection no longer affects RealmLife.
    # ---------------------------------------------------------

    from services.realmlife_players import DEFAULT_CUSTOM as _RL_DEFAULT

    rl_player = await db.realmlife_players.find_one(
        {"user_id": current["id"]},
        {"_id": 0},
    )

    rl_selected = (
        (rl_player or {}).get("selected_avatar")
        or ("founder_stealth" if stealth_founder else "starter")
    )

    if not (stealth_founder and rl_selected == "founder_stealth"):
        # RealmLife GLB avatar (starter_1/2 or premium) if its model is stored
        from services.realmlife_players import TIER_MAP as _RL_TIERS
        from services.realmlife_players import STARTER_MAP as _RL_STARTERS
        from services.realmlife_players import avatar_assets as _rl_assets

        entry = _RL_TIERS.get(rl_selected) or _RL_STARTERS.get(rl_selected)
        if entry:
            assets = await _rl_assets()
            a = assets.get(entry["slot"])
            if a and a.get("url"):
                return {
                    "avatar_id": rl_selected,
                    "label": entry["name"],
                    "model_url": a["url"],
                    "animation_urls": {},
                    "lod_urls": {},
                    "glow": None,
                }

        return {
            "mode": "starter",
            "style": (rl_player or {}).get("style") or "style_a",
            "custom": (rl_player or {}).get("custom") or dict(_RL_DEFAULT),
            "selected_avatar": rl_selected,
            "needs_creation": rl_player is None,
            "username": user.get("username") or current.get("username"),
        }


    # ---------------------------------------------------------
    # STEALTH FOUNDER
    #
    # RealmLife always uses the private Founder body for this
    # account. Nobody else can reach it from this endpoint.
    # ---------------------------------------------------------

    if stealth_founder:
        avatar_id = (
            "founder_stealth_private"
        )

    else:
        avatar_id = (
            user.get(
                "nexus_avatar_id"
            )
        )


    avatar = None

    if avatar_id:
        avatar = await (
            db.nexus_avatars
            .find_one(
                {
                    "id":
                        avatar_id,

                    "status": {
                        "$in": [
                            "active",
                            "premium",
                            "founder_private",
                        ]
                    },
                },
                {
                    "_id": 0,

                    "id": 1,
                    "label": 1,

                    "url": 1,
                    "rigged_base_url": 1,

                    "animation_urls": 1,
                    "lod_urls": 1,

                    "status": 1,
                    "glow_channel": 1,
                },
            )
        )


    # Never expose a Founder-private body to anybody else.
    if (
        avatar
        and avatar.get("status")
        == "founder_private"
        and not stealth_founder
    ):
        avatar = None


    # Nexus default fallback.
    if not avatar:
        avatar = await (
            db.nexus_avatars
            .find_one(
                {
                    "is_default": True,
                    "status": "active",
                },
                {
                    "_id": 0,

                    "id": 1,
                    "label": 1,

                    "url": 1,
                    "rigged_base_url": 1,

                    "animation_urls": 1,
                    "lod_urls": 1,

                    "status": 1,
                    "glow_channel": 1,
                },
            )
        )


    if not avatar:
        raise HTTPException(
            status_code=404,
            detail=(
                "No usable Nexus avatar "
                "is available for this account."
            ),
        )


    model_url = (
        avatar.get(
            "rigged_base_url"
        )
        or avatar.get(
            "url"
        )
    )

    if not model_url:
        raise HTTPException(
            status_code=409,
            detail=(
                "Your Nexus avatar does "
                "not have a rigged model yet."
            ),
        )


    return {
        "avatar_id":
            avatar.get("id"),

        "label":
            avatar.get("label"),

        "model_url":
            model_url,

        "animation_urls":
            avatar.get(
                "animation_urls"
            )
            or {},

        "lod_urls":
            avatar.get(
                "lod_urls"
            )
            or {},

        "glow":
            user.get(
                "nexus_glow"
            )
            or "lime",

        "username":
            user.get(
                "username"
            )
            or current.get(
                "username"
            ),

        "founder_private":
            bool(
                stealth_founder
                and avatar.get("id")
                ==
                "founder_stealth_private"
            ),

        "source":
            "nexus",
    }


@public.get("/{game_id}/realmlife/environment")
async def realmlife_environment_status(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_environment as env

    return await env.status(
        game_id,
        current,
    )


@public.post("/{game_id}/realmlife/admin/world-mode")
async def realmlife_admin_world_mode(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_environment as env

    return await env.set_world_mode(
        game_id,
        current,
        body.get("mode"),
    )


@public.post("/{game_id}/realmlife/admin/signup")
async def realmlife_admin_signup(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_environment as env

    return await env.set_signup_paused(
        game_id,
        current,
        body.get("paused"),
    )


@public.post("/{game_id}/realmlife/admin/time")
async def realmlife_admin_time(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_environment as env

    return await env.set_world_time(
        game_id,
        current,
        hour=body.get("hour"),
        minute=body.get("minute"),
    )


@public.post("/{game_id}/realmlife/admin/day-length")
async def realmlife_admin_day_length(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_environment as env

    return await env.set_day_length(
        game_id,
        current,
        body.get("minutes"),
    )


@public.post("/{game_id}/realmlife/admin/weather/auto")
async def realmlife_admin_weather_auto(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_environment as env

    return await env.set_auto_weather(
        game_id,
        current,
        body.get("enabled"),
    )


@public.post("/{game_id}/realmlife/admin/weather/activate")
async def realmlife_admin_weather_activate(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_environment as env

    return await env.activate_weather(
        game_id,
        current,
        weather=body.get("weather"),
        duration_realm_hours=body.get(
            "duration_realm_hours"
        ),
    )


@public.post("/{game_id}/realmlife/admin/weather/clear")
async def realmlife_admin_weather_clear(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_environment as env

    return await env.clear_manual_weather(
        game_id,
        current,
    )


@public.post("/{game_id}/realmlife/admin/weather/schedule")
async def realmlife_admin_weather_schedule(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_environment as env

    return await env.add_schedule(
        game_id,
        current,
        weather=body.get("weather"),
        duration_realm_hours=body.get(
            "duration_realm_hours"
        ),
        every_realm_hours=body.get(
            "every_realm_hours"
        ),
        enabled=body.get(
            "enabled",
            True,
        ),
    )


@public.delete("/{game_id}/realmlife/admin/weather/schedule/{schedule_id}")
async def realmlife_admin_weather_schedule_delete(
    game_id: str,
    schedule_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import realmlife_environment as env

    return await env.remove_schedule(
        game_id,
        current,
        schedule_id,
    )


@public.post("/{game_id}/report")
async def report_game(game_id: str, body: dict, current: CurrentUser):
    await db.game_reports.insert_one({
        "id": uuid.uuid4().hex, "game_id": game_id, "user_id": current["id"],
        "username": current.get("username"), "reason": str(body.get("reason") or "")[:400],
        "at": _iso(), "status": "open"})
    await gs.audit(current, "game_reported", game_id, detail=str(body.get("reason") or "")[:100])
    return {"ok": True}



# ============================================================
# REALMLIFE PORTAL NETWORK V5F1
# ============================================================

@public.get(
    "/{game_id}/realmlife/portals"
)
async def realmlife_portals(
    game_id: str,
    current: CurrentUser,
):
    from services import (
        realmlife_portals as rlp
    )

    return await rlp.list_portals(
        game_id,
        current,
    )


@public.post(
    "/{game_id}/realmlife/portal-travel"
)
async def realmlife_portal_travel(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    from services import (
        realmlife_portals as rlp
    )

    return await rlp.travel(
        game_id,
        current,
        body.get(
            "source_portal_id"
        ),
        body.get(
            "destination_portal_id"
        ),
    )


@public.post(
    "/{game_id}/realmlife/portal-access/grant"
)
async def realmlife_portal_grant(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    from services import (
        realmlife_portals as rlp
    )

    return await rlp.grant_access(
        game_id,
        current,
        body.get(
            "user_id"
        ),
    )


@public.post(
    "/{game_id}/realmlife/portal-access/revoke"
)
async def realmlife_portal_revoke(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    from services import (
        realmlife_portals as rlp
    )

    return await rlp.revoke_access(
        game_id,
        current,
        body.get(
            "user_id"
        ),
    )



# ============================================================
# REALMLIFE DJ STUDIO V5F2B1
# ============================================================

@public.get(
    "/{game_id}/realmlife/dj/sounds"
)
async def realmlife_dj_sounds(
    game_id: str,
    q: str = "",
    current: CurrentUser = None,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_dj
    )

    return await (
        realmlife_dj
        .list_sounds(
            current,
            q=q,
        )
    )



# ============================================================
# REALMLIFE DJ SAME ORIGIN BYTES V5F2B1G
# ============================================================

@public.get(
    "/{game_id}/realmlife/dj/audio/{sound_id}"
)
async def realmlife_dj_audio_bytes(
    game_id: str,
    sound_id: str,
    current: CurrentUser = None,
):

    await _realmlife_access(
        game_id,
        current,
    )


    from fastapi.responses import Response
    import httpx

    from services import realmlife_dj


    sound = await (
        realmlife_dj
        .playable_sound_for_user(
            sound_id,
            current,
        )
    )


    upstream_url = (
        realmlife_dj
        .dj_upstream_audio_url(
            sound
        )
    )


    try:

        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(
                60.0,
                connect=15.0,
            ),
        ) as client:

            upstream = await client.get(
                upstream_url,
                headers={
                    "Accept":
                        "audio/*,*/*;q=0.8",
                },
            )


        if upstream.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=(
                    "OurRealm media storage "
                    "did not return the Sound."
                ),
            )


    except HTTPException:
        raise

    except Exception as exc:

        raise HTTPException(
            status_code=502,
            detail=(
                "RealmLife could not retrieve "
                "this Sound."
            ),
        ) from exc


    content_type = (
        sound.get("mime")
        or upstream.headers.get(
            "content-type"
        )
        or "audio/mp4"
    )


    data = upstream.content


    if not data:
        raise HTTPException(
            status_code=502,
            detail="Sound returned no audio data.",
        )


    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control":
                "private, max-age=300",

            "Accept-Ranges":
                "bytes",

            "X-Content-Type-Options":
                "nosniff",
        },
    )



@public.get(
    "/{game_id}/realmlife/dj/sessions"
)
async def realmlife_dj_sessions(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_dj
    )

    return await (
        realmlife_dj
        .list_sessions(
            game_id,
            current,
        )
    )


@public.post(
    "/{game_id}/realmlife/dj/sessions"
)
async def realmlife_dj_session_save(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_dj
    )

    return await (
        realmlife_dj
        .save_session(
            game_id,
            current,
            body,
        )
    )


@public.get(
    "/{game_id}/realmlife/dj/playlists"
)
async def realmlife_dj_playlists(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_dj
    )

    return await (
        realmlife_dj
        .list_playlists(
            game_id,
            current,
        )
    )


@public.post(
    "/{game_id}/realmlife/dj/playlists"
)
async def realmlife_dj_playlist_create(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_dj
    )

    return await (
        realmlife_dj
        .create_playlist(
            game_id,
            current,
            body,
        )
    )



# ============================================================
# REALMLIFE V6C1 BUSINESS + PERSONAL PORTAL ROUTES
# ============================================================


@public.get(
    "/{game_id}/realmlife/businesses"
)
async def realmlife_businesses(
    game_id: str,
    current: CurrentUser,
    city_id: str = "city-001",
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_business as rlb
    )

    return await rlb.list_businesses(
        game_id,
        current,
        city_id,
    )


@public.post(
    "/{game_id}/realmlife/businesses/{business_id}/claim"
)
async def realmlife_business_claim(
    game_id: str,
    business_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_business as rlb
    )

    return await rlb.claim_business(
        game_id,
        current,
        business_id,
        city_id=
            body.get(
                "city_id"
            )
            or
            "city-001",
        idempotency_key=
            body.get(
                "idempotency_key"
            ),
    )


@public.post(
    "/{game_id}/realmlife/businesses/{business_id}/visibility"
)
async def realmlife_business_visibility(
    game_id: str,
    business_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_business as rlb
    )

    return await rlb.set_visibility(
        game_id,
        current,
        business_id,
        city_id=
            body.get(
                "city_id"
            )
            or
            "city-001",
        visibility=
            body.get(
                "visibility"
            )
            or
            "public",
    )


@public.post(
    "/{game_id}/realmlife/businesses/{business_id}/destroy"
)
async def realmlife_business_destroy(
    game_id: str,
    business_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_business as rlb
    )

    return await rlb.destroy_business(
        game_id,
        current,
        business_id,
        city_id=
            body.get(
                "city_id"
            )
            or
            "city-001",
        confirmation=
            body.get(
                "confirmation"
            ),
    )


@public.post(
    "/{game_id}/realmlife/businesses/founder/create"
)
async def realmlife_business_founder_create(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_business as rlb
    )

    return await (
        rlb.founder_create_business(
            game_id,
            current,
            body,
        )
    )


@public.post(
    "/{game_id}/realmlife/personal-portal/unlock"
)
async def realmlife_personal_portal_unlock(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_portals as rlp
    )

    return await (
        rlp.unlock_personal_portal(
            game_id,
            current,
            body.get(
                "idempotency_key"
            ),
        )
    )



# ============================================================
# REALMLIFE V7A HOME ROUTE
# ============================================================


@public.get(
    "/{game_id}/realmlife/world/home"
)
async def realmlife_world_home(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_world as rlw
    )

    return await (
        rlw.home_destination(
            game_id,
            current,
        )
    )


@public.get(
    "/{game_id}/realmlife/world/beacons"
)
async def realmlife_world_beacons(
    game_id: str,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_world as rlw
    )

    return await (
        rlw.home_beacons(
            game_id,
            current,
        )
    )


@public.post(
    "/{game_id}/realmlife/property/guest-access"
)
async def realmlife_property_guest_access(
    game_id: str,
    body: dict,
    current: CurrentUser,
):
    await _realmlife_access(
        game_id,
        current,
    )

    from services import (
        realmlife_property as rlp
    )

    return await (
        rlp.set_guest_interior_access(
            game_id,
            current,
            body,
        )
    )
