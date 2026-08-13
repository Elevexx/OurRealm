"""V31 avatar repair verification tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def audit_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "auditcheckreal", "password": "Password1$"})
    assert r.status_code == 200, r.text
    token = r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def founder_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "stealth", "password": "Password1$"})
    assert r.status_code == 200, r.text
    token = r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# Starter avatar checks (av_ninja / av_ninja_f)
def test_starter_avatars_glow_mask_and_run_animation(audit_client):
    r = audit_client.get(f"{BASE_URL}/api/nexus/avatars")
    assert r.status_code == 200, r.text
    data = r.json()
    starters = data.get("avatars", data.get("starters", []))
    assert isinstance(starters, list) and len(starters) >= 1
    ids = {a.get("id"): a for a in starters}
    assert "av_ninja" in ids, f"av_ninja missing; got {list(ids)}"
    assert "av_ninja_f" in ids, f"av_ninja_f missing; got {list(ids)}"
    for aid in ("av_ninja", "av_ninja_f"):
        a = ids[aid]
        assert a.get("glow_mask") is True, f"{aid} glow_mask not true: {a.get('glow_mask')}"
        anims = a.get("animation_urls") or {}
        assert "run" in anims and anims["run"], f"{aid} missing animation_urls.run: {anims}"
        assert len(anims) == 7, f"{aid} expected 7 animation keys, got {len(anims)}: {list(anims)}"


def test_all_8_avatars_have_run(audit_client):
    r1 = audit_client.get(f"{BASE_URL}/api/nexus/avatars")
    r2 = audit_client.get(f"{BASE_URL}/api/nexus/avatars/collection")
    assert r1.status_code == 200
    assert r2.status_code == 200, r2.text
    starters = r1.json().get("avatars", [])
    coll = r2.json()
    premium = coll.get("avatars", coll.get("collection", []))
    all_avs = starters + premium
    # dedupe
    seen = {}
    for a in all_avs:
        seen[a.get("id")] = a
    assert len(seen) >= 8, f"expected 8 avatars total, got {len(seen)}: {list(seen)}"
    old_run_marker = "BackRight_Run"  # old strafe clip name
    for aid, a in seen.items():
        anims = a.get("animation_urls") or {}
        assert "run" in anims and anims["run"], f"{aid} missing run url: {anims}"
        assert old_run_marker not in anims["run"], f"{aid} still has old strafe run: {anims['run']}"
        assert len(anims) == 7, f"{aid} expected 7 animations, got {len(anims)}: {list(anims)}"


# Starter selection & persistence
def test_starter_select_female_red_then_restore(audit_client):
    r = audit_client.post(f"{BASE_URL}/api/nexus/avatars/starter", json={"id": "av_ninja_f", "color": "red"})
    assert r.status_code in (200, 201), r.text
    # verify persistence
    r2 = audit_client.get(f"{BASE_URL}/api/nexus/avatars")
    d = r2.json()
    my_id = d.get("my_id") or d.get("selected_id")
    my_glow = d.get("my_glow") or d.get("selected_glow")
    assert my_id == "av_ninja_f", f"expected av_ninja_f, got {my_id}"
    assert my_glow == "red", f"expected red, got {my_glow}"
    # restore
    r3 = audit_client.post(f"{BASE_URL}/api/nexus/avatars/starter", json={"id": "av_ninja", "color": "lime"})
    assert r3.status_code in (200, 201), r3.text
    r4 = audit_client.get(f"{BASE_URL}/api/nexus/avatars")
    d4 = r4.json()
    assert (d4.get("my_id") or d4.get("selected_id")) == "av_ninja"
    assert (d4.get("my_glow") or d4.get("selected_glow")) == "lime"


# GLB size check
def test_av_ninja_rigged_glb_size(audit_client):
    r = audit_client.get(f"{BASE_URL}/api/nexus/avatars")
    starters = r.json().get("avatars", [])
    ninja = next((a for a in starters if a.get("id") == "av_ninja"), None)
    assert ninja, "av_ninja not found"
    url = ninja.get("rigged_base_url") or ninja.get("rigged_url") or ninja.get("model_url")
    assert url, f"no rigged url: {ninja}"
    # normalize if relative
    if url.startswith("/"):
        url = BASE_URL + url
    resp = audit_client.get(url, allow_redirects=True)
    assert resp.status_code == 200, f"{url} -> {resp.status_code}"
    size = len(resp.content)
    assert 500 * 1024 <= size <= 5 * 1024 * 1024, f"GLB size {size} out of range (500KB-5MB)"


# Regression
def test_nexus_join_ok(audit_client):
    r = audit_client.post(f"{BASE_URL}/api/nexus/join", json={})
    assert r.status_code in (200, 201, 409), r.text


def test_assets_catalog_founder_8_avatars(founder_client):
    r = founder_client.get(f"{BASE_URL}/api/nexus/assets/catalog")
    assert r.status_code == 200, r.text
    d = r.json()
    avs = d.get("avatars") or d.get("catalog", {}).get("avatars") or []
    assert len(avs) >= 8, f"expected >=8 avatars, got {len(avs)}"
