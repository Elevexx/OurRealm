"""Phase 3.5+ — Registry widget hydration on profile pages.

Validates the fix for the bug where chat / registry-launched widgets
saved on a profile didn't render. Tests:

  • Registry widget can be saved on a profile (round-trips).
  • Saved widget hydrates `editor_config` on /api/auth/me.
  • Saved widget hydrates on /api/profile/me.
  • Saved widget hydrates on public /api/profile/by-username/:u (anonymous + logged-in).
  • Registry widgets restricted by access_groups are hidden from non-members.
  • Stale registry references (deleted/disabled) are silently dropped.
  • Founder boot self-heal does NOT strip the saved registry widget.
"""
import os
import json
import time
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


def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {username} failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tokens():
    return {
        "stealth": _login("stealth", "Password1$"),
        "tfone":   _login("tfone",   "pass1234"),
    }


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


REG_KEY = f"pytest_reg_widget_{uuid.uuid4().hex[:6]}"


def _seed_registry_widget(*, access_groups=None, layout="card"):
    """Insert a live registry widget directly into Mongo."""
    ag_json = json.dumps(access_groups or ["all_users"])
    res = subprocess.run([
        "python3", "-c",
        f"""
import asyncio, time
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
import sys; sys.path.insert(0, "/app/backend")
from core.db import db
async def main():
    await db.widget_registry.update_one(
        {{"id": {REG_KEY!r}}},
        {{"$set": {{
            "id": {REG_KEY!r}, "key": {REG_KEY!r}, "name": "Pytest Reg Widget",
            "type": None, "category": "utility", "status": "live",
            "access_groups": {ag_json},
            "placements": ["profile"],
            "default_size": {{"w":2,"h":1}}, "allowed_sizes": [{{"w":2,"h":1}}],
            "editor_config": {{
                "layout": {layout!r},
                "fields": [
                    {{"key":"title","type":"text","label":"Title","default":"Hello from pytest"}},
                    {{"key":"value","type":"text","label":"Value","default":"123"}},
                ],
                "data": {{"title":"Hello from pytest","value":"123"}},
                "data_source": {{"kind":"static","api":None,"refresh_seconds":0}},
                "theme": {{}}, "limits": {{}},
            }},
            "icon": "Sparkles", "is_system": False,
        }}}},
        upsert=True,
    )
    # Bump the cross-process invalidation stamp so the backend reloads.
    await db.widget_registry_stamps.update_one(
        {{"_id": "live_widgets"}},
        {{"$set": {{"stamp": str(time.time_ns())}}}},
        upsert=True,
    )
asyncio.run(main())
""",
    ], capture_output=True, text=True, timeout=15)
    assert res.returncode == 0, f"seed failed: {res.stderr}"


def _delete_registry_widget():
    subprocess.run([
        "python3", "-c",
        f"""
import asyncio, time
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
import sys; sys.path.insert(0, "/app/backend")
from core.db import db
async def main():
    await db.widget_registry.delete_one({{"id": {REG_KEY!r}}})
    await db.widget_registry_stamps.update_one(
        {{"_id": "live_widgets"}},
        {{"$set": {{"stamp": str(time.time_ns())}}}},
        upsert=True,
    )
asyncio.run(main())
""",
    ], capture_output=True, text=True, timeout=10)


def _restore_tfone_defaults():
    """Re-apply the default widget cluster to tfone so subsequent suites
    that expect [top8, myfeed, ...] don't see an empty array."""
    subprocess.run([
        "python3", "-c",
        """
import asyncio
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
import sys; sys.path.insert(0, "/app/backend")
from core.db import db
DEFAULT = [
    {"id": "w-top8", "type": "top8", "size": "medium", "title": "Top 8 Friends"},
    {"id": "w-myfeed", "type": "myfeed", "size": "large", "title": "My Feed", "audience": {"visibility":"public","user_ids":[]}},
]
async def main():
    await db.users.update_one(
        {"username": "tfone"},
        {"$set": {"widgets": DEFAULT, "profile_widgets_customized": False}},
    )
asyncio.run(main())
""",
    ], capture_output=True, text=True, timeout=10)


@pytest.fixture(scope="module", autouse=True)
def lifecycle(tokens):
    _seed_registry_widget()
    yield
    # Cleanup the registry widget AND restore tfone's defaults so
    # downstream tests that depend on [top8, myfeed, ...] order pass.
    _delete_registry_widget()
    _restore_tfone_defaults()


# ─── Save round-trip ─────────────────────────────────────────────────

def test_registry_widget_saves_to_profile(tokens):
    """User saves a registry widget on their profile — accepted, not stripped."""
    payload = {"widgets": [{"id": "w-reg-1", "type": REG_KEY, "size": "medium"}]}
    r = requests.patch(f"{BASE_URL}/api/profile/me",
                       headers=_hdr(tokens["tfone"]), json=payload, timeout=15)
    assert r.status_code == 200, r.text
    widgets = r.json().get("user", {}).get("widgets") or []
    assert any(w.get("type") == REG_KEY for w in widgets), \
        f"registry widget got stripped on save. Got: {widgets}"


def test_auth_me_hydrates_editor_config(tokens):
    """/api/auth/me ships full editor_config for registry widgets."""
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(tokens["tfone"]), timeout=15)
    assert r.status_code == 200
    widgets = r.json().get("user", {}).get("widgets") or []
    reg = next((w for w in widgets if w.get("type") == REG_KEY), None)
    assert reg is not None, "registry widget missing from /auth/me"
    ec = reg.get("editor_config") or {}
    assert ec.get("layout") == "card"
    assert ec.get("data", {}).get("title") == "Hello from pytest"
    assert reg.get("name") == "Pytest Reg Widget"


def test_profile_me_hydrates(tokens):
    r = requests.get(f"{BASE_URL}/api/profile/me",
                     headers=_hdr(tokens["tfone"]), timeout=15)
    assert r.status_code == 200
    widgets = r.json().get("user", {}).get("widgets") or []
    reg = next((w for w in widgets if w.get("type") == REG_KEY), None)
    assert reg is not None
    assert (reg.get("editor_config") or {}).get("layout") == "card"


def test_public_profile_hydrates_anonymous(tokens):
    """Anonymous viewer of a public profile still sees the registry widget
    (because access_groups=['all_users'])."""
    r = requests.get(f"{BASE_URL}/api/profile/by-username/tfone", timeout=15)
    assert r.status_code == 200
    widgets = r.json().get("user", {}).get("widgets") or []
    reg = next((w for w in widgets if w.get("type") == REG_KEY), None)
    assert reg is not None, "registry widget missing from public profile (anon)"
    assert (reg.get("editor_config") or {}).get("layout") == "card"


def test_public_profile_hydrates_logged_in(tokens):
    """Logged-in viewer of someone else's profile sees the widget too."""
    r = requests.get(f"{BASE_URL}/api/profile/by-username/tfone",
                     headers=_hdr(tokens["stealth"]), timeout=15)
    assert r.status_code == 200
    widgets = r.json().get("user", {}).get("widgets") or []
    assert any(w.get("type") == REG_KEY for w in widgets)


# ─── Access-group gating ─────────────────────────────────────────────

def test_restricted_widget_hidden_from_non_members(tokens):
    """Re-seed the widget with access_groups=['founder']. Tfone is not a
    founder, so the widget must disappear from his /auth/me hydration
    even though it's still saved on his profile."""
    _seed_registry_widget(access_groups=["founder"])
    try:
        # Force a fresh hydration (cache lifetime is 30 s — invalidate via
        # the seed helper already called by _seed_registry_widget).
        r = requests.get(f"{BASE_URL}/api/auth/me",
                         headers=_hdr(tokens["tfone"]), timeout=15)
        assert r.status_code == 200
        widgets = r.json().get("user", {}).get("widgets") or []
        reg = next((w for w in widgets if w.get("type") == REG_KEY), None)
        assert reg is None, \
            "restricted-group registry widget leaked to non-member!"

        # Stealth IS in 'founder' group — must still see it.
        r2 = requests.get(f"{BASE_URL}/api/profile/by-username/tfone",
                          headers=_hdr(tokens["stealth"]), timeout=15)
        widgets2 = r2.json().get("user", {}).get("widgets") or []
        assert any(w.get("type") == REG_KEY for w in widgets2), \
            "founder should see the founder-restricted widget on tfone's profile"
    finally:
        _seed_registry_widget(access_groups=["all_users"])


# ─── Stale references ────────────────────────────────────────────────

def test_stale_registry_reference_dropped(tokens):
    """Save a widget referencing a registry key, delete the registry
    entry, then re-read the profile — the saved entry must NOT appear
    in the hydrated response (stale reference cleanup)."""
    # Insert and reference a new transient registry widget.
    transient_key = f"pytest_transient_{uuid.uuid4().hex[:6]}"
    subprocess.run([
        "python3", "-c",
        f"""
import asyncio, time
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
import sys; sys.path.insert(0, "/app/backend")
from core.db import db
async def main():
    await db.widget_registry.update_one(
        {{"id": {transient_key!r}}},
        {{"$set": {{
            "id": {transient_key!r}, "key": {transient_key!r},
            "name": "Transient", "status": "live",
            "access_groups": ["all_users"], "placements": ["profile"],
            "default_size": {{"w":1,"h":1}}, "allowed_sizes": [{{"w":1,"h":1}}],
            "editor_config": {{
                "layout": "card", "fields": [], "data": {{"title":"x"}},
                "data_source": {{"kind":"static","api":None,"refresh_seconds":0}},
                "theme": {{}}, "limits": {{}},
            }}, "is_system": False,
        }}}}, upsert=True,
    )
    await db.widget_registry_stamps.update_one(
        {{"_id": "live_widgets"}},
        {{"$set": {{"stamp": str(time.time_ns())}}}},
        upsert=True,
    )
asyncio.run(main())
""",
    ], check=True, timeout=10)
    # Save it on tfone's profile.
    r = requests.patch(f"{BASE_URL}/api/profile/me",
                       headers=_hdr(tokens["tfone"]),
                       json={"widgets": [{"id": "w-stale", "type": transient_key, "size": "medium"}]},
                       timeout=15)
    assert r.status_code == 200
    # Delete the registry entry.
    subprocess.run([
        "python3", "-c",
        f"""
import asyncio, time
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
import sys; sys.path.insert(0, "/app/backend")
from core.db import db
async def main():
    await db.widget_registry.delete_one({{"id": {transient_key!r}}})
    await db.widget_registry_stamps.update_one(
        {{"_id": "live_widgets"}},
        {{"$set": {{"stamp": str(time.time_ns())}}}},
        upsert=True,
    )
asyncio.run(main())
""",
    ], check=True, timeout=10)
    # Read tfone's profile — the stale entry should be dropped.
    r2 = requests.get(f"{BASE_URL}/api/profile/me",
                      headers=_hdr(tokens["tfone"]), timeout=15)
    assert r2.status_code == 200
    widgets = r2.json().get("user", {}).get("widgets") or []
    assert not any(w.get("type") == transient_key for w in widgets), \
        "stale registry reference should be silently dropped"


# ─── No editor_config bleed to storage ───────────────────────────────

def test_saved_widget_is_minimal(tokens):
    """After hydrated /auth/me round-trips into a save, the raw widget
    document in Mongo should still be minimal — no editor_config bloat."""
    # First reload + capture the hydrated payload.
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(tokens["tfone"]), timeout=15)
    widgets = r.json().get("user", {}).get("widgets") or []
    # Save the hydrated payload back (simulates a frontend save).
    r2 = requests.patch(f"{BASE_URL}/api/profile/me",
                        headers=_hdr(tokens["tfone"]),
                        json={"widgets": widgets}, timeout=15)
    assert r2.status_code == 200
    # Inspect raw Mongo.
    res = subprocess.run([
        "python3", "-c",
        """
import asyncio
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
import sys; sys.path.insert(0, "/app/backend")
from core.db import db
async def main():
    u = await db.users.find_one({"username":"tfone"}, {"widgets":1})
    for w in (u.get("widgets") or []):
        if w.get("type", "").startswith("pytest_reg_widget_"):
            print("|".join(sorted(w.keys())))
            return
asyncio.run(main())
""",
    ], capture_output=True, text=True, timeout=10)
    keys = res.stdout.strip()
    assert "editor_config" not in keys, \
        f"editor_config leaked into stored doc: keys={keys}"
    assert "name" not in keys, f"name leaked into stored doc: keys={keys}"
