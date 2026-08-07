"""Mini mechanics-test game (short world) reusing the Jungle art — verifies
key-locked portal, backtracking, level transition, nexus level, ending."""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

SRC = "a1fa88be6bdf48c5bf28b0fab18fb1dc"
TEST_ID = "e2e51e2e51e2e51e2e51e2e51e2e5100"

S1 = {"title": "Test Ruins", "mode": "side_scroll", "zone": "forest", "width": 1000,
      "ambient": "bright", "hero_scale": 1.3, "hazard": "water", "player_hp": 40,
      "start_x": 60, "intro": "Test level 1",
      "platforms": [{"x": 0, "y": 302, "w": 1000}],
      "features": [], "checkpoints_x": [120],
      "pickups": [{"x": 200, "y": 272, "kind": "key"}],
      "props": [], "enemies": [{"x": 940, "type": "walker", "hp": 8, "attack": 2, "speed": 20, "xp": 5, "pi": 0}],
      "exit": {"x": 640, "requires_keys": 1, "size": 1.5}}
S2 = {"title": "Test Nexus", "mode": "side_scroll", "zone": "nexus", "width": 1000,
      "hero_scale": 1.3, "hazard": "void", "player_hp": 40, "start_x": 50,
      "intro": "Test level 2",
      "platforms": [{"x": 0, "y": 302, "w": 240}, {"x": 320, "y": 268, "w": 130},
                    {"x": 520, "y": 240, "w": 130}, {"x": 700, "y": 290, "w": 300}],
      "features": [{"type": "crystal", "x": 120}], "checkpoints_x": [100],
      "pickups": [{"x": 380, "y": 238, "kind": "gem"}],
      "props": [], "enemies": [{"x": 950, "type": "bat", "hp": 6, "attack": 2, "speed": 20, "xp": 5, "anchor_y": 120}],
      "exit": {"x": 880, "requires_keys": 0, "size": 1.8},
      "ending": True, "ending_title": "PART 2", "ending_subtitle": "COMING SOON"}


async def main():
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    src = await db.games.find_one({"id": SRC}, {"_id": 0})
    spec = dict(src["spec"])
    spec["stages"] = [S1, S2]
    spec["title"] = "E2E MECHANICS TEST"
    now = datetime.now(timezone.utc).isoformat()
    doc = {**src, "id": TEST_ID, "title": "E2E MECHANICS TEST", "spec": spec,
           "status": "pending_approval", "created_at": now, "updated_at": now}
    await db.games.delete_one({"id": TEST_ID})
    await db.games.insert_one(doc)
    print("test game ready:", TEST_ID)

asyncio.run(main())
