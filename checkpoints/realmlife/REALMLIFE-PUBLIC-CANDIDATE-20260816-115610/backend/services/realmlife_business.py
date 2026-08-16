"""
RealmLife V6C1 Business Ownership

Rules:
- Business/open lot unlock = burn 🔥10,000 RealmLife Fire.
- Normal user maximum = ONE owned business across RealmLife.
- Stealth Founder = unlimited businesses.
- Businesses are public by default.
- Destroying/releasing a business reopens the slot.
- Current ownership-cycle contributions restore 50% when destroyed.
- Future city clones reuse this registry.
"""

import uuid

from datetime import (
    datetime,
    timezone,
)

from fastapi import HTTPException

from pymongo import ReturnDocument

from pymongo.errors import (
    DuplicateKeyError,
)

from core.db import db

from services import (
    realmlife_economy as rle,
)


BUSINESS_UNLOCK_COST = 10_000


DEFAULT_BUSINESS_SLOTS = [
    (
        "main-market",
        "Realm Market",
        "market",
    ),

    (
        "sunrise-cafe",
        "Sunrise Café",
        "cafe",
    ),

    (
        "city-outfitters",
        "City Outfitters",
        "fashion",
    ),

    (
        "plaza-restaurant",
        "Plaza Restaurant",
        "restaurant",
    ),

    (
        "fresh-grocery",
        "Fresh Market Grocery",
        "grocery",
    ),

    (
        "night-lounge",
        "Night Lounge",
        "nightclub",
    ),

    (
        "river-grill",
        "River Grill",
        "restaurant",
    ),

    (
        "pulse-club",
        "Pulse Club",
        "nightclub",
    ),

    (
        "river-hotel",
        "River Hotel",
        "hotel",
    ),

    (
        "central-offices",
        "Central Offices",
        "office",
    ),

    (
        "wellness-studio",
        "Realm Wellness",
        "wellness",
    ),

    (
        "realm-arcade",
        "Realm Arcade",
        "entertainment",
    ),

    (
        "artisan-bakery",
        "Artisan Bakery",
        "bakery",
    ),

    (
        "tech-market",
        "Realm Tech",
        "technology",
    ),

    (
        "furniture-gallery",
        "Home Gallery",
        "furniture",
    ),

    (
        "cinema-club",
        "Realm Cinema",
        "cinema",
    ),
]


def _iso():
    return (
        datetime.now(
            timezone.utc
        )
        .isoformat()
    )


def _is_founder(
    current,
):
    return bool(
        current.get(
            "is_founder"
        )
        or
        str(
            current.get(
                "role"
            )
            or ""
        ).lower()
        ==
        "founder"
        or
        str(
            current.get(
                "username"
            )
            or ""
        ).lower()
        ==
        "stealth"
    )


async def ensure_indexes():

    await (
        db.realmlife_businesses
        .create_index(
            [
                (
                    "game_id",
                    1,
                ),

                (
                    "city_id",
                    1,
                ),

                (
                    "id",
                    1,
                ),
            ],
            unique=True,
        )
    )

    await (
        db.realmlife_businesses
        .create_index(
            [
                (
                    "game_id",
                    1,
                ),

                (
                    "owner_user_id",
                    1,
                ),

                (
                    "status",
                    1,
                ),
            ]
        )
    )

    await (
        db.realmlife_business_contributions
        .create_index(
            "id",
            unique=True,
        )
    )

    await (
        db.realmlife_business_contributions
        .create_index(
            [
                (
                    "game_id",
                    1,
                ),

                (
                    "city_id",
                    1,
                ),

                (
                    "business_id",
                    1,
                ),

                (
                    "ownership_epoch",
                    1,
                ),
            ]
        )
    )


async def ensure_city_businesses(
    game_id,
    city_id,
):
    await ensure_indexes()

    city_id = str(
        city_id
        or "city-001"
    )[:40]

    for (
        business_id,
        label,
        business_type,
    ) in DEFAULT_BUSINESS_SLOTS:

        await (
            db.realmlife_businesses
            .update_one(
                {
                    "game_id":
                        game_id,

                    "city_id":
                        city_id,

                    "id":
                        business_id,
                },
                {
                    "$setOnInsert": {
                        "game_id":
                            game_id,

                        "city_id":
                            city_id,

                        "id":
                            business_id,

                        "label":
                            label,

                        "business_type":
                            business_type,

                        "status":
                            "available",

                        "visibility":
                            "public",

                        "owner_user_id":
                            None,

                        "owner_username":
                            None,

                        "ownership_epoch":
                            0,

                        "fire_burned_total":
                            0,

                        "upgrades":
                            [],

                        "seeded":
                            True,

                        "created_at":
                            _iso(),

                        "updated_at":
                            _iso(),
                    }
                },
                upsert=True,
            )
        )


async def list_businesses(
    game_id,
    current,
    city_id="city-001",
):
    city_id = str(
        city_id
        or "city-001"
    )[:40]

    city = await (
        db.realmlife_cities
        .find_one(
            {
                "game_id":
                    game_id,

                "city_id":
                    city_id,
            },
            {
                "_id": 0
            },
        )
    )

    if not city:
        raise HTTPException(
            status_code=404,
            detail="RealmLife city not found.",
        )

    await ensure_city_businesses(
        game_id,
        city_id,
    )

    businesses = await (
        db.realmlife_businesses
        .find(
            {
                "game_id":
                    game_id,

                "city_id":
                    city_id,
            },
            {
                "_id": 0
            },
        )
        .sort(
            "label",
            1,
        )
        .to_list(
            length=500
        )
    )

    mine = await (
        db.realmlife_businesses
        .find(
            {
                "game_id":
                    game_id,

                "owner_user_id":
                    current["id"],

                "status":
                    "owned",
            },
            {
                "_id": 0
            },
        )
        .sort(
            "city_id",
            1,
        )
        .to_list(
            length=500
        )
    )

    founder = _is_founder(
        current
    )

    return {
        "ok": True,

        "city_id":
            city_id,

        "business_unlock_fire":
            BUSINESS_UNLOCK_COST,

        "normal_business_limit":
            1,

        "founder_unlimited":
            founder,

        "businesses":
            businesses,

        "my_businesses":
            mine,

        "can_claim_another":
            (
                founder
                or
                len(mine)
                == 0
            ),
    }


async def claim_business(
    game_id,
    current,
    business_id,
    *,
    city_id="city-001",
    idempotency_key=None,
):
    await ensure_city_businesses(
        game_id,
        city_id,
    )

    city_id = str(
        city_id
        or "city-001"
    )[:40]

    business_id = str(
        business_id
        or ""
    )[:100]

    if not business_id:
        raise HTTPException(
            status_code=400,
            detail="Choose a business.",
        )

    existing_target = await (
        db.realmlife_businesses
        .find_one(
            {
                "game_id":
                    game_id,

                "city_id":
                    city_id,

                "id":
                    business_id,
            },
            {
                "_id": 0
            },
        )
    )

    if not existing_target:
        raise HTTPException(
            status_code=404,
            detail="Business not found.",
        )

    if (
        existing_target.get(
            "status"
        )
        ==
        "owned"
        and
        existing_target.get(
            "owner_user_id"
        )
        ==
        current["id"]
    ):
        return {
            "ok": True,
            "already_owned": True,
            "business":
                existing_target,
        }

    if not _is_founder(
        current
    ):
        owned = await (
            db.realmlife_businesses
            .find_one(
                {
                    "game_id":
                        game_id,

                    "owner_user_id":
                        current["id"],

                    "status":
                        "owned",
                },
                {
                    "_id": 0,

                    "id": 1,

                    "label": 1,

                    "city_id": 1,
                },
            )
        )

        if owned:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Each RealmLife resident may "
                    "own one business at a time. "
                    f"You currently own "
                    f"{owned.get('label') or owned.get('id')} "
                    f"in {owned.get('city_id')}."
                ),
            )

    raw_idem = str(
        idempotency_key
        or ""
    ).strip()[:120]

    if not raw_idem:
        raise HTTPException(
            status_code=400,
            detail="Missing idempotency key.",
        )

    claim_key = (
        f"{current['id']}:"
        f"{raw_idem}"
    )[:180]

    slot = await (
        db.realmlife_businesses
        .find_one_and_update(
            {
                "game_id":
                    game_id,

                "city_id":
                    city_id,

                "id":
                    business_id,

                "status":
                    "available",
            },
            {
                "$set": {
                    "status":
                        "claiming",

                    "claim_key":
                        claim_key,

                    "updated_at":
                        _iso(),
                }
            },
            return_document=
                ReturnDocument.AFTER,
        )
    )

    if not slot:
        current_slot = await (
            db.realmlife_businesses
            .find_one(
                {
                    "game_id":
                        game_id,

                    "city_id":
                        city_id,

                    "id":
                        business_id,
                },
                {
                    "_id": 0
                },
            )
        )

        current_label = (
            (current_slot or {}).get(
                "label"
            )
            or
            "That business"
        )

        raise HTTPException(
            status_code=409,
            detail=(
                f"{current_label} "
                "is no longer available."
            ),
        )


    try:
        burn = await rle.burn_fixed_cost(
            game_id,
            current,
            amount=
                BUSINESS_UNLOCK_COST,
            kind=
                "business_claim",
            reference=
                f"{city_id}:{business_id}",
            idempotency_key=
                raw_idem,
        )

    except Exception:

        await (
            db.realmlife_businesses
            .update_one(
                {
                    "game_id":
                        game_id,

                    "city_id":
                        city_id,

                    "id":
                        business_id,

                    "status":
                        "claiming",

                    "claim_key":
                        claim_key,
                },
                {
                    "$set": {
                        "status":
                            "available",

                        "updated_at":
                            _iso(),
                    },

                    "$unset": {
                        "claim_key":
                            "",
                    },
                },
            )
        )

        raise

    owned = await (
        db.realmlife_businesses
        .find_one_and_update(
            {
                "game_id":
                    game_id,

                "city_id":
                    city_id,

                "id":
                    business_id,

                "status":
                    "claiming",

                "claim_key":
                    claim_key,
            },
            {
                "$set": {
                    "status":
                        "owned",

                    "visibility":
                        "public",

                    "owner_user_id":
                        current["id"],

                    "owner_username":
                        current.get(
                            "username"
                        ),

                    "claimed_at":
                        _iso(),

                    "fire_burned_total":
                        BUSINESS_UNLOCK_COST,

                    "upgrades":
                        [],

                    "updated_at":
                        _iso(),
                },

                "$inc": {
                    "ownership_epoch":
                        1,
                },

                "$unset": {
                    "claim_key":
                        "",
                },
            },
            return_document=
                ReturnDocument.AFTER,
        )
    )

    if not owned:

        await rle.restore_fixed_cost(
            game_id,
            current,
            burn,
            "business_claim_finalize_failed",
        )

        raise HTTPException(
            status_code=409,
            detail=(
                "Business claim changed before "
                "it could be finalized. "
                "Your Fire Power was restored."
            ),
        )

    contribution = {
        "id":
            (
                "business-contribution:"
                f"{burn['ledger_id']}"
            ),

        "game_id":
            game_id,

        "city_id":
            city_id,

        "business_id":
            business_id,

        "ownership_epoch":
            int(
                owned.get(
                    "ownership_epoch"
                )
                or 1
            ),

        "user_id":
            current["id"],

        "username":
            current.get(
                "username"
            ),

        "amount":
            BUSINESS_UNLOCK_COST,

        "kind":
            "business_claim",

        "source_id":
            business_id,

        "refunded_50":
            False,

        "created_at":
            _iso(),
    }

    try:
        await (
            db.realmlife_business_contributions
            .insert_one(
                contribution
            )
        )

    except DuplicateKeyError:
        pass

    except Exception:

        await (
            db.realmlife_businesses
            .update_one(
                {
                    "game_id":
                        game_id,

                    "city_id":
                        city_id,

                    "id":
                        business_id,

                    "owner_user_id":
                        current["id"],

                    "ownership_epoch":
                        owned.get(
                            "ownership_epoch"
                        ),
                },
                {
                    "$set": {
                        "status":
                            "available",

                        "visibility":
                            "public",

                        "owner_user_id":
                            None,

                        "owner_username":
                            None,

                        "fire_burned_total":
                            0,

                        "upgrades":
                            [],

                        "updated_at":
                            _iso(),
                    }
                },
            )
        )

        await rle.restore_fixed_cost(
            game_id,
            current,
            burn,
            "business_contribution_failed",
        )

        raise

    return {
        "ok": True,

        "business":
            owned,

        "burned":
            BUSINESS_UNLOCK_COST,

        "fire_balance":
            burn.get(
                "fire_balance"
            ),
    }


async def set_visibility(
    game_id,
    current,
    business_id,
    *,
    city_id="city-001",
    visibility="public",
):
    visibility = str(
        visibility or ""
    ).lower()

    if visibility not in {
        "public",
        "private",
    }:
        raise HTTPException(
            status_code=400,
            detail=(
                "Business visibility must "
                "be public or private."
            ),
        )

    result = await (
        db.realmlife_businesses
        .find_one_and_update(
            {
                "game_id":
                    game_id,

                "city_id":
                    str(
                        city_id
                        or "city-001"
                    )[:40],

                "id":
                    str(
                        business_id
                        or ""
                    )[:100],

                "status":
                    "owned",

                "owner_user_id":
                    current["id"],
            },
            {
                "$set": {
                    "visibility":
                        visibility,

                    "updated_at":
                        _iso(),
                }
            },
            return_document=
                ReturnDocument.AFTER,
        )
    )

    if not result:
        raise HTTPException(
            status_code=403,
            detail=(
                "Only this business owner "
                "can change its visibility."
            ),
        )

    return {
        "ok": True,
        "business": result,
    }


async def _refund_current_cycle(
    game_id,
    business_doc,
):
    city_id = business_doc[
        "city_id"
    ]

    business_id = business_doc[
        "id"
    ]

    epoch = int(
        business_doc.get(
            "ownership_epoch"
        )
        or 0
    )

    rows = await (
        db.realmlife_business_contributions
        .find(
            {
                "game_id":
                    game_id,

                "city_id":
                    city_id,

                "business_id":
                    business_id,

                "ownership_epoch":
                    epoch,

                "refunded_50": {
                    "$ne":
                        True
                },
            },
            {
                "_id": 0
            },
        )
        .to_list(
            length=1000
        )
    )

    totals = {}

    for row in rows:
        uid = row.get(
            "user_id"
        )

        if not uid:
            continue

        entry = totals.setdefault(
            uid,
            {
                "username":
                    row.get(
                        "username"
                    ),

                "amount":
                    0,
            },
        )

        entry["amount"] += int(
            row.get(
                "amount"
            )
            or 0
        )

    refunds = []

    for uid, entry in totals.items():

        contributed = int(
            entry["amount"]
        )

        refund = (
            contributed
            // 2
        )

        if refund > 0:

            await rle.credit_fixed_amount(
                game_id,
                user_id=
                    uid,
                username=
                    entry.get(
                        "username"
                    ),
                amount=
                    refund,
                kind=
                    "business_destroy_refund",
                reference=
                    (
                        f"{city_id}:"
                        f"{business_id}:"
                        f"e{epoch}"
                    ),
                idempotency_key=
                    (
                        "realmlife:"
                        "business-refund:"
                        f"{game_id}:"
                        f"{city_id}:"
                        f"{business_id}:"
                        f"e{epoch}:"
                        f"{uid}"
                    )[:160],
            )

        await (
            db.realmlife_business_contributions
            .update_many(
                {
                    "game_id":
                        game_id,

                    "city_id":
                        city_id,

                    "business_id":
                        business_id,

                    "ownership_epoch":
                        epoch,

                    "user_id":
                        uid,

                    "refunded_50": {
                        "$ne":
                            True
                    },
                },
                {
                    "$set": {
                        "refunded_50":
                            True,

                        "refund_amount_total":
                            refund,

                        "refunded_at":
                            _iso(),
                    }
                },
            )
        )

        refunds.append({
            "user_id":
                uid,

            "contributed":
                contributed,

            "restored":
                refund,
        })

    return refunds


async def destroy_business(
    game_id,
    current,
    business_id,
    *,
    city_id="city-001",
    confirmation=None,
):
    if (
        str(
            confirmation
            or ""
        ).upper()
        !=
        "DESTROY"
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Confirm business destruction "
                "with DESTROY."
            ),
        )

    city_id = str(
        city_id
        or "city-001"
    )[:40]

    business_id = str(
        business_id
        or ""
    )[:100]

    business_doc = await (
        db.realmlife_businesses
        .find_one(
            {
                "game_id":
                    game_id,

                "city_id":
                    city_id,

                "id":
                    business_id,

                "status":
                    "owned",
            },
            {
                "_id": 0
            },
        )
    )

    if not business_doc:
        raise HTTPException(
            status_code=404,
            detail="Owned business not found.",
        )

    if (
        business_doc.get(
            "owner_user_id"
        )
        !=
        current["id"]
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Only the business owner "
                "can destroy this business."
            ),
        )

    refunds = await (
        _refund_current_cycle(
            game_id,
            business_doc,
        )
    )

    await (
        db.realmlife_businesses
        .update_one(
            {
                "game_id":
                    game_id,

                "city_id":
                    city_id,

                "id":
                    business_id,

                "owner_user_id":
                    current["id"],

                "ownership_epoch":
                    business_doc.get(
                        "ownership_epoch"
                    ),
            },
            {
                "$set": {
                    "status":
                        "available",

                    "visibility":
                        "public",

                    "owner_user_id":
                        None,

                    "owner_username":
                        None,

                    "fire_burned_total":
                        0,

                    "upgrades":
                        [],

                    "released_at":
                        _iso(),

                    "updated_at":
                        _iso(),
                },

                "$unset": {
                    "claimed_at":
                        "",
                },
            },
        )
    )

    return {
        "ok": True,

        "business_id":
            business_id,

        "status":
            "available",

        "refund_percent":
            50,

        "refunds":
            refunds,
    }


async def founder_create_business(
    game_id,
    current,
    body,
):
    if not _is_founder(
        current
    ):
        raise HTTPException(
            status_code=403,
            detail="Founder access required.",
        )

    city_id = str(
        body.get(
            "city_id"
        )
        or "city-001"
    )[:40]

    city = await (
        db.realmlife_cities
        .find_one(
            {
                "game_id":
                    game_id,

                "city_id":
                    city_id,
            },
            {
                "_id": 0
            },
        )
    )

    if not city:
        raise HTTPException(
            status_code=404,
            detail="RealmLife city not found.",
        )

    label = str(
        body.get(
            "label"
        )
        or "Founder Business"
    ).strip()[:100]

    business_type = str(
        body.get(
            "business_type"
        )
        or "custom"
    ).strip().lower()[:60]

    business_id = (
        "founder-business-"
        + uuid.uuid4().hex[:10]
    )

    doc = {
        "game_id":
            game_id,

        "city_id":
            city_id,

        "id":
            business_id,

        "label":
            label,

        "business_type":
            business_type,

        "status":
            "available",

        "visibility":
            "public",

        "owner_user_id":
            None,

        "owner_username":
            None,

        "ownership_epoch":
            0,

        "fire_burned_total":
            0,

        "upgrades":
            [],

        "seeded":
            False,

        "created_by_founder":
            current["id"],

        "created_at":
            _iso(),

        "updated_at":
            _iso(),
    }

    await (
        db.realmlife_businesses
        .insert_one(
            dict(doc)
        )
    )

    return {
        "ok": True,
        "business": doc,
    }
