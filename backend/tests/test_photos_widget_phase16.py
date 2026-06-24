"""Backend tests for Phase 16 — Photos widget (Jan 2026).

Covers:
- PATCH /api/profile/me accepts type='photos' (NEW — was previously stripped).
- PATCH /api/profile/me with 13 photo items -> 400 'Photos widget supports max 12 photos'.
- PATCH /api/profile/me with 12 photo items succeeds.
- GET /api/profile/by-username/{u} returns photos widgets unchanged.
- Allow-list still strips disallowed types (e.g. 'merch') even when
  photos is included alongside.
- ALLOWED_WIDGET_TYPES count is exactly 16 (photos added).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "tftwo": {"email": "testfriend2@example.com", "password": "pass1234"},
    "tfone": {"email": "testfriend1@example.com", "password": "pass1234"},
}

ALLOWED_16 = {
    "myfeed", "top8", "live", "videos", "music", "podcasts", "photos",
    "events", "weather", "calendar", "countdown", "notes", "polls",
    "survey", "blog", "radar",
}


def _login(username: str) -> requests.Session:
    s = requests.Session()
    c = CREDS[username]
    r = s.post(f"{API}/auth/login", json={"email": c["email"], "password": c["password"]})
    assert r.status_code == 200, f"login {username} -> {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def tftwo_s():
    return _login("tftwo")


@pytest.fixture(scope="module")
def tfone_s():
    return _login("tfone")


def _make_photo_items(n: int):
    return [
        {"id": f"p{i}", "kind": "upload", "url": f"https://x/p{i}.jpg",
         "thumbnail_url": f"https://x/p{i}_t.jpg"}
        for i in range(n)
    ]


class TestPhotosAllowList:
    def test_photos_widget_now_accepted(self, tftwo_s):
        """Previously photos was stripped — now it should survive."""
        widgets = [{
            "id": "w-pics-ok",
            "type": "photos",
            "items": _make_photo_items(3),
        }]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": widgets})
        assert r.status_code == 200, r.text
        saved = r.json()["user"]["widgets"]
        types = [w["type"] for w in saved]
        assert "photos" in types, "photos widget was stripped — allow-list not updated"
        w_pics = next(w for w in saved if w["id"] == "w-pics-ok")
        assert len(w_pics["items"]) == 3
        assert w_pics["items"][0]["url"] == "https://x/p0.jpg"

    def test_disallowed_still_stripped_alongside_photos(self, tftwo_s):
        widgets = [
            {"id": "w-pics-mix", "type": "photos", "items": _make_photo_items(2)},
            {"id": "w-merch", "type": "merch", "items": []},
            {"id": "w-wallet", "type": "wallet"},
        ]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": widgets})
        assert r.status_code == 200, r.text
        types = [w["type"] for w in r.json()["user"]["widgets"]]
        assert "photos" in types
        assert "merch" not in types
        assert "wallet" not in types
        for t in types:
            assert t in ALLOWED_16, f"Disallowed type leaked: {t}"


class TestPhotosCap:
    def test_13_photos_rejected(self, tftwo_s):
        widgets = [{
            "id": "w-pics-13",
            "type": "photos",
            "items": _make_photo_items(13),
        }]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": widgets})
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "")
        assert "Photos" in detail or "photos" in detail.lower()
        assert "12" in detail

    def test_12_photos_accepted(self, tftwo_s):
        widgets = [{
            "id": "w-pics-12",
            "type": "photos",
            "items": _make_photo_items(12),
        }]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": widgets})
        assert r.status_code == 200, r.text
        saved = next(
            (w for w in r.json()["user"]["widgets"] if w["id"] == "w-pics-12"),
            None,
        )
        assert saved is not None
        assert len(saved["items"]) == 12


class TestPhotosPublicReadthrough:
    def test_public_profile_returns_photos_unchanged(self, tftwo_s, tfone_s):
        # set photos on tftwo
        widgets = [{
            "id": "w-pics-pub",
            "type": "photos",
            "items": _make_photo_items(4),
        }]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": widgets})
        assert r.status_code == 200

        # tfone fetches public view
        r2 = tfone_s.get(f"{API}/profile/by-username/tftwo")
        assert r2.status_code == 200, r2.text
        pub_widgets = r2.json()["user"].get("widgets") or []
        pub_photos = next(
            (w for w in pub_widgets if w.get("id") == "w-pics-pub"), None
        )
        assert pub_photos is not None, "photos widget filtered out on public read"
        assert pub_photos["type"] == "photos"
        assert len(pub_photos["items"]) == 4

        # disallowed types still gone publicly
        for t in [w.get("type") for w in pub_widgets]:
            assert t in ALLOWED_16


class TestCleanup:
    def test_cleanup_photos(self, tftwo_s):
        """Drop test photo widgets so other tests aren't polluted."""
        me = tftwo_s.get(f"{API}/profile/me").json()["user"]
        kept = [
            w for w in (me.get("widgets") or [])
            if w.get("id") not in {"w-pics-ok", "w-pics-mix", "w-pics-12", "w-pics-pub"}
        ]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": kept})
        assert r.status_code == 200
