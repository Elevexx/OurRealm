"""Runtime Selection Accuracy — deterministic mechanic detection +
per-runtime capability matrix. Runs BEFORE blueprint generation:
scores every registered runtime, picks the best compatible one, walks
down the ranking when the top pick lacks required mechanics, and
refuses (with a full report) when nothing is compatible. Zero LLM cost."""
import re

from services.game_studio import RUNTIMES, RUNTIME_LABELS

# canonical mechanic -> detection patterns (regex, matched on lowercased text)
MECHANIC_PATTERNS = {
    "real_time_movement": [r"real[- ]?time movement", r"move (?:around )?freely", r"free movement",
                           r"wasd", r"move in real[- ]?time"],
    "action_combat": [r"action combat", r"real[- ]?time combat", r"hack[- ]?and[- ]?slash",
                      r"slash(?:ing)? enemies", r"combo attacks", r"melee combat", r"action[- ]?rpg",
                      r"zelda", r"diablo", r"dodge[- ]?roll", r"souls[- ]?like", r"melee and spell",
                      r"2\.5d", r"\barpg\b"],
    "cooldown_abilities": [r"cooldown", r"ability cooldowns?", r"skill cooldowns?"],
    "top_down_exploration": [r"top[- ]?down", r"overhead (?:view|camera)", r"explore (?:a|the) (?:map|arena|world)"],
    "platforming": [
    r"\bplatform(?:er|ing)\b",
    r"\bplatform adventure\b",
    r"\bfloating platforms?\b",
    r"\bmoving platforms?\b",
    r"\bdisappearing platforms?\b",
    r"\bplatform traversal\b",
    r"\bplatform challenges?\b",
    r"\bjumps? (?:between|across|over)\b",
    r"\bjumping (?:between|across|over)\b",
    r"\bdouble jump\b",
    r"\bside[- ]?scroll(?:er|ing)?\b",
    r"\bwall jump\b",
],
    "puzzle_solving": [r"puzzle", r"riddle", r"escape room", r"brain[- ]?teaser", r"logic (?:challenge|game)",
                       r"solve (?:codes|clues)"],
    "boss_battles": [r"boss(?:es)?\b", r"boss (?:battle|fight)"],
    "survival": [r"survival", r"survive the night", r"hunger", r"stay alive"],
    "tower_defense": [r"tower defen[sc]e", r"place (?:towers|turrets)", r"wave defen[sc]e",
                      r"defend (?:the|your) base"],
    "card_battles": [r"card (?:battle|game|combat)", r"deck[- ]?build(?:er|ing)?", r"\btcg\b",
                     r"play(?:ing)? cards", r"card duels?"],
    "turn_based_combat": [r"turn[- ]?based", r"take turns", r"\bjrpg\b", r"party combat"],
    "creature_capture": [r"catch(?:ing)? (?:creatures|monsters)", r"capture (?:creatures|monsters)",
                         r"creature collect", r"monster (?:taming|training|collect)", r"tame", r"befriend",
                         r"creature (?:roster|party|rpg)", r"collect (?:dragons|creatures|monsters)",
                         r"evolv(?:e|ing|ution)"],
    "match3_swap": [r"match[- ]?3", r"match three", r"gem swap", r"tile match", r"candy crush", r"bejeweled"],
    "racing": [r"\brac(?:e|ing)\b", r"\bkart\b", r"\blaps?\b", r"drift", r"grand prix"],
    "farming": [r"farm(?:ing)?", r"plant(?:ing)? (?:crops|seeds)", r"harvest", r"crops"],
    "city_building": [r"city build(?:er|ing)", r"build (?:a|your) (?:city|town|settlement)", r"town builder"],
    "rhythm_timing": [r"rhythm", r"to the beat", r"beat matching", r"tap (?:to|on) the beat", r"music timing"],
    "idle_progression": [r"\bidle\b", r"clicker", r"incremental", r"prestige"],
    "roguelike_runs": [r"rogue[- ]?like", r"permadeath", r"dungeon crawl", r"procedural (?:dungeons?|floors?)"],
    "tactics_grid": [r"tactic(?:s|al)", r"grid combat", r"squad", r"\bxcom\b", r"turn[- ]?based strategy"],
    "story_choices": [r"visual novel", r"branching (?:story|dialogue)", r"interactive (?:story|fiction)",
                      r"story choices", r"choose your own"],
    "fishing": [r"fishing", r"catch fish", r"angler"],
    "quiz_learning": [r"\bquiz\b", r"trivia", r"questions? and answers?", r"educational quiz"],
    "memory_matching": [r"memory (?:cards?|game|pairs)", r"matching pairs", r"flip cards"],
    "sorting_categorize": [r"sort(?:ing)? (?:items|game)", r"categoriz"],
    "shooting": [r"shoot(?:er|ing)?", r"projectiles?", r"guns?\b", r"blast(?:er|ing)"],
    "stealth": [r"stealth", r"sneak", r"vision cones?", r"avoid guards"],
    "quests": [r"quests?\b", r"missions?\b", r"objectives? to complete"],
    "dialogue_npcs": [r"npcs?\b", r"dialogue", r"talk to (?:villagers|characters|people)"],
    "inventory_loot": [r"inventory", r"\bloot\b", r"equipment", r"items? to collect"],
    "leveling_xp": [r"level(?:ing)? up", r"\bxp\b", r"experience points", r"skill tree"],
    "crafting": [r"craft(?:ing)?", r"recipes?\b", r"combine (?:materials|resources)"],
    "multiplayer_online": [r"multiplayer", r"\bpvp\b", r"co[- ]?op", r"online (?:with|against) friends",
                           r"\bmmo\b", r"trading with (?:friends|players)"],
    "rts_base_building": [r"\brts\b", r"real[- ]?time strategy", r"fog of war", r"command (?:units|armies)"],
    "sandbox_building": [r"sandbox", r"build anything", r"creative mode", r"voxel"],
    "physics_toys": [r"ragdoll", r"physics (?:sandbox|toy|contraption)"],
    "sports_match": [r"soccer", r"football", r"basketball", r"tennis", r"sports (?:game|match)"],
}

# Genre-defining mechanics: a runtime is COMPATIBLE only if it supports
# (or honestly approximates) every detected CORE mechanic.
CORE = {"platforming", "tower_defense", "card_battles", "match3_swap", "racing", "farming",
        "city_building", "rhythm_timing", "idle_progression", "roguelike_runs", "tactics_grid",
        "story_choices", "fishing", "quiz_learning", "memory_matching", "sorting_categorize",
        "turn_based_combat", "creature_capture", "puzzle_solving", "top_down_exploration",
        "real_time_movement", "action_combat", "shooting", "survival", "stealth",
        "rts_base_building", "sandbox_building", "physics_toys", "sports_match"}

# capability matrix: runtime -> {"s": fully supported, "a": honest approximation}
_M = {
    "quiz_adventure": {"s": {"quiz_learning", "story_choices", "quests"}, "a": {"puzzle_solving"}},
    "matching": {"s": {"memory_matching"}, "a": set()},
    "sorting": {"s": {"sorting_categorize"}, "a": set()},
    "memory": {"s": {"memory_matching"}, "a": set()},
    "rhythm": {"s": {"rhythm_timing"}, "a": set()},
    "top_down": {"s": {"top_down_exploration", "real_time_movement", "stealth", "quests"},
                 "a": {"action_combat", "survival", "shooting", "boss_battles", "inventory_loot"}},
    "platformer": {
    "s": {"platforming", "real_time_movement"},
    "a": {"boss_battles", "puzzle_solving"},
},
    "dodge_collect": {"s": {"real_time_movement"}, "a": {"shooting", "racing"}},
    "puzzle_room": {"s": {"puzzle_solving"}, "a": {"quests"}},
    "card_battle": {"s": {"card_battles", "turn_based_combat"}, "a": {"boss_battles", "cooldown_abilities"}},
    "tower_defense": {"s": {"tower_defense"}, "a": {"boss_battles", "survival"}},
    "match3": {"s": {"match3_swap", "puzzle_solving"}, "a": set()},
    "rpg": {"s": {"turn_based_combat", "quests", "dialogue_npcs", "inventory_loot", "leveling_xp",
                  "top_down_exploration"}, "a": {"boss_battles", "creature_capture"}},
    "racing": {"s": {"racing", "real_time_movement"}, "a": set()},
    "farming": {"s": {"farming"}, "a": {"crafting", "inventory_loot"}},
    "city_builder": {"s": {"city_building"}, "a": {"crafting"}},
    "roguelike": {"s": {"roguelike_runs", "turn_based_combat", "top_down_exploration"},
                  "a": {"boss_battles", "inventory_loot", "leveling_xp"}},
    "tactics": {"s": {"tactics_grid", "turn_based_combat"}, "a": {"boss_battles", "cooldown_abilities"}},
    "idle": {"s": {"idle_progression"}, "a": {"crafting"}},
    "visual_novel": {"s": {"story_choices", "dialogue_npcs"}, "a": {"quests"}},
    "fishing": {"s": {"fishing"}, "a": {"inventory_loot"}},
    "action_rpg_2_5d": {"s": {"real_time_movement", "action_combat", "boss_battles", "quests",
                              "dialogue_npcs", "inventory_loot", "leveling_xp", "cooldown_abilities",
                              "top_down_exploration", "platforming"},
                        "a": {"survival", "shooting", "stealth"}},
    "turn_based_creature_rpg": {"s": {"turn_based_combat", "creature_capture", "quests",
                                      "dialogue_npcs", "inventory_loot", "leveling_xp",
                                      "top_down_exploration"},
                                "a": {"boss_battles", "crafting", "multiplayer_online",
                                      "roguelike_runs"}},
}


def detect_mechanics(text: str) -> list:
    low = " " + str(text or "").lower() + " "

    # Remove explicit negative requirements before mechanic detection.
    # Example:
    #   "do not create a quiz"
    # must NOT be interpreted as requesting quiz_learning.
    negative_patterns = [
        r"\bdo not (?:create|make|build|use|include|select)\b[^.\n;]*",
        r"\bdon't (?:create|make|build|use|include|select)\b[^.\n;]*",
        r"\bmust not (?:create|make|build|use|include|select|be)\b[^.\n;]*",
        r"\bshould not (?:create|make|build|use|include|select|be)\b[^.\n;]*",
        r"\bwithout\b[^.\n;]*",
        r"\bno\b\s+(?:quiz|trivia|card game|card battle|course|lesson|multiple[- ]choice)[^.\n;]*",
    ]

    detection_text = low
    for pat in negative_patterns:
        detection_text = re.sub(pat, " ", detection_text)

    found = []
    for mech, pats in MECHANIC_PATTERNS.items():
        if any(re.search(p, detection_text) for p in pats):
            found.append(mech)

    return found


def _label(m: str) -> str:
    return m.replace("_", " ")


def select_best_runtime(request_text: str) -> dict:
    """Score EVERY registered runtime against the detected mechanics.
    Returns the best compatible runtime or a full incompatibility report."""
    detected = detect_mechanics(request_text)
    if not detected:
        return {"detected_mechanics": [], "no_signal": True, "no_compatible_runtime": False,
                "selected": None, "ranked": []}
    core_needed = [m for m in detected if m in CORE]
    ranked = []
    for rt in RUNTIMES:
        caps = _M.get(rt, {"s": set(), "a": set()})
        avail = caps["s"] | caps["a"]
        sup = [m for m in detected if m in caps["s"]]
        approx = [m for m in detected if m in caps["a"]]
        unsup = [m for m in detected if m not in avail]
        score = round((len(sup) + 0.6 * len(approx)) / len(detected), 3)
        compatible = all(m in avail for m in core_needed) and bool(sup or approx)
        ranked.append({"runtime": rt, "label": RUNTIME_LABELS.get(rt, rt), "score": score,
                       "compatible": compatible,
                       "supported": [_label(m) for m in sup],
                       "approximated": [_label(m) for m in approx],
                       "unsupported": [_label(m) for m in unsup]})
    ranked.sort(key=lambda x: (x["compatible"], x["score"]), reverse=True)
    winner = next((r for r in ranked if r["compatible"] and r["score"] > 0), None)
    result = {"detected_mechanics": [_label(m) for m in detected],
              "core_mechanics": [_label(m) for m in core_needed],
              "selected": winner, "ranked": ranked[:6], "no_signal": False,
              "compatible_runtimes": [r["runtime"] for r in ranked if r["compatible"]],
              "no_compatible_runtime": winner is None,
              "method": "deterministic_capability_matrix"}
    if winner is None:
        closest = ranked[0]
        result["report"] = {
            "requested_mechanics": [_label(m) for m in detected],
            "supported_mechanics": closest["supported"] + closest["approximated"],
            "unsupported_mechanics": closest["unsupported"],
            "closest_matching_runtime": closest["label"],
            "compatibility_score": closest["score"],
            "missing_runtime_capabilities": closest["unsupported"],
            "blocking_reason": (f"Required mechanic(s) not supported by any registered runtime: "
                                f"{', '.join(closest['unsupported']) or 'requested combination'}"),
            "recommendations": [
                f"Closest fit is {closest['label']} — rephrase the request around its strengths "
                f"({', '.join(closest['supported'] + closest['approximated']) or 'its core loop'})",
                "Remove or relax the unsupported mechanics and plan again",
                "Foundation-only families (RTS, sandbox, sports, physics, MMO) are registered "
                "but not buildable yet"],
            "message": (f"No registered runtime supports: "
                        f"{', '.join(closest['unsupported']) or 'the requested combination'}. "
                        f"Closest match is {closest['label']} "
                        f"(score {closest['score']}). Blueprint generation was stopped — "
                        "nothing was generated."),
        }
    return result
