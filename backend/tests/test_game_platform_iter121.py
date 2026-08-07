"""ORAi Game Platform (iter121) — independent verification of platform routes.

Scope (backend-only, from /api/orai/platform/*):
  - registries overview (11 registries incl assets + projects) + founder gate
  - runtime catalog (>=35 families + maturity counts)
  - capability-driven recommend (tower_defense positive, pure RTS rejected)
  - registry upsert + version bump + rollback
  - multi-stage /plan (15 stages, grouped_validation, diagnostics)
  - blueprint validate (grouped)
  - universal edit-section + edit-rollback (version bump, isolated)
  - pipeline stages (7) w/ blueprint=done
  - build refused w/o approval (409)
  - Regression: legacy plan contract; /api/games public hub; assistant chat

Rules: no media generation, no publish, no build approval, no blueprint approve.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
FOUNDER = {"email": "stealth", "password": "Password1$"}
NON_FOUNDER = {"email": "tftwo", "password": "pass1234"}


# ── auth helpers ──────────────────────────────────────────────────────
def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def founder_headers():
    tok = _login(FOUNDER)
    if not tok:
        pytest.skip("founder login token missing")
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def non_founder_headers():
    try:
        tok = _login(NON_FOUNDER)
        return {"Authorization": f"Bearer {tok}"} if tok else None
    except AssertionError:
        return None


# ── registries overview ──────────────────────────────────────────────
class TestRegistries:
    def test_founder_sees_11_registries(self, founder_headers):
        r = requests.get(f"{BASE_URL}/api/orai/platform/registries", headers=founder_headers, timeout=15)
        assert r.status_code == 200, r.text[:200]
        regs = r.json()["registries"]
        names = {x["registry"] for x in regs}
        # 12 seeded + assets + projects = 14
        expected_seeded = {"runtimes", "renderers", "templates", "gameplay_systems", "economy",
                          "fire_hooks", "ai_capabilities", "validators", "plugins",
                          "creature_rpg_extensions", "asset_roles", "animation_states"}
        assert expected_seeded.issubset(names), f"missing: {expected_seeded - names}"
        assert "assets" in names and "projects" in names
        assert len(regs) == 14, f"expected 14 registries, got {len(regs)}: {names}"

    def test_non_founder_forbidden(self, non_founder_headers):
        if non_founder_headers is None:
            pytest.skip("no non-founder creds")
        r = requests.get(f"{BASE_URL}/api/orai/platform/registries", headers=non_founder_headers, timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}"

    def test_anonymous_unauthorised(self):
        r = requests.get(f"{BASE_URL}/api/orai/platform/registries", timeout=15)
        assert r.status_code in (401, 403)


# ── runtime catalog ─────────────────────────────────────────────────
class TestRuntimes:
    def test_35_families_with_maturity_counts(self, founder_headers):
        r = requests.get(f"{BASE_URL}/api/orai/platform/runtimes", headers=founder_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        fams = data["families"]
        assert len(fams) >= 35, f"expected >=35 families, got {len(fams)}"
        counts = data["counts"]
        for k in ("generatable", "partial", "foundation"):
            assert k in counts and counts[k] >= 1
        assert sum(counts.values()) == len(fams)


# ── recommend endpoint ─────────────────────────────────────────────
class TestRecommend:
    def test_tower_defense_positive(self, founder_headers):
        r = requests.post(f"{BASE_URL}/api/orai/platform/recommend",
                         headers=founder_headers,
                         json={"request": "a tower defense game where you place towers on a path to stop waves of enemies with upgrades",
                               "genres": ["tower defense"], "mechanics": ["towers", "waves", "pathing"]},
                         timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["recommended"] is not None
        assert d["recommended"]["family_id"] == "tower_defense"
        assert d["no_compatible_runtime"] is False

    def test_pure_rts_rejected(self, founder_headers):
        r = requests.post(f"{BASE_URL}/api/orai/platform/recommend",
                         headers=founder_headers,
                         json={"request": "a pure real-time strategy game with fog of war, real-time unit control, and base building against an AI opponent",
                               "genres": ["rts"], "mechanics": ["real-time strategy", "fog of war", "unit control", "base building"]},
                         timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        rejected_ids = {x["family_id"] for x in d.get("rejected", [])}
        assert "rts" in rejected_ids, f"rts should appear in rejected, got {rejected_ids}"
        # Must not force a substitute; either no_compatible_runtime=true OR recommendations flag it
        assert d["no_compatible_runtime"] is True or any(
            "foundation" in rec.lower() or "forced" in rec.lower() or "rts" in rec.lower()
            for rec in d.get("recommendations", [])
        ), f"expected rejection semantics, got no_comp={d['no_compatible_runtime']} recs={d['recommendations']}"


# ── registry versioning + rollback ──────────────────────────────────
class TestRegistryVersioning:
    def test_upsert_bumps_version_and_rollback(self, founder_headers):
        # Upsert 1
        payload = {"definition": {"label": "Coins", "kind": "in_game_soft",
                                 "reward_table": {"pickup": 3}},
                   "reason": "iter121 test — pickup=3"}
        r1 = requests.post(f"{BASE_URL}/api/orai/platform/registries/economy/coins",
                          headers=founder_headers, json=payload, timeout=15)
        assert r1.status_code == 200, r1.text[:200]
        v1 = r1.json()["version"]

        # GET verifies persistence
        r_get = requests.get(f"{BASE_URL}/api/orai/platform/registries/economy",
                            headers=founder_headers, timeout=15)
        assert r_get.status_code == 200
        entries = r_get.json()["entries"]
        assert "coins" in entries
        assert entries["coins"]["definition"]["reward_table"]["pickup"] == 3
        assert entries["coins"]["version"] == v1

        # Upsert 2 (bump)
        payload2 = {"definition": {"label": "Coins", "kind": "in_game_soft",
                                  "reward_table": {"pickup": 5}},
                    "reason": "iter121 — bump to 5"}
        r2 = requests.post(f"{BASE_URL}/api/orai/platform/registries/economy/coins",
                          headers=founder_headers, json=payload2, timeout=15)
        assert r2.status_code == 200
        v2 = r2.json()["version"]
        assert v2 > v1, f"version should bump: {v1} → {v2}"

        # Rollback to v1
        r_rb = requests.post(f"{BASE_URL}/api/orai/platform/registries/economy/coins/rollback",
                            headers=founder_headers, json={"version": v1}, timeout=15)
        assert r_rb.status_code == 200, r_rb.text[:200]
        v_rb = r_rb.json()["version"]
        assert v_rb > v2, "rollback should create a new version, not restore the number"

        # Verify content restored
        r_get2 = requests.get(f"{BASE_URL}/api/orai/platform/registries/economy",
                             headers=founder_headers, timeout=15)
        # cache TTL 15s — wait to be safe
        time.sleep(16)
        r_get2 = requests.get(f"{BASE_URL}/api/orai/platform/registries/economy",
                             headers=founder_headers, timeout=15)
        entries = r_get2.json()["entries"]
        assert entries["coins"]["definition"]["reward_table"]["pickup"] == 3, \
            f"rollback should restore pickup=3, got {entries['coins']['definition']}"


# ── multi-stage /plan + downstream blueprint ops ────────────────────
@pytest.fixture(scope="module")
def rhythm_blueprint(founder_headers):
    body = {"request": "a rhythm game where a robot drummer taps glowing beats",
            "complexity": 1, "ai_power": 3, "name": "TEST_iter121_rhythm"}
    r = requests.post(f"{BASE_URL}/api/orai/platform/plan",
                     headers=founder_headers, json=body, timeout=120)
    assert r.status_code == 200, f"plan failed: {r.status_code} {r.text[:400]}"
    bp = r.json().get("blueprint")
    assert bp, "plan returned no blueprint"
    return bp


class TestPlan:
    def test_15_stages_and_rhythm_family(self, rhythm_blueprint):
        bp = rhythm_blueprint
        stages = bp.get("planning_stages") or []
        assert len(stages) == 15, f"expected 15 planning stages, got {len(stages)}"
        stage_names = {s["stage"] for s in stages}
        for req in ("understand_request", "recommend_runtime", "blocker_check"):
            assert req in stage_names, f"missing stage {req}: {stage_names}"

    def test_platform_runtime_rhythm(self, rhythm_blueprint):
        assert rhythm_blueprint["platform"]["runtime_family"] == "rhythm"

    def test_grouped_validation_keys(self, rhythm_blueprint):
        gv = rhythm_blueprint["platform"]["grouped_validation"]
        for k in ("supported", "partially_supported", "missing", "recommendations"):
            assert k in gv, f"grouped_validation missing key: {k}"

    def test_diagnostics_no_media_no_build(self, rhythm_blueprint):
        diag = rhythm_blueprint.get("diagnostics") or {}
        # planner is planning-only; media/build must not have occurred
        assert diag.get("media_generated") in (False, None, 0)
        assert diag.get("build_started") in (False, None, 0)


class TestBlueprintOps:
    def test_validate_grouped(self, founder_headers, rhythm_blueprint):
        bid = rhythm_blueprint["id"]
        r = requests.post(f"{BASE_URL}/api/orai/platform/blueprints/{bid}/validate",
                         headers=founder_headers, timeout=30)
        assert r.status_code == 200, r.text[:300]
        v = r.json()["validation"]
        for k in ("supported", "partially_supported", "missing", "recommendations"):
            assert k in v

    def test_edit_section_and_rollback(self, founder_headers, rhythm_blueprint):
        bid = rhythm_blueprint["id"]
        v0 = rhythm_blueprint.get("version") or 1
        # snapshot the "enemies" section before
        r_before = requests.get(f"{BASE_URL}/api/orai/platform/blueprints/{bid}/pipeline",
                               headers=founder_headers, timeout=15)
        # actual before: fetch fresh from db via editor endpoint (edit-section returns new value)
        r_edit = requests.post(f"{BASE_URL}/api/orai/platform/blueprints/{bid}/edit-section",
                              headers=founder_headers,
                              json={"section": "enemies",
                                    "instruction": "add a laser drone enemy that dive-bombs the player"},
                              timeout=60)
        assert r_edit.status_code == 200, r_edit.text[:400]
        ed = r_edit.json()
        assert "edit_id" in ed and ed["edit_id"]
        assert ed["section"] == "enemies"
        assert ed["version"] > v0, f"version should bump after edit: {v0} → {ed['version']}"
        edit_id = ed["edit_id"]

        # Rollback
        r_rb = requests.post(f"{BASE_URL}/api/orai/platform/blueprints/{bid}/edit-rollback",
                            headers=founder_headers,
                            json={"edit_id": edit_id}, timeout=30)
        assert r_rb.status_code == 200, r_rb.text[:400]
        rb = r_rb.json()
        assert rb["rolled_back"] == edit_id
        assert rb["section"] == "enemies"
        assert rb["version"] > ed["version"]

    def test_pipeline_7_stages_blueprint_done(self, founder_headers, rhythm_blueprint):
        bid = rhythm_blueprint["id"]
        r = requests.get(f"{BASE_URL}/api/orai/platform/blueprints/{bid}/pipeline",
                        headers=founder_headers, timeout=15)
        assert r.status_code == 200, r.text[:300]
        p = r.json()
        assert p["total"] == 7, f"expected 7 pipeline stages, got {p['total']}"
        assert len(p["stages"]) == 7
        bp_stage = next((s for s in p["stages"] if s["id"] == "blueprint"), None)
        assert bp_stage and bp_stage["status"] == "done"

    def test_build_without_approval_409(self, founder_headers, rhythm_blueprint):
        bid = rhythm_blueprint["id"]
        r = requests.post(f"{BASE_URL}/api/orai/platform/blueprints/{bid}/build",
                         headers=founder_headers, timeout=15)
        assert r.status_code == 409, f"expected 409 approval gate, got {r.status_code} {r.text[:200]}"


# ── regression: legacy contract preserved ───────────────────────────
class TestLegacyRegression:
    def test_legacy_projects_blueprints_plan_contract(self, founder_headers):
        r = requests.post(f"{BASE_URL}/api/orai/projects/blueprints/plan",
                         headers=founder_headers,
                         json={"request": "a tiny top-down collect-apples arcade game",
                               "complexity": 1, "ai_power": 2,
                               "name": "TEST_iter121_legacy"},
                         timeout=120)
        assert r.status_code == 200, f"legacy plan broken: {r.status_code} {r.text[:300]}"
        d = r.json()
        # Wrapper contract: {"blueprint": <doc>} where doc contains the legacy fields
        assert "blueprint" in d, f"top-level 'blueprint' key missing: {list(d)}"
        doc = d["blueprint"]
        for k in ("id", "blueprint", "runtime_recommendation", "selected_runtime",
                  "mechanics_support", "asset_requirements", "validation", "diagnostics"):
            assert k in doc, f"legacy plan doc missing key: {k}; got keys={list(doc)}"

    def test_public_games_hub(self, founder_headers):
        # /api/games requires an authenticated user (CurrentUser dep) — treat as
        # regression by hitting with founder token; hub itself is the public list
        r = requests.get(f"{BASE_URL}/api/games", headers=founder_headers, timeout=20)
        assert r.status_code == 200
        # tolerate list or {games:[...]}
        payload = r.json()
        games = payload if isinstance(payload, list) else payload.get("games") or payload.get("items") or []
        assert isinstance(games, list)
        assert len(games) >= 20, f"expected ~28 published games; got {len(games)}"

    def test_assistant_chat_openai(self, founder_headers):
        r = requests.post(f"{BASE_URL}/api/orai/assistant/chat",
                         headers=founder_headers,
                         json={"message": "Reply with only: ok."}, timeout=60)
        assert r.status_code == 200, f"assistant chat broken: {r.status_code} {r.text[:200]}"
        d = r.json()
        # provider field is expected per request; tolerate slight shape variance
        provider = d.get("provider") or (d.get("meta") or {}).get("provider")
        assert provider == "openai", f"expected provider=openai, got {provider}; keys={list(d)[:8]}"
