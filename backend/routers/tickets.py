"""Phase B — Support tickets (extends the existing MongoDB messenger).

A ticket is created on a user's FIRST DM to @support and is then attached
to that conversation. Status changes from the admin dashboard trigger an
auto-message back into the same thread.

Endpoints:
  POST  /api/tickets/ensure              ensure a ticket exists for current user
  GET   /api/tickets/me                  current user's tickets
  GET   /api/admin/support/summary       admin: status totals
  GET   /api/admin/support/tickets       admin: list with filter
  POST  /api/admin/support/tickets/{id}  admin: change status / subject
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from core.db import db
from core.deps import CurrentUser, require_admin
from core.permissions import (
    require_support_access,
    ROLE_FOUNDER,
    ROLE_SUPPORT_ADMIN,
    ROLE_MODERATOR,
)


router = APIRouter(tags=["support"])

STATUSES = ("Submitted", "In Progress", "Completed", "Incomplete")

STATUS_MESSAGES = {
    "Submitted":   "Your support ticket #{n} has been submitted. We'll be in touch shortly.",
    "In Progress": "Your support ticket #{n} has been marked In Progress. Our team will continue working with you in this conversation.",
    "Completed":   "Your support ticket #{n} has been marked Completed and closed.",
    "Incomplete":  "Your support ticket #{n} requires additional information. Please reply to continue.",
}


def _require_admin(user: dict) -> None:
    # Phase α — tickets are gated by the support-access permission (founder
    # and support_admin). Keeps the legacy require_admin import valid for
    # any unrelated helpers still relying on the loose gate.
    require_support_access(user)


async def _support_user() -> Optional[dict]:
    return await db.users.find_one({"username": "support"}, {"_id": 0})


def _conv_id(a: str, b: str) -> str:
    return ":".join(sorted([a, b]))


async def _next_ticket_number() -> int:
    """Atomically reserve the next ticket number using a Mongo counter doc.

    `db.counters` holds `{_id: 'tickets', seq: <int>}`. A single
    `find_one_and_update` with `$inc` is race-free, so concurrent ticket
    creations can never collide on `ticket_number` even under load.
    Seed seq=1000 the first time so the first ticket is #1001 (matches
    the legacy max+1 behaviour exactly).
    """
    doc = await db.counters.find_one_and_update(
        {"_id": "tickets"},
        {"$inc": {"seq": 1}, "$setOnInsert": {"_id": "tickets"}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = int(doc.get("seq") or 0)
    # First-ever call returns seq=1 → bump baseline to 1001 to honour the
    # documented #1001 starting number AND skip any IDs already in use.
    if seq < 1001:
        max_existing = 1000
        last = await db.tickets.find_one({}, sort=[("ticket_number", -1)])
        if last and last.get("ticket_number"):
            max_existing = max(max_existing, int(last["ticket_number"]))
        next_seq = max_existing + 1
        await db.counters.update_one(
            {"_id": "tickets"}, {"$set": {"seq": next_seq}}, upsert=True
        )
        return next_seq
    return seq


async def _send_support_message(*, support_id: str, user_id: str, text: str) -> None:
    """Write a system DM from @support to the user using the existing
    `messages` collection schema (matches routers/messages.py)."""
    now = datetime.now(timezone.utc).isoformat()
    await db.messages.insert_one({
        "id": uuid.uuid4().hex,
        "conv_id": _conv_id(support_id, user_id),
        "from_user_id": support_id,
        "to_user_id":   user_id,
        "text": text,
        "delivered_at": now,
        "read_at": None,
        "created_at": now,
        "edited_at": None,
        "moderation_status": "approved",
    })


class EnsurePayload(BaseModel):
    subject: Optional[str] = Field(default=None, max_length=120)
    # Phase α — optional category. Accepts EITHER the category id OR the
    # immutable `key` (e.g. "bug_report"). Validated against the
    # `ticket_categories` collection — invalid values are silently dropped
    # so older clients without the picker continue to work unchanged.
    category_id:  Optional[str] = Field(default=None, max_length=64)
    category_key: Optional[str] = Field(default=None, max_length=40)


async def _resolve_category(payload: EnsurePayload) -> Optional[dict]:
    """Look up the category from id or key. Returns None if neither was
    provided OR the value doesn't match an enabled category."""
    q: Optional[dict] = None
    if payload.category_id:
        q = {"id": payload.category_id, "is_enabled": True}
    elif payload.category_key:
        q = {"key": payload.category_key.lower(), "is_enabled": True}
    if not q:
        return None
    return await db.ticket_categories.find_one(q, {"_id": 0})


@router.post("/api/tickets/ensure")
async def ensure_ticket(payload: EnsurePayload, current: CurrentUser):
    """Idempotent. Returns the existing ticket for the user's @support
    conversation OR creates a new one with status='Submitted'.
    Triggered by the /profile/support button before the user types."""
    support = await _support_user()
    if not support:
        raise HTTPException(status_code=503, detail="Support account not provisioned")

    conv_id = _conv_id(support["id"], current["id"])
    existing = await db.tickets.find_one(
        {"conv_id": conv_id, "status": {"$ne": "Completed"}},
        {"_id": 0},
    )
    if existing:
        return {"ticket": existing, "created": False, "support": {"id": support["id"], "username": "support"}}

    now = datetime.now(timezone.utc).isoformat()
    number = await _next_ticket_number()
    subject = (payload.subject or "Support request").strip()[:100] or "Support request"
    category = await _resolve_category(payload)
    ticket = {
        "id":                uuid.uuid4().hex,
        "ticket_number":     number,
        "user_id":           current["id"],
        "username":          current.get("username"),
        "conv_id":           conv_id,
        "subject":           subject,
        "preview":           subject[:240],
        "status":            "Submitted",
        "assignee_id":       None,
        "assignee_username": None,
        "category_id":       (category or {}).get("id"),
        "category_key":      (category or {}).get("key"),
        "category_label":    (category or {}).get("label"),
        "created_at":        now,
        "updated_at":        now,
    }
    await db.tickets.insert_one(ticket)
    ticket.pop("_id", None)
    await _send_support_message(
        support_id=support["id"],
        user_id=current["id"],
        text=STATUS_MESSAGES["Submitted"].format(n=number),
    )
    return {"ticket": ticket, "created": True, "support": {"id": support["id"], "username": "support"}}


@router.get("/api/tickets/me")
async def my_tickets(current: CurrentUser):
    cursor = db.tickets.find({"user_id": current["id"]}, {"_id": 0}).sort("created_at", -1)
    return {"tickets": [t async for t in cursor]}


@router.get("/api/admin/support/summary")
async def admin_summary(current: CurrentUser):
    _require_admin(current)
    total = await db.tickets.count_documents({})
    by_status = {}
    for s in STATUSES:
        by_status[s] = await db.tickets.count_documents({"status": s})
    return {"total": total, **by_status}


@router.get("/api/admin/support/tickets")
async def admin_list(
    current: CurrentUser,
    status: Optional[str] = None,
    category_key: Optional[str] = None,
    assignee_id: Optional[str] = None,
    limit: int = 100,
):
    _require_admin(current)
    q: dict = {}
    if status and status in STATUSES:
        q["status"] = status
    if category_key:
        q["category_key"] = category_key.lower()
    if assignee_id is not None:
        # Special sentinel "none" / "" → tickets with no assignee.
        if assignee_id in ("", "none", "unassigned"):
            q["assignee_id"] = None
        else:
            q["assignee_id"] = assignee_id
    cursor = db.tickets.find(q, {"_id": 0}).sort("updated_at", -1).limit(min(max(1, limit), 500))
    return {"tickets": [t async for t in cursor]}


@router.get("/api/admin/support/assignable")
async def admin_assignable(current: CurrentUser):
    """Phase α — list of users eligible to be assigned a support ticket.

    Eligibility: any user with an admin role of `founder`, `support_admin`,
    or `moderator`. The username safety net for `@stealth` / `@support`
    in `core.permissions.get_admin_role` is mirrored here so a partially-
    seeded DB still surfaces the founder + support_admin in the picker.
    """
    _require_admin(current)
    # Primary query — anyone whose admin_role is in the allow-list.
    q = {
        "admin_role": {"$in": [ROLE_FOUNDER, ROLE_SUPPORT_ADMIN, ROLE_MODERATOR]},
        "disabled":   {"$ne": True},
        "account_status": {"$ne": "deleted_pending_restore"},
    }
    cursor = db.users.find(
        q,
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "admin_role": 1, "avatar_url": 1},
    )
    assignable: list[dict] = []
    seen_ids: set[str] = set()
    async for u in cursor:
        if not u.get("id"):
            continue
        seen_ids.add(u["id"])
        assignable.append({
            "id":           u["id"],
            "username":     u.get("username"),
            "display_name": u.get("display_name") or u.get("username"),
            "admin_role":   u.get("admin_role"),
            "avatar_url":   u.get("avatar_url"),
        })
    # Safety-net fallback: ensure @stealth (founder) + @support (support_admin)
    # always appear even if `admin_role` was never written to the row.
    for uname, role in (("stealth", ROLE_FOUNDER), ("support", ROLE_SUPPORT_ADMIN)):
        u = await db.users.find_one(
            {"username": uname, "disabled": {"$ne": True}},
            {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
        )
        if u and u.get("id") and u["id"] not in seen_ids:
            seen_ids.add(u["id"])
            assignable.append({
                "id":           u["id"],
                "username":     u.get("username"),
                "display_name": u.get("display_name") or u.get("username"),
                "admin_role":   role,
                "avatar_url":   u.get("avatar_url"),
            })
    # Stable ordering: founders first, then support_admins, then moderators,
    # alpha by username inside each tier.
    role_rank = {ROLE_FOUNDER: 0, ROLE_SUPPORT_ADMIN: 1, ROLE_MODERATOR: 2}
    assignable.sort(key=lambda r: (
        role_rank.get(r.get("admin_role") or "", 99),
        (r.get("username") or "").lower(),
    ))
    return {"assignable": assignable}


class TicketUpdate(BaseModel):
    status:       Optional[str] = None
    subject:      Optional[str] = None
    category_id:  Optional[str] = None
    category_key: Optional[str] = None
    # Phase α — per-ticket assignee picker.
    #   value = "<user_id>" → assign to that user (must be an admin role).
    #   value = ""           → unassign (clear assignee).
    #   value omitted        → leave assignee untouched.
    # `None` (JSON null) is treated identically to "" so callers can use
    # either convention.
    assignee_id:  Optional[str] = None

    model_config = {"extra": "ignore"}


@router.post("/api/admin/support/tickets/{ticket_id}")
async def admin_update(ticket_id: str, payload: TicketUpdate, current: CurrentUser):
    _require_admin(current)
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    set_ops: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    notify_status: Optional[str] = None
    fields_set = payload.model_dump(exclude_unset=True)

    if payload.status is not None:
        if payload.status not in STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of {STATUSES}")
        if payload.status != ticket["status"]:
            set_ops["status"] = payload.status
            notify_status = payload.status

    if payload.subject is not None:
        set_ops["subject"] = payload.subject.strip()[:100]

    if payload.category_id is not None or payload.category_key is not None:
        q: dict = {}
        if payload.category_id:
            q = {"id": payload.category_id}
        elif payload.category_key:
            q = {"key": payload.category_key.lower()}
        if q:
            cat = await db.ticket_categories.find_one(q, {"_id": 0})
            if not cat:
                raise HTTPException(status_code=400, detail="Unknown category")
            set_ops["category_id"]    = cat["id"]
            set_ops["category_key"]   = cat["key"]
            set_ops["category_label"] = cat["label"]

    # Per-ticket assignee — only mutate when the field was explicitly
    # included in the request body (treats omitted vs null distinctly).
    if "assignee_id" in fields_set:
        aid = payload.assignee_id
        if not aid:
            # Empty string OR JSON null → unassign.
            set_ops["assignee_id"]       = None
            set_ops["assignee_username"] = None
        else:
            assignee = await db.users.find_one(
                {"id": aid, "disabled": {"$ne": True}},
                {"_id": 0, "id": 1, "username": 1, "admin_role": 1},
            )
            if not assignee:
                raise HTTPException(status_code=400, detail="Unknown assignee user")
            # Must be an admin role (founder / support_admin / moderator).
            from core.permissions import get_admin_role
            if not get_admin_role(assignee):
                raise HTTPException(status_code=400, detail="Assignee must be an admin user")
            set_ops["assignee_id"]       = assignee["id"]
            set_ops["assignee_username"] = assignee.get("username")

    await db.tickets.update_one({"id": ticket_id}, {"$set": set_ops})

    if notify_status:
        support = await _support_user()
        if support:
            await _send_support_message(
                support_id=support["id"],
                user_id=ticket["user_id"],
                text=STATUS_MESSAGES[notify_status].format(n=ticket["ticket_number"]),
            )

    fresh = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    return {"ok": True, "ticket": fresh}


@router.get("/api/admin/support/tickets/{ticket_id}/report")
async def admin_report_details(ticket_id: str, current: CurrentUser):
    """Phase 4 — return the linked report (metadata + screenshot URLs) for
    a ticket that was opened via /api/reports. Returns 404 if the ticket
    is a plain user-initiated ticket (no `report_id`).

    PRIVACY: for `report_type == 'message'` we expose ONLY the report
    metadata (reason, description, screenshots the reporter uploaded) and
    the message-id/conv-id used as the report target. The actual message
    body is never fetched or returned by this endpoint.
    """
    _require_admin(current)
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    rep_id = ticket.get("report_id")
    if not rep_id:
        raise HTTPException(status_code=404, detail="Ticket has no linked report")
    rep = await db.reports.find_one({"id": rep_id}, {"_id": 0})
    if not rep:
        raise HTTPException(status_code=404, detail="Report record missing")

    # Resolve screenshot image ids → public URLs.
    screenshots = []
    for img_id in (rep.get("screenshots") or [])[:8]:
        img = await db.images.find_one({"id": img_id}, {"_id": 0, "original_url": 1, "thumbnail_url": 1})
        if img:
            screenshots.append({
                "id":            img_id,
                "url":           img.get("original_url"),
                "thumbnail_url": img.get("thumbnail_url"),
            })

    return {
        "ticket":      ticket,
        "report": {
            "id":           rep["id"],
            "reason":       rep.get("reason"),
            "detail":       rep.get("detail"),
            "content_type": rep.get("content_type"),
            "content_id":   rep.get("content_id"),
            "created_at":   rep.get("created_at"),
            "screenshots":  screenshots,
        },
    }
