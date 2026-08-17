"""Reward ledger — durable, idempotent reward grants + reputation transactions."""
import uuid
import logging
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError
from core.db import db

log = logging.getLogger("ourrealm.progression.rewards")

REWARD_TYPES = {
    "level_badge", "completion_badge", "registry_badge", "profile_frame",
    "username_effect", "profile_background", "mode_cosmetic", "reputation",
    "feature_access", "realm_access", "widget_access", "mode_access",
    "custom_title", "custom_icon", "temporary_cosmetic", "permanent_cosmetic",
    "custom", "none",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _ensure_registry_badge(badge_key: str, name: str, icon: str | None, color: str | None):
    existing = await db.badge_registry.find_one({"key": badge_key})
    if existing:
        return
    await db.badge_registry.insert_one({
        "id": uuid.uuid4().hex, "key": badge_key, "name": name,
        "description": f"Earned through OurRealm progression: {name}",
        "icon": icon or "Trophy", "color": color or "#F4C84A",
        "assignment_type": "progression", "is_system": True, "status": "active",
        "created_at": _now(), "created_by": "progression",
    })


async def _apply_side_effect(user_id: str, reward: dict, grant: dict) -> None:
    rtype = reward.get("type")
    if rtype in ("completion_badge", "registry_badge"):
        badge_key = reward.get("badge_key") or f"lvl_{(reward.get('name') or 'badge').lower().replace(' ', '_')[:40]}"
        if rtype == "completion_badge":
            await _ensure_registry_badge(badge_key, reward.get("name") or "Level Badge",
                                         reward.get("icon"), reward.get("color"))
        username = (await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1}) or {}).get("username")
        await db.user_badges.update_one(
            {"id": f"{user_id}::{badge_key}"},
            {"$setOnInsert": {"id": f"{user_id}::{badge_key}", "user_id": user_id,
                              "username": username, "badge_key": badge_key,
                              "assigned_at": _now(), "assigned_by": "progression",
                              "source": "progression", "grant_id": grant["id"]}},
            upsert=True,
        )
    elif rtype == "reputation":
        amount = int(reward.get("amount") or 0)
        if amount:
            await grant_reputation(user_id, amount, grant["idempotency_key"],
                                   source={"claim_id": grant.get("source_claim_id"),
                                           "level_id": grant.get("source_level_id"),
                                           "reward_id": grant.get("reward_definition_id")},
                                   reason=f"Level reward: {reward.get('name') or 'reputation'}")
    # unlock / cosmetic / title rewards: the grant row IS the durable record;
    # backend checks use `has_unlock`, display layers read the ledger.


async def grant_reputation(user_id: str, amount: int, idem_key: str, source: dict, reason: str) -> bool:
    """Idempotent reputation transaction + synchronized balance."""
    try:
        await db.reputation_transactions.insert_one({
            "id": uuid.uuid4().hex, "user_id": user_id, "amount": amount,
            "idempotency_key": idem_key, "reason": reason, "status": "applied",
            "source": source or {}, "created_at": _now(),
        })
    except DuplicateKeyError:
        return False
    await db.users.update_one({"id": user_id}, {"$inc": {"reputation_points": amount}})
    return True


async def grant_rewards_for_claim(user_id: str, level_snap: dict, claim_id: str) -> list[dict]:
    """Idempotent: one grant per (user, level, version, reward). Failures are
    recorded as retryable and never corrupt the claim itself."""
    results = []
    for reward in (level_snap.get("rewards") or []):
        if reward.get("type") in (None, "none"):
            continue
        rid = reward.get("id") or "r0"
        idem = f"{user_id}:{level_snap['id']}:{level_snap['config_version']}:{rid}"
        grant = {
            "id": uuid.uuid4().hex, "user_id": user_id,
            "reward_definition_id": rid, "reward_version": reward.get("version", 1),
            "reward_snapshot": reward,
            "source_level_id": level_snap["id"], "source_level_version": level_snap["config_version"],
            "source_task_id": reward.get("source_task_id"), "source_claim_id": claim_id,
            "status": "granted", "granted_at": _now(), "idempotency_key": idem,
            "expires_at": reward.get("expires_at"), "revoked": False,
            "repair_status": None, "last_verified_at": _now(),
        }
        try:
            await db.user_reward_grants.insert_one(grant)
        except DuplicateKeyError:
            results.append({"reward_id": rid, "status": "already_granted"})
            continue
        try:
            await _apply_side_effect(user_id, reward, grant)
            results.append({"reward_id": rid, "status": "granted", "grant_id": grant["id"]})
        except Exception as e:
            log.exception("reward side-effect failed")
            await db.user_reward_grants.update_one(
                {"id": grant["id"]},
                {"$set": {"status": "failed", "repair_status": "pending", "error": str(e)[:400]}})
            results.append({"reward_id": rid, "status": "failed", "grant_id": grant["id"], "error": str(e)[:200]})
    return results


async def retry_grant(grant_id: str) -> dict:
    grant = await db.user_reward_grants.find_one({"id": grant_id}, {"_id": 0})
    if not grant:
        return {"ok": False, "error": "grant not found"}
    if grant.get("status") == "granted":
        return {"ok": True, "status": "already_granted"}
    try:
        await _apply_side_effect(grant["user_id"], grant.get("reward_snapshot") or {}, grant)
        await db.user_reward_grants.update_one(
            {"id": grant_id}, {"$set": {"status": "granted", "repair_status": "repaired",
                                        "granted_at": _now(), "last_verified_at": _now()}})
        return {"ok": True, "status": "granted"}
    except Exception as e:
        await db.user_reward_grants.update_one(
            {"id": grant_id}, {"$set": {"repair_status": "pending", "error": str(e)[:400]}})
        return {"ok": False, "error": str(e)[:200]}


async def revoke_grant(grant_id: str, reason: str, revoked_by: str) -> dict:
    grant = await db.user_reward_grants.find_one({"id": grant_id}, {"_id": 0})
    if not grant:
        return {"ok": False, "error": "grant not found"}
    if grant.get("revoked"):
        return {"ok": True, "status": "already_revoked"}
    reward = grant.get("reward_snapshot") or {}
    if reward.get("type") == "reputation":
        amount = int(reward.get("amount") or 0)
        if amount:
            await grant_reputation(grant["user_id"], -amount, f"revoke:{grant['idempotency_key']}",
                                   source={"grant_id": grant_id}, reason=f"Revocation: {reason}")
    if reward.get("type") in ("completion_badge", "registry_badge"):
        badge_key = reward.get("badge_key") or f"lvl_{(reward.get('name') or 'badge').lower().replace(' ', '_')[:40]}"
        await db.user_badges.delete_one({"id": f"{grant['user_id']}::{badge_key}", "source": "progression"})
    await db.user_reward_grants.update_one(
        {"id": grant_id},
        {"$set": {"revoked": True, "status": "revoked", "revocation_reason": reason,
                  "revoked_by": revoked_by, "revoked_at": _now()}})
    return {"ok": True, "status": "revoked"}


async def has_unlock(user_id: str, unlock_type: str, key: str | None = None) -> bool:
    q = {"user_id": user_id, "status": "granted", "revoked": {"$ne": True},
         "reward_snapshot.type": unlock_type}
    if key:
        q["reward_snapshot.unlock_key"] = key
    return bool(await db.user_reward_grants.find_one(q, {"_id": 0, "id": 1}))
