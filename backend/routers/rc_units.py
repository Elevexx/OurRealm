"""Responsibility Center — Bundle E endpoints: units, calendar, digest."""
from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from core.deps import CurrentUser
from services import rc_units, rc_calendar

router = APIRouter(prefix="/api/responsibility-center", tags=["responsibility-center-units-calendar"])


@router.get("/digest-settings")
async def digest_get(current: CurrentUser):
    return await rc_calendar.get_digest_settings(current)


@router.patch("/digest-settings")
async def digest_patch(body: dict, current: CurrentUser):
    return await rc_calendar.update_digest_settings(current, body or {})


@router.get("/digest/latest")
async def digest_latest(current: CurrentUser):
    return await rc_calendar.get_latest_digest(current)


class UnitBody(BaseModel):
    name: str
    unit_type: str = "group"
    description: str = ""
    parent_id: Optional[str] = None
    leader_id: Optional[str] = None
    member_ids: List[str] = []
    visibility: str = "center"
    color: Optional[str] = None
    client_token: Optional[str] = None


@router.post("/{center_id}/units")
async def unit_create(center_id: str, body: UnitBody, current: CurrentUser):
    return await rc_units.create_unit(current, center_id, body.model_dump())


@router.get("/{center_id}/units")
async def unit_list(center_id: str, current: CurrentUser, include_archived: bool = False):
    return await rc_units.list_units(current, center_id, include_archived)


@router.get("/{center_id}/units/{unit_id}")
async def unit_get(center_id: str, unit_id: str, current: CurrentUser):
    return await rc_units.unit_detail(current, center_id, unit_id)


@router.patch("/{center_id}/units/{unit_id}")
async def unit_patch(center_id: str, unit_id: str, body: dict, current: CurrentUser):
    return await rc_units.update_unit(current, center_id, unit_id, body or {})


class UnitMemberBody(BaseModel):
    user_id: str
    unit_role: str = "member"


@router.post("/{center_id}/units/{unit_id}/members")
async def unit_member_add(center_id: str, unit_id: str, body: UnitMemberBody, current: CurrentUser):
    return await rc_units.add_unit_member(current, center_id, unit_id, body.user_id, body.unit_role)


@router.delete("/{center_id}/units/{unit_id}/members/{user_id}")
async def unit_member_remove(center_id: str, unit_id: str, user_id: str, current: CurrentUser):
    return await rc_units.remove_unit_member(current, center_id, unit_id, user_id)


class UnitWorkBody(BaseModel):
    title: str
    description: str = ""
    item_type: str = "task"
    priority: str = "normal"
    due_at: Optional[str] = None
    checklist: List[str] = []
    approval_required: bool = False
    approver_id: Optional[str] = None
    mode: str = "shared"
    client_token: Optional[str] = None


@router.post("/{center_id}/units/{unit_id}/assign-work")
async def unit_assign_work(center_id: str, unit_id: str, body: UnitWorkBody, current: CurrentUser):
    return await rc_units.assign_work_to_unit(current, center_id, unit_id, body.model_dump())


class ConvertBody(BaseModel):
    mode: str = "personal"
    assignee_ids: List[str] = []
    unit_id: Optional[str] = None
    unit_mode: str = "individual"
    title: Optional[str] = None
    due_at: Optional[str] = None
    approval_required: bool = False
    approver_id: Optional[str] = None


@router.post("/{center_id}/items/{item_id}/convert")
async def convert_self_task(center_id: str, item_id: str, body: ConvertBody, current: CurrentUser):
    return await rc_units.convert_self_task(current, center_id, item_id, body.model_dump())


class EventBody(BaseModel):
    title: str
    event_type: str = "event"
    description: str = ""
    start_at: str
    end_at: Optional[str] = None
    all_day: bool = False
    location: str = ""
    virtual_link: Optional[str] = None
    unit_id: Optional[str] = None
    visibility: str = "center"
    attendee_ids: List[str] = []
    attendance_enabled: bool = False
    reminders: Optional[List[int]] = None
    recurrence: Optional[dict] = None
    related_item_id: Optional[str] = None
    override_conflicts: bool = False
    client_token: Optional[str] = None


@router.post("/{center_id}/events")
async def event_create(center_id: str, body: EventBody, current: CurrentUser):
    return await rc_calendar.create_event(current, center_id, body.model_dump())


@router.get("/{center_id}/calendar")
async def calendar_feed(center_id: str, date_from: str, date_to: str, current: CurrentUser,
                        unit_id: str = "", event_type: str = "", scope: str = "",
                        member_id: str = ""):
    return await rc_calendar.calendar_feed(current, center_id, date_from, date_to,
                                           unit_id, event_type, scope, member_id)


@router.get("/{center_id}/events/{event_id}")
async def event_get(center_id: str, event_id: str, current: CurrentUser):
    return await rc_calendar.event_detail(current, center_id, event_id)


@router.patch("/{center_id}/events/{event_id}")
async def event_patch(center_id: str, event_id: str, body: dict, current: CurrentUser):
    return await rc_calendar.update_event(current, center_id, event_id, body or {})


class CancelBody(BaseModel):
    scope: str = "occurrence"


@router.post("/{center_id}/events/{event_id}/cancel")
async def event_cancel(center_id: str, event_id: str, current: CurrentUser,
                       body: Optional[CancelBody] = None):
    return await rc_calendar.cancel_event(current, center_id, event_id,
                                          (body.scope if body else "occurrence"))


class RsvpBody(BaseModel):
    response: str


@router.post("/{center_id}/events/{event_id}/rsvp")
async def event_rsvp(center_id: str, event_id: str, body: RsvpBody, current: CurrentUser):
    return await rc_calendar.rsvp(current, center_id, event_id, body.response)


class AttendanceBody(BaseModel):
    marks: List[dict] = Field(..., max_length=100)


@router.post("/{center_id}/events/{event_id}/attendance")
async def event_attendance(center_id: str, event_id: str, body: AttendanceBody, current: CurrentUser):
    return await rc_calendar.mark_attendance(current, center_id, event_id, body.marks)

