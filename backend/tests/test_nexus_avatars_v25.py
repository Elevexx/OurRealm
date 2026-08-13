"""Nexus Avatar Collection (V25) — backend regression.

Covers:
 - GET /api/nexus/avatars/collection auth + shape + all 7 anim keys + fp order.
 - POST /api/nexus/avatars/{id}/unlock atomic burn + idempotent.
 - Insufficient balance → 402, no balance mutation.
 - Unknown avatar → 404.
 - POST /api/nexus/avatars/select premium not owned → 403.
 - After unlock, select works and collection shows equipped=true.
 - Concurrency: two parallel unlocks → single burn.
 - /api/nexus/join + /api/nexus/public smoke after v25.
"""
import asyncio
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

TEST_USER = {"email": "auditcheckreal", "password": "Password1$"}
FP_ORDER = [
    ("av_streetwear", 1000),
    ("av_tech_operative", 5000),
    ("av_realm_guardian", 10000),
    ("av_aether_champion", 25000),
    ("av_arcane_sovereign", 50000),
    ("av_void_wizard", 100000),
]
ANIM_KEYS = {"idle", "walk", "run", "jump", "fall", "land", "greet"}


# ---------- fixtures ----------
def _seed_wallet_and_clear(vault_balance=6500):
    """Reset test user's wallet + unlocks + selected avatar directly in Mongo."""
    import pymongo
    client = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db = client[os.environ.get("DB_NAME", "test_database")]
    u = db.users.find_one({"username": "auditcheckreal"}, {"id": 1})
    assert u, "auditcheckreal user missing"
    uid = u["id"]
    db.fire_wallets.update_one({"user_id": uid}, {"$set": {"vault_balance": vault_balance}}, upsert=True)
    db.nexus_avatar_unlocks.delete_many({"user_id": uid})
    db.users.update_one({"id": uid}, {"$unset": {"nexus_avatar_id": ""}})
    client.close()
    return uid


def _current_balance(uid):
    import pymongo
    client = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db = client[os.environ.get("DB_NAME", "test_database")]
    w = db.fire_wallets.find_one({"user_id": uid}, {"vault_balance": 1})
    client.close()
    return (w or {}).get("vault_balance")


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json=TEST_USER, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def sess(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture
def fresh_wallet():
    """Reset wallet + unlocks before each test that needs a clean slate."""
    return _seed_wallet_and_clear(6500)


# ---------- tests ----------
class TestCollection:
    def test_requires_auth(self):
        r = requests.get(f"{API}/nexus/avatars/collection", timeout=15)
        assert r.status_code in (401, 403)

    def test_returns_all_six_in_order(self, sess, fresh_wallet):
        r = sess.get(f"{API}/nexus/avatars/collection", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["fire_balance"] == 6500
        avs = data["avatars"]
        assert len(avs) == 6
        got = [(a["id"], a["fp_cost"]) for a in avs]
        assert got == FP_ORDER, f"order mismatch: {got}"
        for a in avs:
            assert a["available"] is True, f"{a['id']} not available"
            assert set(a.get("animation_urls", {}).keys()) >= ANIM_KEYS, f"{a['id']} missing anims: {set(a.get('animation_urls', {}).keys())}"
            assert a.get("lod_urls"), f"{a['id']} lod_urls missing"
            assert a.get("thumb"), f"{a['id']} thumb missing"


class TestUnlock:
    def test_unlock_streetwear_burns_and_idempotent(self, sess, fresh_wallet):
        uid = fresh_wallet
        # first unlock
        r1 = sess.post(f"{API}/nexus/avatars/av_streetwear/unlock", timeout=30)
        assert r1.status_code == 200, r1.text
        j1 = r1.json()
        assert j1.get("ok") is True
        assert j1.get("burned") == 1000
        assert "tx_id" in j1
        assert _current_balance(uid) == 5500

        # repeat → idempotent, no double burn
        r2 = sess.post(f"{API}/nexus/avatars/av_streetwear/unlock", timeout=30)
        assert r2.status_code == 200, r2.text
        j2 = r2.json()
        assert j2.get("already_unlocked") is True
        assert _current_balance(uid) == 5500

    def test_insufficient_balance_returns_402(self, sess, fresh_wallet):
        uid = fresh_wallet
        # burn streetwear first to leave 5500
        sess.post(f"{API}/nexus/avatars/av_streetwear/unlock", timeout=30)
        assert _current_balance(uid) == 5500
        r = sess.post(f"{API}/nexus/avatars/av_realm_guardian/unlock", timeout=30)
        assert r.status_code == 402, r.text
        assert _current_balance(uid) == 5500  # unchanged

    def test_unknown_avatar_404(self, sess):
        r = sess.post(f"{API}/nexus/avatars/av_unknown/unlock", timeout=15)
        assert r.status_code == 404


class TestSelect:
    def test_select_locked_premium_returns_403(self, sess, fresh_wallet):
        r = sess.post(f"{API}/nexus/avatars/select", json={"id": "av_realm_guardian"}, timeout=15)
        assert r.status_code == 403, r.text

    def test_select_unlocked_then_collection_equipped(self, sess, fresh_wallet):
        # unlock streetwear then select
        r = sess.post(f"{API}/nexus/avatars/av_streetwear/unlock", timeout=30)
        assert r.status_code == 200
        r = sess.post(f"{API}/nexus/avatars/select", json={"id": "av_streetwear"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        r = sess.get(f"{API}/nexus/avatars/collection", timeout=30)
        assert r.status_code == 200
        avs = {a["id"]: a for a in r.json()["avatars"]}
        assert avs["av_streetwear"]["equipped"] is True
        assert avs["av_streetwear"]["unlocked"] is True


class TestConcurrency:
    def test_parallel_unlock_single_burn(self, sess, token, fresh_wallet):
        uid = _seed_wallet_and_clear(5500)  # exact affordable amount for tech_operative (5000)
        # Fire two parallel POSTs with independent sessions but same token
        import concurrent.futures as cf
        url = f"{API}/nexus/avatars/av_tech_operative/unlock"
        headers = {"Authorization": f"Bearer {token}"}
        def _do():
            return requests.post(url, headers=headers, timeout=30)
        with cf.ThreadPoolExecutor(max_workers=2) as ex:
            f1 = ex.submit(_do)
            f2 = ex.submit(_do)
            r1, r2 = f1.result(), f2.result()
        codes = sorted([r1.status_code, r2.status_code])
        # Exactly one 200 with burn + one either idempotent 200 or 402
        assert 200 in codes
        # Balance must be exactly 500 (single burn of 5000)
        bal = _current_balance(uid)
        assert bal == 500, f"expected 500, got {bal}. codes={codes} bodies={r1.text} | {r2.text}"
        # Unlock doc count must be 1
        import pymongo
        client = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = client[os.environ.get("DB_NAME", "test_database")]
        cnt = db.nexus_avatar_unlocks.count_documents({"user_id": uid, "avatar_id": "av_tech_operative"})
        client.close()
        assert cnt == 1, f"expected exactly 1 unlock doc, got {cnt}"


class TestWorldSmoke:
    def test_public(self):
        r = requests.get(f"{API}/nexus/public", timeout=15)
        assert r.status_code == 200
        assert "zones" in r.json()

    def test_join_smoke(self, sess):
        r = sess.post(f"{API}/nexus/join", json={}, timeout=30)
        # 200 OK or 429 if rate limited by prior tests
        assert r.status_code in (200, 429), r.text
