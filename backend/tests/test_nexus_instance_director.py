"""
Nexus Instance Director regression (v24).
Tests /api/nexus join / invite / realm / party / presence / public.
Read-only where possible; does NOT trigger Meshy or mutate world state.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://realm-deploy.preview.emergentagent.com"

FOUNDER = ("stealth", "Password1$")
BUDDY = ("auditcheckreal", "Password1$")


def _login(session, username, password):
    r = session.post(f"{BASE_URL}/api/auth/login",
                     json={"email": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in login: {r.json()}"
    session.headers.update({"Authorization": f"Bearer {tok}"})
    return tok


@pytest.fixture(scope="module")
def founder():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _login(s, *FOUNDER)
    return s


@pytest.fixture(scope="module")
def buddy():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    try:
        _login(s, *BUDDY)
    except AssertionError:
        pytest.skip("buddy account not usable")
    return s


# --- /public (no-auth) ---
def test_public_info_no_auth():
    r = requests.get(f"{BASE_URL}/api/nexus/public", timeout=15)
    assert r.status_code == 200, r.text[:200]
    data = r.json()
    assert "online" in data or "online_count" in data or "zones" in data or "systems" in data, data


# --- /join basic + duplicate protection ---
def test_join_basic_and_duplicate_protection(founder):
    # wait to clear any prior throttle from other tests
    time.sleep(2.0)
    r1 = founder.post(f"{BASE_URL}/api/nexus/join", json={}, timeout=15)
    assert r1.status_code == 200, f"first join {r1.status_code} {r1.text[:200]}"
    d = r1.json()
    assert "world_id" in d and "instance_id" in d and "reason" in d, d

    # immediate second call within 1.5s → 429
    r2 = founder.post(f"{BASE_URL}/api/nexus/join", json={}, timeout=15)
    assert r2.status_code == 429, f"expected 429 got {r2.status_code} {r2.text[:200]}"

    # after 2s → works again
    time.sleep(2.1)
    r3 = founder.post(f"{BASE_URL}/api/nexus/join", json={}, timeout=15)
    assert r3.status_code == 200, f"third join {r3.status_code} {r3.text[:200]}"


def test_join_invalid_instance(founder):
    time.sleep(2.0)
    r = founder.post(f"{BASE_URL}/api/nexus/join",
                     json={"instance_id": "fake-xyz"}, timeout=15)
    assert r.status_code == 409, f"expected 409 got {r.status_code} {r.text[:200]}"


# --- /invite ---
def test_invite_create_and_join(founder):
    time.sleep(2.0)
    r = founder.post(f"{BASE_URL}/api/nexus/invite",
                     json={"instance_id": "public-1"}, timeout=15)
    assert r.status_code == 200, r.text[:200]
    d = r.json()
    tok = d.get("invite")
    assert tok and len(tok) >= 32, f"weak/missing token: {d}"
    assert d.get("expires_in") == 900, d

    time.sleep(2.0)
    j = founder.post(f"{BASE_URL}/api/nexus/join",
                    json={"invite": tok}, timeout=15)
    assert j.status_code == 200, j.text[:200]
    jd = j.json()
    assert jd.get("instance_id") == "public-1", jd


def test_invite_garbage_token(founder):
    time.sleep(2.0)
    r = founder.post(f"{BASE_URL}/api/nexus/join",
                     json={"invite": "garbage"}, timeout=15)
    assert r.status_code == 410, f"expected 410 got {r.status_code} {r.text[:200]}"


# --- /instances/realm ---
def test_realm_requires_accept_terms(founder):
    r = founder.post(f"{BASE_URL}/api/nexus/instances/realm",
                     json={"realm_slug": "test-realm-qa"}, timeout=15)
    assert r.status_code == 428, f"expected 428 got {r.status_code} {r.text[:200]}"


def test_realm_create_and_join(founder):
    r = founder.post(f"{BASE_URL}/api/nexus/instances/realm",
                     json={"realm_slug": "test-realm-qa", "accept_terms": True}, timeout=15)
    assert r.status_code == 200, r.text[:200]
    iid = r.json().get("instance_id")
    assert iid, r.json()

    time.sleep(2.0)
    j = founder.post(f"{BASE_URL}/api/nexus/join",
                    json={"realm_slug": "test-realm-qa"}, timeout=15)
    assert j.status_code == 200, j.text[:200]
    jd = j.json()
    assert jd.get("reason") in ("realm", "realm_join", "invited") or "realm" in str(jd.get("reason", "")).lower(), jd


def test_realm_non_founder_forbidden(buddy):
    r = buddy.post(f"{BASE_URL}/api/nexus/instances/realm",
                   json={"realm_slug": "test-realm-buddy", "accept_terms": True}, timeout=15)
    assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text[:200]}"


# --- /party/reserve ---
def test_party_reserve_valid(founder):
    r = founder.post(f"{BASE_URL}/api/nexus/party/reserve",
                     json={"instance_id": "public-1", "size": 3}, timeout=15)
    assert r.status_code == 200, r.text[:200]
    d = r.json()
    assert d.get("reservation_id") and d.get("instance_id") == "public-1", d


def test_party_reserve_oversize_clamped_or_409(founder):
    r = founder.post(f"{BASE_URL}/api/nexus/party/reserve",
                     json={"instance_id": "public-1", "size": 99}, timeout=15)
    # code clamps to 8 → 200, OR could raise 409
    assert r.status_code in (200, 409), f"got {r.status_code} {r.text[:200]}"


# --- /presence/friends ---
def test_presence_friends(founder):
    r = founder.get(f"{BASE_URL}/api/nexus/presence/friends", timeout=15)
    assert r.status_code == 200, r.text[:200]
    d = r.json()
    assert "friends" in d and isinstance(d["friends"], list), d
