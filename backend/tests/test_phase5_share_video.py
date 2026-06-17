"""Phase 5 — In-feed video & Share-to-user (post_share) DMs.

Covers:
- POST /api/messages with media kind='post_share' + post_id (url/preview optional)
- Recipient GET /api/messages/thread/{username} preserves media payload
- Regression: kind='image' and kind='link' still accepted
- POST /api/friends/status/{username}, /request, /accept payload shape ({username})
- POST /api/posts (media_type='video', YouTube video_url) & GET /api/posts/{id}
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

TF1 = {"email": "testfriend1@example.com", "password": "pass1234", "username": "tfone"}
TF2 = {"email": "testfriend2@example.com", "password": "pass1234", "username": "tftwo"}


def _login(s, creds):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": creds["email"], "password": creds["password"]})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return tok


@pytest.fixture
def tf1_client():
    s = requests.Session(); s.headers.update({"Content-Type": "application/json"})
    _login(s, TF1)
    return s


@pytest.fixture
def tf2_client():
    s = requests.Session(); s.headers.update({"Content-Type": "application/json"})
    _login(s, TF2)
    return s


# ── Posts: YouTube video_url is accepted and preserved ───────────────────────
class TestVideoPost:
    def test_create_youtube_video_post_and_fetch(self, tf1_client):
        yt = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        payload = {
            "content": f"TEST_PHASE5 yt {uuid.uuid4().hex[:6]}",
            "media_type": "video",
            "video_url": yt,
        }
        r = tf1_client.post(f"{BASE_URL}/api/posts", json=payload)
        assert r.status_code in (200, 201), r.text
        post = r.json().get("post", r.json())
        assert "id" in post
        assert post.get("video_url") == yt
        # Re-fetch via GET
        gr = tf1_client.get(f"{BASE_URL}/api/posts/{post['id']}")
        assert gr.status_code == 200
        gp = gr.json().get("post", gr.json())
        assert gp.get("video_url") == yt
        # _id must not leak
        assert "_id" not in gp


# ── Messages: post_share media ───────────────────────────────────────────────
class TestPostShareDM:
    def _make_post(self, client):
        r = client.post(f"{BASE_URL}/api/posts", json={
            "content": f"TEST_PHASE5 share {uuid.uuid4().hex[:6]}",
            "media_type": "video",
            "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
        assert r.status_code in (200, 201), r.text
        return r.json().get("post", r.json())["id"]

    def test_send_post_share_dm_and_recipient_sees_it(self, tf1_client, tf2_client):
        post_id = self._make_post(tf1_client)
        body = {
            "to_username": TF2["username"],
            "text": "Shared a post: preview only",
            "media": {"kind": "post_share", "post_id": post_id},
        }
        r = tf1_client.post(f"{BASE_URL}/api/messages", json=body)
        assert r.status_code == 200, r.text
        msg = r.json()["message"]
        assert msg["media"]["kind"] == "post_share"
        assert msg["media"]["post_id"] == post_id
        # Privacy: no copy of post body should travel — url remains None
        assert msg["media"].get("url") in (None, "")

        # Recipient fetches the thread
        tr = tf2_client.get(f"{BASE_URL}/api/messages/thread/{TF1['username']}")
        assert tr.status_code == 200
        msgs = tr.json()["messages"]
        match = [m for m in msgs if m.get("id") == msg["id"]]
        assert len(match) == 1
        assert match[0]["media"]["kind"] == "post_share"
        assert match[0]["media"]["post_id"] == post_id

    def test_post_share_with_url_optional_omitted(self, tf1_client, tf2_client):
        post_id = self._make_post(tf1_client)
        r = tf1_client.post(f"{BASE_URL}/api/messages", json={
            "to_username": TF2["username"],
            "text": "ps2",
            "media": {"kind": "post_share", "post_id": post_id},
        })
        assert r.status_code == 200
        m = r.json()["message"]["media"]
        assert m["kind"] == "post_share" and m["post_id"] == post_id


# ── Regression: image + link DMs still work ──────────────────────────────────
class TestDMMediaRegression:
    def test_image_media_still_accepted(self, tf1_client):
        r = tf1_client.post(f"{BASE_URL}/api/messages", json={
            "to_username": TF2["username"],
            "text": "img test",
            "media": {"kind": "image", "url": "https://example.com/x.png", "width": 100, "height": 80},
        })
        assert r.status_code == 200, r.text
        m = r.json()["message"]["media"]
        assert m["kind"] == "image"
        assert m["url"] == "https://example.com/x.png"

    def test_link_media_still_accepted(self, tf1_client):
        r = tf1_client.post(f"{BASE_URL}/api/messages", json={
            "to_username": TF2["username"],
            "text": "link test",
            "media": {"kind": "link", "url": "https://example.com/some/article", "preview": "Read"},
        })
        assert r.status_code == 200, r.text
        m = r.json()["message"]["media"]
        assert m["kind"] == "link"
        assert m["url"] == "https://example.com/some/article"


# ── Friends payload shape verification (PostPopup CTA) ───────────────────────
class TestFriendPayloadShape:
    def test_friend_status_endpoint_present(self, tf1_client):
        r = tf1_client.get(f"{BASE_URL}/api/friends/status/{TF2['username']}")
        assert r.status_code == 200
        st = r.json().get("status")
        assert st in {"none", "outgoing", "incoming", "friends", "self"}

    def test_friend_request_accept_payload_shape(self):
        """Spin up two FRESH users, request via {username}, accept via {username}."""
        s1 = requests.Session(); s1.headers.update({"Content-Type": "application/json"})
        s2 = requests.Session(); s2.headers.update({"Content-Type": "application/json"})

        u1 = f"test_p5_{uuid.uuid4().hex[:6]}"
        u2 = f"test_p5_{uuid.uuid4().hex[:6]}"
        common = {
            "accepted_terms": True, "accepted_privacy": True,
            "accepted_conditions": True, "age_confirmed_13": True,
        }
        r1 = s1.post(f"{BASE_URL}/api/auth/register", json={
            "email": f"{u1}@example.com", "password": "pass1234A!",
            "name": "P5 One", "username": u1, **common,
        })
        if r1.status_code != 200:
            pytest.skip(f"register failed: {r1.status_code} {r1.text}")
        s1.headers.update({"Authorization": f"Bearer {r1.json()['access_token']}"})
        r2 = s2.post(f"{BASE_URL}/api/auth/register", json={
            "email": f"{u2}@example.com", "password": "pass1234A!",
            "name": "P5 Two", "username": u2, **common,
        })
        assert r2.status_code == 200, r2.text
        s2.headers.update({"Authorization": f"Bearer {r2.json()['access_token']}"})

        # u1 sends friend request to u2 with {username}
        rr = s1.post(f"{BASE_URL}/api/friends/request", json={"username": u2})
        assert rr.status_code == 200, rr.text

        # status from u1's POV should now be outgoing
        rs = s1.get(f"{BASE_URL}/api/friends/status/{u2}")
        assert rs.status_code == 200 and rs.json().get("status") == "outgoing"

        # u2 accepts with {username}
        ra = s2.post(f"{BASE_URL}/api/friends/accept", json={"username": u1})
        assert ra.status_code == 200, ra.text

        # status from both POVs should be friends
        assert s1.get(f"{BASE_URL}/api/friends/status/{u2}").json().get("status") == "friends"
        assert s2.get(f"{BASE_URL}/api/friends/status/{u1}").json().get("status") == "friends"
