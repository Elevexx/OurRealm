"""Provider-neutral Nexus Instance Director (v1, current stack only).
Smart join order: explicit instance -> realm -> friend -> friends-first -> fullest healthy public -> new.
Lazy lifecycle: draining/closing empty publics, sleeping/waking realm instances. No client trust."""
import time
import uuid
from datetime import datetime, timezone

DEFAULT_CAPACITY = 24
PARTY_HEADROOM = 2
PRESENCE_TTL = 12
EMPTY_GRACE_S = 300


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def _population(db, instance_id: str) -> int:
    return await db.nexus_presence.count_documents(
        {"instance_id": instance_id, "ts": {"$gt": time.time() - PRESENCE_TTL}})


async def _reserved(db, instance_id: str) -> int:
    now = time.time()
    total = 0
    async for r in db.nexus_reservations.find({"instance_id": instance_id, "expires": {"$gt": now}}, {"_id": 0, "size": 1}):
        total += r.get("size", 0)
    return total


async def _has_space(db, inst: dict, size: int = 1, respect_headroom: bool = True) -> bool:
    cap = inst.get("capacity") or DEFAULT_CAPACITY
    used = await _population(db, inst["instance_id"]) + await _reserved(db, inst["instance_id"])
    head = PARTY_HEADROOM if respect_headroom else 0
    return used + size <= cap - head


async def ensure_default_instance(db) -> dict:
    inst = await db.nexus_instances.find_one({"instance_id": "public-1"}, {"_id": 0})
    if not inst:
        inst = {"instance_id": "public-1", "world_id": "nexus-v1", "realm_slug": None, "name": "Nexus Central 1",
                "region": "default", "capacity": DEFAULT_CAPACITY, "health": "healthy",
                "access_mode": "public", "visibility": "listed", "lifecycle": "active",
                "created_at": _iso(), "last_active_at": _iso()}
        await db.nexus_instances.update_one({"instance_id": "public-1"}, {"$set": inst}, upsert=True)
    return inst


async def _create_public(db) -> dict:
    n = await db.nexus_instances.count_documents({"access_mode": "public"})
    inst = {"instance_id": f"public-{uuid.uuid4().hex[:8]}", "world_id": "nexus-v1", "realm_slug": None,
            "name": f"Nexus Central {n + 1}", "region": "default", "capacity": DEFAULT_CAPACITY,
            "health": "healthy", "access_mode": "public", "visibility": "listed", "lifecycle": "active",
            "created_at": _iso(), "last_active_at": _iso()}
    await db.nexus_instances.insert_one(dict(inst))
    return inst


async def _joinable(db, inst: dict, user: dict, size: int = 1) -> bool:
    if not inst or inst.get("lifecycle") not in ("active",) or inst.get("health") == "unhealthy":
        return False
    mode = inst.get("access_mode", "public")
    if mode == "public":
        return await _has_space(db, inst, size, respect_headroom=False)
    if mode in ("realm", "invite", "private"):
        if user.get("username") == "stealth" or user.get("id") == inst.get("owner_id"):
            return await _has_space(db, inst, size, respect_headroom=False)
        if mode == "realm" and inst.get("realm_slug"):
            members = inst.get("member_ids") or []
            allowed = not members or user["id"] in members
            return allowed and await _has_space(db, inst, size, respect_headroom=False)
        invited = user["id"] in (inst.get("invited_ids") or [])
        return invited and await _has_space(db, inst, size, respect_headroom=False)
    return False


async def maintain(db):
    """Lazy lifecycle sweep: drain near-empty extra publics, close empty drained, sleep empty realms."""
    now = time.time()
    cur = db.nexus_instances.find({"lifecycle": {"$in": ["active", "draining"]}}, {"_id": 0})
    async for inst in cur:
        pop = await _population(db, inst["instance_id"])
        if pop > 0:
            await db.nexus_instances.update_one({"instance_id": inst["instance_id"]},
                                                {"$set": {"last_active_at": _iso(), "_empty_since": None}})
            continue
        empty_since = inst.get("_empty_since")
        if not empty_since:
            await db.nexus_instances.update_one({"instance_id": inst["instance_id"]},
                                                {"$set": {"_empty_since": now}})
            continue
        if now - empty_since < EMPTY_GRACE_S:
            continue
        if inst.get("access_mode") == "public" and inst["instance_id"] != "public-1":
            await db.nexus_instances.update_one({"instance_id": inst["instance_id"]},
                                                {"$set": {"lifecycle": "closed", "closed_at": _iso()}})
        elif inst.get("realm_slug"):
            await db.nexus_instances.update_one({"instance_id": inst["instance_id"]},
                                                {"$set": {"lifecycle": "sleeping"}})


async def resolve_join(db, user: dict, target: dict) -> dict:
    """Returns {instance_id, reason} or raises ValueError(message)."""
    await ensure_default_instance(db)
    await maintain(db)

    # 1) explicit instance
    if target.get("instance_id"):
        inst = await db.nexus_instances.find_one({"instance_id": str(target["instance_id"])[:40]}, {"_id": 0})
        if inst and inst.get("lifecycle") == "sleeping" and inst.get("realm_slug"):
            await db.nexus_instances.update_one({"instance_id": inst["instance_id"]},
                                                {"$set": {"lifecycle": "active", "_empty_since": None}})
            inst["lifecycle"] = "active"
        if not inst or not await _joinable(db, inst, user):
            raise ValueError("That instance is unavailable or full")
        return {"instance_id": inst["instance_id"], "reason": "direct"}

    # 2) realm instance
    if target.get("realm_slug"):
        slug = str(target["realm_slug"])[:40]
        inst = await db.nexus_instances.find_one({"realm_slug": slug, "lifecycle": {"$in": ["active", "sleeping"]}}, {"_id": 0})
        if not inst:
            raise ValueError("Realm instance not found")
        if inst["lifecycle"] == "sleeping":
            await db.nexus_instances.update_one({"instance_id": inst["instance_id"]},
                                                {"$set": {"lifecycle": "active", "_empty_since": None}})
            inst["lifecycle"] = "active"
        if not await _joinable(db, inst, user):
            raise ValueError("Realm instance is unavailable or full")
        return {"instance_id": inst["instance_id"], "reason": "realm"}

    friends = set(user.get("friends") or [])

    # 3) chosen friend / 4) friends-first
    async def friend_instance(friend_id=None):
        now = time.time()
        q = {"ts": {"$gt": now - PRESENCE_TTL}, "instance_id": {"$exists": True}}
        if friend_id:
            q["user_id"] = friend_id
        else:
            if not friends:
                return None
            q["user_id"] = {"$in": list(friends)}
        best = {}
        async for p in db.nexus_presence.find(q, {"_id": 0, "instance_id": 1, "user_id": 1}):
            best[p["instance_id"]] = best.get(p["instance_id"], 0) + 1
        for iid in sorted(best, key=best.get, reverse=True):
            inst = await db.nexus_instances.find_one({"instance_id": iid, "lifecycle": "active"}, {"_id": 0})
            if inst and inst.get("access_mode") == "public" and await _joinable(db, inst, user):
                return inst["instance_id"]
        return None

    if target.get("friend"):
        fu = await db.users.find_one({"username": str(target["friend"])[:40]}, {"_id": 0, "id": 1})
        if fu and fu["id"] in friends:
            iid = await friend_instance(fu["id"])
            if iid:
                return {"instance_id": iid, "reason": "friend"}
        # fall through silently (never reveal blocked/hidden presence)

    iid = await friend_instance()
    if iid:
        return {"instance_id": iid, "reason": "friends"}

    # 5) fullest healthy public with space (keep party headroom)
    pubs = await db.nexus_instances.find(
        {"access_mode": "public", "lifecycle": "active", "health": "healthy"}, {"_id": 0}).to_list(50)
    scored = []
    for inst in pubs:
        pop = await _population(db, inst["instance_id"])
        if await _has_space(db, inst, 1, respect_headroom=True):
            scored.append((pop, inst["instance_id"]))
    if scored:
        scored.sort(reverse=True)
        return {"instance_id": scored[0][1], "reason": "public"}

    # 6) create new
    inst = await _create_public(db)
    return {"instance_id": inst["instance_id"], "reason": "created"}
