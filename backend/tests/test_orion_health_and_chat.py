"""Phase 3.7.3 — Orion Health + Chat Self-Heal regression tests."""
import os
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

FOUNDER = {"email": "stealth", "password": "Password1$"}
SUPPORT = {"email": "support", "password": "Password1$"}
ORION_WIDGET_KEY = "stealth_ai_5a6"


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def founder():
    return _login(FOUNDER)


@pytest.fixture(scope="module")
def support():
    return _login(SUPPORT)


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    return c[DB_NAME]


# ── Health endpoint ───────────────────────────────────────────────────

class TestOrionHealth:
    def test_health_founder_ok(self, founder):
        r = founder.get(f"{BASE_URL}/api/admin/orion/health", timeout=15)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body.get("ok") is True, body
        checks = body.get("checks") or []
        names = [c["name"] for c in checks]
        expected = {"widget_registry", "chat_config", "llm_provider", "sidebar_ids", "dashboard_tiles", "palette_entries"}
        assert set(names) == expected, f"check names mismatch: {names}"
        assert len(checks) == 6
        for c in checks:
            assert c["ok"] is True, f"check failed: {c}"

    def test_health_support_403(self, support):
        r = support.get(f"{BASE_URL}/api/admin/orion/health", timeout=15)
        assert r.status_code == 403, r.text[:200]
        assert "Founder" in (r.json().get("detail") or "")

    def test_health_unauth_401(self):
        r = requests.get(f"{BASE_URL}/api/admin/orion/health", timeout=15)
        assert r.status_code == 401, r.text[:200]


# ── Chat happy path ───────────────────────────────────────────────────

class TestOrionChat:
    def _post(self, sess, message, widget_id=ORION_WIDGET_KEY):
        return sess.post(
            f"{BASE_URL}/api/widgets/chat/message",
            json={"widget_id": widget_id, "message": message},
            timeout=60,
        )

    def test_hello(self, founder):
        r = self._post(founder, "Hello")
        # Accept 200 with reply OR clean 503 (budget cap is documented).
        assert r.status_code in (200, 503), r.text[:300]
        body = r.json()
        if r.status_code == 200:
            assert body.get("reply") and isinstance(body["reply"], str)
            assert len(body["reply"]) > 0
        else:
            assert "Orion LLM provider is unavailable" in (body.get("detail") or "")

    def test_name(self, founder):
        r = self._post(founder, "What is your name?")
        assert r.status_code in (200, 503), r.text[:300]
        if r.status_code == 200:
            assert (r.json().get("reply") or "").strip()

    def test_help(self, founder):
        r = self._post(founder, "Help")
        assert r.status_code in (200, 503), r.text[:300]

    def test_founder_briefing_analytics_intercept(self, founder):
        r = self._post(founder, "Give me a founder briefing")
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        # Should be intercepted by orion_analytics (no LLM call)
        assert body.get("model") == "orion-analytics", body
        reply = body.get("reply") or ""
        assert "Founder" in reply or "Growth" in reply or "briefing" in reply.lower(), reply[:300]

    def test_unknown_widget_still_404(self, founder):
        r = self._post(founder, "Hi", widget_id="unknown_xxx_does_not_exist")
        assert r.status_code == 404, r.text[:200]
        assert "not found" in (r.json().get("detail") or "").lower()


# ── Self-heal flow ────────────────────────────────────────────────────

class TestOrionSelfHeal:
    def test_self_heal_after_registry_delete(self, founder, mongo):
        # 1) Delete the registry row
        col = mongo.widget_registry
        before = col.find_one({"$or": [{"id": ORION_WIDGET_KEY}, {"key": ORION_WIDGET_KEY}]})
        assert before is not None, "precondition: registry row must exist before delete"
        col.delete_many({"$or": [{"id": ORION_WIDGET_KEY}, {"key": ORION_WIDGET_KEY}]})
        assert col.find_one({"$or": [{"id": ORION_WIDGET_KEY}, {"key": ORION_WIDGET_KEY}]}) is None

        # 2) Call chat endpoint — must NOT 404
        r = founder.post(
            f"{BASE_URL}/api/widgets/chat/message",
            json={"widget_id": ORION_WIDGET_KEY, "message": "Hello"},
            timeout=60,
        )
        assert r.status_code in (200, 503), f"expected 200 or 503, got {r.status_code} {r.text[:300]}"
        if r.status_code == 503:
            assert "Orion LLM provider is unavailable" in (r.json().get("detail") or "")

        # 3) Verify auto-healed row inserted
        healed = col.find_one({"$or": [{"id": ORION_WIDGET_KEY}, {"key": ORION_WIDGET_KEY}]})
        assert healed is not None, "registry row should have been auto-healed"
        assert healed.get("auto_healed") is True, healed

        # 4) Second call — row should still be present (no duplicates)
        r2 = founder.post(
            f"{BASE_URL}/api/widgets/chat/message",
            json={"widget_id": ORION_WIDGET_KEY, "message": "Hello again"},
            timeout=60,
        )
        assert r2.status_code in (200, 503)
        count = col.count_documents({"$or": [{"id": ORION_WIDGET_KEY}, {"key": ORION_WIDGET_KEY}]})
        assert count == 1, f"expected exactly 1 registry row, found {count}"
