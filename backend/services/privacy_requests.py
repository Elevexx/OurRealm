"""Privacy erasure request workflow — formal, deadline-tracked, admin-reviewed.

Rules (June 2026 spec):
  • Submitting a request does NOT hide/disable the account unless the
    requester explicitly chooses "hide immediately" (or an admin applies
    a documented safety restriction, or erasure is approved).
  • Admin review is REQUIRED before permanent erasure — never auto-
    approved, never auto-refused, never indefinitely pending (deadline
    tracking + escalation + overdue flags + emergency queue).
  • Calendar-month deadlines for GDPR-style jurisdictions (one month
    from receipt; extension of up to two additional months with a
    documented reason, applied within the original period).
  • Refusal / partial approval NEVER auto-restores an account.
  • "Apply Restricted Retention" (not a generic legal hold) requires
    data categories, purpose, approver, review date, expiry.
"""
from __future__ import annotations

import calendar
import uuid
from datetime import datetime, timezone
from typing import Optional

from core.db import db
from services.account_deletion import (
    remove_public_access, enqueue_erasure_job, _audit, _notify,
    STATUS_ERASURE_IN_PROGRESS,
)
from core.account_lifecycle import STATUS_DELETED_PENDING

STATUSES = ["received", "identity_pending", "under_review", "approved",
            "partially_approved", "refused", "restricted_retention",
            "withdrawn", "completed"]
OPEN_STATUSES = ["received", "identity_pending", "under_review"]

JURISDICTIONS = {
    "gdpr_eu":  {"label": "EU (GDPR)", "months": 1, "max_extension_months": 2},
    "gdpr_uk":  {"label": "UK (UK GDPR)", "months": 1, "max_extension_months": 2},
    "us_ca":    {"label": "California (CCPA/CPRA)", "days": 45, "max_extension_days": 45},
    "other":    {"label": "Other / Unknown", "months": 1, "max_extension_months": 2},
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def add_calendar_months(dt: datetime, months: int) -> datetime:
    """Calendar-month arithmetic (Jan 31 + 1mo → Feb 28/29)."""
    y = dt.year + (dt.month - 1 + months) // 12
    m = (dt.month - 1 + months) % 12 + 1
    d = min(dt.day, calendar.monthrange(y, m)[1])
    return dt.replace(year=y, month=m, day=d)


def compute_due(received: datetime, jurisdiction: str) -> str:
    cfg = JURISDICTIONS.get(jurisdiction) or JURISDICTIONS["other"]
    if "months" in cfg:
        return add_calendar_months(received, cfg["months"]).isoformat()
    from datetime import timedelta
    return (received + timedelta(days=cfg["days"])).isoformat()


def decorate(req: dict) -> dict:
    """Attach computed deadline urgency for queue rendering."""
    due_iso = req.get("extended_due_at") or req.get("response_due_at")
    out = dict(req)
    if due_iso and req.get("status") in OPEN_STATUSES:
        due = datetime.fromisoformat(due_iso)
        days = (due - _now()).days
        out["days_remaining"] = days
        out["overdue"] = days < 0
        out["urgent"] = 0 <= days <= 7
    else:
        out["days_remaining"] = None
        out["overdue"] = False
        out["urgent"] = False
    return out


async def create_request(user: dict, *, details: str, jurisdiction: str,
                         hide_account: bool, source: str = "self_service",
                         received_at: Optional[str] = None,
                         original_evidence: Optional[str] = None,
                         created_by: Optional[str] = None) -> dict:
    existing = await db.privacy_erasure_requests.find_one(
        {"user_id": user["id"], "status": {"$in": OPEN_STATUSES + ["approved"]}},
        {"_id": 0})
    if existing:
        raise ValueError("An erasure request is already open for this account")
    jurisdiction = jurisdiction if jurisdiction in JURISDICTIONS else "other"
    received = datetime.fromisoformat(received_at) if received_at else _now()
    req = {
        "id": uuid.uuid4().hex,
        "user_id": user["id"],
        "username": user.get("username"),
        "type": "erasure",
        "details": (details or "").strip()[:2000],
        "source": source,
        "created_by": created_by or user["id"],
        "status": "received",
        "received_at": received.isoformat(),
        "jurisdiction": jurisdiction,
        "response_due_at": compute_due(received, jurisdiction),
        "identity_information_requested_at": None,
        "identity_verified_at": None,
        # Self-service submissions from an authenticated, password-verified
        # session count as proportionate identity evidence.
        "identity_evidence": "authenticated session + password reauth"
                             if source == "self_service" else None,
        "extension_applied_at": None,
        "extended_due_at": None,
        "extension_reason": None,
        "requester_notified_at": None,
        "completed_at": None,
        "hide_account_selected": bool(hide_account),
        "decision": None,
        "decision_reason": None,
        "decided_by": None,
        "decided_at": None,
        "restricted_retention_id": None,
        "job_id": None,
        "original_evidence": (original_evidence or "").strip()[:4000] or None,
        "timeline": [{"at": received.isoformat(), "event": "request_received",
                      "by": created_by or user["id"]}],
        "created_at": _now_iso(),
    }
    if source == "self_service":
        req["identity_verified_at"] = _now_iso()
        req["status"] = "under_review"
    await db.privacy_erasure_requests.insert_one(dict(req))
    if hide_account:
        # User-selected hide during review — recoverable state, no purge
        # date (erasure only runs after an approved decision).
        await remove_public_access(
            user["id"], account_status=STATUS_DELETED_PENDING,
            purge_after=None, reason="hidden at requester's choice during privacy review")
        await _notify(user["id"], "account_hidden", {"request_id": req["id"]})
    await _audit("privacy.request_created", user["id"], created_by or user["id"],
                 request_id=req["id"], jurisdiction=jurisdiction,
                 hide_account=hide_account, source=source)
    await _notify(user["id"], "privacy_request_received",
                  {"request_id": req["id"], "response_due_at": req["response_due_at"]})
    from services.mailer import send_email
    await send_email(
        user.get("email") or "", "We received your data erasure request",
        f"Your privacy erasure request was received and is under review. "
        f"We will respond by {req['response_due_at'][:10]}.",
        kind="privacy_request_received", user_id=user["id"])
    req.pop("_id", None)
    return req


async def withdraw(request_id: str, user: dict) -> dict:
    req = await db.privacy_erasure_requests.find_one(
        {"id": request_id, "user_id": user["id"]}, {"_id": 0})
    if not req:
        raise ValueError("Request not found")
    if req["status"] not in OPEN_STATUSES:
        raise ValueError(f"Request is {req['status']} and can no longer be withdrawn")
    await db.privacy_erasure_requests.update_one(
        {"id": request_id},
        {"$set": {"status": "withdrawn", "decided_at": _now_iso()},
         "$push": {"timeline": {"at": _now_iso(), "event": "withdrawn",
                                "by": user["id"]}}})
    await _audit("privacy.request_withdrawn", user["id"], user["id"],
                 request_id=request_id)
    return {"ok": True}


async def set_identity(request_id: str, actor: dict, action: str,
                       note: Optional[str] = None) -> dict:
    req = await db.privacy_erasure_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise ValueError("Request not found")
    now = _now_iso()
    if action == "request_info":
        sets = {"identity_information_requested_at": now, "status": "identity_pending"}
        event = "identity_info_requested"
        await _notify(req["user_id"], "identity_verification_needed",
                      {"request_id": request_id})
    elif action == "mark_verified":
        sets = {"identity_verified_at": now, "status": "under_review",
                "identity_evidence": (note or "verified by admin")[:400]}
        event = "identity_verified"
    else:
        raise ValueError("Unknown identity action")
    await db.privacy_erasure_requests.update_one(
        {"id": request_id},
        {"$set": sets, "$push": {"timeline": {"at": now, "event": event,
                                              "by": actor["id"], "note": note}}})
    await _audit(f"privacy.{event}", req["user_id"], actor["id"], request_id=request_id)
    return {"ok": True}


async def extend_deadline(request_id: str, actor: dict, reason: str,
                          months: int = 2) -> dict:
    req = await db.privacy_erasure_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise ValueError("Request not found")
    if req["status"] not in OPEN_STATUSES:
        raise ValueError("Only open requests can be extended")
    if req.get("extension_applied_at"):
        raise ValueError("An extension was already applied")
    if not (reason or "").strip() or len(reason.strip()) < 10:
        raise ValueError("A documented reason (min 10 chars) is required")
    cfg = JURISDICTIONS.get(req["jurisdiction"]) or JURISDICTIONS["other"]
    max_months = cfg.get("max_extension_months", 2)
    months = max(1, min(int(months), max_months))
    original_due = datetime.fromisoformat(req["response_due_at"])
    if _now() > original_due:
        raise ValueError("Extension must be applied within the original response period")
    new_due = add_calendar_months(original_due, months).isoformat()
    now = _now_iso()
    await db.privacy_erasure_requests.update_one(
        {"id": request_id},
        {"$set": {"extension_applied_at": now, "extended_due_at": new_due,
                  "extension_reason": reason.strip()[:800],
                  "requester_notified_at": now},
         "$push": {"timeline": {"at": now, "event": "deadline_extended",
                                "by": actor["id"], "note": reason.strip()[:200]}}})
    await _notify(req["user_id"], "privacy_request_extended",
                  {"request_id": request_id, "new_due": new_due})
    from services.mailer import send_email
    u = await db.users.find_one({"id": req["user_id"]}, {"_id": 0, "email": 1})
    await send_email(
        (u or {}).get("email") or "", "Update on your data erasure request",
        f"Reviewing your request needs additional time. The new response "
        f"date is {new_due[:10]}. Reason category: complex request.",
        kind="privacy_request_extension", user_id=req["user_id"])
    await _audit("privacy.deadline_extended", req["user_id"], actor["id"],
                 request_id=request_id, new_due=new_due, reason=reason.strip()[:400])
    return {"extended_due_at": new_due}


async def decide(request_id: str, actor: dict, *, action: str, reason: str,
                 retention: Optional[dict] = None) -> dict:
    """action ∈ approve | partial | refuse | restricted_retention.

    approve → hide account (if not already), start the erasure job.
    partial/refuse → documented, requester notified; account visibility
    is NOT changed (no auto-restore, no auto-hide).
    restricted_retention → requires categories/purpose/review_date; the
    rest of the account is approved for erasure with a retention record.
    """
    req = await db.privacy_erasure_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise ValueError("Request not found")
    if req["status"] not in OPEN_STATUSES:
        raise ValueError(f"Request already decided ({req['status']})")
    if not (reason or "").strip() or len(reason.strip()) < 10:
        raise ValueError("A documented reason (min 10 chars) is required")
    if not req.get("identity_verified_at") and action in ("approve", "restricted_retention"):
        raise ValueError("Identity must be verified before approving erasure")
    now = _now_iso()
    user = await db.users.find_one({"id": req["user_id"]}, {"_id": 0})
    sets = {"decision": action, "decision_reason": reason.strip()[:1500],
            "decided_by": actor["id"], "decided_at": now,
            "requester_notified_at": now}
    retention_id = None

    if action in ("approve", "restricted_retention"):
        if action == "restricted_retention":
            retention = retention or {}
            missing = [f for f in ("categories", "purpose", "review_date")
                       if not retention.get(f)]
            if missing:
                raise ValueError(f"Restricted retention requires: {', '.join(missing)}")
            retention_id = uuid.uuid4().hex
            await db.restricted_retention_records.insert_one({
                "id": retention_id,
                "user_id": req["user_id"],
                "request_id": request_id,
                "categories": [str(c)[:100] for c in retention["categories"]][:20],
                "purpose": str(retention["purpose"])[:800],
                "approved_by": actor["id"],
                "approver_username": actor.get("username"),
                "review_date": str(retention["review_date"])[:32],
                "expires_at": str(retention.get("expires_at") or "")[:32] or None,
                "access": "restricted — support/legal review only",
                "prohibited_uses": ["public visibility", "advertising",
                                    "profiling", "any unrelated use"],
                "status": "active",
                "created_at": now,
            })
            sets["restricted_retention_id"] = retention_id
            sets["status"] = "restricted_retention"
        else:
            sets["status"] = "approved"
        if user:
            await remove_public_access(
                req["user_id"], account_status=STATUS_ERASURE_IN_PROGRESS,
                reason=f"privacy erasure approved ({action})", actor_id=actor["id"])
            job = await enqueue_erasure_job(
                user, source="privacy_request", requested_by=actor["id"],
                request_id=request_id)
            sets["job_id"] = job["id"]
        await _notify(req["user_id"], "privacy_request_approved",
                      {"request_id": request_id, "partial": action == "restricted_retention"})
    else:  # partial | refuse — NEVER changes account visibility state
        sets["status"] = "partially_approved" if action == "partial" else "refused"
        kind = ("privacy_request_partly_approved" if action == "partial"
                else "privacy_request_refused")
        await _notify(req["user_id"], kind, {"request_id": request_id})

    await db.privacy_erasure_requests.update_one(
        {"id": request_id},
        {"$set": sets, "$push": {"timeline": {"at": now, "event": f"decision_{action}",
                                              "by": actor["id"],
                                              "note": reason.strip()[:200]}}})
    from services.mailer import send_email
    await send_email(
        (user or {}).get("email") or "", "Decision on your data erasure request",
        f"Your data erasure request has been reviewed. Outcome: {sets['status'].replace('_', ' ')}. "
        "Sign in to see the full decision details.",
        kind="privacy_request_decision", user_id=req["user_id"])
    await _audit(f"privacy.decision_{action}", req["user_id"], actor["id"],
                 request_id=request_id, reason=reason.strip()[:400],
                 retention_id=retention_id)
    return {"status": sets["status"], "job_id": sets.get("job_id"),
            "restricted_retention_id": retention_id}


async def run_reminder_pass() -> int:
    """Escalation reminders → admin notifications for urgent/overdue
    requests (at most one reminder per request per day)."""
    sent = 0
    admins = [u async for u in db.users.find(
        {"admin_role": {"$in": ["founder", "support_admin"]}}, {"_id": 0, "id": 1})]
    if not admins:
        return 0
    async for req in db.privacy_erasure_requests.find(
            {"status": {"$in": OPEN_STATUSES}}, {"_id": 0}):
        d = decorate(req)
        if not (d["overdue"] or d["urgent"]):
            continue
        last = req.get("last_reminder_at")
        if last and (_now() - datetime.fromisoformat(last)).total_seconds() < 86000:
            continue
        kind = "privacy_request_overdue" if d["overdue"] else "privacy_request_due_soon"
        for a in admins:
            await _notify(a["id"], kind, {"request_id": req["id"],
                                          "username": req.get("username"),
                                          "days_remaining": d["days_remaining"]})
        await db.privacy_erasure_requests.update_one(
            {"id": req["id"]}, {"$set": {"last_reminder_at": _now_iso()}})
        sent += 1
    return sent
