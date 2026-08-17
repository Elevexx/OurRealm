"""Fire Vault — permanent earned-fire economy layer (Phase 0.5, June 2026).

Additive extension of the Fire Power system. The Daily Fire Pool
(services/fire_power.py) remains the SENDING system and is untouched.
The Vault is the EARNING system:
  • Creators earn the full fire value of reactions on their posts.
  • Earnings land as PENDING, then settle into the VAULT after a
    founder-configurable delay (default 24h) — moderation buffer.
  • Vault fire never expires, never resets, is NOT spendable yet.
  • Senders never earn. High-water-mark protection (max_fire_value on
    post_fire_reactions) prevents remove/re-send farming.
Accrual is ALWAYS on when fire reactions occur; the `fire_wallet_enabled`
flag gates only the user-facing UI.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core.db import db

log = logging.getLogger("ourrealm.fire.vault")

DEFAULT_SETTLEMENT_HOURS = 24

_INDEXES_READY = False

WALLET_DEFAULTS = {
    "vault_balance": 0, "pending_balance": 0, "collectable_balance": 0,
    "lifetime_fire_earned": 0, "lifetime_fire_received": 0,
    "lifetime_fire_collected": 0,
    "largest_single_fire": 0, "largest_daily_fire": 0,
    "largest_weekly_fire": 0, "largest_monthly_fire": 0,
    "last_fire_received_at": None,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


async def ensure_vault_indexes() -> None:
    global _INDEXES_READY
    if _INDEXES_READY:
        return
    try:
        await db.fire_wallets.create_index([("user_id", 1)], unique=True, name="uniq_user")
        await db.fire_wallet_transactions.create_index(
            [("user_id", 1), ("status", 1), ("settle_after", 1)], name="by_user_status_settle")
        await db.fire_wallet_transactions.create_index([("sender_id", 1)], name="by_sender")
        await db.fire_wallet_transactions.create_index(
            [("idempotency_key", 1)], unique=True, sparse=True, name="uniq_idem")
    except Exception as e:  # noqa: BLE001
        log.warning(f"[fire-vault] index init issue: {e}")
    _INDEXES_READY = True


# ── Config (founder-controlled settlement delay) ────────────────────────
async def get_wallet_config() -> dict:
    doc = await db.fire_wallet_config.find_one({"_id": "config"}) or {}
    try:
        hours = int(doc.get("settlement_hours", DEFAULT_SETTLEMENT_HOURS))
    except (TypeError, ValueError):
        hours = DEFAULT_SETTLEMENT_HOURS
    return {"settlement_hours": max(0, min(hours, 720))}


async def set_wallet_config(settlement_hours: int, updated_by: str) -> dict:
    try:
        hours = int(settlement_hours)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="settlement_hours must be a whole number")
    if hours < 0 or hours > 720:
        raise HTTPException(status_code=400, detail="settlement_hours must be 0–720")
    await db.fire_wallet_config.update_one(
        {"_id": "config"},
        {"$set": {"settlement_hours": hours, "updated_by": updated_by, "updated_at": _now_iso()}},
        upsert=True)
    return await get_wallet_config()


# ── Credit (called from fire_power.react — additive hook) ───────────────
async def credit_fire(receiver_id: str, sender_id: str, post_id: str,
                      reaction_id: str, amount: int,
                      idempotency_key: Optional[str] = None,
                      finalize_at: Optional[str] = None) -> Optional[dict]:
    """Record an earn: Pending immediately → Collectable at the reaction's
    edit deadline → Vault when the creator collects. Idempotent."""
    await ensure_vault_indexes()
    amount = int(amount)
    if amount <= 0 or not receiver_id or receiver_id == sender_id:
        return None
    now = _now()
    if not finalize_at:
        cfg = await get_wallet_config()
        finalize_at = (now + timedelta(hours=cfg["settlement_hours"])).isoformat()
    txn = {
        "id": uuid.uuid4().hex,
        "user_id": receiver_id, "sender_id": sender_id,
        "post_id": post_id, "reaction_id": reaction_id,
        "amount": amount, "type": "earn", "transaction_type": "earn",
        "status": "pending", "policy_version": "0.6",
        "created_at": now.isoformat(),
        "settle_after": finalize_at, "edit_deadline": finalize_at,
        "settled_at": None,
        "idempotency_key": f"{idempotency_key}:earn" if idempotency_key else None,
        "audit": {"source": "fire_reaction"},
    }
    if txn["idempotency_key"] is None:
        txn.pop("idempotency_key")
    try:
        await db.fire_wallet_transactions.insert_one(txn)
    except DuplicateKeyError:
        return None  # retry of an already-credited mutation
    await db.fire_wallets.update_one(
        {"user_id": receiver_id},
        {"$inc": {"pending_balance": amount},
         "$set": {"last_fire_received_at": now.isoformat()},
         "$setOnInsert": {"vault_balance": 0, "collectable_balance": 0,
                          "lifetime_fire_earned": 0, "lifetime_fire_received": 0,
                          "lifetime_fire_collected": 0,
                          "largest_single_fire": 0, "largest_daily_fire": 0,
                          "largest_weekly_fire": 0, "largest_monthly_fire": 0,
                          "created_at": now.isoformat()}},
        upsert=True)
    txn.pop("_id", None)
    return txn


async def adjust_fire(receiver_id: str, sender_id: str, post_id: str,
                      reaction_id: str, amount: int,
                      idempotency_key: Optional[str] = None,
                      finalize_at: Optional[str] = None) -> Optional[dict]:
    """Negative pending adjustment when the sender lowers/removes Fire
    inside the edit window. Never drives pending below the reaction's
    own net (react() only sends true deltas)."""
    await ensure_vault_indexes()
    amount = int(amount)
    if amount >= 0 or not receiver_id or receiver_id == sender_id:
        return None
    now = _now()
    txn = {
        "id": uuid.uuid4().hex,
        "user_id": receiver_id, "sender_id": sender_id,
        "post_id": post_id, "reaction_id": reaction_id,
        "amount": amount, "type": "earn", "transaction_type": "adjust",
        "status": "pending", "policy_version": "0.6",
        "created_at": now.isoformat(),
        "settle_after": finalize_at or now.isoformat(),
        "edit_deadline": finalize_at,
        "idempotency_key": f"{idempotency_key}:adjust" if idempotency_key else None,
        "audit": {"source": "fire_reaction_edit"},
    }
    if txn["idempotency_key"] is None:
        txn.pop("idempotency_key")
    try:
        await db.fire_wallet_transactions.insert_one(txn)
    except DuplicateKeyError:
        return None
    await db.fire_wallets.update_one(
        {"user_id": receiver_id}, {"$inc": {"pending_balance": amount}}, upsert=True)
    await db.fire_wallets.update_one(
        {"user_id": receiver_id, "pending_balance": {"$lt": 0}},
        {"$set": {"pending_balance": 0}})
    txn.pop("_id", None)
    return txn


# ── Finalization (Pending → Collectable, lazy + background) ────────────
async def settle_due(user_id: Optional[str] = None) -> int:
    """Finalize pending transactions whose edit window has passed:
    Pending → Collectable. Atomic per transaction, idempotent, batch-safe,
    resumable. Lifetime Received counts at finalization (net per txn).
    Emits ONE grouped 'ready to collect' notification per user per run."""
    now_iso = _now_iso()
    q: dict = {"status": "pending", "settle_after": {"$lte": now_iso}}
    if user_id:
        q["user_id"] = user_id
    finalized = 0
    per_user: dict[str, int] = {}
    async for txn in db.fire_wallet_transactions.find(
            q, {"_id": 0, "id": 1, "user_id": 1, "amount": 1}).limit(2000):
        r = await db.fire_wallet_transactions.update_one(
            {"id": txn["id"], "status": "pending"},
            {"$set": {"status": "collectable", "finalized_at": now_iso,
                      "collectable_at": now_iso, "settled_at": now_iso}})
        if r.modified_count:
            amt = int(txn["amount"])
            await db.fire_wallets.update_one(
                {"user_id": txn["user_id"]},
                {"$inc": {"pending_balance": -amt, "collectable_balance": amt,
                          "lifetime_fire_earned": amt,
                          "lifetime_fire_received": amt},
                 "$max": {"largest_single_fire": max(amt, 0)}},
                upsert=True)
            per_user[txn["user_id"]] = per_user.get(txn["user_id"], 0) + amt
            finalized += 1
    clamp_q: dict = {}
    if user_id:
        clamp_q["user_id"] = user_id
    for f in ("pending_balance", "collectable_balance", "lifetime_fire_received", "lifetime_fire_earned"):
        await db.fire_wallets.update_many({**clamp_q, f: {"$lt": 0}}, {"$set": {f: 0}})
    # Grouped collectable notifications (flag-gated). ONE live row per
    # user — updated in place when the amount changes, never spammed.
    try:
        from services.fire_power import get_fire_flags
        flags = await get_fire_flags()
        if flags.get("fire_notifications"):
            for uid, net in per_user.items():
                if net > 0:
                    await upsert_fire_ready_notification(uid)
    except Exception:  # noqa: BLE001
        pass
    return finalized


async def upsert_fire_ready_notification(uid: str) -> None:
    """Single grouped '🔥 ready to collect' notification per user.
    Updates the existing unresolved row (amount + unread flag) instead of
    inserting duplicates. Resolved rows are never reused — a fresh cycle
    of collectable Fire creates a fresh notification."""
    w = await db.fire_wallets.find_one({"user_id": uid}, {"_id": 0, "collectable_balance": 1})
    total = int((w or {}).get("collectable_balance") or 0)
    if total <= 0:
        return
    now = _now_iso()
    payload = {"collectable_total": total,
               "message": f"🔥 You have {total} Fire ready to collect.",
               "cta": "View Fire Power"}
    r = await db.notifications.update_one(
        {"recipient_id": uid, "kind": "fire_collectable", "resolved": {"$ne": True}},
        {"$set": {"payload": payload, "seen": False, "updated_at": now}})
    if not r.matched_count:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "recipient_id": uid, "kind": "fire_collectable",
            "actor_username": None, "payload": payload,
            "created_at": now, "updated_at": now, "seen": False, "resolved": False})


async def resolve_fire_ready_notifications(uid: str) -> None:
    """Once the Collectable balance hits zero, the grouped notification
    resolves (marked seen + resolved). Future collectable Fire creates a
    brand-new notification via upsert_fire_ready_notification()."""
    await db.notifications.update_many(
        {"recipient_id": uid, "kind": "fire_collectable", "resolved": {"$ne": True}},
        {"$set": {"resolved": True, "seen": True, "resolved_at": _now_iso(),
                  "payload.message": "🔥 Fire collected into your Vault.",
                  "payload.collectable_total": 0}})


finalize_due = settle_due  # canonical Phase 0.6 name


# ── FIRE UP — Vault → Daily Pool transfer (rolling 24h cooldown) ────────
FIRE_UP_COOLDOWN_HOURS = 24


async def _fire_up_state(user: dict) -> dict:
    """Server-authoritative Fire Up eligibility snapshot. Uses the user's
    CURRENT progression level + live pool + live vault balance."""
    from services import fire_power as fp
    uid = user["id"]
    udoc = await db.users.find_one({"id": uid}, {"_id": 0, "fire_paused": 1}) or {}
    cfg = await fp.fire_config_for_user(user)
    pool = await fp.pool_status(user, cfg)
    w = await db.fire_wallets.find_one(
        {"user_id": uid}, {"_id": 0, "vault_balance": 1, "last_fire_up_at": 1}) or {}
    vault = max(0, int(w.get("vault_balance") or 0))
    missing = max(0, int(pool["pool_max"]) - int(pool["available"]))
    amount = min(missing, vault)
    last = w.get("last_fire_up_at")
    next_at, cooldown_s = None, 0
    if last:
        try:
            nxt = datetime.fromisoformat(last) + timedelta(hours=FIRE_UP_COOLDOWN_HOURS)
            cooldown_s = max(0, int((nxt - _now()).total_seconds()))
            next_at = nxt.isoformat()
        except Exception:  # noqa: BLE001
            pass
    eligible, reason = True, None
    if udoc.get("fire_paused"):
        eligible, reason = False, "wallet_paused"
    elif cooldown_s > 0:
        eligible, reason = False, "cooldown"
    elif vault <= 0:
        eligible, reason = False, "vault_empty"
    elif missing <= 0:
        eligible, reason = False, "pool_full"
    elif amount <= 0:
        eligible, reason = False, "nothing_to_transfer"
    return {
        "eligible": eligible, "reason": reason,
        "current_vault_balance": vault,
        "current_daily_available": int(pool["available"]),
        "daily_pool_max": int(pool["pool_max"]),
        "calculated_transfer_amount": amount if eligible else 0,
        "resulting_daily_available": min(int(pool["pool_max"]), int(pool["available"]) + amount) if eligible else int(pool["available"]),
        "resulting_vault_balance": vault - amount if eligible else vault,
        "is_partial_refill": bool(eligible and amount < missing),
        "last_fire_up_at": last,
        "next_fire_up_at": next_at,
        "cooldown_seconds_remaining": cooldown_s,
    }


def _fire_up_replay(txn: dict) -> dict:
    return {"success": True, "idempotent_replay": True,
            "transferred_amount": int(txn["amount"]),
            "vault_balance_before": txn.get("vault_balance_before"),
            "vault_balance_after": txn.get("vault_balance_after"),
            "daily_available_before": txn.get("daily_available_before"),
            "daily_available_after": txn.get("daily_available_after"),
            "daily_pool_max": txn.get("daily_pool_max"),
            "last_fire_up_at": txn.get("created_at"),
            "next_fire_up_at": txn.get("next_fire_up_at"),
            "transaction_id": txn.get("id")}


async def fire_up(user: dict, idempotency_key: Optional[str] = None,
                  session_id: Optional[str] = None) -> dict:
    """FIRE UP 🔥 — atomic, idempotent Vault → Daily Pool transfer.
    Concurrency gate: the conditional flip of `last_fire_up_at` past the
    24h cutoff acts as a per-user lock — exactly ONE request can win it
    per cooldown window (double-taps / multi-tab / multi-device all lose
    the conditional update and get the cooldown response)."""
    from services import fire_power as fp
    uid = user["id"]
    await ensure_vault_indexes()
    # Idempotent replay — same key returns the already-completed transfer.
    if idempotency_key:
        prev = await db.fire_wallet_transactions.find_one(
            {"user_id": uid, "type": "fire_up", "idempotency_key": idempotency_key},
            {"_id": 0})
        if prev:
            return _fire_up_replay(prev)
    udoc = await db.users.find_one({"id": uid}, {"_id": 0, "fire_paused": 1}) or {}
    if udoc.get("fire_paused"):
        raise HTTPException(status_code=403, detail="Fire Up is temporarily unavailable for this account.")
    w = await db.fire_wallets.find_one(
        {"user_id": uid}, {"_id": 0, "vault_balance": 1, "last_fire_up_at": 1}) or {}
    prev_last = w.get("last_fire_up_at")
    if max(0, int(w.get("vault_balance") or 0)) <= 0:
        raise HTTPException(status_code=400, detail="You need Fire in your Vault before you can Fire Up.")
    now = _now()
    now_iso = now.isoformat()
    cutoff = (now - timedelta(hours=FIRE_UP_COOLDOWN_HOURS)).isoformat()
    # ── Cooldown gate + concurrency lock (single conditional update) ──
    gate = await db.fire_wallets.update_one(
        {"user_id": uid,
         "$or": [{"last_fire_up_at": {"$exists": False}},
                 {"last_fire_up_at": None},
                 {"last_fire_up_at": {"$lte": cutoff}}]},
        {"$set": {"last_fire_up_at": now_iso}})
    if not gate.modified_count:
        st = await _fire_up_state(user)
        raise HTTPException(status_code=409, detail={
            "message": "You can Fire Up again later.", "reason": "cooldown",
            "next_fire_up_at": st.get("next_fire_up_at"),
            "cooldown_seconds_remaining": st.get("cooldown_seconds_remaining")})

    async def _rollback():
        await db.fire_wallets.update_one(
            {"user_id": uid, "last_fire_up_at": now_iso},
            {"$set": {"last_fire_up_at": prev_last}})

    # ── Recompute EVERYTHING inside the lock with the CURRENT level ──
    cfg = await fp.fire_config_for_user(user)
    pool = await fp.pool_status(user, cfg)
    pool_max = int(pool["pool_max"])
    available_before = int(pool["available"])
    missing = max(0, pool_max - available_before)
    if missing <= 0:
        await _rollback()
        raise HTTPException(status_code=400, detail="Your Daily Fire Pool is already full.")
    wallet = await db.fire_wallets.find_one({"user_id": uid}, {"_id": 0, "vault_balance": 1}) or {}
    vault_before = max(0, int(wallet.get("vault_balance") or 0))
    amount = min(missing, vault_before)
    if amount <= 0:
        await _rollback()
        raise HTTPException(status_code=400, detail="You need Fire in your Vault before you can Fire Up.")
    # ── Conditional vault deduction (never below zero) ──
    ded = await db.fire_wallets.update_one(
        {"user_id": uid, "vault_balance": {"$gte": amount}},
        {"$inc": {"vault_balance": -amount}})
    if not ded.modified_count:
        await _rollback()
        raise HTTPException(status_code=409, detail="Fire Up could not be completed. Your balances were not changed.")
    # ── Daily Pool credit (reduce active spend; clamp guards overflow) ──
    await db.fire_pool_counters.update_one(
        {"_id": uid}, {"$inc": {"spent_active": -amount}}, upsert=True)
    await db.fire_pool_counters.update_one(
        {"_id": uid, "spent_active": {"$lt": 0}}, {"$set": {"spent_active": 0}})
    vault_after = vault_before - amount
    available_after = min(pool_max, available_before + amount)
    next_at = (now + timedelta(hours=FIRE_UP_COOLDOWN_HOURS)).isoformat()
    txn = {
        "id": uuid.uuid4().hex, "user_id": uid, "type": "fire_up",
        "status": "fire_up", "amount": amount,
        "vault_balance_before": vault_before, "vault_balance_after": vault_after,
        "daily_available_before": available_before, "daily_available_after": available_after,
        "daily_pool_max": pool_max,
        "level_number": cfg.get("level_number"), "level_name": cfg.get("level_name"),
        "created_at": now_iso, "next_fire_up_at": next_at,
        "idempotency_key": idempotency_key, "session_id": session_id,
        "success": True,
    }
    await db.fire_wallet_transactions.insert_one({**txn})
    # One confirmation notification per transfer (never duplicated —
    # keyed to this txn id).
    try:
        existing = await db.notifications.find_one(
            {"recipient_id": uid, "kind": "fire_up_complete", "payload.transaction_id": txn["id"]})
        if not existing:
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()), "recipient_id": uid, "kind": "fire_up_complete",
                "actor_username": None,
                "payload": {"transaction_id": txn["id"], "amount": amount,
                            "message": f"🔥 Fire Up complete! {amount} Fire was moved from your Vault to your Daily Pool."},
                "created_at": now_iso, "seen": False, "resolved": True})
    except Exception:  # noqa: BLE001
        pass
    return {"success": True, "idempotent_replay": False,
            "transferred_amount": amount,
            "vault_balance_before": vault_before, "vault_balance_after": vault_after,
            "daily_available_before": available_before, "daily_available_after": available_after,
            "daily_pool_max": pool_max,
            "last_fire_up_at": now_iso, "next_fire_up_at": next_at,
            "transaction_id": txn["id"]}


# ── Collection (Collectable → Permanent Vault, manual) ─────────────────
async def collect_fire(user: dict, txn_ids: Optional[list] = None) -> dict:
    """COLLECT FIRE — moves finalized Collectable Fire into the permanent
    Vault. Atomic per transaction, idempotent (status-guarded flips),
    duplicate-collection impossible, batch-safe and resumable."""
    uid = user["id"]
    await ensure_vault_indexes()
    await settle_due(uid)
    q: dict = {"user_id": uid, "status": "collectable"}
    if txn_ids:
        q["id"] = {"$in": [str(t) for t in txn_ids][:500]}
    now_iso = _now_iso()
    collected = 0
    count = 0
    async for txn in db.fire_wallet_transactions.find(q, {"_id": 0, "id": 1, "amount": 1}).limit(2000):
        r = await db.fire_wallet_transactions.update_one(
            {"id": txn["id"], "status": "collectable"},
            {"$set": {"status": "collected", "collected_at": now_iso}})
        if r.modified_count:
            amt = int(txn["amount"])
            await db.fire_wallets.update_one(
                {"user_id": uid},
                {"$inc": {"collectable_balance": -amt, "vault_balance": amt,
                          "lifetime_fire_collected": amt}},
                upsert=True)
            collected += amt
            count += 1
    for f in ("collectable_balance", "vault_balance", "lifetime_fire_collected"):
        await db.fire_wallets.update_many({"user_id": uid, f: {"$lt": 0}}, {"$set": {f: 0}})
    # Resolve the grouped 'ready to collect' notification when empty.
    try:
        w = await db.fire_wallets.find_one({"user_id": uid}, {"_id": 0, "collectable_balance": 1})
        if int((w or {}).get("collectable_balance") or 0) <= 0:
            await resolve_fire_ready_notifications(uid)
    except Exception:  # noqa: BLE001
        pass
    return {"collected": max(collected, 0), "transactions": count}


# ── Reads ───────────────────────────────────────────────────────────────
async def _window_earned(uid: str, hours: int) -> int:
    since = (_now() - timedelta(hours=hours)).isoformat()
    agg = await db.fire_wallet_transactions.aggregate([
        {"$match": {"user_id": uid, "type": "earn",
                    "status": {"$in": ["pending", "collectable", "collected", "settled"]},
                    "created_at": {"$gte": since}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ]).to_list(1)
    return int(agg[0]["total"]) if agg else 0


async def wallet_for(user: dict) -> dict:
    uid = user["id"]
    await ensure_vault_indexes()
    await settle_due(uid)
    day = await _window_earned(uid, 24)
    week = await _window_earned(uid, 168)
    month = await _window_earned(uid, 720)
    if day or week or month:
        await db.fire_wallets.update_one(
            {"user_id": uid},
            {"$max": {"largest_daily_fire": day, "largest_weekly_fire": week,
                      "largest_monthly_fire": month}},
            upsert=True)
    w = await db.fire_wallets.find_one({"user_id": uid}, {"_id": 0}) or {}
    out = {**WALLET_DEFAULTS, **{k: w.get(k, v) for k, v in WALLET_DEFAULTS.items()}}
    for k in list(out):
        if k != "last_fire_received_at":
            out[k] = max(0, int(out[k] or 0))
    out["earned_last_24h"] = day
    out["earned_last_7d"] = week
    out["earned_last_30d"] = month
    # Pending / collectable breakdown for the wallet UI
    nxt = await db.fire_wallet_transactions.find(
        {"user_id": uid, "status": "pending"},
        {"_id": 0, "settle_after": 1, "amount": 1},
    ).sort("settle_after", 1).to_list(1)
    out["pending_count"] = await db.fire_wallet_transactions.count_documents(
        {"user_id": uid, "status": "pending"})
    out["next_finalization_at"] = nxt[0]["settle_after"] if nxt else None
    out["next_finalization_amount"] = int(nxt[0]["amount"]) if nxt else 0
    out["collectable_count"] = await db.fire_wallet_transactions.count_documents(
        {"user_id": uid, "status": "collectable"})
    return out


# ── Repair / recalculation (rebuild wallets from the ledger) ────────────
async def recalculate_wallet(user_id: str) -> dict:
    agg = await db.fire_wallet_transactions.aggregate([
        {"$match": {"user_id": user_id, "type": "earn"}},
        {"$group": {
            "_id": "$status",
            "total": {"$sum": "$amount"},
            "largest": {"$max": "$amount"},
            "last": {"$max": "$created_at"},
        }},
    ]).to_list(10)
    by_status = {row["_id"]: row for row in agg}
    pending = max(0, int(by_status.get("pending", {}).get("total") or 0))
    collectable = max(0, int(by_status.get("collectable", {}).get("total") or 0))
    # Legacy Phase 0.5 "settled" rows live in the Vault (auto-settled).
    # Fire Up transfers (type=fire_up) SPEND Vault Fire into the Daily
    # Pool, so they are subtracted from the rebuilt vault balance.
    fire_up_agg = await db.fire_wallet_transactions.aggregate([
        {"$match": {"user_id": user_id, "type": "fire_up"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ]).to_list(1)
    fire_up_total = int(fire_up_agg[0]["total"]) if fire_up_agg else 0
    vault = max(0, int(by_status.get("collected", {}).get("total") or 0)
                + int(by_status.get("settled", {}).get("total") or 0)
                - fire_up_total)
    lifetime_received = collectable + vault
    lifetime_collected = vault
    largest = max((int(r.get("largest") or 0) for r in by_status.values()), default=0)
    last = max((r.get("last") for r in by_status.values() if r.get("last")), default=None)
    before = await db.fire_wallets.find_one({"user_id": user_id}, {"_id": 0}) or {}
    await db.fire_wallets.update_one(
        {"user_id": user_id},
        {"$set": {"pending_balance": pending, "collectable_balance": collectable,
                  "vault_balance": vault,
                  "lifetime_fire_earned": lifetime_received,
                  "lifetime_fire_received": lifetime_received,
                  "lifetime_fire_collected": lifetime_collected,
                  "largest_single_fire": largest, "last_fire_received_at": last,
                  "repaired_at": _now_iso()},
         "$setOnInsert": {"largest_daily_fire": 0, "largest_weekly_fire": 0,
                          "largest_monthly_fire": 0, "created_at": _now_iso()}},
        upsert=True)
    after = await db.fire_wallets.find_one({"user_id": user_id}, {"_id": 0})
    keys = ("vault_balance", "pending_balance", "collectable_balance", "lifetime_fire_earned")
    return {"user_id": user_id,
            "before": {k: before.get(k) for k in keys},
            "after": {k: after.get(k) for k in keys}}


async def recalculate_all() -> dict:
    await settle_due()
    uids = set(await db.fire_wallet_transactions.distinct("user_id"))
    uids |= set(await db.fire_wallets.distinct("user_id"))
    results = []
    for uid in uids:
        results.append(await recalculate_wallet(uid))
    changed = [r for r in results if r["before"] != r["after"]]
    return {"wallets_checked": len(results), "wallets_changed": len(changed),
            "changes": changed[:20]}


# ── Founder analytics ───────────────────────────────────────────────────
async def _usernames_for(uids: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    if not uids:
        return out
    async for u in db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "username": 1}):
        out[u["id"]] = u.get("username")
    return out


async def admin_wallets_overview() -> dict:
    await ensure_vault_indexes()
    await settle_due()
    totals = await db.fire_wallets.aggregate([
        {"$group": {"_id": None, "vault": {"$sum": "$vault_balance"},
                    "pending": {"$sum": "$pending_balance"},
                    "collectable": {"$sum": "$collectable_balance"},
                    "wallets": {"$sum": 1}}},
    ]).to_list(1)
    t = totals[0] if totals else {}
    top_vault = [w async for w in db.fire_wallets.find({}, {"_id": 0})
                 .sort("vault_balance", -1).limit(5)]
    top_pending = [w async for w in db.fire_wallets.find({}, {"_id": 0})
                   .sort("pending_balance", -1).limit(5)]
    top_earners = [w async for w in db.fire_wallets.find({}, {"_id": 0})
                   .sort("lifetime_fire_earned", -1).limit(5)]
    senders_agg = await db.fire_wallet_transactions.aggregate([
        {"$match": {"type": "earn"}},
        {"$group": {"_id": "$sender_id", "total": {"$sum": "$amount"}, "events": {"$sum": 1}}},
        {"$sort": {"total": -1}}, {"$limit": 5},
    ]).to_list(5)
    uids = list({w["user_id"] for w in top_vault + top_pending + top_earners}
                | {s["_id"] for s in senders_agg if s["_id"]})
    names = await _usernames_for(uids)

    def _rows(ws, key):
        return [{"username": names.get(w["user_id"]), "user_id": w["user_id"],
                 "value": int(w.get(key) or 0)} for w in ws]

    return {
        "total_vault_fire": int(t.get("vault") or 0),
        "total_pending_fire": int(t.get("pending") or 0),
        "total_collectable_fire": int(t.get("collectable") or 0),
        "wallet_count": int(t.get("wallets") or 0),
        "pending_transactions": await db.fire_wallet_transactions.count_documents({"status": "pending"}),
        "largest_wallet": (_rows(top_vault, "vault_balance") or [None])[0],
        "largest_pending_wallet": (_rows(top_pending, "pending_balance") or [None])[0],
        "top_earners": _rows(top_earners, "lifetime_fire_earned"),
        "top_senders": [{"username": names.get(s["_id"]), "user_id": s["_id"],
                         "value": int(s["total"]), "events": int(s["events"])}
                        for s in senders_agg],
        "config": await get_wallet_config(),
        "generated_at": _now_iso(),
    }


# ── Fire Wallet Privacy (Phase 1) ───────────────────────────────────────
FIRE_PRIVACY_VALUES = {"only_me", "friends", "everyone"}
FIRE_PRIVACY_DEFAULTS = {
    "vault_balance": "only_me",
    "lifetime_fire": "everyone",
    "fire_given": "friends",
    "fire_received": "everyone",
}


def merge_fire_privacy(user_doc: dict) -> dict:
    raw = (user_doc or {}).get("fire_privacy") or {}
    return {k: (raw.get(k) if raw.get(k) in FIRE_PRIVACY_VALUES else v)
            for k, v in FIRE_PRIVACY_DEFAULTS.items()}


async def set_fire_privacy(user_id: str, updates: dict) -> dict:
    sets = {}
    for k, v in (updates or {}).items():
        if k not in FIRE_PRIVACY_DEFAULTS:
            raise HTTPException(status_code=400, detail=f"Unknown privacy field: {k}")
        if v not in FIRE_PRIVACY_VALUES:
            raise HTTPException(status_code=400, detail="Value must be only_me, friends or everyone")
        sets[f"fire_privacy.{k}"] = v
    if sets:
        await db.users.update_one({"id": user_id}, {"$set": sets})
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "fire_privacy": 1})
    return merge_fire_privacy(doc)


async def seed_fire_privacy_defaults() -> int:
    """Idempotent — only writes defaults where fire_privacy is missing."""
    r = await db.users.update_many(
        {"fire_privacy": {"$exists": False}},
        {"$set": {"fire_privacy": {**FIRE_PRIVACY_DEFAULTS}}})
    return r.modified_count


async def fire_given_total(uid: str) -> int:
    agg = await db.fire_wallet_transactions.aggregate([
        {"$match": {"sender_id": uid, "type": "earn"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ]).to_list(1)
    return int(agg[0]["total"]) if agg else 0


async def recent_earnings(uid: str, limit: int = 5) -> list:
    rows = [t async for t in db.fire_wallet_transactions.find(
        {"user_id": uid, "type": "earn"},
        {"_id": 0, "amount": 1, "status": 1, "created_at": 1, "sender_id": 1, "post_id": 1},
    ).sort("created_at", -1).limit(limit)]
    names = await _usernames_for(list({r["sender_id"] for r in rows if r.get("sender_id")}))
    for r in rows:
        r["sender_username"] = names.get(r.pop("sender_id", None))
    return rows


async def public_fire_stats(owner_doc: dict, viewer: Optional[dict]) -> dict:
    """Privacy-filtered fire stats. Backend authoritative: hidden fields
    NEVER include a value in the response — only {visible: false}."""
    owner_id = owner_doc["id"]
    privacy = merge_fire_privacy(owner_doc)
    viewer_id = (viewer or {}).get("id")
    is_owner = viewer_id == owner_id
    is_founder = (viewer or {}).get("role") == "founder"
    is_friend = bool(viewer_id) and viewer_id in (owner_doc.get("friends") or [])
    wallet = await wallet_for({"id": owner_id})
    values = {
        "vault_balance": wallet["vault_balance"],
        "lifetime_fire": wallet["lifetime_fire_earned"],
        "fire_given": await fire_given_total(owner_id),
        "fire_received": wallet["lifetime_fire_received"],
        "fire_collected": wallet["lifetime_fire_collected"],
        "weekly_fire": wallet["earned_last_7d"],
    }
    supporters = await db.post_fire_reactions.aggregate([
        {"$match": {"active": True}},
        {"$lookup": {"from": "posts", "localField": "post_id", "foreignField": "id", "as": "post"}},
        {"$match": {"post.author_id": owner_id}},
        {"$group": {"_id": "$user_id"}}, {"$count": "n"},
    ]).to_list(1)
    values["unique_supporters"] = int(supporters[0]["n"]) if supporters else 0
    top = await db.posts.find_one(
        {"author_id": owner_id, "fire_total": {"$gt": 0}},
        {"_id": 0, "id": 1, "fire_total": 1, "content": 1}, sort=[("fire_total", -1)])
    # Privacy mapping: collected → vault setting; supporters/weekly/top post → fire_received setting
    field_privacy = {"vault_balance": "vault_balance", "lifetime_fire": "lifetime_fire",
                     "fire_given": "fire_given", "fire_received": "fire_received",
                     "fire_collected": "vault_balance", "weekly_fire": "fire_received",
                     "unique_supporters": "fire_received"}
    stats = {}
    for field, value in values.items():
        level = privacy[field_privacy[field]]
        allowed = is_owner or is_founder or level == "everyone" or (level == "friends" and is_friend)
        stats[field] = {"visible": True, "value": int(value)} if allowed else {"visible": False}
    top_level = privacy["fire_received"]
    top_allowed = is_owner or is_founder or top_level == "everyone" or (top_level == "friends" and is_friend)
    stats["most_fired_post"] = (
        {"visible": True, "value": int(top["fire_total"]),
         "post_id": top["id"], "preview": (top.get("content") or "")[:60]}
        if (top_allowed and top) else {"visible": bool(top_allowed and top)})
    return {"is_owner": is_owner, "stats": stats}


async def admin_transactions(username: Optional[str] = None,
                             status: Optional[str] = None, limit: int = 50) -> list:
    q: dict = {}
    if username:
        u = await db.users.find_one({"username": username.lower()}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        q["user_id"] = u["id"]
    if status in ("pending", "settled", "reversed"):
        q["status"] = status
    rows = [t async for t in db.fire_wallet_transactions.find(q, {"_id": 0})
            .sort("created_at", -1).limit(min(max(limit, 1), 200))]
    names = await _usernames_for(list({r["user_id"] for r in rows}
                                      | {r.get("sender_id") for r in rows if r.get("sender_id")}))
    for r in rows:
        r["receiver_username"] = names.get(r["user_id"])
        r["sender_username"] = names.get(r.get("sender_id"))
    return rows

# ── Phase 0.6: history, reversal, dashboard, inspectors, background job ─
HISTORY_FILTERS = {"pending", "collectable", "collected", "reversed", "given", "received", "collections", "all"}


async def wallet_history(user: dict, flt: str = "all", limit: int = 50) -> list:
    uid = user["id"]
    flt = flt if flt in HISTORY_FILTERS else "all"
    if flt == "given":
        q: dict = {"sender_id": uid}
    elif flt == "received":
        q = {"user_id": uid}
    elif flt == "collections":
        q = {"user_id": uid, "status": "collected"}
    elif flt == "all":
        q = {"$or": [{"user_id": uid}, {"sender_id": uid}]}
    else:
        status = ["collected", "settled"] if flt == "collected" else [flt]
        q = {"user_id": uid, "status": {"$in": status}}
    rows = [t async for t in db.fire_wallet_transactions.find(
        q, {"_id": 0, "idempotency_key": 0}).sort("created_at", -1).limit(min(max(limit, 1), 200))]
    names = await _usernames_for(list({r["user_id"] for r in rows}
                                      | {r.get("sender_id") for r in rows if r.get("sender_id")}))
    for r in rows:
        r["receiver_username"] = names.get(r["user_id"])
        r["sender_username"] = names.get(r.get("sender_id"))
        r["direction"] = "given" if r.get("sender_id") == uid else "received"
        if r["direction"] == "given":
            r.pop("id", None)  # transaction ids are admin/debug only
    return rows


async def reverse_reaction(founder: dict, reaction_id: str, reason: str) -> dict:
    """Founder compensating reversal of a (possibly finalized) reaction.
    Zeroes the reaction, recomputes the post, releases any active pool
    reservation and reverses wallet credits per lifecycle stage —
    all via append-only compensating ledger transactions."""
    reaction = await db.post_fire_reactions.find_one({"id": reaction_id}, {"_id": 0})
    if not reaction:
        raise HTTPException(status_code=404, detail="Reaction not found")
    now_iso = _now_iso()
    old_value = int(reaction.get("fire_value") or 0) if reaction.get("active") else 0
    await db.post_fire_reactions.update_one(
        {"id": reaction_id},
        {"$set": {"fire_value": 0, "active": False, "reversed_at": now_iso,
                  "reversed_by": founder.get("username"), "reversed_reason": reason}})
    from services.fire_power import recompute_post_fire
    await recompute_post_fire(reaction["post_id"])
    # Release remaining pool reservation for the sender
    sender = reaction["user_id"]
    agg = await db.fire_power_transactions.aggregate([
        {"$match": {"reaction_id": reaction_id, "status": "active"}},
        {"$group": {"_id": None, "net": {"$sum": "$boosted_amount"}}}]).to_list(1)
    reserved = max(0, int(agg[0]["net"])) if agg else 0
    if reserved > 0:
        await db.fire_power_transactions.insert_one({
            "id": uuid.uuid4().hex, "user_id": sender, "post_id": reaction["post_id"],
            "reaction_id": reaction_id, "boosted_amount": -reserved,
            "transaction_type": "admin_reversal_release", "policy_version": "0.6",
            "effective_at": now_iso, "expires_at": reaction.get("edit_deadline") or now_iso,
            "status": "active"})
        await db.fire_pool_counters.update_one({"_id": sender}, {"$inc": {"spent_active": -reserved}})
        await db.fire_pool_counters.update_one(
            {"_id": sender, "spent_active": {"$lt": 0}}, {"$set": {"spent_active": 0}})
    # Reverse wallet credits stage-by-stage
    reversed_amounts = {"pending": 0, "collectable": 0, "collected": 0}
    async for txn in db.fire_wallet_transactions.find(
            {"reaction_id": reaction_id, "status": {"$in": ["pending", "collectable", "collected", "settled"]}},
            {"_id": 0, "id": 1, "status": 1, "amount": 1, "user_id": 1}):
        stage = "collected" if txn["status"] in ("collected", "settled") else txn["status"]
        r = await db.fire_wallet_transactions.update_one(
            {"id": txn["id"], "status": txn["status"]},
            {"$set": {"status": "reversed", "reversed_at": now_iso,
                      "reversed_reason": reason, "reversed_by": founder.get("username")}})
        if r.modified_count:
            amt = int(txn["amount"])
            reversed_amounts[stage] += amt
            field = {"pending": "pending_balance", "collectable": "collectable_balance",
                     "collected": "vault_balance"}[stage]
            inc = {field: -amt}
            if stage in ("collectable", "collected"):
                inc["lifetime_fire_received"] = -max(amt, 0)
                inc["lifetime_fire_earned"] = -max(amt, 0)
            if stage == "collected":
                inc["lifetime_fire_collected"] = -max(amt, 0)
            await db.fire_wallets.update_one({"user_id": txn["user_id"]}, {"$inc": inc}, upsert=True)
    for f in ("pending_balance", "collectable_balance", "vault_balance",
              "lifetime_fire_received", "lifetime_fire_earned", "lifetime_fire_collected"):
        await db.fire_wallets.update_many({f: {"$lt": 0}}, {"$set": {f: 0}})
    report = {"reaction_id": reaction_id, "post_id": reaction["post_id"],
              "sender_id": sender, "old_value": old_value,
              "pool_released": reserved, "wallet_reversed": reversed_amounts,
              "reason": reason, "reversed_by": founder.get("username"), "at": now_iso}
    await db.fire_migration_log.insert_one({"id": uuid.uuid4().hex, "action": "reverse_reaction", **report})
    return report


async def admin_dashboard() -> dict:
    await settle_due()
    ov = await admin_wallets_overview()
    now = _now()
    day = (now - timedelta(hours=24)).isoformat()
    week = (now - timedelta(days=7)).isoformat()
    month = (now - timedelta(days=30)).isoformat()

    async def _sum(match):
        agg = await db.fire_wallet_transactions.aggregate([
            {"$match": match}, {"$group": {"_id": None, "t": {"$sum": "$amount"}, "n": {"$sum": 1}}}]).to_list(1)
        return (int(agg[0]["t"]), int(agg[0]["n"])) if agg else (0, 0)

    sent_today, _ = await _sum({"type": "earn", "amount": {"$gt": 0}, "created_at": {"$gte": day}})
    coll_today = await db.fire_wallet_transactions.count_documents({"status": "collected", "collected_at": {"$gte": day}})
    coll_week = await db.fire_wallet_transactions.count_documents({"status": "collected", "collected_at": {"$gte": week}})
    coll_month = await db.fire_wallet_transactions.count_documents({"status": "collected", "collected_at": {"$gte": month}})
    lifetime = await db.fire_wallets.aggregate([
        {"$group": {"_id": None, "recv": {"$sum": "$lifetime_fire_received"},
                    "coll": {"$sum": "$lifetime_fire_collected"}}}]).to_list(1)
    lt = lifetime[0] if lifetime else {}
    top_post = await db.posts.find_one(
        {"fire_total": {"$gt": 0}}, {"_id": 0, "id": 1, "fire_total": 1, "author_username": 1, "content": 1},
        sort=[("fire_total", -1)])
    exhausted = 0
    async for c in db.fire_pool_counters.find({}, {"spent_active": 1}):
        if int(c.get("spent_active") or 0) > 0:
            exhausted += 1
    top_collectable = [w async for w in db.fire_wallets.find({}, {"_id": 0})
                       .sort("collectable_balance", -1).limit(1)]
    names = await _usernames_for([w["user_id"] for w in top_collectable])
    return {
        **ov,
        "finalization_queue": await db.fire_wallet_transactions.count_documents({"status": "pending"}),
        "collectable_transactions": await db.fire_wallet_transactions.count_documents({"status": "collectable"}),
        "reversed_transactions": await db.fire_wallet_transactions.count_documents({"status": "reversed"}),
        "lifetime_fire_received_total": int(lt.get("recv") or 0),
        "lifetime_fire_collected_total": int(lt.get("coll") or 0),
        "fire_sent_today": sent_today,
        "collections_today": coll_today,
        "collections_this_week": coll_week,
        "collections_this_month": coll_month,
        "largest_collectable": ({"username": names.get(top_collectable[0]["user_id"]),
                                 "value": int(top_collectable[0].get("collectable_balance") or 0)}
                                if top_collectable else None),
        "top_fire_post": top_post,
        "users_with_pool_usage": exhausted,
        "active_pool_reservations": await db.fire_power_transactions.count_documents({"status": "active"}),
    }


async def user_inspector(username: str) -> dict:
    u = await db.users.find_one({"username": username.lower()},
                                {"_id": 0, "id": 1, "username": 1, "fire_paused": 1})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    from services.fire_power import fire_config_for_user, pool_status
    cfg = await fire_config_for_user(u)
    pool = await pool_status(u, cfg)
    wallet = await wallet_for(u)
    given = await fire_given_total(u["id"])
    reactions = [r async for r in db.post_fire_reactions.find(
        {"user_id": u["id"]}, {"_id": 0}).sort("updated_at", -1).limit(15)]
    history = [t async for t in db.fire_wallet_transactions.find(
        {"$or": [{"user_id": u["id"]}, {"sender_id": u["id"]}]},
        {"_id": 0}).sort("created_at", -1).limit(20)]
    # Fire Up audit block — last transfer, cooldown, history
    fire_up_state = await _fire_up_state(u)
    fire_up_history = [t async for t in db.fire_wallet_transactions.find(
        {"user_id": u["id"], "type": "fire_up"},
        {"_id": 0}).sort("created_at", -1).limit(10)]
    return {"user": {"username": u["username"], "user_id": u["id"],
                     "fire_paused": bool(u.get("fire_paused"))},
            "config": cfg, "pool": pool, "wallet": wallet, "fire_given": given,
            "fire_up": {**fire_up_state,
                        "last_transfer": fire_up_history[0] if fire_up_history else None,
                        "history": fire_up_history},
            "active_reactions": reactions, "recent_transactions": history}


async def post_inspector(post_id: str) -> dict:
    p = await db.posts.find_one({"id": post_id},
                                {"_id": 0, "id": 1, "author_id": 1, "author_username": 1,
                                 "content": 1, "audience": 1, "fire_total": 1, "fire_count": 1,
                                 "likes": 1, "created_at": 1, "media_type": 1,
                                 "content_type": 1, "sound_track_id": 1, "sound_title": 1,
                                 "sound_url": 1, "sound_cover_url": 1,
                                 "sound_classification_id": 1, "is_canonical_sound": 1,
                                 "source_composer": 1, "moderation_status": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    reactions = [r async for r in db.post_fire_reactions.find(
        {"post_id": post_id}, {"_id": 0}).sort("fire_value", -1).limit(50)]
    names = await _usernames_for([r["user_id"] for r in reactions])
    for r in reactions:
        r["username"] = names.get(r["user_id"])
    credits = {}
    async for row in db.fire_wallet_transactions.aggregate([
            {"$match": {"post_id": post_id}},
            {"$group": {"_id": "$status", "total": {"$sum": "$amount"}, "n": {"$sum": 1}}}]):
        credits[row["_id"]] = {"total": int(row["total"]), "count": int(row["n"])}
    active = [r for r in reactions if r.get("active")]
    return {"post": p, "supporter_count": len(active),
            "largest_fire": max((int(r.get("fire_value") or 0) for r in active), default=0),
            "standard_fire": sum(1 for r in active if int(r.get("fire_value") or 0) == 1),
            "boosted_fire": sum(1 for r in active if int(r.get("fire_value") or 0) > 1),
            "reactions": reactions, "wallet_credits_by_status": credits}


async def finalization_loop(interval_seconds: int = 600):
    """Background finalization — Pending → Collectable even while users
    are offline. Idempotent, batch-safe, resumable."""
    import asyncio
    while True:
        try:
            n = await settle_due()
            if n:
                log.info(f"[fire-finalize] finalized {n} transaction(s)")
        except Exception as e:  # noqa: BLE001
            log.warning(f"[fire-finalize] pass failed: {e}")
        await asyncio.sleep(interval_seconds)
