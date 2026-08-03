"""Phase C iter117 — 5 new runtimes (roguelike/tactics/idle/visual_novel/fishing).

Tests:
1. POST /api/admin/games/estimate classification for the 5 new prompts.
2. services.game_studio.validate_spec accepts good specs / rejects bad ones.
3. GET /api/games hub still returns exactly 11 published (no runtime-test leak).

STRICT: do NOT approve/build any estimate (cancels only). Do NOT delete imported test games.
"""
import os
import sys
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
UA = {"User-Agent": "Mozilla/5.0 iter117-test"}

sys.path.insert(0, "/app/backend")

# Load backend .env so services.game_studio can import (needs MONGO_URL)
try:
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
except Exception:
    pass


@pytest.fixture(scope="module")
def founder():
    s = requests.Session()
    s.headers.update(UA)
    r = s.post(f"{BASE}/api/auth/login", json={"email": "stealth", "password": "Password1$"})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


# ─── 1. Estimate classification for 5 new runtimes ──────────────
ESTIMATE_CASES = [
    ("a roguelike dungeon crawler with permadeath and run upgrades", "roguelike"),
    ("an idle clicker factory game with prestige", "idle"),
    ("a branching visual novel dating sim", "visual_novel"),
    ("a relaxing fishing game with rare fish", "fishing"),
    ("a turn-based tactics squad battle game", "tactics"),
]


@pytest.mark.parametrize("request_text,expected_runtime", ESTIMATE_CASES)
def test_estimate_routes_to_new_runtime(founder, request_text, expected_runtime):
    body = {"request": request_text, "complexity": 1, "ai_power": 3}
    r = founder.post(f"{BASE}/api/admin/games/estimate", json=body, timeout=60)
    assert r.status_code == 200, f"estimate failed: {r.status_code} {r.text[:300]}"
    est = r.json().get("estimate") or {}
    plan = est.get("plan") or {}
    cls = plan.get("classification") or {}
    print(f"[{expected_runtime}] runtime={plan.get('runtime')} "
          f"detected={cls.get('detected_genre')} fallback_used={cls.get('fallback_used')} "
          f"fallback_reason={cls.get('fallback_reason')}")
    assert plan.get("runtime") == expected_runtime, \
        f"Expected runtime={expected_runtime}, got {plan.get('runtime')}"
    assert cls.get("fallback_used") is False, f"fallback_used should be False, got {cls.get('fallback_used')}"
    reason = cls.get("fallback_reason")
    assert reason is None or "not supported yet" not in str(reason).lower(), \
        f"unexpected fallback_reason: {reason}"
    assert cls.get("runtime_id") == expected_runtime
    assert cls.get("template_id") == f"tpl_{expected_runtime}_v1"

    # Cancel the estimate — do NOT approve (LLM budget)
    est_id = est.get("id")
    if est_id:
        founder.post(f"{BASE}/api/admin/games/estimate/{est_id}/cancel")


# ─── 2. validate_spec branches ──────────────────────────────
def _base_spec(runtime, stage_extra):
    return {"runtime": runtime, "stages": [{"stage": 1, **stage_extra}]}


def test_validate_spec_roguelike_ok_and_bad():
    from services import game_studio as gs
    good = _base_spec("roguelike", {"grid_w": 8, "grid_h": 8, "monsters": 3})
    errs = gs.validate_spec(good, complexity=1)
    assert errs == [], f"good roguelike should validate: {errs}"

    # missing monsters
    bad = _base_spec("roguelike", {"grid_w": 8, "grid_h": 8})
    errs2 = gs.validate_spec(bad, complexity=1)
    assert any("monsters" in e for e in errs2), f"expected 'monsters' error: {errs2}"


def test_validate_spec_tactics_ok_and_bad():
    from services import game_studio as gs
    good = _base_spec("tactics", {"units": [{"id": "u1"}], "enemies": [{"id": "e1"}]})
    assert gs.validate_spec(good, complexity=1) == []

    bad = _base_spec("tactics", {"units": [], "enemies": []})
    errs = gs.validate_spec(bad, complexity=1)
    assert any("units and enemies" in e for e in errs), errs


def test_validate_spec_idle_ok_and_bad():
    from services import game_studio as gs
    good = _base_spec("idle", {"goal": 300, "generators": [{"id": "g1", "cost": 10}]})
    assert gs.validate_spec(good, complexity=1) == []

    bad = _base_spec("idle", {"goal": 0, "generators": []})
    errs = gs.validate_spec(bad, complexity=1)
    assert any("idle" in e for e in errs), errs


def test_validate_spec_visual_novel_ok_and_bad():
    from services import game_studio as gs
    good = _base_spec("visual_novel", {"scenes": [
        {"id": "s1", "text": "Hi", "choices": [{"label": "A", "next": "s2"}]},
        {"id": "s2", "text": "Bye", "ending": True},
    ]})
    assert gs.validate_spec(good, complexity=1) == []

    # choice points to unknown scene id
    bad = _base_spec("visual_novel", {"scenes": [
        {"id": "s1", "text": "Hi", "choices": [{"label": "A", "next": "sX"}]},
        {"id": "s2", "text": "Bye", "ending": True},
    ]})
    errs = gs.validate_spec(bad, complexity=1)
    assert any("unknown scene" in e for e in errs), errs

    # missing ending
    bad2 = _base_spec("visual_novel", {"scenes": [
        {"id": "s1", "text": "Hi", "choices": []},
    ]})
    errs2 = gs.validate_spec(bad2, complexity=1)
    assert any("ending" in e for e in errs2), errs2


def test_validate_spec_fishing_ok_and_bad():
    from services import game_studio as gs
    good = _base_spec("fishing", {"casts": 10, "fish": [{"id": "trout"}]})
    assert gs.validate_spec(good, complexity=1) == []

    bad = _base_spec("fishing", {"casts": 0, "fish": []})
    errs = gs.validate_spec(bad, complexity=1)
    assert any("fishing" in e for e in errs), errs


def test_runtimes_catalog_has_21_and_no_scaffolded():
    from services import game_studio as gs
    assert len(gs.RUNTIMES) == 21, f"expected 21 runtimes, got {len(gs.RUNTIMES)}: {gs.RUNTIMES}"
    for rt in ("roguelike", "tactics", "idle", "visual_novel", "fishing"):
        assert rt in gs.RUNTIMES, f"{rt} missing from RUNTIMES"
        assert rt in gs.RUNTIME_LABELS, f"{rt} missing from RUNTIME_LABELS"
        assert rt in gs.WIN_LOSS, f"{rt} missing from WIN_LOSS"
        assert rt in gs.IDENTITY_BASE, f"{rt} missing from IDENTITY_BASE"
    assert gs.SCAFFOLDED_RUNTIMES == {}, f"SCAFFOLDED_RUNTIMES should be empty, got {gs.SCAFFOLDED_RUNTIMES}"


def test_player_reps_covers_new_runtimes():
    """BUG CHECK: PLAYER_REPS must include an entry for each of the 5 new runtimes."""
    from services import game_studio as gs
    missing = [rt for rt in ("roguelike", "tactics", "idle", "visual_novel", "fishing")
               if rt not in gs.PLAYER_REPS]
    assert not missing, f"PLAYER_REPS missing entries for new runtimes: {missing}"


# ─── 3. /api/games hub regression — exactly 11 published, no runtime-test leak ──
def test_public_games_hub_no_runtime_test_leak(founder):
    r = founder.get(f"{BASE}/api/games")
    assert r.status_code == 200
    data = r.json()
    items = data if isinstance(data, list) else (data.get("games") or data.get("items") or [])
    print(f"total public hub items={len(items)}")
    # None should carry the runtime-test label
    for g in items:
        labels = g.get("labels") or []
        assert "runtime-test" not in labels, f"runtime-test leak: {g.get('id')} {g.get('title')}"
    # 5 imported test game IDs must NOT be in the hub
    test_ids = {
        "3a0f96ab562d4a31bacaed2c306d764d",
        "8d4fec1e7b874e899c0ed2ed74c4539f",
        "70f57f67dc3a439195d5cd77d82bf835",
        "410bf9e8fd2f4292b8eadffd1a967431",
        "59b4e1ca76584dcf847c341e045943cb",
    }
    ids = {g.get("id") for g in items}
    leaked = ids & test_ids
    assert not leaked, f"runtime-test games leaked into hub: {leaked}"
    assert len(items) == 11, f"expected 11 published showcase games, got {len(items)}"
