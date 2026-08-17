"""Configurable background retry engine for one-click course media packs.

Failed assets (cover / lesson image / lesson video) are persisted in
rc_media_retry_tasks and retried on the configurable schedule in
ai_video_settings.retry_schedule_seconds (default 20s / 2m / 5m / 15m / 30m).
Restart-safe: the worker only reads the DB, so generation resumes after
browser refresh, reconnects, deployments and server/app restarts.
After the final attempt an asset is marked needs_attention (exact provider
error preserved) and can be re-queued manually (selected or all)."""
import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone, timedelta

from core.db import db

log = logging.getLogger("ourrealm.media.retry")
DEFAULT_SCHEDULE = [20, 120, 300, 900, 1800]
PENDING = ("waiting", "retrying")


def _iso(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()


def _in(seconds):
    return _iso(datetime.now(timezone.utc) + timedelta(seconds=seconds))


async def get_schedule() -> list:
    from services.video_generation import get_video_settings
    s = await get_video_settings()
    sched = s.get("retry_schedule_seconds") or DEFAULT_SCHEDULE
    return [max(5, int(x)) for x in sched][:10] or DEFAULT_SCHEDULE


async def enqueue(*, gen_job_id, center_id, course_id, asset_type, label, prompt,
                  created_by, created_by_username=None, lesson_id=None,
                  block_id=None, error="") -> str:
    """Register a failed asset for automatic background retry (idempotent per asset)."""
    key = {"course_id": course_id, "asset_type": asset_type,
           "lesson_id": lesson_id, "block_id": block_id}
    existing = await db.rc_media_retry_tasks.find_one({**key, "status": {"$in": list(PENDING)}})
    if existing:
        return existing["id"]
    sched = await get_schedule()
    doc = {"id": uuid.uuid4().hex, **key, "gen_job_id": gen_job_id, "center_id": center_id,
           "label": str(label)[:120], "prompt": str(prompt or "")[:2500],
           "status": "waiting", "attempt": 0, "max_attempts": len(sched),
           "next_retry_at": _in(sched[0]), "last_error": str(error)[:500] or None,
           "provider": None, "video_job_id": None,
           "created_by": created_by, "created_by_username": created_by_username,
           "created_at": _iso(), "updated_at": _iso()}
    await db.rc_media_retry_tasks.insert_one({**doc})
    log.info("media retry queued: %s (%s) — first retry in %ss", label, asset_type, sched[0])
    return doc["id"]


async def requeue(course_id: str, task_ids: list = None) -> int:
    """Manual retry (selected or all failed): fresh attempt cycle, runs now."""
    q = {"course_id": course_id, "status": {"$in": ["needs_attention", "waiting"]}}
    if task_ids:
        q["id"] = {"$in": [str(t) for t in task_ids][:50]}
    r = await db.rc_media_retry_tasks.update_many(
        q, {"$set": {"status": "waiting", "attempt": 0,
                     "next_retry_at": _iso(), "updated_at": _iso()}})
    return r.modified_count


async def cancel_for_job(gen_job_id: str) -> int:
    r = await db.rc_media_retry_tasks.update_many(
        {"gen_job_id": gen_job_id, "status": {"$in": list(PENDING)}},
        {"$set": {"status": "cancelled", "updated_at": _iso()}})
    return r.modified_count


async def course_tasks(course_id: str) -> list:
    return await db.rc_media_retry_tasks.find(
        {"course_id": course_id}, {"_id": 0, "prompt": 0}).sort("created_at", 1).to_list(100)


# ── Worker ───────────────────────────────────────────────────────────────
_started = False


async def start_retry_worker():
    """Started once at startup — reclaims tasks interrupted by a restart."""
    global _started
    if _started:
        return
    _started = True
    try:
        await db.rc_media_retry_tasks.update_many(
            {"status": "retrying"},
            {"$set": {"status": "waiting", "next_retry_at": _iso(), "updated_at": _iso()}})
    except Exception as e:  # noqa: BLE001
        log.warning("media retry recovery failed: %s", e)
    asyncio.create_task(_loop())
    log.info("media retry worker started")


async def _loop():
    while True:
        try:
            due = await db.rc_media_retry_tasks.find(
                {"status": "waiting", "next_retry_at": {"$lte": _iso()}},
                {"_id": 0, "id": 1}).to_list(20)
            for t in due:
                claimed = await db.rc_media_retry_tasks.find_one_and_update(
                    {"id": t["id"], "status": "waiting"},
                    {"$set": {"status": "retrying", "updated_at": _iso()}},
                    return_document=True)
                if claimed:
                    claimed.pop("_id", None)
                    asyncio.create_task(_run_task(claimed))
        except Exception as e:  # noqa: BLE001
            log.warning("media retry loop error: %s", e)
        await asyncio.sleep(15)


async def _run_task(task):
    sched = await get_schedule()
    attempt = int(task.get("attempt") or 0) + 1
    try:
        if task["asset_type"] in ("cover", "image"):
            await _retry_image(task)
        else:
            await _retry_video(task, attempt)
        await db.rc_media_retry_tasks.update_one(
            {"id": task["id"]},
            {"$set": {"status": "done", "attempt": attempt, "last_error": None,
                      "finished_at": _iso(), "updated_at": _iso()}})
        await _bump_gen_job(task)
        log.info("media retry succeeded: %s (attempt %s)", task["label"], attempt)
    except Exception as e:  # noqa: BLE001
        err = str(e)[:500] or "failed"
        log.warning("media retry attempt %s failed for %s: %s", attempt, task["label"], err)
        if attempt >= len(sched):
            done = await db.rc_media_retry_tasks.update_one(
                {"id": task["id"], "status": "retrying"},
                {"$set": {"status": "needs_attention", "attempt": attempt,
                          "last_error": err, "updated_at": _iso()}})
            if done.modified_count:
                await _notify_attention(task, err)
        else:
            await db.rc_media_retry_tasks.update_one(
                {"id": task["id"], "status": "retrying"},
                {"$set": {"status": "waiting", "attempt": attempt, "last_error": err,
                          "next_retry_at": _in(sched[min(attempt, len(sched) - 1)]),
                          "updated_at": _iso()}})


async def _retry_image(task):
    from routers.rc_courses import _gen_image
    url = await _gen_image(task["prompt"], task["created_by"], retries=0)
    if task["asset_type"] == "cover":
        await db.rc_courses.update_one({"id": task["course_id"]}, {"$set": {"cover_url": url}})
    else:
        await db.rc_course_lessons.update_one(
            {"id": task["lesson_id"], "blocks.id": task["block_id"]},
            {"$set": {"blocks.$.image_url": url, "updated_at": _iso()}})


async def _retry_video(task, attempt):
    """Retry with provider failover: rotates through generation providers in
    priority order when a provider keeps failing."""
    from services import video_generation as vg
    from services.video_providers import generation_providers
    s = await vg.get_video_settings()
    prio = s.get("provider_priority") or []
    gens = sorted(generation_providers(),
                  key=lambda p: prio.index(p.name) if p.name in prio else 99)
    provider = gens[(attempt - 1) % len(gens)].name if gens else None
    course = await db.rc_courses.find_one({"id": task["course_id"]}, {"_id": 0, "style_profile": 1})
    current = {"id": task["created_by"], "username": task.get("created_by_username")}
    job = await vg.start_video_job(
        center_id=task["center_id"], course_id=task["course_id"],
        lesson_id=task["lesson_id"], block_id=task["block_id"],
        prompt=task["prompt"], seconds=int(s.get("default_seconds") or 4),
        size=s.get("default_size"), current=current,
        style_profile=(course or {}).get("style_profile"), provider_name=provider)
    await db.rc_media_retry_tasks.update_one(
        {"id": task["id"]}, {"$set": {"video_job_id": job["id"], "provider": provider}})
    deadline = time.monotonic() + 1500
    while time.monotonic() < deadline:
        await asyncio.sleep(8)
        j = await db.ai_video_jobs.find_one({"id": job["id"]}, {"status": 1, "error": 1})
        if not j:
            raise RuntimeError("Video job disappeared")
        if j["status"] == "complete":
            return
        if j["status"] in ("failed", "cancelled"):
            raise RuntimeError(j.get("error") or "Video generation failed")
    raise RuntimeError("Video generation timed out")


async def _bump_gen_job(task):
    if not task.get("gen_job_id"):
        return
    field = "images" if task["asset_type"] in ("cover", "image") else "videos"
    try:
        await db.rc_course_gen_jobs.update_one(
            {"id": task["gen_job_id"]},
            {"$inc": {f"media.{field}.done": 1, f"media.{field}.failed": -1}})
    except Exception:  # noqa: BLE001
        pass


async def _notify_attention(task, err):
    try:
        from services import responsibility_center as rc
        await rc.notify_user(
            task["created_by"], "rc_course_media_attention",
            f"\"{task['label']}\" needs attention — all automatic retries failed: {err[:120]}",
            f"/responsibility-center/{task['center_id']}/course-maker",
            center_id=task["center_id"])
    except Exception:  # noqa: BLE001
        pass
