"""Shooter + Open World RPG launch — behavioral/contract regression."""
import os

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE = os.environ.get("TEST_BASE", "http://localhost:8001")


@pytest.fixture(scope="module")
def founder_h():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "stealth", "password": "Password1$"}, timeout=10)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_catalog_lists_both(founder_h):
    r = requests.get(f"{BASE}/api/gamemaker/catalog", headers=founder_h, timeout=10)
    assert r.status_code == 200
    rts = {x["key"]: x["status"] for x in r.json()["runtimes"]}
    # Truthful statuses: greybox-presentation demos stay beta; only the
    # asset-driven 2.5D Action RPG has passed the full visual-quality review.
    assert rts["shooter"] == "beta"
    assert rts["open_world_rpg"] == "beta"
    assert rts["action_rpg_2_5d"] == "live"
    assert all(v in ("live", "beta") for v in rts.values()), f"unexpected status: {rts}"


def test_validate_spec_rules():
    from services import game_studio as gs
    ok = {"runtime": "shooter", "title": "t",
          "stages": [{"title": "s", "waves": 2, "enemies_per_wave": 4}]}
    assert gs.validate_spec(ok, 1, "shooter") == []
    bad = {"runtime": "shooter", "title": "t",
           "stages": [{"title": "s", "waves": 9, "enemies_per_wave": 0}]}
    errs = gs.validate_spec(bad, 1, "shooter")
    assert any("waves" in e for e in errs) and any("enemies_per_wave" in e for e in errs)
    owr_bad = {"runtime": "open_world_rpg", "title": "t",
               "stages": [{"title": "s", "world_w": 100, "world_h": 100,
                           "npcs": [], "goal": {"x": 999, "y": 999}}]}
    errs = gs.validate_spec(owr_bad, 1, "open_world_rpg")
    assert any("world_w" in e for e in errs)
    assert any("NPC" in e for e in errs)


def test_explicit_selection_authoritative_for_new_runtimes():
    from services import game_studio as gs
    assert "shooter" in gs.RUNTIMES and "open_world_rpg" in gs.RUNTIMES
    assert gs.route_runtime("a twin-stick arena shooter") == "shooter"
    assert gs.route_runtime("an open world exploration rpg") == "open_world_rpg"


def test_registry_live_and_truthful(founder_h):
    r = requests.get(f"{BASE}/api/admin/gamemaker/registry/overview",
                     headers=founder_h, timeout=10)
    assert r.status_code == 200


def test_demo_games_published_and_playable(founder_h):
    for gid, rt in (("demo-shooter-neon-breach-v1", "shooter"),
                    ("demo-owr-emberwild-v1", "open_world_rpg")):
        r = requests.get(f"{BASE}/api/games/{gid}", headers=founder_h, timeout=10)
        assert r.status_code == 200, r.text[:200]
        g = r.json()["game"]
        assert g["status"] == "published"
        assert g["spec"]["runtime"] == rt
        assert "est_cost" not in g and "actual_cost" not in g and "estimates" not in g
