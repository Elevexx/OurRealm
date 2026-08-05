"""ORAi Project Media — reusable import pipeline for ALL future OPC projects.

Uploads land in the universal asset library (game_asset_library) so blueprint
matching, AssetLibrarySearch and OPC generation reuse them automatically.
3D / Unity / Unreal formats are accepted and stored for future runtimes."""
import io
import mimetypes
import os
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, Form

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import asset_library
from services.storage import media_dir

router = APIRouter(prefix="/api/orai/media", tags=["project-media"])
public_media = APIRouter(prefix="/api/public/project-media", tags=["project-media"])

MEDIA_ROOT = media_dir("project_media")
HARD_CAP_MB = 512
DEFAULT_LIMITS = {"max_files": 50, "max_mb": 250}

# ext -> (media_type, library_category, future_runtime, default_usage)
EXT_MAP = {
    "png": ("image", "sprite_sheet", None, "sprite/background/tileset/icon"),
    "jpg": ("image", "environment", None, "background/texture"),
    "jpeg": ("image", "environment", None, "background/texture"),
    "webp": ("image", "environment", None, "background/texture"),
    "gif": ("animation", "animation", None, "animated sprite"),
    "svg": ("image", "icon", None, "ui icon"),
    "mp3": ("audio", "music", None, "music/ambient"),
    "wav": ("audio", "sound_effect", None, "sfx"),
    "ogg": ("audio", "sound_effect", None, "sfx"),
    "flac": ("audio", "music", None, "music"),
    "m4a": ("audio", "voice", None, "voice"),
    "mp4": ("video", "cinematic", None, "cutscene/trailer"),
    "mov": ("video", "cinematic", None, "cutscene"),
    "webm": ("video", "cinematic", None, "cutscene"),
    "glb": ("model_3d", "model_3d", "unity", "3d mesh"),
    "gltf": ("model_3d", "model_3d", "unity", "3d mesh"),
    "fbx": ("model_3d", "model_3d", "unity", "3d mesh/animation"),
    "obj": ("model_3d", "model_3d", "unity", "3d mesh"),
    "blend": ("model_3d", "model_3d", "unity", "blender source"),
    "unitypackage": ("unity", "model_3d", "unity", "unity package (stored)"),
    "unity": ("unity", "model_3d", "unity", "unity scene (stored)"),
    "prefab": ("unity", "model_3d", "unity", "unity prefab (stored)"),
    "mat": ("material", "material", "unity", "material"),
    "uasset": ("unreal", "model_3d", "unreal", "unreal asset (stored only)"),
    "hdr": ("hdri", "texture", "unity", "hdri environment"),
    "exr": ("hdri", "texture", "unity", "hdri environment"),
    "pdf": ("document", "prop", None, "reference document"),
    "txt": ("document", "prop", None, "reference document"),
    "md": ("document", "prop", None, "reference document"),
    "zip": ("archive", "prop", None, "asset library bundle"),
}
IMG_RUNTIMES = ["action_rpg_2_5d", "platformer", "top_down_adventure", "arcade", "match3"]


def _limits_key():
    return {"key": "project_media_limits"}


async def _get_limits() -> dict:
    row = await db.orai_settings.find_one(_limits_key(), {"_id": 0})
    return {**DEFAULT_LIMITS, **(row.get("value") if row else {})}


def _analyze(path: Path, ext: str, size: int) -> dict:
    """Deterministic media analysis — type, dims, frames, alpha, duration."""
    media_type, category, future_rt, usage = EXT_MAP.get(
        ext, ("file", "prop", None, "stored"))
    out = {"media_type": media_type, "category": category, "usage": usage,
           "future_runtime": future_rt, "dimensions": {}, "transparency": None,
           "frames": None, "duration_sec": None, "entries": None}
    try:
        if media_type in ("image", "animation"):
            from PIL import Image
            with Image.open(path) as im:
                w, h = im.size
                out["dimensions"] = {"width": w, "height": h}
                out["transparency"] = im.mode in ("RGBA", "LA", "P") and (
                    im.mode != "P" or "transparency" in im.info)
                out["frames"] = getattr(im, "n_frames", 1)
                if out["frames"] == 1 and h > 0 and w % h == 0 and 2 <= w // h <= 16:
                    out["frames"] = w // h
                    out["category"] = "sprite_sheet"
                elif w >= 1200 and h >= 600 and not out["transparency"]:
                    out["category"] = "environment"
                elif max(w, h) <= 256:
                    out["category"] = "icon"
        elif media_type == "audio":
            try:
                from mutagen import File as MFile
                mf = MFile(str(path))
                if mf is not None and mf.info:
                    out["duration_sec"] = round(float(mf.info.length), 2)
            except Exception:
                pass
        elif media_type == "archive":
            with zipfile.ZipFile(path) as z:
                out["entries"] = len(z.namelist())
    except Exception:
        pass
    return out


async def _save_upload(f: UploadFile, current: dict, name: str, tags: list,
                       category: str = "") -> dict:
    ext = (f.filename or "").rsplit(".", 1)[-1].lower() if "." in (f.filename or "") else ""
    data = await f.read()
    if len(data) > HARD_CAP_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {HARD_CAP_MB}MB hard cap")
    if not current.get("is_founder"):
        lim = await _get_limits()
        mine = await db.game_asset_library.count_documents(
            {"owner_id": current["id"], "source": "upload", "archived": {"$ne": True}})
        if mine >= lim["max_files"]:
            raise HTTPException(status_code=403, detail=f"Upload limit reached ({lim['max_files']} files)")
        if len(data) > lim["max_mb"] * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"File exceeds your {lim['max_mb']}MB limit")
    fname = f"{uuid.uuid4().hex}.{ext or 'bin'}"
    path = MEDIA_ROOT / fname
    path.write_bytes(data)
    an = _analyze(path, ext, len(data))
    file_tokens = [t for t in (f.filename or "").replace(".", " ").replace("_", " ").replace("-", " ").split() if len(t) > 2][:8]
    rec = await asset_library.register_asset(
        current,
        name=name or (f.filename or "Uploaded media"),
        category=(category or an["category"]),
        description=f"Imported media · {an['media_type']} · usage: {an['usage']}",
        tags=list(dict.fromkeys([an["media_type"], *tags, *file_tokens]))[:15],
        visual_style="imported",
        dimensions={**an["dimensions"],
                    **({"frames": an["frames"]} if an["frames"] else {}),
                    **({"duration_sec": an["duration_sec"]} if an["duration_sec"] else {}),
                    **({"entries": an["entries"]} if an["entries"] else {})},
        file_format=ext, source="upload", provider="project_media",
        compatible_runtimes=(IMG_RUNTIMES if an["media_type"] in ("image", "animation")
                             else ([an["future_runtime"]] if an["future_runtime"] else [])),
        animation_states=(["sheet"] if an.get("frames") and an["frames"] > 1 else []),
        preview_url=(f"/api/public/project-media/{fname}"
                     if an["media_type"] in ("image", "animation") else None),
        storage_ref={"kind": "project_media", "file_name": fname,
                     "bytes": len(data), "mime": f.content_type or
                     (mimetypes.guess_type(f.filename or "")[0] or "application/octet-stream")},
    )
    await db.game_asset_library.update_one(
        {"id": rec["id"]},
        {"$set": {"media_type": an["media_type"], "transparency": an["transparency"],
                  "future_runtime": an["future_runtime"], "runtime_usage": an["usage"],
                  "versions": rec.get("versions") or []}})
    rec.update({"media_type": an["media_type"], "runtime_usage": an["usage"]})
    return rec


@router.post("/upload")
async def upload(current: CurrentUser, file: UploadFile = File(...),
                 name: str = Form(""), tags: str = Form(""), category: str = Form("")):
    tag_list = [t.strip() for t in tags.split(",") if t.strip()][:10]
    rec = await _save_upload(file, current, name, tag_list, category)
    return {"asset": rec}


@router.get("")
async def list_media(current: CurrentUser, q: str = "", category: str = "",
                     media_type: str = "", page: int = 1):
    flt = {"owner_id": current["id"], "source": "upload", "archived": {"$ne": True}}
    if category.strip():
        flt["category"] = category.strip()
    if media_type.strip():
        flt["media_type"] = media_type.strip()
    if q.strip():
        import re as _re
        rx = {"$regex": "|".join(_re.escape(w) for w in q.split()[:4]), "$options": "i"}
        flt["$or"] = [{"name": rx}, {"tags": rx}, {"description": rx}]
    page = max(1, page)
    total = await db.game_asset_library.count_documents(flt)
    rows = await db.game_asset_library.find(flt, {"_id": 0}).sort("updated_at", -1) \
        .skip((page - 1) * 24).to_list(24)
    lim = await _get_limits()
    return {"assets": rows, "total": total, "page": page,
            "limits": None if current.get("is_founder") else lim,
            "categories": asset_library.ASSET_CATEGORIES,
            "founder_unlimited": bool(current.get("is_founder"))}


@router.get("/limits")
async def get_limits(current: CurrentUser):
    return {"limits": await _get_limits(), "founder_unlimited": bool(current.get("is_founder"))}


@router.post("/limits")
async def set_limits(current: CurrentUser, body: dict):
    require_founder(current)
    val = {"max_files": max(1, int(body.get("max_files") or DEFAULT_LIMITS["max_files"])),
           "max_mb": max(1, int(body.get("max_mb") or DEFAULT_LIMITS["max_mb"]))}
    await db.orai_settings.update_one(_limits_key(), {"$set": {"value": val}}, upsert=True)
    return {"limits": val}


async def _own(aid: str, current: dict) -> dict:
    a = await db.game_asset_library.find_one({"id": aid, "source": "upload"}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Media not found")
    if a["owner_id"] != current["id"] and not current.get("is_founder"):
        raise HTTPException(status_code=403, detail="Not your media")
    return a


@router.post("/{aid}/replace")
async def replace(aid: str, current: CurrentUser, file: UploadFile = File(...)):
    a = await _own(aid, current)
    new = await _save_upload(file, current, a["name"], a.get("tags") or [], a.get("category"))
    if new["id"] != a["id"]:  # different fingerprint -> merge as new version
        await db.game_asset_library.update_one(
            {"id": a["id"]},
            {"$set": {"storage_ref": new["storage_ref"], "preview_url": new.get("preview_url"),
                      "dimensions": new.get("dimensions"), "file_format": new.get("file_format"),
                      "fingerprint": new["fingerprint"], "updated_at": asset_library._iso()},
             "$inc": {"version": 1},
             "$push": {"versions": {"version": a.get("version", 1),
                                    "storage_ref": a.get("storage_ref"),
                                    "preview_url": a.get("preview_url"),
                                    "dimensions": a.get("dimensions"),
                                    "replaced_at": asset_library._iso()}}})
        await db.game_asset_library.delete_one({"id": new["id"]})
    out = await db.game_asset_library.find_one({"id": a["id"]}, {"_id": 0})
    return {"asset": out}


@router.post("/{aid}/restore")
async def restore(aid: str, current: CurrentUser):
    a = await _own(aid, current)
    versions = a.get("versions") or []
    if not versions:
        raise HTTPException(status_code=400, detail="No previous version to restore")
    prev = versions[-1]
    await db.game_asset_library.update_one(
        {"id": aid},
        {"$set": {"storage_ref": prev["storage_ref"], "preview_url": prev.get("preview_url"),
                  "dimensions": prev.get("dimensions") or {},
                  "fingerprint": asset_library.fingerprint(prev["storage_ref"] or {}),
                  "updated_at": asset_library._iso()},
         "$pop": {"versions": 1}, "$inc": {"version": 1}})
    return {"asset": await db.game_asset_library.find_one({"id": aid}, {"_id": 0})}


@router.get("/{aid}/versions")
async def versions(aid: str, current: CurrentUser):
    a = await _own(aid, current)
    return {"current": {"version": a.get("version", 1), "preview_url": a.get("preview_url"),
                        "dimensions": a.get("dimensions"), "storage_ref": a.get("storage_ref")},
            "previous": a.get("versions") or []}


@router.post("/{aid}/moderate")
async def moderate(aid: str, current: CurrentUser, body: dict):
    require_founder(current)
    await _own(aid, current)
    status = "approved" if body.get("decision") == "approve" else "rejected"
    await db.game_asset_library.update_one(
        {"id": aid}, {"$set": {"moderation_status": status,
                               "updated_at": asset_library._iso()}})
    return {"ok": True, "moderation_status": status}


@router.delete("/{aid}")
async def archive(aid: str, current: CurrentUser):
    await _own(aid, current)
    await db.game_asset_library.update_one(
        {"id": aid}, {"$set": {"archived": True, "updated_at": asset_library._iso()}})
    return {"ok": True}


@public_media.get("/{name}")
async def serve(name: str):
    if not name or "/" in name or "\\" in name or ".." in name or "\x00" in name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    a = await db.game_asset_library.find_one(
        {"source": "upload", "storage_ref.file_name": name}, {"id": 1, "storage_ref": 1})
    if not a:
        raise HTTPException(status_code=404, detail="Not found")
    path = MEDIA_ROOT / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing")
    from fastapi.responses import FileResponse
    return FileResponse(str(path), media_type=(a.get("storage_ref") or {}).get("mime")
                        or "application/octet-stream")
