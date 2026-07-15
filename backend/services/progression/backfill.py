"""Batched, resumable backfill / recalculation jobs + Dry Runs.

Dry Runs never mutate user progress, claims, rewards, history or reputation.
"""
import asyncio
import uuid
import logging
from datetime import datetime, timezone

from core.db import db
from services.progression.eligibility import progression_eligible_user_filter
from services.progression.engine import recalc_user, ensure_user_progress

log = logging.getLogger("ourrealm.progression.backfill")
BATCH_SIZE = 100
_running_tasks: dict[str, asyncio.Task] = {}


def _now():
    return datetime.now(timezone.utc).isoformat()


async def start_job(job_type: str, dry_run: bool, started_by: str,
                    user_ids: list[str] | None = None) -> dict:
    existing = await db.progression_recalculation_jobs.find_one(
        {"status": "running"}, {"_id": 0, "id": 1})
    if existing:
        return {"ok": False, "error": f"A job is already running ({existing['id']}). Cancel or wait.", "code": 409}
    job = {
        "id": uuid.uuid4().hex, "type": job_type, "dry_run": bool(dry_run),
        "status": "running", "cursor_user_id": None,
        "user_ids": user_ids,
        "totals": {"scanned": 0, "changed": 0, "unchanged": 0, "failed": 0,
                   "excluded": 0, "claim_ready": 0},
        "samples": [], "errors": [],
        "started_by": started_by, "started_at": _now(), "finished_at": None,
        "batch_size": BATCH_SIZE,
    }
    await db.progression_recalculation_jobs.insert_one({**job})
    _running_tasks[job["id"]] = asyncio.create_task(_run(job["id"]))
    return {"ok": True, "job": job}


async def resume_job(job_id: str) -> dict:
    job = await db.progression_recalculation_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        return {"ok": False, "error": "Job not found", "code": 404}
    if job["status"] not in ("running", "interrupted"):
        return {"ok": False, "error": f"Job is {job['status']}", "code": 409}
    if job_id in _running_tasks and not _running_tasks[job_id].done():
        return {"ok": True, "job": job, "note": "already running"}
    await db.progression_recalculation_jobs.update_one({"id": job_id}, {"$set": {"status": "running"}})
    _running_tasks[job_id] = asyncio.create_task(_run(job_id))
    return {"ok": True, "job": job}


async def cancel_job(job_id: str) -> dict:
    await db.progression_recalculation_jobs.update_one(
        {"id": job_id, "status": "running"}, {"$set": {"status": "cancelling"}})
    return {"ok": True}


async def _run(job_id: str) -> None:
    try:
        while True:
            job = await db.progression_recalculation_jobs.find_one({"id": job_id}, {"_id": 0})
            if not job or job["status"] == "cancelling":
                await db.progression_recalculation_jobs.update_one(
                    {"id": job_id}, {"$set": {"status": "cancelled", "finished_at": _now()}})
                return
            q = progression_eligible_user_filter()
            if job.get("user_ids"):
                q = {"id": {"$in": job["user_ids"]}}
            if job.get("cursor_user_id"):
                q["id"] = {**(q.get("id") or {}), "$gt": job["cursor_user_id"]} if isinstance(q.get("id"), dict) \
                    else {"$gt": job["cursor_user_id"]}
            batch = [u async for u in db.users.find(q, {"_id": 0, "password": 0, "password_hash": 0})
                     .sort("id", 1).limit(BATCH_SIZE)]
            if not batch:
                await db.progression_recalculation_jobs.update_one(
                    {"id": job_id}, {"$set": {"status": "completed", "finished_at": _now()}})
                return
            totals = job["totals"]
            samples = job.get("samples") or []
            for user in batch:
                totals["scanned"] += 1
                try:
                    if job["dry_run"]:
                        # Read-only: compute proposed progress without writes.
                        prev = await db.user_level_progress.find_one({"user_id": user["id"]}, {"_id": 0})
                        result = await _dry_calc(user)
                        changed = (not prev) or prev.get("completed_task_count") != result["completed"] \
                            or prev.get("claim_available") != result["claim_available"]
                        totals["changed" if changed else "unchanged"] += 1
                        if result["claim_available"]:
                            totals["claim_ready"] += 1
                        if changed and len(samples) < 25:
                            samples.append({"username": user.get("username"),
                                            "level": result["level_name"],
                                            "proposed": f"{result['completed']}/{result['required']}",
                                            "claim_ready": result["claim_available"]})
                    else:
                        await ensure_user_progress(user)
                        r = await recalc_user(user, persist=True, source="backfill")
                        totals["changed" if r.get("changed") else "unchanged"] += 1
                        if (r.get("summary") or {}).get("claim_available"):
                            totals["claim_ready"] += 1
                except Exception as e:
                    totals["failed"] += 1
                    errs = job.get("errors") or []
                    if len(errs) < 20:
                        errs.append({"user": user.get("username"), "error": str(e)[:200]})
                        await db.progression_recalculation_jobs.update_one(
                            {"id": job_id}, {"$set": {"errors": errs}})
            await db.progression_recalculation_jobs.update_one(
                {"id": job_id},
                {"$set": {"totals": totals, "samples": samples,
                          "cursor_user_id": batch[-1]["id"], "updated_at": _now()}})
            await asyncio.sleep(0.05)  # yield — never starve user traffic
    except Exception as e:
        log.exception("backfill job crashed")
        await db.progression_recalculation_jobs.update_one(
            {"id": job_id}, {"$set": {"status": "interrupted", "error": str(e)[:300]}})


async def _dry_calc(user: dict) -> dict:
    """Compute proposed progress with ZERO writes."""
    from services.progression.engine import starting_level, get_snapshot
    from services.progression.calculators import calculate_task
    ulp = await db.user_level_progress.find_one({"user_id": user["id"]}, {"_id": 0})
    if ulp:
        snap = await get_snapshot(ulp["current_level_id"], ulp["current_level_version"])
    else:
        start = await starting_level(user)
        snap = await get_snapshot(start["id"], start["config_version"]) if start else None
    if not snap:
        return {"level_name": None, "completed": 0, "required": 0, "claim_available": False}
    started = (ulp or {}).get("current_level_started_at")
    completed = required = 0
    for task in snap.get("tasks") or []:
        if not task.get("required", True):
            continue
        required += 1
        r = await calculate_task(user, task, started)
        if r["completed"]:
            completed += 1
    needed = int((snap.get("progress_settings") or {}).get("required_task_count") or required)
    return {"level_name": snap.get("name"), "completed": completed,
            "required": min(needed, required),
            "claim_available": required > 0 and completed >= min(needed, required)}
