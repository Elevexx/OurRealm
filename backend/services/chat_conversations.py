"""Conversational AI widget engine (Phase 3.5).

Persistence + variable interpolation + OpenAI call orchestration for
conversational AI widgets. Keeps a `widget_conversations` collection
per (widget_id, user_id) and supports three memory modes:

  • `off`        — never persist; each /message call sends only the
                   incoming user message (stateless).
  • `session`    — persist in-memory only inside a single browser
                   session. We still write to Mongo so refreshes
                   survive but the client clears on logout.
  • `persistent` — full server-side persistence across devices.

Variable interpolation supports:
  {{user_message}}, {{username}}, {{display_name}},
  {{profile_id}},   {{widget_id}}, {{realm_id}}

Founder-only enforcement is honored at the router layer.
"""
from __future__ import annotations
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import HTTPException

from core.db import db

logger = logging.getLogger("ourrealm.chat_conversations")

MAX_HISTORY_TURNS = 40  # Cap context window — older turns get trimmed.
MAX_MESSAGE_CHARS = 8000
DEFAULT_MODEL = "gpt-5-mini"
# Deep-reasoning escalation — only for the founder's ORAi chat when the
# message is clearly a complex coding/architecture/planning task.
REASONING_MODEL = "gpt-5.6-terra"
COMPLEX_TASK_RE = re.compile(
    r"\b(debug|refactor|architect(?:ure)?|stack ?trace|traceback|algorithm|"
    r"code review|write (?:the )?code|implement|optimi[sz]e|database schema|"
    r"migration plan|long[- ]term plan|roadmap|step[- ]by[- ]step plan|deep dive)\b",
    re.IGNORECASE)


LEGACY_MODELS = (
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4",
    "gpt-3.5-turbo",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
)


def pick_openai_model(cfg_model, message):
    """Return gpt-5.6-terra for complex-reasoning founder messages when the
    widget runs the default model; otherwise the configured model.
    Legacy models stored in widget configs are normalized FIRST so a stale
    DB value can never block the escalation (production bug 2026-07-30).
    The Emergent fallback inside call_openai_chat keeps DEFAULT_MODEL."""
    base = DEFAULT_MODEL if (not cfg_model or cfg_model in LEGACY_MODELS) else cfg_model
    if base == DEFAULT_MODEL and message and COMPLEX_TASK_RE.search(message):
        logger.info("ORAi routing: complex-task rule matched — requesting %s", REASONING_MODEL)
        return REASONING_MODEL
    return base
DEFAULT_TEMPERATURE = 0.7
DEFAULT_MAX_TOKENS = 600
OPENAI_TIMEOUT_SECONDS = 45.0

VARIABLE_PATTERN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


# ─────────────────────────────────────────────────────────────────────
# Variable interpolation
# ─────────────────────────────────────────────────────────────────────

def interpolate(template: str, context: Dict[str, Any]) -> str:
    """Replace {{var}} tokens in `template` from `context`. Unknown
    vars are left in place so the user can see what didn't resolve."""
    if not template or not isinstance(template, str):
        return template or ""

    def _replace(match: re.Match) -> str:
        key = match.group(1)
        val = context.get(key)
        if val is None:
            return match.group(0)
        return str(val)

    return VARIABLE_PATTERN.sub(_replace, template)


def build_context(user: Optional[Dict[str, Any]],
                  widget: Optional[Dict[str, Any]],
                  user_message: str,
                  realm_id: Optional[str] = None) -> Dict[str, Any]:
    user = user or {}
    widget = widget or {}
    return {
        "user_message": user_message or "",
        "username": user.get("username") or "",
        "display_name": user.get("name") or user.get("username") or "",
        "profile_id": user.get("id") or "",
        "widget_id": widget.get("id") or "",
        "widget_key": widget.get("key") or "",
        "realm_id": realm_id or "",
    }


# ─────────────────────────────────────────────────────────────────────
# Conversation persistence
# ─────────────────────────────────────────────────────────────────────

def _conv_id(widget_id: str, user_id: str) -> str:
    return f"{widget_id}::{user_id}"


async def get_conversation(widget_id: str, user_id: str) -> Dict[str, Any]:
    cid = _conv_id(widget_id, user_id)
    doc = await db.widget_conversations.find_one({"_id": cid})
    if not doc:
        return {"widget_id": widget_id, "user_id": user_id, "messages": [], "updated_at": None}
    msgs = doc.get("messages") or []
    return {
        "widget_id": widget_id,
        "user_id": user_id,
        "messages": msgs,
        "updated_at": doc.get("updated_at").isoformat() if isinstance(doc.get("updated_at"), datetime) else doc.get("updated_at"),
    }


async def append_messages(widget_id: str, user_id: str,
                          new_messages: List[Dict[str, Any]]) -> None:
    """Append turns to the conversation. Each message: {role, content,
    created_at}. Auto-trims to MAX_HISTORY_TURNS."""
    if not new_messages:
        return
    cid = _conv_id(widget_id, user_id)
    now = datetime.now(timezone.utc)
    safe_msgs = [_sanitize_msg(m, now) for m in new_messages]
    await db.widget_conversations.update_one(
        {"_id": cid},
        {
            "$setOnInsert": {"_id": cid, "widget_id": widget_id, "user_id": user_id, "created_at": now},
            "$push": {"messages": {"$each": safe_msgs, "$slice": -MAX_HISTORY_TURNS}},
            "$set": {"updated_at": now},
        },
        upsert=True,
    )


async def clear_conversation(widget_id: str, user_id: str) -> int:
    cid = _conv_id(widget_id, user_id)
    res = await db.widget_conversations.delete_one({"_id": cid})
    return res.deleted_count or 0


async def pop_last_assistant(widget_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Pop the LAST message if it's an assistant turn (used by /regenerate)."""
    cid = _conv_id(widget_id, user_id)
    doc = await db.widget_conversations.find_one({"_id": cid})
    if not doc:
        return None
    msgs = list(doc.get("messages") or [])
    if not msgs or msgs[-1].get("role") != "assistant":
        return None
    last = msgs.pop()
    await db.widget_conversations.update_one(
        {"_id": cid},
        {"$set": {"messages": msgs, "updated_at": datetime.now(timezone.utc)}},
    )
    return last


def _sanitize_msg(m: Dict[str, Any], default_ts: datetime) -> Dict[str, Any]:
    role = (m.get("role") or "user").lower()
    if role not in ("user", "assistant", "system"):
        role = "user"
    content = (m.get("content") or "")[:MAX_MESSAGE_CHARS]
    ts = m.get("created_at")
    if isinstance(ts, datetime):
        ts = ts.isoformat()
    elif not isinstance(ts, str):
        ts = default_ts.isoformat()
    out = {"role": role, "content": content, "created_at": ts}
    if m.get("image_url"):
        out["image_url"] = str(m["image_url"])[:300]
    return out


# ─────────────────────────────────────────────────────────────────────
# OpenAI chat invocation
# ─────────────────────────────────────────────────────────────────────

async def call_openai_chat(messages: List[Dict[str, str]], *,
                           model: Optional[str] = None,
                           temperature: Optional[float] = None,
                           max_tokens: Optional[int] = None,
                           json_mode: bool = False) -> Dict[str, Any]:
    """Call OpenAI Chat Completions with the full messages array.
    Returns {content, model, usage, finish_reason}.

    Phase 3.7.3 — graceful provider failure handling:
      • Tries the configured `OPENAI_API_KEY` directly first.
      • On 401/403/transport failure, falls back to the Emergent
        Universal LLM Key (`EMERGENT_LLM_KEY`) via `emergentintegrations`
        so prod stays online even when the OpenAI key is rotated/revoked.
      • All upstream auth / connectivity failures collapse to a single
        sanitized 503 with detail:
            "ORAi LLM provider is unavailable or misconfigured."
        so the founder UI never sees raw OpenAI error shells or stalls
        long enough for the reverse proxy to Cloudflare-502 the request.
    """
    if not messages:
        raise HTTPException(status_code=400, detail="No messages to send.")

    def _clean_key(raw: Optional[str], name: str) -> Optional[str]:
        key = (raw or "").strip()
        if not key:
            return None
        if not key.isascii():
            bad = [f"pos {i}: U+{ord(c):04X}" for i, c in enumerate(key) if ord(c) > 127][:3]
            logger.error("ORAi LLM: %s contains non-ASCII characters (%s) — likely a paste "
                         "corruption in the environment variable. Key skipped.", name, "; ".join(bad))
            return None
        return key

    primary_key = _clean_key(os.environ.get("OPENAI_API_KEY"), "OPENAI_API_KEY")
    fallback_key = _clean_key(os.environ.get("EMERGENT_LLM_KEY"), "EMERGENT_LLM_KEY")
    if not primary_key and not fallback_key:
        logger.error("ORAi LLM call: no OPENAI_API_KEY and no EMERGENT_LLM_KEY configured.")
        raise HTTPException(status_code=503, detail="ORAi LLM provider is unavailable or misconfigured.")

    chosen_model = model or DEFAULT_MODEL
    if chosen_model in LEGACY_MODELS:
        chosen_model = DEFAULT_MODEL  # legacy configs stored in DB → current default
    body: Dict[str, Any] = {
        "model": chosen_model,
        "messages": messages,
        "temperature": float(temperature) if temperature is not None else DEFAULT_TEMPERATURE,
        # gpt-5.x models reject the legacy `max_tokens` parameter.
        "max_completion_tokens": int(max_tokens) if max_tokens is not None else DEFAULT_MAX_TOKENS,
    }
    if chosen_model.startswith("gpt-5"):
        body.pop("temperature", None)  # gpt-5 family only supports the default temperature
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    url = "https://api.openai.com/v1/chat/completions"

    # ── Attempt 1: direct OpenAI with our own key ─────────────────────
    last_error: Optional[str] = None
    if primary_key:
        try:
            async with httpx.AsyncClient(timeout=OPENAI_TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {primary_key}", "Content-Type": "application/json"},
                    json=body,
                )
            if resp.status_code == 429:
                raise HTTPException(status_code=429, detail=f"OpenAI rate-limited: {resp.text[:200]}")
            if resp.status_code in (401, 403):
                logger.warning("ORAi LLM openai rejected auth (%s): %s — trying Emergent fallback.",
                               resp.status_code, resp.text[:300])
                last_error = f"openai_{resp.status_code}"
            elif resp.status_code >= 400:
                logger.warning("ORAi LLM openai returned %s: %s", resp.status_code, resp.text[:200])
                last_error = f"openai_{resp.status_code}"
            else:
                try:
                    data = resp.json()
                    choice = (data.get("choices") or [{}])[0]
                    msg = (choice.get("message") or {}).get("content") or ""
                    logger.info("ORAi routing: requested=%s returned=%s provider=openai",
                                chosen_model, data.get("model"))
                    return {
                        "content": msg,
                        "model": data.get("model"),
                        "requested_model": chosen_model,
                        "usage": data.get("usage") or {},
                        "finish_reason": choice.get("finish_reason"),
                        "provider": "openai",
                    }
                except Exception:  # noqa: BLE001
                    logger.warning("ORAi LLM openai returned non-JSON")
                    last_error = "openai_non_json"
        except HTTPException:
            raise
        except httpx.HTTPError as e:
            logger.warning("ORAi LLM openai transport error: %s", e)
            last_error = "openai_transport"
        except Exception as e:  # noqa: BLE001 — e.g. UnicodeEncodeError from a corrupted key
            logger.error("ORAi LLM openai unexpected error (%s): %s — trying Emergent fallback.",
                         type(e).__name__, str(e)[:200])
            last_error = f"openai_{type(e).__name__}"

    # ── Attempt 2: Emergent universal key via emergentintegrations ────
    if fallback_key:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage  # local import — optional dep
            system_text = ""
            user_turns: List[str] = []
            for m in messages:
                if m.get("role") == "system":
                    system_text += (m.get("content") or "") + "\n"
                else:
                    role = m.get("role") or "user"
                    user_turns.append(f"[{role}]\n{m.get('content') or ''}")
            combined = "\n\n".join(user_turns) or (messages[-1].get("content") or "")
            chat = LlmChat(
                api_key=fallback_key,
                session_id=f"orion-fallback-{abs(hash(combined)) % 10_000_000}",
                system_message=system_text.strip() or "You are ORAi, the founder assistant for OurRealm.",
            ).with_model("openai", "gpt-5-mini")
            reply = await chat.send_message(UserMessage(text=combined))
            logger.info(
    "ORAi routing: requested=%s returned=gpt-5-mini provider=emergent (FALLBACK)",
    chosen_model,
)
            return {
                "content": reply if isinstance(reply, str) else str(reply),
                "model": "gpt-5-mini",
                "requested_model": chosen_model,
                "usage": {},
                "finish_reason": "stop",
                "provider": "emergent",
            }
        except Exception as e:  # noqa: BLE001
            logger.warning("ORAi LLM emergent fallback failed: %s", e)
            last_error = f"emergent:{str(e)[:200]}"

    logger.error("ORAi LLM: all providers failed (last=%s).", last_error)
    raise HTTPException(
        status_code=503,
        detail=f"ORAi LLM provider failed. Diagnostic: {last_error or 'unknown_error'}",
    )


# ─────────────────────────────────────────────────────────────────────
# High-level "compose + send" used by /widgets/chat/message
# ─────────────────────────────────────────────────────────────────────

def compose_messages(*, system_prompt: Optional[str],
                     history: List[Dict[str, Any]],
                     user_message: str,
                     memory_mode: str,
                     ctx: Dict[str, Any]) -> List[Dict[str, str]]:
    """Build the messages array OpenAI will see.
    - Interpolates `system_prompt` against ctx.
    - Includes history ONLY if memory_mode != 'off'.
    - Appends the new user_message (interpolated).
    """
    out: List[Dict[str, str]] = []
    sys_text = interpolate(system_prompt or "", ctx).strip()
    if sys_text:
        out.append({"role": "system", "content": sys_text})

    if memory_mode != "off":
        for m in (history or []):
            r = (m.get("role") or "user").lower()
            if r not in ("user", "assistant"):
                continue
            out.append({"role": r, "content": (m.get("content") or "")[:MAX_MESSAGE_CHARS]})

    out.append({"role": "user", "content": interpolate(user_message or "", ctx)[:MAX_MESSAGE_CHARS]})
    return out


__all__ = [
    "interpolate", "build_context",
    "get_conversation", "append_messages", "clear_conversation", "pop_last_assistant",
    "call_openai_chat", "compose_messages",
    "MAX_HISTORY_TURNS", "MAX_MESSAGE_CHARS", "DEFAULT_MODEL",
]
