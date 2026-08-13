"""Backend regression for Founder Mobile P0 (v26/v27):
- world version >= 27; nexus_central entities carry props.ktx2 (>=15) and props.lod2k where applicable
- avatars/collection: 6 avatars each with 7 animation_urls
- /nexus/join and /nexus/public
- Fetch one KTX2 GLB by URL - reasonable size
- Frontend origin serves /basis/basis_transcoder.js and .wasm (both 200)
"""
import os
import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
FRONTEND_ORIGIN = BASE_URL  # ingress serves both API and static frontend at same origin
USER = "auditcheckreal"
PASS = "Password1$"


@pytest.fixture(scope="module")
def auth():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": USER, "password": PASS}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in {r.json()}"
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


def test_login_ok(auth):
    r = auth.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 200
    body = r.json()
    user = body.get("user") or body
    assert user.get("username") == USER


def test_world_version_and_ktx2(auth):
    r = auth.get(f"{BASE_URL}/api/nexus/world", timeout=30)
    assert r.status_code == 200, r.text[:300]
    payload = r.json()
    version = payload.get("version") or payload.get("world_version")
    assert version is not None and int(version) >= 27, f"world version too old: {version}"

    world = payload.get("world") or payload
    zones = world.get("zones") or []
    central = next((z for z in zones if z.get("id") == "nexus_central"), None)
    assert central, f"nexus_central zone missing. zones={[z.get('id') for z in zones]}"

    entities = central.get("entities") or []
    assert len(entities) > 0, "no entities in nexus_central"

    ktx2_entities = [
        e for e in entities
        if isinstance((e.get("props") or {}).get("ktx2"), str)
        and (e.get("props") or {}).get("ktx2", "").startswith("/api/media/models/")
    ]
    lod2k_entities = [e for e in entities if (e.get("props") or {}).get("lod2k")]

    assert len(ktx2_entities) >= 15, f"expected >=15 ktx2 entities, got {len(ktx2_entities)} of {len(entities)}"
    sample = ktx2_entities[0]["props"]["ktx2"]
    assert sample.endswith(".glb"), f"ktx2 not a glb url: {sample}"
    print(f"[INFO] ktx2={len(ktx2_entities)}, lod2k={len(lod2k_entities)}, total_ents={len(entities)}, version={version}")


def test_avatars_collection(auth):
    r = auth.get(f"{BASE_URL}/api/nexus/avatars/collection", timeout=30)
    assert r.status_code == 200
    data = r.json()
    avatars = data.get("avatars") or data
    assert isinstance(avatars, list) and len(avatars) == 6, f"expected 6 avatars, got {len(avatars) if isinstance(avatars, list) else type(avatars)}"
    for av in avatars:
        anims = av.get("animation_urls") or {}
        if isinstance(anims, dict):
            count = len(anims)
        else:
            count = len(anims)
        assert count == 7, f"avatar {av.get('id')} has {count} animation_urls (expected 7)"


def test_nexus_public():
    r = requests.get(f"{BASE_URL}/api/nexus/public", timeout=15)
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert "zones" in body or "world" in body or isinstance(body, dict)


def test_nexus_join(auth):
    r = auth.post(f"{BASE_URL}/api/nexus/join", json={}, timeout=30)
    assert r.status_code in (200, 201), f"{r.status_code} {r.text[:300]}"


def test_one_ktx2_glb_fetch(auth):
    r = auth.get(f"{BASE_URL}/api/nexus/world", timeout=30)
    payload = r.json()
    world = payload.get("world") or payload
    central = next(z for z in world["zones"] if z.get("id") == "nexus_central")
    urls = [
        (e.get("props") or {}).get("ktx2")
        for e in central.get("entities") or []
        if isinstance((e.get("props") or {}).get("ktx2"), str)
        and (e.get("props") or {}).get("ktx2", "").startswith("/api/media/models/")
    ]
    assert urls, "no ktx2 urls to sample"
    url = urls[0]
    r2 = requests.get(f"{BASE_URL}{url}", timeout=60, stream=True)
    assert r2.status_code == 200, f"ktx2 glb fetch {url} -> {r2.status_code}"
    # Read up to 4.5MB to check size range
    size = 0
    for chunk in r2.iter_content(65536):
        size += len(chunk)
        if size > 5 * 1024 * 1024:
            break
    print(f"[INFO] sampled ktx2 glb {url} size~{size} bytes")
    assert 50 * 1024 <= size <= 5 * 1024 * 1024, f"ktx2 GLB size out of expected range (~100KB-4MB): {size} bytes"


def test_basis_transcoder_assets_served():
    for path in ("/basis/basis_transcoder.js", "/basis/basis_transcoder.wasm"):
        r = requests.get(f"{FRONTEND_ORIGIN}{path}", timeout=30)
        assert r.status_code == 200, f"{path} returned {r.status_code}"
        assert len(r.content) > 1000, f"{path} too small: {len(r.content)}"
