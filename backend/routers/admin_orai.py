"""Admin AI Command Center — founder-configurable ORAi controls.

/api/admin/orai/* — config (model routing, course generator, safety &
moderation rules, voice manager), prompt library, usage analytics,
AI audit log, provider health, cross-center memory/automation/template
managers. Founder: full control; support_admin: read-only.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import get_admin_role, ROLE_FOUNDER

router = APIRouter(prefix="/api/admin/orai", tags=["admin-orai"])

DEFAULT_CONFIG = {
    "default_model": "", "power_routing": {"economy": "", "standard": "", "enhanced": "", "high": ""},
    "course_generator": {"max_lessons": 20, "temperature": 0.7},
    "safety_rules": "", "moderation_rules": "",
    "voices_disabled": [], "default_voice": "nova",
    "memory_enabled_global": True,
}


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _require_admin(user: dict, write: bool = False):
    role = get_admin_role(user)
    if not role:
        raise HTTPException(status_code=403, detail="Admins only")
    if write and role != ROLE_FOUNDER:
        raise HTTPException(status_code=403, detail="Founder only")
    return role


async def get_orai_config() -> dict:
    doc = await db.orai_admin_config.find_one({"key": "main"}, {"_id": 0, "key": 0})
    return {**DEFAULT_CONFIG, **(doc or {})}


@router.get("/config")
async def read_config(current: CurrentUser):
    _require_admin(current)
    return await get_orai_config()


@router.put("/config")
async def write_config(body: dict, current: CurrentUser):
    _require_admin(current, write=True)
    patch = {}
    for k in ("default_model", "safety_rules", "moderation_rules", "default_voice"):
        if k in body:
            patch[k] = str(body[k] or "")[:4000]
    if "power_routing" in body and isinstance(body["power_routing"], dict):
        patch["power_routing"] = {k: str(v or "")[:80] for k, v in body["power_routing"].items()
                                  if k in ("economy", "standard", "enhanced", "high")}
    if "course_generator" in body and isinstance(body["course_generator"], dict):
        cg = body["course_generator"]
        patch["course_generator"] = {
            "max_lessons": max(3, min(40, int(cg.get("max_lessons") or 20))),
            "temperature": max(0.0, min(1.5, float(cg.get("temperature") or 0.7)))}
    if "voices_disabled" in body:
        patch["voices_disabled"] = [str(v)[:20] for v in (body["voices_disabled"] or [])][:8]
    if "memory_enabled_global" in body:
        patch["memory_enabled_global"] = bool(body["memory_enabled_global"])
    if patch:
        await db.orai_admin_config.update_one({"key": "main"}, {"$set": patch}, upsert=True)
        await db.responsibility_center_admin_audit.insert_one({
            "id": uuid.uuid4().hex, "action": "orai_config_updated", "center_id": None,
            "admin_id": current["id"], "admin_username": current.get("username"),
            "reason": "Admin AI Command Center", "before": None, "after": patch,
            "extra": {}, "created_at": _iso()})
    return await get_orai_config()


# ── Prompt Library ──────────────────────────────────────────────────────
@router.get("/prompts")
async def list_prompts(current: CurrentUser):
    _require_admin(current)
    rows = await db.orai_prompt_library.find({}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    return {"prompts": rows}


@router.post("/prompts")
async def add_prompt(body: dict, current: CurrentUser):
    _require_admin(current, write=True)
    doc = {"id": uuid.uuid4().hex, "title": str(body.get("title") or "Untitled")[:150],
           "body": str(body.get("body") or "")[:4000],
           "category": str(body.get("category") or "general")[:60],
           "created_by": current["id"], "created_at": _iso(), "updated_at": _iso()}
    await db.orai_prompt_library.insert_one({**doc})
    return {"prompt": doc}


@router.patch("/prompts/{prompt_id}")
async def edit_prompt(prompt_id: str, body: dict, current: CurrentUser):
    _require_admin(current, write=True)
    patch = {"updated_at": _iso()}
    for k in ("title", "body", "category"):
        if k in body:
            patch[k] = str(body[k] or "")[:4000 if k == "body" else 150]
    r = await db.orai_prompt_library.update_one({"id": prompt_id}, {"$set": patch})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"prompt": await db.orai_prompt_library.find_one({"id": prompt_id}, {"_id": 0})}


@router.delete("/prompts/{prompt_id}")
async def delete_prompt(prompt_id: str, current: CurrentUser):
    _require_admin(current, write=True)
    r = await db.orai_prompt_library.delete_one({"id": prompt_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"ok": True}


# ── Usage analytics / audit / providers ─────────────────────────────────
@router.get("/analytics")
async def analytics(current: CurrentUser):
    _require_admin(current)
    now = datetime.now(timezone.utc)
    c7, c30 = (now - timedelta(days=7)).isoformat(), (now - timedelta(days=30)).isoformat()
    pipe = [{"$match": {"updated_at": {"$gte": c30}}},
            {"$group": {"_id": "$center_id", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}}, {"$limit": 8}]
    top = await db.rc_orai_sessions.aggregate(pipe).to_list(8)
    top_centers = []
    for t in top:
        c = await db.responsibility_centers.find_one({"id": t["_id"]}, {"name": 1})
        top_centers.append({"center_id": t["_id"], "name": (c or {}).get("name", "?"), "sessions_30d": t["n"]})
    return {
        "orai_sessions_7d": await db.rc_orai_sessions.count_documents({"updated_at": {"$gte": c7}}),
        "orai_messages_7d": await db.rc_orai_messages.count_documents({"created_at": {"$gte": c7}}),
        "voice_tts_7d": await db.orai_voice_usage.count_documents({"created_at": {"$gte": c7}, "kind": "tts"}),
        "voice_stt_7d": await db.orai_voice_usage.count_documents({"created_at": {"$gte": c7}, "kind": "stt"}),
        "courses_generated_30d": await db.rc_courses.count_documents({"created_at": {"$gte": c30}}),
        "drafts_30d": await db.rc_orai_drafts.count_documents({"created_at": {"$gte": c30}}),
        "automation_runs_30d": await db.rc_automation_runs.count_documents({"created_at": {"$gte": c30}}),
        "memories_total": await db.rc_orai_memory.count_documents({}),
        "templates_total": await db.rc_templates_user.count_documents({}),
        "tutor_messages_7d": await db.rc_course_tutor_messages.count_documents({"created_at": {"$gte": c7}}),
        "top_centers": top_centers,
    }


AI_AUDIT_ACTIONS = ["orai_session_started", "course_generated", "course_published",
                    "orai_draft_created", "orai_draft_approved", "automation_created",
                    "automation_award_approved", "orai_memory_added", "orai_memory_edited",
                    "orai_memory_deleted", "orai_memory_reset", "orai_memory_exported",
                    "orai_memory_settings", "template_saved", "template_installed",
                    "course_shared", "course_imported"]


@router.get("/audit")
async def ai_audit(current: CurrentUser, limit: int = 60):
    _require_admin(current)
    rows = await db.responsibility_center_activity_logs.find(
        {"action": {"$in": AI_AUDIT_ACTIONS}}, {"_id": 0}) \
        .sort("created_at", -1).to_list(min(limit, 200))
    admin_rows = await db.responsibility_center_admin_audit.find(
        {"action": {"$regex": "orai"}}, {"_id": 0}).sort("created_at", -1).to_list(30)
    return {"activity": rows, "admin_audit": admin_rows}


@router.get("/providers")
async def provider_health(current: CurrentUser):
    _require_admin(current)
    now = datetime.now(timezone.utc)
    c24 = (now - timedelta(hours=24)).isoformat()
    return {"providers": [
        {"id": "chat", "label": "ORAi Chat Engine",
         "configured": bool(os.environ.get("OPENAI_API_KEY")),
         "fallback_configured": bool(os.environ.get("EMERGENT_LLM_KEY")),
         "activity_24h": await db.rc_orai_messages.count_documents({"created_at": {"$gte": c24}})},
        {"id": "voice", "label": "ORAi Voice Engine",
         "configured": bool(os.environ.get("OPENAI_API_KEY") or os.environ.get("EMERGENT_LLM_KEY")),
         "fallback_configured": bool(os.environ.get("EMERGENT_LLM_KEY")),
         "activity_24h": await db.orai_voice_usage.count_documents({"created_at": {"$gte": c24}})},
        {"id": "images", "label": "ORAi Image Engine",
         "configured": bool(os.environ.get("EMERGENT_LLM_KEY") or os.environ.get("OPENAI_API_KEY")),
         "fallback_configured": bool(os.environ.get("OPENAI_API_KEY")),
         "activity_24h": 0},
    ]}


# ── Cross-center managers ───────────────────────────────────────────────
@router.get("/memory")
async def all_memory(current: CurrentUser, center_id: str = ""):
    _require_admin(current)
    q = {"center_id": center_id} if center_id else {}
    rows = await db.rc_orai_memory.find(q, {"_id": 0}).sort("updated_at", -1).to_list(100)
    return {"memories": rows}


@router.delete("/memory/{memory_id}")
async def admin_delete_memory(memory_id: str, current: CurrentUser):
    _require_admin(current, write=True)
    r = await db.rc_orai_memory.delete_one({"id": memory_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"ok": True}


@router.get("/automations")
async def all_automations(current: CurrentUser):
    _require_admin(current)
    rows = await db.rc_automations.find({}, {"_id": 0}).sort("updated_at", -1).to_list(100)
    out = []
    for a in rows:
        c = await db.responsibility_centers.find_one({"id": a["center_id"]}, {"name": 1})
        out.append({**a, "center_name": (c or {}).get("name", "?")})
    return {"automations": out}


@router.patch("/automations/{auto_id}")
async def admin_toggle_automation(auto_id: str, body: dict, current: CurrentUser):
    _require_admin(current, write=True)
    r = await db.rc_automations.update_one(
        {"id": auto_id}, {"$set": {"enabled": bool(body.get("enabled")), "updated_at": _iso()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"ok": True}


@router.get("/templates")
async def all_templates(current: CurrentUser):
    _require_admin(current)
    rows = await db.rc_templates_user.find({}, {"_id": 0, "payload": 0}).sort("updated_at", -1).to_list(100)
    return {"templates": rows}
