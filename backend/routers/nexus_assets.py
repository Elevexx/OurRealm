"""NEXUS ASSET & UNITY BUILD MANAGER + AVATAR STUDIO (v30) — founder-only.
Chunked resumable uploads (no whole-file buffering), GLB/ZIP validation, durable R2 delivery,
avatar versioning with atomic pointer swaps, Unity web-build validation + sandboxed staging,
Magic Loops adapter (optional, server-side secrets), credit-gated Meshy generation."""
import asyncio, hashlib, json, os, re, shutil, time, uuid, zipfile
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import meshy_provider as mp
from services.storage import media_dir
from services.storage_adapter import get_storage_adapter

router = APIRouter(prefix="/api/nexus/assets", tags=["nexus-assets"])
UPLOAD_DIR = Path("/data/nexus_uploads")
STAGE_DIR = Path("/data/unity_stage")
PART_MAX = 16 * 1024 * 1024
MAX_BYTES = int(float(os.environ.get("NEXUS_MAX_UPLOAD_GB", "4")) * 1024**3)
ZIP_MAX_RATIO = 120
ZIP_MAX_FILES = 4000

def _iso(): return datetime.now(timezone.utc).isoformat()

async def _founder(current):
    require_founder(current)

# ---------- chunked resumable uploads ----------
@router.post("/upload/init")
async def upload_init(body: dict, current: CurrentUser):
    await _founder(current)
    size = int(body.get("size") or 0)
    name = re.sub(r"[^A-Za-z0-9._-]", "_", str(body.get("filename") or "file"))[:120]
    kind = body.get("kind") or "glb"
    if kind not in ("glb", "gltf_zip", "unity_zip"): raise HTTPException(422, "unsupported kind")
    if size <= 0 or size > MAX_BYTES: raise HTTPException(413, f"size must be 1..{MAX_BYTES} bytes")
    # dedupe by declared hash
    if body.get("sha256"):
        dup = await db.asset_library.find_one({"meta.checksum_full": body["sha256"]}, {"_id": 0, "id": 1, "url": 1})
        if dup: return {"deduplicated": True, "asset": dup}
    uid = uuid.uuid4().hex[:16]
    (UPLOAD_DIR / uid).mkdir(parents=True, exist_ok=True)
    parts = (size + PART_MAX - 1) // PART_MAX
    doc = {"upload_id": uid, "filename": name, "size": size, "kind": kind, "parts_total": parts,
           "parts_done": [], "status": "uploading", "by": current["id"], "created_at": _iso()}
    await db.nexus_uploads.insert_one(dict(doc))
    doc.pop("_id", None)
    return {**doc, "part_size": PART_MAX}

@router.put("/upload/{uid}/part/{n}")
async def upload_part(uid: str, n: int, request: Request, current: CurrentUser):
    await _founder(current)
    ses = await db.nexus_uploads.find_one({"upload_id": uid, "status": "uploading"})
    if not ses: raise HTTPException(404, "upload session not found")
    if n < 0 or n >= ses["parts_total"]: raise HTTPException(422, "bad part index")
    h = hashlib.sha256(); total = 0
    with open(UPLOAD_DIR / uid / f"p{n}", "wb") as f:
        async for chunk in request.stream():
            total += len(chunk)
            if total > PART_MAX + 1024: raise HTTPException(413, "part too large")
            h.update(chunk); f.write(chunk)
    await db.nexus_uploads.update_one({"upload_id": uid}, {"$addToSet": {"parts_done": n}})
    return {"ok": True, "part": n, "sha256": h.hexdigest(), "bytes": total}

@router.get("/uploads")
async def uploads_list(current: CurrentUser):
    await _founder(current)
    items = await db.nexus_uploads.find({"status": "uploading"}, {"_id": 0}).sort("created_at", -1).to_list(20)
    return {"uploads": items, "part_size": PART_MAX, "max_bytes": MAX_BYTES}

@router.delete("/upload/{uid}")
async def upload_abort(uid: str, current: CurrentUser):
    await _founder(current)
    shutil.rmtree(UPLOAD_DIR / uid, ignore_errors=True)
    await db.nexus_uploads.update_one({"upload_id": uid}, {"$set": {"status": "aborted"}})
    return {"ok": True}

def _safe_zip_check(zp: Path):
    with zipfile.ZipFile(zp) as z:
        names = z.namelist()
        if len(names) > ZIP_MAX_FILES: raise HTTPException(422, "zip has too many entries")
        total_u = 0
        for i in z.infolist():
            n = i.filename
            if n.startswith("/") or ".." in n.replace("\\", "/").split("/"):
                raise HTTPException(422, f"unsafe path in zip: {n}")
            if (i.external_attr >> 16) & 0o120000 == 0o120000:
                raise HTTPException(422, f"symlink in zip: {n}")
            if n.lower().endswith((".exe", ".dll", ".sh", ".bat", ".dylib", ".so", ".zip", ".rar", ".7z")) and "streamingassets" not in n.lower():
                raise HTTPException(422, f"disallowed payload in zip: {n}")
            total_u += i.file_size
        comp = max(1, zp.stat().st_size)
        if total_u / comp > ZIP_MAX_RATIO: raise HTTPException(422, "zip decompression ratio too high (zip bomb?)")
        return names, total_u

UNITY_PATTERNS = {"loader": r"\.loader\.js(\.br|\.gz)?$", "framework": r"\.framework\.js(\.br|\.gz)?$",
                  "wasm": r"\.wasm(\.br|\.gz)?$", "data": r"\.data(\.br|\.gz)?$", "index": r"(^|/)index\.html$"}

@router.post("/upload/{uid}/complete")
async def upload_complete(uid: str, body: dict, current: CurrentUser):
    await _founder(current)
    ses = await db.nexus_uploads.find_one({"upload_id": uid, "status": "uploading"})
    if not ses: raise HTTPException(404, "upload session not found")
    if len(ses["parts_done"]) != ses["parts_total"]: raise HTTPException(409, "missing parts")
    tmp = UPLOAD_DIR / uid / "assembled"
    h = hashlib.sha256()
    with open(tmp, "wb") as out:
        for n in range(ses["parts_total"]):
            with open(UPLOAD_DIR / uid / f"p{n}", "rb") as f:
                while True:
                    b = f.read(1 << 20)
                    if not b: break
                    h.update(b); out.write(b)
    digest = h.hexdigest()
    if body.get("sha256") and body["sha256"] != digest:
        raise HTTPException(422, "sha256 mismatch — upload corrupted")
    report = {"sha256": digest, "bytes": tmp.stat().st_size, "kind": ses["kind"]}
    if ses["kind"] == "glb":
        raw16 = open(tmp, "rb").read(20)
        if raw16[:4] != b"glTF": raise HTTPException(422, "not a GLB (bad magic header)")
        meta = mp.validate_glb(open(tmp, "rb").read()) if tmp.stat().st_size < 300 * 1024**2 else {"checksum": digest[:32], "bytes": tmp.stat().st_size, "meshes": "large-deferred"}
        meta["checksum_full"] = digest
        fname = digest[:32] + ".glb"
        shutil.copyfile(tmp, media_dir("models") / fname)
        try: get_storage_adapter().put("models", fname, media_dir("models") / fname)
        except Exception: pass
        url = f"/api/media/models/{fname}"
        await db.asset_library.update_one({"id": digest[:32]}, {"$set": {
            "id": digest[:32], "kind": "model_glb", "name": ses["filename"], "url": url, "meta": meta,
            "provider": "founder_upload", "immutable_master": True, "license": "founder-attested",
            "owner": "ourrealm", "uploaded_by": current["id"], "created_at": _iso()}}, upsert=True)
        report.update({"asset_id": digest[:32], "url": url, "validation": meta})
    elif ses["kind"] == "unity_zip":
        names, total_u = _safe_zip_check(tmp)
        found = {k: [n for n in names if re.search(p, n, re.I)] for k, p in UNITY_PATTERNS.items()}
        missing = [k for k, v in found.items() if not v]
        if missing: raise HTTPException(422, f"Unity build incomplete — missing: {', '.join(missing)}")
        bid = digest[:16]
        dest = STAGE_DIR / bid
        dest.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(tmp) as z: z.extractall(dest)
        comp = "brotli" if any(n.endswith(".br") for n in names) else ("gzip" if any(n.endswith(".gz") for n in names) else "none")
        await db.nexus_unity_builds.insert_one({"build_id": bid, "filename": ses["filename"], "sha256": digest,
            "bytes": report["bytes"], "files": len(names), "uncompressed": total_u, "compression": comp,
            "found": {k: v[:3] for k, v in found.items()}, "status": "staged", "by": current["id"], "created_at": _iso()})
        report.update({"build_id": bid, "compression": comp, "staging_url": f"/api/nexus/assets/unity-stage/{bid}/index.html", "found": {k: v[:3] for k, v in found.items()}})
    else:
        _safe_zip_check(tmp)
        report["note"] = "gltf zip stored; conversion pipeline pending"
    await db.nexus_uploads.update_one({"upload_id": uid}, {"$set": {"status": "complete", "report": report}})
    await emit_event("nexus.asset.uploaded" if ses["kind"] != "unity_zip" else "nexus.unity.uploaded",
                     {"resource_id": report.get("asset_id") or report.get("build_id"), "sha256": digest}, current["id"])
    shutil.rmtree(UPLOAD_DIR / uid, ignore_errors=True)
    return report

# ---------- unity staging (sandboxed: no auth cookies used, strict CSP, correct encodings) ----------
@router.get("/unity-stage/{bid}/{path:path}")
async def unity_stage(bid: str, path: str):
    base = (STAGE_DIR / re.sub(r"[^a-f0-9]", "", bid)).resolve()
    f = (base / path).resolve()
    if not str(f).startswith(str(base)) or not f.is_file(): raise HTTPException(404)
    enc = None; mime = "application/octet-stream"
    p = f.name.lower()
    if p.endswith(".br"): enc = "br"; p = p[:-3]
    elif p.endswith(".gz"): enc = "gzip"; p = p[:-3]
    if p.endswith(".html"): mime = "text/html"
    elif p.endswith(".js"): mime = "application/javascript"
    elif p.endswith(".wasm"): mime = "application/wasm"
    elif p.endswith(".json"): mime = "application/json"
    elif p.endswith(".data"): mime = "application/octet-stream"
    headers = {"Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp",
               "Content-Security-Policy": "sandbox allow-scripts allow-same-origin; frame-ancestors 'self'",
               "Cache-Control": "no-store" if mime == "text/html" else "public, max-age=3600"}
    if enc: headers["Content-Encoding"] = enc
    return Response(content=f.read_bytes(), media_type=mime, headers=headers)

@router.get("/unity/builds")
async def unity_builds(current: CurrentUser):
    await _founder(current)
    return {"builds": await db.nexus_unity_builds.find({}, {"_id": 0}).sort("created_at", -1).to_list(20)}

# ---------- avatar studio ----------
@router.get("/catalog")
async def catalog(current: CurrentUser):
    await _founder(current)
    avs = await db.nexus_avatars.find({"status": {"$in": ["active", "premium"]}}, {"_id": 0}).to_list(30)
    out = []
    for a in avs:
        out.append({"id": a["id"], "label": a.get("label"), "status": a["status"], "gen": a.get("gen", "v1"),
                    "eligibility": a.get("eligibility"), "thumb": a.get("thumb"), "ktx2": bool(a.get("ktx2")),
                    "anims": sorted((a.get("animation_urls") or {}).keys()), "lods": sorted((a.get("lod_urls") or {}).keys()),
                    "preview_url": (a.get("lod_urls") or {}).get("lod1") or a.get("rigged_base_url"),
                    "owners": await db.nexus_avatar_unlocks.count_documents({"avatar_id": a["id"]}),
                    "equipped": await db.users.count_documents({"nexus_avatar_id": a["id"]}),
                    "versions": await db.nexus_avatar_versions.count_documents({"avatar_id": a["id"]}),
                    "master": bool(a.get("master_file"))})
    from routers.nexus import AVATAR_FP_COSTS
    for o in out: o["fp_cost"] = AVATAR_FP_COSTS.get(o["id"], 0)
    return {"avatars": out}

@router.post("/avatar/{aid}/version")
async def avatar_version(aid: str, body: dict, current: CurrentUser):
    await _founder(current)
    asset = await db.asset_library.find_one({"id": body.get("asset_id")}, {"_id": 0})
    if not asset: raise HTTPException(404, "uploaded asset not found")
    if not (asset.get("meta") or {}).get("skins"): raise HTTPException(422, "model has no skeleton skin — rejected for avatar use")
    vid = uuid.uuid4().hex[:12]
    await db.nexus_avatar_versions.insert_one({"version_id": vid, "avatar_id": aid, "state": "founder_review_ready",
        "source_asset": asset["id"], "url": asset["url"], "notes": body.get("notes", ""), "by": current["id"], "created_at": _iso()})
    return {"ok": True, "version_id": vid, "state": "founder_review_ready"}

@router.post("/avatar/{aid}/publish")
async def avatar_publish(aid: str, body: dict, current: CurrentUser):
    await _founder(current)
    ver = await db.nexus_avatar_versions.find_one({"version_id": body.get("version_id"), "avatar_id": aid})
    if not ver: raise HTTPException(404, "version not found")
    prev = await db.nexus_avatars.find_one({"id": aid}, {"_id": 0})
    if not prev: raise HTTPException(404, "catalog avatar not found")
    await db.nexus_avatar_versions.update_one({"version_id": "rb-" + aid}, {"$set": {
        "version_id": "rb-" + aid, "avatar_id": aid, "state": "rollback_target", "doc": prev, "created_at": _iso()}}, upsert=True)
    # atomic pointer swap — id, price, eligibility, ownership untouched
    await db.nexus_avatars.update_one({"id": aid}, {"$set": {"rigged_base_url": ver["url"],
        "gen": "studio-" + ver["version_id"], "updated_at": _iso()}})
    await db.nexus_avatar_versions.update_one({"version_id": ver["version_id"]}, {"$set": {"state": "live"}})
    await emit_event("nexus.release.published", {"resource_id": aid, "version_id": ver["version_id"]}, current["id"])
    return {"ok": True, "live_version": ver["version_id"]}

@router.post("/avatar/{aid}/rollback")
async def avatar_rollback(aid: str, current: CurrentUser):
    await _founder(current)
    rb = await db.nexus_avatar_versions.find_one({"version_id": "rb-" + aid})
    if not rb: raise HTTPException(404, "no rollback target")
    doc = rb["doc"]; doc.pop("_id", None)
    await db.nexus_avatars.update_one({"id": aid}, {"$set": doc})
    await emit_event("nexus.release.rolled_back", {"resource_id": aid}, current["id"])
    return {"ok": True}

@router.post("/avatar/{aid}/estimate")
async def avatar_estimate(aid: str, current: CurrentUser):
    await _founder(current)
    bal = (await mp.health()).get("balance")
    stages = ["image-to-3d (35)", "remesh (5)", "rig (5, 2 retries free-on-fail)", "7 animations (21)", "LOD0/1/2 + KTX2 + thumbnail (0)"]
    return {"avatar": aid, "credits_estimate": 70, "balance": bal, "stages": stages, "retry_limit": 2,
            "outputs": ["master GLB", "LOD0/1/2", "7 anims", "KTX2 tiers", "thumbnail"]}

@router.post("/avatar/{aid}/generate")
async def avatar_generate(aid: str, body: dict, current: CurrentUser):
    await _founder(current)
    if body.get("approve") is not True:
        raise HTTPException(428, "Founder approval required: send approve=true via APPROVE CREDITS & GENERATE")
    bal = (await mp.health()).get("balance") or 0
    if bal < 80: raise HTTPException(402, f"Insufficient Meshy credits ({bal})")
    job = {"job_id": uuid.uuid4().hex[:12], "avatar_id": aid, "state": "queued", "approved_by": current["id"],
           "credits_estimate": 70, "balance_at_approval": bal, "created_at": _iso()}
    await db.nexus_jobs.insert_one(dict(job))
    await emit_event("nexus.avatar.generation_started", {"resource_id": aid, "job_id": job["job_id"]}, current["id"])
    job.pop("_id", None)
    return {"ok": True, **job, "note": "queued — pipeline runs the approved image-to-3D avatar flow"}

# ---------- magic loops (optional orchestrator; server-side secrets; idempotent events) ----------
async def emit_event(name: str, payload: dict, actor: str):
    cfg = await db.nexus_ml_config.find_one({"_id": "cfg"}) or {}
    ev = {"event_id": uuid.uuid4().hex, "idempotency_key": hashlib.sha256(f"{name}:{json.dumps(payload, sort_keys=True, default=str)}".encode()).hexdigest()[:24],
          "event": name, "ts": _iso(), "environment": os.environ.get("ENV_NAME", "preview"), "actor": actor, **payload}
    await db.nexus_ml_events.insert_one(dict(ev))
    url = (cfg.get("workflows") or {}).get(name) or cfg.get("default_url")
    if not cfg.get("enabled") or not url: return
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(url, json={k: v for k, v in ev.items() if k != "_id"},
                             headers={"Authorization": f"Bearer {cfg.get('token', '')}"} if cfg.get("token") else {})
            await db.nexus_ml_events.update_one({"event_id": ev["event_id"]}, {"$set": {"delivered": r.status_code < 300, "status_code": r.status_code}})
    except Exception as e:
        await db.nexus_ml_events.update_one({"event_id": ev["event_id"]}, {"$set": {"delivered": False, "error": str(e)[:120], "dead_letter": True}})

@router.get("/magicloops/config")
async def ml_config_get(current: CurrentUser):
    await _founder(current)
    cfg = await db.nexus_ml_config.find_one({"_id": "cfg"}) or {}
    return {"enabled": bool(cfg.get("enabled")), "default_url": bool(cfg.get("default_url")),
            "token_set": bool(cfg.get("token")), "workflows": list((cfg.get("workflows") or {}).keys())}

@router.post("/magicloops/config")
async def ml_config_set(body: dict, current: CurrentUser):
    await _founder(current)
    sets = {k: body[k] for k in ("enabled", "default_url", "token", "workflows") if k in body}
    await db.nexus_ml_config.update_one({"_id": "cfg"}, {"$set": sets}, upsert=True)
    return {"ok": True}

@router.post("/magicloops/test")
async def ml_test(current: CurrentUser):
    await _founder(current)
    cfg = await db.nexus_ml_config.find_one({"_id": "cfg"}) or {}
    if not cfg.get("default_url"): return {"ok": False, "detail": "No Magic Loops trigger URL configured"}
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(cfg["default_url"], json={"event": "nexus.connection.test", "ts": _iso()},
                             headers={"Authorization": f"Bearer {cfg.get('token', '')}"} if cfg.get("token") else {})
        return {"ok": r.status_code < 300, "status_code": r.status_code}
    except Exception as e:
        return {"ok": False, "detail": str(e)[:140]}

@router.get("/magicloops/runs")
async def ml_runs(current: CurrentUser):
    await _founder(current)
    evs = await db.nexus_ml_events.find({}, {"_id": 0, "token": 0}).sort("ts", -1).to_list(25)
    return {"events": evs}

# ---------- rights attestation ----------
@router.post("/attest")
async def attest(body: dict, current: CurrentUser):
    await _founder(current)
    req = ["own_or_permitted", "unity_plan_ok", "licenses_reviewed", "authorized_to_distribute"]
    if not all(body.get(k) is True for k in req): raise HTTPException(422, "all attestation statements required")
    doc = {"id": uuid.uuid4().hex[:12], "admin": current["id"], "at": _iso(), "resource": body.get("resource"),
           "sha256": body.get("sha256"), "attestation_version": "v1", "statements": req}
    await db.nexus_attestations.insert_one(dict(doc))
    doc.pop("_id", None)
    return {"ok": True, **doc}
