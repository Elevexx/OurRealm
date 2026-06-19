"""account_lifecycle — 30-day soft-delete + restore lifecycle.

Contract (matches the Feb 19 2026 product spec):

  • `mark_self_delete(user)` and `mark_admin_delete(user, actor)` both
    flip a user into the `deleted_pending_restore` lifecycle state.
    The row is preserved verbatim so the user (or an admin) can
    restore the account within the 30-day window.

  • While in `deleted_pending_restore`:
        - `disabled = True` so the user can't be tagged, friended,
          searched, or surfaced in suggestions (the rest of the app
          already filters disabled users out).
        - Public-profile lookups must 404 — handled by
          `should_hide_from_public(user)`.
        - Login is permitted (auth.py opts-out of the disabled gate
          for pending-deletion accounts) but the response carries
          `restore_required: True` so the client can render the
          restore prompt instead of the normal app shell.
        - The username remains reserved on the user row — username
          / email uniqueness checks elsewhere automatically refuse to
          mint a duplicate.

  • `mark_restore(user)` clears the lifecycle fields and resets
    `disabled=False`. Audit-logged.

  • `purge_after = deleted_at + 30 days` is a *hint* for future
    permanent-deletion batch jobs. This module never runs destructive
    cleanup; that lives in a separate cron / migration when policy
    is finalised. Helpers `is_purge_due(user)` and the read-only
    `pending_deletion_meta(user)` are provided for that future job.

  • Audit log entries:
        - `account.self_delete`   actor = user themselves
        - `account.admin_delete`  actor = admin
        - `account.restore`       actor = the user OR the admin
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional, Any
import uuid

from core.db import db

# Public lifecycle status string. Stored on the user doc.
STATUS_DELETED_PENDING = "deleted_pending_restore"

# How long after `deleted_at` until the permanent-delete cron may
# touch the row. Kept here so future cron jobs share the value.
RESTORE_WINDOW_DAYS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def is_pending_deletion(user: dict | None) -> bool:
    return bool(user) and user.get("account_status") == STATUS_DELETED_PENDING


def should_hide_from_public(user: dict | None) -> bool:
    """Public profile lookups, search, suggestions, etc. all rely on
    this single predicate. Pending-deletion users disappear from every
    public surface; the soft-delete is opaque to other members."""
    if not user:
        return True
    if user.get("disabled"):
        return True
    if is_pending_deletion(user):
        return True
    return False


def pending_deletion_meta(user: dict | None) -> dict[str, Any] | None:
    if not is_pending_deletion(user):
        return None
    return {
        "deleted_at":            user.get("deleted_at"),
        "deletion_scheduled_at": user.get("deletion_scheduled_at"),
        "purge_after":           user.get("purge_after"),
        "account_status":        user.get("account_status"),
    }


def is_purge_due(user: dict | None) -> bool:
    if not is_pending_deletion(user):
        return False
    purge_after = user.get("purge_after")
    if not purge_after:
        return False
    try:
        dt = datetime.fromisoformat(purge_after.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return False
    return _now() >= dt


async def mark_self_delete(user: dict) -> dict:
    """Flip the user into pending-deletion. Idempotent."""
    return await _do_soft_delete(user, actor_id=user["id"], actor_kind="self", reason=None)


async def mark_admin_delete(
    user: dict,
    actor: dict,
    reason: Optional[str] = None,
) -> dict:
    """Flip the user into pending-deletion. Audit-logged with the admin actor."""
    return await _do_soft_delete(
        user, actor_id=actor["id"], actor_kind="admin", reason=reason, actor_user=actor.get("username"),
    )


async def _do_soft_delete(
    user: dict,
    *,
    actor_id: str,
    actor_kind: str,
    reason: Optional[str],
    actor_user: Optional[str] = None,
) -> dict:
    if is_pending_deletion(user):
        return user
    now = _now()
    purge_after = (now + timedelta(days=RESTORE_WINDOW_DAYS)).isoformat()
    update = {
        "$set": {
            "account_status":        STATUS_DELETED_PENDING,
            "deleted_at":            now.isoformat(),
            "deletion_scheduled_at": now.isoformat(),
            "purge_after":           purge_after,
            "deleted_by":            actor_id,
            "deletion_reason":       (reason or "").strip() or None,
            # `disabled` keeps the existing search / suggestions /
            # tagging filters working unchanged.
            "disabled":              True,
            # Force-invalidate any active refresh tokens so the deleted
            # session no longer minted new access tokens.
            "password_changed_at":   now.isoformat(),
        },
    }
    await db.users.update_one({"id": user["id"]}, update)
    refreshed = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or {}

    try:
        await db.audit_log.insert_one({
            "id":         uuid.uuid4().hex,
            "action":     "account.self_delete" if actor_kind == "self" else "account.admin_delete",
            "actor_id":   actor_id,
            "actor_user": actor_user,
            "target_id":  user["id"],
            "target_user": user.get("username"),
            "reason":     reason,
            "purge_after": purge_after,
            "at":         now.isoformat(),
        })
    except Exception:  # noqa: BLE001 — audit log never blocks
        pass
    return refreshed


async def mark_restore(user: dict, actor: Optional[dict] = None) -> dict:
    """Clear pending-deletion. Returns the refreshed user doc.

    Idempotent: if the user wasn't pending deletion, returns it as-is.
    """
    if not is_pending_deletion(user):
        return user
    actor_id = (actor or user)["id"]
    actor_user = (actor or user).get("username")
    now_iso = _now_iso()
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set":   {"disabled": False, "account_status": "active"},
            "$unset": {
                "deleted_at":            "",
                "deletion_scheduled_at": "",
                "purge_after":           "",
                "deleted_by":            "",
                "deletion_reason":       "",
            },
        },
    )
    refreshed = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or {}
    try:
        await db.audit_log.insert_one({
            "id":         uuid.uuid4().hex,
            "action":     "account.restore",
            "actor_id":   actor_id,
            "actor_user": actor_user,
            "target_id":  user["id"],
            "target_user": user.get("username"),
            "at":         now_iso,
        })
    except Exception:  # noqa: BLE001
        pass
    return refreshed
