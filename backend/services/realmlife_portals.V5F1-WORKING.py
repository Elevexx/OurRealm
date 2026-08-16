"""
RealmLife portal network authority.

Initial portals:
- Community Central
- Downtown Riverwalk Central Station
- Founder Bunker Portal

Public portals are available to RealmLife users.
Founder Bunker is private and requires explicit access.

The browser never decides whether a portal is authorized.
"""

from fastapi import HTTPException

from core.db import db
from core.permissions import (
    get_admin_role,
    ROLE_FOUNDER,
)


PORTALS = {
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
        "label":
            "Downtown Riverwalk Central Station",
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
        "label": "Founder Bunker Portal",
        "kind": "private",
        "locked": False,
        "sector": "founder-estate",
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

    return (
        get_admin_role(current)
        == ROLE_FOUNDER
        or str(
            current.get(
                "username"
            ) or ""
        ).lower()
        == "stealth"
        or bool(
            current.get(
                "is_founder"
            )
        )
    )


async def _portal_state(
    game_id,
    portal_id,
):
    base = PORTALS.get(portal_id)

    if not base:
        raise HTTPException(
            status_code=404,
            detail="Portal not found.",
        )

    out = {
        **base,
        "spawn": {
            **base["spawn"],
        },
    }

    override = await (
        db.realmlife_portal_state
        .find_one(
            {
                "game_id": game_id,
                "portal_id":
                    portal_id,
            },
            {"_id": 0},
        )
    )

    if override:
        if (
            "locked"
            in override
        ):
            out["locked"] = bool(
                override[
                    "locked"
                ]
            )

        if override.get(
            "label"
        ):
            out["label"] = str(
                override[
                    "label"
                ]
            )[:100]

    return out


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

    if _is_founder(current):
        return True

    access = await (
        db.realmlife_portal_access
        .find_one(
            {
                "game_id":
                    game_id,

                "portal_id":
                    portal_id,

                "user_id":
                    current["id"],

                "status":
                    "active",
            },
            {"_id": 0},
        )
    )

    return bool(access)


async def list_portals(
    game_id,
    current,
):
    out = []

    for portal_id in PORTALS:
        portal = await _portal_state(
            game_id,
            portal_id,
        )

        accessible = await has_access(
            game_id,
            current,
            portal_id,
        )

        out.append(
            {
                **portal,
                "accessible":
                    accessible,
            }
        )

    return {
        "portals": out,
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
    )[:80]

    destination_portal_id = str(
        destination_portal_id
        or ""
    )[:80]

    if (
        source_portal_id
        == destination_portal_id
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Choose another portal."
            ),
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
            detail=(
                "This portal is locked."
            ),
        )

    if destination.get(
        "locked"
    ):
        raise HTTPException(
            status_code=423,
            detail=(
                "That destination "
                "portal is locked."
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
                "You do not have "
                "access to this portal."
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
            destination[
                "label"
            ],

        "spawn":
            destination[
                "spawn"
            ],
    }


async def grant_access(
    game_id,
    current,
    target_user_id,
):
    if not _is_founder(
        current
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Founder portal access "
                "can only be granted "
                "by the Founder."
            ),
        )

    target_user_id = str(
        target_user_id
        or ""
    ).strip()[:80]

    if not target_user_id:
        raise HTTPException(
            status_code=400,
            detail="User is required.",
        )

    if (
        target_user_id
        == current["id"]
    ):
        return {
            "ok": True,
            "already_allowed":
                True,
        }

    target = await (
        db.users.find_one(
            {
                "id":
                    target_user_id
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
                "game_id":
                    game_id,

                "portal_id":
                    "founder-bunker",

                "user_id":
                    target_user_id,
            },
            {
                "$set": {
                    "status":
                        "active",

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
            "founder-bunker",
        "user_id":
            target_user_id,
    }


async def revoke_access(
    game_id,
    current,
    target_user_id,
):
    if not _is_founder(
        current
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Founder portal access "
                "can only be revoked "
                "by the Founder."
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
                "game_id":
                    game_id,

                "portal_id":
                    "founder-bunker",

                "user_id":
                    target_user_id,
            },
            {
                "$set": {
                    "status":
                        "revoked",

                    "revoked_by":
                        current["id"],
                }
            },
        )
    )

    return {
        "ok": True,
        "portal_id":
            "founder-bunker",
        "user_id":
            target_user_id,
        "revoked":
            True,
    }
