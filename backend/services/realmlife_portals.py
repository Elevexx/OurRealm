from fastapi import HTTPException

from core.db import db
from core.permissions import (
    get_admin_role,
    ROLE_FOUNDER,
)


STATIC_PORTALS = {
    "community-central": {
        "id": "community-central",
        "label": "Community Central Portal",
        "kind": "public",
        "locked": False,
        "sector": "community-central",
        "spawn": {
            "x": 0.0,
            "y": 0.0,
            "z": 48.0,
            "floor": "WORLD",
        },
    },

    "downtown-riverwalk": {
        "id": "downtown-riverwalk",
        "label": "Downtown Riverwalk Central Station",
        "kind": "public",
        "locked": False,
        "sector": "downtown-riverwalk",
        "spawn": {
            "x": 26.0,
            "y": 0.0,
            "z": 91.0,
            "floor": "WORLD",
        },
    },

    "jungle-festival": {
        "id": "jungle-festival",
        "label": "Jungle Festival Portal",
        "kind": "public",
        "locked": False,
        "sector": "jungle-festival",
        "spawn": {
            "x": -32.0,
            "y": 0.0,
            "z": 164.0,
            "floor": "WORLD",
        },
    },

    "founder-bunker": {
        "id": "founder-bunker",
        "label": "Founder Private Portal",
        "kind": "private",
        "locked": False,
        "sector": "founder-estate",
        "owner_username": "stealth",
        "spawn": {
            "x": 0.0,
            "y": 0.0,
            "z": -113.0,
            "floor": "B3",
        },
    },
}


def _is_founder(current):
    if not current:
        return False

    return bool(
        get_admin_role(current)
        == ROLE_FOUNDER
        or current.get("is_founder")
        or str(
            current.get("username")
            or ""
        ).lower()
        == "stealth"
    )


async def _dynamic_portal(
    game_id,
    portal_id,
):
    return await (
        db.realmlife_personal_portals
        .find_one(
            {
                "game_id": game_id,
                "id": portal_id,
                "status": "active",
            },
            {"_id": 0},
        )
    )


async def _portal_state(
    game_id,
    portal_id,
):
    portal_id = str(
        portal_id or ""
    )[:100]

    base = STATIC_PORTALS.get(
        portal_id
    )

    if base:
        out = {
            **base,
            "spawn": {
                **base["spawn"]
            },
        }

        override = await (
            db.realmlife_portal_state
            .find_one(
                {
                    "game_id": game_id,
                    "portal_id": portal_id,
                },
                {"_id": 0},
            )
        )

        if override:
            if "locked" in override:
                out["locked"] = bool(
                    override["locked"]
                )

            if override.get("label"):
                out["label"] = str(
                    override["label"]
                )[:100]

        return out


    doc = await _dynamic_portal(
        game_id,
        portal_id,
    )

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Portal not found.",
        )


    spawn = (
        doc.get("spawn")
        or {}
    )


    return {
        "id": doc["id"],

        "label":
            doc.get("label")
            or (
                "@"
                + str(
                    doc.get(
                        "owner_username"
                    )
                    or "User"
                )
                + " Home Portal"
            ),

        "kind": "private",

        "locked":
            bool(
                doc.get(
                    "locked",
                    False,
                )
            ),

        "sector":
            doc.get("sector")
            or "residential",

        "owner_user_id":
            doc.get(
                "owner_user_id"
            ),

        "owner_username":
            doc.get(
                "owner_username"
            ),

        "property_id":
            doc.get(
                "property_id"
            ),

        "spawn": {
            "x": float(
                spawn.get("x", 0)
            ),

            "y": float(
                spawn.get("y", 0)
            ),

            "z": float(
                spawn.get("z", 0)
            ),

            "floor": str(
                spawn.get(
                    "floor",
                    "WORLD",
                )
            ),
        },
    }


async def _my_portal(
    game_id,
    current,
):
    # Founder B3 is Stealth's home portal.
    if _is_founder(current):
        return await _portal_state(
            game_id,
            "founder-bunker",
        )


    doc = await (
        db.realmlife_personal_portals
        .find_one(
            {
                "game_id": game_id,

                "owner_user_id":
                    current["id"],

                "status": "active",
            },
            {"_id": 0},
        )
    )

    if not doc:
        return None


    return await _portal_state(
        game_id,
        doc["id"],
    )


async def has_access(
    game_id,
    current,
    portal_id,
):
    portal = await _portal_state(
        game_id,
        portal_id,
    )


    if portal["kind"] == "public":
        return True


    if (
        portal_id == "founder-bunker"
        and _is_founder(current)
    ):
        return True


    if (
        portal.get("owner_user_id")
        == current["id"]
    ):
        return True


    row = await (
        db.realmlife_portal_access
        .find_one(
            {
                "game_id": game_id,

                "portal_id":
                    portal_id,

                "user_id":
                    current["id"],

                "status": "active",
            },
            {"_id": 0},
        )
    )

    return bool(row)


async def list_portals(
    game_id,
    current,
):
    my_portal = await _my_portal(
        game_id,
        current,
    )


    portal_ids = set(
        STATIC_PORTALS.keys()
    )


    if my_portal:
        portal_ids.add(
            my_portal["id"]
        )


    grants = await (
        db.realmlife_portal_access
        .find(
            {
                "game_id": game_id,

                "user_id":
                    current["id"],

                "status": "active",
            },
            {
                "_id": 0,
                "portal_id": 1,
            },
        )
        .to_list(
            length=200
        )
    )


    for grant in grants:
        portal_id = grant.get(
            "portal_id"
        )

        if portal_id:
            portal_ids.add(
                portal_id
            )


    portals = []


    for portal_id in portal_ids:
        try:
            portal = await _portal_state(
                game_id,
                portal_id,
            )
        except HTTPException:
            continue


        accessible = await has_access(
            game_id,
            current,
            portal_id,
        )


        if (
            portal["kind"] == "public"
            or accessible
        ):
            portals.append(
                {
                    **portal,

                    "accessible":
                        accessible,

                    "is_my_portal":
                        bool(
                            my_portal
                            and portal_id
                            == my_portal["id"]
                        ),
                }
            )


    portals.sort(
        key=lambda p: (
            0
            if p.get("is_my_portal")
            else 1,

            p.get("label", ""),
        )
    )


    return {
        "portals":
            portals,

        "my_portal_id":
            (
                my_portal["id"]
                if my_portal
                else None
            ),

        "has_personal_portal":
            bool(my_portal),
    }


async def travel(
    game_id,
    current,
    source_portal_id,
    destination_portal_id,
):
    source_portal_id = str(
        source_portal_id
        or ""
    )[:100]

    destination_portal_id = str(
        destination_portal_id
        or ""
    )[:100]


    if (
        source_portal_id
        == destination_portal_id
    ):
        raise HTTPException(
            status_code=400,
            detail="Choose another portal.",
        )


    source = await _portal_state(
        game_id,
        source_portal_id,
    )

    destination = await _portal_state(
        game_id,
        destination_portal_id,
    )


    if source.get("locked"):
        raise HTTPException(
            status_code=423,
            detail="This portal is locked.",
        )


    if destination.get("locked"):
        raise HTTPException(
            status_code=423,
            detail=(
                "That destination portal "
                "is locked."
            ),
        )


    if not await has_access(
        game_id,
        current,
        source_portal_id,
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "You do not have access "
                "to this portal."
            ),
        )


    if not await has_access(
        game_id,
        current,
        destination_portal_id,
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "You do not have access "
                "to that destination."
            ),
        )


    return {
        "ok": True,

        "source":
            source_portal_id,

        "destination":
            destination_portal_id,

        "destination_label":
            destination["label"],

        "spawn":
            destination["spawn"],
    }


async def grant_access(
    game_id,
    current,
    target_user_id,
):
    own = await _my_portal(
        game_id,
        current,
    )

    if not own:
        raise HTTPException(
            status_code=409,
            detail=(
                "You do not have an "
                "installed personal portal."
            ),
        )


    target_user_id = str(
        target_user_id
        or ""
    ).strip()[:80]


    target = await (
        db.users.find_one(
            {
                "id": target_user_id
            },
            {
                "_id": 0,
                "id": 1,
                "username": 1,
            },
        )
    )


    if not target:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )


    await (
        db.realmlife_portal_access
        .update_one(
            {
                "game_id": game_id,

                "portal_id":
                    own["id"],

                "user_id":
                    target_user_id,
            },
            {
                "$set": {
                    "status": "active",

                    "authorized_by":
                        current["id"],

                    "username":
                        target.get(
                            "username"
                        ),
                }
            },
            upsert=True,
        )
    )


    return {
        "ok": True,

        "portal_id":
            own["id"],

        "user_id":
            target_user_id,
    }


async def revoke_access(
    game_id,
    current,
    target_user_id,
):
    own = await _my_portal(
        game_id,
        current,
    )

    if not own:
        raise HTTPException(
            status_code=409,
            detail=(
                "You do not have an "
                "installed personal portal."
            ),
        )


    target_user_id = str(
        target_user_id
        or ""
    ).strip()[:80]


    await (
        db.realmlife_portal_access
        .update_one(
            {
                "game_id": game_id,

                "portal_id":
                    own["id"],

                "user_id":
                    target_user_id,
            },
            {
                "$set": {
                    "status": "revoked",

                    "revoked_by":
                        current["id"],
                }
            },
        )
    )


    return {
        "ok": True,

        "portal_id":
            own["id"],

        "user_id":
            target_user_id,

        "revoked": True,
    }


# ============================================================
# REALMLIFE V6C1 PERSONAL PORTAL UNLOCK
#
# Normal residential property:
# burn 🔥100,000 to permanently unlock home portal.
#
# Founder already uses the Founder B3 portal.
# ============================================================

PERSONAL_PORTAL_UNLOCK_FIRE = 100_000


async def unlock_personal_portal(
    game_id,
    current,
    idempotency_key,
):
    # Founder already owns the B3 private portal.
    if _is_founder(
        current
    ):
        portal = await _my_portal(
            game_id,
            current,
        )

        return {
            "ok": True,
            "founder": True,
            "already_unlocked": True,
            "portal": portal,
        }

    existing = await _my_portal(
        game_id,
        current,
    )

    if existing:
        return {
            "ok": True,
            "already_unlocked": True,
            "portal": existing,
        }

    from services import (
        realmlife_property as rlp,
    )

    from services import (
        realmlife_economy as rle,
    )

    # Ensures starter housing exists, then resolves the user's
    # active household/property.
    await rlp.ensure_housing(
        game_id,
        current,
    )

    membership, prop = await (
        rlp._require_household_member(
            game_id,
            current["id"],
        )
    )

    if not prop:
        raise HTTPException(
            status_code=409,
            detail=(
                "A RealmLife home is required "
                "before unlocking a personal portal."
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

    property_id = prop["id"]

    portal_id = (
        f"home-portal-"
        f"{property_id}"
    )[:100]

    burn = await rle.burn_fixed_cost(
        game_id,
        current,
        amount=
            PERSONAL_PORTAL_UNLOCK_FIRE,
        kind=
            "personal_portal_unlock",
        reference=
            property_id,
        idempotency_key=
            raw_idem,
    )

    now = __import__(
        "datetime"
    ).datetime.now(
        __import__(
            "datetime"
        ).timezone.utc
    ).isoformat()

    spawn = prop.get(
        "portal_spawn"
    )

    if not isinstance(
        spawn,
        dict,
    ):
        spawn = prop.get(
            "outside_spawn"
        )

    if not isinstance(
        spawn,
        dict,
    ):
        # Current Home V1 fallback.
        # Future city lot registry will bind this to the
        # actual property's personal portal position.
        spawn = {
            "x": 0,
            "y": 0,
            "z": 12.8,
            "floor": "WORLD",
        }

    doc = {
        "id":
            portal_id,

        "game_id":
            game_id,

        "city_id":
            prop.get(
                "city_id"
            )
            or
            "city-001",

        "property_id":
            property_id,

        "household_id":
            membership.get(
                "household_id"
            ),

        "owner_user_id":
            current["id"],

        "owner_username":
            current.get(
                "username"
            ),

        "kind":
            "personal",

        "label":
            (
                f"{current.get('username') or 'Resident'}"
                " · Home Portal"
            )[:120],

        "status":
            "active",

        "locked":
            False,

        "spawn": {
            "x":
                float(
                    spawn.get(
                        "x",
                        0,
                    )
                ),

            "y":
                float(
                    spawn.get(
                        "y",
                        0,
                    )
                ),

            "z":
                float(
                    spawn.get(
                        "z",
                        12.8,
                    )
                ),

            "floor":
                str(
                    spawn.get(
                        "floor",
                        "WORLD",
                    )
                ),
        },

        "fire_burned":
            PERSONAL_PORTAL_UNLOCK_FIRE,

        "created_at":
            now,

        "updated_at":
            now,
    }

    try:
        result = await (
            db.realmlife_personal_portals
            .update_one(
                {
                    "game_id":
                        game_id,

                    "owner_user_id":
                        current["id"],
                },
                {
                    "$setOnInsert":
                        doc,
                },
                upsert=True,
            )
        )

        if (
            result.upserted_id
            is None
        ):
            # Another request created it first.
            await rle.restore_fixed_cost(
                game_id,
                current,
                burn,
                "personal_portal_already_exists",
            )

            existing = await _my_portal(
                game_id,
                current,
            )

            if existing:
                return {
                    "ok": True,
                    "already_unlocked": True,
                    "portal": existing,
                }

            raise HTTPException(
                status_code=409,
                detail=(
                    "Personal portal record "
                    "already exists."
                ),
            )

        # Personal portal is a PROPERTY UPGRADE.
        # Therefore it belongs in the existing property
        # contribution ledger and receives the normal
        # contributor-specific 50% restoration if that
        # property is later destroyed.
        await rlp.record_property_contribution(
            game_id,
            current,
            amount=
                PERSONAL_PORTAL_UNLOCK_FIRE,
            kind=
                "personal_portal",
            source_id=
                portal_id,
            idempotency_key=
                raw_idem,
        )

    except Exception:

        await (
            db.realmlife_personal_portals
            .delete_one(
                {
                    "game_id":
                        game_id,

                    "id":
                        portal_id,

                    "owner_user_id":
                        current["id"],
                }
            )
        )

        await rle.restore_fixed_cost(
            game_id,
            current,
            burn,
            "personal_portal_creation_failed",
        )

        raise

    portal = await _portal_state(
        game_id,
        portal_id,
    )

    return {
        "ok": True,

        "unlocked": True,

        "burned":
            PERSONAL_PORTAL_UNLOCK_FIRE,

        "fire_balance":
            burn.get(
                "fire_balance"
            ),

        "portal":
            portal,
    }



# ============================================================
# REALMLIFE V6B2 PUBLIC PORTAL WORLD POSITIONS
#
# These override the old prototype-world spawn points.
# ============================================================

if (
    "community-central"
    in STATIC_PORTALS
):
    STATIC_PORTALS[
        "community-central"
    ][
        "spawn"
    ] = {
        "x": 65.0,
        "y": 0.0,
        "z": 166.0,
        "floor": "WORLD",
    }


if (
    "downtown-riverwalk"
    in STATIC_PORTALS
):
    STATIC_PORTALS[
        "downtown-riverwalk"
    ][
        "spawn"
    ] = {
        "x": 22.0,
        "y": 0.0,
        "z": 430.0,
        "floor": "WORLD",
    }
