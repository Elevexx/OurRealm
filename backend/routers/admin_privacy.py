"""/api/admin/privacy — Privacy Requests queue + deletion job control.

Access: support admins + founder (require_support_access). Restricted
retention decisions and job stop are founder-only.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_support_access, require_founder
from services import privacy_requests as prs
from services import account_deletion as ads

router = APIRouter(prefix="/api/admin/privacy", tags=["admin-privacy"])


@router.get("/requests")
async def list_requests(current: CurrentUser, status: Optional[str] = None,
                        view: Optional[str] = None):
    require_support_access(current)
    q: dict = {}
    if status:
        q["status"] = status
    rows = [prs.decorate(r) async for r in db.privacy_erasure_requests.find(
        q, {"_id": 0}).sort("received_at", 1).limit(300)]
    if view == "overdue":
        rows = [r for r in rows if r["overdue"]]
    elif view == "emergency":
        rows = [r for r in rows if r["overdue"] or r["urgent"]]
    open_rows = [r for r in rows if r["status"] in prs.OPEN_STATUSES]
    return {
        "requests": rows,
        "summary": {
            "open": len(open_rows) if not status and not view else
                    await db.privacy_erasure_requests.count_documents(
                        {"status": {"$in": prs.OPEN_STATUSES}}),
            "overdue": sum(1 for r in rows if r["overdue"]),
            "urgent": sum(1 for r in rows if r["urgent"]),
        },
    }


@router.get("/requests/{request_id}")
async def get_request(request_id: str, current: CurrentUser):
    require_support_access(current)
    req = await db.privacy_erasure_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    out = prs.decorate(req)
    if req.get("job_id"):
        out["job"] = await db.account_deletion_jobs.find_one(
            {"id": req["job_id"]}, {"_id": 0, "contact_email": 0})
    if req.get("restricted_retention_id"):
        out["retention"] = await db.restricted_retention_records.find_one(
            {"id": req["restricted_retention_id"]}, {"_id": 0})
    u = await db.users.find_one({"id": req["user_id"]},
                                {"_id": 0, "account_status": 1, "disabled": 1,
                                 "created_at": 1, "username": 1})
    out["account"] = u
    return {"request": out}


class DecisionPayload(BaseModel):
    action: str = Field(pattern="^(approve|partial|refuse|restricted_retention)$")
    reason: str = Field(min_length=10, max_length=1500)
    retention: Optional[dict] = None


@router.post("/requests/{request_id}/decision")
async def decide_request(request_id: str, payload: DecisionPayload, current: CurrentUser):
    require_support_access(current)
    if payload.action == "restricted_retention":
        require_founder(current)
    try:
        result = await prs.decide(request_id, current, action=payload.action,
                                  reason=payload.reason, retention=payload.retention)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, **result}


class ExtendPayload(BaseModel):
    reason: str = Field(min_length=10, max_length=800)
    months: int = Field(default=2, ge=1, le=2)


@router.post("/requests/{request_id}/extend")
async def extend_request(request_id: str, payload: ExtendPayload, current: CurrentUser):
    require_support_access(current)
    try:
        result = await prs.extend_deadline(request_id, current,
                                           payload.reason, payload.months)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, **result}


class IdentityPayload(BaseModel):
    action: str = Field(pattern="^(request_info|mark_verified)$")
    note: Optional[str] = Field(default=None, max_length=400)


@router.post("/requests/{request_id}/identity")
async def identity_action(request_id: str, payload: IdentityPayload, current: CurrentUser):
    require_support_access(current)
    try:
        return await prs.set_identity(request_id, current, payload.action, payload.note)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class IntakePayload(BaseModel):
    """Manual intake — logs a request received through another channel
    (e.g. an in-app message). received_at may be backdated to the date
    the original message arrived; the original text is preserved as
    restricted evidence."""
    username:          str = Field(min_length=1, max_length=64)
    received_at:       Optional[str] = Field(default=None, max_length=40)
    jurisdiction:      str = Field(default="other", max_length=20)
    details:           Optional[str] = Field(default=None, max_length=2000)
    original_evidence: Optional[str] = Field(default=None, max_length=4000)
    hide_account:      bool = False


@router.post("/requests/intake")
async def manual_intake(payload: IntakePayload, current: CurrentUser):
    require_support_access(current)
    user = await db.users.find_one({"username": payload.username.lower().strip()},
                                   {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        req = await prs.create_request(
            user, details=payload.details or "",
            jurisdiction=payload.jurisdiction,
            hide_account=payload.hide_account,
            source="manual_intake",
            received_at=payload.received_at,
            original_evidence=payload.original_evidence,
            created_by=current["id"])
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"ok": True, "request": prs.decorate(req)}


# ── Founder privacy statistics (rendered on the Privacy Requests page)
@router.get("/stats")
async def privacy_stats(current: CurrentUser):
    require_support_access(current)
    from datetime import datetime
    open_statuses = prs.OPEN_STATUSES
    reqs = [r async for r in db.privacy_erasure_requests.find({}, {"_id": 0})]
    decorated = [prs.decorate(r) for r in reqs]
    completed = [r for r in reqs if r.get("completed_at")]
    durations = []
    for r in completed:
        try:
            durations.append((datetime.fromisoformat(r["completed_at"])
                              - datetime.fromisoformat(r["received_at"])).total_seconds())
        except Exception:  # noqa: BLE001
            pass
    avg_days = round(sum(durations) / len(durations) / 86400, 1) if durations else None
    return {"stats": {
        "pending_requests": sum(1 for r in reqs if r["status"] in open_statuses),
        "overdue_requests": sum(1 for r in decorated if r["overdue"]),
        "pending_deletions": await db.account_deletion_jobs.count_documents(
            {"status": {"$in": ["queued", "running", "failed"]}}),
        "completed_deletions": await db.account_deletion_jobs.count_documents(
            {"status": "completed"}),
        "closed_accounts": await db.users.count_documents(
            {"account_status": "deleted_pending_restore"}),
        "restricted_retention": await db.restricted_retention_records.count_documents(
            {"status": "active"}),
        "avg_completion_days": avg_days,
    }}


# ── Deletion jobs ───────────────────────────────────────────────────
@router.get("/deletion-jobs")
async def list_jobs(current: CurrentUser, status: Optional[str] = None):
    require_support_access(current)
    q = {"status": status} if status else {}
    rows = [j async for j in db.account_deletion_jobs.find(
        q, {"_id": 0, "contact_email": 0}).sort("created_at", -1).limit(100)]
    return {"jobs": rows, "stages": [{"key": k, "label": l} for k, l in ads.STAGES],
            "irreversible_from": ads.IRREVERSIBLE_FROM}


@router.post("/deletion-jobs/{job_id}/retry")
async def retry_job(job_id: str, current: CurrentUser):
    require_support_access(current)
    try:
        return await ads.retry_failed_job(job_id, current)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/deletion-jobs/{job_id}/stop")
async def stop_job(job_id: str, current: CurrentUser):
    require_founder(current)
    try:
        return await ads.request_stop(job_id, current)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Restricted retention records ────────────────────────────────────
@router.get("/retention")
async def list_retention(current: CurrentUser):
    require_support_access(current)
    rows = [r async for r in db.restricted_retention_records.find(
        {}, {"_id": 0}).sort("created_at", -1).limit(100)]
    return {"records": rows}


class ReleasePayload(BaseModel):
    reason: str = Field(min_length=10, max_length=800)


@router.post("/retention/{record_id}/release")
async def release_retention(record_id: str, payload: ReleasePayload, current: CurrentUser):
    require_founder(current)
    rec = await db.restricted_retention_records.find_one({"id": record_id}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Record not found")
    if rec.get("status") != "active":
        raise HTTPException(status_code=400, detail=f"Record is {rec.get('status')}")
    from services.account_deletion import _audit, _now_iso
    await db.restricted_retention_records.update_one(
        {"id": record_id}, {"$set": {"status": "released",
                                     "released_at": _now_iso(),
                                     "released_by": current["id"],
                                     "release_reason": payload.reason.strip()}})
    await _audit("privacy.retention_released", rec["user_id"], current["id"],
                 record_id=record_id, reason=payload.reason.strip()[:400])
    return {"ok": True}
