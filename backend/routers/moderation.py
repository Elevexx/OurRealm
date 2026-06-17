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
from core.deps import CurrentUser
from services.moderation import (
    REASONS, STATUS_APPROVED, STATUS_HIDDEN, STATUS_PENDING_REVIEW,
    STATUS_REJECTED, log_action, scan_content,
)


router = APIRouter(tags=["moderation"])

CONTENT_TYPES = {"post": "posts", "comment": "comments", "profile": "users",
                 "image": "images", "video": "videos"}


def _require_admin(user: dict) -> None:
    if not ((user.get("username") or "").lower() == "stealth" or user.get("is_founder")):
        raise HTTPException(status_code=403, detail="Admin only")


# ─── User-facing report endpoint ──────────────────────────────────────
class ReportPayload(BaseModel):
    content_type: str = Field(..., description="post | comment | profile")
    content_id: str
    reason: str
    detail: Optional[str] = Field(default=None, max_length=500)


@router.post("/api/reports")
async def submit_report(payload: ReportPayload, current: CurrentUser):
    if payload.content_type not in CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unknown content_type")
    if payload.reason not in REASONS:
        raise HTTPException(status_code=400, detail="Unknown reason")

    # Prevent duplicates from the same user against the same content.
    existing = await db.reports.find_one({
        "reporter_id": current["id"],
        "content_type": payload.content_type,
        "content_id":   payload.content_id,
    })
    if existing:
        return {"ok": True, "report": {"id": existing["id"]}, "duplicate": True}

    rep = {
        "id":           uuid.uuid4().hex,
        "reporter_id":  current["id"],
        "content_type": payload.content_type,
        "content_id":   payload.content_id,
        "reason":       payload.reason,
        "detail":       payload.detail,
        "status":       "open",
        "created_at":   datetime.now(timezone.utc).isoformat(),
    }
    await db.reports.insert_one(rep)
    # Mirror into moderation_log + bump the target's status to pending_review
    # so it surfaces in the admin queue.
    coll_name = CONTENT_TYPES[payload.content_type]
    coll = getattr(db, coll_name)
    id_field = "id" if payload.content_type != "profile" else "id"
    await coll.update_one(
        {id_field: payload.content_id},
        {"$set": {
            "moderation_status": STATUS_PENDING_REVIEW,
            "moderation_reason": payload.reason,
            "moderated_at":     rep["created_at"],
            "moderated_by":     "user_report",
        }},
    )
    await log_action(
        action="report",
        content_type=payload.content_type,
        content_id=payload.content_id,
        user_id=current["id"],
        reason=payload.reason,
        meta={"detail": payload.detail},
    )
    return {"ok": True, "report": {"id": rep["id"]}, "duplicate": False}


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
