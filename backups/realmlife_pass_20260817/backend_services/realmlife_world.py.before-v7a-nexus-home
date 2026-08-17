"""
RealmLife V6A Shared Universe

One canonical RealmLife universe.
Cities are logical shared-world instances.

City 001 begins with:
- 100 normal residential lots
- 10 x 10 logical lot registry
- separate Founder property handled independently
- shared player presence

Future cities clone automatically once the newest city reaches
100 occupied normal residential lots.
"""

from datetime import (
    datetime,
    timezone,
)

import math
import time

from fastapi import HTTPException
from pymongo import ReturnDocument

from core.db import db


WORLD_ID = "realm-world-main"

FIRST_CITY_ID = "city-001"

CITY_CAPACITY = 100

PRESENCE_TTL_SECONDS = 8.0


def _iso():
    return (
        datetime.now(
            timezone.utc
        )
        .isoformat()
    )


def _city_seq(
    city_id,
):
    try:
        return max(
            1,
            int(
                str(city_id)
                .split("-")[-1]
            ),
        )

    except Exception:
        return 1


def _city_id(
    seq,
):
    return (
        f"city-{int(seq):03d}"
    )


def _safe_number(
    value,
    default=0.0,
    minimum=-10000.0,
    maximum=10000.0,
):
    try:
        number = float(value)

    except Exception:
        number = float(default)

    if not math.isfinite(
        number
    ):
        number = float(default)

    return max(
        minimum,
        min(
            maximum,
            number,
        ),
    )


async def _seed_city_lots(
    game_id,
    city_id,
):
    """
    Exactly 100 normal homes.

    10 rows x 10 columns.

    World coordinates are intentionally NOT locked here yet.
    The AAA neighborhood renderer will define the final road,
    landscaping and lot geometry.
    """

    for row in range(10):
        for col in range(10):

            lot_seq = (
                row * 10
                + col
                + 1
            )

            lot_id = (
                f"{city_id}"
                f"-residential-"
                f"{lot_seq:03d}"
            )

            await (
                db.realmlife_city_lots
                .update_one(
                    {
                        "game_id":
                            game_id,

                        "city_id":
                            city_id,

                        "lot_seq":
                            lot_seq,
                    },
                    {
                        "$setOnInsert": {
                            "id":
                                lot_id,

                            "world_id":
                                WORLD_ID,

                            "game_id":
                                game_id,

                            "city_id":
                                city_id,

                            "lot_seq":
                                lot_seq,

                            "grid_row":
                                row,

                            "grid_col":
                                col,

                            "lot_type":
                                "residential",

                            "status":
                                "available",

                            "property_id":
                                None,

                            "owner_user_id":
                                None,

                            "owner_username":
                                None,

                            "created_at":
                                _iso(),

                            "updated_at":
                                _iso(),
                        }
                    },
                    upsert=True,
                )
            )


async def _migrate_legacy_properties(
    game_id,
):
    """
    Existing RealmLife properties predate city IDs.

    Preserve them and assign them into City 001 instead of
    destroying/recreating anything.
    """

    query = {
        "game_id":
            game_id,

        "state":
            "owned",

        "$or": [
            {
                "city_id": {
                    "$exists":
                        False
                }
            },
            {
                "city_id":
                    None
            },
        ],
    }

    properties = await (
        db.realmlife_properties
        .find(
            query,
            {
                "_id": 0,
            },
        )
        .sort(
            "lot_seq",
            1,
        )
        .to_list(
            length=100
        )
    )


    occupied_rows = await (
        db.realmlife_city_lots
        .find(
            {
                "game_id":
                    game_id,

                "city_id":
                    FIRST_CITY_ID,

                "status":
                    "occupied",
            },
            {
                "_id": 0,
                "lot_seq": 1,
            },
        )
        .to_list(
            length=100
        )
    )

    occupied = {
        int(
            row.get(
                "lot_seq",
                0,
            )
        )
        for row in occupied_rows
    }


    for prop in properties:

        preferred = int(
            prop.get(
                "lot_seq",
                0,
            )
            or 0
        )

        if (
            preferred < 1
            or
            preferred > 100
            or
            preferred in occupied
        ):
            preferred = next(
                (
                    n
                    for n
                    in range(
                        1,
                        101,
                    )
                    if n
                    not in occupied
                ),
                None,
            )

        if not preferred:
            break


        lot = await (
            db.realmlife_city_lots
            .find_one(
                {
                    "game_id":
                        game_id,

                    "city_id":
                        FIRST_CITY_ID,

                    "lot_seq":
                        preferred,
                },
                {
                    "_id": 0,
                },
            )
        )

        if not lot:
            continue


        await (
            db.realmlife_properties
            .update_one(
                {
                    "id":
                        prop.get(
                            "id"
                        )
                },
                {
                    "$set": {
                        "world_id":
                            WORLD_ID,

                        "city_id":
                            FIRST_CITY_ID,

                        "city_lot_id":
                            lot.get(
                                "id"
                            ),

                        "city_lot_seq":
                            preferred,

                        "updated_at":
                            _iso(),
                    }
                },
            )
        )


        await (
            db.realmlife_city_lots
            .update_one(
                {
                    "game_id":
                        game_id,

                    "city_id":
                        FIRST_CITY_ID,

                    "lot_seq":
                        preferred,
                },
                {
                    "$set": {
                        "status":
                            "occupied",

                        "property_id":
                            prop.get(
                                "id"
                            ),

                        "owner_user_id":
                            prop.get(
                                "owner_user_id"
                            ),

                        "owner_username":
                            prop.get(
                                "owner_username"
                            ),

                        "updated_at":
                            _iso(),
                    }
                },
            )
        )

        occupied.add(
            preferred
        )


async def ensure_city(
    game_id,
    city_id=FIRST_CITY_ID,
    city_seq=None,
):

    seq = (
        int(city_seq)
        if city_seq
        else
        _city_seq(
            city_id
        )
    )


    await (
        db.realmlife_worlds
        .update_one(
            {
                "game_id":
                    game_id,

                "world_id":
                    WORLD_ID,
            },
            {
                "$setOnInsert": {
                    "game_id":
                        game_id,

                    "world_id":
                        WORLD_ID,

                    "title":
                        "RealmLife",

                    "city_capacity":
                        CITY_CAPACITY,

                    "created_at":
                        _iso(),

                    "updated_at":
                        _iso(),
                }
            },
            upsert=True,
        )
    )


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
                "_id": 0,
            },
        )
    )


    if not city:

        await (
            db.realmlife_cities
            .update_one(
                {
                    "game_id":
                        game_id,

                    "city_id":
                        city_id,
                },
                {
                    "$setOnInsert": {
                        "world_id":
                            WORLD_ID,

                        "game_id":
                            game_id,

                        "city_id":
                            city_id,

                        "city_seq":
                            seq,

                        "title":
                            (
                                "RealmLife City "
                                f"{seq:03d}"
                            ),

                        "status":
                            "open",

                        "capacity":
                            CITY_CAPACITY,

                        "template":
                            "realmlife-city-v1",

                        "created_at":
                            _iso(),

                        "updated_at":
                            _iso(),
                    }
                },
                upsert=True,
            )
        )


        await _seed_city_lots(
            game_id,
            city_id,
        )


    # ====================================================
    # REALMLIFE V6C1 CITY BUSINESS SEED
    # ====================================================

    from services import (
        realmlife_business as rlb
    )

    await rlb.ensure_city_businesses(
        game_id,
        city_id,
    )


    if (
        city_id
        ==
        FIRST_CITY_ID
    ):
        await (
            _migrate_legacy_properties(
                game_id
            )
        )


    return await (
        db.realmlife_cities
        .find_one(
            {
                "game_id":
                    game_id,

                "city_id":
                    city_id,
            },
            {
                "_id": 0,
            },
        )
    )


async def city_occupancy(
    game_id,
    city_id,
):
    return await (
        db.realmlife_city_lots
        .count_documents(
            {
                "game_id":
                    game_id,

                "city_id":
                    city_id,

                "status":
                    "occupied",
            }
        )
    )


async def ensure_next_open_city(
    game_id,
):
    """
    If newest city becomes 100/100,
    automatically open the next city.
    """

    await ensure_city(
        game_id,
        FIRST_CITY_ID,
        1,
    )


    cities = await (
        db.realmlife_cities
        .find(
            {
                "game_id":
                    game_id,

                "world_id":
                    WORLD_ID,
            },
            {
                "_id": 0,
            },
        )
        .sort(
            "city_seq",
            1,
        )
        .to_list(
            length=10000
        )
    )


    latest = (
        cities[-1]
        if cities
        else None
    )

    if not latest:
        return await ensure_city(
            game_id,
            FIRST_CITY_ID,
            1,
        )


    occupied = await (
        city_occupancy(
            game_id,
            latest["city_id"],
        )
    )


    if (
        occupied
        >=
        CITY_CAPACITY
    ):
        next_seq = (
            int(
                latest.get(
                    "city_seq",
                    1,
                )
            )
            + 1
        )

        return await ensure_city(
            game_id,
            _city_id(
                next_seq
            ),
            next_seq,
        )


    return latest



# ============================================================
# REALMLIFE PUBLIC FIRST-100 PROPERTY BINDING
#
# Guarantees:
# - RealmLife entry creates/resolves starter housing.
# - Every owned normal starter property binds to ONE city lot.
# - City lots are reserved atomically.
# - City 001 fills normal homes 1-100.
# - When the frontier city reaches 100/100, the next city
#   created by the V6A city registry becomes available.
# - Player presence follows the city containing their property.
# ============================================================


async def _refresh_owned_property(
    game_id,
    current,
):
    return await (
        db.realmlife_properties
        .find_one(
            {
                "game_id":
                    game_id,

                "owner_user_id":
                    current["id"],

                "state":
                    "owned",
            },
            {
                "_id": 0,
            },
        )
    )


async def _bind_property_to_city_lot(
    game_id,
    current,
    prop,
):
    if not prop:
        raise HTTPException(
            status_code=409,
            detail=(
                "RealmLife starter property "
                "could not be resolved."
            ),
        )


    # --------------------------------------------------------
    # Already bound:
    # verify the lot still belongs to this property.
    # --------------------------------------------------------

    existing_lot_id = (
        prop.get(
            "city_lot_id"
        )
    )


    if existing_lot_id:

        existing_lot = await (
            db.realmlife_city_lots
            .find_one(
                {
                    "game_id":
                        game_id,

                    "id":
                        existing_lot_id,

                    "property_id":
                        prop.get(
                            "id"
                        ),
                },
                {
                    "_id": 0,
                },
            )
        )


        if existing_lot:

            # Repair owner/status metadata if the same property
            # was reused after a legitimate release/reclaim.
            await (
                db.realmlife_city_lots
                .update_one(
                    {
                        "game_id":
                            game_id,

                        "id":
                            existing_lot_id,
                    },
                    {
                        "$set": {
                            "status":
                                "occupied",

                            "owner_user_id":
                                current["id"],

                            "owner_username":
                                current.get(
                                    "username"
                                ),

                            "updated_at":
                                _iso(),
                        }
                    },
                )
            )

            return prop


        # Stale physical binding.
        await (
            db.realmlife_properties
            .update_one(
                {
                    "game_id":
                        game_id,

                    "id":
                        prop["id"],

                    "owner_user_id":
                        current["id"],
                },
                {
                    "$unset": {
                        "world_id":
                            "",

                        "city_id":
                            "",

                        "city_lot_id":
                            "",

                        "city_lot_seq":
                            "",
                    },

                    "$set": {
                        "updated_at":
                            _iso(),
                    },
                },
            )
        )

        prop = await _refresh_owned_property(
            game_id,
            current,
        )


    # --------------------------------------------------------
    # A migration may already have created an occupied lot
    # record for the property even if the property record was
    # partially missing its city-lot fields.
    # --------------------------------------------------------

    mapped_lot = await (
        db.realmlife_city_lots
        .find_one(
            {
                "game_id":
                    game_id,

                "property_id":
                    prop["id"],

                "status":
                    "occupied",
            },
            {
                "_id": 0,
            },
        )
    )


    if mapped_lot:

        await (
            db.realmlife_properties
            .update_one(
                {
                    "game_id":
                        game_id,

                    "id":
                        prop["id"],

                    "owner_user_id":
                        current["id"],
                },
                {
                    "$set": {
                        "world_id":
                            WORLD_ID,

                        "city_id":
                            mapped_lot[
                                "city_id"
                            ],

                        "city_lot_id":
                            mapped_lot[
                                "id"
                            ],

                        "city_lot_seq":
                            mapped_lot[
                                "lot_seq"
                            ],

                        "updated_at":
                            _iso(),
                    }
                },
            )
        )

        return await _refresh_owned_property(
            game_id,
            current,
        )


    # --------------------------------------------------------
    # Reserve the next available physical house.
    #
    # Old-city vacancies are intentionally eligible before
    # opening/filling only the newest city.
    # --------------------------------------------------------

    for attempt in range(3):

        await ensure_next_open_city(
            game_id
        )


        cities = await (
            db.realmlife_cities
            .find(
                {
                    "game_id":
                        game_id,

                    "world_id":
                        WORLD_ID,

                    "status":
                        "open",
                },
                {
                    "_id": 0,
                },
            )
            .sort(
                "city_seq",
                1,
            )
            .to_list(
                length=10000
            )
        )


        for city in cities:

            claim_key = (
                f"{current['id']}:"
                f"{prop['id']}:"
                f"{city['city_id']}:"
                f"{attempt}:"
                f"{time.time_ns()}"
            )


            lot = await (
                db.realmlife_city_lots
                .find_one_and_update(
                    {
                        "game_id":
                            game_id,

                        "city_id":
                            city[
                                "city_id"
                            ],

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
                    sort=[
                        (
                            "lot_seq",
                            1,
                        )
                    ],
                    return_document=
                        ReturnDocument.AFTER,
                )
            )


            if not lot:
                continue


            property_update = await (
                db.realmlife_properties
                .update_one(
                    {
                        "game_id":
                            game_id,

                        "id":
                            prop[
                                "id"
                            ],

                        "owner_user_id":
                            current[
                                "id"
                            ],

                        "state":
                            "owned",

                        "$or": [
                            {
                                "city_lot_id": {
                                    "$exists":
                                        False
                                }
                            },

                            {
                                "city_lot_id":
                                    None
                            },
                        ],
                    },
                    {
                        "$set": {
                            "world_id":
                                WORLD_ID,

                            "city_id":
                                city[
                                    "city_id"
                                ],

                            "city_lot_id":
                                lot[
                                    "id"
                                ],

                            "city_lot_seq":
                                lot[
                                    "lot_seq"
                                ],

                            "updated_at":
                                _iso(),
                        }
                    },
                )
            )


            if (
                property_update
                .modified_count
                !=
                1
            ):

                # Another request may have bound the same
                # property concurrently. Release our reservation.
                await (
                    db.realmlife_city_lots
                    .update_one(
                        {
                            "game_id":
                                game_id,

                            "id":
                                lot[
                                    "id"
                                ],

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

                refreshed = await (
                    _refresh_owned_property(
                        game_id,
                        current,
                    )
                )

                if (
                    refreshed
                    and
                    refreshed.get(
                        "city_lot_id"
                    )
                ):
                    return refreshed

                continue


            finalize = await (
                db.realmlife_city_lots
                .update_one(
                    {
                        "game_id":
                            game_id,

                        "id":
                            lot[
                                "id"
                            ],

                        "status":
                            "claiming",

                        "claim_key":
                            claim_key,
                    },
                    {
                        "$set": {
                            "status":
                                "occupied",

                            "property_id":
                                prop[
                                    "id"
                                ],

                            "owner_user_id":
                                current[
                                    "id"
                                ],

                            "owner_username":
                                current.get(
                                    "username"
                                ),

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


            if (
                finalize.modified_count
                ==
                1
            ):
                return await (
                    _refresh_owned_property(
                        game_id,
                        current,
                    )
                )


            # Rare finalize race:
            # clear property binding and release reservation.
            await (
                db.realmlife_properties
                .update_one(
                    {
                        "game_id":
                            game_id,

                        "id":
                            prop[
                                "id"
                            ],

                        "owner_user_id":
                            current[
                                "id"
                            ],

                        "city_lot_id":
                            lot[
                                "id"
                            ],
                    },
                    {
                        "$unset": {
                            "world_id":
                                "",

                            "city_id":
                                "",

                            "city_lot_id":
                                "",

                            "city_lot_seq":
                                "",
                        },

                        "$set": {
                            "updated_at":
                                _iso(),
                        },
                    },
                )
            )


            await (
                db.realmlife_city_lots
                .update_one(
                    {
                        "game_id":
                            game_id,

                        "id":
                            lot[
                                "id"
                            ],

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


    raise HTTPException(
        status_code=409,
        detail=(
            "RealmLife could not reserve a "
            "residential home right now. "
            "Please enter again."
        ),
    )


async def resolve_player_city(
    game_id,
    current,
):

    # --------------------------------------------------------
    # Guarantee housing first.
    # --------------------------------------------------------

    from services import (
        realmlife_property as rlp
    )


    await rlp.ensure_housing(
        game_id,
        current,
    )


    prop = await (
        _refresh_owned_property(
            game_id,
            current,
        )
    )


    prop = await (
        _bind_property_to_city_lot(
            game_id,
            current,
            prop,
        )
    )


    city_id = (
        prop.get(
            "city_id"
        )
        or
        FIRST_CITY_ID
    )


    # --------------------------------------------------------
    # Existing player-location record may predate the physical
    # house binding. Keep it, but repair its city.
    # --------------------------------------------------------

    existing = await (
        db.realmlife_player_locations
        .find_one(
            {
                "game_id":
                    game_id,

                "user_id":
                    current[
                        "id"
                    ],
            },
            {
                "_id": 0,
            },
        )
    )


    if existing:

        if (
            existing.get(
                "city_id"
            )
            !=
            city_id
        ):
            await (
                db.realmlife_player_locations
                .update_one(
                    {
                        "game_id":
                            game_id,

                        "user_id":
                            current[
                                "id"
                            ],
                    },
                    {
                        "$set": {
                            "world_id":
                                WORLD_ID,

                            "city_id":
                                city_id,

                            "updated_at":
                                _iso(),
                        }
                    },
                )
            )

            existing[
                "world_id"
            ] = WORLD_ID

            existing[
                "city_id"
            ] = city_id


        return existing


    location = {
        "world_id":
            WORLD_ID,

        "game_id":
            game_id,

        "user_id":
            current[
                "id"
            ],

        "username":
            current.get(
                "username"
            ),

        "city_id":
            city_id,

        "location_type":
            "world",

        "property_id":
            None,

        "updated_at":
            _iso(),
    }


    await (
        db.realmlife_player_locations
        .update_one(
            {
                "game_id":
                    game_id,

                "user_id":
                    current[
                        "id"
                    ],
            },
            {
                "$set":
                    location,

                "$setOnInsert": {
                    "created_at":
                        _iso()
                },
            },
            upsert=True,
        )
    )


    return location


async def status(
    game_id,
    current,
):

    location = await (
        resolve_player_city(
            game_id,
            current,
        )
    )


    cities = await (
        db.realmlife_cities
        .find(
            {
                "game_id":
                    game_id,

                "world_id":
                    WORLD_ID,
            },
            {
                "_id": 0,
            },
        )
        .sort(
            "city_seq",
            1,
        )
        .to_list(
            length=10000
        )
    )


    output = []

    for city in cities:

        occupied = await (
            city_occupancy(
                game_id,
                city["city_id"],
            )
        )

        output.append({
            **city,

            "occupied":
                occupied,

            "available":
                max(
                    0,
                    CITY_CAPACITY
                    - occupied,
                ),
        })


    return {
        "ok":
            True,

        "world_id":
            WORLD_ID,

        "city_id":
            location.get(
                "city_id",
                FIRST_CITY_ID,
            ),

        "cities":
            output,
    }


async def presence(
    game_id,
    current,
    body,
):

    location = await (
        resolve_player_city(
            game_id,
            current,
        )
    )


    city_id = (
        location.get(
            "city_id"
        )
        or
        FIRST_CITY_ID
    )


    location_type = str(
        body.get(
            "location_type"
        )
        or
        "world"
    ).lower()


    if location_type not in {
        "world",
        "property",
        "business",
        "station",
        "train",
        "portal",
    }:
        location_type = "world"


    property_id = (
        body.get(
            "property_id"
        )
        or
        None
    )


    now_ts = time.time()


    row = {
        "world_id":
            WORLD_ID,

        "game_id":
            game_id,

        "city_id":
            city_id,

        "user_id":
            current["id"],

        "username":
            current.get(
                "username"
            )
            or
            "RealmLife Resident",

        "x":
            _safe_number(
                body.get("x"),
                0,
            ),

        "y":
            _safe_number(
                body.get("y"),
                0,
                -100,
                500,
            ),

        "z":
            _safe_number(
                body.get("z"),
                0,
            ),

        "ry":
            _safe_number(
                body.get("ry"),
                0,
                -100,
                100,
            ),

        "location_type":
            location_type,

        "property_id":
            property_id,

        "ts":
            now_ts,

        "updated_at":
            _iso(),
    }


    await (
        db.realmlife_world_presence
        .update_one(
            {
                "game_id":
                    game_id,

                "user_id":
                    current["id"],
            },
            {
                "$set":
                    row,

                "$setOnInsert": {
                    "created_at":
                        _iso()
                },
            },
            upsert=True,
        )
    )


    query = {
        "game_id":
            game_id,

        "world_id":
            WORLD_ID,

        "city_id":
            city_id,

        "user_id": {
            "$ne":
                current["id"]
        },

        "ts": {
            "$gt":
                (
                    now_ts
                    -
                    PRESENCE_TTL_SECONDS
                )
        },
    }


    # Private interiors only reveal people in the exact same
    # authorized property instance.
    if (
        location_type
        ==
        "property"
    ):
        query[
            "location_type"
        ] = "property"

        query[
            "property_id"
        ] = property_id

    else:
        query[
            "location_type"
        ] = "world"


    others = await (
        db.realmlife_world_presence
        .find(
            query,
            {
                "_id": 0,

                "user_id": 1,
                "username": 1,

                "x": 1,
                "y": 1,
                "z": 1,
                "ry": 1,

                "city_id": 1,

                "location_type": 1,
                "property_id": 1,

                "ts": 1,
            },
        )
        .limit(
            100
        )
        .to_list(
            length=100
        )
    )


    return {
        "ok":
            True,

        "world_id":
            WORLD_ID,

        "city_id":
            city_id,

        "others":
            others,
    }


async def leave_presence(
    game_id,
    current,
):

    await (
        db.realmlife_world_presence
        .delete_one(
            {
                "game_id":
                    game_id,

                "user_id":
                    current["id"],
            }
        )
    )

    return {
        "ok":
            True
    }
