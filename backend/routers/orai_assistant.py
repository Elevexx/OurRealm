"""ORAi Operating Assistant API — /api/orai/assistant/*.

Global, page-aware ORAi chat with live platform data (admins), center
context reuse (services.rc_orai), and permission-validated smart action
buttons. Sessions persisted in orai_assistant_messages.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser
from core.permissions import get_admin_role
from services.chat_conversations import call_openai_chat
from services import orai_platform as op
from utils.sliding_window_rate_limit import rate_limit

log = logging.getLogger("ourrealm.orai.assistant")

router = APIRouter(prefix="/api/orai/assistant", tags=["orai-assistant"])


def _iso():
    return datetime.now(timezone.utc).isoformat()


class AssistantContext(BaseModel):
    path: Optional[str] = None
    center_id: Optional[str] = None
    course_id: Optional[str] = None
    lesson_id: Optional[str] = None
    selected_member_ids: Optional[list] = None
    widget_id: Optional[str] = None
    theme: Optional[str] = None
    device: Optional[str] = None
    filters: Optional[dict] = None


class ChatBody(BaseModel):
    message: str
    session_id: Optional[str] = None
    context: Optional[AssistantContext] = None


SYSTEM_TMPL = """You are ORAi, OurRealm's built-in AI Operating Assistant. You are integrated
with the live platform and can see real, permission-filtered data below.

RULES:
- Answer questions about platform data using the LIVE snapshot when present — never claim you
  "cannot access platform information" if the data is in your context.
- If data is NOT in your context, the user likely lacks permission — say so politely.
- You can offer ACTIONS. To offer one, include its marker inline, e.g. [[action:open_analytics]].
  ONLY use markers from the AVAILABLE ACTIONS list. Markers become clickable buttons.
- Suggest 1-3 relevant action buttons when they help. Never invent action ids.
- Destructive/irreversible operations: explain, offer the navigation action, let the human do it.
- Fire Power is an internal engagement resource — NEVER money/currency/payment.
- No medical, legal, financial or accreditation claims.
- Be concise, warm and practical.

CURRENT USER: @{username} (platform role: {role}; account: {age_class})
CURRENT PAGE: {page} (path: {path}; device: {device}; theme: {theme})
{extra_ctx}

AVAILABLE ACTIONS (id — label):
{actions_list}
"""


@router.post("/chat")
async def assistant_chat(body: ChatBody, user: CurrentUser):
    rl = await rate_limit(f"orai-assist:{user['id']}", max_requests=60, window_seconds=3600)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail="ORAi is taking a short break — try again in a minute")
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Say something first")
    if len(message) > 4000:
        raise HTTPException(status_code=400, detail="Message too long")
    ctx = body.context or AssistantContext()
    session_id = body.session_id or uuid.uuid4().hex

    extra = []
    # Live platform snapshot — admins only (permission-gated inside).
    snap = await op.platform_snapshot(user)
    if snap:
        extra.append(snap)
    # Center context — reuse the existing per-Center ORAi builder.
    if ctx.center_id:
        try:
            from services.rc_units import _ctx as rc_ctx
            from services.rc_orai import _center_context
            center, membership, perms = await rc_ctx(ctx.center_id, user, "view_items", write=False)
            extra.append("CURRENT CENTER CONTEXT:\n" + await _center_context(user, center, membership, perms))
        except Exception:
            pass
    if ctx.course_id:
        try:
            c = await db.rc_courses.find_one({"id": ctx.course_id}, {"_id": 0, "title": 1, "grade_level": 1, "subject": 1})
            if c:
                extra.append(f"CURRENT COURSE: {c['title']} ({c.get('subject')}, level {c.get('grade_level') or 'all'})")
        except Exception:
            pass
    if ctx.lesson_id:
        try:
            l = await db.rc_course_lessons.find_one({"id": ctx.lesson_id}, {"_id": 0, "title": 1, "lesson_type": 1})
            if l:
                extra.append(f"CURRENT LESSON: {l['title']} ({l.get('lesson_type')})")
        except Exception:
            pass
    if ctx.selected_member_ids:
        extra.append(f"SELECTED MEMBERS: {len(ctx.selected_member_ids)} member(s) selected")

    allowed = op.allowed_actions(user, ctx.center_id)
    actions_list = "\n".join(f"- {aid} — {a['label']}" for aid, a in allowed.items())
    system = SYSTEM_TMPL.format(
        username=user.get("username"), role=get_admin_role(user) or "member",
        age_class=user.get("age_class") or "adult",
        page=op.page_name(ctx.path), path=ctx.path or "?",
        device=ctx.device or "?", theme=ctx.theme or "?",
        extra_ctx="\n\n".join(extra)[:9000], actions_list=actions_list)

    history = await db.orai_assistant_messages.find(
        {"session_id": session_id, "user_id": user["id"]},
        {"_id": 0, "role": 1, "content": 1}).sort("created_at", 1).to_list(30)
    messages = ([{"role": "system", "content": system}]
                + history[-14:] + [{"role": "user", "content": message}])
    result = await call_openai_chat(messages, temperature=0.6, max_tokens=900)
    raw = (result.get("content") or "").strip() or "Let's try that again."
    reply, actions = op.extract_actions(raw, allowed)

    now = _iso()
    await db.orai_assistant_messages.insert_many([
        {"id": uuid.uuid4().hex, "session_id": session_id, "user_id": user["id"],
         "role": "user", "content": message, "created_at": now},
        {"id": uuid.uuid4().hex, "session_id": session_id, "user_id": user["id"],
         "role": "assistant", "content": reply, "actions": actions, "created_at": now},
    ])
    return {"session_id": session_id, "reply": reply, "actions": actions}


@router.get("/history")
async def assistant_history(session_id: str, user: CurrentUser):
    rows = await db.orai_assistant_messages.find(
        {"session_id": session_id, "user_id": user["id"]},
        {"_id": 0}).sort("created_at", 1).to_list(60)
    return {"messages": rows}
