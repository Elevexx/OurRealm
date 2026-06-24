"""Backend tests for the 15-widget allow-list + char limits + polls voting.

Tests cover:
- PATCH /api/profile/me silently drops deprecated widget types
- Notes char limit enforcement (VIP=500, stealth=unlimited)
- Blog char limit enforcement
- Videos max 4 items
- Music/Podcasts max 10 sound_ids
- Public profile filter via GET /api/profile/by-username/{u}
- Polls vote endpoint (auth POST + public GET, idempotent upsert)
- GET /api/sounds/by-user/{u}?category=Music
- Migration idempotency on boot (log line check)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "stealth": {"email": "slopestyle2022@gmail.com", "password": "Password1$"},
    "tftwo":   {"email": "testfriend2@example.com", "password": "pass1234"},
    "tfone":   {"email": "testfriend1@example.com", "password": "pass1234"},
}

ALLOWED = {"myfeed","top8","live","videos","music","podcasts","photos","events","weather",
           "calendar","countdown","notes","polls","survey","blog","radar"}


def _login(username: str) -> requests.Session:
    s = requests.Session()
    c = CREDS[username]
    r = s.post(f"{API}/auth/login", json={"email": c["email"], "password": c["password"]})
    assert r.status_code == 200, f"login {username} -> {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def stealth_s():
    return _login("stealth")


@pytest.fixture(scope="module")
def tftwo_s():
    return _login("tftwo")


@pytest.fixture(scope="module")
def tfone_s():
    return _login("tfone")


# ---------- 1. allow-list strip ----------
class TestWidgetAllowList:
    def test_patch_strips_deprecated_types(self, tftwo_s):
        payload = {"widgets": [
            {"id": "w-top8-test", "type": "top8"},
            {"id": "w-merch-test", "type": "merch", "items": []},
            {"id": "w-wallet-test", "type": "wallet"},
            {"id": "w-crypto-test", "type": "crypto"},
            {"id": "w-myfeed-test", "type": "myfeed"},
        ]}
        r = tftwo_s.patch(f"{API}/profile/me", json=payload)
        assert r.status_code == 200, r.text
        wtypes = [w["type"] for w in r.json()["user"]["widgets"]]
        assert "merch" not in wtypes
        assert "wallet" not in wtypes
        assert "crypto" not in wtypes
        assert "top8" in wtypes
        assert "myfeed" in wtypes
        # every remaining type must be in allow-list (Phase-16 includes photos)
        for t in wtypes:
            assert t in ALLOWED, f"Unexpected type {t} survived strip"


# ---------- 2. notes char limit ----------
class TestNotesCharLimit:
    def test_vip_notes_600_rejected(self, tftwo_s):
        widgets = [{"id": "w-notes-vip", "type": "notes", "text": "A" * 600}]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": widgets})
        assert r.status_code == 400
        assert "Notes" in r.json().get("detail", "")
        assert "500" in r.json().get("detail", "")

    def test_vip_notes_500_accepted(self, tftwo_s):
        widgets = [{"id": "w-notes-vip", "type": "notes", "text": "A" * 500}]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": widgets})
        assert r.status_code == 200, r.text

    def test_stealth_notes_3000_accepted(self, stealth_s):
        # preserve stealth's current widgets, just include a long notes widget
        me = stealth_s.get(f"{API}/profile/me").json()
        existing = me["user"].get("widgets") or []
        # remove any prior notes-stress widget so we don't pile up
        kept = [w for w in existing if w.get("id") != "w-notes-stress"]
        new_widgets = kept + [{"id": "w-notes-stress", "type": "notes", "text": "A" * 3000}]
        r = stealth_s.patch(f"{API}/profile/me", json={"widgets": new_widgets})
        assert r.status_code == 200, r.text
        # cleanup
        stealth_s.patch(f"{API}/profile/me", json={"widgets": kept})


# ---------- 3. blog char limit ----------
class TestBlogCharLimit:
    def test_vip_blog_2100_rejected(self, tftwo_s):
        widgets = [{"id": "w-blog-vip", "type": "blog", "text": "A" * 2100}]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": widgets})
        assert r.status_code == 400
        assert "Blog" in r.json().get("detail", "") or "blog" in r.json().get("detail", "").lower()

    def test_stealth_blog_5000_accepted(self, stealth_s):
        me = stealth_s.get(f"{API}/profile/me").json()
        existing = me["user"].get("widgets") or []
        kept = [w for w in existing if w.get("id") != "w-blog-stress"]
        new = kept + [{"id": "w-blog-stress", "type": "blog", "text": "A" * 5000}]
        r = stealth_s.patch(f"{API}/profile/me", json={"widgets": new})
        assert r.status_code == 200, r.text
        stealth_s.patch(f"{API}/profile/me", json={"widgets": kept})


# ---------- 4. videos limit ----------
class TestVideosLimit:
    def test_videos_5_rejected(self, tftwo_s):
        items = [{"id": f"v{i}", "url": f"http://x/{i}.mp4"} for i in range(5)]
        widgets = [{"id": "w-vid", "type": "videos", "items": items}]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": widgets})
        assert r.status_code == 400
        d = r.json().get("detail", "").lower()
        assert "videos" in d and "4" in d


# ---------- 5. music/podcasts limit ----------
class TestSoundsLimit:
    def test_music_11_rejected(self, tftwo_s):
        widgets = [{"id": "w-music", "type": "music",
                    "sound_ids": [f"s{i}" for i in range(11)]}]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": widgets})
        assert r.status_code == 400
        d = r.json().get("detail", "").lower()
        assert "music" in d and "10" in d

    def test_podcasts_11_rejected(self, tftwo_s):
        widgets = [{"id": "w-pod", "type": "podcasts",
                    "sound_ids": [f"s{i}" for i in range(11)]}]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": widgets})
        assert r.status_code == 400
        d = r.json().get("detail", "").lower()
        assert "podcasts" in d and "10" in d


# ---------- 6. public profile filter ----------
class TestPublicProfileFilter:
    def test_stealth_public_only_allowed(self):
        r = requests.get(f"{API}/profile/by-username/stealth")
        assert r.status_code == 200, r.text
        widgets = r.json()["user"].get("widgets") or []
        types = [w.get("type") for w in widgets]
        for t in types:
            assert t in ALLOWED, f"Disallowed widget type leaked publicly: {t}"
        assert "merch" not in types
        assert "custom" not in types


# ---------- 7. polls vote endpoint ----------
class TestPollsVote:
    def test_polls_full_cycle(self, tftwo_s, tfone_s):
        # Owner adds poll widget
        poll = {
            "id": "w-poll-test",
            "type": "polls",
            "question": "Q?",
            "options": [{"id": "o1", "text": "A"}, {"id": "o2", "text": "B"}],
        }
        me = tftwo_s.get(f"{API}/profile/me").json()["user"]
        kept = [w for w in (me.get("widgets") or []) if w.get("id") != "w-poll-test"]
        r = tftwo_s.patch(f"{API}/profile/me", json={"widgets": kept + [poll]})
        assert r.status_code == 200, r.text

        # tfone votes
        r = tfone_s.post(f"{API}/profile-poll/tftwo/w-poll-test/vote",
                         json={"option_id": "o1"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total_votes"] == 1
        o1 = next(o for o in body["options"] if o["id"] == "o1")
        assert o1["votes"] == 1

        # Re-vote same option -> idempotent
        r2 = tfone_s.post(f"{API}/profile-poll/tftwo/w-poll-test/vote",
                          json={"option_id": "o1"})
        assert r2.status_code == 200
        assert r2.json()["total_votes"] == 1

        # Public GET (no auth)
        r3 = requests.get(f"{API}/profile-poll/tftwo/w-poll-test")
        assert r3.status_code == 200
        assert r3.json()["total_votes"] == 1
        assert r3.json()["question"] == "Q?"


# ---------- 8. sounds by-user ----------
class TestSoundsByUser:
    def test_stealth_music_tracks(self):
        r = requests.get(f"{API}/sounds/by-user/stealth", params={"category": "Music"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "tracks" in body
        assert isinstance(body["tracks"], list)


# ---------- 9. migration idempotency ----------
class TestMigrationIdempotent:
    def test_no_strip_on_clean_boot(self):
        # Restart backend, then grep log
        import subprocess
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=False)
        time.sleep(6)
        # Wait for server to come back
        for _ in range(20):
            try:
                if requests.get(f"{API}/health", timeout=2).status_code in (200, 404):
                    break
            except Exception:
                time.sleep(1)
        # check logs
        out = subprocess.run(
            ["bash", "-lc",
             "tail -n 200 /var/log/supervisor/backend.err.log /var/log/supervisor/backend.out.log 2>/dev/null"],
            capture_output=True, text=True,
        )
        log = (out.stdout or "") + (out.stderr or "")
        # Find the most recent strip line
        lines = [ln for ln in log.splitlines() if "Stripped deprecated widgets" in ln]
        if not lines:
            return  # acceptable — log line absent means 0 strips
        last = lines[-1]
        # last log should report 0 strips (idempotent)
        assert ("from 0 profiles" in last) or (" 0 profiles" in last), \
            f"Migration is not idempotent — last strip log line: {last!r}"
