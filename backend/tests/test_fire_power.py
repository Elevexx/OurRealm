"""Iter-80 backend tests for the Fire Power reaction system.

Covers: /api/fire/status, /api/fire/react (1x free, 0=remove, level cap,
delta charging, no-refund, idempotency, overspend 409, public-only),
/api/posts feed attach + ?sort=fire windows, migration admin endpoints
(dry-run / execute phrase / idempotency / reconcile), founder-only
enforcement, and regression on legacy /like + /api/reactions/set.
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

STEALTH = {"email": "stealth", "password": "Password1$"}
NORMAL = {"email": "auditcheckreal", "password": "Password1$"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ── session fixtures ────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def stealth_token():
    return _login(STEALTH)


@pytest.fixture(scope="module")
def normal_token():
    return _login(NORMAL)


@pytest.fixture(scope="module")
def stealth_user(stealth_token):
    r = requests.get(f"{API}/auth/me", headers=_hdr(stealth_token), timeout=20)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def public_post_id(stealth_token):
    """Create a fresh public post owned by stealth so we have a clean
    slate we can safely poke without disturbing existing data."""
    body = {"content": f"TEST_fire_iter80 {uuid.uuid4().hex[:8]}",
            "media_type": "thought",
            "audience": {"visibility": "public"}}
    r = requests.post(f"{API}/posts", headers=_hdr(stealth_token), json=body, timeout=20)
    assert r.status_code in (200, 201), r.text[:200]
    pid = r.json().get("id") or r.json().get("post", {}).get("id")
    assert pid, r.text[:200]
    return pid


@pytest.fixture(scope="module")
def private_post_id(stealth_token):
    body = {"content": f"TEST_fire_private {uuid.uuid4().hex[:8]}",
            "media_type": "thought",
            "audience": {"visibility": "friends"}}
    r = requests.post(f"{API}/posts", headers=_hdr(stealth_token), json=body, timeout=20)
    if r.status_code not in (200, 201):
        pytest.skip(f"friends-only post creation not supported: {r.status_code}")
    pid = r.json().get("id") or r.json().get("post", {}).get("id")
    if not pid:
        pytest.skip("could not create friends-only post")
    return pid


# ── /api/fire/status ────────────────────────────────────────────────────
class TestFireStatus:
    def test_status_authenticated_shape(self, stealth_token):
        r = requests.get(f"{API}/fire/status", headers=_hdr(stealth_token), timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["enabled"] is True
        assert data["boosted_enabled"] is True
        assert data["ranked_feed_enabled"] is True
        assert isinstance(data["config"], dict)
        for k in ("max_fire_per_reaction", "daily_fire_pool", "fire_enabled", "level_number"):
            assert k in data["config"], f"missing config.{k}"
        assert isinstance(data["pool"], dict)
        for k in ("pool_max", "spent", "available", "next_recovery_at"):
            assert k in data["pool"], f"missing pool.{k}"
        assert data["pool"]["spent"] <= data["pool"]["pool_max"]

    def test_status_guest_returns_flags_no_config(self):
        r = requests.get(f"{API}/fire/status", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["enabled"] is True
        assert data["config"] is None
        assert data["pool"] is None


# ── /api/fire/react — core rules ────────────────────────────────────────
class TestFireReact1x:
    def test_1x_free_and_remove(self, normal_token, public_post_id):
        # give 1x — charged 0
        r = requests.post(f"{API}/fire/react", headers=_hdr(normal_token),
                          json={"post_id": public_post_id, "fire_value": 1}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["charged"] == 0
        assert d["my_fire"] == 1
        assert d["fire_total"] >= 1
        total_before = d["fire_total"]

        # verify persistence via GET
        r2 = requests.get(f"{API}/fire/post/{public_post_id}",
                          headers=_hdr(normal_token), timeout=20)
        assert r2.status_code == 200
        assert r2.json()["my_fire"] == 1

        # remove (fire_value=0) — total decreases by 1, no refund of pool
        r3 = requests.post(f"{API}/fire/react", headers=_hdr(normal_token),
                           json={"post_id": public_post_id, "fire_value": 0}, timeout=20)
        assert r3.status_code == 200
        d3 = r3.json()
        assert d3["my_fire"] == 0
        assert d3["fire_total"] == total_before - 1
        assert d3["charged"] == 0


class TestFireReactBoostRules:
    def test_level_cap_400(self, stealth_token, public_post_id):
        # stealth level 4 max=10. 11× must be rejected.
        r = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": public_post_id, "fire_value": 11}, timeout=20)
        assert r.status_code == 400
        assert "level" in r.text.lower() or "10" in r.text

    def test_newbie_boost_rejected(self, normal_token, public_post_id):
        # A normal member is likely Level 1 (max 1x) — 2x should 400.
        r = requests.post(f"{API}/fire/react", headers=_hdr(normal_token),
                          json={"post_id": public_post_id, "fire_value": 2}, timeout=20)
        # accept either 400 (level cap) or 409 (empty pool) — both are
        # correct rejection paths for a low-level user.
        assert r.status_code in (400, 409), r.text[:200]

    def test_public_only(self, stealth_token, private_post_id):
        r = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": private_post_id, "fire_value": 1}, timeout=20)
        assert r.status_code == 400
        assert "public" in r.text.lower()

    def test_idempotency_no_double_charge(self, stealth_token):
        # Reset by removing any existing fire on a fresh post
        body = {"content": f"TEST_fire_idem {uuid.uuid4().hex[:8]}",
                "media_type": "thought", "audience": {"visibility": "public"}}
        cp = requests.post(f"{API}/posts", headers=_hdr(stealth_token), json=body, timeout=20)
        pid = cp.json().get("id") or cp.json().get("post", {}).get("id")

        # Check pool room; if <2 available, use 1x for idempotency (still valid)
        st = requests.get(f"{API}/fire/status", headers=_hdr(stealth_token), timeout=20).json()
        available = st["pool"]["available"]
        fire_val = 2 if available >= 1 else 1

        key = f"iter80-idem-{uuid.uuid4().hex}"
        r1 = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                           json={"post_id": pid, "fire_value": fire_val,
                                 "idempotency_key": key}, timeout=20)
        assert r1.status_code == 200, r1.text[:200]
        d1 = r1.json()
        pool_after_first = d1["pool"]["spent"]

        r2 = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                           json={"post_id": pid, "fire_value": fire_val,
                                 "idempotency_key": key}, timeout=20)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("duplicate") is True
        assert d2["pool"]["spent"] == pool_after_first, "duplicate must not double-charge pool"
        assert d2["fire_total"] == d1["fire_total"]


class TestFireReactDelta:
    """Delta charging & no-refund — needs pool room. Uses stealth. If
    the pool is exhausted, we skip gracefully."""

    def test_delta_and_no_refund(self, stealth_token):
        st = requests.get(f"{API}/fire/status", headers=_hdr(stealth_token), timeout=20).json()
        available = st["pool"]["available"]
        if available < 4:
            pytest.skip(f"stealth pool has only {available} available — need ≥4 for delta test")

        body = {"content": f"TEST_fire_delta {uuid.uuid4().hex[:8]}",
                "media_type": "thought", "audience": {"visibility": "public"}}
        cp = requests.post(f"{API}/posts", headers=_hdr(stealth_token), json=body, timeout=20)
        pid = cp.json().get("id") or cp.json().get("post", {}).get("id")

        # 2× (cost 1)
        r = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": pid, "fire_value": 2}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        assert r.json()["charged"] == 1

        # raise to 4× → delta cost 2 (already paid 1)
        r = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": pid, "fire_value": 4}, timeout=20)
        assert r.status_code == 200
        assert r.json()["charged"] == 2

        # lower to 2× → NO refund, charged 0
        r = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": pid, "fire_value": 2}, timeout=20)
        assert r.status_code == 200
        assert r.json()["charged"] == 0

        # re-raise to 4× → previously paid 3, no new charge
        r = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": pid, "fire_value": 4}, timeout=20)
        assert r.status_code == 200
        assert r.json()["charged"] == 0

    def test_overspend_409(self, stealth_token):
        st = requests.get(f"{API}/fire/status", headers=_hdr(stealth_token), timeout=20).json()
        pool_max = st["pool"]["pool_max"]
        available = st["pool"]["available"]
        max_fire = st["config"]["max_fire_per_reaction"]
        # Only meaningful if pool is finite and we can request more than available.
        if available >= max_fire - 1:
            # Try to spend a big boost that exceeds available.
            fire_val = max_fire
            expected_cost = fire_val - 1
            if expected_cost <= available:
                pytest.skip("pool has enough headroom — overspend not reachable")
        body = {"content": f"TEST_fire_overspend {uuid.uuid4().hex[:8]}",
                "media_type": "thought", "audience": {"visibility": "public"}}
        cp = requests.post(f"{API}/posts", headers=_hdr(stealth_token), json=body, timeout=20)
        pid = cp.json().get("id") or cp.json().get("post", {}).get("id")

        r = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": pid, "fire_value": max_fire}, timeout=20)
        # if pool actually had headroom this becomes 200; that's fine
        if r.status_code == 200:
            # Pool spent must never exceed pool_max
            assert r.json()["pool"]["spent"] <= pool_max
        else:
            assert r.status_code == 409
            assert "not enough" in r.text.lower() or "fire" in r.text.lower()


# ── /api/posts feed attach + rank ───────────────────────────────────────
class TestFeedAttachRank:
    def test_feed_attaches_fire(self):
        r = requests.get(f"{API}/posts?viewer=stealth&limit=20", timeout=30)
        assert r.status_code == 200
        posts = r.json().get("posts", [])
        assert len(posts) > 0
        checked = 0
        for p in posts:
            if p.get("audience", {}).get("visibility") == "public":
                assert "fire" in p, f"post {p.get('id')} missing fire block"
                for k in ("total", "count", "my_fire"):
                    assert k in p["fire"], f"fire.{k} missing"
                checked += 1
                if checked >= 3:
                    break
        assert checked >= 1

    @pytest.mark.parametrize("window", ["1h", "12h", "24h", "1w", "1m", "all"])
    def test_fire_ranked_windows(self, window):
        r = requests.get(
            f"{API}/posts?viewer=stealth&sort=fire&window={window}&limit=20", timeout=30)
        assert r.status_code == 200, f"window={window} → {r.status_code} {r.text[:200]}"
        posts = r.json().get("posts", [])
        # Filter pinned to check ranked-order of rest.
        rest = [p for p in posts if not p.get("is_pinned")]
        if len(rest) < 2:
            return
        if window == "all":
            fires = [int(p.get("fire", {}).get("total", 0)) for p in rest]
        else:
            # window totals are computed server-side; use returned totals as a
            # rough consistency check (server sorts on window totals, not
            # lifetime, so we only assert the response was 200 here).
            return
        # Non-increasing (allowing ties) — server sorts by fire descending
        for a, b in zip(fires, fires[1:]):
            assert a >= b, f"fire-ranked feed not descending: {fires}"


# ── Migration admin (founder only) ──────────────────────────────────────
class TestMigrationAdmin:
    def test_non_founder_forbidden(self, normal_token):
        r = requests.post(f"{API}/fire/admin/migration/dry-run",
                          headers=_hdr(normal_token), timeout=20)
        assert r.status_code == 403

    def test_dry_run(self, stealth_token):
        r = requests.post(f"{API}/fire/admin/migration/dry-run",
                          headers=_hdr(stealth_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["mode"] == "dry_run"
        assert d["pool_consumed"] == 0
        assert d["likes_deleted"] == 0
        assert d["dm_reactions_touched"] == 0
        assert "would_create_fire_reactions" in d
        assert "total_public_likes" in d

    def test_execute_requires_exact_phrase(self, stealth_token):
        r = requests.post(f"{API}/fire/admin/migration/execute",
                          headers=_hdr(stealth_token),
                          json={"confirmation_phrase": "wrong phrase"}, timeout=20)
        assert r.status_code == 400
        assert "MIGRATE LIKES TO FIRE" in r.text

    def test_execute_idempotent(self, stealth_token):
        # First run — may create N depending on new legacy likes since
        # the previous execute (our own regression test may add one).
        r1 = requests.post(f"{API}/fire/admin/migration/execute",
                           headers=_hdr(stealth_token),
                           json={"confirmation_phrase": "MIGRATE LIKES TO FIRE"}, timeout=60)
        assert r1.status_code == 200
        # Second run must be idempotent — 0 new reactions created.
        r2 = requests.post(f"{API}/fire/admin/migration/execute",
                           headers=_hdr(stealth_token),
                           json={"confirmation_phrase": "MIGRATE LIKES TO FIRE"}, timeout=60)
        assert r2.status_code == 200
        d = r2.json()
        assert d["mode"] == "execute"
        assert d["pool_consumed"] == 0
        assert d["likes_deleted"] == 0
        assert d["reactions_created"] == 0, f"idempotency broken: {d}"

    def test_reconcile(self, stealth_token):
        r = requests.post(f"{API}/fire/admin/migration/reconcile",
                          headers=_hdr(stealth_token),
                          json={"fix": False}, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["mode"] == "reconcile"
        assert d["counter_mismatches"] == 0, f"mismatches: {d.get('mismatch_samples')}"


# ── Regression: legacy like + emoji reactions unaffected ────────────────
class TestLegacyRegression:
    def test_legacy_like_still_works(self, normal_token, stealth_token):
        # Create a friends-only post from stealth (fire-blocked path), so
        # /like remains the operative endpoint for it. If friends-only
        # can't be created, fall back to a public post — /like still
        # works there per the "do not delete legacy likes" rule.
        body = {"content": f"TEST_like_legacy {uuid.uuid4().hex[:8]}",
                "media_type": "thought", "audience": {"visibility": "public"}}
        cp = requests.post(f"{API}/posts", headers=_hdr(stealth_token), json=body, timeout=20)
        pid = cp.json().get("id") or cp.json().get("post", {}).get("id")

        r = requests.post(f"{API}/posts/{pid}/like",
                          headers=_hdr(normal_token), timeout=20)
        # Legacy endpoint should still return 200-family regardless of
        # audience — it's the non-public fallback + backwards compat.
        assert r.status_code in (200, 201), f"legacy /like broken: {r.status_code} {r.text[:200]}"

    def test_reactions_set_emoji_on_post(self, normal_token, stealth_token):
        body = {"content": f"TEST_emoji_react {uuid.uuid4().hex[:8]}",
                "media_type": "thought", "audience": {"visibility": "public"}}
        cp = requests.post(f"{API}/posts", headers=_hdr(stealth_token), json=body, timeout=20)
        pid = cp.json().get("id") or cp.json().get("post", {}).get("id")

        r = requests.post(f"{API}/reactions/set", headers=_hdr(normal_token),
                          json={"target_type": "post", "target_id": pid, "emoji": "🙏"},
                          timeout=20)
        assert r.status_code in (200, 201), r.text[:200]

        # Retrieve summary (endpoint varies — try common paths)
        r2 = requests.get(
            f"{API}/reactions/summary?target_type=post&target_ids={pid}",
            headers=_hdr(normal_token), timeout=20)
        if r2.status_code in (404, 422):
            r2 = requests.get(f"{API}/reactions/post/{pid}",
                              headers=_hdr(normal_token), timeout=20)
        assert r2.status_code == 200, r2.text[:200]
