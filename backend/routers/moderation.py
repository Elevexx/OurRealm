"""Moderation admin endpoints + user report endpoint.

  POST /api/reports                           (any logged-in user)
  GET  /api/admin/moderation/summary          (@stealth only)
  GET  /api/admin/moderation/queue            (@stealth only)
  POST /api/admin/moderation/{ct}/{id}/action (@stealth only)
  GET  /api/admin/moderation/removed          (@stealth only)
  GET  /api/admin/moderation/log              (@stealth only)
"""
from __future__ import annotations

import os
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
                 "reply": "comments", "message": "messages",
                 # Bundle G — Responsibility Center entities (same universal
                 # moderation pipeline; membership verified in submit_report)
                 "rc_center": "responsibility_centers",
                 "rc_item": "responsibility_items",
                 "rc_comment": "responsibility_item_comments",
                 "rc_event": "responsibility_center_calendar_events",
                 "rc_unit": "responsibility_center_units"}


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

    # RC entities: reporter must be able to access the entity's Center —
    # blocks cross-Center ID probing (existence not revealed).
    if payload.content_type.startswith("rc_"):
        coll = getattr(db, CONTENT_TYPES[payload.content_type])
        doc = await coll.find_one({"id": payload.content_id},
                                  {"_id": 0, "id": 1, "center_id": 1})
        cid = (doc or {}).get("center_id") or (doc or {}).get("id")
        member = cid and await db.responsibility_center_memberships.find_one(
            {"center_id": cid, "user_id": current["id"],
             "status": {"$in": ["active", "paused"]}}, {"_id": 1})
        if not doc or not member:
            raise HTTPException(status_code=404, detail="Content not found")

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
    reason: Optional[str] = None
    source: Optional[str] = None  # post_menu | edit_screen | moderation_center | user_profile


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

    # Resolve linked reports for this content. For PART 2 — copyright
    # reports get extended resolution metadata: removed_at + action_taken
    # + resolution_status so the dedicated copyright queue can render
    # the full lifecycle.
    report_resolution: dict = {
        "status":       "resolved",
        "resolved_at":  now,
        "resolved_by":  current["id"],
        "moderator_id": current["id"],
        "action_taken": payload.action,
        "resolution_status":
            "removed" if payload.action == "delete"
            else "hidden" if payload.action == "hide"
            else "restored" if payload.action == "restore"
            else "approved" if payload.action == "approve"
            else "acknowledged",
        "resolution_notes": (payload.reason or "")[:240],
    }
    if payload.action in ("delete", "hide"):
        report_resolution["removed_at"] = now
    await db.reports.update_many(
        {"content_type": content_type, "content_id": content_id, "status": "open"},
        {"$set": report_resolution},
    )

    # Increment repeat-offender counter on copyright actions so the
    # admin queue can surface chronic infringers without a separate
    # cron job. We only count actual removals (delete/hide), not approvals.
    if payload.action in ("delete", "hide"):
        offender_id = (doc or {}).get("author_id") or (doc or {}).get("user_id")
        if offender_id:
            copyright_open_count = await db.reports.count_documents({
                "content_type": content_type,
                "content_id": content_id,
                "reason": "copyright",
            })
            if copyright_open_count:
                await db.users.update_one(
                    {"id": offender_id},
                    {"$inc": {"copyright_strike_count": 1},
                     "$set": {"last_copyright_strike_at": now}},
                )

    await log_action(
        action=payload.action,
        content_type=content_type,
        content_id=content_id,
        user_id=(doc or {}).get("author_id") or (doc or {}).get("user_id") or content_id,
        actor_id=current["id"],
        reason=payload.reason or payload.action,
        meta={"source": payload.source or "moderation_center"},
    )

    # Case decided — mark related moderation notifications Resolved.
    if payload.action in ("approve", "hide", "restore", "delete"):
        await _resolve_mod_notifications(content_id)

    # Notify the uploader (no internal details) + reporters on resolution.
    uploader_id = (doc or {}).get("author_id") or (doc or {}).get("user_id")
    if uploader_id and payload.action in ("hide", "delete", "restore", "approve"):
        try:
            from routers.notifications import emit_notification
            msg = {
                "hide":    "Your content has been restricted for a possible Community Guidelines violation.",
                "delete":  "Your content was removed for a Community Guidelines violation.",
                "restore": "Your content has been restored and is visible again.",
                "approve": "Your content was reviewed and found not to violate our guidelines.",
            }[payload.action]
            await emit_notification(uploader_id, "moderation",
                                    payload={"preview": msg, "content_id": content_id})
        except Exception:
            pass
    try:
        from routers.notifications import emit_notification
        async for r in db.reports.find(
                {"content_type": content_type, "content_id": content_id,
                 "resolved_at": now}, {"_id": 0, "reporter_id": 1}):
            await emit_notification(
                r["reporter_id"], "moderation",
                payload={"preview": "Your report was reviewed and a decision has been made. Thank you for helping keep OurRealm safe."})
    except Exception:
        pass

    return {"ok": True, "action": payload.action, "content_id": content_id}


# ──────────────────────────────────────────────────────────────────────
# PART 2 — Copyright moderation queue + repeat-offender surface
# ──────────────────────────────────────────────────────────────────────
@router.get("/api/admin/moderation/copyright/queue")
async def copyright_queue(
    current: CurrentUser,
    status: Optional[str] = None,
    limit: int = 50,
):
    """Reports filed under `reason=copyright`, ordered by most recent.

    `status` (open | resolved | all) maps to the underlying report status.
    Reuses the existing `reports` collection so there's no duplicate
    storage — only a filter + the extended resolution metadata we now
    persist on action.
    """
    _require_admin(current)
    q: dict = {"reason": "copyright"}
    s = (status or "open").lower()
    if s in {"open", "resolved"}:
        q["status"] = s
    cursor = db.reports.find(q, {"_id": 0}).sort("created_at", -1).limit(min(max(1, limit), 200))
    return {"reports": [r async for r in cursor]}


@router.get("/api/admin/moderation/copyright/repeat-offenders")
async def copyright_repeat_offenders(current: CurrentUser, min_strikes: int = 2, limit: int = 50):
    """Users with ≥ min_strikes recorded copyright strikes."""
    _require_admin(current)
    cursor = db.users.find(
        {"copyright_strike_count": {"$gte": int(min_strikes)}},
        {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1,
         "copyright_strike_count": 1, "last_copyright_strike_at": 1,
         "is_banned": 1, "disabled": 1},
    ).sort("copyright_strike_count", -1).limit(min(max(1, limit), 200))
    return {"users": [u async for u in cursor]}


# ──────────────────────────────────────────────────────────────────────
# PART 5 — Admin Analytics: Sounds + copyright metrics
# ──────────────────────────────────────────────────────────────────────
@router.get("/api/admin/analytics/sounds")
async def sounds_analytics(
    current: CurrentUser,
    creator_username: Optional[str] = None,
    visibility: Optional[str] = None,
):
    """Compact metric set for the AdminAnalytics dashboard.

    Returns the 13 metrics requested by PART 5 in a single call so the
    dashboard can render the entire card row without N+1 round trips.
    Detail panels and founder actions use the existing
    `/admin/moderation/*` endpoints — we never duplicate moderation
    state.
    """
    from core.permissions import require_analytics_access
    require_analytics_access(current)

    now = datetime.now(timezone.utc)
    iso_24h = (now - timedelta(hours=24)).isoformat()
    iso_7d  = (now - timedelta(days=7)).isoformat()
    iso_30d = (now - timedelta(days=30)).isoformat()

    base_filter: dict = {}
    if creator_username:
        u = await db.users.find_one({"username": creator_username.lower()}, {"_id": 0, "id": 1})
        if u:
            base_filter["user_id"] = u["id"]
    if visibility:
        base_filter["visibility"] = visibility.lower()

    # Aggregate metrics — keep this as the *only* DB read so the response
    # is fast and the card row can re-fetch on filter change.
    total          = await db.tracks.count_documents(base_filter)
    new_24h        = await db.tracks.count_documents({**base_filter, "created_at": {"$gte": iso_24h}})
    new_7d         = await db.tracks.count_documents({**base_filter, "created_at": {"$gte": iso_7d}})
    new_30d        = await db.tracks.count_documents({**base_filter, "created_at": {"$gte": iso_30d}})
    rights_yes     = await db.tracks.count_documents({**base_filter, "rights_confirmation.accepted": True})
    rights_no      = await db.tracks.count_documents({**base_filter, "rights_confirmation.accepted": {"$ne": True}})

    # Total plays = sum of plays across all tracks (cheap aggregation).
    play_pipeline = [{"$match": base_filter}, {"$group": {"_id": None, "n": {"$sum": "$plays"}}}]
    plays_doc = await db.tracks.aggregate(play_pipeline).to_list(1)
    total_plays = (plays_doc[0]["n"] if plays_doc else 0) or 0

    # Most played (top 5 ids + titles + plays).
    most_played = await db.tracks.find(base_filter, {"_id": 0, "id": 1, "title": 1, "user_id": 1, "plays": 1}).sort("plays", -1).limit(5).to_list(5)

    # Reports on sounds (content_type ∈ {sound, track, audio}).
    sound_types = {"$in": ["sound", "track", "audio"]}
    total_reports = await db.reports.count_documents({"content_type": sound_types})

    # Most reported sounds (group reports by content_id).
    most_reported_pipe = [
        {"$match": {"content_type": sound_types}},
        {"$group": {"_id": "$content_id", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 5},
    ]
    most_reported_rows = await db.reports.aggregate(most_reported_pipe).to_list(5)

    copyright_reports = await db.reports.count_documents({"reason": "copyright"})
    copyright_removals = await db.reports.count_documents({
        "reason": "copyright", "status": "resolved",
        "resolution_status": {"$in": ["removed", "hidden"]},
    })
    pending_copyright_reviews = await db.reports.count_documents({"reason": "copyright", "status": "open"})
    repeat_offenders = await db.users.count_documents({"copyright_strike_count": {"$gte": 2}})

    # Playback failure / missing-file counts come from the optional
    # `playback_failures` collection (recorded by the frontend on error).
    # If the collection doesn't exist yet they return 0 gracefully.
    failed_playback = await db.playback_failures.count_documents({})
    missing_files   = await db.playback_failures.count_documents({"reason": "missing_file"})

    return {
        "totals": {
            "total_sounds":             total,
            "new_24h":                  new_24h,
            "new_7d":                   new_7d,
            "new_30d":                  new_30d,
            "total_plays":              total_plays,
            "total_reports":            total_reports,
            "copyright_reports":        copyright_reports,
            "copyright_removals":       copyright_removals,
            "pending_copyright_reviews":pending_copyright_reviews,
            "repeat_offenders":         repeat_offenders,
            "rights_yes":               rights_yes,
            "rights_no":                rights_no,
            "failed_playback":          failed_playback,
            "missing_files":            missing_files,
        },
        "most_played":   most_played,
        "most_reported": most_reported_rows,
        "filter": {"creator_username": creator_username, "visibility": visibility},
        "generated_at": now.isoformat(),
    }


# Telemetry endpoint used by the frontend audio player to record playback
# failures so admins can spot persistent storage / encoding issues.
@router.post("/api/sounds/playback-failure")
async def report_playback_failure(payload: dict, current: CurrentUser):
    """Record a playback failure. Any authenticated user can submit.

    Payload shape: { track_id, reason, detail }
    Stored shape: { track_id, reason, detail, user_id, at }
    """
    track_id = (payload or {}).get("track_id")
    reason   = (payload or {}).get("reason") or "unknown"
    detail   = (payload or {}).get("detail") or ""
    if not isinstance(track_id, str) or not track_id:
        raise HTTPException(status_code=400, detail="track_id required")
    await db.playback_failures.insert_one({
        "id":       uuid.uuid4().hex,
        "track_id": track_id,
        "reason":   reason[:40],
        "detail":   detail[:240],
        "user_id":  current["id"],
        "at":       datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}


# ──────────────────────────────────────────────────────────────────────
# PART 4 — Persistent media storage diagnostic
# ──────────────────────────────────────────────────────────────────────
@router.get("/api/admin/storage/status")
async def storage_status(current: CurrentUser):
    """Founder-only — surfaces the resolved upload paths for every
    media kind so deploy verification can confirm uploads survive
    pod restarts. Reports per-kind: directory, exists, persistent?,
    file_count, total_bytes."""
    from core.permissions import require_founder
    require_founder(current)
    from services.storage import uploads_root, is_persistent_storage_configured, media_dir
    info: dict = {
        "uploads_root":           str(uploads_root()),
        "persistent_configured":  is_persistent_storage_configured(),
        "uploads_root_env":       os.environ.get("UPLOADS_ROOT") or None,
        "kinds": {},
    }
    for kind, env in (
        ("audio",  "AUDIO_STORAGE_DIR"),
        ("images", "IMAGE_STORAGE_DIR"),
        ("videos", "VIDEO_STORAGE_DIR"),
    ):
        d = media_dir(kind, per_store_env=env)
        try:
            files = list(d.iterdir()) if d.exists() else []
            total = sum(f.stat().st_size for f in files if f.is_file())
        except Exception:  # noqa: BLE001
            files, total = [], 0
        info["kinds"][kind] = {
            "dir":             str(d),
            "exists":          d.exists(),
            "file_count":      len(files),
            "total_bytes":     total,
            "per_store_env":   env,
            "per_store_value": os.environ.get(env) or None,
        }
    return info


# ──────────────────────────────────────────────────────────────────────
# CONTENT SAFETY (Phase 1) — manual blur, rescan, unified cases,
# report administration, user safety preferences, extended summary.
# ──────────────────────────────────────────────────────────────────────
BLUR_CATEGORIES = {"graphic", "nudity_sexual", "violence", "medical",
                   "disturbing", "custom"}
SAFETY_COLLS = (("posts", "post"), ("images", "image"), ("videos", "video"))


class BlurPayload(BaseModel):
    category: str = "graphic"
    internal_reason: Optional[str] = Field(default=None, max_length=300)
    public_message: Optional[str] = Field(default=None, max_length=200)
    source: Optional[str] = None


@router.post("/api/admin/moderation/{content_type}/{content_id}/blur")
async def manual_blur(content_type: str, content_id: str, payload: BlurPayload, current: CurrentUser):
    """Blur ANY content for other users — no AI flag or report required.
    Uploader keeps seeing their own content normally."""
    _require_admin(current)
    if content_type not in CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unknown content_type")
    if payload.category not in BLUR_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown warning category")
    coll = getattr(db, CONTENT_TYPES[content_type])
    doc = await coll.find_one({"id": content_id}, {"_id": 0, "safety": 1, "author_id": 1, "user_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    now = datetime.now(timezone.utc).isoformat()
    prev = doc.get("safety") or {}
    mb = {
        "active": True,
        "category": payload.category,
        "public_message": payload.public_message,
        "internal_reason": payload.internal_reason,
        "applied_by": current["id"],
        "applied_at": now,
    }
    await coll.update_one({"id": content_id}, {"$set": {
        "safety.manual_blur": mb,
        "safety.manual_override": True,
        "safety.severity": max(int(prev.get("severity") or 0), 1),
    }})
    await log_action(action="blur_manual", content_type=content_type,
                     content_id=content_id,
                     user_id=doc.get("author_id") or doc.get("user_id"),
                     actor_id=current["id"], reason=payload.category,
                     meta={"internal_reason": payload.internal_reason,
                           "public_message": payload.public_message,
                           "previous_severity": prev.get("severity") or 0,
                           "source": payload.source or "moderation_center"})
    uploader = doc.get("author_id") or doc.get("user_id")
    if uploader:
        try:
            from routers.notifications import emit_notification
            await emit_notification(uploader, "moderation", payload={
                "preview": "Your content received a sensitive-content warning and may appear blurred to other users.",
                "content_id": content_id})
        except Exception:
            pass
    return {"ok": True, "blurred": True}


class UnblurPayload(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)
    source: Optional[str] = None


@router.post("/api/admin/moderation/{content_type}/{content_id}/unblur")
async def manual_unblur(content_type: str, content_id: str, payload: UnblurPayload, current: CurrentUser):
    _require_admin(current)
    if content_type not in CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unknown content_type")
    coll = getattr(db, CONTENT_TYPES[content_type])
    doc = await coll.find_one({"id": content_id}, {"_id": 0, "safety": 1, "author_id": 1, "user_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    now = datetime.now(timezone.utc).isoformat()
    prev = doc.get("safety") or {}
    await coll.update_one({"id": content_id}, {"$set": {
        "safety.manual_blur.active": False,
        "safety.manual_blur.removed_by": current["id"],
        "safety.manual_blur.removed_at": now,
        "safety.manual_blur.removal_reason": payload.reason,
        "safety.severity": int(prev.get("scan_severity") or 0),
    }})
    await log_action(action="unblur_manual", content_type=content_type,
                     content_id=content_id,
                     user_id=doc.get("author_id") or doc.get("user_id"),
                     actor_id=current["id"], reason=payload.reason,
                     meta={"previous": prev.get("manual_blur"),
                           "source": payload.source or "moderation_center"})
    return {"ok": True, "blurred": False}


@router.post("/api/admin/moderation/{content_type}/{content_id}/rescan")
async def rescan_content(content_type: str, content_id: str, current: CurrentUser):
    """Admin-requested re-run of AI detection (the only automatic rescan
    trigger besides a model change)."""
    _require_admin(current)
    import asyncio as _aio
    from services.content_safety import (apply_post_media_safety,
                                         scan_image_record, scan_video_record)
    if content_type == "post":
        _aio.create_task(apply_post_media_safety(content_id, force=True))
    elif content_type == "image":
        _aio.create_task(scan_image_record(content_id, force=True))
    elif content_type == "video":
        _aio.create_task(scan_video_record(content_id, force=True))
    else:
        raise HTTPException(status_code=400, detail="Rescan supports post/image/video")
    await log_action(action="rescan", content_type=content_type,
                     content_id=content_id, user_id=None, actor_id=current["id"])
    return {"ok": True, "queued": True}


@router.get("/api/admin/moderation/cases")
async def safety_cases(current: CurrentUser, tab: str = "ai", limit: int = 50):
    """Unified case list: tab = ai | urgent | blurred | review | hidden | locked."""
    _require_admin(current)
    if tab == "urgent":
        q = {"safety.urgent": True}
    elif tab == "blurred":
        q = {"safety.manual_blur.active": True}
    elif tab == "review":
        q = {"moderation_status": STATUS_PENDING_REVIEW}
    elif tab == "hidden":
        q = {"moderation_status": {"$in": [STATUS_HIDDEN, STATUS_REJECTED]}}
    elif tab == "locked":
        q = {"review_lock.active": True}
    else:
        q = {"safety.severity": {"$gte": 1}}
    items = []
    for coll_name, ct in SAFETY_COLLS:
        cursor = getattr(db, coll_name).find(q, {"_id": 0}).sort("safety.scanned_at", -1).limit(limit)
        async for d in cursor:
            s = d.get("safety") or {}
            uploader = d.get("author_id") or d.get("user_id")
            u = await db.users.find_one({"id": uploader}, {"_id": 0, "username": 1}) if uploader else None
            report_count = await db.reports.count_documents({"content_id": d.get("id")})
            items.append({
                "content_type": ct,
                "id": d.get("id"),
                "preview": (d.get("content") or d.get("original_url") or d.get("url") or "")[:160],
                "uploader_id": uploader,
                "uploader_username": (u or {}).get("username"),
                "severity": s.get("severity", 0),
                "categories": s.get("categories") or [],
                "confidence": s.get("confidence"),
                "context": s.get("context"),
                "detection_source": s.get("detection_source"),
                "scan_status": s.get("scan_status"),
                "scanned_at": s.get("scanned_at"),
                "urgent": s.get("urgent", False),
                "manual_blur": (s.get("manual_blur") or {}),
                "moderation_status": d.get("moderation_status"),
                "report_count": report_count,
                "created_at": d.get("created_at"),
            })
    items.sort(key=lambda x: (not x["urgent"], -(x["severity"] or 0), x.get("scanned_at") or ""), )
    return {"items": items[:limit]}


@router.get("/api/admin/moderation/reports")
async def admin_reports(current: CurrentUser, status: str = "open",
                        reason: Optional[str] = None, limit: int = 100):
    _require_admin(current)
    q: dict = {}
    if status == "open":
        q = {"status": "open", "removed_from_active_queue": {"$ne": True}}
    elif status == "resolved":
        q = {"status": "resolved"}
    elif status == "removed":
        q = {"removed_from_active_queue": True}
    if reason:
        q["reason"] = reason
    out = []
    cursor = db.reports.find(q, {"_id": 0}).sort("created_at", -1).limit(min(max(1, limit), 300))
    async for r in cursor:
        u = await db.users.find_one({"id": r.get("reporter_id")}, {"_id": 0, "username": 1})
        r["reporter_username"] = (u or {}).get("username")
        out.append(r)
    return {"reports": out}


class ReportAdminPayload(BaseModel):
    action: str  # close | remove | reopen
    reason: Optional[str] = Field(default=None, max_length=300)


@router.post("/api/admin/moderation/reports/{report_id}/update")
async def admin_update_report(report_id: str, payload: ReportAdminPayload, current: CurrentUser):
    _require_admin(current)
    rep = await db.reports.find_one({"id": report_id}, {"_id": 0})
    if not rep:
        raise HTTPException(status_code=404, detail="Report not found")
    now = datetime.now(timezone.utc).isoformat()
    if payload.action == "close":
        await db.reports.update_one({"id": report_id}, {"$set": {
            "status": "resolved", "resolution_status": "no_violation",
            "resolved_at": now, "resolved_by": current["id"],
            "resolution_notes": payload.reason}})
        try:
            from routers.notifications import emit_notification
            await emit_notification(rep["reporter_id"], "moderation", payload={
                "preview": "Your report was reviewed and closed. Thank you for helping keep OurRealm safe."})
        except Exception:
            pass
    elif payload.action == "remove":
        if not payload.reason:
            raise HTTPException(status_code=400, detail="A removal reason is required")
        await db.reports.update_one({"id": report_id}, {"$set": {
            "removed_from_active_queue": True, "removal_reason": payload.reason,
            "removed_by": current["id"], "removed_at": now}})
    elif payload.action == "reopen":
        await db.reports.update_one({"id": report_id}, {"$set": {
            "status": "open", "removed_from_active_queue": False}})
    else:
        raise HTTPException(status_code=400, detail="Unknown action")
    # Immutable audit record is preserved regardless of queue removal.
    await log_action(action=f"report_{payload.action}", content_type="report",
                     content_id=report_id, user_id=rep.get("reporter_id"),
                     actor_id=current["id"], reason=payload.reason,
                     meta={"target": f"{rep.get('content_type')}:{rep.get('content_id')}"})
    return {"ok": True, "action": payload.action}


@router.get("/api/admin/moderation/safety-summary")
async def safety_summary(current: CurrentUser):
    _require_admin(current)
    today_iso = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    total_scanned = ai_flagged = blurred = urgent = 0
    for coll_name, _ct in SAFETY_COLLS:
        coll = getattr(db, coll_name)
        total_scanned += await coll.count_documents({"safety.scan_status": "done"})
        ai_flagged    += await coll.count_documents({"safety.severity": {"$gte": 1}})
        blurred       += await coll.count_documents({"safety.manual_blur.active": True})
        urgent        += await coll.count_documents({"safety.urgent": True})
    open_reports  = await db.reports.count_documents({"status": "open", "removed_from_active_queue": {"$ne": True}})
    reports_today = await db.reports.count_documents({"created_at": {"$gte": today_iso}})
    pending = await db.posts.count_documents({"moderation_status": STATUS_PENDING_REVIEW})
    hidden  = await db.posts.count_documents({"moderation_status": STATUS_HIDDEN})
    removed_today = await db.posts.count_documents({
        "moderation_status": {"$in": [STATUS_HIDDEN, STATUS_REJECTED]},
        "moderated_at": {"$gte": today_iso}})
    cat_rows = await db.posts.aggregate([
        {"$match": {"safety.categories.0": {"$exists": True}}},
        {"$unwind": "$safety.categories"},
        {"$group": {"_id": "$safety.categories", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 10},
    ]).to_list(10)
    from services.content_safety import MODEL_VERSION, LLM_KEY
    return {
        "total_scanned": total_scanned, "ai_flagged": ai_flagged,
        "manual_blurred": blurred, "urgent": urgent,
        "open_reports": open_reports, "reports_today": reports_today,
        "pending_review": pending, "auto_hidden": hidden,
        "removed_today": removed_today,
        "top_categories": [{"category": r["_id"], "count": r["n"]} for r in cat_rows],
        "detection_model": MODEL_VERSION,
        "detection_enabled": bool(LLM_KEY),
    }


# ─── User Safety & Content Preferences ────────────────────────────────
SAFETY_PREF_KEYS = ("graphic", "adult_sexual", "violent", "medical")
SAFETY_PREF_VALUES = ("show", "blur", "hide")
SAFETY_PREF_DEFAULTS = {"graphic": "blur", "adult_sexual": "blur",
                        "violent": "blur", "medical": "show"}


@router.get("/api/me/safety-preferences")
async def get_safety_prefs(current: CurrentUser):
    u = await db.users.find_one({"id": current["id"]}, {"_id": 0, "safety_prefs": 1})
    prefs = {**SAFETY_PREF_DEFAULTS, **((u or {}).get("safety_prefs") or {})}
    return {"preferences": prefs}


class SafetyPrefsPayload(BaseModel):
    graphic: Optional[str] = None
    adult_sexual: Optional[str] = None
    violent: Optional[str] = None
    medical: Optional[str] = None


@router.patch("/api/me/safety-preferences")
async def set_safety_prefs(payload: SafetyPrefsPayload, current: CurrentUser):
    updates = {}
    for k in SAFETY_PREF_KEYS:
        v = getattr(payload, k)
        if v is not None:
            if v not in SAFETY_PREF_VALUES:
                raise HTTPException(status_code=400, detail=f"Invalid value for {k}")
            updates[f"safety_prefs.{k}"] = v
    if updates:
        await db.users.update_one({"id": current["id"]}, {"$set": updates})
    u = await db.users.find_one({"id": current["id"]}, {"_id": 0, "safety_prefs": 1})
    return {"preferences": {**SAFETY_PREF_DEFAULTS, **((u or {}).get("safety_prefs") or {})}}


# ──────────────────────────────────────────────────────────────────────
# PHASE 1.5 — Admin moderation controls: private-review lock, internal
# notes, case view, user search + moderation profile, content search.
# ──────────────────────────────────────────────────────────────────────
class LockPayload(BaseModel):
    reason: str = Field(min_length=2, max_length=300)
    source: Optional[str] = None  # post_menu | edit_screen | moderation_center | user_profile


@router.post("/api/admin/moderation/post/{post_id}/lock-private")
async def lock_private(post_id: str, payload: LockPayload, current: CurrentUser):
    """Lock a post private while under review. Uploader + admins keep
    access; everyone else loses it via the audience visibility gate.
    Original audience is preserved for exact restoration."""
    _require_admin(current)
    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "audience": 1, "author_id": 1, "author_username": 1, "review_lock": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if (post.get("review_lock") or {}).get("active"):
        return {"ok": True, "locked": True, "already": True}
    now = datetime.now(timezone.utc).isoformat()
    original_audience = post.get("audience") or {"visibility": "public", "user_ids": []}
    await db.posts.update_one({"id": post_id}, {"$set": {
        "review_lock": {
            "active": True,
            "original_audience": original_audience,
            "locked_by": current["id"],
            "locked_at": now,
            "reason": payload.reason,
        },
        "audience": {"visibility": "private", "user_ids": []},
    }})
    await log_action(action="private_review_lock", content_type="post",
                     content_id=post_id, user_id=post.get("author_id"),
                     actor_id=current["id"], reason=payload.reason,
                     meta={"previous_audience": original_audience,
                           "source": payload.source or "moderation_center"})
    await notify_moderation_event(event_type="review_lock", content_type="post",
                                  content_id=post_id, category="review",
                                  priority="High", username=post.get("author_username"))
    if post.get("author_id"):
        try:
            from routers.notifications import emit_notification
            await emit_notification(post["author_id"], "moderation", payload={
                "preview": "One of your posts is temporarily private while our moderation team reviews it.",
                "post_id": post_id})
        except Exception:
            pass
    return {"ok": True, "locked": True}


@router.post("/api/admin/moderation/post/{post_id}/unlock-private")
async def unlock_private(post_id: str, payload: LockPayload, current: CurrentUser):
    """Restore the post's exact original visibility after review."""
    _require_admin(current)
    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "review_lock": 1, "author_id": 1, "audience": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    rl = post.get("review_lock") or {}
    if not rl.get("active"):
        raise HTTPException(status_code=400, detail="Post is not locked for review")
    now = datetime.now(timezone.utc).isoformat()
    original = rl.get("original_audience") or {"visibility": "public", "user_ids": []}
    await db.posts.update_one({"id": post_id}, {"$set": {
        "audience": original,
        "review_lock.active": False,
        "review_lock.unlocked_by": current["id"],
        "review_lock.unlocked_at": now,
        "review_lock.unlock_reason": payload.reason,
    }})
    await log_action(action="private_review_unlock", content_type="post",
                     content_id=post_id, user_id=post.get("author_id"),
                     actor_id=current["id"], reason=payload.reason,
                     meta={"restored_audience": original,
                           "source": payload.source or "moderation_center"})
    await _resolve_mod_notifications(post_id, "review_lock")
    if post.get("author_id"):
        try:
            from routers.notifications import emit_notification
            await emit_notification(post["author_id"], "moderation", payload={
                "preview": "Your post has finished review and its original visibility was restored.",
                "post_id": post_id})
        except Exception:
            pass
    return {"ok": True, "locked": False}


class NotePayload(BaseModel):
    note: str = Field(min_length=1, max_length=1000)


@router.post("/api/admin/moderation/{content_type}/{content_id}/note")
async def add_moderator_note(content_type: str, content_id: str, payload: NotePayload, current: CurrentUser):
    _require_admin(current)
    if content_type not in CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unknown content_type")
    now = datetime.now(timezone.utc).isoformat()
    rec = {"id": uuid.uuid4().hex, "content_type": content_type,
           "content_id": content_id, "note": payload.note,
           "author_id": current["id"], "author_username": current.get("username"),
           "created_at": now}
    await db.moderation_notes.insert_one(rec)
    rec.pop("_id", None)
    await log_action(action="moderator_note_added", content_type=content_type,
                     content_id=content_id, user_id=None, actor_id=current["id"],
                     meta={"note_id": rec["id"]})
    return {"ok": True, "note": rec}


@router.get("/api/admin/moderation/case/{content_type}/{content_id}")
async def case_detail(content_type: str, content_id: str, current: CurrentUser):
    """Full moderation case: content, safety data (admins may see internals),
    reports, internal notes, audit trail, uploader summary."""
    _require_admin(current)
    if content_type not in CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unknown content_type")
    coll = getattr(db, CONTENT_TYPES[content_type])
    doc = await coll.find_one({"id": content_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    uploader_id = doc.get("author_id") or doc.get("user_id")
    uploader = None
    if uploader_id:
        uploader = await db.users.find_one(
            {"id": uploader_id},
            {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1,
             "created_at": 1, "is_banned": 1, "disabled": 1})
    reports = [r async for r in db.reports.find(
        {"content_type": content_type, "content_id": content_id}, {"_id": 0}
    ).sort("created_at", -1).limit(50)]
    for r in reports:
        u = await db.users.find_one({"id": r.get("reporter_id")}, {"_id": 0, "username": 1})
        r["reporter_username"] = (u or {}).get("username")
    notes = [n async for n in db.moderation_notes.find(
        {"content_type": content_type, "content_id": content_id}, {"_id": 0}
    ).sort("created_at", -1).limit(50)]
    # Audit: log the open event BEFORE snapshotting so this response
    # already carries its own "post opened in admin" entry.
    await log_action(action="case_opened", content_type=content_type,
                     content_id=content_id, user_id=uploader_id,
                     actor_id=current["id"], meta={"source": "moderation_center"})
    audit = [a async for a in db.moderation_log.find(
        {"content_id": content_id}, {"_id": 0}).sort("created_at", -1).limit(100)]
    return {"content": doc, "uploader": uploader, "reports": reports,
            "notes": notes, "audit": audit}


# ─── User search + moderation profile ────────────────────────────────
@router.get("/api/admin/moderation/users/search")
async def user_mod_search(current: CurrentUser, q: str = "", limit: int = 20):
    _require_admin(current)
    q = (q or "").strip()
    if not q:
        return {"users": []}
    import re as _re
    rx = {"$regex": _re.escape(q), "$options": "i"}
    ors: list[dict] = [{"username": rx}, {"name": rx}, {"id": q}]
    is_founder = (current.get("username") or "").lower() == "stealth" or current.get("is_founder")
    if is_founder and "@" in q:
        ors.append({"email": q.lower()})
    out = []
    cursor = db.users.find({"$or": ors},
                           {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1,
                            "created_at": 1, "is_banned": 1, "disabled": 1, "admin_role": 1,
                            "email": 1, "last_seen_at": 1}).limit(min(max(1, limit), 50))
    async for u in cursor:
        if not is_founder:
            u.pop("email", None)
        uid = u["id"]
        u["reports_made"] = await db.reports.count_documents({"reporter_id": uid})
        u["moderation_actions"] = await db.moderation_log.count_documents(
            {"user_id": uid, "action": {"$nin": ["report", "case_opened"]}})
        u["removed_posts"] = await db.posts.count_documents(
            {"author_id": uid, "moderation_status": {"$in": ["hidden", "rejected"]}})
        u["flagged_posts"] = await db.posts.count_documents(
            {"author_id": uid, "safety.severity": {"$gte": 1}})
        u["status"] = ("banned" if u.get("is_banned")
                       else "disabled" if u.get("disabled") else "active")
        out.append(u)
    return {"users": out}


@router.get("/api/admin/moderation/users/{user_id}")
async def user_mod_profile(user_id: str, current: CurrentUser):
    _require_admin(current)
    u = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1,
         "created_at": 1, "is_banned": 1, "banned_at": 1, "disabled": 1,
         "admin_role": 1, "email": 1, "last_seen_at": 1, "bio": 1,
         "copyright_strike_count": 1, "account_limits": 1,
         "suspended_until": 1, "suspension_reason": 1,
         "reporter_abuse_flags": 1})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    is_founder = (current.get("username") or "").lower() == "stealth" or current.get("is_founder")
    if not is_founder:
        u.pop("email", None)
    u["status"] = ("banned" if u.get("is_banned")
                   else "suspended" if u.get("suspended_until")
                   else "disabled" if u.get("disabled") else "active")
    if (u.get("account_limits") or {}).get("active"):
        u["limited"] = True
    counts = {
        "posts": await db.posts.count_documents({"author_id": user_id}),
        "removed_posts": await db.posts.count_documents(
            {"author_id": user_id, "moderation_status": {"$in": ["hidden", "rejected"]}}),
        "flagged_posts": await db.posts.count_documents(
            {"author_id": user_id, "safety.severity": {"$gte": 1}}),
        "locked_posts": await db.posts.count_documents(
            {"author_id": user_id, "review_lock.active": True}),
        "reports_made": await db.reports.count_documents({"reporter_id": user_id}),
        "moderation_actions": await db.moderation_log.count_documents(
            {"user_id": user_id, "action": {"$nin": ["report", "case_opened"]}}),
    }
    # Reports received about this user's recent posts.
    recent_ids = [p["id"] async for p in db.posts.find(
        {"author_id": user_id}, {"_id": 0, "id": 1}).sort("created_at", -1).limit(200)]
    counts["reports_received"] = await db.reports.count_documents(
        {"content_id": {"$in": recent_ids}}) if recent_ids else 0
    history = [h async for h in db.moderation_log.find(
        {"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(30)]
    reports_made = [r async for r in db.reports.find(
        {"reporter_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(10)]
    notes = [n async for n in db.moderation_notes.find(
        {"content_type": "profile", "content_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(20)]
    return {"user": u, "counts": counts, "history": history,
            "reports_made": reports_made, "notes": notes}


USER_POST_FILTERS = {
    "all": {},
    "images": {"media_type": "image"},
    "videos": {"media_type": "video"},
    "sounds": {"media_type": "sound"},
    "text": {"media_type": "thought"},
    "blurred": {"safety.manual_blur.active": True},
    "under_review": {"moderation_status": "pending_review"},
    "hidden": {"moderation_status": {"$in": ["hidden", "rejected"]}},
    "locked": {"review_lock.active": True},
    "ai_flagged": {"safety.severity": {"$gte": 1}},
}


def _admin_post_row(p: dict, report_count: int = 0) -> dict:
    s = p.get("safety") or {}
    rl = p.get("review_lock") or {}
    return {
        "id": p.get("id"),
        "content": (p.get("content") or "")[:200],
        "media_type": p.get("media_type"),
        "image_url": (p.get("image_urls") or [None])[0] or p.get("image_url"),
        "video_url": p.get("video_url"),
        "created_at": p.get("created_at"),
        "author_id": p.get("author_id"),
        "author_username": p.get("author_username"),
        "visibility": (p.get("audience") or {}).get("visibility") or "public",
        "moderation_status": p.get("moderation_status") or "approved",
        "severity": s.get("severity", 0),
        "categories": s.get("categories") or [],
        "manual_blur": bool((s.get("manual_blur") or {}).get("active")),
        "review_locked": bool(rl.get("active")),
        "urgent": bool(s.get("urgent")),
        "scan_status": s.get("scan_status"),
        "fire_total": p.get("fire_total") or 0,
        "likes": p.get("likes") or 0,
        "comments": p.get("comments") or 0,
        "report_count": report_count,
    }


@router.get("/api/admin/moderation/users/{user_id}/posts")
async def user_mod_posts(user_id: str, current: CurrentUser,
                         filter: str = "all", skip: int = 0, limit: int = 25):
    _require_admin(current)
    base: dict = {"author_id": user_id}
    extra = USER_POST_FILTERS.get(filter)
    if extra is None and filter == "reported":
        ids = await db.reports.distinct("content_id", {"content_type": "post"})
        extra = {"id": {"$in": ids}}
    q = {**base, **(extra or {})}
    total = await db.posts.count_documents(q)
    cursor = db.posts.find(q, {"_id": 0}).sort("created_at", -1) \
        .skip(max(0, skip)).limit(min(max(1, limit), 50))
    rows = []
    async for p in cursor:
        rc = await db.reports.count_documents({"content_type": "post", "content_id": p["id"]})
        rows.append(_admin_post_row(p, rc))
    return {"posts": rows, "total": total, "skip": skip, "limit": limit}


@router.get("/api/admin/moderation/content/search")
async def content_mod_search(current: CurrentUser, q: str = "",
                             username: Optional[str] = None,
                             media_type: Optional[str] = None,
                             status: Optional[str] = None,
                             severity_min: Optional[int] = None,
                             blurred: Optional[bool] = None,
                             locked: Optional[bool] = None,
                             skip: int = 0, limit: int = 25):
    """Platform-wide content search for the Moderation Center."""
    _require_admin(current)
    import re as _re
    query: dict = {}
    q = (q or "").strip()
    if q:
        query["$or"] = [{"content": {"$regex": _re.escape(q), "$options": "i"}},
                        {"id": q}]
    if username:
        u = await db.users.find_one({"username": username.lower().lstrip("@")}, {"_id": 0, "id": 1})
        query["author_id"] = (u or {}).get("id") or "__none__"
    if media_type:
        query["media_type"] = media_type
    if status:
        if status == "approved":
            query["moderation_status"] = {"$in": [None, "approved"]}
        else:
            query["moderation_status"] = status
    if severity_min is not None:
        query["safety.severity"] = {"$gte": int(severity_min)}
    if blurred:
        query["safety.manual_blur.active"] = True
    if locked:
        query["review_lock.active"] = True
    if not query:
        query = {}
    total = await db.posts.count_documents(query)
    cursor = db.posts.find(query, {"_id": 0}).sort("created_at", -1) \
        .skip(max(0, skip)).limit(min(max(1, limit), 50))
    rows = []
    async for p in cursor:
        rc = await db.reports.count_documents({"content_type": "post", "content_id": p["id"]})
        rows.append(_admin_post_row(p, rc))
    return {"posts": rows, "total": total, "skip": skip, "limit": limit}


# ──────────────────────────────────────────────────────────────────────
# ADMIN MODERATION NOTIFICATIONS (lightweight — reuses db.notifications
# with kind="admin_moderation"; recipient-scoped to moderation roles).
# ──────────────────────────────────────────────────────────────────────
MOD_NOTIFY_ROLES = ["founder", "support_admin", "moderator"]


async def notify_moderation_event(event_type: str, content_type: str, content_id: str,
                                  category: str = "safety", priority: str = "Standard",
                                  username: Optional[str] = None,
                                  status: str = "unresolved") -> None:
    """Notify all moderation-authorized admins. Dedupe: a repeated event
    for the same unresolved case UPDATES the active row (bumps time,
    re-flags unseen) instead of stacking duplicates."""
    now = datetime.now(timezone.utc).isoformat()
    recipients = {u["id"] async for u in db.users.find(
        {"$or": [{"admin_role": {"$in": MOD_NOTIFY_ROLES}}, {"username": "stealth"}]},
        {"_id": 0, "id": 1})}
    created = 0
    for rid in recipients:
        existing = await db.notifications.find_one({
            "recipient_id": rid, "kind": "admin_moderation",
            "payload.content_id": content_id,
            "payload.event_type": event_type,
            "payload.status": {"$ne": "resolved"},
        }, {"_id": 0, "id": 1})
        if existing:
            await db.notifications.update_one({"id": existing["id"]}, {"$set": {
                "created_at": now, "seen": False,
                "payload.priority": priority, "payload.status": status,
            }})
        else:
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()), "recipient_id": rid,
                "kind": "admin_moderation", "actor_username": None,
                "payload": {"priority": priority, "category": category,
                            "username": username, "content_type": content_type,
                            "content_id": content_id, "event_type": event_type,
                            "status": status},
                "created_at": now, "seen": False})
            created += 1
    await log_action(action="mod_notification_created", content_type=content_type,
                     content_id=content_id, user_id=None, reason=event_type,
                     meta={"priority": priority, "recipients": len(recipients),
                           "new_rows": created})


async def _resolve_mod_notifications(content_id: str, event_type: Optional[str] = None) -> None:
    q = {"kind": "admin_moderation", "payload.content_id": content_id,
         "payload.status": {"$ne": "resolved"}}
    if event_type:
        q["payload.event_type"] = event_type
    await db.notifications.update_many(q, {"$set": {"payload.status": "resolved", "seen": True}})


class ModNotifAck(BaseModel):
    action: str = "acknowledge"  # acknowledge | open


@router.post("/api/admin/moderation/notifications/{notif_id}/ack")
async def ack_mod_notification(notif_id: str, payload: ModNotifAck, current: CurrentUser):
    _require_admin(current)
    n = await db.notifications.find_one(
        {"id": notif_id, "recipient_id": current["id"], "kind": "admin_moderation"},
        {"_id": 0})
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    updates: dict = {"seen": True}
    p = n.get("payload") or {}
    if payload.action == "acknowledge" and p.get("status") != "resolved":
        updates["payload.status"] = "acknowledged"
    await db.notifications.update_one({"id": notif_id}, {"$set": updates})
    await log_action(
        action="mod_notification_acknowledged" if payload.action == "acknowledge"
        else "case_opened_from_notification",
        content_type=p.get("content_type") or "post",
        content_id=p.get("content_id") or notif_id,
        user_id=None, actor_id=current["id"],
        meta={"notification_id": notif_id})
    return {"ok": True, "status": updates.get("payload.status", p.get("status"))}


# ──────────────────────────────────────────────────────────────────────
# PHASE 2 — account enforcement (warn / limit / suspend), report
# merging, reporter-abuse controls.
# ──────────────────────────────────────────────────────────────────────
ENFORCE_CAPS = {"posting", "commenting", "messaging", "uploading",
                "realm_creation", "recommendations"}


class EnforcePayload(BaseModel):
    action: str  # warn | limit | unlimit | suspend | unsuspend
    reason: str = Field(min_length=2, max_length=300)
    days: Optional[int] = None
    capabilities: Optional[list[str]] = None
    source: Optional[str] = None


@router.post("/api/admin/moderation/users/{user_id}/enforce")
async def enforce_account(user_id: str, payload: EnforcePayload, current: CurrentUser):
    _require_admin(current)
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "username": 1,
                                                       "account_limits": 1, "disabled": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if user_id == current["id"]:
        raise HTTPException(status_code=400, detail="You cannot enforce against yourself")
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    action = payload.action
    notify_msg = None

    if action == "warn":
        notify_msg = ("You have received a formal warning for a Community "
                      "Guidelines violation. Repeated violations may lead to "
                      "account restrictions.")
    elif action == "limit":
        caps = [c for c in (payload.capabilities or []) if c in ENFORCE_CAPS]
        if not caps:
            raise HTTPException(status_code=400, detail="Select at least one capability to limit")
        days = max(1, min(90, int(payload.days or 3)))
        await db.users.update_one({"id": user_id}, {"$set": {"account_limits": {
            "active": True, "capabilities": caps,
            "expires_at": (now + timedelta(days=days)).isoformat(),
            "applied_by": current["id"], "applied_at": now_iso,
            "reason": payload.reason}}})
        notify_msg = ("Your account is temporarily limited "
                      f"({', '.join(c.replace('_', ' ') for c in caps)}) for {days} day(s) "
                      "due to a Community Guidelines violation.")
    elif action == "unlimit":
        await db.users.update_one({"id": user_id}, {"$set": {"account_limits.active": False}})
        notify_msg = "Your account limits have been lifted."
    elif action == "suspend":
        days = max(1, min(365, int(payload.days or 7)))
        until = (now + timedelta(days=days)).isoformat()
        await db.users.update_one({"id": user_id}, {"$set": {
            "disabled": True, "suspended_until": until, "suspended_at": now_iso,
            "suspended_by": current["id"], "suspension_reason": payload.reason}})
        notify_msg = f"Your account has been suspended until {until[:10]} for a Community Guidelines violation."
    elif action == "unsuspend":
        await db.users.update_one({"id": user_id}, {
            "$set": {"disabled": False},
            "$unset": {"suspended_until": "", "suspended_at": "",
                       "suspended_by": "", "suspension_reason": ""}})
        notify_msg = "Your account suspension has been lifted."
    else:
        raise HTTPException(status_code=400, detail="Unknown enforcement action")

    await log_action(action=f"account_{action}", content_type="profile",
                     content_id=user_id, user_id=user_id, actor_id=current["id"],
                     reason=payload.reason,
                     meta={"days": payload.days, "capabilities": payload.capabilities,
                           "source": payload.source or "user_profile"})
    if notify_msg:
        try:
            from routers.notifications import emit_notification
            await emit_notification(user_id, "moderation", payload={"preview": notify_msg})
        except Exception:
            pass
    return {"ok": True, "action": action}


class MergeReportsPayload(BaseModel):
    primary_id: str
    duplicate_ids: list[str] = Field(min_length=1)


@router.post("/api/admin/moderation/reports/merge")
async def merge_reports(payload: MergeReportsPayload, current: CurrentUser):
    """Combine duplicate reports about the same content into one case.
    Duplicates leave the active queue but the audit record is preserved."""
    _require_admin(current)
    primary = await db.reports.find_one({"id": payload.primary_id}, {"_id": 0})
    if not primary:
        raise HTTPException(status_code=404, detail="Primary report not found")
    now = datetime.now(timezone.utc).isoformat()
    merged = 0
    for rid in payload.duplicate_ids:
        if rid == payload.primary_id:
            continue
        res = await db.reports.update_one({"id": rid}, {"$set": {
            "status": "duplicate", "duplicate_of": payload.primary_id,
            "removed_from_active_queue": True,
            "merged_by": current["id"], "merged_at": now}})
        merged += res.modified_count
    await db.reports.update_one({"id": payload.primary_id},
                                {"$inc": {"merged_count": merged}})
    await log_action(action="report_merged", content_type="report",
                     content_id=payload.primary_id, user_id=primary.get("reporter_id"),
                     actor_id=current["id"],
                     meta={"duplicates": payload.duplicate_ids, "merged": merged})
    return {"ok": True, "merged": merged}


@router.post("/api/admin/moderation/reports/{report_id}/mark-abusive")
async def mark_report_abusive(report_id: str, payload: UnblurPayload, current: CurrentUser):
    """Flag a knowingly false/abusive report. Increments the reporter's
    abuse counter for pattern tracking — users are NEVER punished merely
    because a report was not confirmed."""
    _require_admin(current)
    rep = await db.reports.find_one({"id": report_id}, {"_id": 0})
    if not rep:
        raise HTTPException(status_code=404, detail="Report not found")
    now = datetime.now(timezone.utc).isoformat()
    await db.reports.update_one({"id": report_id}, {"$set": {
        "marked_abusive": True, "status": "resolved",
        "resolution_status": "abusive_report",
        "removed_from_active_queue": True,
        "resolved_at": now, "resolved_by": current["id"],
        "resolution_notes": payload.reason}})
    await db.users.update_one({"id": rep["reporter_id"]},
                              {"$inc": {"reporter_abuse_flags": 1}})
    await log_action(action="reporter_abuse_flagged", content_type="report",
                     content_id=report_id, user_id=rep.get("reporter_id"),
                     actor_id=current["id"], reason=payload.reason)
    return {"ok": True}
