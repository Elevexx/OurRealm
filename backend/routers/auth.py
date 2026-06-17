"""Authentication endpoints (/api/auth/*)."""
import logging
import secrets
import uuid
from datetime import datetime, timezone, timedelta

import jwt
from fastapi import APIRouter, HTTPException, Request, Response

from core.config import (
    JWT_ALGORITHM, ACCESS_TOKEN_MINUTES, get_jwt_secret, FOUNDER_USERNAME,
    VIP_CUTOFF, default_myfeed_widget,
)
from core.db import db
from core.deps import (
    CurrentUser, check_lockout, register_failed, clear_attempts,
)
from core.security import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    set_auth_cookies,
)
from models.schemas import (
    RegisterPayload, LoginPayload, UsernameCheck, ForgotPayload,
    ResetPayload, OtpRequest, OtpVerify, serialize_user,
)

logger = logging.getLogger("ourrealm.auth")
router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register")
async def register(payload: RegisterPayload, response: Response):
    email = payload.email.lower().strip()
    username = payload.username.lower().strip()
    # ── Phase-1 compliance gate ──
    # Reject registration if the user did not check the four required
    # acknowledgements on the signup form. Returns a clear 400 detail so
    # the frontend can surface a precise validation message.
    if not (payload.accepted_terms and payload.accepted_privacy
            and payload.accepted_conditions and payload.age_confirmed_13):
        raise HTTPException(
            status_code=400,
            detail="You must accept the Terms of Service, Terms & Conditions, "
                   "Privacy Policy, and confirm you are at least 13 years old.",
        )
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    if await db.users.find_one({"username": username}):
        raise HTTPException(status_code=400, detail="Username already taken")

    user_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()

    # ── VIP / Early-Adopter ──
    # Anyone registered while total users < VIP_CUTOFF receives a
    # permanent VIP badge. Once reached, no new VIP grants.
    current_count = await db.users.count_documents({})
    is_vip = current_count < VIP_CUTOFF

    doc = {
        "id": user_id,
        "email": email,
        "username": username,
        "password_hash": hash_password(payload.password),
        "name": payload.name.strip(),
        "role": "user",
        "avatar_url": None,
        "bio": "",
        "interests": [],
        "mode": "neon",
        # New accounts get the My Feed widget as the first/top widget.
        "widgets": [default_myfeed_widget()],
        # ── ID-BASED FRIEND GRAPH ──
        "friends": [],
        "friend_requests_in": [],
        "friend_requests_out": [],
        "pinned_threads": [],
        # ── VIP ──
        "is_vip": is_vip,
        "vip_joined_at": now_iso if is_vip else None,
        # Phase C — Presence
        "presence_status": "offline",
        "presence_status_choice": "online",
        "presence_last_seen": now_iso,
        "follower_count": 0,
        # ── Friend groups (placeholder for future feature; safe no-op) ──
        "friend_groups": [],
        "social": {},
        "created_at": now_iso,
        # ── Compliance audit trail ──
        "compliance": {
            "accepted_terms": True,
            "accepted_privacy": True,
            "accepted_conditions": True,
            "age_confirmed_13": True,
            "policy_version": payload.policy_version or "2026-02-1",
            "accepted_at": now_iso,
        },
    }
    await db.users.insert_one(doc)

    # Auto-friend the founder ("stealth") by user_id for every new user
    founder = await db.users.find_one({"username": FOUNDER_USERNAME})
    if founder and founder["id"] != user_id:
        await db.users.update_one(
            {"id": user_id}, {"$addToSet": {"friends": founder["id"]}}
        )
        await db.users.update_one(
            {"id": founder["id"]}, {"$addToSet": {"friends": user_id}}
        )

    # Phase B — also auto-friend the protected @support account so every
    # new user can immediately DM support from /profile/support.
    support = await db.users.find_one({"username": "support"})
    if support and support["id"] != user_id:
        await db.users.update_one({"id": user_id}, {"$addToSet": {"friends": support["id"]}})
        await db.users.update_one({"id": support["id"]}, {"$addToSet": {"friends": user_id}})
        doc["friends"] = list(set(doc["friends"] + [support["id"]]))

    access = create_access_token(user_id, email)
    refresh = create_refresh_token(user_id)
    set_auth_cookies(response, access, refresh)
    return {"user": serialize_user(doc), "access_token": access}


@router.post("/username/check")
async def username_check(payload: UsernameCheck):
    u = payload.username.lower().strip()
    reserved = {"admin", "support", "ourrealm", "realm", "founder", "system"}
    if u in reserved:
        return {"available": False, "reason": "reserved",
                "suggestions": [f"{u}_x", f"the.{u}", f"{u}.hq"]}
    existing = await db.users.find_one({"username": u})
    if not existing:
        return {"available": True}
    import random as _r
    return {"available": False, "suggestions": [
        f"{u}{_r.randint(10, 99)}", f"{u}_hq", f"the.{u}", f"{u}.realm"
    ]}


@router.post("/login")
async def login(payload: LoginPayload, request: Request, response: Response):
    identifier_raw = payload.email.strip()
    is_email = "@" in identifier_raw
    lookup = identifier_raw.lower()
    ip = request.client.host if request.client else "unknown"
    rate_key = f"{ip}:{lookup}"
    await check_lockout(rate_key)

    if is_email:
        user = await db.users.find_one({"email": lookup})
    else:
        user = await db.users.find_one({"username": lookup})
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        await register_failed(rate_key)
        raise HTTPException(status_code=401, detail="Invalid email/username or password")

    await clear_attempts(rate_key)
    access = create_access_token(user["id"], user.get("email", ""))
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return {"user": serialize_user(user), "access_token": access}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@router.get("/me")
async def me(current: CurrentUser):
    return {"user": serialize_user(current)}


@router.post("/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    access = create_access_token(user["id"], user["email"])
    response.set_cookie(
        "access_token", access, httponly=True, secure=False, samesite="lax",
        max_age=ACCESS_TOKEN_MINUTES * 60, path="/",
    )
    return {"access_token": access}


# ----- OTP (founder displayed-OTP login) -----
@router.post("/otp/request")
async def otp_request(payload: OtpRequest):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="No account for this email")
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    await db.otp_codes.update_one(
        {"email": email},
        {"$set": {
            "email": email,
            "code": code,
            "used": False,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        }},
        upsert=True,
    )
    logger.info(f"[OTP] {email} -> {code}")
    return {"ok": True, "displayed_otp": code, "expires_in": 600}


@router.post("/otp/verify")
async def otp_verify(payload: OtpVerify, response: Response):
    email = payload.email.lower().strip()
    rec = await db.otp_codes.find_one({"email": email})
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    exp = rec.get("expires_at")
    if isinstance(exp, str):
        exp = datetime.fromisoformat(exp)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Code expired")
    if rec.get("code") != payload.code.strip():
        raise HTTPException(status_code=400, detail="Invalid code")
    await db.otp_codes.update_one({"email": email}, {"$set": {"used": True}})
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    access = create_access_token(user["id"], email)
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return {"user": serialize_user(user), "access_token": access}


# ----- Password recovery -----
@router.post("/forgot-password")
async def forgot_password(payload: ForgotPayload):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if user:
        token = secrets.token_urlsafe(32)
        await db.password_reset_tokens.insert_one({
            "token": token,
            "user_id": user["id"],
            "used": False,
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        })
        logger.info(f"[Password reset] {email} -> token: {token}")
    return {"ok": True, "message": "If the email exists, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(payload: ResetPayload):
    rec = await db.password_reset_tokens.find_one({"token": payload.token})
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    expires_at = rec.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Token expired")
    await db.users.update_one(
        {"id": rec["user_id"]},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    await db.password_reset_tokens.update_one(
        {"token": payload.token}, {"$set": {"used": True}}
    )
    return {"ok": True}
