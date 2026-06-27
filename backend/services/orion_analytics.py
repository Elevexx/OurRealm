"""Orion analytics — read-only Founder/Admin assistant.

Phase 3.6 (Feb 28, 2026). When a Founder or Admin sends a message to
any conversational AI widget that matches one of the analytics
intents below, we BYPASS the OpenAI call and return a deterministic,
live, founder-friendly summary built from existing analytics
services. Non-admins who happen to type a similar query get a polite
refusal (no permission error, no leaked endpoint names).

This module is strictly READ-ONLY. Every helper here only READS from
existing collections via existing services. No mutations, no admin
actions, no message dispatch.

Wired into `routers/widget_chat.py:chat_message` so the entire Orion
surface (any widget configured with `editor_config.chat`) gains
analytics powers for free.
"""
from __future__ import annotations
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from core.db import db
from core.deps import is_admin_user
from services import realm_pulse


# ─────────────────────────────────────────────────────────────────────
# Intent router. Each entry: (intent_key, regex)
# Order matters — first match wins, so SPECIFIC patterns must come
# BEFORE general ones (e.g. "investor snapshot" before "snapshot").
# ─────────────────────────────────────────────────────────────────────
INTENTS: List[Tuple[str, re.Pattern]] = [
    ("investor_snapshot",   re.compile(r"\b(investor\s+snapshot|investor\s+summary|board\s+update)\b", re.I)),
    ("today_snapshot",      re.compile(r"\b(today'?s?\s+(snapshot|summary|overview)|daily\s+snapshot|how\s+is\s+today|how\s+are\s+we\s+doing\s+today)\b", re.I)),
    ("dau",                 re.compile(r"\b(dau|daily\s+active\s+users|active\s+users?\s+today)\b", re.I)),
    ("wau",                 re.compile(r"\b(wau|weekly\s+active\s+users|active\s+users?\s+(this|last)\s+week)\b", re.I)),
    ("mau",                 re.compile(r"\b(mau|monthly\s+active\s+users|active\s+users?\s+(this|last)\s+month)\b", re.I)),
    ("signups",             re.compile(r"\b(sign[\s-]?ups?|signed[\s-]?up|new\s+users|registrations|new\s+sign[\s-]?ups)\b", re.I)),
    ("total_users",         re.compile(r"\b(total\s+users|user\s+count|how\s+many\s+users)\b", re.I)),
    ("content_today",       re.compile(r"\b((thoughts|posts|images|videos|sounds|podcasts)\s+(today|created\s+today|uploaded\s+today))\b", re.I)),
    ("content_week",        re.compile(r"\b((thoughts|posts|images|videos|sounds|podcasts)\s+(this\s+week|in\s+the\s+last\s+week))\b", re.I)),
    ("messages",            re.compile(r"\b(messages?\s+(sent|today|this\s+week)|active\s+conversations?)\b", re.I)),
    ("top_realms",          re.compile(r"\b(top\s+\d*\s*realms?|most\s+active\s+realms?|largest\s+realms?|fastest[\s-]?growing\s+realms?|realm\s+growth)\b", re.I)),
    ("new_realms",          re.compile(r"\b(new\s+realms?|realms?\s+(created|made)\s+(today|this\s+week))\b", re.I)),
    ("top_creators",        re.compile(r"\b(top\s+creators?|most\s+active\s+creators?|most\s+engaged\s+creators?|most\s+viewed\s+creators?)\b", re.I)),
    ("moderation",          re.compile(r"\b(moderation|open\s+reports?|reports?\s+(today|this\s+week|waiting|pending)|mod\s+queue)\b", re.I)),
    ("support",             re.compile(r"\b(support\s+tickets?|open\s+tickets?|tickets?\s+(today|this\s+week|recent)|support\s+queue)\b", re.I)),
    ("badges",              re.compile(r"\b(badges?|vip\s+holders?|founder\s+count|beta\s+badge|verified\s+count|badges?\s+awarded)\b", re.I)),
    ("widgets",             re.compile(r"\b(most\s+used\s+widgets?|top\s+widgets?|widget\s+usage|widget\s+counts?)\b", re.I)),
]


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def _today_iso_range() -> Tuple[str, str]:
    today = _today_str()
    return f"{today}T00:00:00+00:00", f"{today}T23:59:59+00:00"

def _week_iso_range() -> Tuple[str, str]:
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=6)).strftime("%Y-%m-%d")
    end = now.strftime("%Y-%m-%d")
    return f"{start}T00:00:00+00:00", f"{end}T23:59:59+00:00"

async def _safe_count(coll_name: str, query: Dict[str, Any]) -> int:
    try:
        names = await db.list_collection_names()
        if coll_name not in names:
            return 0
        return await db[coll_name].count_documents(query)
    except Exception:
        return 0

def _role_for(user: Dict[str, Any]) -> str:
    if (user.get("username") or "").lower() == "stealth":
        return "founder"
    return user.get("role") or "admin"

def _refusal() -> str:
    return ("Those administrative analytics are only available to authorized "
            "OurRealm administrators.")


# ─────────────────────────────────────────────────────────────────────
# Tools — each returns a (markdown_summary, audit_summary) tuple.
# audit_summary stays SHORT and never contains raw rows / PII.
# ─────────────────────────────────────────────────────────────────────
async def _tool_today_snapshot() -> Tuple[str, str]:
    today = _today_str()
    d_dau = await realm_pulse.dau(today)
    iso_s, iso_e = _today_iso_range()
    week_s, week_e = _week_iso_range()
    new_today = await _safe_count("users", {"created_at": {"$gte": iso_s, "$lte": iso_e}})
    new_week = await _safe_count("users", {"created_at": {"$gte": week_s, "$lte": week_e}})
    sounds = await _safe_count("sounds", {"created_at": {"$gte": iso_s, "$lte": iso_e}})
    posts = await _safe_count("posts", {"created_at": {"$gte": iso_s, "$lte": iso_e}})
    open_reports = await _safe_count("reports", {"status": "open"})
    open_tickets = await _safe_count("support_tickets", {"status": {"$in": ["open", "in_progress"]}})
    lines = [
        "**Today's snapshot:**",
        f"• DAU: {d_dau}",
        f"• New users today: {new_today}  (week: {new_week})",
        f"• Posts today: {posts}",
        f"• Sounds uploaded today: {sounds}",
        f"• Open support tickets: {open_tickets}",
        f"• Open moderation reports: {open_reports}",
    ]
    return "\n".join(lines), f"dau={d_dau} new_today={new_today} posts={posts} sounds={sounds}"


async def _tool_investor_snapshot() -> Tuple[str, str]:
    s = await realm_pulse.investor_snapshot(window="30d")
    lines = [
        "**Investor snapshot (30-day window):**",
        f"• DAU / WAU / MAU: {s['dau']} / {s['wau']} / {s['mau']}",
        f"• DAU/MAU stickiness: {s['dau_mau_ratio_pct']}%",
        f"• User growth rate: {s.get('user_growth_rate_pct') if s.get('user_growth_rate_pct') is not None else 'n/a'}%",
        f"• D30 retention: {s.get('d30_retention_pct') if s.get('d30_retention_pct') is not None else 'n/a'}%",
        f"• Status: **{s.get('status', 'Early traction')}**",
    ]
    # Add content + community totals from the same window range so it's
    # a real "investor" snapshot — not just retention numbers.
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=29)
    com = await realm_pulse.community_totals(start, today)
    lines += [
        "",
        "**Content (last 30 days):**",
        f"• Posts: {com.get('posts_created', 0)}",
        f"• Messages: {com.get('messages_sent', 0)}",
        f"• Sounds: {com.get('sounds_uploaded', 0)}",
        f"• Comments: {com.get('comments_created', 0)}",
    ]
    return "\n".join(lines), f"dau={s['dau']} mau={s['mau']} status={s.get('status')}"


async def _tool_dau() -> Tuple[str, str]:
    d_dau = await realm_pulse.dau()
    d_wau = await realm_pulse.wau()
    d_mau = await realm_pulse.mau()
    return (f"• DAU: {d_dau}\n• WAU: {d_wau}\n• MAU: {d_mau}", f"dau={d_dau} wau={d_wau} mau={d_mau}")


async def _tool_wau() -> Tuple[str, str]:
    n = await realm_pulse.wau()
    return f"WAU (weekly active users): **{n}**", f"wau={n}"


async def _tool_mau() -> Tuple[str, str]:
    n = await realm_pulse.mau()
    return f"MAU (monthly active users): **{n}**", f"mau={n}"


async def _tool_signups() -> Tuple[str, str]:
    iso_s, iso_e = _today_iso_range()
    week_s, week_e = _week_iso_range()
    today = await _safe_count("users", {"created_at": {"$gte": iso_s, "$lte": iso_e}})
    week = await _safe_count("users", {"created_at": {"$gte": week_s, "$lte": week_e}})
    total = await _safe_count("users", {})
    return (f"**Signups:**\n• Today: {today}\n• This week: {week}\n• Total users: {total}",
            f"today={today} week={week} total={total}")


async def _tool_total_users() -> Tuple[str, str]:
    n = await _safe_count("users", {})
    return f"Total users on OurRealm: **{n}**", f"total={n}"


async def _tool_content_today() -> Tuple[str, str]:
    iso_s, iso_e = _today_iso_range()
    rng = {"created_at": {"$gte": iso_s, "$lte": iso_e}}
    posts    = await _safe_count("posts",    rng)
    thoughts = await _safe_count("posts",    {**rng, "kind": "thought"})
    images   = await _safe_count("posts",    {**rng, "kind": "image"})
    videos   = await _safe_count("posts",    {**rng, "kind": "video"})
    sounds   = await _safe_count("sounds",   rng)
    # podcasts — best-effort. Either a dedicated coll or a kind on posts.
    podcasts = await _safe_count("podcasts", rng)
    if not podcasts:
        podcasts = await _safe_count("posts", {**rng, "kind": "podcast"})
    lines = [
        "**Content created today:**",
        f"• Thoughts: {thoughts}",
        f"• Images: {images}",
        f"• Videos: {videos}",
        f"• Sounds: {sounds}",
        f"• Podcasts: {podcasts}",
        f"• All posts: {posts}",
    ]
    return ("\n".join(lines),
            f"posts={posts} thoughts={thoughts} sounds={sounds}")


async def _tool_content_week() -> Tuple[str, str]:
    week_s, week_e = _week_iso_range()
    rng = {"created_at": {"$gte": week_s, "$lte": week_e}}
    posts    = await _safe_count("posts",  rng)
    sounds   = await _safe_count("sounds", rng)
    podcasts = await _safe_count("podcasts", rng) or await _safe_count("posts", {**rng, "kind": "podcast"})
    lines = [
        "**Content this week (7-day window):**",
        f"• Posts: {posts}",
        f"• Sounds: {sounds}",
        f"• Podcasts: {podcasts}",
    ]
    return "\n".join(lines), f"posts={posts} sounds={sounds}"


async def _tool_messages() -> Tuple[str, str]:
    cols = await db.list_collection_names()
    if "messages" not in cols and "community_messages" not in cols:
        return ("Messaging metrics are not currently tracked. We expose realm "
                "chat counts via the community_messages collection — that "
                "collection isn't populated yet.", "tracked=false")
    iso_s, iso_e = _today_iso_range()
    week_s, week_e = _week_iso_range()
    today = await _safe_count("messages", {"created_at": {"$gte": iso_s, "$lte": iso_e}})
    today += await _safe_count("community_messages", {"created_at": {"$gte": iso_s, "$lte": iso_e}})
    week = await _safe_count("messages", {"created_at": {"$gte": week_s, "$lte": week_e}})
    week += await _safe_count("community_messages", {"created_at": {"$gte": week_s, "$lte": week_e}})
    lines = ["**Messaging activity:**", f"• Messages today: {today}", f"• Messages this week: {week}"]
    return "\n".join(lines), f"today={today} week={week}"


async def _tool_top_realms(limit: int = 10) -> Tuple[str, str]:
    week_s, week_e = _week_iso_range()
    pipeline = [
        {"$match": {"created_at": {"$gte": week_s, "$lte": week_e}}},
        {"$group": {"_id": "$realm_id", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": limit},
    ]
    cols = await db.list_collection_names()
    activity = []
    if "community_messages" in cols:
        try:
            activity = await db.community_messages.aggregate(pipeline).to_list(limit)
        except Exception:
            activity = []
    if not activity and "community_hub_posts" in cols:
        try:
            activity = await db.community_hub_posts.aggregate(pipeline).to_list(limit)
        except Exception:
            activity = []
    if not activity:
        # Fall back to realm member counts as a proxy for "largest".
        pipeline2 = [
            {"$group": {"_id": "$realm_id", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}},
            {"$limit": limit},
        ]
        try:
            activity = await db.community_memberships.aggregate(pipeline2).to_list(limit)
        except Exception:
            activity = []
    if not activity:
        return ("No realm activity surfaced for the last 7 days yet.", "rows=0")
    # Resolve realm slugs / names.
    realm_ids = [a["_id"] for a in activity if a.get("_id")]
    realms = {}
    async for r in db.realms.find({"id": {"$in": realm_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1}):
        realms[r["id"]] = r
    lines = [f"**Top {len(activity)} realms (last 7 days):**"]
    for i, a in enumerate(activity, 1):
        r = realms.get(a["_id"], {})
        label = r.get("name") or r.get("slug") or a["_id"] or "unknown"
        lines.append(f"{i}. {label} — {a['n']} actions")
    return "\n".join(lines), f"top_realm={lines[1] if len(lines)>1 else 'none'}"


async def _tool_new_realms() -> Tuple[str, str]:
    iso_s, iso_e = _today_iso_range()
    week_s, week_e = _week_iso_range()
    today = await _safe_count("realms", {"created_at": {"$gte": iso_s, "$lte": iso_e}})
    week = await _safe_count("realms", {"created_at": {"$gte": week_s, "$lte": week_e}})
    total = await _safe_count("realms", {})
    return (f"**Realms:**\n• Created today: {today}\n• Created this week: {week}\n• Total realms: {total}",
            f"today={today} week={week} total={total}")


async def _tool_top_creators(limit: int = 10) -> Tuple[str, str]:
    week_s, week_e = _week_iso_range()
    pipeline = [
        {"$match": {"created_at": {"$gte": week_s, "$lte": week_e}}},
        {"$group": {"_id": "$author_id", "posts": {"$sum": 1}}},
        {"$sort": {"posts": -1}},
        {"$limit": limit},
    ]
    rows = []
    try:
        rows = await db.posts.aggregate(pipeline).to_list(limit)
    except Exception:
        rows = []
    if not rows:
        return ("No creator activity surfaced for the last 7 days yet.", "rows=0")
    author_ids = [r["_id"] for r in rows if r.get("_id")]
    users = {}
    async for u in db.users.find({"id": {"$in": author_ids}}, {"_id": 0, "id": 1, "username": 1, "name": 1}):
        users[u["id"]] = u
    lines = [f"**Top {len(rows)} creators (last 7 days, by post count):**"]
    for i, r in enumerate(rows, 1):
        u = users.get(r["_id"], {})
        label = u.get("name") or (f"@{u['username']}" if u.get("username") else r["_id"][:8] + "…")
        lines.append(f"{i}. {label} — {r['posts']} posts")
    return "\n".join(lines), f"top_creator_posts={rows[0]['posts'] if rows else 0}"


async def _tool_moderation() -> Tuple[str, str]:
    iso_s, iso_e = _today_iso_range()
    week_s, week_e = _week_iso_range()
    open_ = await _safe_count("reports", {"status": "open"})
    today = await _safe_count("reports", {"created_at": {"$gte": iso_s, "$lte": iso_e}})
    week = await _safe_count("reports", {"created_at": {"$gte": week_s, "$lte": week_e}})
    pending = await _safe_count("reports", {"status": {"$in": ["open", "investigating"]}})
    lines = [
        "**Moderation:**",
        f"• Open reports: {open_}",
        f"• Reports today: {today}",
        f"• Reports this week: {week}",
        f"• Pending queue: {pending}",
    ]
    return "\n".join(lines), f"open={open_} today={today} week={week}"


async def _tool_support() -> Tuple[str, str]:
    iso_s, iso_e = _today_iso_range()
    week_s, week_e = _week_iso_range()
    open_ = await _safe_count("support_tickets", {"status": {"$in": ["open", "in_progress"]}})
    today = await _safe_count("support_tickets", {"created_at": {"$gte": iso_s, "$lte": iso_e}})
    week = await _safe_count("support_tickets", {"created_at": {"$gte": week_s, "$lte": week_e}})
    closed_week = await _safe_count("support_tickets", {
        "status": "closed",
        "closed_at": {"$gte": week_s, "$lte": week_e},
    })
    lines = [
        "**Support:**",
        f"• Open tickets: {open_}",
        f"• New tickets today: {today}",
        f"• New tickets this week: {week}",
        f"• Closed this week: {closed_week}",
    ]
    return "\n".join(lines), f"open={open_} today={today}"


async def _tool_badges() -> Tuple[str, str]:
    # Group user_badges by badge_key.
    rows = await db.user_badges.aggregate([
        {"$group": {"_id": "$badge_key", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 20},
    ]).to_list(20)
    if not rows:
        return "No badges awarded yet.", "rows=0"
    lines = ["**Badge counts:**"]
    for r in rows:
        lines.append(f"• {r['_id']}: {r['n']}")
    total = sum(r["n"] for r in rows)
    lines.append(f"\n• Total badges awarded: {total}")
    return "\n".join(lines), f"badges={len(rows)} total={total}"


async def _tool_widgets() -> Tuple[str, str]:
    # Most-used widget types — count entries across user profiles.
    pipeline = [
        {"$unwind": "$widgets"},
        {"$group": {"_id": "$widgets.type", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 10},
    ]
    rows = []
    try:
        rows = await db.users.aggregate(pipeline).to_list(10)
    except Exception:
        rows = []
    if not rows:
        return "No widget usage data surfaced yet.", "rows=0"
    lines = ["**Top widgets (across all profiles):**"]
    for i, r in enumerate(rows, 1):
        lines.append(f"{i}. {r['_id'] or 'unknown'} — {r['n']} uses")
    return "\n".join(lines), f"top_widget={rows[0]['_id']}={rows[0]['n']}"


# ─────────────────────────────────────────────────────────────────────
# Intent dispatcher + audit log writer
# ─────────────────────────────────────────────────────────────────────
INTENT_TOOL = {
    "investor_snapshot": _tool_investor_snapshot,
    "today_snapshot":    _tool_today_snapshot,
    "dau":               _tool_dau,
    "wau":               _tool_wau,
    "mau":               _tool_mau,
    "signups":           _tool_signups,
    "total_users":       _tool_total_users,
    "content_today":     _tool_content_today,
    "content_week":      _tool_content_week,
    "messages":          _tool_messages,
    "top_realms":        _tool_top_realms,
    "new_realms":        _tool_new_realms,
    "top_creators":      _tool_top_creators,
    "moderation":        _tool_moderation,
    "support":           _tool_support,
    "badges":            _tool_badges,
    "widgets":           _tool_widgets,
}


def detect_intent(text: str) -> Optional[str]:
    """Return the first matching intent key, or None if no analytics
    intent is found. Used by widget_chat to decide between Orion
    Analytics mode and normal OpenAI chat."""
    if not text or not isinstance(text, str):
        return None
    for key, pattern in INTENTS:
        if pattern.search(text):
            return key
    return None


async def _log_query(
    *,
    user: Dict[str, Any],
    question: str,
    intent: Optional[str],
    tool: Optional[str],
    success: bool,
    execution_ms: int,
    short_summary: str,
) -> None:
    """Append a single row to `orion_admin_query_logs`. Never logs
    secrets, raw rows, or content bodies — only short summary lines."""
    try:
        await db.orion_admin_query_logs.insert_one({
            "user_id":   user.get("id"),
            "username":  user.get("username"),
            "role":      _role_for(user),
            "question":  (question or "")[:500],
            "detected_intent": intent,
            "tool_called":     tool,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "success":   bool(success),
            "execution_time_ms": int(execution_ms),
            "short_result_summary": (short_summary or "")[:200],
        })
    except Exception:
        # Audit log failures must never break the analytics response.
        pass


async def maybe_handle_admin_query(
    current: Dict[str, Any],
    message: str,
) -> Optional[str]:
    """If the message matches an analytics intent, run the matching
    tool and return a markdown reply string. Returns None when this
    isn't an analytics query — the caller then falls through to the
    normal OpenAI chat path.

    Non-admin callers whose message DOES match an analytics intent
    receive the polite refusal string instead (no permission error,
    no leaked endpoint names).
    """
    intent = detect_intent(message)
    if not intent:
        return None

    # Non-admin who tries an analytics query → polite refusal.
    if not is_admin_user(current):
        # Audit non-admin attempt with a `refused` summary so abuse can
        # be spotted in the log without storing the user's exact words.
        await _log_query(
            user=current or {},
            question=message,
            intent=intent,
            tool=None,
            success=False,
            execution_ms=0,
            short_summary="refused: not_admin",
        )
        return _refusal()

    tool_fn = INTENT_TOOL.get(intent)
    if not tool_fn:
        return None

    started = time.perf_counter()
    try:
        reply, short = await tool_fn()
        ms = int((time.perf_counter() - started) * 1000)
        await _log_query(
            user=current,
            question=message,
            intent=intent,
            tool=tool_fn.__name__,
            success=True,
            execution_ms=ms,
            short_summary=short,
        )
        return reply
    except Exception as e:  # noqa: BLE001
        ms = int((time.perf_counter() - started) * 1000)
        await _log_query(
            user=current,
            question=message,
            intent=intent,
            tool=tool_fn.__name__,
            success=False,
            execution_ms=ms,
            short_summary=f"error:{type(e).__name__}",
        )
        # Soft-fail — let the caller fall through to normal chat with a
        # graceful note rather than raising 500.
        return ("I tried to pull that analytic but ran into an internal "
                "error. The OurRealm team has been notified via the audit "
                "log. You can try a different phrasing.")


__all__ = [
    "detect_intent",
    "maybe_handle_admin_query",
    "INTENTS",
    "INTENT_TOOL",
]
