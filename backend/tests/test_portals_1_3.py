"""Portals 1.3 backend tests — /api/admin/portals/* persistence layer.

Covers:
  * Anon 401 on every route
  * Non-admin 403
  * Founder happy-path CRUD lifecycle (notes/status/toggle/platform/
    asset-scrolls/unity/ar-vr/roadmap/performance)
  * Unknown realm → 404
  * DELETE reset
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
# Frontend .env is what user hits; backend runs same host under /api.
if not BASE_URL:
    BASE_URL = "https://realm-deploy.preview.emergentagent.com"

REALM = "rainforest"
ADMIN_ROOT = f"{BASE_URL}/api/admin/portals"


# ── fixtures ───────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def anon():
    return requests.Session()


@pytest.fixture(scope="module")
def founder_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "stealth", "password": "Password1$"},
        timeout=15,
    )
    assert r.status_code == 200, f"founder login failed: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, f"no access_token in response: {body}"
    return tok


@pytest.fixture(scope="module")
def founder(founder_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {founder_token}"})
    return s


@pytest.fixture(scope="module")
def member_token():
    # Try tfone first, fall back to tftwo.
    for uname in ("tfone", "tftwo"):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": uname, "password": "pass1234"},
            timeout=15,
        )
        if r.status_code == 200:
            return r.json().get("access_token") or r.json().get("token")
    # Register a throwaway member if seeds aren't present.
    import uuid
    uname = f"qe13_{uuid.uuid4().hex[:8]}"
    reg = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={
            "username": uname,
            "email": f"{uname}@example.com",
            "password": "Password1$",
        },
        timeout=15,
    )
    if reg.status_code in (200, 201):
        body = reg.json()
        tok = body.get("access_token") or body.get("token")
        if tok:
            return tok
    # Some register endpoints don't return a token — login after register.
    r2 = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": uname, "password": "Password1$"},
        timeout=15,
    )
    if r2.status_code == 200:
        return r2.json().get("access_token") or r2.json().get("token")
    pytest.skip("could not obtain a non-admin token")


@pytest.fixture(scope="module")
def member(member_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {member_token}"})
    return s


@pytest.fixture(scope="module", autouse=True)
def _reset_before_and_after(founder):
    # reset before
    founder.delete(f"{ADMIN_ROOT}/{REALM}/override", timeout=15)
    yield
    # reset after
    founder.delete(f"{ADMIN_ROOT}/{REALM}/override", timeout=15)


# ── SECURITY: anon 401 ─────────────────────────────────────────────
class TestAnon401:
    def test_get_overrides_anon(self, anon):
        r = anon.get(f"{ADMIN_ROOT}/overrides", timeout=15)
        assert r.status_code == 401, r.text

    def test_get_single_override_anon(self, anon):
        r = anon.get(f"{ADMIN_ROOT}/{REALM}/override", timeout=15)
        assert r.status_code == 401, r.text

    def test_notes_anon(self, anon):
        r = anon.post(f"{ADMIN_ROOT}/{REALM}/notes", json={"notes": "x"}, timeout=15)
        assert r.status_code == 401, r.text

    def test_status_anon(self, anon):
        r = anon.post(f"{ADMIN_ROOT}/{REALM}/status", json={"status": "draft"}, timeout=15)
        assert r.status_code == 401, r.text

    def test_toggle_anon(self, anon):
        r = anon.post(f"{ADMIN_ROOT}/{REALM}/toggle", json={"enabled": True}, timeout=15)
        assert r.status_code == 401, r.text

    def test_platform_readiness_anon(self, anon):
        r = anon.post(
            f"{ADMIN_ROOT}/{REALM}/platform-readiness",
            json={"platform": "ios_arkit", "entry": {"supported": True}},
            timeout=15,
        )
        assert r.status_code == 401, r.text

    def test_asset_scrolls_anon(self, anon):
        r = anon.post(f"{ADMIN_ROOT}/{REALM}/asset-scrolls",
                      json={"asset_scrolls": []}, timeout=15)
        assert r.status_code == 401, r.text

    def test_unity_deployment_anon(self, anon):
        r = anon.post(f"{ADMIN_ROOT}/{REALM}/unity-deployment",
                      json={"unity_project_name": "x"}, timeout=15)
        assert r.status_code == 401, r.text

    def test_ar_vr_compatibility_anon(self, anon):
        r = anon.post(f"{ADMIN_ROOT}/{REALM}/ar-vr-compatibility",
                      json={"ar_supported": True}, timeout=15)
        assert r.status_code == 401, r.text

    def test_roadmap_notes_anon(self, anon):
        r = anon.post(f"{ADMIN_ROOT}/{REALM}/roadmap-notes",
                      json={"value": "x"}, timeout=15)
        assert r.status_code == 401, r.text

    def test_performance_notes_anon(self, anon):
        r = anon.post(f"{ADMIN_ROOT}/{REALM}/performance-notes",
                      json={"value": "x"}, timeout=15)
        assert r.status_code == 401, r.text

    def test_delete_anon(self, anon):
        r = anon.delete(f"{ADMIN_ROOT}/{REALM}/override", timeout=15)
        assert r.status_code == 401, r.text


# ── SECURITY: non-admin 403 ────────────────────────────────────────
class TestNonAdmin403:
    def test_overrides_403(self, member):
        r = member.get(f"{ADMIN_ROOT}/overrides", timeout=15)
        assert r.status_code == 403, r.text

    def test_notes_403(self, member):
        r = member.post(f"{ADMIN_ROOT}/{REALM}/notes",
                        json={"notes": "x"}, timeout=15)
        assert r.status_code == 403, r.text

    def test_delete_403(self, member):
        r = member.delete(f"{ADMIN_ROOT}/{REALM}/override", timeout=15)
        assert r.status_code == 403, r.text


# ── UNKNOWN REALM 404 ──────────────────────────────────────────────
class TestUnknownRealm:
    def test_unknown_notes_404(self, founder):
        r = founder.post(f"{ADMIN_ROOT}/badrealm/notes",
                         json={"notes": "x"}, timeout=15)
        assert r.status_code == 404, r.text

    def test_unknown_get_404(self, founder):
        r = founder.get(f"{ADMIN_ROOT}/badrealm/override", timeout=15)
        assert r.status_code == 404, r.text


# ── FOUNDER HAPPY PATH ─────────────────────────────────────────────
class TestFounderLifecycle:
    def test_00_reset(self, founder):
        r = founder.delete(f"{ADMIN_ROOT}/{REALM}/override", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        # deleted may be True or False depending on state — both ok
        assert "deleted" in body
        g = founder.get(f"{ADMIN_ROOT}/{REALM}/override", timeout=15)
        assert g.status_code == 200
        assert g.json()["override"] is None

    def test_01_notes(self, founder):
        r = founder.post(f"{ADMIN_ROOT}/{REALM}/notes",
                         json={"notes": "test"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        ovr = body["override"]
        assert ovr["notes"] == "test"
        assert len(ovr["audit_history"]) == 1
        assert ovr["audit_history"][0]["field"] == "notes"
        assert ovr["audit_history"][0]["by_username"] == "stealth"

    def test_02_status_valid(self, founder):
        r = founder.post(f"{ADMIN_ROOT}/{REALM}/status",
                         json={"status": "private_beta"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["override"]["status"] == "private_beta"

    def test_02_status_invalid(self, founder):
        r = founder.post(f"{ADMIN_ROOT}/{REALM}/status",
                         json={"status": "nonsense"}, timeout=15)
        assert r.status_code == 422, r.text

    def test_03_toggle_off(self, founder):
        r = founder.post(f"{ADMIN_ROOT}/{REALM}/toggle",
                         json={"enabled": False}, timeout=15)
        assert r.status_code == 200, r.text
        ovr = r.json()["override"]
        assert ovr["enabled"] is False
        assert ovr["status"] == "disabled"

    def test_04_toggle_on(self, founder):
        r = founder.post(f"{ADMIN_ROOT}/{REALM}/toggle",
                         json={"enabled": True}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["override"]["enabled"] is True

    def test_05_platform_ios_valid(self, founder):
        r = founder.post(
            f"{ADMIN_ROOT}/{REALM}/platform-readiness",
            json={
                "platform": "ios_arkit",
                "entry": {
                    "supported": True,
                    "status": "testing",
                    "minimum_device_requirements": "iPhone 12 Pro",
                },
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        ovr = r.json()["override"]
        pr = ovr["platform_readiness"]["ios_arkit"]
        assert pr["supported"] is True
        assert pr["minimum_device_requirements"] == "iPhone 12 Pro"

    def test_05_platform_invalid(self, founder):
        r = founder.post(
            f"{ADMIN_ROOT}/{REALM}/platform-readiness",
            json={"platform": "foo", "entry": {"supported": True}},
            timeout=15,
        )
        assert r.status_code == 422, r.text

    def test_06_asset_scrolls(self, founder):
        r = founder.post(
            f"{ADMIN_ROOT}/{REALM}/asset-scrolls",
            json={"asset_scrolls": [{"asset_scroll_id": "tree_001", "name": "Kapok"}]},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assets = r.json()["override"]["asset_scrolls"]
        assert len(assets) == 1
        assert assets[0]["asset_scroll_id"] == "tree_001"
        assert assets[0]["name"] == "Kapok"

    def test_07_unity_deployment(self, founder):
        r = founder.post(
            f"{ADMIN_ROOT}/{REALM}/unity-deployment",
            json={"unity_project_name": "RainforestVR", "unity_scene_name": "Master"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        ud = r.json()["override"]["unity_deployment"]
        assert ud["unity_project_name"] == "RainforestVR"
        assert ud["unity_scene_name"] == "Master"

    def test_08_ar_vr_compat(self, founder):
        r = founder.post(
            f"{ADMIN_ROOT}/{REALM}/ar-vr-compatibility",
            json={"ar_supported": True, "minimum_ios_version": "17"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        c = r.json()["override"]["ar_vr_compatibility"]
        assert c["ar_supported"] is True
        assert c["minimum_ios_version"] == "17"

    def test_09_roadmap(self, founder):
        r = founder.post(
            f"{ADMIN_ROOT}/{REALM}/roadmap-notes",
            json={"value": "Portals 1.4 aquarium"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["override"]["roadmap_notes"] == "Portals 1.4 aquarium"

    def test_10_performance(self, founder):
        r = founder.post(
            f"{ADMIN_ROOT}/{REALM}/performance-notes",
            json={"value": "LOD budget 30k"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["override"]["performance_notes"] == "LOD budget 30k"

    def test_11_full_get_all_fields_persisted(self, founder):
        r = founder.get(f"{ADMIN_ROOT}/{REALM}/override", timeout=15)
        assert r.status_code == 200
        ovr = r.json()["override"]
        assert ovr is not None
        assert ovr["realm_id"] == "rainforest"
        assert ovr["notes"] == "test"
        # NOTE: toggle-off (step test_03) overwrites status='disabled' by
        # design in admin_portals.py; toggle-on (test_04) does NOT restore
        # the prior status. So the last persisted status is 'disabled'.
        assert ovr["status"] == "disabled"
        assert ovr["enabled"] is True
        assert ovr["platform_readiness"]["ios_arkit"]["supported"] is True
        assert ovr["asset_scrolls"][0]["asset_scroll_id"] == "tree_001"
        assert ovr["unity_deployment"]["unity_project_name"] == "RainforestVR"
        assert ovr["ar_vr_compatibility"]["ar_supported"] is True
        assert ovr["roadmap_notes"] == "Portals 1.4 aquarium"
        assert ovr["performance_notes"] == "LOD budget 30k"
        assert len(ovr["audit_history"]) >= 10

    def test_12_overrides_list_contains_realm(self, founder):
        r = founder.get(f"{ADMIN_ROOT}/overrides", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["count"] >= 1
        ids = [o.get("realm_id") for o in body["overrides"]]
        assert REALM in ids

    def test_13_delete_and_get_null(self, founder):
        r = founder.delete(f"{ADMIN_ROOT}/{REALM}/override", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["deleted"] is True
        g = founder.get(f"{ADMIN_ROOT}/{REALM}/override", timeout=15)
        assert g.status_code == 200
        assert g.json()["override"] is None
