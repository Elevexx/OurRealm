"""Nexus V1 Phase 1 backend tests — public/world, presence, positions,
founder admin ops (publish/rollback/audit), and ORAi propose/decide."""
import os
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"

FOUNDER = {"email": "stealth", "password": "Password1$"}
MEMBER = {"email": "tftwo", "password": "pass1234"}


def _login(session, creds):
    r = session.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {creds['email']}: {r.status_code} {r.text[:200]}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    if tok:
        session.headers.update({"Authorization": f"Bearer {tok}"})
    return session


@pytest.fixture(scope="module")
def founder():
    s = requests.Session()
    return _login(s, FOUNDER)


@pytest.fixture(scope="module")
def member():
    s = requests.Session()
    return _login(s, MEMBER)


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


# ─── public & world ─────────────────────────────────────────
class TestPublicWorld:
    def test_public_unauth(self, anon):
        r = anon.get(f"{API}/nexus/public", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "online" in d and isinstance(d["online"], int)
        assert "zones" in d and len(d["zones"]) >= 1
        assert "systems" in d

    def test_world_requires_auth(self, anon):
        r = anon.get(f"{API}/nexus/world", timeout=15)
        assert r.status_code in (401, 403)

    def test_world_published_ok_for_member(self, member):
        r = member.get(f"{API}/nexus/world", timeout=15)
        assert r.status_code == 200
        assert r.json().get("state") == "published"

    def test_world_draft_forbidden_for_member(self, member):
        r = member.get(f"{API}/nexus/world?draft=1", timeout=15)
        assert r.status_code == 403

    def test_world_draft_ok_for_founder(self, founder):
        r = founder.get(f"{API}/nexus/world?draft=1", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("state") == "draft"
        assert "world" in d and "zones" in d["world"]


# ─── admin endpoints founder-gated ──────────────────────────
class TestAdminGate:
    @pytest.mark.parametrize("path,method,body", [
        ("/nexus/admin/ops", "POST", {"ops": []}),
        ("/nexus/admin/publish", "POST", {}),
        ("/nexus/admin/versions", "GET", None),
        ("/nexus/admin/rollback", "POST", {"version": 1}),
        ("/nexus/admin/audit", "GET", None),
        ("/nexus/orai/propose", "POST", {"request": "x"}),
        ("/nexus/orai/decide", "POST", {"proposal_id": "x", "approve": False}),
        ("/nexus/orai/proposals", "GET", None),
    ])
    def test_member_forbidden(self, member, path, method, body):
        url = API + path
        r = member.request(method, url, json=body, timeout=15) if body is not None else member.request(method, url, timeout=15)
        assert r.status_code == 403, f"{method} {path} expected 403 got {r.status_code}"


# ─── presence validation ────────────────────────────────────
class TestPresence:
    def test_out_of_bounds_400(self, founder):
        # wait to avoid rate limit
        time.sleep(0.2)
        r = founder.post(f"{API}/nexus/presence",
                         json={"zone_id": "plaza", "x": 999, "y": 1, "z": 0}, timeout=15)
        assert r.status_code == 400

    def test_unknown_zone_400(self, founder):
        time.sleep(0.2)
        r = founder.post(f"{API}/nexus/presence",
                         json={"zone_id": "nope", "x": 0, "y": 1, "z": 0}, timeout=15)
        assert r.status_code == 400

    def test_rate_limit_429(self, founder):
        time.sleep(0.2)
        r1 = founder.post(f"{API}/nexus/presence",
                          json={"zone_id": "plaza", "x": 0, "y": 1, "z": 0}, timeout=15)
        r2 = founder.post(f"{API}/nexus/presence",
                          json={"zone_id": "plaza", "x": 0.1, "y": 1, "z": 0.1}, timeout=15)
        assert r1.status_code == 200
        assert r2.status_code == 429

    def test_teleport_snapback(self, founder):
        time.sleep(0.2)
        r1 = founder.post(f"{API}/nexus/presence",
                          json={"zone_id": "plaza", "x": 0, "y": 1, "z": 0}, timeout=15)
        assert r1.status_code == 200
        time.sleep(0.25)
        # jump far away should be snapped back
        r2 = founder.post(f"{API}/nexus/presence",
                          json={"zone_id": "plaza", "x": 30, "y": 1, "z": 30}, timeout=15)
        assert r2.status_code == 200
        self_p = r2.json().get("self", {})
        assert abs(self_p["x"]) < 5 and abs(self_p["z"]) < 5, f"teleport not rejected: {self_p}"

    def test_two_users_see_each_other(self, founder, member):
        time.sleep(0.2)
        founder.post(f"{API}/nexus/presence",
                     json={"zone_id": "plaza", "x": 2, "y": 1, "z": 2}, timeout=15)
        time.sleep(0.2)
        r = member.post(f"{API}/nexus/presence",
                        json={"zone_id": "plaza", "x": -2, "y": 1, "z": -2}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["online"] >= 2, f"online={d['online']}"
        assert any(p.get("username") == "stealth" for p in d.get("players", [])), \
            f"stealth not in players list: {d['players']}"


# ─── position persistence ───────────────────────────────────
class TestPosition:
    def test_save_and_get(self, member):
        r = member.post(f"{API}/nexus/position/save",
                        json={"zone_id": "plaza", "x": 5.5, "y": 1, "z": -3.25, "ry": 0.5}, timeout=15)
        assert r.status_code == 200
        r2 = member.get(f"{API}/nexus/position", timeout=15)
        assert r2.status_code == 200
        pos = r2.json().get("position")
        assert pos and abs(pos["x"] - 5.5) < 0.01 and abs(pos["z"] - -3.25) < 0.01

    def test_save_bad_400(self, member):
        r = member.post(f"{API}/nexus/position/save",
                        json={"zone_id": "plaza", "x": "bad", "y": 1, "z": 0}, timeout=15)
        assert r.status_code == 400


# ─── admin ops / publish / rollback ────────────────────────
class TestAdminOps:
    def test_full_flow(self, founder):
        # baseline versions
        r = founder.get(f"{API}/nexus/admin/versions", timeout=15)
        assert r.status_code == 200
        base = r.json()
        draft_v0 = base["draft_version"]
        pub_v0 = base["published_version"]

        # invalid op → 400
        r = founder.post(f"{API}/nexus/admin/ops",
                         json={"ops": [{"op": "nonsense"}]}, timeout=15)
        assert r.status_code == 400

        # add a test box
        r = founder.post(f"{API}/nexus/admin/ops", json={"ops": [{
            "op": "add_entity", "zone_id": "plaza",
            "entity": {"type": "box", "pos": [7, 0, 7], "rot": [0, 0, 0],
                       "scale": [1, 1, 1], "color": "#ff00ff",
                       "props": {"label": "TEST_pytest_box"}}}]},
                         timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["draft_version"] == draft_v0 + 1
        assert d.get("inverse_ops") and d["inverse_ops"][0]["op"] == "remove_entity"
        new_eid = d["inverse_ops"][0]["entity_id"]

        # publish
        r = founder.post(f"{API}/nexus/admin/publish", json={}, timeout=15)
        assert r.status_code == 200
        pub_v1 = r.json()["published_version"]
        assert pub_v1 == pub_v0 + 1

        # versions list contains snapshot at pub_v0
        r = founder.get(f"{API}/nexus/admin/versions", timeout=15)
        assert r.status_code == 200
        vs = r.json()["versions"]
        assert any(v["version"] == pub_v0 for v in vs), f"snapshot v{pub_v0} not in {[v['version'] for v in vs]}"

        # rollback restores DRAFT only, published unchanged
        r = founder.post(f"{API}/nexus/admin/rollback",
                         json={"version": pub_v0}, timeout=15)
        assert r.status_code == 200

        r = founder.get(f"{API}/nexus/admin/versions", timeout=15)
        after = r.json()
        assert after["published_version"] == pub_v1, "publish version must NOT change on rollback"

        # cleanup: try to remove test box from draft (may no longer exist after rollback)
        founder.post(f"{API}/nexus/admin/ops", json={"ops": [{
            "op": "remove_entity", "zone_id": "plaza", "entity_id": new_eid}]}, timeout=15)

        # audit populated
        r = founder.get(f"{API}/nexus/admin/audit", timeout=15)
        assert r.status_code == 200
        assert len(r.json()["audit"]) >= 1

    def test_rollback_missing_snapshot_404(self, founder):
        r = founder.post(f"{API}/nexus/admin/rollback",
                         json={"version": 99999}, timeout=15)
        assert r.status_code == 404


# ─── ORAi (uses real LLM — limited invocations) ─────────────
class TestORAi:
    def test_propose_reject_then_approve(self, founder):
        # propose #1 → reject
        r = founder.post(f"{API}/nexus/orai/propose",
                         json={"request": "add a small red pillar near the market at roughly x=13 z=-4"},
                         timeout=90)
        assert r.status_code == 200, f"propose failed: {r.status_code} {r.text[:400]}"
        prop = r.json()["proposal"]
        assert prop["status"] == "pending"
        assert isinstance(prop["ops"], list) and len(prop["ops"]) >= 1
        assert prop.get("plan")
        pid1 = prop["id"]

        r = founder.post(f"{API}/nexus/orai/decide",
                         json={"proposal_id": pid1, "approve": False}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"

        # baseline draft version
        r = founder.get(f"{API}/nexus/admin/versions", timeout=15)
        pub_before = r.json()["published_version"]
        draft_before = r.json()["draft_version"]

        # propose #2 → approve
        r = founder.post(f"{API}/nexus/orai/propose",
                         json={"request": "add one small green box near the fountain at 1,0,1"},
                         timeout=90)
        assert r.status_code == 200, r.text[:400]
        prop2 = r.json()["proposal"]
        pid2 = prop2["id"]
        assert prop2["status"] == "pending"

        r = founder.post(f"{API}/nexus/orai/decide",
                         json={"proposal_id": pid2, "approve": True}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "applied"

        r = founder.get(f"{API}/nexus/admin/versions", timeout=15)
        after = r.json()
        assert after["draft_version"] > draft_before
        assert after["published_version"] == pub_before, "publish must not move on ORAi apply"

    def test_proposals_list(self, founder):
        r = founder.get(f"{API}/nexus/orai/proposals", timeout=15)
        assert r.status_code == 200
        items = r.json().get("proposals")
        assert isinstance(items, list) and len(items) >= 1
