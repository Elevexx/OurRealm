"""Phase B — Support messaging system backend tests.

Covers:
  - /api/tickets/ensure (idempotency + DM auto-post)
  - /api/tickets/me (isolation)
  - /api/admin/support/summary + tickets + update (admin gate, status notify, subject)
  - Admin gate for @stealth, @support, regular user across summary/moderation/analytics
  - @support protection: username rename refused, ban/delete refused
  - Auto-friend with @support on register
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = BASE_URL + "/api"


def _login(identifier: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": identifier, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {identifier}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def stealth_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def support_token():
    return _login("support", "Password1$")


@pytest.fixture(scope="module")
def user_token():
    return _login("testfriend1@example.com", "pass1234")


@pytest.fixture(scope="module")
def user2_token():
    return _login("testfriend2@example.com", "pass1234")


# ─────────── tickets/ensure + tickets/me ───────────
class TestTicketsUser:
    def test_ensure_creates_ticket_and_dm(self, user_token):
        r = requests.post(f"{API}/tickets/ensure", json={"subject": "TEST_phaseB initial"}, headers=_h(user_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        t = data["ticket"]
        for k in ("id", "ticket_number", "user_id", "conv_id", "subject", "status", "created_at", "updated_at"):
            assert k in t, f"missing field {k}"
        assert t["status"] == "Submitted"
        assert isinstance(t["ticket_number"], int) and t["ticket_number"] >= 1001
        # Submission DM from @support should be in thread
        msg = requests.get(f"{API}/messages/thread/support", headers=_h(user_token), timeout=20)
        assert msg.status_code == 200, msg.text
        texts = [m.get("text", "") for m in msg.json().get("messages", [])]
        assert any(f"#{t['ticket_number']}" in tx and "submitted" in tx.lower() for tx in texts), \
            f"expected submission DM with ticket #{t['ticket_number']}; got: {texts[-5:]}"

    def test_ensure_is_idempotent(self, user_token):
        r1 = requests.post(f"{API}/tickets/ensure", json={"subject": "TEST_again"}, headers=_h(user_token), timeout=20)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/tickets/ensure", json={"subject": "TEST_again"}, headers=_h(user_token), timeout=20)
        assert r2.status_code == 200
        assert r2.json()["created"] is False
        assert r1.json()["ticket"]["id"] == r2.json()["ticket"]["id"]

    def test_me_isolation(self, user_token, user2_token):
        # user2 also gets a ticket
        r = requests.post(f"{API}/tickets/ensure", json={"subject": "TEST_user2"}, headers=_h(user2_token), timeout=20)
        assert r.status_code == 200
        u2_ticket_id = r.json()["ticket"]["id"]
        # /me for user1 must not include user2's ticket
        r1 = requests.get(f"{API}/tickets/me", headers=_h(user_token), timeout=20)
        assert r1.status_code == 200
        ids = [t["id"] for t in r1.json()["tickets"]]
        assert u2_ticket_id not in ids
        # And user2 must see its own
        r2 = requests.get(f"{API}/tickets/me", headers=_h(user2_token), timeout=20)
        assert r2.status_code == 200
        assert u2_ticket_id in [t["id"] for t in r2.json()["tickets"]]


# ─────────── admin summary / list / update ───────────
class TestAdminTickets:
    def test_summary_admin_only(self, stealth_token, user_token):
        r = requests.get(f"{API}/admin/support/summary", headers=_h(stealth_token), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("total", "Submitted", "In Progress", "Completed", "Incomplete"):
            assert k in body and isinstance(body[k], int)
        forbid = requests.get(f"{API}/admin/support/summary", headers=_h(user_token), timeout=20)
        assert forbid.status_code == 403
        assert "admin" in forbid.json().get("detail", "").lower()

    def test_list_filter(self, stealth_token):
        r = requests.get(f"{API}/admin/support/tickets", params={"status": "Submitted"}, headers=_h(stealth_token), timeout=20)
        assert r.status_code == 200
        for t in r.json()["tickets"]:
            assert t["status"] == "Submitted"

    def test_update_status_and_subject_triggers_dm(self, stealth_token, user_token):
        # create / find a ticket for user1
        e = requests.post(f"{API}/tickets/ensure", json={"subject": "TEST_status"}, headers=_h(user_token), timeout=20)
        ticket_id = e.json()["ticket"]["id"]
        number = e.json()["ticket"]["ticket_number"]
        # status change
        r = requests.post(f"{API}/admin/support/tickets/{ticket_id}", json={"status": "In Progress"}, headers=_h(stealth_token), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["ticket"]["status"] == "In Progress"
        # auto DM
        time.sleep(0.5)
        msg = requests.get(f"{API}/messages/thread/support", headers=_h(user_token), timeout=20)
        texts = [m.get("text", "") for m in msg.json().get("messages", [])]
        assert any(f"#{number}" in t and "in progress" in t.lower() for t in texts)
        # subject edit (trim + cap at 100)
        long_subj = " TEST_" + ("x" * 200) + " "
        r2 = requests.post(f"{API}/admin/support/tickets/{ticket_id}", json={"subject": long_subj}, headers=_h(stealth_token), timeout=20)
        assert r2.status_code == 200
        new_subj = r2.json()["ticket"]["subject"]
        assert new_subj == ("TEST_" + ("x" * 95))  # trimmed + capped to 100
        assert len(new_subj) == 100

    def test_invalid_status_returns_400(self, stealth_token, user_token):
        e = requests.post(f"{API}/tickets/ensure", json={"subject": "TEST_bad"}, headers=_h(user_token), timeout=20)
        tid = e.json()["ticket"]["id"]
        r = requests.post(f"{API}/admin/support/tickets/{tid}", json={"status": "BogusStatus"}, headers=_h(stealth_token), timeout=20)
        assert r.status_code == 400

    def test_non_admin_update_forbidden(self, user_token):
        e = requests.post(f"{API}/tickets/ensure", json={}, headers=_h(user_token), timeout=20)
        tid = e.json()["ticket"]["id"]
        r = requests.post(f"{API}/admin/support/tickets/{tid}", json={"status": "Completed"}, headers=_h(user_token), timeout=20)
        assert r.status_code == 403


# ─────────── admin gate across phases ───────────
class TestAdminGate:
    def test_support_has_full_admin_access(self, support_token):
        for path in ("/admin/support/summary", "/admin/moderation/summary", "/admin/analytics?range=7d"):
            r = requests.get(f"{API}{path}", headers=_h(support_token), timeout=20)
            assert r.status_code == 200, f"@support should have admin on {path}: {r.status_code} {r.text[:200]}"

    def test_regular_user_blocked_everywhere(self, user_token):
        for path in ("/admin/support/summary", "/admin/moderation/summary", "/admin/analytics?range=7d"):
            r = requests.get(f"{API}{path}", headers=_h(user_token), timeout=20)
            assert r.status_code == 403, f"{path} should be 403 for regular user, got {r.status_code}"


# ─────────── @support protection ───────────
class TestSupportProtection:
    def test_support_cannot_rename(self, support_token):
        new_username = f"support_new_{uuid.uuid4().hex[:6]}"
        r = requests.patch(f"{API}/profile/username", json={"username": new_username}, headers=_h(support_token), timeout=20)
        assert r.status_code == 403
        assert "protected" in r.json().get("detail", "").lower()

    def test_support_cannot_be_banned(self, stealth_token):
        # get support profile id
        r = requests.get(f"{API}/profile/by-username/support", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        sid = (body.get("user") or body).get("id")
        assert sid, body
        ban = requests.post(
            f"{API}/admin/moderation/profile/{sid}/action",
            json={"action": "ban"}, headers=_h(stealth_token), timeout=20,
        )
        assert ban.status_code == 403, ban.text
        assert "protected" in ban.json().get("detail", "").lower()


# ─────────── auto-friend on register ───────────
class TestRegisterAutoFriend:
    def test_new_user_is_auto_friended_with_support(self):
        suffix = uuid.uuid4().hex[:8]
        email = f"TEST_phaseB_{suffix}@example.com"
        username = f"test_pb_{suffix}"
        payload = {
            "email": email, "password": "pass1234", "name": "TEST Phase B",
            "username": username,
            "accepted_terms": True, "accepted_privacy": True,
            "accepted_conditions": True, "age_confirmed_13": True,
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        tok = r.json()["access_token"]
        fl = requests.get(f"{API}/friends/list", headers=_h(tok), timeout=20)
        assert fl.status_code == 200, fl.text
        friend_usernames = {(f.get("username") or "").lower() for f in fl.json().get("friends", [])}
        assert "support" in friend_usernames, f"new user not auto-friended with @support: {friend_usernames}"
