"""ORAi Game Platform routes — /api/orai/platform/*.
Registry management (versioned, rollback-safe), capability-driven runtime
recommendation, multi-stage planning, grouped validation, universal
blueprint editor, resumable build pipeline, provider status. Founder-only."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services.orai_projects import audit
from services.game_platform.registry_core import Registry
from services.game_platform.runtime_registry import (
    runtime_registry, renderer_registry, template_registry, recommend_capability_runtime)
from services.game_platform.system_registry import (
    system_registry, economy_registry, fire_hook_registry, plugin_registry)
from services.game_platform.validation_registry import validation_registry, run_validation
from services.game_platform.capability_registry import capability_registry, capability_status
from services.game_platform.asset_animation_foundation import (
    asset_role_registry, animation_state_registry, asset_profile)
from services.game_platform import planner, pipeline, diagnostics
from services.game_platform.creature_ext import (
    creature_ext_registry, apply_evolution, session_action, trade_action,
    generate_region, craft, battle_decide, claim_creature_reward)
from utils.sliding_window_rate_limit import rate_limit

log = logging.getLogger("ourrealm.game_platform.api")
router = APIRouter(prefix="/api/orai/platform", tags=["game-platform"])

REGISTRIES: dict[str, Registry] = {
    "runtimes": runtime_registry, "renderers": renderer_registry,
    "templates": template_registry, "gameplay_systems": system_registry,
    "economy": economy_registry, "fire_hooks": fire_hook_registry,
    "ai_capabilities": capability_registry, "validators": validation_registry,
    "plugins": plugin_registry, "creature_rpg_extensions": creature_ext_registry,
    "asset_roles": asset_role_registry, "animation_states": animation_state_registry,
}


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _pub(d: dict) -> dict:
    d = dict(d)
    d.pop("_id", None)
    return d


def _reg(name: str) -> Registry:
    r = REGISTRIES.get(name)
    if not r:
        raise HTTPException(status_code=404,
                            detail=f"Unknown registry — one of: {', '.join(REGISTRIES)}, assets, projects")
    return r


@router.get("/registries")
async def registries_overview(current: CurrentUser):
    require_founder(current)
    out = []
    for name, reg in REGISTRIES.items():
        entries = await reg.all()
        out.append({"registry": name, "description": reg.description,
                    "entries": len(entries),
                    "db_overrides": sum(1 for e in entries.values() if e["source"] == "db")})
    out.append({"registry": "assets", "description": "Universal asset library (orai_asset_library)",
                "entries": await db.orai_asset_library.count_documents({})})
    out.append({"registry": "projects",
                "description": "Project registry (blueprints + games + orai projects)",
                "entries": await db.game_blueprints.count_documents({})
                + await db.games.count_documents({})})
    return {"registries": out}


@router.get("/registries/{name}")
async def registry_entries(name: str, current: CurrentUser):
    require_founder(current)
    return {"registry": name, "entries": await _reg(name).all()}


@router.post("/registries/{name}/{key}")
async def registry_upsert(name: str, key: str, body: dict, current: CurrentUser):
    require_founder(current)
    definition = body.get("definition")
    if not isinstance(definition, dict) or not definition:
        raise HTTPException(status_code=400, detail="Provide a non-empty definition object")
    res = await _reg(name).upsert(key, definition, current, reason=str(body.get("reason") or ""))
    await audit(current, "platform_registry_upsert", key, f"{name}/{key} v{res['version']}")
    return res


@router.post("/registries/{name}/{key}/rollback")
async def registry_rollback(name: str, key: str, body: dict, current: CurrentUser):
    require_founder(current)
    try:
        res = await _reg(name).rollback(key, int(body.get("version") or 0), current)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await audit(current, "platform_registry_rollback", key, f"{name}/{key} → v{body.get('version')}")
    return res


@router.post("/registries/{name}/{key}/enabled")
async def registry_enable(name: str, key: str, body: dict, current: CurrentUser):
    require_founder(current)
    try:
        return await _reg(name).set_enabled(key, bool(body.get("enabled", True)), current)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/runtimes")
async def runtime_catalog(current: CurrentUser):
    require_founder(current)
    fams = await runtime_registry.all()
    out = [{"family_id": k, **e["definition"], "version": e["version"], "enabled": e["enabled"]}
           for k, e in sorted(fams.items())]
    return {"families": out,
            "counts": {m: sum(1 for f in out if f["maturity"] == m)
                       for m in ("generatable", "partial", "foundation")}}


@router.get("/asset-profile/{family}")
async def family_asset_profile(family: str, current: CurrentUser):
    require_founder(current)
    return await asset_profile(family)


@router.post("/recommend")
async def recommend(body: dict, current: CurrentUser):
    require_founder(current)
    text = str(body.get("request") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Describe the game")
    return await recommend_capability_runtime(
        text, {"genres": body.get("genres") or [], "mechanics": body.get("mechanics") or [],
               "multiplayer": bool(body.get("multiplayer"))})


@router.post("/plan")
async def platform_plan(body: dict, current: CurrentUser):
    """Multi-stage capability-driven planning — planning ONLY."""
    require_founder(current)
    rl = await rate_limit(f"platform-plan:{current['id']}", max_requests=30, window_seconds=3600)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail="Too many planning requests — try later")
    if not str(body.get("request") or "").strip():
        raise HTTPException(status_code=400, detail="Describe the game to plan")
    doc = await planner.plan_project(body, current)
    if doc.get("blocked"):
        return {"blocked": True, "planning_stages": doc["planning_stages"],
                "capability_recommendation": doc["capability_recommendation"],
                "recommendations": doc["recommendations"]}
    doc["pipeline"] = pipeline.new_pipeline()
    doc["pipeline"]["stages"][0].update({"status": "done", "at": _iso()})
    await db.game_blueprints.insert_one({**doc})
    await audit(current, "platform_plan", doc["id"],
                f"{doc['name']} · family={doc['platform']['runtime_family']} · "
                f"{doc['platform']['grouped_validation']['overall']}")
    return {"blueprint": _pub(doc)}


@router.get("/providers")
async def providers(current: CurrentUser):
    require_founder(current)
    return {"capabilities": await capability_status()}


@router.get("/systems")
async def systems(current: CurrentUser):
    require_founder(current)
    return {"systems": await system_registry.all()}


@router.get("/economy")
async def economy(current: CurrentUser):
    require_founder(current)
    return {"modules": await economy_registry.all(),
            "fire_hooks": await fire_hook_registry.all(),
            "note": "Reward tables are registry data — edit via POST /registries/economy/{key}"}


async def _own_bp(bid: str, current: dict) -> dict:
    d = await db.game_blueprints.find_one({"id": bid, "creator_id": current["id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    return d


@router.post("/blueprints/{bid}/validate")
async def validate_grouped(bid: str, current: CurrentUser):
    require_founder(current)
    bp = await _own_bp(bid, current)
    grouped = await run_validation(bp)
    await db.game_blueprints.update_one(
        {"id": bid}, {"$set": {"platform.grouped_validation": grouped, "updated_at": _iso()}})
    return {"validation": grouped}


@router.post("/blueprints/{bid}/edit-section")
async def edit_section(bid: str, body: dict, current: CurrentUser):
    require_founder(current)
    bp = await _own_bp(bid, current)
    instruction = str(body.get("instruction") or "").strip()
    if not instruction:
        raise HTTPException(status_code=400, detail="Describe the change")
    res = await pipeline.edit_section(bp, str(body.get("section") or ""), instruction, current)
    await audit(current, "blueprint_section_edit", bid, f"{res['section']}: {res['summary']}")
    return res


@router.post("/blueprints/{bid}/edit-rollback")
async def edit_rollback(bid: str, body: dict, current: CurrentUser):
    require_founder(current)
    bp = await _own_bp(bid, current)
    res = await pipeline.rollback_edit(bp, str(body.get("edit_id") or ""), current)
    await audit(current, "blueprint_edit_rollback", bid, res["section"])
    return res


@router.get("/blueprints/{bid}/pipeline")
async def bp_pipeline(bid: str, current: CurrentUser):
    require_founder(current)
    bp = await _own_bp(bid, current)
    return await pipeline.pipeline_state(bp)


@router.post("/blueprints/{bid}/build")
async def bp_build(bid: str, current: CurrentUser):
    """Start OR resume the unified pipeline — duplicate builds refused."""
    require_founder(current)
    bp = await _own_bp(bid, current)
    if bp.get("approval_status") != "approved":
        raise HTTPException(status_code=409, detail="Blueprint must be founder-approved first")
    res = await pipeline.start_or_resume_build(bp, current)
    await audit(current, "platform_build_started", bid, bp.get("name") or "")
    return res


@router.get("/projects")
async def project_registry(current: CurrentUser):
    require_founder(current)
    bps = await db.game_blueprints.find(
        {"creator_id": current["id"]},
        {"_id": 0, "id": 1, "name": 1, "status": 1, "approval_status": 1,
         "selected_runtime": 1, "version": 1, "updated_at": 1,
         "platform.runtime_family": 1}).sort("updated_at", -1).to_list(100)
    games = await db.games.find(
        {}, {"_id": 0, "id": 1, "title": 1, "status": 1, "runtime": 1,
             "blueprint_id": 1, "published": 1}).sort("created_at", -1).to_list(100)
    return {"blueprints": bps, "games": games,
            "counts": {"blueprints": len(bps), "games": len(games)}}


# ── Phase 2: diagnostics, founder report, auto-fix, timeline, history ─
@router.get("/blueprints/{bid}/report")
async def founder_build_report(bid: str, current: CurrentUser):
    """Founder Validation Report + live timeline + completion summary.
    JSON is copy/download-ready."""
    require_founder(current)
    bp = await _own_bp(bid, current)
    return {"blueprint_id": bid, "name": bp.get("name"),
            "report": await diagnostics.founder_report(bp),
            "timeline": await diagnostics.build_timeline(bp),
            "summary": await diagnostics.completion_summary(bp),
            "history": await diagnostics.build_history(bp)}


@router.post("/blueprints/{bid}/autofix")
async def blueprint_autofix(bid: str, current: CurrentUser):
    """Deterministic Auto Fix & Retry — safe repairs only, never an LLM."""
    require_founder(current)
    bp = await _own_bp(bid, current)
    res = await diagnostics.auto_fix(bp)
    bp = await _own_bp(bid, current)
    report = await diagnostics.founder_report(bp)
    await audit(current, "blueprint_autofix", bid, f"{res['count']} fix(es)")
    return {**res, "report": report}


# ── Phase 3: Turn-Based Creature RPG V2 extensions ────────────────────
@router.get("/creature/extensions")
async def creature_extensions(current: CurrentUser):
    return {"extensions": await creature_ext_registry.all()}


@router.post("/creature/evolution/apply")
async def creature_evolution(body: dict, current: CurrentUser):
    return await apply_evolution(current, str(body.get("game_id") or "")[:64],
                                 str(body.get("creature") or "")[:80], body.get("context") or {})


@router.post("/creature/sessions/{action}")
async def creature_sessions(action: str, body: dict, current: CurrentUser):
    if action not in ("create", "join", "leave", "reconnect"):
        raise HTTPException(status_code=400, detail="Unknown session action")
    return await session_action(current, action, body)


@router.post("/creature/trades/{action}")
async def creature_trades(action: str, body: dict, current: CurrentUser):
    return await trade_action(current, action, body)


@router.post("/creature/regions/generate")
async def creature_region(body: dict, current: CurrentUser):
    return await generate_region(body)


@router.post("/creature/craft")
async def creature_craft(body: dict, current: CurrentUser):
    return await craft(current, str(body.get("game_id") or "")[:64],
                       str(body.get("recipe_id") or "")[:60])


@router.post("/creature/battle-ai/decide")
async def creature_battle_ai(body: dict, current: CurrentUser):
    return await battle_decide(body)


@router.post("/creature/rewards/claim")
async def creature_reward_claim(body: dict, current: CurrentUser):
    return await claim_creature_reward(current, str(body.get("game_id") or "")[:64],
                                       str(body.get("kind") or ""), body.get("ref"))


# ── Runtime execution contracts + batch diversity gate ────────────────
@router.get("/runtimes/contracts")
async def runtime_contracts(current: CurrentUser):
    """Truth table: which registered runtimes are truly executable."""
    require_founder(current)
    from services.game_studio import RUNTIMES as _RT
    from services.game_platform.execution_contracts import execution_contract
    rows = [execution_contract(rt) for rt in _RT]
    return {"contracts": rows,
            "executable": [r["runtime"] for r in rows if r["status"] == "executable"],
            "registered_not_executable": [r["runtime"] for r in rows
                                          if r["status"] != "executable"]}


@router.post("/batch/diversity")
async def batch_diversity(body: dict, current: CurrentUser):
    """Diversity & quality gate — compare batch versions before publishing."""
    require_founder(current)
    from services.game_platform.execution_contracts import diversity_report
    ids = [str(x)[:64] for x in (body.get("game_ids") or [])]
    if not ids:
        raise HTTPException(status_code=400, detail="Provide game_ids")
    return await diversity_report(ids)
