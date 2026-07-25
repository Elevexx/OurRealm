"""Sound Fire migration — legacy Sound posts unified onto Fire Power.

Covers:
  - Legacy track (no canonical post) → startup/lazy backfill creates ONE
    canonical post (is_canonical_sound, sound_track_id, creator/metadata
    preserved).
  - Legacy hearts → exactly 1× Fire per unique user, no pool charge.
  - Idempotency: re-running never duplicates posts or Fire reactions.
  - Duplicate canonical repair (extras demoted, best kept).
  - Fire react API on a canonical sound post: add / increase (boost) /
    decrease / remove.
  - Feed surfaces: /api/posts?media_type=sound never emits raw
    is_sound_track rows; every sound item has fire fields.
  - Newly uploaded sound gets a canonical post immediately.
"""
from __future__ import annotations

import asyncio
import io
import os
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

FOUNDER = ("stealth", "Password1$")
MEMBER = ("auditcheckreal", "Password1$")


def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {username}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


from tests._shared_loop import get_shared_loop


def _run(coro):
    return get_shared_loop().run_until_complete(coro)


async def _db():
    from core.db import db
    return db


def _make_wav_bytes(seconds: float = 0.4):
    framerate = 8000
    n = int(framerate * seconds)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(framerate)
        w.writeframes(b"".join(
            (b"\x00\x40" if (i // 20) % 2 else b"\x00\xc0") for i in range(n)))
    return buf.getvalue()


@pytest.fixture(scope="module")
def founder_token():
    return _login(*FOUNDER)


@pytest.fixture(scope="module")
def member_token():
    return _login(*MEMBER)


@pytest.fixture(scope="module")
def legacy_track(member_token):
    """Insert a raw LEGACY track (no canonical post) with one heart from
    the founder — simulates 'Calling in The City'."""
    async def make():
        db = await _db()
        member = await db.users.find_one({"username": "auditcheckreal"}, {"_id": 0, "id": 1})
        founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
        tid = uuid.uuid4().hex
        await db.tracks.insert_one({
            "id": tid, "user_id": member["id"],
            "title": "Legacy Test — Calling in The City",
            "category": "Music", "classification_id": "music",
            "genre": "", "mood": "", "duration_seconds": 12.0,
            "file_url": f"/api/sounds/{tid}.mp3", "file_size": 1024,
            "mime": "audio/mpeg", "cover_url": None,
            "plays": 3, "likes": 1, "liked_by": [founder["id"]],
            "visibility": "public", "custom_user_ids": [],
            "created_at": "2026-01-05T12:00:00+00:00",
        })
        return {"track_id": tid, "member_id": member["id"], "founder_id": founder["id"]}
    ctx = _run(make())
    yield ctx
    async def cleanup():
        db = await _db()
        pids = [p["id"] async for p in db.posts.find({"sound_track_id": ctx["track_id"]}, {"_id": 0, "id": 1})]
        await db.tracks.delete_many({"id": ctx["track_id"]})
        await db.posts.delete_many({"sound_track_id": ctx["track_id"]})
        if pids:
            await db.post_fire_reactions.delete_many({"post_id": {"$in": pids}})
            await db.comments.delete_many({"post_id": {"$in": pids}})
    _run(cleanup())


def test_dry_run_reports_legacy_track(founder_token, legacy_track):
    async def check():
        from services.sound_posts import migration_dry_run
        return await migration_dry_run()
    report = _run(check())
    assert report["tracks_to_backfill"] >= 1
    assert report["likes_to_convert"] >= 1
    assert "existing_fire_reactions_preserved" in report
    assert "records_skipped" in report
    assert report["destructive"] is False


def test_backfill_creates_canonical_and_converts_like(legacy_track):
    async def go():
        db = await _db()
        from services.sound_posts import backfill_canonical_for_track
        t = await db.tracks.find_one({"id": legacy_track["track_id"]}, {"_id": 0})
        post, converted = await backfill_canonical_for_track(t)
        fresh = await db.posts.find_one({"id": post["id"]}, {"_id": 0})
        fire = [r async for r in db.post_fire_reactions.find({"post_id": post["id"]}, {"_id": 0})]
        return post, converted, fresh, fire
    post, converted, fresh, fire = _run(go())
    assert converted == 1
    assert fresh["is_canonical_sound"] is True
    assert fresh["sound_track_id"] == legacy_track["track_id"]
    assert fresh["author_id"] == legacy_track["member_id"]
    assert fresh["sound_title"] == "Legacy Test — Calling in The City"
    assert fresh["created_at"] == "2026-01-05T12:00:00+00:00"  # timestamp preserved
    assert fresh.get("fire_total", 0) >= 1  # heart → 1× fire
    assert len(fire) == 1
    assert fire[0]["user_id"] == legacy_track["founder_id"]
    assert fire[0]["fire_value"] == 1
    assert fire[0]["boosted_cost"] == 0  # no Daily Pool charge for migrated hearts
    assert fire[0]["source"] == "sound_migration"


def test_backfill_is_idempotent_no_duplicates(legacy_track):
    async def go():
        db = await _db()
        from services.sound_posts import backfill_canonical_for_track, migration_execute
        t = await db.tracks.find_one({"id": legacy_track["track_id"]}, {"_id": 0})
        await backfill_canonical_for_track(t)          # 2nd direct run
        await migration_execute({"username": "test"})  # full migration run
        n_posts = await db.posts.count_documents(
            {"sound_track_id": legacy_track["track_id"], "is_canonical_sound": True})
        post = await db.posts.find_one(
            {"sound_track_id": legacy_track["track_id"], "is_canonical_sound": True}, {"_id": 0})
        n_fire = await db.post_fire_reactions.count_documents(
            {"post_id": post["id"], "user_id": legacy_track["founder_id"]})
        return n_posts, n_fire
    n_posts, n_fire = _run(go())
    assert n_posts == 1, "duplicate canonical posts created"
    assert n_fire == 1, "duplicate fire reactions created"


def test_duplicate_canonical_repair(legacy_track):
    async def go():
        db = await _db()
        from services.sound_posts import repair_duplicate_sound_posts, ensure_sound_indexes
        canon = await db.posts.find_one(
            {"sound_track_id": legacy_track["track_id"], "is_canonical_sound": True}, {"_id": 0})
        try:
            await db.posts.drop_index("uniq_canonical_sound")  # simulate legacy dup data
        except Exception:
            pass
        dup_id = uuid.uuid4().hex
        await db.posts.insert_one({**{k: v for k, v in canon.items() if k != "id"},
                                   "id": dup_id, "fire_count": 0, "comments": 0,
                                   "created_at": "2026-06-01T00:00:00+00:00"})
        repaired = await repair_duplicate_sound_posts()
        await ensure_sound_indexes()
        n = await db.posts.count_documents(
            {"sound_track_id": legacy_track["track_id"], "is_canonical_sound": True})
        kept = await db.posts.find_one(
            {"sound_track_id": legacy_track["track_id"], "is_canonical_sound": True}, {"_id": 0, "id": 1})
        dup_gone = await db.posts.find_one({"id": dup_id}, {"_id": 0, "id": 1})
        return repaired, n, kept["id"], canon["id"], dup_gone
    repaired, n, kept_id, orig_id, dup_gone = _run(go())
    assert repaired >= 1
    assert n == 1
    assert kept_id == orig_id, "repair must keep the oldest valid canonical"
    assert dup_gone is None, "duplicate must be removed after engagement merge"


def test_fire_add_increase_decrease_remove_on_migrated_post(founder_token, legacy_track):
    async def pid():
        db = await _db()
        p = await db.posts.find_one(
            {"sound_track_id": legacy_track["track_id"], "is_canonical_sound": True}, {"_id": 0, "id": 1})
        return p["id"]
    post_id = _run(pid())
    h = _h(founder_token)

    def react(v):
        r = requests.post(f"{BASE_URL}/api/fire/react",
                          json={"post_id": post_id, "fire_value": v}, headers=h, timeout=30)
        assert r.status_code == 200, f"react {v}: {r.status_code} {r.text[:300]}"
        return r.json()

    d = react(3)   # boosted fire on a migrated post
    assert d["my_fire"] == 3
    d = react(5)   # increase
    assert d["my_fire"] == 5
    d = react(2)   # decrease
    assert d["my_fire"] == 2
    d = react(0)   # remove
    assert d["my_fire"] == 0
    d = react(1)   # restore the original migrated 1× so state matches pre-test
    assert d["my_fire"] == 1
    state = requests.get(f"{BASE_URL}/api/fire/post/{post_id}", headers=h, timeout=30).json()
    assert state.get("my_fire") == 1


def test_sound_feed_has_no_raw_track_rows(member_token, legacy_track):
    r = requests.get(f"{BASE_URL}/api/posts?media_type=sound&limit=100",
                     headers=_h(member_token), timeout=30)
    assert r.status_code == 200
    items = r.json().get("posts") or r.json().get("items") or []
    sound_items = [p for p in items if p.get("media_type") == "sound"]
    assert not any(p.get("is_sound_track") for p in items), "raw track rows leaked into feed"
    ours = [p for p in sound_items if p.get("sound_track_id") == legacy_track["track_id"]]
    assert len(ours) == 1, "legacy sound must appear exactly once (canonical)"
    assert ours[0].get("is_canonical_sound") or ours[0].get("sound_track_id")
    assert "fire_total" in ours[0] or ours[0].get("fire") is not None


def test_new_upload_gets_canonical_post_immediately(member_token):
    files = {"file": ("mini.wav", _make_wav_bytes(), "audio/wav")}
    data = {"title": "Migration Regression New Upload", "category": "Music",
            "rights_confirmed": "true"}
    r = requests.post(f"{BASE_URL}/api/sounds/upload", headers=_h(member_token),
                      files=files, data=data, timeout=60)
    assert r.status_code == 200, r.text[:300]
    track = r.json()["track"]
    assert track.get("post", {}).get("id"), "new upload must carry a canonical post"

    async def cleanup():
        db = await _db()
        await db.tracks.delete_one({"id": track["id"]})
        await db.posts.delete_many({"sound_track_id": track["id"]})
    _run(cleanup())
