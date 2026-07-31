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

CENTER_TYPES = ["family", "household", "business", "team", "organization", "community", "other"]

ROLES = ["owner", "admin", "manager", "member"]
ROLE_RANK = {"owner": 4, "admin": 3, "manager": 2, "member": 1}

ROLE_PERMISSIONS = {
    "owner":   {"edit_center", "invite_members", "remove_members", "manage_roles",
                "view_vault", "view_activity", "fund_vault"},
    "admin":   {"edit_center", "invite_members", "remove_members", "manage_roles",
                "view_vault", "view_activity", "fund_vault"},
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
    }


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
            row = await _ledger(None, uid, "center_created", -CREATE_COST_FP,
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
        {"user_id": uid, "vault_balance": {"$gte": CREATE_COST_FP}},
        {"$inc": {"vault_balance": -CREATE_COST_FP}})
    if res.modified_count != 1:
        await _cleanup_reservation()
        bal = await _wallet_balance(uid)
        raise HTTPException(
            status_code=409,
            detail=f"Creating a Responsibility Center requires {CREATE_COST_FP:,} Fire Power in your Vault. "
                   f"You currently have {bal:,}.")

    now_iso = _now_iso()
    seat_until = (_now() + timedelta(days=SEAT_DAYS)).isoformat()
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
            await _ledger(center_id, uid, "center_created", -CREATE_COST_FP,
                          meta={"seat_paid_until": seat_until})
        await log_activity(center_id, user, "center_created",
                           f"@{user.get('username')} created the Center \"{name}\" "
                           f"({CREATE_COST_FP:,} Fire Power)")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — refund on any partial failure
        log.error(f"[rc] create rollback for {uid}: {e}")
        await db.fire_wallets.update_one(
            {"user_id": uid}, {"$inc": {"vault_balance": CREATE_COST_FP}})
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

    # Seat charge — atomic conditional debit from the CENTER Vault.
    res = await db.responsibility_centers.update_one(
        {"id": center_id, "vault_balance": {"$gte": SEAT_COST_FP}},
        {"$inc": {"vault_balance": -SEAT_COST_FP}})
    if res.modified_count != 1:
        fresh = await db.responsibility_centers.find_one(
            {"id": center_id}, {"_id": 0, "vault_balance": 1}) or {}
        raise HTTPException(
            status_code=409,
            detail=f"The Center Vault needs at least {SEAT_COST_FP} Fire Power to activate your "
                   f"{SEAT_DAYS}-day seat (current vault: {int(fresh.get('vault_balance') or 0):,}). "
                   f"Ask a Center member to fund the vault, then accept again.")

    now_iso = _now_iso()
    seat_until = (_now() + timedelta(days=SEAT_DAYS)).isoformat()
    upd = await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": user["id"], "status": "invited"},
        {"$set": {"status": "active", "joined_at": now_iso,
                  "seat_paid_until": seat_until, "responded_at": now_iso}})
    if upd.modified_count != 1:
        # Someone raced the transition — refund the vault, nothing changed.
        await db.responsibility_centers.update_one(
            {"id": center_id}, {"$inc": {"vault_balance": SEAT_COST_FP}})
        raise HTTPException(status_code=409, detail="Invite was already handled")
    await db.responsibility_centers.update_one(
        {"id": center_id}, {"$inc": {"member_count": 1}})
    await _ledger(center_id, user["id"], "seat_charge", -SEAT_COST_FP,
                  meta={"seat_paid_until": seat_until, "seat_days": SEAT_DAYS})
    await log_activity(center_id, user, "member_joined",
                       f"@{user.get('username')} joined ({SEAT_COST_FP} Fire Power seat, "
                       f"{SEAT_DAYS} days)")
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
        {"user_id": user["id"], "status": {"$in": ["active", "invited"]}},
        {"_id": 0}).to_list(200)
    center_ids = [m["center_id"] for m in memberships]
    centers = {}
    if center_ids:
        async for c in db.responsibility_centers.find(
                {"id": {"$in": center_ids}, "status": {"$ne": "deleted"}}, {"_id": 0}):
            centers[c["id"]] = c
    my_centers, invites = [], []
    for m in memberships:
        c = centers.get(m["center_id"])
        if not c:
            continue
        row = {"center": _public_center(c), "membership": _public_membership(m)}
        (my_centers if m["status"] == "active" else invites).append(row)
    my_centers.sort(key=lambda r: r["center"]["created_at"], reverse=True)
    return {"centers": my_centers, "invites": invites,
            "my_fire_vault_balance": await _wallet_balance(user["id"])}


async def center_members(user: dict, center_id: str) -> dict:
    _, membership = await _center_and_membership(center_id, user["id"])
    _require_member(membership)
    rows = await db.responsibility_center_memberships.find(
        {"center_id": center_id, "status": {"$in": ["active", "invited"]}},
        {"_id": 0}).to_list(500)
    users = await _users_map([r["user_id"] for r in rows])
    members = []
    for r in rows:
        u = users.get(r["user_id"]) or {}
        members.append({**_public_membership(r),
                        "username": u.get("username"), "name": u.get("name"),
                        "avatar_url": u.get("avatar_url")})
    members.sort(key=lambda m: (0 if m["status"] == "active" else 1,
                                -ROLE_RANK.get(m["role"], 0)))
    return {"members": members}


async def center_dashboard(user: dict, center_id: str) -> dict:
    center, membership = await _center_and_membership(center_id, user["id"])
    if not membership or membership.get("status") not in ("active", "invited"):
        raise HTTPException(status_code=403, detail="You are not a member of this Center")
    out = {
        "center": _public_center(center),
        "my_membership": _public_membership(membership),
        "config": {"create_cost": CREATE_COST_FP, "seat_cost": SEAT_COST_FP,
                   "seat_days": SEAT_DAYS},
        "my_fire_vault_balance": await _wallet_balance(user["id"]),
    }
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
    return out
