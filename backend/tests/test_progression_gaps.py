"""Phase B (Iter 76) — Progression gap tests.
Focus on scenarios NOT already covered by test_progression_core.py:
 - public summary visibility default (as another user)
 - claim rejected 400 when tasks incomplete (claims flag ON)
 - claim rejected 503 when claims flag OFF (and flag restored)

Uses http://localhost:8001 to avoid Cloudflare edge cookie variance.
"""
import time
import pytest
import httpx

BASE = "http://localhost:8001"


class RetryClient(httpx.Client):
    def request(self, *a, **kw):
        for i in range(5):
            r = super().request(*a, **kw)
            if r.status_code != 429:
                return r
            time.sleep(0.75 + i * 0.5)
        return r


@pytest.fixture(scope="module")
def client():
    with RetryClient(base_url=BASE, timeout=30) as c:
        yield c


def _login(client, email, password):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def founder_h(client):
    return _login(client, "stealth", "Password1$")


@pytest.fixture(scope="module")
def member_h(client):
    return _login(client, "auditcheckreal", "Password1$")


def test_public_summary_visible_by_default(client, founder_h, member_h):
    """As stealth, GET summary/auditcheckreal — should be visible=True by default
    (current_level defaults to public). No detailed tasks field for non-owner."""
    # Reset member's visibility to defaults (in case a previous run muted it)
    r0 = client.patch("/api/progression/visibility", headers=member_h,
                      json={"settings": {"current_level": "public",
                                         "progress_card": "public"}})
    assert r0.status_code == 200, r0.text

    r = client.get("/api/progression/summary/auditcheckreal", headers=founder_h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("enabled") is True
    assert d.get("visible") is True, d
    assert "level" in d and d["level"].get("name")
    # non-owners must NOT receive detailed task list
    assert "tasks" not in d


def test_claim_incomplete_tasks_returns_400(client, founder_h, member_h):
    """Ensure claims flag is ON, then attempt claim as auditcheckreal (member
    who has incomplete tasks). Backend must reject with 400."""
    # Ensure claims flag ON
    fl = client.patch("/api/admin/progression/flags", headers=founder_h,
                      json={"key": "claims", "value": True})
    assert fl.status_code == 200
    assert fl.json()["flags"].get("claims") is True

    me = client.get("/api/progression/me", headers=member_h).json()
    assert me.get("enabled") is True
    level_id = me["level"]["id"]
    summary = me.get("summary") or {}
    # Precondition: member should have incomplete tasks
    assert (summary.get("completed_task_count") or 0) < (summary.get("required_task_count") or 0), \
        f"auditcheckreal already completed all tasks: {summary}"

    r = client.post("/api/progression/claim", headers=member_h,
                    json={"level_id": level_id})
    assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"


def test_claim_returns_503_when_claims_flag_off(client, founder_h, member_h):
    """Turn claims flag OFF, POST /claim returns 503, then re-enable."""
    off = client.patch("/api/admin/progression/flags", headers=founder_h,
                       json={"key": "claims", "value": False})
    assert off.status_code == 200 and off.json()["flags"].get("claims") is False

    try:
        me = client.get("/api/progression/me", headers=member_h).json()
        level_id = me["level"]["id"]
        r = client.post("/api/progression/claim", headers=member_h,
                        json={"level_id": level_id})
        assert r.status_code == 503, f"Expected 503 when claims flag off, got {r.status_code}: {r.text}"
        detail = (r.json() or {}).get("detail", "")
        assert "unavailable" in detail.lower() or "temporarily" in detail.lower()
    finally:
        # ALWAYS restore claims flag ON
        on = client.patch("/api/admin/progression/flags", headers=founder_h,
                          json={"key": "claims", "value": True})
        assert on.status_code == 200 and on.json()["flags"].get("claims") is True


def test_flags_endpoint_lists_eight_keys(client, founder_h):
    r = client.get("/api/admin/progression/flags", headers=founder_h)
    assert r.status_code == 200
    d = r.json()
    keys = d.get("keys") or []
    assert len(keys) == 8, f"Expected 8 flag keys, got {len(keys)}: {keys}"
    # verify flag map has entries for all keys
    flags = d.get("flags") or {}
    for k in keys:
        assert k in flags, f"flag {k} missing from state map"


def test_recalc_endpoint_bypasses_ttl(client, founder_h):
    """POST /api/progression/recalc should always recompute + return summary."""
    r = client.post("/api/progression/recalc", headers=founder_h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("ok") is True
    assert "summary" in d


def test_non_founder_admin_403(client, member_h):
    r = client.get("/api/admin/progression/levels", headers=member_h)
    assert r.status_code == 403
    r2 = client.get("/api/admin/progression/audit-logs", headers=member_h)
    assert r2.status_code == 403
    r3 = client.get("/api/admin/progression/analytics", headers=member_h)
    assert r3.status_code == 403
