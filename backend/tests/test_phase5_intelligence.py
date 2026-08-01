"""Iteration 106 — Phase 5 ORAi Intelligence & Automation.

Focuses on permission boundaries (member 403s), CRUD sanity, validation,
integration between memory-injection + ORAi chat, and admin AI Command Center.
LLM-hitting endpoints (draft generate, ORAi chat) are limited to a couple of
calls to control cost — timeouts are 90s each.
"""
import os
import time

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
CID = "3ed43c2b553547fbb3e6ca23b405eb91"  # education center (stealth owns, tftwo member)
CID2 = "bcef1ec09c564cf0b9fa744db7f6820a"  # second center (shared course lives here)
COURSE_ID = "075f90ffcc3f41088b279dca7163c204"


def _login(email, pw):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def stealth():
    return {"Authorization": f"Bearer {_login('stealth', 'Password1$')}"}


@pytest.fixture(scope="module")
def tftwo():
    return {"Authorization": f"Bearer {_login('tftwo', 'pass1234')}"}


# ─── MEMORY ─────────────────────────────────────────────────────────────
class TestMemory:
    def test_list_manager(self, stealth):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID}/orai/memory", headers=stealth, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "memories" in d and isinstance(d["memories"], list)
        assert "enabled" in d

    def test_list_member_403(self, tftwo):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID}/orai/memory", headers=tftwo, timeout=30)
        assert r.status_code == 403

    def test_add_edit_pin_delete(self, stealth):
        r = requests.post(f"{BASE}/api/responsibility-center/{CID}/orai/memory", headers=stealth,
                          json={"content": "TEST_iter106 memory line", "category": "preference"}, timeout=30)
        assert r.status_code == 200, r.text
        mid = r.json()["memory"]["id"]
        # edit + pin
        r2 = requests.patch(f"{BASE}/api/responsibility-center/{CID}/orai/memory/{mid}", headers=stealth,
                            json={"pinned": True, "content": "TEST_iter106 edited"}, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["memory"]["pinned"] is True
        assert r2.json()["memory"]["content"] == "TEST_iter106 edited"
        # delete
        r3 = requests.delete(f"{BASE}/api/responsibility-center/{CID}/orai/memory/{mid}", headers=stealth, timeout=30)
        assert r3.status_code == 200

    def test_add_empty_400(self, stealth):
        r = requests.post(f"{BASE}/api/responsibility-center/{CID}/orai/memory", headers=stealth,
                          json={"content": "   "}, timeout=30)
        assert r.status_code == 400

    def test_export(self, stealth):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID}/orai/memory/export", headers=stealth, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["center_id"] == CID
        assert "memories" in d and "exported_at" in d

    def test_settings_toggle(self, stealth):
        # disable then re-enable — verify persist via list endpoint
        r = requests.put(f"{BASE}/api/responsibility-center/{CID}/orai/memory/settings", headers=stealth,
                         json={"enabled": False}, timeout=30)
        assert r.status_code == 200 and r.json()["enabled"] is False
        r2 = requests.get(f"{BASE}/api/responsibility-center/{CID}/orai/memory", headers=stealth, timeout=30)
        assert r2.status_code == 200 and r2.json()["enabled"] is False
        # re-enable
        r3 = requests.put(f"{BASE}/api/responsibility-center/{CID}/orai/memory/settings", headers=stealth,
                          json={"enabled": True}, timeout=30)
        assert r3.status_code == 200 and r3.json()["enabled"] is True

    def test_audit_contains_memory_action(self, stealth):
        r = requests.get(f"{BASE}/api/admin/responsibility-center/centers/{CID}/activity",
                         headers=stealth, timeout=30)
        assert r.status_code == 200, r.text
        rows = r.json().get("activity") or r.json().get("activities") or r.json().get("items") or []
        actions = {(row.get("action") or "") for row in rows}
        # We just added+deleted memory, so at minimum orai_memory_* should appear
        assert any(a.startswith("orai_memory_") for a in actions), f"Expected orai_memory_* in audit; got {actions}"


# ─── RECOMMENDATIONS ────────────────────────────────────────────────────
class TestRecommendations:
    def test_manager_gets_recs(self, stealth):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID}/orai/recommendations", headers=stealth, timeout=30)
        assert r.status_code == 200, r.text
        recs = r.json()["recommendations"]
        assert isinstance(recs, list)
        kinds = {x["kind"] for x in recs}
        assert "fire_low" in kinds  # vault low

    def test_member_can_read(self, tftwo):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID}/orai/recommendations", headers=tftwo, timeout=30)
        assert r.status_code == 200
        assert "recommendations" in r.json()


# ─── HEALTH ─────────────────────────────────────────────────────────────
class TestHealth:
    def test_health_score(self, stealth):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID}/health", headers=stealth, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert 0 <= d["score"] <= 100
        assert d["label"] in {"Excellent", "Good", "Needs Attention", "At Risk"}
        assert len(d["factors"]) == 7
        for f in d["factors"]:
            assert 0 <= f["score"] <= 100
            assert "weight" in f
        assert "explanation" in d
        assert isinstance(d["recommendations"], list)


# ─── AUTOMATIONS ────────────────────────────────────────────────────────
class TestAutomations:
    def test_list_manager(self, stealth):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID}/automations", headers=stealth, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["automations"], list)
        assert "triggers" in d and "actions" in d

    def test_list_member_403(self, tftwo):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID}/automations", headers=tftwo, timeout=30)
        assert r.status_code == 403

    def test_create_invalid_trigger_400(self, stealth):
        r = requests.post(f"{BASE}/api/responsibility-center/{CID}/automations", headers=stealth,
                          json={"trigger": {"type": "not_a_trigger"}, "actions": [{"type": "notify_manager"}]}, timeout=30)
        assert r.status_code == 400

    def test_create_empty_actions_400(self, stealth):
        r = requests.post(f"{BASE}/api/responsibility-center/{CID}/automations", headers=stealth,
                          json={"trigger": {"type": "lesson_completed"}, "actions": []}, timeout=30)
        assert r.status_code == 400

    def test_create_toggle_delete(self, stealth):
        r = requests.post(f"{BASE}/api/responsibility-center/{CID}/automations", headers=stealth,
                          json={"name": "TEST_iter106 auto", "trigger": {"type": "member_joined"},
                                "actions": [{"type": "notify_manager", "message": "New member!"}]}, timeout=30)
        assert r.status_code == 200, r.text
        aid = r.json()["automation"]["id"]
        r2 = requests.patch(f"{BASE}/api/responsibility-center/{CID}/automations/{aid}", headers=stealth,
                            json={"enabled": False}, timeout=30)
        assert r2.status_code == 200 and r2.json()["automation"]["enabled"] is False
        r3 = requests.delete(f"{BASE}/api/responsibility-center/{CID}/automations/{aid}", headers=stealth, timeout=30)
        assert r3.status_code == 200

    def test_run_check(self, stealth):
        r = requests.post(f"{BASE}/api/responsibility-center/{CID}/automations/run-check", headers=stealth, timeout=30)
        assert r.status_code == 200
        assert "fired" in r.json()


# ─── TEMPLATES ──────────────────────────────────────────────────────────
class TestTemplates:
    def test_list_templates(self, stealth):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID}/templates", headers=stealth, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["templates"], list)
        assert "kinds" in d

    def test_list_templates_member_403(self, tftwo):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID}/templates", headers=tftwo, timeout=30)
        assert r.status_code == 403

    def test_full_template_lifecycle(self, stealth):
        # save generic
        r = requests.post(f"{BASE}/api/responsibility-center/{CID}/templates", headers=stealth,
                          json={"name": "TEST_iter106 template", "kind": "generic",
                                "payload": {"key": "value", "hello": "world"}}, timeout=30)
        assert r.status_code == 200, r.text
        tid = r.json()["template"]["id"]

        # preview
        r2 = requests.get(f"{BASE}/api/responsibility-center/{CID}/templates/{tid}", headers=stealth, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["template"]["payload"]["key"] == "value"

        # duplicate
        r3 = requests.post(f"{BASE}/api/responsibility-center/{CID}/templates/{tid}/duplicate", headers=stealth, timeout=30)
        assert r3.status_code == 200
        dup_id = r3.json()["template"]["id"]
        assert dup_id != tid

        # export
        r4 = requests.get(f"{BASE}/api/responsibility-center/{CID}/templates/{tid}/export", headers=stealth, timeout=30)
        assert r4.status_code == 200
        assert r4.json()["format"] == "ourrealm.rc.template.v1"
        exported = r4.json()["template"]

        # import
        r5 = requests.post(f"{BASE}/api/responsibility-center/{CID}/templates/import", headers=stealth,
                           json={"template": exported}, timeout=30)
        assert r5.status_code == 200
        imp_id = r5.json()["template"]["id"]

        # archive
        r6 = requests.patch(f"{BASE}/api/responsibility-center/{CID}/templates/{tid}", headers=stealth,
                            json={"status": "archived"}, timeout=30)
        assert r6.status_code == 200

        # install (generic returns payload_keys)
        r7 = requests.post(f"{BASE}/api/responsibility-center/{CID}/templates/{dup_id}/install", headers=stealth, timeout=30)
        assert r7.status_code == 200
        assert "created" in r7.json()

        # cleanup
        for x in (tid, dup_id, imp_id):
            requests.delete(f"{BASE}/api/responsibility-center/{CID}/templates/{x}", headers=stealth, timeout=30)


# ─── SHARING ────────────────────────────────────────────────────────────
class TestSharing:
    def test_shared_list_shows_course(self, stealth):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID2}/courses-shared", headers=stealth, timeout=30)
        assert r.status_code == 200, r.text
        courses = r.json().get("courses") or r.json().get("shared") or []
        assert isinstance(courses, list)
        # Should include the shared course 075f90…
        creators = {(c.get("creator_username") or "") for c in courses}
        assert "stealth" in creators or any(c.get("id") == COURSE_ID for c in courses)

    def test_share_bad_visibility(self, stealth):
        r = requests.post(f"{BASE}/api/responsibility-center/{CID}/courses/{COURSE_ID}/share", headers=stealth,
                          json={"visibility": "bogus"}, timeout=30)
        assert r.status_code == 400

    def test_import_shared_creates_editable_copy(self, stealth):
        r = requests.post(f"{BASE}/api/responsibility-center/{CID2}/courses-shared/{COURSE_ID}/import",
                          headers=stealth, timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        new_id = d.get("course_id") or (d.get("course") or {}).get("id") or d.get("id")
        assert new_id and new_id != COURSE_ID
        assert d.get("credit", {}).get("original_creator") == "stealth"


# ─── ADMIN AI COMMAND CENTER ────────────────────────────────────────────
class TestAdminOrai:
    def test_config_read_write_founder(self, stealth):
        r = requests.get(f"{BASE}/api/admin/orai/config", headers=stealth, timeout=30)
        assert r.status_code == 200, r.text
        cfg = r.json()
        assert "safety_rules" in cfg

        r2 = requests.put(f"{BASE}/api/admin/orai/config", headers=stealth,
                          json={"safety_rules": "TEST_iter106 be encouraging.",
                                "course_generator": {"max_lessons": 15, "temperature": 0.7}}, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["safety_rules"] == "TEST_iter106 be encouraging."
        assert r2.json()["course_generator"]["max_lessons"] == 15

    def test_config_member_403(self, tftwo):
        r = requests.get(f"{BASE}/api/admin/orai/config", headers=tftwo, timeout=30)
        assert r.status_code == 403

    def test_prompts_crud(self, stealth):
        r = requests.post(f"{BASE}/api/admin/orai/prompts", headers=stealth,
                          json={"title": "TEST_iter106 prompt", "body": "hello", "category": "test"}, timeout=30)
        assert r.status_code == 200
        pid = r.json()["prompt"]["id"]
        r2 = requests.get(f"{BASE}/api/admin/orai/prompts", headers=stealth, timeout=30)
        assert r2.status_code == 200
        assert any(p["id"] == pid for p in r2.json()["prompts"])
        r3 = requests.delete(f"{BASE}/api/admin/orai/prompts/{pid}", headers=stealth, timeout=30)
        assert r3.status_code == 200

    def test_analytics(self, stealth):
        r = requests.get(f"{BASE}/api/admin/orai/analytics", headers=stealth, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_audit(self, stealth):
        r = requests.get(f"{BASE}/api/admin/orai/audit", headers=stealth, timeout=30)
        assert r.status_code == 200
        rows = r.json().get("entries") or r.json().get("audit") or r.json().get("items") or []
        assert isinstance(rows, list)

    def test_providers(self, stealth):
        r = requests.get(f"{BASE}/api/admin/orai/providers", headers=stealth, timeout=30)
        assert r.status_code == 200
        provs = r.json().get("providers") or []
        assert len(provs) >= 3
        for p in provs:
            assert "configured" in p

    def test_admin_memory(self, stealth):
        r = requests.get(f"{BASE}/api/admin/orai/memory", headers=stealth, timeout=30)
        assert r.status_code == 200

    def test_admin_automations(self, stealth):
        r = requests.get(f"{BASE}/api/admin/orai/automations", headers=stealth, timeout=30)
        assert r.status_code == 200

    def test_admin_templates(self, stealth):
        r = requests.get(f"{BASE}/api/admin/orai/templates", headers=stealth, timeout=30)
        assert r.status_code == 200


# ─── INTELLIGENCE OVERVIEW ──────────────────────────────────────────────
class TestOverview:
    def test_overview_manager(self, stealth):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID}/intelligence/overview", headers=stealth, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["can_manage"] is True
        assert "health" in d and 0 <= d["health"]["score"] <= 100
        assert "recommendations" in d
        assert "automations" in d
        assert len(d["trend"]) == 7
        assert "stats" in d

    def test_overview_member(self, tftwo):
        r = requests.get(f"{BASE}/api/responsibility-center/{CID}/intelligence/overview", headers=tftwo, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["can_manage"] is False
        # memory_count/drafts_pending should be None (manager-only)
        assert d.get("memory_count") is None
        assert d.get("drafts_pending") is None


# ─── LLM: ORAi chat reflects stored memory (1 LLM call) ─────────────────
class TestOraiChat:
    def test_chat_uses_memory(self, stealth):
        r = requests.post(f"{BASE}/api/responsibility-center/{CID}/orai/chat", headers=stealth,
                          json={"message": "In one short sentence, what topic do you remember about this center?"},
                          timeout=90)
        assert r.status_code == 200, r.text
        reply = (r.json().get("reply") or r.json().get("message") or "").lower()
        # Memory stored is space/astronomy themed
        assert any(k in reply for k in ("space", "astro", "star", "planet", "solar", "cosmic")), f"reply: {reply[:400]}"
