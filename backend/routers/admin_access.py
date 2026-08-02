"""OurRealm Global Access Control — founder control plane + public status.

/api/admin/access-control/* — FOUNDER ONLY (no ordinary admin bypass).
/api/access-control/status  — public, drives frontend nav/banners/screens.
Every change is audited (actor, before/after, reason, timestamp).
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import access_control as ac

log = logging.getLogger("ourrealm.access_control.api")

router = APIRouter(prefix="/api/admin/access-control", tags=["admin-access-control"])
public_router = APIRouter(prefix="/api/access-control", tags=["access-control"])


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# ── Public status ────────────────────────────────────────────────────────
@public_router.get("/status")
async def access_status(request: Request):
    user = await ac._resolve_user(request)
    return await ac.status_for_user(user)


@public_router.get("/preview-demo")
async def preview_demo():
    settings = await ac.get_settings()
    rc_mode, _ = ac.effective_mode(settings, "responsibility_center")
    preview_open = settings["features"].get("rc_public_preview", {}).get("mode") == "full_access"
    if rc_mode != "public_preview" and not preview_open:
        raise HTTPException(status_code=404, detail="Not found")
    return ac.DEMO_PREVIEW


# ── Founder control plane ────────────────────────────────────────────────
@router.get("")
async def get_control_panel(user: CurrentUser):
    require_founder(user)
    settings = await ac.get_settings(fresh=True)
    schedules = await db.access_control_schedules.find(
        {"status": {"$ne": "canceled"}}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {
        "settings": settings,
        "registry": {k: {kk: vv for kk, vv in v.items()}
                     for k, v in ac.FEATURES.items()},
        "modes": ac.MODES,
        "schedules": schedules,
        "emergency_locked": settings.get("pre_lock_snapshot") is not None,
    }


class FeaturePatch(BaseModel):
    mode: str
    message: Optional[str] = None
    custom_rules: Optional[dict] = None
    reason: str = ""


@router.patch("/features/{feature_key}")
async def patch_feature(feature_key: str, body: FeaturePatch, user: CurrentUser):
    require_founder(user)
    if feature_key not in ac.FEATURES:
        raise HTTPException(status_code=404, detail="Unknown feature")
    if body.mode not in ac.MODES:
        raise HTTPException(status_code=400, detail="Unknown mode")
    await ac.apply_mode_change(feature_key, body.mode, body.message, user, body.reason)
    if body.custom_rules is not None:
        await db.global_access_settings.update_one(
            {"id": ac.SETTINGS_ID},
            {"$set": {f"features.{feature_key}.custom_rules": {
                "allow_reads": bool(body.custom_rules.get("allow_reads", True)),
                "allow_writes": bool(body.custom_rules.get("allow_writes", False))}}})
        ac.invalidate_cache()
    settings = await ac.get_settings(fresh=True)
    return {"ok": True, "feature": settings["features"][feature_key]}


class EmergencyLockBody(BaseModel):
    engage: bool
    reason: str = ""


@router.post("/emergency-lock")
async def emergency_lock(body: EmergencyLockBody, user: CurrentUser):
    """Engage: snapshot all modes → set everything to emergency_lock.
    Disengage: restore snapshot exactly (safe restore path). Skipped
    scheduled jobs are NEVER replayed after restore."""
    require_founder(user)
    settings = await ac.get_settings(fresh=True)
    if body.engage:
        if settings.get("pre_lock_snapshot"):
            return {"ok": True, "already_locked": True}
        snapshot = {k: v.get("mode", "full_access")
                    for k, v in settings["features"].items()}
        updates = {f"features.{k}.mode": "emergency_lock" for k in ac.FEATURES
                   if k != "rc_public_preview"}
        updates["features.rc_public_preview.mode"] = "hidden"
        updates["pre_lock_snapshot"] = snapshot
        updates["updated_at"] = _now_iso()
        await db.global_access_settings.update_one({"id": ac.SETTINGS_ID}, {"$set": updates})
        ac.invalidate_cache()
        await ac.audit(user, "emergency_lock_engaged", "all", snapshot,
                       {"mode": "emergency_lock"}, body.reason)
        return {"ok": True, "locked": True}
    snapshot = settings.get("pre_lock_snapshot")
    if not snapshot:
        return {"ok": True, "already_unlocked": True}
    updates = {f"features.{k}.mode": m for k, m in snapshot.items() if k in ac.FEATURES}
    updates["pre_lock_snapshot"] = None
    updates["updated_at"] = _now_iso()
    await db.global_access_settings.update_one({"id": ac.SETTINGS_ID}, {"$set": updates})
    ac.invalidate_cache()
    await ac.audit(user, "emergency_lock_restored", "all",
                   {"mode": "emergency_lock"}, snapshot, body.reason)
    return {"ok": True, "locked": False}


# ── Emergency-access allowlist (founder approval, reason, start, expiry) ─
class AllowlistBody(BaseModel):
    username: str
    reason: str
    starts_at: str
    expires_at: str


@router.post("/allowlist")
async def add_allowlist(body: AllowlistBody, user: CurrentUser):
    require_founder(user)
    if not body.reason.strip():
        raise HTTPException(status_code=400, detail="A reason is required")
    target = await db.users.find_one({"username": body.username.lower().strip()}, {"_id": 0, "id": 1, "username": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if body.expires_at <= body.starts_at:
        raise HTTPException(status_code=400, detail="Expiration must be after start")
    entry = {"id": str(uuid.uuid4()), "user_id": target["id"],
             "username": target["username"], "reason": body.reason.strip(),
             "starts_at": body.starts_at, "expires_at": body.expires_at,
             "approved_by": user["username"], "created_at": _now_iso()}
    await db.global_access_settings.update_one(
        {"id": ac.SETTINGS_ID}, {"$push": {"emergency_allowlist": entry}})
    ac.invalidate_cache()
    await ac.audit(user, "allowlist_granted", target["username"], None, entry, body.reason)
    return {"ok": True, "entry": entry}


@router.delete("/allowlist/{entry_id}")
async def remove_allowlist(entry_id: str, user: CurrentUser):
    require_founder(user)
    settings = await ac.get_settings(fresh=True)
    entry = next((e for e in settings.get("emergency_allowlist", []) if e["id"] == entry_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    await db.global_access_settings.update_one(
        {"id": ac.SETTINGS_ID}, {"$pull": {"emergency_allowlist": {"id": entry_id}}})
    ac.invalidate_cache()
    await ac.audit(user, "allowlist_revoked", entry["username"], entry, None, "")
    return {"ok": True}


class InvitedBody(BaseModel):
    usernames: list[str]


@router.put("/invited")
async def set_invited(body: InvitedBody, user: CurrentUser):
    require_founder(user)
    cleaned = sorted({u.lower().strip() for u in body.usernames if u.strip()})
    settings = await ac.get_settings(fresh=True)
    before = settings.get("invited_usernames", [])
    await db.global_access_settings.update_one(
        {"id": ac.SETTINGS_ID}, {"$set": {"invited_usernames": cleaned}})
    ac.invalidate_cache()
    await ac.audit(user, "invited_list_updated", "invite_only", before, cleaned, "")
    return {"ok": True, "invited_usernames": cleaned}


# ── Scheduled transitions ────────────────────────────────────────────────
class ScheduleBody(BaseModel):
    feature_key: str
    target_mode: str
    kind: str  # one_time | recurring
    run_at: Optional[str] = None
    days: Optional[list[str]] = None
    time_local: Optional[str] = None
    timezone: Optional[str] = None
    message: Optional[str] = None


@router.post("/schedules")
async def create_schedule(body: ScheduleBody, user: CurrentUser):
    require_founder(user)
    if body.feature_key not in ac.FEATURES:
        raise HTTPException(status_code=404, detail="Unknown feature")
    if body.target_mode not in ac.MODES:
        raise HTTPException(status_code=400, detail="Unknown mode")
    if body.kind == "one_time":
        if not body.run_at:
            raise HTTPException(status_code=400, detail="run_at required (UTC ISO)")
        doc = {"id": str(uuid.uuid4()), "kind": "one_time",
               "feature_key": body.feature_key, "target_mode": body.target_mode,
               "run_at": body.run_at, "status": "pending",
               "message": body.message,
               "created_by": user["username"], "created_at": _now_iso()}
    elif body.kind == "recurring":
        days = [d for d in (body.days or []) if d in ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]]
        if not days or not body.time_local:
            raise HTTPException(status_code=400, detail="days and time_local required")
        doc = {"id": str(uuid.uuid4()), "kind": "recurring",
               "feature_key": body.feature_key, "target_mode": body.target_mode,
               "days": days, "time_local": body.time_local,
               "timezone": body.timezone or "UTC", "active": True,
               "last_run_key": None, "message": body.message,
               "created_by": user["username"], "created_at": _now_iso()}
    else:
        raise HTTPException(status_code=400, detail="kind must be one_time or recurring")
    await db.access_control_schedules.insert_one({**doc})
    doc.pop("_id", None)
    await ac.audit(user, "schedule_created", body.feature_key, None, doc, "")
    return {"ok": True, "schedule": doc}


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str, user: CurrentUser):
    require_founder(user)
    doc = await db.access_control_schedules.find_one({"id": schedule_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await db.access_control_schedules.update_one(
        {"id": schedule_id}, {"$set": {"status": "canceled", "active": False}})
    await ac.audit(user, "schedule_canceled", doc["feature_key"], doc, None, "")
    return {"ok": True}


# ── Impact preview (before every access change) ──────────────────────────
@router.get("/impact")
async def impact_preview(feature: str, mode: str, user: CurrentUser):
    require_founder(user)
    if feature not in ac.FEATURES:
        raise HTTPException(status_code=404, detail="Unknown feature")
    reg = ac.FEATURES[feature]
    children = [k for k, v in ac.FEATURES.items() if feature in v.get("parents", [])]
    users_total = await db.users.count_documents({"disabled": {"$ne": True}})
    centers_total = await db.responsibility_centers.count_documents({})
    memberships = await db.responsibility_center_members.count_documents({"status": "active"}) \
        if "responsibility_center_members" in await db.list_collection_names() else 0
    pending_jobs = await db.access_control_schedules.count_documents(
        {"feature_key": {"$in": [feature] + children}, "kind": "one_time", "status": "pending"})
    sev = ac.SEVERITY.get(mode, 0)
    blocked = {"reads": sev >= ac.SEVERITY["public_preview"] and mode not in ("view_only",),
               "writes": sev >= ac.SEVERITY["view_only"] or mode in ("public_preview", "invite_only"),
               "navigation_hidden": mode in ("hidden", "founder_only"),
               "returns_404": mode == "hidden",
               "maintenance_screen": mode == "maintenance",
               "all_locked": mode == "emergency_lock"}
    return {
        "feature": feature, "target_mode": mode,
        "affected_users": users_total,
        "affected_centers": centers_total,
        "active_memberships": memberships,
        "cascades_to": children,
        "routes_affected": reg.get("routes", []) + [r for c in children for r in ac.FEATURES[c].get("routes", [])],
        "navigation_affected": reg.get("nav", []) + [n for c in children for n in ac.FEATURES[c].get("nav", [])],
        "ai_capabilities_affected": reg.get("capabilities", []),
        "pending_scheduled_jobs": pending_jobs,
        "effects": blocked,
        "bypass": "Founder + active emergency-access allowlist entries only",
        "note": "Skipped scheduled jobs are never replayed after restore.",
    }


# ── Preview as user (access matrix per persona) ──────────────────────────
PERSONAS = {
    "signed_out": None,
    "regular_user": {"id": "persona", "username": "regular_user"},
    "invited_beta_user": {"id": "persona", "username": "__invited__"},
    "center_member": {"id": "persona", "username": "center_member"},
    "manager": {"id": "persona", "username": "center_manager"},
    "platform_admin": {"id": "persona", "username": "platform_admin", "admin_role": "support_admin"},
    "founder": {"id": "persona", "username": "stealth", "admin_role": "founder"},
}


@router.get("/preview-as")
async def preview_as(persona: str, user: CurrentUser):
    require_founder(user)
    if persona not in PERSONAS:
        raise HTTPException(status_code=400, detail="Unknown persona")
    settings = await ac.get_settings(fresh=True)
    p = PERSONAS[persona]
    if persona == "invited_beta_user" and settings.get("invited_usernames"):
        p = {**p, "username": settings["invited_usernames"][0]}
    return {"persona": persona,
            "features": {k: ac.client_state(settings, k, p) for k in ac.FEATURES}}


@router.get("/audit")
async def audit_log(user: CurrentUser, limit: int = 50, skip: int = 0):
    require_founder(user)
    limit = max(1, min(200, limit))
    rows = await db.access_control_audit.find({}, {"_id": 0}) \
        .sort("at", -1).skip(max(0, skip)).limit(limit).to_list(limit)
    total = await db.access_control_audit.count_documents({})
    return {"rows": rows, "total": total}


# ── New Signup Access (founder-only, minimal) ────────────────────────────
class SignupAccessBody(BaseModel):
    allow_new_signups: bool


@router.get("/signup")
async def get_signup_access(user: CurrentUser):
    require_founder(user)
    doc = await db.platform_settings.find_one({"id": "signup"}, {"_id": 0})
    reservations = await db.signup_reservations.count_documents({})
    return {"allow_new_signups": not (doc and doc.get("allow_new_signups") is False),
            "reservations": reservations}


@router.patch("/signup")
async def set_signup_access(body: SignupAccessBody, user: CurrentUser):
    require_founder(user)
    await db.platform_settings.update_one(
        {"id": "signup"},
        {"$set": {"allow_new_signups": body.allow_new_signups, "updated_at": _now_iso()}},
        upsert=True)
    await ac.audit(user, "signup_access_changed", "signup", None,
                   {"allow_new_signups": body.allow_new_signups}, "")
    return {"ok": True, "allow_new_signups": body.allow_new_signups}


# ── Site Access Modes (Live / Beta / Preview / Maintenance) ──────────────
from services import site_access as sa


@public_router.get("/site-status")
async def site_status(request: Request):
    settings = await sa.get_settings()
    user = await ac._resolve_user(request)
    mode = settings.get("mode", "live")
    allowed = sa.is_allowed(settings, user)
    page = settings["pages"].get(mode, {}) if mode != "live" else {}
    return {"mode": mode, "allowed": allowed,
            "title": page.get("title"), "message": page.get("message")}


@router.get("/site-mode")
async def get_site_mode(user: CurrentUser):
    require_founder(user)
    settings = await sa.get_settings(fresh=True)
    return {"settings": settings, "modes": sa.MODES}


class SiteModeBody(BaseModel):
    mode: Optional[str] = None
    pages: Optional[dict] = None


@router.patch("/site-mode")
async def set_site_mode(body: SiteModeBody, user: CurrentUser):
    require_founder(user)
    settings = await sa.get_settings(fresh=True)
    update = {"updated_at": _now_iso()}
    if body.mode is not None:
        if body.mode not in sa.MODES:
            raise HTTPException(status_code=400, detail="Unknown site mode")
        update["mode"] = body.mode
    if body.pages is not None:
        pages = dict(settings.get("pages", {}))
        for k, v in body.pages.items():
            if k in sa.DEFAULT_PAGES and isinstance(v, dict):
                pages[k] = {"title": str(v.get("title") or "")[:150],
                            "message": str(v.get("message") or "")[:600]}
        update["pages"] = pages
    await db.platform_settings.update_one(
        {"id": "site_access"},
        {"$set": update, "$setOnInsert": {"allowlist": []}}, upsert=True)
    sa.invalidate()
    await ac.audit(user, "site_mode_changed", "site_access",
                   {"mode": settings.get("mode")}, {"mode": update.get("mode", settings.get("mode"))}, "")
    return {"ok": True}


class SiteAllowBody(BaseModel):
    usernames: list[str]
    remove: bool = False


@router.post("/site-mode/allowlist")
async def site_allowlist(body: SiteAllowBody, user: CurrentUser):
    """Bulk add/remove Always-Allow users (search by username or email)."""
    require_founder(user)
    settings = await sa.get_settings(fresh=True)
    lst = list(settings.get("allowlist", []))
    changed = []
    for ident in body.usernames[:50]:
        ident = ident.lower().strip()
        if not ident:
            continue
        target = await db.users.find_one(
            {"$or": [{"username": ident}, {"email": ident}]},
            {"_id": 0, "id": 1, "username": 1, "email": 1})
        if not target:
            continue
        if body.remove:
            lst = [e for e in lst if e.get("user_id") != target["id"]]
        elif not any(e.get("user_id") == target["id"] for e in lst):
            lst.append({"user_id": target["id"], "username": target["username"],
                        "email": target.get("email"), "added_at": _now_iso()})
        changed.append(target["username"])
    await db.platform_settings.update_one(
        {"id": "site_access"}, {"$set": {"allowlist": lst}}, upsert=True)
    sa.invalidate()
    await ac.audit(user, "site_allowlist_removed" if body.remove else "site_allowlist_added",
                   "site_access", None, {"users": changed}, "")
    return {"ok": True, "allowlist": lst, "changed": changed}


@router.get("/site-mode/search-users")
async def site_search_users(q: str, user: CurrentUser):
    require_founder(user)
    q = q.lower().strip()
    if len(q) < 2:
        return {"users": []}
    rows = await db.users.find(
        {"$or": [{"username": {"$regex": q, "$options": "i"}},
                 {"email": {"$regex": q, "$options": "i"}}]},
        {"_id": 0, "id": 1, "username": 1, "email": 1, "name": 1}).limit(10).to_list(10)
    return {"users": rows}
