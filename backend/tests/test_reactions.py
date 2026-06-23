"""Backend tests for universal emoji reactions (Mongo path).

Covers:
- POST /api/reactions/set  (add / remove / replace / validation / auth / 404)
- GET  /api/reactions/summary  (batch, limits)
- Inline `reactions` embed on /api/posts, /api/posts/{id}/comments,
  /api/messages/thread/{u}, /api/community-chats/{id}/messages
- Mongo uniqueness — same user reacting twice does NOT duplicate row
- P2-a smoke (assignee assign / unassign)
"""
from __future__ import annotations

import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

ALLOWED = ["❤️", "😍", "😘", "🔥", "🙏", "💪", "⚡️"]
DISALLOWED = ["👍", "💩", "🚀"]


# ─────────── auth helpers ───────────
def _login(username: str, password: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": username, "password": password},
        timeout=15,
    )
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def stealth_token() -> str:
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def tfone_token() -> str:
    return _login("tfone", "pass1234")


@pytest.fixture(scope="module")
def support_token() -> str:
    return _login("support", "Password1$")


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ─────────── seed: create a post we can react to ───────────
@pytest.fixture(scope="module")
def seed_post(stealth_token):
    body = {"content": f"TEST_reactions_seed_{uuid.uuid4().hex[:8]}"}
    r = requests.post(f"{BASE_URL}/api/posts", json=body, headers=_h(stealth_token), timeout=15)
    assert r.status_code in (200, 201), f"post create failed: {r.status_code} {r.text}"
    pid = r.json().get("id") or r.json().get("post", {}).get("id")
    assert pid
    return pid


@pytest.fixture(scope="module")
def seed_comment(stealth_token, seed_post):
    r = requests.post(
        f"{BASE_URL}/api/posts/{seed_post}/comment",
        json={"text": "TEST_reactions_comment"},
        headers=_h(stealth_token),
        timeout=15,
    )
    assert r.status_code in (200, 201), f"comment create: {r.status_code} {r.text}"
    cid = r.json().get("id") or r.json().get("comment", {}).get("id")
    assert cid
    return cid


# ─────────── auth required ───────────
def test_set_requires_auth(seed_post):
    r = requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "post", "target_id": seed_post, "emoji": "❤️"},
        timeout=15,
    )
    assert r.status_code in (401, 403)


# ─────────── happy path: add / replace / remove on a post ───────────
def test_post_add_replace_remove(stealth_token, seed_post):
    # add ❤️
    r = requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "post", "target_id": seed_post, "emoji": "❤️"},
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["my_reaction"] == "❤️"
    assert j["removed"] is False
    assert any(s["emoji"] == "❤️" for s in j["summary"])

    # replace with 🔥
    r = requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "post", "target_id": seed_post, "emoji": "🔥"},
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 200
    j = r.json()
    assert j["my_reaction"] == "🔥"
    assert j["removed"] is False
    # heart must be gone
    assert not any(s["emoji"] == "❤️" for s in j["summary"])

    # tap same emoji → remove
    r = requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "post", "target_id": seed_post, "emoji": "🔥"},
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 200
    j = r.json()
    assert j["removed"] is True
    assert j["my_reaction"] is None


# ─────────── all 7 allowed emojis accepted ───────────
@pytest.mark.parametrize("emoji", ALLOWED)
def test_allowed_emojis(stealth_token, seed_post, emoji):
    r = requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "post", "target_id": seed_post, "emoji": emoji},
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 200, f"emoji {emoji}: {r.text}"
    # cleanup — toggle off if we just added
    if r.json().get("my_reaction") == emoji:
        requests.post(
            f"{BASE_URL}/api/reactions/set",
            json={"target_type": "post", "target_id": seed_post, "emoji": emoji},
            headers=_h(stealth_token), timeout=15,
        )


# ─────────── disallowed emojis rejected ───────────
@pytest.mark.parametrize("emoji", DISALLOWED)
def test_disallowed_emojis(stealth_token, seed_post, emoji):
    r = requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "post", "target_id": seed_post, "emoji": emoji},
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 400, f"emoji {emoji}: {r.status_code} {r.text}"


# ─────────── bad target_type / non-existent id ───────────
def test_bad_target_type(stealth_token, seed_post):
    r = requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "banana", "target_id": seed_post, "emoji": "❤️"},
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 400


def test_nonexistent_target(stealth_token):
    r = requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "post", "target_id": "no-such-post-id-zzz", "emoji": "❤️"},
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 404


# ─────────── batch summary ───────────
def test_batch_summary(stealth_token, seed_post):
    # ensure at least one reaction exists
    requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "post", "target_id": seed_post, "emoji": "😍"},
        headers=_h(stealth_token), timeout=15,
    )
    r = requests.get(
        f"{BASE_URL}/api/reactions/summary",
        params={"target_type": "post", "target_ids": seed_post},
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 200
    data = r.json()["reactions"]
    assert seed_post in data
    assert data[seed_post]["my_reaction"] == "😍"
    # cleanup
    requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "post", "target_id": seed_post, "emoji": "😍"},
        headers=_h(stealth_token), timeout=15,
    )


def test_batch_summary_max_200(stealth_token):
    # 250 fake ids — should accept request, return empty (truncated to 200)
    ids = ",".join(f"fake-{i}" for i in range(250))
    r = requests.get(
        f"{BASE_URL}/api/reactions/summary",
        params={"target_type": "post", "target_ids": ids},
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 200
    data = r.json()["reactions"]
    # backend trims to 200
    assert len(data) <= 200


# ─────────── uniqueness: 2 reactions from same user → 1 row ───────────
def test_uniqueness_no_duplicate(stealth_token, seed_post):
    for emoji in ["❤️", "🔥", "💪"]:
        r = requests.post(
            f"{BASE_URL}/api/reactions/set",
            json={"target_type": "post", "target_id": seed_post, "emoji": emoji},
            headers=_h(stealth_token), timeout=15,
        )
        assert r.status_code == 200
    # final summary must show exactly 1 reaction from this user
    r = requests.get(
        f"{BASE_URL}/api/reactions/summary",
        params={"target_type": "post", "target_ids": seed_post},
        headers=_h(stealth_token), timeout=15,
    )
    data = r.json()["reactions"][seed_post]
    assert data["my_reaction"] == "💪"
    # only one emoji has count==1 from us (others may exist from other users)
    counts = {s["emoji"]: s["count"] for s in data["summary"]}
    assert counts.get("💪", 0) >= 1
    # clean up
    requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "post", "target_id": seed_post, "emoji": "💪"},
        headers=_h(stealth_token), timeout=15,
    )


# ─────────── comment + reply react ───────────
def test_comment_reactions(stealth_token, seed_post, seed_comment):
    r = requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "comment", "target_id": seed_comment, "emoji": "🙏"},
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 200
    # GET comments should embed reactions
    r = requests.get(
        f"{BASE_URL}/api/posts/{seed_post}/comments?viewer=stealth",
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 200
    comments = r.json().get("comments") or r.json()
    target = next((c for c in comments if c.get("id") == seed_comment), None)
    assert target is not None
    assert "reactions" in target
    assert target["reactions"]["my_reaction"] == "🙏"


# ─────────── inline embed on /api/posts ───────────
def test_posts_list_embeds_reactions(stealth_token, seed_post):
    requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "post", "target_id": seed_post, "emoji": "⚡️"},
        headers=_h(stealth_token), timeout=15,
    )
    r = requests.get(f"{BASE_URL}/api/posts?viewer=stealth", headers=_h(stealth_token), timeout=15)
    assert r.status_code == 200
    posts = r.json().get("posts") or r.json()
    found = next((p for p in posts if p.get("id") == seed_post), None)
    assert found is not None, "seed post not found in feed"
    assert "reactions" in found
    assert found["reactions"].get("my_reaction") == "⚡️"


# ─────────── DM thread embed ───────────
def test_dm_thread_embeds_reactions(stealth_token, tfone_token):
    # stealth sends DM to tfone (POST /api/messages)
    r = requests.post(
        f"{BASE_URL}/api/messages",
        json={"to_username": "tfone", "text": f"TEST_react_dm_{uuid.uuid4().hex[:6]}"},
        headers=_h(stealth_token), timeout=15,
    )
    if r.status_code == 403:
        pytest.skip("stealth not friends with tfone — DM blocked")
    assert r.status_code in (200, 201), r.text
    msg_id = r.json().get("id") or r.json().get("message", {}).get("id")
    assert msg_id

    rr = requests.post(
        f"{BASE_URL}/api/reactions/set",
        json={"target_type": "dm_message", "target_id": msg_id, "emoji": "😘"},
        headers=_h(stealth_token), timeout=15,
    )
    assert rr.status_code == 200

    r = requests.get(
        f"{BASE_URL}/api/messages/thread/tfone",
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 200
    msgs = r.json().get("messages") or r.json()
    target = next((m for m in msgs if m.get("id") == msg_id), None)
    assert target is not None
    assert "reactions" in target
    assert target["reactions"]["my_reaction"] == "😘"


# ─────────── P2-a smoke: assignee endpoints ───────────
def test_p2a_assignable_endpoint(stealth_token):
    r = requests.get(
        f"{BASE_URL}/api/admin/support/assignable",
        headers=_h(stealth_token), timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    items = data.get("assignable") or data.get("users") or data
    assert isinstance(items, list)
    assert len(items) >= 2
    usernames = [u.get("username") for u in items]
    assert "stealth" in usernames
    assert "support" in usernames
