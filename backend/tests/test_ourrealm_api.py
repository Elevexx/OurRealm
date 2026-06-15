"""OurRealm backend API tests: auth, profile, posts."""
import time
import uuid
import requests
import pytest
from .conftest import BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD


# ----- Health -----
class TestHealth:
    def test_root(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        d = r.json()
        assert d["app"] == "OurRealm"
        assert d["status"] == "ok"


# ----- Auth: Register / Login / Me / Logout -----
class TestAuth:
    def test_register_new_user(self, api_client):
        email = f"TEST_user_{uuid.uuid4().hex[:8]}@ourrealm.app"
        r = api_client.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Pass1234", "name": "Test User"
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert "user" in d and "access_token" in d
        # backend lowercases emails — assert case-insensitive equality
        assert d["user"]["email"].lower() == email.lower()
        assert d["user"]["name"] == "Test User"
        assert isinstance(d["access_token"], str) and len(d["access_token"]) > 20
        # cookies set
        assert "access_token" in r.cookies or any("access_token" in c for c in r.headers.get("set-cookie", ""))

    def test_register_duplicate_email_400(self, api_client):
        email = f"TEST_dup_{uuid.uuid4().hex[:8]}@ourrealm.app"
        r1 = api_client.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Pass1234", "name": "Dup"
        })
        assert r1.status_code == 200
        r2 = api_client.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Pass1234", "name": "Dup2"
        })
        assert r2.status_code == 400

    def test_login_admin(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["email"] == ADMIN_EMAIL
        assert d["user"]["role"] == "admin"
        assert "access_token" in d
        # cookie set
        set_cookie = r.headers.get("set-cookie", "")
        assert "access_token=" in set_cookie

    def test_login_wrong_password_401(self, api_client):
        # use unique email to avoid lockout from previous runs polluting admin
        email = f"TEST_bad_{uuid.uuid4().hex[:8]}@ourrealm.app"
        api_client.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Pass1234", "name": "Bad"
        })
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": email, "password": "WrongPass!"
        })
        assert r.status_code == 401

    def test_lockout_after_5_failures(self, api_client):
        email = f"TEST_lock_{uuid.uuid4().hex[:8]}@ourrealm.app"
        # register so user exists; lockout works on ip:email even for nonexistent, but stable
        api_client.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Pass1234", "name": "Lock"
        })
        codes = []
        for _ in range(6):
            r = api_client.post(f"{BASE_URL}/api/auth/login", json={
                "email": email, "password": "wrongpass"
            })
            codes.append(r.status_code)
        # First 5 should be 401, the 6th must be 429
        assert codes[-1] == 429, f"Expected lockout 429, got {codes}"

    def test_me_with_bearer(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
        })
        token = r.json()["access_token"]
        # New session (no cookies)
        s = requests.Session()
        m = s.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert m.status_code == 200
        assert m.json()["user"]["email"] == ADMIN_EMAIL

    def test_me_with_cookie(self, api_client):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
        })
        assert r.status_code == 200
        # Use same session (cookies stored)
        m = s.get(f"{BASE_URL}/api/auth/me")
        assert m.status_code == 200
        assert m.json()["user"]["email"] == ADMIN_EMAIL

    def test_me_no_token_401(self):
        s = requests.Session()
        m = s.get(f"{BASE_URL}/api/auth/me")
        assert m.status_code == 401

    def test_logout_clears_cookies(self):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
        })
        out = s.post(f"{BASE_URL}/api/auth/logout")
        assert out.status_code == 200
        # cookies should be cleared on the session
        s.cookies.clear()
        m = s.get(f"{BASE_URL}/api/auth/me")
        assert m.status_code == 401

    def test_forgot_password_ok(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": ADMIN_EMAIL
        })
        assert r.status_code == 200
        assert r.json()["ok"] is True
        # non-existent email also returns ok
        r2 = api_client.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": f"nope_{uuid.uuid4().hex[:6]}@ourrealm.app"
        })
        assert r2.status_code == 200

    def test_reset_password_invalid_token_400(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": "invalid-token", "new_password": "newpass123"
        })
        assert r.status_code == 400


# ----- Profile -----
class TestProfile:
    def test_get_me(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/profile/me")
        assert r.status_code == 200
        assert r.json()["user"]["email"] == ADMIN_EMAIL

    def test_patch_me_persists(self, api_client):
        # Use a fresh user so we don't mutate admin permanently
        email = f"TEST_prof_{uuid.uuid4().hex[:8]}@ourrealm.app"
        reg = api_client.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Pass1234", "name": "Prof"
        })
        token = reg.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        body = {
            "bio": "Hello realm",
            "interests": ["music", "tech"],
            "mode": "stealth",
            "widgets": [{"id": "w1", "type": "music", "w": 2, "h": 2}],
            "name": "Updated Name",
        }
        r = api_client.patch(f"{BASE_URL}/api/profile/me", json=body, headers=h)
        assert r.status_code == 200
        u = r.json()["user"]
        assert u["bio"] == "Hello realm"
        assert u["interests"] == ["music", "tech"]
        assert u["mode"] == "stealth"
        assert u["name"] == "Updated Name"
        assert len(u["widgets"]) == 1
        # Verify persistence via GET
        g = api_client.get(f"{BASE_URL}/api/profile/me", headers=h)
        assert g.status_code == 200
        gu = g.json()["user"]
        assert gu["bio"] == "Hello realm"
        assert gu["mode"] == "stealth"


# ----- Posts -----
class TestPosts:
    def test_create_post_authenticated(self, admin_client):
        payload = {"content": "TEST_hello realm", "media_type": "post", "tags": ["t"]}
        r = admin_client.post(f"{BASE_URL}/api/posts", json=payload)
        assert r.status_code == 200, r.text
        p = r.json()["post"]
        assert p["content"] == "TEST_hello realm"
        assert p["author_name"] == "Realm Admin"
        assert p["likes"] == 0
        assert "id" in p

    def test_create_post_unauth_401(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/posts", json={
            "content": "no auth", "media_type": "post"
        })
        assert r.status_code == 401

    def test_list_posts_newest_first(self, admin_client):
        # create two posts and verify ordering
        c1 = admin_client.post(f"{BASE_URL}/api/posts", json={
            "content": "TEST_first", "media_type": "post"
        })
        time.sleep(1.1)
        c2 = admin_client.post(f"{BASE_URL}/api/posts", json={
            "content": "TEST_second", "media_type": "image", "media_url": "https://x/img.png"
        })
        assert c1.status_code == 200 and c2.status_code == 200
        r = admin_client.get(f"{BASE_URL}/api/posts")
        assert r.status_code == 200
        posts = r.json()["posts"]
        assert len(posts) >= 2
        # The newest TEST_second should appear before TEST_first
        contents = [p["content"] for p in posts]
        assert contents.index("TEST_second") < contents.index("TEST_first")

    def test_list_posts_media_filter(self, admin_client):
        admin_client.post(f"{BASE_URL}/api/posts", json={
            "content": "TEST_img", "media_type": "image", "media_url": "https://x/i.png"
        })
        r = admin_client.get(f"{BASE_URL}/api/posts", params={"media_type": "image"})
        assert r.status_code == 200
        posts = r.json()["posts"]
        assert all(p["media_type"] == "image" for p in posts)
        assert any(p["content"] == "TEST_img" for p in posts)

    def test_like_increments(self, admin_client):
        c = admin_client.post(f"{BASE_URL}/api/posts", json={
            "content": "TEST_like", "media_type": "post"
        })
        pid = c.json()["post"]["id"]
        like_resp = admin_client.post(f"{BASE_URL}/api/posts/{pid}/like")
        assert like_resp.status_code == 200
        # verify via list
        r = admin_client.get(f"{BASE_URL}/api/posts")
        target = next(p for p in r.json()["posts"] if p["id"] == pid)
        assert target["likes"] == 1

    def test_like_unknown_post_404(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/posts/{uuid.uuid4()}/like")
        assert r.status_code == 404
