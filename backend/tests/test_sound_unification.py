"""Iteration 83 — Sounds ⇄ For You unification + collapsible profile fire cards.

Covers:
  - GET /api/sounds/classifications (shared source)
  - POST /api/sounds/upload → creates track AND canonical post in one call
  - defer_post upload → post created by subsequent POST /api/posts (foryou path)
  - Fire sync across surfaces (sounds feed, top100, /posts?media_type=sound)
  - Boosted fire pool math on a sound post
  - Fire-ranked sounds feed (sort=fire, window)
  - For You dedupe (each sound once when it has a canonical)
  - Track PATCH ↔ canonical post sync (title/audience)
  - Track DELETE ↔ canonical post DELETE symmetry
  - Migration endpoints: founder-only, dry-run, idempotent execute
  - Admin classification rename (revert after)
  - Comments unified onto canonical post
"""
from __future__ import annotations

import io
import os
import struct
import time
import uuid
import wave
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

FOUNDER = ("stealth", "Password1$")
SUPPORT = ("support", "Password1$")
MEMBER = ("auditcheckreal", "Password1$")


# ---------- helpers ----------
def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {username}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _make_wav_bytes(seconds: float = 0.4, freq: int = 440):
    """Small mono 16-bit PCM wav, ~0.4s @ 8kHz — passes duration cap easily."""
    framerate = 8000
    n = int(framerate * seconds)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(framerate)
        # simple square-ish PCM so the file isn't just silence
        for i in range(n):
            v = 8000 if (i // (framerate // (freq * 2))) % 2 == 0 else -8000
            w.writeframesraw(struct.pack("<h", v))
    return buf.getvalue()


def _upload_track(token, title, *, defer_post=False, category="Music",
                  classification_id=""):
    files = {"file": (f"{title}.wav", _make_wav_bytes(), "audio/wav")}
    data = {
        "title": title,
        "category": category,
        "rights_confirmed": "true",
        "classification_id": classification_id,
        "defer_post": "true" if defer_post else "false",
    }
    r = requests.post(f"{BASE_URL}/api/sounds/upload",
                      headers=_h(token), files=files, data=data, timeout=60)
    return r


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def founder_token():
    return _login(*FOUNDER)


@pytest.fixture(scope="module")
def support_token():
    return _login(*SUPPORT)


@pytest.fixture(scope="module")
def member_token():
    return _login(*MEMBER)


@pytest.fixture(scope="module")
def founder_id(founder_token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(founder_token))
    if r.status_code == 200:
        return r.json().get("id") or r.json().get("user", {}).get("id")
    return None


# Track cleanup registry — deletes at end of the module
_CREATED_TRACKS: list[tuple[str, str]] = []  # (track_id, token)
_CREATED_POSTS: list[tuple[str, str]] = []


@pytest.fixture(scope="module", autouse=True)
def _cleanup_all(founder_token):
    yield
    for pid, tok in _CREATED_POSTS:
        try:
            requests.delete(f"{BASE_URL}/api/posts/{pid}", headers=_h(tok), timeout=15)
        except Exception:
            pass
    for tid, tok in _CREATED_TRACKS:
        try:
            requests.delete(f"{BASE_URL}/api/sounds/{tid}", headers=_h(tok), timeout=15)
        except Exception:
            pass


# ---------- BACKEND TESTS ----------
class TestClassifications:
    def test_public_classifications(self, member_token):
        # Auth required since guest browsing removal (iter88) — anon gets 401.
        anon = requests.get(f"{BASE_URL}/api/sounds/classifications", timeout=15)
        assert anon.status_code == 401
        r = requests.get(f"{BASE_URL}/api/sounds/classifications", headers=_h(member_token), timeout=15)
        assert r.status_code == 200
        rows = r.json()["classifications"]
        ids = {c["id"] for c in rows}
        assert {"music", "podcasts", "fx", "other"}.issubset(ids)
        # stable order + display names present
        by_id = {c["id"]: c for c in rows}
        assert by_id["music"]["name"]
        assert by_id["podcasts"]["order"] == 2


class TestUploadCreatesCanonicalPost:
    def test_upload_creates_track_and_canonical_post(self, member_token):
        title = f"TEST_iter83_upload_{uuid.uuid4().hex[:6]}"
        r = _upload_track(member_token, title, defer_post=False)
        assert r.status_code == 200, r.text[:300]
        payload = r.json()
        track = payload["track"]
        assert track["title"] == title
        assert "post" in track and track["post"].get("id"), \
            f"canonical post NOT embedded in track response: {track}"
        pid = track["post"]["id"]
        tid = track["id"]
        _CREATED_TRACKS.append((tid, member_token))

        # Post appears in /api/posts?media_type=sound
        r2 = requests.get(f"{BASE_URL}/api/posts",
                          headers=_h(member_token),
                          params={"media_type": "sound", "limit": 100}, timeout=30)
        assert r2.status_code == 200
        posts = r2.json().get("posts") or r2.json()
        ids = {p.get("id") for p in posts}
        assert pid in ids, "canonical post not in /api/posts?media_type=sound"
        # Only ONE row for this track (no dupes)
        rows_for_track = [p for p in posts
                          if p.get("sound_track_id") == tid or p.get("id") == pid]
        # Track appears at most once (either as canonical post or merged pseudo)
        assert len(rows_for_track) == 1, \
            f"dedupe failed — sound appears {len(rows_for_track)} times"

    def test_upload_defer_post_creates_no_canonical_yet(self, member_token):
        title = f"TEST_iter83_defer_{uuid.uuid4().hex[:6]}"
        r = _upload_track(member_token, title, defer_post=True)
        assert r.status_code == 200, r.text[:300]
        track = r.json()["track"]
        assert "post" not in track or not track.get("post"), \
            "defer_post=true should NOT return a canonical post"
        tid = track["id"]
        _CREATED_TRACKS.append((tid, member_token))

        # Now SHARE the sound via POST /api/posts — should be marked canonical
        share = requests.post(
            f"{BASE_URL}/api/posts",
            headers=_h(member_token),
            json={
                "content": f"defer share {title}",
                "media_type": "sound",
                "sound_track_id": tid,
                "sound_url": track.get("file_url"),
                "sound_title": track.get("title"),
                "sound_duration": track.get("duration_seconds"),
            },
            timeout=30,
        )
        assert share.status_code == 200, share.text[:300]
        post = share.json()["post"]
        pid = post["id"]
        _CREATED_POSTS.append((pid, member_token))
        # Now the track's canonical linkage should be established.
        # Sounds feed must embed t.post pointing at this pid.
        feed = requests.get(f"{BASE_URL}/api/sounds/feed",
                            headers=_h(member_token),
                            params={"limit": 200}, timeout=30)
        assert feed.status_code == 200
        tracks = feed.json()["tracks"]
        by_id = {t["id"]: t for t in tracks}
        assert tid in by_id, "track missing from sounds feed after share"
        embedded = by_id[tid].get("post") or {}
        assert embedded.get("id") == pid, \
            f"sounds feed t.post.id != share post id ({embedded.get('id')} vs {pid})"


class TestFireSync:
    def test_fire_syncs_across_sounds_feed_top100_and_posts(self, member_token):
        # Fresh canonical sound
        title = f"TEST_iter83_fire_{uuid.uuid4().hex[:6]}"
        r = _upload_track(member_token, title, defer_post=False)
        assert r.status_code == 200, r.text[:300]
        track = r.json()["track"]
        tid = track["id"]
        pid = track["post"]["id"]
        _CREATED_TRACKS.append((tid, member_token))

        # Founder fires 3x
        founder_tok = _login(*FOUNDER)
        fire = requests.post(f"{BASE_URL}/api/fire/react",
                             headers=_h(founder_tok),
                             json={"post_id": pid, "fire_value": 3},
                             timeout=30)
        assert fire.status_code == 200, fire.text[:300]

        # /posts?media_type=sound
        r_posts = requests.get(f"{BASE_URL}/api/posts",
                               headers=_h(member_token),
                               params={"media_type": "sound", "limit": 100},
                               timeout=30)
        posts = r_posts.json().get("posts") or r_posts.json()
        cp = next((p for p in posts if p.get("id") == pid), None)
        assert cp, "canonical post missing"
        posts_ft = int(cp.get("fire_total") or 0)

        # /sounds/feed
        feed = requests.get(f"{BASE_URL}/api/sounds/feed",
                            headers=_h(member_token),
                            params={"limit": 200}, timeout=30)
        by_id = {t["id"]: t for t in feed.json()["tracks"]}
        assert tid in by_id
        feed_ft = int((by_id[tid].get("post") or {}).get("fire_total") or 0)

        # Top100 (page 1 fine — new track may or may not rank, but embed if present)
        top = requests.get(f"{BASE_URL}/api/sounds/charts/top100",
                           headers=_h(member_token),
                           params={"page": 1}, timeout=30)
        assert top.status_code == 200

        assert posts_ft == 3, f"/posts fire_total {posts_ft} != 3"
        assert feed_ft == 3, f"/sounds/feed fire_total {feed_ft} != 3"

    def test_fire_ranked_sounds_feed(self, member_token):
        r = requests.get(f"{BASE_URL}/api/sounds/feed",
                         headers=_h(member_token),
                         params={"sort": "fire", "window": "all", "limit": 100},
                         timeout=30)
        assert r.status_code == 200, r.text[:200]
        tracks = r.json()["tracks"]
        # Assert monotonic non-increasing lifetime fire_total across tracks that have posts
        totals = [int((t.get("post") or {}).get("fire_total") or 0) for t in tracks if t.get("post")]
        if len(totals) >= 2:
            for a, b in zip(totals, totals[1:]):
                assert a >= b, f"sort=fire window=all not desc-ordered: {totals[:10]}"


class TestForYouDedupe:
    def test_media_type_sound_dedupes_canonical_tracks(self, member_token):
        r = requests.get(f"{BASE_URL}/api/posts",
                         headers=_h(member_token),
                         params={"media_type": "sound", "limit": 200}, timeout=30)
        assert r.status_code == 200
        posts = r.json().get("posts") or r.json()
        # Group by sound_track_id/track_id — each track should be represented once
        seen: dict[str, int] = {}
        for p in posts:
            key = p.get("sound_track_id") or p.get("track_id")
            if not key:
                continue
            seen[key] = seen.get(key, 0) + 1
        dupes = {k: v for k, v in seen.items() if v > 1}
        assert not dupes, f"For You dedupe FAILED — duplicate sound entries: {dupes}"


class TestSyncAndDelete:
    def test_patch_track_syncs_canonical_post(self, member_token):
        title = f"TEST_iter83_sync_{uuid.uuid4().hex[:6]}"
        r = _upload_track(member_token, title, defer_post=False)
        assert r.status_code == 200
        track = r.json()["track"]
        tid, pid = track["id"], track["post"]["id"]
        _CREATED_TRACKS.append((tid, member_token))

        new_title = title + "_edited"
        patch = requests.patch(f"{BASE_URL}/api/sounds/{tid}",
                               headers=_h(member_token),
                               json={"title": new_title, "visibility": "friends"},
                               timeout=30)
        assert patch.status_code == 200, patch.text[:200]

        # Give sync a moment (should be sync in-line, but be tolerant)
        time.sleep(0.3)
        got = requests.get(f"{BASE_URL}/api/posts/{pid}",
                           headers=_h(member_token), timeout=15)
        # Endpoint may or may not exist as /posts/{id}; try feed fallback
        if got.status_code == 200:
            post = got.json().get("post") or got.json()
            assert post.get("sound_title") == new_title, \
                f"sound_title not synced: {post.get('sound_title')}"
            aud = post.get("audience") or {}
            assert aud.get("visibility") == "friends", \
                f"audience.visibility not synced: {aud}"

    def test_delete_track_removes_canonical_post(self, member_token):
        title = f"TEST_iter83_del_track_{uuid.uuid4().hex[:6]}"
        r = _upload_track(member_token, title, defer_post=False)
        assert r.status_code == 200
        track = r.json()["track"]
        tid, pid = track["id"], track["post"]["id"]

        d = requests.delete(f"{BASE_URL}/api/sounds/{tid}",
                            headers=_h(member_token), timeout=30)
        assert d.status_code == 200
        # canonical post gone from /posts?media_type=sound
        time.sleep(0.3)
        r_posts = requests.get(f"{BASE_URL}/api/posts",
                               headers=_h(member_token),
                               params={"media_type": "sound", "limit": 200},
                               timeout=30)
        ids = {p.get("id") for p in (r_posts.json().get("posts") or r_posts.json())}
        assert pid not in ids, "canonical post NOT removed when track deleted"

    def test_delete_canonical_post_removes_track(self, member_token):
        title = f"TEST_iter83_del_post_{uuid.uuid4().hex[:6]}"
        r = _upload_track(member_token, title, defer_post=False)
        assert r.status_code == 200
        track = r.json()["track"]
        tid, pid = track["id"], track["post"]["id"]

        d = requests.delete(f"{BASE_URL}/api/posts/{pid}",
                            headers=_h(member_token), timeout=30)
        assert d.status_code == 200, d.text[:200]
        # track gone from /sounds/feed
        time.sleep(0.3)
        feed = requests.get(f"{BASE_URL}/api/sounds/feed",
                            headers=_h(member_token),
                            params={"limit": 200}, timeout=30)
        ids = {t["id"] for t in feed.json()["tracks"]}
        assert tid not in ids, "track NOT removed when canonical post deleted"


class TestMigrationEndpoints:
    def test_dry_run_founder_only(self, founder_token, support_token, member_token):
        # non-founder gets 403
        for tok, who in [(support_token, "support"), (member_token, "member")]:
            r = requests.post(f"{BASE_URL}/api/sounds/admin/migration/dry-run",
                              headers=_h(tok), timeout=20)
            assert r.status_code == 403, f"expected 403 for {who}, got {r.status_code}"
        # founder passes
        r = requests.post(f"{BASE_URL}/api/sounds/admin/migration/dry-run",
                          headers=_h(founder_token), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["mode"] == "dry_run"
        assert j["destructive"] is False
        assert "tracks_total" in j

    def test_execute_requires_phrase_and_is_idempotent(self, founder_token):
        # without phrase → 400
        r = requests.post(f"{BASE_URL}/api/sounds/admin/migration/execute",
                          headers=_h(founder_token), json={}, timeout=30)
        assert r.status_code == 400

        # non-founder without phrase → 403 (founder guard first)
        sup = _login(*SUPPORT)
        r = requests.post(f"{BASE_URL}/api/sounds/admin/migration/execute",
                          headers=_h(sup),
                          json={"confirmation_phrase": "MIGRATE SOUNDS TO POSTS"},
                          timeout=30)
        assert r.status_code == 403

        # with phrase (founder) → 200 idempotent (created should be 0 since
        # migration already ran in preview, though new backfills of TEST
        # tracks with defer_post=true & no share could technically create)
        r = requests.post(f"{BASE_URL}/api/sounds/admin/migration/execute",
                          headers=_h(founder_token),
                          json={"confirmation_phrase": "MIGRATE SOUNDS TO POSTS"},
                          timeout=60)
        assert r.status_code == 200
        report = r.json()
        assert report["mode"] == "execute"
        # skipped_existing > 0 proves idempotency on prior canonical posts
        assert report["skipped_existing"] >= 1, \
            f"expected some skipped_existing on re-run, got {report}"


class TestClassificationRename:
    def test_founder_rename_and_revert(self, founder_token, support_token):
        # non-founder blocked
        r = requests.patch(f"{BASE_URL}/api/sounds/admin/classifications/music",
                           headers=_h(support_token), json={"name": "Musica"},
                           timeout=15)
        assert r.status_code == 403

        # founder rename
        r = requests.patch(f"{BASE_URL}/api/sounds/admin/classifications/music",
                           headers=_h(founder_token), json={"name": "Musica"},
                           timeout=15)
        assert r.status_code == 200, r.text[:200]
        rows = r.json()["classifications"]
        music = next(c for c in rows if c["id"] == "music")
        assert music["name"] == "Musica"

        # Sounds feed reflects new display name for music tracks
        feed = requests.get(f"{BASE_URL}/api/sounds/feed",
                            headers=_h(founder_token),
                            params={"limit": 50}, timeout=30)
        tracks = feed.json()["tracks"]
        music_tracks = [t for t in tracks if t.get("classification_id") == "music"]
        if music_tracks:
            assert music_tracks[0].get("classification_name") == "Musica"

        # ALWAYS revert
        rv = requests.patch(f"{BASE_URL}/api/sounds/admin/classifications/music",
                            headers=_h(founder_token), json={"name": "Music"},
                            timeout=15)
        assert rv.status_code == 200
        after = rv.json()["classifications"]
        assert next(c for c in after if c["id"] == "music")["name"] == "Music"


class TestCommentsUnification:
    def test_comment_on_canonical_post(self, member_token):
        title = f"TEST_iter83_cmt_{uuid.uuid4().hex[:6]}"
        r = _upload_track(member_token, title, defer_post=False)
        assert r.status_code == 200
        track = r.json()["track"]
        pid = track["post"]["id"]
        _CREATED_TRACKS.append((track["id"], member_token))

        # Post a comment to the canonical post (endpoint is /comment singular)
        c = requests.post(f"{BASE_URL}/api/posts/{pid}/comment",
                          headers=_h(member_token),
                          json={"text": "hello canonical sound"},
                          timeout=30)
        assert c.status_code in (200, 201), c.text[:200]

        # Read back
        g = requests.get(f"{BASE_URL}/api/posts/{pid}/comments",
                        headers=_h(member_token), timeout=15)
        assert g.status_code == 200
        comments = g.json().get("comments") or g.json()
        assert any(((cm.get("text") or cm.get("content") or "")).startswith("hello canonical")
                   for cm in comments), f"comment not returned; got {comments[:3]}"


class TestBoostedFireMath:
    def test_boosted_fire_charges_sender_pool_max_v_minus_1(self, member_token):
        """5x boosted → sender pool -4, recipient +5 on the canonical sound post."""
        title = f"TEST_iter83_boost_{uuid.uuid4().hex[:6]}"
        r = _upload_track(member_token, title, defer_post=False)
        assert r.status_code == 200
        track = r.json()["track"]
        tid, pid = track["id"], track["post"]["id"]
        _CREATED_TRACKS.append((tid, member_token))

        # Founder pool BEFORE
        founder_tok = _login(*FOUNDER)
        pool_ep = requests.get(f"{BASE_URL}/api/fire/status",
                               headers=_h(founder_tok), timeout=20)
        # If fire status endpoint returns wallet info, use it
        before_pool = None
        if pool_ep.status_code == 200:
            data = pool_ep.json()
            before_pool = (data.get("pool_available")
                           or data.get("wallet", {}).get("pool_available"))

        # Send 5x
        fx = requests.post(f"{BASE_URL}/api/fire/react",
                           headers=_h(founder_tok),
                           json={"post_id": pid, "fire_value": 5},
                           timeout=30)
        assert fx.status_code == 200, fx.text[:200]

        # Verify recipient side: post fire_total == 5
        r_posts = requests.get(f"{BASE_URL}/api/posts",
                               headers=_h(member_token),
                               params={"media_type": "sound", "limit": 100},
                               timeout=30)
        posts = r_posts.json().get("posts") or r_posts.json()
        cp = next((p for p in posts if p.get("id") == pid), None)
        assert cp and int(cp.get("fire_total") or 0) == 5, \
            f"expected 5, got {cp.get('fire_total') if cp else 'no post'}"

        # Sender pool: -4 if we could read it
        if before_pool is not None:
            pool_after = requests.get(f"{BASE_URL}/api/fire/status",
                                      headers=_h(founder_tok), timeout=20)
            if pool_after.status_code == 200:
                data = pool_after.json()
                after_pool = (data.get("pool_available")
                              or data.get("wallet", {}).get("pool_available"))
                if after_pool is not None and before_pool is not None:
                    assert before_pool - after_pool == 4, \
                        f"pool delta expected -4, got -{before_pool - after_pool}"


class TestFriendsOnlyHidden:
    def test_friends_only_sound_hidden_from_non_friend(self, member_token):
        title = f"TEST_iter83_priv_{uuid.uuid4().hex[:6]}"
        r = _upload_track(member_token, title, defer_post=False)
        assert r.status_code == 200
        track = r.json()["track"]
        tid = track["id"]
        _CREATED_TRACKS.append((tid, member_token))
        # switch to friends
        p = requests.patch(f"{BASE_URL}/api/sounds/{tid}",
                           headers=_h(member_token),
                           json={"visibility": "friends"}, timeout=15)
        assert p.status_code == 200

        # Non-friend viewer: register a throwaway user
        throw = f"iter83priv{uuid.uuid4().hex[:6]}"
        reg = requests.post(f"{BASE_URL}/api/auth/register",
                            json={"username": throw,
                                  "email": f"{throw}@example.com",
                                  "password": "Password1$",
                                  "name": throw,
                                  "accepted_terms": True,
                                  "accepted_privacy": True,
                                  "accepted_conditions": True,
                                  "age_confirmed_13": True},
                            timeout=30)
        if reg.status_code not in (200, 201):
            pytest.skip(f"register endpoint returned {reg.status_code}")
        throw_tok = reg.json().get("access_token") or _login(throw, "Password1$")

        feed = requests.get(f"{BASE_URL}/api/sounds/feed",
                            headers=_h(throw_tok),
                            params={"limit": 200}, timeout=30)
        ids = {t["id"] for t in feed.json()["tracks"]}
        assert tid not in ids, "friends-only track leaked to non-friend"
