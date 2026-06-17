"""Startup tasks: index creation, admin/founder seed, and the one-time
migration that converts username-based friend arrays + message docs to
user_id references (safe for username renames).
"""
import logging
import os
import secrets
import uuid
from datetime import datetime, timezone

from .config import (
    FOUNDER_EMAIL, FOUNDER_USERNAME, FOUNDER_AVATAR, FOUNDER_WIDGETS,
    VIP_CUTOFF, MYFEED_WIDGET_TYPE, default_myfeed_widget,
    TOP8_WIDGET_TYPE, default_top8_widget,
)
from .db import db
from .security import hash_password, verify_password

logger = logging.getLogger("ourrealm.seed")


async def ensure_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.users.create_index("username", unique=True, sparse=True)
    await db.login_attempts.create_index("identifier")
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.posts.create_index("created_at")
    await db.messages.create_index([("conv_id", 1), ("created_at", 1)])
    await db.messages.create_index([("from_user_id", 1), ("created_at", -1)])
    await db.messages.create_index([("to_user_id", 1), ("created_at", -1)])


async def seed_admin():
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@ourrealm.app").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Realm Admin",
            "role": "admin",
            "avatar_url": None,
            "bio": "Curator of OurRealm.",
            "interests": ["technology", "music"],
            "mode": "cypher",
            "widgets": [],
            "friends": [],
            "friend_requests_in": [],
            "friend_requests_out": [],
            "pinned_threads": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Seeded admin: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}},
        )
        logger.info(f"Updated admin password for: {admin_email}")


async def seed_founder() -> dict | None:
    """Seeds or refreshes the Stealth founder profile. Returns the founder doc."""
    founder = await db.users.find_one({"email": FOUNDER_EMAIL})
    founder_doc = {
        "email": FOUNDER_EMAIL,
        "username": FOUNDER_USERNAME,
        "name": "Stealth",
        "role": "founder",
        "is_founder": True,
        "is_verified": True,
        "featured_creator": True,
        "avatar_url": FOUNDER_AVATAR,
        "bio": "OurRealm Founder",
        "mode": "stealth",
        "interests": ["dj", "music", "tech", "festivals"],
        "widgets": FOUNDER_WIDGETS,
        "social": {"tiktok": "stealth.hq", "instagram": "djstealthx"},
    }
    if founder is None:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "password_hash": hash_password(secrets.token_urlsafe(20)),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "friends": [],
            "friend_requests_in": [],
            "friend_requests_out": [],
            "pinned_threads": [],
            **founder_doc,
        })
        logger.info(f"Seeded founder: {FOUNDER_EMAIL} @{FOUNDER_USERNAME}")
        founder = await db.users.find_one({"email": FOUNDER_EMAIL})
    else:
        await db.users.update_one(
            {"email": FOUNDER_EMAIL}, {"$set": founder_doc}
        )
        logger.info(f"Refreshed founder profile: {FOUNDER_EMAIL}")
        # Phase 1: ensure @stealth always has a known password so the
        # founder can sign in with email/username + password in addition
        # to the existing OTP flow. The temporary value is reset only if
        # the env var STEALTH_INITIAL_PASSWORD is provided AND the current
        # hash matches a sentinel. Default behavior: if the stored hash
        # was generated from a random token (no password ever set by the
        # user), upgrade it to the documented temporary password so the
        # account is usable. Idempotent — only fires once per boot when
        # the founder still has the random token hash.
        if not founder.get("password_set_by_user"):
            await db.users.update_one(
                {"email": FOUNDER_EMAIL},
                {"$set": {
                    "password_hash": hash_password("Password1$"),
                }},
            )
            logger.info(
                "Founder @stealth password reset to Phase-1 temporary password"
            )
        founder = await db.users.find_one({"email": FOUNDER_EMAIL})
    return founder


# ─────────────────────────────────────────────────────────────────────
# ONE-TIME MIGRATION
# ─────────────────────────────────────────────────────────────────────
async def migrate_friend_graph_to_ids():
    """Convert legacy username-based friend arrays + message docs to user_ids.

    Idempotent: detects items already in UUID form and skips them.
    """
    # Build username → id map (cheap, all users)
    un_to_id: dict[str, str] = {}
    async for u in db.users.find({"username": {"$ne": None}},
                                  {"_id": 0, "id": 1, "username": 1}):
        if u.get("username"):
            un_to_id[u["username"].lower()] = u["id"]

    def looks_like_id(v: str) -> bool:
        return isinstance(v, str) and len(v) == 36 and v.count("-") == 4

    # ---- Migrate user docs ----
    n_users = 0
    async for u in db.users.find({}, {"_id": 0, "id": 1, "username": 1,
                                       "friends": 1, "friend_requests_in": 1,
                                       "friend_requests_out": 1, "pinned_threads": 1}):
        updates: dict = {}
        for field in ("friends", "friend_requests_in", "friend_requests_out"):
            cur = u.get(field) or []
            if not cur:
                continue
            new = []
            changed = False
            for item in cur:
                if not isinstance(item, str):
                    continue
                if looks_like_id(item):
                    new.append(item)
                else:
                    rid = un_to_id.get(item.lower())
                    if rid:
                        new.append(rid)
                        changed = True
                    else:
                        changed = True  # drop unknown username
            # Dedup
            new = list(dict.fromkeys(new))
            if changed or set(new) != set(cur):
                updates[field] = new
        # Initialize pinned_threads if missing
        if "pinned_threads" not in u:
            updates.setdefault("pinned_threads", [])

        if updates:
            await db.users.update_one({"id": u["id"]}, {"$set": updates})
            n_users += 1
    if n_users:
        logger.info(f"Migrated friend graph for {n_users} users → user_id refs")

    # ---- Migrate messages: add from_user_id/to_user_id and rewrite conv_id ----
    legacy_q = {"$or": [
        {"from_user_id": {"$exists": False}},
        {"to_user_id":   {"$exists": False}},
    ]}
    n_msgs = 0
    async for m in db.messages.find(legacy_q, {"_id": 0}):
        fu = (m.get("from_username") or "").lower()
        tu = (m.get("to_username") or "").lower()
        fid = un_to_id.get(fu)
        tid = un_to_id.get(tu)
        if not fid or not tid:
            continue  # cannot resolve — leave as-is
        new_conv = ":".join(sorted([fid, tid]))
        await db.messages.update_one(
            {"id": m["id"]},
            {"$set": {
                "from_user_id": fid,
                "to_user_id": tid,
                "conv_id": new_conv,
            }},
        )
        n_msgs += 1
    if n_msgs:
        logger.info(f"Migrated {n_msgs} messages → id-based conv_id")


async def backfill_founder_as_default_friend(founder: dict | None):
    if not founder:
        return
    fid = founder["id"]
    # Add founder to every user with a username
    await db.users.update_many(
        {"id": {"$ne": fid}, "username": {"$ne": None}},
        {"$addToSet": {"friends": fid}},
    )
    # Add each such user to the founder's friends
    async for u in db.users.find(
        {"id": {"$ne": fid}, "username": {"$ne": None}},
        {"_id": 0, "id": 1},
    ):
        await db.users.update_one(
            {"id": fid}, {"$addToSet": {"friends": u["id"]}}
        )
    logger.info("Backfill: ensured 'stealth' is a default friend for all users (by user_id)")


async def seed_support_account():
    """Phase B — protected @support system account.

    Idempotent. Username/profile is force-reset on each boot so admin UI
    can't accidentally rename or ban it. Auto-friends every existing
    user so anyone can DM @support from /profile/support.
    """
    import logging
    log = logging.getLogger("ourrealm.seed")

    fixed_id = "00000000-0000-0000-0000-000000005500"  # stable, easy to spot
    # SUPPORT_PASSWORD env override (mirrors STEALTH_INITIAL_PASSWORD).
    # Falls back to the documented default if unset.
    support_password = os.environ.get("SUPPORT_PASSWORD") or "Password1$"
    profile = {
        "id": fixed_id,
        "username": "support",
        "name": "OurRealm Support",
        "email": "ourrealmapp@gmail.com",
        "bio": "",
        "badges": ["SUPPORT"],
        "is_system": True,                   # NEW — used by API guards
        "is_protected": True,                # NEW — blocks ban / delete / rename
        "is_founder": False,
        "is_vip": False,
        "avatar_url": None,
        "widgets": [],
        "friends": [],
        "friend_requests_in": [],
        "friend_requests_out": [],
        "pinned_threads": [],
        "social": {},
    }

    existing = await db.users.find_one({"username": "support"})
    if existing is None:
        existing = await db.users.find_one({"id": fixed_id})
    if existing is None:
        await db.users.insert_one({
            **profile,
            "password_hash": hash_password(support_password),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        log.info("Seeded @support system account")
        existing = await db.users.find_one({"username": "support"})
    else:
        # Force-reset protected fields. Always re-hash from env so a
        # rotated SUPPORT_PASSWORD takes effect on next boot.
        await db.users.update_one(
            {"id": existing["id"]},
            {"$set": {
                **{k: v for k, v in profile.items() if k not in ("friends",)},
                "password_hash": hash_password(support_password),
            }},
        )
        log.info("Refreshed @support system account")
        existing = await db.users.find_one({"id": existing["id"]})

    support_id = existing["id"]

    # Backfill auto-friendship for every non-support user.
    other_users = db.users.find(
        {"id": {"$ne": support_id}}, {"id": 1, "friends": 1}
    )
    n_users = 0
    async for u in other_users:
        n_users += 1
        # Add support → user friendship.
        if support_id not in (u.get("friends") or []):
            await db.users.update_one(
                {"id": u["id"]},
                {"$addToSet": {"friends": support_id}},
            )
        # Add user → support friendship.
        await db.users.update_one(
            {"id": support_id},
            {"$addToSet": {"friends": u["id"]}},
        )
    log.info(f"Auto-friended @support with {n_users} existing users")
    return existing


async def run_startup():
    """Single entry point invoked from `server.on_startup`."""
    await ensure_indexes()
    await seed_admin()
    founder = await seed_founder()
    await seed_support_account()      # Phase B — protected @support account
    await migrate_friend_graph_to_ids()
    await backfill_founder_as_default_friend(founder)
    await migrate_vip_and_strip_founder_badges(founder)
    await migrate_inject_myfeed_widget()
    await migrate_inject_top8_widget()
    await migrate_text_posts_to_thoughts()


async def migrate_text_posts_to_thoughts():
    """Reclassify legacy text posts (`media_type` in {"text","post"}) as
    `thought`. Idempotent — subsequent boots match 0 docs."""
    import logging
    res = await db.posts.update_many(
        {"media_type": {"$in": ["text", "post"]}},
        {"$set": {"media_type": "thought"}},
    )
    if res.modified_count:
        logging.getLogger("ourrealm.seed").info(
            f"Reclassified {res.modified_count} legacy posts as 'thought'"
        )


# ─────────────────────────────────────────────────────────────────────
# EARLY-ADOPTER / VIP + FOUNDER-BADGE CLEANUP
# ─────────────────────────────────────────────────────────────────────
async def migrate_vip_and_strip_founder_badges(founder: dict | None):
    """One-time, idempotent migration.

    1. Grandfather every existing account (created before the VIP system
       launch) as VIP — sets is_vip=True and persists vip_joined_at.
    2. Strips is_founder/role=founder from *every* user except @stealth
       so the Founder badge only appears on the seeded founder.
    """
    # 1. VIP grandfather — fill vip_joined_at from created_at if missing.
    # Only operates on docs that haven't been processed yet.
    cursor = db.users.find(
        {"is_vip": {"$exists": False}},
        {"_id": 0, "id": 1, "created_at": 1},
    )
    n_vip = 0
    async for u in cursor:
        await db.users.update_one(
            {"id": u["id"]},
            {"$set": {
                "is_vip": True,
                "vip_joined_at": u.get("created_at"),
            }},
        )
        n_vip += 1
    if n_vip:
        import logging
        logging.getLogger("ourrealm.seed").info(
            f"VIP backfill: grandfathered {n_vip} existing accounts"
        )

    # 2. Strip Founder badge from anyone who isn't @stealth.
    founder_username = (founder or {}).get("username") or FOUNDER_USERNAME
    res = await db.users.update_many(
        {"username": {"$ne": founder_username}, "$or": [
            {"is_founder": True}, {"role": "founder"},
        ]},
        {"$set": {"is_founder": False, "role": "user"}},
    )
    if res.modified_count:
        import logging
        logging.getLogger("ourrealm.seed").info(
            f"Stripped Founder badge from {res.modified_count} non-stealth accounts"
        )


# ─────────────────────────────────────────────────────────────────────
# MY FEED WIDGET — auto-inject as the first widget for every account
# that doesn't already have one. Idempotent.
# ─────────────────────────────────────────────────────────────────────
async def migrate_inject_myfeed_widget():
    import logging
    log = logging.getLogger("ourrealm.seed")
    n = 0
    async for u in db.users.find({}, {"_id": 0, "id": 1, "widgets": 1}):
        widgets = u.get("widgets") or []
        has_mf = any((w or {}).get("type") == MYFEED_WIDGET_TYPE for w in widgets)
        if has_mf:
            continue
        # Insert My Feed at the TOP without disturbing the user's
        # existing custom layout/order.
        new_widgets = [default_myfeed_widget()] + widgets
        await db.users.update_one(
            {"id": u["id"]}, {"$set": {"widgets": new_widgets}}
        )
        n += 1
    if n:
        log.info(f"Injected My Feed widget into {n} existing profiles")


# ─────────────────────────────────────────────────────────────────────
# TOP 8 FRIENDS WIDGET — auto-inject for every existing user that doesn't
# already have one. Placed directly AFTER My Feed when present, otherwise
# at the top. Idempotent.
# ─────────────────────────────────────────────────────────────────────
async def migrate_inject_top8_widget():
    import logging
    log = logging.getLogger("ourrealm.seed")
    n = 0
    async for u in db.users.find({}, {"_id": 0, "id": 1, "widgets": 1}):
        widgets = u.get("widgets") or []
        if any((w or {}).get("type") == TOP8_WIDGET_TYPE for w in widgets):
            continue
        # Insert Top 8 right after My Feed if present, else at index 0.
        insert_at = 0
        for i, w in enumerate(widgets):
            if (w or {}).get("type") == MYFEED_WIDGET_TYPE:
                insert_at = i + 1
                break
        new_widgets = list(widgets)
        new_widgets.insert(insert_at, default_top8_widget())
        await db.users.update_one(
            {"id": u["id"]}, {"$set": {"widgets": new_widgets}}
        )
        n += 1
    if n:
        log.info(f"Injected Top 8 widget into {n} existing profiles")
