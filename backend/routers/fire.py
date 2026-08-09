"""Fire Power endpoints (/api/fire/*). All features are flag-gated
(founder-controlled, default OFF). DM/private emoji reactions are a
separate system and are never routed through here."""
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser, OptionalUser
from core.permissions import require_founder
from services import fire_power as fp

log = logging.getLogger("ourrealm.fire")

router = APIRouter(prefix="/api/fire", tags=["fire"])


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def _audit(founder: dict, action: str, extra: Optional[dict] = None):
    await db.fire_audit_logs.insert_one({
        "id": uuid.uuid4().hex, "action": action,
        "founder_username": founder.get("username"),
        "extra": extra or {}, "created_at": _now(),
    })


# ── User endpoints ──────────────────────────────────────────────────────
@router.get("/status")
async def fire_status(current: OptionalUser):
    await fp.ensure_fire_indexes()
    flags = await fp.get_fire_flags()
    out = {
        "enabled": flags.get("fire_reactions", False),
        "boosted_enabled": flags.get("boosted_fire", False),
        "ranked_feed_enabled": flags.get("fire_ranked_feed", False),
        "wallet_enabled": flags.get("fire_wallet_enabled", False),
        "config": None, "pool": None,
    }
    if current and out["enabled"]:
        cfg = await fp.fire_config_for_user(current)
        out["config"] = cfg
        out["pool"] = await fp.pool_status(current, cfg)
    return out


@router.get("/wallet")
async def my_wallet(current: CurrentUser):
    """Private Fire Wallet — own balances only (never another user's).
    Flag-gated for display; earnings accrue regardless of the flag."""
    flags = await fp.get_fire_flags()
    if not flags.get("fire_wallet_enabled"):
        return {"enabled": False}
    from services import fire_vault as fv
    wallet = await fv.wallet_for(current)
    cfg = await fp.fire_config_for_user(current)
    pool = await fp.pool_status(current, cfg)
    wcfg = await fv.get_wallet_config()
    held_fire = 0
    async for h in db.gm_holds.find({"user_id": current["id"], "resource_key": "fire",
                                     "state": "held"}, {"amount": 1}):
        held_fire += int(h.get("amount") or 0)
    return {"enabled": True, "wallet": wallet, "pool": pool, "config": cfg,
            "held_fire": held_fire,
            "settlement_hours": wcfg["settlement_hours"],
            "fire_given": await fv.fire_given_total(current["id"]),
            "fire_received": wallet["lifetime_fire_received"],
            "recent": await fv.recent_earnings(current["id"], 5),
            "fire_up": await fv._fire_up_state(current),
            "features": {
                "pending": flags.get("fire_pending_enabled", False),
                "collectable": flags.get("fire_collectable_enabled", False),
                "collection": flags.get("fire_collection_enabled", False),
                "history": flags.get("fire_wallet_history_enabled", False),
            }}


class CollectBody(BaseModel):
    transaction_ids: Optional[list] = None
    collect_all: bool = False


@router.post("/wallet/collect")
async def wallet_collect(body: CollectBody, current: CurrentUser):
    """COLLECT FIRE — moves finalized Collectable Fire into the Vault."""
    flags = await fp.get_fire_flags()
    if not flags.get("fire_collection_enabled"):
        raise HTTPException(status_code=403, detail="Fire collection is not enabled yet")
    from services import fire_vault as fv
    ids = None if body.collect_all else (body.transaction_ids or None)
    if not body.collect_all and not ids:
        raise HTTPException(status_code=400, detail="Select Fire to collect or use Collect All")
    result = await fv.collect_fire(current, ids)
    wallet = await fv.wallet_for(current)
    return {"ok": True, **result, "wallet": wallet}


@router.get("/wallet/history")
async def wallet_history(current: CurrentUser, filter: str = "all", limit: int = 50):
    flags = await fp.get_fire_flags()
    if not flags.get("fire_wallet_history_enabled"):
        raise HTTPException(status_code=403, detail="Wallet history is not enabled yet")
    from services import fire_vault as fv
    return {"history": await fv.wallet_history(current, filter, limit)}


# ── FIRE UP — Vault → Daily Pool refill (owner-only, 24h cooldown) ──────
@router.get("/fire-up/preview")
async def fire_up_preview(current: CurrentUser):
    """Server-authoritative Fire Up eligibility for the CALLER only."""
    flags = await fp.get_fire_flags()
    if not flags.get("fire_wallet_enabled"):
        return {"enabled": False}
    from services import fire_vault as fv
    return {"enabled": True, **await fv._fire_up_state(current)}


class FireUpBody(BaseModel):
    idempotency_key: Optional[str] = None


@router.post("/fire-up")
async def fire_up_execute(body: FireUpBody, current: CurrentUser):
    """FIRE UP 🔥 — atomic idempotent Vault → Daily Pool transfer. All
    amounts/limits/eligibility are computed server-side; the client only
    supplies an idempotency key."""
    flags = await fp.get_fire_flags()
    if not flags.get("fire_wallet_enabled"):
        raise HTTPException(status_code=403, detail="Fire wallet is not enabled yet")
    from services import fire_vault as fv
    return await fv.fire_up(current, body.idempotency_key)


# ── Fire Wallet Privacy (Phase 1) ───────────────────────────────────────
@router.get("/privacy")
async def my_fire_privacy(current: CurrentUser):
    from services import fire_vault as fv
    doc = await db.users.find_one({"id": current["id"]}, {"_id": 0, "fire_privacy": 1})
    return {"privacy": fv.merge_fire_privacy(doc),
            "defaults": fv.FIRE_PRIVACY_DEFAULTS}


class FirePrivacyBody(BaseModel):
    vault_balance: Optional[str] = None
    lifetime_fire: Optional[str] = None
    fire_given: Optional[str] = None
    fire_received: Optional[str] = None


@router.patch("/privacy")
async def update_fire_privacy(body: FirePrivacyBody, current: CurrentUser):
    from services import fire_vault as fv
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    privacy = await fv.set_fire_privacy(current["id"], updates)
    return {"ok": True, "privacy": privacy}


@router.get("/wallet/stats/{username}")
async def public_wallet_stats(username: str, current: OptionalUser):
    """Privacy-filtered public fire stats. Hidden fields carry NO value
    in the JSON — only {visible:false}. Owner/founder always see all."""
    flags = await fp.get_fire_flags()
    if not flags.get("fire_wallet_enabled"):
        return {"enabled": False}
    from services import fire_vault as fv
    owner = await db.users.find_one(
        {"username": username.lower()},
        {"_id": 0, "id": 1, "username": 1, "friends": 1, "fire_privacy": 1})
    if not owner:
        raise HTTPException(status_code=404, detail="User not found")
    out = await fv.public_fire_stats(owner, current)
    # Public progression facts (level / badge / max reaction) — earned
    # through progression and safe to display on any profile. NO wallet
    # balances, pool state or private values are ever included here.
    cfg = await fp.fire_config_for_user({"id": owner["id"]})
    return {"enabled": True, "username": owner["username"], **out,
            "public_summary": {
                "level_number": cfg.get("level_number"),
                "level_name": cfg.get("level_name"),
                "level_badge_url": cfg.get("level_badge_url"),
                "max_fire_per_reaction": cfg.get("max_fire_per_reaction"),
            }}


class ReactBody(BaseModel):
    post_id: str
    fire_value: int
    idempotency_key: Optional[str] = None


@router.post("/react")
async def fire_react(body: ReactBody, current: CurrentUser):
    return await fp.react(current, body.post_id, body.fire_value, body.idempotency_key)


@router.get("/quick-state/{post_id}")
async def fire_quick_state(post_id: str, current: CurrentUser):
    """Authoritative Quick Fire range — shared engine, never a frontend formula."""
    return await fp.quick_state(current, post_id)


@router.get("/post/{post_id}")
async def fire_post_state(post_id: str, current: OptionalUser):
    return await fp.post_fire_state(post_id, (current or {}).get("id"))


# ── Founder admin ───────────────────────────────────────────────────────
@router.get("/admin/overview")
async def admin_overview(current: CurrentUser):
    require_founder(current)
    await fp.ensure_fire_indexes()
    flags = await fp.get_fire_flags()
    levels = []
    async for lvl in db.progression_levels.find(
            {"status": {"$in": ["published", "draft", "paused"]}},
            {"_id": 0, "id": 1, "name": 1, "level_number": 1, "status": 1, "fire_settings": 1},
    ).sort("level_number", 1):
        levels.append({**lvl, "fire_defaults": fp.DEFAULT_LEVEL_FIRE.get(lvl.get("level_number"))})
    stats = {
        "fire_reactions_total": await db.post_fire_reactions.count_documents({"active": True}),
        "fire_reactions_migrated": await db.post_fire_reactions.count_documents({"source": "migration"}),
        "active_boost_transactions": await db.fire_power_transactions.count_documents({"status": "active"}),
        "legacy_public_likes_posts": await db.posts.count_documents(fp._PUBLIC_LIKED_QUERY),
    }
    logs = [l async for l in db.fire_migration_log.find({}, {"_id": 0}).sort("executed_at", -1).limit(10)]
    return {"flags": flags, "levels": levels, "stats": stats, "migration_log": logs}


class FlagBody(BaseModel):
    key: str
    value: bool


@router.patch("/admin/flags")
async def admin_set_flag(body: FlagBody, current: CurrentUser):
    require_founder(current)
    flags = await fp.set_fire_flag(body.key, body.value, current.get("username") or current["id"])
    await _audit(current, "fire_flag_set", {"key": body.key, "value": body.value})
    return {"ok": True, "flags": flags}


class LevelFireBody(BaseModel):
    max_fire_per_reaction: int
    daily_fire_pool: int
    fire_enabled: bool = True


@router.patch("/admin/levels/{level_id}")
async def admin_level_fire(level_id: str, body: LevelFireBody, current: CurrentUser):
    require_founder(current)
    level = await db.progression_levels.find_one({"id": level_id}, {"_id": 0, "id": 1, "name": 1})
    if not level:
        raise HTTPException(status_code=404, detail="Level not found")
    fs = fp.clean_fire_settings(body.model_dump())
    await db.progression_levels.update_one({"id": level_id}, {"$set": {"fire_settings": fs}})
    await _audit(current, "fire_level_config", {"level_id": level_id, "fire_settings": fs})
    return {"ok": True, "level_id": level_id, "fire_settings": fs}


@router.post("/admin/seed-defaults")
async def admin_seed_defaults(current: CurrentUser):
    require_founder(current)
    updated = await fp.seed_default_fire_settings()
    await _audit(current, "fire_seed_defaults", {"updated": len(updated)})
    return {"ok": True, "updated": updated}


# ── Migration workflow (dry-run → execute → reconcile, with rollback) ───
class MigrationBody(BaseModel):
    confirmation_phrase: Optional[str] = None
    fix: bool = False


@router.post("/admin/migration/dry-run")
async def admin_migration_dry_run(current: CurrentUser):
    require_founder(current)
    report = await fp.migration_dry_run()
    await _audit(current, "fire_migration_dry_run", {"report": report})
    return report


@router.post("/admin/migration/execute")
async def admin_migration_execute(body: MigrationBody, current: CurrentUser):
    require_founder(current)
    if body.confirmation_phrase != fp.MIGRATION_PHRASE:
        raise HTTPException(
            status_code=400,
            detail=f'Type the exact confirmation phrase "{fp.MIGRATION_PHRASE}" to execute')
    report = await fp.migration_execute(current)
    await _audit(current, "fire_migration_execute", {"report": report})
    return report


@router.post("/admin/migration/rollback")
async def admin_migration_rollback(body: MigrationBody, current: CurrentUser):
    require_founder(current)
    if body.confirmation_phrase != fp.ROLLBACK_PHRASE:
        raise HTTPException(
            status_code=400,
            detail=f'Type the exact confirmation phrase "{fp.ROLLBACK_PHRASE}" to roll back')
    report = await fp.migration_rollback(current)
    await _audit(current, "fire_migration_rollback", {"report": report})
    return report


@router.post("/admin/migration/reconcile")
async def admin_migration_reconcile(body: MigrationBody, current: CurrentUser):
    require_founder(current)
    report = await fp.migration_reconcile(fix=body.fix)
    await _audit(current, "fire_migration_reconcile", {"fix": body.fix, "mismatches": report["counter_mismatches"]})
    return report


# ── Fire Vault / Wallets admin (Phase 0.5, founder only) ────────────────
@router.get("/admin/wallets/overview")
async def admin_wallets_overview(current: CurrentUser):
    require_founder(current)
    from services import fire_vault as fv
    return await fv.admin_wallets_overview()


class WalletConfigBody(BaseModel):
    settlement_hours: int


@router.patch("/admin/wallets/config")
async def admin_wallets_config(body: WalletConfigBody, current: CurrentUser):
    require_founder(current)
    from services import fire_vault as fv
    cfg = await fv.set_wallet_config(body.settlement_hours, current.get("username") or current["id"])
    await _audit(current, "fire_wallet_config", {"settlement_hours": cfg["settlement_hours"]})
    return {"ok": True, "config": cfg}


class WalletRecalcBody(BaseModel):
    username: Optional[str] = None


@router.post("/admin/wallets/recalculate")
async def admin_wallets_recalculate(body: WalletRecalcBody, current: CurrentUser):
    require_founder(current)
    from services import fire_vault as fv
    if body.username:
        u = await db.users.find_one({"username": body.username.lower()}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        await fv.settle_due(u["id"])
        report = await fv.recalculate_wallet(u["id"])
    else:
        report = await fv.recalculate_all()
    await _audit(current, "fire_wallet_recalculate", {"username": body.username, "report": report if body.username else {k: report[k] for k in ("wallets_checked", "wallets_changed")}})
    return report


@router.post("/admin/wallets/settle-now")
async def admin_wallets_settle_now(current: CurrentUser):
    require_founder(current)
    from services import fire_vault as fv
    settled = await fv.settle_due()
    await _audit(current, "fire_wallet_settle_now", {"settled": settled})
    return {"ok": True, "settled": settled}


@router.get("/admin/wallets/transactions")
async def admin_wallets_transactions(current: CurrentUser,
                                     username: Optional[str] = None,
                                     status: Optional[str] = None,
                                     limit: int = 50):
    require_founder(current)
    from services import fire_vault as fv
    return {"transactions": await fv.admin_transactions(username, status, limit)}


@router.post("/admin/privacy/seed-defaults")
async def admin_privacy_seed_defaults(current: CurrentUser):
    require_founder(current)
    from services import fire_vault as fv
    seeded = await fv.seed_fire_privacy_defaults()
    await _audit(current, "fire_privacy_seed_defaults", {"seeded": seeded})
    return {"ok": True, "users_seeded": seeded}


# ── Phase 0.6 admin command center (founder only) ───────────────────────
class ReasonBody(BaseModel):
    reason: str


@router.get("/admin/dashboard")
async def admin_dashboard(current: CurrentUser):
    require_founder(current)
    from services import fire_vault as fv
    return await fv.admin_dashboard()


@router.get("/admin/inspect/user/{username}")
async def admin_inspect_user(username: str, current: CurrentUser):
    require_founder(current)
    from services import fire_vault as fv
    return await fv.user_inspector(username)


@router.get("/admin/inspect/post/{post_id}")
async def admin_inspect_post(post_id: str, current: CurrentUser):
    require_founder(current)
    from services import fire_vault as fv
    return await fv.post_inspector(post_id)


@router.post("/admin/users/{username}/pause-fire")
async def admin_pause_fire(username: str, body: ReasonBody, current: CurrentUser):
    require_founder(current)
    r = await db.users.update_one({"username": username.lower()}, {"$set": {"fire_paused": True}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="User not found")
    await _audit(current, "fire_pause_user", {"username": username, "reason": body.reason})
    return {"ok": True, "fire_paused": True}


@router.post("/admin/users/{username}/restore-fire")
async def admin_restore_fire(username: str, body: ReasonBody, current: CurrentUser):
    require_founder(current)
    r = await db.users.update_one({"username": username.lower()}, {"$set": {"fire_paused": False}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="User not found")
    await _audit(current, "fire_restore_user", {"username": username, "reason": body.reason})
    return {"ok": True, "fire_paused": False}


@router.post("/admin/users/{username}/finalize-pending")
async def admin_finalize_pending(username: str, body: ReasonBody, current: CurrentUser):
    require_founder(current)
    u = await db.users.find_one({"username": username.lower()}, {"_id": 0, "id": 1})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    from services import fire_vault as fv
    # Force-finalize: pull the user's pending settle_after into the past, then run finalization
    await db.fire_wallet_transactions.update_many(
        {"user_id": u["id"], "status": "pending"},
        {"$set": {"settle_after": _now(), "force_finalized_by": current.get("username")}})
    n = await fv.settle_due(u["id"])
    await _audit(current, "fire_force_finalize", {"username": username, "reason": body.reason, "finalized": n})
    return {"ok": True, "finalized": n}


@router.post("/admin/users/{username}/collect")
async def admin_collect_on_behalf(username: str, body: ReasonBody, current: CurrentUser):
    require_founder(current)
    u = await db.users.find_one({"username": username.lower()}, {"_id": 0, "id": 1})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    from services import fire_vault as fv
    result = await fv.collect_fire(u, None)
    await _audit(current, "fire_collect_on_behalf", {"username": username, "reason": body.reason, **result})
    return {"ok": True, **result}


@router.post("/admin/reactions/{reaction_id}/reverse")
async def admin_reverse_reaction(reaction_id: str, body: ReasonBody, current: CurrentUser):
    require_founder(current)
    if not (body.reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required")
    from services import fire_vault as fv
    report = await fv.reverse_reaction(current, reaction_id, body.reason.strip())
    await _audit(current, "fire_reverse_reaction", {"report": report})
    return {"ok": True, **report}


@router.post("/keys/collect")
async def collect_key(current: CurrentUser, body: dict):
    """Golden Keys — permanent Fire Vault Key Wallet (idempotent per key_id)."""
    key_id = str(body.get("key_id") or "").strip()[:120]
    if not key_id:
        raise HTTPException(status_code=400, detail="key_id required")
    gid = str(body.get("game_id") or "")[:64]
    if gid:
        g = await db.games.find_one({"id": gid}, {"_id": 0, "id": 1, "access": 1, "release": 1})
        if g:
            from services.game_access_ctl import evaluate
            acc = await evaluate(g, current)
            if not acc["allowed"]:
                raise HTTPException(status_code=403, detail={"reason": acc["reason"], "message": acc["message"]})
            if not acc["flags"]["keys"]:
                reason = {"preview": "preview_rewards_disabled",
                          "public_preview": "public_preview_rewards_disabled",
                          "view_only": "view_only"}.get(acc["mode"], "keys_disabled")
                raise HTTPException(status_code=403, detail={
                    "reason": reason, "message": acc["message"] or "Key rewards are disabled for this game"})
    from datetime import datetime, timezone
    r = await db.fire_keys.update_one(
        {"user_id": current["id"], "key_id": key_id},
        {"$setOnInsert": {"user_id": current["id"], "key_id": key_id,
                          "game_id": str(body.get("game_id") or "")[:64],
                          "stage": int(body.get("stage") or 0),
                          "collected_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)
    total = await db.fire_keys.count_documents({"user_id": current["id"]})
    return {"ok": True, "new": bool(r.upserted_id), "total_keys": total}


@router.get("/keys")
async def key_wallet(current: CurrentUser):
    rows = await db.fire_keys.find({"user_id": current["id"]}, {"_id": 0}).sort("collected_at", -1).to_list(200)
    return {"keys": rows, "total": len(rows),
            "future_uses": ["Portals", "Games", "Realms", "Nexus", "AR", "VR", "XR"]}
