"""Phase α — Configurable support ticket categories.

Admins (founder + support_admin) can create / edit / reorder / enable
categories. Regular users get a read-only list of ENABLED categories
to pick from when filing a ticket. Categories are stored in
`db.ticket_categories` and seeded with six defaults on startup
(see core/seed.py::seed_ticket_categories).

Schema (per doc):
  id          str (uuid4 hex)
  key         str  (machine-stable; immutable for default categories)
  label       str  (display)
  description str  (admin notes; never shown to end-users)
  sort_order  int  (ascending)
  is_enabled  bool
  is_default  bool (true for the six built-ins; can be disabled but not deleted)
  created_at  iso
  updated_at  iso
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_support_access


router = APIRouter(tags=["support-categories"])


KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── User-facing (any logged-in user) ───────────────────────────────────
@router.get("/api/tickets/categories")
async def list_enabled_categories(current: CurrentUser):
    """Returns only enabled categories, ordered by `sort_order` ASC.
    Used by the in-app ticket creation form."""
    cursor = db.ticket_categories.find(
        {"is_enabled": True},
        {"_id": 0, "description": 0, "is_default": 0, "created_at": 0, "updated_at": 0},
    ).sort("sort_order", 1)
    return {"categories": [c async for c in cursor]}


# ─── Admin CRUD (founder + support_admin) ──────────────────────────────
@router.get("/api/admin/support/categories")
async def admin_list_categories(current: CurrentUser):
    require_support_access(current)
    cursor = db.ticket_categories.find({}, {"_id": 0}).sort("sort_order", 1)
    return {"categories": [c async for c in cursor]}


class CategoryCreate(BaseModel):
    key:         Optional[str] = Field(default=None, max_length=40)
    label:       str = Field(min_length=1, max_length=60)
    description: Optional[str] = Field(default=None, max_length=240)
    is_enabled:  bool = True
    sort_order:  Optional[int] = None


@router.post("/api/admin/support/categories")
async def admin_create_category(payload: CategoryCreate, current: CurrentUser):
    require_support_access(current)

    label = payload.label.strip()
    if not label:
        raise HTTPException(400, "label required")

    # Derive key from label if missing; ensure uniqueness.
    key = (payload.key or "").strip().lower() or re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    if not KEY_RE.match(key):
        raise HTTPException(400, "key must be lowercase, start with a letter, 2–40 chars")
    if await db.ticket_categories.find_one({"key": key}):
        raise HTTPException(409, "category key already exists")

    # Default sort_order = max+10 so new categories land at the bottom.
    if payload.sort_order is None:
        last = await db.ticket_categories.find_one({}, sort=[("sort_order", -1)])
        next_order = (last.get("sort_order") if last else 0) + 10
    else:
        next_order = int(payload.sort_order)

    now = _now()
    doc = {
        "id":          uuid.uuid4().hex,
        "key":         key,
        "label":       label,
        "description": (payload.description or "").strip()[:240],
        "sort_order":  next_order,
        "is_enabled":  bool(payload.is_enabled),
        "is_default":  False,
        "created_at":  now,
        "updated_at":  now,
    }
    await db.ticket_categories.insert_one(doc)
    doc.pop("_id", None)
    return {"category": doc}


class CategoryUpdate(BaseModel):
    label:       Optional[str] = Field(default=None, max_length=60)
    description: Optional[str] = Field(default=None, max_length=240)
    is_enabled:  Optional[bool] = None
    sort_order:  Optional[int] = None


@router.patch("/api/admin/support/categories/{cat_id}")
async def admin_update_category(cat_id: str, payload: CategoryUpdate, current: CurrentUser):
    require_support_access(current)
    cat = await db.ticket_categories.find_one({"id": cat_id})
    if not cat:
        raise HTTPException(404, "category not found")

    set_ops: dict = {"updated_at": _now()}
    if payload.label is not None:
        label = payload.label.strip()
        if not label:
            raise HTTPException(400, "label cannot be empty")
        set_ops["label"] = label[:60]
    if payload.description is not None:
        set_ops["description"] = payload.description.strip()[:240]
    if payload.is_enabled is not None:
        set_ops["is_enabled"] = bool(payload.is_enabled)
    if payload.sort_order is not None:
        set_ops["sort_order"] = int(payload.sort_order)

    await db.ticket_categories.update_one({"id": cat_id}, {"$set": set_ops})
    fresh = await db.ticket_categories.find_one({"id": cat_id}, {"_id": 0})
    return {"category": fresh}


@router.delete("/api/admin/support/categories/{cat_id}")
async def admin_delete_category(cat_id: str, current: CurrentUser):
    require_support_access(current)
    cat = await db.ticket_categories.find_one({"id": cat_id})
    if not cat:
        raise HTTPException(404, "category not found")
    # Default categories cannot be deleted — only disabled — so admins
    # can't accidentally erase the baseline list.
    if cat.get("is_default"):
        raise HTTPException(400, "default categories cannot be deleted; disable instead")
    await db.ticket_categories.delete_one({"id": cat_id})
    return {"ok": True, "deleted": cat_id}


class ReorderPayload(BaseModel):
    order: list[str] = Field(..., description="Ordered list of category ids")


@router.post("/api/admin/support/categories/reorder")
async def admin_reorder_categories(payload: ReorderPayload, current: CurrentUser):
    require_support_access(current)
    seen: set[str] = set()
    now = _now()
    for index, cat_id in enumerate(payload.order):
        if not isinstance(cat_id, str) or cat_id in seen:
            continue
        seen.add(cat_id)
        await db.ticket_categories.update_one(
            {"id": cat_id},
            {"$set": {"sort_order": (index + 1) * 10, "updated_at": now}},
        )
    return {"ok": True, "ordered": len(seen)}
