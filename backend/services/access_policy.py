"""Reusable AI Access Policy Engine — per-feature eligibility rules.

ONE modular engine gates every AI capability. New features plug in with a
single AI_FEATURES entry + one require_access() call — no rewrites.

Rules per feature (all combinable): founder (always allowed), platform/center
roles, explicit usernames, invite-only grants (with expiry), required badges
(any/all), minimum progression level, Fire Power minimum + per-use cost,
daily/weekly/monthly/yearly usage limits (rolling windows), maintenance mode
with bypass roles, and a custom denial message.

Collections: ai_access_policies (+_history), ai_access_grants,
ai_access_usage, ai_access_audit.
"""
import logging
import time
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException

from core.db import db
from core.permissions import get_admin_role

log = logging.getLogger("ourrealm.access_policy")

# ── Feature registry — one entry per gated capability ────────────────────
AI_FEATURES = {
    "course_maker": {
        "label": "AI Course Maker", "unit": "course generation",
        "description": "One-click AI course generation (blueprint, lessons, media pack)."},
    "ai_video": {
        "label": "AI Video Generation", "unit": "video generation",
        "description": "Lesson video generation through the ORAi Video Engine."},
    "ai_images": {
        "label": "AI Image Generation", "unit": "image generation",
        "description": "Manual lesson illustration generation."},
    "orai_assistant": {
        "label": "ORAi Assistant", "unit": "chat message",
        "description": "Floating ORAi assistant chat (layered on top of Private ORAi Access)."},
    "game_creator": {
        "label": "ORAi Game Creator", "unit": "game build",
        "description": "Creating games with ORAi in the Game Studio (estimates are free; builds consume)."},
    "games_play": {
        "label": "OurRealm Games", "unit": "game session",
        "description": "Playing published games in the /games hub."},
}

ROLE_OPTIONS = ["platform_admin", "center_owner", "center_admin", "center_manager"]
BYPASS_OPTIONS = ["founder", "platform_admin", "granted"]
LIMIT_WINDOWS = {"daily": 1, "weekly": 7, "monthly": 30, "yearly": 365}

DEFAULT_POLICY = {
    "restricted": False,          # False = open (current behavior)
    "invite_only": False,         # True = ONLY founder + grants + allow_usernames
    "allow_roles": [],            # ROLE_OPTIONS subset — identity allowlist
    "allow_usernames": [],        # explicit usernames always allowed
    "required_badges": [],        # badge_registry keys
    "badges_mode": "any",         # any | all
    "min_level": 0,               # progression level_number minimum (0 = off)
    "min_fire_power": 0,          # vault balance required to use (0 = off)
    "fire_power_cost": 0,         # Fire Power burned per use (0 = free)
    "limits": {"daily": 0, "weekly": 0, "monthly": 0, "yearly": 0},  # 0 = unlimited
    "maintenance": False,
    "maintenance_bypass": ["founder"],
    "message": "",                # custom denial message
}

_cache = {}  # feature_key -> (at, doc)


def _iso(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()


async def get_policy(feature_key: str) -> dict:
    if feature_key not in AI_FEATURES:
        raise ValueError(f"Unknown AI feature: {feature_key}")
    hit = _cache.get(feature_key)
    if hit and time.monotonic() - hit[0] < 10:
        return hit[1]
    doc = await db.ai_access_policies.find_one({"_id": feature_key}) or {}
    merged = {**DEFAULT_POLICY, **{k: v for k, v in doc.items() if k in DEFAULT_POLICY}}
    merged["limits"] = {**DEFAULT_POLICY["limits"], **(merged.get("limits") or {})}
    _cache[feature_key] = (time.monotonic(), merged)
    return merged


def _clean_policy(patch: dict, before: dict) -> dict:
    clean = {}
    for k, dv in DEFAULT_POLICY.items():
        if k not in patch:
            continue
        v = patch[k]
        if isinstance(dv, bool):
            clean[k] = bool(v)
        elif isinstance(dv, int):
            clean[k] = max(0, int(v))
        elif k == "limits":
            clean[k] = {w: max(0, int((v or {}).get(w) or 0)) for w in LIMIT_WINDOWS}
        elif k == "allow_roles":
            clean[k] = [r for r in (v or []) if r in ROLE_OPTIONS]
        elif k == "maintenance_bypass":
            out = [r for r in (v or []) if r in BYPASS_OPTIONS]
            clean[k] = list(dict.fromkeys(["founder", *out]))  # founder always bypasses
        elif k == "badges_mode":
            clean[k] = v if v in ("any", "all") else before[k]
        elif isinstance(dv, list):
            clean[k] = [str(x).strip()[:60] for x in (v or []) if str(x).strip()][:100]
        else:
            clean[k] = str(v or "")[:300]
    return clean


async def update_policy(feature_key: str, patch: dict, admin: dict, reason: str) -> dict:
    before = await get_policy(feature_key)
    clean = _clean_policy(patch, before)
    if clean:
        await db.ai_access_policies.update_one(
            {"_id": feature_key}, {"$set": {**clean, "updated_at": _iso(),
                                            "updated_by": admin.get("username")}}, upsert=True)
        await db.ai_access_policies_history.insert_one({
            "id": uuid.uuid4().hex, "feature_key": feature_key, "at": _iso(),
            "by_username": admin.get("username"), "reason": (reason or "")[:500],
            "before": {k: before.get(k) for k in clean}, "after": clean})
        await audit(admin, "policy_changed", feature_key, detail=str(sorted(clean.keys())))
        _cache.pop(feature_key, None)
    return await get_policy(feature_key)


async def audit(actor: dict, action: str, feature_key: str, *, target=None, detail: str = ""):
    try:
        await db.ai_access_audit.insert_one({
            "id": uuid.uuid4().hex, "at": _iso(), "action": action,
            "feature_key": feature_key, "actor_id": (actor or {}).get("id"),
            "actor_username": (actor or {}).get("username"),
            "target": target, "detail": str(detail)[:500]})
    except Exception:  # noqa: BLE001
        log.warning("ai access audit write failed")


# ── Grants (invite-only + explicit user access) ──────────────────────────
async def active_grant(feature_key: str, user_id: str) -> dict | None:
    g = await db.ai_access_grants.find_one(
        {"feature_key": feature_key, "user_id": user_id}, {"_id": 0})
    if g and g.get("expires_at") and g["expires_at"] < _iso():
        return None
    return g


# ── Evaluation ───────────────────────────────────────────────────────────
async def _center_role(user_id: str, center_id: str) -> str | None:
    if not center_id:
        return None
    m = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": user_id, "status": "active"}, {"_id": 0, "role": 1})
    return (m or {}).get("role")


async def _badges_ok(policy: dict, user_id: str, trace: list) -> bool:
    req = policy["required_badges"]
    if not req:
        return True
    mine = {b["badge_key"] for b in await db.user_badges.find(
        {"user_id": user_id, "badge_key": {"$in": req}}, {"_id": 0, "badge_key": 1}).to_list(100)}
    ok = bool(mine) if policy["badges_mode"] == "any" else set(req) <= mine
    trace.append({"check": f"badges ({policy['badges_mode']}: {', '.join(req)})", "pass": ok})
    return ok


async def _level_ok(policy: dict, user_id: str, trace: list) -> bool:
    if not policy["min_level"]:
        return True
    ulp = await db.user_level_progress.find_one(
        {"user_id": user_id}, {"_id": 0, "current_level_number": 1})
    lvl = int((ulp or {}).get("current_level_number") or 0)
    ok = lvl >= policy["min_level"]
    trace.append({"check": f"progression level ≥ {policy['min_level']} (you: {lvl})", "pass": ok})
    return ok


async def _fp_balance(user_id: str) -> int:
    w = await db.fire_wallets.find_one({"user_id": user_id}, {"_id": 0, "vault_balance": 1})
    return max(0, int((w or {}).get("vault_balance") or 0))


async def _limit_state(policy: dict, feature_key: str, user_id: str) -> tuple[str | None, dict]:
    """Returns (blocked_window, remaining_per_window). Rolling windows."""
    remaining, blocked = {}, None
    now = datetime.now(timezone.utc)
    for window, days in LIMIT_WINDOWS.items():
        cap = int(policy["limits"].get(window) or 0)
        if not cap:
            continue
        used = await db.ai_access_usage.count_documents(
            {"feature_key": feature_key, "user_id": user_id,
             "at": {"$gte": (now - timedelta(days=days)).isoformat()}})
        remaining[window] = max(0, cap - used)
        if used >= cap and not blocked:
            blocked = window
    return blocked, remaining


async def check_access(feature_key: str, user: dict, *, center_id: str = None,
                       consume: bool = False) -> dict:
    """The one entry point every AI feature calls. Modular + reusable."""
    policy = await get_policy(feature_key)
    trace = []
    uid, uname = user["id"], (user.get("username") or "")
    admin_role = get_admin_role(user)
    is_founder = admin_role == "founder"
    grant = await active_grant(feature_key, uid)

    def deny(reason):
        return {"allowed": False, "reason": policy["message"] or reason, "trace": trace}

    if is_founder:
        trace.append({"check": "founder", "pass": True})
        if consume:
            await _record_use(feature_key, user, 0)
        return {"allowed": True, "reason": None, "trace": trace, "remaining": {}}

    # Maintenance
    if policy["maintenance"]:
        bypass = ("platform_admin" in policy["maintenance_bypass"] and admin_role) or \
                 ("granted" in policy["maintenance_bypass"] and grant)
        trace.append({"check": "maintenance bypass", "pass": bool(bypass)})
        if not bypass:
            return deny(f"{AI_FEATURES[feature_key]['label']} is under maintenance — check back soon")

    identity = False
    if uname.lower() in [u.lower() for u in policy["allow_usernames"]]:
        identity = True
        trace.append({"check": "username allowlist", "pass": True})
    elif grant:
        identity = True
        trace.append({"check": "invite grant", "pass": True})

    if policy["invite_only"]:
        if not identity:
            trace.append({"check": "invite-only", "pass": False})
            return deny(f"{AI_FEATURES[feature_key]['label']} is currently invite-only")
    elif policy["restricted"]:
        if not identity and policy["allow_roles"]:
            if "platform_admin" in policy["allow_roles"] and admin_role:
                identity = True
                trace.append({"check": "role: platform admin", "pass": True})
            else:
                crole = await _center_role(uid, center_id)
                for r in ("owner", "admin", "manager"):
                    if f"center_{r}" in policy["allow_roles"] and crole == r:
                        identity = True
                        trace.append({"check": f"role: center {r}", "pass": True})
                        break
        if not identity:
            earned_criteria = bool(policy["required_badges"] or policy["min_level"] or policy["min_fire_power"])
            if not earned_criteria:
                return deny(f"You don't have access to {AI_FEATURES[feature_key]['label']} yet")
            if not await _badges_ok(policy, uid, trace):
                names = ", ".join(policy["required_badges"])
                return deny(f"Requires the {names} badge{'s' if len(policy['required_badges']) > 1 else ''}")
            if not await _level_ok(policy, uid, trace):
                return deny(f"Requires progression level {policy['min_level']} or higher")
            if policy["min_fire_power"]:
                bal = await _fp_balance(uid)
                ok = bal >= policy["min_fire_power"]
                trace.append({"check": f"Fire Power ≥ {policy['min_fire_power']} (you: {bal})", "pass": ok})
                if not ok:
                    return deny(f"Requires at least {policy['min_fire_power']} Fire Power in your vault")

    # Usage limits (everyone but founder)
    blocked, remaining = await _limit_state(policy, feature_key, uid)
    if blocked:
        cap = policy["limits"][blocked]
        trace.append({"check": f"{blocked} limit ({cap})", "pass": False})
        return deny(f"{blocked.capitalize()} limit reached ({cap} {AI_FEATURES[feature_key]['unit']}s) — try again later")

    # Fire Power cost per use
    cost = int(policy["fire_power_cost"] or 0)
    if cost and not consume:
        bal = await _fp_balance(uid)
        if bal < cost:
            trace.append({"check": f"Fire Power cost {cost} (you: {bal})", "pass": False})
            return deny(f"Each use costs {cost} Fire Power — your vault has {bal}")
    if consume:
        if cost:
            r = await db.fire_wallets.update_one(
                {"user_id": uid, "vault_balance": {"$gte": cost}},
                {"$inc": {"vault_balance": -cost}})
            if not r.modified_count:
                bal = await _fp_balance(uid)
                trace.append({"check": f"Fire Power cost {cost} (you: {bal})", "pass": False})
                return deny(f"Each use costs {cost} Fire Power — your vault has {bal}")
        await _record_use(feature_key, user, cost)

    return {"allowed": True, "reason": None, "trace": trace, "remaining": remaining}


async def _record_use(feature_key: str, user: dict, fp_cost: int):
    try:
        await db.ai_access_usage.insert_one({
            "id": uuid.uuid4().hex, "feature_key": feature_key,
            "user_id": user["id"], "username": user.get("username"),
            "fp_cost": fp_cost, "at": _iso()})
    except Exception:  # noqa: BLE001
        log.warning("ai access usage write failed")


async def require_access(feature_key: str, user: dict, *, center_id: str = None,
                         consume: bool = False):
    """Raise 403 with the friendly denial reason. Drop-in for any endpoint."""
    res = await check_access(feature_key, user, center_id=center_id, consume=consume)
    if not res["allowed"]:
        await audit(user, "access_denied", feature_key, detail=res["reason"])
        raise HTTPException(status_code=403, detail=res["reason"])
    return res


async def usage_summary(feature_key: str) -> dict:
    now = datetime.now(timezone.utc)
    out = {}
    for label, days in (("today", 1), ("week", 7), ("month", 30)):
        out[label] = await db.ai_access_usage.count_documents(
            {"feature_key": feature_key, "at": {"$gte": (now - timedelta(days=days)).isoformat()}})
    top = await db.ai_access_usage.aggregate([
        {"$match": {"feature_key": feature_key,
                    "at": {"$gte": (now - timedelta(days=7)).isoformat()}}},
        {"$group": {"_id": "$username", "uses": {"$sum": 1}, "fp": {"$sum": "$fp_cost"}}},
        {"$sort": {"uses": -1}}, {"$limit": 8}]).to_list(8)
    out["top_users"] = [{"username": t["_id"], "uses": t["uses"], "fire_power": t["fp"]} for t in top]
    return out
