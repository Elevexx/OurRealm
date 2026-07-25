"""Progression audit & repair regression tests.

Covers: Like→Fire task conversion, Inner Realm detection from users.inner_8,
Join Realms historical count, duplicate merge, repair idempotency, new fire
calculators, and the validation report shape.
"""
import asyncio
import os
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


def _login(u, p):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": u, "password": p}, timeout=30)
    assert r.status_code == 200
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def founder_token():
    return _login("stealth", "Password1$")


def test_no_active_like_or_top8_tasks_remain():
    async def go():
        from core.db import db
        return await db.progression_tasks.count_documents(
            {"status": "active", "task_type_key": {"$in": ["likes_received", "top8_add", "inner8_add"]}})
    assert _run(go()) == 0


def test_snapshots_converted_no_like_tasks():
    async def go():
        from core.db import db
        bad = 0
        async for v in db.progression_level_versions.find({}, {"_id": 0, "snapshot.tasks": 1}):
            for t in (v.get("snapshot") or {}).get("tasks") or []:
                if t.get("task_type_key") in ("likes_received", "top8_add", "inner8_add"):
                    bad += 1
        return bad
    assert _run(go()) == 0


def test_fire_received_calculator_counts_history():
    async def go():
        from core.db import db
        from services.progression.calculators import fire_received
        user = await db.users.find_one({"username": "stealth"}, {"_id": 0})
        return await fire_received(user, {}, None, 100)
    r = _run(go())
    assert r["value"] >= 1  # stealth has real historical fire on posts
    assert r["source"] == "db.post_fire_reactions"


def test_inner_realm_calculator_uses_inner_8():
    async def go():
        from core.db import db
        from services.progression.calculators import inner_realm_complete
        user = await db.users.find_one({"username": "stealth"}, {"_id": 0})
        return await inner_realm_complete(user, {}, None, 8)
    r = _run(go())
    assert r["completed"] is True  # stealth has a fully configured Inner Realm
    assert r["target"] in (4, 8, 12, 24)


def test_join_realm_counts_historical_memberships(founder_token):
    r = requests.get(f"{BASE_URL}/api/progression/me",
                     headers={"Authorization": f"Bearer {founder_token}"}, timeout=30)
    assert r.status_code == 200
    tasks = {t["name"]: t for t in r.json().get("tasks") or []}
    jr = tasks.get("Join 3 Realms")
    assert jr and jr["current_value"] >= 3 and jr["completed"]
    ir = tasks.get("Complete your Inner Realm")
    assert ir and ir["completed"]
    assert not any("valid likes" in n.lower() for n in tasks), "like task still visible"
    assert any("Fire Power" in n for n in tasks), "fire task missing"


def test_duplicate_merge_and_repair_idempotency():
    async def go():
        from core.db import db
        from services.progression.repair import run_progress_repair
        lvl = await db.progression_levels.find_one({"level_number": 4}, {"_id": 0, "id": 1})
        canon = await db.progression_tasks.find_one(
            {"level_id": lvl["id"], "task_type_key": "gain_follower"}, {"_id": 0})
        dup_id = uuid.uuid4().hex
        await db.progression_tasks.insert_one({
            **{k: v for k, v in canon.items() if k != "id"},
            "id": dup_id, "name": canon["name"] + " (copy)",
            "created_at": "2099-01-01T00:00:00+00:00"})
        rep1 = await run_progress_repair(actor="pytest")
        n_active = await db.progression_tasks.count_documents(
            {"level_id": lvl["id"], "task_type_key": "gain_follower", "status": "active"})
        dup = await db.progression_tasks.find_one({"id": dup_id}, {"_id": 0, "status": 1, "merged_into": 1})
        rep2 = await run_progress_repair(actor="pytest")  # second run — no-op
        await db.progression_tasks.delete_one({"id": dup_id})
        return rep1, n_active, dup, rep2
    rep1, n_active, dup, rep2 = _run(go())
    assert rep1["status"].startswith("completed")
    assert n_active == 1, "duplicate not merged"
    assert dup["status"] == "archived" and dup["merged_into"]
    assert rep2["duplicate_tasks_merged"] == 0
    assert rep2["tasks_converted_to_fire"] == 0
    assert rep2["users_failed"] == 0


def test_repair_report_shape_and_admin_endpoint(founder_token):
    r = requests.get(f"{BASE_URL}/api/admin/progression/repair/latest",
                     headers={"Authorization": f"Bearer {founder_token}"}, timeout=30)
    assert r.status_code == 200
    rep = r.json()["report"]
    for key in ("tasks_audited", "tasks_converted_to_fire", "tasks_renamed",
                "duplicate_tasks_merged", "users_scanned", "users_repaired",
                "inner_realm_completions", "realm_membership_completions",
                "fire_task_completions", "claims_now_available", "errors", "status"):
        assert key in rep, f"report missing {key}"
    assert rep["users_scanned"] > 0
    assert rep["users_failed"] == 0
