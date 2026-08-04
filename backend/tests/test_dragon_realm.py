"""Dragon Realm backend tests — iteration 118."""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")
UA = {"User-Agent": "Mozilla/5.0 (T1-tester)"}


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, headers=UA, timeout=15)
    return r


@pytest.fixture(scope="module")
def founder_token():
    r = _login("stealth", "Password1$")
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def founder_headers(founder_token):
    return {**UA, "Authorization": f"Bearer {founder_token}"}


@pytest.fixture(scope="module")
def throwaway_headers():
    # Use existing non-founder auditcheckreal (from test_credentials.md)
    r = _login("auditcheckreal", "Password1$")
    if r.status_code != 200:
        r = _login("tftwo", "pass1234")
    assert r.status_code == 200, f"non-founder login failed: {r.status_code} {r.text[:200]}"
    tok = r.json()["access_token"]
    return {**UA, "Authorization": f"Bearer {tok}"}


# ── access control ──────────────────────────────────────────────────────
def test_state_anon_401():
    r = requests.get(f"{BASE}/api/dragon-realm/state", headers=UA, timeout=15)
    assert r.status_code == 401, r.text


def test_state_founder_200_shape(founder_headers):
    r = requests.get(f"{BASE}/api/dragon-realm/state", headers=founder_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["runtime_id"] == "runtime_dragon_realm_rpg_v1"
    assert data["template_id"] == "tpl_dragon_realm_fire_quest_v1"
    # renderer isn't part of state root — check content contract
    assert "content" in data and "dragons" in data["content"]
    assert len(data["content"]["dragons"]) == 6
    assert data["content"]["boss"]["name"] == "THORNBEAST"
    rc = data["rewards_config"]
    assert rc["quest_complete"] == 25
    assert rc["dragon_first_defeat"] == 10
    assert rc["boss_thornbeast"] == 100


def test_state_throwaway_403(throwaway_headers):
    r = requests.get(f"{BASE}/api/dragon-realm/state", headers=throwaway_headers, timeout=15)
    assert r.status_code == 403, r.text


# ── admin config ────────────────────────────────────────────────────────
def test_admin_config_get(founder_headers):
    r = requests.get(f"{BASE}/api/dragon-realm/admin/config", headers=founder_headers, timeout=15)
    assert r.status_code == 200
    assert "rewards" in r.json()


def test_admin_config_throwaway_forbidden(throwaway_headers):
    r = requests.get(f"{BASE}/api/dragon-realm/admin/config", headers=throwaway_headers, timeout=15)
    assert r.status_code in (401, 403)


def test_admin_config_put_requires_reason(founder_headers):
    r = requests.put(f"{BASE}/api/dragon-realm/admin/config",
                     json={"rewards": {"quest_complete": 26}},
                     headers=founder_headers, timeout=15)
    assert r.status_code == 400
    assert "reason" in r.text.lower()


def test_admin_config_put_changes_and_restore(founder_headers):
    orig = requests.get(f"{BASE}/api/dragon-realm/admin/config", headers=founder_headers, timeout=15).json()
    orig_quest = orig["rewards"]["quest_complete"]
    # bump
    r = requests.put(f"{BASE}/api/dragon-realm/admin/config",
                     json={"rewards": {"quest_complete": orig_quest + 1}, "reason": "iter118 test"},
                     headers=founder_headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["rewards"]["quest_complete"] == orig_quest + 1
    # restore
    r2 = requests.put(f"{BASE}/api/dragon-realm/admin/config",
                      json={"rewards": {"quest_complete": orig_quest}, "reason": "iter118 restore"},
                      headers=founder_headers, timeout=15)
    assert r2.status_code == 200
    assert r2.json()["rewards"]["quest_complete"] == orig_quest


# ── event validation ────────────────────────────────────────────────────
def test_event_unknown_enemy(founder_headers):
    r = requests.post(f"{BASE}/api/dragon-realm/event",
                      json={"type": "battle_win", "enemy_id": "nope"},
                      headers=founder_headers, timeout=15)
    assert r.status_code == 400


def test_boss_gate_locked_message(founder_headers):
    # This may 400 with "boss gate locked" OR succeed if founder already
    # progressed. We only assert that IF boss is locked we get 400 with the
    # right message; otherwise skip (progress preserved by request).
    state = requests.get(f"{BASE}/api/dragon-realm/state", headers=founder_headers, timeout=15).json()
    t = (state.get("save") or {})
    # server-authoritative trusted lives in save doc — fetch via content? just try event
    r = requests.post(f"{BASE}/api/dragon-realm/event",
                      json={"type": "boss_win", "enemy_id": "thornbeast"},
                      headers=founder_headers, timeout=15)
    if r.status_code == 400:
        assert "boss gate" in r.text.lower() or "locked" in r.text.lower()
    else:
        # already progressed — ok
        assert r.status_code in (200, 400)


# ── classification ──────────────────────────────────────────────────────
def test_route_runtime_creature_rpg():
    # Ensure backend .env is loaded (dotenv) before importing
    import sys
    sys.path.insert(0, "/app/backend")
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from services import game_studio as gs
    r = gs.route_runtime("a creature collection game where you befriend dragons")
    # route_runtime may return tuple or string
    if isinstance(r, tuple):
        rt = r[0]
    else:
        rt = r
    assert rt == "turn_based_creature_rpg", f"got {r}"
    assert "turn_based_creature_rpg" in gs.SCAFFOLDED_RUNTIMES
