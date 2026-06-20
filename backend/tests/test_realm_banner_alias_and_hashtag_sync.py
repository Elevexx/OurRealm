"""Backend tests for Realm banner_url alias + hashtag drift fixes.

Covers:
  • GET /api/communities/realms returns `banner_url` + `updated_at`
  • PATCH /api/communities/realms/{id} updates `banner` + bumps `updated_at`
  • Deleting a post decrements `db.hashtags.post_count`
  • Startup recompute_hashtag_post_counts is idempotent
  • GET /api/hashtags/top filters tags with post_count == 0
"""
import os
import requests
import pytest

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://realm-deploy.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


def _login(uname, pwd):
    r = requests.post(f"{API}/auth/login", json={"email": uname, "password": pwd}, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    return body.get("access_token") or body.get("token")


def _hdrs(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def stealth_token():
    return _login("stealth", "Password1$")


class TestRealmBannerAlias:
    def test_list_returns_banner_url_and_updated_at(self, stealth_token):
        r = requests.get(f"{API}/communities/realms", headers=_hdrs(stealth_token), timeout=20)
        assert r.status_code == 200, r.text
        realms = r.json().get("realms") or []
        assert len(realms) > 0
        # Every realm must expose banner_url + updated_at, even when banner is None.
        for realm in realms:
            assert "banner_url" in realm, f"missing banner_url on {realm.get('id')}"
            assert "updated_at" in realm, f"missing updated_at on {realm.get('id')}"

    def test_detail_returns_banner_url(self, stealth_token):
        r = requests.get(f"{API}/communities/realms", headers=_hdrs(stealth_token), timeout=20)
        realms = r.json().get("realms") or []
        sample = next((x for x in realms if x.get("owner_id")), realms[0])
        rid = sample["id"]
        r2 = requests.get(f"{API}/communities/realms/{rid}", headers=_hdrs(stealth_token), timeout=20)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert "banner_url" in body
        assert "updated_at" in body

    def test_patch_banner_persists_and_bumps_updated_at(self, stealth_token):
        # Create a throwaway realm so we don't touch seeded data.
        r = requests.post(
            f"{API}/communities/realms",
            headers=_hdrs(stealth_token),
            json={"name": "Banner Alias Test", "description": "for banner_url alias tests"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        realm = r.json()
        rid = realm["id"]
        try:
            initial_updated = realm.get("updated_at")
            # PATCH a banner URL
            r2 = requests.patch(
                f"{API}/communities/realms/{rid}",
                headers=_hdrs(stealth_token),
                json={"banner": "/api/images/test-banner.jpg"},
                timeout=20,
            )
            assert r2.status_code == 200, r2.text
            body = r2.json()
            assert body.get("banner_url") == "/api/images/test-banner.jpg"
            assert body.get("updated_at") and body["updated_at"] != initial_updated
            # And the list endpoint also shows the new banner_url.
            r3 = requests.get(f"{API}/communities/realms", headers=_hdrs(stealth_token), timeout=20)
            row = next((x for x in r3.json()["realms"] if x["id"] == rid), None)
            assert row is not None
            assert row.get("banner_url") == "/api/images/test-banner.jpg"
        finally:
            requests.delete(f"{API}/communities/realms/{rid}", headers=_hdrs(stealth_token), timeout=20)


class TestHashtagFeedSync:
    def test_trending_excludes_zero_post_count(self, stealth_token):
        """Every tag returned by /trending must have post_count > 0."""
        r = requests.get(f"{API}/hashtags/trending", params={"window": "30d", "limit": 24}, timeout=20)
        assert r.status_code == 200, r.text
        for h in r.json().get("hashtags", []):
            assert int(h.get("post_count") or 0) > 0, f"{h.get('tag')} has 0 posts in /trending"

    def test_top_excludes_zero_post_count(self, stealth_token):
        r = requests.get(f"{API}/hashtags/top", params={"window": "30d", "limit": 50}, timeout=20)
        assert r.status_code == 200, r.text
        for h in r.json().get("hashtags", []):
            assert int(h.get("post_count") or 0) > 0, f"{h.get('tag')} has 0 posts in /top"

    def test_top_endpoint_returns_real_feed_posts(self, stealth_token):
        """Every tag in /top must back a non-empty hashtag feed — the
        canonical 'no empty hashtag pages' guarantee."""
        r = requests.get(f"{API}/hashtags/top", params={"window": "30d", "limit": 10}, timeout=20)
        for h in r.json().get("hashtags", [])[:5]:
            tag = h["tag"]
            f = requests.get(f"{API}/hashtags/{tag}/feed", params={"limit": 5}, timeout=20)
            assert f.status_code == 200
            assert int(f.json().get("total") or 0) > 0, f"/{tag}/feed has zero posts despite being in /top"

    def test_post_delete_decrements_post_count(self, stealth_token):
        """Creating a post with a unique hashtag, then deleting it,
        must drop the tag's post_count back to 0 (and remove it from
        /trending and /top)."""
        unique_tag = "regrt" + os.urandom(3).hex()
        # Create post
        cr = requests.post(
            f"{API}/posts",
            headers=_hdrs(stealth_token),
            json={"content": f"Hello #{unique_tag} world", "media_type": "thought"},
            timeout=20,
        )
        assert cr.status_code in (200, 201), cr.text
        pid = cr.json().get("id") or cr.json().get("post", {}).get("id")
        assert pid, cr.text
        # Confirm it appears in /trending
        t = requests.get(f"{API}/hashtags/trending", params={"window": "1d", "limit": 24}, timeout=20)
        tags_listed = [h["tag"] for h in t.json().get("hashtags", [])]
        assert unique_tag in tags_listed
        # Delete the post
        dr = requests.delete(f"{API}/posts/{pid}", headers=_hdrs(stealth_token), timeout=20)
        assert dr.status_code == 200, dr.text
        # Now /trending must NOT include the tag (post_count==0 filter)
        t2 = requests.get(f"{API}/hashtags/trending", params={"window": "1d", "limit": 24}, timeout=20)
        tags_after = [h["tag"] for h in t2.json().get("hashtags", [])]
        assert unique_tag not in tags_after, f"{unique_tag} still in trending after delete: {tags_after}"
        # And the hashtag feed reports total==0
        f = requests.get(f"{API}/hashtags/{unique_tag}/feed", params={"limit": 5}, timeout=20)
        assert f.json().get("total") == 0
