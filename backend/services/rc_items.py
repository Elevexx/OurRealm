"""Responsibility Center — universal Responsibilities & Tasks engine (Bundle C).

One engine for every Center type. Center-scoped, permission-enforced,
server-side status transitions, immutable approval history, activity
trail, optimistic-concurrency versioning, member self-tasks, recurring
series, subtasks (2 levels) and dependencies (cycle-safe). Attachments
reuse the existing media pipeline (durable URLs only).

Collections (additive): responsibility_items (checklist + attachments
embedded), responsibility_item_comments, responsibility_item_approvals,
responsibility_item_activity, responsibility_item_reminders.
"""
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core.db import db
from services import responsibility_center as rc
from services.rc_media import durable

log = logging.getLogger("ourrealm.rc.items")

ITEM_TYPES = ["responsibility", "task", "goal", "milestone"]
PRIORITIES = ["low", "normal", "high", "urgent"]
PRIORITY_RANK = {"low": 0, "normal": 1, "high": 2, "urgent": 3}
VISIBILITIES = ["center", "assigned", "managers"]
STATUSES = ["draft", "assigned", "accepted", "declined", "in_progress", "waiting",
            "blocked", "submitted", "pending_approval", "changes_requested",
            "approved", "completed", "canceled", "archived"]
ACTIVE_STATUSES = ["assigned", "accepted", "in_progress", "waiting", "blocked",
                   "submitted", "pending_approval", "changes_requested"]
DONE_STATUSES = ["approved", "completed"]
PROGRESS_METHODS = ["manual", "checklist", "subtasks", "status"]

# Self-task defaults per center type (template). None on the center doc
# means "use the template default"; owners can override in Settings.
SELF_TASK_TEMPLATE_DEFAULTS = {
    "family": True, "household": True,
    "business": False, "team": False, "organization": False,
    "community": False, "other": False,
}

# action -> (allowed_from, to, who) — who: assignee|manager|either
TRANSITIONS = {
    "assign":   (["draft", "declined"], "assigned", "manager"),
    "accept":   (["assigned"], "accepted", "assignee"),
    "decline":  (["assigned"], "declined", "assignee"),
    "start":    (["assigned", "accepted", "changes_requested", "waiting", "blocked"], "in_progress", "either"),
    "wait":     (["in_progress"], "waiting", "either"),
    "block":    (["in_progress", "accepted", "assigned"], "blocked", "either"),
    "unblock":  (["blocked"], "in_progress", "either"),
    "submit":   (["in_progress", "accepted", "assigned", "changes_requested"], "submitted", "assignee"),
    "complete": (["in_progress", "accepted", "assigned", "submitted", "approved"], "completed", "either"),
    "cancel":   (ACTIVE_STATUSES + ["draft"], "canceled", "manager"),
    "archive":  (STATUSES, "archived", "manager"),
    "reopen":   (["completed", "canceled", "declined"], "in_progress", "manager"),
}
MAX_TITLE, MAX_DESC, MAX_COMMENT, MAX_CHECK = 140, 3000, 2000, 60
_IDX = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_item_indexes():
    global _IDX
    if _IDX:
        return
    try:
        await db.responsibility_items.create_index([("center_id", 1), ("status", 1), ("due_at", 1)], name="c_s_due")
        await db.responsibility_items.create_index([("center_id", 1), ("assignee_ids", 1), ("status", 1)], name="c_a_s")
        await db.responsibility_items.create_index(
            [("center_id", 1), ("created_by", 1), ("client_token", 1)],
            unique=True, name="uniq_client_token",
            partialFilterExpression={"client_token": {"$exists": True}})
        await db.responsibility_items.create_index(
            [("series_id", 1), ("occurrence_key", 1)], unique=True,
            name="uniq_occurrence",
            partialFilterExpression={"series_id": {"$exists": True}})
        await db.responsibility_item_comments.create_index([("item_id", 1), ("created_at", -1)], name="i_time")
        await db.responsibility_item_activity.create_index([("item_id", 1), ("created_at", -1)], name="i_time")
        await db.responsibility_item_approvals.create_index([("item_id", 1), ("created_at", -1)], name="i_time")
        await db.responsibility_item_reminders.create_index([("dedup_key", 1)], unique=True, name="uniq_dedup")
    except Exception as e:  # noqa: BLE001
        log.warning(f"[rc-items] index issue: {e}")
    _IDX = True


def self_tasks_allowed(center: dict) -> bool:
    override = center.get("allow_member_self_tasks")
    if override is not None:
        return bool(override)
    return SELF_TASK_TEMPLATE_DEFAULTS.get(center.get("center_type") or "other", False)


async def _ctx(center_id: str, user: dict):
    """Center + active membership + effective perms. Paused/removed blocked.
    Plain members gain `create_self_tasks` when the Center allows it."""
    center, membership = await rc._center_and_membership(center_id, user["id"])
    if not membership or membership.get("status") != "active":
        raise HTTPException(status_code=403, detail="You are not an active member of this Center")
    perms = set(rc.ROLE_PERMISSIONS.get(membership.get("role") or "member", set()))
    if "create_items" not in perms and self_tasks_allowed(center):
        perms.add("create_self_tasks")
    return center, membership, perms


async def _log(center_id: str, item_id: str, actor: dict, action: str, meta: Optional[dict] = None):
    await db.responsibility_item_activity.insert_one({
        "id": uuid.uuid4().hex, "center_id": center_id, "item_id": item_id,
        "actor_id": actor["id"], "actor_username": actor.get("username"),
        "action": action, "meta": meta or {}, "created_at": _now()})


async def _get_item(center_id: str, item_id: str) -> dict:
    item = await db.responsibility_items.find_one(
        {"id": item_id, "center_id": center_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


def _can_see(item: dict, user_id: str, perms: set) -> bool:
    vis = item.get("visibility") or "center"
    involved = (user_id in (item.get("assignee_ids") or [])
                or user_id in (item.get("created_by"), item.get("reviewer_id"), item.get("approver_id")))
    if vis == "center":
        return "view_items" in perms or involved
    if vis == "assigned":
        return involved or "view_private_items" in perms
    if vis == "managers":
        return "view_private_items" in perms or involved
    return False


def _is_overdue(item: dict) -> bool:
    due = item.get("due_at")
    if not due or item["status"] in DONE_STATUSES + ["canceled", "archived"]:
        return False
    try:
        return datetime.fromisoformat(due) < datetime.now(timezone.utc)
    except (ValueError, TypeError):
        return False


def _progress(item: dict, subtask_stats: Optional[tuple] = None) -> int:
    if item["status"] in DONE_STATUSES:
        return 100
    method = item.get("progress_method") or "manual"
    checklist = item.get("checklist") or []
    if method == "checklist" and checklist:
        return int(100 * sum(1 for c in checklist if c.get("completed")) / len(checklist))
    if method == "subtasks" and subtask_stats and subtask_stats[1]:
        return int(100 * subtask_stats[0] / subtask_stats[1])
    if method == "status":
        return {"draft": 0, "assigned": 0, "accepted": 10, "declined": 0,
                "in_progress": 50, "waiting": 50, "blocked": 50, "submitted": 90,
                "pending_approval": 90, "changes_requested": 60,
                "canceled": 0, "archived": 0}.get(item["status"], 0)
    return max(0, min(100, int(item.get("progress_percent") or 0)))


def _public(item: dict, subtask_stats: Optional[tuple] = None) -> dict:
    return {**item, "overdue": _is_overdue(item), "progress": _progress(item, subtask_stats)}


async def _subtask_stats(item_id: str) -> tuple:
    total = await db.responsibility_items.count_documents(
        {"parent_id": item_id, "status": {"$nin": ["canceled", "archived"]}})
    done = await db.responsibility_items.count_documents(
        {"parent_id": item_id, "status": {"$in": DONE_STATUSES}})
    return done, total


async def _validate_members(center_id: str, ids: list) -> None:
    for uid in set(filter(None, ids)):
        m = await db.responsibility_center_memberships.find_one(
            {"center_id": center_id, "user_id": uid, "status": "active"}, {"_id": 0, "user_id": 1})
        if not m:
            raise HTTPException(status_code=400,
                                detail="Assignees, reviewers, and approvers must be active members of this Center")


def _validate_dates(start_at, due_at):
    for v in (start_at, due_at):
        if v:
            try:
                datetime.fromisoformat(v)
            except (ValueError, TypeError):
                raise HTTPException(status_code=400, detail="Invalid date format")
    if start_at and due_at and due_at < start_at:
        raise HTTPException(status_code=400, detail="Due date cannot precede the start date")


async def _validate_dependencies(center_id: str, item_id: Optional[str], depends_on: list) -> list:
    """Deps must exist in this Center, not be series, and never form a cycle."""
    deps = list(dict.fromkeys(filter(None, depends_on or [])))[:10]
    if item_id and item_id in deps:
        raise HTTPException(status_code=400, detail="An item cannot depend on itself")
    for dep_id in deps:
        d = await db.responsibility_items.find_one(
            {"id": dep_id, "center_id": center_id, "is_series": {"$ne": True}}, {"_id": 0, "id": 1})
        if not d:
            raise HTTPException(status_code=400, detail="Dependency item not found in this Center")
    if item_id and deps:
        # BFS from each dep — reaching item_id means a cycle.
        seen, frontier = set(deps), list(deps)
        while frontier:
            batch = frontier[:50]
            frontier = frontier[50:]
            async for row in db.responsibility_items.find(
                    {"id": {"$in": batch}}, {"_id": 0, "depends_on": 1}):
                for nxt in (row.get("depends_on") or []):
                    if nxt == item_id:
                        raise HTTPException(status_code=400, detail="This dependency would create a cycle")
                    if nxt not in seen:
                        seen.add(nxt)
                        frontier.append(nxt)
    return deps


def item_notify_title(item: dict) -> str:
    """Never leak private item titles into notification previews."""
    if (item.get("visibility") or "center") == "center":
        return f"\"{item['title']}\""
    return "a private item"


async def _notify_item(uid: str, kind: str, message: str, center_id: str, item_id: str,
                       actor: Optional[dict] = None):
    await rc.notify_user(uid, kind, message,
                         f"/responsibility-center/{center_id}?tab=work&item={item_id}",
                         center_id, None, (actor or {}).get("username"))


def _build_checklist(entries) -> list:
    return [{"id": uuid.uuid4().hex, "title": str(c)[:MAX_CHECK].strip(), "completed": False,
             "completed_by": None, "completed_at": None}
            for c in (entries or [])[:30] if str(c).strip()]


# ── Create / edit ────────────────────────────────────────────────────────
async def create_item(user: dict, center_id: str, body: dict) -> dict:
    await ensure_item_indexes()
    center, membership, perms = await _ctx(center_id, user)
    is_manager_create = "create_items" in perms
    is_self_task = False
    if not is_manager_create:
        if "create_self_tasks" not in perms:
            raise HTTPException(status_code=403, detail="You don't have permission to create items")
        is_self_task = True
    title = (body.get("title") or "").strip()
    if not title or len(title) > MAX_TITLE:
        raise HTTPException(status_code=400, detail=f"Title is required (max {MAX_TITLE} characters)")
    desc = (body.get("description") or "").strip()[:MAX_DESC]
    item_type = body.get("item_type") or "task"
    if item_type not in ITEM_TYPES:
        raise HTTPException(status_code=400, detail="Invalid item type")
    priority = body.get("priority") or "normal"
    if priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid priority")
    visibility = body.get("visibility") or ("assigned" if is_self_task else "center")
    if visibility not in VISIBILITIES:
        raise HTTPException(status_code=400, detail="Invalid visibility")

    if is_self_task:
        # Safe restrictions: task only, self-assigned, no reviewer/approver,
        # no manager-only visibility, no approval requirement.
        if item_type != "task":
            raise HTTPException(status_code=403, detail="Members can create personal tasks only")
        if body.get("assignee_ids") and set(body["assignee_ids"]) - {user["id"]}:
            raise HTTPException(status_code=403, detail="A personal task can only be assigned to yourself")
        if body.get("reviewer_id") or body.get("approver_id") or body.get("approval_required"):
            raise HTTPException(status_code=403, detail="Personal tasks can't have reviewers or approvers")
        if visibility == "managers":
            raise HTTPException(status_code=403, detail="Personal tasks can't use manager-only visibility")
        assignees, reviewer, approver = [user["id"]], None, None
    else:
        assignees = list(dict.fromkeys(body.get("assignee_ids") or []))[:10]
        reviewer = body.get("reviewer_id")
        approver = body.get("approver_id")
        await _validate_members(center_id, assignees + [reviewer, approver])
        if approver:
            am = await db.responsibility_center_memberships.find_one(
                {"center_id": center_id, "user_id": approver, "status": "active"}, {"_id": 0, "role": 1})
            if "approve_items" not in rc.ROLE_PERMISSIONS.get(am.get("role"), set()):
                raise HTTPException(status_code=400, detail="The approver must have approval permission (manager or above)")
    _validate_dates(body.get("start_at"), body.get("due_at"))

    parent_id = body.get("parent_id")
    if parent_id:
        parent = await db.responsibility_items.find_one(
            {"id": parent_id, "center_id": center_id, "is_series": {"$ne": True}}, {"_id": 0, "parent_id": 1})
        if not parent:
            raise HTTPException(status_code=400, detail="Parent item not found")
        if parent.get("parent_id"):
            raise HTTPException(status_code=400, detail="Subtasks can only go two levels deep")
        if body.get("recurrence"):
            raise HTTPException(status_code=400, detail="Subtasks can't be recurring")
    depends_on = await _validate_dependencies(center_id, None, body.get("depends_on") or [])

    checklist = _build_checklist(body.get("checklist"))
    progress_method = body.get("progress_method") or ("checklist" if checklist else "manual")
    if progress_method not in PROGRESS_METHODS:
        raise HTTPException(status_code=400, detail="Invalid progress method")
    draft = bool(body.get("draft")) and not is_self_task
    if not assignees and not draft:
        assignees = [user["id"]]
    status = "draft" if draft else ("in_progress" if assignees == [user["id"]] else "assigned")
    now = _now()
    item = {
        "id": uuid.uuid4().hex, "center_id": center_id, "item_type": item_type,
        "title": title, "description": desc, "status": status,
        "priority": priority, "visibility": visibility,
        "created_by": user["id"], "created_by_username": user.get("username"),
        "assignee_ids": assignees, "reviewer_id": reviewer, "approver_id": approver,
        "approval_required": bool(body.get("approval_required")) and not is_self_task,
        "is_self_task": is_self_task,
        "parent_id": parent_id, "depends_on": depends_on,
        "start_at": body.get("start_at"), "due_at": body.get("due_at"),
        "completed_at": None, "completed_by": None,
        "estimated_minutes": max(0, int(body.get("estimated_minutes") or 0)),
        "difficulty": body.get("difficulty"),
        "category": (body.get("category") or "").strip()[:40] or None,
        "labels": [str(l).strip()[:30] for l in (body.get("labels") or [])[:8] if str(l).strip()],
        "progress_percent": 0, "progress_method": progress_method,
        "checklist": checklist, "attachments": [],
        "version": 1, "created_at": now, "updated_at": now,
    }
    if body.get("client_token"):
        item["client_token"] = str(body["client_token"])[:80]

    # Recurring? Create a series template instead of a single item.
    recurrence = body.get("recurrence")
    if recurrence and (recurrence.get("pattern") or "one_time") != "one_time":
        from services import rc_recurrence
        if is_self_task:
            recurrence = dict(recurrence)
        rec = rc_recurrence.validate_recurrence(recurrence, center)
        if not item["due_at"]:
            raise HTTPException(status_code=400, detail="A recurring item needs a first due date")
        item.update(is_series=True, series_status="active", recurrence=rec,
                    anchor_due_at=item["due_at"], next_due_at=item["due_at"],
                    occurrences_generated=0, status="series")
        try:
            await db.responsibility_items.insert_one({**item})
        except DuplicateKeyError:
            existing = await db.responsibility_items.find_one(
                {"center_id": center_id, "created_by": user["id"],
                 "client_token": item.get("client_token")}, {"_id": 0})
            if not existing:
                raise HTTPException(status_code=409, detail="Duplicate request — please retry")
            return _public(existing)
        await _log(center_id, item["id"], user, "created",
                   {"series": True, "pattern": rec["pattern"]})
        await rc.log_activity(center_id, user, "item_created",
                              f"@{user.get('username')} created a recurring {item_type} \"{title}\"")
        await rc_recurrence.generate_for_series(item, notify=True)
        fresh = await db.responsibility_items.find_one({"id": item["id"]}, {"_id": 0})
        return _public(fresh)

    try:
        await db.responsibility_items.insert_one({**item})
    except DuplicateKeyError:
        existing = await db.responsibility_items.find_one(
            {"center_id": center_id, "created_by": user["id"],
             "client_token": item.get("client_token")}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=409, detail="Duplicate request — please retry")
        return _public(existing)
    await _log(center_id, item["id"], user, "created",
               {"status": status, "self_task": is_self_task})
    created_label = "a personal task" if is_self_task else f'{item_type} "{title}"'
    await rc.log_activity(center_id, user, "item_created",
                          f"@{user.get('username')} created {created_label}")
    for uid in assignees:
        if uid != user["id"]:
            await _notify_item(uid, "responsibility_center_item_assigned",
                               f"You were assigned {item_notify_title(item)} in \"{center['name']}\".",
                               center_id, item["id"], user)
    return _public(item)


def _can_edit(item: dict, user_id: str, perms: set) -> bool:
    return "edit_any_item" in perms or item.get("created_by") == user_id


async def update_item(user: dict, center_id: str, item_id: str, body: dict) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    item = await _get_item(center_id, item_id)
    if not _can_edit(item, user["id"], perms):
        raise HTTPException(status_code=403, detail="You don't have permission to edit this item")
    # Optimistic concurrency — reject stale edits with a clear conflict.
    expected = body.get("expected_version")
    if expected is not None and int(expected) != int(item.get("version") or 1):
        raise HTTPException(status_code=409,
                            detail="This item was updated by someone else while you were editing. Refresh to review the latest version, then try again.")
    is_self = bool(item.get("is_self_task"))
    sets = {}
    if "title" in body:
        t = (body["title"] or "").strip()
        if not t or len(t) > MAX_TITLE:
            raise HTTPException(status_code=400, detail="Invalid title")
        sets["title"] = t
    if "description" in body:
        sets["description"] = (body["description"] or "").strip()[:MAX_DESC]
    for f, allowed in (("priority", PRIORITIES), ("visibility", VISIBILITIES)):
        if f in body:
            if body[f] not in allowed:
                raise HTTPException(status_code=400, detail=f"Invalid {f}")
            if f == "visibility" and is_self and body[f] == "managers":
                raise HTTPException(status_code=403, detail="Personal tasks can't use manager-only visibility")
            sets[f] = body[f]
    if "category" in body:
        sets["category"] = (body["category"] or "").strip()[:40] or None
    if "labels" in body:
        sets["labels"] = [str(l).strip()[:30] for l in (body["labels"] or [])[:8] if str(l).strip()]
    if "start_at" in body or "due_at" in body:
        start = body.get("start_at", item.get("start_at"))
        due = body.get("due_at", item.get("due_at"))
        _validate_dates(start, due)
        sets["start_at"], sets["due_at"] = start, due
    if "approval_required" in body:
        if is_self and body["approval_required"]:
            raise HTTPException(status_code=403, detail="Personal tasks can't require approval")
        sets["approval_required"] = bool(body["approval_required"])
    if "progress_method" in body:
        if body["progress_method"] not in PROGRESS_METHODS:
            raise HTTPException(status_code=400, detail="Invalid progress method")
        if not ("edit_any_item" in perms or item.get("created_by") == user["id"]):
            raise HTTPException(status_code=403, detail="Only a manager or the creator can change the progress method")
        sets["progress_method"] = body["progress_method"]
    if "depends_on" in body:
        sets["depends_on"] = await _validate_dependencies(center_id, item_id, body["depends_on"])
    if not sets:
        return _public(item)
    sets["updated_at"] = _now()
    res = await db.responsibility_items.update_one(
        {"id": item_id, "version": item.get("version") or 1},
        {"$set": sets, "$inc": {"version": 1}})
    if res.modified_count != 1:
        raise HTTPException(status_code=409,
                            detail="This item was updated by someone else while you were editing. Refresh to review the latest version, then try again.")
    await _log(center_id, item_id, user, "edited", {"fields": list(sets)})
    if "due_at" in sets and sets["due_at"] != item.get("due_at"):
        await _log(center_id, item_id, user, "due_changed",
                   {"from": item.get("due_at"), "to": sets["due_at"]})
        for uid in item.get("assignee_ids") or []:
            if uid != user["id"]:
                await _notify_item(uid, "responsibility_center_item_due_changed",
                                   f"The due date changed on {item_notify_title(item)}.",
                                   center_id, item_id, user)
    if "visibility" in sets and sets["visibility"] != item.get("visibility"):
        await _log(center_id, item_id, user, "visibility_changed",
                   {"from": item.get("visibility"), "to": sets["visibility"]})
    if "depends_on" in sets and sets["depends_on"] != (item.get("depends_on") or []):
        await _log(center_id, item_id, user, "dependencies_changed",
                   {"from": item.get("depends_on") or [], "to": sets["depends_on"]})
    return _public(await _get_item(center_id, item_id))


async def assign_item(user: dict, center_id: str, item_id: str, assignee_ids: list,
                      reviewer_id=None, approver_id=None) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    if "assign_items" not in perms:
        raise HTTPException(status_code=403, detail="You don't have permission to assign items")
    item = await _get_item(center_id, item_id)
    assignees = list(dict.fromkeys(assignee_ids or []))[:10]
    if not assignees:
        raise HTTPException(status_code=400, detail="At least one assignee is required")
    await _validate_members(center_id, assignees + [reviewer_id, approver_id])
    sets = {"assignee_ids": assignees, "updated_at": _now()}
    if item.get("is_self_task") and set(assignees) - {item["created_by"]}:
        # A manager broadening a personal task converts it into a Center assignment.
        sets["is_self_task"] = False
    if reviewer_id is not None:
        sets["reviewer_id"] = reviewer_id or None
    if approver_id is not None:
        sets["approver_id"] = approver_id or None
    if item["status"] in ("draft", "declined"):
        sets["status"] = "assigned"
    await db.responsibility_items.update_one({"id": item_id}, {"$set": sets, "$inc": {"version": 1}})
    await _log(center_id, item_id, user, "reassigned",
               {"from": item.get("assignee_ids"), "to": assignees})
    for uid in assignees:
        if uid not in (item.get("assignee_ids") or []) and uid != user["id"]:
            await _notify_item(uid, "responsibility_center_item_assigned",
                               f"You were assigned {item_notify_title(item)} in \"{center['name']}\".",
                               center_id, item_id, user)
    return _public(await _get_item(center_id, item_id))


# ── Status transitions (server-side validator) ──────────────────────────
async def transition(user: dict, center_id: str, item_id: str, action: str,
                     note: str = "") -> dict:
    center, membership, perms = await _ctx(center_id, user)
    if action not in TRANSITIONS:
        raise HTTPException(status_code=400, detail="Unknown action")
    allowed_from, to, who = TRANSITIONS[action]
    item = await _get_item(center_id, item_id)
    if item.get("is_series"):
        raise HTTPException(status_code=400, detail="Use the series controls for a recurring series")
    is_assignee = user["id"] in (item.get("assignee_ids") or [])
    is_creator_self = bool(item.get("is_self_task")) and item.get("created_by") == user["id"]
    is_manager = "edit_any_item" in perms or "assign_items" in perms
    if item.get("is_self_task") and action in ("cancel", "archive", "reopen") and is_creator_self:
        is_manager = True  # members fully manage their own personal tasks
    if who == "assignee" and not (is_assignee or is_manager):
        raise HTTPException(status_code=403, detail="Only the assignee can do this")
    if who == "manager" and not is_manager:
        raise HTTPException(status_code=403, detail="Only a manager can do this")
    if who == "either" and not (is_assignee or is_manager):
        raise HTTPException(status_code=403, detail="You are not involved in this item")
    # submit routes to approval when required
    target = to
    if action == "submit" and item.get("approval_required"):
        target = "pending_approval"
    if item["status"] == target:
        return _public(item)  # idempotent retry — already there
    if item["status"] not in allowed_from:
        raise HTTPException(status_code=409,
                            detail=f"Cannot {action} an item that is {item['status'].replace('_', ' ')}")
    if action == "complete" and item.get("approval_required") and item["status"] not in ("approved",):
        raise HTTPException(status_code=409, detail="This item requires approval — submit it for review instead")
    if target == "pending_approval":
        await db.responsibility_item_approvals.insert_one({
            "id": uuid.uuid4().hex, "center_id": center_id, "item_id": item_id,
            "cycle": (item.get("approval_cycle") or 0) + 1, "decision": None,
            "requested_by": user["id"], "requested_at": _now(),
            "approver_id": item.get("approver_id"), "decided_at": None,
            "note": None, "created_at": _now()})
    sets = {"status": target, "updated_at": _now()}
    if target == "pending_approval":
        sets["approval_cycle"] = (item.get("approval_cycle") or 0) + 1
    if target == "completed":
        sets.update(completed_at=_now(), completed_by=user["id"], progress_percent=100)
    guard = {"id": item_id, "status": item["status"]}
    res = await db.responsibility_items.update_one(guard, {"$set": sets, "$inc": {"version": 1}})
    if res.modified_count != 1:
        fresh = await _get_item(center_id, item_id)
        if fresh["status"] == target:
            return _public(fresh)  # concurrent identical action — idempotent
        raise HTTPException(status_code=409, detail="The item changed — refresh and try again")
    await _log(center_id, item_id, user, action, {"from": item["status"], "to": target, "note": (note or "")[:300]})
    targets = set(item.get("assignee_ids") or []) | {item.get("created_by")}
    if target == "pending_approval" and item.get("approver_id"):
        await _notify_item(item["approver_id"], "responsibility_center_approval_requested",
                           f"{item_notify_title(item).capitalize()} was submitted for your approval in \"{center['name']}\".",
                           center_id, item_id, user)
    elif target in ("completed", "declined", "blocked"):
        for uid in targets - {user["id"]}:
            if uid:
                await _notify_item(uid, f"responsibility_center_item_{target}",
                                   f"{item_notify_title(item).capitalize()} is now {target.replace('_', ' ')}.",
                                   center_id, item_id, user)
    return _public(await _get_item(center_id, item_id))


async def decide_approval(user: dict, center_id: str, item_id: str,
                          decision: str, note: str = "") -> dict:
    center, membership, perms = await _ctx(center_id, user)
    if decision not in ("approve", "request_changes", "reject"):
        raise HTTPException(status_code=400, detail="Invalid decision")
    item = await _get_item(center_id, item_id)
    is_named = item.get("approver_id") == user["id"]
    if not (is_named or ("approve_items" in perms and not item.get("approver_id"))):
        raise HTTPException(status_code=403, detail="You are not the approver for this item")
    cycle = item.get("approval_cycle") or 1
    if item["status"] != "pending_approval":
        # Idempotent retry: same decision already recorded this cycle → return item.
        prev = await db.responsibility_item_approvals.find_one(
            {"item_id": item_id, "cycle": cycle, "decision": decision,
             "decided_by": user["id"]}, {"_id": 0, "id": 1})
        if prev:
            return _public(item)
        raise HTTPException(status_code=409, detail="This item is not pending approval")
    if decision != "approve" and len((note or "").strip()) < 3:
        raise HTTPException(status_code=400, detail="A note is required when requesting changes or rejecting")
    to = {"approve": "approved", "request_changes": "changes_requested", "reject": "declined"}[decision]
    # Immutable decision: recorded once per cycle via conditional update. A
    # later correction creates a NEW cycle (resubmission), never a rewrite.
    upd = await db.responsibility_item_approvals.update_one(
        {"item_id": item_id, "cycle": cycle, "decision": None},
        {"$set": {"decision": decision, "note": (note or "")[:500],
                  "decided_by": user["id"], "decided_by_username": user.get("username"),
                  "decided_at": _now()}})
    if upd.modified_count != 1:
        raise HTTPException(status_code=409, detail="This approval was already decided")
    sets = {"status": to, "updated_at": _now()}
    if decision == "approve":
        sets.update(completed_at=_now(), completed_by=user["id"],
                    progress_percent=100, status="completed")
    await db.responsibility_items.update_one(
        {"id": item_id, "status": "pending_approval"}, {"$set": sets, "$inc": {"version": 1}})
    action_name = {"approve": "approved", "request_changes": "changes_requested", "reject": "rejected"}[decision]
    await _log(center_id, item_id, user, f"approval_{action_name}", {"note": (note or "")[:300], "cycle": cycle})
    for uid in set(item.get("assignee_ids") or []) - {user["id"]}:
        await _notify_item(uid, f"responsibility_center_approval_{decision}",
                           f"{item_notify_title(item).capitalize()}: {decision.replace('_', ' ')}"
                           + (f" — {note[:120]}" if note else "") + ".",
                           center_id, item_id, user)
    return _public(await _get_item(center_id, item_id))


# ── Checklist / progress / comments / attachments ───────────────────────
async def checklist_op(user: dict, center_id: str, item_id: str, op: str,
                       entry_id: Optional[str] = None, title: str = "",
                       completed: Optional[bool] = None) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    item = await _get_item(center_id, item_id)
    is_involved = user["id"] in (item.get("assignee_ids") or []) or _can_edit(item, user["id"], perms)
    if not is_involved:
        raise HTTPException(status_code=403, detail="Only assignees or managers can update the checklist")
    checklist = item.get("checklist") or []
    if op == "add":
        title = (title or "").strip()[:MAX_CHECK]
        if not title:
            raise HTTPException(status_code=400, detail="Checklist item title required")
        if len(checklist) >= 30:
            raise HTTPException(status_code=400, detail="Checklist limit reached (30)")
        checklist.append({"id": uuid.uuid4().hex, "title": title, "completed": False,
                          "completed_by": None, "completed_at": None})
    else:
        entry = next((c for c in checklist if c["id"] == entry_id), None)
        if not entry:
            raise HTTPException(status_code=404, detail="Checklist entry not found")
        if op in ("toggle", "set"):
            new_val = (not entry["completed"]) if op == "toggle" else bool(completed)
            if entry["completed"] == new_val:
                return _public(item)  # idempotent — duplicate request
            entry["completed"] = new_val
            entry["completed_by"] = user.get("username") if new_val else None
            entry["completed_at"] = _now() if new_val else None
        elif op == "delete":
            checklist = [c for c in checklist if c["id"] != entry_id]
        else:
            raise HTTPException(status_code=400, detail="Unknown checklist operation")
    await db.responsibility_items.update_one(
        {"id": item_id}, {"$set": {"checklist": checklist, "updated_at": _now()},
                          "$inc": {"version": 1}})
    await _log(center_id, item_id, user, "checklist_changed", {"op": op, "entry_id": entry_id})
    return _public(await _get_item(center_id, item_id))


async def set_progress(user: dict, center_id: str, item_id: str, percent: int) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    item = await _get_item(center_id, item_id)
    if not (user["id"] in (item.get("assignee_ids") or []) or _can_edit(item, user["id"], perms)):
        raise HTTPException(status_code=403, detail="Only assignees or managers can update progress")
    if (item.get("progress_method") or "manual") != "manual":
        raise HTTPException(status_code=409,
                            detail="Progress is tracked automatically for this item. A manager can switch it to manual tracking first.")
    percent = max(0, min(100, int(percent)))
    await db.responsibility_items.update_one(
        {"id": item_id}, {"$set": {"progress_percent": percent, "updated_at": _now()},
                          "$inc": {"version": 1}})
    await _log(center_id, item_id, user, "progress_changed", {"percent": percent})
    return _public(await _get_item(center_id, item_id))


MENTION_RE = re.compile(r"@([a-z0-9_.-]{2,32})", re.I)


async def add_comment(user: dict, center_id: str, item_id: str, body: str,
                      parent_id: Optional[str] = None) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    if "comment_items" not in perms:
        raise HTTPException(status_code=403, detail="You don't have permission to comment")
    item = await _get_item(center_id, item_id)
    if not _can_see(item, user["id"], perms):
        raise HTTPException(status_code=403, detail="You can't access this item")
    body = (body or "").strip()[:MAX_COMMENT]
    if not body:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    recent = await db.responsibility_item_comments.count_documents(
        {"author_id": user["id"],
         "created_at": {"$gte": datetime.now(timezone.utc).replace(second=0, microsecond=0).isoformat()}})
    if recent >= 15:
        raise HTTPException(status_code=429, detail="Slow down — too many comments")
    row = {"id": uuid.uuid4().hex, "center_id": center_id, "item_id": item_id,
           "author_id": user["id"], "author_username": user.get("username"),
           "body": body, "parent_id": parent_id, "edited_at": None,
           "deleted_at": None, "created_at": _now()}
    await db.responsibility_item_comments.insert_one({**row})
    await _log(center_id, item_id, user, "commented", {"comment_id": row["id"]})
    # Mentions — only active Center members; no user enumeration outside the Center.
    notified = set()
    for uname in list(dict.fromkeys(MENTION_RE.findall(body)))[:5]:
        target = await db.users.find_one({"username": uname.lower()}, {"_id": 0, "id": 1})
        if not target or target["id"] == user["id"]:
            continue
        m = await db.responsibility_center_memberships.find_one(
            {"center_id": center_id, "user_id": target["id"], "status": "active"}, {"_id": 0, "user_id": 1})
        if m:
            await _notify_item(target["id"], "responsibility_center_mention",
                               f"@{user.get('username')} mentioned you on {item_notify_title(item)}.",
                               center_id, item_id, user)
            await _log(center_id, item_id, user, "mentioned", {"user_id": target["id"]})
            notified.add(target["id"])
    for uid in set(item.get("assignee_ids") or []) | {item.get("created_by")}:
        if uid and uid != user["id"] and uid not in notified:
            await _notify_item(uid, "responsibility_center_item_comment",
                               f"@{user.get('username')} commented on {item_notify_title(item)}.",
                               center_id, item_id, user)
    return row


async def delete_comment(user: dict, center_id: str, item_id: str, comment_id: str) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    row = await db.responsibility_item_comments.find_one(
        {"id": comment_id, "item_id": item_id, "deleted_at": None}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Comment not found")
    if row["author_id"] != user["id"] and "moderate_comments" not in perms:
        raise HTTPException(status_code=403, detail="You can't delete this comment")
    await db.responsibility_item_comments.update_one(
        {"id": comment_id}, {"$set": {"deleted_at": _now()}})
    await _log(center_id, item_id, user, "comment_deleted", {"comment_id": comment_id})
    return {"ok": True}


async def add_attachment(user: dict, center_id: str, item_id: str, url: str,
                         name: str = "", attachment_type: str = "file") -> dict:
    center, membership, perms = await _ctx(center_id, user)
    item = await _get_item(center_id, item_id)
    if not (user["id"] in (item.get("assignee_ids") or []) or _can_edit(item, user["id"], perms)):
        raise HTTPException(status_code=403, detail="Only assignees or managers can attach evidence")
    if attachment_type == "link":
        if not str(url).startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="Invalid link")
    elif not durable(url):
        raise HTTPException(status_code=400, detail="Upload through the media pipeline first")
    att = {"id": uuid.uuid4().hex, "url": url, "name": (name or "")[:120],
           "type": attachment_type, "uploaded_by": user.get("username"),
           "uploaded_by_id": user["id"], "created_at": _now()}
    await db.responsibility_items.update_one(
        {"id": item_id}, {"$push": {"attachments": att},
                          "$set": {"updated_at": _now()}, "$inc": {"version": 1}})
    await _log(center_id, item_id, user, "attachment_added", {"attachment_id": att["id"]})
    return att


async def remove_attachment(user: dict, center_id: str, item_id: str, attachment_id: str) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    item = await _get_item(center_id, item_id)
    att = next((a for a in item.get("attachments") or [] if a["id"] == attachment_id), None)
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if att.get("uploaded_by_id") != user["id"] and not _can_edit(item, user["id"], perms):
        raise HTTPException(status_code=403, detail="You can't remove this attachment")
    await db.responsibility_items.update_one(
        {"id": item_id}, {"$pull": {"attachments": {"id": attachment_id}},
                          "$set": {"updated_at": _now()}, "$inc": {"version": 1}})
    await _log(center_id, item_id, user, "attachment_removed", {"attachment_id": attachment_id})
    return {"ok": True}


# ── Series controls ──────────────────────────────────────────────────────
async def update_series(user: dict, center_id: str, item_id: str, body: dict,
                        scope: str = "future") -> dict:
    """Edit a recurring series. scope=future updates the template (future
    occurrences); scope=series also updates currently open occurrences.
    Single occurrences are edited through the normal item PATCH."""
    center, membership, perms = await _ctx(center_id, user)
    series = await _get_item(center_id, item_id)
    if not series.get("is_series"):
        raise HTTPException(status_code=404, detail="This is not a recurring series")
    if not (_can_edit(series, user["id"], perms)
            or (series.get("is_self_task") and series.get("created_by") == user["id"])):
        raise HTTPException(status_code=403, detail="You don't have permission to edit this series")
    if scope not in ("future", "series"):
        raise HTTPException(status_code=400, detail="Invalid scope")
    sets = {}
    if "title" in body:
        t = (body["title"] or "").strip()
        if not t or len(t) > MAX_TITLE:
            raise HTTPException(status_code=400, detail="Invalid title")
        sets["title"] = t
    if "description" in body:
        sets["description"] = (body["description"] or "").strip()[:MAX_DESC]
    if "priority" in body:
        if body["priority"] not in PRIORITIES:
            raise HTTPException(status_code=400, detail="Invalid priority")
        sets["priority"] = body["priority"]
    if "recurrence" in body and body["recurrence"]:
        from services import rc_recurrence
        rec = rc_recurrence.validate_recurrence(body["recurrence"], center)
        sets["recurrence"] = rec
        anchor = body.get("anchor_due_at") or series.get("next_due_at") or series.get("anchor_due_at")
        sets["anchor_due_at"] = anchor
        sets["next_due_at"] = anchor
        sets["occurrences_generated"] = 0
        await _log(center_id, item_id, user, "recurrence_changed",
                   {"pattern": rec["pattern"]})
    if not sets:
        return _public(series)
    sets["updated_at"] = _now()
    await db.responsibility_items.update_one({"id": item_id}, {"$set": sets, "$inc": {"version": 1}})
    await _log(center_id, item_id, user, "edited", {"fields": list(sets), "scope": scope})
    if scope == "series":
        occ_sets = {k: v for k, v in sets.items() if k in ("title", "description", "priority")}
        if occ_sets:
            await db.responsibility_items.update_many(
                {"series_id": item_id, "status": {"$in": ACTIVE_STATUSES + ["draft"]}},
                {"$set": {**occ_sets, "updated_at": _now()}, "$inc": {"version": 1}})
    return _public(await _get_item(center_id, item_id))


async def series_action(user: dict, center_id: str, item_id: str, action: str) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    series = await _get_item(center_id, item_id)
    if not series.get("is_series"):
        raise HTTPException(status_code=404, detail="This is not a recurring series")
    if not (_can_edit(series, user["id"], perms)
            or (series.get("is_self_task") and series.get("created_by") == user["id"])):
        raise HTTPException(status_code=403, detail="You don't have permission to manage this series")
    target = {"pause": "paused", "resume": "active", "end": "ended", "archive": "archived"}.get(action)
    if not target:
        raise HTTPException(status_code=400, detail="Unknown series action")
    if series.get("series_status") == target:
        return _public(series)
    await db.responsibility_items.update_one(
        {"id": item_id}, {"$set": {"series_status": target, "updated_at": _now()},
                          "$inc": {"version": 1}})
    await _log(center_id, item_id, user, f"series_{action}", {})
    if action in ("pause", "end"):
        for uid in set(series.get("assignee_ids") or []) - {user["id"]}:
            await _notify_item(uid, f"responsibility_center_series_{target}",
                               f"The recurring series {item_notify_title(series)} was {target}.",
                               center_id, item_id, user)
    return _public(await _get_item(center_id, item_id))


# ── Reads ────────────────────────────────────────────────────────────────
async def list_items(user: dict, center_id: str, q: str = "", item_type: str = "",
                     status: str = "", scope: str = "", priority: str = "",
                     assignee: str = "", creator: str = "", recurring: str = "",
                     category: str = "", label: str = "", due_from: str = "",
                     due_to: str = "", sort: str = "due", page: int = 1,
                     limit: int = 25) -> dict:
    await ensure_item_indexes()
    center, membership, perms = await _ctx(center_id, user)
    query: dict = {"center_id": center_id}
    if scope == "series":
        query["is_series"] = True
    else:
        query["is_series"] = {"$ne": True}
    if item_type in ITEM_TYPES:
        query["item_type"] = item_type
    if scope != "series":
        if status == "active":
            query["status"] = {"$in": ACTIVE_STATUSES}
        elif status == "completed":
            query["status"] = {"$in": DONE_STATUSES}
        elif status in STATUSES:
            query["status"] = status
        else:
            query["status"] = {"$nin": ["archived", "canceled"]}
    if priority in PRIORITIES:
        query["priority"] = priority
    if assignee:
        query["assignee_ids"] = assignee
    if creator:
        query["created_by"] = creator
    if recurring == "yes":
        query["series_id"] = {"$ne": None}
    elif recurring == "no":
        query["series_id"] = None
    if category.strip():
        query["category"] = category.strip()
    if label.strip():
        query["labels"] = label.strip()
    now_iso = _now()
    if scope == "mine":
        query["assignee_ids"] = user["id"]
    elif scope == "created":
        query["created_by"] = user["id"]
    elif scope == "unassigned":
        query["assignee_ids"] = {"$size": 0}
    elif scope == "overdue":
        query["due_at"] = {"$lt": now_iso}
        query["status"] = {"$in": ACTIVE_STATUSES}
    elif scope == "due_today":
        end = datetime.now(timezone.utc).replace(hour=23, minute=59, second=59).isoformat()
        query["due_at"] = {"$lte": end, "$ne": None}
        query["status"] = {"$in": ACTIVE_STATUSES}
    elif scope == "pending_approval":
        query["status"] = "pending_approval"
    elif scope == "my_approvals":
        query["status"] = "pending_approval"
        if "approve_items" in perms:
            query["$or"] = [{"approver_id": user["id"]}, {"approver_id": None}]
        else:
            query["approver_id"] = user["id"]
    elif scope == "submitted_by_me":
        query["assignee_ids"] = user["id"]
        query["status"] = {"$in": ["submitted", "pending_approval"]}
    elif scope == "recently_completed":
        query["status"] = {"$in": DONE_STATUSES}
    if due_from or due_to:
        rng = dict(query.get("due_at") if isinstance(query.get("due_at"), dict) else {})
        if due_from:
            rng["$gte"] = due_from
        if due_to:
            rng["$lte"] = due_to
        rng["$ne"] = None
        query["due_at"] = rng
    if (q or "").strip():
        query["title"] = {"$regex": re.escape(q.strip()), "$options": "i"}
    if "view_private_items" not in perms:
        vis_or = [{"visibility": "center"},
                  {"assignee_ids": user["id"]}, {"created_by": user["id"]},
                  {"reviewer_id": user["id"]}, {"approver_id": user["id"]}]
        if "$or" in query:
            query["$and"] = [{"$or": query.pop("$or")}, {"$or": vis_or}]
        else:
            query["$or"] = vis_or
    sort_spec = {"due": [("due_at", 1), ("created_at", -1)],
                 "priority": [("priority", -1)],
                 "updated": [("updated_at", -1)], "created": [("created_at", -1)],
                 "progress": [("progress_percent", -1)],
                 "status": [("status", 1)], "assignee": [("assignee_ids", 1)],
                 "title": [("title", 1)]}.get(sort, [("due_at", 1), ("created_at", -1)])
    page, limit = max(1, int(page)), max(1, min(int(limit), 100))
    total = await db.responsibility_items.count_documents(query)
    rows = await db.responsibility_items.find(query, {"_id": 0}) \
        .sort(sort_spec).skip((page - 1) * limit).to_list(limit)
    if sort == "priority":
        rows.sort(key=lambda r: -PRIORITY_RANK.get(r.get("priority") or "normal", 1))
    users = await rc._users_map(list({u for r in rows for u in (r.get("assignee_ids") or [])}))
    out = []
    for r in rows:
        p = _public(r)
        p["assignees"] = [{"user_id": u, "username": (users.get(u) or {}).get("username")}
                          for u in (r.get("assignee_ids") or [])]
        out.append(p)
    return {"items": out, "total": total, "page": page, "limit": limit,
            "self_tasks_allowed": self_tasks_allowed(center),
            "can_create": "create_items" in perms,
            "can_create_self": "create_self_tasks" in perms or "create_items" in perms}


async def item_detail(user: dict, center_id: str, item_id: str) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    item = await _get_item(center_id, item_id)
    if not _can_see(item, user["id"], perms):
        raise HTTPException(status_code=403, detail="You can't access this item")
    comments = await db.responsibility_item_comments.find(
        {"item_id": item_id, "deleted_at": None}, {"_id": 0}).sort("created_at", 1).to_list(100)
    approvals = await db.responsibility_item_approvals.find(
        {"item_id": item_id}, {"_id": 0}).sort("created_at", 1).to_list(20)
    activity = await db.responsibility_item_activity.find(
        {"item_id": item_id}, {"_id": 0}).sort("created_at", -1).to_list(30)
    subtasks = await db.responsibility_items.find(
        {"parent_id": item_id, "status": {"$nin": ["canceled", "archived"]}},
        {"_id": 0}).sort("created_at", 1).to_list(30)
    dependencies = []
    if item.get("depends_on"):
        async for d in db.responsibility_items.find(
                {"id": {"$in": item["depends_on"]}},
                {"_id": 0, "id": 1, "title": 1, "status": 1}):
            dependencies.append(d)
    series = None
    if item.get("series_id"):
        series = await db.responsibility_items.find_one(
            {"id": item["series_id"]}, {"_id": 0, "id": 1, "recurrence": 1,
                                        "series_status": 1, "next_due_at": 1})
    ids = set(item.get("assignee_ids") or []) | {item.get("created_by"), item.get("approver_id"), item.get("reviewer_id")}
    users = await rc._users_map(list(filter(None, ids)))
    stats = (sum(1 for s in subtasks if s["status"] in DONE_STATUSES), len(subtasks))
    p = _public(item, stats)
    p["assignees"] = [{"user_id": u, "username": (users.get(u) or {}).get("username")}
                      for u in (item.get("assignee_ids") or [])]
    p["approver_username"] = (users.get(item.get("approver_id")) or {}).get("username")
    p["reviewer_username"] = (users.get(item.get("reviewer_id")) or {}).get("username")
    my = {"is_assignee": user["id"] in (item.get("assignee_ids") or []),
          "is_approver": item.get("approver_id") == user["id"] or ("approve_items" in perms and not item.get("approver_id")),
          "can_edit": _can_edit(item, user["id"], perms)
          or (item.get("is_self_task") and item.get("created_by") == user["id"]),
          "can_assign": "assign_items" in perms,
          "can_moderate": "moderate_comments" in perms}
    return {"item": p, "comments": comments, "approvals": approvals,
            "activity": activity, "subtasks": [_public(s) for s in subtasks],
            "dependencies": dependencies, "series": series, "me": my}


async def work_summary(user: dict, center_id: str) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    now_iso = _now()
    end_today = datetime.now(timezone.utc).replace(hour=23, minute=59, second=59).isoformat()
    base = {"center_id": center_id, "is_series": {"$ne": True}}
    C = db.responsibility_items
    my_appr = {"approver_id": user["id"]} if "approve_items" not in perms else \
        {"$or": [{"approver_id": user["id"]}, {"approver_id": None}]}
    return {
        "active_responsibilities": await C.count_documents({**base, "item_type": "responsibility", "status": {"$in": ACTIVE_STATUSES}}),
        "active_tasks": await C.count_documents({**base, "item_type": "task", "status": {"$in": ACTIVE_STATUSES}}),
        "assigned_to_me": await C.count_documents({**base, "assignee_ids": user["id"], "status": {"$in": ACTIVE_STATUSES}}),
        "created_by_me": await C.count_documents({**base, "created_by": user["id"], "status": {"$in": ACTIVE_STATUSES}}),
        "due_today": await C.count_documents({**base, "status": {"$in": ACTIVE_STATUSES}, "due_at": {"$lte": end_today, "$gte": now_iso[:10], "$ne": None}}),
        "overdue": await C.count_documents({**base, "status": {"$in": ACTIVE_STATUSES}, "due_at": {"$lt": now_iso, "$ne": None}}),
        "in_progress": await C.count_documents({**base, "status": "in_progress"}),
        "blocked": await C.count_documents({**base, "status": "blocked"}),
        "pending_approval": await C.count_documents({**base, "status": "pending_approval"}),
        "completed_total": await C.count_documents({**base, "status": {"$in": DONE_STATUSES}}),
        "my_pending_approvals": await C.count_documents({**base, "status": "pending_approval", **my_appr}),
        "self_tasks_allowed": self_tasks_allowed(center),
    }


async def my_work(user: dict) -> dict:
    """Cross-Center My Work. Only Centers where the user is active; only
    items the user is authorized to act on (assigned or their approvals)."""
    await ensure_item_indexes()
    memberships = await db.responsibility_center_memberships.find(
        {"user_id": user["id"], "status": "active"}, {"_id": 0, "center_id": 1, "role": 1}).to_list(100)
    if not memberships:
        return {"buckets": {}, "total": 0}
    center_ids = [m["center_id"] for m in memberships]
    centers = {}
    async for c in db.responsibility_centers.find(
            {"id": {"$in": center_ids}, "status": {"$nin": ["deleted", "archived"]}},
            {"_id": 0, "id": 1, "name": 1, "center_type": 1}):
        centers[c["id"]] = c
    live_ids = list(centers)
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    end_today = now.replace(hour=23, minute=59, second=59).isoformat()
    soon = (now.replace(hour=23, minute=59, second=59)).isoformat()[:10]
    from datetime import timedelta
    due_soon_end = (now + timedelta(hours=72)).isoformat()
    base = {"center_id": {"$in": live_ids}, "is_series": {"$ne": True},
            "assignee_ids": user["id"]}
    C = db.responsibility_items

    def _fmt(rows):
        out = []
        for r in rows:
            c = centers.get(r["center_id"]) or {}
            out.append({"id": r["id"], "center_id": r["center_id"],
                        "center_name": c.get("name"), "center_type": c.get("center_type"),
                        "title": r["title"], "item_type": r["item_type"],
                        "priority": r["priority"], "status": r["status"],
                        "due_at": r.get("due_at"), "overdue": _is_overdue(r),
                        "progress": _progress(r)})
        return out

    proj = {"_id": 0, "id": 1, "center_id": 1, "title": 1, "item_type": 1,
            "priority": 1, "status": 1, "due_at": 1, "progress_percent": 1,
            "progress_method": 1, "checklist": 1}
    overdue = await C.find({**base, "status": {"$in": ACTIVE_STATUSES},
                            "due_at": {"$lt": now_iso, "$ne": None}}, proj).sort("due_at", 1).to_list(15)
    due_today = await C.find({**base, "status": {"$in": ACTIVE_STATUSES},
                              "due_at": {"$gte": now_iso, "$lte": end_today}}, proj).sort("due_at", 1).to_list(15)
    due_soon = await C.find({**base, "status": {"$in": ACTIVE_STATUSES},
                             "due_at": {"$gt": end_today, "$lte": due_soon_end}}, proj).sort("due_at", 1).to_list(15)
    in_progress = await C.find({**base, "status": "in_progress"}, proj).sort("updated_at", -1).to_list(15)
    approvals = await C.find({"center_id": {"$in": live_ids}, "is_series": {"$ne": True},
                              "status": "pending_approval", "approver_id": user["id"]},
                             proj).sort("updated_at", -1).to_list(15)
    completed = await C.find({**base, "status": {"$in": DONE_STATUSES}},
                             {**proj, "completed_at": 1}).sort("completed_at", -1).to_list(10)
    buckets = {"overdue": _fmt(overdue), "due_today": _fmt(due_today),
               "due_soon": _fmt(due_soon), "in_progress": _fmt(in_progress),
               "pending_my_approval": _fmt(approvals),
               "recently_completed": _fmt(completed)}
    _ = soon
    return {"buckets": buckets,
            "total": sum(len(v) for v in buckets.values())}
