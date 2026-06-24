"""Iter 38: verify Marketplace + Wallet notification kinds are HIDDEN
from the read APIs (unread-count, list) and from mark-seen, but the
underlying rows in Mongo are NOT deleted or flipped to seen.

Seeds a handful of hidden-kind rows for `tfone` directly in Mongo,
exercises the public REST endpoints, and asserts the filter holds.
Cleans up at the end (any notifications.actor_username starting with
`hidden_test_`)."""
import os
import uuid
import asyncio
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TFONE_LOGIN = {"email": "testfriend1@example.com", "password": "pass1234"}

# Mirror the backend's _HIDDEN_KINDS list (a subset for seeding).
HIDDEN_SEEDS = [
    "tip", "marketplace_ad", "ad_payout", "wallet", "promoted", "withdrawal",
]


@pytest.fixture(scope="module")
def tfone_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=TFONE_LOGIN, timeout=15)
    assert r.status_code == 200, f"tfone login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tfone_headers(tfone_token):
    return {"Authorization": f"Bearer {tfone_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tfone_id():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=TFONE_LOGIN, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    return data.get("user", {}).get("id") or data.get("id")


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
def mongo(event_loop):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    # Cleanup any TEST_ rows
    async def _cleanup():
        await db.notifications.delete_many(
            {"actor_username": {"$regex": "^hidden_test_"}}
        )
    event_loop.run_until_complete(_cleanup())
    client.close()


@pytest.fixture(scope="module")
def seeded_hidden(event_loop, mongo, tfone_id):
    """Insert 6 hidden-kind UNSEEN notifications for tfone, return their ids."""
    async def _seed():
        ids = []
        # First clear any leftover from a prior run
        await mongo.notifications.delete_many(
            {"actor_username": {"$regex": "^hidden_test_"}}
        )
        now = datetime.now(timezone.utc).isoformat()
        for k in HIDDEN_SEEDS:
            doc = {
                "id": str(uuid.uuid4()),
                "recipient_id": tfone_id,
                "kind": k,
                "actor_username": f"hidden_test_{k}",
                "payload": {"note": "iter38-test-seed"},
                "created_at": now,
                "seen": False,
            }
            await mongo.notifications.insert_one(doc)
            ids.append(doc["id"])
        return ids
    return event_loop.run_until_complete(_seed())


def test_unread_count_excludes_hidden_kinds(event_loop, mongo, tfone_headers, tfone_id, seeded_hidden):
    """Raw Mongo should show 6 hidden unseen rows, but /unread-count must NOT include them."""
    async def _raw_count():
        return await mongo.notifications.count_documents(
            {"recipient_id": tfone_id, "seen": False, "kind": {"$in": HIDDEN_SEEDS}}
        )
    raw_hidden_unseen = event_loop.run_until_complete(_raw_count())
    assert raw_hidden_unseen == len(HIDDEN_SEEDS), (
        f"expected {len(HIDDEN_SEEDS)} hidden unseen rows in Mongo, got {raw_hidden_unseen}"
    )

    r = requests.get(f"{BASE_URL}/api/notifications/unread-count", headers=tfone_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "count" in data
    # The API count must EXCLUDE the 6 hidden seeds — i.e. count < raw including hidden
    async def _all_unseen():
        return await mongo.notifications.count_documents(
            {"recipient_id": tfone_id, "seen": False}
        )
    raw_all_unseen = event_loop.run_until_complete(_all_unseen())
    expected = raw_all_unseen - raw_hidden_unseen
    assert data["count"] == expected, (
        f"unread-count={data['count']} should equal raw_all_unseen({raw_all_unseen}) - "
        f"raw_hidden_unseen({raw_hidden_unseen}) = {expected}"
    )


def test_list_excludes_hidden_kinds(tfone_headers, seeded_hidden):
    r = requests.get(f"{BASE_URL}/api/notifications/list?limit=200", headers=tfone_headers, timeout=15)
    assert r.status_code == 200, r.text
    items = r.json().get("notifications", [])
    leaked = [n for n in items if n.get("kind") in HIDDEN_SEEDS]
    assert not leaked, f"hidden kinds leaked into /list: {[n.get('kind') for n in leaked]}"
    leaked_actors = [n for n in items if (n.get("actor_username") or "").startswith("hidden_test_")]
    assert not leaked_actors, f"hidden_test_* actors leaked into /list: {leaked_actors}"


def test_mark_seen_leaves_hidden_rows_unseen(event_loop, mongo, tfone_headers, tfone_id, seeded_hidden):
    """POST /mark-seen must NOT flip the hidden rows' seen flag."""
    async def _hidden_unseen():
        return await mongo.notifications.count_documents(
            {"recipient_id": tfone_id, "seen": False, "kind": {"$in": HIDDEN_SEEDS}}
        )
    before = event_loop.run_until_complete(_hidden_unseen())
    assert before == len(HIDDEN_SEEDS)

    r = requests.post(f"{BASE_URL}/api/notifications/mark-seen", headers=tfone_headers, timeout=15)
    assert r.status_code == 200, r.text
    assert "updated" in r.json()

    after = event_loop.run_until_complete(_hidden_unseen())
    assert after == before, (
        f"mark-seen flipped {before - after} hidden rows from unseen to seen — should be 0"
    )

    # And the /unread-count for hidden should still be the count we seeded
    # (mark-seen marked all visible rows but ignored hidden ones)
    new_count = requests.get(f"{BASE_URL}/api/notifications/unread-count", headers=tfone_headers, timeout=15).json()
    assert new_count["count"] == 0, (
        f"after mark-seen, visible unread-count should be 0, got {new_count}"
    )
