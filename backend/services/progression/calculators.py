"""Shared progression calculators — one function per strategy.

Every calculator reads TRUSTED backend records only, applies the canonical
anti-abuse exclusions (self-actions, synthetic/deleted sources, moderated
content), and returns:
    {"value": int|float, "target": int|float, "completed": bool,
     "source": str, "reason": str}
"""
from datetime import datetime, timezone

from core.db import db
from core.analytics_filters import real_member_filter
from services.progression.eligibility import (
    is_foryou_eligible_post, foryou_eligible_query, is_real_media_url,
)

MAX_SCAN = 2000  # bound per-user historical scans


def _res(value, target, source, reason):
    return {"value": value, "target": target, "completed": value >= target,
            "source": source, "reason": reason}


async def _real_user_ids(candidate_ids: set) -> set:
    """Filter a set of user ids down to real members (anti-abuse)."""
    if not candidate_ids:
        return set()
    out = set()
    async for u in db.users.find({**real_member_filter(), "id": {"$in": list(candidate_ids)}}, {"_id": 0, "id": 1}):
        out.add(u["id"])
    return out


def _since_filter(cfg, level_started_at):
    """Date window: tasks may count all history or only post-level-start."""
    if cfg.get("count_historical", True):
        since = cfg.get("window_start")
    else:
        since = level_started_at
    f = {}
    if since:
        f["$gte"] = since
    if cfg.get("window_end"):
        f["$lte"] = cfg["window_end"]
    return {"created_at": f} if f else {}


# ── Strategies ──────────────────────────────────────────────────────────

async def profile_field(user, cfg, level_started_at, target):
    field = cfg.get("field")
    if field == "avatar":
        ok = is_real_media_url(user.get("avatar_url"))
        return _res(1 if ok else 0, 1, "users.avatar_url", "real uploaded avatar" if ok else "no real avatar")
    if field == "banner":
        ok = is_real_media_url(user.get("banner_url"))
        return _res(1 if ok else 0, 1, "users.banner_url", "real uploaded banner" if ok else "no real banner")
    if field == "bio":
        ok = len((user.get("bio") or "").strip()) >= int(cfg.get("min_length", 3))
        return _res(1 if ok else 0, 1, "users.bio", "bio set" if ok else "bio missing")
    if field == "location":
        ok = bool((user.get("zip_code") or "").strip() or (user.get("location") or "").strip())
        return _res(1 if ok else 0, 1, "users.zip_code/location", "location set" if ok else "no location")
    if field == "interests":
        n = len(user.get("interests") or [])
        return _res(min(n, target), max(target, int(cfg.get("min_count", 1))), "users.interests", f"{n} interests")
    if field == "display_name":
        ok = bool((user.get("name") or "").strip())
        return _res(1 if ok else 0, 1, "users.name", "display name set" if ok else "missing")
    if field == "links":
        social = user.get("social") or {}
        ok = any(v for v in (social.values() if isinstance(social, dict) else []))
        return _res(1 if ok else 0, 1, "users.social", "links present" if ok else "no links")
    if field == "appearance":
        ok = is_real_media_url(user.get("banner_url")) or bool(user.get("widgets"))
        return _res(1 if ok else 0, 1, "users.widgets/banner", "customized" if ok else "default appearance")
    return _res(0, 1, "unknown", f"unknown profile field {field!r}")


PROFILE_FIELDS = ["avatar", "banner", "bio", "display_name", "interests", "location", "links"]


async def profile_completion(user, cfg, level_started_at, target):
    done = 0
    for f in PROFILE_FIELDS:
        r = await profile_field(user, {"field": f}, level_started_at, 1)
        if r["completed"]:
            done += 1
    pct = round(done / len(PROFILE_FIELDS) * 100)
    tgt = int(cfg.get("target_pct", target if target > 1 else 80))
    return _res(pct, tgt, "users.*", f"{done}/{len(PROFILE_FIELDS)} profile fields")


async def post_count(user, cfg, level_started_at, target):
    q = foryou_eligible_query(user["id"])
    if cfg.get("media_type"):
        q["media_type"] = cfg["media_type"]
    q.update(_since_filter(cfg, level_started_at))
    foryou_only = bool(cfg.get("foryou_only"))
    unique_days = cfg.get("unique") == "day"
    n, days = 0, set()
    async for p in db.posts.find(q, {"_id": 0}).limit(MAX_SCAN):
        if foryou_only and not is_foryou_eligible_post(p):
            continue
        if not foryou_only and (p.get("deleted_at") or p.get("is_draft")):
            continue
        if unique_days:
            days.add((p.get("created_at") or "")[:10])
        else:
            n += 1
    value = len(days) if unique_days else n
    return _res(value, target, "db.posts", f"{value} qualifying posts" + (" (unique days)" if unique_days else ""))


async def engagement_received(user, cfg, level_started_at, target):
    kind = cfg.get("kind", "any")
    unique_user = cfg.get("unique") == "user"
    post_ids, likers = [], set()
    async for p in db.posts.find({"author_id": user["id"], "deleted_at": {"$exists": False}},
                                 {"_id": 0, "id": 1, "liked_by": 1}).limit(MAX_SCAN):
        post_ids.append(p["id"])
        for uid in (p.get("liked_by") or []):
            if uid != user["id"]:
                likers.add(uid)
    total, actors = 0, set()
    if kind in ("like", "any"):
        real_likers = await _real_user_ids(likers)
        total += len(real_likers)
        actors |= real_likers
    if kind in ("comment", "any") and post_ids:
        commenters = set()
        cnt = 0
        async for c in db.comments.find({"post_id": {"$in": post_ids[:500]}},
                                        {"_id": 0, "author_id": 1}).limit(MAX_SCAN):
            if c.get("author_id") and c["author_id"] != user["id"]:
                commenters.add(c["author_id"])
                cnt += 1
        real_commenters = await _real_user_ids(commenters)
        actors |= real_commenters
        if kind == "comment":
            total += cnt if not unique_user else 0
    if kind == "view":
        total = 0  # views are not durably tracked yet — never auto-complete
    value = len(actors) if unique_user else total
    return _res(value, target, "db.posts/comments", f"{value} valid {kind} engagements")


async def friend_count(user, cfg, level_started_at, target):
    friends = set(user.get("friends") or [])
    friends.discard(user["id"])
    real = await _real_user_ids(friends)
    return _res(len(real), target, "users.friends", f"{len(real)} real connections")


async def messages_sent(user, cfg, level_started_at, target):
    q = {"from_user_id": user["id"], **_since_filter(cfg, level_started_at)}
    recipients = set()
    n = 0
    async for m in db.messages.find(q, {"_id": 0, "to_user_id": 1}).limit(MAX_SCAN):
        if m.get("to_user_id") and m["to_user_id"] != user["id"]:
            recipients.add(m["to_user_id"])
            n += 1
    if cfg.get("unique") == "user":
        real = await _real_user_ids(recipients)
        return _res(len(real), target, "db.messages", f"messaged {len(real)} real users")
    return _res(n, target, "db.messages", f"{n} messages sent")


async def group_membership(user, cfg, level_started_at, target):
    q = {"user_id": user["id"]}
    if cfg.get("community_type"):
        q["community_type"] = cfg["community_type"]
    if cfg.get("community_id"):
        q["community_id"] = cfg["community_id"]
    n = await db.community_memberships.count_documents(q)
    return _res(n, target, "db.community_memberships", f"{n} memberships")


async def list_field_count(user, cfg, level_started_at, target):
    vals = user.get(cfg.get("field") or "") or []
    ids = set(v for v in vals if isinstance(v, str) and v != user["id"])
    return _res(len(ids), target, f"users.{cfg.get('field')}", f"{len(ids)} entries")


async def interactions_given(user, cfg, level_started_at, target):
    kind = cfg.get("kind", "any")
    unique_user = cfg.get("unique") == "user"
    authors, n = set(), 0

    async def _author_of(post_id):
        p = await db.posts.find_one({"id": post_id}, {"_id": 0, "author_id": 1, "deleted_at": 1})
        return (p or {}).get("author_id") if p and not p.get("deleted_at") else None

    if kind in ("reaction", "any"):
        seen_targets = set()
        async for r in db.reactions.find({"user_id": user["id"], "target_type": "post",
                                          **_since_filter(cfg, level_started_at)},
                                         {"_id": 0, "target_id": 1}).limit(MAX_SCAN):
            tid = r.get("target_id")
            if not tid or tid in seen_targets:
                continue
            seen_targets.add(tid)
            a = await _author_of(tid)
            if a and a != user["id"]:
                authors.add(a)
                n += 1
    if kind in ("comment", "any"):
        seen = set()
        async for c in db.comments.find({"author_id": user["id"], **_since_filter(cfg, level_started_at)},
                                        {"_id": 0, "post_id": 1}).limit(MAX_SCAN):
            pid = c.get("post_id")
            if not pid or pid in seen:
                continue
            seen.add(pid)
            a = await _author_of(pid)
            if a and a != user["id"]:
                authors.add(a)
                n += 1
    if unique_user:
        real = await _real_user_ids(authors)
        return _res(len(real), target, "db.reactions/comments", f"interacted with {len(real)} real users")
    real = await _real_user_ids(authors)
    # count only interactions whose authors are real
    return _res(n if len(real) == len(authors) else min(n, len(real) if unique_user else n),
                target, "db.reactions/comments", f"{n} interactions given")


async def realm_activity(user, cfg, level_started_at, target):
    kind = cfg.get("kind", "any")
    unique_obj = cfg.get("unique") == "object"
    realms, n = set(), 0
    since = _since_filter(cfg, level_started_at)
    if kind in ("post", "any"):
        q = {"author_id": user["id"], **since}
        if cfg.get("community_id"):
            q["community_id"] = cfg["community_id"]
        async for p in db.community_hub_posts.find(q, {"_id": 0, "community_id": 1}).limit(MAX_SCAN):
            realms.add(p.get("community_id")); n += 1
    if kind in ("message", "any"):
        q = {"user_id": user["id"], **since}
        if cfg.get("community_id"):
            q["community_id"] = cfg["community_id"]
        async for m in db.community_messages.find(q, {"_id": 0, "community_id": 1}).limit(MAX_SCAN):
            realms.add(m.get("community_id")); n += 1
    if kind in ("poll_vote", "any"):
        q = {"user_id": user["id"]}
        async for v in db.realm_poll_votes.find(q, {"_id": 0, "realm_id": 1, "community_id": 1}).limit(MAX_SCAN):
            realms.add(v.get("realm_id") or v.get("community_id")); n += 1
    value = len({r for r in realms if r}) if unique_obj else n
    return _res(value, target, "db.community_*", f"{value} realm activities")


async def active_days(user, cfg, level_started_at, target):
    q = {"user_id": user["id"]}
    if not cfg.get("count_historical", True) and level_started_at:
        q["day"] = {"$gte": level_started_at[:10]}
    n = await db.user_activity_days.count_documents(q)
    return _res(n, target, "db.user_activity_days", f"active on {n} unique days")


async def app_event_count(user, cfg, level_started_at, target):
    key = cfg.get("event_key")
    if not key:
        return _res(0, target, "progression_events", "no event key configured — never auto-completes")
    q = {"user_id": user["id"], "event_key": key, "status": "processed"}
    if cfg.get("object_key"):
        q["object_id"] = cfg["object_key"]
    unique = cfg.get("unique")
    if unique == "object":
        vals = await db.progression_events.distinct("object_id", q)
        value = len([v for v in vals if v])
    elif unique == "day":
        vals = await db.progression_events.distinct("event_day", q)
        value = len([v for v in vals if v])
    else:
        value = await db.progression_events.count_documents(q)
    op = cfg.get("operator", ">=")
    completed = {"<": value < target, "<=": value <= target, "==": value == target,
                 ">": value > target}.get(op, value >= target)
    r = _res(value, target, "db.progression_events", f"{value} '{key}' events")
    r["completed"] = completed
    return r


async def engagement_combo(user, cfg, level_started_at, target):
    kinds = cfg.get("kinds") or ["reaction", "comment"]
    done = 0
    for k in kinds:
        r = await interactions_given(user, {"kind": k}, level_started_at, 1)
        if r["completed"]:
            done += 1
    return _res(done, target, "db.reactions/comments", f"{done}/{len(kinds)} engagement types")


async def tutorial_complete(user, cfg, level_started_at, target):
    doc = await db.user_tutorial_progress.find_one(
        {"user_id": user["id"], "state": {"$in": ["completed", "skipped"]}})
    ok = bool(doc and doc.get("state") == "completed") or bool(cfg.get("allow_skipped") and doc)
    return _res(1 if ok else 0, 1, "db.user_tutorial_progress", "tutorial completed" if ok else "not completed")


async def widget_customized(user, cfg, level_started_at, target):
    widgets = user.get("widgets") or []
    ok = len(widgets) > 2 or any(w.get("editor_config") or w.get("size") not in (None, "medium") for w in widgets if isinstance(w, dict))
    return _res(1 if ok else 0, 1, "users.widgets", "widgets customized" if ok else "default widgets")


async def manual_approval(user, cfg, level_started_at, target, task_id=None, level_id=None):
    q = {"user_id": user["id"], "status": "approved"}
    if task_id:
        q["task_id"] = task_id
    doc = await db.progression_manual_approvals.find_one(q)
    ok = bool(doc)
    return _res(1 if ok else 0, 1, "db.progression_manual_approvals",
                "founder approved" if ok else "awaiting founder approval")


STRATEGIES = {
    "profile_field": profile_field,
    "profile_completion": profile_completion,
    "post_count": post_count,
    "engagement_received": engagement_received,
    "friend_count": friend_count,
    "messages_sent": messages_sent,
    "group_membership": group_membership,
    "list_field_count": list_field_count,
    "interactions_given": interactions_given,
    "realm_activity": realm_activity,
    "active_days": active_days,
    "app_event_count": app_event_count,
    "engagement_combo": engagement_combo,
    "tutorial_complete": tutorial_complete,
    "widget_customized": widget_customized,
    "manual_approval": manual_approval,
}


async def calculate_task(user: dict, task: dict, level_started_at) -> dict:
    """Safe entrypoint — unknown/retired task types never auto-complete."""
    from services.progression.registry import get_task_type
    tt = get_task_type(task.get("task_type_key") or "")
    if not tt or task.get("status") in ("retired", "archived"):
        return {"value": 0, "target": int(task.get("target_value") or 1), "completed": False,
                "source": "none", "reason": "unknown or retired task type — fails safe"}
    strat = STRATEGIES.get(tt["strategy"])
    if not strat:
        return {"value": 0, "target": int(task.get("target_value") or 1), "completed": False,
                "source": "none", "reason": f"strategy {tt['strategy']!r} not registered"}
    cfg = {**tt["default_config"], **(task.get("config") or {})}
    target = int(task.get("target_value") or cfg.get("target", 1) or 1)
    try:
        if tt["strategy"] == "manual_approval":
            return await strat(user, cfg, level_started_at, target, task_id=task.get("id"))
        return await strat(user, cfg, level_started_at, target)
    except Exception as e:  # calculation must never crash progression reads
        return {"value": 0, "target": target, "completed": False,
                "source": "error", "reason": f"calculator error: {e}"}
