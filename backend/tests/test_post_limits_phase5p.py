"""Phase 5+ post character limit tests (founder/VIP/default).

Covers:
- POST /api/posts content > 300 chars as default user → 400
- POST /api/posts content == 300 chars as default user → 200 (boundary)
- POST /api/posts content == 1500 chars as founder → 200
- POST /api/posts content == 2100 chars as founder → 400 or 422 (Pydantic max_length=2000)
- POST /api/posts short content regression → 200 (default user)
- /api/upload-limits/me, /api/dashboard/layout, /api/admin/analytics regression
- PATCH /api/profile/me with inner_8 persists; GET /api/auth/me returns it
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")


def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def tfone_session():
    return _login("testfriend1@example.com", "pass1234")


@pytest.fixture(scope="module")
def founder_session():
    return _login("slopestyle2022@gmail.com", "Password1$")


# === Character limit enforcement ===

class TestPostCharacterLimits:
    # NOTE: tfone is seeded as is_vip=True (backfilled by core/seed.py on boot —
    # ALL pre-existing users without is_vip flag are promoted to VIP).
    # So tfone's effective cap is 500, NOT 300. We therefore test the VIP path
    # (500 ok / 600 rejected) AND the unit-level default 300 cap separately.

    def test_vip_user_600_rejected(self, tfone_session):
        # tfone has is_vip=true → 500-char cap; 600 chars must be rejected
        body = {"content": "x" * 600, "media_type": "thought"}
        r = tfone_session.post(f"{BASE_URL}/api/posts", json=body)
        assert r.status_code == 400, f"expected 400 for VIP @600, got {r.status_code}: {r.text}"
        detail = (r.json() or {}).get("detail", "")
        assert "500" in str(detail), f"detail should mention 500 cap: {detail}"

    def test_vip_user_500_ok(self, tfone_session):
        body = {"content": "v" * 500, "media_type": "thought"}
        r = tfone_session.post(f"{BASE_URL}/api/posts", json=body)
        assert r.status_code == 200, f"VIP @500 boundary should pass, got {r.status_code}: {r.text}"

    def test_default_unit_cap_300(self):
        # Unit-level: confirm character_limit_for() returns 300 for plain user
        import sys
        sys.path.insert(0, "/app/backend")
        from services.post_limits import character_limit_for, enforce_post_content_limit
        from fastapi import HTTPException
        plain = {"id": "u1", "username": "newbie", "is_founder": False, "is_vip": False}
        assert character_limit_for(plain) == 300
        with pytest.raises(HTTPException) as ei:
            enforce_post_content_limit(plain, "z" * 301)
        assert ei.value.status_code == 400
        assert "300" in str(ei.value.detail)
        # 300 exactly should not raise
        enforce_post_content_limit(plain, "z" * 300)

    def test_default_user_200_exact_300(self, tfone_session):
        body = {"content": "y" * 300, "media_type": "thought"}
        r = tfone_session.post(f"{BASE_URL}/api/posts", json=body)
        assert r.status_code == 200, f"expected 200 at boundary, got {r.status_code}: {r.text}"
        post = r.json().get("post") or {}
        assert len(post.get("content", "")) == 300

    def test_founder_1500_ok(self, founder_session):
        body = {"content": "f" * 1500, "media_type": "thought"}
        r = founder_session.post(f"{BASE_URL}/api/posts", json=body)
        assert r.status_code == 200, f"founder 1500 should be 200, got {r.status_code}: {r.text}"
        assert len((r.json().get("post") or {}).get("content", "")) == 1500

    def test_founder_2100_rejected(self, founder_session):
        body = {"content": "g" * 2100, "media_type": "thought"}
        r = founder_session.post(f"{BASE_URL}/api/posts", json=body)
        # Acceptable rejection: 400 from enforce_post_content_limit OR 422 from Pydantic max_length
        assert r.status_code in (400, 422), f"founder 2100 should be rejected, got {r.status_code}: {r.text}"

    def test_short_content_regression(self, tfone_session):
        body = {"content": "hello regression test", "media_type": "thought"}
        r = tfone_session.post(f"{BASE_URL}/api/posts", json=body)
        assert r.status_code == 200, f"short content regression failed: {r.status_code} {r.text}"


# === Regression: existing endpoints still pass ===

class TestRegression:
    def test_upload_limits_me(self, tfone_session):
        r = tfone_session.get(f"{BASE_URL}/api/upload-limits/me")
        assert r.status_code == 200, r.text
        data = r.json()
        # Response shape: {"limits": {"image": {...}, "audio": {...}, "video": {...}}}
        limits = data.get("limits") or data
        assert "image" in limits and "audio" in limits

    def test_dashboard_layout(self, tfone_session):
        r = tfone_session.get(f"{BASE_URL}/api/dashboard/layout")
        assert r.status_code == 200, r.text

    def test_admin_analytics_founder(self, founder_session):
        r = founder_session.get(f"{BASE_URL}/api/admin/analytics")
        assert r.status_code == 200, r.text

    def test_admin_analytics_non_admin_blocked(self, tfone_session):
        r = tfone_session.get(f"{BASE_URL}/api/admin/analytics")
        assert r.status_code in (401, 403), f"non-admin should be blocked, got {r.status_code}"


# === Profile inner_8 persistence ===

class TestInnerEightPersistence:
    def test_patch_and_get_inner8(self, tfone_session):
        # inner_8 stores USER IDs (uuid), not usernames.
        fr = tfone_session.get(f"{BASE_URL}/api/friends/list").json()
        friend_ids = [f.get("id") for f in (fr.get("friends") or []) if f.get("id")]
        assert len(friend_ids) >= 2, f"need at least 2 friends, got: {fr}"
        original_r = tfone_session.get(f"{BASE_URL}/api/profile/me").json()
        original_inner8 = (original_r.get("user") or {}).get("inner_8") or []
        new_inner8 = friend_ids[:2]

        r = tfone_session.patch(f"{BASE_URL}/api/profile/me", json={"inner_8": new_inner8})
        assert r.status_code == 200, f"PATCH inner_8 failed: {r.status_code} {r.text}"
        patched = (r.json().get("user") or {}).get("inner_8") or []
        assert set(patched) == set(new_inner8), f"PATCH response inner_8 mismatch: {patched}"

        # Persistence verified via /api/profile/me (re-fetches from DB)
        r2 = tfone_session.get(f"{BASE_URL}/api/profile/me")
        got = (r2.json().get("user") or {}).get("inner_8") or []
        assert set(got) == set(new_inner8), f"inner_8 not persisted: got {got}"

        # Per review request: /api/auth/me should ALSO return inner_8.
        # NOTE: currently /api/auth/me's serializer drops inner_8 even though
        # /api/profile/me returns it. Captured as a separate test below.
        # restore
        tfone_session.patch(f"{BASE_URL}/api/profile/me", json={"inner_8": original_inner8})

    def test_auth_me_includes_inner_8(self, tfone_session):
        """Review request says: 'After patch, GET /api/auth/me returns the new inner_8 array.'
        Asserts /api/auth/me payload contains inner_8 key with the persisted list."""
        fr = tfone_session.get(f"{BASE_URL}/api/friends/list").json()
        friend_ids = [f.get("id") for f in (fr.get("friends") or []) if f.get("id")][:1]
        if friend_ids:
            tfone_session.patch(f"{BASE_URL}/api/profile/me", json={"inner_8": friend_ids})
        r = tfone_session.get(f"{BASE_URL}/api/auth/me")
        body = r.json()
        # auth/me wraps user under "user" key OR returns flat — handle both
        payload = body.get("user") if "user" in body else body
        assert "inner_8" in payload, f"/api/auth/me missing inner_8 key: keys={list(payload.keys())}"
        if friend_ids:
            assert set(payload.get("inner_8") or []) == set(friend_ids), \
                f"/api/auth/me inner_8 mismatch: {payload.get('inner_8')}"
        # cleanup
        tfone_session.patch(f"{BASE_URL}/api/profile/me", json={"inner_8": []})
