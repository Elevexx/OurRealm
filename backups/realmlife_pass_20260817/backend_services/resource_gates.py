"""Cross-game engagement-resource gates (V1).

One shared manifest-driven gate service — no per-runtime custom code.
Two explicit requirement types:
  • balance — the player must HOLD the amount; nothing is burned.
  • burn    — the clearly displayed amount is confirmed and burned to unlock.

Safety rules: immutable rule versions, idempotent unlocks, atomic balance
checks (via resources.grant), automatic reversal if the unlock record fails,
no randomized rewards, no transfers, ledger resources only in V1.
"""
import uuid
from datetime import datetime, timezone

from core.db import db
from services import resources as rs

GATE_TYPES = ("balance", "burn")


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes():
    await db.gm_resource_gates.create_index([("game_id", 1), ("version", 1)], unique=True)
    await db.gm_gate_unlocks.create_index([("user_id", 1), ("gate_id", 1)], unique=True)
    await db.gm_gate_unlocks.create_index("request_id", unique=True, sparse=True)


async def set_gate(game_id: str, body: dict, actor: str) -> dict:
    game = await db.games.find_one({"id": game_id}, {"_id": 0, "id": 1, "title": 1})
    if not game:
        raise ValueError("Game not found")
    prev = await db.gm_resource_gates.find_one({"game_id": game_id}, {"version": 1},
                                               sort=[("version", -1)])
    version = (prev or {}).get("version", 0) + 1
    if body.get("remove"):
        await db.gm_resource_gates.update_many({"game_id": game_id, "active": True},
                                               {"$set": {"active": False, "removed_by": actor,
                                                         "removed_at": _iso()}})
        return {"removed": True}
    gate_type = str(body.get("gate_type") or "")
    if gate_type not in GATE_TYPES:
        raise ValueError("gate_type must be 'balance' (hold, nothing burned) or 'burn'")
    resource_key = str(body.get("resource_key") or "")
    res = await db.resource_registry.find_one({"key": resource_key}, {"_id": 0})
    if not res:
        raise ValueError("Unknown resource — pick one from the Engagement Resources registry")
    if res.get("adapter"):
        raise ValueError(f"'{resource_key}' is adapter-managed — V1 gates support ledger resources only")
    if not res.get("enabled"):
        raise ValueError(f"'{resource_key}' is disabled")
    try:
        amount = int(body.get("amount"))
    except (TypeError, ValueError):
        raise ValueError("Amount must be a whole number")
    if amount <= 0:
        raise ValueError("Amount must be greater than zero")
    if amount > 1_000_000:
        raise ValueError("Amount is unreasonably large")
    doc = {"id": uuid.uuid4().hex, "game_id": game_id, "game_title": game.get("title"),
           "version": version, "active": True, "gate_type": gate_type,
           "resource_key": resource_key, "amount": amount,
           "label": str(body.get("label") or "")[:120],
           "created_by": actor, "created_at": _iso()}
    await db.gm_resource_gates.update_many({"game_id": game_id, "active": True},
                                           {"$set": {"active": False}})
    await db.gm_resource_gates.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


async def active_gate(game_id: str) -> dict | None:
    return await db.gm_resource_gates.find_one({"game_id": game_id, "active": True}, {"_id": 0})


async def status(game_id: str, user_id: str | None) -> dict:
    gate = await active_gate(game_id)
    if not gate:
        return {"gate": None, "satisfied": True}
    res = await db.resource_registry.find_one({"key": gate["resource_key"]},
                                              {"_id": 0, "name": 1, "icon": 1, "active_visual.icon_url": 1})
    gate["resource_name"] = (res or {}).get("name", gate["resource_key"])
    gate["resource_icon"] = (res or {}).get("icon", "")
    gate["icon_url"] = ((res or {}).get("active_visual") or {}).get("icon_url")
    if not user_id:
        return {"gate": gate, "satisfied": False, "balance": 0, "signin_required": True}
    bal_doc = await db.resource_balances.find_one(
        {"user_id": user_id, "resource_key": gate["resource_key"]}, {"balance": 1})
    balance = int((bal_doc or {}).get("balance", 0))
    if gate["gate_type"] == "balance":
        return {"gate": gate, "satisfied": balance >= gate["amount"], "balance": balance}
    unlocked = await db.gm_gate_unlocks.find_one({"user_id": user_id, "gate_id": gate["id"]}, {"_id": 1})
    return {"gate": gate, "satisfied": bool(unlocked), "balance": balance,
            "unlocked": bool(unlocked)}


async def unlock(game_id: str, user: dict, request_id: str | None) -> dict:
    """Burn-gate unlock: idempotent, atomic, auto-reversed on record failure."""
    gate = await active_gate(game_id)
    if not gate:
        raise ValueError("This game has no active resource requirement")
    if gate["gate_type"] != "burn":
        raise ValueError("This requirement only needs a held balance — nothing to burn")
    existing = await db.gm_gate_unlocks.find_one(
        {"user_id": user["id"], "gate_id": gate["id"]}, {"_id": 0})
    if existing:
        return {"unlocked": True, "replayed": True, "unlock": existing}
    idem = f"gate:{gate['id']}:{user['id']}"
    out = await rs.grant(user["id"], gate["resource_key"], -gate["amount"],
                         source_type="gate_burn", source_id=gate["id"], game_id=game_id,
                         idem_key=idem, reason=f"Burn to unlock '{gate.get('game_title')}'",
                         actor=user.get("username"))
    tx = out["transaction"]
    rec = {"id": uuid.uuid4().hex, "game_id": game_id, "user_id": user["id"],
           "gate_id": gate["id"], "gate_version": gate["version"], "tx_id": tx["id"],
           "created_at": _iso()}
    if request_id:
        rec["request_id"] = str(request_id)[:64]
    try:
        await db.gm_gate_unlocks.insert_one(dict(rec))
    except Exception:
        replay = await db.gm_gate_unlocks.find_one({"user_id": user["id"], "gate_id": gate["id"]}, {"_id": 0})
        if replay:
            return {"unlocked": True, "replayed": True, "unlock": replay}
        # unlock record failed — return the burned resource
        await rs.reverse(tx["id"], "system", "Unlock failed — resource returned")
        raise ValueError("Unlock failed — your resource was returned. Please retry.")
    rec.pop("_id", None)
    return {"unlocked": True, "replayed": bool(out.get("replayed")), "unlock": rec, "burned": gate["amount"]}
