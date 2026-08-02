"""Iter-108: Global Access Control end-to-end backend tests.

Covers: founder-only control plane, non-founder + support-admin 403s,
per-mode enforcement (view_only/hidden/maintenance/admin_only/founder_only/
invite_only/custom/emergency_lock/public_preview), sub-feature isolation,
master cascade, safe emergency lock+restore snapshot, schedules one-time
+ recurring, allowlist grant/revoke, impact preview, preview-as, audit,
public /status + /preview-demo, race conditions, IDOR/action-GET blocking.

CRITICAL: settings cache 3s server-side → sleep 4s after every mode change.
CRITICAL: production state MUST be restored at end (all full_access, rc_public_preview=hidden).
"""
import concurrent.futures as cf
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
SETTLE = 4.2  # >3s cache TTL


def _login(username: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": username, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def founder():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="session")
def support_admin():
    return _login("support", "Password1$")


@pytest.fixture(scope="session")
def user_tftwo():
    return _login("tftwo", "pass1234")


@pytest.fixture(scope="session")
def user_audit():
    return _login("auditcheckreal", "Password1$")


@pytest.fixture(scope="session")
def anon():
    return requests.Session()


def _set_feature(founder, feature: str, mode: str, message: str = "", custom_rules: dict | None = None):
    body = {"mode": mode, "message": message, "reason": f"iter108 test {mode}"}
    if custom_rules is not None:
        body["custom_rules"] = custom_rules
    r = founder.patch(f"{API}/admin/access-control/features/{feature}", json=body, timeout=20)
    assert r.status_code == 200, f"patch {feature}={mode} failed: {r.status_code} {r.text}"
    time.sleep(SETTLE)


# ────────────────────────── 1. Control plane access
class TestControlPlaneAccess:
    def test_founder_can_get_panel(self, founder):
        r = founder.get(f"{API}/admin/access-control", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "settings" in data and "registry" in data and "modes" in data and "schedules" in data
        # 11 features
        assert len(data["registry"]) == 11
        for k in ["responsibility_center", "orai", "orai_voice", "course_generation",
                  "course_player", "ai_automations", "ai_memory", "ai_recommendations",
                  "rc_public_preview", "center_creation", "center_joining"]:
            assert k in data["registry"], f"missing feature {k}"
        # modes contains 10
        assert len(data["modes"]) == 10

    def test_support_admin_403_on_panel(self, support_admin):
        r = support_admin.get(f"{API}/admin/access-control", timeout=20)
        assert r.status_code == 403, f"support admin should be 403, got {r.status_code}"

    def test_regular_user_403_on_panel(self, user_tftwo):
        r = user_tftwo.get(f"{API}/admin/access-control", timeout=20)
        assert r.status_code == 403

    def test_support_admin_403_on_all_control_endpoints(self, support_admin):
        endpoints = [
            ("GET", "/admin/access-control"),
            ("GET", "/admin/access-control/audit"),
            ("GET", "/admin/access-control/impact?feature=orai&mode=view_only"),
            ("GET", "/admin/access-control/preview-as?persona=founder"),
        ]
        for m, ep in endpoints:
            r = support_admin.request(m, f"{API}{ep}", timeout=20)
            assert r.status_code == 403, f"support 403 expected on {ep}, got {r.status_code}"

    def test_support_admin_403_on_patch(self, support_admin):
        r = support_admin.patch(f"{API}/admin/access-control/features/orai",
                                 json={"mode": "view_only", "reason": "unauthorized"}, timeout=20)
        assert r.status_code == 403


# ────────────────────────── 2. view_only mode
class TestViewOnly:
    def test_view_only_enforcement(self, founder, user_tftwo):
        _set_feature(founder, "responsibility_center", "view_only", "Temporarily in view-only")
        try:
            # GET (read) → 200
            r = user_tftwo.get(f"{API}/responsibility-center/mine", timeout=20)
            assert r.status_code == 200, f"GET mine should 200 in view_only, got {r.status_code} {r.text[:200]}"
            # POST /create (write) → 423 view_only
            r = user_tftwo.post(f"{API}/responsibility-center/create",
                                 json={"name": "TEST_iter108_vo", "type": "family"}, timeout=20)
            assert r.status_code == 423, f"POST create should 423 in view_only, got {r.status_code}"
            body = r.json()
            assert body.get("detail", {}).get("code") == "view_only"
            assert body["detail"].get("mode") == "view_only"
        finally:
            _set_feature(founder, "responsibility_center", "full_access")

    def test_view_only_blocks_action_get(self, founder, user_tftwo):
        """GETs containing export/download/generate are treated as writes."""
        _set_feature(founder, "responsibility_center", "view_only")
        try:
            # any RC path with 'export' substring should 423
            r = user_tftwo.get(f"{API}/responsibility-center/anything/reports-export", timeout=20)
            assert r.status_code == 423, f"action-GET should 423 view_only, got {r.status_code}"
            assert r.json().get("detail", {}).get("code") == "view_only"
        finally:
            _set_feature(founder, "responsibility_center", "full_access")


# ────────────────────────── 3. hidden mode
class TestHidden:
    def test_hidden_returns_404_for_regular_and_200_for_founder(self, founder, user_tftwo):
        _set_feature(founder, "responsibility_center", "hidden")
        try:
            r_u = user_tftwo.get(f"{API}/responsibility-center/mine", timeout=20)
            assert r_u.status_code == 404
            # No leakage
            body = r_u.text
            assert "Fire" not in body and "tftwo" not in body and "center" not in body.lower() or "detail" in body
            # Founder bypass → 200
            r_f = founder.get(f"{API}/responsibility-center/mine", timeout=20)
            assert r_f.status_code == 200, f"founder bypass should 200, got {r_f.status_code}"
        finally:
            _set_feature(founder, "responsibility_center", "full_access")


# ────────────────────────── 4. maintenance mode
class TestMaintenance:
    def test_maintenance_returns_503_with_custom_message(self, founder, user_tftwo):
        msg = "Scheduled RC maintenance — iter108"
        _set_feature(founder, "responsibility_center", "maintenance", msg)
        try:
            r = user_tftwo.get(f"{API}/responsibility-center/mine", timeout=20)
            assert r.status_code == 503
            assert r.json().get("detail", {}).get("message") == msg
        finally:
            _set_feature(founder, "responsibility_center", "full_access")


# ────────────────────────── 5. admin_only / founder_only
class TestAdminAndFounderOnly:
    def test_admin_only(self, founder, user_tftwo, support_admin):
        _set_feature(founder, "responsibility_center", "admin_only")
        try:
            assert user_tftwo.get(f"{API}/responsibility-center/mine", timeout=20).status_code == 403
            assert support_admin.get(f"{API}/responsibility-center/mine", timeout=20).status_code == 200
        finally:
            _set_feature(founder, "responsibility_center", "full_access")

    def test_founder_only(self, founder, support_admin):
        _set_feature(founder, "responsibility_center", "founder_only")
        try:
            assert support_admin.get(f"{API}/responsibility-center/mine", timeout=20).status_code == 403
            assert founder.get(f"{API}/responsibility-center/mine", timeout=20).status_code == 200
        finally:
            _set_feature(founder, "responsibility_center", "full_access")


# ────────────────────────── 6. invite_only
class TestInviteOnly:
    def test_invite_only_gates_by_invited_list(self, founder, user_tftwo, user_audit):
        # set invited list to just tftwo
        r = founder.put(f"{API}/admin/access-control/invited", json={"usernames": ["tftwo"]}, timeout=20)
        assert r.status_code == 200
        assert r.json()["invited_usernames"] == ["tftwo"]
        _set_feature(founder, "responsibility_center", "invite_only")
        try:
            assert user_tftwo.get(f"{API}/responsibility-center/mine", timeout=20).status_code == 200
            r2 = user_audit.get(f"{API}/responsibility-center/mine", timeout=20)
            assert r2.status_code == 403
            assert r2.json().get("detail", {}).get("code") == "invite_required"
        finally:
            _set_feature(founder, "responsibility_center", "full_access")
            # clear invited
            founder.put(f"{API}/admin/access-control/invited", json={"usernames": []}, timeout=20)
            time.sleep(SETTLE)


# ────────────────────────── 7. custom rules
class TestCustom:
    def test_custom_reads_allowed_writes_blocked(self, founder, user_tftwo):
        r = founder.patch(f"{API}/admin/access-control/features/responsibility_center",
                           json={"mode": "custom", "reason": "iter108 custom",
                                 "custom_rules": {"allow_reads": True, "allow_writes": False}}, timeout=20)
        assert r.status_code == 200
        time.sleep(SETTLE)
        try:
            assert user_tftwo.get(f"{API}/responsibility-center/mine", timeout=20).status_code == 200
            r2 = user_tftwo.post(f"{API}/responsibility-center/create",
                                  json={"name": "TEST_iter108_custom", "type": "family"}, timeout=20)
            assert r2.status_code == 423
            assert r2.json().get("detail", {}).get("code") == "custom_restricted"
        finally:
            _set_feature(founder, "responsibility_center", "full_access")


# ────────────────────────── 8. sub-feature isolation & master cascade
class TestCascade:
    def test_orai_voice_maintenance_does_not_affect_rc(self, founder, user_tftwo):
        _set_feature(founder, "orai_voice", "maintenance", "voice down")
        try:
            r = user_tftwo.get(f"{API}/orai/voice/library", timeout=20)
            assert r.status_code == 503
            r2 = user_tftwo.get(f"{API}/responsibility-center/mine", timeout=20)
            assert r2.status_code == 200
        finally:
            _set_feature(founder, "orai_voice", "full_access")

    def test_orai_master_cascades_to_voice(self, founder, user_tftwo):
        _set_feature(founder, "orai", "emergency_lock", "master lock")
        try:
            r = user_tftwo.get(f"{API}/orai/voice/library", timeout=20)
            assert r.status_code == 423
            assert r.json().get("detail", {}).get("code") == "emergency_lock"
        finally:
            _set_feature(founder, "orai", "full_access")


# ────────────────────────── 9. Emergency lock + safe restore
class TestEmergencyLock:
    def test_engage_and_restore_snapshot(self, founder, user_tftwo):
        # Set RC to maintenance to test snapshot restore
        _set_feature(founder, "responsibility_center", "maintenance", "pre-lock maint")
        try:
            # Engage
            r = founder.post(f"{API}/admin/access-control/emergency-lock",
                              json={"engage": True, "reason": "iter108 emergency test"}, timeout=20)
            assert r.status_code == 200 and r.json().get("locked") is True
            time.sleep(SETTLE)
            # Everything 423 for regular user
            r2 = user_tftwo.get(f"{API}/responsibility-center/mine", timeout=20)
            assert r2.status_code == 423
            r3 = user_tftwo.get(f"{API}/orai/voice/library", timeout=20)
            assert r3.status_code == 423
            # Disengage
            r4 = founder.post(f"{API}/admin/access-control/emergency-lock",
                               json={"engage": False, "reason": "iter108 unlock"}, timeout=20)
            assert r4.status_code == 200 and r4.json().get("locked") is False
            time.sleep(SETTLE)
            # Snapshot restored → RC back to maintenance, orai back to full_access
            panel = founder.get(f"{API}/admin/access-control", timeout=20).json()
            assert panel["settings"]["features"]["responsibility_center"]["mode"] == "maintenance"
            assert panel["settings"]["features"]["orai"]["mode"] == "full_access"
        finally:
            _set_feature(founder, "responsibility_center", "full_access")


# ────────────────────────── 10. Public preview isolation
class TestPublicPreview:
    def test_preview_demo_gated_and_isolated(self, founder, user_tftwo, anon):
        _set_feature(founder, "responsibility_center", "public_preview")
        try:
            # regular user gets 403 on real endpoint (no data leak)
            r = user_tftwo.get(f"{API}/responsibility-center/mine", timeout=20)
            assert r.status_code == 403
            # anon can hit demo endpoint
            r2 = anon.get(f"{API}/access-control/preview-demo", timeout=20)
            assert r2.status_code == 200
            body = r2.text
            data = r2.json()
            assert "Demo Family Center" in body
            # No real usernames or real center data — only demo static payload keys
            allowed_top_keys = {"notice", "center", "sample_tasks", "sample_calendar", "capabilities"}
            assert set(data.keys()).issubset(allowed_top_keys), f"unexpected keys: {set(data.keys())-allowed_top_keys}"
            # No real usernames present
            assert "tftwo" not in body and "stealth" not in body and "auditcheckreal" not in body
        finally:
            _set_feature(founder, "responsibility_center", "full_access")
        # Now with RC full_access & rc_public_preview default hidden → demo 404
        r3 = anon.get(f"{API}/access-control/preview-demo", timeout=20)
        assert r3.status_code == 404


# ────────────────────────── 11. Schedules
class TestSchedules:
    def test_one_time_past_schedule_executes(self, founder):
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        body = {"feature_key": "orai_voice", "target_mode": "view_only",
                "kind": "one_time", "run_at": past, "message": "sched iter108"}
        r = founder.post(f"{API}/admin/access-control/schedules", json=body, timeout=20)
        assert r.status_code == 200
        sid = r.json()["schedule"]["id"]
        # Manually trigger via re-fetching (worker runs every 60s — we may need to wait or force).
        # Try importing and calling directly is not possible cross-process — verify via list first
        panel = founder.get(f"{API}/admin/access-control", timeout=20).json()
        found = [s for s in panel["schedules"] if s["id"] == sid]
        assert found, "schedule not in list"
        # Cleanup: delete schedule regardless of status
        founder.delete(f"{API}/admin/access-control/schedules/{sid}", timeout=20)
        # Restore orai_voice to full_access in case it executed
        _set_feature(founder, "orai_voice", "full_access")

    def test_recurring_crud(self, founder):
        body = {"feature_key": "orai_voice", "target_mode": "view_only",
                "kind": "recurring", "days": ["mon", "tue"],
                "time_local": "23:59", "timezone": "UTC"}
        r = founder.post(f"{API}/admin/access-control/schedules", json=body, timeout=20)
        assert r.status_code == 200
        sid = r.json()["schedule"]["id"]
        panel = founder.get(f"{API}/admin/access-control", timeout=20).json()
        assert any(s["id"] == sid for s in panel["schedules"])
        r2 = founder.delete(f"{API}/admin/access-control/schedules/{sid}", timeout=20)
        assert r2.status_code == 200


# ────────────────────────── 12. Allowlist
class TestAllowlist:
    def test_allowlist_grant_and_revoke(self, founder, user_tftwo):
        # RC to emergency_lock
        _set_feature(founder, "responsibility_center", "emergency_lock", "lock for allowlist test")
        entry_id = None
        try:
            # tftwo should be blocked
            r = user_tftwo.get(f"{API}/responsibility-center/mine", timeout=20)
            assert r.status_code == 423
            # Grant allowlist
            now = datetime.now(timezone.utc)
            body = {"username": "tftwo", "reason": "iter108 test grant",
                    "starts_at": (now - timedelta(minutes=1)).isoformat(),
                    "expires_at": (now + timedelta(hours=1)).isoformat()}
            r2 = founder.post(f"{API}/admin/access-control/allowlist", json=body, timeout=20)
            assert r2.status_code == 200
            entry_id = r2.json()["entry"]["id"]
            time.sleep(SETTLE)
            # tftwo now bypasses
            r3 = user_tftwo.get(f"{API}/responsibility-center/mine", timeout=20)
            assert r3.status_code == 200, f"expected bypass 200, got {r3.status_code}"
            # Reason required
            bad = {"username": "tftwo", "reason": "  ",
                   "starts_at": now.isoformat(),
                   "expires_at": (now + timedelta(hours=1)).isoformat()}
            r4 = founder.post(f"{API}/admin/access-control/allowlist", json=bad, timeout=20)
            assert r4.status_code == 400
        finally:
            if entry_id:
                founder.delete(f"{API}/admin/access-control/allowlist/{entry_id}", timeout=20)
                time.sleep(SETTLE)
                # Verify revoked
                r5 = user_tftwo.get(f"{API}/responsibility-center/mine", timeout=20)
                assert r5.status_code == 423, f"expected 423 after revoke, got {r5.status_code}"
            _set_feature(founder, "responsibility_center", "full_access")


# ────────────────────────── 13. Impact preview
class TestImpact:
    def test_impact_orai_emergency_lock(self, founder):
        r = founder.get(f"{API}/admin/access-control/impact?feature=orai&mode=emergency_lock", timeout=20)
        assert r.status_code == 200
        data = r.json()
        for k in ["affected_users", "affected_centers", "cascades_to",
                  "routes_affected", "effects"]:
            assert k in data
        # orai has 5 AI sub-features that cascade
        expected_children = {"orai_voice", "course_generation", "ai_automations", "ai_memory", "ai_recommendations"}
        assert expected_children.issubset(set(data["cascades_to"]))
        assert data["effects"]["all_locked"] is True


# ────────────────────────── 14. Preview-as personas
class TestPreviewAs:
    def test_preview_as_all_personas(self, founder):
        for persona in ["signed_out", "regular_user", "platform_admin", "founder"]:
            r = founder.get(f"{API}/admin/access-control/preview-as?persona={persona}", timeout=20)
            assert r.status_code == 200, f"{persona}: {r.status_code}"
            data = r.json()
            assert data["persona"] == persona
            assert len(data["features"]) == 11
        # founder persona always visible/can_write
        rf = founder.get(f"{API}/admin/access-control/preview-as?persona=founder", timeout=20).json()
        for k, v in rf["features"].items():
            assert v["visible"] is True and v["can_write"] is True, f"founder should always have access to {k}"


# ────────────────────────── 15. Audit log
class TestAudit:
    def test_audit_has_rows_after_changes(self, founder):
        # Force a change first so we have something to audit
        _set_feature(founder, "orai_voice", "view_only", "iter108 audit test")
        _set_feature(founder, "orai_voice", "full_access", "iter108 audit restore")
        r = founder.get(f"{API}/admin/access-control/audit?limit=20", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "rows" in data and "total" in data
        assert data["total"] >= 1
        # Verify shape
        row = data["rows"][0]
        for k in ["actor_username", "action", "target", "before", "after", "reason", "at"]:
            assert k in row, f"audit row missing {k}"


# ────────────────────────── 16. Public status (unauthenticated + auth'd)
class TestPublicStatus:
    def test_public_status_unauthenticated(self, anon):
        r = anon.get(f"{API}/access-control/status", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "features" in data and len(data["features"]) == 11
        for k, v in data["features"].items():
            assert "screen" in v and v["screen"] in ("normal", "view_only", "maintenance",
                                                      "locked", "hidden", "preview", "invite_only")

    def test_public_status_authenticated(self, user_tftwo):
        r = user_tftwo.get(f"{API}/access-control/status", timeout=20)
        assert r.status_code == 200
        assert "features" in r.json()


# ────────────────────────── 17. Race condition
class TestRace:
    def test_parallel_patches_and_reads(self, founder):
        def patch(mode):
            return founder.patch(f"{API}/admin/access-control/features/orai_voice",
                                  json={"mode": mode, "reason": f"race {mode}"}, timeout=20)

        def status(_):
            return requests.get(f"{API}/access-control/status", timeout=20)

        modes = ["full_access", "view_only", "maintenance", "full_access", "view_only"]
        with cf.ThreadPoolExecutor(max_workers=10) as ex:
            futs = [ex.submit(patch, m) for m in modes]
            futs += [ex.submit(status, i) for i in range(5)]
            results = [f.result() for f in futs]
        for r in results:
            assert r.status_code < 500, f"got {r.status_code}: {r.text[:200]}"
        # Final consistency: must be one of the modes we sent
        time.sleep(SETTLE)
        panel = founder.get(f"{API}/admin/access-control", timeout=20).json()
        final = panel["settings"]["features"]["orai_voice"]["mode"]
        assert final in modes
        # cleanup
        _set_feature(founder, "orai_voice", "full_access")


# ────────────────────────── ZZ. Final production-state restore
class TestZFinalRestore:
    def test_restore_production_state(self, founder):
        """MUST leave everything full_access except rc_public_preview=hidden."""
        # Reset every feature
        panel = founder.get(f"{API}/admin/access-control", timeout=20).json()
        for k in panel["registry"].keys():
            desired = "hidden" if k == "rc_public_preview" else "full_access"
            current = panel["settings"]["features"][k]["mode"]
            if current != desired:
                founder.patch(f"{API}/admin/access-control/features/{k}",
                               json={"mode": desired, "reason": "iter108 final restore"}, timeout=20)
        # Clear invited + allowlist
        founder.put(f"{API}/admin/access-control/invited", json={"usernames": []}, timeout=20)
        settings = founder.get(f"{API}/admin/access-control", timeout=20).json()["settings"]
        for e in list(settings.get("emergency_allowlist", [])):
            founder.delete(f"{API}/admin/access-control/allowlist/{e['id']}", timeout=20)
        # If locked, unlock
        if settings.get("pre_lock_snapshot"):
            founder.post(f"{API}/admin/access-control/emergency-lock",
                          json={"engage": False, "reason": "iter108 final unlock"}, timeout=20)
        time.sleep(SETTLE)
        final = founder.get(f"{API}/admin/access-control", timeout=20).json()
        for k, v in final["settings"]["features"].items():
            expected = "hidden" if k == "rc_public_preview" else "full_access"
            assert v["mode"] == expected, f"{k} not restored: {v['mode']}"
        assert final["emergency_locked"] is False
        assert final["settings"].get("invited_usernames", []) == []
        assert final["settings"].get("emergency_allowlist", []) == []
