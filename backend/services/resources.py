"""Engagement Resource Registry + canonical append-only ledger.

Generalizes engagement resources (Stars, Coins, Gems, ...) behind one
server-authoritative ledger with atomic balances and replay-safe
idempotency. Fire Power and Keys remain authoritative in their existing
systems and are surfaced through read-only adapters — their ledgers,
balances and lifecycle are NOT migrated or recomputed.

Engagement resources have no monetary value and cannot be exchanged for
money or goods.
"""
import logging
import uuid
from datetime import datetime, timezone

from core.db import db

log = logging.getLogger("ourrealm.resources")

ADAPTER_KEYS = ("fire", "keys")  # served by existing systems, read-only here

SEED = [
    {"key": "fire", "name": "Fire Power", "description": "OurRealm's core engagement resource — earn it through posts, games and achievements.",
     "icon": "🔥", "color": "#FF8A5A", "adapter": "fire_wallet", "enabled": True, "public": True},
    {"key": "keys", "name": "Keys", "description": "Special keys collected through games and events.",
     "icon": "🗝️", "color": "#F4C84A", "adapter": "fire_keys", "enabled": True, "public": True},
    {"key": "stars", "name": "Stars", "description": "Stars earned across OurRealm games.",
     "icon": "⭐", "color": "#FFD34D", "adapter": None, "enabled": True, "public": True},
    {"key": "coins", "name": "Coins", "description": "Coins earned across OurRealm games — one shared balance everywhere.",
     "icon": "🪙", "color": "#F4A73B", "adapter": None, "enabled": True, "public": True},
    {"key": "gems", "name": "Gems", "description": "Rare gems earned through special challenges.",
     "icon": "💎", "color": "#2EE6FF", "adapter": None, "enabled": True, "public": True},
]

SOURCE_TYPES = ("game_reward", "achievement", "admin_adjustment", "reversal", "migration",
                "event", "build_burn", "exchange")


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes_and_seed():
    await db.resource_registry.create_index("key", unique=True)
    await db.resource_ledger.create_index("id", unique=True)
    await db.resource_ledger.create_index("idem_key", unique=True, sparse=True)
    await db.resource_ledger.create_index([("user_id", 1), ("created_at", -1)])
    await db.resource_ledger.create_index([("resource_key", 1), ("created_at", -1)])
    await db.resource_balances.create_index([("user_id", 1), ("resource_key", 1)], unique=True)
    for s in SEED:
        await db.resource_registry.update_one(
            {"key": s["key"]},
            {"$setOnInsert": {**s, "archived": False, "frozen": False, "precision": "integer",
                              "global_cap": None, "per_user_cap": None, "daily_limit": None,
                              "cooldown_s": 0, "allowed_sources": list(SOURCE_TYPES),
                              "version": 1, "created_at": _iso(), "updated_at": _iso(),
                              "audit": []}},
            upsert=True)
    # Phase 1.5 economy fields — fire is the canonical unit (1:1, build-eligible)
    await db.resource_registry.update_one(
        {"key": "fire", "fire_equiv": {"$exists": False}},
        {"$set": {"fire_equiv": 1, "build_eligible": True,
                  "exchange_source": False, "exchange_dest": False}})
    await db.resource_registry.update_many(
        {"key": {"$ne": "fire"}, "fire_equiv": {"$exists": False}},
        {"$set": {"fire_equiv": 0, "build_eligible": False,
                  "exchange_source": False, "exchange_dest": False}})


async def registry(include_private: bool = False) -> list:
    q = {"archived": {"$ne": True}}
    if not include_private:
        q["public"] = True
        q["enabled"] = True
    return await db.resource_registry.find(q, {"_id": 0}).sort("key", 1).to_list(100)


async def grant(user_id: str, resource_key: str, amount: int, *, source_type: str,
                source_id: str = "", game_id: str = None, stage_id: str = None,
                idem_key: str = None, reason: str = "", actor: str = None,
                status: str = "finalized", allow_negative: bool = False,
                skip_balance: bool = False) -> dict:
    """Append a ledger entry and atomically update the balance. Replay-safe."""
    res = await db.resource_registry.find_one({"key": resource_key}, {"_id": 0})
    if not res:
        raise ValueError(f"Unknown resource '{resource_key}'")
    if res.get("adapter"):
        raise ValueError(f"Resource '{resource_key}' is managed by its own system ({res['adapter']}) — grant through it.")
    if res.get("frozen"):
        raise ValueError(f"Grants for '{resource_key}' are frozen")
    if not res.get("enabled"):
        raise ValueError(f"Resource '{resource_key}' is disabled")
    if source_type not in SOURCE_TYPES:
        raise ValueError(f"Unknown source type '{source_type}'")
    if source_type == "admin_adjustment" and not (reason or "").strip():
        raise ValueError("Admin adjustments require a reason")
    amount = int(amount)
    if amount == 0:
        raise ValueError("Amount must be non-zero")
    if idem_key:
        ex = await db.resource_ledger.find_one({"idem_key": idem_key}, {"_id": 0})
        if ex:
            return {"transaction": ex, "replayed": True}
    if res.get("per_user_cap") and amount > 0:
        bal = await db.resource_balances.find_one({"user_id": user_id, "resource_key": resource_key},
                                                  {"balance": 1})
        if bal and bal.get("balance", 0) + amount > int(res["per_user_cap"]):
            raise ValueError(f"Per-user cap reached for '{resource_key}'")
    tx = {"id": uuid.uuid4().hex, "user_id": user_id, "resource_key": resource_key,
          "amount": amount, "source_type": source_type, "source_id": source_id or "",
          "game_id": game_id, "stage_id": stage_id,
          "status": status, "reason": (reason or "")[:300], "actor": actor,
          "reversal_of": None, "created_at": _iso(), "finalized_at": _iso() if status == "finalized" else None}
    if idem_key:  # never store explicit null — sparse unique index indexes null values
        tx["idem_key"] = idem_key
    try:
        await db.resource_ledger.insert_one(dict(tx))
    except Exception:  # duplicate idem_key race — replay
        if idem_key:
            ex = await db.resource_ledger.find_one({"idem_key": idem_key}, {"_id": 0})
            if ex:
                return {"transaction": ex, "replayed": True}
        raise
    q = {"user_id": user_id, "resource_key": resource_key}
    if skip_balance:
        pass  # ledger-only entry: balance was already adjusted by a hold
    elif amount < 0 and not allow_negative:
        r = await db.resource_balances.update_one({**q, "balance": {"$gte": -amount}},
                                                  {"$inc": {"balance": amount},
                                                   "$set": {"updated_at": _iso()}})
        if not r.matched_count:
            # compensate the ledger entry — insufficient balance
            await db.resource_ledger.update_one({"id": tx["id"]}, {"$set": {
                "status": "rejected", "reason": "insufficient balance"}})
            raise ValueError("Insufficient balance")
    else:
        await db.resource_balances.update_one(q, {"$inc": {"balance": amount},
                                                  "$set": {"updated_at": _iso()},
                                                  "$setOnInsert": {"created_at": _iso()}},
                                              upsert=True)
    return {"transaction": tx, "replayed": False}


async def reverse(tx_id: str, actor: str, reason: str) -> dict:
    """Create a compensating entry — never deletes history."""
    if not (reason or "").strip():
        raise ValueError("Reversal requires a reason")
    tx = await db.resource_ledger.find_one({"id": tx_id}, {"_id": 0})
    if not tx:
        raise ValueError("Transaction not found")
    if tx.get("status") == "reversed":
        raise ValueError("Already reversed")
    out = await grant(tx["user_id"], tx["resource_key"], -tx["amount"],
                      source_type="reversal", source_id=tx_id, game_id=tx.get("game_id"),
                      idem_key=f"reversal:{tx_id}", reason=reason, actor=actor,
                      allow_negative=True)
    await db.resource_ledger.update_one({"id": tx_id}, {"$set": {"status": "reversed"}})
    await db.resource_ledger.update_one({"id": out["transaction"]["id"]},
                                        {"$set": {"reversal_of": tx_id}})
    return out


async def balances(user_id: str) -> list:
    """Canonical account balances for all enabled public resources (adapters included)."""
    regs = await registry()
    native = {b["resource_key"]: b["balance"] async for b in
              db.resource_balances.find({"user_id": user_id}, {"_id": 0, "resource_key": 1, "balance": 1})}
    out = []
    for r in regs:
        row = {"key": r["key"], "name": r["name"], "icon": r["icon"], "color": r["color"],
               "description": r["description"], "adapter": bool(r.get("adapter")),
               "icon_url": (r.get("active_visual") or {}).get("icon_url")}
        if r.get("adapter") == "fire_wallet":
            w = await db.fire_wallets.find_one({"user_id": user_id}, {"_id": 0}) or {}
            row.update({"balance": int(w.get("vault_balance") or 0),
                        "pending": int(w.get("pending_balance") or 0),
                        "collectable": int(w.get("collectable_balance") or 0),
                        "lifecycle": "pending_collectable_vault"})
        elif r.get("adapter") == "fire_keys":
            n = await db.fire_keys.count_documents({"user_id": user_id})
            row.update({"balance": n, "lifecycle": "simple"})
        else:
            row.update({"balance": int(native.get(r["key"]) or 0), "lifecycle": "simple"})
        out.append(row)
    return out


async def recent_activity(user_id: str, limit: int = 20) -> list:
    return await db.resource_ledger.find({"user_id": user_id, "status": {"$ne": "rejected"}},
                                         {"_id": 0}).sort("created_at", -1).to_list(limit)
