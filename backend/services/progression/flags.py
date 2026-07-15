"""Progression feature flags — backend-controlled, all user-facing OFF by default.
Stored in a singleton doc so production can be toggled without redeploys.
"""
import time
from core.db import db

FLAG_KEYS = ["display", "events", "calculations", "notifications", "claims", "rewards", "builder", "analytics"]
DEFAULTS = {k: False for k in FLAG_KEYS}
DEFAULTS["builder"] = True          # founder-only page; backend auth still enforced
DEFAULTS["calculations"] = True     # engine may compute; user display stays gated

_cache = {"at": 0.0, "flags": None}


async def get_flags() -> dict:
    now = time.monotonic()
    if _cache["flags"] is not None and now - _cache["at"] < 5:
        return _cache["flags"]
    doc = await db.progression_flags.find_one({"_id": "flags"}) or {}
    flags = {**DEFAULTS, **{k: bool(doc.get(k)) for k in FLAG_KEYS if k in doc}}
    _cache.update(at=now, flags=flags)
    return flags


async def set_flag(key: str, value: bool, updated_by: str) -> dict:
    if key not in FLAG_KEYS:
        raise ValueError(f"Unknown flag: {key}")
    from datetime import datetime, timezone
    await db.progression_flags.update_one(
        {"_id": "flags"},
        {"$set": {key: bool(value), "updated_by": updated_by,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    _cache["flags"] = None
    return await get_flags()
