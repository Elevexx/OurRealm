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
        "config": None, "pool": None,
    }
    if current and out["enabled"]:
        cfg = await fp.fire_config_for_user(current)
        out["config"] = cfg
        out["pool"] = await fp.pool_status(current, cfg)
    return out


class ReactBody(BaseModel):
    post_id: str
    fire_value: int
    idempotency_key: Optional[str] = None


@router.post("/react")
async def fire_react(body: ReactBody, current: CurrentUser):
    return await fp.react(current, body.post_id, body.fire_value, body.idempotency_key)


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
