"""Responsibility Center — Admin Media API (Bundle B).

/api/admin/responsibility-center/media/*  — founder/admin, permission
`responsibility_center.manage_media` for mutations, `.view` for reads.
/api/responsibility-center/media/manifest — authenticated, delivery info only.

Binary uploads happen through the EXISTING /api/images/upload pipeline;
these endpoints accept only the resulting durable URLs.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser
from routers.rc_admin import require_rc_perm, _audit, _require_reason
from services import rc_media
from services import responsibility_center as rc

log = logging.getLogger("ourrealm.rc.media.api")

router = APIRouter(prefix="/api", tags=["rc-media"])

# Static usage map for admin visibility ("View Usage Locations").
USAGE_MAP = {
    "responsibility_center.main_logo": ["Responsibility Center hub header", "Account Settings → Centers tab"],
    "responsibility_center.compact_logo": ["Hub header (small screens)", "Admin Responsibility Center header"],
    "responsibility_center.navigation_icon": ["Settings page entry", "Account Settings Centers tab header"],
    "responsibility_center.admin_icon": ["Admin Hub card", "Admin Responsibility Center header"],
    "responsibility_center.default_center_icon": ["Center cards without type artwork", "Center dashboard header fallback"],
    "responsibility_center.landing.hero": ["Responsibility Center hub hero"],
    "responsibility_center.landing.no_centers": ["Hub empty state"],
    "responsibility_center.landing.paused_member": ["Paused-member notice screen"],
    "responsibility_center.landing.create_center": ["Create Center wizard"],
}


# ── Authenticated manifest (cached) ─────────────────────────────────────
@router.get("/responsibility-center/media/manifest")
async def rc_media_manifest(current: CurrentUser):
    return await rc_media.build_manifest()


# ── Admin: asset registry ───────────────────────────────────────────────
@router.get("/admin/responsibility-center/media/assets")
async def rc_media_assets(current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    await rc_media.ensure_media_indexes()
    docs = {d["asset_key"]: d async for d in db.rc_system_assets.find({}, {"_id": 0})}
    active = {}
    async for v in db.rc_system_asset_versions.find(
            {"status": "active"}, {"_id": 0}):
        active.setdefault(v["asset_key"], []).append(v)
    counts = {}
    async for r in db.rc_system_asset_versions.aggregate(
            [{"$group": {"_id": "$asset_key", "n": {"$sum": 1}}}]):
        counts[r["_id"]] = r["n"]
    sections = {}
    for cat, items in rc_media.RC_ASSET_CATALOG.items():
        rows = []
        for entry in items:
            key = entry["asset_key"]
            doc = docs.get(key) or {}
            act = active.get(key) or []
            default_active = next((v for v in act
                                   if (v.get("theme_variant") or "default") == "default"
                                   and (v.get("device_variant") or "default") == "default"), None)
            rows.append({
                **entry, "category": cat,
                "alt_text": doc.get("alt_text") or entry["display_name"],
                "active": default_active,
                "variant_actives": [v for v in act if v is not default_active],
                "version_count": counts.get(key, 0),
                "updated_by": doc.get("updated_by"), "updated_at": doc.get("updated_at"),
                "usage": USAGE_MAP.get(key, ["Responsibility Center pages"]),
            })
        sections[cat] = rows
    return {"sections": sections, "branding": await rc_media.get_branding(),
            "theme_variants": rc_media.THEME_VARIANTS,
            "device_variants": rc_media.DEVICE_VARIANTS}


@router.get("/admin/responsibility-center/media/assets/{asset_key}/versions")
async def rc_media_versions(asset_key: str, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    return {"versions": await rc_media.list_versions(asset_key),
            "asset": await rc_media.get_asset(asset_key)}


class VersionBody(BaseModel):
    url: str
    reason: str
    theme_variant: str = "default"
    device_variant: str = "default"
    file_meta: Optional[dict] = None
    activate: bool = False


@router.post("/admin/responsibility-center/media/assets/{asset_key}/versions")
async def rc_media_upload_version(asset_key: str, body: VersionBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_media")
    reason = _require_reason(body.reason)
    row = await rc_media.create_version(current, asset_key, body.url, reason,
                                        body.theme_variant, body.device_variant,
                                        body.file_meta)
    await _audit(current, "media_version_uploaded", reason,
                 extra={"asset_key": asset_key, "version_id": row["id"],
                        "version": row["version"], "file_meta": row["file_meta"]})
    if body.activate:
        prev = await rc_media.get_asset(asset_key)
        row = await rc_media.activate_version(current, asset_key, row["id"])
        await _audit(current, "media_version_activated", reason,
                     before={"active_version_id": prev.get("active_version_id")},
                     after={"active_version_id": row["id"]},
                     extra={"asset_key": asset_key})
    return {"ok": True, "version": row}


class ReasonBody(BaseModel):
    reason: str


@router.post("/admin/responsibility-center/media/assets/{asset_key}/versions/{version_id}/activate")
async def rc_media_activate(asset_key: str, version_id: str, body: ReasonBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_media")
    reason = _require_reason(body.reason)
    prev = await rc_media.get_asset(asset_key)
    row = await rc_media.activate_version(current, asset_key, version_id)
    await _audit(current, "media_version_activated", reason,
                 before={"active_version_id": prev.get("active_version_id")},
                 after={"active_version_id": version_id},
                 extra={"asset_key": asset_key, "restore": True})
    return {"ok": True, "version": row}


@router.post("/admin/responsibility-center/media/assets/{asset_key}/reset")
async def rc_media_reset(asset_key: str, body: ReasonBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_media")
    reason = _require_reason(body.reason)
    prev = await rc_media.get_asset(asset_key)
    r = await rc_media.reset_to_default(current, asset_key)
    await _audit(current, "media_reset_to_default", reason,
                 before={"active_version_id": prev.get("active_version_id")},
                 after={"active_version_id": None},
                 extra={"asset_key": asset_key, **r})
    return {"ok": True, **r}


class AltBody(BaseModel):
    alt_text: str
    reason: str


@router.patch("/admin/responsibility-center/media/assets/{asset_key}")
async def rc_media_alt(asset_key: str, body: AltBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_media")
    reason = _require_reason(body.reason)
    rc_media.catalog_entry(asset_key)
    alt = (body.alt_text or "").strip()[:200]
    prev = await rc_media.get_asset(asset_key)
    await db.rc_system_assets.update_one(
        {"asset_key": asset_key},
        {"$set": {"alt_text": alt, "updated_at": rc_media._now(),
                  "updated_by": current.get("username")},
         "$setOnInsert": {"asset_key": asset_key, "active_version_id": None}},
        upsert=True)
    rc_media.invalidate_manifest_cache()
    await _audit(current, "media_alt_text_changed", reason,
                 before={"alt_text": prev.get("alt_text")}, after={"alt_text": alt},
                 extra={"asset_key": asset_key})
    return {"ok": True, "alt_text": alt}


# ── Branding configuration ──────────────────────────────────────────────
class BrandingBody(BaseModel):
    updates: dict
    reason: str


_BRANDING_TEXT = {"product_name": 80, "short_name": 40, "tagline": 120}
_BRANDING_FLAGS = {"center_branding_enabled", "template_logo_overrides_enabled",
                   "user_center_logo_allowed", "user_center_cover_allowed"}


@router.get("/admin/responsibility-center/media/branding")
async def rc_branding_get(current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    return {"branding": await rc_media.get_branding(),
            "defaults": rc_media.BRANDING_DEFAULTS}


@router.patch("/admin/responsibility-center/media/branding")
async def rc_branding_patch(body: BrandingBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_media")
    reason = _require_reason(body.reason)
    current_b = await rc_media.get_branding()
    sets, changes = {}, []
    for key, value in (body.updates or {}).items():
        if key in _BRANDING_TEXT:
            value = str(value or "").strip()
            if not value or len(value) > _BRANDING_TEXT[key]:
                raise HTTPException(status_code=400,
                                    detail=f"{key} must be 1–{_BRANDING_TEXT[key]} characters")
        elif key in _BRANDING_FLAGS:
            value = bool(value)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown branding setting: {key}")
        if current_b.get(key) != value:
            sets[key] = value
            changes.append({"key": key, "previous": current_b.get(key), "new": value})
    if sets:
        await db.rc_branding.update_one(
            {"_id": "branding"},
            {"$set": {**sets, "updated_at": rc_media._now(),
                      "updated_by": current.get("username")}},
            upsert=True)
        rc_media.invalidate_manifest_cache()
        await _audit(current, "branding_changed", reason,
                     before={c["key"]: c["previous"] for c in changes},
                     after={c["key"]: c["new"] for c in changes})
    return {"ok": True, "changed": changes, "branding": await rc_media.get_branding()}


# ── Center-specific branding foundation (feature-flagged) ────────────────
class CenterBrandingBody(BaseModel):
    logo_url: Optional[str] = None
    icon_url: Optional[str] = None
    cover_url: Optional[str] = None
    accent: Optional[str] = None
    clear: bool = False


@router.patch("/responsibility-center/{center_id}/branding")
async def rc_center_branding(center_id: str, body: CenterBrandingBody, current: CurrentUser):
    branding = await rc_media.get_branding()
    if not branding.get("center_branding_enabled"):
        raise HTTPException(status_code=403, detail="Center-specific branding is not enabled on this platform")
    center, membership = await rc._center_and_membership(center_id, current["id"])
    if not rc.has_permission(membership, "edit_center"):
        raise HTTPException(status_code=403, detail="You don't have permission to edit this Center's branding")
    if body.clear:
        await db.responsibility_centers.update_one(
            {"id": center_id}, {"$unset": {"branding": ""}})
        await rc.log_activity(center_id, current, "branding_cleared",
                              f"@{current.get('username')} removed Center branding")
        return {"ok": True, "branding": None}
    sets = {}
    for field, flag in (("logo_url", "user_center_logo_allowed"),
                        ("icon_url", "user_center_logo_allowed"),
                        ("cover_url", "user_center_cover_allowed")):
        url = getattr(body, field)
        if url is not None:
            if not branding.get(flag):
                raise HTTPException(status_code=403, detail=f"Center {field.replace('_url', '')} uploads are not enabled")
            if not rc_media.durable(url):
                raise HTTPException(status_code=400, detail="Only durable uploaded media URLs are accepted")
            sets[f"branding.{field}"] = url
    if body.accent is not None:
        accent = str(body.accent).strip()
        import re as _re
        if not _re.match(r"^#[0-9A-Fa-f]{6}$", accent):
            raise HTTPException(status_code=400, detail="Accent must be a hex color like #F4C84A")
        sets["branding.accent"] = accent
    if not sets:
        return {"ok": True, "branding": center.get("branding")}
    await db.responsibility_centers.update_one({"id": center_id}, {"$set": sets})
    await rc.log_activity(center_id, current, "branding_updated",
                          f"@{current.get('username')} updated Center branding")
    fresh = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0, "branding": 1})
    return {"ok": True, "branding": fresh.get("branding")}
