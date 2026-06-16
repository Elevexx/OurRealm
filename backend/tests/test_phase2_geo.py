"""Phase-2 backend tests: ZIP code, presence indicator, radius filter, Top 8 auto-save."""
import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tfone_token():
    return _login("testfriend1@example.com", "pass1234")


@pytest.fixture(scope="module")
def tftwo_token():
    return _login("testfriend2@example.com", "pass1234")


@pytest.fixture(scope="module")
def stealth_token():
    return _login("stealth", "Password1$")


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ── ZIP code ────────────────────────────────────────────────────────────
class TestZipCode:
    def test_set_valid_zip(self, tfone_token):
        r = requests.patch(f"{BASE_URL}/api/profile/me", headers=_h(tfone_token),
                           json={"zip_code": "10001"})
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert u["zip_code"] == "10001"
        assert u.get("presence_visible") is True

    def test_invalid_zip_returns_400(self, tfone_token):
        r = requests.patch(f"{BASE_URL}/api/profile/me", headers=_h(tfone_token),
                           json={"zip_code": "abcde"})
        assert r.status_code == 400
        assert "5-digit" in r.json().get("detail", "")

    def test_get_me_shows_zip(self, tfone_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tfone_token))
        assert r.status_code == 200
        u = r.json().get("user", r.json())
        assert u.get("zip_code") == "10001"

    def test_public_profile_redacts_zip(self):
        r = requests.get(f"{BASE_URL}/api/profile/by-username/tfone")
        assert r.status_code == 200
        u = r.json()["user"]
        # zip_code MUST be absent OR null
        assert ("zip_code" not in u) or (u.get("zip_code") is None)

    def test_clear_zip_with_empty_string(self, tftwo_token):
        # Ensure tftwo has NO ZIP for later tests
        r = requests.patch(f"{BASE_URL}/api/profile/me", headers=_h(tftwo_token),
                           json={"zip_code": ""})
        assert r.status_code == 200
        u = r.json()["user"]
        assert u.get("zip_code") in (None, "")


# ── Presence visibility ─────────────────────────────────────────────────
class TestPresence:
    def test_toggle_off(self, tfone_token):
        r = requests.patch(f"{BASE_URL}/api/profile/me", headers=_h(tfone_token),
                           json={"presence_visible": False})
        assert r.status_code == 200
        assert r.json()["user"]["presence_visible"] is False
        # confirm via /auth/me
        r2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tfone_token))
        u = r2.json().get("user", r2.json())
        assert u["presence_visible"] is False

    def test_toggle_back_on(self, tfone_token):
        r = requests.patch(f"{BASE_URL}/api/profile/me", headers=_h(tfone_token),
                           json={"presence_visible": True})
        assert r.status_code == 200
        assert r.json()["user"]["presence_visible"] is True


# ── Radius filter (posts) ───────────────────────────────────────────────
class TestRadius:
    def test_post_creation_snapshots_coords(self, tfone_token):
        # ensure ZIP is set
        requests.patch(f"{BASE_URL}/api/profile/me", headers=_h(tfone_token),
                       json={"zip_code": "10001"})
        r = requests.post(f"{BASE_URL}/api/posts", headers=_h(tfone_token),
                          json={"content": "TEST_radius_post_phase2", "media_type": "thought"})
        assert r.status_code == 200, r.text
        p = r.json()["post"]
        # Private fields should be stripped from response
        assert "author_zip" not in p
        assert "author_lat" not in p

    def test_radius_20_with_zip_returns_own_post(self, tfone_token):
        r = requests.get(f"{BASE_URL}/api/posts?radius=20&viewer=tfone")
        assert r.status_code == 200, r.text
        posts = r.json()["posts"]
        # Should contain the test post we just made
        contents = [p.get("content", "") for p in posts]
        assert any("TEST_radius_post_phase2" in c for c in contents), \
            f"Expected radius post in results: {contents[:5]}"

    def test_radius_without_viewer_zip_returns_400(self, tftwo_token):
        # tftwo has no zip — and we pass viewer=tftwo
        r = requests.get(f"{BASE_URL}/api/posts?radius=10&viewer=tftwo")
        assert r.status_code == 400
        assert "ZIP" in r.json().get("detail", "")

    def test_radius_any_normal(self):
        r = requests.get(f"{BASE_URL}/api/posts?radius=any")
        assert r.status_code == 200
        assert isinstance(r.json()["posts"], list)

    def test_no_radius_normal(self):
        r = requests.get(f"{BASE_URL}/api/posts")
        assert r.status_code == 200
        assert isinstance(r.json()["posts"], list)


# ── Top 8 auto-save ─────────────────────────────────────────────────────
class TestTop8:
    def test_add_friend_to_inner8(self, tfone_token, stealth_token):
        # find stealth's user_id
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(stealth_token))
        stealth_id = r.json().get("user", r.json())["id"]
        r2 = requests.patch(f"{BASE_URL}/api/profile/me", headers=_h(tfone_token),
                            json={"inner_8": [stealth_id]})
        assert r2.status_code == 200, r2.text
        assert stealth_id in r2.json()["user"]["inner_8"]
        # confirm persisted
        r3 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tfone_token))
        u = r3.json().get("user", r3.json())
        assert stealth_id in u["inner_8"]

    def test_non_friend_rejected(self, tfone_token):
        # use a fake id
        r = requests.patch(f"{BASE_URL}/api/profile/me", headers=_h(tfone_token),
                           json={"inner_8": ["00000000-0000-0000-0000-000000000000"]})
        assert r.status_code == 400

    def test_more_than_8_rejected(self, tfone_token):
        ids = [f"id-{i}" for i in range(9)]
        r = requests.patch(f"{BASE_URL}/api/profile/me", headers=_h(tfone_token),
                           json={"inner_8": ids})
        assert r.status_code == 400
        assert "Inner 8" in r.json().get("detail", "")
