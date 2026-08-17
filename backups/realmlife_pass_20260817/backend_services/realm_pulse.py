"""Realm Pulse — founder/investor-grade analytics aggregation (Feb 19 2026).

Design principles
-----------------
* Cheap reads. Every page-load query targets one of two collections:
  - `user_activity_days` — `{user_id, day, actions, first_seen_at}` with
    a unique `(user_id, day)` index. One write per user per day, full
    DAU/WAU/MAU answers in a single `count_documents` call.
  - `realm_pulse_snapshots` — hourly snapshot rows with the full payload
    pre-aggregated; the dashboard renders the most recent row instantly.
* No PII in exports. Every public surface returns *counts and ratios*
  only. Usernames, emails, IPs, message bodies, raw event log entries
  never leave the database.
* Idempotent. All write helpers (`record_activity`, `snapshot`) are
  safe to call multiple times — the hourly background job and the
  request-time helpers share the same primitives.
* Pluggable window. Every metric accepts an arbitrary day window
  (today / 7d / 30d / 90d / custom range) so the dashboard, the
  investor snapshot, and the CSV/PDF/XLSX export reuse identical
  code paths.

Active-user definition (canonical, per product spec)
----------------------------------------------------
A user is considered "active" for a given day if they performed at
least one *meaningful action* that day:
  * Signed in (POST /api/auth/login)
  * Viewed the feed for ≥ 30 seconds (heartbeat from client)
  * Created content (post, comment, sound, image, video)
  * Sent a message
  * Reacted to content (like/love)
  * Uploaded media

The frontend `useHeartbeat` hook is responsible for translating raw
activity into 30s-debounced heartbeats. The backend simply records
the *day* the heartbeat arrived; multiple heartbeats from the same
user collapse into one row via the unique compound index.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

from core.db import db

log = logging.getLogger("ourrealm.realm_pulse")


# --------------------------------------------------------------------- #
# Indexes — called once at startup.
# --------------------------------------------------------------------- #
async def ensure_indexes() -> None:
    """Idempotent. Skip-safe if collections / indexes already exist."""
    try:
        await db.user_activity_days.create_index(
            [("user_id", 1), ("day", 1)], unique=True,
        )
        await db.user_activity_days.create_index([("day", 1)])
        await db.realm_pulse_snapshots.create_index(
            [("generated_at", -1)],
        )
    except Exception as e:  # noqa: BLE001 — defensive on legacy collections
        log.warning("ensure_indexes(): %s", e)


# --------------------------------------------------------------------- #
# Activity write path — called from the heartbeat endpoint *and* from
# downstream feature endpoints (e.g. auth.login) for the canonical
# active-user signal.
# --------------------------------------------------------------------- #
def _day_str(when: Optional[datetime] = None) -> str:
    when = when or datetime.now(timezone.utc)
    return when.strftime("%Y-%m-%d")


async def record_activity(user_id: str, *, when: Optional[datetime] = None) -> None:
    """Mark `user_id` active for the current UTC day. Idempotent — only
    the first call per (user, day) inserts a row; subsequent calls bump
    the action counter via a $inc. Never raises."""
    if not user_id:
        return
    when = when or datetime.now(timezone.utc)
    day = _day_str(when)
    try:
        await db.user_activity_days.update_one(
            {"user_id": user_id, "day": day},
            {
                "$inc": {"actions": 1},
                "$setOnInsert": {
                    "user_id": user_id,
                    "day": day,
                    "first_seen_at": when.isoformat(),
                },
            },
            upsert=True,
        )
    except Exception as e:  # noqa: BLE001 — analytics must never break a request
        log.debug("record_activity skipped (%s) for %s", e, user_id)


# --------------------------------------------------------------------- #
# Window helpers — same {start, end, days} contract everywhere.
# --------------------------------------------------------------------- #
def _resolve_window(
    window: str = "7d",
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> tuple[date, date, int]:
    today = datetime.now(timezone.utc).date()
    if start and end:
        try:
            s = datetime.fromisoformat(start).date()
            e = datetime.fromisoformat(end).date()
            if e < s:
                s, e = e, s
            return s, e, (e - s).days + 1
        except ValueError:
            pass
    days = {"today": 1, "1d": 1, "7d": 7, "30d": 30, "90d": 90}.get(window, 7)
    return today - timedelta(days=days - 1), today, days


def _days_in_range(s: date, e: date) -> list[str]:
    out = []
    cur = s
    while cur <= e:
        out.append(cur.strftime("%Y-%m-%d"))
        cur = cur + timedelta(days=1)
    return out


# --------------------------------------------------------------------- #
# Primary growth metrics.
# --------------------------------------------------------------------- #
async def dau(day: Optional[str] = None) -> int:
    day = day or _day_str()
    return await db.user_activity_days.count_documents({"day": day})


async def active_users_in_window(start: date, end: date) -> int:
    """Distinct user count between [start, end] inclusive."""
    days = _days_in_range(start, end)
    pipeline = [
        {"$match": {"day": {"$in": days}}},
        {"$group": {"_id": "$user_id"}},
        {"$count": "n"},
    ]
    row = await db.user_activity_days.aggregate(pipeline).to_list(1)
    return row[0]["n"] if row else 0


async def wau(today: Optional[date] = None) -> int:
    today = today or datetime.now(timezone.utc).date()
    return await active_users_in_window(today - timedelta(days=6), today)


async def mau(today: Optional[date] = None) -> int:
    today = today or datetime.now(timezone.utc).date()
    return await active_users_in_window(today - timedelta(days=29), today)


# --------------------------------------------------------------------- #
# Retention — D1 / D7 / D30 cohorts.
# --------------------------------------------------------------------- #
async def retention(window_start: date, window_end: date) -> dict:
    """For every user whose signup date falls in [window_start,
    window_end], compute whether they were active again on day-N
    afterwards. Returns the percentage retained for each of D1/D7/D30.
    """
    out = {"d1": None, "d7": None, "d30": None, "cohort_size": 0}
    # Pull signup dates from the users collection.
    cursor = db.users.find(
        {"created_at": {"$exists": True}},
        {"_id": 0, "id": 1, "created_at": 1},
    )
    cohort: list[tuple[str, date]] = []
    async for u in cursor:
        try:
            d = datetime.fromisoformat(u["created_at"].replace("Z", "+00:00")).date()
        except Exception:  # noqa: BLE001
            continue
        if window_start <= d <= window_end:
            cohort.append((u["id"], d))
    out["cohort_size"] = len(cohort)
    if not cohort:
        return out

    # Pull every activity row for these users (single query, then index
    # in-memory for O(1) lookup by (user_id, day)).
    user_ids = [u for u, _ in cohort]
    acts = db.user_activity_days.find(
        {"user_id": {"$in": user_ids}}, {"_id": 0, "user_id": 1, "day": 1},
    )
    by_user: dict[str, set[str]] = {}
    async for a in acts:
        by_user.setdefault(a["user_id"], set()).add(a["day"])

    for n, key in ((1, "d1"), (7, "d7"), (30, "d30")):
        eligible = 0
        retained = 0
        for uid, sign_day in cohort:
            target = sign_day + timedelta(days=n)
            # Only count cohort users whose target day has already happened.
            if target > datetime.now(timezone.utc).date():
                continue
            eligible += 1
            if target.strftime("%Y-%m-%d") in by_user.get(uid, set()):
                retained += 1
        out[key] = round(100.0 * retained / eligible, 1) if eligible else None
        out[f"{key}_eligible"] = eligible
        out[f"{key}_retained"] = retained
    return out


# --------------------------------------------------------------------- #
# Engagement metrics — averages per active user.
# --------------------------------------------------------------------- #
async def engagement_averages(start: date, end: date) -> dict:
    days = _days_in_range(start, end)
    iso_start = f"{days[0]}T00:00:00+00:00"
    iso_end = f"{days[-1]}T23:59:59+00:00"
    active = await active_users_in_window(start, end) or 1  # guard div/0
    counts = {
        "posts":    await db.posts.count_documents({"created_at": {"$gte": iso_start, "$lte": iso_end}}),
        "messages": await db.messages.count_documents({"created_at": {"$gte": iso_start, "$lte": iso_end}}) if "messages" in await db.list_collection_names() else 0,
        "sounds":   await db.sounds.count_documents({"created_at": {"$gte": iso_start, "$lte": iso_end}}) if "sounds" in await db.list_collection_names() else 0,
        "comments": await db.comments.count_documents({"created_at": {"$gte": iso_start, "$lte": iso_end}}) if "comments" in await db.list_collection_names() else 0,
    }
    actions_row = await db.user_activity_days.aggregate([
        {"$match": {"day": {"$in": days}}},
        {"$group": {"_id": None, "total": {"$sum": "$actions"}}},
    ]).to_list(1)
    total_actions = actions_row[0]["total"] if actions_row else 0
    return {
        "active_users":          active,
        "avg_posts_per_user":    round(counts["posts"] / active, 2),
        "avg_messages_per_user": round(counts["messages"] / active, 2),
        "avg_sounds_per_user":   round(counts["sounds"] / active, 2),
        "avg_comments_per_user": round(counts["comments"] / active, 2),
        "avg_actions_per_user":  round(total_actions / active, 2),
        "avg_sessions_per_day":  round(total_actions / max(active * len(days), 1), 2),
        "_counts":               counts,
    }


# --------------------------------------------------------------------- #
# Growth + community.
# --------------------------------------------------------------------- #
async def growth(start: date, end: date) -> dict:
    iso_start = f"{start.strftime('%Y-%m-%d')}T00:00:00+00:00"
    iso_end   = f"{end.strftime('%Y-%m-%d')}T23:59:59+00:00"
    new_users = await db.users.count_documents({"created_at": {"$gte": iso_start, "$lte": iso_end}})
    # Previous comparable window for growth rate.
    days = (end - start).days + 1
    prev_start = start - timedelta(days=days)
    prev_end   = start - timedelta(days=1)
    prev_iso_s = f"{prev_start.strftime('%Y-%m-%d')}T00:00:00+00:00"
    prev_iso_e = f"{prev_end.strftime('%Y-%m-%d')}T23:59:59+00:00"
    prev_new = await db.users.count_documents({"created_at": {"$gte": prev_iso_s, "$lte": prev_iso_e}})
    growth_rate = round(((new_users - prev_new) / prev_new) * 100, 1) if prev_new else None

    # Optional invite metrics — collections may not exist yet.
    try:
        invites_sent = await db.invites.count_documents({"sent_at": {"$gte": iso_start, "$lte": iso_end}})
        invites_accepted = await db.invites.count_documents({"accepted_at": {"$gte": iso_start, "$lte": iso_end}})
    except Exception:  # noqa: BLE001
        invites_sent, invites_accepted = 0, 0
    acceptance = round((invites_accepted / invites_sent) * 100, 1) if invites_sent else None
    # Viral coefficient k = avg_invites_per_user * acceptance_rate.
    inviters = max(1, await db.users.count_documents({}))
    avg_invites = invites_sent / inviters if inviters else 0
    k = round(avg_invites * (acceptance / 100 if acceptance is not None else 0), 2) if invites_sent else None

    return {
        "new_users":              new_users,
        "prev_period_new_users":  prev_new,
        "user_growth_rate_pct":   growth_rate,
        "referral_invites_sent":  invites_sent,
        "referral_invites_accepted": invites_accepted,
        "invite_acceptance_pct":  acceptance,
        "viral_coefficient":      k,
    }


async def community_totals(start: date, end: date) -> dict:
    iso_start = f"{start.strftime('%Y-%m-%d')}T00:00:00+00:00"
    iso_end   = f"{end.strftime('%Y-%m-%d')}T23:59:59+00:00"
    cols = await db.list_collection_names()

    async def _count(name: str, field: str = "created_at") -> int:
        if name not in cols:
            return 0
        try:
            return await db[name].count_documents({field: {"$gte": iso_start, "$lte": iso_end}})
        except Exception:  # noqa: BLE001
            return 0

    posts    = await _count("posts")
    messages = await _count("messages")
    sounds   = await _count("sounds")
    comments = await _count("comments")
    groups   = await _count("groups")
    return {
        "posts_created":    posts,
        "messages_sent":    messages,
        "sounds_uploaded":  sounds,
        "comments_created": comments,
        "groups_created":   groups,
        "total_content":    posts + messages + sounds + comments + groups,
    }


# --------------------------------------------------------------------- #
# Top insights — auto-generated highlights.
# --------------------------------------------------------------------- #
async def top_insights(start: date, end: date) -> dict:
    iso_start = f"{start.strftime('%Y-%m-%d')}T00:00:00+00:00"
    iso_end   = f"{end.strftime('%Y-%m-%d')}T23:59:59+00:00"

    # Fastest-growing hashtag in window.
    fastest = await db.posts.aggregate([
        {"$match": {"created_at": {"$gte": iso_start, "$lte": iso_end}, "hashtags": {"$exists": True, "$ne": []}}},
        {"$unwind": "$hashtags"},
        {"$group": {"_id": "$hashtags", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 1},
    ]).to_list(1)

    # Most-selected interest (across all users).
    most_selected = await db.users.aggregate([
        {"$unwind": "$interests"},
        {"$group": {"_id": "$interests", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 1},
    ]).to_list(1)

    # Most active creator in window (posts only — never returns username).
    creator = await db.posts.aggregate([
        {"$match": {"created_at": {"$gte": iso_start, "$lte": iso_end}}},
        {"$group": {"_id": "$author_id", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 1},
    ]).to_list(1)

    # Most engaged day (by total activity actions).
    busiest_day = await db.user_activity_days.aggregate([
        {"$match": {"day": {"$in": _days_in_range(start, end)}}},
        {"$group": {"_id": "$day", "n": {"$sum": "$actions"}}},
        {"$sort": {"n": -1}},
        {"$limit": 1},
    ]).to_list(1)

    return {
        "fastest_growing_interest": fastest[0]["_id"] if fastest else None,
        "fastest_growing_count":    fastest[0]["n"] if fastest else 0,
        "most_selected_interest":   most_selected[0]["_id"] if most_selected else None,
        "most_selected_count":      most_selected[0]["n"] if most_selected else 0,
        # Creator surfaces only as an *opaque count*, no user_id, no username.
        "top_creator_post_count":   creator[0]["n"] if creator else 0,
        "highest_engagement_day":   busiest_day[0]["_id"] if busiest_day else None,
        "highest_engagement_value": busiest_day[0]["n"] if busiest_day else 0,
    }


# --------------------------------------------------------------------- #
# Investor snapshot — plain-language status indicator.
# --------------------------------------------------------------------- #
def status_indicator(dau_val: int, mau_val: int, growth_rate_pct: Optional[float], d30: Optional[float]) -> str:
    """Map a small set of headline metrics to a one-word status label."""
    ratio = (dau_val / mau_val) if mau_val else 0
    if mau_val < 100:
        return "Early traction"
    if (d30 or 0) >= 30 and ratio >= 0.3:
        return "Strong engagement"
    if (growth_rate_pct or 0) >= 50:
        return "High growth"
    if ratio < 0.1 or (d30 is not None and d30 < 5):
        return "Needs attention"
    return "Early traction"


async def investor_snapshot(window: str = "30d", start: Optional[str] = None, end: Optional[str] = None) -> dict:
    s, e, _ = _resolve_window(window, start, end)
    d_dau = await dau()
    d_wau = await wau()
    d_mau = await mau()
    g     = await growth(s, e)
    ret   = await retention(s - timedelta(days=30), e - timedelta(days=30))  # cohort needs 30d look-back
    ratio = round((d_dau / d_mau) * 100, 1) if d_mau else 0.0
    return {
        "window":                 {"start": s.isoformat(), "end": e.isoformat()},
        "dau":                    d_dau,
        "wau":                    d_wau,
        "mau":                    d_mau,
        "dau_mau_ratio_pct":      ratio,
        "user_growth_rate_pct":   g["user_growth_rate_pct"],
        "d30_retention_pct":      ret["d30"],
        "status":                 status_indicator(d_dau, d_mau, g["user_growth_rate_pct"], ret["d30"]),
        "generated_at":           datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------- #
# Top-level overview — single call for the dashboard.
# --------------------------------------------------------------------- #
async def overview(window: str = "7d", start: Optional[str] = None, end: Optional[str] = None) -> dict:
    s, e, days = _resolve_window(window, start, end)
    snapshot = await db.realm_pulse_snapshots.find_one(
        {"window": window}, {"_id": 0}, sort=[("generated_at", -1)],
    ) if window in ("7d", "30d", "90d") else None
    # If a fresh snapshot (< 1h old) is available for a built-in window,
    # serve that instead of rerunning the aggregations.
    fresh_ttl = 60 * 60  # 1 hour
    if snapshot:
        gen = snapshot.get("generated_at")
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(gen.replace("Z", "+00:00"))).total_seconds()
            if age < fresh_ttl:
                # Always overlay the right-now counters so DAU stays live.
                snapshot["dau"]              = await dau()
                snapshot["window_label"]     = window
                snapshot["served_from_cache"] = True
                return snapshot
        except Exception:  # noqa: BLE001
            pass

    payload = {
        "window":          {"key": window, "start": s.isoformat(), "end": e.isoformat(), "days": days},
        "dau":             await dau(),
        "wau":             await wau(),
        "mau":             await mau(),
        "retention":       await retention(s, e),
        "engagement":      await engagement_averages(s, e),
        "growth":          await growth(s, e),
        "community":       await community_totals(s, e),
        "top_insights":    await top_insights(s, e),
        "generated_at":    datetime.now(timezone.utc).isoformat(),
        "served_from_cache": False,
    }
    payload["dau_mau_ratio_pct"] = round((payload["dau"] / payload["mau"]) * 100, 1) if payload["mau"] else 0.0
    return payload


# --------------------------------------------------------------------- #
# Snapshot writer — driven by the hourly background job.
# --------------------------------------------------------------------- #
async def write_snapshot(window: str = "7d") -> dict:
    """Compute the full overview() for `window` and persist it. Returns
    the written document so the caller can log a summary line."""
    payload = await overview(window)
    # Add flat fields used for snapshot lookup. We keep the original
    # `window` dict intact under `window_meta` for export/PDF rendering.
    payload["window_meta"] = payload.get("window") if isinstance(payload.get("window"), dict) else {"key": window}
    payload["window_key"]  = window
    payload["window"]      = window  # flat scalar for the snapshot index
    try:
        await db.realm_pulse_snapshots.insert_one(payload)
    except Exception as e:  # noqa: BLE001
        log.warning("write_snapshot(%s) failed: %s", window, e)
    return payload


# --------------------------------------------------------------------- #
# Export helpers — CSV/PDF/XLSX. The router decides the content-type;
# all formats return BYTES so FastAPI can stream them directly.
# --------------------------------------------------------------------- #
def _flatten_for_export(payload: dict) -> list[tuple[str, str]]:
    """Recursively flatten an overview() payload into label/value rows
    suitable for CSV/XLSX/PDF. PII never enters this pipeline because
    `overview()` itself contains only counts/ratios."""
    rows: list[tuple[str, str]] = []

    def _walk(prefix: str, node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k.startswith("_"):
                    continue
                _walk(f"{prefix}.{k}" if prefix else k, v)
        elif isinstance(node, list):
            rows.append((prefix, ", ".join(str(x) for x in node)))
        else:
            rows.append((prefix, "" if node is None else str(node)))

    _walk("", payload)
    return rows


def render_csv(payload: dict) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["metric", "value"])
    for label, value in _flatten_for_export(payload):
        w.writerow([label, value])
    return buf.getvalue().encode("utf-8")


def render_xlsx(payload: dict) -> bytes:
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Realm Pulse"
    ws.append(["Metric", "Value"])
    for label, value in _flatten_for_export(payload):
        ws.append([label, value])
    ws.column_dimensions["A"].width = 40
    ws.column_dimensions["B"].width = 26
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def render_pdf(payload: dict, *, title: str = "OurRealm — Realm Pulse") -> bytes:
    """Lightweight investor-style PDF. Uses reportlab + the same flat
    label/value table as CSV/XLSX so all three exports stay in sync."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, title=title)
    win = payload.get("window_meta") or payload.get("window") or {}
    win_key = win.get("key", "") if isinstance(win, dict) else str(win)
    styles = getSampleStyleSheet()
    story = [
        Paragraph(title, styles["Title"]),
        Paragraph(
            f"Generated {payload.get('generated_at', '')} · window: {win_key}",
            styles["Normal"],
        ),
        Spacer(1, 12),
    ]
    rows = [["Metric", "Value"]] + [list(r) for r in _flatten_for_export(payload)]
    table = Table(rows, colWidths=[280, 220])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#10E670")),
        ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
        ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID",       (0, 0), (-1, -1), 0.25, colors.HexColor("#cccccc")),
        ("FONTSIZE",   (0, 0), (-1, -1), 8),
    ]))
    story.append(table)
    story.append(Spacer(1, 18))
    story.append(Paragraph(
        "<i>Definitions: Active user = ≥1 meaningful action (sign-in, 30s feed view, content/message/comment, reaction, media upload). "
        "All values are aggregate counts/ratios; no usernames, message bodies, or personally identifiable data are included.</i>",
        styles["BodyText"],
    ))
    doc.build(story)
    return buf.getvalue()
