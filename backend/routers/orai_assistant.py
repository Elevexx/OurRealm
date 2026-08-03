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
from core.permissions import get_admin_role, require_founder
from services.chat_conversations import call_openai_chat
from services import orai_platform as op
from services.orai_access import get_orai_access, require_orai_access, orai_audit
from utils.sliding_window_rate_limit import rate_limit

log = logging.getLogger("ourrealm.orai.assistant")

router = APIRouter(prefix="/api/orai/assistant", tags=["orai-assistant"])
access_admin = APIRouter(prefix="/api/admin/orai", tags=["orai-access-admin"])


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


@router.get("/access")
async def assistant_access(user: CurrentUser):
    """UI gate for the floating button. Unauthorized users learn nothing."""
    access = await get_orai_access(user)
    if not access:
        return {"allowed": False}
    caps = await _capability_limits(user, access)
    return {"allowed": True, "is_founder": bool(access.get("founder")),
            "chat_enabled": bool(access.get("chat_enabled")),
            "voice_enabled": bool(access.get("voice_enabled")),
            "generation_enabled": bool(access.get("generation_enabled")),
            "limits": caps}


async def _capability_limits(user, access) -> list:
    """Human-readable list of things ORAi must NOT offer this user."""
    limits = []
    if not access.get("generation_enabled"):
        limits.append("AI generation features (courses, images, videos) are disabled for this user")
    else:
        try:
            from services.video_generation import get_video_settings
            vs = await get_video_settings()
            if not vs["enabled"] or vs["emergency_disabled"]:
                limits.append("AI video generation is currently turned off platform-wide")
        except Exception:  # noqa: BLE001
            pass
    if not access.get("voice_enabled"):
        limits.append("Voice Mode is disabled for this user")
    if not access.get("founder"):
        limits.append("No founder/admin tools — never offer admin pages, budgets or platform controls")
    return limits


@router.post("/log-shortcut")
async def log_shortcut(body: dict, user: CurrentUser):
    require_founder(user)
    await orai_audit(user, "founder_shortcut_used", detail=str(body.get("id") or "")[:80])
    return {"ok": True}


@router.post("/chat")
async def assistant_chat(body: ChatBody, user: CurrentUser):
    access = await require_orai_access(user, "chat")
    from services.access_policy import require_access
    await require_access("orai_assistant", user, consume=True)
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
    limits = await _capability_limits(user, access)
    if limits:
        extra.append("THIS USER CANNOT USE (never offer or suggest these):\n- " + "\n- ".join(limits))

    # ── ORAi Education Engine: natural-language learning-plan commands ────
    edu_card = None
    low = message.lower()
    if (access.get("generation_enabled")
            and any(k in low for k in ("lesson", "curriculum", "learning plan"))
            and any(k in low for k in ("create", "generate", "plan", "schedule", "make", "build", "set up"))):
        center_id = ctx.center_id
        if not center_id:
            c = await db.responsibility_centers.find_one(
                {"created_by": user["id"], "center_type": {"$in": ["education", "family"]}},
                {"_id": 0, "id": 1}, sort=[("created_at", -1)])
            center_id = (c or {}).get("id")
        if center_id:
            try:
                from services.rc_units import _ctx as rc_ctx2
                await rc_ctx2(center_id, user, "edit_center")
                from services import education_plans as ep
                plan = await ep.draft_plan(center_id, message, user)
                est = plan["estimates"]
                lines = [
                    f"{len(plan['students'])} student(s): " + (", ".join("@" + s["username"] for s in plan["students"]) or "none found"),
                    f"{est['learning_days']} learning days · ~{est['lessons_total']} lessons ({plan['mode']})",
                    f"Daily generation at {plan['schedule']['generation_time']} ({plan['schedule']['timezone']})",
                    f"Estimated usage: ~${est['est_daily_cost']}/day · ~${est['est_total_cost']} total",
                ]
                if plan["missing_info"]:
                    lines.append("⚠ Missing: " + "; ".join(plan["missing_info"][:3]))
                edu_card = {
                    "type": "education_plan", "plan_id": plan["id"],
                    "title": "LEARNING PLAN READY" if not plan["missing_info"] else "LEARNING PLAN NEEDS DETAILS",
                    "lines": lines,
                    "button": {"label": "PREVIEW & APPROVE",
                               "to": f"/responsibility-center/{center_id}/edu-plans?plan={plan['id']}"}}
                extra.append(
                    f"YOU (ORAi) JUST DRAFTED LEARNING PLAN \"{plan['title']}\" (id {plan['id']}) from this request. "
                    f"It is now PENDING APPROVAL — a result card with a PREVIEW & APPROVE button is attached to your reply. "
                    f"Briefly summarize the plan (students, days, schedule, estimated usage"
                    + (", and clearly list the missing info they must complete" if plan["missing_info"] else "")
                    + "). Nothing generates until they approve. Do NOT include action markers for this.")
                await orai_audit(user, "education_plan_drafted", detail=plan["id"])
            except Exception as e:  # noqa: BLE001
                extra.append(f"NOTE: You tried to draft a learning plan but it failed: {str(e)[:200]}. "
                             "Apologize briefly and suggest they try again or open the Education Automation page.")

    # ── ORAi Game Creator: "create a game..." (founder-gated by policy) ───
    if (edu_card is None and access.get("generation_enabled")
            and "game" in low
            and any(k in low for k in ("create", "build", "make", "turn", "design"))):
        try:
            require_founder(user)
            from services.access_policy import require_access as _ra
            await _ra("game_creator", user, consume=False)
            from services import game_studio as gsvc
            import re as _rec
            course_ctx = None
            if ctx.lesson_id or ctx.course_id:
                course_ctx = {"course_id": ctx.course_id, "lesson_id": ctx.lesson_id, "center_id": ctx.center_id}
            m_c = _rec.search(r"complexity\s*[:\-]?\s*(\d+)", low)
            m_p = _rec.search(r"(?:ai\s*)?power\s*[:\-]?\s*(\d+)", low)
            est = await gsvc.create_estimate(
                {"request": message, "complexity": int(m_c.group(1)) if m_c else 2,
                 "ai_power": int(m_p.group(1)) if m_p else 5, "course_context": course_ctx}, user)
            plan_g = est["plan"]
            card_lines = [
                f"{plan_g.get('title')} — {plan_g.get('gameplay_summary', plan_g.get('concept', ''))[:140]}",
                f"Runtime: {plan_g.get('runtime_label') or plan_g.get('runtime')} · Complexity {est['complexity']} · AI Power {est['ai_power']} ({est['tier']['label']})",
                f"{plan_g.get('stages')} stages · ~{plan_g.get('est_play_minutes')} min play · Mechanics: {', '.join((plan_g.get('mechanics') or [])[:5])}",
            ]
            for s in (plan_g.get("substitutions") or [])[:2]:
                card_lines.append(f"⚠ {s}")
            card_lines += [
                f"Estimated cost: ~${est['estimates']['provider_cost']} · ~{est['estimates']['generation_time_min']} min build",
                "Nothing builds until you approve it in Game Studio.",
            ]
            edu_card = {
                "type": "game_estimate", "estimate_id": est["id"],
                "title": "GAME PLAN READY — APPROVAL REQUIRED",
                "lines": card_lines,
                "button": {"label": "PREVIEW BUILD", "to": f"/admin/games?estimate={est['id']}"}}
            extra.append(
                f"YOU (ORAi) JUST CREATED A GAME BUILD ESTIMATE \"{plan_g.get('title')}\" — it requires approval "
                "in the Game Studio before anything is built (a PREVIEW BUILD card is attached). Summarize the "
                "concept and estimated cost briefly. Do NOT include action markers for this.")
            await orai_audit(user, "game_estimate_from_chat", detail=est["id"])
        except HTTPException:
            pass
        except Exception as e:  # noqa: BLE001
            extra.append(f"NOTE: Game estimate failed: {str(e)[:150]}. Apologize briefly.")

    # ── ORAi Preview Builder: founder-only bridge to the internal build workflow ──
    import re as _re
    if (edu_card is None and access.get("founder")
            and "game" not in low
            and any(k in low for k in ("build", "create", "make", "design"))
            and _re.search(r"\b(page|preview|component|ui|banner|section|styling|style|layout|faq)\b", low)):
        try:
            require_founder(user)
            from routers.orai_builds import draft_build
            req = await draft_build(message, user)
            edu_card = {
                "type": "preview_build", "build_id": req["id"],
                "title": "PREVIEW BUILD READY — APPROVAL REQUIRED",
                "lines": [
                    req["title"],
                    req["summary"][:220],
                    "Sandboxed admin-only preview — cannot touch production, the database, auth, billing or secrets.",
                    "Nothing is built until you press Approve and Build Preview.",
                ],
                "build": {"id": req["id"], "title": req["title"], "build_prompt": req["build_prompt"]},
            }
            extra.append(
                f"YOU (ORAi) JUST DRAFTED PREVIEW BUILD REQUEST \"{req['title']}\" — an approval card with an "
                "'Approve and Build Preview' button is attached to your reply. Briefly summarize what will be built "
                "and that it lands on an admin-only preview route. Nothing is built until they approve. "
                "Do NOT include action markers for this.")
            await orai_audit(user, "preview_build_drafted_from_chat", detail=req["id"])
        except ValueError as e:
            extra.append(f"NOTE: You tried to draft a preview build but it was BLOCKED because {e}. "
                         "Explain this restriction briefly and politely.")
        except HTTPException:
            pass
        except Exception as e:  # noqa: BLE001
            extra.append(f"NOTE: Preview build draft failed: {str(e)[:150]}. Apologize briefly.")

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
    if not history:
        await orai_audit(user, "chat_session_started", detail=f"session={session_id[:12]}")
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
         "role": "assistant", "content": reply, "actions": actions, "card": edu_card, "created_at": now},
    ])
    return {"session_id": session_id, "reply": reply, "actions": actions, "card": edu_card}


@router.get("/history")
async def assistant_history(session_id: str, user: CurrentUser):
    await require_orai_access(user, "chat")
    rows = await db.orai_assistant_messages.find(
        {"session_id": session_id, "user_id": user["id"]},
        {"_id": 0}).sort("created_at", 1).to_list(60)
    return {"messages": rows}


# ─── Founder admin: Private ORAi Access manager + AI Usage dashboard ────
@access_admin.get("/private-access")
async def access_list(current: CurrentUser, q: str = "", status: str = ""):
    require_founder(current)
    query = {}
    if q:
        query["username"] = {"$regex": q[:60], "$options": "i"}
    rows = await db.orai_private_access.find(
        query, {"_id": 0}).sort("granted_at", -1).to_list(500)
    now = _iso()
    for r in rows:
        r["active"] = not (r.get("expires_at") and r["expires_at"] < now)
    if status == "active":
        rows = [r for r in rows if r["active"]]
    elif status == "expired":
        rows = [r for r in rows if not r["active"]]
    await orai_audit(current, "private_access_viewed")
    return {"users": rows}


@access_admin.post("/private-access")
async def access_add(body: dict, current: CurrentUser):
    require_founder(current)
    username = (body.get("username") or "").strip().lstrip("@")
    if not username:
        raise HTTPException(status_code=400, detail="Username required")
    target = await db.users.find_one({"username": username}, {"_id": 0, "id": 1, "username": 1})
    if not target:
        raise HTTPException(status_code=404, detail="No user with that username")
    expires_at = (body.get("expires_at") or "").strip() or None
    doc = {
        "id": uuid.uuid4().hex, "user_id": target["id"], "username": target["username"],
        "granted_by": current["id"], "granted_by_username": current.get("username"),
        "granted_at": _iso(), "note": str(body.get("note") or "")[:300],
        "expires_at": expires_at, "last_used_at": None,
        "chat_enabled": bool(body.get("chat_enabled", True)),
        "voice_enabled": bool(body.get("voice_enabled", True)),
        "generation_enabled": bool(body.get("generation_enabled", True)),
    }
    await db.orai_private_access.update_one(
        {"user_id": target["id"]}, {"$set": doc}, upsert=True)
    await orai_audit(current, "access_granted", target=target["username"],
                     detail=f"expires={expires_at or 'never'}")
    return {"ok": True, "user": doc}


@access_admin.patch("/private-access/{user_id}")
async def access_update(user_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    patch = {}
    for k in ("chat_enabled", "voice_enabled", "generation_enabled"):
        if k in body:
            patch[k] = bool(body[k])
    if "note" in body:
        patch["note"] = str(body.get("note") or "")[:300]
    if "expires_at" in body:
        patch["expires_at"] = (body.get("expires_at") or "").strip() or None
    r = await db.orai_private_access.update_one({"user_id": user_id}, {"$set": patch})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Grant not found")
    row = await db.orai_private_access.find_one({"user_id": user_id}, {"_id": 0})
    await orai_audit(current, "access_updated", target=row.get("username"),
                     detail=str(sorted(patch.keys())))
    return {"ok": True, "user": row}


@access_admin.delete("/private-access/{user_id}")
async def access_remove(user_id: str, current: CurrentUser):
    require_founder(current)
    row = await db.orai_private_access.find_one({"user_id": user_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Grant not found")
    target_user = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1, "admin_role": 1})
    if target_user and get_admin_role(target_user) == "founder":
        raise HTTPException(status_code=400, detail="The founder always has access")
    await db.orai_private_access.delete_one({"user_id": user_id})
    await orai_audit(current, "access_revoked", target=row.get("username"))
    return {"ok": True}


@access_admin.post("/private-access/bulk-remove")
async def access_bulk_remove(body: dict, current: CurrentUser):
    require_founder(current)
    ids = [str(x) for x in (body.get("user_ids") or [])][:100]
    removed = 0
    for uid in ids:
        row = await db.orai_private_access.find_one({"user_id": uid}, {"_id": 0, "username": 1})
        if not row:
            continue
        u = await db.users.find_one({"id": uid}, {"_id": 0, "admin_role": 1})
        if u and get_admin_role(u) == "founder":
            continue
        await db.orai_private_access.delete_one({"user_id": uid})
        await orai_audit(current, "access_revoked", target=row.get("username"), detail="bulk")
        removed += 1
    return {"ok": True, "removed": removed}


@access_admin.get("/private-access/export")
async def access_export(current: CurrentUser):
    require_founder(current)
    rows = await db.orai_private_access.find({}, {"_id": 0}).sort("granted_at", -1).to_list(1000)
    now = _iso()
    lines = ["username,granted_by,granted_at,expires_at,active,last_used_at,chat,voice,generation,note"]
    for r in rows:
        active = not (r.get("expires_at") and r["expires_at"] < now)
        note = (r.get("note") or "").replace(",", ";").replace("\n", " ")
        lines.append(",".join(str(x) for x in [
            r.get("username"), r.get("granted_by_username"), r.get("granted_at"),
            r.get("expires_at") or "never", active, r.get("last_used_at") or "-",
            r.get("chat_enabled"), r.get("voice_enabled"), r.get("generation_enabled"), note]))
    await orai_audit(current, "access_list_exported", detail=f"{len(rows)} rows")
    return {"csv": "\n".join(lines), "count": len(rows)}


@access_admin.get("/access-audit")
async def access_audit_log(current: CurrentUser, limit: int = 80):
    require_founder(current)
    rows = await db.orai_access_audit.find({}, {"_id": 0}).sort(
        "at", -1).limit(min(300, limit)).to_list(300)
    return {"entries": rows}


@access_admin.get("/usage")
async def usage_dashboard(current: CurrentUser):
    require_founder(current)
    from services import video_generation as vg
    now = datetime.now(timezone.utc)
    day = now.strftime("%Y-%m-%d")
    week_start = (now.timestamp() - 7 * 86400)
    week_iso = datetime.fromtimestamp(week_start, tz=timezone.utc).isoformat()
    month = now.strftime("%Y-%m")

    async def count_msgs(since):
        return await db.orai_assistant_messages.count_documents(
            {"role": "user", "created_at": {"$gte": since}})

    chat_today = await count_msgs(day)
    chat_week = await count_msgs(week_iso)
    chat_month = await count_msgs(f"{month}-01")

    vid_active = await db.ai_video_jobs.count_documents({"status": {"$in": list(vg.ACTIVE_STATUSES)}})
    vid_failed = await db.ai_video_jobs.count_documents({"status": "failed"})
    vid_done = await db.ai_video_jobs.count_documents({"status": "complete"})
    course_running = await db.rc_course_gen_jobs.count_documents({"status": "running"})
    course_failed = await db.rc_course_gen_jobs.count_documents({"status": "failed"})
    course_done = await db.rc_course_gen_jobs.count_documents({"status": "done"})
    course_today = await db.rc_course_gen_jobs.count_documents(
        {"status": "done", "created_at": {"$gte": day}})
    images_today = await db.images.count_documents({"created_at": {"$gte": day}})

    top_users = await db.orai_assistant_messages.aggregate([
        {"$match": {"role": "user", "created_at": {"$gte": week_iso}}},
        {"$group": {"_id": "$user_id", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 5}]).to_list(5)
    for t in top_users:
        u = await db.users.find_one({"id": t["_id"]}, {"_id": 0, "username": 1})
        t["username"] = (u or {}).get("username") or "?"
    top_centers = await db.rc_course_gen_jobs.aggregate([
        {"$group": {"_id": "$center_id", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 5}]).to_list(5)
    for t in top_centers:
        c = await db.responsibility_centers.find_one({"id": t["_id"]}, {"_id": 0, "name": 1})
        t["name"] = (c or {}).get("name") or t["_id"]

    vs = await vg.get_video_settings()
    spend = await vg.spend_summary()
    return {
        "chat": {"today": chat_today, "week": chat_week, "month": chat_month},
        "videos": {"generated": vid_done, "active": vid_active, "failed": vid_failed},
        "courses": {"generated": course_done, "today": course_today,
                    "running": course_running, "failed": course_failed},
        "images_today": images_today,
        "voice_minutes": None,  # not tracked yet — honest null
        "avg_response_time": None,  # not tracked yet
        "queue_length": vid_active + course_running,
        "pending_jobs": vid_active + course_running,
        "failed_jobs": vid_failed + course_failed,
        "top_users": top_users, "top_centers": top_centers,
        "spend": spend,
        "budget": {"daily": vs["daily_budget"], "monthly": vs["monthly_budget"],
                   "daily_remaining": round(max(0, vs["daily_budget"] - spend["daily_spent"]), 2),
                   "monthly_remaining": round(max(0, vs["monthly_budget"] - spend["monthly_spent"]), 2)},
        "emergency_disabled": vs["emergency_disabled"], "dry_run": vs["dry_run"],
        "video_enabled": vs["enabled"],
        "rate_limits": ["ORAi chat: 60/hour per user", "Course generation: 6/hour per user",
                        "Video generation: 10/hour per user"],
    }
