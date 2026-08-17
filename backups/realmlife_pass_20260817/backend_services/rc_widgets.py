"""Responsibility Center — Bundle G widget engine + universal search.

ONE widget registry and ONE permission-aware search across all Center
types. Widgets load through a single combined dashboard endpoint.
"""
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from core.db import db
from services import responsibility_center as rc
from services.rc_units import _ctx

OPEN = ["assigned", "accepted", "in_progress", "waiting", "blocked",
        "submitted", "pending_approval", "changes_requested", "draft"]


def _iso(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()


WIDGETS = {
    "center_status":      {"name": "Center Status", "perm": None},
    "my_work":            {"name": "My Work", "perm": None},
    "due_today":          {"name": "Due Today", "perm": None},
    "overdue":            {"name": "Overdue", "perm": None},
    "pending_approvals":  {"name": "Pending Approvals", "perm": "approve_items"},
    "upcoming_calendar":  {"name": "Upcoming Calendar", "perm": "view_calendar"},
    "unit_summary":       {"name": "Groups Summary", "perm": "view_units"},
    "member_summary":     {"name": "Members Summary", "perm": "view_activity"},
    "vault_balance":      {"name": "Center Vault", "perm": "view_vault"},
    "recent_activity":    {"name": "Recent Activity", "perm": "view_activity"},
    "attendance_summary": {"name": "My Attendance", "perm": "view_calendar"},
    "birthdays_upcoming": {"name": "Birthdays & Important Dates", "perm": "view_calendar"},
}
SYSTEM_LAYOUT = ["center_status", "my_work", "due_today", "upcoming_calendar", "recent_activity"]


async def _resolve_layout(center_id: str, user_id: str):
    for scope, q in (("user", {"center_id": center_id, "layout_scope": "user", "user_id": user_id}),
                     ("center_default", {"center_id": center_id, "layout_scope": "center_default"})):
        doc = await db.responsibility_center_widget_layouts.find_one(q, {"_id": 0})
        if doc:
            return doc
    return {"layout_scope": "system", "layout": [{"widget_key": w} for w in SYSTEM_LAYOUT], "version": 0}


async def _widget_data(key: str, center, user, perms) -> dict:
    cid, uid = center["id"], user["id"]
    now = datetime.now(timezone.utc)
    if key == "center_status":
        active = await db.responsibility_center_memberships.count_documents({"center_id": cid, "status": "active"})
        open_n = await db.responsibility_items.count_documents(
            {"center_id": cid, "is_series": {"$ne": True}, "status": {"$in": OPEN}})
        return {"status": center.get("status") or "active", "members": active, "open_items": open_n}
    if key in ("my_work", "due_today", "overdue"):
        base = {"center_id": cid, "assignee_ids": uid, "is_series": {"$ne": True}, "status": {"$in": OPEN}}
        if key == "my_work":
            n = await db.responsibility_items.count_documents(base)
            done = await db.responsibility_items.count_documents(
                {"center_id": cid, "assignee_ids": uid, "status": {"$in": ["completed", "approved"]},
                 "completed_at": {"$gte": (now - timedelta(days=7)).isoformat()}})
            return {"open": n, "completed_7d": done}
        q = {**base, "due_at": {"$ne": None, "$lt": now.replace(hour=23, minute=59).isoformat()}} if key == "due_today" \
            else {**base, "due_at": {"$ne": None, "$lt": now.isoformat()}}
        rows = await db.responsibility_items.find(q, {"_id": 0, "id": 1, "title": 1, "due_at": 1, "priority": 1}) \
            .sort("due_at", 1).to_list(5)
        return {"items": rows, "count": len(rows)}
    if key == "pending_approvals":
        n = await db.responsibility_items.count_documents(
            {"center_id": cid, "approver_id": uid, "status": "pending_approval"})
        return {"count": n}
    if key == "upcoming_calendar":
        rows = await db.responsibility_center_calendar_events.find(
            {"center_id": cid, "is_series": {"$ne": True}, "status": "scheduled",
             "start_at": {"$gte": now.isoformat(), "$lte": (now + timedelta(days=7)).isoformat()}},
            {"_id": 0, "id": 1, "title": 1, "event_type": 1, "start_at": 1, "visibility": 1, "attendees": 1, "unit_id": 1, "organizer_id": 1, "created_by": 1}).sort("start_at", 1).to_list(20)
        from services.rc_calendar import _can_see_event, _my_unit_ids
        my_units = await _my_unit_ids(cid, uid)
        vis = [{"id": e["id"], "title": e["title"], "event_type": e["event_type"], "start_at": e["start_at"]}
               for e in rows if _can_see_event(e, uid, perms, my_units)][:5]
        return {"events": vis}
    if key == "unit_summary":
        n = await db.responsibility_center_units.count_documents({"center_id": cid, "status": "active"})
        mine = await db.responsibility_center_unit_memberships.count_documents(
            {"center_id": cid, "user_id": uid, "status": "active"})
        return {"active_units": n, "my_units": mine}
    if key == "member_summary":
        rows = {}
        async for r in db.responsibility_center_memberships.aggregate(
                [{"$match": {"center_id": cid}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
            rows[r["_id"]] = r["n"]
        return rows
    if key == "vault_balance":
        return {"vault_balance": center.get("vault_balance") or 0,
                "frozen": bool(center.get("vault_frozen"))}
    if key == "recent_activity":
        rows = await db.responsibility_center_activity_logs.find(
            {"center_id": cid}, {"_id": 0, "action": 1, "detail": 1, "created_at": 1}) \
            .sort("created_at", -1).to_list(5)
        return {"entries": rows}
    if key == "attendance_summary":
        # Bundle G attendance streak foundation — own data only, informational
        since = (now - timedelta(days=30)).isoformat()
        evs = await db.responsibility_center_calendar_events.find(
            {"center_id": cid, "attendance_enabled": True, "attendees.user_id": uid,
             "is_series": {"$ne": True}, "start_at": {"$gte": since, "$lte": now.isoformat()}},
            {"_id": 0, "attendees": 1, "start_at": 1}).sort("start_at", -1).to_list(60)
        marks = []
        for e in evs:
            a = next((x for x in e["attendees"] if x["user_id"] == uid), None)
            if a and (a.get("attendance") or "unknown") != "unknown":
                marks.append(a["attendance"])
        streak = 0
        for m in marks:
            if m in ("present", "remote"):
                streak += 1
            else:
                break
        return {"events_marked_30d": len(marks),
                "present_30d": sum(1 for m in marks if m in ("present", "remote")),
                "current_streak": streak,
                "note": "Informational only — never a disciplinary or performance record."}
    if key == "birthdays_upcoming":
        rows = await db.responsibility_center_calendar_events.find(
            {"center_id": cid, "event_type": {"$in": ["birthday", "important_date"]},
             "status": "scheduled", "start_at": {"$gte": now.isoformat(),
                                                 "$lte": (now + timedelta(days=60)).isoformat()}},
            {"_id": 0, "id": 1, "title": 1, "start_at": 1}).sort("start_at", 1).to_list(5)
        return {"events": rows}
    return {}


async def dashboard(user: dict, center_id: str) -> dict:
    """ONE combined endpoint — no per-widget request storms."""
    center, membership, perms = await _ctx(center_id, user, "", write=False)
    layout_doc = await _resolve_layout(center_id, user["id"])
    widgets = []
    my_role = (membership or {}).get("role")
    for slot in layout_doc.get("layout") or []:
        key = slot.get("widget_key")
        meta = WIDGETS.get(key)
        if not meta:
            continue
        if meta["perm"] and meta["perm"] not in perms:
            continue  # unauthorized widgets are hidden, never errored
        roles = slot.get("roles") or []
        if roles and my_role not in roles and "edit_center" not in perms:
            continue  # per-role widget visibility (managers always see everything)
        try:
            data = await _widget_data(key, center, user, perms)
        except Exception:  # noqa: BLE001
            data = {"error": True}
        widgets.append({"widget_key": key, "name": meta["name"],
                        "title": slot.get("title") or meta["name"],
                        "instance_id": slot.get("instance_id"),
                        "locked": bool(slot.get("locked")), "roles": roles,
                        "collapsed": bool(slot.get("collapsed")), "data": data})
    available = [{"widget_key": k, "name": m["name"]} for k, m in WIDGETS.items()
                 if not m["perm"] or m["perm"] in perms]
    return {"scope": layout_doc.get("layout_scope"), "version": layout_doc.get("version", 0),
            "widgets": widgets, "available_widgets": available,
            "can_set_center_default": "edit_center" in perms}


async def save_layout(user: dict, center_id: str, body: dict) -> dict:
    center, membership, perms = await _ctx(center_id, user, "", write=False)
    scope = body.get("scope") or "user"
    if scope not in ("user", "center_default"):
        raise HTTPException(status_code=400, detail="Invalid layout scope")
    if scope == "center_default" and "edit_center" not in perms:
        raise HTTPException(status_code=403, detail="Only Center managers can set the default layout")
    layout = body.get("layout") or []
    if len(layout) > 20:
        raise HTTPException(status_code=400, detail="Too many widgets (max 20)")
    clean, seen = [], set()
    import uuid as _uuid
    for slot in layout:
        key = slot.get("widget_key")
        if key not in WIDGETS:
            continue
        iid = str(slot.get("instance_id") or "")[:32] or _uuid.uuid4().hex[:12]
        if iid in seen:
            continue
        seen.add(iid)
        item = {"widget_key": key, "instance_id": iid,
                "collapsed": bool(slot.get("collapsed")), "locked": bool(slot.get("locked"))}
        if slot.get("title"):
            item["title"] = str(slot["title"])[:60]
        roles = [r for r in (slot.get("roles") or []) if r in ("owner", "admin", "manager", "member")][:4]
        if roles:
            item["roles"] = roles
        clean.append(item)
    q = {"center_id": center_id, "layout_scope": scope}
    if scope == "user":
        q["user_id"] = user["id"]
    existing = await db.responsibility_center_widget_layouts.find_one(q, {"_id": 0, "version": 1})
    if existing and body.get("expected_version") is not None \
            and int(body["expected_version"]) != int(existing.get("version") or 0):
        raise HTTPException(status_code=409, detail="Layout changed elsewhere — reload and try again")
    await db.responsibility_center_widget_layouts.update_one(
        q, {"$set": {"layout": clean, "updated_at": _iso(), "created_by": user["id"]},
            "$inc": {"version": 1},
            "$setOnInsert": {"id": uuid.uuid4().hex, **q, "created_at": _iso()}},
        upsert=True)
    return {"ok": True}


async def reset_layout(user: dict, center_id: str, scope: str = "user") -> dict:
    center, membership, perms = await _ctx(center_id, user, "", write=False)
    if scope == "center_default" and "edit_center" not in perms:
        raise HTTPException(status_code=403, detail="Only Center managers can reset the default layout")
    q = {"center_id": center_id, "layout_scope": scope}
    if scope == "user":
        q["user_id"] = user["id"]
    await db.responsibility_center_widget_layouts.delete_one(q)
    return {"ok": True}


# ── Universal permission-aware search ────────────────────────────────────
def _rx(q: str):
    return {"$regex": re.escape(q.strip()[:80]), "$options": "i"}


async def _search_one_center(center, user, perms, q, limit=6):
    cid, uid = center["id"], user["id"]
    out = []
    from services.rc_items import _can_see
    items = await db.responsibility_items.find(
        {"center_id": cid, "is_series": {"$ne": True}, "title": _rx(q),
         "status": {"$ne": "archived"}}, {"_id": 0}).limit(limit * 3).to_list(limit * 3)
    for it in items:
        if _can_see(it, uid, perms):
            out.append({"type": "item", "id": it["id"], "title": it["title"],
                        "status": it.get("status"), "due_at": it.get("due_at"),
                        "center_id": cid, "center_name": center["name"],
                        "link": f"/responsibility-center/{cid}?tab=work&item={it['id']}"})
        if len([r for r in out if r["type"] == "item"]) >= limit:
            break
    if "view_calendar" in perms:
        from services.rc_calendar import _can_see_event, _my_unit_ids
        my_units = await _my_unit_ids(cid, uid)
        evs = await db.responsibility_center_calendar_events.find(
            {"center_id": cid, "is_series": {"$ne": True}, "title": _rx(q),
             "status": "scheduled"}, {"_id": 0}).limit(limit * 3).to_list(limit * 3)
        for e in evs:
            if _can_see_event(e, uid, perms, my_units):
                out.append({"type": "event", "id": e["id"], "title": e["title"],
                            "status": e.get("event_type"), "due_at": e.get("start_at"),
                            "center_id": cid, "center_name": center["name"],
                            "link": f"/responsibility-center/{cid}?tab=calendar&event={e['id']}"})
            if len([r for r in out if r["type"] == "event"]) >= limit:
                break
    if "view_units" in perms:
        units = await db.responsibility_center_units.find(
            {"center_id": cid, "name": _rx(q), "status": "active",
             "visibility": {"$ne": "leaders"} if "view_private_units" not in perms else {"$exists": True}},
            {"_id": 0, "id": 1, "name": 1, "unit_type": 1}).limit(limit).to_list(limit)
        out += [{"type": "unit", "id": u["id"], "title": u["name"], "status": u["unit_type"],
                 "center_id": cid, "center_name": center["name"],
                 "link": f"/responsibility-center/{cid}?tab=units"} for u in units]
    # members — only matching within centers the user belongs to (no enumeration)
    ms = await db.responsibility_center_memberships.find(
        {"center_id": cid, "status": {"$in": ["active", "paused"]}}, {"_id": 0, "user_id": 1}).to_list(300)
    users = await rc._users_map([m["user_id"] for m in ms])
    for uid2, u2 in users.items():
        if q.lower() in (u2.get("username") or "").lower():
            out.append({"type": "member", "id": uid2, "title": "@" + u2["username"],
                        "center_id": cid, "center_name": center["name"],
                        "link": f"/responsibility-center/{cid}?tab=members"})
    return out


async def search(user: dict, q: str, center_id: str = "") -> dict:
    q = (q or "").strip()
    if len(q) < 2:
        return {"results": [], "query": q}
    results = []
    if center_id:
        center, membership, perms = await _ctx(center_id, user, "", write=False)
        results = await _search_one_center(center, user, perms, q)
    else:
        ms = await db.responsibility_center_memberships.find(
            {"user_id": user["id"], "status": "active"}, {"_id": 0, "center_id": 1, "role": 1}).to_list(20)
        for m in ms:
            center = await db.responsibility_centers.find_one(
                {"id": m["center_id"], "status": {"$in": ["active", "paused", "archived"]}}, {"_id": 0})
            if not center or (center.get("status") or "active") == "closed":
                continue
            if (center.get("status") or "active") != "active" and (m.get("role") or "member") == "member":
                continue  # paused/archived hidden from plain members
            perms = set(rc.ROLE_PERMISSIONS.get(m.get("role") or "member", set()))
            if q.lower() in (center.get("name") or "").lower():
                results.append({"type": "center", "id": center["id"], "title": center["name"],
                                "status": center.get("status") or "active",
                                "center_id": center["id"], "center_name": center["name"],
                                "link": f"/responsibility-center/{center['id']}"})
            results += await _search_one_center(center, user, perms, q, limit=4)
    return {"results": results[:60], "query": q}


# ── Home page combined overview (one request for the whole hub) ─────────
async def home_overview(user: dict) -> dict:
    from services import responsibility_center as _rc
    uid = user["id"]
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    week_ahead = now + timedelta(days=7)
    DONE = ["completed", "approved"]
    CLOSED = ["canceled", "archived", "declined"]

    mems = await db.responsibility_center_memberships.find(
        {"user_id": uid, "status": "active"}, {"_id": 0}).to_list(100)
    cids = [m["center_id"] for m in mems]
    roles = {m["center_id"]: m.get("role") for m in mems}
    managed_ids = [cid for cid, r in roles.items() if r in ("owner", "admin", "manager")]
    centers = await db.responsibility_centers.find(
        {"id": {"$in": cids}, "status": {"$ne": "deleted"}}, {"_id": 0}).to_list(100)
    settings = await _rc.get_rc_settings()
    seat_cost = int(settings.get("seat_cost") or 100)

    # per-center item stats in one aggregation
    stats = {}
    async for row in db.responsibility_items.aggregate([
        {"$match": {"center_id": {"$in": cids}, "is_series": {"$ne": True},
                    "status": {"$nin": CLOSED}}},
        {"$group": {"_id": {"c": "$center_id",
                            "done": {"$in": ["$status", DONE]}},
                    "n": {"$sum": 1}}}]):
        s = stats.setdefault(row["_id"]["c"], {"total": 0, "done": 0})
        s["total"] += row["n"]
        if row["_id"]["done"]:
            s["done"] += row["n"]
    member_counts = {}
    async for row in db.responsibility_center_memberships.aggregate([
        {"$match": {"center_id": {"$in": cids}, "status": "active"}},
        {"$group": {"_id": "$center_id", "n": {"$sum": 1}}}]):
        member_counts[row["_id"]] = row["n"]

    cards = []
    for c in centers:
        cid = c["id"]
        s = stats.get(cid, {"total": 0, "done": 0})
        completion = round(100 * s["done"] / s["total"]) if s["total"] else 0
        members = member_counts.get(cid, 0)
        coverage = min(100, round(100 * (c.get("vault_balance") or 0) / max(1, members * seat_cost)))
        cards.append({"id": cid, "name": c["name"], "center_type": c.get("center_type"),
                      "role": roles.get(cid), "members": members,
                      "open_tasks": s["total"] - s["done"],
                      "completion_pct": completion,
                      "health": round(0.6 * completion + 0.4 * coverage),
                      "vault_balance": int(c.get("vault_balance") or 0),
                      "status": c.get("status") or "active"})
    cards.sort(key=lambda x: -x["health"])

    my_open = {"assignee_ids": uid, "center_id": {"$in": cids}, "is_series": {"$ne": True},
               "status": {"$nin": CLOSED + DONE}}
    responsibilities = await db.responsibility_items.count_documents(
        {**my_open, "item_type": "responsibility"})
    due_today = await db.responsibility_items.count_documents(
        {**my_open, "due_at": {"$gte": today_start.isoformat(),
                               "$lt": (today_start + timedelta(days=1)).isoformat()}})
    approvals = await db.responsibility_items.count_documents(
        {"center_id": {"$in": managed_ids}, "status": "pending_approval",
         "is_series": {"$ne": True}}) if managed_ids else 0
    events_7d = await db.responsibility_center_calendar_events.count_documents(
        {"center_id": {"$in": cids}, "status": {"$ne": "canceled"},
         "start_at": {"$gte": now.isoformat(), "$lt": week_ahead.isoformat()}})
    fire_week = 0
    async for row in db.responsibility_center_transactions.aggregate([
        {"$match": {"center_id": {"$in": cids}, "created_at": {"$gte": week_ago.isoformat()}}},
        {"$group": {"_id": None, "n": {"$sum": 1}}}]):
        fire_week = row["n"]

    # 7-day completion trend (items reaching a done status, by day)
    trend = {}
    async for row in db.responsibility_items.aggregate([
        {"$match": {"center_id": {"$in": cids}, "status": {"$in": DONE},
                    "updated_at": {"$gte": week_ago.isoformat()}}},
        {"$group": {"_id": {"$substr": ["$updated_at", 0, 10]}, "n": {"$sum": 1}}}]):
        trend[row["_id"]] = row["n"]
    trend_days = []
    for i in range(7):
        d = (week_ago + timedelta(days=i)).date().isoformat()
        trend_days.append({"day": d, "completed": trend.get(d, 0)})

    activity = await db.responsibility_center_activity_logs.find(
        {"center_id": {"$in": cids}}, {"_id": 0}).sort("created_at", -1).to_list(10)
    names = {c["id"]: c["name"] for c in centers}
    for a in activity:
        a["center_name"] = names.get(a["center_id"], "")

    # factual alerts only
    alerts = []
    for c in cards:
        if c["status"] != "active":
            alerts.append({"kind": "center_paused", "severity": "high",
                           "center_id": c["id"],
                           "text": f"{c['name']} is {c['status']} — open it to review."})
        elif c["role"] in ("owner", "admin") and c["members"] * seat_cost > c["vault_balance"]:
            alerts.append({"kind": "low_vault", "severity": "medium", "center_id": c["id"],
                           "text": f"{c['name']}: Fire Storage below the next renewal requirement "
                                   f"({c['vault_balance']} 🔥 of {c['members'] * seat_cost} 🔥 needed)."})
    if managed_ids:
        soon = await db.responsibility_center_memberships.count_documents(
            {"center_id": {"$in": managed_ids}, "status": "active",
             "seat_paid_until": {"$lt": week_ahead.isoformat()}})
        if soon:
            alerts.append({"kind": "renewals_soon", "severity": "low", "center_id": None,
                           "text": f"{soon} member seat{'s' if soon != 1 else ''} renew within 7 days."})
    overdue = await db.responsibility_items.count_documents(
        {**my_open, "due_at": {"$lt": now.isoformat(), "$ne": None}})
    if overdue:
        alerts.append({"kind": "overdue", "severity": "high", "center_id": None,
                       "text": f"You have {overdue} overdue item{'s' if overdue != 1 else ''}."})

    enabled_scheds = await db.responsibility_center_scheduled_reports.count_documents(
        {"center_id": {"$in": cids}, "enabled": True}) if cids else 0
    status_rows = [
        {"label": "Auto-Renewals", "ok": bool(settings.get("auto_renewals_enabled")),
         "note": "Paused" if not settings.get("auto_renewals_enabled") else "Operational"},
        {"label": "Scheduled Reports", "ok": True,
         "note": f"{enabled_scheds} active" if enabled_scheds else "None enabled"},
        {"label": "My Centers", "ok": all(c["status"] == "active" for c in cards),
         "note": f"{sum(1 for c in cards if c['status'] == 'active')} of {len(cards)} active"},
        {"label": "Fire Storage",
         "ok": not any(a["kind"] == "low_vault" for a in alerts),
         "note": "Attention needed" if any(a["kind"] == "low_vault" for a in alerts) else "Healthy"},
    ]

    return {"totals": {"centers_managed": len(managed_ids), "centers_total": len(cards),
                       "active_members": sum(member_counts.values()),
                       "responsibilities": responsibilities, "tasks_due_today": due_today,
                       "pending_approvals": approvals, "upcoming_events": events_7d,
                       "fire_activity_week": fire_week},
            "centers": cards, "trend": trend_days, "activity": activity,
            "alerts": alerts, "system_status": status_rows}
