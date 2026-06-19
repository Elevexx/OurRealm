"""Backend tests for: Promote hashtag → Featured Interest Card,
reorder/delete, public listing, analytics, 403 negative-auth, storage status.
"""
import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
FOUNDER = {"email": "stealth", "password": "Password1$"}
USER = {"email": "tfone", "password": "pass1234"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def founder_token():
    return _login(FOUNDER)


@pytest.fixture(scope="module")
def user_token():
    return _login(USER)


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ── PROMOTE / IDEMPOTENCY ──────────────────────────────────────────────
class TestPromote:
    def test_promote_music_creates_or_refreshes(self, founder_token):
        r = requests.post(
            f"{BASE_URL}/api/hashtags/music/promote-to-interest",
            headers=_h(founder_token), timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "card" in body and "created" in body
        card = body["card"]
        assert card["label"] == "music"
        assert card["is_featured"] is True
        assert card["is_enabled"] is True
        assert "sort_order" in card
        assert "id" in card

    def test_promote_idempotent(self, founder_token):
        r1 = requests.post(
            f"{BASE_URL}/api/hashtags/music/promote-to-interest",
            headers=_h(founder_token), timeout=20,
        )
        r2 = requests.post(
            f"{BASE_URL}/api/hashtags/music/promote-to-interest",
            headers=_h(founder_token), timeout=20,
        )
        assert r1.status_code == 200 and r2.status_code == 200
        # Second call MUST be created:false (idempotent)
        assert r2.json()["created"] is False
        # Same card id
        assert r1.json()["card"]["id"] == r2.json()["card"]["id"]

    def test_promote_crypto_and_memes(self, founder_token):
        for tag in ("crypto", "memes"):
            r = requests.post(
                f"{BASE_URL}/api/hashtags/{tag}/promote-to-interest",
                headers=_h(founder_token), timeout=20,
            )
            assert r.status_code == 200, r.text
            assert r.json()["card"]["label"] == tag

    def test_promote_rejects_non_admin(self, user_token):
        r = requests.post(
            f"{BASE_URL}/api/hashtags/sometag/promote-to-interest",
            headers=_h(user_token), timeout=20,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


# ── PUBLIC LIST ────────────────────────────────────────────────────────
class TestList:
    def test_public_list_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/hashtags/interest-cards", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "cards" in body and isinstance(body["cards"], list)
        labels = [c["label"] for c in body["cards"]]
        # Promoted cards should be visible
        assert "music" in labels
        assert "crypto" in labels

    def test_list_sorted_by_sort_order(self):
        r = requests.get(f"{BASE_URL}/api/hashtags/interest-cards", timeout=20)
        cards = r.json()["cards"]
        orders = [c.get("sort_order", 0) for c in cards]
        assert orders == sorted(orders), f"cards not sorted by sort_order: {orders}"


# ── REORDER ────────────────────────────────────────────────────────────
class TestReorder:
    def test_reorder_music_first_then_crypto(self, founder_token):
        r = requests.patch(
            f"{BASE_URL}/api/hashtags/interest-cards/reorder",
            headers=_h(founder_token), json={"order": ["music", "crypto"]}, timeout=20,
        )
        assert r.status_code == 200, r.text
        # Verify ordering
        listed = requests.get(f"{BASE_URL}/api/hashtags/interest-cards", timeout=20).json()["cards"]
        labels = [c["label"] for c in listed if c["label"] in ("music", "crypto")]
        assert labels[:2] == ["music", "crypto"], f"got {labels}"

    def test_reorder_crypto_first(self, founder_token):
        r = requests.patch(
            f"{BASE_URL}/api/hashtags/interest-cards/reorder",
            headers=_h(founder_token), json={"order": ["crypto", "music"]}, timeout=20,
        )
        assert r.status_code == 200
        listed = requests.get(f"{BASE_URL}/api/hashtags/interest-cards", timeout=20).json()["cards"]
        labels = [c["label"] for c in listed if c["label"] in ("music", "crypto")]
        assert labels[:2] == ["crypto", "music"]

    def test_reorder_rejects_non_admin(self, user_token):
        r = requests.patch(
            f"{BASE_URL}/api/hashtags/interest-cards/reorder",
            headers=_h(user_token), json={"order": ["music"]}, timeout=20,
        )
        assert r.status_code == 403


# ── ANALYTICS ──────────────────────────────────────────────────────────
class TestAnalytics:
    def test_analytics_window_7d(self, founder_token):
        r = requests.get(
            f"{BASE_URL}/api/hashtags/interest-cards/analytics?window=7d",
            headers=_h(founder_token), timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["window"] == "7d"
        assert isinstance(body["cards"], list)
        if body["cards"]:
            m = body["cards"][0]["metrics"]
            assert "users_selecting" in m
            assert "post_count" in m
            assert "engagement" in m
            assert "likes" in m["engagement"]
            assert "comments" in m["engagement"]
            assert "total" in m["engagement"]
            assert "growth_posts" in m

    def test_analytics_rejects_non_admin(self, user_token):
        r = requests.get(
            f"{BASE_URL}/api/hashtags/interest-cards/analytics",
            headers=_h(user_token), timeout=20,
        )
        assert r.status_code == 403


# ── DELETE ─────────────────────────────────────────────────────────────
class TestDelete:
    def test_delete_rejects_non_admin(self, user_token, founder_token):
        # Make sure a card exists
        requests.post(
            f"{BASE_URL}/api/hashtags/temptag/promote-to-interest",
            headers=_h(founder_token), timeout=20,
        )
        r = requests.delete(
            f"{BASE_URL}/api/hashtags/interest-cards/temptag",
            headers=_h(user_token), timeout=20,
        )
        assert r.status_code == 403

    def test_delete_removes_card(self, founder_token):
        # Promote `memes` then delete it
        requests.post(
            f"{BASE_URL}/api/hashtags/memes/promote-to-interest",
            headers=_h(founder_token), timeout=20,
        )
        r = requests.delete(
            f"{BASE_URL}/api/hashtags/interest-cards/memes",
            headers=_h(founder_token), timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        # No longer in listing
        listed = requests.get(f"{BASE_URL}/api/hashtags/interest-cards", timeout=20).json()["cards"]
        labels = [c["label"] for c in listed]
        assert "memes" not in labels

    def test_delete_unknown_returns_404(self, founder_token):
        r = requests.delete(
            f"{BASE_URL}/api/hashtags/interest-cards/this-tag-doesnt-exist-xyz",
            headers=_h(founder_token), timeout=20,
        )
        assert r.status_code == 404

    def test_cleanup_temptag(self, founder_token):
        requests.delete(
            f"{BASE_URL}/api/hashtags/interest-cards/temptag",
            headers=_h(founder_token), timeout=20,
        )


# ── COPYRIGHT QUEUE ────────────────────────────────────────────────────
class TestCopyrightQueue:
    def test_queue_founder(self, founder_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/moderation/copyright/queue?status=open",
            headers=_h(founder_token), timeout=20,
        )
        assert r.status_code == 200, r.text
        assert "reports" in r.json()

    def test_queue_rejects_non_admin(self, user_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/moderation/copyright/queue",
            headers=_h(user_token), timeout=20,
        )
        assert r.status_code == 403


# ── STORAGE STATUS ─────────────────────────────────────────────────────
class TestStorageStatus:
    def test_storage_status(self, founder_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/storage/status",
            headers=_h(founder_token), timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["uploads_root"] == "/data/ourrealm"
        assert body["persistent_configured"] is True
