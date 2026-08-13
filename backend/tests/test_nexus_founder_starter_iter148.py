"""iter148 — FIG.01–06 backend regression: starter ninja avatars, glow, founder vault, animations."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = BASE_URL + "/api"

PWD = "Password1$"
REG_USER = "auditcheckreal"
FOUNDER_USER = "stealth"

PREMIUM = ["av_streetwear", "av_tech_operative", "av_realm_guardian",
           "av_aether_champion", "av_arcane_sovereign", "av_void_wizard"]
ANIM_KEYS = ["idle", "walk", "run", "jump", "fall", "land", "greet"]


def _login(username):
    r = requests.post(f"{API}/auth/login", json={"email": username, "password": PWD}, timeout=15)
    assert r.status_code == 200, f"login {username} → {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def reg_h():
    return _login(REG_USER)


@pytest.fixture(scope="module")
def founder_h():
    return _login(FOUNDER_USER)


# ── /avatars: starter list ─────────────────────────────────────────────

def test_avatars_list_only_ninja_active(reg_h):
    r = requests.get(f"{API}/nexus/avatars", headers=reg_h, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    ids = [a["id"] for a in j["avatars"]]
    assert set(ids) == {"av_ninja", "av_ninja_f"}, f"expected only starters, got {ids}"
    ninja = next(a for a in j["avatars"] if a["id"] == "av_ninja")
    assert ninja.get("is_default") is True
    assert "my_glow" in j


def test_starters_have_7_animations(reg_h):
    r = requests.get(f"{API}/nexus/avatars", headers=reg_h, timeout=15)
    for a in r.json()["avatars"]:
        anim = a.get("animation_urls") or {}
        for k in ANIM_KEYS:
            assert k in anim and anim[k], f"{a['id']} missing animation {k}"


# ── /avatars/starter atomic save ───────────────────────────────────────

def test_starter_save_female_violet_no_fp_burn(reg_h):
    # capture wallet balance
    coll = requests.get(f"{API}/nexus/avatars/collection", headers=reg_h, timeout=15).json()
    before_fp = coll.get("fire_balance", 0)

    r = requests.post(f"{API}/nexus/avatars/starter", headers=reg_h,
                      json={"id": "av_ninja_f", "color": "violet"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True

    g = requests.get(f"{API}/nexus/avatars", headers=reg_h, timeout=15).json()
    assert g["my_id"] == "av_ninja_f"
    assert g["my_glow"] == "violet"

    coll2 = requests.get(f"{API}/nexus/avatars/collection", headers=reg_h, timeout=15).json()
    assert coll2.get("fire_balance", 0) == before_fp, "starter save must NOT burn FP"


def test_starter_invalid_id_422(reg_h):
    r = requests.post(f"{API}/nexus/avatars/starter", headers=reg_h,
                      json={"id": "av_x", "color": "lime"}, timeout=15)
    assert r.status_code == 422, r.text


def test_starter_invalid_color_422(reg_h):
    r = requests.post(f"{API}/nexus/avatars/starter", headers=reg_h,
                      json={"id": "av_ninja", "color": "pink"}, timeout=15)
    assert r.status_code == 422, r.text


def test_glow_cyan_ok(reg_h):
    r = requests.post(f"{API}/nexus/avatars/glow", headers=reg_h,
                      json={"color": "cyan"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True


# ── Founder vault ──────────────────────────────────────────────────────

def test_founder_collection_all_unlocked(founder_h):
    r = requests.get(f"{API}/nexus/avatars/collection", headers=founder_h, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("founder_vault") is True, f"founder_vault flag missing: {j}"
    ids = {a["id"]: a for a in j["avatars"]}
    for pid in PREMIUM:
        assert pid in ids, f"{pid} missing from collection"
        assert ids[pid].get("unlocked") is True, f"{pid} not unlocked for founder"


def test_founder_unlock_zero_burn(founder_h):
    # capture wallet
    coll = requests.get(f"{API}/nexus/avatars/collection", headers=founder_h, timeout=15).json()
    before = coll.get("fire_balance", 0)
    r = requests.post(f"{API}/nexus/avatars/av_void_wizard/unlock", headers=founder_h, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert (j.get("founder_vault") is True) or (j.get("already_unlocked") is True), j
    assert j.get("burned", 0) == 0
    after = requests.get(f"{API}/nexus/avatars/collection", headers=founder_h, timeout=15).json().get("fire_balance", 0)
    assert after == before, f"wallet changed {before}→{after}"


def test_founder_can_select_premium(founder_h):
    r = requests.post(f"{API}/nexus/avatars/select", headers=founder_h,
                      json={"id": "av_void_wizard"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True


def test_all_premium_have_7_animations(founder_h):
    r = requests.get(f"{API}/nexus/avatars/collection", headers=founder_h, timeout=15).json()
    ids = {a["id"]: a for a in r["avatars"]}
    for pid in PREMIUM:
        anim = ids[pid].get("animation_urls") or {}
        for k in ANIM_KEYS:
            assert k in anim and anim[k], f"{pid} missing animation {k} — has {list(anim.keys())}"


# ── Regular user vault absence + 403 on locked premium ────────────────

def test_regular_user_no_founder_vault(reg_h):
    r = requests.get(f"{API}/nexus/avatars/collection", headers=reg_h, timeout=15).json()
    assert not r.get("founder_vault"), f"reg user should not have founder_vault: {r.get('founder_vault')}"


def test_regular_user_select_locked_premium_403(reg_h):
    # find a premium avatar that is NOT unlocked for this user
    coll = requests.get(f"{API}/nexus/avatars/collection", headers=reg_h, timeout=15).json()
    locked = [a["id"] for a in coll["avatars"] if a["id"] in PREMIUM and not a.get("unlocked")]
    if not locked:
        pytest.skip("regular user has all premiums unlocked; cannot test 403")
    r = requests.post(f"{API}/nexus/avatars/select", headers=reg_h,
                      json={"id": locked[0]}, timeout=15)
    assert r.status_code == 403, f"expected 403 for locked {locked[0]}, got {r.status_code} {r.text}"


# ── Regression: world & public/join ───────────────────────────────────

def test_world_version_ge_28(reg_h):
    r = requests.get(f"{API}/nexus/world", headers=reg_h, timeout=15)
    assert r.status_code == 200, r.text
    v = r.json().get("version") or r.json().get("published_version") or r.json().get("draft_version")
    assert v is not None and int(v) >= 28, f"world version={v} expected >=28"


def test_public_and_join(reg_h):
    r = requests.get(f"{API}/nexus/public", headers=reg_h, timeout=15)
    assert r.status_code == 200, r.text
    r2 = requests.post(f"{API}/nexus/join", headers=reg_h, json={}, timeout=15)
    assert r2.status_code == 200, r2.text


# ── Cleanup: restore equipped avatars per agent note ─────────────────

def test_zz_restore_equipped(reg_h, founder_h):
    # auditcheckreal → av_streetwear (if unlocked else av_ninja lime)
    coll = requests.get(f"{API}/nexus/avatars/collection", headers=reg_h, timeout=15).json()
    sw = next((a for a in coll["avatars"] if a["id"] == "av_streetwear"), None)
    if sw and sw.get("unlocked"):
        r = requests.post(f"{API}/nexus/avatars/select", headers=reg_h,
                          json={"id": "av_streetwear"}, timeout=15)
        assert r.status_code == 200
    else:
        # keep starter but restore to av_ninja lime (safe default)
        requests.post(f"{API}/nexus/avatars/starter", headers=reg_h,
                      json={"id": "av_ninja", "color": "lime"}, timeout=15)
    # stealth — leave as void_wizard (founder can pick anything; this is fine)
    assert True
