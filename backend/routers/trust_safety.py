"""Trust & Safety Command Center API — founder/admin routes + user appeals."""
import logging

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import trust_safety as ts

log = logging.getLogger("ourrealm.trust_safety.api")
router = APIRouter(prefix="/api/admin/trust-safety", tags=["trust-safety"])
user_router = APIRouter(prefix="/api/appeals", tags=["appeals"])


def _iso_now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


@router.get("/dashboard")
async def dashboard(current: CurrentUser):
    require_founder(current)
    day = ts._ago(24)
    week = ts._ago(24 * 7)
    open_cases = await db.ts_cases.count_documents({"status": "open"})
    urgent = await db.ts_cases.count_documents({"status": "open", "priority": {"$gte": 85}})
    pending_review = await db.users.count_documents({"ts_status": "locked_pending_founder_review"})
    locked = pending_review
    suspended = await db.users.count_documents({"suspended_until": {"$gt": _iso_now()},
                                                "ts_status": {"$nin": ["banned", "deleted"]}})
    banned = await db.users.count_documents({"ts_status": "banned"})
    appeals = await db.ts_appeals.count_documents({"status": "pending"})
    spam_24h = await db.ts_events.count_documents({"reasons": "spam", "at": {"$gte": day}})
    harass_24h = await db.ts_events.count_documents({"reasons": "harassment", "at": {"$gte": day}})
    pipe = [{"$match": {"violation": True, "at": {"$gte": week}}},
            {"$unwind": "$reasons"}, {"$group": {"_id": "$reasons", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}}, {"$limit": 6}]
    trending = [{"reason": g["_id"], "count": g["n"]} async for g in db.ts_events.aggregate(pipe)]
    false_pos = await db.ts_appeals.count_documents({"status": "approved"})
    recs = []
    if urgent:
        recs.append(f"{urgent} urgent case(s) need review first")
    if pending_review:
        recs.append(f"{pending_review} auto-locked account(s) await your decision — none were permanently banned")
    if appeals:
        recs.append(f"{appeals} appeal(s) pending")
    if not recs:
        recs.append("All clear — no urgent Trust & Safety work")
    return {"cards": {"active_cases": open_cases, "urgent_cases": urgent,
                      "pending_founder_review": pending_review, "temporarily_locked": locked,
                      "suspended": suspended, "banned": banned, "appeals_pending": appeals,
                      "spam_24h": spam_24h, "harassment_24h": harass_24h,
                      "false_positives_restored": false_pos},
            "trending_abuse": trending, "orai_recommendations": recs}


@router.get("/queue")
async def queue(current: CurrentUser, status: str = "open", limit: int = 40):
    require_founder(current)
    rows = await db.ts_cases.find({"status": status}, {"_id": 0}).sort(
        [("priority", -1), ("updated_at", -1)]).to_list(max(1, min(limit, 100)))
    return {"cases": rows}


@router.get("/case/{case_id}")
async def case_detail(case_id: str, current: CurrentUser):
    require_founder(current)
    case = await db.ts_cases.find_one({"id": case_id}, {"_id": 0})
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    uid = case["user_id"]
    user = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1, "email": 1, "created_at": 1,
                                                 "trust": 1, "ts_status": 1, "suspended_until": 1,
                                                 "suspension_reason": 1, "profile_hidden": 1,
                                                 "avatar_url": 1, "bio": 1})
    events = await db.ts_events.find({"user_id": uid}, {"_id": 0}).sort("at", -1).to_list(40)
    audits = await db.ts_audit.find({"target_user_id": uid}, {"_id": 0}).sort("at", -1).to_list(40)
    reports = await db.reports.find({"target_user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(20)
    posts = await db.posts.find({"author_id": uid}, {"_id": 0, "id": 1, "content": 1,
                                                     "moderation_status": 1, "created_at": 1}).sort("created_at", -1).to_list(30)
    comments = await db.comments.find({"author_id": uid}, {"_id": 0, "id": 1, "content": 1,
                                                           "moderation_status": 1, "created_at": 1}).sort("created_at", -1).to_list(30)
    flagged_dms = await db.messages.find({"sender_id": uid, "moderation_status": {"$in": ["hidden", "pending_review", "removed_by_moderator"]}},
                                         {"_id": 0, "id": 1, "content": 1, "moderation_status": 1}).to_list(20)
    usernames = await db.ts_username_history.find({"user_id": uid}, {"_id": 0}).to_list(10)
    appeals = await db.ts_appeals.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(10)
    return {"case": case, "user": user, "events": events, "moderation_history": audits,
            "reports": reports, "posts": posts, "comments": comments, "flagged_dms": flagged_dms,
            "username_history": usernames, "appeals": appeals,
            "ip_device_history": [],  # not tracked — surfaced as explicitly unavailable
            "bulk_actions": ts.BULK_ACTIONS}


@router.post("/command")
async def command(body: dict, current: CurrentUser):
    """ORAi natural-language moderation commands. Destructive intents
    require confirmed=true (founder confirmation)."""
    require_founder(current)
    res = await ts.execute_command(str(body.get("text") or ""), current,
                                   target_user_id=body.get("target_user_id"),
                                   target_content=body.get("target_content"),
                                   confirmed=bool(body.get("confirmed")))
    return res


@router.post("/bulk/{user_id}")
async def bulk(user_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    action = str(body.get("action") or "")
    if action in ts.CONFIRM_REQUIRED and not body.get("confirmed"):
        return {"ok": False, "needs_confirmation": True,
                "prompt": f"⚠️ '{action}' requires explicit founder confirmation."}
    try:
        res = await ts.bulk_action(action, user_id, current, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "action": action, "result": res}


@router.post("/case/{case_id}/resolve")
async def resolve_case(case_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    await db.ts_cases.update_one({"id": case_id}, {"$set": {
        "status": "resolved", "resolution": str(body.get("resolution") or "reviewed")[:200],
        "resolved_by": current.get("username"), "updated_at": _iso_now()}})
    await ts.audit(actor=current, action="case_resolved", reason=body.get("resolution", ""),
                   meta={"case_id": case_id})
    return {"ok": True}


@router.get("/audit")
async def audit_log(current: CurrentUser, user_id: str = None, limit: int = 60):
    require_founder(current)
    flt = {"target_user_id": user_id} if user_id else {}
    rows = await db.ts_audit.find(flt, {"_id": 0}).sort("at", -1).to_list(max(1, min(limit, 200)))
    return {"audit": rows}


@router.get("/user/{user_id}/trust")
async def user_trust(user_id: str, current: CurrentUser):
    require_founder(current)
    return {"trust": await ts.compute_trust(user_id)}


@router.get("/appeals")
async def list_appeals(current: CurrentUser, status: str = "pending"):
    require_founder(current)
    rows = await db.ts_appeals.find({"status": status}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"appeals": rows}


@router.post("/appeals/{appeal_id}/resolve")
async def appeal_resolve(appeal_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    resolution = str(body.get("resolution") or "")
    if resolution not in ("approved", "rejected", "reduce_penalty", "extend_penalty", "restore_content"):
        raise HTTPException(status_code=400, detail="Invalid resolution")
    if resolution == "restore_content":
        r = await ts.undo_last(current)
        await db.ts_appeals.update_one({"id": appeal_id}, {"$set": {"status": "approved",
                                                                    "resolution_note": "content restored"}})
        return r
    return await ts.resolve_appeal(appeal_id, resolution, current, str(body.get("note") or ""),
                                   penalty_hours=body.get("penalty_hours"))


# ── User-facing appeals ──────────────────────────────────────────────
@user_router.post("")
async def submit_appeal(body: dict, current: CurrentUser):
    if not str(body.get("message") or "").strip():
        raise HTTPException(status_code=400, detail="Tell us why this action should be reviewed")
    pending = await db.ts_appeals.count_documents({"user_id": current["id"], "status": "pending"})
    if pending >= 2:
        raise HTTPException(status_code=429, detail="You already have pending appeals under review")
    return {"appeal": await ts.submit_appeal(current, body["message"], body.get("case_id"))}


@user_router.get("/mine")
async def my_appeals(current: CurrentUser):
    rows = await db.ts_appeals.find({"user_id": current["id"]}, {"_id": 0}).sort("created_at", -1).to_list(10)
    return {"appeals": rows}
