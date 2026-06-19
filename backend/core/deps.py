"""FastAPI dependencies — current user, brute-force lockout."""
from datetime import datetime, timezone, timedelta
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request

from .config import JWT_ALGORITHM, get_jwt_secret, LOCKOUT_THRESHOLD, LOCKOUT_MINUTES
from .db import db


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # Phase H — disabled accounts cannot authenticate any request.
    # Phase α (admin user control): a `suspended_until` field that has
    # already elapsed clears the disable + suspension fields so the
    # user is unlocked automatically on their next request.
    susp = user.get("suspended_until")
    if susp:
        try:
            until = datetime.fromisoformat(susp.replace("Z", "+00:00"))
            if until <= datetime.now(timezone.utc):
                await db.users.update_one(
                    {"id": user["id"]},
                    {"$set": {"disabled": False},
                     "$unset": {"suspended_until": "", "suspended_at": "",
                                "suspended_by": "", "suspension_reason": "",
                                "suspension_notes": ""}},
                )
                user["disabled"] = False
                user.pop("suspended_until", None)
        except Exception:
            pass
    if user.get("disabled"):
        # Surface a friendly suspended message when applicable so the
        # client can render it verbatim.
        if user.get("suspended_until"):
            raise HTTPException(
                status_code=401,
                detail=f"Account suspended until {user['suspended_until']}",
            )
        raise HTTPException(status_code=401, detail="Account disabled")
    # Phase α (admin user control): tokens issued before the user's
    # `password_changed_at` are invalid. This fires after a password
    # reset OR a forced suspension to nuke active sessions immediately.
    pc = user.get("password_changed_at")
    iat = payload.get("iat")
    if pc and iat:
        try:
            pc_ts = datetime.fromisoformat(pc.replace("Z", "+00:00")).timestamp()
            if int(iat) < int(pc_ts):
                raise HTTPException(status_code=401, detail="Session invalidated")
        except HTTPException:
            raise
        except Exception:
            pass
    return user


CurrentUser = Annotated[dict, Depends(get_current_user)]


# Admin gate — used by every /api/admin/* router.
# Phase α (Feb 2026) — role-based: see core.permissions for the per-role
# matrix. The legacy username allow-list (`@stealth`, `@support`) is kept
# as a safety net so a partially-seeded DB still gates admin endpoints.
# Loose `is_admin_user` / `require_admin` return True for ANY admin role;
# fine-grained routes should import gates from core.permissions instead
# (e.g. require_moderation_access, require_support_access, require_founder).
ADMIN_USERNAMES = {"stealth", "support"}


def is_admin_user(user: dict | None) -> bool:
    """True when the user has ANY admin role (founder / support_admin /
    moderator). Falls back to the username allow-list if `admin_role`
    isn't populated yet (defensive — first deploy hasn't run seed)."""
    from .permissions import get_admin_role
    if not user or user.get("disabled"):
        return False
    if get_admin_role(user):
        return True
    # Defensive fallback (pre-seed first boot only).
    return (user.get("username") or "").lower() in ADMIN_USERNAMES


def require_admin(user: dict) -> None:
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin only")


# ----- Brute-force lockout -----
async def check_lockout(identifier: str) -> None:
    record = await db.login_attempts.find_one({"identifier": identifier})
    if not record:
        return
    if record.get("count", 0) >= LOCKOUT_THRESHOLD:
        locked_until = record.get("locked_until")
        if locked_until and datetime.fromisoformat(locked_until) > datetime.now(timezone.utc):
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")


async def register_failed(identifier: str) -> None:
    record = await db.login_attempts.find_one({"identifier": identifier})
    count = (record.get("count", 0) if record else 0) + 1
    locked_until = (datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)).isoformat() if count >= LOCKOUT_THRESHOLD else None
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$set": {"identifier": identifier, "count": count, "locked_until": locked_until}},
        upsert=True,
    )


async def clear_attempts(identifier: str) -> None:
    await db.login_attempts.delete_one({"identifier": identifier})
