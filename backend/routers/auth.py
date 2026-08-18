"""Authentication endpoints (/api/auth/*)."""
import hashlib
import logging
import os
import secrets
import uuid
from datetime import datetime, timezone, timedelta

import jwt
from fastapi import APIRouter, HTTPException, Request, Response

from core.config import (
    JWT_ALGORITHM, ACCESS_TOKEN_MINUTES, get_jwt_secret, FOUNDER_USERNAME,
    default_myfeed_widget, default_top8_widget,
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
from services.widget_hydration import hydrate_registry_widgets

logger = logging.getLogger("ourrealm.auth")
router = APIRouter(prefix="/api/auth", tags=["auth"])


async def record_signup_event(ok: bool, category: str, status_code: int,
                              email: str = "", detail: str = ""):
    """Signup health telemetry — no passwords, no tokens, no raw PII.
    Only the email domain + a truncated hash are stored for correlation."""
    import hashlib
    try:
        domain = email.split("@")[-1].lower() if "@" in (email or "") else ""
        await db.signup_events.insert_one({
            "id": uuid.uuid4().hex,
            "at": datetime.now(timezone.utc).isoformat(),
            "ok": ok,
            "category": category,
            "status_code": status_code,
            "email_domain": domain,
            "email_hash": hashlib.sha256((email or "").lower().encode()).hexdigest()[:12] if email else None,
            "detail": (detail or "")[:200],
        })
    except Exception:  # noqa: BLE001 — telemetry never blocks signup
        pass


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
        await record_signup_event(False, "compliance_missing", 400, email)
        raise HTTPException(
            status_code=400,
            detail="You must accept the Terms of Service, Terms & Conditions, "
                   "Privacy Policy, and confirm you are at least 13 years old.",
        )
    # ── Signup Access Mode gate (server-side, immediate) ──
    from services.waitlist import get_signup_mode, validate_invite, consume_invite
    _mode = (await get_signup_mode())["mode"]
    _invited = None
    if payload.invite_token:
        try:
            _invited = await validate_invite(payload.invite_token)
        except ValueError as _e:
            await record_signup_event(False, "invalid_invite", 403, email)
            raise HTTPException(status_code=403, detail=str(_e))
        if _invited["email"] != email:
            await record_signup_event(False, "invite_email_mismatch", 403, email)
            raise HTTPException(status_code=403, detail="This invitation was issued for a different email.")
        if _invited["username"] != username:
            raise HTTPException(status_code=403, detail={
                "code": "invite_username", "message":
                f"This invitation reserves @{_invited['username']} — use that username."})
    if _mode in ("existing_only", "maintenance"):
        await record_signup_event(False, f"signup_mode_{_mode}", 403, email)
        raise HTTPException(status_code=403, detail={
            "code": "signups_paused",
            "message": "New registrations are currently disabled."})
    if _mode in ("waitlist", "invite_only") and not _invited:
        await record_signup_event(False, f"signup_mode_{_mode}", 403, email)
        raise HTTPException(status_code=403, detail={
            "code": "signups_paused",
            "message": "New signups require a reservation. Join the waitlist to reserve your username."})
    # Legacy pause flag (kept for back-compat with older admin toggle)
    _sg = await db.platform_settings.find_one({"id": "signup"}, {"_id": 0})
    if (_sg and _sg.get("allow_new_signups") is False and _mode == "open"):
        await record_signup_event(False, "signups_paused", 403, email)
        raise HTTPException(status_code=403, detail={
            "code": "signups_paused",
            "message": "New signups are temporarily paused. You can reserve your spot below."})
    # ── Teen/Adult age gate (optional birth_date, YYYY-MM-DD) ──
    account_type = "adult"
    birth_date = (payload.birth_date or "").strip()[:10] or None
    if birth_date:
        from services.guardian_control import compute_age
        _age = compute_age(birth_date)
        if _age is None:
            await record_signup_event(False, "invalid_birth_date", 400, email)
            raise HTTPException(status_code=400, detail="Please enter a valid date of birth.")
        if _age < 13:
            await record_signup_event(False, "under_13", 400, email)
            raise HTTPException(status_code=400,
                                detail="OurRealm accounts currently require users to be at least 13.")
        if _age < 18:
            account_type = "teen"
    if await db.users.find_one({"email": email}):
        await record_signup_event(False, "duplicate_email", 400, email)
        raise HTTPException(status_code=400, detail="This email is already registered. Try logging in instead.")
    if await db.users.find_one({"username": username}):
        await record_signup_event(False, "duplicate_username", 400, email)
        raise HTTPException(status_code=400, detail="That username is unavailable. Please choose another.")
    # Waitlist reservation protection — a username actively reserved by
    # someone else cannot be claimed at open signup.
    _held = await db.waitlist_reservations.find_one(
        {"username": username,
         "status": {"$nin": ["withdrawn", "denied", "account_created"]}},
        {"_id": 0, "email": 1})
    if _held and _held.get("email") != email and not _invited:
        await record_signup_event(False, "username_reserved", 409, email)
        raise HTTPException(status_code=409, detail="That username is reserved on the waitlist. Please choose another.")

    # Premium Usernames — server-side signup gate (rules + premium length + NPC seq)
    from routers.premium_usernames import signup_gate, post_signup_npc
    _pu_gate = await signup_gate(username)
    if _pu_gate and _invited and _invited.get("premium_approved"):
        _pu_gate = None  # Founder-approved premium unlock via invitation
    if _pu_gate:
        await record_signup_event(False, _pu_gate.get("category", "premium_locked"), 422, email)
        raise HTTPException(status_code=422, detail={
            "message": _pu_gate["message"], "suggestions": _pu_gate.get("suggestions") or []})

    user_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()

    # ── VIP / Early-Adopter ──
    # VIP is now derived exclusively from the live `vip` entry in
    # `badge_registry` (auto_rule='first_1000', cap = first_x). The user
    # doc starts with `is_vip=False`; the registry-driven block below
    # flips it to True and stamps `vip_joined_at` when the new signup
    # qualifies. This consolidates the previous hardcoded VIP_CUTOFF
    # branch onto a single, admin-controllable source of truth.

    doc = {
        "id": user_id,
        "email": email,
        "username": username,
        "password_hash": hash_password(payload.password),
        "name": payload.name.strip(),
        "role": "user",
        "age_class": account_type,
        "birth_date": birth_date,
        "avatar_url": None,
        "bio": "",
        "interests": [],
        # Spec: new accounts start in Neon mode by default, but the
        # signup flow may pre-select a mode — honour that when valid.
        "mode": (payload.mode if (payload.mode or "").lower() in {"neon", "business", "millennium", "stealth"} else "neon"),
        # New accounts get the My Feed widget as the first/top widget.
        # New-user default widget layout per spec (Feb 20, 2026):
        # Top 8 first, then For You feed (myfeed). The "+ Add New
        # Widget" affordance is rendered by Profile.jsx separately, so
        # it is NOT a data-driven widget here.
        "widgets": [default_top8_widget(), default_myfeed_widget()],
        # ── ID-BASED FRIEND GRAPH ──
        "friends": [],
        "friend_requests_in": [],
        "friend_requests_out": [],
        "pinned_threads": [],
        # ── VIP ──
        # Defaults to False; the badge-registry block below promotes
        # the new user when the live VIP badge has capacity.
        "is_vip": False,
        "vip_joined_at": None,
        # Phase C — Presence
        "presence_status": "offline",
        "presence_status_choice": "online",
        "presence_last_seen": now_iso,
        "follower_count": 0,
        # ── Friend groups (placeholder for future feature; safe no-op) ──
        "friend_groups": [],
        "social": {},
        "created_at": now_iso,
        # ── Analytics eligibility (June 2026 data audit) ──
        # Durable flags so every admin metric can distinguish real
        # registered humans from system/demo/test accounts.
        "account_type": "human",
        "is_synthetic": False,
        "analytics_eligible": True,
        "signup_completed": True,
        "email_verified": False,
        # ── Compliance audit trail ──
        "compliance": {
            "accepted_terms": True,
            "accepted_privacy": True,
            "accepted_conditions": True,
            "age_confirmed_13": True,
            "policy_version": payload.policy_version or "2026-02-18",
            "accepted_at": now_iso,
        },
    }
    from pymongo.errors import DuplicateKeyError
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        # Race: two simultaneous signups with the same email/username —
        # the unique index wins where the pre-check couldn't.
        await record_signup_event(False, "duplicate_race", 409, email)
        raise HTTPException(status_code=409, detail="This email or username was just registered. Try logging in.")

    try:
        # Waitlist invitation — mark reservation completed + carry the
        # approved verification category onto the new account.
        if _invited:
            try:
                await consume_invite(payload.invite_token, user_id)
                _vc = (_invited.get("verification") or {}).get("category")
                _sets = {"waitlist_invited": True}
                if (_invited.get("verification") or {}).get("status") == "approved" or \
                        ((_invited.get("verification") or {}).get("status") == "submitted"):
                    if _vc:
                        _sets["waitlist_verification_category"] = _vc
                        _sets["waitlist_verified"] = (_invited.get("verification") or {}).get("status") == "approved" or True
                await db.users.update_one({"id": user_id}, {"$set": _sets})
            except Exception:  # noqa: BLE001
                pass
        # Premium Usernames — consume NPC_# sequence number now that the
        # user doc insert succeeded (numbers are never reused).
        try:
            await post_signup_npc(username, user_id)
        except Exception:  # noqa: BLE001
            pass
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

        # ── VIP first_1000 — single source of truth ──
        # The live `vip` badge in badge_registry controls VIP grants.
        # Wrapped in try/except so a badge hiccup never blocks signup.
        try:
            vip_badge = await db.badge_registry.find_one({"key": "vip", "status": "live"})
            if vip_badge and (vip_badge.get("auto_rule") == "first_1000"):
                cap = int(vip_badge.get("first_x") or 1000)
                current_holders = await db.user_badges.count_documents({"badge_key": "vip"})
                if current_holders < cap:
                    await db.user_badges.update_one(
                        {"user_id": user_id, "badge_key": "vip"},
                        {"$setOnInsert": {
                            "id": f"{user_id}::vip",
                            "user_id": user_id,
                            "username": payload.username.lower(),
                            "badge_key": "vip",
                            "assigned_by": "system",
                            "assigned_at": now_iso,
                            "source": "first_1000",
                        }},
                        upsert=True,
                    )
                    await db.users.update_one(
                        {"id": user_id},
                        {"$set": {"is_vip": True, "vip_joined_at": now_iso}},
                    )
                    doc["is_vip"] = True
                    doc["vip_joined_at"] = now_iso
        except Exception:
            logger.exception("VIP first_1000 auto-grant failed for user_id=%s", user_id)

        access = create_access_token(user_id, email)
        refresh = create_refresh_token(user_id)
        set_auth_cookies(response, access, refresh)
    except HTTPException:
        raise
    except Exception:
        # Roll back the partially-created account so failed signups never
        # linger in the DB (and never inflate member counts).
        logger.exception("Signup post-insert failure — rolling back user %s", user_id)
        await db.users.delete_one({"id": user_id})
        await db.user_badges.delete_many({"user_id": user_id})
        await db.users.update_many({}, {"$pull": {"friends": user_id}})
        await record_signup_event(False, "server_error", 500, email)
        raise HTTPException(
            status_code=500,
            detail="A temporary server problem prevented account creation. Please try again in a moment.",
        )

    await record_signup_event(True, "success", 200, email)
    # Founding VIP — assign permanent member number + eligibility (no deposits).
    try:
        from services import founding_vip as _fvip
        await _fvip.on_new_registration(user_id)
    except Exception:
        pass
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
        # Premium Usernames — reflect the live server-side gate in the
        # signup availability check so the form shows the lock + options.
        from routers.premium_usernames import signup_gate
        gate = await signup_gate(u)
        if gate:
            return {"available": False, "reason": gate.get("category", "premium_locked"),
                    "message": gate["message"],
                    "suggestions": gate.get("suggestions") or []}
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

    # Phase H — hard-block the legacy admin email regardless of password.
    # This account was previously seeded with a hardcoded credential pair
    # and has been neutralised. No code path may ever re-issue tokens for
    # it. Logged for the security audit trail.
    if is_email and lookup == "admin@ourrealm.app":
        try:
            await db.audit_log.insert_one({
                "kind": "blocked_legacy_admin_login",
                "ip": ip,
                "at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
        await register_failed(rate_key)
        raise HTTPException(status_code=401, detail="Invalid email/username or password")

    if is_email:
        user = await db.users.find_one({"email": lookup})
    else:
        user = await db.users.find_one({"username": lookup})
    # Auto-resolve elapsed suspensions on login (mirrors get_current_user).
    if user and user.get("suspended_until"):
        try:
            until = datetime.fromisoformat(user["suspended_until"].replace("Z", "+00:00"))
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
    # Refuse login for any account marked disabled (covers the legacy
    # admin and any future banned accounts) — UNLESS the user is in
    # the 30-day pending-deletion restore window. Those accounts are
    # permitted to authenticate so the client can show the restore
    # prompt instead of a hard "account suspended" error.
    if user and user.get("disabled") and user.get("account_status") != "deleted_pending_restore":
        try:
            await db.audit_log.insert_one({
                "kind": "blocked_disabled_login",
                "user_id": user.get("id"),
                "ip": ip,
                "at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
        await register_failed(rate_key)
        # Surface the suspension end date when available so the client
        # can render the spec-mandated message.
        susp_until = user.get("suspended_until")
        if susp_until:
            raise HTTPException(status_code=401, detail=f"Account suspended until {susp_until}")
        raise HTTPException(status_code=401, detail="Invalid email/username or password")
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        await register_failed(rate_key)
        raise HTTPException(status_code=401, detail="Invalid email/username or password")

    await clear_attempts(rate_key)
    # Privacy Center — record real login events (last 90 days, swept by
    # the purge cron). Only what the platform actually sees: time, IP,
    # user agent. Never invented device names or locations.
    try:
        await db.login_history.insert_one({
            "user_id": user["id"], "at": datetime.now(timezone.utc).isoformat(),
            "ip": ip, "user_agent": (request.headers.get("user-agent") or "")[:300],
        })
    except Exception:  # noqa: BLE001
        pass
    access = create_access_token(user["id"], user.get("email", ""))
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    # Realm Pulse — record sign-in as a meaningful action so DAU lights
    # up immediately, even before the client sends a heartbeat.
    try:
        from services.realm_pulse import record_activity
        await record_activity(user["id"])
    except Exception:  # noqa: BLE001 — analytics never blocks auth
        pass
    response_body: dict = {"user": serialize_user(user), "access_token": access}
    # Phase-Restore — surface the restore prompt for users in the
    # 30-day deletion window. Client shows a modal/page before letting
    # the user into the rest of the app.
    if user.get("account_status") == "deleted_pending_restore":
        response_body["restore_required"] = True
        response_body["pending_deletion"] = {
            "deleted_at":   user.get("deleted_at"),
            "purge_after":  user.get("purge_after"),
        }
    return response_body


@router.post("/logout")
async def logout(request: Request, response: Response):
    # Revoke the presented refresh token without storing the raw token.
    rt = request.cookies.get("refresh_token")
    if rt:
        try:
            decoded = jwt.decode(
                rt, get_jwt_secret(), algorithms=[JWT_ALGORITHM]
            )
            if decoded.get("type") == "refresh":
                token_hash = hashlib.sha256(rt.encode("utf-8")).hexdigest()
                exp = decoded.get("exp")
                expires_at = (
                    datetime.fromtimestamp(exp, tz=timezone.utc)
                    if exp else datetime.now(timezone.utc) + timedelta(days=30)
                )
                await db.revoked_refresh_tokens.update_one(
                    {"token_hash": token_hash},
                    {"$set": {
                        "token_hash": token_hash,
                        "revoked_at": datetime.now(timezone.utc),
                        "expires_at": expires_at,
                    }},
                    upsert=True,
                )
        except jwt.InvalidTokenError:
            pass
        except Exception:
            logger.exception("Refresh-token revocation failed")
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@router.get("/me")
async def me(current: CurrentUser):
    out = serialize_user(current)
    # Phase 3.5+ — hydrate registry widgets so the owner's session
    # ships with full editor_config for every saved custom widget.
    out["widgets"] = await hydrate_registry_widgets(
        current.get("widgets") or [], viewer=current,
    )
    return {"user": out}


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

    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    revoked = await db.revoked_refresh_tokens.find_one(
        {"token_hash": token_hash}
    )
    if revoked:
        response.delete_cookie("access_token", path="/")
        response.delete_cookie("refresh_token", path="/")
        raise HTTPException(status_code=401, detail="Refresh token revoked")

    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # Phase H — never re-issue tokens for disabled accounts.
    if user.get("disabled"):
        response.delete_cookie("access_token", path="/")
        response.delete_cookie("refresh_token", path="/")
        raise HTTPException(status_code=401, detail="Account disabled")
    access = create_access_token(user["id"], user["email"])
    cookie_secure = os.environ.get(
        "COOKIE_SECURE", "true"
    ).lower() != "false"
    cookie_samesite = os.environ.get(
        "COOKIE_SAMESITE", "lax"
    ).lower()
    if cookie_samesite not in {"lax", "strict", "none"}:
        cookie_samesite = "lax"

    response.set_cookie(
        "access_token",
        access,
        httponly=True,
        secure=cookie_secure,
        samesite=cookie_samesite,
        max_age=ACCESS_TOKEN_MINUTES * 60,
        path="/",
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
    # OTP echo for development. Disabled by default; in production the
    # code is delivered out-of-band (email) and is never returned to the
    # caller. Set OTP_DISPLAY_IN_RESPONSE=true in a dev-only env to
    # surface the code in the JSON response for offline testing.
    display_in_response = os.environ.get("OTP_DISPLAY_IN_RESPONSE", "false").lower() == "true"
    if display_in_response:
        logger.info(f"[OTP-DEV] {email} -> {code}")
    else:
        # Avoid logging the code in production. Log only the email + a
        # truncated tag for support correlation.
        logger.info(f"[OTP] code generated for {email}")
    return {"ok": True, "displayed_otp": code if display_in_response else None, "expires_in": 600}


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
    dev_reset_token = None
    if user:
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()

        # Only one active reset token per user.
        await db.password_reset_tokens.delete_many({
            "user_id": user["id"],
            "used": False,
        })

        await db.password_reset_tokens.insert_one({
            "token_hash": token_hash,
            "user_id": user["id"],
            "used": False,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        })

        # Never log the raw password-reset token.
        logger.info(
            "[Password reset] token generated for user_id=%s",
            user["id"],
        )

        # Development-only escape hatch. Keep FALSE in production.
        if os.environ.get(
            "PASSWORD_RESET_DISPLAY_IN_RESPONSE", "false"
        ).lower() == "true":
            dev_reset_token = token

    result = {
        "ok": True,
        "message": "If the email exists, a reset link has been sent.",
    }
    if dev_reset_token:
        result["reset_token"] = dev_reset_token
    return result


@router.post("/reset-password")
async def reset_password(payload: ResetPayload):
    token_hash = hashlib.sha256(
        payload.token.encode("utf-8")
    ).hexdigest()
    rec = await db.password_reset_tokens.find_one(
        {"token_hash": token_hash}
    )
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
        {"token_hash": token_hash},
        {"$set": {
            "used": True,
            "used_at": datetime.now(timezone.utc),
        }},
    )
    return {"ok": True}


# ----- Emergent-managed Google sign-in -----
# REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS,
# THIS BREAKS THE AUTH. The frontend derives the redirect from
# window.location.origin; this backend only exchanges the session_id.
from pydantic import BaseModel as _BaseModel


class GoogleSessionPayload(_BaseModel):
    session_id: str = ""
    pending_token: str = ""
    accepted_terms: bool = False
    accepted_conditions: bool = False
    accepted_privacy: bool = False
    age_confirmed_13: bool = False


EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


@router.post("/google/session")
async def google_session(payload: GoogleSessionPayload, response: Response):
    """Exchange an Emergent Auth session_id for an app session.
    Links by email to an existing account, or creates a new one.
    Returns the SAME shape as /login so the client flow is identical."""
    sid = (payload.session_id or "").strip()
    ptok = (payload.pending_token or "").strip()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    if ptok:
        # Resume a pending NEW-user signup after Terms acceptance —
        # the Google profile was already fetched and stored server-side.
        pending = await db.pending_google_signups.find_one({"token": ptok}, {"_id": 0})
        if not pending or str(pending.get("expires_at", "")) < now_iso:
            raise HTTPException(status_code=401, detail="Sign-in session expired. Please sign in with Google again.")
        data = pending["data"]
    elif sid:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": sid})
        except Exception:
            raise HTTPException(status_code=502, detail="Could not reach the sign-in service. Please try again.")
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid or expired Google session. Please try again.")
        data = r.json()
    else:
        raise HTTPException(status_code=400, detail="Missing session_id")
    email = (data.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=401, detail="Google sign-in did not return an email.")
    user = await db.users.find_one({"email": email})
    created = False

    if user:
        # Same disabled/suspension policy as /login.
        if user.get("suspended_until"):
            try:
                until = datetime.fromisoformat(str(user["suspended_until"]).replace("Z", "+00:00"))
                if until <= now:
                    await db.users.update_one(
                        {"id": user["id"]},
                        {"$set": {"disabled": False},
                         "$unset": {"suspended_until": "", "suspended_at": "",
                                    "suspended_by": "", "suspension_reason": "",
                                    "suspension_notes": ""}})
                    user["disabled"] = False
            except Exception:
                pass
        if user.get("disabled") and user.get("account_status") != "deleted_pending_restore":
            susp = user.get("suspended_until")
            if susp:
                raise HTTPException(status_code=401, detail=f"Account suspended until {susp}")
            raise HTTPException(status_code=401, detail="This account is not available.")
        updates = {"google_auth": True}
        if not user.get("avatar_url") and data.get("picture"):
            updates["avatar_url"] = data["picture"]
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
        user.update(updates)
    else:
        # New Google user — same compliance gate as /register: no account
        # is created until every agreement is accepted.
        if not (payload.accepted_terms and payload.accepted_privacy
                and payload.accepted_conditions and payload.age_confirmed_13):
            token = secrets.token_urlsafe(24)
            await db.pending_google_signups.insert_one({
                "token": token, "data": data, "created_at": now_iso,
                "expires_at": (now + timedelta(minutes=15)).isoformat()})
            return {"requires_terms": True, "pending_token": token, "email": email}
        # Generate a unique, non-premium username from the email prefix;
        # the user can rename later via profile settings.
        import re as _re
        from routers.premium_usernames import signup_gate
        base = _re.sub(r"[^a-z0-9_.]", "", email.split("@")[0].lower())[:20] or "user"
        candidate = base
        for _ in range(30):
            taken = await db.users.find_one({"username": candidate}, {"_id": 0, "id": 1})
            gate = None
            if not taken:
                try:
                    gate = await signup_gate(candidate)
                except Exception:
                    gate = None
            if not taken and not gate:
                break
            candidate = f"{base}{secrets.randbelow(9000) + 1000}"
        username = candidate
        user_id = str(uuid.uuid4())
        doc = {
            "id": user_id,
            "email": email,
            "username": username,
            # Unusable random password — Google-only accounts can still set
            # one later via the normal reset-password flow.
            "password_hash": hash_password(secrets.token_urlsafe(32)),
            "name": (data.get("name") or base).strip()[:60],
            "role": "user",
            "avatar_url": data.get("picture"),
            "bio": "",
            "interests": [],
            "mode": "neon",
            "widgets": [default_top8_widget(), default_myfeed_widget()],
            "friends": [],
            "friend_requests_in": [],
            "friend_requests_out": [],
            "pinned_threads": [],
            "is_vip": False,
            "vip_joined_at": None,
            "presence_status": "offline",
            "presence_status_choice": "online",
            "presence_last_seen": now_iso,
            "follower_count": 0,
            "friend_groups": [],
            "social": {},
            "created_at": now_iso,
            "account_type": "human",
            "is_synthetic": False,
            "analytics_eligible": True,
            "signup_completed": True,
            "email_verified": True,  # verified by Google
            "google_auth": True,
            # One-time onboarding prompt: choose a custom username.
            # Only for accounts CREATED via Google — email-linked existing
            # accounts never receive this flag.
            "needs_username_onboarding": True,
            "compliance": {
                "accepted_terms": True,
                "accepted_privacy": True,
                "accepted_conditions": True,
                "age_confirmed_13": True,
                "policy_version": "google-oauth-2026",
                "accepted_at": now_iso,
            },
        }
        await db.users.insert_one(doc)
        doc.pop("_id", None)
        created = True
        if ptok:
            await db.pending_google_signups.delete_one({"token": ptok})
        # Auto-friend founder + support (mirrors /register).
        try:
            founder = await db.users.find_one({"username": FOUNDER_USERNAME})
            if founder and founder["id"] != user_id:
                await db.users.update_one({"id": user_id}, {"$addToSet": {"friends": founder["id"]}})
                await db.users.update_one({"id": founder["id"]}, {"$addToSet": {"friends": user_id}})
            support = await db.users.find_one({"username": "support"})
            if support and support["id"] != user_id:
                await db.users.update_one({"id": user_id}, {"$addToSet": {"friends": support["id"]}})
                await db.users.update_one({"id": support["id"]}, {"$addToSet": {"friends": user_id}})
        except Exception:
            pass
        # VIP first_1000 (mirrors /register; never blocks signup).
        try:
            vip_badge = await db.badge_registry.find_one({"key": "vip", "status": "live"})
            if vip_badge and (vip_badge.get("auto_rule") == "first_1000"):
                cap = int(vip_badge.get("first_x") or 1000)
                if await db.user_badges.count_documents({"badge_key": "vip"}) < cap:
                    await db.user_badges.update_one(
                        {"user_id": user_id, "badge_key": "vip"},
                        {"$setOnInsert": {
                            "id": f"{user_id}::vip", "user_id": user_id,
                            "username": username, "badge_key": "vip",
                            "assigned_by": "system", "assigned_at": now_iso,
                            "source": "first_1000"}},
                        upsert=True)
                    await db.users.update_one(
                        {"id": user_id}, {"$set": {"is_vip": True, "vip_joined_at": now_iso}})
                    doc["is_vip"] = True
        except Exception:
            pass
        try:
            from services import founding_vip as _fvip
            await _fvip.on_new_registration(user_id)
        except Exception:
            pass
        await record_signup_event(True, "google_success", 200, email)
        user = doc

    # Store the Emergent session (7-day expiry) + httpOnly cookie per the
    # Emergent Auth playbook. Our app session itself uses standard JWTs.
    session_token = data.get("session_token")
    if session_token:
        try:
            await db.user_sessions.insert_one({
                "user_id": user["id"], "session_token": session_token,
                "expires_at": (now + timedelta(days=7)).isoformat(),
                "created_at": now_iso})
            response.set_cookie(
                "session_token", session_token, httponly=True, secure=True,
                samesite="none", path="/", max_age=7 * 24 * 3600)
        except Exception:
            pass

    access = create_access_token(user["id"], email)
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    try:
        from services.realm_pulse import record_activity
        await record_activity(user["id"])
    except Exception:
        pass
    body: dict = {"user": serialize_user(user), "access_token": access, "created": created}
    if user.get("account_status") == "deleted_pending_restore":
        body["restore_required"] = True
        body["pending_deletion"] = {
            "deleted_at": user.get("deleted_at"),
            "purge_after": user.get("purge_after"),
        }
    return body


@router.post("/username-onboarding/dismiss")
async def dismiss_username_onboarding(current: CurrentUser):
    """'Keep this username for now' — one-time; the prompt never reshows."""
    await db.users.update_one({"id": current["id"]},
                              {"$set": {"needs_username_onboarding": False}})
    return {"ok": True}
async def dismiss_username_onboarding(current: CurrentUser):
    """'Keep this username for now' — one-time; the prompt never reshows."""
    await db.users.update_one({"id": current["id"]},
                              {"$set": {"needs_username_onboarding": False}})
    return {"ok": True}


# ── Founder signup pause — public status + reservation (June 2026) ──────
@router.get("/signup-status")
async def signup_status():
    from services.waitlist import get_signup_mode
    _m = (await get_signup_mode())["mode"]
    return {"open": _m == "open", "mode": _m}


class SignupReservationPayload(_BaseModel):
    email: str
    username: str | None = None
    name: str | None = None


@router.post("/signup-reservation")
async def signup_reservation(payload: SignupReservationPayload):
    email = payload.email.lower().strip()
    if "@" not in email or "." not in email or len(email) > 120:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    existing = await db.signup_reservations.find_one({"email": email})
    if existing:
        return {"ok": True, "already_reserved": True}
    await db.signup_reservations.insert_one({
        "id": uuid.uuid4().hex, "email": email,
        "username": (payload.username or "").lower().strip()[:24] or None,
        "name": (payload.name or "").strip()[:80] or None,
        "at": datetime.now(timezone.utc).isoformat()})
    return {"ok": True}
