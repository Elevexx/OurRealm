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

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=get_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Lifecycle ──────────────────────────────────────────
@app.on_event("startup")
async def on_startup():
    await seed_mod.run_startup()
    logger.info("OurRealm startup complete")


@app.on_event("shutdown")
async def on_shutdown():
    await close_db()
