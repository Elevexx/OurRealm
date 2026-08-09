"""Versioned, idempotent, reversible 13+ age-rating migration.

Usage:  python scripts/migrate_age_13.py            (dry run — default)
        python scripts/migrate_age_13.py --apply
        python scripts/migrate_age_13.py --rollback
Only touches games.age_rating — never school-grade / Responsibility Center
education fields. Insert-only migration record with prior values kept for
rollback. Production-safe: narrow $set patches, no deletes.
"""
import asyncio
import sys

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

MIG = "age_rating_13plus_v1"


def _below_13(v) -> bool:
    if v is None or v == "":
        return True
    try:
        return int(str(v).rstrip("+").strip()) < 13
    except ValueError:
        return True  # unparseable → normalize to 13+


async def main():
    from datetime import datetime, timezone
    from core.db import db
    mode = "apply" if "--apply" in sys.argv else "rollback" if "--rollback" in sys.argv else "dry"
    rec = await db.migrations.find_one({"name": MIG})

    if mode == "rollback":
        if not rec or rec.get("status") != "applied":
            print("Nothing to roll back."); return
        n = 0
        for ch in rec["changes"]:
            await db.games.update_one({"id": ch["game_id"]},
                                      {"$set": {"age_rating": ch["prior"]}} if ch["prior"] is not None
                                      else {"$unset": {"age_rating": ""}})
            n += 1
        await db.migrations.update_one({"name": MIG}, {"$set": {"status": "rolled_back"}})
        print(f"Rolled back {n} games."); return

    targets = []
    async for g in db.games.find({}, {"_id": 0, "id": 1, "title": 1, "status": 1, "age_rating": 1}):
        if g.get("age_rating") == "13+":
            continue
        if _below_13(g.get("age_rating")):
            targets.append(g)
    print(f"[{mode}] games needing 13+ normalization: {len(targets)}")
    for g in targets[:8]:
        print(f"  · {g.get('title')!r} ({g.get('status')}) age_rating={g.get('age_rating')!r} → '13+'")
    if mode == "dry":
        return
    if rec and rec.get("status") == "applied":
        print("Migration already applied — idempotent no-op."); return
    changes = [{"game_id": g["id"], "prior": g.get("age_rating")} for g in targets]
    for g in targets:
        await db.games.update_one({"id": g["id"]}, {"$set": {"age_rating": "13+"}})
    await db.migrations.update_one(
        {"name": MIG},
        {"$set": {"name": MIG, "status": "applied", "changed": len(changes), "changes": changes,
                  "applied_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    print(f"Applied — {len(changes)} games set to 13+ (reversible via --rollback).")

if __name__ == "__main__":
    asyncio.run(main())
