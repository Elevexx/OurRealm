"""AI Video generation orchestrator — provider-agnostic.

Reuses: existing async-job pattern (rc_course_gen_jobs style), video_dir +
r2_mirror for storage, image_store for thumbnails, RC notifications, RC
activity log, sliding-window rate limits. Collections: ai_video_settings
(+_history), ai_video_jobs, ai_video_audit.

Never auto-spends: jobs are only created by an endpoint that requires the
requester's explicit cost approval, and every budget gate is enforced
server-side here.
"""
import asyncio
import logging
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from core.db import db
from services.video_providers import get_provider

log = logging.getLogger("ourrealm.video.generation")

SETTINGS_DEFAULTS = {
    "enabled": True,
    "emergency_disabled": False,
    "dry_run": True,  # safe default: full pipeline, zero provider spend
    "expose_provider_names": False,
    "default_provider": "openai",
    "default_model": "sora-2",
    "default_seconds": 4,
    "default_size": "1280x720",
    "quality": "standard",
    "daily_budget": 5.0,
    "monthly_budget": 50.0,
    "max_per_video": 2.0,
    "max_per_course": 10.0,
    "max_concurrent_jobs": 2,
    "provider_priority": ["openai"],
}
ACTIVE_STATUSES = ("queued", "generating", "downloading", "uploading_r2", "optimizing", "attaching")
_cache = {"at": 0.0, "doc": None}


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def get_video_settings() -> dict:
    if _cache["doc"] and time.monotonic() - _cache["at"] < 10:
        return _cache["doc"]
    doc = await db.ai_video_settings.find_one({"_id": "settings"}) or {}
    merged = {**SETTINGS_DEFAULTS, **{k: v for k, v in doc.items() if k in SETTINGS_DEFAULTS}}
    _cache.update(at=time.monotonic(), doc=merged)
    return merged


async def update_video_settings(patch: dict, admin: dict, reason: str) -> dict:
    before = await get_video_settings()
    clean = {}
    for k in SETTINGS_DEFAULTS:
        if k not in patch:
            continue
        v = patch[k]
        if isinstance(SETTINGS_DEFAULTS[k], bool):
            clean[k] = bool(v)
        elif isinstance(SETTINGS_DEFAULTS[k], (int, float)) and not isinstance(SETTINGS_DEFAULTS[k], bool):
            clean[k] = max(0, type(SETTINGS_DEFAULTS[k])(v))
        elif isinstance(SETTINGS_DEFAULTS[k], list):
            clean[k] = [str(x)[:40] for x in v][:10] if isinstance(v, list) else before[k]
        else:
            clean[k] = str(v)[:60]
    if clean:
        await db.ai_video_settings.update_one({"_id": "settings"}, {"$set": clean}, upsert=True)
        await db.ai_video_settings_history.insert_one({
            "id": uuid.uuid4().hex, "at": _iso(), "by_id": admin["id"],
            "by_username": admin.get("username"), "reason": (reason or "")[:500],
            "before": {k: before.get(k) for k in clean}, "after": clean})
        await audit(admin, "video_settings_changed", detail=str(sorted(clean.keys())))
        _cache["doc"] = None
    return await get_video_settings()


async def audit(actor: dict, action: str, *, center_id=None, course_id=None,
                lesson_id=None, job_id=None, detail: str = ""):
    try:
        await db.ai_video_audit.insert_one({
            "id": uuid.uuid4().hex, "at": _iso(), "action": action,
            "actor_id": actor.get("id"), "actor_username": actor.get("username"),
            "center_id": center_id, "course_id": course_id,
            "lesson_id": lesson_id, "job_id": job_id, "detail": str(detail)[:500]})
    except Exception:  # noqa: BLE001 — audit must never block flows
        log.warning("ai video audit write failed")


async def spend_summary() -> dict:
    """USD committed today / this month (in-flight jobs count at estimate)."""
    now = datetime.now(timezone.utc)
    day = now.strftime("%Y-%m-%d")
    month = now.strftime("%Y-%m")
    rows = await db.ai_video_jobs.aggregate([
        {"$match": {"status": {"$in": [*ACTIVE_STATUSES, "complete"]},
                    "created_at": {"$gte": f"{month}-01"}}},
        {"$project": {"created_at": 1,
                      "cost": {"$ifNull": ["$actual_cost", "$estimated_cost"]}}},
    ]).to_list(3000)
    daily = sum(r.get("cost") or 0 for r in rows if (r.get("created_at") or "").startswith(day))
    monthly = sum(r.get("cost") or 0 for r in rows)
    return {"daily_spent": round(daily, 2), "monthly_spent": round(monthly, 2)}


async def course_committed(course_id: str) -> float:
    rows = await db.ai_video_jobs.find(
        {"course_id": course_id, "status": {"$in": [*ACTIVE_STATUSES, "complete"]}},
        {"estimated_cost": 1, "actual_cost": 1}).to_list(500)
    return round(sum((r.get("actual_cost") if r.get("actual_cost") is not None
                      else r.get("estimated_cost")) or 0 for r in rows), 2)


async def build_estimate(course_id: str, seconds=None, size=None,
                         provider_name=None, model=None) -> dict:
    s = await get_video_settings()
    provider_name = provider_name or s["default_provider"]
    p = get_provider(provider_name)
    if not p.can_generate:
        raise ValueError("That source cannot generate video")
    model = model if model in p.models else s["default_model"]
    if model not in p.models:
        model = p.models[0]
    seconds = int(seconds or s["default_seconds"])
    if seconds not in p.supported_seconds:
        raise ValueError(f"Supported durations: {p.supported_seconds} seconds")
    size = size or s["default_size"]
    cost = 0.0 if s["dry_run"] else p.estimate_cost(model, seconds, size)
    spend = await spend_summary()
    course_total = await course_committed(course_id)
    blockers = []
    if not s["enabled"] or s["emergency_disabled"]:
        blockers.append("AI video generation is currently turned off")
    if not s["dry_run"]:
        if cost > s["max_per_video"]:
            blockers.append(f"Exceeds the per-video limit (${s['max_per_video']:.2f})")
        if course_total + cost > s["max_per_course"]:
            blockers.append(f"Would exceed this course's video budget (${s['max_per_course']:.2f})")
        if spend["daily_spent"] + cost > s["daily_budget"]:
            blockers.append("Would exceed today's video budget")
        if spend["monthly_spent"] + cost > s["monthly_budget"]:
            blockers.append("Would exceed this month's video budget")
    running = await db.ai_video_jobs.count_documents({"status": {"$in": list(ACTIVE_STATUSES)}})
    if running >= s["max_concurrent_jobs"]:
        blockers.append("Video queue is full — try again in a few minutes")
    return {
        "provider": provider_name if s["expose_provider_names"] else None,
        "provider_label": p.display_name if s["expose_provider_names"] else "ORAi Video Engine",
        "model": model if s["expose_provider_names"] else None,
        "seconds": seconds, "size": size, "quality": s["quality"],
        "estimated_cost": cost,
        "estimated_time_seconds": p.estimate_time_seconds(seconds),
        "dry_run": s["dry_run"],
        "daily_budget_remaining": round(max(0, s["daily_budget"] - spend["daily_spent"]), 2),
        "monthly_budget_remaining": round(max(0, s["monthly_budget"] - spend["monthly_spent"]), 2),
        "course_total_committed": course_total,
        "course_total_with_this": round(course_total + cost, 2),
        "blockers": blockers,
        "_internal": {"provider": provider_name, "model": model},
    }


def _dry_run_clip(seconds: int, size: str) -> bytes:
    """ffmpeg synthetic test clip — exercises the FULL pipeline for free."""
    from services.video_store import _ffmpeg
    w, h = size.split("x")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "dry.mp4"
        subprocess.run(
            [_ffmpeg(), "-y", "-f", "lavfi",
             "-i", f"testsrc2=duration={seconds}:size={w}x{h}:rate=24",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)],
            capture_output=True, timeout=120, check=True)
        return out.read_bytes()


def _make_thumbnail(video_path: Path) -> bytes:
    from services.video_store import _ffmpeg
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "thumb.png"
        subprocess.run(
            [_ffmpeg(), "-y", "-ss", "0.5", "-i", str(video_path),
             "-frames:v", "1", str(out)],
            capture_output=True, timeout=60, check=True)
        return out.read_bytes()


async def _set(job_id: str, patch: dict):
    await db.ai_video_jobs.update_one({"id": job_id}, {"$set": patch})


async def _cancelled(job_id: str) -> bool:
    j = await db.ai_video_jobs.find_one({"id": job_id}, {"cancel_requested": 1})
    return bool(j and j.get("cancel_requested"))


async def recover_orphaned_jobs():
    """Resume jobs interrupted by a restart. Provider jobs re-enter the poll
    loop (create_job is skipped when provider_job_id exists); dry runs rerun."""
    rows = await db.ai_video_jobs.find(
        {"status": {"$in": list(ACTIVE_STATUSES)}}, {"id": 1}).to_list(50)
    for j in rows:
        log.info("resuming interrupted video job %s", j["id"])
        asyncio.create_task(_run_pipeline(j["id"]))


async def start_video_job(*, center_id: str, course_id: str, lesson_id: str,
                          block_id: str, prompt: str, seconds: int, size: str,
                          current: dict, negative_prompt: str = "",
                          style_profile: dict = None) -> dict:
    """All gates re-checked server-side; returns the created job doc."""
    est = await build_estimate(course_id, seconds, size)
    if est["blockers"]:
        raise ValueError(est["blockers"][0])
    prev = await db.ai_video_jobs.count_documents({"block_id": block_id})
    job = {
        "id": uuid.uuid4().hex, "status": "queued", "stage": "queued",
        "progress": 0, "error": None, "cancel_requested": False,
        "provider": est["_internal"]["provider"], "model": est["_internal"]["model"],
        "prompt": prompt[:2000], "negative_prompt": (negative_prompt or "")[:1000],
        "seconds": est["seconds"], "size": est["size"], "quality": est["quality"],
        "dry_run": est["dry_run"],
        "style_profile": style_profile if isinstance(style_profile, dict) else None,
        "production_prompt": None,
        "estimated_cost": est["estimated_cost"], "actual_cost": None, "seed": None,
        "provider_job_id": None, "video_url": None, "thumbnail_url": None,
        "version": prev + 1, "archived": False,
        "center_id": center_id, "course_id": course_id,
        "lesson_id": lesson_id, "block_id": block_id,
        "created_by": current["id"], "created_by_username": current.get("username"),
        "created_at": _iso(), "finished_at": None,
    }
    await db.ai_video_jobs.insert_one({**job})
    await audit(current, "video_generation_started", center_id=center_id,
                course_id=course_id, lesson_id=lesson_id, job_id=job["id"],
                detail=f"dry_run={est['dry_run']} cost=${est['estimated_cost']:.2f}")
    asyncio.create_task(_run_pipeline(job["id"]))
    job.pop("_id", None)
    return job


async def _run_pipeline(job_id: str):
    from services.video_store import video_dir
    from services.r2_mirror import mirror_to_cloud
    from services import image_store
    from services import responsibility_center as rc

    job = await db.ai_video_jobs.find_one({"id": job_id})
    p = get_provider(job["provider"])
    provider_job_id = job.get("provider_job_id")  # set = resuming after restart
    try:
        # ── Smart Video Prompt Engine — never send raw lesson text ───
        prod = job.get("production_prompt")
        if not prod:
            await _set(job_id, {"status": "generating", "stage": "designing_prompt"})
            from services.video_prompt_engine import build_production_prompt
            course = await db.rc_courses.find_one(
                {"id": job["course_id"]}, {"_id": 0, "title": 1, "grade_level": 1,
                                           "storyboard": 1, "style_profile": 1})
            lesson = await db.rc_course_lessons.find_one(
                {"id": job["lesson_id"]}, {"_id": 0, "title": 1, "blocks": 1})
            block = next((b for b in (lesson or {}).get("blocks", [])
                          if b.get("id") == job["block_id"]), None)
            profile = job.get("style_profile") or (course or {}).get("style_profile")
            prod = await build_production_prompt(
                user_prompt=job["prompt"], course=course, lesson=lesson,
                block=block, style_profile=profile, seconds=job["seconds"])
            await _set(job_id, {"production_prompt": prod})

        # ── Generating ────────────────────────────────────────────
        await _set(job_id, {"status": "generating", "stage": "generating"})
        if job["dry_run"]:
            raw = await asyncio.to_thread(_dry_run_clip, job["seconds"], job["size"])
        else:
            if not provider_job_id:
                provider_job_id = await p.create_job(prod, job["model"],
                                                     job["seconds"], job["size"])
                await _set(job_id, {"provider_job_id": provider_job_id})
            deadline = time.monotonic() + 1200
            while True:
                if await _cancelled(job_id):
                    raise asyncio.CancelledError()
                st = await p.poll(provider_job_id)
                await _set(job_id, {"progress": st.get("progress") or 0})
                if st["status"] == "completed":
                    break
                if st["status"] == "failed":
                    raise RuntimeError(st.get("error") or "Generation failed at the provider")
                if time.monotonic() > deadline:
                    raise RuntimeError("Generation timed out")
                await asyncio.sleep(6)
            # ── Downloading ───────────────────────────────────────
            await _set(job_id, {"status": "downloading", "stage": "downloading"})
            raw = await p.fetch_file(provider_job_id)
        if await _cancelled(job_id):
            raise asyncio.CancelledError()

        # ── Uploading to Cloudflare R2 (existing pipeline) ────────
        await _set(job_id, {"status": "uploading_r2", "stage": "uploading_r2"})
        filename = f"{uuid.uuid4().hex}.mp4"
        path = video_dir() / filename
        path.write_bytes(raw)
        url = await asyncio.to_thread(
            mirror_to_cloud, "videos", filename, path, f"/api/videos/{filename}")

        # ── Optimizing (thumbnail via existing image pipeline) ────
        await _set(job_id, {"status": "optimizing", "stage": "optimizing"})
        thumb_url = None
        try:
            thumb_bytes = await asyncio.to_thread(_make_thumbnail, path)
            rec = await image_store.save_bytes(thumb_bytes, job["created_by"], "image/png")
            thumb_url = rec.original_url
        except Exception as e:  # noqa: BLE001 — thumbnail is non-fatal
            log.warning("thumbnail generation failed: %s", e)

        # ── Attaching to lesson block ─────────────────────────────
        await _set(job_id, {"status": "attaching", "stage": "attaching"})
        await db.rc_course_lessons.update_one(
            {"id": job["lesson_id"], "blocks.id": job["block_id"]},
            {"$set": {"blocks.$.video_url": url,
                      "blocks.$.video_thumbnail": thumb_url,
                      "blocks.$.video_source": "generated",
                      "blocks.$.video_job_id": job_id,
                      "blocks.$.video_status": "ready",
                      "updated_at": _iso()}})
        actual = 0.0 if job["dry_run"] else job["estimated_cost"]
        await _set(job_id, {"status": "complete", "stage": "complete", "progress": 100,
                            "video_url": url, "thumbnail_url": thumb_url,
                            "actual_cost": actual, "finished_at": _iso()})
        if not job["dry_run"] and provider_job_id:
            await p.cleanup(provider_job_id)
        actor = {"id": job["created_by"], "username": job["created_by_username"]}
        await audit(actor, "video_generation_complete", center_id=job["center_id"],
                    course_id=job["course_id"], lesson_id=job["lesson_id"], job_id=job_id)
        await rc.notify_user(
            job["created_by"], "rc_course_video_ready",
            "Your lesson video is ready — open the course editor to preview it.",
            f"/responsibility-center/{job['center_id']}/courses/{job['course_id']}/edit",
            center_id=job["center_id"])
    except asyncio.CancelledError:
        await _set(job_id, {"status": "cancelled", "stage": "cancelled", "finished_at": _iso()})
        if provider_job_id:
            await p.cleanup(provider_job_id)
    except Exception as e:  # noqa: BLE001
        log.warning("video pipeline failed for %s: %s", job_id, e)
        await _set(job_id, {"status": "failed", "stage": "failed",
                            "error": str(e)[:300], "finished_at": _iso()})
        if provider_job_id:
            await p.cleanup(provider_job_id)
        try:
            await rc.notify_user(
                job["created_by"], "rc_course_video_failed",
                "A lesson video could not be generated — nothing was attached.",
                f"/responsibility-center/{job['center_id']}/courses/{job['course_id']}/edit",
                center_id=job["center_id"])
        except Exception:  # noqa: BLE001
            pass
