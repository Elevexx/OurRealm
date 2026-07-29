"""AI-assisted Content Safety (Phase 1).

Vision scan of uploaded images/videos — runs ONCE per media at upload,
results cached on the media doc (`safety` object) and rolled up to the
post (`posts.safety`). Feed loads never rescan. Rescans only occur when
an admin requests one or the model version changes.

safety doc shape (internal — never returned raw to normal users):
    {
      severity: 0-4, scan_severity: 0-4, categories: [..],
      confidence: 0..1, context: str, recommended_action: str,
      detection_source: "ai:vision" | "ai:text" | "admin",
      model: str, scanned_at: iso, scan_status: pending|scanning|done|failed|unsupported,
      urgent: bool,
      manual_blur: { active, category, public_message, internal_reason,
                     applied_by, applied_at, removed_by, removed_at, removal_reason },
      manual_override: bool,
    }
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

from core.db import db

log = logging.getLogger("content_safety")

MODEL_NAME = "gpt-4o-mini"
MODEL_VERSION = "gpt-4o-mini/safety-v1"
LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

VISION_CATEGORIES = (
    "safe", "graphic", "nudity_sexual", "violence", "hate", "weapons",
    "drugs", "self_harm", "animal_cruelty", "minor_safety", "medical",
    "disturbing",
)

# Text scanner reason → (safety category, severity level)
TEXT_REASON_MAP = {
    "threats":        ("violence", 3),
    "self_harm":      ("self_harm", 3),
    "hate":           ("hate", 3),
    "sexual":         ("nudity_sexual", 2),
    "bullying":       ("harassment", 2),
    "phishing":       ("scam_fraud", 2),
    "scam":           ("scam_fraud", 2),
    "spam":           ("spam", 1),
    "suspicious_url": ("scam_fraud", 1),
}

_SYSTEM = (
    "You are a strict but context-aware content-safety classifier for a "
    "social platform. You consider context: fictional/artistic vs real, "
    "news/education vs glorification, breastfeeding vs sexual, hunting/"
    "farming vs cruelty, medical education vs shock content. You never "
    "assume guilt — you classify what is visibly present."
)

_PROMPT = (
    "Classify this image for content safety. Categories: "
    + ", ".join(VISION_CATEGORIES) + ".\n"
    "Severity rubric:\n"
    "0 = safe, nothing sensitive.\n"
    "1 = SENSITIVE: mild blood, hunting/harvesting, medical imagery, "
    "non-explicit suggestive content.\n"
    "2 = RESTRICTED: adult nudity, strong graphic content (gore, severe "
    "injuries, deceased people/animals), explicit sexual posing.\n"
    "3 = VIOLATION: hate symbols/extremist propaganda, sexual activity/"
    "pornography, celebration of real violence, drug manufacturing.\n"
    "4 = CRITICAL: suspected sexualized minors or child exploitation, "
    "imminent real-world violence, human trafficking indicators.\n"
    "Respond with ONLY strict JSON, no markdown:\n"
    '{"category": "<one category>", "confidence": <0..1>, '
    '"severity": <0..4>, "context": "<one short phrase>", '
    '"reason": "<one short sentence>"}'
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Vision call ───────────────────────────────────────────────────────
def _prep_image_b64(path: str) -> Optional[str]:
    """Downscale to ≤512px JPEG to keep vision cost minimal."""
    try:
        from PIL import Image
        img = Image.open(path)
        img.thumbnail((512, 512))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=70)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception as e:  # noqa: BLE001
        log.warning(f"[safety] image prep failed for {path}: {e}")
        return None


async def _vision_classify(image_b64: str) -> Optional[dict]:
    if not (LLM_KEY and image_b64):
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        chat = LlmChat(
            api_key=LLM_KEY,
            session_id=f"safety-{uuid.uuid4().hex[:10]}",
            system_message=_SYSTEM,
        ).with_model("openai", MODEL_NAME)
        resp = await chat.send_message(UserMessage(
            text=_PROMPT,
            file_contents=[ImageContent(image_base64=image_b64)],
        ))
        m = re.search(r"\{.*\}", str(resp or ""), re.S)
        if not m:
            return None
        data = json.loads(m.group(0))
        cat = str(data.get("category") or "safe").lower()
        if cat not in VISION_CATEGORIES:
            cat = "disturbing" if data.get("severity") else "safe"
        sev = max(0, min(4, int(data.get("severity") or 0)))
        # Minor-safety always gets the strictest treatment.
        if cat == "minor_safety":
            sev = 4
        return {
            "category": cat,
            "confidence": max(0.0, min(1.0, float(data.get("confidence") or 0))),
            "severity": sev,
            "context": str(data.get("context") or "")[:120],
            "reason": str(data.get("reason") or "")[:200],
        }
    except Exception as e:  # noqa: BLE001
        log.warning(f"[safety] vision classify failed: {e}")
        return None


def _severity_action(sev: int) -> str:
    return {0: "none", 1: "warn", 2: "blur_restrict", 3: "hide_review",
            4: "restrict_urgent"}.get(sev, "none")


def _result_to_safety(res: Optional[dict], source: str) -> dict:
    if res is None:
        return {"scan_status": "failed", "model": MODEL_VERSION,
                "scanned_at": _now(), "detection_source": source,
                "severity": 0, "scan_severity": 0, "categories": []}
    sev = res["severity"]
    cats = [] if res["category"] == "safe" else [res["category"]]
    return {
        "scan_status": "done",
        "severity": sev,
        "scan_severity": sev,
        "categories": cats,
        "confidence": res["confidence"],
        "context": res["context"],
        "reason": res["reason"],
        "recommended_action": _severity_action(sev),
        "detection_source": source,
        "model": MODEL_VERSION,
        "scanned_at": _now(),
        "urgent": sev >= 4 or res["category"] == "minor_safety",
    }


def _merge_manual(existing: Optional[dict], fresh: dict) -> dict:
    """Preserve any manual blur/override across rescans."""
    existing = existing or {}
    if existing.get("manual_blur"):
        fresh["manual_blur"] = existing["manual_blur"]
        fresh["manual_override"] = existing.get("manual_override", False)
        if (fresh["manual_blur"] or {}).get("active"):
            fresh["severity"] = max(int(fresh.get("severity") or 0), 1)
    return fresh


# ── Media scanners (cached; scan-once) ────────────────────────────────
async def scan_image_record(image_id: str, force: bool = False) -> Optional[dict]:
    doc = await db.images.find_one({"id": image_id}, {"_id": 0})
    if not doc:
        return None
    s = doc.get("safety") or {}
    if not force and s.get("scan_status") == "done" and s.get("model") == MODEL_VERSION:
        return s
    await db.images.update_one({"id": image_id}, {"$set": {"safety.scan_status": "scanning"}})
    name = (doc.get("original_url") or "").rsplit("/", 1)[-1]
    from services.image_store import ROOT as IMG_ROOT
    path = IMG_ROOT / name
    b64 = _prep_image_b64(str(path)) if name and path.exists() else None
    res = await _vision_classify(b64) if b64 else None
    # Re-read just before writing so a manual blur applied mid-scan survives.
    cur = await db.images.find_one({"id": image_id}, {"_id": 0, "safety": 1})
    safety = _merge_manual((cur or {}).get("safety") or {}, _result_to_safety(res, "ai:vision"))
    await db.images.update_one({"id": image_id}, {"$set": {"safety": safety}})
    if safety.get("severity", 0) >= 1:
        from services.moderation import log_action
        await log_action(action="ai_flag", content_type="image", content_id=image_id,
                         user_id=doc.get("user_id"),
                         reason=(safety.get("categories") or ["sensitive"])[0],
                         meta={"severity": safety["severity"], "confidence": safety.get("confidence")})
    return safety


def _extract_video_frames(path: str, out_dir: str) -> list[str]:
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return []
    frames = []
    for i, ss in enumerate(("00:00:01", "00:00:05", "00:00:15")):
        out = os.path.join(out_dir, f"frame{i}.jpg")
        try:
            r = subprocess.run(
                [ffmpeg, "-y", "-ss", ss, "-i", path, "-frames:v", "1",
                 "-vf", "scale='min(512,iw)':-2", out],
                capture_output=True, timeout=30)
            if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 100:
                frames.append(out)
        except Exception:
            continue
    return frames


def _contact_sheet_b64(frames: list[str]) -> Optional[str]:
    """Stitch frames horizontally → one image → ONE vision call per video."""
    try:
        from PIL import Image
        imgs = [Image.open(f).convert("RGB") for f in frames]
        h = min(i.height for i in imgs)
        imgs = [i.resize((int(i.width * h / i.height), h)) for i in imgs]
        sheet = Image.new("RGB", (sum(i.width for i in imgs), h))
        x = 0
        for i in imgs:
            sheet.paste(i, (x, 0)); x += i.width
        sheet.thumbnail((1024, 512))
        buf = io.BytesIO()
        sheet.save(buf, format="JPEG", quality=70)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


async def scan_video_record(video_id: str, force: bool = False) -> Optional[dict]:
    doc = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not doc:
        return None
    s = doc.get("safety") or {}
    if not force and s.get("scan_status") == "done" and s.get("model") == MODEL_VERSION:
        return s
    await db.videos.update_one({"id": video_id}, {"$set": {"safety.scan_status": "scanning"}})
    from services.video_store import video_dir
    path = video_dir() / f"{doc['id']}.{doc.get('ext', 'mp4')}"
    res = None
    if path.exists():
        with tempfile.TemporaryDirectory() as td:
            frames = await asyncio.to_thread(_extract_video_frames, str(path), td)
            b64 = _contact_sheet_b64(frames) if frames else None
            if b64:
                res = await _vision_classify(b64)
    cur = await db.videos.find_one({"id": video_id}, {"_id": 0, "safety": 1})
    safety = _merge_manual((cur or {}).get("safety") or {}, _result_to_safety(res, "ai:vision"))
    await db.videos.update_one({"id": video_id}, {"$set": {"safety": safety}})
    if safety.get("severity", 0) >= 1:
        from services.moderation import log_action
        await log_action(action="ai_flag", content_type="video", content_id=video_id,
                         user_id=doc.get("user_id"),
                         reason=(safety.get("categories") or ["sensitive"])[0],
                         meta={"severity": safety["severity"]})
    return safety


# ── Media-id extraction from post URLs ────────────────────────────────
_IMG_NAME_RE = re.compile(r"([0-9a-f]{32})(?:_thumb)?\.(?:jpg|jpeg|png|webp|gif)$", re.I)
_VID_NAME_RE = re.compile(r"([0-9a-f]{32})(?:\.[a-z0-9]+)?$", re.I)


def _image_ids_from_post(post: dict) -> list[str]:
    urls = list(post.get("image_urls") or [])
    if post.get("image_url"):
        urls.append(post["image_url"])
    if post.get("media_type") == "image" and post.get("media_url"):
        urls.append(post["media_url"])
    ids = []
    for u in urls:
        m = _IMG_NAME_RE.search(str(u or ""))
        if m and m.group(1) not in ids:
            ids.append(m.group(1))
    return ids


def _video_id_from_post(post: dict) -> Optional[str]:
    u = post.get("video_url") or (post.get("media_url") if post.get("media_type") == "video" else None)
    if not u or "youtube" in str(u) or "youtu.be" in str(u) or "vimeo" in str(u):
        return None
    m = _VID_NAME_RE.search(str(u).rsplit("/", 1)[-1])
    return m.group(1) if m else None


def text_safety_for_post(post: dict) -> tuple[int, list[str]]:
    """Map already-run rule-scan results to (severity, categories)."""
    sev, cats = 0, []
    for reason in (post.get("moderation_triggered") or
                   ([post.get("moderation_reason")] if post.get("moderation_reason") else [])):
        cat, s = TEXT_REASON_MAP.get(reason, (None, 0))
        if cat and cat not in cats:
            cats.append(cat)
        sev = max(sev, s)
    return sev, cats


# ── Post rollup — combine media + text results onto post.safety ───────
async def apply_post_media_safety(post_id: str, force: bool = False) -> None:
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        return
    image_ids = _image_ids_from_post(post)
    video_id = _video_id_from_post(post)

    severities: list[int] = []
    categories: list[str] = []
    confidence = 0.0
    context = ""
    any_failed = False

    async def _await_media(coll, mid, scanner):
        nonlocal any_failed
        for _ in range(12):
            d = await coll.find_one({"id": mid}, {"_id": 0, "safety": 1})
            s = (d or {}).get("safety") or {}
            if s.get("scan_status") == "done":
                return s
            if s.get("scan_status") == "failed":
                any_failed = True
                return s
            if not s.get("scan_status"):
                asyncio.create_task(scanner(mid, force))
            await asyncio.sleep(4)
        any_failed = True
        return {}

    for iid in image_ids:
        s = await _await_media(db.images, iid, scan_image_record)
        severities.append(int(s.get("scan_severity") or 0))
        for c in (s.get("categories") or []):
            if c not in categories:
                categories.append(c)
        confidence = max(confidence, float(s.get("confidence") or 0))
        context = context or s.get("context") or ""
    if video_id:
        s = await _await_media(db.videos, video_id, scan_video_record)
        severities.append(int(s.get("scan_severity") or 0))
        for c in (s.get("categories") or []):
            if c not in categories:
                categories.append(c)
        confidence = max(confidence, float(s.get("confidence") or 0))
        context = context or s.get("context") or ""

    text_sev, text_cats = text_safety_for_post(post)
    severities.append(text_sev)
    for c in text_cats:
        if c not in categories:
            categories.append(c)

    sev = max(severities) if severities else 0
    # Re-read the post just before writing — the media scans above take
    # seconds, and an admin may have applied a manual blur meanwhile.
    fresh = await db.posts.find_one(
        {"id": post_id}, {"_id": 0, "safety": 1, "moderated_by": 1, "moderation_status": 1})
    if not fresh:
        return
    prev = fresh.get("safety") or {}
    safety = _merge_manual(prev, {
        "scan_status": "failed" if (any_failed and sev == 0) else "done",
        "severity": sev,
        "scan_severity": sev,
        "categories": categories,
        "confidence": confidence,
        "context": context,
        "recommended_action": _severity_action(sev),
        "detection_source": "ai:vision+text" if (image_ids or video_id) else "ai:text",
        "model": MODEL_VERSION,
        "scanned_at": _now(),
        "urgent": sev >= 4 or "minor_safety" in categories,
    })
    updates: dict = {"safety": safety}

    # Severity escalation — never downgrade an explicit admin decision.
    mod_by = str(fresh.get("moderated_by") or "")
    admin_decided = mod_by.startswith("admin:")
    if not admin_decided:
        if sev >= 3:
            updates["moderation_status"] = "hidden"
            updates["moderation_reason"] = (categories or ["safety"])[0]
            updates["moderated_by"] = "auto:safety"
            updates["moderated_at"] = _now()
        elif sev == 2 and (fresh.get("moderation_status") in (None, "approved")):
            updates["moderation_status"] = "pending_review"
            updates["moderation_reason"] = (categories or ["safety"])[0]
            updates["moderated_by"] = "auto:safety"
            updates["moderated_at"] = _now()

    await db.posts.update_one({"id": post_id}, {"$set": updates})

    from services.moderation import log_action
    if sev >= 1:
        await log_action(action="ai_flag", content_type="post", content_id=post_id,
                         user_id=post.get("author_id"),
                         reason=(categories or ["sensitive"])[0],
                         meta={"severity": sev, "confidence": confidence,
                               "categories": categories, "urgent": safety.get("urgent", False)})
    # Notify uploader for warn/blur levels (1-2) without internal details.
    if 1 <= sev <= 2 and post.get("author_id"):
        try:
            from routers.notifications import emit_notification
            await emit_notification(
                post["author_id"], "moderation",
                payload={"preview": "Your post received a sensitive-content "
                                    "warning and may appear blurred to some users.",
                         "post_id": post_id})
        except Exception:
            pass
    # Urgent — notify all moderation-authorized admins (deduped per case).
    if safety.get("urgent"):
        try:
            from routers.moderation import notify_moderation_event
            await notify_moderation_event(
                event_type="urgent_case", content_type="post", content_id=post_id,
                category=("minor_safety" if "minor_safety" in categories
                          else (categories or ["safety"])[0]),
                priority="Critical" if "minor_safety" in categories else "Urgent",
                username=post.get("author_username"))
        except Exception:
            pass
    elif safety.get("scan_status") == "failed":
        try:
            from routers.moderation import notify_moderation_event
            await notify_moderation_event(
                event_type="scan_failed", content_type="post", content_id=post_id,
                category="scan", priority="Standard",
                username=post.get("author_username"))
        except Exception:
            pass


def kickoff_post_safety(post: dict) -> None:
    """Fire-and-forget rollup for a freshly created post."""
    if _image_ids_from_post(post) or _video_id_from_post(post) \
            or post.get("moderation_triggered") or post.get("moderation_reason"):
        try:
            asyncio.create_task(apply_post_media_safety(post["id"]))
        except Exception:
            pass
