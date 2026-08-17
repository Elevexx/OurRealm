"""Private ORAi access control — the floating ORAi Operating Assistant is
founder-only unless a user is explicitly granted access. Enforced
server-side on EVERY assistant request; revocation is instant because
nothing is cached per-session. Audit: orai_access_audit.
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from core.db import db
from core.permissions import get_admin_role

log = logging.getLogger("ourrealm.orai.access")

FOUNDER_ACCESS = {"founder": True, "chat_enabled": True, "voice_enabled": True,
                  "generation_enabled": True}


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def orai_audit(actor: dict, action: str, *, target: str = None, detail: str = ""):
    try:
        await db.orai_access_audit.insert_one({
            "id": uuid.uuid4().hex, "at": _iso(), "action": action,
            "actor_id": actor.get("id"), "actor_username": actor.get("username"),
            "target": target, "detail": str(detail)[:500]})
    except Exception:  # noqa: BLE001 — audit must never block flows
        log.warning("orai access audit write failed")


async def get_orai_access(user: dict):
    """Returns the effective access record, or None (no access)."""
    if get_admin_role(user) == "founder":
        return dict(FOUNDER_ACCESS)
    row = await db.orai_private_access.find_one({"user_id": user["id"]}, {"_id": 0})
    if not row:
        return None
    exp = row.get("expires_at")
    if exp and exp < _iso():
        await orai_audit(user, "access_expired", target=user.get("username"))
        return None
    return {"founder": False, **row}


async def require_orai_access(user: dict, capability: str = "chat") -> dict:
    """403 unless the user holds active private ORAi access (+capability)."""
    access = await get_orai_access(user)
    if not access or not access.get(f"{capability}_enabled", False):
        await orai_audit(user, "access_denied", target=user.get("username"),
                         detail=f"capability={capability}")
        raise HTTPException(status_code=403, detail="Forbidden")
    if not access.get("founder"):
        await db.orai_private_access.update_one(
            {"user_id": user["id"]}, {"$set": {"last_used_at": _iso()}})
    return access
