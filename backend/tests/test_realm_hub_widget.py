"""
Backend tests for the new Community Hub widget endpoints (Iteration 29).

Covers:
- POST /widgets {type:'hub'} as founder vs non-admin
- GET  /hub/posts returns is_admin true/false
- POST /hub/posts validation across kinds (photo/video/sound/thought/event/banana)
- Hub posts allow non-admin members; delete permissions (author/admin/other)
- Multiple posts: ordering newest-first + author hydration (id, username, name, avatar_url)
- Hub endpoints reject wrong widget type (poll widget id → 404)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
REALM = "dj"

FOUNDER = {"email": "stealth", "password": "Password1$"}
MEMBER = {"email": "tfone", "password": "pass1234"}


def _login(creds: dict) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def founder_h():
    return {"Authorization": f"Bearer {_login(FOUNDER)}"}


@pytest.fixture(scope="module")
def member_h():
    return {"Authorization": f"Bearer {_login(MEMBER)}"}


@pytest.fixture(scope="module")
def hub_widget(founder_h):
    """Create a fresh hub widget for the test session; clean up after."""
    r = requests.post(
        f"{BASE_URL}/api/communities/realm/{REALM}/widgets",
        json={"type": "hub", "size": "medium"},
        headers=founder_h,
        timeout=20,
    )
    assert r.status_code == 200, r.text
    w = r.json()
    assert w["type"] == "hub"
    assert w["size"] == "medium"
    assert w["config"]["title"] == "Community Hub"
    assert "subtitle" in w["config"]
    assert isinstance(w["position"], int) and w["position"] >= 1
    yield w
    # Teardown
    requests.delete(
        f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{w['id']}",
        headers=founder_h,
        timeout=20,
    )


@pytest.fixture(scope="module")
def poll_widget_id(founder_h):
    """Pick any existing poll widget on /realms/dj (auto-created) for wrong-type test."""
    r = requests.get(
        f"{BASE_URL}/api/communities/realm/{REALM}/widgets",
        headers=founder_h,
        timeout=20,
    )
    assert r.status_code == 200, r.text
    for w in r.json().get("widgets", []):
        if w.get("type") == "poll":
            return w["id"]
    pytest.skip("no poll widget present on /realms/dj")


# ─── 1. create-widget permission ─────────────────────────────────────
class TestHubWidgetCreate:
    def test_non_admin_cannot_create(self, member_h):
        r = requests.post(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets",
            json={"type": "hub", "size": "medium"},
            headers=member_h,
            timeout=20,
        )
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_founder_can_create(self, hub_widget):
        # Fixture itself asserts type/config/size; just sanity here.
        assert hub_widget["type"] == "hub"
        assert hub_widget["config"]["title"] == "Community Hub"


# ─── 2. GET posts + is_admin flag ────────────────────────────────────
class TestHubPostsList:
    def test_founder_sees_is_admin_true(self, founder_h, hub_widget):
        r = requests.get(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{hub_widget['id']}/hub/posts",
            headers=founder_h,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "posts" in data and isinstance(data["posts"], list)
        assert data["is_admin"] is True

    def test_member_sees_is_admin_false(self, member_h, hub_widget):
        r = requests.get(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{hub_widget['id']}/hub/posts",
            headers=member_h,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["is_admin"] is False


# ─── 3. Validation matrix ────────────────────────────────────────────
class TestHubPostValidation:
    base = "/api/communities/realm"

    def _post(self, h, wid, body):
        return requests.post(
            f"{BASE_URL}{self.base}/{REALM}/widgets/{wid}/hub/posts",
            json=body, headers=h, timeout=20,
        )

    def test_thought_empty_text_400(self, founder_h, hub_widget):
        r = self._post(founder_h, hub_widget["id"], {"kind": "thought", "text": ""})
        assert r.status_code == 400
        assert "thought" in r.json().get("detail", "").lower()

    def test_photo_missing_media_400(self, founder_h, hub_widget):
        r = self._post(founder_h, hub_widget["id"], {"kind": "photo", "media_url": ""})
        assert r.status_code == 400
        assert "photo" in r.json().get("detail", "").lower()

    def test_event_empty_text_400(self, founder_h, hub_widget):
        r = self._post(founder_h, hub_widget["id"], {"kind": "event", "text": ""})
        assert r.status_code == 400

    def test_unknown_kind_400(self, founder_h, hub_widget):
        r = self._post(founder_h, hub_widget["id"], {"kind": "banana", "text": "x"})
        assert r.status_code == 400
        assert "kind" in r.json().get("detail", "").lower()

    def test_thought_ok_author_hydrated(self, founder_h, hub_widget):
        r = self._post(founder_h, hub_widget["id"], {"kind": "thought", "text": "hi from pytest"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["kind"] == "thought"
        assert data["text"] == "hi from pytest"
        assert "author" in data and data["author"].get("username", "").lower() == "stealth"
        # Cleanup
        requests.delete(
            f"{BASE_URL}{self.base}/{REALM}/widgets/{hub_widget['id']}/hub/posts/{data['id']}",
            headers=founder_h, timeout=20,
        )


# ─── 4. Permissions: member can post; delete rules ───────────────────
class TestHubPostPermissions:
    def test_member_can_post_and_delete_own(self, member_h, founder_h, hub_widget):
        # tfone posts a thought
        r = requests.post(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{hub_widget['id']}/hub/posts",
            json={"kind": "thought", "text": "TEST_member_post"},
            headers=member_h, timeout=20,
        )
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        assert r.json()["author"]["username"].lower() == "tfone"

        # tfone deletes own post
        r2 = requests.delete(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{hub_widget['id']}/hub/posts/{pid}",
            headers=member_h, timeout=20,
        )
        assert r2.status_code == 200

    def test_admin_can_delete_others_post(self, member_h, founder_h, hub_widget):
        r = requests.post(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{hub_widget['id']}/hub/posts",
            json={"kind": "thought", "text": "TEST_admin_will_delete"},
            headers=member_h, timeout=20,
        )
        pid = r.json()["id"]
        r2 = requests.delete(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{hub_widget['id']}/hub/posts/{pid}",
            headers=founder_h, timeout=20,
        )
        assert r2.status_code == 200

    def test_non_author_non_admin_cannot_delete(self, member_h, founder_h, hub_widget):
        # founder posts; tfone tries to delete -> 403
        r = requests.post(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{hub_widget['id']}/hub/posts",
            json={"kind": "thought", "text": "TEST_founder_post"},
            headers=founder_h, timeout=20,
        )
        pid = r.json()["id"]
        r2 = requests.delete(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{hub_widget['id']}/hub/posts/{pid}",
            headers=member_h, timeout=20,
        )
        assert r2.status_code == 403
        # cleanup
        requests.delete(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{hub_widget['id']}/hub/posts/{pid}",
            headers=founder_h, timeout=20,
        )


# ─── 5. Multiple posts: ordering + hydration ─────────────────────────
class TestHubPostsOrderingAndHydration:
    def test_newest_first_and_authors_hydrated(self, founder_h, hub_widget):
        bodies = [
            {"kind": "photo",   "media_url": "https://example.com/a.jpg",  "text": "p1"},
            {"kind": "video",   "media_url": "https://example.com/a.mp4",  "text": "v1"},
            {"kind": "thought", "text": "TEST_thought_last"},
        ]
        created_ids = []
        for b in bodies:
            r = requests.post(
                f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{hub_widget['id']}/hub/posts",
                json=b, headers=founder_h, timeout=20,
            )
            assert r.status_code == 200, r.text
            created_ids.append(r.json()["id"])

        r = requests.get(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{hub_widget['id']}/hub/posts",
            headers=founder_h, timeout=20,
        )
        assert r.status_code == 200
        posts = r.json()["posts"]
        # The 3 newest should be in reverse insertion order.
        top3_ids = [p["id"] for p in posts[:3]]
        assert top3_ids == list(reversed(created_ids)), f"order wrong: {top3_ids} vs {created_ids}"
        for p in posts[:3]:
            a = p.get("author") or {}
            assert "id" in a and "username" in a
            # name + avatar_url keys must be present (may be empty string / None)
            assert "name" in a
            assert "avatar_url" in a
        # cleanup
        for pid in created_ids:
            requests.delete(
                f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{hub_widget['id']}/hub/posts/{pid}",
                headers=founder_h, timeout=20,
            )


# ─── 6. Wrong widget-type guard ──────────────────────────────────────
class TestHubWrongWidgetType:
    def test_post_to_poll_widget_404(self, founder_h, poll_widget_id):
        r = requests.post(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{poll_widget_id}/hub/posts",
            json={"kind": "thought", "text": "x"},
            headers=founder_h, timeout=20,
        )
        assert r.status_code == 404
        assert "hub widget not found" in r.json().get("detail", "").lower()

    def test_get_on_poll_widget_404(self, founder_h, poll_widget_id):
        r = requests.get(
            f"{BASE_URL}/api/communities/realm/{REALM}/widgets/{poll_widget_id}/hub/posts",
            headers=founder_h, timeout=20,
        )
        assert r.status_code == 404
