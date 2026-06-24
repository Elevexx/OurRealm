"""Widgets & Badges admin registry.

Two Mongo-backed registries that power the `/admin/widgets` console:
  • db.widget_registry — every widget the app knows about, including
    the 16 system widgets (seeded on first boot, `is_system=True`) and
    any custom widgets the founder defines via the builder.
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

Phase 2A — Custom Widget Builder (Feb 2026):
  • Custom widget create/clone/rollback is GATED to @stealth only.
    Backend enforces this; the UI mirrors it but is not the source
    of truth. Other admins still see + manage existing widgets.
  • editor_config follows a versioned schema (see core/widget_layouts).
  • Every write snapshots the previous (layout, fields, data) into
    `versions[]` (capped at 20) so rollback is one click.
  • Templates live in core/widget_templates and are cloned on creation.

Disabled widget behaviour (option C):
  • status=disabled widgets DO NOT appear in /api/widgets/available.
  • The profile public-read endpoint hard-hides any saved widget
    whose key references a disabled registry entry.
  • Admins viewing the profile see a banner instead (frontend gates
    this — backend just returns a `disabled` flag on the widget body).
"""
from datetime import datetime, timezone
from typing import List, Optional, Literal, Any
import logging
import re
import uuid

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict

from core.db import db
from core.deps import CurrentUser, is_admin_user
from core.widget_types import ALLOWED_WIDGET_TYPES
from core.widget_layouts import (
    LAYOUT_KEYS,
    FIELD_TYPE_KEYS,
    CATEGORY_GROUP_KEYS,
    schema_payload,
)
from core.widget_templates import TEMPLATES, get_template

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
MAX_VERSION_HISTORY = 20  # cap so a runaway editor doesn't bloat the doc.
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,62}$")


class WidgetCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    key: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    widget_type: WidgetType = "profile"
    category: str = "custom"
    category_group: str = "custom"
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
    category_group: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    status: Optional[WidgetStatus] = None
    access_groups: Optional[List[AccessGroup]] = None
    placements: Optional[List[WidgetType]] = None
    default_size: Optional[str] = None
    allowed_sizes: Optional[List[str]] = None
    editor_config: Optional[dict] = None
    sort_order: Optional[int] = None


class WidgetClonePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    key: str = Field(min_length=2, max_length=64)
    name: Optional[str] = None


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


def _is_stealth(current: Optional[dict]) -> bool:
    """Phase 2A guard: custom widget create/edit/clone/rollback is
    restricted to the founder account (@stealth) only. Other admins
    can still launch/disable/delete existing widgets, just not author
    new ones."""
    if not current:
        return False
    return (current.get("username") or "").lower() == "stealth"


def _require_stealth(current: dict):
    _require_admin(current)
    if not _is_stealth(current):
        raise HTTPException(
            status_code=403,
            detail="Custom widget authoring is restricted to the founder account.",
        )


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
# editor_config validation
# ─────────────────────────────────────────────────────────────────────

def _validate_editor_config(cfg: Any) -> Optional[dict]:
    """Lightweight schema validation. Custom widgets MUST provide an
    editor_config with a known layout and a list of fields each typed
    against FIELD_TYPE_KEYS. System widgets are allowed to keep
    editor_config=None (legacy behaviour)."""
    if cfg is None:
        return None
    if not isinstance(cfg, dict):
        raise HTTPException(status_code=400, detail="editor_config must be an object")
    layout = cfg.get("layout")
    if layout and layout not in LAYOUT_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown layout '{layout}'")
    fields = cfg.get("fields") or []
    if not isinstance(fields, list):
        raise HTTPException(status_code=400, detail="editor_config.fields must be a list")
    seen_keys: set[str] = set()
    cleaned_fields: list[dict] = []
    for raw in fields:
        if not isinstance(raw, dict):
            raise HTTPException(status_code=400, detail="Each field must be an object")
        fkey = (raw.get("key") or "").strip()
        ftype = (raw.get("type") or "").strip()
        if not fkey:
            raise HTTPException(status_code=400, detail="Field is missing 'key'")
        if not KEY_RE.match(fkey):
            raise HTTPException(status_code=400, detail=f"Invalid field key '{fkey}' (snake_case, ≤64 chars)")
        if fkey in seen_keys:
            raise HTTPException(status_code=400, detail=f"Duplicate field key '{fkey}'")
        seen_keys.add(fkey)
        if ftype not in FIELD_TYPE_KEYS:
            raise HTTPException(status_code=400, detail=f"Unknown field type '{ftype}'")
        cleaned_fields.append(raw)
    data = cfg.get("data") or {}
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="editor_config.data must be an object")
    data_source = cfg.get("data_source") or {"kind": "static", "api": None, "refresh_seconds": 0}
    if not isinstance(data_source, dict):
        raise HTTPException(status_code=400, detail="editor_config.data_source must be an object")
    kind = data_source.get("kind") or "static"
    if kind not in ("static", "api"):
        raise HTTPException(status_code=400, detail="data_source.kind must be 'static' or 'api'")
    if kind == "api":
        # Validate the API-backed payload. Lazy-imported so the registry
        # module never depends on Phase-3 provider tables at import time.
        from core.api_providers import get_provider, get_endpoint
        prov_key = data_source.get("provider")
        ep_key = data_source.get("endpoint_key")
        if not prov_key or not get_provider(prov_key):
            raise HTTPException(status_code=400, detail=f"data_source.provider '{prov_key}' is unknown")
        if not ep_key or not get_endpoint(prov_key, ep_key):
            raise HTTPException(status_code=400, detail=f"data_source.endpoint_key '{ep_key}' is unknown for provider '{prov_key}'")
        if "params" in data_source and not isinstance(data_source["params"], dict):
            raise HTTPException(status_code=400, detail="data_source.params must be an object")
        if "response_map" in data_source and not isinstance(data_source["response_map"], dict):
            raise HTTPException(status_code=400, detail="data_source.response_map must be an object (field_key → jsonpath)")
        if "array_bindings" in data_source:
            ab = data_source["array_bindings"]
            if not isinstance(ab, list):
                raise HTTPException(status_code=400, detail="data_source.array_bindings must be a list")
            for i, b in enumerate(ab):
                if not isinstance(b, dict):
                    raise HTTPException(status_code=400, detail=f"array_bindings[{i}] must be an object")
                if not b.get("field_key"):
                    raise HTTPException(status_code=400, detail=f"array_bindings[{i}].field_key is required")
                if not isinstance(b.get("array_path", ""), str):
                    raise HTTPException(status_code=400, detail=f"array_bindings[{i}].array_path must be a string")
                im = b.get("item_map", {})
                if im and not isinstance(im, dict):
                    raise HTTPException(status_code=400, detail=f"array_bindings[{i}].item_map must be an object")
    theme = cfg.get("theme") or {}
    limits = cfg.get("limits") or {}
    return {
        "schema_version": int(cfg.get("schema_version") or 1),
        "layout": layout,
        "fields": cleaned_fields,
        "data": data,
        "data_source": data_source,
        "theme": theme if isinstance(theme, dict) else {},
        "limits": limits if isinstance(limits, dict) else {},
    }


def _snapshot_version(existing: dict, current_user: dict) -> List[dict]:
    """Push the current editor_config + name into versions[] before
    overwriting. Returns the new versions array (capped)."""
    versions = list(existing.get("versions") or [])
    snap = {
        "version": int(existing.get("version") or 1),
        "name": existing.get("name"),
        "editor_config": existing.get("editor_config"),
        "category_group": existing.get("category_group"),
        "icon": existing.get("icon"),
        "default_size": existing.get("default_size"),
        "snapshotted_at": _now_iso(),
        "snapshotted_by": current_user.get("username"),
    }
    versions.insert(0, snap)
    return versions[:MAX_VERSION_HISTORY]


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
            "category_group": "social",
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
            "owner_scope": "system",
            "owner_id": None,
            "version": 1,
            "versions": [],
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
    category_group: Optional[str] = None,
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
    if category_group:
        query["category_group"] = category_group
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
    """Create a custom widget. Phase 2A: restricted to @stealth."""
    _require_stealth(current)
    if not KEY_RE.match(payload.key):
        raise HTTPException(status_code=400, detail="Key must be snake_case (a-z, 0-9, _; start with a letter)")
    existing = await db.widget_registry.find_one({"key": payload.key})
    if existing:
        raise HTTPException(status_code=400, detail=f"Widget key '{payload.key}' already exists")
    if payload.category_group and payload.category_group not in CATEGORY_GROUP_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown category_group '{payload.category_group}'")
    now = _now_iso()
    editor_cfg = _validate_editor_config(payload.editor_config)
    doc = payload.model_dump()
    doc["editor_config"] = editor_cfg
    doc.update({
        "id": str(uuid.uuid4()),
        "is_system": False,
        "owner_scope": "admin",
        "owner_id": current.get("id") or current.get("username"),
        "version": 1,
        "versions": [],
        "created_by": current.get("username"),
        "created_at": now,
        "updated_at": now,
    })
    await db.widget_registry.insert_one(doc)
    return {"widget": _serialise_widget(doc)}


@router.patch("/admin/widgets/{widget_id}")
async def update_widget(widget_id: str, payload: WidgetPatch, current: CurrentUser):
    """Update widget metadata. Custom-widget content edits (name,
    editor_config, icon, category_group, default_size) require
    @stealth — other admins can still toggle access/placements/status
    on EXISTING widgets so VIP/disabled flips don't require the
    founder."""
    _require_admin(current)
    doc = await db.widget_registry.find_one({"id": widget_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Widget not found")
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        return {"widget": _serialise_widget(doc)}

    # Stealth-only fields — anything that changes the *content* of a
    # widget. Non-stealth admins are allowed to flip status/access/
    # placements/allowed_sizes/sort_order only.
    content_keys = {"name", "editor_config", "icon", "category_group",
                    "default_size", "description", "category", "widget_type"}
    if not _is_stealth(current) and (set(updates.keys()) & content_keys):
        raise HTTPException(
            status_code=403,
            detail="Editing widget content (name, layout, fields) is restricted to the founder.",
        )

    if "category_group" in updates and updates["category_group"] not in CATEGORY_GROUP_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown category_group '{updates['category_group']}'")

    # Snapshot version BEFORE applying content changes (so rollback
    # has the prior state). Skip snapshot for trivial flips like
    # status/access_groups/placements/sort_order.
    snapshot_triggers = {"name", "editor_config", "icon", "default_size", "category_group"}
    if set(updates.keys()) & snapshot_triggers:
        new_versions = _snapshot_version(doc, current)
        updates["versions"] = new_versions
        updates["version"] = int(doc.get("version") or 1) + 1

    if "editor_config" in updates:
        updates["editor_config"] = _validate_editor_config(updates["editor_config"])

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
# Phase 2A — Builder schema, templates, clone, versions
# ─────────────────────────────────────────────────────────────────────

@router.get("/admin/widgets/schema")
async def get_builder_schema(current: CurrentUser):
    """Returns the layout + field-type + category catalog the builder
    UI hydrates from. Admins only — viewable by anyone with admin role
    so they can preview, but only @stealth can act on it."""
    _require_admin(current)
    return schema_payload()


@router.get("/admin/widgets/templates")
async def list_widget_templates(current: CurrentUser):
    _require_admin(current)
    out = []
    for t in TEMPLATES:
        out.append({
            "key": t["key"],
            "name": t["name"],
            "icon": t["icon"],
            "category_group": t["category_group"],
            "description": t["description"],
            "default_size": t["default_size"],
            "layout": t["editor_config"]["layout"],
        })
    return {"templates": out}


@router.post("/admin/widgets/from-template/{template_key}")
async def create_from_template(template_key: str, payload: WidgetClonePayload, current: CurrentUser):
    """Spawns a draft widget pre-filled with the template's editor_config.
    @stealth-only — same gate as create_widget."""
    _require_stealth(current)
    tpl = get_template(template_key)
    if not tpl:
        raise HTTPException(status_code=404, detail=f"Template '{template_key}' not found")
    if not KEY_RE.match(payload.key):
        raise HTTPException(status_code=400, detail="Key must be snake_case (a-z, 0-9, _; start with a letter)")
    if await db.widget_registry.find_one({"key": payload.key}):
        raise HTTPException(status_code=400, detail=f"Widget key '{payload.key}' already exists")
    now = _now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "key": payload.key,
        "name": payload.name or tpl["name"],
        "widget_type": "profile",
        "category": tpl["category_group"],
        "category_group": tpl["category_group"],
        "icon": tpl["icon"],
        "description": tpl["description"],
        "status": "draft",
        "access_groups": ["all_users"],
        "placements": ["profile"],
        "default_size": tpl["default_size"],
        "allowed_sizes": DEFAULT_ALLOWED_SIZES,
        "editor_config": _validate_editor_config(tpl["editor_config"]),
        "sort_order": 200,
        "is_system": False,
        "owner_scope": "admin",
        "owner_id": current.get("id") or current.get("username"),
        "template_key": template_key,
        "version": 1,
        "versions": [],
        "created_by": current.get("username"),
        "created_at": now,
        "updated_at": now,
    }
    await db.widget_registry.insert_one(doc)
    return {"widget": _serialise_widget(doc)}


@router.post("/admin/widgets/{widget_id}/clone")
async def clone_widget(widget_id: str, payload: WidgetClonePayload, current: CurrentUser):
    """Duplicate an existing widget (system or custom) into a new
    DRAFT widget with a different key. @stealth-only."""
    _require_stealth(current)
    src = await db.widget_registry.find_one({"id": widget_id})
    if not src:
        raise HTTPException(status_code=404, detail="Widget not found")
    if not KEY_RE.match(payload.key):
        raise HTTPException(status_code=400, detail="Key must be snake_case (a-z, 0-9, _; start with a letter)")
    if await db.widget_registry.find_one({"key": payload.key}):
        raise HTTPException(status_code=400, detail=f"Widget key '{payload.key}' already exists")
    now = _now_iso()
    doc = dict(src)
    doc.pop("_id", None)
    doc.update({
        "id": str(uuid.uuid4()),
        "key": payload.key,
        "name": payload.name or f"{src.get('name')} (Copy)",
        "status": "draft",
        "is_system": False,
        "owner_scope": "admin",
        "owner_id": current.get("id") or current.get("username"),
        "cloned_from": src["id"],
        "cloned_from_key": src.get("key"),
        "version": 1,
        "versions": [],
        "created_by": current.get("username"),
        "created_at": now,
        "updated_at": now,
    })
    await db.widget_registry.insert_one(doc)
    return {"widget": _serialise_widget(doc)}


@router.get("/admin/widgets/{widget_id}/versions")
async def list_widget_versions(widget_id: str, current: CurrentUser):
    _require_admin(current)
    doc = await db.widget_registry.find_one({"id": widget_id}, {"_id": 0, "versions": 1, "version": 1, "key": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Widget not found")
    return {
        "current_version": int(doc.get("version") or 1),
        "versions": doc.get("versions") or [],
    }


@router.post("/admin/widgets/{widget_id}/rollback/{version}")
async def rollback_widget(widget_id: str, version: int, current: CurrentUser):
    """Restore a snapshot from versions[]. Snapshots the current state
    first so rollback itself is reversible. @stealth-only."""
    _require_stealth(current)
    doc = await db.widget_registry.find_one({"id": widget_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Widget not found")
    versions = doc.get("versions") or []
    target = next((v for v in versions if int(v.get("version") or 0) == int(version)), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Version {version} not found")
    new_versions = _snapshot_version(doc, current)
    updates = {
        "name": target.get("name") or doc.get("name"),
        "editor_config": _validate_editor_config(target.get("editor_config")),
        "category_group": target.get("category_group") or doc.get("category_group"),
        "icon": target.get("icon") or doc.get("icon"),
        "default_size": target.get("default_size") or doc.get("default_size"),
        "version": int(doc.get("version") or 1) + 1,
        "versions": new_versions,
        "updated_at": _now_iso(),
    }
    await db.widget_registry.update_one({"id": widget_id}, {"$set": updates})
    fresh = await db.widget_registry.find_one({"id": widget_id})
    return {"widget": _serialise_widget(fresh)}


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


@router.get("/widgets/registry/{key}")
async def get_widget_by_key(key: str):
    """Public read of a single registry entry by key. Used by the
    CustomWidgetRenderer to hydrate editor_config (layout + fields)
    for any widget instance saved on a profile. Returns 404 for
    disabled/draft widgets so public surfaces stay hard-hidden."""
    doc = await db.widget_registry.find_one({"key": key, "status": "live"}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Widget not found or not live")
    return {"widget": doc}


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
