"""Bundle E tests — units hierarchy, unit assignments, calendar events,
recurrence, conflicts, attendance, Education conversion, Work Digest.

Seeds a synthetic Center directly in Mongo (no Fire Power burned) and
removes it afterwards. Live API via REACT_APP_BACKEND_URL.
"""
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
MANAGER = ("tftwo", "pass1234")          # teacher/manager analog
PLAIN = ("auditcheckreal", "Password1$")  # student analog

CID = f"betest{uuid.uuid4().hex[:10]}"
CID2 = f"betest{uuid.uuid4().hex[:10]}"
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


def test_00_seed_synthetic_center():
    async def seed():
        from core.db import db
        uids = {}
        for uname in ("stealth", "tftwo", "auditcheckreal"):
            u = await db.users.find_one({"username": uname}, {"_id": 0, "id": 1})
            uids[uname] = u["id"]
        paid = _iso(datetime.now(timezone.utc) + timedelta(days=25))
        for cid, name in ((CID, "BE Units Lab"), (CID2, "BE Other Lab")):
            await db.responsibility_centers.insert_one({
                "id": cid, "name": name, "center_type": "team", "description": "",
                "status": "active", "vault_balance": 500, "member_count": 3,
                "allow_member_self_tasks": True, "timezone": "UTC",
                "created_by": uids["stealth"], "created_at": _iso(), "updated_at": _iso()})
            for uname, role in (("stealth", "owner"), ("tftwo", "manager"), ("auditcheckreal", "member")):
                await db.responsibility_center_memberships.insert_one({
                    "id": uuid.uuid4().hex, "center_id": cid, "user_id": uids[uname],
                    "role": role, "status": "active", "seat_paid_until": paid,
                    "joined_at": _iso()})
        return uids
    S["uids"] = _run(seed())
    assert S["uids"]["stealth"]


# ── UNITS ────────────────────────────────────────────────────────────────
def _mk_unit(tok, cid=CID, **kw):
    body = {"name": kw.pop("name", "Unit"), **kw}
    return requests.post(f"{BASE_URL}/responsibility-center/{cid}/units",
                         headers=_h(tok), json=body, timeout=15)


def test_unit_create_and_idempotent_token(owner):
    token = uuid.uuid4().hex
    r1 = _mk_unit(owner, name="Alpha Dept", unit_type="department", client_token=token)
    assert r1.status_code == 200, r1.text[:300]
    uid1 = r1.json()["unit"]["id"]
    r2 = _mk_unit(owner, name="Alpha Dept", unit_type="department", client_token=token)
    # same token → same unit, no duplicate
    body2 = r2.json()
    uid2 = body2.get("unit", body2).get("id")
    assert uid2 == uid1
    S["unit_a"] = uid1


def test_unit_plain_member_cannot_create(plain):
    assert _mk_unit(plain, name="Rogue").status_code == 403


def test_unit_cross_center_parent_rejected(owner):
    other = _mk_unit(owner, cid=CID2, name="Foreign").json()["unit"]["id"]
    S["foreign_unit"] = other
    r = _mk_unit(owner, name="Bad Parent", parent_id=other)
    assert r.status_code == 400


def test_unit_depth_limit_and_chain(owner):
    parent = S["unit_a"]
    chain = [parent]
    for i in range(4):  # levels 2..5
        r = _mk_unit(owner, name=f"Level {i + 2}", parent_id=parent)
        assert r.status_code == 200, r.text[:200]
        parent = r.json()["unit"]["id"]
        chain.append(parent)
    S["chain"] = chain
    r = _mk_unit(owner, name="Too Deep", parent_id=parent)  # level 6
    assert r.status_code == 400


def test_unit_cycle_rejected(owner):
    top, descendant = S["chain"][0], S["chain"][2]
    r = requests.patch(f"{BASE_URL}/responsibility-center/{CID}/units/{top}",
                       headers=_h(owner), json={"parent_id": descendant}, timeout=15)
    assert r.status_code == 400


def test_unit_leader_must_be_active_member(owner):
    r = _mk_unit(owner, name="No Leader", leader_id="not-a-member")
    assert r.status_code == 400
    # paused center member rejected as leader
    async def pause():
        from core.db import db
        await db.responsibility_center_memberships.update_one(
            {"center_id": CID, "user_id": S["uids"]["auditcheckreal"]},
            {"$set": {"status": "paused"}})
    _run(pause())
    r = _mk_unit(owner, name="Paused Leader", leader_id=S["uids"]["auditcheckreal"])
    assert r.status_code == 400
    # paused member also can't be ADDED to a unit
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/units/{S['unit_a']}/members",
                      headers=_h(owner), json={"user_id": S["uids"]["auditcheckreal"]}, timeout=15)
    assert r.status_code == 400
    async def restore():
        from core.db import db
        await db.responsibility_center_memberships.update_one(
            {"center_id": CID, "user_id": S["uids"]["auditcheckreal"]},
            {"$set": {"status": "active"}})
    _run(restore())


def test_unit_members_add_remove_history(owner, manager):
    u = S["uids"]
    unit = S["unit_a"]
    url = f"{BASE_URL}/responsibility-center/{CID}/units/{unit}/members"
    assert requests.post(url, headers=_h(owner), json={"user_id": u["auditcheckreal"]}, timeout=15).status_code == 200
    # duplicate add → role update, still one active row
    assert requests.post(url, headers=_h(owner), json={"user_id": u["auditcheckreal"], "unit_role": "assistant"}, timeout=15).status_code == 200
    detail = requests.get(f"{BASE_URL}/responsibility-center/{CID}/units/{unit}", headers=_h(owner), timeout=15).json()
    rows = [m for m in detail["members"] if m["user_id"] == u["auditcheckreal"]]
    assert len(rows) == 1 and rows[0]["unit_role"] == "assistant"
    # remove → history preserved as 'left'
    assert requests.delete(f"{url}/{u['auditcheckreal']}", headers=_h(owner), timeout=15).status_code == 200
    async def hist():
        from core.db import db
        return await db.responsibility_center_unit_memberships.find_one(
            {"unit_id": unit, "user_id": u["auditcheckreal"], "status": "left"}, {"_id": 0})
    assert _run(hist()) is not None
    # re-add for later tests
    assert requests.post(url, headers=_h(owner), json={"user_id": u["auditcheckreal"]}, timeout=15).status_code == 200
    assert requests.post(url, headers=_h(owner), json={"user_id": u["tftwo"], "unit_role": "leader"}, timeout=15).status_code == 200


def test_unit_archive_blocks_writes(owner):
    r = _mk_unit(owner, name="Archive Me")
    unit = r.json()["unit"]["id"]
    assert requests.patch(f"{BASE_URL}/responsibility-center/{CID}/units/{unit}",
                          headers=_h(owner), json={"status": "archived"}, timeout=15).status_code == 200
    add = requests.post(f"{BASE_URL}/responsibility-center/{CID}/units/{unit}/members",
                        headers=_h(owner), json={"user_id": S["uids"]["tftwo"]}, timeout=15)
    assert add.status_code == 409
    work = requests.post(f"{BASE_URL}/responsibility-center/{CID}/units/{unit}/assign-work",
                         headers=_h(owner), json={"title": "nope"}, timeout=15)
    assert work.status_code == 409
    # restore works
    assert requests.patch(f"{BASE_URL}/responsibility-center/{CID}/units/{unit}",
                          headers=_h(owner), json={"status": "active"}, timeout=15).status_code == 200


def test_unit_assign_work_individual_skips_paused(owner):
    u = S["uids"]
    unit = S["unit_a"]
    async def pause():
        from core.db import db
        await db.responsibility_center_memberships.update_one(
            {"center_id": CID, "user_id": u["auditcheckreal"]}, {"$set": {"status": "paused"}})
    _run(pause())
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/units/{unit}/assign-work",
                      headers=_h(owner), json={"title": "Weekly report", "mode": "individual"}, timeout=15)
    assert r.status_code == 200, r.text[:300]
    assert r.json()["count"] == 1  # only tftwo — paused member skipped
    async def restore():
        from core.db import db
        await db.responsibility_center_memberships.update_one(
            {"center_id": CID, "user_id": u["auditcheckreal"]}, {"$set": {"status": "active"}})
    _run(restore())


def test_unit_assign_work_shared_mode(owner):
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/units/{S['unit_a']}/assign-work",
                      headers=_h(owner), json={"title": "Team charter", "mode": "shared"}, timeout=15)
    assert r.status_code == 200 and r.json()["count"] == 1
    S["shared_item"] = r.json()["item_ids"][0]


# ── CALENDAR ─────────────────────────────────────────────────────────────
def _mk_event(tok, cid=CID, **kw):
    start = kw.pop("start", datetime.now(timezone.utc) + timedelta(days=1))
    body = {"title": kw.pop("title", "Event"), "start_at": start.isoformat(),
            "end_at": (start + timedelta(hours=1)).isoformat(), **kw}
    return requests.post(f"{BASE_URL}/responsibility-center/{cid}/events",
                         headers=_h(tok), json=body, timeout=15)


def _feed(tok, days=7, **params):
    now = datetime.now(timezone.utc)
    return requests.get(f"{BASE_URL}/responsibility-center/{CID}/calendar", headers=_h(tok),
                        params={"date_from": now.isoformat(),
                                "date_to": (now + timedelta(days=days)).isoformat(), **params},
                        timeout=15).json()


def test_event_create_and_feed(owner, plain):
    u = S["uids"]
    r = _mk_event(owner, title="Team Sync", event_type="meeting",
                  attendee_ids=[u["tftwo"], u["auditcheckreal"]])
    assert r.status_code == 200, r.text[:300]
    S["event"] = r.json()["id"]
    ids = [e["id"] for e in _feed(owner)["entries"]]
    assert S["event"] in ids
    # plain member with center visibility sees it too
    assert S["event"] in [e["id"] for e in _feed(plain)["entries"]]
    # outside range → absent
    far = requests.get(f"{BASE_URL}/responsibility-center/{CID}/calendar", headers=_h(owner),
                       params={"date_from": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
                               "date_to": (datetime.now(timezone.utc) + timedelta(days=35)).isoformat()},
                       timeout=15).json()
    assert S["event"] not in [e["id"] for e in far["entries"]]


def test_event_plain_member_cannot_create(plain):
    assert _mk_event(plain, title="Rogue event").status_code == 403


def test_event_private_visibility_hidden(owner, manager, plain):
    r = _mk_event(owner, title="Private leads", visibility="attendees",
                  attendee_ids=[S["uids"]["tftwo"]], start=datetime.now(timezone.utc) + timedelta(days=2))
    eid = r.json()["id"]
    assert eid not in [e["id"] for e in _feed(plain)["entries"]]          # non-attendee
    assert eid in [e["id"] for e in _feed(manager)["entries"]]            # attendee
    det = requests.get(f"{BASE_URL}/responsibility-center/{CID}/events/{eid}", headers=_h(plain), timeout=15)
    assert det.status_code == 403


def test_event_unit_visibility(owner, plain, manager):
    async def drop_plain():
        from core.db import db
        await db.responsibility_center_unit_memberships.update_many(
            {"unit_id": S["unit_a"], "user_id": S["uids"]["auditcheckreal"], "status": "active"},
            {"$set": {"status": "left"}})
    _run(drop_plain())
    r = _mk_event(owner, title="Unit only", visibility="unit", unit_id=S["unit_a"],
                  start=datetime.now(timezone.utc) + timedelta(days=3))
    eid = r.json()["id"]
    assert eid not in [e["id"] for e in _feed(plain)["entries"]]
    assert eid in [e["id"] for e in _feed(manager)["entries"]]  # unit leader/member


def test_conflict_detection_and_override(owner):
    u = S["uids"]
    start = datetime.now(timezone.utc) + timedelta(days=5)
    assert _mk_event(owner, title="Slot A", attendee_ids=[u["tftwo"]], start=start).status_code == 200
    clash = _mk_event(owner, title="Slot B overlapping", attendee_ids=[u["tftwo"]],
                      start=start + timedelta(minutes=30))
    assert clash.status_code == 409
    det = clash.json()["detail"]
    assert det["conflicts"] and det["conflicts"][0]["overlapping_members"]
    ok = _mk_event(owner, title="Slot B overlapping", attendee_ids=[u["tftwo"]],
                   start=start + timedelta(minutes=30), override_conflicts=True,
                   override_reason="Approved double-booking")
    assert ok.status_code == 200
    # non-overlap → no warning
    assert _mk_event(owner, title="Slot C clean", attendee_ids=[u["tftwo"]],
                     start=start + timedelta(hours=5)).status_code == 200


def test_rsvp(owner, manager, plain):
    eid = S["event"]
    url = f"{BASE_URL}/responsibility-center/{CID}/events/{eid}/rsvp"
    assert requests.post(url, headers=_h(manager), json={"response": "accepted"}, timeout=15).status_code == 200
    det = requests.get(f"{BASE_URL}/responsibility-center/{CID}/events/{eid}", headers=_h(manager), timeout=15).json()
    assert det["me"]["my_response"] == "accepted"
    assert requests.post(url, headers=_h(manager), json={"response": "bogus"}, timeout=15).status_code == 400
    # owner (organizer) is auto-attendee; a NON-attendee member gets 404
    r = _mk_event(owner, title="No plain", attendee_ids=[S["uids"]["tftwo"]],
                  start=datetime.now(timezone.utc) + timedelta(days=6, hours=3))
    other = r.json()["id"]
    assert requests.post(f"{BASE_URL}/responsibility-center/{CID}/events/{other}/rsvp",
                         headers=_h(plain), json={"response": "accepted"}, timeout=15).status_code == 404


def test_attendance_permissions_and_bulk(owner, plain):
    u = S["uids"]
    r = _mk_event(owner, title="Practice w/ attendance", event_type="practice",
                  attendee_ids=[u["tftwo"], u["auditcheckreal"]], attendance_enabled=True,
                  start=datetime.now(timezone.utc) + timedelta(days=6, hours=6))
    eid = r.json()["id"]
    url = f"{BASE_URL}/responsibility-center/{CID}/events/{eid}/attendance"
    # plain participant cannot mark official attendance
    deny = requests.post(url, headers=_h(plain),
                         json={"marks": [{"user_id": u["auditcheckreal"], "attendance": "present"}]}, timeout=15)
    assert deny.status_code == 403
    # organizer bulk update with note
    ok = requests.post(url, headers=_h(owner), json={"marks": [
        {"user_id": u["tftwo"], "attendance": "present"},
        {"user_id": u["auditcheckreal"], "attendance": "late", "note": "traffic"}]}, timeout=15)
    assert ok.status_code == 200 and ok.json()["updated"] == 2
    det = requests.get(f"{BASE_URL}/responsibility-center/{CID}/events/{eid}", headers=_h(owner), timeout=15).json()
    att = {a["user_id"]: a for a in det["event"]["attendees"]}
    assert att[u["auditcheckreal"]]["attendance"] == "late"
    assert att[u["auditcheckreal"]]["note"] == "traffic"
    assert att[u["auditcheckreal"]]["marked_by"] == u["stealth"]
    # attendance change history logged
    async def hist():
        from core.db import db
        return await db.responsibility_center_unit_activity.count_documents(
            {"action": "attendance_changed", "meta.event_id": eid})
    assert _run(hist()) == 2
    S["att_event"] = eid


def test_attendance_requires_enabled(owner):
    eid = S["event"]  # attendance_enabled False
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/events/{eid}/attendance",
                      headers=_h(owner), json={"marks": [{"user_id": S["uids"]["tftwo"], "attendance": "present"}]},
                      timeout=15)
    assert r.status_code == 409


def test_task_due_date_projection(owner):
    due = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/items", headers=_h(owner),
                      json={"title": "Projected task", "assignee_ids": [S["uids"]["tftwo"]],
                            "due_at": due, "client_token": uuid.uuid4().hex}, timeout=15)
    assert r.status_code == 200, r.text[:300]
    iid = r.json()["id"]
    items = [e for e in _feed(owner)["entries"] if e["kind"] == "item"]
    assert iid in [e["id"] for e in items]
    # due-date change updates the feed (no duplication)
    new_due = (datetime.now(timezone.utc) + timedelta(days=4)).isoformat()
    assert requests.patch(f"{BASE_URL}/responsibility-center/{CID}/items/{iid}", headers=_h(owner),
                          json={"due_at": new_due}, timeout=15).status_code == 200
    rows = [e for e in _feed(owner)["entries"] if e["kind"] == "item" and e["id"] == iid]
    assert len(rows) == 1 and rows[0]["start_at"] == new_due
    # completion reflected
    assert requests.post(f"{BASE_URL}/responsibility-center/{CID}/items/{iid}/actions/complete",
                         headers=_h(owner), json={"note": ""}, timeout=15).status_code == 200
    rows = [e for e in _feed(owner)["entries"] if e["kind"] == "item" and e["id"] == iid]
    assert rows[0]["completed"] is True


def test_event_edit_version_guard(owner):
    eid = S["event"]
    r = requests.patch(f"{BASE_URL}/responsibility-center/{CID}/events/{eid}", headers=_h(owner),
                       json={"title": "Team Sync v2", "expected_version": 999}, timeout=15)
    assert r.status_code == 409
    det = requests.get(f"{BASE_URL}/responsibility-center/{CID}/events/{eid}", headers=_h(owner), timeout=15).json()
    r = requests.patch(f"{BASE_URL}/responsibility-center/{CID}/events/{eid}", headers=_h(owner),
                       json={"title": "Team Sync v2", "expected_version": det["event"]["version"]}, timeout=15)
    assert r.status_code == 200


def test_recurring_series_generation_and_concurrency(owner):
    start = datetime.now(timezone.utc) + timedelta(hours=2)
    r = _mk_event(owner, title="Weekly standup", event_type="meeting", start=start,
                  recurrence={"pattern": "daily", "timezone": "UTC"})
    assert r.status_code == 200, r.text[:300]
    series = r.json()
    assert series.get("is_series")
    S["series"] = series["id"]

    async def check():
        from core.db import db
        from services import rc_calendar
        s = await db.responsibility_center_calendar_events.find_one({"id": series["id"]}, {"_id": 0})
        # concurrent generation passes — unique occurrence keys must hold
        await asyncio.gather(rc_calendar.generate_event_occurrences(s),
                             rc_calendar.generate_event_occurrences(s))
        dupes = await db.responsibility_center_calendar_events.aggregate([
            {"$match": {"series_id": series["id"]}},
            {"$group": {"_id": "$occurrence_key", "n": {"$sum": 1}}},
            {"$match": {"n": {"$gt": 1}}}]).to_list(10)
        count = await db.responsibility_center_calendar_events.count_documents(
            {"series_id": series["id"], "status": "scheduled"})
        return dupes, count
    dupes, count = _run(check())
    assert dupes == [] and count > 5  # rolling 14-day window, daily


def test_series_cancel_entire(owner):
    sid = S["series"]
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/events/{sid}/cancel",
                      headers=_h(owner), json={"scope": "series"}, timeout=15)
    assert r.status_code == 200 and r.json()["canceled_count"] > 0

    async def check():
        from core.db import db
        live = await db.responsibility_center_calendar_events.count_documents(
            {"series_id": sid, "status": "scheduled"})
        s = await db.responsibility_center_calendar_events.find_one({"id": sid}, {"_id": 0, "series_status": 1})
        return live, s["series_status"]
    live, status = _run(check())
    assert live == 0 and status == "ended"


# ── EDUCATION CONVERSION ─────────────────────────────────────────────────
def test_conversion_flow(owner, manager, plain):
    u = S["uids"]
    # student creates a personal self-task
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/items", headers=_h(plain),
                      json={"title": "My study plan", "assignee_ids": [u["auditcheckreal"]],
                            "client_token": uuid.uuid4().hex}, timeout=15)
    assert r.status_code == 200, r.text[:300]
    iid = r.json()["id"]
    assert r.json().get("is_self_task") in (True, None)
    conv_url = f"{BASE_URL}/responsibility-center/{CID}/items/{iid}/convert"
    # student cannot convert their own task
    assert requests.post(conv_url, headers=_h(plain), json={"mode": "personal"}, timeout=15).status_code == 403
    # manager (teacher) converts to an official personal assignment
    ok = requests.post(conv_url, headers=_h(manager), json={"mode": "personal"}, timeout=15)
    assert ok.status_code == 200, ok.text[:300]
    official = ok.json()["official_item_ids"][0]
    # duplicate conversion blocked
    assert requests.post(conv_url, headers=_h(manager), json={"mode": "personal"}, timeout=15).status_code == 409

    async def check():
        from core.db import db
        orig = await db.responsibility_items.find_one({"id": iid}, {"_id": 0})
        new = await db.responsibility_items.find_one({"id": official}, {"_id": 0})
        return orig, new
    orig, new = _run(check())
    assert orig["converted_to"] == [official]           # original preserved + linked
    assert orig["is_self_task"] is True                  # still labeled personal
    assert new["source_item_id"] == iid                  # official links back
    assert new["source_created_by"] == u["auditcheckreal"]
    assert new["is_self_task"] is not True
    S["self_task_2"] = None


def test_conversion_to_unit_assignment(owner, manager, plain):
    u = S["uids"]
    # ensure both members active in unit
    for uid in (u["auditcheckreal"], u["tftwo"]):
        requests.post(f"{BASE_URL}/responsibility-center/{CID}/units/{S['unit_a']}/members",
                      headers=_h(owner), json={"user_id": uid}, timeout=15)
    r = requests.post(f"{BASE_URL}/responsibility-center/{CID}/items", headers=_h(plain),
                      json={"title": "Great class idea", "assignee_ids": [u["auditcheckreal"]],
                            "client_token": uuid.uuid4().hex}, timeout=15)
    iid = r.json()["id"]
    ok = requests.post(f"{BASE_URL}/responsibility-center/{CID}/items/{iid}/convert", headers=_h(manager),
                       json={"mode": "unit", "unit_id": S["unit_a"], "unit_mode": "individual"}, timeout=15)
    assert ok.status_code == 200, ok.text[:300]
    assert len(ok.json()["official_item_ids"]) >= 2  # one per active unit member


# ── WORK DIGEST ──────────────────────────────────────────────────────────
def test_digest_settings_validation(plain):
    url = f"{BASE_URL}/responsibility-center/digest-settings"
    assert requests.patch(url, headers=_h(plain), json={"digest_hour": 25}, timeout=15).status_code == 400
    assert requests.patch(url, headers=_h(plain), json={"digest_timezone": "Not/AZone"}, timeout=15).status_code == 400
    r = requests.patch(url, headers=_h(plain), json={
        "digest_enabled": True, "digest_hour": datetime.now(timezone.utc).hour,
        "digest_timezone": "UTC", "include_events": True}, timeout=15)
    assert r.status_code == 200 and r.json()["digest_enabled"] is True
    g = requests.get(url, headers=_h(plain), timeout=15).json()
    assert g["digest_hour"] == datetime.now(timezone.utc).hour


def test_digest_one_per_day_and_concurrency(plain):
    u = S["uids"]
    # give the plain user something due today so the digest is non-empty
    due = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    requests.post(f"{BASE_URL}/responsibility-center/{CID}/items", headers=_h(_login(*OWNER)),
                  json={"title": "Digest fodder", "assignee_ids": [u["auditcheckreal"]],
                        "due_at": due, "client_token": uuid.uuid4().hex}, timeout=15)

    async def run_twice():
        from core.db import db
        from services import rc_calendar
        await db.responsibility_center_digest_log.delete_many({"user_id": u["auditcheckreal"]})
        r1, r2 = await asyncio.gather(rc_calendar.run_work_digest_pass(),
                                      rc_calendar.run_work_digest_pass())
        n = await db.responsibility_center_digest_log.count_documents({"user_id": u["auditcheckreal"]})
        r3 = await rc_calendar.run_work_digest_pass()  # third pass same day → skip
        n2 = await db.responsibility_center_digest_log.count_documents({"user_id": u["auditcheckreal"]})
        row = await db.responsibility_center_digest_log.find_one(
            {"user_id": u["auditcheckreal"]}, {"_id": 0})
        return n, n2, row
    n, n2, row = _run(run_twice())
    assert n == 1 and n2 == 1                         # overlap-safe, one per day
    assert row and row["sections"]
    links = [i["link"] for sec in row["sections"].values() for i in sec]
    assert all(l.startswith("/responsibility-center") for l in links)


def test_digest_excludes_paused_center(plain):
    u = S["uids"]

    async def check():
        from core.db import db
        from services import rc_calendar
        await db.responsibility_centers.update_one({"id": CID}, {"$set": {"status": "paused"}})
        await db.responsibility_center_digest_log.delete_many({"user_id": u["auditcheckreal"]})
        await rc_calendar.run_work_digest_pass()
        row = await db.responsibility_center_digest_log.find_one(
            {"user_id": u["auditcheckreal"]}, {"_id": 0})
        await db.responsibility_centers.update_one({"id": CID}, {"$set": {"status": "active"}})
        return row
    row = _run(check())
    if row:  # digest may exist from other Centers' work — CID must not appear
        cids = {i["center_id"] for sec in row["sections"].values() for i in sec}
        assert CID not in cids


def test_zz_cleanup():
    async def cleanup():
        from core.db import db
        u = S["uids"]
        for cid in (CID, CID2):
            await db.responsibility_centers.delete_many({"id": cid})
            await db.responsibility_center_memberships.delete_many({"center_id": cid})
            await db.responsibility_center_units.delete_many({"center_id": cid})
            await db.responsibility_center_unit_memberships.delete_many({"center_id": cid})
            await db.responsibility_center_unit_activity.delete_many({"center_id": cid})
            await db.responsibility_center_calendar_events.delete_many({"center_id": cid})
            await db.responsibility_items.delete_many({"center_id": cid})
            await db.responsibility_item_activity.delete_many({"center_id": cid})
            await db.responsibility_center_activity_logs.delete_many({"center_id": cid})
            await db.responsibility_center_event_reminders.delete_many({})
        await db.responsibility_center_digest_log.delete_many({"user_id": u["auditcheckreal"]})
        await db.user_rc_prefs.delete_many({"user_id": u["auditcheckreal"]})
        await db.notifications.delete_many({"payload.center_id": {"$in": [CID, CID2]}})
    _run(cleanup())
    assert True
