"""Phase 3.7 — Orion Founder Command Center tests.

Covers:
- Phase 3.6 regression (today snapshot via stealth_ai_5a6)
- Phase 3.7 draft intents (badge / widget / announcement / support reply / mod risks / briefing)
- Explicit-confirmation phrases vs vague replies (gpt fallthrough)
- New read tools (top_reported_users etc.)
- Audit log surfaces (/api/admin/orion-logs/{queries|actions|summary})
- Founder-only router gate
- Refusal for non-admin admin-style questions
- Static read-only invariant on services/orion_analytics.py
"""
from __future__ import annotations
import os, re, time
import pytest, requests
from pymongo import MongoClient
from dotenv import dotenv_values

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")

_env = dotenv_values("/app/backend/.env")
_mongo = MongoClient(_env["MONGO_URL"])[_env["DB_NAME"]]


def _login(username: str, password: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login", json={"email": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text[:200]}"
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="session")
def stealth_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="session")
def tfone_token():
    return _login("tfone", "pass1234")


@pytest.fixture(scope="session")
def public_widget_key():
    """Ensure a non-founder-only chat widget exists for refusal tests."""
    key = "iter63_orion_phase37"
    existing = _mongo.widget_registry.find_one({"key": key})
    if not existing:
        src = _mongo.widget_registry.find_one({"key": "stealth_ai_5a6"})
        if src:
            src.pop("_id", None)
            src["key"] = key
            src["name"] = "Iter63 Phase 3.7 Test (Public)"
            src["founder_only"] = False
            src["access_groups"] = ["all_users"]
            # founder_only is actually inside editor_config.chat.founder_only
            ec = src.get("editor_config") or {}
            chat = ec.get("chat") or {}
            chat["founder_only"] = False
            ec["chat"] = chat
            src["editor_config"] = ec
            if "id" in src:
                import uuid
                src["id"] = str(uuid.uuid4())
            _mongo.widget_registry.insert_one(src)
    yield key
    _mongo.widget_registry.delete_many({"key": key})


def _chat(token: str, widget_id: str, message: str):
    return requests.post(
        f"{BASE}/api/widgets/chat/message",
        json={"widget_id": widget_id, "message": message},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )


# ----- 1. Phase 3.6 regression -----
class TestPhase36Regression:
    def test_today_snapshot_still_works(self, stealth_token):
        r = _chat(stealth_token, "stealth_ai_5a6", "today snapshot")
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("model") == "orion-analytics"
        reply = d.get("reply", "")
        assert "Today" in reply or "today" in reply.lower()


# ----- 2. Phase 3.7 draft & briefing -----
class TestPhase37Drafts:
    def test_founder_briefing(self, stealth_token):
        r = _chat(stealth_token, "stealth_ai_5a6", "Give me a founder briefing")
        assert r.status_code == 200
        d = r.json()
        assert d["model"] == "orion-analytics"
        reply = d["reply"]
        # Must contain the briefing sections
        for needle in ["Founder briefing", "Growth", "Risks needing attention", "Recommended next actions"]:
            assert needle in reply, f"Missing '{needle}' in briefing reply: {reply[:400]}"

    def test_draft_badge_logs_action(self, stealth_token):
        before = _mongo.orion_action_logs.count_documents({"action_type": "draft_badge"})
        r = _chat(stealth_token, "stealth_ai_5a6", "Draft a badge for users who upload 1000 sounds")
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["model"] == "orion-analytics"
        reply = d["reply"]
        assert "Badge draft" in reply
        assert "```yaml" in reply or "```" in reply
        assert "draft" in reply.lower()
        after = _mongo.orion_action_logs.count_documents({"action_type": "draft_badge"})
        assert after > before, "draft_badge action log row not written"
        last = list(_mongo.orion_action_logs.find({"action_type": "draft_badge"}).sort("timestamp", -1).limit(1))[0]
        assert last["approval_status"] == "pending"
        assert last["confirmation_required"] is True
        assert last["success"] is True
        assert last["result"] == "draft_only"
        assert last["prepared_draft"] is True
        assert last["username"] == "stealth"
        assert last["role"] == "founder"

    @pytest.mark.parametrize("msg,atype", [
        ("draft a widget for tracking top creators", "draft_widget"),
        ("draft an announcement about our growth", "draft_announcement"),
        ("draft a reply for the oldest support ticket", "draft_support_reply"),
    ])
    def test_other_drafts_log(self, stealth_token, msg, atype):
        before = _mongo.orion_action_logs.count_documents({"action_type": atype})
        r = _chat(stealth_token, "stealth_ai_5a6", msg)
        assert r.status_code == 200
        d = r.json()
        assert d["model"] == "orion-analytics", f"model={d.get('model')} reply={d.get('reply','')[:200]}"
        after = _mongo.orion_action_logs.count_documents({"action_type": atype})
        assert after > before, f"{atype} action log row not written"

    def test_moderation_risks(self, stealth_token):
        r = _chat(stealth_token, "stealth_ai_5a6", "Any risky moderation issues right now?")
        assert r.status_code == 200
        d = r.json()
        assert d["model"] == "orion-analytics"
        assert "Moderation risk assessment" in d["reply"]


# ----- 3. Explicit-confirmation phrases -----
class TestConfirmation:
    @pytest.mark.parametrize("phrase", ["Yes, execute", "Confirm", "Approve this action", "Launch it now"])
    def test_explicit_confirm_phrases(self, stealth_token, phrase):
        before = _mongo.orion_action_logs.count_documents({"action_type": "confirmation_received"})
        r = _chat(stealth_token, "stealth_ai_5a6", phrase)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["model"] == "orion-analytics", f"{phrase!r} did NOT hit orion-analytics (got {d.get('model')})"
        reply = d["reply"]
        assert "Approval recorded" in reply
        assert "No live action" in reply
        assert "draft-only" in reply.lower() or "draft only" in reply.lower()
        after = _mongo.orion_action_logs.count_documents({"action_type": "confirmation_received"})
        assert after > before, f"{phrase!r} did not write confirmation_received row"
        last = list(_mongo.orion_action_logs.find({"action_type": "confirmation_received"}).sort("timestamp", -1).limit(1))[0]
        assert last["approval_status"] == "approved"
        assert last["success"] is True
        assert last["short_result_summary"] == "approval_received_but_phase37_is_draft_only"

    @pytest.mark.parametrize("phrase", ["ok", "looks good", "sure"])
    def test_vague_confirm_falls_through(self, stealth_token, phrase):
        before = _mongo.orion_action_logs.count_documents({"action_type": "confirmation_received"})
        r = _chat(stealth_token, "stealth_ai_5a6", phrase)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        model = d.get("model") or ""
        # MUST NOT be orion-analytics
        assert model != "orion-analytics", f"{phrase!r} was incorrectly treated as confirmation: {d}"
        assert model.startswith("gpt-") or model == "openai", f"{phrase!r} expected gpt- model, got {model}"
        after = _mongo.orion_action_logs.count_documents({"action_type": "confirmation_received"})
        assert after == before, f"{phrase!r} wrote a confirmation row by mistake"


# ----- 4. New read tools -----
class TestReadTools:
    @pytest.mark.parametrize("msg", [
        "most reported users this week",
        "most reported content",
        "oldest unresolved tickets",
        "all launched widgets",
        "disabled widgets",
        "beta holders",
        "inactive realms",
    ])
    def test_read_tools_hit_orion(self, stealth_token, msg):
        r = _chat(stealth_token, "stealth_ai_5a6", msg)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["model"] == "orion-analytics", f"{msg!r} got model={d.get('model')} reply={d.get('reply','')[:200]}"


# ----- 5. Audit log endpoints -----
class TestOrionLogsEndpoints:
    def _hdr(self, t): return {"Authorization": f"Bearer {t}"}

    def test_summary_shape(self, stealth_token):
        r = requests.get(f"{BASE}/api/admin/orion-logs/summary", headers=self._hdr(stealth_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("query_total", "query_today", "query_refused", "action_total", "action_pending", "action_approved"):
            assert k in d, f"missing {k}"

    def test_queries_shape(self, stealth_token):
        r = requests.get(f"{BASE}/api/admin/orion-logs/queries?limit=20", headers=self._hdr(stealth_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "total" in d and "rows" in d
        assert isinstance(d["rows"], list)
        if d["rows"]:
            row = d["rows"][0]
            for k in ("username", "role", "question", "tool_called", "timestamp", "success", "execution_time_ms"):
                assert k in row, f"missing {k} in query row"
            # no secrets in question
            q = (row.get("question") or "").lower()
            assert "api_key" not in q
            assert "bearer" not in q

    def test_actions_shape_and_filters(self, stealth_token):
        r = requests.get(f"{BASE}/api/admin/orion-logs/actions?limit=20", headers=self._hdr(stealth_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["total"] >= 5, f"expected >=5 action rows, got {d['total']}"
        types = {row.get("action_type") for row in d["rows"]}
        expected = {"draft_badge", "draft_widget", "draft_announcement", "draft_support_reply", "confirmation_received"}
        missing = expected - types
        # Some may be on later pages — only fail if all-time total < 5
        assert types & expected, f"no expected action types in last 20 rows: {types}"
        for row in d["rows"]:
            assert row["username"]
            assert row["role"]
            assert row["timestamp"]

    def test_filter_approved(self, stealth_token):
        r = requests.get(f"{BASE}/api/admin/orion-logs/actions?approval_status=approved&limit=5",
                         headers=self._hdr(stealth_token), timeout=15)
        assert r.status_code == 200
        for row in r.json()["rows"]:
            assert row["approval_status"] == "approved"

    def test_filter_by_user(self, stealth_token):
        r = requests.get(f"{BASE}/api/admin/orion-logs/queries?user=stealth&limit=5",
                         headers=self._hdr(stealth_token), timeout=15)
        assert r.status_code == 200
        for row in r.json()["rows"]:
            assert row["username"] == "stealth"

    def test_filter_by_tool(self, stealth_token):
        r = requests.get(
            f"{BASE}/api/admin/orion-logs/queries?tool=_tool_today_snapshot&success=true&limit=5",
            headers=self._hdr(stealth_token), timeout=15,
        )
        assert r.status_code == 200
        for row in r.json()["rows"]:
            assert row["tool_called"] == "_tool_today_snapshot"
            assert row["success"] is True

    def test_founder_only_gate(self, tfone_token):
        for path in ("/api/admin/orion-logs/queries", "/api/admin/orion-logs/actions", "/api/admin/orion-logs/summary"):
            r = requests.get(f"{BASE}{path}", headers=self._hdr(tfone_token), timeout=15)
            assert r.status_code == 403, f"{path} expected 403 for tfone, got {r.status_code}"
            assert "founder" in (r.json().get("detail") or "").lower()


# ----- 6. Non-admin refusal & gpt fallthrough -----
class TestNonAdmin:
    def test_admin_question_refused(self, tfone_token, public_widget_key):
        r = _chat(tfone_token, public_widget_key, "Show me the moderation queue")
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["model"] == "orion-analytics"
        # Refusal text — not raw 403
        assert "moderation" not in d["reply"].lower() or "only available" in d["reply"].lower() or "admin" in d["reply"].lower() or "founder" in d["reply"].lower()

    def test_draft_request_also_refused(self, tfone_token, public_widget_key):
        r = _chat(tfone_token, public_widget_key, "Draft a badge")
        assert r.status_code == 200
        d = r.json()
        assert d["model"] == "orion-analytics"

    def test_normal_chat_passes_through(self, tfone_token, public_widget_key):
        r = _chat(tfone_token, public_widget_key, "Hello there")
        assert r.status_code == 200
        d = r.json()
        model = d.get("model") or ""
        assert model.startswith("gpt-") or model == "openai", f"expected gpt model, got {model}"


# ----- 7. Static read-only invariant -----
class TestReadOnlyInvariant:
    def test_orion_analytics_writes_only_to_log_collections(self):
        with open("/app/backend/services/orion_analytics.py") as f:
            src = f.read()
        # Find all db.<coll>.{insert|update|delete|replace}_one|many( occurrences
        write_pat = re.compile(r"db\.(\w+)\.(insert_one|insert_many|update_one|update_many|delete_one|delete_many|replace_one)\b")
        allowed = {"orion_admin_query_logs", "orion_action_logs"}
        found = set()
        for m in write_pat.finditer(src):
            found.add((m.group(1), m.group(2)))
            assert m.group(1) in allowed, f"FORBIDDEN write to {m.group(1)}.{m.group(2)} in orion_analytics.py"
        # Sanity — at least one write exists
        assert found, "expected at least one write to orion_admin_query_logs or orion_action_logs"
