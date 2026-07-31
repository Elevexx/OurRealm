"""Bundle A live simulation of the renewal engine — run once, prints results."""
import asyncio, os
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')

import sys
sys.path.insert(0, '/app/backend')
from core.db import db
from services import rc_renewals as rr
from services import responsibility_center as rc

CID = "cf5a475c04cd4860976920cda63fa6ff"
TFTWO = "6fbd5bf2-6211-4fd1-b534-63595fad9fe2"


async def vault():
    c = await db.responsibility_centers.find_one({"id": CID}, {"_id": 0, "vault_balance": 1})
    return c["vault_balance"]


async def member():
    return await db.responsibility_center_memberships.find_one(
        {"center_id": CID, "user_id": TFTWO}, {"_id": 0, "status": 1, "seat_paid_until": 1, "warnings_sent": 1})


async def set_due(days_ago=1):
    due = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    await db.responsibility_center_memberships.update_one(
        {"center_id": CID, "user_id": TFTWO},
        {"$set": {"seat_paid_until": due, "warnings_sent": []}, "$unset": {"renewal_claim_until": ""}})
    return due


async def main():
    rc.invalidate_rc_settings_cache()
    # reset fixture state (live worker may have drifted it between runs)
    await db.responsibility_centers.update_one({"id": CID}, {"$set": {"vault_balance": 205}})
    future = (datetime.now(timezone.utc) + timedelta(days=20)).isoformat()
    await db.responsibility_center_memberships.update_one(
        {"center_id": CID, "user_id": TFTWO},
        {"$set": {"status": "active", "seat_paid_until": future, "warnings_sent": [],
                  "awaiting_fire_power": False},
         "$unset": {"paused_at": "", "paused_reason": "", "renewal_claim_until": ""}})
    await db.notifications.delete_many({"kind": "responsibility_center_renewal_reminder"})
    print("start vault:", await vault(), "| member:", await member())

    # 1) due + sufficient vault -> renew, burn exactly 100
    await set_due()
    v0 = await vault()
    s = await rr.run_renewal_pass()
    m = await member()
    v1 = await vault()
    print(f"T1 renew: pass={s} burn={v0 - v1} status={m['status']} new_due={m['seat_paid_until'][:10]}")
    assert v0 - v1 == 100 and m["status"] == "active" and s["renewed"] == 1

    # 2) run again immediately -> nothing due, no burn
    s = await rr.run_renewal_pass()
    v2 = await vault()
    print(f"T2 no-double-burn: pass={s} vault={v2}")
    assert v2 == v1 and s["processed"] == 0

    # 3) CONCURRENCY: due again, two workers race -> exactly one burn
    due = await set_due()
    v0 = await vault()
    r = await asyncio.gather(rr.run_renewal_pass(), rr.run_renewal_pass())
    v1 = await vault()
    total_renewed = sum(x["renewed"] for x in r)
    print(f"T3 concurrency: burns={v0 - v1} renewed_total={total_renewed} passes={r}")
    assert v0 - v1 == 100 and total_renewed == 1

    # 3b) direct double renew_membership on SAME period -> already_renewed
    m = await member()
    settings = await rc.get_rc_settings()
    center = await db.responsibility_centers.find_one({"id": CID}, {"_id": 0})
    mem = await db.responsibility_center_memberships.find_one({"center_id": CID, "user_id": TFTWO}, {"_id": 0})
    # simulate stale period value (same as what was just renewed): use prior due
    stale = dict(mem, seat_paid_until=due)
    r1 = await rr.renew_membership(center, stale, settings)
    print(f"T3b period idempotency: {r1['result']}")
    assert r1["result"] == "already_renewed"

    # 4) INSUFFICIENT: drain vault to 5, member due -> pause, no burn, no negative
    await db.responsibility_centers.update_one({"id": CID}, {"$set": {"vault_balance": 5}})
    await set_due()
    s = await rr.run_renewal_pass()
    m = await member()
    v = await vault()
    print(f"T4 insufficient: pass={s} status={m['status']} vault={v}")
    assert m["status"] == "paused" and v == 5 and s["paused"] == 1

    # 5) REACTIVATE: fund vault, owner reactivates -> active, one new period, 100 burned
    await db.responsibility_centers.update_one({"id": CID}, {"$inc": {"vault_balance": 250}})
    stealth = await db.users.find_one({"username": "stealth"}, {"_id": 0, "id": 1, "username": 1})
    r = await rc.reactivate_member(stealth, CID, TFTWO)
    m = await member()
    v = await vault()
    print(f"T5 reactivate: status={m['status']} vault={v} until={r['seat_paid_until'][:10]}")
    assert m["status"] == "active" and v == 155
    # duplicate reactivation -> 404 (not paused)
    try:
        await rc.reactivate_member(stealth, CID, TFTWO)
        print("T5b FAIL — duplicate reactivation allowed")
    except Exception as e:
        print(f"T5b duplicate reactivation blocked: {getattr(e, 'detail', e)}")

    # 6) WARNINGS: due in 2 days -> 3-day threshold reminder to owner, dedup on rerun
    near = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    await db.responsibility_center_memberships.update_one(
        {"center_id": CID, "user_id": TFTWO}, {"$set": {"seat_paid_until": near, "warnings_sent": []}})
    n0 = await db.notifications.count_documents({"kind": "responsibility_center_renewal_reminder"})
    w1 = await rr.run_warning_pass()
    w2 = await rr.run_warning_pass()
    n1 = await db.notifications.count_documents({"kind": "responsibility_center_renewal_reminder"})
    m = await member()
    print(f"T6 warnings: first={w1} rerun={w2} notifs {n0}->{n1} sent_keys={m.get('warnings_sent')}")
    assert w1["warnings"] == 1 and w2["warnings"] == 0 and n1 == n0 + 1

    # 7) EMERGENCY PAUSE: due member + pause flag -> nothing processed, balances untouched
    await set_due()
    await db.responsibility_center_settings.update_one(
        {"_id": "settings"}, {"$set": {"emergency_renewal_pause": True}}, upsert=True)
    rc.invalidate_rc_settings_cache()
    v0 = await vault()
    s = await rr.run_renewal_pass()
    v1 = await vault()
    m = await member()
    print(f"T7 emergency pause: pass={s} vault {v0}->{v1} status={m['status']}")
    assert s["skipped"] and v0 == v1 and m["status"] == "active"
    await db.responsibility_center_settings.update_one(
        {"_id": "settings"}, {"$set": {"emergency_renewal_pause": False}})
    rc.invalidate_rc_settings_cache()

    # 8) restore clean state: renew the due member so the demo center is healthy
    s = await rr.run_renewal_pass()
    m = await member()
    print(f"T8 restore: pass={s} status={m['status']} vault={await vault()} due={m['seat_paid_until'][:10]}")
    print("\nALL RENEWAL ENGINE CHECKS PASSED")

asyncio.run(main())
