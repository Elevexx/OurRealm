"""Waitlist routes — public (/api/waitlist/public, unauthenticated with
rate-limited email codes) + admin (/api/waitlist/admin, support/founder)."""
from __future__ import annotations

import base64
from typing import Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_support_access, require_founder
from services import waitlist as wl

public_router = APIRouter(prefix="/api/waitlist/public", tags=["waitlist-public"])
admin_router = APIRouter(prefix="/api/waitlist/admin", tags=["waitlist-admin"])


def _err(e: ValueError):
    raise HTTPException(status_code=400, detail=str(e))


# ── Public ──────────────────────────────────────────────────────────
@public_router.get("/config")
async def public_config():
    settings = (await wl.get_settings())["published"]
    mode = await wl.get_signup_mode()
    return {"page": settings, "signup_mode": mode["mode"]}


@public_router.get("/username-check")
async def public_username_check(u: str):
    return await wl.username_state(u)


class ReserveStart(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    email: str = Field(min_length=5, max_length=120)
    premium_request: bool = False


@public_router.post("/reserve/start")
async def reserve_start(payload: ReserveStart):
    try:
        return {"ok": True, **(await wl.start_reservation(
            payload.username, payload.email, premium_request=payload.premium_request))}
    except ValueError as e:
        _err(e)


class ReserveConfirm(BaseModel):
    email: str
    code: str = Field(min_length=4, max_length=10)
    accepted_terms: bool = False
    accepted_conditions: bool = False
    accepted_privacy: bool = False
    age_confirmed_13: bool = False


@public_router.post("/reserve/confirm")
async def reserve_confirm(payload: ReserveConfirm):
    try:
        return {"ok": True, **(await wl.confirm_reservation(
            payload.email, payload.code, payload.dict(exclude={"email", "code"})))}
    except ValueError as e:
        _err(e)


class EmailOnly(BaseModel):
    email: str = Field(min_length=5, max_length=120)


@public_router.post("/status/request-code")
async def status_request_code(payload: EmailOnly):
    email = payload.email.lower().strip()
    res = await db.waitlist_reservations.find_one({"email": email}, {"_id": 1})
    # Same response whether or not a reservation exists (no enumeration).
    if res:
        try:
            await wl.send_code(email, "status")
        except ValueError as e:
            _err(e)
    return {"ok": True, "message": "If a reservation exists, a code was sent."}


class StatusLogin(BaseModel):
    email: str
    code: str


@public_router.post("/status")
async def status_login(payload: StatusLogin):
    try:
        out = await wl.status_login(payload.email, payload.code)
    except ValueError as e:
        _err(e)
    show_q = (await wl.get_settings())["published"].get("show_queue_position", True)
    out["reservation"] = {**out["reservation"],
                          "queue_position": out["reservation"]["queue_position"] if show_q else None}
    return out


class TokenPayload(BaseModel):
    status_token: str


@public_router.post("/me")
async def status_me(payload: TokenPayload):
    try:
        res = await wl.by_token(payload.status_token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    show_q = (await wl.get_settings())["published"].get("show_queue_position", True)
    return {"reservation": wl.public_view(res, show_q)}


@public_router.post("/withdraw")
async def status_withdraw(payload: TokenPayload):
    try:
        return await wl.withdraw(await wl.by_token(payload.status_token))
    except ValueError as e:
        _err(e)


class VerificationPayload(TokenPayload):
    category: str
    legal_name: str = ""
    website: str = ""
    explanation: str = ""
    links: list[str] = []
    accurate: bool = False


@public_router.post("/verification-request")
async def verification_request(payload: VerificationPayload):
    try:
        res = await wl.by_token(payload.status_token)
        return await wl.request_verification(res, payload.dict(exclude={"status_token"}))
    except ValueError as e:
        _err(e)


class DocUpload(TokenPayload):
    name: str
    mime: str
    data_base64: str


@public_router.post("/documents/upload")
async def doc_upload(payload: DocUpload):
    try:
        res = await wl.by_token(payload.status_token)
        raw = base64.b64decode(payload.data_base64 or "", validate=False)
        return {"ok": True, "document": await wl.upload_document(
            res, payload.name, payload.mime, raw)}
    except ValueError as e:
        _err(e)


class DocRemove(TokenPayload):
    doc_id: str


@public_router.post("/documents/remove")
async def doc_remove(payload: DocRemove):
    try:
        return await wl.remove_document(await wl.by_token(payload.status_token), payload.doc_id)
    except ValueError as e:
        _err(e)


@public_router.post("/documents/submit")
async def doc_submit(payload: TokenPayload):
    try:
        return await wl.submit_documents(await wl.by_token(payload.status_token))
    except ValueError as e:
        _err(e)


class MsgPayload(TokenPayload):
    text: str = Field(min_length=1, max_length=1500)


@public_router.post("/messages")
async def send_message(payload: MsgPayload):
    try:
        res = await wl.by_token(payload.status_token)
        return {"ok": True, "message": await wl.post_message(res, payload.text)}
    except ValueError as e:
        _err(e)


@public_router.get("/invite/{token}")
async def invite_info(token: str):
    try:
        res = await wl.validate_invite(token)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"username": res["username"], "email": res["email"],
            "premium_approved": bool(res.get("premium_approved")),
            "verification_category": (res.get("verification") or {}).get("category")}


# ── Admin ───────────────────────────────────────────────────────────
@admin_router.get("/queue")
async def admin_queue(current: CurrentUser, status: Optional[str] = None,
                      type: Optional[str] = None, category: Optional[str] = None,
                      q: Optional[str] = None):
    require_support_access(current)
    query: dict = {}
    if status:
        query["status"] = status
    if type:
        query["type"] = type
    if category:
        query["verification.category"] = category
    if q:
        query["$or"] = [{"username": {"$regex": q.lower(), "$options": "i"}},
                        {"email": {"$regex": q.lower(), "$options": "i"}}]
    rows = [r async for r in db.waitlist_reservations.find(
        query, {"_id": 0, "status_token_hash": 0, "invite.token_hash": 0})
        .sort([("priority", -1), ("queue_position", 1), ("created_at", 1)]).limit(300)]
    async def _c(st):
        return await db.waitlist_reservations.count_documents({"status": st})
    totals = {
        "total": await db.waitlist_reservations.count_documents({}),
        "pending": await db.waitlist_reservations.count_documents(
            {"status": {"$in": ["waiting_review", "verification_requested", "under_review"]}}),
        "documents_requested": await _c("documents_requested"),
        "approved": await db.waitlist_reservations.count_documents(
            {"status": {"$in": ["approved", "invite_sent", "account_created"]}}),
        "denied": await _c("denied"),
        "on_hold": await _c("on_hold"),
    }
    return {"reservations": rows, "totals": totals,
            "categories": wl.VERIFICATION_CATEGORIES, "statuses": wl.STATUSES}


@admin_router.get("/reservations/{res_id}")
async def admin_detail(res_id: str, current: CurrentUser):
    require_support_access(current)
    res = await db.waitlist_reservations.find_one(
        {"id": res_id}, {"_id": 0, "status_token_hash": 0, "invite.token_hash": 0})
    if not res:
        raise HTTPException(status_code=404, detail="Reservation not found")
    audit = [a async for a in db.audit_log.find(
        {"reservation_id": res_id}, {"_id": 0}).sort("at", -1).limit(50)]
    return {"reservation": res, "audit": audit}


class ActionPayload(BaseModel):
    action: str
    reason: str = ""
    payload: dict = {}


@admin_router.post("/reservations/{res_id}/action")
async def admin_do_action(res_id: str, payload: ActionPayload, current: CurrentUser):
    require_support_access(current)
    try:
        return await wl.admin_action(res_id, current, payload.action,
                                     payload.reason, payload.payload)
    except ValueError as e:
        _err(e)


@admin_router.get("/documents/{doc_id}")
async def admin_document(doc_id: str, current: CurrentUser):
    require_support_access(current)
    f = await db.waitlist_document_files.find_one({"id": doc_id})
    if not f:
        raise HTTPException(status_code=404, detail="Document not found")
    res = await db.waitlist_reservations.find_one(
        {"id": f["reservation_id"]}, {"_id": 0, "documents": 1})
    meta = next((d for d in (res or {}).get("documents", []) if d["id"] == doc_id), {})
    from services.waitlist import _audit
    await _audit("waitlist.document_viewed", current["id"], doc_id=doc_id,
                 reservation_id=f["reservation_id"])
    return Response(content=bytes(f["data"]),
                    media_type=meta.get("mime", "application/octet-stream"),
                    headers={"Content-Disposition":
                             f'inline; filename="{meta.get("name", "document")}"'})


# ── Settings + signup mode ──────────────────────────────────────────
@admin_router.get("/settings")
async def get_settings(current: CurrentUser):
    require_support_access(current)
    return {"settings": await wl.get_settings(),
            "signup_mode": await wl.get_signup_mode(),
            "modes": wl.SIGNUP_MODES}


class DraftPayload(BaseModel):
    draft: dict


@admin_router.put("/settings/draft")
async def save_draft(payload: DraftPayload, current: CurrentUser):
    require_founder(current)
    try:
        return {"settings": await wl.save_settings_draft(current, payload.draft)}
    except ValueError as e:
        _err(e)


@admin_router.post("/settings/publish")
async def publish_settings(current: CurrentUser):
    require_founder(current)
    try:
        return {"settings": await wl.publish_settings(current)}
    except ValueError as e:
        _err(e)


@admin_router.post("/settings/reset")
async def reset_settings(current: CurrentUser):
    require_founder(current)
    return {"settings": await wl.reset_settings_draft(current)}


class ModePayload(BaseModel):
    mode: str
    reason: str = ""


@admin_router.post("/signup-mode")
async def set_mode(payload: ModePayload, current: CurrentUser):
    require_founder(current)
    try:
        return {"signup_mode": await wl.set_signup_mode(current, payload.mode, payload.reason)}
    except ValueError as e:
        _err(e)


class SchedulePayload(BaseModel):
    mode: str
    at: str
    end_at: str = ""
    end_mode: str = ""
    tz_label: str = "UTC"
    reason: str = ""


@admin_router.post("/signup-schedule")
async def set_schedule(payload: SchedulePayload, current: CurrentUser):
    require_founder(current)
    try:
        return {"schedule": await wl.set_signup_schedule(current, payload.dict())}
    except ValueError as e:
        _err(e)


@admin_router.delete("/signup-schedule")
async def cancel_schedule(current: CurrentUser):
    require_founder(current)
    await wl.cancel_signup_schedule(current)
    return {"ok": True}


@admin_router.get("/signup-mode/history")
async def mode_history(current: CurrentUser):
    require_support_access(current)
    return {"history": await wl.signup_mode_history()}
