"""Backend tests for Game Maker Phase 1 (iteration 127).

Coverage:
- Job engine: delayed-job test endpoint + /api/jobs/{id} polling
- Gamemaker catalog (founder vs member access)
- Gamemaker create dry_run + planned-runtime rejection
- Resources: idempotent grants, reversal, adjustment validation
- /api/resources/me fire == /api/fire/wallet vault_balance
- Admin gamemaker endpoints (overview/jobs/migration report) role gating
- orai-edit dry_run sync
- Regression: public game-path hub, /api/games auth, fire wallet
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

FOUNDER = {"email": "stealth", "password": "Password1$"}
MEMBER = {"email": "auditcheckreal", "password": "Password1$"}


def _login(session, creds):
    r = session.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token")
    if tok:
        session.headers["Authorization"] = f"Bearer {tok}"
    return r.json()


@pytest.fixture(scope="module")
def founder():
    s = requests.Session()
    _login(s, FOUNDER)
    return s


@pytest.fixture(scope="module")
def member():
    s = requests.Session()
    _login(s, MEMBER)
    return s


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


# --- Job engine ---
class TestJobEngine:
    def test_delayed_job_202_and_progress(self, founder):
        t0 = time.time()
        r = founder.post(f"{API}/admin/gamemaker/test-delayed-job", json={"seconds": 70}, timeout=10)
        elapsed = time.time() - t0
        assert r.status_code in (200, 202), f"{r.status_code} {r.text[:200]}"
        assert elapsed < 3.0, f"job creation took {elapsed}s (should be <2s)"
        body = r.json()
        job_id = body.get("job_id") or body.get("id")
        assert job_id, f"no job_id in {body}"

        # poll up to ~85s
        deadline = time.time() + 90
        last_status = None
        phases_seen = set()
        while time.time() < deadline:
            gr = founder.get(f"{API}/jobs/{job_id}", timeout=10)
            assert gr.status_code == 200, gr.text[:200]
            j = gr.json().get("job") or gr.json()
            last_status = j.get("status") or j.get("phase")
            ph = j.get("phase") or j.get("current_phase")
            if ph:
                phases_seen.add(ph)
            if last_status in ("completed", "succeeded", "failed", "error", "cancelled"):
                break
            time.sleep(3)
        assert last_status in ("completed", "succeeded"), f"final status={last_status} phases={phases_seen}"


# --- Catalog ---
class TestCatalog:
    def test_founder_sees_catalog(self, founder):
        r = founder.get(f"{API}/gamemaker/catalog", timeout=15)
        assert r.status_code == 200, r.text[:200]
        b = r.json()
        assert b.get("access", {}).get("allowed") is True, f"access={b.get('access')}"
        styles = b.get("styles") or b.get("animation_styles") or []
        runtimes = b.get("runtimes") or []
        assert len(styles) == 10, f"styles count={len(styles)}"
        assert len(runtimes) == 10, f"runtimes count={len(runtimes)}"
        by_id = {r.get("id") or r.get("key") or r.get("slug"): r for r in runtimes}
        # June 2026: all ten primary runtimes are live (shooter + open_world_rpg shipped)
        for key in ("open_world_rpg", "shooter"):
            rt = by_id.get(key)
            assert rt is not None, f"missing runtime {key}: keys={list(by_id.keys())}"
            assert rt.get("status") == "live", f"{key} status={rt.get('status')}"

    def test_member_denied(self, member):
        r = member.get(f"{API}/gamemaker/catalog", timeout=15)
        # Endpoint may return 200 with allowed=false, or 403
        if r.status_code == 200:
            assert r.json().get("access", {}).get("allowed") is False
        else:
            assert r.status_code in (401, 403), r.status_code


# --- Create endpoint (dry_run only, safety) ---
class TestCreate:
    def test_planned_runtime_blocked(self, founder):
        r = founder.post(f"{API}/gamemaker/create",
                         json={"runtime": "shooter", "style": "pixel", "idea": "test", "dry_run": True},
                         timeout=15)
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text[:200]}"

    def test_dry_run_estimated_cost(self, founder):
        # pick a non-planned runtime
        cat = founder.get(f"{API}/gamemaker/catalog", timeout=15).json()
        live = None
        for rt in cat.get("runtimes", []):
            if rt.get("status") not in ("planned", "coming_soon"):
                live = rt.get("id") or rt.get("key") or rt.get("slug")
                break
        assert live, "no live runtime found"
        styles = cat.get("styles") or cat.get("animation_styles") or []
        style = (styles[0].get("id") or styles[0].get("key") or styles[0].get("slug")) if styles else "pixel"
        r = founder.post(f"{API}/gamemaker/create",
                         json={"runtime": live, "style": style, "idea": "A tiny platform test.", "dry_run": True},
                         timeout=20)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        b = r.json()
        assert ("estimated_cost" in b) or ("cost" in b) or ("estimate" in b), f"no cost field: {list(b.keys())}"


# --- Resources ---
class TestResources:
    def test_idempotent_stars_grant(self, founder):
        rid = f"agenttest-{uuid.uuid4().hex[:8]}"
        payload = {"username": "auditcheckreal", "amount": 5, "reason": "test", "request_id": rid}

        # baseline
        bal0 = founder.get(f"{API}/admin/resources/balances/auditcheckreal", timeout=15).json()
        stars0 = _extract_bal(bal0, "stars")

        r1 = founder.post(f"{API}/admin/resources/stars/adjust", json=payload, timeout=15)
        assert r1.status_code == 200, r1.text[:200]
        r2 = founder.post(f"{API}/admin/resources/stars/adjust", json=payload, timeout=15)
        assert r2.status_code == 200, r2.text[:200]
        assert r2.json().get("replayed") is True, f"expected replayed=true, got {r2.json()}"

        bal1 = founder.get(f"{API}/admin/resources/balances/auditcheckreal", timeout=15).json()
        stars1 = _extract_bal(bal1, "stars")
        assert stars1 - stars0 == 5, f"expected +5, got {stars0}->{stars1}"

    def test_adjust_missing_reason_400(self, founder):
        r = founder.post(f"{API}/admin/resources/stars/adjust",
                         json={"username": "auditcheckreal", "amount": 1, "request_id": f"norr-{uuid.uuid4().hex[:6]}"},
                         timeout=15)
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text[:200]}"

    def test_reverse_transaction(self, founder):
        # create a grant to reverse
        rid = f"revtest-{uuid.uuid4().hex[:8]}"
        r = founder.post(f"{API}/admin/resources/stars/adjust",
                         json={"username": "auditcheckreal", "amount": 3, "reason": "to-reverse",
                               "request_id": rid}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        tx_id = (r.json().get("transaction") or {}).get("id") or r.json().get("tx_id") or r.json().get("transaction_id") or r.json().get("id")
        assert tx_id, f"no tx_id in {r.json()}"

        bal_before = _extract_bal(
            founder.get(f"{API}/admin/resources/balances/auditcheckreal", timeout=15).json(), "stars")

        rv = founder.post(f"{API}/admin/resources/transactions/{tx_id}/reverse",
                         json={"reason": "test-reverse"}, timeout=15)
        assert rv.status_code == 200, f"{rv.status_code} {rv.text[:200]}"

        bal_after = _extract_bal(
            founder.get(f"{API}/admin/resources/balances/auditcheckreal", timeout=15).json(), "stars")
        assert bal_before - bal_after == 3, f"reverse mismatch {bal_before}->{bal_after}"

    def test_resources_me_fire_matches_wallet(self, member):
        rr = member.get(f"{API}/resources/me", timeout=15)
        assert rr.status_code == 200, rr.text[:200]
        wr = member.get(f"{API}/fire/wallet", timeout=15)
        assert wr.status_code == 200, wr.text[:200]
        fire_res = _extract_bal(rr.json(), "fire")
        vault = wr.json().get("vault_balance")
        if vault is None:
            # try nested
            vault = (wr.json().get("wallet") or {}).get("vault_balance")
        assert fire_res == vault, f"resources.fire={fire_res} vs fire.vault_balance={vault}"


def _extract_bal(obj, name):
    if obj is None:
        return None
    # try various shapes
    if isinstance(obj, dict):
        if name in obj and isinstance(obj[name], (int, float)):
            return obj[name]
        bals = obj.get("balances") or obj.get("resources") or {}
        if isinstance(bals, dict):
            v = bals.get(name)
            if isinstance(v, dict):
                return v.get("balance") or v.get("amount") or 0
            if isinstance(v, (int, float)):
                return v
        if isinstance(bals, list):
            for it in bals:
                if it.get("key") == name or it.get("id") == name or it.get("name") == name:
                    return it.get("balance") or it.get("amount") or 0
        # fire specific
        if name == "fire":
            for k in ("fire_balance", "vault_balance"):
                if k in obj:
                    return obj[k]
    return 0


# --- Admin gamemaker ---
class TestAdminGamemaker:
    @pytest.mark.parametrize("path", ["overview", "jobs", "migration/report"])
    def test_founder_ok(self, founder, path):
        r = founder.get(f"{API}/admin/gamemaker/{path}", timeout=15)
        assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"

    @pytest.mark.parametrize("path", ["overview", "jobs", "migration/report"])
    def test_member_denied(self, member, path):
        r = member.get(f"{API}/admin/gamemaker/{path}", timeout=15)
        assert r.status_code in (401, 403), f"{path} member: {r.status_code}"

    @pytest.mark.parametrize("path", ["overview", "jobs", "migration/report"])
    def test_anon_denied(self, anon, path):
        r = anon.get(f"{API}/admin/gamemaker/{path}", timeout=15)
        assert r.status_code in (401, 403), f"{path} anon: {r.status_code}"

    def test_member_cannot_post_access(self, member):
        r = member.post(f"{API}/admin/gamemaker/access", json={"mode": "public"}, timeout=15)
        assert r.status_code in (401, 403), f"got {r.status_code}"


# --- orai-edit dry_run ---
class TestOraiEditDryRun:
    def test_dry_run_sync(self, founder):
        sr = founder.get(f"{API}/gamemaker/saved", timeout=15)
        if sr.status_code != 200:
            pytest.skip(f"/gamemaker/saved not available: {sr.status_code}")
        data = sr.json()
        items = data.get("games") or data.get("items") or (data if isinstance(data, list) else [])
        if not items:
            pytest.skip("no saved games")
        gid = items[0].get("id") or items[0].get("_id") or items[0].get("game_id")
        assert gid
        r = founder.post(f"{API}/admin/games/{gid}/orai-edit",
                         json={"dry_run": True, "prompt": "no-op describe test"}, timeout=20)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        b = r.json()
        assert ("estimated_cost" in b) or ("cost" in b) or ("estimate" in b), f"no cost field: {list(b.keys())}"


# --- Regression ---
class TestRegression:
    def test_public_game_hub(self, anon):
        r = anon.get(f"{API}/public/game-path/hub", timeout=15)
        assert r.status_code == 200, r.text[:200]
        b = r.json()
        games = b.get("games") or b.get("items") or (b if isinstance(b, list) else [])
        assert len(games) >= 20, f"expected ~28 games, got {len(games)}"

    def test_games_requires_auth(self, anon):
        r = anon.get(f"{API}/games", timeout=15)
        assert r.status_code in (401, 403), f"got {r.status_code}"

    def test_fire_wallet_founder(self, founder):
        r = founder.get(f"{API}/fire/wallet", timeout=15)
        assert r.status_code == 200, r.text[:200]
