"""Centralized moderation for OurRealm.

Rule-based detector + pluggable LLM interface. LLM fallback is wired but
only fires when `MODERATION_LLM_ENABLED=1` AND a valid `EMERGENT_LLM_KEY`
is present in the env. Otherwise everything runs rule-based.

Public surface:
    scan_content(text, link_urls=[])     → ModerationDecision
    apply_decision(coll, doc_id, dec, *) → updates moderation_* fields
    scan_and_apply(coll, doc, fields)    → scan + apply in one call
    log_action(action, *, ...)           → write to moderation_log collection

Decisions:
    status     : approved | pending_review | hidden | rejected
    reason     : "spam" | "phishing" | "hate" | "sexual" | "threats" |
                 "self_harm" | "scam" | "bullying" | "suspicious_url" | ...
    score      : 0.0..1.0  (higher = more confident violation)
    moderated_by : "auto:rules" | "auto:llm" | "admin:<user_id>"
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Iterable, List, Optional

from core.db import db


# ── Config ────────────────────────────────────────────────────────────
LLM_ENABLED = os.environ.get("MODERATION_LLM_ENABLED", "0") == "1"
LLM_KEY     = os.environ.get("EMERGENT_LLM_KEY", "")

# Status / reason enums (kept as plain strings for Mongo compatibility).
STATUS_APPROVED       = "approved"
STATUS_PENDING_REVIEW = "pending_review"
STATUS_HIDDEN         = "hidden"
STATUS_REJECTED       = "rejected"
ALL_STATUSES = {STATUS_APPROVED, STATUS_PENDING_REVIEW, STATUS_HIDDEN, STATUS_REJECTED}

# Reason taxonomy — also used by user reports.
REASONS = (
    "spam", "phishing", "hate", "sexual", "threats",
    "self_harm", "scam", "bullying", "suspicious_url", "other",
)


# ── Rule patterns ─────────────────────────────────────────────────────
# Designed for HIGH precision (auto-hide threshold is 0.8). When a rule
# fires we record the reason in `triggered_reasons` and the cumulative
# score in `score`. Borderline (0.4..0.79) → pending_review.

SUSPICIOUS_DOMAINS = {
    "bit.ly", "tinyurl.com", "shorturl.at", "rb.gy", "t.co",
    "freegift.com", "click-here.win", "secure-login-update.com",
    "verify-account.com", "paypal-verification.com",
}
PHISHING_PHRASES = [
    r"verify your (account|password|identity)\s+(immediately|now)?",
    r"click (the |this )?link to (claim|verify|secure|protect)",
    r"(account|wallet) (suspended|locked|frozen)\s+(click|verify|confirm)",
    r"send (me )?(\$|usd|eth|btc|payment|crypto)",
    r"send\s+gift\s+card",
]
SPAM_PATTERNS = [
    r"(buy\s+now|limited\s+time|act\s+fast).*(http|www\.)",
    r"earn\s+\$\d+.*(day|week|hour)",
    r"(make|earn)\s+money\s+(fast|online|from\s+home)",
    r"(free|cheap)\s+(viagra|cialis|loans?|crypto)",
]
HATE_TERMS = [
    # Slurs and hateful phrasings (intentionally narrow + non-exhaustive)
    r"\bk[i*]ll\s+all\s+(\w+s)\b",
    r"\b(gas|exterminate)\s+the\s+\w+s\b",
    r"\b(go\s+back\s+to|deport\s+all)\s+\w+s?\b",
    r"\bn[i!1]gg(er|a)\b",
    r"\bf[a@]g(got)?\b",
    r"\b(retard|retarded)\b",
]
THREAT_PATTERNS = [
    r"\bi('?ll| will)\s+(kill|hurt|beat|find|stab|shoot)\s+you\b",
    r"\byou('?re| are)\s+(dead|going\s+to\s+die)\b",
    r"\b(watch\s+your\s+back|sleep\s+with\s+one\s+eye)\b",
]
SEXUAL_PATTERNS = [
    r"\b(porn|nude|nudes|naked)\s+(pic|pics|video|videos|leak)s?\b",
    r"\bonlyfans\.com",
    r"\b(send|share|trade)\s+nudes?\b",
    r"\b18\+\s+content\b",
]
SELF_HARM_PATTERNS = [
    r"\bkill\s+(myself|me)\b",
    r"\b(want\s+to|going\s+to)\s+(end|take)\s+(my\s+life|it\s+all)\b",
    r"\b(suicide|self\s*harm)\s+(method|how)\b",
]
SCAM_PATTERNS = [
    r"\b(double|triple)\s+your\s+(money|crypto|investment)\b",
    r"\bguaranteed\s+(returns?|profits?|income)\b",
    r"\bgiveaway\s+winner\b.*\bclaim\b",
    r"\bwire\s+transfer\b.*\burgent\b",
]
BULLYING_PATTERNS = [
    r"\b(no\s+one|nobody)\s+likes\s+you\b",
    r"\byou\s+should\s+(just\s+)?(die|disappear|leave)\b",
    r"\bkill\s+yourself\b",
    r"\bworthless\s+(piece|trash|garbage)\b",
]

URL_RE = re.compile(r"https?://([^/\s]+)", re.IGNORECASE)


@dataclass
class ModerationDecision:
    status: str = STATUS_APPROVED
    reason: Optional[str] = None
    score: float = 0.0
    triggered_reasons: List[str] = field(default_factory=list)
    moderated_by: str = "auto:rules"

    def as_update(self) -> dict:
        return {
            "moderation_status": self.status,
            "moderation_reason": self.reason,
            "moderation_score": float(self.score),
            "moderated_by": self.moderated_by,
            "moderated_at": datetime.now(timezone.utc).isoformat(),
        }


# ── Detector ──────────────────────────────────────────────────────────
def _hit(patterns: Iterable[str], text: str) -> bool:
    return any(re.search(p, text, re.IGNORECASE) for p in patterns)


def _extract_urls(text: str) -> List[str]:
    return [m.group(0) for m in URL_RE.finditer(text or "")]


def scan_content(text: Optional[str] = None, link_urls: Optional[List[str]] = None) -> ModerationDecision:
    """Apply rule heuristics to free text + an explicit list of URLs.

    Score is the sum of per-reason weights, clamped to 1.0. Heavy categories
    (threats / self_harm) auto-hide with a single hit; lighter categories
    (spam / suspicious_url) require corroboration to auto-hide.
    """
    text = (text or "").strip()
    urls = list(link_urls or [])
    urls.extend(_extract_urls(text))

    triggered: list[str] = []
    score = 0.0
    primary: Optional[str] = None

    def fire(reason: str, weight: float):
        nonlocal score, primary
        if reason not in triggered:
            triggered.append(reason)
        score += weight
        if primary is None or weight >= 0.6:
            primary = reason

    if _hit(THREAT_PATTERNS, text):                fire("threats",     0.95)
    if _hit(SELF_HARM_PATTERNS, text):             fire("self_harm",   0.9)
    if _hit(HATE_TERMS, text):                     fire("hate",        0.85)
    if _hit(SEXUAL_PATTERNS, text):                fire("sexual",      0.75)
    if _hit(BULLYING_PATTERNS, text):              fire("bullying",    0.7)
    if _hit(PHISHING_PHRASES, text):               fire("phishing",    0.7)
    if _hit(SCAM_PATTERNS, text):                  fire("scam",        0.6)
    if _hit(SPAM_PATTERNS, text):                  fire("spam",        0.45)

    for raw in urls:
        try:
            host = re.sub(r"^www\.", "", raw.lower().split("/")[2 if "://" in raw else 0])
        except Exception:
            host = raw.lower()
        if host in SUSPICIOUS_DOMAINS:
            fire("suspicious_url", 0.55)

    score = min(score, 1.0)
    if score >= 0.8:
        status = STATUS_HIDDEN
    elif score >= 0.4:
        status = STATUS_PENDING_REVIEW
    else:
        status = STATUS_APPROVED
    return ModerationDecision(
        status=status,
        reason=primary,
        score=score,
        triggered_reasons=triggered,
        moderated_by="auto:rules",
    )


async def llm_review(text: str) -> Optional[ModerationDecision]:
    """LLM fallback — wired but only fires when LLM_ENABLED + key present.
    Returns None when disabled or on failure (caller keeps rule decision).
    """
    if not (LLM_ENABLED and LLM_KEY and text):
        return None
    try:
        # Defer the heavy import to runtime so the module loads even when
        # emergentintegrations isn't installed (no LLM mode).
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
        chat = LlmChat(api_key=LLM_KEY, session_id="moderation").with_model("openai", "gpt-5.4-mini")
        prompt = (
            "Classify this user content. Respond with one word from "
            "[approved, pending_review, hidden] and a comma + reason.\n\n"
            f"Content: {text[:1500]}"
        )
        resp = await chat.send_message(UserMessage(text=prompt))
        body = (resp or "").strip().lower()
        status, _, reason = body.partition(",")
        status = status.strip()
        if status not in ALL_STATUSES:
            return None
        return ModerationDecision(
            status=status,
            reason=(reason.strip() or None),
            score=0.7 if status != STATUS_APPROVED else 0.0,
            moderated_by="auto:llm",
        )
    except Exception:
        return None


# ── Persistence helpers ───────────────────────────────────────────────
async def log_action(
    *,
    action: str,
    content_type: str,
    content_id: str,
    user_id: Optional[str],
    reason: Optional[str] = None,
    actor_id: Optional[str] = None,
    meta: Optional[dict] = None,
):
    await db.moderation_log.insert_one({
        "id": __import__("uuid").uuid4().hex,
        "action": action,            # auto_hide | auto_pending | approve | hide | restore | delete | ban | acknowledge | report
        "content_type": content_type,  # post | comment | profile | image | video | report
        "content_id": content_id,
        "user_id": user_id,
        "actor_id": actor_id,
        "reason": reason,
        "meta": meta or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


async def scan_and_apply(
    coll_name: str,
    doc_id_field: str,
    doc: dict,
    text_fields: Iterable[str] = ("content",),
    link_fields: Iterable[str] = (),
    user_id: Optional[str] = None,
) -> ModerationDecision:
    """Scan the document's text + URL fields and write moderation_* back.
    Borderline (pending_review) cases will optionally re-run via llm_review.
    Returns the final decision.
    """
    text = " ".join(str(doc.get(f) or "") for f in text_fields)
    urls = [str(doc.get(f) or "") for f in link_fields if doc.get(f)]
    dec = scan_content(text, urls)
    if dec.status == STATUS_PENDING_REVIEW:
        llm = await llm_review(text)
        if llm is not None:
            dec = llm

    coll = getattr(db, coll_name)
    update = dec.as_update()
    update["moderation_triggered"] = dec.triggered_reasons
    await coll.update_one({doc_id_field: doc[doc_id_field]}, {"$set": update})

    if dec.status != STATUS_APPROVED:
        await log_action(
            action=("auto_hide" if dec.status == STATUS_HIDDEN else "auto_pending"),
            content_type=coll_name.rstrip("s"),  # "posts" → "post"
            content_id=str(doc[doc_id_field]),
            user_id=user_id,
            reason=dec.reason,
            meta={"score": dec.score, "triggered": dec.triggered_reasons},
        )
    return dec


def is_visible_to(post_or_doc: dict, viewer: Optional[dict]) -> bool:
    """Reusable visibility predicate: hidden / rejected items show only to
    the author or to an admin (founder). Approved + pending_review remain
    visible (pending is "live but flagged for review")."""
    status = post_or_doc.get("moderation_status") or STATUS_APPROVED
    if status in (STATUS_APPROVED, STATUS_PENDING_REVIEW):
        return True
    if not viewer:
        return False
    if (viewer.get("username") or "").lower() == "stealth" or viewer.get("is_founder"):
        return True
    return post_or_doc.get("author_id") == viewer.get("id") or post_or_doc.get("user_id") == viewer.get("id")


def asdict_decision(d: ModerationDecision) -> dict:
    return asdict(d)


async def ensure_not_limited(user_id: str, capability: str) -> None:
    """Trust & Safety account-limit gate. Raises 403 when the user is
    actively limited from the given capability. Expired limits self-heal."""
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "account_limits": 1})
    lim = (u or {}).get("account_limits") or {}
    if not lim.get("active"):
        return
    exp = lim.get("expires_at")
    if exp and exp <= datetime.now(timezone.utc).isoformat():
        await db.users.update_one({"id": user_id},
                                  {"$set": {"account_limits.active": False}})
        return
    if capability in (lim.get("capabilities") or []):
        from fastapi import HTTPException
        raise HTTPException(
            status_code=403,
            detail="Your account is temporarily limited from this action. "
                   "Check your notifications for details.")
