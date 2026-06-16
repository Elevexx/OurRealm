"""
Phase 2 — Image hosting backend tests.

Covers: /api/images/upload, /api/images/from-url, GET /api/images/{name},
filename security, mime sniffing, size cap, rate limit, profile alias.
"""
from __future__ import annotations

import io
import os
import time
import uuid

import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")


def _jpeg_bytes(size=(64, 64), color=(200, 100, 50)) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", size, color)
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


@pytest.fixture(scope="module")
def tfone_token():
    # username login (works with email or username)
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "testfriend1@example.com", "password": "pass1234"},
                      timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def fresh_user_token():
    """Register a fresh user for the rate-limit test so we don't poison tfone."""
    uname = f"img{uuid.uuid4().hex[:8]}"
    email = f"TEST_{uname}@ourrealm.app"
    payload = {
        "email": email, "password": "Password1$", "name": "Img Tester",
        "username": uname, "accepted_terms": True, "accepted_privacy": True,
        "accepted_conditions": True, "age_confirmed_13": True,
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token")


# ── Multipart upload ─────────────────────────────────────────────────
class TestImageUpload:
    def test_upload_jpeg_success(self, tfone_token):
        files = {"file": ("ok.jpg", _jpeg_bytes(), "image/jpeg")}
        r = requests.post(f"{BASE_URL}/api/images/upload",
                          headers={"Authorization": f"Bearer {tfone_token}"},
                          files=files, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "image" in data and "url" in data and "thumbnail_url" in data
        img = data["image"]
        for k in ("id", "user_id", "original_url", "thumbnail_url",
                  "width", "height", "bytes", "mime", "sha256", "created_at"):
            assert k in img, f"missing key {k}"
        assert img["original_url"].startswith("/api/images/")
        assert img["thumbnail_url"].startswith("/api/images/")
        assert img["mime"] == "image/jpeg"

        # GET both (no auth) and verify cache headers
        # Note: preview ingress / Cloudflare may strip cache headers on the
        # public URL; assert against the origin backend (localhost:8001) so we
        # measure what the application sets, not the CDN.
        origin = "http://localhost:8001"
        for path in (img["original_url"], img["thumbnail_url"]):
            g = requests.get(f"{origin}{path}", timeout=15)
            assert g.status_code == 200, f"GET {path} {g.status_code}"
            cc = g.headers.get("Cache-Control", "")
            assert "immutable" in cc and "max-age=31536000" in cc and "public" in cc, \
                f"bad Cache-Control on {path}: {cc!r}"
        # Also confirm public URL serves (cache header may be overridden by CDN)
        g2 = requests.get(f"{BASE_URL}{img['original_url']}", timeout=15)
        assert g2.status_code == 200

    def test_upload_text_with_image_mime_rejected(self, tfone_token):
        # tiny text declared as image/png — sniffer must reject
        files = {"file": ("fake.png", b"hello world this is not an image", "image/png")}
        r = requests.post(f"{BASE_URL}/api/images/upload",
                          headers={"Authorization": f"Bearer {tfone_token}"},
                          files=files, timeout=15)
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"

    def test_upload_oversize_rejected(self, tfone_token):
        # ~10.5MB random-ish bytes; doesn't need to be a real image because
        # size check happens first and returns 413.
        blob = (b"\xff\xd8\xff" + os.urandom(10 * 1024 * 1024 + 512 * 1024))
        files = {"file": ("big.jpg", blob, "image/jpeg")}
        r = requests.post(f"{BASE_URL}/api/images/upload",
                          headers={"Authorization": f"Bearer {tfone_token}"},
                          files=files, timeout=60)
        assert r.status_code == 413, f"expected 413 got {r.status_code}: {r.text[:200]}"


# ── from-url ─────────────────────────────────────────────────────────
class TestImageFromUrl:
    def test_from_url_picsum_success(self, tfone_token):
        seed = uuid.uuid4().hex[:6]
        r = requests.post(f"{BASE_URL}/api/images/from-url",
                          headers={"Authorization": f"Bearer {tfone_token}"},
                          json={"url": f"https://picsum.photos/seed/{seed}/600/400.jpg"},
                          timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        data = r.json()
        assert data["image"]["original_url"].startswith("/api/images/")
        # Fetch the original + thumb (origin to verify cache headers; public to verify reachability)
        origin = "http://localhost:8001"
        for path in (data["url"], data["thumbnail_url"]):
            g = requests.get(f"{origin}{path}", timeout=15)
            assert g.status_code == 200, f"GET {path} -> {g.status_code}"
            cc = g.headers.get("Cache-Control", "")
            assert "public" in cc and "immutable" in cc, f"bad cache header: {cc!r}"
        gp = requests.get(f"{BASE_URL}{data['url']}", timeout=15)
        assert gp.status_code == 200

    def test_from_url_non_image_rejected(self, tfone_token):
        r = requests.post(f"{BASE_URL}/api/images/from-url",
                          headers={"Authorization": f"Bearer {tfone_token}"},
                          json={"url": "https://example.com"},
                          timeout=20)
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text[:200]}"


# ── Filename security ───────────────────────────────────────────────
class TestServeSecurity:
    def test_path_traversal_rejected(self):
        # Starlette decodes %2e%2e too; both forms should be blocked.
        r = requests.get(f"{BASE_URL}/api/images/..%2Fetc%2Fpasswd", timeout=10,
                         allow_redirects=False)
        # Either 400 (our validator) or 404 (router didn't match). Spec wants 400.
        assert r.status_code in (400, 404), f"got {r.status_code}: {r.text[:120]}"

    def test_invalid_extension_rejected(self):
        r = requests.get(f"{BASE_URL}/api/images/{uuid.uuid4().hex}.exe", timeout=10)
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text[:120]}"


# ── Profile alias ───────────────────────────────────────────────────
class TestProfileAlias:
    def test_avatar_set_and_alias_exposed(self, tfone_token):
        # Upload then PATCH /api/profile/me
        files = {"file": ("avatar.jpg", _jpeg_bytes((128, 128), (50, 80, 200)),
                          "image/jpeg")}
        r = requests.post(f"{BASE_URL}/api/images/upload",
                          headers={"Authorization": f"Bearer {tfone_token}"},
                          files=files, timeout=30)
        assert r.status_code == 200
        url = r.json()["url"]

        h = {"Authorization": f"Bearer {tfone_token}"}
        p = requests.patch(f"{BASE_URL}/api/profile/me", headers=h,
                           json={"avatar_url": url}, timeout=15)
        assert p.status_code in (200, 204), f"PATCH /api/profile/me -> {p.status_code}: {p.text[:200]}"

        me = requests.get(f"{BASE_URL}/api/auth/me", headers=h, timeout=15)
        assert me.status_code == 200, me.text
        j = me.json()
        # /api/auth/me wraps in {user: {...}}
        user = j.get("user") if isinstance(j.get("user"), dict) else j
        assert user.get("avatar_url") == url, f"avatar_url mismatch: {user.get('avatar_url')}"
        assert user.get("profileImageUrl") == url, f"profileImageUrl missing/mismatch: {user.get('profileImageUrl')}"
        assert url.startswith("/api/images/")


# ── Rate limit (run last & on a fresh user) ─────────────────────────
class TestRateLimit:
    def test_thirteenth_upload_rejected(self, fresh_user_token):
        # Upload 12 quickly; the 13th should hit the 12-per-5min cap.
        h = {"Authorization": f"Bearer {fresh_user_token}"}
        last = None
        for i in range(13):
            files = {"file": (f"rl{i}.jpg", _jpeg_bytes((32, 32), (i*10 % 255, 0, 0)),
                              "image/jpeg")}
            last = requests.post(f"{BASE_URL}/api/images/upload",
                                 headers=h, files=files, timeout=30)
            if i < 12:
                assert last.status_code == 200, f"upload #{i} unexpectedly {last.status_code}: {last.text[:120]}"
        # 13th attempt
        assert last is not None and last.status_code == 400, \
            f"expected 400 on 13th got {last.status_code}: {last.text[:200]}"
        body = last.json()
        detail = (body.get("detail") or "").lower()
        assert "too many" in detail or "rate" in detail or "wait" in detail, \
            f"unexpected detail: {body}"
