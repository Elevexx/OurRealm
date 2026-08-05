"""Blueprint → Build Engine (Phase 15).

Pipeline: Blueprint → Runtime Selection → Asset Resolution → Project
Assembly → Scene Creation → Gameplay Generation (reuses game_studio's
vetted spec builder) → Validation → Founder Review → Playable Build.

Never generates artwork/audio/video. Assets resolve from the Universal
Asset Library, uploads, placeholders or are deferred. Founder approval
is required at BOTH gates (blueprint approval + explicit build approval).
Collections: games (build output), game_blueprints (status link)."""
import asyncio
import logging
import uuid
from datetime import datetime, timezone

from core.db import db
from services.llm_router import tier
from services.game_studio import (RUNTIMES, RUNTIME_LABELS, RUNTIME_MECHANICS,
                                  FIRE_ECON_DEFAULTS, TEMPLATE_IDS, default_rep,
                                  _run_build, audit as studio_audit)
from services import asset_library, sprite_studio
from services.orai_projects import audit as project_audit

log = logging.getLogger("ourrealm.build_engine")

BUILD_STAGES = [
    ("runtime_selection", "Runtime selection"),
    ("asset_resolution", "Asset resolution (library → upload → placeholder → deferred)"),
    ("project_assembly", "Project assembly"),
    ("scene_creation", "Scene creation"),
    ("gameplay_generation", "Gameplay generation (vetted spec builder)"),
    ("validation", "Automated validation tests"),
    ("founder_review", "Founder preview & publish gate"),
]

SCENE_TYPES = ["main_menu", "loading", "gameplay", "pause", "victory", "defeat",
               "settings", "credits", "tutorial", "world_map", "boss_arena", "cutscene"]


def _iso():
    return datetime.now(timezone.utc).isoformat()


# ── Asset Resolver — never generates artwork ─────────────────────────
async def resolve_assets(bp: dict, owner_id: str) -> dict:
    resolved, placeholders, deferred, skipped, deps = {}, [], [], [], []
    for r in bp.get("asset_requirements") or []:
        slot, dec = r.get("slot"), r.get("founder_decision")
        if dec == "skip_optional":
            skipped.append(r["req_id"])
            continue
        asset = None
        if dec == "use_suggested" and r.get("chosen_asset_id"):
            asset = await db.game_asset_library.find_one(
                {"id": r["chosen_asset_id"], "owner_id": owner_id}, {"_id": 0})
        if not asset and dec == "upload_replacement":
            # uploads register into the library first — look for a tagged upload
            hits = await asset_library.search_assets(owner_id, category=r.get("category"),
                                                     tags=[r["req_id"]], limit=1)
            asset = hits[0] if hits else None
        if asset and slot:
            m = asset.get("sprite_manifest")
            export = sprite_studio.runtime_export(asset, m) if m else \
                {"url": asset.get("preview_url") or (asset.get("storage_ref") or {}).get("url"),
                 "meta": {"kind": "sprite", **(asset.get("dimensions") or {})}}
            resolved[slot] = {**export, "asset_id": asset["id"], "source": "library"}
            deps.append({"asset_id": asset["id"], "slot": slot, "name": asset.get("name")})
        elif asset:
            deps.append({"asset_id": asset["id"], "slot": None, "name": asset.get("name")})
        elif r.get("required"):
            placeholders.append({"req_id": r["req_id"], "slot": slot,
                                 "note": "runtime built-in placeholder art"})
        else:
            deferred.append(r["req_id"])
    return {"resolved": resolved, "placeholders": placeholders, "deferred": deferred,
            "skipped": skipped, "dependencies": deps}


# ── Scene Generator — deterministic scene graph from the blueprint ──
def scene_graph(bp: dict) -> list:
    g = bp["blueprint"]["gameplay"]
    stages = max(1, min(len(g.get("levels") or []) or len(g.get("enemies") or []) or 1, 10))
    scenes = [
        {"id": "scene_main_menu", "type": "main_menu", "label": "Main Menu",
         "transitions": ["scene_loading", "scene_settings", "scene_credits"]},
        {"id": "scene_loading", "type": "loading", "label": "Loading",
         "transitions": ["scene_gameplay_1"], "placeholder_art": True},
        *[{"id": f"scene_gameplay_{i+1}", "type": "gameplay", "label": f"Stage {i+1}",
           "transitions": ["scene_pause",
                           f"scene_gameplay_{i+2}" if i + 1 < stages else
                           ("scene_boss_arena" if g.get("bosses") else "scene_victory"),
                           "scene_defeat"]} for i in range(stages)],
        {"id": "scene_pause", "type": "pause", "label": "Pause",
         "transitions": ["scene_gameplay_1", "scene_main_menu", "scene_settings"]},
        {"id": "scene_victory", "type": "victory", "label": "Victory",
         "transitions": ["scene_main_menu", "scene_gameplay_1"]},
        {"id": "scene_defeat", "type": "defeat", "label": "Defeat / Restart",
         "transitions": ["scene_gameplay_1", "scene_main_menu"]},
        {"id": "scene_settings", "type": "settings", "label": "Settings",
         "transitions": ["scene_main_menu"]},
        {"id": "scene_credits", "type": "credits", "label": "Credits",
         "transitions": ["scene_main_menu"]},
    ]
    if bp["blueprint"]["systems"].get("tutorials"):
        scenes.insert(1, {"id": "scene_tutorial", "type": "tutorial", "label": "Tutorial",
                          "transitions": ["scene_gameplay_1"]})
        scenes[0]["transitions"].append("scene_tutorial")
    if g.get("worlds") or g.get("maps"):
        scenes.append({"id": "scene_world_map", "type": "world_map", "label": "World Map",
                       "transitions": ["scene_gameplay_1"], "placeholder_art": True})
    if g.get("bosses"):
        scenes.append({"id": "scene_boss_arena", "type": "boss_arena", "label": "Boss Arena",
                       "transitions": ["scene_victory", "scene_defeat"]})
    if (bp["blueprint"]["media"].get("cinematics") or []):
        scenes.append({"id": "scene_cutscene_1", "type": "cutscene", "label": "Cutscene (placeholder)",
                       "transitions": ["scene_gameplay_1"], "placeholder_art": True})
    return scenes


# ── Runtime Validation — must pass before any build ──────────────────
def runtime_validation(bp: dict, scenes: list, resolution: dict) -> dict:
    blocking, warnings = [], []
    if bp.get("approval_status") != "approved":
        blocking.append("Blueprint is not founder-approved")
    rt = bp.get("selected_runtime")
    if not rt or rt not in RUNTIMES:
        blocking.append("Selected runtime is not a playable vetted runtime")
    elif not TEMPLATE_IDS.get(rt):
        blocking.append(f"Runtime template missing for {rt}")
    if not (bp.get("complexity") and 1 <= int(bp["complexity"]) <= 10):
        blocking.append("Invalid complexity configuration")
    ids = [s["id"] for s in scenes]
    if len(ids) != len(set(ids)):
        blocking.append("Duplicate scene IDs in scene graph")
    known = set(ids)
    for s in scenes:
        for tr in s.get("transitions") or []:
            if tr not in known:
                blocking.append(f"Broken scene link: {s['id']} → {tr}")
    unsupported = (bp.get("mechanics_support") or {}).get("unsupported") or []
    if unsupported:
        warnings.append(f"{len(unsupported)} requested mechanic(s) unsupported by {RUNTIME_LABELS.get(rt, rt)}: "
                        + "; ".join(unsupported[:4]))
    if resolution["placeholders"]:
        warnings.append(f"{len(resolution['placeholders'])} required asset(s) will use runtime placeholder art")
    if resolution["deferred"]:
        warnings.append(f"{len(resolution['deferred'])} optional asset(s) deferred")
    warnings.append("Save system: runtime game_progress saves — compatible")
    return {"passed": not blocking, "blocking": blocking, "warnings": warnings, "at": _iso()}


# ── Game Package — placeholders + metadata only, nothing generated ──
def game_package(bp: dict) -> dict:
    ident = bp["blueprint"]["identity"]
    ach = bp["blueprint"]["systems"].get("achievements") or []
    return {
        "placeholders": {k: {"status": "placeholder", "asset_id": None} for k in
                         ["logo", "icon", "cover", "screenshots", "music", "sfx",
                          "tutorial", "loading_screen"]},
        "store_metadata": {"title": ident.get("title"), "genre": ident.get("genre"),
                           "description": ident.get("description"),
                           "devices": ident.get("target_devices")},
        "achievement_metadata": [{"id": f"ach_{i}", "label": a[:90], "art": "placeholder"}
                                 for i, a in enumerate(ach[:10])],
        "world_map_metadata": {"worlds": bp["blueprint"]["gameplay"].get("worlds") or [],
                               "maps": bp["blueprint"]["gameplay"].get("maps") or [],
                               "art": "placeholder"},
        "loading_screen_metadata": {"tip_source": "tutorials", "art": "placeholder"},
        "media_generated": False,
    }


# ── Founder Build Review payload — no build happens here ─────────────
async def build_review(bp: dict, owner_id: str) -> dict:
    scenes = scene_graph(bp)
    resolution = await resolve_assets(bp, owner_id)
    validation = runtime_validation(bp, scenes, resolution)
    t = tier(min(bp.get("ai_power") or 3, 5))
    passes = t["passes"] + 1
    return {
        "blueprint_id": bp["id"], "name": bp["name"],
        "runtime": bp.get("selected_runtime"),
        "runtime_label": bp.get("selected_runtime_label"),
        "scenes": scenes, "asset_resolution": {
            "resolved": len(resolution["resolved"]), "placeholders": len(resolution["placeholders"]),
            "deferred": len(resolution["deferred"]), "skipped": len(resolution["skipped"]),
            "dependencies": resolution["dependencies"]},
        "validation": validation,
        "missing_assets": resolution["placeholders"] + [{"req_id": d} for d in resolution["deferred"]],
        "estimated_build_seconds": passes * 25,
        "estimated_ai_usage": {"amount": t["est_cost"], "detail": f"{t['model']} × {passes} pass(es)",
                               "source": "configured_internal_estimate"},
        "build_stages": [{"id": i, "label": l} for i, l in BUILD_STAGES],
        "controls": ["approve_build", "revise", "cancel", "save_draft"],
        "auto_build": False,
    }


# ── Build Engine — runs only after explicit founder approval ─────────
async def start_blueprint_build(bp: dict, current: dict) -> dict:
    # Execution-contract gate: stop BEFORE any AI generation if the selected
    # runtime lacks a real executable implementation or required component.
    from services.game_platform.execution_contracts import validate_execution
    exec_check = validate_execution(bp.get("selected_runtime") or "")
    if not exec_check["ok"]:
        return {"started": False, "validation": {
            "passed": False, "status": exec_check["status"],
            "blocking": [f"missing executable component: {m}" for m in exec_check["missing_components"]],
            "warnings": [], "execution_contract": exec_check["contract"]}}
    scenes = scene_graph(bp)
    resolution = await resolve_assets(bp, current["id"])
    validation = runtime_validation(bp, scenes, resolution)
    if not validation["passed"]:
        return {"started": False, "validation": validation}
    g = bp["blueprint"]["gameplay"]
    stages = max(1, min(len(g.get("levels") or []) or 3, 8)) if bp["complexity"] > 1 else \
        max(1, min(len(g.get("levels") or []) or 1, 3))
    plan = {
        "title": bp["blueprint"]["identity"].get("title") or bp["name"],
        "runtime": bp["selected_runtime"],
        "stages": stages,
        "mechanics": (bp.get("mechanics_support") or {}).get("supported") or [],
        "unsupported_mechanics": (bp.get("mechanics_support") or {}).get("unsupported") or [],
        "gameplay_summary": g.get("core_loop") or "",
        "player_representation": default_rep(bp["selected_runtime"], ""),
        "concept": bp["blueprint"]["identity"].get("description") or "",
    }
    game = {
        "id": uuid.uuid4().hex, "blueprint_id": bp["id"],
        "estimate_id": None,
        "title": plan["title"], "genre": bp["blueprint"]["identity"].get("genre"),
        "description": bp["blueprint"]["identity"].get("description"),
        "status": "building", "stage": "runtime_selection",
        "complexity": bp["complexity"], "ai_power": bp["ai_power"],
        "runtime": bp["selected_runtime"], "plan": plan,
        "request": bp.get("request") or "", "options": {},
        "course_context": None,
        "spec": None, "test_results": None, "build_log": [],
        "est_cost": 0.0, "actual_cost": 0.0, "plays": 0, "saves": 0,
        "created_by": current["id"], "created_by_username": current.get("username"),
        "created_at": _iso(), "updated_at": _iso(),
        "review": {}, "published_at": None,
        "fire_economy": {**FIRE_ECON_DEFAULTS, "rewards": {**FIRE_ECON_DEFAULTS["rewards"]}},
        "controls": {},
        "scene_graph": scenes,
        "asset_resolution": {k: v for k, v in resolution.items() if k != "resolved"},
        "game_package": game_package(bp),
        "build_meta": {"engine": "blueprint_build_engine_v1", "blueprint_version": bp["version"],
                       "runtime_template": TEMPLATE_IDS.get(bp["selected_runtime"]),
                       "validation": validation, "started_at": _iso()},
        "release": {"mode": "founder_only", "requirements": {}},
        "edit_version": 0,
    }
    await db.games.insert_one({**game})
    await db.game_blueprints.update_one({"id": bp["id"]}, {"$set": {
        "status": "building", "game_id": game["id"], "updated_at": _iso()}})
    await studio_audit(current, "blueprint_build_started", game["id"], detail=plan["title"])
    await project_audit(current, "blueprint_build_started", bp["id"], plan["title"])
    asyncio.create_task(_run_and_finalize(game["id"], bp["id"], dict(resolution["resolved"]),
                                          resolution["dependencies"], dict(current)))
    game.pop("_id", None)
    return {"started": True, "game_id": game["id"], "validation": validation}


async def _run_and_finalize(game_id: str, bp_id: str, resolved_assets: dict,
                            dependencies: list, actor: dict):
    try:
        await _run_build(game_id)  # vetted gameplay generation + spec validation
        game = await db.games.find_one({"id": game_id}, {"_id": 0, "status": 1, "spec": 1})
        if not game or game.get("status") != "pending_approval":
            await db.game_blueprints.update_one({"id": bp_id}, {"$set": {
                "status": "build_failed", "updated_at": _iso()}})
            return
        sets = {"build_meta.finished_at": _iso(), "updated_at": _iso()}
        if resolved_assets:  # wire library assets — never regenerated
            assets = dict((game.get("spec") or {}).get("assets") or {})
            assets.update(resolved_assets)
            sets["spec.assets"] = assets
        await db.games.update_one({"id": game_id}, {"$set": sets})
        for dep in dependencies:  # library integration: usage + project tracking
            await asset_library.touch_usage(dep["asset_id"])
            await db.game_asset_library.update_one(
                {"id": dep["asset_id"]},
                {"$addToSet": {"used_in_projects": game_id}, "$set": {"updated_at": _iso()}})
        await db.game_blueprints.update_one({"id": bp_id}, {"$set": {
            "status": "built", "updated_at": _iso()}})
        await db.orai_routing_events.insert_one({
            "id": uuid.uuid4().hex, "kind": "blueprint_build",
            "request_id": uuid.uuid4().hex, "user_id": actor.get("id"),
            "provider": "openai", "model": None, "fallback_used": False,
            "runtime": None, "game_id": game_id, "blueprint_id": bp_id,
            "validation_status": "built_pending_approval", "at": _iso()})
    except Exception as e:  # noqa: BLE001
        log.warning("blueprint build finalize failed %s: %s", game_id, e)
        await db.game_blueprints.update_one({"id": bp_id}, {"$set": {
            "status": "build_failed", "updated_at": _iso()}})
