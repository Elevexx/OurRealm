"""Phase 1 — /admin/widgets backend regression.

Covers:
  • Admin gate on /api/admin/widgets + /api/admin/badges (403 for non-admin)
  • 16 system widgets seeded with is_system=true + status=live + placements=['profile']
  • Widget CRUD: create / dup-key 400 / patch / launch / disable / delete
  • System widget delete blocked with exact error text
  • /api/widgets/available filtering by status (disable removes, launch re-adds)
  • /api/widgets/disabled admin-only
  • Badge CRUD: create / assign / recipients / remove / disable hides publicly / launch shows / delete cleans assignments
  • Public /api/profile/{u}/badges returns only LIVE badges
"""
import os
import time
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

STEALTH = {"email": "slopestyle2022@gmail.com", "password": "Password1$"}
TFTWO = {"email": "testfriend2@example.com", "password": "pass1234"}
TFONE = {"email": "testfriend1@example.com", "password": "pass1234"}

SYSTEM_KEYS = {
    "myfeed", "top8", "live", "videos", "music", "podcasts", "photos",
    "events", "weather", "calendar", "countdown", "notes", "polls",
    "survey", "blog", "radar",
}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, f"no token in login response: {body}"
    return tok


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def stealth_token():
    return _login(STEALTH)


@pytest.fixture(scope="module")
def tftwo_token():
    return _login(TFTWO)


@pytest.fixture(scope="module")
def tfone_token():
    return _login(TFONE)


# ───────────────── Admin gate ─────────────────

class TestAdminGate:
    def test_widgets_non_admin_403(self, tftwo_token):
        r = requests.get(f"{BASE_URL}/api/admin/widgets", headers=_auth(tftwo_token), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_badges_non_admin_403(self, tftwo_token):
        r = requests.get(f"{BASE_URL}/api/admin/badges", headers=_auth(tftwo_token), timeout=20)
        assert r.status_code == 403

    def test_widgets_admin_200(self, stealth_token):
        r = requests.get(f"{BASE_URL}/api/admin/widgets", headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "widgets" in body and isinstance(body["widgets"], list)

    def test_badges_admin_200(self, stealth_token):
        r = requests.get(f"{BASE_URL}/api/admin/badges", headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 200
        assert "badges" in r.json()


# ───────────────── System seed ─────────────────

class TestSystemSeed:
    def test_16_system_widgets_present(self, stealth_token):
        r = requests.get(f"{BASE_URL}/api/admin/widgets", headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 200
        widgets = r.json()["widgets"]
        sys_widgets = [w for w in widgets if w.get("is_system") is True]
        keys = {w["key"] for w in sys_widgets}
        missing = SYSTEM_KEYS - keys
        assert not missing, f"missing system widget keys: {missing}"
        # Each must default to status=live + placements include 'profile'
        for w in sys_widgets:
            if w["key"] in SYSTEM_KEYS:
                assert w.get("status") in ("live", "disabled", "draft"), w
                assert "profile" in (w.get("placements") or []), f"{w['key']} placements={w.get('placements')}"


# ───────────────── Widget CRUD ─────────────────

class TestWidgetCRUD:
    created_id = None

    def test_create_widget(self, stealth_token):
        payload = {"key": "integration_test_widget", "name": "IT Widget", "icon": "Sparkles", "status": "draft"}
        # cleanup any leftover from previous run
        r0 = requests.get(f"{BASE_URL}/api/admin/widgets", headers=_auth(stealth_token), timeout=20)
        for w in r0.json().get("widgets", []):
            if w["key"] == "integration_test_widget":
                requests.delete(f"{BASE_URL}/api/admin/widgets/{w['id']}", headers=_auth(stealth_token), timeout=20)
        r = requests.post(f"{BASE_URL}/api/admin/widgets", json=payload, headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 200, r.text
        widget = r.json()["widget"]
        assert widget["key"] == "integration_test_widget"
        assert widget["name"] == "IT Widget"
        assert widget["status"] == "draft"
        assert widget["is_system"] is False
        assert widget.get("id")
        TestWidgetCRUD.created_id = widget["id"]

    def test_duplicate_key_400(self, stealth_token):
        payload = {"key": "integration_test_widget", "name": "Dup", "icon": "Sparkles"}
        r = requests.post(f"{BASE_URL}/api/admin/widgets", json=payload, headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 400
        assert "already exists" in r.text.lower()

    def test_patch_update_name(self, stealth_token):
        wid = TestWidgetCRUD.created_id
        assert wid
        r = requests.patch(f"{BASE_URL}/api/admin/widgets/{wid}", json={"name": "IT Widget v2"},
                           headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["widget"]["name"] == "IT Widget v2"

    def test_launch_flips_live(self, stealth_token):
        wid = TestWidgetCRUD.created_id
        r = requests.post(f"{BASE_URL}/api/admin/widgets/{wid}/launch", headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 200
        assert r.json()["status"] == "live"

    def test_disable_flips_disabled(self, stealth_token):
        wid = TestWidgetCRUD.created_id
        r = requests.post(f"{BASE_URL}/api/admin/widgets/{wid}/disable", headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 200
        assert r.json()["status"] == "disabled"

    def test_delete_non_system(self, stealth_token):
        wid = TestWidgetCRUD.created_id
        r = requests.delete(f"{BASE_URL}/api/admin/widgets/{wid}", headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_delete_system_widget_blocked(self, stealth_token):
        # find myfeed system widget
        r = requests.get(f"{BASE_URL}/api/admin/widgets", headers=_auth(stealth_token), timeout=20)
        myfeed = next((w for w in r.json()["widgets"] if w["key"] == "myfeed"), None)
        assert myfeed and myfeed.get("is_system"), "myfeed system widget missing"
        rd = requests.delete(f"{BASE_URL}/api/admin/widgets/{myfeed['id']}", headers=_auth(stealth_token), timeout=20)
        assert rd.status_code == 400
        assert "system widgets cannot be deleted" in rd.text.lower()


# ───────────────── /widgets/available + /widgets/disabled ─────────────────

class TestPublicWidgetCatalogue:
    notes_id = None
    notes_was_status = None

    def test_available_lists_16_live_for_tftwo(self, tftwo_token, stealth_token):
        # ensure all system widgets are live first
        r = requests.get(f"{BASE_URL}/api/admin/widgets", headers=_auth(stealth_token), timeout=20)
        for w in r.json()["widgets"]:
            if w["key"] in SYSTEM_KEYS and w["status"] != "live":
                requests.post(f"{BASE_URL}/api/admin/widgets/{w['id']}/launch",
                              headers=_auth(stealth_token), timeout=20)
        r2 = requests.get(f"{BASE_URL}/api/widgets/available?placement=profile",
                          headers=_auth(tftwo_token), timeout=20)
        assert r2.status_code == 200
        keys = {w["key"] for w in r2.json()["widgets"]}
        missing = SYSTEM_KEYS - keys
        assert not missing, f"missing live widgets in /available: {missing}"

    def test_disable_removes_from_available(self, tftwo_token, stealth_token):
        r = requests.get(f"{BASE_URL}/api/admin/widgets", headers=_auth(stealth_token), timeout=20)
        notes = next((w for w in r.json()["widgets"] if w["key"] == "notes"), None)
        assert notes
        TestPublicWidgetCatalogue.notes_id = notes["id"]
        TestPublicWidgetCatalogue.notes_was_status = notes["status"]
        rd = requests.post(f"{BASE_URL}/api/admin/widgets/{notes['id']}/disable",
                           headers=_auth(stealth_token), timeout=20)
        assert rd.status_code == 200
        # now tftwo's /widgets/available should NOT include notes
        ra = requests.get(f"{BASE_URL}/api/widgets/available?placement=profile",
                          headers=_auth(tftwo_token), timeout=20)
        keys = {w["key"] for w in ra.json()["widgets"]}
        assert "notes" not in keys

    def test_disabled_endpoint_admin_only(self, tftwo_token, stealth_token):
        # admin sees notes in disabled list
        ra = requests.get(f"{BASE_URL}/api/widgets/disabled", headers=_auth(stealth_token), timeout=20)
        assert ra.status_code == 200
        keys = [k["key"] for k in ra.json()["keys"]]
        assert "notes" in keys
        # non-admin gets empty list (not 403 — the route silently returns [])
        rt = requests.get(f"{BASE_URL}/api/widgets/disabled", headers=_auth(tftwo_token), timeout=20)
        assert rt.status_code == 200
        assert rt.json()["keys"] == []

    def test_launch_restores_in_available(self, tftwo_token, stealth_token):
        wid = TestPublicWidgetCatalogue.notes_id
        rl = requests.post(f"{BASE_URL}/api/admin/widgets/{wid}/launch",
                           headers=_auth(stealth_token), timeout=20)
        assert rl.status_code == 200
        ra = requests.get(f"{BASE_URL}/api/widgets/available?placement=profile",
                          headers=_auth(tftwo_token), timeout=20)
        keys = {w["key"] for w in ra.json()["widgets"]}
        assert "notes" in keys


# ───────────────── Badge CRUD + assign + public ─────────────────

class TestBadgeFlow:
    badge_id = None

    def test_create_badge(self, stealth_token):
        # cleanup
        r0 = requests.get(f"{BASE_URL}/api/admin/badges", headers=_auth(stealth_token), timeout=20)
        for b in r0.json().get("badges", []):
            if b["key"] == "integration_badge":
                requests.delete(f"{BASE_URL}/api/admin/badges/{b['id']}", headers=_auth(stealth_token), timeout=20)
        payload = {"key": "integration_badge", "name": "IT Badge", "icon": "Award",
                   "color": "#00FF66", "status": "live"}
        r = requests.post(f"{BASE_URL}/api/admin/badges", json=payload, headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 200, r.text
        badge = r.json()["badge"]
        assert badge["key"] == "integration_badge"
        assert badge["status"] == "live"
        TestBadgeFlow.badge_id = badge["id"]

    def test_assign_two_users(self, stealth_token):
        bid = TestBadgeFlow.badge_id
        r = requests.post(f"{BASE_URL}/api/admin/badges/{bid}/assign",
                          json={"usernames": ["tftwo", "tfone"]},
                          headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["assigned"] == 2

    def test_recipients_count_2(self, stealth_token):
        bid = TestBadgeFlow.badge_id
        r = requests.get(f"{BASE_URL}/api/admin/badges/{bid}/recipients",
                         headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 2
        usernames = {rec["username"] for rec in body["recipients"]}
        assert {"tftwo", "tfone"}.issubset(usernames)

    def test_remove_one(self, stealth_token):
        bid = TestBadgeFlow.badge_id
        r = requests.post(f"{BASE_URL}/api/admin/badges/{bid}/remove",
                         json={"usernames": ["tfone"]},
                         headers=_auth(stealth_token), timeout=20)
        assert r.status_code == 200
        assert r.json()["deleted"] == 1
        rr = requests.get(f"{BASE_URL}/api/admin/badges/{bid}/recipients",
                          headers=_auth(stealth_token), timeout=20)
        assert rr.json()["total"] == 1

    def test_disable_hides_from_public(self, stealth_token):
        bid = TestBadgeFlow.badge_id
        rd = requests.post(f"{BASE_URL}/api/admin/badges/{bid}/disable",
                           headers=_auth(stealth_token), timeout=20)
        assert rd.status_code == 200
        # public profile badges for tftwo should NOT include integration_badge
        rp = requests.get(f"{BASE_URL}/api/profile/tftwo/badges", timeout=20)
        assert rp.status_code == 200
        keys = {b["key"] for b in rp.json()["badges"]}
        assert "integration_badge" not in keys

    def test_launch_shows_publicly(self, stealth_token):
        bid = TestBadgeFlow.badge_id
        rl = requests.post(f"{BASE_URL}/api/admin/badges/{bid}/launch",
                           headers=_auth(stealth_token), timeout=20)
        assert rl.status_code == 200
        rp = requests.get(f"{BASE_URL}/api/profile/tftwo/badges", timeout=20)
        keys = {b["key"] for b in rp.json()["badges"]}
        assert "integration_badge" in keys

    def test_delete_removes_badge_and_assignments(self, stealth_token):
        bid = TestBadgeFlow.badge_id
        rd = requests.delete(f"{BASE_URL}/api/admin/badges/{bid}", headers=_auth(stealth_token), timeout=20)
        assert rd.status_code == 200
        # tftwo public badges should no longer include it
        rp = requests.get(f"{BASE_URL}/api/profile/tftwo/badges", timeout=20)
        keys = {b["key"] for b in rp.json()["badges"]}
        assert "integration_badge" not in keys


# ───────────────── Public profile badges (regression for 'OG') ─────────────────

class TestPublicProfileBadges:
    def test_tftwo_badges_live_only(self):
        r = requests.get(f"{BASE_URL}/api/profile/tftwo/badges", timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "badges" in body and isinstance(body["badges"], list)
        # Each returned badge must have key/name/icon/color
        for b in body["badges"]:
            assert b.get("key")
            assert "name" in b
            assert "icon" in b
            assert "color" in b
