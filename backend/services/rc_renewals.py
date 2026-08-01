"""Responsibility Center — 30-Day Active Period renewal engine (Bundle A).

Server-side only: never depends on browser activity, page visits, or
client timers. UTC internally. Idempotent + duplicate-burn-proof:
  • Claim-based locking (renewal_claim_until on the membership) stops
    overlapping workers from processing the same membership twice.
  • A unique period-scoped idempotency key on the transaction ledger
    (`rc-renew:{membership_id}:{period_end}`) makes even a raced burn
    impossible to double-apply.
  • Insufficient Vault → NO burn, NO negative balance, only the affected
    membership pauses (after any configured grace window). All Center
    and member records are preserved.
  • Emergency renewal pause (global setting) stops processing without
    touching balances or queued records.
"""
import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from pymongo.errors import DuplicateKeyError

from core.db import db
from services import responsibility_center as rc

log = logging.getLogger("ourrealm.rc.renewals")

INTERVAL_SECONDS = int(os.environ.get("RC_RENEWAL_INTERVAL_SECONDS", "3600"))
ERROR_BACKOFF_SECONDS = 5 * 60
CLAIM_MINUTES = 10
BATCH_SIZE = 200

_task: Optional[asyncio.Task] = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_renewal_indexes() -> None:
    try:
        await db.responsibility_center_renewal_attempts.create_index(
            [("center_id", 1), ("created_at", -1)], name="by_center_time")
        await db.responsibility_center_renewal_attempts.create_index(
            [("result", 1), ("created_at", -1)], name="by_result_time")
        await db.responsibility_center_memberships.create_index(
            [("status", 1), ("seat_paid_until", 1)], name="by_status_due")
    except Exception as e:  # noqa: BLE001
        log.warning(f"[rc-renewals] index init issue: {e}")


async def _record_attempt(center_id: str, user_id: str, result: str, *,
                          amount: int = 0, needed: int = 0, vault_balance: int = 0,
                          period_end: Optional[str] = None, source: str = "scheduler",
                          actor_id: Optional[str] = None, detail: str = "") -> None:
    await db.responsibility_center_renewal_attempts.insert_one({
        "id": uuid.uuid4().hex, "center_id": center_id,
        "membership_user_id": user_id, "result": result,
        "amount": amount, "fire_power_needed": needed,
        "vault_balance": vault_balance, "period_end": period_end,
        "source": source, "actor_id": actor_id, "detail": detail,
        "created_at": _now().isoformat()})


# ── Notification preferences (Bundle B) ─────────────────────────────────
PREF_DEFAULTS = {
    "daily_digest": True,
    "critical_alerts": True,
    "low_vault_alerts": True,
    "paused_member_alerts": True,
    "renewal_success": True,
}


async def get_rc_prefs(uid: str) -> dict:
    doc = await db.rc_notification_prefs.find_one({"user_id": uid}, {"_id": 0}) or {}
    return {**PREF_DEFAULTS, **{k: bool(doc[k]) for k in PREF_DEFAULTS if k in doc}}


async def renew_membership(center: dict, membership: dict, settings: dict,
                           source: str = "scheduler",
                           actor: Optional[dict] = None) -> dict:
    """Attempt ONE renewal for an ACTIVE due membership. Period-scoped
    idempotency key guarantees at most one burn per active period even
    under concurrent callers. Returns {result: renewed|already_renewed|
    insufficient|vault_frozen}."""
    center_id = center["id"]
    uid = membership["user_id"]
    seat_cost = int(settings["seat_cost"])
    period_days = int(settings["period_days"])
    old_due = membership.get("seat_paid_until")
    idem = f"rc-renew:{center_id}:{uid}:{old_due}"

    if center.get("vault_frozen"):
        await _record_attempt(center_id, uid, "vault_frozen", needed=seat_cost,
                              vault_balance=int(center.get("vault_balance") or 0),
                              period_end=old_due, source=source,
                              actor_id=(actor or {}).get("id"),
                              detail="Vault frozen by administrator — renewal deferred")
        return {"result": "vault_frozen"}

    # Idempotency reservation — one burn per (membership, period), ever.
    try:
        await db.responsibility_center_transactions.insert_one({
            "id": uuid.uuid4().hex, "center_id": center_id, "user_id": uid,
            "transaction_type": "seat_renewal", "amount": -seat_cost,
            "status": "reserved", "idempotency_key": idem,
            "created_at": _now().isoformat(),
            "meta": {"period_end": old_due, "source": source}})
    except DuplicateKeyError:
        return {"result": "already_renewed"}
    reservation_q = {"idempotency_key": idem, "status": "reserved"}

    res = await db.responsibility_centers.update_one(
        {"id": center_id, "vault_balance": {"$gte": seat_cost},
         "vault_frozen": {"$ne": True}},
        {"$inc": {"vault_balance": -seat_cost}})
    if res.modified_count != 1:
        # Insufficient Fire Power — burn nothing, delete the reservation so
        # a later retry (after funding) can succeed for this same period.
        await db.responsibility_center_transactions.delete_one(reservation_q)
        fresh = await db.responsibility_centers.find_one(
            {"id": center_id}, {"_id": 0, "vault_balance": 1}) or {}
        bal = max(0, int(fresh.get("vault_balance") or 0))
        await _record_attempt(center_id, uid, "insufficient", needed=seat_cost,
                              vault_balance=bal, period_end=old_due, source=source,
                              actor_id=(actor or {}).get("id"),
                              detail=f"Vault has {bal}, needs {seat_cost}")
        return {"result": "insufficient", "vault_balance": bal, "needed": seat_cost}

    # Extend the active period by the configured duration from the due date.
    now = _now()
    try:
        base = datetime.fromisoformat(old_due) if old_due else now
    except (ValueError, TypeError):
        base = now
    if base < now - timedelta(days=period_days):
        base = now  # grossly overdue — start fresh, never backfill periods
    new_due = (base + timedelta(days=period_days)).isoformat()

    await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": uid, "status": "active"},
        {"$set": {"seat_paid_until": new_due, "warnings_sent": [],
                  "awaiting_fire_power": False, "last_renewed_at": now.isoformat()},
         "$unset": {"renewal_claim_until": ""}})
    await db.responsibility_center_transactions.update_one(
        reservation_q,
        {"$set": {"status": "completed",
                  "meta": {"period_end": old_due, "new_period_end": new_due,
                           "source": source, "seat_days": period_days}}})
    fresh = await db.responsibility_centers.find_one(
        {"id": center_id}, {"_id": 0, "vault_balance": 1}) or {}
    await _record_attempt(center_id, uid, "success", amount=seat_cost,
                          vault_balance=int(fresh.get("vault_balance") or 0),
                          period_end=new_due, source=source,
                          actor_id=(actor or {}).get("id"))
    await rc.log_activity(center_id, actor, "seat_renewed",
                          f"Seat renewed for a member ({seat_cost} Fire Power, "
                          f"{period_days}-Day Active Period)")
    u = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1}) or {}
    owner_prefs = await get_rc_prefs(center["created_by"])
    if owner_prefs.get("renewal_success", True):
        await rc.notify_user(
            center["created_by"], "responsibility_center_renewal",
            f"@{u.get('username') or 'A member'}'s seat in \"{center['name']}\" renewed "
            f"({seat_cost} Fire Power burned from the Center Vault).",
            f"/responsibility-center/{center_id}", center_id, center["name"])
    return {"result": "renewed", "new_period_end": new_due}


async def _pause_membership(center: dict, membership: dict, settings: dict,
                            needed: int, vault_balance: int) -> None:
    """Insufficient Fire Power after grace — pause ONLY this membership.
    Data, attribution, and records are fully preserved."""
    center_id = center["id"]
    uid = membership["user_id"]
    now_iso = _now().isoformat()
    upd = await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": uid, "status": "active"},
        {"$set": {"status": "paused", "paused_at": now_iso,
                  "paused_reason": "insufficient_fire_power",
                  "awaiting_fire_power": False},
         "$unset": {"renewal_claim_until": ""}})
    if upd.modified_count != 1:
        return
    await db.responsibility_centers.update_one(
        {"id": center_id, "member_count": {"$gt": 0}}, {"$inc": {"member_count": -1}})
    await _record_attempt(center_id, uid, "paused", needed=needed,
                          vault_balance=vault_balance,
                          period_end=membership.get("seat_paid_until"),
                          detail="Membership paused — Center Vault below Fire Power Requirement")
    await rc.log_activity(center_id, None, "member_paused",
                          "A member's seat was paused — the Center Vault could not "
                          f"cover the {needed} Fire Power Requirement")
    u = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1}) or {}
    owner_prefs = await get_rc_prefs(center["created_by"])
    if owner_prefs.get("paused_member_alerts", True):
        await rc.notify_user(
            center["created_by"], "responsibility_center_member_paused",
            f"@{u.get('username') or 'A member'}'s seat in \"{center['name']}\" is paused — "
            f"the Center Vault needs {needed} more Fire Power. Add Fire Power to reactivate.",
            f"/responsibility-center/{center_id}", center_id, center["name"])
    await rc.notify_user(
        uid, "responsibility_center_paused",
        f"Your seat in \"{center['name']}\" is paused because the Center Vault "
        f"couldn't cover your Fire Power Requirement. Your records are safe.",
        f"/responsibility-center/{center_id}", center_id, center["name"])


async def _mark_awaiting(center: dict, membership: dict, needed: int, vault_balance: int) -> None:
    """Grace window — member stays active but flagged Awaiting Fire Power.
    Owner + member are notified once per period."""
    center_id = center["id"]
    uid = membership["user_id"]
    period = membership.get("seat_paid_until")
    already = membership.get("awaiting_notified_period") == period
    await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": uid, "status": "active"},
        {"$set": {"awaiting_fire_power": True, "awaiting_notified_period": period},
         "$unset": {"renewal_claim_until": ""}})
    if already:
        return
    u = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1}) or {}
    await rc.notify_user(
        center["created_by"], "responsibility_center_renewal_failed",
        f"@{u.get('username') or 'A member'}'s renewal in \"{center['name']}\" is waiting — "
        f"the Center Vault has {vault_balance} and needs {needed} Fire Power.",
        f"/responsibility-center/{center_id}", center_id, center["name"])
    await rc.notify_user(
        uid, "responsibility_center_renewal_failed",
        f"Your seat renewal in \"{center['name']}\" is awaiting Fire Power in the Center Vault.",
        f"/responsibility-center/{center_id}", center_id, center["name"])


async def run_renewal_pass(batch: int = BATCH_SIZE) -> dict:
    """One scheduler pass: claim + process every due ACTIVE membership."""
    await ensure_renewal_indexes()
    settings = await rc.get_rc_settings()
    summary = {"processed": 0, "renewed": 0, "insufficient": 0, "paused": 0,
               "vault_frozen": 0, "skipped": False}
    if settings.get("emergency_renewal_pause") or not settings.get("auto_renewals_enabled", True):
        summary["skipped"] = True
        return summary
    now = _now()
    now_iso = now.isoformat()
    q = {"status": "active", "seat_paid_until": {"$lte": now_iso}}
    if settings.get("owner_exempt", True):
        q["role"] = {"$ne": "owner"}
    due = await db.responsibility_center_memberships.find(
        q, {"_id": 0}).sort("seat_paid_until", 1).to_list(batch)
    claim_until = (now + timedelta(minutes=CLAIM_MINUTES)).isoformat()
    for m in due:
        # Claim — only one worker may process this membership at a time.
        claimed = await db.responsibility_center_memberships.update_one(
            {"center_id": m["center_id"], "user_id": m["user_id"], "status": "active",
             "$or": [{"renewal_claim_until": {"$exists": False}},
                     {"renewal_claim_until": None},
                     {"renewal_claim_until": {"$lt": now_iso}}]},
            {"$set": {"renewal_claim_until": claim_until}})
        if claimed.modified_count != 1:
            continue
        summary["processed"] += 1
        try:
            center = await db.responsibility_centers.find_one(
                {"id": m["center_id"], "status": "active"}, {"_id": 0})
            if not center:
                # Paused/archived Center — renewals stop; membership untouched.
                await db.responsibility_center_memberships.update_one(
                    {"center_id": m["center_id"], "user_id": m["user_id"]},
                    {"$unset": {"renewal_claim_until": ""}})
                continue
            r = await renew_membership(center, m, settings, source="scheduler")
            if r["result"] == "renewed":
                summary["renewed"] += 1
            elif r["result"] == "vault_frozen":
                summary["vault_frozen"] += 1
            elif r["result"] == "insufficient":
                summary["insufficient"] += 1
                grace_days = int(settings.get("grace_days") or 0)
                due_dt = datetime.fromisoformat(m["seat_paid_until"])
                if grace_days > 0 and now < due_dt + timedelta(days=grace_days):
                    await _mark_awaiting(center, m, r["needed"], r["vault_balance"])
                else:
                    await _pause_membership(center, m, settings, r["needed"], r["vault_balance"])
                    summary["paused"] += 1
        except Exception as e:  # noqa: BLE001 — one bad row never kills the pass
            log.error(f"[rc-renewals] membership {m.get('user_id')} failed: {e}")
        finally:
            await db.responsibility_center_memberships.update_one(
                {"center_id": m["center_id"], "user_id": m["user_id"],
                 "renewal_claim_until": claim_until},
                {"$unset": {"renewal_claim_until": ""}})
    return summary


async def run_warning_pass() -> dict:
    """Send 7/3/1-day renewal reminders to Center owners. Deduped per
    (period, threshold) via warnings_sent on the membership."""
    settings = await rc.get_rc_settings()
    reminder_days = sorted({int(d) for d in (settings.get("reminder_days") or [7, 3, 1])}, reverse=True)
    if not reminder_days:
        return {"warnings": 0}
    now = _now()
    horizon = (now + timedelta(days=max(reminder_days))).isoformat()
    q = {"status": "active", "seat_paid_until": {"$gt": now.isoformat(), "$lte": horizon}}
    if settings.get("owner_exempt", True):
        q["role"] = {"$ne": "owner"}
    sent = 0
    async for m in db.responsibility_center_memberships.find(q, {"_id": 0}):
        due_iso = m.get("seat_paid_until")
        try:
            days_left = (datetime.fromisoformat(due_iso) - now).total_seconds() / 86400
        except (ValueError, TypeError):
            continue
        already = set(m.get("warnings_sent") or [])
        applicable = [d for d in reminder_days if days_left <= d]
        if not applicable:
            continue
        target = min(applicable)  # closest threshold only; larger ones are covered
        if f"{due_iso}:{target}" in already:
            continue
        center = await db.responsibility_centers.find_one(
            {"id": m["center_id"], "status": "active"}, {"_id": 0})
        if not center:
            continue
        # Digest suppression (Bundle B): when the owner receives the daily
        # digest, 7/3-day individual reminders are covered by it — only the
        # final 1-day reminder stays individual. Critical alerts unaffected.
        owner_prefs = await get_rc_prefs(center["created_by"])
        if owner_prefs.get("daily_digest", True) and target > 1:
            await db.responsibility_center_memberships.update_one(
                {"center_id": m["center_id"], "user_id": m["user_id"]},
                {"$addToSet": {"warnings_sent": {"$each": [f"{due_iso}:{d}" for d in applicable if d > 1]}}})
            continue
        u = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "username": 1}) or {}
        vault = max(0, int(center.get("vault_balance") or 0))
        needed = int(settings["seat_cost"])
        extra = f" The Vault needs {needed - vault} more Fire Power." if vault < needed else ""
        await rc.notify_user(
            center["created_by"], "responsibility_center_renewal_reminder",
            f"@{u.get('username') or 'A member'}'s seat in \"{center['name']}\" renews in "
            f"{max(1, int(days_left + 0.999))} day(s) — {needed} Fire Power Requirement. "
            f"Vault: {vault}.{extra}",
            f"/responsibility-center/{m['center_id']}",
            m["center_id"], center["name"])
        await db.responsibility_center_memberships.update_one(
            {"center_id": m["center_id"], "user_id": m["user_id"]},
            {"$addToSet": {"warnings_sent": {"$each": [f"{due_iso}:{d}" for d in applicable]}}})
        sent += 1
    return {"warnings": sent}


# ── Daily Renewal Digest (Bundle B) ─────────────────────────────────────
async def run_digest_pass() -> dict:
    """One grouped digest per Center per UTC day, max. Claim-based dedupe
    via unique index on responsibility_center_digests.dedup_key — safe
    against overlapping workers. Empty digests are never sent."""
    try:
        await db.responsibility_center_digests.create_index(
            [("dedup_key", 1)], unique=True, name="uniq_dedup")
    except Exception:  # noqa: BLE001
        pass
    settings = await rc.get_rc_settings()
    now = _now()
    today = now.date().isoformat()
    day_ago = (now - timedelta(hours=24)).isoformat()
    sent = skipped_empty = 0
    async for center in db.responsibility_centers.find(
            {"status": "active"}, {"_id": 0}):
        cid = center["id"]
        dedup_key = f"digest:{cid}:{today}"
        summary = await rc.renewal_summary(center, settings)
        due_today = await db.responsibility_center_memberships.count_documents({
            "center_id": cid, "status": "active",
            **({"role": {"$ne": "owner"}} if settings.get("owner_exempt", True) else {}),
            "seat_paid_until": {"$lte": (now + timedelta(days=1)).isoformat()}})
        failed_24h = await db.responsibility_center_renewal_attempts.count_documents({
            "center_id": cid, "result": {"$in": ["insufficient", "paused"]},
            "created_at": {"$gte": day_ago}})
        has_content = any([summary["renewing_in_7_days"], summary["awaiting_fire_power"],
                           summary["paused_members"], due_today, failed_24h,
                           summary["fire_power_shortfall_7d"]])
        if not has_content:
            skipped_empty += 1
            continue
        # Claim the day BEFORE sending — duplicate workers lose the insert.
        try:
            await db.responsibility_center_digests.insert_one({
                "id": uuid.uuid4().hex, "dedup_key": dedup_key, "center_id": cid,
                "date": today, "status": "sending", "created_at": now.isoformat(),
                "summary": {**summary, "due_today": due_today, "failed_24h": failed_24h}})
        except DuplicateKeyError:
            continue
        recipients = await db.responsibility_center_memberships.find(
            {"center_id": cid, "status": "active", "role": {"$in": ["owner", "admin"]}},
            {"_id": 0, "user_id": 1}).to_list(50)
        delivered = 0
        parts = []
        if summary["renewing_in_1_day"]:
            parts.append(f"{summary['renewing_in_1_day']} renewing tomorrow")
        elif summary["renewing_in_3_days"]:
            parts.append(f"{summary['renewing_in_3_days']} renewing within 3 days")
        elif summary["renewing_in_7_days"]:
            parts.append(f"{summary['renewing_in_7_days']} renewing within 7 days")
        if due_today:
            parts.append(f"{due_today} due today")
        if summary["paused_members"]:
            parts.append(f"{summary['paused_members']} paused")
        if summary["awaiting_fire_power"]:
            parts.append(f"{summary['awaiting_fire_power']} awaiting Fire Power")
        if failed_24h:
            parts.append(f"{failed_24h} failed attempt(s)")
        detail = ", ".join(parts) or "renewal activity"
        message = (f"Responsibility Center Renewal Summary — \"{center['name']}\": {detail}. "
                   f"Vault: {summary['vault_balance']:,} 🔥"
                   + (f" · needs {summary['fire_power_shortfall_7d']:,} more for the next 7 days"
                      if summary["fire_power_shortfall_7d"] else "")
                   + (f" · covers {summary['vault_coverage_seats']} seat(s)." if not summary["fire_power_shortfall_7d"] else "."))
        for r in recipients:
            prefs = await get_rc_prefs(r["user_id"])
            if not prefs.get("daily_digest", True):
                continue
            await rc.notify_user(
                r["user_id"], "responsibility_center_digest", message,
                f"/responsibility-center/{cid}", cid, center["name"])
            delivered += 1
        await db.responsibility_center_digests.update_one(
            {"dedup_key": dedup_key},
            {"$set": {"status": "sent", "delivered_to": delivered,
                      "sent_at": _now().isoformat()}})
        sent += 1
    return {"digests_sent": sent, "skipped_empty": skipped_empty}


# ── Scheduler lifecycle (same pattern as services/purge_cron.py) ────────
async def _loop():
    log.info("[rc-renewals] worker started (interval=%ds)", INTERVAL_SECONDS)
    await asyncio.sleep(45)
    while True:
        try:
            w = await run_warning_pass()
            s = await run_renewal_pass()
            d = await run_digest_pass()
            from services import rc_recurrence
            r = await rc_recurrence.run_recurrence_pass()
            m = await rc_recurrence.run_due_reminder_pass()
            if s["processed"] or w["warnings"] or d["digests_sent"] \
                    or r["occurrences_generated"] or m["reminders_sent"]:
                log.info("[rc-renewals] pass complete: renewals=%s warnings=%s digest=%s recurrence=%s reminders=%s",
                         s, w, d, r, m)
            await asyncio.sleep(INTERVAL_SECONDS)
        except asyncio.CancelledError:
            log.info("[rc-renewals] worker cancelled")
            raise
        except Exception:  # noqa: BLE001
            log.exception("[rc-renewals] pass failed — backing off")
            await asyncio.sleep(ERROR_BACKOFF_SECONDS)


def start_renewal_scheduler() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())


def stop_renewal_scheduler() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
    _task = None
