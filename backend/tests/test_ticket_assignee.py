"""Phase α (P2-a) — Per-ticket assignee picker backend tests.

Covers:
  - GET  /api/admin/support/assignable                — list of admin candidates
  - POST /api/admin/support/tickets/{id} {assignee_id}  — assign / reassign / unassign
  - GET  /api/admin/support/tickets?assignee_id=…       — filter by assignee
  - Bad assignee id → 400
  - Non-admin user as assignee → 400
  - Non-admin caller → 403
  - Existing status/subject update path still works (regression)
"""
import os
import time
import uuid
import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
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
def fresh_ticket(user_token):
    """A brand-new (unassigned) ticket for the assignee tests."""
    suffix = uuid.uuid4().hex[:6]
    r = requests.post(
        f"{API}/tickets/ensure",
        json={"subject": f"TEST_assignee_{suffix}"},
        headers=_h(user_token),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["ticket"]


@pytest.fixture(scope="module")
def stealth_user_id():
    r = requests.get(f"{API}/profile/by-username/stealth", timeout=20)
    assert r.status_code == 200
    return (r.json().get("user") or r.json()).get("id")


@pytest.fixture(scope="module")
def support_user_id():
    r = requests.get(f"{API}/profile/by-username/support", timeout=20)
    assert r.status_code == 200
    return (r.json().get("user") or r.json()).get("id")


@pytest.fixture(scope="module")
def regular_user_id():
    r = requests.get(f"{API}/profile/by-username/tfone", timeout=20)
    assert r.status_code == 200
    return (r.json().get("user") or r.json()).get("id")


# ─────────── /admin/support/assignable ───────────
class TestAssignable:
    def test_admin_gets_assignable_list(self, stealth_token):
        r = requests.get(f"{API}/admin/support/assignable", headers=_h(stealth_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "assignable" in data
        users = data["assignable"]
        assert isinstance(users, list)
        assert len(users) >= 2  # stealth + support
        unames = {u["username"] for u in users}
        assert "stealth" in unames
        assert "support" in unames
        # Each row has the contract shape.
        for u in users:
            assert "id" in u and u["id"]
            assert "username" in u
            assert "admin_role" in u
        # Founder appears before support_admin (stable ordering).
        founder_idx = next(i for i, u in enumerate(users) if u["username"] == "stealth")
        support_idx = next(i for i, u in enumerate(users) if u["username"] == "support")
        assert founder_idx < support_idx

    def test_support_admin_can_read(self, support_token):
        r = requests.get(f"{API}/admin/support/assignable", headers=_h(support_token), timeout=20)
        assert r.status_code == 200, r.text

    def test_regular_user_forbidden(self, user_token):
        r = requests.get(f"{API}/admin/support/assignable", headers=_h(user_token), timeout=20)
        assert r.status_code == 403

    def test_unauth_forbidden(self):
        r = requests.get(f"{API}/admin/support/assignable", timeout=20)
        assert r.status_code == 401


# ─────────── PATCH ticket assignee ───────────
class TestAssignTicket:
    def test_assign_then_reassign_then_unassign(self, stealth_token, fresh_ticket, stealth_user_id, support_user_id):
        tid = fresh_ticket["id"]
        # Initially unassigned.
        assert fresh_ticket.get("assignee_id") is None

        # Assign to @stealth.
        r1 = requests.post(
            f"{API}/admin/support/tickets/{tid}",
            json={"assignee_id": stealth_user_id},
            headers=_h(stealth_token), timeout=20,
        )
        assert r1.status_code == 200, r1.text
        t1 = r1.json()["ticket"]
        assert t1["assignee_id"] == stealth_user_id
        assert t1["assignee_username"] == "stealth"
        # Status untouched.
        assert t1["status"] == fresh_ticket["status"]

        # Reassign to @support.
        r2 = requests.post(
            f"{API}/admin/support/tickets/{tid}",
            json={"assignee_id": support_user_id},
            headers=_h(stealth_token), timeout=20,
        )
        assert r2.status_code == 200
        t2 = r2.json()["ticket"]
        assert t2["assignee_id"] == support_user_id
        assert t2["assignee_username"] == "support"

        # Unassign via empty string.
        r3 = requests.post(
            f"{API}/admin/support/tickets/{tid}",
            json={"assignee_id": ""},
            headers=_h(stealth_token), timeout=20,
        )
        assert r3.status_code == 200
        t3 = r3.json()["ticket"]
        assert t3.get("assignee_id") is None
        assert t3.get("assignee_username") is None

        # Unassign via JSON null also works.
        requests.post(
            f"{API}/admin/support/tickets/{tid}",
            json={"assignee_id": support_user_id},
            headers=_h(stealth_token), timeout=20,
        )
        r4 = requests.post(
            f"{API}/admin/support/tickets/{tid}",
            json={"assignee_id": None},
            headers=_h(stealth_token), timeout=20,
        )
        assert r4.status_code == 200
        assert r4.json()["ticket"].get("assignee_id") is None

    def test_status_change_alongside_assignee(self, stealth_token, user_token, stealth_user_id):
        e = requests.post(
            f"{API}/tickets/ensure",
            json={"subject": f"TEST_assign_status_{uuid.uuid4().hex[:5]}"},
            headers=_h(user_token), timeout=20,
        )
        tid = e.json()["ticket"]["id"]
        r = requests.post(
            f"{API}/admin/support/tickets/{tid}",
            json={"assignee_id": stealth_user_id, "status": "In Progress"},
            headers=_h(stealth_token), timeout=20,
        )
        assert r.status_code == 200, r.text
        t = r.json()["ticket"]
        assert t["assignee_id"] == stealth_user_id
        assert t["status"] == "In Progress"

    def test_unknown_assignee_id_returns_400(self, stealth_token, fresh_ticket):
        r = requests.post(
            f"{API}/admin/support/tickets/{fresh_ticket['id']}",
            json={"assignee_id": "nonexistent-user-id-xxx"},
            headers=_h(stealth_token), timeout=20,
        )
        assert r.status_code == 400
        assert "unknown" in r.json().get("detail", "").lower()

    def test_non_admin_target_assignee_returns_400(self, stealth_token, fresh_ticket, regular_user_id):
        r = requests.post(
            f"{API}/admin/support/tickets/{fresh_ticket['id']}",
            json={"assignee_id": regular_user_id},
            headers=_h(stealth_token), timeout=20,
        )
        assert r.status_code == 400
        assert "admin" in r.json().get("detail", "").lower()

    def test_non_admin_caller_forbidden(self, user_token, fresh_ticket, stealth_user_id):
        r = requests.post(
            f"{API}/admin/support/tickets/{fresh_ticket['id']}",
            json={"assignee_id": stealth_user_id},
            headers=_h(user_token), timeout=20,
        )
        assert r.status_code == 403


# ─────────── filter by assignee ───────────
class TestAssigneeFilter:
    def test_filter_by_assignee_id(self, stealth_token, user_token, stealth_user_id):
        # Create + assign a fresh ticket.
        e = requests.post(
            f"{API}/tickets/ensure",
            json={"subject": f"TEST_filter_{uuid.uuid4().hex[:5]}"},
            headers=_h(user_token), timeout=20,
        )
        tid = e.json()["ticket"]["id"]
        requests.post(
            f"{API}/admin/support/tickets/{tid}",
            json={"assignee_id": stealth_user_id},
            headers=_h(stealth_token), timeout=20,
        )
        # Filter list.
        r = requests.get(
            f"{API}/admin/support/tickets",
            params={"assignee_id": stealth_user_id},
            headers=_h(stealth_token), timeout=20,
        )
        assert r.status_code == 200
        tickets = r.json()["tickets"]
        assert any(t["id"] == tid for t in tickets)
        # All returned tickets actually carry that assignee.
        assert all(t.get("assignee_id") == stealth_user_id for t in tickets)

    def test_filter_unassigned_sentinel(self, stealth_token, user_token):
        # Create a fresh unassigned ticket.
        e = requests.post(
            f"{API}/tickets/ensure",
            json={"subject": f"TEST_unassigned_{uuid.uuid4().hex[:5]}"},
            headers=_h(user_token), timeout=20,
        )
        tid = e.json()["ticket"]["id"]
        # Make sure it's unassigned (the user may have an existing assigned one).
        requests.post(
            f"{API}/admin/support/tickets/{tid}",
            json={"assignee_id": ""},
            headers=_h(stealth_token), timeout=20,
        )
        r = requests.get(
            f"{API}/admin/support/tickets",
            params={"assignee_id": "unassigned"},
            headers=_h(stealth_token), timeout=20,
        )
        assert r.status_code == 200
        tickets = r.json()["tickets"]
        assert all(t.get("assignee_id") is None for t in tickets)
        assert any(t["id"] == tid for t in tickets)


# ─────────── regression: existing flows unaffected ───────────
class TestNoRegression:
    def test_existing_status_update_still_works(self, stealth_token, user_token):
        e = requests.post(
            f"{API}/tickets/ensure",
            json={"subject": f"TEST_regression_{uuid.uuid4().hex[:5]}"},
            headers=_h(user_token), timeout=20,
        )
        tid = e.json()["ticket"]["id"]
        r = requests.post(
            f"{API}/admin/support/tickets/{tid}",
            json={"status": "In Progress"},
            headers=_h(stealth_token), timeout=20,
        )
        assert r.status_code == 200
        t = r.json()["ticket"]
        assert t["status"] == "In Progress"
        # assignee fields exist and remain null (we never sent them).
        assert "assignee_id" in t

    def test_ensure_creates_with_assignee_fields(self, user_token):
        r = requests.post(
            f"{API}/tickets/ensure",
            json={"subject": f"TEST_fields_{uuid.uuid4().hex[:5]}"},
            headers=_h(user_token), timeout=20,
        )
        assert r.status_code == 200
        t = r.json()["ticket"]
        assert t.get("assignee_id") is None
        assert t.get("assignee_username") is None
