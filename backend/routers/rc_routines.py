"""Digital Routines & Access — original OurRealm routine/access system.

RESPONSIBILITIES FIRST · TRANSPARENT AGREEMENTS · HUMAN APPROVAL.
Honest scope: enforces access to OURREALM features only (courses, ORAi,
etc. — server-side). External/device activity is guidance-only, recorded
and labeled as such. No secret monitoring, no shame mechanics.

Collections: rc_routine_plans, rc_activity_windows, rc_access_requests,
rc_external_activity_entries. Reuses: _ctx permissions, rc_items
(responsibility-first), notifications, activity audit log, ORAi drafts.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from services.rc_units import _ctx
from services import responsibility_center as rc

log = logging.getLogger("ourrealm.rc.routines")
router = APIRouter(prefix="/api/responsibility-center", tags=["rc-routines"])

# OurRealm features that CAN be governed (server-enforceable in-app).
GOVERNABLE = ["courses", "orai", "sounds", "realms", "messenger", "creation", "feed", "entertainment"]
# Never restricted: safety, help, logout, guardian communication (not listed above by design).
WINDOW_KINDS = ["learning", "homework", "creative", "family", "social", "entertainment", "quiet", "sleep", "custom"]
AGE_BANDS = ["young_child", "child", "teen", "young_adult", "adult", "unspecified"]
REQ_KINDS = ["more_time", "exception", "feature_access", "schedule_change", "review"]
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

TEMPLATES = [
    {"id": "balanced_school_day", "name": "Balanced School Day",
     "windows": [("Learning Window", "learning", "15:30", "17:00", DAYS[:5], ["courses", "orai"], [], True),
                 ("Recreation Window", "entertainment", "17:30", "19:00", DAYS[:5], ["entertainment", "realms", "sounds"], [], True),
                 ("Quiet Night", "quiet", "20:30", "07:00", DAYS, [], GOVERNABLE, False)]},
    {"id": "homework_first", "name": "Homework First",
     "windows": [("Homework Window", "homework", "15:00", "17:00", DAYS[:5], ["courses", "orai"], ["entertainment", "realms", "feed"], True),
                 ("Earned Recreation", "entertainment", "17:00", "19:30", DAYS[:5], ["entertainment", "realms", "sounds", "feed"], [], True)]},
    {"id": "family_evening", "name": "Family Evening",
     "windows": [("Family Time", "family", "18:00", "20:00", DAYS, [], ["entertainment", "realms", "feed", "messenger"], False)]},
    {"id": "weekend_flex", "name": "Weekend Flex",
     "windows": [("Weekend Morning Learning", "learning", "09:00", "10:30", ["sat", "sun"], ["courses", "orai"], [], False),
                 ("Weekend Free Time", "entertainment", "10:30", "20:00", ["sat", "sun"], GOVERNABLE, [], False)]},
    {"id": "study_break_cycle", "name": "Study & Break Cycle",
     "windows": [("Focus Block", "learning", "16:00", "16:45", DAYS[:5], ["courses", "orai"], ["entertainment", "feed"], False),
                 ("Break Window", "creative", "16:45", "17:15", DAYS[:5], ["sounds", "creation"], [], False)]},
    {"id": "quiet_night", "name": "Quiet Night",
     "windows": [("Wind-down", "sleep", "21:00", "07:00", DAYS, [], GOVERNABLE, False)]},
    {"id": "homeschool_routine", "name": "Homeschool Routine",
     "windows": [("Morning Lessons", "learning", "09:00", "12:00", DAYS[:5], ["courses", "orai"], ["entertainment", "feed"], True),
                 ("Afternoon Projects", "creative", "13:00", "15:00", DAYS[:5], ["creation", "courses"], [], False)]},
    {"id": "custom_agreement", "name": "Custom Family Agreement",
     "windows": [("Agreed Activity Time", "custom", "16:00", "18:00", DAYS, GOVERNABLE, [], True)]},
]


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _manage(perms: set) -> bool:
    return "edit_center" in perms or "assign_items" in perms


def _hhmm_ok(v):
    try:
        h, m = str(v).split(":")
        return 0 <= int(h) <= 23 and 0 <= int(m) <= 59
    except Exception:
        return False


async def _center_tz(center) -> str:
    return center.get("timezone") or "UTC"


def _now_local(tz_name: str):
    try:
        return datetime.now(ZoneInfo(tz_name))
    except Exception:
        return datetime.now(timezone.utc)


def _window_active(w: dict, now_local) -> bool:
    day = DAYS[now_local.weekday()]
    if day not in (w.get("days") or []):
        return False
    cur = now_local.strftime("%H:%M")
    start, end = w.get("start", "00:00"), w.get("end", "23:59")
    if start <= end:
        return start <= cur < end
    return cur >= start or cur < end  # overnight window


async def _open_responsibilities(center_id: str, user_id: str) -> list:
    now = datetime.now(timezone.utc).isoformat()
    rows = await db.responsibility_items.find(
        {"center_id": center_id, "assignee_ids": user_id,
         "status": {"$nin": ["completed", "approved", "canceled", "archived", "declined"]},
         "due_at": {"$ne": None, "$lt": now[:10] + "T23:59:59.999"}},
        {"_id": 0, "id": 1, "title": 1, "due_at": 1}).to_list(20)
    return rows


async def _active_exception(center_id: str, user_id: str, feature: str):
    now = _iso()
    return await db.rc_access_requests.find_one(
        {"center_id": center_id, "member_id": user_id, "status": "approved",
         "$or": [{"feature": feature}, {"feature": "any"}],
         "exception_expires_at": {"$gt": now}}, {"_id": 0})


async def compute_access(center: dict, user_id: str) -> dict:
    """Server-side truth for what an OurRealm member can use right now."""
    cid = center["id"]
    tz = await _center_tz(center)
    now_local = _now_local(tz)
    plan = await db.rc_routine_plans.find_one({"center_id": cid, "member_id": user_id}, {"_id": 0})
    windows = await db.rc_activity_windows.find(
        {"center_id": cid, "status": "active",
         "$or": [{"member_ids": user_id}, {"member_ids": []}]}, {"_id": 0}).to_list(100)
    open_resp = await _open_responsibilities(cid, user_id)
    blocked, allowed_by, active_windows = {}, {}, []
    for w in windows:
        if _window_active(w, now_local):
            active_windows.append(w)
            for f in w.get("features_unavailable") or []:
                blocked[f] = {"reason": f'"{w["name"]}" window is running', "window": w["name"],
                              "until": w.get("end"), "set_by": w.get("created_by_username"),
                              "changed_at": w.get("updated_at")}
            for f in w.get("features_available") or []:
                allowed_by[f] = w["name"]
    # responsibility-first: entertainment-type features wait for due items
    resp_first = (plan or {}).get("responsibility_first", True)
    if resp_first and open_resp:
        for f in ("entertainment", "realms", "feed"):
            if f not in allowed_by:
                blocked.setdefault(f, {"reason": f"{len(open_resp)} responsibilit{'y is' if len(open_resp) == 1 else 'ies are'} due first",
                                       "responsibilities": [r["title"] for r in open_resp[:5]],
                                       "until": "after your responsibilities are done",
                                       "set_by": "family agreement", "changed_at": (plan or {}).get("updated_at")})
    features = {}
    for f in GOVERNABLE:
        if f in blocked:
            exc = await _active_exception(cid, user_id, f)
            if exc:
                features[f] = {"available": True, "via": "approved exception",
                               "exception_expires_at": exc["exception_expires_at"]}
            else:
                features[f] = {"available": False, **blocked[f]}
        else:
            features[f] = {"available": True, "via": allowed_by.get(f, "no restriction right now")}
    return {"timezone": tz, "local_time": now_local.strftime("%H:%M"),
            "day": DAYS[now_local.weekday()], "features": features,
            "active_windows": [{"id": w["id"], "name": w["name"], "kind": w["kind"],
                                "start": w["start"], "end": w["end"]} for w in active_windows],
            "open_responsibilities": open_resp,
            "plan": plan}


async def check_feature_access(center_id: str, user_id: str, feature: str):
    """Enforcement hook for other services. Raises 423 when blocked."""
    center = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0})
    if not center or feature not in GOVERNABLE:
        return
    membership = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": user_id, "status": "active"}, {"role": 1})
    if not membership or membership.get("role") in ("owner", "admin", "manager"):
        return  # guardians are never locked out of management
    access = await compute_access(center, user_id)
    f = access["features"].get(feature)
    if f and not f["available"]:
        raise HTTPException(status_code=423, detail=(
            f"This is outside your current routine — {f.get('reason', 'a window is active')}. "
            f"Available again: {f.get('until', 'soon')}. You can ask for an exception in Routines & Access."))


# ── Plans ───────────────────────────────────────────────────────────────
@router.get("/{center_id}/routines/overview")
async def routines_overview(center_id: str, current: CurrentUser, member_id: str = ""):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    manage = _manage(perms)
    target = member_id if (member_id and manage) else current["id"]
    if member_id and not manage and member_id != current["id"]:
        raise HTTPException(status_code=403, detail="You can only view your own routine")
    access = await compute_access(center, target)
    windows = await db.rc_activity_windows.find(
        {"center_id": center_id, "status": "active"}, {"_id": 0}).sort("start", 1).to_list(100)
    pending = await db.rc_access_requests.find(
        {"center_id": center_id, "status": "pending",
         **({} if manage else {"member_id": target})}, {"_id": 0}).sort("created_at", -1).to_list(50)
    changes = await db.responsibility_center_activity_logs.find(
        {"center_id": center_id, "action": {"$regex": "^routine|^access_"}},
        {"_id": 0, "action": 1, "detail": 1, "created_at": 1}).sort("created_at", -1).to_list(8)
    members = []
    if manage:
        ms = await db.responsibility_center_memberships.find(
            {"center_id": center_id, "status": "active"}, {"_id": 0, "user_id": 1, "role": 1}).to_list(100)
        for m in ms:
            u = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "username": 1, "name": 1})
            members.append({"user_id": m["user_id"], "role": m["role"],
                            "username": (u or {}).get("username"), "name": (u or {}).get("name")})
    ext_recent = await db.rc_external_activity_entries.count_documents(
        {"center_id": center_id, "member_id": target,
         "created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()}})
    return {"access": access, "windows": windows, "pending_requests": pending,
            "recent_changes": changes, "members": members, "can_manage": manage,
            "member_id": target, "external_entries_7d": ext_recent,
            "governable_features": GOVERNABLE,
            "honesty_note": "Routines govern OurRealm features only. Devices, consoles and other apps are guidance-only in this version."}


@router.put("/{center_id}/routines/plan/{member_id}")
async def upsert_plan(center_id: str, member_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "edit_center")
    patch = {"updated_at": _iso(), "updated_by": current["id"]}
    if body.get("age_band") in AGE_BANDS:
        patch["age_band"] = body["age_band"]  # guardian-entered, never inferred
    for k in ("bedtime", "quiet_start", "quiet_end"):
        if k in body:
            if body[k] and not _hhmm_ok(body[k]):
                raise HTTPException(status_code=400, detail=f"{k} must be HH:MM")
            patch[k] = body[k] or None
    if "responsibility_first" in body:
        patch["responsibility_first"] = bool(body["responsibility_first"])
    if "notes" in body:
        patch["notes"] = str(body["notes"] or "")[:1000]
    if "can_request" in body:
        patch["can_request"] = bool(body["can_request"])
    await db.rc_routine_plans.update_one(
        {"center_id": center_id, "member_id": member_id},
        {"$set": patch, "$setOnInsert": {"id": uuid.uuid4().hex, "created_by": current["id"],
                                         "created_at": _iso(), "version": 1}},
        upsert=True)
    await rc.log_activity(center_id, current, "routine_plan_updated",
                          f"@{current.get('username')} updated a member's routine plan")
    return {"plan": await db.rc_routine_plans.find_one(
        {"center_id": center_id, "member_id": member_id}, {"_id": 0})}


# ── Activity Windows ────────────────────────────────────────────────────
def _clean_window(body: dict) -> dict:
    start, end = body.get("start", "16:00"), body.get("end", "18:00")
    if not (_hhmm_ok(start) and _hhmm_ok(end)):
        raise HTTPException(status_code=400, detail="Times must be HH:MM")
    days = [d for d in (body.get("days") or []) if d in DAYS] or DAYS
    return {"name": str(body.get("name") or "Activity Window")[:120],
            "kind": body.get("kind") if body.get("kind") in WINDOW_KINDS else "custom",
            "start": start, "end": end, "days": days,
            "member_ids": [str(x) for x in (body.get("member_ids") or [])][:50],
            "features_available": [f for f in (body.get("features_available") or []) if f in GOVERNABLE],
            "features_unavailable": [f for f in (body.get("features_unavailable") or []) if f in GOVERNABLE],
            "require_responsibilities": bool(body.get("require_responsibilities")),
            "approval_required": bool(body.get("approval_required")),
            "grace_minutes": max(0, min(60, int(body.get("grace_minutes") or 5))),
            "member_note": str(body.get("member_note") or "")[:500]}


@router.post("/{center_id}/routines/windows")
async def create_window(center_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "edit_center")
    doc = {"id": uuid.uuid4().hex, "center_id": center_id, **_clean_window(body),
           "status": "active", "version": 1, "timezone": await _center_tz(center),
           "created_by": current["id"], "created_by_username": current.get("username"),
           "created_at": _iso(), "updated_at": _iso(), "updated_by": current["id"]}
    await db.rc_activity_windows.insert_one({**doc})
    await rc.log_activity(center_id, current, "routine_window_created",
                          f"@{current.get('username')} created the \"{doc['name']}\" window")
    return {"window": doc}


@router.patch("/{center_id}/routines/windows/{window_id}")
async def update_window(center_id: str, window_id: str, body: dict, current: CurrentUser):
    await _ctx(center_id, current, "edit_center")
    w = await db.rc_activity_windows.find_one({"id": window_id, "center_id": center_id}, {"_id": 0})
    if not w:
        raise HTTPException(status_code=404, detail="Window not found")
    patch = _clean_window({**w, **body})
    if body.get("status") in ("active", "paused"):
        patch["status"] = body["status"]
    patch.update({"updated_at": _iso(), "updated_by": current["id"]})
    await db.rc_activity_windows.update_one({"id": window_id}, {"$set": patch, "$inc": {"version": 1}})
    await rc.log_activity(center_id, current, "routine_window_updated",
                          f"@{current.get('username')} updated the \"{patch['name']}\" window")
    return {"window": await db.rc_activity_windows.find_one({"id": window_id}, {"_id": 0})}


@router.delete("/{center_id}/routines/windows/{window_id}")
async def delete_window(center_id: str, window_id: str, current: CurrentUser):
    await _ctx(center_id, current, "edit_center")
    w = await db.rc_activity_windows.find_one({"id": window_id, "center_id": center_id}, {"name": 1})
    if not w:
        raise HTTPException(status_code=404, detail="Window not found")
    await db.rc_activity_windows.delete_one({"id": window_id})
    await rc.log_activity(center_id, current, "routine_window_deleted",
                          f"@{current.get('username')} removed the \"{w['name']}\" window")
    return {"ok": True}


@router.get("/{center_id}/routines/templates")
async def routine_templates(center_id: str, current: CurrentUser):
    await _ctx(center_id, current, "view_items", write=False)
    return {"templates": [{"id": t["id"], "name": t["name"],
                           "windows": [{"name": n, "kind": k, "start": s, "end": e, "days": d}
                                       for (n, k, s, e, d, _a, _u, _r) in t["windows"]]}
                          for t in TEMPLATES]}


@router.post("/{center_id}/routines/templates/{template_id}/install")
async def install_routine_template(center_id: str, template_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "edit_center")
    t = next((x for x in TEMPLATES if x["id"] == template_id), None)
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    member_ids = [str(x) for x in (body.get("member_ids") or [])][:50]
    created = []
    for (name, kind, start, end, days, avail, unavail, req) in t["windows"]:
        doc = {"id": uuid.uuid4().hex, "center_id": center_id, "name": name, "kind": kind,
               "start": start, "end": end, "days": days, "member_ids": member_ids,
               "features_available": avail, "features_unavailable": unavail,
               "require_responsibilities": req, "approval_required": False,
               "grace_minutes": 5, "member_note": f"From the \"{t['name']}\" template — fully editable.",
               "status": "active", "version": 1, "timezone": await _center_tz(center),
               "created_by": current["id"], "created_by_username": current.get("username"),
               "created_at": _iso(), "updated_at": _iso(), "updated_by": current["id"]}
        await db.rc_activity_windows.insert_one({**doc})
        created.append(doc["id"])
    await rc.log_activity(center_id, current, "routine_template_installed",
                          f"@{current.get('username')} installed the \"{t['name']}\" routine template")
    return {"created_windows": created}


# ── Access Requests (never "buying time") ───────────────────────────────
@router.post("/{center_id}/routines/requests")
async def create_request(center_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    kind = body.get("kind") if body.get("kind") in REQ_KINDS else "exception"
    plan = await db.rc_routine_plans.find_one({"center_id": center_id, "member_id": current["id"]}, {"can_request": 1})
    if plan is not None and plan.get("can_request") is False:
        raise HTTPException(status_code=403, detail="Requests are turned off in your plan — talk to your guardian")
    feature = body.get("feature") if body.get("feature") in GOVERNABLE + ["any"] else "any"
    open_resp = await _open_responsibilities(center_id, current["id"])
    doc = {"id": uuid.uuid4().hex, "center_id": center_id, "member_id": current["id"],
           "member_username": current.get("username"), "kind": kind, "feature": feature,
           "reason": str(body.get("reason") or "")[:600],
           "duration_minutes": max(5, min(480, int(body.get("duration_minutes") or 30))),
           "responsibilities_open": len(open_resp),
           "status": "pending", "decision": None, "decided_by": None, "decided_at": None,
           "guardian_note": None, "exception_expires_at": None, "version": 1,
           "created_at": _iso(), "updated_at": _iso()}
    await db.rc_access_requests.insert_one({**doc})
    managers = await db.responsibility_center_memberships.distinct(
        "user_id", {"center_id": center_id, "status": "active",
                    "role": {"$in": ["owner", "admin", "manager"]}})
    notifs = [{"id": uuid.uuid4().hex, "recipient_id": uid, "kind": "rc_access_request",
               "actor_username": current.get("username"),
               "payload": {"center_id": center_id, "center_name": center["name"],
                           "title": "Access request", "body": f"@{current.get('username')} asked: {doc['reason'][:120] or kind}"},
               "created_at": _iso(), "seen": False} for uid in managers if uid != current["id"]]
    if notifs:
        await db.notifications.insert_many(notifs)
    await rc.log_activity(center_id, current, "access_request_created",
                          f"@{current.get('username')} submitted an access request ({kind})")
    return {"request": doc}


@router.get("/{center_id}/routines/requests")
async def list_requests(center_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    q = {"center_id": center_id}
    if not _manage(perms):
        q["member_id"] = current["id"]
    rows = await db.rc_access_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"requests": rows, "can_manage": _manage(perms)}


@router.post("/{center_id}/routines/requests/{req_id}/decide")
async def decide_request(center_id: str, req_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "edit_center")
    r = await db.rc_access_requests.find_one({"id": req_id, "center_id": center_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Request not found")
    decision = body.get("decision")
    if decision not in ("approve_once", "approve_today", "approve_recurring", "decline", "revoke"):
        raise HTTPException(status_code=400, detail="Unknown decision")
    now = datetime.now(timezone.utc)
    patch = {"decision": decision, "decided_by": current["id"], "decided_at": _iso(),
             "guardian_note": str(body.get("note") or "")[:500], "updated_at": _iso()}
    if decision == "approve_once":
        patch.update(status="approved",
                     exception_expires_at=(now + timedelta(minutes=r["duration_minutes"])).isoformat())
    elif decision == "approve_today":
        patch.update(status="approved",
                     exception_expires_at=now.strftime("%Y-%m-%dT23:59:59.999+00:00"))
    elif decision == "approve_recurring":
        patch.update(status="approved", recurring=True,
                     exception_expires_at=(now + timedelta(days=int(body.get("days") or 7))).isoformat())
    elif decision == "decline":
        patch.update(status="declined")
    elif decision == "revoke":
        if r["status"] != "approved":
            raise HTTPException(status_code=409, detail="Only approved exceptions can be revoked")
        patch.update(status="revoked", exception_expires_at=_iso())
    await db.rc_access_requests.update_one({"id": req_id}, {"$set": patch, "$inc": {"version": 1}})
    await db.notifications.insert_one({
        "id": uuid.uuid4().hex, "recipient_id": r["member_id"], "kind": "rc_access_decision",
        "actor_username": current.get("username"),
        "payload": {"center_id": center_id, "title": "Your access request",
                    "body": f"Decision: {decision.replace('_', ' ')}"
                            + (f" — {patch['guardian_note']}" if patch["guardian_note"] else "")},
        "created_at": _iso(), "seen": False})
    await rc.log_activity(center_id, current, "access_request_decided",
                          f"@{current.get('username')} {decision.replace('_', ' ')} @{r.get('member_username')}'s request")
    return {"request": await db.rc_access_requests.find_one({"id": req_id}, {"_id": 0})}


# ── External activity journal (guidance-only, honestly labeled) ─────────
@router.post("/{center_id}/routines/external")
async def add_external_entry(center_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    member_id = body.get("member_id") or current["id"]
    if member_id != current["id"] and not _manage(perms):
        raise HTTPException(status_code=403, detail="You can only record your own activity")
    doc = {"id": uuid.uuid4().hex, "center_id": center_id, "member_id": member_id,
           "activity": str(body.get("activity") or "")[:200],
           "minutes": max(1, min(1440, int(body.get("minutes") or 30))),
           "source": "parent_recorded" if member_id != current["id"] else "self_reported",
           "note": str(body.get("note") or "")[:400],
           "recorded_by": current["id"], "created_at": _iso(), "version": 1}
    if not doc["activity"]:
        raise HTTPException(status_code=400, detail="Describe the activity")
    await db.rc_external_activity_entries.insert_one({**doc})
    return {"entry": doc, "label": "Recorded activity — not device-verified"}


@router.get("/{center_id}/routines/external")
async def list_external(center_id: str, current: CurrentUser, member_id: str = ""):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    target = member_id if (member_id and _manage(perms)) else current["id"]
    rows = await db.rc_external_activity_entries.find(
        {"center_id": center_id, "member_id": target}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"entries": rows, "disclaimer": "Self-reported and parent-recorded entries are guidance only — not verified device usage."}


# ── Weekly report (data sources labeled) ────────────────────────────────
@router.get("/{center_id}/routines/report")
async def routines_report(center_id: str, current: CurrentUser, member_id: str = ""):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    target = member_id if (member_id and _manage(perms)) else current["id"]
    week = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    completed = await db.responsibility_items.count_documents(
        {"center_id": center_id, "assignee_ids": target,
         "status": {"$in": ["completed", "approved"]}, "completed_at": {"$gte": week}})
    lessons = await db.rc_course_progress.count_documents(
        {"center_id": center_id, "user_id": target, "status": "completed", "completed_at": {"$gte": week}})
    reqs = await db.rc_access_requests.find(
        {"center_id": center_id, "member_id": target, "created_at": {"$gte": week}},
        {"_id": 0, "status": 1}).to_list(200)
    ext = await db.rc_external_activity_entries.find(
        {"center_id": center_id, "member_id": target, "created_at": {"$gte": week}},
        {"_id": 0, "minutes": 1, "source": 1}).to_list(200)
    changes = await db.responsibility_center_activity_logs.count_documents(
        {"center_id": center_id, "action": {"$regex": "^routine"}, "created_at": {"$gte": week}})
    return {"member_id": target, "period": "last 7 days",
            "system_recorded": {"responsibilities_completed": completed, "lessons_completed": lessons,
                                "access_requests": len(reqs),
                                "approved_exceptions": sum(1 for r in reqs if r["status"] == "approved"),
                                "schedule_changes": changes,
                                "label": "System-recorded OurRealm activity"},
            "user_entered": {"external_minutes": sum(e["minutes"] for e in ext),
                             "entries": len(ext),
                             "label": "User-entered external activity — guidance only, not device-verified"},
            "missing_data": "Device, console and third-party app usage is not tracked in this version.",
            "disclaimer": "This report mixes verified OurRealm records with self-reported entries. It is guidance for family conversations, not a surveillance log."}
