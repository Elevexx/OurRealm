"""Dragon Realm Phase 3&4 (Full World) backend tests — iteration 119.

Covers: state shape (6 regions/36 dragons/6 bosses/dragon_king multi_phase),
admin reset-progress, rate-limit, boss gates, full 6-region progression,
claim idempotency, dragon_king locked until all prior bosses defeated,
admin config with all 8 reward inputs.
"""
import os
import time
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL missing"
UA = {"User-Agent": "Mozilla/5.0 (T1-iter119)"}


def _login(email, password):
    return requests.post(f"{BASE}/api/auth/login",
                         json={"email": email, "password": password},
                         headers=UA, timeout=15)


@pytest.fixture(scope="module")
def founder_token():
    r = _login("stealth", "Password1$")
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def hdr(founder_token):
    return {**UA, "Authorization": f"Bearer {founder_token}"}


@pytest.fixture(scope="module")
def me():
    r = _login("stealth", "Password1$")
    assert r.status_code == 200
    body = r.json()
    u = body.get("user") or body
    if "id" not in u:
        # try /api/auth/me
        tok = body["access_token"]
        me_r = requests.get(f"{BASE}/api/auth/me",
                            headers={**UA, "Authorization": f"Bearer {tok}"}, timeout=15)
        u = me_r.json()
        u = u.get("user") or u
    assert "id" in u, f"cannot find id: {u}"
    return u


# ── state shape ────────────────────────────────────────────────────────
def test_state_full_world_shape(hdr):
    r = requests.get(f"{BASE}/api/dragon-realm/state", headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    c = d["content"]
    ro = c["region_order"]
    assert ro == ["enchanted_forest", "crystal_caverns", "sandsear_desert",
                  "frozen_peaks", "storm_isles", "dragonfall_castle"]
    assert len(c["regions"]) == 6
    total = sum(len(c["regions"][rid]["dragons"]) for rid in ro)
    assert total == 36, f"expected 36 dragons, got {total}"
    assert len(c["bosses"]) == 6
    king = c["bosses"]["dragon_king"]
    assert king.get("multi_phase") is True
    assert len(king.get("supports") or []) == 2
    # rewards config has 8 keys
    rc = d["rewards_config"]
    for k in ("quest_complete", "dragon_first_defeat", "boss_thornbeast",
              "boss_gemnasher", "boss_duneblaze", "boss_frostwyrm",
              "boss_skytitan", "boss_dragon_king"):
        assert k in rc, f"missing reward key {k}"
    assert "fire" in d and "vault" in d["fire"]


# ── reset (also clean-slate the founder for the rest of the suite) ─────
def test_admin_reset_requires_reason_and_uid(hdr):
    r = requests.post(f"{BASE}/api/dragon-realm/admin/reset-progress",
                      json={}, headers=hdr, timeout=15)
    assert r.status_code == 400


def test_admin_reset_stealth_clean_slate(hdr, me):
    r = requests.post(f"{BASE}/api/dragon-realm/admin/reset-progress",
                      json={"user_id": me["id"], "reason": "iter119 clean slate"},
                      headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    # verify trusted is empty
    s = requests.get(f"{BASE}/api/dragon-realm/state", headers=hdr, timeout=15).json()
    t = s["trusted"]
    assert t["discovered"] == []
    assert t["first_defeats"] == []
    assert t.get("bosses", {}) == {}
    assert t.get("rewards", {}) == {}


# ── event validation ───────────────────────────────────────────────────
def test_event_unknown_enemy_400(hdr):
    r = requests.post(f"{BASE}/api/dragon-realm/event",
                      json={"type": "battle_win", "enemy_id": "not_a_dragon"},
                      headers=hdr, timeout=15)
    assert r.status_code == 400


def test_event_locked_region_400(hdr):
    # crystal_caverns dragon: gemscale — forest boss not defeated yet (fresh reset)
    r = requests.post(f"{BASE}/api/dragon-realm/event",
                      json={"type": "battle_win", "enemy_id": "gemscale"},
                      headers=hdr, timeout=15)
    assert r.status_code == 400
    assert "locked" in r.text.lower()


def test_event_boss_win_pre_gate_400(hdr):
    r = requests.post(f"{BASE}/api/dragon-realm/event",
                      json={"type": "boss_win", "region": "enchanted_forest",
                            "enemy_id": "thornbeast"},
                      headers=hdr, timeout=15)
    assert r.status_code == 400
    assert "gate" in r.text.lower() or "locked" in r.text.lower()


def test_event_rate_limit(hdr):
    # rapid-fire 2 battle_wins on same enemy — 2nd should 400 'Too fast'
    time.sleep(5)  # ensure clean window
    r1 = requests.post(f"{BASE}/api/dragon-realm/event",
                       json={"type": "battle_win", "enemy_id": "emberling"},
                       headers=hdr, timeout=15)
    assert r1.status_code == 200, r1.text
    r2 = requests.post(f"{BASE}/api/dragon-realm/event",
                       json={"type": "battle_win", "enemy_id": "mossback"},
                       headers=hdr, timeout=15)
    assert r2.status_code == 400
    assert "too fast" in r2.text.lower() or "rate" in r2.text.lower()


# ── full 6-region progression via API ──────────────────────────────────
FOREST_DRAGONS = ["emberling", "mossback", "vinewing"]  # 3
BEFRIEND_TARGET = "leafscale"

REGION_PLAN = [
    ("enchanted_forest",  ["emberling", "mossback", "vinewing"], "thornbeast"),
    ("crystal_caverns",   ["gemscale", "shardwing", "prismtail"], "gemnasher"),
    ("sandsear_desert",   ["cinderjaw", "duneclaw", "ashwing"],  "duneblaze"),
    ("frozen_peaks",      ["snowfin", "icehorn", "glacierwing"], "frostwyrm"),
    ("storm_isles",       ["thunderclaw", "cloudwing", "voltfin"], "skytitan"),
    ("dragonfall_castle", ["ash_tyrant", "darkscale", "magmawing"], "dragon_king"),
]


def _post_event(hdr_, body):
    return requests.post(f"{BASE}/api/dragon-realm/event", json=body,
                         headers=hdr_, timeout=15)


def test_progress_all_regions_and_dragon_king_gate(hdr, me):
    # start from a clean slate again (previous rate-limit test recorded emberling)
    requests.post(f"{BASE}/api/dragon-realm/admin/reset-progress",
                  json={"user_id": me["id"], "reason": "iter119 progression"},
                  headers=hdr, timeout=15)
    time.sleep(5)

    for rid, dragons, boss in REGION_PLAN:
        # battle-win 3 dragons (>4s apart)
        for i, d in enumerate(dragons):
            time.sleep(5)
            r = _post_event(hdr, {"type": "battle_win", "enemy_id": d})
            assert r.status_code == 200, f"{rid}/{d}: {r.status_code} {r.text}"

        # forest requires a befriend
        if rid == "enchanted_forest":
            time.sleep(5)
            r = _post_event(hdr, {"type": "battle_befriend", "enemy_id": BEFRIEND_TARGET})
            assert r.status_code == 200, r.text

        # boss_win
        time.sleep(5)
        # Test dragon-king gate specifically: it should be REJECTED before
        # this iteration IF we haven't beaten storm_isles yet. But here we
        # arrive at castle only after storm_isles boss is done — the loop
        # sequences correctly. Instead we verified castle blockade earlier
        # via test_dragon_king_locked_until_all_bosses below.
        r = _post_event(hdr, {"type": "boss_win", "region": rid, "enemy_id": boss})
        assert r.status_code == 200, f"boss {rid}: {r.status_code} {r.text}"

    # verify state reflects all bosses defeated
    s = requests.get(f"{BASE}/api/dragon-realm/state", headers=hdr, timeout=15).json()
    t = s["trusted"]
    for rid, _, _ in REGION_PLAN:
        assert t["bosses"].get(rid) is True, f"{rid} boss not marked"
        assert t["quests"].get(rid) is True, f"{rid} quest not marked"

    # rewards created for boss_dragon_king
    assert "boss_dragon_king" in (t.get("rewards") or {})
    dk = t["rewards"]["boss_dragon_king"]
    assert dk["amount"] == s["rewards_config"]["boss_dragon_king"]
    assert dk["status"] == "unclaimed"


def test_dragon_king_locked_until_all_bosses(hdr, me):
    # fresh reset, unlock only the forest, try to boss_win castle → 400
    requests.post(f"{BASE}/api/dragon-realm/admin/reset-progress",
                  json={"user_id": me["id"], "reason": "iter119 king-gate"},
                  headers=hdr, timeout=15)
    time.sleep(5)
    for d in ["emberling", "mossback", "vinewing"]:
        time.sleep(5)
        assert _post_event(hdr, {"type": "battle_win", "enemy_id": d}).status_code == 200
    time.sleep(5)
    assert _post_event(hdr, {"type": "battle_befriend", "enemy_id": BEFRIEND_TARGET}).status_code == 200
    time.sleep(5)
    assert _post_event(hdr, {"type": "boss_win", "region": "enchanted_forest",
                             "enemy_id": "thornbeast"}).status_code == 200
    # castle dragons are LOCKED right now (crystal_caverns not beaten),
    # so try boss_win directly on castle → 400 (region locked or gate)
    time.sleep(5)
    r = _post_event(hdr, {"type": "boss_win", "region": "dragonfall_castle",
                          "enemy_id": "dragon_king"})
    assert r.status_code == 400
    assert ("locked" in r.text.lower() or "dragon king" in r.text.lower()
            or "every region boss" in r.text.lower())


# ── claim + idempotency ────────────────────────────────────────────────
def test_claim_and_idempotent_second_call(hdr, me):
    # Use the boss_dragon_king reward earned by test_progress_all_regions...
    # but since test_dragon_king_locked_until_all_bosses reset progress, replay full progression first.
    # For efficiency: reset + run FOREST only + claim thornbeast reward + replay.
    requests.post(f"{BASE}/api/dragon-realm/admin/reset-progress",
                  json={"user_id": me["id"], "reason": "iter119 claim-test"},
                  headers=hdr, timeout=15)
    time.sleep(5)
    for d in ["emberling", "mossback", "vinewing"]:
        time.sleep(5)
        assert _post_event(hdr, {"type": "battle_win", "enemy_id": d}).status_code == 200
    time.sleep(5)
    assert _post_event(hdr, {"type": "battle_befriend", "enemy_id": BEFRIEND_TARGET}).status_code == 200
    time.sleep(5)
    assert _post_event(hdr, {"type": "boss_win", "region": "enchanted_forest",
                             "enemy_id": "thornbeast"}).status_code == 200

    # balance before
    fire_before = requests.get(f"{BASE}/api/dragon-realm/state",
                               headers=hdr, timeout=15).json()["fire"]["vault"]

    # claim boss_thornbeast
    r = requests.post(f"{BASE}/api/dragon-realm/claim",
                      json={"reward_id": "boss_thornbeast"}, headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["amount"] == 100
    fire_after = body["fire"]["vault"]
    assert fire_after == fire_before + 100, f"vault delta: {fire_before}->{fire_after}"

    # second call → 400 Already claimed, no balance change
    r2 = requests.post(f"{BASE}/api/dragon-realm/claim",
                       json={"reward_id": "boss_thornbeast"}, headers=hdr, timeout=15)
    assert r2.status_code == 400
    assert "already" in r2.text.lower()
    fire_after2 = requests.get(f"{BASE}/api/dragon-realm/state",
                               headers=hdr, timeout=15).json()["fire"]["vault"]
    assert fire_after2 == fire_after, "double credit occurred!"


def test_claim_all_endpoint(hdr, me):
    # After previous test, quest_enchanted_forest + dragon_first_* still unclaimed
    r = requests.post(f"{BASE}/api/dragon-realm/claim-all", json={},
                      headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert isinstance(body["claimed"], list)
    # After claim-all, no unclaimed rewards remain
    s = requests.get(f"{BASE}/api/dragon-realm/state", headers=hdr, timeout=15).json()
    for rid, rec in (s["trusted"].get("rewards") or {}).items():
        assert rec["status"] == "claimed", f"{rid} still {rec['status']}"


# ── admin config with all 8 reward keys ────────────────────────────────
def test_admin_config_all_reward_keys_roundtrip(hdr):
    orig = requests.get(f"{BASE}/api/dragon-realm/admin/config",
                        headers=hdr, timeout=15).json()
    new_rewards = {k: v + 1 for k, v in orig["rewards"].items()}
    r = requests.put(f"{BASE}/api/dragon-realm/admin/config",
                     json={"rewards": new_rewards, "reason": "iter119 bump-all"},
                     headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    for k, v in new_rewards.items():
        assert r.json()["rewards"][k] == v
    # restore
    r2 = requests.put(f"{BASE}/api/dragon-realm/admin/config",
                      json={"rewards": orig["rewards"], "reason": "iter119 restore"},
                      headers=hdr, timeout=15)
    assert r2.status_code == 200
    for k, v in orig["rewards"].items():
        assert r2.json()["rewards"][k] == v
