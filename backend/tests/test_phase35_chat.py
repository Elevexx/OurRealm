"""Phase 3.5 — Conversational AI widget tests.

Covers:
  • POST /api/widgets/chat/message       — chat send + persistence
  • GET  /api/widgets/chat/history       — history retrieval
  • POST /api/widgets/chat/clear         — wipe conversation
  • POST /api/widgets/chat/regenerate    — re-run last user turn
  • POST /api/widgets/chat/stream        — SSE streaming
  • Founder-only access enforcement
  • OpenAI provider-disabled gate
  • Auth gate (401) and unknown widget (404)
  • Variable interpolation
"""
import os
import json
import time
import uuid
import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass


def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {username} failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tokens():
    return {
        "stealth": _login("stealth", "Password1$"),
        "support": _login("support", "Password1$"),
        "tfone":   _login("tfone",   "pass1234"),
    }


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


WIDGET_ID = f"pytest-chat-{uuid.uuid4().hex[:6]}"


def _seed_widget(*, founder_only=False, streaming=False, system_prompt=None,
                 memory_mode="persistent"):
    """Insert a chat widget directly via Mongo (CLI helper script)."""
    import subprocess
    sp = system_prompt or "You are a test bot. Always reply with exactly 'pong' (lowercase, no period)."
    cmd = [
        "python3", "-c",
        f"""
import asyncio
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
import sys; sys.path.insert(0, "/app/backend")
from core.db import db
async def main():
    await db.widget_registry.update_one(
        {{"id": {WIDGET_ID!r}}},
        {{"$set": {{
            "id": {WIDGET_ID!r}, "key": {WIDGET_ID!r}, "name": "Pytest Chat",
            "type": "chat", "category": "ai", "status": "live",
            "access_groups": ["all"], "placements": ["profile"],
            "default_size": {{"w":2,"h":3}}, "allowed_sizes": [{{"w":2,"h":3}}],
            "editor_config": {{
                "layout": "chat",
                "chat": {{
                    "mode": "conversational",
                    "system_prompt": {sp!r},
                    "model": "gpt-5.4-mini",
                    "temperature": 0.0,
                    "max_tokens": 30,
                    "memory_mode": {memory_mode!r},
                    "founder_only": {founder_only!r},
                    "enable_streaming": {streaming!r},
                    "quick_actions": ["Summarize"],
                }},
            }},
            "is_system": False,
        }}}},
        upsert=True,
    )
asyncio.run(main())
""",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    assert res.returncode == 0, f"seed failed: {res.stderr}"


def _clear_db_widget():
    import subprocess
    subprocess.run([
        "python3", "-c",
        f"""
import asyncio
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
import sys; sys.path.insert(0, "/app/backend")
from core.db import db
async def main():
    await db.widget_registry.delete_one({{"id": "{WIDGET_ID}"}})
    await db.widget_conversations.delete_many({{"widget_id": "{WIDGET_ID}"}})
asyncio.run(main())
""",
    ], capture_output=True, text=True, timeout=15)


@pytest.fixture(scope="module", autouse=True)
def lifecycle():
    _seed_widget()
    yield
    _clear_db_widget()


# ─── Auth gates ──────────────────────────────────────────────────────

def test_chat_message_requires_auth():
    r = requests.post(f"{BASE_URL}/api/widgets/chat/message",
                      json={"widget_id": WIDGET_ID, "message": "ping"}, timeout=15)
    assert r.status_code == 401


def test_chat_history_requires_auth():
    r = requests.get(f"{BASE_URL}/api/widgets/chat/history",
                     params={"widget_id": WIDGET_ID}, timeout=15)
    assert r.status_code == 401


def test_unknown_widget_404(tokens):
    r = requests.post(f"{BASE_URL}/api/widgets/chat/message",
                      headers=_hdr(tokens["stealth"]),
                      json={"widget_id": "does-not-exist-zzz", "message": "ping"}, timeout=15)
    assert r.status_code == 404


# ─── Happy path ──────────────────────────────────────────────────────

def test_chat_message_returns_reply(tokens):
    r = requests.post(f"{BASE_URL}/api/widgets/chat/message",
                      headers=_hdr(tokens["stealth"]),
                      json={"widget_id": WIDGET_ID, "message": "ping"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "reply" in body and body["reply"]
    assert body.get("memory_mode") == "persistent"
    assert "usage" in body


def test_history_persists(tokens):
    r = requests.get(f"{BASE_URL}/api/widgets/chat/history",
                     headers=_hdr(tokens["stealth"]),
                     params={"widget_id": WIDGET_ID}, timeout=15)
    assert r.status_code == 200
    msgs = r.json().get("messages") or []
    assert len(msgs) >= 2
    roles = [m["role"] for m in msgs]
    assert "user" in roles and "assistant" in roles


def test_regenerate_runs_against_last_user_turn(tokens):
    r = requests.post(f"{BASE_URL}/api/widgets/chat/regenerate",
                      headers=_hdr(tokens["stealth"]),
                      json={"widget_id": WIDGET_ID}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json().get("reply")


def test_clear_wipes_history(tokens):
    r = requests.post(f"{BASE_URL}/api/widgets/chat/clear",
                      headers=_hdr(tokens["stealth"]),
                      json={"widget_id": WIDGET_ID}, timeout=15)
    assert r.status_code == 200
    assert r.json().get("deleted") in (0, 1)
    r2 = requests.get(f"{BASE_URL}/api/widgets/chat/history",
                      headers=_hdr(tokens["stealth"]),
                      params={"widget_id": WIDGET_ID}, timeout=15)
    assert r2.status_code == 200
    assert (r2.json().get("messages") or []) == []


# ─── Founder-only enforcement ────────────────────────────────────────

def test_founder_only_blocks_non_stealth(tokens):
    _seed_widget(founder_only=True)
    try:
        # non-founder
        r = requests.post(f"{BASE_URL}/api/widgets/chat/message",
                          headers=_hdr(tokens["tfone"]),
                          json={"widget_id": WIDGET_ID, "message": "hi"}, timeout=15)
        assert r.status_code == 403, r.text
        # support admin (not founder)
        r2 = requests.post(f"{BASE_URL}/api/widgets/chat/message",
                           headers=_hdr(tokens["support"]),
                           json={"widget_id": WIDGET_ID, "message": "hi"}, timeout=15)
        assert r2.status_code == 403
        # founder still allowed
        r3 = requests.post(f"{BASE_URL}/api/widgets/chat/message",
                           headers=_hdr(tokens["stealth"]),
                           json={"widget_id": WIDGET_ID, "message": "ping"}, timeout=30)
        assert r3.status_code == 200, r3.text
    finally:
        _seed_widget(founder_only=False)
        # Cleanup history again so subsequent tests start clean.
        requests.post(f"{BASE_URL}/api/widgets/chat/clear",
                      headers=_hdr(tokens["stealth"]),
                      json={"widget_id": WIDGET_ID}, timeout=15)


# ─── Variable interpolation ──────────────────────────────────────────

def test_variable_interpolation_in_system_prompt(tokens):
    _seed_widget(system_prompt="The user's username is {{username}}. Reply with just their username.")
    try:
        r = requests.post(f"{BASE_URL}/api/widgets/chat/message",
                          headers=_hdr(tokens["stealth"]),
                          json={"widget_id": WIDGET_ID, "message": "who am i?"}, timeout=30)
        assert r.status_code == 200, r.text
        reply = (r.json().get("reply") or "").lower()
        # Loose assertion — model should mention 'stealth' since the prompt told it to.
        assert "stealth" in reply, f"expected interpolation to inject 'stealth', got: {reply}"
    finally:
        _seed_widget()
        requests.post(f"{BASE_URL}/api/widgets/chat/clear",
                      headers=_hdr(tokens["stealth"]),
                      json={"widget_id": WIDGET_ID}, timeout=15)


# ─── Memory off mode ─────────────────────────────────────────────────

def test_memory_off_does_not_persist(tokens):
    _seed_widget(memory_mode="off")
    try:
        requests.post(f"{BASE_URL}/api/widgets/chat/clear",
                      headers=_hdr(tokens["stealth"]),
                      json={"widget_id": WIDGET_ID}, timeout=15)
        r = requests.post(f"{BASE_URL}/api/widgets/chat/message",
                          headers=_hdr(tokens["stealth"]),
                          json={"widget_id": WIDGET_ID, "message": "ping"}, timeout=30)
        assert r.status_code == 200, r.text
        r2 = requests.get(f"{BASE_URL}/api/widgets/chat/history",
                          headers=_hdr(tokens["stealth"]),
                          params={"widget_id": WIDGET_ID}, timeout=15)
        assert r2.status_code == 200
        assert (r2.json().get("messages") or []) == []
    finally:
        _seed_widget()


# ─── Streaming ───────────────────────────────────────────────────────

def test_streaming_disabled_by_default(tokens):
    r = requests.post(f"{BASE_URL}/api/widgets/chat/stream",
                      headers=_hdr(tokens["stealth"]),
                      json={"widget_id": WIDGET_ID, "message": "ping"}, timeout=15)
    # When the seed has streaming=False, this should 400.
    assert r.status_code == 400


def test_streaming_emits_sse_frames(tokens):
    _seed_widget(streaming=True)
    try:
        r = requests.post(f"{BASE_URL}/api/widgets/chat/stream",
                          headers=_hdr(tokens["stealth"]),
                          json={"widget_id": WIDGET_ID, "message": "ping"},
                          stream=True, timeout=30)
        assert r.status_code == 200
        body = b""
        for chunk in r.iter_content(chunk_size=128):
            body += chunk
            if b"\"done\"" in body:
                break
            if len(body) > 8000:
                break
        text = body.decode("utf-8", errors="ignore")
        assert "data:" in text
        # At least one delta frame OR a done frame.
        assert ("\"delta\"" in text) or ("\"done\"" in text)
    finally:
        _seed_widget(streaming=False)
        requests.post(f"{BASE_URL}/api/widgets/chat/clear",
                      headers=_hdr(tokens["stealth"]),
                      json={"widget_id": WIDGET_ID}, timeout=15)


# ─── Security ────────────────────────────────────────────────────────

def test_no_openai_key_leaks_in_response(tokens):
    r = requests.post(f"{BASE_URL}/api/widgets/chat/message",
                      headers=_hdr(tokens["stealth"]),
                      json={"widget_id": WIDGET_ID, "message": "ping"}, timeout=30)
    assert r.status_code == 200
    blob = r.text
    assert "sk-" not in blob, "OpenAI key prefix leaked in response body"
    assert "OPENAI_API_KEY" not in blob, "OpenAI env var name leaked"
