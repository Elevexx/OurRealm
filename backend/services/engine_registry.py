"""Phase 2 — Versioned Engine / Runtime / Pipeline / Schema registries.

Design rules (founder mandate):
  • Existing games are NEVER rebuilt or silently migrated — pinning is an
    insert-only overlay in gm_game_pins; game docs are never touched.
  • Released versions (status != draft) are immutable; edits require clone.
  • Lifecycle: draft → internal → beta → live → disabled.
  • Disabled prevents NEW use only; existing pinned games keep working.
  • Capability declarations are truthful — the contract test fails any
    capability marked true that the engine does not actually implement.
"""
import logging
import uuid
from datetime import datetime, timezone

from core.db import db

log = logging.getLogger("ourrealm.engine_registry")

STATUSES = ("draft", "internal", "beta", "live", "disabled")
PROMOTE_ORDER = ["draft", "internal", "beta", "live"]
FAMILIES = ("engine", "runtime", "pipeline", "schema")


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes():
    await db.gm_registry_items.create_index([("family", 1), ("key", 1)], unique=True)
    await db.gm_registry_versions.create_index([("family", 1), ("key", 1), ("version", 1)], unique=True)
    await db.gm_game_pins.create_index("game_id")
    await db.gm_game_pins.create_index("run_id")
    await db.gm_registry_audit.create_index([("family", 1), ("key", 1)])


async def _audit(family, key, version, action, by, details=None):
    await db.gm_registry_audit.insert_one({
        "id": uuid.uuid4().hex, "family": family, "key": key, "version": version,
        "action": action, "by": by, "at": _iso(), "details": details or {}})


# ─── Repo truth: implemented runtimes and their real mechanics ────────────
# Derived from frontend/src/components/games/GameRuntime.jsx (impl fn map,
# line ~152) and dragonrealm/DragonRealmRuntime.jsx. A capability may only
# be declared true if it appears here — the contract test enforces this.

CAPABILITY_KEYS = (
    "realtime_movement", "turn_based", "physics_platforming", "combat",
    "projectiles", "enemies_ai", "boss_fights", "inventory_loot",
    "quests_dialogue", "level_progression", "procedural_generation",
    "grid_puzzle", "deck_cards", "base_building", "economy_sim",
    "rhythm_timing", "saves_progress", "mobile_touch", "keyboard",
    "gamepad", "multiplayer", "open_world", "first_person",
)

_COMMON = {"saves_progress", "mobile_touch", "keyboard"}

RUNTIME_MECHANICS: dict[str, set] = {
    "dodge_collect": {"realtime_movement", "level_progression"} | _COMMON,
    "top_down": {"realtime_movement", "level_progression"} | _COMMON,
    "platformer": {"realtime_movement", "physics_platforming", "level_progression"} | _COMMON,
    "action_rpg_2_5d": {"realtime_movement", "physics_platforming", "combat", "projectiles",
                        "enemies_ai", "boss_fights", "quests_dialogue", "inventory_loot",
                        "level_progression"} | _COMMON,
    "rpg": {"combat", "enemies_ai", "inventory_loot", "quests_dialogue", "level_progression",
            "grid_puzzle"} | _COMMON,
    "turn_based_creature_rpg": {"turn_based", "combat", "enemies_ai", "inventory_loot",
                                "quests_dialogue", "level_progression", "grid_puzzle"} | _COMMON,
    "dragon_realm_rpg": {"turn_based", "combat", "enemies_ai", "inventory_loot",
                         "quests_dialogue", "level_progression"} | _COMMON,
    "card_battle": {"turn_based", "deck_cards", "combat"} | _COMMON,
    "tower_defense": {"base_building", "enemies_ai", "level_progression"} | _COMMON,
    "match3": {"grid_puzzle"} | _COMMON,
    "racing": {"realtime_movement", "level_progression"} | _COMMON,
    "farming": {"economy_sim", "level_progression"} | _COMMON,
    "city_builder": {"base_building", "economy_sim"} | _COMMON,
    "roguelike": {"procedural_generation", "combat", "enemies_ai", "grid_puzzle"} | _COMMON,
    "tactics": {"turn_based", "combat", "enemies_ai", "grid_puzzle"} | _COMMON,
    "idle": {"economy_sim"} | _COMMON,
    "visual_novel": {"quests_dialogue"} | _COMMON,
    "fishing": {"rhythm_timing"} | _COMMON,
    "rhythm": {"rhythm_timing"} | _COMMON,
    "quiz_adventure": {"quests_dialogue"} | _COMMON,
    "matching": {"grid_puzzle"} | _COMMON,
    "sorting": {"grid_puzzle"} | _COMMON,
    "memory": {"grid_puzzle"} | _COMMON,
    "puzzle_room": {"grid_puzzle", "quests_dialogue"} | _COMMON,
    # Planned — nothing implemented yet; truthfully empty:
    "open_world_rpg": set(),
    "shooter": set(),
}

RUNTIME_ENGINE = {k: "orc_canvas_v1" for k in RUNTIME_MECHANICS}
RUNTIME_ENGINE["dragon_realm_rpg"] = "dragon_realm_v1"

RUNTIME_NAMES = {
    "dodge_collect": "Dodge & Collect", "top_down": "Top-Down Adventure",
    "platformer": "Platformer", "action_rpg_2_5d": "Action RPG 2.5D",
    "rpg": "Grid RPG", "turn_based_creature_rpg": "Turn-Based Creature RPG",
    "dragon_realm_rpg": "Dragon Realm Pixel RPG", "card_battle": "Card Battle",
    "tower_defense": "Tower Defense", "match3": "Match-3 Puzzle", "racing": "Racing",
    "farming": "Farming", "city_builder": "City Builder", "roguelike": "Roguelike",
    "tactics": "Tactics", "idle": "Idle / Clicker", "visual_novel": "Visual Novel",
    "fishing": "Fishing", "rhythm": "Rhythm", "quiz_adventure": "Quiz Adventure",
    "matching": "Matching Pairs", "sorting": "Sorting", "memory": "Memory",
    "puzzle_room": "Puzzle Room", "open_world_rpg": "Open World RPG", "shooter": "Shooter",
}

PLANNED_RUNTIMES = {"open_world_rpg", "shooter"}

_UI_BASED = {"quiz_adventure", "matching", "sorting", "memory", "rhythm", "puzzle_room",
             "card_battle", "visual_novel", "fishing", "idle", "farming", "city_builder", "tactics"}


def _asset_slots(key: str) -> list:
    if key in _UI_BASED:
        return ["background", "ui_frame", "icon_set", "character_portrait"]
    return ["background", "player_sprite", "enemy_sprite", "icon_set", "music_theme"]


ENGINES = [
    ("orc_canvas_v1", "ORC Universal Canvas/DOM Engine",
     "frontend/src/components/games/GameRuntime.jsx — 23 runtime implementations, canvas + DOM modes"),
    ("dragon_realm_v1", "Dragon Realm Pixel Engine",
     "frontend/src/components/games/dragonrealm/ — dedicated pixel creature-RPG engine"),
]

PIPELINES = [
    ("gamemaker_build", "Game Maker Build",
     ["quote", "hold", "planning", "vetted_spec_generation", "validation", "save", "burn_finalize"]),
    ("gamemaker_publish", "Game Maker Publish",
     ["validate_controls", "flip_status", "foryou_post_idempotent"]),
    ("orai_edit", "ORAi Live Edit", ["dry_run_preview", "apply_edit", "version_bump"]),
    ("resource_visual_gen", "Resource Visual Generation",
     ["policy_check", "master_generation", "derive_sizes", "version_save"]),
    ("blueprint_studio_build", "Blueprint Studio Build",
     ["runtime_selection", "gameplay_generation", "validation", "founder_review", "playable_build"]),
]


# ─── Idempotent seed (insert-only — never overwrites founder edits) ──────

async def ensure_seed():
    now = _iso()

    async def _item(family, key, doc):
        if not await db.gm_registry_items.find_one({"family": family, "key": key}, {"_id": 1}):
            await db.gm_registry_items.insert_one({"id": uuid.uuid4().hex, "family": family,
                                                   "key": key, "disabled": False,
                                                   "created_at": now, "created_by": "seed", **doc})

    async def _version(family, key, version, status, definition):
        if not await db.gm_registry_versions.find_one({"family": family, "key": key, "version": version}, {"_id": 1}):
            await db.gm_registry_versions.insert_one({
                "id": uuid.uuid4().hex, "family": family, "key": key, "version": version,
                "status": status, "definition": definition, "last_contract_test": None,
                "released_at": now if status != "draft" else None,
                "created_at": now, "created_by": "seed", "notes": "seeded from repo inventory"})

    for key, name, desc in ENGINES:
        await _item("engine", key, {"name": name, "description": desc})
        await _version("engine", key, 1, "live", {"impl_ref": desc})

    for key, mech in RUNTIME_MECHANICS.items():
        engine = RUNTIME_ENGINE[key]
        planned = key in PLANNED_RUNTIMES
        await _item("runtime", key, {"name": RUNTIME_NAMES[key], "engine_key": engine,
                                     "description": ("PLANNED — not yet implemented" if planned
                                                     else f"Implemented in {engine}")})
        await _version("runtime", key, 1, "draft" if planned else "live", {
            "engine_key": engine, "engine_version": 1,
            "capabilities": {c: (c in mech) for c in CAPABILITY_KEYS},
            "controls": {"keyboard": not planned, "touch": not planned, "gamepad": False},
            "asset_slots": [] if planned else _asset_slots(key),
            "spec_schema": f"spec_{key}@1", "save_schema": "save_game_progress@1",
            "resource_manifest": "resource_manifest_engagement@1",
            "validation_suite": ["engine_binding", "impl_exists", "capability_truthfulness",
                                 "schemas_pinned", "controls_declared", "reference_spec"],
        })

    for key, name, stages in PIPELINES:
        await _item("pipeline", key, {"name": name, "description": " → ".join(stages)})
        await _version("pipeline", key, 1, "live", {"stages": stages})

    for key in RUNTIME_MECHANICS:
        await _item("schema", f"spec_{key}", {"name": f"Spec schema — {RUNTIME_NAMES[key]}", "kind": "spec",
                                              "description": "Game spec (st.*) contract; engine impl provides defaults"})
        await _version("schema", f"spec_{key}", 1, "live",
                       {"kind": "spec", "runtime_key": key,
                        "doc": "Fields consumed by the runtime impl; unset fields fall back to engine defaults."})
    # action_rpg_2_5d v2 = XY engine (spec.schema_version >= 2 → arpgXY)
    await _version("schema", "spec_action_rpg_2_5d", 2, "live",
                   {"kind": "spec", "runtime_key": "action_rpg_2_5d",
                    "doc": "schema_version>=2 routes side_scroll mode to the XY engine (arpgXY)."})
    await _item("schema", "save_game_progress", {"name": "Save schema — game_progress", "kind": "save",
                                                 "description": "SAVE_X progress (coins, level, xp, kept keys) per game per user"})
    await _version("schema", "save_game_progress", 1, "live",
                   {"kind": "save", "doc": "Runtime game_progress saves; guest play has saves OFF."})
    await _item("schema", "resource_manifest_engagement", {"name": "Resource manifest — engagement", "kind": "resource_manifest",
                                                           "description": "Per-game engagement resource wiring (fire/keys/coins/gems/stars)"})
    await _version("schema", "resource_manifest_engagement", 1, "live",
                   {"kind": "resource_manifest",
                    "doc": "games.resource_manifest + game_access_ctl reward flags; canonical ledgers in Phase 1 registry."})


# ─── Reads ────────────────────────────────────────────────────────────────

async def overview():
    out = {}
    for family in FAMILIES:
        items = []
        async for it in db.gm_registry_items.find({"family": family}, {"_id": 0}).sort("key", 1):
            vers = await db.gm_registry_versions.find(
                {"family": family, "key": it["key"]},
                {"_id": 0, "version": 1, "status": 1, "released_at": 1,
                 "last_contract_test.passed": 1, "last_contract_test.at": 1}).sort("version", 1).to_list(50)
            it["versions"] = vers
            if family == "runtime":
                it["pinned_games"] = await db.gm_game_pins.count_documents(
                    {"runtime_key": it["key"], "active": True})
            items.append(it)
        out[family] = items
    out["pins_total"] = await db.gm_game_pins.count_documents({"active": True})
    return out


async def get_versions(family: str, key: str):
    item = await db.gm_registry_items.find_one({"family": family, "key": key}, {"_id": 0})
    if not item:
        raise ValueError("Not found in registry")
    vers = await db.gm_registry_versions.find({"family": family, "key": key}, {"_id": 0}) \
        .sort("version", 1).to_list(100)
    return {"item": item, "versions": vers}


# ─── Writes (versioned + immutable) ──────────────────────────────────────

async def create_item(family: str, key: str, name: str, actor: str, *, engine_key: str = "",
                      description: str = "", clone_from: dict | None = None):
    key = key.strip().lower().replace(" ", "_")[:60]
    if not key:
        raise ValueError("Key required")
    if await db.gm_registry_items.find_one({"family": family, "key": key}, {"_id": 1}):
        raise ValueError(f"{family} '{key}' already exists")
    doc = {"id": uuid.uuid4().hex, "family": family, "key": key, "name": name[:120] or key,
           "description": description[:400], "disabled": False,
           "created_at": _iso(), "created_by": actor}
    if family == "runtime":
        doc["engine_key"] = engine_key or "orc_canvas_v1"
    await db.gm_registry_items.insert_one(dict(doc))
    definition = None
    if clone_from:
        src = await db.gm_registry_versions.find_one(
            {"family": family, "key": clone_from["key"], "version": int(clone_from["version"])}, {"_id": 0})
        if not src:
            raise ValueError("Clone source version not found")
        definition = src["definition"]
    if definition is None and family == "runtime":
        definition = {"engine_key": doc.get("engine_key"), "engine_version": 1,
                      "capabilities": {c: False for c in CAPABILITY_KEYS},
                      "controls": {"keyboard": False, "touch": False, "gamepad": False},
                      "asset_slots": [], "spec_schema": "", "save_schema": "save_game_progress@1",
                      "resource_manifest": "resource_manifest_engagement@1",
                      "validation_suite": ["engine_binding", "impl_exists", "capability_truthfulness",
                                           "schemas_pinned", "controls_declared", "reference_spec"]}
    await db.gm_registry_versions.insert_one({
        "id": uuid.uuid4().hex, "family": family, "key": key, "version": 1, "status": "draft",
        "definition": definition or {}, "last_contract_test": None, "released_at": None,
        "created_at": _iso(), "created_by": actor,
        "notes": f"cloned from {clone_from['key']} v{clone_from['version']}" if clone_from else "new draft"})
    await _audit(family, key, 1, "created", actor, {"clone_from": clone_from})
    doc.pop("_id", None)
    return doc


async def create_version(family: str, key: str, actor: str, *, clone_from_version: int | None = None):
    if not await db.gm_registry_items.find_one({"family": family, "key": key}, {"_id": 1}):
        raise ValueError("Unknown registry item")
    latest = await db.gm_registry_versions.find_one({"family": family, "key": key},
                                                    {"version": 1}, sort=[("version", -1)])
    new_v = (latest or {}).get("version", 0) + 1
    src_v = clone_from_version if clone_from_version is not None else (latest or {}).get("version")
    definition = {}
    if src_v:
        src = await db.gm_registry_versions.find_one({"family": family, "key": key, "version": int(src_v)}, {"_id": 0})
        if not src:
            raise ValueError("Clone source version not found")
        definition = src["definition"]
    doc = {"id": uuid.uuid4().hex, "family": family, "key": key, "version": new_v,
           "status": "draft", "definition": definition, "last_contract_test": None,
           "released_at": None, "created_at": _iso(), "created_by": actor,
           "notes": f"cloned from v{src_v}" if src_v else "new draft"}
    await db.gm_registry_versions.insert_one(dict(doc))
    await _audit(family, key, new_v, "version_created", actor, {"cloned_from": src_v})
    doc.pop("_id", None)
    return doc


async def edit_draft(family: str, key: str, version: int, changes: dict, actor: str):
    ver = await db.gm_registry_versions.find_one({"family": family, "key": key, "version": version}, {"_id": 0})
    if not ver:
        raise ValueError("Version not found")
    if ver["status"] != "draft":
        raise ValueError(f"v{version} is {ver['status']} — released versions are immutable. Clone to a new draft to edit.")
    definition = dict(ver["definition"])
    allowed = {"capabilities", "controls", "asset_slots", "spec_schema", "save_schema",
               "resource_manifest", "validation_suite", "engine_key", "engine_version",
               "stages", "doc", "impl_ref"}
    applied = {}
    for k, v in changes.items():
        if k in allowed:
            if k == "capabilities":
                v = {c: bool(v.get(c)) for c in CAPABILITY_KEYS}
            definition[k] = v
            applied[k] = v
    if not applied:
        raise ValueError("No editable fields in request")
    await db.gm_registry_versions.update_one(
        {"family": family, "key": key, "version": version},
        {"$set": {"definition": definition, "last_contract_test": None}})
    await _audit(family, key, version, "draft_edited", actor, {"fields": list(applied.keys())})
    return definition


async def promote(family: str, key: str, version: int, to_status: str, actor: str):
    if to_status not in STATUSES:
        raise ValueError("Unknown status")
    ver = await db.gm_registry_versions.find_one({"family": family, "key": key, "version": version}, {"_id": 0})
    if not ver:
        raise ValueError("Version not found")
    cur = ver["status"]
    if to_status == "disabled":
        return await disable(family, key, version, actor)
    if cur == "disabled":
        raise ValueError("Disabled versions cannot be promoted — roll back instead")
    if cur not in PROMOTE_ORDER or to_status not in PROMOTE_ORDER:
        raise ValueError("Invalid transition")
    if PROMOTE_ORDER.index(to_status) != PROMOTE_ORDER.index(cur) + 1:
        raise ValueError(f"Promotion must be sequential: {cur} → {PROMOTE_ORDER[PROMOTE_ORDER.index(cur)+1] if cur != 'live' else 'live (max)'}")
    if family == "runtime" and to_status in ("beta", "live"):
        lt = ver.get("last_contract_test")
        if not (lt and lt.get("passed")):
            raise ValueError(f"Contract tests must pass before promoting to {to_status} — run them first")
    sets = {"status": to_status}
    if not ver.get("released_at"):
        sets["released_at"] = _iso()
    await db.gm_registry_versions.update_one({"family": family, "key": key, "version": version}, {"$set": sets})
    if to_status == "live":  # single live version per key — demote previous live
        await db.gm_registry_versions.update_many(
            {"family": family, "key": key, "version": {"$ne": version}, "status": "live"},
            {"$set": {"status": "beta"}})
    await _audit(family, key, version, f"promoted_{cur}_to_{to_status}", actor)
    return {"status": to_status}


async def disable(family: str, key: str, version: int, actor: str):
    ver = await db.gm_registry_versions.find_one({"family": family, "key": key, "version": version}, {"_id": 0})
    if not ver:
        raise ValueError("Version not found")
    pinned = await db.gm_game_pins.count_documents(
        {"runtime_key": key, "runtime_version": version, "active": True}) if family == "runtime" else 0
    await db.gm_registry_versions.update_one({"family": family, "key": key, "version": version},
                                             {"$set": {"status": "disabled", "pre_disable_status": ver["status"]}})
    await _audit(family, key, version, "disabled", actor,
                 {"pinned_games_unaffected": pinned, "was": ver["status"]})
    return {"status": "disabled", "pinned_games_unaffected": pinned,
            "note": "Existing pinned games keep working; only NEW use is blocked."}


async def rollback(family: str, key: str, to_version: int, actor: str):
    target = await db.gm_registry_versions.find_one({"family": family, "key": key, "version": to_version}, {"_id": 0})
    if not target:
        raise ValueError("Target version not found")
    if not target.get("released_at") and target["status"] == "draft":
        raise ValueError("Cannot roll back to an unreleased draft")
    cur_live = await db.gm_registry_versions.find_one({"family": family, "key": key, "status": "live"}, {"_id": 0})
    if cur_live and cur_live["version"] == to_version:
        raise ValueError(f"v{to_version} is already live")
    if cur_live:
        await db.gm_registry_versions.update_one({"family": family, "key": key, "version": cur_live["version"]},
                                                 {"$set": {"status": "beta"}})
    await db.gm_registry_versions.update_one({"family": family, "key": key, "version": to_version},
                                             {"$set": {"status": "live"}})
    await _audit(family, key, to_version, "rollback_to_live", actor,
                 {"demoted": cur_live["version"] if cur_live else None})
    return {"live_version": to_version, "demoted": cur_live["version"] if cur_live else None}


# ─── New-use guard (req 8): disabling blocks NEW games only ──────────────

async def new_use_allowed(runtime_key: str) -> tuple[bool, str]:
    item = await db.gm_registry_items.find_one({"family": "runtime", "key": runtime_key}, {"_id": 0, "disabled": 1})
    if not item:
        return True, "not in registry (legacy allow)"
    if item.get("disabled"):
        return False, f"Runtime '{runtime_key}' is disabled for new games"
    live = await db.gm_registry_versions.find_one(
        {"family": "runtime", "key": runtime_key, "status": "live"}, {"_id": 0, "version": 1})
    if not live:
        return False, f"Runtime '{runtime_key}' has no Live version — new games are blocked"
    return True, f"live v{live['version']}"


# ─── Inventory / migration map / pinning (insert-only, reversible) ───────

def _map_game(spec: dict) -> tuple[str | None, str]:
    rt = (spec or {}).get("runtime")
    if (spec or {}).get("runtime_id") == "runtime_dragon_realm_rpg_v1":
        return "dragon_realm_rpg", "runtime_id override (Dragon Realm engine)"
    if not rt:
        return None, "no runtime in spec (failed/incomplete build) — pin skipped"
    if rt in RUNTIME_MECHANICS:
        return rt, "spec.runtime"
    return None, f"unknown runtime '{rt}' — needs founder review"


async def inventory():
    """Read-only discovery of everything that exists today."""
    from collections import Counter
    combos, statuses = Counter(), Counter()
    games = []
    async for g in db.games.find({}, {"_id": 0, "id": 1, "title": 1, "status": 1,
                                      "spec.runtime": 1, "spec.runtime_id": 1,
                                      "spec.template_id": 1, "spec.renderer_id": 1}):
        s = g.get("spec") or {}
        key, why = _map_game(s)
        combos[key or "(unmapped)"] += 1
        statuses[g.get("status")] += 1
        games.append({"game_id": g["id"], "title": g.get("title"), "status": g.get("status"),
                      "spec_runtime": s.get("runtime"), "runtime_id": s.get("runtime_id"),
                      "mapped_runtime": key, "mapping_reason": why})
    return {
        "engines": [{"key": k, "name": n, "impl": d} for k, n, d in ENGINES],
        "implemented_runtimes": sorted(k for k in RUNTIME_MECHANICS if k not in PLANNED_RUNTIMES),
        "planned_runtimes": sorted(PLANNED_RUNTIMES),
        "pipelines": [{"key": k, "name": n, "stages": s} for k, n, s in PIPELINES],
        "games_total": len(games), "games_by_status": dict(statuses),
        "games_by_runtime": dict(combos), "games": games,
    }


async def migration_preview():
    inv = await inventory()
    pinned_ids = {p["game_id"] async for p in db.gm_game_pins.find({"active": True}, {"game_id": 1})}
    plan, skipped = [], []
    for g in inv["games"]:
        if g["game_id"] in pinned_ids:
            skipped.append({**g, "reason": "already pinned"})
            continue
        if not g["mapped_runtime"]:
            skipped.append({**g, "reason": g["mapping_reason"]})
            continue
        key = g["mapped_runtime"]
        plan.append({**g, "pin": {"runtime_key": key, "runtime_version": 1,
                                  "engine_key": RUNTIME_ENGINE[key], "engine_version": 1,
                                  "spec_schema": f"spec_{key}@1", "save_schema": "save_game_progress@1",
                                  "resource_manifest": "resource_manifest_engagement@1"}})
    return {"will_pin": len(plan), "skipped": len(skipped), "plan": plan, "skipped_games": skipped,
            "note": "Insert-only pins in gm_game_pins — game documents are never modified. Fully reversible per run_id."}


async def apply_pins(run_id: str, actor: str) -> dict:
    prev = await db.gm_game_pins.find_one({"run_id": run_id}, {"_id": 0, "run_id": 1})
    if prev:  # idempotent re-run
        n = await db.gm_game_pins.count_documents({"run_id": run_id, "active": True})
        return {"run_id": run_id, "pinned": n, "idempotent_replay": True}
    preview = await migration_preview()
    now = _iso()
    pinned = 0
    for row in preview["plan"]:
        await db.gm_game_pins.insert_one({
            "id": uuid.uuid4().hex, "game_id": row["game_id"], "title": row["title"],
            "game_status": row["status"], **row["pin"], "run_id": run_id, "active": True,
            "source": "phase2_migration", "mapping_reason": row["mapping_reason"],
            "pinned_at": now, "pinned_by": actor})
        pinned += 1
    await _audit("runtime", "*", 0, "migration_applied", actor,
                 {"run_id": run_id, "pinned": pinned, "skipped": preview["skipped"]})
    return {"run_id": run_id, "pinned": pinned, "skipped": preview["skipped"]}


async def rollback_pins(run_id: str, actor: str) -> dict:
    r = await db.gm_game_pins.update_many({"run_id": run_id, "active": True},
                                          {"$set": {"active": False, "rolled_back_at": _iso(),
                                                    "rolled_back_by": actor}})
    await _audit("runtime", "*", 0, "migration_rolled_back", actor,
                 {"run_id": run_id, "deactivated": r.modified_count})
    return {"run_id": run_id, "deactivated": r.modified_count}


async def pin_game(game_id: str, actor: str = "system", source: str = "gamemaker_create"):
    """Pin one newly created game (insert-only, non-fatal)."""
    try:
        if await db.gm_game_pins.find_one({"game_id": game_id, "active": True}, {"_id": 1}):
            return
        g = await db.games.find_one({"id": game_id}, {"_id": 0, "id": 1, "title": 1, "status": 1, "spec": 1})
        if not g:
            return
        key, why = _map_game(g.get("spec") or {})
        if not key:
            return
        await db.gm_game_pins.insert_one({
            "id": uuid.uuid4().hex, "game_id": game_id, "title": g.get("title"),
            "game_status": g.get("status"), "runtime_key": key, "runtime_version": 1,
            "engine_key": RUNTIME_ENGINE[key], "engine_version": 1,
            "spec_schema": f"spec_{key}@1", "save_schema": "save_game_progress@1",
            "resource_manifest": "resource_manifest_engagement@1",
            "run_id": None, "active": True, "source": source, "mapping_reason": why,
            "pinned_at": _iso(), "pinned_by": actor})
    except Exception as e:  # noqa: BLE001 — pinning must never break game creation
        log.warning(f"[registry] pin_game({game_id}) failed non-fatally: {e}")


async def games_for_version(runtime_key: str, version: int) -> list:
    return await db.gm_game_pins.find({"runtime_key": runtime_key, "runtime_version": version,
                                       "active": True}, {"_id": 0}).sort("pinned_at", -1).to_list(300)


# ─── Compatibility report ─────────────────────────────────────────────────

async def compat_report(family: str, key: str, v_from: int, v_to: int) -> dict:
    a = await db.gm_registry_versions.find_one({"family": family, "key": key, "version": v_from}, {"_id": 0})
    b = await db.gm_registry_versions.find_one({"family": family, "key": key, "version": v_to}, {"_id": 0})
    if not a or not b:
        raise ValueError("Version not found")
    da, dbf = a["definition"], b["definition"]
    diff = {}
    for f in set(list(da.keys()) + list(dbf.keys())):
        if da.get(f) != dbf.get(f):
            if f == "capabilities":
                ca, cb = da.get(f) or {}, dbf.get(f) or {}
                diff["capabilities_added"] = sorted(k for k in cb if cb.get(k) and not ca.get(k))
                diff["capabilities_removed"] = sorted(k for k in ca if ca.get(k) and not cb.get(k))
            else:
                diff[f] = {"from": da.get(f), "to": dbf.get(f)}
    affected = await games_for_version(key, v_from) if family == "runtime" else []
    removed = diff.get("capabilities_removed") or []
    return {"key": key, "from": {"version": v_from, "status": a["status"]},
            "to": {"version": v_to, "status": b["status"]}, "diff": diff,
            "affected_games_on_from": [{"game_id": g["game_id"], "title": g["title"],
                                        "status": g["game_status"]} for g in affected],
            "risk": ("HIGH — capabilities removed; migrating games may lose mechanics" if removed
                     else "LOW — additive/no capability changes"),
            "note": "Phase 2 never migrates games between versions — this report is preview-only."}


# ─── Contract test (runs inside a persistent job; mocked, no providers) ──

async def run_contract_checks(key: str, version: int) -> dict:
    ver = await db.gm_registry_versions.find_one({"family": "runtime", "key": key, "version": version}, {"_id": 0})
    if not ver:
        raise ValueError("Version not found")
    d = ver["definition"]
    checks = []

    def add(name, passed, detail):
        checks.append({"check": name, "passed": bool(passed), "detail": detail})

    ek, ev = d.get("engine_key"), d.get("engine_version")
    eng = await db.gm_registry_versions.find_one(
        {"family": "engine", "key": ek, "version": ev, "status": {"$nin": ["disabled"]}}, {"_id": 0, "status": 1})
    add("engine_binding", bool(eng), f"{ek}@v{ev} " + (f"({eng['status']})" if eng else "NOT FOUND / disabled"))

    implemented = key in RUNTIME_MECHANICS and key not in PLANNED_RUNTIMES
    add("impl_exists", implemented,
        "implementation present in engine" if implemented else "NO implementation — planned only")

    allowed = RUNTIME_MECHANICS.get(key, set())
    lies = sorted(c for c, v in (d.get("capabilities") or {}).items() if v and c not in allowed)
    add("capability_truthfulness", not lies,
        "all declared capabilities are genuinely implemented" if not lies
        else f"UNTRUTHFUL: {', '.join(lies)} declared true but not implemented")

    missing_schemas = []
    for field in ("spec_schema", "save_schema", "resource_manifest"):
        ref = d.get(field) or ""
        if "@" in ref:
            sk, sv = ref.split("@", 1)
            found = await db.gm_registry_versions.find_one(
                {"family": "schema", "key": sk, "version": int(sv)}, {"_id": 1})
            if not found:
                missing_schemas.append(ref)
        else:
            missing_schemas.append(f"{field} unset")
    add("schemas_pinned", not missing_schemas,
        "spec/save/resource schemas all registered" if not missing_schemas
        else f"missing: {', '.join(missing_schemas)}")

    ctl = d.get("controls") or {}
    add("controls_declared", isinstance(ctl.get("keyboard"), bool) and isinstance(ctl.get("touch"), bool),
        f"keyboard={ctl.get('keyboard')} touch={ctl.get('touch')} gamepad={ctl.get('gamepad')}")

    ref_game = await db.games.find_one(
        {"$or": [{"spec.runtime": key}, {"spec.runtime_id": "runtime_dragon_realm_rpg_v1"} if key == "dragon_realm_rpg" else {"_id": None}],
         "status": {"$in": ["published", "approved"]}}, {"_id": 0, "id": 1, "title": 1})
    add("reference_spec", bool(ref_game) or not implemented,
        f"reference game: {ref_game['title']}" if ref_game
        else ("no published/approved reference game yet" if implemented else "n/a for planned runtime"))

    passed = all(c["passed"] for c in checks)
    return {"passed": passed, "checks": checks, "at": _iso()}
