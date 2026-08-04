"""ORAi Multi-Tool Project Creator — API routes (founder only)."""
import asyncio
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import orai_projects as op
from utils.sliding_window_rate_limit import rate_limit

router = APIRouter(prefix="/api/orai/projects", tags=["orai-projects"])

VALID_TOOLS = {t["id"] for t in op.TOOLS}
RUNNING_TASKS: dict = {}


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _pub(p: dict) -> dict:
    p = dict(p)
    p.pop("_id", None)
    return p


@router.get("/capabilities")
async def capabilities(current: CurrentUser):
    require_founder(current)
    centers = await db.responsibility_centers.find(
        {"owner_id": current["id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(30)
    if not centers:
        centers = await db.responsibility_centers.find(
            {"members.user_id": current["id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(30)
    from services.game_studio import RUNTIMES, RUNTIME_LABELS
    return {"tools": op.TOOLS, "providers": op.provider_catalog(), "presets": op.PRESETS,
            "ai_power_tiers": {k: v[5] for k, v in op.AI_POWER_TIERS.items()},
            "game_runtimes": [{"id": r, "label": RUNTIME_LABELS[r]} for r in RUNTIMES],
            "voices": ["nova", "atlas", "aurora", "ember", "luna", "orion", "echo", "titan"],
            "course_centers": centers}


def _validate_body(body: dict) -> dict:
    tools = [t for t in (body.get("tools") or []) if t in VALID_TOOLS]
    usable = {p["id"] for p in op.usable_providers()}
    providers = [x for x in (body.get("providers") or []) if x in usable]
    return {"name": str(body.get("name") or "Untitled Project")[:120],
            "prompt": str(body.get("prompt") or "")[:4000],
            "tools": tools, "providers": providers,
            "complexity": min(max(int(body.get("complexity") or 5), 1), 10),
            "ai_power": min(max(int(body.get("ai_power") or 5), 1), 10),
            "settings": body.get("settings") or {},
            "suggestion_used": (body.get("suggestion_used") or "")[:40]}


@router.post("/suggest")
async def suggest(body: dict, current: CurrentUser):
    require_founder(current)
    clean = _validate_body(body)
    # library reuse candidates (search before generating)
    q = (clean["prompt"] or clean["name"]).strip()[:80]
    words = [w for w in q.split()[:4] if len(w) > 2]
    candidates = []
    if words and clean["tools"]:
        rx = {"$regex": "|".join(re.escape(w)[:30] for w in words), "$options": "i"}
        cur = db.orai_assets.find(
            {"type": {"$in": clean["tools"]}, "archived": {"$ne": True},
             "creator_id": current["id"], "$or": [{"title": rx}, {"prompt": rx}]},
            {"_id": 0, "id": 1, "type": 1, "title": 1, "refs": 1, "created_at": 1}
        ).sort("created_at", -1).limit(4)
        candidates = await cur.to_list(4)
    return {"suggestions": op.build_suggestions(clean), "reuse_candidates": candidates}


@router.post("/estimate")
async def estimate(body: dict, current: CurrentUser):
    require_founder(current)
    return {"estimate": op.estimate_project(_validate_body(body))}


@router.get("/sounds/eligible")
async def eligible_sounds(current: CurrentUser, q: str = ""):
    """Existing Sounds the current founder may attach: own tracks + public
    tracks whose owner allowed media reuse. Server-side eligibility only."""
    require_founder(current)
    from services.sound_permissions import can_reuse
    flt = {"deleted_at": {"$exists": False}}
    if q.strip():
        flt["title"] = {"$regex": q.strip()[:60], "$options": "i"}
    rows = await db.tracks.find(flt, {"_id": 0}).sort("created_at", -1).to_list(120)
    out = []
    for tr in rows:
        if tr.get("moderation_status") in ("rejected", "hidden", "removed", "suspended"):
            continue
        mine = tr.get("user_id") == current["id"]
        if not mine:
            if tr.get("visibility") != "public":
                continue
            if not (can_reuse(tr, "video_posts") or can_reuse(tr, "image_posts")):
                continue
        out.append({"id": tr["id"], "title": tr.get("title"), "creator": tr.get("username"),
                    "duration": tr.get("duration_seconds"), "cover_url": tr.get("cover_url"),
                    "file_url": tr.get("file_url"), "own": mine,
                    "eligibility": "owner" if mine else "reuse_allowed"})
        if len(out) >= 40:
            break
    return {"sounds": out}


async def _validate_project(p: dict, current: dict) -> list:
    errs = []
    if not p.get("tools"):
        errs.append("Select at least one tool")
    if not (p.get("prompt") or "").strip():
        errs.append("Project prompt is required")
    usable = {x["id"] for x in op.usable_providers()}
    tool_ok = {"text": {"openai", "gemini", "anthropic"}, "image": {"orai_image_engine"},
               "audio": {"orai_tts"}, "video": {"openai_video"},
               "game": {"game_studio"}, "course": {"course_maker"}}
    for tl in p.get("tools") or []:
        if not (tool_ok[tl] & usable):
            errs.append(f"No connected provider can produce '{tl}' output")
    s = p.get("settings") or {}
    if "video" in (p.get("tools") or []):
        secs = int((s.get("video") or {}).get("seconds") or 8)
        if secs not in (4, 8, 12):
            errs.append("Video duration must be 4, 8 or 12 seconds")
    if "course" in (p.get("tools") or []):
        cid = (s.get("course") or {}).get("center_id")
        if not cid:
            errs.append("Course requires a Responsibility Center")
        elif not await db.responsibility_centers.find_one({"id": cid}):
            errs.append("Selected Responsibility Center not found")
    snd = (s.get("sound") or {})
    if snd.get("mode") == "existing":
        tr = await db.tracks.find_one({"id": snd.get("track_id")})
        from services.sound_permissions import can_reuse
        if not tr:
            errs.append("Selected Sound not found")
        elif tr.get("user_id") != current["id"] and not (
                tr.get("visibility") == "public" and (can_reuse(tr, "video_posts") or can_reuse(tr, "image_posts"))):
            errs.append("Selected Sound is not eligible for reuse")
    n = int((s.get("image") or {}).get("count") or 4)
    if "image" in (p.get("tools") or []) and not 1 <= n <= 12:
        errs.append("Image count must be between 1 and 12")
    return errs


@router.post("/draft")
async def save_draft(body: dict, current: CurrentUser):
    require_founder(current)
    clean = _validate_body(body)
    pid = body.get("id")
    if pid:
        p = await db.orai_projects.find_one({"id": pid, "creator_id": current["id"]})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        if p["status"] in ("generating", "queued"):
            raise HTTPException(status_code=400, detail="Project is generating — cancel first")
        est = op.estimate_project(clean)
        await db.orai_projects.update_one({"id": pid}, {"$set": {
            **clean, "estimate": est, "status": "draft" if p["status"] in ("draft", "estimated") else p["status"],
            "updated_at": _iso()}})
        return {"project": _pub(await db.orai_projects.find_one({"id": pid}))}
    est = op.estimate_project(clean)
    doc = {**clean, "id": uuid.uuid4().hex, "creator_id": current["id"],
           "creator_username": current.get("username"), "status": "draft",
           "estimate": est, "usage": {"items": [], "total": 0.0},
           "stages": [], "outputs": [], "outputs_live": {}, "activity": [],
           "progress_pct": 0, "error": None, "cancel_requested": False,
           "job_id": None, "archived": False,
           "created_at": _iso(), "updated_at": _iso()}
    await db.orai_projects.insert_one({**doc})
    await op.audit(current, "project_draft_created", doc["id"], doc["name"])
    return {"project": doc}


@router.post("/{pid}/validate")
async def validate(pid: str, current: CurrentUser):
    require_founder(current)
    p = await db.orai_projects.find_one({"id": pid, "creator_id": current["id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    errs = await _validate_project(p, current)
    return {"valid": not errs, "errors": errs, "estimate": op.estimate_project(p)}


@router.post("/{pid}/approve")
async def approve(pid: str, body: dict, current: CurrentUser):
    """Explicit approval gate. Idempotent — double-click / retry safe."""
    require_founder(current)
    rl = await rate_limit(f"orai-proj-approve:{current['id']}", max_requests=20, window_seconds=3600)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail="Too many project approvals — try later")
    p = await db.orai_projects.find_one({"id": pid, "creator_id": current["id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    if p["status"] in ("queued", "generating"):
        return {"project": _pub(p), "job_id": p.get("job_id"), "already_running": True}
    if p["status"] not in ("draft", "estimated", "failed", "canceled", "partially_completed"):
        raise HTTPException(status_code=400, detail=f"Cannot start from status '{p['status']}'")
    errs = await _validate_project(p, current)
    if errs:
        raise HTTPException(status_code=400, detail="; ".join(errs)[:400])
    idem = (body.get("idempotency_key") or "")[:80] or uuid.uuid4().hex
    job_id = f"job_{idem}"
    est = op.estimate_project(p)
    retry = p["status"] in ("failed", "canceled", "partially_completed") and p.get("stages")
    stages = p["stages"] if retry else op.stages_for(p)
    if retry:
        stages = [{**s, "status": "waiting", "detail": "", "started_at": None, "finished_at": None}
                  if s["status"] != "complete" else s for s in stages]
    r = await db.orai_projects.find_one_and_update(
        {"id": pid, "status": {"$nin": ["queued", "generating"]}},
        {"$set": {"status": "queued", "job_id": job_id, "estimate_approved": est,
                  "approved_at": _iso(), "stages": stages, "error": None,
                  "cancel_requested": False, "updated_at": _iso()}})
    if not r:
        p2 = await db.orai_projects.find_one({"id": pid})
        return {"project": _pub(p2), "job_id": p2.get("job_id"), "already_running": True}
    await op.audit(current, "project_approved", pid, f"est ${est['total']}")
    task = asyncio.create_task(op.run_generation(pid, dict(current)))
    RUNNING_TASKS[pid] = task
    task.add_done_callback(lambda _t: RUNNING_TASKS.pop(pid, None))
    return {"project": _pub(await db.orai_projects.find_one({"id": pid})), "job_id": job_id}


@router.get("")
async def history(current: CurrentUser, status: str = "", page: int = 1, archived: bool = False):
    require_founder(current)
    flt = {"creator_id": current["id"], "archived": archived}
    if status.strip():
        flt["status"] = status.strip()
    page = max(1, page)
    total = await db.orai_projects.count_documents(flt)
    rows = await db.orai_projects.find(flt, {"_id": 0, "activity": 0, "outputs_live": 0}) \
        .sort("updated_at", -1).skip((page - 1) * 12).to_list(12)
    return {"projects": rows, "total": total, "page": page, "pages": max(1, -(-total // 12))}


@router.get("/library")
async def library(current: CurrentUser, q: str = "", type: str = "", page: int = 1):
    require_founder(current)
    flt = {"creator_id": current["id"], "archived": {"$ne": True}}
    if type.strip():
        flt["type"] = type.strip()
    if q.strip():
        rx = {"$regex": q.strip()[:60], "$options": "i"}
        flt["$or"] = [{"title": rx}, {"prompt": rx}]
    page = max(1, page)
    total = await db.orai_assets.count_documents(flt)
    rows = await db.orai_assets.find(flt, {"_id": 0}).sort("created_at", -1) \
        .skip((page - 1) * 24).to_list(24)
    return {"assets": rows, "total": total, "page": page}


@router.get("/{pid}")
async def detail(pid: str, current: CurrentUser):
    require_founder(current)
    p = await db.orai_projects.find_one({"id": pid, "creator_id": current["id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    out = _pub(p)
    out["stalled"] = bool(p["status"] == "generating" and pid not in RUNNING_TASKS)
    return {"project": out}


@router.post("/{pid}/cancel")
async def cancel(pid: str, current: CurrentUser):
    require_founder(current)
    p = await db.orai_projects.find_one({"id": pid, "creator_id": current["id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    if p["status"] not in ("queued", "generating"):
        raise HTTPException(status_code=400, detail="Project is not running")
    await db.orai_projects.update_one({"id": pid}, {"$set": {"cancel_requested": True, "updated_at": _iso()}})
    if p["status"] == "generating" and pid not in RUNNING_TASKS:
        await db.orai_projects.update_one({"id": pid}, {"$set": {"status": "canceled", "finished_at": _iso()}})
    await op.audit(current, "project_cancel_requested", pid)
    return {"ok": True}


@router.post("/{pid}/retry")
async def retry(pid: str, body: dict, current: CurrentUser):
    require_founder(current)
    p = await db.orai_projects.find_one({"id": pid, "creator_id": current["id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    if p["status"] == "generating" and pid in RUNNING_TASKS:
        raise HTTPException(status_code=400, detail="Project is still running")
    if p["status"] == "generating":  # stalled (e.g. server restart)
        await db.orai_projects.update_one({"id": pid}, {"$set": {"status": "failed", "error": "Interrupted"}})
    await op.audit(current, "project_retried", pid)
    return await approve(pid, {"idempotency_key": uuid.uuid4().hex}, current)


@router.post("/{pid}/repair")
async def repair(pid: str, current: CurrentUser):
    """ZERO-COST reconciliation. Recovers existing outputs (no regeneration):
    - audio: recompute 0:00 durations from the real file; reconnect metadata
    - image: reattach orphaned generated assets to the project outputs
    - video: keep failed stage retryable, report the original error
    Never fabricates success — missing media stays honestly retryable."""
    require_founder(current)
    p = await db.orai_projects.find_one({"id": pid, "creator_id": current["id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    if p["status"] in ("queued", "generating"):
        raise HTTPException(status_code=400, detail="Project is running — repair after it stops")
    report = {"audio": [], "image": [], "video": [], "stages": []}
    outputs = list(p.get("outputs") or [])
    stages = list(p.get("stages") or [])

    def stage(sid):
        return next((s for s in stages if s["id"] == sid), None)

    # ── AUDIO: reconnect / recompute duration ────────────────────────
    from services.audio_store import audio_dir, _extract_duration
    tracks = await db.tracks.find({"source_project_id": pid}).to_list(10)
    for tr in tracks:
        entry = {"track_id": tr["id"], "title": tr.get("title")}
        name = (tr.get("file_url") or "").rsplit("/", 1)[-1]
        ext = name.rsplit(".", 1)[-1] if "." in name else "mp3"
        local = audio_dir() / name
        raw = None
        if local.exists():
            raw = local.read_bytes()
        elif (tr.get("file_url") or "").startswith("http"):
            try:
                import httpx
                async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
                    r = await c.get(tr["file_url"])
                    raw = r.content if r.status_code == 200 else None
            except Exception:  # noqa: BLE001
                raw = None
        if raw:
            if float(tr.get("duration_seconds") or 0) <= 0.01:
                dur = _extract_duration(raw, ext, on_disk_path=local if local.exists() else None)
                if dur > 0:
                    await db.tracks.update_one({"id": tr["id"]}, {"$set": {"duration_seconds": dur}})
                    await db.orai_assets.update_many({"project_id": pid, "type": "audio"},
                                                     {"$set": {"refs.duration": dur}})
                    for o in outputs:
                        if o.get("type") == "audio":
                            o["duration"] = dur
                    entry["repaired"] = f"duration recomputed: {round(dur, 2)}s"
                else:
                    entry["repaired"] = False
                    entry["reason"] = "file exists but duration unreadable (possibly corrupt) — narration stays playable"
            else:
                entry["repaired"] = "already healthy"
        else:
            entry["repaired"] = False
            entry["reason"] = "audio file not reachable — stage marked retryable"
            st = stage("audio")
            if st:
                st["status"] = "failed"
                st["detail"] = "Audio file missing — retry available"
            outputs = [o for o in outputs if o.get("type") != "audio"]
        report["audio"].append(entry)

    # ── IMAGE: reattach orphaned generated assets ────────────────────
    have = {o.get("asset_id") for o in outputs}
    orphans = await db.orai_assets.find({"project_id": pid, "type": "image",
                                         "id": {"$nin": list(have)}}).to_list(30)
    for a in orphans:
        refs = a.get("refs") or {}
        outputs.append({"type": "image", "asset_id": a["id"],
                        "url": refs.get("url"), "thumb": refs.get("thumb")})
        report["image"].append({"asset_id": a["id"], "recovered": True, "url": refs.get("url")})
    img_st = stage("image")
    if img_st and img_st["status"] != "complete":
        n_imgs = sum(1 for o in outputs if o.get("type") == "image")
        report["image"].append({"original_failure": img_st.get("detail") or "unknown"})
        if n_imgs > 0:
            img_st["status"] = "complete"
            img_st["detail"] = f"recovered {n_imgs} existing image(s) — no regeneration"
            report["stages"].append("image: marked complete from recovered assets")

    # ── VIDEO: keep honestly retryable, surface root cause ───────────
    vid_st = stage("video")
    if vid_st and vid_st["status"] != "complete":
        report["video"].append({"original_failure": vid_st.get("detail") or "unknown",
                                "retryable": True,
                                "note": "VideoRecord.file_url bug fixed — Retry will only rerun the video stage"})
        vid_st["status"] = "failed"
        if "file_url" in (vid_st.get("detail") or ""):
            vid_st["detail"] = "Backend bug (VideoRecord.file_url) — fixed; retry will not regenerate other stages"

    failed = [s for s in stages if s["status"] == "failed"]
    new_status = "partially_completed" if failed else (
        "completed" if all(s["status"] == "complete" for s in stages) else p["status"])
    await db.orai_projects.update_one({"id": pid}, {"$set": {
        "outputs": outputs, "stages": stages, "status": new_status, "updated_at": _iso()}})
    await db.orai_projects.update_one({"id": pid}, {"$push": {"activity": {
        "at": _iso(), "msg": "Zero-cost repair executed — existing outputs reconnected, failed stages kept retryable"}}})
    await op.audit(current, "project_repaired", pid, str({k: len(v) for k, v in report.items()}))
    return {"report": report, "status": new_status,
            "retryable_stages": [s["id"] for s in failed]}


@router.post("/{pid}/duplicate")
async def duplicate(pid: str, current: CurrentUser):
    require_founder(current)
    p = await db.orai_projects.find_one({"id": pid, "creator_id": current["id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return await save_draft({"name": f"{p['name']} (copy)", "prompt": p.get("prompt"),
                             "tools": p.get("tools"), "providers": p.get("providers"),
                             "complexity": p.get("complexity"), "ai_power": p.get("ai_power"),
                             "settings": p.get("settings")}, current)


@router.post("/{pid}/archive")
async def archive(pid: str, body: dict, current: CurrentUser):
    require_founder(current)
    p = await db.orai_projects.find_one({"id": pid, "creator_id": current["id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    if p["status"] in ("queued", "generating"):
        raise HTTPException(status_code=400, detail="Cancel the project before archiving")
    val = bool(body.get("archived", True))
    await db.orai_projects.update_one({"id": pid}, {"$set": {"archived": val, "updated_at": _iso()}})
    await op.audit(current, "project_archived" if val else "project_restored", pid)
    return {"ok": True, "archived": val}
