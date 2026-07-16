"""User-facing progression routes. Backend is the only source of truth —
these routes never accept progress values from the client."""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from services.progression.flags import get_flags
from services.progression.engine import maybe_recalc, recalc_user, claim_level, get_snapshot
from services.progression.events import ingest_app_event

router = APIRouter(prefix="/api/progression", tags=["progression"])

VIS_KEYS = {"current_level", "progress_card", "detailed_tasks", "history", "rewards"}
VIS_VALUES = {"public", "friends", "user_only"}
DEFAULT_VIS = {"current_level": "public", "progress_card": "public",
               "detailed_tasks": "user_only", "history": "user_only", "rewards": "public"}


def _sanitize_tasks(tasks):
    return [{k: t.get(k) for k in ("id", "name", "description", "required",
                                   "button_label", "button_destination", "sort_order",
                                   "graphic_url", "current_value", "required_value", "completed")}
            for t in tasks]


@router.get("/ladder")
async def public_ladder(current: CurrentUser):
    """Published level ladder — for next-level previews and locked badges."""
    from services.progression.engine import published_levels
    levels = await published_levels()
    return {"levels": [{k: l.get(k) for k in
                        ("id", "name", "level_number", "short_description", "graphics")}
                       for l in levels]}


@router.get("/me")
async def my_progression(current: CurrentUser):
    flags = await get_flags()
    if not flags.get("display"):
        return {"enabled": False}
    result = await maybe_recalc(current)
    ulp = await db.user_level_progress.find_one({"user_id": current["id"]}, {"_id": 0})
    completed_levels = await db.user_level_history.count_documents({"user_id": current["id"]})
    # completed task timestamps for the owner view
    stamps = {}
    if result.get("level"):
        async for tp in db.user_task_progress.find(
                {"user_id": current["id"], "level_id": result["level"]["id"],
                 "level_version": result["level"]["config_version"]},
                {"_id": 0, "task_id": 1, "completed_at": 1}):
            if tp.get("completed_at"):
                stamps[tp["task_id"]] = tp["completed_at"]
    tasks = _sanitize_tasks(result.get("tasks") or [])
    for t in tasks:
        t["completed_at"] = stamps.get(t["id"])
    return {
        "enabled": True,
        "status": result["status"],
        "level": result.get("level"),
        "summary": result.get("summary"),
        "tasks": tasks,
        "claims_enabled": bool(flags.get("claims")),
        "completed_levels": completed_levels,
        "visibility": {**DEFAULT_VIS, **((ulp or {}).get("visibility") or {})},
        "reputation_points": int((await db.users.find_one(
            {"id": current["id"]}, {"_id": 0, "reputation_points": 1}) or {}).get("reputation_points") or 0),
    }


@router.get("/summary/{username}")
async def public_summary(username: str, current: CurrentUser):
    flags = await get_flags()
    if not flags.get("display"):
        return {"enabled": False}
    user = await db.users.find_one({"username": username.lower().strip()},
                                   {"_id": 0, "password": 0})
    if not user or user.get("account_status") == "deleted_pending_restore":
        raise HTTPException(status_code=404, detail="User not found")
    ulp = await db.user_level_progress.find_one({"user_id": user["id"]}, {"_id": 0})
    vis = {**DEFAULT_VIS, **((ulp or {}).get("visibility") or {})}
    is_owner = current["id"] == user["id"]
    is_friend = current["id"] in (user.get("friends") or [])

    def allowed(key):
        v = vis.get(key, "public")
        return is_owner or v == "public" or (v == "friends" and is_friend)

    if not ulp or not allowed("current_level"):
        return {"enabled": True, "visible": False}
    snap = await get_snapshot(ulp["current_level_id"], ulp["current_level_version"])
    from services.progression.engine import live_graphics
    out = {
        "enabled": True, "visible": True,
        "level": {"id": ulp["current_level_id"], "name": (snap or {}).get("name"),
                  "level_number": ulp.get("current_level_number"),
                  "graphics": await live_graphics(ulp["current_level_id"],
                                                  (snap or {}).get("graphics"))},
        "status": ulp.get("status"),
    }
    if allowed("progress_card"):
        out["summary"] = {k: ulp.get(k) for k in
                          ("completed_task_count", "required_task_count", "progress_percentage")}
    if allowed("history"):
        out["history"] = [h async for h in db.user_level_history.find(
            {"user_id": user["id"]},
            {"_id": 0, "level_name": 1, "level_number": 1, "completed_at": 1, "graphics": 1}
        ).sort("completed_at", -1).limit(50)]
    return out


@router.get("/history/me")
async def my_history(current: CurrentUser):
    flags = await get_flags()
    if not flags.get("display"):
        return {"enabled": False, "history": []}
    history = [h async for h in db.user_level_history.find(
        {"user_id": current["id"]}, {"_id": 0}).sort("completed_at", -1).limit(100)]
    rewards = [r async for r in db.user_reward_grants.find(
        {"user_id": current["id"], "revoked": {"$ne": True}},
        {"_id": 0, "reward_snapshot": 1, "status": 1, "granted_at": 1, "source_level_id": 1}
    ).sort("granted_at", -1).limit(100)]
    return {"enabled": True, "history": history, "rewards": rewards}


@router.post("/recalc")
async def request_recalc(current: CurrentUser):
    flags = await get_flags()
    if not flags.get("display"):
        return {"enabled": False}
    result = await recalc_user(current, persist=True, source="user_request")
    return {"ok": True, "status": result["status"], "summary": result.get("summary")}


class ClaimPayload(BaseModel):
    level_id: str = Field(min_length=8, max_length=64)
    idempotency_key: Optional[str] = Field(default=None, max_length=120)


@router.post("/claim")
async def submit_claim(payload: ClaimPayload, current: CurrentUser):
    flags = await get_flags()
    if not flags.get("claims"):
        raise HTTPException(status_code=503, detail="Level claims are temporarily unavailable.")
    result = await claim_level(current, payload.level_id, payload.idempotency_key)
    if not result.get("ok"):
        raise HTTPException(status_code=result.get("code", 400), detail=result.get("error"))
    return result


@router.get("/rewards/me")
async def my_rewards(current: CurrentUser):
    grants = [r async for r in db.user_reward_grants.find(
        {"user_id": current["id"], "revoked": {"$ne": True}, "status": "granted"},
        {"_id": 0, "id": 1, "reward_snapshot": 1, "granted_at": 1, "source_level_id": 1}
    ).sort("granted_at", -1).limit(200)]
    txs = [t async for t in db.reputation_transactions.find(
        {"user_id": current["id"]}, {"_id": 0, "amount": 1, "reason": 1, "created_at": 1}
    ).sort("created_at", -1).limit(50)]
    balance = int((await db.users.find_one({"id": current["id"]},
                                           {"_id": 0, "reputation_points": 1}) or {}).get("reputation_points") or 0)
    return {"rewards": grants, "reputation": {"balance": balance, "transactions": txs}}


class VisibilityPayload(BaseModel):
    settings: dict


@router.get("/visibility")
async def get_visibility(current: CurrentUser):
    ulp = await db.user_level_progress.find_one({"user_id": current["id"]}, {"_id": 0, "visibility": 1})
    return {"visibility": {**DEFAULT_VIS, **((ulp or {}).get("visibility") or {})}}


@router.patch("/visibility")
async def set_visibility(payload: VisibilityPayload, current: CurrentUser):
    clean = {}
    for k, v in (payload.settings or {}).items():
        if k in VIS_KEYS and v in VIS_VALUES:
            clean[f"visibility.{k}"] = v
    if not clean:
        raise HTTPException(status_code=400, detail="No valid visibility settings supplied.")
    await db.user_level_progress.update_one({"user_id": current["id"]}, {"$set": clean})
    return await get_visibility(current)


class AppEventPayload(BaseModel):
    event_key: str = Field(min_length=2, max_length=60)
    object_id: Optional[str] = Field(default=None, max_length=120)


@router.post("/app-event")
async def app_event(payload: AppEventPayload, current: CurrentUser):
    result = await ingest_app_event(current, payload.event_key, payload.object_id)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result
