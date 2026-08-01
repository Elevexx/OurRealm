"""Phase 6 hardening: readiness, security probes, validation clamping."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
CENTER = "3ed43c2b553547fbb3e6ca23b405eb91"  # stealth + tftwo
OTHER_CENTER = "9d1b0f326e104980a9a45bd20c6b2bad"  # tftwo NOT a member
COURSE = "075f90ffcc3f41088b279dca7163c204"


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def stealth():
    return {"Authorization": f"Bearer {_login('stealth', 'Password1$')}"}


@pytest.fixture(scope="module")
def tftwo():
    return {"Authorization": f"Bearer {_login('tftwo', 'pass1234')}"}


# ── Readiness dashboard ────────────────────────────────────────────────
class TestReadiness:
    def test_founder_readiness_ok(self, stealth):
        r = requests.get(f"{BASE}/api/admin/orai/readiness", headers=stealth, timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert isinstance(d.get("score"), int)
        assert 0 <= d["score"] <= 100
        assert d.get("label") in ("Production Ready", "Nearly Ready", "Needs Attention", "Not Ready")
        checks = d.get("checks") or []
        assert len(checks) == 9, f"expected 9 checks, got {len(checks)}"
        keys = {c["key"] for c in checks}
        assert {"database", "ai_chat", "voice", "automations", "drafts",
                "vault", "media", "approvals", "jobs"} <= keys
        for c in checks:
            assert c["status"] in ("ok", "warn", "error")

    def test_member_readiness_forbidden(self, tftwo):
        r = requests.get(f"{BASE}/api/admin/orai/readiness", headers=tftwo, timeout=10)
        assert r.status_code == 403


# ── Security: member forbidden from manager/admin endpoints ────────────
class TestMemberForbidden:
    def test_put_memory_settings(self, tftwo):
        r = requests.put(f"{BASE}/api/responsibility-center/{CENTER}/orai/memory/settings",
                         json={"orai_memory_enabled": False}, headers=tftwo, timeout=10)
        assert r.status_code == 403

    def test_create_automation(self, tftwo):
        r = requests.post(f"{BASE}/api/responsibility-center/{CENTER}/automations",
                          json={"name": "x", "trigger": {"type": "manual"}, "actions": []},
                          headers=tftwo, timeout=10)
        assert r.status_code == 403

    def test_create_template(self, tftwo):
        r = requests.post(f"{BASE}/api/responsibility-center/{CENTER}/templates",
                          json={"name": "x", "kind": "automation", "payload": {}},
                          headers=tftwo, timeout=10)
        assert r.status_code == 403

    def test_get_report(self, tftwo):
        r = requests.post(f"{BASE}/api/responsibility-center/{CENTER}/reports/weekly",
                          json={}, headers=tftwo, timeout=10)
        assert r.status_code in (403, 404)

    def test_get_approvals(self, tftwo):
        r = requests.get(f"{BASE}/api/responsibility-center/{CENTER}/orai/drafts?status=draft",
                         headers=tftwo, timeout=10)
        assert r.status_code == 403

    def test_delete_course(self, tftwo):
        r = requests.delete(f"{BASE}/api/responsibility-center/{CENTER}/courses/{COURSE}",
                            headers=tftwo, timeout=10)
        assert r.status_code == 403

    def test_share_course(self, tftwo):
        r = requests.post(f"{BASE}/api/responsibility-center/{CENTER}/courses/{COURSE}/share",
                          json={"visibility": "public"}, headers=tftwo, timeout=10)
        assert r.status_code == 403

    def test_admin_config(self, tftwo):
        r = requests.get(f"{BASE}/api/admin/orai/config", headers=tftwo, timeout=10)
        assert r.status_code == 403

    def test_admin_readiness(self, tftwo):
        r = requests.get(f"{BASE}/api/admin/orai/readiness", headers=tftwo, timeout=10)
        assert r.status_code == 403


# ── Unauthenticated → 401 ──────────────────────────────────────────────
class TestUnauth:
    def test_voice_library(self):
        r = requests.get(f"{BASE}/api/orai/voice/library", timeout=10)
        assert r.status_code == 401

    def test_center_health(self):
        r = requests.get(f"{BASE}/api/responsibility-center/{CENTER}/health", timeout=10)
        assert r.status_code == 401

    def test_admin_config(self):
        r = requests.get(f"{BASE}/api/admin/orai/config", timeout=10)
        assert r.status_code == 401


# ── IDOR: tftwo trying to read a Center they don't belong to ──────────
class TestIDOR:
    def test_intelligence_overview_other_center(self, tftwo):
        r = requests.get(f"{BASE}/api/responsibility-center/{OTHER_CENTER}/orai/intelligence",
                         headers=tftwo, timeout=10)
        assert r.status_code in (403, 404), f"expected 403/404 got {r.status_code}: {r.text[:200]}"

    def test_course_list_other_center(self, tftwo):
        r = requests.get(f"{BASE}/api/responsibility-center/{OTHER_CENTER}/courses",
                         headers=tftwo, timeout=10)
        assert r.status_code in (403, 404)


# ── Input validation / clamping ───────────────────────────────────────
class TestInputValidation:
    def test_empty_draft_instructions(self, stealth):
        r = requests.post(f"{BASE}/api/responsibility-center/{CENTER}/orai/drafts/generate",
                          json={"instructions": ""}, headers=stealth, timeout=15)
        # should validate BEFORE LLM
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code}: {r.text[:200]}"

    def test_automation_bad_amount_clamps(self, stealth):
        payload = {
            "name": "TEST_iter107_clamp",
            "trigger": {"type": "member_joined"},
            "actions": [{"type": "award_fire_power", "amount": "abc"}],
        }
        r = requests.post(f"{BASE}/api/responsibility-center/{CENTER}/automations",
                          json=payload, headers=stealth, timeout=10)
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        auto = data.get("automation") or data
        actions = auto.get("actions") or []
        assert actions, "actions missing"
        amt = actions[0].get("amount")
        assert isinstance(amt, int), f"expected int, got {type(amt).__name__}={amt}"
        # cleanup
        aid = auto.get("id") or auto.get("_id")
        if aid:
            requests.delete(f"{BASE}/api/responsibility-center/{CENTER}/automations/{aid}",
                            headers=stealth, timeout=10)

    def test_approve_draft_nonexistent(self, stealth):
        r = requests.post(f"{BASE}/api/responsibility-center/{CENTER}/orai/drafts/nonexistentid/approve",
                          json={}, headers=stealth, timeout=10)
        assert r.status_code == 404

    def test_install_foreign_template(self, stealth):
        r = requests.post(f"{BASE}/api/responsibility-center/{CENTER}/orai/templates/definitely_not_a_real_id/install",
                          headers=stealth, timeout=10)
        assert r.status_code == 404

    def test_memory_html_injection_stored_inert(self, stealth):
        payload = {"kind": "note", "content": "<script>alert(1)</script>", "tags": ["TEST_iter107_xss"]}
        r = requests.post(f"{BASE}/api/responsibility-center/{CENTER}/orai/memory",
                          json=payload, headers=stealth, timeout=10)
        assert r.status_code == 200, r.text[:200]
        mem = r.json().get("memory") or r.json()
        mid = mem.get("id") or mem.get("_id")
        # verify stored as text (not executed HTML)
        content = mem.get("content") or ""
        assert "<script>" in content or "&lt;script&gt;" in content, \
            "content should be preserved as literal text"
        # ensure it's returned as a JSON string not something weird
        assert isinstance(content, str)
        # cleanup
        if mid:
            requests.delete(f"{BASE}/api/responsibility-center/{CENTER}/orai/memory/{mid}",
                            headers=stealth, timeout=10)
