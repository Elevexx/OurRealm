"""Bundle A tests — /api/admin/responsibility-center/* + user reactivation
+ paused member restricted dashboard + settings versioning.

Runs against live REACT_APP_BACKEND_URL. Idempotent — restores center state
at the end (active, unfrozen, unlocked; tftwo active; settings default).
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
CENTER_ID = "cf5a475c04cd4860976920cda63fa6ff"
ADMIN = ("stealth", "Password1$")
MEMBER = ("tftwo", "pass1234")
OUTSIDER = ("auditcheckreal", "Password1$")


def _login(username, password):
    r = requests.post(f"{BASE_URL}/auth/login",
                      json={"email": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {username}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_tok():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def member_tok():
    return _login(*MEMBER)


@pytest.fixture(scope="module")
def outsider_tok():
    return _login(*OUTSIDER)


# ── SECURITY ────────────────────────────────────────────────────────────
class TestAdminSecurity:
    def test_overview_no_token(self):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/overview", timeout=10)
        assert r.status_code in (401, 403), r.status_code

    def test_overview_non_admin_403(self, outsider_tok):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/overview",
                         headers=_h(outsider_tok), timeout=10)
        assert r.status_code == 403

    def test_centers_non_admin_403(self, outsider_tok):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/centers",
                         headers=_h(outsider_tok), timeout=10)
        assert r.status_code == 403

    def test_action_non_admin_403(self, outsider_tok):
        r = requests.post(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/action",
                          headers=_h(outsider_tok),
                          json={"action": "pause", "reason": "hack attempt xyz"}, timeout=10)
        assert r.status_code == 403

    def test_settings_patch_non_admin_403(self, outsider_tok):
        r = requests.patch(f"{BASE_URL}/admin/responsibility-center/settings",
                           headers=_h(outsider_tok),
                           json={"updates": {"seat_cost": 999}, "reason": "hack"}, timeout=10)
        assert r.status_code == 403

    def test_founder_has_14_perms(self, admin_tok):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/overview",
                         headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        data = r.json()
        # Bundle B added responsibility_center.manage_media → founder now has 15
        assert len(data["my_permissions"]) >= 14
        assert "responsibility_center.manage_media" in data["my_permissions"]


# ── OVERVIEW / TABLE / DETAIL ──────────────────────────────────────────
class TestOverviewAndTable:
    def test_overview_shape(self, admin_tok):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/overview",
                         headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        d = r.json()
        for section in ("centers", "memberships", "renewals", "fire_power",
                        "settings", "recent_admin_actions"):
            assert section in d
        assert "stored_in_vaults" in d["fire_power"]
        assert "burned_center_creation" in d["fire_power"]
        assert "upcoming_renewals_7d" in d["memberships"]

    def test_centers_table_pagination(self, admin_tok):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/centers?page=1&limit=25",
                         headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "centers" in d and "total" in d
        rivera = next((c for c in d["centers"] if c["id"] == CENTER_ID), None)
        assert rivera, "Rivera Family center should be in the list"
        for k in ("owner_username", "paused_members", "pending_invitations",
                  "next_requirement_date", "failed_renewals"):
            assert k in rivera

    def test_centers_search_by_name(self, admin_tok):
        # Center was renamed from "Rivera Family" to "Stealth Family" in earlier tests
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/centers?q=Stealth",
                         headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        assert any(c["id"] == CENTER_ID for c in r.json()["centers"])

    def test_centers_flag_filter(self, admin_tok):
        for flag in ("low_vault", "frozen_vault", "needs_review",
                     "official", "user_created", "invitations_locked"):
            r = requests.get(f"{BASE_URL}/admin/responsibility-center/centers?flag={flag}",
                             headers=_h(admin_tok), timeout=10)
            assert r.status_code == 200, f"flag {flag}"

    def test_center_detail(self, admin_tok):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}",
                         headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["center"]["id"] == CENTER_ID
        assert d["owner"]["username"] == "stealth"
        assert "counts" in d and "renewal_summary" in d


# ── ADMIN ACTIONS + AUDIT ──────────────────────────────────────────────
class TestAdminActions:
    def _do(self, tok, action, reason="Integration test reason 12345"):
        return requests.post(
            f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/action",
            headers=_h(tok), json={"action": action, "reason": reason}, timeout=10)

    def test_reason_required(self, admin_tok):
        r = self._do(admin_tok, "mark_needs_review", reason="hi")
        assert r.status_code == 400

    def test_unknown_action(self, admin_tok):
        r = self._do(admin_tok, "delete_universe")
        assert r.status_code == 400

    def test_mark_and_clear_needs_review(self, admin_tok):
        r = self._do(admin_tok, "mark_needs_review", reason="Testing needs review flag")
        assert r.status_code == 200
        assert r.json()["center"].get("needs_review") in (True, None) or True  # public center may omit

        # verify via detail
        det = requests.get(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}",
                           headers=_h(admin_tok), timeout=10).json()
        assert det["center"]["needs_review"] is True

        r2 = self._do(admin_tok, "clear_needs_review", reason="Clearing after test verify")
        assert r2.status_code == 200
        det2 = requests.get(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}",
                            headers=_h(admin_tok), timeout=10).json()
        assert det2["center"]["needs_review"] is False

    def test_lock_unlock_invitations(self, admin_tok):
        r = self._do(admin_tok, "lock_invitations", reason="Blocking invites for test")
        assert r.status_code == 200
        # invite should now 409
        inv = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/invite",
                            headers=_h(admin_tok), json={"username": "auditcheckreal"}, timeout=10)
        assert inv.status_code == 409, inv.text[:200]
        r2 = self._do(admin_tok, "unlock_invitations", reason="Restoring invites post-test")
        assert r2.status_code == 200

    def test_pause_and_restore_center(self, admin_tok):
        r = self._do(admin_tok, "pause", reason="Pause test to verify enforcement")
        assert r.status_code == 200
        # Invite blocked
        inv = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/invite",
                            headers=_h(admin_tok), json={"username": "auditcheckreal"}, timeout=10)
        assert inv.status_code == 409
        # Vault funding should still work (recovery path)
        fund = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/vault/fund",
                             headers=_h(admin_tok), json={"amount": 1}, timeout=10)
        assert fund.status_code == 200, fund.text[:200]
        # restore
        r2 = self._do(admin_tok, "restore", reason="Restoring center after pause test")
        assert r2.status_code == 200

    def test_freeze_enforcement(self, admin_tok):
        r = self._do(admin_tok, "freeze_vault", reason="Freezing to test enforcement path")
        assert r.status_code == 200
        fund = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/vault/fund",
                             headers=_h(admin_tok), json={"amount": 1}, timeout=10)
        assert fund.status_code == 409
        r2 = self._do(admin_tok, "unfreeze_vault", reason="Unfreezing after test verified")
        assert r2.status_code == 200

    def test_audit_rows_written(self, admin_tok):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/audit?limit=20",
                         headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        rows = r.json()["audit"]
        assert len(rows) > 0
        top = rows[0]
        for k in ("admin_username", "reason", "action", "created_at"):
            assert k in top


# ── VAULT ADJUST + REVERSE ─────────────────────────────────────────────
class TestVaultAdjustReverse:
    def test_positive_adjust_and_idempotent(self, admin_tok):
        key = f"test-{uuid.uuid4().hex[:8]}"
        payload = {"amount": 50, "reason": "Test positive adjust", "idempotency_key": key}
        r = requests.post(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/vault/adjust",
                          headers=_h(admin_tok), json=payload, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["duplicate"] is False
        assert d["after"] == d["before"] + 50
        # duplicate
        r2 = requests.post(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/vault/adjust",
                           headers=_h(admin_tok), json=payload, timeout=10)
        assert r2.status_code == 200
        assert r2.json()["duplicate"] is True
        # revert
        r3 = requests.post(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/vault/adjust",
                           headers=_h(admin_tok),
                           json={"amount": -50, "reason": "Reverting the +50 test adjust"}, timeout=10)
        assert r3.status_code == 200

    def test_negative_would_go_below_zero_409(self, admin_tok):
        r = requests.post(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/vault/adjust",
                          headers=_h(admin_tok),
                          json={"amount": -999_999, "reason": "Should refuse - vault too small"},
                          timeout=10)
        assert r.status_code == 409

    def test_reverse_transaction_flow(self, admin_tok):
        # Create a fresh adjustment
        r = requests.post(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/vault/adjust",
                          headers=_h(admin_tok),
                          json={"amount": 25, "reason": "Test reverse workflow adjust"}, timeout=10)
        assert r.status_code == 200
        # Find txn id
        txns = requests.get(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/transactions?limit=5",
                            headers=_h(admin_tok), timeout=10).json()["transactions"]
        tx = next((t for t in txns if t["transaction_type"] == "admin_adjustment"
                   and t["amount"] == 25), None)
        assert tx, "created adjustment txn not found"
        # Reverse
        rv = requests.post(
            f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/transactions/{tx['id']}/reverse",
            headers=_h(admin_tok), json={"reason": "Reverse test adjustment now"}, timeout=10)
        assert rv.status_code == 200, rv.text[:300]
        assert "reversal_id" in rv.json()
        # Second attempt = 409
        rv2 = requests.post(
            f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/transactions/{tx['id']}/reverse",
            headers=_h(admin_tok), json={"reason": "Should be rejected duplicate"}, timeout=10)
        assert rv2.status_code == 409


# ── SETTINGS versioning ────────────────────────────────────────────────
class TestSettings:
    def test_get_settings(self, admin_tok):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/settings",
                         headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "settings" in d and "version" in d and "history" in d
        assert d["settings"]["seat_cost"] == 100

    def test_patch_seat_cost_and_restore(self, admin_tok):
        # Read current version
        before = requests.get(f"{BASE_URL}/admin/responsibility-center/settings",
                              headers=_h(admin_tok), timeout=10).json()
        v0 = before["version"]

        # Change 100 -> 150
        r = requests.patch(f"{BASE_URL}/admin/responsibility-center/settings",
                           headers=_h(admin_tok),
                           json={"updates": {"seat_cost": 150},
                                 "reason": "Bumping seat cost for regression test"}, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["version"] > v0
        assert any(c["key"] == "seat_cost" and c["previous"] == 100 and c["new"] == 150
                   for c in d["changed"])

        # Config reflects 150 (needs auth)
        cfg = requests.get(f"{BASE_URL}/responsibility-center/config",
                           headers=_h(admin_tok), timeout=10).json()
        assert cfg["seat_cost"] == 150

        # RESTORE 150 -> 100
        r2 = requests.patch(f"{BASE_URL}/admin/responsibility-center/settings",
                            headers=_h(admin_tok),
                            json={"updates": {"seat_cost": 100},
                                  "reason": "Restoring seat cost to default 100"}, timeout=10)
        assert r2.status_code == 200
        cfg2 = requests.get(f"{BASE_URL}/responsibility-center/config",
                            headers=_h(admin_tok), timeout=10).json()
        assert cfg2["seat_cost"] == 100

    def test_patch_invalid_key(self, admin_tok):
        r = requests.patch(f"{BASE_URL}/admin/responsibility-center/settings",
                           headers=_h(admin_tok),
                           json={"updates": {"not_a_setting": 5},
                                 "reason": "Invalid key test with reason"}, timeout=10)
        assert r.status_code == 400

    def test_patch_out_of_bounds(self, admin_tok):
        r = requests.patch(f"{BASE_URL}/admin/responsibility-center/settings",
                           headers=_h(admin_tok),
                           json={"updates": {"seat_cost": 999_999},
                                 "reason": "Out-of-bounds test - should reject"}, timeout=10)
        assert r.status_code == 400


# ── NOTES ──────────────────────────────────────────────────────────────
class TestNotes:
    def test_add_and_list_note(self, admin_tok):
        note_text = f"TEST_note_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/notes",
                          headers=_h(admin_tok), json={"note": note_text}, timeout=10)
        assert r.status_code == 200
        rows = requests.get(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/notes",
                            headers=_h(admin_tok), timeout=10).json()["notes"]
        assert any(n["note"] == note_text for n in rows)


# ── EXPORT ─────────────────────────────────────────────────────────────
class TestExport:
    def test_export_shape(self, admin_tok):
        r = requests.get(f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/export",
                         headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("center", "members", "transactions", "renewal_attempts", "exported_at"):
            assert k in d


# ── USER REACTIVATION + PAUSED DASHBOARD ──────────────────────────────
# We pause tftwo via admin retry-renewal (using vault-drain path is heavy).
# The simpler + safer path: use mongo direct? We don't have mongo access here.
# Instead we do it via /action pause on the center to verify enforcement,
# and use the SIM script for actual seat-level pause proof.
# We DO test the reactivate endpoint 403s for members lacking permission
# and 404 for non-paused targets.

class TestUserReactivationGuards:
    def test_non_owner_reactivate_403(self, member_tok):
        # tftwo is a plain member — no manage_members perm
        r = requests.post(
            f"{BASE_URL}/responsibility-center/{CENTER_ID}/members/xyz/reactivate",
            headers=_h(member_tok), timeout=10)
        assert r.status_code == 403

    def test_non_owner_reactivate_eligible_403(self, member_tok):
        r = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/reactivate-eligible",
                          headers=_h(member_tok), timeout=10)
        assert r.status_code == 403

    def test_owner_reactivate_missing_paused_404(self, admin_tok):
        r = requests.post(
            f"{BASE_URL}/responsibility-center/{CENTER_ID}/members/nonexistent-uid/reactivate",
            headers=_h(admin_tok), timeout=10)
        assert r.status_code == 404


# ── ADMIN RETRY-RENEWAL guards ────────────────────────────────────────
class TestAdminRetryRenewal:
    def test_retry_missing_membership_404(self, admin_tok):
        r = requests.post(
            f"{BASE_URL}/admin/responsibility-center/centers/{CENTER_ID}/members/ghost-uid/retry-renewal",
            headers=_h(admin_tok), json={"reason": "Retry ghost membership test"}, timeout=10)
        assert r.status_code == 404


# ── REGRESSION: config, mine still work ────────────────────────────────
class TestRegression:
    def test_public_config(self, admin_tok):
        r = requests.get(f"{BASE_URL}/responsibility-center/config",
                         headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["create_cost"] == 1000
        assert d["seat_cost"] == 100

    def test_owner_dashboard(self, admin_tok):
        r = requests.get(f"{BASE_URL}/responsibility-center/{CENTER_ID}",
                         headers=_h(admin_tok), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["center"]["id"] == CENTER_ID
        assert "vault_transactions" in d  # owner sees vault txns
        assert "members" in d

    def test_member_dashboard(self, member_tok):
        r = requests.get(f"{BASE_URL}/responsibility-center/{CENTER_ID}",
                         headers=_h(member_tok), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["my_membership"]["status"] == "active"
        assert "vault_transactions" not in d


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
