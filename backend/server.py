"""OurRealm FastAPI app — slim entry point.

Domain logic lives in `core/*` and `routers/*`. This file is the wiring
layer: env loading, middleware, router mounting, and startup tasks.
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import logging
import os

from fastapi import APIRouter, FastAPI, HTTPException, Request
from starlette.middleware.cors import CORSMiddleware

from core import seed as seed_mod
from core.config import get_cors_origins
from core.db import close as close_db
from routers import auth as auth_router_mod
from routers import dragon_realm as dragon_realm_router_mod
from routers import friends as friends_router_mod
from routers import messages as messages_router_mod
from routers import profile as profile_router_mod
from routers import posts as posts_router_mod
from routers import notifications as notifications_router_mod
from routers import realm_notifications as realm_notifications_router_mod
from routers import images as images_router_mod
from routers import videos as videos_router_mod
from routers import moderation as moderation_router_mod
from routers import threads as threads_router_mod
from routers import sounds as sounds_router_mod
from routers import playlists as playlists_router_mod
from routers import premium_usernames as premium_usernames_router_mod
from routers import phase5 as phase5_router_mod
from routers import tickets as tickets_router_mod
from routers import ticket_categories as ticket_categories_router_mod
from routers import faq as faq_router_mod
from routers import presence as presence_router_mod
from routers import hashtags as hashtags_router_mod
from routers import announcements as announcements_router_mod
from routers import realm_pulse as realm_pulse_router_mod
from routers import communities as communities_router_mod
from routers import realm_widgets as realm_widgets_router_mod
from routers import admin_user_control as admin_user_control_router_mod
from routers import reactions as reactions_router_mod
from routers import profile_polls as profile_polls_router_mod
from routers import admin_widgets as admin_widgets_router_mod
from routers import home_widgets as home_widgets_router_mod
from routers import api_widgets as api_widgets_router_mod
from routers import widget_chat as widget_chat_router_mod
from routers import orion_logs as orion_logs_router_mod
from routers import orion_health as orion_health_router_mod
from routers import orion_control as orion_control_router_mod
from routers import media_proxy as media_proxy_router_mod
from routers import admin_portals as admin_portals_router_mod
from routers import admin_data_audit as admin_data_audit_router_mod
from routers import website_media as website_media_router_mod
from routers import progression as progression_router_mod
from routers import progression_admin as progression_admin_router_mod
from routers import leaderboards as leaderboards_router_mod
from routers import fire as fire_router_mod
from routers import founding_vip as founding_vip_router_mod
from routers import responsibility_center as responsibility_center_router_mod
from routers import rc_admin as rc_admin_router_mod
from routers import rc_media as rc_media_router_mod
from routers import orai_voice as orai_voice_router_mod
from routers import rc_courses as rc_courses_router_mod
from routers import rc_intelligence as rc_intelligence_router_mod
from routers import rc_automations as rc_automations_router_mod
from routers import admin_orai as admin_orai_router_mod
from routers import rc_routines as rc_routines_router_mod
from routers import admin_access as admin_access_router_mod
from routers import guardian as guardian_router_mod

# ─── Logging ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("ourrealm")

# ─── App ────────────────────────────────────────────────
app = FastAPI(title="OurRealm API")

# Health/root probe
health = APIRouter(prefix="/api", tags=["health"])


@health.get("/")
async def root():
    return {"app": "OurRealm", "status": "ok"}


@health.get("/health")
async def api_health_probe():
    return {"app": "OurRealm", "backend": "alive", "status": "ok"}


@app.get("/health")
async def health_probe():
    return {"status": "ok"}


@app.get("/api/health/version")
async def health_version():
    """Public, no-secret build marker so any environment (incl production)
    can be verified from outside. Booleans only — never values."""
    return {
        "app": "OurRealm",
        "backend_build": "2026-08-04-openai-key-hardening",
        "features": {
            "ctx_path_fix": True,
            "structured_chat_contract": True,
            "cors_headers_on_unhandled_500": True,
            "direct_openai_routing": True,
            "gpt5_temperature_strip": True,
            "blueprint_build_engine": True,
            "trust_safety_center": True,
        },
        "env": {
            "openai_key_set": bool(os.environ.get("OPENAI_API_KEY")),
            "openai_key_clean": (os.environ.get("OPENAI_API_KEY") or "").strip().isascii()
                                and bool((os.environ.get("OPENAI_API_KEY") or "").strip()),
            "emergent_key_set": bool(os.environ.get("EMERGENT_LLM_KEY")),
            "emergent_key_clean": (os.environ.get("EMERGENT_LLM_KEY") or "").strip().isascii()
                                  and bool((os.environ.get("EMERGENT_LLM_KEY") or "").strip()),
            "cors_origins_count": len(get_cors_origins()),
            "db_name_set": bool(os.environ.get("DB_NAME")),
        },
    }


@app.get("/api/admin/system/errors")
async def recent_unhandled_errors(request: Request, limit: int = 10, request_id: str = ""):
    """Founder-only: recent unhandled 500 tracebacks (production debugging)."""
    from core.deps import get_current_user
    from core.permissions import require_founder
    user = await get_current_user(request)
    require_founder(user)
    from core.db import db as _db
    q = {"request_id": request_id} if request_id else {}
    rows = await _db.unhandled_errors.find(q, {"_id": 0}).sort("at", -1).to_list(min(limit, 25))
    return {"errors": rows}


app.include_router(health)
app.include_router(dragon_realm_router_mod.router)
app.include_router(auth_router_mod.router)
app.include_router(profile_router_mod.router)
app.include_router(friends_router_mod.router)
app.include_router(messages_router_mod.router)
app.include_router(posts_router_mod.router)
app.include_router(notifications_router_mod.router)
app.include_router(realm_notifications_router_mod.router)
app.include_router(images_router_mod.router)
app.include_router(videos_router_mod.router)
app.include_router(moderation_router_mod.router)
from routers import trust_safety as trust_safety_router_mod  # noqa: E402
app.include_router(trust_safety_router_mod.router)
app.include_router(trust_safety_router_mod.user_router)
app.include_router(threads_router_mod.router)
app.include_router(sounds_router_mod.router)
app.include_router(playlists_router_mod.router)
app.include_router(premium_usernames_router_mod.router)
app.include_router(phase5_router_mod.router)
app.include_router(tickets_router_mod.router)
app.include_router(ticket_categories_router_mod.router)
app.include_router(faq_router_mod.router)
app.include_router(presence_router_mod.router)
app.include_router(hashtags_router_mod.router)
app.include_router(announcements_router_mod.router)
app.include_router(realm_pulse_router_mod.router)
app.include_router(communities_router_mod.router)
app.include_router(realm_widgets_router_mod.router)
app.include_router(admin_user_control_router_mod.router)
app.include_router(reactions_router_mod.router)
app.include_router(profile_polls_router_mod.router)
app.include_router(admin_widgets_router_mod.router)
app.include_router(home_widgets_router_mod.router)
app.include_router(api_widgets_router_mod.router)
app.include_router(widget_chat_router_mod.router)
app.include_router(orion_logs_router_mod.router)
app.include_router(orion_health_router_mod.router)
app.include_router(orion_control_router_mod.router)
app.include_router(media_proxy_router_mod.router)
app.include_router(admin_portals_router_mod.router)
app.include_router(admin_data_audit_router_mod.router)
app.include_router(website_media_router_mod.router)
app.include_router(progression_router_mod.router)
app.include_router(progression_admin_router_mod.router)
app.include_router(leaderboards_router_mod.router)
app.include_router(fire_router_mod.router)
app.include_router(founding_vip_router_mod.router)
from routers import rc_items as rc_items_router_mod
from routers import rc_lifecycle as rc_lifecycle_router_mod
from routers import rc_units as rc_units_router_mod
from routers import rc_reports as rc_reports_router_mod
app.include_router(rc_items_router_mod.router)
app.include_router(rc_lifecycle_router_mod.router)
app.include_router(rc_lifecycle_router_mod.admin_router)
app.include_router(rc_units_router_mod.router)
app.include_router(rc_reports_router_mod.router)
app.include_router(rc_reports_router_mod.admin_router)
app.include_router(responsibility_center_router_mod.router)
app.include_router(rc_admin_router_mod.router)
app.include_router(rc_media_router_mod.router)
app.include_router(orai_voice_router_mod.router)
app.include_router(rc_courses_router_mod.router)
from routers import ai_video as ai_video_router_mod  # noqa: E402
app.include_router(ai_video_router_mod.admin_router)
app.include_router(ai_video_router_mod.course_router)
app.include_router(ai_video_router_mod.styles_router)
app.include_router(rc_intelligence_router_mod.router)
app.include_router(rc_automations_router_mod.router)
app.include_router(admin_orai_router_mod.router)
app.include_router(rc_routines_router_mod.router)
app.include_router(admin_access_router_mod.router)
app.include_router(admin_access_router_mod.public_router)
app.include_router(guardian_router_mod.router)
from routers import orai_assistant as orai_assistant_router_mod
app.include_router(orai_assistant_router_mod.router)
app.include_router(orai_assistant_router_mod.access_admin)
from routers import access_policy as access_policy_router_mod  # noqa: E402
app.include_router(access_policy_router_mod.router)
app.include_router(access_policy_router_mod.public_router)
from routers import education_plans as education_plans_router_mod  # noqa: E402
app.include_router(education_plans_router_mod.router)
from routers import games_plus as games_plus_router_mod  # noqa: E402
app.include_router(games_plus_router_mod.public2)
app.include_router(games_plus_router_mod.admin2)
from routers import games as games_router_mod  # noqa: E402
app.include_router(games_router_mod.admin)
app.include_router(games_router_mod.public)
from routers import orai_builds as orai_builds_router_mod  # noqa: E402
app.include_router(orai_builds_router_mod.router)
from routers import game_blueprints as game_blueprints_router_mod  # noqa: E402
app.include_router(game_blueprints_router_mod.router)  # before orai_projects — literal /blueprints must beat /{pid}
from routers import game_platform as game_platform_router_mod  # noqa: E402
app.include_router(game_platform_router_mod.router)
from routers import game_editor as game_editor_router_mod  # noqa: E402
app.include_router(game_editor_router_mod.router)  # before orai_projects — literal /editor|/remix|/release beat /{pid}
from routers import orai_projects as orai_projects_router_mod  # noqa: E402
app.include_router(orai_projects_router_mod.router)
from routers import game_assets as game_assets_router_mod  # noqa: E402
app.include_router(game_assets_router_mod.router)
from routers import project_media as project_media_router_mod  # noqa: E402
app.include_router(project_media_router_mod.router)
app.include_router(project_media_router_mod.public_media)
from routers import game_promotion as game_promotion_router_mod  # noqa: E402
app.include_router(game_promotion_router_mod.router)
from routers import game_access_ctl as game_access_router_mod  # noqa: E402
app.include_router(game_access_router_mod.router)
app.include_router(game_access_router_mod.public_router)
from routers import game_urls as game_urls_router_mod  # noqa: E402
app.include_router(game_urls_router_mod.router)
app.include_router(game_urls_router_mod.public_router)
from routers import center_registry as center_registry_router_mod  # noqa: E402
app.include_router(center_registry_router_mod.router)
app.include_router(center_registry_router_mod.admin_router)
app.include_router(game_assets_router_mod.public_router)
from routers import account_privacy as account_privacy_router_mod
from routers import admin_privacy as admin_privacy_router_mod
from routers import legal as legal_router_mod
from routers import waitlist as waitlist_router_mod
app.include_router(account_privacy_router_mod.router)
app.include_router(admin_privacy_router_mod.router)
app.include_router(legal_router_mod.router)
app.include_router(legal_router_mod.public_router)
app.include_router(waitlist_router_mod.public_router)
app.include_router(waitlist_router_mod.admin_router)


# ─── Friendly signup validation errors + signup health telemetry ───────
# Pydantic 422s on /api/auth/register previously surfaced as raw
# validation JSON ("Something went wrong" client-side). Translate the
# first error into a safe, specific message and record a signup_event.
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

_REGISTER_FIELD_MESSAGES = {
    "email": "Please enter a valid email address.",
    "password": "Password must be 6–128 characters long.",
    "username": "Username must be 3–24 characters using only letters, numbers, dots, or underscores.",
    "name": "Please enter your name (1–80 characters).",
}


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc: RequestValidationError):
    path = request.scope.get("path", "")
    if path.rstrip("/").endswith("/auth/register"):
        field = None
        for err in exc.errors():
            loc = [str(x) for x in err.get("loc", []) if x != "body"]
            if loc:
                field = loc[0]
                break
        message = _REGISTER_FIELD_MESSAGES.get(field, "Please check the signup form and try again.")
        try:
            from routers.auth import record_signup_event
            await record_signup_event(ok=False, category=f"validation_{field or 'unknown'}",
                                      status_code=422, detail=message)
        except Exception:  # noqa: BLE001
            pass
        return JSONResponse(status_code=422, content={"detail": message})
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception):
    """Catch-all so an unhandled error is returned as JSON WITH CORS headers.
    Starlette's ServerErrorMiddleware runs OUTSIDE CORSMiddleware, so a bare
    500 has no Access-Control-Allow-Origin and browsers block it — the client
    then only sees a generic error. We echo the CORS headers manually for any
    trusted origin. Full traceback is logged server-side; client gets a stable
    contract with a reference id."""
    import re as _re
    import uuid as _uuid
    import traceback as _tb
    from datetime import datetime as _dtc, timezone as _tzc
    ref = _uuid.uuid4().hex
    logging.getLogger("ourrealm").exception(
        "unhandled exception ref=%s path=%s", ref, request.scope.get("path", "?"))
    try:
        from core.db import db as _db
        await _db.unhandled_errors.insert_one({
            "id": ref, "request_id": ref,
            "path": request.scope.get("path", "?"),
            "method": request.method,
            "error_type": type(exc).__name__,
            "error": str(exc)[:500],
            "traceback": _tb.format_exc()[-6000:],
            "at": _dtc.now(_tzc.utc).isoformat()})
    except Exception:  # noqa: BLE001 — error store must never block the response
        pass
    headers = {}
    origin = request.headers.get("origin")
    if origin:
        trusted = origin in set(get_cors_origins()) or bool(
            _re.fullmatch(r"https://[a-z0-9-]+\.(emergent\.host|preview\.emergentagent\.com)", origin))
        if trusted:
            headers["Access-Control-Allow-Origin"] = origin
            headers["Access-Control-Allow-Credentials"] = "true"
            headers["Vary"] = "Origin"
    return JSONResponse(status_code=500, headers=headers, content={
        "success": False, "error_code": "internal_error",
        "message": "Something went wrong on our end — please try again.",
        "request_id": ref})

# ─── Global auth enforcement ────────────────────────────────────────────
# Every /api endpoint requires an authenticated session except the
# explicit public allow-list below (health + auth/recovery only).
PUBLIC_API_PATHS = {
    "/api",
    "/api/health",
    "/api/health/version",
    "/api/auth/register",
    "/api/auth/username/check",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/refresh",
    "/api/auth/otp/request",
    "/api/auth/otp/verify",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/google/session",
    "/api/access-control/status",
    "/api/access-control/preview-demo",
    "/api/auth/signup-status",
    "/api/auth/signup-reservation",
    "/api/access-control/site-status",
}


def _is_public_legal_get(method: str, path: str) -> bool:
    """Published legal documents are readable without auth (linked from
    signup/signin). Notices endpoints stay authenticated."""
    return (method == "GET" and (path == "/api/legal/documents"
                                 or (path.startswith("/api/legal/documents/")
                                     and "/notices" not in path)))


# ─── Site Access Modes (Live/Beta/Preview/Maintenance) — server-side.
@app.middleware("http")
async def site_access_guard(request, call_next):
    if request.method != "OPTIONS":
        try:
            from services import site_access as _sa
            blocked = await _sa.enforce_request(request)
            if blocked is not None:
                return blocked
        except Exception as e:
            logger.warning(f"[site-access] guard error (fail-open): {e}")
    return await call_next(request)


# ─── Guardian Controls (Teen/Adult) — innermost guard, runs after auth
# and Global Access Control. Server-side enforcement of parent settings.
@app.middleware("http")
async def guardian_control_guard(request, call_next):
    if request.method != "OPTIONS":
        try:
            from services import guardian_control as _gc
            blocked = await _gc.enforce_request(request)
            if blocked is not None:
                return blocked
        except Exception as e:
            logger.warning(f"[guardian] guard error (fail-open): {e}")
    return await call_next(request)


# ─── OurRealm Global Access Control (innermost — runs after auth guard
# and /api/v1 alias rewrite). Centralized SERVER-SIDE enforcement of the
# founder's feature modes for every current and future RC / ORAi route.
@app.middleware("http")
async def global_access_control_guard(request, call_next):
    if request.method != "OPTIONS":
        try:
            from services import access_control as _ac
            blocked = await _ac.enforce_request(request)
            if blocked is not None:
                return blocked
        except Exception as e:
            logger.warning(f"[access-control] guard error (fail-open): {e}")
    return await call_next(request)


@app.middleware("http")
async def global_auth_guard(request, call_next):
    path = (request.scope.get("path", "") or "").rstrip("/") or "/"
    if (request.method == "OPTIONS" or not path.startswith("/api")
            or path in PUBLIC_API_PATHS
            or _is_public_legal_get(request.method, path)
            or path.startswith("/api/waitlist/public/")
            or path.startswith("/api/public/game-assets/")
            or path.startswith("/api/public/game-preview/")
            or path.startswith("/api/public/game-path/")
            or path.startswith("/api/public/project-media/")
            # read-only image serving (CDN-style): <img> tags never send auth
            # headers, so logged-out visitors must be able to load game covers
            or (request.method == "GET" and (path.startswith("/api/media/images/")
                                             or path.startswith("/api/images/")))):
        return await call_next(request)
    from core.deps import get_current_user
    try:
        await get_current_user(request)
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=get_cors_origins(),
    allow_origin_regex=r"https://([a-z0-9-]+)\.(emergent\.host|preview\.emergentagent\.com)",
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── API v1 alias (Phase α) ─────────────────────────────────────────────
# All existing endpoints live under `/api/...` and remain the canonical
# paths. To prepare for future API access without breaking back-compat,
# we accept `/api/v1/...` as an alias — the request path is rewritten
# in-place at the ASGI layer and forwarded to the existing handlers.
# No router code changes; full back-compat preserved.
@app.middleware("http")
async def api_v1_alias(request, call_next):
    path = request.scope.get("path", "")
    if path.startswith("/api/v1/"):
        new_path = "/api/" + path[len("/api/v1/"):]
        request.scope["path"] = new_path
        if "raw_path" in request.scope:
            try:
                request.scope["raw_path"] = new_path.encode("ascii")
            except UnicodeEncodeError:
                pass
    response = await call_next(request)
    # Tag the response so clients can see which API surface they hit —
    # useful when migrating callers to v1.
    if path.startswith("/api/v1/"):
        response.headers["X-API-Version"] = "v1"
    return response


# ─── Auth response validator (outermost) — final wire-format check ─────
# Guarantees every /api/auth response leaving the app is valid HTTP:
# sane status, no control chars in headers, no duplicate headers, JSON
# body parses, content-length exact. On violation: log the offending
# header and return a clean JSON 500 instead of a malformed response.
@app.middleware("http")
async def auth_response_validator(request, call_next):
    path = request.scope.get("path", "") or ""
    if not path.startswith("/api/auth"):
        return await call_next(request)
    try:
        response = await call_next(request)
        offending = []
        if not isinstance(response.status_code, int) or not (100 <= response.status_code <= 599):
            offending.append(f"status={response.status_code!r}")
        seen = {}
        for rk, rv in response.headers.raw:
            name, val = rk.decode("latin1"), rv.decode("latin1")
            if any(c in name for c in ("\r", "\n", "\x00", " ")):
                offending.append(f"header name {name!r}: invalid char")
            if any(ord(c) < 32 or ord(c) > 126 for c in val):
                offending.append(f"header {name!r}: control/non-ascii char in value {val!r}")
            lk = name.lower()
            if lk != "set-cookie":
                seen[lk] = seen.get(lk, 0) + 1
        dups = [k for k, c in seen.items() if c > 1]
        if dups:
            offending.append(f"duplicate headers: {dups}")
        body = b""
        async for chunk in response.body_iterator:
            body += chunk if isinstance(chunk, bytes) else chunk.encode("utf-8")
        cl = response.headers.get("content-length")
        if cl is not None and cl.isdigit() and int(cl) != len(body):
            offending.append(f"content-length mismatch: header={cl} actual={len(body)}")
        if "application/json" in (response.headers.get("content-type") or "") and body:
            import json as _json
            try:
                _json.loads(body)
            except Exception as e:
                offending.append(f"invalid JSON body: {e}")
        if offending:
            logger.error(f"[auth-response-validator] BLOCKED malformed response on {path}: {'; '.join(offending)}")
            return JSONResponse(status_code=500, content={"detail": "auth_response_validation_failed"})
        from starlette.responses import Response as _WireResponse
        rebuilt = _WireResponse(content=body, status_code=response.status_code)
        rebuilt.raw_headers = [(rk, rv) for rk, rv in response.headers.raw
                               if rk.decode("latin1").lower() not in ("content-length", "content-type")]
        if response.headers.get("content-type"):
            rebuilt.headers["content-type"] = response.headers["content-type"]
        rebuilt.headers["content-length"] = str(len(body))
        rebuilt.background = response.background
        return rebuilt
    except Exception as e:
        logger.error(f"[auth-response-validator] uncaught error on {path}: {type(e).__name__}: {e}")
        return JSONResponse(status_code=500, content={"detail": "internal_error"})


async def db_strip_fake_realm_counts() -> int:
    """Idempotent — $unset the seeded fake member/online estimate fields."""
    from core.db import db as _db
    res = await _db.realms.update_many(
        {"$or": [{"members": {"$exists": True}}, {"online": {"$exists": True}},
                 {"member_count_estimate": {"$exists": True}},
                 {"online_count_estimate": {"$exists": True}}]},
        {"$unset": {"members": "", "online": "",
                    "member_count_estimate": "", "online_count_estimate": ""}},
    )
    return res.modified_count


# ─── Lifecycle ──────────────────────────────────────────
_mod_task = None
_pulse_task = None


async def _moderation_loop():
    """Rescan recently-created posts every 5 minutes so reports submitted
    against currently-approved content get re-evaluated even when no new
    user activity hits the create path."""
    import asyncio
    from datetime import timedelta, timezone, datetime as _dt
    from services.moderation import scan_and_apply
    from core.db import db
    while True:
        try:
            since = (_dt.now(timezone.utc) - timedelta(minutes=15)).isoformat()
            cursor = db.posts.find(
                {"$or": [
                    {"moderation_status": {"$exists": False}},
                    {"moderation_status": {"$in": [None, "pending_review"]}},
                ], "created_at": {"$gte": since}},
                {"_id": 0},
            ).limit(50)
            async for doc in cursor:
                try:
                    await scan_and_apply("posts", "id", doc,
                                         text_fields=("content",),
                                         link_fields=("link_url", "video_url"),
                                         user_id=doc.get("author_id"))
                except Exception as e:  # never let one bad doc kill the loop
                    logger.warning(f"moderation rescan error: {e}")
        except Exception as e:
            logger.warning(f"moderation loop error: {e}")
        await asyncio.sleep(300)  # 5 minutes


async def _realm_pulse_loop():
    """Hourly Realm Pulse aggregation. Writes one snapshot row per
    built-in window (7d/30d/90d) into `realm_pulse_snapshots`. The
    dashboard reads the latest row instantly; per-request reads only
    overlay the live DAU on top, so page loads stay <50ms even when
    user counts grow to millions."""
    import asyncio
    from services import realm_pulse as rp
    while True:
        for window in ("7d", "30d", "90d"):
            try:
                payload = await rp.write_snapshot(window)
                logger.info(
                    "[realm_pulse] snapshot window=%s dau=%s mau=%s",
                    window, payload.get("dau"), payload.get("mau"),
                )
            except Exception as e:
                logger.warning(f"[realm_pulse] snapshot {window} failed: {e}")
        await asyncio.sleep(3600)  # hourly


@app.on_event("startup")
async def on_startup():
    import asyncio
    asyncio.create_task(_safe_startup())


async def _safe_startup():
    import asyncio
    try:
        from services.game_promotion import startup_import
        asyncio.create_task(startup_import())
    except Exception as e:
        logger.error(f"[promotion] startup seed task failed to arm: {e}")
    try:
        await _deferred_startup()
    except asyncio.CancelledError:
        raise
    except BaseException as e:
        logger.error(f"[startup] deferred startup aborted ({type(e).__name__}): {e}")


async def _deferred_startup():
    import asyncio
    global _mod_task, _fire_finalize_task, _pulse_task
    logger.info("[startup-step] begin deferred startup")
    if os.environ.get("STARTUP_MIGRATIONS", "off").lower() in ("off", "0", "false"):
        logger.warning("[startup] EMERGENCY MODE — boot migrations skipped (STARTUP_MIGRATIONS!=on); arming background workers only")
        _mod_task = asyncio.create_task(_moderation_loop())
        try:
            asyncio.create_task(orion_control_router_mod.scheduler_loop())
        except Exception as e:
            logger.warning(f"[orai-scheduler] startup error: {e}")
        try:
            from services import fire_vault as _fv
            _fire_finalize_task = asyncio.create_task(_fv.finalization_loop(600))
        except Exception as e:
            logger.warning(f"[fire-finalize] startup error: {e}")
        try:
            _pulse_task = asyncio.create_task(_realm_pulse_loop())
        except Exception as e:
            logger.warning(f"[realm_pulse] startup failed: {e}")
        try:
            from services.purge_cron import start_purge_scheduler
            start_purge_scheduler()
        except Exception as e:
            logger.warning(f"[purge_cron] startup failed: {e}")
        try:
            from services.account_deletion import start_deletion_worker
            start_deletion_worker()
        except Exception as e:
            logger.warning(f"[deletion-worker] startup failed: {e}")
        try:
            from services.legal_docs import seed_documents
            await seed_documents()
        except Exception as e:
            logger.warning(f"[legal] seed failed: {e}")
        try:
            from services.rc_renewals import start_renewal_scheduler
            start_renewal_scheduler()
        except Exception as e:
            logger.warning(f"[rc-renewals] startup failed: {e}")
        logger.info("OurRealm startup complete (EMERGENCY MODE — workers armed, migrations skipped)")
        return
    logger.info("[startup-step] seed")
    try:
        await seed_mod.run_startup()
    except Exception as e:
        logger.warning(f"[seed] startup error: {e}")
    logger.info("[startup-step] hashtags")
    # Phase F — ensure hashtag indexes exist + retroactively index any
    # legacy posts that pre-date the hashtag system.
    try:
        await hashtags_router_mod.ensure_indexes()
        # Only run the migration if at least one post has no hashtag
        # field at all — keeps subsequent restarts O(1).
        from core.db import db as _db
        needs = await _db.posts.find_one({"hashtags": {"$exists": False}}, {"_id": 0, "id": 1})
        if needs:
            await hashtags_router_mod.migrate_index_all_posts()
        # Reconcile post_count drift on every boot — cheap, idempotent.
        # Without this, hashtags from deleted-then-recreated posts can
        # appear in `/trending` and link to an empty hashtag feed.
        await hashtags_router_mod.recompute_hashtag_post_counts()
    except Exception as e:
        logger.warning(f"[hashtags] startup index/migration error: {e}")
    # Sound unification — restart-safe automatic backfill: every legacy
    # track gets its canonical post (+ hearts → 1× Fire) so all Sound
    # posts carry the unified Fire Power control. Idempotent no-op when
    # everything is already canonical.
    logger.info("[startup-step] sound-migration")
    try:
        from services import sound_posts as _sp
        await _sp.run_startup_migration()
    except Exception as e:
        logger.warning(f"[sound-migration] startup error: {e}")
    # Progression repair — audits task definitions (Likes→Fire, Inner
    # Realm detection, duplicate merge) and recalculates every user from
    # full history. Runs once per REPAIR_VERSION; idempotent; background.
    try:
        from services.progression.repair import run_startup_repair
        asyncio.create_task(run_startup_repair())
    except Exception as e:
        logger.warning(f"[progression-repair] startup error: {e}")
    # Media rights (Phase 1-2) — label legacy videos ("confirmation not
    # collected", metadata only) and default existing Sounds to
    # playable-only reuse. Idempotent, non-destructive.
    logger.info("[startup-step] media-rights")
    try:
        from services.sound_permissions import run_startup_migration as _mrm
        await _mrm()
    except Exception as e:
        logger.warning(f"[media-rights-migration] startup error: {e}")
    _mod_task = asyncio.create_task(_moderation_loop())
    try:
        asyncio.create_task(orion_control_router_mod.scheduler_loop())
    except Exception as e:
        logger.warning(f"[orai-scheduler] startup error: {e}")

    # Fire Vault — background finalization (Pending → Collectable).
    try:
        from services import fire_vault as _fv
        _fire_finalize_task = asyncio.create_task(_fv.finalization_loop(600))
    except Exception as e:
        logger.warning(f"[fire-finalize] startup error: {e}")

    # Canonical Sound posts — indexes + classification seed (idempotent).
    logger.info("[startup-step] sound-indexes")
    try:
        from services import sound_posts as _sp
        await _sp.ensure_sound_indexes()
        await _sp.ensure_classifications()
    except Exception as e:
        logger.warning(f"[sound-posts] startup error: {e}")

    # Realm Pulse — ensure indexes + boot the hourly snapshot loop.
    logger.info("[startup-step] realm-pulse")
    try:
        from services import realm_pulse as rp
        await rp.ensure_indexes()
        _pulse_task = asyncio.create_task(_realm_pulse_loop())
    except Exception as e:
        logger.warning(f"[realm_pulse] startup failed: {e}")

    # Profile poll widget — unique (widget_id, user_id) index for votes.
    try:
        await profile_polls_router_mod.ensure_indexes()
    except Exception as e:
        logger.warning(f"[profile_polls] index init failed: {e}")

    # Widgets & Badges admin registry — seed 16 system widgets +
    # ensure unique-key indexes for both registries and user_badges.
    logger.info("[startup-step] admin-widgets")
    try:
        await admin_widgets_router_mod.ensure_indexes()
        await admin_widgets_router_mod.seed_system_widgets()
    except Exception as e:
        logger.warning(f"[admin_widgets] startup failed: {e}")

    # Phase 3.7.3 — Idempotent Orion founder widget heal. Production
    # environments that never ran the admin "launch" flow lack the
    # `stealth_ai_5a6` row in widget_registry, which made every Orion
    # chat call return 404 "Widget not found". This call upserts the
    # row from the widget_templates blueprint so the founder chat works
    # immediately on any fresh DB. Uses $setOnInsert so a real seeded
    # row is never overwritten.
    logger.info("[startup-step] orion-heal")
    try:
        from routers.widget_chat import _heal_orion_registry, ORION_WIDGET_KEYS
        for key in ("stealth_ai_5a6",):  # canonical founder key
            await _heal_orion_registry(key)
        logger.info("[orion] startup heal ok — canonical founder widget present.")
    except Exception as e:
        logger.warning(f"[orion] startup heal failed: {e}")

    # Phase 3 — API Widget proxy. Ensures TTL indexes for the
    # api_cache and api_quota collections so cache/rate-limit docs
    # self-expire without a cron.
    try:
        from services import api_widget_proxy
        from utils import sliding_window_rate_limit
        await api_widget_proxy.ensure_indexes()
        await sliding_window_rate_limit.ensure_indexes()
        await rc_intelligence_router_mod.ensure_indexes()
    except Exception as e:
        logger.warning(f"[api_widgets] startup failed: {e}")

    # Progression system — indexes + editable seed levels (idempotent).
    logger.info("[startup-step] progression")
    try:
        from services.progression.indexes import ensure_progression_indexes
        from services.progression.seed import ensure_progression_seed
        await ensure_progression_indexes()
        created = await ensure_progression_seed()
        if created:
            logger.info("[progression] seeded Newbie + Explorer levels.")
    except Exception as e:
        logger.warning(f"[progression] startup failed: {e}")

    # Communities (Realms + Groups + Chats) — ensure indexes + seed
    # the legacy mock realms into Mongo on the very first startup.
    logger.info("[startup-step] communities")
    try:
        from services import community_seed
        await community_seed.ensure_indexes()
        # PRODUCTION SAFEGUARD (June 2026 audit): demo/seed fixtures are
        # OFF by default everywhere. The 8 realm containers already exist
        # in every environment; new environments must opt in explicitly.
        if os.environ.get("ENABLE_DEMO_SEEDS", "").lower() == "true":
            await community_seed.seed_realms()
        else:
            logger.info("[communities] seed_realms skipped (ENABLE_DEMO_SEEDS not set)")
        # Strip legacy FAKE count fields from realm docs so no code path
        # can ever surface the seeded 18k/32k member numbers again. The
        # API derives member_count from community_memberships (real data).
        res = await db_strip_fake_realm_counts()
        if res:
            logger.info(f"[communities] stripped legacy fake-count fields from {res} realm docs")
        # Spec: every Realm must have a matching Realm group chat. Run
        # idempotent backfill so seeded realms (and any legacy realms
        # created before the chat-on-create flow existed) get one too.
        from routers import communities as _communities
        await _communities.backfill_main_realm_chats()
    except Exception as e:
        logger.warning(f"[communities] startup failed: {e}")

    logger.info("[startup-step] website-media")
    try:
        from routers.website_media import ensure_website_media_seed
        await ensure_website_media_seed()
        logger.info("[website-media] seed ok")
    except Exception as e:
        logger.warning(f"[website-media] seed failed (header falls back to hardcoded logo): {e}")

    # PART 4 — log the resolved media-storage root so deploy logs make
    # it obvious whether uploads are landing on a persistent volume or
    # the ephemeral fallback.
    logger.info("[startup-step] storage")
    try:
        from services.storage import uploads_root, is_persistent_storage_configured, migrate_legacy_uploads
        root = uploads_root()
        persistent = is_persistent_storage_configured()
        msg = f"[storage] uploads_root={root}  persistent={persistent}"
        if persistent:
            logger.info(msg)
            try:
                copied = await asyncio.to_thread(migrate_legacy_uploads)
                total = sum(v for v in copied.values() if isinstance(v, int))
                if total:
                    logger.info(f"[storage] migrated {total} legacy files: {copied}")
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[storage] legacy migration skipped: {e}")
        else:
            logger.warning(msg + "  ← EPHEMERAL FALLBACK; set UPLOADS_ROOT to a persistent volume mount in production.")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[storage] could not resolve uploads root: {e}")

    # Account lifecycle — hourly purge cron for users past the
    # 30-day soft-delete window. Helpers + idempotent purge live
    # in core.account_lifecycle; the scheduler just calls them.
    try:
        from services.purge_cron import start_purge_scheduler
        start_purge_scheduler()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[purge_cron] startup failed: {e}")

    # AccountDeletionService — staged permanent-erasure worker +
    # deletion-suppression re-apply pass (backup restore protection).
    try:
        from services.account_deletion import start_deletion_worker
        start_deletion_worker()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[deletion-worker] startup failed: {e}")

    # Legal Center — idempotent seed: imports existing published legal
    # wording as v1, creates unpublished skeleton drafts for the rest.
    try:
        from services.legal_docs import seed_documents
        created = await seed_documents()
        if created:
            logger.info(f"[legal] seeded {created} documents")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[legal] seed failed: {e}")

    # Responsibility Center — 30-Day Active Period renewal scheduler
    # (Bundle A). Idempotent, claim-locked, emergency-pause aware.
    try:
        from services.rc_renewals import start_renewal_scheduler
        start_renewal_scheduler()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[rc-renewals] startup failed: {e}")

    # One-time idempotent migration — rewrite any stored media URLs
    # that still point at the public Cloudflare R2 CDN
    # (`media.ourrealm.social`) or the legacy local-disk fallback
    # (`/api/sounds/file/<name>`) to the new stable proxy path
    # (`/api/media/<kind>/<name>`). Running on every boot is safe
    # because the script no-ops when nothing matches.
    logger.info("[startup-step] media-proxy-migration")
    try:
        from scripts.migrate_to_media_proxy import main as media_migrate_main
        import sys as _sys
        # `argparse` reads from sys.argv — strip flags so we always
        # apply (no `--dry-run`) regardless of how uvicorn was invoked.
        _saved_argv = _sys.argv[:]
        _sys.argv = [_sys.argv[0]]
        try:
            await media_migrate_main()
        finally:
            _sys.argv = _saved_argv
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[media-proxy] startup migration failed: {e}")

    logger.info("OurRealm startup complete (moderation loop armed)")


@app.on_event("shutdown")
async def on_shutdown():
    global _mod_task, _pulse_task
    if _mod_task:
        _mod_task.cancel()
    if _pulse_task:
        _pulse_task.cancel()
    try:
        from services.purge_cron import stop_purge_scheduler
        await stop_purge_scheduler()
    except Exception:  # noqa: BLE001
        pass
    try:
        from services.rc_renewals import stop_renewal_scheduler
        stop_renewal_scheduler()
    except Exception:  # noqa: BLE001
        pass
    await close_db()
