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
    return user


CurrentUser = Annotated[dict, Depends(get_current_user)]


# Admin gate — used by every /api/admin/* router. Both @stealth (founder)
# and @support (system account) have full admin access. Regular users
# never do. Keep this in one place so we can't drift across routers.
ADMIN_USERNAMES = {"stealth", "support"}


def is_admin_user(user: dict | None) -> bool:
    if not user:
        return False
    if user.get("is_founder"):
        return True
    if (user.get("role") or "").lower() == "admin":
        return True
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
