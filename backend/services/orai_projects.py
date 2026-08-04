"""ORAi Multi-Tool Project Creator — orchestration layer.

Reuses (never re-implements): llm_router (AI Power tiers), orai_images
(Gemini Nano Banana + gpt-image fallback), orai_voice TTS, audio_store,
image_store, video_providers.openai (sora), game_studio (estimate+build),
rc_courses Course Maker, sounds + sound_permissions, provider catalog.

Collections: orai_projects, orai_assets, orai_project_audit.
"""
import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone

from core.db import db
from services.llm_router import tier, call_llm, AI_POWER_TIERS

log = logging.getLogger("ourrealm.orai_projects")


def _iso():
    return datetime.now(timezone.utc).isoformat()


# ── Tool + provider capability registry ──────────────────────────────
TOOLS = [
    {"id": "image", "name": "Image", "icon": "image", "color": "#C26BFF",
     "desc": "Generate images with AI models"},
    {"id": "video", "name": "Video", "icon": "video", "color": "#2EA0FF",
     "desc": "Create videos from text prompts"},
    {"id": "audio", "name": "Audio", "icon": "audio", "color": "#10E670",
     "desc": "Narration & spoken audio"},
    {"id": "text", "name": "Text", "icon": "text", "color": "#7B8CFF",
     "desc": "Generate text, copy and content"},
    {"id": "game", "name": "Game", "icon": "game", "color": "#F4A73B",
     "desc": "Interactive games via Game Studio"},
    {"id": "course", "name": "Course", "icon": "course", "color": "#2EE6FF",
     "desc": "Courses via Course Maker"},
]

IMG_COST = 0.04          # per image (nano banana / gpt-image internal estimate)
TTS_COST_PER_1K = 0.015  # openai tts-1 per 1k chars


def _connected(env):
    return bool(os.environ.get(env))


def provider_catalog() -> list:
    """Creative provider registry. connected = credentials present."""
    emergent = _connected("EMERGENT_LLM_KEY")
    openai_direct = _connected("OPENAI_API_KEY")
    return [
        {"id": "openai", "name": "OpenAI", "type": "external", "icon": "openai",
         "connected": emergent or openai_direct, "enabled": True,
         "tools": ["text", "image", "audio"], "roles": ["reasoning", "text", "image", "narration"],
         "models": ["gpt-5.4", "gpt-5.4-mini", "gpt-image-2", "tts-1"],
         "pricing": "configured_internal_estimate", "recommended": True,
         "via": "Emergent Universal Key" if emergent else "direct",
         "disabled_reason": None if (emergent or openai_direct) else "No credentials configured"},
        {"id": "gemini", "name": "Google Gemini", "type": "external", "icon": "gemini",
         "connected": emergent, "enabled": True,
         "tools": ["text", "image"], "roles": ["reasoning", "text", "image"],
         "models": ["gemini-3-flash", "nano-banana (image)"],
         "pricing": "configured_internal_estimate", "recommended": True,
         "via": "Emergent Universal Key",
         "disabled_reason": None if emergent else "No credentials configured"},
        {"id": "anthropic", "name": "Anthropic Claude", "type": "external", "icon": "anthropic",
         "connected": emergent, "enabled": True,
         "tools": ["text", "game", "course"], "roles": ["reasoning", "planning", "text"],
         "models": ["claude-sonnet-5", "claude-sonnet-4-6"],
         "pricing": "configured_internal_estimate", "recommended": False,
         "via": "Emergent Universal Key",
         "disabled_reason": None if emergent else "No credentials configured"},
        {"id": "openai_video", "name": "OpenAI Video (Sora)", "type": "external", "icon": "video",
         "connected": openai_direct, "enabled": True,
         "tools": ["video"], "roles": ["video"],
         "models": ["sora-2", "sora-2-pro"],
         "pricing": "provider_price_table", "recommended": openai_direct,
         "via": "direct",
         "disabled_reason": None if openai_direct else "No credentials configured"},
        {"id": "orai_image_engine", "name": "ORAi Image Pipeline", "type": "internal", "icon": "sparkles",
         "connected": emergent, "enabled": True,
         "tools": ["image"], "roles": ["image"],
         "models": ["gemini nano-banana → gpt-image-2 fallback"],
         "pricing": "configured_internal_estimate", "recommended": True, "via": "internal",
         "disabled_reason": None if emergent else "Emergent key missing"},
        {"id": "orai_tts", "name": "ORAi Voice (TTS)", "type": "internal", "icon": "mic",
         "connected": emergent or openai_direct, "enabled": True,
         "tools": ["audio"], "roles": ["narration"],
         "models": ["tts-1"], "pricing": "configured_internal_estimate",
         "recommended": True, "via": "internal",
         "disabled_reason": None if (emergent or openai_direct) else "No credentials configured"},
        {"id": "game_studio", "name": "ORAi Game Studio", "type": "internal", "icon": "game",
         "connected": True, "enabled": True,
         "tools": ["game"], "roles": ["game"],
         "models": [], "pricing": "configured_internal_estimate",
         "recommended": True, "via": "internal", "disabled_reason": None},
        {"id": "course_maker", "name": "ORAi Course Maker", "type": "internal", "icon": "course",
         "connected": True, "enabled": True,
         "tools": ["course"], "roles": ["course"],
         "models": [], "pricing": "configured_internal_estimate",
         "recommended": True, "via": "internal", "disabled_reason": None},
        # Registered but not connected (provider-neutral architecture):
        *[{"id": pid, "name": name, "type": "external", "icon": pid,
           "connected": False, "enabled": False, "tools": tls, "roles": roles,
           "models": [], "pricing": "unavailable", "recommended": False, "via": "direct",
           "disabled_reason": "Not connected — no API key configured"}
          for pid, name, tls, roles in [
              ("elevenlabs", "ElevenLabs", ["audio"], ["narration", "music"]),
              ("runway", "Runway", ["video"], ["video"]),
              ("pika", "Pika Labs", ["video"], ["video"]),
              ("stability", "Stability AI", ["image"], ["image"]),
              ("replicate", "Replicate", ["image", "video", "audio"], ["image", "video"]),
          ]],
    ]


def usable_providers():
    return [p for p in provider_catalog() if p["connected"] and p["enabled"]]


PRESETS = [
    {"id": "illustrated_story", "name": "Illustrated Story", "tools": ["text", "image"],
     "complexity": 5, "ai_power": 6, "settings": {"image": {"count": 4}, "text": {"length": "long", "content_type": "story"}}},
    {"id": "social_pack", "name": "Social Media Pack", "tools": ["image", "text"],
     "complexity": 3, "ai_power": 4, "settings": {"image": {"count": 6}, "text": {"length": "short", "content_type": "social captions"}}},
    {"id": "narrated_slideshow", "name": "Narrated Visual Story", "tools": ["image", "audio", "text"],
     "complexity": 5, "ai_power": 6, "settings": {"image": {"count": 5}, "audio": {"narration": True}}},
    {"id": "playable_game", "name": "Playable Game", "tools": ["game"],
     "complexity": 6, "ai_power": 7, "settings": {}},
    {"id": "interactive_course", "name": "Interactive Course", "tools": ["course"],
     "complexity": 6, "ai_power": 7, "settings": {}},
    {"id": "cinematic_trailer", "name": "Cinematic Trailer", "tools": ["video", "audio"],
     "complexity": 6, "ai_power": 7, "settings": {"video": {"seconds": 8}}},
    {"id": "custom", "name": "Custom Multi-Tool Project", "tools": [], "complexity": 5, "ai_power": 5, "settings": {}},
]


# ── Estimator (deterministic, labeled) ───────────────────────────────
def estimate_project(p: dict) -> dict:
    tools = p.get("tools") or []
    s = p.get("settings") or {}
    cx = min(max(int(p.get("complexity") or 5), 1), 10)
    power = min(max(int(p.get("ai_power") or 5), 1), 10)
    t = tier(power)
    items = []

    def add(label, cost, source, note=""):
        items.append({"label": label, "cost": round(cost, 4), "source": source, "note": note})

    add("Planning & reasoning", t["est_cost"], "configured_internal_estimate",
        f"{t['provider']}/{t['model']} × {t['passes']} pass(es)")
    if "text" in tools:
        sections = max(1, int((s.get("text") or {}).get("sections") or max(1, cx // 2)))
        add("Text generation", t["est_cost_per_pass"] * sections, "configured_internal_estimate",
            f"{sections} section(s)")
    if "image" in tools:
        img = s.get("image") or {}
        n = min(max(int(img.get("count") or 4), 1), 20)
        if img.get("reference_asset_id") and n == 0:
            n = 0
        add(f"Images × {n}", IMG_COST * n, "configured_internal_estimate", "nano-banana / gpt-image")
    if "audio" in tools:
        a = s.get("audio") or {}
        chars = min(max(int(a.get("est_chars") or 1500 + cx * 300), 200), 16000)
        add("Narration (TTS)", TTS_COST_PER_1K * chars / 1000, "configured_internal_estimate",
            f"~{chars} chars, tts-1")
    if "video" in tools:
        v = s.get("video") or {}
        secs = int(v.get("seconds") or 8)
        model = v.get("model") or "sora-2"
        size = v.get("size") or "1280x720"
        try:
            from services.video_providers.openai_provider import PRICING as VP
            rate = VP.get((model, size))
        except Exception:  # noqa: BLE001
            rate = None
        if rate:
            add(f"Video {secs}s ({model})", rate * secs, "provider_price_table", size)
        else:
            add(f"Video {secs}s", 0.10 * secs, "configured_internal_estimate", "pricing table unavailable")
    if "game" in tools:
        add("Game generation (Game Studio)", t["est_cost_per_pass"] * (2 + cx // 2) + 0.05,
            "configured_internal_estimate", f"complexity {cx}")
    if "course" in tools:
        c = s.get("course") or {}
        modules = min(max(int(c.get("modules") or max(2, cx // 2)), 1), 10)
        lessons = min(max(int(c.get("lessons_per_module") or 3), 1), 8)
        add(f"Course ({modules} modules × {lessons} lessons)",
            t["est_cost_per_pass"] * modules * lessons * 0.5 + 0.05,
            "configured_internal_estimate", "Course Maker pipeline")
    sound_mode = (s.get("sound") or {}).get("mode") or "none"
    if sound_mode == "existing":
        add("Music generation", 0.0, "configured_internal_estimate",
            "Existing Sound reused — no new music-generation usage")
    total = round(sum(i["cost"] for i in items), 4)
    return {"items": items, "total": total,
            "range": [round(total * 0.8, 3), round(total * 1.25, 3)],
            "disclaimer": "Internal configured estimate — actual provider usage may vary.",
            "power_tier": {"label": t["label"], "provider": t["provider"], "model": t["model"]},
            "calculated_at": _iso()}


def build_suggestions(p: dict) -> list:
    tools = p.get("tools") or ["image"]
    up = {x["id"]: x for x in usable_providers()}
    if not up:
        return []
    def role_map(quality):
        roles = []
        if quality == "best":
            reason = "anthropic" if "anthropic" in up else "openai"
        elif quality == "balanced":
            reason = "openai" if "openai" in up else "gemini"
        else:
            reason = "gemini" if "gemini" in up else "openai"
        if reason in up:
            roles.append({"provider": reason, "role": "Planning & reasoning"})
        if "image" in tools and "orai_image_engine" in up:
            roles.append({"provider": "orai_image_engine", "role": "Image generation"})
        if "audio" in tools and "orai_tts" in up:
            roles.append({"provider": "orai_tts", "role": "Narration"})
        if "video" in tools:
            if "openai_video" in up:
                roles.append({"provider": "openai_video", "role": "Video generation"})
        if "game" in tools:
            roles.append({"provider": "game_studio", "role": "Game build"})
        if "course" in tools:
            roles.append({"provider": "course_maker", "role": "Course build"})
        return roles
    combos = []
    for key, name, power, adv, trade in [
            ("best", "Best Quality", 9, "Strongest models, deepest refinement", "Highest cost, slower"),
            ("balanced", "Balanced", 6, "Great quality/cost balance", "Not the absolute best quality"),
            ("budget", "Cost Efficient", 3, "Cheapest usable combination", "Lighter models, fewer passes")]:
        roles = role_map(key)
        if not roles:
            continue
        est = estimate_project({**p, "ai_power": power})
        combos.append({"id": key, "name": name, "ai_power": power, "roles": roles,
                       "providers": sorted({r["provider"] for r in roles}),
                       "est_range": est["range"], "quality": name,
                       "advantages": adv, "tradeoffs": trade})
    return combos


# ── Library assets ───────────────────────────────────────────────────
async def save_asset(current, project, *, atype, subtype, title, refs, meta=None):
    doc = {
        "id": uuid.uuid4().hex, "type": atype, "subtype": subtype,
        "title": (title or "")[:140], "tags": project.get("tools") or [],
        "creator_id": current["id"], "creator_username": current.get("username"),
        "project_id": project["id"], "job_id": project.get("job_id"),
        "provider": (meta or {}).get("provider"), "model": (meta or {}).get("model"),
        "prompt": (project.get("prompt") or "")[:800],
        "settings": (meta or {}).get("settings"),
        "refs": refs, "privacy": "private", "eligibility": "owner_only",
        "moderation_status": "clean", "archived": False, "usage_count": 0,
        "created_at": _iso(), "updated_at": _iso(),
    }
    await db.orai_assets.insert_one({**doc})
    return doc


async def audit(actor, action, project_id, detail=""):
    await db.orai_project_audit.insert_one({
        "id": uuid.uuid4().hex, "actor_id": actor.get("id"),
        "actor_username": actor.get("username"), "action": action,
        "project_id": project_id, "detail": str(detail)[:300], "at": _iso()})


# ── Job runner ───────────────────────────────────────────────────────
async def _set(pid, patch):
    await db.orai_projects.update_one({"id": pid}, {"$set": {**patch, "updated_at": _iso()}})


async def _push_activity(pid, msg):
    await db.orai_projects.update_one({"id": pid}, {
        "$push": {"activity": {"at": _iso(), "msg": str(msg)[:300]}},
        "$set": {"updated_at": _iso()}})


async def _stage(pid, sid, patch):
    sets = {f"stages.$.{k}": v for k, v in patch.items()}
    await db.orai_projects.update_one({"id": pid, "stages.id": sid},
                                      {"$set": {**sets, "updated_at": _iso()}})


async def _cancelled(pid):
    d = await db.orai_projects.find_one({"id": pid}, {"cancel_requested": 1})
    return bool(d and d.get("cancel_requested"))


def stages_for(project: dict) -> list:
    tools = project.get("tools") or []
    out = [{"id": "validate", "label": "Validating Request", "provider": "internal"},
           {"id": "plan", "label": "Planning Project", "provider": "llm_router"}]
    if "text" in tools:
        out.append({"id": "text", "label": "Generating Text", "provider": "llm_router"})
    if "image" in tools:
        out.append({"id": "image", "label": "Generating Images", "provider": "orai_image_engine"})
    if "audio" in tools:
        out.append({"id": "audio", "label": "Generating Audio", "provider": "orai_tts"})
    if "video" in tools:
        out.append({"id": "video", "label": "Generating Video", "provider": "openai_video"})
    if "game" in tools:
        out.append({"id": "game", "label": "Building Game", "provider": "game_studio"})
    if "course" in tools:
        out.append({"id": "course", "label": "Building Course", "provider": "course_maker"})
    out.append({"id": "finalize", "label": "Finalizing Project", "provider": "internal"})
    return [{**s, "status": "waiting", "detail": "", "started_at": None, "finished_at": None} for s in out]


async def _use(pid, label, cost):
    await db.orai_projects.update_one({"id": pid}, {
        "$push": {"usage.items": {"label": label, "cost": round(float(cost), 4), "at": _iso()}},
        "$inc": {"usage.total": round(float(cost), 4)},
        "$set": {"updated_at": _iso()}})


async def run_generation(pid: str, current: dict):
    """Background pipeline. Skips stages already complete (retry-safe)."""
    p = await db.orai_projects.find_one({"id": pid})
    if not p:
        return
    s = p.get("settings") or {}
    power = int(p.get("ai_power") or 5)
    cx = int(p.get("complexity") or 5)
    t = tier(power)
    total = len(p["stages"])

    async def begin(sid):
        st = next((x for x in p["stages"] if x["id"] == sid), None)
        if st and st["status"] == "complete":
            return False
        await _stage(pid, sid, {"status": "in_progress", "started_at": _iso(), "detail": ""})
        return True

    async def done(sid, detail=""):
        await _stage(pid, sid, {"status": "complete", "finished_at": _iso(), "detail": str(detail)[:200]})
        fresh = await db.orai_projects.find_one({"id": pid}, {"stages": 1})
        pct = int(100 * sum(1 for x in fresh["stages"] if x["status"] == "complete") / total)
        await _set(pid, {"progress_pct": pct})

    async def fail(sid, err):
        await _stage(pid, sid, {"status": "failed", "finished_at": _iso(), "detail": str(err)[:250]})
        await _push_activity(pid, f"Stage {sid} failed: {str(err)[:180]}")

    try:
        await _set(pid, {"status": "generating", "heartbeat": _iso()})
        # validate
        if await begin("validate"):
            await done("validate", "Providers & settings verified")
        # plan
        plan_text = ""
        if await begin("plan"):
            try:
                plan_text = await call_llm(
                    "You are ORAi, planning a creative multi-tool project. Produce a short production plan "
                    "(scenes/sections/asset list) sized for complexity {}/10.".format(cx),
                    (p.get("prompt") or p.get("name") or "")[:1500], power=min(power, 5))
                await _use(pid, "Planning & reasoning", t["est_cost_per_pass"])
                await save_asset(current, p, atype="text", subtype="plan", title=f"{p['name']} — plan",
                                 refs={"text": plan_text[:8000]}, meta={"provider": t["provider"], "model": t["model"]})
                await done("plan", "Plan drafted")
                await _push_activity(pid, "Project plan drafted")
            except Exception as e:  # noqa: BLE001
                await fail("plan", e); raise
        if await _cancelled(pid):
            raise asyncio.CancelledError()

        tools = p.get("tools") or []
        outputs = []

        if "text" in tools and await begin("text"):
            try:
                txt = s.get("text") or {}
                body = await call_llm(
                    f"You are ORAi. Write {txt.get('content_type') or 'content'} — tone: {txt.get('tone') or 'engaging'}, "
                    f"length: {txt.get('length') or 'medium'}, audience: {txt.get('audience') or 'general'}.",
                    (p.get("prompt") or "")[:1500] + ("\n\nPlan:\n" + plan_text[:1200] if plan_text else ""),
                    power=power)
                await _use(pid, "Text generation", t["est_cost_per_pass"])
                a = await save_asset(current, p, atype="text", subtype=txt.get("content_type") or "document",
                                     title=f"{p['name']} — text", refs={"text": body[:20000]},
                                     meta={"provider": t["provider"], "model": t["model"]})
                outputs.append({"type": "text", "asset_id": a["id"], "preview": body[:400]})
                await done("text"); await _push_activity(pid, "Text generated")
            except Exception as e:  # noqa: BLE001
                await fail("text", e)

        if "image" in tools and await begin("image"):
            try:
                from services.orai_images import generate_orai_image, load_reference_from_image_url
                from services import image_store
                img = s.get("image") or {}
                n = min(max(int(img.get("count") or 4), 1), 12)
                ref_b64 = None
                if img.get("reference_asset_id"):
                    ra = await db.orai_assets.find_one({"id": img["reference_asset_id"]})
                    url = ((ra or {}).get("refs") or {}).get("url")
                    if url:
                        ref_b64 = load_reference_from_image_url(url)
                made = []
                for i in range(n):
                    if await _cancelled(pid):
                        raise asyncio.CancelledError()
                    prompt = (f"{p.get('prompt') or p['name']} — {img.get('style') or 'vivid digital art'} "
                              f"(image {i + 1} of {n}, aspect {img.get('aspect') or '1:1'})")
                    raw, model = await generate_orai_image(prompt[:900], ref_b64)
                    rec = await image_store.save_bytes(raw, current["id"])
                    await _use(pid, f"Image {i + 1}", IMG_COST)
                    a = await save_asset(current, p, atype="image", subtype=img.get("style") or "illustration",
                                         title=f"{p['name']} — image {i + 1}",
                                         refs={"image_id": rec.id, "url": rec.original_url, "thumb": rec.thumbnail_url},
                                         meta={"provider": "orai_image_engine", "model": model,
                                               "settings": {"aspect": img.get("aspect"), "style": img.get("style")}})
                    made.append({"type": "image", "asset_id": a["id"], "url": rec.original_url, "thumb": rec.thumbnail_url})
                    await _stage(pid, "image", {"detail": f"{len(made)}/{n} complete"})
                    await db.orai_projects.update_one({"id": pid}, {"$set": {"outputs_live.image": made, "updated_at": _iso()}})
                outputs.extend(made)
                await done("image", f"{len(made)} images"); await _push_activity(pid, f"{len(made)} images generated (Media Library)")
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                await fail("image", e)

        if "audio" in tools and await begin("audio"):
            try:
                a_s = s.get("audio") or {}
                script = a_s.get("script") or ""
                if not script:
                    script = await call_llm(
                        "Write a short spoken narration script (no stage directions, plain sentences).",
                        (p.get("prompt") or "")[:1200], power=min(power, 4), max_tokens=900)
                    await _use(pid, "Narration script", t["est_cost_per_pass"] * 0.5)
                from routers.orai_voice import _tts_bytes
                from services import audio_store
                raw = await _tts_bytes(script[:4000], a_s.get("voice_id") or "nova", 1.0)
                rec = await audio_store.save_audio(raw, current["id"], declared_mime="audio/mpeg", filename="narration.mp3")
                await _use(pid, "Narration (TTS)", TTS_COST_PER_1K * len(script[:4000]) / 1000)
                from services.sound_permissions import default_permissions
                track = {
                    "id": uuid.uuid4().hex, "user_id": current["id"], "username": current.get("username"),
                    "title": f"{p['name']} — narration"[:120], "category": "narration",
                    "classification_id": "other", "duration_seconds": rec.duration_seconds,
                    "file_url": rec.file_url, "file_size": rec.bytes, "mime": rec.mime,
                    "cover_url": None, "plays": 0, "likes": 0, "liked_by": [],
                    "is_ai_generated": True, "visibility": "private", "custom_user_ids": [],
                    "reuse_permissions": default_permissions(),
                    "reuse_preset": "playable_only",
                    "source_project_id": pid, "created_at": _iso(),
                }
                await db.tracks.insert_one({**track})
                a = await save_asset(current, p, atype="audio", subtype="narration",
                                     title=track["title"],
                                     refs={"track_id": track["id"], "url": rec.file_url,
                                           "duration": rec.duration_seconds},
                                     meta={"provider": "orai_tts", "model": "tts-1",
                                           "settings": {"voice": a_s.get("voice_id") or "nova"}})
                outputs.append({"type": "audio", "asset_id": a["id"], "url": rec.file_url,
                                "duration": rec.duration_seconds})
                await done("audio", "Narration saved (private Sound)")
                await _push_activity(pid, "Narration generated — saved as private Sound")
            except Exception as e:  # noqa: BLE001
                await fail("audio", e)

        if "video" in tools and await begin("video"):
            try:
                if not _connected("OPENAI_API_KEY"):
                    raise RuntimeError("OpenAI Video is not connected")
                from services.video_providers.openai_provider import OpenAIVideoProvider
                from services import video_store
                v = s.get("video") or {}
                prov = OpenAIVideoProvider()
                secs = int(v.get("seconds") or 8)
                model = v.get("model") or "sora-2"
                size = v.get("size") or "1280x720"
                vid_prompt = (p.get("prompt") or p["name"])[:900]
                pjid = await prov.create_job(vid_prompt, model, secs, size)
                await _stage(pid, "video", {"detail": "Rendering with Sora…"})
                raw = None
                for _ in range(120):
                    await asyncio.sleep(5)
                    if await _cancelled(pid):
                        raise asyncio.CancelledError()
                    st = await prov.poll(pjid)
                    if st.get("status") in ("completed", "succeeded", "done"):
                        raw = await prov.fetch_file(pjid); break
                    if st.get("status") in ("failed", "cancelled", "error"):
                        raise RuntimeError(st.get("error") or "Video generation failed")
                if not raw:
                    raise RuntimeError("Video render timed out")
                rec = await video_store.save_video(raw, current["id"], declared_mime="video/mp4", filename="orai.mp4")
                cost = prov.estimate_cost(model, secs, size) or 0.10 * secs
                await _use(pid, f"Video {secs}s ({model})", cost)
                a = await save_asset(current, p, atype="video", subtype="clip",
                                     title=f"{p['name']} — video",
                                     refs={"video_id": rec.id, "url": rec.file_url},
                                     meta={"provider": "openai_video", "model": model,
                                           "settings": {"seconds": secs, "size": size}})
                outputs.append({"type": "video", "asset_id": a["id"], "url": rec.file_url})
                await done("video"); await _push_activity(pid, "Video generated")
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                await fail("video", e)

        if "game" in tools and await begin("game"):
            try:
                from services import game_studio as gs
                est = await gs.create_estimate({"request": (p.get("prompt") or p["name"])[:1200],
                                                "complexity": min(cx, 8), "ai_power": power,
                                                "supported_controls": (s.get("game") or {}).get("controls") or "both"},
                                               current)
                sim = (est.get("plan") or {}).get("showcase_similarity") or {}
                if sim.get("blocked"):
                    raise RuntimeError("Game blocked: too similar to an existing showcase game")
                game = await gs.start_build(est, current)
                await _stage(pid, "game", {"detail": f"Game Studio building '{game['title']}'…"})
                for _ in range(180):
                    await asyncio.sleep(5)
                    g = await db.games.find_one({"id": game["id"]}, {"status": 1, "stage": 1, "actual_cost": 1, "title": 1, "cover_url": 1})
                    if await _cancelled(pid):
                        raise asyncio.CancelledError()
                    if not g or g.get("status") != "building":
                        break
                    await _stage(pid, "game", {"detail": f"{g.get('stage')}…"})
                g = await db.games.find_one({"id": game["id"]})
                if not g or g.get("status") == "failed":
                    raise RuntimeError((g or {}).get("error") or "Game build failed")
                await _use(pid, "Game generation", float(g.get("actual_cost") or 0) or float(g.get("est_cost") or 0.1))
                a = await save_asset(current, p, atype="game", subtype=g.get("runtime"),
                                     title=g.get("title"), refs={"game_id": g["id"], "cover": g.get("cover_url")},
                                     meta={"provider": "game_studio", "model": g.get("runtime")})
                outputs.append({"type": "game", "asset_id": a["id"], "game_id": g["id"],
                                "title": g.get("title"), "cover": g.get("cover_url"), "status": g.get("status")})
                await done("game", g.get("title")); await _push_activity(pid, f"Game '{g.get('title')}' built (pending your approval in Game Studio)")
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                await fail("game", e)

        if "course" in tools and await begin("course"):
            try:
                c = s.get("course") or {}
                center_id = c.get("center_id")
                if not center_id:
                    raise RuntimeError("Select a Responsibility Center for the course")
                from routers.rc_courses import generate_course
                await _stage(pid, "course", {"detail": "Course Maker generating…"})
                r = await generate_course(center_id, {
                    "prompt": (p.get("prompt") or p["name"])[:1800],
                    "grade_level": c.get("grade_level") or "",
                    "lesson_count": int(c.get("modules") or max(2, cx // 2)) * int(c.get("lessons_per_module") or 3),
                    "options": {"difficulty": c.get("difficulty") or "standard",
                                "goals": c.get("goals") or "", "media_types": c.get("media") or "",
                                "accessibility": c.get("accessibility") or "",
                                "final_project": c.get("final_project") or ""},
                }, current)
                course = r.get("course") or {}
                await _use(pid, "Course generation", t["est_cost_per_pass"] * int(c.get("modules") or 2))
                a = await save_asset(current, p, atype="course", subtype="course",
                                     title=course.get("title") or f"{p['name']} — course",
                                     refs={"course_id": course.get("id"), "center_id": center_id},
                                     meta={"provider": "course_maker"})
                outputs.append({"type": "course", "asset_id": a["id"], "course_id": course.get("id"),
                                "center_id": center_id, "title": course.get("title")})
                await done("course", course.get("title") or ""); await _push_activity(pid, "Course generated (Course Studio)")
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                await fail("course", e)

        # finalize
        fresh = await db.orai_projects.find_one({"id": pid})
        failed = [x for x in fresh["stages"] if x["status"] == "failed"]
        if await begin("finalize"):
            await done("finalize")
        all_out = (fresh.get("outputs") or []) + outputs
        # de-dup by asset_id
        seen, merged = set(), []
        for o in all_out:
            k = o.get("asset_id") or id(o)
            if k not in seen:
                seen.add(k); merged.append(o)
        status = "partially_completed" if failed else "completed"
        await _set(pid, {"status": status, "outputs": merged, "progress_pct": 100 if not failed else None,
                         "finished_at": _iso(), "outputs_live": {}})
        await _push_activity(pid, "Project complete" if not failed else
                             f"Project finished with {len(failed)} failed stage(s) — retry available")
    except asyncio.CancelledError:
        await _set(pid, {"status": "canceled", "finished_at": _iso()})
        await _push_activity(pid, "Project canceled")
    except Exception as e:  # noqa: BLE001
        log.warning("orai project %s failed: %s", pid, e)
        await _set(pid, {"status": "failed", "error": str(e)[:300], "finished_at": _iso()})
        await _push_activity(pid, f"Project failed: {str(e)[:200]}")
