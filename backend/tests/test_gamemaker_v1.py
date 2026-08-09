"""V1 completion tests — wording regression, 13+ migration/validator,
cross-game gates (balance + burn + failure return + idempotency),
Continue Playing ordering/dedup, resource safeguards, reconciliation."""
import os
import re
import subprocess
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": "Password1$"}, timeout=15)
    assert r.status_code == 200, r.text[:200]
    s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    return s


@pytest.fixture(scope="module")
def founder():
    return _login("stealth")


@pytest.fixture(scope="module")
def member():
    return _login("auditcheckreal")


# ─── Prohibited public wording regression ────────────────────────────────

PROHIBITED = re.compile(
    r"\b(Pay with|Buy now|Purchase|Checkout|Wallet History|Economy & Pricing|"
    r"price:|pricing rule|payment required)\b", re.I)

WORDING_FILES = [
    "/app/frontend/src/pages/GameMakerPage.jsx",
    "/app/frontend/src/pages/GameMakerAdmin.jsx",
    "/app/frontend/src/components/fire/FireWalletCard.jsx",
    "/app/frontend/src/components/fire/ResourceBalances.jsx",
    "/app/frontend/src/components/games/GameGate.jsx",
    "/app/frontend/src/components/games/ContinuePlaying.jsx",
    "/app/backend/services/economy.py",
    "/app/backend/routers/fire.py",
]


def test_prohibited_wording_never_returns():
    hits = []
    for f in WORDING_FILES:
        for i, line in enumerate(open(f, encoding="utf-8"), 1):
            if PROHIBITED.search(line):
                hits.append(f"{f}:{i}: {line.strip()[:100]}")
    assert not hits, "Prohibited resource wording found:\n" + "\n".join(hits)


def test_api_responses_use_approved_wording(founder):
    cat = founder.get(f"{API}/gamemaker/catalog", timeout=15).text
    for bad in ("Pay with", "purchase", "checkout"):
        assert bad.lower() not in cat.lower()


# ─── 13+ migration + validator ───────────────────────────────────────────

def test_age_migration_dry_apply_idempotent():
    env = dict(os.environ)
    dry = subprocess.run(["python", "scripts/migrate_age_13.py"], cwd="/app/backend",
                         capture_output=True, text=True, env=env)
    assert dry.returncode == 0 and "dry" in dry.stdout
    ap = subprocess.run(["python", "scripts/migrate_age_13.py", "--apply"], cwd="/app/backend",
                        capture_output=True, text=True, env=env)
    assert ap.returncode == 0
    again = subprocess.run(["python", "scripts/migrate_age_13.py", "--apply"], cwd="/app/backend",
                           capture_output=True, text=True, env=env)
    assert "idempotent" in again.stdout or "0 games" in again.stdout or "needing 13+ normalization: 0" in again.stdout


def test_all_public_games_are_13_plus(founder):
    r = founder.get(f"{API}/games", timeout=30).json()
    bad = [g["title"] for g in r["games"] if g.get("age_rating") != "13+"]
    assert not bad, f"Published games without 13+: {bad}"


# ─── Continue Playing: dedupe + order + visibility ───────────────────────

def test_continue_playing_order_dedupe_visibility(founder):
    r = founder.get(f"{API}/games", timeout=30).json()
    mine = r["my_progress"]
    ids = [m["game_id"] for m in mine]
    assert len(ids) == len(set(ids)), "duplicate games in progress list"
    stamps = [m.get("last_played") or "" for m in mine]
    assert stamps == sorted(stamps, reverse=True), "not sorted by last_played desc"
    visible = {g["id"] for g in r["games"]}
    assert all(i in visible for i in ids), "progress exposes inaccessible games"


# ─── Resource admin safeguards ───────────────────────────────────────────

def test_registry_safeguards_block_prohibited_config(founder):
    r = founder.patch(f"{API}/admin/resources/gems", json={"transferable": True}, timeout=15)
    assert r.status_code == 400 and "closed-loop" in r.json()["detail"]
    r = founder.patch(f"{API}/admin/resources/gems", json={"cash_out": True}, timeout=15)
    assert r.status_code == 400
    r = founder.patch(f"{API}/admin/resources/gems", json={"per_user_cap": -5}, timeout=15)
    assert r.status_code == 400 and "negative" in r.json()["detail"]


# ─── Cross-game gates ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def gated_game(founder):
    g = founder.get(f"{API}/games", timeout=30).json()["games"][0]
    yield g["id"]
    founder.post(f"{API}/admin/resources/gates/{g['id']}", json={"remove": True}, timeout=15)
    # drain the member's test gems so other suites keep their balance assumptions
    bal = _member_balance(founder, "gems")
    if bal:
        founder.post(f"{API}/admin/resources/gems/adjust",
                     json={"username": "auditcheckreal", "amount": -bal,
                           "reason": "v1 gate test cleanup"}, timeout=15)


def _member_balance(founder, key):
    rows = founder.get(f"{API}/admin/resources/balances/auditcheckreal", timeout=15).json()["balances"]
    return next((b["balance"] for b in rows if b["key"] == key), 0)


def test_gate_validation(founder, gated_game):
    r = founder.post(f"{API}/admin/resources/gates/{gated_game}",
                     json={"gate_type": "burn", "resource_key": "fire", "amount": 5}, timeout=15)
    assert r.status_code == 400 and "ledger resources" in r.json()["detail"]
    r = founder.post(f"{API}/admin/resources/gates/{gated_game}",
                     json={"gate_type": "burn", "resource_key": "gems", "amount": 0}, timeout=15)
    assert r.status_code == 400
    r = founder.post(f"{API}/admin/resources/gates/{gated_game}",
                     json={"gate_type": "lottery", "resource_key": "gems", "amount": 5}, timeout=15)
    assert r.status_code == 400


def test_gate_balance_requirement(founder, member, gated_game):
    founder.post(f"{API}/admin/resources/gems/adjust",
                 json={"username": "auditcheckreal", "amount": 10, "reason": "v1 gate test seed"}, timeout=15)
    bal = _member_balance(founder, "gems")
    r = founder.post(f"{API}/admin/resources/gates/{gated_game}",
                     json={"gate_type": "balance", "resource_key": "gems", "amount": 5}, timeout=15)
    assert r.status_code == 200 and r.json()["gate"]["version"] >= 1
    st = member.get(f"{API}/resources/gates/{gated_game}", timeout=15).json()
    assert st["gate"]["gate_type"] == "balance" and st["satisfied"] is True
    # nothing burned by a balance gate
    assert _member_balance(founder, "gems") == bal
    # balance gates have nothing to unlock
    r = member.post(f"{API}/resources/gates/{gated_game}/unlock", json={}, timeout=15)
    assert r.status_code == 400 and "nothing to burn" in r.json()["detail"]


def test_gate_burn_unlock_idempotent_and_versioned(founder, member, gated_game):
    r = founder.post(f"{API}/admin/resources/gates/{gated_game}",
                     json={"gate_type": "burn", "resource_key": "gems", "amount": 3}, timeout=15)
    v2 = r.json()["gate"]
    assert v2["version"] >= 2, "gate versions must be immutable + incrementing"
    before = _member_balance(founder, "gems")
    st = member.get(f"{API}/resources/gates/{gated_game}", timeout=15).json()
    assert st["satisfied"] is False and st["gate"]["amount"] == 3
    rid = uuid.uuid4().hex
    r1 = member.post(f"{API}/resources/gates/{gated_game}/unlock", json={"request_id": rid}, timeout=15)
    assert r1.status_code == 200 and r1.json()["unlocked"]
    r2 = member.post(f"{API}/resources/gates/{gated_game}/unlock", json={"request_id": rid}, timeout=15)
    assert r2.status_code == 200 and r2.json()["replayed"] is True
    after = _member_balance(founder, "gems")
    assert before - after == 3, f"burned {before - after}, expected exactly 3 (idempotent)"
    st = member.get(f"{API}/resources/gates/{gated_game}", timeout=15).json()
    assert st["satisfied"] is True


def test_gate_insufficient_balance_returns_clean_error(founder, member, gated_game):
    founder.post(f"{API}/admin/resources/gates/{gated_game}",
                 json={"gate_type": "burn", "resource_key": "gems", "amount": 999999}, timeout=15)
    before = _member_balance(founder, "gems")
    r = member.post(f"{API}/resources/gates/{gated_game}/unlock",
                    json={"request_id": uuid.uuid4().hex}, timeout=15)
    assert r.status_code == 400 and "Insufficient" in r.json()["detail"]
    assert _member_balance(founder, "gems") == before, "failed unlock must not remove resources"


# ─── For You post idempotency (republish) ────────────────────────────────

def test_foryou_republish_idempotent(founder):
    g = None
    for row in founder.get(f"{API}/games", timeout=30).json()["games"]:
        if row.get("foryou_post_id"):
            g = row
            break
    if not g:
        pytest.skip("no game with a For You post")
    prev = g["foryou_post_id"]
    r = founder.post(f"{API}/gamemaker/{g['id']}/publish", json={"foryou_post": True}, timeout=15)
    assert r.status_code == 200
    jid = r.json()["job_id"]
    for _ in range(40):
        j = founder.get(f"{API}/jobs/{jid}", timeout=15).json()
        j = j.get("job") or j
        if j["phase"] in ("completed", "failed"):
            break
        time.sleep(1)
    assert j["phase"] == "completed", j.get("error")
    assert j["result"].get("post_id") == prev, "republish must reuse the same For You post"


# ─── Vault reconciliation stays balanced ─────────────────────────────────

def test_fire_reconciliation_balanced(founder):
    r = founder.get(f"{API}/admin/gamemaker/reconciliation", timeout=20).json()
    assert r["fire"]["outstanding_vs_expected_ok"] is True
    assert r["fire"]["orphaned_delta"] == 0
    assert r["fire"]["open_hold_total"] == 0
