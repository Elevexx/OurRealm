"""Iter122 — Backend verification for action_rpg_2_5d runtime + wiring report + art-preset."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")
GID = "254523a78f694547ac36a6845e037e92"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": "stealth", "password": "Password1$"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# 1. planner selects action_rpg_2_5d
def test_plan_selects_arpg(h):
    body = {"request": "a 2.5D action RPG with real-time combat, melee and spells, dodge roll, boss phases and exploration", "complexity": 1, "ai_power": 3}
    r = requests.post(f"{BASE}/api/orai/platform/plan", json=body, headers=h, timeout=180)
    assert r.status_code == 200, r.text
    d = r.json()
    sel = d.get("blueprint", {}).get("selected_runtime") or d.get("selected_runtime")
    assert sel == "action_rpg_2_5d", f"got {sel}"


# 2. runtimes contracts lists action_rpg_2_5d executable
def test_runtimes_contracts_lists_arpg(h):
    r = requests.get(f"{BASE}/api/orai/platform/runtimes/contracts", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    execs = d.get("executable") or []
    assert "action_rpg_2_5d" in execs, f"action_rpg_2_5d not in executable list: {execs}"
    contracts = d.get("contracts") or []
    match = [c for c in contracts if c.get("runtime_id") == "runtime_action_rpg_2_5d_v1"]
    assert len(match) == 1, "runtime_action_rpg_2_5d_v1 contract missing"
    assert match[0].get("status") == "executable"


# 3. wiring-report: all REQUIRED slots wired (no publish blockers),
#    optional slots may remain placeholder without failing the contract
def test_wiring_report_zero_placeholder(h):
    r = requests.get(f"{BASE}/api/admin/games/{GID}/assets/wiring-report", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    v = d.get("validation") or d
    assert v.get("placeholder_pct") <= 20, d
    assert v.get("publish_blockers") in ([], None), v.get("publish_blockers")


# 4. art-preset bogus 400, pixel 200, restore fantasy_hd
def test_art_preset_flow(h):
    r1 = requests.post(f"{BASE}/api/admin/games/{GID}/assets/art-preset", json={"preset": "bogus"}, headers=h, timeout=30)
    assert r1.status_code == 400, r1.text
    r2 = requests.post(f"{BASE}/api/admin/games/{GID}/assets/art-preset", json={"preset": "pixel"}, headers=h, timeout=30)
    assert r2.status_code == 200, r2.text
    r3 = requests.post(f"{BASE}/api/admin/games/{GID}/assets/art-preset", json={"preset": "fantasy_hd"}, headers=h, timeout=30)
    assert r3.status_code == 200, r3.text
