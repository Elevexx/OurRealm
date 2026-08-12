import json
from datetime import datetime, timezone
from pathlib import Path

from core.db import db

STAMP = "nexus-v12-d40-20260812"
FIXTURE = Path("/app/backend/fixtures/nexus_v12_d40.json")


async def sync_nexus_fixture():
    marker = await db.nexus_fixture_migrations.find_one(
        {"id": STAMP},
        {"_id": 0},
    )

    if marker:
        return {
            "status": "already_imported",
            "stamp": STAMP,
        }

    payload = json.loads(FIXTURE.read_text())
    world = payload["world"]
    world_id = world.get("world_id")

    if not world_id:
        raise RuntimeError("Fixture world_id is missing")

    current_world = await db.nexus_worlds.find_one(
        {"world_id": world_id},
        {"_id": 0},
    )

    current_avatars = await db.nexus_avatars.find(
        {},
        {"_id": 0},
    ).to_list(100)

    now = datetime.now(timezone.utc).isoformat()
    backup_id = "pre-" + STAMP

    await db.nexus_sync_backups.update_one(
        {"id": backup_id},
        {
            "$setOnInsert": {
                "id": backup_id,
                "world": current_world,
                "avatars": current_avatars,
                "created_at": now,
                "reason": "Backup before Nexus production fixture sync",
            }
        },
        upsert=True,
    )

    await db.nexus_worlds.replace_one(
        {"world_id": world_id},
        world,
        upsert=True,
    )

    await db.nexus_avatars.update_many(
        {"is_default": True},
        {"$set": {"is_default": False}},
    )

    for avatar in payload.get("avatars", []):
        await db.nexus_avatars.replace_one(
            {"id": avatar["id"]},
            avatar,
            upsert=True,
        )

    for asset in payload.get("assets", []):
        await db.asset_library.replace_one(
            {"id": asset["id"]},
            asset,
            upsert=True,
        )

    for index, version in enumerate(payload.get("versions", [])):
        if version.get("id") is not None:
            selector = {"id": version["id"]}
        elif version.get("version") is not None:
            selector = {"version": version["version"]}
        else:
            version["fixture_stamp"] = STAMP
            version["fixture_index"] = index
            selector = {
                "fixture_stamp": STAMP,
                "fixture_index": index,
            }

        await db.nexus_versions.replace_one(
            selector,
            version,
            upsert=True,
        )

    result = {
        "status": "imported",
        "stamp": STAMP,
        "backup_id": backup_id,
        "draft_version": world.get("draft_version"),
        "published_version": world.get("published_version"),
        "avatars": len(payload.get("avatars", [])),
        "assets": len(payload.get("assets", [])),
        "versions": len(payload.get("versions", [])),
        "imported_at": now,
    }

    await db.nexus_fixture_migrations.update_one(
        {"id": STAMP},
        {"$set": {"id": STAMP, **result}},
        upsert=True,
    )

    return result
