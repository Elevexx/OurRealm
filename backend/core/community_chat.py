"""Community chat WebSocket registry — room-based fan-out.

Single-process design (matches the presence registry). Each community
chat (realm or group) is a *room* keyed by chat_id. Sockets subscribe
to a room when they connect and the chat router fans new messages /
typing events / title changes / member joins out to every subscriber.

The room registry is independent of the presence registry — a user may
have a presence socket open without being in any chat, and vice versa.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Iterable

from fastapi import WebSocket

logger = logging.getLogger("ourrealm.community_chat")

# room_id -> set[(user_id, ws)]
_rooms: dict[str, set[tuple[str, WebSocket]]] = {}
_lock = asyncio.Lock()


async def join(room_id: str, user_id: str, ws: WebSocket) -> None:
    async with _lock:
        _rooms.setdefault(room_id, set()).add((user_id, ws))


async def leave(room_id: str, user_id: str, ws: WebSocket) -> None:
    async with _lock:
        bucket = _rooms.get(room_id)
        if not bucket:
            return
        bucket.discard((user_id, ws))
        if not bucket:
            _rooms.pop(room_id, None)


def room_user_ids(room_id: str) -> set[str]:
    return {uid for uid, _ in _rooms.get(room_id, set())}


async def broadcast(room_id: str, msg: dict, exclude_ws: WebSocket | None = None) -> None:
    """Fan-out `msg` to every socket in the room except `exclude_ws`."""
    async with _lock:
        sockets = [ws for _, ws in _rooms.get(room_id, set()) if ws is not exclude_ws]
    for ws in sockets:
        try:
            await ws.send_json(msg)
        except Exception as e:  # noqa: BLE001
            logger.debug("community_chat broadcast send failed: %s", e)
