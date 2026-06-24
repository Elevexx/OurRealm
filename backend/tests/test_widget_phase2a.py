"""Phase 2A — Custom Widget Builder backend regression.

Covers:
  • Schema, templates listing for @stealth
  • from-template create as @stealth → 200; as @support → 403
  • Direct create / clone as @support → 403
  • PATCH gating: content fields → 403 for @support; non-content (sort_order,
    status, access_groups) → 200
  • Versioning: PATCH snapshots into versions[], version increments,
    GET /versions returns rows, rollback restores
  • /api/widgets/registry/{key}: 200 for live, 404 for draft/disabled
  • Invalid editor_config (bad layout, unknown field type, dup keys) → 400
  • /api/widgets/available?placement=profile still works for tftwo
"""
import os
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

STEALTH = {"email": "slopestyle2022@gmail.com", "password": "Password1$"}
SUPPORT = {"email": "support", "password": "Password1$"}
TFTWO = {"email": "testfriend2@example.com", "password": "pass1234"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok
    return tok


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def stealth_tok():
    return _login(STEALTH)


@pytest.fixture(scope="module")
def support_tok():
    return _login(SUPPORT)


@pytest.fixture(scope="module")
def tftwo_tok():
    return _login(TFTWO)


# Module-level helper to generate unique keys per run
RUN_TAG = uuid.uuid4().hex[:6]
CREATED_IDS = []


@pytest.fixture(scope="module", autouse=True)
def cleanup(stealth_tok):
    """Teardown — delete all widget rows created by this test module."""
    yield
    for wid in CREATED_IDS:
        try:
            requests.delete(f"{BASE_URL}/api/admin/widgets/{wid}",
                            headers=_auth(stealth_tok), timeout=10)
        except Exception:
            pass


# ────────────────── Schema + templates ──────────────────

class TestSchemaAndTemplates:
    def test_schema_payload(self, stealth_tok):
        r = requests.get(f"{BASE_URL}/api/admin/widgets/schema",
                         headers=_auth(stealth_tok), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["layouts"]) == 7
        layout_keys = {l["key"] for l in body["layouts"]}
        assert layout_keys == {"card", "list", "grid", "media_grid", "poll", "stat", "embed"}
        assert len(body["field_types"]) == 14
        assert len(body["category_groups"]) == 7

    def test_templates_list_10(self, stealth_tok):
        r = requests.get(f"{BASE_URL}/api/admin/widgets/templates",
                         headers=_auth(stealth_tok), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["templates"]) == 10
        keys = {t["key"] for t in body["templates"]}
        expected = {"countdown", "poll", "link_hub", "faq", "gallery", "leaderboard",
                    "donation_goal", "event_card", "announcement", "achievement_showcase"}
        assert keys == expected


# ────────────────── @stealth-only create / clone / rollback gate ──────────────────

class TestStealthGate:
    widget_id = None
    widget_key = None

    def test_from_template_stealth_200(self, stealth_tok):
        key = f"phase2a_countdown_{RUN_TAG}"
        r = requests.post(
            f"{BASE_URL}/api/admin/widgets/from-template/countdown",
            json={"key": key, "name": "Test Countdown"},
            headers=_auth(stealth_tok), timeout=20,
        )
        assert r.status_code == 200, r.text
        w = r.json()["widget"]
        assert w["editor_config"]["layout"] == "stat"
        assert w["is_system"] is False
        assert w["status"] == "draft"
        TestStealthGate.widget_id = w["id"]
        TestStealthGate.widget_key = w["key"]
        CREATED_IDS.append(w["id"])

    def test_from_template_support_403(self, support_tok):
        key = f"phase2a_blocked_{RUN_TAG}"
        r = requests.post(
            f"{BASE_URL}/api/admin/widgets/from-template/countdown",
            json={"key": key, "name": "Blocked"},
            headers=_auth(support_tok), timeout=20,
        )
        assert r.status_code == 403, r.text
        assert "founder" in r.text.lower()

    def test_direct_create_support_403(self, support_tok):
        r = requests.post(
            f"{BASE_URL}/api/admin/widgets",
            json={"key": f"phase2a_direct_{RUN_TAG}", "name": "Blocked Direct"},
            headers=_auth(support_tok), timeout=20,
        )
        assert r.status_code == 403, r.text

    def test_clone_support_403(self, support_tok):
        assert TestStealthGate.widget_id
        r = requests.post(
            f"{BASE_URL}/api/admin/widgets/{TestStealthGate.widget_id}/clone",
            json={"key": f"phase2a_clonexx_{RUN_TAG}"},
            headers=_auth(support_tok), timeout=20,
        )
        assert r.status_code == 403, r.text


# ────────────────── PATCH gating for non-stealth admin ──────────────────

class TestPatchGate:
    def test_support_patch_name_403(self, support_tok):
        wid = TestStealthGate.widget_id
        r = requests.patch(
            f"{BASE_URL}/api/admin/widgets/{wid}",
            json={"name": "hacked"},
            headers=_auth(support_tok), timeout=20,
        )
        assert r.status_code == 403, r.text
        assert "founder" in r.text.lower()

    def test_support_patch_sort_order_200(self, support_tok):
        wid = TestStealthGate.widget_id
        r = requests.patch(
            f"{BASE_URL}/api/admin/widgets/{wid}",
            json={"sort_order": 99},
            headers=_auth(support_tok), timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["widget"]["sort_order"] == 99

    def test_support_patch_status_200_and_launch_disable(self, support_tok):
        wid = TestStealthGate.widget_id
        r = requests.patch(
            f"{BASE_URL}/api/admin/widgets/{wid}",
            json={"status": "live"},
            headers=_auth(support_tok), timeout=20,
        )
        assert r.status_code == 200, r.text
        # then launch + disable
        rl = requests.post(f"{BASE_URL}/api/admin/widgets/{wid}/launch",
                           headers=_auth(support_tok), timeout=20)
        assert rl.status_code == 200
        rd = requests.post(f"{BASE_URL}/api/admin/widgets/{wid}/disable",
                           headers=_auth(support_tok), timeout=20)
        assert rd.status_code == 200


# ────────────────── Versioning + rollback ──────────────────

class TestVersioning:
    def test_patch_snapshots_version(self, stealth_tok):
        wid = TestStealthGate.widget_id
        # fetch current version
        rg = requests.get(f"{BASE_URL}/api/admin/widgets",
                          headers=_auth(stealth_tok), timeout=20)
        cur = next(w for w in rg.json()["widgets"] if w["id"] == wid)
        v_before = cur.get("version") or 1
        old_name = cur.get("name")

        # PATCH name + editor_config → snapshot
        new_cfg = dict(cur["editor_config"])
        new_cfg["data"] = dict(new_cfg.get("data") or {})
        new_cfg["data"]["label"] = "New Label v2"
        r = requests.patch(
            f"{BASE_URL}/api/admin/widgets/{wid}",
            json={"name": "Counter v2", "editor_config": new_cfg},
            headers=_auth(stealth_tok), timeout=20,
        )
        assert r.status_code == 200, r.text
        updated = r.json()["widget"]
        assert updated["version"] == v_before + 1
        assert updated["name"] == "Counter v2"

        # versions endpoint shows the snapshot
        rv = requests.get(f"{BASE_URL}/api/admin/widgets/{wid}/versions",
                          headers=_auth(stealth_tok), timeout=20)
        assert rv.status_code == 200
        body = rv.json()
        assert body["current_version"] == v_before + 1
        assert len(body["versions"]) >= 1
        # snapshot should hold the OLD name
        assert body["versions"][0]["name"] == old_name

    def test_rollback_restores_snapshot(self, stealth_tok):
        wid = TestStealthGate.widget_id
        rv = requests.get(f"{BASE_URL}/api/admin/widgets/{wid}/versions",
                          headers=_auth(stealth_tok), timeout=20)
        target_version = rv.json()["versions"][0]["version"]
        target_name = rv.json()["versions"][0]["name"]

        rr = requests.post(
            f"{BASE_URL}/api/admin/widgets/{wid}/rollback/{target_version}",
            headers=_auth(stealth_tok), timeout=20,
        )
        assert rr.status_code == 200, rr.text
        rolled = rr.json()["widget"]
        assert rolled["name"] == target_name
        # rollback creates a new version row so it is reversible
        rv2 = requests.get(f"{BASE_URL}/api/admin/widgets/{wid}/versions",
                           headers=_auth(stealth_tok), timeout=20)
        assert len(rv2.json()["versions"]) >= 2


# ────────────────── registry/{key} live-only ──────────────────

class TestRegistryRead:
    def test_draft_returns_404(self, stealth_tok):
        # create a fresh draft just for this
        key = f"phase2a_draft_{RUN_TAG}"
        r = requests.post(
            f"{BASE_URL}/api/admin/widgets/from-template/poll",
            json={"key": key, "name": "Draft Poll"},
            headers=_auth(stealth_tok), timeout=20,
        )
        assert r.status_code == 200
        wid = r.json()["widget"]["id"]
        CREATED_IDS.append(wid)
        rg = requests.get(f"{BASE_URL}/api/widgets/registry/{key}", timeout=20)
        assert rg.status_code == 404

        # now launch and re-check → 200
        rl = requests.post(f"{BASE_URL}/api/admin/widgets/{wid}/launch",
                           headers=_auth(stealth_tok), timeout=20)
        assert rl.status_code == 200
        rg2 = requests.get(f"{BASE_URL}/api/widgets/registry/{key}", timeout=20)
        assert rg2.status_code == 200
        body = rg2.json()["widget"]
        assert body["editor_config"]["layout"] == "poll"

        # disable → 404 again
        rd = requests.post(f"{BASE_URL}/api/admin/widgets/{wid}/disable",
                           headers=_auth(stealth_tok), timeout=20)
        assert rd.status_code == 200
        rg3 = requests.get(f"{BASE_URL}/api/widgets/registry/{key}", timeout=20)
        assert rg3.status_code == 404


# ────────────────── editor_config validation ──────────────────

class TestEditorConfigValidation:
    def test_bad_layout_400(self, stealth_tok):
        payload = {
            "key": f"phase2a_badlayout_{RUN_TAG}",
            "name": "Bad",
            "editor_config": {"layout": "not_a_layout", "fields": []},
        }
        r = requests.post(f"{BASE_URL}/api/admin/widgets",
                          json=payload, headers=_auth(stealth_tok), timeout=20)
        assert r.status_code == 400, r.text

    def test_unknown_field_type_400(self, stealth_tok):
        payload = {
            "key": f"phase2a_badftype_{RUN_TAG}",
            "name": "Bad",
            "editor_config": {
                "layout": "card",
                "fields": [{"key": "x", "type": "unknown"}],
            },
        }
        r = requests.post(f"{BASE_URL}/api/admin/widgets",
                          json=payload, headers=_auth(stealth_tok), timeout=20)
        assert r.status_code == 400, r.text

    def test_dup_field_keys_400(self, stealth_tok):
        payload = {
            "key": f"phase2a_dupkeys_{RUN_TAG}",
            "name": "Bad",
            "editor_config": {
                "layout": "card",
                "fields": [
                    {"key": "title", "type": "text"},
                    {"key": "title", "type": "text"},
                ],
            },
        }
        r = requests.post(f"{BASE_URL}/api/admin/widgets",
                          json=payload, headers=_auth(stealth_tok), timeout=20)
        assert r.status_code == 400, r.text


# ────────────────── Regression: /widgets/available ──────────────────

class TestPublicAvailableRegression:
    def test_available_profile_for_tftwo(self, tftwo_tok):
        r = requests.get(f"{BASE_URL}/api/widgets/available?placement=profile",
                         headers=_auth(tftwo_tok), timeout=20)
        assert r.status_code == 200
        keys = {w["key"] for w in r.json()["widgets"]}
        # at least these system widgets must remain visible
        for k in ("myfeed", "top8", "videos", "music", "notes", "blog", "polls"):
            assert k in keys, f"system widget {k} missing"
