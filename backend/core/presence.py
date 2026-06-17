"""In-process WebSocket presence registry.

Single-process / single-pod design — every connected user holds one or
more WebSocket sockets in `_conns`. The registry exposes:

    • connect(user_id, ws)         — register a socket
    • disconnect(user_id, ws)      — remove a socket
    • online_user_ids()            — set of currently-connected user ids
    • broadcast(user_ids, msg)     — fan-out a JSON message
    • is_online(user_id)           — bool

The registry is process-local. With Kubernetes pod restarts the in-memory
sockets are dropped naturally; clients reconnect via the existing
auto-reconnect path on the frontend.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Iterable

from fastapi import WebSocket

logger = logging.getLogger("ourrealm.presence")

# user_id -> set[WebSocket]
_conns: dict[str, set[WebSocket]] = {}
_lock = asyncio.Lock()


async def connect(user_id: str, ws: WebSocket) -> None:
    async with _lock:
        _conns.setdefault(user_id, set()).add(ws)


async def disconnect(user_id: str, ws: WebSocket) -> None:
    async with _lock:
        bucket = _conns.get(user_id)
        if not bucket:
            return
        bucket.discard(ws)
        if not bucket:
            _conns.pop(user_id, None)


def online_user_ids() -> set[str]:
    return set(_conns.keys())


def is_online(user_id: str) -> bool:
    return user_id in _conns and len(_conns[user_id]) > 0


async def broadcast(user_ids: Iterable[str], msg: dict) -> None:
    """Send `msg` (JSON-serialisable) to every active socket of the given users."""
    targets: list[WebSocket] = []
    async with _lock:
        for uid in user_ids:
            for ws in list(_conns.get(uid, [])):
                targets.append(ws)
    # send outside the lock to avoid contention
    for ws in targets:
        try:
            await ws.send_json(msg)
        except Exception as e:
            logger.warning("presence broadcast failed: %s", e)
