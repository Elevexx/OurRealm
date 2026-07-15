"""Seed editable Newbie + Explorer levels (idempotent — only when empty)."""
import uuid
from datetime import datetime, timezone

from core.db import db


def _now():
    return datetime.now(timezone.utc).isoformat()


def _task(name, key, target=1, required=True, order=0, desc="", config=None,
          button=None, dest=None):
    from services.progression.registry import get_task_type
    tt = get_task_type(key) or {}
    return {
        "id": uuid.uuid4().hex, "name": name, "description": desc or tt.get("name", name),
        "task_type_key": key, "category": tt.get("category", "custom"),
        "required": required, "target_value": target, "config": config or {},
        "button_label": button or tt.get("default_button_label", "Go"),
        "button_destination": dest or tt.get("default_destination", "/home"),
        "count_historical": True, "sort_order": order, "status": "active",
        "version": 1, "graphic_url": None,
        "created_at": _now(), "updated_at": _now(),
    }


async def publish_level(level_id: str, published_by: str = "seed") -> dict:
    """Create an immutable version snapshot and mark published."""
    level = await db.progression_levels.find_one({"id": level_id}, {"_id": 0})
    tasks = [t async for t in db.progression_tasks.find(
        {"level_id": level_id, "status": {"$nin": ["archived"]}}, {"_id": 0})]
    tasks.sort(key=lambda t: t.get("sort_order") or 0)
    version = int(level.get("config_version") or 0) + 1
    snapshot = {**level, "config_version": version, "tasks": tasks}
    await db.progression_level_versions.insert_one({
        "id": uuid.uuid4().hex, "level_id": level_id, "version": version,
        "snapshot": snapshot, "published_by": published_by, "published_at": _now(),
    })
    await db.progression_levels.update_one(
        {"id": level_id},
        {"$set": {"status": "published", "config_version": version,
                  "published_by": published_by, "published_at": _now(), "updated_at": _now()}})
    return snapshot


async def ensure_progression_seed() -> bool:
    if await db.progression_levels.count_documents({}) > 0:
        return False
    now = _now()
    newbie_id, explorer_id = uuid.uuid4().hex, uuid.uuid4().hex
    base = {
        "internal_name": None, "short_description": "", "long_description": "",
        "active_from": None, "expires_at": None, "claim_mode": "manual",
        "repeatable": False, "mode_availability": [], "eligibility_rules": {},
        "config_version": 0, "status": "draft",
        "created_by": "seed", "created_at": now, "updated_by": "seed", "updated_at": now,
        "published_by": None, "published_at": None,
        "graphics": {"icon_url": None, "badge_url": None, "card_background_url": None,
                     "celebration_url": None, "glow": True, "animation": None,
                     "fallback_emoji_label": None, "alt_text": ""},
        "rewards": [],
    }
    await db.progression_levels.insert_one({
        **base, "id": newbie_id, "name": "Newbie", "level_number": 1, "display_order": 10,
        "is_starting_level": True,
        "short_description": "Welcome to OurRealm — set up your presence.",
        "long_description": "Complete your first three steps to become an Explorer.",
        "graphics": {**base["graphics"], "alt_text": "Newbie level badge", "accent_color": "#4DD2FF"},
        "progress_settings": {
            "required_task_count": 3, "progress_bar_label": "Newbie Progress",
            "completion_message": "All Newbie tasks complete!",
            "claim_button_text": "Claim Level Upgrade",
            "celebration_message": "Welcome to Explorer — your Realm journey begins!",
            "no_next_level_message": "Highest Available Level Reached",
            "paused_message": "This level is temporarily paused.",
        },
        "rewards": [
            {"id": uuid.uuid4().hex, "type": "completion_badge", "name": "Newbie Completed",
             "badge_key": "lvl_newbie_complete", "icon": "Award", "color": "#4DD2FF",
             "version": 1, "permanent": True},
            {"id": uuid.uuid4().hex, "type": "reputation", "name": "Starter Reputation",
             "amount": 50, "version": 1, "permanent": True},
        ],
    })
    await db.progression_levels.insert_one({
        **base, "id": explorer_id, "name": "Explorer", "level_number": 2, "display_order": 20,
        "is_starting_level": False,
        "short_description": "Explore the Realm — connect and create.",
        "long_description": "Five steps that take you deeper into OurRealm.",
        "graphics": {**base["graphics"], "alt_text": "Explorer level badge", "accent_color": "#10E670"},
        "progress_settings": {
            "required_task_count": 5, "progress_bar_label": "Explorer Progress",
            "completion_message": "All Explorer tasks complete!",
            "claim_button_text": "Claim Level Upgrade",
            "celebration_message": "Explorer complete — you know your way around!",
            "no_next_level_message": "Highest Available Level Reached",
            "paused_message": "This level is temporarily paused.",
        },
        "rewards": [
            {"id": uuid.uuid4().hex, "type": "completion_badge", "name": "Explorer Completed",
             "badge_key": "lvl_explorer_complete", "icon": "Compass", "color": "#10E670",
             "version": 1, "permanent": True},
            {"id": uuid.uuid4().hex, "type": "reputation", "name": "Explorer Reputation",
             "amount": 100, "version": 1, "permanent": True},
        ],
    })
    newbie_tasks = [
        _task("Upload a real profile picture", "profile_picture", order=10,
              desc="Add a real photo so friends recognize you."),
        _task("Upload a real profile banner", "profile_banner", order=20,
              desc="Give your profile a personal backdrop."),
        _task("Create a For You post", "foryou_eligible_post", order=30,
              desc="Share your first public post eligible for the For You feed."),
    ]
    explorer_tasks = [
        _task("Complete your profile biography", "profile_bio", order=10,
              desc="Tell the Realm who you are."),
        _task("Follow another real user", "follow_user", order=20,
              desc="Connect with someone real on OurRealm."),
        _task("Join a Realm", "join_realm", order=30,
              desc="Find a community that matches your interests."),
        _task("Create a second qualifying post", "foryou_eligible_post", target=2, order=40,
              desc="Keep sharing — publish a second For You-eligible post."),
        _task("React to or comment on another user's post", "engagement_combo", order=50,
              config={"kinds": ["reaction", "comment"], "any_one": True}, target=1,
              desc="Engage with another real member's post."),
    ]
    for t in newbie_tasks:
        await db.progression_tasks.insert_one({**t, "level_id": newbie_id})
    for t in explorer_tasks:
        await db.progression_tasks.insert_one({**t, "level_id": explorer_id})
    await publish_level(newbie_id, "seed")
    await publish_level(explorer_id, "seed")
    return True
