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

from core.db import db
from core.deps import CurrentUser


router = APIRouter(tags=["support"])

STATUSES = ("Submitted", "In Progress", "Completed", "Incomplete")

STATUS_MESSAGES = {
    "Submitted":   "Your support ticket #{n} has been submitted. We'll be in touch shortly.",
    "In Progress": "Your support ticket #{n} has been marked In Progress. Our team will continue working with you in this conversation.",
    "Completed":   "Your support ticket #{n} has been marked Completed and closed.",
    "Incomplete":  "Your support ticket #{n} requires additional information. Please reply to continue.",
}


def _require_admin(user: dict) -> None:
    if not ((user.get("username") or "").lower() == "stealth" or user.get("is_founder")):
        raise HTTPException(status_code=403, detail="Admin only")


async def _support_user() -> Optional[dict]:
    return await db.users.find_one({"username": "support"}, {"_id": 0})


def _conv_id(a: str, b: str) -> str:
    return ":".join(sorted([a, b]))


async def _next_ticket_number() -> int:
    # Simple monotonic counter from existing max + 1. Single-writer admin
    # context, so race is not a concern.
    last = await db.tickets.find_one({}, sort=[("ticket_number", -1)])
    return int(last["ticket_number"]) + 1 if last and last.get("ticket_number") else 1001


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
    ticket = {
        "id":             uuid.uuid4().hex,
        "ticket_number":  number,
        "user_id":        current["id"],
        "username":       current.get("username"),
        "conv_id":        conv_id,
        "subject":        subject,
        "preview":        subject[:240],
        "status":         "Submitted",
        "assignee_id":    None,
        "created_at":     now,
        "updated_at":     now,
    }
    await db.tickets.insert_one(ticket)
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
async def admin_list(current: CurrentUser, status: Optional[str] = None, limit: int = 100):
    _require_admin(current)
    q: dict = {}
    if status and status in STATUSES:
        q["status"] = status
    cursor = db.tickets.find(q, {"_id": 0}).sort("updated_at", -1).limit(min(max(1, limit), 500))
    return {"tickets": [t async for t in cursor]}


class TicketUpdate(BaseModel):
    status:  Optional[str] = None
    subject: Optional[str] = None


@router.post("/api/admin/support/tickets/{ticket_id}")
async def admin_update(ticket_id: str, payload: TicketUpdate, current: CurrentUser):
    _require_admin(current)
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    set_ops: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    notify_status: Optional[str] = None

    if payload.status is not None:
        if payload.status not in STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of {STATUSES}")
        if payload.status != ticket["status"]:
            set_ops["status"] = payload.status
            notify_status = payload.status

    if payload.subject is not None:
        set_ops["subject"] = payload.subject.strip()[:100]

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
