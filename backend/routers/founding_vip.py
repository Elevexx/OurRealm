"""Founding VIP Member Reward endpoints (/api/founding-vip/*)."""
from typing import Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import founding_vip as fv

router = APIRouter(prefix="/api/founding-vip", tags=["founding-vip"])


def _map_err(e: Exception) -> HTTPException:
    if isinstance(e, LookupError):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, PermissionError):
        return HTTPException(status_code=403, detail=str(e))
    if isinstance(e, ValueError):
        return HTTPException(status_code=400, detail=str(e))
    raise e


# ── User endpoints ──────────────────────────────────────────────────────
@router.get("/me")
async def my_status(current: CurrentUser):
    return await fv.status_for_user(current)


@router.post("/claim")
async def claim_reward(current: CurrentUser):
    try:
        return await fv.claim(current["id"], current)
    except (LookupError, PermissionError, ValueError) as e:
        raise _map_err(e)


@router.post("/dismiss-popup")
async def dismiss_popup(current: CurrentUser):
    await db.founding_vip_rewards.update_one(
        {"rule_id": fv.RULE_ID, "user_id": current["id"]},
        {"$set": {"popup_dismissed": True}})
    return {"ok": True}


# ── Founder admin ───────────────────────────────────────────────────────
class ReasonBody(BaseModel):
    reason: str = Field(min_length=2, max_length=500)
    expires_at: Optional[str] = None


class ConfigBody(BaseModel):
    changes: dict


class PhraseBody(BaseModel):
    confirmation_phrase: Optional[str] = None


class ResetBody(BaseModel):
    reason: str = Field(min_length=2, max_length=500)
    allow_reclaim: bool = False
    reverse_fire: bool = True


@router.get("/admin/stats")
async def admin_stats(current: CurrentUser):
    require_founder(current)
    return await fv.admin_stats()


@router.get("/admin/config")
async def admin_config(current: CurrentUser):
    require_founder(current)
    cfg = await fv.get_config()
    return {"config": {k: v for k, v in cfg.items() if k != "versions"},
            "versions": [{"index": i, "version": v.get("version"),
                          "saved_at": v.get("saved_at"), "saved_by": v.get("saved_by")}
                         for i, v in enumerate(cfg.get("versions") or [])]}


@router.patch("/admin/config/draft")
async def admin_save_draft(body: ConfigBody, current: CurrentUser):
    require_founder(current)
    return {"draft": await fv.save_draft(body.changes)}


@router.post("/admin/config/publish")
async def admin_publish(current: CurrentUser):
    require_founder(current)
    return {"config": await fv.publish_draft(current)}


@router.post("/admin/config/unpublish")
async def admin_unpublish(current: CurrentUser):
    require_founder(current)
    await db.founding_vip_config.update_one({"id": fv.RULE_ID}, {"$set": {"published": False}})
    await fv._audit(current, "config_unpublish")
    return {"ok": True, "published": False}


@router.post("/admin/config/republish")
async def admin_republish(current: CurrentUser):
    require_founder(current)
    await db.founding_vip_config.update_one({"id": fv.RULE_ID}, {"$set": {"published": True}})
    await fv._audit(current, "config_republish")
    return {"ok": True, "published": True}


@router.post("/admin/config/restore/{index}")
async def admin_restore(index: int, current: CurrentUser):
    require_founder(current)
    try:
        return {"config": await fv.restore_version(current, index)}
    except ValueError as e:
        raise _map_err(e)


@router.post("/admin/backfill/dry-run")
async def admin_dry_run(current: CurrentUser):
    require_founder(current)
    return await fv.backfill_dry_run()


@router.post("/admin/backfill/execute")
async def admin_execute(body: PhraseBody, current: CurrentUser):
    require_founder(current)
    if (body.confirmation_phrase or "").strip() != "ACTIVATE FOUNDING VIP":
        raise HTTPException(status_code=400, detail='Type "ACTIVATE FOUNDING VIP" to confirm')
    return await fv.backfill_execute(current)


@router.post("/admin/backfill/rollback")
async def admin_rollback(body: PhraseBody, current: CurrentUser):
    require_founder(current)
    if (body.confirmation_phrase or "").strip() != "ROLLBACK FOUNDING VIP":
        raise HTTPException(status_code=400, detail='Type "ROLLBACK FOUNDING VIP" to confirm')
    return await fv.backfill_rollback(current)


@router.get("/admin/users")
async def admin_users(current: CurrentUser, search: Optional[str] = None,
                      status: Optional[str] = None, limit: int = 50):
    require_founder(current)
    return {"users": await fv.admin_users(search, status, limit)}


@router.get("/admin/users/{username}")
async def admin_inspect(username: str, current: CurrentUser):
    require_founder(current)
    u = await db.users.find_one({"username": username},
                                {"_id": 0, "id": 1, "username": 1, "member_number": 1,
                                 "is_vip": 1, "founding_vip": 1, "created_at": 1})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    rec = await db.founding_vip_rewards.find_one(
        {"rule_id": fv.RULE_ID, "user_id": u["id"]}, {"_id": 0})
    return {"user": u, "reward": rec}


@router.post("/admin/users/{username}/reset-claim")
async def admin_reset_claim(username: str, body: ResetBody, current: CurrentUser):
    require_founder(current)
    try:
        return await fv.reset_claim(current, username, reason=body.reason,
                                    allow_reclaim=body.allow_reclaim,
                                    reverse_fire=body.reverse_fire)
    except (LookupError, PermissionError, ValueError) as e:
        raise _map_err(e)


@router.post("/admin/users/{username}/{action}")
async def admin_user_action(username: str, action: str, body: ReasonBody, current: CurrentUser):
    require_founder(current)
    if action == "force-claim":
        u = await db.users.find_one({"username": username}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        try:
            return await fv.claim(u["id"], current, force=True, reason=body.reason)
        except (LookupError, PermissionError, ValueError) as e:
            raise _map_err(e)
    if action not in {"exclude", "include", "revoke", "extend-expiration", "remove-expiration"}:
        raise HTTPException(status_code=400, detail="Unknown action")
    try:
        rec = await fv.admin_action(current, username, action, reason=body.reason,
                                    extra={"expires_at": body.expires_at})
        return {"ok": True, "reward": rec}
    except (LookupError, PermissionError, ValueError) as e:
        raise _map_err(e)


@router.get("/admin/export/{kind}")
async def admin_export(kind: str, current: CurrentUser):
    require_founder(current)
    if kind not in {"claimed", "unclaimed", "excluded", "all"}:
        raise HTTPException(status_code=400, detail="kind must be claimed|unclaimed|excluded|all")
    csv_text = await fv.export_csv(kind)
    return Response(content=csv_text, media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=founding_vip_{kind}.csv"})


@router.get("/admin/audit")
async def admin_audit(current: CurrentUser, limit: int = 50):
    require_founder(current)
    rows = [r async for r in db.founding_vip_audit.find({}, {"_id": 0})
            .sort("created_at", -1).limit(min(limit, 200))]
    return {"entries": rows}
