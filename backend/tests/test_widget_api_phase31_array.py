"""Phase 3.1 — Array Bindings for API Widgets backend tests.

Covers:
  * /api/admin/widgets/test-api with array_bindings → mapped_arrays
  * root-level array (CoinGecko markets), nested path (Reddit children),
    nonexistent path → empty, scalar mode (item_map={'_': ...})
  * editor_config.data_source.array_bindings validation on /api/admin/widgets
  * from-template flow for live_crypto_markets / live_news_headlines /
    live_reddit_top — array_bindings preserved in registry
  * widget_api_call hydrates array_bindings from registry (CoinGecko top-10)
  * @support cannot test-api / direct-call with array_bindings (403 gate)
  * Phase 3 regression: response_map still works alongside array_bindings
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


def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": username, "password": password}, timeout=15)
    if r.status_code != 200:
        return None
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def stealth_token():
    t = _login("stealth", "Password1$")
    if not t:
        pytest.skip("stealth login failed")
    return t


@pytest.fixture(scope="module")
def support_token():
    t = _login("support", "Password1$")
    if not t:
        pytest.skip("support login failed")
    return t


@pytest.fixture(scope="module")
def tfone_token():
    t = _login("tfone", "pass1234")
    if not t:
        pytest.skip("tfone login failed")
    return t


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


_created_widgets = []


@pytest.fixture(scope="module", autouse=True)
def _cleanup(stealth_token):
    yield
    for wid in _created_widgets:
        try:
            requests.delete(f"{BASE_URL}/api/admin/widgets/{wid}",
                            headers=_h(stealth_token), timeout=10)
        except Exception:
            pass


# ── test-api with array_bindings ───────────────────────────────────────

class TestArrayBindingsTestApi:
    def test_coingecko_markets_root_array(self, stealth_token):
        """Root-level array (array_path='') → mapped_arrays.items is list of dicts."""
        payload = {
            "provider": "coingecko",
            "endpoint": "markets",
            "params": {"vs_currency": "usd", "per_page": 3},
            "array_bindings": [{
                "field_key": "items",
                "array_path": "",
                "max_items": 3,
                "item_map": {"label": "name", "body": "symbol",
                             "value": "current_price", "image": "image"},
            }],
        }
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                          headers=_h(stealth_token), json=payload, timeout=30)
        if r.status_code in (429, 502, 503):
            pytest.skip(f"CoinGecko upstream {r.status_code}: {r.text[:120]}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "mapped_arrays" in body
        items = body["mapped_arrays"].get("items")
        assert isinstance(items, list)
        assert len(items) == 3
        for it in items:
            assert isinstance(it, dict)
            assert "label" in it and it["label"]
            assert "body" in it
            assert "value" in it
            assert "image" in it

    def test_coingecko_empty_array_path(self, stealth_token):
        """array_path pointing to nonexistent key → mapped_arrays.items === []."""
        payload = {
            "provider": "coingecko", "endpoint": "markets",
            "params": {"vs_currency": "usd", "per_page": 2},
            "array_bindings": [{
                "field_key": "items",
                "array_path": "nonexistent.key",
                "max_items": 3,
                "item_map": {"label": "name"},
            }],
        }
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                          headers=_h(stealth_token), json=payload, timeout=30)
        if r.status_code in (429, 502, 503):
            pytest.skip(f"CoinGecko upstream {r.status_code}")
        assert r.status_code == 200, r.text
        assert r.json()["mapped_arrays"]["items"] == []

    def test_coingecko_scalar_mode(self, stealth_token):
        """item_map={'_':'image'} → array of strings, not dicts."""
        payload = {
            "provider": "coingecko", "endpoint": "markets",
            "params": {"vs_currency": "usd", "per_page": 3},
            "array_bindings": [{
                "field_key": "media",
                "array_path": "",
                "max_items": 3,
                "item_map": {"_": "image"},
            }],
        }
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                          headers=_h(stealth_token), json=payload, timeout=30)
        if r.status_code in (429, 502, 503):
            pytest.skip(f"CoinGecko upstream {r.status_code}")
        assert r.status_code == 200, r.text
        media = r.json()["mapped_arrays"]["media"]
        assert isinstance(media, list) and len(media) == 3
        for m in media:
            assert isinstance(m, str)
            assert m.startswith("http")

    def test_response_map_and_array_bindings_together(self, stealth_token):
        """Both single-value mapped AND mapped_arrays returned (Phase 3 backwards compat)."""
        payload = {
            "provider": "coingecko", "endpoint": "markets",
            "params": {"vs_currency": "usd", "per_page": 2},
            "response_map": {"first_name": "[0].name"},
            "array_bindings": [{
                "field_key": "items", "array_path": "", "max_items": 2,
                "item_map": {"label": "name"},
            }],
        }
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                          headers=_h(stealth_token), json=payload, timeout=30)
        if r.status_code in (429, 502, 503):
            pytest.skip(f"CoinGecko upstream {r.status_code}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body.get("mapped"), dict)
        assert body["mapped"].get("first_name")  # not None
        assert len(body["mapped_arrays"]["items"]) == 2

    def test_reddit_subreddit_top_nested_array(self, stealth_token):
        """Reddit nested array (data.children); accept 403/502 (CDN block) as soft-pass."""
        payload = {
            "provider": "reddit", "endpoint": "subreddit_top",
            "params": {"subreddit": "programming", "limit": 3, "t": "day"},
            "array_bindings": [{
                "field_key": "items", "array_path": "data.children", "max_items": 3,
                "item_map": {"label": "data.title", "value": "data.score", "url": "data.url"},
            }],
        }
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                          headers=_h(stealth_token), json=payload, timeout=30)
        if r.status_code in (403, 429, 502, 503):
            pytest.skip(f"Reddit CDN block status={r.status_code}: {r.text[:120]}")
        assert r.status_code == 200, r.text
        items = r.json()["mapped_arrays"]["items"]
        assert isinstance(items, list)
        assert 1 <= len(items) <= 3
        for it in items:
            assert "label" in it


# ── @support / direct-call gating ──────────────────────────────────────

class TestStealthGating:
    def test_support_cannot_test_api(self, support_token):
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                          headers=_h(support_token),
                          json={"provider": "coingecko", "endpoint": "markets",
                                "params": {"vs_currency": "usd", "per_page": 1},
                                "array_bindings": [{"field_key": "items", "array_path": "",
                                                    "item_map": {"label": "name"}}]},
                          timeout=15)
        assert r.status_code == 403, r.text

    def test_support_cannot_direct_api_call(self, support_token):
        """No widget_id + non-stealth → 403."""
        r = requests.post(f"{BASE_URL}/api/widgets/api-call",
                          headers=_h(support_token),
                          json={"provider": "coingecko", "endpoint": "markets",
                                "params": {"vs_currency": "usd", "per_page": 1},
                                "array_bindings": [{"field_key": "items", "array_path": "",
                                                    "item_map": {"label": "name"}}]},
                          timeout=15)
        assert r.status_code == 403, r.text


# ── editor_config validation ───────────────────────────────────────────

def _api_widget_payload(array_bindings):
    return {
        "key": f"test_phase31_{uuid.uuid4().hex[:8]}",
        "name": "TEST Phase 3.1",
        "category": "social",
        "icon_name": "Star",
        "layout": "list",
        "editor_config": {
            "schema_version": 1,
            "layout": "list",
            "fields": [{"key": "items", "type": "rich_item", "label": "Items", "max_count": 10}],
            "data": {},
            "data_source": {
                "kind": "api",
                "provider": "coingecko",
                "endpoint_key": "markets",
                "params": {"vs_currency": "usd", "per_page": 3},
                "response_map": {},
                "array_bindings": array_bindings,
                "refresh_seconds": 300,
                "cache_seconds": 60,
            },
            "theme": {}, "limits": {},
        },
    }


class TestEditorConfigValidation:
    def test_valid_array_bindings_201(self, stealth_token):
        payload = _api_widget_payload([{"field_key": "items", "array_path": "x",
                                        "item_map": {"a": "b"}}])
        r = requests.post(f"{BASE_URL}/api/admin/widgets",
                          headers=_h(stealth_token), json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        wid = (r.json().get("widget") or r.json()).get("id")
        _created_widgets.append(wid)

    def test_array_bindings_not_a_list_400(self, stealth_token):
        payload = _api_widget_payload("not_a_list")
        r = requests.post(f"{BASE_URL}/api/admin/widgets",
                          headers=_h(stealth_token), json=payload, timeout=15)
        assert r.status_code == 400, r.text

    def test_binding_missing_field_key_400(self, stealth_token):
        payload = _api_widget_payload([{"array_path": "x", "item_map": {"a": "b"}}])
        r = requests.post(f"{BASE_URL}/api/admin/widgets",
                          headers=_h(stealth_token), json=payload, timeout=15)
        assert r.status_code == 400, r.text

    def test_item_map_not_object_400(self, stealth_token):
        payload = _api_widget_payload([{"field_key": "items", "array_path": "x",
                                        "item_map": "not_an_object"}])
        r = requests.post(f"{BASE_URL}/api/admin/widgets",
                          headers=_h(stealth_token), json=payload, timeout=15)
        assert r.status_code == 400, r.text


# ── from-template flow ─────────────────────────────────────────────────

class TestFromTemplates:
    @pytest.mark.parametrize("tkey", ["live_crypto_markets", "live_news_headlines",
                                       "live_reddit_top"])
    def test_template_creates_with_array_bindings(self, stealth_token, tkey):
        r = requests.post(f"{BASE_URL}/api/admin/widgets/from-template/{tkey}",
                          headers=_h(stealth_token),
                          json={"key": f"t_{tkey[:20]}_{uuid.uuid4().hex[:6]}"},
                          timeout=15)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        widget_doc = body.get("widget") or body
        wid = widget_doc.get("id")
        _created_widgets.append(wid)
        ds = widget_doc["editor_config"]["data_source"]
        assert ds.get("kind") == "api"
        bindings = ds.get("array_bindings")
        assert isinstance(bindings, list) and len(bindings) >= 1
        assert bindings[0].get("field_key")
        assert "item_map" in bindings[0]

    def test_live_crypto_markets_api_call_returns_10(self, stealth_token, support_token):
        """Full flow: create from template → launch → api-call as @support → 10 items, cached on 2nd call."""
        r = requests.post(f"{BASE_URL}/api/admin/widgets/from-template/live_crypto_markets",
                          headers=_h(stealth_token),
                          json={"key": f"crypto_mk_{uuid.uuid4().hex[:6]}"},
                          timeout=15)
        assert r.status_code in (200, 201), r.text
        wid = (r.json().get("widget") or r.json()).get("id")
        _created_widgets.append(wid)
        # launch
        lr = requests.post(f"{BASE_URL}/api/admin/widgets/{wid}/launch",
                           headers=_h(stealth_token), timeout=15)
        assert lr.status_code == 200, lr.text
        # api-call as support (live widget should be reachable to any authed user)
        time.sleep(1)
        c1 = requests.post(f"{BASE_URL}/api/widgets/api-call",
                           headers=_h(support_token),
                           json={"widget_id": wid}, timeout=30)
        if c1.status_code in (429, 502, 503):
            pytest.skip(f"CoinGecko upstream {c1.status_code}")
        assert c1.status_code == 200, c1.text
        body1 = c1.json()
        items1 = body1["mapped_arrays"].get("items")
        assert isinstance(items1, list)
        # template defaults to per_page=10
        assert len(items1) == 10, f"expected 10, got {len(items1)}"
        # second call should be cached
        c2 = requests.post(f"{BASE_URL}/api/widgets/api-call",
                           headers=_h(support_token),
                           json={"widget_id": wid}, timeout=30)
        assert c2.status_code == 200, c2.text
        assert c2.json().get("cached") is True


# ── Phase 3 regression: live_crypto single-value still works ───────────

class TestPhase3Regression:
    def test_live_crypto_single_value(self, stealth_token, tfone_token):
        r = requests.post(f"{BASE_URL}/api/admin/widgets/from-template/live_crypto",
                          headers=_h(stealth_token),
                          json={"key": f"crypto_single_{uuid.uuid4().hex[:6]}"},
                          timeout=15)
        if r.status_code == 404:
            pytest.skip("live_crypto template missing")
        assert r.status_code in (200, 201), r.text
        wid = (r.json().get("widget") or r.json()).get("id")
        _created_widgets.append(wid)
        lr = requests.post(f"{BASE_URL}/api/admin/widgets/{wid}/launch",
                           headers=_h(stealth_token), timeout=15)
        assert lr.status_code == 200, lr.text
        c = requests.post(f"{BASE_URL}/api/widgets/api-call",
                          headers=_h(tfone_token),
                          json={"widget_id": wid}, timeout=30)
        if c.status_code in (429, 502, 503):
            pytest.skip(f"upstream {c.status_code}")
        assert c.status_code == 200, c.text
        body = c.json()
        assert isinstance(body.get("mapped"), dict)
        # value should hold the BTC USD price (a number)
        val = body["mapped"].get("value")
        assert val is not None
        # array_bindings should be absent or empty
        assert not body.get("mapped_arrays")
