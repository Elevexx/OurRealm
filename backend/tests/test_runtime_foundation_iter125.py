"""Iter125 — P0 spec-pipeline hardening + shared asset/animation foundation.
Offline where possible (no LLM calls); API checks reuse founder login."""
import os
import sys

import pytest
import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")
JUNGLE_GID = "a1fa88be6bdf48c5bf28b0fab18fb1dc"


@pytest.fixture(scope="module")
def h():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": "stealth", "password": "Password1$"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


# ── P0: JSON salvage parser ───────────────────────────────────────────
def test_parse_spec_json_salvage():
    from services.game_studio import parse_spec_json
    assert parse_spec_json("") == {}
    assert parse_spec_json('{"a":1}') == {"a": 1}
    assert parse_spec_json('```json\n{"a":1}\n```') == {"a": 1}
    got = parse_spec_json('prose before {"runtime":"action_rpg_2_5d","stages":[{}]} prose after')
    assert got["runtime"] == "action_rpg_2_5d"
    assert parse_spec_json('{"a": {"b": "has } brace"}, "c": 2}')["c"] == 2
    assert parse_spec_json('{"truncated": [1,2') == {}


# ── P0: honest validation errors (never a bare "unknown runtime") ────
def test_validate_spec_honest_errors():
    from services.game_studio import validate_spec
    assert "no valid JSON" in validate_spec({})[0]
    assert "not in the engine runtime registry" in validate_spec({"runtime": "bogus"})[0]
    e = validate_spec({"runtime": "card_battle", "stages": []}, 1, expected_runtime="action_rpg_2_5d")
    assert "substitution is not allowed" in e[0]


# ── P1: prompts derive runtime enums from the authoritative registry ──
def test_prompts_use_authoritative_runtime_enum():
    from services.game_studio import EST_SYSTEM, RUNTIME_ENUM, RUNTIMES
    from services.game_blueprints import PLAN_SYSTEM
    assert "action_rpg_2_5d" in RUNTIME_ENUM
    assert RUNTIME_ENUM == "|".join(RUNTIMES)
    assert RUNTIME_ENUM in EST_SYSTEM and "__RUNTIME_ENUM__" not in EST_SYSTEM
    assert RUNTIME_ENUM in PLAN_SYSTEM and "__RUNTIME_ENUM__" not in PLAN_SYSTEM


# ── P2: shared asset-role + animation-state foundation ────────────────
def test_foundation_seeds():
    from services.game_platform.asset_animation_foundation import (
        ASSET_ROLE_SEED, ANIMATION_STATE_SEED)
    for role in ("player_sprite", "enemy_sprite", "tileset", "background", "parallax_layer"):
        assert role in ASSET_ROLE_SEED, role
    assert ASSET_ROLE_SEED["player_sprite"]["animatable"]
    for s in ("idle", "walk", "jump"):
        assert ANIMATION_STATE_SEED[s]["core"], s
    assert not ANIMATION_STATE_SEED["attack"]["core"]


def test_asset_profile_endpoint(h):
    r = requests.get(f"{BASE}/api/orai/platform/asset-profile/action_rpg_2_5d", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["engine_runtime"] == "action_rpg_2_5d"
    assert {"idle", "walk", "jump"}.issubset(set(d["animation_states"]))
    slots = {s["slot"] for s in d["slots"]}
    assert {"player_sprite", "enemy_sprite", "boss_sprite", "background"}.issubset(slots)


def test_asset_profile_foundation_family_honest(h):
    r = requests.get(f"{BASE}/api/orai/platform/asset-profile/rts", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["slots"] == [] and "foundation-only" in d["note"]


# ── P0 acceptance: the Jungle build reached a validated playable state ─
def test_jungle_build_completed(h):
    r = requests.get(f"{BASE}/api/admin/games/{JUNGLE_GID}/assets/wiring-report", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    v = r.json().get("validation") or {}
    assert v.get("publish_blockers") in ([], None), v
