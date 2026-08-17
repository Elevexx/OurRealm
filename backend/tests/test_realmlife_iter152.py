"""RealmLife independent avatar system (iter152).

Coverage:
 - GET /realmlife/player catalog & fire_balance
 - Non-founder create profile, customize, unlock idempotency, select (403 if not unlocked)
 - Founder /realmlife/avatar returns founder GLB when selected_avatar=founder_stealth,
   returns mode='starter' after switching, restores founder GLB after switching back
 - Independence: RealmLife select must NOT modify users.nexus_avatar_id
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
GAME_ID = "realmlife-home-v1"
RL = f"{BASE_URL}/api/games/{GAME_ID}/realmlife"


def _login(username: str, password: str):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {username}: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in {r.json()}"
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def founder_h():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def nonfounder_h():
    # Try existing auditcheckreal, fall back to registering
    try:
        return _login("auditcheckreal", "Password1$")
    except AssertionError:
        u = "TEST_rl_" + uuid.uuid4().hex[:8]
        r = requests.post(f"{BASE_URL}/api/auth/register", json={
            "username": u, "email": f"{u}@example.com", "password": "Password1$",
            "accepted_terms": True, "accepted_conditions": True,
            "accepted_privacy": True, "age_confirmed_13": True}, timeout=15)
        assert r.status_code in (200, 201), r.text[:300]
        return _login(u, "Password1$")


# ---------- catalog ----------

def test_player_state_catalog(nonfounder_h):
    r = requests.get(f"{RL}/player", headers=nonfounder_h, timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    cat = data["catalog"]
    assert len(cat["accessories"]) == 7
    assert len(cat["avatar_tiers"]) == 6
    fps = [t["fire_power_required"] for t in cat["avatar_tiers"]]
    assert fps == [1000, 5000, 10000, 25000, 50000, 100000]
    assert isinstance(data["fire_balance"], int)
    assert "unlocks" in data


# ---------- non-founder flow ----------

def test_nonfounder_create_customize_unlock_select(nonfounder_h):
    # create
    r = requests.post(f"{RL}/player", headers=nonfounder_h,
                      json={"style": "style_a", "custom": {}}, timeout=15)
    assert r.status_code == 200, r.text[:300]
    player = r.json()["player"]
    assert player["selected_avatar"] == "starter"
    assert player["style"] == "style_a"

    # customize colors
    r = requests.put(f"{RL}/player/customize", headers=nonfounder_h,
                     json={"custom": {"skin": "#a9713f", "hair_color": "#000000",
                                       "shirt_color": "#ff0000"}}, timeout=15)
    assert r.status_code == 200
    assert r.json()["player"]["custom"]["skin"] == "#a9713f"
    assert r.json()["player"]["custom"]["shirt_color"] == "#ff0000"

    # unlock cap (100 FP) — either 200 (burned/already) or 402 if insufficient
    r = requests.post(f"{RL}/player/unlock", headers=nonfounder_h,
                      json={"item_id": "cap"}, timeout=15)
    assert r.status_code in (200, 402), r.text[:300]
    if r.status_code == 402:
        # PASS per problem spec — wording must include Fire Power
        detail = str(r.json().get("detail") or "")
        assert "Fire Power" in detail, f"402 detail should mention Fire Power: {detail}"
    else:
        body = r.json()
        # idempotency: second unlock returns already_unlocked, no double burn
        r2 = requests.post(f"{RL}/player/unlock", headers=nonfounder_h,
                           json={"item_id": "cap"}, timeout=15)
        assert r2.status_code == 200
        assert r2.json().get("already_unlocked") is True

    # select premium avatar not unlocked -> 403
    r = requests.post(f"{RL}/player/select", headers=nonfounder_h,
                      json={"avatar_id": "rl_epic"}, timeout=15)
    assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text[:200]}"


# ---------- founder ----------

def _get_user(headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=15)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def test_founder_avatar_switching(founder_h):
    # ensure profile exists
    requests.post(f"{RL}/player", headers=founder_h,
                  json={"style": "style_a", "custom": {}}, timeout=15)
    # switch to founder_stealth
    r = requests.post(f"{RL}/player/select", headers=founder_h,
                      json={"avatar_id": "founder_stealth"}, timeout=15)
    assert r.status_code == 200, r.text[:300]

    # capture nexus avatar id before switching
    me_before = _get_user(founder_h)
    nexus_before = me_before.get("nexus_avatar_id")

    # GET /realmlife/avatar as founder returns model_url
    r = requests.get(f"{RL}/avatar", headers=founder_h, timeout=15)
    assert r.status_code == 200, r.text[:300]
    av = r.json()
    assert av.get("model_url"), f"founder should have model_url, got {av}"

    # switch RealmLife -> starter
    r = requests.post(f"{RL}/player/select", headers=founder_h,
                      json={"avatar_id": "starter"}, timeout=15)
    assert r.status_code == 200
    r = requests.get(f"{RL}/avatar", headers=founder_h, timeout=15)
    assert r.status_code == 200
    assert r.json().get("mode") == "starter", r.json()

    # independence: nexus_avatar_id must not have changed
    me_after = _get_user(founder_h)
    assert me_after.get("nexus_avatar_id") == nexus_before, (
        f"nexus_avatar_id changed! before={nexus_before} after={me_after.get('nexus_avatar_id')}")

    # switch back to founder_stealth -> model_url restored
    r = requests.post(f"{RL}/player/select", headers=founder_h,
                      json={"avatar_id": "founder_stealth"}, timeout=15)
    assert r.status_code == 200
    r = requests.get(f"{RL}/avatar", headers=founder_h, timeout=15)
    assert r.status_code == 200
    assert r.json().get("model_url"), "founder GLB should be restored"


def test_nonfounder_cannot_select_founder(nonfounder_h):
    requests.post(f"{RL}/player", headers=nonfounder_h,
                  json={"style": "style_a", "custom": {}}, timeout=15)
    r = requests.post(f"{RL}/player/select", headers=nonfounder_h,
                      json={"avatar_id": "founder_stealth"}, timeout=15)
    assert r.status_code == 403, r.text[:200]
