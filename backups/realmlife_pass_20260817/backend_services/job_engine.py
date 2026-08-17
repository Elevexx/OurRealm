"""Persistent background-job engine — Cloudflare-safe long operations.

Every long Game Maker/OPC operation creates a DB-persisted job, returns
202 + job_id within seconds, and runs the expensive work asynchronously.
Jobs survive browser disconnects; a startup reaper recovers jobs whose
worker died. Idempotency keys prevent duplicate jobs.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from core.db import db

log = logging.getLogger("ourrealm.jobs")
_RUNNERS = {}

PHASES = ("queued", "planning", "generating", "resolving_assets", "assembling",
          "validating", "saving", "publishing", "completed", "failed", "cancelled")
ACTIVE = ("queued", "planning", "generating", "resolving_assets", "assembling",
          "validating", "saving", "publishing")


def _iso():
    return datetime.now(timezone.utc).isoformat()


def register(kind: str):
    def deco(fn):
        _RUNNERS[kind] = fn
        return fn
    return deco


async def ensure_indexes():
    await db.gm_jobs.create_index("id", unique=True)
    await db.gm_jobs.create_index([("user_id", 1), ("created_at", -1)])
    await db.gm_jobs.create_index("idem_key", unique=True, sparse=True)
    await db.gm_jobs.create_index("expire_at", expireAfterSeconds=0)  # retention


async def submit(kind: str, user: dict, payload: dict, idem_key: str | None = None) -> dict:
    """Create + start a job. Replay-safe: same idem_key returns the existing job."""
    if kind not in _RUNNERS:
        raise ValueError(f"No runner registered for job kind '{kind}'")
    if idem_key:
        ex = await db.gm_jobs.find_one({"idem_key": idem_key}, {"_id": 0})
        if ex:
            return ex
    job = {"id": uuid.uuid4().hex, "kind": kind, "user_id": user["id"],
           "username": user.get("username"), "phase": "queued", "pct": 0, "note": "",
           "payload": payload, "result": None, "error": None, "cancel_requested": False,
           "created_at": _iso(), "updated_at": _iso(),
           "heartbeat": _iso(), "expire_at": None}
    if idem_key:  # never store idem_key=None — sparse unique index treats explicit null as a value
        job["idem_key"] = idem_key
    try:
        await db.gm_jobs.insert_one(dict(job))
    except Exception:  # duplicate idem_key race
        if idem_key:
            ex = await db.gm_jobs.find_one({"idem_key": idem_key}, {"_id": 0})
            if ex:
                return ex
        raise
    job.pop("_id", None)
    asyncio.create_task(_run(job["id"]))
    return job


async def _run(job_id: str):
    job = await db.gm_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job or job["phase"] not in ACTIVE:
        return
    fn = _RUNNERS.get(job["kind"])
    try:
        result = await fn(job)
        await db.gm_jobs.update_one(
            {"id": job_id, "phase": {"$nin": ["cancelled", "failed"]}},
            {"$set": {"phase": "completed", "pct": 100, "result": result, "error": None,
                      "updated_at": _iso(),
                      "expire_at": datetime.now(timezone.utc) + timedelta(days=30)}})
    except JobCancelled:
        await db.gm_jobs.update_one({"id": job_id}, {"$set": {
            "phase": "cancelled", "updated_at": _iso(),
            "expire_at": datetime.now(timezone.utc) + timedelta(days=30)}})
    except Exception as e:  # noqa: BLE001
        log.exception("job %s (%s) failed", job_id, job["kind"])
        await fail(job_id, str(e)[:400])


class JobCancelled(Exception):
    pass


async def fail(job_id: str, msg: str):
    await db.gm_jobs.update_one({"id": job_id}, {"$set": {
        "phase": "failed", "error": msg, "updated_at": _iso(),
        "expire_at": datetime.now(timezone.utc) + timedelta(days=30)}})


async def phase(job_id: str, ph: str, pct: int | None = None, note: str = ""):
    """Advance a job's phase. Raises JobCancelled if cancel was requested."""
    upd = {"phase": ph, "updated_at": _iso(), "heartbeat": _iso()}
    if pct is not None:
        upd["pct"] = int(pct)
    if note:
        upd["note"] = note[:300]
    doc = await db.gm_jobs.find_one_and_update({"id": job_id}, {"$set": upd},
                                               projection={"_id": 0, "cancel_requested": 1})
    if doc and doc.get("cancel_requested"):
        raise JobCancelled()


async def get(job_id: str) -> dict | None:
    return await db.gm_jobs.find_one({"id": job_id}, {"_id": 0})


async def reap_stale(max_age_minutes: int = 15):
    """Mark jobs abandoned by a crashed/restarted worker as failed."""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)).isoformat()
    r = await db.gm_jobs.update_many(
        {"phase": {"$in": list(ACTIVE)}, "heartbeat": {"$lt": cutoff}},
        {"$set": {"phase": "failed", "error": "Worker restarted before this job finished — safe to retry.",
                  "updated_at": _iso(),
                  "expire_at": datetime.now(timezone.utc) + timedelta(days=30)}})
    if r.modified_count:
        log.warning("job reaper recovered %s abandoned jobs", r.modified_count)
