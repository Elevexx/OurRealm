"""Bundle 1b — Realm Soundtrack (profile) backend tests.
Owner-only assignment, own-playlist enforcement, visitor track
eligibility (private tracks hidden from visitors), removal."""
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


async def _mk_track(username, visibility="public"):
    from core.db import db
    from services.sound_permissions import default_permissions
    u = await db.users.find_one({"username": username}, {"_id": 0, "id": 1})
    tid = uuid.uuid4().hex
    await db.tracks.insert_one({
        "id": tid, "user_id": u["id"], "title": f"ST_{tid[:6]}",
        "category": "Music", "genre": "Pop", "mood": "", "visibility": visibility,
        "likes": 0, "liked_by": [], "plays": 0, "duration_seconds": 5,
        "file_url": f"/api/media/audio/{tid}.mp3", "mime": "audio/mpeg",
        "reuse_permissions": default_permissions(), "reuse_preset": "playable_only",
        "created_at": "2026-07-01T00:00:00+00:00"})
    return tid


@pytest.fixture(scope="module")
def founder_playlist(founder_token):
    r = requests.post(f"{BASE_URL}/api/playlists", headers=_h(founder_token),
                      json={"name": f"Soundtrack {uuid.uuid4().hex[:5]}"}, timeout=30)
    pid = r.json()["playlist"]["id"]
    _CLEAN["playlists"].append(pid)
    pub = _run(_mk_track("stealth", "public"))
    priv = _run(_mk_track("stealth", "private"))
    _CLEAN["tracks"] += [pub, priv]
    for tid in (pub, priv):
        rr = requests.post(f"{BASE_URL}/api/playlists/{pid}/items",
                           headers=_h(founder_token), json={"track_id": tid}, timeout=30)
        assert rr.status_code == 200, rr.text[:200]
    return {"id": pid, "pub": pub, "priv": priv}


@pytest.fixture(scope="module", autouse=True)
def _cleanup(founder_token):
    yield
    requests.put(f"{BASE_URL}/api/playlists/soundtrack",
                 headers=_h(_login("stealth", "Password1$")),
                 json={"playlist_id": None}, timeout=30)

    async def go():
        from core.db import db
        if _CLEAN["playlists"]:
            await db.playlist_items.delete_many({"playlist_id": {"$in": _CLEAN["playlists"]}})
            await db.playlists.delete_many({"id": {"$in": _CLEAN["playlists"]}})
        if _CLEAN["tracks"]:
            await db.tracks.delete_many({"id": {"$in": _CLEAN["tracks"]}})
    _run(go())


def test_owner_assigns_soundtrack(founder_token, founder_playlist):
    r = requests.put(f"{BASE_URL}/api/playlists/soundtrack", headers=_h(founder_token),
                     json={"playlist_id": founder_playlist["id"],
                           "start_track_id": founder_playlist["pub"],
                           "shuffle": False, "repeat": True, "autoplay": True}, timeout=30)
    assert r.status_code == 200 and r.json()["enabled"] is True


def test_cannot_use_foreign_playlist(member_token, founder_playlist):
    r = requests.put(f"{BASE_URL}/api/playlists/soundtrack", headers=_h(member_token),
                     json={"playlist_id": founder_playlist["id"]}, timeout=30)
    assert r.status_code == 403


def test_requires_auth(founder_playlist):
    r = requests.put(f"{BASE_URL}/api/playlists/soundtrack",
                     json={"playlist_id": founder_playlist["id"]}, timeout=30)
    assert r.status_code in (401, 403)


def test_owner_sees_all_tracks(founder_token, founder_playlist):
    r = requests.get(f"{BASE_URL}/api/playlists/soundtrack/by-user/stealth",
                     headers=_h(founder_token), timeout=30)
    d = r.json()
    assert d["enabled"] is True and d["is_owner"] is True
    ids = [t["id"] for t in d["tracks"]]
    assert founder_playlist["pub"] in ids and founder_playlist["priv"] in ids
    assert d["settings"] == {"start_track_id": founder_playlist["pub"],
                             "shuffle": False, "repeat": True, "autoplay": True}


def test_visitor_gets_only_public_tracks(member_token, founder_playlist):
    r = requests.get(f"{BASE_URL}/api/playlists/soundtrack/by-user/stealth",
                     headers=_h(member_token), timeout=30)
    d = r.json()
    assert d["enabled"] is True and d["is_owner"] is False
    ids = [t["id"] for t in d["tracks"]]
    assert founder_playlist["pub"] in ids
    assert founder_playlist["priv"] not in ids
    assert d["playlist"]["name"].startswith("Soundtrack ")


def test_remove_soundtrack(founder_token, member_token):
    r = requests.put(f"{BASE_URL}/api/playlists/soundtrack", headers=_h(founder_token),
                     json={"playlist_id": None}, timeout=30)
    assert r.status_code == 200 and r.json()["enabled"] is False
    r = requests.get(f"{BASE_URL}/api/playlists/soundtrack/by-user/stealth",
                     headers=_h(member_token), timeout=30)
    assert r.json()["enabled"] is False
