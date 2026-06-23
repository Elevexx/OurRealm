"""
P3 + P4 regression tests for the OurRealm /messages overhaul.

Covers:
- Threads pin / unpin moves a thread to the top of GET /api/messages/threads
- DELETE /api/messages/threads/{username} hides only for the deleter
- Hidden thread is revived for the deleter when the peer sends a new message
- PATCH /api/community-chats/messages/{message_id} -> edited_at set, body updated
- DELETE /api/community-chats/messages/{message_id} -> removed from GET list
- 403 when a non-author non-admin tries to delete someone else's community msg
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")

STEALTH = {"email": "slopestyle2022@gmail.com", "password": "Password1$", "username": "stealth"}
TFONE   = {"email": "testfriend1@example.com",  "password": "pass1234",    "username": "tfone"}
TFTWO   = {"email": "testfriend2@example.com",  "password": "pass1234",    "username": "tftwo"}

# DJ Realm chat (stealth is member). Realm-type chats accept any authenticated user.
REALM_CHAT_ID = "f73c942f998548b9bccc87bd7b48950f"


# --------------------------------------------------------------------- session helpers
def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": creds["email"], "password": creds["password"]},
               timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in login response: {r.text}"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def s_stealth():
    return _login(STEALTH)

@pytest.fixture(scope="module")
def s_tfone():
    return _login(TFONE)

@pytest.fixture(scope="module")
def s_tftwo():
    return _login(TFTWO)


def _threads(sess):
    r = sess.get(f"{BASE_URL}/api/messages/threads", timeout=15)
    assert r.status_code == 200, r.text
    return r.json().get("threads", [])

def _peer_thread(threads, username):
    for t in threads:
        if (t.get("peer") or {}).get("username") == username:
            return t
    return None


# --------------------------------------------------------------------- P3 — pin / unpin
class TestThreadsPinUnpin:
    """POST /api/messages/threads/pin + unpin behaviour"""

    def test_pin_moves_thread_to_top(self, s_tfone):
        # Ensure stealth thread exists by sending a small ping
        s_tfone.post(f"{BASE_URL}/api/messages",
                     json={"to_username": "stealth", "text": f"TEST_p3_ping_{uuid.uuid4().hex[:6]}"},
                     timeout=15)

        # Unpin first to start from a clean baseline
        s_tfone.post(f"{BASE_URL}/api/messages/threads/unpin",
                     json={"peer_username": "stealth"}, timeout=10)

        r = s_tfone.post(f"{BASE_URL}/api/messages/threads/pin",
                         json={"peer_username": "stealth"}, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True and body.get("pinned") is True

        threads = _threads(s_tfone)
        assert threads, "thread list empty after pinning"
        # First thread should be stealth and is_pinned
        assert threads[0]["peer"]["username"] == "stealth", \
            f"pinned thread not first; got {[t['peer']['username'] for t in threads[:3]]}"
        assert threads[0]["is_pinned"] is True

    def test_unpin_clears_flag(self, s_tfone):
        r = s_tfone.post(f"{BASE_URL}/api/messages/threads/unpin",
                         json={"peer_username": "stealth"}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("pinned") is False

        threads = _threads(s_tfone)
        t = _peer_thread(threads, "stealth")
        assert t is not None
        assert t["is_pinned"] is False


# --------------------------------------------------------------------- P3 — delete + revive
class TestThreadDeleteAndRevive:
    """DELETE /api/messages/threads/{username} hides only for the deleter
    and revives when the peer sends a NEW message."""

    def test_delete_hides_only_for_deleter(self, s_tfone, s_stealth):
        # Make sure both sides have a recent message
        s_tfone.post(f"{BASE_URL}/api/messages",
                     json={"to_username": "stealth", "text": "TEST_p3_pre_delete"},
                     timeout=15)

        # tfone deletes the stealth thread
        r = s_tfone.delete(f"{BASE_URL}/api/messages/threads/stealth", timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("deleted") is True

        # stealth side still sees the thread
        stealth_threads = _threads(s_stealth)
        assert _peer_thread(stealth_threads, "tfone") is not None, \
            "peer (stealth) should still see the thread after tfone deleted it"

        # tfone no longer sees the stealth thread
        tfone_threads = _threads(s_tfone)
        assert _peer_thread(tfone_threads, "stealth") is None, \
            "deleter (tfone) should not see the hidden thread"

    def test_thread_revives_on_new_peer_message(self, s_tfone, s_stealth):
        # The peer (stealth) sends a fresh message -> hidden_at < new created_at
        # so the revive logic should put the thread back for tfone
        time.sleep(1.2)  # ensure created_at > hidden_at in ISO comparison
        r = s_stealth.post(f"{BASE_URL}/api/messages",
                           json={"to_username": "tfone",
                                 "text": f"TEST_p3_revive_{uuid.uuid4().hex[:6]}"},
                           timeout=15)
        assert r.status_code in (200, 201), r.text

        tfone_threads = _threads(s_tfone)
        revived = _peer_thread(tfone_threads, "stealth")
        assert revived is not None, \
            f"stealth thread should reappear for tfone after new peer message. " \
            f"Got threads: {[t['peer']['username'] for t in tfone_threads]}"


# --------------------------------------------------------------------- P4 — community message edit / delete
class TestCommunityMessageEditDelete:
    """PATCH + DELETE /api/community-chats/messages/{id}"""

    def _send(self, sess, body):
        r = sess.post(f"{BASE_URL}/api/community-chats/{REALM_CHAT_ID}/messages",
                      json={"body": body}, timeout=15)
        assert r.status_code == 200, r.text
        m = r.json()
        assert m.get("id"), f"no id in send response: {r.text}"
        return m

    def _list_ids(self, sess):
        r = sess.get(f"{BASE_URL}/api/community-chats/{REALM_CHAT_ID}/messages",
                     timeout=15)
        assert r.status_code == 200, r.text
        return [m["id"] for m in r.json().get("messages", [])]

    def test_edit_updates_body_and_sets_edited_at(self, s_stealth):
        m = self._send(s_stealth, f"TEST_p4_edit_orig_{uuid.uuid4().hex[:6]}")
        new_body = f"TEST_p4_edit_new_{uuid.uuid4().hex[:6]}"
        r = s_stealth.patch(f"{BASE_URL}/api/community-chats/messages/{m['id']}",
                            json={"body": new_body}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        fresh = body.get("message") or {}
        assert fresh.get("body") == new_body
        assert fresh.get("edited_at"), "edited_at not stamped"

        # cleanup
        s_stealth.delete(f"{BASE_URL}/api/community-chats/messages/{m['id']}", timeout=10)

    def test_delete_removes_from_listing(self, s_stealth):
        m = self._send(s_stealth, f"TEST_p4_del_{uuid.uuid4().hex[:6]}")
        assert m["id"] in self._list_ids(s_stealth)

        r = s_stealth.delete(f"{BASE_URL}/api/community-chats/messages/{m['id']}",
                             timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        assert m["id"] not in self._list_ids(s_stealth), \
            "deleted community message still appears in GET listing"

    def test_non_author_normal_member_gets_403(self, s_stealth, s_tfone):
        m = self._send(s_stealth, f"TEST_p4_403_{uuid.uuid4().hex[:6]}")
        # tfone is a normal member trying to delete stealth's message
        # PATCH path
        r1 = s_tfone.patch(f"{BASE_URL}/api/community-chats/messages/{m['id']}",
                           json={"body": "hijack"}, timeout=10)
        assert r1.status_code == 403, f"edit by non-author should be 403, got {r1.status_code} {r1.text}"

        # DELETE path — stealth is FOUNDER so the admin-bypass kicks in; we
        # only require non-author members to get 403. tfone is normal so
        # this must fail.
        r2 = s_tfone.delete(f"{BASE_URL}/api/community-chats/messages/{m['id']}",
                            timeout=10)
        assert r2.status_code == 403, f"delete by non-author normal member should be 403, got {r2.status_code} {r2.text}"

        # cleanup as author
        s_stealth.delete(f"{BASE_URL}/api/community-chats/messages/{m['id']}", timeout=10)
