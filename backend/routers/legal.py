"""Legal routes — founder-only admin (/api/admin/legal) + public
(/api/legal). Publish / rollback / notices require founder password
reauthentication (server-side)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from core.security import verify_password
from services import legal_docs as ld

router = APIRouter(prefix="/api/admin/legal", tags=["admin-legal"])
public_router = APIRouter(prefix="/api/legal", tags=["legal-public"])


def _reauth(current: dict, password: str):
    if not verify_password(password or "", current.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Founder password reauthentication failed")


# ── Admin ───────────────────────────────────────────────────────────
@router.get("/documents")
async def admin_list(current: CurrentUser):
    require_founder(current)
    return {"documents": await ld.list_docs()}


@router.get("/documents/{key}")
async def admin_get(key: str, current: CurrentUser):
    require_founder(current)
    doc = await ld.get_doc(key)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    body = doc.get("draft_body") or doc.get("published_body") or ""
    return {"document": doc,
            "sections": [s["heading"] for s in ld.split_sections(body)],
            "versions": await ld.list_versions(key),
            "patches": await ld.list_patches(key)}


class CustomPayload(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    slug: str = Field(min_length=2, max_length=60)


@router.post("/documents")
async def admin_create_custom(payload: CustomPayload, current: CurrentUser):
    require_founder(current)
    try:
        return {"document": await ld.create_custom(current, payload.title, payload.slug)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class DraftPayload(BaseModel):
    body: str = Field(max_length=200000)
    title: Optional[str] = Field(default=None, max_length=120)


@router.put("/documents/{key}/draft")
async def admin_save_draft(key: str, payload: DraftPayload, current: CurrentUser):
    require_founder(current)
    try:
        return {"document": await ld.save_draft(key, current, payload.body, payload.title)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/documents/{key}/cancel-draft")
async def admin_cancel_draft(key: str, current: CurrentUser):
    require_founder(current)
    try:
        return {"document": await ld.cancel_draft(key, current)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class PublishPayload(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    change_summary: str = Field(min_length=3, max_length=600)
    effective_date: Optional[str] = Field(default=None, max_length=10)


@router.post("/documents/{key}/publish")
async def admin_publish(key: str, payload: PublishPayload, current: CurrentUser):
    require_founder(current)
    _reauth(current, payload.password)
    try:
        return {"document": await ld.publish(
            key, current, change_summary=payload.change_summary,
            effective_date=payload.effective_date)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class RollbackPayload(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    version: int = Field(ge=1)


@router.post("/documents/{key}/rollback")
async def admin_rollback(key: str, payload: RollbackPayload, current: CurrentUser):
    require_founder(current)
    _reauth(current, payload.password)
    try:
        return {"document": await ld.rollback(key, current, payload.version)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/documents/{key}/archive")
async def admin_archive(key: str, current: CurrentUser):
    require_founder(current)
    try:
        return {"document": await ld.archive(key, current)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class OraiPatchPayload(BaseModel):
    section: str = Field(min_length=1, max_length=200)
    instruction: str = Field(min_length=5, max_length=800)


@router.post("/documents/{key}/orai-patch")
async def admin_orai_patch(key: str, payload: OraiPatchPayload, current: CurrentUser):
    require_founder(current)
    try:
        return {"patch": await ld.orai_patch(key, current, payload.section, payload.instruction)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/patches/{patch_id}/apply")
async def admin_apply_patch(patch_id: str, current: CurrentUser):
    require_founder(current)
    try:
        return {"document": await ld.apply_patch(patch_id, current)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class NoticePayload(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    doc_keys: list[str]
    mode: str = Field(pattern="^(one_time|ack_required)$")
    message: str = Field(default="", max_length=600)
    audience: str = Field(default="all", max_length=20)


@router.post("/notices")
async def admin_create_notice(payload: NoticePayload, current: CurrentUser):
    require_founder(current)
    _reauth(current, payload.password)
    try:
        return {"notice": await ld.create_notice(
            current, doc_keys=payload.doc_keys, mode=payload.mode,
            message=payload.message, audience=payload.audience)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Public ──────────────────────────────────────────────────────────
@public_router.get("/documents")
async def public_list():
    docs = [d async for d in db.legal_documents.find(
        {"status": "published", "published_version": {"$gte": 1}},
        {"_id": 0, "key": 1, "title": 1, "subtitle": 1, "slug": 1,
         "effective_date": 1, "last_updated": 1}).sort("title", 1)]
    return {"documents": docs}


@public_router.get("/documents/{slug}")
async def public_get(slug: str):
    doc = await db.legal_documents.find_one(
        {"slug": slug, "status": "published", "published_version": {"$gte": 1}},
        {"_id": 0, "key": 1, "title": 1, "subtitle": 1, "slug": 1,
         "published_body": 1, "effective_date": 1, "last_updated": 1,
         "published_version": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"document": doc,
            "sections": [s["heading"] for s in ld.split_sections(doc["published_body"])]}


@public_router.get("/notices/pending")
async def my_pending_notices(current: CurrentUser):
    return {"notices": await ld.pending_notices(current)}


@public_router.post("/notices/{notice_id}/acknowledge")
async def ack_notice(notice_id: str, current: CurrentUser):
    return await ld.acknowledge_notice(notice_id, current)
