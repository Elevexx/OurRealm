"""ORAi Public Access Control — capability policies, versions, enforcement.

Policies are backend-enforced (check_policy) — never UI-only. Explicit deny
overrides allow; the only exception is the audited founder emergency
override (founders always pass unless emergency_disabled is set).
Priority (deterministic): emergency_disabled > enabled=False > founder
bypass > access-level check > power/limit checks.
"""
import logging
import uuid
from datetime import datetime, timezone

from core.db import db

log = logging.getLogger("ourrealm.orai_policies")

# Discovered from this repository — only capabilities that actually exist.
CAPABILITIES = {
    "gamemaker_planning": "Game Maker planning & estimates",
    "gamemaker_create": "Game Maker game creation builds",
    "orai_edit": "ORAi Living Project editing",
    "image_generation": "ORAi image generation",
    "asset_reuse": "Asset Library reuse",
    "course_generation": "Course generation",
    "rc_assistance": "Responsibility Center assistance",
    "public_chat": "ORAi public chat",
    "file_analysis": "ORAi file analysis / uploads",
    "publishing_assist": "Publishing assistance (For You posts)",
    "resource_image_generation": "Engagement resource image generation",
    "resource_administration": "Engagement resource administration",
}
ACCESS_LEVELS = ("founder", "beta", "signed_in", "public")

DEFAULTS = {"enabled": True, "access": "founder", "min_power": 1, "max_power": 10,
            "default_power": 5, "providers": [], "prompt_max": 2000,
            "daily_limit": None, "monthly_limit": None, "cost_ceiling": None,
            "media_allowed": True, "private_data_allowed": False,
            "auto_publish": False, "require_approval": False, "emergency_disabled": False}


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def ensure_seed():
    await db.orai_policies.create_index("capability", unique=True)
    await db.orai_policy_versions.create_index([("capability", 1), ("version", -1)])
    await db.orai_policy_proposals.create_index("id", unique=True)
    for cap in CAPABILITIES:
        await db.orai_policies.update_one(
            {"capability": cap},
            {"$setOnInsert": {**DEFAULTS, "capability": cap, "label": CAPABILITIES[cap],
                              "version": 1, "created_at": _iso(), "updated_at": _iso(),
                              "updated_by": "system-default"}},
            upsert=True)


async def get_policy(capability: str) -> dict | None:
    return await db.orai_policies.find_one({"capability": capability}, {"_id": 0})


async def check_policy(capability: str, user: dict | None, *, power: int | None = None,
                       is_founder: bool = False, is_beta: bool = False) -> dict:
    """Returns {allowed, reason, policy}. Backend-authoritative."""
    p = await get_policy(capability)
    if not p:
        return {"allowed": False, "reason": "unknown_capability"}
    if p.get("emergency_disabled"):
        return {"allowed": False, "reason": "emergency_disabled", "policy": p}
    if not p.get("enabled"):
        return {"allowed": False, "reason": "disabled", "policy": p}
    if is_founder:
        return {"allowed": True, "reason": "founder", "policy": p}
    lvl = p.get("access", "founder")
    if lvl == "founder":
        return {"allowed": False, "reason": "founder_only", "policy": p}
    if lvl == "beta" and not is_beta:
        return {"allowed": False, "reason": "beta_only", "policy": p}
    if lvl in ("beta", "signed_in") and not user:
        return {"allowed": False, "reason": "sign_in_required", "policy": p}
    if power is not None and not (int(p["min_power"]) <= int(power) <= int(p["max_power"])):
        return {"allowed": False, "reason": f"ai_power_out_of_range({p['min_power']}-{p['max_power']})",
                "policy": p}
    if p.get("daily_limit") and user:
        from datetime import timedelta
        since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        used = await db.orai_policy_usage.count_documents(
            {"capability": capability, "user_id": user["id"], "at": {"$gte": since}})
        if used >= int(p["daily_limit"]):
            return {"allowed": False, "reason": "daily_limit_reached", "policy": p}
    return {"allowed": True, "reason": "ok", "policy": p}


async def record_usage(capability: str, user_id: str):
    await db.orai_policy_usage.insert_one({"capability": capability, "user_id": user_id, "at": _iso()})


EDITABLE = tuple(DEFAULTS.keys())


async def update_policy(capability: str, changes: dict, actor: str, note: str = "") -> dict:
    p = await get_policy(capability)
    if not p:
        raise ValueError("Unknown capability")
    upd = {k: changes[k] for k in EDITABLE if k in changes}
    if "access" in upd and upd["access"] not in ACCESS_LEVELS:
        raise ValueError("Invalid access level")
    if not upd:
        raise ValueError("No editable fields")
    # snapshot the outgoing version (immutable history + rollback)
    await db.orai_policy_versions.insert_one({**p, "snapshot_at": _iso()})
    new_v = int(p["version"]) + 1
    await db.orai_policies.update_one({"capability": capability}, {"$set": {
        **upd, "version": new_v, "updated_at": _iso(), "updated_by": actor}})
    await db.orai_policy_audit.insert_one({
        "id": uuid.uuid4().hex, "capability": capability, "by": actor, "at": _iso(),
        "changes": upd, "from_version": p["version"], "to_version": new_v, "note": note[:300]})
    return await get_policy(capability)


async def rollback_policy(capability: str, to_version: int, actor: str) -> dict:
    snap = await db.orai_policy_versions.find_one(
        {"capability": capability, "version": int(to_version)}, {"_id": 0, "snapshot_at": 0})
    if not snap:
        raise ValueError("Version not found")
    changes = {k: snap[k] for k in EDITABLE if k in snap}
    return await update_policy(capability, changes, actor, note=f"rollback to v{to_version}")
