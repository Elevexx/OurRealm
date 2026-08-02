"""Site Access Modes — Live / Beta / Preview / Maintenance (modular).

Single settings doc (platform_settings id="site_access") with a mode,
per-mode customizable screens, and one "Always Allow" list. Admins always
bypass. Enforced SERVER-SIDE via middleware; frontend renders the screen.
New modes can be added by extending MODES + pages dict.
"""
import time
from datetime import datetime, timezone

from core.db import db
from core.permissions import get_admin_role, ADMIN_ROLES
from fastapi.responses import JSONResponse

MODES = ["live", "beta", "preview", "maintenance"]

DEFAULT_PAGES = {
    "beta": {"title": "OurRealm Beta is coming soon",
             "message": "We're polishing the experience for our beta community. Check back soon!"},
    "preview": {"title": "OurRealm Preview",
                "message": "OurRealm is currently in private preview. Access is limited to invited members."},
    "maintenance": {"title": "Scheduled maintenance",
                    "message": "OurRealm is briefly down for maintenance. All of your data is safe — we'll be right back."},
}

_cache = {"doc": None, "at": 0.0}


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def default_settings():
    return {"id": "site_access", "mode": "live",
            "pages": {k: dict(v) for k, v in DEFAULT_PAGES.items()},
            "allowlist": [], "updated_at": _now_iso()}


async def get_settings(fresh: bool = False) -> dict:
    if not fresh and _cache["doc"] and time.monotonic() - _cache["at"] < 4:
        return _cache["doc"]
    doc = await db.platform_settings.find_one({"id": "site_access"}, {"_id": 0})
    if not doc:
        doc = default_settings()
    doc.setdefault("pages", {})
    for k, v in DEFAULT_PAGES.items():
        doc["pages"].setdefault(k, dict(v))
    doc.setdefault("allowlist", [])
    _cache["doc"] = doc
    _cache["at"] = time.monotonic()
    return doc


def invalidate():
    _cache["doc"] = None


def is_allowed(settings: dict, user: dict | None) -> bool:
    if settings.get("mode", "live") == "live":
        return True
    if not user:
        return False
    if get_admin_role(user) in ADMIN_ROLES:
        return True
    uid = user.get("id")
    return any(e.get("user_id") == uid for e in settings.get("allowlist", []))


WHITELIST = ("/api/auth", "/api/site-access", "/api/admin", "/api/access-control")


async def enforce_request(request):
    path = request.url.path
    if not path.startswith("/api") or path.startswith(WHITELIST):
        return None
    settings = await get_settings()
    mode = settings.get("mode", "live")
    if mode == "live":
        return None
    from services.access_control import _resolve_user
    user = await _resolve_user(request)
    if is_allowed(settings, user):
        return None
    page = settings["pages"].get(mode, {})
    return JSONResponse(status_code=423, content={"detail": {
        "code": "site_mode", "mode": mode,
        "title": page.get("title"), "message": page.get("message")}})
