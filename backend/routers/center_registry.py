"""Universal Center registry endpoints — types, terminology, modules."""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import center_registry as creg
from services.responsibility_center import _center_and_membership, _require_member

router = APIRouter(prefix="/api/centers", tags=["center-registry"])
admin_router = APIRouter(prefix="/api/admin/centers", tags=["center-registry-admin"])


def _iso():
    return datetime.now(timezone.utc).isoformat()


@router.get("/registry")
async def centers_registry(current: CurrentUser):
    return await creg.get_registry()


@router.get("/{center_id}/config")
async def center_config(center_id: str, current: CurrentUser):
    center, membership = await _center_and_membership(center_id, current["id"])
    if not center:
        raise HTTPException(status_code=404, detail="Center not found")
    _require_member(membership)
    return await creg.get_center_config(center)


@router.patch("/{center_id}/modules")
async def patch_center_modules(center_id: str, body: dict, current: CurrentUser):
    center, membership = await _center_and_membership(center_id, current["id"])
    if not center:
        raise HTTPException(status_code=404, detail="Center not found")
    m = _require_member(membership)
    if m.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only Center owners/admins can change modules")
    overrides = {}
    for k, v in (body.get("modules") or {}).items():
        if k in creg.ALL_MODULE_KEYS and v in ("enabled", "disabled", "hidden", "required"):
            if k in creg.CORE_MODULES and v in ("disabled", "hidden"):
                continue  # core modules can't be turned off
            overrides[k] = v
    await db.responsibility_centers.update_one(
        {"id": center_id}, {"$set": {"module_config": overrides, "updated_at": _iso()}})
    center["module_config"] = overrides
    return await creg.get_center_config(center)


@admin_router.patch("/registry/{type_key}")
async def patch_type_registry(type_key: str, body: dict, current: CurrentUser):
    require_founder(current)
    await creg.ensure_seed()
    prev = await db.center_type_registry.find_one({"key": type_key}, {"_id": 0})
    if not prev:
        raise HTTPException(status_code=404, detail="Center type not found")
    patch = {}
    if isinstance(body.get("terminology"), dict):
        patch["terminology"] = {k: str(v)[:60] for k, v in body["terminology"].items()}
    if isinstance(body.get("default_modules"), list):
        patch["default_modules"] = sorted(set(
            [m for m in body["default_modules"] if m in creg.ALL_MODULE_KEYS] + creg.CORE_MODULES))
    if isinstance(body.get("creator_tools"), list):
        patch["creator_tools"] = [t for t in body["creator_tools"] if t in creg.CREATOR_TOOLS]
    if "enabled" in body:
        patch["enabled"] = bool(body["enabled"])
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to update")
    patch["updated_at"], patch["updated_by"] = _iso(), current.get("username")
    await db.center_type_registry.update_one({"key": type_key}, {"$set": patch})
    await db.center_registry_audit.insert_one({
        "type_key": type_key, "changed_by": current.get("username"),
        "prev": prev, "patch": {k: v for k, v in patch.items()}, "at": _iso()})
    doc = await db.center_type_registry.find_one({"key": type_key}, {"_id": 0})
    return {"type": doc}
