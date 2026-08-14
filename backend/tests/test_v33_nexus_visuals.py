"""V33 Nexus Visuals — targeted backend verification.

Covers:
 - Founder-only asset catalog (200 founder, 403 member, 401 anonymous)
 - Release manifest nexus-v33-visuals metadata
 - Avatar collection premium thumbs (webp/avif derivatives w512/w1024/w2048 + master8k)
 - GameMaker card art durable URLs (card_battle + open_world) return image/webp
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)


def _login(username: str, password: str = "Password1$") -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "User-Agent": BROWSER_UA})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": username, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {username} → {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def founder():
    return _login("stealth")


@pytest.fixture(scope="module")
def member():
    return _login("auditcheckreal")


@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"User-Agent": BROWSER_UA})
    return s


# -- 1. Asset catalog auth gating --
class TestAssetCatalogAuth:
    def test_founder_200(self, founder):
        r = founder.get(f"{BASE_URL}/api/nexus/assets/catalog", timeout=15)
        assert r.status_code == 200, f"founder got {r.status_code}"
        data = r.json()
        assert isinstance(data, dict) or isinstance(data, list)

    def test_member_403(self, member):
        r = member.get(f"{BASE_URL}/api/nexus/assets/catalog", timeout=15)
        assert r.status_code == 403, f"member expected 403 got {r.status_code}"

    def test_anon_401(self, anon):
        r = anon.get(f"{BASE_URL}/api/nexus/assets/catalog", timeout=15)
        assert r.status_code == 401, f"anon expected 401 got {r.status_code}"


# -- 2. Release manifest --
class TestReleaseManifest:
    def test_release_v33(self, founder):
        r = founder.get(f"{BASE_URL}/api/nexus/admin/release", timeout=15)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d.get("release_id") == "nexus-v33-visuals", f"release_id={d.get('release_id')}"
        assert d.get("version") == 33, f"version={d.get('version')}"
        assert d.get("republish_ready") is True, f"republish_ready={d.get('republish_ready')}"
        fd = d.get("files_durable")
        # accept either "188/188" string or int 188 with total
        assert (fd == "188/188" or fd == 188 or d.get("files_total") == 188), f"files_durable={fd} data={d}"


# -- 3. Avatar collection premium thumbs --
class TestAvatarCollectionThumbs:
    def test_six_premium_thumbs(self, founder):
        r = founder.get(f"{BASE_URL}/api/nexus/avatars/collection", timeout=15)
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        # Response might be dict with 'avatars' or list
        avatars = data.get("avatars") if isinstance(data, dict) else data
        assert avatars and len(avatars) >= 6, f"expected 6 premiums, got {len(avatars) if avatars else 0}"

        required_thumb_keys = {"w512", "w1024", "w2048", "avif512", "avif1024", "avif2048", "master8k"}
        for a in avatars[:6]:
            aid = a.get("id")
            thumb = a.get("thumb", "")
            thumbs = a.get("thumbs") or {}
            assert re.match(r"^/api/media/images/[a-f0-9]+\.webp$", thumb), f"{aid} thumb malformed: {thumb}"
            missing = required_thumb_keys - set(thumbs.keys())
            assert not missing, f"{aid} missing thumb keys: {missing}. got={list(thumbs.keys())}"

    def test_curl_derivative_urls(self, founder):
        """Curl 3-4 thumb URLs with browser UA, follow redirects, expect image content-type."""
        r = founder.get(f"{BASE_URL}/api/nexus/avatars/collection", timeout=15)
        data = r.json()
        avatars = data.get("avatars") if isinstance(data, dict) else data

        checked = 0
        for a in avatars[:6]:
            thumbs = a.get("thumbs") or {}
            for key in ("w512", "w1024", "avif512"):
                url = thumbs.get(key)
                if not url:
                    continue
                full = url if url.startswith("http") else f"{BASE_URL}{url}"
                resp = requests.get(full, headers={"User-Agent": BROWSER_UA}, allow_redirects=True, timeout=25)
                assert resp.status_code == 200, f"{a['id']} {key} {full} → {resp.status_code}"
                ct = resp.headers.get("content-type", "").lower()
                assert "image/" in ct, f"{a['id']} {key} content-type={ct}"
                checked += 1
                if checked >= 4:
                    return
        assert checked >= 3, f"only checked {checked} derivative URLs"


# -- 4. GameMaker card art URLs --
GAMEMAKER_URLS = [
    ("card_battle_1024", "/api/media/images/723781ee31eeaf289331287382cbf234.webp"),
    ("card_battle_512", "/api/media/images/566ec4fa237e8b6d2568d6cd4ba7dc96.webp"),
    ("open_world_1024", "/api/media/images/9dc01738c82ce276cb3a8442233b65dc.webp"),
    ("open_world_512", "/api/media/images/585361f0dc2b0e45daffcce4c19b5cf4.webp"),
]


@pytest.mark.parametrize("name,path", GAMEMAKER_URLS)
def test_gamemaker_art_reachable(name, path):
    url = f"{BASE_URL}{path}"
    r = requests.get(url, headers={"User-Agent": BROWSER_UA}, allow_redirects=True, timeout=25)
    assert r.status_code == 200, f"{name} {url} → {r.status_code}"
    ct = r.headers.get("content-type", "").lower()
    assert "image/webp" in ct, f"{name} content-type={ct}"
