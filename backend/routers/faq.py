"""Phase 8 — FAQ entries.

Public (read-only) and admin (CRUD) endpoints. FAQ items render on
/profile/support and are edited from /admin/faq.

Endpoints:
  GET    /api/faq                 — public, published items only.
  GET    /api/admin/faq           — admin: all items (incl. drafts).
  POST   /api/admin/faq           — admin: create.
  PATCH  /api/admin/faq/{id}      — admin: update.
  DELETE /api/admin/faq/{id}      — admin: delete.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser, require_admin


router = APIRouter(tags=["faq"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serialize(item: dict) -> dict:
    item.pop("_id", None)
    return item


class FAQCreate(BaseModel):
    question:     str = Field(min_length=1, max_length=200)
    answer:       str = Field(min_length=1, max_length=2000)
    is_published: bool = True
    order_index:  Optional[int] = None


class FAQUpdate(BaseModel):
    question:     Optional[str] = Field(default=None, max_length=200)
    answer:       Optional[str] = Field(default=None, max_length=2000)
    is_published: Optional[bool] = None
    order_index:  Optional[int] = None


@router.get("/api/faq")
async def list_public_faq():
    cursor = db.faq.find({"is_published": True}, {"_id": 0}).sort([("order_index", 1), ("created_at", 1)])
    return {"items": [_serialize(x) async for x in cursor]}


@router.get("/api/admin/faq")
async def list_admin_faq(current: CurrentUser):
    require_admin(current)
    cursor = db.faq.find({}, {"_id": 0}).sort([("order_index", 1), ("created_at", 1)])
    return {"items": [_serialize(x) async for x in cursor]}


@router.post("/api/admin/faq")
async def create_faq(payload: FAQCreate, current: CurrentUser):
    require_admin(current)
    if payload.order_index is None:
        last = await db.faq.find_one({}, sort=[("order_index", -1)])
        order_index = (int(last.get("order_index") or 0) + 10) if last else 10
    else:
        order_index = int(payload.order_index)
    item = {
        "id":            uuid.uuid4().hex,
        "question":      payload.question.strip(),
        "answer":        payload.answer.strip(),
        "is_published":  bool(payload.is_published),
        "order_index":   order_index,
        "created_at":    _now(),
        "updated_at":    _now(),
        "created_by":    current["id"],
    }
    await db.faq.insert_one(item)
    item.pop("_id", None)
    return {"ok": True, "item": item}


@router.patch("/api/admin/faq/{faq_id}")
async def update_faq(faq_id: str, payload: FAQUpdate, current: CurrentUser):
    require_admin(current)
    set_ops: dict = {"updated_at": _now()}
    if payload.question is not None:     set_ops["question"]     = payload.question.strip()
    if payload.answer is not None:       set_ops["answer"]       = payload.answer.strip()
    if payload.is_published is not None: set_ops["is_published"] = bool(payload.is_published)
    if payload.order_index is not None:  set_ops["order_index"]  = int(payload.order_index)
    res = await db.faq.update_one({"id": faq_id}, {"$set": set_ops})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="FAQ not found")
    fresh = await db.faq.find_one({"id": faq_id}, {"_id": 0})
    return {"ok": True, "item": fresh}


@router.delete("/api/admin/faq/{faq_id}")
async def delete_faq(faq_id: str, current: CurrentUser):
    require_admin(current)
    res = await db.faq.delete_one({"id": faq_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="FAQ not found")
    return {"ok": True}
