"""/api/account — Account closure, privacy erasure requests, data export.

All destructive actions require step-up verification: current password
re-entry + exact username confirmation. Immediate deletion additionally
requires a single-use 30-minute email confirmation link.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.security import verify_password
from core.account_lifecycle import mark_restore, pending_deletion_meta
from services import account_deletion as ads
from services import privacy_requests as prs
from services import data_export as dex
from services.mailer import email_configured

router = APIRouter(prefix="/api/account", tags=["account-privacy"])

PRESET_DAYS = {30, 60, 90, 365}


def _require_reauth(current: dict, password: str, username_confirm: str):
    uname = (current.get("username") or "").lower()
    if current.get("is_protected") or uname in {"stealth", "support"}:
        raise HTTPException(status_code=403, detail="System accounts cannot be deleted")
    if not verify_password(password or "", current.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Password is incorrect")
    if (username_confirm or "").strip().lower() != uname:
        raise HTTPException(status_code=400, detail="Username confirmation does not match")


class ClosurePayload(BaseModel):
    password:         str = Field(min_length=1, max_length=200)
    username_confirm: str = Field(min_length=1, max_length=64)
    recovery_days:    int = Field(ge=1, le=365)
    reason:           Optional[str] = Field(default=None, max_length=400)


@router.post("/closure")
async def request_closure(payload: ClosurePayload, current: CurrentUser):
    """Recoverable account closure (1-365 days). Public access removed
    immediately; user can restore by signing back in within the window."""
    _require_reauth(current, payload.password, payload.username_confirm)
    if current.get("account_status") == "deleted_pending_restore":
        raise HTTPException(status_code=409, detail="Account is already closed")
    result = await ads.request_recoverable_closure(
        current, payload.recovery_days, reason=payload.reason)
    return {"ok": True, **result}


class ImmediatePayload(BaseModel):
    password:         str = Field(min_length=1, max_length=200)
    username_confirm: str = Field(min_length=1, max_length=64)


@router.post("/deletion/immediate/request")
async def request_immediate(payload: ImmediatePayload, current: CurrentUser):
    """Step 1 — reauth + mint the 30-minute single-use confirmation link."""
    _require_reauth(current, payload.password, payload.username_confirm)
    result = await ads.create_immediate_confirmation(current)
    return {"ok": True, **result,
            "delivery": "email" if result["email_sent"] else "in_app_notification"}


class ConfirmPayload(BaseModel):
    token: str = Field(min_length=10, max_length=200)


@router.post("/deletion/immediate/confirm")
async def confirm_immediate(payload: ConfirmPayload, current: CurrentUser,
                            response: Response):
    """Step 2 — consumes the token, removes public access synchronously
    and starts the permanent erasure job. Cannot be undone."""
    uname = (current.get("username") or "").lower()
    if current.get("is_protected") or uname in {"stealth", "support"}:
        raise HTTPException(status_code=403, detail="System accounts cannot be deleted")
    try:
        result = await ads.confirm_immediate_deletion(current, payload.token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True, **result}


class PrivacyRequestPayload(BaseModel):
    password:     str = Field(min_length=1, max_length=200)
    details:      Optional[str] = Field(default=None, max_length=2000)
    jurisdiction: str = Field(default="other", max_length=20)
    hide_account: bool = False


@router.post("/privacy-request")
async def create_privacy_request(payload: PrivacyRequestPayload, current: CurrentUser):
    """Formal erasure request. Does NOT hide the account unless the
    requester selects hide_account. Admin review is required."""
    uname = (current.get("username") or "").lower()
    if current.get("is_protected") or uname in {"stealth", "support"}:
        raise HTTPException(status_code=403, detail="System accounts cannot request erasure")
    if not verify_password(payload.password, current.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Password is incorrect")
    try:
        req = await prs.create_request(
            current, details=payload.details or "",
            jurisdiction=payload.jurisdiction,
            hide_account=payload.hide_account)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"ok": True, "request": prs.decorate(req)}


@router.get("/privacy-requests")
async def my_privacy_requests(current: CurrentUser):
    rows = [prs.decorate(r) async for r in db.privacy_erasure_requests.find(
        {"user_id": current["id"]}, {"_id": 0}).sort("created_at", -1).limit(20)]
    return {"requests": rows, "jurisdictions": [
        {"key": k, "label": v["label"]} for k, v in prs.JURISDICTIONS.items()]}


@router.post("/privacy-requests/{request_id}/withdraw")
async def withdraw_privacy_request(request_id: str, current: CurrentUser):
    try:
        return await prs.withdraw(request_id, current)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/restore")
async def restore_account(current: CurrentUser):
    """Verified-user restoration from recoverable closure. Never runs
    automatically — only on this explicit authenticated request."""
    if current.get("account_status") != "deleted_pending_restore":
        raise HTTPException(status_code=400, detail="Account is not in a recoverable closed state")
    refreshed = await mark_restore(current, actor=current)
    return {"ok": True, "status": refreshed.get("account_status")}


@router.get("/deletion-overview")
async def deletion_overview(current: CurrentUser):
    open_req = await db.privacy_erasure_requests.find_one(
        {"user_id": current["id"], "status": {"$in": prs.OPEN_STATUSES + ["approved"]}},
        {"_id": 0})
    exports = [e async for e in db.data_export_jobs.find(
        {"user_id": current["id"]},
        {"_id": 0, "token_hash": 0}).sort("created_at", -1).limit(5)]
    return {
        "pending_closure": pending_deletion_meta(current),
        "open_privacy_request": prs.decorate(open_req) if open_req else None,
        "exports": exports,
        "email_delivery_configured": email_configured(),
    }


# ── Privacy Center — one aggregate endpoint for the whole dashboard.
@router.get("/privacy-center")
async def privacy_center(current: CurrentUser):
    uid = current["id"]
    open_req = await db.privacy_erasure_requests.find_one(
        {"user_id": uid, "status": {"$in": prs.OPEN_STATUSES + ["approved"]}}, {"_id": 0})
    exports = [e async for e in db.data_export_jobs.find(
        {"user_id": uid}, {"_id": 0, "token_hash": 0}).sort("created_at", -1).limit(5)]
    login_rows = [r async for r in db.login_history.find(
        {"user_id": uid}, {"_id": 0}).sort("at", -1).limit(10)]
    devices = await db.login_history.distinct("user_agent", {"user_id": uid})
    closure = pending_deletion_meta(current)
    if closure:
        closure["reason"] = current.get("deletion_reason")
        closure["recovery_days"] = current.get("closure_recovery_days")
    fire = None
    try:
        from services import fire_vault as fv
        w = await fv.wallet_for(current)
        fire = {"vault_balance": w.get("vault_balance"),
                "lifetime_fire_received": w.get("lifetime_fire_received")}
    except Exception:  # noqa: BLE001
        pass
    from services.data_export import data_map, DATA_CATEGORIES
    return {
        "data_map": await data_map(current),
        "categories": [{"key": k, "label": l} for k, l in DATA_CATEGORIES],
        "pending_closure": closure,
        "open_privacy_request": prs.decorate(open_req) if open_req else None,
        "exports": exports,
        "connected_accounts": {
            "google": bool(current.get("google_auth")),
            "email": bool(current.get("email")),
        },
        "third_party_processors": [
            {"name": "Supabase (messenger delivery)", "purpose": "real-time message transport"},
            {"name": "Cloudflare R2 (media mirror)", "purpose": "media storage/CDN"},
        ],
        "security": {
            "password_changed_at": current.get("password_changed_at"),
            "sessions_valid_since": current.get("password_changed_at"),
        },
        "login_history": login_rows,
        "devices": [d for d in devices if d][:8],
        "fire": fire,
        "email_delivery_configured": email_configured(),
    }


class ExtendClosurePayload(BaseModel):
    additional_days: int = Field(ge=1, le=365)


@router.post("/closure/extend")
async def extend_closure(payload: ExtendClosurePayload, current: CurrentUser):
    """Extend the recovery window of a pending closure. Total window is
    capped at 365 days from the original closure date."""
    from datetime import datetime, timedelta
    if current.get("account_status") != "deleted_pending_restore" or not current.get("purge_after"):
        raise HTTPException(status_code=400, detail="Account is not in a recoverable closed state")
    deleted_at = datetime.fromisoformat(current["deleted_at"])
    cur = datetime.fromisoformat(current["purge_after"])
    cap = deleted_at + timedelta(days=365)
    new_purge = min(cur + timedelta(days=payload.additional_days), cap)
    if new_purge <= cur:
        raise HTTPException(status_code=400, detail="Recovery window is already at the 365-day maximum")
    await db.users.update_one({"id": current["id"]}, {"$set": {
        "purge_after": new_purge.isoformat(), "closure_expiry_warned": False}})
    return {"ok": True, "purge_after": new_purge.isoformat()}


class LogoutAllPayload(BaseModel):
    password: str = Field(min_length=1, max_length=200)


@router.post("/security/logout-everywhere")
async def logout_everywhere(payload: LogoutAllPayload, current: CurrentUser):
    """Revoke EVERY session (including this one) — reuses the same
    revocation mechanics as account closure, without hiding the account."""
    if not verify_password(payload.password, current.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Password is incorrect")
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": current["id"]},
                              {"$set": {"password_changed_at": now}})
    await db.refresh_tokens.delete_many({"user_id": current["id"]})
    await db.user_sessions.delete_many({"user_id": current["id"]})
    return {"ok": True, "note": "All sessions revoked — sign in again."}


# ── Download My Data ────────────────────────────────────────────────
class ExportPayload(BaseModel):
    categories: Optional[list[str]] = None


@router.post("/export")
async def create_data_export(current: CurrentUser, payload: Optional[ExportPayload] = None):
    cats = (payload.categories if payload else None) or None
    if cats:
        from services.data_export import DATA_CATEGORIES
        valid = {k for k, _ in DATA_CATEGORIES}
        cats = [c for c in cats if c in valid]
        if not cats:
            raise HTTPException(status_code=400, detail="No valid categories selected")
    result = await dex.create_export(current, cats)
    return {"ok": True, "export": result}


@router.get("/export/{export_id}/download")
async def download_export(export_id: str, token: str, current: CurrentUser):
    try:
        raw = await dex.fetch_export(current, export_id, token)
    except ValueError as e:
        raise HTTPException(status_code=410, detail=str(e))
    return Response(content=raw, media_type="application/json", headers={
        "Content-Disposition": f'attachment; filename="ourrealm-data-{export_id[:8]}.json"'})
