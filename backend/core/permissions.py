"""Admin role / permission model — Phase α.

OurRealm uses a small, fixed set of admin roles enforced at the API
boundary. Role assignment is intentionally NOT user-editable through any
public UI; promotion happens via:

  1. Built-in seed: `@stealth` is always `founder`, `@support` is always
     `support_admin` (see core/seed.py).
  2. Server-controlled DB writes (Mongo shell / migration script).
  3. Optional env var `ADMIN_PROMOTE_USERNAMES` parsed at startup, of the
     form `alice:moderator,bob:support_admin`. Idempotent.

This module is import-safe (no DB calls at module load time).
"""
from __future__ import annotations

from typing import Iterable

from fastapi import HTTPException


# Canonical role names. Stored on the user doc as `admin_role`.
ROLE_FOUNDER = "founder"
ROLE_SUPPORT_ADMIN = "support_admin"
ROLE_MODERATOR = "moderator"

# Roles that grant ANY admin entry (loose gate = the legacy require_admin).
ADMIN_ROLES = {ROLE_FOUNDER, ROLE_SUPPORT_ADMIN, ROLE_MODERATOR}

# Permission matrix — per the Phase α spec.
#   founder         → full platform access
#   support_admin   → support tickets + moderation
#   moderator       → moderation queue only
PERM_MODERATION = "moderation"   # queue, actions, reports
PERM_SUPPORT = "support"         # tickets, ticket categories
PERM_ANALYTICS = "analytics"     # dashboards, FAQ admin, hashtag admin
PERM_EXPORTS = "exports"         # CSV exports (Phase β)
PERM_WEBHOOKS = "webhooks"       # internal webhook log (Phase β)
PERM_DIAGNOSTICS = "diagnostics" # storage diagnostics (founder only)

ROLE_PERMS: dict[str, set[str]] = {
    ROLE_FOUNDER: {
        PERM_MODERATION, PERM_SUPPORT, PERM_ANALYTICS,
        PERM_EXPORTS, PERM_WEBHOOKS, PERM_DIAGNOSTICS,
    },
    ROLE_SUPPORT_ADMIN: {PERM_MODERATION, PERM_SUPPORT, PERM_EXPORTS},
    ROLE_MODERATOR: {PERM_MODERATION},
}


def get_admin_role(user: dict | None) -> str | None:
    """Return the admin role for a user doc, or None if not an admin.

    The username-based safety net ensures `@stealth` is always treated
    as `founder` even if the DB row is missing the `admin_role` field
    (defensive against a partial seed).
    """
    if not user or user.get("disabled"):
        return None
    explicit = user.get("admin_role")
    if explicit in ADMIN_ROLES:
        return explicit
    # Safety net: well-known system accounts.
    uname = (user.get("username") or "").lower()
    if uname == "stealth":
        return ROLE_FOUNDER
    if uname == "support":
        return ROLE_SUPPORT_ADMIN
    return None


def has_permission(user: dict | None, perm: str) -> bool:
    role = get_admin_role(user)
    if not role:
        return False
    return perm in ROLE_PERMS.get(role, set())


def require_permission(user: dict | None, perm: str) -> None:
    if not has_permission(user, perm):
        raise HTTPException(status_code=403, detail="Insufficient admin permission")


def require_role(user: dict | None, allowed: Iterable[str]) -> None:
    role = get_admin_role(user)
    if role not in set(allowed):
        raise HTTPException(status_code=403, detail="Insufficient admin role")


# Convenience gates used by routers.
def require_moderation_access(user: dict | None) -> None:
    require_permission(user, PERM_MODERATION)


def require_support_access(user: dict | None) -> None:
    require_permission(user, PERM_SUPPORT)


def require_analytics_access(user: dict | None) -> None:
    require_permission(user, PERM_ANALYTICS)


def require_founder(user: dict | None) -> None:
    if get_admin_role(user) != ROLE_FOUNDER:
        raise HTTPException(status_code=403, detail="Founder only")


def parse_promotions_env(raw: str | None) -> list[tuple[str, str]]:
    """Parse ADMIN_PROMOTE_USERNAMES=`alice:moderator,bob:support_admin`.

    Returns [(username_lower, role), ...]. Unknown roles and malformed
    entries are silently ignored — startup must never crash on this.
    """
    out: list[tuple[str, str]] = []
    if not raw:
        return out
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk or ":" not in chunk:
            continue
        uname, role = chunk.split(":", 1)
        uname = uname.strip().lstrip("@").lower()
        role = role.strip().lower()
        if not uname or role not in {ROLE_MODERATOR, ROLE_SUPPORT_ADMIN}:
            # Founder is reserved for @stealth only — never promote anyone
            # else into it via env config.
            continue
        out.append((uname, role))
    return out
