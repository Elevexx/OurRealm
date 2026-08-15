"""AAA Game Blueprint engine — versioned, family-agnostic game-project
blueprints for ORAi Projects. Planning-only: never generates media and
never starts a build. Reuses game_studio's vetted runtime registry and
game_assets' slot manifests. Collection: game_blueprints."""
import json
import logging
import re
import uuid
from datetime import datetime, timezone

from core.db import db
from fastapi import HTTPException
from services.llm_router import tier
from services.chat_conversations import call_openai_chat
from services.runtime_selection import detect_mechanics, select_best_runtime
from services.game_studio import (RUNTIMES, RUNTIME_LABELS, RUNTIME_MECHANICS, RUNTIME_ENUM,
                                  SCAFFOLDED_RUNTIMES, route_runtime, detect_unsupported)
from services.game_assets import SLOTS, PROFILES, profile_for, ART_QUALITY
from services import asset_library

log = logging.getLogger("ourrealm.game_blueprints")

BLUEPRINT_SCHEMA_VERSION = 1
VISUAL_DIMENSIONS = ["2d", "2.5d", "light_3d", "advanced_3d"]
IMG_COST = 0.04
TTS_COST_PER_1K = 0.015

SLOT_CATEGORY = asset_library.SLOT_CATEGORY


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _tokens(text) -> set:
    return {w for w in re.findall(r"[a-z0-9]+", str(text or "").lower()) if len(w) > 2}


def _slist(v, n=20, ln=160):
    """Normalize optional LLM fields into a clean list of strings.

    A plain string is ONE item, not an iterable of characters.
    Placeholder values such as "optional" or "none" produce no items.
    """
    if v is None:
        return []

    if isinstance(v, str):
        values = [v]
    elif isinstance(v, (list, tuple, set)):
        values = list(v)
    else:
        values = [v]

    placeholders = {
        "",
        "optional",
        "none",
        "n/a",
        "na",
        "no",
        "skip",
        "not applicable",
        "not needed",
    }

    out = []
    for x in values:
        s = str(x or "").strip()
        normalized = s.lower().strip(" .:-_")
        if not s or normalized in placeholders:
            continue
        out.append(s[:ln])

    return out[:n]


# ── LLM planning prompt (family-agnostic) ────────────────────────────
PLAN_SYSTEM = """You are ORAi's AAA game designer. Turn a game request into a structured blueprint.
Reply ONLY valid JSON:
{"title":"...", "description":"2-3 sentences", "genre":"...",
 "target_devices":["desktop","mobile","tablet" — pick applicable],
 "visual_dimension":"2d|2.5d|light_3d|advanced_3d",
 "camera_model":"e.g. fixed single-screen, top-down follow, side-scroll",
 "control_model":"e.g. tap/click, arrows+space, drag",
 "core_loop":"1-2 sentences: the repeated moment-to-moment loop",
 "player_mechanics":["..."], "enemies":["name — 1-line role"], "bosses":["..."],
 "npcs":["..."], "levels":["..."], "worlds":["..."], "maps":["..."],
 "objectives":["..."], "quests":["..."],
 "progression":"1 sentence or empty", "inventory":"1 sentence or empty",
 "upgrades":["..."], "abilities":["..."], "weapons_or_spells":["..."],
 "ui_hud":["HUD elements"], "save_requirements":"what must persist or empty",
 "achievements":["..."], "tutorials":["..."], "fire_power_integrations":["optional Fire Power burn/reward hooks"],
 "artwork_requirements":["visual assets the game needs"],
 "animation_requirements":["..."], "music_requirements":["..."],
 "sound_effect_requirements":["..."], "voice_requirements":["..."],
 "cinematic_requirements":["..."], "promotional_media_requirements":["cover art etc"],
 "accessibility_requirements":["..."],
 "requested_mechanics":["mechanics the request explicitly asks for"],
 "runtime":"pick the closest gameplay family from: __RUNTIME_ENUM__ — exploration/adventure worlds -> top_down, action/runner/collecting -> dodge_collect, creature collecting/monster taming/JRPG party combat -> turn_based_creature_rpg, real-time melee+spell action RPG/hack-and-slash -> action_rpg_2_5d",
 "est_play_minutes":"e.g. 5-10"}
RULES:
- Only fill sections that genuinely apply to THIS game family. A card/board/match-3/quiz
  game must NOT get platformer fields (levels/worlds/jumping) forced in — leave them [] or "".
- Size everything to the given complexity (1 = one-screen minimal, 10 = deep AAA scope).
- No prose outside the JSON."""
PLAN_SYSTEM = PLAN_SYSTEM.replace("__RUNTIME_ENUM__", RUNTIME_ENUM)


# ── Runtime recommendation (deterministic + LLM-informed, never silent) ─
def recommend_runtime(request_text: str, llm_hint: str, requested_mechanics: list) -> dict:
    routed = route_runtime(request_text or "")
    scaffold_hit = SCAFFOLDED_RUNTIMES.get(routed) if routed in SCAFFOLDED_RUNTIMES else None
    if routed in SCAFFOLDED_RUNTIMES:
        routed = None
    unsupported_genre = detect_unsupported(request_text or "")
    hint = llm_hint if llm_hint in RUNTIMES else None
    req_tok = _tokens(request_text + " " + " ".join(requested_mechanics or []))
    scores = {}
    for rt in RUNTIMES:
        mech_tok = _tokens(" ".join(RUNTIME_MECHANICS.get(rt, [])) + " " + RUNTIME_LABELS[rt])
        s = 0.3 * (len(req_tok & mech_tok) / max(len(mech_tok), 1) * 4)
        if rt == routed:
            s += 0.6
        if rt == hint:
            s += 0.3
        scores[rt] = round(min(s, 1.0), 3)
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    compatible = [{"runtime_id": rt, "label": RUNTIME_LABELS[rt], "score": sc,
                   "mechanics": RUNTIME_MECHANICS.get(rt, [])}
                  for rt, sc in ranked if sc >= 0.2][:6]
    all_scores = [{"runtime_id": rt, "label": RUNTIME_LABELS[rt], "score": sc}
                  for rt, sc in ranked]
    no_compat = not compatible or (bool(unsupported_genre) and not routed and not hint)
    rec = None if no_compat else compatible[0]
    reasons = []
    if rec:
        if rec["runtime_id"] == routed:
            reasons.append("deterministic genre router matched the request keywords")
        if rec["runtime_id"] == hint:
            reasons.append("ORAi planning analysis selected this family")
        if not reasons:
            reasons.append("highest mechanics overlap with the requested gameplay")
    if scaffold_hit:
        reasons.append(f"note: requested family '{scaffold_hit}' is registered but not yet generatable")
    if unsupported_genre:
        reasons.append(f"note: '{unsupported_genre}' has no vetted runtime — founder must explicitly pick a substitute")
    return {"recommended": rec["runtime_id"] if rec else None,
            "recommended_label": rec["label"] if rec else None,
            "compatibility_score": rec["score"] if rec else 0.0,
            "reason": "; ".join(reasons) or "no compatible runtime available",
            "compatible_runtimes": compatible,
            "no_compatible_runtime": no_compat,
            "unsupported_genre": unsupported_genre,
            "scaffold_hit": scaffold_hit,
            "method": "keyword_router+mechanics_overlap+llm_hint"}


def mechanics_support(selected_rt: str, requested: list, llm_unsupported: list) -> dict:
    runtime_mechanics = RUNTIME_MECHANICS.get(selected_rt, [])
    rt_tok = _tokens(" ".join(runtime_mechanics))
    llm_unsup = _slist(llm_unsupported, 8, 120)
    llm_unsup_tok = [_tokens(m) for m in llm_unsup]

    def deterministically_supported(mechanic: str) -> bool:
        """Use the vetted runtime contract before trusting LLM guesses."""
        low = str(mechanic or "").lower()
        mt = _tokens(low)

        # Normal direct overlap with the runtime's declared mechanics.
        if mt & rt_tok:
            return True

        # Natural-language aliases for the existing 2.5D Action RPG.
        # These map canonical request wording onto capabilities already
        # implemented by the runtime contract.
        if selected_rt == "action_rpg_2_5d":
            if re.search(
                r"\b(platform|platformer|platforming|side[- ]?scroll|jump|jumping|"
                r"double jump|moving platforms?|crumbling platforms?)\b",
                low,
            ):
                return any(
                    "side-scroll gravity mode" in str(x).lower()
                    for x in runtime_mechanics
                )

            if re.search(r"\b(action combat|melee combat|real[- ]?time combat)\b", low):
                return "melee combat" in runtime_mechanics

            if re.search(r"\b(quest|quests)\b", low):
                return any("quests" in str(x).lower() for x in runtime_mechanics)

            if re.search(r"\b(inventory|loot|equipment)\b", low):
                return (
                    "inventory & potions" in runtime_mechanics
                    or "equipment" in runtime_mechanics
                    or "loot drops" in runtime_mechanics
                )

        # Natural-language aliases for the existing Platformer Lite runtime.
        # These do NOT invent new systems; they map wording onto capabilities
        # already declared in RUNTIME_MECHANICS.
        if selected_rt == "platformer":
            # Advanced environmental-puzzle systems are NOT part of the
            # current Platformer Lite contract. Check these before generic
            # platform wording so "timed platforms" is not mistaken for
            # ordinary jump/platform traversal.
            if re.search(
                r"\b(puzzle|puzzles|switch|switches|timed platform|timed platforms|"
                r"door|doors|barrier|barriers)\b",
                low,
            ):
                return False

            if re.search(r"\b(run|running|move|movement)\b", low):
                return "player movement" in runtime_mechanics

            if re.search(
                r"\b(jump|jumping|platform traversal|floating platforms?|platforms?)\b",
                low,
            ):
                return (
                    "jumping" in runtime_mechanics
                    and "player movement" in runtime_mechanics
                )

            if re.search(
                r"\b(collect|collectible|collectibles|reward|rewards|"
                r"energy core|energy cores|shard|shards)\b",
                low,
            ):
                return "collectibles" in runtime_mechanics

            if re.search(
                r"\b(portal|portals|goal|exit|finish level|complete level)\b",
                low,
            ):
                return "goal flag" in runtime_mechanics

            if re.search(r"\b(hazard|hazards|avoid hazards?)\b", low):
                return "hazards" in runtime_mechanics

            if re.search(r"\b(gravity|falling)\b", low):
                return "gravity" in runtime_mechanics

            if re.search(
                r"\b(touch|mobile controls?|touch controls?)\b",
                low,
            ):
                return "touch controls" in runtime_mechanics

        return False

    supported, unsupported = [], []

    for m in _slist(requested, 15, 100):
        mt = _tokens(m)

        # Vetted runtime capability is authoritative.
        if deterministically_supported(m):
            supported.append(m)
            continue

        # Only trust the LLM unsupported list when deterministic capability
        # cannot establish support.
        llm_says_unsupported = any(
            mt == ut
            or (
                mt
                and ut
                and len(mt & ut) / len(mt | ut) >= 0.6
            )
            for ut in llm_unsup_tok
        )

        if llm_says_unsupported:
            unsupported.append(m)
        else:
            unsupported.append(m)

    # Preserve genuinely unsupported LLM findings, but never re-add a
    # mechanic that the runtime deterministically supports.
    for m in llm_unsup:
        if deterministically_supported(m):
            continue
        if m not in unsupported:
            unsupported.append(m)

    return {
        "supported": supported,
        "unsupported": unsupported,
        "runtime_mechanics": runtime_mechanics,
    }


# ── Asset requirement derivation + library matching ─────────────────
PRIORITY_BY_CATEGORY = {"promotional": "marketing", "cinematic": "marketing",
                        "music": "polish", "sound_effect": "polish", "voice": "polish"}


def asset_priority(category: str, required: bool) -> str:
    """Required to Play / Optional Gameplay / Polish / Marketing.
    Prototypes are NEVER blocked by optional media."""
    return PRIORITY_BY_CATEGORY.get(category) or ("required_to_play" if required else "optional_gameplay")


def derive_asset_requirements(rt: str, bp: dict, complexity: int) -> list:
    style = ", ".join(_slist((bp.get("media") or {}).get("artwork"), 2, 90)) or \
        f"{bp['identity'].get('genre') or 'game'} art, {bp['identity'].get('visual_dimension') or '2d'}"
    title = bp["identity"].get("title") or "the game"
    reqs = []
    if rt:
        for key in PROFILES[profile_for(rt)]:
            # The current Top-Down renderer has no boss or NPC gameplay.
            if rt == "top_down" and key in {"boss_sprite", "npc_sprite"}:
                continue
            d = SLOTS[key]
            if not d["required"] and complexity <= 2 and key in ("boss_sprite", "npc_sprite", "icon_set", "battle_scene", "character_portrait"):
                continue
            reqs.append({
                "req_id": f"req_{key}", "slot": key, "category": SLOT_CATEGORY.get(key, "prop"),
                "label": d["label"], "type": d["kind"],
                "description": f"{d['hint']} for '{title}'",
                "visual_style": style,
                "dimensions_or_format": "PNG 1024×1024" + (" transparent" if d["transparent"] else ""),
                "target_runtime": rt, "required": d["required"],
                "priority": asset_priority(SLOT_CATEGORY.get(key, "prop"), d["required"]),
                "est_generation_cost": ART_QUALITY[1]["cost"],
                "est_source": "configured_internal_estimate",
            })
    media = bp.get("media") or {}
    extra = [
        ("music", "music", media.get("music"), 0.0, "reuse existing Sounds library — no music-generation provider connected"),
        ("sound_effect", "sound_effect", media.get("sound_effects"), 0.02, "configured_internal_estimate"),
        ("voice", "voice", media.get("voice"), TTS_COST_PER_1K, "tts-1 per ~1k chars"),
        ("cinematic", "cinematic", media.get("cinematics"), 0.8, "sora provider price table — video generation NOT part of planning"),
        ("cover_art", "promotional", media.get("promotional"), IMG_COST, "configured_internal_estimate"),
    ]
    for cat, rid, items, cost, note in extra:
        for i, it in enumerate(_slist(items, 4, 160)):
            reqs.append({"req_id": f"req_{rid}_{i}", "slot": None, "category": cat,
                         "label": cat.replace("_", " ").title(), "type": cat,
                         "description": it, "visual_style": style if cat == "cover_art" else "",
                         "dimensions_or_format": {"music": "mp3", "sound_effect": "mp3/wav",
                                                  "voice": "mp3", "cinematic": "mp4",
                                                  "cover_art": "PNG 1024×1024"}[cat],
                         "target_runtime": rt, "required": False,
                         "priority": asset_priority(cat, False),
                         "est_generation_cost": cost, "est_source": note})
    return reqs[:30]


async def match_requirements(owner_id: str, reqs: list) -> tuple:
    searched = 0

    for r in reqs:
        matches = await asset_library.match_requirement(owner_id, r, limit=3)
        searched += 1

        r["existing_match_found"] = bool(matches)
        r["best_matches"] = matches
        r["generation_required"] = not matches
        r["decision_options"] = [
            "use_suggested",
            "search_library",
            "upload_replacement",
            "generate_later",
        ] + ([] if r["required"] else ["skip_optional"])

        best = matches[0] if matches else None

        if best and best.get("auto_reuse_safe"):
            r["founder_decision"] = "use_suggested"
            r["chosen_asset_id"] = best["asset_id"]
            r["auto_selected"] = True
            r["auto_selected_score"] = best.get("match_score")
            r["auto_selected_reason"] = "exact category + slot tag + runtime compatibility"
        else:
            r["founder_decision"] = "pending"
            r["chosen_asset_id"] = None
            r["auto_selected"] = False

    return reqs, searched


# ── Validation ───────────────────────────────────────────────────────
def _requested_stage_count(text: str):
    patterns = (
        r"\bexactly\s+(\d{1,2})\s*(?:levels?|stages?|worlds?|lands?)\b",
        r"\b(\d{1,2})[- ](?:level|stage|world|land)\b",
        r"\b(?:levels?|stages?|worlds?|lands?)\s*[:=]\s*(\d{1,2})\b",
    )
    for pattern in patterns:
        match = re.search(pattern, str(text or ""), re.IGNORECASE)
        if match:
            return min(max(int(match.group(1)), 1), 50)
    return None


def validate_blueprint(doc: dict) -> dict:
    bp = doc["blueprint"]
    warnings, blocking = [], []
    if not bp["identity"].get("title"):
        blocking.append("Blueprint is missing a game title")
    if not bp["gameplay"].get("core_loop"):
        blocking.append("Blueprint is missing a core gameplay loop")
    if not doc.get("selected_runtime"):
        blocking.append("No compatible runtime selected — pick a runtime before approval")
    vd = bp["identity"].get("visual_dimension")
    if vd in ("light_3d", "advanced_3d"):
        warnings.append(f"Requested '{vd}' — all vetted runtimes render 2D/2.5D browser presentations; "
                        "3D depth is stylistic only")
    if doc.get("selected_runtime") in SCAFFOLDED_RUNTIMES:
        warnings.append(f"{SCAFFOLDED_RUNTIMES[doc['selected_runtime']]} is registered but not yet generatable")
    ms = doc.get("mechanics_support") or {}
    if ms.get("unsupported"):
        warnings.append(f"{len(ms['unsupported'])} requested mechanic(s) are not supported by the selected runtime")

    generated_ms = doc.get("generated_mechanics_support") or {}
    generated_unsupported = generated_ms.get("unsupported") or []
    if generated_unsupported:
        blocking.append(
            "Generated blueprint promises unsupported gameplay: " +
            ", ".join(str(x) for x in generated_unsupported[:6])
        )

    requested_count = doc.get("requested_stage_count")
    actual_count = len(bp.get("gameplay", {}).get("levels") or [])
    if requested_count and actual_count != requested_count:
        blocking.append(
            f"Exactly {requested_count} levels/stages were requested, "
            f"but the blueprint generated {actual_count}"
        )

    fire_text = " ".join(
        bp.get("systems", {}).get("fire_power_integrations") or []
    )
    risky_terms = sorted(set(re.findall(
        r"\b(?:pay|payment|buy|purchase|purchasable|price|cost|currency|token|cash|sell|trade)\w*\b",
        fire_text,
        re.IGNORECASE,
    )))
    if risky_terms:
        blocking.append(
            "Fire Power wording must use reward/require/burn language; remove: " +
            ", ".join(risky_terms)
        )

    missing = [r for r in doc.get("asset_requirements") or [] if r.get("required") and r.get("generation_required")]
    if missing:
        warnings.append(f"{len(missing)} required asset(s) have no library match and would need generation later")
    status = "invalid" if blocking else ("valid_with_warnings" if warnings else "valid")
    return {"status": status, "blocking": blocking, "warnings": warnings}


def build_stages(complexity: int) -> list:
    base = [("blueprint_planning", "Blueprint planning (this phase)"),
            ("asset_resolution", "Asset resolution — reuse, upload or generate"),
            ("game_spec_generation", "Game content spec generation"),
            ("runtime_assembly", "Runtime assembly & asset wiring"),
            ("validation_tests", "Automated validation tests"),
            ("founder_review", "Founder preview & approval"),
            ("publish", "Publish to /games")]
    if complexity >= 5:
        base.insert(4, ("polish_pass", "Polish & balancing pass"))
    return [{"id": i, "label": l} for i, l in base]


# ── Blueprint assembly ───────────────────────────────────────────────
def _parse_plan(raw: str) -> dict:
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        m = re.search(r"\{.*\}", raw or "", re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:  # noqa: BLE001
                pass
    return {}


def _assemble_sections(plan: dict, complexity: int, power: int) -> dict:
    vd = plan.get("visual_dimension")
    return {
        "identity": {"title": str(plan.get("title") or "")[:120],
                     "description": str(plan.get("description") or "")[:600],
                     "genre": str(plan.get("genre") or "")[:80],
                     "target_devices": _slist(plan.get("target_devices"), 4, 20) or ["desktop", "mobile"],
                     "visual_dimension": vd if vd in VISUAL_DIMENSIONS else "2d"},
        "runtime": {"family": None, "runtime_id": None,
                    "camera_model": str(plan.get("camera_model") or "")[:120],
                    "control_model": str(plan.get("control_model") or "")[:120]},
        "gameplay": {"core_loop": str(plan.get("core_loop") or "")[:400],
                     "player_mechanics": _slist(plan.get("player_mechanics")),
                     "enemies": _slist(plan.get("enemies")), "bosses": _slist(plan.get("bosses")),
                     "npcs": _slist(plan.get("npcs")), "levels": _slist(plan.get("levels")),
                     "worlds": _slist(plan.get("worlds")), "maps": _slist(plan.get("maps")),
                     "objectives": _slist(plan.get("objectives")), "quests": _slist(plan.get("quests")),
                     "progression": str(plan.get("progression") or "")[:300],
                     "inventory": str(plan.get("inventory") or "")[:300],
                     "upgrades": _slist(plan.get("upgrades")), "abilities": _slist(plan.get("abilities")),
                     "weapons_or_spells": _slist(plan.get("weapons_or_spells"))},
        "systems": {"ui_hud": _slist(plan.get("ui_hud")),
                    "save_requirements": str(plan.get("save_requirements") or "")[:300],
                    "achievements": _slist(plan.get("achievements")),
                    "tutorials": _slist(plan.get("tutorials")),
                    "fire_power_integrations": _slist(plan.get("fire_power_integrations"))},
        "media": {"artwork": _slist(plan.get("artwork_requirements")),
                  "animation": _slist(plan.get("animation_requirements")),
                  "music": _slist(plan.get("music_requirements")),
                  "sound_effects": _slist(plan.get("sound_effect_requirements")),
                  "voice": _slist(plan.get("voice_requirements")),
                  "cinematics": _slist(plan.get("cinematic_requirements")),
                  "promotional": _slist(plan.get("promotional_media_requirements")),
                  "accessibility": _slist(plan.get("accessibility_requirements"))},
        "meta": {"estimated_complexity": complexity,
                 "estimated_ai_power": power,
                 "est_play_minutes": str(plan.get("est_play_minutes") or "")[:20]},
    }




_TOP_DOWN_BLOCKED = re.compile(
    r"\b(?:boss|bosses|quest|quests|npc|npcs|dialogue|dialog|inventory|loot|"
    r"combat|attack|weapon|spell|shop|craft|cooking interaction|puzzle|switch|"
    r"key[- ]gated|locked room|unlock room|doors?|door system)\b",
    re.IGNORECASE,
)

_TOP_DOWN_ALLOWED = re.compile(
    r"\b(?:top[- ]down|overhead|four[- ]direction|4[- ]direction|move|movement|"
    r"collect|collectible|core|ingredient|obstacle|patrol|chaser|hazard|avoid|"
    r"checkpoint|respawn|portal|finish|touch|mobile|coin|gem|star|key|"
    r"engagement resource|resource pickup)\b",
    re.IGNORECASE,
)


def _content_values_text(value) -> str:
    """Flatten populated JSON values without treating schema keys as mechanics."""
    if isinstance(value, dict):
        return " ".join(_content_values_text(v) for v in value.values() if v)
    if isinstance(value, (list, tuple, set)):
        return " ".join(_content_values_text(v) for v in value if v)
    return str(value or "")


def _top_down_stage_summary(item: str, index: int) -> str:
    if not _TOP_DOWN_BLOCKED.search(item):
        return item
    match = re.search(
        r"['\"](?:name|title)['\"]\s*:\s*['\"]([^'\"]+)",
        item,
        re.IGNORECASE,
    )
    label = match.group(1)[:80] if match else f"Stage {index + 1}"
    return (
        f"{label} — unique overhead layout with ingredient-themed cores, "
        "obstacles, patrol/chaser hazards, checkpoints, verified resource "
        "pickups and a finish portal"
    )


def _sanitize_runtime_sections(sections: dict, selected_rt: str,
                               request_text: str, tools=None) -> dict:
    """Remove promises the selected executable runtime cannot perform."""
    identity = sections.get("identity") or {}
    runtime = sections.get("runtime") or {}
    gameplay = sections.get("gameplay") or {}
    systems = sections.get("systems") or {}
    media = sections.get("media") or {}
    toolset = {str(x).strip().lower() for x in (tools or []) if str(x).strip()}

    if selected_rt == "top_down":
        portal_label = (
            "Arcane Hearth finish portal"
            if re.search(r"\barcane hearth\b", request_text or "", re.IGNORECASE)
            else "finish portal"
        )
        if _TOP_DOWN_BLOCKED.search(identity.get("description") or ""):
            identity["description"] = (
                f"{identity.get('title') or 'This game'} is a true overhead "
                "collection-and-avoidance game using the existing Top-Down runtime."
            )
        identity["genre"] = "top-down collection / avoidance"
        runtime["camera_model"] = "true overhead top-down camera"
        runtime["control_model"] = (
            "WASD/arrow-key 4-direction movement and responsive mobile touch movement"
        )
        gameplay["core_loop"] = (
            "Move through each overhead stage, collect every required "
            "ingredient-themed core, avoid obstacles and patrol/chaser hazards, "
            f"then enter the activated {portal_label}."
        )
        for key in ("bosses", "npcs", "quests", "upgrades", "abilities",
                    "weapons_or_spells"):
            gameplay[key] = []
        gameplay["inventory"] = ""
        gameplay["progression"] = (
            "Clearing one stage opens the next stage; required cores reset "
            "at the start of each stage."
        )
        gameplay["player_mechanics"] = [
            item for item in _slist(gameplay.get("player_mechanics"), 20, 160)
            if _TOP_DOWN_ALLOWED.search(item) and not _TOP_DOWN_BLOCKED.search(item)
        ]
        if not gameplay["player_mechanics"]:
            gameplay["player_mechanics"] = [
                "4-direction overhead movement",
                "collect required ingredient-themed cores",
                "avoid obstacles and patrol/chaser hazards",
                "checkpoint respawn",
                "collect verified Coin, Gem, Star and Key pickups",
                "enter the finish portal after all required cores are collected",
            ]
        gameplay["enemies"] = [
            item for item in _slist(gameplay.get("enemies"), 20, 160)
            if re.search(r"\b(?:patrol|patroller|chaser|hazard)\b", item, re.IGNORECASE)
            and not _TOP_DOWN_BLOCKED.search(item)
        ] or [
            "Patrol hazard — pursues the player when nearby",
            "Chaser hazard — pursues the player when nearby",
        ]
        gameplay["levels"] = [
            _top_down_stage_summary(item, i)
            for i, item in enumerate(_slist(gameplay.get("levels"), 50, 500))
        ]
        gameplay["worlds"] = [
            item for item in _slist(gameplay.get("worlds"), 50, 160)
            if not _TOP_DOWN_BLOCKED.search(item)
        ]
        gameplay["maps"] = [
            item for item in _slist(gameplay.get("maps"), 50, 160)
            if not _TOP_DOWN_BLOCKED.search(item)
        ]
        gameplay["objectives"] = [
            "Collect every required ingredient-themed core",
            "Avoid obstacles and patrol/chaser hazards",
            f"Reach the activated {portal_label}",
            "Optionally collect verified Coins, Gems, Stars and Keys",
        ]
        systems["ui_hud"] = [
            item for item in _slist(systems.get("ui_hud"), 20, 160)
            if not _TOP_DOWN_BLOCKED.search(item)
        ] or [
            "Stage name, required cores remaining, lives and verified resource counters"
        ]
        systems["achievements"] = [
            item for item in _slist(systems.get("achievements"), 20, 160)
            if not _TOP_DOWN_BLOCKED.search(item)
        ]
        systems["tutorials"] = [
            "Show 4-direction movement, core collection, hazards, checkpoints, "
            "verified resource pickups and the finish portal."
        ]
        systems["save_requirements"] = (
            "Verified Coins, Gems, Stars and Keys use the shared Engagement "
            "Resource systems; checkpoint position lasts for the current stage."
        )
        for key in ("artwork", "animation", "promotional"):
            media[key] = [
                item for item in _slist(media.get(key), 20, 160)
                if not _TOP_DOWN_BLOCKED.search(item)
            ]

    if not re.search(r"\bfire power\b", request_text or "", re.IGNORECASE):
        systems["fire_power_integrations"] = []

    if toolset:
        if not toolset.intersection({"audio", "music", "sound", "voice"}):
            media["music"] = []
            media["sound_effects"] = []
            media["voice"] = []
        if "video" not in toolset:
            media["cinematics"] = []
        if "image" not in toolset:
            media["artwork"] = []
            media["animation"] = []
            media["promotional"] = []

    sections["identity"] = identity
    sections["runtime"] = runtime
    sections["gameplay"] = gameplay
    sections["systems"] = systems
    sections["media"] = media
    return sections


async def plan_blueprint(body: dict, current: dict, *, existing: dict = None,
                         feedback: str = "") -> dict:
    """Planning ONLY — one LLM call, no media generation, no build."""
    request_text = str(body.get("request") or (existing or {}).get("request") or "")[:12000]
    complexity = min(max(int(body.get("complexity") or (existing or {}).get("complexity") or 10), 1), 10)
    power = min(max(int(body.get("ai_power") or (existing or {}).get("ai_power") or 10), 1), 10)
    feedback = str(feedback or "")[:4000]
    requested_stage_count = _requested_stage_count(
        request_text + "\n" + feedback
    )
    # Capability-matrix runtime selection BEFORE any generation. Incompatible
    # requests are refused here — no blueprint is ever generated for them.
    sel = select_best_runtime(request_text)
    preselected = (
        (existing or {}).get("selected_runtime")
        or (sel.get("selected") or {}).get("runtime")
    )
    tools = list(body.get("tools") or (existing or {}).get("tools") or [])
    settings = body.get("settings") or (existing or {}).get("settings") or {}
    if sel["no_compatible_runtime"] and not (existing or {}).get("selected_runtime"):
        raise HTTPException(status_code=422, detail={
            "error_code": "no_compatible_runtime", **sel["report"],
            "ranked": [{k: r[k] for k in ("runtime", "label", "score", "compatible")}
                       for r in sel["ranked"][:3]]})
    t = tier(min(power, 5))
    request_id = uuid.uuid4().hex
    import time
    _t0 = time.monotonic()
    user_msg = (
        f"Game request: {request_text}\n"
        f"Complexity: {complexity}/10\n"
        f"AI Power: {power}/10"
    )
    if requested_stage_count:
        user_msg += (
            f"\nHARD REQUIREMENT: generate exactly "
            f"{requested_stage_count} levels/stages. "
            "Complexity adds detail inside those levels and must not "
            "change their count."
        )
    if preselected:
        user_msg += (
            f"\nHARD RUNTIME CONTRACT: {preselected} is already selected and "
            "must not be changed. Promise only these executable mechanics: "
            f"{json.dumps(RUNTIME_MECHANICS.get(preselected, []))}. "
            "Theme and labels may change; executable systems may not."
        )
    if preselected == "top_down":
        user_msg += (
            "\nTOP-DOWN OUTPUT RULES: use a true overhead camera and only the "
            "existing 4-direction movement, required collectible cores, static "
            "obstacles, patrol/chaser hazards, checkpoints/respawn, verified "
            "Coin/Gem/Star/Key pickups, finish portal and touch controls. Leave "
            "bosses, NPCs, quests, dialogue, inventory/loot, combat, attacks, "
            "weapons, spells, crafting, cooking interactions and puzzle systems "
            "empty. Ingredient cores and any founder-named portal are themes for "
            "existing mechanics, not new systems."
        )
    if tools:
        user_msg += (
            f"\nSELECTED PROJECT TOOLS: {json.dumps(tools)}. Do not request media "
            "from unselected tools. Game + Image alone means music, sound "
            "effects, voice and cinematics must be empty."
        )
    if existing and feedback:
        user_msg += (
            "\nREVISION — previous blueprint "
            "(revise per feedback, keep what works):\n"
            f"{json.dumps(existing['blueprint'], default=str)[:12000]}"
            f"\nFounder feedback: {feedback}"
        )
    res = await call_openai_chat(
        [{"role": "system", "content": PLAN_SYSTEM}, {"role": "user", "content": user_msg}],
        model=t["model"], max_tokens=t["max_tokens"], json_mode=True)
    plan = _parse_plan(res.get("content") or "")
    log.info("blueprint plan: rid=%s provider=%s model=%s content_len=%s parsed_keys=%s",
             request_id[:8], res.get("provider"), res.get("model"),
             len(res.get("content") or ""), len(plan))
    sections = _assemble_sections(plan, complexity, power)
    # The deterministic capability matrix is authoritative.
    # Legacy recommendation remains available for diagnostics/fallback only.
    rec = recommend_runtime(request_text, str(plan.get("runtime") or ""),
                            plan.get("requested_mechanics") or sections["gameplay"]["player_mechanics"])
    selected = (existing or {}).get("selected_runtime") if existing else None
    mech_pick = (sel.get("selected") or {}).get("runtime")

    if mech_pick:
        rec["legacy_recommended"] = rec.get("recommended")
        rec["legacy_recommended_label"] = rec.get("recommended_label")
        rec["legacy_compatibility_score"] = rec.get("compatibility_score")

        rec["recommended"] = mech_pick
        rec["recommended_label"] = RUNTIME_LABELS.get(mech_pick)
        rec["compatibility_score"] = sel["selected"]["score"]
        rec["reason"] = "deterministic capability matrix matched the requested mechanics"
        rec["method"] = sel["method"]

        rec["mechanics_selection"] = {
            "selected": mech_pick,
            "score": sel["selected"]["score"],
            "detected_mechanics": sel["detected_mechanics"],
            "method": sel["method"],
        }

    selected = selected or mech_pick or rec["recommended"]
    sections["runtime"]["runtime_id"] = selected
    sections["runtime"]["family"] = RUNTIME_LABELS.get(selected) if selected else None
    sections = _sanitize_runtime_sections(
        sections, selected, request_text, tools
    )

    # Check what remains after the executable-runtime truth boundary.
    generated_mechanics = detect_mechanics(
        _content_values_text(sections.get("gameplay") or {})
    )
    generated_ms = mechanics_support(
        selected, generated_mechanics, []
    ) if selected else {
        "supported": [],
        "unsupported": generated_mechanics,
        "runtime_mechanics": [],
    }

    # Validate the same deterministic mechanics that selected the runtime.
    # Do not let LLM-added mechanics create false incompatibility warnings.
    requested_for_support = (
        sel.get("detected_mechanics")
        if mech_pick
        else (plan.get("requested_mechanics") or sections["gameplay"]["player_mechanics"])
    )

    ms = mechanics_support(
        selected,
        requested_for_support,
        [] if mech_pick else plan.get("unsupported_mechanics"),
    ) if selected else {"supported": [], "unsupported": [], "runtime_mechanics": []}
    reqs = derive_asset_requirements(selected, sections, complexity)
    reqs, searched = await match_requirements(current["id"], reqs)
    gen_needed = [r for r in reqs if r["generation_required"]]
    est_usage = {
        "planning": t["est_cost"],
        "assets_if_generated_later": round(sum(r["est_generation_cost"] for r in gen_needed), 3),
        "source": "configured_internal_estimate — nothing generates in this phase",
    }
    sections["meta"]["estimated_ai_usage"] = est_usage
    sections["meta"]["estimated_build_stages"] = build_stages(complexity)
    sections["meta"]["known_runtime_limitations"] = (
        [f"{RUNTIME_LABELS[selected]} supports: {', '.join(RUNTIME_MECHANICS.get(selected, [])[:8])}"]
        if selected else ["No runtime selected"]) + \
        (["Advanced 3D rendering is not available in any vetted runtime"]
         if sections["identity"]["visual_dimension"] == "advanced_3d" else [])
    doc = {
        "id": (existing or {}).get("id") or uuid.uuid4().hex,
        "schema_version": BLUEPRINT_SCHEMA_VERSION,
        "version": ((existing or {}).get("version") or 0) + 1,
        "project_id": body.get("project_id") or (existing or {}).get("project_id"),
        "request_id": request_id,
        "creator_id": current["id"], "creator_username": current.get("username"),
        "name": str(body.get("name") or plan.get("title") or "Untitled Blueprint")[:120],
        "request": request_text,
        "complexity": complexity, "ai_power": power,
        "tools": tools, "settings": settings,
        "blueprint": sections,
        "runtime_recommendation": rec,
        "runtime_selection": {k: sel[k] for k in ("detected_mechanics", "core_mechanics",
                                                  "compatible_runtimes", "method")
                              if k in sel} | {"ranked": sel.get("ranked") or []},
        "selected_runtime": selected,
        "selected_runtime_label": RUNTIME_LABELS.get(selected) if selected else None,
        "mechanics_support": ms,
        "generated_mechanics": generated_mechanics,
        "generated_mechanics_support": generated_ms,
        "requested_stage_count": requested_stage_count,
        "asset_requirements": reqs,
        "approval_status": "pending_founder_approval",
        "status": "draft",
        "created_at": (existing or {}).get("created_at") or _iso(),
        "updated_at": _iso(),
    }
    doc["validation"] = validate_blueprint(doc)
    sections["meta"]["validation_warnings"] = doc["validation"]["warnings"]
    doc["diagnostics"] = {
        "planning_provider": res.get("provider"),
        "planning_model": res.get("model"),
        "requested_model": res.get("requested_model"),
        "fallback_used": res.get("provider") != "openai",
        "planning_duration_ms": int((time.monotonic() - _t0) * 1000),
        "selected_runtime": selected,
        "runtime_compatibility_score": rec["compatibility_score"],
        "required_assets": len(reqs),
        "existing_matches": sum(1 for r in reqs if r["existing_match_found"]),
        "missing_assets": len(gen_needed),
        "library_searches": searched,
        "schema_validation_status": doc["validation"]["status"],
        "request_id": request_id,
        "project_id": doc["project_id"],
        "media_generated": False, "build_started": False,
    }
    await db.orai_routing_events.insert_one({
        "id": uuid.uuid4().hex, "kind": "blueprint_plan",
        "request_id": request_id, "user_id": current["id"],
        "provider": res.get("provider"), "model": res.get("model"),
        "fallback_used": res.get("provider") != "openai",
        "runtime": selected, "compatibility_score": rec["compatibility_score"],
        "asset_searches": searched, "existing_matches": doc["diagnostics"]["existing_matches"],
        "missing_assets": doc["diagnostics"]["missing_assets"],
        "duration_ms": doc["diagnostics"]["planning_duration_ms"],
        "validation_status": doc["validation"]["status"], "at": _iso()})
    return doc


# ── AAA Media Package (planning only — never generates) ─────────────
MEDIA_PACKAGE_ITEMS = [
    ("logo", "Game logo wordmark", "PNG 1024 transparent"),
    ("icon", "App/store icon", "PNG 512 square"),
    ("cover_art", "Store cover art", "PNG 1536×1024"),
    ("screenshot", "Gameplay screenshot ×3", "PNG 1536×1024"),
    ("loading_screen", "Loading screen artwork", "PNG 1536×1024"),
    ("music", "Theme music track", "mp3 (reuse existing Sounds)"),
    ("sound_effect", "Core SFX set", "mp3/wav"),
    ("trailer", "Gameplay trailer", "mp4 8-12s (sora — NOT generated in planning)"),
    ("tutorial", "Tutorial / how-to-play card", "PNG or in-game overlay"),
    ("world_map", "World map artwork", "PNG 1536×1024"),
    ("achievement_art", "Achievement badge art set", "PNG 512 transparent"),
]


def build_media_package(doc: dict) -> dict:
    ident = doc["blueprint"]["identity"]
    title = ident.get("title") or doc.get("name") or "Untitled Game"
    genre = ident.get("genre") or "game"
    items = [{"id": mid, "label": label, "format": fmt, "status": "planned",
              "generated": False, "asset_id": None}
             for mid, label, fmt in MEDIA_PACKAGE_ITEMS]
    return {
        "items": items,
        "store_copy": {
            "title": title,
            "tagline": (doc["blueprint"]["gameplay"].get("core_loop") or "")[:90],
            "short_description": (ident.get("description") or "")[:200],
            "long_description": ident.get("description") or "",
        },
        "tags": [t for t in [genre, doc.get("selected_runtime"),
                             ident.get("visual_dimension")] if t][:8],
        "release_notes_template": f"{title} v1.0 — initial release.\n- \n- \n- ",
        "status": "planned", "media_generated": False,
        "planned_at": _iso(),
    }


def change_runtime(doc: dict, new_rt: str) -> dict:
    """Founder-driven runtime change — recomputes support + requirements
    (matching is re-run by the caller)."""
    doc["selected_runtime"] = new_rt
    doc["selected_runtime_label"] = RUNTIME_LABELS.get(new_rt)
    doc["blueprint"]["runtime"]["runtime_id"] = new_rt
    doc["blueprint"]["runtime"]["family"] = RUNTIME_LABELS.get(new_rt)
    req_mech = doc["blueprint"]["gameplay"]["player_mechanics"]
    doc["mechanics_support"] = mechanics_support(new_rt, req_mech, [])
    doc["asset_requirements"] = derive_asset_requirements(new_rt, doc["blueprint"], doc["complexity"])
    scores = {c["runtime_id"]: c["score"] for c in doc["runtime_recommendation"]["compatible_runtimes"]}
    doc["diagnostics"]["selected_runtime"] = new_rt
    doc["diagnostics"]["runtime_compatibility_score"] = scores.get(new_rt, 0.1)
    doc["blueprint"]["meta"]["known_runtime_limitations"] = [
        f"{RUNTIME_LABELS[new_rt]} supports: {', '.join(RUNTIME_MECHANICS.get(new_rt, [])[:8])}"]
    doc["updated_at"] = _iso()
    return doc
