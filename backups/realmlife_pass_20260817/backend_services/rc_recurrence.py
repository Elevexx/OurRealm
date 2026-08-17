"""Responsibility Center — recurrence engine + due reminders (Bundle C).

Series templates live in responsibility_items with is_series=True.
Occurrences are generated through a rolling future window (never
unlimited records), claim-locked, and protected by a unique
(series_id, occurrence_key) index — concurrent workers can never
duplicate an occurrence. Center timezone drives the user-facing
schedule; storage stays UTC.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from dateutil.relativedelta import relativedelta
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core.db import db

log = logging.getLogger("ourrealm.rc.recurrence")

PATTERNS = ["one_time", "daily", "weekdays", "weekly", "biweekly", "monthly", "custom"]
CUSTOM_UNITS = ["days", "weeks", "months"]
MONTHLY_MODES = ["day_of_month", "first_weekday", "last_weekday", "nth_weekday"]
WINDOW_DAYS = 14          # rolling generation window
MAX_PER_PASS = 25          # per-series safety cap per scheduler pass
CLAIM_MINUTES = 10


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def validate_recurrence(rec: dict, center: dict) -> dict:
    pattern = rec.get("pattern") or "one_time"
    if pattern not in PATTERNS:
        raise HTTPException(status_code=400, detail="Invalid recurrence pattern")
    tz_name = rec.get("timezone") or center.get("timezone") or "UTC"
    try:
        ZoneInfo(tz_name)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid timezone")
    out = {"pattern": pattern, "timezone": tz_name,
           "end_date": rec.get("end_date") or None,
           "max_occurrences": None}
    if rec.get("max_occurrences"):
        n = int(rec["max_occurrences"])
        if n < 1 or n > 1000:
            raise HTTPException(status_code=400, detail="Occurrence count must be between 1 and 1000")
        out["max_occurrences"] = n
    if out["end_date"]:
        try:
            datetime.fromisoformat(out["end_date"])
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid recurrence end date")
    if pattern in ("weekly", "biweekly"):
        days = sorted({int(d) for d in (rec.get("weekdays") or []) if 0 <= int(d) <= 6})
        if not days:
            raise HTTPException(status_code=400, detail="Select at least one weekday")
        out["weekdays"] = days
    if pattern == "monthly":
        mode = rec.get("monthly_mode") or "day_of_month"
        if mode not in MONTHLY_MODES:
            raise HTTPException(status_code=400, detail="Invalid monthly mode")
        out["monthly_mode"] = mode
        if mode == "day_of_month":
            d = int(rec.get("month_day") or 1)
            if d < 1 or d > 31:
                raise HTTPException(status_code=400, detail="Day of month must be 1–31")
            out["month_day"] = d
        elif mode == "nth_weekday":
            nth = int(rec.get("nth_week") or 1)
            wd = int(rec.get("weekday") or 0)
            if nth < 1 or nth > 4 or wd < 0 or wd > 6:
                raise HTTPException(status_code=400, detail="Invalid week/weekday selection")
            out["nth_week"], out["weekday"] = nth, wd
        else:
            out["weekday"] = int(rec.get("weekday") or 0)
    if pattern == "custom":
        unit = rec.get("unit") or "days"
        if unit not in CUSTOM_UNITS:
            raise HTTPException(status_code=400, detail="Invalid custom interval unit")
        interval = int(rec.get("interval") or 1)
        if interval < 1 or interval > 365:
            raise HTTPException(status_code=400, detail="Interval must be between 1 and 365")
        out["unit"], out["interval"] = unit, interval
        if unit == "months":
            out["month_day"] = int(rec.get("month_day") or 0) or None
    return out


def _clamped_month_date(anchor: datetime, months: int, month_day) -> datetime:
    """Anchor + N months; a 31st uses the last valid day of shorter months
    and returns to the anchor day in longer months (computed from anchor,
    never from the previously clamped date)."""
    base = anchor.replace(day=1) + relativedelta(months=months)
    want = month_day or anchor.day
    last = (base + relativedelta(months=1) - timedelta(days=1)).day
    return base.replace(day=min(want, last))


def _monthly_weekday_date(anchor: datetime, months: int, rec: dict) -> datetime:
    base = anchor.replace(day=1) + relativedelta(months=months)
    mode = rec.get("monthly_mode")
    last_day = (base + relativedelta(months=1) - timedelta(days=1)).day
    if mode == "first_weekday":
        d = base
        while d.weekday() > 4:  # Mon–Fri
            d += timedelta(days=1)
        return d
    if mode == "last_weekday":
        d = base.replace(day=last_day)
        while d.weekday() > 4:
            d -= timedelta(days=1)
        return d
    # nth_weekday
    nth, wd = rec.get("nth_week", 1), rec.get("weekday", 0)
    d = base
    while d.weekday() != wd:
        d += timedelta(days=1)
    d += timedelta(days=7 * (nth - 1))
    if d.day > last_day:
        d -= timedelta(days=7)
    return d


def occurrence_due(rec: dict, anchor_local: datetime, n: int) -> datetime:
    """Local due datetime of occurrence n (0-based; 0 == the anchor)."""
    pattern = rec["pattern"]
    if pattern == "daily":
        return anchor_local + timedelta(days=n)
    if pattern == "custom":
        unit, interval = rec["unit"], rec["interval"]
        if unit == "days":
            return anchor_local + timedelta(days=n * interval)
        if unit == "weeks":
            return anchor_local + timedelta(weeks=n * interval)
        return _clamped_month_date(anchor_local, n * interval,
                                   rec.get("month_day") or anchor_local.day) \
            .replace(hour=anchor_local.hour, minute=anchor_local.minute)
    if pattern == "monthly":
        if rec.get("monthly_mode", "day_of_month") == "day_of_month":
            d = _clamped_month_date(anchor_local, n, rec.get("month_day") or anchor_local.day)
        else:
            d = _monthly_weekday_date(anchor_local, n, rec)
        return d.replace(hour=anchor_local.hour, minute=anchor_local.minute)
    # day-enumeration patterns: weekdays / weekly / biweekly
    count, d, safety = -1, anchor_local, 0
    anchor_week = (anchor_local - timedelta(days=anchor_local.weekday())).date()
    while safety < 20000:
        ok = False
        if pattern == "weekdays":
            ok = d.weekday() <= 4
        elif pattern == "weekly":
            ok = d.weekday() in rec["weekdays"]
        elif pattern == "biweekly":
            week_start = (d - timedelta(days=d.weekday())).date()
            parity = ((week_start - anchor_week).days // 7) % 2 == 0
            ok = parity and d.weekday() in rec["weekdays"]
        if ok:
            count += 1
            if count == n:
                return d
        d += timedelta(days=1)
        safety += 1
    raise ValueError("recurrence enumeration overflow")


def _series_ended(rec: dict, due_local: datetime, n: int) -> bool:
    if rec.get("max_occurrences") and n + 1 > rec["max_occurrences"]:
        return True
    if rec.get("end_date"):
        try:
            end = datetime.fromisoformat(rec["end_date"])
            if end.tzinfo is None:
                end = end.replace(tzinfo=due_local.tzinfo)
            if due_local.date() > end.date():
                return True
        except (ValueError, TypeError):
            pass
    return False


async def generate_for_series(series: dict, notify: bool = True) -> int:
    """Generate every occurrence whose due date falls inside the rolling
    window. Idempotent: unique (series_id, occurrence_key) index + claim."""
    from services import rc_items
    from services import responsibility_center as rc
    rec = series.get("recurrence") or {}
    tz = ZoneInfo(rec.get("timezone") or "UTC")
    try:
        anchor_local = datetime.fromisoformat(series["anchor_due_at"]).astimezone(tz)
    except (ValueError, TypeError, KeyError):
        return 0
    window_end = _utcnow() + timedelta(days=WINDOW_DAYS)
    n = int(series.get("occurrences_generated") or 0)
    created = 0
    skipped_past = 0
    backfill_floor = _utcnow() - timedelta(hours=24)
    center = await db.responsibility_centers.find_one(
        {"id": series["center_id"]}, {"_id": 0, "id": 1, "name": 1, "status": 1})
    if not center or center.get("status") in ("archived", "deleted", "paused", "closed"):
        return 0
    while created < MAX_PER_PASS:
        try:
            due_local = occurrence_due(rec, anchor_local, n)
        except ValueError:
            break
        if _series_ended(rec, due_local, n):
            await db.responsibility_items.update_one(
                {"id": series["id"], "series_status": "active"},
                {"$set": {"series_status": "ended", "updated_at": rc._now_iso()}})
            for uid in set(series.get("assignee_ids") or []):
                await rc_items._notify_item(uid, "responsibility_center_series_ended",
                                            f"The recurring series {rc_items.item_notify_title(series)} has ended.",
                                            series["center_id"], series["id"])
            await rc_items._log(series["center_id"], series["id"],
                                {"id": "system", "username": "system"}, "series_ended", {"occurrences": n})
            break
        due_utc = due_local.astimezone(timezone.utc)
        if due_utc > window_end:
            break
        if due_utc < backfill_floor and skipped_past < 5000:
            # never back-fill history — advance past stale occurrences
            skipped_past += 1
            n += 1
            await db.responsibility_items.update_one(
                {"id": series["id"]}, {"$set": {"occurrences_generated": n}})
            continue
        occurrence_key = due_utc.isoformat()
        assignees = list(series.get("assignee_ids") or [])
        status = "assigned" if (assignees and assignees != [series["created_by"]]) else "in_progress"
        if not assignees:
            assignees = [series["created_by"]]
        occ = {
            "id": uuid.uuid4().hex, "center_id": series["center_id"],
            "item_type": series["item_type"], "title": series["title"],
            "description": series.get("description") or "", "status": status,
            "priority": series.get("priority") or "normal",
            "visibility": series.get("visibility") or "center",
            "created_by": series["created_by"],
            "created_by_username": series.get("created_by_username"),
            "assignee_ids": assignees, "reviewer_id": series.get("reviewer_id"),
            "approver_id": series.get("approver_id"),
            "approval_required": bool(series.get("approval_required")),
            "is_self_task": bool(series.get("is_self_task")),
            "parent_id": None, "depends_on": [],
            "start_at": None, "due_at": due_utc.isoformat(),
            "completed_at": None, "completed_by": None,
            "estimated_minutes": series.get("estimated_minutes") or 0,
            "difficulty": series.get("difficulty"),
            "category": series.get("category"), "labels": series.get("labels") or [],
            "progress_percent": 0,
            "progress_method": series.get("progress_method") or "manual",
            "checklist": [{"id": uuid.uuid4().hex, "title": c["title"], "completed": False,
                           "completed_by": None, "completed_at": None}
                          for c in (series.get("checklist") or [])],
            "attachments": [], "series_id": series["id"],
            "occurrence_key": occurrence_key, "occurrence_index": n,
            "version": 1, "created_at": rc._now_iso(), "updated_at": rc._now_iso(),
        }
        try:
            await db.responsibility_items.insert_one({**occ})
            created += 1
            await rc_items._log(series["center_id"], series["id"],
                                {"id": "system", "username": "system"},
                                "occurrence_generated",
                                {"occurrence_id": occ["id"], "due_at": occ["due_at"]})
            if notify:
                for uid in set(assignees):
                    await rc_items._notify_item(
                        uid, "responsibility_center_occurrence_created",
                        f"A new occurrence of {rc_items.item_notify_title(series)} is scheduled in \"{center['name']}\".",
                        series["center_id"], occ["id"])
        except DuplicateKeyError:
            pass  # another worker generated it — safe retry
        n += 1
        next_due_local = None
        try:
            next_due_local = occurrence_due(rec, anchor_local, n)
        except ValueError:
            pass
        await db.responsibility_items.update_one(
            {"id": series["id"]},
            {"$set": {"occurrences_generated": n,
                      "next_due_at": next_due_local.astimezone(timezone.utc).isoformat()
                      if next_due_local else None}})
    return created


async def run_recurrence_pass() -> dict:
    """Claim-locked pass over active series with next_due inside the window."""
    from services import rc_items
    await rc_items.ensure_item_indexes()
    now = _utcnow()
    window_end = (now + timedelta(days=WINDOW_DAYS)).isoformat()
    claim_until = (now + timedelta(minutes=CLAIM_MINUTES)).isoformat()
    generated = 0
    processed = 0
    while processed < 200:
        series = await db.responsibility_items.find_one_and_update(
            {"is_series": True, "series_status": "active",
             "next_due_at": {"$lte": window_end, "$ne": None},
             "$or": [{"generation_claim_until": None},
                     {"generation_claim_until": {"$exists": False}},
                     {"generation_claim_until": {"$lt": now.isoformat()}}]},
            {"$set": {"generation_claim_until": claim_until}},
            projection={"_id": 0})
        if not series:
            break
        processed += 1
        try:
            generated += await generate_for_series(series)
        except Exception:  # noqa: BLE001
            log.exception("[rc-recurrence] series %s generation failed", series.get("id"))
        finally:
            await db.responsibility_items.update_one(
                {"id": series["id"]}, {"$set": {"generation_claim_until": None}})
    return {"series_processed": processed, "occurrences_generated": generated}


# ── Due-soon / due-now / overdue reminders ───────────────────────────────
REMINDER_KINDS = (("due_soon", -24 * 3600), ("due_now", 0), ("overdue", 3600))


async def run_due_reminder_pass() -> dict:
    """One reminder per (item, kind, due-date version, recipient). Unique
    dedup key insert happens BEFORE the notification, so overlapping
    workers never double-send. A changed due date naturally creates new
    keys; obsolete ones are never re-sent."""
    from services import rc_items
    from services import responsibility_center as rc
    await rc_items.ensure_item_indexes()
    now = _utcnow()
    horizon = (now + timedelta(hours=24)).isoformat()
    floor = (now - timedelta(days=30)).isoformat()
    sent = 0
    cursor = db.responsibility_items.find(
        {"is_series": {"$ne": True}, "status": {"$in": rc_items.ACTIVE_STATUSES},
         "due_at": {"$lte": horizon, "$gte": floor, "$ne": None}},
        {"_id": 0, "id": 1, "center_id": 1, "title": 1, "due_at": 1,
         "visibility": 1, "assignee_ids": 1, "created_by": 1, "status": 1})
    async for item in cursor:
        try:
            due = datetime.fromisoformat(item["due_at"])
        except (ValueError, TypeError):
            continue
        center = await db.responsibility_centers.find_one(
            {"id": item["center_id"]}, {"_id": 0, "name": 1, "status": 1})
        if not center or center.get("status") in ("archived", "deleted", "paused", "closed"):
            continue
        recipients = list(dict.fromkeys(
            (item.get("assignee_ids") or []) or [item.get("created_by")]))
        for kind, offset in REMINDER_KINDS:
            if now < due + timedelta(seconds=offset):
                continue
            label = {"due_soon": "is due within 24 hours",
                     "due_now": "is due now",
                     "overdue": "is overdue"}[kind]
            for uid in recipients:
                if not uid:
                    continue
                m = await db.responsibility_center_memberships.find_one(
                    {"center_id": item["center_id"], "user_id": uid, "status": "active"},
                    {"_id": 0, "user_id": 1})
                if not m:
                    continue  # recipient can no longer access
                dedup_key = f"{item['id']}:{kind}:{item['due_at']}:{uid}"
                try:
                    await db.responsibility_item_reminders.insert_one({
                        "dedup_key": dedup_key, "item_id": item["id"],
                        "kind": kind, "due_at": item["due_at"],
                        "recipient_id": uid, "sent_at": now.isoformat()})
                except DuplicateKeyError:
                    continue  # already sent for this due-date version
                await rc_items._notify_item(
                    uid, f"responsibility_center_item_{kind}",
                    f"{rc_items.item_notify_title(item).capitalize()} in \"{center['name']}\" {label}.",
                    item["center_id"], item["id"])
                sent += 1
    _ = rc
    return {"reminders_sent": sent}
