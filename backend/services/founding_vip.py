"""Founding VIP Member Reward — claim-based program for the first 1,000
real registered members (permanent member numbers 1–1,000).

One combined reward per qualifying user: existing VIP role + permanent
"Founding VIP" badge + 1,000🔥 deposited into the permanent Fire Vault,
granted ONLY when the user manually claims. Idempotent by design:
- one eligibility record per (rule_id, user_id) — unique index
- fire grant guarded by a unique wallet-transaction idempotency key
- claim flip is an atomic status transition (eligible → processing → claimed)
"""
from __future__ import annotations

import io
import csv
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.db import db

log = logging.getLogger("founding_vip")

RULE_ID = "founding_vip"

DEFAULT_CONFIG = {
    "id": RULE_ID,
    "enabled": True,
    "published": True,
    "rule_version": 1,
    "program_name": "Founding VIP Member Reward",
    "min_member_number": 1,
    "max_member_number": 1000,
    "fire_amount": 1000,
    "destination": "vault",
    "claim_required": True,
    "start_date": None,
    "end_date": None,
    "claim_expiration": None,
    "existing_users_eligible": True,
    "future_users_eligible": True,
    "include_manual_vips": False,
    # ── Claim card (all founder-editable) ──
    "card_title": "🎉 Founding VIP Reward",
    "card_description": "You're one of OurRealm's first 1,000 members!",
    "card_details": "Press Claim Reward to receive your rewards. Your Fire has not been added yet — it will be deposited into your permanent Fire Vault after you claim.",
    "card_rewards": ["⭐ Permanent VIP Status", "🔥 1,000 Fire Power added to your Fire Vault"],
    "card_button_text": "Claim Reward",
    "card_button_color": "#FF7A1A",
    "card_accent_color": "#F4C84A",
    "card_image_url": None,
    "card_background_url": None,
    "card_icon": "🏆",
    "card_celebration": True,
    "card_terms": "One claim per qualifying founding member. Reward deposits to your permanent Fire Vault.",
    "expired_message": "This reward has expired.",
    "claimed_message": "Reward Claimed! You now have permanent VIP status, and 1,000🔥 has been added to your Fire Vault.",
    # ── Login popup ──
    "popup_enabled": True,
    "popup_title": "Your Founding VIP Reward is ready!",
    "popup_message": "Claim permanent VIP status and 1,000🔥 from your Fire Wallet.",
    # ── Notification ──
    "notification_enabled": True,
    "notification_title": "Founding VIP Reward claimed",
    "notification_message": "Welcome to OurRealm's Founding 1,000! You claimed permanent VIP status and 1,000🔥 in your Fire Vault.",
    "notification_show_amount": True,
    "notification_show_vip": True,
    "notification_link": "/profile",
    "draft": None,
    "versions": [],
}

_TEXT_FIELDS = {
    "program_name", "card_title", "card_description", "card_details",
    "card_button_text", "card_terms", "expired_message", "claimed_message",
    "popup_title", "popup_message", "notification_title", "notification_message",
    "notification_link", "card_icon",
}
_SANITIZE_RE = re.compile(r"<[^>]*>")

SUSPECT_USERNAME_RE = re.compile(
    r"(^|_)(test|demo|probe|synthetic|bot|e2e|iter\d|dummy|sample|fake|qa)($|_|\d)", re.I)
SYSTEM_USERNAMES = {"support"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sanitize(v):
    if isinstance(v, str):
        return _SANITIZE_RE.sub("", v).strip()[:2000]
    if isinstance(v, list):
        return [_sanitize(x) for x in v][:20]
    return v


_INDEXES_READY = False


async def ensure_indexes() -> None:
    global _INDEXES_READY
    if _INDEXES_READY:
        return
    await db.founding_vip_rewards.create_index(
        [("rule_id", 1), ("user_id", 1)], unique=True, name="uniq_rule_user")
    await db.founding_vip_rewards.create_index([("status", 1)], name="by_status")
    await db.founding_vip_rewards.create_index([("member_number", 1)], name="by_member_number")
    await db.users.create_index([("member_number", 1)], sparse=True, name="by_member_number")
    _INDEXES_READY = True


async def get_config() -> dict:
    await ensure_indexes()
    cfg = await db.founding_vip_config.find_one({"id": RULE_ID}, {"_id": 0})
    if not cfg:
        cfg = dict(DEFAULT_CONFIG)
        try:
            await db.founding_vip_config.insert_one({**cfg})
        except DuplicateKeyError:
            pass
        cfg.pop("_id", None)
    return {**DEFAULT_CONFIG, **cfg}


def _public_config(cfg: dict) -> dict:
    return {k: cfg.get(k) for k in cfg if k not in {"draft", "versions"}}


# ── Config editing (draft / preview / publish / versions) ──────────────
_VERSIONED_FIELDS = {"min_member_number", "max_member_number", "fire_amount", "destination"}


async def save_draft(changes: dict) -> dict:
    cfg = await get_config()
    clean = {}
    for k, v in changes.items():
        if k in {"id", "rule_version", "versions", "draft"}:
            continue
        if k not in DEFAULT_CONFIG:
            continue
        clean[k] = _sanitize(v) if (k in _TEXT_FIELDS or isinstance(v, (str, list))) else v
    draft = {**(cfg.get("draft") or {}), **clean}
    await db.founding_vip_config.update_one({"id": RULE_ID}, {"$set": {"draft": draft}})
    return draft


async def publish_draft(founder: dict) -> dict:
    cfg = await get_config()
    draft = cfg.get("draft") or {}
    if not draft:
        return _public_config(cfg)
    snapshot = {k: cfg.get(k) for k in DEFAULT_CONFIG if k not in {"draft", "versions"}}
    bump = any(k in draft and draft[k] != cfg.get(k) for k in _VERSIONED_FIELDS)
    set_ops = {**draft, "draft": None}
    if bump:
        set_ops["rule_version"] = int(cfg.get("rule_version") or 1) + 1
    await db.founding_vip_config.update_one({"id": RULE_ID}, {
        "$set": set_ops,
        "$push": {"versions": {"$each": [{"version": cfg.get("rule_version"),
                                          "snapshot": snapshot,
                                          "saved_at": _now_iso(),
                                          "saved_by": founder.get("username")}],
                               "$slice": -20}}})
    await _audit(founder, "config_publish", {"changed": list(draft.keys()), "version_bumped": bump})
    return _public_config(await get_config())


async def restore_version(founder: dict, index: int) -> dict:
    cfg = await db.founding_vip_config.find_one({"id": RULE_ID}, {"_id": 0}) or {}
    versions = cfg.get("versions") or []
    if not (0 <= index < len(versions)):
        raise ValueError("Version not found")
    snap = versions[index]["snapshot"]
    snap.pop("rule_version", None)
    await db.founding_vip_config.update_one({"id": RULE_ID}, {"$set": {**snap, "draft": None}})
    await _audit(founder, "config_restore", {"restored_index": index})
    return _public_config(await get_config())


async def _audit(actor: dict, action: str, extra: Optional[dict] = None,
                 target_user: Optional[str] = None, reason: Optional[str] = None):
    await db.founding_vip_audit.insert_one({
        "id": uuid.uuid4().hex, "action": action,
        "actor_username": actor.get("username"),
        "target_user": target_user, "reason": reason,
        "extra": extra or {}, "created_at": _now_iso()})


# ── Member numbers ──────────────────────────────────────────────────────
def is_real_account(u: dict) -> bool:
    if u.get("is_synthetic"):
        return False
    if (u.get("account_type") or "human") != "human":
        return False
    if u.get("analytics_eligible") is False:
        return False
    return True


def is_suspect_account(u: dict) -> bool:
    return bool(SUSPECT_USERNAME_RE.search(u.get("username") or ""))


async def next_member_number() -> int:
    doc = await db.counters.find_one_and_update(
        {"_id": "member_number"}, {"$inc": {"seq": 1}},
        upsert=True, return_document=ReturnDocument.AFTER)
    return int(doc["seq"])


async def assign_member_number(user_id: str) -> Optional[int]:
    """Assign a permanent number iff the user doesn't already have one."""
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "member_number": 1})
    if u is None:
        return None
    if u.get("member_number") is not None:
        return u["member_number"]
    n = await next_member_number()
    r = await db.users.update_one(
        {"id": user_id, "member_number": {"$exists": False}},
        {"$set": {"member_number": n, "member_number_assigned_at": _now_iso()}})
    if not r.modified_count:  # concurrent assignment won — number n is burned, never reused
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "member_number": 1})
        return (u or {}).get("member_number")
    return n


async def _create_eligibility(user: dict, member_number: int, cfg: dict,
                              reason: str) -> Optional[dict]:
    rec = {
        "id": uuid.uuid4().hex, "rule_id": RULE_ID,
        "rule_version": cfg.get("rule_version") or 1,
        "user_id": user["id"], "username": user.get("username"),
        "member_number": member_number,
        "status": "eligible", "eligibility_reason": reason,
        "eligibility_date": _now_iso(),
        "vip_reward": True, "fire_amount": int(cfg.get("fire_amount") or 1000),
        "destination": cfg.get("destination") or "vault",
        "claim_required": True,
        "claimed_at": None, "claim_actor": None, "claim_txn_id": None,
        "fire_txn_id": None, "previous_vault_balance": None, "new_vault_balance": None,
        "vip_awarded_through_claim": None, "notification_sent": False,
        "popup_dismissed": False,
        "expires_at": cfg.get("claim_expiration"),
        "exclusion_reason": None, "reversal_ref": None, "notes": None,
        "created_at": _now_iso(), "updated_at": _now_iso(),
    }
    try:
        await db.founding_vip_rewards.insert_one(rec)
        rec.pop("_id", None)
        return rec
    except DuplicateKeyError:
        return None


async def on_new_registration(user_id: str) -> None:
    """Signup hook — assign a member number and, when the number qualifies,
    create the unclaimed eligibility record. Never deposits Fire."""
    try:
        await ensure_indexes()
        u = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not u or not is_real_account(u):
            return
        n = await assign_member_number(user_id)
        cfg = await get_config()
        if not cfg.get("enabled") or not cfg.get("future_users_eligible"):
            return
        if n is not None and cfg["min_member_number"] <= n <= cfg["max_member_number"]:
            await _create_eligibility(u, n, cfg, "founding_member_signup")
    except Exception as e:  # noqa: BLE001
        log.warning(f"[founding-vip] signup hook failed: {e}")


# ── Backfill (existing users) ───────────────────────────────────────────
async def _classify_users() -> dict:
    real, excluded, review = [], [], []
    async for u in db.users.find({}, {"_id": 0, "id": 1, "username": 1, "created_at": 1,
                                      "is_synthetic": 1, "account_type": 1,
                                      "analytics_eligible": 1, "is_vip": 1,
                                      "member_number": 1}):
        if not is_real_account(u):
            excluded.append(u)
        elif is_suspect_account(u) and (u.get("username") or "") not in SYSTEM_USERNAMES:
            review.append(u)
            real.append(u)  # kept in sequence — founder can exclude the REWARD later
        else:
            real.append(u)
    real.sort(key=lambda x: (x.get("created_at") or "", x.get("id") or ""))
    return {"real": real, "excluded": excluded, "review": review}


async def backfill_dry_run() -> dict:
    await ensure_indexes()
    cfg = await get_config()
    cls = await _classify_users()
    lo, hi, amt = cfg["min_member_number"], cfg["max_member_number"], cfg["fire_amount"]
    qualifying = cls["real"][:hi]  # numbers assigned in order → first `hi` qualify
    q_ids = {u["id"] for u in qualifying}
    already_vip = sum(1 for u in qualifying if u.get("is_vip"))
    existing_recs = {r["user_id"]: r async for r in db.founding_vip_rewards.find(
        {"rule_id": RULE_ID}, {"_id": 0, "user_id": 1, "status": 1})}
    already_claimed = sum(1 for uid, r in existing_recs.items()
                          if uid in q_ids and r["status"] == "claimed")
    have_rec = sum(1 for uid in existing_recs if uid in q_ids)
    existing_grants = await db.fire_wallet_transactions.count_documents(
        {"transaction_type": "founding_vip_reward"})
    will_create = len(qualifying) - have_rec
    distributed = already_claimed * amt
    return {
        "mode": "dry_run", "destructive": False,
        "accounts_reviewed": len(cls["real"]) + len(cls["excluded"]),
        "real_members": len(cls["real"]),
        "excluded_system_test_demo_bot": len(cls["excluded"]),
        "excluded_samples": [u.get("username") for u in cls["excluded"][:15]],
        "needs_manual_review": len(cls["review"]),
        "review_samples": [u.get("username") for u in cls["review"][:15]],
        "qualifying_1_to_limit": len(qualifying),
        "already_holding_vip": already_vip,
        "will_need_vip_on_claim": len(qualifying) - already_vip,
        "existing_related_fire_transactions": existing_grants,
        "already_claimed": already_claimed,
        "will_receive_eligibility_record": will_create,
        "skipped_existing_records": have_rec,
        "duplicate_rewards_detected": 0,
        "duplicate_rewards_prevented": have_rec,
        "total_potential_fire_available": (len(qualifying) - already_claimed) * amt,
        "total_fire_already_distributed": distributed,
        "total_remaining_fire_liability": (len(qualifying) - already_claimed) * amt,
        "member_numbers_already_assigned": sum(1 for u in cls["real"] if u.get("member_number") is not None),
    }


async def backfill_execute(founder: dict) -> dict:
    await ensure_indexes()
    cfg = await get_config()
    cls = await _classify_users()
    hi = cfg["max_member_number"]
    numbered, created, skipped = 0, 0, 0
    # 1) permanent member numbers, oldest first, stable id tiebreak
    for u in cls["real"]:
        if u.get("member_number") is None:
            n = await next_member_number()
            r = await db.users.update_one(
                {"id": u["id"], "member_number": {"$exists": False}},
                {"$set": {"member_number": n, "member_number_assigned_at": _now_iso()}})
            if r.modified_count:
                u["member_number"] = n
                numbered += 1
    # 2) unclaimed eligibility records for qualifying numbers (no deposits)
    if cfg.get("existing_users_eligible"):
        async for u in db.users.find(
                {"member_number": {"$gte": cfg["min_member_number"], "$lte": hi}},
                {"_id": 0, "id": 1, "username": 1, "member_number": 1,
                 "is_synthetic": 1, "account_type": 1, "analytics_eligible": 1}):
            if not is_real_account(u):
                continue
            rec = await _create_eligibility(u, u["member_number"], cfg, "founding_member_backfill")
            if rec:
                created += 1
            else:
                skipped += 1
    report = {"mode": "execute", "member_numbers_assigned": numbered,
              "eligibility_records_created": created,
              "skipped_existing": skipped, "fire_deposited": 0,
              "executed_by": founder.get("username"), "executed_at": _now_iso()}
    await _audit(founder, "backfill_execute", report)
    return report


async def backfill_rollback(founder: dict) -> dict:
    """Remove UNCLAIMED eligibility records only. Member numbers are
    permanent and are never removed or reassigned."""
    res = await db.founding_vip_rewards.delete_many(
        {"rule_id": RULE_ID, "status": {"$in": ["eligible", "excluded", "revoked"]}})
    report = {"mode": "rollback", "unclaimed_records_removed": res.deleted_count,
              "claimed_records_preserved": await db.founding_vip_rewards.count_documents(
                  {"rule_id": RULE_ID, "status": "claimed"}),
              "member_numbers_preserved": True,
              "executed_by": founder.get("username"), "executed_at": _now_iso()}
    await _audit(founder, "backfill_rollback", report)
    return report


# ── User-facing status ──────────────────────────────────────────────────
async def status_for_user(user: dict) -> dict:
    await ensure_indexes()
    cfg = await get_config()
    rec = await db.founding_vip_rewards.find_one(
        {"rule_id": RULE_ID, "user_id": user["id"]}, {"_id": 0})
    if not cfg.get("enabled") or not cfg.get("published") or not rec \
            or rec["status"] in ("excluded", "revoked"):
        return {"eligible": False}
    now = _now_iso()
    expired = bool(rec.get("expires_at") and rec["expires_at"] < now and rec["status"] == "eligible") \
        or bool(cfg.get("end_date") and cfg["end_date"] < now and rec["status"] == "eligible")
    if expired and rec["status"] == "eligible":
        await db.founding_vip_rewards.update_one(
            {"id": rec["id"], "status": "eligible"},
            {"$set": {"status": "expired", "updated_at": now}})
        rec["status"] = "expired"
    card_keys = [k for k in DEFAULT_CONFIG if k.startswith(("card_", "popup_", "expired_", "claimed_"))]
    return {
        "eligible": True,
        "status": rec["status"],
        "member_number": rec.get("member_number"),
        "fire_amount": rec.get("fire_amount"),
        "claimed_at": rec.get("claimed_at"),
        "vip_awarded_through_claim": rec.get("vip_awarded_through_claim"),
        "fire_deposited": bool(rec.get("fire_txn_id")),
        "expires_at": rec.get("expires_at"),
        "popup_dismissed": bool(rec.get("popup_dismissed")),
        "config": {k: cfg.get(k) for k in card_keys},
    }


# ── The claim transaction (idempotent + self-healing) ───────────────────
async def claim(user_id: str, actor: dict, *, force: bool = False,
                reason: Optional[str] = None) -> dict:
    await ensure_indexes()
    cfg = await get_config()
    if not cfg.get("enabled"):
        raise PermissionError("The Founding VIP program is currently disabled")
    rec = await db.founding_vip_rewards.find_one({"rule_id": RULE_ID, "user_id": user_id}, {"_id": 0})
    if not rec:
        raise LookupError("You are not eligible for this reward")
    if rec["status"] == "claimed":
        return {**_claim_result(rec), "duplicate": True}
    if rec["status"] in ("excluded", "revoked", "corrected_no_reclaim"):
        raise PermissionError("This reward is not available for your account")
    now = _now_iso()
    if rec["status"] == "expired" or (rec.get("expires_at") and rec["expires_at"] < now):
        await db.founding_vip_rewards.update_one(
            {"id": rec["id"], "status": {"$in": ["eligible", "expired"]}},
            {"$set": {"status": "expired", "updated_at": now}})
        raise PermissionError(cfg.get("expired_message") or "This reward has expired")
    # Atomic flip — only ONE request (across workers) enters the grant path;
    # crashed grants leave status=processing which any retry resumes.
    flipped = await db.founding_vip_rewards.find_one_and_update(
        {"id": rec["id"], "status": {"$in": ["eligible", "processing"]}},
        {"$set": {"status": "processing", "updated_at": now}},
        return_document=ReturnDocument.AFTER)
    if not flipped:
        fresh = await db.founding_vip_rewards.find_one({"id": rec["id"]}, {"_id": 0})
        if fresh and fresh["status"] == "claimed":
            return {**_claim_result(fresh), "duplicate": True}
        raise PermissionError("This reward is not available")
    rec = flipped
    amount = int(rec.get("fire_amount") or cfg.get("fire_amount") or 1000)
    gen = int(rec.get("claim_generation") or 0)
    idem = f"founding_vip:v{rec.get('rule_version') or 1}:{user_id}" + (f":g{gen}" if gen else "")
    wallet = await db.fire_wallets.find_one({"user_id": user_id}, {"_id": 0, "vault_balance": 1})
    prev_vault = int((wallet or {}).get("vault_balance") or 0)
    txn = {
        "id": uuid.uuid4().hex, "user_id": user_id, "receiver_id": user_id,
        "amount": amount, "type": "earn", "transaction_type": "founding_vip_reward",
        "status": "collected", "source": "founding_vip",
        "idempotency_key": idem, "reward_claim_id": rec["id"],
        "created_at": now, "collected_at": now,
    }
    fire_deposited_now = True
    try:
        await db.fire_wallet_transactions.insert_one(dict(txn))
    except DuplicateKeyError:
        fire_deposited_now = False  # resume path — vault already credited
        existing = await db.fire_wallet_transactions.find_one({"idempotency_key": idem}, {"_id": 0, "id": 1})
        txn["id"] = (existing or txn)["id"]
    if fire_deposited_now:
        from services.fire_vault import WALLET_DEFAULTS
        await db.fire_wallets.update_one(
            {"user_id": user_id},
            {"$inc": {"vault_balance": amount},
             "$setOnInsert": {**{k: v for k, v in WALLET_DEFAULTS.items() if k != "vault_balance"},
                              "created_at": now}},
            upsert=True)
    new_wallet = await db.fire_wallets.find_one({"user_id": user_id}, {"_id": 0, "vault_balance": 1})
    new_vault = int((new_wallet or {}).get("vault_balance") or 0)
    # VIP role (existing program) — award only if not already held
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "is_vip": 1, "username": 1})
    vip_through_claim = "already_held" if (u or {}).get("is_vip") else "awarded"
    if vip_through_claim == "awarded":
        await db.users.update_one({"id": user_id}, {"$set": {"is_vip": True, "vip_joined_at": now}})
        await db.user_badges.update_one(
            {"user_id": user_id, "badge_key": "vip"},
            {"$setOnInsert": {"id": f"{user_id}::vip", "user_id": user_id,
                              "username": (u or {}).get("username"), "badge_key": "vip",
                              "assigned_by": "founding_vip_claim", "assigned_at": now,
                              "source": "founding_vip"}}, upsert=True)
    # Permanent, independent Founding VIP badge
    await db.users.update_one({"id": user_id}, {"$set": {
        "founding_vip": True, "founding_vip_at": now,
        "founding_vip_member_number": rec.get("member_number")}})
    await db.user_badges.update_one(
        {"user_id": user_id, "badge_key": "founding_vip"},
        {"$setOnInsert": {"id": f"{user_id}::founding_vip", "user_id": user_id,
                          "username": (u or {}).get("username"), "badge_key": "founding_vip",
                          "assigned_by": actor.get("username") or "system",
                          "assigned_at": now, "source": "founding_vip_claim"}}, upsert=True)
    # Complete the record
    await db.founding_vip_rewards.update_one({"id": rec["id"]}, {"$set": {
        "status": "claimed", "claimed_at": now,
        "claim_actor": ("founder_force" if force else "self"),
        "claim_actor_username": actor.get("username"),
        "claim_txn_id": txn["id"], "fire_txn_id": txn["id"],
        "previous_vault_balance": prev_vault, "new_vault_balance": new_vault,
        "vip_awarded_through_claim": vip_through_claim,
        "force_reason": reason if force else None, "updated_at": now}})
    # One notification (guarded flip)
    if cfg.get("notification_enabled"):
        n = await db.founding_vip_rewards.update_one(
            {"id": rec["id"], "notification_sent": False},
            {"$set": {"notification_sent": True}})
        if n.modified_count:
            try:
                from routers.notifications import emit_notification
                msg = cfg.get("notification_message") or ""
                await emit_notification(user_id, "founding_vip_claimed", actor_username=None,
                                        payload={"title": cfg.get("notification_title"),
                                                 "message": msg,
                                                 "amount": amount if cfg.get("notification_show_amount") else None,
                                                 "vip": bool(cfg.get("notification_show_vip")),
                                                 "link": cfg.get("notification_link") or "/profile"})
            except Exception as e:  # noqa: BLE001
                log.warning(f"[founding-vip] notification failed: {e}")
    await _audit(actor, "force_claim" if force else "claim",
                 {"amount": amount, "vip": vip_through_claim,
                  "prev_vault": prev_vault, "new_vault": new_vault},
                 target_user=(u or {}).get("username"), reason=reason)
    final = await db.founding_vip_rewards.find_one({"id": rec["id"]}, {"_id": 0})
    return _claim_result(final)


def _claim_result(rec: dict) -> dict:
    return {
        "ok": True, "status": rec.get("status"),
        "claimed_at": rec.get("claimed_at"),
        "fire_amount": rec.get("fire_amount"),
        "fire_txn_id": rec.get("fire_txn_id"),
        "reward_claim_id": rec.get("id"),
        "vip_awarded_through_claim": rec.get("vip_awarded_through_claim"),
        "previous_vault_balance": rec.get("previous_vault_balance"),
        "new_vault_balance": rec.get("new_vault_balance"),
        "member_number": rec.get("member_number"),
    }


# ── Corrections (claim reset — preserves originals) ─────────────────────
async def reset_claim(founder: dict, username: str, *, reason: str,
                      allow_reclaim: bool = False, reverse_fire: bool = True) -> dict:
    u = await db.users.find_one({"username": username}, {"_id": 0, "id": 1, "username": 1})
    if not u:
        raise LookupError("User not found")
    rec = await db.founding_vip_rewards.find_one(
        {"rule_id": RULE_ID, "user_id": u["id"], "status": "claimed"}, {"_id": 0})
    if not rec:
        raise LookupError("No completed claim to correct")
    now = _now_iso()
    amount = int(rec.get("fire_amount") or 1000)
    wallet = await db.fire_wallets.find_one({"user_id": u["id"]}, {"_id": 0, "vault_balance": 1})
    vault = int((wallet or {}).get("vault_balance") or 0)
    fire_available = vault >= amount
    reversed_fire = False
    warning = None
    if reverse_fire:
        if fire_available:
            rev_idem = f"founding_vip_reversal:{rec['id']}"
            try:
                await db.fire_wallet_transactions.insert_one({
                    "id": uuid.uuid4().hex, "user_id": u["id"], "receiver_id": u["id"],
                    "amount": -amount, "type": "earn", "transaction_type": "founding_vip_reversal",
                    "status": "reversed", "source": "founding_vip_correction",
                    "idempotency_key": rev_idem, "reward_claim_id": rec["id"],
                    "reason": reason, "created_at": now})
                await db.fire_wallets.update_one(
                    {"user_id": u["id"], "vault_balance": {"$gte": amount}},
                    {"$inc": {"vault_balance": -amount}})
                reversed_fire = True
            except DuplicateKeyError:
                reversed_fire = True  # already reversed by an earlier retry
        else:
            warning = ("Fire already spent or moved — vault balance is below the reward amount. "
                       "No reversal applied; vault never goes negative.")
    correction = {
        "id": uuid.uuid4().hex, "reward_claim_id": rec["id"], "user_id": u["id"],
        "username": username, "reason": reason, "amount": amount,
        "fire_was_available": fire_available, "fire_reversed": reversed_fire,
        "allow_reclaim": allow_reclaim, "created_by": founder.get("username"),
        "created_at": now}
    await db.founding_vip_corrections.insert_one(dict(correction))
    new_status = "eligible" if allow_reclaim else "corrected_no_reclaim"
    # Original claim data is PRESERVED on the record; only status moves.
    # allow_reclaim bumps claim_generation so a lawful re-claim gets a
    # fresh idempotency key and actually re-deposits the Fire.
    update_ops: dict = {"$set": {
        "status": new_status, "reversal_ref": correction["id"],
        "notification_sent": False if allow_reclaim else rec.get("notification_sent"),
        "updated_at": now}}
    if allow_reclaim:
        update_ops["$inc"] = {"claim_generation": 1}
    await db.founding_vip_rewards.update_one({"id": rec["id"]}, update_ops)
    await _audit(founder, "claim_correction", {
        "fire_reversed": reversed_fire, "allow_reclaim": allow_reclaim,
        "warning": warning}, target_user=username, reason=reason)
    correction.pop("_id", None)
    return {"ok": True, "correction": correction, "warning": warning,
            "user_can_claim_again": allow_reclaim,
            "original_claim_preserved": True}


# ── Admin: stats / users / actions / exports ────────────────────────────
async def admin_stats() -> dict:
    await ensure_indexes()
    cfg = await get_config()
    amt = cfg["fire_amount"]
    by_status = {}
    async for row in db.founding_vip_rewards.aggregate([
            {"$match": {"rule_id": RULE_ID}},
            {"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        by_status[row["_id"]] = row["n"]
    claimed = by_status.get("claimed", 0)
    eligible = by_status.get("eligible", 0)
    total_recs = sum(by_status.values())
    counter = await db.counters.find_one({"_id": "member_number"}) or {}
    last_num = int(counter.get("seq") or 0)
    last_qualifying = await db.users.count_documents(
        {"member_number": {"$lte": cfg["max_member_number"], "$gte": 1}})
    real_total = await db.users.count_documents(
        {"is_synthetic": {"$ne": True}, "account_type": {"$in": ["human", None]}})
    dup_claims = await db.founding_vip_audit.count_documents({"action": "duplicate_claim_blocked"})
    corrections = await db.founding_vip_corrections.count_documents({})
    return {
        "program_name": cfg.get("program_name"), "enabled": cfg.get("enabled"),
        "published": cfg.get("published"), "rule_version": cfg.get("rule_version"),
        "member_limit": cfg["max_member_number"], "fire_reward": amt,
        "destination": cfg.get("destination"), "claim_required": True,
        "expiration": cfg.get("claim_expiration") or cfg.get("end_date"),
        "accounts_reviewed": real_total,
        "qualifying_existing_users": last_qualifying,
        "currently_eligible": eligible, "already_claimed": claimed,
        "still_unclaimed": eligible,
        "expired": by_status.get("expired", 0),
        "excluded": by_status.get("excluded", 0) + by_status.get("revoked", 0),
        "needs_manual_review": len((await _classify_users())["review"]),
        "claim_percentage": round(claimed / total_recs * 100, 1) if total_recs else 0,
        "total_fire_distributed": claimed * amt,
        "total_fire_available_to_claim": eligible * amt,
        "future_spots_remaining": max(0, cfg["max_member_number"] - last_num),
        "last_member_number_assigned": last_num,
        "last_qualifying_member_number": min(last_num, cfg["max_member_number"]),
        "duplicate_claims_prevented": dup_claims,
        "corrections": corrections,
        "total_records": total_recs,
    }


async def admin_users(search: Optional[str] = None, status: Optional[str] = None,
                      limit: int = 50) -> list[dict]:
    q: dict = {"rule_id": RULE_ID}
    if status:
        q["status"] = status
    if search:
        q["username"] = {"$regex": re.escape(search), "$options": "i"}
    rows = [r async for r in db.founding_vip_rewards.find(q, {"_id": 0})
            .sort("member_number", 1).limit(min(limit, 200))]
    return rows


async def admin_action(founder: dict, username: str, action: str, *,
                       reason: str, extra: Optional[dict] = None) -> dict:
    u = await db.users.find_one({"username": username}, {"_id": 0, "id": 1, "username": 1,
                                                         "member_number": 1})
    if not u:
        raise LookupError("User not found")
    now = _now_iso()
    cfg = await get_config()
    rec = await db.founding_vip_rewards.find_one({"rule_id": RULE_ID, "user_id": u["id"]}, {"_id": 0})
    if action == "exclude":
        if rec and rec["status"] == "claimed":
            raise PermissionError("Cannot exclude a completed claim — use the correction workflow")
        if rec:
            await db.founding_vip_rewards.update_one({"id": rec["id"]}, {"$set": {
                "status": "excluded", "exclusion_reason": reason, "updated_at": now}})
        else:
            r = await _create_eligibility(u, u.get("member_number") or -1, cfg, "manual")
            await db.founding_vip_rewards.update_one({"id": r["id"]}, {"$set": {
                "status": "excluded", "exclusion_reason": reason, "updated_at": now}})
    elif action == "include":
        if rec:
            if rec["status"] == "claimed":
                raise PermissionError("Already claimed")
            await db.founding_vip_rewards.update_one({"id": rec["id"]}, {"$set": {
                "status": "eligible", "exclusion_reason": None,
                "eligibility_reason": "manual_include", "updated_at": now}})
        else:
            await _create_eligibility(u, u.get("member_number") or -1, cfg, "manual_include")
    elif action == "revoke":
        if not rec or rec["status"] == "claimed":
            raise PermissionError("Only unclaimed rewards can be revoked")
        await db.founding_vip_rewards.update_one({"id": rec["id"]}, {"$set": {
            "status": "revoked", "exclusion_reason": reason, "updated_at": now}})
    elif action == "extend-expiration":
        if not rec:
            raise LookupError("No reward record")
        await db.founding_vip_rewards.update_one({"id": rec["id"]}, {"$set": {
            "expires_at": (extra or {}).get("expires_at"),
            "status": "eligible" if rec["status"] == "expired" else rec["status"],
            "updated_at": now}})
    elif action == "remove-expiration":
        if not rec:
            raise LookupError("No reward record")
        await db.founding_vip_rewards.update_one({"id": rec["id"]}, {"$set": {
            "expires_at": None,
            "status": "eligible" if rec["status"] == "expired" else rec["status"],
            "updated_at": now}})
    else:
        raise ValueError("Unknown action")
    await _audit(founder, f"user_{action.replace('-', '_')}", extra or {},
                 target_user=username, reason=reason)
    return await db.founding_vip_rewards.find_one(
        {"rule_id": RULE_ID, "user_id": u["id"]}, {"_id": 0}) or {}


async def export_csv(kind: str) -> str:
    status_map = {"claimed": "claimed", "unclaimed": "eligible", "excluded": "excluded"}
    q: dict = {"rule_id": RULE_ID}
    if kind in status_map:
        q["status"] = status_map[kind]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["username", "member_number", "status", "fire_amount", "claimed_at",
                "vip_awarded_through_claim", "fire_txn_id", "eligibility_date",
                "expires_at", "exclusion_reason"])
    async for r in db.founding_vip_rewards.find(q, {"_id": 0}).sort("member_number", 1):
        w.writerow([r.get("username"), r.get("member_number"), r.get("status"),
                    r.get("fire_amount"), r.get("claimed_at"),
                    r.get("vip_awarded_through_claim"), r.get("fire_txn_id"),
                    r.get("eligibility_date"), r.get("expires_at"),
                    r.get("exclusion_reason")])
    return buf.getvalue()
