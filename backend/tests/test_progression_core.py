"""Phase A tests — Progression system core safety invariants.
Run: cd /app/backend && python -m pytest tests/test_progression_core.py -q
"""
import asyncio
import os
import uuid

import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
# Internal URL — the external preview URL passes through a Cloudflare edge
# whose session cookies can serve stale variants to a shared test client.
BASE = "http://localhost:8001"

FOUNDER = {"email": "stealth", "password": "Password1$"}


class RetryClient(httpx.Client):
    """Preview ingress throttles bursts with 429s — retry transparently."""
    def request(self, *a, **kw):
        import time
        for i in range(8):
            r = super().request(*a, **kw)
            if r.status_code != 429:
                return r
            time.sleep(1.0 + i)
        return r


@pytest.fixture(scope="module")
def client():
    with RetryClient(base_url=BASE, timeout=30) as c:
        yield c


@pytest.fixture(scope="module")
def founder_h(client):
    r = client.post("/api/auth/login", json=FOUNDER)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def member_h(client):
    r = client.post("/api/auth/login", json={"email": "auditcheckreal", "password": "Password1$"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_seed_levels_published(client, founder_h):
    levels = client.get("/api/admin/progression/levels", headers=founder_h).json()["levels"]
    names = [l["name"] for l in levels if l["status"] == "published"]
    assert "Newbie" in names and "Explorer" in names
    newbie = next(l for l in levels if l["name"] == "Newbie")
    assert newbie["is_starting_level"] and newbie["config_version"] >= 1
    assert newbie["task_count"] == 3


def test_admin_requires_founder(client, member_h):
    assert client.get("/api/admin/progression/levels", headers=member_h).status_code == 403
    assert client.patch("/api/admin/progression/flags", headers=member_h,
                        json={"key": "claims", "value": True}).status_code == 403
    assert client.get("/api/admin/progression/levels").status_code in (401, 403)


def test_me_progression_backend_calculated(client, founder_h):
    d = client.get("/api/progression/me", headers=founder_h).json()
    assert d["enabled"] is True
    assert d["level"]["name"]  # a published level is always assigned
    assert isinstance(d["summary"]["completed_task_count"], int)
    assert all("current_value" in t for t in d["tasks"])


def test_frontend_cannot_set_progress(client, member_h):
    # No route accepts client progress values; claim requires backend validation.
    d = client.get("/api/progression/me", headers=member_h).json()
    lvl = d["level"]["id"]
    r = client.post("/api/progression/claim", headers=member_h, json={"level_id": lvl})
    # auditcheckreal has incomplete tasks — claim must be rejected by backend
    if r.status_code == 400:
        assert "required tasks" in r.json()["detail"].lower() or "complete" in r.json()["detail"].lower()
    else:
        # claims flag may be off in some environments
        assert r.status_code == 503


def test_claim_idempotent_and_unique(client, founder_h):
    # stealth already claimed Newbie — a repeat claim must return the stored
    # response idempotently, never duplicate history/rewards.
    hist1 = client.get("/api/progression/history/me", headers=founder_h).json()
    newbie_completions = [h for h in hist1["history"] if h["level_name"] == "Newbie"]
    assert len(newbie_completions) == 1
    levels = client.get("/api/admin/progression/levels", headers=founder_h).json()["levels"]
    newbie = next(l for l in levels if l["name"] == "Newbie")
    r = client.post("/api/progression/claim", headers=founder_h, json={"level_id": newbie["id"]})
    assert r.status_code == 200 and r.json()["idempotent"] is True
    hist2 = client.get("/api/progression/history/me", headers=founder_h).json()
    assert len([h for h in hist2["history"] if h["level_name"] == "Newbie"]) == 1


def test_concurrent_duplicate_claims_single_record(client, founder_h):
    """Fire 5 parallel duplicate claims — exactly one history record must exist."""
    levels = client.get("/api/admin/progression/levels", headers=founder_h).json()["levels"]
    newbie = next(l for l in levels if l["name"] == "Newbie")

    async def burst():
        async with httpx.AsyncClient(base_url=BASE, timeout=30) as ac:
            rs = await asyncio.gather(*[
                ac.post("/api/progression/claim", headers=founder_h,
                        json={"level_id": newbie["id"]}) for _ in range(5)])
            return rs
    rs = asyncio.run(burst())
    assert all(r.status_code in (200, 429) for r in rs)
    assert any(r.status_code == 200 for r in rs)
    hist = client.get("/api/progression/history/me", headers=founder_h).json()
    assert len([h for h in hist["history"] if h["level_name"] == "Newbie"]) == 1


def test_rewards_never_duplicated(client, founder_h):
    d = client.get("/api/progression/rewards/me", headers=founder_h).json()
    keys = [r["reward_snapshot"].get("badge_key") or r["reward_snapshot"].get("name")
            for r in d["rewards"]]
    assert len(keys) == len(set(keys)), "duplicate reward grants detected"
    # reputation transactions unique per idempotency key
    reps = [t for t in d["reputation"]["transactions"] if "Starter" in (t.get("reason") or "")]
    assert len(reps) <= 1


def test_unknown_task_type_fails_safe(client, founder_h):
    r = client.post("/api/admin/progression/levels", headers=founder_h,
                    json={"name": f"T-{uuid.uuid4().hex[:6]}"})
    lvl = r.json()["level"]["id"]
    r = client.post(f"/api/admin/progression/levels/{lvl}/tasks", headers=founder_h,
                    json={"name": "bad", "task_type_key": "not_a_real_type"})
    assert r.status_code == 400
    # cleanup
    assert client.delete(f"/api/admin/progression/levels/{lvl}", headers=founder_h).status_code == 200


def test_custom_rules_reject_arbitrary_code(client, founder_h):
    r = client.post("/api/admin/progression/levels", headers=founder_h,
                    json={"name": f"T-{uuid.uuid4().hex[:6]}"})
    lvl = r.json()["level"]["id"]
    for bad_cfg in ({"$where": "1==1"}, {"query": {"x": 1}}, {"url": "http://evil"}, {"code": "os.system"}):
        r = client.post(f"/api/admin/progression/levels/{lvl}/tasks", headers=founder_h,
                        json={"name": "x", "task_type_key": "custom_event", "config": bad_cfg})
        assert r.status_code == 400, bad_cfg
    r = client.post(f"/api/admin/progression/levels/{lvl}/tasks", headers=founder_h,
                    json={"name": "x", "task_type_key": "custom_event",
                          "config": {"event_key": "not_allowlisted"}})
    assert r.status_code == 400
    client.delete(f"/api/admin/progression/levels/{lvl}", headers=founder_h)


def test_app_event_allowlist(client, member_h):
    assert client.post("/api/progression/app-event", headers=member_h,
                       json={"event_key": "drop_tables"}).status_code == 400
    r = client.post("/api/progression/app-event", headers=member_h,
                    json={"event_key": "portals_visited"})
    assert r.status_code == 200
    r2 = client.post("/api/progression/app-event", headers=member_h,
                     json={"event_key": "portals_visited"})
    assert r2.json()["deduplicated"] is True  # replay-safe


def test_published_level_cannot_hard_delete(client, founder_h):
    levels = client.get("/api/admin/progression/levels", headers=founder_h).json()["levels"]
    newbie = next(l for l in levels if l["name"] == "Newbie")
    r = client.delete(f"/api/admin/progression/levels/{newbie['id']}", headers=founder_h)
    assert r.status_code == 409


def test_draft_lifecycle_and_publish_requires_task(client, founder_h):
    r = client.post("/api/admin/progression/levels", headers=founder_h,
                    json={"name": f"Draft-{uuid.uuid4().hex[:6]}", "level_number": 99})
    lvl = r.json()["level"]["id"]
    assert client.post(f"/api/admin/progression/levels/{lvl}/publish",
                       headers=founder_h).status_code == 400  # no tasks
    r = client.post(f"/api/admin/progression/levels/{lvl}/tasks", headers=founder_h,
                    json={"name": "bio", "task_type_key": "profile_bio"})
    assert r.status_code == 200
    r = client.post(f"/api/admin/progression/levels/{lvl}/publish", headers=founder_h)
    assert r.status_code == 200 and r.json()["version"] == 1
    # published → archive (not deletable)
    assert client.delete(f"/api/admin/progression/levels/{lvl}", headers=founder_h).status_code == 409
    assert client.post(f"/api/admin/progression/levels/{lvl}/archive",
                       headers=founder_h).status_code == 200


def test_dry_run_does_not_mutate(client, founder_h):
    import time
    before = client.get("/api/progression/me", headers=founder_h).json()["summary"]
    r = client.post("/api/admin/progression/jobs/start", headers=founder_h,
                    json={"dry_run": True})
    if r.status_code == 409:
        pytest.skip("another job running")
    job_id = r.json()["job"]["id"]
    for _ in range(30):
        j = client.get(f"/api/admin/progression/jobs/{job_id}", headers=founder_h).json()["job"]
        if j["status"] != "running":
            break
        time.sleep(1)
    assert j["status"] == "completed"
    assert j["totals"]["scanned"] > 0
    after = client.get("/api/progression/me", headers=founder_h).json()["summary"]
    assert before["completed_task_count"] == after["completed_task_count"]


def test_all_user_recalc_requires_confirmation_phrase(client, founder_h):
    r = client.post("/api/admin/progression/jobs/start", headers=founder_h,
                    json={"dry_run": False})
    assert r.status_code == 400 and "RECALCULATE ALL" in r.json()["detail"]


def test_visibility_backend_enforced(client, founder_h, member_h):
    # default: detailed tasks are owner-only; public summary shows level only
    client.patch("/api/progression/visibility", headers=member_h,
                 json={"settings": {"current_level": "user_only"}})
    r = client.get("/api/progression/summary/auditcheckreal", headers=founder_h).json()
    assert r["visible"] is False  # hidden from non-owner
    client.patch("/api/progression/visibility", headers=member_h,
                 json={"settings": {"current_level": "public"}})
    r = client.get("/api/progression/summary/auditcheckreal", headers=founder_h).json()
    assert r["visible"] is True and "tasks" not in r


def test_audit_logs_record_mutations(client, founder_h):
    logs = client.get("/api/admin/progression/audit-logs", headers=founder_h).json()["logs"]
    actions = {l["action"] for l in logs}
    assert {"level_create", "level_publish", "level_archive"} & actions
