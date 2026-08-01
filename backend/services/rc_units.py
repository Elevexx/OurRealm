"""Responsibility Center — Bundle E universal organizational-unit engine.

One engine for every Center type (departments, classes, teams, ministries,
households…). Nested hierarchy (max depth 5, cycle-safe), unit memberships
bounded by Center-level permissions, unit work assignment (individual
snapshots or shared unit work), and the Education self-task → official
assignment conversion. Archiving preserves history; nothing is deleted.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core.db import db
from services import responsibility_center as rc

log = logging.getLogger("ourrealm.rc.units")

UNIT_TYPES = ["group", "subgroup", "department", "division", "class", "grade", "team",
              "committee", "ministry", "household", "project", "club", "shift", "volunteer", "custom"]
UNIT_ROLES = ["leader", "assistant", "member", "viewer"]
UNIT_VISIBILITIES = ["center", "unit", "leaders"]
MAX_DEPTH = 5
_IDX = False


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_unit_indexes():
    global _IDX
    if _IDX:
        return
    try:
        await db.responsibility_center_units.create_index([("center_id", 1), ("status", 1)], name="c_s")
        await db.responsibility_center_units.create_index(
            [("center_id", 1), ("client_token", 1)], unique=True, name="uniq_unit_token",
            partialFilterExpression={"client_token": {"$exists": True}})
        await db.responsibility_center_unit_memberships.create_index(
            [("unit_id", 1), ("user_id", 1)], unique=True, name="uniq_active_um",
            partialFilterExpression={"status": "active"})
        await db.responsibility_center_unit_memberships.create_index(
            [("center_id", 1), ("user_id", 1), ("status", 1)], name="c_u_s")
    except Exception as e:  # noqa: BLE001
        log.warning(f"[rc-units] index issue: {e}")
    _IDX = True


async def _ctx(center_id: str, user: dict, perm: str, write: bool = True):
    center, membership = await rc._center_and_membership(center_id, user["id"])
    if not membership or membership.get("status") != "active":
        raise HTTPException(status_code=403, detail="You are not an active member of this Center")
    op = center.get("status") or "active"
    if op == "closed":
        raise HTTPException(status_code=409, detail="This Center is closed")
    role = membership.get("role") or "member"
    if op in ("paused", "archived"):
        if role == "member":
            raise HTTPException(status_code=403, detail=f"This Center is {op}")
        if write:
            raise HTTPException(status_code=409, detail=f"This Center is {op} — restore it before making changes")
    perms = set(rc.ROLE_PERMISSIONS.get(role, set()))
    if perm and perm not in perms:
        raise HTTPException(status_code=403, detail="You don't have permission to do this")
    return center, membership, perms


async def _log_unit(center_id: str, unit_id: str, actor: dict, action: str, meta=None):
    await db.responsibility_center_unit_activity.insert_one({
        "id": uuid.uuid4().hex, "center_id": center_id, "unit_id": unit_id,
        "actor_id": actor.get("id"), "actor_username": actor.get("username"),
        "action": action, "meta": meta or {}, "created_at": _iso()})


async def _get_unit(center_id: str, unit_id: str) -> dict:
    u = await db.responsibility_center_units.find_one(
        {"id": unit_id, "center_id": center_id}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Unit not found")
    return u


async def _depth_and_cycle_check(center_id: str, parent_id: Optional[str],
                                 unit_id: Optional[str] = None) -> int:
    """Returns depth of the new position; raises on cycles/cross-Center/overflow."""
    depth, cursor, seen = 1, parent_id, set()
    while cursor:
        if cursor == unit_id:
            raise HTTPException(status_code=400, detail="That parent would create a hierarchy cycle")
        if cursor in seen:
            raise HTTPException(status_code=400, detail="Hierarchy cycle detected")
        seen.add(cursor)
        p = await db.responsibility_center_units.find_one(
            {"id": cursor, "center_id": center_id}, {"_id": 0, "parent_id": 1})
        if not p:
            raise HTTPException(status_code=400, detail="Parent unit must belong to this Center")
        depth += 1
        if depth > MAX_DEPTH:
            raise HTTPException(status_code=400, detail=f"Units can be nested at most {MAX_DEPTH} levels deep")
        cursor = p.get("parent_id")
    # if moving an existing unit, its own subtree adds depth too
    if unit_id:
        sub_depth = await _subtree_depth(unit_id)
        if depth + sub_depth - 1 > MAX_DEPTH:
            raise HTTPException(status_code=400, detail=f"That move would exceed the {MAX_DEPTH}-level depth limit")
    return depth


async def _subtree_depth(unit_id: str, level: int = 1) -> int:
    if level > MAX_DEPTH:
        return level
    children = await db.responsibility_center_units.find(
        {"parent_id": unit_id}, {"_id": 0, "id": 1}).to_list(50)
    if not children:
        return level
    return max([await _subtree_depth(c["id"], level + 1) for c in children])


async def _validate_leader(center_id: str, user_id: Optional[str]):
    if not user_id:
        return
    m = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": user_id, "status": "active"}, {"_id": 0, "user_id": 1})
    if not m:
        raise HTTPException(status_code=400, detail="The leader must be an active member of this Center")


async def create_unit(user: dict, center_id: str, body: dict) -> dict:
    await ensure_unit_indexes()
    center, membership, perms = await _ctx(center_id, user, "create_units")
    name = (body.get("name") or "").strip()[:80]
    if not name:
        raise HTTPException(status_code=400, detail="A unit name is required")
    unit_type = body.get("unit_type") or "group"
    if unit_type not in UNIT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid unit type")
    visibility = body.get("visibility") or "center"
    if visibility not in UNIT_VISIBILITIES:
        raise HTTPException(status_code=400, detail="Invalid visibility")
    parent_id = body.get("parent_id") or None
    await _depth_and_cycle_check(center_id, parent_id)
    leader_id = body.get("leader_id") or None
    await _validate_leader(center_id, leader_id)
    unit = {"id": uuid.uuid4().hex, "center_id": center_id, "parent_id": parent_id,
            "unit_type": unit_type, "name": name,
            "description": (body.get("description") or "").strip()[:1000],
            "color": (body.get("color") or "")[:20] or None,
            "status": "active", "visibility": visibility,
            "leader_id": leader_id, "calendar_enabled": bool(body.get("calendar_enabled", True)),
            "sort_order": int(body.get("sort_order") or 0),
            "created_by": user["id"], "created_at": _iso(), "updated_at": _iso(),
            "archived_at": None}
    if body.get("client_token"):
        unit["client_token"] = str(body["client_token"])[:80]
    try:
        await db.responsibility_center_units.insert_one({**unit})
    except DuplicateKeyError:
        existing = await db.responsibility_center_units.find_one(
            {"center_id": center_id, "client_token": unit.get("client_token")}, {"_id": 0})
        if existing:
            return existing
        raise HTTPException(status_code=409, detail="Duplicate request — please retry")
    members = list(dict.fromkeys((body.get("member_ids") or [])[:50]))
    if leader_id and leader_id not in members:
        members.append(leader_id)
    for uid in members:
        try:
            await add_unit_member(user, center_id, unit["id"], uid,
                                  "leader" if uid == leader_id else "member", _skip_perm=True)
        except HTTPException:
            pass
    await _log_unit(center_id, unit["id"], user, "unit_created", {"name": name})
    await rc.log_activity(center_id, user, "unit_created",
                          f"@{user.get('username')} created {unit_type} \"{name}\"")
    return await unit_detail(user, center_id, unit["id"])


def _can_see_unit(unit: dict, user_id: str, perms: set, member_unit_ids: set) -> bool:
    vis = unit.get("visibility") or "center"
    if "view_private_units" in perms or unit.get("leader_id") == user_id:
        return True
    if vis == "center":
        return "view_units" in perms
    if vis == "unit":
        return unit["id"] in member_unit_ids
    return False  # leaders-only


async def _my_unit_ids(center_id: str, user_id: str) -> set:
    rows = await db.responsibility_center_unit_memberships.find(
        {"center_id": center_id, "user_id": user_id, "status": "active"},
        {"_id": 0, "unit_id": 1}).to_list(200)
    return {r["unit_id"] for r in rows}


async def list_units(user: dict, center_id: str, include_archived: bool = False) -> dict:
    await ensure_unit_indexes()
    center, membership, perms = await _ctx(center_id, user, "view_units", write=False)
    q = {"center_id": center_id}
    if not include_archived:
        q["status"] = "active"
    units = await db.responsibility_center_units.find(q, {"_id": 0}).sort("sort_order", 1).to_list(300)
    mine = await _my_unit_ids(center_id, user["id"])
    visible = [u for u in units if _can_see_unit(u, user["id"], perms, mine)]
    counts = {}
    async for row in db.responsibility_center_unit_memberships.aggregate([
            {"$match": {"center_id": center_id, "status": "active"}},
            {"$group": {"_id": "$unit_id", "n": {"$sum": 1}}}]):
        counts[row["_id"]] = row["n"]
    work = {}
    async for row in db.responsibility_items.aggregate([
            {"$match": {"center_id": center_id, "unit_id": {"$ne": None},
                        "is_series": {"$ne": True},
                        "status": {"$in": ["assigned", "accepted", "in_progress", "waiting",
                                           "blocked", "submitted", "pending_approval",
                                           "changes_requested", "draft"]}}},
            {"$group": {"_id": "$unit_id", "n": {"$sum": 1}}}]):
        work[row["_id"]] = row["n"]
    leaders = await rc._users_map([u["leader_id"] for u in visible if u.get("leader_id")])
    out = []
    for u in visible:
        out.append({**u, "member_count": counts.get(u["id"], 0),
                    "open_items": work.get(u["id"], 0),
                    "leader_username": (leaders.get(u.get("leader_id")) or {}).get("username"),
                    "is_mine": u["id"] in mine})
    return {"units": out, "my_unit_ids": list(mine),
            "unit_label": center.get("unit_label") or "Groups",
            "can_manage": "create_units" in perms}


async def unit_detail(user: dict, center_id: str, unit_id: str) -> dict:
    center, membership, perms = await _ctx(center_id, user, "view_units", write=False)
    unit = await _get_unit(center_id, unit_id)
    mine = await _my_unit_ids(center_id, user["id"])
    if not _can_see_unit(unit, user["id"], perms, mine):
        raise HTTPException(status_code=403, detail="You can't access this unit")
    members = await db.responsibility_center_unit_memberships.find(
        {"unit_id": unit_id, "status": "active"}, {"_id": 0}).to_list(200)
    users = await rc._users_map([m["user_id"] for m in members])
    for m in members:
        m["username"] = (users.get(m["user_id"]) or {}).get("username")
    children = await db.responsibility_center_units.find(
        {"parent_id": unit_id, "status": "active"}, {"_id": 0, "id": 1, "name": 1, "unit_type": 1}).to_list(50)
    activity = await db.responsibility_center_unit_activity.find(
        {"unit_id": unit_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
    leader = (await rc._users_map([unit.get("leader_id")])).get(unit.get("leader_id")) if unit.get("leader_id") else None
    return {"unit": {**unit, "leader_username": (leader or {}).get("username")},
            "members": members, "children": children, "activity": activity,
            "me": {"is_member": unit_id in mine,
                   "is_leader": unit.get("leader_id") == user["id"],
                   "can_manage": "manage_unit_members" in perms or unit.get("leader_id") == user["id"],
                   "can_edit": "edit_units" in perms,
                   "can_assign_work": "assign_items" in perms or unit.get("leader_id") == user["id"]}}


async def update_unit(user: dict, center_id: str, unit_id: str, body: dict) -> dict:
    center, membership, perms = await _ctx(center_id, user, "edit_units")
    unit = await _get_unit(center_id, unit_id)
    sets = {}
    if "name" in body:
        n = (body["name"] or "").strip()[:80]
        if not n:
            raise HTTPException(status_code=400, detail="Invalid name")
        sets["name"] = n
    if "description" in body:
        sets["description"] = (body["description"] or "").strip()[:1000]
    if "unit_type" in body and body["unit_type"] in UNIT_TYPES:
        sets["unit_type"] = body["unit_type"]
    if "visibility" in body:
        if body["visibility"] not in UNIT_VISIBILITIES:
            raise HTTPException(status_code=400, detail="Invalid visibility")
        sets["visibility"] = body["visibility"]
    if "color" in body:
        sets["color"] = (body["color"] or "")[:20] or None
    if "sort_order" in body:
        sets["sort_order"] = int(body["sort_order"])
    if "parent_id" in body:
        parent = body["parent_id"] or None
        await _depth_and_cycle_check(center_id, parent, unit_id=unit_id)
        sets["parent_id"] = parent
        await _log_unit(center_id, unit_id, user, "parent_changed",
                        {"from": unit.get("parent_id"), "to": parent})
    if "leader_id" in body:
        if "assign_unit_leaders" not in perms and "manage_unit_members" not in perms:
            raise HTTPException(status_code=403, detail="You can't assign unit leaders")
        await _validate_leader(center_id, body["leader_id"])
        sets["leader_id"] = body["leader_id"] or None
        if body["leader_id"]:
            await add_unit_member(user, center_id, unit_id, body["leader_id"], "leader", _skip_perm=True)
        await _log_unit(center_id, unit_id, user, "leader_assigned", {"leader": body["leader_id"]})
    if "status" in body:
        if body["status"] not in ("active", "archived", "paused"):
            raise HTTPException(status_code=400, detail="Invalid status")
        if "archive_units" not in perms and body["status"] != "active":
            raise HTTPException(status_code=403, detail="You can't archive units")
        sets["status"] = body["status"]
        sets["archived_at"] = _iso() if body["status"] == "archived" else None
        await _log_unit(center_id, unit_id, user,
                        "unit_archived" if body["status"] == "archived" else f"unit_{body['status']}")
    if not sets:
        return await unit_detail(user, center_id, unit_id)
    sets["updated_at"] = _iso()
    await db.responsibility_center_units.update_one({"id": unit_id}, {"$set": sets})
    await _log_unit(center_id, unit_id, user, "unit_edited", {"fields": list(sets)})
    return await unit_detail(user, center_id, unit_id)


async def add_unit_member(user: dict, center_id: str, unit_id: str, target_user_id: str,
                          unit_role: str = "member", _skip_perm: bool = False) -> dict:
    await ensure_unit_indexes()
    if not _skip_perm:
        center, membership, perms = await _ctx(center_id, user, "")
        unit = await _get_unit(center_id, unit_id)
        if "manage_unit_members" not in perms and unit.get("leader_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can't manage this unit's members")
        if unit.get("status") != "active":
            raise HTTPException(status_code=409, detail="This unit is archived")
    if unit_role not in UNIT_ROLES:
        raise HTTPException(status_code=400, detail="Invalid unit role")
    cm = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": target_user_id, "status": "active"}, {"_id": 0})
    if not cm:
        raise HTTPException(status_code=400, detail="Only active Center members can join a unit")
    row = {"id": uuid.uuid4().hex, "center_id": center_id, "unit_id": unit_id,
           "user_id": target_user_id, "unit_role": unit_role, "status": "active",
           "added_by": user["id"], "joined_at": _iso(), "left_at": None,
           "created_at": _iso(), "updated_at": _iso()}
    try:
        await db.responsibility_center_unit_memberships.insert_one({**row})
    except DuplicateKeyError:
        await db.responsibility_center_unit_memberships.update_one(
            {"unit_id": unit_id, "user_id": target_user_id, "status": "active"},
            {"$set": {"unit_role": unit_role, "updated_at": _iso()}})
        return {"ok": True, "updated": True}
    await _log_unit(center_id, unit_id, user, "member_added",
                    {"user_id": target_user_id, "role": unit_role})
    if target_user_id != user["id"]:
        await rc.notify_user(target_user_id, "responsibility_center_unit_added",
                             "You were added to a group in one of your Responsibility Centers.",
                             f"/responsibility-center/{center_id}?tab=units", center_id,
                             None, user.get("username"))
    return {"ok": True, "membership": row}


async def remove_unit_member(user: dict, center_id: str, unit_id: str, target_user_id: str) -> dict:
    center, membership, perms = await _ctx(center_id, user, "")
    unit = await _get_unit(center_id, unit_id)
    if "manage_unit_members" not in perms and unit.get("leader_id") != user["id"] \
            and target_user_id != user["id"]:
        raise HTTPException(status_code=403, detail="You can't manage this unit's members")
    upd = await db.responsibility_center_unit_memberships.update_one(
        {"unit_id": unit_id, "user_id": target_user_id, "status": "active"},
        {"$set": {"status": "left", "left_at": _iso(), "updated_at": _iso()}})
    if upd.modified_count != 1:
        raise HTTPException(status_code=404, detail="That member is not in this unit")
    if unit.get("leader_id") == target_user_id:
        await db.responsibility_center_units.update_one(
            {"id": unit_id}, {"$set": {"leader_id": None, "updated_at": _iso()}})
    await _log_unit(center_id, unit_id, user, "member_removed", {"user_id": target_user_id})
    return {"ok": True}


async def deactivate_center_member_units(center_id: str, user_id: str):
    """Called when a member leaves/is removed from the Center."""
    await db.responsibility_center_unit_memberships.update_many(
        {"center_id": center_id, "user_id": user_id, "status": "active"},
        {"$set": {"status": "left", "left_at": _iso(), "updated_at": _iso()}})
    await db.responsibility_center_units.update_many(
        {"center_id": center_id, "leader_id": user_id},
        {"$set": {"leader_id": None, "updated_at": _iso()}})


# ── Unit work assignment ─────────────────────────────────────────────────
async def assign_work_to_unit(user: dict, center_id: str, unit_id: str, body: dict) -> dict:
    """mode=individual → one item snapshot per current active unit member.
    mode=shared → one unit-tagged item (leader-assigned when present)."""
    from services import rc_items
    center, membership, perms = await _ctx(center_id, user, "")
    unit = await _get_unit(center_id, unit_id)
    if "assign_items" not in perms and unit.get("leader_id") != user["id"]:
        raise HTTPException(status_code=403, detail="You can't assign work to this unit")
    if unit.get("status") != "active":
        raise HTTPException(status_code=409, detail="This unit is archived")
    mode = body.get("mode") or "shared"
    if mode not in ("individual", "shared"):
        raise HTTPException(status_code=400, detail="Invalid assignment mode")
    base_token = body.get("client_token") or uuid.uuid4().hex
    payload = {k: v for k, v in body.items() if k in
               ("title", "description", "item_type", "priority", "due_at", "start_at",
                "checklist", "approval_required", "approver_id", "category", "labels")}
    created = []
    if mode == "individual":
        members = await db.responsibility_center_unit_memberships.find(
            {"unit_id": unit_id, "status": "active"}, {"_id": 0, "user_id": 1}).to_list(100)
        eligible = []
        for m in members:
            cm = await db.responsibility_center_memberships.find_one(
                {"center_id": center_id, "user_id": m["user_id"], "status": "active"},
                {"_id": 0, "user_id": 1})
            if cm:
                eligible.append(m["user_id"])
        if not eligible:
            raise HTTPException(status_code=400, detail="This unit has no eligible active members")
        for uid in eligible:
            item = await rc_items.create_item(user, center_id, {
                **payload, "assignee_ids": [uid],
                "client_token": f"{base_token}-{uid}"})
            await db.responsibility_items.update_one(
                {"id": item["id"]}, {"$set": {"unit_id": unit_id, "unit_group_key": base_token}})
            created.append(item["id"])
    else:
        assignees = [unit["leader_id"]] if unit.get("leader_id") else []
        item = await rc_items.create_item(user, center_id, {
            **payload, "assignee_ids": assignees, "client_token": base_token})
        await db.responsibility_items.update_one(
            {"id": item["id"]}, {"$set": {"unit_id": unit_id, "unit_shared": True}})
        created.append(item["id"])
    await _log_unit(center_id, unit_id, user, "work_assigned",
                    {"mode": mode, "items": len(created)})
    return {"ok": True, "mode": mode, "item_ids": created, "count": len(created)}


# ── Education conversion ─────────────────────────────────────────────────
async def convert_self_task(user: dict, center_id: str, item_id: str, body: dict) -> dict:
    """Convert a student/member self-task into an official assignment.
    Never silent: the original stays, linked, and the conversion is logged."""
    from services import rc_items
    center, membership, perms = await _ctx(center_id, user, "convert_student_task_to_assignment")
    original = await db.responsibility_items.find_one(
        {"id": item_id, "center_id": center_id}, {"_id": 0})
    if not original:
        raise HTTPException(status_code=404, detail="Item not found")
    if not original.get("is_self_task"):
        raise HTTPException(status_code=400, detail="Only personal self-tasks can be converted")
    if original.get("converted_to"):
        raise HTTPException(status_code=409, detail="This task was already converted to an official assignment")
    mode = body.get("mode") or "personal"
    if mode not in ("personal", "selected", "unit"):
        raise HTTPException(status_code=400, detail="Invalid conversion mode")
    payload = {"title": body.get("title") or original["title"],
               "description": original.get("description") or "",
               "item_type": "task", "priority": original.get("priority") or "normal",
               "due_at": body.get("due_at") or original.get("due_at"),
               "checklist": [c["title"] for c in (original.get("checklist") or [])],
               "approval_required": bool(body.get("approval_required")),
               "approver_id": body.get("approver_id"),
               "client_token": f"convert-{item_id}-{mode}"}
    if mode == "personal":
        payload["assignee_ids"] = [original["created_by"]]
        official = await rc_items.create_item(user, center_id, payload)
        item_ids = [official["id"]]
    elif mode == "selected":
        payload["assignee_ids"] = list(dict.fromkeys(body.get("assignee_ids") or []))
        if not payload["assignee_ids"]:
            raise HTTPException(status_code=400, detail="Choose at least one student")
        official = await rc_items.create_item(user, center_id, payload)
        item_ids = [official["id"]]
    else:
        unit_id = body.get("unit_id")
        if not unit_id:
            raise HTTPException(status_code=400, detail="Choose a class or unit")
        result = await assign_work_to_unit(user, center_id, unit_id,
                                           {**payload, "mode": body.get("unit_mode") or "individual",
                                            "client_token": payload["client_token"]})
        item_ids = result["item_ids"]
    await db.responsibility_items.update_many(
        {"id": {"$in": item_ids}},
        {"$set": {"source_item_id": item_id,
                  "source_created_by": original["created_by"],
                  "source_created_by_username": original.get("created_by_username")}})
    await db.responsibility_items.update_one(
        {"id": item_id}, {"$set": {"converted_to": item_ids, "converted_at": _iso(),
                                   "converted_by": user["id"]}})
    await rc_items._log(center_id, item_id, user, "converted_to_assignment",
                        {"mode": mode, "official_ids": item_ids})
    if original["created_by"] != user["id"]:
        await rc.notify_user(original["created_by"], "responsibility_center_task_converted",
                             "Your personal task was approved as an official assignment.",
                             f"/responsibility-center/{center_id}?tab=work&item={item_ids[0]}",
                             center_id, None, user.get("username"))
    return {"ok": True, "mode": mode, "official_item_ids": item_ids}
