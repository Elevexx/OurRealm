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
    "vault_balance": 0, "pending_balance": 0,
    "lifetime_fire_earned": 0, "lifetime_fire_received": 0,
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
                      idempotency_key: Optional[str] = None) -> Optional[dict]:
    """Record an earn: pending immediately, vault after settlement delay.
    Idempotent per reaction mutation via the derived idempotency key."""
    await ensure_vault_indexes()
    amount = int(amount)
    if amount <= 0 or not receiver_id or receiver_id == sender_id:
        return None
    cfg = await get_wallet_config()
    now = _now()
    txn = {
        "id": uuid.uuid4().hex,
        "user_id": receiver_id, "sender_id": sender_id,
        "post_id": post_id, "reaction_id": reaction_id,
        "amount": amount, "type": "earn", "status": "pending",
        "created_at": now.isoformat(),
        "settle_after": (now + timedelta(hours=cfg["settlement_hours"])).isoformat(),
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
        {"$inc": {"pending_balance": amount,
                  "lifetime_fire_earned": amount,
                  "lifetime_fire_received": amount},
         "$max": {"largest_single_fire": amount},
         "$set": {"last_fire_received_at": now.isoformat()},
         "$setOnInsert": {"vault_balance": 0, "largest_daily_fire": 0,
                          "largest_weekly_fire": 0, "largest_monthly_fire": 0,
                          "created_at": now.isoformat()}},
        upsert=True)
    txn.pop("_id", None)
    return txn


# ── Settlement (lazy, atomic per transaction) ───────────────────────────
async def settle_due(user_id: Optional[str] = None) -> int:
    now_iso = _now_iso()
    q: dict = {"status": "pending", "settle_after": {"$lte": now_iso}}
    if user_id:
        q["user_id"] = user_id
    settled = 0
    async for txn in db.fire_wallet_transactions.find(
            q, {"_id": 0, "id": 1, "user_id": 1, "amount": 1}):
        r = await db.fire_wallet_transactions.update_one(
            {"id": txn["id"], "status": "pending"},
            {"$set": {"status": "settled", "settled_at": now_iso}})
        if r.modified_count:
            await db.fire_wallets.update_one(
                {"user_id": txn["user_id"]},
                {"$inc": {"pending_balance": -int(txn["amount"]),
                          "vault_balance": int(txn["amount"])}},
                upsert=True)
            settled += 1
    clamp_q = {"pending_balance": {"$lt": 0}}
    if user_id:
        clamp_q["user_id"] = user_id
    await db.fire_wallets.update_many(clamp_q, {"$set": {"pending_balance": 0}})
    return settled


# ── Reads ───────────────────────────────────────────────────────────────
async def _window_earned(uid: str, hours: int) -> int:
    since = (_now() - timedelta(hours=hours)).isoformat()
    agg = await db.fire_wallet_transactions.aggregate([
        {"$match": {"user_id": uid, "type": "earn",
                    "status": {"$in": ["pending", "settled"]},
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
    pending = int(by_status.get("pending", {}).get("total") or 0)
    vault = int(by_status.get("settled", {}).get("total") or 0)
    lifetime = pending + vault
    largest = max(int(r.get("largest") or 0) for r in by_status.values()) if by_status else 0
    last = max((r.get("last") for r in by_status.values() if r.get("last")), default=None)
    before = await db.fire_wallets.find_one({"user_id": user_id}, {"_id": 0}) or {}
    await db.fire_wallets.update_one(
        {"user_id": user_id},
        {"$set": {"pending_balance": pending, "vault_balance": vault,
                  "lifetime_fire_earned": lifetime, "lifetime_fire_received": lifetime,
                  "largest_single_fire": largest, "last_fire_received_at": last,
                  "repaired_at": _now_iso()},
         "$setOnInsert": {"largest_daily_fire": 0, "largest_weekly_fire": 0,
                          "largest_monthly_fire": 0, "created_at": _now_iso()}},
        upsert=True)
    after = await db.fire_wallets.find_one({"user_id": user_id}, {"_id": 0})
    return {"user_id": user_id,
            "before": {k: before.get(k) for k in ("vault_balance", "pending_balance", "lifetime_fire_earned")},
            "after": {k: after.get(k) for k in ("vault_balance", "pending_balance", "lifetime_fire_earned")}}


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
    }
    stats = {}
    for field, value in values.items():
        level = privacy[field]
        allowed = is_owner or is_founder or level == "everyone" or (level == "friends" and is_friend)
        stats[field] = {"visible": True, "value": int(value)} if allowed else {"visible": False}
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
