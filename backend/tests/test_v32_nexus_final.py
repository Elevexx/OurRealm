"""V32 Nexus final verification: catalog cleanup, gfx prefs, collection, animation walk URLs, release manifest, and selection."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"


@pytest.fixture(scope="module")
def founder_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "stealth", "password": "Password1$"}, timeout=30)
    assert r.status_code == 200, f"founder login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def member_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "auditcheckreal", "password": "Password1$"}, timeout=30)
    assert r.status_code == 200
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


# ─── Catalog cleanup: only active starters visible ───
class TestAvatarsList:
    def test_avatars_active_only(self, founder_session):
        r = founder_session.get(f"{BASE_URL}/api/nexus/avatars", timeout=15)
        assert r.status_code == 200
        data = r.json()
        ids = [a["id"] for a in data["avatars"]]
        # Legacy starters must NOT appear (unless equipped as my_id, but founder is on av_ninja)
        for legacy in ("starter_m", "starter_f", "av_d5b60b3e"):
            assert legacy not in ids, f"legacy avatar {legacy} still in catalog: {ids}"
        assert "av_ninja" in ids
        assert "av_ninja_f" in ids
        assert data["default_id"] == "av_ninja"
        assert "my_gfx" in data, f"my_gfx missing: {list(data.keys())}"


# ─── Graphics prefs ───
class TestGfxPrefs:
    def test_prefs_roundtrip(self, founder_session):
        # Save original
        orig = founder_session.get(f"{BASE_URL}/api/nexus/avatars").json().get("my_gfx")
        try:
            r = founder_session.post(f"{BASE_URL}/api/nexus/prefs", json={"gfx": "high"}, timeout=15)
            assert r.status_code == 200
            assert r.json()["gfx"] == "high"
            r2 = founder_session.get(f"{BASE_URL}/api/nexus/avatars").json()
            assert r2["my_gfx"] == "high"
        finally:
            if orig:
                founder_session.post(f"{BASE_URL}/api/nexus/prefs", json={"gfx": orig})

    def test_prefs_invalid(self, founder_session):
        r = founder_session.post(f"{BASE_URL}/api/nexus/prefs", json={"gfx": "potato"}, timeout=15)
        assert r.status_code == 422


# ─── Collection: 6 premiums all available ───
class TestAvatarCollection:
    def test_collection_founder(self, founder_session):
        r = founder_session.get(f"{BASE_URL}/api/nexus/avatars/collection", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data["avatars"]) == 6
        for a in data["avatars"]:
            assert "fp_cost" in a and a["fp_cost"] > 0
            assert "unlocked" in a
            assert "equipped" in a
            assert a["available"] is True, f"{a['id']} not available"


# ─── Release + walk animation URL health ───
class TestReleaseAndWalks:
    def test_release_v32(self, founder_session):
        r = founder_session.get(f"{BASE_URL}/api/nexus/admin/release", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["release_id"] == "nexus-v32-final", f"release_id={d.get('release_id')}"
        assert d["version"] == 32
        assert d["republish_ready"] is True
        assert d["files_durable"] == 132 and d["files_total"] == 132
        assert len(d["avatars"]) == 8
        for a in d["avatars"]:
            assert a["anims"] == 7, f"{a['id']} has anims={a['anims']}"

    def test_walk_glbs_reachable(self, founder_session):
        # collect walk urls from list + collection
        walks = set()
        for path in ("/api/nexus/avatars", "/api/nexus/avatars/collection"):
            data = founder_session.get(f"{BASE_URL}{path}").json()
            for a in data["avatars"]:
                anims = a.get("animation_urls") or {}
                w = anims.get("walk")
                if w:
                    walks.add(w)
        assert len(walks) >= 8, f"expected >=8 walk urls, got {len(walks)}: {walks}"
        for u in walks:
            full = u if u.startswith("http") else f"{BASE_URL}{u}"
            r = requests.get(full, headers={"User-Agent": BROWSER_UA}, allow_redirects=True, timeout=30)
            assert r.status_code == 200, f"walk 404/err at {u}: {r.status_code}"


# ─── Avatar selection ───
class TestAvatarSelect:
    def test_select_premium_then_restore(self, founder_session):
        # Verify current
        me = founder_session.get(f"{BASE_URL}/api/nexus/avatars").json()
        original_id = me.get("my_id")
        original_glow = me.get("my_glow") or "lime"
        try:
            r = founder_session.post(f"{BASE_URL}/api/nexus/avatars/select",
                                     json={"id": "av_void_wizard"}, timeout=15)
            assert r.status_code == 200, r.text
            verify = founder_session.get(f"{BASE_URL}/api/nexus/avatars").json()
            assert verify["my_id"] == "av_void_wizard", f"got {verify['my_id']}"
        finally:
            founder_session.post(f"{BASE_URL}/api/nexus/avatars/starter",
                                 json={"id": "av_ninja", "color": original_glow})
            back = founder_session.get(f"{BASE_URL}/api/nexus/avatars").json()
            assert back["my_id"] == "av_ninja"

    def test_starter_invalid(self, founder_session):
        r = founder_session.post(f"{BASE_URL}/api/nexus/avatars/starter",
                                 json={"id": "starter_m", "color": "lime"}, timeout=15)
        assert r.status_code == 422


# ─── Migration idempotency (indirect: no user is on legacy IDs) ───
class TestMigrationIdempotency:
    def test_member_not_on_legacy(self, member_session):
        r = member_session.get(f"{BASE_URL}/api/nexus/avatars", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["my_id"] not in ("starter_m", "starter_f", "av_d5b60b3e", None, "")
