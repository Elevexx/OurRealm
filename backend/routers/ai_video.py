"""AI Video routes — founder admin controls + course lesson video actions.

Admin:  /api/admin/ai-video/*           (founder only)
Course: /api/responsibility-center/{cid}/courses/{course_id}/lessons/{lesson_id}/video/*
        (edit_center permission — same gate as course editing)
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import video_generation as vg
from services.video_providers import PROVIDERS
from services.rc_units import _ctx
from utils.sliding_window_rate_limit import rate_limit

log = logging.getLogger("ourrealm.ai_video")
admin_router = APIRouter(prefix="/api/admin/ai-video", tags=["ai-video-admin"])
course_router = APIRouter(prefix="/api/responsibility-center", tags=["ai-video-course"])
styles_router = APIRouter(prefix="/api/ai-styles", tags=["ai-styles"])


@admin_router.on_event("startup")
async def _recover_on_startup():
    import asyncio as _aio
    from services import media_retry
    _aio.get_event_loop().call_later(3, lambda: _aio.create_task(vg.recover_orphaned_jobs()))
    _aio.get_event_loop().call_later(5, lambda: _aio.create_task(media_retry.start_retry_worker()))


# ── Universal Animation Style registry + user presets ───────────────────
@styles_router.get("")
async def list_styles(current: CurrentUser):
    from services import animation_styles as ast
    return {"styles": await ast.get_styles(), "cameras": ast.CAMERA_STYLES}


@styles_router.get("/presets")
async def list_style_presets(current: CurrentUser):
    from services import animation_styles as ast
    return {"presets": await ast.list_presets(current["id"])}


@styles_router.post("/presets")
async def save_style_preset(body: dict, current: CurrentUser):
    from services import animation_styles as ast
    name = (body.get("name") or "").strip()
    if not name or not isinstance(body.get("profile"), dict):
        raise HTTPException(status_code=400, detail="A name and style profile are required")
    return {"preset": await ast.save_preset(current["id"], name, body["profile"])}


@styles_router.delete("/presets/{preset_id}")
async def delete_style_preset(preset_id: str, current: CurrentUser):
    await db.animation_style_presets.delete_one({"id": preset_id, "user_id": current["id"]})
    return {"ok": True}


# ── Founder Command Center ──────────────────────────────────────────────
@admin_router.get("/settings")
async def get_settings(current: CurrentUser):
    require_founder(current)
    s = await vg.get_video_settings()
    spend = await vg.spend_summary()
    return {"settings": s, "spend": spend,
            "providers": [{"name": p.name, "label": p.display_name,
                           "can_generate": p.can_generate, "models": p.models,
                           "seconds": p.supported_seconds, "sizes": p.supported_sizes}
                          for p in PROVIDERS.values()]}


@admin_router.patch("/settings")
async def patch_settings(body: dict, current: CurrentUser):
    require_founder(current)
    reason = (body.get("reason") or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="A short written reason is required")
    s = await vg.update_video_settings(body, current, reason)
    return {"settings": s}


@admin_router.get("/providers/health")
async def providers_health(current: CurrentUser):
    require_founder(current)
    out = []
    for p in PROVIDERS.values():
        h = await p.health()
        out.append({"name": p.name, "label": p.display_name,
                    "can_generate": p.can_generate, **h})
    return {"providers": out}


@admin_router.get("/queue")
async def queue(current: CurrentUser):
    require_founder(current)
    rows = await db.ai_video_jobs.find(
        {"status": {"$in": list(vg.ACTIVE_STATUSES)}}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return {"jobs": rows}


@admin_router.get("/history")
async def history(current: CurrentUser, status: str = "", provider: str = "",
                  center_id: str = "", course_id: str = "", creator: str = "",
                  q: str = "", include_archived: bool = False,
                  skip: int = 0, limit: int = 40):
    require_founder(current)
    query = {}
    if status:
        query["status"] = status
    if provider:
        query["provider"] = provider
    if center_id:
        query["center_id"] = center_id
    if course_id:
        query["course_id"] = course_id
    if creator:
        query["created_by_username"] = {"$regex": creator, "$options": "i"}
    if q:
        query["prompt"] = {"$regex": q[:100], "$options": "i"}
    if not include_archived:
        query["archived"] = {"$ne": True}
    total = await db.ai_video_jobs.count_documents(query)
    rows = await db.ai_video_jobs.find(query, {"_id": 0}).sort(
        "created_at", -1).skip(max(0, skip)).limit(min(100, limit)).to_list(100)
    return {"jobs": rows, "total": total}


@admin_router.get("/analytics")
async def analytics(current: CurrentUser):
    require_founder(current)
    spend = await vg.spend_summary()
    by_status = await db.ai_video_jobs.aggregate(
        [{"$group": {"_id": "$status", "n": {"$sum": 1}}}]).to_list(20)
    by_provider = await db.ai_video_jobs.aggregate(
        [{"$group": {"_id": "$provider", "n": {"$sum": 1},
                     "cost": {"$sum": {"$ifNull": ["$actual_cost", 0]}}}}]).to_list(20)
    total = await db.ai_video_jobs.count_documents({})
    return {"spend": spend, "total_jobs": total,
            "by_status": {r["_id"]: r["n"] for r in by_status},
            "by_provider": {r["_id"]: {"jobs": r["n"], "cost": round(r["cost"], 2)}
                            for r in by_provider}}


@admin_router.post("/jobs/{job_id}/cancel")
async def admin_cancel(job_id: str, current: CurrentUser):
    require_founder(current)
    r = await db.ai_video_jobs.update_one(
        {"id": job_id, "status": {"$in": list(vg.ACTIVE_STATUSES)}},
        {"$set": {"cancel_requested": True}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="No active job with that id")
    await vg.audit(current, "video_job_cancelled_by_admin", job_id=job_id)
    return {"ok": True}


@admin_router.post("/jobs/{job_id}/archive")
async def admin_archive(job_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    archived = bool(body.get("archived", True))
    r = await db.ai_video_jobs.update_one({"id": job_id}, {"$set": {"archived": archived}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Job not found")
    await vg.audit(current, "video_job_archived" if archived else "video_job_unarchived", job_id=job_id)
    return {"ok": True}


@admin_router.delete("/jobs/{job_id}")
async def admin_delete(job_id: str, current: CurrentUser):
    require_founder(current)
    job = await db.ai_video_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] in vg.ACTIVE_STATUSES:
        raise HTTPException(status_code=409, detail="Cancel the job before deleting it")
    await db.ai_video_jobs.delete_one({"id": job_id})
    await vg.audit(current, "video_job_deleted", job_id=job_id,
                   detail=f"course={job.get('course_id')}")
    return {"ok": True}


@admin_router.get("/audit")
async def audit_log(current: CurrentUser, limit: int = 50):
    require_founder(current)
    rows = await db.ai_video_audit.find({}, {"_id": 0}).sort(
        "at", -1).limit(min(200, limit)).to_list(200)
    return {"entries": rows}


# ── Course lesson video actions ─────────────────────────────────────────
async def _lesson_block(course_id: str, lesson_id: str, block_id: str):
    lesson = await db.rc_course_lessons.find_one(
        {"id": lesson_id, "course_id": course_id}, {"_id": 0})
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    block = next((b for b in lesson.get("blocks", []) if b.get("id") == block_id), None)
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")
    return lesson, block


@course_router.post("/{center_id}/courses/{course_id}/lessons/{lesson_id}/video/estimate")
async def video_estimate(center_id: str, course_id: str, lesson_id: str,
                         body: dict, current: CurrentUser):
    await _ctx(center_id, current, "edit_center")
    try:
        est = await vg.build_estimate(course_id, body.get("seconds"), body.get("size"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    est.pop("_internal", None)
    return est


@course_router.post("/{center_id}/courses/{course_id}/lessons/{lesson_id}/video/generate")
async def video_generate(center_id: str, course_id: str, lesson_id: str,
                         body: dict, current: CurrentUser):
    await _ctx(center_id, current, "edit_center")
    from services.access_policy import require_access
    await require_access("ai_video", current, center_id=center_id, consume=True)
    rl = await rate_limit(f"ai-video:{current['id']}", max_requests=10, window_seconds=3600)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail=f"Video limit reached — try again in {rl['retry_after']}s")
    block_id = body.get("block_id")
    prompt = (body.get("prompt") or "").strip()
    if not block_id or not prompt:
        raise HTTPException(status_code=400, detail="A block and a video description are required")
    await _lesson_block(course_id, lesson_id, block_id)
    if not body.get("approve_cost"):
        raise HTTPException(status_code=400, detail="Review the cost estimate and approve it first")
    try:
        est = await vg.build_estimate(course_id, body.get("seconds"), body.get("size"))
        # Explicit-approval contract: the approved figure must match server truth.
        if round(float(body.get("approved_cost", -1)), 2) != est["estimated_cost"]:
            raise HTTPException(status_code=409, detail="The cost changed — review the new estimate")
        job = await vg.start_video_job(
            center_id=center_id, course_id=course_id, lesson_id=lesson_id,
            block_id=block_id, prompt=prompt, seconds=est["seconds"],
            size=est["size"], current=current,
            negative_prompt=body.get("negative_prompt") or "",
            style_profile=body.get("style_profile") if isinstance(body.get("style_profile"), dict) else None)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.rc_course_lessons.update_one(
        {"id": lesson_id, "blocks.id": block_id},
        {"$set": {"blocks.$.video_status": "queued", "blocks.$.video_job_id": job["id"]}})
    return {"job_id": job["id"], "dry_run": job["dry_run"],
            "estimated_cost": job["estimated_cost"]}


@course_router.get("/{center_id}/courses/{course_id}/lessons/{lesson_id}/video/jobs/{job_id}")
async def video_job_status(center_id: str, course_id: str, lesson_id: str,
                           job_id: str, current: CurrentUser):
    await _ctx(center_id, current, "edit_center")
    job = await db.ai_video_jobs.find_one(
        {"id": job_id, "course_id": course_id}, {"_id": 0, "provider_job_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    s = await vg.get_video_settings()
    if not s["expose_provider_names"]:
        job["provider"] = None
        job["model"] = None
    return job


@course_router.post("/{center_id}/courses/{course_id}/lessons/{lesson_id}/video/jobs/{job_id}/cancel")
async def video_job_cancel(center_id: str, course_id: str, lesson_id: str,
                           job_id: str, current: CurrentUser):
    await _ctx(center_id, current, "edit_center")
    r = await db.ai_video_jobs.update_one(
        {"id": job_id, "course_id": course_id, "status": {"$in": list(vg.ACTIVE_STATUSES)}},
        {"$set": {"cancel_requested": True}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="No active job with that id")
    await vg.audit(current, "video_job_cancelled", center_id=center_id,
                   course_id=course_id, job_id=job_id)
    return {"ok": True}


@course_router.post("/{center_id}/courses/{course_id}/lessons/{lesson_id}/video/attach")
async def video_attach(center_id: str, course_id: str, lesson_id: str,
                       body: dict, current: CurrentUser):
    """Attach an uploaded OurRealm video or an external https URL."""
    await _ctx(center_id, current, "edit_center")
    block_id = body.get("block_id")
    url = str(body.get("video_url") or "").strip()[:800]
    if not block_id or not url:
        raise HTTPException(status_code=400, detail="A block and a video URL are required")
    if not (url.startswith("https://") or url.startswith("/api/")):
        raise HTTPException(status_code=400, detail="Use an https:// link or an OurRealm video URL")
    await _lesson_block(course_id, lesson_id, block_id)
    source = "uploaded" if url.startswith("/api/") else "external"
    await db.rc_course_lessons.update_one(
        {"id": lesson_id, "blocks.id": block_id},
        {"$set": {"blocks.$.video_url": url, "blocks.$.video_source": source,
                  "blocks.$.video_status": "ready", "blocks.$.video_job_id": None,
                  "blocks.$.video_thumbnail": None,
                  "updated_at": datetime.now(timezone.utc).isoformat()}})
    await vg.audit(current, "video_attached", center_id=center_id, course_id=course_id,
                   lesson_id=lesson_id, detail=f"source={source}")
    return {"ok": True, "video_url": url, "video_source": source}


@course_router.post("/{center_id}/courses/{course_id}/lessons/{lesson_id}/video/remove")
async def video_remove(center_id: str, course_id: str, lesson_id: str,
                       body: dict, current: CurrentUser):
    await _ctx(center_id, current, "edit_center")
    block_id = body.get("block_id")
    if not block_id:
        raise HTTPException(status_code=400, detail="block_id required")
    await _lesson_block(course_id, lesson_id, block_id)
    await db.rc_course_lessons.update_one(
        {"id": lesson_id, "blocks.id": block_id},
        {"$set": {"blocks.$.video_url": None, "blocks.$.video_source": None,
                  "blocks.$.video_status": None, "blocks.$.video_job_id": None,
                  "blocks.$.video_thumbnail": None,
                  "updated_at": datetime.now(timezone.utc).isoformat()}})
    await vg.audit(current, "video_removed", center_id=center_id, course_id=course_id,
                   lesson_id=lesson_id)
    return {"ok": True}
