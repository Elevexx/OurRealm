"""Unified, resumable build pipeline + Universal blueprint section editor.

Pipeline: Blueprint → Asset Resolution → Content Generation → Runtime
Assembly → Validation → Founder Preview → Publish. Stage checkpoints are
persisted on the blueprint doc so every stage is resumable after
interruption. Duplicate builds are refused.

Editor: patch ONE blueprint section without regenerating the game —
versioned edit history, rollback-safe."""
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from core.db import db
from services.chat_conversations import call_openai_chat
from services.llm_router import tier
from services import game_build_engine as gbe
from services import game_blueprints as gb

log = logging.getLogger("ourrealm.game_platform.pipeline")

PIPELINE_STAGES = [
    ("blueprint", "Blueprint"),
    ("asset_resolution", "Asset Resolution"),
    ("content_generation", "Content Generation"),
    ("runtime_assembly", "Runtime Assembly"),
    ("validation", "Validation"),
    ("founder_preview", "Founder Preview"),
    ("publish", "Publish"),
]


def _iso():
    return datetime.now(timezone.utc).isoformat()


def new_pipeline() -> dict:
    return {"stages": [{"id": i, "label": l, "status": "pending", "checkpoint": None, "at": None}
                       for i, l in PIPELINE_STAGES],
            "status": "pending", "resumable": True, "updated_at": _iso()}


async def mark_stage(bp_id: str, stage_id: str, status: str, checkpoint=None):
    await db.game_blueprints.update_one(
        {"id": bp_id, "pipeline.stages.id": stage_id},
        {"$set": {"pipeline.stages.$.status": status,
                  "pipeline.stages.$.checkpoint": checkpoint,
                  "pipeline.stages.$.at": _iso(),
                  "pipeline.updated_at": _iso()}})


async def pipeline_state(bp: dict) -> dict:
    """Stage statuses are DERIVED from ground truth (blueprint + linked
    game) so state is always accurate after any interruption."""
    game = await db.games.find_one(
        {"blueprint_id": bp["id"]},
        {"_id": 0, "id": 1, "status": 1, "stage": 1, "updated_at": 1},
        sort=[("created_at", -1)])
    gs = (game or {}).get("status")
    reqs = bp.get("asset_requirements") or []
    unresolved = [r for r in reqs if r.get("required") and r.get("generation_required")
                  and (r.get("founder_decision") or "pending") == "pending"]
    statuses = {
        "blueprint": "done",
        "asset_resolution": "done" if (game or not unresolved) else "pending",
        "content_generation": "done" if gs in ("pending_approval", "approved", "published", "complete")
        else ("running" if gs == "building" else "pending"),
        "runtime_assembly": "done" if gs in ("pending_approval", "approved", "published", "complete")
        else ("running" if gs == "building" else "pending"),
        "validation": "done" if gs in ("pending_approval", "approved", "published", "complete")
        else ("running" if gs == "building" else "pending"),
        "founder_preview": "done" if gs in ("approved", "published") else "pending",
        "publish": "done" if gs == "published" else "pending",
    }
    if gs == "failed":
        statuses["content_generation"] = "failed"
    stages = [{"id": i, "label": l, "status": statuses[i]} for i, l in PIPELINE_STAGES]
    nxt = next((s for s in stages if s["status"] in ("pending", "failed")), None)
    stale = False
    if gs == "building" and game.get("updated_at"):
        from datetime import datetime as _dt
        try:
            age = (_dt.now(timezone.utc) - _dt.fromisoformat(game["updated_at"])).total_seconds()
            stale = age > 600
        except Exception:  # noqa: BLE001
            pass
    return {"stages": stages, "linked_game": game, "next_stage": nxt,
            "completed": sum(1 for s in stages if s["status"] == "done"),
            "total": len(stages), "stale_build": stale,
            "resume_available": bool(nxt) or stale}


async def start_or_resume_build(bp: dict, current: dict) -> dict:
    """Duplicate-proof: one live build per blueprint. A stale interrupted
    build (>10 min without progress) is failed with a root cause and the
    pipeline resumes with a fresh run."""
    running = await db.games.find_one(
        {"blueprint_id": bp["id"], "status": {"$in": ["building", "queued"]}},
        {"_id": 0, "id": 1, "status": 1, "updated_at": 1})
    if running:
        stale = False
        try:
            from datetime import datetime as _dt
            age = (_dt.now(timezone.utc) - _dt.fromisoformat(running["updated_at"])).total_seconds()
            stale = age > 600
        except Exception:  # noqa: BLE001
            pass
        if not stale:
            raise HTTPException(status_code=409,
                                detail=f"A build for this blueprint is already {running['status']} "
                                       f"(game {running['id']}) — duplicate builds are refused")
        await db.games.update_one({"id": running["id"]}, {"$set": {
            "status": "failed", "updated_at": _iso(),
            "failure": {"root_cause": "build interrupted (no progress for 10+ minutes — "
                                      "likely a restart/deploy killed the task)",
                        "recommendation": "resumed automatically with a fresh build run",
                        "recovered": True}}})
        log.warning("pipeline: stale build %s failed + resumed for bp %s", running["id"], bp["id"])
    result = await gbe.start_blueprint_build(bp, current)
    if not result.get("started"):
        raise HTTPException(status_code=422, detail={
            "root_cause": "pre-build validation failed",
            "validation": result.get("validation"),
            "recommendation": "resolve the blocking items, then build again"})
    return result


# ── Universal Editor ─────────────────────────────────────────────────
EDIT_SECTIONS = {
    "mechanics": "blueprint.gameplay.player_mechanics",
    "levels": "blueprint.gameplay.levels",
    "enemies": "blueprint.gameplay.enemies",
    "bosses": "blueprint.gameplay.bosses",
    "maps": "blueprint.gameplay.maps",
    "dialogue": "blueprint.gameplay.npcs",
    "quests": "blueprint.gameplay.quests",
    "rewards": "blueprint.systems.fire_power_integrations",
    "assets": "asset_requirements",
    "lighting": "blueprint.media.artwork",
    "audio": "blueprint.media.sound_effects",
    "ai": "blueprint.gameplay.enemies",
    "ui": "blueprint.systems.ui_hud",
    "progression": "blueprint.gameplay.progression",
    "creatures": "blueprint.gameplay.enemies",
    "npcs": "blueprint.gameplay.npcs",
    "battles": "blueprint.gameplay.bosses",
    "regions": "blueprint.gameplay.worlds",
    "evolution_rules": "blueprint.extensions.evolution",
    "parties": "blueprint.extensions.parties",
    "ai_profiles": "blueprint.extensions.battle_ai",
    "multiplayer_rules": "blueprint.extensions.multiplayer",
    "trades": "blueprint.extensions.trading",
    "procedural_settings": "blueprint.extensions.procedural_regions",
    "recipes": "blueprint.extensions.crafting",
    "items": "blueprint.extensions.items",
    "difficulty": "blueprint.extensions.difficulty",
    "accessibility": "blueprint.media.accessibility",
    "fire_power": "blueprint.systems.fire_power_integrations",
}

EDIT_SYSTEM = """You are ORAi's game blueprint editor. You receive ONE section of a game
blueprint and an instruction. Edit ONLY this section per the instruction — keep everything
that still fits, change only what the instruction asks. Reply ONLY valid JSON:
{"value": <the new section value, SAME TYPE as the input (list stays list, string stays string)>,
 "summary": "1 sentence describing the change"}
No prose outside JSON."""


def _get_path(doc: dict, path: str):
    cur = doc
    for p in path.split("."):
        cur = (cur or {}).get(p)
    return cur


def _set_path(doc: dict, path: str, value):
    parts = path.split(".")
    cur = doc
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
    cur[parts[-1]] = value


async def edit_section(bp: dict, section: str, instruction: str, current: dict) -> dict:
    if section not in EDIT_SECTIONS:
        raise HTTPException(status_code=400,
                            detail=f"Unknown section — pick one of: {', '.join(EDIT_SECTIONS)}")
    path = EDIT_SECTIONS[section]
    before = _get_path(bp, path)
    t = tier(min(int(bp.get("ai_power") or 3), 5))
    res = await call_openai_chat(
        [{"role": "system", "content": EDIT_SYSTEM},
         {"role": "user", "content": f"SECTION '{section}' current value:\n"
                                     f"{json.dumps(before, default=str)[:4000]}\n\n"
                                     f"GAME: {bp.get('name')}\nINSTRUCTION: {instruction[:800]}"}],
        model=t["model"], max_tokens=3000, json_mode=True)
    try:
        out = json.loads(res.get("content") or "{}")
        new_value = out["value"]
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Edit failed — the editor returned an "
                                                    "unusable patch. Nothing was changed.")
    if isinstance(before, list) and not isinstance(new_value, list):
        raise HTTPException(status_code=502, detail="Edit rejected — section type mismatch. "
                                                    "Nothing was changed.")
    edit_id = uuid.uuid4().hex
    _set_path(bp, path, new_value)
    bp["version"] = (bp.get("version") or 1) + 1
    bp["updated_at"] = _iso()
    bp["validation"] = gb.validate_blueprint(bp)
    entry = {"edit_id": edit_id, "section": section, "path": path,
             "instruction": instruction[:400], "before": before,
             "summary": str(out.get("summary") or "")[:200],
             "actor": current.get("username"), "at": _iso(), "version": bp["version"]}
    await db.game_blueprints.update_one(
        {"id": bp["id"]},
        {"$set": {path: new_value, "version": bp["version"], "updated_at": bp["updated_at"],
                  "validation": bp["validation"]},
         "$push": {"edit_history": {"$each": [entry], "$slice": -30}}})
    return {"edit_id": edit_id, "section": section, "summary": entry["summary"],
            "version": bp["version"], "validation": bp["validation"], "value": new_value}


async def rollback_edit(bp: dict, edit_id: str, current: dict) -> dict:
    entry = next((e for e in (bp.get("edit_history") or []) if e.get("edit_id") == edit_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Edit not found in history")
    _set_path(bp, entry["path"], entry["before"])
    bp["version"] = (bp.get("version") or 1) + 1
    await db.game_blueprints.update_one(
        {"id": bp["id"]},
        {"$set": {entry["path"]: entry["before"], "version": bp["version"],
                  "updated_at": _iso()},
         "$push": {"edit_history": {"$each": [{
             "edit_id": uuid.uuid4().hex, "section": entry["section"], "path": entry["path"],
             "instruction": f"rollback of edit {edit_id[:8]}", "before": None,
             "summary": f"rolled back '{entry['section']}' to pre-edit value",
             "actor": current.get("username"), "at": _iso(), "version": bp["version"]}],
             "$slice": -30}}})
    return {"rolled_back": edit_id, "section": entry["section"], "version": bp["version"]}
