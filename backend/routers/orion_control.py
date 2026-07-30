"""ORAi Control — founder-only lightweight settings / overview /
providers / scan endpoints for the upgraded /admin/orion dashboard.
Persists ONE singleton doc in `orion_settings`; activity is written to
the EXISTING `orion_action_logs` collection so the audit surfaces and
activity feed reuse the same data. No routing/orchestration logic."""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser

router = APIRouter(prefix="/api/admin/orion", tags=["admin-orion-control"])


def _require_founder(current: dict) -> None:
    if (current.get("username") or "").lower() != "stealth":
        raise HTTPException(status_code=403, detail="Founder-only.")


DEFAULT_SETTINGS = {
    "enabled": True,
    "power_level": 5,
    "notifications": True,
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
    for k in ("enabled", "power_level", "notifications", "providers"):
        if k in doc:
            out[k] = doc[k]
    out["scan"] = {**DEFAULT_SETTINGS["scan"], **(doc.get("scan") or {})}
    out["scan"]["custom"] = {**DEFAULT_SETTINGS["scan"]["custom"],
                             **(out["scan"].get("custom") or {})}
    out["last_scan"] = doc.get("last_scan")
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


@router.post("/scan")
async def run_scan(current: CurrentUser):
    """Lightweight manual platform scan — safe read-only counts only."""
    _require_founder(current)
    now = datetime.now(timezone.utc)
    today0 = now.strftime("%Y-%m-%d") + "T00:00:00+00:00"
    result = {
        "users_total": await db.users.count_documents({}),
        "posts_today": await db.posts.count_documents({"created_at": {"$gte": today0}}),
        "queries_today": await db.orion_admin_query_logs.count_documents({"timestamp": {"$gte": today0}}),
        "drafts_pending": await db.orion_action_logs.count_documents({"approval_status": "pending"}),
    }
    last_scan = {"at": now.isoformat(), "result": result}
    await db.orion_settings.update_one({"key": "singleton"},
                                       {"$set": {"last_scan": last_scan}}, upsert=True)
    await _log_action(current, "scan",
                      f"Manual scan: {result['users_total']} users, "
                      f"{result['posts_today']} posts today, {result['drafts_pending']} drafts pending")
    return {"ok": True, "last_scan": last_scan}


@router.get("/overview")
async def overview(current: CurrentUser):
    _require_founder(current)
    settings = await _get_settings()
    now = datetime.now(timezone.utc)
    today0 = now.strftime("%Y-%m-%d") + "T00:00:00+00:00"
    q_today = await db.orion_admin_query_logs.count_documents({"timestamp": {"$gte": today0}})
    a_pending = await db.orion_action_logs.count_documents({"approval_status": "pending"})
    recs = await db.orion_recommendations.count_documents({})
    series = []
    for i in range(6, -1, -1):
        day = now - timedelta(days=i)
        d0 = day.strftime("%Y-%m-%d") + "T00:00:00+00:00"
        d1 = day.strftime("%Y-%m-%d") + "T23:59:59+00:00"
        c = await db.orion_admin_query_logs.count_documents({"timestamp": {"$gte": d0, "$lte": d1}})
        series.append({"date": day.strftime("%m-%d"), "count": c})
    return {
        "status": "active" if settings["enabled"] else "paused",
        "power_level": settings["power_level"],
        "last_scan": settings.get("last_scan"),
        "recommendations": recs,
        "requests_today": q_today,
        "active_tasks": a_pending,
        "cost_today": None,
        "series": series,
    }


@router.get("/providers")
async def list_providers(current: CurrentUser):
    _require_founder(current)
    settings = await _get_settings()
    overrides = settings.get("providers") or {}
    out = []
    for p in PROVIDERS:
        configured = bool(os.environ.get(p["env"]))
        enabled = bool((overrides.get(p["id"]) or {}).get("enabled", True))
        out.append({
            "id": p["id"], "name": p["name"], "models": p["models"], "env": p["env"],
            "configured": configured, "enabled": enabled,
            "status": ("connected" if configured and enabled
                       else "disabled" if configured else "not_configured"),
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
    return {"ok": configured,
            "detail": (f"{p['name']} key present ({p['env']})" if configured
                       else f"No {p['env']} configured in the backend environment.")}


@router.get("/recommendations")
async def list_recommendations(current: CurrentUser, limit: int = 25):
    _require_founder(current)
    cursor = db.orion_recommendations.find({}, {"_id": 0}).sort("created_at", -1).limit(min(limit, 100))
    rows = await cursor.to_list(min(limit, 100))
    return {"total": await db.orion_recommendations.count_documents({}), "rows": rows}
