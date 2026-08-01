"""Bundle D tests — ownership transfer, departure, pause/archive/restore,
safe closure, retention holds, recovery, export, lifecycle scheduler.

Uses a synthetic Center seeded directly in Mongo (no Fire Power burned)
and removes it afterwards. Live API via REACT_APP_BACKEND_URL.
"""
import asyncio
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
OWNER = ("stealth", "Password1$")     # founder admin too
ADMIN_MEMBER = ("tftwo", "pass1234")
PLAIN = ("auditcheckreal", "Password1$")

CID = f"bdtest{uuid.uuid4().hex[:10]}"
CID2 = f"bdtest{uuid.uuid4().hex[:10]}"
S = {}
_LOOP = None


def _run(coro):
    global _LOOP
    if _LOOP is None:
        _LOOP = asyncio.new_event_loop()
    return _LOOP.run_until_complete(coro)


def _login(u, p):
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": u, "password": p}, timeout=15)
    assert r.status_code == 200, r.text[:200]
    return r.json()["access_token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def owner():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def admin_member():
    return _login(*ADMIN_MEMBER)


@pytest.fixture(scope="module")
def plain():
    return _login(*PLAIN)


def _iso(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()


def test_00_seed_synthetic_center():
    async def seed():
        from core.db import db
        uids = {}
        for uname in ("stealth", "tftwo", "auditcheckreal"):
            u = await db.users.find_one({"username": uname}, {"_id": 0, "id": 1})
            uids[uname] = u["id"]
        paid = _iso(datetime.now(timezone.utc) + timedelta(days=25))
        for cid, name in ((CID, "BD Lifecycle Lab"), (CID2, "BD Closure Lab")):
            await db.responsibility_centers.insert_one({
                "id": cid, "name": name, "center_type": "team", "description": "",
                "status": "active", "vault_balance": 500, "member_count": 3,
                "created_by": uids["stealth"], "created_at": _iso(), "updated_at": _iso()})
            roles = [("stealth", "owner"), ("tftwo", "admin"), ("auditcheckreal", "member")]
            for uname, role in roles:
                await db.responsibility_center_memberships.insert_one({
                    "id": uuid.uuid4().hex, "center_id": cid, "user_id": uids[uname],
                    "role": role, "status": "active", "seat_paid_until": paid,
                    "joined_at": _iso()})
        # one open item assigned to tftwo in CID
        await db.responsibility_items.insert_one({
            "id": uuid.uuid4().hex, "center_id": CID, "item_type": "task",
            "title": "BD open work", "description": "", "status": "in_progress",
            "priority": "normal", "visibility": "center",
            "created_by": uids["stealth"], "created_by_username": "stealth",
            "assignee_ids": [uids["tftwo"]], "reviewer_id": None, "approver_id": None,
            "approval_required": False, "is_self_task": False, "parent_id": None,
            "depends_on": [], "start_at": None, "due_at": None,
            "completed_at": None, "completed_by": None, "estimated_minutes": 0,
            "difficulty": None, "category": None, "labels": [],
            "progress_percent": 0, "progress_method": "manual",
            "checklist": [], "attachments": [], "version": 1,
            "created_at": _iso(), "updated_at": _iso()})
        return uids
    S["uids"] = _run(seed())
    assert S["uids"]["stealth"]


# ── Ownership transfer ───────────────────────────────────────────────────
def _transfer(tok, to_id, role="admin", confirm="BD Lifecycle Lab", cid=CID):
    return requests.post(f"{BASE_URL}/responsibility-center/{cid}/lifecycle/transfer",
                         headers=_h(tok), json={"to_user_id": to_id, "post_transfer_role": role,
                                                "confirm_name": confirm}, timeout=15)


def test_transfer_create_and_validations(owner, admin_member):
    u = S["uids"]
    assert _transfer(admin_member, u["auditcheckreal"]).status_code == 403  # non-owner
    assert _transfer(owner, u["stealth"]).status_code == 400               # self
    assert _transfer(owner, "nonmember-id").status_code == 400             # non-member
    assert _transfer(owner, u["tftwo"], confirm="wrong").status_code == 400
    r = _transfer(owner, u["tftwo"])
    assert r.status_code == 200, r.text[:300]
    S["transfer"] = r.json()
    assert _transfer(owner, u["auditcheckreal"]).status_code == 409        # one pending max
    lc = requests.get(f"{BASE_URL}/responsibility-center/{CID}/lifecycle", headers=_h(owner), timeout=15).json()
    assert lc["ownership_status"] == "transfer_pending" and lc["pending_transfer"]["to_username"] == "tftwo"


def test_transfer_wrong_user_cannot_accept_and_decline(owner, plain, admin_member):
    tid = S["transfer"]["id"]
    url = f"{BASE_URL}/responsibility-center/{CID}/lifecycle/transfer/{tid}/respond"
    assert requests.post(url, headers=_h(plain), json={"accept": True}, timeout=15).status_code == 403
    r = requests.post(url, headers=_h(admin_member), json={"accept": False}, timeout=15)
    assert r.status_code == 200 and r.json()["status"] == "declined"
    # decided requests can't be re-accepted
    assert requests.post(url, headers=_h(admin_member), json={"accept": True}, timeout=15).status_code == 409


def test_transfer_cancel_then_concurrent_accept_single_owner(owner, admin_member):
    u = S["uids"]
    tid = _transfer(owner, u["tftwo"]).json()["id"]
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/transfer/{tid}/cancel",
                      headers=_h(owner), timeout=15)
    assert r.status_code == 200 and r.json()["status"] == "canceled"
    # fresh request, owner keeps "member" role afterwards
    tid = _transfer(owner, u["tftwo"], role="member").json()["id"]
    url = f"{BASE_URL}/responsibility-center/{CID}/lifecycle/transfer/{tid}/respond"
    tok = _login(*ADMIN_MEMBER)
    with ThreadPoolExecutor(max_workers=2) as ex:
        results = list(ex.map(lambda _: requests.post(url, headers=_h(tok),
                                                      json={"accept": True}, timeout=20).status_code, range(2)))
    assert sorted(results) == [200, 409], results

    async def verify():
        from core.db import db
        owners = await db.responsibility_center_memberships.count_documents(
            {"center_id": CID, "role": "owner", "status": "active"})
        new = await db.responsibility_center_memberships.find_one(
            {"center_id": CID, "user_id": S["uids"]["tftwo"]}, {"_id": 0, "role": 1})
        old = await db.responsibility_center_memberships.find_one(
            {"center_id": CID, "user_id": S["uids"]["stealth"]}, {"_id": 0, "role": 1})
        c = await db.responsibility_centers.find_one({"id": CID}, {"_id": 0})
        items = await db.responsibility_items.count_documents({"center_id": CID})
        return owners, new["role"], old["role"], c, items
    owners, new_role, old_role, c, items = _run(verify())
    assert owners == 1 and new_role == "owner" and old_role == "member"
    assert c["vault_balance"] == 500 and c["ownership_status"] == "stable" and items == 1
    assert c.get("ownership_history") and c["ownership_history"][-1]["via"] == "transfer"


def test_transfer_expiry_pass(owner, admin_member):
    # tftwo (current owner) requests a transfer back to stealth, then it expires
    tok = _login(*ADMIN_MEMBER)
    tid = _transfer(tok, S["uids"]["stealth"]).json()["id"]

    async def force_expire():
        from core.db import db
        from services import rc_lifecycle
        await db.responsibility_center_transfers.update_one(
            {"id": tid}, {"$set": {"expires_at": _iso(datetime.now(timezone.utc) - timedelta(hours=1))}})
        r1, r2 = await asyncio.gather(rc_lifecycle.run_lifecycle_pass(),
                                      rc_lifecycle.run_lifecycle_pass())
        t = await db.responsibility_center_transfers.find_one({"id": tid}, {"_id": 0, "status": 1})
        return r1["transfers_expired"] + r2["transfers_expired"], t["status"]
    expired_total, status = _run(force_expire())
    assert status == "expired" and expired_total == 1  # concurrent passes expire once


# ── Recovery ─────────────────────────────────────────────────────────────
def test_recovery_flow(owner, plain):
    # stealth is now an ordinary member of CID → cannot request
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/recovery",
                      headers=_h(owner), json={"reason": "owner is unavailable for weeks"}, timeout=15)
    assert r.status_code == 403
    # promote stealth to admin directly to simulate an eligible high-level member
    _run(_set_role(CID, S["uids"]["stealth"], "admin"))
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/recovery",
                      headers=_h(owner), json={"reason": "owner is unavailable for weeks"}, timeout=15)
    assert r.status_code == 200
    rid = r.json()["id"]
    # deny (stealth is founder admin)
    d = requests.post(f"{BASE_URL}/admin/responsibility-center/{CID}/lifecycle/recovery/{rid}/decide",
                      headers=_h(owner), json={"decision": "deny", "reason": "owner reachable"}, timeout=15)
    assert d.status_code == 200 and d.json()["status"] == "denied"
    # request again and approve → stealth becomes owner again
    rid = requests.post(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/recovery",
                        headers=_h(owner), json={"reason": "owner is unavailable for weeks"}, timeout=15).json()["id"]
    a = requests.post(f"{BASE_URL}/admin/responsibility-center/{CID}/lifecycle/recovery/{rid}/decide",
                      headers=_h(owner), json={"decision": "approve", "reason": "verified unavailable"}, timeout=15)
    assert a.status_code == 200 and a.json()["new_owner_id"] == S["uids"]["stealth"]

    async def owners():
        from core.db import db
        return await db.responsibility_center_memberships.count_documents(
            {"center_id": CID, "role": "owner", "status": "active"})
    assert _run(owners()) == 1


async def _set_role(cid, uid, role):
    from core.db import db
    await db.responsibility_center_memberships.update_one(
        {"center_id": cid, "user_id": uid}, {"$set": {"role": role}})


# ── Leave + removal + reassignment ──────────────────────────────────────
def test_leave_preview_and_owner_blocked(owner, plain):
    p = requests.get(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/leave-preview",
                     headers=_h(plain), timeout=15).json()
    assert p["center_name"] == "BD Lifecycle Lab" and p["is_owner"] is False
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/leave", headers=_h(owner), timeout=15)
    assert r.status_code == 403  # owner can't leave


def test_removal_requires_reason_and_reassigns_work(owner, admin_member):
    u = S["uids"]
    url = f"{BASE_URL}/responsibility-center/{CID}/lifecycle/members/{u['tftwo']}/remove"
    assert requests.post(url, headers=_h(owner), json={"reason": ""}, timeout=15).status_code in (400, 422)
    r = requests.post(url, headers=_h(owner),
                      json={"reason": "test removal", "work_mode": "reassign",
                            "reassign_to": u["auditcheckreal"]}, timeout=15)
    assert r.status_code == 200 and r.json()["work"]["items"] >= 1

    async def verify():
        from core.db import db
        m = await db.responsibility_center_memberships.find_one(
            {"center_id": CID, "user_id": u["tftwo"]}, {"_id": 0, "status": 1})
        it = await db.responsibility_items.find_one(
            {"center_id": CID, "title": "BD open work"}, {"_id": 0, "assignee_ids": 1, "created_by": 1})
        return m["status"], it
    status, it = _run(verify())
    assert status == "removed"
    assert it["assignee_ids"] == [u["auditcheckreal"]]  # reassigned
    assert it["created_by"] == u["stealth"]             # attribution preserved


def test_member_leave_effects(plain):
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/leave", headers=_h(plain), timeout=15)
    assert r.status_code == 200

    async def verify():
        from core.db import db
        m = await db.responsibility_center_memberships.find_one(
            {"center_id": CID, "user_id": S["uids"]["auditcheckreal"]}, {"_id": 0, "status": 1})
        return m["status"]
    assert _run(verify()) == "left"
    # duplicate leave is a clean 4xx, not a second state change
    r2 = requests.post(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/leave", headers=_h(plain), timeout=15)
    assert r2.status_code in (403, 404, 409)


# ── Pause / archive / restore ────────────────────────────────────────────
def test_pause_blocks_work_and_restore_idempotent(owner, admin_member):
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/pause",
                      headers=_h(owner), json={"reason": "seasonal break"}, timeout=15)
    assert r.status_code == 200 and r.json()["status"] == "paused"
    # double pause → 409
    assert requests.post(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/pause",
                         headers=_h(owner), json={"reason": "x"}, timeout=15).status_code == 409
    # owner can read items but not create while paused
    lst = requests.get(f"{BASE_URL}/responsibility-center/{CID}/items", headers=_h(owner), timeout=15)
    assert lst.status_code == 200
    c = requests.post(f"{BASE_URL}/responsibility-center/{CID}/items",
                      headers=_h(owner), json={"title": "should fail"}, timeout=15)
    assert c.status_code == 409
    # restore twice → idempotent
    r1 = requests.post(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/restore", headers=_h(owner), timeout=15)
    r2 = requests.post(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/restore", headers=_h(owner), timeout=15)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r2.json().get("idempotent") or r2.json()["status"] == "active"


def test_archive_and_restore(owner):
    url = f"{BASE_URL}/responsibility-center/{CID}/lifecycle/archive"
    assert requests.post(url, headers=_h(owner), json={"confirm_name": "wrong"}, timeout=15).status_code == 400
    r = requests.post(url, headers=_h(owner), json={"confirm_name": "BD Lifecycle Lab"}, timeout=15)
    assert r.status_code == 200 and r.json()["status"] == "archived"

    async def verify():
        from core.db import db
        c = await db.responsibility_centers.find_one({"id": CID}, {"_id": 0, "status": 1, "vault_balance": 1})
        items = await db.responsibility_items.count_documents({"center_id": CID})
        return c, items
    c, items = _run(verify())
    assert c["status"] == "archived" and c["vault_balance"] == 500 and items == 1
    # archived center excluded from my-work active summaries (member is stealth)
    mw = requests.get(f"{BASE_URL}/responsibility-center/my-work", headers=_h(owner), timeout=15).json()
    for rows in mw["buckets"].values():
        assert all(i["center_id"] != CID for i in rows)
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/restore", headers=_h(owner), timeout=15)
    assert r.status_code == 200 and r.json()["status"] == "active"


# ── Closure ──────────────────────────────────────────────────────────────
def test_closure_request_and_cancel(owner):
    url = f"{BASE_URL}/responsibility-center/{CID2}/lifecycle/close"
    bad = requests.post(url, headers=_h(owner),
                        json={"confirm_name": "BD Closure Lab", "confirm_phrase": "nope", "reason": "done"}, timeout=15)
    assert bad.status_code == 400
    r = requests.post(url, headers=_h(owner),
                      json={"confirm_name": "BD Closure Lab", "confirm_phrase": "CLOSE THIS CENTER",
                            "reason": "project ended"}, timeout=15)
    assert r.status_code == 200
    cl = r.json()["closure"]
    assert cl["status"] in ("review", "requested") and cl["cancellation_deadline"]
    # duplicate request → one active request
    assert requests.post(url, headers=_h(owner),
                         json={"confirm_name": "BD Closure Lab", "confirm_phrase": "CLOSE THIS CENTER",
                               "reason": "again"}, timeout=15).status_code == 409
    # vault frozen while closure pending
    f = requests.post(f"{BASE_URL}/responsibility-center/{CID2}/vault/fund",
                      headers=_h(owner), json={"amount": 10}, timeout=15)
    assert f.status_code == 409
    # owner cancels → prior status restored, vault unfrozen
    c = requests.post(f"{BASE_URL}/responsibility-center/{CID2}/lifecycle/close/cancel",
                      headers=_h(owner), timeout=15)
    assert c.status_code == 200

    async def verify():
        from core.db import db
        return await db.responsibility_centers.find_one(
            {"id": CID2}, {"_id": 0, "status": 1, "vault_frozen": 1, "closure.status": 1})
    c2 = _run(verify())
    assert c2["status"] == "active" and not c2.get("vault_frozen") and c2["closure"]["status"] == "canceled"


def test_closure_approval_retention_hold_and_completion(owner):
    url = f"{BASE_URL}/responsibility-center/{CID2}/lifecycle/close"
    r = requests.post(url, headers=_h(owner),
                      json={"confirm_name": "BD Closure Lab", "confirm_phrase": "CLOSE THIS CENTER",
                            "reason": "final closure"}, timeout=15)
    assert r.status_code == 200
    a = requests.post(f"{BASE_URL}/admin/responsibility-center/{CID2}/lifecycle/closure/decide",
                      headers=_h(owner), json={"decision": "approve", "reason": "reviewed and safe"}, timeout=15)
    assert a.status_code == 200
    # retention hold blocks completion even past the deadline
    h = requests.post(f"{BASE_URL}/admin/responsibility-center/{CID2}/lifecycle/retention-hold",
                      headers=_h(owner), json={"hold": True, "reason": "pending fraud check"}, timeout=15)
    assert h.status_code == 200

    async def force_deadline_and_run():
        from core.db import db
        from services import rc_lifecycle
        await db.responsibility_centers.update_one(
            {"id": CID2}, {"$set": {"closure.cancellation_deadline": _iso(datetime.now(timezone.utc) - timedelta(hours=1))}})
        await rc_lifecycle.run_lifecycle_pass()
        return await db.responsibility_centers.find_one({"id": CID2}, {"_id": 0, "status": 1, "closure": 1})
    c = _run(force_deadline_and_run())
    assert c["status"] != "closed" and c["closure"]["status"] == "approved"  # hold blocked it
    # remove hold → concurrent passes complete exactly once
    requests.post(f"{BASE_URL}/admin/responsibility-center/{CID2}/lifecycle/retention-hold",
                  headers=_h(owner), json={"hold": False, "reason": "check cleared"}, timeout=15)

    async def complete():
        from core.db import db
        from services import rc_lifecycle
        r1, r2 = await asyncio.gather(rc_lifecycle.run_lifecycle_pass(), rc_lifecycle.run_lifecycle_pass())
        c = await db.responsibility_centers.find_one({"id": CID2}, {"_id": 0})
        return r1["closures_completed"] + r2["closures_completed"], c
    total, c = _run(complete())
    assert total == 1, f"closure completed {total} times"
    assert c["status"] == "closed" and c["closure"]["status"] == "completed"
    assert c["closure"]["final_vault_balance"] == 500 and c.get("vault_frozen")
    # closed center blocks ordinary work access
    lst = requests.get(f"{BASE_URL}/responsibility-center/{CID2}/items", headers=_h(owner), timeout=15)
    assert lst.status_code == 409


# ── Export ───────────────────────────────────────────────────────────────
def test_export_owner_only(owner, plain):
    r = requests.get(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/export", headers=_h(owner), timeout=30)
    assert r.status_code == 200
    data = r.json()
    for section in ("center", "members", "items", "vault_transactions", "lifecycle_audit", "ownership_transfers"):
        assert section in data, section
    assert data["center"]["id"] == CID
    p = requests.get(f"{BASE_URL}/responsibility-center/{CID}/lifecycle/export", headers=_h(plain), timeout=15)
    assert p.status_code == 403  # left member can't export


def test_lifecycle_audit_trail(owner):
    r = requests.get(f"{BASE_URL}/admin/responsibility-center/{CID}/lifecycle", headers=_h(owner), timeout=15)
    assert r.status_code == 200
    actions = {a["action"] for a in r.json()["lifecycle_audit"]}
    for expected in ("transfer_requested", "transfer_accepted", "recovery_approved",
                     "center_paused", "center_restored", "center_archived", "member_removed"):
        assert expected in actions, f"missing audit action {expected}: {actions}"


def test_zz_cleanup():
    async def clean():
        from core.db import db
        n = 0
        for cid in (CID, CID2):
            n += (await db.responsibility_centers.delete_many({"id": cid})).deleted_count
            await db.responsibility_center_memberships.delete_many({"center_id": cid})
            await db.responsibility_items.delete_many({"center_id": cid})
            await db.responsibility_center_transfers.delete_many({"center_id": cid})
            await db.responsibility_center_recovery_requests.delete_many({"center_id": cid})
            await db.responsibility_center_lifecycle_audit.delete_many({"center_id": cid})
            await db.responsibility_center_activity_logs.delete_many({"center_id": cid})
        return n
    assert _run(clean()) == 2
