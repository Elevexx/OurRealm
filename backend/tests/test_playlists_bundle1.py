"""Bundle 1 — Personal Playlist Foundation + Sound-Player Fire backend tests.

Covers: playlist CRUD, add/remove/reorder, duplicate prevention,
ownership + auth enforcement, reuse-permission checks, config limits,
and canonical Sound Fire (single canonical post, shared accounting,
idempotent reactions).
"""
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
    assert r.status_code == 200, r.text[:200]
    return r.json()["access_token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


_CLEAN = {"playlists": [], "tracks": []}


@pytest.fixture(scope="module")
def founder_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def member_token():
    return _login("auditcheckreal", "Password1$")


@pytest.fixture(scope="module")
def newbie_token():
    return _login("quickfire.newbie@example.com", "Password1$")


async def _mk_track(username, visibility="public", deleted=False):
    from core.db import db
    from services.sound_permissions import default_permissions
    u = await db.users.find_one({"username": username}, {"_id": 0, "id": 1})
    tid = uuid.uuid4().hex
    doc = {
        "id": tid, "user_id": u["id"], "title": f"BUNDLE1_{tid[:6]}",
        "category": "Music", "genre": "Pop", "mood": "", "visibility": visibility,
        "likes": 0, "liked_by": [], "plays": 0, "duration_seconds": 7,
        "file_url": f"/api/media/audio/{tid}.mp3", "mime": "audio/mpeg",
        "reuse_permissions": default_permissions(), "reuse_preset": "playable_only",
        "created_at": "2026-07-01T00:00:00+00:00"}
    if deleted:
        doc["deleted_at"] = "2026-07-02T00:00:00+00:00"
    await db.tracks.insert_one(doc)
    return tid


@pytest.fixture(scope="module")
def public_track():
    tid = _run(_mk_track("stealth"))
    _CLEAN["tracks"].append(tid)
    return tid


@pytest.fixture(scope="module")
def public_track_2():
    tid = _run(_mk_track("stealth"))
    _CLEAN["tracks"].append(tid)
    return tid


@pytest.fixture(scope="module")
def private_other_track():
    tid = _run(_mk_track("auditcheckreal", visibility="private"))
    _CLEAN["tracks"].append(tid)
    return tid


@pytest.fixture(scope="module")
def deleted_track():
    tid = _run(_mk_track("stealth", deleted=True))
    _CLEAN["tracks"].append(tid)
    return tid


@pytest.fixture(scope="module")
def playlist(founder_token):
    r = requests.post(f"{BASE_URL}/api/playlists", headers=_h(founder_token),
                      json={"name": f"Bundle1 List {uuid.uuid4().hex[:5]}"}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    pl = r.json()["playlist"]
    _CLEAN["playlists"].append(pl["id"])
    return pl


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield

    async def go():
        from core.db import db
        if _CLEAN["playlists"]:
            await db.playlist_items.delete_many({"playlist_id": {"$in": _CLEAN["playlists"]}})
            await db.playlists.delete_many({"id": {"$in": _CLEAN["playlists"]}})
        if _CLEAN["tracks"]:
            await db.tracks.delete_many({"id": {"$in": _CLEAN["tracks"]}})
            await db.posts.delete_many({"sound_track_id": {"$in": _CLEAN["tracks"]}})
        await db.playlists.delete_many({"name": {"$regex": "^BUNDLE1_FILL"}})
    _run(go())


# ---------------------------------------------------------------- CRUD

def test_create_playlist_is_private(playlist):
    assert playlist["visibility"] == "private"
    assert playlist["item_count"] == 0


def test_create_requires_auth():
    r = requests.post(f"{BASE_URL}/api/playlists", json={"name": "nope"}, timeout=30)
    assert r.status_code in (401, 403)


def test_rename_playlist(founder_token, playlist):
    r = requests.patch(f"{BASE_URL}/api/playlists/{playlist['id']}",
                       headers=_h(founder_token), json={"name": "Renamed Bundle1"}, timeout=30)
    assert r.status_code == 200
    assert r.json()["playlist"]["name"] == "Renamed Bundle1"


def test_list_mine(founder_token, playlist):
    r = requests.get(f"{BASE_URL}/api/playlists/mine", headers=_h(founder_token), timeout=30)
    assert r.status_code == 200
    assert any(p["id"] == playlist["id"] for p in r.json()["playlists"])


# ------------------------------------------------------------- items

def test_add_sound(founder_token, playlist, public_track):
    r = requests.post(f"{BASE_URL}/api/playlists/{playlist['id']}/items",
                      headers=_h(founder_token), json={"track_id": public_track}, timeout=30)
    assert r.status_code == 200
    assert r.json()["item_count"] == 1


def test_duplicate_add_rejected(founder_token, playlist, public_track):
    r = requests.post(f"{BASE_URL}/api/playlists/{playlist['id']}/items",
                      headers=_h(founder_token), json={"track_id": public_track}, timeout=30)
    assert r.status_code == 409
    assert "already" in r.json()["detail"].lower()


def test_detail_and_reorder(founder_token, playlist, public_track, public_track_2):
    r = requests.post(f"{BASE_URL}/api/playlists/{playlist['id']}/items",
                      headers=_h(founder_token), json={"track_id": public_track_2}, timeout=30)
    assert r.status_code == 200
    r = requests.get(f"{BASE_URL}/api/playlists/{playlist['id']}", headers=_h(founder_token), timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert [i["track_id"] for i in body["items"]] == [public_track, public_track_2]
    assert body["items"][0]["track"]["title"].startswith("BUNDLE1_")
    assert body["playlist"]["total_duration_seconds"] == 14
    # reorder
    r = requests.patch(f"{BASE_URL}/api/playlists/{playlist['id']}/items/reorder",
                       headers=_h(founder_token),
                       json={"track_ids": [public_track_2, public_track]}, timeout=30)
    assert r.status_code == 200
    r = requests.get(f"{BASE_URL}/api/playlists/{playlist['id']}", headers=_h(founder_token), timeout=30)
    assert [i["track_id"] for i in r.json()["items"]] == [public_track_2, public_track]


def test_remove_sound(founder_token, playlist, public_track_2):
    r = requests.delete(f"{BASE_URL}/api/playlists/{playlist['id']}/items/{public_track_2}",
                        headers=_h(founder_token), timeout=30)
    assert r.status_code == 200
    r = requests.delete(f"{BASE_URL}/api/playlists/{playlist['id']}/items/{public_track_2}",
                        headers=_h(founder_token), timeout=30)
    assert r.status_code == 404


# --------------------------------------------------- ownership / auth

def test_other_user_cannot_edit(member_token, playlist, public_track):
    pid = playlist["id"]
    assert requests.patch(f"{BASE_URL}/api/playlists/{pid}", headers=_h(member_token),
                          json={"name": "hacked"}, timeout=30).status_code == 403
    assert requests.delete(f"{BASE_URL}/api/playlists/{pid}", headers=_h(member_token),
                           timeout=30).status_code == 403
    assert requests.post(f"{BASE_URL}/api/playlists/{pid}/items", headers=_h(member_token),
                         json={"track_id": public_track}, timeout=30).status_code == 403
    # private-only: non-owner can't even view
    assert requests.get(f"{BASE_URL}/api/playlists/{pid}", headers=_h(member_token),
                        timeout=30).status_code == 403


# --------------------------------------------- reuse-permission gates

def test_cannot_add_private_foreign_track(founder_token, playlist, private_other_track):
    r = requests.post(f"{BASE_URL}/api/playlists/{playlist['id']}/items",
                      headers=_h(founder_token), json={"track_id": private_other_track}, timeout=30)
    assert r.status_code == 403
    assert "private" in r.json()["detail"].lower()


def test_owner_can_add_own_private_track(member_token, private_other_track):
    r = requests.post(f"{BASE_URL}/api/playlists", headers=_h(member_token),
                      json={"name": f"member list {uuid.uuid4().hex[:5]}"}, timeout=30)
    assert r.status_code == 200
    pid = r.json()["playlist"]["id"]
    _CLEAN["playlists"].append(pid)
    r = requests.post(f"{BASE_URL}/api/playlists/{pid}/items",
                      headers=_h(member_token), json={"track_id": private_other_track}, timeout=30)
    assert r.status_code == 200


def test_cannot_add_deleted_track(founder_token, playlist, deleted_track):
    r = requests.post(f"{BASE_URL}/api/playlists/{playlist['id']}/items",
                      headers=_h(founder_token), json={"track_id": deleted_track}, timeout=30)
    assert r.status_code == 410


# ------------------------------------------------------------ limits

def test_max_playlists_limit(newbie_token):
    from core.config import MAX_PLAYLISTS_PER_USER

    async def fill():
        from core.db import db
        u = await db.users.find_one({"username": "quickfirenewbie"}, {"_id": 0, "id": 1})
        have = await db.playlists.count_documents({"owner_id": u["id"]})
        need = MAX_PLAYLISTS_PER_USER - have
        if need > 0:
            await db.playlists.insert_many([
                {"id": uuid.uuid4().hex, "owner_id": u["id"], "owner_username": "quickfirenewbie",
                 "name": f"BUNDLE1_FILL_{i}", "visibility": "private",
                 "created_at": "2026-07-01T00:00:00+00:00", "updated_at": "2026-07-01T00:00:00+00:00"}
                for i in range(need)])
        return u["id"]
    uid = _run(fill())
    r = requests.post(f"{BASE_URL}/api/playlists", headers=_h(newbie_token),
                      json={"name": "one too many"}, timeout=30)
    assert r.status_code == 409
    assert "limit" in r.json()["detail"].lower()

    async def unfill():
        from core.db import db
        await db.playlists.delete_many({"owner_id": uid, "name": {"$regex": "^BUNDLE1_FILL"}})
    _run(unfill())


def test_max_tracks_limit(founder_token, public_track):
    from core.config import MAX_TRACKS_PER_PLAYLIST
    r = requests.post(f"{BASE_URL}/api/playlists", headers=_h(founder_token),
                      json={"name": f"full list {uuid.uuid4().hex[:5]}"}, timeout=30)
    pid = r.json()["playlist"]["id"]
    _CLEAN["playlists"].append(pid)

    async def fill():
        from core.db import db
        await db.playlist_items.insert_many([
            {"playlist_id": pid, "track_id": f"bundle1fake{i}", "position": i,
             "added_at": "2026-07-01T00:00:00+00:00"}
            for i in range(MAX_TRACKS_PER_PLAYLIST)])
    _run(fill())
    r = requests.post(f"{BASE_URL}/api/playlists/{pid}/items",
                      headers=_h(founder_token), json={"track_id": public_track}, timeout=30)
    assert r.status_code == 409
    assert "full" in r.json()["detail"].lower()


# --------------------------------------- canonical Sound-player Fire

@pytest.fixture(scope="module")
def canonical_track(founder_token):
    """Track + canonical post created through the real service path."""
    tid = _run(_mk_track("stealth"))
    _CLEAN["tracks"].append(tid)

    async def mkpost():
        from core.db import db
        from services import sound_posts as sp
        track = await db.tracks.find_one({"id": tid}, {"_id": 0})
        owner = await db.users.find_one({"username": "stealth"}, {"_id": 0})
        return await sp.create_canonical_post(track, owner)
    post = _run(mkpost())
    assert post and post.get("is_canonical_sound")
    return tid


def test_canonical_post_endpoint(founder_token, canonical_track):
    r = requests.get(f"{BASE_URL}/api/sounds/{canonical_track}/canonical-post",
                     headers=_h(founder_token), timeout=30)
    assert r.status_code == 200
    post = r.json()["post"]
    assert post["sound_track_id"] == canonical_track
    assert "fire_total" in post and "my_fire" in post


def test_canonical_post_requires_auth(canonical_track):
    r = requests.get(f"{BASE_URL}/api/sounds/{canonical_track}/canonical-post", timeout=30)
    assert r.status_code in (401, 403)


def test_fire_on_canonical_post_shared_accounting(founder_token, newbie_token, canonical_track):
    r = requests.get(f"{BASE_URL}/api/sounds/{canonical_track}/canonical-post",
                     headers=_h(newbie_token), timeout=30)
    post_id = r.json()["post"]["id"]
    before = r.json()["post"].get("fire_total") or 0

    key = uuid.uuid4().hex
    r = requests.post(f"{BASE_URL}/api/fire/react", headers=_h(newbie_token),
                      json={"post_id": post_id, "fire_value": 1, "idempotency_key": key}, timeout=30)
    assert r.status_code == 200, r.text[:300]

    r = requests.get(f"{BASE_URL}/api/sounds/{canonical_track}/canonical-post",
                     headers=_h(newbie_token), timeout=30)
    after = r.json()["post"].get("fire_total") or 0
    assert after == before + 1

    # replay same idempotency key — no duplicate fire transaction
    r = requests.post(f"{BASE_URL}/api/fire/react", headers=_h(newbie_token),
                      json={"post_id": post_id, "fire_value": 1, "idempotency_key": key}, timeout=30)
    assert r.status_code == 200
    r = requests.get(f"{BASE_URL}/api/sounds/{canonical_track}/canonical-post",
                     headers=_h(newbie_token), timeout=30)
    assert (r.json()["post"].get("fire_total") or 0) == after

    # ONE canonical post per track — never a second fire target
    async def count():
        from core.db import db
        return await db.posts.count_documents(
            {"sound_track_id": canonical_track, "is_canonical_sound": True})
    assert _run(count()) == 1


# ------------------------------------------------------------ delete

def test_delete_playlist_keeps_sounds(founder_token, playlist, public_track):
    r = requests.delete(f"{BASE_URL}/api/playlists/{playlist['id']}",
                        headers=_h(founder_token), timeout=30)
    assert r.status_code == 200

    async def checks():
        from core.db import db
        gone = await db.playlists.find_one({"id": playlist["id"]})
        items = await db.playlist_items.count_documents({"playlist_id": playlist["id"]})
        track = await db.tracks.find_one({"id": public_track}, {"_id": 0, "id": 1})
        return gone, items, track
    gone, items, track = _run(checks())
    assert gone is None and items == 0
    assert track is not None  # canonical Sound never deleted
