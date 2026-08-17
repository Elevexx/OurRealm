"""Seed default Realms + their main chat into Mongo (Feb 19 2026).

Idempotent — runs on every backend startup. Only inserts the seed
realms when the `realms` collection is empty so existing communities
are never overwritten. Each realm gets a `community_chats` row for
its main "General Chat" so /realm/<id> always has a working chat
on first load.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from core.db import db

log = logging.getLogger("ourrealm.community_seed")

# Mirror of `frontend/src/data/mockData.js::REALMS` — kept here so
# the backend is the source of truth from now on.
_SEED_REALMS = [
    {"id": "dj",        "name": "DJ Realm",       "emoji": "🎧", "members": 18420, "online": 824,
     "banner": "https://images.unsplash.com/photo-1493676304819-0d7a8d026dcf?w=900",
     "description": "For decks, sets, and after-hours.", "accent": "#C26BFF",
     "tags": ["DJ Culture", "House", "Psytrance"]},
    {"id": "gaming",    "name": "Gaming Realm",    "emoji": "🎮", "members": 32140, "online": 1820,
     "banner": "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=900",
     "description": "Squad up, climb ranks, share clips.", "accent": "#10E670",
     "tags": ["Esports", "FPS", "MMO"]},
    {"id": "crypto",    "name": "Crypto Realm",   "emoji": "₿",  "members": 21560, "online": 612,
     "banner": "https://images.unsplash.com/photo-1518972559570-7cc1309f3229?w=900",
     "description": "On-chain culture, alpha, and signals.", "accent": "#F4C84A",
     "tags": ["Crypto", "DeFi", "NFT"]},
    {"id": "festival",  "name": "Festival Realm", "emoji": "✨", "members": 9820,  "online": 312,
     "banner": "https://images.unsplash.com/photo-1493676304819-0d7a8d026dcf?w=900",
     "description": "Lineups, plans, lights, friends found.", "accent": "#FF8AC2",
     "tags": ["Festivals", "Live Music"]},
    {"id": "sports",    "name": "Sports Realm",   "emoji": "🏆", "members": 14380, "online": 540,
     "banner": "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=900",
     "description": "Plays, takes, predictions, fandom.", "accent": "#FF3F5A",
     "tags": ["NBA", "NFL", "Football"]},
    {"id": "tech",      "name": "Tech Realm",      "emoji": "💻", "members": 11020, "online": 388,
     "banner": "https://images.unsplash.com/photo-1488972685288-c3fd157d7c7a?w=900",
     "description": "Builders, indie hackers, and frontier AI.", "accent": "#2EA0FF",
     "tags": ["AI", "Open Source", "Hardware"]},
    {"id": "fashion",   "name": "Fashion Realm",   "emoji": "👗", "members": 7920,  "online": 244,
     "banner": "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900",
     "description": "Drops, fits, runways, vintage finds.", "accent": "#C26BFF",
     "tags": ["Streetwear", "Vintage", "Luxury"]},
    {"id": "creators",  "name": "Creator Realm",   "emoji": "🎬", "members": 28640, "online": 1024,
     "banner": "https://images.unsplash.com/photo-1483721310020-03333e577078?w=900",
     "description": "Tools, tactics, and the new economy.", "accent": "#6BD3FF",
     "tags": ["Creators", "Business", "Growth"]},
]


async def ensure_indexes() -> None:
    try:
        await db.realms.create_index("id", unique=True)
        await db.realms.create_index("slug")
        await db.groups.create_index("id", unique=True)
        await db.groups.create_index("invite_code", unique=True, sparse=True)
        await db.community_memberships.create_index(
            [("community_type", 1), ("community_id", 1), ("user_id", 1)], unique=True,
        )
        await db.community_memberships.create_index([("user_id", 1)])
        await db.community_chats.create_index(
            [("community_type", 1), ("community_id", 1), ("is_main", 1)],
        )
        await db.community_messages.create_index(
            [("chat_id", 1), ("created_at", -1)],
        )
        await db.community_widgets.create_index(
            [("community_type", 1), ("community_id", 1), ("position", 1)],
        )
    except Exception as e:  # noqa: BLE001
        log.warning("community ensure_indexes failed: %s", e)


async def seed_realms() -> None:
    """Insert the mock realm catalogue into Mongo *only* if the
    `realms` collection is empty. Each realm also gets a `General
    Chat` row in `community_chats`."""
    try:
        count = await db.realms.count_documents({})
        if count > 0:
            return
        now = datetime.now(timezone.utc).isoformat()
        for r in _SEED_REALMS:
            doc = {
                **r,
                "slug": r["id"],
                "owner_id": None,                # legacy — no owner yet
                "admin_ids": [],
                "privacy": "public",
                "category": (r.get("tags") or [None])[0],
                "created_at": now,
                "updated_at": now,
                "member_count_estimate": r.get("members", 0),
                "online_count_estimate": r.get("online", 0),
            }
            await db.realms.insert_one(doc)
            chat = {
                "id": uuid.uuid4().hex,
                "community_type": "realm",
                "community_id": r["id"],
                "title": "General Chat",
                "description": None,
                "welcome_message": None,
                "pinned_message_id": None,
                "is_main": True,
                "created_at": now,
                "updated_at": now,
            }
            await db.community_chats.insert_one(chat)
            # Phase 2 — every seeded realm gets a default Poll widget.
            widget = {
                "id": uuid.uuid4().hex,
                "community_type": "realm",
                "community_id":   r["id"],
                "type":           "poll",
                "config": {
                    "question": "What should we do this Friday?",
                    "options": [
                        {"id": uuid.uuid4().hex, "label": "🎮 Game Night"},
                        {"id": uuid.uuid4().hex, "label": "🎬 Movie Watch Party"},
                        {"id": uuid.uuid4().hex, "label": "🎙️ Live Podcast"},
                    ],
                },
                "size": "medium", "pinned": False, "collapsed": False,
                "position": 0, "created_by": None,
                "created_at": now, "updated_at": now,
            }
            await db.community_widgets.insert_one(widget)
        log.info("[community_seed] seeded %d realms + main chats + default polls", len(_SEED_REALMS))
    except Exception as e:  # noqa: BLE001
        log.warning("seed_realms failed: %s", e)
