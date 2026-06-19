"""Regression coverage for the 30-day permanent-delete cron.

Runs the whole lifecycle inside a single asyncio.run() so motor's
module-level client lives in exactly one event loop. Avoids the
cross-loop quirks we hit with per-test pytest-asyncio fixtures on
this codebase.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")

from core.account_lifecycle import (                              # noqa: E402
    STATUS_DELETED_PENDING, STATUS_PURGED,
    is_purge_due, mark_restore, purge_user, run_purge_pass,
)


def _past_iso() -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()


def _future_iso() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()


def _seed(purge_after_iso: str | None) -> dict:
    uid = uuid.uuid4().hex
    return {
        "id":              uid,
        "username":        f"pcron_{uid[:6]}",
        "email":           f"pcron_{uid[:6]}@test.com",
        "name":            "Cron Test",
        "bio":             "to be anonymised",
        "avatar_url":      "/api/images/x.jpg",
        "banner_url":      "/api/images/b.jpg",
        "password_hash":   "fake$hash",
        "social":          {"twitter": "x"},
        "disabled":        True,
        "account_status":  STATUS_DELETED_PENDING,
        "deleted_at":      datetime.now(timezone.utc).isoformat(),
        **({"purge_after": purge_after_iso} if purge_after_iso else {}),
    }


async def _scenarios():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    inserted_ids: list[str] = []
    try:
        # 1. Restore window blocks purge.
        doc = _seed(purge_after_iso=_future_iso())
        await db.users.insert_one(doc); inserted_ids.append(doc["id"])
        assert not is_purge_due(doc)
        res = await purge_user(doc)
        assert res.get("account_status") == STATUS_DELETED_PENDING, "fresh soft-delete must not be purged"

        # 2. Purge anonymises PII and keeps id, audit log written.
        doc = _seed(purge_after_iso=_past_iso())
        original_un = doc["username"]
        await db.users.insert_one(doc); inserted_ids.append(doc["id"])
        after = await purge_user(doc)
        assert after["id"] == doc["id"], "id must be preserved"
        assert after["account_status"] == STATUS_PURGED
        assert after["permanently_deleted"] is True
        assert after["username"].startswith("deleted_")
        assert after["email"].endswith("@deleted.invalid")
        for field in ("name", "bio", "avatar_url", "banner_url"):
            assert after[field] is None, f"{field} should be null after purge"
        assert after["password_hash"] == ""
        assert "purge_after" not in after
        audit = await db.audit_log.find_one(
            {"action": "account.permanent_delete", "target_id": doc["id"]},
            {"_id": 0},
        )
        assert audit is not None, "audit log entry must exist"
        assert audit["target_user"] == original_un
        assert audit["actor_user"] == "purge-cron"

        # 3. run_purge_pass is idempotent.
        # The row we just purged should NOT be re-purged.
        await run_purge_pass()           # must not raise
        after2 = await db.users.find_one({"id": doc["id"]}, {"_id": 0, "account_status": 1})
        assert after2["account_status"] == STATUS_PURGED

        # 4. Restored user is excluded from purge.
        doc = _seed(purge_after_iso=_past_iso())
        await db.users.insert_one(doc); inserted_ids.append(doc["id"])
        await mark_restore(doc)
        await run_purge_pass()
        after = await db.users.find_one({"id": doc["id"]}, {"_id": 0})
        assert after["account_status"] != STATUS_PURGED, "restored user must not be purged"
        assert after.get("disabled") is False

        # 5. Original username is free for reuse after purge.
        doc = _seed(purge_after_iso=_past_iso())
        original_un = doc["username"]
        await db.users.insert_one(doc); inserted_ids.append(doc["id"])
        await purge_user(doc)
        clash = await db.users.find_one({"username": original_un}, {"_id": 0})
        assert clash is None, "original username must be free for reuse after purge"
    finally:
        await db.users.delete_many({"id": {"$in": inserted_ids}})
        await db.audit_log.delete_many({"target_id": {"$in": inserted_ids}})
        client.close()


def test_purge_cron_full_lifecycle():
    """Single pytest entrypoint that exercises the complete lifecycle."""
    asyncio.run(_scenarios())


if __name__ == "__main__":
    asyncio.run(_scenarios())
    print("All purge_cron scenarios passed.")
