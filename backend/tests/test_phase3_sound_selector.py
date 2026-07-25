"""Phase 3 — Media Sound Selector: browse, permission enforcement,
attachment snapshots, server-side revalidation, video audio replacement,
idempotency, canonical Sound preservation."""
import os
import subprocess
import tempfile
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


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def _ffmpeg():
    from imageio_ffmpeg import get_ffmpeg_exe
    return get_ffmpeg_exe()


_CLEANUP = {"tracks": [], "posts": [], "videos": []}


@pytest.fixture(scope="module")
def founder_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def member_token():
    return _login("auditcheckreal", "Password1$")


@pytest.fixture(scope="module")
def eligible_track(member_token):
    """A real audio track owned by auditcheckreal with media reuse enabled."""
    import io, math, struct, wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
        frames = b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * 330 * i / 22050)))
                          for i in range(22050 * 4))
        w.writeframes(frames)
    files = {"file": ("phase3_eligible.wav", buf.getvalue(), "audio/wav")}
    data = {"title": f"PHASE3_ELIGIBLE_{uuid.uuid4().hex[:6]}", "category": "Music",
            "genre": "Electronic", "mood": "Chill", "visibility": "public",
            "rights_confirmed": "true", "defer_post": "true"}
    r = requests.post(f"{BASE_URL}/api/sounds/upload", files=files, data=data,
                      headers=_h(member_token), timeout=60)
    assert r.status_code == 200, r.text[:300]
    tid = r.json()["track"]["id"] if "track" in r.json() else r.json().get("id")
    assert tid
    _CLEANUP["tracks"].append(tid)
    r = requests.patch(f"{BASE_URL}/api/sounds/{tid}/reuse-permissions",
                       json={"preset": "media_posts"}, headers=_h(member_token), timeout=30)
    assert r.status_code == 200 and r.json()["permissions"]["image_posts"] is True
    return tid


@pytest.fixture(scope="module")
def playable_only_track(founder_token):
    """Existing-style Sound left at the conservative default."""
    async def make():
        from core.db import db
        u = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
        tid = uuid.uuid4().hex
        from services.sound_permissions import default_permissions
        await db.tracks.insert_one({
            "id": tid, "user_id": u["id"], "title": f"PHASE3_LOCKED_{tid[:6]}",
            "category": "Music", "genre": "Pop", "mood": "", "visibility": "public",
            "likes": 0, "liked_by": [], "plays": 0, "duration_seconds": 5,
            "file_url": f"/api/media/audio/{tid}.mp3", "mime": "audio/mpeg",
            "reuse_permissions": default_permissions(), "reuse_preset": "playable_only",
            "created_at": "2026-07-01T00:00:00+00:00"})
        return tid
    tid = _run(make())
    _CLEANUP["tracks"].append(tid)
    return tid


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    async def go():
        from core.db import db
        from services.video_store import video_dir
        if _CLEANUP["tracks"]:
            await db.tracks.delete_many({"id": {"$in": _CLEANUP["tracks"]}})
            await db.posts.delete_many({"sound_track_id": {"$in": _CLEANUP["tracks"]}})
            await db.user_recent_sounds.delete_many({"track_id": {"$in": _CLEANUP["tracks"]}})
        if _CLEANUP["posts"]:
            await db.posts.delete_many({"id": {"$in": _CLEANUP["posts"]}})
        if _CLEANUP["videos"]:
            await db.videos.delete_many({"id": {"$in": _CLEANUP["videos"]}})
            await db.video_audio_rights.delete_many({"video_id": {"$in": _CLEANUP["videos"]}})
            for f in video_dir().glob("*"):
                if any(f.name.startswith(v) for v in _CLEANUP["videos"]):
                    f.unlink()
    _run(go())


# ── Browse ────────────────────────────────────────────────────────────
def test_browse_requires_auth():
    assert requests.get(f"{BASE_URL}/api/sounds/browse", timeout=15).status_code == 401


def test_browse_marks_eligibility(founder_token, eligible_track, playable_only_track):
    r = requests.get(f"{BASE_URL}/api/sounds/browse?use_type=image_posts&limit=60",
                     headers=_h(founder_token), timeout=15)
    assert r.status_code == 200
    rows = {s["id"]: s for s in r.json()["sounds"]}
    assert rows[eligible_track]["reuse_eligible"] is True
    assert rows[eligible_track]["reuse_badge"] == "Available for OurRealm Reuse"
    assert rows[playable_only_track]["reuse_eligible"] is False
    assert rows[playable_only_track]["reuse_badge"] == "Playable Only"


def test_browse_filters(founder_token, eligible_track, playable_only_track):
    # category
    r = requests.get(f"{BASE_URL}/api/sounds/browse?category=Music&limit=60",
                     headers=_h(founder_token), timeout=15)
    assert all(s["category"] == "Music" for s in r.json()["sounds"])
    # genre
    r = requests.get(f"{BASE_URL}/api/sounds/browse?genre=Electronic&limit=60",
                     headers=_h(founder_token), timeout=15)
    ids = [s["id"] for s in r.json()["sounds"]]
    assert eligible_track in ids and playable_only_track not in ids
    # mood
    r = requests.get(f"{BASE_URL}/api/sounds/browse?mood=Chill&limit=60",
                     headers=_h(founder_token), timeout=15)
    assert eligible_track in [s["id"] for s in r.json()["sounds"]]
    # search
    r = requests.get(f"{BASE_URL}/api/sounds/browse?q=PHASE3_ELIGIBLE&limit=60",
                     headers=_h(founder_token), timeout=15)
    assert [s["id"] for s in r.json()["sounds"]] == [eligible_track]
    # newest sort returns 200 + facets present
    r = requests.get(f"{BASE_URL}/api/sounds/browse?sort=newest&include_facets=1",
                     headers=_h(founder_token), timeout=15)
    assert r.status_code == 200 and "Electronic" in r.json()["genres"]
    # mine tab scopes to caller
    r = requests.get(f"{BASE_URL}/api/sounds/browse?tab=mine&limit=60",
                     headers=_h(founder_token), timeout=15)
    assert eligible_track not in [s["id"] for s in r.json()["sounds"]]


# ── Image attachment ──────────────────────────────────────────────────
def test_playable_only_cannot_attach(founder_token, playable_only_track):
    r = requests.post(f"{BASE_URL}/api/posts", headers=_h(founder_token), json={
        "content": "phase3 locked", "media_type": "image",
        "image_url": "/api/images/x.png",
        "sound_attachment": {"track_id": playable_only_track}}, timeout=30)
    assert r.status_code == 403
    assert "hasn't enabled" in r.json()["detail"]


def test_eligible_attach_stores_snapshot(founder_token, eligible_track):
    r = requests.post(f"{BASE_URL}/api/posts", headers=_h(founder_token), json={
        "content": "phase3 image + sound", "media_type": "image",
        "image_url": "/api/images/x.png",
        "sound_attachment": {"track_id": eligible_track, "start_seconds": 1,
                             "duration_seconds": 3, "fade_in": 0.5, "fade_out": 0.5,
                             "loop": True},
        "client_token": uuid.uuid4().hex}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    post = r.json().get("post") or r.json()
    _CLEANUP["posts"].append(post["id"])
    att = post["sound_attachment"]
    assert att["track_id"] == eligible_track
    assert att["use_type"] == "image_posts"
    assert att["loop"] is True and att["start_seconds"] == 1.0
    snap = att["permission_snapshot"]
    assert snap["track_id"] == eligible_track and snap["captured_at"]
    assert snap["permissions"]["image_posts"] is True

    # later permission change must NOT invalidate the stored snapshot
    async def check():
        from core.db import db
        return await db.posts.find_one({"id": post["id"]}, {"_id": 0, "sound_attachment": 1})
    assert _run(check())["sound_attachment"]["permission_snapshot"]["permissions"]["image_posts"] is True


def test_revalidation_after_owner_revokes(founder_token, member_token, eligible_track):
    requests.patch(f"{BASE_URL}/api/sounds/{eligible_track}/reuse-permissions",
                   json={"preset": "playable_only"}, headers=_h(member_token), timeout=30)
    r = requests.post(f"{BASE_URL}/api/posts", headers=_h(founder_token), json={
        "content": "should fail", "media_type": "image", "image_url": "/api/images/x.png",
        "sound_attachment": {"track_id": eligible_track}}, timeout=30)
    assert r.status_code == 403
    requests.patch(f"{BASE_URL}/api/sounds/{eligible_track}/reuse-permissions",
                   json={"preset": "media_posts"}, headers=_h(member_token), timeout=30)


def test_deleted_and_private_sound_fail_safely(founder_token, member_token):
    async def make(visibility="public", deleted=False):
        from core.db import db
        u = await db.users.find_one({"username": "auditcheckreal"}, {"_id": 0, "id": 1})
        tid = uuid.uuid4().hex
        doc = {"id": tid, "user_id": u["id"], "title": f"PHASE3_TMP_{tid[:6]}",
               "category": "Music", "visibility": visibility, "likes": 0, "liked_by": [],
               "plays": 0, "duration_seconds": 5, "file_url": f"/api/media/audio/{tid}.mp3",
               "mime": "audio/mpeg", "created_at": "2026-07-01T00:00:00+00:00",
               "reuse_permissions": {"image_posts": True, "video_posts": True},
               "reuse_preset": "media_posts"}
        if deleted:
            doc["deleted_at"] = "2026-07-25T00:00:00+00:00"
        await db.tracks.insert_one(doc)
        return tid
    deleted_tid = _run(make(deleted=True))
    private_tid = _run(make(visibility="private"))
    _CLEANUP["tracks"] += [deleted_tid, private_tid]
    for tid in (deleted_tid, private_tid):
        r = requests.post(f"{BASE_URL}/api/posts", headers=_h(founder_token), json={
            "content": "fail", "media_type": "image", "image_url": "/api/images/x.png",
            "sound_attachment": {"track_id": tid}}, timeout=30)
        assert r.status_code == 410, f"{tid} → {r.status_code}"
        assert "select another Sound" in r.json()["detail"]


def test_duplicate_publish_client_token(founder_token, eligible_track):
    token = uuid.uuid4().hex
    body = {"content": "phase3 dedupe", "media_type": "image",
            "image_url": "/api/images/x.png",
            "sound_attachment": {"track_id": eligible_track}, "client_token": token}
    r1 = requests.post(f"{BASE_URL}/api/posts", headers=_h(founder_token), json=body, timeout=30)
    r2 = requests.post(f"{BASE_URL}/api/posts", headers=_h(founder_token), json=body, timeout=30)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["post"]["id"] == r2.json()["post"]["id"]
    _CLEANUP["posts"].append(r1.json()["post"]["id"])

    async def count():
        from core.db import db
        return await db.posts.count_documents({"client_token": token})
    assert _run(count()) == 1


# ── Video replacement ─────────────────────────────────────────────────
@pytest.fixture(scope="module")
def uploaded_video(founder_token, tmp_path_factory):
    p = tmp_path_factory.mktemp("v") / "src.mp4"
    subprocess.run([_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    "-shortest", str(p)], check=True, timeout=120)
    files = {"file": ("src.mp4", p.read_bytes(), "video/mp4")}
    r = requests.post(f"{BASE_URL}/api/videos/upload", files=files,
                      data={"duration": "3", "audio_choice": "replace"},
                      headers=_h(founder_token), timeout=120)
    assert r.status_code == 200
    d = r.json()
    _CLEANUP["videos"].append(d["video"]["id"])
    # replace path uploads MUTED base — original audio never published
    assert d["audio"]["audio_published"] is False
    return d["video"]


def _has_audio(data: bytes) -> bool:
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        f.write(data); f.flush()
        proc = subprocess.run([_ffmpeg(), "-hide_banner", "-i", f.name],
                              capture_output=True, timeout=60)
        return b"Audio:" in proc.stderr


def test_video_replace_audio_end_to_end(founder_token, eligible_track, uploaded_video):
    body = {"track_id": eligible_track, "start_seconds": 0.5, "duration_seconds": 2.5,
            "volume": 1.2, "fade_in": 0.3, "fade_out": 0.3}
    r = requests.post(f"{BASE_URL}/api/videos/{uploaded_video['id']}/replace-audio",
                      headers=_h(founder_token), json=body, timeout=120)
    assert r.status_code == 200, r.text[:400]
    d = r.json()
    new_id = d["video"]["id"]
    _CLEANUP["videos"].append(new_id)
    assert new_id != uploaded_video["id"]
    assert d["audio"]["audio_rights_status"] == "replaced_with_ourrealm_sound"

    # derivative HAS audio (the Sound); muted base still has NONE
    tok = _h(founder_token)
    deriv = requests.get(f"{BASE_URL}{d['url']}", headers=tok, timeout=60, allow_redirects=True)
    assert deriv.status_code == 200 and _has_audio(deriv.content)
    base = requests.get(f"{BASE_URL}/api/videos/{uploaded_video['id']}.{uploaded_video['ext']}",
                        headers=tok, timeout=60)
    assert base.status_code == 200 and not _has_audio(base.content), \
        "muted base must remain audio-free (never overwritten)"

    # idempotency: identical params → same derivative, no new record
    r2 = requests.post(f"{BASE_URL}/api/videos/{uploaded_video['id']}/replace-audio",
                       headers=_h(founder_token), json=body, timeout=120)
    assert r2.json()["video"]["id"] == new_id

    async def counts():
        from core.db import db
        n = await db.videos.count_documents({"derived_from": uploaded_video["id"]})
        rights = await db.video_audio_rights.find_one({"video_id": new_id}, {"_id": 0})
        return n, rights
    n, rights = _run(counts())
    assert n == 1
    assert rights["rights_source"] == "ourrealm_sound_reuse"
    assert rights["replacement_sound_id"] == eligible_track
    assert rights["permission_snapshot"]["permissions"]["video_posts"] is True


def test_video_replace_rejects_playable_only(founder_token, playable_only_track, uploaded_video):
    r = requests.post(f"{BASE_URL}/api/videos/{uploaded_video['id']}/replace-audio",
                      headers=_h(founder_token),
                      json={"track_id": playable_only_track}, timeout=60)
    assert r.status_code == 403


def test_video_replace_rejects_non_owner(member_token, eligible_track, uploaded_video):
    r = requests.post(f"{BASE_URL}/api/videos/{uploaded_video['id']}/replace-audio",
                      headers=_h(member_token),
                      json={"track_id": eligible_track}, timeout=60)
    assert r.status_code == 403


def test_silent_publish_without_sound_still_works(founder_token, uploaded_video):
    """A user may always publish silently — no Sound required."""
    token = uuid.uuid4().hex
    r = requests.post(f"{BASE_URL}/api/posts", headers=_h(founder_token), json={
        "content": "silent video post", "media_type": "video",
        "video_url": f"/api/videos/{uploaded_video['id']}.{uploaded_video['ext']}",
        "client_token": token}, timeout=30)
    assert r.status_code == 200
    post = r.json().get("post") or r.json()
    _CLEANUP["posts"].append(post["id"])
    assert not post.get("sound_attachment")


def test_canonical_preservation(founder_token, eligible_track):
    """Attachments must not create duplicate tracks or canonical posts."""
    async def counts():
        from core.db import db
        tr = await db.tracks.count_documents({"id": eligible_track})
        canon = await db.posts.count_documents(
            {"sound_track_id": eligible_track, "is_canonical_sound": True})
        return tr, canon
    tr, canon = _run(counts())
    assert tr == 1
    assert canon <= 1
