"""Seed launch levels 3-8 (Creator → Legend) as EDITABLE records.
Idempotent: skips any level name that already exists.
Run: cd /app/backend && python scripts/seed_launch_levels.py
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from core import db as core_db  # noqa: E402
from services.progression.seed import _task, publish_level  # noqa: E402

NOW = datetime.now(timezone.utc).isoformat()

LEVELS = [
    ("Creator", 3, "#C26BFF", "Start shaping the Realm with your creations.", 150, [
        ("Upload an image post", "create_image_post", 1, {}),
        ("Create 10 posts", "post_count", 10, {}),
        ("Receive 5 valid likes", "likes_received", 5, {}),
        ("Customize a widget", "customize_widget", 1, {}),
        ("Complete 80% of your profile", "profile_completion_pct", 80, {"target_pct": 80}),
    ]),
    ("Rising Star", 4, "#4DD2FF", "Your presence is growing — keep the momentum.", 250, [
        ("Post on 5 unique days", "post_unique_days", 5, {}),
        ("Receive engagement from 3 unique real users", "unique_engagers", 3, {}),
        ("Connect with 5 real users", "add_friend", 5, {}),
        ("Create a Realm post", "realm_post", 1, {}),
        ("Receive 3 valid comments", "comments_received", 3, {}),
    ]),
    ("Influencer", 5, "#FF7A18", "The Realm is listening.", 400, [
        ("Create 25 posts", "post_count", 25, {}),
        ("Receive 25 valid likes", "likes_received", 25, {}),
        ("Gain 10 real followers", "gain_follower", 10, {}),
        ("Interact with 10 unique real users", "unique_interactions", 10, {}),
        ("Be active on 10 unique days", "active_days", 10, {}),
    ]),
    ("Elite", 6, "#F4C84A", "Among the most dedicated members of OurRealm.", 600, [
        ("Create 50 posts", "post_count", 50, {}),
        ("Receive engagement from 10 unique real users", "unique_engagers", 10, {}),
        ("Send 10 Realm messages", "realm_message", 10, {}),
        ("Be active on 20 unique days", "active_days", 20, {}),
        ("Send 10 valid messages", "send_message", 10, {}),
    ]),
    ("Master", 7, "#FF3F5A", "A true veteran of the Realm.", 1000, [
        ("Create 100 posts", "post_count", 100, {}),
        ("Receive 100 valid likes", "likes_received", 100, {}),
        ("Gain 25 real followers", "gain_follower", 25, {}),
        ("Be active on 40 unique days", "active_days", 40, {}),
        ("Complete 2 engagement types", "engagement_combo", 2, {"kinds": ["reaction", "comment"]}),
    ]),
    ("Legend", 8, "#00FF66", "Your name echoes across OurRealm.", 2000, [
        ("Create 200 posts", "post_count", 200, {}),
        ("Receive 250 valid likes", "likes_received", 250, {}),
        ("Gain 50 real followers", "gain_follower", 50, {}),
        ("Be active on 75 unique days", "active_days", 75, {}),
        ("Interact with 25 unique real users", "unique_interactions", 25, {}),
    ]),
]


async def main():
    db = core_db.db
    created = []
    for name, num, accent, desc, rep, tasks in LEVELS:
        if await db.progression_levels.find_one({"name": name}):
            continue
        level_id = uuid.uuid4().hex
        await db.progression_levels.insert_one({
            "id": level_id, "name": name, "internal_name": None,
            "level_number": num, "display_order": num * 10,
            "short_description": desc, "long_description": "",
            "is_starting_level": False, "claim_mode": "manual", "repeatable": False,
            "mode_availability": [], "eligibility_rules": {},
            "active_from": None, "expires_at": None,
            "graphics": {"icon_url": None, "badge_url": None, "card_background_url": None,
                         "celebration_url": None, "glow": True, "animation": None,
                         "accent_color": accent, "alt_text": f"{name} level badge"},
            "progress_settings": {
                "required_task_count": len(tasks),
                "progress_bar_label": f"{name} Progress",
                "completion_message": f"All {name} tasks complete!",
                "claim_button_text": "Claim Level Upgrade",
                "celebration_message": f"{name} complete — onwards and upwards!",
                "no_next_level_message": "Highest Available Level Reached",
                "paused_message": "This level is temporarily paused.",
            },
            "rewards": [
                {"id": uuid.uuid4().hex, "type": "completion_badge",
                 "name": f"{name} Completed",
                 "badge_key": f"lvl_{name.lower().replace(' ', '_')}_complete",
                 "icon": "Trophy", "color": accent, "version": 1, "permanent": True},
                {"id": uuid.uuid4().hex, "type": "reputation",
                 "name": f"{name} Reputation", "amount": rep, "version": 1, "permanent": True},
            ],
            "status": "draft", "config_version": 0,
            "created_by": "seed_launch", "created_at": NOW,
            "updated_by": "seed_launch", "updated_at": NOW,
            "published_by": None, "published_at": None,
        })
        for i, (tname, key, target, cfg) in enumerate(tasks):
            t = _task(tname, key, target=target, order=(i + 1) * 10, config=cfg)
            await db.progression_tasks.insert_one({**t, "level_id": level_id})
        await publish_level(level_id, "seed_launch")
        created.append(name)
    print("created+published:", created or "none (already exist)")


if __name__ == "__main__":
    asyncio.run(main())
