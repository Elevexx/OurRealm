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

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core import seed as seed_mod
from core.config import get_cors_origins
from core.db import close as close_db
from routers import auth as auth_router_mod
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
from routers import media_proxy as media_proxy_router_mod

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


app.include_router(health)
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
app.include_router(threads_router_mod.router)
app.include_router(sounds_router_mod.router)
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
app.include_router(media_proxy_router_mod.router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=get_cors_origins(),
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
    global _mod_task
    await seed_mod.run_startup()
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
    _mod_task = asyncio.create_task(_moderation_loop())

    # Realm Pulse — ensure indexes + boot the hourly snapshot loop.
    try:
        from services import realm_pulse as rp
        await rp.ensure_indexes()
        global _pulse_task
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
    try:
        await admin_widgets_router_mod.ensure_indexes()
        await admin_widgets_router_mod.seed_system_widgets()
    except Exception as e:
        logger.warning(f"[admin_widgets] startup failed: {e}")

    # Communities (Realms + Groups + Chats) — ensure indexes + seed
    # the legacy mock realms into Mongo on the very first startup.
    try:
        from services import community_seed
        await community_seed.ensure_indexes()
        await community_seed.seed_realms()
        # Spec: every Realm must have a matching Realm group chat. Run
        # idempotent backfill so seeded realms (and any legacy realms
        # created before the chat-on-create flow existed) get one too.
        from routers import communities as _communities
        await _communities.backfill_main_realm_chats()
    except Exception as e:
        logger.warning(f"[communities] startup failed: {e}")

    # PART 4 — log the resolved media-storage root so deploy logs make
    # it obvious whether uploads are landing on a persistent volume or
    # the ephemeral fallback.
    try:
        from services.storage import uploads_root, is_persistent_storage_configured, migrate_legacy_uploads
        root = uploads_root()
        persistent = is_persistent_storage_configured()
        msg = f"[storage] uploads_root={root}  persistent={persistent}"
        if persistent:
            logger.info(msg)
            try:
                copied = migrate_legacy_uploads()
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

    # One-time idempotent migration — rewrite any stored media URLs
    # that still point at the public Cloudflare R2 CDN
    # (`media.ourrealm.social`) or the legacy local-disk fallback
    # (`/api/sounds/file/<name>`) to the new stable proxy path
    # (`/api/media/<kind>/<name>`). Running on every boot is safe
    # because the script no-ops when nothing matches.
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
    await close_db()
