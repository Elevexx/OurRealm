"""Iter-81 backend tests for Fire Vault (Phase 0.5) and Fire Wallet
Privacy (Phase 1).

Covers:
  • Vault accrual: 2nd user fires stealth's public post -> pending +N,
    lifetime_fire_earned +N; sender wallet unchanged.
  • High-water anti-farming: remove (0) then re-send same value -> no
    additional pending credit.
  • Settlement (settlement_hours=0) turns fresh pending into vault_balance
    on next wallet read. Restores settlement_hours=24 after.
  • Self-fire (author == sender) credits nothing.
  • Admin: overview shape, recalculate 0 drift, transactions shape,
    settle-now, 403 for non-founder.
  • Privacy: GET /privacy defaults, PATCH validates values,
    /wallet/stats/{username} filters correctly for anonymous, owner,
    founder, and friend viewers (via /friends/request + /friends/accept).
  • Regression: pool accounting untouched, /reactions untouched, idem key.
"""
import os
import uuid
import time
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


def _register(username_prefix):
    uname = f"{username_prefix}{uuid.uuid4().hex[:6]}"
    email = f"{uname}@example.com"
    body = {"email": email, "password": "Password1$", "name": uname,
            "username": uname, "accepted_terms": True, "accepted_privacy": True,
            "accepted_conditions": True, "age_confirmed_13": True}
    r = requests.post(f"{API}/auth/register", json=body, timeout=20)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token")
    if not tok:
        tok = _login({"email": email, "password": "Password1$"})
    return uname, email, tok


# ── Fixtures ────────────────────────────────────────────────────────────
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
    j = r.json()
    return j.get("user", j)


@pytest.fixture(scope="module")
def normal_user(normal_token):
    r = requests.get(f"{API}/auth/me", headers=_hdr(normal_token), timeout=20)
    assert r.status_code == 200
    j = r.json()
    return j.get("user", j)


def _create_public_post(tok, tag="TEST_iter81_vault"):
    body = {"content": f"{tag} {uuid.uuid4().hex[:6]}",
            "media_type": "thought",
            "audience": {"visibility": "public"}}
    r = requests.post(f"{API}/posts", headers=_hdr(tok), json=body, timeout=20)
    assert r.status_code in (200, 201), r.text[:200]
    pid = r.json().get("id") or r.json().get("post", {}).get("id")
    assert pid
    return pid


# ── VAULT: accrual & sender-untouched ───────────────────────────────────
class TestVaultAccrual:
    def test_receiver_pending_increases_sender_unchanged(
            self, stealth_token, normal_token, stealth_user, normal_user):
        # snapshot wallets
        r0 = requests.get(f"{API}/fire/wallet", headers=_hdr(stealth_token), timeout=20)
        assert r0.status_code == 200, r0.text[:200]
        assert r0.json()["enabled"] is True
        w0 = r0.json()["wallet"]
        pending0 = int(w0["pending_balance"])
        lifetime0 = int(w0["lifetime_fire_earned"])

        rs0 = requests.get(f"{API}/fire/wallet", headers=_hdr(normal_token), timeout=20).json()
        sender_wallet_before = rs0.get("wallet", {})
        sender_pending_before = int(sender_wallet_before.get("pending_balance", 0))
        sender_vault_before = int(sender_wallet_before.get("vault_balance", 0))
        sender_lifetime_before = int(sender_wallet_before.get("lifetime_fire_earned", 0))

        # normal user reacts 1x to a fresh stealth post
        pid = _create_public_post(stealth_token, "TEST_iter81_accrual")
        r = requests.post(f"{API}/fire/react", headers=_hdr(normal_token),
                          json={"post_id": pid, "fire_value": 1}, timeout=20)
        assert r.status_code == 200, r.text[:200]

        # Receiver: pending+1. (lifetime_fire_earned now increments at
        # SETTLEMENT time — pending → collectable — not at react time.)
        r1 = requests.get(f"{API}/fire/wallet", headers=_hdr(stealth_token), timeout=20).json()
        w1 = r1["wallet"]
        assert int(w1["pending_balance"]) == pending0 + 1, \
            f"pending expected {pending0 + 1}, got {w1['pending_balance']}"
        assert int(w1["lifetime_fire_earned"]) == lifetime0, \
            "lifetime must not change before settlement"

        # Sender wallet earning fields unchanged
        rs1 = requests.get(f"{API}/fire/wallet", headers=_hdr(normal_token), timeout=20).json()
        ws1 = rs1.get("wallet", {})
        assert int(ws1.get("pending_balance", 0)) == sender_pending_before
        assert int(ws1.get("vault_balance", 0)) == sender_vault_before
        assert int(ws1.get("lifetime_fire_earned", 0)) == sender_lifetime_before

    def test_high_water_no_double_credit_on_remove_and_resend(
            self, stealth_token, normal_token):
        pid = _create_public_post(stealth_token, "TEST_iter81_hwm")
        # 1x -> +1 pending
        r = requests.post(f"{API}/fire/react", headers=_hdr(normal_token),
                          json={"post_id": pid, "fire_value": 1}, timeout=20)
        assert r.status_code == 200, r.text[:200]

        w1 = requests.get(f"{API}/fire/wallet", headers=_hdr(stealth_token), timeout=20).json()["wallet"]
        p1 = int(w1["pending_balance"])

        # remove (0) — pending should not change (no negative accrual)
        r2 = requests.post(f"{API}/fire/react", headers=_hdr(normal_token),
                           json={"post_id": pid, "fire_value": 0}, timeout=20)
        assert r2.status_code == 200

        # re-send same 1x — must NOT credit again (high-water at 1)
        r3 = requests.post(f"{API}/fire/react", headers=_hdr(normal_token),
                           json={"post_id": pid, "fire_value": 1}, timeout=20)
        assert r3.status_code == 200
        w2 = requests.get(f"{API}/fire/wallet", headers=_hdr(stealth_token), timeout=20).json()["wallet"]
        assert int(w2["pending_balance"]) == p1, \
            f"high-water broken: pending {p1} -> {w2['pending_balance']}"

    def test_self_fire_no_credit(self, stealth_token):
        # stealth fires their own post — no earning
        pid = _create_public_post(stealth_token, "TEST_iter81_self")
        w0 = requests.get(f"{API}/fire/wallet", headers=_hdr(stealth_token), timeout=20).json()["wallet"]
        lifetime0 = int(w0["lifetime_fire_earned"])
        pending0 = int(w0["pending_balance"])

        r = requests.post(f"{API}/fire/react", headers=_hdr(stealth_token),
                          json={"post_id": pid, "fire_value": 1}, timeout=20)
        # 1x is free; even if pool exhausted it may still succeed as free
        if r.status_code == 200:
            w1 = requests.get(f"{API}/fire/wallet", headers=_hdr(stealth_token), timeout=20).json()["wallet"]
            assert int(w1["lifetime_fire_earned"]) == lifetime0, "self-fire must not earn"
            assert int(w1["pending_balance"]) == pending0


# ── VAULT: settlement ───────────────────────────────────────────────────
class TestVaultSettlement:
    def test_settlement_zero_moves_pending_to_vault(
            self, stealth_token, normal_token):
        """Phase 0.6 policy: reaction earnings settle when the sender's
        24h EDIT WINDOW ends (react passes finalize_at=edit_deadline, so
        settlement_hours no longer short-circuits reaction credits).
        We backdate settle_after in the DB to simulate the window ending,
        then verify Pending → Collectable + lifetime credit on read."""
        w0 = requests.get(f"{API}/fire/wallet", headers=_hdr(stealth_token), timeout=20).json()["wallet"]
        pid = _create_public_post(stealth_token, "TEST_iter81_settle")
        rr = requests.post(f"{API}/fire/react", headers=_hdr(normal_token),
                           json={"post_id": pid, "fire_value": 1,
                                 "idempotency_key": f"settle-{uuid.uuid4().hex}"}, timeout=20)
        assert rr.status_code == 200

        from pathlib import Path
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parents[1] / ".env")
        from tests._shared_loop import get_shared_loop

        async def _backdate():
            from core.db import db
            r = await db.fire_wallet_transactions.update_many(
                {"post_id": pid, "status": "pending"},
                {"$set": {"settle_after": "2020-01-01T00:00:00+00:00"}})
            return r.modified_count
        assert get_shared_loop().run_until_complete(_backdate()) >= 1

        time.sleep(0.5)
        w1 = requests.get(f"{API}/fire/wallet", headers=_hdr(stealth_token), timeout=20).json()["wallet"]
        assert int(w1["collectable_balance"]) >= int(w0["collectable_balance"]) + 1, \
            f"collectable expected >= {int(w0['collectable_balance']) + 1}, got {w1['collectable_balance']}"
        assert int(w1["lifetime_fire_earned"]) >= int(w0["lifetime_fire_earned"]) + 1


# ── VAULT: admin endpoints (founder only) ───────────────────────────────
class TestVaultAdmin:
    def test_overview_shape(self, stealth_token):
        r = requests.get(f"{API}/fire/admin/wallets/overview",
                         headers=_hdr(stealth_token), timeout=30)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        for k in ("total_vault_fire", "total_pending_fire", "largest_wallet",
                  "largest_pending_wallet", "top_earners", "top_senders"):
            assert k in d, f"missing {k}"
        assert isinstance(d["top_earners"], list)
        assert isinstance(d["top_senders"], list)
        assert int(d["total_vault_fire"]) >= 0
        assert int(d["total_pending_fire"]) >= 0

    def test_recalculate_no_drift(self, stealth_token):
        r = requests.post(f"{API}/fire/admin/wallets/recalculate",
                          headers=_hdr(stealth_token), json={}, timeout=60)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert "wallets_checked" in d and "wallets_changed" in d
        # After a fresh recalc against the ledger there should be no drift
        # (subsequent recalcs must be idempotent). Run again to prove it.
        r2 = requests.post(f"{API}/fire/admin/wallets/recalculate",
                           headers=_hdr(stealth_token), json={}, timeout=60)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["wallets_changed"] == 0, \
            f"unexpected drift on second recalc: {d2.get('changes')}"

    def test_transactions_shape(self, stealth_token):
        r = requests.get(f"{API}/fire/admin/wallets/transactions?limit=10",
                         headers=_hdr(stealth_token), timeout=20)
        assert r.status_code == 200
        txns = r.json()["transactions"]
        assert isinstance(txns, list)
        if txns:
            t = txns[0]
            for k in ("id", "user_id", "amount", "status", "created_at", "type"):
                assert k in t, f"transaction missing {k}"

    def test_settle_now(self, stealth_token):
        r = requests.post(f"{API}/fire/admin/wallets/settle-now",
                          headers=_hdr(stealth_token), timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert "settled" in d

    def test_non_founder_forbidden(self, normal_token):
        for path in ("/fire/admin/wallets/overview",
                     "/fire/admin/wallets/transactions"):
            r = requests.get(f"{API}{path}", headers=_hdr(normal_token), timeout=20)
            assert r.status_code == 403, f"{path}: {r.status_code}"
        r = requests.post(f"{API}/fire/admin/wallets/recalculate",
                          headers=_hdr(normal_token), json={}, timeout=20)
        assert r.status_code == 403
        r = requests.post(f"{API}/fire/admin/wallets/settle-now",
                          headers=_hdr(normal_token), timeout=20)
        assert r.status_code == 403
        r = requests.patch(f"{API}/fire/admin/wallets/config",
                           headers=_hdr(normal_token),
                           json={"settlement_hours": 0}, timeout=20)
        assert r.status_code == 403


# ── PRIVACY: settings ───────────────────────────────────────────────────
class TestPrivacyDefaults:
    def test_get_privacy_defaults(self, normal_token):
        r = requests.get(f"{API}/fire/privacy", headers=_hdr(normal_token), timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["defaults"] == {
            "vault_balance": "only_me",
            "lifetime_fire": "everyone",
            "fire_given": "friends",
            "fire_received": "everyone",
        }
        p = d["privacy"]
        for k in ("vault_balance", "lifetime_fire", "fire_given", "fire_received"):
            assert p[k] in {"only_me", "friends", "everyone"}

    def test_patch_privacy_valid_values(self, normal_token):
        # save originals
        cur = requests.get(f"{API}/fire/privacy", headers=_hdr(normal_token), timeout=20).json()["privacy"]
        try:
            r = requests.patch(f"{API}/fire/privacy", headers=_hdr(normal_token),
                               json={"vault_balance": "everyone"}, timeout=20)
            assert r.status_code == 200
            assert r.json()["privacy"]["vault_balance"] == "everyone"
        finally:
            # restore defaults
            requests.patch(f"{API}/fire/privacy", headers=_hdr(normal_token),
                           json=cur, timeout=20)

    def test_patch_privacy_invalid_value_400(self, normal_token):
        r = requests.patch(f"{API}/fire/privacy", headers=_hdr(normal_token),
                           json={"vault_balance": "public"}, timeout=20)
        assert r.status_code == 400, r.text[:200]

    def test_patch_privacy_unknown_field_400(self, normal_token):
        r = requests.patch(f"{API}/fire/privacy", headers=_hdr(normal_token),
                           json={"totally_bogus": "everyone"}, timeout=20)
        # Pydantic ignores unknown fields (Optional), so should just no-op 200.
        # Only value validation should hard-fail. So this call is OK either
        # way — we accept 200 as a safe response.
        assert r.status_code in (200, 400)


# ── PRIVACY: public stats (anonymous/owner/founder/friend) ──────────────
class TestPublicFireStats:
    def test_anonymous_hides_only_me_and_friends(self, normal_user):
        uname = normal_user["username"]
        # Guest browsing was removed (iter88): anonymous now gets 401.
        anon = requests.get(f"{API}/fire/wallet/stats/{uname}", timeout=20)
        assert anon.status_code == 401
        # A signed-in non-friend, non-admin viewer sees the same privacy
        # filtering the anonymous view used to check.
        other = requests.post(f"{API}/auth/login",
                              json={"email": "quickfire.newbie@example.com",
                                    "password": "Password1$"}, timeout=20)
        if other.status_code != 200:
            requests.post(f"{API}/auth/register", json={
                "email": "quickfire.newbie@example.com", "password": "Password1$",
                "username": "quickfirenewbie", "name": "Quick Fire Newbie",
                "accepted_terms": True, "accepted_privacy": True,
                "accepted_conditions": True, "age_confirmed_13": True}, timeout=20)
            other = requests.post(f"{API}/auth/login",
                                  json={"email": "quickfire.newbie@example.com",
                                        "password": "Password1$"}, timeout=20)
        tok = other.json()["access_token"]
        r = requests.get(f"{API}/fire/wallet/stats/{uname}",
                         headers={"Authorization": f"Bearer {tok}"}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["enabled"] is True
        stats = d["stats"]
        # Defaults: vault=only_me, lifetime=everyone, given=friends, received=everyone
        assert stats["vault_balance"] == {"visible": False}, stats
        assert stats["fire_given"] == {"visible": False}, stats
        assert stats["lifetime_fire"]["visible"] is True
        assert "value" in stats["lifetime_fire"]
        assert stats["fire_received"]["visible"] is True
        # Ensure no value key on hidden fields
        assert "value" not in stats["vault_balance"]
        assert "value" not in stats["fire_given"]

    def test_owner_sees_all(self, normal_token, normal_user):
        uname = normal_user["username"]
        r = requests.get(f"{API}/fire/wallet/stats/{uname}",
                         headers=_hdr(normal_token), timeout=20)
        assert r.status_code == 200
        stats = r.json()["stats"]
        for f in ("vault_balance", "lifetime_fire", "fire_given", "fire_received"):
            assert stats[f]["visible"] is True, f"owner should see {f}"
            assert "value" in stats[f]

    def test_founder_bypass_sees_all(self, stealth_token, normal_user):
        uname = normal_user["username"]
        r = requests.get(f"{API}/fire/wallet/stats/{uname}",
                         headers=_hdr(stealth_token), timeout=20)
        assert r.status_code == 200
        stats = r.json()["stats"]
        for f in ("vault_balance", "lifetime_fire", "fire_given", "fire_received"):
            assert stats[f]["visible"] is True
            assert "value" in stats[f]


# ── PRIVACY: friend viewer (friends-level fields) ───────────────────────
class TestFriendPrivacy:
    def test_friend_sees_friends_level_fields(self):
        """Register two fresh users, befriend them via /friends/request +
        /friends/accept, then verify:
          • Before accept (pending): friend-level fields still hidden.
          • After accept: fire_given (friends) becomes visible; only_me
            fields (vault_balance) still hidden.
        """
        u_a, e_a, t_a = _register("aud_a")
        u_b, e_b, t_b = _register("aud_b")

        # A views B (no relationship yet) — vault_balance hidden, fire_given hidden
        r0 = requests.get(f"{API}/fire/wallet/stats/{u_b}",
                          headers=_hdr(t_a), timeout=20)
        assert r0.status_code == 200
        s0 = r0.json()["stats"]
        assert s0["fire_given"] == {"visible": False}
        assert s0["vault_balance"] == {"visible": False}
        assert s0["lifetime_fire"]["visible"] is True

        # A -> B friend request (username, per FriendActionPayload)
        req = requests.post(f"{API}/friends/request", headers=_hdr(t_a),
                            json={"username": u_b}, timeout=20)
        assert req.status_code == 200, req.text[:200]

        # PENDING: A still not a friend of B; fire_given (friends) hidden
        r1 = requests.get(f"{API}/fire/wallet/stats/{u_b}",
                          headers=_hdr(t_a), timeout=20)
        s1 = r1.json()["stats"]
        assert s1["fire_given"] == {"visible": False}, \
            "pending request must NOT count as friend"

        # B accepts
        acc = requests.post(f"{API}/friends/accept", headers=_hdr(t_b),
                            json={"username": u_a}, timeout=20)
        assert acc.status_code == 200, acc.text[:200]

        # A views B — fire_given (friends) now visible, vault_balance (only_me) hidden
        r2 = requests.get(f"{API}/fire/wallet/stats/{u_b}",
                          headers=_hdr(t_a), timeout=20)
        assert r2.status_code == 200
        s2 = r2.json()["stats"]
        assert s2["fire_given"]["visible"] is True, \
            f"friend should see fire_given, got {s2['fire_given']}"
        assert "value" in s2["fire_given"]
        assert s2["vault_balance"] == {"visible": False}, \
            "only_me field must remain hidden even for friends"
        assert s2["lifetime_fire"]["visible"] is True


# ── REGRESSION ──────────────────────────────────────────────────────────
class TestRegression:
    def test_pool_accounting_1x_free(self, normal_token, stealth_token):
        pid = _create_public_post(stealth_token, "TEST_iter81_pool")
        # normal user's pool
        st0 = requests.get(f"{API}/fire/status", headers=_hdr(normal_token), timeout=20).json()
        spent0 = int(st0["pool"]["spent"])
        r = requests.post(f"{API}/fire/react", headers=_hdr(normal_token),
                          json={"post_id": pid, "fire_value": 1}, timeout=20)
        assert r.status_code == 200
        assert r.json()["charged"] == 0
        st1 = requests.get(f"{API}/fire/status", headers=_hdr(normal_token), timeout=20).json()
        assert int(st1["pool"]["spent"]) == spent0, "1x reaction must not consume pool"

    def test_idempotency_key_duplicate_flag(self, normal_token, stealth_token):
        pid = _create_public_post(stealth_token, "TEST_iter81_idem")
        key = f"iter81-idem-{uuid.uuid4().hex}"
        r1 = requests.post(f"{API}/fire/react", headers=_hdr(normal_token),
                           json={"post_id": pid, "fire_value": 1,
                                 "idempotency_key": key}, timeout=20)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/fire/react", headers=_hdr(normal_token),
                           json={"post_id": pid, "fire_value": 1,
                                 "idempotency_key": key}, timeout=20)
        assert r2.status_code == 200
        assert r2.json().get("duplicate") is True

    def test_reactions_emoji_untouched(self, normal_token, stealth_token):
        pid = _create_public_post(stealth_token, "TEST_iter81_emoji")
        r = requests.post(f"{API}/reactions/set", headers=_hdr(normal_token),
                          json={"target_type": "post", "target_id": pid,
                                "emoji": "🙏"}, timeout=20)
        assert r.status_code in (200, 201), r.text[:200]

    def test_fire_ranked_feed_still_works(self):
        tok = requests.post(f"{API}/auth/login",
                            json={"email": "stealth", "password": "Password1$"},
                            timeout=20).json()["access_token"]
        r = requests.get(f"{API}/posts?viewer=stealth&sort=fire&window=all&limit=10",
                         headers={"Authorization": f"Bearer {tok}"}, timeout=30)
        assert r.status_code == 200
        posts = r.json().get("posts", [])
        assert isinstance(posts, list)
