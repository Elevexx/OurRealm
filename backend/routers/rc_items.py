"""Responsibility Center — Responsibilities & Tasks endpoints (Bundle C).

All routes Center-scoped + backend permission enforced in
services/rc_items.py. /my-work is cross-Center (registered in this
router, which is included BEFORE the /{center_id} catch-all router).
"""
from typing import Optional, List

from fastapi import APIRouter
from pydantic import BaseModel, Field

from core.deps import CurrentUser
from services import rc_items

router = APIRouter(prefix="/api/responsibility-center", tags=["responsibility-center-items"])


@router.get("/my-work")
async def rc_my_work(current: CurrentUser):
    return await rc_items.my_work(current)


class ItemCreateBody(BaseModel):
    title: str = Field(..., max_length=200)
    description: str = Field("", max_length=4000)
    item_type: str = "task"
    priority: str = "normal"
    visibility: Optional[str] = None
    assignee_ids: List[str] = []
    reviewer_id: Optional[str] = None
    approver_id: Optional[str] = None
    approval_required: bool = False
    start_at: Optional[str] = None
    due_at: Optional[str] = None
    estimated_minutes: int = 0
    difficulty: Optional[str] = None
    category: Optional[str] = None
    labels: List[str] = []
    checklist: List[str] = []
    progress_method: Optional[str] = None
    parent_id: Optional[str] = None
    depends_on: List[str] = []
    draft: bool = False
    recurrence: Optional[dict] = None
    client_token: Optional[str] = None


@router.post("/{center_id}/items")
async def rc_item_create(center_id: str, body: ItemCreateBody, current: CurrentUser):
    payload = body.model_dump()
    if body.visibility is None:
        payload.pop("visibility")
    return await rc_items.create_item(current, center_id, payload)


@router.get("/{center_id}/items")
async def rc_item_list(center_id: str, current: CurrentUser, q: str = "",
                       item_type: str = "", status: str = "", scope: str = "",
                       priority: str = "", assignee: str = "", creator: str = "",
                       recurring: str = "", category: str = "", label: str = "",
                       due_from: str = "", due_to: str = "", sort: str = "due",
                       page: int = 1, limit: int = 25):
    return await rc_items.list_items(current, center_id, q, item_type, status,
                                     scope, priority, assignee, creator,
                                     recurring, category, label, due_from,
                                     due_to, sort, page, limit)


@router.get("/{center_id}/items-summary")
async def rc_item_summary(center_id: str, current: CurrentUser):
    return await rc_items.work_summary(current, center_id)


@router.get("/{center_id}/items/{item_id}")
async def rc_item_detail(center_id: str, item_id: str, current: CurrentUser):
    return await rc_items.item_detail(current, center_id, item_id)


class ItemUpdateBody(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    visibility: Optional[str] = None
    category: Optional[str] = None
    labels: Optional[List[str]] = None
    start_at: Optional[str] = None
    due_at: Optional[str] = None
    approval_required: Optional[bool] = None
    progress_method: Optional[str] = None
    depends_on: Optional[List[str]] = None
    expected_version: Optional[int] = None


@router.patch("/{center_id}/items/{item_id}")
async def rc_item_update(center_id: str, item_id: str, body: ItemUpdateBody, current: CurrentUser):
    return await rc_items.update_item(current, center_id, item_id,
                                      body.model_dump(exclude_unset=True))


class AssignBody(BaseModel):
    assignee_ids: List[str]
    reviewer_id: Optional[str] = None
    approver_id: Optional[str] = None


@router.post("/{center_id}/items/{item_id}/assign")
async def rc_item_assign(center_id: str, item_id: str, body: AssignBody, current: CurrentUser):
    return await rc_items.assign_item(current, center_id, item_id,
                                      body.assignee_ids, body.reviewer_id, body.approver_id)


class ActionBody(BaseModel):
    note: str = Field("", max_length=500)


@router.post("/{center_id}/items/{item_id}/actions/{action}")
async def rc_item_action(center_id: str, item_id: str, action: str,
                         current: CurrentUser, body: Optional[ActionBody] = None):
    return await rc_items.transition(current, center_id, item_id, action,
                                     (body.note if body else "") or "")


class ApprovalBody(BaseModel):
    decision: str
    note: str = Field("", max_length=500)


@router.post("/{center_id}/items/{item_id}/approval")
async def rc_item_approval(center_id: str, item_id: str, body: ApprovalBody, current: CurrentUser):
    return await rc_items.decide_approval(current, center_id, item_id,
                                          body.decision, body.note)


class ChecklistBody(BaseModel):
    op: str
    entry_id: Optional[str] = None
    title: str = ""
    completed: Optional[bool] = None


@router.post("/{center_id}/items/{item_id}/checklist")
async def rc_item_checklist(center_id: str, item_id: str, body: ChecklistBody, current: CurrentUser):
    return await rc_items.checklist_op(current, center_id, item_id, body.op,
                                       body.entry_id, body.title, body.completed)


class ProgressBody(BaseModel):
    percent: int


@router.post("/{center_id}/items/{item_id}/progress")
async def rc_item_progress(center_id: str, item_id: str, body: ProgressBody, current: CurrentUser):
    return await rc_items.set_progress(current, center_id, item_id, body.percent)


class CommentBody(BaseModel):
    body: str = Field(..., max_length=2000)
    parent_id: Optional[str] = None


@router.post("/{center_id}/items/{item_id}/comments")
async def rc_item_comment(center_id: str, item_id: str, body: CommentBody, current: CurrentUser):
    return await rc_items.add_comment(current, center_id, item_id, body.body, body.parent_id)


@router.delete("/{center_id}/items/{item_id}/comments/{comment_id}")
async def rc_item_comment_delete(center_id: str, item_id: str, comment_id: str, current: CurrentUser):
    return await rc_items.delete_comment(current, center_id, item_id, comment_id)


class AttachmentBody(BaseModel):
    url: str
    name: str = ""
    attachment_type: str = "file"


@router.post("/{center_id}/items/{item_id}/attachments")
async def rc_item_attach(center_id: str, item_id: str, body: AttachmentBody, current: CurrentUser):
    return await rc_items.add_attachment(current, center_id, item_id, body.url,
                                         body.name, body.attachment_type)


@router.delete("/{center_id}/items/{item_id}/attachments/{attachment_id}")
async def rc_item_attach_delete(center_id: str, item_id: str, attachment_id: str, current: CurrentUser):
    return await rc_items.remove_attachment(current, center_id, item_id, attachment_id)


class SeriesUpdateBody(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    recurrence: Optional[dict] = None
    anchor_due_at: Optional[str] = None
    scope: str = "future"


@router.patch("/{center_id}/items/{item_id}/series")
async def rc_series_update(center_id: str, item_id: str, body: SeriesUpdateBody, current: CurrentUser):
    payload = body.model_dump(exclude_unset=True)
    scope = payload.pop("scope", "future")
    return await rc_items.update_series(current, center_id, item_id, payload, scope)


@router.post("/{center_id}/items/{item_id}/series/{action}")
async def rc_series_action(center_id: str, item_id: str, action: str, current: CurrentUser):
    return await rc_items.series_action(current, center_id, item_id, action)
