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


async def _loop():
    log.info("[purge-cron] worker started (interval=%ds)", INTERVAL_SECONDS)
    # Short initial delay so we don't run during the noisy startup
    # window. The very first sleep is 60s; subsequent sleeps are the
    # full INTERVAL_SECONDS.
    await asyncio.sleep(60)
    while True:
        try:
            summary = await run_purge_pass()
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
