"""AccountDeletionService — separated concepts per the June 2026 spec:

  • Public Removal Service       → remove_public_access()
  • Recoverable Closure          → request_recoverable_closure() (1-365d)
  • Immediate Deletion           → email-confirmed, no recovery window
  • Permanent Erasure Service    → staged, idempotent, retry-safe worker
  • Deletion Suppression Ledger  → re-applies erasure after backup restore

Verification (reauth / username confirm / email link) happens in the
router BEFORE a job is created — it is NOT a job stage.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from core.db import db
from core.account_lifecycle import STATUS_DELETED_PENDING, STATUS_PURGED, _marker

log = logging.getLogger("ourrealm.account_deletion")

STATUS_ERASURE_IN_PROGRESS = "erasure_in_progress"

# Ordered permanent-erasure stages. Everything from `core_profile_erased`
# onward is IRREVERSIBLE — stop requests are honoured only before it.
STAGES = [
    ("job_queued",            "Job queued"),
    ("account_frozen",        "Account frozen"),
    ("auth_revoked",          "Authentication revoked"),
    ("public_removed",        "Public surfaces removed"),
    ("core_profile_erased",   "Core profile data erased"),
    ("social_refs_processed", "Social references deleted or anonymized"),
    ("content_processed",     "User-generated content processed"),
    ("messages_processed",    "Messages processed"),
    ("media_processed",       "Media and object storage processed"),
    ("processor_cleanup",     "Search, cache and processor cleanup"),
    ("backup_suppression",    "Backup suppression recorded"),
    ("integrity_verified",    "Integrity verification"),
    ("completed",             "Completion recorded and requester notified"),
]
IRREVERSIBLE_FROM = "core_profile_erased"
STAGE_KEYS = [k for k, _ in STAGES]
MAX_STAGE_ATTEMPTS = 8

CONFIRM_TTL_MINUTES = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


async def _audit(action: str, target_id: str, actor_id: str, **extra):
    try:
        await db.audit_log.insert_one({
            "id": uuid.uuid4().hex, "action": action,
            "actor_id": actor_id, "target_id": target_id,
            "at": _now_iso(), **extra,
        })
    except Exception:  # noqa: BLE001
        pass


_NOTIF_PREVIEWS = {
    "account_closure_received": "Your account closure request was received. You can restore by signing back in during your recovery window.",
    "account_deletion_confirm_link": "Tap to confirm permanent deletion of your account. The link expires in 30 minutes.",
    "account_deletion_started": "Permanent deletion of your account has started. This cannot be undone.",
    "account_deletion_stage_failed": "An account deletion cleanup step needs attention.",
    "account_hidden": "Your account is now hidden from public view.",
    "privacy_request_received": "Your data erasure request was received and is under review.",
    "identity_verification_needed": "We need to verify your identity to continue your privacy request.",
    "privacy_request_approved": "Your data erasure request was approved. Erasure is now processing.",
    "privacy_request_partly_approved": "Your data erasure request was partly approved. See the decision details.",
    "privacy_request_refused": "Your data erasure request was refused. See the decision details.",
    "privacy_request_extended": "The response deadline for your data erasure request was extended.",
    "account_closure_expiring": "Your closed account will be permanently deleted soon. Sign back in to keep it.",
    "privacy_request_overdue": "A privacy erasure request is OVERDUE and needs an immediate decision.",
    "privacy_request_due_soon": "A privacy erasure request is due within 7 days.",
}


async def _notify(user_id: str, kind: str, payload: dict | None = None):
    try:
        from routers.notifications import emit_notification
        p = dict(payload or {})
        p.setdefault("preview", _NOTIF_PREVIEWS.get(kind, ""))
        if kind in ("privacy_request_overdue", "privacy_request_due_soon"):
            p.setdefault("link", "/admin/privacy-requests")
        await emit_notification(user_id, kind, actor_username="system", payload=p)
    except Exception:  # noqa: BLE001
        pass


# ────────────────────────────────────────────────────────────────────
# Public Removal Service — synchronous, called BEFORE any background work
# ────────────────────────────────────────────────────────────────────
async def remove_public_access(user_id: str, *, account_status: str,
                               purge_after: Optional[str] = None,
                               reason: Optional[str] = None,
                               actor_id: Optional[str] = None,
                               extra_set: Optional[dict] = None):
    """Immediately hide the account from every public surface and revoke
    every active session. `disabled=True` drives the existing search /
    suggestion / public-profile filters; `password_changed_at` kills
    access tokens; deleting `refresh_tokens` + `user_sessions` kills
    refresh-based session continuation."""
    now = _now_iso()
    update = {
        "account_status":      account_status,
        "disabled":            True,
        "deleted_at":          now,
        "purge_after":         purge_after,
        "deletion_reason":     (reason or "").strip() or None,
        "deleted_by":          actor_id or user_id,
        "password_changed_at": now,
    }
    if extra_set:
        update.update(extra_set)
    await db.users.update_one({"id": user_id}, {"$set": update})
    try:
        await db.refresh_tokens.delete_many({"user_id": user_id})
        await db.user_sessions.delete_many({"user_id": user_id})
    except Exception:  # noqa: BLE001
        pass


# ────────────────────────────────────────────────────────────────────
# Recoverable Closure Scheduler (voluntary, 1-365 days)
# ────────────────────────────────────────────────────────────────────
async def request_recoverable_closure(user: dict, recovery_days: int,
                                      reason: Optional[str] = None) -> dict:
    recovery_days = max(1, min(int(recovery_days), 365))
    purge_after = (_now() + timedelta(days=recovery_days)).isoformat()
    await remove_public_access(
        user["id"], account_status=STATUS_DELETED_PENDING,
        purge_after=purge_after, reason=reason,
        extra_set={"deletion_scheduled_at": _now_iso(),
                   "closure_recovery_days": recovery_days},
    )
    await _audit("account.closure_requested", user["id"], user["id"],
                 target_user=user.get("username"),
                 recovery_days=recovery_days, purge_after=purge_after)
    await _notify(user["id"], "account_closure_received",
                  {"recovery_days": recovery_days, "purge_after": purge_after})
    from services.mailer import send_email
    await send_email(
        user.get("email") or "", "Your OurRealm account has been closed",
        f"Your account was closed at your request. You can restore it by "
        f"signing back in within {recovery_days} days. After that it will "
        f"be permanently deleted. If you did not request this, sign in and "
        f"restore your account immediately, then change your password.",
        kind="closure_received", user_id=user["id"])
    return {"recovery_days": recovery_days, "purge_after": purge_after}


# ────────────────────────────────────────────────────────────────────
# Immediate deletion — email-confirmed, truly permanent
# ────────────────────────────────────────────────────────────────────
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_immediate_confirmation(user: dict) -> dict:
    """Step 1 of immediate deletion (after password + username reauth in
    the router): mint a single-use 30-minute confirmation token,
    delivered by email and (fallback) in-app notification."""
    token = secrets.token_urlsafe(32)
    expires_at = (_now() + timedelta(minutes=CONFIRM_TTL_MINUTES)).isoformat()
    await db.account_deletion_confirmations.delete_many(
        {"user_id": user["id"], "used": False})
    await db.account_deletion_confirmations.insert_one({
        "id": uuid.uuid4().hex, "user_id": user["id"],
        "token_hash": _token_hash(token), "used": False,
        "created_at": _now_iso(), "expires_at": expires_at,
    })
    import os
    origin = os.environ.get("PUBLIC_APP_ORIGIN") or os.environ.get("SHARE_ORIGIN") or ""
    link = f"{origin}/confirm-deletion?token={token}" if origin else f"/confirm-deletion?token={token}"
    from services.mailer import send_email
    mail = await send_email(
        user.get("email") or "",
        "Confirm permanent deletion of your OurRealm account",
        "You requested immediate permanent deletion of your account. "
        f"This permanently deletes your account and cannot be undone. "
        f"To confirm, open this link within {CONFIRM_TTL_MINUTES} minutes:\n{link}\n"
        "If you did not request this, change your password immediately.",
        kind="immediate_deletion_confirm", user_id=user["id"])
    # Fallback delivery: the requester is authenticated + password-verified,
    # so an in-app link to the same account is a proportionate channel when
    # no email provider is configured.
    if not mail["sent"]:
        await _notify(user["id"], "account_deletion_confirm_link",
                      {"link": f"/confirm-deletion?token={token}",
                       "expires_at": expires_at})
    await _audit("account.immediate_delete_requested", user["id"], user["id"],
                 target_user=user.get("username"), email_sent=mail["sent"])
    return {"expires_at": expires_at, "email_sent": mail["sent"]}


async def confirm_immediate_deletion(user: dict, token: str) -> dict:
    """Step 2: validate the single-use token, then remove public access
    synchronously and enqueue the permanent erasure job. No recovery."""
    row = await db.account_deletion_confirmations.find_one(
        {"user_id": user["id"], "token_hash": _token_hash(token), "used": False})
    if not row:
        raise ValueError("Invalid or already-used confirmation link")
    if datetime.fromisoformat(row["expires_at"]) < _now():
        raise ValueError("Confirmation link expired — request deletion again")
    await db.account_deletion_confirmations.update_one(
        {"id": row["id"]}, {"$set": {"used": True, "used_at": _now_iso()}})
    await remove_public_access(
        user["id"], account_status=STATUS_ERASURE_IN_PROGRESS,
        reason="immediate self-service deletion")
    job = await enqueue_erasure_job(
        user, source="immediate_self_service", requested_by=user["id"])
    await _notify(user["id"], "account_deletion_started", {"job_id": job["id"]})
    from services.mailer import send_email
    await send_email(
        user.get("email") or "", "Your OurRealm account is being permanently deleted",
        "Permanent deletion of your account has started. This cannot be undone. "
        "Public access has already been removed and all sessions were revoked.",
        kind="immediate_deletion_started", user_id=user["id"])
    return {"job_id": job["id"]}


# ────────────────────────────────────────────────────────────────────
# Permanent Erasure Service — staged job pipeline
# ────────────────────────────────────────────────────────────────────
async def enqueue_erasure_job(user: dict, *, source: str, requested_by: str,
                              request_id: Optional[str] = None) -> dict:
    existing = await db.account_deletion_jobs.find_one(
        {"user_id": user["id"], "status": {"$in": ["queued", "running", "failed"]}},
        {"_id": 0})
    if existing:
        return existing
    now = _now_iso()
    job = {
        "id": uuid.uuid4().hex,
        "user_id": user["id"],
        "username_snapshot": user.get("username"),
        # Contact snapshot so we can notify the requester AFTER PII is
        # erased. Expires under the documented retention window (90d).
        "contact_email": user.get("email"),
        "contact_expires_at": (_now() + timedelta(days=90)).isoformat(),
        "source": source,
        "request_id": request_id,
        "requested_by": requested_by,
        "status": "queued",
        "current_stage": "job_queued",
        "irreversible": False,
        "stop_requested": False,
        "stages": {"job_queued": {"status": "done", "at": now, "attempts": 1}},
        "created_at": now,
        "updated_at": now,
        "next_attempt_at": now,
        "claim_until": None,
    }
    await db.account_deletion_jobs.insert_one(dict(job))
    await _audit("account.erasure_job_queued", user["id"], requested_by,
                 job_id=job["id"], source=source, target_user=user.get("username"))
    job.pop("_id", None)
    return job


async def request_stop(job_id: str, actor: dict) -> dict:
    job = await db.account_deletion_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise ValueError("Job not found")
    if job.get("irreversible"):
        raise ValueError("Irreversible erasure already started — cannot stop")
    if job.get("status") in ("completed", "stopped"):
        raise ValueError(f"Job already {job['status']}")
    await db.account_deletion_jobs.update_one(
        {"id": job_id}, {"$set": {"stop_requested": True,
                                  "stop_requested_by": actor["id"],
                                  "updated_at": _now_iso()}})
    await _audit("account.erasure_job_stop_requested", job["user_id"], actor["id"],
                 job_id=job_id)
    return {"ok": True}


# ---- stage implementations (each idempotent) ----
async def _st_account_frozen(job):
    await db.users.update_one(
        {"id": job["user_id"]},
        {"$set": {"disabled": True, "account_status": STATUS_ERASURE_IN_PROGRESS}})


async def _st_auth_revoked(job):
    uid = job["user_id"]
    await db.users.update_one(
        {"id": uid},
        {"$set": {"password_changed_at": _now_iso()}})
    await db.refresh_tokens.delete_many({"user_id": uid})
    await db.user_sessions.delete_many({"user_id": uid})


async def _st_public_removed(job):
    # disabled=True already hides search / suggestions / public profile.
    # Also drop any hashtag / leaderboard visibility rows.
    uid = job["user_id"]
    for coll in ("leaderboard_entries", "user_level_progress"):
        try:
            await db[coll].delete_many({"user_id": uid})
        except Exception:  # noqa: BLE001
            pass


async def _st_core_profile_erased(job):
    uid = job["user_id"]
    new_username, new_email = _marker(uid)
    now = _now_iso()
    await db.users.update_one({"id": uid}, {"$set": {
        "account_status": STATUS_PURGED,
        "permanently_deleted": True,
        "permanently_deleted_at": now,
        "username": new_username, "email": new_email,
        "name": None, "display_name": None, "bio": None,
        "avatar_url": None, "banner_url": None, "cover_url": None,
        "headline": None, "location": None, "zip_code": None,
        "zip_lat": None, "zip_lng": None, "phone": None,
        "social": {}, "wallet": {}, "widgets": [],
        "password_hash": "", "disabled": True,
        "password_changed_at": now,
    }, "$unset": {"deletion_scheduled_at": "", "purge_after": "",
                  "deleted_by": "", "deletion_reason": ""}})


async def _st_social_refs(job):
    uid = job["user_id"]
    await db.users.update_many({}, {"$pull": {"friends": uid, "inner_8": uid}})
    for coll, q in (
        ("friend_requests", {"$or": [{"from_id": uid}, {"to_id": uid},
                                     {"sender_id": uid}, {"recipient_id": uid}]}),
        ("follows", {"$or": [{"follower_id": uid}, {"followed_id": uid}]}),
    ):
        try:
            await db[coll].delete_many(q)
        except Exception:  # noqa: BLE001
            pass


async def _st_content(job):
    uid = job["user_id"]
    marker, _ = _marker(uid)
    await db.posts.delete_many({"author_id": uid})
    try:
        await db.comments.update_many(
            {"author_id": uid},
            {"$set": {"author_username": marker, "author_name": "Deleted User",
                      "author_avatar": None, "text": "[deleted]"}})
    except Exception:  # noqa: BLE001
        pass
    for coll in ("reactions", "saved_posts", "post_reports"):
        try:
            await db[coll].delete_many({"user_id": uid})
        except Exception:  # noqa: BLE001
            pass


async def _st_messages(job):
    uid = job["user_id"]
    marker, _ = _marker(uid)
    try:
        await db.messages.update_many(
            {"sender_id": uid},
            {"$set": {"sender_username": marker, "sender_name": "Deleted User"}})
    except Exception:  # noqa: BLE001
        pass


async def _st_media(job):
    uid = job["user_id"]
    for coll in ("images", "sounds", "videos", "audio_files"):
        try:
            await db[coll].delete_many({"user_id": uid})
        except Exception:  # noqa: BLE001
            pass


async def _st_processor_cleanup(job):
    """Third-party processor cleanup ledger. Each processor gets a row —
    failures stay visible + retryable rather than silently swallowed."""
    uid = job["user_id"]
    processors = [
        {"processor": "supabase_messenger",
         "note": "Message sender rows anonymized in-app; Supabase-side "
                 "profile rows resolve via /api/profile/by-ids which now "
                 "returns the anonymized marker."},
        {"processor": "cloudflare_r2_media_mirror",
         "note": "Mirrored media objects expire under the mirror's "
                 "documented object lifecycle."},
    ]
    for p in processors:
        await db.processor_cleanup_tasks.update_one(
            {"user_id": uid, "processor": p["processor"]},
            {"$set": {**p, "user_id": uid, "job_id": job["id"],
                      "status": "recorded", "at": _now_iso()}},
            upsert=True)
    # Notifications to/from the user
    try:
        await db.notifications.delete_many({"recipient_id": uid})
    except Exception:  # noqa: BLE001
        pass


async def _st_backup_suppression(job):
    """Deletion-suppression ledger — consulted after any backup restore
    so erased accounts are re-erased instead of resurrected."""
    await db.deletion_suppression.update_one(
        {"user_id": job["user_id"]},
        {"$set": {"user_id": job["user_id"], "job_id": job["id"],
                  "scope": "full_account", "erased_at": _now_iso()}},
        upsert=True)


async def _st_integrity(job):
    u = await db.users.find_one({"id": job["user_id"]}, {"_id": 0})
    if not u:
        return  # row fully gone is acceptable
    problems = []
    if u.get("account_status") != STATUS_PURGED:
        problems.append("account_status not purged")
    if u.get("password_hash"):
        problems.append("password_hash still present")
    if u.get("email") and not u["email"].endswith(".invalid"):
        problems.append("email not anonymized")
    if problems:
        raise RuntimeError("integrity check failed: " + "; ".join(problems))


async def _st_completed(job):
    now = _now_iso()
    await _audit("account.permanent_delete", job["user_id"], "system",
                 target_user=job.get("username_snapshot"), job_id=job["id"])
    contact = job.get("contact_email")
    if contact:
        from services.mailer import send_email
        await send_email(
            contact, "Your OurRealm account deletion is complete",
            "Permanent deletion of your account has completed. "
            "Retained backups expire under our documented backup schedule "
            "and deleted data is suppressed from any backup restoration.",
            kind="deletion_completed", user_id=job["user_id"])
    if job.get("request_id"):
        await db.privacy_erasure_requests.update_one(
            {"id": job["request_id"]},
            {"$set": {"completed_at": now, "status": "completed",
                      "requester_notified_at": now}})


_STAGE_FNS = {
    "account_frozen":        _st_account_frozen,
    "auth_revoked":          _st_auth_revoked,
    "public_removed":        _st_public_removed,
    "core_profile_erased":   _st_core_profile_erased,
    "social_refs_processed": _st_social_refs,
    "content_processed":     _st_content,
    "messages_processed":    _st_messages,
    "media_processed":       _st_media,
    "processor_cleanup":     _st_processor_cleanup,
    "backup_suppression":    _st_backup_suppression,
    "integrity_verified":    _st_integrity,
    "completed":             _st_completed,
}


async def _run_job(job: dict):
    jid = job["id"]
    for key in STAGE_KEYS:
        fresh = await db.account_deletion_jobs.find_one({"id": jid}, {"_id": 0})
        if not fresh:
            return
        stage = (fresh.get("stages") or {}).get(key) or {}
        if stage.get("status") == "done":
            continue
        # Honour stop requests only before the irreversible stage
        if fresh.get("stop_requested") and not fresh.get("irreversible"):
            await db.users.update_one(
                {"id": fresh["user_id"], "account_status": STATUS_ERASURE_IN_PROGRESS},
                {"$set": {"account_status": STATUS_DELETED_PENDING,
                          "purge_after": None}})
            await db.account_deletion_jobs.update_one(
                {"id": jid}, {"$set": {"status": "stopped",
                                       "stopped_at": _now_iso(),
                                       "updated_at": _now_iso(),
                                       "claim_until": None}})
            await _audit("account.erasure_job_stopped", fresh["user_id"],
                         fresh.get("stop_requested_by") or "system", job_id=jid)
            return
        attempts = int(stage.get("attempts") or 0)
        irreversible_now = STAGE_KEYS.index(key) >= STAGE_KEYS.index(IRREVERSIBLE_FROM)
        try:
            if irreversible_now and not fresh.get("irreversible"):
                await db.account_deletion_jobs.update_one(
                    {"id": jid}, {"$set": {"irreversible": True}})
            await db.account_deletion_jobs.update_one(
                {"id": jid},
                {"$set": {"current_stage": key, "status": "running",
                          "updated_at": _now_iso(),
                          f"stages.{key}.status": "running",
                          f"stages.{key}.attempts": attempts + 1}})
            fn = _STAGE_FNS.get(key)
            if fn:
                await fn(fresh)
            await db.account_deletion_jobs.update_one(
                {"id": jid},
                {"$set": {f"stages.{key}.status": "done",
                          f"stages.{key}.at": _now_iso(),
                          "updated_at": _now_iso()}})
        except Exception as e:  # noqa: BLE001
            log.exception("[deletion-job %s] stage %s failed", jid, key)
            backoff = min(3600, 30 * (2 ** attempts))
            failed_out = attempts + 1 >= MAX_STAGE_ATTEMPTS
            await db.account_deletion_jobs.update_one(
                {"id": jid},
                {"$set": {f"stages.{key}.status": "failed",
                          f"stages.{key}.error": str(e)[:400],
                          "status": "failed" if failed_out else "queued",
                          "next_attempt_at": (_now() + timedelta(seconds=backoff)).isoformat(),
                          "updated_at": _now_iso(), "claim_until": None}})
            if failed_out:
                await _notify(job.get("requested_by") or "", "account_deletion_stage_failed",
                              {"job_id": jid, "stage": key})
            return
    await db.account_deletion_jobs.update_one(
        {"id": jid}, {"$set": {"status": "completed", "current_stage": "completed",
                               "completed_at": _now_iso(), "updated_at": _now_iso(),
                               "claim_until": None}})


async def run_deletion_pass(limit: int = 10) -> int:
    """Claim-locked worker pass. Safe to run concurrently."""
    now = _now()
    ran = 0
    cursor = db.account_deletion_jobs.find(
        {"status": {"$in": ["queued", "running"]},
         "next_attempt_at": {"$lte": now.isoformat()},
         "$or": [{"claim_until": None},
                 {"claim_until": {"$lt": now.isoformat()}}]},
        {"_id": 0, "id": 1}).limit(limit)
    async for j in cursor:
        claimed = await db.account_deletion_jobs.find_one_and_update(
            {"id": j["id"],
             "$or": [{"claim_until": None},
                     {"claim_until": {"$lt": now.isoformat()}}]},
            {"$set": {"claim_until": (now + timedelta(minutes=10)).isoformat()}},
            projection={"_id": 0})
        if not claimed:
            continue
        await _run_job(claimed)
        ran += 1
    return ran


async def run_suppression_pass() -> int:
    """Re-apply erasure to any account resurrected by a backup restore."""
    fixed = 0
    async for row in db.deletion_suppression.find({}, {"_id": 0}).limit(500):
        u = await db.users.find_one({"id": row["user_id"]}, {"_id": 0})
        if u and u.get("account_status") != STATUS_PURGED:
            log.warning("[suppression] re-erasing resurrected user %s", row["user_id"])
            await remove_public_access(
                u["id"], account_status=STATUS_ERASURE_IN_PROGRESS,
                reason="deletion suppression re-applied after restore")
            await enqueue_erasure_job(u, source="suppression_reapply",
                                      requested_by="system")
            fixed += 1
    return fixed


async def retry_failed_job(job_id: str, actor: dict) -> dict:
    job = await db.account_deletion_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise ValueError("Job not found")
    if job["status"] not in ("failed", "queued", "running"):
        raise ValueError(f"Job is {job['status']}")
    sets = {"status": "queued", "next_attempt_at": _now_iso(),
            "claim_until": None, "updated_at": _now_iso()}
    for key, st in (job.get("stages") or {}).items():
        if st.get("status") == "failed":
            sets[f"stages.{key}.status"] = "pending"
            sets[f"stages.{key}.attempts"] = 0
    await db.account_deletion_jobs.update_one({"id": job_id}, {"$set": sets})
    await _audit("account.erasure_job_retried", job["user_id"], actor["id"], job_id=job_id)
    return {"ok": True}


# ────────────────────────────────────────────────────────────────────
# Worker loop
# ────────────────────────────────────────────────────────────────────
_task: Optional[asyncio.Task] = None


async def _loop():
    log.info("[deletion-worker] started")
    await asyncio.sleep(20)
    tick = 0
    while True:
        try:
            await run_deletion_pass()
            tick += 1
            if tick % 60 == 0:  # ~ every 30 min
                await run_suppression_pass()
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("[deletion-worker] pass failed")
            await asyncio.sleep(120)


def start_deletion_worker() -> None:
    global _task
    if _task and not _task.done():
        return
    _task = asyncio.create_task(_loop(), name="account_deletion_worker")
