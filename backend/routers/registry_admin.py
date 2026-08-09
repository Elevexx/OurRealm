"""Phase 2 — Admin Control Center API for the versioned registries.
All routes founder-only. Long work (contract tests, migration, sandbox
demos) runs through the persistent Cloudflare-safe job engine."""
import uuid

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import engine_registry as reg
from services import job_engine as _je

router = APIRouter(prefix="/api/admin/gamemaker/registry", tags=["gamemaker-registry"])


def _err(e: Exception):
    raise HTTPException(status_code=400, detail=str(e)[:300])


# ─── Persistent job handlers (mocked — no paid providers) ────────────────

@_je.register("gm_contract_test")
async def _run_contract_test(job: dict) -> dict:
    p = job["payload"]
    await _je.phase(job["id"], "running_checks", 40, f"Contract tests — {p['key']} v{p['version']}")
    result = await reg.run_contract_checks(p["key"], int(p["version"]))
    await _je.phase(job["id"], "saving", 90)
    await db.gm_registry_versions.update_one(
        {"family": "runtime", "key": p["key"], "version": int(p["version"])},
        {"$set": {"last_contract_test": {**result, "job_id": job["id"]}}})
    return result


@_je.register("gm_registry_migration")
async def _run_migration(job: dict) -> dict:
    p = job["payload"]
    await _je.phase(job["id"], "pinning", 40, "Applying insert-only game pins")
    return await reg.apply_pins(p["run_id"], job.get("username") or job["user_id"])


@_je.register("gm_sandbox_demo")
async def _run_sandbox_demo(job: dict) -> dict:
    """Sandbox demo = clone of a REAL working game spec for this runtime
    version, saved as an unpublished founder draft. No providers, truthful."""
    from datetime import datetime, timezone
    p = job["payload"]
    key, version = p["key"], int(p["version"])
    await _je.phase(job["id"], "cloning_spec", 40, "Cloning reference game spec")
    q = ({"spec.runtime_id": "runtime_dragon_realm_rpg_v1"} if key == "dragon_realm_rpg"
         else {"spec.runtime": key})
    src = await db.games.find_one({**q, "status": {"$in": ["published", "approved"]}}, {"_id": 0})
    if not src:
        raise RuntimeError(f"No working reference game exists for '{key}' yet — "
                           "sandbox demos clone real specs and never fabricate one.")
    now = datetime.now(timezone.utc).isoformat()
    gid = uuid.uuid4().hex
    await _je.phase(job["id"], "saving", 80)
    await db.games.insert_one({
        "id": gid, "title": f"[SANDBOX] {src.get('title')} — {key} v{version}",
        "status": "approved", "spec": src.get("spec"), "genre": src.get("genre"),
        "cover_url": src.get("cover_url"), "creator_id": job["user_id"],
        "creator_username": job.get("username"),
        "sandbox": True, "registry_demo": {"runtime_key": key, "runtime_version": version,
                                           "source_game_id": src.get("id"), "job_id": job["id"]},
        "created_at": now, "updated_at": now})
    await reg.pin_game(gid, job.get("username") or "system", source="sandbox_demo")
    return {"game_id": gid, "title": f"[SANDBOX] {src.get('title')}",
            "cloned_from": src.get("id"), "note": "Unpublished founder draft — play it from Saved Games"}


# ─── Inventory & migration ────────────────────────────────────────────────

@router.get("/inventory")
async def inventory(current: CurrentUser):
    require_founder(current)
    return await reg.inventory()


@router.get("/migration/preview")
async def migration_preview(current: CurrentUser):
    require_founder(current)
    return await reg.migration_preview()


@router.post("/migration/apply")
async def migration_apply(body: dict, current: CurrentUser):
    require_founder(current)
    run_id = str(body.get("run_id") or uuid.uuid4().hex)
    job = await _je.submit("gm_registry_migration", current, {"run_id": run_id},
                           idem_key=f"regmig-{run_id}")
    return {"job_id": job["id"], "run_id": run_id}


@router.post("/migration/rollback")
async def migration_rollback(body: dict, current: CurrentUser):
    require_founder(current)
    run_id = str(body.get("run_id") or "")
    if not run_id:
        raise HTTPException(status_code=400, detail="run_id required")
    return await reg.rollback_pins(run_id, current["username"])


# ─── Registry reads ───────────────────────────────────────────────────────

@router.get("/overview")
async def overview(current: CurrentUser):
    require_founder(current)
    return await reg.overview()


@router.get("/{family}/{key}")
async def item_versions(family: str, key: str, current: CurrentUser):
    require_founder(current)
    if family not in reg.FAMILIES:
        raise HTTPException(status_code=400, detail="Unknown family")
    try:
        return await reg.get_versions(family, key)
    except ValueError as e:
        _err(e)


@router.get("/{family}/{key}/compare")
async def compare(family: str, key: str, current: CurrentUser, v_from: int, v_to: int):
    require_founder(current)
    try:
        return await reg.compat_report(family, key, v_from, v_to)
    except ValueError as e:
        _err(e)


@router.get("/runtime/{key}/versions/{version}/games")
async def pinned_games(key: str, version: int, current: CurrentUser):
    require_founder(current)
    return {"games": await reg.games_for_version(key, version)}


# ─── Registry writes ──────────────────────────────────────────────────────

@router.post("/{family}")
async def create_item(family: str, body: dict, current: CurrentUser):
    require_founder(current)
    if family not in reg.FAMILIES:
        raise HTTPException(status_code=400, detail="Unknown family")
    try:
        item = await reg.create_item(family, str(body.get("key") or ""), str(body.get("name") or ""),
                                     current["username"], engine_key=str(body.get("engine_key") or ""),
                                     description=str(body.get("description") or ""),
                                     clone_from=body.get("clone_from"))
        return {"item": item}
    except ValueError as e:
        _err(e)


@router.post("/{family}/{key}/versions")
async def new_version(family: str, key: str, body: dict, current: CurrentUser):
    require_founder(current)
    try:
        v = await reg.create_version(family, key, current["username"],
                                     clone_from_version=body.get("clone_from_version"))
        return {"version": v}
    except ValueError as e:
        _err(e)


@router.patch("/{family}/{key}/versions/{version}")
async def edit_draft(family: str, key: str, version: int, body: dict, current: CurrentUser):
    require_founder(current)
    try:
        return {"definition": await reg.edit_draft(family, key, version, body, current["username"])}
    except ValueError as e:
        _err(e)


@router.post("/{family}/{key}/versions/{version}/promote")
async def promote(family: str, key: str, version: int, body: dict, current: CurrentUser):
    require_founder(current)
    try:
        return await reg.promote(family, key, version, str(body.get("to") or ""), current["username"])
    except ValueError as e:
        _err(e)


@router.post("/{family}/{key}/versions/{version}/disable")
async def disable(family: str, key: str, version: int, current: CurrentUser):
    require_founder(current)
    try:
        return await reg.disable(family, key, version, current["username"])
    except ValueError as e:
        _err(e)


@router.post("/{family}/{key}/rollback")
async def rollback(family: str, key: str, body: dict, current: CurrentUser):
    require_founder(current)
    try:
        return await reg.rollback(family, key, int(body.get("to_version") or 0), current["username"])
    except ValueError as e:
        _err(e)


@router.post("/{family}/{key}/item-disable")
async def item_disable(family: str, key: str, body: dict, current: CurrentUser):
    require_founder(current)
    disabled = bool(body.get("disabled", True))
    r = await db.gm_registry_items.update_one({"family": family, "key": key},
                                              {"$set": {"disabled": disabled}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Not found")
    await reg._audit(family, key, 0, "item_disabled" if disabled else "item_enabled", current["username"])
    return {"key": key, "disabled": disabled}


# ─── Jobs: contract tests + sandbox demos ─────────────────────────────────

@router.post("/runtime/{key}/versions/{version}/contract-test")
async def contract_test(key: str, version: int, body: dict, current: CurrentUser):
    require_founder(current)
    if not await db.gm_registry_versions.find_one({"family": "runtime", "key": key, "version": version}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Version not found")
    job = await _je.submit("gm_contract_test", current, {"key": key, "version": version},
                           idem_key=body.get("request_id"))
    return {"job_id": job["id"]}


@router.post("/runtime/{key}/versions/{version}/sandbox-demo")
async def sandbox_demo(key: str, version: int, body: dict, current: CurrentUser):
    require_founder(current)
    if not await db.gm_registry_versions.find_one({"family": "runtime", "key": key, "version": version}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Version not found")
    job = await _je.submit("gm_sandbox_demo", current, {"key": key, "version": version},
                           idem_key=body.get("request_id"))
    return {"job_id": job["id"]}


@router.get("/audit")
async def audit_log(current: CurrentUser, key: str = "", limit: int = 50):
    require_founder(current)
    q = {"key": key} if key else {}
    rows = await db.gm_registry_audit.find(q, {"_id": 0}).sort("at", -1).to_list(min(limit, 200))
    return {"audit": rows}
