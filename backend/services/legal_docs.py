"""Legal document engine — registry-driven docs, immutable versioning,
draft/publish/archive lifecycle, ORAi section patches, user notices.

Reuses: call_openai_chat (ORAi pipeline), audit_log, notifications
(emit_notification), require_founder gate at the router. One shared
model for every doc type; new types = registry entry, zero new code.
"""
from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from core.db import db
from services.legal_seed_content import IMPORTED_DOCS

# Registry — standard document types. Custom pages get type "custom".
DOC_REGISTRY = [
    {"key": "terms",                 "title": "Terms of Service"},
    {"key": "privacy",               "title": "Privacy Policy"},
    {"key": "community",             "title": "Community Guidelines"},
    {"key": "cookies",               "title": "Cookie Notice"},
    {"key": "acceptable-use",        "title": "Acceptable Use Policy"},
    {"key": "account-deletion",      "title": "Account Closure & Deletion Policy"},
    {"key": "fire-power",            "title": "Fire Power Policy"},
    {"key": "responsibility-center", "title": "Responsibility Center Policy"},
    {"key": "orai",                  "title": "ORAi & AI Features Policy"},
    {"key": "dmca",                  "title": "Copyright & DMCA Policy"},
    {"key": "safety",                "title": "Safety & Teen Safety Policy"},
    {"key": "terms-conditions",      "title": "Terms & Conditions"},
]

SKELETON = ("## 1. Overview\n\n_Draft — content pending Founder review._\n\n"
            "## 2. Scope\n\n_Draft._\n\n## 3. Contact\n\n"
            "Questions? Email OurRealmSocial@gmail.com.")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sanitize(text: str) -> str:
    """Legal content is markdown rendered client-side without
    dangerouslySetInnerHTML, but we still strip active content
    server-side (script/style/iframe tags, event handlers, js: links)."""
    t = text or ""
    t = re.sub(r"<\s*(script|style|iframe|object|embed)[^>]*>.*?<\s*/\s*\1\s*>",
               "", t, flags=re.S | re.I)
    t = re.sub(r"<\s*(script|style|iframe|object|embed)[^>]*/?>", "", t, flags=re.I)
    t = re.sub(r"\son\w+\s*=\s*(\"[^\"]*\"|'[^']*'|\S+)", "", t, flags=re.I)
    t = re.sub(r"javascript\s*:", "", t, flags=re.I)
    return t[:200000]


async def _audit(action: str, actor: dict, **extra):
    try:
        await db.audit_log.insert_one({
            "id": uuid.uuid4().hex, "action": action,
            "actor_id": actor.get("id"), "actor_user": actor.get("username"),
            "at": _now_iso(), **extra})
    except Exception:  # noqa: BLE001
        pass


# ── Seed ────────────────────────────────────────────────────────────
async def seed_documents():
    """Idempotent. Imported pages become PUBLISHED v1 with their exact
    current wording; missing standard docs get UNPUBLISHED skeleton
    drafts. Never touches an existing row."""
    created = 0
    for entry in DOC_REGISTRY:
        key = entry["key"]
        if await db.legal_documents.find_one({"key": key}, {"_id": 1}):
            continue
        imported = IMPORTED_DOCS.get(key)
        now = _now_iso()
        doc = {
            "id": uuid.uuid4().hex, "key": key, "type": "standard",
            "title": imported["title"] if imported else entry["title"],
            "subtitle": (imported or {}).get("subtitle", ""),
            "slug": key,
            "created_at": now, "updated_at": now,
        }
        if imported:
            doc.update({
                "status": "published", "published_version": 1,
                "published_body": imported["body"],
                "effective_date": "2026-02-18", "last_updated": "2026-02-18",
                "draft_body": None, "draft_saved_at": None,
            })
            await db.legal_document_versions.insert_one({
                "id": uuid.uuid4().hex, "doc_key": key, "version": 1,
                "body": imported["body"], "title": doc["title"],
                "change_summary": "Imported existing published wording (Feb 18 2026)",
                "effective_date": "2026-02-18", "published_by": "system",
                "published_at": now})
        else:
            doc.update({
                "status": "draft", "published_version": 0,
                "published_body": None, "effective_date": None,
                "last_updated": None,
                "draft_body": SKELETON, "draft_saved_at": now,
            })
        await db.legal_documents.insert_one(doc)
        created += 1
    return created


# ── CRUD / lifecycle ────────────────────────────────────────────────
async def list_docs(include_archived: bool = True):
    q = {} if include_archived else {"status": {"$ne": "archived"}}
    return [d async for d in db.legal_documents.find(q, {"_id": 0}).sort("title", 1)]


async def get_doc(key: str):
    return await db.legal_documents.find_one({"key": key}, {"_id": 0})


async def create_custom(actor: dict, title: str, slug: str) -> dict:
    slug = re.sub(r"[^a-z0-9-]", "", slug.lower().strip())[:60]
    if not slug or not title.strip():
        raise ValueError("Title and slug are required")
    if await db.legal_documents.find_one({"$or": [{"key": slug}, {"slug": slug}]}):
        raise ValueError("A document with that slug already exists")
    now = _now_iso()
    doc = {"id": uuid.uuid4().hex, "key": slug, "type": "custom",
           "title": title.strip()[:120], "subtitle": "", "slug": slug,
           "status": "draft", "published_version": 0, "published_body": None,
           "effective_date": None, "last_updated": None,
           "draft_body": SKELETON, "draft_saved_at": now,
           "created_at": now, "updated_at": now}
    await db.legal_documents.insert_one(dict(doc))
    await _audit("legal.custom_created", actor, doc_key=slug)
    doc.pop("_id", None)
    return doc


async def save_draft(key: str, actor: dict, body: str, title: Optional[str] = None):
    doc = await get_doc(key)
    if not doc:
        raise ValueError("Document not found")
    sets = {"draft_body": sanitize(body), "draft_saved_at": _now_iso(),
            "updated_at": _now_iso()}
    if doc.get("status") == "archived":
        sets["status"] = "draft"
    elif not doc.get("published_version"):
        sets["status"] = "draft"
    if title and title.strip():
        sets["title"] = title.strip()[:120]
    await db.legal_documents.update_one({"key": key}, {"$set": sets})
    await _audit("legal.draft_saved", actor, doc_key=key)
    return await get_doc(key)


async def cancel_draft(key: str, actor: dict):
    doc = await get_doc(key)
    if not doc:
        raise ValueError("Document not found")
    await db.legal_documents.update_one(
        {"key": key}, {"$set": {"draft_body": None, "draft_saved_at": None,
                                "updated_at": _now_iso()}})
    await _audit("legal.draft_cancelled", actor, doc_key=key)
    return await get_doc(key)


async def publish(key: str, actor: dict, *, change_summary: str,
                  effective_date: Optional[str] = None):
    """Publishes the current draft as a NEW immutable version."""
    doc = await get_doc(key)
    if not doc:
        raise ValueError("Document not found")
    body = doc.get("draft_body")
    if not body or not body.strip():
        raise ValueError("Nothing to publish — save a draft first")
    if not (change_summary or "").strip():
        raise ValueError("A change summary is required")
    version = int(doc.get("published_version") or 0) + 1
    now = _now_iso()
    eff = (effective_date or now[:10])[:10]
    await db.legal_document_versions.insert_one({
        "id": uuid.uuid4().hex, "doc_key": key, "version": version,
        "body": body, "title": doc["title"],
        "change_summary": change_summary.strip()[:600],
        "effective_date": eff,
        "published_by": actor.get("username"), "published_at": now})
    await db.legal_documents.update_one({"key": key}, {"$set": {
        "status": "published", "published_version": version,
        "published_body": body, "effective_date": eff,
        "last_updated": now[:10], "draft_body": None,
        "draft_saved_at": None, "updated_at": now}})
    await db.legal_patches.update_many(
        {"doc_key": key, "approved": True, "publication_version": None},
        {"$set": {"publication_version": version}})
    await _audit("legal.published", actor, doc_key=key, version=version,
                 change_summary=change_summary.strip()[:300])
    return await get_doc(key)


async def archive(key: str, actor: dict):
    doc = await get_doc(key)
    if not doc:
        raise ValueError("Document not found")
    await db.legal_documents.update_one(
        {"key": key}, {"$set": {"status": "archived", "updated_at": _now_iso()}})
    await _audit("legal.archived", actor, doc_key=key)
    return await get_doc(key)


async def list_versions(key: str):
    return [v async for v in db.legal_document_versions.find(
        {"doc_key": key}, {"_id": 0}).sort("version", -1)]


async def rollback(key: str, actor: dict, version: int):
    """Publishes a previous version's body as a NEW version — history
    is never deleted or rewritten."""
    old = await db.legal_document_versions.find_one(
        {"doc_key": key, "version": int(version)}, {"_id": 0})
    if not old:
        raise ValueError("Version not found")
    await db.legal_documents.update_one(
        {"key": key}, {"$set": {"draft_body": old["body"],
                                "draft_saved_at": _now_iso()}})
    return await publish(key, actor,
                         change_summary=f"Rollback: restored version {version}")


# ── ORAi section patches ────────────────────────────────────────────
def split_sections(body: str) -> list[dict]:
    """Markdown '## ' headings define sections."""
    parts = re.split(r"(?m)^(## .+)$", body or "")
    sections = []
    i = 1
    while i < len(parts):
        sections.append({"heading": parts[i][3:].strip(),
                         "text": (parts[i] + parts[i + 1]).strip()})
        i += 2
    return sections


def _patch_hash(doc_key: str, section: str, instruction: str) -> str:
    return hashlib.sha256(f"{doc_key}|{section}|{instruction.strip().lower()}".encode()).hexdigest()


ORAI_SYSTEM = (
    "You are ORAi Legal Draft assistant for OurRealm. You revise EXACTLY ONE "
    "section of a legal document per the founder's instruction. Rules: "
    "return ONLY the revised section in markdown, starting with the same "
    "'## ' heading (update the heading only if instructed); make the "
    "MINIMAL change needed; never invent new platform features or legal "
    "claims; keep the document's existing tone; plain language. The output "
    "is a FOUNDER DRAFT that a human must review before publishing."
)


async def orai_patch(key: str, actor: dict, section_heading: str, instruction: str) -> dict:
    doc = await get_doc(key)
    if not doc:
        raise ValueError("Document not found")
    body = doc.get("draft_body") or doc.get("published_body") or ""
    sections = split_sections(body)
    target = next((s for s in sections if s["heading"] == section_heading), None)
    if not target:
        raise ValueError("Section not found in the current draft/published text")
    h = _patch_hash(key, section_heading, instruction)
    dup = await db.legal_patches.find_one({"hash": h, "approved": False}, {"_id": 0})
    if dup:
        return dup  # duplicate prevention — return the pending patch
    from services.chat_conversations import call_openai_chat
    resp = await call_openai_chat(
        [{"role": "system", "content": ORAI_SYSTEM},
         {"role": "user", "content":
          f"Document: {doc['title']}\nSection to revise:\n\n{target['text']}\n\n"
          f"Founder instruction: {instruction.strip()}"}],
        max_tokens=1600)
    proposed = sanitize((resp.get("content") or "").strip())
    if not proposed.startswith("## "):
        proposed = f"## {section_heading}\n\n" + proposed
    patch = {
        "id": uuid.uuid4().hex, "doc_key": key, "section": section_heading,
        "original": target["text"], "proposed": proposed,
        "instruction": instruction.strip()[:800], "hash": h,
        "approved": False, "applied_at": None,
        "model": resp.get("model"), "approver": None,
        "publication_version": None,
        "created_by": actor.get("username"), "created_at": _now_iso(),
        "ai_generated": True, "label": "Founder Draft (AI-assisted)",
    }
    await db.legal_patches.insert_one(dict(patch))
    await _audit("legal.orai_patch_generated", actor, doc_key=key,
                 section=section_heading, patch_id=patch["id"])
    patch.pop("_id", None)
    return patch


async def apply_patch(patch_id: str, actor: dict) -> dict:
    patch = await db.legal_patches.find_one({"id": patch_id}, {"_id": 0})
    if not patch:
        raise ValueError("Patch not found")
    if patch.get("approved"):
        raise ValueError("Patch already applied")
    doc = await get_doc(patch["doc_key"])
    body = doc.get("draft_body") or doc.get("published_body") or ""
    if patch["original"] not in body:
        raise ValueError("Section changed since the patch was generated — regenerate")
    new_body = body.replace(patch["original"], patch["proposed"], 1)
    await save_draft(patch["doc_key"], actor, new_body)
    await db.legal_patches.update_one(
        {"id": patch_id}, {"$set": {"approved": True, "applied_at": _now_iso(),
                                    "approver": actor.get("username")}})
    await _audit("legal.patch_applied", actor, doc_key=patch["doc_key"],
                 patch_id=patch_id)
    return await get_doc(patch["doc_key"])


async def list_patches(key: str):
    return [p async for p in db.legal_patches.find(
        {"doc_key": key}, {"_id": 0}).sort("created_at", -1).limit(50)]


# ── User legal notices ──────────────────────────────────────────────
async def create_notice(actor: dict, *, doc_keys: list[str], mode: str,
                        message: str, audience: str = "all") -> dict:
    if mode not in ("one_time", "ack_required"):
        raise ValueError("mode must be one_time or ack_required")
    docs = []
    for k in doc_keys:
        d = await get_doc(k)
        if d and d.get("published_version"):
            docs.append({"key": k, "title": d["title"],
                         "version": d["published_version"], "slug": d["slug"]})
    if not docs:
        raise ValueError("No published documents to notify about")
    notice = {
        "id": uuid.uuid4().hex, "docs": docs, "mode": mode,
        "audience": audience, "message": (message or "").strip()[:600],
        "created_by": actor.get("username"), "created_at": _now_iso(),
        "active": True,
    }
    await db.legal_notices.insert_one(dict(notice))
    await _audit("legal.notice_created", actor, notice_id=notice["id"],
                 mode=mode, docs=[d["key"] for d in docs])
    notice.pop("_id", None)
    return notice


async def pending_notices(user: dict) -> list[dict]:
    """Notices this user hasn't acknowledged. Dedupe is server-side per
    user+notice, so it holds across devices."""
    out = []
    async for n in db.legal_notices.find({"active": True}, {"_id": 0}).sort("created_at", -1).limit(5):
        ack = await db.legal_notice_acks.find_one(
            {"notice_id": n["id"], "user_id": user["id"]}, {"_id": 0})
        if ack and (ack.get("acknowledged_at") or n["mode"] == "one_time"):
            continue
        if not ack:
            await db.legal_notice_acks.update_one(
                {"notice_id": n["id"], "user_id": user["id"]},
                {"$setOnInsert": {"notice_id": n["id"], "user_id": user["id"],
                                  "shown_at": _now_iso(), "acknowledged_at": None,
                                  "method": None}},
                upsert=True)
        out.append(n)
    return out


async def acknowledge_notice(notice_id: str, user: dict, method: str = "modal"):
    await db.legal_notice_acks.update_one(
        {"notice_id": notice_id, "user_id": user["id"]},
        {"$set": {"acknowledged_at": _now_iso(), "method": method[:40]},
         "$setOnInsert": {"shown_at": _now_iso()}},
        upsert=True)
    return {"ok": True}
