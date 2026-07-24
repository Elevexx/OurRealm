"""
Iter88 - Guest browsing removal QA.
Verifies the global_auth_guard middleware:
  - Anonymous /api/* protected endpoints return 401
  - Public allow-list still works anonymously
  - Authenticated requests (Bearer token) work normally
  - /api/v1/* alias also enforces auth
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

# Endpoints that must return 401 for anonymous callers
PROTECTED_GET = [
    "/posts",
    "/hashtags/trending",
    "/users/featured",
    "/users/newest",
    "/communities/realms",
    "/faq",
    "/website-media/published",
    "/auth/me",
    "/announcements/pinned",
    "/profile/by-username/stealth",
]

# v1 alias must also enforce
V1_ALIAS_GET = ["/v1/posts", "/v1/hashtags/trending", "/v1/auth/me"]


# ─── Anonymous protected endpoints must 401 ───────────────────────────
class TestAnonymousProtected:
    @pytest.mark.parametrize("path", PROTECTED_GET)
    def test_get_returns_401(self, path):
        r = requests.get(f"{API}{path}", timeout=15)
        assert r.status_code == 401, (
            f"GET {path} expected 401 anonymous; got {r.status_code} body={r.text[:200]}"
        )

    @pytest.mark.parametrize("path", V1_ALIAS_GET)
    def test_v1_alias_returns_401(self, path):
        r = requests.get(f"{API}{path}", timeout=15)
        assert r.status_code == 401, (
            f"GET /api{path} expected 401 anonymous; got {r.status_code} body={r.text[:200]}"
        )

    def test_random_protected_id_returns_401(self):
        # GET /api/posts/{id} — must not leak existence, must 401 first
        r = requests.get(f"{API}/posts/does-not-exist", timeout=15)
        assert r.status_code == 401, f"expected 401 anon; got {r.status_code}"

    def test_fire_status_returns_401(self):
        # Fire endpoint variants — check whichever exists returns 401 anon
        for p in ("/fire/status", "/fire/wallet", "/fire/me"):
            r = requests.get(f"{API}{p}", timeout=15)
            # 401 required if the endpoint exists; 404 is acceptable only if not registered
            if r.status_code == 404:
                continue
            assert r.status_code == 401, f"GET {p} expected 401; got {r.status_code}"


# ─── Public allow-list still works anonymously ─────────────────────────
class TestAnonymousPublic:
    def test_health_root(self):
        r = requests.get(f"{API}/", timeout=15)
        assert r.status_code == 200

    def test_username_check(self):
        r = requests.post(
            f"{API}/auth/username/check",
            json={"username": f"unlikely_{uuid.uuid4().hex[:8]}"},
            timeout=15,
        )
        assert r.status_code == 200, f"got {r.status_code} body={r.text[:200]}"

    def test_forgot_password_returns_200(self):
        r = requests.post(
            f"{API}/auth/forgot-password",
            json={"email": "nonexistent@example.com"},
            timeout=15,
        )
        assert r.status_code in (200, 202), (
            f"forgot-password expected 200/202; got {r.status_code}"
        )

    def test_login_public(self):
        # login endpoint must be reachable anonymously - wrong creds return 401/400,
        # but not blocked by middleware
        r = requests.post(
            f"{API}/auth/login",
            json={"email": "definitely_not_a_user_xyz", "password": "xxxxxxxx"},
            timeout=15,
        )
        # any non-403-middleware status is fine; must NOT be blocked before handler
        assert r.status_code in (400, 401, 404, 422), (
            f"login should reach handler; got {r.status_code}"
        )


# ─── Authenticated requests still work ─────────────────────────────────
@pytest.fixture(scope="module")
def stealth_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "stealth", "password": "Password1$"},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed status={r.status_code} body={r.text[:200]}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"no token in login response: {list(data.keys())}"
    return token


class TestAuthenticated:
    def test_auth_me(self, stealth_token):
        r = requests.get(f"{API}/auth/me",
                         headers={"Authorization": f"Bearer {stealth_token}"},
                         timeout=15)
        assert r.status_code == 200
        data = r.json()
        # /auth/me returns {user: {...}} wrapper
        u = data.get("user", data)
        assert u.get("username") == "stealth"

    def test_posts_list(self, stealth_token):
        r = requests.get(f"{API}/posts",
                         headers={"Authorization": f"Bearer {stealth_token}"},
                         timeout=15)
        assert r.status_code == 200

    def test_profile_by_username(self, stealth_token):
        r = requests.get(f"{API}/profile/by-username/stealth",
                         headers={"Authorization": f"Bearer {stealth_token}"},
                         timeout=15)
        assert r.status_code == 200
        data = r.json()
        u = data.get("user", data)
        assert u.get("username") == "stealth"

    def test_hashtags_trending(self, stealth_token):
        r = requests.get(f"{API}/hashtags/trending",
                         headers={"Authorization": f"Bearer {stealth_token}"},
                         timeout=15)
        assert r.status_code == 200

    def test_users_featured(self, stealth_token):
        r = requests.get(f"{API}/users/featured",
                         headers={"Authorization": f"Bearer {stealth_token}"},
                         timeout=15)
        assert r.status_code == 200

    def test_v1_alias_authenticated(self, stealth_token):
        r = requests.get(f"{API}/v1/posts",
                         headers={"Authorization": f"Bearer {stealth_token}"},
                         timeout=15)
        assert r.status_code == 200
        assert r.headers.get("X-API-Version") == "v1"
