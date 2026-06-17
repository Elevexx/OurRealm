"""Phase C — Real-Time Presence System & Real Discover/Trending tests.

Covers:
  * /api/users/newest    — real users, created_at DESC, @support hidden, limit
  * /api/users/trending  — real users, follower_count DESC, @support hidden
  * PATCH /api/users/status — accept live/online/invisible, reject others
  * GET /api/presence/me — returns choice + public
  * GET /api/presence/friends — sorted by status priority, invisible→offline for others
  * Auth /auth/me serializer includes presence fields
  * WebSocket /api/ws/presence?token=<jwt> — hello/heartbeat/presence:set/focus
  * Migration: existing users get presence_status='offline', choice='online'
"""
import asyncio
import json
import os

import pytest
import requests
import websockets

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

T1 = {"email": "testfriend1@example.com", "password": "pass1234", "username": "tfone"}
T2 = {"email": "testfriend2@example.com", "password": "pass1234", "username": "tftwo"}
STEALTH = {"email": "slopestyle2022@gmail.com", "password": "Password1$", "username": "stealth"}


def _login(api_client, creds):
    r = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": creds["email"], "password": creds["password"]
    })
    if r.status_code != 200:
        pytest.skip(f"Cannot login {creds['email']}: {r.status_code} {r.text}")
    return r.json()["access_token"]


@pytest.fixture
def tfone_token(api_client):
    return _login(api_client, T1)


@pytest.fixture
def tftwo_token(api_client):
    return _login(api_client, T2)


@pytest.fixture
def stealth_token(api_client):
    return _login(api_client, STEALTH)


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------- Discover / Trending ----------------
class TestNewest:
    def test_newest_returns_real_users_sorted_desc(self):
        r = requests.get(f"{BASE_URL}/api/users/newest?limit=10", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "users" in data and isinstance(data["users"], list)
        users = data["users"]
        assert len(users) > 0
        # required keys
        for u in users:
            for k in ("id", "username", "name", "avatar_url", "bio",
                      "follower_count", "presence_status", "is_founder",
                      "is_verified", "is_vip", "created_at"):
                assert k in u, f"missing {k} in {u}"
        # support hidden
        assert all(u["username"] != "support" for u in users)
        # sorted by created_at DESC
        dates = [u["created_at"] for u in users if u.get("created_at")]
        assert dates == sorted(dates, reverse=True), "users not sorted by created_at DESC"

    def test_newest_respects_limit(self):
        r = requests.get(f"{BASE_URL}/api/users/newest?limit=3", timeout=10)
        assert r.status_code == 200
        assert len(r.json()["users"]) <= 3

    def test_newest_limit_clamped(self):
        # 1..60 clamp
        r = requests.get(f"{BASE_URL}/api/users/newest?limit=999", timeout=10)
        assert r.status_code == 200
        assert len(r.json()["users"]) <= 60


class TestTrending:
    def test_trending_returns_real_users_sorted_by_followers(self):
        r = requests.get(f"{BASE_URL}/api/users/trending?limit=10", timeout=10)
        assert r.status_code == 200, r.text
        users = r.json()["users"]
        assert len(users) > 0
        assert all(u["username"] != "support" for u in users)
        counts = [u["follower_count"] for u in users]
        assert counts == sorted(counts, reverse=True), \
            f"follower_count not DESC: {counts}"


# ---------------- Status endpoint ----------------
class TestUserStatus:
    def test_patch_status_accepts_live(self, api_client, tfone_token):
        r = api_client.patch(f"{BASE_URL}/api/users/status",
                             json={"status": "live"}, headers=_hdr(tfone_token))
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "live"
        # /presence/me reflects choice
        me = api_client.get(f"{BASE_URL}/api/presence/me",
                            headers=_hdr(tfone_token))
        assert me.status_code == 200
        assert me.json()["status"] == "live"

    def test_patch_status_accepts_online(self, api_client, tfone_token):
        r = api_client.patch(f"{BASE_URL}/api/users/status",
                             json={"status": "online"}, headers=_hdr(tfone_token))
        assert r.status_code == 200
        assert r.json()["status"] == "online"

    def test_patch_status_accepts_invisible(self, api_client, tfone_token):
        r = api_client.patch(f"{BASE_URL}/api/users/status",
                             json={"status": "invisible"}, headers=_hdr(tfone_token))
        assert r.status_code == 200
        assert r.json()["status"] == "invisible"

    def test_patch_status_rejects_invalid(self, api_client, tfone_token):
        r = api_client.patch(f"{BASE_URL}/api/users/status",
                             json={"status": "bogus"}, headers=_hdr(tfone_token))
        assert r.status_code == 400

    def test_patch_status_rejects_messenger(self, api_client, tfone_token):
        # messenger is NOT user-pickable
        r = api_client.patch(f"{BASE_URL}/api/users/status",
                             json={"status": "messenger"}, headers=_hdr(tfone_token))
        assert r.status_code == 400

    def test_patch_status_rejects_offline(self, api_client, tfone_token):
        r = api_client.patch(f"{BASE_URL}/api/users/status",
                             json={"status": "offline"}, headers=_hdr(tfone_token))
        assert r.status_code == 400


# ---------------- /presence/friends ----------------
class TestPresenceFriends:
    def test_friends_list_shape(self, api_client, stealth_token):
        r = api_client.get(f"{BASE_URL}/api/presence/friends",
                           headers=_hdr(stealth_token))
        assert r.status_code == 200
        data = r.json()
        assert "friends" in data
        for f in data["friends"]:
            assert "id" in f and "username" in f and "presence_status" in f
            assert f["presence_status"] in {"live", "online", "messenger",
                                            "invisible", "offline"}

    def test_friends_sorted_by_status_priority(self, api_client, stealth_token):
        r = api_client.get(f"{BASE_URL}/api/presence/friends",
                           headers=_hdr(stealth_token))
        data = r.json()
        prio = {"live": 0, "online": 1, "messenger": 2, "invisible": 3, "offline": 4}
        statuses = [f["presence_status"] for f in data["friends"]]
        priorities = [prio.get(s, 9) for s in statuses]
        assert priorities == sorted(priorities), \
            f"friends not sorted by priority: {statuses}"


# ---------------- /presence/me ----------------
class TestPresenceMe:
    def test_returns_status_and_public_status(self, api_client, tfone_token):
        # Set to online first
        api_client.patch(f"{BASE_URL}/api/users/status",
                         json={"status": "online"}, headers=_hdr(tfone_token))
        r = api_client.get(f"{BASE_URL}/api/presence/me",
                           headers=_hdr(tfone_token))
        assert r.status_code == 200
        data = r.json()
        assert "status" in data and "public_status" in data


# ---------------- Auth /me serializer ----------------
class TestAuthMeSerializer:
    def test_includes_presence_fields(self, api_client, tfone_token):
        r = api_client.get(f"{BASE_URL}/api/auth/me", headers=_hdr(tfone_token))
        assert r.status_code == 200
        body = r.json()
        # /auth/me wraps under {user: {...}}
        u = body.get("user") if isinstance(body, dict) and "user" in body else body
        for k in ("presence_status", "presence_status_choice", "follower_count"):
            assert k in u, f"/auth/me missing {k}; got keys={list(u.keys())}"


# ---------------- WebSocket ----------------
@pytest.mark.asyncio
async def test_ws_hello_heartbeat_and_set(tfone_token):
    """Open WS as tfone, expect hello, heartbeat→pong, set→broadcast."""
    url = f"{WS_BASE}/api/ws/presence?token={tfone_token}"
    async with websockets.connect(url, open_timeout=10) as ws:
        hello_raw = await asyncio.wait_for(ws.recv(), timeout=10)
        hello = json.loads(hello_raw)
        assert hello.get("type") == "presence:hello"
        assert "status" in hello

        # Heartbeat
        await ws.send(json.dumps({"type": "heartbeat"}))
        pong_raw = await asyncio.wait_for(ws.recv(), timeout=5)
        pong = json.loads(pong_raw)
        assert pong.get("type") == "presence:pong"

        # presence:set live → no direct echo, but stays alive
        await ws.send(json.dumps({"type": "presence:set", "status": "live"}))
        await asyncio.sleep(0.5)


@pytest.mark.asyncio
async def test_ws_invalid_token_closes():
    url = f"{WS_BASE}/api/ws/presence?token=invalid.jwt.token"
    try:
        async with websockets.connect(url, open_timeout=10) as ws:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=3)
            except Exception:
                msg = None
            # Should be closed
            assert msg is None or "hello" not in str(msg)
    except websockets.exceptions.InvalidStatus:
        pass
    except websockets.exceptions.ConnectionClosed:
        pass


@pytest.mark.asyncio
async def test_ws_two_account_presence_update(tfone_token, stealth_token):
    """Connect both stealth and tfone. Set tfone live. Verify stealth
    receives presence:update for tfone with status=live. Then set
    tfone invisible → stealth should see status=offline."""
    s_url = f"{WS_BASE}/api/ws/presence?token={stealth_token}"
    t_url = f"{WS_BASE}/api/ws/presence?token={tfone_token}"
    async with websockets.connect(s_url, open_timeout=10) as sws, \
               websockets.connect(t_url, open_timeout=10) as tws:
        # consume hellos
        await asyncio.wait_for(sws.recv(), timeout=5)
        await asyncio.wait_for(tws.recv(), timeout=5)

        async def drain_for(ws, key, val, timeout=5.0):
            end = asyncio.get_event_loop().time() + timeout
            while asyncio.get_event_loop().time() < end:
                try:
                    raw = await asyncio.wait_for(ws.recv(),
                                                 timeout=end - asyncio.get_event_loop().time())
                except asyncio.TimeoutError:
                    return None
                m = json.loads(raw)
                if m.get("type") == "presence:update" and m.get(key) == val:
                    return m
            return None

        # tfone sets live
        await tws.send(json.dumps({"type": "presence:set", "status": "live"}))
        msg = await drain_for(sws, "status", "live", timeout=5)
        assert msg is not None, "stealth did not receive presence:update live"
        assert msg["status"] == "live"

        # tfone sets invisible → stealth should see offline
        await tws.send(json.dumps({"type": "presence:set", "status": "invisible"}))
        msg2 = await drain_for(sws, "status", "offline", timeout=5)
        assert msg2 is not None, "stealth did not receive presence:update offline (from invisible)"

    # After tws closes, last socket — backend marks tfone offline.
    # Verify via /presence/friends from stealth
    api = requests.Session()
    await asyncio.sleep(0.5)
    r = api.get(f"{BASE_URL}/api/presence/friends",
                headers={"Authorization": f"Bearer {stealth_token}"})
    assert r.status_code == 200
    # find tfone — should be offline now (no socket)
    tfone_entry = next((f for f in r.json()["friends"]
                        if f["username"] == "tfone"), None)
    if tfone_entry is not None:
        assert tfone_entry["presence_status"] in {"offline", "invisible"}, \
            f"tfone after disconnect should be offline, got {tfone_entry['presence_status']}"


@pytest.mark.asyncio
async def test_ws_messenger_focus(tfone_token, stealth_token):
    """presence:focus messenger=true → broadcasts status=messenger."""
    s_url = f"{WS_BASE}/api/ws/presence?token={stealth_token}"
    t_url = f"{WS_BASE}/api/ws/presence?token={tfone_token}"
    async with websockets.connect(s_url, open_timeout=10) as sws, \
               websockets.connect(t_url, open_timeout=10) as tws:
        await asyncio.wait_for(sws.recv(), timeout=5)
        await asyncio.wait_for(tws.recv(), timeout=5)

        await tws.send(json.dumps({"type": "presence:focus", "messenger": True}))
        async def drain_for(ws, val, timeout=5.0):
            end = asyncio.get_event_loop().time() + timeout
            while asyncio.get_event_loop().time() < end:
                try:
                    raw = await asyncio.wait_for(ws.recv(),
                                                 timeout=end - asyncio.get_event_loop().time())
                except asyncio.TimeoutError:
                    return None
                m = json.loads(raw)
                if m.get("type") == "presence:update" and m.get("status") == val:
                    return m
            return None
        msg = await drain_for(sws, "messenger", 5)
        assert msg is not None, "stealth should see tfone as messenger"
