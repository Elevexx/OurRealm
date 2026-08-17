"""Generic versioned registry engine — one engine, many registries.
Entries live in `platform_registries`: code-seeded defaults merged with
DB overrides/additions, versioned with history and rollback. Adding an
entry never requires core-code changes."""
import logging
import time
import uuid
from datetime import datetime, timezone

from core.db import db

log = logging.getLogger("ourrealm.game_platform.registry")

_CACHE: dict = {}
CACHE_TTL = 15


def _iso():
    return datetime.now(timezone.utc).isoformat()


class Registry:
    def __init__(self, name: str, seed: dict, *, description: str = ""):
        self.name = name
        self.seed = seed or {}
        self.description = description

    async def all(self) -> dict:
        hit = _CACHE.get(self.name)
        if hit and time.monotonic() - hit[0] < CACHE_TTL:
            return hit[1]
        merged = {k: {"key": k, "version": 1, "enabled": True, "source": "code",
                      "definition": v} for k, v in self.seed.items()}
        rows = await db.platform_registries.find(
            {"registry": self.name}, {"_id": 0, "history": 0}).to_list(500)
        for r in rows:
            merged[r["key"]] = {"key": r["key"], "version": r.get("version", 1),
                                "enabled": r.get("enabled", True), "source": "db",
                                "definition": r.get("definition") or {},
                                "updated_at": r.get("updated_at")}
        return_val = {k: v for k, v in merged.items()}
        _CACHE[self.name] = (time.monotonic(), return_val)
        return return_val

    async def get(self, key: str) -> dict | None:
        return (await self.all()).get(key)

    async def upsert(self, key: str, definition: dict, actor: dict, reason: str = "") -> dict:
        before = await db.platform_registries.find_one(
            {"registry": self.name, "key": key}, {"_id": 0, "history": 0})
        version = (before or {}).get("version", 1 if key in self.seed else 0) + 1
        hist_entry = {"version": version, "definition": definition,
                      "actor": actor.get("username"), "reason": str(reason)[:300], "at": _iso()}
        await db.platform_registries.update_one(
            {"registry": self.name, "key": key},
            {"$set": {"definition": definition, "version": version,
                      "enabled": (before or {}).get("enabled", True), "updated_at": _iso()},
             "$push": {"history": {"$each": [hist_entry], "$slice": -15}},
             "$setOnInsert": {"id": uuid.uuid4().hex, "created_at": _iso()}},
            upsert=True)
        _CACHE.pop(self.name, None)
        log.info("registry %s: upsert %s v%s by %s", self.name, key, version, actor.get("username"))
        return {"key": key, "version": version}

    async def rollback(self, key: str, version: int, actor: dict) -> dict:
        doc = await db.platform_registries.find_one({"registry": self.name, "key": key})
        if not doc:
            raise ValueError("No DB entry to roll back (code-seeded entries are immutable)")
        target = next((h for h in (doc.get("history") or []) if h.get("version") == version), None)
        if not target:
            raise ValueError(f"Version {version} not found in history")
        return await self.upsert(key, target["definition"], actor,
                                 reason=f"rollback to v{version}")

    async def set_enabled(self, key: str, enabled: bool, actor: dict) -> dict:
        entry = await self.get(key)
        if not entry:
            raise ValueError("Unknown key")
        await db.platform_registries.update_one(
            {"registry": self.name, "key": key},
            {"$set": {"enabled": bool(enabled), "updated_at": _iso(),
                      "definition": entry["definition"],
                      "version": entry["version"]},
             "$setOnInsert": {"id": uuid.uuid4().hex, "created_at": _iso()}},
            upsert=True)
        _CACHE.pop(self.name, None)
        return {"key": key, "enabled": bool(enabled)}
