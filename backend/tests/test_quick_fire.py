"""Increment B — Quick Fire Foundation backend tests.
Authoritative /api/fire/quick-state range + shared engine accounting:
idempotency, no-op, increase/decrease/remove refunds, pause, eligibility.
"""
import os
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

from tests._shared_loop import get_shared_loop


def _run(coro):
    return get_shared_loop().run_until_complete(coro)


def _login(u, p):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text[:200]
    return r.json()["access_token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def _react(token, post_id, value, key=None):
    return requests.post(f"{BASE_URL}/api/fire/react", headers=_h(token),
                         json={"post_id": post_id, "fire_value": value,
                               "idempotency_key": key or uuid.uuid4().hex}, timeout=30)


def _qs(token, post_id):
    r = requests.get(f"{BASE_URL}/api/fire/quick-state/{post_id}", headers=_h(token), timeout=30)
    assert r.status_code == 200, r.text[:200]
    return r.json()


NEWBIE = {"email": "quickfire.newbie@example.com", "password": "Password1$",
          "username": "quickfirenewbie", "name": "Quick Fire Newbie"}
_CLEAN = {"posts": []}


@pytest.fixture(scope="module")
def founder_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def newbie_token():
    try:
        return _login(NEWBIE["email"], NEWBIE["password"])
    except AssertionError:
        r = requests.post(f"{BASE_URL}/api/auth/register", json={
            **NEWBIE, "accepted_terms": True, "accepted_privacy": True,
            "accepted_conditions": True, "age_confirmed_13": True}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        return _login(NEWBIE["email"], NEWBIE["password"])


@pytest.fixture(scope="module")
def public_post(founder_token):
    r = requests.post(f"{BASE_URL}/api/posts", headers=_h(founder_token),
                      json={"content": f"quickfire target {uuid.uuid4().hex[:6]}",
                            "media_type": "thought"}, timeout=30)
    assert r.status_code == 200
    pid = r.json()["post"]["id"]
    _CLEAN["posts"].append(pid)
    return pid


@pytest.fixture(scope="module", autouse=True)
def _cleanup(founder_token):
    yield
    async def go():
        from core.db import db
        if _CLEAN["posts"]:
            reactions = [r async for r in db.post_fire_reactions.find(
                {"post_id": {"$in": _CLEAN["posts"]}}, {"_id": 0, "id": 1, "user_id": 1})]
            for rx in reactions:
                # release any active reservations back to the pool
                agg = await db.fire_power_transactions.aggregate([
                    {"$match": {"reaction_id": rx["id"], "status": "active"}},
                    {"$group": {"_id": None, "paid": {"$sum": "$boosted_amount"}}}]).to_list(1)
                paid = int(agg[0]["paid"]) if agg else 0
                if paid > 0:
                    await db.fire_pool_counters.update_one(
                        {"_id": rx["user_id"]}, {"$inc": {"spent_active": -paid}})
                await db.fire_power_transactions.delete_many({"reaction_id": rx["id"]})
            await db.post_fire_reactions.delete_many({"post_id": {"$in": _CLEAN["posts"]}})
            await db.posts.delete_many({"id": {"$in": _CLEAN["posts"]}})
            await db.fire_pool_counters.update_one(
                {"spent_active": {"$lt": 0}}, {"$set": {"spent_active": 0}})
    _run(go())


async def _txn_count(post_id):
    from core.db import db
    return await db.fire_power_transactions.count_documents({"post_id": post_id})


# ── Quick-state authority ─────────────────────────────────────────────
def test_quick_state_requires_auth(public_post):
    r = requests.get(f"{BASE_URL}/api/fire/quick-state/{public_post}", timeout=15)
    assert r.status_code == 401


def test_quick_state_fresh_reaction_range(founder_token, public_post):
    qs = _qs(founder_token, public_post)
    assert qs["post_eligible"] is True
    assert qs["min_selectable"] == 1 and qs["my_fire"] == 0
    assert qs["max_selectable"] == min(qs["level_max"], 1 + qs["available_boost"])
    assert qs["max_selectable"] <= qs["level_max"]


def test_newbie_fixed_at_one(newbie_token, public_post):
    qs = _qs(newbie_token, public_post)
    assert qs["max_selectable"] == 1, "Newbie must see a fixed 1-fire range"
    assert qs["min_selectable"] == 1
    # Newbie can still send exactly 1 (after explicit confirmation)
    r = _react(newbie_token, public_post, 1)
    assert r.status_code == 200 and r.json()["my_fire"] == 1
    # but never more than 1
    r = _react(newbie_token, public_post, 5)
    assert r.status_code in (400, 403)
    _react(newbie_token, public_post, 0)


def test_opening_quick_state_sends_nothing(founder_token, public_post):
    before = _run(_txn_count(public_post))
    _qs(founder_token, public_post)
    _qs(founder_token, public_post)
    assert _run(_txn_count(public_post)) == before
    assert _qs(founder_token, public_post)["my_fire"] == 0


# ── Accounting through the ONE shared engine ──────────────────────────
def test_send_increase_decrease_remove_and_refunds(founder_token, public_post):
    start_pool = _qs(founder_token, public_post)["available_boost"]

    # send 3 (boost cost 2)
    r = _react(founder_token, public_post, 3)
    assert r.status_code == 200 and r.json()["my_fire"] == 3
    qs = _qs(founder_token, public_post)
    assert qs["my_fire"] == 3
    assert qs["available_boost"] == start_pool - 2
    # existing reaction reflected: slider max covers current + remaining pool
    assert qs["max_selectable"] == min(qs["level_max"], 3 + qs["available_boost"])

    # increase 3 -> 5 charges only the diff (2)
    r = _react(founder_token, public_post, 5)
    assert r.status_code == 200 and r.json()["my_fire"] == 5
    assert _qs(founder_token, public_post)["available_boost"] == start_pool - 4

    # decrease 5 -> 2 releases 3 back
    r = _react(founder_token, public_post, 2)
    assert r.status_code == 200 and r.json()["my_fire"] == 2
    assert _qs(founder_token, public_post)["available_boost"] == start_pool - 1

    # unchanged amount creates NO new accounting transaction
    n_before = _run(_txn_count(public_post))
    r = _react(founder_token, public_post, 2)
    assert r.status_code == 200 and r.json()["my_fire"] == 2
    assert _run(_txn_count(public_post)) == n_before, "no-op must not create a transaction"

    # remove releases everything
    r = _react(founder_token, public_post, 0)
    assert r.status_code == 200 and r.json()["my_fire"] == 0
    assert _qs(founder_token, public_post)["available_boost"] == start_pool


def test_idempotency_duplicate_request(founder_token, public_post):
    key = uuid.uuid4().hex
    r1 = _react(founder_token, public_post, 4, key)
    n_after_first = _run(_txn_count(public_post))
    r2 = _react(founder_token, public_post, 4, key)  # retry with SAME key
    assert r1.status_code == 200 and r2.status_code == 200
    assert r2.json().get("duplicate") is True
    assert _run(_txn_count(public_post)) == n_after_first, "retry must not duplicate the transaction"
    assert _qs(founder_token, public_post)["my_fire"] == 4
    _react(founder_token, public_post, 0)


def test_range_never_exceeds_level_max(founder_token, public_post):
    qs = _qs(founder_token, public_post)
    r = _react(founder_token, public_post, qs["level_max"] + 1)
    assert r.status_code == 400


# ── Eligibility gates (shared with react) ─────────────────────────────
def test_non_public_post_ineligible(founder_token):
    r = requests.post(f"{BASE_URL}/api/posts", headers=_h(founder_token),
                      json={"content": "private quickfire", "media_type": "thought",
                            "audience": {"visibility": "private", "user_ids": []}}, timeout=30)
    pid = r.json()["post"]["id"]
    _CLEAN["posts"].append(pid)
    qs = _qs(founder_token, pid)
    assert qs["post_eligible"] is False and qs["max_selectable"] == 1
    assert _react(founder_token, pid, 1).status_code == 400


def test_deleted_post_ineligible(founder_token):
    ghost = uuid.uuid4().hex
    qs = _qs(founder_token, ghost)
    assert qs["post_eligible"] is False and "not found" in (qs["ineligible_reason"] or "").lower()
    assert _react(founder_token, ghost, 1).status_code == 404


def test_fire_paused_user_blocked(newbie_token, public_post):
    async def set_pause(v):
        from core.db import db
        await db.users.update_one({"username": NEWBIE["username"]}, {"$set": {"fire_paused": v}})
    _run(set_pause(True))
    try:
        qs = _qs(newbie_token, public_post)
        assert qs["post_eligible"] is False and qs["fire_paused"] is True
        assert _react(newbie_token, public_post, 1).status_code == 403
    finally:
        _run(set_pause(False))
    assert _qs(newbie_token, public_post)["post_eligible"] is True
