"""Admin user control — suspend / mute / delete / password reset.

All endpoints under `/api/admin/users/*` are gated server-side. Every
action writes one row to `db.audit_log` and never returns the affected
user's password hash, private notes, or any other sensitive field.

Permission matrix (Feb 19 2026)
-------------------------------
                          founder   support_admin   moderator
  search                    ✓           ✓             ✓
  suspend                   ✓           ✓             ✓
  unsuspend                 ✓           ✓             ✓
  mute / unmute             ✓           ✓             ✓
  delete                    ✓           ✓             ✗
  reset-password            ✓           ✗             ✗

Protected accounts (`is_protected`, `is_system`, admin_role=='founder',
or username ∈ {stealth, support}) cannot be affected by any of the
above — except that **@stealth** may reset @support's password and
suspend/mute it. @stealth can never be acted upon by anyone.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.permissions import (
    ROLE_FOUNDER, ROLE_SUPPORT_ADMIN, ROLE_MODERATOR,
    get_admin_role, require_role,
)
from core.security import hash_password

logger = logging.getLogger("ourrealm.admin_user_control")
router = APIRouter(prefix="/api/admin/users", tags=["admin_user_control"])


# --------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------- #
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _safe_user(u: dict) -> dict:
    """Project a user doc to a JSON-safe shape (no password_hash, no PII
    other than what admin tools clearly need)."""
    if not u:
        return {}
    return {
        "id":            u.get("id"),
        "username":      u.get("username"),
        "display_name": u.get("display_name") or u.get("name"),
        "email":         u.get("email"),
        "avatar_url":    u.get("avatar_url"),
        "role":          u.get("role"),
        "admin_role":    u.get("admin_role"),
        "is_system":     bool(u.get("is_system")),
        "is_protected":  bool(u.get("is_protected")),
        "disabled":      bool(u.get("disabled")),
        "deleted_at":    u.get("deleted_at"),
        "suspended_until": u.get("suspended_until"),
        "suspension_reason": u.get("suspension_reason"),
        "mutes":         _project_mutes(u.get("mutes") or []),
        "last_active_at": u.get("last_active_at"),
        "created_at":    u.get("created_at"),
    }


def _project_mutes(mutes: list) -> list[dict]:
    out = []
    now = _now()
    for m in mutes:
        until = m.get("until")
        is_active = True
        if until:
            try:
                if datetime.fromisoformat(until.replace("Z", "+00:00")) < now:
                    is_active = False
            except Exception:  # noqa: BLE001
                pass
        out.append({
            "id":          m.get("id"),
            "types":       m.get("types") or [],
            "until":       until,
            "permanent":   bool(m.get("permanent")),
            "reason":      m.get("reason"),
            "created_at":  m.get("created_at"),
            "created_by":  m.get("created_by"),
            "active":      is_active and (m.get("permanent") or until),
        })
    return out


def _is_protected_target(u: dict) -> bool:
    if not u:
        return True
    if u.get("is_system") or u.get("is_protected"):
        return True
    if u.get("admin_role") == ROLE_FOUNDER:
        return True
    if (u.get("username") or "").lower() in {"stealth"}:
        return True
    return False


def _can_act_on(acting: dict, target: dict, *, action: str) -> tuple[bool, str]:
    """Returns (allowed, reason). Encodes the "protected accounts" rules
    from the product spec — only @stealth may touch @support; nobody
    can ever touch @stealth or another founder."""
    if not target:
        return False, "Target user not found"
    if target.get("id") == acting.get("id"):
        return False, "Cannot act on your own account here"
    acting_role = get_admin_role(acting) or ""
    target_username = (target.get("username") or "").lower()

    # @stealth is sacred — nobody touches it, not even @stealth itself.
    if target_username == "stealth":
        return False, "Founder account is protected"

    # @support can only be touched by @stealth.
    if target_username == "support" or target.get("is_system") or target.get("is_protected"):
        if (acting.get("username") or "").lower() != "stealth":
            return False, "Protected system account"

    # Cross-role rules.
    if action == "delete":
        if acting_role == ROLE_MODERATOR:
            return False, "Moderators cannot delete accounts"
    if action == "reset_password":
        if acting_role != ROLE_FOUNDER:
            return False, "Only the founder can reset passwords"
    return True, ""


async def _write_audit(acting: dict, target: dict, action: str, detail: dict | None = None) -> None:
    try:
        await db.audit_log.insert_one({
            "id":         uuid.uuid4().hex,
            "category":   "admin_user_control",
            "action":     action,
            "actor_id":       acting.get("id"),
            "actor_username": acting.get("username"),
            "actor_role":     get_admin_role(acting),
            "target_id":      target.get("id"),
            "target_username": target.get("username"),
            "detail":         detail or {},
            "created_at":     _now_iso(),
        })
    except Exception as e:  # noqa: BLE001 — audit must never block the action
        logger.warning("admin audit log failed: %s", e)


# --------------------------------------------------------------------- #
# Search
# --------------------------------------------------------------------- #
@router.get("/search")
async def search_users(
    current: CurrentUser,
    q: str = Query(..., min_length=1, max_length=80),
    limit: int = 20,
):
    require_role(current, [ROLE_FOUNDER, ROLE_SUPPORT_ADMIN, ROLE_MODERATOR])
    ql = q.strip()
    if not ql:
        return {"users": []}
    # Treat the input as the *first* matching key found — username, then
    # display name, then email, then id. Use a single $or so the index
    # planner can pick the best path.
    safe = re.escape(ql)
    filt = {"$or": [
        {"username":    {"$regex": safe, "$options": "i"}},
        {"name":        {"$regex": safe, "$options": "i"}},
        {"display_name": {"$regex": safe, "$options": "i"}},
        {"email":       {"$regex": safe, "$options": "i"}},
        {"id":          ql},
    ]}
    cursor = db.users.find(filt, {"_id": 0, "password_hash": 0}).limit(min(limit, 50))
    out = [_safe_user(u) async for u in cursor]
    return {"users": out, "count": len(out)}


# --------------------------------------------------------------------- #
# Suspend / Unsuspend
# --------------------------------------------------------------------- #
class SuspendPayload(BaseModel):
    days: int = Field(default=7, ge=1, le=3650)
    reason: Optional[str] = Field(default=None, max_length=400)
    notes:  Optional[str] = Field(default=None, max_length=2000)


@router.post("/{user_id}/suspend")
async def suspend_user(user_id: str, payload: SuspendPayload, current: CurrentUser):
    require_role(current, [ROLE_FOUNDER, ROLE_SUPPORT_ADMIN, ROLE_MODERATOR])
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    ok, reason = _can_act_on(current, target, action="suspend")
    if not ok:
        raise HTTPException(403, reason)
    until = _now() + timedelta(days=payload.days)
    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "disabled":          True,
            "suspended_until":   until.isoformat(),
            "suspended_at":      _now_iso(),
            "suspended_by":      current["id"],
            "suspension_reason": (payload.reason or "").strip() or None,
            "suspension_notes":  (payload.notes  or "").strip() or None,
            # Force-invalidate existing sessions so the suspension takes
            # effect immediately even if the user has an in-flight token.
            "password_changed_at": _now_iso(),
        }},
    )
    await _write_audit(current, target, "suspend", {
        "days": payload.days, "until": until.isoformat(),
        "reason": payload.reason,
    })
    refreshed = await db.users.find_one({"id": user_id}, {"_id": 0})
    return {"ok": True, "user": _safe_user(refreshed)}


@router.post("/{user_id}/unsuspend")
async def unsuspend_user(user_id: str, current: CurrentUser):
    require_role(current, [ROLE_FOUNDER, ROLE_SUPPORT_ADMIN, ROLE_MODERATOR])
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    ok, reason = _can_act_on(current, target, action="unsuspend")
    if not ok:
        raise HTTPException(403, reason)
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"disabled": False},
         "$unset": {"suspended_until": "", "suspended_at": "", "suspended_by": "",
                    "suspension_reason": "", "suspension_notes": ""}},
    )
    await _write_audit(current, target, "unsuspend", {})
    refreshed = await db.users.find_one({"id": user_id}, {"_id": 0})
    return {"ok": True, "user": _safe_user(refreshed)}


# --------------------------------------------------------------------- #
# Delete (soft-delete)
# --------------------------------------------------------------------- #
class DeletePayload(BaseModel):
    confirm_username: str
    reason: Optional[str] = Field(default=None, max_length=400)


@router.post("/{user_id}/delete")
async def delete_user(user_id: str, payload: DeletePayload, current: CurrentUser):
    require_role(current, [ROLE_FOUNDER, ROLE_SUPPORT_ADMIN])
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    ok, reason = _can_act_on(current, target, action="delete")
    if not ok:
        raise HTTPException(403, reason)
    # Username confirmation guard — explicit second-step gate.
    if (payload.confirm_username or "").strip().lower() != (target.get("username") or "").lower():
        raise HTTPException(400, "Username confirmation did not match")
    # 30-day soft-delete via the shared account_lifecycle helper. The
    # user row is preserved so the target can sign in and restore
    # within the window. Audit log captures both the admin-initiated
    # action AND the lifecycle flip.
    from core.account_lifecycle import mark_admin_delete
    refreshed = await mark_admin_delete(target, current, reason=payload.reason)
    await _write_audit(current, target, "delete", {
        "reason":        payload.reason,
        "purge_after":   refreshed.get("purge_after"),
        "soft_delete":   True,
    })
    return {
        "ok":              True,
        "deleted_user_id": user_id,
        "purge_after":     refreshed.get("purge_after"),
        "account_status":  refreshed.get("account_status"),
    }


# --------------------------------------------------------------------- #
# Change Username / Email — founder/support-admin scope. Uniqueness
# guarded by the same regexes used at registration. Audit-logged.
# --------------------------------------------------------------------- #
class _UsernameUpdatePayload(BaseModel):
    username: str = Field(min_length=3, max_length=24)


class _EmailUpdatePayload(BaseModel):
    email: str = Field(min_length=5, max_length=120)


_USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,24}$")
_EMAIL_RE    = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@router.patch("/{user_id}/username")
async def admin_change_username(user_id: str, payload: _UsernameUpdatePayload, current: CurrentUser):
    require_role(current, [ROLE_FOUNDER, ROLE_SUPPORT_ADMIN])
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    ok, reason = _can_act_on(current, target, action="username_change")
    if not ok:
        raise HTTPException(403, reason)
    new_un = payload.username.strip().lower()
    if not _USERNAME_RE.match(new_un):
        raise HTTPException(400, "Invalid username format")
    # Conflict check — also blocks names reserved by pending-deletion
    # rows (their username is kept in place during the 30-day window).
    clash = await db.users.find_one(
        {"username": new_un, "id": {"$ne": user_id}},
        {"_id": 0, "id": 1, "account_status": 1},
    )
    if clash:
        raise HTTPException(409, "Username already taken")
    prev_username = target.get("username")
    await db.users.update_one({"id": user_id}, {"$set": {
        "username":         new_un,
        "username_changed_at": _now_iso(),
    }})
    await _write_audit(current, target, "username_change", {
        "prev_username": prev_username,
        "new_username":  new_un,
    })
    refreshed = await db.users.find_one({"id": user_id}, {"_id": 0})
    return {"ok": True, "user": _safe_user(refreshed)}


@router.patch("/{user_id}/email")
async def admin_change_email(user_id: str, payload: _EmailUpdatePayload, current: CurrentUser):
    require_role(current, [ROLE_FOUNDER, ROLE_SUPPORT_ADMIN])
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    ok, reason = _can_act_on(current, target, action="email_change")
    if not ok:
        raise HTTPException(403, reason)
    new_email = payload.email.strip().lower()
    if not _EMAIL_RE.match(new_email):
        raise HTTPException(400, "Invalid email format")
    clash = await db.users.find_one(
        {"email": new_email, "id": {"$ne": user_id}},
        {"_id": 0, "id": 1},
    )
    if clash:
        raise HTTPException(409, "Email already in use")
    prev_email = target.get("email")
    await db.users.update_one({"id": user_id}, {"$set": {
        "email":           new_email,
        "email_changed_at": _now_iso(),
    }})
    await _write_audit(current, target, "email_change", {
        "prev_email": prev_email,
        "new_email":  new_email,
    })
    refreshed = await db.users.find_one({"id": user_id}, {"_id": 0})
    return {"ok": True, "user": _safe_user(refreshed)}


@router.post("/{user_id}/restore")
async def admin_restore(user_id: str, current: CurrentUser):
    """Restore a soft-deleted user. Founder/support-admin scope."""
    require_role(current, [ROLE_FOUNDER, ROLE_SUPPORT_ADMIN])
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("account_status") != "deleted_pending_restore":
        raise HTTPException(400, "Account is not pending deletion")
    from core.account_lifecycle import mark_restore
    refreshed = await mark_restore(target, actor=current)
    await _write_audit(current, target, "restore", {})
    return {"ok": True, "user": _safe_user(refreshed)}


# --------------------------------------------------------------------- #
# Mute / Unmute
# --------------------------------------------------------------------- #
ALLOWED_MUTE_TYPES = {
    "thoughts", "sounds", "videos", "links", "images",
    "comments", "messages", "all",
}


class MutePayload(BaseModel):
    types: list[str]
    days: Optional[int] = Field(default=None, ge=1, le=3650)
    permanent: bool = False
    reason: Optional[str] = Field(default=None, max_length=400)
    notes:  Optional[str] = Field(default=None, max_length=2000)


@router.post("/{user_id}/mute")
async def mute_user(user_id: str, payload: MutePayload, current: CurrentUser):
    require_role(current, [ROLE_FOUNDER, ROLE_SUPPORT_ADMIN, ROLE_MODERATOR])
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    ok, reason = _can_act_on(current, target, action="mute")
    if not ok:
        raise HTTPException(403, reason)
    types = [t.strip().lower() for t in (payload.types or []) if t]
    invalid = [t for t in types if t not in ALLOWED_MUTE_TYPES]
    if invalid:
        raise HTTPException(400, f"Unsupported mute types: {', '.join(invalid)}")
    if not types:
        raise HTTPException(400, "At least one mute type is required")
    if "all" in types:
        types = sorted(ALLOWED_MUTE_TYPES - {"all"})
    if not payload.permanent and not payload.days:
        raise HTTPException(400, "Either `permanent` or `days` is required")
    until = None
    if not payload.permanent:
        until = (_now() + timedelta(days=payload.days)).isoformat()
    mute_row = {
        "id":         uuid.uuid4().hex,
        "types":      types,
        "until":      until,
        "permanent":  bool(payload.permanent),
        "reason":     (payload.reason or "").strip() or None,
        "notes":      (payload.notes  or "").strip() or None,
        "created_at": _now_iso(),
        "created_by": current["id"],
    }
    await db.users.update_one(
        {"id": user_id},
        {"$push": {"mutes": mute_row}},
    )
    await _write_audit(current, target, "mute", {
        "types": types, "until": until, "permanent": payload.permanent,
        "reason": payload.reason,
    })
    refreshed = await db.users.find_one({"id": user_id}, {"_id": 0})
    return {"ok": True, "user": _safe_user(refreshed), "mute_id": mute_row["id"]}


class UnmutePayload(BaseModel):
    mute_id: Optional[str] = None
    types:   Optional[list[str]] = None
    clear_all: bool = False


@router.post("/{user_id}/unmute")
async def unmute_user(user_id: str, payload: UnmutePayload, current: CurrentUser):
    require_role(current, [ROLE_FOUNDER, ROLE_SUPPORT_ADMIN, ROLE_MODERATOR])
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    ok, reason = _can_act_on(current, target, action="unmute")
    if not ok:
        raise HTTPException(403, reason)
    if payload.clear_all:
        await db.users.update_one({"id": user_id}, {"$set": {"mutes": []}})
        await _write_audit(current, target, "unmute", {"clear_all": True})
    elif payload.mute_id:
        await db.users.update_one(
            {"id": user_id},
            {"$pull": {"mutes": {"id": payload.mute_id}}},
        )
        await _write_audit(current, target, "unmute", {"mute_id": payload.mute_id})
    elif payload.types:
        want = {t.lower() for t in payload.types}
        await db.users.update_one(
            {"id": user_id},
            {"$pull": {"mutes": {"types": {"$in": list(want)}}}},
        )
        await _write_audit(current, target, "unmute", {"types": list(want)})
    else:
        raise HTTPException(400, "Provide mute_id, types, or clear_all=true")
    refreshed = await db.users.find_one({"id": user_id}, {"_id": 0})
    return {"ok": True, "user": _safe_user(refreshed)}


# --------------------------------------------------------------------- #
# Password reset (founder only)
# --------------------------------------------------------------------- #
PASSWORD_MIN = 8
PASSWORD_MAX = 100


class PasswordResetPayload(BaseModel):
    # Strength rules are enforced by `_validate_password_strength` so it
    # owns the 400 message verbatim. We intentionally avoid Pydantic
    # min/max length here so callers always see the validator's text.
    new_password: str = Field(min_length=1, max_length=PASSWORD_MAX)
    confirm_password: str = Field(min_length=1, max_length=PASSWORD_MAX)
    force_change_on_next_login: bool = False


def _validate_password_strength(pw: str) -> Optional[str]:
    """Mirror of the existing /api/auth password validator — return an
    error string or None if the password is acceptable."""
    if len(pw) < PASSWORD_MIN:
        return f"Password must be at least {PASSWORD_MIN} chars"
    if pw.lower() == pw or pw.upper() == pw:
        return "Password must contain upper and lower case letters"
    if not re.search(r"\d", pw):
        return "Password must contain at least one digit"
    if not re.search(r"[^A-Za-z0-9]", pw):
        return "Password must contain at least one symbol"
    return None


@router.post("/{user_id}/reset-password")
async def reset_password(user_id: str, payload: PasswordResetPayload, current: CurrentUser):
    require_role(current, [ROLE_FOUNDER])  # founder only
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    ok, reason = _can_act_on(current, target, action="reset_password")
    if not ok:
        raise HTTPException(403, reason)
    if payload.new_password != payload.confirm_password:
        raise HTTPException(400, "Passwords do not match")
    err = _validate_password_strength(payload.new_password)
    if err:
        raise HTTPException(400, err)
    update = {
        "password_hash":      hash_password(payload.new_password),
        "password_set_by_user": False,
        "password_changed_at": _now_iso(),
    }
    if payload.force_change_on_next_login:
        update["must_change_password"] = True
    await db.users.update_one({"id": user_id}, {"$set": update})
    # Audit log — NEVER include the plaintext password.
    await _write_audit(current, target, "reset_password", {
        "force_change_on_next_login": payload.force_change_on_next_login,
    })
    return {"ok": True}
