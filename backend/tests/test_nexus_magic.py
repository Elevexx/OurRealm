"""Nexus AI Magic Loop backend tests — founder-only, ZERO paid calls.
All runs use deterministic-local proposer (improve_draft / animation_style /
runtime_style / clone_variant) or explicit settings.mock=true for living_editor.
Never calls /api/nexus/orai/propose (real LLM) and never Meshy or image gens."""
import os
import time
import copy
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"

FOUNDER = {"email": "stealth", "password": "Password1$"}
MEMBER = {"email": "tftwo", "password": "pass1234"}


def _login(session, creds):
    r = session.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login {creds['email']}: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        session.headers.update({"Authorization": f"Bearer {tok}"})
    return session


@pytest.fixture(scope="module")
def founder():
    return _login(requests.Session(), FOUNDER)


@pytest.fixture(scope="module")
def member():
    return _login(requests.Session(), MEMBER)


@pytest.fixture(scope="module")
def draft_snapshot(founder):
    r = founder.get(f"{API}/nexus/world?draft=1", timeout=15)
    assert r.status_code == 200
    return r.json()["world"]


@pytest.fixture(scope="module")
def entity_targets(draft_snapshot):
    """Pick 2 entity targets from the plaza zone."""
    zone = next(z for z in draft_snapshot["zones"] if z["id"] == "plaza")
    ents = zone["entities"][:2]
    assert len(ents) >= 2, "need at least 2 entities in plaza draft"
    return [{"kind": "entity", "zone_id": "plaza", "entity_id": e["id"]} for e in ents]


def _wait_for_status(founder, rid, wanted, timeout=25):
    """Poll /magic/runs until run reaches one of `wanted` statuses. Returns run dict."""
    if isinstance(wanted, str):
        wanted = {wanted}
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = founder.get(f"{API}/nexus/magic/runs", timeout=10)
        assert r.status_code == 200
        runs = r.json()["runs"]
        this = next((x for x in runs if x["id"] == rid), None)
        if this:
            last = this
            if this["status"] in wanted:
                return this
        time.sleep(0.8)
    raise AssertionError(f"run {rid} did not reach {wanted}; last={last}")


# ── founder gate ──────────────────────────────────────────
class TestFounderGate:
    @pytest.mark.parametrize("method,path,body", [
        ("GET", "/nexus/magic/config", None),
        ("GET", "/nexus/magic/runs", None),
        ("GET", "/nexus/magic/variants", None),
        ("GET", "/nexus/admin/presence", None),
        ("POST", "/nexus/magic/estimate", {"mode": "improve_draft", "targets": []}),
        ("POST", "/nexus/magic/start", {"mode": "improve_draft", "targets": []}),
        ("POST", "/nexus/magic/control-all", {"action": "stop"}),
        ("POST", "/nexus/admin/save-version", {}),
    ])
    def test_member_forbidden(self, member, method, path, body):
        r = member.request(method, API + path, json=body, timeout=15)
        assert r.status_code == 403, f"{method} {path} -> {r.status_code}"

    def test_founder_ok_config(self, founder):
        r = founder.get(f"{API}/nexus/magic/config", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "improve_draft" in d["modes"]
        assert d["stages"] == ["build", "review", "compare", "improve", "verify"]


# ── estimate ─────────────────────────────────────────────
class TestEstimate:
    def test_estimate_improve_draft_zero_credits(self, founder, entity_targets):
        r = founder.post(f"{API}/nexus/magic/estimate",
                         json={"mode": "improve_draft", "targets": entity_targets, "settings": {}},
                         timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["provider_calls"]["orai_llm"] == 0
        assert d["provider_calls"]["meshy"] == 0
        assert d["credits"]["meshy"] == 0
        assert d["credits"]["image"] == 0
        assert "deterministic" in d["note"].lower() or "0 credits" in d["note"].lower() or "zero" in d["note"].lower()

    def test_estimate_unknown_mode_400(self, founder, entity_targets):
        r = founder.post(f"{API}/nexus/magic/estimate",
                         json={"mode": "no_such_mode", "targets": entity_targets}, timeout=15)
        assert r.status_code == 400

    def test_estimate_invalid_target_400(self, founder):
        r = founder.post(f"{API}/nexus/magic/estimate",
                         json={"mode": "improve_draft",
                               "targets": [{"kind": "entity", "zone_id": "plaza",
                                            "entity_id": "e_does_not_exist"}]}, timeout=15)
        assert r.status_code == 400


# ── run lifecycle: improve_draft ─────────────────────────
class TestImproveDraftLifecycle:
    def test_full_run_and_approve_draft_only(self, founder, entity_targets, draft_snapshot):
        # baseline: published version + entity byte states
        vr = founder.get(f"{API}/nexus/admin/versions", timeout=15).json()
        pub_before = vr["published_version"]
        # capture full draft entity lists per zone
        before_zones = {z["id"]: copy.deepcopy(z["entities"]) for z in draft_snapshot["zones"]}
        selected_eids = {t["entity_id"] for t in entity_targets}

        # start
        r = founder.post(f"{API}/nexus/magic/start",
                         json={"mode": "improve_draft", "targets": entity_targets,
                               "settings": {}, "label": "TEST_improve_draft"}, timeout=15)
        assert r.status_code == 200, r.text
        rid = r.json()["run"]["id"]

        # poll to awaiting_approval
        run = _wait_for_status(founder, rid, "awaiting_approval", timeout=30)
        assert run["stages_done"] == 5
        stages = [s["stage"] for s in run["stage_history"]]
        for st in ("build", "review", "compare", "verify"):
            assert st in stages, f"missing stage {st}: {stages}"
        assert run["provider_usage"]["openai_calls"] == 0
        assert run["provider_usage"]["orai_calls"] == 0
        assert run["score"] is not None and run["score"] <= 95

        # decide approve
        r = founder.post(f"{API}/nexus/magic/runs/{rid}/decide",
                         json={"approve": True}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "applied"

        # published must be untouched
        vr2 = founder.get(f"{API}/nexus/admin/versions", timeout=15).json()
        assert vr2["published_version"] == pub_before, "publish moved on magic apply!"

        # only selected entities changed
        wr = founder.get(f"{API}/nexus/world?draft=1", timeout=15).json()
        after_zones = {z["id"]: z["entities"] for z in wr["world"]["zones"]}
        for zid, before_ents in before_zones.items():
            after_ents = after_zones.get(zid, [])
            for e_before in before_ents:
                if e_before["id"] in selected_eids:
                    continue
                e_after = next((x for x in after_ents if x["id"] == e_before["id"]), None)
                assert e_after == e_before, (
                    f"unselected entity {e_before['id']} in zone {zid} changed unexpectedly")


# ── pause / resume / stop ────────────────────────────────
class TestControl:
    def test_pause_resume(self, founder, entity_targets):
        r = founder.post(f"{API}/nexus/magic/start",
                         json={"mode": "improve_draft", "targets": entity_targets,
                               "settings": {}}, timeout=15)
        assert r.status_code == 200
        rid = r.json()["run"]["id"]
        # pause immediately
        r = founder.post(f"{API}/nexus/magic/runs/{rid}/control",
                         json={"action": "pause"}, timeout=15)
        assert r.status_code == 200
        # give it time to observe pause (control loop sleeps up to 1s per stage)
        time.sleep(3.5)
        r = founder.get(f"{API}/nexus/magic/runs", timeout=15)
        run = next(x for x in r.json()["runs"] if x["id"] == rid)
        assert run["status"] in ("paused", "awaiting_approval", "applied", "running"), run["status"]
        # Note: if the run already finished all stages before pause was observed, status may not be paused
        # Resume and wait for terminal
        founder.post(f"{API}/nexus/magic/runs/{rid}/control",
                     json={"action": "resume"}, timeout=15)
        run = _wait_for_status(founder, rid, {"awaiting_approval", "applied", "completed"}, timeout=25)
        # reject to keep draft clean
        if run["status"] == "awaiting_approval":
            founder.post(f"{API}/nexus/magic/runs/{rid}/decide", json={"approve": False}, timeout=15)

    def test_stop_and_control_all(self, founder, entity_targets):
        r = founder.post(f"{API}/nexus/magic/start",
                         json={"mode": "improve_draft", "targets": entity_targets,
                               "settings": {}}, timeout=15)
        rid = r.json()["run"]["id"]
        # control-all stop
        r = founder.post(f"{API}/nexus/magic/control-all",
                         json={"action": "stop"}, timeout=15)
        assert r.status_code == 200
        # give engine time to observe control=stop
        run = _wait_for_status(founder, rid,
                               {"stopped", "awaiting_approval", "applied", "completed"}, timeout=20)
        # Either stopped (fast) or already completed before signal observed — both are honest
        assert run["status"] in ("stopped", "awaiting_approval", "applied", "completed")
        if run["status"] == "awaiting_approval":
            founder.post(f"{API}/nexus/magic/runs/{rid}/decide", json={"approve": False}, timeout=15)


# ── clone_variant ────────────────────────────────────────
class TestCloneVariant:
    def test_clone_and_load(self, founder):
        # start clone_variant on zone target
        label = f"TEST_clone_{int(time.time())}"
        r = founder.post(f"{API}/nexus/magic/start", json={
            "mode": "clone_variant",
            "targets": [{"kind": "zone", "zone_id": "plaza"}],
            "settings": {}, "label": label}, timeout=15)
        assert r.status_code == 200, r.text
        rid = r.json()["run"]["id"]
        run = _wait_for_status(founder, rid, {"completed", "awaiting_approval"}, timeout=20)
        assert run["status"] == "completed", f"clone_variant should end 'completed', got {run['status']}"

        # variant present
        vr = founder.get(f"{API}/nexus/magic/variants", timeout=15).json()
        var = next((v for v in vr["variants"] if v.get("kind") == "clone"), None)
        assert var is not None, "no clone variant appeared"

        # load variant
        pre = founder.get(f"{API}/nexus/admin/versions", timeout=15).json()
        r = founder.post(f"{API}/nexus/magic/variants/{var['id']}/load", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "backup_variant_id" in d
        post = founder.get(f"{API}/nexus/admin/versions", timeout=15).json()
        assert post["draft_version"] > pre["draft_version"]
        # auto_backup listed
        vr2 = founder.get(f"{API}/nexus/magic/variants", timeout=15).json()
        assert any(v.get("kind") == "auto_backup" for v in vr2["variants"])


# ── dry run ──────────────────────────────────────────────
class TestDryRun:
    def test_dry_run_completes_not_appliable(self, founder, entity_targets):
        r = founder.post(f"{API}/nexus/magic/start", json={
            "mode": "improve_draft", "targets": entity_targets,
            "settings": {"dry_run": True}}, timeout=15)
        rid = r.json()["run"]["id"]
        run = _wait_for_status(founder, rid, "completed", timeout=25)
        assert run["status"] == "completed"
        # decide should fail
        r = founder.post(f"{API}/nexus/magic/runs/{rid}/decide",
                         json={"approve": True}, timeout=15)
        assert r.status_code in (400, 404)


# ── founder_max clamps ───────────────────────────────────
class TestFounderMax:
    def test_founder_max_accepts_higher_stop(self, founder, entity_targets):
        r = founder.post(f"{API}/nexus/magic/estimate", json={
            "mode": "improve_draft", "targets": entity_targets,
            "settings": {"founder_max": True, "stop_score": 99,
                         "max_attempts": 5, "repair_cycles": 3}}, timeout=15)
        assert r.status_code == 200
        s = r.json()["settings"]
        assert s["founder_max"] is True
        assert s["stop_score"] == 99
        assert s["repair_cycles"] == 3

    def test_normal_clamps_stop_score(self, founder, entity_targets):
        r = founder.post(f"{API}/nexus/magic/estimate", json={
            "mode": "improve_draft", "targets": entity_targets,
            "settings": {"stop_score": 99}}, timeout=15)
        s = r.json()["settings"]
        assert s["stop_score"] <= 95


# ── animation / runtime styles ───────────────────────────
class TestStyles:
    def _find_entity(self, founder, etype):
        wr = founder.get(f"{API}/nexus/world?draft=1", timeout=15).json()
        for z in wr["world"]["zones"]:
            for e in z["entities"]:
                if e["type"] == etype:
                    return z["id"], e["id"]
        return None, None

    def test_animation_portal_spin_fast(self, founder):
        zid, eid = self._find_entity(founder, "portal")
        if not eid:
            pytest.skip("no portal entity in draft")
        r = founder.post(f"{API}/nexus/magic/start", json={
            "mode": "animation_style", "style": "portal_spin_fast",
            "targets": [{"kind": "entity", "zone_id": zid, "entity_id": eid}]}, timeout=15)
        assert r.status_code == 200, r.text
        rid = r.json()["run"]["id"]
        run = _wait_for_status(founder, rid, "awaiting_approval", timeout=25)
        ops = run["result"]["ops"]
        assert any(o["op"] == "update_entity" and o["fields"].get("props", {}).get("spin") for o in ops)
        # reject to keep clean
        founder.post(f"{API}/nexus/magic/runs/{rid}/decide", json={"approve": False}, timeout=15)

    def test_animation_unsupported_400(self, founder):
        zid, eid = self._find_entity(founder, "portal")
        if not eid:
            pytest.skip("no portal entity")
        r = founder.post(f"{API}/nexus/magic/start", json={
            "mode": "animation_style", "style": "avatar_gait",
            "targets": [{"kind": "entity", "zone_id": zid, "entity_id": eid}]}, timeout=15)
        assert r.status_code == 400
        assert "not supported" in r.text.lower() or "avatar" in r.text.lower()

    def test_runtime_neon_dusk(self, founder):
        r = founder.post(f"{API}/nexus/magic/start", json={
            "mode": "runtime_style", "style": "neon_dusk",
            "targets": [{"kind": "zone", "zone_id": "plaza"}]}, timeout=15)
        assert r.status_code == 200
        rid = r.json()["run"]["id"]
        run = _wait_for_status(founder, rid, "awaiting_approval", timeout=25)
        ops = run["result"]["ops"]
        assert any(o["op"] == "update_zone" and o["zone_id"] == "plaza" for o in ops)
        founder.post(f"{API}/nexus/magic/runs/{rid}/decide", json={"approve": False}, timeout=15)

    def test_runtime_unsupported_400(self, founder):
        r = founder.post(f"{API}/nexus/magic/start", json={
            "mode": "runtime_style", "style": "pbr_daylight",
            "targets": [{"kind": "zone", "zone_id": "plaza"}]}, timeout=15)
        assert r.status_code == 400


# ── living_editor MOCK ONLY (never without mock:true) ────
class TestLivingEditorMock:
    def test_living_editor_mock_adds_entity(self, founder):
        r = founder.post(f"{API}/nexus/magic/start", json={
            "mode": "living_editor",
            "request": "add a test kiosk",
            "settings": {"mock": True},
            "targets": [{"kind": "zone", "zone_id": "plaza"}]}, timeout=15)
        assert r.status_code == 200, r.text
        rid = r.json()["run"]["id"]
        run = _wait_for_status(founder, rid, "awaiting_approval", timeout=25)
        assert run["provider_usage"]["openai_calls"] == 0, "MOCK must not call LLM"
        ops = run["result"]["ops"]
        assert any(o["op"] == "add_entity" for o in ops), f"expected add_entity op: {ops}"
        # reject
        founder.post(f"{API}/nexus/magic/runs/{rid}/decide", json={"approve": False}, timeout=15)


# ── save-version + audit ─────────────────────────────────
class TestSaveVersionAndAudit:
    def test_save_version_and_rollback(self, founder):
        r = founder.post(f"{API}/nexus/admin/save-version",
                         json={"label": "TEST_manual_save"}, timeout=15)
        assert r.status_code == 200
        ver = r.json()["version"]
        assert ver >= 1001

        r = founder.get(f"{API}/nexus/admin/versions", timeout=15)
        vs = r.json()["versions"]
        our = next((v for v in vs if v["version"] == ver), None)
        assert our is not None
        assert our.get("kind") == "manual"

        # rollback into draft (published untouched)
        pub_before = r.json()["published_version"]
        r = founder.post(f"{API}/nexus/admin/rollback",
                         json={"version": ver}, timeout=15)
        assert r.status_code == 200
        r = founder.get(f"{API}/nexus/admin/versions", timeout=15).json()
        assert r["published_version"] == pub_before

    def test_audit_has_magic_actions(self, founder):
        r = founder.get(f"{API}/nexus/admin/audit", timeout=15)
        assert r.status_code == 200
        actions = {a["action"] for a in r.json()["audit"]}
        # From tests above we should have several of these
        expected_any = {"magic_start", "magic_apply", "magic_pause", "save_version", "variant_load"}
        assert actions & expected_any, f"no magic audit actions found: {actions}"
