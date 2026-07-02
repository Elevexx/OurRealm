"""Portals 1.3 — Founder-only Realm override & Portal Platform Foundation.

Stores per-realm overrides for the Portal Development Hub. The metadata
catalogue in `/frontend/src/lib/portals/realmMetadata.js` is the STATIC
default; this router lets the founder + admins persist mutations WITHOUT
editing source: notes, status, enable/disable, roadmap notes, performance
notes, platform readiness (iOS ARKit / Android ARCore / visionOS / Meta
Quest / WebXR / desktop preview / mobile fallback), Asset Scroll refs,
Unity deployment metadata, and AR/VR compatibility.

Every mutation writes an entry to the embedded `audit_history` array so
the founder can review who changed what and when.

MongoDB collection: `portal_realm_overrides`
Document shape (id-keyed by realm_id):
    {
      "realm_id":               "rainforest",
      "notes":                  "…free-form founder notes…",
      "status":                 "founder_preview",
      "enabled":                true,
      "version":                "1.1.0",
      "platform_readiness":     { "ios_arkit": {…}, "android_arcore": {…}, … },
      "asset_scrolls":          [ { "assetScrollId": …, "name": …, … } ],
      "unity_deployment":       { "unityProjectName": …, … },
      "ar_vr_compatibility":    { … },
      "roadmap_notes":          "…",
      "performance_notes":      "…",
      "audit_history":          [ { at, by_id, by_username, field, action, before, after } ],
      "updated_at":             ISO string,
      "updated_by_id":          "...",
      "updated_by_username":    "stealth",
    }

Every endpoint is gated by `require_admin(user)`; anon/non-admin traffic
receives 401/403 respectively.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Path, Body
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser, require_admin

router = APIRouter(prefix="/api/admin/portals", tags=["admin-portals"])

COLLECTION = "portal_realm_overrides"
AUDIT_LIMIT = 200  # keep at most 200 audit entries per realm

# ─────────────────────────────────────────────────────────────────────
# Statuses (must stay in sync with frontend realmMetadata.js)
# ─────────────────────────────────────────────────────────────────────
VALID_STATUSES = {
    "draft", "internal_testing", "founder_preview",
    "private_beta", "public_beta", "released", "disabled",
}

# Known realm ids (must stay in sync with frontend realmMetadata.js).
# We validate the path param against this set to prevent random realm
# ids from being persisted.
VALID_REALM_IDS = {
    "rainforest", "aquarium", "cyberpunk", "snow", "desert", "volcano",
    "space", "fantasy", "jurassic", "ancient-ruins", "tropical-island",
    "moon-colony",
}

# Platform keys tracked by the platform-readiness block.
PLATFORM_KEYS = {
    "ios_arkit", "android_arcore", "visionos", "meta_quest",
    "webxr", "desktop_preview", "mobile_non_ar_fallback",
}

# ─────────────────────────────────────────────────────────────────────
# Pydantic input schemas
# ─────────────────────────────────────────────────────────────────────
class NotesBody(BaseModel):
    notes: str = Field(default="", max_length=8000)


class StatusBody(BaseModel):
    status: str


class ToggleBody(BaseModel):
    enabled: bool


class PlatformReadinessEntry(BaseModel):
    supported: Optional[bool] = None
    status: Optional[str] = None
    minimum_device_requirements: Optional[str] = Field(None, max_length=1000)
    build_target: Optional[str] = Field(None, max_length=200)
    unity_build_profile: Optional[str] = Field(None, max_length=200)
    deployment_path: Optional[str] = Field(None, max_length=500)
    known_limitations: Optional[str] = Field(None, max_length=2000)
    testing_status: Optional[str] = Field(None, max_length=200)
    last_tested_at: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=2000)


class PlatformReadinessBody(BaseModel):
    platform: str  # must be in PLATFORM_KEYS
    entry: PlatformReadinessEntry


class AssetScrollRef(BaseModel):
    asset_scroll_id: str = Field(..., max_length=200)
    name: str = Field(..., max_length=200)
    category: Optional[str] = Field(None, max_length=100)  # trees | rocks | animals | …
    status: Optional[str] = Field(None, max_length=50)
    supported_platforms: Optional[List[str]] = None
    source_type: Optional[str] = Field(None, max_length=50)  # 'unity_prefab' | 'web' | 'gltf' | …
    file_type: Optional[str] = Field(None, max_length=50)
    unity_prefab_path: Optional[str] = Field(None, max_length=500)
    web_asset_path: Optional[str] = Field(None, max_length=500)
    thumbnail: Optional[str] = Field(None, max_length=500)
    version: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = Field(None, max_length=2000)
    approved_by: Optional[str] = Field(None, max_length=100)
    approved_at: Optional[str] = None


class AssetScrollsBody(BaseModel):
    # Replaces the entire list of assets attached to the realm — simple
    # and predictable for the admin UI. Individual add/remove endpoints
    # can be added later without breaking this contract.
    asset_scrolls: List[AssetScrollRef] = Field(default_factory=list, max_length=500)


class UnityDeploymentBody(BaseModel):
    unity_project_name:      Optional[str] = Field(None, max_length=200)
    unity_scene_name:        Optional[str] = Field(None, max_length=200)
    unity_build_target:      Optional[str] = Field(None, max_length=200)
    unity_bundle_id:         Optional[str] = Field(None, max_length=200)
    unity_version:           Optional[str] = Field(None, max_length=50)
    asset_bundle_url:        Optional[str] = Field(None, max_length=500)
    addressables_catalog_url:Optional[str] = Field(None, max_length=500)
    webgl_build_url:         Optional[str] = Field(None, max_length=500)
    ios_build_status:        Optional[str] = Field(None, max_length=100)
    android_build_status:    Optional[str] = Field(None, max_length=100)
    visionos_build_status:   Optional[str] = Field(None, max_length=100)
    quest_build_status:      Optional[str] = Field(None, max_length=100)
    release_channel:         Optional[str] = Field(None, max_length=50)
    deployment_notes:        Optional[str] = Field(None, max_length=4000)


class ArVrCompatibilityBody(BaseModel):
    ar_supported: Optional[bool]                 = None
    vr_supported: Optional[bool]                 = None
    passthrough_ar_supported: Optional[bool]     = None
    hand_tracking_supported: Optional[bool]      = None
    controller_supported: Optional[bool]         = None
    minimum_ios_version: Optional[str]           = Field(None, max_length=20)
    minimum_android_version: Optional[str]       = Field(None, max_length=20)
    minimum_visionos_version: Optional[str]      = Field(None, max_length=20)
    minimum_quest_firmware: Optional[str]        = Field(None, max_length=20)
    webxr_features_used: Optional[List[str]]     = None
    known_incompatibilities: Optional[str]       = Field(None, max_length=2000)


class TextFieldBody(BaseModel):
    """Used by roadmap-notes + performance-notes."""
    value: str = Field(default="", max_length=8000)


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_realm_id(realm_id: str) -> None:
    if realm_id not in VALID_REALM_IDS:
        raise HTTPException(status_code=404, detail=f"Realm not registered: {realm_id}")


def _clean(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Strip Mongo internals + return an API-safe dict."""
    if not doc:
        return {}
    d = {k: v for k, v in doc.items() if k != "_id"}
    return d


async def _append_audit(
    realm_id: str,
    user: dict,
    field: str,
    action: str,
    before: Any = None,
    after: Any = None,
) -> None:
    entry = {
        "at": _now_iso(),
        "by_id": user.get("id"),
        "by_username": user.get("username"),
        "field": field,
        "action": action,
        "before": before,
        "after": after,
    }
    # Push + trim history to AUDIT_LIMIT most-recent entries.
    await db[COLLECTION].update_one(
        {"realm_id": realm_id},
        {
            "$push": {
                "audit_history": {
                    "$each": [entry],
                    "$slice": -AUDIT_LIMIT,
                },
            },
        },
    )


async def _apply_mutation(
    realm_id: str,
    user: dict,
    field: str,
    action: str,
    fields_to_set: Dict[str, Any],
    before_value: Any = None,
    after_value: Any = None,
) -> Dict[str, Any]:
    """Upsert the realm override doc, apply `fields_to_set`, then push audit
    history. Returns the persisted document."""
    _validate_realm_id(realm_id)
    now = _now_iso()
    update = {
        "$set": {
            **fields_to_set,
            "realm_id":            realm_id,
            "updated_at":          now,
            "updated_by_id":       user.get("id"),
            "updated_by_username": user.get("username"),
        },
        "$setOnInsert": {
            "created_at": now,
        },
    }
    await db[COLLECTION].update_one({"realm_id": realm_id}, update, upsert=True)
    await _append_audit(realm_id, user, field, action, before_value, after_value)
    doc = await db[COLLECTION].find_one({"realm_id": realm_id})
    return _clean(doc)


async def _get_override(realm_id: str) -> Optional[Dict[str, Any]]:
    _validate_realm_id(realm_id)
    doc = await db[COLLECTION].find_one({"realm_id": realm_id})
    return _clean(doc) if doc else None


# ─────────────────────────────────────────────────────────────────────
# Read endpoints
# ─────────────────────────────────────────────────────────────────────
@router.get("/overrides")
async def list_overrides(user: CurrentUser) -> Dict[str, Any]:
    """List every persisted realm override. Founder/admin only."""
    require_admin(user)
    cursor = db[COLLECTION].find({}, projection={"_id": 0})
    items = [d async for d in cursor]
    return {"count": len(items), "overrides": items}


@router.get("/{realm_id}/override")
async def get_override(user: CurrentUser, realm_id: str = Path(...)) -> Dict[str, Any]:
    require_admin(user)
    doc = await _get_override(realm_id)
    return {"realm_id": realm_id, "override": doc}


# ─────────────────────────────────────────────────────────────────────
# Mutation endpoints
# ─────────────────────────────────────────────────────────────────────
@router.post("/{realm_id}/notes")
async def set_notes(
    user: CurrentUser,
    realm_id: str = Path(...),
    body: NotesBody = Body(...),
) -> Dict[str, Any]:
    require_admin(user)
    existing = await _get_override(realm_id)
    before = (existing or {}).get("notes")
    doc = await _apply_mutation(
        realm_id, user, "notes", "update",
        {"notes": body.notes},
        before_value=before, after_value=body.notes,
    )
    return {"ok": True, "override": doc}


@router.post("/{realm_id}/status")
async def set_status(
    user: CurrentUser,
    realm_id: str = Path(...),
    body: StatusBody = Body(...),
) -> Dict[str, Any]:
    require_admin(user)
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status: {body.status}")
    existing = await _get_override(realm_id)
    before = (existing or {}).get("status")
    doc = await _apply_mutation(
        realm_id, user, "status", "update",
        {"status": body.status},
        before_value=before, after_value=body.status,
    )
    return {"ok": True, "override": doc}


@router.post("/{realm_id}/toggle")
async def toggle_enabled(
    user: CurrentUser,
    realm_id: str = Path(...),
    body: ToggleBody = Body(...),
) -> Dict[str, Any]:
    require_admin(user)
    existing = await _get_override(realm_id)
    before = (existing or {}).get("enabled")
    # A toggle to "disabled" also sets status='disabled' so the two
    # concepts stay consistent for public gating. Re-enabling leaves
    # the persisted status alone; the founder can bump it separately.
    fields = {"enabled": body.enabled}
    if body.enabled is False:
        fields["status"] = "disabled"
    doc = await _apply_mutation(
        realm_id, user, "enabled", "toggle",
        fields,
        before_value=before, after_value=body.enabled,
    )
    return {"ok": True, "override": doc}


@router.post("/{realm_id}/platform-readiness")
async def set_platform_readiness(
    user: CurrentUser,
    realm_id: str = Path(...),
    body: PlatformReadinessBody = Body(...),
) -> Dict[str, Any]:
    require_admin(user)
    if body.platform not in PLATFORM_KEYS:
        raise HTTPException(status_code=422, detail=f"Unknown platform: {body.platform}")
    existing = await _get_override(realm_id)
    before = ((existing or {}).get("platform_readiness") or {}).get(body.platform)
    # Merge — dropping None fields so admins can PATCH-style-update.
    merged = dict(before or {})
    for k, v in body.entry.model_dump().items():
        if v is not None:
            merged[k] = v
    fields = {f"platform_readiness.{body.platform}": merged}
    doc = await _apply_mutation(
        realm_id, user, f"platform_readiness.{body.platform}", "update",
        fields,
        before_value=before, after_value=merged,
    )
    return {"ok": True, "override": doc}


@router.post("/{realm_id}/asset-scrolls")
async def set_asset_scrolls(
    user: CurrentUser,
    realm_id: str = Path(...),
    body: AssetScrollsBody = Body(...),
) -> Dict[str, Any]:
    require_admin(user)
    existing = await _get_override(realm_id)
    before = (existing or {}).get("asset_scrolls")
    after = [ref.model_dump(exclude_none=True) for ref in body.asset_scrolls]
    doc = await _apply_mutation(
        realm_id, user, "asset_scrolls", "replace",
        {"asset_scrolls": after},
        before_value=before, after_value=after,
    )
    return {"ok": True, "override": doc}


@router.post("/{realm_id}/unity-deployment")
async def set_unity_deployment(
    user: CurrentUser,
    realm_id: str = Path(...),
    body: UnityDeploymentBody = Body(...),
) -> Dict[str, Any]:
    require_admin(user)
    existing = await _get_override(realm_id)
    before = (existing or {}).get("unity_deployment")
    merged = dict(before or {})
    for k, v in body.model_dump().items():
        if v is not None:
            merged[k] = v
    doc = await _apply_mutation(
        realm_id, user, "unity_deployment", "update",
        {"unity_deployment": merged},
        before_value=before, after_value=merged,
    )
    return {"ok": True, "override": doc}


@router.post("/{realm_id}/ar-vr-compatibility")
async def set_ar_vr_compatibility(
    user: CurrentUser,
    realm_id: str = Path(...),
    body: ArVrCompatibilityBody = Body(...),
) -> Dict[str, Any]:
    require_admin(user)
    existing = await _get_override(realm_id)
    before = (existing or {}).get("ar_vr_compatibility")
    merged = dict(before or {})
    for k, v in body.model_dump().items():
        if v is not None:
            merged[k] = v
    doc = await _apply_mutation(
        realm_id, user, "ar_vr_compatibility", "update",
        {"ar_vr_compatibility": merged},
        before_value=before, after_value=merged,
    )
    return {"ok": True, "override": doc}


@router.post("/{realm_id}/roadmap-notes")
async def set_roadmap_notes(
    user: CurrentUser,
    realm_id: str = Path(...),
    body: TextFieldBody = Body(...),
) -> Dict[str, Any]:
    require_admin(user)
    existing = await _get_override(realm_id)
    before = (existing or {}).get("roadmap_notes")
    doc = await _apply_mutation(
        realm_id, user, "roadmap_notes", "update",
        {"roadmap_notes": body.value},
        before_value=before, after_value=body.value,
    )
    return {"ok": True, "override": doc}


@router.post("/{realm_id}/performance-notes")
async def set_performance_notes(
    user: CurrentUser,
    realm_id: str = Path(...),
    body: TextFieldBody = Body(...),
) -> Dict[str, Any]:
    require_admin(user)
    existing = await _get_override(realm_id)
    before = (existing or {}).get("performance_notes")
    doc = await _apply_mutation(
        realm_id, user, "performance_notes", "update",
        {"performance_notes": body.value},
        before_value=before, after_value=body.value,
    )
    return {"ok": True, "override": doc}


# ─────────────────────────────────────────────────────────────────────
# Deletion (soft — resets a realm override to catalogue defaults)
# ─────────────────────────────────────────────────────────────────────
@router.delete("/{realm_id}/override")
async def delete_override(
    user: CurrentUser,
    realm_id: str = Path(...),
) -> Dict[str, Any]:
    """Hard-delete the persisted override so the realm reverts to the
    catalogue defaults in `realmMetadata.js`. Audit history is kept in a
    parallel `portal_realm_overrides_deleted` collection for forensics."""
    require_admin(user)
    _validate_realm_id(realm_id)
    doc = await db[COLLECTION].find_one_and_delete({"realm_id": realm_id})
    if doc:
        snapshot = _clean(doc)
        snapshot["deleted_at"] = _now_iso()
        snapshot["deleted_by_id"] = user.get("id")
        snapshot["deleted_by_username"] = user.get("username")
        await db["portal_realm_overrides_deleted"].insert_one(snapshot)
        return {"ok": True, "deleted": True}
    return {"ok": True, "deleted": False}
