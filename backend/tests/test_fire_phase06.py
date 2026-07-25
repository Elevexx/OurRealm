"""Iter-82 backend tests for Fire Power — Phase 0.6.

Focus (NEW in Phase 0.6):
  • Full-value recipient accounting with boosted_cost sender charge
    (5x -> pool -4, pending +5, post fire_total +5).
  • 24h edit window bound to created_at — edits NEVER restart the timer.
  • Difference-based edit accounting (increase/decrease/removal), and
    edit-idempotency of the running pool reservation.
  • After edit deadline the reaction is read-only (403 clear error).
  • Pending -> Collectable transition via founder force-finalize.
  • Manual COLLECT FIRE (Collect All + explicit txn ids), duplicate/
    concurrent collect calls never double-credit; collectable never
    expires.
  • Idempotency (single fire send + edit) — repeated identical send with
    the same idempotency_key returns duplicate:true and does NOT create
    additional wallet transactions.
  • Founder-only guard: every /api/fire/admin/* endpoint 403 for non-
    founder, 401 unauthenticated.
  • Admin command center endpoints: /admin/dashboard,
    /admin/inspect/user/{username}, /admin/inspect/post/{post_id},
    pause-fire (blocks sending), restore-fire (re-enables),
    reverse-reaction (reason required, 400 without).
  • Fire-ranked feed sorts by fire_total.
  • Wallet reconciliation zero-drift on second run.

Sender for boosted tests: 'stealth' (Level 4 Rising Star — 50 pool).
Receiver: fresh throwaway user (registered per class to isolate wallets).
Reverting side-effects: stealth's fire_paused flag & any wallet
config changes are always restored in finally blocks.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

STEALTH = {"email": "stealth", "password": "Password1$"}
SUPPORT = {"email": "support", "password": "Password1$"}
NORMAL = {"email": "auditcheckreal", "password": "Password1$"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _register(prefix):
    uname = f"{prefix}{uuid.uuid4().hex[:6]}"
    email = f"{uname}@example.com"
    body = {"email": email, "password": "Password1$", "name": uname,
            "username": uname, "accepted_terms": True, "accepted_privacy": True,
            "accepted_conditions": True, "age_confirmed_13": True}
    r = requests.post(f"{API}/auth/register", json=body, timeout=20)
    assert r.status_code in (200, 201), f"register: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or _login({"email": email, "password": "Password1$"})
    return uname, tok


def _me(tok):
    r = requests.get(f"{API}/auth/me", headers=_hdr(tok), timeout=20)
    assert r.status_code == 200, r.text[:200]
    j = r.json()
    return j.get("user", j)


def _create_public_post(tok, tag="TEST_iter82"):
    body = {"content": f"{tag} {uuid.uuid4().hex[:6]}",
            "media_type": "thought",
            "audience": {"visibility": "public"}}
    r = requests.post(f"{API}/posts", headers=_hdr(tok), json=body, timeout=20)
    assert r.status_code in (200, 201), r.text[:200]
    j = r.json()
    pid = j.get("id") or (j.get("post") or {}).get("id")
    assert pid
    return pid


def _wallet(tok):
    r = requests.get(f"{API}/fire/wallet", headers=_hdr(tok), timeout=20)
    assert r.status_code == 200, r.text[:200]
    return r.json()


def _pool_avail(tok):
    s = requests.get(f"{API}/fire/status", headers=_hdr(tok), timeout=20).json()
    return int(s["pool"]["available"]), int(s["pool"]["spent"])


# ── Fixtures ────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def stealth_token():
    return _login(STEALTH)


@pytest.fixture(scope="module")
def support_token():
    return _login(SUPPORT)


@pytest.fixture(scope="module")
def stealth_user(stealth_token):
    return _me(stealth_token)


@pytest.fixture(scope="module")
def receiver():
    """Fresh receiver — isolated wallet per module (post author)."""
    uname, tok = _register("rcv82_")
    u = _me(tok)
    return {"username": uname, "token": tok, "id": u["id"]}


# ── 1) Boosted accounting: full-value recipient, boosted_cost sender ────
class TestBoostedAccounting:
    def test_1x_costs_zero_pool_full_recipient(
            self, stealth_token, receiver):
        pid = _create_public_post(receiver["token"], "TEST_iter82_1x")
        avail0, spent0 = _pool_avail(stealth_token)
        w0 = _wallet(receiver["token"])["wallet"]
        r = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": pid, "fire_value": 1,
                                "idempotency_key": f"iter82-{uuid.uuid4().hex}"},
                          timeout=20)
        assert r.status_code == 200, r.text[:200]
        j = r.json()
        assert j["charged"] == 0, f"1x should charge 0, got {j['charged']}"
        # Sender pool unchanged
        avail1, spent1 = _pool_avail(stealth_token)
        assert spent1 == spent0, f"pool spent {spent0} -> {spent1}"
        # Recipient pending +1 (full)
        w1 = _wallet(receiver["token"])["wallet"]
        assert int(w1["pending_balance"]) == int(w0["pending_balance"]) + 1

    def test_5x_boosted_charges_4_recipient_gets_5(
            self, stealth_token, receiver):
        pid = _create_public_post(receiver["token"], "TEST_iter82_5x")
        avail0, spent0 = _pool_avail(stealth_token)
        w0 = _wallet(receiver["token"])["wallet"]
        # Check post fire_total baseline
        p0 = requests.get(f"{API}/fire/post/{pid}", headers=_hdr(stealth_token), timeout=20).json()
        ft0 = int(p0["fire_total"])

        r = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": pid, "fire_value": 5,
                                "idempotency_key": f"iter82-{uuid.uuid4().hex}"},
                          timeout=20)
        assert r.status_code == 200, r.text[:200]
        j = r.json()
        assert j["charged"] == 4, f"5x should charge boosted_cost=4, got {j['charged']}"

        avail1, spent1 = _pool_avail(stealth_token)
        assert spent1 - spent0 == 4, f"sender pool delta expected +4, got {spent1 - spent0}"

        p1 = requests.get(f"{API}/fire/post/{pid}", headers=_hdr(stealth_token), timeout=20).json()
        assert int(p1["fire_total"]) - ft0 == 5, "post fire_total should +5 (full)"

        w1 = _wallet(receiver["token"])["wallet"]
        assert int(w1["pending_balance"]) - int(w0["pending_balance"]) == 5, \
            "recipient pending must earn FULL 5 (not boosted_cost 4)"


# ── 2) Edit accounting: difference-based, deadline preserved ────────────
class TestEditAccounting:
    def test_edit_increase_and_decrease_and_remove_pool_and_deadline(
            self, stealth_token, receiver):
        # Fresh post, then send 5x -> 8x -> 3x -> 0
        pid = _create_public_post(receiver["token"], "TEST_iter82_edit")
        idem = f"iter82-edit-{uuid.uuid4().hex}"

        _, spent0 = _pool_avail(stealth_token)
        w0 = _wallet(receiver["token"])["wallet"]
        pen0 = int(w0["pending_balance"])

        # 5x — cost 4
        r1 = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                           json={"post_id": pid, "fire_value": 5,
                                 "idempotency_key": f"{idem}-a"}, timeout=20).json()
        deadline_a = r1["edit_deadline"]
        assert r1["charged"] == 4
        _, spent_a = _pool_avail(stealth_token)
        assert spent_a - spent0 == 4

        # 5x -> 8x — extra +3 charge
        r2 = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                           json={"post_id": pid, "fire_value": 8,
                                 "idempotency_key": f"{idem}-b"}, timeout=20).json()
        assert r2["charged"] == 3, f"5->8 should charge +3, got {r2['charged']}"
        assert r2["edit_deadline"] == deadline_a, "deadline must NOT reset on edit"
        _, spent_b = _pool_avail(stealth_token)
        assert spent_b - spent0 == 7  # 4 + 3

        # Recipient pending mirrors current fire_value (8)
        w_b = _wallet(receiver["token"])["wallet"]
        assert int(w_b["pending_balance"]) - pen0 == 8, \
            f"pending should = 8 above baseline, got {int(w_b['pending_balance']) - pen0}"

        # 8x -> 3x — release 5 back to pool (per Phase 0.6 diff accounting)
        r3 = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                           json={"post_id": pid, "fire_value": 3,
                                 "idempotency_key": f"{idem}-c"}, timeout=20).json()
        assert r3["edit_deadline"] == deadline_a
        _, spent_c = _pool_avail(stealth_token)
        # 3x has boosted_cost 2, so from spent0 pool should now be +2
        assert spent_c - spent0 == 2, \
            f"8->3 should end at +2 above baseline, got {spent_c - spent0}"

        # Recipient pending net = 3
        w_c = _wallet(receiver["token"])["wallet"]
        assert int(w_c["pending_balance"]) - pen0 == 3

        # 3x -> 0 — zero out
        r4 = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                           json={"post_id": pid, "fire_value": 0,
                                 "idempotency_key": f"{idem}-d"}, timeout=20).json()
        assert r4["edit_deadline"] == deadline_a
        assert int(r4["my_fire"]) == 0
        _, spent_d = _pool_avail(stealth_token)
        assert spent_d == spent0, \
            f"removal should fully return to pool baseline, got delta {spent_d - spent0}"

        # Recipient pending back to baseline
        w_d = _wallet(receiver["token"])["wallet"]
        assert int(w_d["pending_balance"]) == pen0

        # Post fire_total is 0
        p = requests.get(f"{API}/fire/post/{pid}", headers=_hdr(stealth_token), timeout=20).json()
        assert int(p["fire_total"]) == 0


# ── 3) After deadline: read-only ─────────────────────────────────────────
class TestReadOnlyAfterDeadline:
    def test_mutation_rejected_after_deadline(
            self, stealth_token, stealth_user, receiver):
        # Send once to create the reaction
        pid = _create_public_post(receiver["token"], "TEST_iter82_ro")
        r = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": pid, "fire_value": 2}, timeout=20)
        assert r.status_code == 200

        # Force the reaction's edit_deadline into the past directly in Mongo.
        # (test env only — safe per problem statement)
        from motor.motor_asyncio import AsyncIOMotorClient  # noqa: WPS433
        import asyncio
        client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        dbn = os.environ.get("DB_NAME", "test_database")

        async def _expire():
            db = client[dbn]
            await db.post_fire_reactions.update_one(
                {"post_id": pid, "user_id": stealth_user["id"]},
                {"$set": {"edit_deadline": "2020-01-01T00:00:00+00:00",
                          "created_at": "2020-01-01T00:00:00+00:00"}})

        try:
            asyncio.get_event_loop().run_until_complete(_expire())
        except RuntimeError:
            loop = asyncio.new_event_loop()
            loop.run_until_complete(_expire())
            loop.close()
        finally:
            client.close()

        # Any mutation attempt now must be 403
        r2 = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                           json={"post_id": pid, "fire_value": 3}, timeout=20)
        assert r2.status_code == 403, f"expected 403 after deadline, got {r2.status_code}"
        assert "finalized" in (r2.text or "").lower() or "edit" in (r2.text or "").lower()


# ── 4) Pending -> Collectable via founder force-finalize ────────────────
class TestFinalizeAndCollect:
    def test_force_finalize_moves_pending_to_collectable(
            self, stealth_token, receiver):
        # Fresh 1x fire to receiver
        pid = _create_public_post(receiver["token"], "TEST_iter82_final")
        requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                      json={"post_id": pid, "fire_value": 1}, timeout=20)
        w0 = _wallet(receiver["token"])["wallet"]
        pen0 = int(w0["pending_balance"])
        col0 = int(w0["collectable_balance"])
        assert pen0 >= 1, "must have pending before finalize"

        # Founder force-finalize
        r = requests.post(f"{API}/fire/admin/users/{receiver['username']}/finalize-pending",
                          headers=_hdr(stealth_token),
                          json={"reason": "iter82 test finalize"}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        assert r.json().get("finalized", 0) >= 1

        w1 = _wallet(receiver["token"])["wallet"]
        assert int(w1["pending_balance"]) < pen0, "pending should decrease"
        assert int(w1["collectable_balance"]) > col0, "collectable should increase"

    def test_manual_collect_moves_collectable_to_vault(
            self, stealth_token, receiver):
        # Ensure collectable > 0 (finalize first if needed)
        w0 = _wallet(receiver["token"])["wallet"]
        if int(w0["collectable_balance"]) == 0:
            # Create + finalize a fresh pending
            pid = _create_public_post(receiver["token"], "TEST_iter82_col_seed")
            requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": pid, "fire_value": 1}, timeout=20)
            requests.post(f"{API}/fire/admin/users/{receiver['username']}/finalize-pending",
                          headers=_hdr(stealth_token),
                          json={"reason": "seed"}, timeout=30)
            w0 = _wallet(receiver["token"])["wallet"]
        col0 = int(w0["collectable_balance"])
        vault0 = int(w0["vault_balance"])
        assert col0 > 0

        r = requests.post(f"{API}/fire/wallet/collect",
                          headers=_hdr(receiver["token"]),
                          json={"collect_all": True}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        j = r.json()
        assert j["ok"] is True
        assert int(j["collected"]) == col0

        w1 = j["wallet"]
        assert int(w1["collectable_balance"]) == 0
        assert int(w1["vault_balance"]) == vault0 + col0

    def test_duplicate_collect_does_not_double_credit(
            self, stealth_token, receiver):
        # Seed collectable
        pid = _create_public_post(receiver["token"], "TEST_iter82_dup_col")
        requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                      json={"post_id": pid, "fire_value": 1}, timeout=20)
        requests.post(f"{API}/fire/admin/users/{receiver['username']}/finalize-pending",
                      headers=_hdr(stealth_token),
                      json={"reason": "seed dup"}, timeout=30)
        w0 = _wallet(receiver["token"])["wallet"]
        vault0 = int(w0["vault_balance"])
        col0 = int(w0["collectable_balance"])
        assert col0 >= 1

        # Fire 5 collect_all requests concurrently-ish
        results = []
        for _ in range(5):
            rr = requests.post(f"{API}/fire/wallet/collect",
                               headers=_hdr(receiver["token"]),
                               json={"collect_all": True}, timeout=30)
            results.append(rr)
        assert all(r.status_code == 200 for r in results)
        total_collected = sum(int(r.json()["collected"]) for r in results)
        assert total_collected == col0, \
            f"total collected across 5 calls must equal initial collectable {col0}, got {total_collected}"

        w1 = _wallet(receiver["token"])["wallet"]
        assert int(w1["vault_balance"]) == vault0 + col0
        assert int(w1["collectable_balance"]) == 0


# ── 5) Idempotency (send-level) ─────────────────────────────────────────
class TestIdempotency:
    def test_same_key_returns_duplicate_true(self, stealth_token, receiver):
        pid = _create_public_post(receiver["token"], "TEST_iter82_idem")
        key = f"iter82-idem-{uuid.uuid4().hex}"
        r1 = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                           json={"post_id": pid, "fire_value": 2,
                                 "idempotency_key": key}, timeout=20)
        assert r1.status_code == 200
        w_mid = _wallet(receiver["token"])["wallet"]
        pen_mid = int(w_mid["pending_balance"])

        r2 = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                           json={"post_id": pid, "fire_value": 2,
                                 "idempotency_key": key}, timeout=20)
        assert r2.status_code == 200
        assert r2.json().get("duplicate") is True
        w_end = _wallet(receiver["token"])["wallet"]
        assert int(w_end["pending_balance"]) == pen_mid, \
            "duplicate must not add wallet credit"


# ── 6) Founder-only guard on /admin/* ───────────────────────────────────
class TestFounderGuard:
    ADMIN_GET = [
        "/fire/admin/dashboard",
        "/fire/admin/overview",
        "/fire/admin/wallets/overview",
        "/fire/admin/wallets/transactions",
    ]

    def test_support_admin_forbidden_on_admin_endpoints(self, support_token):
        for path in self.ADMIN_GET:
            r = requests.get(f"{API}{path}", headers=_hdr(support_token), timeout=20)
            assert r.status_code == 403, f"{path}: {r.status_code}"

    def test_unauthenticated_admin_endpoints(self):
        for path in self.ADMIN_GET:
            r = requests.get(f"{API}{path}", timeout=20)
            assert r.status_code in (401, 403), f"{path}: {r.status_code}"

    def test_support_forbidden_on_admin_action_endpoints(self, support_token, receiver):
        r = requests.post(f"{API}/fire/admin/users/{receiver['username']}/pause-fire",
                          headers=_hdr(support_token),
                          json={"reason": "should fail"}, timeout=20)
        assert r.status_code == 403
        r = requests.post(f"{API}/fire/admin/users/{receiver['username']}/finalize-pending",
                          headers=_hdr(support_token),
                          json={"reason": "should fail"}, timeout=20)
        assert r.status_code == 403


# ── 7) Admin command center ─────────────────────────────────────────────
class TestAdminCommandCenter:
    def test_dashboard(self, stealth_token):
        r = requests.get(f"{API}/fire/admin/dashboard",
                         headers=_hdr(stealth_token), timeout=30)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        for k in ("total_vault_fire", "total_pending_fire", "finalization_queue",
                  "collectable_transactions", "reversed_transactions",
                  "lifetime_fire_received_total", "lifetime_fire_collected_total",
                  "collections_today", "collections_this_week",
                  "collections_this_month", "top_earners", "top_senders"):
            assert k in d, f"dashboard missing {k}"

    def test_inspect_user(self, stealth_token, receiver):
        r = requests.get(f"{API}/fire/admin/inspect/user/{receiver['username']}",
                         headers=_hdr(stealth_token), timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["user"]["username"] == receiver["username"]
        for k in ("config", "pool", "wallet", "fire_given",
                  "active_reactions", "recent_transactions"):
            assert k in d

    def test_inspect_post(self, stealth_token, receiver):
        pid = _create_public_post(receiver["token"], "TEST_iter82_inspect")
        requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                      json={"post_id": pid, "fire_value": 2}, timeout=20)
        r = requests.get(f"{API}/fire/admin/inspect/post/{pid}",
                         headers=_hdr(stealth_token), timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["post"]["id"] == pid
        assert d["supporter_count"] >= 1
        assert d["largest_fire"] >= 2
        assert isinstance(d["reactions"], list)

    def test_pause_and_restore_fire(self, stealth_token, receiver):
        # Pause
        try:
            r = requests.post(f"{API}/fire/admin/users/{receiver['username']}/pause-fire",
                              headers=_hdr(stealth_token),
                              json={"reason": "iter82 pause test"}, timeout=20)
            assert r.status_code == 200
            assert r.json().get("fire_paused") is True

            # Paused user cannot send fire
            pid = _create_public_post(receiver["token"], "TEST_iter82_pause")
            r2 = requests.post(f"{API}/fire/react", headers=_hdr(receiver["token"]),
                               json={"post_id": pid, "fire_value": 1}, timeout=20)
            # Author sending to their own post is a no-earn no-op with 200 either way;
            # to actually check the pause we need paused user firing on someone else's post.
            other_pid = _create_public_post(stealth_token, "TEST_iter82_pause_other")
            r3 = requests.post(f"{API}/fire/react", headers=_hdr(receiver["token"]),
                               json={"post_id": other_pid, "fire_value": 1}, timeout=20)
            assert r3.status_code == 403, f"paused user should be blocked, got {r3.status_code}"
            assert "paused" in (r3.text or "").lower()
        finally:
            # Always restore
            r = requests.post(f"{API}/fire/admin/users/{receiver['username']}/restore-fire",
                              headers=_hdr(stealth_token),
                              json={"reason": "iter82 restore"}, timeout=20)
            assert r.status_code == 200
            assert r.json().get("fire_paused") is False

        # After restore, user can send fire again
        other_pid2 = _create_public_post(stealth_token, "TEST_iter82_restore_ok")
        r4 = requests.post(f"{API}/fire/react", headers=_hdr(receiver["token"]),
                           json={"post_id": other_pid2, "fire_value": 1}, timeout=20)
        assert r4.status_code == 200, r4.text[:200]

    def test_reverse_reaction_requires_reason(self, stealth_token, receiver):
        # Create a reaction to reverse
        pid = _create_public_post(receiver["token"], "TEST_iter82_reverse")
        r = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": pid, "fire_value": 2}, timeout=20)
        assert r.status_code == 200
        # Find the reaction id via inspect
        insp = requests.get(f"{API}/fire/admin/inspect/post/{pid}",
                            headers=_hdr(stealth_token), timeout=20).json()
        rxn = insp["reactions"][0]
        rxn_id = rxn["id"]

        # Empty reason -> 400
        rr = requests.post(f"{API}/fire/admin/reactions/{rxn_id}/reverse",
                           headers=_hdr(stealth_token),
                           json={"reason": "   "}, timeout=20)
        assert rr.status_code == 400, f"empty reason should 400, got {rr.status_code}"

        # Real reason -> 200 and accounting reverses
        rr2 = requests.post(f"{API}/fire/admin/reactions/{rxn_id}/reverse",
                            headers=_hdr(stealth_token),
                            json={"reason": "iter82 reversal audit"}, timeout=20)
        assert rr2.status_code == 200, rr2.text[:200]
        rep = rr2.json()
        assert rep["ok"] is True
        assert rep["reaction_id"] == rxn_id
        # Post fire_total drops to 0 for this reaction alone (only one reaction)
        p = requests.get(f"{API}/fire/post/{pid}", headers=_hdr(stealth_token), timeout=20).json()
        assert int(p["fire_total"]) == 0


# ── 8) Wallet reconciliation zero-drift ─────────────────────────────────
class TestReconciliation:
    def test_recalc_zero_drift(self, stealth_token):
        r = requests.post(f"{API}/fire/admin/wallets/recalculate",
                          headers=_hdr(stealth_token), json={}, timeout=90)
        assert r.status_code == 200, r.text[:200]
        r2 = requests.post(f"{API}/fire/admin/wallets/recalculate",
                           headers=_hdr(stealth_token), json={}, timeout=90)
        assert r2.status_code == 200
        assert r2.json()["wallets_changed"] == 0, \
            f"drift on second recalc: {r2.json().get('changes')}"


# ── 9) Fire-ranked feed ─────────────────────────────────────────────────
class TestFireRankedFeed:
    def test_ranked_by_fire_total(self, stealth_token):
        r = requests.get(f"{API}/posts?sort=fire&window=all&limit=20", headers=_hdr(stealth_token), timeout=30)
        assert r.status_code == 200, r.text[:200]
        posts = r.json().get("posts") or []
        assert isinstance(posts, list)
        # If we got >= 2 posts, verify they are sorted by fire_total desc
        totals = [int((p.get("fire") or {}).get("total") or p.get("fire_total") or 0) for p in posts]
        # Non-strictly-decreasing
        assert all(a >= b for a, b in zip(totals, totals[1:])), \
            f"feed not sorted desc by fire_total: {totals}"


# ── 10) Regression: private-message emoji reactions still work ──────────
class TestEmojiReactionsPreserved:
    def test_emoji_reaction_endpoint_untouched(self, stealth_token, receiver):
        pid = _create_public_post(receiver["token"], "TEST_iter82_emoji")
        r = requests.post(f"{API}/reactions/set", headers=_hdr(stealth_token),
                          json={"target_type": "post", "target_id": pid,
                                "emoji": "🙏"}, timeout=20)
        # Endpoint must exist and respond (either 200/201 or 400 with a clear
        # policy message — never 404/500).
        assert r.status_code < 500, r.text[:200]
        assert r.status_code != 404, "reactions endpoint should still exist"
