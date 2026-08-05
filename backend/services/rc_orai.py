"""ORAi — per-Center AI assistant (Phase 1: text chat).

Each Center gets its own AI context built from REAL data, filtered by the
requesting member's permissions. ORAi only suggests — it never performs
actions. Every conversation is stored (rc_orai_sessions / rc_orai_messages).
Reuses the platform OpenAI client (user key + Emergent fallback).
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from core.db import db
from services import responsibility_center as rc
from services.chat_conversations import call_openai_chat, pick_openai_model
from services.rc_units import _ctx

MAX_HISTORY = 20
POWER_TUNING = {"economy": (0.5, 350), "standard": (0.7, 650),
                "enhanced": (0.7, 1000), "high": (0.7, 1400)}


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def _center_context(user: dict, center, membership, perms: set) -> str:
    """Bounded, permission-filtered snapshot of the Center for the prompt."""
    cid = center["id"]
    now = datetime.now(timezone.utc)
    lines = [
        f"Center: {center['name']} (type: {center.get('center_type')}, status: {center.get('status', 'active')})",
        f"Requesting member: @{user.get('username')} (role: {membership.get('role')})",
    ]
    if center.get("description"):
        lines.append(f"Description: {center['description'][:200]}")

    # Universal Center Engine awareness — type, terminology, modules, creator tools
    try:
        from services.center_registry import get_center_config
        ucfg = await get_center_config(center)
        if not ucfg.get("legacy"):
            term = ucfg.get("terminology") or {}
            enabled = sorted(k for k, v in (ucfg.get("modules") or {}).items()
                             if v in ("enabled", "required"))
            lines.append(f"Center engine: {ucfg.get('type_label')} — members are called "
                         f"'{term.get('member')}s', work items '{term.get('work')}s', "
                         f"groups '{term.get('group')}s'.")
            lines.append(f"Enabled modules: {', '.join(enabled)}")
            if ucfg.get("creator_tools"):
                lines.append(f"Creator tools available: {', '.join(ucfg['creator_tools'])} "
                             "(each inherits AI Power and Creation Depth controls)")
    except Exception:
        pass

    if "view_vault" in perms:
        lines.append(f"Fire Power Vault: {int(center.get('vault_balance') or 0)} 🔥 "
                     "(engagement resource only — never money)")

    if "view_items" in perms:
        manage = "assign_items" in perms or "edit_center" in perms
        q = {"center_id": cid, "is_series": {"$ne": True},
             "status": {"$nin": ["canceled", "archived", "declined", "completed", "approved"]}}
        if not manage:
            q["assignee_ids"] = user["id"]
        items = await db.responsibility_items.find(
            q, {"_id": 0, "title": 1, "item_type": 1, "status": 1, "due_at": 1,
                "category": 1, "priority": 1}).sort("due_at", 1).to_list(25)
        overdue = [i for i in items if i.get("due_at") and i["due_at"] < now.isoformat()]
        scope = "all open work" if manage else "your open work"
        lines.append(f"Open items ({scope}): {len(items)}; overdue: {len(overdue)}")
        for i in items[:12]:
            lines.append(f"  - [{i.get('item_type')}] {i['title']} · {i.get('category') or 'general'} "
                         f"· {i['status']} · due {i.get('due_at') or 'no date'}")

    if "view_calendar" in perms:
        evs = await db.responsibility_center_calendar_events.find(
            {"center_id": cid, "status": {"$ne": "canceled"},
             "start_at": {"$gte": now.isoformat(),
                          "$lt": (now + timedelta(days=14)).isoformat()}},
            {"_id": 0, "title": 1, "start_at": 1, "event_type": 1}).sort("start_at", 1).to_list(8)
        if evs:
            lines.append("Upcoming events (14 days):")
            for e in evs:
                lines.append(f"  - {e['title']} · {e['start_at'][:16]}")

    if "view_activity" in perms:
        acts = await db.responsibility_center_activity_logs.find(
            {"center_id": cid}, {"_id": 0, "detail": 1, "created_at": 1}
        ).sort("created_at", -1).to_list(6)
        if acts:
            lines.append("Recent activity:")
            for a in acts:
                lines.append(f"  - {a['detail'][:120]}")

    members_n = await db.responsibility_center_memberships.count_documents(
        {"center_id": cid, "status": "active"})
    lines.append(f"Active members: {members_n}")

    if center.get("center_type") == "education":
        edu = (membership.get("education") or {})
        if edu:
            lines.append(f"My learning settings: stage {edu.get('stage')}, level {edu.get('grade_level')}, "
                         f"AI power {edu.get('ai_power_level', 'economy')}")
    return "\n".join(lines)[:6000]


def _system_prompt(center, context: str, memory: str = "", safety_rules: str = "") -> str:
    extra = ""
    if memory:
        extra += f"\n\n{memory}"
    if safety_rules:
        extra += f"\n\nADMIN SAFETY RULES (must follow):\n{safety_rules[:2000]}"
    return f"""You are ORAi, the built-in assistant for the "{center['name']}" Responsibility Center on OurRealm.

STRICT RULES:
- You SUGGEST — you never perform actions. When the user wants something done, explain exactly where to do it (which tab/button) and offer a plan they can approve.
- Never take or describe destructive actions as done.
- Fire Power is an internal engagement resource. NEVER call it money, currency, payment, price, or an investment, and never suggest it has cash value.
- Never make medical, legal, financial, or accreditation claims. Records here are informal organizational records, not official documents.
- Be concise, warm, and practical. Use short paragraphs or tight lists.
- Only discuss data from THIS Center's context below. If asked about data you don't see, say the member may lack permission or it doesn't exist.

CURRENT CENTER CONTEXT (real data, permission-filtered):
{context}{extra}"""


async def _memory_ctx(center_id: str) -> str:
    try:
        from routers.rc_intelligence import build_memory_context
        from routers.admin_orai import get_orai_config
        cfg = await get_orai_config()
        if not cfg.get("memory_enabled_global", True):
            return ""
        return await build_memory_context(center_id)
    except Exception:
        return ""


async def _safety_rules() -> str:
    try:
        from routers.admin_orai import get_orai_config
        return (await get_orai_config()).get("safety_rules") or ""
    except Exception:
        return ""


async def chat(user: dict, center_id: str, body: dict) -> dict:
    from routers.rc_routines import check_feature_access
    await check_feature_access(center_id, user["id"], "orai")
    center, membership, perms = await _ctx(center_id, user, "view_items", write=False)
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Say something first")
    if len(message) > 4000:
        raise HTTPException(status_code=400, detail="Message is too long")

    sid = body.get("session_id")
    session = None
    if sid:
        session = await db.rc_orai_sessions.find_one(
            {"id": sid, "center_id": center_id, "user_id": user["id"]}, {"_id": 0})
    if not session:
        session = {"id": uuid.uuid4().hex, "center_id": center_id, "user_id": user["id"],
                   "title": message[:60], "created_at": _iso(), "updated_at": _iso()}
        await db.rc_orai_sessions.insert_one({**session})
        await rc.log_activity(center_id, user, "orai_session_started",
                              f"@{user.get('username')} started an ORAi conversation")
    sid = session["id"]

    history = await db.rc_orai_messages.find(
        {"session_id": sid}, {"_id": 0, "role": 1, "content": 1}
    ).sort("created_at", 1).to_list(200)
    history = history[-MAX_HISTORY:]

    context = await _center_context(user, center, membership, perms)
    power = ((membership.get("education") or {}).get("ai_power_level")
             if center.get("center_type") == "education" else None) or "standard"
    temperature, max_tokens = POWER_TUNING.get(power, POWER_TUNING["standard"])
    model = pick_openai_model(None, message) if power in ("enhanced", "high") else None

    messages = ([{"role": "system", "content": _system_prompt(
        center, context, memory=await _memory_ctx(center_id),
        safety_rules=await _safety_rules())}]
                + history + [{"role": "user", "content": message}])
    result = await call_openai_chat(messages, model=model,
                                    temperature=temperature, max_tokens=max_tokens)
    reply = (result.get("content") or "").strip() or \
        "I couldn't produce a reply just now — please try again."

    now = _iso()
    await db.rc_orai_messages.insert_many([
        {"id": uuid.uuid4().hex, "session_id": sid, "center_id": center_id,
         "user_id": user["id"], "role": "user", "content": message, "created_at": now},
        {"id": uuid.uuid4().hex, "session_id": sid, "center_id": center_id,
         "user_id": user["id"], "role": "assistant", "content": reply,
         "model": result.get("model"), "created_at": _iso()},
    ])
    await db.rc_orai_sessions.update_one({"id": sid}, {"$set": {"updated_at": _iso()}})
    return {"session_id": sid, "reply": reply, "model": result.get("model"),
            "power_level": power}


async def sessions(user: dict, center_id: str) -> dict:
    await _ctx(center_id, user, "view_items", write=False)
    rows = await db.rc_orai_sessions.find(
        {"center_id": center_id, "user_id": user["id"]},
        {"_id": 0}).sort("updated_at", -1).to_list(30)
    return {"sessions": rows}


async def messages(user: dict, center_id: str, session_id: str) -> dict:
    await _ctx(center_id, user, "view_items", write=False)
    s = await db.rc_orai_sessions.find_one(
        {"id": session_id, "center_id": center_id, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Conversation not found")
    rows = await db.rc_orai_messages.find(
        {"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(300)
    return {"session": s, "messages": rows}


async def delete_session(user: dict, center_id: str, session_id: str) -> dict:
    await _ctx(center_id, user, "view_items", write=False)
    r = await db.rc_orai_sessions.delete_one(
        {"id": session_id, "center_id": center_id, "user_id": user["id"]})
    if r.deleted_count != 1:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.rc_orai_messages.delete_many({"session_id": session_id})
    return {"ok": True}
