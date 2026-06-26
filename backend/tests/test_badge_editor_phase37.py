"""
Phase 3.7 — Badge editor unlock + VIP outline color fix.

Verifies the backend pipeline:
- PATCH /admin/badges/:id accepts nullable color fields
- Founder can edit locked badges (FOUNDER), non-founders cannot
- Empty string normalises to null
- Seed does not overwrite admin edits on restart
- /api/profile/<u>/badges reflects saved colors
"""
import os
import time
import pytest
import requests
import subprocess

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

FOUNDER_ID = "100c6158-a7ca-49c5-ad19-f42e95336c74"
VIP_ID = "777f0add-7124-474e-8aac-17f4844bc70c"
VERIFIED_ID = "f1c0b7a6-66f5-4c46-9e35-f10df0002818"


@pytest.fixture(scope="module")
def stealth_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "stealth", "password": "Password1$"})
    assert r.status_code == 200, r.text
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def support_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "support", "password": "Password1$"})
    if r.status_code != 200:
        pytest.skip("support admin not seeded")
    return r.json().get("access_token") or r.json().get("token")


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _get_badge(tok, badge_id):
    r = requests.get(f"{BASE_URL}/api/admin/badges", headers=_hdr(tok))
    assert r.status_code == 200
    for b in r.json()["badges"]:
        if b["id"] == badge_id:
            return b
    return None


def _profile_badge(username, key):
    r = requests.get(f"{BASE_URL}/api/profile/{username}/badges")
    assert r.status_code == 200, r.text
    data = r.json()
    items = data.get("badges") if isinstance(data, dict) else data
    for b in items:
        if b.get("key") == key:
            return b
    return None


# --- 1. VIP border color round-trip + profile render ----------------------
class TestVipBorderRoundTrip:
    def test_patch_vip_border_orange(self, stealth_token):
        r = requests.patch(f"{BASE_URL}/api/admin/badges/{VIP_ID}",
                           headers=_hdr(stealth_token),
                           json={"border_color": "#FF8800"})
        assert r.status_code == 200, r.text
        assert r.json()["badge"]["border_color"] == "#FF8800"

    def test_profile_reflects_orange_border(self, stealth_token):
        b = _profile_badge("stealth", "vip")
        assert b is not None, "VIP not present on stealth profile"
        assert b["border_color"] == "#FF8800"

    def test_persists_across_backend_restart(self, stealth_token):
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                       check=False, capture_output=True)
        time.sleep(5)
        # wait for backend healthy
        for _ in range(15):
            try:
                if requests.get(f"{BASE_URL}/api/admin/badges",
                                headers=_hdr(stealth_token),
                                timeout=3).status_code == 200:
                    break
            except Exception:
                time.sleep(1)
        b = _get_badge(stealth_token, VIP_ID)
        assert b["border_color"] == "#FF8800", \
            f"Seed overwrote admin edit! got {b['border_color']}"

    def test_empty_string_normalises_to_null(self, stealth_token):
        r = requests.patch(f"{BASE_URL}/api/admin/badges/{VIP_ID}",
                           headers=_hdr(stealth_token),
                           json={"border_color": ""})
        assert r.status_code == 200, r.text
        assert r.json()["badge"]["border_color"] is None

    def test_profile_falls_back_to_color_when_null(self, stealth_token):
        b = _profile_badge("stealth", "vip")
        assert b["border_color"] is None
        # Renderer fallback chain: border = b.border_color || (b.color || '#00FF66')
        assert b["color"] == "#00FF66"

    def test_restore_vip_border(self, stealth_token):
        r = requests.patch(f"{BASE_URL}/api/admin/badges/{VIP_ID}",
                           headers=_hdr(stealth_token),
                           json={"border_color": "#00FF66"})
        assert r.status_code == 200
        assert r.json()["badge"]["border_color"] == "#00FF66"


# --- 2. Founder locked-edit: stealth can, others cannot -------------------
class TestFounderLockedEdit:
    def test_stealth_can_edit_locked_founder(self, stealth_token):
        r = requests.patch(f"{BASE_URL}/api/admin/badges/{FOUNDER_ID}",
                           headers=_hdr(stealth_token),
                           json={"glow_color": "#FF00FF"})
        assert r.status_code == 200, r.text
        assert r.json()["badge"]["glow_color"] == "#FF00FF"

    def test_profile_renders_magenta_glow(self):
        b = _profile_badge("stealth", "founder")
        assert b["glow_color"] == "#FF00FF"

    def test_non_founder_admin_cannot_edit_locked(self, support_token):
        r = requests.patch(f"{BASE_URL}/api/admin/badges/{FOUNDER_ID}",
                           headers=_hdr(support_token),
                           json={"glow_color": "#000000"})
        assert r.status_code == 403, r.text

    def test_restore_founder_glow(self, stealth_token):
        r = requests.patch(f"{BASE_URL}/api/admin/badges/{FOUNDER_ID}",
                           headers=_hdr(stealth_token),
                           json={"glow_color": "#F4C84A"})
        assert r.status_code == 200
        assert r.json()["badge"]["glow_color"] == "#F4C84A"


# --- 3. Verified bg/text round-trip + clear -------------------------------
class TestVerifiedBgText:
    def test_set_bg_and_text(self, stealth_token):
        r = requests.patch(f"{BASE_URL}/api/admin/badges/{VERIFIED_ID}",
                           headers=_hdr(stealth_token),
                           json={"bg_color": "#1a1a2e", "text_color": "#FFD700"})
        assert r.status_code == 200
        b = r.json()["badge"]
        assert b["bg_color"] == "#1a1a2e"
        assert b["text_color"] == "#FFD700"

    def test_clear_both(self, stealth_token):
        r = requests.patch(f"{BASE_URL}/api/admin/badges/{VERIFIED_ID}",
                           headers=_hdr(stealth_token),
                           json={"bg_color": None, "text_color": None})
        assert r.status_code == 200
        b = r.json()["badge"]
        assert b["bg_color"] is None
        assert b["text_color"] is None

    def test_restore_verified(self, stealth_token):
        # Restore to seed defaults
        r = requests.patch(f"{BASE_URL}/api/admin/badges/{VERIFIED_ID}",
                           headers=_hdr(stealth_token),
                           json={"bg_color": "#001226", "text_color": "#0a0a0a"})
        assert r.status_code == 200


# --- 4. Gradient interaction ---------------------------------------------
class TestGradient:
    def test_set_sunset_gradient(self, stealth_token):
        sunset = "linear-gradient(135deg, #FF6B35 0%, #F7931E 100%)"
        r = requests.patch(f"{BASE_URL}/api/admin/badges/{VIP_ID}",
                           headers=_hdr(stealth_token),
                           json={"gradient": sunset})
        assert r.status_code == 200
        assert r.json()["badge"]["gradient"] == sunset

    def test_clear_gradient(self, stealth_token):
        r = requests.patch(f"{BASE_URL}/api/admin/badges/{VIP_ID}",
                           headers=_hdr(stealth_token),
                           json={"gradient": None})
        assert r.status_code == 200
        assert r.json()["badge"]["gradient"] is None

    def test_restore_vip_gradient(self, stealth_token):
        green = "linear-gradient(135deg, #00FF66 0%, #10E670 100%)"
        r = requests.patch(f"{BASE_URL}/api/admin/badges/{VIP_ID}",
                           headers=_hdr(stealth_token),
                           json={"gradient": green})
        assert r.status_code == 200
        assert r.json()["badge"]["gradient"] == green


# --- 5. Regressions ------------------------------------------------------
class TestRegressions:
    def test_auth_me_flags_intact(self, stealth_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(stealth_token))
        assert r.status_code == 200
        body = r.json()
        u = body.get("user") if "user" in body else body
        assert u.get("username") == "stealth"
        # founder role kept
        assert u.get("role") == "founder" or u.get("admin_role") == "founder"

    def test_reconcile_endpoint_still_works(self, stealth_token):
        r = requests.post(f"{BASE_URL}/api/admin/badges/reconcile",
                          headers=_hdr(stealth_token))
        assert r.status_code in (200, 204), r.text

    def test_user_badge_assignment_count_stable(self, stealth_token):
        r = requests.get(f"{BASE_URL}/api/admin/badges", headers=_hdr(stealth_token))
        assert r.status_code == 200
        # smoke: at least 3 system badges still present
        keys = {b["key"] for b in r.json()["badges"]}
        assert {"founder", "vip", "verified"}.issubset(keys)
