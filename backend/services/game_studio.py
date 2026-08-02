"""ORAi Game Studio — Phase 1 game creation engine.

Sandboxed spec + vetted runtime architecture: ORAi designs and writes the
game CONTENT/CONFIG (a validated JSON spec) which runs inside a set of
vetted browser runtimes in a sandboxed iframe (no access to production
APIs, auth, secrets or the parent DOM). Complexity levels 1-3 are fully
functional; 4-10 are honestly locked for future phases. AI Power 1-10 maps
to real model routing + passes (services.llm_router).

Pipeline: estimate (ALWAYS, before any build) → founder Approve & Build →
staged async build (design → spec → automated validation tests) →
pending_approval → founder preview/approve → publish to /games.
Collections: games, game_estimates, game_progress, game_audit.
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from core.db import db
from services.llm_router import call_llm, tier

log = logging.getLogger("ourrealm.games")

RUNTIMES = ["quiz_adventure", "matching", "sorting", "memory", "rhythm"]
COMPLEXITY_LEVELS = {
    1: "Very Simple — single screen, basic scoring",
    2: "Simple — multiple stages, progress, richer feedback",
    3: "Enhanced — adaptive difficulty, achievements, multiple scenes",
    4: "Advanced", 5: "Complex", 6: "Highly Complex", 7: "Simulation",
    8: "Large Experience", 9: "World Scale", 10: "Universe Scale",
}
MAX_COMPLEXITY = 3  # Phase 1


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def audit(actor, action, game_id=None, detail="", cost=None):
    try:
        await db.game_audit.insert_one({
            "id": uuid.uuid4().hex, "at": _iso(), "action": action, "game_id": game_id,
            "actor_id": (actor or {}).get("id"), "actor_username": (actor or {}).get("username"),
            "detail": str(detail)[:500], "cost": cost})
    except Exception:  # noqa: BLE001
        pass


# ── Cost estimate (always required before generation) ───────────────────
EST_SYSTEM = """You are ORAi's game designer. Turn a game request into a short build plan.
Reply ONLY valid JSON:
{"title": "game name", "concept": "2-3 sentence pitch",
 "runtime": "quiz_adventure|matching|sorting|memory|rhythm",
 "features": ["4-7 short planned features"],
 "subject": "...", "target_age": "...", "grade_level": "...",
 "learning_objective": "one sentence", "stages": 3,
 "controls": "tap/click ...", "replayability": "one sentence"}
Pick the runtime that best fits the request. stages: 1 for very simple, 2-4 for staged games."""


async def create_estimate(body: dict, current: dict) -> dict:
    complexity = min(max(int(body.get("complexity") or 1), 1), MAX_COMPLEXITY)
    power = min(max(int(body.get("ai_power") or 5), 1), 10)
    t = tier(power)
    raw = await call_llm(EST_SYSTEM, str(body.get("request") or "")[:1200],
                         power=min(power, 4), json_mode=True, max_tokens=900)
    try:
        plan = json.loads(raw)
    except Exception:  # noqa: BLE001
        plan = {"title": "New Game", "concept": raw[:300], "runtime": "quiz_adventure",
                "features": [], "stages": 1}
    if plan.get("runtime") not in RUNTIMES:
        plan["runtime"] = "quiz_adventure"
    build_cost = round(t["est_cost"] + 0.01 * complexity, 2)
    est = {
        "id": uuid.uuid4().hex, "status": "awaiting_approval",
        "request": str(body.get("request") or "")[:1200],
        "complexity": complexity, "ai_power": power, "tier": t,
        "plan": plan,
        "options": {k: str(body.get(k) or "")[:120] for k in
                    ("target_age", "grade_level", "subject", "visual_style", "audio", "accessibility")},
        "course_context": body.get("course_context") or None,
        "estimates": {
            "provider_cost": build_cost, "generation_time_min": 1 + t["passes"],
            "storage_kb": 40 + 20 * complexity, "media_assets": 0,
            "code_size": f"~{6 + 4 * complexity}KB spec + vetted runtime",
            "testing": f"{t['passes']} refinement pass(es) + automated spec validation"},
        "created_by": current["id"], "created_by_username": current.get("username"),
        "created_at": _iso(),
    }
    await db.game_estimates.insert_one({**est})
    await audit(current, "game_cost_estimated", detail=f"{plan.get('title')} · ${build_cost}")
    return est


# ── Build pipeline (async, staged, audited) ──────────────────────────────
SPEC_SYSTEM = """You are ORAi's game builder. Produce the COMPLETE content spec for a vetted browser runtime.
Reply ONLY valid JSON matching the runtime schema:

quiz_adventure: {"stages":[{"title":"...","story":"1-2 sentences","questions":[{"q":"...","options":["..x3-4"],"answer_index":0,"explanation":"..."}]}]}
matching: {"stages":[{"title":"...","pairs":[{"left":"...","right":"..."}] (5-8 pairs)}]}
sorting: {"stages":[{"title":"...","categories":["A","B"],"items":[{"label":"...","category":"A"}] (6-10 items)}]}
memory: {"stages":[{"title":"...","cards":["term1","term2",...] (6-8 unique terms, runtime duplicates them)}]}
rhythm: {"stages":[{"title":"...","bpm":90,"pattern":[1,0,1,1,0,1,0,1] (16 beats, 1=tap),"lesson_tip":"..."}]}

Wrap it as: {"runtime":"<runtime>","title":"...","description":"1-2 sentences","subject":"...",
 "grade_level":"...","learning_objective":"...","controls":"...",
 "theme":{"bg":"#0b1220","accent":"#2EE6FF","text":"#EAF2FF"},
 "scoring":{"points_per_correct":10,"pass_pct":70},
 "adaptive": true|false, "achievements":[{"id":"perfect","label":"Perfect Round"}],
 "stages":[...]}
Rules: stage count and depth must match the requested complexity. Educational content must be
accurate and age-appropriate. adaptive+achievements ONLY for complexity 3. English only."""


def validate_spec(spec: dict) -> list:
    """Automated tests — every failure blocks approval submission."""
    errs = []
    if spec.get("runtime") not in RUNTIMES:
        errs.append("unknown runtime")
        return errs
    stages = spec.get("stages") or []
    if not stages:
        errs.append("no stages")
    for i, st in enumerate(stages):
        r = spec["runtime"]
        if r == "quiz_adventure":
            qs = st.get("questions") or []
            if not qs:
                errs.append(f"stage {i+1}: no questions")
            for q in qs:
                if not q.get("options") or not (0 <= int(q.get("answer_index", -1)) < len(q["options"])):
                    errs.append(f"stage {i+1}: bad answer_index")
        elif r == "matching" and len(st.get("pairs") or []) < 3:
            errs.append(f"stage {i+1}: needs ≥3 pairs")
        elif r == "sorting":
            cats = st.get("categories") or []
            if len(cats) < 2 or not st.get("items"):
                errs.append(f"stage {i+1}: needs 2+ categories and items")
            elif any(it.get("category") not in cats for it in st["items"]):
                errs.append(f"stage {i+1}: item with unknown category")
        elif r == "memory" and len(set(st.get("cards") or [])) < 4:
            errs.append(f"stage {i+1}: needs ≥4 unique cards")
        elif r == "rhythm":
            if not st.get("pattern") or not st.get("bpm"):
                errs.append(f"stage {i+1}: needs bpm + pattern")
    return errs


async def start_build(estimate: dict, current: dict) -> dict:
    game = {
        "id": uuid.uuid4().hex, "estimate_id": estimate["id"],
        "title": estimate["plan"].get("title") or "New Game",
        "status": "building", "stage": "designing",
        "complexity": estimate["complexity"], "ai_power": estimate["ai_power"],
        "runtime": estimate["plan"].get("runtime"),
        "request": estimate["request"], "options": estimate["options"],
        "course_context": estimate.get("course_context"),
        "spec": None, "test_results": None, "build_log": [],
        "est_cost": estimate["estimates"]["provider_cost"], "actual_cost": 0.0,
        "plays": 0, "saves": 0,
        "created_by": current["id"], "created_by_username": current.get("username"),
        "created_at": _iso(), "updated_at": _iso(),
        "review": {}, "published_at": None,
    }
    await db.games.insert_one({**game})
    await db.game_estimates.update_one({"id": estimate["id"]}, {"$set": {"status": "building", "game_id": game["id"]}})
    await audit(current, "game_build_started", game["id"], detail=game["title"])
    asyncio.create_task(_run_build(game["id"]))
    return game


async def _log(game_id, stage, msg):
    await db.games.update_one({"id": game_id}, {
        "$set": {"stage": stage, "updated_at": _iso()},
        "$push": {"build_log": {"at": _iso(), "stage": stage, "msg": str(msg)[:300]}}})


async def _run_build(game_id: str):
    game = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        return
    t = tier(game["ai_power"])
    cost = 0.0
    try:
        await _log(game_id, "designing", f"AI Power {game['ai_power']} → {t['label']} ({t['passes']} passes)")
        user_msg = (
            f"Request: {game['request']}\nRuntime: {game['runtime']}\n"
            f"Complexity: {game['complexity']} — {COMPLEXITY_LEVELS[game['complexity']]}\n"
            + "\n".join(f"{k}: {v}" for k, v in (game.get("options") or {}).items() if v)
            + (f"\nCourse context: {json.dumps(game['course_context'])[:400]}" if game.get("course_context") else ""))
        await _log(game_id, "generating_spec", "Writing game specification in the isolated build workspace")
        raw = await call_llm(SPEC_SYSTEM, user_msg, power=game["ai_power"], json_mode=True)
        cost += t["est_cost_per_pass"]
        spec = json.loads(raw)
        errs = validate_spec(spec)
        # refinement passes: fix validation errors / review quality
        for p in range(t["passes"] - 1):
            if not errs and p > 0:
                break
            await _log(game_id, "refining", f"Review pass {p+1}" + (f" — fixing: {errs[:2]}" if errs else " — quality/accessibility review"))
            raw = await call_llm(
                SPEC_SYSTEM,
                user_msg + f"\n\nPrevious spec:\n{json.dumps(spec)[:6000]}\n\n"
                + (f"FIX these validation errors: {errs}" if errs
                   else "Review and improve: educational accuracy, difficulty curve, clarity, accessibility. Return the full improved spec."),
                power=game["ai_power"], json_mode=True)
            cost += t["est_cost_per_pass"]
            try:
                spec = json.loads(raw)
            except Exception:  # noqa: BLE001
                pass
            errs = validate_spec(spec)
        await _log(game_id, "testing", "Running automated spec validation tests")
        errs = validate_spec(spec)
        tests = {"passed": not errs, "errors": errs,
                 "checks": ["runtime schema", "stage content", "answer integrity", "category integrity"],
                 "at": _iso()}
        if errs:
            raise ValueError("Automated tests failed: " + "; ".join(errs[:3]))
        if game["complexity"] < 3:
            spec["adaptive"] = False
            spec["achievements"] = []
        spec["runtime"] = game["runtime"] if spec.get("runtime") not in RUNTIMES else spec["runtime"]
        await db.games.update_one({"id": game_id}, {"$set": {
            "spec": spec, "test_results": tests, "status": "pending_approval",
            "stage": "preview_ready", "actual_cost": round(cost, 3),
            "title": str(spec.get("title") or game["title"])[:150], "updated_at": _iso()}})
        await audit(None, "game_build_completed", game_id, detail=spec.get("title"), cost=round(cost, 3))
        from services import responsibility_center as rc
        await rc.notify_user(game["created_by"], "game_ready",
                             f"\"{spec.get('title')}\" is built, tested and ready for review!",
                             f"/admin/games?game={game_id}")
    except Exception as e:  # noqa: BLE001
        log.warning("game build failed %s: %s", game_id, e)
        await db.games.update_one({"id": game_id}, {"$set": {
            "status": "failed", "stage": "failed", "error": str(e)[:400],
            "actual_cost": round(cost, 3), "updated_at": _iso()}})
        await audit(None, "game_build_failed", game_id, detail=str(e)[:200], cost=round(cost, 3))
