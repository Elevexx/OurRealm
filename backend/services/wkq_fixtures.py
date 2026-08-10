"""Idempotent WKQ flagship fixture importer.

Production and preview use separate Mongo databases while sharing R2 media.
The flagship game documents (specs, wired assets, fire economies) and the
Emerald Realm Key registry are authored in preview; this importer ships them
inside the repo (fixtures/wkq_flagships.json) and upserts them at startup so
any deployment converges to the verified state. Version-stamped: reruns are
no-ops until the fixture_version changes. Never touches user_realm_keys or
any player-owned data."""
import json
import logging
import os

from core.db import db

log = logging.getLogger("ourrealm.wkq_fixtures")
FIXTURE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fixtures", "wkq_flagships.json")


async def run():
    if not os.path.exists(FIXTURE):
        return
    fix = json.load(open(FIXTURE))
    ver = fix.get("fixture_version")
    meta = await db.meta.find_one({"key": "wkq_fixture_version"}) or {}
    if meta.get("value") == ver:
        return
    for g in fix.get("games", []):
        if g and g.get("id"):
            await db.games.update_one({"id": g["id"]}, {"$set": g}, upsert=True)
    await db.user_realm_keys.create_index([("user_id", 1), ("key_id", 1)], unique=True)
    await db.realm_keys.create_index("key_id", unique=True)
    for r in fix.get("realm_keys", []):
        if r and r.get("key_id"):
            await db.realm_keys.update_one({"key_id": r["key_id"]}, {"$set": r}, upsert=True)
    await db.meta.update_one({"key": "wkq_fixture_version"},
                             {"$set": {"key": "wkq_fixture_version", "value": ver}}, upsert=True)
    log.info("[wkq-fixtures] imported %s (%d games, %d registry keys)",
             ver, len(fix.get("games", [])), len(fix.get("realm_keys", [])))
