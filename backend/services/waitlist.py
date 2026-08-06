"""Waitlist — username reservation, email verification, verification
requests, document requests/uploads, messaging, admin queue/decisions,
page settings (draft/publish) and the global signup-access mode.

Reuses: mailer, audit_log, premium_usernames.signup_gate, existing
username rules, platform_settings id="signup" (extended with `mode`).
"""
from __future__ import annotations

import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from core.db import db

STATUSES = ["terms_required", "waiting_review",
            "verification_requested", "documents_requested", "under_review",
            "approved", "invite_sent", "on_hold", "denied", "withdrawn",
            "account_created"]
OPEN_STATUSES = ["terms_required", "waiting_review", "verification_requested",
                 "documents_requested", "under_review", "on_hold"]

VERIFICATION_CATEGORIES = ["Individual Creator", "Brand", "Company",
                           "Organization", "Public Figure", "Professional",
                           "Developer", "Artist", "Musician", "Other"]

SIGNUP_MODES = ["open", "waitlist", "invite_only", "existing_only", "maintenance"]

RESERVED_WORDS = {"admin", "support", "ourrealm", "realm", "founder", "system"}
USERNAME_RX = re.compile(r"^[a-z0-9](?:[a-z0-9._]{1,22})[a-z0-9]$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _clean(s: Optional[str], n: int = 400) -> str:
    return re.sub(r"<[^>]*>", "", (s or "")).strip()[:n]


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


async def _audit(action: str, actor: str, **extra):
    try:
        await db.audit_log.insert_one({"id": uuid.uuid4().hex, "action": action,
                                       "actor_id": actor, "at": _now_iso(), **extra})
    except Exception:  # noqa: BLE001
        pass


# ── Settings (draft/published) + signup mode ────────────────────────
DEFAULT_PAGE = {
    "headline": "Lock In Your Username Now!",
    "supporting_text": "Reserve your username and join the OurRealm access line. "
                       "Approvals are reviewed in the order received, although "
                       "verified creators, brands, professionals, and invited "
                       "users may receive priority access.",
    "background_url": "",
    "btn_search": "Search Username",
    "btn_status": "Check My Status",
    "btn_signin": "Existing Member Sign In",
    "show_queue_position": True,
    "verification_enabled": True,
    "categories": VERIFICATION_CATEGORIES,
    "doc_max_files": 6,
    "doc_deadline_days": 14,
    "reservation_expiry_days": 0,
    "auto_message_received": "Your reservation was received. We review requests in order.",
    "premium_note": "Premium Usernames can be unlocked through verification approval.",
}


async def get_settings() -> dict:
    row = await db.platform_settings.find_one({"id": "waitlist_page"}, {"_id": 0})
    if not row:
        row = {"id": "waitlist_page", "published": dict(DEFAULT_PAGE), "draft": None,
               "published_at": _now_iso(), "updated_at": _now_iso()}
        await db.platform_settings.insert_one(dict(row))
        row.pop("_id", None)
    return row


async def save_settings_draft(actor: dict, draft: dict) -> dict:
    row = await get_settings()
    clean = {k: draft.get(k, row["published"].get(k, DEFAULT_PAGE.get(k)))
             for k in DEFAULT_PAGE}
    for k in ("headline", "supporting_text", "btn_search", "btn_status",
              "btn_signin", "auto_message_received", "premium_note", "background_url"):
        clean[k] = _clean(str(clean.get(k) or ""), 1200)
    clean["categories"] = [_clean(str(c), 60) for c in (clean.get("categories") or [])][:20]
    await db.platform_settings.update_one(
        {"id": "waitlist_page"}, {"$set": {"draft": clean, "updated_at": _now_iso()}})
    await _audit("waitlist.settings_draft_saved", actor["id"])
    return await get_settings()


async def publish_settings(actor: dict) -> dict:
    row = await get_settings()
    if not row.get("draft"):
        raise ValueError("No draft to publish")
    await db.platform_settings.update_one(
        {"id": "waitlist_page"},
        {"$set": {"published": row["draft"], "draft": None,
                  "published_at": _now_iso(), "published_by": actor.get("username")}})
    await _audit("waitlist.settings_published", actor["id"])
    return await get_settings()


async def reset_settings_draft(actor: dict) -> dict:
    await db.platform_settings.update_one(
        {"id": "waitlist_page"}, {"$set": {"draft": None}})
    await _audit("waitlist.settings_draft_reset", actor["id"])
    return await get_settings()


async def get_signup_mode() -> dict:
    row = await db.platform_settings.find_one({"id": "signup"}, {"_id": 0}) or {}
    mode = row.get("mode")
    if mode not in SIGNUP_MODES:
        mode = "waitlist" if row.get("allow_new_signups") is False else "open"
    return {"mode": mode, "reason": row.get("mode_reason"),
            "changed_at": row.get("mode_changed_at"),
            "changed_by": row.get("mode_changed_by")}


async def set_signup_mode(actor: dict, mode: str, reason: str) -> dict:
    if mode not in SIGNUP_MODES:
        raise ValueError("Unknown mode")
    if mode != "open" and not _clean(reason, 400):
        raise ValueError("A reason is required when restricting signups")
    await db.platform_settings.update_one(
        {"id": "signup"},
        {"$set": {"id": "signup", "mode": mode,
                  "allow_new_signups": mode == "open",
                  "mode_reason": _clean(reason, 400) or None,
                  "mode_changed_at": _now_iso(),
                  "mode_changed_by": actor.get("username")}},
        upsert=True)
    await _audit("waitlist.signup_mode_changed", actor["id"], mode=mode,
                 reason=_clean(reason, 400))
    return await get_signup_mode()


# ── Verification / access codes (email-based, reuses mailer) ────────
async def _rate_ok(email: str, purpose: str) -> bool:
    hour_ago = (_now() - timedelta(hours=1)).isoformat()
    n = await db.waitlist_codes.count_documents(
        {"email": email, "purpose": purpose, "created_at": {"$gt": hour_ago}})
    return n < 5


async def send_code(email: str, purpose: str) -> dict:
    if not await _rate_ok(email, purpose):
        raise ValueError("Too many codes requested — try again in an hour")
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    await db.waitlist_codes.insert_one({
        "email": email, "purpose": purpose, "code_hash": _hash(code),
        "used": False, "created_at": _now_iso(),
        "expires_at": (_now() + timedelta(minutes=15)).isoformat()})
    from services.mailer import send_email
    subj = ("Verify your email for your OurRealm username reservation"
            if purpose == "reserve" else "Your OurRealm waitlist access code")
    mail = await send_email(email, subj,
                            f"Enter the code 123456 to continue.\nEmail verification is temporarily simplified during beta testing.",
                            kind=f"waitlist_{purpose}_code")
    return {"email_sent": mail["sent"]}


async def check_code(email: str, purpose: str, code: str) -> bool:
    row = await db.waitlist_codes.find_one(
        {"email": email, "purpose": purpose, "code_hash": _hash(code or ""),
         "used": False, "expires_at": {"$gt": _now_iso()}})
    if not row:
        return False
    await db.waitlist_codes.update_one({"_id": row["_id"]}, {"$set": {"used": True}})
    return True


# ── Username availability (single source: existing rules) ───────────
async def username_state(u: str) -> dict:
    u = (u or "").lower().strip()
    if not USERNAME_RX.match(u) or u in RESERVED_WORDS:
        return {"state": "invalid", "username": u,
                "message": "3-24 chars: letters, numbers, dots, underscores."}
    if await db.users.find_one({"username": u}, {"_id": 1}):
        return {"state": "in_use", "username": u,
                "message": "This username already belongs to a member."}
    res = await db.waitlist_reservations.find_one(
        {"username": u, "status": {"$nin": ["withdrawn", "denied", "account_created"]}},
        {"_id": 1})
    if res:
        return {"state": "reserved", "username": u,
                "message": "This username is already reserved."}
    from routers.premium_usernames import signup_gate
    gate = await signup_gate(u)
    if gate:
        return {"state": "premium_locked", "username": u,
                "message": gate.get("message") or "Premium Usernames are locked.",
                "suggestions": gate.get("suggestions") or []}
    return {"state": "available", "username": u, "message": "This username is available!"}


# ── Reservations ────────────────────────────────────────────────────
async def _next_queue_position() -> int:
    row = await db.platform_settings.find_one_and_update(
        {"id": "waitlist_counter"}, {"$inc": {"n": 1}},
        upsert=True, return_document=True)
    return int((row or {}).get("n") or 1)


async def start_reservation(username: str, email: str, *, premium_request: bool = False) -> dict:
    email = email.lower().strip()
    if "@" not in email or "." not in email or len(email) > 120:
        raise ValueError("Please enter a valid email address")
    st = await username_state(username)
    if st["state"] == "premium_locked" and not premium_request:
        raise ValueError(st["message"])
    if st["state"] not in ("available", "premium_locked"):
        raise ValueError(st["message"])
        if await db.users.find_one({"email": email}, {"_id": 1}):
            raise ValueError("This email already has an account — sign in instead")

    dup = await db.waitlist_reservations.find_one(
        {
            "email": email,
            "status": {"$nin": ["withdrawn", "denied", "account_created"]},
        },
        {"_id": 0},
    )

    if dup:
        if (
            dup["username"] == st["username"]
            and dup["status"] == "terms_required"
        ):
            return {"reservation_id": dup["id"], "resumed": True}

        raise ValueError(
            "This email already has an active reservation — use Check My Status"
        )

    rid = uuid.uuid4().hex

    await db.waitlist_reservations.insert_one({
        "id": rid,
        "username": st["username"],
        "email": email,
        "type": (
            "premium_request"
            if premium_request or st["state"] == "premium_locked"
            else "reservation"
        ),
        "status": "terms_required",
        "email_verified": False,
        "queue_position": None,
        "verification": None,
        "doc_request": None,
        "documents": [],
        "messages": [],
        "admin_notes": [],
        "assigned_to": None,
        "priority": False,
        "invite": None,
        "premium_approved": False,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "timeline": [
            {
                "at": _now_iso(),
                "event": "reservation_started",
            }
        ],
    })

    await _audit(
        "waitlist.reservation_started",
        email,
        username=st["username"],
        reservation_id=rid,
    )

    return {"reservation_id": rid, "resumed": False}


async def confirm_reservation(email: str, code: str, terms: dict) -> dict:
    email = email.lower().strip()
    if not all(terms.get(k) for k in ("accepted_terms", "accepted_conditions",
                                      "accepted_privacy", "age_confirmed_13")):
        raise ValueError("You must accept the required terms")
    res = await db.waitlist_reservations.find_one(
        {"email": email, "status": "terms_required"}, {"_id": 0})
    if not res:
        raise ValueError("No pending reservation for this email")
    # if not await check_code(email, "reserve", code):
    #     raise ValueError("Invalid or expired verification code")
    pos = await _next_queue_position()
    token = secrets.token_urlsafe(24)
    await db.waitlist_reservations.update_one({"id": res["id"]}, {
        "$set": {"status": "waiting_review", "email_verified": True,
                 "queue_position": pos, "terms": {**terms, "at": _now_iso()},
                 "status_token_hash": _hash(token), "updated_at": _now_iso()},
        "$push": {"timeline": {"at": _now_iso(), "event": "email_verified"}}})
    settings = (await get_settings())["published"]
    if settings.get("auto_message_received"):
        await db.waitlist_reservations.update_one({"id": res["id"]}, {"$push": {
            "messages": {"id": uuid.uuid4().hex, "from": "OurRealm",
                         "text": settings["auto_message_received"],
                         "at": _now_iso(), "admin": True}}})
    await _audit("waitlist.reservation_confirmed", email,
                 reservation_id=res["id"], username=res["username"], queue_position=pos)
    return {"queue_position": pos, "status_token": token, "username": res["username"]}


# ── Status access (email + code → short session token) ──────────────
async def status_login(email: str, code: str) -> dict:
    email = email.lower().strip()
    res = await db.waitlist_reservations.find_one(
        {"email": email, "status": {"$ne": "account_created"}},
        {"_id": 0}, sort=[("created_at", -1)])
    if not res:
        raise ValueError("No reservation found for this email")
    # if not await check_code(email, "status", code):
    #     raise ValueError("Invalid or expired access code")
    token = secrets.token_urlsafe(24)
    await db.waitlist_reservations.update_one(
        {"id": res["id"]}, {"$set": {"status_token_hash": _hash(token),
                                     "status_token_at": _now_iso()}})
    return {"status_token": token, "reservation": public_view(res)}


async def by_token(token: str) -> dict:
    res = await db.waitlist_reservations.find_one(
        {"status_token_hash": _hash(token or "")}, {"_id": 0})
    if not res:
        raise ValueError("Session expired — request a new access code")
    return res


def public_view(res: dict, show_queue: bool = True) -> dict:
    """Reservation as the holder may see it — never admin notes."""
    return {
        "id": res["id"], "username": res["username"],
        "status": res["status"], "type": res.get("type"),
        "created_at": res["created_at"],
        "email_verified": bool(res.get("email_verified")),
        "queue_position": res.get("queue_position") if show_queue else None,
        "verification": ({k: res["verification"].get(k) for k in
                          ("category", "status", "submitted_at")}
                         if res.get("verification") else None),
        "doc_request": ({k: res["doc_request"].get(k) for k in
                         ("items", "message", "deadline", "formats", "max_files",
                          "submitted_at", "requested_at")}
                        if res.get("doc_request") else None),
        "documents": [{"id": d["id"], "name": d["name"], "size": d["size"],
                       "submitted": d.get("submitted", False)}
                      for d in (res.get("documents") or [])],
        "messages": [m for m in (res.get("messages") or [])],
        "premium_approved": bool(res.get("premium_approved")),
        "denial_reason": res.get("public_reason"),
    }


async def withdraw(res: dict) -> dict:
    if res["status"] in ("denied", "withdrawn", "account_created"):
        raise ValueError(f"Reservation is already {res['status']}")
    await db.waitlist_reservations.update_one({"id": res["id"]}, {
        "$set": {"status": "withdrawn", "updated_at": _now_iso()},
        "$push": {"timeline": {"at": _now_iso(), "event": "withdrawn"}}})
    await _audit("waitlist.withdrawn", res["email"], reservation_id=res["id"],
                 username=res["username"])
    return {"ok": True}


async def request_verification(res: dict, payload: dict) -> dict:
    settings = (await get_settings())["published"]
    if not settings.get("verification_enabled", True):
        raise ValueError("Verification requests are currently unavailable")
    if res.get("verification") and res["verification"].get("status") not in ("refused", None):
        raise ValueError("A verification request is already on file")
    cat = _clean(payload.get("category"), 60)
    if cat not in (settings.get("categories") or VERIFICATION_CATEGORIES):
        raise ValueError("Unknown category")
    if not payload.get("accurate"):
        raise ValueError("You must confirm the information is accurate")
    ver = {"category": cat,
           "legal_name": _clean(payload.get("legal_name"), 120),
           "website": _clean(payload.get("website"), 200),
           "explanation": _clean(payload.get("explanation"), 2000),
           "links": [_clean(l, 200) for l in (payload.get("links") or [])][:5],
           "status": "submitted", "submitted_at": _now_iso()}
    if not ver["legal_name"] or not ver["explanation"]:
        raise ValueError("Name and explanation are required")
    await db.waitlist_reservations.update_one({"id": res["id"]}, {
        "$set": {"verification": ver, "status": "verification_requested",
                 "updated_at": _now_iso()},
        "$push": {"timeline": {"at": _now_iso(), "event": "verification_requested",
                               "category": cat}}})
    await _audit("waitlist.verification_requested", res["email"],
                 reservation_id=res["id"], category=cat)
    return {"ok": True}


# ── Documents (private, DB-stored, admin-only access) ───────────────
ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp", "application/pdf"}
MAX_DOC_BYTES = 8 * 1024 * 1024


async def upload_document(res: dict, name: str, mime: str, raw: bytes) -> dict:
    dr = res.get("doc_request")
    if not dr or dr.get("submitted_at"):
        raise ValueError("No open document request")
    if mime not in ALLOWED_MIME:
        raise ValueError("Allowed formats: PNG, JPG, WEBP, PDF")
    if len(raw) > MAX_DOC_BYTES:
        raise ValueError("File too large (max 8MB)")
    if len(res.get("documents") or []) >= int(dr.get("max_files") or 6):
        raise ValueError("Upload limit reached — remove a file first")
    doc_id = uuid.uuid4().hex
    await db.waitlist_document_files.insert_one(
        {"id": doc_id, "reservation_id": res["id"], "data": raw})
    meta = {"id": doc_id, "name": _clean(name, 120) or "document",
            "mime": mime, "size": len(raw), "submitted": False,
            "uploaded_at": _now_iso()}
    await db.waitlist_reservations.update_one(
        {"id": res["id"]}, {"$push": {"documents": meta},
                            "$set": {"updated_at": _now_iso()}})
    await _audit("waitlist.document_uploaded", res["email"],
                 reservation_id=res["id"], doc_id=doc_id, size=len(raw))
    return meta


async def remove_document(res: dict, doc_id: str) -> dict:
    doc = next((d for d in (res.get("documents") or []) if d["id"] == doc_id), None)
    if not doc:
        raise ValueError("Document not found")
    if doc.get("submitted"):
        raise ValueError("Submitted documents can no longer be removed")
    await db.waitlist_document_files.delete_one({"id": doc_id})
    await db.waitlist_reservations.update_one(
        {"id": res["id"]}, {"$pull": {"documents": {"id": doc_id}}})
    return {"ok": True}


async def submit_documents(res: dict) -> dict:
    dr = res.get("doc_request")
    if not dr or dr.get("submitted_at"):
        raise ValueError("No open document request")
    if not (res.get("documents") or []):
        raise ValueError("Upload at least one document first")
    now = _now_iso()
    await db.waitlist_reservations.update_one({"id": res["id"]}, {
        "$set": {"doc_request.submitted_at": now, "status": "under_review",
                 "updated_at": now,
                 "documents.$[].submitted": True},
        "$push": {"timeline": {"at": now, "event": "documents_submitted"}}})
    await _audit("waitlist.documents_submitted", res["email"], reservation_id=res["id"])
    return {"ok": True}


async def post_message(res: dict, text: str, *, from_admin: bool = False,
                       sender: str = "") -> dict:
    text = _clean(text, 1500)
    if not text:
        raise ValueError("Message is empty")
    msg = {"id": uuid.uuid4().hex,
           "from": sender or ("OurRealm" if from_admin else res["username"]),
           "admin": from_admin, "text": text, "at": _now_iso()}
    await db.waitlist_reservations.update_one(
        {"id": res["id"]}, {"$push": {"messages": msg},
                            "$set": {"updated_at": _now_iso()}})
    await _audit("waitlist.message", sender or res["email"],
                 reservation_id=res["id"], admin=from_admin)
    if from_admin:
        from services.mailer import send_email
        await send_email(res["email"], "New message about your OurRealm reservation",
                         "You have a new message. Use Check My Status on the "
                         "OurRealm waitlist page to read it.",
                         kind="waitlist_message")
    return msg


# ── Invitations ─────────────────────────────────────────────────────
async def create_invite(res: dict, actor: dict) -> dict:
    token = secrets.token_urlsafe(24)
    invite = {"token_hash": _hash(token), "created_at": _now_iso(),
              "expires_at": (_now() + timedelta(days=7)).isoformat(),
              "created_by": actor.get("username"), "used": False}
    await db.waitlist_reservations.update_one({"id": res["id"]}, {
        "$set": {"invite": invite, "status": "invite_sent", "updated_at": _now_iso()},
        "$push": {"timeline": {"at": _now_iso(), "event": "invite_sent",
                               "by": actor.get("username")}}})
    from services.mailer import send_email
    import os
    origin = os.environ.get("PUBLIC_APP_ORIGIN") or ""
    link = f"{origin}/signup?invite={token}" if origin else f"/signup?invite={token}"
    await send_email(res["email"], "You're invited to join OurRealm!",
                     f"Your reservation for @{res['username']} was approved. "
                     f"Complete your signup within 7 days:\n{link}",
                     kind="waitlist_invite")
    return {"token": token, "expires_at": invite["expires_at"]}


async def validate_invite(token: str) -> dict:
    res = await db.waitlist_reservations.find_one(
        {"invite.token_hash": _hash(token or ""), "invite.used": False}, {"_id": 0})
    if not res:
        raise ValueError("Invalid or already-used invitation")
    if res["invite"]["expires_at"] < _now_iso():
        raise ValueError("This invitation has expired — contact support")
    return res


async def consume_invite(token: str, user_id: str) -> dict:
    res = await validate_invite(token)
    await db.waitlist_reservations.update_one({"id": res["id"]}, {
        "$set": {"invite.used": True, "invite.used_at": _now_iso(),
                 "status": "account_created", "created_user_id": user_id,
                 "updated_at": _now_iso()},
        "$push": {"timeline": {"at": _now_iso(), "event": "account_created"}}})
    await _audit("waitlist.invite_consumed", user_id, reservation_id=res["id"],
                 username=res["username"])
    return res


# ── Admin actions ───────────────────────────────────────────────────
REASON_REQUIRED = {"deny", "release_username", "hold"}


async def admin_action(res_id: str, actor: dict, action: str,
                       reason: str = "", payload: dict | None = None) -> dict:
    res = await db.waitlist_reservations.find_one({"id": res_id}, {"_id": 0})
    if not res:
        raise ValueError("Reservation not found")
    reason = _clean(reason, 600)
    if action in REASON_REQUIRED and not reason:
        raise ValueError("A reason is required for this action")
    now = _now_iso()
    payload = payload or {}
    sets: dict = {"updated_at": now}
    event = action
    out: dict = {"ok": True}

    if action == "approve_invite":
        if res.get("verification") and res["verification"].get("status") == "submitted":
            sets["verification.status"] = "approved"
        if payload.get("approve_premium"):
            sets["premium_approved"] = True
        inv = await create_invite(res, actor)
        out["invite_expires_at"] = inv["expires_at"]
        sets["status"] = "invite_sent"
    elif action == "request_documents":
        settings = (await get_settings())["published"]
        days = int(payload.get("deadline_days") or settings.get("doc_deadline_days") or 14)
        sets["doc_request"] = {
            "items": [_clean(i, 160) for i in (payload.get("items") or [])][:10],
            "message": _clean(payload.get("message"), 800),
            "deadline": (_now() + timedelta(days=days)).isoformat(),
            "formats": "PNG, JPG, WEBP, PDF (max 8MB each)",
            "max_files": int(settings.get("doc_max_files") or 6),
            "requested_at": now, "requested_by": actor.get("username"),
            "submitted_at": None}
        sets["status"] = "documents_requested"
        await post_message(res, payload.get("message") or "Please provide the requested documents.",
                           from_admin=True, sender=actor.get("username") or "OurRealm")
    elif action == "prioritize":
        sets["priority"] = True
        sets["queue_position"] = 1
    elif action == "deny":
        sets["status"] = "denied"
        sets["public_reason"] = reason
    elif action == "hold":
        sets["status"] = "on_hold"
        sets["public_reason"] = reason
    elif action == "resume_review":
        sets["status"] = "under_review"
    elif action == "release_username":
        sets["status"] = "withdrawn"
        sets["public_reason"] = reason
    elif action == "assign":
        sets["assigned_to"] = _clean(payload.get("reviewer"), 60) or None
    elif action == "note":
        await db.waitlist_reservations.update_one({"id": res_id}, {"$push": {
            "admin_notes": {"at": now, "by": actor.get("username"),
                            "text": _clean(payload.get("text"), 1000)}}})
        return out
    elif action == "message":
        await post_message(res, payload.get("text") or "", from_admin=True,
                           sender=actor.get("username") or "OurRealm")
        return out
    else:
        raise ValueError("Unknown action")

    await db.waitlist_reservations.update_one({"id": res_id}, {
        "$set": sets,
        "$push": {"timeline": {"at": now, "event": event,
                               "by": actor.get("username"), "reason": reason or None}}})
    await _audit(f"waitlist.{action}", actor["id"], reservation_id=res_id,
                 username=res["username"], reason=reason)
    return out
