"""Iter 57 — VIP grants driven EXCLUSIVELY by badge_registry.

The legacy `VIP_CUTOFF` user-count branch has been removed from
/api/auth/register. The live `vip` badge in `badge_registry`
(auto_rule='first_1000', cap=first_x) is now the single source of
truth. This file verifies:

  1. Static check: no `VIP_CUTOFF` import and no `current_count = ...
     count_documents({})` line remain in /app/backend/routers/auth.py.
  2. Happy-path: fresh signup under cap → user.is_vip=true,
     vip_joined_at set, user_badges row with source='first_1000',
     assigned_by='system'. GET /api/auth/me confirms is_vip=true.
  3. Cap reached: PATCH vip badge first_x=1 (cap full @142>>1) →
     new signup gets is_vip=false AND no user_badges row.
  4. Draft badge: PATCH vip status=draft → new signup gets is_vip=
     false AND no user_badges row. Registration STILL 200 (no 500).
  5. Regression: founder `stealth` login still works; /api/auth/me
     returns is_vip from the user doc field; seeded VIP holder count
     remains stable across the run (only the happy-path user is
     temporarily added and then cleaned).

All test users created here are deleted (users + user_badges) on
teardown. The vip badge is restored to its original first_x and
status on teardown of the toggle tests.
"""
import os
import re
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME") or "test_database"

STEALTH = {"email": "stealth", "password": "Password1$"}

# Track every user we create so we can purge in teardown even if an
# assertion explodes mid-test.
_CREATED_USERNAMES: list[str] = []


# ────────────────────────────────────────────────────────────────────
# Fixtures
# ────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    # Final safety net cleanup
    if _CREATED_USERNAMES:
        unames = [u.lower() for u in _CREATED_USERNAMES]
        db.users.delete_many({"username": {"$in": unames}})
        db.user_badges.delete_many({"username": {"$in": unames}})
    client.close()


@pytest.fixture(scope="module")
def stealth_session():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json=STEALTH, timeout=15)
    assert r.status_code == 200, f"stealth login failed: {r.status_code} {r.text}"
    token = r.json().get("access_token")
    assert token, r.text
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def vip_badge(stealth_session):
    r = stealth_session.get(f"{BASE}/api/admin/badges", params={"q": "vip"}, timeout=15)
    assert r.status_code == 200, r.text
    arr = r.json().get("badges") or []
    vip = next((b for b in arr if b.get("key") == "vip"), None)
    if not vip:
        pytest.skip("VIP badge not seeded — cannot run iter57 tests")
    return vip


# ────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────
def _register(prefix="iter57") -> dict:
    uid = uuid.uuid4().hex[:8]
    username = f"{prefix}_{uid}"
    payload = {
        "email": f"{username}@example.com",
        "username": username,
        "name": f"Test {uid}",
        "password": "Password1$",
        "accepted_terms": True,
        "accepted_privacy": True,
        "accepted_conditions": True,
        "age_confirmed_13": True,
    }
    r = requests.post(f"{BASE}/api/auth/register", json=payload, timeout=20)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    body = r.json()
    body["_username"] = username
    body["_email"] = payload["email"]
    _CREATED_USERNAMES.append(username)
    return body


def _cleanup_user(mongo_db, username: str):
    """Delete user + their user_badges rows directly."""
    uname = username.lower()
    mongo_db.users.delete_many({"username": uname})
    mongo_db.user_badges.delete_many({"username": uname})


def _vip_holder_count(mongo_db) -> int:
    return mongo_db.user_badges.count_documents({"badge_key": "vip"})


# ────────────────────────────────────────────────────────────────────
# 1. Static check on /app/backend/routers/auth.py
# ────────────────────────────────────────────────────────────────────
def test_static_no_vip_cutoff_import_or_count_documents():
    path = "/app/backend/routers/auth.py"
    with open(path) as fh:
        src = fh.read()
    # VIP_CUTOFF must NOT appear in an import / usage line. A trailing
    # comment mentioning the legacy name for context is acceptable.
    import_matches = re.findall(r"^\s*from\s+\S+\s+import\s+.*VIP_CUTOFF", src, re.M)
    assert not import_matches, f"Legacy VIP_CUTOFF import still present: {import_matches}"
    # Non-comment usage check
    for ln in src.splitlines():
        stripped = ln.strip()
        if stripped.startswith("#"):
            continue
        assert "VIP_CUTOFF" not in stripped, f"Non-comment VIP_CUTOFF reference: {ln!r}"

    # No `current_count = await db.users.count_documents({})` style line
    assert not re.search(
        r"current_count\s*=\s*await\s+db\.users\.count_documents\s*\(\s*\{\s*\}\s*\)",
        src,
    ), "Legacy `current_count = await db.users.count_documents({})` still present"


# ────────────────────────────────────────────────────────────────────
# 2. Happy path: signup under cap → is_vip=true, badge row inserted
# ────────────────────────────────────────────────────────────────────
def test_register_under_cap_grants_vip(mongo, vip_badge):
    assert vip_badge.get("status") == "live", f"vip not live: {vip_badge}"
    assert vip_badge.get("auto_rule") == "first_1000", vip_badge
    cap = int(vip_badge.get("first_x") or 1000)
    holders_before = _vip_holder_count(mongo)
    assert holders_before < cap, f"cap full ({holders_before}/{cap}); cannot validate"

    body = _register("iter57vip")
    try:
        user = body.get("user") or {}
        assert user.get("is_vip") is True, f"is_vip not True on register response: {user}"
        assert user.get("vip_joined_at"), f"vip_joined_at missing: {user}"
        assert isinstance(user.get("vip_joined_at"), str)

        # access_token returned
        token = body.get("access_token")
        assert token, f"missing access_token: {body}"

        # user_badges row should exist with source='first_1000', assigned_by='system'
        row = mongo.user_badges.find_one({
            "username": body["_username"].lower(),
            "badge_key": "vip",
        })
        assert row, f"no user_badges row for {body['_username']}"
        assert row.get("source") == "first_1000", row
        assert row.get("assigned_by") == "system", row
        assert row.get("user_id") == user.get("id"), row

        # Doc completeness checks
        assert isinstance(user.get("widgets"), list) and len(user["widgets"]) >= 1
        # GET /api/auth/me with this token
        h = {"Authorization": f"Bearer {token}"}
        r = requests.get(f"{BASE}/api/auth/me", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        me = r.json().get("user") or r.json()
        assert me.get("is_vip") is True, f"/auth/me is_vip=False: {me}"

        # Mongo persistence checks (friends/compliance/widgets present)
        udoc = mongo.users.find_one({"id": user["id"]}, {"_id": 0})
        assert udoc, "user doc missing in mongo"
        assert isinstance(udoc.get("friends"), list)
        assert udoc.get("compliance", {}).get("accepted_at"), udoc.get("compliance")
        assert udoc.get("is_vip") is True
        assert udoc.get("vip_joined_at")
    finally:
        _cleanup_user(mongo, body["_username"])


# ────────────────────────────────────────────────────────────────────
# 3. Cap full → no VIP grant
# ────────────────────────────────────────────────────────────────────
def test_register_no_vip_when_cap_full(mongo, stealth_session, vip_badge):
    badge_id = vip_badge["id"]
    original_first_x = int(vip_badge.get("first_x") or 1000)

    # Snapshot current holder count — we'll restore implicitly because
    # we DELETE the test user before restoring first_x (so reconcile
    # on restore can't grab them).
    r = stealth_session.patch(
        f"{BASE}/api/admin/badges/{badge_id}", json={"first_x": 1}, timeout=15
    )
    assert r.status_code == 200, f"patch first_x=1 failed: {r.text}"

    body = None
    try:
        body = _register("iter57cap")
        user = body.get("user") or {}
        assert user.get("is_vip") is False, f"unexpected VIP grant over cap: {user}"
        # Underlying doc must have vip_joined_at=None even though the
        # serializer falls back to created_at on the wire (see code
        # review note in test_report).
        udoc = mongo.users.find_one({"id": user.get("id")}, {"_id": 0})
        assert udoc, "user doc missing in mongo"
        assert udoc.get("vip_joined_at") is None, \
            f"vip_joined_at set despite no VIP grant: {udoc.get('vip_joined_at')!r}"
        assert udoc.get("is_vip") is False, udoc

        # No user_badges row
        row = mongo.user_badges.find_one({
            "username": body["_username"].lower(),
            "badge_key": "vip",
        })
        assert row is None, f"unexpected user_badges row over cap: {row}"

        # Doc remains complete despite no VIP
        token = body.get("access_token")
        assert token, body
        h = {"Authorization": f"Bearer {token}"}
        r = requests.get(f"{BASE}/api/auth/me", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        me = r.json().get("user") or r.json()
        assert me.get("is_vip") is False, me
    finally:
        if body:
            _cleanup_user(mongo, body["_username"])
        # restore first_x to original
        r2 = stealth_session.patch(
            f"{BASE}/api/admin/badges/{badge_id}",
            json={"first_x": original_first_x},
            timeout=15,
        )
        assert r2.status_code == 200, f"restore first_x failed: {r2.text}"


# ────────────────────────────────────────────────────────────────────
# 4. Draft badge → no VIP grant, register still 200
# ────────────────────────────────────────────────────────────────────
def test_register_no_vip_when_badge_draft(mongo, stealth_session, vip_badge):
    badge_id = vip_badge["id"]

    r = stealth_session.patch(
        f"{BASE}/api/admin/badges/{badge_id}", json={"status": "draft"}, timeout=15
    )
    if r.status_code != 200:
        pytest.skip(f"Cannot flip VIP to draft: {r.status_code} {r.text}")

    body = None
    try:
        body = _register("iter57draft")
        user = body.get("user") or {}
        # Registration must still succeed
        assert body.get("access_token"), body
        assert user.get("is_vip") is False, f"VIP granted while badge=draft: {user}"
        # Mongo truth — doc.vip_joined_at must be None
        udoc = mongo.users.find_one({"id": user.get("id")}, {"_id": 0})
        assert udoc, "user doc missing in mongo"
        assert udoc.get("vip_joined_at") is None, \
            f"vip_joined_at set despite badge=draft: {udoc.get('vip_joined_at')!r}"
        assert udoc.get("is_vip") is False, udoc

        row = mongo.user_badges.find_one({
            "username": body["_username"].lower(),
            "badge_key": "vip",
        })
        assert row is None, f"unexpected user_badges row with badge draft: {row}"

        # Doc completeness regression
        assert isinstance(user.get("widgets"), list)
        assert isinstance(user.get("friends"), list)
    finally:
        if body:
            _cleanup_user(mongo, body["_username"])
        # ALWAYS restore status=live
        r2 = stealth_session.patch(
            f"{BASE}/api/admin/badges/{badge_id}", json={"status": "live"}, timeout=15
        )
        assert r2.status_code == 200, f"restore status=live failed: {r2.text}"


# ────────────────────────────────────────────────────────────────────
# 5. Regression: founder stealth login + /api/auth/me serializes is_vip
# ────────────────────────────────────────────────────────────────────
def test_stealth_login_and_me_still_works(stealth_session):
    r = stealth_session.get(f"{BASE}/api/auth/me", timeout=15)
    assert r.status_code == 200, r.text
    me = r.json().get("user") or r.json()
    assert me.get("username") == "stealth", me
    # is_vip serialized from the user doc — must be a bool (True/False)
    assert isinstance(me.get("is_vip"), bool), f"is_vip not a bool: {me.get('is_vip')!r}"


def test_admin_badges_listing_still_authenticates(stealth_session):
    r = stealth_session.get(f"{BASE}/api/admin/badges", params={"q": "vip"}, timeout=15)
    assert r.status_code == 200, r.text
    assert "badges" in r.json()


# ────────────────────────────────────────────────────────────────────
# 6. Regression: vip badge configuration is still the seeded shape
# ────────────────────────────────────────────────────────────────────
def test_vip_badge_seeded_shape_intact(mongo):
    vip = mongo.badge_registry.find_one({"key": "vip"}, {"_id": 0})
    assert vip, "vip badge missing from registry"
    assert vip.get("status") == "live", vip
    assert vip.get("auto_rule") == "first_1000", vip
    assert int(vip.get("first_x") or 0) == 1000, vip


# ────────────────────────────────────────────────────────────────────
# 7. Regression: VIP holder count remains stable post-tests
# ────────────────────────────────────────────────────────────────────
def test_vip_holder_count_stable(mongo):
    """After all the toggle tests + cleanups, no leaked TEST_ holders
    should remain. Count should not have grown unexpectedly."""
    # All cleanup already executed in per-test finally blocks. Verify
    # no rows for any username we tracked still exist.
    leaked = list(mongo.user_badges.find(
        {"username": {"$in": [u.lower() for u in _CREATED_USERNAMES]}},
        {"_id": 0, "username": 1, "badge_key": 1},
    ))
    assert leaked == [], f"leaked user_badges rows after cleanup: {leaked}"

    # And no leaked user docs.
    leaked_u = list(mongo.users.find(
        {"username": {"$in": [u.lower() for u in _CREATED_USERNAMES]}},
        {"_id": 0, "username": 1},
    ))
    assert leaked_u == [], f"leaked user docs after cleanup: {leaked_u}"
