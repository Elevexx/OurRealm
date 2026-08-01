"""RC Phase 5 — ORAi Intelligence: Center Memory, Recommendations,
Health Score, Workflow Drafts, Intelligence Dashboard.

Suggestions only — ORAi never performs actions without approval.
Collections: rc_orai_memory, rc_orai_drafts, orai_voice_usage.
"""
import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from services.chat_conversations import call_openai_chat
from services.rc_units import _ctx
from services import responsibility_center as rc

log = logging.getLogger("ourrealm.rc.intel")
router = APIRouter(prefix="/api/responsibility-center", tags=["rc-intelligence"])

MEMORY_CATEGORIES = {"preference", "organization", "roles", "learning_style", "teaching",
                     "ai_settings", "tasks", "calendar", "prompts", "courses", "reports",
                     "goals", "routines", "workflows", "general"}
DRAFT_KINDS = {"task", "lesson", "course_outline", "report", "event", "announcement", "reminder"}


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _manage(perms: set) -> bool:
    return "edit_center" in perms or "assign_items" in perms


async def _memory_enabled(center_id: str) -> bool:
    c = await db.responsibility_centers.find_one({"id": center_id}, {"orai_memory_enabled": 1})
    return (c or {}).get("orai_memory_enabled", True)


async def build_memory_context(center_id: str, limit: int = 12) -> str:
    """Pinned + recent memory lines injected into ORAi prompts."""
    if not await _memory_enabled(center_id):
        return ""
    rows = await db.rc_orai_memory.find(
        {"center_id": center_id}, {"_id": 0, "category": 1, "content": 1, "pinned": 1}
    ).sort([("pinned", -1), ("updated_at", -1)]).to_list(limit)
    if not rows:
        return ""
    lines = [f"  - [{r['category']}]{' 📌' if r.get('pinned') else ''} {r['content'][:300]}" for r in rows]
    return "CENTER MEMORY (curated notes, respect these):\n" + "\n".join(lines)


# ── Memory management (managers) ────────────────────────────────────────
@router.get("/{center_id}/orai/memory")
async def list_memory(center_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    if not _manage(perms):
        raise HTTPException(status_code=403, detail="Managers only")
    rows = await db.rc_orai_memory.find({"center_id": center_id}, {"_id": 0}) \
        .sort([("pinned", -1), ("updated_at", -1)]).to_list(200)
    return {"memories": rows, "enabled": await _memory_enabled(center_id)}


@router.post("/{center_id}/orai/memory")
async def add_memory(center_id: str, body: dict, current: CurrentUser):
    await _require_manager(center_id, current)
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Memory content is required")
    doc = {"id": uuid.uuid4().hex, "center_id": center_id,
           "category": body.get("category") if body.get("category") in MEMORY_CATEGORIES else "general",
           "content": content[:2000], "pinned": bool(body.get("pinned")),
           "source": "manual", "created_by": current["id"],
           "created_at": _iso(), "updated_at": _iso()}
    await db.rc_orai_memory.insert_one({**doc})
    await rc.log_activity(center_id, current, "orai_memory_added",
                          f"@{current.get('username')} added an ORAi memory ({doc['category']})")
    return {"memory": doc}


@router.patch("/{center_id}/orai/memory/{memory_id}")
async def edit_memory(center_id: str, memory_id: str, body: dict, current: CurrentUser):
    await _require_manager(center_id, current)
    patch = {"updated_at": _iso()}
    if "content" in body:
        patch["content"] = str(body["content"] or "")[:2000]
    if "category" in body and body["category"] in MEMORY_CATEGORIES:
        patch["category"] = body["category"]
    if "pinned" in body:
        patch["pinned"] = bool(body["pinned"])
    r = await db.rc_orai_memory.update_one({"id": memory_id, "center_id": center_id}, {"$set": patch})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Memory not found")
    await rc.log_activity(center_id, current, "orai_memory_edited",
                          f"@{current.get('username')} edited an ORAi memory")
    return {"memory": await db.rc_orai_memory.find_one({"id": memory_id}, {"_id": 0})}


@router.delete("/{center_id}/orai/memory/{memory_id}")
async def delete_memory(center_id: str, memory_id: str, current: CurrentUser):
    await _require_manager(center_id, current)
    r = await db.rc_orai_memory.delete_one({"id": memory_id, "center_id": center_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Memory not found")
    await rc.log_activity(center_id, current, "orai_memory_deleted",
                          f"@{current.get('username')} deleted an ORAi memory")
    return {"ok": True}


@router.post("/{center_id}/orai/memory/reset")
async def reset_memory(center_id: str, current: CurrentUser):
    await _require_manager(center_id, current)
    r = await db.rc_orai_memory.delete_many({"center_id": center_id})
    await rc.log_activity(center_id, current, "orai_memory_reset",
                          f"@{current.get('username')} reset ORAi memory ({r.deleted_count} entries)")
    return {"ok": True, "deleted": r.deleted_count}


@router.get("/{center_id}/orai/memory/export")
async def export_memory(center_id: str, current: CurrentUser):
    await _require_manager(center_id, current)
    rows = await db.rc_orai_memory.find({"center_id": center_id}, {"_id": 0}).to_list(500)
    await rc.log_activity(center_id, current, "orai_memory_exported",
                          f"@{current.get('username')} exported ORAi memory")
    return {"exported_at": _iso(), "center_id": center_id, "memories": rows}


@router.put("/{center_id}/orai/memory/settings")
async def memory_settings(center_id: str, body: dict, current: CurrentUser):
    await _require_manager(center_id, current)
    enabled = bool(body.get("enabled", True))
    await db.responsibility_centers.update_one(
        {"id": center_id}, {"$set": {"orai_memory_enabled": enabled}})
    await rc.log_activity(center_id, current, "orai_memory_settings",
                          f"@{current.get('username')} {'enabled' if enabled else 'disabled'} ORAi memory")
    return {"enabled": enabled}


async def _require_manager(center_id: str, current: dict):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    if not _manage(perms):
        raise HTTPException(status_code=403, detail="Managers only")
    return center, membership, perms


# ── Recommendations (suggestions only, computed from real data) ─────────
@router.get("/{center_id}/orai/recommendations")
async def recommendations(center_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    return {"recommendations": await _compute_recommendations(center, perms)}


async def _compute_recommendations(center: dict, perms: set) -> list:
    cid = center["id"]
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    recs = []

    def add(kind, severity, text, hint=""):
        recs.append({"id": f"{kind}-{len(recs)}", "kind": kind, "severity": severity,
                     "text": text, "action_hint": hint})

    overdue = await db.responsibility_items.count_documents(
        {"center_id": cid, "due_at": {"$lt": now_iso, "$ne": None},
         "status": {"$nin": ["completed", "approved", "canceled", "archived", "declined"]}})
    if overdue:
        add("overdue", "high", f"{overdue} responsibilit{'y is' if overdue == 1 else 'ies are'} overdue.",
            "Open the Work tab to review and reassign.")

    if int(center.get("vault_balance") or 0) < 100:
        add("fire_low", "high", "Fire Power is running low — the Center Vault is below 100 🔥.",
            "Add Fire Power from the Vault tab to keep renewals covered.")

    pending = await db.rc_course_progress.count_documents(
        {"center_id": cid, "status": "pending_approval"})
    if pending:
        add("approvals", "medium", f"{pending} checkpoint{'s' if pending != 1 else ''} awaiting parent/teacher approval.",
            "Review them in the Course Studio report.")

    events = await db.responsibility_center_calendar_events.find(
        {"center_id": cid, "status": {"$ne": "canceled"},
         "start_at": {"$gte": now_iso, "$lt": (now + timedelta(days=7)).isoformat()}},
        {"_id": 0, "title": 1, "start_at": 1, "end_at": 1}).sort("start_at", 1).to_list(50)
    for i in range(len(events) - 1):
        if events[i].get("end_at") and events[i + 1]["start_at"] < events[i]["end_at"]:
            add("calendar_conflict", "medium",
                f'Calendar conflict: "{events[i]["title"]}" overlaps "{events[i + 1]["title"]}".',
                "Adjust one of the events in the Calendar tab.")
            break

    last_act = await db.responsibility_center_activity_logs.find_one(
        {"center_id": cid}, {"created_at": 1}, sort=[("created_at", -1)])
    if last_act and last_act["created_at"] < (now - timedelta(days=7)).isoformat():
        add("low_activity", "medium", "Activity is unusually low — nothing has happened in over a week.",
            "Assign a responsibility or schedule an event to re-engage members.")

    ctype = center.get("center_type")
    if ctype == "education":
        rows = await db.rc_course_progress.find(
            {"center_id": cid, "total": {"$gt": 0}},
            {"_id": 0, "user_id": 1, "username": 1, "score": 1, "total": 1, "lesson_id": 1, "lesson_title": 1}).to_list(1000)
        by_user, by_lesson = {}, {}
        for r in rows:
            pct = r["score"] / r["total"] * 100 if r.get("score") is not None else None
            if pct is None:
                continue
            by_user.setdefault(r.get("username") or r["user_id"], []).append(pct)
            by_lesson.setdefault(r.get("lesson_title") or r["lesson_id"], []).append(pct)
        for uname, scores in by_user.items():
            avg = sum(scores) / len(scores)
            if avg < 60:
                add("student_review", "high", f"@{uname} is averaging {round(avg)}% on quizzes — a review session may help.",
                    "Ask ORAi to draft a review lesson, or open the Course Player together.")
        for ltitle, scores in by_lesson.items():
            if len(scores) >= 3:
                avg = sum(scores) / len(scores)
                if avg >= 98:
                    add("lesson_easy", "low", f'"{ltitle}" appears too easy — everyone is acing it.',
                        "Consider raising the difficulty or adding a project.")
                elif avg < 40:
                    add("lesson_hard", "medium", f'"{ltitle}" appears too difficult (avg {round(avg)}%).',
                        "Simplify the lesson or add a review block before the quiz.")
        done_recent = await db.rc_course_progress.count_documents(
            {"center_id": cid, "completed_at": {"$gte": (now - timedelta(days=7)).isoformat()}})
        if done_recent >= 3:
            add("recommend_quiz", "low", "Learners are on a roll this week — a fresh quiz or project would keep momentum.",
                "Generate one with ORAi in the Course Studio.")

    if ctype in ("business", "team"):
        items = await db.responsibility_items.find(
            {"center_id": cid, "status": {"$nin": ["completed", "approved", "canceled", "archived"]}},
            {"_id": 0, "assignee_ids": 1}).to_list(500)
        counts = {}
        for it in items:
            for a in it.get("assignee_ids") or []:
                counts[a] = counts.get(a, 0) + 1
        if counts:
            vals = sorted(counts.values())
            if len(vals) >= 2 and vals[-1] >= 3 * max(1, vals[len(vals) // 2]):
                add("workload", "medium", "Workload looks imbalanced — one member holds far more open items than the rest.",
                    "Consider reassigning a few responsibilities.")

    if ctype in ("family", "household"):
        if overdue:
            add("chores", "medium", "Some chores are past due — a quick family check-in could help.",
                "Schedule a family meeting from the Calendar tab.")
        review_ev = await db.responsibility_center_calendar_events.count_documents(
            {"center_id": cid, "status": {"$ne": "canceled"},
             "start_at": {"$gte": (now - timedelta(days=7)).isoformat()},
             "title": {"$regex": "review|meeting", "$options": "i"}})
        if not review_ev:
            add("weekly_review", "low", "No family meeting or weekly review on the calendar recently.",
                "A short weekly review keeps everyone in sync.")

    ach = await db.rc_course_progress.count_documents(
        {"center_id": cid, "status": "completed",
         "completed_at": {"$gte": (now - timedelta(days=3)).isoformat()}})
    if ach:
        add("achievement", "low", f"{ach} lesson{'s' if ach != 1 else ''} completed in the last 3 days — celebrate the wins! 🎉")
    return recs


# ── Center Health Score ─────────────────────────────────────────────────
@router.get("/{center_id}/health")
async def health_score(center_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    now = datetime.now(timezone.utc)
    cutoff30 = (now - timedelta(days=30)).isoformat()
    cutoff14 = (now - timedelta(days=14)).isoformat()
    factors = []

    total_items = await db.responsibility_items.count_documents(
        {"center_id": center_id, "created_at": {"$gte": cutoff30}})
    done_items = await db.responsibility_items.count_documents(
        {"center_id": center_id, "created_at": {"$gte": cutoff30},
         "status": {"$in": ["completed", "approved"]}})
    task_score = round(done_items / total_items * 100) if total_items else 70
    factors.append({"key": "tasks", "label": "Task completion (30d)", "score": task_score, "weight": 0.2,
                    "detail": f"{done_items}/{total_items} items completed" if total_items else "No items created recently"})

    members = max(1, int(center.get("member_count") or 1))
    active_users = len(await db.responsibility_center_activity_logs.distinct(
        "actor_id", {"center_id": center_id, "created_at": {"$gte": cutoff14}}))
    act_score = min(100, round(active_users / members * 100))
    factors.append({"key": "activity", "label": "Member activity (14d)", "score": act_score, "weight": 0.2,
                    "detail": f"{active_users} of {members} members active"})

    course_total = await db.rc_courses.count_documents({"center_id": center_id, "status": "published"})
    if course_total:
        prog_done = await db.rc_course_progress.count_documents({"center_id": center_id, "status": "completed"})
        lesson_sum = 0
        async for c in db.rc_courses.find({"center_id": center_id, "status": "published"}, {"lesson_count": 1}):
            lesson_sum += c.get("lesson_count") or 0
        course_score = min(100, round(prog_done / max(1, lesson_sum) * 100))
        detail = f"{prog_done} lesson completions across {course_total} course(s)"
    else:
        course_score, detail = 70, "No published courses yet"
    factors.append({"key": "courses", "label": "Course progress", "score": course_score, "weight": 0.15, "detail": detail})

    pending = await db.rc_course_progress.count_documents({"center_id": center_id, "status": "pending_approval"})
    appr_score = max(0, 100 - pending * 20)
    factors.append({"key": "approvals", "label": "Approvals up to date", "score": appr_score, "weight": 0.1,
                    "detail": f"{pending} pending approval(s)"})

    ev_count = await db.responsibility_center_calendar_events.count_documents(
        {"center_id": center_id, "created_at": {"$gte": cutoff14}})
    cal_score = min(100, 40 + ev_count * 20) if ev_count else 30
    factors.append({"key": "calendar", "label": "Calendar usage (14d)", "score": cal_score, "weight": 0.1,
                    "detail": f"{ev_count} event(s) created"})

    vault = int(center.get("vault_balance") or 0)
    fire_score = 100 if vault >= 500 else 70 if vault >= 100 else 30 if vault > 0 else 10
    factors.append({"key": "fire", "label": "Fire Power reserve", "score": fire_score, "weight": 0.1,
                    "detail": f"{vault} 🔥 in the Center Vault"})

    ai_sessions = await db.rc_orai_sessions.count_documents(
        {"center_id": center_id, "updated_at": {"$gte": cutoff14}})
    ai_score = min(100, 30 + ai_sessions * 15) if ai_sessions else 40
    factors.append({"key": "ai", "label": "ORAi engagement (14d)", "score": ai_score, "weight": 0.15,
                    "detail": f"{ai_sessions} ORAi conversation(s)"})

    score = round(sum(f["score"] * f["weight"] for f in factors))
    label = ("Excellent" if score >= 85 else "Good" if score >= 65
             else "Needs Attention" if score >= 45 else "At Risk")
    recs = await _compute_recommendations(center, perms)
    return {"score": score, "label": label, "factors": factors,
            "explanation": f"Weighted across {len(factors)} signals — strongest: "
                           f"{max(factors, key=lambda f: f['score'])['label']}; weakest: "
                           f"{min(factors, key=lambda f: f['score'])['label']}.",
            "recommendations": recs[:5]}


# ── ORAi Workflow Drafts (nothing publishes without approval) ───────────
DRAFT_SYSTEM = """You are ORAi drafting content for a Responsibility Center on OurRealm. Reply with ONLY valid JSON, no fences.
Kind "{kind}" shapes:
task/reminder: {{"title": "...", "description": "...", "priority": "low|normal|high", "category": "...", "due_in_days": 3}}
lesson: {{"title": "...", "blocks": [{{"type": "text|activity|worksheet|homework|project|review", "title": "...", "body": "..."}}]}}
course_outline: {{"title": "...", "description": "...", "grade_level": "...", "modules": [{{"title": "...", "lesson_titles": ["..."]}}]}}
report: {{"title": "...", "body": "markdown-lite report text"}}
event: {{"title": "...", "description": "...", "start_in_days": 2, "duration_min": 60}}
announcement: {{"title": "...", "body": "..."}}
Fire Power is an engagement resource — never money. Keep it practical and concise."""


@router.post("/{center_id}/orai/drafts/generate")
async def generate_draft(center_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _require_manager(center_id, current)
    kind = body.get("kind")
    if kind not in DRAFT_KINDS:
        raise HTTPException(status_code=400, detail="Unknown draft kind")
    instructions = (body.get("instructions") or "").strip()
    if not instructions:
        raise HTTPException(status_code=400, detail="Tell ORAi what to draft")
    mem = await build_memory_context(center_id, limit=6)
    result = await call_openai_chat(
        [{"role": "system", "content": DRAFT_SYSTEM.format(kind=kind) + ("\n\n" + mem if mem else "")},
         {"role": "user", "content": f"Center: {center['name']} ({center.get('center_type')}). Draft a {kind}: {instructions[:1500]}"}],
        temperature=0.7, max_tokens=2000)
    txt = re.sub(r"^```(?:json)?\s*|\s*```$", "", (result.get("content") or "").strip())
    try:
        start, end = txt.find("{"), txt.rfind("}")
        content = json.loads(txt[start:end + 1])
    except Exception:
        raise HTTPException(status_code=502, detail="ORAi could not draft that — try rephrasing")
    doc = {"id": uuid.uuid4().hex, "center_id": center_id, "kind": kind,
           "instructions": instructions[:1500], "content": content, "status": "draft",
           "created_by": current["id"], "created_by_username": current.get("username"),
           "created_at": _iso(), "updated_at": _iso()}
    await db.rc_orai_drafts.insert_one({**doc})
    await rc.log_activity(center_id, current, "orai_draft_created",
                          f"@{current.get('username')} asked ORAi to draft a {kind}")
    return {"draft": doc}


@router.get("/{center_id}/orai/drafts")
async def list_drafts(center_id: str, current: CurrentUser):
    await _require_manager(center_id, current)
    rows = await db.rc_orai_drafts.find({"center_id": center_id}, {"_id": 0}) \
        .sort("created_at", -1).to_list(100)
    return {"drafts": rows}


@router.patch("/{center_id}/orai/drafts/{draft_id}")
async def edit_draft(center_id: str, draft_id: str, body: dict, current: CurrentUser):
    await _require_manager(center_id, current)
    r = await db.rc_orai_drafts.update_one(
        {"id": draft_id, "center_id": center_id, "status": "draft"},
        {"$set": {"content": body.get("content") or {}, "updated_at": _iso()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"draft": await db.rc_orai_drafts.find_one({"id": draft_id}, {"_id": 0})}


@router.delete("/{center_id}/orai/drafts/{draft_id}")
async def reject_draft(center_id: str, draft_id: str, current: CurrentUser):
    await _require_manager(center_id, current)
    r = await db.rc_orai_drafts.delete_one({"id": draft_id, "center_id": center_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"ok": True}


@router.post("/{center_id}/orai/drafts/{draft_id}/approve")
async def approve_draft(center_id: str, draft_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _require_manager(center_id, current)
    draft = await db.rc_orai_drafts.find_one(
        {"id": draft_id, "center_id": center_id, "status": "draft"}, {"_id": 0})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    c, kind, now = draft["content"], draft["kind"], datetime.now(timezone.utc)
    created = {}

    if kind in ("task", "reminder"):
        from services import rc_items
        item = await rc_items.create_item(current, center_id, {
            "item_type": "task", "title": c.get("title") or "Untitled task",
            "description": c.get("description") or "",
            "priority": c.get("priority") if c.get("priority") in ("low", "normal", "high") else "normal",
            "category": c.get("category") or ("reminder" if kind == "reminder" else "general"),
            "due_at": (now + timedelta(days=int(c.get("due_in_days") or 3))).isoformat()})
        created = {"type": "item", "id": item.get("item", item).get("id") if isinstance(item, dict) else None}
    elif kind == "event":
        ev = {"id": uuid.uuid4().hex, "center_id": center_id, "unit_id": None,
              "event_type": "general", "title": c.get("title") or "Untitled event",
              "description": c.get("description") or "", "visibility": "members",
              "created_by": current["id"], "created_by_username": current.get("username"),
              "organizer_id": current["id"],
              "start_at": (now + timedelta(days=int(c.get("start_in_days") or 1))).isoformat(),
              "end_at": (now + timedelta(days=int(c.get("start_in_days") or 1),
                                         minutes=int(c.get("duration_min") or 60))).isoformat(),
              "all_day": False, "timezone": center.get("timezone") or "UTC", "location": "",
              "virtual_link": "", "status": "scheduled", "attendance_enabled": False,
              "reminders": [], "attendees": [], "related_item_id": None, "version": 1,
              "created_at": _iso(), "updated_at": _iso(), "canceled_at": None, "client_token": None}
        await db.responsibility_center_calendar_events.insert_one({**ev})
        created = {"type": "event", "id": ev["id"]}
    elif kind == "announcement":
        member_ids = await db.responsibility_center_memberships.distinct(
            "user_id", {"center_id": center_id, "status": "active"})
        notifs = [{"id": uuid.uuid4().hex, "recipient_id": uid, "kind": "rc_announcement",
                   "actor_username": current.get("username"),
                   "payload": {"center_id": center_id, "center_name": center["name"],
                               "title": c.get("title") or "Announcement", "body": (c.get("body") or "")[:800]},
                   "created_at": _iso(), "seen": False}
                  for uid in member_ids if uid != current["id"]]
        if notifs:
            await db.notifications.insert_many(notifs)
        created = {"type": "announcement", "recipients": len(notifs)}
    elif kind == "course_outline":
        course_id = uuid.uuid4().hex
        modules, lesson_docs, order = [], [], 0
        for m in (c.get("modules") or [])[:6]:
            mod_id = uuid.uuid4().hex[:8]
            lids = []
            for lt in (m.get("lesson_titles") or [])[:12]:
                lid = uuid.uuid4().hex
                lesson_docs.append({"id": lid, "course_id": course_id, "center_id": center_id,
                                    "module_id": mod_id, "order": order, "title": str(lt)[:200],
                                    "lesson_type": "lesson", "duration_min": 15,
                                    "blocks": [{"id": uuid.uuid4().hex[:8], "type": "text", "title": "",
                                                "body": "Draft outline — fill in this lesson in the Course Editor.",
                                                "image_url": None}],
                                    "quiz": {"questions": []}, "created_at": _iso(), "updated_at": _iso()})
                lids.append(lid)
                order += 1
            modules.append({"id": mod_id, "title": str(m.get("title") or "Module")[:200], "lesson_ids": lids})
        await db.rc_courses.insert_one({
            "id": course_id, "center_id": center_id, "title": str(c.get("title") or "Drafted course")[:200],
            "subject": "", "description": str(c.get("description") or "")[:1000],
            "grade_level": str(c.get("grade_level") or "")[:60], "status": "draft",
            "color": "#C26BFF", "source_prompt": draft["instructions"],
            "settings": {"requires_approval": True}, "created_by": current["id"],
            "created_at": _iso(), "updated_at": _iso(), "published_at": None,
            "modules": modules, "lesson_count": len(lesson_docs)})
        if lesson_docs:
            await db.rc_course_lessons.insert_many([{**d} for d in lesson_docs])
        created = {"type": "course", "id": course_id}
    elif kind == "lesson" and body.get("course_id"):
        course = await db.rc_courses.find_one({"id": body["course_id"], "center_id": center_id}, {"_id": 0})
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        count = await db.rc_course_lessons.count_documents({"course_id": course["id"]})
        lesson = {"id": uuid.uuid4().hex, "course_id": course["id"], "center_id": center_id,
                  "module_id": course["modules"][-1]["id"] if course["modules"] else "m1",
                  "order": count, "title": str(c.get("title") or "Drafted lesson")[:200],
                  "lesson_type": "lesson", "duration_min": 15,
                  "blocks": [{"id": uuid.uuid4().hex[:8],
                              "type": b.get("type") if b.get("type") in ("text", "activity", "worksheet", "homework", "project", "review") else "text",
                              "title": str(b.get("title") or "")[:200], "body": str(b.get("body") or "")[:8000],
                              "image_url": None} for b in (c.get("blocks") or [])[:10]],
                  "quiz": {"questions": []}, "created_at": _iso(), "updated_at": _iso()}
        await db.rc_course_lessons.insert_one({**lesson})
        await db.rc_courses.update_one({"id": course["id"], "modules.id": lesson["module_id"]},
                                       {"$push": {"modules.$.lesson_ids": lesson["id"]}, "$inc": {"lesson_count": 1}})
        created = {"type": "lesson", "id": lesson["id"], "course_id": course["id"]}
    else:  # report / lesson without course — approved content for copy/use
        created = {"type": kind, "content": c}

    await db.rc_orai_drafts.update_one(
        {"id": draft_id}, {"$set": {"status": "approved", "approved_by": current["id"],
                                    "approved_at": _iso(), "created_entity": created}})
    await rc.log_activity(center_id, current, "orai_draft_approved",
                          f"@{current.get('username')} approved an ORAi {kind} draft")
    return {"ok": True, "created": created}


# ── Intelligence dashboard overview ─────────────────────────────────────
@router.get("/{center_id}/intelligence/overview")
async def intelligence_overview(center_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    now = datetime.now(timezone.utc)
    cutoff7 = (now - timedelta(days=7)).isoformat()
    manage = _manage(perms)

    health = await health_score(center_id, current)
    sessions = await db.rc_orai_sessions.find(
        {"center_id": center_id}, {"_id": 0, "title": 1, "updated_at": 1, "id": 1}) \
        .sort("updated_at", -1).to_list(5)
    autos = await db.rc_automations.find({"center_id": center_id}, {"_id": 0, "name": 1, "enabled": 1, "run_count": 1, "id": 1}).to_list(50)
    runs = await db.rc_automation_runs.find({"center_id": center_id}, {"_id": 0}) \
        .sort("created_at", -1).to_list(8)

    # 7-day completion trend (course lessons + items)
    trend = []
    for i in range(6, -1, -1):
        day = (now - timedelta(days=i)).date().isoformat()
        n1 = await db.rc_course_progress.count_documents(
            {"center_id": center_id, "completed_at": {"$gte": day, "$lt": day + "T23:59:59.999"}})
        n2 = await db.responsibility_items.count_documents(
            {"center_id": center_id, "completed_at": {"$gte": day, "$lt": day + "T23:59:59.999"}})
        trend.append({"day": day[5:], "completions": n1 + n2})

    member_ids = await db.responsibility_center_memberships.distinct(
        "user_id", {"center_id": center_id, "status": "active"})
    voice_uses = await db.orai_voice_usage.count_documents(
        {"user_id": {"$in": member_ids}, "created_at": {"$gte": cutoff7}})

    return {
        "health": {"score": health["score"], "label": health["label"], "factors": health["factors"],
                   "explanation": health["explanation"]},
        "recommendations": health["recommendations"],
        "conversations": sessions,
        "automations": {"total": len(autos), "enabled": sum(1 for a in autos if a.get("enabled")),
                        "items": autos[:6], "recent_runs": runs},
        "memory_count": await db.rc_orai_memory.count_documents({"center_id": center_id}) if manage else None,
        "drafts_pending": await db.rc_orai_drafts.count_documents({"center_id": center_id, "status": "draft"}) if manage else None,
        "stats": {
            "orai_sessions_7d": await db.rc_orai_sessions.count_documents({"center_id": center_id, "updated_at": {"$gte": cutoff7}}),
            "courses_generated": await db.rc_courses.count_documents({"center_id": center_id}),
            "voice_uses_7d": voice_uses,
            "fire_moves_7d": await db.responsibility_center_activity_logs.count_documents(
                {"center_id": center_id, "created_at": {"$gte": cutoff7},
                 "action": {"$regex": "vault|fire", "$options": "i"}}),
        },
        "trend": trend,
        "can_manage": manage,
    }
