"""Bundle F tests — reports engine, exports (CSV/XLSX/PDF), idempotency,
claim concurrency, formula-injection safety, saved views, digest preview,
birthday auto-events. Synthetic Center seeded directly (no FP burned)."""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
OWNER = ("stealth", "Password1$")
MANAGER = ("tftwo", "pass1234")
PLAIN = ("auditcheckreal", "Password1$")

CID = f"bftest{uuid.uuid4().hex[:10]}"
CID2 = f"bftest{uuid.uuid4().hex[:10]}"
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


def _iso(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()


@pytest.fixture(scope="module")
def owner():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def manager():
    return _login(*MANAGER)


@pytest.fixture(scope="module")
def plain():
    return _login(*PLAIN)


def test_00_seed(owner):
    async def seed():
        from core.db import db
        uids = {}
        for uname in ("stealth", "tftwo", "auditcheckreal"):
            u = await db.users.find_one({"username": uname}, {"_id": 0, "id": 1})
            uids[uname] = u["id"]
        paid = _iso(datetime.now(timezone.utc) + timedelta(days=25))
        for cid, members in ((CID, [("stealth", "owner"), ("tftwo", "manager"), ("auditcheckreal", "member")]),
                             (CID2, [("stealth", "owner")])):
            await db.responsibility_centers.insert_one({
                "id": cid, "name": f"BF Lab {cid[-4:]}", "center_type": "team", "status": "active",
                "vault_balance": 400, "member_count": len(members), "timezone": "UTC",
                "allow_member_self_tasks": True,
                "created_by": uids["stealth"], "created_at": _iso(), "updated_at": _iso()})
            for uname, role in members:
                await db.responsibility_center_memberships.insert_one({
                    "id": uuid.uuid4().hex, "center_id": cid, "user_id": uids[uname],
                    "role": role, "status": "active", "seat_paid_until": paid, "joined_at": _iso()})
        # ledger rows for fire power / vault reports
        for t, amt in (("center_creation", -1000), ("vault_funding", 300), ("seat_renewal", -100)):
            await db.responsibility_center_transactions.insert_one({
                "id": uuid.uuid4().hex, "center_id": CID, "user_id": uids["stealth"],
                "transaction_type": t, "amount": amt, "status": "completed",
                "created_at": _iso(), "meta": {}})
        return uids
    S["uids"] = _run(seed())
    assert S["uids"]


def _mk_item(tok, title, due=None, assignee=None, complete=False):
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/items", headers=_h(tok),
                      json={"title": title, "assignee_ids": [assignee] if assignee else [],
                            "due_at": due, "client_token": uuid.uuid4().hex}, timeout=15)
    assert r.status_code == 200, r.text[:300]
    iid = r.json()["id"]
    if complete:
        requests.post(f"{BASE_URL}/responsibility-center/{CID}/items/{iid}/actions/complete",
                      headers=_h(tok), json={}, timeout=15)
    return iid


def _report(tok, key, filters=None, cid=CID):
    return requests.post(f"{BASE_URL}/responsibility-center/{cid}/reports/{key}",
                         headers=_h(tok), json={"filters": filters or {}}, timeout=20)


# ── REPORTS ──────────────────────────────────────────────────────────────
def test_work_summary_totals(owner):
    u = S["uids"]
    _mk_item(owner, "BF open item", assignee=u["tftwo"])
    _mk_item(owner, "BF overdue item", due=_iso(datetime.now(timezone.utc) - timedelta(days=2)), assignee=u["tftwo"])
    _mk_item(owner, "BF done item", assignee=u["stealth"], complete=True)
    r = _report(owner, "work_summary")
    assert r.status_code == 200, r.text[:300]
    s = r.json()["summary"]
    assert s["total_items"] == 3 and s["open"] == 2 and s["completed"] == 1
    assert s["overdue"] == 1 and s["completion_rate"] == pytest.approx(33.3, abs=0.2)
    assert any(b["count"] for b in r.json()["breakdowns"]["by_member"])


def test_member_filter_and_workload(owner):
    u = S["uids"]
    r = _report(owner, "work_summary", {"member_id": u["tftwo"]})
    assert r.json()["summary"]["total_items"] == 2  # only tftwo's items
    w = _report(owner, "member_workload").json()
    row = next(x for x in w["rows"] if x["member"] == "@tftwo")
    assert row["open_items"] == 2 and row["overdue"] == 1


def test_report_permissions(plain, manager):
    # plain member: no reports at all
    assert _report(plain, "work_summary").status_code == 403
    cat = requests.get(f"{BASE_URL}/responsibility-center/{CID}/reports", headers=_h(plain), timeout=15)
    assert cat.status_code == 403
    # manager: work yes, fire power / lifecycle no
    assert _report(manager, "work_summary").status_code == 200
    assert _report(manager, "attendance_detail").status_code == 200
    assert _report(manager, "fire_power_activity").status_code == 403
    assert _report(manager, "lifecycle_report").status_code == 403
    # manager catalog hides fire power category reports
    keys = [rep["report_key"] for c in requests.get(
        f"{BASE_URL}/responsibility-center/{CID}/reports", headers=_h(manager), timeout=15).json()["categories"]
        for rep in c["reports"]]
    assert "fire_power_activity" not in keys and "work_summary" in keys


def test_cross_center_blocked(plain):
    assert _report(plain, "work_summary", cid=CID2).status_code == 403


def test_filter_validation(owner):
    assert _report(owner, "work_summary", {"date_from": "junk"}).status_code == 400
    assert _report(owner, "work_summary",
                   {"date_from": "2020-01-01T00:00:00+00:00", "date_to": "2025-01-01T00:00:00+00:00"}).status_code == 400
    assert _report(owner, "nope_report").status_code == 404


def test_fire_power_and_vault_reports(owner):
    fp = _report(owner, "fire_power_activity").json()
    assert fp["summary"]["transactions"] == 3
    assert fp["summary"]["total_fire_power_activity"] == 1400
    types = {b["key"] for b in fp["breakdowns"]["by_type"]}
    assert {"center_creation", "vault_funding", "seat_renewal"} <= types
    v = _report(owner, "vault_report").json()["summary"]
    assert v["current_vault_balance"] == 400
    assert v["fire_power_added"] == 300 and v["fire_power_burned"] == 1100


def test_lifecycle_report_no_false_deletion(owner):
    r = _report(owner, "lifecycle_report").json()
    assert "not implemented" in r["summary"]["permanent_deletion"]


# ── EXPORTS ──────────────────────────────────────────────────────────────
def _export(tok, key, fmt, token=None, filters=None):
    return requests.post(f"{BASE_URL}/responsibility-center/{CID}/reports-export", headers=_h(tok),
                         json={"report_key": key, "format": fmt, "filters": filters or {},
                               "client_token": token or uuid.uuid4().hex},
                         timeout=20)


def _wait_ready(tok, run_id, tries=10):
    import time
    for _ in range(tries):
        runs = requests.get(f"{BASE_URL}/responsibility-center/{CID}/report-runs",
                            headers=_h(tok), timeout=15).json()["runs"]
        row = next((r for r in runs if r["id"] == run_id), None)
        if row and row["status"] in ("ready", "failed"):
            return row
        time.sleep(1)
    return row


def test_export_csv_xlsx_pdf(owner):
    for fmt, magic in (("csv", None), ("xlsx", b"PK"), ("pdf", b"%PDF")):
        r = _export(owner, "work_summary", fmt)
        assert r.status_code == 200, r.text[:300]
        run = _wait_ready(owner, r.json()["run"]["id"])
        assert run and run["status"] == "ready", run
        d = requests.get(f"{BASE_URL}/responsibility-center/{CID}/report-runs/{run['id']}/download",
                         headers=_h(owner), timeout=20)
        assert d.status_code == 200 and len(d.content) > 200
        if magic:
            assert d.content.startswith(magic)
        S.setdefault("runs", {})[fmt] = run["id"]


def test_export_idempotent_token(owner):
    tok = uuid.uuid4().hex
    r1 = _export(owner, "member_workload", "csv", token=tok)
    r2 = _export(owner, "member_workload", "csv", token=tok)
    assert r1.json()["run"]["id"] == r2.json()["run"]["id"]
    assert r2.json().get("duplicate") is True


def test_export_unauthorized(plain, manager):
    assert _export(plain, "work_summary", "csv").status_code == 403
    assert _export(manager, "fire_power_activity", "csv").status_code == 403
    # plain cannot download owner's export
    d = requests.get(f"{BASE_URL}/responsibility-center/{CID}/report-runs/{S['runs']['csv']}/download",
                     headers=_h(plain), timeout=15)
    assert d.status_code == 403


def test_export_formula_injection_neutralized(owner):
    u = S["uids"]
    start = datetime.now(timezone.utc) + timedelta(days=1)
    ev = requests.post(f"{BASE_URL}/responsibility-center/{CID}/events", headers=_h(owner),
                       json={"title": "=2+HYPERLINK(evil)", "start_at": start.isoformat(),
                             "end_at": (start + timedelta(hours=1)).isoformat(),
                             "attendee_ids": [u["tftwo"]], "attendance_enabled": True,
                             "client_token": uuid.uuid4().hex}, timeout=15)
    assert ev.status_code == 200, ev.text[:200]
    r = _export(owner, "attendance_detail", "csv",
                filters={"date_to": _iso(datetime.now(timezone.utc) + timedelta(days=3))})
    run = _wait_ready(owner, r.json()["run"]["id"])
    assert run["status"] == "ready"
    d = requests.get(f"{BASE_URL}/responsibility-center/{CID}/report-runs/{run['id']}/download",
                     headers=_h(owner), timeout=20)
    body = d.content.decode("utf-8-sig")
    assert "'=2+HYPERLINK(evil)" in body and ",=2+HYPERLINK" not in body


def test_export_claim_concurrency(owner):
    async def check():
        from core.db import db
        from services import rc_exports
        run_id = uuid.uuid4().hex
        u = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
        await db.responsibility_center_report_runs.insert_one({
            "id": run_id, "center_id": CID, "report_key": "work_summary",
            "report_name": "Responsibility & Task Summary", "format": "csv",
            "filters": {"date_from": _iso(datetime.now(timezone.utc) - timedelta(days=7)),
                        "date_to": _iso(), "member_id": None, "unit_id": None, "status": None,
                        "priority": None, "item_type": None, "event_type": None,
                        "include_archived": False, "group_by": None},
            "requested_by": u["id"], "requested_by_username": "stealth",
            "status": "queued", "download_token": uuid.uuid4().hex,
            "requested_at": _iso(), "created_at": _iso(), "updated_at": _iso()})
        await asyncio.gather(rc_exports.run_export_pass(), rc_exports.run_export_pass())
        files = await db.responsibility_center_report_files.count_documents({"run_id": run_id})
        row = await db.responsibility_center_report_runs.find_one({"id": run_id}, {"_id": 0, "status": 1})
        return files, row["status"]
    files, status = _run(check())
    assert files == 1 and status == "ready"


def test_export_expiry_and_retry(owner):
    run_id = S["runs"]["csv"]
    async def expire():
        from core.db import db
        from services import rc_exports
        past = _iso(datetime.now(timezone.utc) - timedelta(hours=1))
        await db.responsibility_center_report_runs.update_one(
            {"id": run_id}, {"$set": {"expires_at": past}})
        await db.responsibility_center_report_files.update_one(
            {"run_id": run_id}, {"$set": {"expires_at": past}})
        await rc_exports.run_export_pass()  # expiry sweep
        row = await db.responsibility_center_report_runs.find_one({"id": run_id}, {"_id": 0, "status": 1})
        return row["status"]
    assert _run(expire()) == "expired"
    d = requests.get(f"{BASE_URL}/responsibility-center/{CID}/report-runs/{run_id}/download",
                     headers=_h(owner), timeout=15)
    assert d.status_code == 410
    rt = requests.post(f"{BASE_URL}/responsibility-center/{CID}/report-runs/{run_id}/retry",
                       headers=_h(owner), timeout=15)
    assert rt.status_code == 200
    row = _wait_ready(owner, run_id)
    assert row["status"] == "ready"


# ── SAVED VIEWS ──────────────────────────────────────────────────────────
def test_saved_views(owner):
    tok = uuid.uuid4().hex
    body = {"report_key": "work_summary", "name": "My weekly view", "filters": {}, "client_token": tok}
    r1 = requests.post(f"{BASE_URL}/responsibility-center/{CID}/saved-report-views", headers=_h(owner), json=body, timeout=15)
    r2 = requests.post(f"{BASE_URL}/responsibility-center/{CID}/saved-report-views", headers=_h(owner), json=body, timeout=15)
    assert r1.status_code == 200 and r2.json().get("duplicate") is True
    vid = r1.json()["view"]["id"]
    views = requests.get(f"{BASE_URL}/responsibility-center/{CID}/saved-report-views", headers=_h(owner), timeout=15).json()["views"]
    assert len([v for v in views if v["id"] == vid]) == 1
    assert requests.delete(f"{BASE_URL}/responsibility-center/{CID}/saved-report-views/{vid}", headers=_h(owner), timeout=15).status_code == 200
    bad = requests.post(f"{BASE_URL}/responsibility-center/{CID}/saved-report-views", headers=_h(owner),
                        json={"report_key": "nope", "name": "x"}, timeout=15)
    assert bad.status_code == 404


# ── DIGEST PREVIEW ───────────────────────────────────────────────────────
def test_digest_preview_no_side_effects(plain):
    u = S["uids"]
    async def before():
        from core.db import db
        return await db.responsibility_center_digest_log.count_documents({"user_id": u["auditcheckreal"]})
    n_before = _run(before())
    r = requests.get(f"{BASE_URL}/responsibility-center/digest/preview", headers=_h(plain), timeout=20)
    assert r.status_code == 200
    p = r.json()
    assert p["label"] == "Preview — Not Sent" and p["preview"] is True
    assert p["empty"] == (sum(p["counts"].values()) == 0)
    if p["empty"]:
        assert "Nothing is currently scheduled" in p["empty_message"]
    assert _run(before()) == n_before  # no digest_log row, dedup untouched


# ── BIRTHDAY AUTO-EVENTS ─────────────────────────────────────────────────
def test_birthday_defaults_and_consent(owner, plain):
    g = requests.get(f"{BASE_URL}/responsibility-center/{CID}/birthday-settings", headers=_h(plain), timeout=15).json()
    assert g["birthday_auto_events_enabled"] is False and g["my_consent"] is False
    # plain cannot change center settings
    assert requests.patch(f"{BASE_URL}/responsibility-center/{CID}/birthday-settings",
                          headers=_h(plain), json={"birthday_auto_events_enabled": True}, timeout=15).status_code == 403
    # consent requires valid month/day
    assert requests.post(f"{BASE_URL}/responsibility-center/{CID}/birthday-consent",
                         headers=_h(plain), json={"consented": True}, timeout=15).status_code == 400
    nxt = datetime.now(timezone.utc) + timedelta(days=10)
    ok = requests.post(f"{BASE_URL}/responsibility-center/{CID}/birthday-consent", headers=_h(plain),
                       json={"consented": True, "birth_month": nxt.month, "birth_day": nxt.day}, timeout=15)
    assert ok.status_code == 200
    S["bday"] = (nxt.month, nxt.day)


def test_birthday_generation_requires_center_enable(owner, plain):
    u = S["uids"]
    async def gen():
        from core.db import db
        from services import rc_exports
        await rc_exports.run_birthday_pass()
        return await db.responsibility_center_calendar_events.count_documents(
            {"center_id": CID, "event_type": "birthday", "status": "scheduled"})
    assert _run(gen()) == 0  # center still disabled → no event
    assert requests.patch(f"{BASE_URL}/responsibility-center/{CID}/birthday-settings",
                          headers=_h(owner), json={"birthday_auto_events_enabled": True}, timeout=15).status_code == 200
    async def gen2():
        from core.db import db
        from services import rc_exports
        await asyncio.gather(rc_exports.run_birthday_pass(), rc_exports.run_birthday_pass())
        evs = await db.responsibility_center_calendar_events.find(
            {"center_id": CID, "event_type": "birthday", "status": "scheduled"}, {"_id": 0}).to_list(10)
        return evs
    evs = _run(gen2())
    assert len(evs) == 1  # concurrent workers → exactly one yearly event
    assert "Birthday" in evs[0]["title"]
    S["bday_event"] = evs[0]["id"]


def test_birthday_consent_withdrawal_removes_event(plain):
    ok = requests.post(f"{BASE_URL}/responsibility-center/{CID}/birthday-consent",
                       headers=_h(plain), json={"consented": False}, timeout=15)
    assert ok.status_code == 200
    async def check():
        from core.db import db
        return await db.responsibility_center_calendar_events.count_documents(
            {"center_id": CID, "event_type": "birthday", "status": "scheduled"})
    assert _run(check()) == 0


# ── ADMIN ────────────────────────────────────────────────────────────────
def test_admin_overview(owner, manager):
    r = requests.get(f"{BASE_URL}/admin/responsibility-center/reports/overview", headers=_h(owner), timeout=20)
    assert r.status_code == 200 and isinstance(r.json()["centers_created"], int)
    assert requests.get(f"{BASE_URL}/admin/responsibility-center/reports/overview",
                        headers=_h(manager), timeout=15).status_code == 403


def test_zz_cleanup():
    async def cleanup():
        from core.db import db
        u = S["uids"]
        for cid in (CID, CID2):
            for coll in ("responsibility_centers", "responsibility_center_memberships",
                         "responsibility_items", "responsibility_item_activity",
                         "responsibility_center_transactions", "responsibility_center_activity_logs",
                         "responsibility_center_calendar_events", "responsibility_center_report_runs",
                         "responsibility_center_report_files", "responsibility_center_saved_report_views",
                         "responsibility_center_birthday_consents", "responsibility_center_birthday_events",
                         "responsibility_center_units", "responsibility_center_unit_memberships"):
                await db[coll].delete_many({"center_id": cid})
        await db.notifications.delete_many({"payload.center_id": {"$in": [CID, CID2]}})
    _run(cleanup())
    assert True
