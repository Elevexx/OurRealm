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

RUNTIMES = ["quiz_adventure", "matching", "sorting", "memory", "rhythm",
            "top_down", "platformer", "dodge_collect", "puzzle_room"]
RUNTIME_LABELS = {
    "quiz_adventure": "Quiz Adventure", "matching": "Memory Matching (pairs)",
    "sorting": "Sorting / Ordering", "memory": "Memory Cards", "rhythm": "Rhythm / Tap",
    "top_down": "Top-Down Movement", "platformer": "Platformer Lite",
    "dodge_collect": "Dodge & Collect Arcade", "puzzle_room": "Puzzle Room",
}
# Deterministic genre router — checked FIRST, in order. The LLM may refine
# but can never silently reroute an action request into rhythm/quiz.
GENRE_MAP = [
    (("rhythm", "beat match", "tempo", "tap to the", "music game", "drum"), "rhythm"),
    (("escape room", "puzzle room", "escape the", "riddle", "unlock the door"), "puzzle_room"),
    (("platformer", "platform game", "jump and run", "side-scroll", "jumping game"), "platformer"),
    (("maze", "top-down", "top down", "explore the", "arena", "adventure world", "dungeon crawl"), "top_down"),
    (("runner", "dodge", "arcade", "action game", "shooter", "rush", "collect", "avoid the", "racing"), "dodge_collect"),
    (("memory game", "concentration", "flip cards", "memory cards"), "memory"),
    (("matching", "match the pairs", "pair up"), "matching"),
    (("sort", "ordering", "categorize", "put in order", "sequence the"), "sorting"),
    (("quiz", "trivia", "story adventure", "questions"), "quiz_adventure"),
]
RUNTIME_MECHANICS = {
    "rhythm": ["beat timing", "tap accuracy", "tempo ramp"],
    "puzzle_room": ["riddles", "code locks", "sequence puzzles", "hints", "room progression"],
    "platformer": ["player movement", "jumping", "gravity", "collectibles", "hazards", "goal flag", "touch controls"],
    "top_down": ["4-direction movement", "collectible cores", "patrol + chaser hazards", "obstacles", "finish portal", "touch controls"],
    "dodge_collect": ["left/right movement", "falling collectibles", "moving hazards", "increasing speed", "touch/drag controls"],
    "memory": ["card flipping", "pair recall"],
    "matching": ["pair matching"],
    "sorting": ["category sorting"],
    "quiz_adventure": ["story stages", "multiple-choice questions", "explanations"],
}
COMPLEXITY_FEATURES = {
    1: ["single mechanic", "one stage", "simple scoring", "win/lose screen"],
    2: ["3-5 stages", "increasing difficulty", "3 lives", "progress save", "richer UI", "stage transitions"],
    3: ["5+ stages", "lives + checkpoints", "combo multiplier", "achievements", "unlockables",
        "best-score save", "increasing speed/difficulty", "finish portal + results screen",
        "responsive mobile controls", "polished transitions"],
}


def route_runtime(text: str):
    low = (text or "").lower()
    for kws, rt in GENRE_MAP:
        if any(k in low for k in kws):
            return rt
    return None


COMPLEXITY_LEVELS = {
    1: "Very Simple — single screen, basic scoring",
    2: "Simple — multiple stages, progress, richer feedback",
    3: "Enhanced — adaptive difficulty, achievements, multiple scenes",
    4: "Advanced", 5: "Complex", 6: "Highly Complex", 7: "Simulation",
    8: "Large Experience", 9: "World Scale", 10: "Universe Scale",
}
MAX_COMPLEXITY = 10  # all levels unlocked; access configured via studio settings


def min_stages_for(c: int) -> int:
    return 1 if c <= 1 else 3 if c == 2 else 5 if c == 3 else 5 + (c - 3)


def complexity_features(c: int) -> list:
    if c in COMPLEXITY_FEATURES:
        return COMPLEXITY_FEATURES[c]
    return COMPLEXITY_FEATURES[3] + [f"{min_stages_for(c)}+ stages",
                                     f"deeper content & harder difficulty (level {c})"]


# ── Studio level-access settings (founder-configurable) ─────────────────
STUDIO_ACCESS_DEFAULT = {"mode": "all", "min": 1, "max": 10, "levels": []}


async def get_studio_settings() -> dict:
    doc = await db.game_studio_settings.find_one({"_id": "settings"}) or {}
    return {"complexity_access": {**STUDIO_ACCESS_DEFAULT, **(doc.get("complexity_access") or {})},
            "ai_power_access": {**STUDIO_ACCESS_DEFAULT, **(doc.get("ai_power_access") or {})}}


def levels_from(cfg: dict) -> list:
    try:
        if cfg.get("mode") == "range":
            lo = max(1, int(cfg.get("min") or 1)); hi = min(10, int(cfg.get("max") or 10))
            return list(range(lo, hi + 1)) if lo <= hi else list(range(1, 11))
        if cfg.get("mode") == "custom":
            lv = sorted({int(x) for x in (cfg.get("levels") or []) if 1 <= int(x) <= 10})
            return lv or list(range(1, 11))
    except Exception:  # noqa: BLE001
        pass
    return list(range(1, 11))


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
 "runtime": "quiz_adventure|matching|sorting|memory|rhythm|top_down|platformer|dodge_collect|puzzle_room",
 "features": ["4-7 short planned features"],
 "mechanics": ["gameplay mechanics this game will include"],
 "unsupported_mechanics": ["requested mechanics the chosen runtime cannot do, [] if none"],
 "substitutions": ["honest 'requested X -> using Y instead' notes, [] if none"],
 "gameplay_summary": "2 sentences describing moment-to-moment gameplay",
 "presentation_mode": "for dodge_collect pick: road_3d|lane_runner|vertical|space_flight|arena_360|tunnel (action/racing/runner -> road_3d or lane_runner)",
 "visual_style_summary": "1-2 sentences: art direction, palette, atmosphere",
 "player_appearance": "e.g. neon hover vehicle",
 "environment_themes": ["planned stage environments e.g. cyber_city, space, sunset, crystal"],
 "hazard_types_planned": 3, "pickup_types_planned": 2, "stage_visual_groups": 4,
 "est_play_minutes": "e.g. 10-20",
 "subject": "...", "target_age": "...", "grade_level": "...",
 "learning_objective": "one sentence", "stages": 3,
 "controls": "tap/click/drag/arrows ...", "replayability": "one sentence"}
RUNTIME ROUTING — pick the runtime whose GAMEPLAY matches the request:
- action/arcade/runner/dodge/shooter/racing/collecting -> dodge_collect
- exploration/maze/adventure world/top-down movement -> top_down
- platform/jumping/side-scrolling -> platformer
- escape room/riddles/locks -> puzzle_room
- music/beat/tempo -> rhythm
- memory/concentration -> memory | pair matching -> matching | sorting/ordering -> sorting
- trivia/story questions -> quiz_adventure
NEVER route an action/movement game into rhythm, quiz or matching. If the exact requested genre
is unsupported, choose the CLOSEST supported runtime and record it in "substitutions" honestly.
stages: 1 for complexity 1, 3-5 for complexity 2, 5+ for complexity 3."""


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
        plan["runtime"] = None
    # Deterministic genre router — an action/movement request can never be
    # silently shoehorned into a tap/quiz template.
    routed = route_runtime(str(body.get("request") or ""))
    llm_rt = plan.get("runtime")
    subs = [str(s)[:200] for s in (plan.get("substitutions") or []) if s]
    if routed and llm_rt != routed and llm_rt in (None, "rhythm", "quiz_adventure", "matching", "memory", "sorting"):
        if llm_rt:
            subs.append(f"Rerouted from {RUNTIME_LABELS[llm_rt]} to {RUNTIME_LABELS[routed]} to match the requested gameplay")
        plan["runtime"] = routed
    elif not llm_rt:
        plan["runtime"] = routed or "quiz_adventure"
        if not routed:
            subs.append("The requested genre isn't a Phase 1 runtime — using Quiz Adventure as the closest honest fit")
    rt = plan["runtime"]
    plan["runtime_label"] = RUNTIME_LABELS[rt]
    plan["substitutions"] = subs
    plan["mechanics"] = [str(m)[:80] for m in (plan.get("mechanics") or [])][:12] or RUNTIME_MECHANICS[rt]
    plan["unsupported_mechanics"] = [str(m)[:120] for m in (plan.get("unsupported_mechanics") or [])][:8]
    plan["gameplay_summary"] = str(plan.get("gameplay_summary") or plan.get("concept") or "")[:400]
    plan["complexity_features"] = complexity_features(complexity)
    plan["save_features"] = (["best score"] if complexity == 1
                             else ["best score", "progress save"] if complexity == 2
                             else ["best score", "progress save", "checkpoints", "unlockables"])
    try:
        stages = int(plan.get("stages") or 1)
    except Exception:  # noqa: BLE001
        stages = 1
    plan["stages"] = 1 if complexity == 1 else max(3, min(5, stages)) if complexity == 2 else max(min_stages_for(complexity), stages)
    plan["est_play_minutes"] = str(plan.get("est_play_minutes") or {1: "3-5", 2: "8-15", 3: "15-25"}.get(complexity, "20-45"))
    # honest presentation & visual plan
    canvas_rt = {"dodge_collect", "top_down", "platformer"}
    modes = ("road_3d", "lane_runner", "vertical", "space_flight", "arena_360", "tunnel")
    pm = str(plan.get("presentation_mode") or "")
    if rt == "dodge_collect" and pm not in modes:
        pm = "road_3d"
    elif rt != "dodge_collect":
        pm = {"top_down": "top-down arena", "platformer": "side-view platformer"}.get(rt, "standard UI")
    vp = {
        "presentation_mode": pm,
        "visual_style_summary": str(plan.get("visual_style_summary") or "")[:300],
        "player_appearance": str(plan.get("player_appearance") or ("hover vehicle" if rt == "dodge_collect" else ""))[:120],
        "environment_themes": [str(x)[:40] for x in (plan.get("environment_themes") or [])][:10],
        "hazard_types_planned": int(plan.get("hazard_types_planned") or (3 if complexity >= 7 else 2 if complexity >= 4 else 1)),
        "pickup_types_planned": int(plan.get("pickup_types_planned") or (2 if complexity >= 4 else 0)),
        "stage_visual_groups": int(plan.get("stage_visual_groups") or (4 if complexity >= 7 else 2 if complexity >= 4 else 1)),
        "fallback_shapes": bool(complexity <= 3 and rt in canvas_rt),
    }
    if rt not in canvas_rt and complexity >= 7:
        vp["visual_warning"] = (f"{RUNTIME_LABELS[rt]} is a UI-based runtime — high complexity adds depth and stages, "
                                "not arcade-style visuals. Pick an arcade runtime for cinematic presentation.")
    elif complexity <= 3 and rt in canvas_rt:
        vp["visual_warning"] = "Complexity 1-3 uses the basic themed presentation (simple procedural shapes)."
    else:
        vp["visual_warning"] = None
    plan["visual_plan"] = vp
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
dodge_collect: {"mode":"road_3d|lane_runner|vertical|space_flight|arena_360|tunnel",
 "visual_theme": REQUIRED (see below),
 "stages":[{"title":"...","mode":"road_3d","environment":"cyber_city|space|sunset|crystal|lava|tunnel|grid",
  "lanes":3,"target_cores":8,"fall_speed":140,"spawn_ms":700,"core_ratio":0.6,
  "hazard_types":["drone","barrier","seeker","mine"] (pick 1-4 per stage, VARY across stages),
  "pickups":{"shield":0.05,"boost":0.05},"formation":"zigzag|line|arc|random"}]}
  (each later stage: higher fall_speed +15-25%, lower spawn_ms, more target_cores; VARY environment,
   hazard_types, formation and optionally mode across stages — do NOT make visually identical stages)
top_down: {"stages":[{"title":"...","cores":6,"obstacles":3,"player_speed":180,"hazards":[{"type":"patrol","speed":120},{"type":"chaser","speed":80}]}]}
  (each later stage: more cores/hazards/obstacles, faster hazards; max 5 hazards)
platformer: {"stages":[{"title":"...","platforms":[{"x":0,"y":92,"w":100},{"x":10,"y":72,"w":20},...],
  "cores":[{"x":20,"y":64}],"hazards":[{"x":50,"y":88}],"goal":{"x":90,"y":16}}]}
  (x/y/w are 0-100 percent of the play area, y grows downward; first platform must be a wide floor;
   platforms must be REACHABLE by jumping ~20 y-units; goal on the highest platform)
puzzle_room: {"stages":[{"title":"Room name","intro":"scene description","puzzles":[
  {"type":"riddle","prompt":"...","answer":"one-word answer","hint":"..."},
  {"type":"code","prompt":"...","answer":"1234","hint":"..."},
  {"type":"sequence","prompt":"...","options":["step A","step B","step C"],"order":[2,0,1]},
  {"type":"choice","prompt":"...","options":["..x3"],"answer_index":1}] (2-4 puzzles per room)}]}

Wrap it as: {"runtime":"<runtime>","title":"...","description":"1-2 sentences","subject":"...",
 "grade_level":"...","learning_objective":"...","controls":"...",
 "visual_theme":{"environment":"cyber_city|space|sunset|crystal|lava|tunnel|grid",
   "player":"hover_car","player_name":"e.g. neon hover vehicle",
   "palette":{"bg":"#05060f","glow":"#2EE6FF","accent":"#F4A73B","hazard":"#FF3D5A","player":["#C26BFF","#2EE6FF"],"lane":"#2EE6FF"}},
 "theme":{"bg":"#0b1220","accent":"#2EE6FF","text":"#EAF2FF"},
 "scoring":{"points_per_correct":10,"pass_pct":70},
 "lives":3, "combo":true|false, "checkpoints":true|false,
 "unlockables":[{"stage":3,"label":"Turbo Trail"}],
 "adaptive": true|false, "achievements":[{"id":"perfect","label":"Perfect Round"}],
 "stages":[...]}
Rules: stage count and depth must match the requested complexity contract in the user message.
Difficulty must visibly ramp across stages (speed, hazards, puzzle difficulty). Educational content
must be accurate and age-appropriate. combo/checkpoints/unlockables/achievements ONLY for
complexity 3+; lives 3 for complexity 2+, lives 1 for complexity 1. English only.
VISUAL SCALING (canvas runtimes: dodge_collect, top_down, platformer):
- complexity 1-3: one environment is fine, basic hazard set.
- complexity 4-6: visual_theme required; at least 2 different stage environments; 2+ hazard_types; include pickups.
- complexity 7-10: visual_theme required; at least 4 DISTINCT stage environments across stages; 3+ hazard_types
  overall; both shield AND boost pickups; varied formations; vary mode across stage groups when it fits.
  Stages must be visually and mechanically distinct — never identical stages with only faster numbers."""


def validate_spec(spec: dict, complexity: int = 1) -> list:
    """Automated tests — every failure blocks approval submission."""
    errs = []
    if spec.get("runtime") not in RUNTIMES:
        errs.append("unknown runtime")
        return errs
    stages = spec.get("stages") or []
    if not stages:
        errs.append("no stages")
    min_stages = {1: 1, 2: 3, 3: 5}.get(complexity, 1)
    if len(stages) < min_stages:
        errs.append(f"complexity {complexity} requires at least {min_stages} stages (got {len(stages)})")
    if complexity == 3 and not spec.get("combo"):
        errs.append("complexity 3 requires combo:true")
    if complexity == 3 and not (spec.get("achievements") or []):
        errs.append("complexity 3 requires at least one achievement")
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
        elif r == "dodge_collect":
            if not st.get("target_cores"):
                errs.append(f"stage {i+1}: needs target_cores")
        elif r == "top_down":
            if not st.get("cores"):
                errs.append(f"stage {i+1}: needs cores count")
        elif r == "platformer":
            plats = st.get("platforms") or []
            if plats and not all(isinstance(p, dict) and all(k in p for k in ("x", "y", "w")) for p in plats):
                errs.append(f"stage {i+1}: platforms need x/y/w")
        elif r == "puzzle_room":
            pzs = st.get("puzzles") or []
            if not pzs:
                errs.append(f"stage {i+1}: needs puzzles")
            for p in pzs:
                t = p.get("type")
                if t == "sequence" and not (p.get("options") and p.get("order")):
                    errs.append(f"stage {i+1}: sequence puzzle needs options + order")
                elif t == "choice" and not p.get("options"):
                    errs.append(f"stage {i+1}: choice puzzle needs options")
                elif t in ("riddle", "code") and not p.get("answer"):
                    errs.append(f"stage {i+1}: {t} puzzle needs an answer")
    # difficulty must actually ramp for arcade runtimes at complexity ≥2
    if complexity >= 2 and spec.get("runtime") == "dodge_collect" and len(stages) >= 2:
        try:
            if float(stages[-1].get("fall_speed") or 0) <= float(stages[0].get("fall_speed") or 0) \
                    and int(stages[-1].get("target_cores") or 0) <= int(stages[0].get("target_cores") or 0):
                errs.append("difficulty must increase across stages (fall_speed or target_cores)")
        except Exception:  # noqa: BLE001
            pass
    # visual scaling contract (canvas runtimes)
    canvas_rt = {"dodge_collect", "top_down", "platformer"}
    if spec.get("runtime") in canvas_rt and complexity >= 4 and not spec.get("visual_theme"):
        errs.append(f"complexity {complexity} requires a visual_theme")
    if spec.get("runtime") == "dodge_collect" and complexity >= 7:
        envs = {st.get("environment") for st in stages if st.get("environment")}
        if len(envs) < 4:
            errs.append(f"complexity {complexity} requires >=4 distinct stage environments (got {len(envs)})")
        kinds = set()
        for st in stages:
            kinds.update(st.get("hazard_types") or [])
        if len(kinds) < 3:
            errs.append(f"complexity {complexity} requires >=3 hazard types overall (got {len(kinds)})")
        if not (any((st.get("pickups") or {}).get("shield") for st in stages)
                and any((st.get("pickups") or {}).get("boost") for st in stages)):
            errs.append(f"complexity {complexity} requires both shield and boost pickups")
    return errs


async def start_build(estimate: dict, current: dict) -> dict:
    game = {
        "id": uuid.uuid4().hex, "estimate_id": estimate["id"],
        "title": estimate["plan"].get("title") or "New Game",
        "status": "building", "stage": "designing",
        "complexity": estimate["complexity"], "ai_power": estimate["ai_power"],
        "runtime": estimate["plan"].get("runtime"),
        "plan": estimate["plan"],
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
        plan = game.get("plan") or {}
        user_msg = (
            f"Request: {game['request']}\nRuntime: {game['runtime']} (MANDATORY — the spec runtime must be exactly this)\n"
            f"Complexity: {game['complexity']} — {COMPLEXITY_LEVELS[game['complexity']]}\n"
            f"COMPLEXITY CONTRACT (must all be present in the spec): {', '.join(complexity_features(game['complexity']))}\n"
            f"Stages required: {plan.get('stages') or min_stages_for(game['complexity'])}\n"
            + (f"Planned mechanics: {', '.join(plan.get('mechanics') or [])}\n" if plan.get("mechanics") else "")
            + (f"Gameplay summary to implement: {plan.get('gameplay_summary')}\n" if plan.get("gameplay_summary") else "")
            + "\n".join(f"{k}: {v}" for k, v in (game.get("options") or {}).items() if v)
            + (f"\nCourse context: {json.dumps(game['course_context'])[:400]}" if game.get("course_context") else ""))
        await _log(game_id, "generating_spec", "Writing game specification in the isolated build workspace")
        raw = await call_llm(SPEC_SYSTEM, user_msg, power=game["ai_power"], json_mode=True)
        cost += t["est_cost_per_pass"]
        spec = json.loads(raw)
        errs = validate_spec(spec, game["complexity"])
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
            errs = validate_spec(spec, game["complexity"])
        if not errs and game["ai_power"] >= 7 and spec.get("runtime") in ("dodge_collect", "top_down", "platformer"):
            await _log(game_id, "art_direction", "AI Power 7+ — art direction, asset planning & stage-variation pass")
            try:
                raw2 = await call_llm(
                    SPEC_SYSTEM,
                    user_msg + "\nART DIRECTION PASS: improve the spec below — richer visual_theme palette, DISTINCT "
                    "per-stage environments/hazard_types/formations (and modes where fitting), better balance and pacing. "
                    "Keep the SAME runtime, at least the same stage count, and every complexity requirement. "
                    "Return the FULL improved spec JSON.\nCURRENT SPEC: " + json.dumps(spec)[:7000],
                    power=game["ai_power"], json_mode=True)
                cost += t["est_cost_per_pass"]
                spec2 = json.loads(raw2)
                if not validate_spec(spec2, game["complexity"]):
                    spec = spec2
            except Exception:  # noqa: BLE001
                pass
        await _log(game_id, "testing", "Running automated spec validation tests")
        errs = validate_spec(spec, game["complexity"])
        tests = {"passed": not errs, "errors": errs,
                 "checks": ["runtime schema", "stage content", "answer integrity", "category integrity"],
                 "at": _iso()}
        if errs:
            raise ValueError("Automated tests failed: " + "; ".join(errs[:3]))
        if game["complexity"] < 3:
            spec["adaptive"] = False
            spec["achievements"] = []
            spec["combo"] = False
            spec["checkpoints"] = False
            spec["unlockables"] = []
        spec["lives"] = 1 if game["complexity"] == 1 else int(spec.get("lives") or 3)
        # The routed runtime is a hard contract — the model can never swap it.
        spec["runtime"] = game["runtime"]
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
