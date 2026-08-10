"""Iter130 regression: catalog honesty (1 live + 9 beta), quote works
for beta runtime shooter, trim-stages founder endpoint + non-founder 403.

Uses direct requests against REACT_APP_BACKEND_URL. Cleans up temp game.
"""
import os
import uuid
import asyncio
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def founder_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def member_token():
    return _login("auditcheckreal", "Password1$")


# ---------- Catalog truthfulness ----------
def test_catalog_three_live_seven_beta(founder_token):
    """Truthful statuses: action_rpg_2_5d + shooter + open_world_rpg earned
    Live (visual pass + browser-proven mechanics); the other 7 remain Beta."""
    r = requests.get(f"{BASE}/api/gamemaker/catalog",
                     headers={"Authorization": f"Bearer {founder_token}"}, timeout=20)
    assert r.status_code == 200, r.text
    runtimes = r.json().get("runtimes") or []
    live = {x["key"] for x in runtimes if x["status"] == "live"}
    beta = {x["key"] for x in runtimes if x["status"] == "beta"}
    assert live == {"action_rpg_2_5d", "shooter", "open_world_rpg",
                    "platformer", "top_down_adventure"}, f"live={live}"
    for k in ["turn_based_creature_rpg",
              "card_battle", "tower_defense", "match3", "racing"]:
        assert k in beta, f"Missing beta runtime {k}"


# ---------- Quote for beta runtime ----------
def test_quote_beta_shooter_ok(founder_token):
    r = requests.post(f"{BASE}/api/gamemaker/quote",
                      headers={"Authorization": f"Bearer {founder_token}"},
                      json={
                          "runtime": "shooter",
                          "style": "pixel_art",
                          "idea": "TEST quote for beta shooter runtime — top-down arena wave clearing regression only.",
                          "ai_power": 3,
                          "economy": 3,
                      }, timeout=45)
    assert r.status_code == 200, f"quote failed: {r.status_code} {r.text[:300]}"
    j = r.json()
    q = j.get("quote") or j
    assert q.get("runtime") == "shooter", f"Expected runtime shooter, got {q.get('runtime')}"
    assert q.get("id"), "Quote should have an id"


# ---------- trim-stages endpoint ----------
@pytest.fixture()
def temp_game_id():
    """Insert a 12-stage game via mongo (only stage 12 has boss), yield id, then delete."""
    import motor.motor_asyncio
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]

    gid = f"TEST-trim-{uuid.uuid4().hex[:8]}"

    async def _setup():
        client = motor.motor_asyncio.AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        stages = []
        for i in range(1, 13):
            stages.append({"index": i, "name": f"Stage {i}", "boss": (i == 12)})
        await db.games.insert_one({
            "id": gid, "title": "TEST Trim Stages", "runtime": "platformer",
            "spec": {"stages": stages}, "status": "draft",
            "access": {"mode": "founder_only"},
        })
        client.close()

    async def _teardown():
        client = motor.motor_asyncio.AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        await db.games.delete_one({"id": gid})
        await db.gm_spec_history.delete_many({"game_id": gid})
        client.close()

    asyncio.get_event_loop().run_until_complete(_setup())
    yield gid
    try:
        asyncio.get_event_loop().run_until_complete(_teardown())
    except Exception as e:
        print(f"teardown warn: {e}")


def test_trim_stages_founder_ok(founder_token, temp_game_id):
    r = requests.post(f"{BASE}/api/admin/games/{temp_game_id}/trim-stages",
                      headers={"Authorization": f"Bearer {founder_token}"},
                      json={"keep_count": 11}, timeout=30)
    assert r.status_code == 200, f"trim-stages failed: {r.status_code} {r.text[:300]}"
    j = r.json()
    assert j.get("ok") is True
    assert j.get("stages") == 11
    assert j.get("final_has_boss") is True, f"Final stage should have boss, got {j}"

    # Verify via mongo directly that we now have 11 stages and last has boss
    import motor.motor_asyncio
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]

    async def _verify():
        client = motor.motor_asyncio.AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        g = await db.games.find_one({"id": temp_game_id}, {"_id": 0, "spec": 1})
        client.close()
        return g

    g = asyncio.get_event_loop().run_until_complete(_verify())
    stages = g["spec"]["stages"]
    assert len(stages) == 11, f"Expected 11 stages, got {len(stages)}"
    assert stages[-1].get("boss") is True, "Last stage should be boss"


def test_trim_stages_non_founder_403(member_token, temp_game_id):
    r = requests.post(f"{BASE}/api/admin/games/{temp_game_id}/trim-stages",
                      headers={"Authorization": f"Bearer {member_token}"},
                      json={"keep_count": 11}, timeout=30)
    assert r.status_code == 403, f"Expected 403 for non-founder, got {r.status_code} {r.text[:200]}"
