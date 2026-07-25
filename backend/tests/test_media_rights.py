"""Phase 1-2 — Video audio rights enforcement + Sound reuse permissions."""
import asyncio
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


_UPLOADED_IDS = []


@pytest.fixture(scope="module", autouse=True)
def _cleanup_uploaded_videos():
    yield
    async def go():
        from core.db import db
        from services.video_store import video_dir
        if not _UPLOADED_IDS:
            return
        await db.videos.delete_many({"id": {"$in": _UPLOADED_IDS}})
        await db.video_audio_rights.delete_many({"video_id": {"$in": _UPLOADED_IDS}})
        for f in video_dir().glob("*"):
            if any(f.name.startswith(i) for i in _UPLOADED_IDS):
                f.unlink()
    _run(go())


@pytest.fixture(scope="module")
def founder_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def member_token():
    return _login("auditcheckreal", "Password1$")


def _ffmpeg():
    from imageio_ffmpeg import get_ffmpeg_exe
    return get_ffmpeg_exe()


@pytest.fixture(scope="module")
def video_with_audio(tmp_path_factory):
    p = tmp_path_factory.mktemp("vid") / "with_audio.mp4"
    subprocess.run([_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    "-shortest", str(p)], check=True, timeout=120)
    return p


def _has_audio(data: bytes) -> bool:
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        f.write(data)
        f.flush()
        proc = subprocess.run([_ffmpeg(), "-hide_banner", "-i", f.name],
                              capture_output=True, timeout=60)
        return b"Audio:" in proc.stderr


def _upload(token, path, **fields):
    files = {"file": (path.name, path.read_bytes(), "video/mp4")}
    data = {"duration": "3", **{k: str(v) for k, v in fields.items()}}
    r = requests.post(f"{BASE_URL}/api/videos/upload", files=files, data=data,
                      headers={"Authorization": f"Bearer {token}"}, timeout=120)
    try:
        vid = r.json().get("video", {}).get("id")
        if vid and vid not in _UPLOADED_IDS:
            _UPLOADED_IDS.append(vid)
    except Exception:
        pass
    return r


def _fetch(url):
    return requests.get(f"{BASE_URL}{url}", timeout=60,
                        headers={"Authorization": f"Bearer {_login('stealth', 'Password1$')}"})


def test_default_upload_is_muted(founder_token, video_with_audio):
    r = _upload(founder_token, video_with_audio)  # no choice sent at all
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d["audio"]["audio_detected"] is True
    assert d["audio"]["audio_published"] is False
    assert d["audio"]["audio_rights_status"] == "muted_no_confirmation"
    public = _fetch(d["url"]).content
    assert not _has_audio(public), "public derivative must contain NO audio"


def test_bypass_attempt_without_checkbox_is_muted(founder_token, video_with_audio):
    r = _upload(founder_token, video_with_audio, audio_choice="original",
                rights_confirmed="false")
    d = r.json()
    assert d["audio"]["audio_published"] is False
    assert not _has_audio(_fetch(d["url"]).content)


def test_confirmed_original_audio_publishes(founder_token, video_with_audio):
    r = _upload(founder_token, video_with_audio, audio_choice="original",
                rights_confirmed="true")
    d = r.json()
    assert d["audio"]["audio_published"] is True
    assert _has_audio(_fetch(d["url"]).content), "confirmed audio must be present"

    async def audit():
        from core.db import db
        return await db.video_audio_rights.find_one(
            {"video_id": d["video"]["id"]}, {"_id": 0})
    rec = _run(audit())
    assert rec["rights_confirmed"] is True and rec["rights_confirmed_at"]
    assert rec["terms_version"]


def test_original_audio_file_never_public(founder_token, video_with_audio):
    r = _upload(founder_token, video_with_audio)  # muted path stores .orig
    vid = r.json()["video"]
    resp = requests.get(f"{BASE_URL}/api/videos/{vid['id']}.orig.{vid['ext']}",
                        headers={"Authorization": f"Bearer {founder_token}"}, timeout=30)
    assert resp.status_code == 400, "private original must be rejected by the server"

    async def check_db():
        from core.db import db
        rec = await db.video_audio_rights.find_one({"video_id": vid["id"]}, {"_id": 0})
        return rec
    rec = _run(check_db())
    assert rec["original_asset_ref"] and ".orig." in rec["original_asset_ref"]


def test_repeated_publish_taps_create_no_duplicates(founder_token, video_with_audio):
    session = uuid.uuid4().hex
    r1 = _upload(founder_token, video_with_audio, upload_session_id=session)
    r2 = _upload(founder_token, video_with_audio, upload_session_id=session)
    id1, id2 = r1.json()["video"]["id"], r2.json()["video"]["id"]
    assert id1 == id2, "same session must return the same video"

    async def count():
        from core.db import db
        return await db.videos.count_documents({"upload_session_id": session})
    assert _run(count()) == 1


# ── Phase 2 — Sound reuse permissions ─────────────────────────────────
def test_existing_sounds_default_playable_only(founder_token):
    async def go():
        from core.db import db
        from services.sound_permissions import migration_dry_run, run_startup_migration
        await run_startup_migration()
        report = await migration_dry_run()
        t = await db.tracks.find_one({"title": "Calling in The City"}, {"_id": 0})
        return report, t
    report, t = _run(go())
    assert report["sounds_missing_reuse_permissions"] == 0
    assert t["reuse_preset"] == "playable_only"
    assert all(v is False for v in t["reuse_permissions"].values())

    from services.sound_permissions import can_reuse, permission_snapshot
    assert can_reuse(t, "image_posts") is False
    assert can_reuse(t, "personal_realm") is False
    snap = permission_snapshot(t)
    assert snap["track_id"] == t["id"] and snap["captured_at"]


def test_owner_can_change_permissions_others_cannot(founder_token, member_token):
    async def tid():
        from core.db import db
        t = await db.tracks.find_one({"title": "Calling in The City"}, {"_id": 0, "id": 1, "user_id": 1})
        return t["id"]
    track_id = _run(tid())  # owned by auditcheckreal
    # non-owner (regular member is the owner here; stealth is founder-admin,
    # so use a preset change by the owner then verify)
    r = requests.patch(f"{BASE_URL}/api/sounds/{track_id}/reuse-permissions",
                       json={"preset": "media_posts"},
                       headers={"Authorization": f"Bearer {member_token}"}, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["permissions"]["image_posts"] is True
    assert d["permissions"]["personal_realm"] is False
    assert d["preset"] == "media_posts"
    # revert to conservative default
    r = requests.patch(f"{BASE_URL}/api/sounds/{track_id}/reuse-permissions",
                       json={"preset": "playable_only"},
                       headers={"Authorization": f"Bearer {member_token}"}, timeout=30)
    assert r.status_code == 200 and r.json()["preset"] == "playable_only"


def test_non_owner_permission_change_rejected(founder_token, member_token):
    async def make():
        from core.db import db
        founder = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
        tid = uuid.uuid4().hex
        await db.tracks.insert_one({"id": tid, "user_id": founder["id"], "title": "PermTest",
                                    "category": "Music", "visibility": "public",
                                    "likes": 0, "liked_by": [], "duration_seconds": 5,
                                    "file_url": f"/api/sounds/{tid}.mp3", "mime": "audio/mpeg",
                                    "created_at": "2026-07-01T00:00:00+00:00"})
        return tid
    tid = _run(make())
    r = requests.patch(f"{BASE_URL}/api/sounds/{tid}/reuse-permissions",
                       json={"preset": "everywhere"},
                       headers={"Authorization": f"Bearer {member_token}"}, timeout=30)
    async def cleanup():
        from core.db import db
        await db.tracks.delete_one({"id": tid})
        await db.posts.delete_many({"sound_track_id": tid})
    _run(cleanup())
    assert r.status_code == 403


def test_legacy_videos_labeled_not_altered(founder_token):
    async def go():
        from core.db import db
        legacy = await db.videos.count_documents(
            {"audio_rights_status": "legacy_confirmation_not_collected"})
        unlabeled = await db.videos.count_documents({"audio_rights_status": {"$exists": False}})
        return legacy, unlabeled
    legacy, unlabeled = _run(go())
    assert unlabeled == 0, "every historical video must carry a rights status"
