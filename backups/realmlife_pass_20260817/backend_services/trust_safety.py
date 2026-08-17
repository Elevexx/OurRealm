"""Trust & Safety Command Center — ORAi universal moderation engine.

Extends (never replaces) services/moderation.py + content_safety.py:
- 12-dimension scoring on every scanned content piece
- progressive Trust Score per account with tiered limits
- automatic escalation ladder (warn → limit → auto-lock pending founder review)
- founder priority queue (ts_cases), audit trail (ts_audit), appeals (ts_appeals)
- natural-language founder commands + bulk actions
AI never permanently bans or deletes — founder/admin confirmation required.
"""
import hashlib
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from core.db import db

log = logging.getLogger("ourrealm.trust_safety")

SCORE_KEYS = ["spam", "toxicity", "harassment", "hate", "scam", "sexual", "violence",
              "self_harm", "illegal", "impersonation", "bot_probability", "confidence"]

REASON_SCORES = {  # moderation.py triggered reason → score dimensions
    "threats": {"violence": 0.95, "harassment": 0.7, "toxicity": 0.8},
    "self_harm": {"self_harm": 0.9},
    "hate": {"hate": 0.9, "toxicity": 0.8},
    "sexual": {"sexual": 0.8},
    "bullying": {"harassment": 0.85, "toxicity": 0.75},
    "phishing": {"scam": 0.8, "illegal": 0.5},
    "scam": {"scam": 0.75},
    "spam": {"spam": 0.7},
    "suspicious_url": {"scam": 0.6, "spam": 0.5},
}

SQLI_PATTERNS = [r"(?i)('|%27)\s*(or|and)\s+('|%27)?\d+\s*=\s*\d+", r"(?i)\bunion\s+select\b",
                 r"(?i)\bdrop\s+table\b", r"(?i);\s*delete\s+from\b", r"(?i)\bexec\s*\(\s*xp_"]
IMPERSONATION_TERMS = [r"(?i)\bofficial\s+(ourrealm|admin|support|staff)\b",
                       r"(?i)\b(ourrealm|realm)\s*(support|admin|staff)\b"]

TIERS = {"limited": {"min": 0, "posts_per_day": 5, "comments_per_day": 10, "dms_per_day": 5,
                     "friend_requests_per_day": 5, "livestream": False, "realm_creation": False},
         "standard": {"min": 30, "posts_per_day": 25, "comments_per_day": 60, "dms_per_day": 40,
                      "friend_requests_per_day": 20, "livestream": False, "realm_creation": True},
         "trusted": {"min": 60, "posts_per_day": 60, "comments_per_day": 150, "dms_per_day": 120,
                     "friend_requests_per_day": 40, "livestream": True, "realm_creation": True},
         "veteran": {"min": 80, "posts_per_day": 200, "comments_per_day": 400, "dms_per_day": 300,
                     "friend_requests_per_day": 80, "livestream": True, "realm_creation": True}}

PRIORITY_REASONS = {"impersonation": 95, "violence": 95, "illegal": 95, "hate": 90,
                    "harassment": 85, "scam": 85, "self_harm": 88, "spam": 70,
                    "bot_probability": 65, "toxicity": 60, "sexual": 75}

CAPS = ["posting", "commenting", "messaging", "uploads"]


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _ago(hours):
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def _fp(text):
    return hashlib.sha1(re.sub(r"\s+", " ", (text or "").lower().strip()).encode()).hexdigest()


# ── 1. Universal scoring ─────────────────────────────────────────────
async def score_content(text: str, triggered: list, base_score: float, user_id: str) -> dict:
    scores = {k: 0.0 for k in SCORE_KEYS}
    for reason in triggered or []:
        for dim, v in REASON_SCORES.get(reason, {}).items():
            scores[dim] = max(scores[dim], v)
    if any(re.search(p, text or "") for p in SQLI_PATTERNS):
        scores["illegal"] = max(scores["illegal"], 0.8)
        scores["spam"] = max(scores["spam"], 0.6)
    if any(re.search(p, text or "") for p in IMPERSONATION_TERMS):
        scores["impersonation"] = max(scores["impersonation"], 0.75)
    # behavioral: duplicates + rate → spam/bot
    since = _ago(1)
    fp = _fp(text)
    dupes = await db.ts_events.count_documents(
        {"user_id": user_id, "fingerprint": fp, "at": {"$gte": since}}) if text else 0
    rate = await db.ts_events.count_documents({"user_id": user_id, "at": {"$gte": since}})
    if dupes >= 2:
        scores["spam"] = max(scores["spam"], 0.75)
        scores["bot_probability"] = max(scores["bot_probability"], 0.6)
    if rate >= 12:
        scores["bot_probability"] = max(scores["bot_probability"], 0.7)
        scores["spam"] = max(scores["spam"], 0.6)
    top = max((v for k, v in scores.items() if k != "confidence"), default=0.0)
    scores["confidence"] = round(min(0.55 + top * 0.45, 0.98), 2) if top else round(max(base_score, 0.3), 2)
    return {k: round(v, 2) for k, v in scores.items()}


# ── 2. Trust Score ───────────────────────────────────────────────────
async def compute_trust(user_id: str) -> dict:
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "created_at": 1, "email": 1,
                                                  "email_verified": 1, "phone_verified": 1}) or {}
    now = datetime.now(timezone.utc)
    factors = {}
    score = 50.0
    try:
        created = datetime.fromisoformat(str(u.get("created_at")).replace("Z", "+00:00"))
        age_days = max((now - created).days, 0)
    except Exception:  # noqa: BLE001
        age_days = 0
    factors["account_age_days"] = age_days
    score += min(age_days * 0.5, 20)
    if u.get("email"):
        score += 5
        factors["verified_email"] = True
    if u.get("phone_verified"):
        score += 5
        factors["verified_phone"] = True
    week = _ago(24 * 7)
    violations = await db.ts_events.count_documents({"user_id": user_id, "violation": True, "at": {"$gte": week}})
    reports = await db.reports.count_documents({"target_user_id": user_id, "created_at": {"$gte": week}})
    mod_actions = await db.ts_audit.count_documents({"target_user_id": user_id, "human_decision": {"$ne": None}})
    appeals_ok = await db.ts_appeals.count_documents({"user_id": user_id, "status": "approved"})
    rate_1h = await db.ts_events.count_documents({"user_id": user_id, "at": {"$gte": _ago(1)}})
    factors.update({"violations_7d": violations, "reports_7d": reports,
                    "moderator_actions": mod_actions, "appeals_approved": appeals_ok,
                    "activity_rate_1h": rate_1h})
    score -= violations * 8 + reports * 4 + mod_actions * 5
    score += appeals_ok * 4
    if rate_1h >= 12:
        score -= 10
    score = round(max(0.0, min(score, 100.0)), 1)
    tier = "limited"
    for name, cfg in TIERS.items():
        if score >= cfg["min"]:
            tier = name
    trust = {"score": score, "tier": tier, "factors": factors,
             "limits": {k: v for k, v in TIERS[tier].items() if k != "min"},
             "updated_at": _iso()}
    await db.users.update_one({"id": user_id}, {"$set": {"trust": trust}})
    return trust


# ── 3. Audit trail ───────────────────────────────────────────────────
async def audit(*, actor, action, target_user_id=None, content_type=None, content_id=None,
                reason="", ai_recommendation=None, human_decision=None,
                prev_state=None, new_state=None, meta=None) -> str:
    aid = uuid.uuid4().hex
    await db.ts_audit.insert_one({
        "id": aid, "action": action,
        "initiated_by": (actor or {}).get("username") or "orai:auto",
        "initiated_by_id": (actor or {}).get("id"),
        "ai_recommendation": ai_recommendation, "human_decision": human_decision,
        "target_user_id": target_user_id, "content_type": content_type, "content_id": content_id,
        "reason": str(reason or "")[:400], "prev_state": prev_state, "new_state": new_state,
        "appeal_status": None, "meta": meta or {}, "at": _iso()})
    return aid


# ── 4. Cases (founder priority queue) ────────────────────────────────
async def ensure_case(user_id: str, reasons: list, summary_bits: list, escalate=False):
    prio = max([PRIORITY_REASONS.get(r, 50) for r in reasons] or [50])
    existing = await db.ts_cases.find_one({"user_id": user_id, "status": "open"})
    if existing:
        await db.ts_cases.update_one({"id": existing["id"]}, {
            "$set": {"priority": max(existing.get("priority", 0), prio),
                     "escalated": existing.get("escalated") or escalate, "updated_at": _iso()},
            "$addToSet": {"reasons": {"$each": reasons}},
            "$push": {"timeline": {"at": _iso(), "note": "; ".join(summary_bits)[:250]}}})
        return existing["id"]
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1, "trust": 1})
    cid = uuid.uuid4().hex
    await db.ts_cases.insert_one({
        "id": cid, "user_id": user_id, "username": (u or {}).get("username"),
        "status": "open", "priority": prio, "reasons": reasons, "escalated": escalate,
        "ai_summary": "; ".join(summary_bits)[:400],
        "trust_snapshot": (u or {}).get("trust"),
        "timeline": [{"at": _iso(), "note": "case opened: " + "; ".join(summary_bits)[:200]}],
        "created_at": _iso(), "updated_at": _iso()})
    return cid


# ── 5. Escalation ladder ─────────────────────────────────────────────
async def _set_limits(user_id: str, caps: list, hours: int, reason: str):
    await db.users.update_one({"id": user_id}, {"$set": {"account_limits": {
        "active": True, "capabilities": caps, "reason": reason,
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(),
        "set_at": _iso(), "set_by": "orai:auto"}}})


async def auto_lock(user_id: str, reason: str):
    """Auto-lock — TEMPORARY, pending founder review. Never a permanent ban."""
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "ts_status": 1})
    if (u or {}).get("ts_status") == "locked_pending_founder_review":
        return
    prev = (u or {}).get("ts_status") or "active"
    await db.users.update_one({"id": user_id}, {"$set": {
        "ts_status": "locked_pending_founder_review",
        "profile_hidden": True,
        "suspended_until": (datetime.now(timezone.utc) + timedelta(hours=72)).isoformat(),
        "suspended_at": _iso(), "suspended_by": "orai:auto",
        "suspension_reason": f"Pending Founder Review — {reason}"[:200]}})
    await _set_limits(user_id, CAPS, 72, f"auto-lock: {reason}")
    aid = await audit(actor=None, action="auto_lock_pending_review", target_user_id=user_id,
                      reason=reason, ai_recommendation="lock_pending_founder_review",
                      prev_state={"ts_status": prev}, new_state={"ts_status": "locked_pending_founder_review"})
    for coll in ("posts", "comments"):
        await getattr(db, coll).update_many(
            {"author_id": user_id, "moderation_status": {"$nin": ["hidden", "removed_by_moderator"]}},
            {"$set": {"moderation_status": "hidden", "moderated_by": "auto:ts_lock",
                      "moderation_meta.audit_id": aid, "moderated_at": _iso()}})


async def escalate(user_id: str, scores: dict, reasons: list, content_ref: str):
    day = _ago(24)
    total = await db.ts_events.count_documents({"user_id": user_id, "violation": True, "at": {"$gte": day}})
    severe = await db.ts_events.count_documents(
        {"user_id": user_id, "violation": True, "severity": "severe", "at": {"$gte": day}})
    summary = [f"{r} detected" for r in reasons[:3]] + [f"{total} violation(s) in 24h"]
    if severe >= 2 or total >= 5:
        await ensure_case(user_id, reasons, summary + ["AUTO-LOCKED pending founder review"], escalate=True)
        await auto_lock(user_id, f"{severe} severe / {total} total violations in 24h")
        return "auto_locked"
    if total >= 3:
        await _set_limits(user_id, ["posting", "commenting", "messaging", "uploads"], 24,
                          f"repeated violations ({total} in 24h)")
        await ensure_case(user_id, reasons, summary + ["temporary limits applied (24h)"])
        await audit(actor=None, action="auto_temp_limit", target_user_id=user_id,
                    reason=f"{total} violations in 24h", ai_recommendation="temp_limit_24h",
                    new_state={"account_limits": "posting/commenting/messaging/uploads 24h"})
        return "temp_limited"
    if total >= 1:
        await ensure_case(user_id, reasons, summary)
        return "warned"
    return "none"


# ── 6. Main hook — called from moderation.scan_and_apply ─────────────
async def on_content_scanned(content_type: str, content_id: str, user_id: str,
                             text: str, decision_status: str, triggered: list, base_score: float):
    try:
        if not user_id:
            return
        scores = await score_content(text, triggered, base_score, user_id)
        reasons = [k for k in PRIORITY_REASONS if scores.get(k, 0) >= 0.6]
        violation = decision_status in ("hidden", "pending_review") or bool(reasons)
        severity = "severe" if max((scores[k] for k in scores if k != "confidence"), default=0) >= 0.8 else \
            ("minor" if violation else "none")
        await db.ts_events.insert_one({
            "id": uuid.uuid4().hex, "user_id": user_id, "content_type": content_type,
            "content_id": content_id, "scores": scores, "violation": violation,
            "severity": severity, "reasons": reasons, "decision": decision_status,
            "fingerprint": _fp(text), "at": _iso()})
        if violation:
            await escalate(user_id, scores, reasons or ["spam"], content_id)
        await compute_trust(user_id)
    except Exception as e:  # noqa: BLE001
        log.warning("ts hook failed: %s", e)


# ── 7. Bulk actions ──────────────────────────────────────────────────
async def _remove_all(user_id: str, coll: str, actor: dict, label: str):
    aid = await audit(actor=actor, action=f"remove_all_{label}", target_user_id=user_id,
                      human_decision=f"remove_all_{label}", reason="bulk moderation")
    r = await getattr(db, coll).update_many(
        {"author_id": user_id, "moderation_status": {"$ne": "removed_by_moderator"}},
        {"$set": {"moderation_status": "removed_by_moderator", "moderated_by": actor.get("username"),
                  "moderation_meta.audit_id": aid, "moderated_at": _iso()}})
    return {"affected": r.modified_count, "audit_id": aid, "reversible": True}


CONFIRM_REQUIRED = {"ban", "delete_account", "remove_all_messages"}


async def bulk_action(action: str, user_id: str, actor: dict, opts: dict = None) -> dict:
    opts = opts or {}
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1, "ts_status": 1,
                                                  "suspended_until": 1, "profile_hidden": 1})
    if not u:
        raise ValueError("User not found")
    now = datetime.now(timezone.utc)

    async def _set(fields, act, prev=None):
        await db.users.update_one({"id": user_id}, {"$set": fields})
        aid = await audit(actor=actor, action=act, target_user_id=user_id,
                          human_decision=act, reason=opts.get("reason", ""),
                          prev_state=prev or {k: u.get(k) for k in fields}, new_state=fields)
        return {"ok": True, "audit_id": aid}

    if action == "remove_all_posts":
        return await _remove_all(user_id, "posts", actor, "posts")
    if action == "remove_all_comments":
        return await _remove_all(user_id, "comments", actor, "comments")
    if action == "remove_all_media":
        out = {}
        for coll, lbl in (("images", "images"), ("videos", "videos")):
            aid = await audit(actor=actor, action=f"remove_all_{lbl}", target_user_id=user_id,
                              human_decision=f"remove_all_{lbl}")
            r = await getattr(db, coll).update_many(
                {"user_id": user_id}, {"$set": {"moderation_status": "removed_by_moderator",
                                                "moderation_meta.audit_id": aid, "moderated_at": _iso()}})
            out[lbl] = r.modified_count
        return {"affected": out, "reversible": True}
    if action == "remove_all_messages":
        aid = await audit(actor=actor, action="remove_all_messages", target_user_id=user_id,
                          human_decision="remove_all_messages", reason="policy-allowed bulk removal")
        r = await db.messages.update_many(
            {"sender_id": user_id}, {"$set": {"moderation_status": "removed_by_moderator",
                                              "moderation_meta.audit_id": aid, "moderated_at": _iso()}})
        return {"affected": r.modified_count, "audit_id": aid, "reversible": True}
    if action == "suspend":
        hours = int(opts.get("hours") or 72)
        return await _set({"suspended_until": (now + timedelta(hours=hours)).isoformat(),
                           "suspended_at": _iso(), "suspended_by": actor.get("username"),
                           "suspension_reason": opts.get("reason") or "moderation"}, "suspend")
    if action in ("unsuspend", "restore_account"):
        r = await _set({"ts_status": "active", "profile_hidden": False}, action)
        await db.users.update_one({"id": user_id}, {"$unset": {
            "suspended_until": "", "suspended_at": "", "suspended_by": "", "suspension_reason": ""},
            "$set": {"account_limits.active": False}})
        await db.ts_cases.update_many({"user_id": user_id, "status": "open"},
                                      {"$set": {"status": "resolved", "resolution": action, "updated_at": _iso()}})
        return r
    if action == "ban":  # founder-confirmed only (router enforces)
        return await _set({"ts_status": "banned", "profile_hidden": True,
                           "suspended_until": (now + timedelta(days=3650)).isoformat(),
                           "suspension_reason": opts.get("reason") or "banned by founder"}, "ban")
    if action == "unban":
        return await bulk_action("unsuspend", user_id, actor, opts)
    if action == "delete_account":  # founder-confirmed; soft — audit preserved
        return await _set({"ts_status": "deleted", "deleted": True, "profile_hidden": True,
                           "suspended_until": (now + timedelta(days=36500)).isoformat(),
                           "suspension_reason": "account deleted by founder"}, "delete_account")
    if action == "lock":
        await auto_lock(user_id, opts.get("reason") or f"locked by {actor.get('username')}")
        return {"ok": True}
    if action == "hide_profile":
        return await _set({"profile_hidden": True}, "hide_profile")
    if action == "unhide_profile":
        return await _set({"profile_hidden": False}, "unhide_profile")
    if action == "remove_banner":
        return await _set({"banner_url": None}, "remove_banner")
    if action == "remove_profile_picture":
        return await _set({"avatar_url": None, "profile_pic": None}, "remove_profile_picture")
    if action == "reset_username":
        old = u.get("username")
        new = f"user_{user_id[:8]}"
        r = await _set({"username": new, "require_username_change": True}, "reset_username",
                       prev={"username": old})
        await db.ts_username_history.insert_one({"user_id": user_id, "old": old, "new": new, "at": _iso()})
        return r
    if action == "require_username_change":
        return await _set({"require_username_change": True}, action)
    if action == "require_profile_review":
        return await _set({"require_profile_review": True}, action)
    if action == "force_password_reset":
        return await _set({"force_password_reset": True}, action)
    if action == "require_email_verification":
        return await _set({"email_verified": False, "require_email_verification": True}, action)
    if action == "require_phone_verification":
        return await _set({"require_phone_verification": True}, action)
    if action.startswith("mute_"):
        hours = int(action.split("_")[1])
        await _set_limits(user_id, ["commenting", "messaging"], hours, f"muted by {actor.get('username')}")
        aid = await audit(actor=actor, action=f"mute_{hours}h", target_user_id=user_id,
                          human_decision=f"mute_{hours}h")
        return {"ok": True, "audit_id": aid}
    raise ValueError(f"Unknown bulk action: {action}")


BULK_ACTIONS = ["remove_all_posts", "remove_all_comments", "remove_all_media", "remove_all_messages",
                "suspend", "unsuspend", "ban", "unban", "delete_account", "restore_account",
                "lock", "hide_profile", "unhide_profile", "remove_banner", "remove_profile_picture",
                "reset_username", "require_username_change", "require_profile_review",
                "force_password_reset", "require_email_verification", "require_phone_verification"]


# ── 8. Undo ──────────────────────────────────────────────────────────
INVERSE = {"suspend": "unsuspend", "ban": "unban", "hide_profile": "unhide_profile",
           "auto_lock_pending_review": "restore_account", "lock": "restore_account",
           "delete_account": "restore_account"}


async def undo_last(actor: dict) -> dict:
    last = await db.ts_audit.find_one(
        {"action": {"$nin": ["undo", "report", "case_note"]}, "undone": {"$ne": True}},
        sort=[("at", -1)])
    if not last:
        return {"ok": False, "message": "Nothing to undo"}
    action, uid = last["action"], last.get("target_user_id")
    if action.startswith("remove_all_"):
        colls = {"remove_all_posts": ["posts"], "remove_all_comments": ["comments"],
                 "remove_all_messages": ["messages"], "remove_all_images": ["images"],
                 "remove_all_videos": ["videos"]}.get(action, [])
        restored = 0
        for c in colls:
            r = await getattr(db, c).update_many(
                {"moderation_meta.audit_id": last["id"]},
                {"$set": {"moderation_status": "approved", "moderated_by": f"undo:{actor.get('username')}"}})
            restored += r.modified_count
        result = {"restored": restored}
    elif action in INVERSE and uid:
        result = await bulk_action(INVERSE[action], uid, actor, {"reason": f"undo of {action}"})
    else:
        return {"ok": False, "message": f"'{action}' is not automatically reversible"}
    await db.ts_audit.update_one({"id": last["id"]}, {"$set": {"undone": True, "undone_at": _iso()}})
    await audit(actor=actor, action="undo", target_user_id=uid,
                human_decision=f"undo {action}", meta={"undone_audit_id": last["id"]})
    return {"ok": True, "undone_action": action, "result": result}


# ── 9. Natural-language commands ─────────────────────────────────────
COMMAND_MAP = [
    (r"remove (this|the) comment", ("content_remove", "comment", False)),
    (r"remove every comment|remove all comments", ("remove_all_comments", None, False)),
    (r"delete all posts|remove all posts", ("remove_all_posts", None, False)),
    (r"hide every image|remove all (media|images|uploads)|remove every upload", ("remove_all_media", None, False)),
    (r"suspend (this )?(account|user)", ("suspend", None, False)),
    (r"\block (this )?(account|user)", ("lock", None, False)),
    (r"\bban (this )?(account|user)", ("ban", None, True)),
    (r"delete (this )?(account|user)", ("delete_account", None, True)),
    (r"restore (this )?(account|user)|unsuspend|unban", ("restore_account", None, False)),
    (r"restore (this|the) post", ("content_restore", "post", False)),
    (r"approve (this )?(account|user)", ("restore_account", None, False)),
    (r"reject (this |the )?appeal", ("appeal_reject", None, False)),
    (r"approve (this |the )?appeal", ("appeal_approve", None, False)),
    (r"mute .*24 ?h", ("mute_24", None, False)),
    (r"mute .*(7 ?d|week)", ("mute_168", None, False)),
    (r"hide all content|hide profile", ("hide_profile_and_content", None, False)),
    (r"show moderation history|previous actions", ("query_history", None, False)),
    (r"explain why|why .*(flag|lock)", ("query_explain", None, False)),
    (r"show everything .*(upload|post)|show all (content|uploads)", ("query_uploads", None, False)),
    (r"show (only )?violations", ("query_violations", None, False)),
    (r"undo", ("undo", None, False)),
]


def parse_command(text: str):
    t = (text or "").lower().strip()
    for pattern, (action, ctype, confirm) in COMMAND_MAP:
        if re.search(pattern, t):
            return {"action": action, "content_type": ctype, "needs_confirmation": confirm}
    return None


async def execute_command(text: str, actor: dict, target_user_id: str = None,
                          target_content: dict = None, confirmed: bool = False) -> dict:
    cmd = parse_command(text)
    if not cmd:
        return {"ok": False, "message": "ORAi couldn't map that to a moderation command.",
                "supported_examples": ["Suspend this account", "Delete all posts from this account",
                                       "Mute for 24 hours", "Show moderation history", "Undo the last moderation action"]}
    action = cmd["action"]
    if cmd["needs_confirmation"] and not confirmed:
        return {"ok": False, "needs_confirmation": True, "action": action,
                "prompt": f"⚠️ '{action}' is destructive and permanent-leaning. Confirm to proceed."}
    if action == "undo":
        return await undo_last(actor)
    if action.startswith("query_"):
        if not target_user_id:
            return {"ok": False, "message": "Select a target user for this query."}
        if action == "query_history":
            rows = await db.ts_audit.find({"target_user_id": target_user_id}, {"_id": 0}).sort("at", -1).to_list(30)
            return {"ok": True, "history": rows}
        if action == "query_explain":
            evs = await db.ts_events.find({"user_id": target_user_id, "violation": True},
                                          {"_id": 0}).sort("at", -1).to_list(10)
            trust = (await db.users.find_one({"id": target_user_id}, {"_id": 0, "trust": 1}) or {}).get("trust")
            return {"ok": True, "explanation": {
                "recent_violations": evs, "trust": trust,
                "summary": f"ORAi flagged this account for: "
                           + "; ".join(sorted({r for e in evs for r in e.get('reasons', [])})) if evs
                           else "No recorded violations."}}
        if action == "query_uploads":
            posts = await db.posts.find({"author_id": target_user_id}, {"_id": 0, "id": 1, "content": 1,
                                                                        "moderation_status": 1, "created_at": 1}).sort("created_at", -1).to_list(50)
            imgs = await db.images.count_documents({"user_id": target_user_id})
            vids = await db.videos.count_documents({"user_id": target_user_id})
            return {"ok": True, "uploads": {"posts": posts, "image_count": imgs, "video_count": vids}}
        if action == "query_violations":
            evs = await db.ts_events.find({"user_id": target_user_id, "violation": True},
                                          {"_id": 0}).sort("at", -1).to_list(50)
            return {"ok": True, "violations": evs}
    if action in ("appeal_approve", "appeal_reject"):
        ap = await db.ts_appeals.find_one({"user_id": target_user_id, "status": "pending"}, sort=[("created_at", -1)])
        if not ap:
            return {"ok": False, "message": "No pending appeal for this user."}
        return await resolve_appeal(ap["id"], "approved" if action == "appeal_approve" else "rejected", actor, "")
    if action == "content_remove" and target_content:
        coll = "comments" if target_content.get("type") == "comment" else "posts"
        aid = await audit(actor=actor, action="content_remove", target_user_id=target_user_id,
                          content_type=target_content.get("type"), content_id=target_content.get("id"),
                          human_decision="remove")
        await getattr(db, coll).update_one({"id": target_content["id"]}, {"$set": {
            "moderation_status": "removed_by_moderator", "moderation_meta.audit_id": aid}})
        return {"ok": True, "removed": target_content["id"]}
    if action == "content_restore" and target_content:
        coll = "comments" if target_content.get("type") == "comment" else "posts"
        await getattr(db, coll).update_one({"id": target_content["id"]}, {"$set": {"moderation_status": "approved"}})
        await audit(actor=actor, action="content_restore", target_user_id=target_user_id,
                    content_id=target_content.get("id"), human_decision="restore")
        return {"ok": True, "restored": target_content["id"]}
    if action == "hide_profile_and_content":
        await bulk_action("hide_profile", target_user_id, actor)
        r1 = await _remove_all(target_user_id, "posts", actor, "posts")
        return {"ok": True, "profile_hidden": True, "posts_hidden": r1["affected"]}
    if not target_user_id:
        return {"ok": False, "message": "Select a target user for this command."}
    result = await bulk_action(action if action != "restore_account" else "restore_account",
                               target_user_id, actor, {})
    return {"ok": True, "action": action, "result": result}


# ── 10. Appeals ──────────────────────────────────────────────────────
async def submit_appeal(user: dict, message: str, case_id: str = None) -> dict:
    ap = {"id": uuid.uuid4().hex, "user_id": user["id"], "username": user.get("username"),
          "case_id": case_id, "message": str(message or "")[:1000], "status": "pending",
          "created_at": _iso(), "resolved_at": None, "resolution_note": None}
    await db.ts_appeals.insert_one({**ap})
    await audit(actor=user, action="appeal_submitted", target_user_id=user["id"], meta={"appeal_id": ap["id"]})
    ap.pop("_id", None)
    return ap


async def resolve_appeal(appeal_id: str, resolution: str, actor: dict, note: str,
                         penalty_hours: int = None) -> dict:
    ap = await db.ts_appeals.find_one({"id": appeal_id})
    if not ap:
        return {"ok": False, "message": "Appeal not found"}
    await db.ts_appeals.update_one({"id": appeal_id}, {"$set": {
        "status": resolution, "resolved_at": _iso(), "resolved_by": actor.get("username"),
        "resolution_note": str(note or "")[:400]}})
    if resolution == "approved":
        await bulk_action("restore_account", ap["user_id"], actor, {"reason": "appeal approved"})
    elif resolution == "reduce_penalty":
        await db.users.update_one({"id": ap["user_id"]}, {"$set": {
            "suspended_until": (datetime.now(timezone.utc) + timedelta(hours=penalty_hours or 24)).isoformat()}})
    elif resolution == "extend_penalty":
        await db.users.update_one({"id": ap["user_id"]}, {"$set": {
            "suspended_until": (datetime.now(timezone.utc) + timedelta(hours=penalty_hours or 168)).isoformat()}})
    aid = await audit(actor=actor, action=f"appeal_{resolution}", target_user_id=ap["user_id"],
                      human_decision=resolution, reason=note, meta={"appeal_id": appeal_id})
    await db.ts_audit.update_many({"target_user_id": ap["user_id"], "appeal_status": None},
                                  {"$set": {"appeal_status": resolution}})
    return {"ok": True, "appeal_id": appeal_id, "resolution": resolution, "audit_id": aid}
