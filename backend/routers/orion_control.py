"""ORAi Control — founder-only lightweight settings / overview /
providers / scan endpoints for the upgraded /admin/orion dashboard.
Persists ONE singleton doc in `orion_settings`; activity is written to
the EXISTING `orion_action_logs` collection so the audit surfaces and
activity feed reuse the same data. No routing/orchestration logic."""
from __future__ import annotations
import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser

router = APIRouter(prefix="/api/admin/orion", tags=["admin-orion-control"])

_scan_lock = asyncio.Lock()  # prevents overlapping scans (scheduler + manual)


def _require_founder(current: dict) -> None:
    if (current.get("username") or "").lower() != "stealth":
        raise HTTPException(status_code=403, detail="Founder-only.")


DEFAULT_SETTINGS = {
    "enabled": True,
    "power_level": 5,
    "notifications": True,
    "auto_report": True,
    "notify_founder": False,
    "scan": {"enabled": False, "frequency": "manual",
             "custom": {"days": 0, "hours": 6, "minutes": 0}},
    "providers": {},
}

FREQUENCIES = ("manual", "hourly", "daily", "weekly", "custom")

PROVIDERS = [
    {"id": "emergent", "name": "Emergent Universal", "env": "EMERGENT_LLM_KEY",
     "models": "OpenAI · Anthropic · Gemini"},
    {"id": "openai", "name": "OpenAI", "env": "OPENAI_API_KEY", "models": "GPT models"},
    {"id": "anthropic", "name": "Anthropic", "env": "ANTHROPIC_API_KEY", "models": "Claude models"},
    {"id": "gemini", "name": "Google Gemini", "env": "GEMINI_API_KEY", "models": "Gemini models"},
]


async def _get_settings() -> dict:
    doc = await db.orion_settings.find_one({"key": "singleton"}, {"_id": 0}) or {}
    out = dict(DEFAULT_SETTINGS)
    for k in ("enabled", "power_level", "notifications", "providers",
              "auto_report", "notify_founder"):
        if k in doc:
            out[k] = doc[k]
    out["scan"] = {**DEFAULT_SETTINGS["scan"], **(doc.get("scan") or {})}
    out["scan"]["custom"] = {**DEFAULT_SETTINGS["scan"]["custom"],
                             **(out["scan"].get("custom") or {})}
    out["last_scan"] = doc.get("last_scan")
    out["prev_scan"] = doc.get("prev_scan")
    out["last_report"] = doc.get("last_report")
    return out


async def _log_action(current: dict, action_type: str, summary: str) -> None:
    try:
        await db.orion_action_logs.insert_one({
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "username": current.get("username"),
            "role": "founder",
            "action_type": action_type,
            "tool_called": "orai_control",
            "approval_status": "n/a",
            "success": True,
            "short_result_summary": summary,
        })
    except Exception:  # noqa: BLE001
        pass


@router.get("/settings")
async def get_settings(current: CurrentUser):
    _require_founder(current)
    return await _get_settings()


class SettingsPayload(BaseModel):
    enabled: Optional[bool] = None
    power_level: Optional[int] = None
    notifications: Optional[bool] = None
    auto_report: Optional[bool] = None
    notify_founder: Optional[bool] = None
    scan: Optional[dict] = None


@router.put("/settings")
async def put_settings(payload: SettingsPayload, current: CurrentUser):
    _require_founder(current)
    updates: dict = {}
    changed: list[str] = []
    if payload.enabled is not None:
        updates["enabled"] = bool(payload.enabled)
        changed.append(f"enabled={payload.enabled}")
    if payload.power_level is not None:
        if not 1 <= payload.power_level <= 10:
            raise HTTPException(status_code=400, detail="power_level must be 1-10")
        updates["power_level"] = payload.power_level
        changed.append(f"power_level={payload.power_level}")
    if payload.notifications is not None:
        updates["notifications"] = bool(payload.notifications)
        changed.append(f"notifications={payload.notifications}")
    if payload.auto_report is not None:
        updates["auto_report"] = bool(payload.auto_report)
        changed.append(f"auto_report={payload.auto_report}")
    if payload.notify_founder is not None:
        updates["notify_founder"] = bool(payload.notify_founder)
        changed.append(f"notify_founder={payload.notify_founder}")
    if payload.scan is not None:
        cur = (await _get_settings())["scan"]
        freq = payload.scan.get("frequency", cur["frequency"])
        if freq not in FREQUENCIES:
            raise HTTPException(status_code=400, detail=f"frequency must be one of {FREQUENCIES}")
        custom = {**cur["custom"], **(payload.scan.get("custom") or {})}
        try:
            custom = {k: max(0, int(custom.get(k) or 0)) for k in ("days", "hours", "minutes")}
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="custom days/hours/minutes must be integers")
        updates["scan"] = {"enabled": bool(payload.scan.get("enabled", cur["enabled"])),
                           "frequency": freq, "custom": custom}
        changed.append(f"scan={freq}")
    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")
    await db.orion_settings.update_one({"key": "singleton"}, {"$set": updates}, upsert=True)
    await _log_action(current, "settings_change", "ORAi settings updated: " + ", ".join(changed))
    return await _get_settings()


# ─── Scan engine — heuristic, read-only, no AI calls ──────────────────

def _day_bounds(dt: datetime):
    d = dt.strftime("%Y-%m-%d")
    return d + "T00:00:00+00:00", d + "T23:59:59+00:00"


async def _scan_metrics() -> dict:
    now = datetime.now(timezone.utc)
    t0, _ = _day_bounds(now)
    y0, y1 = _day_bounds(now - timedelta(days=1))
    return {
        "users_total": await db.users.count_documents({}),
        "users_today": await db.users.count_documents({"created_at": {"$gte": t0}}),
        "users_yesterday": await db.users.count_documents({"created_at": {"$gte": y0, "$lte": y1}}),
        "posts_today": await db.posts.count_documents({"created_at": {"$gte": t0}}),
        "posts_yesterday": await db.posts.count_documents({"created_at": {"$gte": y0, "$lte": y1}}),
        "queries_today": await db.orion_admin_query_logs.count_documents({"timestamp": {"$gte": t0}}),
        "queries_failed_today": await db.orion_admin_query_logs.count_documents(
            {"timestamp": {"$gte": t0}, "success": False}),
        "drafts_pending": await db.orion_action_logs.count_documents({"approval_status": "pending"}),
        "open_reports": await db.reports.count_documents({"status": "open"}),
        "notifications_today": await db.notifications.count_documents({"created_at": {"$gte": t0}}),
    }


# Heuristic recommendation rules: (key, condition, builder)
def _build_recommendations(m: dict) -> list[dict]:
    recs = []
    if m["drafts_pending"] > 5:
        recs.append({"key": "drafts_backlog", "title": f"Review {m['drafts_pending']} pending ORAi drafts",
                     "priority": "high" if m["drafts_pending"] > 15 else "medium",
                     "confidence": 90, "impact": "medium", "effort": "low", "risk": "low",
                     "detail": "Pending drafts block founder decisions from shipping."})
    if m["open_reports"] > 0:
        recs.append({"key": "open_reports", "title": f"Resolve {m['open_reports']} open moderation reports",
                     "priority": "high" if m["open_reports"] > 10 else "medium",
                     "confidence": 95, "impact": "high", "effort": "medium", "risk": "medium",
                     "detail": "Open reports affect community safety response time."})
    if m["queries_failed_today"] > 0:
        recs.append({"key": "failed_queries", "title": f"Investigate {m['queries_failed_today']} failed ORAi queries today",
                     "priority": "high" if m["queries_failed_today"] > 5 else "medium",
                     "confidence": 85, "impact": "medium", "effort": "medium", "risk": "low",
                     "detail": "Query failures may indicate missing tools or upstream issues."})
    if m["posts_today"] == 0 and m["users_total"] > 10:
        recs.append({"key": "no_posts_today", "title": "No new posts today — consider an engagement prompt",
                     "priority": "low", "confidence": 70, "impact": "medium", "effort": "low", "risk": "low",
                     "detail": "Zero posts so far today across the platform."})
    return recs


async def _sync_recommendations(m: dict) -> int:
    """Upsert active heuristic recs; auto-resolve cleared ones. Returns # new."""
    now_iso = datetime.now(timezone.utc).isoformat()
    active = _build_recommendations(m)
    active_keys = {r["key"] for r in active}
    created = 0
    for r in active:
        existing = await db.orion_recommendations.find_one({"key": r["key"], "status": "pending"}, {"_id": 0, "id": 1})
        if existing:
            await db.orion_recommendations.update_one(
                {"key": r["key"], "status": "pending"},
                {"$set": {**r, "status": "pending", "updated_at": now_iso}})
        else:
            await db.orion_recommendations.insert_one(
                {"id": str(uuid.uuid4()), **r, "status": "pending",
                 "created_at": now_iso, "updated_at": now_iso})
            created += 1
    await db.orion_recommendations.update_many(
        {"status": "pending", "key": {"$nin": list(active_keys)}},
        {"$set": {"status": "resolved", "updated_at": now_iso}})
    return created


def _pct(cur: int, prev: int):
    if prev < 5:
        return None
    return round((cur - prev) / prev * 100)


def _build_insights(m: dict) -> list[str]:
    checks = [
        ("Signups", m["users_today"], m["users_yesterday"]),
        ("Posting activity", m["posts_today"], m["posts_yesterday"]),
    ]
    out = []
    for label, cur, prev in checks:
        p = _pct(cur, prev)
        if p is not None and abs(p) >= 20:
            out.append(f"{label} {'increased' if p > 0 else 'decreased'} {abs(p)}% vs yesterday.")
    if m["queries_failed_today"] > 0:
        out.append(f"{m['queries_failed_today']} ORAi queries failed today.")
    if m["open_reports"] > 0:
        out.append(f"{m['open_reports']} moderation reports are awaiting review.")
    if m["drafts_pending"] > 5:
        out.append(f"{m['drafts_pending']} ORAi drafts are waiting for approval.")
    if not out:
        out = ["No significant changes detected."]
    return out[:5]


def _build_report(m: dict, prev: Optional[dict], top_rec: Optional[dict]) -> dict:
    now_iso = datetime.now(timezone.utc).isoformat()
    if m["users_total"] < 5 and m["posts_today"] == 0 and m["queries_today"] == 0:
        return {"at": now_iso, "summary": "Not enough activity yet.", "findings": [],
                "warnings": [], "top_recommendation": None,
                "largest_positive": None, "largest_negative": None}
    findings = [
        f"{m['users_total']} total members ({m['users_today']} joined today)",
        f"{m['posts_today']} posts created today",
        f"{m['queries_today']} ORAi queries today ({m['queries_failed_today']} failed)",
        f"{m['drafts_pending']} drafts pending approval",
        f"{m['open_reports']} open moderation reports",
    ][:5]
    deltas = []
    if prev:
        for label, key in (("New signups", "users_today"), ("Posts", "posts_today"),
                           ("ORAi queries", "queries_today")):
            deltas.append((label, m.get(key, 0) - prev.get(key, 0)))
    largest_pos = max([d for d in deltas if d[1] > 0], key=lambda x: x[1], default=None)
    largest_neg = min([d for d in deltas if d[1] < 0], key=lambda x: x[1], default=None)
    warnings = []
    if m["queries_failed_today"] > 0:
        warnings.append(f"{m['queries_failed_today']} failed ORAi queries today.")
    if m["open_reports"] > 10:
        warnings.append(f"Moderation backlog: {m['open_reports']} open reports.")
    if m["drafts_pending"] > 15:
        warnings.append(f"Draft backlog: {m['drafts_pending']} pending.")
    return {
        "at": now_iso,
        "summary": f"Scan complete — {len(findings)} findings, {len(warnings)} warnings.",
        "findings": findings,
        "warnings": warnings,
        "top_recommendation": ({"title": top_rec["title"], "priority": top_rec["priority"],
                                "confidence": top_rec["confidence"]} if top_rec else None),
        "largest_positive": ({"label": largest_pos[0], "delta": largest_pos[1]} if largest_pos else None),
        "largest_negative": ({"label": largest_neg[0], "delta": largest_neg[1]} if largest_neg else None),
    }


_PRIO_ORDER = {"high": 0, "medium": 1, "low": 2}


async def _execute_scan(trigger: str, username: str = "stealth") -> dict:
    """Full scan pipeline. Caller must hold (or try) _scan_lock."""
    actor = {"username": username}
    await _log_action(actor, "scan_started", f"Scan started ({trigger})")
    settings = await _get_settings()
    m = await _scan_metrics()
    created = await _sync_recommendations(m)
    if created:
        await _log_action(actor, "recommendation_created", f"{created} new recommendation(s) from scan")
    top_rec = None
    pending = await db.orion_recommendations.find({"status": "pending"}, {"_id": 0}).to_list(50)
    top_rec = min(pending, key=lambda r: (_PRIO_ORDER.get(r.get("priority"), 3), -(r.get("confidence") or 0))) if pending else None
    now = datetime.now(timezone.utc)
    prev_result = (settings.get("last_scan") or {}).get("result")
    last_scan = {"at": now.isoformat(), "result": m, "trigger": trigger}
    updates = {"last_scan": last_scan}
    if settings.get("last_scan"):
        updates["prev_scan"] = settings["last_scan"]
    report = None
    if settings.get("auto_report", True):
        report = _build_report(m, prev_result, top_rec)
        updates["last_report"] = report
    await db.orion_settings.update_one({"key": "singleton"}, {"$set": updates}, upsert=True)
    await _log_action(actor, "scan_completed",
                      f"Scan completed ({trigger}): {m['users_total']} users, "
                      f"{m['posts_today']} posts today, {m['drafts_pending']} drafts pending")
    if settings.get("notify_founder"):
        try:
            from routers.notifications import emit_notification
            founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
            if founder:
                await emit_notification(founder["id"], "moderation", payload={
                    "preview": f"ORAi scan complete — {m['drafts_pending']} drafts pending, "
                               f"{m['open_reports']} open reports."})
        except Exception:  # noqa: BLE001
            pass
    return {"ok": True, "last_scan": last_scan, "report": report}


def _scan_interval_seconds(scan: dict) -> Optional[int]:
    f = scan.get("frequency")
    if f == "hourly":
        return 3600
    if f == "daily":
        return 86400
    if f == "weekly":
        return 604800
    if f == "custom":
        c = scan.get("custom") or {}
        secs = int(c.get("days") or 0) * 86400 + int(c.get("hours") or 0) * 3600 + int(c.get("minutes") or 0) * 60
        return max(secs, 60) if secs > 0 else None
    return None  # manual


def _next_scan_at(settings: dict) -> Optional[str]:
    scan = settings.get("scan") or {}
    if not scan.get("enabled") or not settings.get("enabled"):
        return None
    interval = _scan_interval_seconds(scan)
    if not interval:
        return None
    last = (settings.get("last_scan") or {}).get("at")
    base = datetime.fromisoformat(last) if last else datetime.now(timezone.utc)
    return (base + timedelta(seconds=interval)).isoformat()


async def scheduler_loop():
    """Background scheduler — checks every 60s whether a scan is due.
    Skips (never queues) when a scan is already running."""
    await asyncio.sleep(20)  # let the app settle after startup
    while True:
        try:
            settings = await _get_settings()
            nxt = _next_scan_at(settings)
            if nxt and datetime.fromisoformat(nxt) <= datetime.now(timezone.utc):
                if _scan_lock.locked():
                    pass  # overlap guard: skip this tick
                else:
                    async with _scan_lock:
                        await _execute_scan("scheduled")
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(60)


@router.post("/scan")
async def run_scan(current: CurrentUser):
    """Manual scan — same pipeline the scheduler uses."""
    _require_founder(current)
    if _scan_lock.locked():
        raise HTTPException(status_code=409, detail="A scan is already running.")
    async with _scan_lock:
        return await _execute_scan("manual", current.get("username") or "stealth")


def _health_score(settings: dict, m: Optional[dict], a_pending: int, recs_high: int) -> dict:
    score = 100
    if not settings.get("enabled"):
        score -= 25
    if m:
        score -= min(30, (m.get("queries_failed_today") or 0) * 6)
        score -= min(20, (m.get("open_reports") or 0) * 2)
    score -= min(15, max(0, a_pending - 5))
    score -= min(20, recs_high * 8)
    last = (settings.get("last_scan") or {}).get("at")
    if not last:
        score -= 10
    score = max(0, min(100, score))
    label = ("Excellent" if score >= 85 else "Good" if score >= 65
             else "Warning" if score >= 40 else "Critical")
    return {"score": score, "label": label}


@router.get("/overview")
async def overview(current: CurrentUser):
    _require_founder(current)
    settings = await _get_settings()
    now = datetime.now(timezone.utc)
    today0 = now.strftime("%Y-%m-%d") + "T00:00:00+00:00"
    q_today = await db.orion_admin_query_logs.count_documents({"timestamp": {"$gte": today0}})
    a_pending = await db.orion_action_logs.count_documents({"approval_status": "pending"})
    recs_pending = await db.orion_recommendations.count_documents({"status": "pending"})
    recs_high = await db.orion_recommendations.count_documents({"status": "pending", "priority": "high"})
    series = []
    for i in range(6, -1, -1):
        day = now - timedelta(days=i)
        d0, d1 = _day_bounds(day)
        c = await db.orion_admin_query_logs.count_documents({"timestamp": {"$gte": d0, "$lte": d1}})
        series.append({"date": day.strftime("%m-%d"), "count": c})
    last_metrics = (settings.get("last_scan") or {}).get("result")
    return {
        "status": "active" if settings["enabled"] else "paused",
        "power_level": settings["power_level"],
        "last_scan": settings.get("last_scan"),
        "next_scan": _next_scan_at(settings),
        "recommendations": recs_pending,
        "requests_today": q_today,
        "active_tasks": a_pending,
        "cost_today": None,
        "series": series,
        "health": _health_score(settings, last_metrics, a_pending, recs_high),
        "insights": _build_insights(last_metrics) if last_metrics else ["Run a scan to generate insights."],
        "report": settings.get("last_report"),
    }


@router.get("/providers")
async def list_providers(current: CurrentUser):
    _require_founder(current)
    settings = await _get_settings()
    overrides = settings.get("providers") or {}
    out = []
    for p in PROVIDERS:
        configured = bool(os.environ.get(p["env"]))
        ov = overrides.get(p["id"]) or {}
        enabled = bool(ov.get("enabled", True))
        out.append({
            "id": p["id"], "name": p["name"], "models": p["models"], "env": p["env"],
            "configured": configured, "enabled": enabled,
            "status": ("connected" if configured and enabled
                       else "disabled" if configured else "not_configured"),
            "last_success_at": ov.get("last_success_at"),
            "last_fail_at": ov.get("last_fail_at"),
        })
    return {"providers": out}


class ProviderToggle(BaseModel):
    enabled: bool


@router.post("/providers/{pid}/toggle")
async def toggle_provider(pid: str, payload: ProviderToggle, current: CurrentUser):
    _require_founder(current)
    if pid not in {p["id"] for p in PROVIDERS}:
        raise HTTPException(status_code=404, detail="Unknown provider")
    await db.orion_settings.update_one(
        {"key": "singleton"},
        {"$set": {f"providers.{pid}.enabled": bool(payload.enabled)}}, upsert=True)
    await _log_action(current, "settings_change",
                      f"Provider {pid} {'enabled' if payload.enabled else 'disabled'}")
    return {"ok": True, "id": pid, "enabled": bool(payload.enabled)}


@router.post("/providers/{pid}/test")
async def test_provider(pid: str, current: CurrentUser):
    _require_founder(current)
    p = next((x for x in PROVIDERS if x["id"] == pid), None)
    if not p:
        raise HTTPException(status_code=404, detail="Unknown provider")
    configured = bool(os.environ.get(p["env"]))
    now_iso = datetime.now(timezone.utc).isoformat()
    field = "last_success_at" if configured else "last_fail_at"
    await db.orion_settings.update_one(
        {"key": "singleton"},
        {"$set": {f"providers.{pid}.{field}": now_iso}}, upsert=True)
    await _log_action(current, "provider_tested",
                      f"Provider {p['name']} test {'passed' if configured else 'failed'}")
    return {"ok": configured,
            "detail": (f"{p['name']} key present ({p['env']})" if configured
                       else f"No {p['env']} configured in the backend environment."),
            field: now_iso}


@router.post("/voice/transcribe")
async def voice_transcribe(current: CurrentUser, audio: UploadFile = File(...)):
    """Whisper (whisper-1) transcription for the ORAi voice input.
    Uses the Emergent LLM key; every use is written to the audit log."""
    _require_founder(current)
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio upload.")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio too large (25 MB max).")
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Transcription key not configured.")
    import io
    from emergentintegrations.llm.openai import OpenAISpeechToText
    buf = io.BytesIO(data)
    buf.name = audio.filename or "voice.webm"
    try:
        stt = OpenAISpeechToText(api_key=key)
        resp = await stt.transcribe(file=buf, model="whisper-1", response_format="json")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Transcription failed: {str(e)[:120]}")
    text = (getattr(resp, "text", "") or "").strip()
    await _log_action(current, "voice_transcribed",
                      f"Voice input transcribed ({len(text)} chars): {text[:80]}")
    return {"text": text}


@router.get("/recommendations")
async def list_recommendations(current: CurrentUser, limit: int = 25):
    _require_founder(current)
    cursor = db.orion_recommendations.find({}, {"_id": 0}).sort("created_at", -1).limit(min(limit, 100))
    rows = await cursor.to_list(min(limit, 100))
    return {"total": await db.orion_recommendations.count_documents({}), "rows": rows}
