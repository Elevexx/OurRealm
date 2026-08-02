"""Iter 111 spot-check backend tests for Education Plans.
Read-only + one safe PATCH on caps. No generate_next_now, no chat, no delete/pause/end/decline on active plan.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
CENTER_ID = "3ed43c2b553547fbb3e6ca23b405eb91"
PLAN_ID = "eba3173816ef4e5c833af20793807444"


def _login(username, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    token = r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def stealth():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def ash():
    return _login("ash", "Student1$")


def test_list_plans_as_stealth(stealth):
    r = stealth.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/edu-plans", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    plans = data.get("plans") if isinstance(data, dict) else data
    assert isinstance(plans, list) and len(plans) >= 1
    # Find the target plan
    target = next((p for p in plans if p.get("id") == PLAN_ID or p.get("plan_id") == PLAN_ID), None)
    assert target is not None, f"plan {PLAN_ID} not in list: {plans}"
    assert target.get("status") == "active", f"plan status: {target.get('status')}"
    title = (target.get("title") or "").lower()
    assert "weekday" in title or "month" in title, f"unexpected title: {target.get('title')}"


def test_plan_detail_as_stealth(stealth):
    r = stealth.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/edu-plans/{PLAN_ID}", timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    plan = d.get("plan", d)
    assert plan.get("status") == "active"
    runs = d.get("runs", [])
    done_runs = [x for x in runs if (x.get("status") in ("done", "completed", "success"))]
    assert len(done_runs) >= 5, f"expected >=5 done runs, got {len(done_runs)} of {len(runs)}"
    assert "upcoming_dates" in d
    assert d.get("can_approve") is True


def test_list_plans_as_ash_forbidden(ash):
    r = ash.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/edu-plans", timeout=30)
    assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"


def test_detail_as_ash_forbidden(ash):
    r = ash.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/edu-plans/{PLAN_ID}", timeout=30)
    assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"


def test_patch_caps(stealth):
    body = {"caps": {"daily_lessons": 4, "weekly_lessons": 0, "monthly_lessons": 0, "total_lessons": 84,
                     "daily_cost": 0, "monthly_cost": 0, "total_cost": 0}}
    r = stealth.patch(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/edu-plans/{PLAN_ID}", json=body, timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    # verify persisted
    r2 = stealth.get(f"{BASE_URL}/api/responsibility-center/{CENTER_ID}/edu-plans/{PLAN_ID}", timeout=30)
    d = r2.json()
    plan = d.get("plan", d)
    caps = plan.get("caps", {})
    assert caps.get("total_lessons") == 84, f"caps not persisted: {caps}"
