"""
Backend tests for Media Pack Dashboard + Configurable Retry Engine (Sprint 1 hardening).
Covers:
  - GET media-status dashboard fields
  - POST media-retry (empty, with task ids)
  - Access control (403) for non-manager users
  - Admin AI-Video settings retry_schedule_seconds GET/PATCH
  - course-gen/active endpoint no-500
"""
import os
import time
import uuid
import datetime
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'test_database')

CENTER_ID = "3ed43c2b553547fbb3e6ca23b405eb91"
COURSE_ID = "df890c1fb03d44c9ba26e10761d89a27"
STEALTH_USER_ID = "e3cd1aab-6009-49f8-ac90-62736509699a"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def stealth():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def tftwo():
    return _login("tftwo", "pass1234")


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


# ---------- media-status dashboard shape ----------
def test_media_status_dashboard_fields(stealth):
    r = stealth.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/media-status", timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    expected_top = [
        "stage", "current_task", "provider_label", "queue_length", "queue_position",
        "retry_count", "pending_retries", "eta_seconds", "overall_pct",
        "images", "videos", "audio", "activities", "remaining_assets", "failed_assets",
    ]
    missing = [k for k in expected_top if k not in d]
    assert not missing, f"Missing keys in media-status: {missing}. Full: {d}"
    assert d["provider_label"] == "ORAi Video Engine", f"provider_label={d['provider_label']}"
    for grp in ("images", "videos", "audio", "activities"):
        assert isinstance(d[grp], dict), f"{grp} not a dict"
        for sub in ("planned", "done"):
            assert sub in d[grp], f"{grp} missing {sub}"
    # images/videos should track failed counters
    for grp in ("images", "videos"):
        assert "failed" in d[grp], f"{grp} missing failed counter"
    assert isinstance(d["failed_assets"], list)


# ---------- media-retry with no failed → 404 ----------
def test_media_retry_no_failed_returns_404(stealth):
    r = stealth.post(
        f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/media-retry",
        json={"task_ids": None}, timeout=20,
    )
    assert r.status_code == 404, f"Expected 404 got {r.status_code}: {r.text}"
    body = r.json()
    detail = (body.get("detail") or body.get("message") or "").lower()
    assert "no failed" in detail or "nothing" in detail or "no assets" in detail, f"Unexpected body: {body}"


# ---------- insert task → verify in status → requeue → cleanup ----------
def test_insert_needs_attention_then_requeue(stealth, mongo):
    tasks = mongo["rc_media_retry_tasks"]
    tid = uuid.uuid4().hex
    now = datetime.datetime.utcnow().isoformat()
    doc = {
        "id": tid,
        "course_id": COURSE_ID,
        "center_id": CENTER_ID,
        "asset_type": "image",
        "lesson_id": "fake",
        "block_id": "fake",
        "label": "Test asset",
        "prompt": "test",
        "attempt": 5,
        "max_attempts": 5,
        "last_error": "simulated provider error",
        "status": "needs_attention",
        "created_by": STEALTH_USER_ID,
        "created_at": now,
        "updated_at": now,
        "gen_job_id": None,
        "next_retry_at": None,
    }
    tasks.insert_one(doc)
    try:
        # verify media-status lists it
        r = stealth.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/media-status", timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        fa_ids = [a.get("id") for a in d.get("failed_assets", [])]
        assert tid in fa_ids, f"Inserted task {tid} not in failed_assets: {fa_ids}"
        # exact error preserved
        this = next(a for a in d["failed_assets"] if a.get("id") == tid)
        assert (this.get("error") or this.get("last_error")) == "simulated provider error", f"error mismatch: {this}"
        assert d["stage"] in ("needs_attention", "needs-attention"), f"stage={d['stage']}"

        # requeue via API
        r2 = stealth.post(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/media-retry",
            json={"task_ids": [tid]}, timeout=20,
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body.get("requeued") == 1, f"requeued != 1: {body}"

        # verify doc state
        updated = tasks.find_one({"id": tid})
        assert updated["status"] == "waiting", f"status={updated['status']}"
        assert updated["attempt"] == 0, f"attempt={updated['attempt']}"

        # Immediately push next_retry_at far in the future so worker skips it
        tasks.update_one({"id": tid}, {"$set": {"next_retry_at": "2030-01-01T00:00:00"}})
    finally:
        # CLEANUP fast to avoid worker picking it up
        tasks.delete_one({"id": tid})


# ---------- 403 for non-manager ----------
def test_media_status_403_for_non_manager(tftwo):
    r = tftwo.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/media-status", timeout=20)
    assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"


def test_media_retry_403_for_non_manager(tftwo):
    r = tftwo.post(
        f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/media-retry",
        json={"task_ids": None}, timeout=20,
    )
    assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"


# ---------- Admin AI-video settings retry_schedule ----------
def test_ai_video_settings_retry_schedule(stealth):
    r = stealth.get(f"{BASE_URL}/api/admin/ai-video/settings", timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    s = body.get("settings", body)
    assert "retry_schedule_seconds" in s, f"Missing retry_schedule_seconds: {s}"
    initial = s["retry_schedule_seconds"]
    # It should default to [20,120,300,900,1800] per SETTINGS_DEFAULTS
    assert initial == [20, 120, 300, 900, 1800], f"unexpected default: {initial}"

    try:
        r2 = stealth.patch(
            f"{BASE_URL}/api/admin/ai-video/settings",
            json={"retry_schedule_seconds": [30, 60, 300], "reason": "testing retry schedule config"},
            timeout=20,
        )
        assert r2.status_code == 200, r2.text
        d = r2.json()
        cur = d.get("retry_schedule_seconds") or d.get("settings", {}).get("retry_schedule_seconds")
        assert cur == [30, 60, 300], f"got {cur}"
    finally:
        r3 = stealth.patch(
            f"{BASE_URL}/api/admin/ai-video/settings",
            json={"retry_schedule_seconds": [20, 120, 300, 900, 1800], "reason": "restore default"},
            timeout=20,
        )
        assert r3.status_code == 200, r3.text


# ---------- course-gen active no 500 ----------
def test_course_gen_active(stealth):
    r = stealth.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/course-gen/active", timeout=20)
    assert r.status_code == 200, r.text
    b = r.json()
    assert "job" in b, f"missing job key: {b}"
    # job may be None or a dict, but must not 500
