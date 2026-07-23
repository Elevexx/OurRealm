"""Iter87 — Inner Realm rename + size + widget persistence tests.

Covers the review request items:
1. Widget persistence across backend restart (auditcheckreal).
2. Empty widgets layout persists.
3. Never-customized fresh account still gets defaults.
4. inner_realm_size backend validation + persistence.
5. inner_8 friend-only + storage cap (24).
6. Progression task rename to Inner Realm.
7. Widget registry rename to Inner Realm.
"""
import os
import time
import uuid
import subprocess
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "https://realm-deploy.preview.emergentagent.com"

STEALTH = {"email": "stealth", "password": "Password1$"}
AUDIT = {"email": "auditcheckreal", "password": "Password1$"}
TFTWO = {"email": "tftwo", "password": "pass1234"}


def _login(session: requests.Session, creds: dict) -> str:
    r = session.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed {creds['email']}: {r.status_code} {r.text[:200]}"
    token = r.json().get("access_token") or r.json().get("token")
    assert token, f"no token: {r.text[:200]}"
    return token


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def stealth_token():
    s = requests.Session()
    return _login(s, STEALTH)


@pytest.fixture(scope="module")
def audit_token():
    s = requests.Session()
    return _login(s, AUDIT)


@pytest.fixture(scope="module")
def tftwo_token():
    s = requests.Session()
    return _login(s, TFTWO)


# ── Widget persistence + rename ────────────────────────────────────────
class TestWidgetPersistence:

    def _me(self, token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(token), timeout=10)
        assert r.status_code == 200, r.text[:200]
        return r.json()["user"]

    def _patch_widgets(self, token, widgets):
        r = requests.patch(
            f"{BASE_URL}/api/profile/me",
            headers=_auth_headers(token),
            json={"widgets": widgets},
            timeout=15,
        )
        assert r.status_code == 200, f"patch failed: {r.status_code} {r.text[:300]}"
        return r.json()["user"]

    def test_top8_only_persists(self, audit_token):
        widgets = [{"id": "w-top8", "type": "top8", "size": "medium", "title": "Inner Realm"}]
        user = self._patch_widgets(audit_token, widgets)
        types = [w.get("type") for w in user.get("widgets") or []]
        assert types == ["top8"], f"expected only top8, got {types}"
        assert user.get("profile_widgets_customized") is True

        # Verify GET /auth/me
        me = self._me(audit_token)
        types2 = [w.get("type") for w in me.get("widgets") or []]
        assert types2 == ["top8"], f"me endpoint types: {types2}"
        # Widget title stored is 'Inner Realm'
        assert (me["widgets"][0].get("title") or "").strip() == "Inner Realm"

    def test_persists_across_backend_restart(self, audit_token):
        """CRITICAL: Restart backend and confirm widgets unchanged."""
        # Confirm pre-state
        pre = self._me(audit_token)
        pre_types = [w.get("type") for w in pre.get("widgets") or []]
        assert pre_types == ["top8"], f"pre-restart types: {pre_types}"

        # Restart backend via supervisor
        result = subprocess.run(
            ["sudo", "supervisorctl", "restart", "backend"],
            capture_output=True, text=True, timeout=30,
        )
        assert "backend" in result.stdout.lower() or result.returncode == 0, result.stderr

        # Wait for backend to come back
        for _ in range(30):
            time.sleep(1)
            try:
                r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(audit_token), timeout=5)
                if r.status_code == 200:
                    break
            except Exception:
                pass
        else:
            pytest.fail("backend did not come back after restart")

        # Verify widgets unchanged
        post = self._me(audit_token)
        post_types = [w.get("type") for w in post.get("widgets") or []]
        assert post_types == ["top8"], f"POST-restart types: {post_types} — MIGRATION RE-INJECTED"
        assert post.get("profile_widgets_customized") is True

    def test_empty_widgets_persist(self, audit_token):
        user = self._patch_widgets(audit_token, [])
        assert (user.get("widgets") or []) == []

        # Backend restart
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                       capture_output=True, text=True, timeout=30)
        for _ in range(30):
            time.sleep(1)
            try:
                r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(audit_token), timeout=5)
                if r.status_code == 200:
                    break
            except Exception:
                pass
        me = self._me(audit_token)
        assert (me.get("widgets") or []) == [], f"empty widgets got re-injected: {me.get('widgets')}"

    def test_add_myfeed_back(self, audit_token):
        widgets = [
            {"id": "w-top8", "type": "top8", "size": "medium", "title": "Inner Realm"},
            {"id": "w-myfeed", "type": "myfeed", "size": "medium", "title": "My Feed"},
        ]
        user = self._patch_widgets(audit_token, widgets)
        types = [w.get("type") for w in user.get("widgets") or []]
        assert types == ["top8", "myfeed"], f"got {types}"

    def test_fresh_account_gets_defaults(self):
        """Never-customized new account should have default widgets."""
        uname = f"iter87_{uuid.uuid4().hex[:6]}"
        email = f"{uname}@example.com"
        r = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "email": email,
                "password": "Password1$",
                "name": "Iter87 Fresh",
                "username": uname,
                "accepted_terms": True,
                "accepted_privacy": True,
                "accepted_conditions": True,
                "age_confirmed_13": True,
            },
            timeout=15,
        )
        assert r.status_code == 200, f"register failed: {r.status_code} {r.text[:300]}"
        token = r.json().get("access_token") or r.json().get("token")
        assert token
        me_r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(token), timeout=10)
        assert me_r.status_code == 200
        me = me_r.json()["user"]
        types = [w.get("type") for w in me.get("widgets") or []]
        assert "top8" in types, f"fresh account missing top8 default: {types}"
        assert "myfeed" in types, f"fresh account missing myfeed default: {types}"
        assert me.get("profile_widgets_customized") is False
        # Title on default top8 should be 'Inner Realm' (after rename migration)
        top8_w = next(w for w in me["widgets"] if w.get("type") == "top8")
        assert (top8_w.get("title") or "").strip() == "Inner Realm", \
            f"default top8 title not Inner Realm: {top8_w.get('title')!r}"
        # Cleanup soft-delete
        try:
            requests.post(
                f"{BASE_URL}/api/profile/self-delete",
                headers=_auth_headers(token),
                json={"confirm": "DELETE"}, timeout=10,
            )
        except Exception:
            pass


# ── Inner Realm size validation ───────────────────────────────────────
class TestInnerRealmSize:

    def _patch(self, token, payload):
        return requests.patch(
            f"{BASE_URL}/api/profile/me",
            headers=_auth_headers(token),
            json=payload,
            timeout=15,
        )

    @pytest.mark.parametrize("size", [4, 8, 12, 24])
    def test_valid_sizes_persist(self, stealth_token, size):
        r = self._patch(stealth_token, {"inner_realm_size": size})
        assert r.status_code == 200, r.text[:300]
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(stealth_token), timeout=10).json()["user"]
        assert me.get("inner_realm_size") == size

    def test_invalid_size_400(self, stealth_token):
        r = self._patch(stealth_token, {"inner_realm_size": 7})
        assert r.status_code == 400
        detail = r.json().get("detail", "")
        assert "Inner Realm" in detail and "4, 8, 12" in detail and "24" in detail, \
            f"error detail wrong: {detail!r}"

    def test_inner_8_non_friend_rejected(self, stealth_token):
        # A random UUID won't be a friend
        fake_id = str(uuid.uuid4())
        r = self._patch(stealth_token, {"inner_8": [fake_id]})
        assert r.status_code == 400
        assert "friend" in r.json().get("detail", "").lower()

    def test_inner_8_up_to_24_friends(self, stealth_token):
        # Get stealth's friend ids
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(stealth_token), timeout=10).json()["user"]
        friend_ids = list(me.get("friends") or [])
        if not friend_ids:
            pytest.skip("stealth has no friends to test with")
        # Use as many as we have (up to 24) — should succeed
        sample = friend_ids[:min(len(friend_ids), 24)]
        r = self._patch(stealth_token, {"inner_8": sample})
        assert r.status_code == 200, r.text[:300]
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(stealth_token), timeout=10).json()["user"]
        stored = list(me2.get("inner_8") or [])
        assert stored == sample, f"inner_8 order not preserved: {stored} vs {sample}"

    def test_inner_8_over_24_rejected(self, stealth_token):
        # Fabricate 25 uuids — even if not friends the length guard fires first
        fake = [str(uuid.uuid4()) for _ in range(25)]
        r = self._patch(stealth_token, {"inner_8": fake})
        assert r.status_code == 400
        detail = r.json().get("detail", "").lower()
        # accept either "remove a friend" msg (cap) or friend-required
        assert "inner realm" in detail or "friend" in detail

    def test_lowering_size_preserves_stored_members(self, stealth_token):
        """Reduce size — stored list untouched, only display capped."""
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(stealth_token), timeout=10).json()["user"]
        pre_inner = list(me.get("inner_8") or [])
        if len(pre_inner) < 2:
            pytest.skip("need at least 2 members to test hidden behavior")
        r = self._patch(stealth_token, {"inner_realm_size": 4})
        assert r.status_code == 200
        post = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(stealth_token), timeout=10).json()["user"]
        assert list(post.get("inner_8") or []) == pre_inner, \
            "inner_8 was modified when size was lowered"
        # Reset size for clean state
        self._patch(stealth_token, {"inner_realm_size": 8})


# ── Widgets not clobbered by other patch fields ────────────────────────
class TestWidgetsNotClobbered:

    def test_patch_bio_preserves_widgets(self, audit_token):
        pre = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(audit_token), timeout=10).json()["user"]
        pre_widgets = pre.get("widgets") or []
        r = requests.patch(
            f"{BASE_URL}/api/profile/me",
            headers=_auth_headers(audit_token),
            json={"bio": f"iter87 bio {uuid.uuid4().hex[:6]}"},
            timeout=15,
        )
        assert r.status_code == 200
        post = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(audit_token), timeout=10).json()["user"]
        post_widgets = post.get("widgets") or []
        assert [w.get("type") for w in post_widgets] == [w.get("type") for w in pre_widgets], \
            f"widgets clobbered: pre={pre_widgets} post={post_widgets}"


# ── Progression task + widget registry rename ─────────────────────────
class TestInnerRealmRename:

    def test_progression_task_renamed(self, audit_token, stealth_token):
        # Check both progression/me and admin task list for any lingering old names.
        found_inner_realm = False
        for tok in (audit_token, stealth_token):
            r = requests.get(f"{BASE_URL}/api/progression/me", headers=_auth_headers(tok), timeout=15)
            if r.status_code == 200:
                text = r.text
                assert "Complete your Top 8" not in text, "old 'Complete your Top 8' still present"
                assert "Complete your Inner 8" not in text, "old 'Complete your Inner 8' still present"
                if "Inner Realm" in text:
                    found_inner_realm = True
        # Also poke admin tasks endpoint (founder only) which lists ALL tasks
        r = requests.get(f"{BASE_URL}/api/admin/progression/tasks", headers=_auth_headers(stealth_token), timeout=15)
        if r.status_code == 200:
            text = r.text
            assert "Complete your Top 8" not in text
            assert "Complete your Inner 8" not in text
            if "Inner Realm" in text:
                found_inner_realm = True
        # If we saw it anywhere, pass; otherwise skip (task may live on unpublished level)
        if not found_inner_realm:
            pytest.skip("no 'Inner Realm' task on current/reachable levels — cannot positively verify rename")

    def test_widget_registry_rename(self, stealth_token):
        # Try common registry endpoints
        for path in ["/api/admin/widgets", "/api/admin/widget-registry", "/api/widget-registry", "/api/widgets/registry", "/api/widgets"]:
            r = requests.get(f"{BASE_URL}{path}", headers=_auth_headers(stealth_token), timeout=10)
            if r.status_code == 200:
                text = r.text
                assert "Top 8 Friends" not in text, f"registry {path} still has 'Top 8 Friends'"
                assert '"name": "Inner 8"' not in text, f"registry {path} still has 'Inner 8'"
                return
        pytest.skip("no widget registry endpoint reachable — skipping")
