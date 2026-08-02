"""AI Access Policy routes — founder rule builder + user-facing state.

Founder: /api/admin/ai-policies/*  ·  Users: /api/ai-policies/me
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import access_policy as ap

log = logging.getLogger("ourrealm.access_policy.routes")
router = APIRouter(prefix="/api/admin/ai-policies", tags=["ai-policies-admin"])
public_router = APIRouter(prefix="/api/ai-policies", tags=["ai-policies"])


def _iso():
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def list_policies(current: CurrentUser):
    require_founder(current)
    out = []
    for key, meta in ap.AI_FEATURES.items():
        policy = await ap.get_policy(key)
        grants = await db.ai_access_grants.count_documents({"feature_key": key})
        out.append({"feature_key": key, **meta, "policy": policy, "grant_count": grants,
                    "usage": await ap.usage_summary(key)})
    return {"features": out, "role_options": ap.ROLE_OPTIONS,
            "bypass_options": ap.BYPASS_OPTIONS}


@router.get("/badges")
async def list_badges(current: CurrentUser):
    require_founder(current)
    rows = await db.badge_registry.find({}, {"_id": 0, "key": 1, "name": 1}).to_list(200)
    return {"badges": rows}


@router.patch("/{feature_key}")
async def patch_policy(feature_key: str, body: dict, current: CurrentUser):
    require_founder(current)
    if feature_key not in ap.AI_FEATURES:
        raise HTTPException(status_code=404, detail="Unknown AI feature")
    reason = (body.get("reason") or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="A short written reason is required")
    policy = await ap.update_policy(feature_key, body, current, reason)
    return {"policy": policy}


@router.get("/{feature_key}/grants")
async def list_grants(feature_key: str, current: CurrentUser):
    require_founder(current)
    rows = await db.ai_access_grants.find(
        {"feature_key": feature_key}, {"_id": 0}).sort("created_at", -1).to_list(200)
    now = _iso()
    for g in rows:
        g["active"] = not (g.get("expires_at") and g["expires_at"] < now)
    return {"grants": rows}


@router.post("/{feature_key}/grants")
async def add_grant(feature_key: str, body: dict, current: CurrentUser):
    require_founder(current)
    if feature_key not in ap.AI_FEATURES:
        raise HTTPException(status_code=404, detail="Unknown AI feature")
    username = (body.get("username") or "").strip().lstrip("@")
    u = await db.users.find_one({"username": username}, {"_id": 0, "id": 1, "username": 1})
    if not u:
        raise HTTPException(status_code=404, detail="No user with that username")
    doc = {"id": uuid.uuid4().hex, "feature_key": feature_key,
           "user_id": u["id"], "username": u["username"],
           "granted_by": current.get("username"), "note": str(body.get("note") or "")[:300],
           "expires_at": body.get("expires_at") or None, "created_at": _iso()}
    await db.ai_access_grants.update_one(
        {"feature_key": feature_key, "user_id": u["id"]}, {"$set": doc}, upsert=True)
    await ap.audit(current, "grant_added", feature_key, target=u["username"])
    return {"grant": doc}


@router.delete("/{feature_key}/grants/{grant_id}")
async def remove_grant(feature_key: str, grant_id: str, current: CurrentUser):
    require_founder(current)
    g = await db.ai_access_grants.find_one({"id": grant_id, "feature_key": feature_key}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Grant not found")
    await db.ai_access_grants.delete_one({"id": grant_id})
    await ap.audit(current, "grant_removed", feature_key, target=g.get("username"))
    return {"ok": True}


@router.post("/{feature_key}/simulate")
async def simulate(feature_key: str, body: dict, current: CurrentUser):
    """Founder test bench: evaluate the policy as any user (nothing consumed)."""
    require_founder(current)
    if feature_key not in ap.AI_FEATURES:
        raise HTTPException(status_code=404, detail="Unknown AI feature")
    username = (body.get("username") or "").strip().lstrip("@")
    u = await db.users.find_one({"username": username}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="No user with that username")
    res = await ap.check_access(feature_key, u, center_id=body.get("center_id"), consume=False)
    return {"username": u["username"], "allowed": res["allowed"],
            "reason": res["reason"], "trace": res["trace"],
            "remaining": res.get("remaining", {})}


@router.get("/{feature_key}/audit")
async def feature_audit(feature_key: str, current: CurrentUser):
    require_founder(current)
    rows = await db.ai_access_audit.find(
        {"feature_key": feature_key}, {"_id": 0}).sort("at", -1).to_list(100)
    return {"audit": rows}


@public_router.get("/me")
async def my_access(current: CurrentUser, center_id: str = None):
    """Per-feature allowed/denied state for the current user (nothing consumed)."""
    out = {}
    for key in ap.AI_FEATURES:
        res = await ap.check_access(key, current, center_id=center_id, consume=False)
        out[key] = {"allowed": res["allowed"], "reason": res["reason"],
                    "remaining": res.get("remaining", {})}
    return {"features": out}
