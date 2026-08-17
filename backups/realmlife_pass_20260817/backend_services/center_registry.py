"""Universal Center registries — type/terminology/module config foundation.

One shared engine: center types differ by registry configuration, never by
duplicated code. Untyped/legacy centers keep full current behavior.
"""
import logging
from datetime import datetime, timezone

from core.db import db

log = logging.getLogger("ourrealm.center_registry")
_seeded = False


def _iso():
    return datetime.now(timezone.utc).isoformat()


MODULES = [
    ("dashboard", "Dashboard"), ("overview", "Overview"), ("members", "Members"),
    ("roles", "Roles"), ("work", "Tasks & Responsibilities"), ("projects", "Projects"),
    ("goals", "Goals & Milestones"), ("calendar", "Calendar"), ("events", "Events"),
    ("attendance", "Attendance"), ("approvals", "Approvals"), ("reports", "Reports"),
    ("analytics", "Analytics"), ("templates", "Templates"), ("widgets", "Widgets"),
    ("media", "Media"), ("notifications", "Notifications"), ("activity", "Activity"),
    ("fire_power", "Fire Power"), ("vault", "Vault"), ("renewals", "Renewals"),
    ("permissions", "Permissions"), ("moderation", "Moderation"), ("audit", "Audit Logs"),
    ("orai", "ORAi Assistant"), ("courses", "Courses"), ("routines", "Routines"),
    ("intelligence", "Intelligence"), ("lifecycle", "Lifecycle"),
]
CORE_MODULES = ["dashboard", "members", "work", "calendar", "activity", "widgets", "orai"]
ALL_MODULE_KEYS = [k for k, _ in MODULES]

CREATOR_TOOLS = ["project_creator", "game_creator", "course_creator", "media_creator",
                 "workflow_creator", "event_creator", "report_creator"]

# key → (label, terminology, extra default modules, creator tools)
SEED_TYPES = {
    "education": ("Education Center",
                  {"member": "Student", "work": "Assignment", "group": "Class"},
                  ["courses", "attendance", "approvals", "reports", "analytics", "templates",
                   "media", "fire_power", "vault", "renewals", "routines", "intelligence",
                   "lifecycle", "events", "goals", "projects"],
                  ["project_creator", "game_creator", "course_creator", "media_creator", "report_creator"]),
    "family": ("Family Center",
               {"member": "Family Member", "work": "Chore", "group": "Household"},
               ["events", "approvals", "fire_power", "vault", "routines", "media"],
               ["project_creator", "event_creator", "media_creator"]),
    "business": ("Business Center",
                 {"member": "Employee", "work": "Work Item", "group": "Department"},
                 ["projects", "goals", "approvals", "reports", "analytics", "events",
                  "attendance", "templates", "permissions", "audit"],
                 ["project_creator", "workflow_creator", "report_creator", "media_creator"]),
    "creator": ("Creator Center",
                {"member": "Creator", "work": "Project", "group": "Studio"},
                ["projects", "media", "goals", "analytics", "templates"],
                ["project_creator", "game_creator", "course_creator", "media_creator"]),
    "community": ("Community Center",
                  {"member": "Member", "work": "Mission", "group": "Community Group"},
                  ["events", "attendance", "moderation", "reports", "media"],
                  ["event_creator", "media_creator", "report_creator"]),
    "gaming": ("Gaming Center",
               {"member": "Player", "work": "Quest", "group": "Guild"},
               ["projects", "events", "fire_power", "media", "analytics"],
               ["game_creator", "project_creator", "media_creator"]),
    "team": ("Team Center",
             {"member": "Team Member", "work": "Task", "group": "Team"},
             ["projects", "goals", "events", "attendance", "reports"],
             ["project_creator", "workflow_creator", "report_creator"]),
    "event": ("Event Center",
              {"member": "Volunteer", "work": "Task", "group": "Crew"},
              ["events", "attendance", "approvals", "media", "reports"],
              ["event_creator", "media_creator", "report_creator"]),
    "organization": ("Organization Center",
                     {"member": "Member", "work": "Responsibility", "group": "Division"},
                     ["projects", "goals", "approvals", "reports", "analytics", "events",
                      "permissions", "audit", "templates"],
                     ["project_creator", "workflow_creator", "report_creator"]),
    "personal": ("Personal Center",
                 {"member": "Member", "work": "Task", "group": "Space"},
                 ["goals", "routines", "media"],
                 ["project_creator", "media_creator"]),
    "custom": ("Custom Center",
               {"member": "Member", "work": "Work Item", "group": "Group"},
               ALL_MODULE_KEYS,
               CREATOR_TOOLS),
}
# legacy CENTER_TYPES aliases map onto registry types
LEGACY_TYPE_MAP = {"household": "family", "church": "community", "sports": "team",
                   "volunteer": "community", "other": "custom"}


async def ensure_seed():
    """Idempotent registry seed — founder edits are never overwritten."""
    global _seeded
    if _seeded:
        return
    for key, label in MODULES:
        await db.center_module_registry.update_one(
            {"key": key}, {"$setOnInsert": {"key": key, "label": label, "core": key in CORE_MODULES,
                                            "created_at": _iso()}}, upsert=True)
    for key, (label, terms, extra, tools) in SEED_TYPES.items():
        await db.center_type_registry.update_one(
            {"key": key},
            {"$setOnInsert": {"key": key, "label": label, "terminology": terms,
                              "default_modules": sorted(set(CORE_MODULES + extra)),
                              "creator_tools": tools, "recommended_widgets": [],
                              "enabled": True, "created_at": _iso()}}, upsert=True)
    _seeded = True


async def get_registry() -> dict:
    await ensure_seed()
    types = await db.center_type_registry.find({}, {"_id": 0}).to_list(100)
    modules = await db.center_module_registry.find({}, {"_id": 0}).to_list(200)
    return {"types": types, "modules": modules, "creator_tools": CREATOR_TOOLS}


async def get_center_config(center: dict) -> dict:
    """Resolved terminology + enabled modules for one center.

    Untyped/legacy centers get EVERYTHING enabled (exact current behavior)."""
    await ensure_seed()
    raw_type = center.get("center_type") or center.get("type") or ""
    tkey = LEGACY_TYPE_MAP.get(raw_type, raw_type)
    tdoc = await db.center_type_registry.find_one({"key": tkey}, {"_id": 0}) if tkey else None
    if not tdoc:
        return {"center_type": raw_type or None, "type_label": None,
                "terminology": SEED_TYPES["custom"][1],
                "modules": {k: "enabled" for k in ALL_MODULE_KEYS},
                "creator_tools": CREATOR_TOOLS, "legacy": True}
    modules = {k: ("enabled" if k in tdoc["default_modules"] else "disabled")
               for k in ALL_MODULE_KEYS}
    for k in CORE_MODULES:
        modules[k] = "enabled"
    for k, v in (center.get("module_config") or {}).items():  # per-center overrides win
        if k in modules and v in ("enabled", "disabled", "hidden", "required"):
            modules[k] = v
    return {"center_type": tkey, "type_label": tdoc["label"],
            "terminology": tdoc.get("terminology") or {},
            "modules": modules,
            "has_overrides": bool(center.get("module_config")),
            "creator_tools": tdoc.get("creator_tools") or [], "legacy": False}
