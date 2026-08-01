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


async def _db_templates() -> dict:
    rows = await db.responsibility_center_templates.find({}, {"_id": 0}).to_list(300)
    return {r["template_key"]: r for r in rows}


def _summary_row(t: dict) -> dict:
    return {k: t.get(k) for k in ("template_key", "name", "center_type", "short_description",
                                  "recommended_audience", "version", "unit_label")} \
        | {"unit_count": len(t.get("units") or []), "category_count": len(t.get("categories") or []),
           "starter_item_count": len(t.get("starter_items") or []),
           "widget_count": len(t.get("default_widgets") or []),
           "self_tasks_default": (t.get("default_settings") or {}).get("allow_member_self_tasks"),
           "attendance_default": bool((t.get("default_settings") or {}).get("attendance_default"))}


async def list_templates() -> dict:
    ov = await _db_templates()
    out = []
    for key, t in TEMPLATES.items():
        o = ov.pop(key, None)
        if o and o.get("status") in ("disabled", "archived", "draft", "review"):
            continue  # disabled templates cannot be selected by ordinary users
        out.append(_summary_row(t))
    for key, o in ov.items():
        if o.get("status") == "published":
            out.append(_summary_row(o))
    return {"templates": out}


async def get_template(key: str) -> dict:
    o = await db.responsibility_center_templates.find_one({"template_key": key}, {"_id": 0})
    t = TEMPLATES.get(key)
    if o and o.get("source") == "admin":
        t = o if o.get("status") == "published" else None
    elif o and o.get("status") in ("disabled", "archived"):
        t = None
    if not t:
        raise HTTPException(status_code=404, detail="Unknown template")
    return {"template": {k: v for k, v in t.items() if k != "versions"}}


async def apply_template(user: dict, center_id: str, body: dict) -> dict:
    """Idempotent starter-content application. Modes: recommended (all),
    simple (categories+widgets only), skip. Never overwrites existing
    records; retries never duplicate; no Fire Power involved."""
    center, membership, perms = await _ctx(center_id, user, "edit_center")
    key = body.get("template_key") or center.get("template_key") or center.get("center_type") or "custom"
    t = TEMPLATES.get(key)
    ov = await db.responsibility_center_templates.find_one({"template_key": key}, {"_id": 0})
    if ov and ov.get("source") == "admin":
        t = ov if (ov.get("status") == "published" or center.get("template_key") == key) else None
    elif ov and ov.get("status") in ("disabled", "archived") and center.get("template_key") != key:
        raise HTTPException(status_code=403, detail="This template is currently unavailable")
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


# ── Bundle G — Admin Template Manager (DB customs + system overlay) ──────
import re as _re  # noqa: E402

VALID_STATES = ("draft", "review", "published", "disabled", "archived")
_EDITABLE = ("name", "center_type", "short_description", "recommended_audience",
             "unit_label", "categories", "units", "starter_items",
             "default_widgets", "default_settings")


def _validate_template(doc: dict) -> list:
    from services.rc_widgets import WIDGETS
    errors = []
    if not (doc.get("name") or "").strip():
        errors.append("Name is required")
    valid_types = {t["center_type"] for t in TEMPLATES.values()} | {"other"}
    if doc.get("center_type") not in valid_types:
        errors.append("Invalid Center type")
    for w in doc.get("default_widgets") or []:
        if w not in WIDGETS:
            errors.append(f"Unknown widget: {w}")
    for u in doc.get("units") or []:
        if not (u.get("name") or "").strip():
            errors.append("Every starter group needs a name")
    for it in doc.get("starter_items") or []:
        if not (it.get("title") or "").strip():
            errors.append("Every starter item needs a title")
        if (it.get("item_type") or "task") not in ("task", "responsibility"):
            errors.append("Starter items must be a task or a responsibility")
    if len(doc.get("units") or []) > 20 or len(doc.get("starter_items") or []) > 30:
        errors.append("Too many starter components")
    return errors


async def _tpl_audit(user: dict, key: str, action: str, detail: str = "", version=None):
    await db.responsibility_center_template_audit.insert_one({
        "id": uuid.uuid4().hex, "template_key": key, "action": action,
        "detail": (detail or "")[:300], "version": version,
        "actor_id": user["id"], "actor_username": user.get("username"), "at": _iso()})


async def admin_manage_list() -> dict:
    ov = await _db_templates()
    out = []
    for key, t in TEMPLATES.items():
        o = ov.pop(key, None)
        out.append(_summary_row(t) | {
            "source": "system", "status": (o or {}).get("status") or "published",
            "centers_using": await db.responsibility_centers.count_documents({"template_key": key}),
            "updated_at": (o or {}).get("updated_at")})
    for key, o in ov.items():
        out.append(_summary_row(o) | {
            "source": "admin", "status": o.get("status") or "draft",
            "centers_using": await db.responsibility_centers.count_documents({"template_key": key}),
            "updated_at": o.get("updated_at")})
    return {"templates": out}


async def admin_manage_get(key: str) -> dict:
    o = await db.responsibility_center_templates.find_one({"template_key": key}, {"_id": 0})
    t = TEMPLATES.get(key)
    if not t and not o:
        raise HTTPException(status_code=404, detail="Unknown template")
    source = "admin" if (o and o.get("source") == "admin") else "system"
    doc = {k: v for k, v in (o or {}).items() if k != "versions"} if source == "admin" else dict(t)
    status = (o or {}).get("status") or ("published" if t else "draft")
    audit = await db.responsibility_center_template_audit.find(
        {"template_key": key}, {"_id": 0}).sort("at", -1).to_list(50)
    return {"template": doc, "source": source, "status": status,
            "versions": (o or {}).get("versions") or [],
            "centers_using": await db.responsibility_centers.count_documents({"template_key": key}),
            "audit": audit}


def _slug(name: str) -> str:
    s = _re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")[:40]
    return s or "template"


async def admin_create_template(user: dict, body: dict) -> dict:
    doc = {k: body.get(k) for k in _EDITABLE}
    doc["name"] = (doc.get("name") or "").strip()[:60]
    doc["center_type"] = doc.get("center_type") or "other"
    for f in ("categories", "units", "starter_items", "default_widgets"):
        doc[f] = doc.get(f) or []
    doc["default_settings"] = {"allow_member_self_tasks": None, "attendance_default": False,
                               **(body.get("default_settings") or {})}
    errors = _validate_template(doc)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors[:4]))
    base = _slug(doc["name"])
    key, n = base, 1
    while key in TEMPLATES or await db.responsibility_center_templates.find_one(
            {"template_key": key}, {"_id": 1}):
        n += 1
        key = f"{base}_{n}"
    doc |= {"template_key": key, "source": "admin", "status": "draft", "version": 0,
            "versions": [], "unit_label": (doc.get("unit_label") or "Groups")[:30],
            "short_description": (doc.get("short_description") or "")[:200],
            "recommended_audience": (doc.get("recommended_audience") or "")[:100],
            "created_by": user["id"], "created_at": _iso(), "updated_at": _iso()}
    await db.responsibility_center_templates.insert_one({**doc})
    await _tpl_audit(user, key, "created", f"Draft created by @{user.get('username')}")
    return {"template_key": key, "ok": True}


async def admin_update_template(user: dict, key: str, body: dict) -> dict:
    o = await db.responsibility_center_templates.find_one({"template_key": key}, {"_id": 0})
    if not o or o.get("source") != "admin":
        raise HTTPException(status_code=400,
                            detail="System templates are code-managed — duplicate one to customize it")
    if o.get("status") not in ("draft", "review"):
        raise HTTPException(status_code=409,
                            detail="Only Draft or Review templates can be edited")
    sets = {k: body[k] for k in _EDITABLE if k in body}
    if "name" in sets:
        sets["name"] = (sets["name"] or "").strip()[:60]
    errors = _validate_template({**o, **sets})
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors[:4]))
    sets["updated_at"] = _iso()
    await db.responsibility_center_templates.update_one({"template_key": key}, {"$set": sets})
    await _tpl_audit(user, key, "updated", ", ".join(sorted(sets.keys())))
    return {"ok": True}


async def admin_template_status(user: dict, key: str, body: dict) -> dict:
    action = body.get("action")
    reason = (body.get("reason") or body.get("change_summary") or "").strip()
    o = await db.responsibility_center_templates.find_one({"template_key": key}, {"_id": 0})
    is_system = key in TEMPLATES
    if not is_system and not o:
        raise HTTPException(status_code=404, detail="Unknown template")
    if action == "review":
        if not o or o.get("source") != "admin" or o.get("status") != "draft":
            raise HTTPException(status_code=400, detail="Only admin drafts can move to Review")
        await db.responsibility_center_templates.update_one(
            {"template_key": key}, {"$set": {"status": "review", "updated_at": _iso()}})
        await _tpl_audit(user, key, "review", reason)
        return {"ok": True, "status": "review"}
    if action == "publish":
        if not reason:
            raise HTTPException(status_code=400, detail="A change summary is required to publish")
        if is_system and not (o and o.get("source") == "admin"):
            await db.responsibility_center_templates.update_one(
                {"template_key": key},
                {"$set": {"source": "system_override", "status": "published", "updated_at": _iso()},
                 "$setOnInsert": {"template_key": key, "created_at": _iso()}}, upsert=True)
            await _tpl_audit(user, key, "published", reason, TEMPLATES[key]["version"])
            return {"ok": True, "status": "published"}
        errors = _validate_template(o)
        if errors:
            raise HTTPException(status_code=400, detail="; ".join(errors[:4]))
        new_v = int(o.get("version") or 0) + 1
        snapshot = {k: o.get(k) for k in _EDITABLE}
        # publishing never alters existing Centers — they keep their applied version
        await db.responsibility_center_templates.update_one(
            {"template_key": key},
            {"$set": {"status": "published", "version": new_v, "updated_at": _iso()},
             "$push": {"versions": {"version": new_v, "change_summary": reason[:300],
                                    "snapshot": snapshot, "published_by": user.get("username"),
                                    "published_at": _iso()}}})
        await _tpl_audit(user, key, "published", reason, new_v)
        return {"ok": True, "status": "published", "version": new_v}
    if action in ("disable", "archive"):
        if not reason:
            raise HTTPException(status_code=400, detail="A reason is required")
        status = "disabled" if action == "disable" else "archived"
        await db.responsibility_center_templates.update_one(
            {"template_key": key},
            {"$set": {"status": status, "updated_at": _iso()},
             "$setOnInsert": {"template_key": key,
                              "source": "admin" if (o and o.get("source") == "admin") else "system_override",
                              "created_at": _iso()}},
            upsert=True)
        await _tpl_audit(user, key, status, reason)
        return {"ok": True, "status": status}
    raise HTTPException(status_code=400, detail="Unknown action")


async def admin_duplicate_template(user: dict, key: str) -> dict:
    o = await db.responsibility_center_templates.find_one({"template_key": key}, {"_id": 0})
    src = o if (o and o.get("source") == "admin") else TEMPLATES.get(key)
    if not src:
        raise HTTPException(status_code=404, detail="Unknown template")
    body = {k: src.get(k) for k in _EDITABLE}
    body["name"] = f"{src.get('name')} (copy)"[:60]
    r = await admin_create_template(user, body)
    await _tpl_audit(user, r["template_key"], "duplicated", f"Duplicated from {key}")
    return r
