"""Responsibility Center — Bundle D lifecycle engine.

Ownership transfer (two-party, atomic, expiring), ownership recovery,
member departure/removal with open-work handling, owner pause, archive,
restore, safe closure requests with cancellation window + retention
holds, data export, and the lifecycle scheduler pass. Nothing here ever
deletes Center data; closure ends in a locked "closed" state. Fire
Power ledgers, attribution, and audit history are always preserved.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from core.db import db
from services import responsibility_center as rc

log = logging.getLogger("ourrealm.rc.lifecycle")

POST_TRANSFER_ROLES = ["admin", "manager", "member", "leave"]
_IDX = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso() -> str:
    return _now().isoformat()


async def ensure_lifecycle_indexes():
    global _IDX
    if _IDX:
        return
    try:
        await db.responsibility_center_transfers.create_index(
            [("center_id", 1), ("status", 1)], name="c_status")
        await db.responsibility_center_transfers.create_index(
            [("center_id", 1)], unique=True, name="uniq_pending",
            partialFilterExpression={"status": "pending"})
        await db.responsibility_center_recovery_requests.create_index(
            [("center_id", 1), ("status", 1)], name="c_status")
        await db.responsibility_center_lifecycle_audit.create_index(
            [("center_id", 1), ("created_at", -1)], name="c_time")
    except Exception as e:  # noqa: BLE001
        log.warning(f"[rc-lifecycle] index issue: {e}")
    _IDX = True


async def _audit(center_id: str, actor: dict, action: str,
                 before=None, after=None, reason: str = ""):
    """Immutable lifecycle audit row."""
    await db.responsibility_center_lifecycle_audit.insert_one({
        "id": uuid.uuid4().hex, "center_id": center_id,
        "actor_id": actor.get("id"), "actor_username": actor.get("username"),
        "action": action, "reason": (reason or "")[:500],
        "before": before, "after": after, "created_at": _iso()})


async def _owner_membership(center_id: str) -> Optional[dict]:
    return await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "role": "owner", "status": "active"}, {"_id": 0})


async def _require_owner(center_id: str, user: dict):
    center = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0})
    if not center or center.get("status") == "deleted":
        raise HTTPException(status_code=404, detail="Center not found")
    m = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": user["id"], "status": "active"}, {"_id": 0})
    if not m or m.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Only the Center owner can do this")
    return center, m


def _closure(center: dict) -> dict:
    return center.get("closure") or {"status": "none"}


def _block_if_closed(center: dict):
    if center.get("status") == "closed":
        raise HTTPException(status_code=409, detail="This Center is closed")


# ── Lifecycle overview (owner settings panel) ────────────────────────────
async def lifecycle_overview(user: dict, center_id: str) -> dict:
    await ensure_lifecycle_indexes()
    center, membership = await rc._center_and_membership(center_id, user["id"])
    if not membership or membership.get("status") not in ("active", "paused"):
        raise HTTPException(status_code=403, detail="You are not a member of this Center")
    settings = await rc.get_rc_settings()
    owner_m = await _owner_membership(center_id)
    owner_user = None
    if owner_m:
        owner_user = (await rc._users_map([owner_m["user_id"]])).get(owner_m["user_id"])
    transfer = await db.responsibility_center_transfers.find_one(
        {"center_id": center_id, "status": "pending"}, {"_id": 0})
    if transfer:
        users = await rc._users_map([transfer["from_user_id"], transfer["to_user_id"]])
        transfer["from_username"] = (users.get(transfer["from_user_id"]) or {}).get("username")
        transfer["to_username"] = (users.get(transfer["to_user_id"]) or {}).get("username")
    recovery = await db.responsibility_center_recovery_requests.find_one(
        {"center_id": center_id, "status": "pending"}, {"_id": 0})
    open_q = {"center_id": center_id, "is_series": {"$ne": True},
              "status": {"$in": ["assigned", "accepted", "in_progress", "waiting", "blocked",
                                 "submitted", "pending_approval", "changes_requested"]}}
    open_items = await db.responsibility_items.count_documents(open_q)
    my_open = await db.responsibility_items.count_documents({**open_q, "assignee_ids": user["id"]})
    my_approvals = await db.responsibility_items.count_documents(
        {"center_id": center_id, "status": "pending_approval", "approver_id": user["id"]})
    cl = _closure(center)
    return {
        "center": rc._public_center(center),
        "operational_status": center.get("status", "active"),
        "paused_by": center.get("paused_by"),
        "ownership_status": center.get("ownership_status") or ("transfer_pending" if transfer else "stable"),
        "owner": {"user_id": owner_m["user_id"], "username": (owner_user or {}).get("username")} if owner_m else None,
        "pending_transfer": transfer,
        "pending_recovery": bool(recovery),
        "closure": cl,
        "retention_hold": bool(cl.get("retention_hold")),
        "open_items": open_items, "my_open_items": my_open, "my_pending_approvals": my_approvals,
        "member_count": center.get("member_count"),
        "vault_balance": max(0, int(center.get("vault_balance") or 0)),
        "settings": {k: settings[k] for k in
                     ("transfer_expiry_days", "closure_cancel_window_days",
                      "closure_requires_admin_approval", "allow_owner_pause",
                      "allow_owner_archive", "allow_owner_closure", "allow_member_leave")},
        "my_role": membership.get("role"),
        "ownership_history": (center.get("ownership_history") or [])[-10:],
    }


# ── Ownership transfer ───────────────────────────────────────────────────
async def create_transfer(user: dict, center_id: str, to_user_id: str,
                          post_transfer_role: str, note: str = "",
                          confirm_name: str = "") -> dict:
    await ensure_lifecycle_indexes()
    center, _ = await _require_owner(center_id, user)
    _block_if_closed(center)
    if _closure(center).get("status") in ("requested", "review", "approved"):
        raise HTTPException(status_code=409, detail="Cancel the pending closure before transferring ownership")
    if post_transfer_role not in POST_TRANSFER_ROLES:
        raise HTTPException(status_code=400, detail="Invalid post-transfer role")
    if (confirm_name or "").strip() != center["name"]:
        raise HTTPException(status_code=400, detail="Type the exact Center name to confirm")
    if to_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="You already own this Center")
    target_m = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": to_user_id, "status": "active"}, {"_id": 0})
    if not target_m:
        raise HTTPException(status_code=400, detail="The new owner must be an active member of this Center")
    target_user = await db.users.find_one({"id": to_user_id}, {"_id": 0, "id": 1, "username": 1,
                                                               "account_status": 1, "suspended": 1})
    if not target_user or target_user.get("account_status") in ("deleted_pending_restore", "deleted") \
            or target_user.get("suspended"):
        raise HTTPException(status_code=400, detail="That account can't receive ownership right now")
    settings = await rc.get_rc_settings()
    max_centers = int(settings.get("max_centers_per_user") or 0)
    if max_centers:
        owned = await db.responsibility_center_memberships.count_documents(
            {"user_id": to_user_id, "role": "owner", "status": "active"})
        if owned >= max_centers:
            raise HTTPException(status_code=409, detail="That member already owns the maximum number of Centers")
    row = {"id": uuid.uuid4().hex, "center_id": center_id,
           "from_user_id": user["id"], "from_username": user.get("username"),
           "to_user_id": to_user_id, "to_username": target_user.get("username"),
           "post_transfer_role": post_transfer_role, "note": (note or "")[:500],
           "status": "pending", "created_at": _iso(),
           "expires_at": (_now() + timedelta(days=int(settings["transfer_expiry_days"]))).isoformat(),
           "decided_at": None}
    try:
        await db.responsibility_center_transfers.insert_one({**row})
    except Exception:  # noqa: BLE001 — unique pending index
        raise HTTPException(status_code=409, detail="There is already a pending ownership transfer for this Center")
    await db.responsibility_centers.update_one(
        {"id": center_id}, {"$set": {"ownership_status": "transfer_pending"}})
    await _audit(center_id, user, "transfer_requested",
                 after={"to": to_user_id, "post_role": post_transfer_role})
    await rc.log_activity(center_id, user, "ownership_transfer_requested",
                          f"@{user.get('username')} requested an ownership transfer")
    await rc.notify_user(to_user_id, "responsibility_center_transfer_requested",
                         "An ownership action requires your attention in a Responsibility Center.",
                         f"/responsibility-center/{center_id}?tab=settings", center_id,
                         None, user.get("username"))
    return row


async def respond_transfer(user: dict, center_id: str, transfer_id: str, accept: bool) -> dict:
    await ensure_lifecycle_indexes()
    t = await db.responsibility_center_transfers.find_one(
        {"id": transfer_id, "center_id": center_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Transfer request not found")
    if t["to_user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="This transfer is not addressed to you")
    if t["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"This transfer was already {t['status']}")
    if t.get("expires_at") and t["expires_at"] < _iso():
        await _expire_transfer(t)
        raise HTTPException(status_code=409, detail="This transfer request has expired")
    if not accept:
        upd = await db.responsibility_center_transfers.update_one(
            {"id": transfer_id, "status": "pending"},
            {"$set": {"status": "declined", "decided_at": _iso()}})
        if upd.modified_count == 1:
            await db.responsibility_centers.update_one(
                {"id": center_id}, {"$set": {"ownership_status": "stable"}})
            await _audit(center_id, user, "transfer_declined", before={"transfer_id": transfer_id})
            await rc.notify_user(t["from_user_id"], "responsibility_center_transfer_declined",
                                 "Your ownership transfer request was declined.",
                                 f"/responsibility-center/{center_id}?tab=settings", center_id,
                                 None, user.get("username"))
        return {"ok": True, "status": "declined"}
    # ACCEPT — single-winner claim, then atomic role swap with guards.
    claim = await db.responsibility_center_transfers.find_one_and_update(
        {"id": transfer_id, "status": "pending"},
        {"$set": {"status": "accepting", "accepting_at": _iso()}})
    if not claim:
        raise HTTPException(status_code=409, detail="This transfer was already decided")
    return await _execute_transfer(t, actor=user)


async def _execute_transfer(t: dict, actor: dict) -> dict:
    center_id = t["center_id"]

    async def _fail(detail: str):
        await db.responsibility_center_transfers.update_one(
            {"id": t["id"]}, {"$set": {"status": "failed", "decided_at": _iso(),
                                       "failure_detail": detail}})
        await db.responsibility_centers.update_one(
            {"id": center_id}, {"$set": {"ownership_status": "stable"}})
        await _audit(center_id, actor, "transfer_failed", after={"detail": detail})
        raise HTTPException(status_code=409, detail=detail)

    center = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0})
    if not center or center.get("status") in ("deleted", "closed"):
        await _fail("This Center can no longer be transferred")
    new_m = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": t["to_user_id"], "status": "active"}, {"_id": 0})
    if not new_m:
        await _fail("The proposed owner is no longer an active member")
    old_m = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": t["from_user_id"],
         "role": "owner", "status": "active"}, {"_id": 0})
    if not old_m:
        await _fail("The requesting owner no longer owns this Center")
    # Guarded swap: demote old owner ONLY while still owner (prevents 2 owners).
    post_role = t.get("post_transfer_role") or "admin"
    demote = await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": t["from_user_id"], "role": "owner", "status": "active"},
        {"$set": {"role": post_role if post_role != "leave" else "member",
                  "role_changed_at": _iso()}})
    if demote.modified_count != 1:
        await _fail("Ownership changed while processing — no changes were made")
    promote = await db.responsibility_center_memberships.update_one(
        {"center_id": center_id, "user_id": t["to_user_id"], "status": "active",
         "role": {"$ne": "owner"}},
        {"$set": {"role": "owner", "role_changed_at": _iso()}})
    if promote.modified_count != 1:
        # roll the demotion back — never leave a zero-owner Center
        await db.responsibility_center_memberships.update_one(
            {"center_id": center_id, "user_id": t["from_user_id"], "status": "active"},
            {"$set": {"role": "owner"}})
        await _fail("The proposed owner could not be promoted — no changes were made")
    if post_role == "leave":
        await db.responsibility_center_memberships.update_one(
            {"center_id": center_id, "user_id": t["from_user_id"], "status": "active"},
            {"$set": {"status": "left", "left_at": _iso()}})
        await db.responsibility_centers.update_one(
            {"id": center_id, "member_count": {"$gt": 0}}, {"$inc": {"member_count": -1}})
    history_entry = {"from_user_id": t["from_user_id"], "from_username": t.get("from_username"),
                     "to_user_id": t["to_user_id"], "to_username": t.get("to_username"),
                     "transfer_id": t["id"], "at": _iso(), "via": "transfer"}
    await db.responsibility_centers.update_one(
        {"id": center_id},
        {"$set": {"ownership_status": "stable", "owner_user_id": t["to_user_id"],
                  "updated_at": _iso()},
         "$push": {"ownership_history": history_entry}})
    await db.responsibility_center_transfers.update_one(
        {"id": t["id"]}, {"$set": {"status": "accepted", "decided_at": _iso()}})
    # any other lingering requests for this center are voided
    await db.responsibility_center_transfers.update_many(
        {"center_id": center_id, "status": "pending"},
        {"$set": {"status": "canceled", "decided_at": _iso(),
                  "canceled_reason": "superseded by completed transfer"}})
    await _audit(center_id, actor, "transfer_accepted",
                 before={"owner": t["from_user_id"]}, after={"owner": t["to_user_id"],
                                                             "old_owner_role": post_role})
    await rc.log_activity(center_id, actor, "ownership_transferred",
                          f"Ownership transferred to @{t.get('to_username')}")
    for uid, msg in ((t["from_user_id"], "Your ownership transfer was accepted. The Center has a new owner."),
                     (t["to_user_id"], "You are now the owner of this Responsibility Center.")):
        await rc.notify_user(uid, "responsibility_center_transfer_accepted", msg,
                             f"/responsibility-center/{center_id}?tab=settings", center_id, None,
                             actor.get("username"))
    return {"ok": True, "status": "accepted", "new_owner_id": t["to_user_id"]}


async def cancel_transfer(user: dict, center_id: str, transfer_id: str,
                          reason: str = "", as_admin: bool = False) -> dict:
    t = await db.responsibility_center_transfers.find_one(
        {"id": transfer_id, "center_id": center_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Transfer request not found")
    if not as_admin and t["from_user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the requesting owner can cancel this transfer")
    if as_admin and len((reason or "").strip()) < 5:
        raise HTTPException(status_code=400, detail="A written reason is required")
    upd = await db.responsibility_center_transfers.update_one(
        {"id": transfer_id, "status": "pending"},
        {"$set": {"status": "canceled", "decided_at": _iso(),
                  "canceled_reason": (reason or "")[:300]}})
    if upd.modified_count != 1:
        raise HTTPException(status_code=409, detail="This transfer was already decided")
    await db.responsibility_centers.update_one(
        {"id": center_id}, {"$set": {"ownership_status": "stable"}})
    await _audit(center_id, user, "transfer_canceled", before={"transfer_id": transfer_id}, reason=reason)
    await rc.notify_user(t["to_user_id"], "responsibility_center_transfer_canceled",
                         "An ownership transfer addressed to you was canceled.",
                         f"/responsibility-center/{center_id}", center_id, None, user.get("username"))
    return {"ok": True, "status": "canceled"}


async def _expire_transfer(t: dict):
    upd = await db.responsibility_center_transfers.update_one(
        {"id": t["id"], "status": "pending"},
        {"$set": {"status": "expired", "decided_at": _iso()}})
    if upd.modified_count == 1:
        await db.responsibility_centers.update_one(
            {"id": t["center_id"]}, {"$set": {"ownership_status": "stable"}})
        await rc.notify_user(t["from_user_id"], "responsibility_center_transfer_expired",
                             "Your ownership transfer request expired without a response.",
                             f"/responsibility-center/{t['center_id']}?tab=settings",
                             t["center_id"])
        await _audit(t["center_id"], {"id": "system", "username": "system"},
                     "transfer_expired", before={"transfer_id": t["id"]})


# ── Ownership recovery ───────────────────────────────────────────────────
async def request_recovery(user: dict, center_id: str, reason: str) -> dict:
    await ensure_lifecycle_indexes()
    settings = await rc.get_rc_settings()
    if not settings.get("allow_recovery_requests", True):
        raise HTTPException(status_code=409, detail="Ownership recovery requests are disabled")
    center, membership = await rc._center_and_membership(center_id, user["id"])
    if not membership or membership.get("status") != "active" \
            or membership.get("role") not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only an active Center admin or manager can request ownership recovery")
    if len((reason or "").strip()) < 10:
        raise HTTPException(status_code=400, detail="Please describe why recovery is needed (min 10 characters)")
    existing = await db.responsibility_center_recovery_requests.find_one(
        {"center_id": center_id, "status": "pending"}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="A recovery request is already pending review")
    row = {"id": uuid.uuid4().hex, "center_id": center_id,
           "requested_by": user["id"], "requested_by_username": user.get("username"),
           "requester_role": membership.get("role"), "reason": reason.strip()[:1000],
           "status": "pending", "created_at": _iso(), "decided_at": None}
    await db.responsibility_center_recovery_requests.insert_one({**row})
    await db.responsibility_centers.update_one(
        {"id": center_id}, {"$set": {"ownership_status": "recovery_pending"}})
    await _audit(center_id, user, "recovery_requested", after={"request_id": row["id"]}, reason=reason)
    owner_m = await _owner_membership(center_id)
    if owner_m:
        await rc.notify_user(owner_m["user_id"], "responsibility_center_recovery_requested",
                             "An ownership action requires your attention in a Responsibility Center.",
                             f"/responsibility-center/{center_id}?tab=settings", center_id)
    return row


async def admin_decide_recovery(admin: dict, center_id: str, request_id: str,
                                decision: str, reason: str) -> dict:
    if decision not in ("approve", "deny"):
        raise HTTPException(status_code=400, detail="Invalid decision")
    if len((reason or "").strip()) < 5:
        raise HTTPException(status_code=400, detail="A written reason is required")
    req = await db.responsibility_center_recovery_requests.find_one(
        {"id": request_id, "center_id": center_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Recovery request not found")
    upd = await db.responsibility_center_recovery_requests.update_one(
        {"id": request_id, "status": "pending"},
        {"$set": {"status": "approved" if decision == "approve" else "denied",
                  "decided_at": _iso(), "decided_by": admin["id"],
                  "decision_reason": reason.strip()[:500]}})
    if upd.modified_count != 1:
        raise HTTPException(status_code=409, detail="This recovery request was already decided")
    if decision == "deny":
        await db.responsibility_centers.update_one(
            {"id": center_id}, {"$set": {"ownership_status": "stable"}})
        await _audit(center_id, admin, "recovery_denied", reason=reason)
        await rc.notify_user(req["requested_by"], "responsibility_center_recovery_denied",
                             "Your ownership recovery request was reviewed and denied.",
                             f"/responsibility-center/{center_id}", center_id)
        return {"ok": True, "status": "denied"}
    # Approve: transfer ownership to the requester via the same guarded swap.
    old_owner = await _owner_membership(center_id)
    t = {"id": f"recovery-{request_id}", "center_id": center_id,
         "from_user_id": (old_owner or {}).get("user_id"),
         "from_username": None, "to_user_id": req["requested_by"],
         "to_username": req.get("requested_by_username"), "post_transfer_role": "member"}
    if old_owner:
        result = await _execute_transfer_via_recovery(t, admin)
    else:
        # No valid owner exists — promote directly (legacy/broken data path).
        promote = await db.responsibility_center_memberships.update_one(
            {"center_id": center_id, "user_id": req["requested_by"], "status": "active"},
            {"$set": {"role": "owner", "role_changed_at": _iso()}})
        if promote.modified_count != 1:
            raise HTTPException(status_code=409, detail="The requester is no longer an active member")
        await db.responsibility_centers.update_one(
            {"id": center_id},
            {"$set": {"ownership_status": "stable", "owner_user_id": req["requested_by"]},
             "$push": {"ownership_history": {"to_user_id": req["requested_by"],
                                             "via": "recovery", "at": _iso()}}})
        result = {"ok": True, "status": "accepted", "new_owner_id": req["requested_by"]}
    await _audit(center_id, admin, "recovery_approved",
                 after={"new_owner": req["requested_by"]}, reason=reason)
    await rc.notify_user(req["requested_by"], "responsibility_center_recovery_approved",
                         "Your ownership recovery request was approved. You now own this Center.",
                         f"/responsibility-center/{center_id}?tab=settings", center_id)
    return result


async def _execute_transfer_via_recovery(t: dict, admin: dict) -> dict:
    demote = await db.responsibility_center_memberships.update_one(
        {"center_id": t["center_id"], "user_id": t["from_user_id"], "role": "owner"},
        {"$set": {"role": "member", "role_changed_at": _iso()}})
    promote = await db.responsibility_center_memberships.update_one(
        {"center_id": t["center_id"], "user_id": t["to_user_id"], "status": "active",
         "role": {"$ne": "owner"}},
        {"$set": {"role": "owner", "role_changed_at": _iso()}})
    if promote.modified_count != 1:
        if demote.modified_count == 1:
            await db.responsibility_center_memberships.update_one(
                {"center_id": t["center_id"], "user_id": t["from_user_id"]},
                {"$set": {"role": "owner"}})
        raise HTTPException(status_code=409, detail="Recovery promotion failed — no changes were made")
    await db.responsibility_centers.update_one(
        {"id": t["center_id"]},
        {"$set": {"ownership_status": "stable", "owner_user_id": t["to_user_id"]},
         "$push": {"ownership_history": {"from_user_id": t["from_user_id"],
                                         "to_user_id": t["to_user_id"],
                                         "via": "recovery", "at": _iso()}}})
    await rc.log_activity(t["center_id"], admin, "ownership_transferred",
                          "Ownership recovered by administrator review")
    return {"ok": True, "status": "accepted", "new_owner_id": t["to_user_id"]}


# ── Member departure ─────────────────────────────────────────────────────
async def leave_preview(user: dict, center_id: str) -> dict:
    center, membership = await rc._center_and_membership(center_id, user["id"])
    m = rc._require_member(membership)
    open_q = {"center_id": center_id, "is_series": {"$ne": True}, "assignee_ids": user["id"],
              "status": {"$in": ["assigned", "accepted", "in_progress", "waiting", "blocked",
                                 "submitted", "pending_approval", "changes_requested"]}}
    transfer = await db.responsibility_center_transfers.find_one(
        {"center_id": center_id, "status": "pending",
         "$or": [{"from_user_id": user["id"]}, {"to_user_id": user["id"]}]}, {"_id": 0, "id": 1})
    return {
        "center_name": center["name"], "my_role": m.get("role"),
        "open_items": await db.responsibility_items.count_documents(open_q),
        "pending_my_approval": await db.responsibility_items.count_documents(
            {"center_id": center_id, "status": "pending_approval", "approver_id": user["id"]}),
        "seat_paid_until": m.get("seat_paid_until"),
        "blocked_by_transfer": bool(transfer),
        "is_owner": m.get("role") == "owner",
        "notes": ["Your historical work, comments, approvals, and attachments stay attributed to you.",
                  "Rejoining later requires a new invitation and a new active period.",
                  "No previously used Fire Power is returned when you leave."],
    }


async def leave_center_safe(user: dict, center_id: str) -> dict:
    settings = await rc.get_rc_settings()
    if not settings.get("allow_member_leave", True):
        raise HTTPException(status_code=409, detail="Leaving this Center currently requires manager assistance")
    transfer = await db.responsibility_center_transfers.find_one(
        {"center_id": center_id, "status": "pending",
         "$or": [{"from_user_id": user["id"]}, {"to_user_id": user["id"]}]}, {"_id": 0, "id": 1})
    if transfer:
        raise HTTPException(status_code=409, detail="Resolve the pending ownership transfer before leaving")
    result = await rc.leave_center(user, center_id)  # owner check + counts live here
    await _audit(center_id, user, "member_left")
    # notify managers
    async for m in db.responsibility_center_memberships.find(
            {"center_id": center_id, "status": "active", "role": {"$in": ["owner", "admin"]}},
            {"_id": 0, "user_id": 1}):
        await rc.notify_user(m["user_id"], "responsibility_center_member_left",
                             "A member left one of your Responsibility Centers.",
                             f"/responsibility-center/{center_id}", center_id, None,
                             user.get("username"))
    return result


async def remove_member_safe(actor: dict, center_id: str, target_user_id: str,
                             reason: str, work_mode: str = "keep",
                             reassign_to: Optional[str] = None) -> dict:
    if len((reason or "").strip()) < 5:
        raise HTTPException(status_code=400, detail="A written reason is required to remove a member")
    result = await rc.remove_member(actor, center_id, target_user_id)  # perms + rank live here
    await _audit(center_id, actor, "member_removed",
                 before={"user_id": target_user_id}, reason=reason)
    handled = {"mode": work_mode, "items": 0}
    if work_mode in ("unassign", "reassign"):
        handled = await reassign_work(actor, center_id, target_user_id,
                                      reassign_to if work_mode == "reassign" else None,
                                      "reassign" if work_mode == "reassign" else "unassign",
                                      skip_perm_check=True)
    await rc.notify_user(target_user_id, "responsibility_center_member_removed",
                         "Your membership in a Responsibility Center has ended.",
                         "/responsibility-center", center_id)
    return {**result, "work": handled}


async def reassign_work(actor: dict, center_id: str, from_user_id: str,
                        to_user_id: Optional[str], mode: str = "reassign",
                        skip_perm_check: bool = False) -> dict:
    """Bulk open-work handling for departures/removals/transfers."""
    from services import rc_items
    center, membership = await rc._center_and_membership(center_id, actor["id"])
    if not skip_perm_check and not rc.has_permission(membership, "assign_items"):
        raise HTTPException(status_code=403, detail="You don't have permission to reassign work")
    if mode not in ("reassign", "unassign", "cancel"):
        raise HTTPException(status_code=400, detail="Invalid work-handling mode")
    if mode == "reassign":
        if not to_user_id:
            raise HTTPException(status_code=400, detail="Choose who receives the work")
        target = await db.responsibility_center_memberships.find_one(
            {"center_id": center_id, "user_id": to_user_id, "status": "active"}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=400, detail="Work can only be reassigned to an active member of this Center")
    open_statuses = ["assigned", "accepted", "in_progress", "waiting", "blocked",
                     "submitted", "pending_approval", "changes_requested", "draft"]
    count = 0
    async for item in db.responsibility_items.find(
            {"center_id": center_id, "is_series": {"$ne": True},
             "status": {"$in": open_statuses},
             "$or": [{"assignee_ids": from_user_id}, {"approver_id": from_user_id},
                     {"reviewer_id": from_user_id}]}, {"_id": 0}):
        sets, was_assignee = {}, from_user_id in (item.get("assignee_ids") or [])
        if mode == "cancel" and was_assignee:
            await db.responsibility_items.update_one(
                {"id": item["id"], "status": item["status"]},
                {"$set": {"status": "canceled", "updated_at": _iso()}, "$inc": {"version": 1}})
            await rc_items._log(center_id, item["id"], actor, "cancel",
                                {"via": "departure_work_handling"})
            count += 1
            continue
        if was_assignee:
            new_assignees = [u for u in item["assignee_ids"] if u != from_user_id]
            if mode == "reassign" and to_user_id not in new_assignees:
                new_assignees.append(to_user_id)
            sets["assignee_ids"] = new_assignees
            if not new_assignees and item["status"] not in ("draft",):
                sets["status"] = "draft"  # unassigned open work returns to draft pool
        if item.get("approver_id") == from_user_id:
            sets["approver_id"] = to_user_id if mode == "reassign" else None
        if item.get("reviewer_id") == from_user_id:
            sets["reviewer_id"] = to_user_id if mode == "reassign" else None
        if not sets:
            continue
        sets["updated_at"] = _iso()
        await db.responsibility_items.update_one({"id": item["id"]},
                                                 {"$set": sets, "$inc": {"version": 1}})
        await rc_items._log(center_id, item["id"], actor, "reassigned",
                            {"from": from_user_id, "to": to_user_id, "via": "work_handling"})
        if mode == "reassign" and was_assignee:
            await rc_items._notify_item(to_user_id, "responsibility_center_item_assigned",
                                        f"Work was reassigned to you in \"{center['name']}\".",
                                        center_id, item["id"], actor)
        count += 1
    # recurring series managed by the departing member
    await db.responsibility_items.update_many(
        {"center_id": center_id, "is_series": True, "assignee_ids": from_user_id},
        {"$pull": {"assignee_ids": from_user_id}})
    if mode == "reassign":
        await db.responsibility_items.update_many(
            {"center_id": center_id, "is_series": True, "assignee_ids": {"$size": 0}},
            {"$set": {"assignee_ids": [to_user_id]}})
    await _audit(center_id, actor, "work_reassigned",
                 after={"from": from_user_id, "to": to_user_id, "mode": mode, "items": count})
    return {"mode": mode, "items": count}


# ── Pause / archive / restore ────────────────────────────────────────────
async def pause_center(user: dict, center_id: str, reason: str = "") -> dict:
    settings = await rc.get_rc_settings()
    if not settings.get("allow_owner_pause", True):
        raise HTTPException(status_code=409, detail="Owner pause is currently disabled")
    center, _ = await _require_owner(center_id, user)
    _block_if_closed(center)
    upd = await db.responsibility_centers.update_one(
        {"id": center_id, "status": "active"},
        {"$set": {"status": "paused", "paused_by": "owner", "paused_at": _iso(),
                  "paused_reason": (reason or "")[:300], "updated_at": _iso()}})
    if upd.modified_count != 1:
        raise HTTPException(status_code=409, detail=f"This Center is already {center.get('status')}")
    await _audit(center_id, user, "center_paused", before={"status": "active"},
                 after={"status": "paused"}, reason=reason)
    await rc.log_activity(center_id, user, "center_paused",
                          f"@{user.get('username')} paused the Center")
    await _notify_members(center_id, "responsibility_center_center_paused",
                          "A Responsibility Center you belong to was paused by its owner. All records are preserved.",
                          exclude=user["id"])
    return {"ok": True, "status": "paused"}


async def archive_center(user: dict, center_id: str, confirm_name: str, reason: str = "") -> dict:
    settings = await rc.get_rc_settings()
    if not settings.get("allow_owner_archive", True):
        raise HTTPException(status_code=409, detail="Owner archive is currently disabled")
    center, _ = await _require_owner(center_id, user)
    _block_if_closed(center)
    if (confirm_name or "").strip() != center["name"]:
        raise HTTPException(status_code=400, detail="Type the exact Center name to confirm archiving")
    upd = await db.responsibility_centers.update_one(
        {"id": center_id, "status": {"$in": ["active", "paused"]}},
        {"$set": {"status": "archived", "archived_at": _iso(), "archived_by": user["id"],
                  "archived_reason": (reason or "")[:300], "updated_at": _iso()}})
    if upd.modified_count != 1:
        raise HTTPException(status_code=409, detail=f"This Center is already {center.get('status')}")
    await _audit(center_id, user, "center_archived", before={"status": center.get("status")},
                 after={"status": "archived"}, reason=reason)
    await rc.log_activity(center_id, user, "center_archived",
                          f"@{user.get('username')} archived the Center")
    await _notify_members(center_id, "responsibility_center_center_archived",
                          "A Responsibility Center you belong to was archived. All records are preserved and it can be restored.",
                          exclude=user["id"])
    return {"ok": True, "status": "archived"}


async def restore_center(user: dict, center_id: str, as_admin: bool = False,
                         reason: str = "") -> dict:
    center = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0})
    if not center:
        raise HTTPException(status_code=404, detail="Center not found")
    if not as_admin:
        await _require_owner(center_id, user)
    _block_if_closed(center)
    cl = _closure(center)
    if cl.get("retention_hold"):
        raise HTTPException(status_code=409, detail="This Center is under a retention hold and cannot be restored")
    if cl.get("status") in ("requested", "review", "approved"):
        raise HTTPException(status_code=409, detail="Cancel the pending closure before restoring")
    if not await _owner_membership(center_id):
        raise HTTPException(status_code=409, detail="This Center has no valid active owner — request ownership recovery first")
    upd = await db.responsibility_centers.update_one(
        {"id": center_id, "status": {"$in": ["paused", "archived"]}},
        {"$set": {"status": "active", "restored_at": _iso(), "updated_at": _iso()},
         "$unset": {"paused_by": "", "paused_reason": ""}})
    if upd.modified_count != 1:
        return {"ok": True, "status": center.get("status"), "idempotent": True}
    await _audit(center_id, user, "center_restored",
                 before={"status": center.get("status")}, after={"status": "active"}, reason=reason)
    await rc.log_activity(center_id, user, "center_restored",
                          f"@{user.get('username')} restored the Center")
    await _notify_members(center_id, "responsibility_center_center_restored",
                          "A Responsibility Center you belong to is active again.",
                          exclude=user["id"])
    return {"ok": True, "status": "active"}


async def _notify_members(center_id: str, kind: str, message: str, exclude: Optional[str] = None):
    async for m in db.responsibility_center_memberships.find(
            {"center_id": center_id, "status": "active"}, {"_id": 0, "user_id": 1}):
        if m["user_id"] != exclude:
            await rc.notify_user(m["user_id"], kind, message,
                                 f"/responsibility-center/{center_id}", center_id)


# ── Safe closure ─────────────────────────────────────────────────────────
async def request_closure(user: dict, center_id: str, confirm_name: str,
                          confirm_phrase: str, reason: str) -> dict:
    settings = await rc.get_rc_settings()
    if not settings.get("allow_owner_closure", True):
        raise HTTPException(status_code=409, detail="Owner closure requests are currently disabled")
    center, _ = await _require_owner(center_id, user)
    _block_if_closed(center)
    cl = _closure(center)
    if cl.get("status") in ("requested", "review", "approved"):
        raise HTTPException(status_code=409, detail="A closure request is already in progress")
    if (confirm_name or "").strip() != center["name"]:
        raise HTTPException(status_code=400, detail="Type the exact Center name to confirm")
    if (confirm_phrase or "").strip().upper() != "CLOSE THIS CENTER":
        raise HTTPException(status_code=400, detail='Type the phrase "CLOSE THIS CENTER" to confirm')
    if len((reason or "").strip()) < 5:
        raise HTTPException(status_code=400, detail="Please share a closure reason")
    transfer = await db.responsibility_center_transfers.find_one(
        {"center_id": center_id, "status": "pending"}, {"_id": 0, "id": 1})
    if transfer:
        raise HTTPException(status_code=409, detail="Resolve the pending ownership transfer first")
    needs_review = bool(settings.get("closure_requires_admin_approval", True))
    deadline = (_now() + timedelta(days=int(settings["closure_cancel_window_days"]))).isoformat()
    closure = {"status": "review" if needs_review else "requested",
               "requested_at": _iso(), "requested_by": user["id"],
               "reason": reason.strip()[:500], "cancellation_deadline": deadline,
               "prior_status": center.get("status", "active"),
               "retention_hold": False, "approved_at": None, "approved_by": None,
               "final_vault_balance": None, "completed_at": None}
    sets = {"closure": closure, "updated_at": _iso()}
    if center.get("status") == "active":
        sets.update(status="paused", paused_by="closure", paused_at=_iso())
    if settings.get("freeze_vault_on_closure", True):
        sets["vault_frozen"] = True
    guard = {"id": center_id, "$or": [{"closure.status": {"$exists": False}},
                                      {"closure.status": {"$in": ["none", "canceled", "denied"]}}]}
    upd = await db.responsibility_centers.update_one(guard, {"$set": sets})
    if upd.modified_count != 1:
        raise HTTPException(status_code=409, detail="A closure request is already in progress")
    await _audit(center_id, user, "closure_requested",
                 after={"deadline": deadline, "needs_review": needs_review}, reason=reason)
    await rc.log_activity(center_id, user, "closure_requested",
                          f"@{user.get('username')} requested to close the Center")
    await _notify_members(center_id, "responsibility_center_closure_requested",
                          "The owner has requested to close a Responsibility Center you belong to. Records are preserved during review.",
                          exclude=user["id"])
    return {"ok": True, "closure": closure}


async def cancel_closure(user: dict, center_id: str, as_admin: bool = False,
                         reason: str = "") -> dict:
    center = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0})
    if not center:
        raise HTTPException(status_code=404, detail="Center not found")
    if not as_admin:
        await _require_owner(center_id, user)
    cl = _closure(center)
    if cl.get("status") not in ("requested", "review", "approved"):
        raise HTTPException(status_code=409, detail="There is no cancelable closure request")
    if cl.get("retention_hold") and not as_admin:
        raise HTTPException(status_code=409, detail="A retention hold prevents canceling this closure — contact support")
    prior = cl.get("prior_status") or "active"
    upd = await db.responsibility_centers.update_one(
        {"id": center_id, "closure.status": cl["status"]},
        {"$set": {"closure.status": "canceled", "closure.canceled_at": _iso(),
                  "status": prior if center.get("paused_by") == "closure" else center.get("status"),
                  "vault_frozen": False, "updated_at": _iso()},
         "$unset": ({"paused_by": "", "paused_reason": ""}
                    if center.get("paused_by") == "closure" else {"_none": ""})})
    if upd.modified_count != 1:
        raise HTTPException(status_code=409, detail="The closure state changed — refresh and try again")
    await _audit(center_id, user, "closure_canceled", before={"closure": cl["status"]}, reason=reason)
    await _notify_members(center_id, "responsibility_center_closure_canceled",
                          "The closure request for a Responsibility Center you belong to was canceled.",
                          exclude=user["id"])
    return {"ok": True, "closure_status": "canceled"}


async def admin_decide_closure(admin: dict, center_id: str, decision: str, reason: str) -> dict:
    if decision not in ("approve", "deny"):
        raise HTTPException(status_code=400, detail="Invalid decision")
    if len((reason or "").strip()) < 5:
        raise HTTPException(status_code=400, detail="A written reason is required")
    center = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0})
    cl = _closure(center or {})
    if cl.get("status") not in ("requested", "review"):
        raise HTTPException(status_code=409, detail="No closure request is awaiting review")
    if decision == "deny":
        return await cancel_closure(admin, center_id, as_admin=True,
                                    reason=f"denied by admin: {reason}")
    upd = await db.responsibility_centers.update_one(
        {"id": center_id, "closure.status": cl["status"]},
        {"$set": {"closure.status": "approved", "closure.approved_at": _iso(),
                  "closure.approved_by": admin["id"]}})
    if upd.modified_count != 1:
        raise HTTPException(status_code=409, detail="The closure state changed — refresh and try again")
    await _audit(center_id, admin, "closure_approved", reason=reason)
    owner_m = await _owner_membership(center_id)
    if owner_m:
        await rc.notify_user(owner_m["user_id"], "responsibility_center_closure_approved",
                             "Your Center closure request was approved. It completes after the cancellation window unless you cancel.",
                             f"/responsibility-center/{center_id}?tab=settings", center_id)
    return {"ok": True, "closure_status": "approved"}


async def set_retention_hold(admin: dict, center_id: str, hold: bool, reason: str) -> dict:
    if len((reason or "").strip()) < 5:
        raise HTTPException(status_code=400, detail="A written reason is required")
    await db.responsibility_centers.update_one(
        {"id": center_id},
        {"$set": {"closure.retention_hold": bool(hold),
                  "closure.retention_hold_reason": reason.strip()[:300] if hold else None,
                  "closure.retention_hold_by": admin["id"] if hold else None,
                  "closure.retention_hold_at": _iso() if hold else None}})
    await _audit(center_id, admin, "retention_hold_set" if hold else "retention_hold_removed", reason=reason)
    return {"ok": True, "retention_hold": bool(hold)}


async def _complete_closure(center: dict):
    cl = _closure(center)
    final_balance = max(0, int(center.get("vault_balance") or 0))
    upd = await db.responsibility_centers.update_one(
        {"id": center["id"], "closure.status": cl["status"], "status": {"$ne": "closed"}},
        {"$set": {"status": "closed", "closure.status": "completed",
                  "closure.completed_at": _iso(),
                  "closure.final_vault_balance": final_balance,
                  "vault_frozen": True, "updated_at": _iso()}})
    if upd.modified_count != 1:
        return False
    await _audit(center["id"], {"id": "system", "username": "system"}, "center_closed",
                 after={"final_vault_balance": final_balance,
                        "retained": "All records retained in a locked closed state — "
                                    "Fire Power ledger, memberships, work history, audit trails. "
                                    "No data was deleted."})
    await _notify_members(center["id"], "responsibility_center_center_closed",
                          "A Responsibility Center you belonged to is now closed. Historical records are preserved.")
    return True


# ── Data export (owner) ──────────────────────────────────────────────────
async def export_center(user: dict, center_id: str, as_admin: bool = False) -> dict:
    center = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0})
    if not center:
        raise HTTPException(status_code=404, detail="Center not found")
    if not as_admin:
        m = await db.responsibility_center_memberships.find_one(
            {"center_id": center_id, "user_id": user["id"], "status": "active",
             "role": {"$in": ["owner", "admin"]}}, {"_id": 0})
        if not m:
            raise HTTPException(status_code=403, detail="Only the owner or a Center admin can export Center data")
    if center.get("exports_locked") and not as_admin:
        raise HTTPException(status_code=409, detail="Exports are temporarily locked for this Center")

    async def rows(coll, q, limit=2000, sort=("created_at", 1)):
        return await db[coll].find(q, {"_id": 0}).sort([sort]).to_list(limit)

    members = await rows("responsibility_center_memberships", {"center_id": center_id})
    users = await rc._users_map([m["user_id"] for m in members])
    for m in members:
        m["username"] = (users.get(m["user_id"]) or {}).get("username")
    export = {
        "exported_at": _iso(), "exported_by": user.get("username"),
        "center": {k: v for k, v in center.items() if k not in ("needs_review",)},
        "members": members,
        "items": await rows("responsibility_items", {"center_id": center_id}),
        "comments": await rows("responsibility_item_comments", {"center_id": center_id}),
        "approvals": await rows("responsibility_item_approvals", {"center_id": center_id}),
        "item_activity": await rows("responsibility_item_activity", {"center_id": center_id}),
        "activity": await rows("responsibility_center_activity_logs", {"center_id": center_id}),
        "vault_transactions": await rows("responsibility_center_transactions", {"center_id": center_id}),
        "renewal_attempts": await rows("responsibility_center_renewal_attempts", {"center_id": center_id}),
        "ownership_transfers": await rows("responsibility_center_transfers", {"center_id": center_id}),
        "lifecycle_audit": await rows("responsibility_center_lifecycle_audit", {"center_id": center_id}),
    }
    await _audit(center_id, user, "data_exported",
                 after={"sections": list(export.keys())})
    return export


# ── Scheduler pass ───────────────────────────────────────────────────────
async def run_lifecycle_pass() -> dict:
    """Expire stale transfers + complete approved closures past their
    cancellation window. Idempotent; guarded conditional updates."""
    await ensure_lifecycle_indexes()
    now_iso = _iso()
    expired = 0
    stale = await db.responsibility_center_transfers.find(
        {"status": "pending", "expires_at": {"$lt": now_iso}}, {"_id": 0}).to_list(100)
    for t in stale:
        await _expire_transfer(t)
        expired += 1
    closed = 0
    ready_status = ["approved", "requested"]  # "requested" only when admin approval disabled
    settings = await rc.get_rc_settings()
    if settings.get("closure_requires_admin_approval", True):
        ready_status = ["approved"]
    for c in await db.responsibility_centers.find(
            {"closure.status": {"$in": ready_status},
             "closure.cancellation_deadline": {"$lt": now_iso},
             "closure.retention_hold": {"$ne": True},
             "status": {"$ne": "closed"}}, {"_id": 0}).to_list(50):
        if await _complete_closure(c):
            closed += 1
    return {"transfers_expired": expired, "closures_completed": closed}
