"""Responsibility Center — AI Course Studio + Course Player backend.

Center owners generate complete, fully-editable courses from one prompt
(structure, lessons, activities, quizzes with answer keys, worksheets,
homework, projects, review material, checkpoints). Members learn through
the Course Player with progress, approvals, achievements, and a
non-accredited completion certificate.

Collections: rc_courses, rc_course_lessons, rc_course_progress,
rc_course_state, rc_course_tutor_messages.
"""
import json
import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from services.chat_conversations import call_openai_chat
from services.rc_units import _ctx
from services import responsibility_center as rc
from utils.sliding_window_rate_limit import rate_limit

log = logging.getLogger("ourrealm.rc.courses")
router = APIRouter(prefix="/api/responsibility-center", tags=["rc-courses"])

BLOCK_TYPES = {"text", "activity", "worksheet", "homework", "project", "review"}
LESSON_TYPES = {"lesson", "quiz", "checkpoint"}
COURSE_COLORS = ["#2EA0FF", "#10E670", "#C26BFF", "#F4A73B", "#4DD6C1", "#FF8A5A"]


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _can_manage(perms: set) -> bool:
    return "edit_center" in perms or "assign_items" in perms


GEN_SYSTEM = """You are ORAi Course Studio, an expert curriculum designer for OurRealm Education Centers.
Design a complete course from the owner's prompt. Reply with ONLY valid JSON — no markdown fences, no commentary.

JSON shape:
{
  "title": "course title",
  "subject": "subject area",
  "description": "2-3 sentence course description",
  "grade_level": "target level, e.g. 'Grade 5' or 'Beginner'",
  "modules": [
    {
      "title": "module title",
      "lessons": [
        {
          "title": "lesson title",
          "lesson_type": "lesson" | "quiz" | "checkpoint",
          "duration_min": 20,
          "blocks": [
            {"type": "text", "title": "section heading", "body": "teaching content, 2-4 paragraphs"},
            {"type": "activity", "title": "...", "body": "step-by-step interactive activity"},
            {"type": "worksheet", "title": "...", "body": "printable practice problems / exercises"},
            {"type": "homework", "title": "...", "body": "take-home assignment"},
            {"type": "project", "title": "...", "body": "hands-on project brief"},
            {"type": "review", "title": "...", "body": "key points recap"}
          ],
          "quiz": {
            "questions": [
              {"q": "question text", "options": ["A", "B", "C", "D"], "answer_index": 0,
               "explanation": "why this answer is correct"}
            ]
          }
        }
      ]
    }
  ]
}

Rules:
- 2-4 modules. Respect the requested lesson count if given, otherwise 6-10 lessons total.
- Every "lesson" needs 3-6 blocks mixing types (always at least one text block; include worksheets,
  homework, activities, projects and review material across the course).
- Every "quiz" lesson needs 4-8 questions with exactly 4 options each and correct answer_index + explanation (the answer key).
- End each module with a "checkpoint" lesson: 1 review block + 3-5 quiz questions. Checkpoints are progress gates.
- Content must be age-appropriate for the grade level, accurate, and engaging.
- This is an informal learning tool — never claim accreditation."""


def _parse_course_json(raw: str) -> dict:
    txt = (raw or "").strip()
    txt = re.sub(r"^```(?:json)?\s*|\s*```$", "", txt)
    start, end = txt.find("{"), txt.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object found")
    return json.loads(txt[start:end + 1])


def _clean_quiz(quiz) -> dict:
    qs = []
    for q in (quiz or {}).get("questions", [])[:12]:
        opts = [str(o)[:300] for o in (q.get("options") or [])[:6]]
        if len(opts) < 2 or not q.get("q"):
            continue
        idx = q.get("answer_index")
        idx = idx if isinstance(idx, int) and 0 <= idx < len(opts) else 0
        qs.append({"id": uuid.uuid4().hex[:8], "q": str(q["q"])[:600], "options": opts,
                   "answer_index": idx, "explanation": str(q.get("explanation") or "")[:600]})
    return {"questions": qs}


def _clean_blocks(blocks) -> list:
    out = []
    for b in (blocks or [])[:10]:
        btype = b.get("type") if b.get("type") in BLOCK_TYPES else "text"
        body = str(b.get("body") or "").strip()
        if not body:
            continue
        out.append({"id": uuid.uuid4().hex[:8], "type": btype,
                    "title": str(b.get("title") or "")[:200], "body": body[:8000],
                    "image_url": b.get("image_url") or None})
    return out


async def _course(center_id: str, course_id: str) -> dict:
    c = await db.rc_courses.find_one({"id": course_id, "center_id": center_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Course not found")
    return c


async def _lessons(course_id: str) -> list:
    return await db.rc_course_lessons.find(
        {"course_id": course_id}, {"_id": 0}).sort("order", 1).to_list(200)


async def _progress_map(course_id: str, user_id: str) -> dict:
    rows = await db.rc_course_progress.find(
        {"course_id": course_id, "user_id": user_id}, {"_id": 0}).to_list(500)
    return {r["lesson_id"]: r for r in rows}


def _achievements(done: int, total: int, avg_score) -> list:
    if not total:
        return []
    pct = done / total
    out = []
    if done >= 1:
        out.append({"id": "first_lesson", "label": "First Lesson Complete", "icon": "flag"})
    if pct >= 0.25:
        out.append({"id": "quarter", "label": "25% Through the Course", "icon": "trending-up"})
    if pct >= 0.5:
        out.append({"id": "half", "label": "Halfway Hero", "icon": "medal"})
    if pct >= 0.75:
        out.append({"id": "three_quarters", "label": "Almost There — 75%", "icon": "rocket"})
    if pct >= 1:
        out.append({"id": "complete", "label": "Course Complete", "icon": "trophy"})
    if avg_score is not None and avg_score >= 90:
        out.append({"id": "ace", "label": "Quiz Ace (90%+ average)", "icon": "star"})
    return out


# ── Generation ──────────────────────────────────────────────────────────
@router.post("/{center_id}/courses/generate")
async def generate_course(center_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "edit_center")
    rl = await rate_limit(f"course-gen:{current['id']}", max_requests=6, window_seconds=3600)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail=f"Course generation limit reached — try again in {rl['retry_after']}s")
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Describe the course you want first")
    if len(prompt) > 2000:
        raise HTTPException(status_code=400, detail="Prompt is too long")
    extras = []
    grade_text = str(body.get("grade_level") or "")[:60]
    # Grade-aware generation: use the target member's saved learning level.
    target_member = str(body.get("member_id") or current["id"])
    try:
        edu = await db.rc_member_education.find_one(
            {"center_id": center_id, "user_id": target_member}, {"_id": 0})
    except Exception:
        edu = None
    if not grade_text and edu and edu.get("grade_text"):
        grade_text = edu["grade_text"][:60]
    if grade_text:
        extras.append(f"Target grade level: {grade_text}")
        style = VISUAL_STYLE.get(normalize_grade(grade_text))
        if style:
            extras.append(f"Visual & tone guidance (MUST follow): {style} "
                          "Adapt vocabulary, reading difficulty, lesson length, "
                          "instructions, examples, activities, quiz difficulty and "
                          "amount of text to this level.")
    if body.get("lesson_count"):
        extras.append(f"Requested lesson count: {int(body['lesson_count'])}")
    # Approved Course Blueprint (ORAi blueprint-first flow)
    if isinstance(body.get("blueprint"), dict):
        bp = body["blueprint"]
        bp_lines = [f"APPROVED BLUEPRINT — follow it exactly:",
                    f"Title: {str(bp.get('title') or '')[:200]}",
                    f"Description: {str(bp.get('description') or '')[:500]}",
                    f"Difficulty: {bp.get('difficulty')} · Learning style: {bp.get('learning_style')}"]
        for m in (bp.get("modules") or [])[:12]:
            bp_lines.append(f"Module: {str(m.get('title'))[:150]} — lessons: "
                            + "; ".join(str(t)[:100] for t in (m.get("lessons") or [])[:15]))
        extras.append("\n".join(bp_lines))
    user_msg = prompt + ("\n\n" + "\n".join(extras) if extras else "")

    try:
        from routers.admin_orai import get_orai_config
        cfg = await get_orai_config()
        gen_cfg = cfg.get("course_generator", {})
    except Exception:
        gen_cfg = {}
    max_lessons = int(gen_cfg.get("max_lessons") or 20)
    temperature = float(gen_cfg.get("temperature") or 0.7)
    if body.get("lesson_count") and int(body["lesson_count"]) > max_lessons:
        user_msg += f"\nHard cap: at most {max_lessons} lessons."

    result = await call_openai_chat(
        [{"role": "system", "content": GEN_SYSTEM}, {"role": "user", "content": user_msg}],
        temperature=temperature, max_tokens=8000)
    try:
        data = _parse_course_json(result.get("content") or "")
    except Exception as e:
        log.warning("course generation JSON parse failed: %s", e)
        raise HTTPException(status_code=502, detail="ORAi could not build that course — try rephrasing your prompt")

    course_id = uuid.uuid4().hex
    now = _iso()
    modules, lesson_docs, order = [], [], 0
    for m in (data.get("modules") or [])[:6]:
        mod_id = uuid.uuid4().hex[:8]
        mod_lessons = []
        for les in (m.get("lessons") or [])[:15]:
            ltype = les.get("lesson_type") if les.get("lesson_type") in LESSON_TYPES else "lesson"
            lid = uuid.uuid4().hex
            lesson_docs.append({
                "id": lid, "course_id": course_id, "center_id": center_id,
                "module_id": mod_id, "order": order,
                "title": str(les.get("title") or f"Lesson {order + 1}")[:200],
                "lesson_type": ltype,
                "duration_min": int(les.get("duration_min") or 15),
                "blocks": _clean_blocks(les.get("blocks")),
                "quiz": _clean_quiz(les.get("quiz")) if ltype in ("quiz", "checkpoint") else {"questions": []},
                "created_at": now, "updated_at": now,
            })
            mod_lessons.append(lid)
            order += 1
        modules.append({"id": mod_id, "title": str(m.get("title") or "Module")[:200],
                        "lesson_ids": mod_lessons})
    if not lesson_docs:
        raise HTTPException(status_code=502, detail="ORAi returned an empty course — try again")

    course = {
        "id": course_id, "center_id": center_id,
        "title": str(data.get("title") or prompt[:60])[:200],
        "subject": str(data.get("subject") or "")[:120],
        "description": str(data.get("description") or "")[:1000],
        "grade_level": str(data.get("grade_level") or body.get("grade_level") or "")[:60],
        "status": "draft",
        "color": COURSE_COLORS[len(course_id) % len(COURSE_COLORS)],
        "source_prompt": prompt,
        "settings": {"requires_approval": bool(body.get("requires_approval", True))},
        "created_by": current["id"], "created_at": now, "updated_at": now,
        "published_at": None, "modules": modules, "lesson_count": len(lesson_docs),
    }
    await db.rc_courses.insert_one({**course})
    await db.rc_course_lessons.insert_many([{**d} for d in lesson_docs])
    await rc.log_activity(center_id, current, "course_generated",
                          f"@{current.get('username')} generated the course \"{course['title']}\" with ORAi")
    return {"course": course}


# ── Course CRUD ─────────────────────────────────────────────────────────
@router.get("/{center_id}/courses")
async def list_courses(center_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    manage = _can_manage(perms)
    q = {"center_id": center_id}
    if not manage:
        q["status"] = "published"
    rows = await db.rc_courses.find(q, {"_id": 0, "source_prompt": 0}).sort("created_at", -1).to_list(100)
    # single aggregation instead of a per-course progress query
    agg = await db.rc_course_progress.aggregate([
        {"$match": {"center_id": center_id, "user_id": current["id"], "status": "completed"}},
        {"$group": {"_id": "$course_id", "done": {"$sum": 1}}}]).to_list(200)
    done_map = {a["_id"]: a["done"] for a in agg}
    out = []
    for c in rows:
        done = done_map.get(c["id"], 0)
        out.append({**c, "my_completed": done,
                    "my_pct": round(done / c["lesson_count"] * 100) if c.get("lesson_count") else 0})
    return {"courses": out, "can_manage": manage}


@router.get("/{center_id}/courses/{course_id}")
async def course_detail(center_id: str, course_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    manage = _can_manage(perms)
    if not manage:
        from routers.rc_routines import check_feature_access
        await check_feature_access(center_id, current["id"], "courses")
    course = await _course(center_id, course_id)
    if course["status"] != "published" and not manage:
        raise HTTPException(status_code=403, detail="This course isn't published yet")
    lessons = await _lessons(course_id)
    if not manage:  # hide answer keys from learners
        for les in lessons:
            for q in les.get("quiz", {}).get("questions", []):
                q.pop("answer_index", None)
                q.pop("explanation", None)
    prog = await _progress_map(course_id, current["id"])
    state = await db.rc_course_state.find_one(
        {"course_id": course_id, "user_id": current["id"]}, {"_id": 0})
    scores = [p["score"] / p["total"] * 100 for p in prog.values()
              if p.get("total") and p.get("score") is not None]
    avg = round(sum(scores) / len(scores)) if scores else None
    done = sum(1 for p in prog.values() if p["status"] == "completed")
    return {"course": course, "lessons": lessons, "progress": prog,
            "resume_lesson_id": (state or {}).get("last_lesson_id"),
            "my_completed": done, "avg_score": avg,
            "achievements": _achievements(done, course.get("lesson_count") or len(lessons), avg),
            "can_manage": manage}


@router.patch("/{center_id}/courses/{course_id}")
async def update_course(center_id: str, course_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "edit_center")
    course = await _course(center_id, course_id)
    patch = {}
    for k in ("title", "subject", "description", "grade_level"):
        if k in body:
            patch[k] = str(body[k] or "")[:1000 if k == "description" else 200]
    if "modules" in body and isinstance(body["modules"], list):
        patch["modules"] = [{"id": m.get("id") or uuid.uuid4().hex[:8],
                             "title": str(m.get("title") or "Module")[:200],
                             "lesson_ids": [str(x) for x in (m.get("lesson_ids") or [])]}
                            for m in body["modules"][:10]]
    if "requires_approval" in body:
        patch["settings.requires_approval"] = bool(body["requires_approval"])
    if body.get("status") in ("draft", "published"):
        patch["status"] = body["status"]
        if body["status"] == "published" and not course.get("published_at"):
            patch["published_at"] = _iso()
            await rc.log_activity(center_id, current, "course_published",
                                  f"@{current.get('username')} published the course \"{course['title']}\"")
    if patch:
        patch["updated_at"] = _iso()
        await db.rc_courses.update_one({"id": course_id}, {"$set": patch})
    return {"course": await _course(center_id, course_id)}


@router.delete("/{center_id}/courses/{course_id}")
async def delete_course(center_id: str, course_id: str, current: CurrentUser):
    await _ctx(center_id, current, "edit_center")
    course = await _course(center_id, course_id)
    await db.rc_courses.delete_one({"id": course_id})
    await db.rc_course_lessons.delete_many({"course_id": course_id})
    await db.rc_course_progress.delete_many({"course_id": course_id})
    await db.rc_course_state.delete_many({"course_id": course_id})
    await db.rc_course_tutor_messages.delete_many({"course_id": course_id})
    await rc.log_activity(center_id, current, "course_deleted",
                          f"@{current.get('username')} deleted the course \"{course['title']}\"")
    return {"ok": True}


# ── Lesson editing ──────────────────────────────────────────────────────
@router.post("/{center_id}/courses/{course_id}/lessons")
async def add_lesson(center_id: str, course_id: str, body: dict, current: CurrentUser):
    await _ctx(center_id, current, "edit_center")
    course = await _course(center_id, course_id)
    lessons = await _lessons(course_id)
    ltype = body.get("lesson_type") if body.get("lesson_type") in LESSON_TYPES else "lesson"
    lesson = {"id": uuid.uuid4().hex, "course_id": course_id, "center_id": center_id,
              "module_id": body.get("module_id") or (course["modules"][-1]["id"] if course["modules"] else "m1"),
              "order": len(lessons),
              "title": str(body.get("title") or "New lesson")[:200], "lesson_type": ltype,
              "duration_min": int(body.get("duration_min") or 15),
              "blocks": _clean_blocks(body.get("blocks")) or
                        [{"id": uuid.uuid4().hex[:8], "type": "text", "title": "", "body": "Write your lesson content here.", "image_url": None}],
              "quiz": _clean_quiz(body.get("quiz")),
              "created_at": _iso(), "updated_at": _iso()}
    await db.rc_course_lessons.insert_one({**lesson})
    await db.rc_courses.update_one(
        {"id": course_id, "modules.id": lesson["module_id"]},
        {"$push": {"modules.$.lesson_ids": lesson["id"]}, "$inc": {"lesson_count": 1}})
    return {"lesson": lesson}


@router.patch("/{center_id}/courses/{course_id}/lessons/{lesson_id}")
async def update_lesson(center_id: str, course_id: str, lesson_id: str, body: dict, current: CurrentUser):
    await _ctx(center_id, current, "edit_center")
    lesson = await db.rc_course_lessons.find_one(
        {"id": lesson_id, "course_id": course_id}, {"_id": 0})
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    patch = {}
    if "title" in body:
        patch["title"] = str(body["title"] or "")[:200]
    if "duration_min" in body:
        patch["duration_min"] = max(1, min(600, int(body["duration_min"] or 15)))
    if body.get("lesson_type") in LESSON_TYPES:
        patch["lesson_type"] = body["lesson_type"]
    if "order" in body:
        patch["order"] = int(body["order"])
    if "blocks" in body:
        blocks = []
        for b in (body["blocks"] or [])[:10]:
            btype = b.get("type") if b.get("type") in BLOCK_TYPES else "text"
            blocks.append({"id": b.get("id") or uuid.uuid4().hex[:8], "type": btype,
                           "title": str(b.get("title") or "")[:200],
                           "body": str(b.get("body") or "")[:8000],
                           "image_url": b.get("image_url") or None})
        patch["blocks"] = blocks
    if "quiz" in body:
        qs = []
        for q in (body["quiz"] or {}).get("questions", [])[:12]:
            opts = [str(o)[:300] for o in (q.get("options") or [])[:6]]
            if len(opts) < 2 or not q.get("q"):
                continue
            idx = q.get("answer_index")
            qs.append({"id": q.get("id") or uuid.uuid4().hex[:8], "q": str(q["q"])[:600],
                       "options": opts,
                       "answer_index": idx if isinstance(idx, int) and 0 <= idx < len(opts) else 0,
                       "explanation": str(q.get("explanation") or "")[:600]})
        patch["quiz"] = {"questions": qs}
    if patch:
        patch["updated_at"] = _iso()
        await db.rc_course_lessons.update_one({"id": lesson_id}, {"$set": patch})
    updated = await db.rc_course_lessons.find_one({"id": lesson_id}, {"_id": 0})
    return {"lesson": updated}


@router.delete("/{center_id}/courses/{course_id}/lessons/{lesson_id}")
async def delete_lesson(center_id: str, course_id: str, lesson_id: str, current: CurrentUser):
    await _ctx(center_id, current, "edit_center")
    r = await db.rc_course_lessons.delete_one({"id": lesson_id, "course_id": course_id})
    if r.deleted_count != 1:
        raise HTTPException(status_code=404, detail="Lesson not found")
    await db.rc_courses.update_one(
        {"id": course_id},
        {"$pull": {"modules.$[].lesson_ids": lesson_id}, "$inc": {"lesson_count": -1}})
    await db.rc_course_progress.delete_many({"lesson_id": lesson_id})
    return {"ok": True}


@router.post("/{center_id}/courses/{course_id}/lessons/{lesson_id}/image")
async def lesson_image(center_id: str, course_id: str, lesson_id: str, body: dict, current: CurrentUser):
    """Generate an illustration for a lesson block with ORAi."""
    await _ctx(center_id, current, "edit_center")
    lesson = await db.rc_course_lessons.find_one(
        {"id": lesson_id, "course_id": course_id}, {"_id": 0})
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    from services.orai_images import generate_orai_image
    from services import image_store
    prompt = (body.get("prompt") or f"Friendly, colorful educational illustration for a lesson titled \"{lesson['title']}\". Clean, kid-safe, no text.")[:800]
    try:
        img_bytes, _model = await generate_orai_image(prompt)
        record = await image_store.save_bytes(img_bytes, current["id"], "image/png")
    except Exception as e:
        log.warning("lesson image generation failed: %s", e)
        raise HTTPException(status_code=502, detail="Image generation is unavailable right now")
    block_id = body.get("block_id")
    if block_id:
        await db.rc_course_lessons.update_one(
            {"id": lesson_id, "blocks.id": block_id},
            {"$set": {"blocks.$.image_url": record.original_url, "updated_at": _iso()}})
    return {"image_url": record.original_url}


# ── Player ──────────────────────────────────────────────────────────────
@router.post("/{center_id}/courses/{course_id}/position")
async def save_position(center_id: str, course_id: str, body: dict, current: CurrentUser):
    await _ctx(center_id, current, "view_items", write=False)
    await db.rc_course_state.update_one(
        {"course_id": course_id, "user_id": current["id"]},
        {"$set": {"last_lesson_id": body.get("lesson_id"), "updated_at": _iso()},
         "$setOnInsert": {"center_id": center_id}}, upsert=True)
    return {"ok": True}


@router.post("/{center_id}/courses/{course_id}/lessons/{lesson_id}/complete")
async def complete_lesson(center_id: str, course_id: str, lesson_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    course = await _course(center_id, course_id)
    lesson = await db.rc_course_lessons.find_one(
        {"id": lesson_id, "course_id": course_id}, {"_id": 0})
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    existing = await db.rc_course_progress.find_one(
        {"course_id": course_id, "lesson_id": lesson_id, "user_id": current["id"]}, {"_id": 0})
    if existing and existing["status"] == "completed":
        return {"progress": existing, "already": True}
    needs_approval = (lesson["lesson_type"] == "checkpoint"
                      and course.get("settings", {}).get("requires_approval")
                      and not _can_manage(perms))
    doc = {"id": (existing or {}).get("id") or uuid.uuid4().hex,
           "course_id": course_id, "center_id": center_id, "lesson_id": lesson_id,
           "user_id": current["id"], "username": current.get("username"),
           "lesson_title": lesson["title"],
           "status": "pending_approval" if needs_approval else "completed",
           "score": body.get("score"), "total": body.get("total"),
           "answers": body.get("answers"), "completed_at": _iso(), "approved_by": None}
    await db.rc_course_progress.update_one(
        {"course_id": course_id, "lesson_id": lesson_id, "user_id": current["id"]},
        {"$set": doc}, upsert=True)
    if doc["status"] == "completed":
        try:
            from routers.rc_automations import fire_trigger
            await fire_trigger(center_id, "lesson_completed",
                               {"user_id": current["id"], "username": current.get("username"),
                                "lesson_title": lesson["title"]})
        except Exception as e:
            log.warning("lesson_completed automation failed: %s", e)
    return {"progress": doc, "needs_approval": needs_approval}


@router.post("/{center_id}/courses/{course_id}/lessons/{lesson_id}/quiz")
async def submit_quiz(center_id: str, course_id: str, lesson_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    lesson = await db.rc_course_lessons.find_one(
        {"id": lesson_id, "course_id": course_id}, {"_id": 0})
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    questions = lesson.get("quiz", {}).get("questions", [])
    if not questions:
        raise HTTPException(status_code=400, detail="This lesson has no quiz")
    answers = body.get("answers") or {}
    results, score = [], 0
    for q in questions:
        picked = answers.get(q["id"])
        correct = picked == q["answer_index"]
        score += 1 if correct else 0
        results.append({"id": q["id"], "correct": correct, "picked": picked,
                        "answer_index": q["answer_index"],
                        "explanation": q.get("explanation") or ""})
    # record completion (checkpoints may still need approval)
    completion = await complete_lesson(center_id, course_id, lesson_id,
                                       {"score": score, "total": len(questions),
                                        "answers": answers}, current)
    return {"score": score, "total": len(questions),
            "pct": round(score / len(questions) * 100), "results": results,
            "needs_approval": completion.get("needs_approval", False)}


# ── Approvals (parent / teacher) ────────────────────────────────────────
@router.get("/{center_id}/courses/{course_id}/approvals")
async def list_approvals(center_id: str, course_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    if not _can_manage(perms):
        raise HTTPException(status_code=403, detail="Managers only")
    rows = await db.rc_course_progress.find(
        {"course_id": course_id, "status": "pending_approval"}, {"_id": 0}).to_list(200)
    return {"approvals": rows}


@router.post("/{center_id}/courses/{course_id}/approvals/{progress_id}")
async def decide_approval(center_id: str, course_id: str, progress_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "edit_center")
    p = await db.rc_course_progress.find_one(
        {"id": progress_id, "course_id": course_id, "status": "pending_approval"}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Approval not found")
    approve = bool(body.get("approve"))
    if approve:
        await db.rc_course_progress.update_one(
            {"id": progress_id},
            {"$set": {"status": "completed", "approved_by": current["id"], "approved_at": _iso()}})
        try:
            from routers.rc_automations import fire_trigger
            await fire_trigger(center_id, "checkpoint_approved",
                               {"user_id": p["user_id"], "username": p.get("username"),
                                "lesson_title": p.get("lesson_title")})
        except Exception as e:
            log.warning("checkpoint_approved automation failed: %s", e)
    else:
        await db.rc_course_progress.delete_one({"id": progress_id})
    await rc.log_activity(center_id, current, "course_checkpoint_review",
                          f"@{current.get('username')} {'approved' if approve else 'sent back'} "
                          f"@{p.get('username')}'s checkpoint \"{p.get('lesson_title')}\"")
    return {"ok": True}


# ── Reports & certificate ───────────────────────────────────────────────
@router.get("/{center_id}/courses/{course_id}/report")
async def course_report(center_id: str, course_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    if not _can_manage(perms):
        raise HTTPException(status_code=403, detail="Managers only")
    course = await _course(center_id, course_id)
    total = course.get("lesson_count") or 1
    rows = await db.rc_course_progress.find({"course_id": course_id}, {"_id": 0}).to_list(2000)
    students = {}
    for r in rows:
        s = students.setdefault(r["user_id"], {"user_id": r["user_id"], "username": r.get("username"),
                                               "completed": 0, "pending": 0, "scores": []})
        if r["status"] == "completed":
            s["completed"] += 1
        elif r["status"] == "pending_approval":
            s["pending"] += 1
        if r.get("total") and r.get("score") is not None:
            s["scores"].append(r["score"] / r["total"] * 100)
    out = []
    for s in students.values():
        out.append({"user_id": s["user_id"], "username": s["username"],
                    "completed": s["completed"], "pending": s["pending"],
                    "pct": round(s["completed"] / total * 100),
                    "avg_score": round(sum(s["scores"]) / len(s["scores"])) if s["scores"] else None})
    out.sort(key=lambda x: -x["pct"])
    return {"course": {"id": course_id, "title": course["title"], "lesson_count": total},
            "students": out}


@router.get("/{center_id}/courses/{course_id}/certificate")
async def certificate(center_id: str, course_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    course = await _course(center_id, course_id)
    total = course.get("lesson_count") or 0
    prog = await _progress_map(course_id, current["id"])
    done = [p for p in prog.values() if p["status"] == "completed"]
    if not total or len(done) < total:
        raise HTTPException(status_code=409, detail="Finish every lesson to earn the certificate")
    scores = [p["score"] / p["total"] * 100 for p in done if p.get("total") and p.get("score") is not None]
    user = await db.users.find_one({"id": current["id"]}, {"_id": 0, "name": 1, "username": 1})
    return {"certificate_id": f"ORC-{course_id[:6].upper()}-{current['id'][:6].upper()}",
            "course_title": course["title"], "center_name": center["name"],
            "student_name": user.get("name") or user.get("username"),
            "completed_at": max(p["completed_at"] for p in done),
            "lessons_completed": len(done), "avg_score": round(sum(scores) / len(scores)) if scores else None,
            "disclaimer": "Certificate of completion issued by this OurRealm Center. "
                          "Informal recognition only — not an accredited credential."}


# ── AI Tutor (per lesson) ───────────────────────────────────────────────
TUTOR_SYSTEM = """You are ORAi Tutor inside the OurRealm Course Player. Help the learner understand THIS lesson.
- Explain simply, step by step, matching the course's grade level.
- NEVER just give quiz answers — guide the learner to work them out.
- Be encouraging and concise. Use short paragraphs or tight lists.
- No medical/legal/financial advice. This is an informal learning tool, not accredited.

LESSON CONTEXT:
{context}"""


@router.get("/{center_id}/courses/{course_id}/tutor/{lesson_id}")
async def tutor_history(center_id: str, course_id: str, lesson_id: str, current: CurrentUser):
    await _ctx(center_id, current, "view_items", write=False)
    rows = await db.rc_course_tutor_messages.find(
        {"course_id": course_id, "lesson_id": lesson_id, "user_id": current["id"]},
        {"_id": 0}).sort("created_at", 1).to_list(100)
    return {"messages": rows}


@router.post("/{center_id}/courses/{course_id}/tutor")
async def tutor_chat(center_id: str, course_id: str, body: dict, current: CurrentUser):
    await _ctx(center_id, current, "view_items", write=False)
    rl = await rate_limit(f"tutor:{current['id']}", max_requests=60, window_seconds=3600)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail="Tutor is taking a short break — try again in a minute")
    course = await _course(center_id, course_id)
    lesson_id = body.get("lesson_id") or ""
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Ask something first")
    lesson = await db.rc_course_lessons.find_one(
        {"id": lesson_id, "course_id": course_id}, {"_id": 0})
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    ctx_lines = [f"Course: {course['title']} ({course.get('grade_level') or 'all levels'})",
                 f"Lesson: {lesson['title']} ({lesson['lesson_type']})"]
    # Auto-context: learner grade profile + progress (no need to re-explain)
    try:
        _edu = await db.rc_member_education.find_one(
            {"center_id": center_id, "user_id": current["id"]}, {"_id": 0})
        if _edu and (_edu.get("grade_text") or _edu.get("grade_level")):
            lvl = _edu.get("grade_text") or _edu.get("grade_level")
            ctx_lines.append(f"Learner level: {lvl}. {VISUAL_STYLE.get(_edu.get('grade_level') or normalize_grade(lvl), '')} "
                             "Match vocabulary and tone to this level. Encourage, teach, "
                             "and give hints — never just hand over answers.")
        _done = await db.rc_course_progress.count_documents(
            {"course_id": course_id, "user_id": current["id"], "status": "completed"})
        ctx_lines.append(f"Learner has completed {_done} lesson(s) in this course so far.")
    except Exception:
        pass
    for b in lesson.get("blocks", [])[:6]:
        ctx_lines.append(f"[{b['type']}] {b.get('title') or ''}: {b['body'][:700]}")
    history = await db.rc_course_tutor_messages.find(
        {"course_id": course_id, "lesson_id": lesson_id, "user_id": current["id"]},
        {"_id": 0, "role": 1, "content": 1}).sort("created_at", 1).to_list(50)
    messages = ([{"role": "system", "content": TUTOR_SYSTEM.format(context="\n".join(ctx_lines)[:5000])}]
                + history[-12:] + [{"role": "user", "content": message}])
    result = await call_openai_chat(messages, temperature=0.6, max_tokens=700)
    reply = (result.get("content") or "").strip() or "Let's try that again — ask me once more."
    now = _iso()
    await db.rc_course_tutor_messages.insert_many([
        {"id": uuid.uuid4().hex, "course_id": course_id, "lesson_id": lesson_id,
         "center_id": center_id, "user_id": current["id"], "role": "user",
         "content": message, "created_at": now},
        {"id": uuid.uuid4().hex, "course_id": course_id, "lesson_id": lesson_id,
         "center_id": center_id, "user_id": current["id"], "role": "assistant",
         "content": reply, "created_at": _iso()},
    ])
    return {"reply": reply}


# ── Course Sharing (Phase 5) ────────────────────────────────────────────
SHARE_VISIBILITIES = {"private", "invite", "organization"}


@router.post("/{center_id}/courses/{course_id}/share")
async def share_course(center_id: str, course_id: str, body: dict, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "edit_center")
    course = await _course(center_id, course_id)
    if course["status"] != "published":
        raise HTTPException(status_code=409, detail="Publish the course before sharing it")
    visibility = body.get("visibility")
    if visibility not in SHARE_VISIBILITIES:
        raise HTTPException(status_code=400, detail="Pick a valid share visibility")
    await db.rc_courses.update_one({"id": course_id}, {"$set": {"share_visibility": visibility, "updated_at": _iso()}})
    await db.rc_course_shares.delete_many({"course_id": course_id})
    shares = []
    if visibility == "invite":
        for tcid in (body.get("center_ids") or [])[:20]:
            tc = await db.responsibility_centers.find_one({"id": tcid}, {"_id": 0, "id": 1, "name": 1})
            if not tc or tcid == center_id:
                continue
            shares.append({"id": uuid.uuid4().hex, "course_id": course_id,
                           "from_center_id": center_id, "from_center_name": center["name"],
                           "to_center_id": tcid, "visibility": "invite",
                           "created_by": current["id"], "created_at": _iso()})
    elif visibility == "organization":
        owned = await db.responsibility_centers.find(
            {"created_by": center["created_by"], "id": {"$ne": center_id}}, {"_id": 0, "id": 1}).to_list(50)
        for tc in owned:
            shares.append({"id": uuid.uuid4().hex, "course_id": course_id,
                           "from_center_id": center_id, "from_center_name": center["name"],
                           "to_center_id": tc["id"], "visibility": "organization",
                           "created_by": current["id"], "created_at": _iso()})
    if shares:
        await db.rc_course_shares.insert_many([{**s} for s in shares])
    await rc.log_activity(center_id, current, "course_shared",
                          f"@{current.get('username')} shared \"{course['title']}\" ({visibility})")
    return {"visibility": visibility, "shared_with": len(shares)}


@router.get("/{center_id}/courses-shared")
async def shared_with_me(center_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    shares = await db.rc_course_shares.find({"to_center_id": center_id}, {"_id": 0}).to_list(100)
    out = []
    for s in shares:
        c = await db.rc_courses.find_one(
            {"id": s["course_id"], "status": "published"},
            {"_id": 0, "id": 1, "title": 1, "subject": 1, "description": 1,
             "grade_level": 1, "lesson_count": 1, "color": 1, "created_by": 1})
        if not c:
            continue
        creator = await db.users.find_one({"id": c["created_by"]}, {"username": 1})
        out.append({**c, "from_center_name": s["from_center_name"],
                    "creator_username": (creator or {}).get("username"),
                    "share_id": s["id"]})
    return {"shared": out, "can_import": _can_manage(perms)}


@router.post("/{center_id}/courses-shared/{course_id}/import")
async def import_shared_course(center_id: str, course_id: str, current: CurrentUser):
    center, membership, perms = await _ctx(center_id, current, "edit_center")
    share = await db.rc_course_shares.find_one(
        {"course_id": course_id, "to_center_id": center_id}, {"_id": 0})
    if not share:
        raise HTTPException(status_code=403, detail="This course isn't shared with your Center")
    src = await db.rc_courses.find_one({"id": course_id}, {"_id": 0})
    if not src:
        raise HTTPException(status_code=404, detail="Course not found")
    creator = await db.users.find_one({"id": src["created_by"]}, {"username": 1})
    lessons = await db.rc_course_lessons.find({"course_id": course_id}, {"_id": 0}).to_list(300)
    new_id = uuid.uuid4().hex
    id_map = {}
    new_lessons = []
    for les in lessons:
        nl = {**les, "id": uuid.uuid4().hex, "course_id": new_id, "center_id": center_id,
              "created_at": _iso(), "updated_at": _iso()}
        id_map[les["id"]] = nl["id"]
        new_lessons.append(nl)
    course = {**src, "id": new_id, "center_id": center_id, "status": "draft",
              "published_at": None, "share_visibility": "private",
              "created_by": current["id"], "created_at": _iso(), "updated_at": _iso(),
              "credit": {"original_course_id": course_id,
                         "original_center": share["from_center_name"],
                         "original_creator": (creator or {}).get("username")},
              "modules": [{**m, "lesson_ids": [id_map.get(x) for x in m.get("lesson_ids", []) if id_map.get(x)]}
                          for m in src.get("modules", [])]}
    await db.rc_courses.insert_one({**course})
    if new_lessons:
        await db.rc_course_lessons.insert_many([{**d} for d in new_lessons])
    await rc.log_activity(center_id, current, "course_imported",
                          f"@{current.get('username')} imported \"{src['title']}\" "
                          f"(credit: @{(creator or {}).get('username')} · {share['from_center_name']})")
    return {"course_id": new_id, "credit": course["credit"]}


# ═══ AI Courses Preview — member selector, grade profiles (June 2026) ════
# Natural-language grade input → normalized learning level used by ORAi.
GRADE_ORDER = ["toddler", "pre_k", "kindergarten", "elementary", "middle_school",
               "high_school", "adult_beginner", "adult_advanced"]

VISUAL_STYLE = {
    "toddler": "Highly visual, simple, colorful and voice-friendly. Very little text, huge friendly shapes, playful cartoon illustrations.",
    "pre_k": "Bright, playful, colorful illustrated scenes with very simple words and short sentences.",
    "kindergarten": "Friendly illustrated educational graphics, simple clear words, cheerful colors.",
    "elementary": "Friendly illustrated educational graphics with clear explanations and labeled diagrams.",
    "middle_school": "More mature and detailed educational visuals — infographics and realistic diagrams, never childish.",
    "high_school": "Polished, realistic, cinematic, technical modern educational visuals appropriate for teenagers. NO preschool-style graphics.",
    "adult_beginner": "Clean professional modern visuals with approachable step-by-step explanations.",
    "adult_advanced": "Technical, dense, professional visuals — charts, schematics and real-world imagery.",
}


def normalize_grade(text: str) -> str:
    t = (text or "").lower().strip()
    if not t:
        return "elementary"
    if "toddler" in t or "baby" in t:
        return "toddler"
    if "pre-k" in t or "prek" in t or "pre k" in t or "preschool" in t:
        return "pre_k"
    if "kinder" in t:
        return "kindergarten"
    import re as _re
    m = _re.search(r"(\d{1,2})", t)
    if m and ("grade" in t or "th" in t or "st" in t or "nd" in t or "rd" in t):
        n = int(m.group(1))
        if n <= 5:
            return "elementary"
        if n <= 8:
            return "middle_school"
        return "high_school"
    if "high school" in t or "senior" in t or "freshman" in t or "sophomore" in t or "junior" in t or "teen" in t:
        return "high_school"
    if "middle" in t:
        return "middle_school"
    if "advanced" in t or "expert" in t or "pro" in t:
        return "adult_advanced"
    if "adult" in t or "beginner" in t or "college" in t:
        return "adult_beginner"
    if "elementary" in t or "primary" in t:
        return "elementary"
    return "elementary"


async def _member_education(center_id: str, user_id: str) -> dict:
    doc = await db.rc_member_education.find_one(
        {"center_id": center_id, "user_id": user_id}, {"_id": 0})
    return doc or {"center_id": center_id, "user_id": user_id,
                   "grade_text": "", "grade_level": "elementary", "ai_power": 60}


@router.patch("/{center_id}/members/{member_id}/education")
async def set_member_education(center_id: str, member_id: str, body: dict, current: CurrentUser):
    """Owner/authorized co-owner set a member's grade level + AI power."""
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    if not _can_manage(perms) and member_id != current["id"]:
        raise HTTPException(status_code=403, detail="You can only update your own learning profile")
    if not _can_manage(perms):
        raise HTTPException(status_code=403, detail="Education settings are managed by the Center owner")
    target = await db.responsibility_center_memberships.find_one(
        {"center_id": center_id, "user_id": member_id, "status": "active"})
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    grade_text = str(body.get("grade_text") or "").strip()[:60]
    update = {"center_id": center_id, "user_id": member_id,
              "updated_by": current["id"], "updated_at": _iso()}
    if "grade_text" in body:
        update["grade_text"] = grade_text
        update["grade_level"] = normalize_grade(grade_text)
    if "ai_power" in body:
        try:
            update["ai_power"] = max(0, min(100, int(body["ai_power"])))
        except Exception:
            pass
    await db.rc_member_education.update_one(
        {"center_id": center_id, "user_id": member_id}, {"$set": update}, upsert=True)
    return {"ok": True, "education": await _member_education(center_id, member_id)}


async def _preview_member_ids(center_id: str, current: dict, manage: bool, member_ids: str) -> list:
    requested = [m for m in (member_ids or "").split(",") if m.strip()]
    if not manage:
        # Regular member: ONLY their own data — enforced server-side.
        if any(m != current["id"] for m in requested):
            raise HTTPException(status_code=403, detail="You can only view your own learning data")
        return [current["id"]]
    if requested:
        return requested[:20]
    return [current["id"]]


@router.get("/{center_id}/courses-preview")
async def courses_preview(center_id: str, current: CurrentUser, member_ids: str = ""):
    """Member profile selector + per-member course summaries.
    Backend-authorized: non-managers are always scoped to themselves."""
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    manage = _can_manage(perms)
    mships = await db.responsibility_center_memberships.find(
        {"center_id": center_id, "status": "active"},
        {"_id": 0, "user_id": 1, "role": 1, "relationship": 1}).to_list(200)
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": [m["user_id"] for m in mships]}},
        {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1}).to_list(200)}
    selected = await _preview_member_ids(center_id, current, manage, member_ids)
    selected = [s for s in selected if s in users]
    members_out = []
    for m in mships:
        u = users.get(m["user_id"]) or {}
        edu = await _member_education(center_id, m["user_id"])
        members_out.append({
            "user_id": m["user_id"], "username": u.get("username"),
            "name": u.get("name"), "avatar_url": u.get("avatar_url"),
            "role": m.get("role"), "relationship": m.get("relationship"),
            "grade_text": edu.get("grade_text") or "",
            "grade_level": edu.get("grade_level") or "elementary",
            "ai_power": edu.get("ai_power", 60),
            "selectable": manage or m["user_id"] == current["id"],
        })
    courses = await db.rc_courses.find(
        {"center_id": center_id}, {"_id": 0, "id": 1, "title": 1, "subject": 1,
                                   "grade_level": 1, "lesson_count": 1, "color": 1}).to_list(100)
    data = {}
    for mid in selected:
        agg = await db.rc_course_progress.aggregate([
            {"$match": {"center_id": center_id, "user_id": mid, "status": "completed"}},
            {"$group": {"_id": "$course_id", "done": {"$sum": 1},
                        "avg": {"$avg": "$score"}}}]).to_list(100)
        by_course = {a["_id"]: a for a in agg}
        data[mid] = {"courses": [{**c,
                                  "done": by_course.get(c["id"], {}).get("done", 0),
                                  "avg_score": by_course.get(c["id"], {}).get("avg")}
                                 for c in courses]}
    return {"members": members_out, "selected": selected, "can_manage": manage,
            "member_data": data, "grade_levels": GRADE_ORDER}


@router.get("/{center_id}/courses-preview/course")
async def courses_preview_detail(center_id: str, course_id: str, current: CurrentUser,
                                 member_id: str = ""):
    """Lessons + a SPECIFIC member's progress. Non-managers: self only."""
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    manage = _can_manage(perms)
    target = member_id or current["id"]
    if target != current["id"] and not manage:
        raise HTTPException(status_code=403, detail="You can only view your own learning data")
    course = await _course(center_id, course_id)
    lessons = await _lessons(course_id)
    prog = await _progress_map(course_id, target)
    done = sum(1 for p in prog.values() if p.get("status") == "completed")
    scores = [p["score"] for p in prog.values() if p.get("score") is not None]
    edu = await _member_education(center_id, target)
    return {"course": course, "lessons": lessons, "progress": prog,
            "member_id": target, "education": edu,
            "summary": {"done": done, "total": len(lessons),
                        "avg_score": (sum(scores) / len(scores)) if scores else None,
                        "achievements": _achievements(done, len(lessons),
                                                      (sum(scores) / len(scores)) if scores else None)},
            "read_only": target != current["id"]}


@router.get("/{center_id}/courses/{course_id}/tutor-history")
async def tutor_history_for_member(center_id: str, course_id: str, current: CurrentUser,
                                   member_id: str = "", lesson_id: str = ""):
    """Owner can review a member's tutor conversation (read-only)."""
    center, membership, perms = await _ctx(center_id, current, "view_items", write=False)
    target = member_id or current["id"]
    if target != current["id"] and not _can_manage(perms):
        raise HTTPException(status_code=403, detail="You can only view your own tutor history")
    q = {"course_id": course_id, "user_id": target}
    if lesson_id:
        q["lesson_id"] = lesson_id
    rows = await db.rc_course_tutor_messages.find(q, {"_id": 0}) \
        .sort("created_at", 1).to_list(120)
    return {"messages": rows, "member_id": target}


# ═══ Course Blueprint (approve-before-generate) — June 2026 ══════════════
BLUEPRINT_SYSTEM = """You are ORAi Course Studio planning a course BLUEPRINT (an outline only —
no lesson content yet). Any topic is supported: academics, music production, influencer academy,
streaming, podcasting, photography, video editing, game development, programming, business,
marketing, finance, cooking, fitness, languages, trades, life skills, hobbies, DIY and more.
Reply with ONLY valid JSON, no markdown fences:
{
  "title": "...", "description": "2-3 sentences", "subject": "...",
  "difficulty": "beginner|intermediate|advanced",
  "grade_level": "target level text",
  "learning_style": "visual|hands-on|reading|mixed",
  "estimated_minutes": 240,
  "media_types": ["images","activities","quizzes"],
  "quiz_count": 4,
  "projects": ["optional project titles"],
  "modules": [{"title": "...", "lessons": ["lesson title", "..."]}]
}
Keep 2-5 modules, 3-6 lessons each. Match difficulty, tone and visuals to the grade level."""


@router.post("/{center_id}/courses/blueprint")
async def course_blueprint(center_id: str, body: dict, current: CurrentUser):
    """Generate an editable Course Blueprint for approval BEFORE full generation."""
    center, membership, perms = await _ctx(center_id, current, "edit_center")
    rl = await rate_limit(f"course-bp:{current['id']}", max_requests=15, window_seconds=3600)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail="Blueprint limit reached — try again soon")
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Describe the course you want first")
    grade_text = str(body.get("grade_level") or "")[:60]
    member_id = str(body.get("member_id") or current["id"])
    if not grade_text:
        edu = await db.rc_member_education.find_one(
            {"center_id": center_id, "user_id": member_id}, {"_id": 0})
        grade_text = (edu or {}).get("grade_text") or ""
    user_msg = prompt[:2000]
    if grade_text:
        style = VISUAL_STYLE.get(normalize_grade(grade_text), "")
        user_msg += f"\n\nTarget grade level: {grade_text}. {style}"
    result = await call_openai_chat(
        [{"role": "system", "content": BLUEPRINT_SYSTEM}, {"role": "user", "content": user_msg}],
        temperature=0.7, max_tokens=1800)
    try:
        bp = _parse_course_json(result.get("content") or "")
    except Exception:
        raise HTTPException(status_code=502, detail="ORAi could not draft that blueprint — try rephrasing")
    bp = {"title": str(bp.get("title") or "Untitled course")[:200],
          "description": str(bp.get("description") or "")[:600],
          "subject": str(bp.get("subject") or "")[:100],
          "difficulty": str(bp.get("difficulty") or "beginner")[:20],
          "grade_level": grade_text or str(bp.get("grade_level") or "")[:60],
          "learning_style": str(bp.get("learning_style") or "mixed")[:30],
          "estimated_minutes": int(bp.get("estimated_minutes") or 0) or None,
          "media_types": [str(m)[:30] for m in (bp.get("media_types") or [])[:8]],
          "quiz_count": int(bp.get("quiz_count") or 0),
          "projects": [str(p)[:150] for p in (bp.get("projects") or [])[:6]],
          "modules": [{"title": str(m.get("title") or "")[:150],
                       "lessons": [str(t)[:150] for t in (m.get("lessons") or [])[:10]]}
                      for m in (bp.get("modules") or [])[:8]]}
    return {"blueprint": bp}
