"""Fire Power reaction system — service layer (June 2026).

Public posts use progression-gated Fire reactions instead of Likes.
Rules:
  • 1x Fire is ALWAYS unlimited for every user.
  • Boosted Fire (2x+) consumes the user's rolling 24-hour Daily Fire
    Pool: boosted_cost = max(fire_value - 1, 0).
  • Pool replenishes exactly 24h after each individual boost (server
    UTC timestamps — NOT a midnight reset).
  • Backend authoritative: level caps, pool balance, idempotency and
    concurrency are all enforced here.
  • Lowering/removing Fire never refunds the pool (anti pump-and-dump).
    Re-raising within the active window only charges the delta above
    what is still paid for that reaction.
  • DMs / group / community / private-message emoji reactions are a
    separate system (routers/reactions.py) and are NEVER touched.

Every feature is behind founder-controlled flags that default OFF.
"""
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core.db import db

log = logging.getLogger("ourrealm.fire")

# ── Flags (all default OFF — founder toggles per environment) ──────────
FIRE_FLAG_KEYS = ["fire_reactions", "boosted_fire", "fire_ranked_feed", "fire_notifications", "fire_wallet_enabled",
                  "fire_collection_enabled", "fire_pending_enabled", "fire_collectable_enabled",
                  "fire_wallet_history_enabled", "fire_admin_tools_enabled"]
FIRE_FLAG_DEFAULTS = {k: False for k in FIRE_FLAG_KEYS}

POOL_WINDOW_HOURS = 24
FIRE_WINDOWS = {"1h": 1, "12h": 12, "24h": 24, "1w": 168, "1m": 720}

# Launch defaults per level_number (Level Builder can override per level).
DEFAULT_LEVEL_FIRE = {
    1: {"max_fire_per_reaction": 1,   "daily_fire_pool": 0,   "fire_enabled": True},   # Newbie
    2: {"max_fire_per_reaction": 2,   "daily_fire_pool": 10,  "fire_enabled": True},   # Explorer
    3: {"max_fire_per_reaction": 5,   "daily_fire_pool": 25,  "fire_enabled": True},   # Creator
    4: {"max_fire_per_reaction": 10,  "daily_fire_pool": 50,  "fire_enabled": True},   # Rising Star
    5: {"max_fire_per_reaction": 20,  "daily_fire_pool": 100, "fire_enabled": True},   # Influencer
    6: {"max_fire_per_reaction": 35,  "daily_fire_pool": 200, "fire_enabled": True},   # Elite
    7: {"max_fire_per_reaction": 50,  "daily_fire_pool": 350, "fire_enabled": True},   # Master
    8: {"max_fire_per_reaction": 100, "daily_fire_pool": 500, "fire_enabled": True},   # Legend
}
FALLBACK_FIRE = DEFAULT_LEVEL_FIRE[1]

MIGRATION_PHRASE = "MIGRATE LIKES TO FIRE"
ROLLBACK_PHRASE = "ROLLBACK FIRE MIGRATION"

_PUBLIC_LIKED_QUERY = {"audience.visibility": "public", "liked_by.0": {"$exists": True}}

_flag_cache = {"at": 0.0, "flags": None}
_INDEXES_READY = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Flags ───────────────────────────────────────────────────────────────
async def get_fire_flags() -> dict:
    now = time.monotonic()
    if _flag_cache["flags"] is not None and now - _flag_cache["at"] < 5:
        return _flag_cache["flags"]
    doc = await db.fire_flags.find_one({"_id": "flags"}) or {}
    flags = {**FIRE_FLAG_DEFAULTS, **{k: bool(doc.get(k)) for k in FIRE_FLAG_KEYS if k in doc}}
    _flag_cache.update(at=now, flags=flags)
    return flags


async def set_fire_flag(key: str, value: bool, updated_by: str) -> dict:
    if key not in FIRE_FLAG_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown fire flag: {key}")
    await db.fire_flags.update_one(
        {"_id": "flags"},
        {"$set": {key: bool(value), "updated_by": updated_by, "updated_at": _now_iso()}},
        upsert=True,
    )
    _flag_cache["flags"] = None
    return await get_fire_flags()


# ── Indexes ─────────────────────────────────────────────────────────────
async def ensure_fire_indexes() -> None:
    global _INDEXES_READY
    if _INDEXES_READY:
        return
    try:
        await db.post_fire_reactions.create_index(
            [("post_id", 1), ("user_id", 1)], unique=True, name="uniq_post_user")
        await db.post_fire_reactions.create_index(
            [("active", 1), ("updated_at", 1), ("post_id", 1)], name="by_active_time")
        await db.post_fire_reactions.create_index([("user_id", 1)], name="by_user")
        await db.post_fire_reactions.create_index([("source", 1)], name="by_source")
        await db.fire_power_transactions.create_index(
            [("user_id", 1), ("status", 1), ("expires_at", 1)], name="by_user_status_exp")
        await db.fire_power_transactions.create_index(
            [("reaction_id", 1), ("status", 1)], name="by_reaction_status")
    except Exception as e:  # noqa: BLE001 — index drift never blocks requests
        log.warning(f"[fire] index init issue: {e}")
    _INDEXES_READY = True


# ── Level fire configuration ────────────────────────────────────────────
def clean_fire_settings(fs: dict) -> dict:
    """Validate + normalise Level Builder fire settings."""
    if not isinstance(fs, dict):
        raise HTTPException(status_code=400, detail="fire_settings must be an object")
    try:
        mx = int(fs.get("max_fire_per_reaction", 1))
        pool = int(fs.get("daily_fire_pool", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Fire settings must be whole numbers")
    if mx < 1 or mx > 1000:
        raise HTTPException(status_code=400, detail="max_fire_per_reaction must be 1–1000")
    if pool < 0 or pool > 1_000_000:
        raise HTTPException(status_code=400, detail="daily_fire_pool must be 0–1,000,000")
    return {"max_fire_per_reaction": mx, "daily_fire_pool": pool,
            "fire_enabled": fs.get("fire_enabled", True) is not False}


async def fire_config_for_user(user: dict) -> dict:
    """Resolve the user's fire limits from their CURRENT progression level."""
    ulp = await db.user_level_progress.find_one(
        {"user_id": user["id"]},
        {"_id": 0, "current_level_id": 1, "current_level_number": 1})
    level = None
    if ulp:
        level = await db.progression_levels.find_one(
            {"id": ulp["current_level_id"]},
            {"_id": 0, "fire_settings": 1, "level_number": 1, "name": 1, "graphics": 1})
    num = (level or {}).get("level_number") or (ulp or {}).get("current_level_number") or 1
    fs = (level or {}).get("fire_settings") or DEFAULT_LEVEL_FIRE.get(num) or FALLBACK_FIRE
    fs = clean_fire_settings(fs)
    gfx = (level or {}).get("graphics") or {}
    return {**fs, "level_number": num, "level_name": (level or {}).get("name"),
            "level_badge_url": gfx.get("badge_thumb_url") or gfx.get("badge_url")}


# ── Rolling 24h pool accounting ─────────────────────────────────────────
async def _expire_transactions(uid: str) -> None:
    """Lazy expiry — each boost returns to the pool exactly 24h after it
    was spent. Status flip is guarded so each txn is decremented once."""
    now = _now_iso()
    async for txn in db.fire_power_transactions.find(
            {"user_id": uid, "status": "active", "expires_at": {"$lte": now}},
            {"_id": 0, "id": 1, "boosted_amount": 1}):
        r = await db.fire_power_transactions.update_one(
            {"id": txn["id"], "status": "active"},
            {"$set": {"status": "expired", "expired_at": now}})
        if r.modified_count:
            await db.fire_pool_counters.update_one(
                {"_id": uid},
                {"$inc": {"spent_active": -int(txn.get("boosted_amount") or 0)}},
                upsert=True)
    await db.fire_pool_counters.update_one(
        {"_id": uid, "spent_active": {"$lt": 0}}, {"$set": {"spent_active": 0}})


async def pool_status(user: dict, cfg: Optional[dict] = None) -> dict:
    cfg = cfg or await fire_config_for_user(user)
    uid = user["id"]
    await _expire_transactions(uid)
    counter = await db.fire_pool_counters.find_one({"_id": uid}) or {}
    spent = max(0, int(counter.get("spent_active") or 0))
    pool = cfg["daily_fire_pool"]
    next_recovery_at = None
    next_recovery_amount = 0
    if spent > 0:
        nxt = await db.fire_power_transactions.find(
            {"user_id": uid, "status": "active"},
            {"_id": 0, "expires_at": 1, "boosted_amount": 1},
        ).sort("expires_at", 1).to_list(1)
        if nxt:
            next_recovery_at = nxt[0]["expires_at"]
            next_recovery_amount = int(nxt[0].get("boosted_amount") or 0)
    return {"pool_max": pool, "spent": min(spent, pool) if pool else spent,
            "available": max(0, pool - spent),
            "next_recovery_at": next_recovery_at,
            "next_recovery_amount": next_recovery_amount}


async def _reserved_for_reaction(reaction_id: str) -> int:
    """Net active pool reservation for a reaction (charges minus releases)."""
    agg = await db.fire_power_transactions.aggregate([
        {"$match": {"reaction_id": reaction_id, "status": "active"}},
        {"$group": {"_id": None, "paid": {"$sum": "$boosted_amount"}}},
    ]).to_list(1)
    return max(0, int(agg[0]["paid"])) if agg else 0


# ── Core mutation ───────────────────────────────────────────────────────
async def react(user: dict, post_id: str, fire_value: int,
                idempotency_key: Optional[str] = None) -> dict:
    await ensure_fire_indexes()
    flags = await get_fire_flags()
    if not flags.get("fire_reactions"):
        raise HTTPException(status_code=403, detail="Fire reactions are not enabled")
    try:
        fire_value = int(fire_value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="fire_value must be a whole number")
    if fire_value < 0 or fire_value > 1000:
        raise HTTPException(status_code=400, detail="fire_value out of range")

    post = await db.posts.find_one(
        {"id": post_id},
        {"_id": 0, "id": 1, "author_id": 1, "content": 1, "audience": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if ((post.get("audience") or {}).get("visibility") or "public") != "public":
        raise HTTPException(status_code=400, detail="Fire is only available on public posts")

    uid = user["id"]
    if user.get("fire_paused") or (await db.users.find_one({"id": uid}, {"_id": 0, "fire_paused": 1}) or {}).get("fire_paused"):
        raise HTTPException(status_code=403, detail="Fire is paused on your account. Contact support.")
    cfg = await fire_config_for_user(user)
    if fire_value > 1:
        if not flags.get("boosted_fire"):
            raise HTTPException(status_code=403, detail="Boosted Fire is not enabled yet")
        if not cfg["fire_enabled"]:
            raise HTTPException(status_code=403, detail="Boosted Fire is not available for your level")
        if fire_value > cfg["max_fire_per_reaction"]:
            raise HTTPException(
                status_code=400,
                detail=f"Your level allows up to {cfg['max_fire_per_reaction']}x Fire per reaction")

    idem = str(idempotency_key)[:128] if idempotency_key else None
    if idem:
        try:
            await db.fire_idempotency.insert_one(
                {"_id": idem, "user_id": uid, "post_id": post_id,
                 "fire_value": fire_value, "created_at": _now_iso()})
        except DuplicateKeyError:
            state = await post_fire_state(post_id, uid)
            return {**state, "duplicate": True, "charged": 0,
                    "pool": await pool_status(user, cfg)}

    existing = await db.post_fire_reactions.find_one(
        {"post_id": post_id, "user_id": uid}, {"_id": 0})
    old_value = int(existing.get("fire_value") or 0) if (existing and existing.get("active")) else 0
    reaction_id = (existing or {}).get("id") or uuid.uuid4().hex

    # ── 24h edit window (Phase 0.6) — deadline = created_at + 24h, edits
    # never restart it. After the deadline the reaction is FINALIZED and
    # immutable (only founder compensating tools may reverse).
    now_dt = datetime.now(timezone.utc)
    if existing:
        deadline_iso = existing.get("edit_deadline")
        if not deadline_iso and existing.get("created_at"):
            try:
                deadline_iso = (datetime.fromisoformat(existing["created_at"]) + timedelta(hours=24)).isoformat()
            except (ValueError, TypeError):
                deadline_iso = None
        if deadline_iso and now_dt >= datetime.fromisoformat(deadline_iso):
            if idem:
                await db.fire_idempotency.delete_one({"_id": idem})
            raise HTTPException(status_code=403, detail="Your Fire on this post is finalized and can no longer be edited")
        edit_deadline = deadline_iso or (now_dt + timedelta(hours=24)).isoformat()
    else:
        edit_deadline = (now_dt + timedelta(hours=24)).isoformat()

    # ── Difference-based pool accounting (Phase 0.6):
    # reserved = net active pool reservation for this reaction.
    # Increasing charges only the difference; lowering/removing releases
    # the difference back to the pool (negative ledger row — the lazy
    # expiry loop self-reverses both signs at the edit deadline).
    cost = 0
    released = 0
    await _expire_transactions(uid)
    reserved = await _reserved_for_reaction(reaction_id)
    new_boost = max(fire_value - 1, 0)
    if new_boost > reserved:
        cost = new_boost - reserved
        pool = cfg["daily_fire_pool"]
        await db.fire_pool_counters.update_one(
            {"_id": uid}, {"$setOnInsert": {"spent_active": 0}}, upsert=True)
        # Atomic conditional spend — the concurrency + overspend guard.
        res = await db.fire_pool_counters.update_one(
            {"_id": uid, "spent_active": {"$lte": pool - cost}},
            {"$inc": {"spent_active": cost}})
        if res.modified_count != 1:
            if idem:
                await db.fire_idempotency.delete_one({"_id": idem})
            status = await pool_status(user, cfg)
            raise HTTPException(
                status_code=409,
                detail=f"Not enough Fire Power — {status['available']} of {pool} boost fire available.")
        await db.fire_power_transactions.insert_one({
            "id": uuid.uuid4().hex, "user_id": uid, "post_id": post_id,
            "reaction_id": reaction_id, "boosted_amount": cost,
            "transaction_type": "pool_charge", "policy_version": "0.6",
            "effective_at": now_dt.isoformat(),
            "expires_at": edit_deadline,
            "status": "active", "idempotency_key": idem,
        })
    elif new_boost < reserved:
        released = reserved - new_boost
        await db.fire_power_transactions.insert_one({
            "id": uuid.uuid4().hex, "user_id": uid, "post_id": post_id,
            "reaction_id": reaction_id, "boosted_amount": -released,
            "transaction_type": "pool_release", "policy_version": "0.6",
            "effective_at": now_dt.isoformat(),
            "expires_at": edit_deadline,
            "status": "active", "idempotency_key": idem,
        })
        await db.fire_pool_counters.update_one({"_id": uid}, {"$inc": {"spent_active": -released}})
        await db.fire_pool_counters.update_one(
            {"_id": uid, "spent_active": {"$lt": 0}}, {"$set": {"spent_active": 0}})

    now_iso = _now_iso()
    prev_high = max(int((existing or {}).get("max_fire_value") or 0), old_value)
    new_high = max(prev_high, fire_value)
    try:
        await db.post_fire_reactions.update_one(
            {"post_id": post_id, "user_id": uid},
            {"$set": {"fire_value": fire_value, "active": fire_value > 0,
                      "max_fire_value": new_high, "edit_deadline": edit_deadline,
                      "updated_at": now_iso, "source": "user"},
             "$inc": {"boosted_cost": cost},
             "$setOnInsert": {"id": reaction_id, "created_at": now_iso}},
            upsert=True)
    except DuplicateKeyError:
        # Upsert race on the unique (post_id, user_id) index — retry as plain update.
        await db.post_fire_reactions.update_one(
            {"post_id": post_id, "user_id": uid},
            {"$set": {"fire_value": fire_value, "active": fire_value > 0,
                      "max_fire_value": new_high, "edit_deadline": edit_deadline,
                      "updated_at": now_iso, "source": "user"},
             "$inc": {"boosted_cost": cost}})

    delta_total = fire_value - old_value
    delta_count = 1 if (old_value == 0 and fire_value > 0) else (-1 if (old_value > 0 and fire_value == 0) else 0)
    if delta_total or delta_count:
        await db.posts.update_one(
            {"id": post_id}, {"$inc": {"fire_total": delta_total, "fire_count": delta_count}})
        await db.posts.update_one({"id": post_id, "fire_total": {"$lt": 0}}, {"$set": {"fire_total": 0}})
        await db.posts.update_one({"id": post_id, "fire_count": {"$lt": 0}}, {"$set": {"fire_count": 0}})

    # Fire Vault (Phase 0.6) — recipient Pending Fire mirrors the CURRENT
    # active fire value live (difference-based): raises credit the delta,
    # lowers/removals debit the delta. Recipient always earns the FULL
    # fire value (never the boosted pool cost). Sender never earns.
    delta = fire_value - old_value
    if delta != 0 and post.get("author_id") and post["author_id"] != uid:
        try:
            from services.fire_vault import credit_fire, adjust_fire
            if delta > 0:
                await credit_fire(post["author_id"], uid, post_id, reaction_id,
                                  delta, idem, finalize_at=edit_deadline)
            else:
                await adjust_fire(post["author_id"], uid, post_id, reaction_id,
                                  delta, idem, finalize_at=edit_deadline)
        except Exception as e:  # noqa: BLE001
            log.warning(f"[fire] vault credit failed for post {post_id}: {e}")

    if (fire_value > old_value and post.get("author_id") and post["author_id"] != uid
            and flags.get("fire_notifications")):
        try:
            from routers.notifications import emit_notification
            await emit_notification(
                post["author_id"], "fire",
                actor_username=user.get("username"),
                payload={"preview": (post.get("content") or "")[:60],
                         "post_id": post_id, "fire_value": fire_value})
        except Exception:  # noqa: BLE001
            pass

    state = await post_fire_state(post_id, uid)
    return {**state, "charged": cost, "released": released, "duplicate": False,
            "edit_deadline": edit_deadline, "finalized": False,
            "pool": await pool_status(user, cfg)}


# ── Read helpers ────────────────────────────────────────────────────────
async def post_fire_state(post_id: str, viewer_id: Optional[str] = None) -> dict:
    p = await db.posts.find_one({"id": post_id}, {"_id": 0, "fire_total": 1, "fire_count": 1})
    my_fire = 0
    if viewer_id:
        mine = await db.post_fire_reactions.find_one(
            {"post_id": post_id, "user_id": viewer_id, "active": True},
            {"_id": 0, "fire_value": 1})
        my_fire = int((mine or {}).get("fire_value") or 0)
    return {"post_id": post_id,
            "fire_total": int((p or {}).get("fire_total") or 0),
            "fire_count": int((p or {}).get("fire_count") or 0),
            "my_fire": my_fire}


async def attach_fire(items: list, viewer_id: Optional[str] = None) -> None:
    """Attach `fire: {total, count, my_fire, my_fire_deadline,
    my_fire_finalized}` to each post dict in-place. Deadline fields are
    display-only (Phase 0.6 UI): created_at + 24h, edits never restart it."""
    ids = [p.get("id") for p in items if p.get("id")]
    mine: dict[str, dict] = {}
    if viewer_id and ids:
        async for r in db.post_fire_reactions.find(
                {"user_id": viewer_id, "post_id": {"$in": ids}, "active": True},
                {"_id": 0, "post_id": 1, "fire_value": 1, "created_at": 1}):
            mine[r["post_id"]] = r
    now = datetime.now(timezone.utc)
    for p in items:
        m = mine.get(p.get("id"))
        fire = {"total": int(p.get("fire_total") or 0),
                "count": int(p.get("fire_count") or 0),
                "my_fire": int((m or {}).get("fire_value") or 0)}
        if m and m.get("created_at"):
            try:
                deadline = datetime.fromisoformat(m["created_at"]) + timedelta(hours=24)
                fire["my_fire_deadline"] = deadline.isoformat()
                fire["my_fire_finalized"] = now >= deadline
            except (ValueError, TypeError):
                pass
        p["fire"] = fire


async def window_fire_map(post_ids: Iterable[str], window: str) -> Optional[dict]:
    """Fire totals per post within a time window. None for `all` (use
    the denormalised lifetime fire_total instead)."""
    ids = [i for i in post_ids if i]
    if not ids or window not in FIRE_WINDOWS:
        return None
    since = (datetime.now(timezone.utc) - timedelta(hours=FIRE_WINDOWS[window])).isoformat()
    out: dict[str, int] = {}
    async for row in db.post_fire_reactions.aggregate([
            {"$match": {"post_id": {"$in": ids}, "active": True, "updated_at": {"$gte": since}}},
            {"$group": {"_id": "$post_id", "total": {"$sum": "$fire_value"}}}]):
        out[row["_id"]] = int(row["total"])
    return out


async def recompute_post_fire(post_id: str) -> dict:
    agg = await db.post_fire_reactions.aggregate([
        {"$match": {"post_id": post_id, "active": True}},
        {"$group": {"_id": None, "total": {"$sum": "$fire_value"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    total = int(agg[0]["total"]) if agg else 0
    count = int(agg[0]["count"]) if agg else 0
    await db.posts.update_one({"id": post_id}, {"$set": {"fire_total": total, "fire_count": count}})
    return {"fire_total": total, "fire_count": count}


# ── Level defaults seeding (safe: only fills missing fields) ────────────
async def seed_default_fire_settings() -> list:
    updated = []
    async for lvl in db.progression_levels.find(
            {"status": {"$in": ["published", "draft", "paused"]},
             "fire_settings": {"$exists": False}},
            {"_id": 0, "id": 1, "name": 1, "level_number": 1}):
        fs = DEFAULT_LEVEL_FIRE.get(lvl.get("level_number")) or FALLBACK_FIRE
        await db.progression_levels.update_one(
            {"id": lvl["id"]}, {"$set": {"fire_settings": {**fs}}})
        updated.append({"id": lvl["id"], "name": lvl["name"],
                        "level_number": lvl.get("level_number"), "fire_settings": fs})
    return updated


# ── Migration: historical public Likes → 1x Fire ────────────────────────
# Never deletes/modifies legacy likes. Never consumes users' Fire Pools.
# Never touches DM / group / community emoji reactions.
async def migration_dry_run() -> dict:
    posts_with_likes = 0
    total_likes = 0
    would_create = 0
    already = 0
    samples = []
    async for p in db.posts.find(_PUBLIC_LIKED_QUERY, {"_id": 0, "id": 1, "liked_by": 1, "content": 1}):
        lb = [u for u in (p.get("liked_by") or []) if u]
        if not lb:
            continue
        posts_with_likes += 1
        total_likes += len(lb)
        existing = set()
        async for r in db.post_fire_reactions.find(
                {"post_id": p["id"], "user_id": {"$in": lb}}, {"_id": 0, "user_id": 1}):
            existing.add(r["user_id"])
        create = len([u for u in lb if u not in existing])
        would_create += create
        already += len(lb) - create
        if len(samples) < 10:
            samples.append({"post_id": p["id"], "preview": (p.get("content") or "")[:50],
                            "likes": len(lb), "would_create": create})
    return {"mode": "dry_run", "public_posts_with_likes": posts_with_likes,
            "total_public_likes": total_likes,
            "would_create_fire_reactions": would_create,
            "already_have_fire_reaction": already,
            "pool_consumed": 0, "likes_deleted": 0, "dm_reactions_touched": 0,
            "samples": samples, "generated_at": _now_iso()}


async def migration_execute(founder: dict) -> dict:
    await ensure_fire_indexes()
    posts_processed = 0
    created = 0
    skipped = 0
    now_iso = _now_iso()
    async for p in db.posts.find(_PUBLIC_LIKED_QUERY, {"_id": 0, "id": 1, "liked_by": 1}):
        lb = [u for u in (p.get("liked_by") or []) if u]
        if not lb:
            continue
        for uid in lb:
            r = await db.post_fire_reactions.update_one(
                {"post_id": p["id"], "user_id": uid},
                {"$setOnInsert": {"id": uuid.uuid4().hex, "fire_value": 1,
                                  "boosted_cost": 0, "active": True, "source": "migration",
                                  "created_at": now_iso, "updated_at": now_iso}},
                upsert=True)
            if r.upserted_id is not None:
                created += 1
            else:
                skipped += 1
        await recompute_post_fire(p["id"])
        posts_processed += 1
    report = {"mode": "execute", "posts_processed": posts_processed,
              "reactions_created": created, "skipped_existing": skipped,
              "pool_consumed": 0, "likes_deleted": 0,
              "executed_by": founder.get("username"), "executed_at": now_iso}
    await db.fire_migration_log.insert_one({"id": uuid.uuid4().hex, "action": "execute", **report})
    return report


async def migration_rollback(founder: dict) -> dict:
    affected = await db.post_fire_reactions.distinct("post_id", {"source": "migration"})
    res = await db.post_fire_reactions.delete_many({"source": "migration"})
    for pid in affected:
        await recompute_post_fire(pid)
    report = {"mode": "rollback", "reactions_removed": res.deleted_count,
              "posts_recomputed": len(affected), "likes_deleted": 0,
              "executed_by": founder.get("username"), "executed_at": _now_iso()}
    await db.fire_migration_log.insert_one({"id": uuid.uuid4().hex, "action": "rollback", **report})
    return report


async def migration_reconcile(fix: bool = False) -> dict:
    checked = 0
    mismatches = []
    fixed = 0
    async for p in db.posts.find(
            {"audience.visibility": "public",
             "$or": [{"fire_count": {"$gt": 0}}, {"liked_by.0": {"$exists": True}}]},
            {"_id": 0, "id": 1, "liked_by": 1, "fire_total": 1, "fire_count": 1}):
        checked += 1
        agg = await db.post_fire_reactions.aggregate([
            {"$match": {"post_id": p["id"], "active": True}},
            {"$group": {"_id": None, "total": {"$sum": "$fire_value"}, "count": {"$sum": 1}}},
        ]).to_list(1)
        actual_total = int(agg[0]["total"]) if agg else 0
        actual_count = int(agg[0]["count"]) if agg else 0
        stored_total = int(p.get("fire_total") or 0)
        stored_count = int(p.get("fire_count") or 0)
        if actual_total != stored_total or actual_count != stored_count:
            mismatches.append({"post_id": p["id"],
                               "stored": {"total": stored_total, "count": stored_count},
                               "actual": {"total": actual_total, "count": actual_count}})
            if fix:
                await db.posts.update_one(
                    {"id": p["id"]},
                    {"$set": {"fire_total": actual_total, "fire_count": actual_count}})
                fixed += 1
    total_legacy_likes = 0
    async for p in db.posts.find(_PUBLIC_LIKED_QUERY, {"_id": 0, "liked_by": 1}):
        total_legacy_likes += len([u for u in (p.get("liked_by") or []) if u])
    migrated = await db.post_fire_reactions.count_documents({"source": "migration"})
    return {"mode": "reconcile", "posts_checked": checked,
            "counter_mismatches": len(mismatches), "fixed": fixed,
            "total_legacy_public_likes": total_legacy_likes,
            "migrated_fire_reactions": migrated,
            "mismatch_samples": mismatches[:20], "generated_at": _now_iso()}
