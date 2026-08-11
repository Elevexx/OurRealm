"""OurRealm Nexus V1 — Phase 1 routes.
Public world read + real presence multiplayer (server-authoritative, validated,
rate-limited, DB-derived online counts). Founder-only draft editing with
structured ops, versions, publish/rollback, audit, and the ORAi World Architect
structured-proposal workflow (Understand -> Plan -> Diff -> Approve -> Apply)."""
import logging
import math
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import nexus_world as nw

log = logging.getLogger("ourrealm.nexus")
router = APIRouter(prefix="/api/nexus", tags=["nexus"])
_last_presence = {}  # user_id -> monotonic ts (rate limit)


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def _world_doc():
    doc = await db.nexus_worlds.find_one({"world_id": nw.WORLD_ID}, {"_id": 0})
    if not doc:
        w = nw.default_world()
        doc = {"world_id": nw.WORLD_ID, "draft": w, "published": w,
               "draft_version": 1, "published_version": 1, "updated_at": _iso()}
        await db.nexus_worlds.update_one({"world_id": nw.WORLD_ID}, {"$set": doc}, upsert=True)
    return doc


async def _audit(actor, action, detail):
    await db.nexus_audit.insert_one({"id": uuid.uuid4().hex[:12], "actor": actor,
                                     "action": action, "detail": detail, "at": _iso()})


async def _online_count():
    cutoff = time.time() - 12
    return await db.nexus_presence.count_documents({"ts": {"$gt": cutoff}})


@router.get("/world")
async def get_world(current: CurrentUser, draft: int = 0):
    doc = await _world_doc()
    if draft:
        require_founder(current)
        return {"world": doc["draft"], "version": doc["draft_version"], "state": "draft",
                "published_version": doc["published_version"]}
    return {"world": doc["published"], "version": doc["published_version"], "state": "published"}


@router.get("/public")
async def public_info():
    doc = await _world_doc()
    zones = doc["published"]["zones"]
    return {"name": "OurRealm Nexus", "online": await _online_count(),
            "zones": [{"id": z["id"], "name": z["name"]} for z in zones],
            "published_version": doc["published_version"],
            "systems": {"multiplayer": "beta", "world": "live",
                        "orai_architect": "live", "asset_studio": "phase_b_pending",
                        "avatar_studio": "phase_c_pending", "voice": "phase_b_pending"}}


@router.post("/presence")
async def presence(body: dict, current: CurrentUser):
    now = time.time()
    if now - _last_presence.get(current["id"], 0) < 0.12:
        raise HTTPException(status_code=429, detail="Too fast")
    _last_presence[current["id"]] = now
    if len(_last_presence) > 2000:
        stale = [k for k, v in _last_presence.items() if now - v > 60]
        for k in stale:
            _last_presence.pop(k, None)
    doc = await _world_doc()
    zone_id = str(body.get("zone_id") or "plaza")[:24]
    zone = next((z for z in doc["published"]["zones"] if z["id"] == zone_id), None)
    if not zone:
        raise HTTPException(status_code=400, detail="Unknown zone")
    half_w, half_d = zone["size"][0] / 2 + 6, zone["size"][1] / 2 + 6
    try:
        x, y, z = float(body.get("x")), float(body.get("y")), float(body.get("z"))
        ry = float(body.get("ry") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Bad position")
    if not (abs(x) <= half_w and abs(z) <= half_d and -5 <= y <= 60):
        raise HTTPException(status_code=400, detail="Out of bounds")
    prev = await db.nexus_presence.find_one({"user_id": current["id"]}, {"_id": 0})
    if prev and prev.get("zone_id") == zone_id:
        dt = max(0.05, now - prev.get("ts", now))
        if math.hypot(x - prev["x"], z - prev["z"]) > dt * 16 + 3:
            x, z = prev["x"], prev["z"]  # reject teleports: snap back
    anim = str(body.get("anim") or "idle")[:12]
    await db.nexus_presence.update_one({"user_id": current["id"]}, {"$set": {
        "user_id": current["id"], "username": current.get("username"),
        "zone_id": zone_id, "x": round(x, 2), "y": round(y, 2), "z": round(z, 2),
        "ry": round(ry, 2), "anim": anim, "ts": now, "updated_at": _iso()}}, upsert=True)
    cutoff = now - 8
    others = await db.nexus_presence.find(
        {"zone_id": zone_id, "ts": {"$gt": cutoff}, "user_id": {"$ne": current["id"]}},
        {"_id": 0, "user_id": 1, "username": 1, "x": 1, "y": 1, "z": 1, "ry": 1, "anim": 1}
    ).to_list(64)
    return {"players": others, "online": await _online_count(), "self": {"x": x, "z": z}}


@router.post("/presence/leave")
async def presence_leave(current: CurrentUser):
    await db.nexus_presence.delete_one({"user_id": current["id"]})
    return {"ok": True}


@router.get("/position")
async def get_position(current: CurrentUser):
    p = await db.nexus_positions.find_one({"user_id": current["id"]}, {"_id": 0})
    return {"position": p}


@router.post("/position/save")
async def save_position(body: dict, current: CurrentUser):
    try:
        pos = {"zone_id": str(body.get("zone_id") or "plaza")[:24],
               "x": float(body.get("x")), "y": float(body.get("y")), "z": float(body.get("z")),
               "ry": float(body.get("ry") or 0)}
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Bad position")
    await db.nexus_positions.update_one({"user_id": current["id"]}, {"$set": {
        "user_id": current["id"], **pos, "updated_at": _iso()}}, upsert=True)
    return {"ok": True}


# ───────────────────────── founder editing ─────────────────────────
@router.post("/admin/ops")
async def admin_ops(body: dict, current: CurrentUser):
    require_founder(current)
    doc = await _world_doc()
    try:
        new_world, inverse, summary = nw.apply_ops(doc["draft"], body.get("ops") or [])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    ver = doc["draft_version"] + 1
    await db.nexus_worlds.update_one({"world_id": nw.WORLD_ID}, {"$set": {
        "draft": new_world, "draft_version": ver, "updated_at": _iso()}})
    await _audit(current.get("username"), "ops", {"summary": summary, "source": body.get("source") or "manual"})
    return {"ok": True, "draft_version": ver, "inverse_ops": inverse, "summary": summary}


@router.post("/admin/publish")
async def admin_publish(body: dict, current: CurrentUser):
    require_founder(current)
    doc = await _world_doc()
    zones = doc["draft"].get("zones") or []
    if not zones or not all(z.get("spawn") and z.get("entities") is not None for z in zones):
        raise HTTPException(status_code=400, detail="Draft validation failed: zones/spawns missing")
    snap_ver = doc["published_version"]
    await db.nexus_versions.update_one(
        {"world_id": nw.WORLD_ID, "version": snap_ver},
        {"$set": {"world_id": nw.WORLD_ID, "version": snap_ver,
                  "world": doc["published"], "label": f"pre-publish snapshot v{snap_ver}",
                  "created_at": _iso()}}, upsert=True)
    new_ver = snap_ver + 1
    await db.nexus_worlds.update_one({"world_id": nw.WORLD_ID}, {"$set": {
        "published": doc["draft"], "published_version": new_ver, "updated_at": _iso()}})
    await _audit(current.get("username"), "publish", {"published_version": new_ver})
    return {"ok": True, "published_version": new_ver}


@router.get("/admin/versions")
async def admin_versions(current: CurrentUser):
    require_founder(current)
    doc = await _world_doc()
    versions = await db.nexus_versions.find({"world_id": nw.WORLD_ID},
                                            {"_id": 0, "world": 0}).sort("version", -1).to_list(50)
    return {"versions": versions, "draft_version": doc["draft_version"],
            "published_version": doc["published_version"]}


@router.post("/admin/rollback")
async def admin_rollback(body: dict, current: CurrentUser):
    require_founder(current)
    ver = int(body.get("version") or 0)
    snap = await db.nexus_versions.find_one({"world_id": nw.WORLD_ID, "version": ver}, {"_id": 0})
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    doc = await _world_doc()
    await db.nexus_worlds.update_one({"world_id": nw.WORLD_ID}, {"$set": {
        "draft": snap["world"], "draft_version": doc["draft_version"] + 1, "updated_at": _iso()}})
    await _audit(current.get("username"), "rollback_to_draft", {"from_version": ver})
    return {"ok": True, "note": f"Snapshot v{ver} restored into DRAFT. Review and publish to go live."}


@router.get("/admin/audit")
async def admin_audit(current: CurrentUser):
    require_founder(current)
    items = await db.nexus_audit.find({}, {"_id": 0}).sort("at", -1).to_list(60)
    return {"audit": items}


@router.get("/admin/presence")
async def admin_presence(current: CurrentUser):
    require_founder(current)
    cutoff = time.time() - 12
    players = await db.nexus_presence.find(
        {"ts": {"$gt": cutoff}},
        {"_id": 0, "user_id": 1, "username": 1, "zone_id": 1, "x": 1, "z": 1, "anim": 1}).to_list(100)
    return {"players": players, "online": len(players)}


@router.post("/admin/save-version")
async def admin_save_version(body: dict, current: CurrentUser):
    require_founder(current)
    doc = await _world_doc()
    top = await db.nexus_versions.find({"world_id": nw.WORLD_ID}).sort("version", -1).to_list(1)
    ver = max(1000, (top[0]["version"] if top else 0)) + 1
    await db.nexus_versions.insert_one({
        "world_id": nw.WORLD_ID, "version": ver, "world": doc["draft"],
        "label": str(body.get("label") or f"manual draft save (draft v{doc['draft_version']})")[:80],
        "kind": "manual", "created_at": _iso()})
    await _audit(current.get("username"), "save_version", {"version": ver})
    return {"ok": True, "version": ver}


# ───────────────────── AI Magic Loop ─────────────────────
from services import nexus_magic as nm  # noqa: E402


@router.get("/magic/config")
async def magic_config(current: CurrentUser):
    require_founder(current)
    return {"modes": sorted(nm.MODES), "stages": nm.STAGES,
            "animation_styles": nm.ANIMATION_STYLES, "runtime_styles": nm.RUNTIME_STYLES,
            "limits": {"normal": {"stop_score_max": 95, "max_attempts": 3, "repair_cycles": 2},
                       "founder_max": {"stop_score_max": 99, "max_attempts": 5, "repair_cycles": 3}}}


@router.post("/magic/estimate")
async def magic_estimate(body: dict, current: CurrentUser):
    require_founder(current)
    doc = await _world_doc()
    mode = str(body.get("mode") or "")
    if mode not in nm.MODES:
        raise HTTPException(status_code=400, detail=f"unknown mode {mode}")
    try:
        targets = nm.validate_targets(doc["draft"], body.get("targets") or [])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    settings = nm.clamp_settings(body.get("settings") or {}, bool((body.get("settings") or {}).get("founder_max")))
    mock = settings["mock"] or mode in ("improve_draft", "animation_style", "runtime_style", "clone_variant")
    llm_calls = 0 if mock else 1 + settings["repair_cycles"]
    est_ops = len(targets) if mode != "clone_variant" else 0
    return {"mode": mode, "targets": len(targets), "estimated_ops": est_ops,
            "provider_calls": {"orai_llm": llm_calls, "meshy": 0, "image_gen": 0},
            "credits": {"meshy": 0, "image": 0},
            "estimated_duration_s": 5 + 2 * settings["repair_cycles"],
            "settings": settings,
            "note": "Deterministic local proposer — zero paid calls" if mock else f"Up to {llm_calls} ORAi text calls"}


@router.post("/magic/start")
async def magic_start(body: dict, current: CurrentUser):
    require_founder(current)
    doc = await _world_doc()
    mode = str(body.get("mode") or "")
    if mode not in nm.MODES:
        raise HTTPException(status_code=400, detail=f"unknown mode {mode}")
    try:
        targets = nm.validate_targets(doc["draft"], body.get("targets") or [])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    raw = body.get("settings") or {}
    settings = nm.clamp_settings(raw, bool(raw.get("founder_max")))
    style = str(body.get("style") or "") or None
    if mode == "animation_style" and not (nm.ANIMATION_STYLES.get(style) or {}).get("supported"):
        raise HTTPException(status_code=400, detail=f"animation style '{style}' not supported by the greybox renderer")
    if mode == "runtime_style" and not (nm.RUNTIME_STYLES.get(style) or {}).get("supported"):
        raise HTTPException(status_code=400, detail=f"runtime style '{style}' not supported by the greybox renderer")
    active = await db.nexus_magic_runs.count_documents({"status": {"$in": ["running", "paused"]}})
    if active >= 4:
        raise HTTPException(status_code=429, detail="Max 4 concurrent runs")
    rid = "run_" + uuid.uuid4().hex[:10]
    run = {"id": rid, "label": str(body.get("label") or f"{mode} · {len(targets)} target(s)")[:80],
           "mode": mode, "style": style, "targets": targets, "settings": settings,
           "request": str(body.get("request") or "")[:500],
           "status": "running", "stage": "build", "stages_done": 0, "score": None, "cycles": 0,
           "stage_history": [], "diff": None, "result": None,
           "provider_usage": {"orai_calls": 0, "openai_calls": 0, "meshy_calls": 0},
           "control": None, "created_by": current.get("username"),
           "created_at": _iso(), "updated_at": _iso(), "heartbeat": time.time()}
    await db.nexus_magic_runs.insert_one({**run})
    await _audit(current.get("username"), "magic_start",
                 {"run_id": rid, "mode": mode, "targets": len(targets),
                  "founder_max": settings["founder_max"], "dry_run": settings["dry_run"]})
    import asyncio as _aio
    _aio.create_task(nm.execute_run(rid))
    run.pop("_id", None)
    return {"run": run}


@router.get("/magic/runs")
async def magic_runs(current: CurrentUser):
    require_founder(current)
    runs = await db.nexus_magic_runs.find({}, {"_id": 0}).sort("created_at", -1).to_list(20)
    now = time.time()
    for r in runs:
        if r["status"] in ("running", "paused") and now - (r.get("heartbeat") or 0) > 25:
            r["status"] = "stalled"
            await db.nexus_magic_runs.update_one({"id": r["id"]}, {"$set": {"status": "stalled"}})
    return {"runs": runs}


@router.post("/magic/runs/{rid}/control")
async def magic_control(rid: str, body: dict, current: CurrentUser):
    require_founder(current)
    action = str(body.get("action") or "")
    if action not in ("pause", "resume", "stop"):
        raise HTTPException(status_code=400, detail="action must be pause|resume|stop")
    run = await db.nexus_magic_runs.find_one({"id": rid}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    if run["status"] not in ("running", "paused"):
        raise HTTPException(status_code=400, detail=f"run is {run['status']}")
    ctrl = {"pause": "pause", "resume": None, "stop": "stop"}[action]
    patch = {"control": ctrl, "updated_at": _iso()}
    if action == "resume":
        patch["status"] = "running"
    await db.nexus_magic_runs.update_one({"id": rid}, {"$set": patch})
    await _audit(current.get("username"), f"magic_{action}", {"run_id": rid})
    return {"ok": True, "action": action}


@router.post("/magic/control-all")
async def magic_control_all(body: dict, current: CurrentUser):
    require_founder(current)
    action = str(body.get("action") or "")
    if action not in ("pause", "stop"):
        raise HTTPException(status_code=400, detail="action must be pause|stop")
    r = await db.nexus_magic_runs.update_many(
        {"status": {"$in": ["running", "paused"]}},
        {"$set": {"control": action, "updated_at": _iso()}})
    await _audit(current.get("username"), f"magic_{action}_all", {"affected": r.modified_count})
    return {"ok": True, "affected": r.modified_count}


@router.post("/magic/runs/{rid}/decide")
async def magic_decide(rid: str, body: dict, current: CurrentUser):
    require_founder(current)
    run = await db.nexus_magic_runs.find_one({"id": rid}, {"_id": 0})
    if not run or run["status"] != "awaiting_approval":
        raise HTTPException(status_code=404, detail="Run not awaiting approval")
    if run["settings"].get("dry_run"):
        raise HTTPException(status_code=400, detail="Dry runs cannot be applied")
    if not body.get("approve"):
        await db.nexus_magic_runs.update_one({"id": rid}, {"$set": {"status": "rejected", "updated_at": _iso()}})
        await _audit(current.get("username"), "magic_reject", {"run_id": rid})
        return {"ok": True, "status": "rejected"}
    doc = await _world_doc()
    try:
        new_world, inverse, summary = nw.apply_ops(doc["draft"], run["result"]["ops"])
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Result no longer applies to draft: {e}")
    ver = doc["draft_version"] + 1
    await db.nexus_worlds.update_one({"world_id": nw.WORLD_ID}, {"$set": {
        "draft": new_world, "draft_version": ver, "updated_at": _iso()}})
    await db.nexus_magic_runs.update_one({"id": rid}, {"$set": {"status": "applied", "updated_at": _iso()}})
    await _audit(current.get("username"), "magic_apply", {"run_id": rid, "summary": summary})
    return {"ok": True, "status": "applied", "draft_version": ver, "inverse_ops": inverse}


@router.get("/magic/variants")
async def magic_variants(current: CurrentUser):
    require_founder(current)
    items = await db.nexus_variants.find({}, {"_id": 0, "world": 0}).sort("created_at", -1).to_list(30)
    return {"variants": items}


@router.post("/magic/variants/{vid}/load")
async def magic_variant_load(vid: str, current: CurrentUser):
    require_founder(current)
    var = await db.nexus_variants.find_one({"id": vid}, {"_id": 0})
    if not var:
        raise HTTPException(status_code=404, detail="variant not found")
    doc = await _world_doc()
    backup_id = "var_" + uuid.uuid4().hex[:10]
    await db.nexus_variants.insert_one({
        "id": backup_id, "label": f"auto-backup before loading {var['label']}",
        "world": doc["draft"], "source_draft_version": doc["draft_version"],
        "targets": [], "kind": "auto_backup", "created_at": _iso()})
    await db.nexus_worlds.update_one({"world_id": nw.WORLD_ID}, {"$set": {
        "draft": var["world"], "draft_version": doc["draft_version"] + 1, "updated_at": _iso()}})
    await _audit(current.get("username"), "variant_load", {"variant_id": vid, "backup_id": backup_id})
    return {"ok": True, "backup_variant_id": backup_id, "draft_version": doc["draft_version"] + 1}


# ───────────────────── ORAi World Architect ─────────────────────
ORAI_SYS = """You are ORAi World Architect for OurRealm Nexus, a 3D greybox world editor.
You NEVER write code. You output ONLY a JSON object: {"plan": "<1-3 sentence plan>", "ops": [...]}
Allowed ops (strict schema):
 {"op":"add_entity","zone_id":Z,"entity":{"type":"box|ramp|pillar|light|portal|npc","pos":[x,y,z],"rot":[0,ry,0],"scale":[sx,sy,sz],"color":"#hex","props":{"label":str}}}
 {"op":"update_entity","zone_id":Z,"entity_id":ID,"fields":{"pos":[..],"rot":[..],"scale":[..],"color":"#hex","props":{...}}}
 {"op":"remove_entity","zone_id":Z,"entity_id":ID}
 {"op":"update_zone","zone_id":Z,"fields":{"sky":"#hex","ground_color":"#hex","name":str,"ambient":0-3,"sun":0-3,"spawn":{"x":n,"z":n}}}
 {"op":"add_zone","zone":{"id":str,"name":str,"size":[w,d]}}
Ground plane is y=0; pos y is the entity BASE (keep 0 for grounded objects). Zone bounds: ±size/2.
Keep edits minimal and faithful to the request. Use existing entity ids from the context when moving/editing."""


@router.post("/orai/propose")
async def orai_propose(body: dict, current: CurrentUser):
    require_founder(current)
    request_text = str(body.get("request") or "").strip()
    if not request_text:
        raise HTTPException(status_code=400, detail="Empty request")
    doc = await _world_doc()
    zone_id = str(body.get("zone_id") or "plaza")
    zone = next((z for z in doc["draft"]["zones"] if z["id"] == zone_id), doc["draft"]["zones"][0])
    ctx = {"active_zone": {"id": zone["id"], "name": zone["name"], "size": zone["size"],
                           "sky": zone["sky"], "ground_color": zone["ground_color"],
                           "spawn": zone["spawn"]},
           "entities": [{"id": e["id"], "type": e["type"], "pos": e["pos"],
                         "scale": e["scale"], "label": e.get("props", {}).get("label")}
                        for e in zone["entities"]],
           "zones": [z["id"] for z in doc["draft"]["zones"]],
           "selected_entity": body.get("selected_entity"),
           "draft_version": doc["draft_version"],
           "capabilities": sorted(nw.ENTITY_TYPES)}
    from services.chat_conversations import call_openai_chat
    import json as _json
    res = await call_openai_chat(
        [{"role": "system", "content": ORAI_SYS},
         {"role": "user", "content": f"WORLD CONTEXT:\n{_json.dumps(ctx)}\n\nFOUNDER REQUEST:\n{request_text}"}],
        json_mode=True, temperature=0.4, max_tokens=4000)
    try:
        parsed = _json.loads(res.get("content") or "{}")
        plan = str(parsed.get("plan") or "")[:600]
        ops = parsed.get("ops") or []
        nw.apply_ops(doc["draft"], ops)  # dry-run validation only
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"ORAi proposal failed validation: {e}")
    pid = uuid.uuid4().hex[:12]
    prop = {"id": pid, "request": request_text[:500], "zone_id": zone["id"], "plan": plan,
            "ops": ops, "status": "pending", "created_by": current.get("username"),
            "created_at": _iso(), "model": res.get("model")}
    await db.nexus_proposals.insert_one({**prop})
    prop.pop("_id", None)
    return {"proposal": prop}


@router.post("/orai/decide")
async def orai_decide(body: dict, current: CurrentUser):
    require_founder(current)
    pid = str(body.get("proposal_id") or "")
    prop = await db.nexus_proposals.find_one({"id": pid}, {"_id": 0})
    if not prop or prop["status"] != "pending":
        raise HTTPException(status_code=404, detail="Pending proposal not found")
    if not body.get("approve"):
        await db.nexus_proposals.update_one({"id": pid}, {"$set": {"status": "rejected", "decided_at": _iso()}})
        await _audit(current.get("username"), "orai_reject", {"proposal_id": pid})
        return {"ok": True, "status": "rejected"}
    doc = await _world_doc()
    try:
        new_world, inverse, summary = nw.apply_ops(doc["draft"], prop["ops"])
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Proposal no longer applies: {e}")
    ver = doc["draft_version"] + 1
    await db.nexus_worlds.update_one({"world_id": nw.WORLD_ID}, {"$set": {
        "draft": new_world, "draft_version": ver, "updated_at": _iso()}})
    await db.nexus_proposals.update_one({"id": pid}, {"$set": {"status": "applied", "decided_at": _iso()}})
    await _audit(current.get("username"), "orai_apply", {"proposal_id": pid, "summary": summary})
    return {"ok": True, "status": "applied", "draft_version": ver, "inverse_ops": inverse}


@router.get("/orai/proposals")
async def orai_proposals(current: CurrentUser):
    require_founder(current)
    items = await db.nexus_proposals.find({}, {"_id": 0}).sort("created_at", -1).to_list(30)
    return {"proposals": items}
