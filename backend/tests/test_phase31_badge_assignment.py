"""Phase 3.1 — Save+Launch auto-applies badge assignment rules.

Tests:
  • Creating a badge with status=live + assignment_type=all_users
    immediately assigns it to every active user.
  • Launching a draft badge with assignment_type=admin assigns it to
    admin-tier accounts.
  • Re-launching is idempotent (no duplicate user_badges).
  • Patching `assignment_type` on a live badge reconciles assignments.
  • Founder badge stays locked — Patch / Launch / Assign still 403.
  • Custom badges with only `color` round-trip the color back to the
    public endpoint so the frontend can paint them as filled pills.
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
    assert r.status_code == 200, f"login {u} failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def stealth_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def support_token():
    return _login("support", "Password1$")


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _make_badge_key():
    return f"pytest_b_{uuid.uuid4().hex[:6]}"


def _cleanup(key):
    """Delete the badge + its user_badges directly via Mongo."""
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


# ─── Issue 1: Save+Launch group assignment ───────────────────────────

def test_create_live_all_users_auto_assigns(stealth_token):
    """Creating a badge already-live + assignment_type=all assigns
    immediately to every active user."""
    key = _make_badge_key()
    try:
        r = requests.post(f"{BASE_URL}/api/admin/badges",
                          headers=_hdr(stealth_token),
                          json={
                              "key": key, "name": "ALL TEST",
                              "icon": "Award", "color": "#FF8AC2",
                              "status": "live",
                              "assignment_type": "all_users",
                          }, timeout=15)
        assert r.status_code == 200, r.text
        badge_id = r.json()["badge"]["id"]
        # Check recipients now include every active user.
        rr = requests.get(f"{BASE_URL}/api/admin/badges/{badge_id}/recipients",
                          headers=_hdr(stealth_token), timeout=15)
        assert rr.status_code == 200
        recipients = rr.json().get("recipients", [])
        assert len(recipients) > 10, f"all_users should assign to many; got {len(recipients)}"
        # Stealth + support + tfone must each have it.
        usernames = {r.get("username") for r in recipients}
        assert "stealth" in usernames
        assert "support" in usernames
        assert "tfone" in usernames
    finally:
        _cleanup(key)


def test_launch_draft_admin_assignment(stealth_token):
    """A draft badge with assignment_type=admin auto-assigns on /launch."""
    key = _make_badge_key()
    try:
        # Create as draft.
        r = requests.post(f"{BASE_URL}/api/admin/badges",
                          headers=_hdr(stealth_token),
                          json={
                              "key": key, "name": "ADMIN TEST",
                              "icon": "Award", "color": "#2EA0FF",
                              "status": "draft",
                              "assignment_type": "admin",
                          }, timeout=15)
        assert r.status_code == 200
        badge_id = r.json()["badge"]["id"]
        # No recipients yet — draft.
        rr = requests.get(f"{BASE_URL}/api/admin/badges/{badge_id}/recipients",
                          headers=_hdr(stealth_token), timeout=15)
        assert (rr.json().get("recipients") or []) == []
        # Launch.
        lr = requests.post(f"{BASE_URL}/api/admin/badges/{badge_id}/launch",
                           headers=_hdr(stealth_token), timeout=15)
        assert lr.status_code == 200, lr.text
        assert lr.json().get("newly_assigned", 0) >= 2  # stealth + support
        # Verify recipients.
        rr2 = requests.get(f"{BASE_URL}/api/admin/badges/{badge_id}/recipients",
                           headers=_hdr(stealth_token), timeout=15)
        usernames = {r.get("username") for r in rr2.json().get("recipients", [])}
        assert "stealth" in usernames
        assert "support" in usernames
        assert "tfone" not in usernames  # not an admin
    finally:
        _cleanup(key)


def test_relaunch_idempotent_no_duplicates(stealth_token):
    """Launching the same badge twice does NOT create duplicate user_badges."""
    key = _make_badge_key()
    try:
        r = requests.post(f"{BASE_URL}/api/admin/badges",
                          headers=_hdr(stealth_token),
                          json={
                              "key": key, "name": "DUP TEST",
                              "icon": "Award", "color": "#10E670",
                              "status": "live",
                              "assignment_type": "all_users",
                          }, timeout=15)
        badge_id = r.json()["badge"]["id"]
        # Count after first launch.
        r1 = requests.get(f"{BASE_URL}/api/admin/badges/{badge_id}/recipients",
                          headers=_hdr(stealth_token), timeout=15)
        n1 = len(r1.json().get("recipients", []))
        # Re-launch.
        lr = requests.post(f"{BASE_URL}/api/admin/badges/{badge_id}/launch",
                           headers=_hdr(stealth_token), timeout=15)
        assert lr.status_code == 200
        # newly_assigned should be 0 — everyone already has it.
        assert lr.json().get("newly_assigned") == 0
        # Recipient count unchanged.
        r2 = requests.get(f"{BASE_URL}/api/admin/badges/{badge_id}/recipients",
                          headers=_hdr(stealth_token), timeout=15)
        n2 = len(r2.json().get("recipients", []))
        assert n1 == n2, f"recipient count changed across relaunch: {n1} -> {n2}"
    finally:
        _cleanup(key)


def test_patch_assignment_type_reconciles(stealth_token):
    """Changing assignment_type via PATCH while live reconciles."""
    key = _make_badge_key()
    try:
        # Create live with assignment=admin.
        r = requests.post(f"{BASE_URL}/api/admin/badges",
                          headers=_hdr(stealth_token),
                          json={
                              "key": key, "name": "PATCH TEST",
                              "icon": "Award", "color": "#FFAA00",
                              "status": "live",
                              "assignment_type": "admin",
                          }, timeout=15)
        badge_id = r.json()["badge"]["id"]
        r1 = requests.get(f"{BASE_URL}/api/admin/badges/{badge_id}/recipients",
                          headers=_hdr(stealth_token), timeout=15)
        n1 = len(r1.json().get("recipients", []))
        assert n1 >= 2  # stealth + support
        # PATCH to all_users.
        pr = requests.patch(f"{BASE_URL}/api/admin/badges/{badge_id}",
                            headers=_hdr(stealth_token),
                            json={"assignment_type": "all_users"}, timeout=15)
        assert pr.status_code == 200, pr.text
        # Recipients should expand.
        r2 = requests.get(f"{BASE_URL}/api/admin/badges/{badge_id}/recipients",
                          headers=_hdr(stealth_token), timeout=15)
        n2 = len(r2.json().get("recipients", []))
        assert n2 > n1, f"PATCH to all_users should expand: {n1} -> {n2}"
    finally:
        _cleanup(key)


# ─── Issue 2: Custom badge color round-trip ──────────────────────────

def test_custom_badge_color_roundtrip(stealth_token):
    """Custom badge with only `color` set is returned to the public
    endpoint so the frontend can paint a filled pill."""
    key = _make_badge_key()
    try:
        custom_color = "#FF66CC"
        r = requests.post(f"{BASE_URL}/api/admin/badges",
                          headers=_hdr(stealth_token),
                          json={
                              "key": key, "name": "CUSTOM PILL",
                              "icon": "Sparkles", "color": custom_color,
                              "status": "live",
                              "assignment_type": "manual",
                              "selected_usernames": ["stealth"],
                          }, timeout=15)
        assert r.status_code == 200
        badge_id = r.json()["badge"]["id"]
        # Manually assign to stealth (manual type doesn't auto-assign).
        ar = requests.post(f"{BASE_URL}/api/admin/badges/{badge_id}/assign",
                           headers=_hdr(stealth_token),
                           json={"usernames": ["stealth"]}, timeout=15)
        assert ar.status_code == 200
        # Public endpoint must return the badge with its color.
        pr = requests.get(f"{BASE_URL}/api/profile/stealth/badges", timeout=15)
        assert pr.status_code == 200
        badges = pr.json().get("badges", [])
        match = next((b for b in badges if b.get("key") == key), None)
        assert match is not None, f"custom badge missing from public response: {badges}"
        assert match.get("color") == custom_color
        # Icon present so the frontend renders it.
        assert match.get("icon") == "Sparkles"
    finally:
        _cleanup(key)


# ─── Founder badge lock (defense in depth) ───────────────────────────

def test_founder_badge_still_locked(stealth_token):
    """Even with the new assignment auto-apply path, FOUNDER stays
    locked — Launch returns 200 but the rule auto-applies ONLY to
    @stealth (founder rule), never to anyone else."""
    r = requests.get(f"{BASE_URL}/api/admin/badges",
                     headers=_hdr(stealth_token), timeout=15)
    badges = r.json().get("badges", [])
    founder = next((b for b in badges if b["key"] == "founder"), None)
    assert founder is not None
    bid = founder["id"]
    # PATCH must 403.
    pr = requests.patch(f"{BASE_URL}/api/admin/badges/{bid}",
                        headers=_hdr(stealth_token),
                        json={"description": "x"}, timeout=15)
    assert pr.status_code == 403
    # DELETE must 403.
    dr = requests.delete(f"{BASE_URL}/api/admin/badges/{bid}",
                         headers=_hdr(stealth_token), timeout=15)
    assert dr.status_code == 403
    # /assign must 403.
    ar = requests.post(f"{BASE_URL}/api/admin/badges/{bid}/assign",
                       headers=_hdr(stealth_token),
                       json={"usernames": ["tfone"]}, timeout=15)
    assert ar.status_code == 403
    # Launch still works (badge is already live; re-launch is a no-op
    # because auto_rule=founder restricts to stealth only).
    lr = requests.post(f"{BASE_URL}/api/admin/badges/{bid}/launch",
                       headers=_hdr(stealth_token), timeout=15)
    assert lr.status_code == 200
    # Confirm only stealth has it.
    rr = requests.get(f"{BASE_URL}/api/admin/badges/{bid}/recipients",
                      headers=_hdr(stealth_token), timeout=15)
    usernames = {r.get("username") for r in rr.json().get("recipients", [])}
    assert usernames == {"stealth"}, f"founder badge leaked: {usernames}"
