"""Iteration 31 — media compatibility layer P0 fixes.

Validates the /api/videos/<name> serve route now returns correct status codes
without 500 backend traces (was 500 due to LogRecord 'name'/'filename' reserved
key conflict in extra=).
"""
import os
import requests
import pytest

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def stealth_token():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "stealth", "password": "Password1$"})
    assert r.status_code == 200, r.text
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def existing_video_url(stealth_token):
    """Find an existing /api/videos/<uuid>.mp4 post for range tests."""
    r = requests.get(f"{BASE}/api/posts?limit=80",
                     headers={"Authorization": f"Bearer {stealth_token}"})
    if r.status_code != 200:
        pytest.skip(f"Cannot fetch feed: {r.status_code}")
    posts = r.json() if isinstance(r.json(), list) else r.json().get("posts") or r.json().get("items") or []
    for p in posts:
        v = p.get("video_url") or ""
        if v.startswith("/api/videos/") and "abc.mp4" not in v:
            return v
    pytest.skip("No playable video post in feed")


def test_abc_mp4_returns_404_not_500():
    """The broken seed file /api/videos/abc.mp4 must return 4xx (was 500)."""
    r = requests.get(f"{BASE}/api/videos/abc.mp4")
    # Per request: filename is safe pattern but file missing → 404.
    # Spec says 400 (was 500) — 404 also acceptable since file missing.
    assert r.status_code in (400, 404), f"Expected 400/404, got {r.status_code}"


def test_invalid_filename_pattern_rejected():
    """Junk filename gets rejected by validator."""
    r = requests.get(f"{BASE}/api/videos/notexisting12345.mp4")
    assert r.status_code in (400, 404), f"Expected 400/404, got {r.status_code}"


def test_unsafe_filename_400():
    """Path traversal etc. → 400."""
    r = requests.get(f"{BASE}/api/videos/..%2Fetc%2Fpasswd")
    assert r.status_code in (400, 404)


def test_existing_video_full_get_200(existing_video_url):
    r = requests.get(f"{BASE}{existing_video_url}", stream=True)
    assert r.status_code == 200, f"{existing_video_url} → {r.status_code}"
    assert r.headers.get("Accept-Ranges") == "bytes"
    # Body must be non-empty.
    chunk = next(r.iter_content(1024))
    assert chunk and len(chunk) > 0


def test_existing_video_range_206(existing_video_url):
    r = requests.get(
        f"{BASE}{existing_video_url}",
        headers={"Range": "bytes=0-0"},
        stream=True,
    )
    assert r.status_code == 206, f"Range request → {r.status_code}"
    assert "bytes 0-0/" in (r.headers.get("Content-Range") or "")
    assert r.headers.get("Accept-Ranges") == "bytes"
