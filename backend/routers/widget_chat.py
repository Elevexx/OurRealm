"""Conversational AI widget router (Phase 3.5).

Endpoints:
  • POST /api/widgets/chat/message      — send a user turn, get AI reply
  • GET  /api/widgets/chat/history      — load persisted history
  • POST /api/widgets/chat/clear        — wipe a conversation
  • POST /api/widgets/chat/regenerate   — re-run the last assistant turn
  • POST /api/widgets/chat/stream       — SSE streaming reply (Phase 3.5d)

All endpoints require auth. Each widget can declare:
  editor_config.chat = {
    mode: "single" | "conversational",
    system_prompt: str,
    model: str,
    temperature: float,
    max_tokens: int,
    memory_mode: "off" | "session" | "persistent",
    founder_only: bool,
    enable_streaming: bool,
    quick_actions: [str, ...],
  }

Honors provider enable flag + sliding-window rate limit + founder-only
access control. Variable interpolation supports {{user_message}},
{{username}}, {{display_name}}, {{profile_id}}, {{widget_id}}, {{realm_id}}.
"""
from __future__ import annotations
import json
import logging
import os
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict

from core.db import db
from core.deps import CurrentUser
from core.widget_templates import get_template
from services.provider_registry import is_enabled as provider_is_enabled
from services.chat_conversations import (
    append_messages, build_context, call_openai_chat, clear_conversation,
    compose_messages, get_conversation, pick_openai_model, pop_last_assistant,
)
from services.orion_analytics import maybe_handle_admin_query
from utils.sliding_window_rate_limit import rate_limit as sliding_rate_limit

logger = logging.getLogger("ourrealm.widget_chat")
router = APIRouter(prefix="/api/widgets/chat", tags=["widget-chat"])


# ─────────────────────────────────────────────────────────────────────
# Phase 3.7.3 — Orion built-in widget fallback
#
# Production environments occasionally lack the `widget_registry` row
# for the founder Orion chat widget (key=`stealth_ai_5a6`) because the
# row was never seeded. Rather than 404 the entire founder chat
# experience, we synthesize a virtual widget from `widget_templates`
# whenever the canonical Orion keys are requested AND no DB row exists.
# We also kick a one-shot idempotent upsert so the next call self-heals.
# ─────────────────────────────────────────────────────────────────────

ORION_WIDGET_KEYS = ("stealth_ai_5a6", "stealth_ai", "orion")


def _synth_orion_widget(widget_id: str) -> Dict[str, Any]:
    """Build an in-memory widget doc from the `stealth_ai` template so
    chat works even when the registry row is missing."""
    tpl = get_template("stealth_ai") or {}
    return {
        "id": widget_id,
        "key": widget_id,
        "status": "live",
        "name": tpl.get("name") or "ORAi (Founder)",
        "editor_config": tpl.get("editor_config") or {},
        "_synthetic": True,
    }


async def _heal_orion_registry(widget_id: str) -> None:
    """Idempotently insert the canonical Orion widget if it's missing.
    Safe to call repeatedly — uses $setOnInsert so a real seeded row is
    never overwritten."""
    try:
        tpl = get_template("stealth_ai")
        if not tpl:
            return
        await db.widget_registry.update_one(
            {"key": widget_id},
            {
                "$setOnInsert": {
                    "id": widget_id,
                    "key": widget_id,
                    "status": "live",
                    "name": tpl.get("name") or "ORAi (Founder)",
                    "category_group": tpl.get("category_group") or "utility",
                    "icon": tpl.get("icon") or "Sparkles",
                    "description": tpl.get("description") or "",
                    "editor_config": tpl.get("editor_config") or {},
                    "founder_only": True,
                    "auto_healed": True,
                }
            },
            upsert=True,
        )
        logger.info("orion.heal: ensured widget_registry row key=%s", widget_id)
    except Exception:  # noqa: BLE001
        logger.exception("orion.heal: failed to upsert Orion widget %s", widget_id)


# ─────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────

class ChatMessagePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    widget_id: str
    message: str = Field(..., min_length=1, max_length=8000)
    realm_id: Optional[str] = None


class ChatClearPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    widget_id: str


class ChatRegeneratePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    widget_id: str
    realm_id: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

async def _load_widget(widget_id: str) -> Dict[str, Any]:
    # Phase 3.5+ — widgets are referenced from a user's profile by their
    # registry KEY (e.g. ``stealth_ai_5a6``), not the registry doc UUID.
    # We accept either so old test/admin paths that pass the UUID still
    # work, while the new profile-render path can pass the key cleanly.
    widget = await db.widget_registry.find_one({"$or": [{"id": widget_id}, {"key": widget_id}]})
    if widget:
        return widget
    # Phase 3.7.3 — Orion built-in fallback. If the registry row is
    # missing for the canonical Orion keys (e.g. unseeded production
    # DBs), synthesize a virtual widget from `widget_templates` so the
    # founder can still chat. Kick a non-blocking idempotent heal so
    # subsequent calls hit the real row.
    if widget_id in ORION_WIDGET_KEYS:
        logger.warning("orion.fallback: widget_registry missing for %s — using synthetic", widget_id)
        try:
            await _heal_orion_registry(widget_id)
        except Exception:  # noqa: BLE001
            pass
        return _synth_orion_widget(widget_id)
    raise HTTPException(status_code=404, detail="Widget not found")


def _get_chat_config(widget: Dict[str, Any]) -> Dict[str, Any]:
    """Extract chat config from editor_config.chat (preferred) or
    fall back to editor_config.data_source (legacy single-prompt)."""
    ec = widget.get("editor_config") or {}
    chat = ec.get("chat")
    if isinstance(chat, dict):
        return chat
    # Fallback — single-prompt API widget is technically not a chat,
    # but we still allow founders to test chat against any openai widget.
    ds = ec.get("data_source") or {}
    if ds.get("provider") == "openai":
        return {
            "mode": "conversational",
            "system_prompt": (ds.get("params") or {}).get("system_prompt") or "",
            "model": (ds.get("params") or {}).get("model") or "gpt-5.4-mini",
            "memory_mode": "persistent",
            "founder_only": False,
        }
    return {}


def _enforce_access(current: Dict[str, Any], widget: Dict[str, Any],
                    chat_cfg: Dict[str, Any]) -> None:
    if not current:
        raise HTTPException(status_code=401, detail="Login required")
    # Founder-only enforcement.
    if chat_cfg.get("founder_only"):
        uname = (current.get("username") or "").lower()
        if uname != "stealth":
            raise HTTPException(status_code=403, detail="This AI widget is founder-only.")
    # Widget must be live OR caller is the owner / admin.
    if widget.get("status") not in ("live", "draft"):
        raise HTTPException(status_code=404, detail="Widget not live")


async def _check_chat_rate(current: Dict[str, Any], widget_id: str) -> Dict[str, Any]:
    """Per-user, per-widget sliding window — 30 chat calls / minute.
    Raises 429 when denied so the route exits cleanly."""
    user_id = current.get("id") or current.get("username") or "anon"
    key = f"chat:{user_id}:{widget_id}"
    rl = await sliding_rate_limit(
        key,
        max_requests=30,
        window_seconds=60,
        event_meta={"endpoint": f"chat:{widget_id}", "user": user_id},
    )
    if not rl.get("allowed"):
        raise HTTPException(
            status_code=429,
            detail=f"Chat rate limit reached. Retry in {rl.get('retry_after', 1)}s.",
            headers={"Retry-After": str(rl.get("retry_after", 1))},
        )
    return rl


def _set_rate_headers(response: Response, rl: Optional[Dict[str, Any]]) -> None:
    if not rl:
        return
    if rl.get("limit") is not None:
        response.headers["X-RateLimit-Limit"] = str(rl["limit"])
    if rl.get("remaining") is not None:
        response.headers["X-RateLimit-Remaining"] = str(rl["remaining"])
    if rl.get("reset_in") is not None:
        response.headers["X-RateLimit-Reset"] = str(rl["reset_in"])


# ─────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────

@router.post("/message")
async def chat_message(payload: ChatMessagePayload, current: CurrentUser, response: Response):
    widget = await _load_widget(payload.widget_id)
    chat_cfg = _get_chat_config(widget)
    if not chat_cfg:
        raise HTTPException(status_code=400, detail="Widget is not configured for chat.")
    _enforce_access(current, widget, chat_cfg)

    # Phase 3.6 — Orion analytics interceptor. When the caller is a
    # founder/admin AND their message matches an analytics intent
    # (DAU, signups, investor snapshot, top realms, etc.), we return
    # a deterministic, live summary built from existing analytics
    # services and SKIP the OpenAI call. Non-admins who type a
    # similar query receive a polite refusal — never a permission
    # error or leaked endpoint name. Non-matching messages fall
    # through to the normal chat path below.
    analytics_reply = await maybe_handle_admin_query(current, payload.message)
    if analytics_reply is not None:
        memory_mode = (chat_cfg.get("memory_mode") or "persistent").lower()
        if memory_mode != "off":
            await append_messages(
                payload.widget_id, current["id"],
                [
                    {"role": "user", "content": payload.message},
                    {"role": "assistant", "content": analytics_reply},
                ],
            )
        return {
            "reply": analytics_reply,
            "model": "orai-analytics",
            "usage": {},
            "finish_reason": "analytics_tool",
            "memory_mode": memory_mode,
            "rate_limit": None,
        }

    # Provider gate — OpenAI must be enabled.
    if not await provider_is_enabled("openai"):
        raise HTTPException(status_code=403, detail="OpenAI provider is disabled by admin.")

    rl_meta = await _check_chat_rate(current, payload.widget_id)
    memory_mode = (chat_cfg.get("memory_mode") or "persistent").lower()

    # Load history if memory != off.
    history: List[Dict[str, Any]] = []
    if memory_mode != "off":
        conv = await get_conversation(payload.widget_id, current["id"])
        history = conv.get("messages") or []

    ctx = build_context(current, widget, payload.message, realm_id=payload.realm_id)
    messages = compose_messages(
        system_prompt=chat_cfg.get("system_prompt"),
        history=history,
        user_message=payload.message,
        memory_mode=memory_mode,
        ctx=ctx,
    )

    try:
        reply = await call_openai_chat(
            messages,
            model=pick_openai_model(chat_cfg.get("model"),
                                    payload.message if (current.get("username") or "").lower() == "stealth" else ""),
            temperature=chat_cfg.get("temperature"),
            max_tokens=chat_cfg.get("max_tokens"),
        )
    except HTTPException as he:
        # Phase 3.7.4 — capture provider failure into Orion audit log
        # before re-raising so the founder Timeline shows what happened.
        try:
            from services.orion_analytics import log_provider_event
            await log_provider_event(
                user=current, event="provider_failure", provider="openai+emergent",
                success=False, execution_ms=0,
                detail=f"HTTP {he.status_code}: {str(he.detail)[:160]}",
            )
        except Exception:  # noqa: BLE001
            pass
        raise

    # Phase 3.7.4 — record provider events in the existing Orion audit
    # log so the Timeline view surfaces every Emergent fallback / OpenAI
    # success. Fast path: no-op when the primary provider answered.
    if reply.get("provider") and reply.get("provider") != "openai":
        try:
            from services.orion_analytics import log_provider_event
            await log_provider_event(
                user=current, event="provider_switch", provider=reply.get("provider"),
                success=True, execution_ms=0,
                detail=f"OpenAI failed → answered via {reply.get('provider')} fallback.",
            )
        except Exception:  # noqa: BLE001
            pass

    # Persist BOTH turns iff memory != off.
    if memory_mode != "off":
        await append_messages(
            payload.widget_id, current["id"],
            [
                {"role": "user", "content": payload.message},
                {"role": "assistant", "content": reply["content"]},
            ],
        )

    _set_rate_headers(response, rl_meta)
    return {
        "reply": reply["content"],
        "model": reply.get("model"),
        "usage": reply.get("usage") or {},
        "finish_reason": reply.get("finish_reason"),
        "memory_mode": memory_mode,
        "rate_limit": rl_meta,
    }


@router.get("/history")
async def chat_history(widget_id: str, current: CurrentUser):
    if not current:
        raise HTTPException(status_code=401, detail="Login required")
    widget = await _load_widget(widget_id)
    chat_cfg = _get_chat_config(widget)
    _enforce_access(current, widget, chat_cfg)
    return await get_conversation(widget_id, current["id"])


@router.post("/clear")
async def chat_clear(payload: ChatClearPayload, current: CurrentUser):
    if not current:
        raise HTTPException(status_code=401, detail="Login required")
    widget = await _load_widget(payload.widget_id)
    chat_cfg = _get_chat_config(widget)
    _enforce_access(current, widget, chat_cfg)
    deleted = await clear_conversation(payload.widget_id, current["id"])
    return {"deleted": deleted, "widget_id": payload.widget_id}


@router.post("/regenerate")
async def chat_regenerate(payload: ChatRegeneratePayload, current: CurrentUser, response: Response):
    widget = await _load_widget(payload.widget_id)
    chat_cfg = _get_chat_config(widget)
    if not chat_cfg:
        raise HTTPException(status_code=400, detail="Widget is not configured for chat.")
    _enforce_access(current, widget, chat_cfg)
    if not await provider_is_enabled("openai"):
        raise HTTPException(status_code=403, detail="OpenAI provider is disabled by admin.")

    # Drop the last assistant turn, then re-run from the prior history.
    popped = await pop_last_assistant(payload.widget_id, current["id"])
    conv = await get_conversation(payload.widget_id, current["id"])
    history = conv.get("messages") or []
    if not history or history[-1].get("role") != "user":
        raise HTTPException(status_code=400, detail="No previous user turn to regenerate from.")

    rl_meta = await _check_chat_rate(current, payload.widget_id)
    memory_mode = (chat_cfg.get("memory_mode") or "persistent").lower()
    last_user_msg = history[-1]["content"]
    # Pass history MINUS the last user turn (compose_messages will re-add it).
    ctx = build_context(current, widget, last_user_msg, realm_id=payload.realm_id)
    messages = compose_messages(
        system_prompt=chat_cfg.get("system_prompt"),
        history=history[:-1],
        user_message=last_user_msg,
        memory_mode=memory_mode,
        ctx=ctx,
    )

    reply = await call_openai_chat(
        messages,
        model=pick_openai_model(chat_cfg.get("model"),
                                last_user_msg if (current.get("username") or "").lower() == "stealth" else ""),
        temperature=chat_cfg.get("temperature"),
        max_tokens=chat_cfg.get("max_tokens"),
    )

    # Append the new assistant turn (the user turn is already in history).
    if memory_mode != "off":
        await append_messages(
            payload.widget_id, current["id"],
            [{"role": "assistant", "content": reply["content"]}],
        )

    _set_rate_headers(response, rl_meta)
    return {
        "reply": reply["content"],
        "model": reply.get("model"),
        "usage": reply.get("usage") or {},
        "regenerated_from": popped,
        "rate_limit": rl_meta,
    }


__all__ = ["router"]


# ─────────────────────────────────────────────────────────────────────
# Phase 3.5d — SSE streaming reply
# ─────────────────────────────────────────────────────────────────────

@router.post("/stream")
async def chat_stream(payload: ChatMessagePayload, current: CurrentUser):
    """Server-Sent-Events stream. Each frame is `data: {json}\\n\\n` with:
      • {"delta": "..."}   token chunks
      • {"done": true, "full": "..."} final message
      • {"error": "..."}   upstream failure

    Falls back gracefully when streaming is disabled on the widget."""
    widget = await _load_widget(payload.widget_id)
    chat_cfg = _get_chat_config(widget)
    if not chat_cfg:
        raise HTTPException(status_code=400, detail="Widget is not configured for chat.")
    _enforce_access(current, widget, chat_cfg)
    if not chat_cfg.get("enable_streaming"):
        raise HTTPException(status_code=400, detail="Streaming is not enabled for this widget.")
    if not await provider_is_enabled("openai"):
        raise HTTPException(status_code=403, detail="OpenAI provider is disabled by admin.")

    await _check_chat_rate(current, payload.widget_id)
    memory_mode = (chat_cfg.get("memory_mode") or "persistent").lower()

    history: List[Dict[str, Any]] = []
    if memory_mode != "off":
        conv = await get_conversation(payload.widget_id, current["id"])
        history = conv.get("messages") or []

    ctx = build_context(current, widget, payload.message, realm_id=payload.realm_id)
    messages = compose_messages(
        system_prompt=chat_cfg.get("system_prompt"),
        history=history,
        user_message=payload.message,
        memory_mode=memory_mode,
        ctx=ctx,
    )

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="OpenAI is not configured on the server.")

    body = {
        "model": pick_openai_model(chat_cfg.get("model"),
                                   payload.message if (current.get("username") or "").lower() == "stealth" else "") or "gpt-5.4-mini",
        "messages": messages,
        "temperature": float(chat_cfg.get("temperature") if chat_cfg.get("temperature") is not None else 0.7),
        "max_completion_tokens": int(chat_cfg.get("max_tokens") or 600),
        "stream": True,
    }
    if body["model"] == "gpt-5.6-terra":
        body.pop("temperature", None)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    async def event_source() -> AsyncIterator[bytes]:
        full = ""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", "https://api.openai.com/v1/chat/completions",
                                         headers=headers, json=body) as resp:
                    if resp.status_code >= 400:
                        snippet = (await resp.aread()).decode("utf-8", errors="ignore")[:300]
                        yield f"data: {json.dumps({'error': f'OpenAI {resp.status_code}: {snippet}'})}\n\n".encode()
                        return
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        chunk = line[5:].strip()
                        if chunk == "[DONE]":
                            break
                        try:
                            obj = json.loads(chunk)
                        except Exception:
                            continue
                        delta = (obj.get("choices") or [{}])[0].get("delta", {}).get("content")
                        if delta:
                            full += delta
                            yield f"data: {json.dumps({'delta': delta})}\n\n".encode()
            # Persist BOTH turns after the stream finishes.
            if memory_mode != "off" and full:
                await append_messages(
                    payload.widget_id, current["id"],
                    [
                        {"role": "user", "content": payload.message},
                        {"role": "assistant", "content": full},
                    ],
                )
            yield f"data: {json.dumps({'done': True, 'full': full})}\n\n".encode()
        except Exception as e:  # noqa: BLE001
            logger.exception("SSE stream failed")
            yield f"data: {json.dumps({'error': str(e)[:300]})}\n\n".encode()

    return StreamingResponse(event_source(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })
