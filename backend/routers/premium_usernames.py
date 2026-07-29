"""Premium Usernames — lean build (Fire Vault burn).

One centralized service + router. Reuses: fire_wallets / fire_wallet_transactions
ledger, notifications.emit_notification, db.audit_log, admin role gates.

Collections (new, minimal):
  premium_username_config  — single editable config doc (_id="config")
  username_rules           — per-name status/custom cost (reserved/prohibited/...)
  username_history         — old→new change records
  username_claims          — unique normalized-name claim gate (atomic)
  npc_issuance             — permanent NPC_# issuance records
  db.counters _id="npc_username" — atomic NPC sequence
"""
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_role, ROLE_FOUNDER, ROLE_SUPPORT_ADMIN

log = logging.getLogger("ourrealm.premium_usernames")
router = APIRouter(prefix="/api/premium-usernames", tags=["premium-usernames"])

USERNAME_RE = re.compile(r"^[a-z0-9_.]{1,24}$")
NPC_RE = re.compile(r"^npc_(\d+)$")
RULE_STATUSES = ("reserved", "prohibited", "retired", "admin_only",
                 "verification_required", "free")

DEFAULT_CONFIG = {
    "enabled": True,
    "max_premium_len": 6,
    "tier_costs": {"1": 1000000, "2": 500000, "3": 100000,
                   "4": 10000, "5": 1000, "6": 500},
    "tier_enabled": {"1": True, "2": True, "3": True,
                     "4": True, "5": True, "6": True},
    "min_account_age_days": 0,
    "require_verification": False,
    "change_cooldown_days": 7,
    "maintenance_lock": False,
}

_ready = False


def _now():
    return datetime.now(timezone.utc).isoformat()


def norm(u: str) -> str:
    return (u or "").lower().strip()


async def _ensure_ready():
    """Idempotent, restart-safe init: indexes + grandfather migration +
    NPC counter seed. Never modifies existing usernames."""
    global _ready
    if _ready:
        return
    await db.username_rules.create_index([("username", 1)], unique=True)
    await db.username_claims.create_index([("username", 1)], unique=True)
    await db.username_history.create_index([("user_id", 1)])
    await db.counters.update_one({"_id": "npc_username"},
                                 {"$setOnInsert": {"seq": 0}}, upsert=True)
    marker = await db.migrations.find_one({"id": "premium_username_grandfather"})
    if not marker:
        r = await db.users.update_many(
            {"username_grandfathered": {"$ne": True}},
            {"$set": {"username_grandfathered": True,
                      "username_grandfathered_at": _now(),
                      "premium_username_exempt": True}})
        await db.migrations.insert_one({
            "id": "premium_username_grandfather", "at": _now(),
            "users_grandfathered": r.modified_count})
        log.info(f"[premium-usernames] grandfathered {r.modified_count} users")
    _ready = True


async def get_pu_config() -> dict:
    await _ensure_ready()
    doc = await db.premium_username_config.find_one({"_id": "config"}) or {}
    cfg = {**DEFAULT_CONFIG, **{k: doc[k] for k in DEFAULT_CONFIG if k in doc}}
    return cfg


def _cost_for_len(cfg: dict, length: int) -> Optional[int]:
    """Server-side cost for a premium length. None => not claimable."""
    if length > int(cfg["max_premium_len"]):
        return None
    key = str(length)
    if not cfg["tier_enabled"].get(key, False):
        return None
    c = cfg["tier_costs"].get(key)
    return int(c) if c is not None else None


async def npc_peek() -> int:
    await _ensure_ready()
    doc = await db.counters.find_one({"_id": "npc_username"}) or {}
    return int(doc.get("seq") or 0) + 1


async def npc_consume(k: int, username: str, user_id: str) -> bool:
    """Atomically consume NPC number k (only if it is exactly next)."""
    r = await db.counters.find_one_and_update(
        {"_id": "npc_username", "seq": k - 1}, {"$inc": {"seq": 1}})
    if r is None:
        return False
    await db.npc_issuance.insert_one({
        "seq": k, "username": username, "user_id": user_id,
        "at": _now(), "reusable": False})
    return True


async def _taken(u: str, exclude_user_id: str = None) -> bool:
    q = {"username": u}
    if exclude_user_id:
        q["id"] = {"$ne": exclude_user_id}
    if await db.users.find_one(q, {"_id": 0, "id": 1}):
        return True
    if await db.username_claims.find_one({"username": u}, {"_id": 0}):
        return True
    return False


async def evaluate(username: str, viewer: Optional[dict] = None) -> dict:
    """Backend-authoritative status + cost for one username."""
    cfg = await get_pu_config()
    u = norm(username)
    out = {"username": u, "length": len(u), "status": "invalid", "cost": None,
           "premium": False, "message": None}
    if not USERNAME_RE.match(u):
        out["message"] = "Invalid username. Use a–z, 0–9, dots or underscores."
        return out
    if NPC_RE.match(u):
        out["status"] = "reserved"
        out["message"] = "NPC usernames are assigned automatically at signup."
        return out
    rule = await db.username_rules.find_one({"username": u}, {"_id": 0})
    if await _taken(u, (viewer or {}).get("id")):
        out["status"] = "taken"
        out["message"] = "That username already exists."
        return out
    if rule and rule.get("status") in ("prohibited", "retired", "reserved", "admin_only"):
        out["status"] = "reserved" if rule["status"] in ("reserved", "admin_only") else rule["status"]
        out["message"] = "That username is not available."
        return out
    premium = (len(u) <= int(cfg["max_premium_len"])
               or bool(rule and rule.get("force_premium")))
    out["premium"] = premium
    if rule and rule.get("status") == "verification_required":
        out["status"] = "verification_required"
        if not (viewer or {}).get("is_verified"):
            out["message"] = "This username requires a verified account."
            return out
    if not premium:
        out["status"] = "standard"
        out["message"] = "Standard username — no Fire Power required."
        return out
    # premium: custom cost > free rule > tier cost
    if rule and rule.get("status") == "free":
        cost = 0
    elif rule and rule.get("custom_cost") is not None:
        cost = int(rule["custom_cost"])
    else:
        cost = _cost_for_len(cfg, len(u))
    if cost is None:
        out["status"] = "locked"
        out["message"] = "This username length is not claimable right now."
        return out
    out["status"] = "available" if out["status"] != "verification_required" else "verification_required"
    out["cost"] = cost
    out["pricing_rule"] = ("custom" if (rule and (rule.get("custom_cost") is not None
                                                  or rule.get("status") == "free"))
                           else f"tier_{len(u)}")
    return out


async def build_suggestions(u: str) -> list:
    """Checked, available, non-premium-locked alternatives."""
    cfg = await get_pu_config()
    peek = await npc_peek()
    cands = [f"{u}_x", f"{u}{int(time.time()) % 90 + 10}", f"npc_{peek}"]
    out = []
    for c in cands:
        c = norm(c)
        if not USERNAME_RE.match(c):
            continue
        if c.startswith("npc_"):
            out.append(c)
            continue
        if await _taken(c):
            continue
        rule = await db.username_rules.find_one({"username": c}, {"_id": 0, "status": 1})
        if rule and rule.get("status") in ("prohibited", "retired", "reserved",
                                           "admin_only", "verification_required"):
            continue
        if len(c) <= int(cfg["max_premium_len"]) and cfg.get("enabled"):
            continue
        out.append(c)
    return out[:4]


PREMIUM_LOCK_MESSAGE = ("Premium username locked. Create your account first, earn "
                        "Fire Power, and unlock this username from your profile.")


async def signup_gate(username: str) -> Optional[dict]:
    """Called by /auth/register + /auth/username/check. Returns None when
    the name may be registered directly, else {message, suggestions, category}.
    Also validates NPC sequence requests (consume happens post-insert)."""
    cfg = await get_pu_config()
    u = norm(username)
    m = NPC_RE.match(u)
    if m:
        k = int(m.group(1))
        peek = await npc_peek()
        if k != peek:
            return {"message": f"That NPC number isn't available. Next available: npc_{peek}",
                    "suggestions": [f"npc_{peek}"], "category": "npc_sequence",
                    "npc_claim": None}
        return None  # valid next NPC — register() consumes it after insert
    rule = await db.username_rules.find_one({"username": u}, {"_id": 0})
    if rule and rule.get("status") in ("prohibited", "retired", "reserved",
                                       "admin_only", "verification_required"):
        return {"message": "That username is unavailable. Please choose another.",
                "suggestions": await build_suggestions(u), "category": "rule_blocked"}
    if rule and rule.get("force_premium"):
        return {"message": PREMIUM_LOCK_MESSAGE,
                "suggestions": await build_suggestions(u),
                "category": "premium_locked"}
    if await db.username_claims.find_one({"username": u}, {"_id": 0}):
        return {"message": "That username is unavailable. Please choose another.",
                "suggestions": await build_suggestions(u), "category": "claimed"}
    if cfg.get("enabled") and len(u) <= int(cfg["max_premium_len"]):
        return {"message": PREMIUM_LOCK_MESSAGE,
                "suggestions": await build_suggestions(u),
                "category": "premium_locked"}
    return None


async def post_signup_npc(username: str, user_id: str) -> None:
    """Consume the NPC number after the user doc was successfully inserted."""
    m = NPC_RE.match(norm(username))
    if m:
        await npc_consume(int(m.group(1)), norm(username), user_id)


# ------------------------------- rate limit ---------------------------------
_rl: dict = {}


def _rate_limit(uid: str, bucket: str, per_min: int):
    now = time.time()
    key = (uid, bucket)
    hits = [t for t in _rl.get(key, []) if now - t < 60]
    if len(hits) >= per_min:
        raise HTTPException(status_code=429, detail="Slow down — too many attempts.")
    hits.append(now)
    _rl[key] = hits


# ------------------------------- user endpoints ------------------------------

@router.get("/config")
async def public_config(current: CurrentUser):
    cfg = await get_pu_config()
    return {"enabled": cfg["enabled"] and not cfg["maintenance_lock"],
            "max_premium_len": cfg["max_premium_len"],
            "tier_costs": cfg["tier_costs"], "tier_enabled": cfg["tier_enabled"]}


@router.get("/check")
async def check_username(u: str, current: CurrentUser):
    _rate_limit(current["id"], "check", 40)
    cfg = await get_pu_config()
    if cfg["maintenance_lock"]:
        raise HTTPException(status_code=403, detail="Username changes are temporarily locked.")
    res = await evaluate(u, current)
    if res.get("premium") and not cfg["enabled"] and res["status"] == "available":
        res["status"] = "locked"
        res["message"] = "Premium usernames are not available right now."
    w = await db.fire_wallets.find_one({"user_id": current["id"]},
                                       {"_id": 0, "vault_balance": 1}) or {}
    vault = max(0, int(w.get("vault_balance") or 0))
    res["vault_balance"] = vault
    if res["status"] == "available" and res["cost"] is not None:
        res["balance_after"] = vault - res["cost"]
        if vault < res["cost"]:
            res["status"] = "insufficient_vault"
            res["message"] = "Not enough Fire Power in your Fire Vault."
    return res


class UnlockBody(BaseModel):
    username: str = Field(min_length=1, max_length=24)
    idempotency_key: str = Field(min_length=8, max_length=64)


@router.post("/unlock")
async def unlock_username(body: UnlockBody, current: CurrentUser):
    """Atomic, idempotent username change — standard names rename free,
    premium names permanently burn Fire Vault. Shared by Edit Profile,
    Account Settings and the unlock modal."""
    _rate_limit(current["id"], "unlock", 8)
    return await perform_username_change(current, body.username, body.idempotency_key)


async def perform_username_change(current: dict, username: str, idempotency_key: str) -> dict:
    """THE single server-side username-change service (no other code path
    may rename a user). Handles standard (free) and premium (Vault burn)."""
    cfg = await get_pu_config()
    uid = current["id"]
    if cfg["maintenance_lock"]:
        raise HTTPException(status_code=403, detail="Username changes are temporarily locked.")
    # idempotent replay
    prev = await db.fire_wallet_transactions.find_one(
        {"user_id": uid, "type": "premium_username_burn",
         "idempotency_key": idempotency_key}, {"_id": 0})
    if prev:
        return {"success": True, "idempotent_replay": True,
                "username": prev["new_username"], "fire_burned": abs(prev["amount"]),
                "vault_balance_after": prev["vault_balance_after"]}
    udoc = await db.users.find_one({"id": uid}, {"_id": 0}) or {}
    if udoc.get("is_protected") or (udoc.get("username") or "").lower() == "support":
        raise HTTPException(status_code=403, detail="This account is protected and cannot be renamed.")
    # cooldown / account age
    if int(cfg.get("change_cooldown_days") or 0) > 0 and udoc.get("username_changed_at"):
        try:
            from datetime import timedelta
            last = datetime.fromisoformat(udoc["username_changed_at"])
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            nxt = last + timedelta(days=int(cfg["change_cooldown_days"]))
            if datetime.now(timezone.utc) < nxt:
                raise HTTPException(status_code=429,
                                    detail=f"You can change your username again after {nxt.date().isoformat()}.")
        except ValueError:
            pass
    if int(cfg.get("min_account_age_days") or 0) > 0 and udoc.get("created_at"):
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(udoc["created_at"])).days
            if age < int(cfg["min_account_age_days"]):
                raise HTTPException(status_code=403,
                                    detail=f"Your account must be at least {cfg['min_account_age_days']} days old.")
        except ValueError:
            pass
    # server-side revalidation
    res = await evaluate(username, {**current, **udoc})
    if res["status"] == "verification_required" and not udoc.get("is_verified"):
        raise HTTPException(status_code=403, detail="This username requires a verified account.")
    if res["status"] not in ("available", "verification_required", "standard"):
        raise HTTPException(status_code=409, detail=res.get("message") or "That username can't be used.")
    premium = bool(res["premium"])
    if premium:
        if cfg["enabled"] is False:
            raise HTTPException(status_code=403, detail="Premium usernames are not available right now.")
        if cfg.get("require_verification") and not udoc.get("is_verified"):
            raise HTTPException(status_code=403, detail="A verified account is required to unlock premium usernames.")
        if res["cost"] is None:
            raise HTTPException(status_code=409, detail="This username length is not claimable right now.")
    new_u, cost = res["username"], int(res["cost"] or 0) if premium else 0
    old_u = udoc.get("username")
    if new_u == old_u:
        raise HTTPException(status_code=400, detail="That's already your username.")
    # 1) atomic name claim (unique index) — beats concurrent claimers
    try:
        await db.username_claims.insert_one({"username": new_u, "user_id": uid, "at": _now()})
    except Exception:
        raise HTTPException(status_code=409, detail="Someone just claimed that username.")

    # 2) conditional permanent Vault deduction — Vault ONLY, never pool/pending
    w = await db.fire_wallets.find_one({"user_id": uid}, {"_id": 0, "vault_balance": 1}) or {}
    before = max(0, int(w.get("vault_balance") or 0))
    if cost > 0:
        gate = await db.fire_wallets.update_one(
            {"user_id": uid, "vault_balance": {"$gte": cost}},
            {"$inc": {"vault_balance": -cost}})
        if gate.modified_count != 1:
            await db.username_claims.delete_one({"username": new_u, "user_id": uid})
            raise HTTPException(status_code=402, detail="Not enough Fire Power in your Fire Vault.")
    after = before - cost
    try:
        # 3) assign username
        await db.users.update_one({"id": uid}, {"$set": {
            "username": new_u, "username_changed_at": _now(),
            "needs_username_onboarding": False,
            **({"premium_username": True} if premium else {})}})
        # old premium-length usernames retire permanently by default
        if old_u and len(old_u) <= int(cfg["max_premium_len"]):
            await db.username_rules.update_one(
                {"username": old_u},
                {"$set": {"username": old_u, "status": "retired",
                          "note": f"auto-retired after username change by {uid}",
                          "updated_by": "system", "updated_at": _now()}},
                upsert=True)
        # release the old claim so retired-rule is the single source of truth
        await db.username_claims.delete_one({"username": old_u, "user_id": uid})
        # 4) history + (premium only) ledger + audit + notification
        await db.username_history.insert_one({
            "id": uuid.uuid4().hex, "user_id": uid, "old_username": old_u,
            "new_username": new_u, "method": "premium_unlock" if premium else "rename",
            "char_count": len(new_u), "fire_cost": cost, "at": _now()})
        if cost > 0:
            await db.fire_wallet_transactions.insert_one({
                "id": uuid.uuid4().hex, "user_id": uid, "sender_id": None,
                "type": "premium_username_burn", "status": "burned",
                "amount": -cost, "label": "Premium Username Unlock",
                "description": f"Premium username unlock: @{new_u} — {cost} Fire Power burned",
                "old_username": old_u, "new_username": new_u,
                "char_count": len(new_u),
                "vault_balance_before": before, "vault_balance_after": after,
                "pricing_rule": res.get("pricing_rule"),
                "idempotency_key": idempotency_key,
                "created_at": _now()})
        await db.audit_log.insert_one({
            "id": uuid.uuid4().hex,
            "action": "premium_username_unlock" if premium else "username_rename",
            "actor_id": uid, "target_user_id": uid,
            "old_value": old_u, "new_value": new_u, "fire_cost": cost,
            "at": _now()})
        if cost > 0:
            try:
                from routers.notifications import emit_notification
                await emit_notification(
                    recipient_id=uid, kind="premium_username", actor_username=None,
                    payload={"title": "Premium username unlocked! 🔥",
                             "body": f"You unlocked the Premium Username @{new_u} by burning "
                                     f"{cost} Fire Power from your Fire Vault. 🔥"})
            except Exception:  # noqa: BLE001
                pass
    except HTTPException:
        raise
    except Exception as e:  # compensate — refund + release claim
        log.error(f"[premium-usernames] username change failed post-deduct: {e}")
        if cost > 0:
            await db.fire_wallets.update_one({"user_id": uid}, {"$inc": {"vault_balance": cost}})
        await db.users.update_one({"id": uid}, {"$set": {"username": old_u}})
        await db.username_claims.delete_one({"username": new_u, "user_id": uid})
        raise HTTPException(status_code=500, detail="Change failed — nothing was charged.")
    return {"success": True, "username": new_u, "old_username": old_u,
            "premium": premium, "fire_burned": cost,
            "vault_balance_before": before, "vault_balance_after": after,
            "message": (f"Premium username unlocked! Your new username is @{new_u}. "
                        f"{cost} Fire Power was permanently burned from your Fire Vault. 🔥"
                        if premium else f"Username changed to @{new_u}.")}


# ------------------------------- admin endpoints -----------------------------

def _admin(current):
    require_role(current, [ROLE_FOUNDER, ROLE_SUPPORT_ADMIN])


class ConfigBody(BaseModel):
    enabled: Optional[bool] = None
    max_premium_len: Optional[int] = Field(default=None, ge=1, le=12)
    tier_costs: Optional[dict] = None
    tier_enabled: Optional[dict] = None
    min_account_age_days: Optional[int] = Field(default=None, ge=0)
    require_verification: Optional[bool] = None
    change_cooldown_days: Optional[int] = Field(default=None, ge=0)
    maintenance_lock: Optional[bool] = None


@router.get("/admin/config")
async def admin_get_config(current: CurrentUser):
    _admin(current)
    return {"config": await get_pu_config()}


@router.put("/admin/config")
async def admin_set_config(body: ConfigBody, current: CurrentUser):
    _admin(current)
    cfg = await get_pu_config()
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "tier_costs" in upd:
        upd["tier_costs"] = {**cfg["tier_costs"],
                             **{str(k): max(0, int(v)) for k, v in upd["tier_costs"].items()}}
    if "tier_enabled" in upd:
        upd["tier_enabled"] = {**cfg["tier_enabled"],
                               **{str(k): bool(v) for k, v in upd["tier_enabled"].items()}}
    new_max = int(upd.get("max_premium_len", cfg["max_premium_len"]))
    merged_costs = upd.get("tier_costs", cfg["tier_costs"])
    merged_enabled = upd.get("tier_enabled", cfg["tier_enabled"])
    for L in range(1, new_max + 1):
        if merged_enabled.get(str(L)) and merged_costs.get(str(L)) is None:
            raise HTTPException(status_code=400,
                                detail=f"Length {L} is enabled but has no Fire Power price.")
    upd["updated_by"] = current["id"]
    upd["updated_at"] = _now()
    await db.premium_username_config.update_one({"_id": "config"}, {"$set": upd}, upsert=True)
    await db.audit_log.insert_one({
        "id": uuid.uuid4().hex, "action": "premium_username_config",
        "actor_id": current["id"], "changes": {k: v for k, v in upd.items()
                                               if k not in ("updated_by", "updated_at")},
        "at": _now()})
    return {"ok": True, "config": await get_pu_config()}


@router.get("/admin/lookup")
async def admin_lookup(u: str, current: CurrentUser):
    _admin(current)
    un = norm(u)
    owner = await db.users.find_one({"username": un},
                                    {"_id": 0, "id": 1, "username": 1, "name": 1,
                                     "created_at": 1, "username_grandfathered": 1,
                                     "is_verified": 1})
    rule = await db.username_rules.find_one({"username": un}, {"_id": 0})
    hist = [h async for h in db.username_history.find(
        {"$or": [{"old_username": un}, {"new_username": un}]},
        {"_id": 0}).sort("at", -1).limit(20)]
    txns = [t async for t in db.fire_wallet_transactions.find(
        {"type": "premium_username_burn",
         "$or": [{"new_username": un}, {"old_username": un}]},
        {"_id": 0}).sort("created_at", -1).limit(20)]
    ev = await evaluate(un, current)
    return {"username": un, "owner": owner, "rule": rule, "history": hist,
            "transactions": txns, "evaluation": ev}


class RuleBody(BaseModel):
    username: str
    status: Optional[str] = None       # one of RULE_STATUSES, or None w/ release
    custom_cost: Optional[int] = Field(default=None, ge=0)
    note: Optional[str] = None
    release: bool = False              # remove the rule entirely
    reason: str = Field(min_length=3, max_length=300)


@router.post("/admin/rule")
async def admin_set_rule(body: RuleBody, current: CurrentUser):
    _admin(current)
    un = norm(body.username)
    if not USERNAME_RE.match(un):
        raise HTTPException(status_code=400, detail="Invalid username")
    if body.release:
        await db.username_rules.delete_one({"username": un})
    else:
        if body.status is not None and body.status not in RULE_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        upd = {"username": un, "updated_by": current["id"], "updated_at": _now()}
        if body.status is not None:
            upd["status"] = body.status
        if body.custom_cost is not None:
            upd["custom_cost"] = int(body.custom_cost)
        if body.note is not None:
            upd["note"] = body.note
        await db.username_rules.update_one({"username": un}, {"$set": upd}, upsert=True)
    await db.audit_log.insert_one({
        "id": uuid.uuid4().hex, "action": "premium_username_rule",
        "actor_id": current["id"], "username": un,
        "new_value": ("released" if body.release else
                      {"status": body.status, "custom_cost": body.custom_cost}),
        "reason": body.reason, "at": _now()})
    return {"ok": True, "rule": await db.username_rules.find_one({"username": un}, {"_id": 0})}


class GrantBody(BaseModel):
    username: str
    user_id: str
    reason: str = Field(min_length=3, max_length=300)


@router.post("/admin/grant")
async def admin_grant(body: GrantBody, current: CurrentUser):
    """Free admin assignment of a username to a user (no burn)."""
    _admin(current)
    un = norm(body.username)
    if not USERNAME_RE.match(un):
        raise HTTPException(status_code=400, detail="Invalid username")
    target = await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1, "username": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if await _taken(un, target["id"]):
        raise HTTPException(status_code=409, detail="Username already taken")
    old_u = target.get("username")
    try:
        await db.username_claims.insert_one({"username": un, "user_id": target["id"],
                                             "at": _now(), "granted_by": current["id"]})
    except Exception:
        raise HTTPException(status_code=409, detail="Username already claimed")
    await db.users.update_one({"id": target["id"]}, {"$set": {
        "username": un, "username_changed_at": _now()}})
    await db.username_history.insert_one({
        "id": uuid.uuid4().hex, "user_id": target["id"], "old_username": old_u,
        "new_username": un, "method": "admin_grant", "char_count": len(un),
        "fire_cost": 0, "granted_by": current["id"], "reason": body.reason, "at": _now()})
    await db.audit_log.insert_one({
        "id": uuid.uuid4().hex, "action": "premium_username_grant",
        "actor_id": current["id"], "target_user_id": target["id"],
        "old_value": old_u, "new_value": un, "reason": body.reason, "at": _now()})
    try:
        from routers.notifications import emit_notification
        await emit_notification(
            recipient_id=target["id"], kind="premium_username", actor_username=None,
            payload={"title": "Username updated",
                     "body": f"Your username has been updated to @{un} by an OurRealm administrator."})
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "username": un, "old_username": old_u}


@router.get("/admin/stats")
async def admin_stats(current: CurrentUser):
    _admin(current)
    await _ensure_ready()
    unlocks = await db.fire_wallet_transactions.count_documents({"type": "premium_username_burn"})
    burned = 0
    async for t in db.fire_wallet_transactions.find({"type": "premium_username_burn"},
                                                    {"_id": 0, "amount": 1}):
        burned += abs(int(t.get("amount") or 0))
    return {
        "total_unlocks": unlocks,
        "total_fire_burned": burned,
        "grandfathered_users": await db.users.count_documents({"username_grandfathered": True}),
        "reserved_names": await db.username_rules.count_documents({"status": {"$in": ["reserved", "admin_only"]}}),
        "retired_names": await db.username_rules.count_documents({"status": "retired"}),
        "prohibited_names": await db.username_rules.count_documents({"status": "prohibited"}),
        "next_npc_number": await npc_peek(),
    }


@router.get("/admin/conflicts")
async def admin_conflicts(current: CurrentUser):
    """Legacy case-insensitive duplicate / invalid username report (read-only)."""
    _admin(current)
    dups = [d async for d in db.users.aggregate([
        {"$group": {"_id": {"$toLower": "$username"}, "n": {"$sum": 1},
                    "ids": {"$push": "$id"}}},
        {"$match": {"n": {"$gt": 1}}}, {"$limit": 50}])]
    invalid = [u async for u in db.users.find(
        {"username": {"$not": re.compile(r"^[a-z0-9_.]{1,24}$")}},
        {"_id": 0, "id": 1, "username": 1}).limit(50)]
    return {"duplicates": dups, "invalid": invalid}


# ------------------------------- bulk management -----------------------------

BULK_ACTIONS = ("premium_custom_cost", "premium_standard_price",
                "verification_required", "verification_and_fire",
                "reserved", "admin_only", "prohibited", "retired",
                "free_grant_only")


def _parse_bulk(text: str) -> tuple[list, list]:
    """Split on commas + line breaks, trim, lowercase, case-insensitive
    de-dupe (first occurrence wins). Returns (unique, duplicates)."""
    raw = [norm(p) for chunk in (text or "").split("\n") for p in chunk.split(",")]
    seen, unique, dups = set(), [], []
    for u in raw:
        if not u:
            continue
        if u in seen:
            dups.append(u)
            continue
        seen.add(u)
        unique.append(u)
    return unique, dups


def _bulk_rule(action: str, cost) -> dict:
    if action == "premium_custom_cost":
        return {"force_premium": True, "custom_cost": int(cost)}
    if action == "premium_standard_price":
        return {"force_premium": True}
    if action == "verification_required":
        return {"status": "verification_required", "force_premium": True}
    if action == "verification_and_fire":
        return {"status": "verification_required", "force_premium": True,
                "custom_cost": int(cost)}
    if action == "free_grant_only":
        return {"status": "admin_only", "grant_only": True, "custom_cost": 0}
    return {"status": action}  # reserved / admin_only / prohibited / retired


def _rule_matches(existing: dict, new_rule: dict) -> bool:
    e = existing or {}
    for k in ("status", "force_premium", "custom_cost", "grant_only"):
        if e.get(k) != new_rule.get(k):
            return False
    return True


class BulkBody(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    action: str
    custom_cost: Optional[int] = Field(default=None, ge=0)
    override_owned: bool = False
    apply: bool = False              # False = preview only
    reason: Optional[str] = Field(default=None, max_length=300)


@router.post("/admin/bulk")
async def admin_bulk(body: BulkBody, current: CurrentUser):
    """Preview (apply=False) or apply (apply=True) one shared rule across
    many usernames. Idempotent: re-running yields 'already matched'.
    Never renames a user or overwrites an owner."""
    _admin(current)
    cfg = await get_pu_config()
    if body.action not in BULK_ACTIONS:
        raise HTTPException(status_code=400, detail="Unknown bulk action")
    needs_cost = body.action in ("premium_custom_cost", "verification_and_fire")
    if needs_cost and not (body.custom_cost and body.custom_cost > 0):
        raise HTTPException(status_code=400,
                            detail="A Fire Power Burn Cost greater than 0 is required for this rule.")
    if body.custom_cost == 0 and body.action != "free_grant_only":
        raise HTTPException(status_code=400,
                            detail="A cost of 0 is only allowed for free / admin-grant rules.")
    if body.apply and not (body.reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required to apply bulk changes.")
    new_rule = _bulk_rule(body.action, body.custom_cost)
    names, dups = _parse_bulk(body.text)
    if not names:
        raise HTTPException(status_code=400, detail="No usernames found in the input.")
    if len(names) > 200:
        raise HTTPException(status_code=400, detail="Maximum 200 usernames per bulk operation.")

    bulk_id = uuid.uuid4().hex
    rows, summary = [], {"updated": 0, "already_matched": 0, "invalid": 0,
                         "skipped_owned": 0, "duplicates": len(dups)}
    for u in names:
        row = {"username": u, "length": len(u), "current_status": None,
               "owner": None, "existing_cost": None,
               "new_rule": body.action,
               "new_cost": (new_rule.get("custom_cost")
                            if new_rule.get("custom_cost") is not None
                            else _cost_for_len(cfg, len(u))),
               "result": None, "warnings": []}
        if not USERNAME_RE.match(u):
            row["result"] = "invalid"
            row["warnings"].append("Invalid username format")
            summary["invalid"] += 1
            rows.append(row)
            continue
        owner = await db.users.find_one({"username": u},
                                        {"_id": 0, "id": 1, "username": 1, "name": 1,
                                         "username_grandfathered": 1})
        existing = await db.username_rules.find_one({"username": u}, {"_id": 0})
        row["owner"] = ({"id": owner["id"], "name": owner.get("name"),
                         "grandfathered": bool(owner.get("username_grandfathered"))}
                        if owner else None)
        row["existing_cost"] = (existing or {}).get("custom_cost")
        row["current_status"] = ((existing or {}).get("status")
                                 or ("active" if owner else "available"))
        if existing:
            for s in ("reserved", "prohibited", "retired"):
                if existing.get("status") == s:
                    row["warnings"].append(f"Already {s}")
            if existing.get("force_premium") or existing.get("custom_cost") is not None:
                row["warnings"].append("Already premium-configured")
        if owner:
            row["warnings"].append("Username is currently owned"
                                   + (" by a grandfathered user" if owner.get("username_grandfathered") else ""))
        if row["new_cost"] is None and body.action in ("premium_standard_price", "verification_required"):
            row["warnings"].append("No standard price for this length — set a custom cost")
        if owner and not body.override_owned:
            row["result"] = "skipped_owned"
            summary["skipped_owned"] += 1
        elif _rule_matches(existing, new_rule):
            row["result"] = "already_matched"
            summary["already_matched"] += 1
        else:
            row["result"] = "will_update" if not body.apply else "updated"
            if body.apply:
                upd = {"username": u, **new_rule,
                       "updated_by": current["id"], "updated_at": _now(),
                       "bulk_id": bulk_id}
                unset = {k: "" for k in ("status", "force_premium", "custom_cost", "grant_only")
                         if k not in new_rule}
                ops = {"$set": upd}
                if unset:
                    ops["$unset"] = unset
                await db.username_rules.update_one({"username": u}, ops, upsert=True)
            summary["updated"] += 1
        if body.apply:
            await db.audit_log.insert_one({
                "id": uuid.uuid4().hex, "action": "premium_username_bulk_item",
                "bulk_id": bulk_id, "actor_id": current["id"], "username": u,
                "old_value": existing, "new_value": (new_rule if row["result"] == "updated" else None),
                "result": row["result"], "reason": body.reason,
                "warnings": row["warnings"], "at": _now()})
        rows.append(row)
    for d in dups:
        rows.append({"username": d, "result": "duplicate",
                     "warnings": ["Duplicate entry in the submitted list"],
                     "length": len(d), "current_status": None, "owner": None,
                     "existing_cost": None, "new_rule": body.action, "new_cost": None})
    if body.apply:
        await db.audit_log.insert_one({
            "id": bulk_id, "action": "premium_username_bulk",
            "actor_id": current["id"], "submitted_text": body.text[:5000],
            "bulk_action": body.action, "custom_cost": body.custom_cost,
            "reason": body.reason, "summary": summary, "count": len(names),
            "at": _now()})
    return {"applied": body.apply, "bulk_id": bulk_id if body.apply else None,
            "rows": rows, "summary": summary}


@router.get("/admin/rules")
async def admin_list_rules(current: CurrentUser, limit: int = 100):
    _admin(current)
    rows = [r async for r in db.username_rules.find({}, {"_id": 0})
            .sort("updated_at", -1).limit(min(max(limit, 1), 500))]
    return {"rules": rows}


@router.get("/admin/unpaid-renames")
async def admin_unpaid_renames(current: CurrentUser):
    """Read-only repair report: users holding a premium-length username
    that was CHANGED to (not grandfathered-original, not admin-granted)
    without a matching Fire Vault burn. Recommends a repair; changes nothing."""
    _admin(current)
    cfg = await get_pu_config()
    max_len = int(cfg["max_premium_len"])
    rows = []
    async for u in db.users.find(
            {"username_changed_at": {"$exists": True, "$ne": None}},
            {"_id": 0, "id": 1, "username": 1, "name": 1,
             "username_changed_at": 1, "username_grandfathered": 1}):
        un = u.get("username") or ""
        if len(un) > max_len or not USERNAME_RE.match(un):
            continue
        burn = await db.fire_wallet_transactions.find_one(
            {"user_id": u["id"], "type": "premium_username_burn", "new_username": un},
            {"_id": 0, "amount": 1})
        if burn:
            continue
        hist = await db.username_history.find_one(
            {"user_id": u["id"], "new_username": un}, {"_id": 0})
        if hist and hist.get("method") == "admin_grant":
            continue
        prev = (hist or {}).get("old_username")
        if not prev:
            adm = await db.audit_log.find_one(
                {"target_user_id": u["id"],
                 "action": {"$in": ["admin_username_change", "username_rename"]},
                 "new_value": un}, {"_id": 0, "old_value": 1, "action": 1})
            if adm and adm.get("action") == "admin_username_change":
                continue
            prev = (adm or {}).get("old_value")
        ev = await evaluate(un, None)
        rule = await db.username_rules.find_one({"username": un},
                                                {"_id": 0, "custom_cost": 1})
        required = ((rule or {}).get("custom_cost")
                    if (rule or {}).get("custom_cost") is not None
                    else _cost_for_len(cfg, len(un)))
        rows.append({
            "user_id": u["id"], "name": u.get("name"),
            "previous_username": prev or "(unknown — renamed before history tracking)",
            "current_username": un, "char_count": len(un),
            "changed_at": u.get("username_changed_at"),
            "grandfathered": bool(u.get("username_grandfathered")),
            "required_fire_power": required,
            "fire_power_burned": 0,
            "recommended_repair": (
                f"Either (a) collect {required} Fire Power retroactively via an agreed burn, "
                f"(b) admin-grant the name officially with a reason, or "
                f"(c) revert to a standard-length username via admin grant. No automatic change made."
                if required is not None else
                "Set a custom cost or rule for this length, then decide grant vs revert."),
        })
    return {"max_premium_len": max_len, "count": len(rows), "rows": rows}
