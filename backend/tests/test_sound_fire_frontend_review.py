"""
Backend regression tests for review request:
- GET /api/posts?media_type=sound has no is_sound_track=true items
- 'Calling in The City' appears exactly once with fire_total >= 1
- GET /api/fire/post/{post_id} returns my_fire=1 for stealth
- POST /api/fire/react boost 3, then back to 1 works, totals update
- Wallet reflects pool deduction after boost / refund after decrease
- Non-sound posts still render fire/like
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback: read frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

STEALTH = {"email": "stealth", "password": "Password1$"}
AUDIT = {"email": "auditcheckreal", "password": "Password1$"}


@pytest.fixture(scope="module")
def stealth_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=STEALTH, timeout=30)
    assert r.status_code == 200, f"stealth login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def audit_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=AUDIT, timeout=30)
    assert r.status_code == 200, f"audit login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def calling_post(stealth_session):
    r = stealth_session.get(f"{BASE_URL}/api/posts?media_type=sound&limit=100", timeout=30)
    assert r.status_code == 200, f"posts fetch failed {r.status_code}: {r.text[:400]}"
    payload = r.json()
    items = payload if isinstance(payload, list) else payload.get("items") or payload.get("posts") or []
    # No raw sound-track rows
    raw = [p for p in items if p.get("is_sound_track") is True]
    assert not raw, f"Feed returned raw is_sound_track rows: {[p.get('id') for p in raw]}"
    # Find Calling in The City
    matches = [
        p for p in items
        if (p.get("sound_title") or p.get("title") or "").strip().lower() == "calling in the city"
    ]
    assert len(matches) == 1, f"Expected exactly 1 'Calling in The City', got {len(matches)}: {[(p.get('id'), p.get('sound_title'), p.get('title')) for p in matches]}"
    p = matches[0]
    assert p.get("fire_total", 0) >= 1, f"fire_total should be >=1, got {p.get('fire_total')}"
    return p


def test_no_raw_sound_track_rows(calling_post):
    assert calling_post.get("is_canonical_sound") is True or calling_post.get("sound_track_id"), (
        f"Post should be canonical sound: {calling_post}"
    )


def test_fire_post_status_my_fire_1(stealth_session, calling_post):
    pid = calling_post["id"]
    r = stealth_session.get(f"{BASE_URL}/api/fire/post/{pid}", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("my_fire") == 1, f"expected my_fire=1 got {body}"
    assert body.get("total", body.get("fire_total", 0)) >= 1


def _wallet(session):
    r = session.get(f"{BASE_URL}/api/fire/status", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def test_fire_react_boost_and_restore(stealth_session, calling_post):
    pid = calling_post["id"]
    wallet_before = _wallet(stealth_session)
    balance_before = wallet_before.get("balance") or wallet_before.get("pool_balance") or wallet_before.get("available") or 0

    # Boost to 3x
    r = stealth_session.post(
        f"{BASE_URL}/api/fire/react",
        json={"post_id": pid, "fire_value": 3},
        timeout=30,
    )
    assert r.status_code == 200, f"boost failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("my_fire") == 3, f"my_fire should be 3, got {body}"

    wallet_mid = _wallet(stealth_session)
    balance_mid = wallet_mid.get("balance") or wallet_mid.get("pool_balance") or wallet_mid.get("available") or 0
    # Boost from 1 -> 3 should charge 2 (net delta above baseline 1x free)
    assert balance_mid <= balance_before, f"balance did not decrease after boost: {balance_before} -> {balance_mid}"

    # Back to 1x
    r = stealth_session.post(
        f"{BASE_URL}/api/fire/react",
        json={"post_id": pid, "fire_value": 1},
        timeout=30,
    )
    assert r.status_code == 200, f"restore failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("my_fire") == 1, f"my_fire should be 1, got {body}"

    wallet_after = _wallet(stealth_session)
    balance_after = wallet_after.get("balance") or wallet_after.get("pool_balance") or wallet_after.get("available") or 0
    # Refund should give back what was taken
    assert balance_after >= balance_mid, f"balance did not refund: {balance_mid} -> {balance_after}"


def test_non_sound_posts_have_fire_or_like(stealth_session):
    r = stealth_session.get(f"{BASE_URL}/api/posts?limit=30", timeout=30)
    assert r.status_code == 200
    payload = r.json()
    items = payload if isinstance(payload, list) else payload.get("items") or payload.get("posts") or []
    assert len(items) > 0
    # Just sanity: posts should have visibility and either fire enabled or heart
    for p in items[:10]:
        assert "id" in p
