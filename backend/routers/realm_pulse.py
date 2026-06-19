"""Realm Pulse router — founder-only analytics endpoints (Feb 19 2026).

All routes are guarded by `require_founder` so non-@stealth users get a
403 even if they discover the URL. The heartbeat endpoint is the one
exception — any authenticated user can post a heartbeat (their own
activity). Guest sessions cannot heartbeat because we need a user_id
for the DAU dedupe.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import realm_pulse as rp


router = APIRouter(prefix="/api", tags=["realm_pulse"])


# --------------------------------------------------------------------- #
# Heartbeat — public-ish: ANY authenticated user can ping.
# --------------------------------------------------------------------- #
class HeartbeatPayload(BaseModel):
    kind: str = "feed_view"  # arbitrary tag for client-side diagnostics only


@router.post("/analytics/heartbeat")
async def heartbeat(payload: HeartbeatPayload, current: CurrentUser):
    """Mark the caller as active for today (UTC). Idempotent — calling
    multiple times the same day collapses into one DAU credit thanks
    to the unique compound index on (user_id, day)."""
    await rp.record_activity(current["id"])
    return {"ok": True, "day": datetime.now(timezone.utc).strftime("%Y-%m-%d")}


# --------------------------------------------------------------------- #
# Founder-only dashboard endpoints.
# --------------------------------------------------------------------- #
@router.get("/admin/realm-pulse/overview")
async def get_overview(
    current: CurrentUser,
    window: str = Query("7d"),
    start: Optional[str] = None,
    end:   Optional[str] = None,
):
    require_founder(current)
    return await rp.overview(window=window, start=start, end=end)


@router.get("/admin/realm-pulse/investor-snapshot")
async def get_investor_snapshot(
    current: CurrentUser,
    window: str = Query("30d"),
    start: Optional[str] = None,
    end:   Optional[str] = None,
):
    require_founder(current)
    snap = await rp.investor_snapshot(window=window, start=start, end=end)
    # Strip any keys that could leak per-user data even if upstream
    # helpers add them in the future.
    snap.pop("_counts", None)
    return snap


@router.post("/admin/realm-pulse/refresh-snapshot")
async def refresh_snapshot(current: CurrentUser, window: str = Query("7d")):
    """Force-run the hourly aggregation now. Useful right after seeding
    test data or during an investor demo."""
    require_founder(current)
    payload = await rp.write_snapshot(window)
    return {"ok": True, "window": window, "generated_at": payload.get("generated_at")}


@router.get("/admin/realm-pulse/export")
async def export_realm_pulse(
    current: CurrentUser,
    fmt: str = Query("csv", alias="format"),
    window: str = Query("30d"),
    start: Optional[str] = None,
    end:   Optional[str] = None,
):
    """Generate a CSV/PDF/XLSX export with the full overview payload.

    The export pipeline reuses `overview()` so the file content matches
    the dashboard exactly. No PII is included by construction — only
    aggregate counts and ratios."""
    require_founder(current)
    fmt = (fmt or "csv").lower()
    if fmt not in ("csv", "pdf", "xlsx"):
        raise HTTPException(400, "format must be csv | pdf | xlsx")
    payload = await rp.overview(window=window, start=start, end=end)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    if fmt == "csv":
        body = rp.render_csv(payload)
        media = "text/csv"
        filename = f"realm-pulse-{window}-{stamp}.csv"
    elif fmt == "xlsx":
        body = rp.render_xlsx(payload)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"realm-pulse-{window}-{stamp}.xlsx"
    else:
        body = rp.render_pdf(payload)
        media = "application/pdf"
        filename = f"realm-pulse-{window}-{stamp}.pdf"
    return Response(
        content=body,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/admin/realm-pulse/diagnostics")
async def diagnostics(current: CurrentUser):
    """Tiny ops-only endpoint — confirms the heartbeat / snapshot
    pipeline is alive and returns the latest snapshot timestamp."""
    require_founder(current)
    latest = await db.realm_pulse_snapshots.find_one({}, {"_id": 0, "generated_at": 1, "window": 1}, sort=[("generated_at", -1)])
    today_dau = await rp.dau()
    activity_today = await db.user_activity_days.count_documents({"day": datetime.now(timezone.utc).strftime("%Y-%m-%d")})
    return {
        "latest_snapshot": latest or None,
        "dau_now":         today_dau,
        "activity_rows_today": activity_today,
    }
