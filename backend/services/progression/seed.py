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


# ── Founder-approved full launch ladder (idempotent production seed) ──
def _reward(rtype, name, **kw):
    return {"id": uuid.uuid4().hex, "type": rtype, "name": name, "version": 1,
            "permanent": True, **kw}


LAUNCH_LADDER = [
    {"name": "Newbie", "number": 1, "accent": "#4DD2FF", "starting": True,
     "desc": "Welcome to OurRealm — set up your presence.", "rep": 100,
     "tasks": [("Upload a real profile picture", "profile_picture", 1, {}),
               ("Upload a real profile banner", "profile_banner", 1, {}),
               ("Create your first public post", "foryou_eligible_post", 1, {})],
     "rewards": [_reward("completion_badge", "Newbie Completed", badge_key="lvl_newbie_complete", icon="Award", color="#4DD2FF"),
                 _reward("level_badge", "Explorer Current-Level Badge")]},
    {"name": "Explorer", "number": 2, "accent": "#10E670", "starting": False,
     "desc": "Explore the Realm — connect and create.", "rep": 200,
     "tasks": [("Complete your profile biography", "profile_bio", 1, {}),
               ("Follow another real user", "follow_user", 1, {}),
               ("Join a Realm", "join_realm", 1, {}),
               ("Create a second qualifying post", "foryou_eligible_post", 2, {}),
               ("React to or comment on another user's post", "engagement_combo", 1, {"kinds": ["reaction", "comment"], "any_one": True})],
     "rewards": [_reward("completion_badge", "Explorer Completed", badge_key="lvl_explorer_complete", icon="Compass", color="#10E670"),
                 _reward("level_badge", "Creator Current-Level Badge")]},
    {"name": "Creator", "number": 3, "accent": "#C26BFF", "starting": False,
     "desc": "Start shaping the Realm with your creations.", "rep": 300,
     "tasks": [("Create 10 qualifying posts", "post_count", 10, {}),
               ("Create an image post", "create_image_post", 1, {}),
               ("Create a video post", "create_video_post", 1, {}),
               ("Receive 25 valid likes", "likes_received", 25, {}),
               ("Receive 10 valid comments", "comments_received", 10, {})],
     "rewards": [_reward("completion_badge", "Creator Completed", badge_key="lvl_creator_complete", icon="Trophy", color="#C26BFF"),
                 _reward("level_badge", "Rising Star Current-Level Badge")]},
    {"name": "Rising Star", "number": 4, "accent": "#4DD2FF", "starting": False,
     "desc": "Your presence is growing — keep the momentum.", "rep": 500,
     "tasks": [("Gain 25 real followers", "gain_follower", 25, {}),
               ("Receive 100 valid likes", "likes_received", 100, {}),
               ("Create posts on 7 unique days", "post_unique_days", 7, {}),
               ("Join 3 Realms", "join_realm", 3, {}),
               ("Complete your Top 8", "top8_add", 8, {})],
     "rewards": [_reward("completion_badge", "Rising Star Completed", badge_key="lvl_rising_star_complete", icon="Trophy", color="#4DD2FF"),
                 _reward("level_badge", "Influencer Current-Level Badge"),
                 _reward("profile_frame", "Rising Star Profile Frame", unlock_key="frame_rising_star")]},
    {"name": "Influencer", "number": 5, "accent": "#FF7A18", "starting": False,
     "desc": "The Realm is listening.", "rep": 750,
     "tasks": [("Gain 100 real followers", "gain_follower", 100, {}),
               ("Receive 500 valid likes", "likes_received", 500, {}),
               ("Receive 100 valid comments", "comments_received", 100, {}),
               ("Create 50 qualifying posts", "post_count", 50, {}),
               ("Receive engagement from 25 unique real users", "unique_engagers", 25, {})],
     "rewards": [_reward("completion_badge", "Influencer Completed", badge_key="lvl_influencer_complete", icon="Trophy", color="#FF7A18"),
                 _reward("level_badge", "Elite Current-Level Badge"),
                 _reward("username_effect", "Influencer Username Effect", unlock_key="fx_influencer_name")]},
    {"name": "Elite", "number": 6, "accent": "#F4C84A", "starting": False,
     "desc": "Among the most dedicated members of OurRealm.", "rep": 1000,
     "tasks": [("Gain 250 real followers", "gain_follower", 250, {}),
               ("Receive 2,000 valid likes", "likes_received", 2000, {}),
               ("Create 100 qualifying posts", "post_count", 100, {}),
               ("Be active on 30 unique days", "active_days", 30, {}),
               ("Complete the tutorial", "complete_tutorial", 1, {})],
     "rewards": [_reward("completion_badge", "Elite Completed", badge_key="lvl_elite_complete", icon="Trophy", color="#F4C84A"),
                 _reward("level_badge", "Master Current-Level Badge"),
                 _reward("profile_background", "Elite Profile Background", unlock_key="bg_elite")]},
    {"name": "Master", "number": 7, "accent": "#FF3F5A", "starting": False,
     "desc": "A true veteran of the Realm.", "rep": 2000,
     "tasks": [("Gain 500 real followers", "gain_follower", 500, {}),
               ("Receive 5,000 valid likes", "likes_received", 5000, {}),
               ("Receive 500 valid comments", "comments_received", 500, {}),
               ("Create 250 qualifying posts", "post_count", 250, {}),
               ("Participate in 10 different Realms", "realm_unique_interacted", 10, {})],
     "rewards": [_reward("completion_badge", "Master Completed", badge_key="lvl_master_complete", icon="Trophy", color="#FF3F5A"),
                 _reward("level_badge", "Legend Current-Level Badge"),
                 _reward("permanent_cosmetic", "Animated Master Frame", unlock_key="frame_master_animated")]},
    {"name": "Legend", "number": 8, "accent": "#00FF66", "starting": False,
     "desc": "Your name echoes across OurRealm.", "rep": 5000,
     "tasks": [("Gain 1,000 real followers", "gain_follower", 1000, {}),
               ("Receive 10,000 valid likes", "likes_received", 10000, {}),
               ("Receive 1,000 valid comments", "comments_received", 1000, {}),
               ("Create 500 qualifying posts", "post_count", 500, {}),
               ("Be active on 100 unique days", "active_days", 100, {})],
     "rewards": [_reward("completion_badge", "Legend Completed", badge_key="lvl_legend_complete", icon="Crown", color="#00FF66"),
                 _reward("permanent_cosmetic", "Legendary Animated Badge", unlock_key="badge_legend_animated"),
                 _reward("permanent_cosmetic", "Legendary Profile Effect", unlock_key="fx_legend_profile")]},
]

LAUNCH_LEVEL_NAMES = [l["name"] for l in LAUNCH_LADDER]


async def seed_launch_ladder(seeded_by: str) -> dict:
    """Idempotent full 8-level founder-approved seed. Existing levels (by
    name) are NEVER touched — no duplicate levels, tasks, rewards, or
    versions. Only missing levels are created and published."""
    created, existed = [], []
    now = _now()
    for spec in LAUNCH_LADDER:
        if await db.progression_levels.find_one({"name": spec["name"]}):
            existed.append(spec["name"])
            continue
        level_id = uuid.uuid4().hex
        await db.progression_levels.insert_one({
            "id": level_id, "name": spec["name"], "internal_name": None,
            "level_number": spec["number"], "display_order": spec["number"] * 10,
            "short_description": spec["desc"], "long_description": "",
            "is_starting_level": spec["starting"], "claim_mode": "manual",
            "repeatable": False, "mode_availability": [], "eligibility_rules": {},
            "active_from": None, "expires_at": None,
            "graphics": {"icon_url": None, "badge_url": None, "card_background_url": None,
                         "celebration_url": None, "glow": True, "animation": None,
                         "accent_color": spec["accent"], "alt_text": f"{spec['name']} level badge"},
            "progress_settings": {
                "required_task_count": len(spec["tasks"]),
                "progress_bar_label": f"{spec['name']} Progress",
                "completion_message": f"All {spec['name']} tasks complete!",
                "claim_button_text": "Claim Level Upgrade",
                "celebration_message": f"{spec['name']} complete — onwards and upwards!",
                "no_next_level_message": "Highest Available Level Reached",
                "paused_message": "This level is temporarily paused.",
            },
            "rewards": [{**r, "id": uuid.uuid4().hex} for r in spec["rewards"]]
                       + [_reward("reputation", f"{spec['name']} Reputation", amount=spec["rep"])],
            "status": "draft", "config_version": 0,
            "created_by": seeded_by, "created_at": now,
            "updated_by": seeded_by, "updated_at": now,
            "published_by": None, "published_at": None,
        })
        for i, (tname, key, target, cfg) in enumerate(spec["tasks"]):
            t = _task(tname, key, target=target, order=(i + 1) * 10, config=cfg)
            await db.progression_tasks.insert_one({**t, "level_id": level_id})
        await publish_level(level_id, seeded_by)
        created.append(spec["name"])
    return {"created": created, "existed": existed}


async def ensure_progression_indexes() -> list[str]:
    """Backward-compatible index creation (no data changes)."""
    made = []
    for coll, keys, kw in [
        (db.user_level_progress, [("user_id", 1)], {"unique": True}),
        (db.user_task_progress, [("user_id", 1), ("level_id", 1)], {}),
        (db.user_level_history, [("user_id", 1), ("completed_at", -1)], {}),
        (db.user_reward_grants, [("user_id", 1)], {}),
        (db.progression_events, [("user_id", 1), ("created_at", -1)], {}),
        (db.progression_claims, [("user_id", 1)], {}),
        (db.reputation_transactions, [("user_id", 1), ("created_at", -1)], {}),
        (db.progression_levels, [("name", 1)], {}),
    ]:
        name = await coll.create_index(keys, **kw)
        made.append(f"{coll.name}.{name}")
    return made
