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
DEFAULT_MODEL = "gpt-4o-mini"
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
    return {"role": role, "content": content, "created_at": ts}


# ─────────────────────────────────────────────────────────────────────
# OpenAI chat invocation
# ─────────────────────────────────────────────────────────────────────

async def call_openai_chat(messages: List[Dict[str, str]], *,
                           model: Optional[str] = None,
                           temperature: Optional[float] = None,
                           max_tokens: Optional[int] = None) -> Dict[str, Any]:
    """Call OpenAI Chat Completions with the full messages array.
    Returns {content, model, usage, finish_reason}. Raises HTTPException
    on upstream errors with sanitized detail."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="OpenAI is not configured on the server.")
    if not messages:
        raise HTTPException(status_code=400, detail="No messages to send.")

    body: Dict[str, Any] = {
        "model": model or DEFAULT_MODEL,
        "messages": messages,
        "temperature": float(temperature) if temperature is not None else DEFAULT_TEMPERATURE,
        "max_tokens": int(max_tokens) if max_tokens is not None else DEFAULT_MAX_TOKENS,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    url = "https://api.openai.com/v1/chat/completions"

    try:
        async with httpx.AsyncClient(timeout=OPENAI_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, headers=headers, json=body)
    except httpx.HTTPError as e:
        logger.exception("OpenAI HTTP transport error")
        raise HTTPException(status_code=502, detail=f"OpenAI transport error: {e!s}")

    if resp.status_code >= 400:
        snippet = resp.text[:400]
        # Forward 429 verbatim so client can back off; collapse other
        # 4xx/5xx to 502 to avoid leaking provider error shapes.
        code = resp.status_code if resp.status_code in (429, 503, 504) else 502
        raise HTTPException(status_code=code, detail=f"OpenAI {resp.status_code}: {snippet}")

    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="OpenAI returned non-JSON response.")

    choice = (data.get("choices") or [{}])[0]
    msg = (choice.get("message") or {}).get("content") or ""
    return {
        "content": msg,
        "model": data.get("model"),
        "usage": data.get("usage") or {},
        "finish_reason": choice.get("finish_reason"),
    }


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
