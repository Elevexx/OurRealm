"""Guardian Controls API — /api/guardian/*.

Parent endpoints verify active guardianship before EVERY read/write.
Teen endpoints: my-limits (transparent), heartbeat, link-request respond,
first-login password set. All changes audited.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field

from core.db import db
from core.deps import CurrentUser
from core.security import hash_password
from services import guardian_control as gc
from services.responsibility_center import notify_user

log = logging.getLogger("ourrealm.guardian.api")

router = APIRouter(prefix="/api/guardian", tags=["guardian"])


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _require_adult(user: dict):
    if (user.get("age_class") or "adult") != "adult":
        raise HTTPException(status_code=403, detail="Parent Controls are available to adult accounts only.")


async def _require_guardian(user: dict, teen_id: str) -> dict:
    link = await db.guardian_links.find_one(
        {"guardian_id": user["id"], "teen_id": teen_id, "status": "active"}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=403, detail="You do not manage this account.")
    return link


async def _teen_public(teen_id: str) -> dict:
    u = await db.users.find_one({"id": teen_id}, {"_id": 0, "id": 1, "username": 1,
                                                  "name": 1, "avatar_url": 1,
                                                  "birth_date": 1, "presence_last_seen": 1,
                                                  "age_class": 1, "must_set_password": 1})
    return u or {}


def _online(u: dict) -> bool:
    ls = u.get("presence_last_seen")
    if not ls:
        return False
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(ls.replace("Z", "+00:00"))).total_seconds() < 300
    except Exception:
        return False


# ═══ Linking ═════════════════════════════════════════════════════════════
class LinkRequestBody(BaseModel):
    teen_username: str
    preset: str = "strict"


@router.post("/link-requests")
async def create_link_request(body: LinkRequestBody, user: CurrentUser):
    _require_adult(user)
    target = await db.users.find_one({"username": body.teen_username.lower().strip()},
                                     {"_id": 0, "id": 1, "username": 1, "age_class": 1})
    if not target:
        raise HTTPException(status_code=404, detail="No account found with that username.")
    if target["id"] == user["id"]:
        raise HTTPException(status_code=400, detail="You cannot link your own account.")
    if (target.get("age_class") or "adult") != "teen":
        # Adults can never be silently converted into managed accounts.
        raise HTTPException(status_code=400, detail="That account is not a Teen account.")
    if await db.guardian_links.find_one({"teen_id": target["id"], "status": "active"}):
        raise HTTPException(status_code=409, detail="That teen already has a linked parent.")
    if await db.guardian_links.find_one({"guardian_id": user["id"], "teen_id": target["id"], "status": "pending"}):
        raise HTTPException(status_code=409, detail="A request is already pending for this teen.")
    if body.preset not in gc.PRESETS:
        raise HTTPException(status_code=400, detail="Unknown preset.")
    link = {"id": str(uuid.uuid4()), "guardian_id": user["id"],
            "guardian_username": user["username"], "teen_id": target["id"],
            "teen_username": target["username"], "status": "pending",
            "preset": body.preset, "origin": "request",
            "requested_at": _now_iso()}
    await db.guardian_links.insert_one({**link})
    link.pop("_id", None)
    await gc.audit(user, target["id"], "link_requested", None, {"preset": body.preset})
    try:
        await notify_user(target["id"], "guardian_link_request",
                          f"@{user['username']} wants to become your parent/guardian on OurRealm.",
                          "/my-limits")
    except Exception:
        pass
    return {"ok": True, "request": link}


@router.get("/link-requests")
async def list_link_requests(user: CurrentUser):
    out = await db.guardian_links.find({"guardian_id": user["id"], "status": "pending"}, {"_id": 0}).to_list(50)
    inc = await db.guardian_links.find({"teen_id": user["id"], "status": "pending"}, {"_id": 0}).to_list(50)
    return {"outgoing": out, "incoming": inc}


class RespondBody(BaseModel):
    accept: bool


@router.post("/link-requests/{link_id}/respond")
async def respond_link_request(link_id: str, body: RespondBody, user: CurrentUser):
    link = await db.guardian_links.find_one({"id": link_id, "teen_id": user["id"], "status": "pending"}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="Request not found.")
    if body.accept:
        if await db.guardian_links.find_one({"teen_id": user["id"], "status": "active"}):
            raise HTTPException(status_code=409, detail="You already have a linked parent.")
        await db.guardian_links.update_one({"id": link_id}, {"$set": {"status": "active", "accepted_at": _now_iso()}})
        if not await db.guardian_permissions.find_one({"teen_id": user["id"]}):
            await db.guardian_permissions.insert_one(
                gc.default_permissions(user["id"], link["guardian_id"], link.get("preset", "strict")))
        gc.invalidate_perms(user["id"])
        await gc.audit({"id": link["guardian_id"], "username": link["guardian_username"]},
                       user["id"], "link_accepted", None, {"preset": link.get("preset")})
        try:
            await notify_user(link["guardian_id"], "guardian_link_accepted",
                              f"@{user['username']} accepted your parent link request.", "/parent")
        except Exception:
            pass
    else:
        await db.guardian_links.update_one({"id": link_id}, {"$set": {"status": "declined", "declined_at": _now_iso()}})
        await gc.audit(None, user["id"], "link_declined", None, None)
    return {"ok": True}


class CreateTeenBody(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[a-zA-Z0-9_.]+$")
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    temp_password: str = Field(min_length=6, max_length=128)
    birth_date: str  # YYYY-MM-DD
    preset: str = "strict"


@router.post("/create-teen")
async def create_teen(body: CreateTeenBody, user: CurrentUser):
    """Parent-created teen account. Temp credentials; teen MUST set their
    own password at first login. Password never shown again."""
    _require_adult(user)
    age = gc.compute_age(body.birth_date)
    if age is None or age < 13 or age > 17:
        raise HTTPException(status_code=400, detail="Teen accounts require an age between 13 and 17.")
    if body.preset not in gc.PRESETS:
        raise HTTPException(status_code=400, detail="Unknown preset.")
    email = body.email.lower().strip()
    username = body.username.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="That email is already registered.")
    if await db.users.find_one({"username": username}):
        raise HTTPException(status_code=400, detail="That username is unavailable.")
    from routers.premium_usernames import signup_gate
    gate = await signup_gate(username)
    if gate:
        raise HTTPException(status_code=422, detail=gate["message"])
    teen_id = str(uuid.uuid4())
    now = _now_iso()
    await db.users.insert_one({
        "id": teen_id, "email": email, "username": username,
        "password_hash": hash_password(body.temp_password),
        "name": body.name.strip(), "role": "user", "avatar_url": None,
        "bio": "", "interests": [], "mode": "neon", "widgets": [],
        "friends": [], "friend_requests_in": [], "friend_requests_out": [],
        "pinned_threads": [], "is_vip": False,
        "age_class": "teen", "birth_date": body.birth_date[:10],
        "must_set_password": True,
        "created_by_guardian": user["id"],
        "created_at": now,
    })
    await db.guardian_links.insert_one({
        "id": str(uuid.uuid4()), "guardian_id": user["id"],
        "guardian_username": user["username"], "teen_id": teen_id,
        "teen_username": username, "status": "active",
        "preset": body.preset, "origin": "parent_created",
        "requested_at": now, "accepted_at": now})
    await db.guardian_permissions.insert_one(
        gc.default_permissions(teen_id, user["id"], body.preset))
    await gc.audit(user, teen_id, "teen_account_created", None,
                   {"username": username, "preset": body.preset})
    return {"ok": True, "teen": {"id": teen_id, "username": username, "name": body.name}}


@router.delete("/teens/{teen_id}")
async def unlink_teen(teen_id: str, user: CurrentUser):
    link = await _require_guardian(user, teen_id)
    await db.guardian_links.update_one({"id": link["id"]}, {"$set": {"status": "unlinked", "ended_at": _now_iso()}})
    gc.invalidate_perms(teen_id)
    await gc.audit(user, teen_id, "unlinked", link, None)
    return {"ok": True}


# ═══ Parent dashboard ════════════════════════════════════════════════════
@router.get("/teens")
async def list_teens(user: CurrentUser):
    _require_adult(user)
    links = await db.guardian_links.find({"guardian_id": user["id"], "status": "active"}, {"_id": 0}).to_list(100)
    cards = []
    for l in links:
        u = await _teen_public(l["teen_id"])
        perms = await gc.get_perms(l["teen_id"]) or gc.default_permissions(l["teen_id"], user["id"])
        routine = await gc.get_routine(perms.get("routine_id"))
        eff, controlling = gc.effective_settings(perms, routine)
        used = await gc.used_minutes_today(l["teen_id"], eff)
        limit = (eff.get("screen_time") or {}).get("daily_minutes")
        disabled_features = sum(1 for v in eff["features"].values() if not v)
        sch_blocked, nxt1 = gc.schedule_state(eff)
        bt_blocked, nxt2 = gc.bedtime_state(eff)
        cards.append({
            "teen_id": l["teen_id"], "username": u.get("username"),
            "name": u.get("name"), "avatar_url": u.get("avatar_url"),
            "age": gc.compute_age(u.get("birth_date")),
            "online": _online(u), "last_active": u.get("presence_last_seen"),
            "must_set_password": bool(u.get("must_set_password")),
            "locked": bool(perms.get("locked")),
            "controlling_rule": controlling,
            "routine_name": (routine or {}).get("name"),
            "time_used_minutes": round(used, 1),
            "daily_limit_minutes": limit,
            "time_remaining_minutes": (max(0, round(limit - used, 1)) if limit is not None else None),
            "currently_blocked": bool(perms.get("locked") or sch_blocked or bt_blocked
                                      or (limit is not None and used >= limit)),
            "disabled_feature_count": disabled_features,
            "content_filter": eff.get("content_filter"),
            "preset": perms.get("preset"),
            "allowed_centers": [k for k, v in eff["centers"].items() if v],
        })
    return {"teens": cards}


@router.get("/teens/{teen_id}")
async def teen_detail(teen_id: str, user: CurrentUser):
    await _require_guardian(user, teen_id)
    perms = await gc.get_perms(teen_id, fresh=True) or gc.default_permissions(teen_id, user["id"])
    routine = await gc.get_routine(perms.get("routine_id"))
    eff, controlling = gc.effective_settings(perms, routine)
    used = await gc.used_minutes_today(teen_id, eff)
    audit_rows = await db.guardian_audit.find({"teen_id": teen_id}, {"_id": 0}) \
        .sort("at", -1).limit(30).to_list(30)
    return {"teen": await _teen_public(teen_id), "permissions": perms,
            "effective": eff, "controlling_rule": controlling,
            "routine": routine, "time_used_minutes": round(used, 1),
            "registry": {"feature_groups": gc.FEATURE_GROUPS,
                         "media_types": gc.MEDIA_TYPES,
                         "media_sources": gc.MEDIA_SOURCES,
                         "content_filters": gc.CONTENT_FILTERS,
                         "center_types": gc.CENTER_TYPES,
                         "presets": list(gc.PRESETS.keys())},
            "audit": audit_rows}


class PermPatch(BaseModel):
    features: Optional[dict] = None
    media_types: Optional[dict] = None
    media_sources: Optional[dict] = None
    centers: Optional[dict] = None
    content_filter: Optional[str] = None
    screen_time: Optional[dict] = None
    schedule: Optional[dict] = None
    bedtime: Optional[dict] = None
    timezone: Optional[str] = None
    preset: Optional[str] = None


VALID_KEYS = {"features": set(gc.ALL_FEATURES), "media_types": set(gc.MEDIA_TYPES),
              "media_sources": set(gc.MEDIA_SOURCES), "centers": set(gc.CENTER_TYPES)}


@router.patch("/teens/{teen_id}/permissions")
async def patch_permissions(teen_id: str, body: PermPatch, user: CurrentUser):
    await _require_guardian(user, teen_id)
    perms = await gc.get_perms(teen_id, fresh=True)
    if not perms:
        perms = gc.default_permissions(teen_id, user["id"])
        await db.guardian_permissions.insert_one({**perms})
    before = {k: perms.get(k) for k in ("features", "media_types", "media_sources",
                                        "centers", "content_filter", "screen_time",
                                        "schedule", "bedtime", "preset")}
    update, overrides = {}, set(perms.get("overrides") or [])
    if body.preset:
        if body.preset not in gc.PRESETS:
            raise HTTPException(status_code=400, detail="Unknown preset.")
        p = gc.PRESETS[body.preset]
        update.update({"preset": body.preset, "features": dict(p["features"]),
                       "media_types": dict(p["media_types"]),
                       "media_sources": dict(p["media_sources"]),
                       "content_filter": p["content_filter"],
                       "centers": dict(p["centers"]), "overrides": []})
        overrides = set()
    for section in ("features", "media_types", "media_sources", "centers"):
        patch = getattr(body, section)
        if patch:
            merged = dict(perms.get(section) or {})
            for k, v in patch.items():
                if k not in VALID_KEYS[section]:
                    raise HTTPException(status_code=400, detail=f"Unknown {section} key: {k}")
                merged[k] = bool(v)
                overrides.add(f"{section}.{k}")  # teen-specific override wins over routine
            update[section] = merged
    if body.content_filter is not None:
        if body.content_filter not in gc.CONTENT_FILTERS:
            raise HTTPException(status_code=400, detail="Unknown content filter.")
        update["content_filter"] = body.content_filter
    if body.screen_time is not None:
        dm = body.screen_time.get("daily_minutes")
        wm = body.screen_time.get("weekly_minutes")
        update["screen_time"] = {"daily_minutes": (int(dm) if dm is not None else None),
                                 "weekly_minutes": (int(wm) if wm is not None else None)}
    if body.schedule is not None:
        days = [d for d in (body.schedule.get("days") or []) if d in gc.DAYS]
        windows = [{"start": w.get("start", "07:00"), "end": w.get("end", "21:00")}
                   for w in (body.schedule.get("windows") or [])][:6]
        update["schedule"] = {"enabled": bool(body.schedule.get("enabled")),
                              "days": days or list(gc.DAYS),
                              "windows": windows or [{"start": "07:00", "end": "21:00"}]}
    if body.bedtime is not None:
        update["bedtime"] = {"enabled": bool(body.bedtime.get("enabled")),
                             "start": body.bedtime.get("start", "21:30"),
                             "end": body.bedtime.get("end", "07:00")}
    if body.timezone is not None:
        try:
            from zoneinfo import ZoneInfo
            ZoneInfo(body.timezone)
        except Exception:
            raise HTTPException(status_code=400, detail="Unknown timezone.")
        update["timezone"] = body.timezone
    if not update:
        return {"ok": True, "unchanged": True}
    update["overrides"] = sorted(overrides)
    update["updated_at"] = _now_iso()
    await db.guardian_permissions.update_one({"teen_id": teen_id}, {"$set": update})
    gc.invalidate_perms(teen_id)
    await gc.audit(user, teen_id, "permissions_changed", before,
                   {k: v for k, v in update.items() if k != "updated_at"})
    return {"ok": True}


class LockBody(BaseModel):
    locked: bool
    reason: str = ""


@router.post("/teens/{teen_id}/lock")
async def lock_teen(teen_id: str, body: LockBody, user: CurrentUser):
    await _require_guardian(user, teen_id)
    perms = await gc.get_perms(teen_id, fresh=True)
    if not perms:
        perms = gc.default_permissions(teen_id, user["id"])
        await db.guardian_permissions.insert_one({**perms})
    await db.guardian_permissions.update_one(
        {"teen_id": teen_id},
        {"$set": {"locked": body.locked, "lock_reason": body.reason.strip(),
                  "updated_at": _now_iso()}})
    gc.invalidate_perms(teen_id)
    await gc.audit(user, teen_id, "locked" if body.locked else "unlocked",
                   {"locked": perms.get("locked")}, {"locked": body.locked}, body.reason)
    return {"ok": True, "locked": body.locked}


# ═══ Routines ═════════════════════════════════════════════════════════════
class RoutineBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    features: Optional[dict] = None
    media_types: Optional[dict] = None
    media_sources: Optional[dict] = None
    centers: Optional[dict] = None
    screen_time: Optional[dict] = None
    bedtime: Optional[dict] = None
    schedule: Optional[dict] = None
    active_when: Optional[dict] = None
    enabled: bool = True


def _routine_doc(body: RoutineBody, guardian: dict, rid: str | None = None) -> dict:
    def _clean(section, valid):
        raw = getattr(body, section) or {}
        return {k: bool(v) for k, v in raw.items() if k in valid}
    return {
        "id": rid or str(uuid.uuid4()), "guardian_id": guardian["id"],
        "name": body.name.strip(), "enabled": body.enabled,
        "features": _clean("features", VALID_KEYS["features"]),
        "media_types": _clean("media_types", VALID_KEYS["media_types"]),
        "media_sources": _clean("media_sources", VALID_KEYS["media_sources"]),
        "centers": _clean("centers", VALID_KEYS["centers"]),
        "screen_time": body.screen_time,
        "bedtime": body.bedtime,
        "schedule": body.schedule,
        "active_when": body.active_when,
        "updated_at": _now_iso(),
    }


@router.get("/routines")
async def list_routines(user: CurrentUser):
    _require_adult(user)
    rows = await db.guardian_routines.find({"guardian_id": user["id"]}, {"_id": 0}).to_list(100)
    assigned = await db.guardian_permissions.find(
        {"guardian_id": user["id"], "routine_id": {"$ne": None}},
        {"_id": 0, "teen_id": 1, "routine_id": 1}).to_list(200)
    return {"routines": rows, "assignments": assigned}


@router.post("/routines")
async def create_routine(body: RoutineBody, user: CurrentUser):
    _require_adult(user)
    doc = _routine_doc(body, user)
    doc["created_at"] = _now_iso()
    await db.guardian_routines.insert_one({**doc})
    doc.pop("_id", None)
    await gc.audit(user, "", "routine_created", None, {"name": doc["name"], "id": doc["id"]})
    return {"ok": True, "routine": doc}


@router.patch("/routines/{routine_id}")
async def update_routine(routine_id: str, body: RoutineBody, user: CurrentUser):
    old = await db.guardian_routines.find_one({"id": routine_id, "guardian_id": user["id"]}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Routine not found.")
    doc = _routine_doc(body, user, rid=routine_id)
    doc["created_at"] = old.get("created_at")
    await db.guardian_routines.replace_one({"id": routine_id}, doc)
    for t in await db.guardian_permissions.find({"routine_id": routine_id}, {"teen_id": 1}).to_list(200):
        gc.invalidate_perms(t["teen_id"])
    await gc.audit(user, "", "routine_updated", {"name": old["name"]}, {"name": doc["name"]})
    return {"ok": True, "routine": doc}


@router.post("/routines/{routine_id}/duplicate")
async def duplicate_routine(routine_id: str, user: CurrentUser):
    old = await db.guardian_routines.find_one({"id": routine_id, "guardian_id": user["id"]}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Routine not found.")
    dup = {**old, "id": str(uuid.uuid4()), "name": f"{old['name']} (copy)",
           "created_at": _now_iso(), "updated_at": _now_iso()}
    await db.guardian_routines.insert_one({**dup})
    dup.pop("_id", None)
    await gc.audit(user, "", "routine_duplicated", {"from": old["name"]}, {"name": dup["name"]})
    return {"ok": True, "routine": dup}


@router.delete("/routines/{routine_id}")
async def delete_routine(routine_id: str, user: CurrentUser):
    old = await db.guardian_routines.find_one({"id": routine_id, "guardian_id": user["id"]}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Routine not found.")
    await db.guardian_routines.delete_one({"id": routine_id})
    await db.guardian_permissions.update_many(
        {"routine_id": routine_id}, {"$set": {"routine_id": None}})
    for t in await db.guardian_permissions.find({"guardian_id": user["id"]}, {"teen_id": 1}).to_list(200):
        gc.invalidate_perms(t["teen_id"])
    await gc.audit(user, "", "routine_deleted", {"name": old["name"]}, None)
    return {"ok": True}


class AssignBody(BaseModel):
    teen_ids: list[str]
    routine_id: Optional[str] = None  # null clears the routine


@router.post("/routines/assign")
async def assign_routine(body: AssignBody, user: CurrentUser):
    _require_adult(user)
    if body.routine_id:
        r = await db.guardian_routines.find_one({"id": body.routine_id, "guardian_id": user["id"]})
        if not r:
            raise HTTPException(status_code=404, detail="Routine not found.")
    for teen_id in body.teen_ids[:50]:
        await _require_guardian(user, teen_id)
        if not await gc.get_perms(teen_id, fresh=True):
            await db.guardian_permissions.insert_one(gc.default_permissions(teen_id, user["id"]))
        await db.guardian_permissions.update_one(
            {"teen_id": teen_id}, {"$set": {"routine_id": body.routine_id, "updated_at": _now_iso()}})
        gc.invalidate_perms(teen_id)
        await gc.audit(user, teen_id, "routine_assigned" if body.routine_id else "routine_cleared",
                       None, {"routine_id": body.routine_id})
    return {"ok": True}


# ═══ Bulk actions ═════════════════════════════════════════════════════════
class BulkBody(BaseModel):
    teen_ids: list[str]
    action: str  # lock | unlock | assign_routine | set_permissions
    routine_id: Optional[str] = None
    reason: str = ""
    permissions: Optional[dict] = None


@router.post("/bulk")
async def bulk_action(body: BulkBody, user: CurrentUser):
    _require_adult(user)
    done = 0
    for teen_id in body.teen_ids[:50]:
        await _require_guardian(user, teen_id)
        if body.action in ("lock", "unlock"):
            await lock_teen(teen_id, LockBody(locked=body.action == "lock", reason=body.reason), user)
        elif body.action == "assign_routine":
            await assign_routine(AssignBody(teen_ids=[teen_id], routine_id=body.routine_id), user)
        elif body.action == "set_permissions" and body.permissions:
            await patch_permissions(teen_id, PermPatch(**body.permissions), user)
        else:
            raise HTTPException(status_code=400, detail="Unknown bulk action.")
        done += 1
    return {"ok": True, "applied_to": done}


@router.get("/audit")
async def guardian_audit_log(user: CurrentUser, teen_id: Optional[str] = None, limit: int = 50):
    _require_adult(user)
    q = {"guardian_id": user["id"]}
    if teen_id:
        await _require_guardian(user, teen_id)
        q = {"teen_id": teen_id}
    rows = await db.guardian_audit.find(q, {"_id": 0}).sort("at", -1).limit(min(200, limit)).to_list(200)
    return {"rows": rows}


# ═══ Teen endpoints ════════════════════════════════════════════════════════
@router.get("/my-limits")
async def my_limits(user: CurrentUser):
    """Transparent read-only view for the teen. No parent notes/audit exposed."""
    if (user.get("age_class") or "adult") != "teen":
        return {"is_teen": False}
    await gc.maybe_age_out(user)
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "age_class": 1})
    if (fresh or {}).get("age_class") != "teen":
        return {"is_teen": False}
    perms = await gc.get_perms(user["id"])
    link = await db.guardian_links.find_one({"teen_id": user["id"], "status": "active"}, {"_id": 0})
    incoming = await db.guardian_links.find({"teen_id": user["id"], "status": "pending"}, {"_id": 0}).to_list(10)
    eff, controlling = await gc.effective_for_teen(user["id"])
    used = await gc.used_minutes_today(user["id"], eff)
    limit = (eff.get("screen_time") or {}).get("daily_minutes")
    sch_blocked, sch_next = gc.schedule_state(eff)
    bt_blocked, bt_next = gc.bedtime_state(eff)
    st_blocked = limit is not None and used >= limit
    blocked_reason = None
    next_available = None
    if eff.get("locked"):
        blocked_reason, next_available = "locked", None
    elif sch_blocked:
        blocked_reason, next_available = "outside_schedule", sch_next
    elif bt_blocked:
        blocked_reason, next_available = "bedtime", bt_next
    elif st_blocked:
        blocked_reason = "screen_time"
    routine = await gc.get_routine((perms or {}).get("routine_id"))
    return {
        "is_teen": True,
        "has_guardian": bool(link),
        "guardian_username": (link or {}).get("guardian_username"),
        "pending_requests": incoming,
        "must_set_password": bool(user.get("must_set_password")),
        "locked": bool(eff.get("locked")),
        "blocked": blocked_reason is not None,
        "blocked_reason": blocked_reason,
        "next_available_at": next_available,
        "controlling_rule": controlling,
        "routine_name": (routine or {}).get("name"),
        "time_used_minutes": round(used, 1),
        "daily_limit_minutes": limit,
        "time_remaining_minutes": (max(0, round(limit - used, 1)) if limit is not None else None),
        "schedule": eff.get("schedule"),
        "bedtime": eff.get("bedtime"),
        "allowed_centers": [k for k, v in (eff.get("centers") or {}).items() if v],
        "allowed_media": [k for k, v in (eff.get("media_types") or {}).items() if v],
        "allowed_sources": [k for k, v in (eff.get("media_sources") or {}).items() if v],
        "disabled_features": [k for k, v in (eff.get("features") or {}).items() if not v],
        "content_filter": eff.get("content_filter"),
        "timezone": eff.get("timezone", "UTC"),
    }


class HeartbeatBody(BaseModel):
    timezone: Optional[str] = None
    visible: bool = True


@router.post("/heartbeat")
async def heartbeat(body: HeartbeatBody, user: CurrentUser):
    if (user.get("age_class") or "adult") != "teen" or not body.visible:
        return {"ok": True, "counted": False}
    perms = await gc.get_perms(user["id"]) or gc.default_permissions(user["id"], "")
    if body.timezone and perms.get("timezone") in (None, "UTC") and body.timezone != perms.get("timezone"):
        try:
            from zoneinfo import ZoneInfo
            ZoneInfo(body.timezone)
            await db.guardian_permissions.update_one(
                {"teen_id": user["id"]}, {"$set": {"timezone": body.timezone}})
            gc.invalidate_perms(user["id"])
            perms["timezone"] = body.timezone
        except Exception:
            pass
    r = await gc.record_heartbeat(user["id"], perms)
    return {"ok": True, **r}


class SetPasswordBody(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


@router.post("/me/set-password")
async def set_own_password(body: SetPasswordBody, user: CurrentUser):
    """First-login password set for parent-created teen accounts."""
    if not user.get("must_set_password"):
        raise HTTPException(status_code=400, detail="No password reset required.")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(body.new_password)},
         "$unset": {"must_set_password": ""}})
    await gc.audit(None, user["id"], "teen_set_own_password", None, None)
    return {"ok": True}
