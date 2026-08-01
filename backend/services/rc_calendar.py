"""Responsibility Center — Bundle E universal calendar engine.

Events (meetings, classes, practices, shifts, deadlines, birthdays…),
attendee RSVPs, attendance foundation, conflict detection with authorized
override, recurrence (reuses the Bundle C engine), deduped event
reminders, a unified feed that projects task due dates without
duplicating data, and the Daily Work Digest (one per user per day).
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Optional

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core.db import db
from services import responsibility_center as rc
from services import rc_recurrence
from services.rc_units import _ctx, _my_unit_ids

log = logging.getLogger("ourrealm.rc.calendar")

EVENT_TYPES = ["event", "meeting", "class", "practice", "shift", "appointment",
               "deadline", "birthday", "important_date", "announcement", "custom"]
EVENT_VIS = ["center", "unit", "attendees"]
RSVPS = ["pending", "accepted", "declined", "maybe"]
ATTENDANCE = ["unknown", "present", "absent", "late", "excused", "remote", "not_required"]
DEFAULT_REMINDERS = [1440, 60]  # minutes before start
_IDX = False


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_calendar_indexes():
    global _IDX
    if _IDX:
        return
    try:
        await db.responsibility_center_calendar_events.create_index(
            [("center_id", 1), ("start_at", 1), ("status", 1)], name="c_start")
        await db.responsibility_center_calendar_events.create_index(
            [("series_id", 1), ("occurrence_key", 1)], unique=True, name="uniq_ev_occ",
            partialFilterExpression={"series_id": {"$exists": True}})
        await db.responsibility_center_calendar_events.create_index(
            [("center_id", 1), ("client_token", 1)], unique=True, name="uniq_ev_token",
            partialFilterExpression={"client_token": {"$exists": True}})
        await db.responsibility_center_event_reminders.create_index(
            [("dedup_key", 1)], unique=True, name="uniq_ev_dedup")
        await db.responsibility_center_digest_log.create_index(
            [("dedup_key", 1)], unique=True, name="uniq_digest")
    except Exception as e:  # noqa: BLE001
        log.warning(f"[rc-calendar] index issue: {e}")
    _IDX = True


def _parse(dt: str) -> datetime:
    try:
        d = datetime.fromisoformat(dt)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid date format")


def _can_see_event(ev: dict, user_id: str, perms: set, my_units: set) -> bool:
    involved = user_id in {a["user_id"] for a in ev.get("attendees") or []} \
        or user_id in (ev.get("created_by"), ev.get("organizer_id"))
    if involved or "view_private_events" in perms:
        return True
    vis = ev.get("visibility") or "center"
    if vis == "center":
        return "view_calendar" in perms
    if vis == "unit":
        return ev.get("unit_id") in my_units
    return False


async def _detect_conflicts(center_id: str, attendee_ids: list, unit_id: Optional[str],
                            start: datetime, end: datetime, exclude_event: Optional[str] = None) -> list:
    q = {"center_id": center_id, "status": "scheduled", "is_series": {"$ne": True},
         "start_at": {"$lt": end.isoformat()}, "end_at": {"$gt": start.isoformat()}}
    ors = []
    if attendee_ids:
        ors.append({"attendees.user_id": {"$in": attendee_ids}})
    if unit_id:
        ors.append({"unit_id": unit_id})
    if not ors:
        return []
    q["$or"] = ors
    conflicts = []
    async for ev in db.responsibility_center_calendar_events.find(
            q, {"_id": 0, "id": 1, "title": 1, "start_at": 1, "end_at": 1,
                "attendees": 1, "unit_id": 1}):
        if ev["id"] == exclude_event:
            continue
        overlap_users = list({a["user_id"] for a in ev.get("attendees") or []} & set(attendee_ids))
        conflicts.append({"event_id": ev["id"], "title": ev["title"],
                          "start_at": ev["start_at"], "end_at": ev["end_at"],
                          "overlapping_members": overlap_users,
                          "unit_conflict": bool(unit_id and ev.get("unit_id") == unit_id)})
    return conflicts[:10]


def _attendee_rows(ids: list, organizer: str) -> list:
    now = _iso()
    rows = []
    for uid in dict.fromkeys([organizer] + list(ids or [])):
        rows.append({"user_id": uid, "response": "accepted" if uid == organizer else "pending",
                     "attendance": "unknown", "invited_at": now, "responded_at": None,
                     "marked_by": None, "marked_at": None, "note": None})
    return rows


async def create_event(user: dict, center_id: str, body: dict) -> dict:
    await ensure_calendar_indexes()
    center, membership, perms = await _ctx(center_id, user, "create_events")
    title = (body.get("title") or "").strip()[:140]
    if not title:
        raise HTTPException(status_code=400, detail="A title is required")
    event_type = body.get("event_type") or "event"
    if event_type not in EVENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid event type")
    visibility = body.get("visibility") or "center"
    if visibility not in EVENT_VIS:
        raise HTTPException(status_code=400, detail="Invalid visibility")
    start = _parse(body.get("start_at") or "")
    end = _parse(body.get("end_at")) if body.get("end_at") else start + timedelta(hours=1)
    if end < start:
        raise HTTPException(status_code=400, detail="The end time can't be before the start time")
    link = (body.get("virtual_link") or "").strip()[:300]
    if link and not link.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid meeting link")
    unit_id = body.get("unit_id") or None
    if unit_id:
        unit = await db.responsibility_center_units.find_one(
            {"id": unit_id, "center_id": center_id, "status": "active"}, {"_id": 0, "id": 1})
        if not unit:
            raise HTTPException(status_code=400, detail="That unit doesn't belong to this Center")
    attendee_ids = list(dict.fromkeys(body.get("attendee_ids") or []))[:50]
    for uid in attendee_ids:
        m = await db.responsibility_center_memberships.find_one(
            {"center_id": center_id, "user_id": uid, "status": "active"}, {"_id": 0, "user_id": 1})
        if not m:
            raise HTTPException(status_code=400, detail="All attendees must be active members of this Center")
    # conflict detection — warn, allow authorized override
    conflicts = await _detect_conflicts(center_id, attendee_ids + [user["id"]], unit_id, start, end)
    if conflicts and not body.get("override_conflicts"):
        raise HTTPException(status_code=409, detail={
            "message": "Schedule conflict detected", "conflicts": conflicts})
    if conflicts and body.get("override_conflicts"):
        if "override_schedule_conflicts" not in perms:
            raise HTTPException(status_code=403, detail="You can't override schedule conflicts")
        reason = (body.get("override_reason") or "").strip()[:300]
        if center.get("require_conflict_override_reason") and not reason:
            raise HTTPException(status_code=400, detail="This Center requires a reason to override schedule conflicts")
        await rc.log_activity(center_id, user, "calendar_conflict_overridden",
                              f"@{user.get('username')} scheduled \"{title}\" despite a conflict"
                              + (f" — reason: {reason}" if reason else ""))
    reminders = [int(m) for m in (body.get("reminders") or DEFAULT_REMINDERS)][:5]
    now = _iso()
    ev = {"id": uuid.uuid4().hex, "center_id": center_id, "unit_id": unit_id,
          "event_type": event_type, "title": title,
          "description": (body.get("description") or "").strip()[:2000],
          "visibility": visibility, "created_by": user["id"],
          "created_by_username": user.get("username"),
          "organizer_id": body.get("organizer_id") or user["id"],
          "start_at": start.isoformat(), "end_at": end.isoformat(),
          "all_day": bool(body.get("all_day")),
          "timezone": body.get("timezone") or center.get("timezone") or "UTC",
          "location": (body.get("location") or "").strip()[:200],
          "virtual_link": link or None, "status": "scheduled",
          "attendance_enabled": bool(body.get("attendance_enabled")),
          "reminders": reminders,
          "attendees": _attendee_rows(attendee_ids, body.get("organizer_id") or user["id"]),
          "related_item_id": body.get("related_item_id"),
          "version": 1, "created_at": now, "updated_at": now, "canceled_at": None}
    if body.get("client_token"):
        ev["client_token"] = str(body["client_token"])[:80]
    recurrence = body.get("recurrence")
    if recurrence and (recurrence.get("pattern") or "one_time") != "one_time":
        rec = rc_recurrence.validate_recurrence(recurrence, center)
        ev.update(is_series=True, series_status="active", recurrence=rec,
                  anchor_start_at=ev["start_at"], next_start_at=ev["start_at"],
                  duration_minutes=int((end - start).total_seconds() // 60),
                  occurrences_generated=0, status="series")
        try:
            await db.responsibility_center_calendar_events.insert_one({**ev})
        except DuplicateKeyError:
            existing = await db.responsibility_center_calendar_events.find_one(
                {"center_id": center_id, "client_token": ev.get("client_token")}, {"_id": 0})
            if existing:
                return existing
            raise HTTPException(status_code=409, detail="Duplicate request — please retry")
        await generate_event_occurrences(ev)
        return await db.responsibility_center_calendar_events.find_one({"id": ev["id"]}, {"_id": 0})
    try:
        await db.responsibility_center_calendar_events.insert_one({**ev})
    except DuplicateKeyError:
        existing = await db.responsibility_center_calendar_events.find_one(
            {"center_id": center_id, "client_token": ev.get("client_token")}, {"_id": 0})
        if existing:
            return existing
        raise HTTPException(status_code=409, detail="Duplicate request — please retry")
    await rc.log_activity(center_id, user, "event_created",
                          f"@{user.get('username')} scheduled \"{title}\"")
    for uid in attendee_ids:
        if uid != user["id"]:
            await rc.notify_user(uid, "responsibility_center_event_invited",
                                 "You were invited to an event in one of your Responsibility Centers.",
                                 f"/responsibility-center/{center_id}?tab=calendar&event={ev['id']}",
                                 center_id, None, user.get("username"))
    return ev


async def generate_event_occurrences(series: dict) -> int:
    """Rolling-window occurrence generation for recurring events —
    unique (series_id, occurrence_key), never back-fills history."""
    rec = series.get("recurrence") or {}
    tz = ZoneInfo(rec.get("timezone") or "UTC")
    try:
        anchor = datetime.fromisoformat(series["anchor_start_at"]).astimezone(tz)
    except (ValueError, TypeError, KeyError):
        return 0
    center = await db.responsibility_centers.find_one(
        {"id": series["center_id"]}, {"_id": 0, "status": 1})
    if not center or center.get("status") in ("paused", "archived", "closed", "deleted"):
        return 0
    window_end = datetime.now(timezone.utc) + timedelta(days=rc_recurrence.WINDOW_DAYS)
    floor = datetime.now(timezone.utc) - timedelta(hours=24)
    duration = int(series.get("duration_minutes") or 60)
    n = int(series.get("occurrences_generated") or 0)
    created, skipped = 0, 0
    while created < 25:
        try:
            start_local = rc_recurrence.occurrence_due(rec, anchor, n)
        except ValueError:
            break
        if rc_recurrence._series_ended(rec, start_local, n):
            await db.responsibility_center_calendar_events.update_one(
                {"id": series["id"], "series_status": "active"},
                {"$set": {"series_status": "ended", "updated_at": _iso()}})
            break
        start_utc = start_local.astimezone(timezone.utc)
        if start_utc > window_end:
            break
        if start_utc < floor and skipped < 5000:
            skipped += 1
            n += 1
            await db.responsibility_center_calendar_events.update_one(
                {"id": series["id"]}, {"$set": {"occurrences_generated": n}})
            continue
        occ = {k: v for k, v in series.items()
               if k not in ("is_series", "series_status", "recurrence", "anchor_start_at",
                            "next_start_at", "occurrences_generated", "client_token", "_id")}
        rev = int(series.get("recurrence_rev") or 0)
        occ.update(id=uuid.uuid4().hex, series_id=series["id"],
                   occurrence_key=(f"r{rev}:{start_utc.isoformat()}" if rev
                                   else start_utc.isoformat()),
                   status="scheduled",
                   start_at=start_utc.isoformat(),
                   end_at=(start_utc + timedelta(minutes=duration)).isoformat(),
                   attendees=_attendee_rows([a["user_id"] for a in series.get("attendees") or []],
                                            series["organizer_id"]),
                   created_at=_iso(), updated_at=_iso())
        try:
            await db.responsibility_center_calendar_events.insert_one({**occ})
            created += 1
        except DuplicateKeyError:
            pass
        n += 1
        await db.responsibility_center_calendar_events.update_one(
            {"id": series["id"]},
            {"$set": {"occurrences_generated": n}})
    return created


async def run_event_recurrence_pass() -> dict:
    await ensure_calendar_indexes()
    now = datetime.now(timezone.utc)
    claim_until = (now + timedelta(minutes=10)).isoformat()
    window_end = (now + timedelta(days=rc_recurrence.WINDOW_DAYS)).isoformat()
    generated = processed = 0
    while processed < 100:
        series = await db.responsibility_center_calendar_events.find_one_and_update(
            {"is_series": True, "series_status": "active",
             "$or": [{"gen_claim_until": None}, {"gen_claim_until": {"$exists": False}},
                     {"gen_claim_until": {"$lt": now.isoformat()}}]},
            {"$set": {"gen_claim_until": claim_until}}, projection={"_id": 0})
        if not series:
            break
        processed += 1
        try:
            generated += await generate_event_occurrences(series)
        except Exception:  # noqa: BLE001
            log.exception("[rc-calendar] series %s failed", series.get("id"))
        finally:
            await db.responsibility_center_calendar_events.update_one(
                {"id": series["id"]}, {"$set": {"gen_claim_until": None}})
    _ = window_end
    return {"series_processed": processed, "occurrences_generated": generated}


# ── Feed / detail / edit / RSVP / attendance ─────────────────────────────
async def calendar_feed(user: dict, center_id: str, date_from: str, date_to: str,
                        unit_id: str = "", event_type: str = "", scope: str = "",
                        member_id: str = "") -> dict:
    await ensure_calendar_indexes()
    center, membership, perms = await _ctx(center_id, user, "view_calendar", write=False)
    start = _parse(date_from)
    end = _parse(date_to)
    if (end - start).days > 62:
        raise HTTPException(status_code=400, detail="Date range too large (max 62 days)")
    if member_id and member_id != user["id"] \
            and "manage_event_attendance" not in perms and "view_private_events" not in perms:
        raise HTTPException(status_code=403, detail="You can't view another member's calendar")
    my_units = await _my_unit_ids(center_id, user["id"])
    q = {"center_id": center_id, "is_series": {"$ne": True},
         "status": {"$in": ["scheduled", "completed"]},
         "start_at": {"$lt": end.isoformat()}, "end_at": {"$gt": start.isoformat()}}
    if unit_id:
        q["unit_id"] = unit_id
    if event_type in EVENT_TYPES:
        q["event_type"] = event_type
    events = await db.responsibility_center_calendar_events.find(q, {"_id": 0}) \
        .sort("start_at", 1).to_list(500)
    out = []
    for ev in events:
        if not _can_see_event(ev, user["id"], perms, my_units):
            continue
        if scope == "mine" and user["id"] not in {a["user_id"] for a in ev.get("attendees") or []}:
            continue
        if member_id and member_id not in {a["user_id"] for a in ev.get("attendees") or []}:
            continue
        my_row = next((a for a in ev.get("attendees") or [] if a["user_id"] == user["id"]), None)
        out.append({"kind": "event", "id": ev["id"], "title": ev["title"],
                    "event_type": ev["event_type"], "start_at": ev["start_at"],
                    "end_at": ev["end_at"], "all_day": ev.get("all_day"),
                    "unit_id": ev.get("unit_id"), "location": ev.get("location"),
                    "status": ev["status"], "series_id": ev.get("series_id"),
                    "attendee_count": len(ev.get("attendees") or []),
                    "my_response": (my_row or {}).get("response")})
    # task/responsibility due-date projections (no duplication — live query)
    if event_type in ("", "deadline"):
        from services import rc_items
        iq = {"center_id": center_id, "is_series": {"$ne": True},
              "due_at": {"$gte": start.isoformat(), "$lt": end.isoformat()},
              "status": {"$nin": ["canceled", "archived"]}}
        if scope == "mine":
            iq["assignee_ids"] = user["id"]
        if member_id:
            iq["assignee_ids"] = member_id
        if unit_id:
            iq["unit_id"] = unit_id
        async for it in db.responsibility_items.find(iq, {"_id": 0}).sort("due_at", 1):
            if not rc_items._can_see(it, user["id"], perms):
                continue
            out.append({"kind": "item", "id": it["id"], "title": it["title"],
                        "event_type": "deadline", "start_at": it["due_at"],
                        "end_at": it["due_at"], "item_type": it["item_type"],
                        "status": it["status"], "unit_id": it.get("unit_id"),
                        "priority": it.get("priority"),
                        "completed": it["status"] in ("completed", "approved")})
    out.sort(key=lambda x: x["start_at"])
    return {"entries": out, "can_create": "create_events" in perms,
            "timezone": center.get("timezone") or "UTC"}


async def event_detail(user: dict, center_id: str, event_id: str) -> dict:
    center, membership, perms = await _ctx(center_id, user, "view_calendar", write=False)
    ev = await db.responsibility_center_calendar_events.find_one(
        {"id": event_id, "center_id": center_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    my_units = await _my_unit_ids(center_id, user["id"])
    if not _can_see_event(ev, user["id"], perms, my_units):
        raise HTTPException(status_code=403, detail="You can't access this event")
    users = await rc._users_map([a["user_id"] for a in ev.get("attendees") or []])
    for a in ev.get("attendees") or []:
        a["username"] = (users.get(a["user_id"]) or {}).get("username")
    is_organizer = ev.get("organizer_id") == user["id"] or ev.get("created_by") == user["id"]
    return {"event": ev,
            "me": {"is_organizer": is_organizer,
                   "is_attendee": user["id"] in {a["user_id"] for a in ev.get("attendees") or []},
                   "my_response": next((a.get("response") for a in ev.get("attendees") or []
                                        if a["user_id"] == user["id"]), None),
                   "can_edit": is_organizer or "edit_any_event" in perms,
                   "can_cancel": is_organizer or "cancel_events" in perms,
                   "can_mark_attendance": "manage_event_attendance" in perms or is_organizer}}


async def update_event(user: dict, center_id: str, event_id: str, body: dict) -> dict:
    center, membership, perms = await _ctx(center_id, user, "view_calendar")
    ev = await db.responsibility_center_calendar_events.find_one(
        {"id": event_id, "center_id": center_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if not (ev.get("organizer_id") == user["id"] or ev.get("created_by") == user["id"]
            or "edit_any_event" in perms):
        raise HTTPException(status_code=403, detail="You can't edit this event")
    if body.get("expected_version") is not None and int(body["expected_version"]) != int(ev.get("version") or 1):
        raise HTTPException(status_code=409, detail="This event changed while you were editing — refresh and review before saving")
    edit_scope = body.get("scope") or "occurrence"
    if ev.get("is_series"):
        edit_scope = "series"
    sets = {}
    if "title" in body:
        t = (body["title"] or "").strip()[:140]
        if not t:
            raise HTTPException(status_code=400, detail="Invalid title")
        sets["title"] = t
    if "description" in body:
        sets["description"] = (body["description"] or "").strip()[:2000]
    if "location" in body:
        sets["location"] = (body["location"] or "").strip()[:200]
    if "start_at" in body or "end_at" in body:
        start = _parse(body.get("start_at") or ev["start_at"])
        end = _parse(body.get("end_at") or ev["end_at"])
        if end < start:
            raise HTTPException(status_code=400, detail="The end time can't be before the start time")
        conflicts = await _detect_conflicts(
            center_id, [a["user_id"] for a in ev.get("attendees") or []],
            ev.get("unit_id"), start, end, exclude_event=event_id)
        if conflicts and not body.get("override_conflicts"):
            raise HTTPException(status_code=409, detail={
                "message": "Schedule conflict detected", "conflicts": conflicts})
        sets["start_at"], sets["end_at"] = start.isoformat(), end.isoformat()
    if "attendee_ids" in body:
        ids = list(dict.fromkeys(body["attendee_ids"] or []))[:50]
        for uid in ids:
            m = await db.responsibility_center_memberships.find_one(
                {"center_id": center_id, "user_id": uid, "status": "active"}, {"_id": 0, "user_id": 1})
            if not m:
                raise HTTPException(status_code=400, detail="All attendees must be active members")
        old = {a["user_id"]: a for a in ev.get("attendees") or []}
        sets["attendees"] = [old.get(uid) or _attendee_rows([uid], ev["organizer_id"])[-1]
                             for uid in dict.fromkeys([ev["organizer_id"]] + ids)]
    if not sets and not body.get("recurrence"):
        return {"ok": True}
    sets["updated_at"] = _iso()
    # series-wide propagation (non-time fields only)
    if edit_scope in ("future", "series") and (ev.get("series_id") or ev.get("is_series")):
        series_id = ev.get("series_id") or ev["id"]
        prop = {k: v for k, v in sets.items()
                if k in ("title", "description", "location", "updated_at")}
        floor_at = ev["start_at"] if (edit_scope == "future" and ev.get("series_id")) else _iso()
        if prop:
            await db.responsibility_center_calendar_events.update_one(
                {"id": series_id}, {"$set": prop})
            await db.responsibility_center_calendar_events.update_many(
                {"series_id": series_id, "status": "scheduled",
                 "start_at": {"$gte": floor_at}}, {"$set": prop})
        if body.get("recurrence") is not None:
            series = await db.responsibility_center_calendar_events.find_one(
                {"id": series_id}, {"_id": 0})
            rec = rc_recurrence.validate_recurrence(body["recurrence"], center)
            await db.responsibility_center_calendar_events.update_many(
                {"series_id": series_id, "status": "scheduled",
                 "start_at": {"$gte": floor_at}},
                {"$set": {"status": "canceled", "canceled_at": _iso(),
                          "cancel_reason": "series_rescheduled", "updated_at": _iso()}})
            new_anchor = sets.get("start_at") or body.get("anchor_start_at") or _iso()
            await db.responsibility_center_calendar_events.update_one(
                {"id": series_id},
                {"$set": {"recurrence": rec, "anchor_start_at": new_anchor,
                          "occurrences_generated": 0, "series_status": "active",
                          "updated_at": _iso()},
                 "$inc": {"recurrence_rev": 1}})
            fresh = await db.responsibility_center_calendar_events.find_one(
                {"id": series_id}, {"_id": 0})
            await generate_event_occurrences(fresh)
        await rc.log_activity(center_id, user, "event_series_edited",
                              f"@{user.get('username')} updated the series \"{ev['title']}\" ({edit_scope})")
        if ev.get("is_series"):
            return {"ok": True, "scope": edit_scope}
    await db.responsibility_center_calendar_events.update_one(
        {"id": event_id}, {"$set": sets, "$inc": {"version": 1}})
    if "start_at" in sets and sets["start_at"] != ev["start_at"]:
        for a in ev.get("attendees") or []:
            if a["user_id"] != user["id"]:
                await rc.notify_user(a["user_id"], "responsibility_center_event_updated",
                                     "An event you're attending was rescheduled.",
                                     f"/responsibility-center/{center_id}?tab=calendar&event={event_id}",
                                     center_id, None, user.get("username"))
    return await event_detail(user, center_id, event_id)


async def cancel_event(user: dict, center_id: str, event_id: str, scope: str = "occurrence") -> dict:
    center, membership, perms = await _ctx(center_id, user, "view_calendar")
    ev = await db.responsibility_center_calendar_events.find_one(
        {"id": event_id, "center_id": center_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if not (ev.get("organizer_id") == user["id"] or ev.get("created_by") == user["id"]
            or "cancel_events" in perms):
        raise HTTPException(status_code=403, detail="You can't cancel this event")
    now = _iso()
    series_id = ev.get("series_id") or (ev["id"] if ev.get("is_series") else None)
    if ev.get("is_series"):
        scope = "series"
    canceled_ids = []
    if series_id and scope in ("future", "series"):
        floor_at = ev["start_at"] if (scope == "future" and ev.get("series_id")) else now
        cursor = db.responsibility_center_calendar_events.find(
            {"series_id": series_id, "status": "scheduled",
             "start_at": {"$gte": floor_at}}, {"_id": 0, "id": 1})
        canceled_ids = [row["id"] async for row in cursor]
        await db.responsibility_center_calendar_events.update_many(
            {"id": {"$in": canceled_ids}},
            {"$set": {"status": "canceled", "canceled_at": now, "updated_at": now}})
        await db.responsibility_center_calendar_events.update_one(
            {"id": series_id},
            {"$set": {"series_status": "ended", "canceled_at": now, "updated_at": now}})
        if ev.get("series_id") and ev["id"] not in canceled_ids and ev["status"] == "scheduled":
            await db.responsibility_center_calendar_events.update_one(
                {"id": ev["id"]}, {"$set": {"status": "canceled", "canceled_at": now, "updated_at": now}})
            canceled_ids.append(ev["id"])
    else:
        upd = await db.responsibility_center_calendar_events.update_one(
            {"id": event_id, "status": "scheduled"},
            {"$set": {"status": "canceled", "canceled_at": now, "updated_at": now}})
        if upd.modified_count != 1:
            return {"ok": True, "idempotent": True}
        canceled_ids = [event_id]
    for a in ev.get("attendees") or []:
        if a["user_id"] != user["id"]:
            await rc.notify_user(a["user_id"], "responsibility_center_event_canceled",
                                 "An event you were attending was canceled.",
                                 f"/responsibility-center/{center_id}?tab=calendar",
                                 center_id, None, user.get("username"))
    await rc.log_activity(center_id, user, "event_canceled",
                          f"@{user.get('username')} canceled \"{ev['title']}\""
                          + (f" ({scope})" if scope != "occurrence" else ""))
    return {"ok": True, "status": "canceled", "scope": scope, "canceled_count": len(canceled_ids)}


async def rsvp(user: dict, center_id: str, event_id: str, response: str) -> dict:
    if response not in ("accepted", "declined", "maybe"):
        raise HTTPException(status_code=400, detail="Invalid response")
    await _ctx(center_id, user, "view_calendar", write=False)
    upd = await db.responsibility_center_calendar_events.update_one(
        {"id": event_id, "center_id": center_id, "attendees.user_id": user["id"]},
        {"$set": {"attendees.$.response": response, "attendees.$.responded_at": _iso()}})
    if upd.matched_count != 1:
        raise HTTPException(status_code=404, detail="You are not on this event's attendee list")
    return {"ok": True, "response": response}


async def mark_attendance(user: dict, center_id: str, event_id: str, marks: list) -> dict:
    """marks: [{user_id, attendance, note}] — bulk-capable, history logged."""
    center, membership, perms = await _ctx(center_id, user, "view_calendar")
    ev = await db.responsibility_center_calendar_events.find_one(
        {"id": event_id, "center_id": center_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if not ("manage_event_attendance" in perms or ev.get("organizer_id") == user["id"]):
        raise HTTPException(status_code=403, detail="You can't mark attendance for this event")
    if not ev.get("attendance_enabled"):
        raise HTTPException(status_code=409, detail="Attendance isn't enabled for this event")
    updated = 0
    for m in (marks or [])[:100]:
        att = m.get("attendance")
        if att not in ATTENDANCE:
            continue
        res = await db.responsibility_center_calendar_events.update_one(
            {"id": event_id, "attendees.user_id": m.get("user_id")},
            {"$set": {"attendees.$.attendance": att,
                      "attendees.$.note": (m.get("note") or "")[:200] or None,
                      "attendees.$.marked_by": user["id"], "attendees.$.marked_at": _iso()}})
        if res.modified_count == 1:
            updated += 1
            await db.responsibility_center_unit_activity.insert_one({
                "id": uuid.uuid4().hex, "center_id": center_id,
                "unit_id": ev.get("unit_id"), "actor_id": user["id"],
                "actor_username": user.get("username"), "action": "attendance_changed",
                "meta": {"event_id": event_id, "user_id": m.get("user_id"), "attendance": att},
                "created_at": _iso()})
    return {"ok": True, "updated": updated}


# ── Event reminders pass ─────────────────────────────────────────────────
async def run_event_reminder_pass() -> dict:
    """One reminder per (event, offset, start-time version, recipient)."""
    await ensure_calendar_indexes()
    now = datetime.now(timezone.utc)
    horizon = (now + timedelta(hours=25)).isoformat()
    sent = 0
    cursor = db.responsibility_center_calendar_events.find(
        {"is_series": {"$ne": True}, "status": "scheduled",
         "start_at": {"$lte": horizon, "$gte": (now - timedelta(hours=2)).isoformat()}},
        {"_id": 0, "id": 1, "center_id": 1, "title": 1, "start_at": 1,
         "reminders": 1, "attendees": 1, "visibility": 1})
    async for ev in cursor:
        try:
            start = datetime.fromisoformat(ev["start_at"])
        except (ValueError, TypeError):
            continue
        center = await db.responsibility_centers.find_one(
            {"id": ev["center_id"]}, {"_id": 0, "name": 1, "status": 1})
        if not center or center.get("status") != "active":
            continue
        for offset in ev.get("reminders") or DEFAULT_REMINDERS:
            if now < start - timedelta(minutes=int(offset)):
                continue
            if now > start + timedelta(minutes=30):
                continue  # too late — don't send stale reminders
            for a in ev.get("attendees") or []:
                if a.get("response") == "declined":
                    continue
                m = await db.responsibility_center_memberships.find_one(
                    {"center_id": ev["center_id"], "user_id": a["user_id"], "status": "active"},
                    {"_id": 0, "user_id": 1})
                if not m:
                    continue
                key = f"{ev['id']}:m{offset}:{ev['start_at']}:{a['user_id']}"
                try:
                    await db.responsibility_center_event_reminders.insert_one({
                        "dedup_key": key, "event_id": ev["id"], "offset": offset,
                        "recipient_id": a["user_id"], "sent_at": now.isoformat()})
                except DuplicateKeyError:
                    continue
                label = "starts soon" if int(offset) <= 60 else "is coming up"
                await rc.notify_user(a["user_id"], "responsibility_center_event_reminder",
                                     f"An event in \"{center['name']}\" {label}.",
                                     f"/responsibility-center/{ev['center_id']}?tab=calendar&event={ev['id']}",
                                     ev["center_id"])
                sent += 1
    return {"event_reminders_sent": sent}


# ── Daily Work Digest ────────────────────────────────────────────────────
DIGEST_INCLUDES = ["include_due_today", "include_due_soon", "include_overdue",
                   "include_approvals", "include_changes_requested",
                   "include_recently_assigned", "include_events"]


async def get_digest_settings(user: dict) -> dict:
    row = await db.user_rc_prefs.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    out = {"digest_enabled": bool(row.get("digest_enabled", False)),
           "digest_hour": int(row.get("digest_hour", 8)),
           "digest_timezone": row.get("digest_timezone") or "UTC"}
    for k in DIGEST_INCLUDES:
        out[k] = bool(row.get(k, True))
    return out


async def update_digest_settings(user: dict, body: dict) -> dict:
    sets = {}
    if "digest_enabled" in body:
        sets["digest_enabled"] = bool(body["digest_enabled"])
    if "digest_hour" in body:
        h = int(body["digest_hour"])
        if h < 0 or h > 23:
            raise HTTPException(status_code=400, detail="Digest hour must be 0–23")
        sets["digest_hour"] = h
    if "digest_timezone" in body:
        try:
            ZoneInfo(body["digest_timezone"])
        except Exception:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="Invalid timezone")
        sets["digest_timezone"] = body["digest_timezone"]
    for k in DIGEST_INCLUDES:
        if k in body:
            sets[k] = bool(body[k])
    if sets:
        await db.user_rc_prefs.update_one({"user_id": user["id"]},
                                          {"$set": sets, "$setOnInsert": {"user_id": user["id"]}},
                                          upsert=True)
    return await get_digest_settings(user)


async def get_latest_digest(user: dict) -> dict:
    row = await db.responsibility_center_digest_log.find_one(
        {"user_id": user["id"]}, {"_id": 0}, sort=[("sent_at", -1)])
    return {"digest": row}


async def _digest_active_centers(user_id: str) -> dict:
    """Active memberships in active Centers only — paused/archived/closed excluded."""
    ms = await db.responsibility_center_memberships.find(
        {"user_id": user_id, "status": "active"}, {"_id": 0, "center_id": 1}).to_list(300)
    ids = [m["center_id"] for m in ms]
    if not ids:
        return {}
    centers = await db.responsibility_centers.find(
        {"id": {"$in": ids}, "status": {"$in": ["active", None]}},
        {"_id": 0, "id": 1, "name": 1, "status": 1}).to_list(300)
    return {c["id"]: c.get("name") or "Center" for c in centers
            if (c.get("status") or "active") == "active"}


def _digest_item_row(it: dict, center_names: dict) -> dict:
    cid = it.get("center_id")
    return {"center_id": cid, "center_name": center_names.get(cid, "Center"),
            "id": it["id"], "title": it.get("title"), "due_at": it.get("due_at"),
            "priority": it.get("priority"), "status": it.get("status"),
            "link": f"/responsibility-center/{cid}?tab=work&item={it['id']}"}


async def _build_digest_sections(user_doc: dict, pref: dict, local, center_names: dict) -> dict:
    from services import rc_items
    work = await rc_items.my_work(user_doc)
    b = work.get("buckets") or {}
    sections = {}

    def take(bucket_key, pref_key, section_key):
        if not pref.get(pref_key, True):
            return
        rows = [r for r in (b.get(bucket_key) or []) if r.get("center_id") in center_names]
        if rows:
            sections[section_key] = [_digest_item_row(r, center_names) for r in rows[:10]]
    take("due_today", "include_due_today", "due_today")
    take("due_soon", "include_due_soon", "due_soon")
    take("overdue", "include_overdue", "overdue")
    take("pending_my_approval", "include_approvals", "pending_my_approval")
    uid = user_doc["id"]
    cids = list(center_names)
    if pref.get("include_changes_requested", True) and cids:
        rows = await db.responsibility_items.find(
            {"center_id": {"$in": cids}, "assignee_ids": uid,
             "status": "changes_requested", "is_series": {"$ne": True}},
            {"_id": 0, "id": 1, "center_id": 1, "title": 1, "due_at": 1,
             "priority": 1, "status": 1}).sort("updated_at", -1).to_list(10)
        if rows:
            sections["changes_requested"] = [_digest_item_row(r, center_names) for r in rows]
    if pref.get("include_recently_assigned", True) and cids:
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        rows = await db.responsibility_items.find(
            {"center_id": {"$in": cids}, "assignee_ids": uid,
             "created_at": {"$gte": since}, "is_series": {"$ne": True},
             "status": {"$nin": ["canceled", "archived", "completed", "approved"]}},
            {"_id": 0, "id": 1, "center_id": 1, "title": 1, "due_at": 1,
             "priority": 1, "status": 1}).sort("created_at", -1).to_list(10)
        if rows:
            sections["recently_assigned"] = [_digest_item_row(r, center_names) for r in rows]
    if pref.get("include_events", True) and cids:
        day_start = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
        day_end = local.replace(hour=23, minute=59, second=59).astimezone(timezone.utc).isoformat()
        evs = await db.responsibility_center_calendar_events.find(
            {"center_id": {"$in": cids}, "attendees.user_id": uid,
             "status": "scheduled", "is_series": {"$ne": True},
             "start_at": {"$gte": day_start, "$lte": day_end}},
            {"_id": 0, "id": 1, "center_id": 1, "title": 1, "event_type": 1,
             "start_at": 1, "end_at": 1}).sort("start_at", 1).to_list(20)
        by_type = {}
        for ev in evs:
            key = {"meeting": "meetings_today", "class": "classes_today",
                   "practice": "practices_today", "shift": "shifts_today"}.get(
                ev.get("event_type"), "events_today")
            by_type.setdefault(key, []).append({
                "center_id": ev["center_id"],
                "center_name": center_names.get(ev["center_id"], "Center"),
                "id": ev["id"], "title": ev.get("title"),
                "event_type": ev.get("event_type"), "start_at": ev.get("start_at"),
                "link": f"/responsibility-center/{ev['center_id']}?tab=calendar&event={ev['id']}"})
        sections.update(by_type)
    return sections


_SECTION_LABELS = {"due_today": "due today", "due_soon": "due soon", "overdue": "overdue",
                   "pending_my_approval": "awaiting your approval",
                   "changes_requested": "with changes requested",
                   "recently_assigned": "recently assigned",
                   "events_today": "event(s) today", "meetings_today": "meeting(s) today",
                   "classes_today": "class(es) today", "practices_today": "practice(s) today",
                   "shifts_today": "shift(s) today"}


async def run_work_digest_pass() -> dict:
    """One in-app Work Digest per opted-in user per local day, at their
    chosen hour. Deduped via unique key; empty digests are skipped;
    paused/archived/closed Centers and inactive memberships excluded."""
    await ensure_calendar_indexes()
    now = datetime.now(timezone.utc)
    sent = 0
    async for pref in db.user_rc_prefs.find({"digest_enabled": True}, {"_id": 0}):
        try:
            tz = ZoneInfo(pref.get("digest_timezone") or "UTC")
        except Exception:  # noqa: BLE001
            tz = timezone.utc
        local = now.astimezone(tz)
        if local.hour != int(pref.get("digest_hour", 8)):
            continue
        dedup_key = f"digest:{pref['user_id']}:{local.date().isoformat()}"
        exists = await db.responsibility_center_digest_log.find_one(
            {"dedup_key": dedup_key}, {"_id": 1})
        if exists:
            continue
        user_doc = await db.users.find_one({"id": pref["user_id"]}, {"_id": 0, "id": 1, "username": 1})
        if not user_doc:
            continue
        center_names = await _digest_active_centers(pref["user_id"])
        if not center_names:
            continue
        sections = await _build_digest_sections(user_doc, pref, local, center_names)
        total = sum(len(v) for v in sections.values())
        if total == 0:
            continue  # never send an empty digest
        try:
            await db.responsibility_center_digest_log.insert_one({
                "dedup_key": dedup_key, "user_id": pref["user_id"],
                "local_date": local.date().isoformat(),
                "timezone": pref.get("digest_timezone") or "UTC",
                "sections": sections,
                "counts": {k: len(v) for k, v in sections.items()},
                "sent_at": now.isoformat()})
        except DuplicateKeyError:
            continue  # already sent today (overlap-safe)
        parts = [f"{len(v)} {_SECTION_LABELS.get(k, k)}" for k, v in sections.items()]
        await rc.notify_user(pref["user_id"], "responsibility_center_work_digest",
                             "Your Daily Work Digest: " + ", ".join(parts) + ".",
                             "/responsibility-center?digest=1", None)
        sent += 1
    return {"digests_sent": sent}
