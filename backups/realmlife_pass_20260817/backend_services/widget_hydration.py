"""Widget registry helpers used at the profile/home/realm serialization
boundary. Registry-launched widgets (Phase 2A/3.5+) live in
`db.widget_registry` and can be referenced by user `widgets[]` entries
via either the hardcoded TYPE (notes/music/…) or the registry KEY
(e.g. ``stealth_ai_a1b``).

This module exposes two helpers:

  • ``valid_widget_types(extra=None) -> set[str]``
        The union of ``ALLOWED_WIDGET_TYPES`` and every live
        registry key. Cached for 30 s to avoid hammering Mongo on
        every save / read.

  • ``hydrate_registry_widgets(widgets, viewer=None)``
        For each saved widget whose type/key matches a live registry
        entry, merge in ``editor_config`` (and a few presentational
        fields like ``name`` and ``icon``) from the registry. Honors
        the registry's access_groups so restricted widgets never leak
        to a viewer without the right group. Returns a NEW list — the
        input is never mutated.
"""
from __future__ import annotations
import asyncio
import time
from typing import Any, Iterable, List, Optional, Set

from core.db import db
from core.widget_types import ALLOWED_WIDGET_TYPES


_CACHE_TTL_SECONDS = 30
_STAMP_COLLECTION = "widget_registry_stamps"
_STAMP_DOC_ID = "live_widgets"
_cache: dict[str, Any] = {"ts": 0.0, "stamp": None, "keys": set(), "by_key": {}}
_lock = asyncio.Lock()


async def _current_stamp() -> Optional[str]:
    """Fetch the cross-process invalidation stamp from Mongo. Any
    process that mutates the registry bumps this and any reader will
    notice on its next call even if its in-memory TTL hasn't expired."""
    try:
        doc = await db[_STAMP_COLLECTION].find_one({"_id": _STAMP_DOC_ID})
        return (doc or {}).get("stamp")
    except Exception:
        return None


async def _refresh_cache() -> None:
    """Read every live widget from the registry once and cache by key."""
    cursor = db.widget_registry.find(
        {"status": "live"},
        {"_id": 0, "key": 1, "name": 1, "icon": 1, "type": 1,
         "editor_config": 1, "access_groups": 1, "default_size": 1,
         "description": 1, "category": 1},
    )
    by_key: dict[str, dict] = {}
    async for doc in cursor:
        k = (doc.get("key") or "").strip()
        if k:
            by_key[k] = doc
    _cache["by_key"] = by_key
    _cache["keys"] = set(by_key.keys())
    _cache["ts"] = time.monotonic()
    _cache["stamp"] = await _current_stamp()


async def _ensure_cache() -> None:
    # Fast path — same stamp + warm cache + not yet TTL-expired.
    if (time.monotonic() - _cache["ts"]) < _CACHE_TTL_SECONDS:
        cur = await _current_stamp()
        if cur == _cache["stamp"]:
            return
    async with _lock:
        cur = await _current_stamp()
        if (time.monotonic() - _cache["ts"]) < _CACHE_TTL_SECONDS and cur == _cache["stamp"]:
            return
        await _refresh_cache()


def invalidate_widget_registry_cache() -> None:
    """Force the next call to reload from Mongo. Called by admin save/clone/
    delete paths so newly-launched widgets are immediately available.
    Bumps a Mongo-side stamp so OTHER worker processes (and tests that
    seed via a separate subprocess) also pick up the change on their
    next read."""
    _cache["ts"] = 0.0
    # Fire-and-forget the Mongo stamp bump. Synchronous wrapper because
    # this is called from sync code paths in some routers; we schedule
    # the coroutine on the running loop when there is one.
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_bump_stamp())
        else:
            loop.run_until_complete(_bump_stamp())
    except Exception:
        # No event loop? Skip the cross-process bump — local cache is
        # already invalidated via ts=0 which is the important bit.
        pass


async def _bump_stamp() -> None:
    new_stamp = f"{time.time_ns()}"
    try:
        await db[_STAMP_COLLECTION].update_one(
            {"_id": _STAMP_DOC_ID},
            {"$set": {"stamp": new_stamp}},
            upsert=True,
        )
    except Exception:
        pass


async def bump_widget_registry_stamp() -> None:
    """Async helper for callers that have an event loop and want to
    deterministically bump the cross-process stamp before they return."""
    _cache["ts"] = 0.0
    await _bump_stamp()


async def valid_widget_types(extra: Optional[Iterable[str]] = None) -> Set[str]:
    """Return the set of widget identifiers that user.widgets[i].type
    is allowed to reference."""
    await _ensure_cache()
    out = set(ALLOWED_WIDGET_TYPES)
    out.update(_cache["keys"])
    if extra:
        out.update(extra)
    return out


def _viewer_groups(viewer: Optional[dict]) -> Set[str]:
    """Mirror of admin_widgets._viewer_groups — duplicated here to avoid
    a circular import from routers/admin_widgets.py."""
    groups = {"all_users"}
    if not viewer:
        return groups
    groups.add("standard")
    if viewer.get("is_vip"):
        groups.add("vip")
    if (viewer.get("username") or "").lower() == "stealth":
        groups.update({"admin", "founder"})
    if viewer.get("is_admin") or viewer.get("role") in ("admin", "moderator", "founder"):
        groups.add("admin")
    if viewer.get("role") == "founder":
        groups.add("founder")
    return groups


async def hydrate_registry_widgets(
    widgets: Optional[List[dict]],
    *,
    viewer: Optional[dict] = None,
) -> List[dict]:
    """For each saved widget, if its `type` (or `key`) maps to a live
    registry entry, merge the registry's editor_config / name / icon
    onto the widget so the frontend can render it without a second
    network call. Widgets that fail the access_groups check are
    dropped — the viewer literally has no permission to see them.

    Hardcoded-type widgets (notes/music/podcasts/…) pass through
    unchanged."""
    if not widgets:
        return []
    await _ensure_cache()
    by_key = _cache["by_key"]
    groups = _viewer_groups(viewer)
    out: List[dict] = []
    for w in widgets:
        if not isinstance(w, dict):
            continue
        t = (w.get("type") or "").strip()
        k = (w.get("key") or "").strip() or t
        # Hardcoded type — always allow, never hydrate.
        if t in ALLOWED_WIDGET_TYPES:
            out.append(w)
            continue
        # Registry-launched widget — look up by key.
        reg = by_key.get(k) or by_key.get(t)
        if not reg:
            # Stale reference (widget deleted or disabled) — drop.
            continue
        reg_groups = set(reg.get("access_groups") or [])
        if reg_groups and not (groups & reg_groups):
            # Viewer is not in any of the widget's access groups.
            continue
        merged = dict(w)
        merged.setdefault("key", reg.get("key"))
        # Only fill in fields the user-saved entry didn't already specify
        # — never clobber per-user data (size, position, etc.).
        if not merged.get("editor_config"):
            merged["editor_config"] = reg.get("editor_config")
        if not merged.get("name"):
            merged["name"] = reg.get("name")
        if not merged.get("icon"):
            merged["icon"] = reg.get("icon")
        # Carry the registry's intrinsic widget `type` so the frontend
        # can dispatch into ChatLayout / CardLayout / StatLayout / … via
        # the editor_config.layout field.
        merged["registry_type"] = reg.get("type")
        out.append(merged)
    return out


def filter_widgets_for_storage(widgets: Iterable[dict], allowed: Set[str]) -> List[dict]:
    """Save-time filter: drop any widget whose type isn't in `allowed`.
    Replaces the old strict ALLOWED_WIDGET_TYPES-only check so registry
    keys (e.g. ``stealth_ai_a1b``) survive a save."""
    out: List[dict] = []
    for w in widgets or []:
        if not isinstance(w, dict):
            continue
        t = (w.get("type") or "").strip()
        if t in allowed:
            out.append(w)
    return out


__all__ = [
    "valid_widget_types",
    "hydrate_registry_widgets",
    "filter_widgets_for_storage",
    "invalidate_widget_registry_cache",
    "bump_widget_registry_stamp",
]
