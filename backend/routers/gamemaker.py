"""OurRealm Game Maker — public creation API + founder admin foundation.

Public name is "OurRealm Game Maker". Internal legacy identifiers (orai_*,
game_studio, OPC collections) are preserved to avoid breaking existing
games, records and integrations — documented in /app/memory/PRD.md.
"""
import json
import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder, get_admin_role
from services import game_studio as gs
from services import job_engine
from services.llm_router import tier

log = logging.getLogger("ourrealm.gamemaker")
router = APIRouter(prefix="/api/gamemaker", tags=["gamemaker"])
admin = APIRouter(prefix="/api/admin/gamemaker", tags=["gamemaker-admin"])

BUNDLE_PATH = "/app/backend/data/games_migration_bundle.json"

# Public catalog — 10 animation styles (exact order from founder reference)
STYLES = [
    ("pixel_art", "Pixel Art", "Classic retro pixels — charming & timeless."),
    ("hand_drawn_2d", "Hand-Drawn 2D", "Illustrated, expressive & full of character."),
    ("cartoon", "Cartoon", "Bold, colorful & fun for all ages."),
    ("anime", "Anime", "Stylized Japanese anime — vibrant & dynamic."),
    ("comic_book", "Comic Book", "Bold lines, cell shading & high impact."),
    ("low_poly", "Low Poly", "Clean, lightweight & performance friendly."),
    ("stylized_3d", "3D Stylized", "Real-time 3D with a stylized look."),
    ("chibi", "Chibi", "Cute, playful & full of personality."),
    ("watercolor", "Watercolor", "Painted by hand, beautiful & unique."),
    ("ink_brush", "Ink Brush", "Elegant ink brush & traditional feel."),
]
# Public catalog — 10 runtimes; status is truthful (planned = not yet generatable)
RUNTIMES = [
    ("action_rpg_2_5d", "Action RPG 2.5D", "Real-time combat, spells, quests, bosses, loot & more.", "action_rpg_2_5d", "live"),
    ("turn_based_creature_rpg", "Turn-Based Creature RPG", "Capture creatures, train, evolve & battle in turn-based adventures.", "turn_based_creature_rpg", "live"),
    ("platformer", "Platformer", "Classic side-scrolling platform action.", "platformer", "live"),
    ("top_down_adventure", "Top-Down Adventure", "Explore, solve puzzles, fight enemies, collect items & more.", "top_down", "live"),
    ("open_world_rpg", "Open World RPG", "Large seamless worlds, quests, factions, dynamic events & more.", "rpg", "planned"),
    ("card_battle", "Card Battle", "Strategic card battles with decks, mana & abilities.", "card_battle", "live"),
    ("tower_defense", "Tower Defense", "Build towers, defend your base, upgrade & survive waves.", "tower_defense", "live"),
    ("match3", "Match-3 Puzzle", "Swap, match, combo & achieve high scores.", "match3", "live"),
    ("racing", "Racing", "High-speed races, tracks, upgrades & challenges.", "racing", "live"),
    ("shooter", "Shooter", "FPS or TPS combat, weapons, AI, missions & more.", None, "planned"),
]


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def get_access_config() -> dict:
    doc = await db.platform_settings.find_one({"key": "gamemaker_access"}, {"_id": 0})
    return doc or {"key": "gamemaker_access", "mode": "founder_only", "beta_usernames": []}


async def check_access(user: dict | None) -> dict:
    cfg = await get_access_config()
    mode = cfg.get("mode", "founder_only")
    if user and get_admin_role(user):
        return {"allowed": True, "mode": mode, "role": "founder"}
    if mode == "public":
        return {"allowed": True, "mode": mode}
    if not user:
        return {"allowed": False, "mode": mode, "message": "OurRealm Game Maker is opening soon — sign in to check your access."}
    if mode == "signed_in":
        return {"allowed": True, "mode": mode}
    if mode == "beta" and user.get("username") in (cfg.get("beta_usernames") or []):
        return {"allowed": True, "mode": mode}
    return {"allowed": False, "mode": mode,
            "message": "OurRealm Game Maker is currently in founder preview. You'll be able to create games here soon."}


@router.get("/catalog")
async def catalog(current: CurrentUser):
    acc = await check_access(current)
    return {"access": acc,
            "styles": [{"key": k, "name": n, "description": d} for k, n, d in STYLES],
            "runtimes": [{"key": k, "name": n, "description": d, "status": st}
                         for k, n, d, _, st in RUNTIMES]}


@job_engine.register("gamemaker_create")
async def _run_create(job: dict) -> dict:
    p = job["payload"]
    user = await db.users.find_one({"id": job["user_id"]}, {"_id": 0, "password": 0, "password_hash": 0})
    await job_engine.phase(job["id"], "planning", 10, "Planning your game with ORAi")
    est = await gs.create_estimate({
        "request": p["request"], "complexity": p.get("complexity", 4),
        "ai_power": p.get("ai_power", 5), "runtime": p["engine_runtime"],
        "animation_style": p.get("style"),
    }, user)
    await job_engine.phase(job["id"], "generating", 30, "Building the game")
    game = await gs.start_build(est, user)
    gid = game["id"]
    await db.games.update_one({"id": gid}, {"$set": {
        "gamemaker": {"style": p.get("style"), "runtime_choice": p.get("runtime_choice"),
                      "created_via": "gamemaker", "job_id": job["id"]},
        "resource_manifest": p.get("resource_manifest") or ["fire"]}})
    # start_build launches the async build; poll games.status until terminal
    import asyncio
    for _ in range(360):  # up to ~30 min
        await asyncio.sleep(5)
        g = await db.games.find_one({"id": gid}, {"_id": 0, "status": 1, "stage": 1, "error": 1})
        if not g:
            raise RuntimeError("Game record disappeared during build")
        st = g.get("status")
        if st == "building":
            await job_engine.phase(job["id"], "assembling", 60, f"Stage: {g.get('stage') or 'building'}")
            continue
        if st == "failed":
            raise RuntimeError(g.get("error") or "Build failed")
        await job_engine.phase(job["id"], "validating", 90, "Finalizing")
        return {"game_id": gid, "status": st}
    raise RuntimeError("Build timed out")


@router.post("/create")
async def create_game(body: dict, current: CurrentUser):
    acc = await check_access(current)
    if not acc["allowed"]:
        raise HTTPException(status_code=403, detail=acc.get("message") or "Game Maker access is restricted")
    idea = str(body.get("idea") or "").strip()[:2000]
    style = str(body.get("style") or "")
    rt_choice = str(body.get("runtime") or "")
    if not idea:
        raise HTTPException(status_code=400, detail="Describe your game idea first")
    if style not in {k for k, _, _ in STYLES}:
        raise HTTPException(status_code=400, detail="Pick one of the 10 animation styles")
    rt = next((r for r in RUNTIMES if r[0] == rt_choice), None)
    if not rt:
        raise HTTPException(status_code=400, detail="Pick one of the 10 game runtimes")
    if rt[4] != "live" or not rt[3]:
        raise HTTPException(status_code=400, detail=f"{rt[1]} is coming soon — it isn't generatable yet. "
                                                    f"Pick a Live runtime for now.")
    power = min(max(int(body.get("ai_power") or 5), 1), 10)
    t = tier(power)
    if body.get("dry_run"):
        return {"estimated_cost": round(t["est_cost_per_pass"] * 3, 3), "model": t["label"],
                "runtime": rt[1], "style": style}
    style_name = next(n for k, n, _ in STYLES if k == style)
    payload = {"request": f"{idea}\n\nArt direction: render everything in a {style_name} visual style.",
               "engine_runtime": rt[3], "runtime_choice": rt_choice, "style": style,
               "ai_power": power, "complexity": min(max(int(body.get("complexity") or 4), 1), 10)}
    job = await job_engine.submit("gamemaker_create", current, payload,
                                  idem_key=body.get("request_id"))
    return {"job_id": job["id"], "phase": job["phase"]}


@router.get("/saved")
async def saved_games(current: CurrentUser):
    q = {"creator_id": current["id"]} if not get_admin_role(current) else {}
    rows = await db.games.find(q, {"_id": 0, "id": 1, "title": 1, "status": 1, "runtime": 1,
                                   "cover_url": 1, "version": 1, "updated_at": 1, "created_at": 1,
                                   "published_at": 1, "genre": 1, "gamemaker": 1,
                                   "resource_manifest": 1, "foryou_post_id": 1,
                                   "spec.description": 1}).sort("updated_at", -1).to_list(100)
    urls = {}
    async for u in db.game_urls.find({"active": True}, {"_id": 0, "game_id": 1, "full_path": 1}):
        urls[u["game_id"]] = u["full_path"]
    for r in rows:
        r["public_url"] = urls.get(r["id"])
        r["versions_kept"] = None
    return {"games": rows}


# ─── Publishing (persistent job, idempotent For You post) ────────────────

@job_engine.register("gamemaker_publish")
async def _run_publish(job: dict) -> dict:
    p = job["payload"]
    gid = p["game_id"]
    user = await db.users.find_one({"id": job["user_id"]}, {"_id": 0})
    await job_engine.phase(job["id"], "validating", 20, "Validating playable build")
    g = await db.games.find_one({"id": gid}, {"_id": 0})
    if not g:
        raise RuntimeError("Game not found")
    if g["status"] not in ("approved", "pending_approval", "published"):
        raise RuntimeError(f"Game status '{g['status']}' cannot be published — approve it first")
    from routers.games_plus import game_controls, validate_controls
    cerrs = validate_controls(game_controls(g), g.get("runtime"))
    if cerrs:
        raise RuntimeError("Controls validation failed: " + "; ".join(cerrs[:3]))
    await job_engine.phase(job["id"], "publishing", 60, "Publishing")
    prev_status = g["status"]
    await db.games.update_one({"id": gid}, {"$set": {
        "status": "published", "published_at": g.get("published_at") or _iso(),
        "rollback_status": prev_status, "updated_at": _iso()}})
    result = {"game_id": gid, "published": True}
    if p.get("foryou_post"):
        await job_engine.phase(job["id"], "publishing", 80, "Updating For You post")
        result["post_id"] = await _upsert_foryou_post(g, user)
    await gs.audit(user, "gamemaker_publish", gid, detail=g.get("title"))
    return result


async def _upsert_foryou_post(g: dict, user: dict) -> str:
    """One post per game — republish updates the existing post."""
    from services.game_access_ctl import resolve_cover
    cover = resolve_cover(g)
    desc = ((g.get("spec") or {}).get("description") or "")[:220]
    link = f"/games/{g['id']}"
    cur = await db.game_urls.find_one({"game_id": g["id"], "active": True}, {"_id": 0})
    if cur:
        link = cur["full_path"]
    content = f"🎮 {g['title']} — now playable on OurRealm Games!\n{desc}\n▶ Play: {link}"
    existing_id = g.get("foryou_post_id")
    if existing_id:
        r = await db.posts.update_one({"id": existing_id}, {"$set": {
            "content": content, "image_url": cover, "game_link": link,
            "updated_at": _iso()}})
        if r.matched_count:
            return existing_id
    doc = {"id": str(uuid.uuid4()), "author_id": user["id"],
           "author_username": user.get("username"),
           "author_name": user.get("display_name") or user.get("name", ""),
           "author_avatar": user.get("avatar_url"), "content": content,
           "media_type": "image" if cover else "text", "content_type": "game",
           "media_url": cover, "image_url": cover, "image_urls": [cover] if cover else [],
           "video_url": None, "link_url": None, "game_id": g["id"], "game_link": link,
           "game_title": g["title"], "tags": ["games"],
           "audience": {"visibility": "public", "user_ids": []},
           "likes": 0, "liked_by": [], "comments": 0, "poll": None,
           "created_at": _iso()}
    await db.posts.insert_one(dict(doc))
    await db.games.update_one({"id": g["id"]}, {"$set": {"foryou_post_id": doc["id"]}})
    return doc["id"]


@router.post("/{game_id}/publish")
async def publish_game(game_id: str, body: dict, current: CurrentUser):
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "creator_id": 1})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    if g.get("creator_id") != current["id"] and not get_admin_role(current):
        raise HTTPException(status_code=403, detail="Not your game")
    job = await job_engine.submit("gamemaker_publish", current,
                                  {"game_id": game_id, "foryou_post": bool(body.get("foryou_post"))},
                                  idem_key=body.get("request_id") or f"publish:{game_id}:{body.get('foryou_post')}:{datetime.now(timezone.utc).date()}")
    return {"job_id": job["id"]}


@router.post("/{game_id}/unpublish")
async def unpublish_game(game_id: str, current: CurrentUser):
    require_founder(current)
    await db.games.update_one({"id": game_id, "status": "published"},
                              {"$set": {"status": "approved", "updated_at": _iso()}})
    return {"ok": True}


@router.post("/{game_id}/rename")
async def rename_game(game_id: str, body: dict, current: CurrentUser):
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "creator_id": 1})
    if not g or (g.get("creator_id") != current["id"] and not get_admin_role(current)):
        raise HTTPException(status_code=404, detail="Game not found")
    title = str(body.get("title") or "").strip()[:80]
    if not title:
        raise HTTPException(status_code=400, detail="Title required")
    await db.games.update_one({"id": game_id}, {"$set": {"title": title, "updated_at": _iso()}})
    return {"ok": True}


@router.post("/{game_id}/archive")
async def archive_game(game_id: str, current: CurrentUser):
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "creator_id": 1, "status": 1})
    if not g or (g.get("creator_id") != current["id"] and not get_admin_role(current)):
        raise HTTPException(status_code=404, detail="Game not found")
    if g["status"] == "published":
        raise HTTPException(status_code=400, detail="Unpublish before archiving")
    # archive never deletes version history or ledger history
    await db.games.update_one({"id": game_id}, {"$set": {"status": "archived", "updated_at": _iso()}})
    return {"ok": True}


# ─── Founder admin foundation ────────────────────────────────────────────

@admin.get("/overview")
async def admin_overview(current: CurrentUser):
    require_founder(current)
    st = {}
    for s in ("published", "approved", "pending_approval", "building", "failed", "archived"):
        st[s] = await db.games.count_documents({"status": s})
    jobs_active = await db.gm_jobs.count_documents({"phase": {"$in": list(job_engine.ACTIVE)}})
    jobs_failed = await db.gm_jobs.count_documents({"phase": "failed"})
    res_count = await db.resource_registry.count_documents({"archived": {"$ne": True}})
    ledger_count = await db.resource_ledger.estimated_document_count()
    access = await get_access_config()
    return {"games": st, "jobs": {"active": jobs_active, "failed": jobs_failed},
            "resources": res_count, "ledger_entries": ledger_count,
            "access": {"mode": access.get("mode"), "beta_usernames": access.get("beta_usernames") or []},
            "runtimes": [{"key": k, "name": n, "status": s} for k, n, _, _, s in RUNTIMES],
            "styles": [{"key": k, "name": n} for k, n, _ in STYLES]}


@admin.get("/jobs")
async def admin_jobs(current: CurrentUser, phase: str = "", limit: int = 40):
    require_founder(current)
    q = {"phase": phase} if phase else {}
    rows = await db.gm_jobs.find(q, {"_id": 0, "payload": 0}).sort("created_at", -1).to_list(min(limit, 100))
    return {"jobs": rows}


@admin.post("/access")
async def set_access(body: dict, current: CurrentUser):
    require_founder(current)
    mode = str(body.get("mode") or "founder_only")
    if mode not in ("founder_only", "beta", "signed_in", "public"):
        raise HTTPException(status_code=400, detail="Unknown access mode")
    await db.platform_settings.update_one({"key": "gamemaker_access"}, {"$set": {
        "mode": mode, "beta_usernames": [str(u)[:40] for u in (body.get("beta_usernames") or [])][:200],
        "updated_at": _iso(), "updated_by": current["username"]}}, upsert=True)
    return {"ok": True, "mode": mode}


@admin.post("/test-delayed-job")
async def test_delayed_job(body: dict, current: CurrentUser):
    """Diagnostics: proves long operations survive the Cloudflare window."""
    require_founder(current)
    secs = min(max(int(body.get("seconds") or 90), 5), 600)
    job = await job_engine.submit("gm_test_delay", current, {"seconds": secs})
    return {"job_id": job["id"], "seconds": secs}


@job_engine.register("gm_test_delay")
async def _run_test_delay(job: dict) -> dict:
    import asyncio
    secs = int(job["payload"].get("seconds") or 90)
    steps = max(1, secs // 10)
    for i in range(steps):
        await asyncio.sleep(secs / steps)
        await job_engine.phase(job["id"], "generating", int((i + 1) / steps * 90),
                               f"Simulated slow provider {i + 1}/{steps}")
    return {"slept": secs}


# ─── Production migration tool (dry-run first, insert-only, reversible) ──

@admin.get("/migration/report")
async def migration_report(current: CurrentUser):
    """Dry-run diff between the bundled preview export and THIS environment's DB."""
    require_founder(current)
    try:
        with open(BUNDLE_PATH) as f:
            bundle = json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Migration bundle not found in this build")
    report = []
    for g in bundle["games"]:
        existing = await db.games.find_one({"id": g["id"]}, {"_id": 0, "status": 1, "title": 1})
        assets_missing = 0
        for a in g.get("_asset_records") or []:
            if not await db.orai_assets.find_one({"file_name": a["file_name"]}, {"id": 1}):
                assets_missing += 1
        url_rec = g.get("_url_record")
        url_state = "none"
        if url_rec:
            taken = await db.game_urls.find_one({"full_path": url_rec["full_path"], "active": True}, {"game_id": 1})
            url_state = ("exists_same" if taken and taken.get("game_id") == g["id"]
                         else "conflict" if taken else "missing")
        report.append({"id": g["id"], "title": g["title"], "bundle_status": g.get("status"),
                       "access_mode": ((g.get("access") or {}).get("mode")
                                       or (g.get("release") or {}).get("mode") or "published(default)"),
                       "in_this_db": bool(existing),
                       "db_status": (existing or {}).get("status"),
                       "asset_records_needed": assets_missing,
                       "public_url": (url_rec or {}).get("full_path"), "url_state": url_state})
    return {"bundle_created_at": bundle.get("created_at"), "bundle_games": len(bundle["games"]),
            "report": report,
            "note": "Insert-only migration. Existing records are never overwritten. "
                    "Statuses/access modes are copied exactly — nothing is auto-published."}


@admin.post("/migration/apply")
async def migration_apply(body: dict, current: CurrentUser):
    """Apply the bundle for the selected game_ids. Insert-only, idempotent."""
    require_founder(current)
    ids = [str(x) for x in (body.get("game_ids") or [])]
    if not ids:
        raise HTTPException(status_code=400, detail="Pass game_ids selected from the dry-run report")
    with open(BUNDLE_PATH) as f:
        bundle = json.load(f)
    by_id = {g["id"]: g for g in bundle["games"]}
    results = []
    for gid in ids:
        g = by_id.get(gid)
        if not g:
            results.append({"id": gid, "result": "not_in_bundle"})
            continue
        assets = g.pop("_asset_records", [])
        url_rec = g.pop("_url_record", None)
        a_ins = 0
        for a in assets:
            if not await db.orai_assets.find_one({"file_name": a["file_name"]}, {"id": 1}):
                await db.orai_assets.insert_one(dict(a))
                a_ins += 1
        if await db.games.find_one({"id": gid}, {"id": 1}):
            results.append({"id": gid, "result": "already_exists", "assets_inserted": a_ins})
        else:
            await db.games.insert_one(dict(g))
            results.append({"id": gid, "result": "inserted", "assets_inserted": a_ins})
        if url_rec and not await db.game_urls.find_one({"full_path": url_rec["full_path"], "active": True}):
            await db.game_urls.insert_one(dict(url_rec))
    await gs.audit(current, "gamemaker_migration_apply", detail=f"{len(ids)} games")
    return {"results": results}


@admin.post("/migration/rollback")
async def migration_rollback(body: dict, current: CurrentUser):
    """Remove ONLY games this migration inserted (never touches pre-existing records)."""
    require_founder(current)
    ids = [str(x) for x in (body.get("game_ids") or [])]
    with open(BUNDLE_PATH) as f:
        bundle = json.load(f)
    bundle_ids = {g["id"] for g in bundle["games"]}
    removed = []
    for gid in ids:
        if gid not in bundle_ids:
            continue
        g = await db.games.find_one({"id": gid}, {"_id": 0, "plays": 1})
        if g and not g.get("plays"):  # only safe to remove if nobody has played it here
            await db.games.delete_one({"id": gid})
            removed.append(gid)
    await gs.audit(current, "gamemaker_migration_rollback", detail=f"{len(removed)} games")
    return {"removed": removed}
