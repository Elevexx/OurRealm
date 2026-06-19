"""Password hashing, JWT helpers, cookie management."""
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
from fastapi import Response

from .config import (
    JWT_ALGORITHM, ACCESS_TOKEN_MINUTES, REFRESH_TOKEN_DAYS, get_jwt_secret,
)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    return jwt.encode(
        {
            "sub": user_id,
            "email": email,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES),
            "type": "access",
        },
        get_jwt_secret(), algorithm=JWT_ALGORITHM,
    )


def create_refresh_token(user_id: str) -> str:
    return jwt.encode(
        {
            "sub": user_id,
            "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS),
            "type": "refresh",
        },
        get_jwt_secret(), algorithm=JWT_ALGORITHM,
    )


def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    # Cookie security profile is driven by env so that local HTTP dev still
    # works while production HTTPS gets `Secure; HttpOnly; SameSite=Lax`.
    #   COOKIE_SECURE   — "true" | "false"  (default: true)
    #   COOKIE_SAMESITE — "lax" | "strict"  (default: lax)
    import os as _os
    secure   = _os.environ.get("COOKIE_SECURE",   "true").lower() != "false"
    samesite = _os.environ.get("COOKIE_SAMESITE", "lax").lower()
    if samesite not in {"lax", "strict", "none"}:
        samesite = "lax"
    response.set_cookie(
        "access_token", access_token, httponly=True, secure=secure, samesite=samesite,
        max_age=ACCESS_TOKEN_MINUTES * 60, path="/",
    )
    response.set_cookie(
        "refresh_token", refresh_token, httponly=True, secure=secure, samesite=samesite,
        max_age=REFRESH_TOKEN_DAYS * 24 * 3600, path="/",
    )
