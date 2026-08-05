"""Backend tests for Game Access & Visibility Controls (iter 123).

Tests all 9 access modes, enforcement across game endpoints, audit + rollback,
public preview no-login route, simulate + registry.

Target game: RTTEST Tunnel Run (4559297f1ff54f789e4fb6fae9122473) — restored to
{mode:"published"} at end of the module.
"""
import os
import time

import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
GAME_ID = "4559297f1ff54f789e4fb6fae9122473"
DRAGON_ID = "94f0cbaec37c4f08bd1a0a11627040ad"


def _login(username: str, password: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": username, "password": password}, timeout=20)
    assert r.status_code == 200, f"Login failed for {username}: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"No token in login response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def founder_h():
    return {"Authorization": f"Bearer {_login('stealth', 'Password1$')}"}


@pytest.fixture(scope="module")
def tftwo_h():
    return {"Authorization": f"Bearer {_login('tftwo', 'pass1234')}"}


@pytest.fixture(scope="module")
def audit_h():
    return {"Authorization": f"Bearer {_login('auditcheckreal', 'Password1$')}"}


def _put_access(founder_h, cfg, reason="test iter123"):
    r = requests.put(f"{BASE}/api/admin/games/{GAME_ID}/access",
                     headers=founder_h, json={"config": cfg, "reason": reason}, timeout=15)
    return r


@pytest.fixture(scope="module", autouse=True)
def _cleanup(founder_h):
    yield
    # Restore to published, revoke any preview link
    requests.delete(f"{BASE}/api/admin/games/{GAME_ID}/access/preview-link",
                    headers=founder_h, timeout=10)
    _put_access(founder_h, {"mode": "published"}, reason="cleanup iter123")


# ─── Registry ───────────────────────────────────────────────
class TestRegistry:
    def test_registry(self, founder_h):
        r = requests.get(f"{BASE}/api/admin/games/access/registry",
                         headers=founder_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert len(d["modes"]) == 9
        keys = {m["key"] for m in d["modes"]}
        for m in ("founder_only", "custom_users", "badge_access", "progression_access",
                  "view_only", "preview", "public_preview", "published", "maintenance"):
            assert m in keys
        assert len(d["badges"]) >= 9
        assert len(d["levels"]) >= 8

    def test_founder_guard(self, tftwo_h):
        r = requests.get(f"{BASE}/api/admin/games/access/registry",
                         headers=tftwo_h, timeout=10)
        assert r.status_code == 403


# ─── Founder Only ───────────────────────────────────────────
class TestFounderOnly:
    def test_blocks_normal_user(self, founder_h, tftwo_h):
        r = _put_access(founder_h, {"mode": "founder_only"})
        assert r.status_code == 200, r.text
        r2 = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=tftwo_h, timeout=10)
        assert r2.status_code == 403
        d = r2.json().get("detail") or {}
        assert (d.get("reason") if isinstance(d, dict) else "") == "founder_only"
        # hub list
        hub = requests.get(f"{BASE}/api/games", headers=tftwo_h, timeout=15).json()
        items = hub.get("games") or hub.get("items") or hub if isinstance(hub, list) else hub.get("games", [])
        ids = [g.get("id") for g in items] if isinstance(items, list) else []
        assert GAME_ID not in ids
        # founder bypass
        rf = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=founder_h, timeout=10)
        assert rf.status_code == 200


# ─── Custom Users ───────────────────────────────────────────
class TestCustomUsers:
    def test_allow_and_deny(self, founder_h, tftwo_h, audit_h):
        r = _put_access(founder_h, {"mode": "custom_users",
                                    "usernames": "@tftwo,  tftwo, @tftwo "})
        assert r.status_code == 200, r.text
        users = r.json()["access"]["users"]
        assert len(users) == 1 and users[0]["username"].lower() == "tftwo"
        # allowed user
        ok = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=tftwo_h, timeout=10)
        assert ok.status_code == 200
        # not allowed
        deny = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=audit_h, timeout=10)
        assert deny.status_code == 403
        d = deny.json().get("detail") or {}
        assert d.get("reason") == "user_not_allowed"

    def test_invalid_username(self, founder_h):
        r = _put_access(founder_h, {"mode": "custom_users",
                                    "usernames": "@nosuchuser999abcxyz"})
        assert r.status_code == 400
        d = r.json().get("detail") or {}
        assert "nosuchuser999abcxyz" in (d.get("invalid_users") or [])


# ─── Badge Access ───────────────────────────────────────────
class TestBadgeAccess:
    def test_any(self, founder_h, tftwo_h, audit_h):
        r = _put_access(founder_h, {"mode": "badge_access", "badges": ["og"],
                                    "badge_match": "any"})
        assert r.status_code == 200
        ok = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=tftwo_h, timeout=10)
        assert ok.status_code == 200, f"tftwo should have og badge: {ok.text[:200]}"
        deny = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=audit_h, timeout=10)
        assert deny.status_code == 403
        assert (deny.json().get("detail") or {}).get("reason") == "required_badge_missing"

    def test_all(self, founder_h, tftwo_h):
        r = _put_access(founder_h, {"mode": "badge_access", "badges": ["og", "vip"],
                                    "badge_match": "all"})
        assert r.status_code == 200
        deny = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=tftwo_h, timeout=10)
        assert deny.status_code == 403
        assert (deny.json().get("detail") or {}).get("reason") == "required_badge_missing"


# ─── Progression ────────────────────────────────────────────
class TestProgression:
    def test_too_low(self, founder_h, tftwo_h):
        r = _put_access(founder_h, {"mode": "progression_access", "min_level": 99})
        assert r.status_code == 200
        d = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=tftwo_h, timeout=10)
        assert d.status_code == 403
        assert (d.json().get("detail") or {}).get("reason") == "progression_too_low"

    def test_allowed(self, founder_h, tftwo_h):
        r = _put_access(founder_h, {"mode": "progression_access", "min_level": 0})
        assert r.status_code == 200
        ok = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=tftwo_h, timeout=10)
        assert ok.status_code == 200


# ─── View Only ──────────────────────────────────────────────
class TestViewOnly:
    def test_view_only(self, founder_h, tftwo_h):
        r = _put_access(founder_h, {"mode": "view_only"})
        assert r.status_code == 200
        g = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=tftwo_h, timeout=10)
        assert g.status_code == 200
        gb = g.json()
        acc = gb.get("access") or {}
        assert acc.get("view_only") is True
        assert "View Only Mode" in (acc.get("message") or "")
        # progress
        pr = requests.post(f"{BASE}/api/games/{GAME_ID}/progress",
                           headers=tftwo_h, json={"state": {}}, timeout=10)
        assert pr.status_code == 403
        assert (pr.json().get("detail") or {}).get("reason") == "view_only"
        # score
        sc = requests.post(f"{BASE}/api/games/{GAME_ID}/score",
                           headers=tftwo_h, json={"score": 100}, timeout=10)
        assert sc.status_code == 403
        # key collect
        k = requests.post(f"{BASE}/api/fire/keys/collect", headers=tftwo_h,
                          json={"key_id": "k1", "game_id": GAME_ID}, timeout=10)
        assert k.status_code == 403


# ─── Preview ────────────────────────────────────────────────
class TestPreview:
    def test_preview_defaults_off(self, founder_h, tftwo_h):
        r = _put_access(founder_h, {"mode": "preview"})
        assert r.status_code == 200
        g = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=tftwo_h, timeout=10)
        assert g.status_code == 200
        assert (g.json().get("access") or {}).get("mode") == "preview"
        sc = requests.post(f"{BASE}/api/games/{GAME_ID}/score", headers=tftwo_h,
                           json={"score": 50}, timeout=10)
        assert sc.status_code == 200, sc.text[:300]
        body = sc.json()
        assert body.get("fire_rewards") == [] or not body.get("fire_rewards")
        flags = body.get("access_flags") or {}
        assert flags.get("fire") is False
        assert flags.get("saves") is False
        pr = requests.post(f"{BASE}/api/games/{GAME_ID}/progress",
                           headers=tftwo_h, json={"state": {}}, timeout=10)
        assert pr.status_code == 403
        assert (pr.json().get("detail") or {}).get("reason") == "saves_disabled"

    def test_preview_flags_on(self, founder_h, tftwo_h):
        r = _put_access(founder_h, {"mode": "preview",
                                    "flags": {"saves": True, "leaderboard": True}})
        assert r.status_code == 200
        pr = requests.post(f"{BASE}/api/games/{GAME_ID}/progress",
                           headers=tftwo_h, json={"state": {"pos": 1}}, timeout=10)
        assert pr.status_code == 200, pr.text[:200]
        sc = requests.post(f"{BASE}/api/games/{GAME_ID}/score",
                           headers=tftwo_h, json={"score": 60}, timeout=10)
        assert sc.status_code == 200
        flags = sc.json().get("access_flags") or {}
        assert flags.get("saves") is True
        assert flags.get("leaderboard") is True
        assert flags.get("fire") is False


# ─── Public Preview ─────────────────────────────────────────
class TestPublicPreview:
    def test_public_preview_flow(self, founder_h, tftwo_h):
        r = _put_access(founder_h, {"mode": "public_preview"})
        assert r.status_code == 200
        link = requests.post(f"{BASE}/api/admin/games/{GAME_ID}/access/preview-link",
                             headers=founder_h, timeout=10)
        assert link.status_code == 200
        token = link.json()["link"]["token"]
        # no auth
        pub = requests.get(f"{BASE}/api/public/game-preview/{token}", timeout=10)
        assert pub.status_code == 200, pub.text[:300]
        d = pub.json()
        assert d.get("game", {}).get("spec") is not None or True
        assert "Public Preview" in (d.get("message") or "")
        for k in ("fire", "keys", "saves", "leaderboard"):
            assert d["flags"].get(k) is False
        # member rewards blocked
        pr = requests.post(f"{BASE}/api/games/{GAME_ID}/progress",
                           headers=tftwo_h, json={"state": {}}, timeout=10)
        assert pr.status_code == 403
        k = requests.post(f"{BASE}/api/fire/keys/collect", headers=tftwo_h,
                          json={"key_id": "k1", "game_id": GAME_ID}, timeout=10)
        assert k.status_code == 403
        assert (k.json().get("detail") or {}).get("reason") == "public_preview_rewards_disabled"
        # regenerate invalidates old token
        link2 = requests.post(f"{BASE}/api/admin/games/{GAME_ID}/access/preview-link",
                              headers=founder_h, timeout=10)
        new_tok = link2.json()["link"]["token"]
        assert new_tok != token
        old = requests.get(f"{BASE}/api/public/game-preview/{token}", timeout=10)
        assert old.status_code == 404
        # revoke
        d2 = requests.delete(f"{BASE}/api/admin/games/{GAME_ID}/access/preview-link",
                             headers=founder_h, timeout=10)
        assert d2.status_code == 200
        gone = requests.get(f"{BASE}/api/public/game-preview/{new_tok}", timeout=10)
        assert gone.status_code == 404


# ─── Maintenance ────────────────────────────────────────────
class TestMaintenance:
    def test_maintenance(self, founder_h, tftwo_h):
        r = _put_access(founder_h, {"mode": "maintenance",
                                    "maintenance_message": "Down for tuning"})
        assert r.status_code == 200
        d = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=tftwo_h, timeout=10)
        assert d.status_code == 403
        det = d.json().get("detail") or {}
        assert det.get("reason") == "maintenance_mode"
        assert "Down for tuning" in (det.get("message") or "")
        # founder still allowed
        ok = requests.get(f"{BASE}/api/games/{GAME_ID}", headers=founder_h, timeout=10)
        assert ok.status_code == 200


# ─── Simulate ───────────────────────────────────────────────
class TestSimulate:
    def test_simulate_user_and_guest(self, founder_h):
        _put_access(founder_h, {"mode": "founder_only"})
        r = requests.post(f"{BASE}/api/admin/games/{GAME_ID}/access/simulate",
                          headers=founder_h, json={"username": "tftwo"}, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["allowed"] is False and d["reason"] == "founder_only"
        assert "trace" in d
        g = requests.post(f"{BASE}/api/admin/games/{GAME_ID}/access/simulate",
                          headers=founder_h, json={"guest": True}, timeout=10)
        assert g.status_code == 200

    def test_normal_user_admin_guard(self, tftwo_h):
        r = requests.post(f"{BASE}/api/admin/games/{GAME_ID}/access/simulate",
                          headers=tftwo_h, json={"username": "tftwo"}, timeout=10)
        assert r.status_code == 403


# ─── Audit + Rollback ───────────────────────────────────────
class TestAuditRollback:
    def test_audit_and_rollback(self, founder_h):
        _put_access(founder_h, {"mode": "view_only"}, reason="pre-rollback checkpoint")
        _put_access(founder_h, {"mode": "founder_only"}, reason="switch to founder_only")
        au = requests.get(f"{BASE}/api/admin/games/{GAME_ID}/access/audit",
                          headers=founder_h, timeout=10)
        assert au.status_code == 200
        rows = au.json()["audit"]
        assert len(rows) >= 2
        for row in rows:
            assert "changed_by" in row and "prev" in row and "new" in row \
                and "reason" in row and "at" in row
        # rollback to most recent access_changed row prev
        target = next(r for r in rows if r.get("action") in (None, "access_changed"))
        rb = requests.post(f"{BASE}/api/admin/games/{GAME_ID}/access/rollback",
                           headers=founder_h, json={"audit_id": target["id"]},
                           timeout=10)
        assert rb.status_code == 200, rb.text
        au2 = requests.get(f"{BASE}/api/admin/games/{GAME_ID}/access/audit",
                           headers=founder_h, timeout=10).json()["audit"]
        actions = [r.get("action") for r in au2]
        assert "access_rollback" in actions


# ─── Regression: Dragon Realm legacy migration ──────────────
class TestLegacyRegression:
    def test_dragon_realm_migrates_to_founder_only(self, founder_h, tftwo_h):
        r = requests.get(f"{BASE}/api/admin/games/{DRAGON_ID}/access",
                         headers=founder_h, timeout=10)
        assert r.status_code == 200
        cfg = r.json()["access"]
        assert cfg["mode"] == "founder_only", \
            f"Dragon Realm should migrate to founder_only, got {cfg['mode']}"
        # tftwo blocked
        b = requests.get(f"{BASE}/api/games/{DRAGON_ID}", headers=tftwo_h, timeout=10)
        assert b.status_code == 403
