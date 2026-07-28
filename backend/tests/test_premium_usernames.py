"""Premium Usernames — essential tests (feature + bulk admin tool).

Covers: grandfathering, signup gate, default tier pricing, threshold and
price edits, custom-cost override, Vault-only atomic unlock, idempotency,
case-insensitivity, rule blocking, NPC sequence, bulk parsing/apply,
audit logging, admin permission.
"""
import os
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

from tests._shared_loop import get_shared_loop


def _run(coro):
    return get_shared_loop().run_until_complete(coro)


def _login(u, p):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text[:200]
    return r.json()["access_token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


DEFAULT_TIERS = {"1": 1000000, "2": 500000, "3": 100000, "4": 10000, "5": 1000, "6": 500}
_CLEAN = {"rule_names": [], "users": []}


@pytest.fixture(scope="module")
def admin_token():
    return _login("stealth", "Password1$")


@pytest.fixture(scope="module")
def member_token():
    return _login("auditcheckreal", "Password1$")


@pytest.fixture(scope="module", autouse=True)
def _restore(admin_token):
    yield
    # restore default config + clean test rules/claims/users
    requests.put(f"{BASE_URL}/api/premium-usernames/admin/config", headers=_h(admin_token),
                 json={"enabled": True, "max_premium_len": 6, "tier_costs": DEFAULT_TIERS,
                       "tier_enabled": {k: True for k in DEFAULT_TIERS},
                       "require_verification": False, "change_cooldown_days": 7,
                       "maintenance_lock": False, "min_account_age_days": 0}, timeout=30)

    async def go():
        from core.db import db
        if _CLEAN["rule_names"]:
            await db.username_rules.delete_many({"username": {"$in": _CLEAN["rule_names"]}})
        await db.username_rules.delete_many({"username": {"$regex": "^put_"}})
        await db.username_claims.delete_many({"username": {"$regex": "^put_|^pux"}})
        if _CLEAN["users"]:
            await db.users.delete_many({"id": {"$in": _CLEAN["users"]}})
        await db.fire_wallet_transactions.delete_many({"pricing_rule": {"$exists": True},
                                                       "new_username": {"$regex": "^pux"}})
    _run(go())


# ------------------------------------------------- migration / grandfather

def test_existing_users_grandfathered_and_idempotent(admin_token):
    # first admin call triggers lazy migration; call twice => idempotent
    for _ in range(2):
        r = requests.get(f"{BASE_URL}/api/premium-usernames/admin/stats",
                         headers=_h(admin_token), timeout=30)
        assert r.status_code == 200

    async def go():
        from core.db import db
        total = await db.users.count_documents({})
        gf = await db.users.count_documents({"username_grandfathered": True})
        markers = await db.migrations.count_documents({"id": "premium_username_grandfather"})
        u = await db.users.find_one({"username": "stealth"}, {"_id": 0,
                                    "username_grandfathered": 1, "premium_username_exempt": 1})
        return total, gf, markers, u
    total, gf, markers, u = _run(go())
    assert markers == 1
    assert gf > 0 and gf <= total
    assert u["username_grandfathered"] is True and u["premium_username_exempt"] is True


# ------------------------------------------------------------ signup gate

def _register(username):
    return requests.post(f"{BASE_URL}/api/auth/register", json={
        "username": username, "email": f"{uuid.uuid4().hex[:10]}@example.com",
        "password": "Password1$", "name": "PU Test",
        "accepted_terms": True, "accepted_privacy": True,
        "accepted_conditions": True, "age_confirmed_13": True,
    }, timeout=30)


def test_signup_blocks_premium_length():
    r = _register("puxy1")  # 5 chars => premium
    assert r.status_code == 422, r.text[:300]
    d = r.json()["detail"]
    assert "Premium username locked" in d["message"]
    assert isinstance(d["suggestions"], list) and d["suggestions"]


def test_signup_check_endpoint_reflects_gate():
    r = requests.post(f"{BASE_URL}/api/auth/username/check",
                      json={"username": "puxy2"}, timeout=30)
    d = r.json()
    assert d["available"] is False and d["reason"] == "premium_locked"
    assert all(s for s in d["suggestions"])


def test_signup_allows_seven_chars():
    u = f"put_{uuid.uuid4().hex[:8]}"  # 12 chars, standard
    r = _register(u)
    assert r.status_code == 200, r.text[:300]
    _CLEAN["users"].append(r.json()["user"]["id"])


# --------------------------------------------------------------- pricing

def test_default_tier_costs(admin_token):
    for L, cost in DEFAULT_TIERS.items():
        name = "z" * int(L)
        r = requests.get(f"{BASE_URL}/api/premium-usernames/check?u={name}",
                         headers=_h(admin_token), timeout=30)
        d = r.json()
        if d["status"] in ("available", "insufficient_vault"):
            assert d["cost"] == cost, f"len {L}: {d}"
            assert d["premium"] is True


def test_seven_chars_standard(admin_token):
    r = requests.get(f"{BASE_URL}/api/premium-usernames/check?u=zzzzzzz",
                     headers=_h(admin_token), timeout=30)
    d = r.json()
    assert d["premium"] is False and d["status"] == "standard"


def test_threshold_change_applies_immediately(admin_token):
    r = requests.put(f"{BASE_URL}/api/premium-usernames/admin/config",
                     headers=_h(admin_token),
                     json={"max_premium_len": 5}, timeout=30)
    assert r.status_code == 200
    # 6 chars now standard
    d = requests.get(f"{BASE_URL}/api/premium-usernames/check?u=zzzzzz",
                     headers=_h(admin_token), timeout=30).json()
    assert d["premium"] is False
    # signup gate follows too
    d2 = requests.post(f"{BASE_URL}/api/auth/username/check",
                       json={"username": "zzzzzz"}, timeout=30).json()
    assert d2.get("available") is True
    # restore
    requests.put(f"{BASE_URL}/api/premium-usernames/admin/config",
                 headers=_h(admin_token), json={"max_premium_len": 6}, timeout=30)


def test_tier_price_change(admin_token):
    r = requests.put(f"{BASE_URL}/api/premium-usernames/admin/config",
                     headers=_h(admin_token), json={"tier_costs": {"6": 777}}, timeout=30)
    assert r.status_code == 200
    d = requests.get(f"{BASE_URL}/api/premium-usernames/check?u=qqqqqq",
                     headers=_h(admin_token), timeout=30).json()
    assert d["cost"] == 777
    requests.put(f"{BASE_URL}/api/premium-usernames/admin/config",
                 headers=_h(admin_token), json={"tier_costs": {"6": 500}}, timeout=30)


def test_custom_rule_overrides_price(admin_token):
    _CLEAN["rule_names"].append("puxcust")
    r = requests.post(f"{BASE_URL}/api/premium-usernames/admin/rule", headers=_h(admin_token),
                      json={"username": "puxcust", "custom_cost": 42, "reason": "test override"},
                      timeout=30)
    assert r.status_code == 200
    # puxcust = 7 chars but custom cost applies only to premium names;
    # use a 6-char custom name instead
    _CLEAN["rule_names"].append("puxcus")
    requests.post(f"{BASE_URL}/api/premium-usernames/admin/rule", headers=_h(admin_token),
                  json={"username": "puxcus", "custom_cost": 42, "reason": "test override"}, timeout=30)
    d = requests.get(f"{BASE_URL}/api/premium-usernames/check?u=puxcus",
                     headers=_h(admin_token), timeout=30).json()
    assert d["cost"] == 42 and d["pricing_rule"] == "custom"


# ------------------------------------------------------------ rule blocks

def test_reserved_prohibited_retired_blocked(admin_token, member_token):
    for status in ("reserved", "prohibited", "retired"):
        name = f"pux{status[:3]}"
        _CLEAN["rule_names"].append(name)
        requests.post(f"{BASE_URL}/api/premium-usernames/admin/rule", headers=_h(admin_token),
                      json={"username": name, "status": status, "reason": "test"}, timeout=30)
        d = requests.get(f"{BASE_URL}/api/premium-usernames/check?u={name}",
                         headers=_h(member_token), timeout=30).json()
        assert d["status"] in ("reserved", "prohibited", "retired"), d
        r = requests.post(f"{BASE_URL}/api/premium-usernames/unlock", headers=_h(member_token),
                          json={"username": name, "idempotency_key": uuid.uuid4().hex}, timeout=30)
        assert r.status_code == 409


def test_verification_required_rejects_unverified(admin_token, member_token):
    _CLEAN["rule_names"].append("puxver")
    requests.post(f"{BASE_URL}/api/premium-usernames/admin/rule", headers=_h(admin_token),
                  json={"username": "puxver", "status": "verification_required",
                        "reason": "test"}, timeout=30)
    r = requests.post(f"{BASE_URL}/api/premium-usernames/unlock", headers=_h(member_token),
                      json={"username": "puxver", "idempotency_key": uuid.uuid4().hex}, timeout=30)
    assert r.status_code == 403


# --------------------------------------------------------------- unlock

def _vault(uid_username):
    async def go():
        from core.db import db
        u = await db.users.find_one({"username": uid_username}, {"_id": 0, "id": 1})
        w = await db.fire_wallets.find_one({"user_id": u["id"]}, {"_id": 0, "vault_balance": 1})
        return u["id"], int((w or {}).get("vault_balance") or 0)
    return _run(go())


def _set_vault(user_id, amount):
    async def go():
        from core.db import db
        await db.fire_wallets.update_one({"user_id": user_id},
                                         {"$set": {"vault_balance": amount}}, upsert=True)
    _run(go())


def test_insufficient_balance_blocks_and_changes_nothing(member_token):
    uid, before = _vault("auditcheckreal")
    _set_vault(uid, 3)
    try:
        r = requests.post(f"{BASE_URL}/api/premium-usernames/unlock", headers=_h(member_token),
                          json={"username": "puxpo6", "idempotency_key": uuid.uuid4().hex}, timeout=30)
        assert r.status_code == 402
        uid2, after = _vault("auditcheckreal")
        assert after == 3  # unchanged

        async def go():
            from core.db import db
            u = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1})
            claim = await db.username_claims.find_one({"username": "puxpo6"})
            return u["username"], claim
        un, claim = _run(go())
        assert un == "auditcheckreal" and claim is None  # claim released
    finally:
        _set_vault(uid, before)


def test_unlock_success_charges_exactly_once_case_insensitive(admin_token):
    """Uses a throwaway registered user; unlock 'PuXWin' (case-insensitive),
    verify single charge, idempotent replay, ledger + history + content link."""
    uname = f"put_{uuid.uuid4().hex[:8]}"
    r = _register(uname)
    assert r.status_code == 200
    uid = r.json()["user"]["id"]
    _CLEAN["users"].append(uid)
    tok = r.json().get("access_token") or _login(uname, "Password1$")
    _set_vault(uid, 600)
    key = uuid.uuid4().hex
    target = "puxw6a"  # 6 chars => 500
    _CLEAN["rule_names"].append(target)
    r = requests.post(f"{BASE_URL}/api/premium-usernames/unlock", headers=_h(tok),
                      json={"username": "PuXW6A", "idempotency_key": key}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d["username"] == target and d["fire_burned"] == 500
    assert d["vault_balance_before"] == 600 and d["vault_balance_after"] == 100
    # idempotent replay — no double charge
    r2 = requests.post(f"{BASE_URL}/api/premium-usernames/unlock", headers=_h(tok),
                       json={"username": "PuXW6A", "idempotency_key": key}, timeout=30)
    assert r2.status_code == 200 and r2.json().get("idempotent_replay") is True
    _, bal = _vault(target)
    assert bal == 100

    async def go():
        from core.db import db
        u = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1})
        tx = await db.fire_wallet_transactions.count_documents(
            {"user_id": uid, "type": "premium_username_burn"})
        hist = await db.username_history.find_one({"user_id": uid}, {"_id": 0})
        audit = await db.audit_log.find_one({"action": "premium_username_unlock",
                                             "target_user_id": uid}, {"_id": 0})
        old_rule = await db.username_rules.find_one({"username": uname}, {"_id": 0})
        return u, tx, hist, audit, old_rule
    u, tx, hist, audit, old_rule = _run(go())
    assert u["username"] == target and tx == 1
    assert hist["old_username"] == uname and hist["new_username"] == target
    assert audit is not None
    assert old_rule is None  # old 12-char name is standard, not auto-retired
    # taken for everyone else now (case-insensitive)
    d = requests.get(f"{BASE_URL}/api/premium-usernames/check?u=PUXW6A",
                     headers=_h(admin_token), timeout=30).json()
    assert d["status"] == "taken"


def test_wallet_history_shows_burn_not_rankings(admin_token):
    async def go():
        from core.db import db
        tx = await db.fire_wallet_transactions.find_one(
            {"type": "premium_username_burn", "new_username": "puxw6a"}, {"_id": 0})
        return tx
    tx = _run(go())
    assert tx and tx["label"] == "Premium Username Unlock"
    assert "burned" in tx["description"] and tx["amount"] == -500
    assert tx.get("post_id") is None  # never attached to content fire


# ----------------------------------------------------------- NPC sequence

def test_npc_sequence_atomic_never_reused(admin_token):
    peek = requests.get(f"{BASE_URL}/api/premium-usernames/admin/stats",
                        headers=_h(admin_token), timeout=30).json()["next_npc_number"]
    # wrong number rejected
    r = _register(f"npc_{peek + 5}")
    assert r.status_code == 422
    # correct number accepted + consumed
    r = _register(f"npc_{peek}")
    assert r.status_code == 200, r.text[:300]
    _CLEAN["users"].append(r.json()["user"]["id"])
    peek2 = requests.get(f"{BASE_URL}/api/premium-usernames/admin/stats",
                         headers=_h(admin_token), timeout=30).json()["next_npc_number"]
    assert peek2 == peek + 1
    # same number can never be issued again
    r = _register(f"npc_{peek}")
    assert r.status_code in (400, 422)

    async def go():
        from core.db import db
        return await db.npc_issuance.find_one({"seq": peek}, {"_id": 0})
    rec = _run(go())
    assert rec and rec["reusable"] is False


# ------------------------------------------------------------- admin gate

def test_admin_endpoints_require_admin(member_token):
    for m, path, body in [
            ("get", "/admin/config", None), ("get", "/admin/stats", None),
            ("put", "/admin/config", {"max_premium_len": 3}),
            ("post", "/admin/bulk", {"text": "abc", "action": "reserved", "apply": True, "reason": "x"})]:
        fn = getattr(requests, m)
        kw = {"headers": _h(member_token), "timeout": 30}
        if body is not None:
            kw["json"] = body
        r = fn(f"{BASE_URL}/api/premium-usernames{path}", **kw)
        assert r.status_code in (401, 403), f"{path}: {r.status_code}"


# ----------------------------------------------------------------- bulk

def test_bulk_parse_commas_lines_spaces_dupes(admin_token):
    text = "  puxJohn , puxSally\npuxSusy,\n PUXJOHN \n\n"
    r = requests.post(f"{BASE_URL}/api/premium-usernames/admin/bulk", headers=_h(admin_token),
                      json={"text": text, "action": "premium_custom_cost",
                            "custom_cost": 25000, "apply": False}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    rows = r.json()["rows"]
    names = [x["username"] for x in rows]
    assert names.count("puxjohn") == 2  # once unique + once duplicate-flagged
    dup = [x for x in rows if x["username"] == "puxjohn" and x["result"] == "duplicate"]
    assert len(dup) == 1
    assert {"puxjohn", "puxsally", "puxsusy"} <= set(names)
    assert r.json()["applied"] is False  # preview writes nothing


def test_bulk_apply_custom_cost_and_idempotent(admin_token):
    _CLEAN["rule_names"] += ["puxjohn", "puxsally", "puxsusy"]
    body = {"text": "puxJohn, puxSally, puxSusy", "action": "premium_custom_cost",
            "custom_cost": 25000, "apply": True, "reason": "bulk test"}
    r = requests.post(f"{BASE_URL}/api/premium-usernames/admin/bulk",
                      headers=_h(admin_token), json=body, timeout=30)
    assert r.status_code == 200
    s = r.json()["summary"]
    assert s["updated"] == 3
    # every submitted name got a result
    assert all(x["result"] for x in r.json()["rows"])
    # cost applies (7-char names but force_premium locks them)
    d = requests.get(f"{BASE_URL}/api/premium-usernames/check?u=puxjohn",
                     headers=_h(admin_token), timeout=30).json()
    assert d["premium"] is True and d["cost"] == 25000
    # signup now locked for these names
    d2 = requests.post(f"{BASE_URL}/api/auth/username/check",
                       json={"username": "puxsally"}, timeout=30).json()
    assert d2["available"] is False
    # idempotent re-run — updates 0, matched 3, no duplicate records
    r2 = requests.post(f"{BASE_URL}/api/premium-usernames/admin/bulk",
                       headers=_h(admin_token), json=body, timeout=30)
    s2 = r2.json()["summary"]
    assert s2["updated"] == 0 and s2["already_matched"] == 3

    async def go():
        from core.db import db
        n = await db.username_rules.count_documents({"username": "puxjohn"})
        bulk = await db.audit_log.find_one({"action": "premium_username_bulk",
                                            "bulk_action": "premium_custom_cost"}, {"_id": 0})
        items = await db.audit_log.count_documents({"action": "premium_username_bulk_item",
                                                    "username": "puxjohn"})
        return n, bulk, items
    n, bulk, items = _run(go())
    assert n == 1 and bulk is not None and items >= 1


def test_bulk_standard_price_per_length(admin_token):
    _CLEAN["rule_names"] += ["puxa1", "puxa12"]
    r = requests.post(f"{BASE_URL}/api/premium-usernames/admin/bulk", headers=_h(admin_token),
                      json={"text": "puxa1\npuxa12", "action": "premium_standard_price",
                            "apply": True, "reason": "std price test"}, timeout=30)
    rows = {x["username"]: x for x in r.json()["rows"]}
    assert rows["puxa1"]["new_cost"] == 1000    # 5 chars
    assert rows["puxa12"]["new_cost"] == 500    # 6 chars


def test_bulk_skips_invalid_and_owned(admin_token):
    r = requests.post(f"{BASE_URL}/api/premium-usernames/admin/bulk", headers=_h(admin_token),
                      json={"text": "bad!!name, stealth, puxfree", "action": "reserved",
                            "apply": True, "reason": "skip test"}, timeout=30)
    _CLEAN["rule_names"].append("puxfree")
    rows = {x["username"]: x for x in r.json()["rows"] if x["username"]}
    assert rows.get("stealth", {}).get("result") == "skipped_owned"
    assert any(x["result"] == "invalid" for x in r.json()["rows"])
    assert rows["puxfree"]["result"] == "updated"

    async def go():
        from core.db import db
        u = await db.users.find_one({"username": "stealth"}, {"_id": 0, "username": 1})
        return u
    assert _run(go())["username"] == "stealth"  # owner untouched


def test_bulk_zero_cost_only_for_free_rules(admin_token):
    r = requests.post(f"{BASE_URL}/api/premium-usernames/admin/bulk", headers=_h(admin_token),
                      json={"text": "puxzero", "action": "premium_custom_cost",
                            "custom_cost": 0, "apply": True, "reason": "x"}, timeout=30)
    assert r.status_code == 400


# --------------------------------------- unified username change (lean patch)

def test_profile_username_endpoint_standard_and_premium_and_cooldown(admin_token):
    uname = f"put_{uuid.uuid4().hex[:8]}"
    r = _register(uname)
    assert r.status_code == 200
    uid = r.json()["user"]["id"]
    _CLEAN["users"].append(uid)
    tok = r.json().get("access_token") or _login(uname, "Password1$")
    _set_vault(uid, 10)

    # premium-length via OLD endpoint now requires Fire — insufficient => 402, nothing changes
    r = requests.patch(f"{BASE_URL}/api/profile/username", headers=_h(tok),
                       json={"username": "puxz6b"}, timeout=30)
    assert r.status_code == 402, r.text[:200]

    async def uname_now():
        from core.db import db
        return (await db.users.find_one({"id": uid}, {"_id": 0, "username": 1}))["username"]
    assert _run(uname_now()) == uname

    # reserved name blocked through the same endpoint (no API bypass)
    _CLEAN["rule_names"].append("puxrsv")
    requests.post(f"{BASE_URL}/api/premium-usernames/admin/rule", headers=_h(admin_token),
                  json={"username": "puxrsv", "status": "reserved", "reason": "unified test"}, timeout=30)
    r = requests.patch(f"{BASE_URL}/api/profile/username", headers=_h(tok),
                       json={"username": "puxrsv"}, timeout=30)
    assert r.status_code == 409

    # 7+ char rename works free through the shared service
    new_std = f"put_{uuid.uuid4().hex[:8]}"
    r = requests.patch(f"{BASE_URL}/api/profile/username", headers=_h(tok),
                       json={"username": new_std}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    assert r.json()["user"]["username"] == new_std

    async def checks():
        from core.db import db
        hist = await db.username_history.find_one(
            {"user_id": uid, "new_username": new_std}, {"_id": 0})
        burns = await db.fire_wallet_transactions.count_documents(
            {"user_id": uid, "type": "premium_username_burn"})
        return hist, burns
    hist, burns = _run(checks())
    assert hist and hist["method"] == "rename" and hist["fire_cost"] == 0
    assert burns == 0  # standard rename never burns

    # cooldown (default 7 days) now enforced on ALL change paths
    r = requests.patch(f"{BASE_URL}/api/profile/username", headers=_h(tok),
                       json={"username": f"put_{uuid.uuid4().hex[:8]}"}, timeout=30)
    assert r.status_code == 429


def test_unlock_endpoint_accepts_standard_rename(admin_token):
    uname = f"put_{uuid.uuid4().hex[:8]}"
    r = _register(uname)
    uid = r.json()["user"]["id"]
    _CLEAN["users"].append(uid)
    tok = r.json().get("access_token") or _login(uname, "Password1$")
    new_std = f"put_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{BASE_URL}/api/premium-usernames/unlock", headers=_h(tok),
                      json={"username": new_std, "idempotency_key": uuid.uuid4().hex}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d["premium"] is False and d["fire_burned"] == 0
    assert d["username"] == new_std


def test_unpaid_renames_report(admin_token, member_token):
    # simulate the legacy bypass: user renamed to premium-length name w/o burn
    uname = f"put_{uuid.uuid4().hex[:8]}"
    r = _register(uname)
    uid = r.json()["user"]["id"]
    _CLEAN["users"].append(uid)

    async def simulate():
        from core.db import db
        await db.users.update_one({"id": uid}, {"$set": {
            "username": "puxleg", "username_changed_at": "2026-07-20T00:00:00+00:00"}})
    _run(simulate())
    r = requests.get(f"{BASE_URL}/api/premium-usernames/admin/unpaid-renames",
                     headers=_h(admin_token), timeout=30)
    assert r.status_code == 200
    rows = {x["current_username"]: x for x in r.json()["rows"]}
    row = rows.get("puxleg")
    assert row, r.json()
    assert row["user_id"] == uid
    assert row["required_fire_power"] == 500  # 6 chars
    assert row["fire_power_burned"] == 0
    assert "No automatic change made" in row["recommended_repair"]
    # report never modifies anything
    async def still():
        from core.db import db
        return (await db.users.find_one({"id": uid}, {"_id": 0, "username": 1}))["username"]
    assert _run(still()) == "puxleg"
    # admin-only
    r = requests.get(f"{BASE_URL}/api/premium-usernames/admin/unpaid-renames",
                     headers=_h(member_token), timeout=30)
    assert r.status_code in (401, 403)
