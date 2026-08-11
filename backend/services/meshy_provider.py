"""Meshy AI 3D generation provider (server-side only).

3D asset pipeline for ORAi + GameMaker. Engagement Resource(s) (ERs) note:
generated 3D assets plug into runtimes whose ER/Fire Power hooks remain
server-authoritative — Meshy only supplies model files, never rewards.
The MESHY_API_KEY secret never leaves this module (no logging, no responses).
"""
import hashlib
import json
import os
import struct
from datetime import datetime, timezone

import httpx

HOST = "https://api.meshy.ai"
PATHS = {
    "text_preview": "/openapi/v2/text-to-3d",
    "text_refine": "/openapi/v2/text-to-3d",
    "image": "/openapi/v1/image-to-3d",
    "multi_image": "/openapi/v1/multi-image-to-3d",
    "remesh": "/openapi/v1/remesh",
    "convert": "/openapi/v1/convert",
    "rig": "/openapi/v1/rigging",
    "animation": "/openapi/v1/animations",
}
TERMINAL = {"SUCCEEDED", "FAILED", "CANCELED"}
MAX_GLB_BYTES = 60 * 1024 * 1024


def _key() -> str:
    return os.environ.get("MESHY_API_KEY") or ""


def configured() -> dict:
    k = _key()
    return {"configured": bool(k) and k != "MESHY_KEY_PENDING",
            "placeholder": k == "MESHY_KEY_PENDING"}


class MeshyError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(message)


async def _call(method: str, path: str, body: dict | None = None):
    async with httpx.AsyncClient(base_url=HOST, timeout=60) as c:
        r = await c.request(method, path, json=body,
                            headers={"Authorization": f"Bearer {_key()}",
                                     "Content-Type": "application/json"})
    if r.status_code >= 400:
        try:
            msg = (r.json() or {}).get("message") or "Meshy request failed"
        except Exception:  # noqa: BLE001
            msg = "Meshy request failed"
        raise MeshyError(r.status_code, msg)  # never include headers/key
    return r.json() if r.content else None


async def health() -> dict:
    """No-credit connectivity + auth test (reads balance only)."""
    cfg = configured()
    if not cfg["configured"]:
        return {**cfg, "ok": False, "detail": "MESHY_API_KEY is a placeholder — set the real key in production secrets"}
    try:
        bal = await _call("GET", "/openapi/v1/balance")
        return {**cfg, "ok": True, "balance": bal.get("balance"),
                "tested_at": datetime.now(timezone.utc).isoformat()}
    except MeshyError as e:
        return {**cfg, "ok": False, "detail": f"Meshy responded {e.status}: {e.message}"}
    except httpx.HTTPError:
        return {**cfg, "ok": False, "detail": "network error reaching api.meshy.ai"}


async def create_task(db, user, workflow: str, payload: dict, idem_key: str,
                      context: dict | None = None) -> dict:
    if workflow not in PATHS:
        raise MeshyError(400, "Unsupported workflow")
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    old = await db.meshy_tasks.find_one({"idem_key": idem_key}, {"_id": 0})
    if old:
        if old["payload_hash"] != digest:
            raise MeshyError(409, "Idempotency key reused with a different payload")
        return {"task_id": old["meshy_task_id"], "workflow": old["workflow"], "replayed": True}
    res = await _call("POST", PATHS[workflow], payload)
    task_id = res["result"]
    await db.meshy_tasks.insert_one({
        "idem_key": idem_key, "payload_hash": digest, "workflow": workflow,
        "meshy_task_id": task_id, "status": "PENDING", "progress": 0,
        "created_by": user.get("id"), "created_by_username": user.get("username"),
        "context": context or {},  # game_id, runtime_slot, prompt summary, source images
        "consumed_credits": None,
        "created_at": datetime.now(timezone.utc).isoformat()})
    return {"task_id": task_id, "workflow": workflow, "replayed": False}


async def poll_task(db, workflow: str, task_id: str) -> dict:
    if workflow not in PATHS:
        raise MeshyError(400, "Unsupported workflow")
    t = await _call("GET", f"{PATHS[workflow]}/{task_id}")
    err = t.get("task_error") or {}
    await db.meshy_tasks.update_one({"meshy_task_id": task_id}, {"$set": {
        "status": t.get("status"), "progress": t.get("progress", 0),
        "consumed_credits": t.get("consumed_credits"),
        "task_error": {"type": err.get("type"), "message": (err.get("message") or "")[:400]} if err else None,
        "thumbnail_url": t.get("thumbnail_url"),
        "updated_at": datetime.now(timezone.utc).isoformat()}})
    safe = {k: t.get(k) for k in ("id", "status", "progress", "task_error",
                                  "thumbnail_url", "consumed_credits")}
    model_urls = t.get("model_urls") or {}
    animation_result = t.get("result") or {}
    animation_glb = animation_result.get("animation_glb_url")
    if workflow == "animation" and animation_glb:
        model_urls = {**model_urls, "glb": animation_glb}
    safe["model_urls"] = model_urls or None
    return safe


async def cancel_task(db, workflow: str, task_id: str) -> dict:
    if workflow not in PATHS:
        raise MeshyError(400, "Unsupported workflow")
    snap = await db.meshy_tasks.find_one({"meshy_task_id": task_id}, {"_id": 0})
    if snap:  # archive before irreversible provider deletion
        await db.meshy_tasks_archive.insert_one({**snap, "archived_at": datetime.now(timezone.utc).isoformat()})
    await _call("DELETE", f"{PATHS[workflow]}/{task_id}")
    await db.meshy_tasks.update_one({"meshy_task_id": task_id},
                                    {"$set": {"status": "CANCELED"}})
    return {"ok": True}


def validate_glb(raw: bytes) -> dict:
    """Structural GLB validation before runtime use."""
    if len(raw) < 20 or raw[0:4] != b"glTF":
        raise MeshyError(422, "File is not a binary glTF (GLB)")
    version, total_len = struct.unpack("<II", raw[4:12])
    if version != 2:
        raise MeshyError(422, f"Unsupported glTF version {version}")
    if len(raw) > MAX_GLB_BYTES:
        raise MeshyError(422, "GLB exceeds size budget")
    chunk_len, chunk_type = struct.unpack("<II", raw[12:20])
    if chunk_type != 0x4E4F534A:  # 'JSON'
        raise MeshyError(422, "First GLB chunk is not JSON")
    doc = json.loads(raw[20:20 + chunk_len].decode("utf-8"))
    meshes = doc.get("meshes") or []
    if not meshes:
        raise MeshyError(422, "GLB contains no meshes")
    return {
        "version": version, "bytes": len(raw),
        "meshes": len(meshes),
        "materials": len(doc.get("materials") or []),
        "textures": len(doc.get("textures") or []),
        "animations": [a.get("name") or f"clip_{i}" for i, a in enumerate(doc.get("animations") or [])],
        "skins": len(doc.get("skins") or []),
        "nodes": len(doc.get("nodes") or []),
        "checksum": hashlib.sha256(raw).hexdigest(),
    }


async def store_glb(db, user, workflow: str, task_id: str, name: str,
                    context: dict | None = None) -> dict:
    """Download the signed GLB immediately and persist into OurRealm storage."""
    t = await poll_task(db, workflow, task_id)
    if t.get("status") != "SUCCEEDED":
        raise MeshyError(409, "Task is not complete")
    url = (t.get("model_urls") or {}).get("glb")
    if not url:
        raise MeshyError(422, "No GLB output on this task")
    async with httpx.AsyncClient(timeout=300) as c:
        r = await c.get(url)
        r.raise_for_status()
    meta = validate_glb(r.content)
    from pathlib import Path  # noqa: F401
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter
    fname = f"{meta['checksum'][:32]}.glb"
    local = media_dir("models") / fname
    local.parent.mkdir(parents=True, exist_ok=True)
    local.write_bytes(r.content)
    try:
        get_storage_adapter().put("models", fname, local)
    except Exception:  # noqa: BLE001
        pass  # local adapter already persisted; cloud put best-effort logged upstream
    asset = {
        "id": meta["checksum"][:32], "kind": "model_glb", "name": name,
        "url": f"/api/media/models/{fname}", "meta": meta,
        "provider": "meshy", "meshy_task_id": task_id, "workflow": workflow,
        "context": context or {}, "created_by": user.get("id"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.asset_library.update_one({"id": asset["id"]}, {"$set": asset}, upsert=True)
    await db.meshy_tasks.update_one({"meshy_task_id": task_id},
                                    {"$set": {"stored_asset_id": asset["id"]}})
    return asset
