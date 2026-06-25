"""Iteration-55 verification tests.

Covers:
  1. POST /api/auth/register — first_1000 VIP auto-grant wires through.
  2. /api/admin/badges/<vip_id>/recipients — new username appears with source='first_1000'.
  3. New user record gets is_vip=True.
  4. When current_holders >= cap (first_x=1), the next signup does NOT get VIP.
  5. Registration must not 500 even if the VIP badge is deleted/draft.
  6. GET /api/sounds/by-user/stealth?category=podcast|Podcast|PODCASTS — all 200.
"""
import os
import uuid
import requests
import pytest

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
STEALTH_USER = {"email": "stealth", "password": "Password1$"}


def _stealth_session():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json=STEALTH_USER, timeout=15)
    assert r.status_code == 200, r.text
    return s, r.json()["access_token"]


def _register_new(prefix="TEST_VIP_") -> dict:
    """Create a brand-new user; return the JSON body."""
    uid = uuid.uuid4().hex[:8]
    payload = {
        "email": f"{prefix}{uid}@example.com",
        "username": f"{prefix.lower()}{uid}",
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
    body["_username"] = payload["username"]
    return body


def _find_vip_badge(session: requests.Session) -> dict:
    r = session.get(f"{BASE}/api/admin/badges", timeout=15)
    assert r.status_code == 200, r.text
    arr = r.json().get("badges") or r.json()
    if isinstance(arr, dict):
        arr = arr.get("badges") or []
    for b in arr:
        if b.get("key") == "vip":
            return b
    pytest.skip("VIP badge not present — cannot validate")


# ──────────────────────────────────────────────────────────────────────
def test_register_grants_vip_under_cap():
    s, _ = _stealth_session()
    vip = _find_vip_badge(s)
    assert vip.get("status") == "live", f"VIP not live: {vip.get('status')}"
    assert vip.get("auto_rule") == "first_1000", vip
    cap = int(vip.get("first_x") or 1000)
    holders_before = vip.get("current_holders")
    if holders_before is None:
        # fall back to recipients listing
        r = s.get(f"{BASE}/api/admin/badges/{vip['id']}/recipients", timeout=15)
        holders_before = len(r.json().get("recipients") or r.json() or [])
    assert holders_before < cap, f"VIP already at cap ({holders_before}/{cap})"

    body = _register_new("TEST_VIP_")
    username = body["_username"]
    assert body.get("user", {}).get("is_vip") is True, body

    # confirm appears in recipients with source='first_1000'
    r = s.get(f"{BASE}/api/admin/badges/{vip['id']}/recipients", timeout=15)
    assert r.status_code == 200, r.text
    recs = r.json().get("recipients") or r.json() or []
    hit = next((x for x in recs if (x.get("username") or "").lower() == username.lower()), None)
    assert hit, f"new user {username} not in VIP recipients"
    assert hit.get("source") == "first_1000", f"wrong source: {hit}"


def test_register_skips_vip_when_at_cap():
    """Temporarily lower first_x to current_holders (effectively cap=already-full),
    register, then restore. New user must NOT have is_vip=True via auto-grant.
    """
    s, _ = _stealth_session()
    vip = _find_vip_badge(s)
    badge_id = vip["id"]
    original_first_x = int(vip.get("first_x") or 1000)

    # Set first_x = 1 so cap is essentially full (current_holders >> 1)
    r = s.patch(f"{BASE}/api/admin/badges/{badge_id}", json={"first_x": 1}, timeout=15)
    assert r.status_code == 200, r.text
    try:
        body = _register_new("TEST_VIPCAP_")
        username = body["_username"]
        # The badge auto-grant must NOT include the new user in recipients
        # (NOTE: legacy is_vip flag on user doc may still be True because it's
        # set by VIP_CUTOFF user-count, independent of badge cap — not in scope here)
        r = s.get(f"{BASE}/api/admin/badges/{badge_id}/recipients", timeout=15)
        recs = r.json().get("recipients") or r.json() or []
        hit = next((x for x in recs if (x.get("username") or "").lower() == username.lower()), None)
        assert hit is None, f"unexpected VIP badge auto-grant under cap: {hit}"
    finally:
        # restore
        s.patch(f"{BASE}/api/admin/badges/{badge_id}", json={"first_x": original_first_x}, timeout=15)


def test_register_safe_when_vip_badge_draft():
    """If VIP badge is in 'draft' status, registration must still succeed (no 500)."""
    s, _ = _stealth_session()
    vip = _find_vip_badge(s)
    badge_id = vip["id"]
    # Toggle to draft via patch (status field)
    r = s.patch(f"{BASE}/api/admin/badges/{badge_id}", json={"status": "draft"}, timeout=15)
    if r.status_code != 200:
        # Some impls require a different endpoint — skip if patch refuses
        pytest.skip(f"Cannot flip VIP status to draft: {r.status_code} {r.text}")
    try:
        body = _register_new("TEST_VIPDRAFT_")
        assert body.get("user", {}).get("username"), body
        # is_vip should be False since the live VIP badge wasn't found
        # (count-based pre-grant may still set is_vip via VIP_CUTOFF — both acceptable)
    finally:
        s.patch(f"{BASE}/api/admin/badges/{badge_id}", json={"status": "live"}, timeout=15)


# ──────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("cat", ["podcast", "Podcast", "PODCASTS", "Podcasts", "podcasts"])
def test_podcasts_category_case_insensitive(cat):
    r = requests.get(f"{BASE}/api/sounds/by-user/stealth", params={"category": cat}, timeout=15)
    assert r.status_code == 200, f"{cat}: {r.status_code} {r.text}"
    body = r.json()
    assert "tracks" in body and isinstance(body["tracks"], list)


def test_music_by_user_stealth_has_tracks():
    r = requests.get(f"{BASE}/api/sounds/by-user/stealth", params={"category": "Music"}, timeout=15)
    assert r.status_code == 200, r.text
    tracks = r.json().get("tracks") or []
    # Per context note: stealth has 3 Music tracks.
    assert len(tracks) >= 1, f"expected >=1 Music tracks for stealth, got {len(tracks)}"
    sample = tracks[0]
    assert "id" in sample and "file_url" in sample
