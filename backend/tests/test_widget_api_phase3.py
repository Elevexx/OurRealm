"""Phase 3 — API Widget Sources backend tests.

Covers:
  * /api/admin/widgets/api-providers — admin tier gating, credential hidden
  * /api/admin/widgets/test-api — @stealth-only, coming_soon 400, missing-key 503, unknown 404
  * editor_config data_source.kind='api' validation on /api/admin/widgets
  * from-template/live_crypto → launch → /api/widgets/api-call cache flow
  * /api/widgets/api-call auth + draft-widget admin gate
  * Rate-limit fires (1 confirmation)
"""
import os
import time
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _login(username: str, password: str):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": username, "password": password},
                      timeout=15)
    if r.status_code != 200:
        return None
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def stealth_token():
    t = _login("stealth", "Password1$")
    if not t:
        pytest.skip("Cannot auth as stealth")
    return t


@pytest.fixture(scope="module")
def support_token():
    t = _login("support", "Password1$")
    if not t:
        pytest.skip("Cannot auth as support")
    return t


@pytest.fixture(scope="module")
def tfone_token():
    t = _login("tfone", "pass1234")
    if not t:
        pytest.skip("Cannot auth as tfone")
    return t


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ── /api/admin/widgets/api-providers ──────────────────────────────────

class TestApiProviders:
    def test_stealth_sees_11_providers(self, stealth_token):
        r = requests.get(f"{BASE_URL}/api/admin/widgets/api-providers", headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "providers" in data
        keys = [p["key"] for p in data["providers"]]
        assert len(keys) == 11, f"expected 11 providers, got {len(keys)}: {keys}"
        for p in data["providers"]:
            assert "has_credential" in p
            assert "coming_soon" in p
            # credentials must be stripped
            assert "auth_env_var" not in p
            assert "auth_param_prefix" not in p
        coming = {p["key"]: p["coming_soon"] for p in data["providers"]}
        assert coming.get("spotify") is True
        assert coming.get("youtube") is True
        assert coming.get("googlemaps") is True
        assert coming.get("coingecko") is False

    def test_support_admin_can_list(self, support_token):
        r = requests.get(f"{BASE_URL}/api/admin/widgets/api-providers", headers=_h(support_token), timeout=15)
        assert r.status_code == 200, r.text

    def test_tfone_forbidden(self, tfone_token):
        r = requests.get(f"{BASE_URL}/api/admin/widgets/api-providers", headers=_h(tfone_token), timeout=15)
        assert r.status_code == 403


# ── /api/admin/widgets/test-api ───────────────────────────────────────

class TestTestApi:
    def test_stealth_coingecko_simple_price(self, stealth_token):
        body = {
            "provider": "coingecko",
            "endpoint": "simple_price",
            "params": {"ids": "bitcoin", "vs_currencies": "usd"},
            "response_map": {"value": "bitcoin.usd"},
        }
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api", headers=_h(stealth_token), json=body, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "data" in d and "mapped" in d
        assert "bitcoin" in d["data"] and "usd" in d["data"]["bitcoin"]
        assert isinstance(d["data"]["bitcoin"]["usd"], (int, float))
        assert d["mapped"].get("value") is not None

    def test_support_forbidden_test_api(self, support_token):
        body = {"provider": "coingecko", "endpoint": "simple_price",
                "params": {"ids": "bitcoin", "vs_currencies": "usd"}}
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api", headers=_h(support_token), json=body, timeout=15)
        assert r.status_code == 403
        assert "founder" in r.text.lower()

    def test_coming_soon_spotify_400(self, stealth_token):
        body = {"provider": "spotify", "endpoint": "now_playing", "params": {}}
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api", headers=_h(stealth_token), json=body, timeout=15)
        assert r.status_code == 400
        assert "not yet enabled" in r.text.lower()

    def test_missing_credential_503(self, stealth_token):
        # newsapi requires NEWSAPI_KEY which should NOT be set
        if os.environ.get("NEWSAPI_KEY"):
            pytest.skip("NEWSAPI_KEY is set; cannot validate 503 path")
        body = {"provider": "newsapi", "endpoint": "top_headlines", "params": {"country": "us"}}
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api", headers=_h(stealth_token), json=body, timeout=15)
        assert r.status_code == 503
        assert "credential" in r.text.lower()

    def test_unknown_provider_404(self, stealth_token):
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api", headers=_h(stealth_token),
                          json={"provider": "garbage", "endpoint": "x"}, timeout=15)
        assert r.status_code == 404

    def test_unknown_endpoint_404(self, stealth_token):
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api", headers=_h(stealth_token),
                          json={"provider": "coingecko", "endpoint": "nope"}, timeout=15)
        assert r.status_code == 404


# ── editor_config validation on /api/admin/widgets ────────────────────

@pytest.fixture
def cleanup_widgets(stealth_token):
    created_ids = []
    yield created_ids
    for wid in created_ids:
        try:
            requests.delete(f"{BASE_URL}/api/admin/widgets/{wid}", headers=_h(stealth_token), timeout=10)
        except Exception:
            pass


def _editor_cfg_api(provider, endpoint, params=None, response_map=None):
    return {
        "schema_version": 1,
        "layout": "stat",
        "fields": [{"key": "value", "type": "text", "label": "v"}],
        "data": {"value": "—"},
        "data_source": {
            "kind": "api", "provider": provider, "endpoint_key": endpoint,
            "params": params if params is not None else {},
            "response_map": response_map if response_map is not None else {},
            "refresh_seconds": 120, "cache_seconds": 120,
        },
    }


class TestEditorConfigValidation:
    def test_valid_api_widget_201(self, stealth_token, cleanup_widgets):
        key = f"test_api_{uuid.uuid4().hex[:8]}"
        body = {
            "key": key, "name": "TEST API widget",
            "editor_config": _editor_cfg_api("coingecko", "simple_price",
                                              params={"ids": "bitcoin", "vs_currencies": "usd"},
                                              response_map={"value": "bitcoin.usd"}),
        }
        r = requests.post(f"{BASE_URL}/api/admin/widgets", headers=_h(stealth_token), json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        w = r.json()["widget"]
        cleanup_widgets.append(w["id"])
        assert w["editor_config"]["data_source"]["kind"] == "api"
        assert w["editor_config"]["data_source"]["provider"] == "coingecko"

    def test_unknown_provider_400(self, stealth_token):
        key = f"test_api_{uuid.uuid4().hex[:8]}"
        body = {"key": key, "name": "TEST bad provider",
                "editor_config": _editor_cfg_api("garbage", "x")}
        r = requests.post(f"{BASE_URL}/api/admin/widgets", headers=_h(stealth_token), json=body, timeout=15)
        assert r.status_code == 400

    def test_unknown_endpoint_400(self, stealth_token):
        key = f"test_api_{uuid.uuid4().hex[:8]}"
        body = {"key": key, "name": "TEST bad ep",
                "editor_config": _editor_cfg_api("coingecko", "nope")}
        r = requests.post(f"{BASE_URL}/api/admin/widgets", headers=_h(stealth_token), json=body, timeout=15)
        assert r.status_code == 400

    def test_params_not_object_400(self, stealth_token):
        key = f"test_api_{uuid.uuid4().hex[:8]}"
        cfg = _editor_cfg_api("coingecko", "simple_price")
        cfg["data_source"]["params"] = "not-an-object"
        body = {"key": key, "name": "TEST bad params", "editor_config": cfg}
        r = requests.post(f"{BASE_URL}/api/admin/widgets", headers=_h(stealth_token), json=body, timeout=15)
        assert r.status_code == 400

    def test_response_map_not_object_400(self, stealth_token):
        key = f"test_api_{uuid.uuid4().hex[:8]}"
        cfg = _editor_cfg_api("coingecko", "simple_price")
        cfg["data_source"]["response_map"] = ["nope"]
        body = {"key": key, "name": "TEST bad rm", "editor_config": cfg}
        r = requests.post(f"{BASE_URL}/api/admin/widgets", headers=_h(stealth_token), json=body, timeout=15)
        assert r.status_code == 400


# ── from-template/live_crypto + launch + api-call flow ────────────────

class TestFromTemplateAndApiCall:
    def test_full_flow(self, stealth_token, support_token, tfone_token):
        key = f"test_crypto_{uuid.uuid4().hex[:8]}"
        # Create from template
        r = requests.post(f"{BASE_URL}/api/admin/widgets/from-template/live_crypto",
                          headers=_h(stealth_token), json={"key": key, "name": "TEST live crypto"}, timeout=15)
        assert r.status_code in (200, 201), r.text
        w = r.json()["widget"]
        wid = w["id"]
        ds = w["editor_config"]["data_source"]
        assert ds["kind"] == "api"
        assert ds["provider"] == "coingecko"

        try:
            # While draft: tfone gets 404, support gets 200
            r_draft_tfone = requests.post(f"{BASE_URL}/api/widgets/api-call",
                                          headers=_h(tfone_token), json={"widget_id": wid}, timeout=20)
            assert r_draft_tfone.status_code == 404, r_draft_tfone.text

            r_draft_support = requests.post(f"{BASE_URL}/api/widgets/api-call",
                                            headers=_h(support_token), json={"widget_id": wid}, timeout=25)
            assert r_draft_support.status_code == 200, r_draft_support.text

            # Launch
            r_launch = requests.post(f"{BASE_URL}/api/admin/widgets/{wid}/launch",
                                     headers=_h(stealth_token), timeout=15)
            assert r_launch.status_code == 200, r_launch.text

            # First call via support → 200 with mapped.value (price)
            r1 = requests.post(f"{BASE_URL}/api/widgets/api-call",
                               headers=_h(support_token), json={"widget_id": wid}, timeout=25)
            assert r1.status_code == 200, r1.text
            d1 = r1.json()
            assert d1["mapped"].get("value") is not None
            assert isinstance(d1["mapped"]["value"], (int, float))
            # Either fresh or already cached from earlier draft-call
            # but we want to verify subsequent call is cached L1
            r2 = requests.post(f"{BASE_URL}/api/widgets/api-call",
                               headers=_h(support_token), json={"widget_id": wid}, timeout=25)
            assert r2.status_code == 200
            d2 = r2.json()
            assert d2["cached"] is True
            assert d2.get("cache_tier") == "L1"
        finally:
            requests.delete(f"{BASE_URL}/api/admin/widgets/{wid}",
                            headers=_h(stealth_token), timeout=10)


# ── /api/widgets/api-call gating ──────────────────────────────────────

class TestApiCallGating:
    def test_unauthenticated_401(self):
        r = requests.post(f"{BASE_URL}/api/widgets/api-call",
                          json={"provider": "coingecko", "endpoint": "simple_price"}, timeout=15)
        assert r.status_code == 401, r.text

    def test_direct_call_as_support_403(self, support_token):
        body = {"provider": "coingecko", "endpoint": "simple_price",
                "params": {"ids": "bitcoin", "vs_currencies": "usd"}}
        r = requests.post(f"{BASE_URL}/api/widgets/api-call",
                          headers=_h(support_token), json=body, timeout=15)
        assert r.status_code == 403, r.text

    def test_direct_call_as_stealth_200(self, stealth_token):
        body = {"provider": "coingecko", "endpoint": "simple_price",
                "params": {"ids": "bitcoin", "vs_currencies": "usd"},
                "response_map": {"value": "bitcoin.usd"}}
        r = requests.post(f"{BASE_URL}/api/widgets/api-call",
                          headers=_h(stealth_token), json=body, timeout=20)
        assert r.status_code == 200, r.text


# ── Rate-limit smoke test ─────────────────────────────────────────────

class TestRateLimit:
    def test_burst_429(self, stealth_token):
        # Provider per-minute burst (60/min) — fire tight requests with
        # a keep-alive session, retry once if we straddle a minute and
        # never hit the threshold (fixed-minute bucket resets at :00).
        sess = requests.Session()
        sess.headers.update(_h(stealth_token))
        body = {
            "provider": "coingecko",
            "endpoint": "simple_price",
            "params": {"ids": "bitcoin", "vs_currencies": "usd",
                       "rl_probe": str(uuid.uuid4())[:6]},
            "bypass_cache": True,
        }
        hit_429 = False
        attempts = 0
        for attempt_round in range(2):  # retry once if minute boundary swallowed us
            for i in range(130):
                attempts += 1
                r = sess.post(f"{BASE_URL}/api/admin/widgets/test-api",
                              json=body, timeout=15)
                if r.status_code == 429:
                    hit_429 = True
                    assert ("burst limit" in r.text.lower()) or ("quota exceeded" in r.text.lower()), r.text
                    break
                if r.status_code not in (200, 502):
                    break
            if hit_429:
                break
            time.sleep(0.5)
        assert hit_429, f"Did not observe a 429 within {attempts} attempts"
