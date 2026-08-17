"""Progression indexes + uniqueness constraints (idempotent, startup-safe)."""
from core.db import db


async def ensure_progression_indexes() -> None:
    await db.progression_levels.create_index("id", unique=True)
    await db.progression_levels.create_index([("status", 1), ("display_order", 1)])
    await db.progression_level_versions.create_index(
        [("level_id", 1), ("version", 1)], unique=True)
    await db.progression_tasks.create_index("id", unique=True)
    await db.progression_tasks.create_index([("level_id", 1), ("sort_order", 1)])
    await db.user_level_progress.create_index("user_id", unique=True)
    await db.user_level_progress.create_index([("current_level_id", 1), ("claim_available", 1)])
    await db.user_task_progress.create_index(
        [("user_id", 1), ("level_id", 1), ("task_id", 1), ("level_version", 1)], unique=True)
    await db.user_task_progress.create_index([("level_id", 1), ("task_id", 1), ("completed", 1)])
    await db.user_level_history.create_index([("user_id", 1), ("completed_at", -1)])
    await db.user_level_history.create_index([("level_id", 1)])
    # One successful claim per user + level + published configuration version.
    await db.progression_claims.create_index(
        [("user_id", 1), ("level_id", 1), ("level_version", 1)],
        unique=True, partialFilterExpression={"status": "success"})
    await db.progression_events.create_index("event_id", unique=True)
    await db.progression_events.create_index([("user_id", 1), ("event_key", 1), ("status", 1)])
    await db.user_reward_grants.create_index("idempotency_key", unique=True)
    await db.user_reward_grants.create_index([("user_id", 1), ("status", 1)])
    await db.user_reward_grants.create_index([("repair_status", 1)])
    await db.reputation_transactions.create_index("idempotency_key", unique=True)
    await db.reputation_transactions.create_index([("user_id", 1), ("created_at", -1)])
    await db.progression_recalculation_jobs.create_index([("status", 1)])
    await db.progression_manual_approvals.create_index(
        [("user_id", 1), ("task_id", 1)], unique=True)
    await db.progression_audit_logs.create_index([("created_at", -1)])
    await db.progression_audit_logs.create_index([("target_type", 1), ("target_id", 1)])
