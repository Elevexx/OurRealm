"""Responsibility Center — Bundle G universal template engine.

ONE data-driven registry configures every Center type. Templates only
add starter records (never fake activity), never overwrite existing
data, and application is idempotent + retry-safe (no extra Fire Power).
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from core.db import db
from services import responsibility_center as rc
from services import rc_units as rcu
from services.rc_units import _ctx

log = logging.getLogger("ourrealm.rc.templates")
TEMPLATE_VERSION = 1


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _t(key, name, ctype, desc, audience, units, categories, items, widgets,
       settings=None, unit_label="Groups"):
    return {"template_key": key, "name": name, "center_type": ctype,
            "short_description": desc, "recommended_audience": audience,
            "version": TEMPLATE_VERSION, "status": "published",
            "units": units, "categories": categories, "starter_items": items,
            "default_widgets": widgets, "unit_label": unit_label,
            "default_settings": {"allow_member_self_tasks": None,
                                 "attendance_default": False, **(settings or {})}}


_W_CORE = ["center_status", "my_work", "due_today", "upcoming_calendar", "recent_activity"]

TEMPLATES = {
    "personal": _t("personal", "Personal", "personal",
                   "A private space for your own goals, habits, and priorities.", "Individuals",
                   [], ["Personal", "Home", "Health & Wellness", "Learning", "Goals", "Important"],
                   [{"title": "Review today's priorities", "item_type": "responsibility", "category": "Personal"},
                    {"title": "Plan the week", "item_type": "responsibility", "category": "Goals"},
                    {"title": "Track an important goal", "item_type": "task", "category": "Goals"}],
                   ["my_work", "due_today", "upcoming_calendar", "recent_activity"],
                   {"allow_member_self_tasks": True}),
    "family": _t("family", "Family / Household", "family",
                 "Chores, school, appointments, and family events in one place.", "Families & households",
                 [{"name": "Household", "unit_type": "household"}, {"name": "Parents", "unit_type": "group"},
                  {"name": "Children", "unit_type": "group"}],
                 ["Chores", "School", "Appointments", "Family Events", "Meals", "Home", "Goals"],
                 [{"title": "Keep personal space organized", "item_type": "responsibility", "category": "Home"},
                  {"title": "Weekly household check", "item_type": "responsibility", "category": "Home"},
                  {"title": "Family calendar review", "item_type": "responsibility", "category": "Family Events"},
                  {"title": "Take out trash", "item_type": "task", "category": "Chores"},
                  {"title": "Prepare for tomorrow", "item_type": "task", "category": "School"}],
                 _W_CORE + ["unit_summary", "birthdays_upcoming"],
                 {"allow_member_self_tasks": True}),
    "education": _t("education", "Education", "education",
                    "Classes, assignments, attendance, and student work.", "Schools, tutors & homeschool",
                    [{"name": "Grade", "unit_type": "grade"}, {"name": "Class", "unit_type": "class"},
                     {"name": "Study Group", "unit_type": "group"}],
                    ["Lessons", "Assignments", "Assessments", "Attendance", "Reading", "Projects", "Study"],
                    [{"title": "Review daily lesson plan", "item_type": "responsibility", "category": "Lessons"},
                     {"title": "Track assignment completion", "item_type": "responsibility", "category": "Assignments"},
                     {"title": "Review attendance", "item_type": "responsibility", "category": "Attendance"}],
                    _W_CORE + ["unit_summary", "attendance_summary", "pending_approvals"],
                    {"allow_member_self_tasks": False, "attendance_default": True}, "Classes"),
    "business": _t("business", "Business", "business",
                   "Departments, projects, approvals, and team workload.", "Companies & teams at work",
                   [{"name": "Leadership", "unit_type": "department"}, {"name": "Operations", "unit_type": "department"},
                    {"name": "Projects", "unit_type": "project"}, {"name": "Support", "unit_type": "department"}],
                   ["Operations", "Projects", "Meetings", "Compliance", "Training", "Customer Support", "Administration"],
                   [{"title": "Weekly operations review", "item_type": "responsibility", "category": "Operations"},
                    {"title": "Prepare team meeting agenda", "item_type": "task", "category": "Meetings"}],
                   _W_CORE + ["unit_summary", "pending_approvals", "member_summary", "vault_balance"],
                   {"allow_member_self_tasks": False}, "Departments"),
    "organization": _t("organization", "Organization / Nonprofit", "organization",
                       "Programs, volunteers, committees, and outreach.", "Nonprofits & organizations",
                       [{"name": "Leadership", "unit_type": "committee"}, {"name": "Staff", "unit_type": "team"},
                        {"name": "Volunteers", "unit_type": "volunteer"}, {"name": "Programs", "unit_type": "project"}],
                       ["Events", "Volunteers", "Programs", "Outreach", "Administration", "Fundraising Activities"],
                       [{"title": "Weekly program check-in", "item_type": "responsibility", "category": "Programs"}],
                       _W_CORE + ["unit_summary", "member_summary"]),
    "church": _t("church", "Church", "church",
                 "Services, ministries, volunteers, and small groups.", "Churches & ministries",
                 [{"name": "Leadership", "unit_type": "committee"}, {"name": "Ministries", "unit_type": "ministry"},
                  {"name": "Volunteers", "unit_type": "volunteer"}, {"name": "Small Groups", "unit_type": "group"}],
                 ["Services", "Ministries", "Volunteer Scheduling", "Events", "Community Support", "Administration"],
                 [{"title": "Plan weekly service", "item_type": "responsibility", "category": "Services"}],
                 _W_CORE + ["unit_summary", "birthdays_upcoming"], unit_label="Ministries"),
    "sports": _t("sports", "Sports Team", "sports",
                 "Practices, games, training, and team goals.", "Teams, leagues & coaches",
                 [{"name": "Coaches", "unit_type": "team"}, {"name": "Players", "unit_type": "team"},
                  {"name": "Support Staff", "unit_type": "team"}],
                 ["Practices", "Games", "Training", "Equipment", "Travel", "Team Goals"],
                 [{"title": "Plan this week's practices", "item_type": "responsibility", "category": "Practices"}],
                 _W_CORE + ["attendance_summary", "unit_summary"],
                 {"attendance_default": True}, "Squads"),
    "community": _t("community", "Community", "community",
                    "Events, projects, announcements, and member support.", "Clubs & communities",
                    [{"name": "Administrators", "unit_type": "group"}, {"name": "Moderators", "unit_type": "group"},
                     {"name": "Events", "unit_type": "project"}],
                    ["Events", "Moderation", "Community Projects", "Announcements", "Member Support"],
                    [{"title": "Review community announcements", "item_type": "responsibility", "category": "Announcements"}],
                    _W_CORE + ["member_summary"]),
    "volunteer": _t("volunteer", "Volunteer Group", "volunteer",
                    "Scheduling, events, training, and outreach.", "Volunteer coordinators",
                    [{"name": "Coordinators", "unit_type": "team"}, {"name": "Volunteers", "unit_type": "volunteer"}],
                    ["Scheduling", "Events", "Training", "Supplies", "Outreach"],
                    [{"title": "Confirm this week's volunteer schedule", "item_type": "responsibility", "category": "Scheduling"}],
                    _W_CORE + ["unit_summary", "upcoming_calendar"]),
    "team": _t("team", "Team", "team",
               "A flexible template for any working group.", "Any team",
               [{"name": "Core Team", "unit_type": "team"}],
               ["Projects", "Meetings", "Goals", "Administration"],
               [{"title": "Weekly team check-in", "item_type": "responsibility", "category": "Meetings"}],
               _W_CORE + ["unit_summary"]),
    "custom": _t("custom", "Custom", "other",
                 "Start minimal and build your own structure.", "Everyone",
                 [], [], [], ["center_status", "my_work", "recent_activity"]),
}


def list_templates() -> dict:
    out = []
    for t in TEMPLATES.values():
        out.append({k: t[k] for k in ("template_key", "name", "center_type", "short_description",
                                      "recommended_audience", "version", "unit_label")}
                   | {"unit_count": len(t["units"]), "category_count": len(t["categories"]),
                      "starter_item_count": len(t["starter_items"]),
                      "widget_count": len(t["default_widgets"]),
                      "self_tasks_default": t["default_settings"]["allow_member_self_tasks"],
                      "attendance_default": t["default_settings"]["attendance_default"]})
    return {"templates": out}


def get_template(key: str) -> dict:
    t = TEMPLATES.get(key)
    if not t:
        raise HTTPException(status_code=404, detail="Unknown template")
    return {"template": t}


async def apply_template(user: dict, center_id: str, body: dict) -> dict:
    """Idempotent starter-content application. Modes: recommended (all),
    simple (categories+widgets only), skip. Never overwrites existing
    records; retries never duplicate; no Fire Power involved."""
    center, membership, perms = await _ctx(center_id, user, "edit_center")
    key = body.get("template_key") or center.get("template_key") or center.get("center_type") or "custom"
    t = TEMPLATES.get(key)
    if not t:
        raise HTTPException(status_code=404, detail="Unknown template")
    mode = body.get("mode") or "recommended"
    if mode not in ("recommended", "simple", "skip"):
        raise HTTPException(status_code=400, detail="Invalid setup mode")
    app_id = f"tpl:{center_id}:{key}:v{t['version']}"
    existing_app = await db.responsibility_center_template_applications.find_one(
        {"idempotency_key": app_id, "status": "completed"}, {"_id": 0})
    renames = body.get("unit_renames") or {}
    created = {"units": 0, "items": 0, "categories": 0, "widgets": False}
    if mode == "skip":
        pass
    else:
        # categories — merge, never remove owner's own
        cats = list(dict.fromkeys((center.get("categories") or []) + t["categories"]))
        if cats != (center.get("categories") or []):
            await db.responsibility_centers.update_one({"id": center_id}, {"$set": {"categories": cats}})
            created["categories"] = len(t["categories"])
        # settings — only fill when unset (never overwrite customization)
        sets = {}
        if center.get("allow_member_self_tasks") is None and t["default_settings"]["allow_member_self_tasks"] is not None:
            sets["allow_member_self_tasks"] = t["default_settings"]["allow_member_self_tasks"]
        if sets:
            await db.responsibility_centers.update_one({"id": center_id}, {"$set": sets})
        if mode == "recommended":
            include_units = body.get("include_units", True)
            include_items = body.get("include_items", True)
            if include_units:
                for u in t["units"]:
                    name = (renames.get(u["name"]) or u["name"]).strip()[:80]
                    if body.get("excluded_units") and u["name"] in body["excluded_units"]:
                        continue
                    dup = await db.responsibility_center_units.find_one(
                        {"center_id": center_id, "name": name}, {"_id": 1})
                    if dup:
                        continue
                    try:
                        await rcu.create_unit(user, center_id, {
                            "name": name, "unit_type": u["unit_type"],
                            "client_token": f"tpl:{key}:unit:{u['name']}"})
                        created["units"] += 1
                    except HTTPException:
                        continue
            if include_items:
                for it in t["starter_items"]:
                    dup = await db.responsibility_items.find_one(
                        {"center_id": center_id, "client_token": f"tpl:{key}:item:{it['title']}"}, {"_id": 1})
                    if dup:
                        continue
                    from services import rc_items
                    try:
                        # never auto-assign to real members — unassigned starters
                        await rc_items.create_item(user, center_id, {
                            "title": it["title"], "item_type": it.get("item_type") or "task",
                            "category": it.get("category"), "assignee_ids": [],
                            "client_token": f"tpl:{key}:item:{it['title']}"})
                        created["items"] += 1
                    except HTTPException:
                        continue
        # default widget layout (template scope) — only if none exists
        exists = await db.responsibility_center_widget_layouts.find_one(
            {"center_id": center_id, "layout_scope": "center_default"}, {"_id": 1})
        if not exists:
            await db.responsibility_center_widget_layouts.insert_one({
                "id": uuid.uuid4().hex, "center_id": center_id, "layout_scope": "center_default",
                "layout": [{"widget_key": w} for w in t["default_widgets"]],
                "version": 1, "source": f"template:{key}", "created_by": user["id"],
                "created_at": _iso(), "updated_at": _iso()})
            created["widgets"] = True
    await db.responsibility_centers.update_one(
        {"id": center_id},
        {"$set": {"template_key": key, "template_version": t["version"],
                  "template_setup_status": "completed", "updated_at": _iso()}})
    if not existing_app:
        await db.responsibility_center_template_applications.insert_one({
            "id": uuid.uuid4().hex, "center_id": center_id, "template_key": key,
            "template_version": t["version"], "applied_by": user["id"],
            "application_type": body.get("application_type") or "initial",
            "mode": mode, "status": "completed", "idempotency_key": app_id,
            "created": created, "applied_at": _iso(), "completed_at": _iso()})
    await rc.log_activity(center_id, user, "template_applied",
                          f"@{user.get('username')} applied the {t['name']} template ({mode} setup)")
    return {"ok": True, "template_key": key, "version": t["version"], "mode": mode,
            "created": created, "retried": bool(existing_app)}


async def template_status(user: dict, center_id: str) -> dict:
    center, membership, perms = await _ctx(center_id, user, "view_items", write=False)
    key = center.get("template_key") or center.get("center_type")
    t = TEMPLATES.get(key)
    available = []
    if t and "edit_center" in perms:
        for u in t["units"]:
            dup = await db.responsibility_center_units.find_one(
                {"center_id": center_id, "name": u["name"]}, {"_id": 1})
            if not dup:
                available.append({"component_type": "unit", "name": u["name"]})
    return {"template_key": key, "template_version": center.get("template_version"),
            "setup_status": center.get("template_setup_status") or "none",
            "latest_version": t["version"] if t else None,
            "available_components": available, "can_apply": "edit_center" in perms}


async def admin_template_usage() -> dict:
    out = []
    for key, t in TEMPLATES.items():
        n = await db.responsibility_centers.count_documents({"template_key": key})
        out.append({"template_key": key, "name": t["name"], "version": t["version"],
                    "status": t["status"], "centers_using": n})
    return {"templates": out, "registry": "system (code-managed, DB builder deferred)"}
