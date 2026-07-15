"""Website Media — founder-only branding + new-user tutorial system.

Admin  (@stealth only, enforced server-side via require_founder):
  GET   /api/admin/website-media
  PATCH /api/admin/website-media/modes/{mode_key}
  POST  /api/admin/website-media/publish
  POST  /api/admin/website-media/discard-draft
  POST  /api/admin/website-media/rollback
  GET   /api/admin/tutorial
  PATCH /api/admin/tutorial
  POST  /api/admin/tutorial/slides
  PATCH /api/admin/tutorial/slides/{slide_id}
  DELETE /api/admin/tutorial/slides/{slide_id}
  POST  /api/admin/tutorial/slides/{slide_id}/duplicate
  POST  /api/admin/tutorial/slides/reorder
  POST  /api/admin/tutorial/publish
  POST  /api/admin/tutorial/rollback
  DELETE /api/admin/tutorial/draft

Public (authenticated):
  GET  /api/website-media/published   (open — public URLs only, cached)
  GET  /api/tutorial/active
  POST /api/tutorial/progress/start|update|complete|skip

Media uploads reuse the existing authenticated /api/images/upload and
/api/videos/upload R2 pipeline — only durable proxy URLs are accepted.
"""
from __future__ import annotations

import re
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder

log = logging.getLogger("ourrealm.website_media")
router = APIRouter(prefix="/api", tags=["website-media"])

# Current hardcoded master logo — seeded as the Neon published default.
DEFAULT_LOGO_URL = "https://customer-assets.emergentagent.com/job_realm-deploy/artifacts/ki9b6c4f_4AA21A20-23F6-4B58-A5C1-C58EAD942F36.png"

MODES = [
    ("neon", "Neon", "#10E670"), ("jungle", "Jungle", "#3BB143"),
    ("aquaria", "Aquaria", "#2EA0FF"), ("terra_vetus", "Terra Vetus", "#C98A4B"),
    ("cyber", "Cyber", "#C26BFF"), ("retro", "Retro", "#FF6BA0"),
    ("ancient_egypt", "Ancient Egypt", "#F4C84A"), ("alien", "Alien", "#6BFF8F"),
    ("adventure", "Adventure", "#FF8A3D"), ("business", "Business", "#6BD3FF"),
    ("social", "Social", "#FF8AC2"),
    # existing live app modes so the header mapping works today
    ("millennium", "Millennium", "#B8C4FF"), ("stealth", "Stealth", "#8899AA"),
]
MODE_KEYS = {m[0] for m in MODES}

DURABLE_URL_RE = re.compile(r"^(/api/(media|images|videos)/[A-Za-z0-9._/-]+|https://[A-Za-z0-9.-]+/[^\s]*)$")
SAFE_ROUTE_RE = re.compile(r"^/[A-Za-z0-9/_-]*$")

_published_cache: dict = {"data": None}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _durable(url: Optional[str]) -> bool:
    return bool(url) and not str(url).startswith(("blob:", "data:")) and bool(DURABLE_URL_RE.match(str(url)))


async def _audit(actor: dict, action: str, target_type: str, target_id: str,
                 before: Optional[dict] = None, after: Optional[dict] = None):
    await db.admin_audit_logs.insert_one({
        "id": uuid.uuid4().hex, "at": _now(),
        "actor_id": actor.get("id"), "actor_username": actor.get("username"),
        "action": action, "target_type": target_type, "target_id": target_id,
        "before": before, "after": after,
    })


async def ensure_website_media_seed():
    """Idempotent startup seed — creates mode docs and seeds the current
    hardcoded logo as the Neon published asset. Never overwrites."""
    for key, name, accent in MODES:
        await db.website_media_modes.update_one(
            {"mode_key": key},
            {"$setOnInsert": {
                "id": uuid.uuid4().hex, "mode_key": key, "mode_name": name,
                "accent": accent, "draft_logo_url": None, "draft_wordmark_url": None,
                "published_logo_url": DEFAULT_LOGO_URL if key == "neon" else None,
                "published_wordmark_url": None,
                "previous_logo_url": None, "previous_wordmark_url": None,
                "version": 0, "created_at": _now(), "updated_at": _now(),
                "published_at": None, "updated_by": None, "published_by": None,
            }},
            upsert=True,
        )
    await db.tutorials.update_one(
        {"id": "main"},
        {"$setOnInsert": {
            "id": "main", "name": "Welcome to OurRealm", "status": "draft",
            "audience": "new_users", "show_delay_ms": 800,
            "allow_skip": True, "allow_close": True, "show_progress": True,
            "auto_advance": False, "draft_slides": [], "version": 0,
            "created_at": _now(), "updated_at": _now(),
            "published_at": None, "updated_by": None, "published_by": None,
        }},
        upsert=True,
    )
    await db.user_tutorial_progress.create_index(
        [("user_id", 1), ("tutorial_id", 1), ("tutorial_version", 1)], unique=True)
    _published_cache["data"] = None


def _mode_out(m: dict) -> dict:
    m.pop("_id", None)
    return m


# ═══ Admin — Logos & Wordmarks ════════════════════════════════════════
@router.get("/admin/website-media")
async def admin_get_media(current: CurrentUser):
    require_founder(current)
    modes = [_mode_out(m) async for m in db.website_media_modes.find({}).sort("mode_key", 1)]
    return {"modes": modes}


class ModePatch(BaseModel):
    draft_logo_url: Optional[str] = None
    draft_wordmark_url: Optional[str] = None
    clear_draft_logo: bool = False
    clear_draft_wordmark: bool = False


@router.patch("/admin/website-media/modes/{mode_key}")
async def admin_patch_mode(mode_key: str, payload: ModePatch, current: CurrentUser):
    require_founder(current)
    if mode_key not in MODE_KEYS:
        raise HTTPException(400, "Unknown mode key")
    doc = await db.website_media_modes.find_one({"mode_key": mode_key}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Mode not found")
    sets = {"updated_at": _now(), "updated_by": current.get("username")}
    for field, val, clear in (
        ("draft_logo_url", payload.draft_logo_url, payload.clear_draft_logo),
        ("draft_wordmark_url", payload.draft_wordmark_url, payload.clear_draft_wordmark),
    ):
        if clear:
            sets[field] = None
        elif val is not None:
            if not _durable(val):
                raise HTTPException(400, "Only durable uploaded media URLs are accepted (no blob/base64).")
            sets[field] = val
    await db.website_media_modes.update_one({"mode_key": mode_key}, {"$set": sets})
    await _audit(current, "website_media.save_draft", "mode", mode_key,
                 before={k: doc.get(k) for k in ("draft_logo_url", "draft_wordmark_url")},
                 after={k: sets.get(k, doc.get(k)) for k in ("draft_logo_url", "draft_wordmark_url")})
    fresh = await db.website_media_modes.find_one({"mode_key": mode_key}, {"_id": 0})
    return {"ok": True, "mode": fresh}


class PublishPayload(BaseModel):
    mode_keys: list[str] = []


@router.post("/admin/website-media/publish")
async def admin_publish_media(payload: PublishPayload, current: CurrentUser):
    require_founder(current)
    keys = payload.mode_keys or list(MODE_KEYS)
    published = []
    # Validate everything BEFORE mutating — no partial publishing.
    plans = []
    for key in keys:
        doc = await db.website_media_modes.find_one({"mode_key": key}, {"_id": 0})
        if not doc:
            raise HTTPException(400, f"Unknown mode '{key}'")
        if not (doc.get("draft_logo_url") or doc.get("draft_wordmark_url")):
            continue
        for f in ("draft_logo_url", "draft_wordmark_url"):
            if doc.get(f) and not _durable(doc[f]):
                raise HTTPException(400, f"Invalid draft asset on '{key}' — publish aborted, live site unchanged.")
        plans.append(doc)
    if not plans:
        raise HTTPException(400, "No draft changes to publish.")
    for doc in plans:
        sets = {"published_at": _now(), "published_by": current.get("username"),
                "updated_at": _now(), "version": (doc.get("version") or 0) + 1}
        if doc.get("draft_logo_url"):
            sets["previous_logo_url"] = doc.get("published_logo_url")
            sets["published_logo_url"] = doc["draft_logo_url"]
            sets["draft_logo_url"] = None
        if doc.get("draft_wordmark_url"):
            sets["previous_wordmark_url"] = doc.get("published_wordmark_url")
            sets["published_wordmark_url"] = doc["draft_wordmark_url"]
            sets["draft_wordmark_url"] = None
        await db.website_media_modes.update_one({"mode_key": doc["mode_key"]}, {"$set": sets})
        published.append(doc["mode_key"])
        await _audit(current, "website_media.publish", "mode", doc["mode_key"],
                     before={"logo": doc.get("published_logo_url"), "wordmark": doc.get("published_wordmark_url")},
                     after={"logo": sets.get("published_logo_url", doc.get("published_logo_url")),
                            "wordmark": sets.get("published_wordmark_url", doc.get("published_wordmark_url"))})
    _published_cache["data"] = None
    return {"ok": True, "published_modes": published}


class ModeKeyPayload(BaseModel):
    mode_key: str


@router.post("/admin/website-media/discard-draft")
async def admin_discard_draft(payload: ModeKeyPayload, current: CurrentUser):
    require_founder(current)
    doc = await db.website_media_modes.find_one({"mode_key": payload.mode_key}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Mode not found")
    await db.website_media_modes.update_one(
        {"mode_key": payload.mode_key},
        {"$set": {"draft_logo_url": None, "draft_wordmark_url": None,
                  "updated_at": _now(), "updated_by": current.get("username")}})
    await _audit(current, "website_media.discard_draft", "mode", payload.mode_key,
                 before={"draft_logo_url": doc.get("draft_logo_url"),
                         "draft_wordmark_url": doc.get("draft_wordmark_url")}, after={})
    return {"ok": True}


@router.post("/admin/website-media/rollback")
async def admin_rollback_media(payload: ModeKeyPayload, current: CurrentUser):
    require_founder(current)
    doc = await db.website_media_modes.find_one({"mode_key": payload.mode_key}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Mode not found")
    if not (doc.get("version") or 0):
        raise HTTPException(400, "No previous published version to restore.")
    sets = {"published_at": _now(), "published_by": current.get("username"),
            "updated_at": _now(), "version": (doc.get("version") or 0) + 1,
            # swap published ↔ previous (previous may be None = "no asset")
            "published_logo_url": doc.get("previous_logo_url"),
            "previous_logo_url": doc.get("published_logo_url"),
            "published_wordmark_url": doc.get("previous_wordmark_url"),
            "previous_wordmark_url": doc.get("published_wordmark_url")}
    await db.website_media_modes.update_one({"mode_key": payload.mode_key}, {"$set": sets})
    _published_cache["data"] = None
    await _audit(current, "website_media.rollback", "mode", payload.mode_key,
                 before={"logo": doc.get("published_logo_url")}, after={"logo": sets.get("published_logo_url")})
    return {"ok": True}


# ═══ Public — published branding config ══════════════════════════════
@router.get("/website-media/published")
async def public_published():
    if _published_cache["data"] is None:
        out = {}
        async for m in db.website_media_modes.find({}, {"_id": 0, "mode_key": 1,
                                                        "published_logo_url": 1,
                                                        "published_wordmark_url": 1,
                                                        "version": 1}):
            out[m["mode_key"]] = {"logo": m.get("published_logo_url"),
                                  "wordmark": m.get("published_wordmark_url"),
                                  "v": m.get("version") or 0}
        _published_cache["data"] = out
    return {"modes": _published_cache["data"], "default_logo": DEFAULT_LOGO_URL}


# ═══ Admin — Tutorial builder ═════════════════════════════════════════
SLIDE_ACTIONS = {"next", "finish", "route", "none"}


class SlidePayload(BaseModel):
    media_type: str = Field(pattern="^(image|video)$")
    media_url: str
    poster_url: Optional[str] = None
    title: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    alt_text: Optional[str] = Field(default=None, max_length=200)
    button_label: Optional[str] = Field(default=None, max_length=40)
    button_action: str = "none"
    button_target: Optional[str] = None
    background: Optional[str] = Field(default=None, max_length=120)
    text_align: str = "center"
    image_fit: str = "cover"
    autoplay: bool = True
    loop: bool = False
    muted: bool = True
    show_controls: bool = True
    duration_ms: Optional[int] = None
    enabled: bool = True


def _validate_slide(p: SlidePayload):
    if not _durable(p.media_url):
        raise HTTPException(400, "Slide media must be a durable uploaded URL.")
    if p.poster_url and not _durable(p.poster_url):
        raise HTTPException(400, "Poster must be a durable uploaded URL.")
    if p.button_action not in SLIDE_ACTIONS:
        raise HTTPException(400, "Invalid button action.")
    if p.button_action == "route":
        if not p.button_target or not SAFE_ROUTE_RE.match(p.button_target):
            raise HTTPException(400, "Button route must be a safe internal path like /foryou.")


async def _get_tutorial() -> dict:
    doc = await db.tutorials.find_one({"id": "main"}, {"_id": 0})
    if not doc:
        await ensure_website_media_seed()
        doc = await db.tutorials.find_one({"id": "main"}, {"_id": 0})
    return doc


@router.get("/admin/tutorial")
async def admin_get_tutorial(current: CurrentUser):
    require_founder(current)
    t = await _get_tutorial()
    versions = [v async for v in db.tutorial_versions.find(
        {"tutorial_id": "main"}, {"_id": 0, "version": 1, "published_at": 1,
                                  "published_by": 1, "slide_count": 1}).sort("version", -1).limit(10)]
    return {"tutorial": t, "versions": versions}


class TutorialPatch(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)
    status: Optional[str] = Field(default=None, pattern="^(draft|published|disabled)$")
    audience: Optional[str] = Field(default=None, pattern="^(new_users|not_completed|all_users|founder_only)$")
    show_delay_ms: Optional[int] = Field(default=None, ge=0, le=60000)
    allow_skip: Optional[bool] = None
    allow_close: Optional[bool] = None
    show_progress: Optional[bool] = None
    auto_advance: Optional[bool] = None


@router.patch("/admin/tutorial")
async def admin_patch_tutorial(payload: TutorialPatch, current: CurrentUser):
    require_founder(current)
    sets = {k: v for k, v in payload.model_dump().items() if v is not None}
    sets["updated_at"] = _now()
    sets["updated_by"] = current.get("username")
    await db.tutorials.update_one({"id": "main"}, {"$set": sets})
    await _audit(current, "tutorial.save_draft", "tutorial", "main", after=sets)
    return {"ok": True, "tutorial": await _get_tutorial()}


@router.post("/admin/tutorial/slides")
async def admin_add_slide(payload: SlidePayload, current: CurrentUser):
    require_founder(current)
    _validate_slide(payload)
    t = await _get_tutorial()
    slide = {"id": uuid.uuid4().hex, **payload.model_dump(),
             "created_at": _now(), "updated_at": _now()}
    slides = (t.get("draft_slides") or []) + [slide]
    await db.tutorials.update_one({"id": "main"}, {"$set": {
        "draft_slides": slides, "updated_at": _now(), "updated_by": current.get("username")}})
    await _audit(current, "tutorial.add_slide", "slide", slide["id"],
                 after={"media_type": slide["media_type"], "title": slide.get("title")})
    return {"ok": True, "slide": slide}


@router.patch("/admin/tutorial/slides/{slide_id}")
async def admin_patch_slide(slide_id: str, payload: SlidePayload, current: CurrentUser):
    require_founder(current)
    _validate_slide(payload)
    t = await _get_tutorial()
    slides = t.get("draft_slides") or []
    idx = next((i for i, s in enumerate(slides) if s["id"] == slide_id), None)
    if idx is None:
        raise HTTPException(404, "Slide not found")
    before = dict(slides[idx])
    slides[idx] = {**slides[idx], **payload.model_dump(), "updated_at": _now()}
    await db.tutorials.update_one({"id": "main"}, {"$set": {
        "draft_slides": slides, "updated_at": _now(), "updated_by": current.get("username")}})
    await _audit(current, "tutorial.edit_slide", "slide", slide_id,
                 before={"title": before.get("title")}, after={"title": slides[idx].get("title")})
    return {"ok": True, "slide": slides[idx]}


@router.delete("/admin/tutorial/slides/{slide_id}")
async def admin_delete_slide(slide_id: str, current: CurrentUser):
    require_founder(current)
    t = await _get_tutorial()
    slides = [s for s in (t.get("draft_slides") or []) if s["id"] != slide_id]
    if len(slides) == len(t.get("draft_slides") or []):
        raise HTTPException(404, "Slide not found")
    await db.tutorials.update_one({"id": "main"}, {"$set": {
        "draft_slides": slides, "updated_at": _now(), "updated_by": current.get("username")}})
    await _audit(current, "tutorial.delete_slide", "slide", slide_id)
    return {"ok": True}


@router.post("/admin/tutorial/slides/{slide_id}/duplicate")
async def admin_duplicate_slide(slide_id: str, current: CurrentUser):
    require_founder(current)
    t = await _get_tutorial()
    slides = t.get("draft_slides") or []
    src = next((s for s in slides if s["id"] == slide_id), None)
    if not src:
        raise HTTPException(404, "Slide not found")
    dup = {**src, "id": uuid.uuid4().hex, "title": f"{src.get('title') or 'Slide'} (copy)",
           "created_at": _now(), "updated_at": _now()}
    slides.insert(slides.index(src) + 1, dup)
    await db.tutorials.update_one({"id": "main"}, {"$set": {"draft_slides": slides, "updated_at": _now()}})
    await _audit(current, "tutorial.duplicate_slide", "slide", dup["id"], before={"source": slide_id})
    return {"ok": True, "slide": dup}


class ReorderPayload(BaseModel):
    slide_ids: list[str]


@router.post("/admin/tutorial/slides/reorder")
async def admin_reorder_slides(payload: ReorderPayload, current: CurrentUser):
    require_founder(current)
    t = await _get_tutorial()
    by_id = {s["id"]: s for s in (t.get("draft_slides") or [])}
    if set(payload.slide_ids) != set(by_id.keys()):
        raise HTTPException(400, "slide_ids must contain every draft slide exactly once.")
    slides = [by_id[i] for i in payload.slide_ids]
    await db.tutorials.update_one({"id": "main"}, {"$set": {"draft_slides": slides, "updated_at": _now()}})
    await _audit(current, "tutorial.reorder_slides", "tutorial", "main", after={"order": payload.slide_ids})
    return {"ok": True}


class TutorialPublishPayload(BaseModel):
    show_to_everyone: bool = False


@router.post("/admin/tutorial/publish")
async def admin_publish_tutorial(payload: TutorialPublishPayload, current: CurrentUser):
    require_founder(current)
    t = await _get_tutorial()
    enabled = [s for s in (t.get("draft_slides") or []) if s.get("enabled")]
    if not enabled:
        raise HTTPException(400, "At least one enabled slide is required to publish.")
    for s in enabled:
        if not _durable(s.get("media_url")):
            raise HTTPException(400, f"Slide '{s.get('title') or s['id'][:8]}' has invalid media — publish aborted.")
        if s.get("button_action") == "route" and not SAFE_ROUTE_RE.match(s.get("button_target") or ""):
            raise HTTPException(400, "A slide has an unsafe button route — publish aborted.")
    new_version = (t.get("version") or 0) + 1
    snapshot = {
        "id": uuid.uuid4().hex, "tutorial_id": "main", "version": new_version,
        "name": t.get("name"), "slides": t.get("draft_slides") or [],
        "slide_count": len(enabled),
        "settings": {k: t.get(k) for k in ("audience", "show_delay_ms", "allow_skip",
                                           "allow_close", "show_progress", "auto_advance")},
        "show_to_everyone": payload.show_to_everyone,
        "published_at": _now(), "published_by": current.get("username"),
    }
    await db.tutorial_versions.insert_one(dict(snapshot))
    await db.tutorials.update_one({"id": "main"}, {"$set": {
        "status": "published", "version": new_version,
        "published_at": _now(), "published_by": current.get("username"), "updated_at": _now()}})
    await _audit(current, "tutorial.publish", "tutorial", "main",
                 after={"version": new_version, "slides": len(enabled),
                        "show_to_everyone": payload.show_to_everyone})
    return {"ok": True, "version": new_version}


@router.post("/admin/tutorial/rollback")
async def admin_rollback_tutorial(current: CurrentUser):
    require_founder(current)
    t = await _get_tutorial()
    cur_v = t.get("version") or 0
    prev = await db.tutorial_versions.find_one(
        {"tutorial_id": "main", "version": {"$lt": cur_v}}, {"_id": 0}, sort=[("version", -1)])
    if not prev:
        raise HTTPException(400, "No previous published version to restore.")
    new_version = cur_v + 1
    restored = {**prev, "id": uuid.uuid4().hex, "version": new_version,
                "published_at": _now(), "published_by": current.get("username"),
                "restored_from": prev["version"]}
    await db.tutorial_versions.insert_one(dict(restored))
    await db.tutorials.update_one({"id": "main"}, {"$set": {
        "draft_slides": prev.get("slides") or [], "version": new_version,
        "status": "published", "published_at": _now(), "updated_at": _now()}})
    await _audit(current, "tutorial.rollback", "tutorial", "main",
                 before={"version": cur_v}, after={"version": new_version, "restored_from": prev["version"]})
    return {"ok": True, "version": new_version, "restored_from": prev["version"]}


@router.delete("/admin/tutorial/draft")
async def admin_delete_tutorial_draft(current: CurrentUser):
    require_founder(current)
    t = await _get_tutorial()
    await db.tutorials.update_one({"id": "main"}, {"$set": {
        "draft_slides": [], "updated_at": _now(), "updated_by": current.get("username")}})
    await _audit(current, "tutorial.delete_draft", "tutorial", "main",
                 before={"slides": len(t.get("draft_slides") or [])})
    return {"ok": True}


# ═══ Public — active tutorial + progress ══════════════════════════════
def _latest_published_filter():
    return {"tutorial_id": "main"}


@router.get("/tutorial/active")
async def tutorial_active(current: CurrentUser):
    """Latest published tutorial for this viewer, honoring audience rules
    and server-side completion state."""
    t = await db.tutorials.find_one({"id": "main"}, {"_id": 0, "status": 1, "version": 1})
    if not t or t.get("status") != "published" or not t.get("version"):
        return {"tutorial": None}
    snap = await db.tutorial_versions.find_one(
        {"tutorial_id": "main", "version": t["version"]}, {"_id": 0})
    if not snap:
        return {"tutorial": None}
    settings = snap.get("settings") or {}
    audience = settings.get("audience") or "new_users"
    is_founder = (current.get("username") or "").lower() == "stealth"
    if audience == "founder_only" and not is_founder:
        return {"tutorial": None}
    prog = await db.user_tutorial_progress.find_one(
        {"user_id": current["id"], "tutorial_id": "main", "tutorial_version": t["version"]}, {"_id": 0})
    if prog and prog.get("state") in ("completed", "skipped") and audience != "all_users":
        return {"tutorial": None}
    if audience in ("new_users", "not_completed") and not snap.get("show_to_everyone"):
        if audience == "new_users":
            # Brand-new = account created after this version was published
            # OR never completed any version yet.
            done_any = await db.user_tutorial_progress.find_one(
                {"user_id": current["id"], "tutorial_id": "main",
                 "state": {"$in": ["completed", "skipped"]}}, {"_id": 0, "id": 1})
            if done_any:
                return {"tutorial": None}
        else:  # not_completed
            done_this = await db.user_tutorial_progress.find_one(
                {"user_id": current["id"], "tutorial_id": "main",
                 "tutorial_version": t["version"],
                 "state": {"$in": ["completed", "skipped"]}}, {"_id": 0, "id": 1})
            if done_this:
                return {"tutorial": None}
    slides = [s for s in (snap.get("slides") or []) if s.get("enabled")]
    return {"tutorial": {
        "version": t["version"], "name": snap.get("name"),
        "settings": settings, "slides": slides,
        "progress": prog,
    }}


class ProgressPayload(BaseModel):
    version: int
    last_slide_index: int = 0


async def _upsert_progress(user_id: str, version: int, sets: dict):
    now = _now()
    await db.user_tutorial_progress.update_one(
        {"user_id": user_id, "tutorial_id": "main", "tutorial_version": version},
        {"$set": {**sets, "updated_at": now},
         "$setOnInsert": {"id": uuid.uuid4().hex, "user_id": user_id,
                          "tutorial_id": "main", "tutorial_version": version,
                          "first_shown_at": now}},
        upsert=True,
    )


@router.post("/tutorial/progress/start")
async def tutorial_start(payload: ProgressPayload, current: CurrentUser):
    await _upsert_progress(current["id"], payload.version,
                           {"state": "in_progress", "last_slide_index": 0})
    return {"ok": True}


@router.post("/tutorial/progress/update")
async def tutorial_update(payload: ProgressPayload, current: CurrentUser):
    await _upsert_progress(current["id"], payload.version,
                           {"state": "in_progress", "last_slide_index": payload.last_slide_index})
    return {"ok": True}


@router.post("/tutorial/progress/complete")
async def tutorial_complete(payload: ProgressPayload, current: CurrentUser):
    await _upsert_progress(current["id"], payload.version,
                           {"state": "completed", "completed_at": _now(),
                            "last_slide_index": payload.last_slide_index})
    return {"ok": True}


@router.post("/tutorial/progress/skip")
async def tutorial_skip(payload: ProgressPayload, current: CurrentUser):
    await _upsert_progress(current["id"], payload.version,
                           {"state": "skipped", "skipped_at": _now(),
                            "last_slide_index": payload.last_slide_index})
    return {"ok": True}
