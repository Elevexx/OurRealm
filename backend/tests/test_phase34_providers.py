"""Phase 3.4 — Provider Management endpoint tests."""
import os
import re
import time
import json
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to reading frontend/.env in case env not passed through.
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass


def _login(username: str, password: str):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    token = r.json().get("access_token") or r.json().get("token")
    assert token, f"no access_token for {username}"
    return token


@pytest.fixture(scope="module")
def tokens():
    return {
        "stealth": _login("stealth", "Password1$"),
        "support": _login("support", "Password1$"),
        "tfone":   _login("tfone",   "pass1234"),
    }


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


EXPECTED_IDS = {
    "openweather", "newsapi", "openai", "alphavantage", "coingecko",
    "nasa", "github", "reddit", "spotify", "youtube", "googlemaps",
}


# ─── /api/admin/providers ────────────────────────────────────────────

class TestProvidersList:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/providers", timeout=10)
        assert r.status_code == 401

    def test_non_admin_forbidden(self, tokens):
        r = requests.get(f"{BASE_URL}/api/admin/providers",
                         headers=_hdr(tokens["tfone"]), timeout=10)
        assert r.status_code == 403

    def test_support_can_list(self, tokens):
        r = requests.get(f"{BASE_URL}/api/admin/providers",
                         headers=_hdr(tokens["support"]), timeout=10)
        assert r.status_code == 200
        ids = {p["id"] for p in r.json()["providers"]}
        assert ids == EXPECTED_IDS, f"unexpected ids: {ids}"

    def test_stealth_full_view(self, tokens):
        r = requests.get(f"{BASE_URL}/api/admin/providers",
                         headers=_hdr(tokens["stealth"]), timeout=10)
        assert r.status_code == 200
        body = r.json()
        provs = body["providers"]
        assert len(provs) == 11
        keys_required = {"id", "name", "configured", "enabled", "status",
                         "coming_soon", "capabilities", "auth_env_var"}
        for p in provs:
            missing = keys_required - set(p.keys())
            assert not missing, f"{p['id']} missing {missing}"
        # coming_soon set
        cs_ids = {p["id"] for p in provs if p["coming_soon"]}
        assert cs_ids == {"spotify", "youtube", "googlemaps"}
        # configured includes openai/coingecko/nasa/github/reddit
        cfg = {p["id"] for p in provs if p["configured"]}
        for must in ("openai", "coingecko", "nasa", "github", "reddit"):
            assert must in cfg, f"{must} should be configured"

    def test_no_secret_leak(self, tokens):
        r = requests.get(f"{BASE_URL}/api/admin/providers",
                         headers=_hdr(tokens["stealth"]), timeout=10)
        raw = r.text
        # Must not contain OpenAI key prefix or any actual secret value
        oa = os.environ.get("OPENAI_API_KEY") or ""
        if oa:
            assert oa not in raw, "OPENAI_API_KEY value leaked!"
        assert "sk-" not in raw, "sk- bearer token leaked!"
        # auth_env_var name IS allowed (it's a name not a value)


# ─── /api/admin/providers/status ─────────────────────────────────────

class TestProvidersStatus:
    def test_admin_compact(self, tokens):
        r = requests.get(f"{BASE_URL}/api/admin/providers/status",
                         headers=_hdr(tokens["support"]), timeout=10)
        assert r.status_code == 200
        rows = r.json()["providers"]
        ids = {p["id"] for p in rows}
        assert ids == EXPECTED_IDS
        for p in rows:
            assert set(p.keys()) == {"id", "configured", "enabled", "status", "coming_soon"}


# ─── /api/admin/providers/toggle (stealth-only) ──────────────────────

class TestProviderToggle:
    def test_support_forbidden(self, tokens):
        r = requests.post(f"{BASE_URL}/api/admin/providers/toggle",
                          headers=_hdr(tokens["support"]),
                          json={"id": "openai", "enabled": False}, timeout=10)
        assert r.status_code == 403

    def test_tfone_forbidden(self, tokens):
        r = requests.post(f"{BASE_URL}/api/admin/providers/toggle",
                          headers=_hdr(tokens["tfone"]),
                          json={"id": "openai", "enabled": False}, timeout=10)
        assert r.status_code == 403

    def test_unknown_provider_404(self, tokens):
        r = requests.post(f"{BASE_URL}/api/admin/providers/toggle",
                          headers=_hdr(tokens["stealth"]),
                          json={"id": "nonexistent_xyz", "enabled": False}, timeout=10)
        assert r.status_code == 404

    def test_toggle_coingecko_off_on(self, tokens):
        # Toggle coingecko off (cheap — no key)
        r = requests.post(f"{BASE_URL}/api/admin/providers/toggle",
                          headers=_hdr(tokens["stealth"]),
                          json={"id": "coingecko", "enabled": False}, timeout=10)
        assert r.status_code == 200
        assert r.json()["enabled"] is False
        # Verify reflected in list
        r2 = requests.get(f"{BASE_URL}/api/admin/providers",
                          headers=_hdr(tokens["stealth"]), timeout=10)
        row = next(p for p in r2.json()["providers"] if p["id"] == "coingecko")
        assert row["enabled"] is False
        assert row["status"] == "disabled"
        # Re-enable
        r3 = requests.post(f"{BASE_URL}/api/admin/providers/toggle",
                           headers=_hdr(tokens["stealth"]),
                           json={"id": "coingecko", "enabled": True}, timeout=10)
        assert r3.status_code == 200
        assert r3.json()["enabled"] is True


# ─── /api/admin/providers/test ───────────────────────────────────────

class TestProviderHealthTest:
    def test_tfone_forbidden(self, tokens):
        r = requests.post(f"{BASE_URL}/api/admin/providers/test",
                          headers=_hdr(tokens["tfone"]),
                          json={"id": "coingecko", "enabled": True}, timeout=20)
        assert r.status_code == 403

    def test_support_can_probe(self, tokens):
        r = requests.post(f"{BASE_URL}/api/admin/providers/test",
                          headers=_hdr(tokens["support"]),
                          json={"id": "coingecko", "enabled": True}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["id"] == "coingecko"
        assert body["status"] in ("healthy", "error")
        if body["status"] == "healthy":
            assert isinstance(body.get("latency_ms"), int)

    def test_coming_soon_returns_marker(self, tokens):
        r = requests.post(f"{BASE_URL}/api/admin/providers/test",
                          headers=_hdr(tokens["stealth"]),
                          json={"id": "spotify", "enabled": True}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "coming_soon"

    def test_unconfigured_returns_marker(self, tokens):
        # newsapi/openweather/alphavantage — env keys NOT set.
        r = requests.post(f"{BASE_URL}/api/admin/providers/test",
                          headers=_hdr(tokens["stealth"]),
                          json={"id": "newsapi", "enabled": True}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] in ("unconfigured", "healthy", "error")

    def test_disabled_returns_marker(self, tokens):
        # Disable github briefly, probe, then re-enable.
        requests.post(f"{BASE_URL}/api/admin/providers/toggle",
                      headers=_hdr(tokens["stealth"]),
                      json={"id": "github", "enabled": False}, timeout=10)
        try:
            r = requests.post(f"{BASE_URL}/api/admin/providers/test",
                              headers=_hdr(tokens["stealth"]),
                              json={"id": "github", "enabled": True}, timeout=15)
            assert r.status_code == 200
            assert r.json()["status"] == "disabled"
        finally:
            requests.post(f"{BASE_URL}/api/admin/providers/toggle",
                          headers=_hdr(tokens["stealth"]),
                          json={"id": "github", "enabled": True}, timeout=10)

    def test_openai_ping(self, tokens):
        """ONE cheap probe — max_tokens=1 per health probe spec."""
        r = requests.post(f"{BASE_URL}/api/admin/providers/test",
                          headers=_hdr(tokens["stealth"]),
                          json={"id": "openai", "enabled": True}, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["status"] in ("healthy", "error")
        # No key in response body
        oa = os.environ.get("OPENAI_API_KEY") or ""
        if oa:
            assert oa not in r.text


# ─── /api/admin/analytics/providers ──────────────────────────────────

class TestAnalytics:
    def test_admin_only(self, tokens):
        r = requests.get(f"{BASE_URL}/api/admin/analytics/providers",
                         headers=_hdr(tokens["tfone"]), timeout=10)
        assert r.status_code == 403

    def test_snapshot(self, tokens):
        r = requests.get(f"{BASE_URL}/api/admin/analytics/providers",
                         headers=_hdr(tokens["support"]), timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "providers" in body and isinstance(body["providers"], list)


# ─── /api/widgets/api-call ───────────────────────────────────────────

class TestWidgetApiCall:
    def test_unauth_401(self):
        r = requests.post(f"{BASE_URL}/api/widgets/api-call",
                          json={"widget_id": "x"}, timeout=10)
        assert r.status_code == 401

    def test_unknown_widget_404(self, tokens):
        r = requests.post(f"{BASE_URL}/api/widgets/api-call",
                          headers=_hdr(tokens["tfone"]),
                          json={"widget_id": "nope_xxx"}, timeout=10)
        assert r.status_code == 404

    def test_disabled_provider_blocked(self, tokens):
        # Direct ad-hoc call as stealth (no widget_id needed).
        requests.post(f"{BASE_URL}/api/admin/providers/toggle",
                      headers=_hdr(tokens["stealth"]),
                      json={"id": "coingecko", "enabled": False}, timeout=10)
        try:
            r = requests.post(f"{BASE_URL}/api/widgets/api-call",
                              headers=_hdr(tokens["stealth"]),
                              json={"provider": "coingecko",
                                    "endpoint": "simple_price",
                                    "params": {"ids": "bitcoin", "vs_currencies": "usd"}},
                              timeout=15)
            assert r.status_code == 403
            assert "disabled" in r.text.lower()
        finally:
            requests.post(f"{BASE_URL}/api/admin/providers/toggle",
                          headers=_hdr(tokens["stealth"]),
                          json={"id": "coingecko", "enabled": True}, timeout=10)


# ─── /api/admin/widgets/test-api (stealth-only) ──────────────────────

class TestAdminWidgetsTestApi:
    def test_support_forbidden(self, tokens):
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                          headers=_hdr(tokens["support"]),
                          json={"provider": "coingecko", "endpoint": "simple_price",
                                "params": {"ids": "bitcoin", "vs_currencies": "usd"}},
                          timeout=15)
        assert r.status_code == 403

    def test_stealth_ok(self, tokens):
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                          headers=_hdr(tokens["stealth"]),
                          json={"provider": "coingecko", "endpoint": "simple_price",
                                "params": {"ids": "bitcoin", "vs_currencies": "usd"}},
                          timeout=15)
        assert r.status_code in (200, 502, 504)  # accept upstream hiccups

    def test_refuses_disabled(self, tokens):
        requests.post(f"{BASE_URL}/api/admin/providers/toggle",
                      headers=_hdr(tokens["stealth"]),
                      json={"id": "coingecko", "enabled": False}, timeout=10)
        try:
            r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                              headers=_hdr(tokens["stealth"]),
                              json={"provider": "coingecko", "endpoint": "simple_price",
                                    "params": {"ids": "bitcoin", "vs_currencies": "usd"}},
                              timeout=15)
            assert r.status_code == 403
        finally:
            requests.post(f"{BASE_URL}/api/admin/providers/toggle",
                          headers=_hdr(tokens["stealth"]),
                          json={"id": "coingecko", "enabled": True}, timeout=10)


# ─── /api/admin/widgets/api-providers ────────────────────────────────

class TestApiProvidersMergedFlag:
    def test_includes_enabled(self, tokens):
        r = requests.get(f"{BASE_URL}/api/admin/widgets/api-providers",
                         headers=_hdr(tokens["stealth"]), timeout=10)
        assert r.status_code == 200
        provs = r.json()["providers"]
        assert len(provs) == 11
        for p in provs:
            assert "enabled" in p
            # public_provider_view strips auth_env_var
            assert "auth_env_var" not in p
        # No raw key value
        assert "sk-" not in r.text
