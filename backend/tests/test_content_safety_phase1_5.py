"""
Content Safety & Moderation — PHASE 1.5 backend tests.

Covers Phase 1.5 admin moderation controls:
  - Private-review lock/unlock cycle (audience preserved+restored) + 422 empty reason
  - Moderator notes + case detail (content, uploader, reports, notes, audit)
  - Non-admin 403s on all Phase 1.5 admin endpoints
  - User search (partial match, founder-only email), user profile, user posts filters
  - Content search with q + username / status / blurred / locked filters
  - Cases tabs: review, hidden, locked
  - Manual blur w/ source metadata records audit meta.source

Fixtures created here are cleaned up in a finalizer. NO images are uploaded
(all fixtures are text posts) — this avoids consuming vision-scan credits.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

STEALTH = {"email": "stealth", "password": "Password1$"}
TFTWO = {"email": "tftwo", "password": "pass1234"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.text}"
    tok = r.json().get("access_token")
    assert tok
    return tok


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def stealth_token():
    return _login(STEALTH)


@pytest.fixture(scope="module")
def tftwo_token():
    return _login(TFTWO)


@pytest.fixture(scope="module")
def tftwo_id(tftwo_token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tftwo_token), timeout=15)
    assert r.status_code == 200
    j = r.json()
    return (j.get("user") or j).get("id")


@pytest.fixture(scope="module")
def created_posts(stealth_token):
    """Track created post ids for cleanup."""
    ids: list[str] = []
    yield ids
    # Cleanup: unlock, unblur, unhide, then delete each post
    for pid in ids:
        try:
            requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/unlock-private",
                          json={"reason": "cleanup"}, headers=_h(stealth_token), timeout=15)
        except Exception:
            pass
        try:
            requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/unblur",
                          json={"reason": "cleanup"}, headers=_h(stealth_token), timeout=15)
        except Exception:
            pass
        try:
            requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/restore",
                          json={"reason": "cleanup"}, headers=_h(stealth_token), timeout=15)
        except Exception:
            pass
        try:
            requests.delete(f"{BASE_URL}/api/posts/{pid}", headers=_h(stealth_token), timeout=15)
        except Exception:
            pass


def _make_post(token, caption, ids_list, audience_visibility="public"):
    payload = {"content": caption, "audience": {"visibility": audience_visibility, "user_ids": []}}
    r = requests.post(f"{BASE_URL}/api/posts", json=payload, headers=_h(token), timeout=20)
    assert r.status_code in (200, 201), f"create post failed: {r.status_code} {r.text}"
    pid = r.json().get("id") or r.json().get("post", {}).get("id")
    assert pid, f"no id in create response: {r.json()}"
    ids_list.append(pid)
    return pid


# ─── Private-review lock ────────────────────────────────────────────
class TestPrivateReviewLock:
    def test_lock_empty_reason_422(self, stealth_token, created_posts):
        pid = _make_post(stealth_token, f"phase15 lock empty {uuid.uuid4().hex[:6]}", created_posts)
        r = requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/lock-private",
                          json={"reason": ""}, headers=_h(stealth_token), timeout=15)
        assert r.status_code == 422, f"expected 422 on empty reason, got {r.status_code} {r.text}"

    def test_lock_unlock_cycle_preserves_audience(self, stealth_token, tftwo_token, created_posts):
        caption = f"phase15 lock cycle {uuid.uuid4().hex[:6]}"
        pid = _make_post(stealth_token, caption, created_posts, audience_visibility="public")

        # tftwo can see it initially
        r = requests.get(f"{BASE_URL}/api/posts?viewer=tftwo", headers=_h(tftwo_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        posts = data.get("posts") if isinstance(data, dict) else data
        ids_before = [p["id"] for p in posts]
        assert pid in ids_before, "tftwo should see public post before lock"

        # Lock private
        r = requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/lock-private",
                          json={"reason": "test lock", "source": "post_menu"},
                          headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("locked") is True

        # tftwo no longer sees the post
        r = requests.get(f"{BASE_URL}/api/posts?viewer=tftwo", headers=_h(tftwo_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        posts = data.get("posts") if isinstance(data, dict) else data
        ids_after = [p["id"] for p in posts]
        assert pid not in ids_after, "tftwo should NOT see locked post"

        # Uploader (stealth) still sees it with review_lock_view.active=true
        r = requests.get(f"{BASE_URL}/api/posts?viewer=stealth", headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        posts = data.get("posts") if isinstance(data, dict) else data
        me_post = next((p for p in posts if p["id"] == pid), None)
        assert me_post is not None, "uploader should still see locked post"
        rlv = me_post.get("review_lock_view") or {}
        assert rlv.get("active") is True, f"review_lock_view.active should be true, got {rlv}"

        # Unlock — restore
        r = requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/unlock-private",
                          json={"reason": "cleared", "source": "moderation_center"},
                          headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200
        assert r.json().get("locked") is False

        # tftwo sees it again
        r = requests.get(f"{BASE_URL}/api/posts?viewer=tftwo", headers=_h(tftwo_token), timeout=15)
        data = r.json()
        posts = data.get("posts") if isinstance(data, dict) else data
        ids_restored = [p["id"] for p in posts]
        assert pid in ids_restored, "tftwo should see post after unlock (audience restored)"


# ─── Moderator notes + case detail ───────────────────────────────────
class TestNotesAndCase:
    def test_add_note_and_case_detail(self, stealth_token, created_posts):
        pid = _make_post(stealth_token, f"phase15 note case {uuid.uuid4().hex[:6]}", created_posts)
        # Lock to trigger audit entry with source
        requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/lock-private",
                      json={"reason": "lock for case", "source": "post_menu"},
                      headers=_h(stealth_token), timeout=15)
        note_text = f"internal-note-{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/note",
                          json={"note": note_text}, headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("note", {}).get("note") == note_text

        # Case detail — first call logs case_opened; call twice to observe the entry in audit
        requests.get(f"{BASE_URL}/api/admin/moderation/case/post/{pid}",
                     headers=_h(stealth_token), timeout=15)
        r = requests.get(f"{BASE_URL}/api/admin/moderation/case/post/{pid}",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "content" in d and d["content"]["id"] == pid
        assert "uploader" in d and d["uploader"]["username"] == "stealth"
        assert isinstance(d.get("reports"), list)
        assert any(n.get("note") == note_text for n in d.get("notes", []))
        actions = [a.get("action") for a in d.get("audit", [])]
        assert "private_review_lock" in actions
        assert "case_opened" in actions
        lock_entry = next(a for a in d["audit"] if a.get("action") == "private_review_lock")
        assert (lock_entry.get("meta") or {}).get("source") == "post_menu"


# ─── Non-admin 403s ─────────────────────────────────────────────────
class TestNonAdmin403:
    def test_all_phase15_admin_endpoints_forbid_non_admin(self, stealth_token, tftwo_token, created_posts):
        pid = _make_post(stealth_token, f"phase15 403 {uuid.uuid4().hex[:6]}", created_posts)
        cases = [
            ("POST", f"/api/admin/moderation/post/{pid}/lock-private",
             {"reason": "xy", "source": "post_menu"}),
            ("POST", f"/api/admin/moderation/post/{pid}/unlock-private",
             {"reason": "xy"}),
            ("POST", f"/api/admin/moderation/post/{pid}/note",
             {"note": "x"}),
            ("GET", f"/api/admin/moderation/case/post/{pid}", None),
            ("GET", "/api/admin/moderation/users/search?q=tft", None),
            ("GET", "/api/admin/moderation/content/search?q=phase15", None),
        ]
        for method, path, body in cases:
            if method == "GET":
                r = requests.get(f"{BASE_URL}{path}", headers=_h(tftwo_token), timeout=15)
            else:
                r = requests.post(f"{BASE_URL}{path}", json=body, headers=_h(tftwo_token), timeout=15)
            assert r.status_code == 403, f"{method} {path} → expected 403, got {r.status_code}: {r.text}"


# ─── User search + profile + posts filters ──────────────────────────
class TestUserSearchAndProfile:
    def test_user_search_partial_and_email_visibility(self, stealth_token, tftwo_token):
        # founder — sees email
        r = requests.get(f"{BASE_URL}/api/admin/moderation/users/search?q=tft",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200, r.text
        users = r.json()["users"]
        tftwo = next((u for u in users if u["username"] == "tftwo"), None)
        assert tftwo, f"tftwo not found in search: {[u['username'] for u in users]}"
        assert "status" in tftwo
        for k in ("reports_made", "moderation_actions", "removed_posts", "flagged_posts"):
            assert k in tftwo, f"missing count {k}"
        # founder self-search — email visible for stealth (founder)
        r2 = requests.get(f"{BASE_URL}/api/admin/moderation/users/search?q=stealth",
                          headers=_h(stealth_token), timeout=15)
        assert r2.status_code == 200
        me = next((u for u in r2.json()["users"] if u["username"] == "stealth"), None)
        assert me and me.get("email"), "founder should see email in search results"

    def test_user_profile(self, stealth_token, tftwo_id):
        r = requests.get(f"{BASE_URL}/api/admin/moderation/users/{tftwo_id}",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["id"] == tftwo_id
        assert "counts" in d
        for k in ("posts", "removed_posts", "flagged_posts", "locked_posts",
                  "reports_made", "moderation_actions", "reports_received"):
            assert k in d["counts"], f"missing count {k}"
        assert isinstance(d.get("history"), list)
        assert isinstance(d.get("notes"), list)

    def test_user_posts_filters(self, stealth_token, tftwo_id):
        for f in ("all", "hidden", "ai_flagged", "locked"):
            r = requests.get(f"{BASE_URL}/api/admin/moderation/users/{tftwo_id}/posts?filter={f}",
                             headers=_h(stealth_token), timeout=15)
            assert r.status_code == 200, f"filter {f}: {r.text}"
            j = r.json()
            assert "posts" in j and "total" in j
            # Filter subsets must be <= all
            if f == "all":
                all_total = j["total"]
            else:
                assert j["total"] <= all_total, f"{f} total {j['total']} > all {all_total}"


# ─── Content search with filters ────────────────────────────────────
class TestContentSearch:
    def test_content_search_by_caption_and_filters(self, stealth_token, created_posts):
        marker = f"phase15search{uuid.uuid4().hex[:8]}"
        pid = _make_post(stealth_token, f"caption {marker} text", created_posts)
        # Blur it (source=edit_screen — used again by TestBlurSource)
        rb = requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/blur",
                           json={"category": "graphic", "source": "edit_screen"},
                           headers=_h(stealth_token), timeout=15)
        assert rb.status_code == 200
        # Lock it
        requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/lock-private",
                      json={"reason": "for search test", "source": "moderation_center"},
                      headers=_h(stealth_token), timeout=15)
        # Give mongo a beat
        time.sleep(0.3)

        # Free-text search
        r = requests.get(f"{BASE_URL}/api/admin/moderation/content/search?q={marker}",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()["posts"]]
        assert pid in ids, f"post not found by caption search; got {ids}"

        # username filter
        r = requests.get(f"{BASE_URL}/api/admin/moderation/content/search?q={marker}&username=stealth",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200
        assert pid in [p["id"] for p in r.json()["posts"]]

        # username filter with wrong user — should NOT include our post
        r = requests.get(f"{BASE_URL}/api/admin/moderation/content/search?q={marker}&username=tftwo",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200
        assert pid not in [p["id"] for p in r.json()["posts"]]

        # blurred=true
        r = requests.get(f"{BASE_URL}/api/admin/moderation/content/search?q={marker}&blurred=true",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200
        assert pid in [p["id"] for p in r.json()["posts"]]

        # locked=true
        r = requests.get(f"{BASE_URL}/api/admin/moderation/content/search?q={marker}&locked=true",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200
        assert pid in [p["id"] for p in r.json()["posts"]]


# ─── Cases tabs review / hidden / locked ────────────────────────────
class TestCasesTabs:
    def test_locked_tab_includes_locked(self, stealth_token, created_posts):
        pid = _make_post(stealth_token, f"phase15 caseslocked {uuid.uuid4().hex[:6]}", created_posts)
        requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/lock-private",
                      json={"reason": "cases test", "source": "moderation_center"},
                      headers=_h(stealth_token), timeout=15)
        r = requests.get(f"{BASE_URL}/api/admin/moderation/cases?tab=locked",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200, r.text
        ids = [i["id"] for i in r.json()["items"]]
        assert pid in ids, f"locked post not in tab=locked; ids={ids[:10]}"

    def test_hidden_tab_includes_hidden(self, stealth_token, created_posts):
        pid = _make_post(stealth_token, f"phase15 caseshidden {uuid.uuid4().hex[:6]}", created_posts)
        # Try to hide via admin moderation endpoint
        rh = requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/hide",
                           json={"reason": "cases test hide"}, headers=_h(stealth_token), timeout=15)
        if rh.status_code == 404:
            pytest.skip("hide endpoint not present at /api/admin/moderation/post/{id}/hide")
        assert rh.status_code == 200, rh.text
        r = requests.get(f"{BASE_URL}/api/admin/moderation/cases?tab=hidden",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200
        ids = [i["id"] for i in r.json()["items"]]
        assert pid in ids, f"hidden post not in tab=hidden; ids={ids[:10]}"

    def test_review_tab_reachable(self, stealth_token):
        # Just ensures the tab returns 200 and a well-shaped payload
        r = requests.get(f"{BASE_URL}/api/admin/moderation/cases?tab=review",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json().get("items"), list)


# ─── Blur w/ source metadata ────────────────────────────────────────
class TestBlurSource:
    def test_blur_records_source_in_audit(self, stealth_token, created_posts):
        pid = _make_post(stealth_token, f"phase15 blursrc {uuid.uuid4().hex[:6]}", created_posts)
        r = requests.post(f"{BASE_URL}/api/admin/moderation/post/{pid}/blur",
                          json={"category": "graphic", "source": "edit_screen"},
                          headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200, r.text

        # Fetch case audit
        r = requests.get(f"{BASE_URL}/api/admin/moderation/case/post/{pid}",
                         headers=_h(stealth_token), timeout=15)
        assert r.status_code == 200
        entries = [a for a in r.json().get("audit", []) if a.get("action") == "blur_manual"]
        assert entries, "no blur_manual audit entries"
        assert any((e.get("meta") or {}).get("source") == "edit_screen" for e in entries), \
            f"no blur_manual with meta.source=edit_screen; got {[e.get('meta') for e in entries]}"
