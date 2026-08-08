"""Job status/control endpoints for the persistent background-job engine."""
from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import get_admin_role
from services import job_engine

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _can_see(job: dict, user: dict) -> bool:
    return job["user_id"] == user["id"] or bool(get_admin_role(user))


@router.get("/mine")
async def my_jobs(current: CurrentUser, kind: str = "", limit: int = 20):
    q = {"user_id": current["id"]}
    if kind:
        q["kind"] = kind
    rows = await db.gm_jobs.find(q, {"_id": 0, "payload": 0}).sort("created_at", -1).to_list(min(limit, 50))
    return {"jobs": rows}


@router.get("/{job_id}")
async def job_status(job_id: str, current: CurrentUser):
    job = await job_engine.get(job_id)
    if not job or not _can_see(job, current):
        raise HTTPException(status_code=404, detail="Job not found")
    job.pop("payload", None)
    return {"job": job}


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: str, current: CurrentUser):
    job = await job_engine.get(job_id)
    if not job or not _can_see(job, current):
        raise HTTPException(status_code=404, detail="Job not found")
    if job["phase"] not in job_engine.ACTIVE:
        raise HTTPException(status_code=400, detail="Job already finished")
    await db.gm_jobs.update_one({"id": job_id}, {"$set": {"cancel_requested": True}})
    return {"ok": True}


@router.post("/{job_id}/retry")
async def retry_job(job_id: str, current: CurrentUser):
    job = await job_engine.get(job_id)
    if not job or not _can_see(job, current):
        raise HTTPException(status_code=404, detail="Job not found")
    if job["phase"] != "failed":
        raise HTTPException(status_code=400, detail="Only failed jobs can be retried")
    new = await job_engine.submit(job["kind"], current, job.get("payload") or {}, idem_key=None)
    return {"job_id": new["id"]}
