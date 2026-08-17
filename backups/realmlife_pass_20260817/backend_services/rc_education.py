"""Responsibility Center — Education dashboard service.

A polished Education view over the universal RC engine. All lesson data
comes from real responsibility_items; per-student learning settings live
on the membership document (membership.education). No fake data, ever.
"""
from datetime import datetime, timezone

from fastapi import HTTPException

from core.db import db
from services import responsibility_center as rc
from services import rc_items
from services.rc_units import _ctx

STAGES = ("prek", "k12", "higher")
PREK_LEVELS = ["Infant", "Toddler", "Preschool", "Pre-K"]
K12_LEVELS = ["K"] + [str(i) for i in range(1, 13)]
HIGHER_LEVELS = ["Certificate", "Undergraduate", "Graduate", "Custom"]
DONE = ("completed", "approved")
IN_PROGRESS = ("accepted", "in_progress", "waiting", "blocked",
               "submitted", "pending_approval", "changes_requested")
PENDING = ("draft", "assigned")


def _iso():
    return datetime.now(timezone.utc).isoformat()


def levels_for(stage: str) -> list:
    return {"prek": PREK_LEVELS, "k12": K12_LEVELS, "higher": HIGHER_LEVELS}[stage]


def _edu(m: dict) -> dict:
    e = m.get("education") or {}
    stage = e.get("stage") if e.get("stage") in STAGES else "k12"
    lvls = levels_for(stage)
    lvl = e.get("grade_level") if e.get("grade_level") in lvls else None
    return {"stage": stage, "grade_level": lvl,
            "learning_path": e.get("learning_path") or "",
            "focus_subjects": e.get("focus_subjects") or [],
            "ai_tutor_enabled": bool(e.get("ai_tutor_enabled", False)),
            "ai_power_level": e.get("ai_power_level") or "economy",
            "school_year": e.get("school_year") or ""}


def _can_manage(perms: set) -> bool:
    return "assign_items" in perms or "edit_center" in perms


async def overview(user: dict, center_id: str, student_id: str = "") -> dict:
    center, membership, perms = await _ctx(center_id, user, "view_items", write=False)
    manage = _can_manage(perms)
    ms = await db.responsibility_center_memberships.find(
        {"center_id": center_id, "status": "active"}, {"_id": 0}).to_list(300)
    if not manage:
        # students/plain members see only their own record — never other students
        ms = [m for m in ms if m["user_id"] == user["id"]]
    users = await rc._users_map([m["user_id"] for m in ms])
    students = []
    for m in ms:
        u = users.get(m["user_id"]) or {}
        students.append({"user_id": m["user_id"], "username": u.get("username"),
                         "name": u.get("name") or ("@" + (u.get("username") or "member")),
                         "avatar_url": u.get("avatar_url"), "role": m.get("role"),
                         **_edu(m)})
    sid = student_id if (manage and student_id) else user["id"]
    sel = next((s for s in students if s["user_id"] == sid), students[0] if students else None)

    lessons = []
    summary = {"total": 0, "completed": 0, "in_progress": 0, "pending": 0, "overdue": 0,
               "completion_pct": 0, "average_grade": None, "graded_count": 0,
               "study_time_week": None, "ai_sessions": None}
    if sel:
        rows = await db.responsibility_items.find(
            {"center_id": center_id, "assignee_ids": sel["user_id"],
             "is_series": {"$ne": True}, "status": {"$nin": ["canceled", "archived", "declined"]}},
            {"_id": 0}).sort("due_at", 1).to_list(300)
        grades = []
        for it in rows:
            pub = rc_items._public(it)
            summary["total"] += 1
            if pub["status"] in DONE:
                summary["completed"] += 1
            elif pub["overdue"]:
                summary["overdue"] += 1
            elif pub["status"] in IN_PROGRESS:
                summary["in_progress"] += 1
            else:
                summary["pending"] += 1
            if isinstance(it.get("grade_percent"), (int, float)):
                grades.append(float(it["grade_percent"]))
            lessons.append({"id": pub["id"], "title": pub["title"],
                            "description": (pub.get("description") or "")[:120],
                            "subject": pub.get("category") or "",
                            "item_type": pub.get("item_type"),
                            "due_at": pub.get("due_at"), "status": pub["status"],
                            "overdue": pub["overdue"], "progress": pub["progress"]})
        if summary["total"]:
            summary["completion_pct"] = round(100 * summary["completed"] / summary["total"])
        if grades:
            summary["average_grade"] = round(sum(grades) / len(grades), 1)
            summary["graded_count"] = len(grades)

    settings = await rc.get_rc_settings()
    return {"center": {"id": center["id"], "name": center["name"],
                       "center_type": center.get("center_type"),
                       "vault_balance": int(center.get("vault_balance") or 0)},
            "can_manage": manage,
            "my_permissions": sorted(perms),
            "students": students,
            "selected_student": sel,
            "lessons": lessons,
            "summary": summary,
            "stage_levels": {"prek": PREK_LEVELS, "k12": K12_LEVELS, "higher": HIGHER_LEVELS},
            "ai_power_levels": settings.get("education_ai_power_levels") or []}


async def update_student(user: dict, center_id: str, student_id: str, body: dict) -> dict:
    center, membership, perms = await _ctx(center_id, user, "view_items", write=True)
    if not _can_manage(perms):
        raise HTTPException(status_code=403,
                            detail="Only Center managers can change learning settings")
    m = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": student_id, "status": "active"}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Student not found in this Center")
    edu = dict(m.get("education") or {})
    changed = []
    if "stage" in body:
        if body["stage"] not in STAGES:
            raise HTTPException(status_code=400, detail="Invalid education level")
        edu["stage"] = body["stage"]
        changed.append("stage")
    stage = edu.get("stage") if edu.get("stage") in STAGES else "k12"
    if "grade_level" in body:
        if body["grade_level"] is not None and body["grade_level"] not in levels_for(stage):
            raise HTTPException(status_code=400, detail="Invalid grade level for this stage")
        edu["grade_level"] = body["grade_level"]
        changed.append("grade_level")
    if "ai_power_level" in body:
        settings = await rc.get_rc_settings()
        keys = {l["key"] for l in (settings.get("education_ai_power_levels") or [])}
        if body["ai_power_level"] not in keys:
            raise HTTPException(status_code=400, detail="Invalid AI Power level")
        edu["ai_power_level"] = body["ai_power_level"]
        changed.append("ai_power_level")
    if "ai_tutor_enabled" in body:
        edu["ai_tutor_enabled"] = bool(body["ai_tutor_enabled"])
        changed.append("ai_tutor_enabled")
    if "learning_path" in body:
        edu["learning_path"] = str(body["learning_path"] or "")[:60]
        changed.append("learning_path")
    if "school_year" in body:
        edu["school_year"] = str(body["school_year"] or "")[:20]
        changed.append("school_year")
    if "focus_subjects" in body:
        edu["focus_subjects"] = [str(s)[:40] for s in (body["focus_subjects"] or [])][:8]
        changed.append("focus_subjects")
    if not changed:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": student_id},
        {"$set": {"education": edu, "updated_at": _iso()}})
    u = await db.users.find_one({"id": student_id}, {"_id": 0, "username": 1})
    await rc.log_activity(center_id, user, "education_settings_updated",
                          f"@{user.get('username')} updated learning settings "
                          f"({', '.join(changed)}) for @{(u or {}).get('username')}")
    return {"ok": True, "education": _edu({"education": edu})}
