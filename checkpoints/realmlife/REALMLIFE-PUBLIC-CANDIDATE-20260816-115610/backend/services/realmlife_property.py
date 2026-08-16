"""
RealmLife server-authoritative property + household system.

Core rules
----------
- Every RealmLife account has exactly one housing position:
    * original owner of one property
      OR
    * member of another household.
- Every property and yard is private by default.
- Guests enter only by owner/household invitation or approved request.
- Guest authorization ends when that guest leaves the property.
- Household members may use/upgrade the shared property.
- Only the ORIGINAL property owner may destroy the property.
- Every property Fire Power contribution records the contributor.
- Property destruction returns floor(contributor_total / 2)
  to EACH contributor separately.
- Joining another household surrenders the joining owner's previous
  personal property and refunds that property's contributors at 50%.
"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.db import db


DEFAULT_NEIGHBORHOOD_ID = "realm-residential-1"


def _iso():
    return datetime.now(
        timezone.utc
    ).isoformat()


def _id(prefix):
    return (
        f"{prefix}-"
        f"{uuid.uuid4().hex[:18]}"
    )


async def ensure_indexes():
    # ---------------------------------------------------------
    # PROPERTIES
    # ---------------------------------------------------------

    await db.realmlife_properties.create_index(
        "id",
        unique=True,
    )

    await db.realmlife_properties.create_index(
        [
            ("game_id", 1),
            ("lot_id", 1),
        ],
        unique=True,
    )

    # A user may originally own only ONE property.
    #
    # Released properties have owner_user_id removed entirely,
    # allowing the sparse unique index to ignore them.
    await db.realmlife_properties.create_index(
        [
            ("game_id", 1),
            ("owner_user_id", 1),
        ],
        unique=True,
        sparse=True,
    )

    await db.realmlife_properties.create_index(
        [
            ("game_id", 1),
            ("state", 1),
            ("lot_seq", 1),
        ]
    )


    # ---------------------------------------------------------
    # HOUSEHOLD MEMBERSHIP
    #
    # This unique index is the actual "one housing position"
    # enforcement.
    # ---------------------------------------------------------

    await db.realmlife_household_memberships.create_index(
        [
            ("game_id", 1),
            ("user_id", 1),
        ],
        unique=True,
    )

    await db.realmlife_household_memberships.create_index(
        [
            ("game_id", 1),
            ("household_id", 1),
        ]
    )


    # ---------------------------------------------------------
    # HOUSEHOLD INVITES / REQUESTS
    # ---------------------------------------------------------

    await db.realmlife_household_offers.create_index(
        "id",
        unique=True,
    )

    await db.realmlife_household_offers.create_index(
        [
            ("game_id", 1),
            ("target_user_id", 1),
            ("status", 1),
        ]
    )

    await db.realmlife_household_offers.create_index(
        [
            ("game_id", 1),
            ("household_id", 1),
            ("status", 1),
        ]
    )


    # ---------------------------------------------------------
    # TEMPORARY PROPERTY GUEST ACCESS
    # ---------------------------------------------------------

    await db.realmlife_property_access.create_index(
        [
            ("game_id", 1),
            ("property_id", 1),
            ("user_id", 1),
        ],
        unique=True,
    )


    # ---------------------------------------------------------
    # ENTRY REQUESTS
    # ---------------------------------------------------------

    await db.realmlife_entry_requests.create_index(
        "id",
        unique=True,
    )

    await db.realmlife_entry_requests.create_index(
        [
            ("game_id", 1),
            ("property_id", 1),
            ("status", 1),
        ]
    )


    # ---------------------------------------------------------
    # PROPERTY CONTRIBUTION LEDGER
    # ---------------------------------------------------------

    await db.realmlife_property_contributions.create_index(
        "id",
        unique=True,
    )

    await db.realmlife_property_contributions.create_index(
        "idempotency_key",
        unique=True,
        sparse=True,
    )

    await db.realmlife_property_contributions.create_index(
        [
            ("game_id", 1),
            ("property_id", 1),
            ("contributor_user_id", 1),
            ("created_at", 1),
        ]
    )


async def _membership(
    game_id,
    user_id,
):
    return await (
        db.realmlife_household_memberships
        .find_one(
            {
                "game_id": game_id,
                "user_id": user_id,
            },
            {"_id": 0},
        )
    )


async def _property_by_id(
    game_id,
    property_id,
):
    return await db.realmlife_properties.find_one(
        {
            "game_id": game_id,
            "id": property_id,
        },
        {"_id": 0},
    )


async def _property_by_household(
    game_id,
    household_id,
):
    return await db.realmlife_properties.find_one(
        {
            "game_id": game_id,
            "household_id":
                household_id,
            "state": "owned",
        },
        {"_id": 0},
    )


async def _membership_and_property(
    game_id,
    user_id,
):
    membership = await _membership(
        game_id,
        user_id,
    )

    if not membership:
        return None, None

    prop = await _property_by_id(
        game_id,
        membership.get(
            "property_id"
        ),
    )

    # Crash/recovery safety:
    # remove a membership pointing to an already-released lot.
    if (
        not prop
        or prop.get("state")
        != "owned"
        or prop.get("household_id")
        != membership.get(
            "household_id"
        )
    ):
        await (
            db.realmlife_household_memberships
            .delete_one(
                {
                    "game_id": game_id,
                    "user_id": user_id,
                }
            )
        )

        return None, None

    return membership, prop


async def _new_lot_number(
    game_id,
):
    counter = await (
        db.realmlife_counters
        .find_one_and_update(
            {
                "_id":
                    f"property-lot:"
                    f"{game_id}"
            },
            {
                "$inc": {
                    "seq": 1
                }
            },
            upsert=True,
            return_document=
                ReturnDocument.AFTER,
        )
    )

    return int(
        counter.get("seq") or 1
    )


async def _claim_or_create_property(
    game_id,
    current,
):
    uid = current["id"]
    username = current.get(
        "username"
    )

    household_id = _id(
        "household"
    )

    now = _iso()


    # ---------------------------------------------------------
    # FIRST TRY A RELEASED / EMPTY LOT
    # ---------------------------------------------------------

    try:
        prop = await (
            db.realmlife_properties
            .find_one_and_update(
                {
                    "game_id": game_id,
                    "state":
                        "available",
                },
                {
                    "$set": {
                        "state": "owned",

                        "owner_user_id":
                            uid,

                        "owner_username":
                            username,

                        "original_owner_user_id":
                            uid,

                        "original_owner_username":
                            username,

                        "household_id":
                            household_id,

                        "structure_state":
                            "starter_house",

                        "upgrades": [],

                        "claimed_at":
                            now,

                        "updated_at":
                            now,
                    },
                    "$unset": {
                        "released_at": "",
                        "released_reason": "",
                    },
                },
                sort=[
                    ("lot_seq", 1)
                ],
                return_document=
                    ReturnDocument.AFTER,
            )
        )

    except DuplicateKeyError:
        prop = await (
            db.realmlife_properties
            .find_one(
                {
                    "game_id": game_id,
                    "owner_user_id":
                        uid,
                },
                {"_id": 0},
            )
        )


    # ---------------------------------------------------------
    # NO EMPTY LOT EXISTS YET:
    # CREATE A NEW RESIDENTIAL SLOT
    # ---------------------------------------------------------

    if not prop:
        seq = await _new_lot_number(
            game_id
        )

        property_id = (
            f"property-"
            f"{seq:06d}"
        )

        lot_id = (
            f"residential-lot-"
            f"{seq:06d}"
        )

        doc = {
            "id": property_id,
            "game_id": game_id,

            "lot_id": lot_id,
            "lot_seq": seq,

            "neighborhood_id":
                DEFAULT_NEIGHBORHOOD_ID,

            "state": "owned",

            "property_type":
                "starter",

            "owner_user_id":
                uid,

            "owner_username":
                username,

            "original_owner_user_id":
                uid,

            "original_owner_username":
                username,

            "household_id":
                household_id,

            # World coordinates will be bound later by the
            # streamed residential-world registry.
            "boundary": None,
            "gate": None,
            "outside_spawn": None,

            "structure_state":
                "starter_house",

            "upgrades": [],

            "claimed_at": now,
            "created_at": now,
            "updated_at": now,
        }

        try:
            await (
                db.realmlife_properties
                .insert_one(doc)
            )

            prop = doc

        except DuplicateKeyError:
            prop = await (
                db.realmlife_properties
                .find_one(
                    {
                        "game_id":
                            game_id,

                        "owner_user_id":
                            uid,
                    },
                    {"_id": 0},
                )
            )

            if not prop:
                raise


    # ---------------------------------------------------------
    # OWNER MEMBERSHIP
    # ---------------------------------------------------------

    membership = {
        "game_id": game_id,

        "household_id":
            prop["household_id"],

        "property_id":
            prop["id"],

        "user_id": uid,
        "username": username,

        "role": "owner",

        "joined_at": now,
        "updated_at": now,
    }

    try:
        await (
            db.realmlife_household_memberships
            .insert_one(membership)
        )

    except DuplicateKeyError:
        existing = await _membership(
            game_id,
            uid,
        )

        if (
            not existing
            or existing.get(
                "property_id"
            )
            != prop["id"]
        ):
            # Another concurrent housing call won.
            # Release our accidental claim if necessary.
            await (
                db.realmlife_properties
                .update_one(
                    {
                        "game_id":
                            game_id,

                        "id":
                            prop["id"],

                        "owner_user_id":
                            uid,
                    },
                    {
                        "$set": {
                            "state":
                                "available",

                            "structure_state":
                                "empty",

                            "updated_at":
                                _iso(),
                        },
                        "$unset": {
                            "owner_user_id":
                                "",
                            "owner_username":
                                "",
                            "original_owner_user_id":
                                "",
                            "original_owner_username":
                                "",
                            "household_id":
                                "",
                        },
                    },
                )
            )

            return await ensure_housing(
                game_id,
                current,
            )

    return prop


async def ensure_housing(
    game_id,
    current,
):
    """
    Guarantee the user has exactly one valid housing position.
    """

    await ensure_indexes()

    uid = current["id"]

    membership, prop = (
        await _membership_and_property(
            game_id,
            uid,
        )
    )

    if membership and prop:
        return await housing_status(
            game_id,
            current,
            ensure=False,
        )


    # Repair case: property ownership exists but membership does not.
    owned = await (
        db.realmlife_properties
        .find_one(
            {
                "game_id": game_id,
                "owner_user_id": uid,
                "state": "owned",
            },
            {"_id": 0},
        )
    )

    if owned:
        try:
            await (
                db.realmlife_household_memberships
                .insert_one(
                    {
                        "game_id":
                            game_id,

                        "household_id":
                            owned[
                                "household_id"
                            ],

                        "property_id":
                            owned["id"],

                        "user_id":
                            uid,

                        "username":
                            current.get(
                                "username"
                            ),

                        "role": "owner",

                        "joined_at":
                            _iso(),

                        "updated_at":
                            _iso(),
                    }
                )
            )
        except DuplicateKeyError:
            pass

        return await housing_status(
            game_id,
            current,
            ensure=False,
        )


    await _claim_or_create_property(
        game_id,
        current,
    )

    return await housing_status(
        game_id,
        current,
        ensure=False,
    )


async def housing_status(
    game_id,
    current,
    ensure=True,
):
    if ensure:
        return await ensure_housing(
            game_id,
            current,
        )

    uid = current["id"]

    membership, prop = (
        await _membership_and_property(
            game_id,
            uid,
        )
    )

    if not membership or not prop:
        return {
            "has_housing": False
        }

    members = await (
        db.realmlife_household_memberships
        .find(
            {
                "game_id":
                    game_id,

                "household_id":
                    membership[
                        "household_id"
                    ],
            },
            {
                "_id": 0,
                "user_id": 1,
                "username": 1,
                "role": 1,
                "joined_at": 1,
            },
        )
        .to_list(length=100)
    )

    pending_entries = await (
        db.realmlife_entry_requests
        .count_documents(
            {
                "game_id": game_id,
                "property_id":
                    prop["id"],
                "status": "pending",
            }
        )
    )

    return {
        "has_housing": True,

        "membership": {
            "role":
                membership["role"],

            "household_id":
                membership[
                    "household_id"
                ],

            "can_destroy_property":
                (
                    prop.get(
                        "original_owner_user_id"
                    )
                    == uid
                ),
        },

        "property": {
            "id": prop["id"],

            "lot_id":
                prop.get("lot_id"),

            "neighborhood_id":
                prop.get(
                    "neighborhood_id"
                ),

            "state":
                prop.get("state"),

            "owner_user_id":
                prop.get(
                    "owner_user_id"
                ),

            "owner_username":
                prop.get(
                    "owner_username"
                ),

            "original_owner_user_id":
                prop.get(
                    "original_owner_user_id"
                ),

            "boundary":
                prop.get("boundary"),

            "gate":
                prop.get("gate"),

            "outside_spawn":
                prop.get(
                    "outside_spawn"
                ),
        },

        "members": members,

        "pending_entry_requests":
            pending_entries,
    }


async def _require_household_member(
    game_id,
    user_id,
):
    membership, prop = (
        await _membership_and_property(
            game_id,
            user_id,
        )
    )

    if not membership or not prop:
        raise HTTPException(
            status_code=403,
            detail=(
                "You are not a member "
                "of this household."
            ),
        )

    return membership, prop


# =============================================================
# PROPERTY CONTRIBUTIONS
# =============================================================

async def record_property_contribution(
    game_id,
    current,
    *,
    amount,
    kind,
    source_id=None,
    idempotency_key=None,
):
    """
    Records Fire Power already burned elsewhere.

    This function does NOT debit Fire Power.
    It only attributes an authoritative completed burn
    to the property + contributor.
    """

    await ensure_housing(
        game_id,
        current,
    )

    membership, prop = (
        await _require_household_member(
            game_id,
            current["id"],
        )
    )

    amount = int(amount or 0)

    if amount <= 0:
        return None

    idem = (
        str(idempotency_key or "")
        .strip()[:180]
    )

    if idem:
        idem = (
            f"realmlife:property:"
            f"{game_id}:"
            f"{prop['id']}:"
            f"{current['id']}:"
            f"{idem}"
        )

    doc = {
        "id": _id(
            "propertycontrib"
        ),

        "game_id": game_id,

        "property_id":
            prop["id"],

        "household_id":
            membership[
                "household_id"
            ],

        "contributor_user_id":
            current["id"],

        "contributor_username":
            current.get(
                "username"
            ),

        "kind":
            str(kind or "upgrade")[
                :60
            ],

        "source_id":
            (
                str(source_id)[:160]
                if source_id
                else None
            ),

        "amount_burned":
            amount,

        "status":
            "completed",

        "refunded_50":
            False,

        "created_at":
            _iso(),
    }

    if idem:
        doc[
            "idempotency_key"
        ] = idem

    try:
        await (
            db.realmlife_property_contributions
            .insert_one(doc)
        )

    except DuplicateKeyError:
        if not idem:
            raise

        return await (
            db.realmlife_property_contributions
            .find_one(
                {
                    "idempotency_key":
                        idem
                },
                {"_id": 0},
            )
        )

    return doc


async def _refund_contributors(
    game_id,
    prop,
    reason,
):
    property_id = prop["id"]

    rows = await (
        db.realmlife_property_contributions
        .aggregate(
            [
                {
                    "$match": {
                        "game_id":
                            game_id,

                        "property_id":
                            property_id,

                        "status":
                            "completed",

                        "refunded_50": {
                            "$ne": True
                        },
                    }
                },
                {
                    "$group": {
                        "_id":
                            "$contributor_user_id",

                        "username": {
                            "$last":
                                "$contributor_username"
                        },

                        "total_burned": {
                            "$sum":
                                "$amount_burned"
                        },
                    }
                },
            ]
        )
        .to_list(length=1000)
    )

    results = []

    for row in rows:
        uid = row["_id"]

        total = int(
            row.get(
                "total_burned"
            )
            or 0
        )

        refund = (
            total // 2
        )

        refund_key = (
            f"property-refund:"
            f"{game_id}:"
            f"{property_id}:"
            f"{uid}"
        )

        credited = False

        if refund > 0:
            result = await (
                db.realmlife_accounts
                .update_one(
                    {
                        "game_id":
                            game_id,

                        "user_id":
                            uid,

                        "applied_refund_keys":
                            {
                                "$ne":
                                    refund_key
                            },
                    },
                    {
                        "$inc": {
                            "fire_balance":
                                refund
                        },

                        "$addToSet": {
                            "applied_refund_keys":
                                refund_key
                        },

                        "$set": {
                            "updated_at":
                                _iso()
                        },
                    },
                )
            )

            credited = bool(
                result.modified_count
            )


            # Mirror it in the normal RealmLife Fire ledger.
            await (
                db.realmlife_fire_ledger
                .update_one(
                    {
                        "idempotency_key":
                            (
                                "realmlife:"
                                + refund_key
                            )
                    },
                    {
                        "$setOnInsert": {
                            "id":
                                uuid.uuid4().hex,

                            "game_id":
                                game_id,

                            "user_id":
                                uid,

                            "username":
                                row.get(
                                    "username"
                                ),

                            "kind":
                                "property_destroy_refund",

                            "amount":
                                refund,

                            "status":
                                "completed",

                            "idempotency_key":
                                (
                                    "realmlife:"
                                    + refund_key
                                ),

                            "created_at":
                                _iso(),

                            "meta": {
                                "property_id":
                                    property_id,

                                "reason":
                                    reason,

                                "contributor_total_burned":
                                    total,

                                "refund_percent":
                                    50,
                            },
                        }
                    },
                    upsert=True,
                )
            )


        await (
            db.realmlife_property_contributions
            .update_many(
                {
                    "game_id":
                        game_id,

                    "property_id":
                        property_id,

                    "contributor_user_id":
                        uid,

                    "status":
                        "completed",

                    "refunded_50": {
                        "$ne": True
                    },
                },
                {
                    "$set": {
                        "refunded_50":
                            True,

                        "refund_amount_total":
                            refund,

                        "refund_reason":
                            reason,

                        "refunded_at":
                            _iso(),
                    }
                },
            )
        )

        results.append(
            {
                "user_id": uid,

                "username":
                    row.get(
                        "username"
                    ),

                "total_burned":
                    total,

                "refund":
                    refund,

                "credited_now":
                    credited,
            }
        )

    return results


async def _release_property(
    game_id,
    prop,
    reason,
):
    """
    Refund contributors, destroy structure/upgrades,
    invalidate access, release lot and dissolve household.
    """

    household_id = prop.get(
        "household_id"
    )

    members = await (
        db.realmlife_household_memberships
        .find(
            {
                "game_id":
                    game_id,

                "household_id":
                    household_id,
            },
            {"_id": 0},
        )
        .to_list(length=100)
    )

    refunds = await _refund_contributors(
        game_id,
        prop,
        reason,
    )


    # Guest permissions are invalid immediately.
    await (
        db.realmlife_property_access
        .update_many(
            {
                "game_id":
                    game_id,

                "property_id":
                    prop["id"],

                "status":
                    "active",
            },
            {
                "$set": {
                    "status":
                        "property_destroyed",

                    "ended_at":
                        _iso(),
                }
            },
        )
    )


    # Release the physical lot.
    await (
        db.realmlife_properties
        .update_one(
            {
                "game_id":
                    game_id,

                "id":
                    prop["id"],

                "state":
                    "owned",
            },
            {
                "$set": {
                    "state":
                        "available",

                    "structure_state":
                        "empty",

                    "upgrades": [],

                    "released_at":
                        _iso(),

                    "released_reason":
                        reason,

                    "updated_at":
                        _iso(),
                },

                "$unset": {
                    "owner_user_id":
                        "",

                    "owner_username":
                        "",

                    "original_owner_user_id":
                        "",

                    "original_owner_username":
                        "",

                    "household_id":
                        "",
                },
            },
        )
    )


    # Dissolve household after the property itself is released.
    await (
        db.realmlife_household_memberships
        .delete_many(
            {
                "game_id":
                    game_id,

                "household_id":
                    household_id,
            }
        )
    )

    return {
        "members": members,
        "refunds": refunds,
    }


# =============================================================
# HOUSEHOLD JOINING
# =============================================================

async def _join_household(
    game_id,
    current,
    target_household_id,
):
    uid = current["id"]

    target_prop = (
        await _property_by_household(
            game_id,
            target_household_id,
        )
    )

    if not target_prop:
        raise HTTPException(
            status_code=404,
            detail=(
                "Household property "
                "is not available."
            ),
        )

    current_membership, current_prop = (
        await _membership_and_property(
            game_id,
            uid,
        )
    )

    if (
        current_membership
        and current_membership.get(
            "household_id"
        )
        == target_household_id
    ):
        return await housing_status(
            game_id,
            current,
        )


    # ---------------------------------------------------------
    # IF THE JOINER CURRENTLY OWNS A PROPERTY:
    # DESTROY/SURRENDER IT AND RETURN 50% TO CONTRIBUTORS.
    # ---------------------------------------------------------

    if (
        current_membership
        and current_membership.get(
            "role"
        )
        == "owner"
        and current_prop
    ):
        old_household_id = (
            current_membership[
                "household_id"
            ]
        )

        member_count = await (
            db.realmlife_household_memberships
            .count_documents(
                {
                    "game_id":
                        game_id,

                    "household_id":
                        old_household_id,
                }
            )
        )

        # Prevent silently destroying a house underneath
        # other current household members.
        if member_count > 1:
            raise HTTPException(
                status_code=409,
                detail=(
                    "You currently own a household "
                    "with other members. Destroy or "
                    "resolve that household before "
                    "joining another."
                ),
            )

        await _release_property(
            game_id,
            current_prop,
            "joined_another_household",
        )


    # ---------------------------------------------------------
    # CURRENT MEMBER OF SOMEONE ELSE'S HOUSE:
    # LEAVING DOES NOT REFUND THEIR CONTRIBUTIONS.
    #
    # Their ledger stays attached to the old property, so they
    # still receive their 50% later if the owner destroys it.
    # ---------------------------------------------------------

    elif current_membership:
        await (
            db.realmlife_household_memberships
            .delete_one(
                {
                    "game_id":
                        game_id,

                    "user_id":
                        uid,
                }
            )
        )


    try:
        await (
            db.realmlife_household_memberships
            .insert_one(
                {
                    "game_id":
                        game_id,

                    "household_id":
                        target_household_id,

                    "property_id":
                        target_prop[
                            "id"
                        ],

                    "user_id":
                        uid,

                    "username":
                        current.get(
                            "username"
                        ),

                    "role":
                        "member",

                    "joined_at":
                        _iso(),

                    "updated_at":
                        _iso(),
                }
            )
        )

    except DuplicateKeyError:
        membership = await _membership(
            game_id,
            uid,
        )

        if (
            not membership
            or membership.get(
                "household_id"
            )
            != target_household_id
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "You already have "
                    "another housing position."
                ),
            )

    return await housing_status(
        game_id,
        current,
    )


async def create_household_invite(
    game_id,
    current,
    target_user_id,
):
    await ensure_housing(
        game_id,
        current,
    )

    membership, prop = (
        await _require_household_member(
            game_id,
            current["id"],
        )
    )

    target_user_id = str(
        target_user_id or ""
    ).strip()[:80]

    if (
        not target_user_id
        or target_user_id
        == current["id"]
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid household invite.",
        )

    target = await db.users.find_one(
        {"id": target_user_id},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
        },
    )

    if not target:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    target_membership = await _membership(
        game_id,
        target_user_id,
    )

    if (
        target_membership
        and target_membership.get(
            "household_id"
        )
        == membership[
            "household_id"
        ]
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "That user is already "
                "in this household."
            ),
        )

    existing = await (
        db.realmlife_household_offers
        .find_one(
            {
                "game_id":
                    game_id,

                "kind":
                    "invite",

                "household_id":
                    membership[
                        "household_id"
                    ],

                "target_user_id":
                    target_user_id,

                "status":
                    "pending",
            },
            {"_id": 0},
        )
    )

    if existing:
        return existing

    doc = {
        "id": _id(
            "householdinvite"
        ),

        "game_id": game_id,

        "kind": "invite",

        "household_id":
            membership[
                "household_id"
            ],

        "property_id":
            prop["id"],

        "created_by_user_id":
            current["id"],

        "created_by_username":
            current.get(
                "username"
            ),

        "target_user_id":
            target_user_id,

        "target_username":
            target.get(
                "username"
            ),

        "status":
            "pending",

        "created_at":
            _iso(),
    }

    await (
        db.realmlife_household_offers
        .insert_one(doc)
    )

    return doc


async def request_household_join(
    game_id,
    current,
    property_id,
):
    await ensure_housing(
        game_id,
        current,
    )

    prop = await _property_by_id(
        game_id,
        str(property_id or "")[:100],
    )

    if (
        not prop
        or prop.get("state")
        != "owned"
    ):
        raise HTTPException(
            status_code=404,
            detail="Property not found.",
        )

    membership = await _membership(
        game_id,
        current["id"],
    )

    if (
        membership
        and membership.get(
            "household_id"
        )
        == prop.get(
            "household_id"
        )
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "You already belong "
                "to this household."
            ),
        )

    existing = await (
        db.realmlife_household_offers
        .find_one(
            {
                "game_id":
                    game_id,

                "kind":
                    "request",

                "household_id":
                    prop[
                        "household_id"
                    ],

                "target_user_id":
                    current["id"],

                "status":
                    "pending",
            },
            {"_id": 0},
        )
    )

    if existing:
        return existing

    doc = {
        "id": _id(
            "householdrequest"
        ),

        "game_id": game_id,

        "kind": "request",

        "household_id":
            prop["household_id"],

        "property_id":
            prop["id"],

        "created_by_user_id":
            current["id"],

        "created_by_username":
            current.get(
                "username"
            ),

        # For both kinds, target_user_id identifies the
        # player whose housing position changes.
        "target_user_id":
            current["id"],

        "target_username":
            current.get(
                "username"
            ),

        "status":
            "pending",

        "created_at":
            _iso(),
    }

    await (
        db.realmlife_household_offers
        .insert_one(doc)
    )

    return doc


async def accept_household_invite(
    game_id,
    current,
    offer_id,
):
    offer = await (
        db.realmlife_household_offers
        .find_one(
            {
                "id":
                    str(
                        offer_id or ""
                    )[:100],

                "game_id":
                    game_id,

                "kind":
                    "invite",
            },
            {"_id": 0},
        )
    )

    if not offer:
        raise HTTPException(
            status_code=404,
            detail="Invite not found.",
        )

    if (
        offer.get(
            "target_user_id"
        )
        != current["id"]
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "This household invite "
                "belongs to another user."
            ),
        )

    if offer.get("status") == "accepted":
        return await housing_status(
            game_id,
            current,
        )

    if offer.get("status") != "pending":
        raise HTTPException(
            status_code=409,
            detail=(
                "This invite is no longer pending."
            ),
        )

    result = await _join_household(
        game_id,
        current,
        offer[
            "household_id"
        ],
    )

    await (
        db.realmlife_household_offers
        .update_one(
            {"id": offer["id"]},
            {
                "$set": {
                    "status":
                        "accepted",

                    "resolved_at":
                        _iso(),

                    "resolved_by_user_id":
                        current["id"],
                }
            },
        )
    )

    return result


async def approve_household_request(
    game_id,
    current,
    offer_id,
):
    offer = await (
        db.realmlife_household_offers
        .find_one(
            {
                "id":
                    str(
                        offer_id or ""
                    )[:100],

                "game_id":
                    game_id,

                "kind":
                    "request",
            },
            {"_id": 0},
        )
    )

    if not offer:
        raise HTTPException(
            status_code=404,
            detail="Request not found.",
        )

    membership, _ = (
        await _require_household_member(
            game_id,
            current["id"],
        )
    )

    if (
        membership[
            "household_id"
        ]
        != offer[
            "household_id"
        ]
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "You cannot approve requests "
                "for another household."
            ),
        )

    if offer.get("status") != "pending":
        raise HTTPException(
            status_code=409,
            detail=(
                "This request is no longer pending."
            ),
        )

    target = await db.users.find_one(
        {
            "id":
                offer[
                    "target_user_id"
                ]
        },
        {
            "_id": 0,
            "id": 1,
            "username": 1,
        },
    )

    if not target:
        raise HTTPException(
            status_code=404,
            detail="Requesting user not found.",
        )

    result = await _join_household(
        game_id,
        target,
        offer[
            "household_id"
        ],
    )

    await (
        db.realmlife_household_offers
        .update_one(
            {"id": offer["id"]},
            {
                "$set": {
                    "status":
                        "approved",

                    "resolved_at":
                        _iso(),

                    "resolved_by_user_id":
                        current["id"],
                }
            },
        )
    )

    return result


async def decline_household_offer(
    game_id,
    current,
    offer_id,
):
    offer = await (
        db.realmlife_household_offers
        .find_one(
            {
                "id":
                    str(
                        offer_id or ""
                    )[:100],

                "game_id":
                    game_id,
            },
            {"_id": 0},
        )
    )

    if not offer:
        raise HTTPException(
            status_code=404,
            detail="Household offer not found.",
        )

    allowed = False

    if (
        offer.get("kind")
        == "invite"
    ):
        allowed = (
            offer.get(
                "target_user_id"
            )
            == current["id"]
        )

    elif (
        offer.get("kind")
        == "request"
    ):
        membership = await _membership(
            game_id,
            current["id"],
        )

        allowed = bool(
            membership
            and membership.get(
                "household_id"
            )
            == offer.get(
                "household_id"
            )
        )

    if not allowed:
        raise HTTPException(
            status_code=403,
            detail=(
                "You cannot resolve "
                "this household offer."
            ),
        )

    await (
        db.realmlife_household_offers
        .update_one(
            {
                "id": offer["id"],
                "status": "pending",
            },
            {
                "$set": {
                    "status":
                        "declined",

                    "resolved_at":
                        _iso(),

                    "resolved_by_user_id":
                        current["id"],
                }
            },
        )
    )

    return {"ok": True}


async def leave_household(
    game_id,
    current,
):
    membership, prop = (
        await _require_household_member(
            game_id,
            current["id"],
        )
    )

    if (
        membership.get("role")
        == "owner"
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "The original property owner "
                "cannot use Leave Household. "
                "Use Destroy Property or join "
                "another household."
            ),
        )

    # Contributions remain on the property ledger.
    await (
        db.realmlife_household_memberships
        .delete_one(
            {
                "game_id": game_id,
                "user_id":
                    current["id"],
            }
        )
    )

    return await ensure_housing(
        game_id,
        current,
    )


# =============================================================
# TEMPORARY GUEST PROPERTY ACCESS
# =============================================================

async def property_access_check(
    game_id,
    current,
    property_id,
):
    prop = await _property_by_id(
        game_id,
        str(property_id or "")[:100],
    )

    if (
        not prop
        or prop.get("state")
        != "owned"
    ):
        return {
            "allowed": False,
            "reason":
                "property_unavailable",
        }

    membership = await _membership(
        game_id,
        current["id"],
    )

    if (
        membership
        and membership.get(
            "household_id"
        )
        == prop.get(
            "household_id"
        )
    ):
        return {
            "allowed": True,
            "reason":
                membership.get(
                    "role"
                )
                or "household_member",

            "property_id":
                prop["id"],
        }

    access = await (
        db.realmlife_property_access
        .find_one(
            {
                "game_id":
                    game_id,

                "property_id":
                    prop["id"],

                "user_id":
                    current["id"],

                "status":
                    "active",
            },
            {"_id": 0},
        )
    )

    return {
        "allowed":
            bool(access),

        "reason":
            (
                "temporary_guest"
                if access
                else "private_property"
            ),

        "property_id":
            prop["id"],
    }


async def invite_guest(
    game_id,
    current,
    target_user_id,
):
    membership, prop = (
        await _require_household_member(
            game_id,
            current["id"],
        )
    )

    target_user_id = str(
        target_user_id or ""
    ).strip()[:80]

    if (
        not target_user_id
        or target_user_id
        == current["id"]
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid guest.",
        )

    target_membership = await _membership(
        game_id,
        target_user_id,
    )

    if (
        target_membership
        and target_membership.get(
            "household_id"
        )
        == membership.get(
            "household_id"
        )
    ):
        return {
            "ok": True,
            "already_household_member":
                True,
        }

    target = await db.users.find_one(
        {"id": target_user_id},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
        },
    )

    if not target:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    now = _iso()

    await (
        db.realmlife_property_access
        .update_one(
            {
                "game_id":
                    game_id,

                "property_id":
                    prop["id"],

                "user_id":
                    target_user_id,
            },
            {
                "$set": {
                    "username":
                        target.get(
                            "username"
                        ),

                    "household_id":
                        membership[
                            "household_id"
                        ],

                    "status":
                        "active",

                    "source":
                        "invited",

                    "authorized_by_user_id":
                        current["id"],

                    "authorized_by_username":
                        current.get(
                            "username"
                        ),

                    "authorized_at":
                        now,

                    "entered":
                        False,

                    "updated_at":
                        now,
                },

                "$setOnInsert": {
                    "created_at":
                        now
                },
            },
            upsert=True,
        )
    )

    return {
        "ok": True,
        "property_id":
            prop["id"],

        "guest_user_id":
            target_user_id,
    }


async def request_property_entry(
    game_id,
    current,
    property_id,
):
    prop = await _property_by_id(
        game_id,
        str(property_id or "")[:100],
    )

    if (
        not prop
        or prop.get("state")
        != "owned"
    ):
        raise HTTPException(
            status_code=404,
            detail="Property not found.",
        )

    check = await property_access_check(
        game_id,
        current,
        prop["id"],
    )

    if check["allowed"]:
        return {
            "ok": True,
            "already_allowed":
                True,
        }

    existing = await (
        db.realmlife_entry_requests
        .find_one(
            {
                "game_id":
                    game_id,

                "property_id":
                    prop["id"],

                "requester_user_id":
                    current["id"],

                "status":
                    "pending",
            },
            {"_id": 0},
        )
    )

    if existing:
        return existing

    doc = {
        "id": _id(
            "entryrequest"
        ),

        "game_id":
            game_id,

        "property_id":
            prop["id"],

        "household_id":
            prop[
                "household_id"
            ],

        "requester_user_id":
            current["id"],

        "requester_username":
            current.get(
                "username"
            ),

        "status":
            "pending",

        "created_at":
            _iso(),
    }

    await (
        db.realmlife_entry_requests
        .insert_one(doc)
    )

    return doc


async def resolve_entry_request(
    game_id,
    current,
    request_id,
    approve,
):
    request = await (
        db.realmlife_entry_requests
        .find_one(
            {
                "id":
                    str(
                        request_id or ""
                    )[:100],

                "game_id":
                    game_id,
            },
            {"_id": 0},
        )
    )

    if not request:
        raise HTTPException(
            status_code=404,
            detail="Entry request not found.",
        )

    membership, prop = (
        await _require_household_member(
            game_id,
            current["id"],
        )
    )

    if (
        membership.get(
            "household_id"
        )
        != request.get(
            "household_id"
        )
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "You cannot resolve "
                "this property's request."
            ),
        )

    if request.get("status") != "pending":
        raise HTTPException(
            status_code=409,
            detail=(
                "Entry request is no "
                "longer pending."
            ),
        )

    now = _iso()

    if approve:
        target = await db.users.find_one(
            {
                "id":
                    request[
                        "requester_user_id"
                    ]
            },
            {
                "_id": 0,
                "username": 1,
            },
        ) or {}

        await (
            db.realmlife_property_access
            .update_one(
                {
                    "game_id":
                        game_id,

                    "property_id":
                        prop["id"],

                    "user_id":
                        request[
                            "requester_user_id"
                        ],
                },
                {
                    "$set": {
                        "username":
                            target.get(
                                "username"
                            ),

                        "household_id":
                            membership[
                                "household_id"
                            ],

                        "status":
                            "active",

                        "source":
                            "approved_request",

                        "authorized_by_user_id":
                            current["id"],

                        "authorized_at":
                            now,

                        "entered":
                            False,

                        "updated_at":
                            now,
                    },

                    "$setOnInsert": {
                        "created_at":
                            now
                    },
                },
                upsert=True,
            )
        )

    await (
        db.realmlife_entry_requests
        .update_one(
            {"id": request["id"]},
            {
                "$set": {
                    "status":
                        (
                            "approved"
                            if approve
                            else "declined"
                        ),

                    "resolved_at":
                        now,

                    "resolved_by_user_id":
                        current["id"],
                }
            },
        )
    )

    return {
        "ok": True,
        "approved":
            bool(approve),
    }


async def leave_property(
    game_id,
    current,
    property_id,
):
    """
    Called when a guest physically crosses out of the
    property boundary.

    Their temporary authorization ends immediately.
    """

    await (
        db.realmlife_property_access
        .update_one(
            {
                "game_id":
                    game_id,

                "property_id":
                    str(
                        property_id or ""
                    )[:100],

                "user_id":
                    current["id"],

                "status":
                    "active",
            },
            {
                "$set": {
                    "status":
                        "left",

                    "ended_at":
                        _iso(),

                    "updated_at":
                        _iso(),
                }
            },
        )
    )

    return {
        "ok": True,
        "access_ended": True,
    }


async def evict_guest(
    game_id,
    current,
    target_user_id,
):
    membership, prop = (
        await _require_household_member(
            game_id,
            current["id"],
        )
    )

    target_user_id = str(
        target_user_id or ""
    ).strip()[:80]

    target_membership = await _membership(
        game_id,
        target_user_id,
    )

    # Household members are not temporary guests.
    if (
        target_membership
        and target_membership.get(
            "household_id"
        )
        == membership.get(
            "household_id"
        )
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "A household member cannot "
                "be evicted as a guest."
            ),
        )

    await (
        db.realmlife_property_access
        .update_one(
            {
                "game_id":
                    game_id,

                "property_id":
                    prop["id"],

                "user_id":
                    target_user_id,

                "status":
                    "active",
            },
            {
                "$set": {
                    "status":
                        "evicted",

                    "ended_at":
                        _iso(),

                    "evicted_by_user_id":
                        current["id"],

                    "updated_at":
                        _iso(),
                }
            },
        )
    )

    return {
        "ok": True,

        "evicted_user_id":
            target_user_id,

        "property_id":
            prop["id"],

        "outside_spawn":
            prop.get(
                "outside_spawn"
            ),

        "message":
            "You have been evicted.",
    }


# =============================================================
# OWNER-ONLY PROPERTY DESTRUCTION
# =============================================================

async def destroy_property(
    game_id,
    current,
    confirmation,
):
    membership, prop = (
        await _require_household_member(
            game_id,
            current["id"],
        )
    )

    if (
        prop.get(
            "original_owner_user_id"
        )
        != current["id"]
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Only the original property "
                "owner can destroy this property."
            ),
        )

    if (
        str(confirmation or "")
        .strip()
        .upper()
        != "DESTROY PROPERTY"
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Confirmation must be "
                "'DESTROY PROPERTY'."
            ),
        )

    released = await _release_property(
        game_id,
        prop,
        "owner_destroyed_property",
    )

    # Property destruction dissolves this household.
    # Every current member receives a fresh personal housing slot.
    rehoused = []

    for member in released[
        "members"
    ]:
        result = await ensure_housing(
            game_id,
            {
                "id":
                    member["user_id"],

                "username":
                    member.get(
                        "username"
                    ),
            },
        )

        rehoused.append(
            {
                "user_id":
                    member[
                        "user_id"
                    ],

                "housing":
                    result,
            }
        )

    return {
        "ok": True,

        "destroyed_property_id":
            prop["id"],

        "released_lot_id":
            prop.get(
                "lot_id"
            ),

        "refunds":
            released[
                "refunds"
            ],

        "rehoused":
            rehoused,
    }


# =============================================================
# PROPERTY / HOUSEHOLD INBOX
# =============================================================

async def property_inbox(
    game_id,
    current,
):
    """
    Pending RealmLife housing actions visible to this user.

    Returns:
    - household invitations addressed to this user
    - household join requests for this user's household
    - property entry requests for this user's property
    """

    await ensure_housing(
        game_id,
        current,
    )

    membership, prop = (
        await _require_household_member(
            game_id,
            current["id"],
        )
    )

    household_invites = await (
        db.realmlife_household_offers
        .find(
            {
                "game_id": game_id,

                "kind":
                    "invite",

                "target_user_id":
                    current["id"],

                "status":
                    "pending",
            },
            {"_id": 0},
        )
        .sort(
            "created_at",
            -1
        )
        .to_list(
            length=100
        )
    )

    household_requests = await (
        db.realmlife_household_offers
        .find(
            {
                "game_id":
                    game_id,

                "kind":
                    "request",

                "household_id":
                    membership[
                        "household_id"
                    ],

                "status":
                    "pending",
            },
            {"_id": 0},
        )
        .sort(
            "created_at",
            -1
        )
        .to_list(
            length=100
        )
    )

    entry_requests = await (
        db.realmlife_entry_requests
        .find(
            {
                "game_id":
                    game_id,

                "property_id":
                    prop["id"],

                "status":
                    "pending",
            },
            {"_id": 0},
        )
        .sort(
            "created_at",
            -1
        )
        .to_list(
            length=100
        )
    )

    return {
        "property_id":
            prop["id"],

        "household_id":
            membership[
                "household_id"
            ],

        "household_invites":
            household_invites,

        "household_requests":
            household_requests,

        "entry_requests":
            entry_requests,

        "pending_total":
            (
                len(
                    household_invites
                )
                +
                len(
                    household_requests
                )
                +
                len(
                    entry_requests
                )
            ),
    }
