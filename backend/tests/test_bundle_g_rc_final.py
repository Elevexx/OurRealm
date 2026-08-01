"""Bundle G (Responsibility Center FINAL) backend tests.

Covers:
- Templates list + template detail
- apply-template idempotency + modes
- Dashboard widgets + widget layout persistence + version conflict
- Universal search (global + center-scoped)
- Admin Template Manager (list, create draft, publish, disable, duplicate, audit)
- Scheduled Reports (opt-in, validation, next_run_at compute, pause, delete)
- RC Moderation via POST /api/reports
"""
import os
import time
import uuid
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")

STEALTH_EMAIL = "stealth"
STEALTH_PASSWORD = "Password1$"
TFTWO_EMAIL = "tftwo"
TFTWO_PASSWORD = "pass1234"

# Center where tftwo is a member (BF Lab 9d67 has 3 members incl. tftwo per prior tests)
EXISTING_MULTI_CENTER = "bftest0e7f589d67"
# Stealth Family (2 members: stealth+tftwo)
FAMILY_CENTER = "cf5a475c04cd4860976920cda63fa6ff"
# Solo center (stealth only, no tftwo) — for non-member existence-leak test
SOLO_CENTER = "bftest5d5af11c8b"


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"], r.json()["user"]


@pytest.fixture(scope="session")
def stealth():
    tok, u = _login(STEALTH_EMAIL, STEALTH_PASSWORD)
    return {"token": tok, "user": u, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="session")
def tftwo():
    tok, u = _login(TFTWO_EMAIL, TFTWO_PASSWORD)
    return {"token": tok, "user": u, "headers": {"Authorization": f"Bearer {tok}"}}


# ─────────────────────────────────────────────────────────────────────────
# Templates: list + detail
# ─────────────────────────────────────────────────────────────────────────
class TestTemplates:
    def test_list_returns_11(self, stealth):
        r = requests.get(f"{BASE_URL}/api/responsibility-center/templates", headers=stealth["headers"], timeout=15)
        assert r.status_code == 200
        data = r.json()
        tpls = data.get("templates") if isinstance(data, dict) else data
        assert len(tpls) == 11
        keys = {t["template_key"] for t in tpls}
        for expected in ["personal", "family", "education", "business", "organization",
                         "church", "sports", "community", "volunteer", "team", "custom"]:
            assert expected in keys

    def test_family_detail_has_units_and_widgets(self, stealth):
        r = requests.get(f"{BASE_URL}/api/responsibility-center/templates/family",
                         headers=stealth["headers"], timeout=15)
        assert r.status_code == 200
        d = r.json()
        # accept either wrapping
        tpl = d.get("template", d)
        for k in ("units", "starter_items", "default_widgets", "version"):
            assert k in tpl, f"missing {k} in family template"
        assert isinstance(tpl["units"], list) and len(tpl["units"]) >= 1
        assert isinstance(tpl["default_widgets"], list) and len(tpl["default_widgets"]) >= 1
        assert tpl["version"] >= 1

    def test_unknown_template_404(self, stealth):
        r = requests.get(f"{BASE_URL}/api/responsibility-center/templates/does_not_exist",
                         headers=stealth["headers"], timeout=15)
        assert r.status_code in (404, 400)


# ─────────────────────────────────────────────────────────────────────────
# apply-template idempotency + modes  (uses ONE new center, burns 1000 FP)
# ─────────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def throwaway_center(stealth):
    """Create a new team center for destructive template-apply tests."""
    # Check balance
    w = requests.get(f"{BASE_URL}/api/fire/wallet", headers=stealth["headers"], timeout=15).json()
    bal = w["wallet"]["vault_balance"]
    if bal < 1000:
        pytest.skip(f"Stealth has {bal} FP, need >=1000 to create center")

    tok = str(uuid.uuid4())
    body = {"name": f"BG QA {uuid.uuid4().hex[:6]}", "center_type": "team",
            "description": "bundle G test", "client_token": tok}
    r = requests.post(f"{BASE_URL}/api/responsibility-center/create",
                      json=body, headers=stealth["headers"], timeout=30)
    assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text[:400]}"
    d = r.json()
    cid = d.get("center", {}).get("id") or d.get("id")
    assert cid, f"no center id in {d}"

    # confirm balance dropped
    w2 = requests.get(f"{BASE_URL}/api/fire/wallet", headers=stealth["headers"], timeout=15).json()
    assert w2["wallet"]["vault_balance"] == bal - 1000, "creation did not burn 1000 FP"

    return {"id": cid, "initial_balance": w2["wallet"]["vault_balance"]}


class TestApplyTemplate:
    def test_apply_recommended_then_idempotent(self, stealth, throwaway_center):
        cid = throwaway_center["id"]
        body = {"template_key": "family", "mode": "recommended", "application_type": "initial"}

        # first apply
        r1 = requests.post(f"{BASE_URL}/api/responsibility-center/{cid}/apply-template",
                           json=body, headers=stealth["headers"], timeout=30)
        assert r1.status_code == 200, f"apply1 failed {r1.status_code} {r1.text[:400]}"
        d1 = r1.json()
        # Should have created something
        created1 = d1.get("created", {})

        bal_before = requests.get(f"{BASE_URL}/api/fire/wallet",
                                  headers=stealth["headers"], timeout=15).json()["wallet"]["vault_balance"]

        # second apply — identical body
        r2 = requests.post(f"{BASE_URL}/api/responsibility-center/{cid}/apply-template",
                           json=body, headers=stealth["headers"], timeout=30)
        assert r2.status_code == 200, f"apply2 failed {r2.status_code} {r2.text[:400]}"
        d2 = r2.json()

        # Should indicate retried and no new items
        assert d2.get("retried") is True, f"expected retried=True on 2nd apply: {d2}"
        created2 = d2.get("created", {})
        for k, v in created2.items():
            if isinstance(v, int):
                assert v == 0, f"idempotency broken: {k}={v} on retry (all created counts must be 0)"

        # No additional FP burn on retry
        bal_after = requests.get(f"{BASE_URL}/api/fire/wallet",
                                 headers=stealth["headers"], timeout=15).json()["wallet"]["vault_balance"]
        assert bal_after == bal_before, f"FP should not change on retry: {bal_before} -> {bal_after}"

    def test_invalid_mode_returns_400(self, stealth, throwaway_center):
        cid = throwaway_center["id"]
        r = requests.post(f"{BASE_URL}/api/responsibility-center/{cid}/apply-template",
                          json={"template_key": "family", "mode": "totallybogus"},
                          headers=stealth["headers"], timeout=15)
        assert r.status_code == 400, f"expected 400 for invalid mode, got {r.status_code}: {r.text[:200]}"


# ─────────────────────────────────────────────────────────────────────────
# Dashboard widgets + layout
# ─────────────────────────────────────────────────────────────────────────
class TestWidgets:
    def test_dashboard_widgets_shape(self, stealth):
        r = requests.get(f"{BASE_URL}/api/responsibility-center/{FAMILY_CENTER}/dashboard-widgets",
                         headers=stealth["headers"], timeout=15)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ("widgets", "available_widgets", "scope", "version"):
            assert k in d, f"missing {k}: keys={list(d.keys())}"
        assert isinstance(d["widgets"], list)
        assert isinstance(d["available_widgets"], list)

    def test_save_layout_and_version_conflict(self, stealth):
        cid = FAMILY_CENTER
        current = requests.get(f"{BASE_URL}/api/responsibility-center/{cid}/dashboard-widgets",
                               headers=stealth["headers"], timeout=15).json()
        version = current.get("version", 0)
        # Build a layout from current widgets (just their keys/ids)
        layout = []
        for w in current["widgets"][:3]:
            wid = w.get("key") or w.get("id") or w.get("widget_key")
            if wid:
                layout.append({"key": wid} if "key" in w else {"id": wid})
        if not layout:
            pytest.skip("no widgets to build layout from")

        # Save with correct version
        r = requests.put(f"{BASE_URL}/api/responsibility-center/{cid}/widget-layout",
                         json={"scope": "user", "layout": layout, "expected_version": version},
                         headers=stealth["headers"], timeout=15)
        assert r.status_code == 200, f"save failed: {r.status_code} {r.text[:300]}"

        # Stale version → 409
        r2 = requests.put(f"{BASE_URL}/api/responsibility-center/{cid}/widget-layout",
                          json={"scope": "user", "layout": layout, "expected_version": version},
                          headers=stealth["headers"], timeout=15)
        assert r2.status_code == 409, f"expected 409 stale version, got {r2.status_code}: {r2.text[:200]}"

    def test_reset_layout(self, stealth):
        r = requests.delete(
            f"{BASE_URL}/api/responsibility-center/{FAMILY_CENTER}/widget-layout?scope=user",
            headers=stealth["headers"], timeout=15)
        assert r.status_code == 200, r.text[:200]

    def test_center_default_requires_edit_perm(self, tftwo):
        # tftwo is member (no edit_center) of BF Lab 9d67
        r = requests.put(
            f"{BASE_URL}/api/responsibility-center/{EXISTING_MULTI_CENTER}/widget-layout",
            json={"scope": "center_default", "layout": [], "expected_version": 0},
            headers=tftwo["headers"], timeout=15)
        assert r.status_code == 403, f"member should be 403 on center_default: {r.status_code} {r.text[:200]}"


# ─────────────────────────────────────────────────────────────────────────
# Universal search
# ─────────────────────────────────────────────────────────────────────────
class TestSearch:
    def test_short_query_returns_empty(self, stealth):
        r = requests.get(f"{BASE_URL}/api/responsibility-center/search?q=a",
                         headers=stealth["headers"], timeout=15)
        assert r.status_code == 200
        d = r.json()
        results = d.get("results", d if isinstance(d, list) else [])
        assert results == [] or results == {} or len(results) == 0

    def test_global_search_returns_results(self, stealth):
        r = requests.get(f"{BASE_URL}/api/responsibility-center/search?q=Stealth",
                         headers=stealth["headers"], timeout=15)
        assert r.status_code == 200
        d = r.json()
        # not asserting content; just structure
        assert isinstance(d, (list, dict))

    def test_center_scoped_search(self, stealth):
        r = requests.get(f"{BASE_URL}/api/responsibility-center/{FAMILY_CENTER}/search?q=test",
                         headers=stealth["headers"], timeout=15)
        assert r.status_code == 200


# ─────────────────────────────────────────────────────────────────────────
# Admin Template Manager
# ─────────────────────────────────────────────────────────────────────────
class TestAdminTemplateManager:
    def test_admin_list_11_system(self, stealth):
        r = requests.get(f"{BASE_URL}/api/admin/responsibility-center/templates/manage",
                         headers=stealth["headers"], timeout=15)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        tpls = d.get("templates") if isinstance(d, dict) else d
        # published system templates
        system_count = sum(1 for t in tpls if t.get("status") == "published" or t.get("origin") == "system")
        assert system_count >= 11, f"expected >=11 system templates, got {system_count} in {len(tpls)}"

    def test_non_admin_gets_403(self, tftwo):
        r = requests.get(f"{BASE_URL}/api/admin/responsibility-center/templates/manage",
                         headers=tftwo["headers"], timeout=15)
        assert r.status_code == 403, f"tftwo should be 403: {r.status_code} {r.text[:200]}"

    def test_create_draft_and_status_lifecycle(self, stealth):
        # Create draft (missing name)
        r_bad = requests.post(f"{BASE_URL}/api/admin/responsibility-center/templates/manage",
                              json={"center_type": "team"}, headers=stealth["headers"], timeout=15)
        assert r_bad.status_code == 400, f"missing name should 400: {r_bad.status_code}"

        # Valid draft
        key = f"qa_g_{uuid.uuid4().hex[:8]}"
        body = {"template_key": key, "name": f"QA G {key}", "center_type": "team",
                "short_description": "test",
                "units": [{"name": "Group A", "unit_type": "group"}],
                "default_widgets": ["center_status"], "starter_items": []}
        r = requests.post(f"{BASE_URL}/api/admin/responsibility-center/templates/manage",
                          json=body, headers=stealth["headers"], timeout=15)
        assert r.status_code in (200, 201), f"create draft failed: {r.status_code} {r.text[:400]}"
        created = r.json()
        tk = created.get("template_key") or created.get("template", {}).get("template_key") or key

        # unknown widget → 400
        bad_widget = dict(body, template_key=f"qa_bw_{uuid.uuid4().hex[:6]}",
                          default_widgets=["nonexistent_widget_xyz"])
        r_bw = requests.post(f"{BASE_URL}/api/admin/responsibility-center/templates/manage",
                             json=bad_widget, headers=stealth["headers"], timeout=15)
        assert r_bw.status_code == 400, f"unknown widget should 400: {r_bw.status_code} {r_bw.text[:200]}"

        # publish without change_summary → 400
        r_pub_bad = requests.post(
            f"{BASE_URL}/api/admin/responsibility-center/templates/manage/{tk}/status",
            json={"action": "publish"}, headers=stealth["headers"], timeout=15)
        assert r_pub_bad.status_code == 400, f"publish w/o change_summary should 400: {r_pub_bad.status_code}"

        # move draft → review
        r_rev = requests.post(
            f"{BASE_URL}/api/admin/responsibility-center/templates/manage/{tk}/status",
            json={"action": "review"}, headers=stealth["headers"], timeout=15)
        assert r_rev.status_code == 200, f"review action failed: {r_rev.status_code} {r_rev.text[:300]}"

        # publish with summary
        r_pub = requests.post(
            f"{BASE_URL}/api/admin/responsibility-center/templates/manage/{tk}/status",
            json={"action": "publish", "change_summary": "initial publish"},
            headers=stealth["headers"], timeout=15)
        assert r_pub.status_code == 200, f"publish failed: {r_pub.status_code} {r_pub.text[:300]}"

        # audit trail
        r_get = requests.get(
            f"{BASE_URL}/api/admin/responsibility-center/templates/manage/{tk}",
            headers=stealth["headers"], timeout=15)
        assert r_get.status_code == 200
        detail = r_get.json()
        # look for versions or audit
        assert (detail.get("versions") or detail.get("audit") or
                detail.get("template", {}).get("versions")), "no version/audit trail"

        # disable without reason → 400
        r_dis_bad = requests.post(
            f"{BASE_URL}/api/admin/responsibility-center/templates/manage/{tk}/status",
            json={"action": "disable"}, headers=stealth["headers"], timeout=15)
        assert r_dis_bad.status_code == 400

        # disable with reason
        r_dis = requests.post(
            f"{BASE_URL}/api/admin/responsibility-center/templates/manage/{tk}/status",
            json={"action": "disable", "reason": "QA cleanup"},
            headers=stealth["headers"], timeout=15)
        assert r_dis.status_code == 200

    def test_duplicate_system_template(self, stealth):
        r = requests.post(
            f"{BASE_URL}/api/admin/responsibility-center/templates/manage/family/duplicate",
            headers=stealth["headers"], timeout=15)
        assert r.status_code in (200, 201), f"duplicate failed: {r.status_code} {r.text[:300]}"
        d = r.json()
        new_key = d.get("template_key") or d.get("template", {}).get("template_key")
        assert new_key and new_key != "family"


# ─────────────────────────────────────────────────────────────────────────
# Scheduled reports
# ─────────────────────────────────────────────────────────────────────────
class TestScheduledReports:
    def test_create_off_by_default(self, stealth):
        cid = FAMILY_CENTER
        body = {"report_key": "work_summary", "frequency": "weekly",
                "day_of_week": 2, "send_hour": 9,
                "timezone": "America/New_York", "format": "csv",
                "recipient_ids": [stealth["user"]["id"]]}
        r = requests.post(f"{BASE_URL}/api/responsibility-center/{cid}/scheduled-reports",
                          json=body, headers=stealth["headers"], timeout=15)
        assert r.status_code in (200, 201), f"create schedule failed: {r.status_code} {r.text[:400]}"
        d = r.json()
        sched = d.get("schedule", d)
        sid = sched.get("id")
        assert sid
        assert sched.get("enabled") in (False, None), f"should be enabled=false, got {sched.get('enabled')}"
        assert sched.get("next_run_at") in (None, ""), f"next_run_at should be null: {sched.get('next_run_at')}"

        # Enable → next_run_at populated
        r2 = requests.patch(
            f"{BASE_URL}/api/responsibility-center/{cid}/scheduled-reports/{sid}",
            json={"enabled": True}, headers=stealth["headers"], timeout=15)
        assert r2.status_code == 200, r2.text[:300]
        # Re-GET the schedule list to inspect state
        lst = requests.get(
            f"{BASE_URL}/api/responsibility-center/{cid}/scheduled-reports",
            headers=stealth["headers"], timeout=15).json()
        schedules = lst.get("schedules", lst if isinstance(lst, list) else [])
        s2 = next((s for s in schedules if s.get("id") == sid), None)
        assert s2, f"schedule not found after enable: {schedules}"
        assert s2.get("enabled") is True
        nra = s2.get("next_run_at")
        assert nra, f"next_run_at should compute when enabled: {s2}"
        # future
        try:
            dt = datetime.fromisoformat(nra.replace("Z", "+00:00"))
            assert dt > datetime.now(timezone.utc)
        except Exception as e:
            pytest.fail(f"invalid next_run_at {nra}: {e}")

        # Pause → next_run_at cleared
        r3 = requests.patch(
            f"{BASE_URL}/api/responsibility-center/{cid}/scheduled-reports/{sid}",
            json={"enabled": False}, headers=stealth["headers"], timeout=15)
        assert r3.status_code == 200
        lst3 = requests.get(
            f"{BASE_URL}/api/responsibility-center/{cid}/scheduled-reports",
            headers=stealth["headers"], timeout=15).json()
        schedules3 = lst3.get("schedules", lst3 if isinstance(lst3, list) else [])
        s3 = next((s for s in schedules3 if s.get("id") == sid), None)
        assert s3 and s3.get("next_run_at") in (None, ""), f"next_run_at not cleared: {s3}"

        # Delete
        r4 = requests.patch(
            f"{BASE_URL}/api/responsibility-center/{cid}/scheduled-reports/{sid}",
            json={"delete": True}, headers=stealth["headers"], timeout=15)
        assert r4.status_code in (200, 204)

    def test_invalid_timezone_400(self, stealth):
        r = requests.post(f"{BASE_URL}/api/responsibility-center/{FAMILY_CENTER}/scheduled-reports",
                          json={"report_key": "work_summary", "frequency": "weekly",
                                "day_of_week": 2, "send_hour": 9,
                                "timezone": "Not/A_Zone", "format": "csv",
                                "recipient_ids": [stealth["user"]["id"]]},
                          headers=stealth["headers"], timeout=15)
        assert r.status_code == 400, f"expected 400: {r.status_code} {r.text[:200]}"

    def test_invalid_frequency_400(self, stealth):
        r = requests.post(f"{BASE_URL}/api/responsibility-center/{FAMILY_CENTER}/scheduled-reports",
                          json={"report_key": "work_summary", "frequency": "quarterly",
                                "day_of_week": 2, "send_hour": 9,
                                "timezone": "UTC", "format": "csv",
                                "recipient_ids": [stealth["user"]["id"]]},
                          headers=stealth["headers"], timeout=15)
        assert r.status_code == 400, f"expected 400 for quarterly: {r.status_code} {r.text[:200]}"


# ─────────────────────────────────────────────────────────────────────────
# RC Moderation
# ─────────────────────────────────────────────────────────────────────────
class TestRcModeration:
    def test_report_rc_center_as_member(self, tftwo):
        # tftwo is member of BF Lab 9d67
        r = requests.post(f"{BASE_URL}/api/reports",
                          json={"content_type": "rc_center", "content_id": EXISTING_MULTI_CENTER,
                                "reason": "spam", "details": "QA test"},
                          headers=tftwo["headers"], timeout=15)
        assert r.status_code in (200, 201), f"member report failed: {r.status_code} {r.text[:300]}"

    def test_report_rc_center_nonmember_404(self, tftwo):
        # tftwo is NOT a member of SOLO_CENTER (stealth-only)
        # Verify no existence-leak
        r = requests.post(f"{BASE_URL}/api/reports",
                          json={"content_type": "rc_center", "content_id": SOLO_CENTER,
                                "reason": "spam"},
                          headers=tftwo["headers"], timeout=15)
        # Accept 404 or 403 (no existence leak)
        assert r.status_code in (403, 404), f"non-member should 403/404: {r.status_code} {r.text[:300]}"

    def test_admin_moderation_filter_rc(self, stealth):
        r = requests.get(f"{BASE_URL}/api/admin/moderation/reports?content_group=rc",
                         headers=stealth["headers"], timeout=15)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        reports = d.get("reports", d if isinstance(d, list) else [])
        for rep in reports:
            ct = rep.get("content_type", "")
            assert ct.startswith("rc_"), f"non-rc report leaked: {ct}"

    def test_admin_moderation_filter_core(self, stealth):
        r = requests.get(f"{BASE_URL}/api/admin/moderation/reports?content_group=core",
                         headers=stealth["headers"], timeout=15)
        assert r.status_code == 200
        d = r.json()
        reports = d.get("reports", d if isinstance(d, list) else [])
        for rep in reports:
            ct = rep.get("content_type", "")
            assert not ct.startswith("rc_"), f"rc report leaked into core: {ct}"
