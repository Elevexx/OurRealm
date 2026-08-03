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
import re
from datetime import datetime, timezone

from core.db import db
from services.llm_router import call_llm, tier

log = logging.getLogger("ourrealm.games")

RUNTIMES = ["quiz_adventure", "matching", "sorting", "memory", "rhythm",
            "top_down", "platformer", "dodge_collect", "puzzle_room",
            "card_battle", "tower_defense", "match3",
            "rpg", "racing", "farming", "city_builder"]
# Registered in the catalog but not yet playable — classification detects them,
# generation refuses them with an explicit "not supported yet" + approval gate.
SCAFFOLDED_RUNTIMES = {
    "roguelike": "Roguelike", "tactics": "Tactical Strategy", "idle": "Idle / Incremental",
    "visual_novel": "Visual Novel", "fishing": "Fishing",
}
RUNTIME_LABELS = {
    "quiz_adventure": "Quiz Adventure", "matching": "Memory Matching (pairs)",
    "sorting": "Sorting / Ordering", "memory": "Memory Cards", "rhythm": "Rhythm / Tap",
    "top_down": "Top-Down Movement", "platformer": "Platformer Lite",
    "dodge_collect": "Dodge & Collect Arcade", "puzzle_room": "Puzzle Room",
    "card_battle": "Card Battle", "tower_defense": "Tower Defense", "match3": "Match-3 Puzzle",
    "rpg": "RPG Adventure", "racing": "Racing", "farming": "Farming", "city_builder": "City Builder",
    **SCAFFOLDED_RUNTIMES,
}
# Template registry — every catalog family maps to exactly one vetted template.
TEMPLATE_IDS = {rt: f"tpl_{rt}_v1" for rt in RUNTIMES + list(SCAFFOLDED_RUNTIMES)}
WIN_LOSS = {
    "card_battle": ("defeat the enemy (enemy HP to 0)", "player HP reaches 0"),
    "tower_defense": ("survive every wave with the base standing", "base HP reaches 0"),
    "match3": ("complete the stage objective within the move limit", "moves run out before the objective"),
    "rpg": ("complete the quest and reach the exit", "HP reaches 0 in combat"),
    "racing": ("finish all laps in 1st-3rd place", "finish last / miss checkpoints"),
    "farming": ("reach the coin goal before the season ends", "season ends short of the goal"),
    "city_builder": ("grow the city to the population target", "treasury and food collapse"),
    "dodge_collect": ("collect the target cores and reach the portal", "all lives lost"),
    "top_down": ("collect all cores and reach the exit portal", "all lives lost"),
    "platformer": ("reach the goal portal", "all lives lost"),
    "puzzle_room": ("solve every puzzle to unlock the door", "n/a (untimed)"),
    "rhythm": ("hit enough beats per track", "accuracy below pass threshold"),
    "memory": ("clear every pair", "accuracy below pass threshold"),
    "matching": ("match all pairs", "accuracy below pass threshold"),
    "sorting": ("sort all items", "accuracy below pass threshold"),
    "quiz_adventure": ("answer through the story", "accuracy below pass threshold"),
}
# Deterministic genre router — checked FIRST, in order. The LLM may refine
# but can never silently reroute an action request into rhythm/quiz.
GENRE_MAP = [
    (("card battle", "card battler", "card game", "card clash", "deck build", "deckbuild", "tcg", "card duel"), "card_battle"),
    (("tower defense", "tower defence", "defend the base", "td game", "place towers", "wave defense"), "tower_defense"),
    (("match 3", "match-3", "match three", "gem swap", "tile match", "match puzzle", "bejeweled", "candy crush"), "match3"),
    (("rpg", "jrpg", "role playing", "role-playing", "creature collect", "creature-collect", "monster catching",
      "monster taming", "monster collector", "creature companion", "catch creatures", "catch monsters",
      "pokemon", "monster battle adventure", "creature battle"), "rpg"),
    (("racing", "race track", "kart", "lap race", "street race", "drift", "grand prix"), "racing"),
    (("farming", "farm sim", "farm simulator", "harvest game", "crop game", "plant and harvest"), "farming"),
    (("city builder", "city building", "build a city", "town builder", "settlement builder"), "city_builder"),
    (("roguelike", "rogue-like", "dungeon crawler", "permadeath"), "roguelike"),
    (("tactical strategy", "turn-based strategy", "tactics game", "grid combat", "xcom"), "tactics"),
    (("idle game", "incremental game", "clicker", "prestige game"), "idle"),
    (("visual novel", "dating sim", "branching story", "interactive fiction"), "visual_novel"),
    (("fishing", "fish catching", "angling"), "fishing"),
    (("rhythm", "beat match", "tempo", "tap to the", "music game", "drum"), "rhythm"),
    (("escape room", "puzzle room", "escape the", "riddle", "unlock the door"), "puzzle_room"),
    (("platformer", "platform game", "jump and run", "side-scroll", "jumping game"), "platformer"),
    (("maze", "top-down", "top down", "explore the", "arena", "adventure world", "dungeon crawl"), "top_down"),
    (("memory game", "concentration", "flip cards", "memory cards"), "memory"),
    (("matching", "match the pairs", "pair up"), "matching"),
    (("sort", "ordering", "categorize", "put in order", "sequence the"), "sorting"),
    (("quiz", "trivia", "story adventure", "questions", "narrative"), "quiz_adventure"),
    # generic action keywords LAST so specific genres always win
    (("runner", "dodge", "arcade", "action game", "shooter", "rush", "collect", "avoid the", "racing"), "dodge_collect"),
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
    "card_battle": ["deck & hand", "draw/discard piles", "turn-based combat", "mana/energy",
                    "attack/defense/special cards", "enemy AI", "player & enemy health"],
    "tower_defense": ["tower placement", "upgrade/sell towers", "enemy pathing", "waves",
                      "multiple enemy types", "range & damage", "base health", "resources"],
    "match3": ["tile grid", "swap adjacent tiles", "match detection", "cascades",
               "combo multiplier", "objectives", "move limit"],
    "rpg": ["overworld exploration", "world map zones (towns & dungeons)", "quests", "NPC dialogue",
            "inventory", "equipment", "XP & leveling", "turn-based battles",
            "creature collection", "party system", "creature evolution"],
    "racing": ["laps & checkpoints", "AI racers", "steering", "drift", "boost pads", "position leaderboard"],
    "farming": ["plant seeds", "watering", "growth timers", "harvesting", "crafting goods", "seasonal day cycle", "market sales"],
    "city_builder": ["building placement", "gold/food/population economy", "production chains",
                     "housing & growth", "expansion"],
    "roguelike": ["procedural levels", "permadeath", "randomized loot", "run upgrades"],
    "tactics": ["grid movement", "turn-based combat", "abilities", "cover", "enemy AI turns"],
    "idle": ["passive generation", "automation", "upgrades", "prestige"],
    "visual_novel": ["branching dialogue", "portraits", "choices", "multiple endings"],
    "fishing": ["casting", "timing catch", "bait", "fish rarity", "collection"],
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
        for k in kws:
            if re.search(r"(?<![a-z-])" + re.escape(k) + r"(?![a-z])", low):
                return rt
    return None


# Genres users can name that no vetted runtime implements yet. Naming one of
# these must surface "not supported yet" + explicit substitution approval (B5).
UNSUPPORTED_GENRES = [
    (("cooking", "time management", "restaurant game", "kitchen game", "serve customers", "food truck"), "Cooking / Time Management"),
    (("word puzzle", "word game", "crossword", "word search", "anagram", "spelling game"), "Word Puzzle"),
    (("bubble shooter", "bubble pop", "bubble blast"), "Bubble Shooter"),
    (("city builder", "tycoon", "simulation city", "farming sim"), "Builder / Tycoon Simulation"),
    (("fighting game", "beat em up", "beat-em-up", "brawler"), "Fighting / Brawler"),
]


def detect_unsupported(text: str):
    low = (text or "").lower()
    for kws, label in UNSUPPORTED_GENRES:
        for k in kws:
            if re.search(r"(?<![a-z-])" + re.escape(k) + r"(?![a-z])", low):
                return label
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


# ── Player representation contract + structural identity ────────────────
PLAYER_REPS = {
    "dodge_collect": ["hovercraft", "spaceship", "hover_bike", "runner", "rolling_orb"],
    "top_down": ["explorer", "stealth_operative", "robot", "knight", "wizard", "rolling_orb"],
    "platformer": ["platform_hero", "explorer", "knight", "robot", "wizard"],
    "puzzle_room": ["puzzle_cursor"],
    "rhythm": ["rhythm_notes"],
    "memory": ["cards"],
    "matching": ["cards"],
    "sorting": ["cards"],
    "quiz_adventure": ["puzzle_cursor"],
    "card_battle": ["card_commander"],
    "tower_defense": ["tower_commander"],
    "match3": ["puzzle_cursor"],
    "rpg": ["hero_sprite"],
    "racing": ["race_car"],
    "farming": ["farmer_cursor"],
    "city_builder": ["mayor_cursor"],
}


def default_rep(rt: str, mode: str = "") -> str:
    if rt == "dodge_collect":
        return "spaceship" if mode == "space_flight" else "hovercraft"
    return (PLAYER_REPS.get(rt) or ["puzzle_cursor"])[0]


DC_CONTROLS = {"road_3d": "steer left/right on a 3D road", "lane_runner": "discrete lane switching",
               "vertical": "horizontal steering", "space_flight": "free 2D flight in all directions",
               "arena_360": "free movement, 360° threats", "tunnel": "radial steering in a tunnel"}
DC_CAMERAS = {"road_3d": "pseudo-3D chase cam", "lane_runner": "vertical scroll", "vertical": "vertical scroll",
              "space_flight": "side-scrolling space", "arena_360": "fixed overhead arena", "tunnel": "pseudo-3D tunnel"}
IDENTITY_BASE = {
    "top_down": ("free top-down movement (arrows/WASD/touch)", "overhead camera",
                 "move, collect cores, evade patrols & chasers", "explore arena → collect all cores → reach exit portal"),
    "platformer": ("run + jump (gravity, platforms)", "side-view camera",
                   "jump between platforms, collect, avoid spikes", "traverse platforms → collect gems → reach goal portal"),
    "puzzle_room": ("point-and-click + typed answers", "static room UI",
                    "inspect, solve riddles/codes/sequences", "solve every puzzle → unlock door → next room"),
    "rhythm": ("timed taps to the beat", "static stage UI", "tap in the beat window", "hit enough beats per track → next song"),
    "memory": ("click to flip cards", "card grid UI", "flip & match pairs", "clear every pair → next round"),
    "matching": ("click to pair items", "two-column UI", "match left to right", "match all pairs → next stage"),
    "sorting": ("click to categorize", "category UI", "assign items to categories", "sort all items → next stage"),
    "quiz_adventure": ("click to answer", "story UI", "answer story questions", "answer through the story → finale"),
    "card_battle": ("click/tap cards to play them (mana gated) + end-turn button", "battle table UI",
                    "draw a hand, spend mana on attack/defense/special cards, end turn, survive enemy attacks",
                    "draw → play cards → end turn → enemy acts → repeat until one side falls"),
    "tower_defense": ("select a tower then click/tap a build spot; upgrade/sell placed towers", "fixed overhead map",
                      "place & upgrade towers to stop pathing enemy waves before they reach the base",
                      "build phase → wave assault → earn resources → reinforce → next wave"),
    "match3": ("click/tap or drag to swap adjacent tiles", "fixed tile-grid board",
               "swap tiles to form 3+ matches, trigger cascades, hit the objective within the move limit",
               "swap → match → cascade → objective progress → next stage"),
    "rpg": ("tap/click a tile to step toward it; combat via action buttons", "top-down overworld grid",
            "explore, talk to NPCs, take quests, loot chests, equip gear, fight monsters, level up",
            "explore → quest → fight → loot & level → unlock exit"),
    "racing": ("←/→ steer · space drift · touch steering buttons", "top-down chase camera on a circuit",
               "steer through checkpoints, drift corners, grab boosts, beat AI racers across laps",
               "race lap → hit checkpoints → overtake AI → finish placement"),
    "farming": ("tap plots to plant/water/harvest · tap goods to craft & sell", "fixed farm-plot grid",
                "plant seeds, water them, harvest crops, craft goods and sell before the season ends",
                "plant → water → grow → harvest → craft → sell → next day"),
    "city_builder": ("tap a building type, then a free tile to construct", "fixed city grid",
                     "place houses, farms, mines and markets to balance gold/food and grow population",
                     "build → produce → feed & grow population → expand → reach target"),
}


def plan_identity(rt: str, mode: str, rep: str) -> dict:
    if rt == "dodge_collect":
        control, camera = DC_CONTROLS.get(mode, "steering"), DC_CAMERAS.get(mode, "scrolling")
        interaction, loop = "dodge hazards, collect cores & pickups", "survive + collect target cores → portal → harder stage"
    else:
        control, camera, interaction, loop = IDENTITY_BASE[rt]
    return {"runtime_family": RUNTIME_LABELS[rt], "control_model": control, "camera_model": camera,
            "primary_interaction": interaction, "core_loop": loop, "player_representation": rep}


def _game_identity(g: dict) -> dict:
    spec, plan = g.get("spec") or {}, g.get("plan") or {}
    rt = spec.get("runtime") or g.get("runtime")
    if rt not in RUNTIMES:
        return {}
    modes = [st.get("mode") for st in (spec.get("stages") or []) if st.get("mode")]
    mode = spec.get("mode") or (modes[0] if modes else "") or str((plan.get("visual_plan") or {}).get("presentation_mode") or "")
    rep = spec.get("player_representation") or plan.get("player_representation") or default_rep(rt, mode)
    ident = plan_identity(rt, mode, rep)
    ident["mode"] = mode
    envs = {st.get("environment") for st in (spec.get("stages") or []) if st.get("environment")}
    ident["environments"] = sorted(envs or set((plan.get("visual_plan") or {}).get("environment_themes") or []))
    return ident


def identity_similarity(a: dict, b: dict) -> float:
    """Structural similarity: controls, representation, camera, interaction — not just labels."""
    if not a or not b:
        return 0.0
    s = 0.0
    if a.get("runtime_family") == b.get("runtime_family"):
        s += 0.25
    if a.get("control_model") == b.get("control_model"):
        s += 0.2
    if a.get("player_representation") == b.get("player_representation"):
        s += 0.15
    if a.get("camera_model") == b.get("camera_model"):
        s += 0.1
    if a.get("mode") and a.get("mode") == b.get("mode"):
        s += 0.1
    if a.get("primary_interaction") == b.get("primary_interaction"):
        s += 0.1
    ea, eb = set(a.get("environments") or []), set(b.get("environments") or [])
    if ea or eb:
        s += 0.1 * len(ea & eb) / max(1, len(ea | eb))
    return round(s, 3)


SIMILARITY_BLOCK = 0.75

FIRE_ECON_DEFAULTS = {
    "enabled": True, "paused": False,
    "pool": 1_000_000, "pool_initial": 1_000_000, "distributed": 0,
    "daily_player_cap": 0, "claim_cooldown_s": 0,
    "rewards": {"completion": 10, "perfect": 5, "speed": 5, "speed_time_s": 300,
                "hidden_objective": 0, "achievement": 5, "boss": 0,
                "daily": 0, "weekly": 0, "final_completion": 100},
}


def _controls_from_options(options: dict) -> dict:
    sc = str((options or {}).get("supported_controls") or "both").lower()
    return {"desktop_enabled": sc in ("both", "desktop", "auto"),
            "mobile_enabled": sc in ("both", "mobile", "auto")}


async def showcase_similarity_for(ident: dict, exclude_id: str = None) -> dict:
    rows = await db.games.find({"showcase": True},
                               {"_id": 0, "id": 1, "title": 1, "spec": 1, "plan": 1, "runtime": 1}).to_list(30)
    best, match = 0.0, None
    for g in rows:
        if exclude_id and g.get("id") == exclude_id:
            continue
        sim = identity_similarity(ident, _game_identity(g))
        if sim > best:
            best, match = sim, g.get("title")
    return {"score": best, "top_match": match, "threshold": SIMILARITY_BLOCK, "blocked": best >= SIMILARITY_BLOCK}


# ── Cost estimate (always required before generation) ───────────────────
EST_SYSTEM = """You are ORAi's game designer. Turn a game request into a short build plan.
Reply ONLY valid JSON:
{"title": "game name", "concept": "2-3 sentence pitch",
 "runtime": "quiz_adventure|matching|sorting|memory|rhythm|top_down|platformer|dodge_collect|puzzle_room|card_battle|tower_defense|match3|rpg|racing|farming|city_builder",
 "features": ["4-7 short planned features"],
 "mechanics": ["gameplay mechanics this game will include"],
 "unsupported_mechanics": ["requested mechanics the chosen runtime cannot do, [] if none"],
 "substitutions": ["honest 'requested X -> using Y instead' notes, [] if none"],
 "gameplay_summary": "2 sentences describing moment-to-moment gameplay",
 "presentation_mode": "for dodge_collect pick: road_3d|lane_runner|vertical|space_flight|arena_360|tunnel (action/racing/runner -> road_3d or lane_runner)",
 "visual_style_summary": "1-2 sentences: art direction, palette, atmosphere",
 "player_appearance": "e.g. neon hover vehicle",
 "player_representation": "REQUIRED — pick ONE that fits the theme. dodge_collect: hovercraft|spaceship|hover_bike|runner|rolling_orb · top_down: explorer|stealth_operative|robot|knight|wizard|rolling_orb · platformer: platform_hero|explorer|knight|robot|wizard · puzzle_room: puzzle_cursor · rhythm: rhythm_notes · memory/matching/sorting: cards · quiz_adventure: puzzle_cursor. NEVER default to spaceship unless the game is actually set in space.",
 "environment_themes": ["planned stage environments e.g. cyber_city, space, sunset, crystal"],
 "hazard_types_planned": 3, "pickup_types_planned": 2, "stage_visual_groups": 4,
 "est_play_minutes": "e.g. 10-20",
 "subject": "...", "target_age": "...", "grade_level": "...",
 "learning_objective": "one sentence", "stages": 3,
 "controls": "tap/click/drag/arrows ...", "replayability": "one sentence"}
RUNTIME ROUTING — pick the runtime whose GAMEPLAY matches the request:
- action/arcade/runner/dodge/shooter/racing/collecting -> dodge_collect
- card battler/deck builder/TCG/turn-based card combat -> card_battle
- tower defense/wave defense/place towers -> tower_defense
- match-3/gem swap/tile matching puzzle -> match3
- RPG/JRPG/quests+NPCs+leveling -> rpg
- racing/karts/laps -> racing
- farming/planting/harvest -> farming
- city building/settlement economy -> city_builder
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
    if routed in SCAFFOLDED_RUNTIMES:
        routed = None  # registered in catalog but not yet playable — handled as explicit fallback below
    llm_rt = plan.get("runtime")
    if llm_rt in SCAFFOLDED_RUNTIMES or (llm_rt and llm_rt not in RUNTIMES):
        llm_rt = None
        plan["runtime"] = None
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
    plan["template_id"] = TEMPLATE_IDS[rt]
    plan["win_condition"], plan["loss_condition"] = WIN_LOSS.get(rt, ("complete all stages", "run out of lives"))
    # Explicit fallback contract — never silent (B5/C).
    req_text = str(body.get("request") or "")
    unsupported_genre = detect_unsupported(req_text)
    scaffold_hit = None
    _raw_route = route_runtime(req_text)
    if _raw_route in SCAFFOLDED_RUNTIMES:
        scaffold_hit = SCAFFOLDED_RUNTIMES[_raw_route]
    fallback_used = bool(unsupported_genre) or bool(scaffold_hit) or ((not routed) and (llm_rt is None))
    plan["fallback_used"] = bool(fallback_used)
    if scaffold_hit:
        plan["fallback_reason"] = (f"This game type is not supported yet ({scaffold_hit} is registered in the "
                                   f"runtime catalog — coming soon). ORAi proposes {RUNTIME_LABELS[rt]} as a "
                                   "substitution — generation only proceeds if you explicitly accept it.")
        subs.append(f"Requested {scaffold_hit} (catalog, not yet playable) -> proposing {RUNTIME_LABELS[rt]}")
    elif unsupported_genre:
        plan["fallback_reason"] = (f"This game type is not supported yet ({unsupported_genre}). "
                                   f"ORAi proposes {RUNTIME_LABELS[rt]} as a substitution — generation only "
                                   "proceeds if you explicitly accept it.")
        subs.append(f"Requested {unsupported_genre} -> proposing {RUNTIME_LABELS[rt]} (unsupported genre)")
    elif fallback_used:
        plan["fallback_reason"] = ("This game type is not supported yet. The closest supported runtime "
                                   f"({RUNTIME_LABELS[rt]}) is proposed — generation only proceeds if you approve this substitution.")
    else:
        plan["fallback_reason"] = None
    plan["classification"] = {
        "detected_genre": RUNTIME_LABELS.get(routed) if routed else (RUNTIME_LABELS.get(llm_rt) if llm_rt else "unrecognized"),
        "confidence": 1.0 if routed else (0.6 if llm_rt else 0.0),
        "method": "keyword_router" if routed else ("llm_plan" if llm_rt else "none"),
        "runtime_id": rt, "template_id": TEMPLATE_IDS[rt],
        "fallback_used": bool(fallback_used),
        "fallback_reason": plan["fallback_reason"],
    }
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
    # player representation contract + structural diversity validation
    rep = str(plan.get("player_representation") or "").strip().lower().replace(" ", "_").replace("-", "_")
    allowed = PLAYER_REPS.get(rt) or []
    if rep and rep not in allowed:
        subs.append(f"Player '{rep}' isn't supported by the {RUNTIME_LABELS[rt]} runtime — using '{default_rep(rt, pm)}' instead")
        rep = ""
    plan["player_representation"] = rep or default_rep(rt, pm)
    vp["player_representation"] = plan["player_representation"]
    ident = plan_identity(rt, pm if rt == "dodge_collect" else "", plan["player_representation"])
    ident["mode"] = pm
    ident["environments"] = sorted(set(vp["environment_themes"]))
    def plan_ident_controls(rt2, pm2):
        km = {"dodge_collect": "←/→ steer · ↑/↓ fly (space modes) · WASD", "platformer": "←/→ move · ↑/W/Space jump",
              "top_down": "←→↑↓ / WASD move",
              "card_battle": "click cards to play · click End Turn",
              "tower_defense": "click tower type, then a build spot · click towers to upgrade/sell",
              "match3": "click a tile, then an adjacent tile to swap",
              "rpg": "click a tile to walk · combat action buttons",
              "racing": "←/→ steer · Space drift",
              "farming": "click plots to plant/water/harvest · craft & sell buttons",
              "city_builder": "click a building type, then a free tile"}.get(rt2, "mouse / tap driven")
        tl = {"dodge_collect": "drag steering", "platformer": "left/right/jump buttons", "top_down": "drag joystick",
              "puzzle_room": "tap, type & inspect", "rhythm": "tap the beat pad", "memory": "tap cards",
              "matching": "tap pairs", "sorting": "tap categories", "quiz_adventure": "tap answers",
              "card_battle": "tap cards + End Turn button", "tower_defense": "tap tower type, tap build spot",
              "match3": "tap two adjacent tiles to swap",
              "rpg": "tap tiles to walk + action buttons", "racing": "left/right/drift buttons",
              "farming": "tap plots + craft buttons", "city_builder": "tap building, tap tile"}.get(rt2, "tap")
        return km, tl
    dk, tl = plan_ident_controls(rt, pm)
    sc = str(body.get("supported_controls") or "both").lower()
    ident["desktop_map"] = dk if sc in ("both", "desktop", "auto") else "disabled"
    ident["touch_layout"] = tl if sc in ("both", "mobile", "auto") else "disabled"
    ident["supported_controls"] = sc
    plan["identity"] = ident
    plan["showcase_similarity"] = await showcase_similarity_for(ident)
    plan["substitutions"] = subs
    build_cost = round(t["est_cost"] + 0.01 * complexity, 2)
    est = {
        "id": uuid.uuid4().hex, "status": "awaiting_approval",
        "request": str(body.get("request") or "")[:1200],
        "complexity": complexity, "ai_power": power, "tier": t,
        "plan": plan,
        "options": {k: str(body.get(k) or "")[:120] for k in
                    ("target_age", "grade_level", "subject", "visual_style", "audio", "accessibility",
                     "supported_controls")},
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
card_battle: {"stages":[{"title":"Battle name","enemy":{"name":"...","hp":30,"attack_min":3,"attack_max":6,"intent_telegraph":true},
  "player_hp":30,"energy_per_turn":3,"hand_size":4,
  "deck":[{"name":"Strike","type":"attack","cost":1,"value":6,"desc":"Deal 6 damage"},
          {"name":"Guard","type":"defense","cost":1,"value":5,"desc":"Block 5 damage"},
          {"name":"Focus","type":"special","cost":2,"value":2,"desc":"+2 energy next turn"}] (8-14 cards, mix of attack/defense/special)}]}
  (NO movement/portals/collectibles — turn-based card combat only; later stages: stronger enemies)
tower_defense: {"stages":[{"title":"Map name","base_hp":10,"start_resources":100,
  "towers":[{"name":"Arrow","cost":40,"damage":3,"range":95,"fire_ms":600},{"name":"Cannon","cost":70,"damage":8,"range":75,"fire_ms":1300}],
  "waves":[{"enemies":[{"type":"grunt","count":6,"hp":10,"speed":40,"bounty":8}]},
           {"enemies":[{"type":"fast","count":5,"hp":7,"speed":70,"bounty":10},{"type":"tank","count":2,"hp":30,"speed":25,"bounty":18}]}] (2-6 waves)}]}
  (NO player character/portals/collectibles — towers, pathing enemies and base defense only)
match3: {"stages":[{"title":"Level name","grid_w":7,"grid_h":8,"colors":5,"moves":20,
  "objective":{"type":"score","target":600}}]}
  (objective.type: "score" (target points) or "clear_color" (also set "color":0-4 and "target" tiles);
   NO movement/portals/collectibles — tile swapping, matches and cascades only)
rpg: {"stages":[{"title":"Region name","zone":"overworld|town|dungeon","grid_w":9,"grid_h":7,"player_hp":24,
  "quest":{"giver":"Elder Rowan","text":"Recover the lost amulet","item":"Amulet"},
  "npcs":[{"name":"Elder Rowan","x":1,"y":1,"dialog":"Please find my amulet!"}],
  "monsters":[{"name":"Slime","x":4,"y":3,"hp":10,"attack":3,"xp":8}] (0-4),
  "creatures":[{"name":"Embercub","x":3,"y":5,"hp":12,"attack":4,"xp":10,"catchable":true,"evolves_to":"Emberlord","evolve_level":3}] (0-3 wild catchable creatures),
  "starter_creature":{"name":"Sproutle","hp":14,"attack":4},
  "chests":[{"x":6,"y":2,"loot":{"kind":"weapon","name":"Iron Sword","power":3}},
            {"x":7,"y":5,"loot":{"kind":"quest_item","name":"Amulet"}}],
  "exit":{"x":8,"y":6}}]}
  (loot.kind: weapon|armor|potion|quest_item; exit unlocks when quest item is returned to the giver;
   stages form the world map: mix town/dungeon/overworld zones; creatures join the party when caught,
   fight in turn-based battles, level up and can evolve)
racing: {"stages":[{"title":"Circuit name","laps":3,"ai_racers":3,"track":"oval|figure8",
  "boosts":2,"car_speed":150,"ai_speed":135}]}
  (player steers + drifts; checkpoints are generated from the track shape)
farming: {"stages":[{"title":"Season name","plots":8,"days":10,"coin_goal":120,
  "crops":[{"name":"Wheat","cost":4,"grow_days":1,"sell":9},{"name":"Pumpkin","cost":8,"grow_days":2,"sell":22}],
  "recipes":[{"name":"Bread","needs":{"Wheat":2},"sell":26}]}]}
farming NOTE: plant->water->harvest->craft->sell loop; day advances via the End Day button
city_builder: {"stages":[{"title":"Settlement name","grid_w":6,"grid_h":5,"start_gold":60,"pop_target":24,
  "buildings":[{"name":"House","cost":18,"pop":4,"food_upkeep":2},{"name":"Farm","cost":14,"food":5},
               {"name":"Mine","cost":22,"gold":6,"pop_req":3},{"name":"Market","cost":30,"gold_mult":1.5}]}]}
  (tick economy: farms feed houses, mines need population, markets multiply gold income)

Wrap it as: {"runtime":"<runtime>","title":"...","description":"1-2 sentences","subject":"...",
 "grade_level":"...","learning_objective":"...","controls":"...",
 "player_representation":"copy EXACTLY from the plan in the user message — the renderer honors this field",
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


def validate_spec(spec: dict, complexity: int = 1, expected_runtime: str | None = None) -> list:
    """Automated tests — every failure blocks approval submission."""
    errs = []
    if spec.get("runtime") not in RUNTIMES:
        errs.append("unknown runtime")
        return errs
    if expected_runtime and spec.get("runtime") != expected_runtime:
        errs.append(f"spec runtime '{spec.get('runtime')}' does not match the approved plan runtime "
                    f"'{expected_runtime}' — runtime substitution is not allowed")
        return errs
    stages = spec.get("stages") or []
    rep = spec.get("player_representation")
    if rep and rep not in (PLAYER_REPS.get(spec.get("runtime")) or []):
        errs.append(f"player_representation '{rep}' is not supported by the {spec.get('runtime')} runtime")
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
        elif r == "card_battle":
            deck = st.get("deck") or []
            enemy = st.get("enemy") or {}
            if len(deck) < 6:
                errs.append(f"stage {i+1}: card_battle needs a deck of ≥6 cards")
            types = {c.get("type") for c in deck}
            if not {"attack", "defense"}.issubset(types):
                errs.append(f"stage {i+1}: deck needs attack AND defense cards")
            if not enemy.get("hp"):
                errs.append(f"stage {i+1}: enemy needs hp")
            if not st.get("player_hp") or not st.get("energy_per_turn"):
                errs.append(f"stage {i+1}: needs player_hp and energy_per_turn")
            for banned in ("target_cores", "platforms", "hazards", "cores"):
                if st.get(banned):
                    errs.append(f"stage {i+1}: card_battle must not contain '{banned}' (no movement/collectibles)")
        elif r == "tower_defense":
            if not (st.get("towers") or []):
                errs.append(f"stage {i+1}: tower_defense needs tower definitions")
            if not (st.get("waves") or []):
                errs.append(f"stage {i+1}: tower_defense needs waves")
            if not st.get("base_hp") or st.get("start_resources") is None:
                errs.append(f"stage {i+1}: needs base_hp and start_resources")
            for banned in ("target_cores", "platforms", "cores", "deck"):
                if st.get(banned):
                    errs.append(f"stage {i+1}: tower_defense must not contain '{banned}' (no player character/collectibles)")
        elif r == "rpg":
            if not st.get("grid_w") or not st.get("grid_h"):
                errs.append(f"stage {i+1}: rpg needs grid_w/grid_h")
            if not (st.get("quest") or {}).get("item"):
                errs.append(f"stage {i+1}: rpg needs a quest with a quest item")
            if not (st.get("npcs") or []):
                errs.append(f"stage {i+1}: rpg needs at least one NPC")
            if not (st.get("monsters") or []) and not (st.get("creatures") or []):
                errs.append(f"stage {i+1}: rpg needs monsters and/or wild creatures")
            if not (st.get("chests") or []):
                errs.append(f"stage {i+1}: rpg needs chests (loot + quest item)")
            if not st.get("exit"):
                errs.append(f"stage {i+1}: rpg needs an exit tile")
        elif r == "racing":
            if not st.get("laps"):
                errs.append(f"stage {i+1}: racing needs laps")
            if st.get("ai_racers") is None:
                errs.append(f"stage {i+1}: racing needs ai_racers")
            for banned in ("deck", "waves", "plots", "quest"):
                if st.get(banned):
                    errs.append(f"stage {i+1}: racing must not contain '{banned}'")
        elif r == "farming":
            if not (st.get("crops") or []):
                errs.append(f"stage {i+1}: farming needs crop definitions")
            if not st.get("plots") or not st.get("days") or not st.get("coin_goal"):
                errs.append(f"stage {i+1}: farming needs plots, days and coin_goal")
        elif r == "city_builder":
            if not (st.get("buildings") or []):
                errs.append(f"stage {i+1}: city_builder needs building definitions")
            if not st.get("pop_target") or st.get("start_gold") is None:
                errs.append(f"stage {i+1}: city_builder needs pop_target and start_gold")
            for banned in ("monsters", "deck", "waves", "laps"):
                if st.get(banned):
                    errs.append(f"stage {i+1}: city_builder must not contain '{banned}'")
        elif r == "match3":
            if not st.get("grid_w") or not st.get("grid_h"):
                errs.append(f"stage {i+1}: match3 needs grid_w and grid_h")
            if not st.get("moves"):
                errs.append(f"stage {i+1}: match3 needs a move limit")
            obj = st.get("objective") or {}
            if obj.get("type") not in ("score", "clear_color") or not obj.get("target"):
                errs.append(f"stage {i+1}: match3 needs objective type (score|clear_color) + target")
            for banned in ("target_cores", "platforms", "hazards", "cores", "deck", "waves"):
                if st.get(banned):
                    errs.append(f"stage {i+1}: match3 must not contain '{banned}' (no movement/collectibles)")
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
        "fire_economy": {**FIRE_ECON_DEFAULTS, "rewards": {**FIRE_ECON_DEFAULTS["rewards"]}},
        "controls": _controls_from_options(estimate.get("options") or {}),
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
            + (f"Player representation (MANDATORY — set player_representation to exactly this): {plan.get('player_representation')}\n"
               if plan.get("player_representation") else "")
            + (f"Planned mechanics: {', '.join(plan.get('mechanics') or [])}\n" if plan.get("mechanics") else "")
            + (f"Gameplay summary to implement: {plan.get('gameplay_summary')}\n" if plan.get("gameplay_summary") else "")
            + "\n".join(f"{k}: {v}" for k, v in (game.get("options") or {}).items() if v)
            + (f"\nCourse context: {json.dumps(game['course_context'])[:400]}" if game.get("course_context") else ""))
        await _log(game_id, "generating_spec", "Writing game specification in the isolated build workspace")
        raw = await call_llm(SPEC_SYSTEM, user_msg, power=game["ai_power"], json_mode=True)
        cost += t["est_cost_per_pass"]
        spec = json.loads(raw)
        errs = validate_spec(spec, game["complexity"], expected_runtime=game.get("runtime"))
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
            errs = validate_spec(spec, game["complexity"], expected_runtime=game.get("runtime"))
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
        prep = (game.get("plan") or {}).get("player_representation")
        if spec.get("player_representation") not in (PLAYER_REPS.get(game["runtime"]) or []):
            spec["player_representation"] = (prep if prep in (PLAYER_REPS.get(game["runtime"]) or [])
                                             else default_rep(game["runtime"], str(spec.get("mode") or "")))
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
