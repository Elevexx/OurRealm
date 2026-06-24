"""Startup tasks: index creation, admin/founder seed, and the one-time
migration that converts username-based friend arrays + message docs to
user_id references (safe for username renames).
"""
import logging
import os
import re
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
    """[REMOVED — Phase H Security Incident, Feb 17 2026]

    Historical: this used to seed `admin@ourrealm.app` with a hardcoded
    password (`admin123` by default) on every boot, granting role="admin".
    That created a publicly-known credential pair, which led to one
    fresh-install report of an unauthorized auto-login.

    NEW BEHAVIOUR — fully neutralised:
      • The auto-seed is permanently disabled (this function is a no-op).
      • Any legacy `admin@ourrealm.app` row already in the DB has its
        password and role wiped so it can never authenticate again.
      • All existing access/refresh sessions for that email are revoked.
      • All administrative power now belongs exclusively to `@stealth`
        (see seed_founder + routes that gate on `username == "stealth"`).

    `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars are no longer read.
    """
    legacy_email = "admin@ourrealm.app"
    legacy = await db.users.find_one({"email": legacy_email})
    if legacy is None:
        return
    # Neutralise the row: unrecoverable random password hash, drop the
    # admin role, drop founder/verified/featured flags, blank the username
    # so it doesn't appear in lookups / discovery / mentions.
    await db.users.update_one(
        {"email": legacy_email},
        {"$set": {
            "password_hash": hash_password(secrets.token_urlsafe(48)),
            "role": "user",
            "is_founder": False,
            "is_verified": False,
            "featured_creator": False,
            "username": None,
            "disabled": True,
            "disabled_reason": "Phase H security incident — legacy admin account neutralised",
            "disabled_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    # Revoke every session that ever issued for this account.
    legacy_id = legacy.get("id")
    revoked_a = await db.refresh_tokens.delete_many({"user_id": legacy_id}) if legacy_id else None
    revoked_b = await db.password_reset_tokens.delete_many({"user_id": legacy_id}) if legacy_id else None
    revoked_c = await db.login_attempts.delete_many({"identifier": legacy_email})
    logger.warning(
        "[security] legacy admin@ourrealm.app neutralised — refresh:%s pwreset:%s login_attempts:%s",
        revoked_a.deleted_count if revoked_a else 0,
        revoked_b.deleted_count if revoked_b else 0,
        revoked_c.deleted_count,
    )


async def seed_founder() -> dict | None:
    """Seeds the Stealth founder profile.

    Behaviour:
      • On FIRST creation (no row in DB yet) — insert the full default
        document including avatar_url, bio, social, widgets, etc.
      • On subsequent boots — refresh ONLY the immutable structural
        fields (role, is_founder, is_verified, featured_creator, email,
        username). User-customizable fields (avatar_url, bio, name,
        widgets, social, mode, interests) are NEVER overwritten so the
        founder can change them via the normal profile UI and have those
        changes persist across pod restarts.
    """
    founder = await db.users.find_one({"email": FOUNDER_EMAIL})
    # Identity / privilege flags that must always match the source of truth.
    immutable_doc = {
        "email": FOUNDER_EMAIL,
        "username": FOUNDER_USERNAME,
        "role": "founder",
        "is_founder": True,
        "is_verified": True,
        "featured_creator": True,
        # Phase α — explicit admin role for the role-based permission system.
        "admin_role": "founder",
    }
    if founder is None:
        # First-time seed only — defaults applied. After this initial
        # insert the user owns these fields and they are NEVER touched
        # by the seed job again.
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "password_hash": hash_password(secrets.token_urlsafe(20)),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "friends": [],
            "friend_requests_in": [],
            "friend_requests_out": [],
            "pinned_threads": [],
            "name": "Stealth",
            "avatar_url": FOUNDER_AVATAR,
            "bio": "OurRealm Founder",
            "mode": "stealth",
            "interests": ["dj", "music", "tech", "festivals"],
            "widgets": FOUNDER_WIDGETS,
            "social": {"tiktok": "stealth.hq", "instagram": "djstealthx"},
            **immutable_doc,
        })
        logger.info(f"Seeded founder: {FOUNDER_EMAIL} @{FOUNDER_USERNAME}")
        founder = await db.users.find_one({"email": FOUNDER_EMAIL})
    else:
        # Refresh ONLY the immutable identity fields. Leave avatar_url,
        # bio, name, widgets, social, mode, interests alone so user edits
        # made via the UI persist across deploys.
        await db.users.update_one(
            {"email": FOUNDER_EMAIL}, {"$set": immutable_doc}
        )
        logger.info(f"Refreshed founder structural fields (avatar/bio preserved): {FOUNDER_EMAIL}")
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
        # Self-heal — Feb 24, 2026: ensure stealth ALWAYS has the
        # full founder widget cluster (Live, Merch, Tracks, Events,
        # Fan Wall, Connect) in his profile. If any of these widget
        # types are missing — for example because a prior test or
        # mistaken PATCH replaced the array — re-append the missing
        # entries WITHOUT removing or reordering existing ones. This
        # is idempotent: when every founder type is already present,
        # nothing changes.
        current = await db.users.find_one({"email": FOUNDER_EMAIL})
        existing = current.get("widgets") or []
        existing_types = {(w or {}).get("type") for w in existing}
        missing = [w for w in FOUNDER_WIDGETS if w.get("type") not in existing_types]
        if missing:
            await db.users.update_one(
                {"email": FOUNDER_EMAIL},
                {"$set": {"widgets": [*existing, *missing]}},
            )
            logger.info(
                f"Self-healed founder widget cluster: re-appended "
                f"{[w.get('type') for w in missing]}"
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
        # Phase α — @support is a Support Admin: tickets + moderation only.
        "admin_role": "support_admin",
        "avatar_url": None,
        # Default profile layout — Top 8 first, My Feed second (matches
        # the new default-order spec). seed_support_account() resets
        # this every boot, so without seeding it correctly the
        # post-startup migrations end up swapping back-and-forth on
        # every restart. Set the canonical order here once and never
        # change it.
        "widgets": [default_top8_widget(), default_myfeed_widget()],
        # Treat @support as already-customised so default-layout
        # migrations never re-touch this row.
        "profile_widgets_customized": True,
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


async def migrate_video_urls_to_relative():
    """One-time fix (Feb 2026 production hotfix): strip the absolute host
    prefix from any post URL pointing at `/api/videos/` or `/api/images/`.

    Posts created in preview were storing
    `https://realm-deploy.preview.emergentagent.com/api/videos/<id>.mp4`,
    which 404s when viewed from production (`ourrealm.social`). Rewriting
    to the bare `/api/videos/<id>.mp4` makes the URL resolve against
    whatever origin the browser is currently on.
    """
    re_strip = re.compile(r"^https?://[^/]+(/api/(?:videos|images)/.+)$")
    fields = ("video_url", "image_url", "media_url")
    fixed = 0
    cursor = db.posts.find(
        {"$or": [{f: {"$regex": "^https?://"}} for f in fields]},
        {"_id": 0, "id": 1, **{f: 1 for f in fields}},
    )
    async for doc in cursor:
        update = {}
        for f in fields:
            v = doc.get(f)
            if not v:
                continue
            m = re_strip.match(v)
            if m:
                update[f] = m.group(1)
        if update:
            await db.posts.update_one({"id": doc["id"]}, {"$set": update})
            fixed += 1
    if fixed:
        logger.info(f"Migrated {fixed} post(s) with absolute video/image URLs → relative")


async def run_startup():
    """Single entry point invoked from `server.on_startup`."""
    await ensure_indexes()
    await seed_admin()
    founder = await seed_founder()
    await seed_support_account()      # Phase B — protected @support account
    await seed_ticket_categories()    # Phase α — default support categories
    await apply_env_admin_promotions() # Phase α — promote moderators via env
    await migrate_friend_graph_to_ids()
    await backfill_founder_as_default_friend(founder)
    await migrate_vip_and_strip_founder_badges(founder)
    await migrate_inject_myfeed_widget()
    await migrate_inject_top8_widget()
    await migrate_reorder_top8_above_myfeed()
    await migrate_strip_deprecated_widgets()
    await migrate_text_posts_to_thoughts()
    await migrate_video_urls_to_relative()
    await migrate_backfill_presence()


# ─────────────────────────────────────────────────────────────────────
# Phase α — Admin Roles & Permissions
# ─────────────────────────────────────────────────────────────────────
async def apply_env_admin_promotions():
    """Read ADMIN_PROMOTE_USERNAMES env (e.g. `alice:moderator,bob:support_admin`)
    and set `admin_role` on matching usernames. Founder role is reserved
    for @stealth and cannot be granted via env. Idempotent.

    Any user whose `admin_role` is set BUT no longer present in the env
    (and isn't @stealth/@support) is demoted back to a regular user so
    deployments can fully revoke moderator privileges without manual DB
    edits. Safety net: never demotes @stealth (founder) or @support.
    """
    from core.permissions import parse_promotions_env
    raw = os.environ.get("ADMIN_PROMOTE_USERNAMES") or ""
    desired = dict(parse_promotions_env(raw))  # {username_lower: role}

    n_promote = 0
    for uname, role in desired.items():
        if uname in {"stealth", "support"}:
            continue
        res = await db.users.update_one(
            {"username": uname},
            {"$set": {"admin_role": role}},
        )
        if res.modified_count:
            n_promote += 1

    # Demote anyone with an admin_role who isn't in the env AND isn't
    # a system account (stealth/support).
    keep = set(desired.keys()) | {"stealth", "support"}
    res = await db.users.update_many(
        {
            "admin_role": {"$exists": True, "$ne": None},
            "username":   {"$nin": list(keep)},
        },
        {"$unset": {"admin_role": ""}},
    )
    if n_promote or res.modified_count:
        logger.info(
            f"[admin-roles] env promotions applied: granted={n_promote} demoted={res.modified_count}"
        )


# ─────────────────────────────────────────────────────────────────────
# Phase α — Support Ticket Categories
# ─────────────────────────────────────────────────────────────────────
DEFAULT_TICKET_CATEGORIES = [
    {"key": "bug_report",      "label": "Bug Report",      "sort_order": 10},
    {"key": "safety_concern",  "label": "Safety Concern",  "sort_order": 20},
    {"key": "account_issue",   "label": "Account Issue",   "sort_order": 30},
    {"key": "feature_request", "label": "Feature Request", "sort_order": 40},
    {"key": "billing",         "label": "Billing",         "sort_order": 50},
    {"key": "general_support", "label": "General Support", "sort_order": 60},
]


async def seed_ticket_categories():
    """Insert each default ticket category if absent. Never overwrites a
    label or sort_order an admin has customised. Idempotent."""
    now = datetime.now(timezone.utc).isoformat()
    n = 0
    for cat in DEFAULT_TICKET_CATEGORIES:
        existing = await db.ticket_categories.find_one({"key": cat["key"]})
        if existing:
            continue
        await db.ticket_categories.insert_one({
            "id":          uuid.uuid4().hex,
            "key":         cat["key"],
            "label":       cat["label"],
            "description": "",
            "sort_order":  cat["sort_order"],
            "is_enabled":  True,
            "is_default":  True,
            "created_at":  now,
            "updated_at":  now,
        })
        n += 1
    if n:
        logger.info(f"[ticket-categories] seeded {n} default categories")


async def migrate_backfill_presence():
    """Phase C — Real-Time Presence System.

    Backfills `presence_status`, `presence_status_choice`, and
    `follower_count` on any pre-existing user that lacks them. Idempotent —
    subsequent boots match 0 docs.
    """
    res = await db.users.update_many(
        {"presence_status": {"$exists": False}},
        {"$set": {"presence_status": "offline"}},
    )
    res2 = await db.users.update_many(
        {"presence_status_choice": {"$exists": False}},
        {"$set": {"presence_status_choice": "online"}},
    )
    # Recompute follower_count from friends array length for all users.
    # Single aggregate-style $set per doc.
    cursor = db.users.find({}, {"_id": 0, "id": 1, "friends": 1, "follower_count": 1})
    updated = 0
    async for u in cursor:
        target = len(u.get("friends") or [])
        if u.get("follower_count") != target:
            await db.users.update_one({"id": u["id"]}, {"$set": {"follower_count": target}})
            updated += 1
    logger.info(
        f"[presence migration] presence_status:{res.modified_count} "
        f"choice:{res2.modified_count} follower_count:{updated}"
    )


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
# STRIP DEPRECATED WIDGETS — Feb 24, 2026. Only the 15 types in
# ALLOWED_WIDGET_TYPES survive. Applies to EVERY user including
# @stealth (the founder cluster previously included `merch` and
# `custom` which are no longer allowed). Order of remaining widgets
# is preserved verbatim. Idempotent.
# ─────────────────────────────────────────────────────────────────────
async def migrate_strip_deprecated_widgets():
    import logging
    from core.widget_types import ALLOWED_WIDGET_TYPES
    from services.widget_hydration import valid_widget_types
    log = logging.getLogger("ourrealm.seed")
    # Registry keys are dynamic — refresh from Mongo before stripping.
    allowed = await valid_widget_types()
    n = 0
    async for u in db.users.find({}, {"_id": 0, "id": 1, "widgets": 1}):
        widgets = u.get("widgets") or []
        cleaned = [
            w for w in widgets
            if isinstance(w, dict) and w.get("type") in allowed
        ]
        if len(cleaned) != len(widgets):
            await db.users.update_one(
                {"id": u["id"]},
                {"$set": {"widgets": cleaned}},
            )
            n += 1
    if n:
        log.info(f"Stripped deprecated widgets from {n} profiles")


# ─────────────────────────────────────────────────────────────────────
# REORDER WIDGETS — Top 8 above My Feed for non-customized profiles
# (Feb 24, 2026). Earlier migrations (`migrate_inject_top8_widget`)
# placed Top 8 right AFTER My Feed; spec now requires Top 8 to be the
# FIRST widget and My Feed second. We only touch users who:
#   • are NOT @stealth (case-insensitive — founder layout is sacred)
#   • have BOTH widgets present
#   • have not flipped `profile_widgets_customized=True` (i.e. they're
#     still using the default order — first-time customisers will set
#     this flag, see routers/profile.py:update_profile).
#
# We preserve every other widget's relative order and all widget sizes.
# ─────────────────────────────────────────────────────────────────────
async def migrate_reorder_top8_above_myfeed():
    import logging
    log = logging.getLogger("ourrealm.seed")
    n = 0
    cursor = db.users.find(
        {
            "username": {"$ne": FOUNDER_USERNAME.lower()},
            # Only users who haven't manually saved a layout.
            "$or": [
                {"profile_widgets_customized": {"$exists": False}},
                {"profile_widgets_customized": False},
            ],
        },
        {"_id": 0, "id": 1, "username": 1, "widgets": 1},
    )
    async for u in cursor:
        widgets = u.get("widgets") or []
        # Locate the first occurrences of each widget type.
        mf_idx = next(
            (i for i, w in enumerate(widgets)
             if (w or {}).get("type") == MYFEED_WIDGET_TYPE),
            None,
        )
        t8_idx = next(
            (i for i, w in enumerate(widgets)
             if (w or {}).get("type") == TOP8_WIDGET_TYPE),
            None,
        )
        if mf_idx is None or t8_idx is None:
            continue
        # Already correctly ordered? (Top 8 strictly before My Feed)
        if t8_idx < mf_idx:
            continue
        # Pull out the two widgets and prepend in the new order; keep
        # all other widgets in their existing relative order behind them.
        t8 = widgets[t8_idx]
        mf = widgets[mf_idx]
        rest = [
            w for i, w in enumerate(widgets)
            if i not in (t8_idx, mf_idx)
        ]
        new_widgets = [t8, mf, *rest]
        await db.users.update_one(
            {"id": u["id"]},
            {"$set": {"widgets": new_widgets}},
        )
        n += 1
    if n:
        log.info(f"Reordered Top 8 above My Feed for {n} non-customized profiles")
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
