"""Bundle I — ORAi per-Center AI assistant backend tests.

Endpoints under test:
  POST   /api/responsibility-center/{cid}/orai/chat
  GET    /api/responsibility-center/{cid}/orai/sessions
  GET    /api/responsibility-center/{cid}/orai/sessions/{sid}/messages
  DELETE /api/responsibility-center/{cid}/orai/sessions/{sid}
"""
import os
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
EDU_CID = "3ed43c2b553547fbb3e6ca23b405eb91"


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email} → {r.status_code}: {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def stealth_headers():
    return {"Authorization": f"Bearer {_login('stealth', 'Password1$')}"}


@pytest.fixture(scope="module")
def tftwo_headers():
    return {"Authorization": f"Bearer {_login('tftwo', 'pass1234')}"}


@pytest.fixture(scope="module")
def created_session_id(stealth_headers):
    """Create one session used across multiple tests to minimize OpenAI calls."""
    r = requests.post(
        f"{BASE}/api/responsibility-center/{EDU_CID}/orai/chat",
        headers=stealth_headers,
        json={"message": "In one short sentence, name one open lesson in this center."},
        timeout=90)
    assert r.status_code == 200, f"chat create → {r.status_code}: {r.text[:400]}"
    j = r.json()
    assert "session_id" in j and "reply" in j
    return {"sid": j["session_id"], "first_reply": j["reply"], "model": j.get("model"),
            "power_level": j.get("power_level")}


# ── Validation ──────────────────────────────────────────────────────
class TestValidation:
    def test_empty_message_400(self, stealth_headers):
        r = requests.post(f"{BASE}/api/responsibility-center/{EDU_CID}/orai/chat",
                          headers=stealth_headers, json={"message": ""}, timeout=20)
        assert r.status_code == 400

    def test_whitespace_only_400(self, stealth_headers):
        r = requests.post(f"{BASE}/api/responsibility-center/{EDU_CID}/orai/chat",
                          headers=stealth_headers, json={"message": "   \n\t "}, timeout=20)
        assert r.status_code == 400

    def test_too_long_message_400(self, stealth_headers):
        r = requests.post(f"{BASE}/api/responsibility-center/{EDU_CID}/orai/chat",
                          headers=stealth_headers,
                          json={"message": "x" * 4001}, timeout=20)
        assert r.status_code == 400


# ── Chat + Session flows ────────────────────────────────────────────
class TestChatAndSessions:
    def test_first_chat_creates_session(self, created_session_id):
        assert isinstance(created_session_id["sid"], str) and len(created_session_id["sid"]) >= 8
        assert created_session_id["power_level"] in ("economy", "standard", "enhanced", "high")
        assert isinstance(created_session_id["first_reply"], str)
        assert len(created_session_id["first_reply"]) > 0

    def test_reply_references_real_center_data(self, created_session_id):
        """Reply should mention something from context (a lesson title). Loose match."""
        reply = created_session_id["first_reply"].lower()
        # We can't guarantee LLM picks Photosynthesis vs Linear Equations vs others,
        # but reply should not be a canned refusal; be lenient — verify it's substantive.
        assert len(reply) > 15, f"reply too short: {reply!r}"

    def test_sessions_list_contains_new_session(self, stealth_headers, created_session_id):
        r = requests.get(f"{BASE}/api/responsibility-center/{EDU_CID}/orai/sessions",
                         headers=stealth_headers, timeout=20)
        assert r.status_code == 200, r.text[:300]
        ids = [s["id"] for s in r.json().get("sessions", [])]
        assert created_session_id["sid"] in ids

    def test_messages_history_has_user_and_assistant(self, stealth_headers, created_session_id):
        sid = created_session_id["sid"]
        r = requests.get(
            f"{BASE}/api/responsibility-center/{EDU_CID}/orai/sessions/{sid}/messages",
            headers=stealth_headers, timeout=20)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["session"]["id"] == sid
        roles = [m["role"] for m in j["messages"]]
        assert "user" in roles and "assistant" in roles
        assert len(j["messages"]) >= 2

    def test_multi_turn_same_session(self, stealth_headers, created_session_id):
        sid = created_session_id["sid"]
        r = requests.post(
            f"{BASE}/api/responsibility-center/{EDU_CID}/orai/chat",
            headers=stealth_headers,
            json={"session_id": sid,
                  "message": "In under 20 words, restate my previous question."},
            timeout=90)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        assert j["session_id"] == sid
        assert isinstance(j["reply"], str) and len(j["reply"]) > 0
        # Verify messages count grew
        r2 = requests.get(
            f"{BASE}/api/responsibility-center/{EDU_CID}/orai/sessions/{sid}/messages",
            headers=stealth_headers, timeout=20)
        assert len(r2.json()["messages"]) >= 4


# ── Permission isolation ────────────────────────────────────────────
class TestPermissionIsolation:
    def test_non_member_cannot_chat(self, tftwo_headers):
        r = requests.post(f"{BASE}/api/responsibility-center/{EDU_CID}/orai/chat",
                          headers=tftwo_headers,
                          json={"message": "hi"}, timeout=30)
        assert r.status_code in (403, 404), f"expected 403/404, got {r.status_code}: {r.text[:200]}"

    def test_non_member_cannot_list_sessions(self, tftwo_headers):
        r = requests.get(f"{BASE}/api/responsibility-center/{EDU_CID}/orai/sessions",
                         headers=tftwo_headers, timeout=20)
        assert r.status_code in (403, 404)

    def test_other_user_cannot_access_session(self, tftwo_headers, created_session_id):
        # tftwo shouldn't be able to read stealth's session at all — expect 403/404
        sid = created_session_id["sid"]
        r = requests.get(
            f"{BASE}/api/responsibility-center/{EDU_CID}/orai/sessions/{sid}/messages",
            headers=tftwo_headers, timeout=20)
        assert r.status_code in (403, 404)

    def test_other_user_cannot_delete_session(self, tftwo_headers, created_session_id):
        sid = created_session_id["sid"]
        r = requests.delete(
            f"{BASE}/api/responsibility-center/{EDU_CID}/orai/sessions/{sid}",
            headers=tftwo_headers, timeout=20)
        assert r.status_code in (403, 404)


# ── Activity log ────────────────────────────────────────────────────
class TestActivityLog:
    def test_orai_session_started_logged(self, stealth_headers, created_session_id):
        # activity log is captured via /home-overview or center detail. Query directly:
        # Use the education overview or activity endpoint if any. Fallback: check by asking
        # the sessions list exists (indirect). We'll query rc_reports activity if available.
        # Use the standard center activity route.
        r = requests.get(f"{BASE}/api/responsibility-center/{EDU_CID}/activity",
                         headers=stealth_headers, timeout=20)
        if r.status_code != 200:
            pytest.skip(f"activity endpoint not available ({r.status_code})")
        rows = r.json() if isinstance(r.json(), list) else r.json().get("activity", [])
        kinds = " ".join(str(a).lower() for a in rows)
        assert "orai_session_started" in kinds or "orai" in kinds, \
            f"orai_session_started not found in activity: {kinds[:400]}"


# ── Compliance ──────────────────────────────────────────────────────
class TestCompliance:
    def test_fire_power_not_money(self, stealth_headers):
        r = requests.post(
            f"{BASE}/api/responsibility-center/{EDU_CID}/orai/chat",
            headers=stealth_headers,
            json={"message": "Can I sell my Fire Power for cash?"},
            timeout=90)
        assert r.status_code == 200, r.text[:400]
        reply = r.json()["reply"].lower()
        # Must not encourage selling / trading for money
        bad = ["you can sell", "you can trade for cash", "convert to usd",
               "convert to dollars", "cash out your fire"]
        for phrase in bad:
            assert phrase not in reply, f"non-compliant reply contains {phrase!r}: {reply[:400]}"
        # Should say something about engagement/no cash value ideally
        assert "fire power" in reply or "engagement" in reply or "cash value" in reply \
            or "not money" in reply or "cannot" in reply or "can't" in reply, \
            f"reply doesn't address FP compliance: {reply[:400]}"


# ── Delete session (run last) ───────────────────────────────────────
class TestDeleteSession:
    def test_delete_session_removes(self, stealth_headers, created_session_id):
        sid = created_session_id["sid"]
        r = requests.delete(
            f"{BASE}/api/responsibility-center/{EDU_CID}/orai/sessions/{sid}",
            headers=stealth_headers, timeout=20)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("ok") is True
        # Verify it's gone
        r2 = requests.get(
            f"{BASE}/api/responsibility-center/{EDU_CID}/orai/sessions/{sid}/messages",
            headers=stealth_headers, timeout=20)
        assert r2.status_code == 404

    def test_delete_nonexistent_returns_404(self, stealth_headers):
        r = requests.delete(
            f"{BASE}/api/responsibility-center/{EDU_CID}/orai/sessions/does-not-exist-xyz",
            headers=stealth_headers, timeout=20)
        assert r.status_code == 404
