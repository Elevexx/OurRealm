"""Responsibility Center — Bundle F endpoints: reports, exports, saved
views, digest preview, birthday auto-events, admin analytics."""
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser
from routers.rc_admin import require_rc_perm
from services import rc_exports, rc_reports, rc_calendar
from services.rc_units import _ctx

router = APIRouter(prefix="/api/responsibility-center", tags=["responsibility-center-reports"])
admin_router = APIRouter(prefix="/api/admin/responsibility-center", tags=["responsibility-center-admin-reports"])


def _iso():
    return datetime.now(timezone.utc).isoformat()


@router.get("/digest/preview")
async def digest_preview(current: CurrentUser):
    return await rc_calendar.digest_preview(current)


@router.get("/{center_id}/reports")
async def reports_catalog(center_id: str, current: CurrentUser):
    return await rc_reports.report_catalog(current, center_id)


class ReportQuery(BaseModel):
    filters: dict = {}


@router.post("/{center_id}/reports/{report_key}")
async def report_data(center_id: str, report_key: str, body: ReportQuery, current: CurrentUser):
    return await rc_reports.run_report(current, center_id, report_key, body.filters)


class ExportBody(BaseModel):
    report_key: str
    format: str = "csv"
    filters: dict = {}
    client_token: Optional[str] = None


@router.post("/{center_id}/reports-export")
async def report_export(center_id: str, body: ExportBody, current: CurrentUser):
    return await rc_exports.create_run(current, center_id, body.model_dump())


@router.get("/{center_id}/report-runs")
async def report_runs(center_id: str, current: CurrentUser):
    return await rc_exports.list_runs(current, center_id)


@router.get("/{center_id}/report-runs/{run_id}/download")
async def report_download(center_id: str, run_id: str, current: CurrentUser):
    data, mime, filename = await rc_exports.get_download(current, center_id, run_id)
    return Response(content=bytes(data), media_type=mime,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/{center_id}/report-runs/{run_id}/retry")
async def report_retry(center_id: str, run_id: str, current: CurrentUser):
    return await rc_exports.retry_run(current, center_id, run_id)


# ── Saved report views ───────────────────────────────────────────────────
class SavedViewBody(BaseModel):
    report_key: str
    name: str
    filters: dict = {}
    client_token: Optional[str] = None


@router.get("/{center_id}/saved-report-views")
async def saved_views_list(center_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_reports", write=False)
    views = await db.responsibility_center_saved_report_views.find(
        {"center_id": center_id, "owner_id": current["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"views": views}


@router.post("/{center_id}/saved-report-views")
async def saved_views_create(center_id: str, body: SavedViewBody, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_reports", write=False)
    if body.report_key not in rc_reports.REPORTS:
        raise HTTPException(status_code=404, detail="Unknown report")
    if body.client_token:
        existing = await db.responsibility_center_saved_report_views.find_one(
            {"center_id": center_id, "owner_id": current["id"], "client_token": body.client_token}, {"_id": 0})
        if existing:
            return {"view": existing, "duplicate": True}
    view = {"id": uuid.uuid4().hex, "center_id": center_id, "owner_id": current["id"],
            "report_key": body.report_key, "name": (body.name or "Saved view").strip()[:60],
            "filters": rc_reports.parse_filters(body.filters),
            "client_token": body.client_token,
            "created_at": _iso(), "updated_at": _iso()}
    await db.responsibility_center_saved_report_views.insert_one({**view})
    return {"view": view}


@router.delete("/{center_id}/saved-report-views/{view_id}")
async def saved_views_delete(center_id: str, view_id: str, current: CurrentUser):
    await _ctx(center_id, current, "view_reports", write=False)
    r = await db.responsibility_center_saved_report_views.delete_one(
        {"id": view_id, "center_id": center_id, "owner_id": current["id"]})
    if r.deleted_count != 1:
        raise HTTPException(status_code=404, detail="Saved view not found")
    return {"ok": True}


# ── Birthday auto-events ─────────────────────────────────────────────────
@router.get("/{center_id}/birthday-settings")
async def birthday_get(center_id: str, current: CurrentUser):
    return await rc_exports.get_birthday_settings(current, center_id)


@router.patch("/{center_id}/birthday-settings")
async def birthday_patch(center_id: str, body: dict, current: CurrentUser):
    return await rc_exports.update_birthday_settings(current, center_id, body or {})


class ConsentBody(BaseModel):
    consented: bool
    birth_month: Optional[int] = None
    birth_day: Optional[int] = None
    birth_year: Optional[int] = None


@router.post("/{center_id}/birthday-consent")
async def birthday_consent(center_id: str, body: ConsentBody, current: CurrentUser):
    return await rc_exports.set_birthday_consent(current, center_id, body.model_dump())


# ── Admin platform analytics ─────────────────────────────────────────────
@admin_router.get("/reports/overview")
async def admin_reports(current: CurrentUser, date_from: str = "", date_to: str = ""):
    require_rc_perm(current, "responsibility_center.view")
    now = datetime.now(timezone.utc)
    f = rc_reports.parse_filters({"date_from": date_from or (now - timedelta(days=30)).isoformat(),
                                  "date_to": date_to or now.isoformat()})
    data = await rc_reports.admin_reports_overview(f["date_from"], f["date_to"])
    return {"range": {"date_from": f["date_from"], "date_to": f["date_to"]}, **data}
