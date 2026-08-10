"""Iter138 — WKQ Skybound v3 (3-stage) backend regression:
- Realm keys award/mine/registry (founder + throwaway user)
- fire-info final_completion = 10000
- score submit /complete grants gfp:final once (idempotent)
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
GAME_ID = "wkq-skybound-chef-v2"

FOUNDER = {"email": "stealth", "password": "Password1$"}


def _login(sess, email, password):
    r = sess.post(f"{BASE}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    sess.headers.update({"Authorization": f"Bearer {tok}"})
    return r.json().get("user") or {}


@pytest.fixture(scope="module")
def founder():
    s = requests.Session()
    _login(s, FOUNDER["email"], FOUNDER["password"])
    return s


@pytest.fixture(scope="module")
def throwaway():
    s = requests.Session()
    uname = f"rkq{uuid.uuid4().hex[:8]}"
    email = f"{uname}@example.com"
    payload = {
        "username": uname, "email": email, "password": "Password1$",
        "name": "Throwaway Tester", "display_name": "Throwaway Tester",
        "accepted_terms": True, "accepted_conditions": True,
        "accepted_privacy": True, "age_confirmed_13": True,
    }
    r = s.post(f"{BASE}/api/auth/register", json=payload)
    assert r.status_code in (200, 201), f"register failed {r.status_code} {r.text}"
    _login(s, email, "Password1$")
    s.headers["X-Test-Username"] = uname
    return s


# ---- Registry ----
def test_registry_lists_3_active_keys(founder):
    r = founder.get(f"{BASE}/api/realm-keys/registry", params={"game_id": GAME_ID})
    assert r.status_code == 200, r.text
    keys = r.json().get("keys") or []
    assert len(keys) == 3, f"expected 3 keys, got {len(keys)}: {[k.get('key_id') for k in keys]}"
    for k in keys:
        assert k.get("active") is True
        art = k.get("art") or {}
        assert art.get("runtime_url"), f"missing art.runtime_url on {k.get('key_id')}"
    # ordered by level_index
    idxs = [k["level_index"] for k in keys]
    assert idxs == sorted(idxs) == [0, 1, 2], idxs


# ---- Award: idempotent for each level ----
@pytest.mark.parametrize("level", [0, 1, 2])
def test_award_idempotent_per_level(throwaway, level):
    r1 = throwaway.post(f"{BASE}/api/realm-keys/award", json={"game_id": GAME_ID, "level_index": level})
    assert r1.status_code == 200, r1.text
    d1 = r1.json()
    assert d1["awarded"] is True
    assert d1["already_owned"] is False
    r2 = throwaway.post(f"{BASE}/api/realm-keys/award", json={"game_id": GAME_ID, "level_index": level})
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["awarded"] is False and d2["already_owned"] is True


def test_award_invalid_level_returns_404(throwaway):
    r = throwaway.post(f"{BASE}/api/realm-keys/award", json={"game_id": GAME_ID, "level_index": 7})
    assert r.status_code == 404, r.text


def test_mine_lists_owned_keys(throwaway):
    r = throwaway.get(f"{BASE}/api/realm-keys/mine")
    assert r.status_code == 200
    keys = r.json().get("keys") or []
    # After param tests above ran, throwaway should own 3
    assert len(keys) >= 3


# ---- Fire info ----
def test_fire_info_final_10000(founder):
    r = founder.get(f"{BASE}/api/games/{GAME_ID}/fire-info")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("enabled") is True, d
    rw = d.get("rewards") or {}
    assert int(rw.get("final_completion") or 0) == 10000, rw
    assert int(rw.get("completion") or 0) == 0, rw


# ---- Score submit — finale reward once ----
def test_complete_grants_final_once(founder):
    # Use founder (already has access). Idempotency key includes user_id, so if
    # founder already completed previously the first call may not grant. We
    # accept either (granted on first) OR (already granted previously).
    r1 = founder.post(f"{BASE}/api/games/{GAME_ID}/score",
                      json={"score": 1, "completed": True, "stage_reached": 3, "time_s": 60})
    assert r1.status_code == 200, r1.text
    fr1 = r1.json().get("fire_rewards") or []
    labels1 = [g.get("label") for g in fr1]
    # Second call must NOT re-grant "Game completed"
    r2 = founder.post(f"{BASE}/api/games/{GAME_ID}/score",
                      json={"score": 1, "completed": True, "stage_reached": 3, "time_s": 60})
    assert r2.status_code == 200
    fr2 = r2.json().get("fire_rewards") or []
    labels2 = [g.get("label") for g in fr2]
    assert "Game completed" not in labels2, f"non-idempotent finale: {fr2}"
    # If first call was itself repeat (founder already completed), OK. Otherwise
    # first call should have granted 10000.
    if "Game completed" in labels1:
        amt = next(g.get("amount") for g in fr1 if g.get("label") == "Game completed")
        assert int(amt) == 10000, fr1


# ---- Cleanup throwaway realm-key rows ----
def test_zzz_cleanup(throwaway):
    # best-effort — nothing critical if not present; leaving throwaway user rows
    # is fine since they are on a throwaway user_id.
    r = throwaway.get(f"{BASE}/api/realm-keys/mine")
    assert r.status_code == 200
