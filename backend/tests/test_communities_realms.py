"""Backend regression for Phase-1 Realms+Groups+Community Chats (iteration 24).

Covers all checkpoints in the review request:
- realms list + detail
- chat list + message send/list
- join idempotency
- members projection
- admin rename (and 403 / 400 cases)
- create realm
- regression endpoints
- WebSocket /api/ws/community-chat/{chat_id}
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import pytest
import requests
import websockets
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

FOUNDER = {"email": "stealth", "password": "Password1$"}
USER = {"email": "tfone", "password": "pass1234"}


# --------------- shared fixtures ---------------
def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        pytest.skip(f"Login failed {email}: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def founder_token():
    return _login(**FOUNDER)


@pytest.fixture(scope="module")
def user_token():
    return _login(**USER)


def _auth_client(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


# --------------- realm listing / detail ---------------
def test_list_realms_returns_8_seeded():
    r = requests.get(f"{BASE_URL}/api/communities/realms")
    assert r.status_code == 200, r.text
    realms = r.json()["realms"]
    ids = {x["id"] for x in realms}
    expected = {"dj", "gaming", "crypto", "festival", "sports", "tech", "fashion", "creators"}
    assert expected.issubset(ids), f"Missing seeded realms: {expected - ids}"


def test_get_realm_dj_public_with_counts():
    r = requests.get(f"{BASE_URL}/api/communities/realms/dj")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == "dj"
    assert "online_count" in body
    assert "member_count" in body
    assert isinstance(body["online_count"], int)
    assert isinstance(body["member_count"], int)


def test_get_realm_404_for_unknown():
    r = requests.get(f"{BASE_URL}/api/communities/realms/zzz-nope")
    assert r.status_code == 404


# --------------- chat listing ---------------
def test_list_chats_for_dj_has_main_general_chat(founder_token):
    r = _auth_client(founder_token).get(f"{BASE_URL}/api/communities/realm/dj/chats")
    assert r.status_code == 200, r.text
    chats = r.json()["chats"]
    main = [c for c in chats if c.get("is_main")]
    assert len(main) >= 1
    assert main[0]["title"] == "General Chat"
    assert "id" in main[0]


# --------------- join idempotency ---------------
def test_user_join_dj_idempotent(user_token):
    c = _auth_client(user_token)
    r1 = c.post(f"{BASE_URL}/api/communities/realm/dj/join", json={})
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1["ok"] is True
    assert body1.get("joined") is True or body1.get("already_member") is True
    r2 = c.post(f"{BASE_URL}/api/communities/realm/dj/join", json={})
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["ok"] is True
    assert body2.get("already_member") is True


# --------------- members projection ---------------
def test_list_members_dj_projection(user_token):
    c = _auth_client(user_token)
    # Ensure tfone is joined
    c.post(f"{BASE_URL}/api/communities/realm/dj/join", json={})
    r = c.get(f"{BASE_URL}/api/communities/realm/dj/members")
    assert r.status_code == 200, r.text
    members = r.json()["members"]
    assert len(members) >= 1
    expected_keys = {"user_id", "username", "display_name", "avatar_url",
                     "presence_choice", "is_online", "role", "joined_at", "favorite"}
    sample = members[0]
    missing = expected_keys - set(sample.keys())
    assert not missing, f"missing keys in member card: {missing}"


# --------------- messages send + list ---------------
def _get_dj_main_chat_id(token):
    r = _auth_client(token).get(f"{BASE_URL}/api/communities/realm/dj/chats")
    assert r.status_code == 200
    main = [c for c in r.json()["chats"] if c.get("is_main")]
    return main[0]["id"]


def test_send_and_list_messages_dj(user_token):
    c = _auth_client(user_token)
    chat_id = _get_dj_main_chat_id(user_token)
    body_text = "hi-from-tfone-test"
    r = c.post(f"{BASE_URL}/api/community-chats/{chat_id}/messages", json={"body": body_text})
    assert r.status_code == 200, r.text
    msg = r.json()
    assert msg["body"] == body_text
    assert msg["chat_id"] == chat_id
    assert msg["username"] == "tfone"
    assert "id" in msg and "created_at" in msg

    r2 = c.get(f"{BASE_URL}/api/community-chats/{chat_id}/messages")
    assert r2.status_code == 200
    msgs = r2.json()["messages"]
    bodies = [m["body"] for m in msgs]
    assert body_text in bodies
    # ascending created_at order
    times = [m["created_at"] for m in msgs]
    assert times == sorted(times), "messages must be ascending by created_at"


# --------------- admin rename ---------------
def test_admin_rename_chat_as_founder_then_403_as_user(founder_token, user_token):
    chat_id = _get_dj_main_chat_id(founder_token)
    fc = _auth_client(founder_token)
    new_title = "DJ Lounge"
    r = fc.patch(f"{BASE_URL}/api/communities/realm/dj/chats/{chat_id}", json={"title": new_title})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == new_title

    # restore + verify 403 for non-admin
    uc = _auth_client(user_token)
    r2 = uc.patch(f"{BASE_URL}/api/communities/realm/dj/chats/{chat_id}", json={"title": "BadAdmin"})
    assert r2.status_code == 403, r2.text

    # restore to General Chat to keep idempotency
    fc.patch(f"{BASE_URL}/api/communities/realm/dj/chats/{chat_id}", json={"title": "General Chat"})


def test_admin_rename_validation_empty_and_too_long(founder_token):
    chat_id = _get_dj_main_chat_id(founder_token)
    fc = _auth_client(founder_token)
    r1 = fc.patch(f"{BASE_URL}/api/communities/realm/dj/chats/{chat_id}", json={"title": ""})
    assert r1.status_code == 400, f"empty title should 400, got {r1.status_code} {r1.text}"
    long_title = "x" * 51
    r2 = fc.patch(f"{BASE_URL}/api/communities/realm/dj/chats/{chat_id}", json={"title": long_title})
    # 50 char Field max — Pydantic returns 422; longer than 50 should be rejected
    assert r2.status_code in (400, 422), f"long title should 400/422, got {r2.status_code}"


# --------------- create realm ---------------
def test_create_realm_with_owner_and_main_chat(user_token):
    c = _auth_client(user_token)
    payload = {"name": "TEST_Realm_iter24"}
    r = c.post(f"{BASE_URL}/api/communities/realms", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == payload["name"]
    assert body["owner_id"], "owner_id should be set"
    assert "_main_chat_id" in body
    main_chat_id = body["_main_chat_id"]
    rid = body["id"]

    # verify the chat shows up under chats list
    r2 = c.get(f"{BASE_URL}/api/communities/realm/{rid}/chats")
    assert r2.status_code == 200
    chats = r2.json()["chats"]
    assert any(ch["id"] == main_chat_id and ch.get("is_main") for ch in chats)


# --------------- regression endpoints ---------------
def test_regression_founder_endpoints(founder_token):
    c = _auth_client(founder_token)
    for path in [
        "/api/admin/realm-pulse/overview",
        "/api/hashtags/interest-cards",
        "/api/admin/storage/status",
        "/api/admin/moderation/copyright/queue",
    ]:
        r = c.get(f"{BASE_URL}{path}")
        assert r.status_code == 200, f"{path} returned {r.status_code}: {r.text[:200]}"


# --------------- WebSocket tests ---------------
@pytest.mark.asyncio
async def test_ws_no_token_closes_4401():
    chat_id = _get_dj_main_chat_id(_login(**FOUNDER))
    url = f"{WS_URL}/api/ws/community-chat/{chat_id}"
    try:
        async with websockets.connect(url) as ws:
            # Should be closed by server
            try:
                await asyncio.wait_for(ws.recv(), timeout=3.0)
            except websockets.ConnectionClosed as e:
                assert e.code == 4401, f"expected 4401 got {e.code}"
                return
            except asyncio.TimeoutError:
                pytest.fail("WS did not close on missing token within 3s")
    except websockets.exceptions.InvalidStatusCode as e:
        # some proxies translate close to handshake reject; accept that too
        assert e.status_code in (401, 403, 404), f"unexpected status {e.status_code}"
    except websockets.ConnectionClosed as e:
        assert e.code == 4401


@pytest.mark.asyncio
async def test_ws_invalid_chat_id_closes_4404():
    token = _login(**FOUNDER)
    url = f"{WS_URL}/api/ws/community-chat/zzz-no-such-chat?token={token}"
    try:
        async with websockets.connect(url) as ws:
            try:
                await asyncio.wait_for(ws.recv(), timeout=3.0)
            except websockets.ConnectionClosed as e:
                assert e.code == 4404, f"expected 4404 got {e.code}"
                return
            except asyncio.TimeoutError:
                pytest.fail("WS did not close on invalid chat within 3s")
    except websockets.ConnectionClosed as e:
        assert e.code == 4404


@pytest.mark.asyncio
async def test_ws_message_broadcast_between_two_clients():
    founder_t = _login(**FOUNDER)
    user_t = _login(**USER)
    chat_id = _get_dj_main_chat_id(founder_t)
    url_f = f"{WS_URL}/api/ws/community-chat/{chat_id}?token={founder_t}"
    url_u = f"{WS_URL}/api/ws/community-chat/{chat_id}?token={user_t}"

    async with websockets.connect(url_f) as ws_f, websockets.connect(url_u) as ws_u:
        # hello on connect
        hello_f = json.loads(await asyncio.wait_for(ws_f.recv(), timeout=5))
        hello_u = json.loads(await asyncio.wait_for(ws_u.recv(), timeout=5))
        assert hello_f["type"] == "chat:hello"
        assert hello_u["type"] == "chat:hello"

        # user posts a message via REST; founder should see it via WS
        body_text = "ws-broadcast-test-iter24"
        r = _auth_client(user_t).post(
            f"{BASE_URL}/api/community-chats/{chat_id}/messages", json={"body": body_text}
        )
        assert r.status_code == 200, r.text

        # Founder should receive message:new
        received = None
        for _ in range(5):
            data = json.loads(await asyncio.wait_for(ws_f.recv(), timeout=5))
            if data.get("type") == "message:new" and data.get("message", {}).get("body") == body_text:
                received = data
                break
        assert received is not None, "founder did not receive broadcasted message"
        assert received["message"]["username"] == "tfone"
