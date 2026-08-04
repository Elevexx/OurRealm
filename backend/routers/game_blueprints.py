"""AAA Game Blueprint routes — planning, runtime selection, asset matching
and founder approval. Approval NEVER starts a build or generates media."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import asset_library, game_blueprints as gb
from services.game_studio import RUNTIMES, RUNTIME_LABELS
from services.orai_projects import audit
from utils.sliding_window_rate_limit import rate_limit

log = logging.getLogger("ourrealm.game_blueprints.api")
router = APIRouter(prefix="/api/orai/projects/blueprints", tags=["game-blueprints"])

DECISIONS = {"use_suggested", "search_library", "upload_replacement", "generate_later", "skip_optional"}


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _pub(d: dict) -> dict:
    d = dict(d)
    d.pop("_id", None)
    return d


async def _own(bid: str, current: dict) -> dict:
    d = await db.game_blueprints.find_one({"id": bid, "creator_id": current["id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    return d


# ── Library endpoints (declared before /{bid}) ───────────────────────
@router.get("/library/search")
async def library_search(current: CurrentUser, q: str = "", category: str = None,
                         runtime: str = None, limit: int = 20, tags: str = "",
                         favorites: bool = False, sort: str = "updated"):
    require_founder(current)
    rows = await asset_library.search_assets(
        current["id"], q=q, category=category, runtime=runtime, limit=limit,
        tags=[t for t in tags.split(",") if t.strip()] if tags else None,
        favorites_only=favorites, sort=sort)
    return {"assets": rows, "categories": asset_library.ASSET_CATEGORIES}


@router.get("/library/recent")
async def library_recent(current: CurrentUser, limit: int = 12):
    require_founder(current)
    return {"assets": await asset_library.recent_assets(current["id"], limit)}


@router.get("/library/duplicates")
async def library_duplicates(current: CurrentUser):
    require_founder(current)
    return {"duplicate_groups": await asset_library.find_duplicates(current["id"])}


@router.post("/library/{asset_id}/favorite")
async def library_favorite(asset_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    ok = await asset_library.set_favorite(asset_id, current["id"], bool(body.get("favorite", True)))
    if not ok:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"ok": True, "favorite": bool(body.get("favorite", True))}


@router.post("/library/{asset_id}/sprite-slice")
async def sprite_slice(asset_id: str, body: dict, current: CurrentUser):
    """Sprite Sheet Studio — slice an existing sheet into an animation
    manifest. Operates on library assets only; never generates images."""
    require_founder(current)
    from services import sprite_studio
    try:
        res = await sprite_studio.slice_asset(asset_id, current["id"], body or {})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await audit(current, "sprite_sheet_sliced", asset_id,
                f"states={list(res['manifest']['animations'])}")
    return res


@router.get("/library/sprite-states")
async def sprite_states(current: CurrentUser):
    require_founder(current)
    from services.sprite_studio import ANIMATION_STATES
    return {"states": ANIMATION_STATES}


@router.get("/diagnostics/health")
async def routing_health(current: CurrentUser, limit: int = 20):
    """Founder routing-health panel — providers, models, durations,
    fallback + validation status. No secrets."""
    require_founder(current)
    rows = await db.orai_routing_events.find(
        {}, {"_id": 0}).sort("at", -1).to_list(max(1, min(int(limit), 50)))
    total = len(rows)
    fallbacks = sum(1 for r in rows if r.get("fallback_used"))
    return {"events": rows, "summary": {
        "recent_events": total, "fallback_events": fallbacks,
        "direct_openai_pct": round(100 * (total - fallbacks) / total, 1) if total else None,
        "avg_planning_ms": round(sum(r.get("duration_ms") or 0 for r in rows) / total) if total else None}}


@router.post("/library/backfill")
async def library_backfill(current: CurrentUser):
    """Index existing orai_assets into the universal library (idempotent,
    references the same storage — no file duplication)."""
    require_founder(current)
    res = await asset_library.backfill_from_orai_assets(current)
    return res


# ── Planning ─────────────────────────────────────────────────────────
@router.post("/plan")
async def plan(body: dict, current: CurrentUser):
    require_founder(current)
    rl = await rate_limit(f"bp-plan:{current['id']}", max_requests=30, window_seconds=3600)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail="Too many planning requests — try later")
    if not str(body.get("request") or "").strip():
        raise HTTPException(status_code=400, detail="Describe the game to plan")
    doc = await gb.plan_blueprint(body, current)
    await db.game_blueprints.insert_one({**doc})
    await audit(current, "blueprint_planned", doc["id"],
                f"{doc['name']} · runtime={doc['selected_runtime']} · {doc['validation']['status']}")
    return {"blueprint": _pub(doc)}


@router.get("")
async def list_blueprints(current: CurrentUser):
    require_founder(current)
    rows = await db.game_blueprints.find(
        {"creator_id": current["id"], "status": {"$ne": "canceled"}},
        {"_id": 0, "id": 1, "name": 1, "version": 1, "selected_runtime": 1,
         "selected_runtime_label": 1, "approval_status": 1, "status": 1,
         "complexity": 1, "updated_at": 1}).sort("updated_at", -1).to_list(40)
    return {"blueprints": rows}


@router.get("/{bid}")
async def get_blueprint(bid: str, current: CurrentUser):
    require_founder(current)
    return {"blueprint": _pub(await _own(bid, current))}


@router.post("/{bid}/revise")
async def revise(bid: str, body: dict, current: CurrentUser):
    require_founder(current)
    rl = await rate_limit(f"bp-plan:{current['id']}", max_requests=30, window_seconds=3600)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail="Too many planning requests — try later")
    doc = await _own(bid, current)
    if doc["status"] not in ("draft",):
        raise HTTPException(status_code=400, detail="Only draft blueprints can be revised")
    updated = await gb.plan_blueprint(body, current, existing=doc,
                                      feedback=str(body.get("feedback") or ""))
    await db.game_blueprints.replace_one({"id": bid}, {**updated})
    await audit(current, "blueprint_revised", bid, f"v{updated['version']}")
    return {"blueprint": _pub(updated)}


@router.post("/{bid}/runtime")
async def set_runtime(bid: str, body: dict, current: CurrentUser):
    require_founder(current)
    new_rt = str(body.get("runtime") or "")
    if new_rt not in RUNTIMES:
        raise HTTPException(status_code=400, detail="Unknown runtime family")
    doc = await _own(bid, current)
    if doc["status"] != "draft":
        raise HTTPException(status_code=400, detail="Runtime can only change before approval")
    doc = gb.change_runtime(_pub(doc), new_rt)
    doc["asset_requirements"], searched = await gb.match_requirements(
        current["id"], doc["asset_requirements"])
    doc["diagnostics"]["library_searches"] = searched
    doc["diagnostics"]["existing_matches"] = sum(
        1 for r in doc["asset_requirements"] if r["existing_match_found"])
    doc["diagnostics"]["missing_assets"] = sum(
        1 for r in doc["asset_requirements"] if r["generation_required"])
    doc["validation"] = gb.validate_blueprint(doc)
    doc["diagnostics"]["schema_validation_status"] = doc["validation"]["status"]
    await db.game_blueprints.replace_one({"id": bid}, {**doc})
    await audit(current, "blueprint_runtime_changed", bid, RUNTIME_LABELS[new_rt])
    return {"blueprint": _pub(doc)}


@router.post("/{bid}/assets/{req_id}/decision")
async def asset_decision(bid: str, req_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    decision = str(body.get("decision") or "")
    if decision not in DECISIONS:
        raise HTTPException(status_code=400, detail="Invalid decision")
    doc = await _own(bid, current)
    req = next((r for r in doc["asset_requirements"] if r["req_id"] == req_id), None)
    if not req:
        raise HTTPException(status_code=404, detail="Asset requirement not found")
    if decision == "skip_optional" and req.get("required"):
        raise HTTPException(status_code=400, detail="Cannot skip a required asset")
    chosen = None
    if decision == "use_suggested":
        chosen = body.get("asset_id") or (req["best_matches"][0]["asset_id"] if req["best_matches"] else None)
        if not chosen:
            raise HTTPException(status_code=400, detail="No suggested asset available")
        await asset_library.touch_usage(chosen)
    req["founder_decision"] = decision
    req["chosen_asset_id"] = chosen
    req["generation_required"] = decision == "generate_later"
    await db.game_blueprints.update_one(
        {"id": bid, "asset_requirements.req_id": req_id},
        {"$set": {"asset_requirements.$": req, "updated_at": _iso()}})
    return {"requirement": req}


@router.post("/{bid}/approve")
async def approve(bid: str, current: CurrentUser):
    """Approval gate ONLY — never starts a build or generates media."""
    require_founder(current)
    doc = await _own(bid, current)
    if doc["validation"]["status"] == "invalid":
        raise HTTPException(status_code=400,
                            detail="Blueprint has blocking validation errors: " +
                                   "; ".join(doc["validation"]["blocking"]))
    await db.game_blueprints.update_one({"id": bid}, {"$set": {
        "approval_status": "approved", "status": "approved_pending_build",
        "approved_at": _iso(), "updated_at": _iso()}})
    await audit(current, "blueprint_approved", bid,
                "approved — build NOT started (next phase)")
    fresh = await db.game_blueprints.find_one({"id": bid}, {"_id": 0})
    return {"blueprint": fresh, "build_started": False,
            "note": "Blueprint approved. Building is a separate future phase — nothing was generated."}


@router.post("/{bid}/duplicate")
async def duplicate(bid: str, current: CurrentUser):
    """Blueprint reusability — clone as a fresh draft."""
    require_founder(current)
    doc = _pub(await _own(bid, current))
    import uuid as _uuid
    doc["id"] = _uuid.uuid4().hex
    doc["name"] = f"{doc['name']} (copy)"[:120]
    doc["version"] = 1
    doc["status"] = "draft"
    doc["approval_status"] = "pending_founder_approval"
    doc.pop("approved_at", None)
    doc["created_at"] = _iso()
    doc["updated_at"] = _iso()
    await db.game_blueprints.insert_one({**doc})
    await audit(current, "blueprint_duplicated", doc["id"], f"from {bid}")
    return {"blueprint": _pub(doc)}


@router.post("/{bid}/media-package")
async def media_package(bid: str, current: CurrentUser):
    """AAA media package PLAN — lists every launch asset. Generates nothing."""
    require_founder(current)
    doc = await _own(bid, current)
    pkg = gb.build_media_package(_pub(doc))
    await db.game_blueprints.update_one({"id": bid}, {"$set": {
        "media_package": pkg, "updated_at": _iso()}})
    await audit(current, "media_package_planned", bid, f"{len(pkg['items'])} items — nothing generated")
    return {"media_package": pkg, "media_generated": False}


@router.get("/{bid}/build/review")
async def build_review(bid: str, current: CurrentUser):
    """Founder Build Review — validation + estimates. Never builds."""
    require_founder(current)
    from services import game_build_engine as be
    doc = _pub(await _own(bid, current))
    return {"review": await be.build_review(doc, current["id"])}


@router.post("/{bid}/build/approve")
async def build_approve(bid: str, current: CurrentUser):
    """Explicit founder build approval — the ONLY way a build starts."""
    require_founder(current)
    rl = await rate_limit(f"bp-build:{current['id']}", max_requests=10, window_seconds=3600)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail="Too many build approvals — try later")
    from services import game_build_engine as be
    doc = _pub(await _own(bid, current))
    if doc.get("status") == "building":
        return {"started": True, "game_id": doc.get("game_id"), "already_building": True}
    res = await be.start_blueprint_build(doc, current)
    if not res["started"]:
        raise HTTPException(status_code=400, detail={
            "message": "Build validation failed — build NOT started",
            "validation": res["validation"]})
    return res


@router.get("/{bid}/build/status")
async def build_status(bid: str, current: CurrentUser):
    require_founder(current)
    doc = await _own(bid, current)
    game = None
    if doc.get("game_id"):
        game = await db.games.find_one({"id": doc["game_id"]},
                                       {"_id": 0, "id": 1, "title": 1, "status": 1, "stage": 1,
                                        "build_log": 1, "actual_cost": 1, "runtime": 1,
                                        "test_results": 1, "scene_graph": 1})
    return {"blueprint_status": doc.get("status"), "game": game}


@router.post("/{bid}/cancel")
async def cancel(bid: str, current: CurrentUser):
    require_founder(current)
    await _own(bid, current)
    await db.game_blueprints.update_one({"id": bid}, {"$set": {
        "status": "canceled", "approval_status": "canceled", "updated_at": _iso()}})
    return {"ok": True}
