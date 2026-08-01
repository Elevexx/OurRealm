"""Responsibility Center — Founder/Admin management panel (Bundle A).

/api/admin/responsibility-center/* — every endpoint enforces granular
RC admin permissions ON THE BACKEND. Every mutating action requires a
written reason and writes an immutable audit row (admin identity,
timestamp, before state, after state). No silent balance manipulation.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser
from core.permissions import get_admin_role, ROLE_FOUNDER
from services import responsibility_center as rc

log = logging.getLogger("ourrealm.rc.admin")

router = APIRouter(prefix="/api/admin/responsibility-center", tags=["rc-admin"])

# ── Granular admin permissions ──────────────────────────────────────────
RC_ADMIN_PERMS = {
    "responsibility_center.view",
    "responsibility_center.manage",
    "responsibility_center.pause",
    "responsibility_center.restore",
    "responsibility_center.archive",
    "responsibility_center.manage_members",
    "responsibility_center.manage_vaults",
    "responsibility_center.adjust_fire_power",
    "responsibility_center.reverse_transactions",
    "responsibility_center.retry_renewals",
    "responsibility_center.manage_settings",
    "responsibility_center.manage_media",
    "responsibility_center.view_activity",
    "responsibility_center.view_audit_logs",
    "responsibility_center.export_data",
    "responsibility_center.transfer_ownership",
    "responsibility_center.manage_ownership_recovery",
    "responsibility_center.review_closure",
    "responsibility_center.cancel_closure",
    "responsibility_center.manage_retention_hold",
    "responsibility_center.view_lifecycle_audit",
}
_VIEW_ONLY = {"responsibility_center.view", "responsibility_center.view_activity",
              "responsibility_center.view_audit_logs"}


def admin_rc_perms(user: dict) -> set:
    role = get_admin_role(user)
    if role == ROLE_FOUNDER:
        return set(RC_ADMIN_PERMS)
    if role:  # support_admin / moderator — read-only visibility
        return set(_VIEW_ONLY)
    return set()


def require_rc_perm(user: dict, perm: str) -> None:
    if perm not in admin_rc_perms(user):
        raise HTTPException(status_code=403, detail="You don't have this Responsibility Center admin permission")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _audit(admin: dict, action: str, reason: str,
                 center_id: Optional[str] = None,
                 before: Optional[dict] = None, after: Optional[dict] = None,
                 extra: Optional[dict] = None) -> None:
    await db.responsibility_center_admin_audit.insert_one({
        "id": uuid.uuid4().hex, "action": action, "center_id": center_id,
        "admin_id": admin["id"], "admin_username": admin.get("username"),
        "reason": (reason or "")[:500], "before": before, "after": after,
        "extra": extra or {}, "created_at": _now_iso()})


def _require_reason(reason: Optional[str]) -> str:
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="A written reason (min 5 characters) is required")
    return reason


async def _get_center(center_id: str) -> dict:
    c = await db.responsibility_centers.find_one(
        {"id": center_id, "status": {"$ne": "deleted"}}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Responsibility Center not found")
    return c


# ── Overview stats (real database values only) ──────────────────────────
@router.get("/overview")
async def rc_admin_overview(current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    settings = await rc.get_rc_settings()
    seat_cost = int(settings["seat_cost"])
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    week = (now - timedelta(days=7)).isoformat()
    month = (now - timedelta(days=30)).isoformat()
    C, M, T, A = (db.responsibility_centers, db.responsibility_center_memberships,
                  db.responsibility_center_transactions, db.responsibility_center_renewal_attempts)
    base = {"status": {"$ne": "deleted"}}

    async def burned(types: list) -> int:
        agg = await T.aggregate([
            {"$match": {"transaction_type": {"$in": types}, "status": "completed"}},
            {"$group": {"_id": None, "s": {"$sum": {"$abs": "$amount"}}}}]).to_list(1)
        return int(agg[0]["s"]) if agg else 0

    vault_agg = await C.aggregate([
        {"$match": {"status": {"$in": ["active", "paused"]}}},
        {"$group": {"_id": None, "s": {"$sum": "$vault_balance"}}}]).to_list(1)
    owner_q = {"role": {"$ne": "owner"}} if settings.get("owner_exempt", True) else {}
    recent_audit = await db.responsibility_center_admin_audit.find(
        {}, {"_id": 0}).sort("created_at", -1).to_list(10)
    return {
        "centers": {
            "total": await C.count_documents(base),
            "active": await C.count_documents({"status": "active"}),
            "paused": await C.count_documents({"status": "paused"}),
            "archived": await C.count_documents({"status": "archived"}),
            "created_today": await C.count_documents({**base, "created_at": {"$gte": today}}),
            "created_this_week": await C.count_documents({**base, "created_at": {"$gte": week}}),
            "created_this_month": await C.count_documents({**base, "created_at": {"$gte": month}}),
            "low_vault": await C.count_documents({"status": "active", "vault_balance": {"$lt": seat_cost}}),
            "frozen_vaults": await C.count_documents({"vault_frozen": True}),
            "needs_review": await C.count_documents({"needs_review": True}),
            "reported": await C.count_documents({"open_reports": {"$gt": 0}}),
            "invitations_locked": await C.count_documents({"invitations_locked": True}),
        },
        "memberships": {
            "total": await M.count_documents({"status": {"$in": ["active", "paused", "invited"]}}),
            "active_managed": await M.count_documents({"status": "active", **owner_q}),
            "paused": await M.count_documents({"status": "paused"}),
            "awaiting_fire_power": await M.count_documents({"status": "active", "awaiting_fire_power": True}),
            "pending_invitations": await M.count_documents({"status": "invited"}),
            "upcoming_renewals_7d": await M.count_documents({
                "status": "active", **owner_q,
                "seat_paid_until": {"$lte": (now + timedelta(days=7)).isoformat()}}),
        },
        "renewals": {
            "failed_attempts_30d": await A.count_documents(
                {"result": {"$in": ["insufficient", "paused"]}, "created_at": {"$gte": month}}),
            "successful_30d": await A.count_documents(
                {"result": "success", "created_at": {"$gte": month}}),
        },
        "fire_power": {
            "burned_center_creation": await burned(["center_created"]),
            "burned_seat_activations": await burned(["seat_charge", "seat_reactivation"]),
            "burned_seat_renewals": await burned(["seat_renewal"]),
            "stored_in_vaults": int(vault_agg[0]["s"]) if vault_agg else 0,
        },
        "settings": {k: settings[k] for k in rc.RC_SETTINGS_DEFAULTS},
        "settings_version": settings.get("version", 0),
        "recent_admin_actions": recent_audit,
        "my_permissions": sorted(admin_rc_perms(current)),
    }


# ── All Centers table ───────────────────────────────────────────────────
@router.get("/centers")
async def rc_admin_centers(current: CurrentUser, q: str = "", status: str = "",
                           center_type: str = "", flag: str = "",
                           sort: str = "newest", page: int = 1, limit: int = 25):
    require_rc_perm(current, "responsibility_center.view")
    settings = await rc.get_rc_settings()
    seat_cost = int(settings["seat_cost"])
    query: dict = {"status": {"$ne": "deleted"}}
    if status in ("active", "paused", "archived"):
        query["status"] = status
    if center_type in rc.CENTER_TYPES:
        query["center_type"] = center_type
    if flag == "low_vault":
        query["vault_balance"] = {"$lt": seat_cost}
        query.setdefault("status", "active")
    elif flag == "frozen_vault":
        query["vault_frozen"] = True
    elif flag == "needs_review":
        query["needs_review"] = True
    elif flag == "official":
        query["official"] = True
    elif flag == "user_created":
        query["official"] = {"$ne": True}
    elif flag == "invitations_locked":
        query["invitations_locked"] = True
    q = (q or "").strip()
    if q:
        owner_ids = [u["id"] async for u in db.users.find(
            {"$or": [{"username": {"$regex": q, "$options": "i"}},
                     {"email": {"$regex": q, "$options": "i"}}]},
            {"_id": 0, "id": 1}).limit(50)]
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"id": q},
                        {"created_by": {"$in": owner_ids}}]
    page = max(1, int(page))
    limit = max(1, min(int(limit), 100))
    sort_spec = [("created_at", -1)]
    if sort == "oldest":
        sort_spec = [("created_at", 1)]
    elif sort == "vault_low":
        sort_spec = [("vault_balance", 1)]
    elif sort == "vault_high":
        sort_spec = [("vault_balance", -1)]
    elif sort == "members":
        sort_spec = [("member_count", -1)]
    total = await db.responsibility_centers.count_documents(query)
    centers = await db.responsibility_centers.find(query, {"_id": 0}) \
        .sort(sort_spec).skip((page - 1) * limit).to_list(limit)
    cids = [c["id"] for c in centers]
    owner_ids = list({c["created_by"] for c in centers})
    owners = {u["id"]: u async for u in db.users.find(
        {"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "username": 1})}
    paused_counts, invited_counts, awaiting_counts, next_due, failed_counts = {}, {}, {}, {}, {}
    if cids:
        async for r in db.responsibility_center_memberships.aggregate([
                {"$match": {"center_id": {"$in": cids}}},
                {"$group": {"_id": {"c": "$center_id", "s": "$status"}, "n": {"$sum": 1}}}]):
            key, n = r["_id"], r["n"]
            if key["s"] == "paused":
                paused_counts[key["c"]] = n
            elif key["s"] == "invited":
                invited_counts[key["c"]] = n
        async for r in db.responsibility_center_memberships.aggregate([
                {"$match": {"center_id": {"$in": cids}, "status": "active",
                            "awaiting_fire_power": True}},
                {"$group": {"_id": "$center_id", "n": {"$sum": 1}}}]):
            awaiting_counts[r["_id"]] = r["n"]
        owner_q = {"role": {"$ne": "owner"}} if settings.get("owner_exempt", True) else {}
        async for r in db.responsibility_center_memberships.aggregate([
                {"$match": {"center_id": {"$in": cids}, "status": "active",
                            "seat_paid_until": {"$ne": None}, **owner_q}},
                {"$group": {"_id": "$center_id", "d": {"$min": "$seat_paid_until"}}}]):
            next_due[r["_id"]] = r["d"]
        async for r in db.responsibility_center_renewal_attempts.aggregate([
                {"$match": {"center_id": {"$in": cids},
                            "result": {"$in": ["insufficient", "paused"]}}},
                {"$group": {"_id": "$center_id", "n": {"$sum": 1}}}]):
            failed_counts[r["_id"]] = r["n"]
    rows = []
    for c in centers:
        rows.append({
            **rc._public_center(c),
            "needs_review": bool(c.get("needs_review")),
            "owner_username": (owners.get(c["created_by"]) or {}).get("username"),
            "paused_members": paused_counts.get(c["id"], 0),
            "pending_invitations": invited_counts.get(c["id"], 0),
            "awaiting_fire_power": awaiting_counts.get(c["id"], 0),
            "next_requirement_date": next_due.get(c["id"]),
            "failed_renewals": failed_counts.get(c["id"], 0),
        })
    return {"centers": rows, "total": total, "page": page, "limit": limit}


# ── Center detail + sub-resources ───────────────────────────────────────
@router.get("/centers/{center_id}")
async def rc_admin_center_detail(center_id: str, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    c = await _get_center(center_id)
    owner = await db.users.find_one({"id": c["created_by"]},
                                    {"_id": 0, "id": 1, "username": 1, "name": 1})
    settings = await rc.get_rc_settings()
    return {
        "center": {**rc._public_center(c), "needs_review": bool(c.get("needs_review")),
                   "updated_at": c.get("updated_at")},
        "owner": owner,
        "renewal_summary": await rc.renewal_summary(c, settings),
        "counts": {
            "paused": await db.responsibility_center_memberships.count_documents(
                {"center_id": center_id, "status": "paused"}),
            "invited": await db.responsibility_center_memberships.count_documents(
                {"center_id": center_id, "status": "invited"}),
            "transactions": await db.responsibility_center_transactions.count_documents(
                {"center_id": center_id, "status": "completed"}),
            "renewal_attempts": await db.responsibility_center_renewal_attempts.count_documents(
                {"center_id": center_id}),
            "notes": await db.responsibility_center_admin_notes.count_documents(
                {"center_id": center_id}),
        },
    }


async def _list_sub(coll, center_id: str, limit: int, sort_field: str = "created_at"):
    return await coll.find({"center_id": center_id}, {"_id": 0}) \
        .sort(sort_field, -1).to_list(max(1, min(limit, 200)))


@router.get("/centers/{center_id}/members")
async def rc_admin_members(center_id: str, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    await _get_center(center_id)
    settings = await rc.get_rc_settings()
    rows = await db.responsibility_center_memberships.find(
        {"center_id": center_id}, {"_id": 0}).to_list(500)
    users = await rc._users_map([r["user_id"] for r in rows])
    out = []
    for r in rows:
        u = users.get(r["user_id"]) or {}
        out.append({**rc._public_membership(r), "username": u.get("username"),
                    "name": u.get("name"), "state": rc.membership_state(r, settings),
                    "paused_at": r.get("paused_at"), "paused_reason": r.get("paused_reason"),
                    "awaiting_fire_power": bool(r.get("awaiting_fire_power"))})
    return {"members": out}


@router.get("/centers/{center_id}/transactions")
async def rc_admin_txns(center_id: str, current: CurrentUser, limit: int = 50):
    require_rc_perm(current, "responsibility_center.view")
    await _get_center(center_id)
    txns = await db.responsibility_center_transactions.find(
        {"center_id": center_id}, {"_id": 0}).sort("created_at", -1).to_list(max(1, min(limit, 200)))
    users = await rc._users_map(list({t["user_id"] for t in txns if t.get("user_id")}))
    for t in txns:
        t["username"] = (users.get(t.get("user_id")) or {}).get("username")
    return {"transactions": txns}


@router.get("/centers/{center_id}/renewals")
async def rc_admin_renewals(center_id: str, current: CurrentUser, limit: int = 50):
    require_rc_perm(current, "responsibility_center.view")
    await _get_center(center_id)
    rows = await _list_sub(db.responsibility_center_renewal_attempts, center_id, limit)
    users = await rc._users_map(list({r["membership_user_id"] for r in rows if r.get("membership_user_id")}))
    for r in rows:
        r["username"] = (users.get(r.get("membership_user_id")) or {}).get("username")
    return {"renewal_attempts": rows}


@router.get("/centers/{center_id}/activity")
async def rc_admin_activity(center_id: str, current: CurrentUser, limit: int = 50):
    require_rc_perm(current, "responsibility_center.view_activity")
    await _get_center(center_id)
    return {"activity": await _list_sub(db.responsibility_center_activity_logs, center_id, limit)}


@router.get("/centers/{center_id}/audit")
async def rc_admin_audit(center_id: str, current: CurrentUser, limit: int = 50):
    require_rc_perm(current, "responsibility_center.view_audit_logs")
    await _get_center(center_id)
    return {"audit": await _list_sub(db.responsibility_center_admin_audit, center_id, limit)}


@router.get("/centers/{center_id}/notes")
async def rc_admin_get_notes(center_id: str, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    await _get_center(center_id)
    return {"notes": await _list_sub(db.responsibility_center_admin_notes, center_id, 100)}


class NoteBody(BaseModel):
    note: str


@router.post("/centers/{center_id}/notes")
async def rc_admin_add_note(center_id: str, body: NoteBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage")
    await _get_center(center_id)
    note = (body.note or "").strip()
    if not note or len(note) > 2000:
        raise HTTPException(status_code=400, detail="Note must be 1–2000 characters")
    row = {"id": uuid.uuid4().hex, "center_id": center_id, "note": note,
           "admin_id": current["id"], "admin_username": current.get("username"),
           "created_at": _now_iso()}
    await db.responsibility_center_admin_notes.insert_one({**row})
    await _audit(current, "note_added", note[:120], center_id)
    return {"ok": True, "note": row}


# ── Center actions (pause / restore / archive / locks / freeze) ─────────
_ACTIONS = {
    "pause": ("responsibility_center.pause", {"status": "paused"}),
    "restore": ("responsibility_center.restore", {"status": "active"}),
    "archive": ("responsibility_center.archive", {"status": "archived"}),
    "lock_invitations": ("responsibility_center.manage", {"invitations_locked": True}),
    "unlock_invitations": ("responsibility_center.manage", {"invitations_locked": False}),
    "freeze_vault": ("responsibility_center.manage_vaults", {"vault_frozen": True}),
    "unfreeze_vault": ("responsibility_center.manage_vaults", {"vault_frozen": False}),
    "mark_needs_review": ("responsibility_center.manage", {"needs_review": True}),
    "clear_needs_review": ("responsibility_center.manage", {"needs_review": False}),
}


class ActionBody(BaseModel):
    action: str
    reason: str


@router.post("/centers/{center_id}/action")
async def rc_admin_action(center_id: str, body: ActionBody, current: CurrentUser):
    if body.action not in _ACTIONS:
        raise HTTPException(status_code=400, detail="Unknown action")
    perm, sets = _ACTIONS[body.action]
    require_rc_perm(current, perm)
    reason = _require_reason(body.reason)
    c = await _get_center(center_id)
    before = {k: c.get(k) for k in sets}
    await db.responsibility_centers.update_one(
        {"id": center_id},
        {"$set": {**sets, "admin_updated_at": _now_iso()}})
    await _audit(current, body.action, reason, center_id, before=before, after=sets)
    await rc.log_activity(center_id, None, f"admin_{body.action}",
                          f"An administrator performed: {body.action.replace('_', ' ')}")
    if body.action in ("pause", "restore", "archive"):
        await rc.notify_user(c["created_by"], "responsibility_center_admin_action",
                             f"An administrator {body.action}d your Center \"{c['name']}\"."
                             if body.action != "pause" else
                             f"An administrator paused your Center \"{c['name']}\".",
                             f"/responsibility-center/{center_id}", center_id, c["name"])
    fresh = await _get_center(center_id)
    return {"ok": True, "center": rc._public_center(fresh)}


# ── Fire Power controls ─────────────────────────────────────────────────
class AdjustBody(BaseModel):
    amount: int
    reason: str
    idempotency_key: Optional[str] = None


@router.post("/centers/{center_id}/vault/adjust")
async def rc_admin_adjust(center_id: str, body: AdjustBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.adjust_fire_power")
    reason = _require_reason(body.reason)
    if body.amount == 0 or abs(body.amount) > 1_000_000:
        raise HTTPException(status_code=400, detail="Adjustment amount must be non-zero and within ±1,000,000")
    c = await _get_center(center_id)
    idem = f"rc-admin-adjust:{str(body.idempotency_key)[:96]}" if body.idempotency_key else None
    txn = {"id": uuid.uuid4().hex, "center_id": center_id, "user_id": None,
           "transaction_type": "admin_adjustment", "amount": int(body.amount),
           "status": "completed", "created_at": _now_iso(),
           "meta": {"reason": reason, "admin_id": current["id"],
                    "admin_username": current.get("username")}}
    if idem:
        txn["idempotency_key"] = idem
    before_balance = max(0, int(c.get("vault_balance") or 0))
    try:
        await db.responsibility_center_transactions.insert_one(txn)
    except Exception:  # DuplicateKeyError — idempotent replay
        fresh = await _get_center(center_id)
        return {"ok": True, "duplicate": True, "center": rc._public_center(fresh)}
    if body.amount < 0:
        res = await db.responsibility_centers.update_one(
            {"id": center_id, "vault_balance": {"$gte": -body.amount}},
            {"$inc": {"vault_balance": body.amount}})
        if res.modified_count != 1:
            await db.responsibility_center_transactions.delete_one({"id": txn["id"]})
            raise HTTPException(status_code=409,
                                detail=f"Adjustment would make the Vault negative (current: {before_balance:,})")
    else:
        await db.responsibility_centers.update_one(
            {"id": center_id}, {"$inc": {"vault_balance": body.amount}})
    fresh = await _get_center(center_id)
    after_balance = max(0, int(fresh.get("vault_balance") or 0))
    await _audit(current, "vault_adjustment", reason, center_id,
                 before={"vault_balance": before_balance},
                 after={"vault_balance": after_balance},
                 extra={"amount": body.amount, "transaction_id": txn["id"]})
    await rc.log_activity(center_id, None, "admin_vault_adjustment",
                          f"An administrator adjusted the Center Vault by {body.amount:+,} Fire Power")
    return {"ok": True, "duplicate": False, "center": rc._public_center(fresh),
            "before": before_balance, "after": after_balance}


class ReasonBody(BaseModel):
    reason: str


@router.post("/centers/{center_id}/transactions/{txn_id}/reverse")
async def rc_admin_reverse(center_id: str, txn_id: str, body: ReasonBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.reverse_transactions")
    reason = _require_reason(body.reason)
    c = await _get_center(center_id)
    txn = await db.responsibility_center_transactions.find_one(
        {"id": txn_id, "center_id": center_id, "status": "completed"}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found or not completed")
    if txn.get("reversed_by"):
        raise HTTPException(status_code=409, detail="Transaction was already reversed")
    if txn["transaction_type"] not in ("vault_fund", "seat_charge", "seat_renewal",
                                       "seat_reactivation", "admin_adjustment"):
        raise HTTPException(status_code=400, detail="This transaction type is not reversible")
    comp_amount = -int(txn["amount"])
    before_balance = max(0, int(c.get("vault_balance") or 0))
    if comp_amount < 0:
        res = await db.responsibility_centers.update_one(
            {"id": center_id, "vault_balance": {"$gte": -comp_amount}},
            {"$inc": {"vault_balance": comp_amount}})
        if res.modified_count != 1:
            raise HTTPException(status_code=409, detail="Reversal would make the Vault negative")
    else:
        await db.responsibility_centers.update_one(
            {"id": center_id}, {"$inc": {"vault_balance": comp_amount}})
    comp = {"id": uuid.uuid4().hex, "center_id": center_id, "user_id": txn.get("user_id"),
            "transaction_type": "admin_reversal", "amount": comp_amount,
            "status": "completed", "created_at": _now_iso(),
            "meta": {"reverses": txn_id, "reason": reason,
                     "admin_id": current["id"], "admin_username": current.get("username")}}
    await db.responsibility_center_transactions.insert_one({**comp})
    await db.responsibility_center_transactions.update_one(
        {"id": txn_id}, {"$set": {"reversed_by": comp["id"], "reversed_at": _now_iso()}})
    fresh = await _get_center(center_id)
    await _audit(current, "transaction_reversed", reason, center_id,
                 before={"vault_balance": before_balance, "transaction": txn_id},
                 after={"vault_balance": int(fresh.get("vault_balance") or 0),
                        "reversal": comp["id"]})
    await rc.log_activity(center_id, None, "admin_transaction_reversed",
                          f"An administrator reversed a {txn['transaction_type']} transaction "
                          f"({comp_amount:+,} Fire Power)")
    return {"ok": True, "reversal_id": comp["id"], "center": rc._public_center(fresh)}


@router.post("/centers/{center_id}/members/{user_id}/retry-renewal")
async def rc_admin_retry_renewal(center_id: str, user_id: str, body: ReasonBody, current: CurrentUser):
    """Manual retry — paused member → reactivation; due active member →
    renewal. Both paths are idempotent and never double-burn a period."""
    require_rc_perm(current, "responsibility_center.retry_renewals")
    reason = _require_reason(body.reason)
    c = await _get_center(center_id)
    m = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": user_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Membership not found")
    settings = await rc.get_rc_settings()
    from services import rc_renewals
    if m.get("status") == "paused":
        # Admin-driven reactivation — same rules as owner reactivation but
        # gated on the admin permission instead of Center role.
        before = {"member_status": "paused"}
        result = await _admin_reactivate(current, c, m, settings)
        await _audit(current, "renewal_retry_reactivation", reason, center_id,
                     before=before, after={"member_status": "active",
                                           "seat_paid_until": result.get("seat_paid_until")})
        return {"ok": True, **result}
    if m.get("status") != "active":
        raise HTTPException(status_code=409, detail=f"Membership is {m.get('status')}")
    r = await rc_renewals.renew_membership(c, m, settings, source="admin_retry", actor=current)
    await _audit(current, "renewal_retry", reason, center_id,
                 before={"seat_paid_until": m.get("seat_paid_until")},
                 after={"result": r["result"], "new_period_end": r.get("new_period_end")})
    if r["result"] == "insufficient":
        raise HTTPException(status_code=409,
                            detail=f"Vault has {r['vault_balance']} — needs {r['needed']} Fire Power")
    return {"ok": True, **r}


async def _admin_reactivate(admin: dict, center: dict, membership: dict, settings: dict) -> dict:
    seat_cost = int(settings["seat_cost"])
    period_days = int(settings["period_days"])
    center_id = center["id"]
    uid = membership["user_id"]
    res = await db.responsibility_centers.update_one(
        {"id": center_id, "vault_balance": {"$gte": seat_cost}},
        {"$inc": {"vault_balance": -seat_cost}})
    if res.modified_count != 1:
        fresh = await _get_center(center_id)
        raise HTTPException(status_code=409,
                            detail=f"Vault has {int(fresh.get('vault_balance') or 0)} — "
                                   f"needs {seat_cost} Fire Power")
    now_iso = _now_iso()
    seat_until = (datetime.now(timezone.utc) + timedelta(days=period_days)).isoformat()
    upd = await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": uid, "status": "paused"},
        {"$set": {"status": "active", "seat_paid_until": seat_until,
                  "warnings_sent": [], "awaiting_fire_power": False,
                  "reactivated_at": now_iso, "reactivated_by": admin["id"]},
         "$unset": {"paused_at": "", "paused_reason": ""}})
    if upd.modified_count != 1:
        await db.responsibility_centers.update_one(
            {"id": center_id}, {"$inc": {"vault_balance": seat_cost}})
        raise HTTPException(status_code=409, detail="Member was already reactivated")
    await db.responsibility_centers.update_one(
        {"id": center_id}, {"$inc": {"member_count": 1}})
    await db.responsibility_center_transactions.insert_one({
        "id": uuid.uuid4().hex, "center_id": center_id, "user_id": uid,
        "transaction_type": "seat_reactivation", "amount": -seat_cost,
        "status": "completed", "created_at": now_iso,
        "meta": {"seat_paid_until": seat_until, "admin_id": admin["id"]}})
    await rc.log_activity(center_id, None, "admin_member_reactivated",
                          "An administrator reactivated a paused member's seat")
    await rc.notify_user(uid, "responsibility_center_reactivated",
                         f"Your seat in \"{center['name']}\" has been reactivated.",
                         f"/responsibility-center/{center_id}", center_id, center["name"])
    return {"seat_paid_until": seat_until}


# ── Global settings (versioned + audited, prospective only) ─────────────
_SETTING_TYPES = {
    "create_cost": int, "seat_cost": int, "period_days": int,
    "creator_first_seat_included": bool, "owner_exempt": bool,
    "reminder_days": list, "grace_days": int,
    "auto_renewals_enabled": bool, "emergency_renewal_pause": bool,
    "max_centers_per_user": int, "max_members_per_center": int,
    "invitation_limit": int, "center_creation_enabled": bool,
    "member_activation_enabled": bool,
}
_SETTING_BOUNDS = {"create_cost": (1, 1_000_000), "seat_cost": (1, 100_000),
                   "period_days": (1, 365), "grace_days": (0, 90),
                   "max_centers_per_user": (0, 1000), "max_members_per_center": (0, 100_000),
                   "invitation_limit": (0, 10_000)}


@router.get("/settings")
async def rc_admin_get_settings(current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    settings = await rc.get_rc_settings()
    history = await db.responsibility_center_settings_history.find(
        {}, {"_id": 0}).sort("created_at", -1).to_list(20)
    return {"settings": {k: settings[k] for k in rc.RC_SETTINGS_DEFAULTS},
            "version": settings.get("version", 0), "history": history,
            "defaults": rc.RC_SETTINGS_DEFAULTS}


class SettingsBody(BaseModel):
    updates: dict
    reason: str


@router.patch("/settings")
async def rc_admin_patch_settings(body: SettingsBody, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_settings")
    reason = _require_reason(body.reason)
    if not body.updates:
        raise HTTPException(status_code=400, detail="No settings provided")
    current_settings = await rc.get_rc_settings()
    sets, changes = {}, []
    for key, value in body.updates.items():
        if key not in _SETTING_TYPES:
            raise HTTPException(status_code=400, detail=f"Unknown setting: {key}")
        typ = _SETTING_TYPES[key]
        if typ is bool:
            value = bool(value)
        elif typ is int:
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"{key} must be a whole number")
            lo, hi = _SETTING_BOUNDS.get(key, (0, 10_000_000))
            if value < lo or value > hi:
                raise HTTPException(status_code=400, detail=f"{key} must be {lo}–{hi}")
        elif typ is list:
            if not isinstance(value, list) or not all(isinstance(d, int) and 0 < d <= 60 for d in value):
                raise HTTPException(status_code=400, detail=f"{key} must be a list of days (1–60)")
            value = sorted(set(value), reverse=True)
        old = current_settings.get(key)
        if old != value:
            sets[key] = value
            changes.append({"key": key, "previous": old, "new": value})
    if not sets:
        return {"ok": True, "changed": [], "version": current_settings.get("version", 0)}
    new_version = int(current_settings.get("version") or 0) + 1
    await db.responsibility_center_settings.update_one(
        {"_id": "settings"},
        {"$set": {**sets, "version": new_version, "updated_at": _now_iso(),
                  "updated_by": current.get("username")}},
        upsert=True)
    rc.invalidate_rc_settings_cache()
    await db.responsibility_center_settings_history.insert_one({
        "id": uuid.uuid4().hex, "version": new_version, "changes": changes,
        "reason": reason, "admin_id": current["id"],
        "admin_username": current.get("username"), "created_at": _now_iso()})
    await _audit(current, "settings_changed", reason,
                 before={c["key"]: c["previous"] for c in changes},
                 after={c["key"]: c["new"] for c in changes},
                 extra={"version": new_version})
    return {"ok": True, "changed": changes, "version": new_version}


# ── Export (admin report — logged) ──────────────────────────────────────
@router.get("/centers/{center_id}/export")
async def rc_admin_export(center_id: str, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.export_data")
    c = await _get_center(center_id)
    members = await db.responsibility_center_memberships.find(
        {"center_id": center_id}, {"_id": 0}).to_list(500)
    txns = await db.responsibility_center_transactions.find(
        {"center_id": center_id, "status": "completed"}, {"_id": 0}).to_list(500)
    attempts = await db.responsibility_center_renewal_attempts.find(
        {"center_id": center_id}, {"_id": 0}).to_list(500)
    await _audit(current, "center_exported", "Admin report export", center_id)
    return {"exported_at": _now_iso(), "center": rc._public_center(c),
            "members": members, "transactions": txns, "renewal_attempts": attempts}
