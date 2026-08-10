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
from core.permissions import require_founder, get_admin_role, ROLE_FOUNDER
from services import game_studio as gs
from services import job_engine
from services import economy
from services import orai_policies as op
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
    ("open_world_rpg", "Open World RPG", "Seamless scrolling worlds, zones, NPC quests, roaming enemies & world gates.", "open_world_rpg", "live"),
    ("card_battle", "Card Battle", "Strategic card battles with decks, mana & abilities.", "card_battle", "live"),
    ("tower_defense", "Tower Defense", "Build towers, defend your base, upgrade & survive waves.", "tower_defense", "live"),
    ("match3", "Match-3 Puzzle", "Swap, match, combo & achieve high scores.", "match3", "live"),
    ("racing", "Racing", "High-speed races, tracks, upgrades & challenges.", "racing", "live"),
    ("shooter", "Shooter", "Top-down arena combat — waves, enemy AI, auto-fire blasters & portals.", "shooter", "live"),
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
    hold_id = p.get("hold_id")
    try:
        result = await _do_create(job, p)
    except job_engine.JobCancelled:
        if hold_id:
            await economy.release_hold(hold_id, "cancelled during execution", "system")
        raise
    if hold_id:  # burn ONLY after successful validation + save
        await economy.finalize_burn(hold_id, result["game_id"])
        result["burn_finalized"] = True
    from services import engine_registry as _er
    await _er.pin_game(result["game_id"], job.get("username") or "system")
    await db.games.update_one({"id": result["game_id"], "age_rating": {"$ne": "13+"}},
                              {"$set": {"age_rating": "13+"}})
    return result


async def _do_create(job: dict, p: dict) -> dict:
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
        g = await db.games.find_one({"id": gid}, {"_id": 0, "status": 1, "stage": 1, "error": 1,
                                                      "spec": 1, "resource_manifest": 1})
        if not g:
            raise RuntimeError("Game record disappeared during build")
        st = g.get("status")
        if st == "building":
            await job_engine.phase(job["id"], "assembling", 60, f"Stage: {g.get('stage') or 'building'}")
            continue
        if st == "failed":
            raise RuntimeError(g.get("error") or "Build failed")
        await job_engine.phase(job["id"], "validating", 90, "Finalizing")
        aliases = {
            "coin": "coins", "coins": "coins", "gold_coin": "coins",
            "gem": "gems", "gems": "gems",
            "star": "stars", "stars": "stars",
            "key": "keys", "keys": "keys", "fire": "fire",
        }
        manifest = set()
        for item in (g.get("resource_manifest") or ["fire"]):
            key = item if isinstance(item, str) else item.get("key") or item.get("resource_key")
            if key:
                manifest.add(str(key).lower())

        for stage in ((g.get("spec") or {}).get("stages") or []):
            for pickup in (stage.get("pickups") or []):
                if not isinstance(pickup, dict):
                    continue
                raw_key = str(
                    pickup.get("resource_key")
                    or pickup.get("kind")
                    or pickup.get("type")
                    or ""
                ).lower()
                if raw_key in aliases:
                    manifest.add(aliases[raw_key])
            if stage.get("keys"):
                manifest.add("keys")

        await db.games.update_one(
            {"id": gid},
            {"$set": {"resource_manifest": sorted(manifest)}},
        )
        return {
            "game_id": gid,
            "status": st,
            "resource_manifest": sorted(manifest),
        }
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
    from services import engine_registry as _er
    allowed, reason = await _er.new_use_allowed(rt[3])
    if not allowed:
        raise HTTPException(status_code=400, detail=reason)
    power = min(max(int(body.get("ai_power") or 5), 1), 10)
    t = tier(power)
    if body.get("dry_run"):
        out = {"model": t["label"], "runtime": rt[1], "style": style}
        if get_admin_role(current) == ROLE_FOUNDER:  # internal AI $ estimates are founder-only
            out["estimated_cost"] = round(t["est_cost_per_pass"] * 3, 3)
        return out
    style_name = next(n for k, n, _ in STYLES if k == style)
    payload = {"request": f"{idea}\n\nArt direction: render everything in a {style_name} visual style.",
               "engine_runtime": rt[3], "runtime_choice": rt_choice, "style": style,
               "ai_power": power, "complexity": min(max(int(body.get("complexity") or 4), 1), 10)}
    job = await job_engine.submit("gamemaker_create", current, payload,
                                  idem_key=body.get("request_id"))
    return {"job_id": job["id"], "phase": job["phase"]}


@router.get("/saved")
async def saved_games(current: CurrentUser):
    q = ({"$or": [{"creator_id": current["id"]}, {"created_by": current["id"]}]}
         if not get_admin_role(current) else {})
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
    # Public games are always rated 13+ — never below
    def _below13(v):
        try:
            return int(str(v or "").rstrip("+").strip()) < 13
        except ValueError:
            return True
    await db.games.update_one({"id": gid}, {"$set": {
        "status": "published", "published_at": g.get("published_at") or _iso(),
        **({"age_rating": "13+"} if _below13(g.get("age_rating")) else {}),
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
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "id": 1, "created_by": 1})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    if g.get("created_by") != current["id"] and g.get("creator_id") != current["id"] \
            and not get_admin_role(current):
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
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "id": 1, "creator_id": 1, "created_by": 1})
    if not g or (current["id"] not in (g.get("creator_id"), g.get("created_by"))
                 and not get_admin_role(current)):
        raise HTTPException(status_code=404, detail="Game not found")
    title = str(body.get("title") or "").strip()[:80]
    if not title:
        raise HTTPException(status_code=400, detail="Title required")
    await db.games.update_one({"id": game_id}, {"$set": {"title": title, "updated_at": _iso()}})
    return {"ok": True}


@router.post("/{game_id}/archive")
async def archive_game(game_id: str, current: CurrentUser):
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "id": 1, "creator_id": 1, "created_by": 1, "status": 1})
    if not g or (current["id"] not in (g.get("creator_id"), g.get("created_by"))
                 and not get_admin_role(current)):
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


@admin.post("/test-economy-cycle")
async def test_economy_cycle(body: dict, current: CurrentUser):
    """Diagnostics: full quote→hold→(burn|release) cycle with NO providers.
    Exercises the same atomic economy functions used by real builds."""
    require_founder(current)
    username = str(body.get("username") or current["username"])
    u = await db.users.find_one({"username": username}, {"_id": 0, "password": 0})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    resource = str(body.get("resource") or "fire")
    outcome = str(body.get("outcome") or "success")
    trace = {}
    q = await economy.create_quote(u, {"idea": "test", "style": "pixel_art",
                                       "runtime": "platformer", "resource": resource,
                                       "economy": int(body.get("economy") or 1),
                                       "ai_power": int(body.get("ai_power") or 1)}, 0.0)
    trace["quote"] = {k: q[k] for k in ("id", "required_fire", "required_amount", "rule_version", "available")}
    bal0 = await economy.available_balance(u["id"], resource)
    rid = f"teccycle-{q['id']}"
    try:
        h1 = await economy.place_hold(u, q["id"], rid, founder=False)
        h2 = await economy.place_hold(u, q["id"], rid, founder=False)  # replay
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    trace["hold"] = {"id": h1["id"], "amount": h1["amount"], "state": h1["state"],
                     "replay_returned_same": h1["id"] == h2["id"]}
    trace["balance_before"] = bal0
    trace["balance_after_hold"] = await economy.available_balance(u["id"], resource)
    if outcome == "success":
        await economy.finalize_burn(h1["id"], "test-game")
        await economy.finalize_burn(h1["id"], "test-game")  # idempotent — no double burn
        trace["final_state"] = (await db.gm_holds.find_one({"id": h1["id"]}, {"_id": 0, "state": 1}))["state"]
    else:  # return / release path
        r1 = await economy.release_hold(h1["id"], "test return", current["username"])
        r2 = await economy.release_hold(h1["id"], "test return again", current["username"])
        trace["release"] = {"first": r1, "second_noop": not r2}
        trace["final_state"] = (await db.gm_holds.find_one({"id": h1["id"]}, {"_id": 0, "state": 1}))["state"]
    trace["balance_final"] = await economy.available_balance(u["id"], resource)
    if resource == "fire":
        trace["reconciliation"] = await economy.reconcile_fire()
    return trace


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


# ─── Phase 1.5 — Economy: sliders, quotes, holds, burns ─────────────────

@router.get("/economy")
async def economy_config(current: CurrentUser):
    acc = await check_access(current)
    rule = await economy.active_pricing_rule()
    regs = await db.resource_registry.find(
        {"archived": {"$ne": True}, "enabled": True, "build_eligible": True},
        {"_id": 0, "key": 1, "name": 1, "icon": 1, "color": 1, "fire_equiv": 1, "frozen": 1}).to_list(50)
    return {"access": acc,
            "economy_tiers": economy.ECONOMY_TIERS, "power_tiers": economy.POWER_TIERS,
            "rule": {"version": rule["version"], "base_per_point": rule["base_per_point"],
                     "minimum": rule["minimum"], "maximum": rule["maximum"], "curve": rule["curve"]},
            "eligible_resources": regs,
            "disclaimer": "Engagement resources have no monetary value and cannot be exchanged for money or goods."}


@router.post("/quote")
async def make_quote(body: dict, current: CurrentUser):
    acc = await check_access(current)
    if not acc["allowed"]:
        raise HTTPException(status_code=403, detail=acc.get("message") or "Game Maker access is restricted")
    power = min(max(int(body.get("ai_power") or 5), 1), 10)
    pol = await op.check_policy("gamemaker_create", current, power=power,
                                is_founder=bool(get_admin_role(current)))
    if not pol["allowed"]:
        raise HTTPException(status_code=403, detail=f"ORAi policy: {pol['reason']}")
    idea = str(body.get("idea") or "").strip()
    rt = next((r for r in RUNTIMES if r[0] == str(body.get("runtime") or "")), None)
    if not idea or not rt or rt[4] != "live":
        raise HTTPException(status_code=400, detail="Pick a Live runtime, a style and describe your game")
    if str(body.get("style") or "") not in {k for k, _, _ in STYLES}:
        raise HTTPException(status_code=400, detail="Pick one of the 10 animation styles")
    from services import engine_registry as _er
    allowed, reason = await _er.new_use_allowed(rt[3])
    if not allowed:
        raise HTTPException(status_code=400, detail=reason)
    t = tier(power)
    try:
        q = await economy.create_quote(current, {**body, "ai_power": power,
                                                 "economy": min(max(int(body.get("economy") or 5), 1), 10)},
                                       provider_est=round(t["est_cost_per_pass"] * 3, 3))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    q["provider_model"] = t["label"]
    if get_admin_role(current) != ROLE_FOUNDER:  # internal AI $ estimates are founder-only
        q.pop("provider_estimate", None)
    return {"quote": q}


@router.post("/quote/{quote_id}/confirm")
async def confirm_quote(quote_id: str, body: dict, current: CurrentUser):
    """HELD → job submitted with the SAME idempotency request. Replay-safe."""
    acc = await check_access(current)
    if not acc["allowed"]:
        raise HTTPException(status_code=403, detail="Game Maker access is restricted")
    rid = str(body.get("request_id") or "") or None
    founder = bool(get_admin_role(current))
    try:
        hold = await economy.place_hold(current, quote_id, rid, founder)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if hold.get("job_id"):  # replayed confirm — same job, no double hold/burn
        return {"hold": hold, "job_id": hold["job_id"], "replayed": True}
    q = await db.gm_quotes.find_one({"id": quote_id}, {"_id": 0})
    rt = next(r for r in RUNTIMES if r[0] == q["runtime"])
    style_name = next(n for k, n, _ in STYLES if k == q["style"])
    payload = {"request": f"{q['idea']}\n\nArt direction: render everything in a {style_name} visual style.",
               "engine_runtime": rt[3], "runtime_choice": q["runtime"], "style": q["style"],
               "ai_power": q["ai_power"], "complexity": q["economy"], "hold_id": hold["id"]}
    job = await job_engine.submit("gamemaker_create", current, payload,
                                  idem_key=f"job:{hold['id']}")
    await db.gm_holds.update_one({"id": hold["id"]}, {"$set": {"job_id": job["id"]}})
    hold["job_id"] = job["id"]
    return {"hold": hold, "job_id": job["id"]}


@router.get("/hold/{hold_id}")
async def hold_status(hold_id: str, current: CurrentUser):
    h = await db.gm_holds.find_one({"id": hold_id}, {"_id": 0})
    if not h or (h["user_id"] != current["id"] and not get_admin_role(current)):
        raise HTTPException(status_code=404, detail="Hold not found")
    return {"hold": h}


@router.post("/hold/{hold_id}/retry")
async def hold_retry(hold_id: str, current: CurrentUser):
    """Retry a failed build reusing the SAME hold — never reserves or burns again."""
    h = await db.gm_holds.find_one({"id": hold_id, "state": "held"}, {"_id": 0})
    if not h or h["user_id"] != current["id"]:
        raise HTTPException(status_code=404, detail="No retryable hold found")
    prev = await db.gm_jobs.find_one({"id": h.get("job_id")}, {"_id": 0, "phase": 1, "payload": 1})
    if not prev or prev["phase"] != "failed":
        raise HTTPException(status_code=400, detail="The build for this hold isn't in a failed state")
    job = await job_engine.submit("gamemaker_create", current, prev["payload"], idem_key=None)
    await db.gm_holds.update_one({"id": hold_id}, {"$set": {"job_id": job["id"]}})
    return {"job_id": job["id"], "hold_id": hold_id}


@router.post("/hold/{hold_id}/return")
async def hold_return(hold_id: str, current: CurrentUser):
    """Return Resource & Cancel — releases the full hold immediately."""
    h = await db.gm_holds.find_one({"id": hold_id}, {"_id": 0})
    if not h or h["user_id"] != current["id"]:
        raise HTTPException(status_code=404, detail="Hold not found")
    active = await db.gm_jobs.find_one({"id": h.get("job_id"),
                                        "phase": {"$in": list(job_engine.ACTIVE)}}, {"id": 1})
    if active:
        await db.gm_jobs.update_one({"id": h["job_id"]}, {"$set": {"cancel_requested": True}})
    ok = await economy.release_hold(hold_id, "user returned resource", current["username"])
    if not ok:
        raise HTTPException(status_code=400, detail="Hold already finalized or released")
    return {"released": True}


# ─── Phase 1.5 — founder Economy Control Center ──────────────────────────

@admin.get("/pricing")
async def pricing_rules(current: CurrentUser):
    require_founder(current)
    rows = await db.gm_pricing_rules.find({}, {"_id": 0}).sort("version", -1).to_list(50)
    return {"rules": rows}


@admin.post("/pricing")
async def pricing_update(body: dict, current: CurrentUser):
    """Creates a NEW immutable rule version — existing quotes/holds keep theirs."""
    require_founder(current)
    cur = await economy.active_pricing_rule()
    fields = ("base_per_point", "economy_weight", "ai_power_weight", "minimum", "maximum",
              "curve", "runtime_modifiers", "style_modifiers", "media_modifier", "founder_exempt")
    new = {k: body.get(k, cur.get(k)) for k in fields}
    if new["curve"] not in ("linear", "tiered"):
        raise HTTPException(status_code=400, detail="curve must be linear or tiered")
    for k in ("base_per_point", "economy_weight", "ai_power_weight", "minimum", "maximum"):
        new[k] = int(new[k])
    doc = {**new, "version": int(cur["version"]) + 1, "enabled": True,
           "created_at": _iso(), "created_by": current["username"]}
    await db.gm_pricing_rules.insert_one(dict(doc))
    doc.pop("_id", None)
    return {"rule": doc}


@admin.get("/pricing/preview")
async def pricing_preview(current: CurrentUser):
    """All 100 Economy × AI Power combinations under the active rule."""
    require_founder(current)
    rule = await economy.active_pricing_rule()
    grid = [[economy.compute_required_fire(rule, e, p) for p in range(1, 11)] for e in range(1, 11)]
    return {"rule_version": rule["version"], "grid": grid}


@admin.get("/holds")
async def admin_holds(current: CurrentUser, state: str = "", limit: int = 50):
    require_founder(current)
    q = {"state": state} if state else {}
    rows = await db.gm_holds.find(q, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 200))
    return {"holds": rows}


@admin.post("/holds/{hold_id}/release")
async def admin_release_hold(hold_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    reason = str(body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required to release a hold")
    ok = await economy.release_hold(hold_id, f"admin: {reason}", current["username"])
    if not ok:
        raise HTTPException(status_code=400, detail="Hold not in a releasable state")
    return {"released": True}


@admin.get("/reconciliation")
async def reconciliation(current: CurrentUser):
    require_founder(current)
    return {"fire": await economy.reconcile_fire(),
            "note": "outstanding_vs_expected_ok=true means adapter holds/burns/releases "
                    "match the authoritative Fire wallet transactions exactly."}


@admin.get("/exchange-rules")
async def exchange_rules(current: CurrentUser):
    require_founder(current)
    rows = await db.gm_exchange_rules.find({}, {"_id": 0}).sort("version", -1).to_list(20)
    return {"rules": rows}


@admin.post("/exchange-rules")
async def exchange_rules_update(body: dict, current: CurrentUser):
    require_founder(current)
    cur = await economy.active_exchange_rule()
    fields = ("pairs", "min_amount", "max_amount", "daily_limit", "cooldown_s",
              "fee_pct", "rounding", "frozen")
    new = {k: body.get(k, cur.get(k)) for k in fields}
    new["pairs"] = [[str(a), str(b)] for a, b in (new.get("pairs") or []) if a != b][:40]
    doc = {**new, "version": int(cur["version"]) + 1, "enabled": True,
           "created_at": _iso(), "created_by": current["username"]}
    await db.gm_exchange_rules.insert_one(dict(doc))
    doc.pop("_id", None)
    return {"rule": doc}


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
