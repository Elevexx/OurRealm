"""Video Upload feature tests (Phase 5+).

Covers:
  - GET  /api/upload-limits/me (video block) — testfriend1 numeric, @stealth unlimited
  - POST /api/videos/upload — happy path, file streaming, size/duration/format caps
  - GET  /api/videos/{name} — streams 200 with content-type video/mp4
  - GET  /api/videos/me/list — lists user's uploads
  - Per-day cap (3) — testfriend2 4th upload returns 429
  - POST /api/posts with media_type='video' and uploaded video_url
"""
from __future__ import annotations

import io
import os
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

# Direct mongo client for test isolation (clean prior video uploads for
# testfriend1/testfriend2 so daily-cap and happy-path tests are deterministic).
_MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
_DB_NAME = os.environ.get("DB_NAME", "test_database")

FOUNDER = {"email": "slopestyle2022@gmail.com", "password": "Password1$"}
USER1   = {"email": "testfriend1@example.com", "password": "pass1234"}
USER2   = {"email": "testfriend2@example.com", "password": "pass1234"}

# Minimal stub: ftyp box + random padding (>= 512 bytes per video_store guard).
MP4_HEADER = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    return body.get("access_token") or body.get("token"), body.get("user", {})


@pytest.fixture(scope="session")
def founder_auth():
    tok, user = _login(FOUNDER)
    return tok, user


@pytest.fixture(scope="session")
def user1_auth():
    tok, user = _login(USER1)
    return tok, user


@pytest.fixture(scope="session")
def user2_auth():
    tok, user = _login(USER2)
    return tok, user


@pytest.fixture(scope="session", autouse=True)
def _reset_video_uploads_for_test_users(user1_auth, user2_auth):
    """Wipe the videos collection for testfriend1+2 so prior runs don't
    consume the 24h cap. Spec explicitly allows db.videos.delete_many for
    the test users."""
    _, u1 = user1_auth
    _, u2 = user2_auth
    try:
        client = MongoClient(_MONGO_URL, serverSelectionTimeoutMS=2000)
        db = client[_DB_NAME]
        for uid in (u1.get("id"), u2.get("id")):
            if uid:
                db.videos.delete_many({"user_id": uid})
        client.close()
    except Exception as e:
        pytest.skip(f"Could not reset videos collection: {e}")
    yield


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def make_mp4_stub(size_kb: int = 1) -> bytes:
    """Generate a small fake MP4 with ftyp box + random padding."""
    pad = max(512, size_kb * 1024 - len(MP4_HEADER))
    return MP4_HEADER + os.urandom(pad)


# ─── upload-limits/me reflects new video caps ──────────────────────
class TestUploadLimitsForVideo:
    def test_user1_video_block_per_day_3(self, user1_auth):
        tok, _ = user1_auth
        r = requests.get(f"{BASE_URL}/api/upload-limits/me", headers=H(tok), timeout=15)
        assert r.status_code == 200, r.text
        v = r.json()["limits"]["video"]
        assert v["per_day"] == 3
        assert isinstance(v["used"], int)
        assert isinstance(v["remaining"], int)

    def test_founder_video_unlimited(self, founder_auth):
        tok, _ = founder_auth
        r = requests.get(f"{BASE_URL}/api/upload-limits/me", headers=H(tok), timeout=15)
        assert r.status_code == 200, r.text
        v = r.json()["limits"]["video"]
        assert v["remaining"] == "unlimited"


# ─── happy path upload + serve + list ─────────────────────────────
class TestVideoUploadHappy:
    def test_upload_then_stream_then_list(self, user1_auth):
        tok, _ = user1_auth
        data = make_mp4_stub(1)
        files = {"file": ("clip.mp4", data, "video/mp4")}
        r = requests.post(f"{BASE_URL}/api/videos/upload", headers=H(tok), files=files, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        body = r.json()
        assert "video" in body and "url" in body
        v = body["video"]
        assert v["ext"] == "mp4"
        assert v["bytes"] == len(data)
        assert v["url"].startswith("/api/videos/") and v["url"].endswith(".mp4")
        # 32-hex stem
        name = v["url"].rsplit("/", 1)[-1]
        stem = name.rsplit(".", 1)[0]
        assert len(stem) == 32 and all(c in "abcdef0123456789" for c in stem)

        # GET stream — no auth required (CDN-style)
        r2 = requests.get(f"{BASE_URL}{v['url']}", timeout=30)
        assert r2.status_code == 200, r2.status_code
        assert r2.headers.get("content-type") == "video/mp4"
        assert len(r2.content) == len(data)

        # /me/list contains it
        r3 = requests.get(f"{BASE_URL}/api/videos/me/list", headers=H(tok), timeout=20)
        assert r3.status_code == 200, r3.text
        ids = [it["id"] for it in r3.json().get("videos", [])]
        assert v["id"] in ids


# ─── size and duration caps ───────────────────────────────────────
class TestVideoCaps:
    def test_oversize_returns_413(self, user1_auth):
        tok, _ = user1_auth
        # 101 MB to trip the 100 MB cap
        big = MP4_HEADER + os.urandom(101 * 1024 * 1024 - len(MP4_HEADER))
        files = {"file": ("huge.mp4", big, "video/mp4")}
        r = requests.post(f"{BASE_URL}/api/videos/upload", headers=H(tok), files=files, timeout=300)
        assert r.status_code == 413, f"expected 413 got {r.status_code} {r.text[:300]}"
        detail = (r.json().get("detail") or "")
        assert "100 MB" in detail, detail

    def test_duration_over_60_rejected(self, user1_auth):
        tok, _ = user1_auth
        data = make_mp4_stub(1)
        files = {"file": ("clip.mp4", data, "video/mp4")}
        r = requests.post(
            f"{BASE_URL}/api/videos/upload",
            headers=H(tok),
            files=files,
            data={"duration": "75"},
            timeout=30,
        )
        assert r.status_code == 400, f"{r.status_code} {r.text[:300]}"
        detail = (r.json().get("detail") or "").lower()
        assert "60" in detail and "second" in detail, detail

    def test_duration_under_60_accepted(self, user1_auth):
        tok, _ = user1_auth
        data = make_mp4_stub(1)
        files = {"file": ("clip.mp4", data, "video/mp4")}
        r = requests.post(
            f"{BASE_URL}/api/videos/upload",
            headers=H(tok),
            files=files,
            data={"duration": "45"},
            timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"

    def test_unsupported_format_jpeg_returns_400(self, user1_auth):
        tok, _ = user1_auth
        # bogus content but image mime + .jpg name — should be rejected as unsupported video
        data = os.urandom(2048)
        files = {"file": ("not_a_video.jpg", data, "image/jpeg")}
        r = requests.post(f"{BASE_URL}/api/videos/upload", headers=H(tok), files=files, timeout=30)
        assert r.status_code == 400, f"{r.status_code} {r.text[:300]}"
        detail = (r.json().get("detail") or "")
        assert "Unsupported video format" in detail, detail
        assert "MP4" in detail and "MOV" in detail and "WebM" in detail


# ─── daily-limit enforcement — testfriend2 4th upload 429 ─────────
class TestDailyCap:
    def test_4th_upload_in_24h_is_429(self, user2_auth):
        tok, user = user2_auth
        # Best-effort: reset by checking how many are already there in 24h.
        # If user2 already has >= 3 in last 24h, we still expect 429 on next upload.
        # Upload up to 3 small files (skip if already at cap).
        r0 = requests.get(f"{BASE_URL}/api/upload-limits/me", headers=H(tok), timeout=15)
        assert r0.status_code == 200
        used = r0.json()["limits"]["video"]["used"]
        remaining = r0.json()["limits"]["video"]["remaining"]
        # Upload until we hit the cap
        uploads_needed = max(0, 3 - used)
        for i in range(uploads_needed):
            data = make_mp4_stub(1)
            files = {"file": (f"c{i}.mp4", data, "video/mp4")}
            r = requests.post(f"{BASE_URL}/api/videos/upload", headers=H(tok), files=files, timeout=60)
            assert r.status_code == 200, f"upload {i} failed: {r.status_code} {r.text[:200]}"

        # Now the next one should be 429
        data = make_mp4_stub(1)
        files = {"file": ("over.mp4", data, "video/mp4")}
        r = requests.post(f"{BASE_URL}/api/videos/upload", headers=H(tok), files=files, timeout=60)
        assert r.status_code == 429, f"expected 429 got {r.status_code} {r.text[:300]}"
        detail = (r.json().get("detail") or "")
        assert "Daily video upload limit reached" in detail, detail
        assert "3 per 24h" in detail, detail


# ─── post creation with uploaded video_url ────────────────────────
class TestPostWithUploadedVideo:
    def test_post_create_with_video(self, user1_auth):
        tok, _ = user1_auth
        # Upload first
        data = make_mp4_stub(1)
        files = {"file": ("post_vid.mp4", data, "video/mp4")}
        r = requests.post(f"{BASE_URL}/api/videos/upload", headers=H(tok), files=files, timeout=30)
        if r.status_code == 429:
            pytest.skip("user1 over 24h cap — skipping post-with-video test")
        assert r.status_code == 200, r.text
        url = r.json()["url"]

        # Now create a post referencing it
        payload = {"content": "vid", "media_type": "video", "video_url": url}
        rp = requests.post(f"{BASE_URL}/api/posts", headers=H(tok), json=payload, timeout=20)
        assert rp.status_code in (200, 201), f"{rp.status_code} {rp.text[:300]}"
        body = rp.json()
        post = body.get("post", body)  # API may wrap in {post: {...}}
        assert post.get("video_url") == url, post

        # GET /api/posts should return it
        rl = requests.get(f"{BASE_URL}/api/posts", headers=H(tok), timeout=20)
        assert rl.status_code == 200
        rl_body = rl.json()
        posts = rl_body if isinstance(rl_body, list) else rl_body.get("posts", [])
        match = next((p for p in posts if p.get("id") == post["id"]), None)
        assert match is not None, "newly created post not in feed list"
        assert match.get("video_url") == url, match
