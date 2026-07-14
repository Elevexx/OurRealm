"""June 2026 update tests — Polls separation, Realm widgets, Relationships.

Covers:
  - POST /api/posts with a poll → media_type normalized to "poll"
  - GET /api/posts?media_type=poll returns only polls
  - GET /api/posts?media_type=thought excludes polls
  - GET /api/widgets/available?placement=realm only offers renderable types
  - POST realm widget with registry UUID / "polls" alias → canonical type key
  - Data-health poll migration + realm widget dry-runs (founder-only)
  - Relationship audit endpoint shape + founder-only access
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

FOUNDER = {"email": "slopestyle2022@gmail.com", "password": "Password1$"}
USER = {"email": "auditcheck.real@gmail.com", "password": "Password1$"}


@pytest.fixture(scope="session")
def founder_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=FOUNDER, timeout=20)
    assert r.status_code == 200, f"founder login failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def user_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=USER, timeout=20)
    assert r.status_code == 200, f"user login failed: {r.text}"
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ─── Polls vs Thoughts separation ────────────────────────────────────
@pytest.fixture(scope="module")
def created_posts(founder_token):
    """One thought + one poll, cleaned up after the module."""
    thought = requests.post(f"{BASE_URL}/api/posts", headers=_h(founder_token), json={
        "content": f"test thought {uuid.uuid4().hex[:6]}", "media_type": "thought",
    }, timeout=20).json()
    poll = requests.post(f"{BASE_URL}/api/posts", headers=_h(founder_token), json={
        "content": f"test poll {uuid.uuid4().hex[:6]}", "media_type": "thought",
        "poll": {"question": "Automated poll separation test?",
                 "options": [{"text": "Yes"}, {"text": "No"}], "duration_hours": 24},
    }, timeout=20).json()
    yield thought, poll
    for p in (thought, poll):
        pid = (p.get("post") or p).get("id")
        if pid:
            requests.delete(f"{BASE_URL}/api/posts/{pid}", headers=_h(founder_token), timeout=20)


def _post_of(resp):
    return resp.get("post") or resp


def test_poll_saved_as_poll_media_type(created_posts):
    _, poll = created_posts
    assert _post_of(poll).get("media_type") == "poll", \
        f"poll post should be normalized to media_type='poll', got {_post_of(poll).get('media_type')}"


def test_thought_stays_thought(created_posts):
    thought, _ = created_posts
    assert _post_of(thought).get("media_type") == "thought"


def test_poll_filter_returns_only_polls(founder_token, created_posts):
    r = requests.get(f"{BASE_URL}/api/posts", params={"media_type": "poll"},
                     headers=_h(founder_token), timeout=20)
    assert r.status_code == 200
    posts = r.json()["posts"]
    poll_id = _post_of(created_posts[1])["id"]
    assert any(p["id"] == poll_id for p in posts), "created poll missing from poll filter"
    for p in posts:
        assert p.get("poll"), f"non-poll post {p['id']} leaked into poll filter"


def test_thought_filter_excludes_polls(founder_token, created_posts):
    r = requests.get(f"{BASE_URL}/api/posts", params={"media_type": "thought"},
                     headers=_h(founder_token), timeout=20)
    assert r.status_code == 200
    posts = r.json()["posts"]
    thought_id = _post_of(created_posts[0])["id"]
    poll_id = _post_of(created_posts[1])["id"]
    ids = {p["id"] for p in posts}
    assert thought_id in ids, "created thought missing from thought filter"
    assert poll_id not in ids, "poll leaked into thought filter"
    for p in posts:
        assert not p.get("poll"), f"poll post {p['id']} leaked into thought filter"


# ─── Realm widget pipeline ───────────────────────────────────────────
@pytest.fixture(scope="module")
def realm_id(founder_token):
    r = requests.get(f"{BASE_URL}/api/communities/realms", headers=_h(founder_token), timeout=20)
    assert r.status_code == 200
    realms = r.json().get("realms") or r.json().get("rows") or []
    assert realms, "no realms in DB"
    return realms[0]["id"]


def test_realm_available_widgets_are_renderable(founder_token):
    r = requests.get(f"{BASE_URL}/api/widgets/available?placement=realm",
                     headers=_h(founder_token), timeout=20)
    assert r.status_code == 200
    supported = {"poll", "polls", "hub", "announcements", "rules", "notes",
                 "countdown", "calendar", "top8", "events"}
    for w in r.json()["widgets"]:
        assert w.get("key") in supported or w.get("editor_config"), \
            f"unrenderable widget '{w.get('key')}' offered for realm placement"


def test_add_widget_normalizes_polls_alias(founder_token, realm_id):
    r = requests.post(f"{BASE_URL}/api/communities/realm/{realm_id}/widgets",
                      headers=_h(founder_token), json={"type": "polls", "size": "medium"}, timeout=20)
    assert r.status_code == 200, r.text
    w = r.json()
    assert w["type"] == "poll", f"'polls' alias not normalized: {w['type']}"
    requests.delete(f"{BASE_URL}/api/communities/realm/{realm_id}/widgets/{w['id']}",
                    headers=_h(founder_token), timeout=20)


def test_add_widget_resolves_registry_uuid(founder_token, realm_id):
    avail = requests.get(f"{BASE_URL}/api/widgets/available?placement=realm",
                         headers=_h(founder_token), timeout=20).json()["widgets"]
    target = next((w for w in avail if w.get("key")), None)
    assert target, "no registry widgets available for realm"
    r = requests.post(f"{BASE_URL}/api/communities/realm/{realm_id}/widgets",
                      headers=_h(founder_token), json={"type": target["id"], "size": "medium"}, timeout=20)
    assert r.status_code == 200, r.text
    w = r.json()
    expected = "poll" if target["key"] == "polls" else target["key"]
    assert w["type"] == expected, f"UUID not resolved to key: {w['type']} (expected {expected})"
    requests.delete(f"{BASE_URL}/api/communities/realm/{realm_id}/widgets/{w['id']}",
                    headers=_h(founder_token), timeout=20)


def test_added_builtin_widget_gets_default_config(founder_token, realm_id):
    r = requests.post(f"{BASE_URL}/api/communities/realm/{realm_id}/widgets",
                      headers=_h(founder_token), json={"type": "countdown", "size": "small"}, timeout=20)
    assert r.status_code == 200, r.text
    w = r.json()
    assert "target" in (w.get("config") or {}), "countdown default config missing"
    requests.delete(f"{BASE_URL}/api/communities/realm/{realm_id}/widgets/{w['id']}",
                    headers=_h(founder_token), timeout=20)


# ─── Data-health migrations + relationships ──────────────────────────
def test_poll_migration_dry_run_founder_only(founder_token, user_token):
    r = requests.get(f"{BASE_URL}/api/admin/data-health/poll-migration/dry-run",
                     headers=_h(user_token), timeout=20)
    assert r.status_code == 403
    r = requests.get(f"{BASE_URL}/api/admin/data-health/poll-migration/dry-run",
                     headers=_h(founder_token), timeout=20)
    assert r.status_code == 200
    assert "rows" in r.json() and "count" in r.json()


def test_poll_migration_requires_confirm_phrase(founder_token):
    r = requests.post(f"{BASE_URL}/api/admin/data-health/poll-migration/execute",
                      headers=_h(founder_token), json={"confirm": "wrong"}, timeout=20)
    assert r.status_code == 400


def test_realm_widget_dry_run(founder_token):
    r = requests.get(f"{BASE_URL}/api/admin/data-health/realm-widgets/dry-run",
                     headers=_h(founder_token), timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert "rows" in body and "fixable" in body


def test_relationships_audit_shape(founder_token, user_token):
    r = requests.get(f"{BASE_URL}/api/admin/data-health/relationships",
                     headers=_h(user_token), timeout=30)
    assert r.status_code == 403
    r = requests.get(f"{BASE_URL}/api/admin/data-health/relationships",
                     headers=_h(founder_token), timeout=60)
    assert r.status_code == 200
    body = r.json()
    assert set(body["totals"].keys()) >= {"users_with_issues", "dangling_refs", "asymmetric", "count_drift"}
    for row in body["rows"][:5]:
        assert "recalculated_count" in row and "asymmetric" in row
        for a in row["asymmetric"]:
            assert a["proposal"] in ("restore_reciprocal", "remove_one_way")
            assert a["reason"]


def test_relationship_repair_requires_confirm(founder_token):
    r = requests.post(f"{BASE_URL}/api/admin/data-health/relationships/repair",
                      headers=_h(founder_token), json={"confirm": "nope"}, timeout=20)
    assert r.status_code == 400
