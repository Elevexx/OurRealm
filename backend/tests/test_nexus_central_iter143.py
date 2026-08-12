"""Nexus V1 Central Spawn + Avatars + Proximity Chat backend regression (iter143)."""
import os
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if "REACT_APP_BACKEND_URL" in os.environ else None
if not BASE:
    # Read from frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE = line.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE}/api"


def _login(username, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def founder():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def member():
    return _login("tftwo", "pass1234")


# ─────────── world / nexus_central zone ───────────
class TestWorld:
    def test_published_world_has_nexus_central(self, founder):
        r = founder.get(f"{API}/nexus/world")
        assert r.status_code == 200
        data = r.json()
        world = data["world"]
        zone_ids = {z["id"] for z in world["zones"]}
        assert "nexus_central" in zone_ids
        assert "plaza" in zone_ids
        assert "emerald_gardens" in zone_ids
        # published version 11+
        assert data["version"] >= 11, f"published_version={data['version']} (<11)"
        # nexus_central has ~117 entities
        nc = next(z for z in world["zones"] if z["id"] == "nexus_central")
        assert len(nc["entities"]) >= 100, f"nexus_central only has {len(nc['entities'])} entities"

    def test_meta_default_zone_and_starter_avatar(self, founder):
        r = founder.get(f"{API}/nexus/world")
        meta = r.json()["world"].get("meta") or {}
        assert meta.get("default_zone") == "nexus_central", f"default_zone={meta.get('default_zone')}"
        assert meta.get("starter_avatar_url"), "meta.starter_avatar_url missing"


# ─────────── avatars ───────────
class TestAvatars:
    def test_list_shows_starter_m_and_f(self, member):
        r = member.get(f"{API}/nexus/avatars")
        assert r.status_code == 200
        ids = {a["id"] for a in r.json()["avatars"]}
        assert "starter_m" in ids
        assert "starter_f" in ids
        default = next(a for a in r.json()["avatars"] if a["id"] == "starter_m")
        assert default.get("is_default") is True

    def test_select_persists_and_restore(self, member):
        # switch to starter_f
        r = member.post(f"{API}/nexus/avatars/select", json={"id": "starter_f"})
        assert r.status_code == 200
        r2 = member.get(f"{API}/nexus/avatars")
        assert r2.json()["my_id"] == "starter_f"
        # switch back
        r3 = member.post(f"{API}/nexus/avatars/select", json={"id": "starter_m"})
        assert r3.status_code == 200
        r4 = member.get(f"{API}/nexus/avatars")
        assert r4.json()["my_id"] == "starter_m"

    def test_admin_avatars_founder_gate(self, founder, member):
        r = member.get(f"{API}/nexus/admin/avatars")
        assert r.status_code == 403
        r2 = member.post(f"{API}/nexus/admin/avatars", json={"id": "starter_m", "label": "x"})
        assert r2.status_code == 403
        r3 = founder.get(f"{API}/nexus/admin/avatars")
        assert r3.status_code == 200


# ─────────── asset studio ───────────
class TestAssetStudio:
    def test_founder_only_endpoints(self, founder, member):
        for path in ("/nexus/admin/assets/library", "/nexus/admin/assets/tasks"):
            r = member.get(f"{API}{path}")
            assert r.status_code == 403, f"{path} should be founder-only"
            r2 = founder.get(f"{API}{path}")
            assert r2.status_code == 200

    def test_upload_invalid_base64(self, founder):
        r = founder.post(f"{API}/nexus/admin/assets/upload", json={"data_b64": "not_base64!!!"})
        assert r.status_code in (400, 422)


# ─────────── presence + chat ───────────
def _post_presence(sess, x, z, zone_id="nexus_central"):
    return sess.post(f"{API}/nexus/presence",
                     json={"zone_id": zone_id, "x": x, "y": 0.0, "z": z, "ry": 0, "anim": "idle"})


class TestPresenceChat:
    def test_presence_includes_avatar_url_and_pv_and_chats(self, member):
        time.sleep(0.15)
        r = _post_presence(member, 0.0, 0.0)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "pv" in data and isinstance(data["pv"], int)
        assert "chats" in data and isinstance(data["chats"], list)

    def test_out_of_bounds_rejected(self, member):
        time.sleep(0.15)
        r = _post_presence(member, 999.0, 0.0)
        assert r.status_code == 400

    def test_chat_requires_in_world(self, founder):
        # founder without presence
        founder.post(f"{API}/nexus/presence/leave")
        time.sleep(0.1)
        r = founder.post(f"{API}/nexus/chat", json={"text": "hello"})
        assert r.status_code == 400

    def test_chat_rate_limit_and_truncation(self, member):
        time.sleep(0.15)
        _post_presence(member, 0.0, 0.0)
        time.sleep(0.15)
        long_text = "A" * 300
        r = member.post(f"{API}/nexus/chat", json={"text": long_text})
        assert r.status_code == 200, r.text
        assert len(r.json()["message"]["text"]) == 160
        # immediate second should 429
        r2 = member.post(f"{API}/nexus/chat", json={"text": "hi"})
        assert r2.status_code == 429

    def test_chat_radius_excludes_far_player(self, founder, member):
        # Put member at (0, 84), founder at (0, -80). Distance > 18.
        time.sleep(2.1)
        _post_presence(member, 0.0, 84.0)
        time.sleep(0.15)
        _post_presence(founder, 0.0, -80.0)
        time.sleep(2.1)
        # member posts chat
        r = member.post(f"{API}/nexus/chat", json={"text": f"FAR_TEST_{int(time.time())}"})
        assert r.status_code == 200, r.text
        msg_text = r.json()["message"]["text"]
        # founder polls presence at (0,-80)
        time.sleep(0.15)
        r2 = _post_presence(founder, 0.0, -80.0)
        assert r2.status_code == 200
        chats = r2.json()["chats"]
        texts = [c["text"] for c in chats]
        assert msg_text not in texts, f"far chat leaked: {texts}"

    def test_chat_visible_within_radius(self, founder, member):
        # Clear presence first so no teleport snap-back applies from prior far-apart placement.
        member.post(f"{API}/nexus/presence/leave")
        founder.post(f"{API}/nexus/presence/leave")
        time.sleep(0.2)
        # Both near (0,0)
        _post_presence(member, 0.0, 0.0)
        time.sleep(0.15)
        _post_presence(founder, 0.0, 5.0)
        time.sleep(2.1)
        marker = f"NEAR_TEST_{int(time.time())}"
        r = member.post(f"{API}/nexus/chat", json={"text": marker})
        assert r.status_code == 200
        time.sleep(0.15)
        r2 = _post_presence(founder, 0.0, 5.0)
        assert marker in [c["text"] for c in r2.json()["chats"]]


# ─────────── position save/restore ───────────
class TestPositionSave:
    def test_save_zone_and_restore(self, member):
        r = member.post(f"{API}/nexus/position/save",
                        json={"zone_id": "emerald_gardens", "x": 3.0, "y": 0.0, "z": -4.0, "ry": 1.2})
        assert r.status_code == 200
        r2 = member.get(f"{API}/nexus/position")
        pos = r2.json()["position"]
        assert pos["zone_id"] == "emerald_gardens"
        assert pos["x"] == 3.0
        assert pos["z"] == -4.0

    def test_save_bad_position(self, member):
        r = member.post(f"{API}/nexus/position/save", json={"x": "bad", "y": 0, "z": 0})
        assert r.status_code == 400


# ─────────── teleport snap-back ───────────
class TestTeleport:
    def test_teleport_snapped_back(self, member):
        time.sleep(2.1)
        r1 = _post_presence(member, 0.0, 0.0)
        assert r1.status_code == 200
        time.sleep(0.5)
        # try teleport 50 units away in 0.5s (>16u/s + 3 threshold)
        r2 = _post_presence(member, 50.0, 50.0)
        # accepted but snapped back
        assert r2.status_code == 200
        # should be near original
        self_x = r2.json()["self"]["x"]
        assert abs(self_x - 50.0) > 5, f"teleport not snapped: x={self_x}"
