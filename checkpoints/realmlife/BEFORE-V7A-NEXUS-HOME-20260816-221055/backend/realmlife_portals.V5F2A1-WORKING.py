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
