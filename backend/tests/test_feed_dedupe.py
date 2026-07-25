"""Feed uniqueness + duplicate canonical Sound repair regression tests.

Covers:
  - Unique partial index blocks a second canonical post for one track.
  - Concurrent healing converges on ONE canonical (race-safe).
  - Duplicate merge repair: oldest valid canonical kept, fire/comments
    migrated without double-counting, duplicates deleted; idempotent.
  - Feed responses never contain a duplicate post id or a duplicate
    canonical Sound instance (Latest, Sounds filter, Top Fire, refresh,
    pagination boundaries).
"""
import asyncio
import os
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

from tests._shared_loop import get_shared_loop


def _run(coro):
    return get_shared_loop().run_until_complete(coro)


def _login(u, p):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": u, "password": p}, timeout=30)
    assert r.status_code == 200
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def token():
    return _login("stealth", "Password1$")


def _feed(token, **params):
    r = requests.get(f"{BASE_URL}/api/posts", params=params,
                     headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 200
    return r.json()["posts"]


def _assert_unique(items):
    ids = [p["id"] for p in items]
    assert len(ids) == len(set(ids)), "duplicate post ids in feed response"
    canon = [p["sound_track_id"] for p in items
             if p.get("is_canonical_sound") and p.get("sound_track_id")]
    assert len(canon) == len(set(canon)), "duplicate canonical sound in feed response"


def test_unique_index_blocks_duplicate_canonical():
    async def go():
        from core.db import db
        from services.sound_posts import ensure_sound_indexes
        await ensure_sound_indexes()
        tid = uuid.uuid4().hex
        base = {"media_type": "sound", "is_canonical_sound": True, "sound_track_id": tid,
                "author_id": "x", "created_at": "2026-01-01T00:00:00+00:00"}
        p1 = uuid.uuid4().hex
        await db.posts.insert_one({**base, "id": p1})
        blocked = False
        try:
            await db.posts.insert_one({**base, "id": uuid.uuid4().hex})
        except Exception:
            blocked = True
        await db.posts.delete_many({"sound_track_id": tid})
        return blocked
    assert _run(go()) is True


def test_concurrent_heal_creates_exactly_one_canonical():
    async def go():
        from core.db import db
        from services.sound_posts import backfill_canonical_for_track
        member = await db.users.find_one({"username": "auditcheckreal"}, {"_id": 0, "id": 1})
        tid = uuid.uuid4().hex
        await db.tracks.insert_one({
            "id": tid, "user_id": member["id"], "title": "Race Test", "category": "Music",
            "classification_id": "music", "duration_seconds": 5.0,
            "file_url": f"/api/sounds/{tid}.mp3", "mime": "audio/mpeg", "likes": 0,
            "liked_by": [], "visibility": "public", "created_at": "2026-03-01T00:00:00+00:00"})
        t = await db.tracks.find_one({"id": tid}, {"_id": 0})
        results = await asyncio.gather(
            backfill_canonical_for_track(dict(t), source="feed_heal"),
            backfill_canonical_for_track(dict(t), source="feed_heal"),
            backfill_canonical_for_track(dict(t), source="lazy_heal"),
            return_exceptions=True)
        n = await db.posts.count_documents({"sound_track_id": tid, "is_canonical_sound": True})
        await db.tracks.delete_one({"id": tid})
        await db.posts.delete_many({"sound_track_id": tid})
        errs = [r for r in results if isinstance(r, Exception)]
        return n, errs
    n, errs = _run(go())
    assert n == 1, f"race produced {n} canonical posts"
    assert not errs, f"heal raised: {errs}"


def test_duplicate_merge_repair_and_idempotency():
    async def go():
        from core.db import db
        from services.sound_posts import repair_duplicate_sound_posts
        founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
        member = await db.users.find_one({"username": "auditcheckreal"}, {"_id": 0, "id": 1})
        tid = uuid.uuid4().hex
        # Drop the unique index to simulate legacy duplicate data.
        try:
            await db.posts.drop_index("uniq_canonical_sound")
        except Exception:
            pass
        old_id, new_id = uuid.uuid4().hex, uuid.uuid4().hex
        base = {"media_type": "sound", "is_canonical_sound": True, "sound_track_id": tid,
                "author_id": member["id"], "sound_title": "Dup Merge Test",
                "audience": {"visibility": "public"}}
        await db.posts.insert_one({**base, "id": old_id, "created_at": "2026-01-01T00:00:00+00:00"})
        await db.posts.insert_one({**base, "id": new_id, "created_at": "2026-05-01T00:00:00+00:00"})
        # Fire on BOTH copies from the same user (must not double-count) +
        # unique fire on the duplicate only (must migrate).
        for pid, uid, val in ((old_id, founder["id"], 1), (new_id, founder["id"], 3),
                              (new_id, member["id"], 2)):
            await db.post_fire_reactions.insert_one({
                "id": uuid.uuid4().hex, "post_id": pid, "user_id": uid, "fire_value": val,
                "boosted_cost": 0, "active": True, "source": "user",
                "created_at": "2026-05-02T00:00:00+00:00", "updated_at": "2026-05-02T00:00:00+00:00"})
        await db.comments.insert_one({"id": uuid.uuid4().hex, "post_id": new_id,
                                      "author_id": founder["id"], "content": "moved comment",
                                      "created_at": "2026-05-03T00:00:00+00:00"})
        merged1 = await repair_duplicate_sound_posts()
        merged2 = await repair_duplicate_sound_posts()  # idempotent second run
        posts = [p async for p in db.posts.find({"sound_track_id": tid}, {"_id": 0})]
        fire = [r async for r in db.post_fire_reactions.find({"post_id": old_id}, {"_id": 0})]
        comments = await db.comments.count_documents({"post_id": old_id})
        # restore the unique index
        from services.sound_posts import ensure_sound_indexes
        await ensure_sound_indexes()
        # cleanup
        await db.posts.delete_many({"sound_track_id": tid})
        await db.post_fire_reactions.delete_many({"post_id": {"$in": [old_id, new_id]}})
        await db.comments.delete_many({"post_id": {"$in": [old_id, new_id]}})
        return merged1, merged2, posts, fire, comments
    merged1, merged2, posts, fire, comments = _run(go())
    assert merged1 >= 1
    assert merged2 == 0, "repair not idempotent"
    assert len(posts) == 1 and posts[0]["created_at"].startswith("2026-01-01"), \
        "oldest canonical must be kept"
    by_user = {r["user_id"]: r for r in fire}
    assert len(fire) == 2, "fire must merge without double-counting"
    assert comments == 1, "comments must migrate to the keeper"
    assert posts[0].get("fire_total", 0) == sum(r["fire_value"] for r in fire)


def test_feed_never_returns_duplicates(token):
    # Latest / refresh (two identical calls) / Sounds filter / Top Fire /
    # pagination boundaries (growing limits must stay unique).
    for params in ({"limit": 100}, {"limit": 100}, {"limit": 100, "media_type": "sound"},
                   {"limit": 100, "sort": "fire"}, {"limit": 10}, {"limit": 50},
                   {"limit": 200}):
        _assert_unique(_feed(token, **params))


def test_single_sound_appears_exactly_once(token):
    items = _feed(token, limit=200, media_type="sound")
    ours = [p for p in items if p.get("sound_track_id") == "e8e5aa8b39454b23b044f314411d3bb4"]
    assert len(ours) == 1, f"'Calling in The City' appeared {len(ours)} times"
    async def db_check():
        from core.db import db
        return await db.posts.count_documents(
            {"sound_track_id": "e8e5aa8b39454b23b044f314411d3bb4", "is_canonical_sound": True})
    assert _run(db_check()) == 1


def test_all_feed_endpoints_unique(token):
    """P0 — every feed endpoint must return each post id at most once."""
    h = {"Authorization": f"Bearer {token}"}
    endpoints = [
        ("/api/posts", {"limit": 200}),
        ("/api/posts", {"limit": 200, "media_type": "sound"}),
        ("/api/posts", {"limit": 200, "sort": "fire"}),
        ("/api/posts/feed/by-user/stealth", {}),
        ("/api/posts/feed/by-user/stealth", {"sort": "fire", "limit": 20}),
        ("/api/posts/feed/by-user/auditcheckreal", {}),
    ]
    for path, params in endpoints:
        r = requests.get(f"{BASE_URL}{path}", params=params, headers=h, timeout=30)
        assert r.status_code == 200, f"{path}: {r.status_code}"
        _assert_unique(r.json()["posts"])
    # hashtag feed (first trending tag if any, else known tag)
    tags = requests.get(f"{BASE_URL}/api/hashtags/trending", headers=h, timeout=30).json().get("hashtags") or []
    for tag in ([t.get("tag") for t in tags[:3]] or ["popuptest"]):
        r = requests.get(f"{BASE_URL}/api/hashtags/{tag}/feed?limit=100", headers=h, timeout=30)
        if r.status_code == 200:
            _assert_unique(r.json().get("posts") or [])


def test_same_author_captionless_copy_merged_but_captioned_repost_kept():
    async def go():
        from core.db import db
        from services.sound_posts import repair_duplicate_sound_posts
        founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
        member = await db.users.find_one({"username": "auditcheckreal"}, {"_id": 0, "id": 1})
        tid = uuid.uuid4().hex
        canon_id, copy_id, repost_id, other_id = (uuid.uuid4().hex for _ in range(4))
        base = {"media_type": "sound", "sound_track_id": tid, "author_id": member["id"],
                "sound_title": "Copy Merge Test", "audience": {"visibility": "public"}}
        await db.posts.insert_one({**base, "id": canon_id, "is_canonical_sound": True,
                                   "content": "", "created_at": "2026-01-01T00:00:00+00:00"})
        # pre-unification captionless copy by same author -> must merge
        await db.posts.insert_one({**base, "id": copy_id, "content": "",
                                   "created_at": "2026-02-01T00:00:00+00:00"})
        # captioned repost by same author -> legitimate, must be kept
        await db.posts.insert_one({**base, "id": repost_id, "content": "my remix drop 🔥",
                                   "created_at": "2026-03-01T00:00:00+00:00"})
        # another user's share-style post -> kept
        await db.posts.insert_one({**base, "id": other_id, "author_id": founder["id"],
                                   "content": "", "created_at": "2026-03-02T00:00:00+00:00"})
        await repair_duplicate_sound_posts()
        remaining = {p["id"] async for p in db.posts.find({"sound_track_id": tid}, {"_id": 0, "id": 1})}
        await db.posts.delete_many({"sound_track_id": tid})
        return remaining, canon_id, copy_id, repost_id, other_id
    remaining, canon_id, copy_id, repost_id, other_id = _run(go())
    assert canon_id in remaining, "canonical must survive"
    assert copy_id not in remaining, "captionless same-author copy must merge"
    assert repost_id in remaining, "captioned repost is legitimate and must be kept"
    assert other_id in remaining, "other user's post must never be deleted"
