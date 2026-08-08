"""Phase 1.5 backend tests — economy, holds/burns, exchange, ORAi policies.

No paid providers are called: quotes are pure math, the lifecycle test
endpoint drives the same atomic economy functions with a mock outcome.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
FOUNDER = {"email": "stealth", "password": "Password1$"}
MEMBER = {"email": "auditcheckreal", "password": "Password1$"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, r.text[:200]
    s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    return s


@pytest.fixture(scope="module")
def founder():
    return _login(FOUNDER)


@pytest.fixture(scope="module")
def member():
    return _login(MEMBER)


# ─── Formula: all 100 combinations ────────────────────────────────────────

def test_all_100_combinations(founder):
    g = founder.get(f"{API}/admin/gamemaker/pricing/preview", timeout=15).json()["grid"]
    for e in range(1, 11):
        for p in range(1, 11):
            assert g[e - 1][p - 1] == min(max(10 * (e + p), 20), 200)
    assert g[0][0] == 20 and g[0][9] == 110 and g[4][4] == 100 and g[9][9] == 200


def test_pricing_rule_versioning(founder):
    v0 = founder.get(f"{API}/admin/gamemaker/pricing", timeout=15).json()["rules"][0]["version"]
    r = founder.post(f"{API}/admin/gamemaker/pricing", json={"base_per_point": 12}, timeout=15)
    assert r.status_code == 200 and r.json()["rule"]["version"] == v0 + 1
    g = founder.get(f"{API}/admin/gamemaker/pricing/preview", timeout=15).json()
    assert g["rule_version"] == v0 + 1 and g["grid"][4][4] == 120
    # restore default
    founder.post(f"{API}/admin/gamemaker/pricing", json={"base_per_point": 10}, timeout=15)


# ─── Quote / hold / burn lifecycle (mocked outcome, real atomic functions) ─

def _setup_stars(founder, amount=500):
    founder.post(f"{API}/admin/resources/stars/adjust",
                 json={"username": "auditcheckreal", "amount": amount,
                       "reason": "phase1.5 test setup", "request_id": f"t15-{uuid.uuid4().hex}"},
                 timeout=15)
    founder.patch(f"{API}/admin/resources/stars",
                  json={"fire_equiv": 10, "build_eligible": True}, timeout=15)


def test_hold_burn_success_cycle_stars(founder):
    _setup_stars(founder)
    r = founder.post(f"{API}/admin/gamemaker/test-economy-cycle",
                     json={"username": "auditcheckreal", "resource": "stars",
                           "economy": 5, "ai_power": 5, "outcome": "success"}, timeout=20)
    assert r.status_code == 200, r.text[:300]
    t = r.json()
    assert t["quote"]["required_fire"] == 100
    assert t["quote"]["required_amount"] == 10  # ceil(100/10)
    assert t["hold"]["replay_returned_same"] is True  # no double hold
    assert t["balance_after_hold"] == t["balance_before"] - 10
    assert t["final_state"] == "burned"
    assert t["balance_final"] == t["balance_before"] - 10  # double-finalize did not re-burn


def test_hold_release_cycle_stars(founder):
    r = founder.post(f"{API}/admin/gamemaker/test-economy-cycle",
                     json={"username": "auditcheckreal", "resource": "stars",
                           "economy": 1, "ai_power": 1, "outcome": "return"}, timeout=20)
    t = r.json()
    assert t["quote"]["required_fire"] == 20 and t["quote"]["required_amount"] == 2
    assert t["release"]["first"] is True and t["release"]["second_noop"] is True
    assert t["final_state"] == "released"
    assert t["balance_final"] == t["balance_before"]  # full refund


def test_fire_hold_burn_and_reconciliation(founder):
    r = founder.post(f"{API}/admin/gamemaker/test-economy-cycle",
                     json={"username": "stealth", "resource": "fire",
                           "economy": 1, "ai_power": 1, "outcome": "success"}, timeout=20)
    t = r.json()
    assert t["quote"]["required_amount"] == 20
    assert t["balance_after_hold"] == t["balance_before"] - 20
    assert t["final_state"] == "burned"
    assert t["reconciliation"]["outstanding_vs_expected_ok"] is True
    assert t["reconciliation"]["orphaned_delta"] == 0


def test_fire_hold_release_restores_vault(founder):
    r = founder.post(f"{API}/admin/gamemaker/test-economy-cycle",
                     json={"username": "stealth", "resource": "fire",
                           "economy": 1, "ai_power": 1, "outcome": "return"}, timeout=20)
    t = r.json()
    assert t["balance_final"] == t["balance_before"]
    assert t["reconciliation"]["outstanding_vs_expected_ok"] is True


def test_insufficient_balance_blocks_hold(founder, member):
    founder.patch(f"{API}/admin/resources/gems",
                  json={"fire_equiv": 100, "build_eligible": True}, timeout=15)
    r = founder.post(f"{API}/admin/gamemaker/test-economy-cycle",
                     json={"username": "auditcheckreal", "resource": "gems",
                           "economy": 10, "ai_power": 10, "outcome": "success"}, timeout=20)
    assert r.status_code == 400 and "Not enough" in r.json()["detail"]


def test_quote_endpoint_founder(founder):
    r = founder.post(f"{API}/gamemaker/quote",
                     json={"idea": "a jungle platform quest", "style": "cartoon",
                           "runtime": "platformer", "economy": 3, "ai_power": 7,
                           "resource": "fire"}, timeout=15)
    assert r.status_code == 200, r.text[:300]
    q = r.json()["quote"]
    assert q["required_fire"] == 100 and q["required_amount"] == 100
    assert q["economy_tier"] == "Light" and q["power_tier"] == "Advanced"
    assert q["provider_estimate"] > 0 and q["rule_version"] >= 1


def test_member_quote_blocked_by_access(member):
    r = member.post(f"{API}/gamemaker/quote",
                    json={"idea": "x", "style": "cartoon", "runtime": "platformer",
                          "economy": 1, "ai_power": 1}, timeout=15)
    assert r.status_code == 403


# ─── Exchange ─────────────────────────────────────────────────────────────

def test_exchange_full_cycle(founder, member):
    founder.patch(f"{API}/admin/resources/stars", json={"fire_equiv": 10, "exchange_source": True}, timeout=15)
    founder.patch(f"{API}/admin/resources/coins", json={"fire_equiv": 5, "exchange_dest": True}, timeout=15)
    founder.post(f"{API}/admin/gamemaker/exchange-rules",
                 json={"pairs": [["stars", "coins"]], "min_amount": 1, "max_amount": 1000,
                       "fee_pct": 0, "frozen": False}, timeout=15)
    q = member.post(f"{API}/resources/exchange/quote",
                    json={"from": "stars", "to": "coins", "amount": 3}, timeout=15)
    assert q.status_code == 200, q.text[:300]
    quote = q.json()["quote"]
    assert quote["receive"] == 6  # 3*10 fire / 5 = 6 coins (floor)
    rid = f"tex-{uuid.uuid4().hex}"
    e1 = member.post(f"{API}/resources/exchange/execute",
                     json={"quote_id": quote["id"], "request_id": rid}, timeout=15)
    assert e1.status_code == 200, e1.text[:300]
    rec = e1.json()["exchange"]
    assert rec["burned"] == 3 and rec["received"] == 6
    # replay protection — same request_id returns same exchange, no double spend
    e2 = member.post(f"{API}/resources/exchange/execute",
                     json={"quote_id": quote["id"], "request_id": rid}, timeout=15)
    assert e2.status_code == 200 and e2.json()["exchange"].get("replayed") is True
    # quote reuse without idem is rejected (state already executed)
    e3 = member.post(f"{API}/resources/exchange/execute", json={"quote_id": quote["id"]}, timeout=15)
    assert e3.status_code == 400


def test_exchange_disallowed_pair_and_rounding(member):
    r = member.post(f"{API}/resources/exchange/quote",
                    json={"from": "coins", "to": "stars", "amount": 3}, timeout=15)
    assert r.status_code == 400  # reverse pair not enabled — no arbitrage loop
    r2 = member.post(f"{API}/resources/exchange/quote",
                     json={"from": "stars", "to": "coins", "amount": 0}, timeout=15)
    assert r2.status_code == 400


def test_exchange_frozen(founder, member):
    founder.post(f"{API}/admin/gamemaker/exchange-rules", json={"frozen": True}, timeout=15)
    r = member.post(f"{API}/resources/exchange/quote",
                    json={"from": "stars", "to": "coins", "amount": 1}, timeout=15)
    assert r.status_code == 400 and "unavailable" in r.json()["detail"].lower()
    founder.post(f"{API}/admin/gamemaker/exchange-rules", json={"frozen": False}, timeout=15)


# ─── ORAi policies ────────────────────────────────────────────────────────

def test_policy_listing_and_gating(founder, member):
    r = founder.get(f"{API}/admin/orai-access/policies", timeout=15)
    assert r.status_code == 200 and len(r.json()["policies"]) >= 10
    assert member.get(f"{API}/admin/orai-access/policies", timeout=15).status_code in (401, 403)


def test_policy_edit_version_and_rollback(founder):
    p1 = founder.patch(f"{API}/admin/orai-access/policies/image_generation",
                       json={"max_power": 7, "_note": "test"}, timeout=15).json()["policy"]
    assert p1["max_power"] == 7
    v_before = p1["version"] - 1
    rb = founder.post(f"{API}/admin/orai-access/policies/image_generation/rollback",
                      json={"version": v_before}, timeout=15)
    assert rb.status_code == 200 and rb.json()["policy"]["max_power"] == 10
    audit = founder.get(f"{API}/admin/orai-access/audit", timeout=15).json()["audit"]
    assert any(a["capability"] == "image_generation" for a in audit)


def test_policy_power_enforcement_on_quote(founder):
    founder.patch(f"{API}/admin/orai-access/policies/gamemaker_create",
                  json={"max_power": 10}, timeout=15)
    # founders bypass — but the endpoint still validates power range input path
    r = founder.post(f"{API}/gamemaker/quote",
                     json={"idea": "x", "style": "cartoon", "runtime": "platformer",
                           "economy": 1, "ai_power": 99}, timeout=15)
    assert r.status_code == 200 and r.json()["quote"]["ai_power"] == 10  # clamped


def test_rules_chat_requires_message(founder):
    assert founder.post(f"{API}/admin/orai-access/rules-chat", json={}, timeout=15).status_code == 400


# ─── Regression ───────────────────────────────────────────────────────────

def test_fire_wallet_unchanged_shape(founder):
    w = founder.get(f"{API}/fire/wallet", timeout=15)
    assert w.status_code == 200 and "vault_balance" in str(w.json())


def test_public_hub_still_open():
    r = requests.get(f"{API}/public/game-path/hub", timeout=15)
    assert r.status_code == 200 and len(r.json()["games"]) >= 20
