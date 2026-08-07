"""v3 mechanics E2E game: vertical tiers, key, sealed portal, stairs, nexus, ending."""
import asyncio
import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

SRC = "a1fa88be6bdf48c5bf28b0fab18fb1dc"
TEST_ID = "e2e51e2e51e2e51e2e51e2e51e2e5100"

S1 = {"title": "Test Ruins", "mode": "side_scroll", "zone": "forest", "width": 1600,
      "world_h": 720, "ground_default": 660, "ambient": "bright", "hero_scale": 1.25,
      "hazard": "water", "player_hp": 40, "start_x": 60, "intro": "Test level 1",
      "platforms": [
          {"x": 0, "y": 300, "w": 500, "depth": 100},
          {"x": 400, "y": 480, "w": 400, "depth": 100},
          {"x": 860, "y": 420, "w": 80, "depth": 80},
          {"x": 960, "y": 360, "w": 80, "depth": 80},
          {"x": 1060, "y": 330, "w": 80, "depth": 80},
          {"x": 1140, "y": 300, "w": 460, "depth": 120},
          {"x": 0, "y": 660, "w": 1600},
      ],
      "features": [{"type": "arch", "x": 640, "y": 480}],
      "checkpoints_x": [200],
      "pickups": [{"x": 700, "y": 450, "kind": "key"}],
      "props": [], "enemies": [{"x": 1560, "type": "walker", "hp": 8, "attack": 2, "speed": 10, "xp": 5, "pi": 5}],
      "exit": {"x": 1450, "requires_keys": 1, "size": 2.0}}
S2 = {"title": "Test Nexus", "mode": "side_scroll", "zone": "nexus", "width": 1250,
      "world_h": 540, "hero_scale": 1.25, "hazard": "void", "player_hp": 40,
      "start_x": 50, "intro": "Test level 2",
      "platforms": [
          {"x": 0, "y": 320, "w": 240, "deep": False},
          {"x": 320, "y": 290, "w": 130, "deep": False},
          {"x": 510, "y": 260, "w": 130, "deep": False},
          {"x": 700, "y": 300, "w": 120, "deep": False},
          {"x": 880, "y": 320, "w": 370, "deep": False},
      ],
      "features": [{"type": "crystal", "x": 120, "y": 320}], "checkpoints_x": [100],
      "pickups": [{"x": 560, "y": 228, "kind": "key"}],
      "props": [], "enemies": [{"x": 1200, "type": "bat", "hp": 6, "attack": 2, "speed": 10, "xp": 5, "anchor_y": 100}],
      "exit": {"x": 1100, "requires_keys": 1, "size": 2.2, "color": "#B26BFF"},
      "ending": True, "ending_title": "PART 2", "ending_subtitle": "COMING SOON"}


async def main():
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    src = await db.games.find_one({"id": SRC}, {"_id": 0})
    spec = dict(src["spec"])
    spec["stages"] = [S1, S2]
    spec["title"] = "E2E MECHANICS TEST V3"
    now = datetime.now(timezone.utc).isoformat()
    doc = {**src, "id": TEST_ID, "title": "E2E MECHANICS TEST V3", "spec": spec,
           "status": "pending_approval", "created_at": now, "updated_at": now}
    await db.games.delete_one({"id": TEST_ID})
    await db.games.insert_one(doc)
    print("v3 test game ready:", TEST_ID)

asyncio.run(main())
