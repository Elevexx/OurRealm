"""Background scheduler for the account permanent-delete cron.

Run cadence: once per hour. Single asyncio task lifecycle-managed by
the FastAPI app's startup / shutdown hooks. The task is intentionally
tiny — it just calls `run_purge_pass()` and sleeps. All real work
lives in `core.account_lifecycle`.

Why an in-process asyncio task instead of a Celery / cron-job pod?
  • Account purge volume is single-digit-per-hour at our scale.
  • Idempotency is enforced by the lifecycle helper itself, so two
    workers running by accident is harmless.
  • Zero extra moving parts in production.

Operational notes:
  • The task is started by `server.py` via `start_purge_scheduler()`
    and cancelled cleanly on shutdown.
  • Failures are logged with full traceback BUT never crash the
    loop — a 5-minute back-off prevents tight retries on a
    persistent error (e.g. Mongo unreachable).
  • Structured logs use the `[purge-cron]` tag so production
    monitoring can grep cleanly without revealing PII.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from core.account_lifecycle import run_purge_pass

log = logging.getLogger("ourrealm.purge_cron")

# 1 hour between successful passes. Override at boot via the
# OURREALM_PURGE_INTERVAL_SECONDS env var if you ever need to make
# the test environment faster.
INTERVAL_SECONDS = 60 * 60
ERROR_BACKOFF_SECONDS = 5 * 60

_task: Optional[asyncio.Task] = None


async def _closure_expiry_warnings():
    """Notify users whose recoverable-closure window ends within 7 days
    (once per account)."""
    from datetime import datetime, timedelta, timezone
    from core.db import db
    now = datetime.now(timezone.utc)
    soon = (now + timedelta(days=7)).isoformat()
    async for u in db.users.find(
            {"account_status": "deleted_pending_restore",
             "purge_after": {"$lte": soon, "$gt": now.isoformat()},
             "closure_expiry_warned": {"$ne": True}},
            {"_id": 0, "id": 1, "email": 1, "purge_after": 1}).limit(100):
        try:
            from routers.notifications import emit_notification
            await emit_notification(u["id"], "account_closure_expiring",
                                    actor_username="system",
                                    payload={"purge_after": u.get("purge_after")})
            from services.mailer import send_email
            await send_email(
                u.get("email") or "",
                "Your closed OurRealm account will be permanently deleted soon",
                "Your recovery window ends soon. Sign back in before "
                f"{(u.get('purge_after') or '')[:10]} if you want to keep your account.",
                kind="closure_expiring", user_id=u["id"])
            await db.users.update_one({"id": u["id"]},
                                      {"$set": {"closure_expiry_warned": True}})
        except Exception:  # noqa: BLE001
            log.exception("[purge-cron] expiry warning failed for %s", u.get("id"))


async def _loop():
    log.info("[purge-cron] worker started (interval=%ds)", INTERVAL_SECONDS)
    # Short initial delay so we don't run during the noisy startup
    # window. The very first sleep is 60s; subsequent sleeps are the
    # full INTERVAL_SECONDS.
    await asyncio.sleep(60)
    while True:
        try:
            summary = await run_purge_pass()
            # Companion hourly passes (each independent + best-effort):
            # privacy-deadline escalation reminders, expiring-closure
            # warnings, data-export file expiry.
            try:
                from services.privacy_requests import run_reminder_pass
                await run_reminder_pass()
            except Exception:  # noqa: BLE001
                log.exception("[purge-cron] reminder pass failed")
            try:
                await _closure_expiry_warnings()
            except Exception:  # noqa: BLE001
                log.exception("[purge-cron] expiry-warning pass failed")
            try:
                from services.data_export import run_export_expiry_pass
                await run_export_expiry_pass()
            except Exception:  # noqa: BLE001
                log.exception("[purge-cron] export expiry pass failed")
            if summary["purged"] or summary["failed"]:
                # Only log when something happened — keeps the log
                # quiet during the long stretches when no rows are
                # due for purge.
                log.info("[purge-cron] pass complete: %s", summary)
            else:
                log.debug("[purge-cron] pass complete (idle): %s", summary)
            await asyncio.sleep(INTERVAL_SECONDS)
        except asyncio.CancelledError:
            log.info("[purge-cron] worker cancelled")
            raise
        except Exception:  # noqa: BLE001 — never crash the loop
            log.exception("[purge-cron] pass failed — backing off")
            await asyncio.sleep(ERROR_BACKOFF_SECONDS)


def start_purge_scheduler() -> None:
    global _task
    if _task and not _task.done():
        log.warning("[purge-cron] start_purge_scheduler called twice — ignoring")
        return
    _task = asyncio.create_task(_loop(), name="purge_cron")


async def stop_purge_scheduler() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
        try:
            await _task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    _task = None
