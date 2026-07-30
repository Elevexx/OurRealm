"""Phase 3.5 — supplementary tests requested in iter53 review.

Covers:
  • Schema exposes 'chat' layout + chat_input + ai_response field types.
  • Templates list exposes 'stealth_ai' and 'realm_assistant'.
  • Stealth-AI template has founder_only=true + enable_streaming=true.
  • Cloning stealth_ai produces a draft with chat config + memory='persistent'.
  • Rate limit: 31st chat call in a minute returns 429 with Retry-After.
  • Disabling openai provider returns 403 'disabled by admin' on chat/message.
  • POST /api/widgets/chat/stream on a widget with enable_streaming=false returns 400.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break


def _login(u, p):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": u, "password": p}, timeout=15)
    assert r.status_code == 200, f"login {u} failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def stealth_token():
    return _login("stealth", "Password1$")


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------------------- SCHEMA ----------------------------
def test_schema_lists_chat_layout_and_field_types(stealth_token):
    r = requests.get(f"{BASE_URL}/api/admin/widgets/schema",
                     headers=_hdr(stealth_token), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    # layouts may be list of strings or list of dicts
    layouts = data.get("layouts") or data.get("LAYOUTS") or []
    layout_names = [l if isinstance(l, str) else (l.get("key") or l.get("id") or l.get("name")) for l in layouts]
    assert "chat" in layout_names, f"layouts={layout_names}"

    field_types = data.get("field_types") or data.get("fields") or []
    ft_names = [f if isinstance(f, str) else (f.get("type") or f.get("key") or f.get("name")) for f in field_types]
    assert "chat_input" in ft_names, f"field_types={ft_names}"
    assert "ai_response" in ft_names, f"field_types={ft_names}"


# ---------------------------- TEMPLATES ----------------------------
def test_templates_expose_stealth_ai_and_realm_assistant(stealth_token):
    r = requests.get(f"{BASE_URL}/api/admin/widgets/templates",
                     headers=_hdr(stealth_token), timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    if isinstance(items, dict) and "templates" in items:
        items = items["templates"]
    by_key = {}
    for t in items:
        k = t.get("key") or t.get("id") or t.get("slug")
        if k:
            by_key[k] = t
    assert "stealth_ai" in by_key, f"keys={list(by_key)}"
    assert "realm_assistant" in by_key, f"keys={list(by_key)}"

    sai = by_key["stealth_ai"]
    assert sai.get("layout") == "chat", f"stealth_ai layout={sai.get('layout')}"
    # NOTE: list endpoint deliberately returns summary cards only (key/name/icon/desc/layout).
    # Full chat config (founder_only / enable_streaming) is asserted via the clone test
    # which round-trips through GET /api/admin/widgets and inspects editor_config.chat.


# ---------------------------- CLONE TEMPLATE ----------------------------
def _try_clone(token, key):
    """POST /api/admin/widgets/from-template/{template_key} with required 'key' body."""
    body = {"key": f"pytest_{uuid.uuid4().hex[:8]}"}
    url = f"{BASE_URL}/api/admin/widgets/from-template/{key}"
    r = requests.post(url, headers=_hdr(token), json=body, timeout=15)
    return r, url


def test_clone_stealth_ai_template_produces_chat_widget(stealth_token):
    r, url = _try_clone(stealth_token, "stealth_ai")
    assert r.status_code in (200, 201), f"clone via {url} -> {r.status_code} {r.text[:300]}"
    body = r.json()
    widget = body.get("widget") or body
    wid = widget.get("id") or widget.get("widget_id")
    assert wid, f"no widget id in {body}"

    # Verify chat cfg from the create response itself (more reliable than re-listing)
    cfg = (widget.get("editor_config") or {}).get("chat") or {}
    assert cfg.get("system_prompt"), f"no system_prompt in chat cfg: {cfg}"
    assert cfg.get("founder_only") is True, f"founder_only={cfg.get('founder_only')}"
    assert cfg.get("enable_streaming") is True, f"enable_streaming={cfg.get('enable_streaming')}"
    assert cfg.get("memory_mode") == "persistent", f"memory_mode={cfg.get('memory_mode')}"

    # Cross-check via admin/widgets list (the cloned widget is a draft)
    g = requests.get(f"{BASE_URL}/api/admin/widgets",
                     headers=_hdr(stealth_token), timeout=15)
    assert g.status_code == 200, g.text
    listed = g.json()
    items = listed.get("widgets") if isinstance(listed, dict) else listed
    match = next((w for w in items if w.get("id") == wid), None)
    assert match is not None, f"cloned widget {wid} not found in list"
    cfg2 = (match.get("editor_config") or {}).get("chat") or {}
    assert cfg2.get("founder_only") is True
    assert cfg2.get("memory_mode") == "persistent"

    # Cleanup
    requests.delete(f"{BASE_URL}/api/admin/widgets/{wid}",
                    headers=_hdr(stealth_token), timeout=10)


# ---------------------------- RATE LIMIT ----------------------------
def _seed_widget(widget_id, *, founder_only=False, streaming=False):
    import subprocess
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
        {{"id": {widget_id!r}}},
        {{"$set": {{
            "id": {widget_id!r}, "key": {widget_id!r}, "name": "RateLimit Test",
            "type": "chat", "category": "ai", "status": "live",
            "access_groups": ["all"], "placements": ["profile"],
            "default_size": {{"w":2,"h":3}}, "allowed_sizes": [{{"w":2,"h":3}}],
            "editor_config": {{"layout":"chat","chat": {{
                "system_prompt": "Reply with exactly 'k' (lowercase).",
                "model": "gpt-5.4-mini", "temperature": 0.0,
                "max_tokens": 4, "memory_mode": "off",
                "founder_only": {founder_only}, "enable_streaming": {streaming},
                "quick_actions": []
            }}}}
        }}}}, upsert=True)
asyncio.run(main())
"""
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def _delete_widget(widget_id):
    import subprocess
    subprocess.run(["python3", "-c", f"""
import asyncio, sys
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from core.db import db
async def main():
    await db.widget_registry.delete_one({{"id": {widget_id!r}}})
    await db.widget_conversations.delete_many({{"widget_id": {widget_id!r}}})
asyncio.run(main())
"""], capture_output=True)


def test_rate_limit_returns_429_after_30(stealth_token):
    """31st call in <60s must return 429 with Retry-After."""
    wid = f"pytest-rl-{uuid.uuid4().hex[:6]}"
    _seed_widget(wid)
    try:
        last = None
        for i in range(31):
            last = requests.post(
                f"{BASE_URL}/api/widgets/chat/message",
                headers=_hdr(stealth_token),
                json={"widget_id": wid, "message": f"hi {i}"},
                timeout=20,
            )
            if last.status_code == 429:
                break
        assert last.status_code == 429, f"expected 429, got {last.status_code} (call #{i+1}): {last.text[:200]}"
        # Retry-After is recommended; tolerate absence but log
        ra = last.headers.get("Retry-After")
        assert ra is not None, "429 returned but Retry-After header missing"
    finally:
        _delete_widget(wid)


# ---------------------------- PROVIDER DISABLE ----------------------------
def _toggle_openai(stealth_token, enabled: bool):
    r = requests.post(
        f"{BASE_URL}/api/admin/providers/toggle",
        headers=_hdr(stealth_token),
        json={"id": "openai", "enabled": enabled},
        timeout=15,
    )
    return r


def test_disabled_openai_blocks_chat(stealth_token):
    wid = f"pytest-disabled-{uuid.uuid4().hex[:6]}"
    _seed_widget(wid)
    try:
        toggle_r = _toggle_openai(stealth_token, False)
        assert toggle_r.status_code in (200, 204), f"toggle off failed: {toggle_r.status_code} {toggle_r.text[:200]}"
        r = requests.post(
            f"{BASE_URL}/api/widgets/chat/message",
            headers=_hdr(stealth_token),
            json={"widget_id": wid, "message": "hi"},
            timeout=20,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:300]}"
        body_text = r.text.lower()
        assert "disabled" in body_text, f"expected 'disabled' in body, got: {r.text[:200]}"
    finally:
        _toggle_openai(stealth_token, True)
        _delete_widget(wid)


# ---------------------------- STREAMING DISABLED ----------------------------
def test_stream_endpoint_400_when_streaming_off(stealth_token):
    wid = f"pytest-nostream-{uuid.uuid4().hex[:6]}"
    _seed_widget(wid, streaming=False)
    try:
        r = requests.post(
            f"{BASE_URL}/api/widgets/chat/stream",
            headers=_hdr(stealth_token),
            json={"widget_id": wid, "message": "hi"},
            timeout=15,
            stream=True,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:300]}"
    finally:
        _delete_widget(wid)
