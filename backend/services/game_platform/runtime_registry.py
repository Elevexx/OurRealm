"""Runtime / Template / Renderer registries + capability-driven runtime
recommendation. 35 runtime families; each maps HONESTLY to a vetted
engine runtime (generatable), an approximation (partial, substitutions
declared) or a foundation entry (planning allowed, build rejected).
Never silently forces a poor fit."""
import re

from services.game_studio import RUNTIMES as ENGINE_RUNTIMES, RUNTIME_LABELS, RUNTIME_MECHANICS
from services.game_platform.registry_core import Registry


def _tok(text) -> set:
    return {w for w in re.findall(r"[a-z0-9]+", str(text or "").lower()) if len(w) > 2}


# maturity: generatable = direct vetted engine · partial = approximated with
# declared substitutions · foundation = registered/planned, build REJECTED.
def _fam(label, engine, maturity, caps, *, renderer="canvas_2d", multiplayer=False, subs=None):
    return {"label": label, "engine_runtime": engine, "maturity": maturity,
            "capabilities": caps, "renderer": renderer,
            "multiplayer_ready": multiplayer, "substitutions": subs or [],
            "engine_mechanics": RUNTIME_MECHANICS.get(engine, []) if engine else []}


RUNTIME_FAMILY_SEED = {
    "platformer": _fam("Platformer", "platformer", "generatable",
                       ["jumping", "gravity", "side-scroll", "collectibles", "hazards", "levels", "run", "climb"]),
    "endless_runner": _fam("Endless Runner", "dodge_collect", "generatable",
                           ["endless", "runner", "dodge", "collect", "speed ramp", "lanes", "obstacles"]),
    "top_down_adventure": _fam("Top-Down Adventure", "top_down", "generatable",
                               ["4-direction movement", "top-down", "collectible cores", "obstacles",
                                "patrol enemies", "chaser enemies", "checkpoints", "keys", "portal",
                                "verified Coins/Gems/Stars/Keys pickups", "touch controls"]),
    "turn_based_creature_rpg": _fam(
        "Turn-Based Creature RPG", "turn_based_creature_rpg", "generatable",
        ["turn-based battles", "creatures", "party", "capture", "taming", "monster collecting",
         "dragon collecting", "jrpg", "party combat", "wizard rpg", "quests", "overworld",
         "creature roster", "starter creature"],
        subs=[]) | {
        "runtime_id": "runtime_turn_based_creature_rpg_v1",
        "template_id": "tpl_turn_based_creature_rpg_v1",
        "runtime_version": 2,
        "extensions_available": ["evolution", "multiplayer_foundation", "trading",
                                 "procedural_regions", "crafting", "battle_ai"],
        "extension_registry": "creature_rpg_extensions",
        "extension_points": []},
    "action_rpg_2_5d": _fam(
        "2.5D Action RPG", "action_rpg_2_5d", "generatable",
        ["real-time combat", "melee", "spells", "dodge", "boss phases", "exploration", "quests",
         "npcs", "inventory", "equipment", "leveling", "checkpoints", "parallax 2.5D", "gamepad"],
        subs=[]) | {
        "runtime_id": "runtime_action_rpg_2_5d_v1",
        "template_id": "tpl_action_rpg_2_5d_v1",
        "renderer_id": "renderer_action_rpg_2_5d_v1",
        "default_art_preset": "fantasy_hd",
        "art_presets": ["fantasy_hd", "pixel", "stylized", "cartoon", "realistic"],
        "runtime_version": 1},
    "action_rpg": _fam("Action RPG", "action_rpg_2_5d", "generatable",
                       ["real-time combat", "loot", "abilities", "dungeons", "leveling"],
                       subs=[]),
    "tactical_rpg": _fam("Tactical RPG", "tactics", "generatable",
                         ["grid", "tactics", "turn order", "abilities", "squad", "cover"]),
    "open_world_rpg": _fam("Open World RPG", "rpg", "partial",
                           ["open world", "zones", "quests", "factions", "exploration"],
                           subs=["seamless open world approximated with connected world-map zones"]),
    "survival": _fam("Survival", "top_down", "partial",
                     ["hunger", "resources", "crafting", "day-night", "base"],
                     subs=["survival meters approximated with timers + resource collectibles"]),
    "roguelike": _fam("Roguelike", "roguelike", "generatable",
                      ["procedural", "permadeath", "runs", "random loot", "floors"]),
    "shooter": _fam("Shooter", "dodge_collect", "partial",
                    ["shooting", "projectiles", "waves", "aim"],
                    subs=["free-aim shooting approximated with lane projectiles on the arcade engine"]),
    "twin_stick_shooter": _fam("Twin-Stick Shooter", "top_down", "partial",
                               ["twin stick", "360 shooting", "arena waves"],
                               subs=["360° firing approximated with directional attacks on the top-down engine"]),
    "tower_defense": _fam("Tower Defense", "tower_defense", "generatable",
                          ["towers", "waves", "pathing", "upgrades", "defense", "base"]),
    "card_battle": _fam("Card Battle", "card_battle", "generatable",
                        ["cards", "deck", "mana", "turn-based", "hand", "draw"]),
    "match3": _fam("Match-3", "match3", "generatable",
                   ["match three", "tiles", "swap", "cascades", "combos", "gems"]),
    "puzzle": _fam("Puzzle", "puzzle_room", "generatable",
                   ["puzzles", "riddles", "logic", "locks", "escape", "hints"]),
    "idle": _fam("Idle / Incremental", "idle", "generatable",
                 ["idle", "incremental", "automation", "prestige", "generators"]),
    "strategy": _fam("Strategy", "tactics", "generatable",
                     ["strategy", "planning", "units", "turns", "territory"]),
    "rts": _fam("RTS", None, "foundation",
                ["real-time strategy", "unit control", "fog of war", "base building"]),
    "city_builder": _fam("City Builder", "city_builder", "generatable",
                         ["city", "buildings", "economy", "population", "production chains"]),
    "racing": _fam("Racing", "racing", "generatable",
                   ["racing", "laps", "drift", "boost", "checkpoints", "speed"]),
    "farming": _fam("Farming", "farming", "generatable",
                    ["farming", "crops", "harvest", "seasons", "market", "watering"]),
    "creature_collector": _fam("Creature Collector", "turn_based_creature_rpg", "generatable",
                               ["collect creatures", "capture", "evolve", "trainer", "battles"]),
    "sandbox": _fam("Sandbox", None, "foundation",
                    ["free build", "creative", "no objectives", "world editing"]),
    "mmo_foundation": _fam("MMO-Ready Foundation", None, "foundation",
                           ["massively multiplayer", "persistent world", "server sharding"],
                           multiplayer=True),
    "visual_novel": _fam("Visual Novel", "visual_novel", "generatable",
                         ["branching dialogue", "choices", "endings", "portraits", "story"],
                         renderer="dom_ui"),
    "interactive_story": _fam("Interactive Story", "quiz_adventure", "generatable",
                              ["story", "chapters", "choices", "narrative", "decisions"],
                              renderer="dom_ui"),
    "rhythm": _fam("Rhythm", "rhythm", "generatable",
                   ["rhythm", "beats", "music timing", "tap", "combo"]),
    "educational": _fam("Educational", "quiz_adventure", "generatable",
                        ["learning", "quiz", "lessons", "practice", "explanations"],
                        renderer="dom_ui"),
    "simulation": _fam("Simulation", "idle", "partial",
                       ["simulate", "systems", "management", "tycoon"],
                       subs=["deep simulation approximated with idle/management production loops"]),
    "sports": _fam("Sports", None, "foundation",
                   ["sports", "teams", "matches", "physics ball"]),
    "party_game": _fam("Party Game", "matching", "partial",
                       ["minigames", "party", "quick rounds", "score race"],
                       subs=["multi-player couch play approximated with single-player minigame rounds"]),
    "physics_sandbox": _fam("Physics Sandbox", None, "foundation",
                            ["physics", "ragdoll", "contraptions", "gravity toys"]),
    "horror": _fam("Horror", "top_down", "partial",
                   ["horror", "atmosphere", "chase", "darkness", "jump scare"],
                   subs=["horror atmosphere via limited-vision top-down stealth presentation"]),
    "stealth": _fam("Stealth", "top_down", "generatable",
                    ["stealth", "vision cones", "guards", "sneak", "detection"]),
    "metroidvania": _fam("Metroidvania", "platformer", "partial",
                         ["ability gates", "backtracking", "interconnected map", "upgrades"],
                         subs=["interconnected world approximated with ability-unlocked stage progression"]),
}

RENDERER_SEED = {
    "canvas_2d": {"label": "Canvas 2D (vetted sandbox)", "status": "implemented_with_placeholder_assets",
                  "notes": "GameRuntime.jsx iframe sandbox — painted-primitive presentation by default; "
                           "real sprites render ONLY when spec.assets slots are wired from the asset "
                           "library / Asset Studio. NOT 3D, NOT photorealistic, NOT cinematic."},
    "dom_ui": {"label": "DOM / UI-driven", "status": "implemented_with_placeholder_assets",
               "notes": "card, quiz, story and novel presentations — text/UI first"},
    "hybrid_canvas_dom": {"label": "Hybrid Canvas + DOM", "status": "implemented_with_placeholder_assets",
                          "notes": "canvas playfield with DOM HUD overlays"},
    "action_rpg_2_5d_layered": {"label": "2.5D Layered Action Canvas (renderer_action_rpg_2_5d_v1)",
                                "status": "implemented_with_placeholder_assets",
                                "notes": "real-time canvas engine: parallax background layers, y-sorted "
                                         "depth ordering, depth-scaled sprites, soft shadows, lighting + "
                                         "fog overlays, particles, camera follow/look-ahead/shake. "
                                         "HD hand-painted quality comes from wired assets. "
                                         "NOT 3D, NOT WebGL, NOT volumetric lighting."},
    "webgl_light": {"label": "WebGL Light 3D", "status": "unsupported",
                    "notes": "metadata-only — no executable 3D runtime exists"},
}

TEMPLATE_SEED = {f"tpl_{rt}_v1": {"label": f"{RUNTIME_LABELS.get(rt, rt)} template",
                                  "engine_runtime": rt, "template_version": 1}
                 for rt in ENGINE_RUNTIMES}

runtime_registry = Registry("runtimes", RUNTIME_FAMILY_SEED,
                            description="Runtime families with capabilities + honest maturity")
renderer_registry = Registry("renderers", RENDERER_SEED, description="Presentation renderers")
template_registry = Registry("templates", TEMPLATE_SEED, description="Vetted engine templates")


async def recommend_capability_runtime(request_text: str, detected: dict) -> dict:
    """Capability-driven recommendation. detected = planner analysis
    {genres, mechanics, multiplayer, ...}. Rejects incompatible matches."""
    families = await runtime_registry.all()
    req_tok = _tok(request_text) | _tok(" ".join(detected.get("genres") or [])) \
        | _tok(" ".join(detected.get("mechanics") or []))
    genre_tok = _tok(" ".join(detected.get("genres") or []))
    scored = []
    for fid, entry in families.items():
        if not entry.get("enabled", True):
            continue
        d = entry["definition"]
        cap_tok = _tok(" ".join(d.get("capabilities") or []) + " " + d.get("label", "") + " " + fid)
        overlap = len(req_tok & cap_tok)
        score = min(overlap / 3.0, 1.0)
        if _tok(fid) & genre_tok or _tok(d.get("label")) & genre_tok:
            score = min(score + 0.45, 1.0)
        if detected.get("multiplayer") and not d.get("multiplayer_ready"):
            score *= 0.85
        scored.append({"family_id": fid, "label": d["label"], "score": round(score, 3),
                       "maturity": d["maturity"], "engine_runtime": d.get("engine_runtime"),
                       "renderer": d.get("renderer"), "substitutions": d.get("substitutions") or [],
                       "version": entry["version"]})
    scored.sort(key=lambda x: (x["score"], x["maturity"] == "generatable"), reverse=True)
    compatible = [s for s in scored if s["score"] >= 0.25]
    buildable = [s for s in compatible if s["maturity"] in ("generatable", "partial")]
    rec = buildable[0] if buildable else None
    # If a foundation family CLEARLY dominates the best buildable option,
    # refuse instead of silently forcing a poor substitute.
    top = compatible[0] if compatible else None
    forced_fit = (top and top["maturity"] == "foundation" and rec
                  and top["score"] - rec["score"] > 0.2)
    if forced_fit:
        rec = None
    rejected = [{"family_id": s["family_id"], "label": s["label"],
                 "reason": f"maturity '{s['maturity']}' — registered but not buildable yet"}
                for s in compatible if s["maturity"] == "foundation"]
    recommendations = []
    if forced_fit:
        recommendations.append(
            f"The request maps to '{top['label']}' which is foundation-only (not buildable) — "
            "refusing a forced substitute. Pick a buildable family explicitly if an approximation is acceptable")
    if not rec and compatible and not forced_fit:
        recommendations.append(
            f"Best matches ({', '.join(s['label'] for s in compatible[:3])}) are foundation-only — "
            "pick a buildable family explicitly or wait for the engine")
    if not compatible:
        recommendations.append("No runtime family matched the request — describe the moment-to-moment gameplay")
    if rec and rec["maturity"] == "partial":
        recommendations.append(f"{rec['label']} is approximated: " + "; ".join(rec["substitutions"]))
    return {"recommended": rec, "compatible": compatible[:8], "rejected": rejected,
            "no_compatible_runtime": rec is None, "recommendations": recommendations,
            "method": "capability_registry_overlap"}
