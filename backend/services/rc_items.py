"""Responsibility Center — universal Responsibilities & Tasks engine (Bundle C).

One engine for every Center type. Center-scoped, permission-enforced,
server-side status transitions, immutable approval history, activity
trail. Attachments reuse the existing media pipeline (durable URLs only).

Collections (additive): responsibility_items (checklist + attachments
embedded), responsibility_item_comments, responsibility_item_approvals,
responsibility_item_activity.
"""
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from core.db import db
from services import responsibility_center as rc
from services.rc_media import durable

log = logging.getLogger("ourrealm.rc.items")

ITEM_TYPES = ["responsibility", "task", "goal", "milestone"]
PRIORITIES = ["low", "normal", "high", "urgent"]
VISIBILITIES = ["center", "assigned", "managers"]
STATUSES = ["draft", "assigned", "accepted", "declined", "in_progress", "waiting",
            "blocked", "submitted", "pending_approval", "changes_requested",
            "approved", "completed", "canceled", "archived"]
ACTIVE_STATUSES = ["assigned", "accepted", "in_progress", "waiting", "blocked",
                   "submitted", "pending_approval", "changes_requested"]
DONE_STATUSES = ["approved", "completed"]

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
        await db.responsibility_item_comments.create_index([("item_id", 1), ("created_at", -1)], name="i_time")
        await db.responsibility_item_activity.create_index([("item_id", 1), ("created_at", -1)], name="i_time")
        await db.responsibility_item_approvals.create_index([("item_id", 1), ("created_at", -1)], name="i_time")
    except Exception as e:  # noqa: BLE001
        log.warning(f"[rc-items] index issue: {e}")
    _IDX = True


async def _ctx(center_id: str, user: dict):
    """Center + active membership + perms. Paused/removed members blocked."""
    center, membership = await rc._center_and_membership(center_id, user["id"])
    if not membership or membership.get("status") != "active":
        raise HTTPException(status_code=403, detail="You are not an active member of this Center")
    perms = rc.ROLE_PERMISSIONS.get(membership.get("role") or "member", set())
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


def _progress(item: dict) -> int:
    if item["status"] in DONE_STATUSES:
        return 100
    checklist = item.get("checklist") or []
    if item.get("progress_method") == "checklist" and checklist:
        return int(100 * sum(1 for c in checklist if c.get("completed")) / len(checklist))
    return max(0, min(100, int(item.get("progress_percent") or 0)))


def _public(item: dict) -> dict:
    return {**item, "overdue": _is_overdue(item), "progress": _progress(item)}


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


async def _notify_item(uid: str, kind: str, message: str, center_id: str, item_id: str,
                       actor: Optional[dict] = None):
    await rc.notify_user(uid, kind, message,
                         f"/responsibility-center/{center_id}/work?item={item_id}",
                         center_id, None, (actor or {}).get("username"))


# ── Create / edit ────────────────────────────────────────────────────────
async def create_item(user: dict, center_id: str, body: dict) -> dict:
    await ensure_item_indexes()
    center, membership, perms = await _ctx(center_id, user)
    if "create_items" not in perms:
        raise HTTPException(status_code=403, detail="You don't have permission to create items")
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
    visibility = body.get("visibility") or "center"
    if visibility not in VISIBILITIES:
        raise HTTPException(status_code=400, detail="Invalid visibility")
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
    checklist = [{"id": uuid.uuid4().hex, "title": str(c)[:MAX_CHECK].strip(), "completed": False,
                  "completed_by": None, "completed_at": None}
                 for c in (body.get("checklist") or [])[:30] if str(c).strip()]
    draft = bool(body.get("draft"))
    status = "draft" if draft else ("assigned" if assignees else "in_progress" if not draft else "draft")
    if not assignees and not draft:
        assignees = [user["id"]]
        status = "in_progress"
    now = _now()
    item = {
        "id": uuid.uuid4().hex, "center_id": center_id, "item_type": item_type,
        "title": title, "description": desc, "status": status,
        "priority": priority, "visibility": visibility,
        "created_by": user["id"], "created_by_username": user.get("username"),
        "assignee_ids": assignees, "reviewer_id": reviewer, "approver_id": approver,
        "approval_required": bool(body.get("approval_required")),
        "start_at": body.get("start_at"), "due_at": body.get("due_at"),
        "completed_at": None, "completed_by": None,
        "estimated_minutes": max(0, int(body.get("estimated_minutes") or 0)),
        "difficulty": body.get("difficulty"),
        "progress_percent": 0, "progress_method": body.get("progress_method") or ("checklist" if checklist else "manual"),
        "checklist": checklist, "attachments": [],
        "created_at": now, "updated_at": now,
    }
    await db.responsibility_items.insert_one({**item})
    await _log(center_id, item["id"], user, "created", {"status": status})
    await rc.log_activity(center_id, user, "item_created",
                          f"@{user.get('username')} created {item_type} \"{title}\"")
    for uid in assignees:
        if uid != user["id"]:
            await _notify_item(uid, "responsibility_center_item_assigned",
                               f"You were assigned \"{title}\" in \"{center['name']}\".",
                               center_id, item["id"], user)
    return _public(item)


def _can_edit(item: dict, user_id: str, perms: set) -> bool:
    return "edit_any_item" in perms or item.get("created_by") == user_id


async def update_item(user: dict, center_id: str, item_id: str, body: dict) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    item = await _get_item(center_id, item_id)
    if not _can_edit(item, user["id"], perms):
        raise HTTPException(status_code=403, detail="You don't have permission to edit this item")
    sets = {}
    if "title" in body:
        t = (body["title"] or "").strip()
        if not t or len(t) > MAX_TITLE:
            raise HTTPException(status_code=400, detail="Invalid title")
        sets["title"] = t
    for f, mx in (("description", MAX_DESC),):
        if f in body:
            sets[f] = (body[f] or "").strip()[:mx]
    for f, allowed in (("priority", PRIORITIES), ("visibility", VISIBILITIES)):
        if f in body:
            if body[f] not in allowed:
                raise HTTPException(status_code=400, detail=f"Invalid {f}")
            sets[f] = body[f]
    if "start_at" in body or "due_at" in body:
        start = body.get("start_at", item.get("start_at"))
        due = body.get("due_at", item.get("due_at"))
        _validate_dates(start, due)
        sets["start_at"], sets["due_at"] = start, due
    if "approval_required" in body:
        sets["approval_required"] = bool(body["approval_required"])
    if not sets:
        return _public(item)
    sets["updated_at"] = _now()
    await db.responsibility_items.update_one({"id": item_id}, {"$set": sets})
    await _log(center_id, item_id, user, "edited", {"fields": list(sets)})
    if "due_at" in sets and sets["due_at"] != item.get("due_at"):
        for uid in item.get("assignee_ids") or []:
            if uid != user["id"]:
                await _notify_item(uid, "responsibility_center_item_due_changed",
                                   f"The due date changed on \"{sets.get('title', item['title'])}\".",
                                   center_id, item_id, user)
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
    if reviewer_id is not None:
        sets["reviewer_id"] = reviewer_id or None
    if approver_id is not None:
        sets["approver_id"] = approver_id or None
    if item["status"] in ("draft", "declined"):
        sets["status"] = "assigned"
    await db.responsibility_items.update_one({"id": item_id}, {"$set": sets})
    await _log(center_id, item_id, user, "reassigned",
               {"from": item.get("assignee_ids"), "to": assignees})
    for uid in assignees:
        if uid not in (item.get("assignee_ids") or []) and uid != user["id"]:
            await _notify_item(uid, "responsibility_center_item_assigned",
                               f"You were assigned \"{item['title']}\" in \"{center['name']}\".",
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
    is_assignee = user["id"] in (item.get("assignee_ids") or [])
    is_manager = "edit_any_item" in perms or "assign_items" in perms
    if who == "assignee" and not (is_assignee or is_manager):
        raise HTTPException(status_code=403, detail="Only the assignee can do this")
    if who == "manager" and not is_manager:
        raise HTTPException(status_code=403, detail="Only a manager can do this")
    if who == "either" and not (is_assignee or is_manager):
        raise HTTPException(status_code=403, detail="You are not involved in this item")
    if item["status"] not in allowed_from:
        raise HTTPException(status_code=409,
                            detail=f"Cannot {action} an item that is {item['status'].replace('_', ' ')}")
    # submit routes to approval when required
    if action == "submit" and item.get("approval_required"):
        to = "pending_approval"
        await db.responsibility_item_approvals.insert_one({
            "id": uuid.uuid4().hex, "center_id": center_id, "item_id": item_id,
            "cycle": (item.get("approval_cycle") or 0) + 1, "decision": None,
            "requested_by": user["id"], "requested_at": _now(),
            "approver_id": item.get("approver_id"), "decided_at": None,
            "note": None, "created_at": _now()})
    if action == "complete" and item.get("approval_required") and item["status"] not in ("approved",):
        raise HTTPException(status_code=409, detail="This item requires approval — submit it for review instead")
    sets = {"status": to, "updated_at": _now()}
    if to == "pending_approval":
        sets["approval_cycle"] = (item.get("approval_cycle") or 0) + 1
    if to == "completed":
        sets.update(completed_at=_now(), completed_by=user["id"], progress_percent=100)
    guard = {"id": item_id, "status": item["status"]}
    res = await db.responsibility_items.update_one(guard, {"$set": sets})
    if res.modified_count != 1:
        raise HTTPException(status_code=409, detail="The item changed — refresh and try again")
    await _log(center_id, item_id, user, action, {"from": item["status"], "to": to, "note": note[:300]})
    targets = set(item.get("assignee_ids") or []) | {item.get("created_by")}
    if to == "pending_approval" and item.get("approver_id"):
        await _notify_item(item["approver_id"], "responsibility_center_approval_requested",
                           f"\"{item['title']}\" was submitted for your approval in \"{center['name']}\".",
                           center_id, item_id, user)
    elif to in ("completed", "declined", "blocked"):
        for uid in targets - {user["id"]}:
            await _notify_item(uid, f"responsibility_center_item_{to}",
                               f"\"{item['title']}\" is now {to.replace('_', ' ')}.",
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
    if item["status"] != "pending_approval":
        raise HTTPException(status_code=409, detail="This item is not pending approval")
    if decision != "approve" and len((note or "").strip()) < 3:
        raise HTTPException(status_code=400, detail="A note is required when requesting changes or rejecting")
    to = {"approve": "approved", "request_changes": "changes_requested", "reject": "declined"}[decision]
    # Idempotent: decision recorded once per cycle via conditional update.
    upd = await db.responsibility_item_approvals.update_one(
        {"item_id": item_id, "cycle": item.get("approval_cycle") or 1, "decision": None},
        {"$set": {"decision": decision, "note": (note or "")[:500],
                  "decided_by": user["id"], "decided_by_username": user.get("username"),
                  "decided_at": _now()}})
    if upd.modified_count != 1:
        raise HTTPException(status_code=409, detail="This approval was already decided")
    sets = {"status": to, "updated_at": _now()}
    if decision == "approve":
        sets.update(completed_at=_now(), completed_by=user["id"],
                    progress_percent=100, status="completed")
        to = "completed"
    await db.responsibility_items.update_one(
        {"id": item_id, "status": "pending_approval"}, {"$set": sets})
    await _log(center_id, item_id, user, f"approval_{decision}", {"note": (note or "")[:300]})
    for uid in set(item.get("assignee_ids") or []) - {user["id"]}:
        await _notify_item(uid, f"responsibility_center_approval_{decision}",
                           f"\"{item['title']}\": {decision.replace('_', ' ')}"
                           + (f" — {note[:120]}" if note else "") + ".",
                           center_id, item_id, user)
    return _public(await _get_item(center_id, item_id))


# ── Checklist / progress / comments / attachments ───────────────────────
async def checklist_op(user: dict, center_id: str, item_id: str, op: str,
                       entry_id: Optional[str] = None, title: str = "") -> dict:
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
        if op == "toggle":
            entry["completed"] = not entry["completed"]
            entry["completed_by"] = user.get("username") if entry["completed"] else None
            entry["completed_at"] = _now() if entry["completed"] else None
        elif op == "delete":
            checklist = [c for c in checklist if c["id"] != entry_id]
        else:
            raise HTTPException(status_code=400, detail="Unknown checklist operation")
    await db.responsibility_items.update_one(
        {"id": item_id}, {"$set": {"checklist": checklist, "updated_at": _now()}})
    await _log(center_id, item_id, user, f"checklist_{op}", {"entry_id": entry_id})
    return _public(await _get_item(center_id, item_id))


async def set_progress(user: dict, center_id: str, item_id: str, percent: int) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    item = await _get_item(center_id, item_id)
    if not (user["id"] in (item.get("assignee_ids") or []) or _can_edit(item, user["id"], perms)):
        raise HTTPException(status_code=403, detail="Only assignees or managers can update progress")
    percent = max(0, min(100, int(percent)))
    await db.responsibility_items.update_one(
        {"id": item_id}, {"$set": {"progress_percent": percent, "progress_method": "manual",
                                   "updated_at": _now()}})
    await _log(center_id, item_id, user, "progress", {"percent": percent})
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
    # Mentions — only active Center members, no enumeration outside the Center.
    notified = set()
    for uname in set(MENTION_RE.findall(body))[:5] if isinstance(MENTION_RE.findall(body), list) else set():
        pass
    for uname in list(dict.fromkeys(MENTION_RE.findall(body)))[:5]:
        target = await db.users.find_one({"username": uname.lower()}, {"_id": 0, "id": 1})
        if not target or target["id"] == user["id"]:
            continue
        m = await db.responsibility_center_memberships.find_one(
            {"center_id": center_id, "user_id": target["id"], "status": "active"}, {"_id": 0, "user_id": 1})
        if m:
            await _notify_item(target["id"], "responsibility_center_mention",
                               f"@{user.get('username')} mentioned you on \"{item['title']}\".",
                               center_id, item_id, user)
            notified.add(target["id"])
    for uid in set(item.get("assignee_ids") or []) | {item.get("created_by")}:
        if uid and uid != user["id"] and uid not in notified:
            await _notify_item(uid, "responsibility_center_item_comment",
                               f"@{user.get('username')} commented on \"{item['title']}\".",
                               center_id, item_id, user)
    return row


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
           "created_at": _now()}
    await db.responsibility_items.update_one(
        {"id": item_id}, {"$push": {"attachments": att}, "$set": {"updated_at": _now()}})
    await _log(center_id, item_id, user, "attachment_added", {"attachment_id": att["id"]})
    return att


# ── Reads ────────────────────────────────────────────────────────────────
async def list_items(user: dict, center_id: str, q: str = "", item_type: str = "",
                     status: str = "", scope: str = "", priority: str = "",
                     sort: str = "due", page: int = 1, limit: int = 25) -> dict:
    await ensure_item_indexes()
    center, membership, perms = await _ctx(center_id, user)
    query: dict = {"center_id": center_id}
    if item_type in ITEM_TYPES:
        query["item_type"] = item_type
    if status == "active":
        query["status"] = {"$in": ACTIVE_STATUSES}
    elif status == "completed":
        query["status"] = {"$in": DONE_STATUSES}
    elif status in STATUSES:
        query["status"] = status
    else:
        query["status"] = {"$ne": "archived"}
    if priority in PRIORITIES:
        query["priority"] = priority
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
    if (q or "").strip():
        query["title"] = {"$regex": re.escape(q.strip()), "$options": "i"}
    if "view_private_items" not in perms:
        query["$or"] = [{"visibility": "center"},
                        {"assignee_ids": user["id"]}, {"created_by": user["id"]},
                        {"reviewer_id": user["id"]}, {"approver_id": user["id"]}]
    sort_spec = {"due": [("due_at", 1)], "priority": [("priority", -1)],
                 "updated": [("updated_at", -1)], "created": [("created_at", -1)],
                 "title": [("title", 1)]}.get(sort, [("due_at", 1)])
    page, limit = max(1, int(page)), max(1, min(int(limit), 100))
    total = await db.responsibility_items.count_documents(query)
    rows = await db.responsibility_items.find(query, {"_id": 0}) \
        .sort(sort_spec).skip((page - 1) * limit).to_list(limit)
    users = await rc._users_map(list({u for r in rows for u in (r.get("assignee_ids") or [])}))
    out = []
    for r in rows:
        p = _public(r)
        p["assignees"] = [{"user_id": u, "username": (users.get(u) or {}).get("username")}
                          for u in (r.get("assignee_ids") or [])]
        out.append(p)
    return {"items": out, "total": total, "page": page, "limit": limit}


async def item_detail(user: dict, center_id: str, item_id: str) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    item = await _get_item(center_id, item_id)
    if not _can_see(item, user["id"], perms):
        raise HTTPException(status_code=403, detail="You can't access this item")
    comments = await db.responsibility_item_comments.find(
        {"item_id": item_id, "deleted_at": None}, {"_id": 0}).sort("created_at", 1).to_list(100)
    approvals = await db.responsibility_item_approvals.find(
        {"item_id": item_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
    activity = await db.responsibility_item_activity.find(
        {"item_id": item_id}, {"_id": 0}).sort("created_at", -1).to_list(30)
    ids = set(item.get("assignee_ids") or []) | {item.get("created_by"), item.get("approver_id"), item.get("reviewer_id")}
    users = await rc._users_map(list(filter(None, ids)))
    p = _public(item)
    p["assignees"] = [{"user_id": u, "username": (users.get(u) or {}).get("username")}
                      for u in (item.get("assignee_ids") or [])]
    p["approver_username"] = (users.get(item.get("approver_id")) or {}).get("username")
    my = {"is_assignee": user["id"] in (item.get("assignee_ids") or []),
          "is_approver": item.get("approver_id") == user["id"] or ("approve_items" in perms and not item.get("approver_id")),
          "can_edit": _can_edit(item, user["id"], perms),
          "can_assign": "assign_items" in perms}
    return {"item": p, "comments": comments, "approvals": approvals,
            "activity": activity, "me": my}


async def work_summary(user: dict, center_id: str) -> dict:
    center, membership, perms = await _ctx(center_id, user)
    now_iso = _now()
    end_today = datetime.now(timezone.utc).replace(hour=23, minute=59, second=59).isoformat()
    week_ago = datetime.now(timezone.utc).isoformat()[:10]
    base = {"center_id": center_id}
    C = db.responsibility_items
    return {
        "active_responsibilities": await C.count_documents({**base, "item_type": "responsibility", "status": {"$in": ACTIVE_STATUSES}}),
        "active_tasks": await C.count_documents({**base, "item_type": "task", "status": {"$in": ACTIVE_STATUSES}}),
        "assigned_to_me": await C.count_documents({**base, "assignee_ids": user["id"], "status": {"$in": ACTIVE_STATUSES}}),
        "due_today": await C.count_documents({**base, "status": {"$in": ACTIVE_STATUSES}, "due_at": {"$lte": end_today, "$ne": None}}),
        "overdue": await C.count_documents({**base, "status": {"$in": ACTIVE_STATUSES}, "due_at": {"$lt": now_iso, "$ne": None}}),
        "pending_approval": await C.count_documents({**base, "status": "pending_approval"}),
        "completed_total": await C.count_documents({**base, "status": {"$in": DONE_STATUSES}}),
        "my_pending_approvals": await C.count_documents({**base, "status": "pending_approval", "approver_id": user["id"]}),
    }
