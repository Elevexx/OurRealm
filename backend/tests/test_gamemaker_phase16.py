"""Phase 1.6 tests — visual studio (mocked provider), placements, burn-into."""
import base64
import io
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"


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


def _png_b64(color=(255, 60, 60, 255)):
    from PIL import Image
    img = Image.new("RGBA", (600, 600), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_create_draft_resource_and_key_guard(founder):
    key = "crystals"
    r = founder.post(f"{API}/admin/resources",
                     json={"key": key, "name": "Crystals", "description": "test",
                           "icon": "🔷", "color": "#2EE6FF", "public": False}, timeout=15)
    assert r.status_code in (200, 409)
    founder.patch(f"{API}/admin/resources/{key}", json={"status": "draft"}, timeout=15)
    # stable key can never be reused
    r2 = founder.post(f"{API}/admin/resources", json={"key": key, "name": "X"}, timeout=15)
    assert r2.status_code == 409


def test_generate_visual_dry_run_then_mock_job(founder):
    d = founder.post(f"{API}/admin/resources/crystals/visuals/generate",
                     json={"prompt": "glowing blue crystal token", "dry_run": True}, timeout=15)
    assert d.status_code == 200 and "final_prompt" in d.json() and d.json()["estimated_cost"] > 0
    r = founder.post(f"{API}/admin/resources/crystals/visuals/generate",
                     json={"prompt": "glowing blue crystal token", "confirm": True,
                           "mock": True, "request_id": f"vg-{uuid.uuid4().hex}"}, timeout=15)
    assert r.status_code == 200
    jid = r.json()["job_id"]
    for _ in range(20):
        time.sleep(1)
        j = founder.get(f"{API}/jobs/{jid}", timeout=15).json()["job"]
        if j["phase"] in ("completed", "failed"):
            break
    assert j["phase"] == "completed", j.get("error")
    imgs = j["result"]["images"]
    for size in ("1024", "512", "256", "128", "64", "32", "thumb", "preview_light", "preview_dark"):
        assert size in imgs


def test_upload_activate_rollback(founder):
    u = founder.post(f"{API}/admin/resources/crystals/visuals/upload",
                     json={"image_b64": _png_b64(), "label": "Crystals icon"}, timeout=30)
    assert u.status_code == 200
    vs = founder.get(f"{API}/admin/resources/crystals/visuals", timeout=15).json()["visuals"]
    assert len(vs) >= 2
    v_new, v_old = vs[0], vs[1]
    a1 = founder.post(f"{API}/admin/resources/crystals/visuals/{v_new['id']}/activate", timeout=15)
    assert a1.status_code == 200
    # rollback to earlier version — history preserved
    a2 = founder.post(f"{API}/admin/resources/crystals/visuals/{v_old['id']}/activate", timeout=15)
    assert a2.status_code == 200
    regs = founder.get(f"{API}/admin/resources", timeout=15).json()["resources"]
    cr = next(r for r in regs if r["key"] == "crystals")
    assert cr["active_visual"]["id"] == v_old["id"]
    assert "?v=" in cr["active_visual"]["icon_url"]  # cache invalidation


def test_bad_upload_rejected(founder):
    r = founder.post(f"{API}/admin/resources/crystals/visuals/upload",
                     json={"image_b64": base64.b64encode(b"not-an-image").decode()}, timeout=15)
    assert r.status_code == 400


def test_burn_into_preview_and_apply(founder):
    p = founder.post(f"{API}/admin/resources/stars/burn-into",
                     json={"dst": "coins", "src_amount": 2, "dst_amount": 4, "preview": True}, timeout=15)
    assert p.status_code == 200 and "Burn 2 stars" in p.json()["preview"]
    a = founder.post(f"{API}/admin/resources/stars/burn-into",
                     json={"dst": "coins", "src_amount": 2, "dst_amount": 4, "enabled": True}, timeout=15)
    assert a.status_code == 200
    cfg = a.json()["rule"]["pair_configs"]["stars>coins"]
    assert cfg["src_amount"] == 2 and cfg["dst_amount"] == 4


def test_explicit_pair_ratio_used_in_quote(member):
    q = member.post(f"{API}/resources/exchange/quote",
                    json={"from": "stars", "to": "coins", "amount": 2}, timeout=15)
    assert q.status_code == 200, q.text[:200]
    quote = q.json()["quote"]
    assert quote["receive"] == 4 and quote["ratio"]["basis"] == "explicit_pair"


def test_arbitrage_warning_blocks_without_confirm(founder):
    r = founder.post(f"{API}/admin/resources/coins/burn-into",
                     json={"dst": "stars", "src_amount": 1, "dst_amount": 5}, timeout=15)
    assert r.status_code == 409 and "ARBITRAGE" in r.json()["detail"]
    # cleanup: no reverse pair created
    rules = founder.get(f"{API}/admin/gamemaker/exchange-rules", timeout=15).json()["rules"][0]
    assert ["coins", "stars"] not in [list(p) for p in rules["pairs"]]


def test_frozen_pair(founder, member):
    founder.post(f"{API}/admin/resources/stars/burn-into",
                 json={"dst": "coins", "src_amount": 2, "dst_amount": 4, "frozen": True}, timeout=15)
    q = member.post(f"{API}/resources/exchange/quote",
                    json={"from": "stars", "to": "coins", "amount": 2}, timeout=15)
    assert q.status_code == 400
    founder.post(f"{API}/admin/resources/stars/burn-into",
                 json={"dst": "coins", "src_amount": 2, "dst_amount": 4, "frozen": False}, timeout=15)


def test_enable_everywhere_and_matrix(founder):
    r = founder.post(f"{API}/admin/resources/coins/enable-everywhere", json={"enabled": True}, timeout=15)
    assert r.status_code == 200
    m = founder.get(f"{API}/admin/resources/placement-matrix", timeout=15).json()
    assert "vault" in m["surfaces"] and "foryou" in m["surfaces"]
    coins = next(x for x in m["resources"] if x["key"] == "coins")
    assert coins["cells"]["vault"]["effective"] == "full"
    # per-surface restrictive override wins over global enable
    founder.post(f"{API}/admin/resources/coins/placements",
                 json={"surface": "foryou", "mode": "display"}, timeout=15)
    m2 = founder.get(f"{API}/admin/resources/placement-matrix", timeout=15).json()
    c2 = next(x for x in m2["resources"] if x["key"] == "coins")
    assert c2["cells"]["foryou"]["effective"] == "display"
    assert c2["cells"]["foryou"]["ops"]["allow_earning"] is False


def test_placements_surface_endpoint_and_draft_hidden(member):
    r = member.get(f"{API}/resources/placements/vault", timeout=15)
    assert r.status_code == 200
    keys = [x["key"] for x in r.json()["resources"]]
    assert "coins" in keys
    assert "crystals" not in keys  # drafts never appear publicly


def test_future_adapter_auto_discovery(founder):
    r = founder.post(f"{API}/admin/resources/surfaces/register",
                     json={"key": "test_future_app", "label": "Test Future App",
                           "caps": {"display": True, "balance": True, "public": True, "mobile": True}},
                     timeout=15)
    assert r.status_code == 200
    assert "coins" in r.json()["auto_discovered_resources"]
    m = founder.get(f"{API}/admin/resources/placement-matrix", timeout=15).json()
    assert "test_future_app" in m["surfaces"]
    coins = next(x for x in m["resources"] if x["key"] == "coins")
    # adapter only declared display — operations rejected even at 'full'
    assert coins["cells"]["test_future_app"]["ops"]["allow_burning"] is False
    assert coins["cells"]["test_future_app"]["ops"]["display_icon"] is True


def test_permission_enforcement(member):
    assert member.get(f"{API}/admin/resources/placement-matrix", timeout=15).status_code in (401, 403)
    assert member.post(f"{API}/admin/resources/crystals/visuals/generate",
                       json={"mock": True}, timeout=15).status_code in (401, 403)


def test_fire_parity_and_regression(founder):
    rec = founder.get(f"{API}/admin/gamemaker/reconciliation", timeout=15).json()["fire"]
    assert rec["outstanding_vs_expected_ok"] is True
    w = founder.get(f"{API}/fire/wallet", timeout=15)
    assert w.status_code == 200
    assert requests.get(f"{API}/public/game-path/hub", timeout=15).status_code == 200
