"""Phase 3.6 — Orion analytics interceptor tests.

Verifies that founder/admin chat messages matching analytics intents
bypass OpenAI and return deterministic markdown; non-admins get a
polite refusal; non-analytics messages fall through to OpenAI; audit
log captures every attempt with required fields.
"""
import os
import time
import uuid
import pytest
import requests
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")  # backend env for MONGO_URL
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

FOUNDER_USERNAME = "stealth"
FOUNDER_PASSWORD = "Password1$"
MEMBER_USERNAME = "tfone"
MEMBER_PASSWORD = "pass1234"
FOUNDER_WIDGET_KEY = "stealth_ai_5a6"
PUBLIC_WIDGET_KEY = "iter62_orion_test"


def _login(username: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": username, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def founder_token():
    return _login(FOUNDER_USERNAME, FOUNDER_PASSWORD)


@pytest.fixture(scope="module")
def member_token():
    return _login(MEMBER_USERNAME, MEMBER_PASSWORD)


@pytest.fixture(scope="module")
def founder_headers(founder_token):
    return {"Authorization": f"Bearer {founder_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def member_headers(member_token):
    return {"Authorization": f"Bearer {member_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def public_widget(founder_headers):
    """Create a public (non-founder-only) chat widget for the refusal path
    by directly inserting via Mongo (sync pymongo). Cleaned up at end."""
    from pymongo import MongoClient
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ.get("DB_NAME", "ourrealm")
    client = MongoClient(mongo_url)
    sync_db = client[db_name]

    widget_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": widget_id,
        "key": PUBLIC_WIDGET_KEY,
        "name": "Iter 62 Test",
        "widget_type": "profile",
        "category": "custom",
        "icon": "Bot",
        "status": "live",
        "access_groups": ["all_users"],
        "placements": ["profile"],
        "editor_config": {
            "chat": {
                "mode": "conversational",
                "system_prompt": "Friendly.",
                "model": "gpt-5.4-mini",
                "memory_mode": "off",
                "founder_only": False,
            }
        },
        "created_by": "test",
        "created_at": now,
        "updated_at": now,
        "is_system": False,
        "sort_order": 9999,
    }

    sync_db.widget_registry.delete_many({"key": PUBLIC_WIDGET_KEY})
    sync_db.widget_registry.insert_one(doc)
    yield PUBLIC_WIDGET_KEY
    sync_db.widget_registry.delete_many({"key": PUBLIC_WIDGET_KEY})
    client.close()


def _post_chat(headers, widget_id, message):
    return requests.post(
        f"{BASE_URL}/api/widgets/chat/message",
        headers=headers,
        json={"widget_id": widget_id, "message": message},
        timeout=60,
    )


# ─────────────────────────────────────────────────────────────────────
# Setup sanity
# ─────────────────────────────────────────────────────────────────────
class TestAuth:
    def test_founder_login(self, founder_token):
        assert isinstance(founder_token, str) and len(founder_token) > 20

    def test_member_login(self, member_token):
        assert isinstance(member_token, str) and len(member_token) > 20


# ─────────────────────────────────────────────────────────────────────
# Founder analytics path — all major intents
# ─────────────────────────────────────────────────────────────────────
class TestFounderAnalytics:
    @pytest.mark.parametrize("message,must_contain", [
        ("Show today snapshot",            ["Today's snapshot:", "DAU:", "New users today:"]),
        ("Give me an investor snapshot",   ["Investor snapshot (30-day window):", "Status:"]),
        ("How many users signed up this week?", ["Today:", "This week:", "Total users:"]),
        ("What is the DAU?",               ["DAU:", "WAU:", "MAU:"]),
        ("Show me top realms",             ["Top", "realms (last 7 days)"]),
        ("Open support tickets?",          ["Support:", "Open tickets:"]),
        ("Moderation reports today?",      ["Moderation:", "Open reports:"]),
        ("How many badges have been awarded?", ["Badge counts:"]),
        ("Most used widgets?",             ["Top widgets"]),
    ])
    def test_intent_returns_orion(self, founder_headers, message, must_contain):
        r = _post_chat(founder_headers, FOUNDER_WIDGET_KEY, message)
        assert r.status_code == 200, f"{message}: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("model") == "orion-analytics", f"{message}: model={data.get('model')}"
        assert data.get("finish_reason") == "analytics_tool"
        reply = data.get("reply") or ""
        for needle in must_contain:
            assert needle in reply, f"{message}: missing '{needle}' in reply: {reply[:300]}"


# ─────────────────────────────────────────────────────────────────────
# Intent router edge phrasings
# ─────────────────────────────────────────────────────────────────────
class TestIntentRouter:
    @pytest.mark.parametrize("message", [
        "DAU?",
        "weekly active users",
        "how many users total?",
        "sounds uploaded today",
        "top creators",
        "new realms this week",
        "moderation queue",
        "open tickets",
        "vip holders",
    ])
    def test_phrasing_routes_to_orion(self, founder_headers, message):
        r = _post_chat(founder_headers, FOUNDER_WIDGET_KEY, message)
        assert r.status_code == 200, f"{message}: {r.status_code} {r.text}"
        assert r.json().get("model") == "orion-analytics", f"{message}: {r.json()}"


# ─────────────────────────────────────────────────────────────────────
# Fall-through (non-analytics) → OpenAI
# ─────────────────────────────────────────────────────────────────────
class TestFallThrough:
    def test_founder_non_analytics_falls_through(self, founder_headers):
        r = _post_chat(founder_headers, FOUNDER_WIDGET_KEY, "Hello there")
        assert r.status_code == 200, r.text
        data = r.json()
        model = (data.get("model") or "").lower()
        assert model != "orion-analytics", f"Expected gpt-*, got orion-analytics: {data}"
        assert model.startswith("gpt") or "gpt" in model, f"Expected gpt-* model, got: {model}"

    def test_long_non_analytics_falls_through(self, founder_headers):
        msg = "foo bar baz qux " * 20  # ~320 chars, no analytics keyword
        r = _post_chat(founder_headers, FOUNDER_WIDGET_KEY, msg.strip())
        assert r.status_code == 200
        assert r.json().get("model") != "orion-analytics"


# ─────────────────────────────────────────────────────────────────────
# Refusal path (non-admin)
# ─────────────────────────────────────────────────────────────────────
class TestRefusalPath:
    EXPECTED = ("Those administrative analytics are only available to authorized "
                "OurRealm administrators.")

    def test_non_admin_analytics_refused(self, member_headers, public_widget):
        r = _post_chat(member_headers, public_widget, "How many signups this week?")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("reply") == self.EXPECTED, f"reply={data.get('reply')!r}"
        assert data.get("model") == "orion-analytics"

    def test_non_admin_normal_chat_still_works(self, member_headers, public_widget):
        r = _post_chat(member_headers, public_widget, "Hello what is your name?")
        assert r.status_code == 200, r.text
        model = (r.json().get("model") or "").lower()
        assert model != "orion-analytics", r.json()
        assert "gpt" in model


# ─────────────────────────────────────────────────────────────────────
# Edge cases
# ─────────────────────────────────────────────────────────────────────
class TestEdgeCases:
    def test_empty_message_422(self, founder_headers):
        r = requests.post(
            f"{BASE_URL}/api/widgets/chat/message",
            headers=founder_headers,
            json={"widget_id": FOUNDER_WIDGET_KEY, "message": ""},
            timeout=20,
        )
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"


# ─────────────────────────────────────────────────────────────────────
# Performance
# ─────────────────────────────────────────────────────────────────────
class TestPerformance:
    def test_today_snapshot_under_2s_p95(self, founder_headers):
        timings = []
        for _ in range(5):
            t0 = time.perf_counter()
            r = _post_chat(founder_headers, FOUNDER_WIDGET_KEY, "Show today snapshot")
            elapsed = (time.perf_counter() - t0) * 1000
            assert r.status_code == 200
            assert r.json().get("model") == "orion-analytics"
            timings.append(elapsed)
        assert max(timings) < 2000, f"timings ms: {timings}"


# ─────────────────────────────────────────────────────────────────────
# Audit log
# ─────────────────────────────────────────────────────────────────────
class TestAuditLog:
    def test_audit_log_captures_founder_and_refusal(self, founder_headers, member_headers, public_widget):
        # Make one tracked founder call + one refusal call right now.
        marker_founder = f"AUDIT_PROBE_F_{uuid.uuid4().hex[:8]}"
        marker_member = f"AUDIT_PROBE_M_{uuid.uuid4().hex[:8]}"

        r1 = _post_chat(founder_headers, FOUNDER_WIDGET_KEY, f"Show today snapshot {marker_founder}")
        assert r1.status_code == 200
        r2 = _post_chat(member_headers, public_widget, f"How many signups this week? {marker_member}")
        assert r2.status_code == 200

        # Give Mongo a moment.
        time.sleep(0.3)

        from pymongo import MongoClient
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ.get("DB_NAME", "ourrealm")
        client = MongoClient(mongo_url)
        sync_db = client[db_name]
        rows_f = list(sync_db.orion_admin_query_logs.find(
            {"question": {"$regex": marker_founder}}
        ).limit(10))
        rows_m = list(sync_db.orion_admin_query_logs.find(
            {"question": {"$regex": marker_member}}
        ).limit(10))
        client.close()

        assert len(rows_f) >= 1, "founder analytics call not logged"
        f = rows_f[0]
        for field in ("user_id", "username", "role", "question", "detected_intent",
                      "tool_called", "timestamp", "success", "execution_time_ms",
                      "short_result_summary"):
            assert field in f, f"missing audit field {field}: {f}"
        assert f["success"] is True
        assert f["detected_intent"] == "today_snapshot"
        assert f["username"] == FOUNDER_USERNAME
        assert isinstance(f["execution_time_ms"], int)
        # No leaked secrets in question (no Bearer/api_key)
        assert "Bearer" not in f["question"]
        assert "api_key" not in f["question"].lower()

        assert len(rows_m) >= 1, "non-admin refusal not logged"
        m = rows_m[0]
        assert m["success"] is False
        assert m["short_result_summary"] == "refused: not_admin"
        assert m["username"] == MEMBER_USERNAME


# ─────────────────────────────────────────────────────────────────────
# Read-only guarantee
# ─────────────────────────────────────────────────────────────────────
class TestReadOnly:
    def test_orion_analytics_only_writes_audit_log(self):
        src_path = "/app/backend/services/orion_analytics.py"
        with open(src_path, "r") as f:
            src = f.read()
        # Strip comments / docstrings is overkill — just check that any
        # write call uses the audit-log collection name.
        write_methods = ["insert_one(", "insert_many(",
                         "update_one(", "update_many(",
                         "delete_one(", "delete_many(",
                         "replace_one(", "find_one_and_update(",
                         "find_one_and_delete(", "find_one_and_replace("]
        for method in write_methods:
            idx = 0
            while True:
                pos = src.find(method, idx)
                if pos == -1:
                    break
                # Look back 100 chars to find the collection name.
                window = src[max(0, pos - 200): pos]
                assert "orion_admin_query_logs" in window, (
                    f"Found {method} at pos {pos} not on orion_admin_query_logs collection. "
                    f"Context: ...{window[-200:]}{method}..."
                )
                idx = pos + len(method)


# ─────────────────────────────────────────────────────────────────────
# Regression: phase 3.5 endpoints still respond
# ─────────────────────────────────────────────────────────────────────
class TestRegressionPhase35:
    def test_history_endpoint(self, founder_headers):
        r = requests.get(
            f"{BASE_URL}/api/widgets/chat/history",
            headers=founder_headers,
            params={"widget_id": FOUNDER_WIDGET_KEY},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "messages" in data or "widget_id" in data

    def test_clear_endpoint(self, founder_headers):
        r = requests.post(
            f"{BASE_URL}/api/widgets/chat/clear",
            headers=founder_headers,
            json={"widget_id": FOUNDER_WIDGET_KEY},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert "deleted" in r.json()

    def test_investor_snapshot_endpoint_intact(self, founder_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/realm-pulse/investor-snapshot",
            headers=founder_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for field in ("dau", "wau", "mau"):
            assert field in data, f"missing {field}: {data}"
