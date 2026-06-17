"""Backend regression tests for OurRealm launch fixes (iter 13).
Covers: dashboard sync, profile avatar PATCH, image upload + from-url,
register flow used by SignUp→/interests, and regression smoke endpoints.
"""
import os
import io
import time
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def tfone():
    return _login("testfriend1@example.com", "pass1234")


@pytest.fixture(scope="module")
def tftwo():
    return _login("testfriend2@example.com", "pass1234")


# ── Regression smoke ─────────────────────────────────────────────────
class TestRegressionSmoke:
    def test_auth_me(self, tfone):
        r = tfone.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        body = r.json()
        u = body.get("user", body)
        assert u.get("username") == "tfone"

    def test_posts_list(self, tfone):
        r = tfone.get(f"{API}/posts", timeout=15)
        assert r.status_code == 200
        assert "posts" in r.json()

    def test_messages_threads(self, tfone):
        r = tfone.get(f"{API}/messages/threads", timeout=15)
        assert r.status_code == 200

    def test_upload_limits(self, tfone):
        r = tfone.get(f"{API}/upload-limits/me", timeout=15)
        assert r.status_code == 200

    def test_dashboard_layout_get(self, tfone):
        r = tfone.get(f"{API}/dashboard/layout", timeout=15)
        assert r.status_code == 200
        assert "widgets" in r.json()


# ── Signup → /interests flow ─────────────────────────────────────────
class TestRegisterCompliance:
    def test_register_with_all_4_booleans(self):
        u = f"test_iter13_{uuid.uuid4().hex[:8]}"
        payload = {
            "email": f"{u}@example.com",
            "password": "pass1234",
            "name": "Iter13 Test",
            "username": u,
            "accepted_terms": True,
            "accepted_privacy": True,
            "accepted_conditions": True,
            "age_confirmed_13": True,
            "policy_version": "2026-02-1",
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=20)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        body = r.json()
        # new user must come back with username for downstream redirect
        user = body.get("user", body)
        assert user.get("username", "").lower() == u.lower()

    def test_register_missing_compliance_rejected(self):
        u = f"test_iter13_bad_{uuid.uuid4().hex[:8]}"
        payload = {
            "email": f"{u}@example.com",
            "password": "pass1234",
            "name": "Bad",
            "username": u,
            "accepted_terms": True,
            "accepted_privacy": False,  # missing one
            "accepted_conditions": True,
            "age_confirmed_13": True,
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=20)
        assert r.status_code == 400


# ── Dashboard widget save sync ───────────────────────────────────────
class TestDashboardSync:
    def test_put_layout_returns_widgets(self, tfone):
        widgets = [
            {"id": "for_you_feed-iter13a", "type": "for_you_feed",
             "visibility": "public", "size": "md", "config": {}},
            {"id": "weather-iter13b", "type": "weather",
             "visibility": "private", "size": "sm", "config": {}},
        ]
        r = tfone.put(f"{API}/dashboard/layout", json={"widgets": widgets}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data.get("widgets"), list)
        # response must echo the widgets back so the UI can sync state
        ids = {w["id"] for w in data["widgets"]}
        assert "for_you_feed-iter13a" in ids
        # verify visibility round-trips
        by_id = {w["id"]: w for w in data["widgets"]}
        assert by_id["for_you_feed-iter13a"].get("visibility") == "public"
        assert by_id["weather-iter13b"].get("visibility") == "private"

    def test_layout_persisted_on_reload(self, tfone):
        r = tfone.get(f"{API}/dashboard/layout", timeout=15)
        assert r.status_code == 200
        ids = {w["id"] for w in r.json().get("widgets", [])}
        assert "for_you_feed-iter13a" in ids

    def test_change_visibility_persists(self, tfone):
        # Flip the for_you widget to friends and verify on reload
        cur = tfone.get(f"{API}/dashboard/layout", timeout=15).json()["widgets"]
        for w in cur:
            if w["id"] == "for_you_feed-iter13a":
                w["visibility"] = "friends"
        r = tfone.put(f"{API}/dashboard/layout", json={"widgets": cur}, timeout=15)
        assert r.status_code == 200
        echoed = {w["id"]: w for w in r.json()["widgets"]}
        assert echoed["for_you_feed-iter13a"]["visibility"] == "friends"
        # GET again — must still be friends
        reloaded = tfone.get(f"{API}/dashboard/layout", timeout=15).json()["widgets"]
        by_id = {w["id"]: w for w in reloaded}
        assert by_id["for_you_feed-iter13a"]["visibility"] == "friends"


# ── Avatar upload + URL flow ─────────────────────────────────────────
def _tiny_png() -> bytes:
    # Use PIL to generate a valid 64x64 PNG so backend image validators accept it.
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (123, 200, 80)).save(buf, format="PNG")
    return buf.getvalue()


class TestAvatarFlow:
    def test_profile_patch_avatar_url(self, tfone):
        # Direct PATCH with a known URL
        url = "https://www.gstatic.com/webp/gallery/1.webp"
        r = tfone.patch(f"{API}/profile/me", json={"avatar_url": url}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        u = body.get("user", body)
        assert u.get("avatar_url") == url
        # Verify via GET /auth/me
        me = tfone.get(f"{API}/auth/me", timeout=15).json()
        assert (me.get("user", me)).get("avatar_url") == url

    def test_images_from_url_endpoint(self, tfone):
        r = tfone.post(
            f"{API}/images/from-url",
            json={"url": "https://www.gstatic.com/webp/gallery/1.webp"},
            timeout=30,
        )
        # Endpoint should return a JSON with url or image.original_url
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        data = r.json()
        next_url = data.get("url") or (data.get("image") or {}).get("original_url")
        assert next_url, f"no url in response: {data}"

    def test_images_upload_endpoint(self, tfone):
        files = {"file": ("tiny.png", io.BytesIO(_tiny_png()), "image/png")}
        # Strip JSON content-type that the session may have inherited
        s = requests.Session()
        s.headers.update(tfone.headers)
        s.headers.pop("Content-Type", None)
        r = s.post(f"{API}/images/upload", files=files, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        data = r.json()
        next_url = data.get("url") or (data.get("image") or {}).get("original_url")
        assert next_url


# ── Post management non-owner regression (mobile menu hidden) ────────
class TestNonOwnerPostManagement:
    def test_tftwo_cannot_delete_tfone_post(self, tfone, tftwo):
        # Create a post owned by tfone
        r = tfone.post(f"{API}/posts", json={"content": "TEST_iter13_owner", "media_type": "thought"}, timeout=15)
        assert r.status_code in (200, 201), r.text
        pid = (r.json().get("post") or r.json()).get("id")
        try:
            # tftwo (non-owner, non-founder) tries to delete → 403
            d = tftwo.delete(f"{API}/posts/{pid}", timeout=15)
            assert d.status_code in (403, 401)
        finally:
            tfone.delete(f"{API}/posts/{pid}", timeout=15)
