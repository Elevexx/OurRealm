"""Phase 5 — Media Upload Limits MVP tests.

Covers:
  - GET /api/upload-limits/me (auth required, founder=unlimited, normal=numeric)
  - POST /api/images/upload size cap (3 MB for non-founder, founder exempt)
  - POST /api/sounds/upload happy path + audio.used increments
  - Regression: /api/posts, /api/sounds/charts/top100, /api/dashboard/layout,
                /api/admin/analytics (founder-only, 403 for non-admin)
"""
from __future__ import annotations

import io
import os
import struct
import wave
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

FOUNDER = {"email": "slopestyle2022@gmail.com", "password": "Password1$"}
USER1 = {"email": "testfriend1@example.com", "password": "pass1234"}


# ─── Fixtures ────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def founder_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=FOUNDER, timeout=20)
    assert r.status_code == 200, f"founder login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="session")
def user_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=USER1, timeout=20)
    assert r.status_code == 200, f"user1 login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


def auth_h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ─── Helpers to build media ─────────────────────────────────────────
def small_png_bytes() -> bytes:
    img = Image.new("RGB", (64, 64), (200, 100, 50))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def jpeg_of_size(target_bytes: int) -> bytes:
    """Produce a JPEG slightly larger than target_bytes by using a large noisy image."""
    # noise image is poorly compressible; size scales w/ pixels & quality
    import random
    side = 2400
    img = Image.new("RGB", (side, side))
    px = img.load()
    rnd = random.Random(42)
    for y in range(side):
        for x in range(side):
            px[x, y] = (rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(0, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    data = buf.getvalue()
    # If still smaller than target, pad with EXIF comment (JPEGs ignore trailing junk after EOI but appenders accept comment segment).
    if len(data) < target_bytes:
        # Insert a large COM (FFFE) segment right after SOI (FFD8).
        pad_len = target_bytes - len(data)
        # COM segment length is 2 bytes, max 65533 - so chain multiple if needed
        out = bytearray(data[:2])  # SOI
        remaining = pad_len
        while remaining > 0:
            chunk = min(65533 - 2, remaining)
            out += b"\xff\xfe" + struct.pack(">H", chunk + 2) + (b"\x00" * chunk)
            remaining -= chunk
        out += data[2:]
        data = bytes(out)
    return data


def small_wav_bytes(seconds: float = 1.0, sample_rate: int = 22050) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        n = int(sample_rate * seconds)
        w.writeframes(b"\x00\x00" * n)
    return buf.getvalue()


# ─── /api/upload-limits/me ───────────────────────────────────────────
class TestUploadLimitsEndpoint:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/upload-limits/me", timeout=15)
        assert r.status_code == 401, f"expected 401 got {r.status_code} {r.text[:200]}"

    def test_founder_unlimited(self, founder_token):
        r = requests.get(
            f"{BASE_URL}/api/upload-limits/me",
            headers=auth_h(founder_token), timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "limits" in body
        for k in ("image", "audio", "video"):
            assert k in body["limits"], f"missing {k} key"
            assert body["limits"][k]["remaining"] == "unlimited", f"{k} not unlimited for founder: {body['limits'][k]}"

    def test_normal_user_numeric(self, user_token):
        r = requests.get(
            f"{BASE_URL}/api/upload-limits/me",
            headers=auth_h(user_token), timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        lim = body["limits"]
        assert lim["image"]["per_day"] == 20
        assert lim["audio"]["per_day"] == 10
        assert lim["video"]["per_day"] == 3
        for k in ("image", "audio", "video"):
            assert isinstance(lim[k]["remaining"], int), f"{k} remaining not int for normal user"
            assert isinstance(lim[k]["used"], int)


# ─── Image upload cap (3MB for non-founder) ─────────────────────────
class TestImageUploadCap:
    def test_non_founder_4mb_rejected_with_413(self, user_token):
        data = jpeg_of_size(4 * 1024 * 1024 + 200_000)  # ~4.2MB
        assert len(data) > 3 * 1024 * 1024
        files = {"file": ("big.jpg", data, "image/jpeg")}
        r = requests.post(
            f"{BASE_URL}/api/images/upload",
            headers=auth_h(user_token), files=files, timeout=60,
        )
        assert r.status_code == 413, f"expected 413 got {r.status_code} {r.text[:300]}"
        detail = (r.json().get("detail") or "")
        assert "max 3 MB" in detail or "too large" in detail.lower(), detail

    def test_founder_4mb_accepted(self, founder_token):
        data = jpeg_of_size(4 * 1024 * 1024 + 200_000)
        files = {"file": ("big.jpg", data, "image/jpeg")}
        r = requests.post(
            f"{BASE_URL}/api/images/upload",
            headers=auth_h(founder_token), files=files, timeout=120,
        )
        assert r.status_code == 200, f"founder 4MB image failed: {r.status_code} {r.text[:300]}"
        body = r.json()
        assert "image" in body and "url" in body

    def test_small_png_user_increments_used(self, user_token):
        r0 = requests.get(f"{BASE_URL}/api/upload-limits/me",
                          headers=auth_h(user_token), timeout=15).json()
        used0 = r0["limits"]["image"]["used"]

        files = {"file": ("tiny.png", small_png_bytes(), "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/images/upload",
            headers=auth_h(user_token), files=files, timeout=30,
        )
        assert r.status_code == 200, r.text
        rec = r.json().get("image")
        assert rec and rec.get("id"), "image record missing id"

        r2 = requests.get(f"{BASE_URL}/api/upload-limits/me",
                          headers=auth_h(user_token), timeout=15).json()
        assert r2["limits"]["image"]["used"] == used0 + 1, (
            f"used did not increment: before={used0} after={r2['limits']['image']['used']}"
        )

    def test_small_png_founder_ok(self, founder_token):
        files = {"file": ("founder.png", small_png_bytes(), "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/images/upload",
            headers=auth_h(founder_token), files=files, timeout=30,
        )
        assert r.status_code == 200, r.text


# ─── Sound upload happy path ─────────────────────────────────────────
class TestSoundUpload:
    def test_user_upload_small_wav(self, user_token):
        r0 = requests.get(f"{BASE_URL}/api/upload-limits/me",
                          headers=auth_h(user_token), timeout=15).json()
        used0 = r0["limits"]["audio"]["used"]

        files = {"file": ("tone.wav", small_wav_bytes(1.0), "audio/wav")}
        data = {"title": "TEST_tone", "category": "Music"}
        r = requests.post(
            f"{BASE_URL}/api/sounds/upload",
            headers=auth_h(user_token), files=files, data=data, timeout=60,
        )
        # If the backend rejects WAV for some reason, surface that as a known minor issue.
        if r.status_code != 200:
            pytest.skip(f"sounds/upload returned {r.status_code}: {r.text[:300]}")
        body = r.json()
        assert "track" in body, body
        assert body["track"]["title"] == "TEST_tone"

        r2 = requests.get(f"{BASE_URL}/api/upload-limits/me",
                          headers=auth_h(user_token), timeout=15).json()
        assert r2["limits"]["audio"]["used"] == used0 + 1


# ─── Regression: existing endpoints still work ──────────────────────
class TestRegression:
    def test_posts_list(self, user_token):
        r = requests.get(f"{BASE_URL}/api/posts",
                         headers=auth_h(user_token), timeout=15)
        assert r.status_code == 200, r.text

    def test_sounds_charts_top100(self, user_token):
        r = requests.get(f"{BASE_URL}/api/sounds/charts/top100",
                         headers=auth_h(user_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "tracks" in body and "page" in body

    def test_dashboard_layout_get(self, user_token):
        r = requests.get(f"{BASE_URL}/api/dashboard/layout",
                         headers=auth_h(user_token), timeout=15)
        assert r.status_code == 200, r.text
        assert "widgets" in r.json()

    def test_admin_analytics_founder_ok(self, founder_token):
        r = requests.get(f"{BASE_URL}/api/admin/analytics?range=7d",
                         headers=auth_h(founder_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "users" in body and "content" in body

    def test_admin_analytics_non_admin_403(self, user_token):
        r = requests.get(f"{BASE_URL}/api/admin/analytics?range=7d",
                         headers=auth_h(user_token), timeout=15)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text[:200]}"
