"""Simulated distributed-load pass: 50/100/250/500/1000 SIMULATED users through resolve_join.
Inserts simulated presence per assignment, verifies capacity respected, reports distribution +
join latency. Cleans up all sim data afterwards. THIS IS LOGICAL/SIMULATED CAPACITY ONLY."""
import asyncio
import sys
import time

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")


async def stage(db, ni, n):
    t0 = time.time()
    lat = []
    for i in range(n):
        u = {"id": f"sim-{i}", "username": f"sim{i}", "friends": []}
        s = time.time()
        res = await ni.resolve_join(db, u, {})
        lat.append(time.time() - s)
        await db.nexus_presence.update_one({"user_id": u["id"]}, {"$set": {
            "user_id": u["id"], "username": u["username"], "zone_id": "nexus_central",
            "instance_id": res["instance_id"], "x": 0, "y": 0, "z": 60, "ry": 0, "anim": "idle",
            "ts": time.time() + 3600}}, upsert=True)
    insts = await db.nexus_instances.find({"lifecycle": "active"}, {"_id": 0, "instance_id": 1, "capacity": 1}).to_list(200)
    dist = {}
    over = 0
    for inst in insts:
        pop = await db.nexus_presence.count_documents({"instance_id": inst["instance_id"], "user_id": {"$regex": "^sim-"}})
        if pop:
            dist[inst["instance_id"]] = pop
            if pop > (inst.get("capacity") or 24):
                over += 1
    lat.sort()
    print(f"[load] {n} users: {len(dist)} instances, max pop {max(dist.values() or [0])}, "
          f"over-capacity {over}, joins/sec {n/(time.time()-t0):.1f}, "
          f"p50 {lat[len(lat)//2]*1000:.0f}ms p95 {lat[int(len(lat)*0.95)]*1000:.0f}ms", flush=True)
    return over


async def main():
    from core.db import db
    from services import nexus_instances as ni
    total_over = 0
    for n in (50, 100, 250, 500, 1000):
        await db.nexus_presence.delete_many({"user_id": {"$regex": "^sim-"}})
        total_over += await stage(db, ni, n)
    await db.nexus_presence.delete_many({"user_id": {"$regex": "^sim-"}})
    kept = await db.nexus_instances.count_documents({"access_mode": "public"})
    print(f"[load] done. public instances created total: {kept}. over-capacity events: {total_over}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
