"""Phase 1.5 — Game economy: pricing rules, quotes, holds/burns, exchange.

Fire Power uses a WRITABLE ADAPTER over the authoritative fire_wallets vault
(same atomic pattern as fire_up): no competing balance, every hold/release/
burn is an appended fire_wallet_transactions record. Keys stay read-only.
Native resources (stars/coins/gems) hold against resource_balances.
All math is integer — no floats. Engagement resources have no monetary value.
"""
import logging
import math
import uuid
from datetime import datetime, timedelta, timezone

from core.db import db
from services import resources as rs

log = logging.getLogger("ourrealm.economy")

ECONOMY_TIERS = {1: "Minimal", 2: "Minimal", 3: "Light", 4: "Light", 5: "Balanced",
                 6: "Balanced", 7: "Rich", 8: "Rich", 9: "Advanced", 10: "Advanced"}
POWER_TIERS = {1: "Economy", 2: "Economy", 3: "Standard", 4: "Standard", 5: "Enhanced",
               6: "Enhanced", 7: "Advanced", 8: "Advanced", 9: "Maximum", 10: "Maximum"}

DEFAULT_RULE = {"base_per_point": 10, "economy_weight": 1, "ai_power_weight": 1,
                "curve": "linear", "minimum": 20, "maximum": 200,
                "runtime_modifiers": {}, "style_modifiers": {}, "media_modifier": 0,
                "founder_exempt": True, "enabled": True}

QUOTE_TTL_MIN = 20
DEFAULT_HOLD_EXPIRY_H = 72


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes():
    await db.gm_pricing_rules.create_index("version", unique=True)
    await db.gm_quotes.create_index("id", unique=True)
    await db.gm_quotes.create_index("expire_doc_at", expireAfterSeconds=86400 * 14)
    await db.gm_holds.create_index("id", unique=True)
    await db.gm_holds.create_index("quote_id", unique=True)
    await db.gm_holds.create_index("idem_key", unique=True, sparse=True)
    await db.gm_holds.create_index([("user_id", 1), ("state", 1)])
    await db.gm_exchange_rules.create_index("version", unique=True)
    await db.gm_exchange_quotes.create_index("id", unique=True)
    await db.gm_exchanges.create_index("idem_key", unique=True, sparse=True)
    if not await db.gm_pricing_rules.find_one({}):
        await db.gm_pricing_rules.insert_one({**DEFAULT_RULE, "version": 1,
                                              "created_at": _iso(), "created_by": "system-default"})
    if not await db.gm_exchange_rules.find_one({}):
        await db.gm_exchange_rules.insert_one({
            "version": 1, "pairs": [], "min_amount": 1, "max_amount": 100000,
            "daily_limit": None, "cooldown_s": 0, "fee_pct": 0, "rounding": "floor_destination",
            "frozen": False, "enabled": True, "created_at": _iso(), "created_by": "system-default"})


async def active_pricing_rule() -> dict:
    return await db.gm_pricing_rules.find_one({"enabled": True}, {"_id": 0}, sort=[("version", -1)])


def compute_required_fire(rule: dict, economy: int, ai_power: int, runtime: str = "",
                          style: str = "", media: bool = False) -> int:
    e, p = min(max(int(economy), 1), 10), min(max(int(ai_power), 1), 10)
    base = int(rule["base_per_point"])
    if rule.get("curve") == "tiered":
        pts = sum(1 + (i // 5) for i in range(e)) * int(rule["economy_weight"]) + \
              sum(1 + (i // 5) for i in range(p)) * int(rule["ai_power_weight"])
        req = base * pts
    else:  # linear (default)
        req = base * (e * int(rule["economy_weight"]) + p * int(rule["ai_power_weight"]))
    req += int((rule.get("runtime_modifiers") or {}).get(runtime, 0))
    req += int((rule.get("style_modifiers") or {}).get(style, 0))
    if media:
        req += int(rule.get("media_modifier") or 0)
    return min(max(req, int(rule["minimum"])), int(rule["maximum"]))


def required_amount(required_fire: int, fire_equiv: int) -> int:
    """ceil(required_fire / fire_equiv) with exact integer math."""
    fe = int(fire_equiv)
    if fe <= 0:
        raise ValueError("Resource has no configured Fire Power equivalence")
    return -(-int(required_fire) // fe)  # ceil division


# ─── Fire Power writable adapter (authoritative fire_wallets vault) ───────

async def _fire_tx(user_id: str, amount: int, kind: str, ref: str, before: int, after: int):
    await db.fire_wallet_transactions.insert_one({
        "id": uuid.uuid4().hex, "user_id": user_id, "sender_id": "gamemaker_economy",
        "post_id": ref, "amount": amount, "type": kind, "status": "final",
        "vault_balance_before": before, "vault_balance_after": after,
        "created_at": _iso()})


async def fire_hold(user_id: str, amount: int, ref: str) -> bool:
    w = await db.fire_wallets.find_one({"user_id": user_id}, {"vault_balance": 1}) or {}
    before = int(w.get("vault_balance") or 0)
    r = await db.fire_wallets.update_one({"user_id": user_id, "vault_balance": {"$gte": amount}},
                                         {"$inc": {"vault_balance": -amount}})
    if not r.modified_count:
        return False
    await _fire_tx(user_id, -amount, "gm_hold", ref, before, before - amount)
    return True


async def fire_release(user_id: str, amount: int, ref: str):
    w = await db.fire_wallets.find_one({"user_id": user_id}, {"vault_balance": 1}) or {}
    before = int(w.get("vault_balance") or 0)
    await db.fire_wallets.update_one({"user_id": user_id}, {"$inc": {"vault_balance": amount}}, upsert=True)
    await _fire_tx(user_id, amount, "gm_hold_release", ref, before, before + amount)


async def fire_burn_finalize(user_id: str, amount: int, ref: str):
    """Held amount already left the vault — record the final burn only."""
    w = await db.fire_wallets.find_one({"user_id": user_id}, {"vault_balance": 1}) or {}
    bal = int(w.get("vault_balance") or 0)
    await _fire_tx(user_id, 0, "gm_burn_finalized", ref, bal, bal)


async def available_balance(user_id: str, resource_key: str) -> int:
    if resource_key == "fire":
        w = await db.fire_wallets.find_one({"user_id": user_id}, {"vault_balance": 1}) or {}
        return int(w.get("vault_balance") or 0)
    b = await db.resource_balances.find_one({"user_id": user_id, "resource_key": resource_key},
                                            {"balance": 1}) or {}
    return int(b.get("balance") or 0)


async def _native_hold(user_id: str, key: str, amount: int) -> bool:
    r = await db.resource_balances.update_one(
        {"user_id": user_id, "resource_key": key, "balance": {"$gte": amount}},
        {"$inc": {"balance": -amount}, "$set": {"updated_at": _iso()}})
    return bool(r.modified_count)


async def _native_release(user_id: str, key: str, amount: int):
    await db.resource_balances.update_one({"user_id": user_id, "resource_key": key},
                                          {"$inc": {"balance": amount}, "$set": {"updated_at": _iso()}},
                                          upsert=True)


# ─── Quote → Hold → Burn lifecycle ────────────────────────────────────────

async def create_quote(user: dict, body: dict, provider_est: float) -> dict:
    rule = await active_pricing_rule()
    reg = await db.resource_registry.find_one(
        {"key": body.get("resource") or "fire", "archived": {"$ne": True}}, {"_id": 0})
    if not reg or not reg.get("build_eligible", reg["key"] == "fire"):
        raise ValueError("That resource can't be used for builds")
    if reg.get("frozen"):
        raise ValueError(f"{reg['name']} is temporarily frozen")
    fe = int(reg.get("fire_equiv") or (1 if reg["key"] == "fire" else 0))
    rf = compute_required_fire(rule, body["economy"], body["ai_power"],
                               body.get("runtime", ""), body.get("style", ""),
                               bool(body.get("media")))
    amt = required_amount(rf, fe)
    q = {"id": uuid.uuid4().hex, "user_id": user["id"], "state": "quoted",
         "style": body.get("style"), "runtime": body.get("runtime"),
         "economy": int(body["economy"]), "ai_power": int(body["ai_power"]),
         "idea": str(body.get("idea") or "")[:2000],
         "resource_key": reg["key"], "fire_equiv": fe,
         "required_fire": rf, "required_amount": amt,
         "rule_version": rule["version"], "provider_estimate": provider_est,
         "created_at": _iso(),
         "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=QUOTE_TTL_MIN)).isoformat(),
         "expire_doc_at": datetime.now(timezone.utc)}
    await db.gm_quotes.insert_one(dict(q))
    q.pop("_id", None)
    q.pop("expire_doc_at", None)
    q["available"] = await available_balance(user["id"], reg["key"])
    q["economy_tier"] = ECONOMY_TIERS[q["economy"]]
    q["power_tier"] = POWER_TIERS[q["ai_power"]]
    return q


async def place_hold(user: dict, quote_id: str, idem_key: str | None, founder: bool) -> dict:
    """Atomic, idempotent hold. Returns the hold doc (replayed if idem hit)."""
    if idem_key:
        ex = await db.gm_holds.find_one({"idem_key": idem_key}, {"_id": 0})
        if ex:
            return {**ex, "replayed": True}
    q = await db.gm_quotes.find_one({"id": quote_id, "user_id": user["id"]}, {"_id": 0})
    if not q:
        raise ValueError("Quote not found")
    if q["expires_at"] < _iso():
        raise ValueError("Quote expired — get a new quote")
    rule = await db.gm_pricing_rules.find_one({"version": q["rule_version"]}, {"_id": 0})
    exempt = founder and (rule or {}).get("founder_exempt")
    hold = {"id": uuid.uuid4().hex, "user_id": user["id"], "quote_id": quote_id,
            "resource_key": q["resource_key"], "amount": 0 if exempt else q["required_amount"],
            "required_fire": q["required_fire"], "rule_version": q["rule_version"],
            "state": "held", "exempt": bool(exempt), "job_id": None, "game_id": None,
            "transitions": [{"to": "held", "at": _iso()}], "created_at": _iso(),
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=DEFAULT_HOLD_EXPIRY_H)).isoformat()}
    if idem_key:
        hold["idem_key"] = idem_key
    if not exempt and hold["amount"] > 0:
        ok = (await fire_hold(user["id"], hold["amount"], hold["id"]) if q["resource_key"] == "fire"
              else await _native_hold(user["id"], q["resource_key"], hold["amount"]))
        if not ok:
            raise ValueError(f"Not enough {q['resource_key']} — you need {hold['amount']}, "
                             f"you have {await available_balance(user['id'], q['resource_key'])}")
    try:
        await db.gm_holds.insert_one(dict(hold))
    except Exception:  # duplicate quote_id or idem race — refund and replay
        if not exempt and hold["amount"] > 0:
            await (fire_release(user["id"], hold["amount"], hold["id"]) if q["resource_key"] == "fire"
                   else _native_release(user["id"], q["resource_key"], hold["amount"]))
        ex = await db.gm_holds.find_one(
            {"$or": [{"idem_key": idem_key} if idem_key else {"quote_id": quote_id},
                     {"quote_id": quote_id}]}, {"_id": 0})
        if ex:
            return {**ex, "replayed": True}
        raise
    hold.pop("_id", None)
    await db.gm_quotes.update_one({"id": quote_id}, {"$set": {"state": "held"}})
    return hold


async def _transition(hold_id: str, frm: list, to: str, **extra) -> dict | None:
    doc = await db.gm_holds.find_one_and_update(
        {"id": hold_id, "state": {"$in": frm}},
        {"$set": {"state": to, **extra}, "$push": {"transitions": {"to": to, "at": _iso()}}},
        projection={"_id": 0}, return_document=True)
    return doc


async def finalize_burn(hold_id: str, game_id: str):
    h = await _transition(hold_id, ["held"], "burned", game_id=game_id, finalized_at=_iso())
    if not h:
        return  # already finalized/released — idempotent
    if not h["exempt"] and h["amount"] > 0:
        if h["resource_key"] == "fire":
            await fire_burn_finalize(h["user_id"], h["amount"], hold_id)
        else:
            await rs.grant(h["user_id"], h["resource_key"], -h["amount"],
                           source_type="build_burn", source_id=hold_id, game_id=game_id,
                           idem_key=f"burn:{hold_id}", reason="Game Maker build",
                           allow_negative=True, skip_balance=True)


async def release_hold(hold_id: str, reason: str, actor: str = "system") -> bool:
    h = await _transition(hold_id, ["held"], "released", release_reason=reason[:200], released_by=actor)
    if not h:
        return False
    if not h["exempt"] and h["amount"] > 0:
        if h["resource_key"] == "fire":
            await fire_release(h["user_id"], h["amount"], hold_id)
        else:
            await _native_release(h["user_id"], h["resource_key"], h["amount"])
    return True


async def reap_expired_holds():
    now = _iso()
    async for h in db.gm_holds.find({"state": "held", "expires_at": {"$lt": now}}, {"_id": 0, "id": 1}):
        job_running = await db.gm_jobs.find_one(
            {"id": (await db.gm_holds.find_one({"id": h["id"]}, {"job_id": 1}) or {}).get("job_id"),
             "phase": {"$in": ["queued", "planning", "generating", "assembling", "validating", "saving"]}})
        if not job_running:
            await release_hold(h["id"], "expired", "reaper")


# ─── Exchange ─────────────────────────────────────────────────────────────

async def active_exchange_rule() -> dict:
    return await db.gm_exchange_rules.find_one({"enabled": True}, {"_id": 0}, sort=[("version", -1)])


async def exchange_quote(user: dict, src: str, dst: str, amount: int) -> dict:
    rule = await active_exchange_rule()
    if not rule or rule.get("frozen"):
        raise ValueError("Exchange is currently unavailable")
    if src == dst:
        raise ValueError("Pick two different resources")
    if [src, dst] not in [list(p) for p in rule.get("pairs") or []]:
        raise ValueError("That exchange pair isn't enabled")
    pc = (rule.get("pair_configs") or {}).get(f"{src}>{dst}") or {}
    if pc.get("enabled") is False or pc.get("frozen"):
        raise ValueError("That exchange pair is currently unavailable")
    now = _iso()
    if pc.get("start") and now < pc["start"]:
        raise ValueError("That exchange isn't open yet")
    if pc.get("end") and now > pc["end"]:
        raise ValueError("That exchange has ended")
    amount = int(amount)
    lo = int(pc.get("min_amount") or rule.get("min_amount") or 1)
    hi = int(pc.get("max_amount") or rule.get("max_amount") or 10 ** 9)
    if amount < lo or amount > hi:
        raise ValueError("Amount outside allowed exchange limits")
    regs = {r["key"]: r async for r in db.resource_registry.find(
        {"key": {"$in": [src, dst]}, "archived": {"$ne": True}, "enabled": True, "frozen": {"$ne": True}})}
    s, d = regs.get(src), regs.get(dst)
    if not s or not s.get("exchange_source"):
        raise ValueError("Source resource can't be exchanged")
    if not d or not d.get("exchange_dest"):
        raise ValueError("Destination resource can't be received")
    fe_s, fe_d = int(s.get("fire_equiv") or 0), int(d.get("fire_equiv") or 0)
    if pc.get("src_amount") and pc.get("dst_amount"):
        # explicit founder ratio e.g. "Burn 2 Stars → receive 4 Coins"
        sa, da = int(pc["src_amount"]), int(pc["dst_amount"])
        fire_value = amount * fe_s if fe_s > 0 else 0
        fee_pct = int(pc.get("fee_pct") if pc.get("fee_pct") is not None else (rule.get("fee_pct") or 0))
        receive = ((amount * da) * (100 - fee_pct)) // (sa * 100)  # floor — exact integers
        fee = (amount * da * fee_pct) // (sa * 100)
        ratio = {"src_amount": sa, "dst_amount": da, "basis": "explicit_pair"}
    else:
        if fe_s <= 0 or fe_d <= 0:
            raise ValueError("Exchange ratios not configured for this pair")
        fire_value = amount * fe_s
        fee = (fire_value * int(rule.get("fee_pct") or 0)) // 100
        receive = (fire_value - fee) // fe_d  # floor — never mints value (anti-arbitrage)
        ratio = {"src_fire_equiv": fe_s, "dst_fire_equiv": fe_d, "basis": "fire_equiv"}
    if receive <= 0:
        raise ValueError("Amount too small for this ratio")
    q = {"id": uuid.uuid4().hex, "user_id": user["id"], "src": src, "dst": dst,
         "amount": amount, "receive": receive, "fire_value": fire_value, "fee_fire": fee,
         "ratio": ratio,
         "rule_version": rule["version"], "state": "quoted", "created_at": _iso(),
         "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()}
    await db.gm_exchange_quotes.insert_one(dict(q))
    q.pop("_id", None)
    q["available"] = await available_balance(user["id"], src)
    return q


async def exchange_execute(user: dict, quote_id: str, idem_key: str | None) -> dict:
    if idem_key:
        ex = await db.gm_exchanges.find_one({"idem_key": idem_key}, {"_id": 0})
        if ex:
            return {**ex, "replayed": True}
    q = await db.gm_exchange_quotes.find_one({"id": quote_id, "user_id": user["id"], "state": "quoted"},
                                             {"_id": 0})
    if not q:
        raise ValueError("Exchange quote not found or already used")
    if q["expires_at"] < _iso():
        raise ValueError("Exchange quote expired")
    # burn source atomically (fails on insufficient — no partial state)
    if q["src"] == "fire":
        if not await fire_hold(user["id"], q["amount"], f"exchange:{quote_id}"):
            raise ValueError("Not enough Fire Power in your Vault")
    else:
        if not await _native_hold(user["id"], q["src"], q["amount"]):
            raise ValueError(f"Not enough {q['src']}")
    xid = uuid.uuid4().hex
    try:
        if q["src"] != "fire":
            await rs.grant(user["id"], q["src"], -q["amount"], source_type="exchange",
                           source_id=xid, idem_key=f"xsrc:{quote_id}",
                           reason=f"Exchange to {q['dst']}", allow_negative=True, skip_balance=True)
        if q["dst"] == "fire":
            await fire_release(user["id"], q["receive"], f"exchange:{quote_id}")  # credits vault
        else:
            await rs.grant(user["id"], q["dst"], q["receive"], source_type="exchange",
                           source_id=xid, idem_key=f"xdst:{quote_id}",
                           reason=f"Exchange from {q['src']}")
    except Exception:
        # compensate the source burn
        if q["src"] == "fire":
            await fire_release(user["id"], q["amount"], f"exchange-revert:{quote_id}")
        else:
            await _native_release(user["id"], q["src"], q["amount"])
        raise
    rec = {"id": xid, "user_id": user["id"], "quote_id": quote_id, "src": q["src"],
           "dst": q["dst"], "burned": q["amount"], "received": q["receive"],
           "fee_fire": q["fee_fire"], "ratio": q["ratio"], "rule_version": q["rule_version"],
           "created_at": _iso()}
    if idem_key:
        rec["idem_key"] = idem_key
    await db.gm_exchanges.insert_one(dict(rec))
    rec.pop("_id", None)
    await db.gm_exchange_quotes.update_one({"id": quote_id}, {"$set": {"state": "executed"}})
    return rec


def check_arbitrage(rule: dict, regs: dict) -> list:
    """Detect round-trip loops that mint value under current configs."""
    warnings = []
    pairs = [tuple(p) for p in (rule.get("pairs") or [])]
    pcs = rule.get("pair_configs") or {}

    def rate(a, b, amt):
        pc = pcs.get(f"{a}>{b}") or {}
        if pc.get("src_amount") and pc.get("dst_amount"):
            return (amt * int(pc["dst_amount"])) // int(pc["src_amount"])
        fa, fb = int(regs.get(a, {}).get("fire_equiv") or 0), int(regs.get(b, {}).get("fire_equiv") or 0)
        return (amt * fa) // fb if fa > 0 and fb > 0 else 0

    for a, b in pairs:
        if (b, a) in pairs:
            start = 1000
            back = rate(b, a, rate(a, b, start))
            if back > start:
                warnings.append(f"ARBITRAGE LOOP: {a}→{b}→{a} turns {start} into {back}")
    return warnings


async def reconcile_fire() -> dict:
    """Adapter reconciliation: gm hold/release/burn txs vs gm_holds states."""
    txs = await db.fire_wallet_transactions.find(
        {"sender_id": "gamemaker_economy"}, {"_id": 0, "amount": 1, "type": 1}).to_list(20000)
    held_out = -sum(t["amount"] for t in txs if t["type"] == "gm_hold")
    released = sum(t["amount"] for t in txs if t["type"] == "gm_hold_release")
    open_holds = 0
    async for h in db.gm_holds.find({"state": "held", "resource_key": "fire", "exempt": False},
                                    {"_id": 0, "amount": 1}):
        open_holds += h["amount"]
    burned = 0
    async for h in db.gm_holds.find({"state": "burned", "resource_key": "fire", "exempt": False},
                                    {"_id": 0, "amount": 1}):
        burned += h["amount"]
    expected_outstanding = held_out - released
    return {"fire_removed_by_holds": held_out, "fire_released": released,
            "open_hold_total": open_holds, "burned_total": burned,
            "outstanding_vs_expected_ok": expected_outstanding == open_holds + burned,
            "orphaned_delta": expected_outstanding - (open_holds + burned)}
