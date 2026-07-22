"""Iteration 86 — FIRE UP 🔥 Vault → Daily Pool refill system.
Covers: anon gating, cooldown response shape, idempotent replay,
full transfer lifecycle (partial refill via pool deficit), race
concurrency, recovery preservation, privacy filtering (non-friend
must NEVER see fire_up/vault/cooldown), admin inspector fire_up block.

Uses the public REACT_APP_BACKEND_URL. Idempotent — cleans up its own
posts where practical and always calls admin recalculate at the end
to leave the ledger in a consistent state.
"""
import asyncio
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

STEALTH = {"email": "stealth", "password": "Password1$"}
AUDIT = {"email": "auditcheckreal", "password": "Password1$"}
TFTWO = {"email": "tftwo", "password": "pass1234"}


# ── Helpers ─────────────────────────────────────────────────────────────
def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


async def _reset_stealth_cooldown():
    """Set stealth's last_fire_up_at 25h ago so cooldown is cleared."""
    from datetime import datetime, timezone, timedelta
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]
    u = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
    old = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    await db.fire_wallets.update_one(
        {"user_id": u["id"]}, {"$set": {"last_fire_up_at": old}}
    )
    c.close()


def reset_stealth_cooldown():
    asyncio.run(_reset_stealth_cooldown())


async def _fetch_stealth_active_recovery():
    """Return the current active fire_power_transactions row for stealth
    (there may be one 24h recovery entry present)."""
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]
    u = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
    rows = [r async for r in db.fire_power_transactions.find(
        {"user_id": u["id"], "status": "active"}, {"_id": 0}).sort("expires_at", 1)]
    c.close()
    return rows


def fetch_stealth_active_recovery():
    return asyncio.run(_fetch_stealth_active_recovery())


@pytest.fixture(scope="module")
def tokens():
    return {
        "stealth": _login(STEALTH),
        "audit": _login(AUDIT),
        "tftwo": _login(TFTWO),
    }


def _wallet(token):
    r = requests.get(f"{API}/fire/wallet", headers=_hdr(token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _preview(token):
    r = requests.get(f"{API}/fire/fire-up/preview", headers=_hdr(token), timeout=15)
    return r


def _fire_up(token, key):
    return requests.post(f"{API}/fire/fire-up",
                         json={"idempotency_key": key},
                         headers=_hdr(token), timeout=20)


def _create_post(token, prefix="iter86"):
    r = requests.post(f"{API}/posts",
                      json={"content": f"{prefix} test post {uuid.uuid4().hex[:8]}",
                            "audience": {"visibility": "public"}},
                      headers=_hdr(token), timeout=15)
    assert r.status_code in (200, 201), f"create post failed {r.status_code}: {r.text[:200]}"
    j = r.json()
    return j.get("id") or j.get("post", {}).get("id")


def _react(token, post_id, value):
    r = requests.post(f"{API}/fire/react",
                      json={"post_id": post_id, "fire_value": value},
                      headers=_hdr(token), timeout=15)
    return r


# ── 1. Anonymous access ─────────────────────────────────────────────────
class TestAnonymous:
    def test_preview_requires_auth(self):
        r = requests.get(f"{API}/fire/fire-up/preview", timeout=15)
        assert r.status_code == 401

    def test_execute_requires_auth(self):
        r = requests.post(f"{API}/fire/fire-up", json={}, timeout=15)
        assert r.status_code == 401


# ── 2. Cooldown state (as-shipped, stealth is on cooldown) ─────────────
class TestCooldownState:
    def test_preview_shows_cooldown_shape(self, tokens):
        r = _preview(tokens["stealth"])
        assert r.status_code == 200, r.text
        j = r.json()
        # If freshly reset by another test, this preview MAY be eligible.
        # In that case skip — the coldown-shape assertions are only valid
        # when stealth is actually on cooldown.
        if j.get("eligible"):
            pytest.skip("stealth is not on cooldown right now")
        assert j["reason"] == "cooldown"
        assert j["cooldown_seconds_remaining"] > 0
        assert j.get("next_fire_up_at"), "next_fire_up_at must be present"
        # Amount + resulting values are frozen while on cooldown
        assert j["calculated_transfer_amount"] == 0

    def test_execute_during_cooldown_returns_409_and_no_vault_change(self, tokens):
        # Only run if actually on cooldown right now.
        pv = _preview(tokens["stealth"]).json()
        if pv.get("eligible"):
            pytest.skip("stealth is not on cooldown right now")
        vault_before = _wallet(tokens["stealth"])["wallet"]["vault_balance"]
        r = _fire_up(tokens["stealth"], f"cooldown-check-{uuid.uuid4().hex[:8]}")
        assert r.status_code == 409, f"expected 409 got {r.status_code}: {r.text}"
        detail = r.json().get("detail")
        assert isinstance(detail, dict), f"detail should be object, got {detail}"
        assert detail.get("reason") == "cooldown"
        assert "next_fire_up_at" in detail
        assert "cooldown_seconds_remaining" in detail
        vault_after = _wallet(tokens["stealth"])["wallet"]["vault_balance"]
        assert vault_before == vault_after, f"vault changed on 409: {vault_before} → {vault_after}"


# ── 3. Idempotent replay ────────────────────────────────────────────────
class TestIdempotentReplay:
    def test_race_a_1_replay_or_fresh_execution(self, tokens):
        """The key 'race-A-1' was seeded by the main agent as an already-
        completed transfer. Replaying it MUST return idempotent_replay=
        True and MUST NOT change the current vault balance."""
        # Confirm the key exists in transactions
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")

        async def _check():
            c = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = c[os.environ["DB_NAME"]]
            u = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1})
            prev = await db.fire_wallet_transactions.find_one(
                {"user_id": u["id"], "type": "fire_up",
                 "idempotency_key": "race-A-1"}, {"_id": 0})
            c.close()
            return prev

        prev_txn = asyncio.run(_check())
        if not prev_txn:
            pytest.skip("race-A-1 idempotency key not seeded in DB")

        vault_before = _wallet(tokens["stealth"])["wallet"]["vault_balance"]
        r = _fire_up(tokens["stealth"], "race-A-1")
        assert r.status_code == 200, f"replay expected 200, got {r.status_code}: {r.text}"
        j = r.json()
        assert j["success"] is True
        assert j["idempotent_replay"] is True
        assert j["transferred_amount"] == int(prev_txn["amount"])
        vault_after = _wallet(tokens["stealth"])["wallet"]["vault_balance"]
        assert vault_before == vault_after, "replay must NOT change vault"


# ── 4. Full lifecycle (needs cooldown reset + pool deficit) ────────────
class TestFullLifecycle:
    def test_reset_cooldown_and_create_deficit_and_transfer(self, tokens):
        # Step 1: reset cooldown
        reset_stealth_cooldown()

        # Step 2: preview with a full pool (level 4, pool_max 50). Since
        # nothing was spent yet after reset, pool is likely full →
        # eligible=false reason=pool_full.
        # Create a pool deficit by firing a boosted 3 on a new post →
        # spends 2 boosted → pool becomes 48/50.
        post_id = _create_post(tokens["audit"], "iter86-deficit")
        r_react = _react(tokens["stealth"], post_id, 3)
        assert r_react.status_code == 200, r_react.text

        # Snapshot state before
        wallet_before = _wallet(tokens["stealth"])
        vault_before = wallet_before["wallet"]["vault_balance"]
        pool_before = wallet_before["pool"]["available"]
        pool_max = wallet_before["pool"]["pool_max"]
        deficit = pool_max - pool_before
        assert deficit == 2, f"expected deficit=2, got {deficit} (pool {pool_before}/{pool_max})"

        # Also capture active recovery row (should be created by the react)
        recovery_before = fetch_stealth_active_recovery()

        # Preview must now be eligible with calculated_transfer_amount=deficit
        pv = _preview(tokens["stealth"]).json()
        assert pv["eligible"] is True, f"expected eligible=True, got {pv}"
        assert pv["reason"] is None
        assert pv["calculated_transfer_amount"] == deficit
        assert pv["resulting_daily_available"] == pool_max
        assert pv["resulting_vault_balance"] == vault_before - deficit

        # Step 3: fire up
        key1 = f"iter86-fu-{uuid.uuid4().hex[:8]}"
        r = _fire_up(tokens["stealth"], key1)
        assert r.status_code == 200, f"fire-up failed {r.status_code}: {r.text}"
        j = r.json()
        assert j["success"] is True
        assert j["idempotent_replay"] is False
        assert j["transferred_amount"] == deficit
        assert j["vault_balance_before"] == vault_before
        assert j["vault_balance_after"] == vault_before - deficit
        assert j["daily_available_before"] == pool_before
        assert j["daily_available_after"] == pool_max
        assert j["daily_pool_max"] == pool_max
        assert j.get("transaction_id"), "transaction_id missing"
        assert j.get("next_fire_up_at"), "next_fire_up_at missing"

        # Step 4: wallet reflects the change
        w2 = _wallet(tokens["stealth"])["wallet"]
        assert w2["vault_balance"] == vault_before - deficit

        # Step 5: retry with a NEW key → 409 cooldown
        r2 = _fire_up(tokens["stealth"], f"iter86-cd-{uuid.uuid4().hex[:8]}")
        assert r2.status_code == 409, f"expected 409 immediately after fire-up, got {r2.status_code}: {r2.text}"
        assert r2.json()["detail"]["reason"] == "cooldown"

        # Step 6: replay first key returns idempotent replay
        r3 = _fire_up(tokens["stealth"], key1)
        assert r3.status_code == 200
        assert r3.json()["idempotent_replay"] is True
        assert r3.json()["transferred_amount"] == deficit

        # Step 7: wallet history contains a fire_up row with matching before/after
        h = requests.get(f"{API}/fire/wallet/history?filter=all",
                         headers=_hdr(tokens["stealth"]), timeout=15).json()
        fu_rows = [t for t in h.get("history", []) if t.get("type") == "fire_up"]
        assert fu_rows, "no fire_up row in wallet history"
        latest = fu_rows[0]
        assert latest["amount"] == deficit
        assert latest["daily_available_before"] == pool_before
        assert latest["daily_available_after"] == pool_max
        assert latest["vault_balance_before"] == vault_before
        assert latest["vault_balance_after"] == vault_before - deficit

        # Step 8: exactly one fire_up_complete notification for this txn
        n = requests.get(f"{API}/notifications/list",
                         headers=_hdr(tokens["stealth"]), timeout=15).json()
        rows = n.get("notifications", [])
        fu_notifs = [x for x in rows
                     if x.get("kind") == "fire_up_complete"
                     and (x.get("payload") or {}).get("transaction_id") == j["transaction_id"]]
        assert len(fu_notifs) == 1, f"expected 1 fire_up_complete for txn, got {len(fu_notifs)}"

        # Step 9: recovery preservation — the active row from the react
        # (fire_power_transactions status=active) must still exist with
        # UNCHANGED expires_at.
        recovery_after = fetch_stealth_active_recovery()
        # Match by id (or expires_at)
        by_id = {r["id"]: r for r in recovery_after if r.get("id")}
        for row in recovery_before:
            rid = row.get("id")
            if not rid:
                continue
            assert rid in by_id, f"recovery row {rid} disappeared after fire-up"
            assert by_id[rid].get("expires_at") == row.get("expires_at"), \
                f"expires_at changed on recovery row {rid}"


# ── 5. Race concurrency ────────────────────────────────────────────────
class TestRace:
    def test_two_simultaneous_fire_ups_exactly_one_success(self, tokens):
        # Reset cooldown + create pool deficit again
        reset_stealth_cooldown()

        # Wait a bit so the previous /react high-water-mark doesn't block
        # a new deficit (use a NEW post).
        post_id = _create_post(tokens["audit"], "iter86-race")
        rx = _react(tokens["stealth"], post_id, 2)
        assert rx.status_code == 200, rx.text

        wallet_before = _wallet(tokens["stealth"])
        vault_before = wallet_before["wallet"]["vault_balance"]
        pool_before = wallet_before["pool"]["available"]
        pool_max = wallet_before["pool"]["pool_max"]
        deficit = pool_max - pool_before
        assert deficit == 1, f"expected deficit=1 for value=2 react, got {deficit}"

        key_a = f"iter86-race-A-{uuid.uuid4().hex[:6]}"
        key_b = f"iter86-race-B-{uuid.uuid4().hex[:6]}"

        with ThreadPoolExecutor(max_workers=2) as ex:
            fa = ex.submit(_fire_up, tokens["stealth"], key_a)
            fb = ex.submit(_fire_up, tokens["stealth"], key_b)
            ra = fa.result()
            rb = fb.result()

        codes = sorted([ra.status_code, rb.status_code])
        assert codes == [200, 409], f"expected [200,409] got {codes}: {ra.text[:120]} | {rb.text[:120]}"
        # Exactly one recorded a real transfer
        winner = ra if ra.status_code == 200 else rb
        j = winner.json()
        assert j["success"] is True and j["idempotent_replay"] is False
        assert j["transferred_amount"] == deficit

        # Vault decreased by exactly `deficit`
        vault_after = _wallet(tokens["stealth"])["wallet"]["vault_balance"]
        assert vault_after == vault_before - deficit, \
            f"vault should decrease exactly {deficit}: {vault_before} → {vault_after}"


# ── 6. Privacy (non-friend viewer + admin gate) ────────────────────────
class TestPrivacy:
    def test_non_friend_wallet_stats_hides_fire_up_and_vault(self, tokens):
        r = requests.get(f"{API}/fire/wallet/stats/stealth",
                         headers=_hdr(tokens["tftwo"]), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        # Top-level MUST NOT contain fire_up / wallet / pool / cooldown / last_fire_up
        forbidden_top = {"fire_up", "wallet", "pool", "cooldown",
                         "last_fire_up_at", "next_fire_up_at",
                         "cooldown_seconds_remaining"}
        assert not (set(j.keys()) & forbidden_top), f"leaked top-level: {set(j.keys()) & forbidden_top}"
        # vault_balance must be {visible:False} with NO value
        stats = j.get("stats", {})
        vb = stats.get("vault_balance", {})
        assert vb.get("visible") is False
        assert "value" not in vb
        # Recursive scan for any 'fire_up' / 'last_fire_up' / 'cooldown' / vault number leakage
        import json as _json
        blob = _json.dumps(j).lower()
        assert "fire_up" not in blob, f"fire_up leaked in JSON: {blob[:400]}"
        assert "cooldown" not in blob
        assert "last_fire_up" not in blob
        # Vault balance number (972) must NOT appear anywhere for non-friend
        # (careful: 972 could theoretically appear in another field — but for
        # stealth this is a distinctive value.)
        assert "972" not in blob, "vault balance value leaked to non-friend"

    def test_admin_inspector_forbidden_for_non_admin(self, tokens):
        r = requests.get(f"{API}/fire/admin/inspect/user/stealth",
                         headers=_hdr(tokens["tftwo"]), timeout=15)
        assert r.status_code in (403, 404), f"expected 403/404 got {r.status_code}: {r.text}"

    def test_admin_inspector_ok_for_founder_contains_fire_up_block(self, tokens):
        r = requests.get(f"{API}/fire/admin/inspect/user/stealth",
                         headers=_hdr(tokens["stealth"]), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "fire_up" in j, f"admin inspector missing fire_up block: keys={list(j.keys())}"
        fu = j["fire_up"]
        # Must contain history + last_fire_up_at + next_fire_up_at
        assert "history" in fu
        assert isinstance(fu["history"], list)
        assert "last_fire_up_at" in fu
        assert "next_fire_up_at" in fu
        # History must contain at least one row after our full-lifecycle test ran
        assert len(fu["history"]) >= 1


# ── 99. Cleanup — recalculate stealth's wallet at end ──────────────────
def test_zzz_final_recalculate(tokens):
    """Always leave stealth's ledger consistent — main agent asked us to
    POST /api/fire/admin/wallets/recalculate at the end of the run."""
    r = requests.post(f"{API}/fire/admin/wallets/recalculate",
                      json={"username": "stealth", "reason": "iter86 test cleanup"},
                      headers=_hdr(tokens["stealth"]), timeout=30)
    assert r.status_code in (200, 201), f"recalculate failed {r.status_code}: {r.text[:200]}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
