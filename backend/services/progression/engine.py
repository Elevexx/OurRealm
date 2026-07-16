"""Progression engine — the ONLY source of truth for user progression.

Reads trusted records via the task registry calculators, persists derived
progress, and handles concurrency-safe idempotent claims.
"""
import uuid
import logging
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError
from core.db import db
from services.progression.calculators import calculate_task
from services.progression.rewards import grant_rewards_for_claim

log = logging.getLogger("ourrealm.progression.engine")
RECALC_TTL_SECONDS = 120


def _now():
    return datetime.now(timezone.utc).isoformat()


async def get_snapshot(level_id: str, version: int) -> dict | None:
    v = await db.progression_level_versions.find_one(
        {"level_id": level_id, "version": int(version)}, {"_id": 0})
    return (v or {}).get("snapshot")


async def published_levels() -> list[dict]:
    cur = db.progression_levels.find({"status": "published"}, {"_id": 0})
    levels = [l async for l in cur]
    levels.sort(key=lambda l: (l.get("display_order") or 0, l.get("level_number") or 0))
    return levels


def _level_active(level: dict) -> bool:
    now = _now()
    if level.get("active_from") and now < level["active_from"]:
        return False
    if level.get("expires_at") and now > level["expires_at"]:
        return False
    return True


def _level_eligible(level: dict, user: dict) -> bool:
    if not _level_active(level):
        return False
    modes = level.get("mode_availability") or []
    if modes and (user.get("mode") or "neon") not in modes:
        return False
    rules = level.get("eligibility_rules") or {}
    if rules.get("vip_only") and not user.get("is_vip"):
        return False
    return True


async def starting_level(user: dict) -> dict | None:
    levels = await published_levels()
    for l in levels:
        if l.get("is_starting_level") and _level_eligible(l, user):
            return l
    return next((l for l in levels if _level_eligible(l, user)), None)


async def next_level_after(current: dict, user: dict) -> dict | None:
    levels = await published_levels()
    key = (current.get("display_order") or 0, current.get("level_number") or 0)
    completed_ids = {h["level_id"] async for h in db.user_level_history.find(
        {"user_id": user["id"]}, {"_id": 0, "level_id": 1})}
    for l in levels:
        if (l.get("display_order") or 0, l.get("level_number") or 0) <= key:
            continue
        if l["id"] in completed_ids and not l.get("repeatable"):
            continue
        if _level_eligible(l, user):
            return l
    return None


async def ensure_user_progress(user: dict) -> dict | None:
    """Assign the starting level on first touch. Returns the ULP row."""
    ulp = await db.user_level_progress.find_one({"user_id": user["id"]}, {"_id": 0})
    if ulp:
        return ulp
    start = await starting_level(user)
    if not start:
        return None
    ulp = {
        "user_id": user["id"], "current_level_id": start["id"],
        "current_level_version": start["config_version"],
        "current_level_number": start.get("level_number"),
        "completed_task_count": 0, "required_task_count": 0, "optional_task_count": 0,
        "progress_percentage": 0, "claim_available": False,
        "current_level_started_at": _now(), "last_claimed_at": None,
        "status": "active", "last_calculated_at": None,
        "calculation_source": "init", "updated_at": _now(),
        "visibility": {},
    }
    try:
        await db.user_level_progress.insert_one({**ulp})
    except DuplicateKeyError:
        return await db.user_level_progress.find_one({"user_id": user["id"]}, {"_id": 0})
    return ulp


async def recalc_user(user: dict, persist: bool = True, source: str = "recalc") -> dict:
    """Compute all task progress for the user's current level version."""
    ulp = await ensure_user_progress(user)
    if not ulp:
        return {"status": "no_published_levels", "tasks": []}
    level = await db.progression_levels.find_one({"id": ulp["current_level_id"]}, {"_id": 0})
    snap = await get_snapshot(ulp["current_level_id"], ulp["current_level_version"])
    if not snap:
        return {"status": "missing_level_version", "tasks": [], "ulp": ulp}
    level_status = (level or {}).get("status", "archived")
    started_at = ulp.get("current_level_started_at")

    tasks_out, changed = [], False
    completed_required = required_total = optional_total = 0
    for task in snap.get("tasks") or []:
        r = await calculate_task(user, task, started_at)
        required = task.get("required", True)
        if required:
            required_total += 1
            if r["completed"]:
                completed_required += 1
        else:
            optional_total += 1
        row = {
            "user_id": user["id"], "level_id": snap["id"], "level_version": snap["config_version"],
            "task_id": task["id"], "task_version": task.get("version", 1),
            "current_value": r["value"], "required_value": r["target"],
            "completed": r["completed"], "source": r["source"],
            "calculation_reason": r["reason"], "last_calculated_at": _now(),
        }
        if persist:
            prev = await db.user_task_progress.find_one_and_update(
                {"user_id": user["id"], "level_id": snap["id"], "task_id": task["id"],
                 "level_version": snap["config_version"]},
                {"$set": row,
                 "$setOnInsert": {"id": uuid.uuid4().hex, "created_at": _now()},
                 **({"$currentDate": {}} if True else {})},
                upsert=True, projection={"_id": 0, "completed": 1, "completed_at": 1, "current_value": 1},
            )
            if not prev or prev.get("completed") != r["completed"] or prev.get("current_value") != r["value"]:
                changed = True
            if r["completed"] and not (prev or {}).get("completed_at"):
                await db.user_task_progress.update_one(
                    {"user_id": user["id"], "level_id": snap["id"], "task_id": task["id"],
                     "level_version": snap["config_version"]},
                    {"$set": {"completed_at": _now()}})
        tasks_out.append({**{k: task.get(k) for k in
                             ("id", "name", "description", "task_type_key", "required",
                              "button_label", "button_destination", "sort_order", "graphic_url")},
                          "current_value": r["value"], "required_value": r["target"],
                          "completed": r["completed"]})

    rule = (snap.get("progress_settings") or {})
    needed = int(rule.get("required_task_count") or required_total)
    claimable = completed_required >= min(needed, required_total) and required_total > 0 \
        and level_status == "published"
    pct = round(completed_required / max(1, min(needed, required_total)) * 100) if required_total else 0

    status = "active"
    if level_status == "paused":
        status, claimable = "paused_level", False
    elif level_status == "archived":
        status, claimable = "archived_level", False

    # Already-claimed current level (terminal position): never re-offer the
    # claim. If a NEW next level has since been published, advance into it.
    already_claimed = await db.progression_claims.find_one(
        {"user_id": user["id"], "level_id": snap["id"],
         "level_version": snap["config_version"], "status": "success"},
        {"_id": 0, "id": 1})
    if already_claimed:
        claimable = False
        nxt = await next_level_after(snap, user)
        if nxt:
            await db.user_level_progress.update_one(
                {"user_id": user["id"], "current_level_id": snap["id"]},
                {"$set": {"current_level_id": nxt["id"],
                          "current_level_version": nxt["config_version"],
                          "current_level_number": nxt.get("level_number"),
                          "current_level_started_at": _now(),
                          "status": "active", "claim_available": False,
                          "last_calculated_at": None,
                          "calculation_source": "auto_advance", "updated_at": _now()}})
            fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password": 0})
            return await recalc_user(fresh or user, persist=persist, source="auto_advance")
        status = "highest_level_reached"

    summary = {
        "current_level_id": snap["id"], "current_level_version": snap["config_version"],
        "current_level_number": snap.get("level_number"),
        "completed_task_count": completed_required, "required_task_count": min(needed, required_total),
        "optional_task_count": optional_total,
        "progress_percentage": min(100, pct), "claim_available": claimable,
        "status": status, "last_calculated_at": _now(), "calculation_source": source,
        "updated_at": _now(),
    }
    if persist:
        await db.user_level_progress.update_one({"user_id": user["id"]}, {"$set": summary})
    return {"status": status, "level": {k: snap.get(k) for k in
            ("id", "name", "level_number", "short_description", "graphics",
             "progress_settings", "claim_mode", "config_version")},
            "summary": summary, "tasks": sorted(tasks_out, key=lambda t: t.get("sort_order") or 0),
            "changed": changed, "ulp": {**(ulp or {}), **summary}}


async def maybe_recalc(user: dict, force: bool = False) -> dict:
    """TTL-cached read-time recalculation."""
    ulp = await db.user_level_progress.find_one({"user_id": user["id"]}, {"_id": 0})
    if ulp and not force and ulp.get("last_calculated_at"):
        try:
            last = datetime.fromisoformat(ulp["last_calculated_at"])
            if (datetime.now(timezone.utc) - last).total_seconds() < RECALC_TTL_SECONDS:
                return await recalc_user(user, persist=False, source="cached_read")
        except Exception:
            pass
    return await recalc_user(user, persist=True, source="read")


async def claim_level(user: dict, level_id: str, idempotency_key: str | None = None) -> dict:
    """Concurrency-safe, idempotent claim. One successful claim per
    (user, level, published config version)."""
    ulp = await ensure_user_progress(user)
    if not ulp or ulp["current_level_id"] != level_id:
        prev = await db.progression_claims.find_one(
            {"user_id": user["id"], "level_id": level_id, "status": "success"}, {"_id": 0})
        if prev:
            return {"ok": True, "idempotent": True, **(prev.get("response") or {})}
        return {"ok": False, "error": "This level is not your current level.", "code": 409}

    # Fresh backend revalidation of EVERY requirement.
    result = await recalc_user(user, persist=True, source="claim_validation")
    if result["status"] != "active":
        return {"ok": False, "error": f"Level is {result['status'].replace('_', ' ')} — claiming is unavailable.", "code": 409}
    if not result["summary"]["claim_available"]:
        return {"ok": False, "error": "Not all required tasks are complete.", "code": 400,
                "progress": result["summary"]}

    version = ulp["current_level_version"]
    snap = await get_snapshot(level_id, version)
    claim = {
        "id": uuid.uuid4().hex, "user_id": user["id"], "level_id": level_id,
        "level_version": version, "status": "success",
        "idempotency_key": idempotency_key or None,
        "claimed_at": _now(), "response": None,
    }
    try:
        await db.progression_claims.insert_one({**claim})
    except DuplicateKeyError:
        prev = await db.progression_claims.find_one(
            {"user_id": user["id"], "level_id": level_id, "level_version": version,
             "status": "success"}, {"_id": 0})
        return {"ok": True, "idempotent": True, **((prev or {}).get("response") or {})}

    # Guarded single transition of the current level.
    nxt = await next_level_after(snap, user)
    transition = await db.user_level_progress.find_one_and_update(
        {"user_id": user["id"], "current_level_id": level_id,
         "current_level_version": version},
        {"$set": {
            "current_level_id": (nxt or snap)["id"],
            "current_level_version": (nxt or snap)["config_version"],
            "current_level_number": (nxt or snap).get("level_number"),
            "current_level_started_at": _now() if nxt else ulp.get("current_level_started_at"),
            "last_claimed_at": _now(),
            "status": "active" if nxt else "highest_level_reached",
            "claim_available": False, "updated_at": _now(),
        }},
        projection={"_id": 0},
    )
    if transition is None:
        # Another request already transitioned — treat as idempotent success.
        prev = await db.progression_claims.find_one(
            {"user_id": user["id"], "level_id": level_id, "level_version": version,
             "status": "success", "response": {"$ne": None}}, {"_id": 0})
        if prev:
            return {"ok": True, "idempotent": True, **(prev.get("response") or {})}

    await db.user_level_history.insert_one({
        "id": uuid.uuid4().hex, "user_id": user["id"], "level_id": level_id,
        "level_version": version, "level_number": snap.get("level_number"),
        "level_name": snap.get("name"), "graphics": snap.get("graphics") or {},
        "completed_at": _now(), "claim_id": claim["id"],
    })
    reward_results = await grant_rewards_for_claim(user["id"], snap, claim["id"])
    reward_names = {r.get("id"): r.get("name") for r in (snap.get("rewards") or [])}
    for rr in reward_results:
        rr["name"] = reward_names.get(rr.get("reward_id")) or "Reward"

    next_progress = None
    if nxt:
        # Immediately calculate the next level — pre-completed tasks count.
        next_progress = await recalc_user(user, persist=True, source="post_claim")

    response = {
        "claim_id": claim["id"],
        "completed_level": {"id": snap["id"], "name": snap.get("name"),
                            "level_number": snap.get("level_number"),
                            "graphics": snap.get("graphics") or {},
                            "celebration_message": (snap.get("progress_settings") or {}).get("celebration_message")},
        "new_level": ({"id": nxt["id"], "name": nxt.get("name"),
                       "level_number": nxt.get("level_number"),
                       "graphics": nxt.get("graphics") or {}} if nxt else None),
        "highest_level_reached": nxt is None,
        "rewards": reward_results,
        "next_progress": (next_progress or {}).get("summary"),
    }
    await db.progression_claims.update_one({"id": claim["id"]}, {"$set": {"response": response}})
    # A claim changes reputation, level, and achievements — expire the
    # leaderboard snapshots so rankings reflect it immediately.
    await db.leaderboard_cache.delete_many({})
    return {"ok": True, "idempotent": False, **response}
