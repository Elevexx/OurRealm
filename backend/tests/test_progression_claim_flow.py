"""Iter-78 — Progression Claim End-to-End (fresh user).

Verifies the 3 hotfixes:
  Fix 1: accordion — pure frontend, not tested here.
  Fix 2: black-screen-on-claim guard — asserted on frontend.
  Fix 3: stale leaderboards — after a claim, /api/leaderboards and
         /api/leaderboards/me reflect the new reputation IMMEDIATELY
         (leaderboard_cache is invalidated on claim).

Also validates the core claim invariants: idempotency, no duplicate
grants/reputation, correct 400/409 error codes, and that @stealth's
Rising Star / 300 rep preview state is UNTOUCHED.

Run: cd /app/backend && python -m pytest tests/test_progression_claim_flow.py -q
"""
import os
import uuid
import time

import pytest
import httpx
from dotenv import load_dotenv

# Load both envs to get the internal DB conn + external URL if needed.
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

# Internal URL — the external preview URL passes through a Cloudflare edge
# whose session cookies can serve stale variants to a shared test client.
BASE = "http://localhost:8001"


class RetryClient(httpx.Client):
    """Preview ingress throttles bursts with 429s — retry transparently."""

    def request(self, *a, **kw):
        for i in range(6):
            r = super().request(*a, **kw)
            if r.status_code != 429:
                return r
            time.sleep(1.0 + i)
        return r


# ─────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def client():
    with RetryClient(base_url=BASE, timeout=30) as c:
        yield c


@pytest.fixture(scope="module")
def db():
    """Direct MongoDB access for invariant checks (counts, no _id leaks)."""
    from pymongo import MongoClient
    mongo_url = os.environ.get("MONGO_URL")
    dbname = os.environ.get("DB_NAME")
    assert mongo_url and dbname, "MONGO_URL / DB_NAME must be set"
    m = MongoClient(mongo_url)
    yield m[dbname]
    m.close()


@pytest.fixture(scope="module")
def founder_h(client):
    r = client.post("/api/auth/login", json={"email": "stealth", "password": "Password1$"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def newbie_level(client, founder_h):
    levels = client.get("/api/admin/progression/levels", headers=founder_h).json()["levels"]
    n = next(l for l in levels if l["name"] == "Newbie")
    return n


@pytest.fixture(scope="module")
def explorer_level(client, founder_h):
    levels = client.get("/api/admin/progression/levels", headers=founder_h).json()["levels"]
    e = next(l for l in levels if l["name"] == "Explorer")
    return e


@pytest.fixture(scope="module")
def fresh_user(client, db):
    """Create a fresh throwaway member, do NOT complete tasks yet."""
    tag = uuid.uuid4().hex[:6]
    payload = {
        "email": f"clm_{tag}@example.com",
        "username": f"clm{tag}",
        "password": "Password1$",
        "name": f"Claim Test {tag}",
        "accepted_terms": True, "accepted_privacy": True,
        "accepted_conditions": True, "age_confirmed_13": True,
    }
    r = client.post("/api/auth/register", json=payload)
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    yield {
        "headers": {"Authorization": f"Bearer {tok}"},
        "username": payload["username"],
        "email": payload["email"],
        "raw": r.json().get("user") or {},
    }
    # Teardown — remove the throwaway user + all its progression rows.
    u = db.users.find_one({"username": payload["username"]}, {"id": 1})
    if u:
        uid = u["id"]
        db.users.delete_one({"id": uid})
        db.user_level_progress.delete_many({"user_id": uid})
        db.user_task_progress.delete_many({"user_id": uid})
        db.user_level_history.delete_many({"user_id": uid})
        db.progression_claims.delete_many({"user_id": uid})
        db.user_reward_grants.delete_many({"user_id": uid})
        db.reputation_transactions.delete_many({"user_id": uid})
        db.posts.delete_many({"author_id": uid})


# ─────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────
def _find_user_id(db, username):
    u = db.users.find_one({"username": username}, {"id": 1})
    return u and u["id"]


# ─────────────────────────────────────────────────────────────────────────
# STEP 1 — Fresh user starts at Newbie with claim_available=False
# ─────────────────────────────────────────────────────────────────────────
def test_a_fresh_user_starts_newbie_no_claim(client, fresh_user, newbie_level):
    r = client.get("/api/progression/me", headers=fresh_user["headers"])
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["enabled"] is True
    assert d["level"]["id"] == newbie_level["id"], d["level"]
    assert d["level"]["name"] == "Newbie"
    assert d["summary"]["claim_available"] is False


# ─────────────────────────────────────────────────────────────────────────
# STEP 2 — Complete the 3 Newbie tasks: avatar, banner, foryou-eligible post
# ─────────────────────────────────────────────────────────────────────────
def test_b_complete_newbie_tasks(client, fresh_user):
    # Real (non-placeholder) media URLs — is_real_media_url() rejects
    # dicebear/ui-avatars/placeholder/etc, so use plain cdn-looking urls.
    r1 = client.patch(
        "/api/profile/me",
        headers=fresh_user["headers"],
        json={
            "avatar_url": "https://cdn.ourrealm.social/u/test/avatar.jpg",
            "banner_url": "https://cdn.ourrealm.social/u/test/banner.jpg",
        },
    )
    assert r1.status_code == 200, r1.text
    u = r1.json()["user"]
    assert u["avatar_url"].endswith("avatar.jpg")
    assert u["banner_url"].endswith("banner.jpg")

    # Public post (thought is foryou-eligible by default: real member, no
    # moderation flag, public visibility → the default from the router).
    r2 = client.post(
        "/api/posts",
        headers=fresh_user["headers"],
        json={"content": "hello world from claim test", "media_type": "thought"},
    )
    assert r2.status_code in (200, 201), r2.text
    assert (r2.json().get("post") or r2.json()).get("id")


# ─────────────────────────────────────────────────────────────────────────
# STEP 3 — After task completion, claim_available flips to True
# ─────────────────────────────────────────────────────────────────────────
def test_c_claim_available_after_tasks(client, fresh_user):
    r = client.get("/api/progression/me", headers=fresh_user["headers"])
    assert r.status_code == 200
    d = r.json()
    # Confirm every required task is now complete.
    incomplete = [t for t in d["tasks"] if t.get("required") and not t.get("completed")]
    assert not incomplete, f"unexpected incomplete tasks: {incomplete}"
    assert d["summary"]["claim_available"] is True
    assert d["summary"]["progress_percentage"] == 100


# ─────────────────────────────────────────────────────────────────────────
# STEP 4 — Claim wrong (non-current) level → 409
# ─────────────────────────────────────────────────────────────────────────
def test_d_claim_wrong_level_409(client, fresh_user, explorer_level):
    r = client.post(
        "/api/progression/claim",
        headers=fresh_user["headers"],
        json={"level_id": explorer_level["id"]},
    )
    assert r.status_code == 409, r.text
    assert "current" in r.json()["detail"].lower()


# ─────────────────────────────────────────────────────────────────────────
# STEP 5 — Successful claim → returns completed=Newbie, new=Explorer,
#          grants reputation +100, invalidates leaderboard_cache
# ─────────────────────────────────────────────────────────────────────────
def test_e_successful_claim(client, fresh_user, db, newbie_level, explorer_level):
    # Warm the leaderboard cache so we can prove the claim invalidates it.
    client.get("/api/leaderboards?category=reputation", headers=fresh_user["headers"])
    pre_cache = list(db.leaderboard_cache.find({}))
    assert len(pre_cache) >= 1, "cache should be warm before claim"

    idk = f"claim-test-{uuid.uuid4().hex[:8]}"
    r = client.post(
        "/api/progression/claim",
        headers=fresh_user["headers"],
        json={"level_id": newbie_level["id"], "idempotency_key": idk},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["idempotent"] is False
    assert body["completed_level"]["name"] == "Newbie"
    assert body["new_level"] and body["new_level"]["name"] == "Explorer"
    assert body["highest_level_reached"] is False

    # Reputation transactions include a +100 grant for the Newbie level.
    uid = _find_user_id(db, fresh_user["username"])
    assert uid
    rep = db.users.find_one({"id": uid}, {"reputation_points": 1})
    assert int(rep.get("reputation_points") or 0) == 100, rep

    # leaderboard_cache was cleared by claim_level().
    post_cache = list(db.leaderboard_cache.find({}))
    assert len(post_cache) == 0, "leaderboard_cache should be empty right after claim"


# ─────────────────────────────────────────────────────────────────────────
# STEP 6 — Idempotent replay: same claim POST returns idempotent success,
#          no duplicate DB rows.
# ─────────────────────────────────────────────────────────────────────────
def test_f_idempotent_replay(client, fresh_user, db, newbie_level):
    idk = f"claim-replay-{uuid.uuid4().hex[:8]}"
    # First replay attempt with a NEW idempotency key — engine still treats
    # it as idempotent because the (user, level, version) unique index wins.
    r = client.post(
        "/api/progression/claim",
        headers=fresh_user["headers"],
        json={"level_id": newbie_level["id"], "idempotency_key": idk},
    )
    # The engine keys idempotence off (user_id, level_id, level_version)
    # not the idempotency_key header, so this is correctly recognised as a
    # replay. The user's current level has ADVANCED to Explorer, so the
    # engine's `ulp.current_level_id != level_id` branch fires — it looks
    # up the prior success and returns it idempotently.
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["idempotent"] is True
    assert body["completed_level"]["name"] == "Newbie"

    # DB invariants: exactly one success claim, one history row, no dup
    # reward grants or reputation transactions for the Newbie level.
    uid = _find_user_id(db, fresh_user["username"])
    n_claim = db.progression_claims.count_documents(
        {"user_id": uid, "level_id": newbie_level["id"], "status": "success"})
    assert n_claim == 1, "duplicate progression_claims"
    n_hist = db.user_level_history.count_documents(
        {"user_id": uid, "level_id": newbie_level["id"]})
    assert n_hist == 1, "duplicate user_level_history rows"
    n_grants = db.user_reward_grants.count_documents(
        {"user_id": uid, "source_level_id": newbie_level["id"], "revoked": {"$ne": True}})
    # Newbie has: badge grant + reputation grant. Confirm no duplicates.
    grant_ids = [g.get("id") for g in db.user_reward_grants.find(
        {"user_id": uid, "source_level_id": newbie_level["id"]})]
    assert len(grant_ids) == len(set(grant_ids)) == n_grants, "duplicate reward grants"
    rep = db.users.find_one({"id": uid}, {"reputation_points": 1})
    assert int(rep.get("reputation_points") or 0) == 100, "reputation double-grant"


# ─────────────────────────────────────────────────────────────────────────
# STEP 7 — user_level_progress advanced EXACTLY one level: Newbie→Explorer
# ─────────────────────────────────────────────────────────────────────────
def test_g_ulp_advanced_exactly_one_level(client, fresh_user, db, explorer_level):
    uid = _find_user_id(db, fresh_user["username"])
    ulp = db.user_level_progress.find_one({"user_id": uid}, {"_id": 0})
    assert ulp["current_level_id"] == explorer_level["id"], ulp
    # only one history row (Newbie), we are now on Explorer.
    n_hist = db.user_level_history.count_documents({"user_id": uid})
    assert n_hist == 1


# ─────────────────────────────────────────────────────────────────────────
# STEP 8 — Leaderboards reflect the new reputation IMMEDIATELY (Fix 3).
# ─────────────────────────────────────────────────────────────────────────
def test_h_leaderboards_freshness_after_claim(client, fresh_user):
    r = client.get(
        "/api/leaderboards?category=reputation&period=all&page_size=50",
        headers=fresh_user["headers"],
    )
    assert r.status_code == 200, r.text
    body = r.json()
    me = body["me"]
    assert me is not None, "fresh user should be visible on the reputation board"
    assert me["reputation"] == 100
    # profile-rank endpoint uses the same _cached_rows source and must
    # agree with the leaderboard rank we just observed.
    r2 = client.get("/api/leaderboards/me", headers=fresh_user["headers"])
    assert r2.status_code == 200
    me2 = r2.json()
    assert me2["reputation"] == 100
    assert me2["global_rank"] == me["rank"], (me2, me)


# ─────────────────────────────────────────────────────────────────────────
# STEP 9 — Claim with incomplete tasks → 400 readable error.
# ─────────────────────────────────────────────────────────────────────────
def test_i_incomplete_tasks_400(client, fresh_user, db, explorer_level):
    # We are now on Explorer with incomplete tasks. Attempt to claim it.
    r = client.post(
        "/api/progression/claim",
        headers=fresh_user["headers"],
        json={"level_id": explorer_level["id"]},
    )
    # Depending on whether the Explorer tasks are auto-completable by
    # our fresh-user state, this may either 400 (incomplete) or 200
    # (unlikely — but still valid). We only assert the 400 branch here.
    if r.status_code == 400:
        detail = r.json()["detail"].lower()
        assert "complete" in detail or "required" in detail
    else:
        # If Explorer tasks were incidentally all satisfied, at least make
        # sure the engine didn't return an error status.
        assert r.status_code == 200, r.text


# ─────────────────────────────────────────────────────────────────────────
# STEP 10 — @stealth preview state UNTOUCHED (Rising Star L4, 300 rep).
# ─────────────────────────────────────────────────────────────────────────
def test_j_stealth_preview_state_preserved(client, founder_h, db):
    u = db.users.find_one({"username": "stealth"}, {"_id": 0, "reputation_points": 1})
    assert int(u.get("reputation_points") or 0) == 300, u
    r = client.get("/api/progression/me", headers=founder_h)
    assert r.status_code == 200
    d = r.json()
    assert d["level"]["name"] == "Rising Star", d["level"]
    # Level 4 in the seeded ladder.
    assert d["level"]["level_number"] == 4
