"""Backend tests for RealmLife housing/beacons/privacy (iteration 153)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")
GAME_ID = "realmlife-home-v1"


def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {username}: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def audit_token():
    return _login("auditcheckreal", "Password1$")


@pytest.fixture(scope="module")
def stealth_token():
    return _login("stealth", "Password1$")


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# --- HOUSING ---
def test_housing_member(audit_token):
    r = requests.get(f"{BASE_URL}/api/games/{GAME_ID}/realmlife/housing", headers=_h(audit_token), timeout=30)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    assert j.get("has_housing") is True
    ha = j.get("home_anchor")
    assert ha, f"missing home_anchor: {j}"
    assert ha.get("founder") is False
    assert isinstance(ha.get("lot_seq"), int)
    assert isinstance(ha.get("x"), (int, float))
    assert isinstance(ha.get("z"), (int, float))
    prop = j.get("property") or {}
    assert prop.get("city_lot_seq") == ha.get("lot_seq"), f"city_lot_seq mismatch: prop={prop.get('city_lot_seq')} anchor={ha.get('lot_seq')}"


def test_housing_founder(stealth_token):
    r = requests.get(f"{BASE_URL}/api/games/{GAME_ID}/realmlife/housing", headers=_h(stealth_token), timeout=30)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    ha = j.get("home_anchor") or {}
    assert ha.get("founder") is True, ha
    assert ha.get("lot_seq") in (None, 0), ha
    assert ha.get("x") == 0
    assert ha.get("z") == 0


# --- BEACONS ---
def test_beacons_list(audit_token):
    r = requests.get(f"{BASE_URL}/api/games/{GAME_ID}/realmlife/world/beacons", headers=_h(audit_token), timeout=30)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    beacons = j.get("beacons") if isinstance(j, dict) else j
    assert isinstance(beacons, list) and len(beacons) > 0
    self_count = 0
    forbidden_keys = {"username", "owner_username", "user_id", "owner_id", "email", "display_name"}
    for b in beacons:
        assert "lot_seq" in b
        assert "property_id" in b
        assert "is_self" in b
        assert "active" in b
        if b["is_self"]:
            self_count += 1
            assert b["active"] is True
        # privacy: no identity fields
        leaked = forbidden_keys.intersection(b.keys())
        assert not leaked, f"beacon leaks identity fields: {leaked} in {b}"
    assert self_count >= 1


# --- WORLD/HOME spawn ---
def test_world_home_member(audit_token):
    hr = requests.get(f"{BASE_URL}/api/games/{GAME_ID}/realmlife/housing", headers=_h(audit_token), timeout=30).json()
    ha = hr["home_anchor"]
    r = requests.get(f"{BASE_URL}/api/games/{GAME_ID}/realmlife/world/home", headers=_h(audit_token), timeout=30)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    x = j.get("x") if "x" in j else (j.get("spawn") or {}).get("x")
    z = j.get("z") if "z" in j else (j.get("spawn") or {}).get("z")
    assert x is not None and z is not None, j
    # Not origin default
    assert not (x == 0 and abs(z - 17.6) < 0.01), f"member spawn should not be origin: {j}"
    assert abs(x - ha["x"]) < 1.0, f"spawn x {x} vs anchor x {ha['x']}"


def test_world_home_founder(stealth_token):
    r = requests.get(f"{BASE_URL}/api/games/{GAME_ID}/realmlife/world/home", headers=_h(stealth_token), timeout=30)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    x = j.get("x") if "x" in j else (j.get("spawn") or {}).get("x")
    z = j.get("z") if "z" in j else (j.get("spawn") or {}).get("z")
    assert x == 0
    assert abs(z - 17.6) < 0.5, f"founder z {z}"


# --- PRIVACY ACCESS-CHECK + ENTRY-REQUEST ---
def test_access_check_denied(audit_token):
    r = requests.post(f"{BASE_URL}/api/games/{GAME_ID}/realmlife/property/access-check",
                      headers=_h(audit_token), json={"property_id": "property-000001"}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    assert j.get("allowed") is False
    assert j.get("reason") == "private_property", j


def test_entry_request_idempotent(audit_token):
    url = f"{BASE_URL}/api/games/{GAME_ID}/realmlife/property/entry-request"
    r1 = requests.post(url, headers=_h(audit_token), json={"property_id": "property-000001"}, timeout=30)
    assert r1.status_code == 200, f"first: {r1.status_code} {r1.text[:300]}"
    j1 = r1.json()
    r2 = requests.post(url, headers=_h(audit_token), json={"property_id": "property-000001"}, timeout=30)
    assert r2.status_code == 200, f"second: {r2.status_code} {r2.text[:300]}"
    j2 = r2.json()
    # Should not create duplicate — either same id or pending flag
    id1 = j1.get("request_id") or (j1.get("request") or {}).get("id")
    id2 = j2.get("request_id") or (j2.get("request") or {}).get("id")
    if id1 and id2:
        assert id1 == id2, f"non-idempotent: {id1} vs {id2}"


# --- HOUSEHOLD READ-ONLY ---
def test_property_inbox(audit_token):
    r = requests.get(f"{BASE_URL}/api/games/{GAME_ID}/realmlife/property/inbox", headers=_h(audit_token), timeout=30)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    assert isinstance(j, (dict, list))
