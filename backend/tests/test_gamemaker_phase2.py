"""Phase 2 tests — versioned registries, pinning, lifecycle, immutability,
rollback, disable guard, contract tests, compat reports, permissions.
Mocked/no-provider only — nothing here spends provider credits."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
REG = f"{API}/admin/gamemaker/registry"


def _login(email):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": "Password1$"}, timeout=15)
    assert r.status_code == 200, r.text[:200]
    s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    return s


@pytest.fixture(scope="module")
def founder():
    return _login("stealth")


@pytest.fixture(scope="module")
def member():
    return _login("auditcheckreal")


def _wait_job(s, job_id, timeout=60):
    for _ in range(timeout):
        j = s.get(f"{API}/jobs/{job_id}", timeout=15).json()
        j = j.get("job") or j
        if j["phase"] in ("completed", "failed", "cancelled"):
            j["status"] = j["phase"]
            return j
        time.sleep(1)
    raise AssertionError(f"job {job_id} did not finish")


# ─── Seeded registry ──────────────────────────────────────────────────────

def test_overview_seeded(founder):
    r = founder.get(f"{REG}/overview", timeout=20)
    assert r.status_code == 200, r.text[:300]
    ov = r.json()
    assert len(ov["engine"]) == 2
    assert len(ov["runtime"]) == 26
    assert len(ov["pipeline"]) == 5
    assert len(ov["schema"]) >= 28
    rt = {x["key"]: x for x in ov["runtime"]}
    assert rt["platformer"]["versions"][0]["status"] == "live"
    # Truthful: planned runtimes seed as draft, not live
    assert rt["open_world_rpg"]["versions"][0]["status"] == "draft"
    assert rt["shooter"]["versions"][0]["status"] == "draft"


def test_planned_runtime_capabilities_all_false(founder):
    d = founder.get(f"{REG}/runtime/shooter", timeout=15).json()
    caps = d["versions"][0]["definition"]["capabilities"]
    assert caps and not any(caps.values()), "planned runtime must not claim any capability"


def test_inventory(founder):
    inv = founder.get(f"{REG}/inventory", timeout=30).json()
    assert inv["games_total"] >= 60
    assert "platformer" in inv["implemented_runtimes"]
    assert set(inv["planned_runtimes"]) == {"open_world_rpg", "shooter"}
    unmapped = [g for g in inv["games"] if not g["mapped_runtime"]]
    for g in unmapped:
        assert "review" in g["mapping_reason"] or "skipped" in g["mapping_reason"]


# ─── Migration: preview → apply (job) → rollback ─────────────────────────

def test_migration_preview_apply_rollback(founder):
    # self-reset: roll back any pins left by previous runs (via audit run_ids)
    audit = founder.get(f"{REG}/audit", timeout=15).json()["audit"]
    for a in audit:
        if a["action"] == "migration_applied" and a["details"].get("run_id"):
            founder.post(f"{REG}/migration/rollback", json={"run_id": a["details"]["run_id"]}, timeout=20)
    pv = founder.get(f"{REG}/migration/preview", timeout=30).json()
    assert pv["will_pin"] > 0
    run_id = uuid.uuid4().hex
    r = founder.post(f"{REG}/migration/apply", json={"run_id": run_id}, timeout=20)
    assert r.status_code == 200
    j = _wait_job(founder, r.json()["job_id"])
    assert j["status"] == "completed", j.get("error")
    assert j["result"]["pinned"] == pv["will_pin"]
    # game docs untouched — preview now shows already-pinned
    pv2 = founder.get(f"{REG}/migration/preview", timeout=30).json()
    assert pv2["will_pin"] == 0
    # idempotent replay
    r2 = founder.post(f"{REG}/migration/apply", json={"run_id": run_id}, timeout=20)
    j2 = _wait_job(founder, r2.json()["job_id"])
    assert j2["status"] == "completed"
    # pinned games visible per version
    g = founder.get(f"{REG}/runtime/platformer/versions/1/games", timeout=15).json()["games"]
    assert len(g) >= 1
    # rollback deactivates exactly this run
    rb = founder.post(f"{REG}/migration/rollback", json={"run_id": run_id}, timeout=20).json()
    assert rb["deactivated"] == pv["will_pin"]
    pv3 = founder.get(f"{REG}/migration/preview", timeout=30).json()
    assert pv3["will_pin"] == pv["will_pin"]
    # re-apply for the rest of the suite (fresh run)
    r3 = founder.post(f"{REG}/migration/apply", json={"run_id": uuid.uuid4().hex}, timeout=20)
    assert _wait_job(founder, r3.json()["job_id"])["status"] == "completed"


# ─── Lifecycle, immutability, truthfulness ───────────────────────────────

def test_clone_edit_contract_promote_lifecycle(founder):
    # clone platformer → new draft version
    r = founder.post(f"{REG}/runtime/platformer/versions", json={}, timeout=15)
    assert r.status_code == 200
    v = r.json()["version"]["version"]
    assert v >= 2
    # draft editable
    r = founder.patch(f"{REG}/runtime/platformer/versions/{v}",
                      json={"capabilities": {"physics_platforming": True, "realtime_movement": True,
                                             "saves_progress": True, "mobile_touch": True, "keyboard": True}}, timeout=15)
    assert r.status_code == 200
    # released (v1 live) immutable
    r = founder.patch(f"{REG}/runtime/platformer/versions/1", json={"capabilities": {}}, timeout=15)
    assert r.status_code == 400 and "immutable" in r.json()["detail"]
    # promote to beta blocked until contract test passes
    r = founder.post(f"{REG}/runtime/platformer/versions/{v}/promote", json={"to": "internal"}, timeout=15)
    assert r.status_code == 200
    r = founder.post(f"{REG}/runtime/platformer/versions/{v}/promote", json={"to": "beta"}, timeout=15)
    assert r.status_code == 400 and "Contract tests" in r.json()["detail"]
    # run contract tests (persistent job)
    r = founder.post(f"{REG}/runtime/platformer/versions/{v}/contract-test", json={}, timeout=15)
    j = _wait_job(founder, r.json()["job_id"])
    assert j["status"] == "completed" and j["result"]["passed"], j["result"]
    # now promotes
    assert founder.post(f"{REG}/runtime/platformer/versions/{v}/promote", json={"to": "beta"}, timeout=15).status_code == 200
    # sequential enforcement: draft can't jump to live
    r = founder.post(f"{REG}/runtime/shooter/versions/1/promote", json={"to": "live"}, timeout=15)
    assert r.status_code == 400


def test_untruthful_capability_fails_contract(founder):
    # clone match3, lie about boss_fights → contract test must FAIL
    r = founder.post(f"{REG}/runtime/match3/versions", json={}, timeout=15)
    v = r.json()["version"]["version"]
    founder.patch(f"{REG}/runtime/match3/versions/{v}",
                  json={"capabilities": {"grid_puzzle": True, "boss_fights": True,
                                         "saves_progress": True, "mobile_touch": True, "keyboard": True}}, timeout=15)
    r = founder.post(f"{REG}/runtime/match3/versions/{v}/contract-test", json={}, timeout=15)
    j = _wait_job(founder, r.json()["job_id"])
    assert j["status"] == "completed" and not j["result"]["passed"]
    truth = next(c for c in j["result"]["checks"] if c["check"] == "capability_truthfulness")
    assert not truth["passed"] and "boss_fights" in truth["detail"]
    # and promotion to beta stays blocked
    founder.post(f"{REG}/runtime/match3/versions/{v}/promote", json={"to": "internal"}, timeout=15)
    r = founder.post(f"{REG}/runtime/match3/versions/{v}/promote", json={"to": "beta"}, timeout=15)
    assert r.status_code == 400


def test_rollback_version(founder):
    # promote platformer v2 (beta from earlier test) to live, then roll back to v1
    ov = founder.get(f"{REG}/runtime/platformer", timeout=15).json()
    v2 = next(v for v in ov["versions"] if v["version"] >= 2 and v["status"] == "beta")["version"]
    assert founder.post(f"{REG}/runtime/platformer/versions/{v2}/promote", json={"to": "live"}, timeout=15).status_code == 200
    ov = founder.get(f"{REG}/runtime/platformer", timeout=15).json()
    assert next(v for v in ov["versions"] if v["version"] == 1)["status"] == "beta"  # demoted
    r = founder.post(f"{REG}/runtime/platformer/rollback", json={"to_version": 1}, timeout=15)
    assert r.status_code == 200 and r.json()["live_version"] == 1
    ov = founder.get(f"{REG}/runtime/platformer", timeout=15).json()
    assert next(v for v in ov["versions"] if v["version"] == 1)["status"] == "live"
    assert next(v for v in ov["versions"] if v["version"] == v2)["status"] == "beta"


def test_compat_report(founder):
    ov = founder.get(f"{REG}/runtime/match3", timeout=15).json()
    v2 = max(v["version"] for v in ov["versions"])
    r = founder.get(f"{REG}/runtime/match3/compare", params={"v_from": 1, "v_to": v2}, timeout=15)
    assert r.status_code == 200
    rep = r.json()
    assert "boss_fights" in (rep["diff"].get("capabilities_added") or [])
    assert "affected_games_on_from" in rep


# ─── Disable = new use blocked, existing games untouched ─────────────────

def test_disable_blocks_new_use_not_existing(founder):
    # racing: pinned games exist; disable item
    before = founder.get(f"{REG}/runtime/racing/versions/1/games", timeout=15).json()["games"]
    r = founder.post(f"{REG}/runtime/racing/item-disable", json={"disabled": True}, timeout=15)
    assert r.status_code == 200
    # new quote for racing blocked
    q = founder.post(f"{API}/gamemaker/quote",
                     json={"idea": "test racing game", "runtime": "racing", "style": "pixel_art",
                           "ai_power": 1, "economy": 1}, timeout=20)
    assert q.status_code == 400 and "disabled" in q.json()["detail"]
    # existing pins untouched; game docs unchanged
    after = founder.get(f"{REG}/runtime/racing/versions/1/games", timeout=15).json()["games"]
    assert len(after) == len(before)
    # re-enable and quote works again
    founder.post(f"{REG}/runtime/racing/item-disable", json={"disabled": False}, timeout=15)
    q2 = founder.post(f"{API}/gamemaker/quote",
                      json={"idea": "test racing game", "runtime": "racing", "style": "pixel_art",
                            "ai_power": 1, "economy": 1}, timeout=20)
    assert q2.status_code == 200


# ─── Sandbox demo (job, clones real spec, no providers) ──────────────────

def test_sandbox_demo_job(founder):
    r = founder.post(f"{REG}/runtime/platformer/versions/1/sandbox-demo", json={}, timeout=15)
    j = _wait_job(founder, r.json()["job_id"], timeout=90)
    assert j["status"] == "completed", j.get("error")
    gid = j["result"]["game_id"]
    saved = founder.get(f"{API}/gamemaker/saved", timeout=20).json()["games"]
    assert any(g["id"] == gid for g in saved)
    # cleanup: archive the sandbox demo game record
    import pymongo  # noqa: F401 — not available; cleanup via API not needed (sandbox flagged)


def test_sandbox_demo_planned_runtime_fails_honestly(founder):
    r = founder.post(f"{REG}/runtime/shooter/versions/1/sandbox-demo", json={}, timeout=15)
    j = _wait_job(founder, r.json()["job_id"], timeout=60)
    assert j["status"] == "failed"
    assert "reference game" in (j.get("error") or "")


# ─── Permissions ──────────────────────────────────────────────────────────

def test_member_cannot_access_registry(member):
    for path in ["/overview", "/inventory", "/migration/preview"]:
        assert member.get(f"{REG}{path}", timeout=15).status_code == 403
    assert member.post(f"{REG}/runtime/platformer/versions", json={}, timeout=15).status_code == 403
    assert member.post(f"{REG}/migration/apply", json={}, timeout=15).status_code == 403


def test_anon_cannot_access_registry():
    r = requests.get(f"{REG}/overview", timeout=15)
    assert r.status_code == 401
