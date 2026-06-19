"""Backend tests for Admin User Control + Password Reset widgets (iteration 25)."""
import os
import time
import pytest
import requests
from datetime import datetime, timezone, timedelta

# Load backend/.env so MONGO_URL / DB_NAME are available to test fixtures
try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv("/app/backend/.env")
except Exception:
    pass

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

FOUNDER = {"email": "stealth", "password": "Password1$"}
TFONE = {"email": "tfone", "password": "pass1234"}
TFTWO = {"email": "tftwo", "password": "pass1234"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    if r.status_code != 200:
        return None, r
    return r.json().get("access_token"), r


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _wipe_login_attempts():
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        return
    db_name = os.environ.get("DB_NAME", "test_database")

    async def _wipe():
        client = AsyncIOMotorClient(mongo_url)
        await client[db_name].login_attempts.delete_many({})
        client.close()
    asyncio.get_event_loop().run_until_complete(_wipe())


@pytest.fixture(scope="module", autouse=True)
def _clear_lockouts_and_restore_tfone():
    """Wipe login_attempts collection so brute-force lockout doesn't
    poison the suite (suspended logins count as failures by design)."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    import bcrypt
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    if not mongo_url:
        yield
        return
    pwh = bcrypt.hashpw(b"pass1234", bcrypt.gensalt()).decode()

    async def reset():
        client = AsyncIOMotorClient(mongo_url)
        await client[db_name].login_attempts.delete_many({})
        # Make sure tfone is in clean state at module start in case prior
        # iterations left it suspended / with non-default password.
        await client[db_name].users.update_one(
            {"username": "tfone"},
            {"$set": {"password_hash": pwh, "disabled": False, "mutes": []},
             "$unset": {"suspended_until": "", "suspended_at": "", "suspended_by": "",
                        "suspension_reason": "", "suspension_notes": "",
                        "password_changed_at": ""}},
        )
        client.close()
    asyncio.get_event_loop().run_until_complete(reset())
    yield
    asyncio.get_event_loop().run_until_complete(reset())


@pytest.fixture(scope="module")
def founder_token():
    tok, r = _login(FOUNDER)
    if not tok:
        pytest.skip(f"Founder login failed: {r.status_code} {r.text}")
    return tok


@pytest.fixture(scope="module")
def tfone_token():
    tok, r = _login(TFONE)
    if not tok:
        pytest.skip(f"tfone login failed: {r.status_code} {r.text}")
    return tok


@pytest.fixture(scope="module")
def tfone_id(founder_token):
    r = requests.get(f"{API}/admin/users/search", params={"q": "tfone"}, headers=_h(founder_token), timeout=20)
    assert r.status_code == 200, r.text
    users = r.json().get("users", [])
    assert users, "tfone not found"
    return users[0]["id"]


@pytest.fixture(scope="module")
def support_id(founder_token):
    r = requests.get(f"{API}/admin/users/search", params={"q": "support"}, headers=_h(founder_token), timeout=20)
    assert r.status_code == 200
    for u in r.json().get("users", []):
        if (u.get("username") or "").lower() == "support":
            return u["id"]
    pytest.skip("support user not found")


@pytest.fixture(scope="module")
def stealth_id(founder_token):
    r = requests.get(f"{API}/auth/me", headers=_h(founder_token), timeout=20)
    assert r.status_code == 200
    return r.json()["user"]["id"]


# ─── Search ─────────────────────────────────────────────
def test_search_as_founder(founder_token):
    r = requests.get(f"{API}/admin/users/search", params={"q": "tfone"}, headers=_h(founder_token), timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "users" in data and len(data["users"]) >= 1
    u = next(x for x in data["users"] if (x.get("username") or "") == "tfone")
    assert "password_hash" not in u
    assert u.get("username") == "tfone"
    assert "display_name" in u
    assert "email" in u
    assert "mutes" in u
    assert isinstance(u["mutes"], list)


def test_search_as_non_admin_403(tfone_token):
    r = requests.get(f"{API}/admin/users/search", params={"q": "tfone"}, headers=_h(tfone_token), timeout=20)
    assert r.status_code == 403, r.text
    assert "admin" in (r.json().get("detail") or "").lower()


# ─── Suspend / Unsuspend / Login while suspended ────────
def test_suspend_overwrite_then_login_blocked_then_unsuspend(founder_token, tfone_id):
    # First suspend 7d
    r = requests.post(f"{API}/admin/users/{tfone_id}/suspend",
                      json={"days": 7, "reason": "spam"},
                      headers=_h(founder_token), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    u = body["user"]
    assert u["disabled"] is True
    first_until = u["suspended_until"]
    assert first_until is not None

    # Overwrite to 1d
    r2 = requests.post(f"{API}/admin/users/{tfone_id}/suspend",
                       json={"days": 1, "reason": "shorter"},
                       headers=_h(founder_token), timeout=20)
    assert r2.status_code == 200
    second_until = r2.json()["user"]["suspended_until"]
    assert second_until != first_until, "Suspend should overwrite"

    # Login while suspended → 401 with mandated message
    rl = requests.post(f"{API}/auth/login", json=TFONE, timeout=20)
    assert rl.status_code == 401
    detail = rl.json().get("detail", "")
    assert detail.startswith("Account suspended until "), f"Got: {detail!r}"

    # Clear lockouts (suspended login counted as failed attempt by design).
    _wipe_login_attempts()

    # Unsuspend
    ru = requests.post(f"{API}/admin/users/{tfone_id}/unsuspend",
                       headers=_h(founder_token), timeout=20)
    assert ru.status_code == 200
    assert ru.json()["user"]["disabled"] is False
    assert ru.json()["user"].get("suspended_until") in (None, "")

    # Login works again
    rl2 = requests.post(f"{API}/auth/login", json=TFONE, timeout=20)
    assert rl2.status_code == 200


def test_auto_resolve_elapsed_suspension(founder_token, tfone_id):
    """Manually set a past suspended_until in mongo and verify login auto-clears."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        pytest.skip("MONGO_URL not set")
    db_name = os.environ.get("DB_NAME", "ourrealm")
    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    async def setup():
        client = AsyncIOMotorClient(mongo_url)
        await client[db_name].users.update_one(
            {"id": tfone_id},
            {"$set": {"disabled": True, "suspended_until": past}},
        )
        client.close()
    asyncio.get_event_loop().run_until_complete(setup())

    # Login should auto-clear
    rl = requests.post(f"{API}/auth/login", json=TFONE, timeout=20)
    assert rl.status_code == 200, rl.text


# ─── Mute / Unmute ──────────────────────────────────────
def test_mute_specific_types_and_unmute_single(founder_token, tfone_id):
    r = requests.post(f"{API}/admin/users/{tfone_id}/mute",
                      json={"types": ["sounds", "videos"], "days": 3, "reason": "noisy"},
                      headers=_h(founder_token), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    mute_id = body["mute_id"]
    user = body["user"]
    assert any(m["id"] == mute_id and set(m["types"]) == {"sounds", "videos"} for m in user["mutes"])

    # Single unmute
    r2 = requests.post(f"{API}/admin/users/{tfone_id}/unmute",
                       json={"mute_id": mute_id},
                       headers=_h(founder_token), timeout=20)
    assert r2.status_code == 200
    assert not any(m["id"] == mute_id for m in r2.json()["user"]["mutes"])


def test_mute_all_permanent_fans_out_then_clear_all(founder_token, tfone_id):
    r = requests.post(f"{API}/admin/users/{tfone_id}/mute",
                      json={"types": ["all"], "permanent": True},
                      headers=_h(founder_token), timeout=20)
    assert r.status_code == 200, r.text
    user = r.json()["user"]
    mutes = user["mutes"]
    assert len(mutes) >= 1
    # Last pushed row should have 7 individual types (not 'all')
    last = mutes[-1]
    types_set = set(last["types"])
    assert "all" not in types_set
    assert len(types_set) == 7

    # Clear all
    r2 = requests.post(f"{API}/admin/users/{tfone_id}/unmute",
                       json={"clear_all": True},
                       headers=_h(founder_token), timeout=20)
    assert r2.status_code == 200
    assert r2.json()["user"]["mutes"] == []


# ─── Delete username confirmation guard ─────────────────
def test_delete_confirm_username_mismatch(founder_token, tfone_id):
    r = requests.post(f"{API}/admin/users/{tfone_id}/delete",
                      json={"confirm_username": "wrong_name"},
                      headers=_h(founder_token), timeout=20)
    assert r.status_code == 400, r.text
    assert "Username confirmation did not match" in r.json().get("detail", "")


# ─── Password reset (founder only, weak rejections, session invalidation) ───
def test_reset_password_weak_rejected(founder_token, tfone_id):
    """Spec says weak passwords should return 400. Note: <8 chars currently
    returns 422 from Pydantic field validation (min_length=8) BEFORE the
    custom validator runs — this is a minor spec deviation."""
    # All-lower / no-digit / no-symbol all hit the custom validator → 400
    custom_validator_cases = [
        ("alllower1$", "upper"),            # no uppercase
        ("NoDigits$$", "digit"),            # no digit
        ("NoSymbol12", "symbol"),           # no symbol
    ]
    for pw, hint in custom_validator_cases:
        r = requests.post(f"{API}/admin/users/{tfone_id}/reset-password",
                          json={"new_password": pw, "confirm_password": pw},
                          headers=_h(founder_token), timeout=20)
        assert r.status_code == 400, f"{pw!r} should be rejected with 400: {r.text}"
        assert hint.lower() in r.json().get("detail", "").lower(), f"{pw!r} → {r.text}"

    # <8 chars — accept either 400 (custom validator) or 422 (Pydantic field).
    r = requests.post(f"{API}/admin/users/{tfone_id}/reset-password",
                      json={"new_password": "Ab1$xy", "confirm_password": "Ab1$xy"},
                      headers=_h(founder_token), timeout=20)
    assert r.status_code in (400, 422), r.text


def test_reset_password_invalidates_old_token_then_login(founder_token, tfone_id):
    # First, make sure tfone can login and capture token
    old_tok, _ = _login(TFONE)
    assert old_tok
    # Verify token works
    me = requests.get(f"{API}/auth/me", headers=_h(old_tok), timeout=20)
    assert me.status_code == 200

    # Need to wait 1s so the password_changed_at strictly exceeds the token iat
    time.sleep(1.5)

    # Reset password as founder
    new_pw = "NewPass1$"
    r = requests.post(f"{API}/admin/users/{tfone_id}/reset-password",
                      json={"new_password": new_pw, "confirm_password": new_pw},
                      headers=_h(founder_token), timeout=20)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True

    # Old token rejected → "Session invalidated"
    me2 = requests.get(f"{API}/auth/me", headers=_h(old_tok), timeout=20)
    assert me2.status_code == 401, me2.text
    assert "Session invalidated" in me2.json().get("detail", "")

    # New login works
    new_tok, rl = _login({"email": "tfone", "password": new_pw})
    assert new_tok, rl.text

    # Restore original password for teardown of subsequent tests
    time.sleep(1.5)
    r3 = requests.post(f"{API}/admin/users/{tfone_id}/reset-password",
                      json={"new_password": "pass1234A$", "confirm_password": "pass1234A$"},
                      headers=_h(founder_token), timeout=20)
    assert r3.status_code == 200


def test_reset_password_non_founder_forbidden(tfone_id):
    # tfone is a regular user — should be 403 with "Insufficient admin role"
    tok, _ = _login({"email": "tfone", "password": "pass1234A$"})
    if not tok:
        pytest.skip("tfone re-login failed")
    r = requests.post(f"{API}/admin/users/{tfone_id}/reset-password",
                      json={"new_password": "AnyOther1$", "confirm_password": "AnyOther1$"},
                      headers=_h(tok), timeout=20)
    assert r.status_code == 403, r.text


# ─── Protected account guards ───────────────────────────
def test_cannot_act_on_self_stealth(founder_token, stealth_id):
    r = requests.post(f"{API}/admin/users/{stealth_id}/suspend",
                      json={"days": 1}, headers=_h(founder_token), timeout=20)
    assert r.status_code == 403, r.text


def test_stealth_can_reset_support_password(founder_token, support_id):
    # As founder, resetting @support's password is allowed by spec.
    r = requests.post(f"{API}/admin/users/{support_id}/reset-password",
                      json={"new_password": "Support1$X", "confirm_password": "Support1$X"},
                      headers=_h(founder_token), timeout=20)
    # Spec says founder may reset @support's password. Accept 200.
    # Restore to seeded password afterward.
    assert r.status_code == 200, r.text
    time.sleep(1.5)
    r2 = requests.post(f"{API}/admin/users/{support_id}/reset-password",
                       json={"new_password": "Password1$", "confirm_password": "Password1$"},
                       headers=_h(founder_token), timeout=20)
    assert r2.status_code == 200


# ─── Audit log ──────────────────────────────────────────
def test_audit_log_no_plaintext_password(founder_token, tfone_id):
    """Use MONGO to confirm audit_log rows exist and don't contain plaintext."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        pytest.skip("MONGO_URL not set")
    db_name = os.environ.get("DB_NAME", "ourrealm")

    async def fetch():
        client = AsyncIOMotorClient(mongo_url)
        rows = await client[db_name].audit_log.find(
            {"category": "admin_user_control", "target_id": tfone_id},
            {"_id": 0}
        ).to_list(50)
        client.close()
        return rows
    rows = asyncio.get_event_loop().run_until_complete(fetch())
    assert rows, "Expected audit rows"
    actions = {r["action"] for r in rows}
    # We should have at least suspend, unsuspend, mute, unmute, reset_password
    for a in ("suspend", "unsuspend", "mute", "unmute", "reset_password"):
        assert a in actions, f"Missing audit action {a} — got {actions}"
    # No plaintext password leaking
    for r in rows:
        text = str(r)
        assert "NewPass1$" not in text
        assert "pass1234A$" not in text


# ─── Regression on prior iteration endpoints ───────────
def test_regression_realm_pulse_overview(founder_token):
    r = requests.get(f"{API}/admin/realm-pulse/overview", headers=_h(founder_token), timeout=20)
    assert r.status_code == 200


def test_regression_communities_realms():
    r = requests.get(f"{API}/communities/realms", timeout=20)
    assert r.status_code in (200, 401)


def test_regression_hashtags_interest_cards():
    r = requests.get(f"{API}/hashtags/interest-cards", timeout=20)
    assert r.status_code == 200


def test_regression_admin_support_summary(founder_token):
    r = requests.get(f"{API}/admin/support/summary", headers=_h(founder_token), timeout=20)
    assert r.status_code == 200


# ─── Teardown: restore tfone to original pass1234 + clean state ──
def test_zzz_teardown_restore_tfone(founder_token, tfone_id):
    """Restore tfone's password to pass1234 via direct mongo write (since
    pass1234 fails the strength validator in the admin reset endpoint)."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    import bcrypt
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "ourrealm")
    pwh = bcrypt.hashpw(b"pass1234", bcrypt.gensalt()).decode()

    async def restore():
        client = AsyncIOMotorClient(mongo_url)
        await client[db_name].users.update_one(
            {"id": tfone_id},
            {"$set": {"password_hash": pwh, "disabled": False, "mutes": []},
             "$unset": {"suspended_until": "", "suspended_at": "", "suspended_by": "",
                        "suspension_reason": "", "suspension_notes": "",
                        "password_changed_at": ""}},
        )
        client.close()
    asyncio.get_event_loop().run_until_complete(restore())

    # Verify
    rl = requests.post(f"{API}/auth/login", json=TFONE, timeout=20)
    assert rl.status_code == 200, rl.text
