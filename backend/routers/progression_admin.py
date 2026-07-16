"""Founder-only Level Builder + progression admin API. Every mutation is
backend-authorized (require_founder) and audited."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from core.analytics_filters import real_member_filter
from services.progression.flags import get_flags, set_flag, FLAG_KEYS
from services.progression.registry import list_task_types, get_task_type, ALLOWED_APP_EVENT_KEYS
from services.progression.seed import (publish_level, ensure_progression_seed,
                                       seed_launch_ladder, ensure_progression_indexes,
                                       LAUNCH_LEVEL_NAMES)
from services.progression.engine import recalc_user, get_snapshot, published_levels
from services.progression.rewards import retry_grant, revoke_grant, REWARD_TYPES
from services.progression import backfill

router = APIRouter(prefix="/api/admin/progression", tags=["progression-admin"])

FUNCTIONAL_FIELDS = {"claim_mode", "repeatable", "mode_availability", "eligibility_rules",
                     "active_from", "expires_at", "is_starting_level"}
FUNCTIONAL_SETTINGS = {"required_task_count"}
FUNCTIONAL_TASK_FIELDS = {"task_type_key", "required", "target_value", "config",
                          "count_historical", "status"}


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _audit(founder, action, target_type, target_id, before=None, after=None, extra=None):
    await db.progression_audit_logs.insert_one({
        "id": uuid.uuid4().hex, "founder_id": founder["id"],
        "founder_username": founder.get("username"),
        "action": action, "target_type": target_type, "target_id": target_id,
        "before": before, "after": after, "extra": extra or {},
        "created_at": _now(), "result": "ok",
    })


# ── Flags ──────────────────────────────────────────────────────────────
@router.get("/flags")
async def flags_get(current: CurrentUser):
    require_founder(current)
    return {"flags": await get_flags(), "keys": FLAG_KEYS}


class FlagPayload(BaseModel):
    key: str
    value: bool


@router.patch("/flags")
async def flags_set(payload: FlagPayload, current: CurrentUser):
    require_founder(current)
    if payload.key not in FLAG_KEYS:
        raise HTTPException(status_code=400, detail="Unknown flag")
    if payload.key in ("claims", "rewards") and payload.value:
        done = await db.progression_recalculation_jobs.find_one(
            {"dry_run": False, "type": "backfill", "status": "completed"}, {"_id": 0, "id": 1})
        if not done:
            raise HTTPException(status_code=400,
                                detail="Claims/rewards can only be enabled after a successful full backfill. "
                                       "Complete Steps 4-5 of the Activation checklist first.")
    before = await get_flags()
    flags = await set_flag(payload.key, payload.value, current.get("username") or current["id"])
    await _audit(current, "flag_change", "flag", payload.key,
                 before={payload.key: before.get(payload.key)}, after={payload.key: payload.value})
    return {"flags": flags}


# ── Task types ─────────────────────────────────────────────────────────
@router.get("/task-types")
async def task_types(current: CurrentUser):
    require_founder(current)
    return {"task_types": list_task_types(), "reward_types": sorted(REWARD_TYPES),
            "allowed_event_keys": sorted(ALLOWED_APP_EVENT_KEYS)}


# ── Levels ─────────────────────────────────────────────────────────────
@router.get("/levels")
async def levels_list(current: CurrentUser):
    require_founder(current)
    levels = [l async for l in db.progression_levels.find({}, {"_id": 0})]
    levels.sort(key=lambda l: (l.get("display_order") or 0, l.get("level_number") or 0))
    for l in levels:
        l["task_count"] = await db.progression_tasks.count_documents(
            {"level_id": l["id"], "status": {"$ne": "archived"}})
        l["users_on_level"] = await db.user_level_progress.count_documents(
            {"current_level_id": l["id"]})
    return {"levels": levels}


class LevelPayload(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)
    internal_name: Optional[str] = Field(default=None, max_length=80)
    level_number: Optional[int] = None
    display_order: Optional[int] = None
    short_description: Optional[str] = Field(default=None, max_length=300)
    long_description: Optional[str] = Field(default=None, max_length=3000)
    is_starting_level: Optional[bool] = None
    claim_mode: Optional[str] = None            # manual | auto
    repeatable: Optional[bool] = None
    mode_availability: Optional[list] = None
    eligibility_rules: Optional[dict] = None
    active_from: Optional[str] = None
    expires_at: Optional[str] = None
    graphics: Optional[dict] = None
    progress_settings: Optional[dict] = None
    rewards: Optional[list] = None


def _validate_rewards(rewards):
    for r in rewards or []:
        if r.get("type") not in REWARD_TYPES:
            raise HTTPException(status_code=400, detail=f"Unknown reward type: {r.get('type')}")
        r.setdefault("id", uuid.uuid4().hex)
        r.setdefault("version", 1)


@router.post("/levels")
async def level_create(payload: LevelPayload, current: CurrentUser):
    require_founder(current)
    _validate_rewards(payload.rewards)
    level = {
        "id": uuid.uuid4().hex, "name": payload.name or "New Level",
        "internal_name": payload.internal_name,
        "level_number": payload.level_number or 0,
        "display_order": payload.display_order if payload.display_order is not None else 999,
        "short_description": payload.short_description or "",
        "long_description": payload.long_description or "",
        "is_starting_level": bool(payload.is_starting_level),
        "claim_mode": payload.claim_mode if payload.claim_mode in ("manual", "auto") else "manual",
        "repeatable": bool(payload.repeatable), "mode_availability": payload.mode_availability or [],
        "eligibility_rules": payload.eligibility_rules or {},
        "active_from": payload.active_from, "expires_at": payload.expires_at,
        "graphics": payload.graphics or {}, "progress_settings": payload.progress_settings or {},
        "rewards": payload.rewards or [], "status": "draft", "config_version": 0,
        "created_by": current["id"], "created_at": _now(),
        "updated_by": current["id"], "updated_at": _now(),
        "published_by": None, "published_at": None,
    }
    await db.progression_levels.insert_one({**level})
    await _audit(current, "level_create", "level", level["id"], after={"name": level["name"]})
    return {"ok": True, "level": level}


@router.patch("/levels/{level_id}")
async def level_update(level_id: str, payload: LevelPayload, current: CurrentUser):
    require_founder(current)
    level = await db.progression_levels.find_one({"id": level_id}, {"_id": 0})
    if not level:
        raise HTTPException(status_code=404, detail="Level not found")
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if "rewards" in updates:
        _validate_rewards(updates["rewards"])
    if "claim_mode" in updates and updates["claim_mode"] not in ("manual", "auto"):
        raise HTTPException(status_code=400, detail="claim_mode must be manual or auto")
    updates.update(updated_by=current["id"], updated_at=_now())
    await db.progression_levels.update_one({"id": level_id}, {"$set": updates})
    functional = bool(FUNCTIONAL_FIELDS & set(updates)) or \
        bool(FUNCTIONAL_SETTINGS & set((updates.get("progress_settings") or {}).keys())) or \
        "rewards" in updates
    await _audit(current, "level_update", "level", level_id,
                 before={k: level.get(k) for k in updates}, after=updates,
                 extra={"functional_change": functional,
                        "note": "Draft edit — users unaffected until publish" if level["status"] == "draft"
                        else ("FUNCTIONAL change pending publish" if functional else "cosmetic edit")})
    fresh = await db.progression_levels.find_one({"id": level_id}, {"_id": 0})
    return {"ok": True, "level": fresh, "functional_change": functional}


@router.post("/levels/{level_id}/publish")
async def level_publish(level_id: str, current: CurrentUser, confirm: bool = False):
    require_founder(current)
    level = await db.progression_levels.find_one({"id": level_id}, {"_id": 0})
    if not level:
        raise HTTPException(status_code=404, detail="Level not found")
    task_count = await db.progression_tasks.count_documents(
        {"level_id": level_id, "status": {"$nin": ["archived", "retired"]}})
    if task_count == 0:
        raise HTTPException(status_code=400, detail="Add at least one task before publishing.")
    affected = await db.user_level_progress.count_documents({"current_level_id": level_id})
    # Functional-change guard: republish over active users needs a Dry-Run
    # style confirmation.
    if level.get("config_version", 0) > 0 and affected > 0 and not confirm:
        old_snap = await get_snapshot(level_id, level["config_version"])
        return {
            "ok": False, "requires_confirmation": True,
            "affected_users": affected,
            "current_version": level["config_version"],
            "new_version": level["config_version"] + 1,
            "message": f"{affected} user(s) are currently on this level. Publishing creates "
                       f"version {level['config_version'] + 1}; their progress will be migrated "
                       "and recalculated on next read. Confirm to proceed.",
            "previous_task_count": len((old_snap or {}).get("tasks") or []),
            "new_task_count": task_count,
        }
    snap = await publish_level(level_id, current.get("username") or current["id"])
    if affected:
        # Migrate active users to the new version; progress recalculates
        # (completed history is never rewritten).
        await db.user_level_progress.update_many(
            {"current_level_id": level_id},
            {"$set": {"current_level_version": snap["config_version"],
                      "last_calculated_at": None, "calculation_source": "version_migration"}})
    await _audit(current, "level_publish", "level", level_id,
                 after={"version": snap["config_version"]},
                 extra={"migrated_users": affected})
    return {"ok": True, "version": snap["config_version"], "migrated_users": affected}


@router.post("/levels/{level_id}/pause")
async def level_pause(level_id: str, current: CurrentUser):
    require_founder(current)
    res = await db.progression_levels.update_one(
        {"id": level_id, "status": "published"}, {"$set": {"status": "paused", "updated_at": _now()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=409, detail="Only published levels can be paused.")
    await _audit(current, "level_pause", "level", level_id)
    return {"ok": True}


@router.post("/levels/{level_id}/unpause")
async def level_unpause(level_id: str, current: CurrentUser):
    require_founder(current)
    res = await db.progression_levels.update_one(
        {"id": level_id, "status": "paused"}, {"$set": {"status": "published", "updated_at": _now()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=409, detail="Level is not paused.")
    await _audit(current, "level_unpause", "level", level_id)
    return {"ok": True}


@router.post("/levels/{level_id}/archive")
async def level_archive(level_id: str, current: CurrentUser):
    require_founder(current)
    level = await db.progression_levels.find_one({"id": level_id}, {"_id": 0})
    if not level:
        raise HTTPException(status_code=404, detail="Level not found")
    await db.progression_levels.update_one({"id": level_id},
                                           {"$set": {"status": "archived", "updated_at": _now()}})
    await _audit(current, "level_archive", "level", level_id, before={"status": level["status"]})
    return {"ok": True}


@router.delete("/levels/{level_id}")
async def level_delete(level_id: str, current: CurrentUser):
    """Hard delete allowed ONLY for never-published, unreferenced drafts."""
    require_founder(current)
    level = await db.progression_levels.find_one({"id": level_id}, {"_id": 0})
    if not level:
        raise HTTPException(status_code=404, detail="Level not found")
    referenced = (
        level.get("config_version", 0) > 0
        or await db.user_level_progress.count_documents({"current_level_id": level_id}) > 0
        or await db.user_level_history.count_documents({"level_id": level_id}) > 0
        or await db.progression_claims.count_documents({"level_id": level_id}) > 0
    )
    if level["status"] != "draft" or referenced:
        raise HTTPException(status_code=409,
                            detail="Only never-published, unreferenced draft levels can be deleted. Archive instead.")
    await db.progression_levels.delete_one({"id": level_id})
    await db.progression_tasks.delete_many({"level_id": level_id})
    await _audit(current, "level_delete_draft", "level", level_id, before={"name": level["name"]})
    return {"ok": True}


@router.post("/levels/{level_id}/duplicate")
async def level_duplicate(level_id: str, current: CurrentUser):
    require_founder(current)
    level = await db.progression_levels.find_one({"id": level_id}, {"_id": 0})
    if not level:
        raise HTTPException(status_code=404, detail="Level not found")
    new_id = uuid.uuid4().hex
    copy = {**level, "id": new_id, "name": f"{level['name']} (copy)", "status": "draft",
            "config_version": 0, "is_starting_level": False,
            "created_by": current["id"], "created_at": _now(),
            "updated_by": current["id"], "updated_at": _now(),
            "published_by": None, "published_at": None,
            "rewards": [{**r, "id": uuid.uuid4().hex} for r in (level.get("rewards") or [])]}
    await db.progression_levels.insert_one({**copy})
    async for t in db.progression_tasks.find({"level_id": level_id, "status": {"$ne": "archived"}}, {"_id": 0}):
        await db.progression_tasks.insert_one({**t, "id": uuid.uuid4().hex, "level_id": new_id,
                                               "created_at": _now(), "updated_at": _now()})
    await _audit(current, "level_duplicate", "level", new_id, extra={"source": level_id})
    return {"ok": True, "level": copy}


class ReorderPayload(BaseModel):
    ordered_ids: list[str]


@router.post("/levels/reorder")
async def levels_reorder(payload: ReorderPayload, current: CurrentUser):
    require_founder(current)
    for i, lid in enumerate(payload.ordered_ids):
        await db.progression_levels.update_one({"id": lid}, {"$set": {"display_order": (i + 1) * 10,
                                                                      "updated_at": _now()}})
    await _audit(current, "levels_reorder", "level", "all", after={"order": payload.ordered_ids})
    return {"ok": True}


# ── Tasks ─────────────────────────────────────────────────────────────
@router.get("/levels/{level_id}/tasks")
async def tasks_list(level_id: str, current: CurrentUser):
    require_founder(current)
    tasks = [t async for t in db.progression_tasks.find({"level_id": level_id}, {"_id": 0})]
    tasks.sort(key=lambda t: t.get("sort_order") or 0)
    return {"tasks": tasks}


class TaskPayload(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    task_type_key: Optional[str] = None
    required: Optional[bool] = None
    target_value: Optional[int] = Field(default=None, ge=1, le=100000)
    config: Optional[dict] = None
    button_label: Optional[str] = Field(default=None, max_length=60)
    button_destination: Optional[str] = Field(default=None, max_length=200)
    count_historical: Optional[bool] = None
    sort_order: Optional[int] = None
    graphic_url: Optional[str] = None
    status: Optional[str] = None


def _validate_task_config(task_type_key: str, config: dict):
    tt = get_task_type(task_type_key)
    if not tt:
        raise HTTPException(status_code=400, detail=f"Unknown task type: {task_type_key}")
    cfg = config or {}
    for banned in ("$where", "query", "url", "script", "code", "eval"):
        if banned in cfg:
            raise HTTPException(status_code=400, detail=f"Config key '{banned}' is not allowed.")
    if tt["strategy"] == "app_event_count":
        key = cfg.get("event_key") or tt["default_config"].get("event_key")
        if key and key not in ALLOWED_APP_EVENT_KEYS:
            raise HTTPException(status_code=400, detail=f"Event key '{key}' is not allowlisted.")
        op = cfg.get("operator")
        if op and op not in (">=", ">", "==", "<=", "<"):
            raise HTTPException(status_code=400, detail=f"Operator '{op}' is not allowed.")
    if cfg.get("button_destination") or cfg.get("destination"):
        dest = cfg.get("button_destination") or cfg.get("destination")
        if not str(dest).startswith("/"):
            raise HTTPException(status_code=400, detail="Destinations must be internal routes starting with /.")


@router.post("/levels/{level_id}/tasks")
async def task_create(level_id: str, payload: TaskPayload, current: CurrentUser):
    require_founder(current)
    if not await db.progression_levels.find_one({"id": level_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Level not found")
    key = payload.task_type_key or "manual_approval"
    _validate_task_config(key, payload.config or {})
    tt = get_task_type(key)
    if payload.button_destination and not payload.button_destination.startswith("/"):
        raise HTTPException(status_code=400, detail="Destination must be an internal route.")
    task = {
        "id": uuid.uuid4().hex, "level_id": level_id,
        "name": payload.name or tt["name"], "description": payload.description or "",
        "task_type_key": key, "category": tt["category"],
        "required": payload.required if payload.required is not None else True,
        "target_value": payload.target_value or 1, "config": payload.config or {},
        "button_label": payload.button_label or tt["default_button_label"],
        "button_destination": payload.button_destination or tt["default_destination"],
        "count_historical": payload.count_historical if payload.count_historical is not None else True,
        "sort_order": payload.sort_order if payload.sort_order is not None else 999,
        "graphic_url": payload.graphic_url, "status": "active", "version": 1,
        "created_at": _now(), "updated_at": _now(),
    }
    await db.progression_tasks.insert_one({**task})
    await _audit(current, "task_create", "task", task["id"],
                 after={"name": task["name"], "level_id": level_id})
    return {"ok": True, "task": task}


@router.patch("/tasks/{task_id}")
async def task_update(task_id: str, payload: TaskPayload, current: CurrentUser):
    require_founder(current)
    task = await db.progression_tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    updates = payload.model_dump(exclude_unset=True)
    key = updates.get("task_type_key") or task["task_type_key"]
    _validate_task_config(key, updates.get("config") or task.get("config") or {})
    if updates.get("button_destination") and not updates["button_destination"].startswith("/"):
        raise HTTPException(status_code=400, detail="Destination must be an internal route.")
    if updates.get("status") and updates["status"] not in ("active", "paused", "retired", "archived"):
        raise HTTPException(status_code=400, detail="Invalid task status")
    functional = bool(FUNCTIONAL_TASK_FIELDS & set(updates))
    if functional:
        updates["version"] = int(task.get("version") or 1) + 1
    updates["updated_at"] = _now()
    await db.progression_tasks.update_one({"id": task_id}, {"$set": updates})
    await _audit(current, "task_update", "task", task_id,
                 before={k: task.get(k) for k in updates}, after=updates,
                 extra={"functional_change": functional})
    fresh = await db.progression_tasks.find_one({"id": task_id}, {"_id": 0})
    return {"ok": True, "task": fresh, "functional_change": functional}


@router.delete("/tasks/{task_id}")
async def task_delete(task_id: str, current: CurrentUser):
    require_founder(current)
    task = await db.progression_tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    referenced = await db.user_task_progress.count_documents({"task_id": task_id}) > 0
    level = await db.progression_levels.find_one({"id": task["level_id"]}, {"_id": 0, "config_version": 1})
    published = (level or {}).get("config_version", 0) > 0
    if referenced or published:
        await db.progression_tasks.update_one({"id": task_id},
                                              {"$set": {"status": "retired", "updated_at": _now()}})
        await _audit(current, "task_retire", "task", task_id)
        return {"ok": True, "retired": True,
                "note": "Task is referenced or published — retired instead of deleted."}
    await db.progression_tasks.delete_one({"id": task_id})
    await _audit(current, "task_delete_draft", "task", task_id, before={"name": task["name"]})
    return {"ok": True, "deleted": True}


@router.post("/tasks/{task_id}/duplicate")
async def task_duplicate(task_id: str, current: CurrentUser):
    require_founder(current)
    task = await db.progression_tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    copy = {**task, "id": uuid.uuid4().hex, "name": f"{task['name']} (copy)",
            "created_at": _now(), "updated_at": _now(), "version": 1}
    await db.progression_tasks.insert_one({**copy})
    await _audit(current, "task_duplicate", "task", copy["id"], extra={"source": task_id})
    return {"ok": True, "task": copy}


@router.post("/levels/{level_id}/tasks/reorder")
async def tasks_reorder(level_id: str, payload: ReorderPayload, current: CurrentUser):
    require_founder(current)
    for i, tid in enumerate(payload.ordered_ids):
        await db.progression_tasks.update_one({"id": tid, "level_id": level_id},
                                              {"$set": {"sort_order": (i + 1) * 10}})
    await _audit(current, "tasks_reorder", "level", level_id, after={"order": payload.ordered_ids})
    return {"ok": True}


# ── Preview / inspect ──────────────────────────────────────────────────
@router.get("/inspect/{username}")
async def inspect_user(username: str, current: CurrentUser):
    require_founder(current)
    user = await db.users.find_one({"username": username.lower().strip()},
                                   {"_id": 0, "password": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    result = await recalc_user(user, persist=False, source="founder_inspect")
    ulp = await db.user_level_progress.find_one({"user_id": user["id"]}, {"_id": 0})
    history = [h async for h in db.user_level_history.find(
        {"user_id": user["id"]}, {"_id": 0}).sort("completed_at", -1).limit(50)]
    claims = [c async for c in db.progression_claims.find(
        {"user_id": user["id"]}, {"_id": 0}).sort("claimed_at", -1).limit(50)]
    grants = [g async for g in db.user_reward_grants.find(
        {"user_id": user["id"]}, {"_id": 0}).sort("granted_at", -1).limit(50)]
    tasks_detail = []
    if result.get("level"):
        async for tp in db.user_task_progress.find(
                {"user_id": user["id"], "level_id": result["level"]["id"]}, {"_id": 0}):
            tasks_detail.append(tp)
    return {"user": {"id": user["id"], "username": user.get("username")},
            "live": result, "stored": ulp, "history": history,
            "claims": claims, "rewards": grants, "task_records": tasks_detail}


# ── Jobs: Dry Run / backfill / recalc ─────────────────────────────────
class JobPayload(BaseModel):
    dry_run: bool = True
    usernames: Optional[list[str]] = None
    confirmation_phrase: Optional[str] = None


@router.post("/jobs/start")
async def job_start(payload: JobPayload, current: CurrentUser):
    require_founder(current)
    user_ids = None
    if payload.usernames:
        user_ids = [u["id"] async for u in db.users.find(
            {"username": {"$in": [x.lower().strip() for x in payload.usernames]}}, {"_id": 0, "id": 1})]
        if not user_ids:
            raise HTTPException(status_code=404, detail="No matching users")
    if not payload.dry_run and not user_ids:
        if (payload.confirmation_phrase or "").strip().upper() != "RECALCULATE ALL":
            raise HTTPException(status_code=400,
                                detail='All-user production recalculation requires confirmation_phrase "RECALCULATE ALL".')
    result = await backfill.start_job("backfill" if not user_ids else "recalc_selected",
                                      payload.dry_run, current.get("username") or current["id"],
                                      user_ids)
    if not result.get("ok"):
        raise HTTPException(status_code=result.get("code", 400), detail=result.get("error"))
    await _audit(current, "job_start", "job", result["job"]["id"],
                 extra={"dry_run": payload.dry_run, "targeted": bool(user_ids)})
    return result


@router.get("/jobs")
async def jobs_list(current: CurrentUser, limit: int = 10):
    require_founder(current)
    jobs = [j async for j in db.progression_recalculation_jobs.find({}, {"_id": 0})
            .sort("started_at", -1).limit(min(limit, 50))]
    return {"jobs": jobs}


@router.get("/jobs/{job_id}")
async def job_get(job_id: str, current: CurrentUser):
    require_founder(current)
    job = await db.progression_recalculation_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job": job}


@router.post("/jobs/{job_id}/cancel")
async def job_cancel(job_id: str, current: CurrentUser):
    require_founder(current)
    await backfill.cancel_job(job_id)
    await _audit(current, "job_cancel", "job", job_id)
    return {"ok": True}


@router.post("/jobs/{job_id}/resume")
async def job_resume(job_id: str, current: CurrentUser):
    require_founder(current)
    result = await backfill.resume_job(job_id)
    if not result.get("ok"):
        raise HTTPException(status_code=result.get("code", 400), detail=result.get("error"))
    await _audit(current, "job_resume", "job", job_id)
    return result


# ── Rewards admin ─────────────────────────────────────────────────────
@router.get("/rewards/failed")
async def failed_rewards(current: CurrentUser):
    require_founder(current)
    grants = [g async for g in db.user_reward_grants.find(
        {"$or": [{"status": "failed"}, {"repair_status": "pending"}]}, {"_id": 0}).limit(100)]
    return {"grants": grants}


@router.post("/rewards/{grant_id}/retry")
async def reward_retry(grant_id: str, current: CurrentUser):
    require_founder(current)
    result = await retry_grant(grant_id)
    await _audit(current, "reward_retry", "reward_grant", grant_id, extra=result)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


class RevokePayload(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    confirm: bool = False


@router.post("/rewards/{grant_id}/revoke")
async def reward_revoke(grant_id: str, payload: RevokePayload, current: CurrentUser):
    require_founder(current)
    grant = await db.user_reward_grants.find_one({"id": grant_id}, {"_id": 0})
    if not grant:
        raise HTTPException(status_code=404, detail="Grant not found")
    if not payload.confirm:
        return {"ok": False, "requires_confirmation": True,
                "preview": {"user_id": grant["user_id"],
                            "reward": grant.get("reward_snapshot"),
                            "granted_at": grant.get("granted_at")}}
    result = await revoke_grant(grant_id, payload.reason, current.get("username") or current["id"])
    await _audit(current, "reward_revoke", "reward_grant", grant_id,
                 extra={"reason": payload.reason, **result})
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


# ── Manual approvals ──────────────────────────────────────────────────
@router.get("/manual-approvals")
async def approvals_list(current: CurrentUser, status: str = "pending"):
    require_founder(current)
    items = [a async for a in db.progression_manual_approvals.find(
        {"status": status}, {"_id": 0}).sort("requested_at", -1).limit(100)]
    return {"approvals": items}


class ApprovalDecision(BaseModel):
    user_username: str
    task_id: str
    approve: bool
    reason: Optional[str] = Field(default=None, max_length=300)


@router.post("/manual-approvals/decide")
async def approval_decide(payload: ApprovalDecision, current: CurrentUser):
    require_founder(current)
    user = await db.users.find_one({"username": payload.user_username.lower().strip()},
                                   {"_id": 0, "id": 1, "username": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    status = "approved" if payload.approve else "rejected"
    await db.progression_manual_approvals.update_one(
        {"user_id": user["id"], "task_id": payload.task_id},
        {"$set": {"status": status, "decided_by": current.get("username"),
                  "decided_at": _now(), "reason": payload.reason},
         "$setOnInsert": {"id": uuid.uuid4().hex, "user_id": user["id"],
                          "task_id": payload.task_id, "requested_at": _now()}},
        upsert=True)
    await _audit(current, f"manual_{status}", "manual_approval",
                 f"{user['id']}:{payload.task_id}", extra={"reason": payload.reason})
    full_user = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password": 0})
    await recalc_user(full_user, persist=True, source="manual_approval")
    return {"ok": True, "status": status}


# ── Analytics ─────────────────────────────────────────────────────────
@router.get("/analytics")
async def analytics(current: CurrentUser):
    require_founder(current)
    real_ids = None  # ULP rows exist only for engine-touched users; filter joins below
    levels = await published_levels()
    by_level = []
    for l in levels:
        on_level = await db.user_level_progress.count_documents({"current_level_id": l["id"]})
        claim_ready = await db.user_level_progress.count_documents(
            {"current_level_id": l["id"], "claim_available": True})
        completed = await db.user_level_history.count_documents({"level_id": l["id"]})
        task_stats = []
        snap = await get_snapshot(l["id"], l["config_version"])
        for t in (snap or {}).get("tasks") or []:
            done = await db.user_task_progress.count_documents(
                {"level_id": l["id"], "task_id": t["id"], "completed": True})
            task_stats.append({"task_id": t["id"], "name": t["name"], "completed_users": done})
        by_level.append({"level_id": l["id"], "name": l["name"],
                         "level_number": l.get("level_number"),
                         "users_on_level": on_level, "claim_ready": claim_ready,
                         "times_completed": completed, "tasks": task_stats})
    total_tracked = await db.user_level_progress.count_documents({})
    real_members = await db.users.count_documents(real_member_filter())
    highest = await db.user_level_progress.count_documents({"status": "highest_level_reached"})
    rewards_issued = await db.user_reward_grants.count_documents({"status": "granted"})
    rewards_failed = await db.user_reward_grants.count_documents(
        {"$or": [{"status": "failed"}, {"repair_status": "pending"}]})
    claims_recent = [c async for c in db.progression_claims.find(
        {}, {"_id": 0, "user_id": 1, "level_id": 1, "claimed_at": 1, "status": 1})
        .sort("claimed_at", -1).limit(20)]
    events_failed = await db.progression_events.count_documents({"status": "failed"})
    approvals_pending = await db.progression_manual_approvals.count_documents({"status": "pending"})
    return {"real_members": real_members, "tracked_users": total_tracked,
            "highest_level_users": highest, "levels": by_level,
            "rewards_issued": rewards_issued, "rewards_failed": rewards_failed,
            "recent_claims": claims_recent, "failed_events": events_failed,
            "manual_approvals_pending": approvals_pending}


# ── Logs ──────────────────────────────────────────────────────────────
@router.get("/audit-logs")
async def audit_logs(current: CurrentUser, limit: int = 50):
    require_founder(current)
    logs = [a async for a in db.progression_audit_logs.find({}, {"_id": 0})
            .sort("created_at", -1).limit(min(limit, 200))]
    return {"logs": logs}


@router.get("/claims")
async def claims_log(current: CurrentUser, limit: int = 50):
    require_founder(current)
    claims = [c async for c in db.progression_claims.find({}, {"_id": 0})
              .sort("claimed_at", -1).limit(min(limit, 200))]
    return {"claims": claims}


@router.get("/events")
async def events_log(current: CurrentUser, limit: int = 50, status: Optional[str] = None):
    require_founder(current)
    q = {"status": status} if status else {}
    events = [e async for e in db.progression_events.find(q, {"_id": 0})
              .sort("received_at", -1).limit(min(limit, 200))]
    return {"events": events}


@router.post("/seed")
async def reseed(current: CurrentUser):
    require_founder(current)
    created = await ensure_progression_seed()
    await _audit(current, "seed", "system", "seed", extra={"created": created})
    return {"ok": True, "created": created}


# Bundled premium badge artwork (ships with every deployment) — applied
# into the environment's own media pipeline on demand, idempotently.
BADGE_ART = {
    "Newbie":      ("newbie.webp",      "glowing cyan sprout medallion",    "#4DD2FF", 1.00),
    "Explorer":    ("explorer.webp",    "emerald compass rose medallion",   "#10E670", 1.05),
    "Creator":     ("creator.webp",     "violet paintbrush medallion",      "#C26BFF", 1.10),
    "Rising Star": ("rising_star.webp", "blue shooting star medallion",     "#4DD2FF", 1.15),
    "Influencer":  ("influencer.webp",  "orange megaphone winged crest",    "#FF7A18", 1.20),
    "Elite":       ("elite.webp",       "golden laurel chevron shield",     "#F4C84A", 1.25),
    "Master":      ("master.webp",      "crimson crossed swords and crown", "#FF3F5A", 1.30),
    "Legend":      ("legend.webp",      "radiant green phoenix over crown", "#00FF66", 1.40),
}


@router.post("/apply-badge-artwork")
async def apply_badge_artwork(current: CurrentUser):
    """Founder-only, idempotent: imports the bundled premium badge set into
    THIS environment's media store and assigns it to any launch level that
    doesn't already have artwork. Cosmetic only — no user data touched."""
    require_founder(current)
    from pathlib import Path
    from services.image_store import save_bytes
    root = Path(__file__).resolve().parent.parent / "assets" / "badges"
    applied, skipped, missing = [], [], []
    for name, (fname, alt_sfx, glow, tier) in BADGE_ART.items():
        lvl = await db.progression_levels.find_one({"name": name}, {"_id": 0, "id": 1, "graphics": 1})
        if not lvl:
            missing.append(name); continue
        g = lvl.get("graphics") or {}
        if g.get("badge_url") and g.get("badge_thumb_url"):
            skipped.append(name); continue
        rec = await save_bytes((root / fname).read_bytes(), current["id"], declared_mime="image/webp")
        graphics = {**g, "badge_url": rec.original_url, "badge_thumb_url": rec.thumbnail_url,
                    "alt_text": f"{name} level badge — {alt_sfx}", "glow_color": glow,
                    "glow_intensity": tier, "locked_treatment": g.get("locked_treatment") or "darken"}
        await db.progression_levels.update_one(
            {"id": lvl["id"]},
            {"$set": {"graphics": graphics, "updated_at": _now(), "updated_by": current["id"]}})
        applied.append(name)
    await _audit(current, "apply_badge_artwork", "system", "badge_artwork",
                 extra={"applied": applied, "skipped": skipped, "missing": missing})
    return {"ok": True, "applied": applied, "already_had_artwork": skipped, "levels_missing": missing}


# ── Production activation (founder-driven rollout) ────────────────────
class SeedLaunchPayload(BaseModel):
    confirm: bool = False


@router.post("/seed-launch")
async def seed_launch(payload: SeedLaunchPayload, current: CurrentUser):
    """Idempotent full 8-level launch seed. Never touches existing levels,
    tasks, rewards, versions, or ANY user data. Founder-only + audited."""
    require_founder(current)
    if not payload.confirm:
        raise HTTPException(status_code=400,
                            detail="Confirmation required — send {\"confirm\": true} to seed the launch ladder.")
    result = await seed_launch_ladder(current.get("username") or current["id"])
    indexes = await ensure_progression_indexes()
    await _audit(current, "seed_launch", "system", "launch_ladder",
                 extra={**result, "indexes_ensured": len(indexes)})
    return {"ok": True, **result, "indexes": indexes}


@router.get("/activation")
async def activation_status(current: CurrentUser):
    """Production activation checklist — read-only status of every rollout step."""
    require_founder(current)
    from services.progression.eligibility import progression_eligible_user_filter

    levels = []
    for name in LAUNCH_LEVEL_NAMES:
        l = await db.progression_levels.find_one(
            {"name": name}, {"_id": 0, "id": 1, "status": 1, "config_version": 1, "level_number": 1})
        task_count = await db.progression_tasks.count_documents(
            {"level_id": l["id"], "status": {"$ne": "archived"}}) if l else 0
        levels.append({"name": name, "exists": bool(l),
                       "status": (l or {}).get("status"),
                       "version": (l or {}).get("config_version"),
                       "task_count": task_count})
    seeded = all(x["exists"] and x["status"] == "published" for x in levels)

    idx = await db.user_level_progress.index_information()
    indexes_present = any("user_id" in str(v.get("key")) for v in idx.values())

    async def _last_job(q):
        j = await db.progression_recalculation_jobs.find_one(
            q, {"_id": 0, "id": 1, "status": 1, "dry_run": 1, "totals": 1,
                "started_at": 1, "finished_at": 1, "samples": 1, "errors": 1},
            sort=[("started_at", -1)])
        return j

    last_dry = await _last_job({"dry_run": True, "status": "completed"})
    last_backfill = await _last_job({"dry_run": False, "type": "backfill", "status": "completed"})
    running = await _last_job({"status": "running"})

    eligible = await db.users.count_documents(progression_eligible_user_filter())
    tracked = await db.user_level_progress.count_documents({})
    reconciled = bool(last_backfill
                      and (last_backfill.get("totals") or {}).get("failed", 1) == 0
                      and (last_backfill.get("totals") or {}).get("scanned", 0) >= eligible
                      and tracked >= eligible)

    flags = await get_flags()
    lb_rows = await db.leaderboard_cache.count_documents({})

    return {
        "levels": levels,
        "checklist": {
            "levels_seeded": seeded,
            "indexes_present": indexes_present,
            "dry_run_completed": bool(last_dry),
            "backfill_completed": bool(last_backfill),
            "reconciliation_ok": reconciled,
            "calculations_enabled": flags.get("calculations", False),
            "display_enabled": flags.get("display", False),
            "events_enabled": flags.get("events", False),
            "notifications_enabled": flags.get("notifications", False),
            "claims_enabled": flags.get("claims", False),
            "rewards_enabled": flags.get("rewards", False),
            "leaderboards_verified": seeded and flags.get("display", False) and lb_rows > 0,
        },
        "flags": flags,
        "jobs": {"last_dry_run": last_dry, "last_backfill": last_backfill, "running": running},
        "reconciliation": {"eligible_users": eligible, "tracked_users": tracked,
                           "failed_in_last_backfill": (last_backfill or {}).get("totals", {}).get("failed")},
        "claims_rewards_gate": bool(last_backfill),
    }
