"""Intelligent Video Prompt Engine — converts lesson context + style profile
into a professional cinematic production prompt before ANY video provider is
called. Never sends raw lesson text to the video model.
"""
import logging

from services.chat_conversations import call_openai_chat
from services.animation_styles import profile_to_prompt

log = logging.getLogger("ourrealm.video.prompt_engine")

PROMPT_SYSTEM = """You are ORAi's cinematic video director. Convert lesson material into ONE
professional AI-video production prompt (a single paragraph, 60-130 words).

Infer and encode: subject, educational objective, age level, pacing, camera language,
educational style, visual consistency, environment, on-screen actions, lighting,
color grading, and family-friendliness.

Rules:
- Describe exactly what the CAMERA SEES, moment to moment — concrete visuals and actions.
- Match vocabulary complexity of the visuals to the grade level.
- Honor the required art direction verbatim when provided.
- Strictly family-friendly and safe for all ages. No text overlays, no logos, no real brands.
- Output ONLY the production prompt. No preamble, no quotes."""


async def build_production_prompt(*, user_prompt: str, course: dict = None,
                                  lesson: dict = None, block: dict = None,
                                  style_profile: dict = None, seconds: int = 4) -> str:
    course = course or {}
    lesson = lesson or {}
    block = block or {}
    art = await profile_to_prompt(style_profile or {})
    sb = course.get("storyboard") or {}
    ctx = []
    if course.get("title"):
        ctx.append(f"Course: {course['title']} (level: {course.get('grade_level') or 'all ages'})")
    if lesson.get("title"):
        ctx.append(f"Lesson: {lesson['title']}")
    if block.get("title") or block.get("body"):
        ctx.append(f"This video segment: {block.get('title') or ''} — {str(block.get('body') or '')[:500]}")
    ctx.append(f"Creator's request: {user_prompt[:500]}")
    ctx.append(f"Clip length: {seconds} seconds — plan pacing accordingly.")
    if sb:
        for k, label in (("characters", "Recurring characters"), ("environment", "Environments"),
                         ("palette", "Color palette"), ("camera_language", "Camera language"),
                         ("visual_style", "Course visual style")):
            if sb.get(k):
                ctx.append(f"{label} (keep consistent): {str(sb[k])[:300]}")
    if art:
        ctx.append(f"REQUIRED ART DIRECTION:\n{art}")
    try:
        r = await call_openai_chat(
            [{"role": "system", "content": PROMPT_SYSTEM},
             {"role": "user", "content": "\n".join(ctx)[:4000]}],
            temperature=0.7, max_tokens=350)
        out = (r.get("content") or "").strip().strip('"')
        if len(out) > 40:
            return out[:1900]
    except Exception as e:  # noqa: BLE001
        log.warning("prompt engine LLM failed, using template fallback: %s", e)
    base = (f"Premium educational video for {course.get('grade_level') or 'all ages'}: "
            f"{user_prompt[:300]}. Smooth cinematic camera, natural lighting, clear "
            f"step-by-step visual demonstration, family-friendly.")
    return (base + ("\n" + art if art else ""))[:1900]
