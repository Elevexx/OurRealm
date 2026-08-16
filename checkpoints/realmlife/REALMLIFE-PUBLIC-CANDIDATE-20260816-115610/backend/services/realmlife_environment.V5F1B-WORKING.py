"""
RealmLife shared world environment authority.

Provides:
- global RealmLife world clock
- 24-hour sun / moon cycle
- moon phases
- world live / maintenance mode
- simultaneous manual weather
- simultaneous scheduled weather
- Stealth Founder-only controls
- integration with the existing OurRealm signup authority

Visual rendering is handled client-side, but all world state,
weather schedules, and Founder mutations are server-authoritative.
"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from core.db import db
from core.permissions import (
    get_admin_role,
    ROLE_FOUNDER,
)


DEFAULT_DAY_LENGTH_REAL_MINUTES = 24.0


WEATHER_TYPES = {
    "clear": {
        "label": "Clear",
    },
    "cloudy": {
        "label": "Cloudy",
    },
    "wind": {
        "label": "Wind",
    },
    "rain": {
        "label": "Rain",
    },
    "thunderstorm": {
        "label": "Thunderstorm",
    },
    "heavy_storm": {
        "label": "Heavy Storm",
    },
    "fog": {
        "label": "Fog",
    },
    "tornado": {
        "label": "Tornado",
    },
    "hurricane": {
        "label": "Hurricane",
    },
    "heat_wave": {
        "label": "Heat Wave",
    },
    "drought": {
        "label": "Drought",
    },
}


MOON_PHASES = [
    "New Moon",
    "Waxing Crescent",
    "First Quarter",
    "Waxing Gibbous",
    "Full Moon",
    "Waning Gibbous",
    "Last Quarter",
    "Waning Crescent",
]


def _iso():
    return datetime.now(
        timezone.utc
    ).isoformat()


def _now():
    return datetime.now(
        timezone.utc
    )


def _parse_iso(value):
    try:
        return datetime.fromisoformat(
            str(value).replace(
                "Z",
                "+00:00",
            )
        )
    except Exception:
        return _now()


def is_stealth_founder(
    current: dict,
) -> bool:
    if not current:
        return False

    username = str(
        current.get("username")
        or ""
    ).lower()

    return bool(
        username == "stealth"
        and (
            get_admin_role(
                current
            )
            == ROLE_FOUNDER
            or current.get(
                "is_founder"
            )
        )
    )


def require_stealth_founder(
    current: dict,
):
    if not is_stealth_founder(
        current
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Stealth Founder only."
            ),
        )


async def ensure_state(
    game_id: str,
):
    now = _iso()

    await (
        db.realmlife_environment
        .update_one(
            {
                "game_id":
                    game_id
            },
            {
                "$setOnInsert": {
                    "game_id":
                        game_id,

                    "world_mode":
                        "live",

                    "auto_weather":
                        True,

                    # Default:
                    # 24 REAL minutes =
                    # 24 RealmLife hours.
                    #
                    # Founder can change this later.
                    "day_length_real_minutes":
                        DEFAULT_DAY_LENGTH_REAL_MINUTES,

                    "epoch_real":
                        now,

                    "epoch_realm_minute":
                        0.0,

                    "manual_events":
                        [],

                    "schedules":
                        [],

                    "created_at":
                        now,

                    "updated_at":
                        now,
                }
            },
            upsert=True,
        )
    )

    return await (
        db.realmlife_environment
        .find_one(
            {
                "game_id":
                    game_id
            },
            {"_id": 0},
        )
    )


def _rate(
    state,
):
    day_length = float(
        state.get(
            "day_length_real_minutes"
        )
        or DEFAULT_DAY_LENGTH_REAL_MINUTES
    )

    day_length = max(
        1.0,
        day_length,
    )

    # RealmLife minutes
    # advanced per real second.
    return (
        1440.0
        /
        (
            day_length
            * 60.0
        )
    )


def _total_realm_minutes(
    state,
):
    epoch_real = _parse_iso(
        state.get(
            "epoch_real"
        )
    )

    elapsed = max(
        0.0,
        (
            _now()
            - epoch_real
        ).total_seconds(),
    )

    return (
        float(
            state.get(
                "epoch_realm_minute"
            )
            or 0.0
        )
        +
        elapsed
        * _rate(
            state
        )
    )


def _clock_payload(
    state,
):
    total = (
        _total_realm_minutes(
            state
        )
    )

    day_index = int(
        total // 1440
    )

    minute_of_day = int(
        total % 1440
    )

    hour = (
        minute_of_day
        // 60
    )

    minute = (
        minute_of_day
        % 60
    )

    if hour < 5:
        phase = "deep_night"
    elif hour < 7:
        phase = "sunrise"
    elif hour < 11:
        phase = "morning"
    elif hour < 14:
        phase = "high_noon"
    elif hour < 17:
        phase = "afternoon"
    elif hour < 19:
        phase = "sunset"
    elif hour < 21:
        phase = "dusk"
    else:
        phase = "night"

    moon_index = (
        day_index
        % len(
            MOON_PHASES
        )
    )

    suffix = (
        "AM"
        if hour < 12
        else "PM"
    )

    display_hour = (
        hour % 12
        or 12
    )

    return {
        "total_realm_minutes":
            total,

        "day":
            day_index + 1,

        "minute_of_day":
            minute_of_day,

        "hour":
            hour,

        "minute":
            minute,

        "formatted":
            (
                f"{display_hour}:"
                f"{minute:02d} "
                f"{suffix}"
            ),

        "phase":
            phase,

        "realm_minutes_per_real_second":
            _rate(
                state
            ),

        "day_length_real_minutes":
            float(
                state.get(
                    "day_length_real_minutes"
                )
                or
                DEFAULT_DAY_LENGTH_REAL_MINUTES
            ),

        "moon": {
            "phase_index":
                moon_index,

            "phase":
                MOON_PHASES[
                    moon_index
                ],
        },
    }


async def _active_weather(
    game_id,
    state,
):
    clock = _clock_payload(
        state
    )

    total = float(
        clock[
            "total_realm_minutes"
        ]
    )

    # Prevent old one-shot weather events
    # from accumulating forever.
    await (
        db.realmlife_environment
        .update_one(
            {
                "game_id":
                    game_id
            },
            {
                "$pull": {
                    "manual_events": {
                        "end_realm_minute": {
                            "$lte":
                                total
                        }
                    }
                }
            },
        )
    )

    # Refresh after cleanup.
    state = await (
        db.realmlife_environment
        .find_one(
            {
                "game_id":
                    game_id
            },
            {"_id": 0},
        )
    ) or state

    active = []

    for event in (
        state.get(
            "manual_events"
        )
        or []
    ):
        start = float(
            event.get(
                "start_realm_minute"
            )
            or 0
        )

        end = float(
            event.get(
                "end_realm_minute"
            )
            or 0
        )

        if (
            start
            <= total
            < end
        ):
            active.append(
                {
                    **event,
                    "source":
                        "manual",
                }
            )

    if state.get(
        "auto_weather",
        True,
    ):
        for schedule in (
            state.get(
                "schedules"
            )
            or []
        ):
            if not schedule.get(
                "enabled",
                True,
            ):
                continue

            start = float(
                schedule.get(
                    "start_realm_minute"
                )
                or 0
            )

            every = float(
                schedule.get(
                    "every_realm_minutes"
                )
                or 0
            )

            duration = float(
                schedule.get(
                    "duration_realm_minutes"
                )
                or 0
            )

            if (
                every <= 0
                or duration <= 0
                or total < start
            ):
                continue

            position = (
                (
                    total
                    - start
                )
                % every
            )

            if (
                position
                < duration
            ):
                active.append(
                    {
                        "id":
                            schedule[
                                "id"
                            ],

                        "weather":
                            schedule[
                                "weather"
                            ],

                        "source":
                            "schedule",

                        "schedule_id":
                            schedule[
                                "id"
                            ],

                        "remaining_realm_minutes":
                            max(
                                0,
                                duration
                                - position,
                            ),
                    }
                )

    return active


async def status(
    game_id: str,
    current: dict,
):
    state = await ensure_state(
        game_id
    )

    clock = _clock_payload(
        state
    )

    active = await _active_weather(
        game_id,
        state,
    )

    founder = (
        is_stealth_founder(
            current
        )
    )

    payload = {
        "game_id":
            game_id,

        "world_mode":
            state.get(
                "world_mode",
                "live",
            ),

        "auto_weather":
            bool(
                state.get(
                    "auto_weather",
                    True,
                )
            ),

        "world":
            clock,

        "active_weather":
            active,

        "weather_types":
            WEATHER_TYPES,

        "is_stealth_founder":
            founder,
    }

    if founder:
        from services import (
            waitlist as wl
        )

        payload[
            "admin"
        ] = {
            "schedules":
                state.get(
                    "schedules"
                )
                or [],

            "signup":
                await wl.get_signup_mode(),
        }

    return payload


async def assert_play_allowed(
    game_id: str,
    current: dict,
):
    state = await ensure_state(
        game_id
    )

    if (
        state.get(
            "world_mode"
        )
        == "maintenance"
        and not is_stealth_founder(
            current
        )
    ):
        raise HTTPException(
            status_code=503,
            detail=(
                "RealmLife is currently "
                "in maintenance mode."
            ),
        )


async def set_world_mode(
    game_id,
    current,
    mode,
):
    require_stealth_founder(
        current
    )

    mode = str(
        mode or ""
    ).lower()

    if mode not in (
        "live",
        "maintenance",
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid RealmLife mode."
            ),
        )

    await ensure_state(
        game_id
    )

    await (
        db.realmlife_environment
        .update_one(
            {
                "game_id":
                    game_id
            },
            {
                "$set": {
                    "world_mode":
                        mode,

                    "updated_at":
                        _iso(),

                    "updated_by":
                        current[
                            "id"
                        ],
                }
            },
        )
    )

    return await status(
        game_id,
        current,
    )


async def set_signup_paused(
    game_id,
    current,
    paused,
):
    require_stealth_founder(
        current
    )

    from services import (
        waitlist as wl
    )

    paused = bool(
        paused
    )

    mode = (
        "existing_only"
        if paused
        else "open"
    )

    reason = (
        "Paused from RealmLife "
        "Founder Control"
        if paused
        else ""
    )

    await wl.set_signup_mode(
        current,
        mode,
        reason,
    )

    return await status(
        game_id,
        current,
    )


async def set_world_time(
    game_id,
    current,
    *,
    hour,
    minute,
):
    require_stealth_founder(
        current
    )

    state = await ensure_state(
        game_id
    )

    try:
        hour = int(
            hour
        )

        minute = int(
            minute
        )
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid time.",
        )

    if (
        hour < 0
        or hour > 23
        or minute < 0
        or minute > 59
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid time.",
        )

    current_total = (
        _total_realm_minutes(
            state
        )
    )

    current_day = int(
        current_total
        // 1440
    )

    target_total = (
        current_day
        * 1440
        +
        hour
        * 60
        +
        minute
    )

    await (
        db.realmlife_environment
        .update_one(
            {
                "game_id":
                    game_id
            },
            {
                "$set": {
                    "epoch_real":
                        _iso(),

                    "epoch_realm_minute":
                        float(
                            target_total
                        ),

                    "updated_at":
                        _iso(),

                    "updated_by":
                        current[
                            "id"
                        ],
                }
            },
        )
    )

    return await status(
        game_id,
        current,
    )


async def set_day_length(
    game_id,
    current,
    minutes,
):
    require_stealth_founder(
        current
    )

    state = await ensure_state(
        game_id
    )

    try:
        minutes = float(
            minutes
        )
    except Exception:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid day length."
            ),
        )

    if (
        minutes < 1
        or minutes > 1440
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Day length must be "
                "1–1440 real minutes."
            ),
        )

    # Rebase so changing speed
    # never jumps the world clock.
    current_total = (
        _total_realm_minutes(
            state
        )
    )

    await (
        db.realmlife_environment
        .update_one(
            {
                "game_id":
                    game_id
            },
            {
                "$set": {
                    "day_length_real_minutes":
                        minutes,

                    "epoch_real":
                        _iso(),

                    "epoch_realm_minute":
                        current_total,

                    "updated_at":
                        _iso(),
                }
            },
        )
    )

    return await status(
        game_id,
        current,
    )


async def set_auto_weather(
    game_id,
    current,
    enabled,
):
    require_stealth_founder(
        current
    )

    await ensure_state(
        game_id
    )

    await (
        db.realmlife_environment
        .update_one(
            {
                "game_id":
                    game_id
            },
            {
                "$set": {
                    "auto_weather":
                        bool(
                            enabled
                        ),

                    "updated_at":
                        _iso(),
                }
            },
        )
    )

    return await status(
        game_id,
        current,
    )


async def activate_weather(
    game_id,
    current,
    *,
    weather,
    duration_realm_hours,
):
    require_stealth_founder(
        current
    )

    weather = str(
        weather or ""
    ).lower()

    if (
        weather not in
        WEATHER_TYPES
        or weather == "clear"
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid weather type."
            ),
        )

    try:
        hours = float(
            duration_realm_hours
        )
    except Exception:
        hours = 1.0

    hours = min(
        168.0,
        max(
            0.1,
            hours,
        ),
    )

    state = await ensure_state(
        game_id
    )

    total = (
        _total_realm_minutes(
            state
        )
    )

    event = {
        "id":
            "weather-"
            + uuid.uuid4().hex[
                :14
            ],

        "weather":
            weather,

        "start_realm_minute":
            total,

        "end_realm_minute":
            (
                total
                +
                hours
                * 60.0
            ),

        "created_at":
            _iso(),

        "created_by":
            current[
                "id"
            ],
    }

    await (
        db.realmlife_environment
        .update_one(
            {
                "game_id":
                    game_id
            },
            {
                "$push": {
                    "manual_events":
                        event
                },

                "$set": {
                    "updated_at":
                        _iso()
                },
            },
        )
    )

    return await status(
        game_id,
        current,
    )


async def clear_manual_weather(
    game_id,
    current,
):
    require_stealth_founder(
        current
    )

    await ensure_state(
        game_id
    )

    await (
        db.realmlife_environment
        .update_one(
            {
                "game_id":
                    game_id
            },
            {
                "$set": {
                    "manual_events":
                        [],

                    "updated_at":
                        _iso(),
                }
            },
        )
    )

    return await status(
        game_id,
        current,
    )


async def add_schedule(
    game_id,
    current,
    *,
    weather,
    duration_realm_hours,
    every_realm_hours,
    enabled=True,
):
    require_stealth_founder(
        current
    )

    weather = str(
        weather or ""
    ).lower()

    if (
        weather not in
        WEATHER_TYPES
        or weather == "clear"
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid weather type."
            ),
        )

    try:
        duration = float(
            duration_realm_hours
        )

        every = float(
            every_realm_hours
        )
    except Exception:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid weather schedule."
            ),
        )

    duration = min(
        168.0,
        max(
            0.1,
            duration,
        ),
    )

    every = min(
        8760.0,
        max(
            0.1,
            every,
        ),
    )

    state = await ensure_state(
        game_id
    )

    total = (
        _total_realm_minutes(
            state
        )
    )

    schedule = {
        "id":
            "schedule-"
            + uuid.uuid4().hex[
                :14
            ],

        "weather":
            weather,

        "enabled":
            bool(
                enabled
            ),

        "duration_realm_minutes":
            duration
            * 60.0,

        "every_realm_minutes":
            every
            * 60.0,

        "start_realm_minute":
            total,

        "created_at":
            _iso(),

        "created_by":
            current[
                "id"
            ],
    }

    await (
        db.realmlife_environment
        .update_one(
            {
                "game_id":
                    game_id
            },
            {
                "$push": {
                    "schedules":
                        schedule
                },

                "$set": {
                    "updated_at":
                        _iso()
                },
            },
        )
    )

    return await status(
        game_id,
        current,
    )


async def remove_schedule(
    game_id,
    current,
    schedule_id,
):
    require_stealth_founder(
        current
    )

    await ensure_state(
        game_id
    )

    await (
        db.realmlife_environment
        .update_one(
            {
                "game_id":
                    game_id
            },
            {
                "$pull": {
                    "schedules": {
                        "id":
                            str(
                                schedule_id
                                or ""
                            )[:100]
                    }
                },

                "$set": {
                    "updated_at":
                        _iso()
                },
            },
        )
    )

    return await status(
        game_id,
        current,
    )



async def realm_minutes_per_real_second(
    game_id: str,
) -> float:
    """
    Authoritative RealmLife clock speed.

    Reward systems use this instead of trusting
    RealmLife-minute counts sent by the browser.
    """

    state = await ensure_state(
        game_id
    )

    return float(
        _rate(
            state
        )
    )
