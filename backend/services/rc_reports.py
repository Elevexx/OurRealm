"""Responsibility Center — Bundle F universal reporting engine.

One report registry for every Center type. All numbers come from real
collections via server-side aggregation; permission-gated per report.
UTC internally; Center timezone is echoed for display.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from core.db import db
from services import responsibility_center as rc
from services.rc_units import _ctx

log = logging.getLogger("ourrealm.rc.reports")

MAX_RANGE_DAYS = 366
OPEN_STATUSES = ["draft", "assigned", "accepted", "in_progress", "waiting",
                 "blocked", "submitted", "pending_approval", "changes_requested"]
DONE_STATUSES = ["completed", "approved"]


def _iso(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()


def parse_filters(filters: dict) -> dict:
    f = filters or {}
    now = datetime.now(timezone.utc)
    try:
        dfrom = datetime.fromisoformat(f["date_from"]) if f.get("date_from") else now - timedelta(days=30)
        dto = datetime.fromisoformat(f["date_to"]) if f.get("date_to") else now
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid date range")
    if dfrom.tzinfo is None:
        dfrom = dfrom.replace(tzinfo=timezone.utc)
    if dto.tzinfo is None:
        dto = dto.replace(tzinfo=timezone.utc)
    if dto < dfrom:
        raise HTTPException(status_code=400, detail="The end date can't be before the start date")
    if (dto - dfrom).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"Date range too large (max {MAX_RANGE_DAYS} days)")
    return {"date_from": dfrom.isoformat(), "date_to": dto.isoformat(),
            "member_id": f.get("member_id") or None, "unit_id": f.get("unit_id") or None,
            "status": f.get("status") or None, "priority": f.get("priority") or None,
            "item_type": f.get("item_type") or None, "event_type": f.get("event_type") or None,
            "include_archived": bool(f.get("include_archived")),
            "group_by": f.get("group_by") or None}


async def _username_map(center_id: str) -> dict:
    ms = await db.responsibility_center_memberships.find(
        {"center_id": center_id}, {"_id": 0, "user_id": 1}).to_list(500)
    return await rc._users_map([m["user_id"] for m in ms])


def _uname(users, uid):
    return (users.get(uid) or {}).get("username") or (uid[:8] if uid else "—")


async def _group_count(coll, match: dict, field: str, limit: int = 30, unwind: bool = False) -> list:
    pipeline = [{"$match": match}]
    if unwind:
        pipeline.append({"$unwind": {"path": f"${field}", "preserveNullAndEmptyArrays": True}})
    pipeline += [{"$group": {"_id": f"${field}", "n": {"$sum": 1}}},
                 {"$sort": {"n": -1}}, {"$limit": limit}]
    rows = []
    async for r in coll.aggregate(pipeline):
        rows.append({"key": r["_id"] if r["_id"] is not None else "—", "count": r["n"]})
    return rows


# ── WORK ─────────────────────────────────────────────────────────────────
async def work_summary(center_id: str, f: dict, ctx: dict) -> dict:
    match = {"center_id": center_id, "is_series": {"$ne": True},
             "created_at": {"$lte": f["date_to"]}}
    if not f["include_archived"]:
        match["status"] = {"$ne": "archived"}
    if f["member_id"]:
        match["assignee_ids"] = f["member_id"]
    if f["unit_id"]:
        match["unit_id"] = f["unit_id"]
    if f["item_type"]:
        match["item_type"] = f["item_type"]
    if f["priority"]:
        match["priority"] = f["priority"]
    now = _iso()
    by_status = await _group_count(db.responsibility_items, match, "status")
    counts = {r["key"]: r["count"] for r in by_status}
    total = sum(counts.values())
    done = sum(counts.get(s, 0) for s in DONE_STATUSES)
    overdue = await db.responsibility_items.count_documents(
        {**match, "status": {"$in": OPEN_STATUSES}, "due_at": {"$ne": None, "$lt": now}})
    self_tasks = await db.responsibility_items.count_documents({**match, "is_self_task": True})
    recurring = await db.responsibility_items.count_documents({**match, "series_id": {"$exists": True}})
    prog = await db.responsibility_items.aggregate([
        {"$match": {**match, "status": {"$in": OPEN_STATUSES}}},
        {"$group": {"_id": None, "avg": {"$avg": "$progress_percent"}, "n": {"$sum": 1}}}]).to_list(1)
    completed_in_range = await db.responsibility_items.count_documents(
        {**match, "status": {"$in": DONE_STATUSES},
         "completed_at": {"$gte": f["date_from"], "$lte": f["date_to"]}})
    users = await _username_map(center_id)
    by_member = await _group_count(db.responsibility_items,
                                   {**match, "status": {"$in": OPEN_STATUSES}}, "assignee_ids",
                                   unwind=True)
    for r in by_member:
        r["label"] = "@" + _uname(users, r["key"]) if r["key"] != "—" else "Unassigned"
    units = {u["id"]: u["name"] async for u in db.responsibility_center_units.find(
        {"center_id": center_id}, {"_id": 0, "id": 1, "name": 1})}
    by_unit = await _group_count(db.responsibility_items,
                                 {**match, "status": {"$in": OPEN_STATUSES}}, "unit_id")
    for r in by_unit:
        r["label"] = units.get(r["key"], "No unit")
    return {"summary": {"total_items": total, "open": sum(counts.get(s, 0) for s in OPEN_STATUSES),
                        "completed": done, "completed_in_range": completed_in_range,
                        "overdue": overdue, "blocked": counts.get("blocked", 0),
                        "waiting": counts.get("waiting", 0),
                        "pending_approval": counts.get("pending_approval", 0),
                        "completion_rate": round(done * 100 / total, 1) if total else 0,
                        "avg_open_progress": round((prog[0]["avg"] or 0), 1) if prog else 0,
                        "self_tasks": self_tasks, "recurring_items": recurring},
            "breakdowns": {"by_status": by_status, "by_priority": await _group_count(db.responsibility_items, match, "priority"),
                           "by_type": await _group_count(db.responsibility_items, match, "item_type"),
                           "by_member": by_member, "by_unit": by_unit},
            "rows": [], "columns": []}


async def member_workload(center_id: str, f: dict, ctx: dict) -> dict:
    users = await _username_map(center_id)
    ms = await db.responsibility_center_memberships.find(
        {"center_id": center_id, "status": {"$in": ["active", "paused"]}},
        {"_id": 0, "user_id": 1, "role": 1, "status": 1}).to_list(500)
    now = datetime.now(timezone.utc)
    soon = (now + timedelta(hours=72)).isoformat()
    rows = []
    for m in ms:
        if f["member_id"] and m["user_id"] != f["member_id"]:
            continue
        base = {"center_id": center_id, "is_series": {"$ne": True}, "assignee_ids": m["user_id"]}
        open_n = await db.responsibility_items.count_documents({**base, "status": {"$in": OPEN_STATUSES}})
        overdue = await db.responsibility_items.count_documents(
            {**base, "status": {"$in": OPEN_STATUSES}, "due_at": {"$ne": None, "$lt": now.isoformat()}})
        due_soon = await db.responsibility_items.count_documents(
            {**base, "status": {"$in": OPEN_STATUSES}, "due_at": {"$gte": now.isoformat(), "$lte": soon}})
        done = await db.responsibility_items.count_documents(
            {**base, "status": {"$in": DONE_STATUSES},
             "completed_at": {"$gte": f["date_from"], "$lte": f["date_to"]}})
        pending = await db.responsibility_items.count_documents(
            {"center_id": center_id, "approver_id": m["user_id"], "status": "pending_approval"})
        rows.append({"member": "@" + _uname(users, m["user_id"]), "role": m["role"],
                     "member_status": m["status"], "open_items": open_n, "overdue": overdue,
                     "due_soon": due_soon, "completed_in_range": done,
                     "pending_my_approval": pending,
                     "workload": "high" if open_n >= 10 else "medium" if open_n >= 4 else "light"})
    rows.sort(key=lambda r: -r["open_items"])
    cols = ["member", "role", "member_status", "open_items", "overdue", "due_soon",
            "completed_in_range", "pending_my_approval", "workload"]
    return {"summary": {"members": len(rows), "total_open": sum(r["open_items"] for r in rows),
                        "total_overdue": sum(r["overdue"] for r in rows)},
            "breakdowns": {}, "rows": rows, "columns": cols,
            "note": "Workload indicators are planning aids only — never medical, legal, employment, or disciplinary conclusions."}


async def unit_workload(center_id: str, f: dict, ctx: dict) -> dict:
    users = await _username_map(center_id)
    units = await db.responsibility_center_units.find(
        {"center_id": center_id, **({} if f["include_archived"] else {"status": "active"})},
        {"_id": 0}).to_list(300)
    rows = []
    for u in units:
        if f["unit_id"] and u["id"] != f["unit_id"]:
            continue
        base = {"center_id": center_id, "unit_id": u["id"], "is_series": {"$ne": True}}
        members = await db.responsibility_center_unit_memberships.count_documents(
            {"unit_id": u["id"], "status": "active"})
        open_n = await db.responsibility_items.count_documents({**base, "status": {"$in": OPEN_STATUSES}})
        done = await db.responsibility_items.count_documents({**base, "status": {"$in": DONE_STATUSES}})
        overdue = await db.responsibility_items.count_documents(
            {**base, "status": {"$in": OPEN_STATUSES}, "due_at": {"$ne": None, "$lt": _iso()}})
        shared = await db.responsibility_items.count_documents({**base, "unit_shared": True})
        total = open_n + done
        rows.append({"unit": u["name"], "unit_type": u["unit_type"], "status": u["status"],
                     "leader": ("@" + _uname(users, u["leader_id"])) if u.get("leader_id") else "—",
                     "members": members, "open_work": open_n, "completed_work": done,
                     "overdue": overdue, "shared_assignments": shared,
                     "individual_assignments": max(total - shared, 0),
                     "completion_rate": round(done * 100 / total, 1) if total else 0})
    cols = ["unit", "unit_type", "status", "leader", "members", "open_work", "completed_work",
            "overdue", "shared_assignments", "individual_assignments", "completion_rate"]
    return {"summary": {"units": len(rows), "total_open": sum(r["open_work"] for r in rows)},
            "breakdowns": {}, "rows": rows, "columns": cols}


async def approval_report(center_id: str, f: dict, ctx: dict) -> dict:
    users = await _username_map(center_id)
    match = {"center_id": center_id, "created_at": {"$gte": f["date_from"], "$lte": f["date_to"]}}
    by_decision = await _group_count(db.responsibility_item_approvals, match, "decision")
    rows = []
    async for a in db.responsibility_item_approvals.find(match, {"_id": 0}).sort("created_at", -1).limit(200):
        item = await db.responsibility_items.find_one({"id": a.get("item_id")}, {"_id": 0, "title": 1, "item_type": 1})
        rows.append({"item": (item or {}).get("title", "—"), "item_type": (item or {}).get("item_type", "—"),
                     "decision": a.get("decision") or a.get("status") or "pending",
                     "approver": "@" + _uname(users, a.get("approver_id") or a.get("decided_by")),
                     "cycle": a.get("cycle", 1), "decided_at": a.get("decided_at") or "—",
                     "note": (a.get("note") or "")[:200]})
    pending = await db.responsibility_items.count_documents(
        {"center_id": center_id, "status": "pending_approval", "is_series": {"$ne": True}})
    cols = ["item", "item_type", "decision", "approver", "cycle", "decided_at", "note"]
    return {"summary": {"decisions_in_range": sum(r["count"] for r in by_decision),
                        "currently_pending": pending},
            "breakdowns": {"by_decision": by_decision}, "rows": rows, "columns": cols}


# ── ATTENDANCE / CALENDAR ────────────────────────────────────────────────
def _event_match(center_id, f):
    m = {"center_id": center_id, "is_series": {"$ne": True},
         "start_at": {"$gte": f["date_from"], "$lte": f["date_to"]}}
    if f["unit_id"]:
        m["unit_id"] = f["unit_id"]
    if f["event_type"]:
        m["event_type"] = f["event_type"]
    return m


async def attendance_summary(center_id: str, f: dict, ctx: dict) -> dict:
    match = {**_event_match(center_id, f), "attendance_enabled": True}
    counts = {k: 0 for k in ("present", "absent", "late", "excused", "remote", "not_required", "unknown")}
    events = 0
    expected = 0
    by_type = {}
    async for ev in db.responsibility_center_calendar_events.find(match, {"_id": 0, "attendees": 1, "event_type": 1}):
        events += 1
        by_type[ev.get("event_type") or "event"] = by_type.get(ev.get("event_type") or "event", 0) + 1
        for a in ev.get("attendees") or []:
            expected += 1
            counts[a.get("attendance") or "unknown"] = counts.get(a.get("attendance") or "unknown", 0) + 1
    marked = expected - counts["unknown"]
    return {"summary": {"attendance_enabled_events": events, "expected_attendees": expected,
                        **counts,
                        "marking_completion_rate": round(marked * 100 / expected, 1) if expected else 0},
            "breakdowns": {"by_event_type": [{"key": k, "count": v} for k, v in sorted(by_type.items(), key=lambda x: -x[1])],
                           "by_attendance": [{"key": k, "count": v} for k, v in counts.items() if v]},
            "rows": [], "columns": []}


async def attendance_detail(center_id: str, f: dict, ctx: dict) -> dict:
    if "view_detailed_attendance" not in ctx["perms"]:
        raise HTTPException(status_code=403, detail="You can't view detailed attendance records")
    users = await _username_map(center_id)
    units = {u["id"]: u["name"] async for u in db.responsibility_center_units.find(
        {"center_id": center_id}, {"_id": 0, "id": 1, "name": 1})}
    rows = []
    match = {**_event_match(center_id, f), "attendance_enabled": True}
    async for ev in db.responsibility_center_calendar_events.find(match, {"_id": 0}).sort("start_at", -1).limit(300):
        for a in ev.get("attendees") or []:
            if f["member_id"] and a["user_id"] != f["member_id"]:
                continue
            rows.append({"event": ev["title"], "event_type": ev["event_type"],
                         "date": ev["start_at"], "unit": units.get(ev.get("unit_id"), "—"),
                         "member": "@" + _uname(users, a["user_id"]),
                         "attendance": a.get("attendance") or "unknown",
                         "note": (a.get("note") or "")[:120],
                         "marked_by": ("@" + _uname(users, a.get("marked_by"))) if a.get("marked_by") else "—",
                         "marked_at": a.get("marked_at") or "—"})
    changes = await db.responsibility_center_unit_activity.count_documents(
        {"center_id": center_id, "action": "attendance_changed",
         "created_at": {"$gte": f["date_from"], "$lte": f["date_to"]}})
    cols = ["event", "event_type", "date", "unit", "member", "attendance", "note", "marked_by", "marked_at"]
    return {"summary": {"records": len(rows), "attendance_changes_logged": changes},
            "breakdowns": {}, "rows": rows[:1000], "columns": cols,
            "note": "Attendance records are private, permission-scoped planning data — not a legally certified record."}


async def calendar_summary(center_id: str, f: dict, ctx: dict) -> dict:
    users = await _username_map(center_id)
    match = _event_match(center_id, f)
    by_type = await _group_count(db.responsibility_center_calendar_events, match, "event_type")
    by_status = await _group_count(db.responsibility_center_calendar_events, match, "status")
    by_org = await _group_count(db.responsibility_center_calendar_events, match, "organizer_id", 15)
    for r in by_org:
        r["label"] = "@" + _uname(users, r["key"]) if r["key"] != "—" else "—"
    rsvp = {"accepted": 0, "declined": 0, "maybe": 0, "pending": 0}
    async for ev in db.responsibility_center_calendar_events.find(match, {"_id": 0, "attendees": 1}):
        for a in ev.get("attendees") or []:
            rsvp[a.get("response") or "pending"] = rsvp.get(a.get("response") or "pending", 0) + 1
    total = sum(r["count"] for r in by_status)
    canceled = next((r["count"] for r in by_status if r["key"] == "canceled"), 0)
    series = await db.responsibility_center_calendar_events.count_documents(
        {"center_id": center_id, "is_series": True})
    overrides = await db.responsibility_center_activity_logs.count_documents(
        {"center_id": center_id, "action": "calendar_conflict_overridden",
         "created_at": {"$gte": f["date_from"], "$lte": f["date_to"]}})
    att_enabled = await db.responsibility_center_calendar_events.count_documents(
        {**match, "attendance_enabled": True})
    return {"summary": {"total_events": total, "canceled": canceled,
                        "recurring_series": series, "attendance_enabled": att_enabled,
                        "conflict_overrides": overrides, **{f"rsvp_{k}": v for k, v in rsvp.items()}},
            "breakdowns": {"by_event_type": by_type, "by_status": by_status, "by_organizer": by_org},
            "rows": [], "columns": []}


# ── FIRE POWER / VAULT / RENEWALS ────────────────────────────────────────
async def fire_power_activity(center_id: str, f: dict, ctx: dict) -> dict:
    users = await _username_map(center_id)
    match = {"center_id": center_id, "created_at": {"$gte": f["date_from"], "$lte": f["date_to"]}}
    by_type = []
    async for r in db.responsibility_center_transactions.aggregate([
            {"$match": match},
            {"$group": {"_id": "$transaction_type", "n": {"$sum": 1}, "fp": {"$sum": "$amount"}}},
            {"$sort": {"n": -1}}]):
        by_type.append({"key": r["_id"] or "—", "count": r["n"], "fire_power": abs(r["fp"] or 0)})
    rows = []
    async for t in db.responsibility_center_transactions.find(match, {"_id": 0}).sort("created_at", -1).limit(500):
        rows.append({"date": t.get("created_at"), "type": t.get("transaction_type"),
                     "fire_power": t.get("amount"), "result": t.get("status") or "completed",
                     "actor": ("@" + _uname(users, t.get("user_id"))) if t.get("user_id") else "—",
                     "note": str((t.get("meta") or {}).get("reason") or "")[:120]})
    cols = ["date", "type", "fire_power", "result", "actor", "note"]
    return {"summary": {"transactions": len(rows),
                        "total_fire_power_activity": sum(abs(t.get("fire_power") or 0) for t in rows)},
            "breakdowns": {"by_type": by_type}, "rows": rows, "columns": cols}


async def vault_report(center_id: str, f: dict, ctx: dict) -> dict:
    center = ctx["center"]
    match = {"center_id": center_id, "created_at": {"$gte": f["date_from"], "$lte": f["date_to"]}}
    added = burned = 0
    daily = {}
    async for t in db.responsibility_center_transactions.find(match, {"_id": 0, "amount": 1, "created_at": 1}):
        amt = t.get("amount") or 0
        day = (t.get("created_at") or "")[:10]
        daily[day] = daily.get(day, 0) + amt
        if amt > 0:
            added += amt
        else:
            burned += -amt
    seat_cost = 100
    active_members = await db.responsibility_center_memberships.count_documents(
        {"center_id": center_id, "status": "active"})
    balance = center.get("vault_balance") or 0
    return {"summary": {"current_vault_balance": balance, "fire_power_added": added,
                        "fire_power_burned": burned,
                        "vault_frozen": bool(center.get("vault_frozen")),
                        "active_members": active_members,
                        "estimated_periods_covered": round(balance / (seat_cost * max(active_members - 1, 1)), 1)
                        if active_members > 1 else None,
                        "final_balance_if_closed": (center.get("closure") or {}).get("final_vault_balance")},
            "breakdowns": {"net_by_day": [{"key": k, "count": v} for k, v in sorted(daily.items())]},
            "rows": [], "columns": []}


async def renewal_report(center_id: str, f: dict, ctx: dict) -> dict:
    users = await _username_map(center_id)
    match = {"center_id": center_id, "created_at": {"$gte": f["date_from"], "$lte": f["date_to"]}}
    by_result = await _group_count(db.responsibility_center_renewal_attempts, match, "result")
    rows = []
    async for a in db.responsibility_center_renewal_attempts.find(match, {"_id": 0}).sort("created_at", -1).limit(300):
        rows.append({"date": a.get("created_at"),
                     "member": "@" + _uname(users, a.get("membership_user_id")),
                     "result": a.get("result"),
                     "fire_power_required": a.get("fire_power_needed") or a.get("amount") or 100,
                     "reason": str(a.get("detail") or "")[:120]})
    paused = await db.responsibility_center_memberships.count_documents(
        {"center_id": center_id, "status": "paused"})
    cols = ["date", "member", "result", "fire_power_required", "reason"]
    return {"summary": {"attempts_in_range": len(rows), "currently_paused_members": paused},
            "breakdowns": {"by_result": by_result}, "rows": rows, "columns": cols}


# ── MEMBERSHIP / LIFECYCLE ───────────────────────────────────────────────
async def membership_summary(center_id: str, f: dict, ctx: dict) -> dict:
    users = await _username_map(center_id)
    by_status = await _group_count(db.responsibility_center_memberships, {"center_id": center_id}, "status")
    by_role = await _group_count(db.responsibility_center_memberships,
                                 {"center_id": center_id, "status": "active"}, "role")
    rows = []
    async for m in db.responsibility_center_memberships.find({"center_id": center_id}, {"_id": 0}).limit(500):
        um = await db.responsibility_center_unit_memberships.count_documents(
            {"center_id": center_id, "user_id": m["user_id"], "status": "active"})
        rows.append({"member": "@" + _uname(users, m["user_id"]), "role": m.get("role"),
                     "status": m.get("status"), "joined_at": m.get("joined_at") or "—",
                     "left_at": m.get("left_at") or "—", "active_unit_memberships": um})
    cols = ["member", "role", "status", "joined_at", "left_at", "active_unit_memberships"]
    return {"summary": {"total_memberships": len(rows),
                        **{f"status_{r['key']}": r["count"] for r in by_status}},
            "breakdowns": {"by_status": by_status, "by_role": by_role}, "rows": rows, "columns": cols}


async def lifecycle_report(center_id: str, f: dict, ctx: dict) -> dict:
    center = ctx["center"]
    rows = []
    async for a in db.responsibility_center_lifecycle_audit.find(
            {"center_id": center_id}, {"_id": 0}).sort("created_at", -1).limit(300):
        rows.append({"date": a.get("created_at"), "action": a.get("action"),
                     "actor": "@" + (a.get("actor_username") or "—"),
                     "detail": str(a.get("reason") or "")[:150]})
    transfers = await db.responsibility_center_transfers.count_documents({"center_id": center_id})
    closure = center.get("closure") or {}
    cols = ["date", "action", "actor", "detail"]
    return {"summary": {"center_status": center.get("status") or "active",
                        "ownership_transfers_recorded": transfers,
                        "retention_hold": bool(closure.get("retention_hold")),
                        "closure_state": closure.get("status") or "none",
                        "lifecycle_events": len(rows),
                        "permanent_deletion": "not implemented — closure is a locked, retained state"},
            "breakdowns": {}, "rows": rows, "columns": cols}


# ── REGISTRY ─────────────────────────────────────────────────────────────
REPORTS = {
    "work_summary": {"name": "Responsibility & Task Summary", "category": "Work & Progress",
                     "perm": "view_work_reports", "fn": work_summary,
                     "description": "Totals, completion rate, overdue, and breakdowns by status, priority, member, and unit."},
    "member_workload": {"name": "Member Workload", "category": "Work & Progress",
                        "perm": "view_member_workload", "fn": member_workload,
                        "description": "Open items, overdue, due soon, and completions per member."},
    "unit_workload": {"name": "Unit Workload", "category": "Work & Progress",
                      "perm": "view_unit_workload", "fn": unit_workload,
                      "description": "Open and completed work, overdue, and assignment modes per group."},
    "approval_report": {"name": "Approval Report", "category": "Work & Progress",
                        "perm": "view_approval_reports", "fn": approval_report,
                        "description": "Immutable approval decisions, cycles, and pending approvals."},
    "attendance_summary": {"name": "Attendance Summary", "category": "Attendance & Calendar",
                           "perm": "view_attendance_reports", "fn": attendance_summary,
                           "description": "Status distribution and marking completion for attendance-enabled events."},
    "attendance_detail": {"name": "Attendance Detail", "category": "Attendance & Calendar",
                          "perm": "view_detailed_attendance", "fn": attendance_detail,
                          "description": "Per-member attendance records with notes and marked-by identity."},
    "calendar_summary": {"name": "Calendar & Events", "category": "Attendance & Calendar",
                         "perm": "view_attendance_reports", "fn": calendar_summary,
                         "description": "Events by type, organizer, RSVPs, cancellations, and conflict overrides."},
    "fire_power_activity": {"name": "Fire Power Activity", "category": "Fire Power & Vault",
                            "perm": "view_fire_power_reports", "fn": fire_power_activity,
                            "description": "Every Fire Power burn, transfer, adjustment, and reversal in range."},
    "vault_report": {"name": "Center Vault", "category": "Fire Power & Vault",
                     "perm": "view_vault_reports", "fn": vault_report,
                     "description": "Vault balance, Fire Power added and burned, and coverage estimate."},
    "renewal_report": {"name": "Seat Activations & Renewals", "category": "Fire Power & Vault",
                       "perm": "view_renewal_reports", "fn": renewal_report,
                       "description": "Renewal attempts, results, and paused members."},
    "membership_summary": {"name": "Membership Summary", "category": "Members & Units",
                           "perm": "view_reports", "fn": membership_summary,
                           "description": "Members by status and role, join/leave history, unit memberships."},
    "lifecycle_report": {"name": "Lifecycle History", "category": "Lifecycle",
                         "perm": "view_lifecycle_reports", "fn": lifecycle_report,
                         "description": "Ownership, pause/archive/restore, closure, and retention-hold history."},
}


async def run_report(user: dict, center_id: str, report_key: str, filters: dict) -> dict:
    meta = REPORTS.get(report_key)
    if not meta:
        raise HTTPException(status_code=404, detail="Unknown report")
    center, membership, perms = await _ctx(center_id, user, "view_reports", write=False)
    if meta["perm"] not in perms:
        raise HTTPException(status_code=403, detail="You don't have access to this report")
    f = parse_filters(filters)
    ctx = {"center": center, "membership": membership, "perms": perms}
    data = await meta["fn"](center_id, f, ctx)
    return {"report_key": report_key, "name": meta["name"], "category": meta["category"],
            "filters": f, "generated_at": _iso(), "timezone": center.get("timezone") or "UTC",
            "center_name": center.get("name"), **data}


async def report_catalog(user: dict, center_id: str) -> dict:
    center, membership, perms = await _ctx(center_id, user, "view_reports", write=False)
    cats = {}
    for key, meta in REPORTS.items():
        if meta["perm"] in perms:
            cats.setdefault(meta["category"], []).append(
                {"report_key": key, "name": meta["name"], "description": meta["description"]})
    return {"categories": [{"category": c, "reports": r} for c, r in cats.items()],
            "can_export": "export_reports" in perms,
            "timezone": center.get("timezone") or "UTC"}


# ── Admin platform analytics (aggregated, no private content) ────────────
async def admin_reports_overview(date_from: str, date_to: str) -> dict:
    rng = {"$gte": date_from, "$lte": date_to}
    out = {"centers_created": await db.responsibility_centers.count_documents({"created_at": rng}),
           "centers_by_status": await _group_count(db.responsibility_centers, {}, "status"),
           "centers_by_type": await _group_count(db.responsibility_centers, {}, "center_type"),
           "memberships_activated": await db.responsibility_center_memberships.count_documents(
               {"joined_at": rng, "status": {"$in": ["active", "paused"]}}),
           "renewal_attempts": await db.responsibility_center_renewal_attempts.count_documents({"created_at": rng}),
           "renewal_failures": await db.responsibility_center_renewal_attempts.count_documents(
               {"created_at": rng, "result": {"$in": ["failed", "insufficient"]}}),
           "items_created": await db.responsibility_items.count_documents({"created_at": rng}),
           "items_completed": await db.responsibility_items.count_documents({"completed_at": rng}),
           "events_created": await db.responsibility_center_calendar_events.count_documents(
               {"created_at": rng, "is_series": {"$ne": True}}),
           "units_created": await db.responsibility_center_units.count_documents({"created_at": rng}),
           "attendance_enabled_events": await db.responsibility_center_calendar_events.count_documents(
               {"created_at": rng, "attendance_enabled": True}),
           "report_exports": await db.responsibility_center_report_runs.count_documents({"created_at": rng}),
           "closure_requests": await db.responsibility_center_lifecycle_audit.count_documents(
               {"created_at": rng, "action": {"$regex": "^closure"}})}
    return out
