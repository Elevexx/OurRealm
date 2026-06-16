"""Phase-1 backend feature tests: password login, OTP coexistence, compliance,
posts media urls, likes, comments 178 limit, emoji, notification payloads."""
import uuid
import requests
import pytest
from .conftest import BASE_URL


# ---------- helpers ----------
def _compliance():
    return {
        "accepted_terms": True,
        "accepted_privacy": True,
        "accepted_conditions": True,
        "age_confirmed_13": True,
    }


def _reg(prefix="u"):
    suffix = uuid.uuid4().hex[:8]
    return {
        "email": f"TEST_{prefix}_{suffix}@ourrealm.app",
        "password": "Pass1234",
        "name": f"Test {prefix}",
        "username": f"test{prefix}{suffix}",
        **_compliance(),
    }


def _fresh():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    p = _reg()
    r = s.post(f"{BASE_URL}/api/auth/register", json=p)
    assert r.status_code == 200, r.text
    d = r.json()
    s.cookies.clear()
    s.headers.update({"Authorization": f"Bearer {d['access_token']}"})
    return s, d["user"], p


# ---------- Stealth password login (Phase-1) ----------
class TestStealthPasswordLogin:
    def test_login_by_username_stealth(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": "stealth", "password": "Password1$",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["username"] == "stealth"
        assert "access_token" in d

    def test_login_by_email_stealth(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": "slopestyle2022@gmail.com", "password": "Password1$",
        })
        assert r.status_code == 200, r.text
        assert r.json()["user"]["username"] == "stealth"

    def test_me_returns_stealth_after_login(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": "stealth", "password": "Password1$",
        })
        assert r.status_code == 200
        token = r.json()["access_token"]
        me = api_client.get(f"{BASE_URL}/api/auth/me",
                            headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["user"]["username"] == "stealth"

    def test_login_bad_password(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": "stealth", "password": "wrong-pw"})
        assert r.status_code == 401


# ---------- OTP coexistence ----------
class TestOtpCoexists:
    def test_otp_request_and_verify_stealth(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/otp/request",
                            json={"email": "slopestyle2022@gmail.com"})
        assert r.status_code == 200, r.text
        otp = r.json().get("displayed_otp")
        assert otp and len(otp) == 6
        v = api_client.post(f"{BASE_URL}/api/auth/otp/verify",
                            json={"email": "slopestyle2022@gmail.com", "code": otp})
        assert v.status_code == 200, v.text
        assert v.json()["user"]["username"] == "stealth"


# ---------- Compliance gate on /register ----------
class TestComplianceGate:
    def test_register_missing_all_flags_400(self, api_client):
        p = _reg()
        for k in ("accepted_terms", "accepted_privacy",
                  "accepted_conditions", "age_confirmed_13"):
            p[k] = False
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=p)
        # Either 400 (server enforced) or 422 (pydantic). Phase-1 spec says 400.
        assert r.status_code in (400, 422), r.text

    def test_register_missing_one_flag_400(self, api_client):
        p = _reg()
        p["age_confirmed_13"] = False
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=p)
        assert r.status_code in (400, 422), r.text

    def test_register_with_all_flags_ok(self, api_client):
        p = _reg()
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=p)
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert u["username"] == p["username"]


# ---------- Posts: additive media URLs ----------
class TestPostMediaUrls:
    def test_create_post_with_image_and_link(self):
        s, _, _ = _fresh()
        payload = {
            "content": "test 🚀",
            "media_type": "thought",
            "image_url": "https://picsum.photos/600/400",
            "link_url": "https://example.com",
        }
        r = s.post(f"{BASE_URL}/api/posts", json=payload)
        assert r.status_code == 200, r.text
        p = r.json()["post"]
        assert p["image_url"] == payload["image_url"]
        assert p["link_url"] == payload["link_url"]
        assert p["content"] == payload["content"]  # emoji round-trip
        pid = p["id"]
        # GET back
        g = s.get(f"{BASE_URL}/api/posts/{pid}")
        assert g.status_code == 200, g.text
        gp = g.json()["post"]
        assert gp["image_url"] == payload["image_url"]
        assert gp["link_url"] == payload["link_url"]

    def test_create_post_with_all_three_urls(self):
        s, _, _ = _fresh()
        payload = {
            "content": "all media",
            "media_type": "thought",
            "image_url": "https://picsum.photos/600/400",
            "video_url": "https://example.com/v.mp4",
            "link_url": "https://example.com",
        }
        r = s.post(f"{BASE_URL}/api/posts", json=payload)
        assert r.status_code == 200, r.text
        p = r.json()["post"]
        assert p["image_url"] and p["video_url"] and p["link_url"]


# ---------- Like toggle ----------
class TestLikeToggle:
    def test_like_unlike_idempotent(self):
        s, _, _ = _fresh()
        # create a post first
        cr = s.post(f"{BASE_URL}/api/posts", json={
            "content": "like me", "media_type": "thought"})
        assert cr.status_code == 200
        pid = cr.json()["post"]["id"]

        # like
        r1 = s.post(f"{BASE_URL}/api/posts/{pid}/like")
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["liked"] is True
        assert d1["likes"] == 1

        # tap again -> unlike
        r2 = s.post(f"{BASE_URL}/api/posts/{pid}/like")
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2["liked"] is False
        assert d2["likes"] == 0

        # re-like and persist (GET post)
        s.post(f"{BASE_URL}/api/posts/{pid}/like")
        g = s.get(f"{BASE_URL}/api/posts/{pid}")
        assert g.status_code == 200
        post = g.json()["post"]
        assert post["likes"] == 1
        assert isinstance(post.get("liked_by"), list)
        assert len(post["liked_by"]) == 1


# ---------- Comments: 178-char limit & emoji ----------
class TestComments:
    def test_comment_178_ok(self):
        s, _, _ = _fresh()
        cr = s.post(f"{BASE_URL}/api/posts", json={
            "content": "post", "media_type": "thought"})
        pid = cr.json()["post"]["id"]
        text178 = "a" * 178
        r = s.post(f"{BASE_URL}/api/posts/{pid}/comment", json={"text": text178})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["comment"]["text"] == text178
        assert body["comments"] == 1

    def test_comment_179_rejected(self):
        s, _, _ = _fresh()
        cr = s.post(f"{BASE_URL}/api/posts", json={
            "content": "post", "media_type": "thought"})
        pid = cr.json()["post"]["id"]
        r = s.post(f"{BASE_URL}/api/posts/{pid}/comment",
                   json={"text": "a" * 179})
        assert r.status_code == 400, r.text
        assert "178" in r.json()["detail"]

    def test_comment_emoji_roundtrip(self):
        s, _, _ = _fresh()
        cr = s.post(f"{BASE_URL}/api/posts", json={
            "content": "post", "media_type": "thought"})
        pid = cr.json()["post"]["id"]
        emoji = "Hello 🚀✨🎉"
        r = s.post(f"{BASE_URL}/api/posts/{pid}/comment", json={"text": emoji})
        assert r.status_code == 200, r.text
        assert r.json()["comment"]["text"] == emoji
        lst = s.get(f"{BASE_URL}/api/posts/{pid}/comments")
        assert lst.status_code == 200
        texts = [c["text"] for c in lst.json()["comments"]]
        assert emoji in texts

    def test_comment_empty_400(self):
        s, _, _ = _fresh()
        cr = s.post(f"{BASE_URL}/api/posts", json={
            "content": "post", "media_type": "thought"})
        pid = cr.json()["post"]["id"]
        r = s.post(f"{BASE_URL}/api/posts/{pid}/comment", json={"text": "   "})
        assert r.status_code == 400


# ---------- Notification payload carries post_id (for deep linking) ----------
class TestNotificationPostIdPayload:
    def test_like_notification_carries_post_id(self):
        # actor (s2) likes a post by author (s1). s1's notifications should include post_id.
        s1, _u1, _ = _fresh()
        s2, _u2, _ = _fresh()
        cr = s1.post(f"{BASE_URL}/api/posts", json={
            "content": "notify me", "media_type": "thought"})
        assert cr.status_code == 200
        pid = cr.json()["post"]["id"]
        r = s2.post(f"{BASE_URL}/api/posts/{pid}/like")
        assert r.status_code == 200, r.text

        # fetch notifications for s1
        notifs = s1.get(f"{BASE_URL}/api/notifications/list")
        assert notifs.status_code == 200, notifs.text
        body = notifs.json()
        items = body.get("notifications") or body.get("items") or body.get("list") or []
        like_items = [n for n in items if n.get("kind") == "like" or n.get("type") == "like"]
        assert like_items, f"No like notification found, body={notifs.json()}"
        # payload should have post_id
        payload = like_items[0].get("payload") or {}
        assert payload.get("post_id") == pid, f"Missing post_id, got {like_items[0]}"

    def test_comment_notification_carries_post_id(self):
        s1, _u1, _ = _fresh()
        s2, _u2, _ = _fresh()
        cr = s1.post(f"{BASE_URL}/api/posts", json={
            "content": "comment notify", "media_type": "thought"})
        pid = cr.json()["post"]["id"]
        r = s2.post(f"{BASE_URL}/api/posts/{pid}/comment",
                    json={"text": "nice post 🙌"})
        assert r.status_code == 200, r.text
        notifs = s1.get(f"{BASE_URL}/api/notifications/list")
        assert notifs.status_code == 200
        body = notifs.json()
        items = body.get("notifications") or body.get("items") or body.get("list") or []
        comment_items = [n for n in items if n.get("kind") == "comment" or n.get("type") == "comment"]
        assert comment_items, f"No comment notification, body={notifs.json()}"
        payload = comment_items[0].get("payload") or {}
        assert payload.get("post_id") == pid
