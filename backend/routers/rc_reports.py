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


# ── Bundle G — templates ─────────────────────────────────────────────────
from services import rc_templates, rc_widgets, rc_exports as _rcx  # noqa: E402


@router.get("/templates")
async def templates_list(current: CurrentUser):
    return await rc_templates.list_templates()


@router.get("/templates/{template_key}")
async def templates_get(template_key: str, current: CurrentUser):
    return await rc_templates.get_template(template_key)


@router.post("/{center_id}/apply-template")
async def templates_apply(center_id: str, body: dict, current: CurrentUser):
    return await rc_templates.apply_template(current, center_id, body or {})


@router.get("/{center_id}/template-status")
async def templates_status(center_id: str, current: CurrentUser):
    return await rc_templates.template_status(current, center_id)


# ── Bundle G — widgets ───────────────────────────────────────────────────
@router.get("/{center_id}/dashboard-widgets")
async def widgets_dashboard(center_id: str, current: CurrentUser):
    return await rc_widgets.dashboard(current, center_id)


@router.put("/{center_id}/widget-layout")
async def widgets_save(center_id: str, body: dict, current: CurrentUser):
    return await rc_widgets.save_layout(current, center_id, body or {})


@router.delete("/{center_id}/widget-layout")
async def widgets_reset(center_id: str, current: CurrentUser, scope: str = "user"):
    return await rc_widgets.reset_layout(current, center_id, scope)


# ── Bundle G — universal search ──────────────────────────────────────────
@router.get("/search")
async def rc_search_global(q: str, current: CurrentUser):
    return await rc_widgets.search(current, q)


@router.get("/{center_id}/search")
async def rc_search_center(center_id: str, q: str, current: CurrentUser):
    return await rc_widgets.search(current, q, center_id)


# ── Bundle G — scheduled reports (explicit opt-in) ───────────────────────
@router.get("/{center_id}/scheduled-reports")
async def schedules_list(center_id: str, current: CurrentUser):
    return await _rcx.list_schedules(current, center_id)


@router.post("/{center_id}/scheduled-reports")
async def schedules_create(center_id: str, body: dict, current: CurrentUser):
    return await _rcx.create_schedule(current, center_id, body or {})


@router.patch("/{center_id}/scheduled-reports/{schedule_id}")
async def schedules_update(center_id: str, schedule_id: str, body: dict, current: CurrentUser):
    return await _rcx.update_schedule(current, center_id, schedule_id, body or {})


# ── Bundle G — admin: template usage + system health ─────────────────────
@admin_router.get("/templates/usage")
async def admin_templates(current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    return await rc_templates.admin_template_usage()


# ── Bundle G — Admin Template Manager ────────────────────────────────────
@admin_router.get("/templates/manage")
async def admin_tpl_list(current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    return await rc_templates.admin_manage_list()


@admin_router.post("/templates/manage")
async def admin_tpl_create(body: dict, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_settings")
    return await rc_templates.admin_create_template(current, body or {})


@admin_router.get("/templates/manage/{template_key}")
async def admin_tpl_get(template_key: str, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    return await rc_templates.admin_manage_get(template_key)


@admin_router.patch("/templates/manage/{template_key}")
async def admin_tpl_update(template_key: str, body: dict, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_settings")
    return await rc_templates.admin_update_template(current, template_key, body or {})


@admin_router.post("/templates/manage/{template_key}/status")
async def admin_tpl_status(template_key: str, body: dict, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_settings")
    return await rc_templates.admin_template_status(current, template_key, body or {})


@admin_router.post("/templates/manage/{template_key}/duplicate")
async def admin_tpl_duplicate(template_key: str, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_settings")
    return await rc_templates.admin_duplicate_template(current, template_key)


@admin_router.get("/system-health")
async def admin_system_health(current: CurrentUser):
    require_rc_perm(current, "responsibility_center.view")
    hb = await db.rc_scheduler_heartbeat.find_one({"id": "main"}, {"_id": 0}) or {}
    queued = await db.responsibility_center_report_runs.count_documents({"status": "queued"})
    processing = await db.responsibility_center_report_runs.count_documents({"status": "processing"})
    failed = await db.responsibility_center_report_runs.count_documents({"status": "failed"})
    schedules = await db.responsibility_center_scheduled_reports.count_documents({"enabled": True})
    return {"scheduler_heartbeat": hb, "export_queue_depth": queued,
            "exports_processing": processing, "exports_failed": failed,
            "active_report_schedules": schedules,
            "template_registry": {"templates": len(rc_templates.TEMPLATES),
                                  "version": rc_templates.TEMPLATE_VERSION}}


# ── Legal & Compliance (global review) ───────────────────────────────────
@router.get("/compliance")
async def compliance_public(current: CurrentUser):
    return await _rcx.get_compliance_settings()


@admin_router.get("/compliance")
async def compliance_admin_get(current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_settings")
    return await _rcx.get_compliance_settings()


@admin_router.patch("/compliance")
async def compliance_admin_patch(body: dict, current: CurrentUser):
    require_rc_perm(current, "responsibility_center.manage_settings")
    return await _rcx.update_compliance_settings(body or {})
