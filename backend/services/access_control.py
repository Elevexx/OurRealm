"""OurRealm Global Access Control — founder-controlled visibility engine.

ONE centralized engine enforces every access mode SERVER-SIDE for the
Responsibility Center and ORAi feature families. Enforced via an HTTP
middleware (covers every current AND future route under the governed
prefixes) plus an exported `require_feature_access` dependency for
explicit per-endpoint use.

Modes: full_access, view_only, public_preview, invite_only, admin_only,
founder_only, hidden, maintenance, emergency_lock, custom.

Bypass: ONLY the founder by default. Optional founder-approved
emergency-access allowlist entries (reason + start + expiry, audited).
Ordinary platform admins never bypass hidden/maintenance/lock/view-only.

Data: `global_access_settings` (single doc), `access_control_schedules`,
`access_control_audit`. Defaults preserve current production state —
everything full_access except rc_public_preview (closed/hidden).
"""
import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import jwt
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from core.db import db
from core.config import JWT_ALGORITHM, get_jwt_secret
from core.permissions import get_admin_role, ROLE_FOUNDER, ADMIN_ROLES

log = logging.getLogger("ourrealm.access_control")

MODES = ["full_access", "view_only", "public_preview", "invite_only",
         "admin_only", "founder_only", "hidden", "maintenance",
         "emergency_lock", "custom"]

# Higher = more restrictive; effective mode = max over feature + parents.
SEVERITY = {"full_access": 0, "custom": 1, "public_preview": 2,
            "invite_only": 3, "view_only": 4, "admin_only": 5,
            "founder_only": 6, "maintenance": 7, "hidden": 8,
            "emergency_lock": 9}

FEATURES = {
    "responsibility_center": {
        "label": "Responsibility Center (Master)", "parents": [],
        "group": "master", "default_mode": "full_access",
        "routes": ["/api/responsibility-center/*"],
        "nav": ["Top bar — Responsibility Center", "RC Hub, Dashboards, Work, Calendar, Reports, Routines"],
        "capabilities": ["Centers", "Tasks & Responsibilities", "Units", "Calendar", "Reports", "Fire Power Vaults", "Routines"]},
    "orai": {
        "label": "ORAi (Master)", "parents": [],
        "group": "master", "default_mode": "full_access",
        "routes": ["/api/orai/*", "/api/responsibility-center/*/orai/*", "/api/responsibility-center/*/intelligence/*"],
        "nav": ["Intelligence dashboard", "ORAi drafts & recommendations"],
        "capabilities": ["ORAi chat/drafts", "Voice", "Course generation", "Automations", "Memory", "Recommendations"]},
    "orai_voice": {
        "label": "ORAi Voice", "parents": ["orai"],
        "group": "orai", "default_mode": "full_access",
        "routes": ["/api/orai/voice/*"],
        "nav": ["Voice bar & voice library"],
        "capabilities": ["Text-to-speech", "Transcription", "Voice sessions"]},
    "course_generation": {
        "label": "AI Course Generation", "parents": ["responsibility_center", "orai"],
        "group": "orai", "default_mode": "full_access",
        "routes": ["/api/responsibility-center/*/courses/generate", "/api/responsibility-center/*/courses/*/tutor*", "/api/responsibility-center/*/courses/*/lessons/*/image"],
        "nav": ["Course Studio — Generate"],
        "capabilities": ["AI course creation", "AI tutor", "Lesson image generation"]},
    "course_player": {
        "label": "Course Player", "parents": ["responsibility_center"],
        "group": "rc", "default_mode": "full_access",
        "routes": ["/api/responsibility-center/*/courses*"],
        "nav": ["Course Studio", "Course Player"],
        "capabilities": ["Course browsing", "Lessons", "Quizzes", "Certificates", "Sharing"]},
    "ai_automations": {
        "label": "AI Automations", "parents": ["responsibility_center", "orai"],
        "group": "orai", "default_mode": "full_access",
        "routes": ["/api/responsibility-center/*/automations*", "/api/responsibility-center/*/templates*", "/api/responsibility-center/*/orai/drafts*"],
        "nav": ["Intelligence — Automations & Drafts"],
        "capabilities": ["Automation rules", "Automation runs", "ORAi drafts", "Templates"]},
    "ai_memory": {
        "label": "AI Memory", "parents": ["responsibility_center", "orai"],
        "group": "orai", "default_mode": "full_access",
        "routes": ["/api/responsibility-center/*/orai/memory*"],
        "nav": ["Intelligence — Memory"],
        "capabilities": ["ORAi memory read/write", "Memory export & reset"]},
    "ai_recommendations": {
        "label": "AI Recommendations", "parents": ["responsibility_center", "orai"],
        "group": "orai", "default_mode": "full_access",
        "routes": ["/api/responsibility-center/*/orai/recommendations*"],
        "nav": ["Intelligence — Recommendations"],
        "capabilities": ["ORAi recommendations"]},
    "rc_public_preview": {
        "label": "Public Responsibility Center Preview", "parents": ["responsibility_center"],
        "group": "rc", "default_mode": "hidden",
        "routes": ["/api/access-control/preview-demo"],
        "nav": ["Signed-out preview screen"],
        "capabilities": ["Isolated DEMO content only — never real Centers, users, tasks, schedules, reports, Fire Power, ORAi memory or private activity"]},
    "center_creation": {
        "label": "Center Creation", "parents": ["responsibility_center"],
        "group": "rc", "default_mode": "full_access",
        "routes": ["POST /api/responsibility-center/create"],
        "nav": ["Create a Center button"],
        "capabilities": ["New Center creation"]},
    "center_joining": {
        "label": "Center Joining", "parents": ["responsibility_center"],
        "group": "rc", "default_mode": "full_access",
        "routes": ["/api/responsibility-center/*/invite*"],
        "nav": ["Invite members", "Accept invitations"],
        "capabilities": ["Sending invites", "Responding to invites"]},
}

GOVERNED_PREFIXES = ("/api/orai/", "/api/responsibility-center")
# GET paths matching these substrings are treated as ACTIONS (blocked in
# View Only): exports, downloads, generation, voice synthesis.
WRITE_HINT_SUBSTRINGS = ("export", "download", "generate", "/tts", "/transcribe", "/preview/")

SETTINGS_ID = "global"

# ── Settings cache (3s TTL — one DB read per burst, invalidated on write)
_cache = {"doc": None, "at": 0.0}


def _now():
    return datetime.now(timezone.utc)


def _default_settings():
    return {
        "id": SETTINGS_ID,
        "features": {k: {"mode": v["default_mode"], "message": "",
                         "custom_rules": {"allow_reads": True, "allow_writes": False}}
                     for k, v in FEATURES.items()},
        "emergency_allowlist": [],
        "invited_usernames": [],
        "pre_lock_snapshot": None,
        "updated_at": _now().isoformat(),
    }


async def get_settings(fresh: bool = False) -> dict:
    if not fresh and _cache["doc"] and time.monotonic() - _cache["at"] < 3.0:
        return _cache["doc"]
    doc = await db.global_access_settings.find_one({"id": SETTINGS_ID}, {"_id": 0})
    if not doc:
        doc = _default_settings()
        try:
            await db.global_access_settings.insert_one({**doc})
            doc.pop("_id", None)
        except Exception:
            doc = await db.global_access_settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or doc
    # Heal any feature keys added in later phases.
    feats = doc.setdefault("features", {})
    for k, v in FEATURES.items():
        feats.setdefault(k, {"mode": v["default_mode"], "message": "",
                             "custom_rules": {"allow_reads": True, "allow_writes": False}})
    _cache["doc"] = doc
    _cache["at"] = time.monotonic()
    return doc


def invalidate_cache():
    _cache["doc"] = None
    _cache["at"] = 0.0


def effective_mode(settings: dict, feature_key: str) -> tuple[str, str]:
    """Return (mode, source_feature) — most restrictive of self + parents."""
    feats = settings.get("features", {})
    best_mode = feats.get(feature_key, {}).get("mode", "full_access")
    src = feature_key
    for parent in FEATURES.get(feature_key, {}).get("parents", []):
        pmode = feats.get(parent, {}).get("mode", "full_access")
        if SEVERITY.get(pmode, 0) > SEVERITY.get(best_mode, 0):
            best_mode, src = pmode, parent
    return best_mode, src


def _is_allowlisted(settings: dict, user: dict | None) -> bool:
    if not user:
        return False
    now = _now().isoformat()
    uname = (user.get("username") or "").lower()
    for e in settings.get("emergency_allowlist", []):
        if (e.get("username", "").lower() == uname
                and e.get("starts_at", "") <= now
                and e.get("expires_at", "9999") > now):
            return True
    return False


def _is_bypass(settings: dict, user: dict | None) -> bool:
    if user and get_admin_role(user) == ROLE_FOUNDER:
        return True
    return _is_allowlisted(settings, user)


def feature_for_path(path: str, method: str) -> str | None:
    """Map a request path to its most specific governed feature key."""
    if path.startswith("/api/admin/") or path.startswith("/api/access-control"):
        return None  # control plane — its own founder gates apply
    if path.startswith("/api/orai/voice"):
        return "orai_voice"
    if path.startswith("/api/orai"):
        return "orai"
    if path.startswith("/api/responsibility-center"):
        p = path
        if "/courses/generate" in p or "/tutor" in p or (p.endswith("/image") and "/lessons/" in p):
            return "course_generation"
        if "/courses" in p:
            return "course_player"
        if "/orai/memory" in p:
            return "ai_memory"
        if "/orai/recommendations" in p:
            return "ai_recommendations"
        if "/orai/drafts" in p or "/automations" in p or "/templates" in p:
            return "ai_automations"
        if p.rstrip("/").endswith("/create") and method == "POST":
            return "center_creation"
        if "/invite" in p:
            return "center_joining"
        return "responsibility_center"
    return None


def action_for(path: str, method: str) -> str:
    if method in ("GET", "HEAD", "OPTIONS"):
        if any(h in path for h in WRITE_HINT_SUBSTRINGS):
            return "write"
        return "read"
    return "write"


def evaluate(settings: dict, feature_key: str, action: str, user: dict | None) -> dict:
    """Central decision. Returns {allow, status, code, message, mode}."""
    mode, src = effective_mode(settings, feature_key)
    feats = settings.get("features", {})
    msg = feats.get(src, {}).get("message") or feats.get(feature_key, {}).get("message") or ""
    if _is_bypass(settings, user):
        return {"allow": True, "mode": mode, "bypass": True}
    if mode == "full_access":
        return {"allow": True, "mode": mode}
    role = get_admin_role(user)
    if mode == "custom":
        rules = feats.get(src, {}).get("custom_rules") or {}
        ok = rules.get("allow_reads", True) if action == "read" else rules.get("allow_writes", False)
        if ok:
            return {"allow": True, "mode": mode}
        return {"allow": False, "status": 423, "code": "custom_restricted", "mode": mode,
                "message": msg or "This action is currently restricted."}
    if mode == "view_only":
        if action == "read":
            return {"allow": True, "mode": mode}
        return {"allow": False, "status": 423, "code": "view_only", "mode": mode,
                "message": msg or "This area is in View Only mode. Changes are temporarily disabled."}
    if mode == "public_preview":
        return {"allow": False, "status": 403, "code": "public_preview", "mode": mode,
                "message": msg or "This area is in Public Preview. Live data and actions are unavailable."}
    if mode == "invite_only":
        uname = (user or {}).get("username", "").lower()
        if uname and uname in [u.lower() for u in settings.get("invited_usernames", [])]:
            return {"allow": True, "mode": mode}
        return {"allow": False, "status": 403, "code": "invite_required", "mode": mode,
                "message": msg or "This area is currently invite-only."}
    if mode == "admin_only":
        if role in ADMIN_ROLES:
            return {"allow": True, "mode": mode}
        return {"allow": False, "status": 403, "code": "admin_only", "mode": mode,
                "message": msg or "This area is temporarily limited to administrators."}
    if mode == "founder_only":
        return {"allow": False, "status": 403, "code": "founder_only", "mode": mode,
                "message": msg or "This area is temporarily limited to the founder."}
    if mode == "hidden":
        return {"allow": False, "status": 404, "code": "not_found", "mode": mode,
                "message": "Not found"}
    if mode == "maintenance":
        return {"allow": False, "status": 503, "code": "maintenance", "mode": mode,
                "message": msg or "This area is under maintenance. Please check back soon."}
    if mode == "emergency_lock":
        return {"allow": False, "status": 423, "code": "emergency_lock", "mode": mode,
                "message": msg or "This area is temporarily locked. All data is safe."}
    return {"allow": True, "mode": mode}


# ── Lightweight user resolution for the middleware ──────────────────────
async def _resolve_user(request: Request) -> dict | None:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        return None
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            return None
        return await db.users.find_one(
            {"id": payload["sub"]},
            {"_id": 0, "id": 1, "username": 1, "admin_role": 1, "disabled": 1})
    except Exception:
        return None


def _all_open(settings: dict) -> bool:
    for k, f in settings.get("features", {}).items():
        if k == "rc_public_preview":
            continue  # its restrictive default never blocks governed routes
        if f.get("mode", "full_access") != "full_access":
            return False
    return True


async def enforce_request(request: Request):
    """HTTP middleware hook. Returns JSONResponse to short-circuit, or None."""
    path = request.url.path
    if not path.startswith(GOVERNED_PREFIXES):
        return None
    feature = feature_for_path(path, request.method)
    if not feature:
        return None
    settings = await get_settings()
    if _all_open(settings):
        return None  # fast path — zero extra DB reads
    action = action_for(path, request.method)
    user = await _resolve_user(request)
    d = evaluate(settings, feature, action, user)
    if d.get("allow"):
        return None
    if d["status"] == 404:
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    return JSONResponse(status_code=d["status"], content={"detail": {
        "code": d["code"], "message": d["message"], "feature": feature,
        "mode": d["mode"]}})


def require_feature_access(feature_key: str, action_type: str = "write"):
    """Explicit per-endpoint dependency (in addition to the middleware)."""
    async def _dep(request: Request):
        settings = await get_settings()
        if _all_open(settings):
            return
        user = await _resolve_user(request)
        d = evaluate(settings, feature_key, action_type, user)
        if not d.get("allow"):
            raise HTTPException(status_code=d["status"], detail={
                "code": d["code"], "message": d["message"],
                "feature": feature_key, "mode": d["mode"]})
    return _dep


# ── Client status (drives navigation, banners, screens) ─────────────────
def client_state(settings: dict, feature_key: str, user: dict | None) -> dict:
    mode, src = effective_mode(settings, feature_key)
    feats = settings.get("features", {})
    msg = feats.get(src, {}).get("message") or ""
    bypass = _is_bypass(settings, user)
    role = get_admin_role(user)
    uname = (user or {}).get("username", "").lower()
    invited = uname and uname in [u.lower() for u in settings.get("invited_usernames", [])]
    visible, can_read, can_write, screen = True, True, True, "normal"
    if bypass:
        return {"key": feature_key, "mode": mode, "visible": True, "can_read": True,
                "can_write": True, "screen": "normal", "message": msg, "bypass": True}
    if mode == "view_only":
        can_write, screen = False, "view_only"
    elif mode == "custom":
        rules = feats.get(src, {}).get("custom_rules") or {}
        can_read = bool(rules.get("allow_reads", True))
        can_write = bool(rules.get("allow_writes", False))
        screen = "normal" if can_read else "locked"
        visible = can_read
    elif mode == "public_preview":
        can_read = can_write = False
        screen = "preview"
    elif mode == "invite_only":
        if not invited:
            can_read = can_write = False
            screen = "invite_only"
    elif mode == "admin_only":
        if role not in ADMIN_ROLES:
            can_read = can_write = visible = False
            screen = "hidden"
    elif mode == "founder_only":
        can_read = can_write = visible = False
        screen = "hidden"
    elif mode == "hidden":
        can_read = can_write = visible = False
        screen = "hidden"
    elif mode == "maintenance":
        can_read = can_write = False
        screen = "maintenance"
    elif mode == "emergency_lock":
        can_read = can_write = False
        screen = "locked"
    return {"key": feature_key, "mode": mode, "visible": visible,
            "can_read": can_read, "can_write": can_write, "screen": screen,
            "message": msg, "bypass": False}


async def status_for_user(user: dict | None) -> dict:
    settings = await get_settings()
    return {"features": {k: client_state(settings, k, user) for k in FEATURES}}


# ── Audit ────────────────────────────────────────────────────────────────
async def audit(actor: dict | None, action: str, target: str, before, after, reason: str = ""):
    await db.access_control_audit.insert_one({
        "id": str(uuid.uuid4()),
        "actor_id": (actor or {}).get("id"),
        "actor_username": (actor or {}).get("username") or "scheduler",
        "action": action, "target": target,
        "before": before, "after": after, "reason": reason or "",
        "at": _now().isoformat(),
    })


# ── Scheduler blocking (no replay after restore — by design) ────────────
async def scheduler_blocked(feature_key: str) -> bool:
    try:
        settings = await get_settings()
        mode, _ = effective_mode(settings, feature_key)
        return mode == "emergency_lock"
    except Exception:
        return False


# ── Scheduled transitions (60s pass; idempotent; UTC storage) ───────────
async def apply_mode_change(feature_key: str, mode: str, message: str | None,
                            actor: dict | None, reason: str, source: str = "manual"):
    settings = await get_settings(fresh=True)
    before = dict(settings["features"].get(feature_key, {}))
    update = {f"features.{feature_key}.mode": mode,
              "updated_at": _now().isoformat()}
    if message is not None:
        update[f"features.{feature_key}.message"] = message
    await db.global_access_settings.update_one({"id": SETTINGS_ID}, {"$set": update})
    invalidate_cache()
    after = {"mode": mode, "message": message if message is not None else before.get("message", "")}
    await audit(actor, f"mode_change_{source}", feature_key, before, after, reason)


async def run_access_schedule_pass() -> dict:
    now = _now()
    executed = 0
    # One-time schedules — claim-locked (pending → done), never re-run.
    cursor = db.access_control_schedules.find(
        {"kind": "one_time", "status": "pending", "run_at": {"$lte": now.isoformat()}},
        {"_id": 0})
    async for s in cursor:
        claimed = await db.access_control_schedules.find_one_and_update(
            {"id": s["id"], "status": "pending"},
            {"$set": {"status": "done", "executed_at": now.isoformat()}})
        if not claimed:
            continue
        await apply_mode_change(s["feature_key"], s["target_mode"], s.get("message"),
                                None, f"Scheduled transition {s['id']}", source="scheduled")
        executed += 1
    # Recurring — once per local day per schedule (dedup on last_run_key).
    cursor = db.access_control_schedules.find({"kind": "recurring", "active": True}, {"_id": 0})
    async for s in cursor:
        try:
            tz = ZoneInfo(s.get("timezone") or "UTC")
        except Exception:
            tz = timezone.utc
        local = now.astimezone(tz)
        day = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][local.weekday()]
        if day not in (s.get("days") or []):
            continue
        hh, mm = (s.get("time_local") or "00:00").split(":")
        sched_minutes = int(hh) * 60 + int(mm)
        now_minutes = local.hour * 60 + local.minute
        if now_minutes < sched_minutes:
            continue
        run_key = f"{local.date().isoformat()}"
        claimed = await db.access_control_schedules.find_one_and_update(
            {"id": s["id"], "active": True, "last_run_key": {"$ne": run_key}},
            {"$set": {"last_run_key": run_key, "executed_at": now.isoformat()}})
        if not claimed:
            continue
        await apply_mode_change(s["feature_key"], s["target_mode"], s.get("message"),
                                None, f"Recurring schedule {s['id']}", source="scheduled")
        executed += 1
    return {"executed": executed}


_sched_task = None


async def _schedule_loop():
    log.info("[access-control] schedule worker started (60s)")
    await asyncio.sleep(20)
    while True:
        try:
            r = await run_access_schedule_pass()
            if r["executed"]:
                log.info("[access-control] executed %s scheduled transitions", r["executed"])
        except Exception as e:
            log.warning("[access-control] schedule pass error: %s", e)
        await asyncio.sleep(60)


def start_schedule_worker():
    global _sched_task
    if _sched_task is None or _sched_task.done():
        _sched_task = asyncio.create_task(_schedule_loop())


# ── Isolated demo content (Public Preview — NEVER real data) ────────────
DEMO_PREVIEW = {
    "notice": "DEMO PREVIEW — sample content only. No real Centers, members, tasks, schedules, reports, Fire Power or ORAi data is shown.",
    "center": {"name": "Demo Family Center", "type": "family", "members": 4,
               "description": "A sample Center showing how families organize responsibilities together."},
    "sample_tasks": [
        {"title": "Water the garden", "status": "in_progress", "priority": "medium"},
        {"title": "Finish math practice", "status": "assigned", "priority": "high"},
        {"title": "Plan the weekend hike", "status": "completed", "priority": "low"},
    ],
    "sample_calendar": [
        {"title": "Family dinner", "type": "event", "when": "Fridays 18:00"},
        {"title": "Study block", "type": "class", "when": "Weekdays 16:00"},
    ],
    "capabilities": ["Responsibilities & tasks", "Groups & calendars",
                     "Reports", "AI-assisted courses", "Digital routines"],
}
