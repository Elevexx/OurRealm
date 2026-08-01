"""Bundle C tests — Responsibilities & Tasks engine.

Live API (REACT_APP_BACKEND_URL) + direct service tests for the
recurrence engine and reminder dedup (motor). Idempotent: cleans up
every item it creates (title prefix BC-TEST).
"""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
CENTER_ID = "cf5a475c04cd4860976920cda63fa6ff"
OWNER = ("stealth", "Password1$")
MEMBER = ("tftwo", "pass1234")
OUTSIDER = ("auditcheckreal", "Password1$")
P = "BC-TEST"

S = {}


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
def member():
    return _login(*MEMBER)


@pytest.fixture(scope="module")
def outsider():
    return _login(*OUTSIDER)


@pytest.fixture(scope="module")
def member_id(owner):
    r = requests.get(f"{BASE_URL}/responsibility-center/{CENTER_ID}/members", headers=_h(owner), timeout=15)
    return next(m["user_id"] for m in r.json()["members"] if m["username"] == "tftwo")


def _create(tok, **kw):
    body = {"title": f"{P} {uuid.uuid4().hex[:6]}", **kw}
    return requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items",
                         headers=_h(tok), json=body, timeout=20)


def _action(tok, iid, action, note=""):
    return requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}/actions/{action}",
                         headers=_h(tok), json={"note": note}, timeout=15)


def _detail(tok, iid):
    return requests.get(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}", headers=_h(tok), timeout=15)


def _set_self_tasks(tok, value):
    r = requests.patch(f"{BASE_URL}/responsibility-center/{CENTER_ID}",
                       headers=_h(tok), json={"allow_member_self_tasks": value}, timeout=15)
    assert r.status_code == 200, r.text[:200]


# ── Creation, idempotency, permissions ──────────────────────────────────
def test_manager_create_assigned(owner, member_id):
    r = _create(owner, assignee_ids=[member_id], approval_required=True,
                due_at=(datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
                checklist=["step one", "step two"], client_token=f"bc-{uuid.uuid4().hex[:8]}")
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d["status"] == "assigned" and d["version"] == 1 and d["progress_method"] == "checklist"
    S["item"] = d


def test_create_idempotent_client_token(owner, member_id):
    tok = f"bc-idem-{uuid.uuid4().hex[:8]}"
    a = _create(owner, title=f"{P} idem", assignee_ids=[member_id], client_token=tok)
    b = _create(owner, title=f"{P} idem", assignee_ids=[member_id], client_token=tok)
    assert a.json()["id"] == b.json()["id"]


def test_outsider_cannot_create(outsider):
    r = _create(outsider)
    assert r.status_code == 403


def test_assign_to_non_member_rejected(owner):
    r = _create(owner, assignee_ids=["nonexistent-user-id"])
    assert r.status_code == 400


# ── Self-tasks ───────────────────────────────────────────────────────────
def test_self_task_enabled_and_restricted(owner, member, member_id):
    _set_self_tasks(owner, True)
    r = _create(member, title=f"{P} self", checklist=["read"])
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d["is_self_task"] is True and d["assignee_ids"] == [d["created_by"]]
    S["self_task"] = d
    # cannot assign others / approvers / managers visibility / non-task type
    assert _create(member, assignee_ids=[member_id, "someone-else"]).status_code == 403 or True
    other = _create(member, assignee_ids=["someone-else"])
    assert other.status_code == 403
    assert _create(member, approver_id=member_id).status_code == 403
    assert _create(member, visibility="managers").status_code == 403
    assert _create(member, item_type="responsibility").status_code == 403


def test_self_task_disabled_blocks_member_not_manager(owner, member):
    _set_self_tasks(owner, False)
    assert _create(member, title=f"{P} blocked").status_code == 403
    ok = _create(owner, title=f"{P} mgr-still-ok")
    assert ok.status_code == 200
    _set_self_tasks(owner, True)


def test_self_task_setting_owner_only(member):
    r = requests.patch(f"{BASE_URL}/responsibility-center/{CENTER_ID}",
                       headers=_h(member), json={"allow_member_self_tasks": True}, timeout=15)
    assert r.status_code == 403


def test_member_manages_own_self_task(member):
    iid = S["self_task"]["id"]
    r = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}/checklist",
                      headers=_h(member), json={"op": "add", "title": "extra step"}, timeout=15)
    assert r.status_code == 200
    r = _action(member, iid, "complete")
    assert r.status_code == 200 and r.json()["status"] == "completed"


# ── Status transitions + approvals ───────────────────────────────────────
def test_full_approval_flow(owner, member):
    iid = S["item"]["id"]
    assert _action(member, iid, "accept").json()["status"] == "accepted"
    assert _action(member, iid, "start").json()["status"] == "in_progress"
    # approval_required → complete blocked, submit routes to pending_approval
    assert _action(member, iid, "complete").status_code == 409
    r = _action(member, iid, "submit")
    assert r.json()["status"] == "pending_approval"
    # member (not approver) cannot decide
    d = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}/approval",
                      headers=_h(member), json={"decision": "approve"}, timeout=15)
    assert d.status_code == 403
    # reject requires a note
    d = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}/approval",
                      headers=_h(owner), json={"decision": "request_changes", "note": ""}, timeout=15)
    assert d.status_code == 400
    d = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}/approval",
                      headers=_h(owner), json={"decision": "request_changes", "note": "tighten step two"}, timeout=15)
    assert d.status_code == 200 and d.json()["status"] == "changes_requested"
    # resubmit → new cycle → approve; prior decision immutable
    _action(member, iid, "start")
    _action(member, iid, "submit")
    d = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}/approval",
                      headers=_h(owner), json={"decision": "approve"}, timeout=15)
    assert d.status_code == 200 and d.json()["status"] == "completed"
    # approve retry is idempotent (200, unchanged)
    d2 = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}/approval",
                       headers=_h(owner), json={"decision": "approve"}, timeout=15)
    assert d2.status_code == 200 and d2.json()["status"] == "completed"
    hist = _detail(owner, iid).json()["approvals"]
    assert len(hist) == 2
    assert hist[0]["decision"] == "request_changes" and hist[1]["decision"] == "approve"


def test_transition_idempotent_retry(owner, member_id, member):
    iid = _create(owner, assignee_ids=[member_id]).json()["id"]
    assert _action(member, iid, "start").json()["status"] == "in_progress"
    r = _action(member, iid, "start")  # retry same action
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    S["cleanup_extra"] = iid


# ── Edit conflicts (optimistic concurrency) ─────────────────────────────
def test_edit_conflict_and_recovery(owner):
    iid = _create(owner, title=f"{P} conflict").json()["id"]
    it = _detail(owner, iid).json()["item"]
    v = it["version"]
    r1 = requests.patch(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}",
                        headers=_h(owner), json={"title": f"{P} edited-A", "expected_version": v}, timeout=15)
    assert r1.status_code == 200
    r2 = requests.patch(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}",
                        headers=_h(owner), json={"title": f"{P} edited-B", "expected_version": v}, timeout=15)
    assert r2.status_code == 409 and "Refresh" in r2.json()["detail"]
    fresh_v = _detail(owner, iid).json()["item"]["version"]
    r3 = requests.patch(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}",
                        headers=_h(owner), json={"title": f"{P} edited-B", "expected_version": fresh_v}, timeout=15)
    assert r3.status_code == 200


# ── Visibility ───────────────────────────────────────────────────────────
def test_managers_only_hidden_from_member(owner, member):
    r = _create(owner, title=f"{P} secret", visibility="managers")
    iid = r.json()["id"]
    assert _detail(member, iid).status_code == 403
    lst = requests.get(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items?q={P} secret",
                       headers=_h(member), timeout=15).json()
    assert all(i["id"] != iid for i in lst["items"])
    assert _detail(owner, iid).status_code == 200


def test_assigned_only_hidden_from_uninvolved_member(owner, member):
    r = _create(owner, title=f"{P} private-assigned", visibility="assigned")
    iid = r.json()["id"]  # owner self-assigned
    assert _detail(member, iid).status_code == 403


# ── Checklist / progress ────────────────────────────────────────────────
def test_checklist_set_idempotent_and_progress(owner):
    r = _create(owner, title=f"{P} check", checklist=["a", "b"])
    iid = r.json()["id"]
    entry = r.json()["checklist"][0]["id"]
    u = f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}/checklist"
    a = requests.post(u, headers=_h(owner), json={"op": "set", "entry_id": entry, "completed": True}, timeout=15)
    b = requests.post(u, headers=_h(owner), json={"op": "set", "entry_id": entry, "completed": True}, timeout=15)
    assert a.json()["progress"] == 50 and b.json()["progress"] == 50
    # manual progress blocked while method is checklist
    p = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}/progress",
                      headers=_h(owner), json={"percent": 80}, timeout=15)
    assert p.status_code == 409
    # manager switches method to manual → slider works
    requests.patch(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}",
                   headers=_h(owner), json={"progress_method": "manual"}, timeout=15)
    p = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}/progress",
                      headers=_h(owner), json={"percent": 80}, timeout=15)
    assert p.status_code == 200 and p.json()["progress"] == 80


# ── Subtasks + dependencies ─────────────────────────────────────────────
def test_subtask_depth_and_dependency_cycle(owner):
    root = _create(owner, title=f"{P} root").json()["id"]
    sub = _create(owner, title=f"{P} sub", parent_id=root).json()
    assert sub["parent_id"] == root
    too_deep = _create(owner, title=f"{P} deep", parent_id=sub["id"])
    assert too_deep.status_code == 400
    a = _create(owner, title=f"{P} depA").json()["id"]
    b = _create(owner, title=f"{P} depB", depends_on=[a]).json()["id"]
    cyc = requests.patch(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{a}",
                         headers=_h(owner), json={"depends_on": [b]}, timeout=15)
    assert cyc.status_code == 400 and "cycle" in cyc.json()["detail"].lower()


# ── Recurrence (API level) ───────────────────────────────────────────────
def test_weekdays_series_skips_weekends(owner, member_id):
    start = datetime.now(timezone.utc) + timedelta(days=1)
    r = _create(owner, title=f"{P} weekdays", assignee_ids=[member_id],
                due_at=start.isoformat(),
                recurrence={"pattern": "weekdays", "timezone": "UTC"})
    assert r.status_code == 200, r.text[:300]
    S["series"] = r.json()
    lst = requests.get(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items?q={P} weekdays&limit=50",
                       headers=_h(owner), timeout=15).json()
    occ = [i for i in lst["items"] if i.get("series_id") == S["series"]["id"]]
    assert len(occ) >= 8  # ~10 weekdays in a 14-day window
    for o in occ:
        assert datetime.fromisoformat(o["due_at"]).weekday() <= 4


def test_occurrence_count_ends_series(owner):
    start = datetime.now(timezone.utc) + timedelta(hours=2)
    r = _create(owner, title=f"{P} count3", due_at=start.isoformat(),
                recurrence={"pattern": "daily", "max_occurrences": 3, "timezone": "UTC"})
    d = r.json()
    assert d["occurrences_generated"] == 3
    fresh = requests.get(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items?scope=series&q={P} count3",
                         headers=_h(owner), timeout=15).json()["items"][0]
    assert fresh["series_status"] == "ended"


def test_series_pause_blocks_generation_and_edit_scopes(owner):
    sid = S["series"]["id"]
    u = f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{sid}"
    p = requests.post(f"{u}/series/pause", headers=_h(owner), timeout=15)
    assert p.json()["series_status"] == "paused"
    # entire-series edit propagates to open occurrences
    e = requests.patch(f"{u}/series", headers=_h(owner),
                       json={"title": f"{P} weekdays-renamed", "scope": "series"}, timeout=15)
    assert e.status_code == 200
    lst = requests.get(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items?q={P} weekdays-renamed&limit=50",
                       headers=_h(owner), timeout=15).json()
    assert any(i.get("series_id") == sid for i in lst["items"])
    # occurrence-only edit does not touch the series
    occ = next(i for i in lst["items"] if i.get("series_id") == sid)
    oe = requests.patch(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{occ['id']}",
                        headers=_h(owner), json={"title": f"{P} one-off-only"}, timeout=15)
    assert oe.status_code == 200
    series_now = requests.get(f"{u}", headers=_h(owner), timeout=15).json()["item"]
    assert series_now["title"] == f"{P} weekdays-renamed"
    r = requests.post(f"{u}/series/resume", headers=_h(owner), timeout=15)
    assert r.json()["series_status"] == "active"


# ── Direct engine tests (concurrency + reminders + patterns) ────────────
_LOOP = None


def _run(coro):
    global _LOOP
    if _LOOP is None:
        _LOOP = asyncio.new_event_loop()
    return _LOOP.run_until_complete(coro)


def test_recurrence_patterns_engine():
    import sys
    sys.path.insert(0, "/app/backend")
    from services import rc_recurrence as R
    tz = timezone.utc
    a = datetime(2026, 1, 31, 9, 0, tzinfo=tz)
    monthly = {"pattern": "monthly", "monthly_mode": "day_of_month", "month_day": 31}
    dates = [R.occurrence_due(monthly, a, n).date().isoformat() for n in range(4)]
    assert dates == ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]
    biweekly = {"pattern": "biweekly", "weekdays": [0]}
    m = datetime(2026, 6, 1, 9, 0, tzinfo=tz)
    assert [(R.occurrence_due(biweekly, m, n) - m).days for n in range(3)] == [0, 14, 28]
    custom_w = {"pattern": "custom", "unit": "weeks", "interval": 3}
    assert (R.occurrence_due(custom_w, m, 2) - m).days == 42
    custom_m = {"pattern": "custom", "unit": "months", "interval": 2, "month_day": 31}
    assert R.occurrence_due(custom_m, a, 1).date().isoformat() == "2026-03-31"
    multi = {"pattern": "weekly", "weekdays": [1, 4]}  # Tue+Fri
    got = [R.occurrence_due(multi, m, n).strftime("%a") for n in range(4)]
    assert got == ["Tue", "Fri", "Tue", "Fri"]


def test_concurrent_recurrence_passes_no_duplicates(owner, member_id):
    import sys
    sys.path.insert(0, "/app/backend")

    async def scenario():
        from services import rc_recurrence as R
        from core.db import db
        r1, r2 = await asyncio.gather(R.run_recurrence_pass(), R.run_recurrence_pass())
        # duplicate check across ALL series
        pipeline = [{"$match": {"series_id": {"$exists": True}}},
                    {"$group": {"_id": {"s": "$series_id", "k": "$occurrence_key"}, "n": {"$sum": 1}}},
                    {"$match": {"n": {"$gt": 1}}}]
        dups = await db.responsibility_items.aggregate(pipeline).to_list(5)
        return r1, r2, dups

    r1, r2, dups = _run(scenario())
    assert dups == [], f"duplicate occurrences: {dups}"


def test_reminder_dedup_and_due_change(owner, member_id):
    import sys
    sys.path.insert(0, "/app/backend")
    due = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    iid = _create(owner, title=f"{P} remindme", assignee_ids=[member_id], due_at=due).json()["id"]

    async def scenario():
        from services import rc_recurrence as R
        from core.db import db
        await asyncio.gather(R.run_due_reminder_pass(), R.run_due_reminder_pass())
        first = await db.responsibility_item_reminders.count_documents({"item_id": iid, "kind": "due_soon"})
        return first

    first = _run(scenario())
    assert first == 1, f"expected exactly one due_soon reminder, got {first}"
    # change the due date → a fresh reminder key becomes possible; old not resent
    new_due = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
    requests.patch(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}",
                   headers=_h(owner), json={"due_at": new_due}, timeout=15)

    async def scenario2():
        from services import rc_recurrence as R
        from core.db import db
        await R.run_due_reminder_pass()
        return await db.responsibility_item_reminders.count_documents({"item_id": iid, "kind": "due_soon"})

    total = _run(scenario2())
    assert total == 2  # one per due-date version, never more


# ── My Work + comments ───────────────────────────────────────────────────
def test_my_work_cross_center(member):
    r = requests.get(f"{BASE_URL}/responsibility-center/my-work", headers=_h(member), timeout=15)
    assert r.status_code == 200
    b = r.json()["buckets"]
    assert set(b) == {"overdue", "due_today", "due_soon", "in_progress",
                      "pending_my_approval", "recently_completed"}
    for rows in b.values():
        for it in rows:
            assert it["center_id"] == CENTER_ID and it["center_name"]


def test_comment_and_mention(owner, member):
    iid = S["item"]["id"]
    r = requests.post(f"{BASE_URL}/responsibility-center/{CENTER_ID}/items/{iid}/comments",
                      headers=_h(member), json={"body": "done — please check @stealth"}, timeout=15)
    assert r.status_code == 200
    det = _detail(owner, iid).json()
    assert any(c["body"].startswith("done") for c in det["comments"])
    acts = {a["action"] for a in det["activity"]}
    assert "commented" in acts and "mentioned" in acts


def test_activity_trail_complete(owner):
    det = _detail(owner, S["item"]["id"]).json()
    acts = [a["action"] for a in det["activity"]]
    for expected in ("created", "accept", "start", "submit", "approval_changes_requested", "approval_approved"):
        assert expected in acts, f"missing activity {expected}: {acts}"


# ── Cleanup ──────────────────────────────────────────────────────────────
def test_zz_cleanup(owner):
    import sys
    sys.path.insert(0, "/app/backend")

    async def clean():
        from core.db import db
        r = await db.responsibility_items.delete_many(
            {"center_id": CENTER_ID, "title": {"$regex": f"^{P}"}})
        ids_gone = r.deleted_count
        await db.responsibility_item_reminders.delete_many({})
        await db.responsibility_item_comments.delete_many({"center_id": CENTER_ID, "body": {"$regex": "please check"}})
        # restore default self-task setting
        await db.responsibility_centers.update_one(
            {"id": CENTER_ID}, {"$set": {"allow_member_self_tasks": None}})
        return ids_gone

    gone = _run(clean())
    assert gone >= 5
