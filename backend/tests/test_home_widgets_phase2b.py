"""Phase-2B tests — Home widgets CRUD + placement filtering + admin disable propagation.

Covers:
  - GET /api/widgets/available?placement={profile,home,realm} returns 16 system widgets
  - Home widgets CRUD (GET empty -> PATCH -> GET persisted, allow-list, cap)
  - Admin disable propagates to home + realm placements
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

STEALTH = {"email": "stealth", "password": "Password1$"}
TFTWO = {"email": "tftwo", "password": "pass1234"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def stealth_sess():
    return _login(STEALTH)


@pytest.fixture(scope="module")
def tftwo_sess():
    return _login(TFTWO)


# --- Placement filtering ---
class TestPlacementFiltering:
    def test_available_home_placement_returns_16(self, tftwo_sess):
        r = tftwo_sess.get(f"{API}/widgets/available?placement=home", timeout=20)
        assert r.status_code == 200
        widgets = r.json().get("widgets", [])
        keys = {w["key"] for w in widgets}
        assert len(widgets) >= 16, f"expected >=16, got {len(widgets)} keys={keys}"

    def test_available_realm_placement_returns_16(self, tftwo_sess):
        r = tftwo_sess.get(f"{API}/widgets/available?placement=realm", timeout=20)
        assert r.status_code == 200
        widgets = r.json().get("widgets", [])
        assert len(widgets) >= 16, f"expected >=16, got {len(widgets)}"

    def test_available_profile_placement_no_regression(self, tftwo_sess):
        r = tftwo_sess.get(f"{API}/widgets/available?placement=profile", timeout=20)
        assert r.status_code == 200
        widgets = r.json().get("widgets", [])
        assert len(widgets) >= 16


# --- Home widgets CRUD ---
class TestHomeWidgetsCRUD:
    def test_initial_get_empty(self, tftwo_sess):
        # reset first by patching empty
        tftwo_sess.patch(f"{API}/home/widgets", json={"widgets": []}, timeout=20)
        r = tftwo_sess.get(f"{API}/home/widgets", timeout=20)
        assert r.status_code == 200
        assert r.json().get("widgets") == []

    def test_patch_drops_deprecated_and_persists(self, tftwo_sess):
        payload = {"widgets": [
            {"id": "hw-1", "type": "top8", "size": "medium"},
            {"id": "hw-2", "type": "weather"},
            {"id": "hw-bad", "type": "merch"},
        ]}
        r = tftwo_sess.patch(f"{API}/home/widgets", json=payload, timeout=20)
        assert r.status_code == 200, r.text[:200]
        widgets = r.json().get("widgets", [])
        types = [w["type"] for w in widgets]
        assert "merch" not in types, f"deprecated 'merch' should be dropped, got {types}"
        assert "top8" in types
        assert "weather" in types

        # Verify persisted
        r2 = tftwo_sess.get(f"{API}/home/widgets", timeout=20)
        assert r2.status_code == 200
        types2 = [w["type"] for w in r2.json().get("widgets", [])]
        assert "top8" in types2
        assert "weather" in types2
        assert "merch" not in types2

    def test_patch_25_widgets_rejected(self, tftwo_sess):
        big = {"widgets": [
            {"id": f"hw-{i}", "type": "notes"} for i in range(25)
        ]}
        r = tftwo_sess.patch(f"{API}/home/widgets", json=big, timeout=20)
        assert r.status_code == 400
        assert "24" in r.text or "max" in r.text.lower()


# --- Admin disable propagation ---
class TestAdminDisablePropagation:
    @pytest.fixture(scope="class")
    def notes_widget_id(self, stealth_sess):
        r = stealth_sess.get(f"{API}/admin/widgets", timeout=20)
        assert r.status_code == 200, f"admin widgets list failed: {r.status_code} {r.text[:200]}"
        widgets = r.json().get("widgets") or r.json()
        if isinstance(widgets, dict):
            widgets = widgets.get("widgets", [])
        notes = next((w for w in widgets if w.get("key") == "notes"), None)
        assert notes, f"could not find notes widget in {[w.get('key') for w in widgets]}"
        return notes["id"]

    def test_disable_notes_then_check_home_realm_filtered(self, stealth_sess, tftwo_sess, notes_widget_id):
        # Disable
        r = stealth_sess.post(f"{API}/admin/widgets/{notes_widget_id}/disable", timeout=20)
        assert r.status_code in (200, 204), f"disable failed: {r.status_code} {r.text[:200]}"

        try:
            # Check home placement no longer returns notes for tftwo
            rh = tftwo_sess.get(f"{API}/widgets/available?placement=home", timeout=20)
            assert rh.status_code == 200
            keys_h = {w["key"] for w in rh.json().get("widgets", [])}
            assert "notes" not in keys_h, f"notes still present in home after disable: {keys_h}"

            # Check realm placement
            rr = tftwo_sess.get(f"{API}/widgets/available?placement=realm", timeout=20)
            assert rr.status_code == 200
            keys_r = {w["key"] for w in rr.json().get("widgets", [])}
            assert "notes" not in keys_r, f"notes still present in realm after disable: {keys_r}"
        finally:
            # Re-enable (launch)
            rl = stealth_sess.post(f"{API}/admin/widgets/{notes_widget_id}/launch", timeout=20)
            assert rl.status_code in (200, 204), f"relaunch failed: {rl.status_code} {rl.text[:200]}"

        # Verify restored
        rh2 = tftwo_sess.get(f"{API}/widgets/available?placement=home", timeout=20)
        keys_h2 = {w["key"] for w in rh2.json().get("widgets", [])}
        assert "notes" in keys_h2, "notes should be restored after launch"
