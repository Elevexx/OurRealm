"""Backend tests for the aggregated Realm activity notifications.

Spec: a single row per (realm, recipient) — bumps increment the
`unread_count` counter, `/clear` resets to seen+zero.
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
    return (r.json().get("access_token") or r.json().get("token"))


def _hdrs(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def stealth_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def tfone_token():
    return _login("tfone", "pass1234")


@pytest.fixture(scope="module")
def realm(stealth_token, tfone_token):
    # Create realm + join tfone so there is a recipient for bumps.
    r = requests.post(
        f"{API}/communities/realms",
        headers=_hdrs(stealth_token),
        json={"name": "Notif Test Realm", "description": "for realm-notification tests"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    realm = r.json()
    requests.post(f"{API}/communities/realm/{realm['id']}/join", headers=_hdrs(tfone_token), timeout=20)
    yield realm
    requests.delete(f"{API}/communities/realms/{realm['id']}", headers=_hdrs(stealth_token), timeout=20)


def _list_realm_notifs(token):
    r = requests.get(f"{API}/realm-notifications/list", headers=_hdrs(token), timeout=20)
    assert r.status_code == 200, r.text
    return r.json().get("notifications") or []


class TestBumpAndAggregate:
    def test_single_bump_creates_one_row(self, stealth_token, tfone_token, realm):
        r = requests.post(
            f"{API}/realm-notifications/bump",
            headers=_hdrs(stealth_token),
            json={"realm_id": realm["id"], "activity_type": "message"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        rows = _list_realm_notifs(tfone_token)
        match = [n for n in rows if (n.get("payload") or {}).get("realm_id") == realm["id"]]
        assert len(match) == 1
        assert match[0]["payload"]["unread_count"] == 1
        assert match[0]["payload"]["counters"]["message"] == 1
        assert match[0]["seen"] is False

    def test_multiple_bumps_aggregate(self, stealth_token, tfone_token, realm):
        for kind in ["message", "message", "post", "comment", "media"]:
            r = requests.post(
                f"{API}/realm-notifications/bump",
                headers=_hdrs(stealth_token),
                json={"realm_id": realm["id"], "activity_type": kind},
                timeout=20,
            )
            assert r.status_code == 200, r.text
        rows = _list_realm_notifs(tfone_token)
        row = next(n for n in rows if (n.get("payload") or {}).get("realm_id") == realm["id"])
        # 1 from previous test + 5 here.
        assert row["payload"]["unread_count"] == 6
        c = row["payload"]["counters"]
        assert c["message"] == 3
        assert c["post"] == 1
        assert c["comment"] == 1
        assert c["media"] == 1

    def test_actor_does_not_receive_own_bump(self, stealth_token, realm):
        # @stealth is the actor — they should not see a notification
        # for their own activity in this realm.
        rows = _list_realm_notifs(stealth_token)
        match = [n for n in rows if (n.get("payload") or {}).get("realm_id") == realm["id"]]
        assert match == []


class TestClear:
    def test_clear_marks_seen_and_zeroes_counter(self, tfone_token, realm):
        r = requests.post(
            f"{API}/realm-notifications/{realm['id']}/clear",
            headers=_hdrs(tfone_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        rows = _list_realm_notifs(tfone_token)
        row = next(n for n in rows if (n.get("payload") or {}).get("realm_id") == realm["id"])
        assert row["seen"] is True
        assert row["payload"]["unread_count"] == 0
        assert row["payload"]["counters"] == {}

    def test_next_bump_after_clear_starts_at_one(self, stealth_token, tfone_token, realm):
        requests.post(
            f"{API}/realm-notifications/bump",
            headers=_hdrs(stealth_token),
            json={"realm_id": realm["id"], "activity_type": "message"},
            timeout=20,
        )
        rows = _list_realm_notifs(tfone_token)
        row = next(n for n in rows if (n.get("payload") or {}).get("realm_id") == realm["id"])
        assert row["payload"]["unread_count"] == 1
        assert row["payload"]["counters"] == {"message": 1}
        assert row["seen"] is False


class TestProfileCountsSerializer:
    def test_serialize_user_has_following_and_widgets_count(self, stealth_token):
        r = requests.get(f"{API}/profile/me", headers=_hdrs(stealth_token), timeout=20)
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert "follower_count" in u
        assert "following_count" in u
        assert "widgets_count" in u
        assert u["widgets_count"] == len(u.get("widgets") or [])
