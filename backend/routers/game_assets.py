"""Universal Game Asset Studio routes (founder-only)."""
import base64
import re
import uuid

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import game_assets as ga

router = APIRouter(prefix="/api/admin/games", tags=["game-assets"])
public_router = APIRouter(prefix="/api/public/game-assets", tags=["game-assets"])


@public_router.get("/{name}")
async def serve_game_asset(name: str):
    """Public read-only serving for GAME ART only — assets consumed by the
    sandboxed game runtime iframe (which cannot send credentials). The
    filename must belong to a registered game_asset library record; all
    other media stays behind the global auth guard."""
    if not name or "/" in name or "\\" in name or ".." in name or "\x00" in name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    a = await db.orai_assets.find_one({"type": "game_asset", "file_name": name}, {"id": 1})
    if not a:
        raise HTTPException(status_code=404, detail="Not found")
    from fastapi.responses import FileResponse, RedirectResponse
    from services.storage_adapter import get_storage_adapter, S3CompatibleAdapter, _canonical_mime_for
    from services.storage import media_dir
    adapter = get_storage_adapter()
    if isinstance(adapter, S3CompatibleAdapter):
        try:
            signed = adapter.presigned_get("images", name, ttl=3600,
                                           content_type=_canonical_mime_for(name))
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=502, detail="Storage backend unreachable") from e
        resp = RedirectResponse(url=signed, status_code=307)
        resp.headers["Cache-Control"] = "public, max-age=3000"
        return resp
    local = media_dir("images") / name
    if not local.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(local, media_type=_canonical_mime_for(name),
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})


async def _game(gid: str):
    g = await db.games.find_one({"id": gid})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    return g


@router.get("/assets/library")
async def asset_library(current: CurrentUser, q: str = "", kind: str = "", runtime: str = "", page: int = 1):
    require_founder(current)
    flt = {"type": "game_asset", "archived": {"$ne": True}}
    if kind.strip():
        flt["subtype"] = kind.strip()
    if runtime.strip():
        flt["tags"] = runtime.strip()
    if q.strip():
        words = [re.escape(w) for w in q.strip().split()[:4] if len(w) > 1]
        if words:
            rx = {"$regex": "|".join(words), "$options": "i"}
            flt["$or"] = [{"title": rx}, {"prompt": rx}, {"tags": rx}]
    page = max(1, page)
    total = await db.orai_assets.count_documents(flt)
    rows = await db.orai_assets.find(flt, {"_id": 0}).sort("created_at", -1) \
        .skip((page - 1) * 24).to_list(24)
    return {"assets": rows, "total": total, "page": page}


@router.get("/assets/jobs/{job_id}")
async def job_status(job_id: str, current: CurrentUser):
    require_founder(current)
    j = await db.game_asset_jobs.find_one({"id": job_id}, {"_id": 0})
    if not j:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job": j}


@router.post("/assets/jobs/{job_id}/cancel")
async def job_cancel(job_id: str, current: CurrentUser):
    require_founder(current)
    r = await db.game_asset_jobs.update_one(
        {"id": job_id, "status": {"$in": ["queued", "running"]}},
        {"$set": {"cancel_requested": True}})
    if not r.matched_count:
        raise HTTPException(status_code=400, detail="Job is not running")
    return {"ok": True}


@router.get("/{gid}/assets/manifest")
async def manifest(gid: str, current: CurrentUser):
    require_founder(current)
    g = await _game(gid)
    m = ga.build_manifest(g)
    m["suggestions"] = {s["key"]: ga.suggest_prompt(g, s["key"]) for s in m["slots"]}
    return m


@router.post("/{gid}/assets/estimate")
async def estimate(gid: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await _game(gid)
    slots = [s for s in (body.get("slots") or []) if s in ga.SLOTS]
    if not slots:
        raise HTTPException(status_code=400, detail="Select at least one asset slot")
    return {"estimate": ga.estimate_pack(g, slots, int(body.get("art_quality") or 1))}


@router.post("/{gid}/assets/generate")
async def generate(gid: str, body: dict, current: CurrentUser):
    """Metered generation — requires explicit slots, art_quality and an
    itemized cost_ceiling the founder approved in the UI."""
    require_founder(current)
    g = await _game(gid)
    slots = [s for s in (body.get("slots") or []) if s in ga.SLOTS]
    if not slots or len(slots) > 12:
        raise HTTPException(status_code=400, detail="Select 1-12 asset slots")
    ceiling = float(body.get("cost_ceiling") or 0)
    est = ga.estimate_pack(g, slots, int(body.get("art_quality") or 1))
    if ceiling <= 0:
        raise HTTPException(status_code=400, detail="Approve a cost ceiling first")
    if ceiling < min(i["cost"] for i in est["items"]):
        raise HTTPException(status_code=400, detail="Cost ceiling below the cheapest item")
    job = await ga.create_job(g, slots, int(body.get("art_quality") or 1), ceiling,
                              body.get("prompts") or {}, current,
                              (body.get("idempotency_key") or uuid.uuid4().hex)[:80])
    return {"job": job, "estimate": est}


@router.post("/{gid}/assets/{slot}/upload")
async def upload(gid: str, slot: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await _game(gid)
    if slot not in ga.SLOTS:
        raise HTTPException(status_code=400, detail="Unknown asset slot")
    try:
        raw = base64.b64decode(body.get("b64") or "")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image")
    if not 100 < len(raw) <= 4 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 4 MB")
    from services import image_store
    try:
        rec = await image_store.save_bytes(raw, current["id"], declared_mime=body.get("mime") or "image/png")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    meta = ga._asset_meta(slot, rec.width, rec.height)
    lib = await ga.save_library_record(current, g, slot, rec, meta, "manual upload", "upload")
    v = await ga.set_slot_asset(gid, slot, {"url": ga.public_asset_url(rec.original_url), "meta": meta, "asset_id": lib["id"]},
                                current, source="upload")
    return {"version": v, "manifest": ga.build_manifest(await _game(gid))}


@router.post("/{gid}/assets/{slot}/use-library")
async def use_library(gid: str, slot: str, body: dict, current: CurrentUser):
    require_founder(current)
    await _game(gid)
    if slot not in ga.SLOTS:
        raise HTTPException(status_code=400, detail="Unknown asset slot")
    a = await db.orai_assets.find_one({"id": body.get("asset_id"), "archived": {"$ne": True}})
    if not a or a.get("creator_id") != current["id"]:
        raise HTTPException(status_code=404, detail="Library asset not found or not yours")
    refs = a.get("refs") or {}
    if not refs.get("url"):
        raise HTTPException(status_code=400, detail="Asset has no image reference")
    url = a.get("public_url") or refs["url"]
    meta = refs.get("meta") or ga._asset_meta(slot, 0, 0)
    v = await ga.set_slot_asset(gid, slot, {"url": url, "meta": meta, "asset_id": a["id"]},
                                current, source="library_reuse")
    await db.orai_assets.update_one({"id": a["id"]}, {"$inc": {"usage_count": 1}})
    return {"version": v}


@router.post("/{gid}/assets/{slot}/rollback")
async def rollback(gid: str, slot: str, body: dict, current: CurrentUser):
    require_founder(current)
    await _game(gid)
    try:
        v = await ga.rollback_slot(gid, slot, int(body.get("version_index") or 0), current)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"version": v}


@router.post("/{gid}/polished")
async def set_polished(gid: str, body: dict, current: CurrentUser):
    """Placeholder policy gate: a game may only be marked 'polished' when
    every required asset slot is ready. Blocks otherwise."""
    require_founder(current)
    g = await _game(gid)
    m = ga.build_manifest(g)
    if body.get("enabled") and m["art_status"] != "polished":
        missing = [s["label"] for s in m["slots"] if s["required_for_polished"] and s["status"] != "ready"]
        raise HTTPException(status_code=400,
                            detail=f"Cannot mark polished — missing required assets: {', '.join(missing)}")
    await db.games.update_one({"id": gid}, {"$set": {
        "art_status": "polished" if body.get("enabled") else "placeholder"}})
    return {"ok": True, "art_status": "polished" if body.get("enabled") else "placeholder"}
