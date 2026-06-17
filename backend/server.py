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
from routers import images as images_router_mod
from routers import videos as videos_router_mod
from routers import moderation as moderation_router_mod
from routers import threads as threads_router_mod
from routers import sounds as sounds_router_mod
from routers import phase5 as phase5_router_mod
from routers import tickets as tickets_router_mod
from routers import faq as faq_router_mod

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
app.include_router(images_router_mod.router)
app.include_router(videos_router_mod.router)
app.include_router(moderation_router_mod.router)
app.include_router(threads_router_mod.router)
app.include_router(sounds_router_mod.router)
app.include_router(phase5_router_mod.router)
app.include_router(tickets_router_mod.router)
app.include_router(faq_router_mod.router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=get_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Lifecycle ──────────────────────────────────────────
_mod_task = None


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


@app.on_event("startup")
async def on_startup():
    import asyncio
    global _mod_task
    await seed_mod.run_startup()
    _mod_task = asyncio.create_task(_moderation_loop())
    logger.info("OurRealm startup complete (moderation loop armed)")


@app.on_event("shutdown")
async def on_shutdown():
    global _mod_task
    if _mod_task:
        _mod_task.cancel()
    await close_db()
