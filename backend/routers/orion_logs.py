"""Phase 3.7 — Founder-only Orion log surfaces.

GET /api/admin/orion-logs/queries   — read orion_admin_query_logs
GET /api/admin/orion-logs/actions   — read orion_action_logs
GET /api/admin/orion-logs/{queries,actions}/export?fmt=csv  — CSV download (3.7.4)

Both endpoints are gated to `_is_stealth(current)` (founder-only).
Other admins do not have access in Phase 3.7 — the user spec
explicitly says "Founder-only access unless explicitly changed
later". Filters (date range, user, tool, action_type, success,
approval_status) are accepted as query params.
"""
from __future__ import annotations
import csv
import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from core.db import db
from core.deps import CurrentUser


router = APIRouter(prefix="/api/admin/orion-logs", tags=["admin-orion-logs"])


def _is_founder(current: dict) -> bool:
    return (current.get("username") or "").lower() == "stealth"


def _require_founder(current: dict) -> None:
    if not _is_founder(current):
        raise HTTPException(status_code=403, detail="Founder-only.")


def _build_filter(
    *,
    user: Optional[str],
    tool: Optional[str],
    success: Optional[bool],
    intent: Optional[str],
    approval_status: Optional[str],
    since: Optional[str],
    until: Optional[str],
) -> dict:
    q: dict = {}
    if user:
        q["username"] = user
    if tool:
        q["tool_called"] = tool
    if intent:
        # Used for both query.detected_intent and action.action_type.
        q["$or"] = [{"detected_intent": intent}, {"action_type": intent}]
    if success is not None:
        q["success"] = success
    if approval_status:
        q["approval_status"] = approval_status
    if since or until:
        rng: dict = {}
        if since:
            rng["$gte"] = since
        if until:
            rng["$lte"] = until
        q["timestamp"] = rng
    return q


@router.get("/queries")
async def list_query_logs(
    current: CurrentUser,
    user: Optional[str] = Query(None, description="username filter"),
    tool: Optional[str] = None,
    intent: Optional[str] = None,
    success: Optional[bool] = None,
    since: Optional[str] = Query(None, description="ISO timestamp >= this"),
    until: Optional[str] = Query(None, description="ISO timestamp <= this"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    _require_founder(current)
    q = _build_filter(
        user=user, tool=tool, success=success, intent=intent,
        approval_status=None, since=since, until=until,
    )
    cursor = db.orion_admin_query_logs.find(q, {"_id": 0}).sort("timestamp", -1).skip(offset).limit(limit)
    rows = await cursor.to_list(limit)
    total = await db.orion_admin_query_logs.count_documents(q)
    return {"total": total, "rows": rows, "limit": limit, "offset": offset}


@router.get("/actions")
async def list_action_logs(
    current: CurrentUser,
    user: Optional[str] = Query(None),
    tool: Optional[str] = None,
    action_type: Optional[str] = None,
    success: Optional[bool] = None,
    approval_status: Optional[str] = Query(None, description="pending|approved|declined|n/a"),
    since: Optional[str] = None,
    until: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    _require_founder(current)
    q = _build_filter(
        user=user, tool=tool, success=success, intent=action_type,
        approval_status=approval_status, since=since, until=until,
    )
    cursor = db.orion_action_logs.find(q, {"_id": 0}).sort("timestamp", -1).skip(offset).limit(limit)
    rows = await cursor.to_list(limit)
    total = await db.orion_action_logs.count_documents(q)
    return {"total": total, "rows": rows, "limit": limit, "offset": offset}


@router.get("/summary")
async def orion_logs_summary(current: CurrentUser):
    """Lightweight stats card for the /admin/orion-logs page header."""
    _require_founder(current)
    q_total   = await db.orion_admin_query_logs.count_documents({})
    a_total   = await db.orion_action_logs.count_documents({})
    q_refused = await db.orion_admin_query_logs.count_documents({"short_result_summary": "refused: not_admin"})
    a_pending = await db.orion_action_logs.count_documents({"approval_status": "pending"})
    a_approved = await db.orion_action_logs.count_documents({"approval_status": "approved"})
    today_iso = datetime.utcnow().strftime("%Y-%m-%d") + "T00:00:00+00:00"
    q_today = await db.orion_admin_query_logs.count_documents({"timestamp": {"$gte": today_iso}})
    a_today = await db.orion_action_logs.count_documents({"timestamp": {"$gte": today_iso}})
    return {
        "query_total":    q_total,
        "query_today":    q_today,
        "query_refused":  q_refused,
        "action_total":   a_total,
        "action_today":   a_today,
        "action_pending": a_pending,
        "action_approved": a_approved,
    }


# ─────────────────────────────────────────────────────────────────────
# Phase 3.7.4 — CSV export
#
# Founder-only download endpoint that streams the same filtered rows as
# the JSON endpoints in CSV form. Reuses `_build_filter` so search
# behaviour is identical to the table view.
# ─────────────────────────────────────────────────────────────────────
QUERY_COLS = [
    "timestamp", "username", "role", "detected_intent", "tool_called",
    "success", "execution_time_ms", "question", "short_result_summary",
]
ACTION_COLS = [
    "timestamp", "username", "role", "action_type", "tool_called",
    "approval_status", "success", "execution_time_ms",
    "prepared_draft", "confirmation_required", "result",
    "requested_action", "short_result_summary",
]


def _csv_stream(rows, cols, filename):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow({c: r.get(c, "") for c in cols})
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/queries/export")
async def export_query_logs(
    current: CurrentUser,
    user: Optional[str] = None,
    tool: Optional[str] = None,
    intent: Optional[str] = None,
    success: Optional[bool] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    limit: int = Query(5000, ge=1, le=20000),
):
    _require_founder(current)
    q = _build_filter(user=user, tool=tool, success=success, intent=intent,
                      approval_status=None, since=since, until=until)
    cursor = db.orion_admin_query_logs.find(q, {"_id": 0}).sort("timestamp", -1).limit(limit)
    rows = await cursor.to_list(limit)
    fname = f"orion-queries-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.csv"
    return _csv_stream(rows, QUERY_COLS, fname)


@router.get("/actions/export")
async def export_action_logs(
    current: CurrentUser,
    user: Optional[str] = None,
    tool: Optional[str] = None,
    action_type: Optional[str] = None,
    success: Optional[bool] = None,
    approval_status: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    limit: int = Query(5000, ge=1, le=20000),
):
    _require_founder(current)
    q = _build_filter(user=user, tool=tool, success=success, intent=action_type,
                      approval_status=approval_status, since=since, until=until)
    cursor = db.orion_action_logs.find(q, {"_id": 0}).sort("timestamp", -1).limit(limit)
    rows = await cursor.to_list(limit)
    fname = f"orion-actions-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.csv"
    return _csv_stream(rows, ACTION_COLS, fname)
