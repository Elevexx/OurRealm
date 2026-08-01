"""RC Phase 5 — Automation Builder + Universal Template Library + Course Sharing.

Automations run only safe actions automatically (notifications, calendar,
reminders, drafts). Resource actions (Fire Power awards) queue as pending
approvals — nothing destructive without a manager tap.

Collections: rc_automations, rc_automation_runs, rc_templates_user, rc_course_shares.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from services.rc_units import _ctx
from services import responsibility_center as rc

log = logging.getLogger("ourrealm.rc.autos")
router = APIRouter(prefix="/api/responsibility-center", tags=["rc-automations"])

TRIGGERS = {"lesson_completed", "checkpoint_approved", "task_overdue", "birthday", "member_joined"}
ACTIONS = {"notify_member", "notify_manager", "award_fire_power", "create_reminder",
           "create_calendar_event", "generate_report_draft", "unlock_next_lesson",
           "generate_greeting", "suggest_reassignment"}
TEMPLATE_KINDS = {"course", "task", "calendar", "group", "automation", "report", "center_layout", "generic"}


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _manage(perms: set) -> bool:
    return "edit_center" in perms or "assign_items" in perms


async def _require_manager(center_id: str, current: dict):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    if not _manage(perms):
        raise HTTPException(status_code=403, detail="Managers only")
    return center, membership, perms


async def _manager_ids(center_id: str) -> list:
    return await db.responsibility_center_memberships.distinct(
        "user_id", {"center_id": center_id, "status": "active",
                    "role": {"$in": ["owner", "admin", "manager"]}})


async def _notify(recipient_ids, kind, payload, actor="ORAi"):
    docs = [{"id": uuid.uuid4().hex, "recipient_id": uid, "kind": kind,
             "actor_username": actor, "payload": payload, "created_at": _iso(), "seen": False}
            for uid in recipient_ids]
    if docs:
        await db.notifications.insert_many(docs)
    return len(docs)


# ── Automation engine ───────────────────────────────────────────────────
async def fire_trigger(center_id: str, trigger_type: str, ctx: dict):
    """Run every enabled automation matching this trigger. Safe actions run
    immediately; resource actions are queued pending manager approval."""
    autos = await db.rc_automations.find(
        {"center_id": center_id, "enabled": True, "trigger.type": trigger_type}, {"_id": 0}).to_list(50)
    if not autos:
        return []
    center = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0, "name": 1})
    runs = []
    for a in autos:
        executed, pending = [], []
        for act in a.get("actions", []):
            atype = act.get("type")
            try:
                if atype == "notify_member" and ctx.get("user_id"):
                    await _notify([ctx["user_id"]], "rc_automation",
                                  {"center_id": center_id, "center_name": center["name"],
                                   "title": a["name"], "body": act.get("message") or f"Automation \"{a['name']}\" ran for you.",
                                   "trigger": trigger_type, **{k: v for k, v in ctx.items() if k in ("lesson_title", "item_title")}})
                    executed.append({"type": atype})
                elif atype == "notify_manager":
                    await _notify(await _manager_ids(center_id), "rc_automation",
                                  {"center_id": center_id, "center_name": center["name"],
                                   "title": a["name"], "body": act.get("message") or f"Trigger: {trigger_type.replace('_', ' ')}"
                                   + (f" — @{ctx.get('username')}" if ctx.get("username") else ""), "trigger": trigger_type})
                    executed.append({"type": atype})
                elif atype == "award_fire_power":
                    pending.append({"type": atype, "amount": max(1, min(1000, int(act.get("amount") or 10))),
                                    "user_id": ctx.get("user_id"), "username": ctx.get("username")})
                elif atype == "create_reminder":
                    item = {"id": uuid.uuid4().hex, "center_id": center_id, "item_type": "task",
                            "title": (act.get("title") or f"Reminder — {trigger_type.replace('_', ' ')}")[:200],
                            "description": act.get("message") or "", "status": "open", "priority": "normal",
                            "visibility": "members", "created_by": "orai_automation",
                            "created_by_username": "ORAi", "assignee_ids": [ctx["user_id"]] if ctx.get("user_id") else [],
                            "reviewer_id": None, "approver_id": None, "approval_required": False,
                            "is_self_task": False, "parent_id": None, "depends_on": [], "start_at": None,
                            "due_at": (datetime.now(timezone.utc) + timedelta(days=int(act.get("due_in_days") or 2))).isoformat(),
                            "completed_at": None, "completed_by": None, "estimated_minutes": None,
                            "difficulty": None, "category": "reminder", "labels": ["automation"],
                            "progress_percent": 0, "progress_method": "manual", "checklist": [],
                            "attachments": [], "version": 1, "created_at": _iso(), "updated_at": _iso(),
                            "client_token": None}
                    await db.responsibility_items.insert_one({**item})
                    executed.append({"type": atype, "item_id": item["id"]})
                elif atype == "create_calendar_event":
                    ev_start = datetime.now(timezone.utc) + timedelta(days=int(act.get("start_in_days") or 1))
                    ev = {"id": uuid.uuid4().hex, "center_id": center_id, "unit_id": None,
                          "event_type": "general", "title": (act.get("title") or f"{a['name']} — follow-up")[:200],
                          "description": act.get("message") or "", "visibility": "members",
                          "created_by": "orai_automation", "created_by_username": "ORAi",
                          "organizer_id": None, "start_at": ev_start.isoformat(),
                          "end_at": (ev_start + timedelta(minutes=60)).isoformat(), "all_day": False,
                          "timezone": "UTC", "location": "", "virtual_link": "", "status": "scheduled",
                          "attendance_enabled": False, "reminders": [], "attendees": [],
                          "related_item_id": None, "version": 1, "created_at": _iso(),
                          "updated_at": _iso(), "canceled_at": None, "client_token": None}
                    await db.responsibility_center_calendar_events.insert_one({**ev})
                    executed.append({"type": atype, "event_id": ev["id"]})
                elif atype == "generate_report_draft":
                    await db.rc_orai_drafts.insert_one({
                        "id": uuid.uuid4().hex, "center_id": center_id, "kind": "report",
                        "instructions": f"Automation \"{a['name']}\" ({trigger_type})",
                        "content": {"title": f"{a['name']} report",
                                    "body": f"Auto-drafted after {trigger_type.replace('_', ' ')}"
                                            + (f" by @{ctx.get('username')}" if ctx.get("username") else "")
                                            + ". Edit or regenerate before sharing."},
                        "status": "draft", "created_by": "orai_automation",
                        "created_by_username": "ORAi", "created_at": _iso(), "updated_at": _iso()})
                    executed.append({"type": atype})
                elif atype == "unlock_next_lesson" and ctx.get("user_id"):
                    await _notify([ctx["user_id"]], "rc_automation",
                                  {"center_id": center_id, "center_name": center["name"],
                                   "title": "Next lesson ready",
                                   "body": f"Great work{' on ' + ctx['lesson_title'] if ctx.get('lesson_title') else ''}! Your next lesson is ready in the Course Player."})
                    executed.append({"type": atype})
                elif atype == "generate_greeting" and ctx.get("user_id"):
                    await _notify([ctx["user_id"]], "rc_automation",
                                  {"center_id": center_id, "center_name": center["name"],
                                   "title": act.get("title") or "A note from your Center 🎉",
                                   "body": act.get("message") or f"Happy day, @{ctx.get('username')}! Your Center is celebrating you today."})
                    executed.append({"type": atype})
                elif atype == "suggest_reassignment":
                    await _notify(await _manager_ids(center_id), "rc_automation",
                                  {"center_id": center_id, "center_name": center["name"],
                                   "title": "Reassignment suggested",
                                   "body": f"\"{ctx.get('item_title') or 'An item'}\" is overdue — consider reassigning it."})
                    executed.append({"type": atype})
            except Exception as e:  # keep other actions running
                log.warning("automation action %s failed: %s", atype, e)
        run = {"id": uuid.uuid4().hex, "center_id": center_id, "automation_id": a["id"],
               "automation_name": a["name"], "trigger": trigger_type,
               "context": {k: v for k, v in ctx.items() if k in ("username", "lesson_title", "item_title", "dedupe_key")},
               "executed": executed, "pending_actions": pending,
               "status": "pending_approval" if pending else "completed", "created_at": _iso()}
        await db.rc_automation_runs.insert_one({**run})
        await db.rc_automations.update_one({"id": a["id"]}, {"$inc": {"run_count": 1}, "$set": {"last_run_at": _iso()}})
        runs.append(run)
    return runs


# ── Automations CRUD ────────────────────────────────────────────────────
@router.get("/{center_id}/automations")
async def list_automations(center_id: str, current: CurrentUser):
    await _require_manager(center_id, current)
    rows = await db.rc_automations.find({"center_id": center_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"automations": rows, "triggers": sorted(TRIGGERS), "actions": sorted(ACTIONS)}


def _safe_int(v, default, lo, hi):
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def _clean_actions(actions) -> list:
    out = []
    for a in (actions or [])[:8]:
        if a.get("type") not in ACTIONS:
            continue
        out.append({"type": a["type"], "message": str(a.get("message") or "")[:500],
                    "title": str(a.get("title") or "")[:200],
                    "amount": _safe_int(a.get("amount"), 10, 1, 1000),
                    "due_in_days": _safe_int(a.get("due_in_days"), 2, 1, 60),
                    "start_in_days": _safe_int(a.get("start_in_days"), 1, 0, 60)})
    return out


@router.post("/{center_id}/automations")
async def create_automation(center_id: str, body: dict, current: CurrentUser):
    await _require_manager(center_id, current)
    trigger = (body.get("trigger") or {}).get("type")
    if trigger not in TRIGGERS:
        raise HTTPException(status_code=400, detail="Pick a valid trigger")
    actions = _clean_actions(body.get("actions"))
    if not actions:
        raise HTTPException(status_code=400, detail="Add at least one action")
    doc = {"id": uuid.uuid4().hex, "center_id": center_id,
           "name": str(body.get("name") or f"{trigger.replace('_', ' ').title()} automation")[:120],
           "enabled": bool(body.get("enabled", True)), "trigger": {"type": trigger},
           "actions": actions, "run_count": 0, "last_run_at": None,
           "created_by": current["id"], "created_at": _iso(), "updated_at": _iso()}
    await db.rc_automations.insert_one({**doc})
    await rc.log_activity(center_id, current, "automation_created",
                          f"@{current.get('username')} created the automation \"{doc['name']}\"")
    return {"automation": doc}


@router.patch("/{center_id}/automations/{auto_id}")
async def update_automation(center_id: str, auto_id: str, body: dict, current: CurrentUser):
    await _require_manager(center_id, current)
    patch = {"updated_at": _iso()}
    if "name" in body:
        patch["name"] = str(body["name"] or "")[:120]
    if "enabled" in body:
        patch["enabled"] = bool(body["enabled"])
    if "trigger" in body and (body["trigger"] or {}).get("type") in TRIGGERS:
        patch["trigger"] = {"type": body["trigger"]["type"]}
    if "actions" in body:
        acts = _clean_actions(body["actions"])
        if not acts:
            raise HTTPException(status_code=400, detail="Add at least one action")
        patch["actions"] = acts
    r = await db.rc_automations.update_one({"id": auto_id, "center_id": center_id}, {"$set": patch})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"automation": await db.rc_automations.find_one({"id": auto_id}, {"_id": 0})}


@router.delete("/{center_id}/automations/{auto_id}")
async def delete_automation(center_id: str, auto_id: str, current: CurrentUser):
    await _require_manager(center_id, current)
    r = await db.rc_automations.delete_one({"id": auto_id, "center_id": center_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"ok": True}


@router.get("/{center_id}/automations/runs")
async def automation_runs(center_id: str, current: CurrentUser):
    await _require_manager(center_id, current)
    rows = await db.rc_automation_runs.find({"center_id": center_id}, {"_id": 0}) \
        .sort("created_at", -1).to_list(50)
    return {"runs": rows}


@router.post("/{center_id}/automations/runs/{run_id}/approve")
async def approve_run(center_id: str, run_id: str, body: dict, current: CurrentUser):
    """Approve pending resource actions (Fire Power awards) on a run."""
    center, membership, perms = await _require_manager(center_id, current)
    run = await db.rc_automation_runs.find_one(
        {"id": run_id, "center_id": center_id, "status": "pending_approval"}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Pending run not found")
    if not bool(body.get("approve")):
        await db.rc_automation_runs.update_one({"id": run_id}, {"$set": {"status": "rejected", "decided_by": current["id"], "decided_at": _iso()}})
        return {"ok": True, "status": "rejected"}
    results = []
    for act in run.get("pending_actions", []):
        if act["type"] == "award_fire_power" and act.get("user_id"):
            amount = int(act.get("amount") or 10)
            r = await db.responsibility_centers.update_one(
                {"id": center_id, "vault_balance": {"$gte": amount}},
                {"$inc": {"vault_balance": -amount}})
            if not r.modified_count:
                results.append({"type": act["type"], "ok": False, "reason": "Vault balance too low"})
                continue
            await db.fire_wallets.update_one(
                {"user_id": act["user_id"]}, {"$inc": {"vault_balance": amount}}, upsert=True)
            await _notify([act["user_id"]], "rc_automation",
                          {"center_id": center_id, "title": "Fire Power awarded 🔥",
                           "body": f"You earned {amount} 🔥 from the \"{run['automation_name']}\" automation."},
                          actor=current.get("username"))
            await rc.log_activity(center_id, current, "automation_award_approved",
                                  f"@{current.get('username')} approved a {amount} 🔥 award to @{act.get('username')} (automation)")
            results.append({"type": act["type"], "ok": True, "amount": amount})
    await db.rc_automation_runs.update_one(
        {"id": run_id}, {"$set": {"status": "completed", "decided_by": current["id"],
                                  "decided_at": _iso(), "approval_results": results}})
    return {"ok": True, "status": "completed", "results": results}


@router.post("/{center_id}/automations/run-check")
async def run_check(center_id: str, current: CurrentUser):
    """Evaluate time-based triggers now (task_overdue, birthday). Deduped daily."""
    await _require_manager(center_id, current)
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    fired = []

    overdue_items = await db.responsibility_items.find(
        {"center_id": center_id, "due_at": {"$lt": now.isoformat(), "$ne": None},
         "status": {"$nin": ["completed", "approved", "canceled", "archived", "declined"]}},
        {"_id": 0, "id": 1, "title": 1, "assignee_ids": 1}).to_list(50)
    for it in overdue_items:
        key = f"task_overdue:{it['id']}:{today}"
        if await db.rc_automation_runs.find_one({"center_id": center_id, "context.dedupe_key": key}):
            continue
        uid = (it.get("assignee_ids") or [None])[0]
        uname = None
        if uid:
            u = await db.users.find_one({"id": uid}, {"username": 1})
            uname = (u or {}).get("username")
        fired += await fire_trigger(center_id, "task_overdue",
                                    {"user_id": uid, "username": uname,
                                     "item_title": it["title"], "dedupe_key": key})

    ms = await db.responsibility_center_memberships.find(
        {"center_id": center_id, "status": "active", "birthday": {"$exists": True, "$ne": None}},
        {"_id": 0, "user_id": 1, "birthday": 1}).to_list(200)
    mmdd = now.strftime("%m-%d")
    for m in ms:
        if str(m["birthday"])[-5:] == mmdd:
            key = f"birthday:{m['user_id']}:{today}"
            if await db.rc_automation_runs.find_one({"center_id": center_id, "context.dedupe_key": key}):
                continue
            u = await db.users.find_one({"id": m["user_id"]}, {"username": 1})
            fired += await fire_trigger(center_id, "birthday",
                                        {"user_id": m["user_id"], "username": (u or {}).get("username"),
                                         "dedupe_key": key})
    return {"fired": len(fired), "runs": fired}


# ── Universal Template Library ──────────────────────────────────────────
async def _snapshot(center_id: str, kind: str, source_id: str, payload: dict) -> dict:
    if kind == "course" and source_id:
        course = await db.rc_courses.find_one({"id": source_id, "center_id": center_id}, {"_id": 0})
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        lessons = await db.rc_course_lessons.find({"course_id": source_id}, {"_id": 0}).to_list(300)
        return {"course": course, "lessons": lessons}
    if kind == "automation" and source_id:
        auto = await db.rc_automations.find_one({"id": source_id, "center_id": center_id}, {"_id": 0})
        if not auto:
            raise HTTPException(status_code=404, detail="Automation not found")
        return {"automation": auto}
    if kind == "task" and source_id:
        item = await db.responsibility_items.find_one({"id": source_id, "center_id": center_id}, {"_id": 0})
        if not item:
            raise HTTPException(status_code=404, detail="Item not found")
        return {"task": item}
    if kind == "calendar":
        evs = await db.responsibility_center_calendar_events.find(
            {"center_id": center_id, "status": {"$ne": "canceled"}}, {"_id": 0}).sort("start_at", -1).to_list(50)
        return {"events": evs}
    return payload or {}


@router.get("/{center_id}/templates")
async def list_templates(center_id: str, current: CurrentUser, include_archived: bool = False):
    await _require_manager(center_id, current)
    q = {"center_id": center_id}
    if not include_archived:
        q["status"] = "active"
    rows = await db.rc_templates_user.find(q, {"_id": 0, "payload": 0}).sort("updated_at", -1).to_list(100)
    return {"templates": rows, "kinds": sorted(TEMPLATE_KINDS)}


@router.post("/{center_id}/templates")
async def save_template(center_id: str, body: dict, current: CurrentUser):
    await _require_manager(center_id, current)
    kind = body.get("kind") if body.get("kind") in TEMPLATE_KINDS else "generic"
    payload = await _snapshot(center_id, kind, body.get("source_id"), body.get("payload"))
    doc = {"id": uuid.uuid4().hex, "center_id": center_id, "owner_id": current["id"],
           "owner_username": current.get("username"),
           "name": str(body.get("name") or f"My {kind} template")[:150], "kind": kind,
           "description": str(body.get("description") or "")[:500],
           "payload": payload, "status": "active", "version": 1,
           "created_at": _iso(), "updated_at": _iso()}
    await db.rc_templates_user.insert_one({**doc})
    await rc.log_activity(center_id, current, "template_saved",
                          f"@{current.get('username')} saved the {kind} template \"{doc['name']}\"")
    doc.pop("payload")
    return {"template": doc}


@router.get("/{center_id}/templates/{template_id}")
async def preview_template(center_id: str, template_id: str, current: CurrentUser):
    await _require_manager(center_id, current)
    t = await db.rc_templates_user.find_one({"id": template_id, "center_id": center_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"template": t}


@router.patch("/{center_id}/templates/{template_id}")
async def update_template(center_id: str, template_id: str, body: dict, current: CurrentUser):
    await _require_manager(center_id, current)
    patch = {"updated_at": _iso()}
    if "name" in body:
        patch["name"] = str(body["name"] or "")[:150]
    if "description" in body:
        patch["description"] = str(body["description"] or "")[:500]
    if body.get("status") in ("active", "archived"):
        patch["status"] = body["status"]
    if "payload" in body and isinstance(body["payload"], dict):
        patch["payload"] = body["payload"]
    r = await db.rc_templates_user.update_one(
        {"id": template_id, "center_id": center_id}, {"$set": patch, "$inc": {"version": 1}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Template not found")
    t = await db.rc_templates_user.find_one({"id": template_id}, {"_id": 0, "payload": 0})
    return {"template": t}


@router.delete("/{center_id}/templates/{template_id}")
async def delete_template(center_id: str, template_id: str, current: CurrentUser):
    await _require_manager(center_id, current)
    r = await db.rc_templates_user.delete_one({"id": template_id, "center_id": center_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"ok": True}


@router.post("/{center_id}/templates/{template_id}/duplicate")
async def duplicate_template(center_id: str, template_id: str, current: CurrentUser):
    await _require_manager(center_id, current)
    t = await db.rc_templates_user.find_one({"id": template_id, "center_id": center_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    t.update({"id": uuid.uuid4().hex, "name": f"{t['name']} (copy)"[:150], "version": 1,
              "created_at": _iso(), "updated_at": _iso()})
    await db.rc_templates_user.insert_one({**t})
    t.pop("payload")
    return {"template": t}


@router.get("/{center_id}/templates/{template_id}/export")
async def export_template(center_id: str, template_id: str, current: CurrentUser):
    await _require_manager(center_id, current)
    t = await db.rc_templates_user.find_one({"id": template_id, "center_id": center_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"exported_at": _iso(), "format": "ourrealm.rc.template.v1", "template": t}


@router.post("/{center_id}/templates/import")
async def import_template(center_id: str, body: dict, current: CurrentUser):
    await _require_manager(center_id, current)
    t = (body.get("template") or {})
    kind = t.get("kind") if t.get("kind") in TEMPLATE_KINDS else "generic"
    doc = {"id": uuid.uuid4().hex, "center_id": center_id, "owner_id": current["id"],
           "owner_username": current.get("username"),
           "name": str(t.get("name") or "Imported template")[:150], "kind": kind,
           "description": str(t.get("description") or "")[:500],
           "payload": t.get("payload") or {}, "status": "active", "version": 1,
           "created_at": _iso(), "updated_at": _iso()}
    await db.rc_templates_user.insert_one({**doc})
    doc.pop("payload")
    return {"template": doc}


@router.post("/{center_id}/templates/{template_id}/install")
async def install_template(center_id: str, template_id: str, current: CurrentUser):
    center, membership, perms = await _require_manager(center_id, current)
    t = await db.rc_templates_user.find_one({"id": template_id, "center_id": center_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    p, kind = t.get("payload") or {}, t["kind"]
    created = {}
    if kind == "course" and p.get("course"):
        new_id = uuid.uuid4().hex
        course = {**p["course"], "id": new_id, "center_id": center_id, "status": "draft",
                  "published_at": None, "created_by": current["id"],
                  "created_at": _iso(), "updated_at": _iso()}
        id_map = {}
        new_lessons = []
        for les in p.get("lessons", []):
            nl = {**les, "id": uuid.uuid4().hex, "course_id": new_id, "center_id": center_id,
                  "created_at": _iso(), "updated_at": _iso()}
            id_map[les["id"]] = nl["id"]
            new_lessons.append(nl)
        course["modules"] = [{**m, "lesson_ids": [id_map.get(x) for x in m.get("lesson_ids", []) if id_map.get(x)]}
                             for m in course.get("modules", [])]
        await db.rc_courses.insert_one({**course})
        if new_lessons:
            await db.rc_course_lessons.insert_many([{**d} for d in new_lessons])
        created = {"type": "course", "id": new_id}
    elif kind == "automation" and p.get("automation"):
        auto = {**p["automation"], "id": uuid.uuid4().hex, "center_id": center_id,
                "enabled": False, "run_count": 0, "last_run_at": None,
                "created_by": current["id"], "created_at": _iso(), "updated_at": _iso()}
        await db.rc_automations.insert_one({**auto})
        created = {"type": "automation", "id": auto["id"]}
    elif kind == "task" and p.get("task"):
        from services import rc_items
        src = p["task"]
        item = await rc_items.create_item(current, center_id, {
            "item_type": src.get("item_type") or "task", "title": src.get("title") or "Template task",
            "description": src.get("description") or "", "priority": src.get("priority") or "normal",
            "category": src.get("category") or "general"})
        created = {"type": "item"}
    else:
        created = {"type": kind, "payload_keys": list(p.keys())}
    await rc.log_activity(center_id, current, "template_installed",
                          f"@{current.get('username')} installed the template \"{t['name']}\"")
    return {"ok": True, "created": created}
