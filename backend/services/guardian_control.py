"""OurRealm Guardian Controls — Teen (13-17) / Adult (18+) permission engine.

Generic guardianship model (guardian role + managed account) so future
school/teacher/organization guardians plug in without rewrites.
ALL restrictions are enforced SERVER-SIDE via an HTTP middleware hook.

Precedence (most powerful first):
1. Global Access Control (separate system, evaluated by its own guard)
2. Manual guardian lock
3. Schedule / bedtime / screen-time gates
4. Teen-specific explicit overrides (win over routine)
5. Active routine (most-restrictive merge with base settings)
6. Base per-teen settings (preset-seeded)

Collections: guardian_links, guardian_permissions, guardian_routines,
guardian_audit, guardian_screen_time.
"""
import logging
import time
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import jwt
from fastapi.responses import JSONResponse

from core.db import db
from core.config import JWT_ALGORITHM, get_jwt_secret

log = logging.getLogger("ourrealm.guardian")

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

# ── Feature registry (grouped for the parent UI) ────────────────────────
FEATURE_GROUPS = {
    "social": ["home_feed", "create_posts", "view_posts", "comments", "reactions",
               "fire_power", "sounds", "videos", "images", "stories",
               "live_streaming", "groups", "realms", "communities",
               "marketplace", "events", "friend_requests", "public_discovery"],
    "communication": ["direct_messages", "group_messages", "voice_calls", "video_calls"],
    "discovery": ["search_users", "search_posts", "trending", "nearby"],
    "profile": ["edit_profile", "profile_music", "bio", "username_changes"],
    "ai": ["orai_chat", "ai_image_generation", "ai_voice", "ai_course_builder",
           "ai_assistant_tools"],
}
ALL_FEATURES = [k for g in FEATURE_GROUPS.values() for k in g]

MEDIA_TYPES = ["images", "gifs", "videos", "audio", "music", "documents", "external_links"]
MEDIA_SOURCES = ["upload_photos", "upload_videos", "upload_audio", "camera",
                 "microphone", "screen_recording", "downloads", "file_sharing"]
CONTENT_FILTERS = ["safe", "moderate", "standard", "everything"]

CENTER_TYPES = ["personal", "family", "household", "education", "business", "team",
                "organization", "church", "sports", "community", "volunteer", "other"]

# ── Presets ──────────────────────────────────────────────────────────────
def _fmap(true_keys):
    return {k: (k in true_keys) for k in ALL_FEATURES}


PRESETS = {
    "strict": {
        "features": _fmap({"fire_power", "edit_profile", "bio",
                           "ai_course_builder", "ai_assistant_tools"}),
        "media_types": {k: k in {"images", "documents"} for k in MEDIA_TYPES},
        "media_sources": {k: False for k in MEDIA_SOURCES},
        "content_filter": "safe",
        "centers": {k: k in {"personal", "family", "household", "education"} for k in CENTER_TYPES},
    },
    "balanced": {
        "features": _fmap({"home_feed", "create_posts", "view_posts", "comments",
                           "reactions", "fire_power", "sounds", "videos", "images",
                           "stories", "groups", "realms", "communities",
                           "friend_requests", "direct_messages", "group_messages",
                           "search_users", "search_posts", "trending",
                           "edit_profile", "profile_music", "bio",
                           "orai_chat", "ai_voice", "ai_course_builder",
                           "ai_assistant_tools"}),
        "media_types": {k: k != "external_links" for k in MEDIA_TYPES},
        "media_sources": {k: k in {"upload_photos", "upload_videos", "upload_audio",
                                   "camera", "microphone", "downloads"} for k in MEDIA_SOURCES},
        "content_filter": "moderate",
        "centers": {k: True for k in CENTER_TYPES},
    },
    "open": {
        "features": {k: True for k in ALL_FEATURES},
        "media_types": {k: True for k in MEDIA_TYPES},
        "media_sources": {k: True for k in MEDIA_SOURCES},
        "content_filter": "standard",
        "centers": {k: True for k in CENTER_TYPES},
    },
}


def _now():
    return datetime.now(timezone.utc)


def default_permissions(teen_id: str, guardian_id: str, preset: str = "strict") -> dict:
    p = PRESETS.get(preset, PRESETS["strict"])
    return {
        "id": str(uuid.uuid4()),
        "teen_id": teen_id, "guardian_id": guardian_id, "preset": preset,
        "features": dict(p["features"]),
        "media_types": dict(p["media_types"]),
        "media_sources": dict(p["media_sources"]),
        "content_filter": p["content_filter"],
        "centers": dict(p["centers"]),
        "screen_time": {"daily_minutes": None, "weekly_minutes": None},
        "schedule": {"enabled": False, "days": list(DAYS),
                     "windows": [{"start": "07:00", "end": "21:00"}]},
        "bedtime": {"enabled": False, "start": "21:30", "end": "07:00"},
        "locked": False, "lock_reason": "",
        "routine_id": None,
        "overrides": [],  # keys explicitly set by parent — win over routine
        "timezone": "UTC",
        "updated_at": _now().isoformat(),
    }


# ── Effective settings (routine merge, most restrictive) ────────────────
def effective_settings(perms: dict, routine: dict | None) -> tuple[dict, str]:
    eff = deepcopy(perms)
    controlling = "teen_settings"
    if perms.get("locked"):
        controlling = "manual_lock"
    if routine and routine.get("enabled", True) and _routine_active_now(routine, perms.get("timezone", "UTC")):
        overrides = set(perms.get("overrides") or [])
        for section in ("features", "media_types", "media_sources", "centers"):
            for k, v in (routine.get(section) or {}).items():
                if f"{section}.{k}" in overrides:
                    continue
                eff[section][k] = bool(eff[section].get(k, False)) and bool(v)
        rst = routine.get("screen_time") or {}
        if rst.get("daily_minutes") is not None:
            base = eff["screen_time"].get("daily_minutes")
            eff["screen_time"]["daily_minutes"] = rst["daily_minutes"] if base is None \
                else min(base, rst["daily_minutes"])
        if (routine.get("bedtime") or {}).get("enabled"):
            eff["bedtime"] = dict(routine["bedtime"])
        if (routine.get("schedule") or {}).get("enabled"):
            eff["schedule"] = dict(routine["schedule"])
        if controlling == "teen_settings":
            controlling = f"routine:{routine.get('name', 'Routine')}"
    return eff, controlling


def _routine_active_now(routine: dict, tz_name: str) -> bool:
    """Routine applies always unless it declares its own active days/windows
    via `active_when` (scheduled activation)."""
    aw = routine.get("active_when")
    if not aw or not aw.get("enabled"):
        return True
    try:
        tz = ZoneInfo(tz_name or "UTC")
    except Exception:
        tz = timezone.utc
    local = _now().astimezone(tz)
    day = DAYS[local.weekday()]
    if day not in (aw.get("days") or DAYS):
        return False
    hm = local.strftime("%H:%M")
    start, end = aw.get("start", "00:00"), aw.get("end", "23:59")
    if start <= end:
        return start <= hm <= end
    return hm >= start or hm <= end  # crosses midnight


# ── Time gates ───────────────────────────────────────────────────────────
def _local(perms):
    try:
        tz = ZoneInfo(perms.get("timezone") or "UTC")
    except Exception:
        tz = timezone.utc
    return _now().astimezone(tz), tz


def _in_window(hm, start, end):
    if start <= end:
        return start <= hm < end
    return hm >= start or hm < end


def schedule_state(eff: dict) -> tuple[bool, str | None]:
    """Return (blocked, next_available_local_iso)."""
    sch = eff.get("schedule") or {}
    if not sch.get("enabled"):
        return False, None
    local, tz = _local(eff)
    windows = sch.get("windows") or []
    days = sch.get("days") or DAYS
    if DAYS[local.weekday()] in days:
        hm = local.strftime("%H:%M")
        for w in windows:
            if _in_window(hm, w.get("start", "00:00"), w.get("end", "23:59")):
                return False, None
    # find the next window start within 8 days
    for offset in range(0, 8):
        d = local + timedelta(days=offset)
        if DAYS[d.weekday()] not in days:
            continue
        for w in sorted(windows, key=lambda x: x.get("start", "")):
            st = w.get("start", "00:00")
            if offset == 0 and st <= local.strftime("%H:%M"):
                continue
            hh, mm = st.split(":")
            nxt = d.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
            return True, nxt.isoformat()
    return True, None


def bedtime_state(eff: dict) -> tuple[bool, str | None]:
    bt = eff.get("bedtime") or {}
    if not bt.get("enabled"):
        return False, None
    local, tz = _local(eff)
    hm = local.strftime("%H:%M")
    start, end = bt.get("start", "21:30"), bt.get("end", "07:00")
    if _in_window(hm, start, end):
        hh, mm = end.split(":")
        nxt = local.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        if nxt <= local:
            nxt += timedelta(days=1)
        return True, nxt.isoformat()
    return False, None


# ── Screen time (heartbeat-based, dedup across tabs, tz-aware reset) ────
_usage_cache: dict = {}


def _local_date(perms) -> str:
    local, _ = _local(perms)
    return local.date().isoformat()


async def used_minutes_today(teen_id: str, perms: dict) -> float:
    key = (teen_id, _local_date(perms))
    hit = _usage_cache.get(key)
    if hit and time.monotonic() - hit[1] < 5:
        return hit[0]
    doc = await db.guardian_screen_time.find_one(
        {"teen_id": teen_id, "date": key[1]}, {"_id": 0, "minutes": 1})
    mins = float((doc or {}).get("minutes", 0))
    _usage_cache[key] = (mins, time.monotonic())
    return mins


async def record_heartbeat(teen_id: str, perms: dict) -> dict:
    today = _local_date(perms)
    now = _now()
    doc = await db.guardian_screen_time.find_one(
        {"teen_id": teen_id, "date": today}, {"_id": 0})
    if doc and doc.get("last_hb"):
        try:
            elapsed = (now - datetime.fromisoformat(doc["last_hb"])).total_seconds()
        except Exception:
            elapsed = 60
        if elapsed < 45:  # duplicate tab/device — do not double count
            return {"minutes": doc.get("minutes", 0), "counted": False}
        inc = min(2.0, max(0.5, elapsed / 60.0))  # grace for delayed heartbeats
    else:
        inc = 1.0
    await db.guardian_screen_time.update_one(
        {"teen_id": teen_id, "date": today},
        {"$inc": {"minutes": round(inc, 2)}, "$set": {"last_hb": now.isoformat()}},
        upsert=True)
    _usage_cache.pop((teen_id, today), None)
    new_total = (doc or {}).get("minutes", 0) + inc
    return {"minutes": round(new_total, 1), "counted": True}


# ── Data access (cached) ─────────────────────────────────────────────────
_perm_cache: dict = {}


async def get_perms(teen_id: str, fresh: bool = False) -> dict | None:
    hit = _perm_cache.get(teen_id)
    if not fresh and hit and time.monotonic() - hit[1] < 5:
        return hit[0]
    doc = await db.guardian_permissions.find_one({"teen_id": teen_id}, {"_id": 0})
    _perm_cache[teen_id] = (doc, time.monotonic())
    return doc


def invalidate_perms(teen_id: str):
    _perm_cache.pop(teen_id, None)


async def get_routine(routine_id: str | None) -> dict | None:
    if not routine_id:
        return None
    return await db.guardian_routines.find_one({"id": routine_id}, {"_id": 0})


async def effective_for_teen(teen_id: str) -> tuple[dict, str]:
    perms = await get_perms(teen_id)
    if not perms:
        # Teen without a guardian: protected by strict defaults, no time gates.
        perms = default_permissions(teen_id, guardian_id="")
    routine = await get_routine(perms.get("routine_id"))
    return effective_settings(perms, routine)


# ── Age-out: teen turning 18 auto-converts to Adult ─────────────────────
def compute_age(birth_date: str | None) -> int | None:
    if not birth_date:
        return None
    try:
        bd = datetime.fromisoformat(birth_date[:10]).date()
    except Exception:
        return None
    today = _now().date()
    return today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))


async def maybe_age_out(user: dict) -> bool:
    """If a teen is now 18+, convert to adult and end guardianship. Audit kept."""
    age = compute_age(user.get("birth_date"))
    if age is None or age < 18:
        return False
    await db.users.update_one({"id": user["id"]}, {"$set": {"age_class": "adult"}})
    await db.guardian_links.update_many(
        {"teen_id": user["id"], "status": "active"},
        {"$set": {"status": "ended_aged_out", "ended_at": _now().isoformat()}})
    await audit(None, user["id"], "aged_out_to_adult", None,
                {"age_class": "adult"}, "Automatic conversion at 18")
    _acct_cache.pop(user["id"], None)
    invalidate_perms(user["id"])
    return True


# ── Audit ────────────────────────────────────────────────────────────────
async def audit(guardian: dict | None, teen_id: str, action: str, before, after, reason: str = ""):
    await db.guardian_audit.insert_one({
        "id": str(uuid.uuid4()),
        "guardian_id": (guardian or {}).get("id"),
        "guardian_username": (guardian or {}).get("username") or "system",
        "teen_id": teen_id, "action": action,
        "before": before, "after": after, "reason": reason or "",
        "at": _now().isoformat(),
    })


# ── Path → permission mapping ────────────────────────────────────────────
WHITELIST_PREFIXES = ("/api/auth", "/api/guardian", "/api/access-control",
                      "/api/notifications", "/api/presence", "/api/faq",
                      "/api/tickets", "/api/media")


def required_permission(path: str, method: str, eff: dict):
    """Return ("features"|"media_sources", key) or ("center", center_id) or None."""
    write = method not in ("GET", "HEAD", "OPTIONS")
    if "/search" in path:
        return ("features", "search_users" if ("profile" in path or "users" in path) else "search_posts")
    if path.startswith("/api/posts"):
        return ("features", "create_posts" if write else "view_posts")
    if path.startswith("/api/threads"):
        return ("features", "comments")
    if path.startswith("/api/reactions"):
        return ("features", "reactions")
    if path.startswith("/api/fire"):
        return ("features", "fire_power")
    if path.startswith("/api/sounds"):
        return ("media_sources", "upload_audio") if write else ("features", "sounds")
    if path.startswith("/api/videos"):
        return ("media_sources", "upload_videos") if write else ("features", "videos")
    if path.startswith("/api/images"):
        return ("media_sources", "upload_photos") if write else ("features", "images")
    if path.startswith("/api/playlists"):
        return ("features", "sounds")
    if path.startswith("/api/messages"):
        return ("features", "direct_messages")
    if path.startswith("/api/widgets/chat"):
        return ("features", "orai_chat")
    if path.startswith("/api/communities") or path.startswith("/api/community"):
        return ("features", "communities")
    if path.startswith("/api/realm"):
        return ("features", "realms")
    if path.startswith("/api/friends") or "friend-request" in path:
        return ("features", "friend_requests") if write else None
    if path.startswith("/api/hashtags"):
        return ("features", "trending")
    if path.startswith("/api/profile"):
        if "username" in path:
            return ("features", "username_changes")
        return ("features", "edit_profile") if write else None
    if path.startswith("/api/orai/voice"):
        return ("features", "ai_voice")
    if path.startswith("/api/responsibility-center"):
        rest = path[len("/api/responsibility-center"):].strip("/")
        seg = rest.split("/") if rest else []
        if "/courses/generate" in path or "/tutor" in path:
            return ("features", "ai_course_builder")
        if "/orai/" in path or "/intelligence" in path or "/automations" in path:
            return ("features", "ai_assistant_tools")
        # Center-scoped path → check the center's type against allowed centers
        if seg and seg[0] not in ("create", "config", "mine", "preferences",
                                  "my-work", "digest-settings", "templates"):
            return ("center", seg[0])
        return None
    return None


_center_type_cache: dict = {}


async def center_type_of(center_id: str) -> str | None:
    hit = _center_type_cache.get(center_id)
    if hit and time.monotonic() - hit[1] < 60:
        return hit[0]
    doc = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0, "center_type": 1})
    ct = (doc or {}).get("center_type")
    _center_type_cache[center_id] = (ct, time.monotonic())
    return ct


# ── Middleware entry ─────────────────────────────────────────────────────
_acct_cache: dict = {}  # user_id -> (age_class, ts)

LOCK_MESSAGE = "This account is currently unavailable based on your parent settings."


async def _resolve_teen(request) -> dict | None:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        return None
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        uid = payload.get("sub")
    except Exception:
        return None
    if not uid:
        return None
    hit = _acct_cache.get(uid)
    if hit and time.monotonic() - hit[1] < 30:
        if hit[0] != "teen":
            return None
        return await db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "username": 1,
                                                     "age_class": 1, "birth_date": 1})
    user = await db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "username": 1,
                                                 "age_class": 1, "birth_date": 1})
    acct = (user or {}).get("age_class") or "adult"
    _acct_cache[uid] = (acct, time.monotonic())
    return user if acct == "teen" else None


def _blocked_response(code: str, message: str, next_available: str | None = None, status: int = 423):
    return JSONResponse(status_code=status, content={"detail": {
        "code": code, "message": message, "next_available_at": next_available}})


async def enforce_request(request):
    """Returns a JSONResponse to short-circuit, or None to continue."""
    path = request.url.path
    if not path.startswith("/api") or path.startswith(WHITELIST_PREFIXES):
        return None
    teen = await _resolve_teen(request)
    if not teen:
        return None
    if await maybe_age_out(teen):
        return None
    eff, _controlling = await effective_for_teen(teen["id"])
    # 1. Manual lock
    if eff.get("locked"):
        return _blocked_response("guardian_locked", LOCK_MESSAGE, None)
    # 2. Schedule
    blocked, nxt = schedule_state(eff)
    if blocked:
        return _blocked_response("outside_schedule", LOCK_MESSAGE, nxt)
    # 3. Bedtime
    blocked, nxt = bedtime_state(eff)
    if blocked:
        return _blocked_response("bedtime", LOCK_MESSAGE, nxt)
    # 4. Screen time
    limit = (eff.get("screen_time") or {}).get("daily_minutes")
    if limit is not None:
        used = await used_minutes_today(teen["id"], eff)
        if used >= limit:
            local, _ = _local(eff)
            nxt = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            return _blocked_response("screen_time", LOCK_MESSAGE, nxt.isoformat())
    # 5. Feature / media / center permission
    req = required_permission(path, request.method, eff)
    if not req:
        return None
    kind, key = req
    if kind == "center":
        ct = await center_type_of(key)
        if ct and not (eff.get("centers") or {}).get(ct, False):
            return _blocked_response("guardian_center_disabled",
                                     "Access to this Center type is turned off by your parent settings.",
                                     None, status=403)
        return None
    if not (eff.get(kind) or {}).get(key, False):
        return _blocked_response("guardian_feature_disabled",
                                 "This feature is turned off by your parent settings.",
                                 None, status=403)
    return None
