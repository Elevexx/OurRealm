"""ORAi Operating Assistant — live platform access + smart actions.

Extends the EXISTING ORAi (rc_orai center chat stays untouched). This
module powers the global assistant: permission-filtered live platform
data for admins, page awareness, and a validated action catalog the
model can reference with [[action:id]] markers. Only actions the
signed-in user is already allowed to perform are ever offered.
"""
import re
from datetime import datetime, timedelta, timezone

from core.db import db
from core.permissions import get_admin_role, ROLE_FOUNDER, ADMIN_ROLES


def _iso(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()


# ── Action catalog (reuses EXISTING routes/APIs only) ────────────────────
# kind: navigate → client route | api → existing endpoint | client → local
ACTION_CATALOG = {
    "open_admin":           {"label": "Open Admin Hub", "kind": "navigate", "to": "/admin", "role": "admin"},
    "open_analytics":       {"label": "Open Analytics", "kind": "navigate", "to": "/admin/analytics", "role": "admin"},
    "open_moderation":      {"label": "Open Moderation", "kind": "navigate", "to": "/admin/moderation", "role": "admin"},
    "open_widgets":         {"label": "Open Widget Builder", "kind": "navigate", "to": "/admin/widgets", "role": "admin"},
    "open_orai_control":    {"label": "Open ORAi Control", "kind": "navigate", "to": "/admin/orai-control", "role": "admin"},
    "open_access_control":  {"label": "Open Access Control", "kind": "navigate", "to": "/admin/access-control", "role": "founder"},
    "open_rc_admin":        {"label": "RC Admin Panel", "kind": "navigate", "to": "/admin/responsibility-center", "role": "admin"},
    "open_orion_logs":      {"label": "Scan ORAi Logs", "kind": "navigate", "to": "/admin/orion-logs", "role": "admin"},
    "open_data_health":     {"label": "Data Health Audit", "kind": "navigate", "to": "/admin/data-health", "role": "admin"},
    "open_realm_pulse":     {"label": "Realm Pulse", "kind": "navigate", "to": "/admin/realm-pulse", "role": "admin"},
    "open_settings":        {"label": "Open Settings", "kind": "navigate", "to": "/settings", "role": "any"},
    "open_parent":          {"label": "Parent Controls", "kind": "navigate", "to": "/parent", "role": "any"},
    "open_rc_hub":          {"label": "Responsibility Center", "kind": "navigate", "to": "/responsibility-center", "role": "any"},
    "pause_signups":        {"label": "Pause Public Signups", "kind": "api", "method": "PATCH",
                             "path": "/admin/access-control/signup", "body": {"allow_new_signups": False},
                             "confirm": "Pause all new public signups?", "role": "founder"},
    "resume_signups":       {"label": "Resume Public Signups", "kind": "api", "method": "PATCH",
                             "path": "/admin/access-control/signup", "body": {"allow_new_signups": True},
                             "confirm": "Reopen public signups?", "role": "founder"},
    # Center-scoped (require center_id in context; {cid} is substituted)
    "open_course_studio":   {"label": "Open Course Studio", "kind": "navigate", "to": "/responsibility-center/{cid}/courses", "role": "any", "needs_center": True},
    "generate_course":      {"label": "Generate a Course", "kind": "navigate", "to": "/responsibility-center/{cid}/courses?generate=1", "role": "any", "needs_center": True},
    "open_intelligence":    {"label": "Open Intelligence", "kind": "navigate", "to": "/responsibility-center/{cid}/intelligence", "role": "any", "needs_center": True},
    "open_routines":        {"label": "Open Routines", "kind": "navigate", "to": "/responsibility-center/{cid}/routines", "role": "any", "needs_center": True},
    "open_center":          {"label": "Open this Center", "kind": "navigate", "to": "/responsibility-center/{cid}", "role": "any", "needs_center": True},
    "refresh":              {"label": "Refresh", "kind": "client", "op": "refresh", "role": "any"},
    "retry":                {"label": "Retry", "kind": "client", "op": "retry", "role": "any"},
}


def allowed_actions(user: dict, center_id: str | None) -> dict:
    role = get_admin_role(user)
    out = {}
    for aid, a in ACTION_CATALOG.items():
        need = a.get("role", "any")
        if need == "founder" and role != ROLE_FOUNDER:
            continue
        if need == "admin" and role not in ADMIN_ROLES:
            continue
        if a.get("needs_center") and not center_id:
            continue
        entry = {k: v for k, v in a.items() if k not in ("role", "needs_center")}
        if a.get("needs_center"):
            entry["to"] = a["to"].replace("{cid}", center_id)
        out[aid] = entry
    return out


ACTION_RE = re.compile(r"\[\[action:([a-z_]+)\]\]")


def extract_actions(reply: str, allowed: dict) -> tuple[str, list]:
    ids, actions = [], []
    for m in ACTION_RE.findall(reply or ""):
        if m in allowed and m not in ids:
            ids.append(m)
            actions.append({"id": m, **allowed[m]})
    clean = ACTION_RE.sub("", reply or "").strip()
    return clean, actions[:6]


# ── Live platform snapshot (ADMIN/FOUNDER only, permission-gated) ────────
async def _count(coll, q=None):
    try:
        return await db[coll].count_documents(q or {})
    except Exception:
        return 0


async def platform_snapshot(user: dict) -> str:
    role = get_admin_role(user)
    if role not in ADMIN_ROLES:
        return ""
    now = datetime.now(timezone.utc)
    online_cut = (now - timedelta(minutes=5)).isoformat()
    day_ago = (now - timedelta(hours=24)).isoformat()
    users_total = await _count("users", {"disabled": {"$ne": True}})
    users_online = await _count("users", {"presence_last_seen": {"$gte": online_cut}})
    signups_24h = await _count("users", {"created_at": {"$gte": day_ago}})
    centers = await _count("responsibility_centers")
    courses = await _count("rc_courses")
    lessons = await _count("rc_course_lessons")
    reports_open = await _count("reports", {"status": {"$in": ["open", "pending", None]}})
    tickets_open = await _count("tickets", {"status": {"$nin": ["closed", "resolved"]}})
    widgets = await _count("widget_registry") or await _count("community_widgets")
    teens = await _count("users", {"age_class": "teen"})
    lines = [
        f"Users: {users_total} total · {users_online} online now · {signups_24h} new in 24h · {teens} teen accounts",
        f"Responsibility Centers: {centers} · Courses: {courses} · Lessons: {lessons}",
        f"Open moderation reports: {reports_open} · Open support tickets: {tickets_open} · Widgets: {widgets}",
    ]
    try:
        newest = await db.users.find({}, {"_id": 0, "username": 1, "created_at": 1}) \
            .sort("created_at", -1).limit(5).to_list(5)
        if newest:
            lines.append("Newest members: " + ", ".join(f"@{u.get('username')}" for u in newest))
    except Exception:
        pass
    try:
        sg = await db.platform_settings.find_one({"id": "signup"}, {"_id": 0})
        lines.append(f"Public signups: {'PAUSED' if sg and sg.get('allow_new_signups') is False else 'open'}")
        acc = await db.global_access_settings.find_one({"id": "global"}, {"_id": 0, "features": 1})
        if acc:
            restricted = [k for k, v in (acc.get("features") or {}).items()
                          if v.get("mode") not in ("full_access",) and k != "rc_public_preview"]
            lines.append("Access-control restrictions: " + (", ".join(restricted) if restricted else "none — all features full access"))
    except Exception:
        pass
    try:
        await db.command("ping")
        lines.append("System health: database responding normally")
    except Exception:
        lines.append("System health: DATABASE PING FAILED")
    if role == ROLE_FOUNDER:
        sched = await _count("access_control_schedules", {"kind": "one_time", "status": "pending"})
        lines.append(f"Pending scheduled access transitions: {sched}")
    return "LIVE PLATFORM SNAPSHOT (real data, admin-only — you MAY share these numbers with this user):\n" + "\n".join(lines)


PAGE_NAMES = [
    ("/admin/access-control", "Global Access Control (founder)"),
    ("/admin/analytics", "Admin Analytics"),
    ("/admin/moderation", "Moderation Center"),
    ("/admin/widgets", "Widget Builder"),
    ("/admin/orai-control", "ORAi Control panel"),
    ("/admin/responsibility-center", "RC Admin panel"),
    ("/admin", "Admin Dashboard"),
    ("/responsibility-center/", "a Responsibility Center"),
    ("/responsibility-center", "Responsibility Center Hub"),
    ("/courses", "Course Studio / AI Courses Preview"),
    ("/learn", "Course Player"),
    ("/intelligence", "ORAi Intelligence dashboard"),
    ("/routines", "Digital Routines"),
    ("/parent", "Parent Controls dashboard"),
    ("/my-limits", "My Limits (teen)"),
    ("/settings", "Settings"),
    ("/profile", "User Profile"),
    ("/home", "Home Dashboard"),
]


def page_name(path: str) -> str:
    for prefix, name in PAGE_NAMES:
        if (path or "").startswith(prefix) or prefix in (path or ""):
            return name
    return path or "unknown page"
