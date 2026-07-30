"""Phase 3.5 — E2E backend retest via the public REACT_APP_BACKEND_URL.

Re-verifies the critical bug fixed in iter53:
  * /api/admin/widgets/from-template/stealth_ai → editor_config.chat is preserved
  * /api/admin/widgets/from-template/realm_assistant → editor_config.chat is preserved
  * POST /api/admin/widgets validates chat sub-fields (memory_mode/temp/max_tokens)
  * Forbidden access for non-founder on a founder_only chat widget
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback - load from frontend/.env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

STEALTH = {"email": "stealth", "password": "Password1$"}
TFONE = {"email": "tfone", "password": "pass1234"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def stealth_session():
    return _login(STEALTH)


@pytest.fixture(scope="module")
def tfone_session():
    return _login(TFONE)


_created = []


def _delete(session, wid):
    try:
        session.delete(f"{BASE_URL}/api/admin/widgets/{wid}", timeout=10)
    except Exception:
        pass


def teardown_module(_mod):
    s = _login(STEALTH)
    for wid in _created:
        _delete(s, wid)


# ── Template clone preserves chat config ────────────────────────────
def test_clone_stealth_ai_preserves_chat(stealth_session):
    key = f"qa_stealth_{uuid.uuid4().hex[:8]}"
    r = stealth_session.post(
        f"{BASE_URL}/api/admin/widgets/from-template/stealth_ai",
        json={"key": key},
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    w = r.json().get("widget") or r.json()
    _created.append(w["id"])
    chat = w["editor_config"].get("chat")
    assert chat is not None, "editor_config.chat must be preserved"
    assert chat["system_prompt"] and len(chat["system_prompt"]) > 0
    assert chat["model"] == "gpt-5.4-mini"
    assert chat["memory_mode"] == "persistent"
    assert chat["founder_only"] is True
    assert chat["enable_streaming"] is True
    assert isinstance(chat["quick_actions"], list) and len(chat["quick_actions"]) == 3


def test_clone_realm_assistant_preserves_chat(stealth_session):
    key = f"qa_realm_{uuid.uuid4().hex[:8]}"
    r = stealth_session.post(
        f"{BASE_URL}/api/admin/widgets/from-template/realm_assistant",
        json={"key": key},
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    w = r.json().get("widget") or r.json()
    _created.append(w["id"])
    chat = w["editor_config"].get("chat")
    assert chat is not None
    assert chat["founder_only"] is False
    assert chat["enable_streaming"] is False
    assert chat["memory_mode"] == "persistent"


# ── Custom create with chat: validation ─────────────────────────────
def _base_custom_payload(chat_overrides=None):
    chat = {
        "mode": "conversational",
        "system_prompt": "You are a test bot.",
        "model": "gpt-5.4-mini",
        "temperature": 0.5,
        "max_tokens": 30,
        "memory_mode": "session",
        "founder_only": False,
        "enable_streaming": False,
        "quick_actions": ["Hi", "Help"],
    }
    if chat_overrides:
        chat.update(chat_overrides)
    return {
        "key": f"qa_custom_{uuid.uuid4().hex[:8]}",
        "name": "QA Chat Widget",
        "category_group": "utility",
        "icon": "MessageSquare",
        "default_size": "md",
        "editor_config": {
            "schema_version": 1,
            "layout": "chat",
            "fields": [],
            "data": {},
            "chat": chat,
        },
    }


def test_create_custom_chat_preserved(stealth_session):
    payload = _base_custom_payload()
    r = stealth_session.post(f"{BASE_URL}/api/admin/widgets", json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    w = r.json().get("widget") or r.json()
    _created.append(w["id"])
    chat = w["editor_config"].get("chat")
    assert chat is not None
    assert chat["memory_mode"] == "session"
    assert chat["max_tokens"] == 30


def test_invalid_memory_mode(stealth_session):
    p = _base_custom_payload({"memory_mode": "bad"})
    r = stealth_session.post(f"{BASE_URL}/api/admin/widgets", json=p, timeout=15)
    assert r.status_code == 400
    assert "memory_mode" in r.text.lower()


def test_invalid_temperature(stealth_session):
    p = _base_custom_payload({"temperature": 5})
    r = stealth_session.post(f"{BASE_URL}/api/admin/widgets", json=p, timeout=15)
    assert r.status_code == 400
    assert "temperature" in r.text.lower()


def test_invalid_max_tokens(stealth_session):
    p = _base_custom_payload({"max_tokens": 99999})
    r = stealth_session.post(f"{BASE_URL}/api/admin/widgets", json=p, timeout=15)
    assert r.status_code == 400
    assert "max_tokens" in r.text.lower()


# ── Founder-only enforcement at the chat runtime layer ──────────────
def test_founder_only_403_for_non_founder(stealth_session, tfone_session):
    # Create a stealth-only chat widget
    key = f"qa_stealth_fo_{uuid.uuid4().hex[:8]}"
    r = stealth_session.post(
        f"{BASE_URL}/api/admin/widgets/from-template/stealth_ai",
        json={"key": key},
        timeout=15,
    )
    assert r.status_code in (200, 201)
    w = r.json().get("widget") or r.json()
    _created.append(w["id"])
    wid = w["id"]
    # Launch (publish) the widget so it is live
    pub = stealth_session.post(
        f"{BASE_URL}/api/admin/widgets/{wid}/publish", timeout=15
    )
    # publish may be 200 or 404 if endpoint differs - tolerate
    # tfone tries to chat -> should be 403
    r2 = tfone_session.post(
        f"{BASE_URL}/api/widgets/chat/message",
        json={"widget_id": wid, "message": "hi"},
        timeout=20,
    )
    assert r2.status_code in (403, 401), f"expected 403, got {r2.status_code}: {r2.text}"
