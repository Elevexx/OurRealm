"""Sliding-window rate limiter (Phase 3.2).

Replaces the fixed-minute Mongo bucket used in Phase 3. Stores only
timestamps in an in-memory deque per key; old entries are evicted
lazily on each check. No Redis dependency — works in single-pod
deployments. For multi-pod horizontal scale, Redis or Mongo TTL
collections could be swapped in by re-implementing `_storage_*`
helpers; the public API stays the same.

Why sliding window:
  At fixed-minute boundaries (e.g. :59 → :00), the old window
  resets and a caller can drain a fresh quota immediately,
  effectively doubling the limit at that boundary. Sliding window
  fixes this by counting only the requests within the trailing
  `window_seconds` from now, on every check.

Usage:
    res = await rate_limit("widget:abc:burst", max_requests=30, window_seconds=60)
    if not res["allowed"]:
        raise HTTPException(429, detail={"error":"rate_limit_exceeded", "retry_after": res["retry_after"]})
    # res also contains limit, remaining, reset_in (seconds until oldest entry falls out)

The caller is responsible for translating the result into HTTP
headers — the limiter is pure logic so it stays testable.

A small `db.rate_limit_events` collection captures 429s + samples
for the Admin Analytics view. Stored docs auto-expire after 24h
via a TTL index seeded by ensure_indexes().
"""
from __future__ import annotations
import asyncio
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Deque, Dict, Optional

from core.db import db

# Global in-memory state.
_BUCKETS: Dict[str, Deque[float]] = {}
_LOCKS: Dict[str, asyncio.Lock] = {}
_GLOBAL_LOCK = asyncio.Lock()
_LAST_GC = 0.0
_GC_INTERVAL = 60.0   # seconds between bucket cleanups


async def _lock_for(key: str) -> asyncio.Lock:
    """Per-key asyncio.Lock so concurrent checks for the same key
    don't race the deque append/evict."""
    lk = _LOCKS.get(key)
    if lk is not None:
        return lk
    async with _GLOBAL_LOCK:
        lk = _LOCKS.get(key)
        if lk is None:
            lk = asyncio.Lock()
            _LOCKS[key] = lk
        return lk


async def _maybe_gc(now: float) -> None:
    """Periodically remove empty buckets so the dict doesn't grow
    unboundedly with unique keys."""
    global _LAST_GC  # noqa: PLW0603
    if (now - _LAST_GC) < _GC_INTERVAL:
        return
    async with _GLOBAL_LOCK:
        if (now - _LAST_GC) < _GC_INTERVAL:
            return
        _LAST_GC = now
        # Snapshot keys to avoid mutation during iteration.
        for k in list(_BUCKETS.keys()):
            dq = _BUCKETS.get(k)
            if dq is not None and len(dq) == 0:
                _BUCKETS.pop(k, None)
                _LOCKS.pop(k, None)


async def rate_limit(
    key: str,
    *,
    max_requests: int,
    window_seconds: int,
    record_denied_event: bool = True,
    event_meta: Optional[Dict] = None,
) -> Dict:
    """Apply sliding-window rate limit.

    Returns:
        {
          "allowed": bool,
          "limit": int,
          "remaining": int,
          "reset_in": int,        # seconds until the oldest counted request falls out
          "retry_after": int,     # seconds to wait before retrying (only meaningful when allowed=False)
        }
    """
    now = time.time()
    await _maybe_gc(now)
    lock = await _lock_for(key)
    async with lock:
        dq = _BUCKETS.setdefault(key, deque())
        cutoff = now - window_seconds
        # Evict timestamps that have aged out of the window.
        while dq and dq[0] <= cutoff:
            dq.popleft()

        if len(dq) >= max_requests:
            # Denied — compute when the oldest entry will fall out.
            retry_after = max(1, int(window_seconds - (now - dq[0])))
            res = {
                "allowed": False,
                "limit": max_requests,
                "remaining": 0,
                "reset_in": retry_after,
                "retry_after": retry_after,
            }
        else:
            dq.append(now)
            res = {
                "allowed": True,
                "limit": max_requests,
                "remaining": max_requests - len(dq),
                "reset_in": int(window_seconds - (now - dq[0])) if dq else window_seconds,
                "retry_after": 0,
            }

    # Persist denied events for the Admin Analytics view (best-effort,
    # never blocks the limiter — TTL'd 24h).
    if not res["allowed"] and record_denied_event:
        try:
            ev = {
                "key": key,
                "ts": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(hours=24),
            }
            if event_meta:
                ev.update(event_meta)
            await db.rate_limit_events.insert_one(ev)
        except Exception:  # noqa: BLE001
            pass
    return res


async def ensure_indexes() -> None:
    await db.rate_limit_events.create_index("expires_at", expireAfterSeconds=0)
    await db.rate_limit_events.create_index("ts")
    await db.rate_limit_events.create_index("key")


# ─────────────────────────────────────────────────────────────────────
# Admin analytics aggregations
# ─────────────────────────────────────────────────────────────────────

async def aggregate_recent_denials(hours: int = 24, limit: int = 100) -> Dict:
    """Returns a roll-up of recent rate-limit denials for /admin/analytics."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    cursor = db.rate_limit_events.find({"ts": {"$gte": since}})
    rows = [d async for d in cursor]
    total = len(rows)
    by_key: Dict[str, int] = {}
    by_user: Dict[str, int] = {}
    by_ip: Dict[str, int] = {}
    by_endpoint: Dict[str, int] = {}
    for r in rows:
        by_key[r.get("key", "?")] = by_key.get(r.get("key", "?"), 0) + 1
        if r.get("user"):
            by_user[r["user"]] = by_user.get(r["user"], 0) + 1
        if r.get("ip"):
            by_ip[r["ip"]] = by_ip.get(r["ip"], 0) + 1
        if r.get("endpoint"):
            by_endpoint[r["endpoint"]] = by_endpoint.get(r["endpoint"], 0) + 1
    def top(d):
        return sorted([{"name": k, "count": v} for k, v in d.items()], key=lambda x: -x["count"])[:limit]
    return {
        "window_hours": hours,
        "total_429s": total,
        "top_keys": top(by_key),
        "top_users": top(by_user),
        "top_ips": top(by_ip),
        "top_endpoints": top(by_endpoint),
    }


__all__ = ["rate_limit", "ensure_indexes", "aggregate_recent_denials"]
