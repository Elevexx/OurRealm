"""
RealmLife Festival Stage Audio.

Three persistent server-authoritative stage stations.

Important:
- the server stores the playback CLOCK, not an always-running audio process
- users joining later calculate the same current track + offset
- playback therefore continues while the founder is offline
- canonical OurRealm Sounds + personal Sound playlists are reused
"""

from datetime import datetime, timezone
import random
import time

from fastapi import HTTPException

from core.db import db
from core.permissions import get_admin_role, ROLE_FOUNDER


STAGES = {
    "festival-stage-one": "STAGE ONE",
    "festival-stage-two": "STAGE TWO",
    "festival-stage-three": "STAGE THREE",

    # Existing Genesis City music venues.
    # Their procedural WebAudio remains the DEFAULT soundtrack.
    "night-lounge": "NIGHT LOUNGE",
    "pulse-club": "CLUB 178",
}


CLUB_VENUES = {
    "night-lounge",
    "pulse-club",
}

ACCESS_MODES = {
    "public_open",
    "public_fire_power",
    "private_invited",
    "private_closed",
    "maintenance_founder",
}


def now_dt():
    return datetime.now(timezone.utc)


def now_iso():
    return now_dt().isoformat()


def parse_iso(value):
    if not value:
        return None

    try:
        dt = datetime.fromisoformat(
            str(value).replace("Z", "+00:00")
        )

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)

        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def founder_only(current):
    if (
        not current
        or get_admin_role(current) != ROLE_FOUNDER
    ):
        raise HTTPException(
            status_code=403,
            detail="Founder access only.",
        )



def active_delegates(
    doc,
    at=None,
):
    at = at or now_dt()

    output = []

    for entry in (
        doc.get("delegates")
        or []
    ):
        if not isinstance(
            entry,
            dict,
        ):
            continue

        expires = parse_iso(
            entry.get(
                "expires_at"
            )
        )

        if (
            expires
            and
            expires <= at
        ):
            continue

        output.append({
            "user_id":
                entry.get("user_id"),

            "username":
                entry.get("username"),

            "expires_at":
                entry.get("expires_at"),

            "added_at":
                entry.get("added_at"),
        })

    return output


def user_can_manage_audio(
    current,
    doc,
):
    if (
        current
        and
        get_admin_role(current)
        == ROLE_FOUNDER
    ):
        return True

    user_id = (
        current.get("id")
        if current
        else None
    )

    if not user_id:
        return False

    return any(
        entry.get("user_id")
        == user_id
        for entry
        in active_delegates(doc)
    )


async def require_audio_manager(
    game_id,
    stage_id,
    current,
):
    doc = await get_doc(
        game_id,
        stage_id,
    )

    if not user_can_manage_audio(
        current,
        doc,
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "You do not currently have "
                "music control for this venue."
            ),
        )

    return doc


def validate_stage(stage_id):
    if stage_id not in STAGES:
        raise HTTPException(
            status_code=404,
            detail="RealmLife music venue not found.",
        )


async def ensure_indexes():
    await db.realmlife_stage_audio.create_index(
        [
            ("game_id", 1),
            ("stage_id", 1),
        ],
        unique=True,
    )


def default_doc(game_id, stage_id):
    return {
        "game_id": game_id,
        "stage_id": stage_id,
        "label": STAGES[stage_id],

        "source_type": None,
        "source_id": None,
        "source_name": None,

        "status": "stopped",

        # Absolute UTC clock used by everyone.
        "started_at": None,

        # Timeline position used while paused.
        "paused_offset_seconds": 0.0,

        "shuffle": False,
        "repeat_one": False,
        "repeat_all": True,

        "shuffle_seed": int(time.time()),

        # Optional playlist start anchor.
        "start_track_id": None,

        # One future start can be queued.
        # Later we can expand this to the full recurring weather-style UI.
        "scheduled_start_at": None,

        "access_mode": "public_open",
        "fire_power_cost": 0,
        "invited_user_ids": [],
        "maintenance_user_ids": [],

        # Club 178 / Night Lounge return to their original
        # procedural soundtrack whenever no custom broadcast
        # is actively playing.
        "default_fallback_enabled":
            stage_id in CLUB_VENUES,

        # Temporary/permanent music operators.
        # These grants DO NOT provide founder/admin privileges.
        "delegates": [],

        "updated_at": now_iso(),
    }


async def get_doc(game_id, stage_id):
    validate_stage(stage_id)
    await ensure_indexes()

    doc = await db.realmlife_stage_audio.find_one(
        {
            "game_id": game_id,
            "stage_id": stage_id,
        },
        {"_id": 0},
    )

    if doc:
        return doc

    doc = default_doc(
        game_id,
        stage_id,
    )

    await db.realmlife_stage_audio.update_one(
        {
            "game_id": game_id,
            "stage_id": stage_id,
        },
        {
            "$setOnInsert": doc,
        },
        upsert=True,
    )

    return doc


async def track_by_id(track_id):
    if not track_id:
        return None

    return await db.tracks.find_one(
        {
            "id": str(track_id),
        },
        {
            "_id": 0,
            "id": 1,
            "title": 1,
            "artist_username": 1,
            "username": 1,
            "file_url": 1,
            "stream_url": 1,
            "audio_url": 1,
            "duration_seconds": 1,
            "duration": 1,
            "user_id": 1,
            "visibility": 1,
            "deleted_at": 1,
            "moderation_status": 1,
        },
    )


def track_duration(track):
    if not track:
        return 0.0

    try:
        value = float(
            track.get("duration_seconds")
            or track.get("duration")
            or 0
        )
    except Exception:
        value = 0.0

    return max(
        0.0,
        value,
    )


def public_track(track):
    if not track:
        return None

    return {
        "id": track.get("id"),
        "title": (
            track.get("title")
            or "Untitled Sound"
        ),
        "artist": (
            track.get("artist_username")
            or track.get("username")
            or "OurRealm"
        ),
        "duration_seconds": track_duration(track),
    }


async def validate_owned_sound(
    track_id,
    current,
):
    track = await track_by_id(track_id)

    if (
        not track
        or track.get("deleted_at")
    ):
        raise HTTPException(
            status_code=404,
            detail="Sound not found.",
        )

    # Founder can assign public Sounds or Sounds they own.
    if (
        track.get("visibility") not in (None, "public")
        and track.get("user_id") != current["id"]
    ):
        raise HTTPException(
            status_code=403,
            detail="That Sound is private.",
        )

    return track


async def playlist_tracks(
    playlist_id,
    owner_id,
):
    playlist = await db.playlists.find_one(
        {
            "id": playlist_id,
            "owner_id": owner_id,
        },
        {
            "_id": 0,
        },
    )

    if not playlist:
        raise HTTPException(
            status_code=404,
            detail="Playlist not found.",
        )

    items = await db.playlist_items.find(
        {
            "playlist_id": playlist_id,
        },
        {
            "_id": 0,
        },
    ).sort(
        "position",
        1,
    ).to_list(
        length=1000,
    )

    ids = [
        item.get("track_id")
        for item in items
        if item.get("track_id")
    ]

    if not ids:
        raise HTTPException(
            status_code=400,
            detail="That playlist is empty.",
        )

    rows = await db.tracks.find(
        {
            "id": {
                "$in": ids,
            },
        },
        {
            "_id": 0,
            "id": 1,
            "title": 1,
            "artist_username": 1,
            "username": 1,
            "file_url": 1,
            "stream_url": 1,
            "audio_url": 1,
            "duration_seconds": 1,
            "duration": 1,
            "user_id": 1,
            "visibility": 1,
            "deleted_at": 1,
            "moderation_status": 1,
        },
    ).to_list(
        length=1000,
    )

    by_id = {
        row.get("id"): row
        for row in rows
    }

    ordered = []

    for track_id in ids:
        track = by_id.get(track_id)

        if not track:
            continue

        if track.get("deleted_at"):
            continue

        if track.get(
            "moderation_status"
        ) in (
            "rejected",
            "hidden",
            "removed",
            "suspended",
        ):
            continue

        # Playlist belongs to founder.
        # Private tracks must also belong to founder.
        if (
            track.get("visibility")
            not in (None, "public")
            and track.get("user_id") != owner_id
        ):
            continue

        if track_duration(track) <= 0:
            continue

        ordered.append(track)

    if not ordered:
        raise HTTPException(
            status_code=400,
            detail="Playlist has no playable Sounds.",
        )

    return playlist, ordered


async def source_tracks(
    doc,
):
    source_type = doc.get(
        "source_type"
    )

    source_id = doc.get(
        "source_id"
    )

    owner_id = doc.get(
        "owner_user_id"
    )

    if (
        not source_type
        or not source_id
        or not owner_id
    ):
        return [], None

    if source_type == "sound":
        track = await track_by_id(
            source_id
        )

        if (
            not track
            or track.get("deleted_at")
            or track_duration(track) <= 0
        ):
            return [], None

        return [track], track.get("title")

    if source_type == "playlist":
        playlist, tracks = await playlist_tracks(
            source_id,
            owner_id,
        )

        return (
            tracks,
            playlist.get("name"),
        )

    return [], None


def order_tracks(
    tracks,
    doc,
):
    tracks = list(tracks)

    if not tracks:
        return tracks

    if doc.get("shuffle"):
        rng = random.Random(
            int(
                doc.get("shuffle_seed")
                or 1
            )
        )

        rng.shuffle(tracks)

    start_track_id = doc.get(
        "start_track_id"
    )

    if start_track_id:
        index = next(
            (
                idx
                for idx, track
                in enumerate(tracks)
                if track.get("id")
                == start_track_id
            ),
            None,
        )

        if index is not None:
            tracks = (
                tracks[index:]
                + tracks[:index]
            )

    return tracks


def timeline_offset(
    doc,
    at=None,
):
    status = doc.get(
        "status"
    )

    if status == "paused":
        return max(
            0.0,
            float(
                doc.get(
                    "paused_offset_seconds"
                )
                or 0
            ),
        )

    if status != "playing":
        return 0.0

    start = parse_iso(
        doc.get("started_at")
    )

    if not start:
        return 0.0

    at = at or now_dt()

    return max(
        0.0,
        (
            at - start
        ).total_seconds(),
    )


def resolve_timeline(
    tracks,
    doc,
    offset,
):
    tracks = order_tracks(
        tracks,
        doc,
    )

    if not tracks:
        return {
            "playing": False,
            "track": None,
            "track_index": None,
            "offset_seconds": 0.0,
            "ended": True,
        }

    # Repeat current Sound forever.
    if doc.get("repeat_one"):
        track = tracks[0]
        duration = track_duration(track)

        if duration <= 0:
            return {
                "playing": False,
                "track": None,
                "track_index": None,
                "offset_seconds": 0.0,
                "ended": True,
            }

        return {
            "playing": True,
            "track": track,
            "track_index": 0,
            "offset_seconds": (
                offset % duration
            ),
            "ended": False,
        }

    durations = [
        track_duration(track)
        for track in tracks
    ]

    total = sum(durations)

    if total <= 0:
        return {
            "playing": False,
            "track": None,
            "track_index": None,
            "offset_seconds": 0.0,
            "ended": True,
        }

    if doc.get("repeat_all"):
        offset = offset % total
    elif offset >= total:
        return {
            "playing": False,
            "track": None,
            "track_index": None,
            "offset_seconds": 0.0,
            "ended": True,
        }

    cursor = 0.0

    for index, track in enumerate(tracks):
        duration = durations[index]

        if (
            offset <
            cursor + duration
        ):
            return {
                "playing": True,
                "track": track,
                "track_index": index,
                "offset_seconds": (
                    offset - cursor
                ),
                "ended": False,
            }

        cursor += duration

    return {
        "playing": False,
        "track": None,
        "track_index": None,
        "offset_seconds": 0.0,
        "ended": True,
    }


async def apply_scheduled_start(
    game_id,
    stage_id,
    doc,
):
    scheduled = parse_iso(
        doc.get(
            "scheduled_start_at"
        )
    )

    if (
        not scheduled
        or scheduled > now_dt()
    ):
        return doc

    await db.realmlife_stage_audio.update_one(
        {
            "game_id": game_id,
            "stage_id": stage_id,
            "scheduled_start_at":
                doc.get(
                    "scheduled_start_at"
                ),
        },
        {
            "$set": {
                "status": "playing",
                "started_at":
                    scheduled.isoformat(),
                "paused_offset_seconds":
                    0.0,
                "scheduled_start_at":
                    None,
                "updated_at":
                    now_iso(),
            }
        },
    )

    fresh = await db.realmlife_stage_audio.find_one(
        {
            "game_id": game_id,
            "stage_id": stage_id,
        },
        {"_id": 0},
    )

    return fresh or doc


async def state(
    game_id,
    stage_id,
):
    doc = await get_doc(
        game_id,
        stage_id,
    )

    doc = await apply_scheduled_start(
        game_id,
        stage_id,
        doc,
    )

    tracks, source_name = (
        await source_tracks(doc)
    )

    offset = timeline_offset(
        doc
    )

    resolved = resolve_timeline(
        tracks,
        doc,
        offset,
    )

    effective_status = (
        doc.get("status")
    )

    if (
        effective_status == "playing"
        and resolved.get("ended")
    ):
        effective_status = "stopped"

    return {
        "stage_id": stage_id,
        "label": STAGES[stage_id],

        "source_type":
            doc.get("source_type"),

        "source_id":
            doc.get("source_id"),

        "source_name":
            source_name
            or doc.get("source_name"),

        "status":
            effective_status,

        "shuffle":
            bool(
                doc.get("shuffle")
            ),

        "repeat_one":
            bool(
                doc.get("repeat_one")
            ),

        "repeat_all":
            bool(
                doc.get("repeat_all")
            ),

        "is_club":
            stage_id in CLUB_VENUES,

        "default_fallback_enabled":
            bool(
                doc.get(
                    "default_fallback_enabled",
                    stage_id in CLUB_VENUES,
                )
            ),

        "using_default_audio":
            bool(
                stage_id in CLUB_VENUES
                and
                doc.get(
                    "default_fallback_enabled",
                    True,
                )
                and
                not (
                    effective_status
                    == "playing"
                    and
                    resolved.get("track")
                )
            ),

        "delegates":
            active_delegates(
                doc
            ),

        "started_at":
            doc.get("started_at"),

        "scheduled_start_at":
            doc.get(
                "scheduled_start_at"
            ),

        "current_track":
            public_track(
                resolved.get("track")
            ),

        "current_track_index":
            resolved.get(
                "track_index"
            ),

        "current_offset_seconds":
            round(
                float(
                    resolved.get(
                        "offset_seconds"
                    )
                    or 0
                ),
                3,
            ),

        "playlist_track_count":
            len(tracks),

        "access_mode":
            doc.get(
                "access_mode"
            )
            or "public_open",

        "fire_power_cost":
            int(
                doc.get(
                    "fire_power_cost"
                )
                or 0
            ),

        "invited_user_ids":
            doc.get(
                "invited_user_ids"
            )
            or [],

        "maintenance_user_ids":
            doc.get(
                "maintenance_user_ids"
            )
            or [],
    }


async def list_states(
    game_id,
):
    return {
        "stages": [
            await state(
                game_id,
                stage_id,
            )
            for stage_id in STAGES
        ]
    }


async def founder_library(
    current,
):
    # Founder OR delegated DJ.
    # Library is always scoped to the currently authenticated
    # person's own playlists plus playable public Sounds.
    playlists = await db.playlists.find(
        {
            "owner_id": current["id"],
        },
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "created_at": 1,
            "updated_at": 1,
        },
    ).sort(
        "created_at",
        -1,
    ).to_list(
        length=100,
    )

    sounds = await db.tracks.find(
        {
            "$or": [
                {
                    "user_id":
                        current["id"],
                },
                {
                    "visibility":
                        "public",
                },
            ],
            "deleted_at": {
                "$exists": False,
            },
        },
        {
            "_id": 0,
            "id": 1,
            "title": 1,
            "artist_username": 1,
            "username": 1,
            "duration_seconds": 1,
            "duration": 1,
            "user_id": 1,
            "visibility": 1,
        },
    ).sort(
        "created_at",
        -1,
    ).limit(
        300,
    ).to_list(
        length=300,
    )

    return {
        "playlists": playlists,
        "sounds": [
            public_track(track)
            for track in sounds
            if track_duration(track) > 0
        ],
    }


async def set_source(
    game_id,
    stage_id,
    current,
    body,
):
    await require_audio_manager(
        game_id,
        stage_id,
        current,
    )

    validate_stage(stage_id)

    source_type = str(
        body.get("source_type")
        or ""
    ).strip().lower()

    source_id = str(
        body.get("source_id")
        or ""
    ).strip()

    if source_type not in (
        "sound",
        "playlist",
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "source_type must be "
                "sound or playlist."
            ),
        )

    if not source_id:
        raise HTTPException(
            status_code=400,
            detail="source_id is required.",
        )

    source_name = None
    start_track_id = None

    if source_type == "sound":
        track = await validate_owned_sound(
            source_id,
            current,
        )

        source_name = (
            track.get("title")
            or "Sound"
        )

        start_track_id = track.get("id")

    else:
        playlist, tracks = await playlist_tracks(
            source_id,
            current["id"],
        )

        source_name = playlist.get(
            "name"
        )

        requested_start = body.get(
            "start_track_id"
        )

        valid_ids = {
            track.get("id")
            for track in tracks
        }

        if (
            requested_start
            and requested_start
            in valid_ids
        ):
            start_track_id = (
                requested_start
            )

    autoplay = bool(
        body.get(
            "autoplay",
            True,
        )
    )

    shuffle = bool(
        body.get(
            "shuffle",
            False,
        )
    )

    repeat_one = bool(
        body.get(
            "repeat_one",
            False,
        )
    )

    repeat_all = bool(
        body.get(
            "repeat_all",
            True,
        )
    )

    doc = {
        "game_id": game_id,
        "stage_id": stage_id,
        "label": STAGES[stage_id],

        "owner_user_id":
            current["id"],

        "owner_username":
            current.get("username"),

        "source_type":
            source_type,

        "source_id":
            source_id,

        "source_name":
            source_name,

        "status":
            (
                "playing"
                if autoplay
                else "stopped"
            ),

        "started_at":
            (
                now_iso()
                if autoplay
                else None
            ),

        "paused_offset_seconds":
            0.0,

        "shuffle":
            shuffle,

        "repeat_one":
            repeat_one,

        "repeat_all":
            repeat_all,

        "shuffle_seed":
            int(time.time()),

        "start_track_id":
            start_track_id,

        "scheduled_start_at":
            None,

        "updated_at":
            now_iso(),
    }

    await ensure_indexes()

    await db.realmlife_stage_audio.update_one(
        {
            "game_id": game_id,
            "stage_id": stage_id,
        },
        {
            "$set": doc,
            "$setOnInsert": {
                "access_mode":
                    "public_open",

                "fire_power_cost":
                    0,

                "invited_user_ids":
                    [],

                "maintenance_user_ids":
                    [],
            },
        },
        upsert=True,
    )

    return await state(
        game_id,
        stage_id,
    )


async def control(
    game_id,
    stage_id,
    current,
    body,
):
    await require_audio_manager(
        game_id,
        stage_id,
        current,
    )

    doc = await get_doc(
        game_id,
        stage_id,
    )

    action = str(
        body.get("action")
        or ""
    ).strip().lower()

    if action == "play":
        offset = timeline_offset(
            doc
        )

        await db.realmlife_stage_audio.update_one(
            {
                "game_id": game_id,
                "stage_id": stage_id,
            },
            {
                "$set": {
                    "status":
                        "playing",

                    "started_at":
                        (
                            now_dt()
                            -
                            __import__(
                                "datetime"
                            ).timedelta(
                                seconds=offset
                            )
                        ).isoformat(),

                    "paused_offset_seconds":
                        0.0,

                    "scheduled_start_at":
                        None,

                    "updated_at":
                        now_iso(),
                }
            },
        )

    elif action == "pause":
        offset = timeline_offset(
            doc
        )

        await db.realmlife_stage_audio.update_one(
            {
                "game_id": game_id,
                "stage_id": stage_id,
            },
            {
                "$set": {
                    "status":
                        "paused",

                    "paused_offset_seconds":
                        offset,

                    "updated_at":
                        now_iso(),
                }
            },
        )

    elif action == "stop":
        await db.realmlife_stage_audio.update_one(
            {
                "game_id": game_id,
                "stage_id": stage_id,
            },
            {
                "$set": {
                    "status":
                        "stopped",

                    "started_at":
                        None,

                    "paused_offset_seconds":
                        0.0,

                    "scheduled_start_at":
                        None,

                    "updated_at":
                        now_iso(),
                }
            },
        )

    elif action in (
        "next",
        "previous",
    ):
        tracks, _ = await source_tracks(
            doc
        )

        ordered = order_tracks(
            tracks,
            doc,
        )

        if not ordered:
            raise HTTPException(
                status_code=400,
                detail="Stage has no playable Sound.",
            )

        current_state = resolve_timeline(
            tracks,
            doc,
            timeline_offset(doc),
        )

        current_id = (
            current_state
            .get("track", {})
            .get("id")
            if current_state.get("track")
            else None
        )

        current_index = next(
            (
                index
                for index, track
                in enumerate(ordered)
                if track.get("id")
                == current_id
            ),
            0,
        )

        if action == "next":
            target_index = (
                current_index + 1
            ) % len(ordered)
        else:
            target_index = (
                current_index - 1
            ) % len(ordered)

        target = ordered[
            target_index
        ]

        await db.realmlife_stage_audio.update_one(
            {
                "game_id": game_id,
                "stage_id": stage_id,
            },
            {
                "$set": {
                    "start_track_id":
                        target.get("id"),

                    "status":
                        "playing",

                    "started_at":
                        now_iso(),

                    "paused_offset_seconds":
                        0.0,

                    "updated_at":
                        now_iso(),
                }
            },
        )

    elif action == "options":
        set_values = {}

        for key in (
            "shuffle",
            "repeat_one",
            "repeat_all",
        ):
            if key in body:
                set_values[key] = bool(
                    body.get(key)
                )

        if (
            "default_fallback_enabled"
            in body
        ):
            if (
                stage_id
                not in CLUB_VENUES
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Default music fallback "
                        "only applies to clubs."
                    ),
                )

            # Delegated DJs can run music,
            # but only Founder chooses venue policy.
            founder_only(current)

            set_values[
                "default_fallback_enabled"
            ] = bool(
                body.get(
                    "default_fallback_enabled"
                )
            )

        if "shuffle" in set_values:
            set_values[
                "shuffle_seed"
            ] = int(time.time())

        if not set_values:
            raise HTTPException(
                status_code=400,
                detail="No options supplied.",
            )

        set_values[
            "updated_at"
        ] = now_iso()

        await db.realmlife_stage_audio.update_one(
            {
                "game_id": game_id,
                "stage_id": stage_id,
            },
            {
                "$set":
                    set_values
            },
        )

    else:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unknown stage action."
            ),
        )

    return await state(
        game_id,
        stage_id,
    )


async def schedule(
    game_id,
    stage_id,
    current,
    body,
):
    await require_audio_manager(
        game_id,
        stage_id,
        current,
    )

    await get_doc(
        game_id,
        stage_id,
    )

    value = body.get(
        "start_at"
    )

    dt = parse_iso(value)

    if not dt:
        raise HTTPException(
            status_code=400,
            detail=(
                "start_at must be "
                "an ISO date/time."
            ),
        )

    if dt <= now_dt():
        raise HTTPException(
            status_code=400,
            detail=(
                "Scheduled start must "
                "be in the future."
            ),
        )

    await db.realmlife_stage_audio.update_one(
        {
            "game_id": game_id,
            "stage_id": stage_id,
        },
        {
            "$set": {
                "scheduled_start_at":
                    dt.isoformat(),

                "updated_at":
                    now_iso(),
            }
        },
    )

    return await state(
        game_id,
        stage_id,
    )


async def set_access(
    game_id,
    stage_id,
    current,
    body,
):
    founder_only(current)

    mode = str(
        body.get(
            "access_mode"
        )
        or ""
    ).strip()

    if mode not in ACCESS_MODES:
        raise HTTPException(
            status_code=400,
            detail="Invalid access mode.",
        )

    fire_cost = max(
        0,
        int(
            body.get(
                "fire_power_cost"
            )
            or 0
        ),
    )

    invited = [
        str(value)
        for value in (
            body.get(
                "invited_user_ids"
            )
            or []
        )
        if value
    ][:500]

    maintenance = [
        str(value)
        for value in (
            body.get(
                "maintenance_user_ids"
            )
            or []
        )
        if value
    ][:500]

    await db.realmlife_stage_audio.update_one(
        {
            "game_id": game_id,
            "stage_id": stage_id,
        },
        {
            "$set": {
                "access_mode":
                    mode,

                "fire_power_cost":
                    fire_cost,

                "invited_user_ids":
                    invited,

                "maintenance_user_ids":
                    maintenance,

                "updated_at":
                    now_iso(),
            }
        },
        upsert=True,
    )

    return await state(
        game_id,
        stage_id,
    )



async def music_permissions(
    game_id,
    stage_id,
    current,
):
    doc = await get_doc(
        game_id,
        stage_id,
    )

    founder = (
        get_admin_role(current)
        == ROLE_FOUNDER
    )

    delegated_entry = next(
        (
            entry
            for entry
            in active_delegates(doc)
            if entry.get("user_id")
            == current.get("id")
        ),
        None,
    )

    return {
        "can_manage_audio":
            bool(
                founder
                or delegated_entry
            ),

        "can_manage_delegates":
            founder,

        "is_founder":
            founder,

        "delegated_until":
            (
                delegated_entry
                .get("expires_at")
                if delegated_entry
                else None
            ),
    }


async def set_delegate(
    game_id,
    stage_id,
    current,
    body,
):
    founder_only(current)

    doc = await get_doc(
        game_id,
        stage_id,
    )

    username = str(
        body.get("username")
        or ""
    ).strip().lower()

    if username.startswith("@"):
        username = username[1:]

    if not username:
        raise HTTPException(
            status_code=400,
            detail="Username is required.",
        )

    user = await db.users.find_one(
        {
            "username":
                username,
        },
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "name": 1,
            "avatar_url": 1,
        },
    )

    if not user:
        raise HTTPException(
            status_code=404,
            detail="OurRealm user not found.",
        )

    if (
        user.get("id")
        == current.get("id")
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Founder already has "
                "full music control."
            ),
        )

    expires_value = body.get(
        "expires_at"
    )

    expires = (
        parse_iso(
            expires_value
        )
        if expires_value
        else None
    )

    if (
        expires_value
        and
        not expires
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid expiration date/time.",
        )

    if (
        expires
        and
        expires <= now_dt()
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "DJ access expiration "
                "must be in the future."
            ),
        )

    delegates = [
        entry
        for entry
        in (
            doc.get("delegates")
            or []
        )
        if (
            isinstance(
                entry,
                dict,
            )
            and
            entry.get("user_id")
            != user.get("id")
        )
    ]

    delegates.append({
        "user_id":
            user.get("id"),

        "username":
            user.get("username"),

        "expires_at":
            (
                expires.isoformat()
                if expires
                else None
            ),

        "added_at":
            now_iso(),
    })

    await db.realmlife_stage_audio.update_one(
        {
            "game_id":
                game_id,

            "stage_id":
                stage_id,
        },
        {
            "$set": {
                "delegates":
                    delegates,

                "updated_at":
                    now_iso(),
            }
        },
        upsert=True,
    )

    fresh = await get_doc(
        game_id,
        stage_id,
    )

    return {
        "delegates":
            active_delegates(
                fresh
            ),
    }


async def remove_delegate(
    game_id,
    stage_id,
    user_id,
    current,
):
    founder_only(current)

    doc = await get_doc(
        game_id,
        stage_id,
    )

    delegates = [
        entry
        for entry
        in (
            doc.get("delegates")
            or []
        )
        if (
            isinstance(
                entry,
                dict,
            )
            and
            entry.get("user_id")
            != user_id
        )
    ]

    await db.realmlife_stage_audio.update_one(
        {
            "game_id":
                game_id,

            "stage_id":
                stage_id,
        },
        {
            "$set": {
                "delegates":
                    delegates,

                "updated_at":
                    now_iso(),
            }
        },
    )

    return {
        "delegates":
            active_delegates({
                "delegates":
                    delegates
            }),
    }


async def currently_authorized_track(
    game_id,
    stage_id,
    sound_id,
):
    current = await state(
        game_id,
        stage_id,
    )

    track = current.get(
        "current_track"
    )

    if (
        current.get("status")
        != "playing"
        or not track
        or track.get("id")
        != sound_id
    ):
        raise HTTPException(
            status_code=404,
            detail=(
                "That Sound is not "
                "currently playing "
                "on this stage."
            ),
        )

    full = await track_by_id(
        sound_id
    )

    if not full:
        raise HTTPException(
            status_code=404,
            detail="Sound not found.",
        )

    return full
