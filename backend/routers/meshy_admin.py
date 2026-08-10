"""Founder-only Meshy 3D administration + ORAi/GameMaker task endpoints.
Engagement Resource(s) (ER) note: this panel manages 3D asset generation only;
ER / Fire Power rewards remain server-authoritative elsewhere."""
from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import game_studio as gs
from services import meshy_provider as mp

admin = APIRouter(prefix="/api/admin/meshy", tags=["meshy-admin"])


def _handle(e: Exception):
    if isinstance(e, mp.MeshyError):
        raise HTTPException(status_code=e.status, detail=e.message)
    raise e


@admin.get("/status")
async def meshy_status(current: CurrentUser):
    require_founder(current)
    settings = await db.platform_settings.find_one({"key": "meshy"}, {"_id": 0}) or {}
    agg = await db.meshy_tasks.aggregate([
        {"$group": {"_id": "$status", "n": {"$sum": 1},
                    "credits": {"$sum": {"$ifNull": ["$consumed_credits", 0]}}}}]).to_list(20)
    assets = await db.asset_library.count_documents({"provider": "meshy"})
    return {**mp.configured(),
            "enabled": settings.get("enabled", True),
            "last_health": settings.get("last_health"),
            "task_stats": {a["_id"]: {"count": a["n"], "credits": a["credits"]} for a in agg},
            "stored_assets": assets}


@admin.post("/health-test")
async def meshy_health_test(current: CurrentUser):
    require_founder(current)
    res = await mp.health()
    await db.platform_settings.update_one({"key": "meshy"}, {"$set": {"last_health": res}}, upsert=True)
    await gs.audit(current, "meshy_health_test", "meshy", detail=f"ok={res.get('ok')}")
    return res


@admin.post("/toggle")
async def meshy_toggle(body: dict, current: CurrentUser):
    require_founder(current)
    enabled = bool(body.get("enabled"))
    await db.platform_settings.update_one({"key": "meshy"}, {"$set": {"enabled": enabled}}, upsert=True)
    await gs.audit(current, "meshy_toggle", "meshy", detail=f"enabled={enabled}")
    return {"ok": True, "enabled": enabled}


@admin.get("/tasks")
async def meshy_tasks(current: CurrentUser, limit: int = 50):
    require_founder(current)
    rows = await db.meshy_tasks.find({}, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 200))
    return {"tasks": rows}


@admin.post("/tasks")
async def meshy_create(body: dict, current: CurrentUser):
    require_founder(current)
    settings = await db.platform_settings.find_one({"key": "meshy"}, {"_id": 0}) or {}
    if settings.get("enabled") is False:
        raise HTTPException(status_code=403, detail="Meshy generation is globally disabled")
    if not mp.configured()["configured"]:
        raise HTTPException(status_code=503, detail="MESHY_API_KEY not configured (placeholder present)")
    workflow = str(body.get("workflow") or "")
    payload = body.get("payload") or {}
    idem = str(body.get("idem_key") or "")
    if len(idem) < 8:
        raise HTTPException(status_code=400, detail="idem_key (>=8 chars) required for paid tasks")
    try:
        res = await mp.create_task(db, current, workflow, payload, idem,
                                   context=body.get("context") or {})
    except Exception as e:  # noqa: BLE001
        _handle(e)
    await gs.audit(current, "meshy_task_create", res["task_id"],
                   detail=f"workflow={workflow} replayed={res['replayed']}")
    return res


@admin.get("/tasks/{workflow}/{task_id}")
async def meshy_poll(workflow: str, task_id: str, current: CurrentUser):
    require_founder(current)
    try:
        return await mp.poll_task(db, workflow, task_id)
    except Exception as e:  # noqa: BLE001
        _handle(e)


@admin.delete("/tasks/{workflow}/{task_id}")
async def meshy_cancel(workflow: str, task_id: str, current: CurrentUser):
    require_founder(current)
    try:
        res = await mp.cancel_task(db, workflow, task_id)
    except Exception as e:  # noqa: BLE001
        _handle(e)
    await gs.audit(current, "meshy_task_cancel", task_id, detail=f"workflow={workflow}")
    return res


@admin.post("/tasks/{workflow}/{task_id}/store")
async def meshy_store(workflow: str, task_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    try:
        asset = await mp.store_glb(db, current, workflow, task_id,
                                   name=str(body.get("name") or task_id),
                                   context=body.get("context") or {})
    except Exception as e:  # noqa: BLE001
        _handle(e)
    await gs.audit(current, "meshy_asset_store", asset["id"],
                   detail=f"task={task_id} meshes={asset['meta']['meshes']}")
    return asset


@admin.get("/assets")
async def meshy_assets(current: CurrentUser, limit: int = 50):
    require_founder(current)
    rows = await db.asset_library.find({"provider": "meshy"}, {"_id": 0}).sort(
        "created_at", -1).to_list(min(limit, 200))
    return {"assets": rows}
