"""OurRealm Responsibility Center — Phase 1 service layer (June 2026).

A universal organizational structure (families, businesses, teams,
communities, …) built ON TOP of the existing Fire Power economy:
  • Creating a Center burns 1,000 Fire Power from the creator's
    Fire Vault (fire_wallets.vault_balance) — atomic + idempotent.
    The creation fee includes the creator's first 30-day seat.
  • Every additional member seat costs 100 Fire Power per 30 days,
    paid from the CENTER VAULT (funded by members transferring Fire
    Power from their own Vault).
  • No money / currency anywhere — Fire Power only.
  • All balance mutations use conditional atomic updates (the same
    pattern as services/fire_vault.fire_up) — never read-then-write.

Collections:
  responsibility_centers               — one doc per center (holds vault_balance)
  responsibility_center_memberships    — (center_id, user_id) unique; status invited/active/left/removed
  responsibility_center_transactions   — full Fire Power ledger (idempotency_key unique sparse)
  responsibility_center_activity_logs  — human-readable audit trail
"""
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core.db import db

log = logging.getLogger("ourrealm.responsibility_center")

CREATE_COST_FP = 1000
SEAT_COST_FP = 100
SEAT_DAYS = 30
MAX_NAME = 60
MAX_DESC = 500
MAX_FUND_AMOUNT = 100_000

# ── Global settings (founder-controlled, versioned + audited) ───────────
# Defaults EXACTLY preserve the verified Phase 1 behavior. Changes apply
# prospectively only — historical transactions/periods are never rewritten.
RC_SETTINGS_DEFAULTS = {
    "create_cost": CREATE_COST_FP,            # Fire Power Requirement to create
    "seat_cost": SEAT_COST_FP,                # per managed member per active period
    "period_days": SEAT_DAYS,                 # 30-Day Active Period length
    "creator_first_seat_included": True,      # preserve current behavior
    "owner_exempt": True,                     # owner seat never auto-renews/pauses
    "reminder_days": [7, 3, 1],               # renewal warning schedule
    "grace_days": 0,                          # days in Awaiting Fire Power before pause
    "auto_renewals_enabled": True,
    "emergency_renewal_pause": False,         # stops processing, never touches balances
    "max_centers_per_user": 0,                # 0 = unlimited
    "max_members_per_center": 0,              # 0 = unlimited
    "invitation_limit": 50,                   # max pending invites per center
    "center_creation_enabled": True,
    "member_activation_enabled": True,
}
_settings_cache = {"at": 0.0, "doc": None}


async def get_rc_settings() -> dict:
    now = time.monotonic()
    if _settings_cache["doc"] is not None and now - _settings_cache["at"] < 10:
        return _settings_cache["doc"]
    doc = await db.responsibility_center_settings.find_one({"_id": "settings"}) or {}
    merged = {**RC_SETTINGS_DEFAULTS,
              **{k: doc[k] for k in RC_SETTINGS_DEFAULTS if k in doc}}
    merged["version"] = int(doc.get("version") or 0)
    _settings_cache.update(at=now, doc=merged)
    return merged


def invalidate_rc_settings_cache() -> None:
    _settings_cache["doc"] = None

CENTER_TYPES = ["family", "household", "business", "team", "organization", "community", "other"]

ROLES = ["owner", "admin", "manager", "member"]
ROLE_RANK = {"owner": 4, "admin": 3, "manager": 2, "member": 1}

ROLE_PERMISSIONS = {
    "owner":   {"edit_center", "invite_members", "remove_members", "manage_roles",
                "view_vault", "view_activity", "fund_vault", "manage_renewals"},
    "admin":   {"edit_center", "invite_members", "remove_members", "manage_roles",
                "view_vault", "view_activity", "fund_vault", "manage_renewals"},
    "manager": {"invite_members", "view_vault", "view_activity", "fund_vault"},
    "member":  {"fund_vault"},
}

_INDEXES_READY = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


async def ensure_rc_indexes() -> None:
    global _INDEXES_READY
    if _INDEXES_READY:
        return
    try:
        await db.responsibility_center_memberships.create_index(
            [("center_id", 1), ("user_id", 1)], unique=True, name="uniq_center_user")
        await db.responsibility_center_memberships.create_index(
            [("user_id", 1), ("status", 1)], name="by_user_status")
        await db.responsibility_center_transactions.create_index(
            [("idempotency_key", 1)], unique=True, sparse=True, name="uniq_idem")
        await db.responsibility_center_transactions.create_index(
            [("center_id", 1), ("created_at", -1)], name="by_center_time")
        await db.responsibility_center_activity_logs.create_index(
            [("center_id", 1), ("created_at", -1)], name="by_center_time")
        await db.responsibility_centers.create_index([("created_by", 1)], name="by_creator")
    except Exception as e:  # noqa: BLE001 — index drift never blocks requests
        log.warning(f"[rc] index init issue: {e}")
    _INDEXES_READY = True


def has_permission(membership: Optional[dict], perm: str) -> bool:
    if not membership or membership.get("status") != "active":
        return False
    return perm in ROLE_PERMISSIONS.get(membership.get("role") or "member", set())


async def _wallet_balance(uid: str) -> int:
    w = await db.fire_wallets.find_one({"user_id": uid}, {"_id": 0, "vault_balance": 1}) or {}
    return max(0, int(w.get("vault_balance") or 0))


async def log_activity(center_id: str, actor: Optional[dict], action: str, detail: str) -> None:
    await db.responsibility_center_activity_logs.insert_one({
        "id": uuid.uuid4().hex, "center_id": center_id,
        "actor_id": (actor or {}).get("id"),
        "actor_username": (actor or {}).get("username"),
        "action": action, "detail": detail, "created_at": _now_iso(),
    })


async def _ledger(center_id: str, user_id: Optional[str], txn_type: str, amount: int,
                  idempotency_key: Optional[str] = None, meta: Optional[dict] = None,
                  status: str = "completed") -> dict:
    row = {
        "id": uuid.uuid4().hex, "center_id": center_id, "user_id": user_id,
        "transaction_type": txn_type, "amount": int(amount),
        "status": status, "created_at": _now_iso(), "meta": meta or {},
    }
    if idempotency_key:
        row["idempotency_key"] = idempotency_key
    await db.responsibility_center_transactions.insert_one(row)
    return row


def _public_center(c: dict) -> dict:
    return {
        "id": c["id"], "name": c["name"], "center_type": c["center_type"],
        "description": c.get("description") or "",
        "created_by": c["created_by"], "created_at": c["created_at"],
        "status": c.get("status", "active"),
        "vault_balance": max(0, int(c.get("vault_balance") or 0)),
        "member_count": max(0, int(c.get("member_count") or 0)),
        "invitations_locked": bool(c.get("invitations_locked")),
        "vault_frozen": bool(c.get("vault_frozen")),
        "official": bool(c.get("official")),
        "branding": c.get("branding") or None,
    }


def membership_state(m: dict, settings: dict, now: Optional[datetime] = None) -> str:
    """Derived member state — Active / Renewal Soon / Awaiting Fire Power /
    Paused / Removed / Left / Invited / Declined."""
    status = m.get("status")
    if status != "active":
        return status or "unknown"
    if m.get("awaiting_fire_power"):
        return "awaiting_fire_power"
    if m.get("role") == "owner" and settings.get("owner_exempt", True):
        return "active"
    due = m.get("seat_paid_until")
    if due:
        try:
            now = now or _now()
            days_left = (datetime.fromisoformat(due) - now).total_seconds() / 86400
            if days_left <= max(settings.get("reminder_days") or [7]):
                return "renewal_soon"
        except (ValueError, TypeError):
            pass
    return "active"


async def notify_user(uid: str, kind: str, message: str, link: str,
                      center_id: Optional[str] = None,
                      center_name: Optional[str] = None,
                      actor_username: Optional[str] = None) -> None:
    """Responsibility Center notification via the existing platform
    notification system. Deep-links via payload.link. Failures never
    block the calling flow."""
    try:
        now_iso = _now_iso()
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "recipient_id": uid, "kind": kind,
            "actor_username": actor_username,
            "payload": {"message": message, "link": link,
                        "center_id": center_id, "center_name": center_name},
            "created_at": now_iso, "updated_at": now_iso,
            "seen": False, "resolved": False})
    except Exception as e:  # noqa: BLE001
        log.warning(f"[rc] notify failed kind={kind}: {e}")


def _public_membership(m: dict) -> dict:
    return {
        "center_id": m["center_id"], "user_id": m["user_id"],
        "role": m.get("role") or "member", "status": m.get("status"),
        "seat_paid_until": m.get("seat_paid_until"),
        "joined_at": m.get("joined_at"), "invited_at": m.get("invited_at"),
        "invited_by_username": m.get("invited_by_username"),
        "permissions": sorted(ROLE_PERMISSIONS.get(m.get("role") or "member", set()))
        if m.get("status") == "active" else [],
    }


# ── Creation (1,000 FP burn — atomic + idempotent) ──────────────────────
async def create_center(user: dict, name: str, center_type: str,
                        description: str, client_token: Optional[str]) -> dict:
    await ensure_rc_indexes()
    name = (name or "").strip()
    description = (description or "").strip()
    center_type = (center_type or "").strip().lower()
    if not name or len(name) > MAX_NAME:
        raise HTTPException(status_code=400, detail=f"Center name is required (max {MAX_NAME} characters)")
    if len(description) > MAX_DESC:
        raise HTTPException(status_code=400, detail=f"Description is too long (max {MAX_DESC} characters)")
    if center_type not in CENTER_TYPES:
        raise HTTPException(status_code=400, detail="Choose a valid Center type")

    uid = user["id"]
    idem = f"rc-create:{str(client_token)[:96]}" if client_token else None

    # Idempotency reservation — the unique index is the concurrency guard.
    reservation_id = None
    if idem:
        try:
            row = await _ledger(None, uid, "center_created", -create_cost,
                                idempotency_key=idem, status="reserved")
            reservation_id = row["id"]
        except DuplicateKeyError:
            prev = await db.responsibility_center_transactions.find_one(
                {"idempotency_key": idem}, {"_id": 0})
            if prev and prev.get("center_id"):
                center = await db.responsibility_centers.find_one(
                    {"id": prev["center_id"]}, {"_id": 0})
                if center:
                    return {"center": _public_center(center), "duplicate": True}
            raise HTTPException(status_code=409, detail="This creation request is already being processed")

    async def _cleanup_reservation():
        if reservation_id:
            await db.responsibility_center_transactions.delete_one({"id": reservation_id})

    # Atomic conditional burn from the creator's Fire Vault.
    res = await db.fire_wallets.update_one(
        {"user_id": uid, "vault_balance": {"$gte": create_cost}},
        {"$inc": {"vault_balance": -create_cost}})
    if res.modified_count != 1:
        await _cleanup_reservation()
        bal = await _wallet_balance(uid)
        raise HTTPException(
            status_code=409,
            detail=f"Creating a Responsibility Center requires {create_cost:,} Fire Power in your Vault. "
                   f"You currently have {bal:,}.")

    now_iso = _now_iso()
    seat_until = (_now() + timedelta(days=int(settings["period_days"]))).isoformat()
    center_id = uuid.uuid4().hex
    try:
        await db.responsibility_centers.insert_one({
            "id": center_id, "name": name, "center_type": center_type,
            "description": description, "created_by": uid,
            "created_by_username": user.get("username"),
            "created_at": now_iso, "status": "active",
            "vault_balance": 0, "member_count": 1,
        })
        await db.responsibility_center_memberships.insert_one({
            "id": uuid.uuid4().hex, "center_id": center_id, "user_id": uid,
            "role": "owner", "status": "active",
            "seat_paid_until": seat_until, "joined_at": now_iso,
            "created_at": now_iso,
        })
        if reservation_id:
            await db.responsibility_center_transactions.update_one(
                {"id": reservation_id},
                {"$set": {"center_id": center_id, "status": "completed",
                          "meta": {"seat_paid_until": seat_until}}})
        else:
            await _ledger(center_id, uid, "center_created", -create_cost,
                          meta={"seat_paid_until": seat_until})
        await log_activity(center_id, user, "center_created",
                           f"@{user.get('username')} created the Center \"{name}\" "
                           f"({create_cost:,} Fire Power)")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — refund on any partial failure
        log.error(f"[rc] create rollback for {uid}: {e}")
        await db.fire_wallets.update_one(
            {"user_id": uid}, {"$inc": {"vault_balance": create_cost}})
        await db.responsibility_centers.delete_one({"id": center_id})
        await db.responsibility_center_memberships.delete_one(
            {"center_id": center_id, "user_id": uid})
        await _cleanup_reservation()
        raise HTTPException(status_code=500, detail="Center creation failed. Your Fire Power was not spent.")

    center = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0})
    return {"center": _public_center(center), "duplicate": False}


# ── Center Vault funding (member Vault → Center Vault) ──────────────────
async def fund_vault(user: dict, center_id: str, amount: int,
                     idempotency_key: Optional[str] = None) -> dict:
    await ensure_rc_indexes()
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Amount must be a whole number")
    if amount < 1 or amount > MAX_FUND_AMOUNT:
        raise HTTPException(status_code=400, detail=f"Amount must be 1–{MAX_FUND_AMOUNT:,} Fire Power")

    center, membership = await _center_and_membership(center_id, user["id"])
    if not has_permission(membership, "fund_vault"):
        raise HTTPException(status_code=403, detail="Only active Center members can fund the Center Vault")
    if center.get("vault_frozen"):
        raise HTTPException(status_code=409, detail="The Center Vault is frozen by an administrator")
    if center.get("status") == "archived":
        raise HTTPException(status_code=409, detail="This Center is archived")

    uid = user["id"]
    idem = f"rc-fund:{str(idempotency_key)[:96]}" if idempotency_key else None
    reservation_id = None
    if idem:
        try:
            row = await _ledger(center_id, uid, "vault_fund", amount,
                                idempotency_key=idem, status="reserved")
            reservation_id = row["id"]
        except DuplicateKeyError:
            fresh = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0})
            return {"duplicate": True, "center": _public_center(fresh),
                    "my_fire_vault_balance": await _wallet_balance(uid)}

    res = await db.fire_wallets.update_one(
        {"user_id": uid, "vault_balance": {"$gte": amount}},
        {"$inc": {"vault_balance": -amount}})
    if res.modified_count != 1:
        if reservation_id:
            await db.responsibility_center_transactions.delete_one({"id": reservation_id})
        bal = await _wallet_balance(uid)
        raise HTTPException(status_code=409,
                            detail=f"Not enough Fire Power — you have {bal:,} in your Vault.")

    await db.responsibility_centers.update_one(
        {"id": center_id}, {"$inc": {"vault_balance": amount}})
    if reservation_id:
        await db.responsibility_center_transactions.update_one(
            {"id": reservation_id}, {"$set": {"status": "completed"}})
    else:
        await _ledger(center_id, uid, "vault_fund", amount)
    await log_activity(center_id, user, "vault_funded",
                       f"@{user.get('username')} added {amount:,} Fire Power to the Center Vault")

    fresh = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0})
    return {"duplicate": False, "center": _public_center(fresh),
            "my_fire_vault_balance": await _wallet_balance(uid)}


# ── Membership helpers ──────────────────────────────────────────────────
async def _center_and_membership(center_id: str, user_id: str):
    center = await db.responsibility_centers.find_one(
        {"id": center_id, "status": {"$ne": "deleted"}}, {"_id": 0})
    if not center:
        raise HTTPException(status_code=404, detail="Responsibility Center not found")
    membership = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": user_id}, {"_id": 0})
    return center, membership


def _require_member(membership: Optional[dict]) -> dict:
    if not membership or membership.get("status") != "active":
        raise HTTPException(status_code=403, detail="You are not an active member of this Center")
    return membership


async def invite_member(actor: dict, center_id: str, username: str) -> dict:
    await ensure_rc_indexes()
    center, membership = await _center_and_membership(center_id, actor["id"])
    if not has_permission(membership, "invite_members"):
        raise HTTPException(status_code=403, detail="You don't have permission to invite members")
    if center.get("status") != "active":
        raise HTTPException(status_code=409, detail=f"This Center is {center.get('status')} — invitations are unavailable")
    if center.get("invitations_locked"):
        raise HTTPException(status_code=409, detail="Invitations are locked for this Center by an administrator")
    settings = await get_rc_settings()
    inv_limit = int(settings.get("invitation_limit") or 0)
    if inv_limit > 0:
        pending = await db.responsibility_center_memberships.count_documents(
            {"center_id": center_id, "status": "invited"})
        if pending >= inv_limit:
            raise HTTPException(status_code=409,
                                detail=f"This Center has reached the limit of {inv_limit} pending invitations")
    max_members = int(settings.get("max_members_per_center") or 0)
    if max_members > 0 and int(center.get("member_count") or 0) >= max_members:
        raise HTTPException(status_code=409,
                            detail=f"This Center has reached the limit of {max_members} members")
    username = (username or "").strip().lstrip("@").lower()
    if not username:
        raise HTTPException(status_code=400, detail="Enter a username to invite")
    target = await db.users.find_one(
        {"username": username, "disabled": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1})
    if not target:
        raise HTTPException(status_code=404, detail=f"No user found with username @{username}")
    if target["id"] == actor["id"]:
        raise HTTPException(status_code=400, detail="You are already a member of this Center")
    existing = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": target["id"]}, {"_id": 0})
    if existing and existing.get("status") == "active":
        raise HTTPException(status_code=409, detail=f"@{username} is already a member")
    if existing and existing.get("status") == "invited":
        raise HTTPException(status_code=409, detail=f"@{username} already has a pending invite")

    now_iso = _now_iso()
    doc = {"role": "member", "status": "invited",
           "invited_by": actor["id"], "invited_by_username": actor.get("username"),
           "invited_at": now_iso, "seat_paid_until": None, "joined_at": None}
    await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": target["id"]},
        {"$set": doc, "$setOnInsert": {"id": uuid.uuid4().hex, "created_at": now_iso}},
        upsert=True)
    await log_activity(center_id, actor, "member_invited",
                       f"@{actor.get('username')} invited @{username}")
    try:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "recipient_id": target["id"],
            "kind": "responsibility_center_invite",
            "actor_username": actor.get("username"),
            "payload": {"center_id": center_id, "center_name": center["name"],
                        "message": f"@{actor.get('username')} invited you to join the "
                                   f"Responsibility Center \"{center['name']}\".",
                        "cta": "View Responsibility Centers"},
            "created_at": now_iso, "updated_at": now_iso, "seen": False, "resolved": False})
    except Exception as e:  # noqa: BLE001 — notification failure never blocks the invite
        log.warning(f"[rc] invite notification failed: {e}")
    return {"ok": True, "invited_username": username}


async def respond_invite(user: dict, center_id: str, accept: bool) -> dict:
    await ensure_rc_indexes()
    center, membership = await _center_and_membership(center_id, user["id"])
    if not membership or membership.get("status") != "invited":
        raise HTTPException(status_code=404, detail="No pending invite for this Center")

    if not accept:
        await db.responsibility_center_memberships.update_one(
            {"center_id": center_id, "user_id": user["id"], "status": "invited"},
            {"$set": {"status": "declined", "responded_at": _now_iso()}})
        await log_activity(center_id, user, "invite_declined",
                           f"@{user.get('username')} declined the invite")
        return {"ok": True, "joined": False}

    settings = await get_rc_settings()
    if not settings.get("member_activation_enabled", True):
        raise HTTPException(status_code=403, detail="Member activation is temporarily disabled")
    if center.get("status") != "active":
        raise HTTPException(status_code=409, detail=f"This Center is {center.get('status')} — activation is unavailable")
    if center.get("vault_frozen"):
        raise HTTPException(status_code=409, detail="The Center Vault is frozen by an administrator")
    seat_cost = int(settings["seat_cost"])
    period_days = int(settings["period_days"])

    # Seat charge — atomic conditional debit from the CENTER Vault.
    res = await db.responsibility_centers.update_one(
        {"id": center_id, "vault_balance": {"$gte": seat_cost}},
        {"$inc": {"vault_balance": -seat_cost}})
    if res.modified_count != 1:
        fresh = await db.responsibility_centers.find_one(
            {"id": center_id}, {"_id": 0, "vault_balance": 1}) or {}
        raise HTTPException(
            status_code=409,
            detail=f"The Center Vault needs at least {seat_cost} Fire Power to activate your "
                   f"{period_days}-day seat (current vault: {int(fresh.get('vault_balance') or 0):,}). "
                   f"Ask a Center member to fund the vault, then accept again.")

    now_iso = _now_iso()
    seat_until = (_now() + timedelta(days=period_days)).isoformat()
    upd = await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": user["id"], "status": "invited"},
        {"$set": {"status": "active", "joined_at": now_iso,
                  "seat_paid_until": seat_until, "responded_at": now_iso,
                  "warnings_sent": [], "awaiting_fire_power": False}})
    if upd.modified_count != 1:
        # Someone raced the transition — refund the vault, nothing changed.
        await db.responsibility_centers.update_one(
            {"id": center_id}, {"$inc": {"vault_balance": seat_cost}})
        raise HTTPException(status_code=409, detail="Invite was already handled")
    await db.responsibility_centers.update_one(
        {"id": center_id}, {"$inc": {"member_count": 1}})
    await _ledger(center_id, user["id"], "seat_charge", -seat_cost,
                  meta={"seat_paid_until": seat_until, "seat_days": period_days})
    await log_activity(center_id, user, "member_joined",
                       f"@{user.get('username')} joined ({seat_cost} Fire Power seat, "
                       f"{period_days} days)")
    return {"ok": True, "joined": True, "seat_paid_until": seat_until}


async def set_role(actor: dict, center_id: str, target_user_id: str, role: str) -> dict:
    _, membership = await _center_and_membership(center_id, actor["id"])
    if not has_permission(membership, "manage_roles"):
        raise HTTPException(status_code=403, detail="You don't have permission to manage roles")
    role = (role or "").strip().lower()
    if role not in ROLES or role == "owner":
        raise HTTPException(status_code=400, detail="Role must be admin, manager, or member")
    target = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": target_user_id, "status": "active"}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="That user is not an active member")
    if target.get("role") == "owner":
        raise HTTPException(status_code=403, detail="The owner's role cannot be changed")
    actor_rank = ROLE_RANK.get(membership.get("role"), 0)
    if actor_rank < 4 and (ROLE_RANK.get(target.get("role"), 0) >= actor_rank
                           or ROLE_RANK.get(role, 0) >= actor_rank):
        raise HTTPException(status_code=403, detail="You can only manage roles below your own")
    await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": target_user_id},
        {"$set": {"role": role, "role_updated_at": _now_iso()}})
    await log_activity(center_id, actor, "role_changed",
                       f"@{actor.get('username')} set a member's role to {role}")
    return {"ok": True, "role": role}


async def remove_member(actor: dict, center_id: str, target_user_id: str) -> dict:
    _, membership = await _center_and_membership(center_id, actor["id"])
    if not has_permission(membership, "remove_members"):
        raise HTTPException(status_code=403, detail="You don't have permission to remove members")
    target = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": target_user_id,
         "status": {"$in": ["active", "invited"]}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="That user is not a member")
    if target.get("role") == "owner":
        raise HTTPException(status_code=403, detail="The owner cannot be removed")
    actor_rank = ROLE_RANK.get(membership.get("role"), 0)
    if actor_rank < 4 and ROLE_RANK.get(target.get("role"), 0) >= actor_rank:
        raise HTTPException(status_code=403, detail="You can only remove members below your own role")
    was_active = target.get("status") == "active"
    await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": target_user_id},
        {"$set": {"status": "removed", "removed_at": _now_iso(),
                  "removed_by": actor["id"]}})
    if was_active:
        await db.responsibility_centers.update_one(
            {"id": center_id, "member_count": {"$gt": 0}}, {"$inc": {"member_count": -1}})
    await log_activity(center_id, actor, "member_removed",
                       f"@{actor.get('username')} removed a member")
    return {"ok": True}


async def leave_center(user: dict, center_id: str) -> dict:
    _, membership = await _center_and_membership(center_id, user["id"])
    m = _require_member(membership)
    if m.get("role") == "owner":
        raise HTTPException(status_code=403,
                            detail="The owner cannot leave their Center in Phase 1")
    await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": user["id"], "status": "active"},
        {"$set": {"status": "left", "left_at": _now_iso()}})
    await db.responsibility_centers.update_one(
        {"id": center_id, "member_count": {"$gt": 0}}, {"$inc": {"member_count": -1}})
    await log_activity(center_id, user, "member_left",
                       f"@{user.get('username')} left the Center")
    return {"ok": True}


async def update_center(actor: dict, center_id: str,
                        name: Optional[str], description: Optional[str]) -> dict:
    center, membership = await _center_and_membership(center_id, actor["id"])
    if not has_permission(membership, "edit_center"):
        raise HTTPException(status_code=403, detail="You don't have permission to edit this Center")
    sets = {}
    if name is not None:
        name = name.strip()
        if not name or len(name) > MAX_NAME:
            raise HTTPException(status_code=400, detail=f"Center name is required (max {MAX_NAME} characters)")
        sets["name"] = name
    if description is not None:
        description = description.strip()
        if len(description) > MAX_DESC:
            raise HTTPException(status_code=400, detail=f"Description is too long (max {MAX_DESC} characters)")
        sets["description"] = description
    if not sets:
        return {"center": _public_center(center)}
    sets["updated_at"] = _now_iso()
    await db.responsibility_centers.update_one({"id": center_id}, {"$set": sets})
    await log_activity(center_id, actor, "center_updated",
                       f"@{actor.get('username')} updated Center details")
    fresh = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0})
    return {"center": _public_center(fresh)}


# ── Reads ───────────────────────────────────────────────────────────────
async def _users_map(user_ids: list) -> dict:
    out = {}
    async for u in db.users.find({"id": {"$in": user_ids}},
                                 {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1}):
        out[u["id"]] = u
    return out


async def list_mine(user: dict) -> dict:
    await ensure_rc_indexes()
    memberships = await db.responsibility_center_memberships.find(
        {"user_id": user["id"], "status": {"$in": ["active", "invited", "paused"]}},
        {"_id": 0}).to_list(200)
    center_ids = [m["center_id"] for m in memberships]
    centers = {}
    if center_ids:
        async for c in db.responsibility_centers.find(
                {"id": {"$in": center_ids}, "status": {"$ne": "deleted"}}, {"_id": 0}):
            centers[c["id"]] = c
    settings = await get_rc_settings()
    my_centers, invites, paused = [], [], []
    for m in memberships:
        c = centers.get(m["center_id"])
        if not c:
            continue
        row = {"center": _public_center(c), "membership": _public_membership(m),
               "state": membership_state(m, settings)}
        if m["status"] == "active":
            my_centers.append(row)
        elif m["status"] == "invited":
            invites.append(row)
        else:
            paused.append(row)
    my_centers.sort(key=lambda r: r["center"]["created_at"], reverse=True)
    return {"centers": my_centers, "invites": invites, "paused": paused,
            "my_fire_vault_balance": await _wallet_balance(user["id"])}


async def center_members(user: dict, center_id: str) -> dict:
    _, membership = await _center_and_membership(center_id, user["id"])
    _require_member(membership)
    rows = await db.responsibility_center_memberships.find(
        {"center_id": center_id, "status": {"$in": ["active", "invited", "paused"]}},
        {"_id": 0}).to_list(500)
    users = await _users_map([r["user_id"] for r in rows])
    settings = await get_rc_settings()
    members = []
    for r in rows:
        u = users.get(r["user_id"]) or {}
        members.append({**_public_membership(r),
                        "username": u.get("username"), "name": u.get("name"),
                        "avatar_url": u.get("avatar_url"),
                        "state": membership_state(r, settings),
                        "awaiting_fire_power": bool(r.get("awaiting_fire_power"))})
    members.sort(key=lambda m: (0 if m["status"] == "active" else (1 if m["status"] == "paused" else 2),
                                -ROLE_RANK.get(m["role"], 0)))
    return {"members": members}


async def center_dashboard(user: dict, center_id: str) -> dict:
    center, membership = await _center_and_membership(center_id, user["id"])
    if not membership or membership.get("status") not in ("active", "invited", "paused"):
        raise HTTPException(status_code=403, detail="You are not a member of this Center")
    settings = await get_rc_settings()
    cfg = {"create_cost": int(settings["create_cost"]),
           "seat_cost": int(settings["seat_cost"]),
           "seat_days": int(settings["period_days"])}
    out = {
        "center": _public_center(center),
        "my_membership": _public_membership(membership),
        "my_state": membership_state(membership, settings),
        "config": cfg,
        "my_fire_vault_balance": await _wallet_balance(user["id"]),
    }
    # Paused members see ONLY safe status information — no members,
    # activity, vault transactions, or private Center content.
    if membership.get("status") == "paused":
        out["paused_notice"] = {
            "message": "Your membership is paused because your seat's Fire Power "
                       "Requirement couldn't be covered by the Center Vault.",
            "fire_power_needed": cfg["seat_cost"],
            "vault_balance": out["center"]["vault_balance"],
            "help": "Ask a Center member to Add Fire Power to the Vault. A "
                    "Center manager can then reactivate your seat.",
            "paused_at": membership.get("paused_at"),
        }
        out["center"] = {k: out["center"][k] for k in
                         ("id", "name", "center_type", "status", "vault_balance")}
        return out
    if membership.get("status") == "active":
        members = await center_members(user, center_id)
        out["members"] = members["members"]
        activity = await db.responsibility_center_activity_logs.find(
            {"center_id": center_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
        out["activity"] = activity
        if has_permission(membership, "view_vault"):
            txns = await db.responsibility_center_transactions.find(
                {"center_id": center_id, "status": "completed"},
                {"_id": 0}).sort("created_at", -1).to_list(25)
            users = await _users_map(list({t["user_id"] for t in txns if t.get("user_id")}))
            for t in txns:
                t["username"] = (users.get(t.get("user_id")) or {}).get("username")
            out["vault_transactions"] = txns
        if has_permission(membership, "manage_renewals"):
            out["renewal_summary"] = await renewal_summary(center, settings)
    return out


async def renewal_summary(center: dict, settings: Optional[dict] = None) -> dict:
    """Owner/Admin dashboard panel — upcoming Fire Power Requirements,
    paused members, and Vault Coverage. Server-authoritative."""
    settings = settings or await get_rc_settings()
    seat_cost = int(settings["seat_cost"])
    now = _now()
    q = {"center_id": center["id"], "status": "active"}
    if settings.get("owner_exempt", True):
        q["role"] = {"$ne": "owner"}
    rows = await db.responsibility_center_memberships.find(
        q, {"_id": 0, "user_id": 1, "seat_paid_until": 1, "awaiting_fire_power": 1}).to_list(1000)
    due_7 = due_3 = due_1 = awaiting = 0
    for m in rows:
        if m.get("awaiting_fire_power"):
            awaiting += 1
        due = m.get("seat_paid_until")
        if not due:
            continue
        try:
            days = (datetime.fromisoformat(due) - now).total_seconds() / 86400
        except (ValueError, TypeError):
            continue
        if days <= 1:
            due_1 += 1
        if days <= 3:
            due_3 += 1
        if days <= 7:
            due_7 += 1
    paused = await db.responsibility_center_memberships.count_documents(
        {"center_id": center["id"], "status": "paused"})
    vault = max(0, int(center.get("vault_balance") or 0))
    fp_needed_7d = due_7 * seat_cost
    return {
        "renewing_in_7_days": due_7, "renewing_in_3_days": due_3,
        "renewing_in_1_day": due_1, "awaiting_fire_power": awaiting,
        "paused_members": paused, "vault_balance": vault,
        "seat_cost": seat_cost,
        "fire_power_needed_7d": fp_needed_7d,
        "fire_power_shortfall_7d": max(0, fp_needed_7d - vault),
        "vault_coverage_seats": vault // seat_cost if seat_cost else 0,
        "paused_reactivation_cost": paused * seat_cost,
    }


async def reactivate_member(actor: dict, center_id: str, target_user_id: str) -> dict:
    """Reactivate a paused member — burns the configured Fire Power
    Requirement from the Center Vault and starts a NEW active period from
    now. Race-safe + duplicate-safe (status transition is the guard)."""
    center, membership = await _center_and_membership(center_id, actor["id"])
    if not has_permission(membership, "manage_renewals"):
        raise HTTPException(status_code=403, detail="You don't have permission to reactivate members")
    if center.get("status") != "active":
        raise HTTPException(status_code=409, detail=f"This Center is {center.get('status')}")
    if center.get("vault_frozen"):
        raise HTTPException(status_code=409, detail="The Center Vault is frozen by an administrator")
    target = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": target_user_id, "status": "paused"}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="That member is not paused")
    settings = await get_rc_settings()
    seat_cost = int(settings["seat_cost"])
    period_days = int(settings["period_days"])

    res = await db.responsibility_centers.update_one(
        {"id": center_id, "vault_balance": {"$gte": seat_cost}, "vault_frozen": {"$ne": True}},
        {"$inc": {"vault_balance": -seat_cost}})
    if res.modified_count != 1:
        fresh = await db.responsibility_centers.find_one(
            {"id": center_id}, {"_id": 0, "vault_balance": 1}) or {}
        raise HTTPException(
            status_code=409,
            detail=f"The Center Vault needs at least {seat_cost} Fire Power to reactivate this "
                   f"member (current vault: {int(fresh.get('vault_balance') or 0):,}).")
    now_iso = _now_iso()
    seat_until = (_now() + timedelta(days=period_days)).isoformat()
    upd = await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": target_user_id, "status": "paused"},
        {"$set": {"status": "active", "seat_paid_until": seat_until,
                  "warnings_sent": [], "awaiting_fire_power": False,
                  "reactivated_at": now_iso, "reactivated_by": actor["id"]},
         "$unset": {"paused_at": "", "paused_reason": ""}})
    if upd.modified_count != 1:
        await db.responsibility_centers.update_one(
            {"id": center_id}, {"$inc": {"vault_balance": seat_cost}})
        raise HTTPException(status_code=409, detail="Member was already reactivated")
    await db.responsibility_centers.update_one(
        {"id": center_id}, {"$inc": {"member_count": 1}})
    await _ledger(center_id, target_user_id, "seat_reactivation", -seat_cost,
                  meta={"seat_paid_until": seat_until, "reactivated_by": actor["id"]})
    await db.responsibility_center_renewal_attempts.insert_one({
        "id": uuid.uuid4().hex, "center_id": center_id,
        "membership_user_id": target_user_id, "result": "reactivated",
        "amount": seat_cost, "source": "manual_reactivation",
        "actor_id": actor["id"], "period_end": seat_until,
        "created_at": now_iso})
    await log_activity(center_id, actor, "member_reactivated",
                       f"@{actor.get('username')} reactivated a member's seat "
                       f"({seat_cost} Fire Power, {period_days} days)")
    await notify_user(target_user_id, "responsibility_center_reactivated",
                      f"Your seat in \"{center['name']}\" has been reactivated — "
                      f"your new {period_days}-day active period has started.",
                      f"/responsibility-center/{center_id}",
                      center_id, center["name"], actor.get("username"))
    return {"ok": True, "seat_paid_until": seat_until}


async def reactivate_eligible(actor: dict, center_id: str) -> dict:
    """Reactivate as many paused members as the Vault can cover."""
    center, membership = await _center_and_membership(center_id, actor["id"])
    if not has_permission(membership, "manage_renewals"):
        raise HTTPException(status_code=403, detail="You don't have permission to reactivate members")
    paused = await db.responsibility_center_memberships.find(
        {"center_id": center_id, "status": "paused"},
        {"_id": 0, "user_id": 1}).sort("paused_at", 1).to_list(500)
    reactivated, failed = 0, 0
    for m in paused:
        try:
            await reactivate_member(actor, center_id, m["user_id"])
            reactivated += 1
        except HTTPException:
            failed += 1
            break  # vault exhausted or frozen — stop cleanly
    return {"ok": True, "reactivated": reactivated, "remaining_paused": len(paused) - reactivated}
