"""Responsibility Center — Phase 1 backend tests.

Focus areas main agent had NOT yet exercised:
  role management, remove/leave, PATCH edit, non-member 403s,
  member-role cannot invite, invalid roles, dashboard perms.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

FOUNDER = {"email": "stealth", "password": "Password1$"}
MEMBER = {"email": "tftwo", "password": "pass1234"}
NON_MEMBER = {"email": "auditcheckreal", "password": "Password1$"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tokens():
    return {
        "founder": _login(FOUNDER),
        "member": _login(MEMBER),
        "outsider": _login(NON_MEMBER),
    }


@pytest.fixture(scope="module")
def founder_center(tokens):
    """Find or create a fresh center owned by founder with tftwo as active member."""
    # Try to find existing center where founder is owner and tftwo is active member.
    r = requests.get(f"{API}/responsibility-center/mine", headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 200
    for row in r.json().get("centers", []):
        if row["membership"]["role"] == "owner":
            cid = row["center"]["id"]
            # Check tftwo is active there
            m = requests.get(f"{API}/responsibility-center/{cid}/members", headers=_h(tokens["founder"]), timeout=15)
            if m.status_code == 200:
                for mem in m.json()["members"]:
                    if mem.get("username") == "tftwo" and mem.get("status") == "active":
                        return {"center_id": cid}
    pytest.skip("No suitable pre-seeded center with founder=owner and tftwo=active member (main agent said cf5a4...). Skipping role/edit tests.")


# ── Config ──────────────────────────────────────────────────────────────
def test_config_shape(tokens):
    r = requests.get(f"{API}/responsibility-center/config", headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["create_cost"] == 1000
    assert d["seat_cost"] == 100
    assert d["seat_days"] == 30
    assert "family" in d["center_types"]
    assert d["roles"] == ["owner", "admin", "manager", "member"]
    assert isinstance(d["my_fire_vault_balance"], int)


def test_config_requires_auth():
    r = requests.get(f"{API}/responsibility-center/config", timeout=15)
    assert r.status_code in (401, 403)


# ── Dashboard permissions ────────────────────────────────────────────────
def test_dashboard_non_member_403(tokens, founder_center):
    cid = founder_center["center_id"]
    r = requests.get(f"{API}/responsibility-center/{cid}", headers=_h(tokens["outsider"]), timeout=15)
    assert r.status_code == 403


def test_dashboard_owner_includes_vault_txns(tokens, founder_center):
    cid = founder_center["center_id"]
    r = requests.get(f"{API}/responsibility-center/{cid}", headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["center"]["id"] == cid
    assert d["my_membership"]["role"] == "owner"
    assert "vault_transactions" in d, "owner MUST receive vault_transactions"
    assert "members" in d and "activity" in d
    assert "fund_vault" in d["my_membership"]["permissions"]


def test_dashboard_member_excludes_vault_txns(tokens, founder_center):
    cid = founder_center["center_id"]
    # Ensure tftwo is currently a plain member (reset role if needed)
    # Fetch as founder to find tftwo user_id
    r = requests.get(f"{API}/responsibility-center/{cid}/members", headers=_h(tokens["founder"]), timeout=15)
    tftwo_uid = next((m["user_id"] for m in r.json()["members"] if m["username"] == "tftwo"), None)
    assert tftwo_uid, "tftwo not found in members"
    # Reset role to member
    requests.post(f"{API}/responsibility-center/{cid}/members/{tftwo_uid}/role",
                  json={"role": "member"}, headers=_h(tokens["founder"]), timeout=15)

    r = requests.get(f"{API}/responsibility-center/{cid}", headers=_h(tokens["member"]), timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["my_membership"]["role"] == "member"
    assert "vault_transactions" not in d, "plain member must NOT receive vault_transactions"
    # But should see members + activity
    assert "members" in d
    assert "activity" in d


# ── PATCH edit ──────────────────────────────────────────────────────────
def test_patch_edit_owner(tokens, founder_center):
    cid = founder_center["center_id"]
    orig = requests.get(f"{API}/responsibility-center/{cid}", headers=_h(tokens["founder"]), timeout=15).json()["center"]
    new_desc = f"TEST desc {uuid.uuid4().hex[:6]}"
    r = requests.patch(f"{API}/responsibility-center/{cid}",
                       json={"name": orig["name"], "description": new_desc}, headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 200
    assert r.json()["center"]["description"] == new_desc
    # Verify persisted
    d = requests.get(f"{API}/responsibility-center/{cid}", headers=_h(tokens["founder"]), timeout=15).json()
    assert d["center"]["description"] == new_desc


def test_patch_edit_member_403(tokens, founder_center):
    cid = founder_center["center_id"]
    r = requests.patch(f"{API}/responsibility-center/{cid}",
                       json={"name": "hacked"}, headers=_h(tokens["member"]), timeout=15)
    assert r.status_code == 403


def test_patch_empty_name_400(tokens, founder_center):
    cid = founder_center["center_id"]
    r = requests.patch(f"{API}/responsibility-center/{cid}",
                       json={"name": "   "}, headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 400


def test_patch_non_member_403(tokens, founder_center):
    cid = founder_center["center_id"]
    r = requests.patch(f"{API}/responsibility-center/{cid}",
                       json={"name": "x"}, headers=_h(tokens["outsider"]), timeout=15)
    assert r.status_code == 403


# ── Roles ───────────────────────────────────────────────────────────────
def _tftwo_uid(tokens, cid):
    r = requests.get(f"{API}/responsibility-center/{cid}/members", headers=_h(tokens["founder"]), timeout=15)
    return next(m["user_id"] for m in r.json()["members"] if m["username"] == "tftwo")


def test_set_role_owner_can_promote_to_admin(tokens, founder_center):
    cid = founder_center["center_id"]
    uid = _tftwo_uid(tokens, cid)
    r = requests.post(f"{API}/responsibility-center/{cid}/members/{uid}/role",
                      json={"role": "admin"}, headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "admin"


def test_set_role_owner_role_rejected(tokens, founder_center):
    cid = founder_center["center_id"]
    uid = _tftwo_uid(tokens, cid)
    r = requests.post(f"{API}/responsibility-center/{cid}/members/{uid}/role",
                      json={"role": "owner"}, headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 400


def test_set_role_owner_cannot_be_changed(tokens, founder_center):
    cid = founder_center["center_id"]
    # Owner id = founder's user id — get via /mine
    me = requests.get(f"{API}/auth/me", headers=_h(tokens["founder"]), timeout=15).json()
    fid = me.get("id") or me.get("user", {}).get("id")
    if not fid:
        # fallback via members
        r = requests.get(f"{API}/responsibility-center/{cid}/members", headers=_h(tokens["founder"]), timeout=15)
        fid = next(m["user_id"] for m in r.json()["members"] if m["role"] == "owner")
    # tftwo (currently admin from previous test) tries to demote owner
    r = requests.post(f"{API}/responsibility-center/{cid}/members/{fid}/role",
                      json={"role": "admin"}, headers=_h(tokens["member"]), timeout=15)
    assert r.status_code == 403


def test_admin_cannot_promote_to_admin(tokens, founder_center):
    """After tftwo made admin, they can only manage BELOW admin. So they can't set another member to admin,
    and can't demote/promote owner."""
    cid = founder_center["center_id"]
    # tftwo (admin) tries to set OWNER's role — should be 403 (owner protected) OR 403 (rank)
    me_founder = requests.get(f"{API}/auth/me", headers=_h(tokens["founder"]), timeout=15).json()
    fid = me_founder.get("id") or me_founder.get("user", {}).get("id")
    r = requests.post(f"{API}/responsibility-center/{cid}/members/{fid}/role",
                      json={"role": "manager"}, headers=_h(tokens["member"]), timeout=15)
    assert r.status_code == 403


def test_set_role_by_non_admin_403(tokens, founder_center):
    """Demote tftwo back to member, then verify tftwo (as plain member) can't set roles."""
    cid = founder_center["center_id"]
    uid = _tftwo_uid(tokens, cid)
    requests.post(f"{API}/responsibility-center/{cid}/members/{uid}/role",
                  json={"role": "member"}, headers=_h(tokens["founder"]), timeout=15)
    # member tries to set self role
    r = requests.post(f"{API}/responsibility-center/{cid}/members/{uid}/role",
                      json={"role": "admin"}, headers=_h(tokens["member"]), timeout=15)
    assert r.status_code == 403


def test_set_role_invalid_400(tokens, founder_center):
    cid = founder_center["center_id"]
    uid = _tftwo_uid(tokens, cid)
    r = requests.post(f"{API}/responsibility-center/{cid}/members/{uid}/role",
                      json={"role": "godmode"}, headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 400


# ── Invite / respond ─────────────────────────────────────────────────────
def test_member_cannot_invite(tokens, founder_center):
    cid = founder_center["center_id"]
    r = requests.post(f"{API}/responsibility-center/{cid}/invite",
                      json={"username": "auditcheckreal"}, headers=_h(tokens["member"]), timeout=15)
    assert r.status_code == 403


def test_invite_nonexistent_user_404(tokens, founder_center):
    cid = founder_center["center_id"]
    r = requests.post(f"{API}/responsibility-center/{cid}/invite",
                      json={"username": f"ghost{uuid.uuid4().hex[:8]}"}, headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 404


def test_invite_duplicate_active_member_409(tokens, founder_center):
    cid = founder_center["center_id"]
    r = requests.post(f"{API}/responsibility-center/{cid}/invite",
                      json={"username": "tftwo"}, headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 409


def test_second_respond_404_or_409(tokens, founder_center):
    """No pending invite for tftwo (already active) → respond returns 404."""
    cid = founder_center["center_id"]
    r = requests.post(f"{API}/responsibility-center/{cid}/invites/respond",
                      json={"accept": True}, headers=_h(tokens["member"]), timeout=15)
    assert r.status_code in (404, 409)


# ── Remove / leave ───────────────────────────────────────────────────────
def test_leave_owner_403(tokens, founder_center):
    cid = founder_center["center_id"]
    r = requests.post(f"{API}/responsibility-center/{cid}/leave",
                      headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 403


def test_leave_non_member_403(tokens, founder_center):
    cid = founder_center["center_id"]
    r = requests.post(f"{API}/responsibility-center/{cid}/leave",
                      headers=_h(tokens["outsider"]), timeout=15)
    assert r.status_code == 403


def test_remove_owner_forbidden(tokens, founder_center):
    cid = founder_center["center_id"]
    me_founder = requests.get(f"{API}/auth/me", headers=_h(tokens["founder"]), timeout=15).json()
    fid = me_founder.get("id") or me_founder.get("user", {}).get("id")
    # Owner tries to remove self
    r = requests.post(f"{API}/responsibility-center/{cid}/members/{fid}/remove",
                      headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 403


def test_remove_by_non_admin_403(tokens, founder_center):
    cid = founder_center["center_id"]
    uid = _tftwo_uid(tokens, cid)
    # tftwo (member) tries to remove self
    r = requests.post(f"{API}/responsibility-center/{cid}/members/{uid}/remove",
                      headers=_h(tokens["member"]), timeout=15)
    assert r.status_code == 403


# ── Fund vault non-member 403 ────────────────────────────────────────────
def test_fund_non_member_403(tokens, founder_center):
    cid = founder_center["center_id"]
    r = requests.post(f"{API}/responsibility-center/{cid}/vault/fund",
                      json={"amount": 10}, headers=_h(tokens["outsider"]), timeout=15)
    assert r.status_code == 403


def test_fund_invalid_amount_400(tokens, founder_center):
    cid = founder_center["center_id"]
    r = requests.post(f"{API}/responsibility-center/{cid}/vault/fund",
                      json={"amount": 0}, headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 400


# ── /mine ────────────────────────────────────────────────────────────────
def test_mine_shape(tokens):
    r = requests.get(f"{API}/responsibility-center/mine", headers=_h(tokens["founder"]), timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "centers" in d and "invites" in d and "my_fire_vault_balance" in d
    assert isinstance(d["my_fire_vault_balance"], int)


def test_mine_outsider_empty(tokens):
    r = requests.get(f"{API}/responsibility-center/mine", headers=_h(tokens["outsider"]), timeout=15)
    assert r.status_code == 200
    d = r.json()
    # auditcheckreal is NOT a member of the founder's center
    assert not any(row["center"]["id"] == "cf5a475c04cd4860976920cda63fa6ff"
                   for row in d.get("centers", [])), "outsider should not have founder's center"
