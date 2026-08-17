"""RealmLife iter154 - property authority, guest access levels, invite/evict cycle, chat, asset perf.

Covers review request TEST B/C/D/E/F + presence chat + asset perf.
IMPORTANT: never call destroy/leave/surrender on stealth or auditcheckreal.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
GAME_ID = "realmlife-home-v1"
RL = f"{BASE_URL}/api/games/{GAME_ID}/realmlife"

STEALTH_PROP = "property-000001"
AUDIT_PROP = "property-000002"


def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {username}: {r.status_code} {r.text[:200]}"
    j = r.json()
    tok = j.get("access_token") or j.get("token")
    uid = (j.get("user") or {}).get("id") or j.get("id")
    assert tok and uid, f"missing token/id in {j}"
    return {"Authorization": f"Bearer {tok}"}, uid


@pytest.fixture(scope="module")
def stealth():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def audit():
    return _login("auditcheckreal", "Password1$")


@pytest.fixture(scope="module")
def guest():
    """A throwaway guest account, NOT a household member of stealth."""
    for uname, pwd in [("tftwo", "pass1234"), ("tfthree", "pass1234")]:
        try:
            h, uid = _login(uname, pwd)
            return h, uid, uname
        except AssertionError:
            continue
    u = "tfguest_" + uuid.uuid4().hex[:6]
    r = requests.post(f"{BASE_URL}/api/auth/register", json={
        "username": u, "email": f"{u}@example.com", "password": "Password1$",
        "accepted_terms": True, "accepted_conditions": True,
        "accepted_privacy": True, "age_confirmed_13": True}, timeout=15)
    assert r.status_code in (200, 201), r.text[:300]
    h, uid = _login(u, "Password1$")
    return h, uid, u


# =========================================================
# TEST B: two owners' home anchors + spawn
# =========================================================
def test_b_founder_home_anchor(stealth):
    h, _ = stealth
    r = requests.get(f"{RL}/housing", headers=h, timeout=15)
    assert r.status_code == 200, r.text[:200]
    j = r.json()
    anchor = j.get("home_anchor") or {}
    assert anchor.get("founder") is True, f"stealth should be founder, got {anchor}"
    assert anchor.get("lot_seq") in (None, 0), f"founder lot_seq should be null/0, got {anchor}"

    rh = requests.get(f"{RL}/world/home", headers=h, timeout=15)
    assert rh.status_code == 200, rh.text[:200]
    spawn = rh.json().get("spawn") or {}
    assert abs(spawn.get("x", -999)) < 1.0, f"founder spawn x≈0 expected, got {spawn}"
    assert 15.0 < spawn.get("z", 0) < 20.0, f"founder z≈17.6 expected, got {spawn}"


def test_b_member_home_anchor(audit):
    h, _ = audit
    r = requests.get(f"{RL}/housing", headers=h, timeout=15)
    assert r.status_code == 200
    anchor = r.json().get("home_anchor") or {}
    assert anchor.get("lot_seq") == 2, f"auditcheckreal lot_seq=2 expected, got {anchor}"
    assert anchor.get("founder") in (False, None)
    assert abs(anchor.get("x", 0) - (-104)) < 2.0, f"anchor x=-104 expected, got {anchor}"

    rh = requests.get(f"{RL}/world/home", headers=h, timeout=15)
    assert rh.status_code == 200
    spawn = rh.json().get("spawn") or {}
    assert abs(spawn.get("x", 0) - anchor.get("x", 0)) < 2.0


# =========================================================
# TEST C: unauthorized access-check symmetric denial
# =========================================================
def test_c_audit_denied_stealth_property(audit):
    h, _ = audit
    r = requests.post(f"{RL}/property/access-check", headers=h,
                      json={"property_id": STEALTH_PROP}, timeout=15)
    assert r.status_code == 200, r.text[:200]
    j = r.json()
    assert j["allowed"] is False
    assert j["reason"] == "private_property", j
    la = j["level_access"]
    assert all(v is False for v in la.values()), la


def test_c_stealth_denied_audit_property(stealth):
    h, _ = stealth
    r = requests.post(f"{RL}/property/access-check", headers=h,
                      json={"property_id": AUDIT_PROP}, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["allowed"] is False
    assert j["reason"] == "private_property"
    assert all(v is False for v in j["level_access"].values())


# =========================================================
# TEST D + F: invite → guest access-check → evict cycle
# =========================================================
def test_d_invite_and_evict_cycle(stealth, guest):
    sh, _ = stealth
    gh, gid, guname = guest

    # Ensure guest is NOT a household member of stealth (skip if is)
    # First reset stealth guest-access to public so default is allowed
    r = requests.post(f"{RL}/property/guest-access", headers=sh,
                      json={"mode": "public"}, timeout=15)
    assert r.status_code == 200, r.text[:200]

    # Try to invite guest by user id
    r = requests.post(f"{RL}/property/invite", headers=sh,
                      json={"target_user_id": gid}, timeout=15)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    if j.get("already_household_member"):
        pytest.skip(f"guest {guname} is already stealth's household member; can't test invite")

    # Guest access-check → allowed=true, reason=temporary_guest, ground=true
    r = requests.post(f"{RL}/property/access-check", headers=gh,
                      json={"property_id": STEALTH_PROP}, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["allowed"] is True, j
    assert j["reason"] == "temporary_guest", j
    assert j["level_access"]["ground"] is True, j

    # Now stealth evicts
    r = requests.post(f"{RL}/property/evict", headers=sh,
                      json={"target_user_id": gid}, timeout=15)
    assert r.status_code == 200, r.text[:300]

    # Guest access-check → allowed=false
    r = requests.post(f"{RL}/property/access-check", headers=gh,
                      json={"property_id": STEALTH_PROP}, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["allowed"] is False, j
    assert j["reason"] == "private_property", j
    assert all(v is False for v in j["level_access"].values())


# =========================================================
# TEST E: guest-access modes (private, custom)
# =========================================================
def test_e_guest_access_modes(stealth, guest):
    sh, _ = stealth
    gh, gid, guname = guest

    # PRIVATE mode: invite guest then check all levels false
    r = requests.post(f"{RL}/property/guest-access", headers=sh,
                      json={"mode": "private"}, timeout=15)
    assert r.status_code == 200

    # Owner (stealth) access-check own → all-true regardless of mode
    r = requests.post(f"{RL}/property/access-check", headers=sh,
                      json={"property_id": STEALTH_PROP}, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["allowed"] is True
    assert j["is_household_member"] is True
    assert all(v is True for v in j["level_access"].values()), j

    # Invite guest again
    r = requests.post(f"{RL}/property/invite", headers=sh,
                      json={"target_user_id": gid}, timeout=15)
    assert r.status_code == 200, r.text[:300]
    if r.json().get("already_household_member"):
        pytest.skip("guest is household member; cannot test level_access")

    # Guest access-check → allowed=True but all levels false
    r = requests.post(f"{RL}/property/access-check", headers=gh,
                      json={"property_id": STEALTH_PROP}, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["allowed"] is True, j
    assert j["guest_access_mode"] == "private"
    assert all(v is False for v in j["level_access"].values()), j["level_access"]

    # CUSTOM mode: ground=true, second=false
    r = requests.post(f"{RL}/property/guest-access", headers=sh,
                      json={"mode": "custom",
                            "levels": {"ground": True, "second": False,
                                       "third": False, "b1": False,
                                       "b2": False, "b3": False}}, timeout=15)
    assert r.status_code == 200

    r = requests.post(f"{RL}/property/access-check", headers=gh,
                      json={"property_id": STEALTH_PROP}, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["allowed"] is True
    assert j["guest_access_mode"] == "custom"
    la = j["level_access"]
    assert la["ground"] is True, la
    assert la["second"] is False, la

    # Cleanup: reset to public and evict
    r = requests.post(f"{RL}/property/guest-access", headers=sh,
                      json={"mode": "public"}, timeout=15)
    assert r.status_code == 200
    requests.post(f"{RL}/property/evict", headers=sh,
                  json={"target_user_id": gid}, timeout=15)


# =========================================================
# CHAT: presence with chat field
# =========================================================
def test_chat_presence_broadcast(stealth, audit):
    sh, _ = stealth
    ah, _ = audit

    # audit posts presence WITH chat
    body = {"x": 0, "y": 0, "z": 20, "ry": 0,
            "location_type": "world",
            "chat": {"text": "hello world 👋", "id": "test1"}}
    r = requests.post(f"{RL}/world/presence", headers=ah, json=body, timeout=15)
    assert r.status_code == 200, r.text[:300]

    # stealth posts presence WITHOUT chat, near audit
    body2 = {"x": 0, "y": 0, "z": 21, "ry": 0, "location_type": "world"}
    r = requests.post(f"{RL}/world/presence", headers=sh, json=body2, timeout=15)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    assert "server_ts" in j, j
    others = j.get("others") or []
    # Find audit user via chat_id
    match = [o for o in others if o.get("chat_id") == "test1"]
    assert match, f"expected audit's chat in others: {[o.get('chat_id') for o in others]}"
    o = match[0]
    assert o.get("chat_text") == "hello world 👋"
    assert o.get("chat_ts")


def test_chat_truncation_to_200(audit):
    ah, _ = audit
    long_text = "A" * 250
    body = {"x": 0, "y": 0, "z": 22, "ry": 0,
            "location_type": "world",
            "chat": {"text": long_text, "id": "trunc1"}}
    r = requests.post(f"{RL}/world/presence", headers=ah, json=body, timeout=15)
    assert r.status_code == 200

    # Another user reads to verify truncation
    # Use stealth to read audit's chat
    h, _ = _login("stealth", "Password1$")
    r = requests.post(f"{RL}/world/presence", headers=h,
                      json={"x": 0, "y": 0, "z": 23, "ry": 0,
                            "location_type": "world"}, timeout=15)
    assert r.status_code == 200
    others = r.json().get("others") or []
    match = [o for o in others if o.get("chat_id") == "trunc1"]
    if not match:
        pytest.skip("audit chat not visible from stealth position (range) — cannot verify truncation")
    assert len(match[0].get("chat_text", "")) == 200


# =========================================================
# ASSET PERF: optimized GLBs
# =========================================================
@pytest.mark.parametrize("fname,min_kb,max_kb", [
    ("698bcea39a7e273b446da21a6580a30a_game.glb", 1500, 3500),
    ("8787f255e4c1d0db42460c66bdc1bafc_game.glb", 1500, 3500),
])
def test_asset_optimized_glb(fname, min_kb, max_kb):
    url = f"{BASE_URL}/api/media/models/{fname}"
    r = requests.get(url, timeout=30)
    assert r.status_code == 200, f"{url}: {r.status_code}"
    size_kb = len(r.content) / 1024
    assert min_kb <= size_kb <= max_kb, f"{fname}: {size_kb:.0f}KB not in [{min_kb},{max_kb}]"
