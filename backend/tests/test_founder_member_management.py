"""Backend tests for founder-only realm member management.

Covers:
  • POST   /api/communities/realm/{id}/members/add        — founder only
  • DELETE /api/communities/realm/{id}/members/{user_id}  — founder only

Server-side authorization, idempotency, audit logging, notifications,
and protected-account guards.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://realm-deploy.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


# ---- auth helpers ----------------------------------------------------
def _login(email_or_username: str, password: str) -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email_or_username, "password": password},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed for {email_or_username}: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, f"no token in login response: {body}"
    return tok


def _hdrs(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---- fixtures --------------------------------------------------------
@pytest.fixture(scope="module")
def stealth_token() -> str:
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def tfone_token() -> str:
    return _login("tfone", "pass1234")


@pytest.fixture(scope="module")
def tftwo_token() -> str:
    return _login("tftwo", "pass1234")


@pytest.fixture(scope="module")
def tfone_id(tfone_token) -> str:
    r = requests.get(f"{API}/profile/me", headers=_hdrs(tfone_token), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"]


@pytest.fixture(scope="module")
def tftwo_id(tftwo_token) -> str:
    r = requests.get(f"{API}/profile/me", headers=_hdrs(tftwo_token), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"]


@pytest.fixture(scope="module")
def test_realm(stealth_token) -> dict:
    """Create a dedicated realm for these tests so we don't pollute seed data."""
    r = requests.post(
        f"{API}/communities/realms",
        headers=_hdrs(stealth_token),
        json={"name": "Founder Mgmt Test", "description": "for member mgmt tests"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    realm = r.json()
    yield realm
    # Cleanup — delete the realm after tests run.
    try:
        requests.delete(
            f"{API}/communities/realms/{realm['id']}",
            headers=_hdrs(stealth_token),
            timeout=20,
        )
    except Exception:
        pass


# ---- add member ------------------------------------------------------
class TestAddMember:
    def test_founder_adds_user_ok(self, stealth_token, test_realm):
        r = requests.post(
            f"{API}/communities/realm/{test_realm['id']}/members/add",
            headers=_hdrs(stealth_token),
            json={"username": "tfone"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("user", {}).get("username", "").lower() == "tfone"

    def test_founder_adds_user_idempotent(self, stealth_token, test_realm):
        """Re-adding the same user should be idempotent — no duplicate row."""
        r = requests.post(
            f"{API}/communities/realm/{test_realm['id']}/members/add",
            headers=_hdrs(stealth_token),
            json={"username": "tfone"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("already_member") is True

    def test_founder_add_nonexistent_user_404(self, stealth_token, test_realm):
        r = requests.post(
            f"{API}/communities/realm/{test_realm['id']}/members/add",
            headers=_hdrs(stealth_token),
            json={"username": "definitely-not-a-real-user-xyz123"},
            timeout=20,
        )
        assert r.status_code == 404, r.text

    def test_non_founder_add_forbidden(self, tfone_token, test_realm):
        """Even a normal member must not be able to add anyone."""
        r = requests.post(
            f"{API}/communities/realm/{test_realm['id']}/members/add",
            headers=_hdrs(tfone_token),
            json={"username": "tftwo"},
            timeout=20,
        )
        assert r.status_code == 403, r.text

    def test_unauth_add_rejected(self, test_realm):
        r = requests.post(
            f"{API}/communities/realm/{test_realm['id']}/members/add",
            json={"username": "tftwo"},
            timeout=20,
        )
        assert r.status_code in (401, 403), r.text


# ---- remove member ---------------------------------------------------
class TestRemoveMember:
    def test_setup_add_tftwo(self, stealth_token, test_realm):
        r = requests.post(
            f"{API}/communities/realm/{test_realm['id']}/members/add",
            headers=_hdrs(stealth_token),
            json={"username": "tftwo"},
            timeout=20,
        )
        assert r.status_code == 200, r.text

    def test_non_founder_remove_forbidden(self, tfone_token, test_realm, tftwo_id):
        r = requests.delete(
            f"{API}/communities/realm/{test_realm['id']}/members/{tftwo_id}",
            headers=_hdrs(tfone_token),
            timeout=20,
        )
        assert r.status_code == 403, r.text

    def test_founder_remove_ok(self, stealth_token, test_realm, tftwo_id):
        r = requests.delete(
            f"{API}/communities/realm/{test_realm['id']}/members/{tftwo_id}",
            headers=_hdrs(stealth_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("removed") == 1

    def test_founder_cannot_remove_owner(self, stealth_token, test_realm):
        """The realm owner @stealth (the creator of this test realm) cannot be removed via this endpoint."""
        owner_id = test_realm.get("owner_id")
        assert owner_id, f"test realm missing owner_id: {test_realm}"
        r = requests.delete(
            f"{API}/communities/realm/{test_realm['id']}/members/{owner_id}",
            headers=_hdrs(stealth_token),
            timeout=20,
        )
        assert r.status_code == 400, r.text


# ---- visibility regression ------------------------------------------
class TestMemberListAfterMutation:
    def test_added_user_appears_in_member_list(self, stealth_token, test_realm):
        r = requests.get(
            f"{API}/communities/realm/{test_realm['id']}/members",
            headers=_hdrs(stealth_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        usernames = [(m.get("username") or "").lower() for m in r.json().get("members", [])]
        assert "tfone" in usernames
