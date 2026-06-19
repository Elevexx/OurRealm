"""Account deletion + 30-day restore + admin username/email change tests."""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email_or_username: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email_or_username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed {email_or_username}: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, f"no token: {body}"
    return tok, body


def _hdrs(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _register(username_prefix: str = "qe2") -> tuple[dict, str]:
    """Register a brand-new throwaway user. Returns (user_payload, token)."""
    uname = f"{username_prefix}{uuid.uuid4().hex[:6]}"
    email = f"{uname}@example.com"
    body = {
        "email": email,
        "password": "Pass1234$",
        "name": uname,
        "username": uname,
        "accepted_terms": True,
        "accepted_privacy": True,
        "accepted_conditions": True,
        "age_confirmed_13": True,
    }
    r = requests.post(f"{API}/auth/register", json=body, timeout=30)
    assert r.status_code in (200, 201), f"register: {r.status_code} {r.text}"
    resp = r.json()
    tok = resp.get("access_token") or resp.get("token")
    assert tok, resp
    return ({"email": email, "username": uname, "password": "Pass1234$", **resp.get("user", {})}, tok)


# ----------------------------------------------------------------------- FIXTURES
@pytest.fixture(scope="module")
def stealth_token():
    tok, _ = _login("stealth", "Password1$")
    return tok


@pytest.fixture(scope="module")
def support_token():
    try:
        tok, _ = _login("support", "Password1$")
        return tok
    except AssertionError:
        pytest.skip("support not seeded")


def _restore_if_needed(username: str, password: str):
    """Ensure a known user is in 'active' state at start/end of run."""
    try:
        tok, body = _login(username, password)
        if body.get("restore_required"):
            requests.post(f"{API}/profile/self-restore", headers=_hdrs(tok), timeout=20)
    except Exception:
        pass


@pytest.fixture(scope="module", autouse=True)
def ensure_test_users_active():
    _restore_if_needed("tfone", "pass1234")
    _restore_if_needed("tftwo", "pass1234")
    yield
    _restore_if_needed("tfone", "pass1234")
    _restore_if_needed("tftwo", "pass1234")


# ============================================================ SELF-DELETE FLOW
class TestSelfDeleteFlow:
    def test_tfone_self_delete_then_restore(self):
        tok, _ = _login("tfone", "pass1234")
        # self-delete
        r = requests.post(f"{API}/profile/self-delete", headers=_hdrs(tok),
                          json={"confirm": "DELETE"}, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "deleted_pending_restore"
        assert data.get("purge_after")

        # public profile must be 404
        pr = requests.get(f"{API}/profile/by-username/tfone", timeout=20)
        assert pr.status_code == 404, pr.text

        # re-login should succeed with restore_required true
        lr = requests.post(f"{API}/auth/login",
                           json={"email": "tfone", "password": "pass1234"}, timeout=20)
        assert lr.status_code == 200, lr.text
        body = lr.json()
        assert body.get("restore_required") is True, body
        pd = body.get("pending_deletion") or {}
        assert pd.get("deleted_at"), body
        assert pd.get("purge_after"), body

        tok2 = body.get("access_token") or body.get("token")
        # self-restore
        rr = requests.post(f"{API}/profile/self-restore", headers=_hdrs(tok2), timeout=20)
        assert rr.status_code == 200, rr.text

        # public profile back to 200
        pr2 = requests.get(f"{API}/profile/by-username/tfone", timeout=20)
        assert pr2.status_code == 200, pr2.text


# ============================================================ SYSTEM ACCOUNTS
class TestSystemAccountsCannotSelfDelete:
    def test_stealth_self_delete_forbidden(self, stealth_token):
        r = requests.post(f"{API}/profile/self-delete", headers=_hdrs(stealth_token),
                          json={"confirm": "DELETE"}, timeout=20)
        assert r.status_code == 403, r.text
        assert "system" in (r.json().get("detail", "").lower())

    def test_support_self_delete_forbidden(self, support_token):
        r = requests.post(f"{API}/profile/self-delete", headers=_hdrs(support_token),
                          json={"confirm": "DELETE"}, timeout=20)
        assert r.status_code == 403, r.text


# ============================================================ ADMIN DELETE 30-DAY
class TestAdminDelete30Day:
    def test_admin_delete_uses_lifecycle(self, stealth_token):
        user, _ = _register("qe2del")
        uid = user["id"]
        uname = user["username"]
        # admin-delete
        r = requests.post(f"{API}/admin/users/{uid}/delete",
                          headers=_hdrs(stealth_token),
                          json={"confirm_username": uname, "reason": "test cleanup"},
                          timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("account_status") == "deleted_pending_restore", data
        assert data.get("purge_after"), data

        # public lookup should 404
        pr = requests.get(f"{API}/profile/by-username/{uname}", timeout=20)
        assert pr.status_code == 404

        # admin restore
        rr = requests.post(f"{API}/admin/users/{uid}/restore",
                           headers=_hdrs(stealth_token), timeout=20)
        assert rr.status_code == 200, rr.text
        # back to public
        pr2 = requests.get(f"{API}/profile/by-username/{uname}", timeout=20)
        assert pr2.status_code == 200


# ============================================================ ADMIN USERNAME/EMAIL
class TestAdminUsernameEmail:
    def test_username_change_flow(self, stealth_token):
        user, _ = _register("qe2un")
        uid = user["id"]
        new_un = f"qe2unx{uuid.uuid4().hex[:6]}"
        # 200 success
        r = requests.patch(f"{API}/admin/users/{uid}/username",
                           headers=_hdrs(stealth_token),
                           json={"username": new_un}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["username"] == new_un

        # 409 conflict with existing stealth
        r2 = requests.patch(f"{API}/admin/users/{uid}/username",
                            headers=_hdrs(stealth_token),
                            json={"username": "stealth"}, timeout=20)
        assert r2.status_code == 409, r2.text

        # 400 bad format
        r3 = requests.patch(f"{API}/admin/users/{uid}/username",
                            headers=_hdrs(stealth_token),
                            json={"username": "BAD!!!"}, timeout=20)
        assert r3.status_code == 400, r3.text

    def test_email_change_flow(self, stealth_token):
        user, _ = _register("qe2em")
        uid = user["id"]
        new_email = f"qe2em{uuid.uuid4().hex[:6]}@example.com"
        r = requests.patch(f"{API}/admin/users/{uid}/email",
                           headers=_hdrs(stealth_token),
                           json={"email": new_email}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["email"] == new_email

        # 409 (use stealth's email implicitly by reusing this user's prior email? use stealth)
        r2 = requests.patch(f"{API}/admin/users/{uid}/email",
                            headers=_hdrs(stealth_token),
                            json={"email": "slopestyle2022@gmail.com"}, timeout=20)
        assert r2.status_code == 409, r2.text

        # 400 bad format
        r3 = requests.patch(f"{API}/admin/users/{uid}/email",
                            headers=_hdrs(stealth_token),
                            json={"email": "not-an-email"}, timeout=20)
        assert r3.status_code == 400, r3.text

    def test_non_admin_forbidden(self, stealth_token):
        # create a victim
        victim, _ = _register("qe2v")
        # tfone tries (non-admin)
        tfone_tok, _ = _login("tfone", "pass1234")
        r = requests.patch(f"{API}/admin/users/{victim['id']}/username",
                           headers=_hdrs(tfone_tok),
                           json={"username": "abc123xyz"}, timeout=20)
        assert r.status_code == 403, r.text
        r2 = requests.patch(f"{API}/admin/users/{victim['id']}/email",
                            headers=_hdrs(tfone_tok),
                            json={"email": "abc@xyz.com"}, timeout=20)
        assert r2.status_code == 403, r2.text

    def test_unauth_forbidden(self):
        r = requests.patch(f"{API}/admin/users/some/username",
                           json={"username": "abcxyz"},
                           headers={"Content-Type": "application/json"}, timeout=20)
        assert r.status_code in (401, 403)


# ============================================================ USERNAME RESERVED DURING SOFT-DELETE
class TestUsernameReservedDuringPendingDeletion:
    def test_reserved_username(self, stealth_token):
        rsv_user, rsv_tok = _register("rsv")
        rsv_uname = rsv_user["username"]
        # self-delete the user
        sd = requests.post(f"{API}/profile/self-delete", headers=_hdrs(rsv_tok),
                           json={"confirm": "DELETE"}, timeout=20)
        assert sd.status_code == 200

        # create another user
        other, _ = _register("oth")
        oid = other["id"]
        # try to rename to rsv user's username — should 409
        r = requests.patch(f"{API}/admin/users/{oid}/username",
                           headers=_hdrs(stealth_token),
                           json={"username": rsv_uname}, timeout=20)
        assert r.status_code == 409, r.text


# ============================================================ AUDIT LOG via MongoDB
class TestAuditLog:
    def test_audit_entries_exist(self, stealth_token):
        """Spot-check by performing actions then verifying via direct DB read."""
        try:
            from motor.motor_asyncio import AsyncIOMotorClient
            import asyncio
        except ImportError:
            pytest.skip("motor not available")

        # do a self-delete + restore on a fresh user
        u, tok = _register("aud")
        requests.post(f"{API}/profile/self-delete", headers=_hdrs(tok), json={"confirm": "DELETE"}, timeout=20)
        # admin-restore
        requests.post(f"{API}/admin/users/{u['id']}/restore", headers=_hdrs(stealth_token), timeout=20)
        # username change
        new_un = f"audx{uuid.uuid4().hex[:6]}"
        requests.patch(f"{API}/admin/users/{u['id']}/username",
                       headers=_hdrs(stealth_token), json={"username": new_un}, timeout=20)
        # email change
        new_em = f"audx{uuid.uuid4().hex[:6]}@example.com"
        requests.patch(f"{API}/admin/users/{u['id']}/email",
                       headers=_hdrs(stealth_token), json={"email": new_em}, timeout=20)

        time.sleep(0.5)
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "test_database")

        async def _check():
            client = AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            actions = set()
            async for entry in db.audit_log.find({"target_id": u["id"]}):
                actions.add(entry.get("action"))
            return actions

        actions = asyncio.run(_check())
        # Expect at least these
        expected = {"account.self_delete", "account.restore"}
        missing = expected - actions
        assert not missing, f"Missing audit actions: {missing} (found: {actions})"
        # username/email actions may use different action names
        assert any("username" in a for a in actions), f"no username action in {actions}"
        assert any("email" in a for a in actions), f"no email action in {actions}"
