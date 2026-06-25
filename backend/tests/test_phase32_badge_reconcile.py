"""Phase 3.2 — Live badge reconciliation.

Tests the new POST /api/admin/badges/reconcile endpoint:
  • Re-applies the assignment rule for every live badge.
  • Picks up newly-eligible users without manual re-launch.
  • Idempotent — running twice doesn't create duplicates.
  • prune=true removes recipients that no longer qualify.
  • Founder/locked badges are never pruned.
  • Returns a per-badge summary suitable for the admin UI.
"""
import os
import uuid
import pytest
import requests
import subprocess


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass


def _login(u, p):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": u, "password": p}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def stealth_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def tfone_token():
    return _login("tfone", "pass1234")


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _cleanup(key):
    subprocess.run([
        "python3", "-c",
        f"""
import asyncio
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
import sys; sys.path.insert(0, "/app/backend")
from core.db import db
async def main():
    await db.badge_registry.delete_one({{"key": {key!r}}})
    await db.user_badges.delete_many({{"badge_key": {key!r}}})
asyncio.run(main())
""",
    ], capture_output=True, text=True, timeout=10)


# ─── Endpoint smoke ──────────────────────────────────────────────────

def test_reconcile_requires_admin(tfone_token):
    r = requests.post(f"{BASE_URL}/api/admin/badges/reconcile",
                      headers=_hdr(tfone_token), timeout=15)
    assert r.status_code == 403


def test_reconcile_basic_runs_across_live_badges(stealth_token):
    """The reconcile call returns a per-badge summary covering every
    live badge (FOUNDER + VIP + VERIFIED at minimum)."""
    r = requests.post(f"{BASE_URL}/api/admin/badges/reconcile",
                      headers=_hdr(stealth_token), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    assert body["badges_processed"] >= 3
    keys = {b["key"] for b in body["badges"]}
    assert "founder" in keys
    assert "vip" in keys
    assert "verified" in keys
    # Founder badge must have 0 new assignments — stealth already has it.
    founder = next(b for b in body["badges"] if b["key"] == "founder")
    assert founder["assigned"] == 0


# ─── Picks up newly eligible users ───────────────────────────────────

def test_reconcile_picks_up_new_eligible_user(stealth_token):
    """Create an `all_users` badge → reconcile after a fresh signup
    must assign the badge to the new user."""
    key = f"reconcile_test_{uuid.uuid4().hex[:6]}"
    try:
        # Create the badge live + all_users.
        r = requests.post(f"{BASE_URL}/api/admin/badges",
                          headers=_hdr(stealth_token),
                          json={
                              "key": key, "name": "RECON TEST",
                              "icon": "Award", "color": "#FF8AC2",
                              "status": "live",
                              "assignment_type": "all_users",
                          }, timeout=15)
        assert r.status_code == 200
        badge_id = r.json()["badge"]["id"]
        before = requests.get(f"{BASE_URL}/api/admin/badges/{badge_id}/recipients",
                              headers=_hdr(stealth_token), timeout=15).json()
        before_count = len(before.get("recipients", []))
        # Simulate a brand-new user signup AFTER the badge was launched.
        new_user = f"reconuser_{uuid.uuid4().hex[:6]}"
        rs = requests.post(f"{BASE_URL}/api/auth/register", json={
            "username": new_user,
            "email": f"{new_user}@example.com",
            "password": "Passw0rd!",
            "name": new_user,
            "accepted_terms": True,
            "accepted_privacy": True,
            "accepted_conditions": True,
            "age_confirmed_13": True,
        }, timeout=15)
        assert rs.status_code == 200, rs.text
        # Reconcile.
        rec = requests.post(f"{BASE_URL}/api/admin/badges/reconcile",
                            headers=_hdr(stealth_token), timeout=30)
        assert rec.status_code == 200
        match = next((b for b in rec.json()["badges"] if b["key"] == key), None)
        assert match is not None
        assert match["assigned"] >= 1, f"reconcile should assign the new user; got {match}"
        # Verify recipient count went up.
        after = requests.get(f"{BASE_URL}/api/admin/badges/{badge_id}/recipients",
                             headers=_hdr(stealth_token), timeout=15).json()
        after_count = len(after.get("recipients", []))
        assert after_count > before_count
        assert any(r.get("username") == new_user for r in after.get("recipients", []))
    finally:
        _cleanup(key)


# ─── Idempotency ─────────────────────────────────────────────────────

def test_reconcile_idempotent(stealth_token):
    """Running reconcile twice in a row → second call returns
    new_assignments=0 and no duplicate user_badges."""
    r1 = requests.post(f"{BASE_URL}/api/admin/badges/reconcile",
                       headers=_hdr(stealth_token), timeout=30).json()
    r2 = requests.post(f"{BASE_URL}/api/admin/badges/reconcile",
                       headers=_hdr(stealth_token), timeout=30).json()
    # On the second run nothing new should be assigned.
    assert r2["new_assignments"] == 0


# ─── Prune mode ──────────────────────────────────────────────────────

def test_reconcile_prune_removes_invalid_recipients(stealth_token):
    """Create a `specific`-type badge with only `stealth` → assign
    stealth + tfone manually → reconcile?prune=true must remove tfone
    because he's not in selected_usernames anymore."""
    key = f"prune_test_{uuid.uuid4().hex[:6]}"
    try:
        r = requests.post(f"{BASE_URL}/api/admin/badges",
                          headers=_hdr(stealth_token),
                          json={
                              "key": key, "name": "PRUNE TEST",
                              "icon": "Award", "color": "#10E670",
                              "status": "live",
                              "assignment_type": "specific",
                              "selected_usernames": ["stealth"],
                          }, timeout=15)
        assert r.status_code == 200
        badge_id = r.json()["badge"]["id"]
        # The /assign endpoint sidesteps assignment_type — we'll insert
        # tfone manually via Mongo to simulate a stale assignment.
        subprocess.run([
            "python3", "-c",
            f"""
import asyncio
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
import sys; sys.path.insert(0, "/app/backend")
from core.db import db
async def main():
    tfone = await db.users.find_one({{"username":"tfone"}},{{"id":1}})
    await db.user_badges.update_one(
        {{"user_id": tfone["id"], "badge_key": {key!r}}},
        {{"$setOnInsert": {{
            "id": f"{{tfone['id']}}::{key}",
            "user_id": tfone["id"],
            "username": "tfone",
            "badge_key": {key!r},
            "assigned_by": "test",
            "assigned_at": "2026-01-01T00:00:00Z",
            "source": "test_stale",
        }}}}, upsert=True,
    )
asyncio.run(main())
""",
        ], check=True, timeout=10)
        # Reconcile WITHOUT prune — tfone stays.
        rec = requests.post(f"{BASE_URL}/api/admin/badges/reconcile",
                            headers=_hdr(stealth_token), timeout=30)
        recipients = requests.get(f"{BASE_URL}/api/admin/badges/{badge_id}/recipients",
                                  headers=_hdr(stealth_token), timeout=15).json()
        usernames = {r.get("username") for r in recipients.get("recipients", [])}
        assert "tfone" in usernames, "non-prune mode shouldn't remove anyone"
        # Reconcile WITH prune — tfone must be removed.
        rec2 = requests.post(f"{BASE_URL}/api/admin/badges/reconcile?prune=true",
                             headers=_hdr(stealth_token), timeout=30)
        assert rec2.status_code == 200
        recipients2 = requests.get(f"{BASE_URL}/api/admin/badges/{badge_id}/recipients",
                                   headers=_hdr(stealth_token), timeout=15).json()
        usernames2 = {r.get("username") for r in recipients2.get("recipients", [])}
        assert "tfone" not in usernames2
        assert "stealth" in usernames2
    finally:
        _cleanup(key)


def test_reconcile_prune_skips_founder(stealth_token):
    """Even with prune=true, FOUNDER badge must keep its only recipient
    (@stealth)."""
    rec = requests.post(f"{BASE_URL}/api/admin/badges/reconcile?prune=true",
                        headers=_hdr(stealth_token), timeout=30)
    assert rec.status_code == 200
    founder = next(b for b in rec.json()["badges"] if b["key"] == "founder")
    assert founder.get("pruned", 0) == 0, "FOUNDER badge should never be pruned"
    # Confirm stealth still holds it.
    r = requests.get(f"{BASE_URL}/api/admin/badges",
                     headers=_hdr(stealth_token), timeout=15)
    fid = next(b["id"] for b in r.json()["badges"] if b["key"] == "founder")
    rec_r = requests.get(f"{BASE_URL}/api/admin/badges/{fid}/recipients",
                         headers=_hdr(stealth_token), timeout=15)
    usernames = {r.get("username") for r in rec_r.json().get("recipients", [])}
    assert usernames == {"stealth"}
