"""Iter131 — Production Repair + Rollback endpoints regression.

Covers:
- Temp game (12 stages, boss on 12, opaque jpg 'enemy_sprite'): repair with
  keep_stages=11 trims to 11 preserving boss + removes opaque sprite. Snapshot
  in gm_spec_history exists. Rollback restores 12-stage original.
- Non-founder gets 403 on both endpoints.
- Real demo shooter neon-breach: repair with {} returns ok + "no repairs were
  needed" AND preserves all 3 assets. Cleans up its snapshot afterwards.
"""
import os
import uuid
import asyncio
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

OPAQUE_JPG = "/api/media/images/dba1c839e47b457fb2b0144bbca52162.jpg"
DEMO_SHOOTER_ID = "demo-shooter-neon-breach-v1"


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"Login failed {email}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def founder_h():
    return {"Authorization": f"Bearer {_login('stealth', 'Password1$')}"}


@pytest.fixture(scope="module")
def member_h():
    return {"Authorization": f"Bearer {_login('auditcheckreal', 'Password1$')}"}


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


@pytest.fixture()
def temp_game_id():
    import motor.motor_asyncio
    gid = f"TEST-repair-{uuid.uuid4().hex[:8]}"

    async def _setup():
        client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        stages = [{"index": i, "name": f"Stage {i}", "boss": (i == 12)} for i in range(1, 13)]
        await db.games.insert_one({
            "id": gid, "title": "TEST Production Repair",
            "runtime": "platformer",
            "spec": {
                "runtime": "platformer",
                "stages": stages,
                "assets": {
                    "enemy_sprite": {"url": OPAQUE_JPG, "kind": "sprite"},
                },
            },
            "status": "draft",
            "access": {"mode": "founder_only"},
        })
        client.close()

    async def _teardown():
        client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.games.delete_one({"id": gid})
        await db.gm_spec_history.delete_many({"game_id": gid})
        client.close()

    _run(_setup())
    yield gid
    try:
        _run(_teardown())
    except Exception as e:  # noqa: BLE001
        print(f"teardown warn: {e}")


# --------------- Temp-game repair + rollback ---------------
def test_production_repair_temp_game(founder_h, temp_game_id):
    r = requests.post(f"{BASE}/api/admin/games/{temp_game_id}/production-repair",
                      headers=founder_h, json={"keep_stages": 11}, timeout=60)
    assert r.status_code == 200, f"repair failed: {r.status_code} {r.text[:400]}"
    j = r.json()
    assert j.get("ok") is True
    actions = j.get("actions") or []
    joined = " || ".join(actions)
    # trim action present
    assert any("trimmed" in a and "11" in a for a in actions), f"missing trim action: {actions}"
    # boss preserved
    assert "boss=True" in joined or "boss=true" in joined.lower(), f"boss not preserved: {actions}"
    # opaque sprite removed
    assert any("enemy_sprite" in a and "transparency" in a for a in actions), (
        f"opaque sprite not removed: {actions}"
    )

    # Verify mongo state: 11 stages, last has boss, no enemy_sprite
    import motor.motor_asyncio

    async def _q():
        client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        g = await db.games.find_one({"id": temp_game_id}, {"_id": 0, "spec": 1})
        snaps = await db.gm_spec_history.find(
            {"game_id": temp_game_id, "reason": "production_repair"}, {"_id": 0}
        ).to_list(length=10)
        client.close()
        return g, snaps

    g, snaps = _run(_q())
    stages = g["spec"]["stages"]
    assert len(stages) == 11, f"Expected 11 stages, got {len(stages)}"
    assert stages[-1].get("boss") is True
    assert "enemy_sprite" not in (g["spec"].get("assets") or {})
    assert len(snaps) == 1, f"Expected 1 snapshot, got {len(snaps)}"
    assert len(snaps[0]["spec"]["stages"]) == 12, "Snapshot should hold original 12 stages"

    # Rollback
    r2 = requests.post(f"{BASE}/api/admin/games/{temp_game_id}/production-repair/rollback",
                       headers=founder_h, timeout=30)
    assert r2.status_code == 200, f"rollback failed: {r2.status_code} {r2.text[:300]}"
    assert r2.json().get("ok") is True

    async def _q2():
        client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        g = await db.games.find_one({"id": temp_game_id}, {"_id": 0, "spec": 1})
        client.close()
        return g

    g2 = _run(_q2())
    assert len(g2["spec"]["stages"]) == 12, "Rollback should restore 12 stages"
    assert "enemy_sprite" in (g2["spec"].get("assets") or {}), "Rollback should restore asset"


def test_production_repair_non_founder_403(member_h, temp_game_id):
    r = requests.post(f"{BASE}/api/admin/games/{temp_game_id}/production-repair",
                      headers=member_h, json={}, timeout=20)
    assert r.status_code == 403, f"Expected 403, got {r.status_code} {r.text[:200]}"
    r2 = requests.post(f"{BASE}/api/admin/games/{temp_game_id}/production-repair/rollback",
                       headers=member_h, timeout=20)
    assert r2.status_code == 403, f"Expected 403 rollback, got {r2.status_code} {r2.text[:200]}"


# --------------- Real demo shooter no-op repair ---------------
def test_production_repair_demo_shooter_noop(founder_h):
    # Fetch current assets first
    r0 = requests.get(f"{BASE}/api/games/{DEMO_SHOOTER_ID}", headers=founder_h, timeout=15)
    assert r0.status_code == 200
    pre_assets = set(((r0.json()["game"].get("spec") or {}).get("assets") or {}).keys())
    for k in ("player_sprite", "background", "enemy_sprite"):
        assert k in pre_assets, f"Pre-condition failed: {k} missing from demo shooter assets: {pre_assets}"

    r = requests.post(f"{BASE}/api/admin/games/{DEMO_SHOOTER_ID}/production-repair",
                      headers=founder_h, json={}, timeout=90)
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    j = r.json()
    assert j.get("ok") is True
    actions = j.get("actions") or []
    assert any("no repairs were needed" in a for a in actions), f"Expected no-op, got: {actions}"
    # No 'removed asset' action should be present
    assert not any(a.startswith("removed asset") for a in actions), f"Unexpected removal: {actions}"

    # Verify assets still intact
    r1 = requests.get(f"{BASE}/api/games/{DEMO_SHOOTER_ID}", headers=founder_h, timeout=15)
    post_assets = set(((r1.json()["game"].get("spec") or {}).get("assets") or {}).keys())
    for k in ("player_sprite", "background", "enemy_sprite"):
        assert k in post_assets, f"Post-condition FAILED: {k} missing after repair! assets={post_assets}"

    # Clean up snapshot the repair created
    import motor.motor_asyncio

    async def _clean():
        client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        res = await db.gm_spec_history.delete_many(
            {"game_id": DEMO_SHOOTER_ID, "reason": "production_repair"})
        client.close()
        return res.deleted_count

    deleted = _run(_clean())
    assert deleted >= 1, "Expected at least one snapshot to clean up"
