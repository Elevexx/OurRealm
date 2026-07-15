"""Durable, idempotent progression events + app-event ingestion."""
import logging
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError
from core.db import db
from services.progression.registry import ALLOWED_APP_EVENT_KEYS
from services.progression.flags import get_flags

log = logging.getLogger("ourrealm.progression.events")


def _now():
    return datetime.now(timezone.utc)


async def record_event(user_id: str, event_key: str, object_id: str | None = None,
                       source_user_id: str | None = None, source: str = "server",
                       once_per: str = "object") -> bool:
    """Insert an event with a deterministic id so replays/duplicates are no-ops.
    once_per: 'object' | 'day' | 'forever'."""
    now = _now()
    day = now.date().isoformat()
    if once_per == "day":
        eid = f"{user_id}:{event_key}:{object_id or ''}:{day}"
    elif once_per == "forever":
        eid = f"{user_id}:{event_key}:{object_id or ''}"
    else:
        eid = f"{user_id}:{event_key}:{object_id or ''}"
    doc = {
        "event_id": eid, "event_key": event_key, "user_id": user_id,
        "object_id": object_id, "source_user_id": source_user_id,
        "event_day": day, "source": source, "status": "processed",
        "retry_count": 0, "error": None,
        "event_at": now.isoformat(), "received_at": now.isoformat(),
        "processed_at": now.isoformat(),
    }
    try:
        await db.progression_events.insert_one(doc)
        return True
    except DuplicateKeyError:
        return False


async def ingest_app_event(user: dict, event_key: str, object_id: str | None = None) -> dict:
    """Authenticated client event — allowlisted keys only, server timestamps,
    deduped. Rejects everything else."""
    if event_key not in ALLOWED_APP_EVENT_KEYS:
        return {"ok": False, "error": "Event key not allowed."}
    if object_id is not None and (not isinstance(object_id, str) or len(object_id) > 120):
        return {"ok": False, "error": "Invalid object id."}
    once = "day" if event_key in ("daily_task_completed",) else "object"
    inserted = await record_event(user["id"], event_key, object_id, source="app", once_per=once)
    flags = await get_flags()
    if inserted and flags.get("events"):
        try:
            from services.progression.engine import recalc_user
            await recalc_user(user, persist=True, source=f"event:{event_key}")
        except Exception:
            log.exception("event-driven recalc failed")
    return {"ok": True, "deduplicated": not inserted}


async def notify(user_id: str, event_key: str, object_id: str | None = None,
                 source_user_id: str | None = None) -> None:
    """Server-side hook for existing routes (post created, friend added, …).
    Never raises; recalc only when the events flag is on."""
    try:
        inserted = await record_event(user_id, event_key, object_id,
                                      source_user_id=source_user_id, source="server")
        flags = await get_flags()
        if inserted and flags.get("events"):
            user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
            if user:
                from services.progression.engine import recalc_user
                await recalc_user(user, persist=True, source=f"event:{event_key}")
    except Exception:
        log.exception("progression notify failed (non-fatal)")
