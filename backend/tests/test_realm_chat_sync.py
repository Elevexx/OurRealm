"""Backend tests for Realm group-chat auto-sync.

Covers:
  • GET /api/communities/my-realms returns ONLY realms the caller belongs to
  • Realm creation auto-attaches the creator as a chat-eligible member
    (chat_id is populated and the new realm appears in /my-realms).
  • Joining a realm makes it appear in /my-realms.
  • Leaving a realm removes it from /my-realms.
  • The /my-realms entry exposes the spec'd field set.
  • PATCHing a realm name updates the matching main chat's title.
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


REQUIRED_FIELDS = {
    "realm_id", "chat_id", "realm_name", "realm_slug",
    "realm_avatar", "realm_banner_url", "member_count",
    "last_message_at", "unread_count", "id", "name", "members",
}


@pytest.fixture(scope="module")
def stealth_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def tfone_token():
    return _login("tfone", "pass1234")


@pytest.fixture(scope="module")
def test_realm(stealth_token):
    r = requests.post(
        f"{API}/communities/realms",
        headers=_hdrs(stealth_token),
        json={"name": "Realm Chat Sync Test", "description": "for chat-sync tests"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    realm = r.json()
    yield realm
    requests.delete(
        f"{API}/communities/realms/{realm['id']}",
        headers=_hdrs(stealth_token), timeout=20,
    )


class TestMyRealmsShape:
    def test_my_realms_requires_auth(self):
        r = requests.get(f"{API}/communities/my-realms", timeout=20)
        assert r.status_code in (401, 403)

    def test_my_realms_includes_realm_for_owner(self, stealth_token, test_realm):
        r = requests.get(f"{API}/communities/my-realms", headers=_hdrs(stealth_token), timeout=20)
        assert r.status_code == 200, r.text
        realms = r.json().get("realms") or []
        row = next((x for x in realms if x.get("realm_id") == test_realm["id"]), None)
        assert row is not None, f"created realm missing from /my-realms: {[r.get('realm_id') for r in realms]}"
        # Spec-mandated field set is present.
        for field in REQUIRED_FIELDS:
            assert field in row, f"missing field `{field}` in /my-realms entry"
        # Owner is in the members[] list.
        me = requests.get(f"{API}/profile/me", headers=_hdrs(stealth_token), timeout=20).json()["user"]
        assert me["id"] in row["members"]
        assert row["role"] == "owner"
        assert row["chat_id"], "main chat_id must be present (auto-created)"

    def test_my_realms_excludes_non_member(self, tfone_token, test_realm):
        r = requests.get(f"{API}/communities/my-realms", headers=_hdrs(tfone_token), timeout=20)
        assert r.status_code == 200
        realms = r.json().get("realms") or []
        assert not any(x.get("realm_id") == test_realm["id"] for x in realms)


class TestJoinLeaveSyncsMyRealms:
    def test_join_realm_makes_it_show_up_in_my_realms(self, tfone_token, test_realm):
        r = requests.post(
            f"{API}/communities/realm/{test_realm['id']}/join",
            headers=_hdrs(tfone_token), timeout=20,
        )
        assert r.status_code == 200, r.text
        # Now /my-realms for tfone must include the realm.
        r2 = requests.get(f"{API}/communities/my-realms", headers=_hdrs(tfone_token), timeout=20)
        realms = r2.json().get("realms") or []
        assert any(x.get("realm_id") == test_realm["id"] for x in realms)

    def test_leave_realm_removes_it_from_my_realms(self, tfone_token, test_realm):
        r = requests.post(
            f"{API}/communities/realm/{test_realm['id']}/leave",
            headers=_hdrs(tfone_token), timeout=20,
        )
        assert r.status_code == 200, r.text
        r2 = requests.get(f"{API}/communities/my-realms", headers=_hdrs(tfone_token), timeout=20)
        realms = r2.json().get("realms") or []
        assert not any(x.get("realm_id") == test_realm["id"] for x in realms)


class TestRealmRenameSyncsChat:
    def test_rename_updates_main_chat_title_and_my_realms_name(self, stealth_token):
        # Fresh isolated realm for this test.
        r = requests.post(
            f"{API}/communities/realms",
            headers=_hdrs(stealth_token),
            json={"name": "Original Name"},
            timeout=20,
        )
        realm = r.json()
        try:
            # Rename
            r2 = requests.patch(
                f"{API}/communities/realms/{realm['id']}",
                headers=_hdrs(stealth_token),
                json={"name": "Renamed Realm"},
                timeout=20,
            )
            assert r2.status_code == 200, r2.text
            # /my-realms must reflect the new name.
            r3 = requests.get(f"{API}/communities/my-realms", headers=_hdrs(stealth_token), timeout=20)
            row = next((x for x in r3.json()["realms"] if x.get("realm_id") == realm["id"]), None)
            assert row is not None
            assert row["realm_name"] == "Renamed Realm"
            assert row["name"] == "Renamed Realm"
        finally:
            requests.delete(
                f"{API}/communities/realms/{realm['id']}",
                headers=_hdrs(stealth_token), timeout=20,
            )


class TestJoinIsIdempotent:
    def test_double_join_does_not_dup_membership(self, tfone_token, test_realm, stealth_token):
        # First join.
        r = requests.post(
            f"{API}/communities/realm/{test_realm['id']}/join",
            headers=_hdrs(tfone_token), timeout=20,
        )
        assert r.status_code == 200
        first = r.json()["member_count"]
        # Second join.
        r2 = requests.post(
            f"{API}/communities/realm/{test_realm['id']}/join",
            headers=_hdrs(tfone_token), timeout=20,
        )
        assert r2.status_code == 200
        assert r2.json().get("already_member") is True
        assert r2.json()["member_count"] == first
        # Cleanup.
        requests.post(
            f"{API}/communities/realm/{test_realm['id']}/leave",
            headers=_hdrs(tfone_token), timeout=20,
        )
