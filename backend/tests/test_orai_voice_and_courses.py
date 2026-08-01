"""Iter 105: ORAi Voice + Course Studio/Player backend regression.

Scope:
  - /api/orai/voice/library, /prefs, /tts, /preview, /transcribe (auth-gated)
  - Course CRUD + player + approvals + certificate + tutor + report

Reuses published course 075f90ffcc3f41088b279dca7163c204 in center
3ed43c2b553547fbb3e6ca23b405eb91 (Johnson Family Learning, owned by
stealth). Does NOT generate a new course to save cost — the main
agent already verified generation.
"""
import os
import io
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
CENTER_ID = "3ed43c2b553547fbb3e6ca23b405eb91"
COURSE_ID = "075f90ffcc3f41088b279dca7163c204"

FOUNDER = {"email": "stealth", "password": "Password1$"}
MEMBER = {"email": "tftwo", "password": "pass1234"}

PROVIDER_LEAK_TOKENS = ["alloy", "onyx", "shimmer", "coral", "sage", "ash", "whisper", "openai", "_engine_voice"]


def _login(session, creds):
    r = session.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    session.headers.update({"Authorization": f"Bearer {token}"})
    return r.json()


@pytest.fixture(scope="module")
def founder():
    s = requests.Session()
    _login(s, FOUNDER)
    return s


@pytest.fixture(scope="module")
def member():
    s = requests.Session()
    _login(s, MEMBER)
    return s


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


# ── ORAi Voice ────────────────────────────────────────────────────────
class TestOraiVoice:
    def test_library_auth_required(self, anon):
        r = anon.get(f"{BASE_URL}/api/orai/voice/library", timeout=15)
        assert r.status_code == 401

    def test_library_returns_8_voices(self, founder):
        r = founder.get(f"{BASE_URL}/api/orai/voice/library", timeout=15)
        assert r.status_code == 200
        body = r.json()
        voices = body["voices"]
        assert len(voices) == 8
        ids = {v["id"] for v in voices}
        assert ids == {"nova", "atlas", "aurora", "ember", "luna", "orion", "echo", "titan"}
        for v in voices:
            assert set(v.keys()) >= {"id", "name", "tagline", "personality", "color"}
            assert "_engine_voice" not in v  # provider must not leak
        # provider names must NOT leak anywhere
        raw = r.text.lower()
        for token in PROVIDER_LEAK_TOKENS:
            if token == "echo":  # 'echo' is a legit ORAi voice id
                continue
            assert token not in raw, f"provider token leaked: {token}"

    def test_prefs_get_default(self, founder):
        r = founder.get(f"{BASE_URL}/api/orai/voice/prefs", timeout=15)
        assert r.status_code == 200
        p = r.json()
        assert p["voice_id"] in {"nova", "atlas", "aurora", "ember", "luna", "orion", "echo", "titan"}

    def test_prefs_put_valid(self, founder):
        r = founder.put(f"{BASE_URL}/api/orai/voice/prefs",
                        json={"voice_id": "luna", "speed": 1.25, "pitch": 2,
                              "volume": 0.8, "auto_speak": False, "mode": "continuous",
                              "favorites": ["luna", "orion", "invalid_voice"]}, timeout=15)
        assert r.status_code == 200
        p = r.json()
        assert p["voice_id"] == "luna"
        assert p["speed"] == 1.25
        assert p["pitch"] == 2
        assert p["volume"] == 0.8
        assert p["auto_speak"] is False
        assert p["mode"] == "continuous"
        assert "invalid_voice" not in p["favorites"]
        assert "luna" in p["favorites"]

    def test_prefs_clamps_out_of_range(self, founder):
        r = founder.put(f"{BASE_URL}/api/orai/voice/prefs",
                        json={"speed": 99, "pitch": -99, "volume": 5}, timeout=15)
        assert r.status_code == 200
        p = r.json()
        assert p["speed"] == 2.0
        assert p["pitch"] == -6.0
        assert p["volume"] == 1.0

    def test_prefs_reject_unknown_voice(self, founder):
        r = founder.put(f"{BASE_URL}/api/orai/voice/prefs",
                        json={"voice_id": "not_a_voice"}, timeout=15)
        assert r.status_code == 400

    def test_prefs_reject_unknown_mode(self, founder):
        r = founder.put(f"{BASE_URL}/api/orai/voice/prefs",
                        json={"mode": "hyper"}, timeout=15)
        assert r.status_code == 400

    def test_prefs_reset_defaults(self, founder):
        # restore something sane
        r = founder.put(f"{BASE_URL}/api/orai/voice/prefs",
                        json={"voice_id": "nova", "speed": 1.0, "pitch": 0,
                              "volume": 0.9, "auto_speak": True, "mode": "push"},
                        timeout=15)
        assert r.status_code == 200

    def test_preview_unknown_voice_404(self, founder):
        r = founder.get(f"{BASE_URL}/api/orai/voice/preview/nope", timeout=30)
        assert r.status_code == 404

    def test_preview_returns_mp3(self, founder):
        r = founder.get(f"{BASE_URL}/api/orai/voice/preview/atlas", timeout=90)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("audio/mpeg")
        assert len(r.content) > 500

    def test_tts_returns_mp3(self, founder):
        r = founder.post(f"{BASE_URL}/api/orai/voice/tts",
                         json={"text": "Hello from ORAi tests"}, timeout=90)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("audio/mpeg")
        assert len(r.content) > 500

    def test_tts_empty_400(self, founder):
        r = founder.post(f"{BASE_URL}/api/orai/voice/tts", json={"text": "  "}, timeout=15)
        assert r.status_code == 400

    def test_transcribe_auth_required(self, anon):
        r = anon.post(f"{BASE_URL}/api/orai/voice/transcribe",
                      files={"audio": ("x.mp3", b"\x00", "audio/mpeg")}, timeout=15)
        assert r.status_code == 401

    def test_transcribe_empty_400(self, founder):
        # server rejects empty payload
        r = founder.post(f"{BASE_URL}/api/orai/voice/transcribe",
                         files={"audio": ("x.mp3", b"", "audio/mpeg")}, timeout=30)
        assert r.status_code == 400

    def test_transcribe_roundtrip(self, founder):
        # Get real mp3 from tts, feed to transcribe.
        tts = founder.post(f"{BASE_URL}/api/orai/voice/tts",
                           json={"text": "The quick brown fox jumps over the lazy dog"},
                           timeout=90)
        assert tts.status_code == 200
        r = founder.post(f"{BASE_URL}/api/orai/voice/transcribe",
                         files={"audio": ("clip.mp3", tts.content, "audio/mpeg")},
                         timeout=120)
        assert r.status_code == 200, r.text
        assert "text" in r.json()


# ── Course CRUD ───────────────────────────────────────────────────────
class TestCoursesCRUD:
    def test_list_manager_sees_all(self, founder):
        r = founder.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses",
                        timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["can_manage"] is True
        ids = [c["id"] for c in body["courses"]]
        assert COURSE_ID in ids

    def test_detail_manager_sees_answer_keys(self, founder):
        r = founder.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}",
                        timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["can_manage"] is True
        assert body["course"]["id"] == COURSE_ID
        # find a quiz lesson and confirm answer key is present
        q_lessons = [l for l in body["lessons"] if l.get("quiz", {}).get("questions")]
        assert q_lessons, "expected at least one lesson with quiz"
        first_q = q_lessons[0]["quiz"]["questions"][0]
        assert "answer_index" in first_q
        assert "explanation" in first_q

    def test_detail_learner_answer_key_hidden(self, member, founder):
        # ensure tftwo is a member of the center, else invite+accept
        m_list = founder.get(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/members", timeout=15)
        if m_list.status_code == 200:
            usernames = [m.get("username") for m in m_list.json().get("members", [])]
        else:
            usernames = []
        if "tftwo" not in usernames:
            # ensure vault has >= 100 FP for member activation
            founder.post(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/vault/fund",
                         json={"amount": 100, "idempotency_key": "iter105-seat-a"},
                         timeout=15)
            # invite (may already be pending — ignore 409)
            founder.post(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/invite",
                         json={"username": "tftwo"}, timeout=15)
            acc = member.post(
                f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/invites/respond",
                json={"accept": True}, timeout=15)
            assert acc.status_code in (200, 201), acc.text

        r = member.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}",
                       timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["can_manage"] is False
        for les in body["lessons"]:
            for q in les.get("quiz", {}).get("questions", []):
                assert "answer_index" not in q, f"answer_index leaked to learner: {q}"
                assert "explanation" not in q, f"explanation leaked to learner: {q}"

    def test_learner_cannot_get_report(self, member):
        r = member.get(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/report",
            timeout=15)
        assert r.status_code == 403

    def test_manager_can_get_report(self, founder):
        r = founder.get(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/report",
            timeout=15)
        assert r.status_code == 200
        assert "students" in r.json()

    def test_add_and_delete_lesson(self, founder):
        add = founder.post(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/lessons",
            json={"title": "TEST_temp lesson", "lesson_type": "lesson",
                  "blocks": [{"type": "text", "title": "T", "body": "Temp body"}]},
            timeout=15)
        assert add.status_code == 200, add.text
        lid = add.json()["lesson"]["id"]

        # patch title
        patch = founder.patch(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/lessons/{lid}",
            json={"title": "TEST_temp lesson renamed"}, timeout=15)
        assert patch.status_code == 200
        assert patch.json()["lesson"]["title"] == "TEST_temp lesson renamed"

        # cleanup
        d = founder.delete(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/lessons/{lid}",
            timeout=15)
        assert d.status_code == 200


# ── Player flow (learner) ─────────────────────────────────────────────
class TestPlayerFlow:
    def _find_quiz_and_checkpoint(self, session):
        r = session.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}",
                        timeout=15)
        assert r.status_code == 200, r.text
        lessons = r.json()["lessons"]
        quiz = next((l for l in lessons if l["lesson_type"] == "quiz"
                     and l.get("quiz", {}).get("questions")), None)
        cp = next((l for l in lessons if l["lesson_type"] == "checkpoint"
                   and l.get("quiz", {}).get("questions")), None)
        return lessons, quiz, cp

    def test_learner_submit_quiz(self, member, founder):
        # get answer key as manager
        mgr = founder.get(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}",
            timeout=15).json()
        # find first non-checkpoint quiz lesson
        target = next((l for l in mgr["lessons"]
                       if l["lesson_type"] == "quiz" and l.get("quiz", {}).get("questions")), None)
        if not target:
            pytest.skip("no quiz lesson available")
        answers = {q["id"]: q["answer_index"] for q in target["quiz"]["questions"]}
        r = member.post(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}"
            f"/lessons/{target['id']}/quiz",
            json={"answers": answers}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["score"] == body["total"]
        # explanations returned as feedback
        assert all("explanation" in res for res in body["results"])

    def test_checkpoint_requires_approval(self, member, founder):
        mgr = founder.get(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}",
            timeout=15).json()
        cp = next((l for l in mgr["lessons"] if l["lesson_type"] == "checkpoint"
                   and l.get("quiz", {}).get("questions")), None)
        if not cp:
            pytest.skip("no checkpoint lesson")
        answers = {q["id"]: q["answer_index"] for q in cp["quiz"]["questions"]}
        r = member.post(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}"
            f"/lessons/{cp['id']}/quiz",
            json={"answers": answers}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["needs_approval"] is True

        # manager sees the pending approval
        appr = founder.get(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/approvals",
            timeout=15).json()
        pending = [a for a in appr["approvals"]
                   if a["lesson_id"] == cp["id"] and a["user_id"]]
        assert pending, "expected pending approval for checkpoint"

        # approve
        pid = pending[0]["id"]
        ok = founder.post(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}"
            f"/approvals/{pid}",
            json={"approve": True}, timeout=15)
        assert ok.status_code == 200

    def test_save_position(self, member, founder):
        mgr = founder.get(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}",
            timeout=15).json()
        lid = mgr["lessons"][0]["id"]
        r = member.post(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/position",
            json={"lesson_id": lid}, timeout=15)
        assert r.status_code == 200
        # verify persisted via detail
        det = member.get(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}",
            timeout=15).json()
        assert det.get("resume_lesson_id") == lid

    def test_certificate_incomplete_409(self, member):
        r = member.get(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/certificate",
            timeout=15)
        # learner unlikely to be 100% done — expect 409 or (if fully done) 200
        assert r.status_code in (409, 200)
        if r.status_code == 200:
            body = r.json()
            assert "not an accredited" in body.get("disclaimer", "").lower()

    def test_tutor_reply(self, member, founder):
        mgr = founder.get(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}",
            timeout=15).json()
        lid = mgr["lessons"][0]["id"]
        r = member.post(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}/tutor",
            json={"lesson_id": lid, "message": "Give me a one-sentence hint about this lesson."},
            timeout=90)
        assert r.status_code == 200, r.text
        assert r.json().get("reply")
        # history should include our turn
        h = member.get(
            f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/courses/{COURSE_ID}"
            f"/tutor/{lid}",
            timeout=15)
        assert h.status_code == 200
        assert len(h.json()["messages"]) >= 2
