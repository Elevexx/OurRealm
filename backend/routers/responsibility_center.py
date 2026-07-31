"""Responsibility Center endpoints (/api/responsibility-center/*) — Phase 1.

Fire Power only (never money). All balance mutations are atomic and
idempotent in services/responsibility_center.py.
"""
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from core.deps import CurrentUser
from services import responsibility_center as rc

router = APIRouter(prefix="/api/responsibility-center", tags=["responsibility-center"])


@router.get("/config")
async def rc_config(current: CurrentUser):
    settings = await rc.get_rc_settings()
    return {
        "create_cost": int(settings["create_cost"]),
        "seat_cost": int(settings["seat_cost"]),
        "seat_days": int(settings["period_days"]),
        "center_types": rc.CENTER_TYPES,
        "roles": rc.ROLES,
        "center_creation_enabled": bool(settings.get("center_creation_enabled", True)),
        "my_fire_vault_balance": await rc._wallet_balance(current["id"]),
    }


class CreateBody(BaseModel):
    name: str = Field(..., max_length=120)
    center_type: str
    description: str = Field("", max_length=1000)
    client_token: Optional[str] = None


@router.post("/create")
async def rc_create(body: CreateBody, current: CurrentUser):
    return await rc.create_center(current, body.name, body.center_type,
                                  body.description, body.client_token)


@router.get("/mine")
async def rc_mine(current: CurrentUser):
    return await rc.list_mine(current)


@router.get("/preferences")
async def rc_get_prefs(current: CurrentUser):
    from services.rc_renewals import get_rc_prefs, PREF_DEFAULTS
    return {"preferences": await get_rc_prefs(current["id"]), "defaults": PREF_DEFAULTS}


class PrefsBody(BaseModel):
    updates: dict


@router.patch("/preferences")
async def rc_patch_prefs(body: PrefsBody, current: CurrentUser):
    from services.rc_renewals import get_rc_prefs, PREF_DEFAULTS
    from core.db import db
    sets = {k: bool(v) for k, v in (body.updates or {}).items() if k in PREF_DEFAULTS}
    if sets:
        await db.rc_notification_prefs.update_one(
            {"user_id": current["id"]},
            {"$set": sets, "$setOnInsert": {"user_id": current["id"]}}, upsert=True)
    return {"ok": True, "preferences": await get_rc_prefs(current["id"])}


@router.get("/{center_id}")
async def rc_dashboard(center_id: str, current: CurrentUser):
    return await rc.center_dashboard(current, center_id)


@router.get("/{center_id}/members")
async def rc_members(center_id: str, current: CurrentUser):
    return await rc.center_members(current, center_id)


class UpdateBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


@router.patch("/{center_id}")
async def rc_update(center_id: str, body: UpdateBody, current: CurrentUser):
    return await rc.update_center(current, center_id, body.name, body.description)


class FundBody(BaseModel):
    amount: int
    idempotency_key: Optional[str] = None


@router.post("/{center_id}/vault/fund")
async def rc_fund(center_id: str, body: FundBody, current: CurrentUser):
    return await rc.fund_vault(current, center_id, body.amount, body.idempotency_key)


class InviteBody(BaseModel):
    username: str


@router.post("/{center_id}/invite")
async def rc_invite(center_id: str, body: InviteBody, current: CurrentUser):
    return await rc.invite_member(current, center_id, body.username)


class RespondBody(BaseModel):
    accept: bool


@router.post("/{center_id}/invites/respond")
async def rc_respond(center_id: str, body: RespondBody, current: CurrentUser):
    return await rc.respond_invite(current, center_id, body.accept)


class RoleBody(BaseModel):
    role: str


@router.post("/{center_id}/members/{user_id}/role")
async def rc_set_role(center_id: str, user_id: str, body: RoleBody, current: CurrentUser):
    return await rc.set_role(current, center_id, user_id, body.role)


@router.post("/{center_id}/members/{user_id}/remove")
async def rc_remove(center_id: str, user_id: str, current: CurrentUser):
    return await rc.remove_member(current, center_id, user_id)


@router.post("/{center_id}/leave")
async def rc_leave(center_id: str, current: CurrentUser):
    return await rc.leave_center(current, center_id)


@router.post("/{center_id}/members/{user_id}/reactivate")
async def rc_reactivate(center_id: str, user_id: str, current: CurrentUser):
    return await rc.reactivate_member(current, center_id, user_id)


@router.post("/{center_id}/reactivate-eligible")
async def rc_reactivate_eligible(center_id: str, current: CurrentUser):
    return await rc.reactivate_eligible(current, center_id)
