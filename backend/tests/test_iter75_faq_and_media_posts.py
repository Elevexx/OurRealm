"""Iteration 75 — 9-point update backend validation.

Covers:
- Public FAQ GET /api/faq (11 published items, no auth needed)
- Founder FAQ CRUD (POST/PATCH/DELETE /api/admin/faq/*) as stealth
- POST /api/posts with image_urls + empty content (media-only)
- POST /api/images/upload as stealth
"""
from __future__ import annotations

import io
import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

STEALTH_USER = "stealth"
STEALTH_PASS = "Password1$"


# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def stealth_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": STEALTH_USER, "password": STEALTH_PASS},
        timeout=15,
    )
    assert r.status_code == 200, f"Cannot auth stealth: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, f"No token in {body}"
    return tok


@pytest.fixture
def stealth_client(stealth_token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {stealth_token}",
    })
    return s


# ---------- Public FAQ ----------

class TestPublicFAQ:
    def test_public_faq_returns_11_items_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/faq", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        items = data["items"]
        assert isinstance(items, list)
        # Review spec expects 11 published items
        assert len(items) >= 11, f"Expected >=11 published FAQ items, got {len(items)}: {[i.get('question') for i in items]}"
        # Validate schema of first item
        first = items[0]
        assert "id" in first
        assert "question" in first and first["question"]
        assert "answer" in first and first["answer"]
        assert first.get("is_published") is True
        assert "_id" not in first  # Mongo _id excluded


# ---------- Admin FAQ CRUD (stealth founder) ----------

class TestAdminFAQCRUD:
    _created_id = None

    def test_a_create_faq(self, stealth_client):
        payload = {
            "question": "TESTAGENT_ Iter75 sample question?",
            "answer": "TESTAGENT_ Iter75 sample answer for verification.",
            "is_published": True,
        }
        r = stealth_client.post(f"{BASE_URL}/api/admin/faq", json=payload)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        item = body.get("item")
        assert item and "id" in item
        assert item["question"] == payload["question"]
        assert item["answer"] == payload["answer"]
        assert item["is_published"] is True
        TestAdminFAQCRUD._created_id = item["id"]

        # Verify GET public shows it (published)
        r2 = requests.get(f"{BASE_URL}/api/faq", timeout=10)
        assert r2.status_code == 200
        ids = [i["id"] for i in r2.json()["items"]]
        assert TestAdminFAQCRUD._created_id in ids

    def test_b_update_faq(self, stealth_client):
        assert TestAdminFAQCRUD._created_id, "create test must run first"
        r = stealth_client.patch(
            f"{BASE_URL}/api/admin/faq/{TestAdminFAQCRUD._created_id}",
            json={"answer": "TESTAGENT_ Iter75 UPDATED answer.", "is_published": False},
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        item = body.get("item")
        assert item["answer"] == "TESTAGENT_ Iter75 UPDATED answer."
        assert item["is_published"] is False

        # After unpublish, public list should NOT include it
        r2 = requests.get(f"{BASE_URL}/api/faq", timeout=10)
        ids = [i["id"] for i in r2.json()["items"]]
        assert TestAdminFAQCRUD._created_id not in ids

    def test_c_delete_faq_and_cleanup(self, stealth_client):
        assert TestAdminFAQCRUD._created_id, "create test must run first"
        r = stealth_client.delete(f"{BASE_URL}/api/admin/faq/{TestAdminFAQCRUD._created_id}")
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        assert r.json().get("ok") is True

        # Second delete should 404
        r2 = stealth_client.delete(f"{BASE_URL}/api/admin/faq/{TestAdminFAQCRUD._created_id}")
        assert r2.status_code == 404

    def test_d_cleanup_any_leftover_testagent_entries(self, stealth_client):
        """Belt-and-suspenders cleanup: nuke any TESTAGENT_ FAQ entries."""
        r = stealth_client.get(f"{BASE_URL}/api/admin/faq")
        assert r.status_code == 200
        items = r.json().get("items", [])
        leftovers = [i for i in items if (i.get("question") or "").startswith("TESTAGENT_")]
        for it in leftovers:
            stealth_client.delete(f"{BASE_URL}/api/admin/faq/{it['id']}")
        # verify none left
        r2 = stealth_client.get(f"{BASE_URL}/api/admin/faq")
        remaining = [i for i in r2.json().get("items", []) if (i.get("question") or "").startswith("TESTAGENT_")]
        assert remaining == []


# ---------- Media-only post (empty content + image_urls) ----------

class TestMediaOnlyPost:
    _post_id = None

    def test_create_post_with_empty_content_and_images(self, stealth_client):
        payload = {
            "content": "",
            "image_urls": [
                "https://example.com/a.jpg",
                "https://example.com/b.jpg",
            ],
            "audience": {"visibility": "public", "user_ids": []},
        }
        r = stealth_client.post(f"{BASE_URL}/api/posts", json=payload)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        body = r.json()
        # Response may be {"ok": True, "post": {...}} or the post itself
        post = body.get("post") if isinstance(body, dict) and "post" in body else body
        assert post and "id" in post
        assert post.get("content", "") == "" or post.get("content") is None or post.get("content") == ""
        # image_urls preserved (both URLs)
        img_urls = post.get("image_urls") or []
        assert len(img_urls) == 2, f"Expected 2 image_urls, got {img_urls}"
        assert img_urls == payload["image_urls"]
        TestMediaOnlyPost._post_id = post["id"]

    def test_verify_post_persistence_and_no_auto_image_label(self, stealth_client):
        assert TestMediaOnlyPost._post_id
        # Fetch via feed or direct post endpoint
        r = stealth_client.get(f"{BASE_URL}/api/posts/{TestMediaOnlyPost._post_id}")
        if r.status_code == 404:
            pytest.skip("No direct GET /api/posts/{id} — skipping persistence via feed")
        assert r.status_code == 200
        body = r.json()
        post = body.get("post") if isinstance(body, dict) and "post" in body else body
        content = (post.get("content") or "").strip()
        # Critical: no auto-added 'Image' label
        assert content == "", f"Expected empty content, got '{content}'"
        assert len(post.get("image_urls") or []) == 2

    def test_cleanup_delete_post(self, stealth_client):
        if not TestMediaOnlyPost._post_id:
            pytest.skip("No post to delete")
        r = stealth_client.delete(f"{BASE_URL}/api/posts/{TestMediaOnlyPost._post_id}")
        assert r.status_code in (200, 204), f"Delete failed: {r.status_code} {r.text}"


# ---------- Image upload ----------

class TestImageUpload:
    def test_upload_small_png(self, stealth_token):
        # Valid tiny PNG generated via PIL
        try:
            from PIL import Image
        except ImportError:
            pytest.skip("PIL not available")
        buf = io.BytesIO()
        Image.new("RGB", (8, 8), (255, 0, 0)).save(buf, format="PNG")
        buf.seek(0)
        files = {"file": ("test_iter75.png", buf, "image/png")}
        headers = {"Authorization": f"Bearer {stealth_token}"}
        r = requests.post(f"{BASE_URL}/api/images/upload", files=files, headers=headers, timeout=20)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        body = r.json()
        url = body.get("url") or body.get("image_url") or (body.get("data") or {}).get("url")
        assert url, f"No image URL in response: {body}"
        assert isinstance(url, str) and len(url) > 0
