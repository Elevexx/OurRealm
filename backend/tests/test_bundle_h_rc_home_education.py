"""Bundle H — RC Home page + Education dashboard backend tests.

Endpoints under test:
  GET  /api/responsibility-center/home-overview
  GET  /api/responsibility-center/{cid}/education/overview
  PATCH /api/responsibility-center/{cid}/education/students/{uid}
  POST /api/responsibility-center/create  (new center_types)
"""
import os
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
EDU_CID = "3ed43c2b553547fbb3e6ca23b405eb91"


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email} → {r.status_code}: {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def stealth_headers():
    return {"Authorization": f"Bearer {_login('stealth', 'Password1$')}"}


@pytest.fixture(scope="module")
def tftwo_headers():
    return {"Authorization": f"Bearer {_login('tftwo', 'pass1234')}"}


# ── /home-overview ───────────────────────────────────────────────────
class TestHomeOverview:
    def test_home_overview_shape(self, stealth_headers):
        r = requests.get(f"{BASE}/api/responsibility-center/home-overview",
                         headers=stealth_headers, timeout=30)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        # totals
        assert "totals" in j
        t = j["totals"]
        for k in ("centers_managed", "centers_total", "active_members",
                  "responsibilities", "tasks_due_today", "pending_approvals",
                  "upcoming_events", "fire_activity_week"):
            assert k in t, f"missing totals.{k}"
            assert isinstance(t[k], int), f"totals.{k} not int"
        # centers list
        assert isinstance(j.get("centers"), list)
        if j["centers"]:
            c = j["centers"][0]
            for k in ("id", "name", "health", "completion_pct", "open_tasks", "members"):
                assert k in c, f"center missing {k}"
        # trend 7 days
        assert isinstance(j.get("trend"), list) and len(j["trend"]) == 7
        for d in j["trend"]:
            assert "day" in d and "completed" in d
        # activity/alerts/system_status
        assert isinstance(j.get("activity"), list)
        assert isinstance(j.get("alerts"), list)
        assert isinstance(j.get("system_status"), list) and len(j["system_status"]) >= 3

    def test_home_overview_counts_match_db(self, stealth_headers):
        r = requests.get(f"{BASE}/api/responsibility-center/home-overview",
                         headers=stealth_headers, timeout=30)
        j = r.json()
        # centers_total equals number of centers[]
        assert j["totals"]["centers_total"] == len(j["centers"])


# ── /education/overview ─────────────────────────────────────────────
class TestEducationOverview:
    def test_owner_sees_all_students(self, stealth_headers):
        r = requests.get(f"{BASE}/api/responsibility-center/{EDU_CID}/education/overview",
                         headers=stealth_headers, timeout=30)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        assert j["can_manage"] is True
        assert isinstance(j["students"], list) and len(j["students"]) >= 1
        s = j["students"][0]
        for k in ("user_id", "stage", "grade_level", "ai_power_level", "focus_subjects"):
            assert k in s
        # ai_power_levels tiers with fp_per_day
        tiers = j.get("ai_power_levels") or []
        assert len(tiers) == 4
        keys = {t["key"] for t in tiers}
        assert keys == {"economy", "standard", "enhanced", "high"}
        fp_by_key = {t["key"]: t.get("fp_per_day") for t in tiers}
        assert fp_by_key == {"economy": 25, "standard": 50, "enhanced": 100, "high": 200}, fp_by_key
        # stage_levels
        sl = j.get("stage_levels") or {}
        assert set(sl.keys()) == {"prek", "k12", "higher"}
        assert "8" in sl["k12"]
        assert "Undergraduate" in sl["higher"]

    def test_stealth_default_state(self, stealth_headers):
        r = requests.get(f"{BASE}/api/responsibility-center/{EDU_CID}/education/overview",
                         headers=stealth_headers, timeout=30)
        j = r.json()
        stealth = next((s for s in j["students"] if s["username"] == "stealth"), None)
        assert stealth is not None
        # Test contract says stealth should be k12/'8'/'standard' by the end.
        # Log current state (used for later revert).
        print(f"stealth pre-test: stage={stealth['stage']} grade={stealth['grade_level']} ai={stealth['ai_power_level']}")

    def test_lessons_present(self, stealth_headers):
        r = requests.get(f"{BASE}/api/responsibility-center/{EDU_CID}/education/overview",
                         headers=stealth_headers, timeout=30)
        j = r.json()
        lessons = j.get("lessons") or []
        assert len(lessons) >= 5, f"expected ≥5 lessons, got {len(lessons)}"
        titles = [l["title"] for l in lessons]
        assert any("Photosynthesis" in t for t in titles), f"no photosynthesis lesson: {titles}"
        # completed count > 0
        assert j["summary"]["completed"] >= 1
        # completion_pct calculated
        assert 0 <= j["summary"]["completion_pct"] <= 100


# ── PATCH /education/students/{uid} ─────────────────────────────────
class TestUpdateStudent:
    def _stealth_uid(self, headers):
        r = requests.get(f"{BASE}/api/responsibility-center/{EDU_CID}/education/overview",
                         headers=headers, timeout=30)
        return next(s["user_id"] for s in r.json()["students"] if s["username"] == "stealth")

    def test_change_grade_level_persists(self, stealth_headers):
        uid = self._stealth_uid(stealth_headers)
        r = requests.patch(
            f"{BASE}/api/responsibility-center/{EDU_CID}/education/students/{uid}",
            headers=stealth_headers, json={"grade_level": "9"}, timeout=20)
        assert r.status_code == 200, r.text[:400]
        assert r.json()["education"]["grade_level"] == "9"
        # GET verifies persistence
        r2 = requests.get(f"{BASE}/api/responsibility-center/{EDU_CID}/education/overview",
                          headers=stealth_headers, timeout=20)
        stealth = next(s for s in r2.json()["students"] if s["username"] == "stealth")
        assert stealth["grade_level"] == "9"
        # Revert to 8
        r3 = requests.patch(
            f"{BASE}/api/responsibility-center/{EDU_CID}/education/students/{uid}",
            headers=stealth_headers, json={"grade_level": "8"}, timeout=20)
        assert r3.status_code == 200
        assert r3.json()["education"]["grade_level"] == "8"

    def test_invalid_grade_for_stage(self, stealth_headers):
        uid = self._stealth_uid(stealth_headers)
        # Undergraduate is not in k12 levels
        r = requests.patch(
            f"{BASE}/api/responsibility-center/{EDU_CID}/education/students/{uid}",
            headers=stealth_headers, json={"grade_level": "Undergraduate"}, timeout=20)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"

    def test_invalid_ai_power_level(self, stealth_headers):
        uid = self._stealth_uid(stealth_headers)
        r = requests.patch(
            f"{BASE}/api/responsibility-center/{EDU_CID}/education/students/{uid}",
            headers=stealth_headers, json={"ai_power_level": "ultra_supreme"}, timeout=20)
        assert r.status_code == 400

    def test_stage_change_to_higher_then_revert(self, stealth_headers):
        uid = self._stealth_uid(stealth_headers)
        # switch to higher / Undergraduate
        r = requests.patch(
            f"{BASE}/api/responsibility-center/{EDU_CID}/education/students/{uid}",
            headers=stealth_headers,
            json={"stage": "higher", "grade_level": "Undergraduate"}, timeout=20)
        assert r.status_code == 200, r.text[:400]
        edu = r.json()["education"]
        assert edu["stage"] == "higher"
        assert edu["grade_level"] == "Undergraduate"
        # revert to k12/'8'
        r2 = requests.patch(
            f"{BASE}/api/responsibility-center/{EDU_CID}/education/students/{uid}",
            headers=stealth_headers,
            json={"stage": "k12", "grade_level": "8"}, timeout=20)
        assert r2.status_code == 200
        edu2 = r2.json()["education"]
        assert edu2["stage"] == "k12" and edu2["grade_level"] == "8"

    def test_ensure_stealth_final_state_standard(self, stealth_headers):
        """Ensure stealth ends with ai_power_level=standard per test contract."""
        uid = self._stealth_uid(stealth_headers)
        r = requests.patch(
            f"{BASE}/api/responsibility-center/{EDU_CID}/education/students/{uid}",
            headers=stealth_headers, json={"ai_power_level": "standard"}, timeout=20)
        assert r.status_code == 200
        assert r.json()["education"]["ai_power_level"] == "standard"

    def test_non_manager_gets_403_and_sees_only_self(self, tftwo_headers):
        # First check if tftwo is a member of the education center
        r = requests.get(f"{BASE}/api/responsibility-center/{EDU_CID}/education/overview",
                         headers=tftwo_headers, timeout=20)
        if r.status_code == 403 or r.status_code == 404:
            pytest.skip("tftwo not a member of education center — 403 behavior not testable")
        assert r.status_code == 200
        j = r.json()
        # non-manager sees only themselves
        assert j["can_manage"] is False
        assert len(j["students"]) == 1
        assert j["students"][0]["username"] == "tftwo"
        # PATCH forbidden
        tftwo_uid = j["students"][0]["user_id"]
        r2 = requests.patch(
            f"{BASE}/api/responsibility-center/{EDU_CID}/education/students/{tftwo_uid}",
            headers=tftwo_headers, json={"grade_level": "5"}, timeout=20)
        assert r2.status_code == 403


# ── Create center with new types ────────────────────────────────────
class TestCreateCenterTypes:
    def _try_create(self, headers, ctype):
        return requests.post(f"{BASE}/api/responsibility-center/create",
                             headers=headers,
                             json={"name": f"TEST_H {ctype} {uuid.uuid4().hex[:6]}",
                                   "center_type": ctype,
                                   "description": "test - not for production",
                                   "client_token": uuid.uuid4().hex},
                             timeout=25)

    def test_invalid_type_rejected(self, stealth_headers):
        r = self._try_create(stealth_headers, "healthcare")
        assert r.status_code == 400, f"expected 400 for healthcare, got {r.status_code}: {r.text[:200]}"

    def test_invalid_type_government_rejected(self, stealth_headers):
        r = self._try_create(stealth_headers, "government")
        assert r.status_code == 400

    @pytest.mark.parametrize("ctype", ["education", "church", "sports", "personal", "volunteer"])
    def test_new_types_accepted_or_insufficient_funds(self, stealth_headers, ctype):
        """Type must pass validation. If FP insufficient, we still expect a Fire-Power
        error (400/402) rather than 'invalid type' — that proves type validation passed."""
        r = self._try_create(stealth_headers, ctype)
        # Acceptable: 200 (created), 402/400 (insufficient funds) — but NOT 'Choose a valid Center type'
        assert r.status_code in (200, 201, 400, 402, 403, 409), r.text[:200]
        # A 409 with "Fire Power" in detail proves type validation passed (moved past the type check)
        if r.status_code == 409:
            detail = (r.json().get("detail") or "").lower()
            assert "fire power" in detail or "vault" in detail, f"type '{ctype}' 409 not FP-related: {detail}"
            return
        if r.status_code == 400:
            detail = (r.json().get("detail") or "").lower()
            # must NOT be the invalid-type error
            assert "valid center type" not in detail and "invalid" not in detail or "fire" in detail or "vault" in detail or "balance" in detail, \
                f"type '{ctype}' rejected as invalid: {detail}"
        print(f"[{ctype}] → {r.status_code}: {r.text[:120]}")
