"""Education plan routes — draft, review/approve, activate, manage automation."""
import logging
from datetime import datetime, timedelta, date as date_cls

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import get_admin_role
from services.rc_units import _ctx
from services import education_plans as ep

log = logging.getLogger("ourrealm.edu.routes")
router = APIRouter(prefix="/api/responsibility-center", tags=["edu-plans"])


async def _plan(center_id, plan_id):
    p = await db.edu_plans.find_one({"id": plan_id, "center_id": center_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Plan not found")
    return p


def _can_approve(center, current, perms):
    return get_admin_role(current) == "founder" or center.get("created_by") == current["id"] \
        or "manage_roles" in perms


@router.post("/{center_id}/edu-plans/draft")
async def draft_plan(center_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "edit_center")
    from services.access_policy import require_access
    await require_access("course_maker", current, center_id=center_id, consume=False)
    text = (body.get("request_text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Describe the learning plan first")
    plan = await ep.draft_plan(center_id, text, current)
    return {"plan": plan}


@router.get("/{center_id}/edu-plans")
async def list_plans(center_id: str, current: CurrentUser):
    await _ctx(center_id, current, "edit_center", write=False)
    rows = await db.edu_plans.find({"center_id": center_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"plans": rows}


@router.get("/{center_id}/edu-plans/{plan_id}")
async def plan_detail(center_id: str, plan_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "edit_center", write=False)
    plan = await _plan(center_id, plan_id)
    runs = await db.edu_plan_runs.find(
        {"plan_id": plan_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    upcoming = []
    d = ep._local_today(plan)
    for i in range(21):
        day = d + timedelta(days=i)
        if ep._is_learning_day(plan, day):
            upcoming.append(day.isoformat())
        if len(upcoming) >= 7:
            break
    return {"plan": plan, "runs": runs, "upcoming_dates": upcoming,
            "can_approve": _can_approve(center, current, perms)}


@router.patch("/{center_id}/edu-plans/{plan_id}")
async def edit_plan(center_id: str, plan_id: str, body: dict, current: CurrentUser):
    await _ctx(center_id, current, "edit_center")
    plan = await _plan(center_id, plan_id)
    patch = {}
    if isinstance(body.get("students"), list):
        students = []
        for s in body["students"][:12]:
            students.append({"user_id": str(s.get("user_id")), "username": str(s.get("username") or "")[:60],
                             "grade_text": str(s.get("grade_text") or "")[:60],
                             "subjects": [str(x)[:60] for x in (s.get("subjects") or [])][:10],
                             "accessibility": str(s.get("accessibility") or "")[:300],
                             "adjustments": str(s.get("adjustments") or "")[:400]})
            # persist grade/subjects back to the live education profile
            await db.rc_member_education.update_one(
                {"center_id": center_id, "user_id": str(s.get("user_id"))},
                {"$set": {"grade_text": str(s.get("grade_text") or "")[:60],
                          "subjects": [str(x)[:60] for x in (s.get("subjects") or [])][:10],
                          "updated_at": ep._iso(), "updated_by": current["id"]}}, upsert=True)
        patch["students"] = students
        patch["missing_info"] = [f"@{s['username']}: {m}" for s in students
                                 for m in (["grade level"] if not s["grade_text"] else [])
                                 + (["selected subjects"] if not s["subjects"] else [])]
    if isinstance(body.get("schedule"), dict):
        sc = body["schedule"]
        cur = plan["schedule"]
        patch["schedule"] = {
            "start_date": str(sc.get("start_date") or cur["start_date"])[:10],
            "end_date": str(sc.get("end_date") or cur["end_date"])[:10],
            "days": [d for d in (sc.get("days") or cur["days"]) if d in ep.DAYS] or cur["days"],
            "skip_dates": [str(x)[:10] for x in (sc.get("skip_dates") or cur.get("skip_dates") or [])][:60],
            "generation_time": str(sc.get("generation_time") or cur["generation_time"])[:5],
            "timezone": str(sc.get("timezone") or cur["timezone"])[:50]}
    if isinstance(body.get("caps"), dict):
        patch["caps"] = {k: max(0, int(body["caps"].get(k) or 0)) for k in plan["caps"]}
    if isinstance(body.get("media"), dict):
        patch["media"] = {k: bool(body["media"].get(k, plan["media"][k])) for k in plan["media"]}
        patch["media"]["video"] = bool(body["media"].get("video")) and plan["media"].get("video", False)
    for k in ("title", "notes"):
        if k in body:
            patch[k] = str(body[k] or "")[:800 if k == "notes" else 120]
    if patch:
        patch["updated_at"] = ep._iso()
        if plan["status"] in ("declined", "changes_requested"):
            patch["status"] = "pending_approval"
        await db.edu_plans.update_one({"id": plan_id}, {"$set": patch})
        await ep.audit(current, "plan_edited", plan_id, center_id, detail=str(sorted(patch.keys())))
    return {"plan": await _plan(center_id, plan_id)}


@router.post("/{center_id}/edu-plans/{plan_id}/action")
async def plan_action(center_id: str, plan_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "edit_center")
    plan = await _plan(center_id, plan_id)
    action = body.get("action")
    feedback = str(body.get("feedback") or "")[:600]
    if action in ("approve", "decline", "request_changes"):
        if not _can_approve(center, current, perms):
            raise HTTPException(status_code=403, detail="Only the Center owner or founder can review plans")
        plan = await ep.decide(plan, action, current, feedback)
        if action == "approve" and body.get("activate"):
            try:
                plan = await ep.activate(plan, current)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
        return {"plan": plan}
    if action == "activate":
        if not _can_approve(center, current, perms):
            raise HTTPException(status_code=403, detail="Only the Center owner or founder can activate plans")
        try:
            return {"plan": await ep.activate(plan, current)}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    if action == "pause":
        await db.edu_plans.update_one({"id": plan_id}, {"$set": {"status": "paused", "paused_reason": feedback or "Paused by owner", "updated_at": ep._iso()}})
    elif action == "resume":
        if plan["status"] != "paused":
            raise HTTPException(status_code=400, detail="Plan is not paused")
        await db.edu_plans.update_one({"id": plan_id}, {"$set": {"status": "active", "paused_reason": None, "updated_at": ep._iso()}})
    elif action == "skip_date":
        d = str(body.get("date") or "")[:10]
        await db.edu_plans.update_one({"id": plan_id}, {"$addToSet": {"schedule.skip_dates": d}})
    elif action == "generate_next_now":
        if plan["status"] != "active":
            raise HTTPException(status_code=400, detail="Activate the plan first")
        import asyncio
        asyncio.create_task(ep._generate_day(plan_id, ep._local_today(plan).isoformat()))
    elif action == "retry_failed":
        failed = await db.edu_plan_runs.find({"plan_id": plan_id, "status": "failed"}, {"_id": 0}).to_list(50)
        import asyncio
        for r in failed:
            await db.edu_plan_runs.delete_one({"id": r["id"]})
            student = next((s for s in plan["students"] if s["user_id"] == r["student_id"]), None)
            if student:
                asyncio.create_task(ep._generate_student_lesson(plan, student, r["date"]))
    elif action == "end":
        await db.edu_plans.update_one({"id": plan_id}, {"$set": {"status": "completed", "updated_at": ep._iso()}})
    elif action == "archive":
        await db.edu_plans.update_one({"id": plan_id}, {"$set": {"status": "archived", "updated_at": ep._iso()}})
    elif action == "delete":
        if plan["status"] == "active":
            raise HTTPException(status_code=400, detail="Pause or end the plan before deleting it")
        await db.edu_plans.delete_one({"id": plan_id})
        await db.edu_plan_runs.delete_many({"plan_id": plan_id})
    else:
        raise HTTPException(status_code=400, detail="Unknown action")
    await ep.audit(current, f"plan_{action}", plan_id, center_id, detail=feedback[:120])
    remaining = await db.edu_plans.find_one({"id": plan_id}, {"_id": 0})
    return {"plan": remaining, "ok": True}
