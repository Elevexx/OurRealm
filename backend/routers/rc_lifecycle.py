"""Responsibility Center — Bundle D lifecycle endpoints.

Owner/member routes under /api/responsibility-center/{cid}/lifecycle/*
and founder/admin routes under /api/admin/responsibility-center/{cid}/lifecycle/*.
All permissions enforced backend-side.
"""
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from core.deps import CurrentUser
from routers.rc_admin import require_rc_perm
from services import rc_lifecycle as lc

router = APIRouter(prefix="/api/responsibility-center", tags=["responsibility-center-lifecycle"])
admin_router = APIRouter(prefix="/api/admin/responsibility-center", tags=["rc-admin-lifecycle"])


@router.get("/{center_id}/lifecycle")
async def lifecycle_overview(center_id: str, current: CurrentUser):
    return await lc.lifecycle_overview(current, center_id)


class TransferBody(BaseModel):
    to_user_id: str
    post_transfer_role: str = "admin"
    note: str = Field("", max_length=500)
    confirm_name: str = ""


@router.post("/{center_id}/lifecycle/transfer")
async def create_transfer(center_id: str, body: TransferBody, current: CurrentUser):
    return await lc.create_transfer(current, center_id, body.to_user_id,
                                    body.post_transfer_role, body.note, body.confirm_name)


class RespondBody(BaseModel):
    accept: bool


@router.post("/{center_id}/lifecycle/transfer/{transfer_id}/respond")
async def respond_transfer(center_id: str, transfer_id: str, body: RespondBody, current: CurrentUser):
    return await lc.respond_transfer(current, center_id, transfer_id, body.accept)


@router.post("/{center_id}/lifecycle/transfer/{transfer_id}/cancel")
async def cancel_transfer(center_id: str, transfer_id: str, current: CurrentUser):
    return await lc.cancel_transfer(current, center_id, transfer_id)


class RecoveryBody(BaseModel):
    reason: str = Field(..., max_length=1000)


@router.post("/{center_id}/lifecycle/recovery")
async def request_recovery(center_id: str, body: RecoveryBody, current: CurrentUser):
    return await lc.request_recovery(current, center_id, body.reason)


@router.get("/{center_id}/lifecycle/leave-preview")
async def leave_preview(center_id: str, current: CurrentUser):
    return await lc.leave_preview(current, center_id)


@router.post("/{center_id}/lifecycle/leave")
async def leave_safe(center_id: str, current: CurrentUser):
    return await lc.leave_center_safe(current, center_id)


class RemoveBody(BaseModel):
    reason: str = Field(..., max_length=500)
    work_mode: str = "keep"
    reassign_to: Optional[str] = None


@router.post("/{center_id}/lifecycle/members/{user_id}/remove")
async def remove_member(center_id: str, user_id: str, body: RemoveBody, current: CurrentUser):
    return await lc.remove_member_safe(current, center_id, user_id,
                                       body.reason, body.work_mode, body.reassign_to)


class ReassignBody(BaseModel):
    from_user_id: str
    to_user_id: Optional[str] = None
    mode: str = "reassign"


@router.post("/{center_id}/lifecycle/reassign-work")
async def reassign_work(center_id: str, body: ReassignBody, current: CurrentUser):
    return await lc.reassign_work(current, center_id, body.from_user_id,
                                  body.to_user_id, body.mode)


class ReasonBody(BaseModel):
    reason: str = Field("", max_length=500)


@router.post("/{center_id}/lifecycle/pause")
async def pause_center(center_id: str, body: ReasonBody, current: CurrentUser):
    return await lc.pause_center(current, center_id, body.reason)


class ArchiveBody(BaseModel):
    confirm_name: str
    reason: str = Field("", max_length=500)


@router.post("/{center_id}/lifecycle/archive")
async def archive_center(center_id: str, body: ArchiveBody, current: CurrentUser):
    return await lc.archive_center(current, center_id, body.confirm_name, body.reason)


@router.post("/{center_id}/lifecycle/restore")
async def restore_center(center_id: str, current: CurrentUser):
    return await lc.restore_center(current, center_id)


class CloseBody(BaseModel):
    confirm_name: str
    confirm_phrase: str
    reason: str = Field(..., max_length=500)


@router.post("/{center_id}/lifecycle/close")
async def request_closure(center_id: str, body: CloseBody, current: CurrentUser):
    return await lc.request_closure(current, center_id, body.confirm_name,
                                    body.confirm_phrase, body.reason)


@router.post("/{center_id}/lifecycle/close/cancel")
async def cancel_closure(center_id: str, current: CurrentUser):
    return await lc.cancel_closure(current, center_id)


@router.get("/{center_id}/lifecycle/export")
async def export_center(center_id: str, current: CurrentUser):
    return await lc.export_center(current, center_id)


# ── Founder/Admin lifecycle tools ────────────────────────────────────────
class AdminReasonBody(BaseModel):
    reason: str = Field(..., max_length=500)


@admin_router.get("/{center_id}/lifecycle")
async def admin_lifecycle(center_id: str, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    from core.db import db
    center = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0})
    transfers = await db.responsibility_center_transfers.find(
        {"center_id": center_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
    recoveries = await db.responsibility_center_recovery_requests.find(
        {"center_id": center_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
    audit = await db.responsibility_center_lifecycle_audit.find(
        {"center_id": center_id}, {"_id": 0}).sort("created_at", -1).to_list(40)
    return {"center": center, "transfers": transfers,
            "recovery_requests": recoveries, "lifecycle_audit": audit}


@admin_router.post("/{center_id}/lifecycle/transfer/{transfer_id}/cancel")
async def admin_cancel_transfer(center_id: str, transfer_id: str,
                                body: AdminReasonBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.transfer_ownership")
    return await lc.cancel_transfer(current, center_id, transfer_id,
                                    body.reason, as_admin=True)


class RecoveryDecisionBody(BaseModel):
    decision: str
    reason: str = Field(..., max_length=500)


@admin_router.post("/{center_id}/lifecycle/recovery/{request_id}/decide")
async def admin_decide_recovery(center_id: str, request_id: str,
                                body: RecoveryDecisionBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_ownership_recovery")
    return await lc.admin_decide_recovery(current, center_id, request_id,
                                          body.decision, body.reason)


class ClosureDecisionBody(BaseModel):
    decision: str
    reason: str = Field(..., max_length=500)


@admin_router.post("/{center_id}/lifecycle/closure/decide")
async def admin_decide_closure(center_id: str, body: ClosureDecisionBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.review_closure")
    return await lc.admin_decide_closure(current, center_id, body.decision, body.reason)


@admin_router.post("/{center_id}/lifecycle/closure/cancel")
async def admin_cancel_closure(center_id: str, body: AdminReasonBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.cancel_closure")
    return await lc.cancel_closure(current, center_id, as_admin=True, reason=body.reason)


class HoldBody(BaseModel):
    hold: bool
    reason: str = Field(..., max_length=500)


@admin_router.post("/{center_id}/lifecycle/retention-hold")
async def admin_retention_hold(center_id: str, body: HoldBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_retention_hold")
    return await lc.set_retention_hold(current, center_id, body.hold, body.reason)


@admin_router.post("/{center_id}/lifecycle/restore")
async def admin_restore(center_id: str, body: AdminReasonBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.restore")
    return await lc.restore_center(current, center_id, as_admin=True, reason=body.reason)


@admin_router.get("/{center_id}/lifecycle/export")
async def admin_export(center_id: str, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.export_data")
    return await lc.export_center(current, center_id, as_admin=True)
