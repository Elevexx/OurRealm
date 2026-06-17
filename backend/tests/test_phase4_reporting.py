"""Phase 4 — Comment likes/replies + Universal Reporting backend tests.

Coverage:
  - POST /api/posts/{id}/comments/{cid}/like (toggle, 404)
  - GET  /api/posts/{id}/comments?viewer=... (replies tree, liked hydration, no raw liked_by)
  - POST /api/posts/{id}/comment with parent_id (one-level only)
  - Notifications: comment / reply / comment_like
  - POST /api/reports universal: ticket+DM, duplicate, message privacy,
    screenshots cap, reason validation, content_type validation
  - GET  /api/admin/support/tickets/{id}/report (admin / 404 / 403)
  - Atomic ticket counter under back-to-back POST /api/reports
"""
import os
import io
import uuid
import time
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"]


def _client(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


# ---------- shared fixtures ----------
@pytest.fixture(scope="module")
def stealth_token():
    return _login("slopestyle2022@gmail.com", "Password1$")


@pytest.fixture(scope="module")
def tf1_token():
    return _login("testfriend1@example.com", "pass1234")


@pytest.fixture(scope="module")
def tf2_token():
    return _login("testfriend2@example.com", "pass1234")


@pytest.fixture(scope="module")
def stealth_client(stealth_token):
    return _client(stealth_token)


@pytest.fixture(scope="module")
def tf1_client(tf1_token):
    return _client(tf1_token)


@pytest.fixture(scope="module")
def tf2_client(tf2_token):
    return _client(tf2_token)


@pytest.fixture(scope="module")
def post_id(tf1_client):
    """tf1 creates a post — tf2 / stealth will comment on / report it."""
    r = tf1_client.post(f"{BASE}/api/posts", json={"content": "TEST_PHASE4 post body", "audience": None}, timeout=20)
    assert r.status_code in (200, 201), r.text
    pid = r.json().get("id") or r.json().get("post", {}).get("id")
    assert pid
    return pid


# ---------- 1. Comment likes / replies / tree ----------
class TestCommentsThread:
    def test_create_top_level_comment(self, tf2_client, post_id):
        r = tf2_client.post(f"{BASE}/api/posts/{post_id}/comment", json={"text": "TEST_top1"}, timeout=15)
        assert r.status_code == 200, r.text
        c = r.json()["comment"]
        assert c["text"] == "TEST_top1"
        assert c.get("parent_id") in (None, "")
        assert "liked_by" not in c  # raw array must NOT be exposed
        assert c.get("likes", 0) == 0
        assert c.get("liked") is False
        pytest.top_cid = c["id"]
        pytest.top_author_id = c["author_id"]

    def test_reply_to_comment(self, stealth_client, post_id):
        r = stealth_client.post(f"{BASE}/api/posts/{post_id}/comment",
                                json={"text": "TEST_reply1", "parent_id": pytest.top_cid}, timeout=15)
        assert r.status_code == 200, r.text
        c = r.json()["comment"]
        assert c["parent_id"] == pytest.top_cid
        pytest.reply_id = c["id"]

    def test_reply_to_reply_is_reparented(self, tf1_client, post_id):
        """Replying to a reply must re-parent to its grandparent (no nesting > 2)."""
        r = tf1_client.post(f"{BASE}/api/posts/{post_id}/comment",
                            json={"text": "TEST_reply_to_reply", "parent_id": pytest.reply_id}, timeout=15)
        assert r.status_code == 200, r.text
        c = r.json()["comment"]
        assert c["parent_id"] == pytest.top_cid, f"expected reparent to {pytest.top_cid} got {c.get('parent_id')}"

    def test_list_comments_returns_tree(self, tf2_client, post_id):
        r = tf2_client.get(f"{BASE}/api/posts/{post_id}/comments?viewer=tftwo", timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()["comments"]
        # only the single top-level comment
        tops = [c for c in items if c["id"] == pytest.top_cid]
        assert tops, "top-level comment missing"
        top = tops[0]
        assert "liked_by" not in top
        assert isinstance(top.get("replies"), list)
        assert len(top["replies"]) >= 2  # the reply + reparented reply
        for rpl in top["replies"]:
            assert "liked_by" not in rpl
            assert "liked" in rpl and "likes" in rpl
        # No reply should appear at top level
        reply_ids = {pytest.reply_id}
        assert not any(c["id"] in reply_ids for c in items)

    def test_like_comment_toggle(self, tf1_client, post_id):
        r = tf1_client.post(f"{BASE}/api/posts/{post_id}/comments/{pytest.top_cid}/like", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["liked"] is True
        assert d["likes"] >= 1
        n1 = d["likes"]
        # unlike
        r2 = tf1_client.post(f"{BASE}/api/posts/{post_id}/comments/{pytest.top_cid}/like", timeout=15)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["liked"] is False
        assert d2["likes"] == n1 - 1

    def test_like_unknown_comment_404(self, tf1_client, post_id):
        r = tf1_client.post(f"{BASE}/api/posts/{post_id}/comments/{uuid.uuid4().hex}/like", timeout=15)
        assert r.status_code == 404


# ---------- 2. Notifications ----------
class TestNotifications:
    def _list(self, client):
        r = client.get(f"{BASE}/api/notifications/list", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        return body.get("notifications") or body.get("items") or body.get("list") or []

    def test_top_comment_emits_to_post_author(self, tf1_client):
        items = self._list(tf1_client)
        assert any(n.get("kind") == "comment" for n in items), f"comment notification missing in {[n.get('kind') for n in items[:10]]}"

    def test_reply_emits_to_parent_author(self, tf2_client):
        # tf2 owns the top-level comment, stealth's reply should notify tf2
        items = self._list(tf2_client)
        assert any(n.get("kind") == "reply" for n in items), f"reply notification missing in {[n.get('kind') for n in items[:10]]}"

    def test_comment_like_emits(self, tf2_client, tf1_client, post_id):
        # tf1 likes tf2's top comment again
        tf1_client.post(f"{BASE}/api/posts/{post_id}/comments/{pytest.top_cid}/like", timeout=15)
        time.sleep(0.4)
        items = self._list(tf2_client)
        assert any(n.get("kind") == "comment_like" for n in items), f"comment_like notification missing in {[n.get('kind') for n in items[:10]]}"


# ---------- 3. Universal Reporting ----------
def _upload_image(client):
    """Upload one PNG via multipart, return image id."""
    # 1x1 PNG
    png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
           b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfc\xff"
           b"\xff?\x03\x00\x05\xfe\x02\xfe\xa3\x9aS\xae\x00\x00\x00\x00IEND\xaeB`\x82")
    # strip JSON content-type for multipart
    headers = {k: v for k, v in client.headers.items() if k.lower() != "content-type"}
    r = requests.post(f"{BASE}/api/images/upload",
                      headers=headers,
                      files={"file": ("t.png", io.BytesIO(png), "image/png")},
                      timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("image", {}).get("id")


class TestReportPost:
    def test_report_post_creates_ticket_and_dm(self, tf2_client, post_id, stealth_client):
        r = tf2_client.post(f"{BASE}/api/reports", json={
            "content_type": "post", "content_id": post_id,
            "reason": "spam", "detail": "TEST_PHASE4 spammy",
            "screenshots": []
        }, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["duplicate"] is False
        assert "ticket" in d and d["ticket"].get("ticket_number")
        pytest.report_ticket_id = d["ticket"]["id"]
        pytest.report_ticket_no = d["ticket"]["ticket_number"]

        # Subject prefix verified through admin endpoint
        admin = stealth_client
        rd = admin.get(f"{BASE}/api/admin/support/tickets/{pytest.report_ticket_id}/report", timeout=15)
        assert rd.status_code == 200, rd.text
        body = rd.json()
        assert body["ticket"]["subject"].startswith("[Report:Post]")
        assert body["report"]["reason"] == "spam"
        assert body["report"]["content_type"] == "post"
        assert isinstance(body["report"]["screenshots"], list)

    def test_duplicate_report_returns_existing_ticket(self, tf2_client, post_id):
        r = tf2_client.post(f"{BASE}/api/reports", json={
            "content_type": "post", "content_id": post_id,
            "reason": "spam"
        }, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["duplicate"] is True
        assert d["ticket"]["ticket_number"] == pytest.report_ticket_no

    def test_reporter_received_support_dm(self, tf2_client):
        # tf2 reported → @support DMs tf2
        r = tf2_client.get(f"{BASE}/api/messages/thread/support", timeout=20)
        assert r.status_code == 200, r.text
        msgs = r.json().get("messages", [])
        joined = " ".join((m.get("text") or "") for m in msgs)
        assert f"#{pytest.report_ticket_no}" in joined, f"confirmation DM missing in @support thread: {joined[:300]}"
        assert "Thanks for the report" in joined


class TestReportMessagePrivacy:
    def test_report_message_no_moderation_bump(self, tf1_client, tf2_client, stealth_client):
        # tf1 sends DM to tf2 — use a unique body so we don't re-report a prior msg
        unique_body = f"TEST_PHASE4 secret body {uuid.uuid4().hex[:8]}"
        send = tf1_client.post(f"{BASE}/api/messages", json={"to_username": "tftwo", "text": unique_body}, timeout=15)
        assert send.status_code in (200, 201), send.text
        # tf2 reports tf1's message
        thread = tf2_client.get(f"{BASE}/api/messages/thread/tfone", timeout=15).json()
        msgs = thread.get("messages", [])
        target = next((m for m in msgs if m.get("text") == unique_body), None)
        assert target, "test DM not found"
        mid = target["id"]

        r = tf2_client.post(f"{BASE}/api/reports", json={
            "content_type": "message", "content_id": mid, "reason": "harassment",
            "detail": "TEST_PHASE4 reporting msg"
        }, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] and not d["duplicate"], f"unexpected: {d}"
        tid = d["ticket"]["id"]

        # admin fetches report — must NOT leak text body
        rd = stealth_client.get(f"{BASE}/api/admin/support/tickets/{tid}/report", timeout=15).json()
        assert unique_body not in str(rd), f"message body leaked in report payload! {rd}"
        # Subject is metadata only
        assert rd["ticket"]["subject"].startswith("[Report:Message]")
        # No body in preview either
        assert unique_body not in (rd["ticket"].get("preview") or "")


class TestScreenshotsCap:
    def test_too_many_screenshots_silently_capped_to_8(self, tf1_client, stealth_client, post_id):
        # Use 10 random ids — image rows won't resolve, but cap is what we
        # assert here (response screenshots length stays <=8).
        ids = [uuid.uuid4().hex for _ in range(10)]
        sr = stealth_client.post(f"{BASE}/api/posts", json={"content": "TEST_PHASE4 cap post"}, timeout=15)
        assert sr.status_code in (200, 201)
        sp_id = sr.json().get("id") or sr.json().get("post", {}).get("id")
        r = tf1_client.post(f"{BASE}/api/reports", json={
            "content_type": "post", "content_id": sp_id,
            "reason": "other", "screenshots": ids
        }, timeout=20)
        assert r.status_code == 200, r.text
        tid = r.json()["ticket"]["id"]
        rd = stealth_client.get(f"{BASE}/api/admin/support/tickets/{tid}/report", timeout=15).json()
        assert len(rd["report"]["screenshots"]) <= 8

    def test_non_string_screenshots_rejected(self, tf1_client, post_id):
        r = tf1_client.post(f"{BASE}/api/reports", json={
            "content_type": "post", "content_id": post_id,
            "reason": "spam", "screenshots": [123, None]
        }, timeout=15)
        assert r.status_code in (400, 422), r.text


class TestReasonValidation:
    @pytest.mark.parametrize("reason", [
        "spam", "harassment", "hate_speech", "sexual_content", "self_harm",
        "violence", "misinformation", "scam_fraud", "impersonation",
        "privacy_concern", "other",
    ])
    def test_each_reason_accepted(self, tf1_client, stealth_client, reason):
        sr = stealth_client.post(f"{BASE}/api/posts", json={"content": f"TEST_PHASE4 r-{reason}"}, timeout=15)
        pid = sr.json().get("id") or sr.json().get("post", {}).get("id")
        r = tf1_client.post(f"{BASE}/api/reports", json={
            "content_type": "post", "content_id": pid, "reason": reason
        }, timeout=15)
        assert r.status_code == 200, f"{reason}: {r.text}"

    def test_invalid_reason_rejected(self, tf1_client, post_id):
        r = tf1_client.post(f"{BASE}/api/reports", json={
            "content_type": "post", "content_id": post_id, "reason": "bogus_reason"
        }, timeout=15)
        assert r.status_code == 400


class TestAdminReportEndpoint:
    def test_non_admin_forbidden(self, tf1_client):
        # Need any ticket id — use a known one (report_ticket_id from earlier)
        tid = getattr(pytest, "report_ticket_id", None)
        if not tid:
            pytest.skip("no ticket id available")
        r = tf1_client.get(f"{BASE}/api/admin/support/tickets/{tid}/report", timeout=15)
        assert r.status_code == 403, r.text

    def test_404_for_ticket_without_report(self, stealth_client, tf1_token):
        # Ensure a plain non-report ticket: tf1 calls /api/tickets/ensure
        cli = _client(tf1_token)
        r = cli.post(f"{BASE}/api/tickets/ensure", json={"subject": "TEST_PHASE4 plain"}, timeout=15)
        assert r.status_code == 200
        plain = r.json()["ticket"]
        rd = stealth_client.get(f"{BASE}/api/admin/support/tickets/{plain['id']}/report", timeout=15)
        assert rd.status_code == 404


class TestAtomicTicketCounter:
    def test_back_to_back_reports_get_monotonic_unique_numbers(self, tf2_client, stealth_client):
        # Create 5 fresh posts, fire 5 reports
        nums = []
        for i in range(5):
            sr = stealth_client.post(f"{BASE}/api/posts", json={"content": f"TEST_PHASE4 ctr-{i}-{uuid.uuid4().hex[:6]}"}, timeout=15)
            pid = sr.json().get("id") or sr.json().get("post", {}).get("id")
            r = tf2_client.post(f"{BASE}/api/reports", json={
                "content_type": "post", "content_id": pid, "reason": "spam"
            }, timeout=15)
            assert r.status_code == 200, r.text
            nums.append(r.json()["ticket"]["ticket_number"])
        assert len(set(nums)) == 5, f"collision detected: {nums}"
        assert nums == sorted(nums), f"non-monotonic: {nums}"


class TestContentTypeValidation:
    def test_unknown_content_type_400(self, tf1_client):
        r = tf1_client.post(f"{BASE}/api/reports", json={
            "content_type": "tweet", "content_id": "x", "reason": "spam"
        }, timeout=15)
        assert r.status_code == 400
