"""Iter139 — WKQ Arcane Hearth 3D v1 backend regression.
- realm-keys registry has 3 active entries (level_index 0/1/2, level_no 1/3/5)
- award idempotent per level (throwaway user; cleanup its rows)
- fire-info enabled with rewards.completion=50, final_completion=250
- score submit stage_reached=1 grants "Stage 1 cleared" +50 once, then finale
  {stage_reached:3, completed:True} grants Stage 2 + Stage 3 + Game completed
  (+250); repeat call grants nothing. Uses stealth founder — cleans up its
  gfp:* fire_wallet_transactions and refunds fire_economy.pool after.
"""
import os
import uuid
import requests
import pytest
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
GAME_ID = "wkq-arcane-hearth-3d-v1"
FOUNDER = {"email": "stealth", "password": "Password1$"}

_client = MongoClient(os.environ["MONGO_URL"])
_db = _client[os.environ["DB_NAME"]]


def _login(sess, email, password):
    r = sess.post(f"{BASE}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    sess.headers.update({"Authorization": f"Bearer {tok}"})
    return r.json().get("user") or {}


@pytest.fixture(scope="module")
def founder():
    s = requests.Session()
    user = _login(s, FOUNDER["email"], FOUNDER["password"])
    s.founder_id = user.get("id")
    return s


@pytest.fixture(scope="module")
def throwaway():
    s = requests.Session()
    uname = f"arc{uuid.uuid4().hex[:8]}"
    email = f"{uname}@example.com"
    payload = {
        "username": uname, "email": email, "password": "Password1$",
        "name": "Arc Tester", "display_name": "Arc Tester",
        "accepted_terms": True, "accepted_conditions": True,
        "accepted_privacy": True, "age_confirmed_13": True,
    }
    r = s.post(f"{BASE}/api/auth/register", json=payload)
    assert r.status_code in (200, 201), f"register failed {r.status_code} {r.text}"
    user = _login(s, email, "Password1$")
    s.uid = user.get("id")
    s.uname = uname
    return s


# --- Registry ---
def test_registry_3_active_keys(founder):
    r = founder.get(f"{BASE}/api/realm-keys/registry", params={"game_id": GAME_ID})
    assert r.status_code == 200, r.text
    keys = r.json().get("keys") or []
    assert len(keys) == 3, [k.get("key_id") for k in keys]
    idxs = [k["level_index"] for k in keys]
    lnos = [k["level_no"] for k in keys]
    assert idxs == [0, 1, 2], idxs
    assert lnos == [1, 3, 5], lnos
    for k in keys:
        assert k["active"] is True
        assert k["game_id"] == GAME_ID


# --- Award idempotency (throwaway user) ---
def test_award_level0_idempotent(throwaway):
    r1 = throwaway.post(f"{BASE}/api/realm-keys/award",
                        json={"game_id": GAME_ID, "level_index": 0})
    assert r1.status_code == 200, r1.text
    d1 = r1.json()
    assert d1["awarded"] is True and d1["already_owned"] is False
    r2 = throwaway.post(f"{BASE}/api/realm-keys/award",
                        json={"game_id": GAME_ID, "level_index": 0})
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["awarded"] is False and d2["already_owned"] is True


@pytest.mark.parametrize("level", [1, 2])
def test_award_other_levels(throwaway, level):
    r = throwaway.post(f"{BASE}/api/realm-keys/award",
                       json={"game_id": GAME_ID, "level_index": level})
    assert r.status_code == 200
    assert r.json()["awarded"] is True


def test_award_invalid_level_404(throwaway):
    r = throwaway.post(f"{BASE}/api/realm-keys/award",
                       json={"game_id": GAME_ID, "level_index": 9})
    assert r.status_code == 404


# --- Fire info ---
def test_fire_info(founder):
    r = founder.get(f"{BASE}/api/games/{GAME_ID}/fire-info")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("enabled") is True, d
    rw = d.get("rewards") or {}
    assert int(rw.get("completion") or 0) == 50, rw
    assert int(rw.get("final_completion") or 0) == 250, rw


# --- Score submit — stage + finale grants; idempotency ---
def _wipe_founder_grants():
    """Clear any prior gfp:* transactions for founder+GAME_ID, refund pool."""
    founder_doc = _db.users.find_one({"username": "stealth"}, {"id": 1})
    fid = founder_doc["id"]
    rows = list(_db.fire_wallet_transactions.find(
        {"post_id": GAME_ID, "sender_id": "game_fire_pool", "user_id": fid}))
    refund = sum(int(r.get("amount") or 0) for r in rows)
    if rows:
        _db.fire_wallet_transactions.delete_many(
            {"post_id": GAME_ID, "sender_id": "game_fire_pool", "user_id": fid})
    if refund:
        _db.games.update_one({"id": GAME_ID},
                             {"$inc": {"fire_economy.pool": refund,
                                       "fire_economy.distributed": -refund}})
    # Also clear game_progress for this founder+game so "first completion"
    # branch behaves predictably.
    _db.game_progress.delete_many({"game_id": GAME_ID, "user_id": fid})
    return fid


def test_score_stage_and_finale_idempotent(founder):
    _wipe_founder_grants()
    # Stage 1 clear (not completed)
    r1 = founder.post(f"{BASE}/api/games/{GAME_ID}/score",
                      json={"score": 100, "completed": False,
                            "stage_reached": 1, "game_version": 2})
    assert r1.status_code == 200, r1.text
    fr1 = r1.json().get("fire_rewards") or []
    labels1 = [(g["label"], g["amount"]) for g in fr1]
    assert ("Stage 1 cleared", 50) in labels1, labels1
    # Repeat stage 1 — no new grant
    r1b = founder.post(f"{BASE}/api/games/{GAME_ID}/score",
                       json={"score": 100, "completed": False,
                             "stage_reached": 1, "game_version": 2})
    fr1b = r1b.json().get("fire_rewards") or []
    assert not any(g["label"] == "Stage 1 cleared" for g in fr1b), fr1b

    # Finale: stage 3 + completed
    r2 = founder.post(f"{BASE}/api/games/{GAME_ID}/score",
                      json={"score": 300, "completed": True,
                            "stage_reached": 3, "game_version": 2})
    assert r2.status_code == 200
    fr2 = r2.json().get("fire_rewards") or []
    labels2 = {g["label"]: g["amount"] for g in fr2}
    # Stage 1 was already granted, so only Stage 2 + Stage 3 + Game completed
    assert labels2.get("Stage 2 cleared") == 50, fr2
    assert labels2.get("Stage 3 cleared") == 50, fr2
    assert labels2.get("Game completed") == 250, fr2

    # Repeat finale — nothing new
    r3 = founder.post(f"{BASE}/api/games/{GAME_ID}/score",
                      json={"score": 300, "completed": True,
                            "stage_reached": 3, "game_version": 2})
    fr3 = r3.json().get("fire_rewards") or []
    assert fr3 == [], f"non-idempotent finale: {fr3}"


# --- Cleanup: run last (alphabetical zzz) ---
def test_zzz_cleanup(throwaway):
    # Wipe throwaway realm-key rows and its own game_scores/progress
    _db.user_realm_keys.delete_many({"user_id": throwaway.uid})
    # Wipe founder fire grants + reset progress
    _wipe_founder_grants()
    # sanity
    remaining = _db.user_realm_keys.count_documents({"user_id": throwaway.uid})
    assert remaining == 0
