"""FIG.03 migration (idempotent, production-safe): Starter Ninja becomes the only free starter +
default. Legacy starters archived (masters preserved). Users on legacy/no avatar -> av_ninja.
Premium-equipped users untouched. Safe to re-run."""
import asyncio, sys
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv; load_dotenv("/app/backend/.env")

async def main():
    from core.db import db
    ninja = await db.nexus_avatars.find_one({"id": "av_ninja", "status": "active"}, {"_id": 0, "id": 1})
    if not ninja:
        print("[mig] av_ninja not active yet — aborting (no changes)"); return
    await db.nexus_avatars.update_many({"id": {"$in": ["starter_m", "starter_f"]}},
                                       {"$set": {"status": "archived", "is_default": False}})
    await db.nexus_avatars.update_many({"id": {"$ne": "av_ninja"}}, {"$set": {"is_default": False}})
    await db.nexus_avatars.update_one({"id": "av_ninja"}, {"$set": {"is_default": True}})
    r1 = await db.users.update_many({"nexus_avatar_id": {"$in": ["starter_m", "starter_f"]}},
                                    {"$set": {"nexus_avatar_id": "av_ninja"}})
    r2 = await db.users.update_many({"nexus_avatar_id": {"$in": [None, ""]}},
                                    {"$set": {"nexus_avatar_id": "av_ninja"}})
    print(f"[mig] legacy starters archived; av_ninja default; migrated legacy={r1.modified_count} empty={r2.modified_count}")

if __name__ == "__main__":
    asyncio.run(main())
