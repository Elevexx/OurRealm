"""Align the 8 launch levels to the founder-approved spec (tasks + rewards).
Replaces each level's tasks/rewards and republishes (new version, users migrated).
Run: cd /app/backend && python scripts/align_launch_levels.py
"""
import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from core.db import db  # noqa: E402
from services.progression.seed import _task, publish_level  # noqa: E402


def R(rtype, name, **kw):
    return {"id": uuid.uuid4().hex, "type": rtype, "name": name, "version": 1,
            "permanent": True, **kw}


SPEC = {
    "Newbie": {
        "rep": 100,
        "tasks": [
            ("Upload a real profile picture", "profile_picture", 1, {}),
            ("Upload a real profile banner", "profile_banner", 1, {}),
            ("Create your first public post", "foryou_eligible_post", 1, {}),
        ],
        "rewards": [
            R("completion_badge", "Newbie Completed", badge_key="lvl_newbie_complete", icon="Award", color="#4DD2FF"),
            R("level_badge", "Explorer Current-Level Badge"),
        ],
    },
    "Explorer": {
        "rep": 200,
        "tasks": [
            ("Complete your profile biography", "profile_bio", 1, {}),
            ("Follow another real user", "follow_user", 1, {}),
            ("Join a Realm", "join_realm", 1, {}),
            ("Create a second qualifying post", "foryou_eligible_post", 2, {}),
            ("React to or comment on another user's post", "engagement_combo", 1, {"kinds": ["reaction", "comment"], "any_one": True}),
        ],
        "rewards": [
            R("completion_badge", "Explorer Completed", badge_key="lvl_explorer_complete", icon="Compass", color="#10E670"),
            R("level_badge", "Creator Current-Level Badge"),
        ],
    },
    "Creator": {
        "rep": 300,
        "tasks": [
            ("Create 10 qualifying posts", "post_count", 10, {}),
            ("Create an image post", "create_image_post", 1, {}),
            ("Create a video post", "create_video_post", 1, {}),
            ("Receive 25 valid likes", "likes_received", 25, {}),
            ("Receive 10 valid comments", "comments_received", 10, {}),
        ],
        "rewards": [
            R("completion_badge", "Creator Completed", badge_key="lvl_creator_complete", icon="Trophy", color="#C26BFF"),
            R("level_badge", "Rising Star Current-Level Badge"),
        ],
    },
    "Rising Star": {
        "rep": 500,
        "tasks": [
            ("Gain 25 real followers", "gain_follower", 25, {}),
            ("Receive 100 valid likes", "likes_received", 100, {}),
            ("Create posts on 7 unique days", "post_unique_days", 7, {}),
            ("Join 3 Realms", "join_realm", 3, {}),
            ("Complete your Top 8", "top8_add", 8, {}),
        ],
        "rewards": [
            R("completion_badge", "Rising Star Completed", badge_key="lvl_rising_star_complete", icon="Trophy", color="#4DD2FF"),
            R("level_badge", "Influencer Current-Level Badge"),
            R("profile_frame", "Rising Star Profile Frame", unlock_key="frame_rising_star"),
        ],
    },
    "Influencer": {
        "rep": 750,
        "tasks": [
            ("Gain 100 real followers", "gain_follower", 100, {}),
            ("Receive 500 valid likes", "likes_received", 500, {}),
            ("Receive 100 valid comments", "comments_received", 100, {}),
            ("Create 50 qualifying posts", "post_count", 50, {}),
            ("Receive engagement from 25 unique real users", "unique_engagers", 25, {}),
        ],
        "rewards": [
            R("completion_badge", "Influencer Completed", badge_key="lvl_influencer_complete", icon="Trophy", color="#FF7A18"),
            R("level_badge", "Elite Current-Level Badge"),
            R("username_effect", "Influencer Username Effect", unlock_key="fx_influencer_name"),
        ],
    },
    "Elite": {
        "rep": 1000,
        "tasks": [
            ("Gain 250 real followers", "gain_follower", 250, {}),
            ("Receive 2,000 valid likes", "likes_received", 2000, {}),
            ("Create 100 qualifying posts", "post_count", 100, {}),
            ("Be active on 30 unique days", "active_days", 30, {}),
            ("Complete the tutorial", "complete_tutorial", 1, {}),
        ],
        "rewards": [
            R("completion_badge", "Elite Completed", badge_key="lvl_elite_complete", icon="Trophy", color="#F4C84A"),
            R("level_badge", "Master Current-Level Badge"),
            R("profile_background", "Elite Profile Background", unlock_key="bg_elite"),
        ],
    },
    "Master": {
        "rep": 2000,
        "tasks": [
            ("Gain 500 real followers", "gain_follower", 500, {}),
            ("Receive 5,000 valid likes", "likes_received", 5000, {}),
            ("Receive 500 valid comments", "comments_received", 500, {}),
            ("Create 250 qualifying posts", "post_count", 250, {}),
            ("Participate in 10 different Realms", "realm_unique_interacted", 10, {}),
        ],
        "rewards": [
            R("completion_badge", "Master Completed", badge_key="lvl_master_complete", icon="Trophy", color="#FF3F5A"),
            R("level_badge", "Legend Current-Level Badge"),
            R("permanent_cosmetic", "Animated Master Frame", unlock_key="frame_master_animated"),
        ],
    },
    "Legend": {
        "rep": 5000,
        "tasks": [
            ("Gain 1,000 real followers", "gain_follower", 1000, {}),
            ("Receive 10,000 valid likes", "likes_received", 10000, {}),
            ("Receive 1,000 valid comments", "comments_received", 1000, {}),
            ("Create 500 qualifying posts", "post_count", 500, {}),
            ("Be active on 100 unique days", "active_days", 100, {}),
        ],
        "rewards": [
            R("completion_badge", "Legend Completed", badge_key="lvl_legend_complete", icon="Crown", color="#00FF66"),
            R("permanent_cosmetic", "Legendary Animated Badge", unlock_key="badge_legend_animated"),
            R("permanent_cosmetic", "Legendary Profile Effect", unlock_key="fx_legend_profile"),
        ],
    },
}


async def main():
    for name, spec in SPEC.items():
        level = await db.progression_levels.find_one({"name": name}, {"_id": 0})
        if not level:
            print(f"SKIP {name}: not found")
            continue
        await db.progression_tasks.delete_many({"level_id": level["id"]})
        for i, (tname, key, target, cfg) in enumerate(spec["tasks"]):
            t = _task(tname, key, target=target, order=(i + 1) * 10, config=cfg)
            await db.progression_tasks.insert_one({**t, "level_id": level["id"]})
        rewards = spec["rewards"] + [R("reputation", f"{name} Reputation", amount=spec["rep"])]
        ps = level.get("progress_settings") or {}
        ps["required_task_count"] = len(spec["tasks"])
        await db.progression_levels.update_one(
            {"id": level["id"]}, {"$set": {"rewards": rewards, "progress_settings": ps}})
        snap = await publish_level(level["id"], "spec_alignment")
        n = await db.user_level_progress.update_many(
            {"current_level_id": level["id"]},
            {"$set": {"current_level_version": snap["config_version"],
                      "last_calculated_at": None, "calculation_source": "version_migration"}})
        print(f"{name}: v{snap['config_version']} tasks={len(spec['tasks'])} migrated={n.modified_count}")


if __name__ == "__main__":
    asyncio.run(main())
