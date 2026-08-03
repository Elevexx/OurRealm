"""Polish-phase backend tests: fire economy, score idempotency, claim, controls, diversity, fire-info gating."""
import os
import time
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip().rstrip("/")

FOUNDER = {"email": "stealth", "password": "Password1$"}
USER = {"email": "tftwo", "password": "pass1234"}

GAL_SAL = "d36d0d0472054c5ab6da438d0bc8f865"        # Galaxy Salvager (founder-owned test target for economy PATCH + diversity clash)
CRYSTAL = "850b4ee4b6ed48899229355aa86d5e9a"        # Crystal Caverns (fresh score idempotency)
CYBER   = "af6cab00d0d2406892d8bcb0b419e234"        # Cyber Heist


def _game_version(headers, gid):
    r = requests.get(f"{BASE}/api/games/{gid}", headers=headers, timeout=10).json()
    return (r.get("game") or {}).get("version", 0)


def _cancel_estimate(headers, est_id):
    return requests.post(f"{BASE}/api/admin/games/estimate/{est_id}/cancel", headers=headers, timeout=15)


def _login(cred):
    r = requests.post(f"{BASE}/api/auth/login", json=cred, timeout=15)
    assert r.status_code == 200, f"login failed for {cred['email']}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def founder_h():
    return {"Authorization": f"Bearer {_login(FOUNDER)}"}


@pytest.fixture(scope="module")
def user_h():
    return {"Authorization": f"Bearer {_login(USER)}"}


# ---------------- Fire Economy (founder admin) ----------------
class TestFireEconomy:
    def test_get_fire_economy(self, founder_h):
        r = requests.get(f"{BASE}/api/admin/games/{GAL_SAL}/fire-economy", headers=founder_h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "economy" in d and "preview" in d and "analytics" in d
        assert d["economy"].get("enabled") is True
        assert d["economy"].get("pool_initial", 0) > 0

    def test_patch_rewards_bumps_version(self, founder_h):
        v0 = _game_version(founder_h, GAL_SAL)
        r = requests.patch(f"{BASE}/api/admin/games/{GAL_SAL}/fire-economy",
                           headers=founder_h, json={"rewards": {"completion": 12}}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["economy"]["rewards"]["completion"] == 12
        v1 = _game_version(founder_h, GAL_SAL)
        assert v1 > v0, f"version did not bump {v0}->{v1}"
        # restore
        requests.patch(f"{BASE}/api/admin/games/{GAL_SAL}/fire-economy",
                       headers=founder_h, json={"rewards": {"completion": 10}}, timeout=15)

    def test_patch_refill_and_reset(self, founder_h):
        before = requests.get(f"{BASE}/api/admin/games/{GAL_SAL}/fire-economy", headers=founder_h).json()
        pool_before = before["economy"]["pool"]
        r = requests.patch(f"{BASE}/api/admin/games/{GAL_SAL}/fire-economy",
                           headers=founder_h, json={"action": "refill"}, timeout=15)
        assert r.status_code == 200, r.text
        pool_after = r.json()["economy"]["pool"]
        assert pool_after >= pool_before

        r2 = requests.patch(f"{BASE}/api/admin/games/{GAL_SAL}/fire-economy",
                            headers=founder_h, json={"action": "reset"}, timeout=15)
        assert r2.status_code == 200, r2.text
        eco = r2.json()["economy"]
        assert eco["pool"] == eco["pool_initial"]


# ---------------- Score idempotency + pool decrement ----------------
class TestScoreIdempotency:
    def test_score_submit_then_idempotent(self, founder_h, user_h):
        eco0 = requests.get(f"{BASE}/api/admin/games/{CRYSTAL}/fire-economy", headers=founder_h).json()["economy"]
        pool0 = eco0["pool"]

        payload = {"score": 150, "completed": True, "time_s": 250, "stage_reached": 2, "no_damage": False}
        r1 = requests.post(f"{BASE}/api/games/{CRYSTAL}/score", headers=user_h, json=payload, timeout=15)
        assert r1.status_code in (200, 201), r1.text
        d1 = r1.json()
        rewards1 = d1.get("fire_rewards", [])
        print("First submit fire_rewards:", rewards1)
        # may be empty if user already submitted previously; capture and continue
        granted1 = sum(x.get("amount", 0) for x in rewards1)

        r2 = requests.post(f"{BASE}/api/games/{CRYSTAL}/score", headers=user_h, json=payload, timeout=15)
        assert r2.status_code in (200, 201), r2.text
        rewards2 = r2.json().get("fire_rewards", [])
        assert rewards2 == [] or sum(x.get("amount", 0) for x in rewards2) == 0, \
            f"Second identical submit should be idempotent, got {rewards2}"

        eco1 = requests.get(f"{BASE}/api/admin/games/{CRYSTAL}/fire-economy", headers=founder_h).json()["economy"]
        pool1 = eco1["pool"]
        assert pool0 - pool1 == granted1, f"pool decrement mismatch: {pool0}-{pool1} != {granted1}"


# ---------------- Claim flow ----------------
class TestClaim:
    def test_wallet_and_collect(self, user_h):
        r = requests.get(f"{BASE}/api/fire/wallet", headers=user_h, timeout=15)
        assert r.status_code == 200, r.text
        w = r.json()
        cb = w.get("collectable_balance", 0)
        print("collectable_balance:", cb, "vault:", w.get("vault_balance"))
        if cb <= 0:
            pytest.skip("no collectable balance to claim (already claimed in earlier run)")
        vault0 = w.get("vault_balance", 0)
        r2 = requests.post(f"{BASE}/api/fire/wallet/collect", headers=user_h, json={"collect_all": True}, timeout=15)
        assert r2.status_code == 200, r2.text
        w2 = requests.get(f"{BASE}/api/fire/wallet", headers=user_h).json()
        assert w2["vault_balance"] >= vault0 + cb - 1  # allow rounding
        assert w2.get("collectable_balance", 0) == 0


# ---------------- Controls ----------------
class TestControls:
    def test_get_controls(self, founder_h):
        r = requests.get(f"{BASE}/api/admin/games/{GAL_SAL}/controls", headers=founder_h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "controls" in d and "runtime_actions" in d and "touch_layout_default" in d

    def test_keyboard_conflict_400(self, founder_h):
        r = requests.patch(f"{BASE}/api/admin/games/{GAL_SAL}/controls", headers=founder_h,
                           json={"keyboard_map": {"left": ["a"], "right": ["a"]}}, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_both_disabled_400(self, founder_h):
        r = requests.patch(f"{BASE}/api/admin/games/{GAL_SAL}/controls", headers=founder_h,
                           json={"desktop_enabled": False, "mobile_enabled": False}, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_left_handed_toggle_bumps_version(self, founder_h):
        v0 = _game_version(founder_h, GAL_SAL)
        r = requests.patch(f"{BASE}/api/admin/games/{GAL_SAL}/controls", headers=founder_h,
                           json={"left_handed": True}, timeout=15)
        assert r.status_code == 200, r.text
        v1 = _game_version(founder_h, GAL_SAL)
        assert v1 > v0
        # restore
        requests.patch(f"{BASE}/api/admin/games/{GAL_SAL}/controls", headers=founder_h,
                       json={"left_handed": False}, timeout=15)


# ---------------- Diversity block ----------------
class TestDiversity:
    def test_similar_estimate_blocks_build(self, founder_h):
        req = ("A space flight survival game piloting a spaceship through debris "
               "collecting salvage cores dodging asteroid mines")
        r = requests.post(f"{BASE}/api/admin/games/estimate", headers=founder_h,
                          json={"request": req, "complexity": 8, "ai_power": 7}, timeout=120)
        assert r.status_code == 200, r.text
        est = r.json().get("estimate") or r.json()
        est_id = est.get("id")
        sim = (est.get("plan") or {}).get("showcase_similarity") or {}
        print("similar estimate sim:", sim, "est_id:", est_id)
        try:
            assert sim.get("blocked") is True, f"expected blocked=true, got {sim}"
            b = requests.post(f"{BASE}/api/admin/games/estimate/{est_id}/build", headers=founder_h, timeout=30)
            assert b.status_code == 400, f"expected 400 build reject, got {b.status_code}: {b.text}"
            assert "Showcase Diversity" in b.text or "diversity" in b.text.lower()
        finally:
            if est_id:
                _cancel_estimate(founder_h, est_id)

    def test_different_estimate_not_blocked(self, founder_h):
        req = "a memory matching card game about ocean animals"
        r = requests.post(f"{BASE}/api/admin/games/estimate", headers=founder_h,
                          json={"request": req, "complexity": 3, "ai_power": 5}, timeout=120)
        assert r.status_code == 200, r.text
        est = r.json().get("estimate") or r.json()
        est_id = est.get("id")
        sim = (est.get("plan") or {}).get("showcase_similarity") or {}
        print("diff estimate sim:", sim)
        try:
            assert sim.get("blocked") is False, f"expected blocked=false, got {sim}"
        finally:
            if est_id:
                _cancel_estimate(founder_h, est_id)


# ---------------- Fire info gating (public) ----------------
class TestFireInfoGating:
    def test_fire_info_enabled_then_paused(self, founder_h, user_h):
        r = requests.get(f"{BASE}/api/games/{CRYSTAL}/fire-info", headers=user_h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("enabled") is True
        assert "pool_remaining" in d and "rewards" in d

        # pause
        p = requests.patch(f"{BASE}/api/admin/games/{CRYSTAL}/fire-economy", headers=founder_h,
                           json={"paused": True}, timeout=15)
        assert p.status_code == 200, p.text
        try:
            r2 = requests.get(f"{BASE}/api/games/{CRYSTAL}/fire-info", headers=user_h, timeout=15)
            assert r2.status_code == 200
            d2 = r2.json()
            assert d2.get("enabled") is False
            msg = d2.get("message") or ""
            assert "Fire Rewards Currently Disabled" in msg or "disabled" in msg.lower()
        finally:
            requests.patch(f"{BASE}/api/admin/games/{CRYSTAL}/fire-economy", headers=founder_h,
                           json={"paused": False}, timeout=15)
