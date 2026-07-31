"""Bundle B tests — Responsibility Center Media Manager + Branding + Renewal Digest prefs.

Runs against live REACT_APP_BACKEND_URL. Uses stealth (founder/owner),
tftwo (member), auditcheckreal (non-admin non-member). Idempotent —
restores registry and branding to defaults at the end.
"""
import io
import os
import time
import uuid

import pytest
import requests
from PIL import Image

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
CENTER_ID = "cf5a475c04cd4860976920cda63fa6ff"
ADMIN = ("stealth", "Password1$")
MEMBER = ("tftwo", "pass1234")
OUTSIDER = ("auditcheckreal", "Password1$")

ASSET = "responsibility_center.main_logo"


def _login(username, password):
    r = requests.post(f"{BASE_URL}/auth/login",
                      json={"email": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {username}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def admin_tok():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def member_tok():
    return _login(*MEMBER)


@pytest.fixture(scope="module")
def outsider_tok():
    return _login(*OUTSIDER)


def _make_png_bytes(w=200, h=100, color=(66, 133, 244)):
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _upload_image(tok, w=200, h=100, color=(66, 133, 244)):
    files = {"file": (f"logo_{uuid.uuid4().hex[:6]}.png", _make_png_bytes(w, h, color), "image/png")}
    r = requests.post(f"{BASE_URL}/images/upload", headers=_h(tok), files=files, timeout=30)
    assert r.status_code == 200, f"upload failed: {r.status_code} {r.text[:200]}"
    d = r.json()
    url = d.get("url") or d.get("public_url") or d.get("cdn_url")
    assert url, f"no url in upload response: {d}"
    return url


# ── SECURITY ────────────────────────────────────────────────────────────
class TestMediaSecurity:
    def test_manifest_requires_auth(self):
        r = requests.get(f"{BASE_URL}/responsibility-center/media/manifest", timeout=10)
        assert r.status_code in (401, 403)

    def test_manifest_ok_for_any_user(self, outsider_tok):
        r = requests.get(f"{BASE_URL}/responsibility-center/media/manifest",
                         headers=_h(outsider_tok), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "assets" in d and "branding" in d

    def test_assets_no_token_401(self):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/media/assets", timeout=10)
        assert r.status_code in (401, 403)

    def test_assets_non_admin_403(self, outsider_tok):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/media/assets",
                         headers=_h(outsider_tok), timeout=10)
        assert r.status_code == 403

    def test_upload_version_non_admin_403(self, outsider_tok):
        r = requests.post(f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions",
                          headers=_h(outsider_tok),
                          json={"url": "/api/images/nope.png", "reason": "hack attempt xyz"},
                          timeout=10)
        assert r.status_code == 403

    def test_branding_patch_non_admin_403(self, outsider_tok):
        r = requests.patch(f"{BASE_URL}/admin/responsibility-center/media/branding",
                           headers=_h(outsider_tok),
                           json={"updates": {"tagline": "hacked"}, "reason": "hack attempt"},
                           timeout=10)
        assert r.status_code == 403


# ── ASSET REGISTRY SHAPE ────────────────────────────────────────────────
class TestAssetRegistry:
    def test_sections_shape(self, admin_tok):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/media/assets",
                         headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        s = d["sections"]
        expected = {"branding": 10, "landing": 10, "center_types": 13,
                    "dashboard": 13, "education": 11, "admin_system": 12}
        for k, n in expected.items():
            assert k in s, f"missing section {k}"
            assert len(s[k]) == n, f"section {k}: expected {n} got {len(s[k])}"
        # Total 69
        total = sum(len(v) for v in s.values())
        assert total == 69, f"total asset keys != 69 (got {total})"
        # sample entry has catalog metadata
        row = s["branding"][0]
        for f in ("asset_key", "display_name", "description", "recommended_width",
                  "recommended_height", "category", "version_count", "usage"):
            assert f in row, f"missing field {f} in registry row"
        assert isinstance(row["usage"], list)


# ── REAL UPLOAD → VERSION → ACTIVATE → MANIFEST E2E ─────────────────────
class TestUploadLifecycle:
    def test_full_lifecycle(self, admin_tok):
        # 1. Real PNG upload → durable URL
        url1 = _upload_image(admin_tok, color=(220, 20, 60))
        assert url1.startswith("http") or url1.startswith("/api/")
        # 2. Create v1 (inactive) with reason
        r = requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions",
            headers=_h(admin_tok),
            json={"url": url1, "reason": "Bundle B test v1 upload"},
            timeout=15)
        assert r.status_code == 200, r.text[:200]
        v1 = r.json()["version"]
        assert v1["status"] == "inactive"
        v1_id = v1["id"]
        # 3. Activate v1 with reason
        r = requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions/{v1_id}/activate",
            headers=_h(admin_tok),
            json={"reason": "Bundle B test activate v1"},
            timeout=15)
        assert r.status_code == 200, r.text[:200]
        assert r.json()["version"]["status"] == "active"
        # 4. Manifest reflects v1 URL immediately
        r = requests.get(f"{BASE_URL}/responsibility-center/media/manifest",
                         headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        m = r.json()
        assert m["assets"].get(ASSET, {}).get("url") == url1, \
            f"manifest not showing v1 url. Got: {m['assets'].get(ASSET)}"
        # 5. Upload v2, activate in same call
        url2 = _upload_image(admin_tok, color=(0, 128, 0))
        r = requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions",
            headers=_h(admin_tok),
            json={"url": url2, "reason": "Bundle B test v2 upload+activate",
                  "activate": True},
            timeout=15)
        assert r.status_code == 200, r.text[:200]
        v2 = r.json()["version"]
        v2_id = v2["id"]
        # 6. Only ONE active version
        r = requests.get(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions",
            headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        versions = r.json()["versions"]
        active = [v for v in versions if v["status"] == "active"]
        assert len(active) == 1, f"expected 1 active, got {len(active)}"
        assert active[0]["id"] == v2_id
        # 7. Restore v1 via activate endpoint
        r = requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions/{v1_id}/activate",
            headers=_h(admin_tok),
            json={"reason": "Bundle B restore to v1"}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        # 8. v1 active, v2 deactivated
        r = requests.get(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions",
            headers=_h(admin_tok), timeout=10)
        versions = {v["id"]: v for v in r.json()["versions"]}
        assert versions[v1_id]["status"] == "active"
        assert versions[v2_id]["status"] == "deactivated"
        # History preserved
        for vid in (v1_id, v2_id):
            assert versions[vid].get("uploaded_by")
            assert versions[vid].get("upload_reason")
        # 9. Reset-to-default deactivates all, manifest drops the key
        r = requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/reset",
            headers=_h(admin_tok),
            json={"reason": "Bundle B reset to default"}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        r = requests.get(f"{BASE_URL}/responsibility-center/media/manifest",
                         headers=_h(admin_tok), timeout=10)
        m = r.json()
        assert ASSET not in m["assets"] or m["assets"][ASSET].get("url") is None, \
            f"manifest still has active {ASSET}: {m['assets'].get(ASSET)}"


# ── VALIDATION ──────────────────────────────────────────────────────────
class TestValidation:
    def test_blob_url_rejected(self, admin_tok):
        r = requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions",
            headers=_h(admin_tok),
            json={"url": "blob:https://example.com/xyz", "reason": "should reject blob"},
            timeout=10)
        assert r.status_code == 400

    def test_data_url_rejected(self, admin_tok):
        r = requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions",
            headers=_h(admin_tok),
            json={"url": "data:image/png;base64,iVBOR", "reason": "should reject data"},
            timeout=10)
        assert r.status_code == 400

    def test_short_reason_rejected(self, admin_tok):
        r = requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions",
            headers=_h(admin_tok),
            json={"url": "/api/images/xyz.png", "reason": "hi"}, timeout=10)
        assert r.status_code == 400

    def test_unknown_asset_key_404(self, admin_tok):
        r = requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/responsibility_center.nope/versions",
            headers=_h(admin_tok),
            json={"url": "/api/images/x.png", "reason": "unknown key test"}, timeout=10)
        assert r.status_code == 404

    def test_unknown_theme_variant_400(self, admin_tok):
        url = _upload_image(admin_tok)
        r = requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions",
            headers=_h(admin_tok),
            json={"url": url, "reason": "bad theme test", "theme_variant": "sparkle"},
            timeout=15)
        assert r.status_code == 400

    def test_unknown_device_variant_400(self, admin_tok):
        url = _upload_image(admin_tok)
        r = requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions",
            headers=_h(admin_tok),
            json={"url": url, "reason": "bad device test", "device_variant": "smartwatch"},
            timeout=15)
        assert r.status_code == 400


# ── ALT TEXT ────────────────────────────────────────────────────────────
class TestAltText:
    def test_alt_text_update_and_manifest(self, admin_tok):
        # Set alt
        r = requests.patch(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}",
            headers=_h(admin_tok),
            json={"alt_text": "Bundle B alt test logo", "reason": "alt text test"},
            timeout=15)
        assert r.status_code == 200, r.text[:200]
        assert r.json()["alt_text"] == "Bundle B alt test logo"
        # Need active version for manifest to include alt
        url = _upload_image(admin_tok)
        rv = requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/versions",
            headers=_h(admin_tok),
            json={"url": url, "reason": "alt text pre-check version",
                  "activate": True}, timeout=15)
        assert rv.status_code == 200
        # Manifest reflects alt
        r = requests.get(f"{BASE_URL}/responsibility-center/media/manifest",
                         headers=_h(admin_tok), timeout=10)
        m = r.json()
        assert m["assets"].get(ASSET, {}).get("alt") == "Bundle B alt test logo"
        # Cleanup: reset
        requests.post(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/reset",
            headers=_h(admin_tok),
            json={"reason": "alt test cleanup reset"}, timeout=15)
        # Blank the alt so registry is clean
        requests.patch(
            f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}",
            headers=_h(admin_tok),
            json={"alt_text": "", "reason": "alt test cleanup blank"}, timeout=15)


# ── BRANDING ────────────────────────────────────────────────────────────
class TestBranding:
    def test_get_branding_defaults(self, admin_tok):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/media/branding",
                         headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "branding" in d and "defaults" in d
        for k in ("product_name", "short_name", "tagline",
                  "center_branding_enabled", "template_logo_overrides_enabled",
                  "user_center_logo_allowed", "user_center_cover_allowed"):
            assert k in d["branding"]

    def test_branding_invalid_key_400(self, admin_tok):
        r = requests.patch(f"{BASE_URL}/admin/responsibility-center/media/branding",
                           headers=_h(admin_tok),
                           json={"updates": {"neopolitan": "yum"}, "reason": "invalid key test"},
                           timeout=10)
        assert r.status_code == 400

    def test_branding_empty_product_name_400(self, admin_tok):
        r = requests.patch(f"{BASE_URL}/admin/responsibility-center/media/branding",
                           headers=_h(admin_tok),
                           json={"updates": {"product_name": ""}, "reason": "empty name test"},
                           timeout=10)
        assert r.status_code == 400

    def test_branding_tagline_change_and_restore(self, admin_tok):
        new_tag = "Bundle B temporary tagline"
        r = requests.patch(f"{BASE_URL}/admin/responsibility-center/media/branding",
                           headers=_h(admin_tok),
                           json={"updates": {"tagline": new_tag},
                                 "reason": "Bundle B tagline test"}, timeout=15)
        assert r.status_code == 200
        # Manifest reflects
        r = requests.get(f"{BASE_URL}/responsibility-center/media/manifest",
                         headers=_h(admin_tok), timeout=10)
        assert r.json()["branding"]["tagline"] == new_tag
        # Restore
        r = requests.patch(f"{BASE_URL}/admin/responsibility-center/media/branding",
                           headers=_h(admin_tok),
                           json={"updates": {"tagline": "One System. Endless Possibilities."},
                                 "reason": "Bundle B restore tagline"}, timeout=15)
        assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/responsibility-center/media/manifest",
                         headers=_h(admin_tok), timeout=10)
        assert r.json()["branding"]["tagline"] == "One System. Endless Possibilities."


# ── CENTER-SPECIFIC BRANDING FOUNDATION ─────────────────────────────────
class TestCenterBranding:
    def _set_flags(self, admin_tok, **flags):
        return requests.patch(
            f"{BASE_URL}/admin/responsibility-center/media/branding",
            headers=_h(admin_tok),
            json={"updates": flags, "reason": "Bundle B center branding flag test"},
            timeout=15)

    def test_center_branding_gated_by_flag(self, admin_tok):
        # Ensure disabled first
        self._set_flags(admin_tok, center_branding_enabled=False,
                        user_center_logo_allowed=False)
        r = requests.patch(f"{BASE_URL}/responsibility-center/{CENTER_ID}/branding",
                           headers=_h(admin_tok),
                           json={"accent": "#F4C84A"}, timeout=10)
        assert r.status_code == 403

    def test_center_branding_flow(self, admin_tok, member_tok):
        # Enable both flags
        r = self._set_flags(admin_tok, center_branding_enabled=True,
                            user_center_logo_allowed=True)
        assert r.status_code == 200
        try:
            # Owner sets icon_url durable
            url = _upload_image(admin_tok, 128, 128)
            r = requests.patch(
                f"{BASE_URL}/responsibility-center/{CENTER_ID}/branding",
                headers=_h(admin_tok),
                json={"icon_url": url}, timeout=15)
            assert r.status_code == 200, r.text[:200]
            assert r.json()["branding"].get("icon_url") == url
            # Non-permitted member (tftwo — member without edit_center) gets 403
            r2 = requests.patch(
                f"{BASE_URL}/responsibility-center/{CENTER_ID}/branding",
                headers=_h(member_tok),
                json={"icon_url": url}, timeout=15)
            assert r2.status_code == 403, r2.status_code
            # Invalid accent 400
            r3 = requests.patch(
                f"{BASE_URL}/responsibility-center/{CENTER_ID}/branding",
                headers=_h(admin_tok),
                json={"accent": "not-a-color"}, timeout=15)
            assert r3.status_code == 400
            # clear:true removes
            r4 = requests.patch(
                f"{BASE_URL}/responsibility-center/{CENTER_ID}/branding",
                headers=_h(admin_tok),
                json={"clear": True}, timeout=15)
            assert r4.status_code == 200
            assert r4.json().get("branding") in (None, {})
        finally:
            # Restore flags to False
            self._set_flags(admin_tok, center_branding_enabled=False,
                            user_center_logo_allowed=False,
                            user_center_cover_allowed=False,
                            template_logo_overrides_enabled=False)


# ── PREFERENCES ─────────────────────────────────────────────────────────
class TestPreferences:
    def test_get_defaults(self, member_tok):
        r = requests.get(f"{BASE_URL}/responsibility-center/preferences",
                         headers=_h(member_tok), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "preferences" in d and "defaults" in d
        assert len(d["defaults"]) == 5, f"expected 5 pref keys, got {len(d['defaults'])}"
        for k, v in d["defaults"].items():
            assert v is True, f"default {k}={v}, expected True"

    def test_patch_persists_and_unknown_ignored(self, member_tok):
        # Get current prefs
        d = requests.get(f"{BASE_URL}/responsibility-center/preferences",
                         headers=_h(member_tok), timeout=10).json()
        pref_keys = list(d["defaults"].keys())
        first = pref_keys[0]
        # Toggle first pref off
        r = requests.patch(f"{BASE_URL}/responsibility-center/preferences",
                           headers=_h(member_tok),
                           json={"updates": {first: False, "unknown_pref": True}},
                           timeout=10)
        assert r.status_code == 200
        prefs = r.json()["preferences"]
        assert prefs[first] is False
        assert "unknown_pref" not in prefs
        # Restore ON
        r = requests.patch(f"{BASE_URL}/responsibility-center/preferences",
                           headers=_h(member_tok),
                           json={"updates": {first: True}}, timeout=10)
        assert r.status_code == 200
        assert r.json()["preferences"][first] is True


# ── FINAL CLEANUP: ensure defaults restored ─────────────────────────────
def test_zzz_final_cleanup(admin_tok):
    # Reset main_logo
    requests.post(f"{BASE_URL}/admin/responsibility-center/media/assets/{ASSET}/reset",
                  headers=_h(admin_tok),
                  json={"reason": "Bundle B final cleanup reset"}, timeout=15)
    # Restore all branding fields to defaults
    requests.patch(f"{BASE_URL}/admin/responsibility-center/media/branding",
                   headers=_h(admin_tok),
                   json={"updates": {
                       "product_name": "OurRealm Responsibility Center",
                       "short_name": "Responsibility Center",
                       "tagline": "One System. Endless Possibilities.",
                       "center_branding_enabled": False,
                       "template_logo_overrides_enabled": False,
                       "user_center_logo_allowed": False,
                       "user_center_cover_allowed": False,
                   },
                       "reason": "Bundle B final cleanup restore defaults"},
                   timeout=15)
    # Verify manifest defaults
    r = requests.get(f"{BASE_URL}/responsibility-center/media/manifest",
                     headers=_h(admin_tok), timeout=10)
    m = r.json()
    b = m["branding"]
    assert b["tagline"] == "One System. Endless Possibilities."
    assert b["center_branding_enabled"] is False
