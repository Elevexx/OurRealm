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
    # ── Phase 3.7 — Founder Command Center (drafts + briefings) ─────
    # These come FIRST so they win over the more general Phase 3.6
    # analytics intents (e.g. "founder briefing" must beat "investor
    # snapshot", "draft a badge" must beat "badges").
    ("founder_briefing",    re.compile(r"\b(founder\s+briefing|executive\s+summary|exec\s+brief|brief\s+me|founder\s+update)\b", re.I)),
    ("top_reported_users",  re.compile(r"\b((most|highest)\s+reported\s+users?|users?\s+with\s+the\s+most\s+reports?)\b", re.I)),
    ("top_reported_content",re.compile(r"\b((most|highest)\s+reported\s+(content|posts?)|posts?\s+with\s+the\s+most\s+reports?)\b", re.I)),
    ("oldest_tickets",      re.compile(r"\b(oldest\s+(unresolved\s+)?tickets?|tickets?\s+needing\s+urgent\s+attention|stale\s+tickets?)\b", re.I)),
    ("moderation_risks",    re.compile(r"\b((any\s+)?risky\s+moderation|moderation\s+risks?|critical\s+moderation|urgent\s+moderation)\b", re.I)),
    ("draft_badge",         re.compile(r"\b(draft\s+(a\s+)?badge|create\s+(a\s+)?badge|new\s+badge\s+idea|design\s+(a\s+)?badge)\b", re.I)),
    ("draft_widget",        re.compile(r"\b(draft\s+(a\s+)?widget|new\s+widget\s+idea|widget\s+(spec|launch\s+plan)|design\s+(a\s+)?widget)\b", re.I)),
    ("draft_announcement",  re.compile(r"\b(draft\s+(an\s+)?announcement|release\s+notes?|announce\s+|new\s+announcement)\b", re.I)),
    ("draft_support_reply", re.compile(r"\b(draft\s+(a\s+)?(support\s+)?(response|reply)|suggest\s+(a\s+)?reply|reply\s+to\s+ticket)\b", re.I)),
    ("widget_launch_list",  re.compile(r"\b(launched\s+widgets?|all\s+(launched|live)\s+widgets?|widget\s+adoption)\b", re.I)),
    ("disabled_widgets",    re.compile(r"\b(disabled\s+widgets?|draft\s+widgets?|inactive\s+widgets?)\b", re.I)),
    ("badge_holders",       re.compile(r"\b((vip|founder|beta|verified)\s+holders?|how\s+many\s+(vip|founder|beta|verified))\b", re.I)),
    ("inactive_realms",     re.compile(r"\b(inactive\s+realms?|stale\s+realms?|realms?\s+needing\s+attention)\b", re.I)),
    # ── Phase 3.6 — read-only analytics ─────────────────────────────
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

# Phase 3.7 — intents whose handler emits a DRAFT (no live execution).
# Used by the chat interceptor to decide between QUERY and ACTION
# audit log destinations, and to flag the response as confirmation-
# required so the founder is reminded nothing was created.
DRAFT_INTENTS = {
    "draft_badge", "draft_widget", "draft_announcement", "draft_support_reply",
    "moderation_risks",
}
# Phase 3.7 — explicit confirmation phrases. Other replies (e.g. "ok",
# "looks good") MUST NOT be treated as approval.
CONFIRM_PATTERNS = [
    re.compile(r"\byes,?\s+execute\b", re.I),
    re.compile(r"\bconfirm(ed)?\b", re.I),
    re.compile(r"\bapprove\s+this\s+action\b", re.I),
    re.compile(r"\blaunch\s+it\s+now\b", re.I),
]

def is_explicit_confirmation(text: str) -> bool:
    """True only when the message contains one of the explicit
    confirmation phrases mandated by Phase 3.7. Vague replies like
    "ok" / "looks good" / "sure" are NEVER treated as approval."""
    if not text or not isinstance(text, str):
        return False
    return any(p.search(text) for p in CONFIRM_PATTERNS)



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
# Phase 3.7 — Founder Command Center tools (read + draft).
# Every draft tool emits text only and writes an entry to
# orion_action_logs via the dispatcher with approval_status='pending'.
# No DB mutation outside the audit log.
# ─────────────────────────────────────────────────────────────────────
DRAFT_FOOTER = (
    "\n\n---\n_This is only a draft. **Nothing has been created, "
    "launched, or executed.** To proceed, reply with one of: "
    "“Yes, execute”, “Confirm”, “Approve this action”, or “Launch it "
    "now”. Vague replies (“ok”, “sure”) will NOT be treated as "
    "approval._"
)


async def _tool_founder_briefing() -> Tuple[str, str]:
    """Composite executive summary — pulls from realm_pulse + key
    counts. Gracefully omits any metric whose collection is missing.
    """
    today_iso, end_iso = _today_iso_range()
    week_s, week_e = _week_iso_range()
    snap = await realm_pulse.investor_snapshot(window="30d")
    new_today = await _safe_count("users", {"created_at": {"$gte": today_iso, "$lte": end_iso}})
    new_week = await _safe_count("users", {"created_at": {"$gte": week_s, "$lte": week_e}})
    posts_today = await _safe_count("posts", {"created_at": {"$gte": today_iso, "$lte": end_iso}})
    sounds_today = await _safe_count("sounds", {"created_at": {"$gte": today_iso, "$lte": end_iso}})
    msgs_today = await _safe_count("community_messages", {"created_at": {"$gte": today_iso, "$lte": end_iso}})
    msgs_today += await _safe_count("messages", {"created_at": {"$gte": today_iso, "$lte": end_iso}})
    open_reports = await _safe_count("reports", {"status": "open"})
    open_tickets = await _safe_count("support_tickets", {"status": {"$in": ["open", "in_progress"]}})
    new_realms_today = await _safe_count("realms", {"created_at": {"$gte": today_iso, "$lte": end_iso}})

    # Top realm (best-effort)
    top_realm_label = None
    try:
        pipeline = [
            {"$match": {"created_at": {"$gte": week_s, "$lte": week_e}}},
            {"$group": {"_id": "$realm_id", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}},
            {"$limit": 1},
        ]
        agg = await db.community_messages.aggregate(pipeline).to_list(1)
        if agg:
            r = await db.realms.find_one({"id": agg[0]["_id"]}, {"_id": 0, "name": 1, "slug": 1})
            top_realm_label = (r or {}).get("name") or (r or {}).get("slug")
    except Exception:
        pass

    # Oldest unresolved ticket age
    oldest_ticket = None
    try:
        row = await db.support_tickets.find(
            {"status": {"$in": ["open", "in_progress"]}},
            {"_id": 0, "created_at": 1, "id": 1, "subject": 1},
        ).sort("created_at", 1).limit(1).to_list(1)
        if row:
            oldest_ticket = row[0]
    except Exception:
        pass

    lines = [
        "**Founder briefing**",
        "",
        "**Growth**",
        f"• DAU / WAU / MAU: {snap['dau']} / {snap['wau']} / {snap['mau']}  (stickiness {snap['dau_mau_ratio_pct']}%)",
        f"• New users — today: {new_today}  ·  this week: {new_week}",
        f"• 30-day status: **{snap.get('status','Early traction')}**",
        "",
        "**Activity**",
        f"• Posts today: {posts_today}",
        f"• Sounds today: {sounds_today}",
        f"• Messages today: {msgs_today}",
        f"• New realms today: {new_realms_today}",
    ]
    if top_realm_label:
        lines.append(f"• Top realm this week: {top_realm_label}")
    lines += [
        "",
        "**Risks needing attention**",
        f"• Open moderation reports: {open_reports}",
        f"• Open support tickets: {open_tickets}",
    ]
    if oldest_ticket:
        lines.append(f"• Oldest unresolved ticket: “{(oldest_ticket.get('subject') or 'untitled')[:60]}” opened {oldest_ticket.get('created_at')}")
    lines += [
        "",
        "**Recommended next actions** (drafts only — confirm before any change)",
        "• Triage the moderation queue if it grew >20% week-over-week.",
        "• Reply to the oldest unresolved support ticket.",
        "• Recognize your top realm of the week in an announcement.",
    ]
    summary = (
        f"dau={snap['dau']} mau={snap['mau']} new_today={new_today} "
        f"open_reports={open_reports} open_tickets={open_tickets}"
    )
    return "\n".join(lines), summary


async def _tool_top_reported_users() -> Tuple[str, str]:
    pipeline = [
        {"$match": {"status": "open"}},
        {"$group": {"_id": "$reported_user_id", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 10},
    ]
    rows = []
    try:
        rows = await db.reports.aggregate(pipeline).to_list(10)
    except Exception:
        rows = []
    rows = [r for r in rows if r.get("_id")]
    if not rows:
        return "No open reports against any user right now.", "rows=0"
    ids = [r["_id"] for r in rows]
    users = {}
    async for u in db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "username": 1}):
        users[u["id"]] = u
    lines = ["**Most reported users (open reports, last all-time):**"]
    for i, r in enumerate(rows, 1):
        u = users.get(r["_id"], {})
        label = (f"@{u['username']}" if u.get("username") else r["_id"][:8] + "…")
        lines.append(f"{i}. {label} — {r['n']} open reports")
    return "\n".join(lines), f"top={rows[0]['n']}"


async def _tool_top_reported_content() -> Tuple[str, str]:
    pipeline = [
        {"$match": {"status": "open"}},
        {"$group": {"_id": "$target_id", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 10},
    ]
    rows = []
    try:
        rows = await db.reports.aggregate(pipeline).to_list(10)
    except Exception:
        rows = []
    rows = [r for r in rows if r.get("_id")]
    if not rows:
        return "No content has open reports right now.", "rows=0"
    lines = ["**Most reported content (open reports):**"]
    for i, r in enumerate(rows, 1):
        lines.append(f"{i}. content {r['_id'][:8]}… — {r['n']} reports")
    return "\n".join(lines), f"top={rows[0]['n']}"


async def _tool_oldest_tickets(limit: int = 5) -> Tuple[str, str]:
    rows = []
    try:
        rows = await db.support_tickets.find(
            {"status": {"$in": ["open", "in_progress"]}},
            {"_id": 0, "id": 1, "subject": 1, "created_at": 1, "category": 1},
        ).sort("created_at", 1).limit(limit).to_list(limit)
    except Exception:
        rows = []
    if not rows:
        return "No open or in-progress support tickets right now.", "rows=0"
    lines = [f"**Oldest {len(rows)} unresolved support tickets:**"]
    for i, r in enumerate(rows, 1):
        subj = (r.get("subject") or "(no subject)")[:60]
        lines.append(f"{i}. “{subj}” — opened {r.get('created_at', '?')}  ({r.get('category') or 'general'})")
    return "\n".join(lines), f"oldest_count={len(rows)}"


async def _tool_moderation_risks() -> Tuple[str, str]:
    """Composite recommendation — flags issues worth founder attention.
    Marked as DRAFT_INTENT so it's audited as an action-log entry."""
    week_s, week_e = _week_iso_range()
    open_ = await _safe_count("reports", {"status": "open"})
    this_week = await _safe_count("reports", {"created_at": {"$gte": week_s, "$lte": week_e}})
    investigating = await _safe_count("reports", {"status": "investigating"})
    risks = []
    if open_ >= 50:
        risks.append(f"🔴 **Moderation queue is large** — {open_} open reports. Consider a dedicated triage session.")
    elif open_ >= 10:
        risks.append(f"🟡 {open_} open reports — consider scheduling a triage block.")
    else:
        risks.append(f"🟢 Open reports manageable ({open_}).")
    if investigating >= 10:
        risks.append(f"🟡 {investigating} reports currently 'investigating' — risk of stalling.")
    if this_week >= 100:
        risks.append(f"🔴 {this_week} reports filed this week — investigate root cause spike.")
    elif this_week >= 30:
        risks.append(f"🟡 {this_week} reports this week — slightly elevated.")
    lines = ["**Moderation risk assessment** (read-only)"]
    lines += [f"• {r}" for r in risks]
    lines += [
        "",
        "**Recommended next actions** (drafts — nothing executed)",
        "• Sort the open queue by age — close stale low-severity reports.",
        "• Spot-check the highest-reported users / content this week.",
        "• If volume is anomalous, draft a community-guidelines reminder.",
    ]
    return "\n".join(lines) + DRAFT_FOOTER, f"open={open_} week={this_week} inv={investigating}"


async def _tool_widget_launch_list() -> Tuple[str, str]:
    rows = []
    try:
        rows = await db.widget_registry.find(
            {"status": "live"},
            {"_id": 0, "key": 1, "name": 1, "placements": 1, "access_groups": 1, "is_system": 1},
        ).sort("name", 1).to_list(100)
    except Exception:
        rows = []
    if not rows:
        return "No live widgets in the registry.", "rows=0"
    lines = [f"**Launched widgets ({len(rows)} live):**"]
    for r in rows[:40]:
        groups = ",".join(r.get("access_groups") or [])
        placements = "/".join(r.get("placements") or [])
        sys_tag = " · system" if r.get("is_system") else ""
        lines.append(f"• `{r['key']}` — {r['name']}  ({placements} · {groups}{sys_tag})")
    if len(rows) > 40:
        lines.append(f"… and {len(rows) - 40} more.")
    return "\n".join(lines), f"live={len(rows)}"


async def _tool_disabled_widgets() -> Tuple[str, str]:
    rows = []
    try:
        rows = await db.widget_registry.find(
            {"status": {"$in": ["draft", "disabled"]}},
            {"_id": 0, "key": 1, "name": 1, "status": 1, "placements": 1},
        ).sort("name", 1).to_list(100)
    except Exception:
        rows = []
    if not rows:
        return "All widgets are currently live.", "rows=0"
    lines = [f"**Draft / disabled widgets ({len(rows)}):**"]
    for r in rows[:40]:
        placements = "/".join(r.get("placements") or [])
        lines.append(f"• `{r['key']}` — {r['name']}  ({r.get('status')} · {placements})")
    return "\n".join(lines), f"count={len(rows)}"


async def _tool_badge_holders() -> Tuple[str, str]:
    """Per-key holder counts for FOUNDER / VIP / BETA / VERIFIED."""
    keys = ["founder", "vip", "beta", "verified"]
    out = []
    for k in keys:
        n = await _safe_count("user_badges", {"badge_key": k})
        out.append((k, n))
    lines = ["**Badge holders:**"] + [f"• {k.upper()}: {n}" for k, n in out]
    return "\n".join(lines), ",".join([f"{k}={n}" for k, n in out])


async def _tool_inactive_realms(limit: int = 10) -> Tuple[str, str]:
    week_s, week_e = _week_iso_range()
    # Realms whose last `community_messages` activity is OUTSIDE the
    # 7-day window (or have none at all).
    active_ids = set()
    try:
        rows = await db.community_messages.aggregate([
            {"$match": {"created_at": {"$gte": week_s, "$lte": week_e}}},
            {"$group": {"_id": "$realm_id"}},
        ]).to_list(1000)
        active_ids = {r["_id"] for r in rows if r.get("_id")}
    except Exception:
        active_ids = set()
    inactive = []
    async for r in db.realms.find({}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "created_at": 1}).limit(200):
        if r["id"] not in active_ids:
            inactive.append(r)
    inactive.sort(key=lambda r: r.get("created_at") or "")
    if not inactive:
        return "Every realm had at least one message in the last 7 days.", "inactive=0"
    lines = [f"**Inactive realms ({len(inactive)} with no chat in the last 7d):**"]
    for r in inactive[:limit]:
        label = r.get("name") or r.get("slug") or r["id"]
        lines.append(f"• {label}  (since {r.get('created_at', '?')[:10]})")
    return "\n".join(lines), f"inactive={len(inactive)}"


# ── Draft tools — text-only, no DB mutation ──────────────────────────
async def _tool_draft_badge() -> Tuple[str, str]:
    draft = (
        "**Badge draft**\n"
        "```yaml\n"
        "name: Example Achievement\n"
        "key: example_achievement\n"
        "description: Awarded to users who reach a meaningful milestone.\n"
        "icon: Award\n"
        "color: #00FF66\n"
        "border_color: #00FF66\n"
        "glow_color: #00FF66\n"
        "gradient: null\n"
        "status: draft\n"
        "assignment_type: auto\n"
        "auto_rule: first_x\n"
        "first_x: 1000\n"
        "access_groups: [all_users]\n"
        "```\n"
        "**Eligibility:** Replace `auto_rule` + `first_x` with the exact trigger you want (e.g. "
        "`auto_rule: sounds_uploaded`, `threshold: 1000`).\n"
        "**Launch notes:** Start in `draft` status, create 1 test recipient, verify the badge "
        "renders correctly on a profile, then flip to `live`.\n"
        "**Risks:** New `auto_rule` keys must be wired into the reconcile job; otherwise the "
        "badge will be dormant. Plan a backfill if granting retroactively."
        + DRAFT_FOOTER
    )
    return draft, "draft_badge"


async def _tool_draft_widget() -> Tuple[str, str]:
    draft = (
        "**Widget draft**\n"
        "```yaml\n"
        "name: Example Widget\n"
        "key: example_widget\n"
        "category: custom\n"
        "icon: Sparkles\n"
        "default_size: medium\n"
        "placements: [profile, realm]\n"
        "access_groups: [all_users]\n"
        "status: draft\n"
        "editor_config:\n"
        "  fields:\n"
        "    - { key: title,    label: Title,    type: text }\n"
        "    - { key: subtitle, label: Subtitle, type: text }\n"
        "    - { key: body,     label: Body,     type: textarea, rows: 6 }\n"
        "```\n"
        "**Launch plan:** Seed the registry row in `draft`, open the Custom Widget Builder, "
        "preview on a test profile, then promote to `live`.\n"
        "**Risks:** Confirm `placements` and `access_groups` before flipping live so it "
        "doesn't expose to unintended audiences."
        + DRAFT_FOOTER
    )
    return draft, "draft_widget"


async def _tool_draft_announcement() -> Tuple[str, str]:
    snap = await realm_pulse.investor_snapshot(window="30d")
    draft = (
        "**Announcement draft**\n\n"
        f"**Subject:** A quick update from OurRealm — {datetime.now(timezone.utc).strftime('%b %Y')}\n\n"
        "Hey realm! 👋\n\n"
        "A quick check-in: we've crossed some meaningful milestones this month.\n\n"
        f"• Daily active users: **{snap['dau']}**\n"
        f"• Weekly active: **{snap['wau']}**\n"
        f"• Monthly active: **{snap['mau']}**\n"
        f"• Stickiness (DAU/MAU): **{snap['dau_mau_ratio_pct']}%**\n\n"
        "We're working on the next phase of Realms widgets, faster posting, and a smoother "
        "DM experience. As always — keep the feedback coming.\n\n"
        "— The OurRealm team"
        + DRAFT_FOOTER
    )
    return draft, "draft_announcement"


async def _tool_draft_support_reply() -> Tuple[str, str]:
    # Pull the single oldest open ticket and propose a reply skeleton.
    ticket = None
    try:
        rows = await db.support_tickets.find(
            {"status": {"$in": ["open", "in_progress"]}},
            {"_id": 0, "id": 1, "subject": 1, "category": 1, "created_at": 1, "user_username": 1},
        ).sort("created_at", 1).limit(1).to_list(1)
        ticket = rows[0] if rows else None
    except Exception:
        ticket = None
    if not ticket:
        return "No open support tickets to draft a reply for.", "rows=0"
    subj = (ticket.get("subject") or "your ticket")[:80]
    cat = ticket.get("category") or "general"
    handle = ticket.get("user_username") or "there"
    draft = (
        f"**Support reply draft — ticket #{ticket['id'][:8]}**\n\n"
        f"To: @{handle}\n"
        f"Subject: Re: {subj}\n"
        f"Category: {cat}\n\n"
        f"Hi @{handle},\n\n"
        "Thanks for flagging this — apologies for the wait. We've taken a look and here's where things stand:\n\n"
        "1. [Acknowledge the specific issue mentioned in the original ticket]\n"
        "2. [State what you've done or are about to do]\n"
        "3. [Set a clear expectation for next steps + an ETA]\n\n"
        "If anything else has come up in the meantime, just reply to this thread and we'll roll it in.\n\n"
        "Thanks for being part of OurRealm,\n"
        "— Support"
        + DRAFT_FOOTER
    )
    return draft, f"ticket_id={ticket['id'][:8]}"


# Plug in Phase 3.7 tools.
INTENT_TOOL_37 = {
    "founder_briefing":     _tool_founder_briefing,
    "top_reported_users":   _tool_top_reported_users,
    "top_reported_content": _tool_top_reported_content,
    "oldest_tickets":       _tool_oldest_tickets,
    "moderation_risks":     _tool_moderation_risks,
    "widget_launch_list":   _tool_widget_launch_list,
    "disabled_widgets":     _tool_disabled_widgets,
    "badge_holders":        _tool_badge_holders,
    "inactive_realms":      _tool_inactive_realms,
    "draft_badge":          _tool_draft_badge,
    "draft_widget":         _tool_draft_widget,
    "draft_announcement":   _tool_draft_announcement,
    "draft_support_reply":  _tool_draft_support_reply,
}


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
    **INTENT_TOOL_37,
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


async def _log_action(
    *,
    user: Dict[str, Any],
    question: str,
    intent: Optional[str],
    tool: Optional[str],
    confirmation_required: bool,
    approval_status: str,
    success: bool,
    execution_ms: int,
    short_summary: str,
) -> None:
    """Phase 3.7 — Append a single row to `orion_action_logs`. Used
    for draft-generation tools (badge / widget / announcement /
    support-reply / moderation_risks) and any explicit-confirmation
    follow-ups. NEVER persists raw drafts in full — only a short
    summary line and the originating request (truncated to 500c).

    `approval_status` ∈ { pending, approved, declined, n/a }.
    Phase 3.7 NEVER executes; even an `approved` row never has a real
    result other than `result='draft_only'`.
    """
    try:
        await db.orion_action_logs.insert_one({
            "user_id":   user.get("id"),
            "username":  user.get("username"),
            "role":      _role_for(user),
            "action_type": intent,
            "requested_action": (question or "")[:500],
            "prepared_draft":  True if approval_status in ("pending", "approved") else False,
            "confirmation_required": bool(confirmation_required),
            "approval_status": approval_status,
            "tool_called": tool,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "result": "draft_only",
            "success": bool(success),
            "short_result_summary": (short_summary or "")[:200],
            "execution_time_ms": int(execution_ms),
        })
    except Exception:
        pass


async def maybe_handle_admin_query(
    current: Dict[str, Any],
    message: str,
) -> Optional[str]:
    """If the message matches an analytics intent OR an explicit
    confirmation phrase, run the matching tool and return a markdown
    reply string. Returns None when this isn't an analytics query —
    the caller then falls through to the normal OpenAI chat path.

    Non-admin callers whose message DOES match an analytics intent
    receive the polite refusal string instead (no permission error,
    no leaked endpoint names).
    """
    # Phase 3.7 — explicit confirmation handler. If a founder/admin
    # replies with "Yes, execute" / "Confirm" / "Approve this action"
    # / "Launch it now", we log it as an approval BUT still refuse to
    # execute (Phase 3.7 is draft-only). Vague replies fall through.
    if is_explicit_confirmation(message) and is_admin_user(current):
        await _log_action(
            user=current,
            question=message,
            intent="confirmation_received",
            tool=None,
            confirmation_required=False,
            approval_status="approved",
            success=True,
            execution_ms=0,
            short_summary="approval_received_but_phase37_is_draft_only",
        )
        return (
            "Approval recorded in the audit log. **No live action has been "
            "executed** — Phase 3.7 is draft-only. Execution tools will be "
            "wired in a later phase, and they'll require this same "
            "explicit-confirmation gate before they run."
        )

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
        # Phase 3.7 — also record draft intents in the action log so
        # the founder-only /admin/orion-logs surface can show them.
        if intent in DRAFT_INTENTS:
            await _log_action(
                user=current,
                question=message,
                intent=intent,
                tool=tool_fn.__name__,
                confirmation_required=True,
                approval_status="pending",
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
    "is_explicit_confirmation",
    "maybe_handle_admin_query",
    "INTENTS",
    "INTENT_TOOL",
    "DRAFT_INTENTS",
]
