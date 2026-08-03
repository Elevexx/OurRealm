"""ORAi Preview Builds — minimal bridge from ORAi chat to the existing
internal build-agent workflow (services.llm_router — the same engine that
powers Game Studio builds).

An approved request generates ONE self-contained sandboxed HTML preview
page served at the admin-only route /admin/previews/{id}. Generated code
never touches the repo, database, auth, billing or production. Founder only.
Collection: orai_preview_builds.
"""
import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services.llm_router import call_llm
from services.orai_access import orai_audit

log = logging.getLogger("ourrealm.orai.builds")
router = APIRouter(prefix="/api/orai/builds", tags=["orai-builds"])

# Scope guard — v1 allows only preview pages / UI / content / styling.
BLOCKED = [
    (r"\b(deploy|push|publish)\w*\s+(it\s+)?(to\s+)?(the\s+)?(prod|production|live)\b", "production deployment"),
    (r"\bmigrat(e|ion|ions)\b", "database migrations"),
    (r"\b(drop|truncate)\s+(table|collection|database)\b", "database changes"),
    (r"\bdelete\s+\w*\s*(file|files|table|collection|user|account)", "deleting files or data"),
    (r"\b(auth|authentication|login|signin|password)\b.{0,30}\b(change|modify|system|flow|logic)\b", "authentication changes"),
    (r"\b(billing|payments?|stripe|checkout)\b", "billing changes"),
    (r"\b(secrets?|api\s*keys?|env(ironment)?\s+variables?|\.env)\b", "secrets or environment variables"),
]


def check_blocked(text: str):
    low = (text or "").lower()
    for pat, reason in BLOCKED:
        if re.search(pat, low):
            return reason
    return None


def _iso():
    return datetime.now(timezone.utc).isoformat()


DRAFT_SYSTEM = """You turn a founder's request into a preview-build instruction for OurRealm's internal build agent.
Reply ONLY valid JSON:
{"title": "short feature name (max 8 words)",
 "summary": "2-3 plain sentences describing exactly what will be built",
 "build_prompt": "a clear, complete build instruction for the page/UI feature: layout, sections, content, styling notes"}
Scope is STRICTLY: preview pages, UI components, text/content, styling. Admin-only preview — never mention publishing, databases, auth, billing or deployment."""

BUILD_SYSTEM = """You are OurRealm's internal preview builder. Produce ONE complete self-contained HTML document implementing the requested preview page or UI feature.
Rules:
- Dark theme matching OurRealm: background #0b1220, accent #2EE6FF, secondary accent #C26BFF, text #EAF2FF, font system-ui. All CSS inline in one <style> tag.
- Mobile-responsive. Generous spacing, rounded corners (12-16px), subtle borders rgba(46,230,255,0.2).
- Vanilla JS in one inline <script> tag ONLY if interactivity is needed (e.g. accordions, tabs).
- ABSOLUTELY NO network requests: no fetch/XHR/WebSocket, no external scripts, stylesheets, fonts or images. Inline SVG is fine.
- No forms that submit anywhere. No links to external sites.
Return ONLY the raw HTML document starting with <!DOCTYPE html>. No markdown fences, no commentary."""


async def draft_build(message: str, user: dict) -> dict:
    """Called from ORAi chat — creates an awaiting-approval build request."""
    reason = check_blocked(message)
    if reason:
        raise ValueError(f"this request involves {reason}, which is blocked for preview builds")
    raw = await call_llm(DRAFT_SYSTEM, message[:2000], power=3, json_mode=True, max_tokens=700)
    try:
        plan = json.loads(raw)
    except Exception:  # noqa: BLE001
        plan = {"title": message[:60], "summary": message[:200], "build_prompt": message[:2000]}
    req = {
        "id": uuid.uuid4().hex,
        "title": str(plan.get("title") or message[:60])[:120],
        "summary": str(plan.get("summary") or "")[:500],
        "build_prompt": str(plan.get("build_prompt") or message)[:4000],
        "approved": False, "status": "awaiting_approval",
        "result": None, "preview_route": None, "changed_files": [],
        "error": None, "spec": None,
        "source_message": message[:2000],
        "created_by": user["id"], "created_by_username": user.get("username"),
        "created_at": _iso(), "updated_at": _iso(),
    }
    await db.orai_preview_builds.insert_one({**req})
    await orai_audit(user, "preview_build_drafted", detail=f"{req['id']} · {req['title']}")
    return req


async def _run_build(build_id: str):
    doc = await db.orai_preview_builds.find_one({"id": build_id}, {"_id": 0})
    if not doc:
        return
    try:
        html = await call_llm(BUILD_SYSTEM, doc["build_prompt"], power=6, max_tokens=8000)
        html = re.sub(r"^```(html)?\s*|\s*```$", "", html.strip())
        if "<html" not in html.lower():
            raise ValueError("The builder did not return a valid page")
        await db.orai_preview_builds.update_one({"id": build_id}, {"$set": {
            "status": "complete",
            "result": f"Preview page \"{doc['title']}\" built and available at the admin-only preview route.",
            "preview_route": f"/admin/previews/{build_id}",
            "changed_files": [f"orai_previews/{build_id}/index.html (sandboxed virtual file — not in the repo)"],
            "spec": {"html": html}, "updated_at": _iso()}})
        await orai_audit({"id": doc["created_by"], "username": doc.get("created_by_username")},
                         "preview_build_completed", detail=f"{build_id} · {doc['title']}")
    except Exception as e:  # noqa: BLE001
        log.warning("preview build failed %s: %s", build_id, e)
        await db.orai_preview_builds.update_one({"id": build_id}, {"$set": {
            "status": "failed", "error": str(e)[:400], "updated_at": _iso()}})
        await orai_audit({"id": doc["created_by"], "username": doc.get("created_by_username")},
                         "preview_build_failed", detail=f"{build_id} · {str(e)[:120]}")


@router.get("/{build_id}")
async def get_build(build_id: str, current: CurrentUser):
    require_founder(current)
    doc = await db.orai_preview_builds.find_one({"id": build_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Build request not found")
    return doc


@router.post("/{build_id}/approve")
async def approve_build(build_id: str, current: CurrentUser):
    require_founder(current)
    doc = await db.orai_preview_builds.find_one({"id": build_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Build request not found")
    if doc["status"] != "awaiting_approval":
        raise HTTPException(status_code=409, detail=f"This request is already {doc['status']}")
    # Re-check the founder's ORIGINAL request (the LLM-written prompt may
    # legitimately contain negated mentions like "no billing changes").
    reason = check_blocked(doc.get("source_message") or doc["build_prompt"])
    if reason:
        raise HTTPException(status_code=400, detail=f"Blocked: involves {reason}")
    await db.orai_preview_builds.update_one({"id": build_id}, {"$set": {
        "approved": True, "status": "building", "updated_at": _iso()}})
    await orai_audit(current, "preview_build_approved", detail=f"{build_id} · {doc['title']}")
    asyncio.create_task(_run_build(build_id))
    return {"ok": True, "status": "building"}
