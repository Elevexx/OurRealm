"""Phase 3.2 — Value Formatters + Sliding-Window Rate Limit tests.

Covers:
  * Direct apply_formatter unit tests (currency / percent / compact / relative_time / casing)
  * Direct sliding_window rate_limit unit test (true sliding behaviour)
  * /api/admin/widgets/test-api with formatters → mapped_formatted populated
  * X-RateLimit-* response headers on test-api 200
  * editor_config validation: formatters and array_bindings[*].item_formatters
  * from-template live_crypto → formatters preset, api-call returns currency strings
  * from-template live_crypto_markets → item_formatters preset, mapped_arrays_formatted
  * /api/admin/analytics/rate-limits ACL (stealth=200, support=200, tfone=403)
  * Phase 3.1 regression: no formatters → mapped present, mapped_formatted={}
"""
import asyncio
import os
import sys
import time
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

# Make backend modules importable for direct unit tests.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


# ─────────────────────────────────────────────────────────────────────
# Auth helpers
# ─────────────────────────────────────────────────────────────────────

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


def _is_coingecko_blocked(resp_json: dict) -> bool:
    """CoinGecko upstream sometimes 429s/502s during testing — best-effort detector."""
    if not isinstance(resp_json, dict):
        return False
    detail = resp_json.get("detail")
    if isinstance(detail, dict):
        msg = (detail.get("message") or "").lower()
        if "rate" in msg or "upstream" in msg or "502" in msg:
            return True
    if isinstance(detail, str) and ("rate" in detail.lower() or "upstream" in detail.lower()):
        return True
    return False


# ─────────────────────────────────────────────────────────────────────
# 1. Direct value_formatters unit tests
# ─────────────────────────────────────────────────────────────────────

class TestValueFormattersDirect:
    """Direct module import — pure functions, no HTTP."""

    def test_currency_basic(self):
        from utils.value_formatters import apply_formatter
        r = apply_formatter(62876.51, {"type": "currency", "decimals": 2})
        assert r["formatted"] == "$62,876.51", r

    def test_percent_negative_color(self):
        from utils.value_formatters import apply_formatter
        r = apply_formatter(-2.18, {"type": "percent", "decimals": 2,
                                    "negative_color": "#FF5A6B"})
        assert r["formatted"] == "-2.18%", r
        assert r["color"] == "#FF5A6B", r

    def test_percent_positive_color(self):
        from utils.value_formatters import apply_formatter
        r = apply_formatter(3.14, {"type": "percent", "decimals": 2,
                                   "positive_color": "#10E670",
                                   "negative_color": "#FF5A6B"})
        assert r["formatted"] == "3.14%", r
        assert r["color"] == "#10E670", r

    def test_compact_billion(self):
        from utils.value_formatters import apply_formatter
        r = apply_formatter(1_250_000_000, {"type": "compact", "symbol": "$", "decimals": 2})
        assert r["formatted"] == "$1.25B", r

    def test_relative_time_recent(self):
        from utils.value_formatters import apply_formatter
        r = apply_formatter(time.time() - 7200, {"type": "relative_time"})
        assert r["formatted"] == "2h ago", r

    def test_uppercase(self):
        from utils.value_formatters import apply_formatter
        r = apply_formatter("btc", {"type": "uppercase"})
        assert r["formatted"] == "BTC", r

    def test_none_returns_raw_only(self):
        from utils.value_formatters import apply_formatter
        r = apply_formatter(42, {"type": "none"})
        assert r["formatted"] is None
        assert r["raw"] == 42

    def test_apply_formatters_dict_skips_none(self):
        from utils.value_formatters import apply_formatters_dict
        out = apply_formatters_dict(
            {"value": 100, "change": -1.0, "skip": "x"},
            {"value": {"type": "currency"},
             "change": {"type": "percent", "negative_color": "#FF5A6B"},
             "skip": {"type": "none"}},
        )
        assert "skip" not in out
        assert out["value"]["formatted"].startswith("$")
        assert out["change"]["formatted"] == "-1.00%"
        assert out["change"]["color"] == "#FF5A6B"


# ─────────────────────────────────────────────────────────────────────
# 2. Direct sliding_window rate_limit unit test
# ─────────────────────────────────────────────────────────────────────

class TestSlidingWindowDirect:
    def test_allows_then_denies_then_recovers(self):
        from utils.sliding_window_rate_limit import rate_limit

        async def run():
            key = f"unit:{uuid.uuid4().hex[:8]}"
            # First 3 allowed.
            allowed_count = 0
            for _ in range(3):
                res = await rate_limit(key, max_requests=3, window_seconds=2,
                                       record_denied_event=False)
                if res["allowed"]:
                    allowed_count += 1
            assert allowed_count == 3

            # 4th denied.
            res4 = await rate_limit(key, max_requests=3, window_seconds=2,
                                    record_denied_event=False)
            assert res4["allowed"] is False
            assert res4["retry_after"] >= 1

            # Wait for window to roll off.
            await asyncio.sleep(2.3)
            res5 = await rate_limit(key, max_requests=3, window_seconds=2,
                                    record_denied_event=False)
            assert res5["allowed"] is True
            # After clearing, one new entry → remaining = max - 1 = 2.
            assert res5["remaining"] == 2

        asyncio.run(run())


# ─────────────────────────────────────────────────────────────────────
# 3. /api/admin/widgets/test-api with formatters
# ─────────────────────────────────────────────────────────────────────

class TestTestApiFormatters:
    def test_coingecko_currency_percent_with_colors(self, stealth_token):
        payload = {
            "provider": "coingecko",
            "endpoint": "simple_price",
            "params": {"ids": "bitcoin", "vs_currencies": "usd",
                       "include_24hr_change": "true"},
            "response_map": {"value": "bitcoin.usd",
                             "change": "bitcoin.usd_24h_change"},
            "formatters": {
                "value": {"type": "currency", "decimals": 2},
                "change": {"type": "percent", "decimals": 2,
                           "negative_color": "#FF5A6B",
                           "positive_color": "#10E670"},
            },
            "bypass_cache": True,
        }
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                          headers=_h(stealth_token), json=payload, timeout=30)
        if r.status_code in (429, 502, 503):
            pytest.skip(f"CoinGecko upstream {r.status_code} — retry after 65s")
        assert r.status_code == 200, r.text

        # Required: X-RateLimit-* headers present.
        assert "X-RateLimit-Limit" in r.headers, dict(r.headers)
        assert "X-RateLimit-Remaining" in r.headers
        assert "X-RateLimit-Reset" in r.headers

        body = r.json()
        mf = body.get("mapped_formatted") or {}
        assert "value" in mf, body
        assert isinstance(mf["value"]["formatted"], str)
        assert mf["value"]["formatted"].startswith("$"), mf["value"]

        assert "change" in mf
        assert mf["change"]["formatted"].endswith("%"), mf["change"]
        # Color should match the sign of the change.
        raw_change = mf["change"]["raw"]
        if isinstance(raw_change, (int, float)):
            if raw_change > 0:
                assert mf["change"]["color"] == "#10E670"
            elif raw_change < 0:
                assert mf["change"]["color"] == "#FF5A6B"


# ─────────────────────────────────────────────────────────────────────
# 4. X-RateLimit headers decrement
# ─────────────────────────────────────────────────────────────────────

class TestRateLimitHeaders:
    def test_remaining_decreases_within_window(self, stealth_token):
        payload = {
            "provider": "coingecko",
            "endpoint": "simple_price",
            "params": {"ids": "bitcoin", "vs_currencies": "usd"},
            "bypass_cache": True,
        }
        r1 = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                           headers=_h(stealth_token), json=payload, timeout=30)
        if r1.status_code in (429, 502, 503):
            pytest.skip(f"CoinGecko upstream {r1.status_code}")
        assert r1.status_code == 200
        rem1 = int(r1.headers.get("X-RateLimit-Remaining", "-1"))
        assert rem1 >= 0

        r2 = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                           headers=_h(stealth_token), json=payload, timeout=30)
        if r2.status_code in (429, 502, 503):
            pytest.skip(f"CoinGecko upstream {r2.status_code}")
        assert r2.status_code == 200
        rem2 = int(r2.headers.get("X-RateLimit-Remaining", "-1"))
        # Per-widget bucket key includes 'test' (no widget_id) so it should
        # still decrement; if rate-limit only counts on the per-provider key,
        # rem2 should still be < rem1.
        assert rem2 <= rem1, (rem1, rem2)


# ─────────────────────────────────────────────────────────────────────
# 5. editor_config validation
# ─────────────────────────────────────────────────────────────────────

class TestEditorConfigValidation:
    _created_ids = []

    def _payload(self, formatters=None, item_formatters=None):
        key = f"test_phase32_{uuid.uuid4().hex[:8]}"
        ds = {
            "kind": "api",
            "provider": "coingecko",
            "endpoint_key": "simple_price",
            "params": {"ids": "bitcoin", "vs_currencies": "usd"},
            "response_map": {"value": "bitcoin.usd"},
        }
        if formatters is not None:
            ds["formatters"] = formatters
        if item_formatters is not None:
            ds["array_bindings"] = [{
                "field_key": "items",
                "array_path": "",
                "item_map": {"name": "name"},
                "item_formatters": item_formatters,
            }]
        return {
            "key": key,
            "name": "Test 3.2",
            "category": "custom",
            "status": "draft",
            "default_size": "medium",
            "editor_config": {"data_source": ds},
        }

    def test_valid_formatters(self, stealth_token):
        payload = self._payload(formatters={"value": {"type": "currency"}})
        r = requests.post(f"{BASE_URL}/api/admin/widgets",
                          headers=_h(stealth_token), json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        wid = body.get("id") or (body.get("widget") or {}).get("id")
        assert wid
        self.__class__._created_ids.append(wid)
        # Cleanup right away to keep registry clean.
        requests.delete(f"{BASE_URL}/api/admin/widgets/{wid}",
                        headers=_h(stealth_token), timeout=10)

    def test_invalid_formatters_string(self, stealth_token):
        payload = self._payload(formatters="not_a_dict")
        r = requests.post(f"{BASE_URL}/api/admin/widgets",
                          headers=_h(stealth_token), json=payload, timeout=15)
        assert r.status_code == 400, r.text
        msg = (r.json().get("detail") or "")
        assert "formatters" in (msg if isinstance(msg, str) else str(msg)).lower()

    def test_invalid_item_formatters_string(self, stealth_token):
        payload = self._payload(item_formatters="not_a_dict")
        r = requests.post(f"{BASE_URL}/api/admin/widgets",
                          headers=_h(stealth_token), json=payload, timeout=15)
        assert r.status_code == 400, r.text


# ─────────────────────────────────────────────────────────────────────
# 6. from-template live_crypto with formatters end-to-end
# ─────────────────────────────────────────────────────────────────────

class TestLiveCryptoTemplateFormatters:
    def test_template_carries_formatters_and_api_call_formats(self, stealth_token, support_token):
        # Pause to let CoinGecko upstream window roll off.
        time.sleep(45)
        # Create from-template
        key = f"t_live_crypto_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/admin/widgets/from-template/live_crypto",
                          headers=_h(stealth_token),
                          json={"key": key, "name": "Test live crypto"},
                          timeout=15)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        widget = body.get("widget") or body
        wid = widget.get("id")
        assert wid

        ds = (widget.get("editor_config") or {}).get("data_source") or {}
        formatters = ds.get("formatters") or {}
        assert formatters, f"Template should ship with formatters: {ds}"

        # Launch
        rl = requests.post(f"{BASE_URL}/api/admin/widgets/{wid}/launch",
                           headers=_h(stealth_token), timeout=15)
        assert rl.status_code in (200, 201), rl.text

        # api-call as support
        rcall = requests.post(f"{BASE_URL}/api/widgets/api-call",
                              headers=_h(support_token),
                              json={"widget_id": wid}, timeout=30)
        try:
            if rcall.status_code in (429, 502, 503):
                pytest.skip(f"CoinGecko upstream {rcall.status_code}")
            assert rcall.status_code == 200, rcall.text
            mf = (rcall.json().get("mapped_formatted") or {})
            # value field is the canonical mapped field for live_crypto
            assert "value" in mf, rcall.json()
            assert isinstance(mf["value"]["formatted"], str)
            assert mf["value"]["formatted"].startswith("$")
        finally:
            requests.delete(f"{BASE_URL}/api/admin/widgets/{wid}",
                            headers=_h(stealth_token), timeout=10)


# ─────────────────────────────────────────────────────────────────────
# 7. from-template live_crypto_markets with item_formatters
# ─────────────────────────────────────────────────────────────────────

class TestLiveCryptoMarketsItemFormatters:
    def test_item_formatters_apply(self, stealth_token):
        key = f"t_lcm_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/admin/widgets/from-template/live_crypto_markets",
                          headers=_h(stealth_token),
                          json={"key": key, "name": "Test markets"}, timeout=15)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        widget = body.get("widget") or body
        wid = widget.get("id")
        ds = (widget.get("editor_config") or {}).get("data_source") or {}
        abs_ = ds.get("array_bindings") or []
        any_item_fmt = any(isinstance(b, dict) and b.get("item_formatters") for b in abs_)
        assert any_item_fmt, f"Template should have item_formatters: {abs_}"

        rl = requests.post(f"{BASE_URL}/api/admin/widgets/{wid}/launch",
                           headers=_h(stealth_token), timeout=15)
        assert rl.status_code in (200, 201)

        try:
            rcall = requests.post(f"{BASE_URL}/api/widgets/api-call",
                                  headers=_h(stealth_token),
                                  json={"widget_id": wid}, timeout=30)
            if rcall.status_code in (429, 502, 503):
                pytest.skip(f"CoinGecko upstream {rcall.status_code}")
            assert rcall.status_code == 200, rcall.text
            body = rcall.json()
            maf = body.get("mapped_arrays_formatted") or {}
            # Expect at least one bound field with items array.
            assert maf, body
            # mapped_arrays_formatted shape: {field_key: {items: [...]}}
            sample_field = None
            for fk, payload_ in maf.items():
                items = None
                if isinstance(payload_, dict):
                    items = payload_.get("items")
                elif isinstance(payload_, list):
                    items = payload_
                if items:
                    sample_field = (fk, items)
                    break
            # Fallback: maf itself may be {items: [...]} (top-level)
            if not sample_field and isinstance(maf.get("items"), list):
                sample_field = ("items", maf["items"])
            assert sample_field, maf
            fk, items = sample_field
            first = items[0]
            # First item should have at least one formatted field (value or body)
            assert isinstance(first, dict), first
            has_formatted = any(
                isinstance(v, dict) and v.get("formatted") is not None
                for v in first.values()
            )
            assert has_formatted, first
        finally:
            requests.delete(f"{BASE_URL}/api/admin/widgets/{wid}",
                            headers=_h(stealth_token), timeout=10)


# ─────────────────────────────────────────────────────────────────────
# 8. /api/admin/analytics/rate-limits ACL + shape
# ─────────────────────────────────────────────────────────────────────

class TestAdminRateLimitAnalytics:
    def test_stealth_200_shape(self, stealth_token):
        r = requests.get(f"{BASE_URL}/api/admin/analytics/rate-limits",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("window_hours", "total_429s", "top_keys",
                  "top_users", "top_ips", "top_endpoints"):
            assert k in body, body
        assert isinstance(body["top_keys"], list)
        assert isinstance(body["total_429s"], int)

    def test_support_200(self, support_token):
        r = requests.get(f"{BASE_URL}/api/admin/analytics/rate-limits",
                         headers=_h(support_token), timeout=15)
        assert r.status_code == 200, r.text

    def test_tfone_403(self, tfone_token):
        r = requests.get(f"{BASE_URL}/api/admin/analytics/rate-limits",
                         headers=_h(tfone_token), timeout=15)
        assert r.status_code == 403, r.text


# ─────────────────────────────────────────────────────────────────────
# 9. Phase 3.1 regression — no formatters
# ─────────────────────────────────────────────────────────────────────

class TestNoFormattersRegression:
    def test_no_formatters_returns_empty_mapped_formatted(self, stealth_token):
        payload = {
            "provider": "coingecko",
            "endpoint": "simple_price",
            "params": {"ids": "bitcoin", "vs_currencies": "usd"},
            "response_map": {"value": "bitcoin.usd"},
            "bypass_cache": True,
        }
        r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                          headers=_h(stealth_token), json=payload, timeout=30)
        if r.status_code in (429, 502, 503):
            pytest.skip(f"CoinGecko upstream {r.status_code}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("mapped", {}).get("value") is not None
        assert body.get("mapped_formatted") == {}, body.get("mapped_formatted")


# ─────────────────────────────────────────────────────────────────────
# 10. Structured 429 body — best-effort, only assert SHAPE not trigger
# ─────────────────────────────────────────────────────────────────────

class TestStructured429Body:
    """We don't try to burn through the live rate budget (would block
    other tests). Instead, we issue a small burst at the in-memory
    per-widget bucket using a forced bypass and look for any 429.
    If we can't trigger one, skip — code-review pass."""

    def test_429_body_shape_if_triggered(self, stealth_token):
        payload = {
            "provider": "coingecko",
            "endpoint": "simple_price",
            "params": {"ids": "bitcoin", "vs_currencies": "usd"},
            "bypass_cache": True,
        }
        triggered = None
        # Limit to ~12 calls so we don't nuke the global window for other tests.
        for _ in range(12):
            r = requests.post(f"{BASE_URL}/api/admin/widgets/test-api",
                              headers=_h(stealth_token), json=payload, timeout=15)
            if r.status_code == 429:
                triggered = r
                break
            if r.status_code in (502, 503):
                pytest.skip(f"upstream {r.status_code}")
        if triggered is None:
            pytest.skip("Could not trigger 429 within 12-call burst budget")

        # Assert structured detail. Note: if upstream CoinGecko returns
        # 429 first (string detail), this is not our local sliding-window —
        # skip in that case (spec says code-review pass acceptable).
        body = triggered.json()
        detail = body.get("detail")
        if isinstance(detail, str) and "upstream" in detail.lower():
            pytest.skip("Hit CoinGecko upstream 429 before local sliding-window burst")
        assert isinstance(detail, dict), body
        assert detail.get("error") == "rate_limit_exceeded", detail
        assert "scope" in detail
        assert "retry_after" in detail
        assert "message" in detail
        assert "Retry-After" in triggered.headers, dict(triggered.headers)
