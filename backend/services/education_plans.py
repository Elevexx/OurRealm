"""Autonomous multi-student education plans — ORAi Education Engine.

One reusable engine: natural-language request → per-student adaptive plan
(reads LIVE Center education profiles, progress, quiz history) → founder/owner
approval → first lessons now → adaptive daily generation at the configured
time. Restart-safe scheduler (DB-only state, claim-locked). Caps are never
silently exceeded: hitting a cap pauses the plan and notifies the owner.

Collections: edu_plans, edu_plan_runs, edu_plan_audit.
Reuses: rc_courses generation prompts/cleaners, media_retry, rc notifications.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone, timedelta, date as date_cls
from zoneinfo import ZoneInfo

from core.db import db
from services.chat_conversations import call_openai_chat

log = logging.getLogger("ourrealm.edu.plans")

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
EST_LESSON_COST = 0.02   # text generation
EST_IMAGE_COST = 0.04    # illustration
ACTIVE_STATUSES = ("active", "paused")


def _iso(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()


async def audit(actor, action, plan_id, center_id=None, detail=""):
    try:
        await db.edu_plan_audit.insert_one({
            "id": uuid.uuid4().hex, "at": _iso(), "action": action, "plan_id": plan_id,
            "center_id": center_id, "actor_id": (actor or {}).get("id"),
            "actor_username": (actor or {}).get("username"), "detail": str(detail)[:500]})
    except Exception:  # noqa: BLE001
        pass


# ── Live student snapshots (never re-ask for data ORAi already has) ──────
async def student_snapshot(center_id: str, user_id: str) -> dict:
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "username": 1})
    edu = await db.rc_member_education.find_one(
        {"center_id": center_id, "user_id": user_id}, {"_id": 0}) or {}
    prog = await db.rc_course_progress.aggregate([
        {"$match": {"center_id": center_id, "user_id": user_id}},
        {"$group": {"_id": "$status", "n": {"$sum": 1},
                    "score": {"$sum": {"$ifNull": ["$score", 0]}},
                    "total": {"$sum": {"$ifNull": ["$total", 0]}}}}]).to_list(10)
    done = next((p for p in prog if p["_id"] == "completed"), {})
    avg = round(done.get("score", 0) / done["total"] * 100) if done.get("total") else None
    runs = await db.edu_plan_runs.find(
        {"center_id": center_id, "student_id": user_id},
        {"_id": 0, "status": 1, "lesson_title": 1, "subject": 1, "date": 1}
    ).sort("date", -1).to_list(10)
    missing = []
    if not edu.get("grade_text"):
        missing.append("grade level")
    if not edu.get("subjects"):
        missing.append("selected subjects")
    return {
        "user_id": user_id, "username": (u or {}).get("username") or "?",
        "grade_text": edu.get("grade_text") or "", "grade_level": edu.get("grade_level") or "",
        "subjects": edu.get("subjects") or [], "ai_power": edu.get("ai_power"),
        "accessibility": edu.get("accessibility") or "", "focus_areas": edu.get("focus_areas") or "",
        "lesson_length": edu.get("lesson_length") or "",
        "completed_lessons": done.get("n", 0), "avg_score": avg,
        "recent_runs": runs, "missing_info": missing,
    }


async def center_students(center_id: str) -> list:
    rows = await db.responsibility_center_memberships.find(
        {"center_id": center_id, "status": "active"}, {"_id": 0, "user_id": 1, "role": 1}).to_list(200)
    profiled, members = [], []
    for m in rows:
        edu = await db.rc_member_education.find_one(
            {"center_id": center_id, "user_id": m["user_id"]}, {"_id": 0, "user_id": 1, "grade_text": 1})
        if edu and (edu.get("grade_text") or m["role"] == "member"):
            profiled.append(m["user_id"])
        elif m["role"] == "member":
            members.append(m["user_id"])
    return profiled or members


# ── Natural-language plan drafting ───────────────────────────────────────
PLAN_PARSE_SYSTEM = """You convert an education request into a JSON learning-plan spec.
Reply ONLY valid JSON:
{"title": "short plan name",
 "student_usernames": ["names mentioned, empty = all student members"],
 "days": ["mon","tue","wed","thu","fri"],
 "duration_days": 30,
 "generation_time": "19:00",
 "mode": "adaptive",
 "subjects_override": {},
 "notes": "special instructions (difficulty tweaks per student, review days, holidays to skip, etc.)"}
Rules: weekday-only requests → days mon-fri. "every day" → all 7. Times like 7 PM → "19:00".
"one month" → 30, "two weeks" → 14. mode "adaptive" unless they ask to generate everything upfront ("full").
Keep notes short but preserve per-student adjustments verbatim."""


async def draft_plan(center_id: str, request_text: str, current: dict) -> dict:
    center = await db.responsibility_centers.find_one({"id": center_id}, {"_id": 0, "name": 1, "timezone": 1})
    res = await call_openai_chat(
        [{"role": "system", "content": PLAN_PARSE_SYSTEM},
         {"role": "user", "content": request_text[:1500]}],
        temperature=0.2, max_tokens=600, json_mode=True)
    import json as _json
    try:
        spec = _json.loads(res.get("content") or "{}")
    except Exception:  # noqa: BLE001
        spec = {}

    wanted = [str(x).strip().lstrip("@") for x in (spec.get("student_usernames") or [])]
    if wanted:
        ids = []
        for w in wanted:
            u = await db.users.find_one({"username": {"$regex": f"^{w}$", "$options": "i"}}, {"_id": 0, "id": 1})
            if u:
                m = await db.responsibility_center_memberships.find_one(
                    {"center_id": center_id, "user_id": u["id"], "status": "active"}, {"_id": 0, "user_id": 1})
                if m:
                    ids.append(u["id"])
    else:
        ids = await center_students(center_id)
    ids = [i for i in ids if i != current["id"]] or ids  # owner isn't a student unless alone

    students, missing = [], []
    for uid in ids[:12]:
        s = await student_snapshot(center_id, uid)
        students.append(s)
        for mi in s["missing_info"]:
            missing.append(f"@{s['username']}: {mi}")

    days = [d for d in (spec.get("days") or DAYS[:5]) if d in DAYS] or DAYS[:5]
    duration = min(max(int(spec.get("duration_days") or 30), 1), 92)
    tz = (center or {}).get("timezone") or "UTC"
    try:
        now_local = datetime.now(ZoneInfo(tz))
    except Exception:  # noqa: BLE001
        tz, now_local = "UTC", datetime.now(timezone.utc)
    start = now_local.date()
    end = start + timedelta(days=duration - 1)
    learning_days = sum(1 for i in range(duration)
                        if DAYS[(start + timedelta(days=i)).weekday()] in days)
    lessons_total = learning_days * max(len(students), 1)
    est_daily = round((EST_LESSON_COST + EST_IMAGE_COST) * max(len(students), 1), 2)
    plan = {
        "id": uuid.uuid4().hex, "center_id": center_id,
        "title": str(spec.get("title") or "Learning Plan")[:120],
        "request_text": request_text[:1500], "notes": str(spec.get("notes") or "")[:800],
        "status": "pending_approval", "mode": spec.get("mode") if spec.get("mode") in ("adaptive", "full") else "adaptive",
        "students": [{"user_id": s["user_id"], "username": s["username"],
                      "grade_text": s["grade_text"], "subjects": s["subjects"],
                      "accessibility": s["accessibility"], "adjustments": ""} for s in students],
        "missing_info": missing,
        "schedule": {"start_date": start.isoformat(), "end_date": end.isoformat(),
                     "days": days, "skip_dates": [],
                     "generation_time": str(spec.get("generation_time") or "19:00")[:5],
                     "timezone": tz},
        "media": {"images": True, "narration": True, "activities": True, "quizzes": True,
                  "worksheets": True, "video": False},
        "caps": {"daily_lessons": max(len(students), 1), "weekly_lessons": 0,
                 "monthly_lessons": 0, "total_lessons": lessons_total,
                 "daily_cost": 0, "monthly_cost": 0, "total_cost": 0},
        "estimates": {"learning_days": learning_days, "lessons_total": lessons_total,
                      "est_daily_cost": est_daily,
                      "est_monthly_cost": round(est_daily * min(learning_days, 22), 2),
                      "est_total_cost": round((EST_LESSON_COST + EST_IMAGE_COST) * lessons_total, 2),
                      "media_note": "lesson text + 1 AI image per lesson; narration via ORAi voice (free); AI video stays in dry-run"},
        "usage": {"lessons_generated": 0, "est_spent": 0.0},
        "courses": {}, "review": {}, "next_run_date": None, "last_generated_date": None,
        "created_by": current["id"], "created_by_username": current.get("username"),
        "created_at": _iso(), "updated_at": _iso(),
    }
    await db.edu_plans.insert_one({**plan})
    await audit(current, "plan_drafted", plan["id"], center_id, detail=request_text[:120])
    return plan


# ── Lifecycle actions ────────────────────────────────────────────────────
async def decide(plan: dict, action: str, current: dict, feedback: str = "") -> dict:
    upd = {"updated_at": _iso(),
           "review": {**plan.get("review", {}), "decided_at": _iso(),
                      "decided_by": current.get("username"), "feedback": feedback[:600]}}
    status = {"approve": "approved", "decline": "declined",
              "request_changes": "changes_requested"}[action]
    upd["status"] = status
    await db.edu_plans.update_one({"id": plan["id"]}, {"$set": upd})
    await audit(current, f"plan_{status}", plan["id"], plan["center_id"], detail=feedback[:120])
    return await db.edu_plans.find_one({"id": plan["id"]}, {"_id": 0})


async def activate(plan: dict, current: dict) -> dict:
    if plan["status"] not in ("approved", "paused"):
        raise ValueError("Approve the plan before activating it")
    if plan.get("missing_info"):
        raise ValueError("Complete the missing student info first: " + "; ".join(plan["missing_info"][:4]))
    today = _local_today(plan)
    await db.edu_plans.update_one({"id": plan["id"]}, {"$set": {
        "status": "active", "next_run_date": today.isoformat(), "updated_at": _iso()}})
    await audit(current, "plan_activated", plan["id"], plan["center_id"])
    asyncio.create_task(_generate_day(plan["id"], today.isoformat(), first=True))
    return await db.edu_plans.find_one({"id": plan["id"]}, {"_id": 0})


def _local_today(plan) -> date_cls:
    try:
        return datetime.now(ZoneInfo(plan["schedule"]["timezone"])).date()
    except Exception:  # noqa: BLE001
        return datetime.now(timezone.utc).date()


def _is_learning_day(plan, d: date_cls) -> bool:
    s = plan["schedule"]
    if d.isoformat() in (s.get("skip_dates") or []):
        return False
    if not (s["start_date"] <= d.isoformat() <= s["end_date"]):
        return False
    return DAYS[d.weekday()] in s["days"]


async def _caps_exceeded(plan) -> str | None:
    caps, now = plan["caps"], datetime.now(timezone.utc)
    async def count(days):
        return await db.edu_plan_runs.count_documents(
            {"plan_id": plan["id"], "status": "done",
             "created_at": {"$gte": (now - timedelta(days=days)).isoformat()}})
    total = await db.edu_plan_runs.count_documents({"plan_id": plan["id"], "status": "done"})
    if caps.get("total_lessons") and total >= caps["total_lessons"]:
        return "total lesson cap"
    today_count = await db.edu_plan_runs.count_documents(
        {"plan_id": plan["id"], "status": "done", "date": _local_today(plan).isoformat()})
    if caps.get("daily_lessons") and today_count >= caps["daily_lessons"]:
        return "daily lesson cap"
    if caps.get("weekly_lessons") and await count(7) >= caps["weekly_lessons"]:
        return "weekly lesson cap"
    if caps.get("monthly_lessons") and await count(30) >= caps["monthly_lessons"]:
        return "monthly lesson cap"
    if caps.get("total_cost") and plan["usage"]["est_spent"] >= caps["total_cost"]:
        return "total cost cap"
    return None


# ── Adaptive lesson generation ───────────────────────────────────────────
LESSON_SYSTEM = """You are ORAi, generating ONE personalized daily lesson that CONTINUES a student's learning path.
Reply ONLY valid JSON:
{"title": "...", "subject": "...", "duration_min": 20,
 "blocks": [
  {"type": "text", "title": "...", "body": "2-3 short warm conversational paragraphs"},
  {"type": "tap_select", "title": "...", "body": "question", "options": ["A","B","C"], "answer_index": 0, "explanation": "why"},
  {"type": "activity"|"worksheet"|"checklist"|"short_answer"|"audio_note"|"reflection", ...}
 ],
 "quiz": {"questions": [{"q": "...", "options": ["A","B","C","D"], "answer_index": 0, "explanation": "..."}]},
 "adaptation_note": "1 sentence: how this lesson adapts to the student's progress",
 "parent_note": "1-2 sentences for the parent/teacher about today's focus"}
Rules:
- 4-6 varied blocks (≥1 text, ≥1 interactive, include an audio_note script sometimes). 3-5 quiz questions.
- CONTINUE from the previous lesson — never restart or repeat mastered material unnecessarily.
- If quiz scores were weak, reinforce gently before advancing. If strong, advance.
- Match the grade level's vocabulary and difficulty. Respect accessibility needs.
- Warm educator voice, no AI phrasing, no accreditation claims. Write ONLY in English unless the subject is a foreign language."""


async def _generate_student_lesson(plan: dict, student: dict, day_iso: str) -> dict:
    """One adaptive lesson for one student. Returns the run record."""
    from routers.rc_courses import _clean_blocks, _clean_quiz, _gen_image
    from services import media_retry
    run = {"id": uuid.uuid4().hex, "plan_id": plan["id"], "center_id": plan["center_id"],
           "student_id": student["user_id"], "student_username": student["username"],
           "date": day_iso, "status": "generating", "lesson_id": None, "lesson_title": None,
           "subject": None, "error": None, "adaptation": None, "created_at": _iso()}
    await db.edu_plan_runs.insert_one({**run})
    try:
        snap = await student_snapshot(plan["center_id"], student["user_id"])
        subjects = student.get("subjects") or snap["subjects"] or ["General Studies"]
        done_runs = [r for r in await db.edu_plan_runs.find(
            {"plan_id": plan["id"], "student_id": student["user_id"], "status": "done"},
            {"_id": 0, "subject": 1, "lesson_title": 1, "lesson_id": 1}).sort("created_at", 1).to_list(200)]
        subject = subjects[len(done_runs) % len(subjects)]
        prev = next((r for r in reversed(done_runs) if r["subject"] == subject), None)
        prev_ctx = ""
        if prev:
            pl = await db.rc_course_lessons.find_one({"id": prev["lesson_id"]}, {"_id": 0, "title": 1, "blocks": 1})
            pp = await db.rc_course_progress.find_one(
                {"lesson_id": prev["lesson_id"], "user_id": student["user_id"]}, {"_id": 0, "status": 1, "score": 1, "total": 1})
            body = next((b.get("body", "") for b in (pl or {}).get("blocks", []) if b.get("type") == "text"), "")
            prev_ctx = (f"PREVIOUS LESSON: \"{prev['lesson_title']}\" — {body[:350]}\n"
                        f"PREVIOUS RESULT: {(pp or {}).get('status') or 'not started yet (treat as missed — include a short catch-up recap)'}"
                        + (f", quiz {pp['score']}/{pp['total']}" if pp and pp.get("total") else ""))
        user_msg = (
            f"Student: @{student['username']} · Grade: {student.get('grade_text') or snap['grade_text'] or 'unknown'}\n"
            f"Subject today: {subject} (lesson #{len([r for r in done_runs if r['subject'] == subject]) + 1} in this subject)\n"
            f"Completed lessons: {snap['completed_lessons']} · Average quiz score: {snap['avg_score'] if snap['avg_score'] is not None else 'n/a'}%\n"
            + (f"Accessibility: {snap['accessibility']}\n" if snap.get("accessibility") else "")
            + (f"Adjustments from parent/teacher: {student.get('adjustments')}\n" if student.get("adjustments") else "")
            + (f"Plan notes: {plan.get('notes')}\n" if plan.get("notes") else "")
            + (prev_ctx or "This is the FIRST lesson in this subject — start at the right level and set the journey up."))
        res = await call_openai_chat(
            [{"role": "system", "content": LESSON_SYSTEM}, {"role": "user", "content": user_msg}],
            temperature=0.7, max_tokens=4500, json_mode=True)
        import json as _json
        data = _json.loads(res.get("content") or "{}")

        course_id = (plan.get("courses") or {}).get(student["user_id"])
        if not course_id:
            course_id = uuid.uuid4().hex
            await db.rc_courses.insert_one({
                "id": course_id, "center_id": plan["center_id"],
                "title": f"{plan['title']} — @{student['username']}"[:200],
                "subject": ", ".join(subjects)[:120],
                "description": f"ORAi adaptive learning path for @{student['username']} ({student.get('grade_text') or ''}).",
                "grade_level": student.get("grade_text") or "", "status": "published",
                "color": "#10E670", "source_prompt": plan["request_text"],
                "settings": {"requires_approval": False}, "storyboard": None, "style_profile": None,
                "created_by": plan["created_by"], "created_at": _iso(), "updated_at": _iso(),
                "published_at": _iso(), "modules": [{"id": uuid.uuid4().hex[:8], "title": "Daily Lessons", "lesson_ids": []}],
                "lesson_count": 0, "edu_plan_id": plan["id"]})
            await db.edu_plans.update_one({"id": plan["id"]}, {"$set": {f"courses.{student['user_id']}": course_id}})
        course = await db.rc_courses.find_one({"id": course_id}, {"_id": 0, "modules": 1, "lesson_count": 1})
        lesson_id = uuid.uuid4().hex
        blocks = _clean_blocks(data.get("blocks"))
        if not blocks:
            raise ValueError("empty lesson")
        lesson = {"id": lesson_id, "course_id": course_id, "center_id": plan["center_id"],
                  "module_id": course["modules"][0]["id"], "order": course.get("lesson_count") or 0,
                  "title": str(data.get("title") or f"{subject} — {day_iso}")[:200],
                  "lesson_type": "lesson", "duration_min": int(data.get("duration_min") or 20),
                  "blocks": blocks, "quiz": _clean_quiz(data.get("quiz")),
                  "edu_plan_id": plan["id"], "edu_date": day_iso,
                  "parent_note": str(data.get("parent_note") or "")[:500],
                  "created_at": _iso(), "updated_at": _iso()}
        await db.rc_course_lessons.insert_one({**lesson})
        await db.rc_courses.update_one(
            {"id": course_id, "modules.id": course["modules"][0]["id"]},
            {"$push": {"modules.$.lesson_ids": lesson_id},
             "$inc": {"lesson_count": 1}, "$set": {"updated_at": _iso()}})
        cost = EST_LESSON_COST
        if plan["media"].get("images"):
            img_prompt = (f"Friendly illustration for the lesson \"{lesson['title']}\" ({subject}, "
                          f"{student.get('grade_text') or 'all ages'}). Scene: {blocks[0].get('body', '')[:200]}. No text.")
            try:
                url = await _gen_image(img_prompt, plan["created_by"], retries=1)
                await db.rc_course_lessons.update_one(
                    {"id": lesson_id, "blocks.id": blocks[0]["id"]},
                    {"$set": {"blocks.$.image_url": url}})
                cost += EST_IMAGE_COST
            except Exception as e:  # noqa: BLE001
                await media_retry.enqueue(gen_job_id=None, center_id=plan["center_id"], course_id=course_id,
                                          asset_type="image", label=f"Image: {lesson['title'][:60]}",
                                          prompt=img_prompt, created_by=plan["created_by"],
                                          created_by_username=plan.get("created_by_username"),
                                          lesson_id=lesson_id, block_id=blocks[0]["id"], error=e)
        await db.edu_plan_runs.update_one({"id": run["id"]}, {"$set": {
            "status": "done", "lesson_id": lesson_id, "lesson_title": lesson["title"],
            "subject": subject, "course_id": course_id,
            "adaptation": str(data.get("adaptation_note") or "")[:300], "finished_at": _iso()}})
        await db.edu_plans.update_one({"id": plan["id"]}, {"$inc": {
            "usage.lessons_generated": 1, "usage.est_spent": round(cost, 3)}})
        from services import responsibility_center as rc
        await rc.notify_user(student["user_id"], "rc_course_lesson_ready",
                             f"Your new {subject} lesson \"{lesson['title']}\" is ready!",
                             f"/responsibility-center/{plan['center_id']}/courses/{course_id}",
                             center_id=plan["center_id"])
        return {"ok": True}
    except Exception as e:  # noqa: BLE001
        log.warning("edu lesson generation failed (%s / %s): %s", plan["id"], student["username"], e)
        await db.edu_plan_runs.update_one({"id": run["id"]}, {"$set": {
            "status": "failed", "error": str(e)[:300], "finished_at": _iso()}})
        return {"ok": False, "error": str(e)}


async def _generate_day(plan_id: str, day_iso: str, first: bool = False):
    plan = await db.edu_plans.find_one({"id": plan_id}, {"_id": 0})
    if not plan or plan["status"] != "active":
        return
    remaining = []
    for student in plan["students"]:
        exists = await db.edu_plan_runs.find_one(
            {"plan_id": plan_id, "student_id": student["user_id"], "date": day_iso,
             "status": {"$in": ["generating", "done"]}}, {"_id": 0, "id": 1})
        if not exists:
            remaining.append(student)
    if not remaining:
        return  # today already complete — nothing to do, never a false cap-pause
    cap = await _caps_exceeded(plan)
    if cap:
        await _pause_for_cap(plan, cap)
        return
    for student in remaining:
        cap = await _caps_exceeded(plan)
        if cap:
            await _pause_for_cap(plan, cap)
            return
        await _generate_student_lesson(plan, student, day_iso)
    await db.edu_plans.update_one({"id": plan_id}, {"$set": {
        "last_generated_date": day_iso, "updated_at": _iso()}})
    await audit({"id": plan["created_by"], "username": "ORAi"},
                "daily_lessons_generated" if not first else "first_lessons_generated",
                plan_id, plan["center_id"], detail=day_iso)


async def _pause_for_cap(plan, cap_name):
    await db.edu_plans.update_one({"id": plan["id"]}, {"$set": {
        "status": "paused", "paused_reason": f"Reached the {cap_name} — completed work is preserved",
        "updated_at": _iso()}})
    from services import responsibility_center as rc
    await rc.notify_user(plan["created_by"], "edu_plan_paused",
                         f"Learning plan \"{plan['title']}\" paused: {cap_name} reached. Resume anytime after reviewing limits.",
                         f"/responsibility-center/{plan['center_id']}/education?plan={plan['id']}",
                         center_id=plan["center_id"])
    await audit(None, "plan_paused_cap", plan["id"], plan["center_id"], detail=cap_name)


# ── Scheduler (restart-safe, claim-locked) ───────────────────────────────
_started = False


async def start_education_worker():
    global _started
    if _started:
        return
    _started = True
    asyncio.create_task(_loop())
    log.info("education plan worker started")


async def _loop():
    while True:
        try:
            await run_education_pass()
        except Exception as e:  # noqa: BLE001
            log.warning("education pass error: %s", e)
        await asyncio.sleep(300)


async def run_education_pass():
    plans = await db.edu_plans.find({"status": "active"}, {"_id": 0}).to_list(100)
    for plan in plans:
        try:
            tz = ZoneInfo(plan["schedule"]["timezone"])
        except Exception:  # noqa: BLE001
            tz = timezone.utc
        now_local = datetime.now(tz)
        today = now_local.date()
        if today.isoformat() > plan["schedule"]["end_date"]:
            await db.edu_plans.update_one({"id": plan["id"]}, {"$set": {"status": "completed", "updated_at": _iso()}})
            await audit(None, "plan_completed", plan["id"], plan["center_id"])
            continue
        if not _is_learning_day(plan, today):
            continue
        gen_h, gen_m = (plan["schedule"].get("generation_time") or "19:00").split(":")
        if (now_local.hour, now_local.minute) < (int(gen_h), int(gen_m)):
            continue
        if plan.get("last_generated_date") == today.isoformat():
            continue
        claimed = await db.edu_plans.find_one_and_update(
            {"id": plan["id"], "status": "active",
             "last_generated_date": {"$ne": today.isoformat()}},
            {"$set": {"last_generated_date": today.isoformat(), "updated_at": _iso()}})
        if claimed:
            asyncio.create_task(_generate_day(plan["id"], today.isoformat()))
