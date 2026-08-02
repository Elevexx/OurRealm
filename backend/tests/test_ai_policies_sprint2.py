"""Sprint 2 spot-checks for AI Access Policy engine.

Verifies:
1. GET /api/admin/ai-policies as founder returns 4 features
2. Same endpoint as non-founder returns 403
3. GET /api/ai-policies/me as tftwo returns 4 features (all allowed with open defaults)
4. PATCH ai_images {restricted, min_level:99} then simulate tftwo -> DENIED
5. Reset ai_images back to open defaults
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")
EXPECTED_FEATURES = {"course_maker", "ai_video", "ai_images", "orai_assistant"}


def _login(username: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def stealth():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def tftwo():
    return _login("tftwo", "pass1234")


class TestAdminListPolicies:
    def test_founder_can_list(self, stealth):
        r = stealth.get(f"{BASE_URL}/api/admin/ai-policies", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "features" in data
        keys = {f["feature_key"] for f in data["features"]}
        assert keys == EXPECTED_FEATURES, f"expected {EXPECTED_FEATURES}, got {keys}"
        for f in data["features"]:
            assert "policy" in f
            assert "usage" in f

    def test_non_founder_forbidden(self, tftwo):
        r = tftwo.get(f"{BASE_URL}/api/admin/ai-policies", timeout=30)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


class TestPublicMe:
    def test_tftwo_gets_four_features_all_allowed(self, tftwo):
        r = tftwo.get(f"{BASE_URL}/api/ai-policies/me", timeout=30)
        assert r.status_code == 200, r.text
        feats = r.json().get("features", {})
        assert set(feats.keys()) == EXPECTED_FEATURES
        for k, v in feats.items():
            assert v["allowed"] is True, f"{k} should be allowed under open defaults but was denied: {v}"


class TestPatchAndSimulateAiImages:
    def test_patch_then_simulate_then_reset(self, stealth):
        # PATCH restrict ai_images
        r = stealth.patch(
            f"{BASE_URL}/api/admin/ai-policies/ai_images",
            json={"restricted": True, "min_level": 99, "reason": "qa test"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        policy = r.json()["policy"]
        assert policy["restricted"] is True
        assert policy["min_level"] == 99

        # simulate tftwo -> DENIED
        r2 = stealth.post(
            f"{BASE_URL}/api/admin/ai-policies/ai_images/simulate",
            json={"username": "tftwo"},
            timeout=30,
        )
        assert r2.status_code == 200, r2.text
        sim = r2.json()
        assert sim["allowed"] is False, f"tftwo should be denied but got {sim}"
        assert "level" in (sim.get("reason") or "").lower()

        # RESET
        r3 = stealth.patch(
            f"{BASE_URL}/api/admin/ai-policies/ai_images",
            json={"restricted": False, "min_level": 0, "reason": "qa reset"},
            timeout=30,
        )
        assert r3.status_code == 200, r3.text
        p2 = r3.json()["policy"]
        assert p2["restricted"] is False
        assert p2["min_level"] == 0

        # verify tftwo now allowed via /me
        r4 = _login("tftwo", "pass1234").get(f"{BASE_URL}/api/ai-policies/me", timeout=30)
        assert r4.status_code == 200
        assert r4.json()["features"]["ai_images"]["allowed"] is True
