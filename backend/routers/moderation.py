"""Moderation admin endpoints + user report endpoint.

  POST /api/reports                           (any logged-in user)
  GET  /api/admin/moderation/summary          (@stealth only)
  GET  /api/admin/moderation/queue            (@stealth only)
  POST /api/admin/moderation/{ct}/{id}/action (@stealth only)
  GET  /api/admin/moderation/removed          (@stealth only)
  GET  /api/admin/moderation/log              (@stealth only)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser, require_admin
from core.permissions import require_moderation_access
from services.moderation import (
    REASONS, STATUS_APPROVED, STATUS_HIDDEN, STATUS_PENDING_REVIEW,
    STATUS_REJECTED, log_action, scan_content,
)


router = APIRouter(tags=["moderation"])

CONTENT_TYPES = {"post": "posts", "comment": "comments", "profile": "users",
                 "image": "images", "video": "videos",
                 # Phase B/4 — replies are stored in the same `comments`
                 # collection (distinguished by `parent_id`). Messages get
                 # special privacy treatment — see submit_report below.
                 "reply": "comments", "message": "messages"}


# Extended reason set (Phase 4 — Universal Reporting). Mirrors the
# frontend ReportModal list. The historical services.moderation.REASONS
# is still authoritative for the rule-based scanner; this set is what
# users can choose from when filing a manual report.
USER_REPORT_REASONS = {
    "spam", "harassment", "hate_speech", "sexual_content", "self_harm",
    "violence", "misinformation", "scam_fraud", "impersonation",
    "privacy_concern", "copyright", "other",
}


def _require_admin(user: dict) -> None:
    # Phase α — moderation endpoints are gated by the moderation-access
    # permission (founder + support_admin + moderator). Keeps the legacy
    # require_admin import valid for any helpers still relying on it.
    require_moderation_access(user)


# ─── User-facing report endpoint ──────────────────────────────────────
class ReportPayload(BaseModel):
    content_type: str = Field(..., description="post | comment | reply | profile | image | video | message")
    content_id: str
    reason: str
    detail: Optional[str] = Field(default=None, max_length=500)
    # Phase 4: optional list of image ids (from POST /api/images/upload)
    # the reporter uploads as evidence. Max 8 enforced server-side.
    screenshots: Optional[list[str]] = Field(default=None)


@router.post("/api/reports")
async def submit_report(payload: ReportPayload, current: CurrentUser):
    if payload.content_type not in CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unknown content_type")
    # Accept BOTH the legacy scanner reasons and the Phase-4 user-facing set.
    if payload.reason not in REASONS and payload.reason not in USER_REPORT_REASONS:
        raise HTTPException(status_code=400, detail="Unknown reason")
    screenshots = (payload.screenshots or [])[:8]
    if any(not isinstance(x, str) or not x for x in screenshots):
        raise HTTPException(status_code=400, detail="Invalid screenshot id")

    # Prevent duplicates from the same user against the same content.
    existing = await db.reports.find_one({
        "reporter_id": current["id"],
        "content_type": payload.content_type,
        "content_id":   payload.content_id,
    })
    if existing:
        return {"ok": True, "report": {"id": existing["id"]}, "duplicate": True,
                "ticket": {"id": existing.get("ticket_id"), "ticket_number": existing.get("ticket_number")}}

    now = datetime.now(timezone.utc).isoformat()
    rep = {
        "id":            uuid.uuid4().hex,
        "reporter_id":   current["id"],
        "content_type":  payload.content_type,
        "content_id":    payload.content_id,
        "reason":        payload.reason,
        "detail":        payload.detail,
        "screenshots":   screenshots,
        "status":        "open",
        "created_at":    now,
    }

    # PRIVACY: messages are NEVER auto-copied. We deliberately skip the
    # moderation_status bump for message reports so the admin moderation
    # queue does NOT surface the message body. Admins see only the
    # support ticket containing reporter metadata + uploaded screenshots.
    if payload.content_type != "message":
        coll_name = CONTENT_TYPES[payload.content_type]
        coll = getattr(db, coll_name)
        await coll.update_one(
            {"id": payload.content_id},
            {"$set": {
                "moderation_status": STATUS_PENDING_REVIEW,
                "moderation_reason": payload.reason,
                "moderated_at":      now,
                "moderated_by":      "user_report",
            }},
        )

    # Always create a support ticket so the admin has a single inbox.
    # Lazy import avoids a circular module-load when moderation.py is
    # imported before tickets.py.
    from routers.tickets import (
        _next_ticket_number, _send_support_message, _support_user,
    )

    reason_label = payload.reason.replace("_", " ").title()
    type_label = payload.content_type.title()
    subject = f"[Report:{type_label}] {reason_label}"[:100]

    # Build a metadata-only preview. NEVER include message body text.
    preview_bits = [f"reason={payload.reason}", f"target={payload.content_type}:{payload.content_id}"]
    if payload.detail:
        preview_bits.append(f"detail={payload.detail[:120]}")
    if screenshots:
        preview_bits.append(f"screenshots={len(screenshots)}")
    preview = " | ".join(preview_bits)[:160]

    # Conversation id between reporter and @support.
    support = await _support_user()
    conv_id = ":".join(sorted([current["id"], support["id"]]))

    ticket_number = await _next_ticket_number()
    ticket = {
        "id":             uuid.uuid4().hex,
        "ticket_number":  ticket_number,
        "user_id":        current["id"],
        "username":       current.get("username"),
        "conv_id":        conv_id,
        "subject":        subject,
        "preview":        preview,
        "status":         "Submitted",
        "assignee_id":    None,
        "created_at":     now,
        "updated_at":     now,
        # Phase 4 — report linkage so /admin/support can fetch details.
        "report_id":      rep["id"],
        "report_type":    payload.content_type,
        "report_target":  payload.content_id,
    }
    await db.tickets.insert_one(ticket)
    ticket.pop("_id", None)

    rep["ticket_id"] = ticket["id"]
    rep["ticket_number"] = ticket_number
    await db.reports.insert_one(rep)

    # @support → reporter confirmation DM. Privacy-safe: confirmation
    # references the ticket number, not the reported text.
    confirmation = (
        f"Thanks for the report — your support ticket #{ticket_number} "
        f"has been opened. We'll review the {payload.content_type} you "
        f"flagged and follow up here. (Reason: {reason_label}.)"
    )
    await _send_support_message(
        support_id=support["id"],
        user_id=current["id"],
        text=confirmation,
    )

    await log_action(
        action="report",
        content_type=payload.content_type,
        content_id=payload.content_id,
        user_id=current["id"],
        reason=payload.reason,
        meta={
            "detail":       payload.detail,
            "screenshots":  screenshots,
            "ticket_id":    ticket["id"],
            "ticket_number": ticket_number,
        },
    )
    return {
        "ok": True,
        "report": {"id": rep["id"]},
        "duplicate": False,
        "ticket": {"id": ticket["id"], "ticket_number": ticket_number},
    }


# ─── Admin summary cards ──────────────────────────────────────────────
@router.get("/api/admin/moderation/summary")
async def summary(current: CurrentUser):
    _require_admin(current)
    today_iso = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    pending_review = 0
    auto_hidden = 0
    removed_today = 0
    for coll_name in ("posts", "comments", "users", "images", "videos"):
        coll = getattr(db, coll_name)
        pending_review += await coll.count_documents({"moderation_status": STATUS_PENDING_REVIEW})
        auto_hidden    += await coll.count_documents({"moderation_status": STATUS_HIDDEN})
        removed_today  += await coll.count_documents({
            "moderation_status": {"$in": [STATUS_HIDDEN, STATUS_REJECTED]},
            "moderated_at": {"$gte": today_iso},
        })
    total_reports = await db.reports.count_documents({})

    return {
        "pending_review": pending_review,
        "auto_hidden":    auto_hidden,
        "total_reports":  total_reports,
        "removed_today":  removed_today,
    }


# ─── Admin queue listing ──────────────────────────────────────────────
@router.get("/api/admin/moderation/queue")
async def list_queue(current: CurrentUser, status: str = STATUS_PENDING_REVIEW, limit: int = 50):
    _require_admin(current)
    if status not in (STATUS_PENDING_REVIEW, STATUS_HIDDEN, STATUS_REJECTED, STATUS_APPROVED):
        raise HTTPException(status_code=400, detail="bad status")

    items: list[dict] = []
    for coll_name, ct in (("posts", "post"), ("comments", "comment"),
                         ("users", "profile"), ("images", "image"), ("videos", "video")):
        coll = getattr(db, coll_name)
        cursor = coll.find(
            {"moderation_status": status},
            {"_id": 0},
        ).sort("moderated_at", -1).limit(limit)
        async for d in cursor:
            items.append({
                "content_type": ct,
                "id": d.get("id"),
                "title": (d.get("content") or d.get("name") or d.get("username") or "")[:160],
                "user_id": d.get("author_id") or d.get("user_id") or d.get("id"),
                "moderation_status": d.get("moderation_status"),
                "moderation_reason": d.get("moderation_reason"),
                "moderation_score": d.get("moderation_score"),
                "moderation_triggered": d.get("moderation_triggered", []),
                "moderated_at": d.get("moderated_at"),
                "moderated_by": d.get("moderated_by"),
                "created_at": d.get("created_at"),
            })

    items.sort(key=lambda x: x.get("moderated_at") or "", reverse=True)
    return {"items": items[:limit], "total": len(items)}


# ─── Removed content (hidden/rejected) ────────────────────────────────
@router.get("/api/admin/moderation/removed")
async def list_removed(current: CurrentUser, limit: int = 100):
    _require_admin(current)
    return await list_queue(current=current, status=STATUS_HIDDEN, limit=limit)


# ─── Moderation log timeline ──────────────────────────────────────────
@router.get("/api/admin/moderation/log")
async def list_log(current: CurrentUser, limit: int = 100):
    _require_admin(current)
    cursor = db.moderation_log.find({}, {"_id": 0}).sort("created_at", -1).limit(min(max(1, limit), 500))
    return {"items": [d async for d in cursor]}


# ─── Admin actions ────────────────────────────────────────────────────
class ActionPayload(BaseModel):
    action: str  # approve | hide | restore | delete | ban | acknowledge


@router.post("/api/admin/moderation/{content_type}/{content_id}/action")
async def take_action(content_type: str, content_id: str, payload: ActionPayload, current: CurrentUser):
    _require_admin(current)
    if content_type not in CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unknown content_type")
    if payload.action not in ("approve", "hide", "restore", "delete", "ban", "acknowledge"):
        raise HTTPException(status_code=400, detail="Unknown action")

    coll_name = CONTENT_TYPES[content_type]
    coll = getattr(db, coll_name)
    doc = await coll.find_one({"id": content_id}, {"_id": 0})
    if not doc and payload.action != "acknowledge":
        raise HTTPException(status_code=404, detail="Not found")

    # Phase B — protect the @support / @stealth system accounts from
    # destructive admin actions (ban, delete on a profile doc).
    if doc and payload.action in ("ban", "delete"):
        target_id = doc.get("author_id") or doc.get("user_id") or doc.get("id")
        if target_id:
            target = await db.users.find_one(
                {"id": target_id},
                {"_id": 0, "username": 1, "is_protected": 1, "is_founder": 1},
            )
            if target and (
                target.get("is_protected")
                or target.get("is_founder")
                or (target.get("username") or "").lower() in ("support", "stealth")
            ):
                raise HTTPException(
                    status_code=403,
                    detail="This account is protected and cannot be banned or deleted.",
                )

    now = datetime.now(timezone.utc).isoformat()
    status_map = {
        "approve": STATUS_APPROVED,
        "hide":    STATUS_HIDDEN,
        "restore": STATUS_APPROVED,
        "acknowledge": doc.get("moderation_status") if doc else STATUS_HIDDEN,
    }

    if payload.action == "delete":
        await coll.delete_one({"id": content_id})
        if content_type == "post":
            await db.comments.delete_many({"post_id": content_id})
    elif payload.action == "ban":
        # Ban the author/owner of the content (or the profile itself).
        target_id = doc.get("author_id") or doc.get("user_id") or doc.get("id")
        if target_id:
            await db.users.update_one(
                {"id": target_id},
                {"$set": {"is_banned": True, "banned_at": now, "banned_by": current["id"]}},
            )
    else:
        await coll.update_one(
            {"id": content_id},
            {"$set": {
                "moderation_status": status_map.get(payload.action, STATUS_APPROVED),
                "moderated_at":      now,
                "moderated_by":      f"admin:{current['id']}",
            }},
        )

    # Resolve linked reports for this content.
    await db.reports.update_many(
        {"content_type": content_type, "content_id": content_id, "status": "open"},
        {"$set": {"status": "resolved", "resolved_at": now, "resolved_by": current["id"]}},
    )

    await log_action(
        action=payload.action,
        content_type=content_type,
        content_id=content_id,
        user_id=(doc or {}).get("author_id") or (doc or {}).get("user_id") or content_id,
        actor_id=current["id"],
        reason=payload.action,
    )

    return {"ok": True, "action": payload.action, "content_id": content_id}
