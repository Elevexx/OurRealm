"""Widgets & Badges admin registry (Phase 1 — Feb 24, 2026).

Two Mongo-backed registries that power the `/admin/widgets` console:
  • db.widget_registry — every widget the app knows about, including
    the 16 system widgets (seeded on first boot, `is_system=True`) and
    any custom widgets an admin defines later.
  • db.badge_registry — admin-managed badges with assignment metadata.
  • db.user_badges — per-user badge assignments (badge_key → username).

Public surfaces:
  • GET /api/widgets/available?placement=profile|home|realm
  • GET /api/profile/{username}/badges

Admin surfaces (founder/admin only):
  • GET/POST/PATCH/DELETE /api/admin/widgets[/:id]
  • POST /api/admin/widgets/:id/launch  → status=live
  • POST /api/admin/widgets/:id/disable → status=disabled
  • Mirror set for /api/admin/badges + assign/remove.

Disabled widget behaviour (per user spec, option C):
  • status=disabled widgets DO NOT appear in /api/widgets/available.
  • The profile public-read endpoint hard-hides any saved widget
    whose key references a disabled registry entry.
  • Admins viewing the profile see a banner instead (frontend gates
    this — backend just returns a `disabled` flag on the widget body).
"""
from datetime import datetime, timezone
from typing import List, Optional, Literal
import logging
import uuid

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict

from core.db import db
from core.deps import CurrentUser, is_admin_user
from core.widget_types import ALLOWED_WIDGET_TYPES

logger = logging.getLogger("ourrealm.admin_widgets")

router = APIRouter(prefix="/api", tags=["admin-widgets-badges"])


# ─────────────────────────────────────────────────────────────────────
# Pydantic shapes (lenient — we don't want admin UX blocked by strict
# enums while we iterate on categories/sizes)
# ─────────────────────────────────────────────────────────────────────

WidgetType = Literal["profile", "home", "realm"]
WidgetStatus = Literal["draft", "live", "disabled"]
AccessGroup = Literal["founder", "admin", "vip", "standard", "all_users"]

DEFAULT_ALLOWED_SIZES = ["small", "medium", "large", "xl"]


class WidgetCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    key: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    widget_type: WidgetType = "profile"
    category: str = "custom"
    icon: str = "Sparkles"
    description: str = ""
    status: WidgetStatus = "draft"
    access_groups: List[AccessGroup] = Field(default_factory=lambda: ["all_users"])
    placements: List[WidgetType] = Field(default_factory=lambda: ["profile"])
    default_size: str = "medium"
    allowed_sizes: List[str] = Field(default_factory=lambda: DEFAULT_ALLOWED_SIZES)
    editor_config: Optional[dict] = None
    sort_order: int = 100


class WidgetPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    widget_type: Optional[WidgetType] = None
    category: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    status: Optional[WidgetStatus] = None
    access_groups: Optional[List[AccessGroup]] = None
    placements: Optional[List[WidgetType]] = None
    default_size: Optional[str] = None
    allowed_sizes: Optional[List[str]] = None
    editor_config: Optional[dict] = None
    sort_order: Optional[int] = None


class BadgeCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    key: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    icon: str = "Award"
    color: str = "#00FF66"
    description: str = ""
    status: WidgetStatus = "draft"
    assignment_type: Literal[
        "manual", "founder", "admin", "vip", "standard", "all", "first_x", "specific"
    ] = "manual"
    access_groups: List[AccessGroup] = Field(default_factory=lambda: ["all_users"])
    selected_usernames: List[str] = Field(default_factory=list)
    first_x: Optional[int] = None


class BadgePatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    status: Optional[WidgetStatus] = None
    assignment_type: Optional[str] = None
    access_groups: Optional[List[AccessGroup]] = None
    selected_usernames: Optional[List[str]] = None
    first_x: Optional[int] = None


class BadgeAssignPayload(BaseModel):
    usernames: List[str] = Field(min_length=1, max_length=500)


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

def _require_admin(current: dict):
    if not is_admin_user(current):
        raise HTTPException(status_code=403, detail="Admin or founder access required")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _viewer_groups(viewer: Optional[dict]) -> set[str]:
    """Translate the current user (or anonymous viewer) into the set of
    access groups they belong to. `all_users` is always granted."""
    groups = {"all_users"}
    if not viewer:
        return groups
    groups.add("standard")
    if viewer.get("is_vip"):
        groups.add("vip")
    if (viewer.get("username") or "").lower() == "stealth":
        groups.update({"admin", "founder"})
    if viewer.get("is_admin") or viewer.get("role") in ("admin", "moderator", "founder"):
        groups.add("admin")
    if viewer.get("role") == "founder":
        groups.add("founder")
    return groups


def _serialise_widget(doc: dict) -> dict:
    out = dict(doc)
    out.pop("_id", None)
    return out


def _serialise_badge(doc: dict) -> dict:
    out = dict(doc)
    out.pop("_id", None)
    return out


# ─────────────────────────────────────────────────────────────────────
# Seed system widgets — runs on every boot but only inserts missing
# entries; existing rows are left alone so admin edits stick.
# ─────────────────────────────────────────────────────────────────────

# Source of truth for the 16 system widgets. Mirrors the frontend
# WIDGET_TYPES list in data/mockData.js. Categories chosen from the
# spec's category list (feed/friends/media/music/podcast/events/...).
SYSTEM_WIDGETS = [
    {"key": "myfeed",    "name": "My Feed",          "category": "feed",     "icon": "Sparkles",      "default_size": "large",  "sort_order": 10},
    {"key": "top8",      "name": "Top 8 Friends",    "category": "friends",  "icon": "Users",         "default_size": "medium", "sort_order": 20},
    {"key": "live",      "name": "Live Stream",      "category": "media",    "icon": "Radio",         "default_size": "large",  "sort_order": 30},
    {"key": "videos",    "name": "Videos",           "category": "media",    "icon": "PlayCircle",    "default_size": "medium", "sort_order": 40},
    {"key": "music",     "name": "Music",            "category": "music",    "icon": "Music",         "default_size": "medium", "sort_order": 50},
    {"key": "podcasts",  "name": "Podcasts",         "category": "podcast",  "icon": "Mic",           "default_size": "medium", "sort_order": 60},
    {"key": "photos",    "name": "Photos",           "category": "media",    "icon": "Image",         "default_size": "medium", "sort_order": 70},
    {"key": "events",    "name": "Events",           "category": "events",   "icon": "Calendar",      "default_size": "small",  "sort_order": 80},
    {"key": "weather",   "name": "Weather",          "category": "weather",  "icon": "CloudSun",      "default_size": "small",  "sort_order": 90},
    {"key": "calendar",  "name": "Calendar",         "category": "calendar", "icon": "CalendarDays",  "default_size": "small",  "sort_order": 100},
    {"key": "countdown", "name": "Countdown",        "category": "calendar", "icon": "Timer",         "default_size": "small",  "sort_order": 110},
    {"key": "notes",     "name": "Notes",            "category": "notes",    "icon": "StickyNote",    "default_size": "small",  "sort_order": 120},
    {"key": "polls",     "name": "Polls",            "category": "polls",    "icon": "BarChart3",     "default_size": "medium", "sort_order": 130},
    {"key": "survey",    "name": "Survey",           "category": "survey",   "icon": "ClipboardList", "default_size": "medium", "sort_order": 140},
    {"key": "blog",      "name": "Blog",             "category": "blog",     "icon": "BookOpen",      "default_size": "medium", "sort_order": 150},
    {"key": "radar",     "name": "Stealth Radar",    "category": "custom",   "icon": "Radar",         "default_size": "medium", "sort_order": 160},
]


async def seed_system_widgets():
    """Insert any system widgets not yet in db.widget_registry. Existing
    rows (including admin-edited ones) are NEVER overwritten — admins
    can re-style the icon/description/access freely without us stomping
    on it next boot.

    Phase-2 (iter 46): system widgets default to ALL THREE placements
    (profile + home + realm) so the picker has content out-of-the-box
    on every surface. Admins can prune per-widget afterwards from
    /admin/widgets without us un-pruning on reboot."""
    now = _now_iso()
    inserted = 0
    expanded = 0
    for w in SYSTEM_WIDGETS:
        existing = await db.widget_registry.find_one({"key": w["key"]})
        if existing:
            # One-time backfill: rows seeded BEFORE phase-2 only have
            # placements=["profile"]. Expand them to all three so the
            # Home/Realm pickers aren't permanently empty. We treat
            # the exact-match ["profile"] as "never customized" and
            # leave anything else alone so admin edits stick.
            if existing.get("placements") == ["profile"]:
                await db.widget_registry.update_one(
                    {"key": w["key"]},
                    {"$set": {
                        "placements": ["profile", "home", "realm"],
                        "updated_at": now,
                    }},
                )
                expanded += 1
            continue
        await db.widget_registry.insert_one({
            "id": str(uuid.uuid4()),
            "key": w["key"],
            "name": w["name"],
            "widget_type": "profile",
            "category": w["category"],
            "icon": w["icon"],
            "description": "",
            "status": "live",
            "access_groups": ["all_users"],
            "placements": ["profile", "home", "realm"],
            "default_size": w["default_size"],
            "allowed_sizes": DEFAULT_ALLOWED_SIZES,
            "editor_config": None,
            "sort_order": w["sort_order"],
            "is_system": True,
            "created_by": "system",
            "created_at": now,
            "updated_at": now,
        })
        inserted += 1
    if inserted:
        logger.info(f"Seeded {inserted} system widgets into widget_registry")
    if expanded:
        logger.info(f"Expanded {expanded} system widgets to all 3 placements (Phase-2 backfill)")


async def ensure_indexes():
    await db.widget_registry.create_index("key", unique=True)
    await db.badge_registry.create_index("key", unique=True)
    await db.user_badges.create_index([("user_id", 1), ("badge_key", 1)], unique=True)
    await db.user_badges.create_index("username")


# ─────────────────────────────────────────────────────────────────────
# /api/admin/widgets — admin CRUD
# ─────────────────────────────────────────────────────────────────────

@router.get("/admin/widgets")
async def list_widgets_admin(
    current: CurrentUser,
    status: Optional[WidgetStatus] = None,
    placement: Optional[WidgetType] = None,
    access_group: Optional[AccessGroup] = None,
    q: Optional[str] = None,
):
    _require_admin(current)
    query: dict = {}
    if status:
        query["status"] = status
    if placement:
        query["placements"] = placement
    if access_group:
        query["access_groups"] = access_group
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"key": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
        ]
    cursor = db.widget_registry.find(query).sort([("sort_order", 1), ("name", 1)])
    items = [_serialise_widget(d) async for d in cursor]
    return {"widgets": items, "total": len(items)}


@router.post("/admin/widgets")
async def create_widget(payload: WidgetCreate, current: CurrentUser):
    _require_admin(current)
    existing = await db.widget_registry.find_one({"key": payload.key})
    if existing:
        raise HTTPException(status_code=400, detail=f"Widget key '{payload.key}' already exists")
    now = _now_iso()
    doc = payload.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "is_system": False,
        "created_by": current.get("username"),
        "created_at": now,
        "updated_at": now,
    })
    await db.widget_registry.insert_one(doc)
    return {"widget": _serialise_widget(doc)}


@router.patch("/admin/widgets/{widget_id}")
async def update_widget(widget_id: str, payload: WidgetPatch, current: CurrentUser):
    _require_admin(current)
    doc = await db.widget_registry.find_one({"id": widget_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Widget not found")
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        return {"widget": _serialise_widget(doc)}
    updates["updated_at"] = _now_iso()
    await db.widget_registry.update_one({"id": widget_id}, {"$set": updates})
    fresh = await db.widget_registry.find_one({"id": widget_id})
    return {"widget": _serialise_widget(fresh)}


@router.delete("/admin/widgets/{widget_id}")
async def delete_widget(widget_id: str, current: CurrentUser):
    _require_admin(current)
    doc = await db.widget_registry.find_one({"id": widget_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Widget not found")
    if doc.get("is_system"):
        raise HTTPException(status_code=400, detail="System widgets cannot be deleted — disable them instead")
    await db.widget_registry.delete_one({"id": widget_id})
    return {"ok": True, "deleted": widget_id}


@router.post("/admin/widgets/{widget_id}/launch")
async def launch_widget(widget_id: str, current: CurrentUser):
    _require_admin(current)
    res = await db.widget_registry.update_one(
        {"id": widget_id},
        {"$set": {"status": "live", "updated_at": _now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Widget not found")
    return {"ok": True, "status": "live"}


@router.post("/admin/widgets/{widget_id}/disable")
async def disable_widget(widget_id: str, current: CurrentUser):
    _require_admin(current)
    res = await db.widget_registry.update_one(
        {"id": widget_id},
        {"$set": {"status": "disabled", "updated_at": _now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Widget not found")
    return {"ok": True, "status": "disabled"}


# ─────────────────────────────────────────────────────────────────────
# /api/widgets/available — public (filtered to live + viewer's groups)
# ─────────────────────────────────────────────────────────────────────

@router.get("/widgets/available")
async def widgets_available(
    current: CurrentUser,
    placement: WidgetType = "profile",
):
    """Returns the widget catalogue visible to the calling user. Used
    by the Profile widget picker. Filters to status=live AND a placement
    match AND access_groups overlap with the caller's groups."""
    groups = _viewer_groups(current)
    cursor = db.widget_registry.find({
        "status": "live",
        "placements": placement,
        "access_groups": {"$in": list(groups)},
    }).sort([("sort_order", 1), ("name", 1)])
    items = [_serialise_widget(d) async for d in cursor]
    return {"widgets": items}


@router.get("/widgets/disabled")
async def widgets_disabled(current: CurrentUser):
    """Admin-only: list disabled widgets so the admin UI can show the
    'this widget is disabled' banner next to any saved user instance
    that still references it. Non-admins get an empty list."""
    if not is_admin_user(current):
        return {"keys": []}
    cursor = db.widget_registry.find(
        {"status": {"$in": ["disabled", "draft"]}},
        {"_id": 0, "key": 1, "status": 1},
    )
    return {"keys": [{"key": d["key"], "status": d["status"]} async for d in cursor]}


# ─────────────────────────────────────────────────────────────────────
# /api/admin/badges
# ─────────────────────────────────────────────────────────────────────

@router.get("/admin/badges")
async def list_badges_admin(
    current: CurrentUser,
    status: Optional[WidgetStatus] = None,
    access_group: Optional[AccessGroup] = None,
    q: Optional[str] = None,
):
    _require_admin(current)
    query: dict = {}
    if status:
        query["status"] = status
    if access_group:
        query["access_groups"] = access_group
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"key": {"$regex": q, "$options": "i"}},
        ]
    cursor = db.badge_registry.find(query).sort([("created_at", -1)])
    items = [_serialise_badge(d) async for d in cursor]
    return {"badges": items, "total": len(items)}


@router.post("/admin/badges")
async def create_badge(payload: BadgeCreate, current: CurrentUser):
    _require_admin(current)
    existing = await db.badge_registry.find_one({"key": payload.key})
    if existing:
        raise HTTPException(status_code=400, detail=f"Badge key '{payload.key}' already exists")
    now = _now_iso()
    doc = payload.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "is_system": False,
        "created_by": current.get("username"),
        "created_at": now,
        "updated_at": now,
    })
    await db.badge_registry.insert_one(doc)
    return {"badge": _serialise_badge(doc)}


@router.patch("/admin/badges/{badge_id}")
async def update_badge(badge_id: str, payload: BadgePatch, current: CurrentUser):
    _require_admin(current)
    doc = await db.badge_registry.find_one({"id": badge_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Badge not found")
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        return {"badge": _serialise_badge(doc)}
    updates["updated_at"] = _now_iso()
    await db.badge_registry.update_one({"id": badge_id}, {"$set": updates})
    fresh = await db.badge_registry.find_one({"id": badge_id})
    return {"badge": _serialise_badge(fresh)}


@router.delete("/admin/badges/{badge_id}")
async def delete_badge(badge_id: str, current: CurrentUser):
    _require_admin(current)
    doc = await db.badge_registry.find_one({"id": badge_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Badge not found")
    # Remove all assignments before tearing down the badge itself.
    await db.user_badges.delete_many({"badge_key": doc["key"]})
    await db.badge_registry.delete_one({"id": badge_id})
    return {"ok": True, "deleted": badge_id}


@router.post("/admin/badges/{badge_id}/launch")
async def launch_badge(badge_id: str, current: CurrentUser):
    _require_admin(current)
    res = await db.badge_registry.update_one(
        {"id": badge_id},
        {"$set": {"status": "live", "updated_at": _now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Badge not found")
    return {"ok": True, "status": "live"}


@router.post("/admin/badges/{badge_id}/disable")
async def disable_badge(badge_id: str, current: CurrentUser):
    _require_admin(current)
    res = await db.badge_registry.update_one(
        {"id": badge_id},
        {"$set": {"status": "disabled", "updated_at": _now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Badge not found")
    return {"ok": True, "status": "disabled"}


@router.post("/admin/badges/{badge_id}/assign")
async def assign_badge(badge_id: str, payload: BadgeAssignPayload, current: CurrentUser):
    _require_admin(current)
    badge = await db.badge_registry.find_one({"id": badge_id})
    if not badge:
        raise HTTPException(status_code=404, detail="Badge not found")
    now = _now_iso()
    assigned = 0
    for raw in payload.usernames:
        uname = (raw or "").strip().lower().lstrip("@")
        if not uname:
            continue
        user = await db.users.find_one({"username": uname}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            continue
        await db.user_badges.update_one(
            {"user_id": user["id"], "badge_key": badge["key"]},
            {"$set": {
                "id": f"{user['id']}::{badge['key']}",
                "user_id": user["id"],
                "username": user["username"],
                "badge_key": badge["key"],
                "assigned_by": current.get("username"),
                "assigned_at": now,
                "source": "admin",
            }},
            upsert=True,
        )
        assigned += 1
    return {"ok": True, "assigned": assigned}


@router.post("/admin/badges/{badge_id}/remove")
async def remove_badge(badge_id: str, payload: BadgeAssignPayload, current: CurrentUser):
    _require_admin(current)
    badge = await db.badge_registry.find_one({"id": badge_id})
    if not badge:
        raise HTTPException(status_code=404, detail="Badge not found")
    deleted = 0
    for raw in payload.usernames:
        uname = (raw or "").strip().lower().lstrip("@")
        if not uname:
            continue
        res = await db.user_badges.delete_one(
            {"username": uname, "badge_key": badge["key"]},
        )
        deleted += res.deleted_count
    return {"ok": True, "deleted": deleted}


@router.get("/admin/badges/{badge_id}/recipients")
async def list_badge_recipients(badge_id: str, current: CurrentUser, limit: int = 200):
    _require_admin(current)
    badge = await db.badge_registry.find_one({"id": badge_id})
    if not badge:
        raise HTTPException(status_code=404, detail="Badge not found")
    cursor = (
        db.user_badges
        .find({"badge_key": badge["key"]}, {"_id": 0})
        .sort("assigned_at", -1)
        .limit(min(max(1, limit), 1000))
    )
    rows = [doc async for doc in cursor]
    return {"recipients": rows, "total": len(rows)}


# ─────────────────────────────────────────────────────────────────────
# /api/profile/{username}/badges — PUBLIC
# Returns only LIVE badges that the user has been awarded. Disabled or
# draft badges are hidden from the public surface (admin sees them in
# the admin console instead).
# ─────────────────────────────────────────────────────────────────────

@router.get("/profile/{username}/badges")
async def list_profile_badges(username: str):
    uname = (username or "").strip().lower().lstrip("@")
    cursor = db.user_badges.find({"username": uname})
    keys = [doc["badge_key"] async for doc in cursor]
    if not keys:
        return {"badges": []}
    # Fetch only LIVE badges; disabled badges silently disappear from
    # the public surface even if assignments still exist.
    badges = []
    async for b in db.badge_registry.find(
        {"key": {"$in": keys}, "status": "live"},
        {"_id": 0},
    ):
        badges.append({
            "key": b["key"],
            "name": b.get("name"),
            "icon": b.get("icon"),
            "color": b.get("color"),
            "description": b.get("description"),
        })
    return {"badges": badges}


__all__ = ["router", "seed_system_widgets", "ensure_indexes"]
