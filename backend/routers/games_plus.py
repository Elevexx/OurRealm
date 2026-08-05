"""Game Creator Phase 1.5+ — leaderboards, achievements, Fire Power rewards,
player progression, showcase tools (clone/rebuild/versions/rollback/diversity).
Registered BEFORE routers.games so specific paths win over /{game_id}."""
import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import game_studio as gs
from services.llm_router import call_llm, tier

public2 = APIRouter(prefix="/api/games", tags=["games-plus"])
admin2 = APIRouter(prefix="/api/admin/games", tags=["games-plus-admin"])

REWARD_DEFAULTS = {"enabled": False, "first_completion": 5, "new_best": 2,
                   "achievement": 3, "daily_challenge": 5, "weekly_challenge": 15}


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def reward_settings() -> dict:
    doc = await db.game_reward_settings.find_one({"_id": "settings"}) or {}
    return {**REWARD_DEFAULTS, **{k: doc[k] for k in REWARD_DEFAULTS if k in doc}}


# ─── Per-game Fire Power Economy (reuses the audited Fire Vault ledger) ──
def fire_econ(g: dict) -> dict:
    d = gs.FIRE_ECON_DEFAULTS
    e = (g or {}).get("fire_economy") or {}
    return {**d, **e, "rewards": {**d["rewards"], **(e.get("rewards") or {})}}


def econ_preview(econ: dict, spec: dict) -> dict:
    n = len((spec or {}).get("stages") or []) or 1
    n_ach = len((spec or {}).get("achievements") or [])
    rw = econ["rewards"]
    base = rw["completion"] * n + rw["final_completion"]
    max_pp = base + rw["perfect"] + rw["speed"] + rw["boss"] + rw["hidden_objective"] + rw["achievement"] * n_ach
    worst_month = max_pp + rw["daily"] * 30 + rw["weekly"] * 4
    pool = int(econ.get("pool") or 0)
    initial = int(econ.get("pool_initial") or pool or 1)
    return {"stages": n, "achievements": n_ach,
            "avg_per_player": round(base + 0.5 * (max_pp - base)),
            "max_per_player": max_pp, "base_per_player": base,
            "worst_case_month_per_player": worst_month,
            "full_completions_supported": pool // max(1, max_pp),
            "pool_pct_remaining": round(100 * pool / max(1, initial), 1)}


async def _pool_grant(game_id: str, user_id: str, key: str, amount: int, granted: list, label: str,
                      cap: int = 0, cooldown: int = 0):
    """Atomic pool decrement + idempotent audited ledger credit (claimable in Fire Vault)."""
    amount = int(amount)
    if amount <= 0:
        return
    try:
        if cap or cooldown:
            q = {"post_id": game_id, "sender_id": "game_fire_pool", "user_id": user_id}
            if cooldown:
                lastr = await db.fire_wallet_transactions.find_one(q, {"created_at": 1}, sort=[("created_at", -1)])
                if lastr:
                    prev_t = datetime.fromisoformat(str(lastr["created_at"]).replace("Z", "+00:00"))
                    if (datetime.now(timezone.utc) - prev_t).total_seconds() < cooldown:
                        return
            if cap:
                day = _iso()[:10]
                rows = await db.fire_wallet_transactions.find(
                    {**q, "created_at": {"$gte": day}}, {"amount": 1}).to_list(500)
                if sum(int(r["amount"]) for r in rows) + amount > cap:
                    return
        r = await db.games.update_one(
            {"id": game_id, "fire_economy.pool": {"$gte": amount}},
            {"$inc": {"fire_economy.pool": -amount, "fire_economy.distributed": amount}})
        if not r.modified_count:
            return  # pool depleted or missing
        from services.fire_vault import credit_fire
        tx = await credit_fire(user_id, "game_fire_pool", game_id, key, amount,
                               idempotency_key=key, finalize_at=_iso())
        if tx is None:  # duplicate/replay — refund the pool untouched
            await db.games.update_one({"id": game_id}, {"$inc": {
                "fire_economy.pool": amount, "fire_economy.distributed": -amount}})
            return
        granted.append({"label": label, "amount": amount})
    except Exception:  # noqa: BLE001 — rewards must never break gameplay
        pass


async def _grant(user_id: str, game_id: str, key: str, amount: int, granted: list, label: str):
    if amount <= 0:
        return
    try:
        from services.fire_vault import credit_fire
        tx = await credit_fire(user_id, "game_rewards", game_id, key, int(amount),
                               idempotency_key=key, finalize_at=_iso())
        if tx:
            granted.append({"label": label, "amount": int(amount)})
    except Exception:  # noqa: BLE001 — rewards must never break gameplay
        pass


@public2.get("/me/stats")
async def my_stats(current: CurrentUser):
    rows = await db.game_progress.find({"user_id": current["id"]}, {"_id": 0}).to_list(200)
    ach = await db.game_achievements.count_documents({"user_id": current["id"]})
    by_rt = {}
    for r in rows:
        rt = r.get("runtime") or "other"
        b = by_rt.setdefault(rt, {"plays": 0, "best": 0})
        b["plays"] += r.get("attempts") or 0
        b["best"] = max(b["best"], r.get("best_score") or 0)
    return {"games_played": len(rows), "total_attempts": sum(r.get("attempts") or 0 for r in rows),
            "completions": sum(r.get("completions") or 0 for r in rows),
            "time_played_s": sum(r.get("time_played_s") or 0 for r in rows),
            "achievements": ach, "by_runtime": by_rt,
            "records": sorted(rows, key=lambda r: -(r.get("best_score") or 0))[:5]}


@public2.get("/{game_id}/leaderboard")
async def leaderboard(game_id: str, current: CurrentUser, window: str = "all", scope: str = "global"):
    q = {"game_id": game_id, "hidden": {"$ne": True}}
    days = {"daily": 1, "weekly": 7, "monthly": 30}.get(window)
    if days:
        q["created_at"] = {"$gte": (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()}
    if scope == "friends":
        me = await db.users.find_one({"id": current["id"]}, {"friends": 1}) or {}
        q["user_id"] = {"$in": (me.get("friends") or []) + [current["id"]]}
    elif scope == "realm":
        mine = await db.community_memberships.find({"user_id": current["id"]}, {"community_id": 1}).to_list(50)
        cids = [m["community_id"] for m in mine]
        peers = await db.community_memberships.find({"community_id": {"$in": cids}}, {"user_id": 1}).to_list(2000)
        q["user_id"] = {"$in": list({p["user_id"] for p in peers} | {current["id"]})}
    rows = await db.game_scores.find(q, {"_id": 0}).sort("score", -1).to_list(400)
    best, order = {}, []
    for r in rows:
        if r["user_id"] not in best:
            best[r["user_id"]] = r
            order.append(r)
        if len(order) >= 20:
            break
    me_rank = next((i + 1 for i, r in enumerate(order) if r["user_id"] == current["id"]), None)
    return {"entries": order, "window": window, "scope": scope, "my_rank": me_rank}


@public2.get("/{game_id}/achievements")
async def my_achievements(game_id: str, current: CurrentUser):
    g = await db.games.find_one({"id": game_id}, {"spec.achievements": 1, "spec.unlockables": 1})
    mine = await db.game_achievements.find({"game_id": game_id, "user_id": current["id"]}, {"_id": 0}).to_list(50)
    return {"defined": ((g or {}).get("spec") or {}).get("achievements") or [],
            "unlockables": ((g or {}).get("spec") or {}).get("unlockables") or [], "earned": mine}


@public2.post("/{game_id}/score")
async def submit_score(game_id: str, body: dict, current: CurrentUser):
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "id": 1, "runtime": 1, "title": 1, "spec.title": 1})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    score = max(0, int(body.get("score") or 0))
    completed = bool(body.get("completed"))
    time_s = max(0, min(36000, int(body.get("time_s") or 0)))
    stage = max(0, int(body.get("stage_reached") or 0))
    achievements = [str(a)[:80] for a in (body.get("achievements") or [])][:12]
    prev = await db.game_progress.find_one({"game_id": game_id, "user_id": current["id"]}, {"_id": 0})
    prev_best = (prev or {}).get("best_score") or 0
    await db.game_scores.insert_one({
        "id": uuid.uuid4().hex, "game_id": game_id, "user_id": current["id"],
        "username": current.get("username"), "avatar": current.get("avatar_url") or current.get("avatar"),
        "score": score, "time_s": time_s, "stage_reached": stage, "completed": completed,
        "runtime": g.get("runtime"), "game_version": int(body.get("game_version") or 1),
        "no_damage": bool(body.get("no_damage")), "max_combo": float(body.get("max_combo") or 1),
        "hidden": False, "created_at": _iso()})
    await db.game_progress.update_one(
        {"game_id": game_id, "user_id": current["id"]},
        {"$set": {"username": current.get("username"), "last_score": score,
                  "best_score": max(score, prev_best), "runtime": g.get("runtime"),
                  "stage_reached": max(stage, (prev or {}).get("stage_reached") or 0),
                  "last_played": _iso(), "game_title": g.get("title")},
         "$inc": {"completions": 1 if completed else 0, "time_played_s": time_s}}, upsert=True)
    new_ach = []
    for a in achievements:
        r = await db.game_achievements.update_one(
            {"game_id": game_id, "user_id": current["id"], "label": a},
            {"$setOnInsert": {"id": uuid.uuid4().hex, "earned_at": _iso(), "username": current.get("username")}},
            upsert=True)
        if r.upserted_id:
            new_ach.append(a)
    granted = []
    rs = await reward_settings()
    if rs["enabled"]:
        if completed and not ((prev or {}).get("completions") or 0):
            await _grant(current["id"], game_id, f"gr:first:{game_id}:{current['id']}",
                         rs["first_completion"], granted, "First completion")
        if score > prev_best and prev_best > 0:
            await _grant(current["id"], game_id, f"gr:best:{game_id}:{current['id']}:{score}",
                         rs["new_best"], granted, "New best score")
        for a in new_ach:
            await _grant(current["id"], game_id, f"gr:ach:{game_id}:{current['id']}:{a[:40]}",
                         rs["achievement"], granted, f"Achievement: {a}")
        if completed:
            day = _iso()[:10]
            await _grant(current["id"], game_id, f"gr:daily:{current['id']}:{day}",
                         rs["daily_challenge"], granted, "Daily challenge")
    # per-game Fire Power pool (validated, idempotent, audited, claimable in Fire Vault)
    g_full = await db.games.find_one({"id": game_id}, {"_id": 0, "id": 1, "fire_economy": 1,
                                                       "spec.stages": 1, "spec.achievements": 1})
    econ = fire_econ(g_full)
    if econ["enabled"] and not econ["paused"]:
        await db.games.update_one({"id": game_id, "fire_economy": {"$exists": False}},
                                  {"$set": {"fire_economy": {**econ}}})
        rw, uid = econ["rewards"], current["id"]
        cap, cd = int(econ.get("daily_player_cap") or 0), int(econ.get("claim_cooldown_s") or 0)
        n_stages = len(((g_full or {}).get("spec") or {}).get("stages") or []) or 1
        for s_i in range(1, min(stage, n_stages) + 1):
            await _pool_grant(game_id, uid, f"gfp:stage:{game_id}:{uid}:{s_i}",
                              rw["completion"], granted, f"Stage {s_i} cleared", cap, cd)
        for a in new_ach:
            await _pool_grant(game_id, uid, f"gfp:ach:{game_id}:{uid}:{a[:40]}",
                              rw["achievement"], granted, f"Achievement: {a}", cap, cd)
        if completed:
            await _pool_grant(game_id, uid, f"gfp:final:{game_id}:{uid}",
                              rw["final_completion"], granted, "Game completed", cap, cd)
            if body.get("no_damage"):
                await _pool_grant(game_id, uid, f"gfp:perfect:{game_id}:{uid}",
                                  rw["perfect"], granted, "Perfect run", cap, cd)
            if time_s and int(rw.get("speed_time_s") or 0) and time_s <= int(rw["speed_time_s"]):
                await _pool_grant(game_id, uid, f"gfp:speed:{game_id}:{uid}",
                                  rw["speed"], granted, "Speed bonus", cap, cd)
            if rw.get("boss"):
                await _pool_grant(game_id, uid, f"gfp:boss:{game_id}:{uid}",
                                  rw["boss"], granted, "Boss defeated", cap, cd)
            day = _iso()[:10]
            if rw.get("daily"):
                await _pool_grant(game_id, uid, f"gfp:daily:{game_id}:{uid}:{day}",
                                  rw["daily"], granted, "Daily bonus", cap, cd)
            if rw.get("weekly"):
                wk = datetime.now(timezone.utc).strftime("%G-W%V")
                await _pool_grant(game_id, uid, f"gfp:weekly:{game_id}:{uid}:{wk}",
                                  rw["weekly"], granted, "Weekly bonus", cap, cd)
    return {"ok": True, "best_score": max(score, prev_best), "new_achievements": new_ach,
            "fire_rewards": granted, "claim_hint": "Claimable in your Fire Vault" if granted else None}


# ─── Founder tools ───────────────────────────────────────────────────────
@admin2.get("/rewards")
async def get_rewards(current: CurrentUser):
    require_founder(current)
    return await reward_settings()


@admin2.patch("/rewards")
async def patch_rewards(body: dict, current: CurrentUser):
    require_founder(current)
    upd = {k: (bool(body[k]) if k == "enabled" else max(0, int(body[k])))
           for k in REWARD_DEFAULTS if k in body}
    await db.game_reward_settings.update_one({"_id": "settings"}, {"$set": upd}, upsert=True)
    await gs.audit(current, "game_rewards_updated", detail=json.dumps(upd)[:150])
    return await reward_settings()


# ─── Edit with ORAi — targeted spec patching (Living Projects) ───────────
ENGINE_CAPS_NOTE = (
    "ENGINE CAPABILITIES (honest contract — never fake anything): the runtime is FIXED per game; "
    "dodge_collect presentation modes: road_3d|lane_runner|vertical|space_flight|arena_360|tunnel; "
    "any 'environment' theme string works (procedurally rendered); hazards, moving hazards, chasers, cores, "
    "pickups (shield/boost/multiplier), portals, checkpoints, combo, lives, achievements, unlockables, "
    "palette/visual_theme colors, built-in synth audio, stage titles/stories. "
    "NOT SUPPORTED: multiplayer, controller/gamepad, networked play, 3D models, video cutscenes, voice narration, "
    "custom image assets. If asked for these, leave the spec unchanged for that part and explain in '_substitutions'.")
EDIT_SYSTEM = (
    "You are ORAi's game editor. You receive a game's CURRENT spec JSON and ONE edit request.\n"
    "Apply ONLY what the request asks — preserve every other field exactly as-is.\n"
    "Never change 'runtime'. Keep 'player_representation' unchanged unless explicitly asked.\n"
    + ENGINE_CAPS_NOTE +
    "\nReturn ONLY the FULL updated spec JSON with one extra top-level key "
    "'_substitutions': [strings describing anything you could not honor and the closest supported thing you did instead] (empty if none).")


@admin2.post("/{game_id}/orai-edit")
async def orai_edit(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    if g.get("status") == "building":
        raise HTTPException(status_code=400, detail="Game is currently building")
    prompt = str(body.get("prompt") or "").strip()[:1500]
    scope = str(body.get("scope") or "full")[:30]
    add_stages = min(10, max(0, int(body.get("add_stages") or 0)))
    if not prompt and not add_stages:
        raise HTTPException(status_code=400, detail="Describe what ORAi should change, or set add_stages")
    power = min(max(int(body.get("ai_power") or g.get("ai_power") or 5), 1), 10)
    t = tier(power)
    est = round(t["est_cost_per_pass"] * (2 if add_stages else 1), 3)
    if body.get("dry_run"):
        return {"estimated_cost": est, "model": t["label"], "scope": scope,
                "add_stages": add_stages, "note": "Only the requested scope is regenerated — everything else is preserved."}
    user = ("CURRENT SPEC:\n" + json.dumps(g.get("spec") or {})[:24000]
            + "\n\nEDIT SCOPE: " + scope
            + ("\nEDIT REQUEST: " + prompt if prompt else "")
            + (f"\nAPPEND exactly {add_stages} brand-new stages that continue the difficulty escalation with NEW "
               f"environments and fresh hazard mixes. Do NOT modify existing stages." if add_stages else ""))
    try:
        raw = await call_llm(EDIT_SYSTEM, user, power=power, json_mode=True)
        spec = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"ORAi edit generation failed: {str(e)[:150]}")
    subs = [str(s)[:300] for s in (spec.pop("_substitutions", None) or [])][:8]
    spec["runtime"] = g["runtime"]
    if spec.get("player_representation") not in (gs.PLAYER_REPS.get(g["runtime"]) or []):
        spec["player_representation"] = ((g.get("spec") or {}).get("player_representation")
                                         or gs.default_rep(g["runtime"], str(spec.get("mode") or "")))
    errs = gs.validate_spec(spec, int(g.get("complexity") or 5))
    if errs:
        raise HTTPException(status_code=422, detail="ORAi edit failed validation: " + "; ".join(errs[:3]))
    versions = (g.get("versions") or [])[-29:] + [_versions_entry(g)]
    new_v = int(g.get("version") or 1) + 1
    await db.games.update_one({"id": game_id}, {"$set": {
        "spec": spec, "versions": versions, "version": new_v, "updated_at": _iso(),
        "actual_cost": round(float(g.get("actual_cost") or 0) + est, 3)}})
    await gs.audit(current, "game_orai_edit", game_id,
                   detail=f"scope={scope} add_stages={add_stages} · {prompt[:120]}", cost=est)
    return {"ok": True, "version": new_v, "cost": est, "substitutions": subs,
            "stages": len(spec.get("stages") or []), "title": spec.get("title")}


async def _fire_analytics(game_id: str) -> dict:
    rows = await db.fire_wallet_transactions.find(
        {"post_id": game_id, "sender_id": "game_fire_pool"},
        {"_id": 0, "amount": 1, "user_id": 1, "created_at": 1, "status": 1}).to_list(5000)
    now = datetime.now(timezone.utc)
    day = now.date().isoformat()
    week_ago = (now - timedelta(days=7)).isoformat()
    month_ago = (now - timedelta(days=30)).isoformat()
    amounts = [int(r["amount"]) for r in rows]
    return {"distributed": sum(amounts), "claims": len(rows),
            "claimed": sum(int(r["amount"]) for r in rows if r.get("status") == "collected"),
            "unique_claimants": len({r["user_id"] for r in rows}),
            "avg_reward": round(sum(amounts) / len(amounts), 1) if amounts else 0,
            "largest_reward": max(amounts) if amounts else 0,
            "claims_today": sum(1 for r in rows if str(r.get("created_at") or "")[:10] == day),
            "claims_week": sum(1 for r in rows if str(r.get("created_at") or "") >= week_ago),
            "claims_month": sum(1 for r in rows if str(r.get("created_at") or "") >= month_ago)}


@admin2.get("/{game_id}/fire-economy")
async def get_fire_economy(game_id: str, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "fire_economy": 1, "spec": 1})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    econ = fire_econ(g)
    return {"economy": econ, "preview": econ_preview(econ, g.get("spec") or {}),
            "analytics": await _fire_analytics(game_id)}


@admin2.patch("/{game_id}/fire-economy")
async def patch_fire_economy(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    econ = fire_econ(g)
    action = body.get("action")
    if action == "reset":
        econ["pool"] = int(econ.get("pool_initial") or 1_000_000)
    elif action == "refill":
        econ["pool"] = int(econ["pool"]) + max(0, int(body.get("amount") or econ.get("pool_initial") or 0))
    else:
        for k in ("enabled", "paused"):
            if k in body:
                econ[k] = bool(body[k])
        if "pool" in body:
            econ["pool"] = max(0, int(body["pool"]))
            econ["pool_initial"] = max(econ["pool"], int(econ.get("pool_initial") or 0)) if body.get("keep_initial") else econ["pool"]
        for k in ("daily_player_cap", "claim_cooldown_s"):
            if k in body:
                econ[k] = max(0, int(body[k]))
        if isinstance(body.get("rewards"), dict):
            for k in gs.FIRE_ECON_DEFAULTS["rewards"]:
                if k in body["rewards"]:
                    econ["rewards"][k] = max(0, int(body["rewards"][k]))
    # every economy change is a new version, like any other game change
    versions = (g.get("versions") or [])[-29:] + [_versions_entry(g)]
    await db.games.update_one({"id": game_id}, {"$set": {
        "fire_economy": econ, "versions": versions,
        "version": int(g.get("version") or 1) + 1, "updated_at": _iso()}})
    await gs.audit(current, "game_fire_economy_" + (action or "updated"), game_id,
                   detail=f"pool={econ['pool']} enabled={econ['enabled']} paused={econ['paused']}")
    spec = g.get("spec") or {}
    return {"economy": econ, "preview": econ_preview(econ, spec),
            "analytics": await _fire_analytics(game_id)}


@public2.get("/{game_id}/fire-info")
async def game_fire_info(game_id: str, current: CurrentUser):
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "fire_economy": 1, "spec.stages": 1, "spec.achievements": 1})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    econ = fire_econ(g)
    if not econ["enabled"] or econ["paused"]:
        return {"enabled": False, "message": "Fire Rewards Currently Disabled"}
    pv = econ_preview(econ, g.get("spec") or {})
    return {"enabled": True, "pool_remaining": econ["pool"], "pool_pct": pv["pool_pct_remaining"],
            "rewards": econ["rewards"], "max_per_player": pv["max_per_player"],
            "base_per_player": pv["base_per_player"], "stages": pv["stages"]}


@admin2.get("/{game_id}/scores")
async def score_history(game_id: str, current: CurrentUser):
    require_founder(current)
    rows = await db.game_scores.find({"game_id": game_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"scores": rows}


@admin2.post("/{game_id}/leaderboard-action")
async def lb_action(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    action = body.get("action")
    if action == "delete_score":
        await db.game_scores.delete_one({"id": body.get("score_id"), "game_id": game_id})
    elif action == "hide_user":
        await db.game_scores.update_many({"game_id": game_id, "user_id": body.get("user_id")},
                                         {"$set": {"hidden": True}})
    elif action == "reset":
        await db.game_scores.delete_many({"game_id": game_id})
    elif action == "refresh":
        pass
    else:
        raise HTTPException(status_code=400, detail="Unknown action")
    await gs.audit(current, f"game_lb_{action}", game_id, detail=str(body.get("user_id") or body.get("score_id") or ""))
    return {"ok": True}


def _versions_entry(g: dict) -> dict:
    return {"version": int(g.get("version") or 1), "at": _iso(),
            "spec": g.get("spec"), "plan": g.get("plan"), "status": g.get("status"),
            "complexity": g.get("complexity"), "ai_power": g.get("ai_power"), "request": g.get("request"),
            "fire_economy": g.get("fire_economy"), "controls": g.get("controls"),
            "title": g.get("title"), "description": g.get("description"), "genre": g.get("genre"),
            "labels": g.get("labels"), "cover_url": g.get("cover_url")}


META_EDITABLE = {"title": 150, "description": 500, "genre": 60}


@admin2.patch("/{game_id}/meta")
async def patch_meta(game_id: str, body: dict, current: CurrentUser):
    """Universal editor: core metadata + labels + difficulty. Every save = new version."""
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    upd = {}
    for k, maxlen in META_EDITABLE.items():
        if k in body and str(body[k]).strip():
            upd[k] = str(body[k]).strip()[:maxlen]
    if "labels" in body and isinstance(body["labels"], list):
        upd["labels"] = [str(x)[:40] for x in body["labels"]][:12]
    if "complexity" in body:
        upd["complexity"] = min(max(int(body["complexity"]), 1), 10)
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    versions = (g.get("versions") or [])[-29:] + [_versions_entry(g)]
    upd.update({"versions": versions, "version": int(g.get("version") or 1) + 1, "updated_at": _iso()})
    if "title" in upd and g.get("spec"):
        await db.games.update_one({"id": game_id}, {"$set": {"spec.title": upd["title"]}})
    await db.games.update_one({"id": game_id}, {"$set": upd})
    await gs.audit(current, "game_meta_edited", game_id, detail=",".join(k for k in upd if k not in ("versions", "version", "updated_at")))
    return {"ok": True, "version": upd["version"]}


@admin2.post("/{game_id}/reroll-audio")
async def reroll_audio(game_id: str, body: dict, current: CurrentUser):
    """Reroll procedural WebAudio parameters (music or sfx). No audio assets generated."""
    require_founder(current)
    import random as _r
    kind = body.get("kind")
    if kind not in ("music", "sfx"):
        raise HTTPException(status_code=400, detail="kind must be music|sfx")
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    spec = g.get("spec") or {}
    key = f"audio_variant_{kind}"
    old = int(spec.get(key) or 0)
    new_v = _r.choice([v for v in range(1, 12) if v != old])
    spec[key] = new_v
    versions = (g.get("versions") or [])[-29:] + [_versions_entry(g)]
    await db.games.update_one({"id": game_id}, {"$set": {
        "spec": spec, "versions": versions, "version": int(g.get("version") or 1) + 1, "updated_at": _iso()}})
    await gs.audit(current, f"game_audio_reroll_{kind}", game_id, detail=f"variant {old}->{new_v}")
    return {"ok": True, "kind": kind, "variant": new_v}


@admin2.post("/{game_id}/regen-cover")
async def regen_cover(game_id: str, body: dict, current: CurrentUser):
    """Generate/regenerate the cover via the existing AI image pipeline. Founder-clicked only."""
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    from services.orai_images import generate_orai_image
    prompt = str(body.get("prompt") or (g.get("cover_suggestion") or {}).get("prompt")
                 or gs.build_cover_prompt(g)["prompt"])[:900]
    try:
        img_bytes, model = await generate_orai_image(prompt)
        url = await _apply_cover(g, current, img_bytes, prompt, model, "generated")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cover generation failed: {str(e)[:140]}")
    await gs.audit(current, "game_cover_regenerated", game_id, detail=model, cost=gs.COVER_IMG_COST)
    return {"ok": True, "cover_url": url, "model": model, "prompt": prompt}


# ── Cover art workflow (founder-only, never auto-generated) ──────────────
COVER_W, COVER_H = 832, 1040  # exact 4:5 /games card crop


def _crop_cover_bytes(raw: bytes) -> bytes:
    """Center-crop to the exact 4:5 card ratio with a safe focal point."""
    import io
    from PIL import Image, ImageOps
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
    if img.mode != "RGB":
        img = img.convert("RGB")
    img = ImageOps.fit(img, (COVER_W, COVER_H), Image.LANCZOS, centering=(0.5, 0.42))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=86, optimize=True)
    return out.getvalue()


async def _apply_cover(g: dict, current: dict, img_bytes: bytes, prompt: str, model: str, source: str) -> str:
    """Store original + exact card crop, keep history for restore, bump version."""
    from services import image_store
    orig = await image_store.save_bytes(img_bytes, current["id"])
    card = await image_store.save_bytes(_crop_cover_bytes(img_bytes), current["id"], "image/jpeg")
    history = g.get("cover_history") or []
    if g.get("cover_url"):
        history = history[-9:] + [{"cover_url": g["cover_url"],
                                   "cover_original_url": g.get("cover_original_url"),
                                   "meta": g.get("cover_meta"), "at": _iso()}]
    meta = {"prompt": (prompt or "")[:900], "model": model, "source": source,
            "cost": gs.COVER_IMG_COST if source == "generated" else 0.0,
            "card_crop": f"{COVER_W}x{COVER_H} (4:5)", "at": _iso()}
    versions = (g.get("versions") or [])[-29:] + [_versions_entry(g)]
    await db.games.update_one({"id": g["id"]}, {"$set": {
        "cover_url": card.original_url, "cover_original_url": orig.original_url,
        "cover_meta": meta, "cover_history": history,
        "versions": versions, "version": int(g.get("version") or 1) + 1, "updated_at": _iso()}})
    return card.original_url


@admin2.get("/covers/missing")
async def covers_missing(current: CurrentUser):
    """Every published game with no cover image (honest text-card fallback stays until fixed)."""
    require_founder(current)
    rows = await db.games.find(
        {"status": "published", "$or": [{"cover_url": None}, {"cover_url": ""}, {"cover_url": {"$exists": False}}]},
        {"_id": 0, "id": 1, "title": 1, "runtime": 1, "genre": 1, "created_at": 1}).sort("created_at", -1).to_list(200)
    return {"games": rows, "count": len(rows), "est_cost_each": gs.COVER_IMG_COST,
            "est_total_cost": round(len(rows) * gs.COVER_IMG_COST, 2)}


@admin2.post("/covers/bulk-generate")
async def covers_bulk_generate(body: dict, current: CurrentUser):
    """Generate covers for founder-selected games (cost approved on the client confirm)."""
    require_founder(current)
    ids = [str(x) for x in (body.get("game_ids") or []) if x][:12]
    if not ids:
        raise HTTPException(status_code=400, detail="Select at least one game")
    actor = {"id": current["id"], "username": current.get("username")}

    async def _bulk():
        from services.orai_images import generate_orai_image
        for gid in ids:
            g = await db.games.find_one({"id": gid}, {"_id": 0})
            if not g or g.get("cover_url"):
                continue
            try:
                prompt = str((g.get("cover_suggestion") or {}).get("prompt") or gs.build_cover_prompt(g)["prompt"])[:900]
                img_bytes, model = await generate_orai_image(prompt)
                await _apply_cover(g, actor, img_bytes, prompt, model, "generated")
                await gs.audit(actor, "game_cover_bulk_generated", gid, detail=model, cost=gs.COVER_IMG_COST)
            except Exception as e:  # noqa: BLE001
                await gs.audit(actor, "game_cover_bulk_failed", gid, detail=str(e)[:150])
    asyncio.create_task(_bulk())
    await gs.audit(current, "game_cover_bulk_started", detail=f"{len(ids)} games",
                   cost=round(len(ids) * gs.COVER_IMG_COST, 2))
    return {"ok": True, "queued": len(ids), "est_total_cost": round(len(ids) * gs.COVER_IMG_COST, 2)}


@admin2.get("/{game_id}/cover-suggestion")
async def cover_suggestion(game_id: str, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    sug = g.get("cover_suggestion") or gs.build_cover_prompt(g)
    return {"suggestion": sug, "has_cover": bool(g.get("cover_url")),
            "history_count": len(g.get("cover_history") or []), "cover_meta": g.get("cover_meta")}


@admin2.post("/{game_id}/cover-upload")
async def cover_upload(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    import base64 as _b64
    b64 = str(body.get("image_b64") or "")
    if "," in b64[:80]:
        b64 = b64.split(",", 1)[1]
    try:
        raw = _b64.b64decode(b64)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid image data")
    if not raw or len(raw) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 8 MB")
    try:
        url = await _apply_cover(g, current, raw, "(founder upload)", "upload", "upload")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)[:140])
    await gs.audit(current, "game_cover_uploaded", game_id)
    return {"ok": True, "cover_url": url}


@admin2.post("/{game_id}/cover-remove")
async def cover_remove(game_id: str, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    if not g.get("cover_url"):
        raise HTTPException(status_code=400, detail="This game has no cover")
    history = (g.get("cover_history") or [])[-9:] + [{
        "cover_url": g["cover_url"], "cover_original_url": g.get("cover_original_url"),
        "meta": g.get("cover_meta"), "at": _iso()}]
    versions = (g.get("versions") or [])[-29:] + [_versions_entry(g)]
    await db.games.update_one({"id": game_id}, {"$set": {
        "cover_url": None, "cover_original_url": None, "cover_meta": None,
        "cover_history": history, "versions": versions,
        "version": int(g.get("version") or 1) + 1, "updated_at": _iso()}})
    await gs.audit(current, "game_cover_removed", game_id)
    return {"ok": True}


@admin2.post("/{game_id}/cover-restore")
async def cover_restore(game_id: str, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    history = g.get("cover_history") or []
    if not history:
        raise HTTPException(status_code=400, detail="No previous cover to restore")
    prev, rest = history[-1], history[:-1]
    if g.get("cover_url"):
        rest = rest[-9:] + [{"cover_url": g["cover_url"], "cover_original_url": g.get("cover_original_url"),
                             "meta": g.get("cover_meta"), "at": _iso()}]
    versions = (g.get("versions") or [])[-29:] + [_versions_entry(g)]
    await db.games.update_one({"id": game_id}, {"$set": {
        "cover_url": prev.get("cover_url"), "cover_original_url": prev.get("cover_original_url"),
        "cover_meta": prev.get("meta"), "cover_history": rest, "versions": versions,
        "version": int(g.get("version") or 1) + 1, "updated_at": _iso()}})
    await gs.audit(current, "game_cover_restored", game_id)
    return {"ok": True, "cover_url": prev.get("cover_url")}


@admin2.get("/{game_id}/export")
async def export_game(game_id: str, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    await gs.audit(current, "game_exported", game_id)
    return {"export": g, "format": "ourrealm-game-v1"}


@admin2.post("/import")
async def import_game(body: dict, current: CurrentUser):
    """Insert-only import of an exported game document (new id, never overwrites)."""
    require_founder(current)
    g = body.get("export") or body.get("game")
    if not isinstance(g, dict) or not g.get("spec") or not g.get("title"):
        raise HTTPException(status_code=400, detail="Invalid export payload (need title + spec)")
    errs = gs.validate_spec(g["spec"], 1)
    if errs:
        raise HTTPException(status_code=422, detail="Spec failed validation: " + "; ".join(errs[:3]))
    new = {**g, "id": uuid.uuid4().hex, "status": "approved", "published_at": None,
           "plays": 0, "saves": 0, "versions": [], "version": 1, "showcase": False,
           "labels": list({*(g.get("labels") or []), "imported"}),
           "created_by": current["id"], "created_by_username": current.get("username"),
           "created_at": _iso(), "updated_at": _iso(), "review": {}, "build_log": []}
    new.pop("_id", None)
    await db.games.insert_one({**new})
    await gs.audit(current, "game_imported", new["id"], detail=g.get("title", "")[:80])
    return {"ok": True, "game_id": new["id"], "title": new["title"]}


@admin2.post("/{game_id}/versions/{idx}/duplicate")
async def duplicate_version(game_id: str, idx: int, current: CurrentUser):
    """Duplicate a stored version snapshot as the newest version entry."""
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    versions = g.get("versions") or []
    if not (0 <= idx < len(versions)):
        raise HTTPException(status_code=400, detail="No such version")
    dup = {**versions[idx], "version": int(g.get("version") or 1) + 1, "at": _iso(), "duplicated_from": versions[idx].get("version")}
    await db.games.update_one({"id": game_id}, {"$set": {
        "versions": (versions[-29:] + [dup]), "version": dup["version"], "updated_at": _iso()}})
    await gs.audit(current, "game_version_duplicated", game_id, detail=f"v{versions[idx].get('version')} -> v{dup['version']}")
    return {"ok": True, "version": dup["version"]}


# ─── Controls & Input Modes (per-game, versioned, runtime-aware) ─────────
RUNTIME_KEY_ACTIONS = {
    "dodge_collect": {"left": ["ArrowLeft", "a"], "right": ["ArrowRight", "d"],
                      "up": ["ArrowUp", "w"], "down": ["ArrowDown", "s"],
                      "pause": ["p"], "restart": ["r"]},
    "platformer": {"left": ["ArrowLeft", "a"], "right": ["ArrowRight", "d"],
                   "jump": ["ArrowUp", "w", " "], "pause": ["p"], "restart": ["r"]},
    "top_down": {"left": ["ArrowLeft", "a"], "right": ["ArrowRight", "d"],
                 "up": ["ArrowUp", "w"], "down": ["ArrowDown", "s"],
                 "pause": ["p"], "restart": ["r"]},
    "action_rpg_2_5d": {"left": ["ArrowLeft", "a"], "right": ["ArrowRight", "d"],
                        "up": ["ArrowUp", "w"], "down": ["ArrowDown", "s"],
                        "attack": ["j", " "], "spell": ["k"], "dodge": ["l", "Shift"],
                        "interact": ["e", "Enter"], "pause": ["p"], "restart": ["r"]},
}
TOUCH_LAYOUTS = {"dodge_collect": "drag steering (+ lane taps)", "platformer": "left / right / jump buttons",
                 "top_down": "drag joystick movement",
                 "action_rpg_2_5d": "virtual joystick + attack/spell/dodge/talk buttons",
                 "puzzle_room": "tap, type & inspect",
                 "rhythm": "tap the beat pad", "memory": "tap cards", "matching": "tap pairs",
                 "sorting": "tap categories", "quiz_adventure": "tap answers"}
CONTROLS_DEFAULTS = {
    "desktop_enabled": True, "mobile_enabled": True,
    "keyboard_map": None, "touch_layout": "auto",
    "sensitivity": 1.0, "joystick_size": 1.0, "button_size": 1.0,
    "button_position": "center", "left_handed": False, "haptics": True,
    "touch_opacity": 0.85, "swipe_sensitivity": 1.0, "hold_toggle": "hold",
    "reduced_motion": False, "high_contrast": False, "show_guide": True,
}


def game_controls(g: dict) -> dict:
    return {**CONTROLS_DEFAULTS, **((g or {}).get("controls") or {})}


def validate_controls(cfg: dict, runtime: str) -> list:
    errs = []
    if not cfg.get("desktop_enabled") and not cfg.get("mobile_enabled"):
        errs.append("At least one control mode (desktop or mobile) must stay enabled")
    km = cfg.get("keyboard_map")
    if km:
        actions = RUNTIME_KEY_ACTIONS.get(runtime) or {}
        seen = {}
        for action, keyz in km.items():
            if action not in actions:
                errs.append(f"'{action}' is not a supported action for the {runtime} runtime")
                continue
            for k in keyz or []:
                if k in seen and seen[k] != action:
                    errs.append(f"Key '{k}' is mapped to both '{seen[k]}' and '{action}'")
                seen[k] = action
        for action in actions:
            if action in ("pause", "restart"):
                continue
            if action in km and not km[action]:
                errs.append(f"Required action '{action}' has no key assigned")
    return errs


@admin2.get("/{game_id}/controls")
async def get_controls(game_id: str, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "controls": 1, "runtime": 1})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    cfg = game_controls(g)
    rt = g.get("runtime")
    return {"controls": cfg, "runtime": rt,
            "runtime_actions": RUNTIME_KEY_ACTIONS.get(rt) or {},
            "touch_layout_default": TOUCH_LAYOUTS.get(rt, "tap"),
            "validation": validate_controls(cfg, rt)}


@admin2.patch("/{game_id}/controls")
async def patch_controls(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    cfg = game_controls(g)
    if body.get("action") == "reset_keys":
        cfg["keyboard_map"] = None
    else:
        for k in ("desktop_enabled", "mobile_enabled", "left_handed", "haptics",
                  "reduced_motion", "high_contrast", "show_guide"):
            if k in body:
                cfg[k] = bool(body[k])
        for k in ("sensitivity", "joystick_size", "button_size", "touch_opacity", "swipe_sensitivity"):
            if k in body:
                cfg[k] = min(2.0, max(0.3, float(body[k])))
        for k in ("button_position", "hold_toggle", "touch_layout"):
            if k in body:
                cfg[k] = str(body[k])[:30]
        if "keyboard_map" in body:
            km = body["keyboard_map"]
            cfg["keyboard_map"] = {str(a)[:20]: [str(k)[:20] for k in (v or [])][:4]
                                   for a, v in km.items()} if isinstance(km, dict) else None
    errs = validate_controls(cfg, g.get("runtime"))
    if errs:
        raise HTTPException(status_code=400, detail="Controls validation failed: " + "; ".join(errs[:4]))
    versions = (g.get("versions") or [])[-29:] + [_versions_entry(g)]
    await db.games.update_one({"id": game_id}, {"$set": {
        "controls": cfg, "versions": versions,
        "version": int(g.get("version") or 1) + 1, "updated_at": _iso()}})
    await gs.audit(current, "game_controls_updated", game_id,
                   detail=f"desktop={cfg['desktop_enabled']} mobile={cfg['mobile_enabled']}")
    return {"controls": cfg, "validation": [], "version": int(g.get("version") or 1) + 1}


@admin2.post("/{game_id}/clone")
async def clone_game(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    ov = body.get("overrides") or {}
    new = {**g, "id": uuid.uuid4().hex, "parent_id": game_id,
           "title": str(ov.get("title") or (g["title"] + " (Clone)"))[:150],
           "status": "approved", "stage": "preview_ready", "published_at": None,
           "plays": 0, "saves": 0, "versions": [], "version": 1,
           "fire_economy": {**fire_econ(g), "pool": int(fire_econ(g).get("pool_initial") or 1_000_000), "distributed": 0},
           "showcase": bool(g.get("showcase")) and not body.get("regenerate"),
           "created_by": current["id"], "created_by_username": current.get("username"),
           "created_at": _iso(), "updated_at": _iso(), "review": {}, "build_log": []}
    for k in ("request", "complexity", "ai_power"):
        if k in ov:
            new[k] = ov[k] if k == "request" else min(max(int(ov[k]), 1), 10)
    if ov.get("options"):
        new["options"] = {**(g.get("options") or {}), **ov["options"]}
    await db.games.insert_one({**new})
    if body.get("regenerate"):
        await db.games.update_one({"id": new["id"]}, {"$set": {"status": "building", "stage": "designing"}})
        asyncio.create_task(gs._run_build(new["id"]))
    await gs.audit(current, "game_cloned", new["id"], detail=f"from {game_id}" + (" +regen" if body.get("regenerate") else ""))
    return {"game": await db.games.find_one({"id": new["id"]}, {"_id": 0, "spec": 0, "build_log": 0})}


@admin2.post("/{game_id}/rebuild")
async def rebuild_game(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    versions = (g.get("versions") or [])[-29:] + [_versions_entry(g)]
    upd = {"versions": versions, "version": int(g.get("version") or 1) + 1, "updated_at": _iso()}
    if body.get("spec"):  # direct blueprint edit — validate, no LLM cost
        spec = body["spec"]
        if isinstance(spec, str):
            try:
                spec = json.loads(spec)
            except Exception:
                raise HTTPException(status_code=400, detail="Blueprint is not valid JSON")
        spec["runtime"] = g["runtime"] if spec.get("runtime") not in gs.RUNTIMES else spec["runtime"]
        errs = gs.validate_spec(spec, g["complexity"])
        if errs:
            raise HTTPException(status_code=400, detail="Blueprint validation failed: " + "; ".join(errs[:4]))
        upd["spec"] = spec
        upd["runtime"] = spec["runtime"]
        await db.games.update_one({"id": game_id}, {"$set": upd})
        await gs.audit(current, "game_blueprint_edited", game_id, detail=f"v{upd['version']}")
        return {"game": await db.games.find_one({"id": game_id}, {"_id": 0, "build_log": 0}), "mode": "blueprint"}
    # AI regeneration in place
    for k in ("request", "complexity", "ai_power"):
        if k in body:
            upd[k] = str(body[k])[:2000] if k == "request" else min(max(int(body[k]), 1), 10)
    if body.get("options"):
        upd["options"] = {**(g.get("options") or {}), **body["options"]}
    upd.update({"status": "building", "stage": "designing", "error": None})
    await db.games.update_one({"id": game_id}, {"$set": upd})
    asyncio.create_task(gs._run_build(game_id))
    await gs.audit(current, "game_rebuilt", game_id, detail=f"v{upd['version']}")
    return {"game": await db.games.find_one({"id": game_id}, {"_id": 0, "spec": 0, "build_log": 0}), "mode": "regenerate"}


@admin2.get("/{game_id}/versions")
async def game_versions(game_id: str, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0, "versions": 1, "version": 1, "spec": 1, "plan": 1})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    return {"current_version": g.get("version") or 1, "versions": g.get("versions") or [],
            "current": {"spec": g.get("spec"), "plan": g.get("plan")}}


@admin2.post("/{game_id}/rollback")
async def rollback_game(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    idx = int(body.get("index") or 0)
    versions = g.get("versions") or []
    if not (0 <= idx < len(versions)):
        raise HTTPException(status_code=400, detail="No such version")
    v = versions[idx]
    versions = versions[-29:] + [_versions_entry(g)]
    await db.games.update_one({"id": game_id}, {"$set": {
        "spec": v.get("spec"), "plan": v.get("plan") or g.get("plan"),
        "versions": versions, "version": int(g.get("version") or 1) + 1, "updated_at": _iso()}})
    await gs.audit(current, "game_rollback", game_id, detail=f"to v{v.get('version')}")
    return {"ok": True}


def spec_similarity(a: dict, b: dict) -> float:
    """Structural comparison: controls, representation, camera, interaction, mode, envs + legacy hazard/palette."""
    ia = gs._game_identity({"spec": a, "plan": {}, "runtime": a.get("runtime")})
    ib = gs._game_identity({"spec": b, "plan": {}, "runtime": b.get("runtime")})
    s = gs.identity_similarity(ia, ib)
    ah, bh = set(), set()
    for st in a.get("stages") or []:
        ah.update(st.get("hazard_types") or [])
    for st in b.get("stages") or []:
        bh.update(st.get("hazard_types") or [])
    if ah or bh:
        s += 0.05 * len(ah & bh) / max(1, len(ah | bh))
    ap = ((a.get("visual_theme") or {}).get("palette") or {}).get("glow")
    bp = ((b.get("visual_theme") or {}).get("palette") or {}).get("glow")
    if ap and ap == bp:
        s += 0.05
    return round(min(s, 1.0), 3)


@admin2.get("/showcase/diversity")
async def showcase_diversity(current: CurrentUser):
    require_founder(current)
    rows = await db.games.find({"showcase": True}, {"_id": 0, "id": 1, "title": 1, "spec": 1}).to_list(30)
    pairs = []
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            sim = spec_similarity(rows[i].get("spec") or {}, rows[j].get("spec") or {})
            pairs.append({"a": rows[i]["title"], "a_id": rows[i]["id"], "b": rows[j]["title"],
                          "b_id": rows[j]["id"], "similarity": sim, "too_similar": sim >= 0.72})
    pairs.sort(key=lambda p: -p["similarity"])
    return {"threshold": 0.72, "pairs": pairs, "flagged": [p for p in pairs if p["too_similar"]]}


@admin2.post("/{game_id}/showcase")
async def mark_showcase(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    on = bool(body.get("showcase", True))
    await db.games.update_one({"id": game_id}, {"$set": {
        "showcase": on, "labels": (["ORAi Showcase", "Founder Example", "Fully Editable"] if on else []),
        "updated_at": _iso()}})
    await gs.audit(current, "game_showcase_" + ("on" if on else "off"), game_id)
    return {"ok": True}
