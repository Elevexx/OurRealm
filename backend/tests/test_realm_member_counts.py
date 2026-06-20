"""Backend tests for Realm member-count source-of-truth fix.

Per spec: member counts must be derived from `community_memberships`
records — never from cached/seeded/placeholder values. Covers:

  • /communities/realms list endpoint exposes `member_count`
    derived from actual memberships (and no longer leaks legacy
    `members` / `member_count_estimate` seed columns).
  • Joining a realm increments member_count and the endpoint returns
    the live count for optimistic UI updates.
  • Leaving a realm decrements member_count and returns the live count.
  • Creating a realm yields member_count == 1 immediately (owner
    auto-membership row created by `create_realm`).
"""
import os
import requests
import pytest

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://realm-deploy.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


def _login(uname, pwd):
    r = requests.post(f"{API}/auth/login", json={"email": uname, "password": pwd}, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    return body.get("access_token") or body.get("token")


def _hdrs(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def stealth_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def tfone_token():
    return _login("tfone", "pass1234")


@pytest.fixture(scope="module")
def fresh_realm(stealth_token):
    r = requests.post(
        f"{API}/communities/realms",
        headers=_hdrs(stealth_token),
        json={"name": "Member Count Test", "description": "for member count tests"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    realm = r.json()
    yield realm
    requests.delete(
        f"{API}/communities/realms/{realm['id']}",
        headers=_hdrs(stealth_token), timeout=20,
    )


class TestMemberCountSourceOfTruth:
    def test_list_endpoint_exposes_member_count(self, stealth_token):
        r = requests.get(f"{API}/communities/realms", headers=_hdrs(stealth_token), timeout=20)
        assert r.status_code == 200, r.text
        realms = r.json().get("realms") or []
        assert len(realms) > 0
        for realm in realms:
            assert "member_count" in realm
            # Strict-spec: no legacy or estimated fields leak through.
            assert "members" not in realm
            assert "member_count_estimate" not in realm
            assert "online_count_estimate" not in realm

    def test_create_realm_owner_auto_membership(self, fresh_realm, stealth_token):
        """Creating a realm must yield member_count == 1 immediately."""
        r = requests.get(
            f"{API}/communities/realms/{fresh_realm['id']}",
            headers=_hdrs(stealth_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("member_count") == 1
        # And the list endpoint shows the same number.
        r2 = requests.get(f"{API}/communities/realms", headers=_hdrs(stealth_token), timeout=20)
        row = next((x for x in r2.json()["realms"] if x["id"] == fresh_realm["id"]), None)
        assert row is not None
        assert row.get("member_count") == 1

    def test_join_returns_live_count_and_persists(self, fresh_realm, tfone_token, stealth_token):
        r = requests.post(
            f"{API}/communities/realm/{fresh_realm['id']}/join",
            headers=_hdrs(tfone_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("joined") is True
        assert body.get("member_count") == 2
        # And the list endpoint agrees.
        r2 = requests.get(f"{API}/communities/realms", headers=_hdrs(stealth_token), timeout=20)
        row = next((x for x in r2.json()["realms"] if x["id"] == fresh_realm["id"]), None)
        assert row.get("member_count") == 2

    def test_join_is_idempotent_no_double_count(self, fresh_realm, tfone_token):
        """A second join from the same user must NOT inflate the count."""
        r = requests.post(
            f"{API}/communities/realm/{fresh_realm['id']}/join",
            headers=_hdrs(tfone_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("already_member") is True
        assert body.get("member_count") == 2

    def test_leave_decrements_count_and_returns_live(self, fresh_realm, tfone_token, stealth_token):
        r = requests.post(
            f"{API}/communities/realm/{fresh_realm['id']}/leave",
            headers=_hdrs(tfone_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("member_count") == 1
        r2 = requests.get(f"{API}/communities/realms", headers=_hdrs(stealth_token), timeout=20)
        row = next((x for x in r2.json()["realms"] if x["id"] == fresh_realm["id"]), None)
        assert row.get("member_count") == 1

    def test_founder_add_member_count_matches_list(self, fresh_realm, stealth_token):
        """Adding a member via founder endpoint must also bump the
        count visible on the list endpoint (single source of truth)."""
        r = requests.post(
            f"{API}/communities/realm/{fresh_realm['id']}/members/add",
            headers=_hdrs(stealth_token),
            json={"username": "tftwo"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        r2 = requests.get(f"{API}/communities/realms", headers=_hdrs(stealth_token), timeout=20)
        row = next((x for x in r2.json()["realms"] if x["id"] == fresh_realm["id"]), None)
        assert row.get("member_count") == 2

    def test_founder_remove_member_count_matches_list(self, fresh_realm, stealth_token):
        # find tftwo's id
        me = requests.get(f"{API}/profile/me", headers=_hdrs(_login("tftwo", "pass1234")), timeout=20).json()
        tftwo_id = me["user"]["id"]
        r = requests.delete(
            f"{API}/communities/realm/{fresh_realm['id']}/members/{tftwo_id}",
            headers=_hdrs(stealth_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        r2 = requests.get(f"{API}/communities/realms", headers=_hdrs(stealth_token), timeout=20)
        row = next((x for x in r2.json()["realms"] if x["id"] == fresh_realm["id"]), None)
        assert row.get("member_count") == 1
