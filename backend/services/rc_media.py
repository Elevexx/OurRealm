"""Responsibility Center — centralized system-asset registry (Bundle B).

Follows the established OurRealm media pattern (website_media.py): binary
uploads go through the EXISTING /api/images/upload R2 pipeline (MIME +
signature + size + content-safety validation); this registry stores only
durable delivery URLs, never files. No branding is hardcoded in
components — everything resolves through stable asset keys with safe
built-in fallbacks.

Collections (additive):
  rc_system_assets          — one doc per asset_key (active pointer, alt text)
  rc_system_asset_versions  — full version history (inactive → active → deactivated)
  rc_branding               — product name / tagline / feature flags (_id="branding")
"""
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from core.db import db

log = logging.getLogger("ourrealm.rc.media")

DURABLE_URL_RE = re.compile(
    r"^(/api/(media|images|videos)/[A-Za-z0-9._/-]+|https://[A-Za-z0-9.-]+/[^\s]*)$")

THEME_VARIANTS = ["default", "neon", "millennium", "stealth", "business",
                  "light", "dark", "high_contrast"]
DEVICE_VARIANTS = ["default", "desktop", "tablet", "mobile", "compact"]

# ── Asset catalogue — stable keys, grouped by Admin Media section ────────
def _k(key, name, desc, w=512, h=512, transparent=True):
    return {"asset_key": key, "display_name": name, "description": desc,
            "recommended_width": w, "recommended_height": h,
            "transparency_supported": transparent}


RC_ASSET_CATALOG = {
    "branding": [
        _k("responsibility_center.main_logo", "Main Logo", "Primary Responsibility Center logo shown on the landing hub and headers", 1024, 512),
        _k("responsibility_center.compact_logo", "Compact Logo", "Small square logo for tight spaces", 256, 256),
        _k("responsibility_center.navigation_icon", "Navigation Icon", "Top-navigation icon — must stay readable at small sizes", 96, 96),
        _k("responsibility_center.mobile_menu_icon", "Mobile Menu Icon", "Icon used in mobile navigation entries", 96, 96),
        _k("responsibility_center.admin_icon", "Admin Icon", "Icon for the Responsibility Center admin card and pages", 128, 128),
        _k("responsibility_center.default_center_icon", "Default Center Icon", "Fallback icon for Centers without custom branding", 256, 256),
        _k("responsibility_center.favicon_icon", "Favicon-style Icon", "App-style square icon", 64, 64),
        _k("responsibility_center.light_background_logo", "Light-Background Logo", "Logo variant for light surfaces", 1024, 512),
        _k("responsibility_center.dark_background_logo", "Dark-Background Logo", "Logo variant for dark surfaces", 1024, 512),
        _k("responsibility_center.monochrome_logo", "Monochrome Logo", "Single-color accessibility variant", 1024, 512),
    ],
    "landing": [
        _k("responsibility_center.landing.hero", "Landing Hero", "Hero image on the Responsibility Center hub", 1536, 640, False),
        _k("responsibility_center.landing.header_background", "Header Background", "Background art behind the hub header", 1920, 480, False),
        _k("responsibility_center.landing.overview_illustration", "Overview Illustration", "Explainer illustration", 800, 600),
        _k("responsibility_center.landing.create_center", "Create Center Illustration", "Shown in the creation wizard", 800, 600),
        _k("responsibility_center.landing.no_centers", "No Centers Empty State", "Shown when a user has no Centers", 640, 480),
        _k("responsibility_center.landing.pending_invitation", "Pending Invitation", "Shown next to pending invites", 640, 480),
        _k("responsibility_center.landing.low_vault", "Low Vault Warning", "Shown with low Center Vault warnings", 640, 480),
        _k("responsibility_center.landing.paused_center", "Paused Center", "Shown for paused Centers", 640, 480),
        _k("responsibility_center.landing.paused_member", "Paused Member Notice", "Shown on the paused-member screen", 640, 480),
        _k("responsibility_center.landing.success", "Success Illustration", "Shown after successful actions", 640, 480),
    ],
    "center_types": [
        _k(f"responsibility_center.type.{t}", f"{t.replace('_', ' ').title()} Type Artwork",
           f"Icon / card artwork for the {t.replace('_', ' ')} Center type", 512, 512)
        for t in ["personal", "family", "education", "business", "department",
                  "organization", "church", "sports", "community", "volunteer",
                  "team", "custom", "ai_teams_future"]
    ],
    "dashboard": [
        _k(f"responsibility_center.dashboard.{t}", f"Dashboard — {t.replace('_', ' ').title()}",
           f"Dashboard asset: {t.replace('_', ' ')}", 800, 400)
        for t in ["default_banner", "default_cover", "members", "tasks", "calendar",
                  "reports", "rewards", "vault", "permissions", "notifications",
                  "activity", "renewals", "empty_state"]
    ],
    "education": [
        _k(f"responsibility_center.education.{t}", f"Education — {t.replace('_', ' ').title()}",
           f"Education Center asset: {t.replace('_', ' ')} (media support only — features ship later)", 512, 512)
        for t in ["logo", "compact_icon", "default_cover", "student_avatar",
                  "teacher_avatar", "lessons_empty", "assignments_empty",
                  "grade_report", "transcript", "attendance", "ai_tutor"]
    ],
    "admin_system": [
        _k(f"responsibility_center.admin.{t}", f"Admin — {t.replace('_', ' ').title()}",
           f"Admin area asset: {t.replace('_', ' ')}", 800, 300)
        for t in ["header", "center_management", "vault", "renewals", "audit", "settings", "media"]
    ] + [
        _k(f"responsibility_center.system.{t}", f"System — {t.replace('_', ' ').title()}",
           f"System state asset: {t.replace('_', ' ')}", 640, 480)
        for t in ["warning", "error", "maintenance", "frozen_vault", "action_required"]
    ],
}
CATALOG_BY_KEY = {a["asset_key"]: {**a, "category": cat}
                  for cat, items in RC_ASSET_CATALOG.items() for a in items}

BRANDING_DEFAULTS = {
    "product_name": "OurRealm Responsibility Center",
    "short_name": "Responsibility Center",
    "tagline": "One System. Endless Possibilities.",
    "center_branding_enabled": False,
    "template_logo_overrides_enabled": False,
    "user_center_logo_allowed": False,
    "user_center_cover_allowed": False,
}

_manifest_cache = {"at": 0.0, "data": None}
_INDEXES_READY = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def durable(url: Optional[str]) -> bool:
    return (bool(url) and not str(url).startswith(("blob:", "data:"))
            and bool(DURABLE_URL_RE.match(str(url))))


def invalidate_manifest_cache() -> None:
    _manifest_cache["data"] = None


async def ensure_media_indexes() -> None:
    global _INDEXES_READY
    if _INDEXES_READY:
        return
    try:
        await db.rc_system_assets.create_index([("asset_key", 1)], unique=True, name="uniq_key")
        await db.rc_system_asset_versions.create_index(
            [("asset_key", 1), ("created_at", -1)], name="by_key_time")
    except Exception as e:  # noqa: BLE001
        log.warning(f"[rc-media] index init issue: {e}")
    _INDEXES_READY = True


def catalog_entry(asset_key: str) -> dict:
    entry = CATALOG_BY_KEY.get(asset_key)
    if not entry:
        raise HTTPException(status_code=404, detail="Unknown asset key")
    return entry


async def get_asset(asset_key: str) -> dict:
    entry = catalog_entry(asset_key)
    doc = await db.rc_system_assets.find_one({"asset_key": asset_key}, {"_id": 0}) or {}
    return {**entry, "alt_text": doc.get("alt_text") or entry["display_name"],
            "active_version_id": doc.get("active_version_id"),
            "updated_by": doc.get("updated_by"), "updated_at": doc.get("updated_at")}


async def get_branding() -> dict:
    doc = await db.rc_branding.find_one({"_id": "branding"}) or {}
    return {**BRANDING_DEFAULTS,
            **{k: doc[k] for k in BRANDING_DEFAULTS if k in doc}}


async def build_manifest() -> dict:
    """Authenticated manifest — ONLY delivery info (url/alt/variants).
    Cached 30s server-side; invalidated on every activation."""
    now = time.monotonic()
    if _manifest_cache["data"] is not None and now - _manifest_cache["at"] < 30:
        return _manifest_cache["data"]
    assets: dict = {}
    async for v in db.rc_system_asset_versions.find(
            {"status": "active"},
            {"_id": 0, "asset_key": 1, "url": 1, "theme_variant": 1,
             "device_variant": 1, "id": 1}):
        slot = assets.setdefault(v["asset_key"], {"url": None, "variants": {}})
        theme = v.get("theme_variant") or "default"
        device = v.get("device_variant") or "default"
        if theme == "default" and device == "default":
            slot["url"] = v["url"]
        else:
            slot["variants"][f"{theme}:{device}"] = v["url"]
    alt_map = {}
    async for a in db.rc_system_assets.find({}, {"_id": 0, "asset_key": 1, "alt_text": 1}):
        if a.get("alt_text"):
            alt_map[a["asset_key"]] = a["alt_text"]
    for key, slot in assets.items():
        slot["alt"] = alt_map.get(key) or CATALOG_BY_KEY.get(key, {}).get("display_name", "")
    branding = await get_branding()
    data = {"assets": assets, "branding": branding, "generated_at": _now()}
    _manifest_cache.update(at=now, data=data)
    return data


# ── Version lifecycle ────────────────────────────────────────────────────
async def create_version(admin: dict, asset_key: str, url: str, reason: str,
                         theme_variant: str = "default",
                         device_variant: str = "default",
                         file_meta: Optional[dict] = None) -> dict:
    await ensure_media_indexes()
    catalog_entry(asset_key)
    if not durable(url):
        raise HTTPException(status_code=400,
                            detail="Only durable uploaded media URLs are accepted — upload through the media pipeline first")
    if theme_variant not in THEME_VARIANTS or device_variant not in DEVICE_VARIANTS:
        raise HTTPException(status_code=400, detail="Unknown theme or device variant")
    count = await db.rc_system_asset_versions.count_documents({"asset_key": asset_key})
    row = {
        "id": uuid.uuid4().hex, "asset_key": asset_key, "url": url,
        "version": count + 1, "status": "inactive",
        "theme_variant": theme_variant, "device_variant": device_variant,
        "uploaded_by": admin["id"], "uploaded_by_username": admin.get("username"),
        "upload_reason": (reason or "")[:300],
        "file_meta": {k: file_meta.get(k) for k in
                      ("width", "height", "file_type", "file_size")} if file_meta else {},
        "created_at": _now(), "activated_at": None, "deactivated_at": None,
    }
    await db.rc_system_asset_versions.insert_one({**row})
    await db.rc_system_assets.update_one(
        {"asset_key": asset_key},
        {"$set": {"updated_at": _now(), "updated_by": admin.get("username")},
         "$setOnInsert": {"asset_key": asset_key, "alt_text": None,
                          "active_version_id": None}},
        upsert=True)
    return row


async def activate_version(admin: dict, asset_key: str, version_id: str) -> dict:
    """One active version per (asset_key, theme, device). Activation is a
    single conditional flip; concurrent activations resolve to exactly one."""
    catalog_entry(asset_key)
    v = await db.rc_system_asset_versions.find_one(
        {"id": version_id, "asset_key": asset_key}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")
    if v["status"] == "active":
        return v
    now = _now()
    await db.rc_system_asset_versions.update_many(
        {"asset_key": asset_key, "status": "active",
         "theme_variant": v.get("theme_variant") or "default",
         "device_variant": v.get("device_variant") or "default"},
        {"$set": {"status": "deactivated", "deactivated_at": now}})
    res = await db.rc_system_asset_versions.update_one(
        {"id": version_id, "status": {"$ne": "active"}},
        {"$set": {"status": "active", "activated_at": now, "deactivated_at": None}})
    if res.modified_count != 1:
        raise HTTPException(status_code=409, detail="Version was already activated")
    await db.rc_system_assets.update_one(
        {"asset_key": asset_key},
        {"$set": {"active_version_id": version_id, "updated_at": now,
                  "updated_by": admin.get("username")}},
        upsert=True)
    invalidate_manifest_cache()
    return await db.rc_system_asset_versions.find_one({"id": version_id}, {"_id": 0})


async def reset_to_default(admin: dict, asset_key: str) -> dict:
    """Deactivate all custom versions — components fall back to the
    built-in default. History is preserved for restore."""
    catalog_entry(asset_key)
    now = _now()
    res = await db.rc_system_asset_versions.update_many(
        {"asset_key": asset_key, "status": "active"},
        {"$set": {"status": "deactivated", "deactivated_at": now}})
    await db.rc_system_assets.update_one(
        {"asset_key": asset_key},
        {"$set": {"active_version_id": None, "updated_at": now,
                  "updated_by": admin.get("username")}},
        upsert=True)
    invalidate_manifest_cache()
    return {"deactivated": res.modified_count}


async def list_versions(asset_key: str) -> list:
    catalog_entry(asset_key)
    return await db.rc_system_asset_versions.find(
        {"asset_key": asset_key}, {"_id": 0}).sort("created_at", -1).to_list(50)
