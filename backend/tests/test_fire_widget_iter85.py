"""Iteration 85 — Fire Power Widget Upgrade + Public Profile
Backend security + notification lifecycle + accounting regression.
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

STEALTH = {"email": "stealth", "password": "Password1$"}
AUDIT = {"email": "auditcheckreal", "password": "Password1$"}
TFTWO = {"email": "tftwo", "password": "pass1234"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _auth_hdr(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def tokens():
    return {
        "stealth": _login(STEALTH),
        "audit": _login(AUDIT),
        "tftwo": _login(TFTWO),
    }


# ── 1. Anonymous access → 401 on private endpoints ──────────────────────
class TestAnonymousAccess:
    def test_wallet_requires_auth(self):
        r = requests.get(f"{API}/fire/wallet", timeout=15)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text}"

    def test_wallet_history_requires_auth(self):
        r = requests.get(f"{API}/fire/wallet/history", timeout=15)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text}"

    def test_wallet_collect_requires_auth(self):
        r = requests.post(f"{API}/fire/wallet/collect", json={"collect_all": True}, timeout=15)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text}"


# ── 2. Public stats privacy filter (non-friend viewer sees NO values) ──
class TestPublicStatsPrivacy:
    def test_non_friend_viewer_gets_visible_false_no_value(self, tokens):
        """tftwo is NOT friend of auditcheckreal → private fields must be
        {visible: false} with NO 'value' key. public_summary must be present."""
        r = requests.get(f"{API}/fire/wallet/stats/auditcheckreal",
                         headers=_auth_hdr(tokens["tftwo"]), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("enabled") is True
        assert j.get("username") == "auditcheckreal"
        # public_summary present with the 4 required fields
        ps = j.get("public_summary")
        assert ps is not None
        for k in ("level_number", "level_name", "level_badge_url", "max_fire_per_reaction"):
            assert k in ps, f"public_summary missing {k}"
        stats = j.get("stats", {})
        # vault_balance: default only_me → hidden to non-friend
        vb = stats.get("vault_balance", {})
        assert vb.get("visible") is False, f"vault_balance should be hidden, got {vb}"
        assert "value" not in vb, f"vault_balance MUST NOT contain 'value' key to non-friend, got {vb}"
        # fire_given: default friends → hidden to non-friend
        fg = stats.get("fire_given", {})
        assert fg.get("visible") is False, f"fire_given should be hidden, got {fg}"
        assert "value" not in fg
        # fire_collected: privacy_map → vault_balance → hidden
        fc = stats.get("fire_collected", {})
        assert fc.get("visible") is False, f"fire_collected should be hidden, got {fc}"
        assert "value" not in fc
        # fire_received: default everyone → visible
        fr = stats.get("fire_received", {})
        assert fr.get("visible") is True
        assert "value" in fr and isinstance(fr["value"], int)
        # Top-level response must NOT include pool/pending/collectable/wallet
        forbidden = {"pool", "pending_balance", "collectable_balance", "wallet"}
        assert not (set(j.keys()) & forbidden), f"Response leaked private keys: {set(j.keys()) & forbidden}"

    def test_owner_sees_all_values_visible(self, tokens):
        r = requests.get(f"{API}/fire/wallet/stats/auditcheckreal",
                         headers=_auth_hdr(tokens["audit"]), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["stats"]["vault_balance"]["visible"] is True
        assert "value" in j["stats"]["vault_balance"]


# ── 3. Notification lifecycle (single grouped row, upsert, resolve) ────
class TestFireNotificationLifecycle:
    """A creates post → stealth fires → force-finalize → single unresolved
    notification. Second cycle updates same id. Collect resolves. Third
    fires+finalize creates a NEW notification id."""

    def _create_post(self, token):
        payload = {"content": f"iter85 test post {uuid.uuid4().hex[:8]}",
                   "audience": {"visibility": "public"}}
        r = requests.post(f"{API}/posts", json=payload, headers=_auth_hdr(token), timeout=15)
        assert r.status_code in (200, 201), f"create post failed {r.status_code}: {r.text}"
        return r.json().get("id") or r.json().get("post", {}).get("id")

    def _fire(self, token, post_id, value=3):
        r = requests.post(f"{API}/fire/react",
                          json={"post_id": post_id, "fire_value": value},
                          headers=_auth_hdr(token), timeout=15)
        assert r.status_code == 200, f"fire failed {r.status_code}: {r.text}"
        return r.json()

    def _finalize(self, founder_token, username):
        r = requests.post(f"{API}/fire/admin/users/{username}/finalize-pending",
                          json={"reason": "iter85 test"},
                          headers=_auth_hdr(founder_token), timeout=15)
        assert r.status_code == 200, f"finalize failed {r.status_code}: {r.text}"
        return r.json()

    def _get_fire_notifs(self, token):
        r = requests.get(f"{API}/notifications/list",
                         headers=_auth_hdr(token), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json().get("notifications", [])
        return [n for n in rows if n.get("kind") == "fire_collectable"]

    def test_full_lifecycle(self, tokens):
        # Preconditions: enable fire_notifications flag as founder (idempotent)
        for flag in ("fire_reactions", "fire_wallet_enabled",
                     "fire_pending_enabled", "fire_collectable_enabled",
                     "fire_collection_enabled", "fire_notifications"):
            requests.patch(f"{API}/fire/admin/flags",
                           json={"key": flag, "value": True},
                           headers=_auth_hdr(tokens["stealth"]), timeout=15)

        # Clean out any prior unresolved fire_collectable rows for audit by
        # first collecting whatever collectable balance is there (idempotent).
        requests.post(f"{API}/fire/wallet/collect", json={"collect_all": True},
                      headers=_auth_hdr(tokens["audit"]), timeout=15)

        # A = audit posts, stealth fires it (first low, then higher — high-water-mark)
        post_id = self._create_post(tokens["audit"])
        self._fire(tokens["stealth"], post_id, 2)
        self._finalize(tokens["stealth"], "auditcheckreal")

        rows = self._get_fire_notifs(tokens["audit"])
        unresolved = [n for n in rows if not n.get("resolved")]
        assert len(unresolved) == 1, f"expected 1 unresolved, got {len(unresolved)}: {unresolved}"
        first_id = unresolved[0]["id"]
        first_msg = unresolved[0].get("payload", {}).get("message", "")
        assert "ready to collect" in first_msg.lower(), f"msg: {first_msg}"
        first_total = unresolved[0].get("payload", {}).get("collectable_total")

        # Second cycle: fire+finalize again (raise to 5) → SAME id, total updates
        self._fire(tokens["stealth"], post_id, 5)
        self._finalize(tokens["stealth"], "auditcheckreal")
        rows2 = self._get_fire_notifs(tokens["audit"])
        unresolved2 = [n for n in rows2 if not n.get("resolved")]
        assert len(unresolved2) == 1, f"expected still 1 unresolved (upsert), got {len(unresolved2)}"
        assert unresolved2[0]["id"] == first_id, "notification id changed — must upsert!"
        new_total = unresolved2[0].get("payload", {}).get("collectable_total")
        assert new_total > first_total, f"collectable_total should grow: {first_total} → {new_total}"

        # Collect → notification resolves
        cw_before = requests.get(f"{API}/fire/wallet", headers=_auth_hdr(tokens["audit"])).json()
        vault_before = cw_before["wallet"]["vault_balance"]
        collectable_before = cw_before["wallet"]["collectable_balance"]

        r_collect = requests.post(f"{API}/fire/wallet/collect", json={"collect_all": True},
                                  headers=_auth_hdr(tokens["audit"]), timeout=15)
        assert r_collect.status_code == 200, r_collect.text
        collected_amt = r_collect.json()["collected"]
        assert collected_amt == collectable_before, \
            f"collected {collected_amt} != collectable_before {collectable_before}"

        cw_after = r_collect.json()["wallet"]
        assert cw_after["vault_balance"] == vault_before + collectable_before
        assert cw_after["collectable_balance"] == 0
        assert cw_after["lifetime_fire_collected"] == cw_before["wallet"]["lifetime_fire_collected"] + collectable_before

        # Double-collect idempotent
        r_dbl = requests.post(f"{API}/fire/wallet/collect", json={"collect_all": True},
                              headers=_auth_hdr(tokens["audit"]), timeout=15)
        assert r_dbl.status_code == 200
        assert r_dbl.json()["collected"] == 0, "double-collect should return 0"

        # Notification resolved with the collected-message
        rows3 = self._get_fire_notifs(tokens["audit"])
        resolved_first = [n for n in rows3 if n["id"] == first_id]
        assert resolved_first, "original notification should still be present"
        assert resolved_first[0].get("resolved") is True
        assert resolved_first[0].get("seen") is True
        assert "collected" in (resolved_first[0].get("payload", {}).get("message") or "").lower()

        # Third cycle → NEW notification id (use a NEW post so high-water-mark
        # doesn't block the credit)
        post_id2 = self._create_post(tokens["audit"])
        self._fire(tokens["stealth"], post_id2, 4)
        self._finalize(tokens["stealth"], "auditcheckreal")
        rows4 = self._get_fire_notifs(tokens["audit"])
        unresolved3 = [n for n in rows4 if not n.get("resolved")]
        assert len(unresolved3) == 1, f"expected exactly 1 new unresolved row: {len(unresolved3)}"
        assert unresolved3[0]["id"] != first_id, "new cycle must produce a NEW notification id"

        # Clean up: collect the residual
        requests.post(f"{API}/fire/wallet/collect", json={"collect_all": True},
                      headers=_auth_hdr(tokens["audit"]), timeout=15)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
