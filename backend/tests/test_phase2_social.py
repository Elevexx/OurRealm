"""Phase 2 OurRealm social tests: username, friends, public profile, messages."""
import uuid
import requests
import pytest
from .conftest import BASE_URL


def _reg_payload(prefix="u"):
    suffix = uuid.uuid4().hex[:8]
    return {
        "email": f"TEST_{prefix}_{suffix}@ourrealm.app",
        "password": "Pass1234",
        "name": f"Test {prefix} {suffix}",
        "username": f"test{prefix}{suffix}",
    }


def _register(client):
    p = _reg_payload()
    r = client.post(f"{BASE_URL}/api/auth/register", json=p)
    assert r.status_code == 200, r.text
    return p, r.json()


def _fresh_user():
    """Register a user on a fresh session (no cookie contamination across users)."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    p = _reg_payload()
    r = s.post(f"{BASE_URL}/api/auth/register", json=p)
    assert r.status_code == 200, r.text
    d = r.json()
    # Clear cookies so Bearer header is what authenticates (avoid cookie-precedence cross-talk)
    s.cookies.clear()
    s.headers.update({"Authorization": f"Bearer {d['access_token']}"})
    return s, d["user"], d["access_token"]


# ---------- Username availability ----------
class TestUsernameCheck:
    def test_username_available(self, api_client):
        u = f"test{uuid.uuid4().hex[:8]}"
        r = api_client.post(f"{BASE_URL}/api/auth/username/check", json={"username": u})
        assert r.status_code == 200
        assert r.json()["available"] is True

    def test_username_reserved(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/username/check", json={"username": "admin"})
        assert r.status_code == 200
        d = r.json()
        assert d["available"] is False
        assert isinstance(d.get("suggestions"), list) and len(d["suggestions"]) > 0

    def test_username_taken_stealth(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/username/check", json={"username": "stealth"})
        assert r.status_code == 200
        d = r.json()
        assert d["available"] is False
        assert isinstance(d.get("suggestions"), list) and len(d["suggestions"]) > 0

    def test_username_invalid_pattern_422(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/username/check", json={"username": "ab!"})
        assert r.status_code == 422


# ---------- Register with username ----------
class TestRegister:
    def test_register_with_username(self, api_client):
        p, d = _register(api_client)
        u = d["user"]
        assert u["username"] == p["username"]
        assert u["email"].lower() == p["email"].lower()
        # auto-friend stealth
        assert "stealth" in (u.get("friends") or [])

    def test_register_duplicate_username(self, api_client):
        p = _reg_payload()
        r1 = api_client.post(f"{BASE_URL}/api/auth/register", json=p)
        assert r1.status_code == 200
        p2 = _reg_payload()
        p2["username"] = p["username"]
        r2 = api_client.post(f"{BASE_URL}/api/auth/register", json=p2)
        assert r2.status_code == 400

    def test_register_invalid_username(self, api_client):
        p = _reg_payload()
        p["username"] = "no spaces"
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=p)
        assert r.status_code == 422


# ---------- Auto-friend stealth verified via /friends/list ----------
class TestAutoFriend:
    def test_new_user_has_stealth_in_friends_list(self, api_client):
        p, d = _register(api_client)
        token = d["access_token"]
        r = api_client.get(f"{BASE_URL}/api/friends/list", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        body = r.json()
        usernames = [f["username"] for f in body["friends"]]
        assert "stealth" in usernames, f"stealth not in friends: {usernames}"


# ---------- Users search & featured ----------
class TestUsersDiscovery:
    def test_search_finds_stealth(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/users/search", params={"q": "stealth"})
        assert r.status_code == 200
        users = r.json()["users"]
        assert any(u.get("username") == "stealth" for u in users)

    def test_featured_includes_stealth_with_widgets(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/users/featured", params={"limit": 12})
        assert r.status_code == 200
        users = r.json()["users"]
        stealth = next((u for u in users if u.get("username") == "stealth"), None)
        assert stealth is not None
        assert isinstance(stealth.get("widgets"), list) and len(stealth["widgets"]) >= 1


# ---------- Public profile ----------
class TestPublicProfile:
    def test_get_public_profile_stealth_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/profile/by-username/stealth")
        assert r.status_code == 200
        u = r.json()["user"]
        assert u["username"] == "stealth"
        assert u.get("is_founder") is True
        assert u.get("is_verified") is True
        assert isinstance(u.get("widgets"), list) and len(u["widgets"]) >= 1

    def test_public_profile_404(self):
        r = requests.get(f"{BASE_URL}/api/profile/by-username/nonexistent_{uuid.uuid4().hex[:6]}")
        assert r.status_code == 404


# ---------- Friend request lifecycle ----------
class TestFriendLifecycle:
    def test_request_accept_status_flow(self):
        s1, u1d, _ = _fresh_user()
        s2, u2d, _ = _fresh_user()
        u1 = u1d["username"]
        u2 = u2d["username"]

        # 1 sends request to 2
        r = s1.post(f"{BASE_URL}/api/friends/request", json={"username": u2})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "outgoing"

        # status from 1's perspective -> outgoing; from 2 -> incoming
        s1_status = s1.get(f"{BASE_URL}/api/friends/status/{u2}").json()
        s2_status = s2.get(f"{BASE_URL}/api/friends/status/{u1}").json()
        assert s1_status["status"] == "outgoing"
        assert s2_status["status"] == "incoming"

        # 2 accepts
        r = s2.post(f"{BASE_URL}/api/friends/accept", json={"username": u1})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "friends"

        # Both see each other in /friends/list
        l1 = s1.get(f"{BASE_URL}/api/friends/list").json()
        l2 = s2.get(f"{BASE_URL}/api/friends/list").json()
        assert u2 in [f["username"] for f in l1["friends"]]
        assert u1 in [f["username"] for f in l2["friends"]]

        # status now friends
        sf = s1.get(f"{BASE_URL}/api/friends/status/{u2}").json()
        assert sf["status"] == "friends"

    def test_accept_without_pending_400(self):
        s1, _, _ = _fresh_user()
        s2, u2d, _ = _fresh_user()
        r = s1.post(f"{BASE_URL}/api/friends/accept", json={"username": u2d["username"]})
        assert r.status_code == 400


# ---------- Messaging restricted to friends ----------
class TestMessagingFriendsOnly:
    def test_non_friend_message_403(self):
        s1, _, _ = _fresh_user()
        s2, u2d, _ = _fresh_user()
        r = s1.post(f"{BASE_URL}/api/messages",
                    json={"to_username": u2d["username"], "text": "hello"})
        assert r.status_code == 403, r.text
        assert "friend" in r.json()["detail"].lower()

    def test_friends_can_message_and_read_thread(self):
        s1, u1d, _ = _fresh_user()
        s2, u2d, _ = _fresh_user()
        u1 = u1d["username"]
        u2 = u2d["username"]

        # befriend
        rq = s1.post(f"{BASE_URL}/api/friends/request", json={"username": u2})
        assert rq.status_code == 200, rq.text
        ra = s2.post(f"{BASE_URL}/api/friends/accept", json={"username": u1})
        assert ra.status_code == 200, ra.text

        # 1 sends
        msg = "TEST_msg_" + uuid.uuid4().hex[:6]
        r = s1.post(f"{BASE_URL}/api/messages", json={"to_username": u2, "text": msg})
        assert r.status_code == 200, r.text
        assert r.json()["message"]["text"] == msg

        # 2 reads thread
        t = s2.get(f"{BASE_URL}/api/messages/thread/{u1}")
        assert t.status_code == 200, t.text
        texts = [m["text"] for m in t.json()["messages"]]
        assert msg in texts

        # can-message
        cm = s1.get(f"{BASE_URL}/api/messages/can-message/{u2}").json()
        assert cm["allowed"] is True

    def test_thread_non_friend_403(self):
        s1, _, _ = _fresh_user()
        s2, u2d, _ = _fresh_user()
        r = s1.get(f"{BASE_URL}/api/messages/thread/{u2d['username']}")
        assert r.status_code == 403, r.text
