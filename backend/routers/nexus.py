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
