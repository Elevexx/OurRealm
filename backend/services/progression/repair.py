"""Progression audit & global repair — restart-safe, idempotent.

Run any time (startup, admin action, redeploy). It:
  1. Audits every task DEFINITION (collection + frozen published snapshots):
     Like tasks → Fire Power equivalents, Inner Realm detection repointed
     to users.inner_8, "(copy)" / identical duplicates merged into one
     canonical task (user progress moved, copies archived), placeholder
     tasks on archived levels archived.
  2. Recalculates EVERY eligible user from full production history
     (calculators read trusted records with count_historical=True), so
     historical activity is credited without redoing anything. Completions,
     XP and rewards flow through the existing engine/claim path which is
     idempotent (one claim per user/level/version — never duplicated).
  3. Writes a validation report to db.progression_repair_reports.

A version marker makes deployment runs automatic exactly once per
REPAIR_VERSION bump; manual runs are always safe.
"""
import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone

from core.db import db
from services.progression.eligibility import progression_eligible_user_filter
from services.progression.engine import ensure_user_progress, recalc_user

log = logging.getLogger("ourrealm.progression.repair")

REPAIR_VERSION = 1
_LIKES_RE = re.compile(r"^Receive\s+([\d,]+)\s+valid likes?$", re.IGNORECASE)

# task_type_key conversions applied to definitions AND frozen snapshots
_CONVERSIONS = {
    "likes_received": "fire_received",
    "top8_add": "inner_realm_complete",
    "inner8_add": "inner_realm_complete",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _convert_task_fields(t: dict) -> dict | None:
    """Return {fields to $set} if the task definition needs conversion."""
    key = t.get("task_type_key")
    new_key = _CONVERSIONS.get(key)
    if not new_key:
        return None
    patch = {"task_type_key": new_key, "updated_at": _now()}
    name = (t.get("name") or "").strip()
    if key == "likes_received":
        m = _LIKES_RE.match(name)
        amount = m.group(1) if m else f"{int(t.get('target_value') or 1):,}"
        patch["name"] = f"Receive {amount} Fire Power"
        patch["button_label"] = t.get("button_label") or "View Feed"
    else:  # inner realm
        patch["name"] = "Complete your Inner Realm"
        patch["button_label"] = "Edit Inner Realm"
    return patch


async def _audit_definitions(report: dict) -> None:
    """Phase 1 — repair task definitions + published snapshots."""
    # 1a. Convert Like / Inner Realm tasks in the tasks collection.
    async for t in db.progression_tasks.find({"task_type_key": {"$in": list(_CONVERSIONS)}}, {"_id": 0}):
        patch = _convert_task_fields(t)
        if not patch:
            continue
        await db.progression_tasks.update_one({"id": t["id"]}, {"$set": patch})
        report["tasks_converted_to_fire" if t["task_type_key"] == "likes_received"
               else "inner_realm_tasks_repointed"] += 1
        if patch.get("name") != t.get("name"):
            report["tasks_renamed"] += 1

    # 1b. Archive placeholder tasks living on archived levels.
    archived_level_ids = await db.progression_levels.distinct("id", {"status": "archived"})
    if archived_level_ids:
        r = await db.progression_tasks.update_many(
            {"level_id": {"$in": archived_level_ids}, "status": "active"},
            {"$set": {"status": "archived", "updated_at": _now()}})
        report["placeholder_tasks_archived"] += r.modified_count

    # 1c. Merge duplicates — same level + type + target + config, or an
    # explicit "(copy)" clone. Keep the oldest; move user progress; archive copies.
    seen: dict[tuple, dict] = {}
    async for t in db.progression_tasks.find({"status": "active"}, {"_id": 0}).sort("created_at", 1):
        base_name = re.sub(r"\s*\(copy\)\s*$", "", t.get("name") or "", flags=re.IGNORECASE).strip()
        sig = (t.get("level_id"), t.get("task_type_key"), int(t.get("target_value") or 1),
               str(t.get("config") or {}), base_name.lower())
        canon = seen.get(sig)
        if not canon:
            seen[sig] = t
            # A "(copy)"-suffixed canonical gets its clean name back.
            if base_name and base_name != (t.get("name") or "").strip():
                await db.progression_tasks.update_one(
                    {"id": t["id"]}, {"$set": {"name": base_name, "updated_at": _now()}})
                report["tasks_renamed"] += 1
            continue
        # Duplicate — move progress rows onto the canonical task.
        async for row in db.user_task_progress.find({"task_id": t["id"]}, {"_id": 0}):
            exists = await db.user_task_progress.find_one(
                {"user_id": row["user_id"], "level_id": row["level_id"],
                 "task_id": canon["id"], "level_version": row.get("level_version")},
                {"_id": 0, "id": 1})
            if exists:
                await db.user_task_progress.delete_one({"id": row["id"]})
            else:
                await db.user_task_progress.update_one(
                    {"id": row["id"]}, {"$set": {"task_id": canon["id"]}})
        await db.progression_tasks.update_one(
            {"id": t["id"]},
            {"$set": {"status": "archived", "merged_into": canon["id"], "updated_at": _now()}})
        report["duplicate_tasks_merged"] += 1

    # 1d. Repair FROZEN published snapshots in place (task ids preserved,
    # so existing user_task_progress rows stay valid — no version bump).
    dup_ids = await db.progression_tasks.distinct("id", {"merged_into": {"$exists": True}})
    async for v in db.progression_level_versions.find({}, {"_id": 0, "id": 1, "snapshot": 1}):
        snap = v.get("snapshot") or {}
        tasks = snap.get("tasks") or []
        changed = False
        out = []
        for t in tasks:
            if t.get("id") in dup_ids:
                changed = True
                report["snapshot_duplicates_removed"] += 1
                continue
            patch = _convert_task_fields(t)
            if patch:
                t = {**t, **{k: p for k, p in patch.items() if k != "updated_at"}}
                changed = True
                report["snapshot_tasks_converted"] += 1
            out.append(t)
        if changed:
            await db.progression_level_versions.update_one(
                {"id": v["id"]}, {"$set": {"snapshot.tasks": out, "repaired_at": _now()}})


async def _recalc_all_users(report: dict) -> None:
    """Phase 2 — batched full recalculation from production history."""
    cursor = None
    while True:
        q = progression_eligible_user_filter()
        if cursor:
            q["id"] = {"$gt": cursor}
        batch = [u async for u in db.users.find(q, {"_id": 0, "password": 0, "password_hash": 0})
                 .sort("id", 1).limit(100)]
        if not batch:
            return
        for user in batch:
            report["users_scanned"] += 1
            try:
                await ensure_user_progress(user)
                r = await recalc_user(user, persist=True, source="repair")
                if r.get("changed"):
                    report["users_repaired"] += 1
                if (r.get("summary") or {}).get("claim_available"):
                    report["claims_now_available"] += 1
                for t in r.get("tasks") or []:
                    if not t.get("completed"):
                        continue
                    key = t.get("task_type_key")
                    if key == "inner_realm_complete":
                        report["inner_realm_completions"] += 1
                    elif key == "join_realm":
                        report["realm_membership_completions"] += 1
                    elif key in ("fire_received", "fire_sent", "fire_unique_supporters",
                                 "fire_unique_creators"):
                        report["fire_task_completions"] += 1
            except Exception as e:  # noqa: BLE001
                report["users_failed"] += 1
                if len(report["errors"]) < 25:
                    report["errors"].append({"user": user.get("username"), "error": str(e)[:200]})
        cursor = batch[-1]["id"]
        await asyncio.sleep(0.05)  # never starve live traffic


async def run_progress_repair(actor: str = "system") -> dict:
    """Idempotent full audit + backfill. Safe to run repeatedly."""
    report = {
        "id": uuid.uuid4().hex, "status": "running", "repair_version": REPAIR_VERSION,
        "started_by": actor, "started_at": _now(), "finished_at": None,
        "tasks_audited": 0, "tasks_converted_to_fire": 0,
        "inner_realm_tasks_repointed": 0, "tasks_renamed": 0,
        "duplicate_tasks_merged": 0, "placeholder_tasks_archived": 0,
        "snapshot_tasks_converted": 0, "snapshot_duplicates_removed": 0,
        "users_scanned": 0, "users_repaired": 0, "users_failed": 0,
        "inner_realm_completions": 0, "realm_membership_completions": 0,
        "fire_task_completions": 0, "claims_now_available": 0,
        "errors": [],
    }
    await db.progression_repair_reports.insert_one({**report})
    try:
        report["tasks_audited"] = await db.progression_tasks.count_documents({})
        await _audit_definitions(report)
        await _recalc_all_users(report)
        report["status"] = "completed" if not report["errors"] else "completed_with_errors"
    except Exception as e:  # noqa: BLE001
        log.exception("progress repair crashed")
        report["status"] = "failed"
        report["errors"].append({"fatal": str(e)[:300]})
    report["finished_at"] = _now()
    await db.progression_repair_reports.update_one(
        {"id": report["id"]}, {"$set": {k: v for k, v in report.items() if k != "id"}})
    log.info(f"[progression-repair] {report['status']}: "
             f"{ {k: v for k, v in report.items() if k not in ('errors', 'id')} }")
    return report


async def run_startup_repair() -> None:
    """Deployment hook — runs the full repair once per REPAIR_VERSION.
    Restart-safe: the marker is only advanced after a clean run."""
    flag = await db.progression_flags.find_one({"key": "progress_repair_version"}, {"_id": 0})
    if flag and int(flag.get("version") or 0) >= REPAIR_VERSION:
        return
    report = await run_progress_repair(actor="system_startup")
    if report["status"].startswith("completed"):
        await db.progression_flags.update_one(
            {"key": "progress_repair_version"},
            {"$set": {"version": REPAIR_VERSION, "updated_at": _now()}}, upsert=True)


async def backfill_new_task(level_id: str, actor: str) -> None:
    """Future-proofing — called after a level publish so brand-new tasks
    are immediately credited from historical data for everyone currently
    on that level (and anyone joining later recalcs on read)."""
    user_ids = await db.user_level_progress.distinct("user_id", {"current_level_id": level_id})
    if not user_ids:
        return
    done = 0
    for i in range(0, len(user_ids), 100):
        chunk = user_ids[i:i + 100]
        async for user in db.users.find({"id": {"$in": chunk}},
                                        {"_id": 0, "password": 0, "password_hash": 0}):
            try:
                await recalc_user(user, persist=True, source="publish_backfill")
                done += 1
            except Exception as e:  # noqa: BLE001
                log.warning(f"[publish-backfill] {user.get('username')}: {e}")
        await asyncio.sleep(0.05)
    log.info(f"[publish-backfill] level {level_id}: recalculated {done} users (by {actor})")
