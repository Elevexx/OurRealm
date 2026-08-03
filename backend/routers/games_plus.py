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

public2 = APIRouter(prefix="/api/games", tags=["games-plus"])
admin2 = APIRouter(prefix="/api/admin/games", tags=["games-plus-admin"])

REWARD_DEFAULTS = {"enabled": False, "first_completion": 5, "new_best": 2,
                   "achievement": 3, "daily_challenge": 5, "weekly_challenge": 15}


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def reward_settings() -> dict:
    doc = await db.game_reward_settings.find_one({"_id": "settings"}) or {}
    return {**REWARD_DEFAULTS, **{k: doc[k] for k in REWARD_DEFAULTS if k in doc}}


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
    return {"ok": True, "best_score": max(score, prev_best), "new_achievements": new_ach,
            "fire_rewards": granted}


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
            "complexity": g.get("complexity"), "ai_power": g.get("ai_power"), "request": g.get("request")}


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
    versions = (g.get("versions") or [])[-5:] + [_versions_entry(g)]
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
    versions = versions[-5:] + [_versions_entry(g)]
    await db.games.update_one({"id": game_id}, {"$set": {
        "spec": v.get("spec"), "plan": v.get("plan") or g.get("plan"),
        "versions": versions, "version": int(g.get("version") or 1) + 1, "updated_at": _iso()}})
    await gs.audit(current, "game_rollback", game_id, detail=f"to v{v.get('version')}")
    return {"ok": True}


def spec_similarity(a: dict, b: dict) -> float:
    s = 0.0
    if a.get("runtime") == b.get("runtime"):
        s += 0.35
    am = {st.get("mode") for st in a.get("stages") or [] if st.get("mode")} or {a.get("mode")}
    bm = {st.get("mode") for st in b.get("stages") or [] if st.get("mode")} or {b.get("mode")}
    if am & bm:
        s += 0.15 * len(am & bm) / max(1, len(am | bm))
    ae = {st.get("environment") for st in a.get("stages") or [] if st.get("environment")}
    be = {st.get("environment") for st in b.get("stages") or [] if st.get("environment")}
    if ae or be:
        s += 0.2 * len(ae & be) / max(1, len(ae | be))
    ah, bh = set(), set()
    for st in a.get("stages") or []:
        ah.update(st.get("hazard_types") or [])
    for st in b.get("stages") or []:
        bh.update(st.get("hazard_types") or [])
    if ah or bh:
        s += 0.15 * len(ah & bh) / max(1, len(ah | bh))
    ap = ((a.get("visual_theme") or {}).get("palette") or {}).get("glow")
    bp = ((b.get("visual_theme") or {}).get("palette") or {}).get("glow")
    if ap and ap == bp:
        s += 0.1
    if (a.get("visual_theme") or {}).get("player") == (b.get("visual_theme") or {}).get("player"):
        s += 0.05
    return round(s, 3)


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
