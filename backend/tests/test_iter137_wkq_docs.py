"""Iter137 — WKQ Skybound + Arcane Hearth doc + gamemaker route audit."""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def founder():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": "stealth", "password": "Password1$"}, timeout=30)
    assert r.status_code == 200, r.text
    return s


def _doc(founder_sess, gid):
    r = founder_sess.get(f"{BASE}/api/games/{gid}", timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    return j.get("game") or j


def test_skybound_doc_max_quality(founder):
    d = _doc(founder, "wkq-skybound-chef-v2")
    assert d["complexity"] == 10
    assert d["ai_power"] == 10
    assert d["founder_max_quality"] is True
    assert d["runtime"] == "action_rpg_2_5d"
    assert d.get("access", {}).get("mode") == "founder_only"


def test_arcane_doc_max_quality(founder):
    d = _doc(founder, "wkq-arcane-hearth-3d-v1")
    assert d["complexity"] == 10
    assert d["ai_power"] == 10
    assert d["founder_max_quality"] is True
    assert d["runtime"] == "open_world_3d"
    assert d.get("access", {}).get("mode") == "founder_only"
    lv = d.get("spec", {}).get("levels_3d") or d.get("levels_3d")
    assert isinstance(lv, list) and len(lv) == 5


def test_gamemaker_quote_route_audit(founder):
    r = founder.post(
        f"{BASE}/api/gamemaker/quote",
        json={"idea": "ROUTE FIXTURE", "runtime": "action_rpg_2_5d", "style": "stylized_3d", "dry_run": True},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    q = r.json().get("quote") or r.json()
    assert q["ai_power"] == 10
    assert q["complexity"] == 10
    assert q["founder_max_quality"] is True
    assert q["runtime"] == "action_rpg_2_5d"
