"""Backend tests for Realm Edit/Delete authz + cascade + audit (iter 32)."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email_or_username: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email_or_username, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email_or_username}: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, f"no token in login response: {body}"
    return tok


def _hdrs(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


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
def dj_realm() -> dict:
    r = requests.get(f"{API}/communities/realms/dj", timeout=20)
    assert r.status_code == 200, f"seed realm 'dj' missing: {r.status_code} {r.text}"
    return r.json()


# ------------------------------------------------------------------ PATCH AUTHZ
class TestPatchAuthz:
    def test_founder_patch_ok(self, stealth_token, dj_realm):
        r = requests.patch(
            f"{API}/communities/realms/{dj_realm['id']}",
            headers=_hdrs(stealth_token),
            json={"description": dj_realm.get("description") or "DJ realm"},
            timeout=20,
        )
        assert r.status_code == 200, r.text

    def test_random_member_patch_forbidden(self, tftwo_token, dj_realm):
        r = requests.patch(
            f"{API}/communities/realms/{dj_realm['id']}",
            headers=_hdrs(tftwo_token),
            json={"description": "tftwo should not be allowed"},
            timeout=20,
        )
        assert r.status_code == 403, r.text

    def test_unauthenticated_patch_401(self, dj_realm):
        r = requests.patch(
            f"{API}/communities/realms/{dj_realm['id']}",
            json={"description": "no auth"},
            headers={"Content-Type": "application/json"},
            timeout=20,
        )
        assert r.status_code in (401, 403), r.text

    def test_patch_nonexistent_404(self, stealth_token):
        r = requests.patch(
            f"{API}/communities/realms/does-not-exist-xyz",
            headers=_hdrs(stealth_token),
            json={"description": "nope"},
            timeout=20,
        )
        assert r.status_code == 404


# ------------------------------------------------------------------ PATCH SHAPES
class TestPatchPartial:
    def test_partial_only_description(self, stealth_token, dj_realm):
        rid = dj_realm["id"]
        before = requests.get(f"{API}/communities/realms/{rid}", timeout=20).json()
        new_desc = f"TEST_desc_{int(time.time())}"
        r = requests.patch(
            f"{API}/communities/realms/{rid}",
            headers=_hdrs(stealth_token),
            json={"description": new_desc},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        after = r.json()
        assert after["description"] == new_desc
        assert after["name"] == before["name"]
        assert after.get("accent") == before.get("accent")
        assert after.get("tags") == before.get("tags")
        assert after.get("privacy") == before.get("privacy")
        assert after.get("updated_at") and after["updated_at"] != before.get("updated_at")

    def test_invalid_privacy_400(self, stealth_token, dj_realm):
        r = requests.patch(
            f"{API}/communities/realms/{dj_realm['id']}",
            headers=_hdrs(stealth_token),
            json={"privacy": "banana"},
            timeout=20,
        )
        assert r.status_code == 400

    def test_short_name_400(self, stealth_token, dj_realm):
        r = requests.patch(
            f"{API}/communities/realms/{dj_realm['id']}",
            headers=_hdrs(stealth_token),
            json={"name": ""},
            timeout=20,
        )
        assert r.status_code in (400, 422), r.text

    def test_tags_clip_to_20(self, stealth_token, dj_realm):
        tags = [f"t{i}" for i in range(30)]
        r = requests.patch(
            f"{API}/communities/realms/{dj_realm['id']}",
            headers=_hdrs(stealth_token),
            json={"tags": tags},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert len(r.json().get("tags") or []) == 20


# ------------------------------------------------------------------ OWNER PATCH (tfone)
def _create_throwaway(token: str, name_prefix: str = "TEST_e2e") -> dict:
    name = f"{name_prefix}-{int(time.time()*1000) % 100000000}"
    r = requests.post(
        f"{API}/communities/realms",
        headers=_hdrs(token),
        json={"name": name, "description": "throwaway", "tags": ["a"], "privacy": "public"},
        timeout=20,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


class TestPatchOwner:
    def test_owner_can_patch_own_realm(self, tfone_token):
        realm = _create_throwaway(tfone_token, "TEST_owner")
        try:
            r = requests.patch(
                f"{API}/communities/realms/{realm['id']}",
                headers=_hdrs(tfone_token),
                json={"name": "TEST_renamed", "privacy": "private", "tags": ["a", "b"]},
                timeout=20,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["name"] == "TEST_renamed"
            assert body["privacy"] == "private"
            assert body["tags"] == ["a", "b"]
        finally:
            requests.delete(f"{API}/communities/realms/{realm['id']}", headers=_hdrs(tfone_token), timeout=20)


# ------------------------------------------------------------------ DELETE AUTHZ + CASCADE
class TestDelete:
    def test_unauth_delete_401(self):
        r = requests.delete(f"{API}/communities/realms/some-id", timeout=20)
        assert r.status_code in (401, 403)

    def test_delete_nonexistent_404(self, stealth_token):
        r = requests.delete(
            f"{API}/communities/realms/does-not-exist-xyz",
            headers=_hdrs(stealth_token),
            timeout=20,
        )
        assert r.status_code == 404

    def test_random_member_delete_403(self, tftwo_token, dj_realm):
        r = requests.delete(
            f"{API}/communities/realms/{dj_realm['id']}",
            headers=_hdrs(tftwo_token),
            timeout=20,
        )
        assert r.status_code == 403

    def test_owner_delete_cascade_summary(self, tfone_token, tftwo_token):
        realm = _create_throwaway(tfone_token, "TEST_cascade")
        rid = realm["id"]
        # tftwo joins
        jr = requests.post(f"{API}/communities/realm/{rid}/join", headers=_hdrs(tftwo_token), timeout=20)
        assert jr.status_code in (200, 201, 409), jr.text
        # Now delete
        r = requests.delete(f"{API}/communities/realms/{rid}", headers=_hdrs(tfone_token), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        s = body.get("summary", {})
        for key in ("chats", "widgets", "memberships", "realm"):
            assert key in s, f"missing summary key {key}: {s}"
        assert s["realm"] == 1, s
        assert s["memberships"] >= 1, s
        # Confirm 404 afterwards
        g = requests.get(f"{API}/communities/realms/{rid}", timeout=20)
        assert g.status_code == 404
        # Idempotent double-delete
        r2 = requests.delete(f"{API}/communities/realms/{rid}", headers=_hdrs(tfone_token), timeout=20)
        assert r2.status_code == 404

    def test_delete_does_not_touch_other_realm(self, tfone_token):
        a = _create_throwaway(tfone_token, "TEST_A")
        b = _create_throwaway(tfone_token, "TEST_B")
        try:
            r = requests.delete(f"{API}/communities/realms/{a['id']}", headers=_hdrs(tfone_token), timeout=20)
            assert r.status_code == 200
            # B must still exist
            g = requests.get(f"{API}/communities/realms/{b['id']}", timeout=20)
            assert g.status_code == 200
            mem = requests.get(f"{API}/communities/realm/{b['id']}/members", headers=_hdrs(tfone_token), timeout=20)
            assert mem.status_code == 200, mem.text
        finally:
            requests.delete(f"{API}/communities/realms/{b['id']}", headers=_hdrs(tfone_token), timeout=20)


# ------------------------------------------------------------------ AUDIT LOG (visible via DB only)
# We can't read audit_log via HTTP, so this is a behavioral smoke test:
# patch with empty body should not 5xx, and should not break the realm.
class TestAuditSmoke:
    def test_empty_patch_no_change(self, stealth_token, dj_realm):
        r = requests.patch(
            f"{API}/communities/realms/{dj_realm['id']}",
            headers=_hdrs(stealth_token),
            json={},
            timeout=20,
        )
        assert r.status_code == 200, r.text
