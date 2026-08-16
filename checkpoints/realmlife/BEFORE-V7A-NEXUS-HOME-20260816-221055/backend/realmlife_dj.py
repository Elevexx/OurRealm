"""
RealmLife DJ Studio.

Provides:
- public/owned OurRealm Sounds for DJ decks
- saved RealmLife Mix Sessions
- RealmLife Mix Playlists
- server ownership validation

A recorded mix session stores the complete mixer automation
timeline rather than trusting the browser to award anything
or modify another user's content.

Rendered audio export can be added later without changing this
session format.
"""

from datetime import (
    datetime,
    timezone,
)

import re
import uuid

from urllib.parse import quote

from fastapi import HTTPException

from core.db import db


MAX_EVENTS = 6000
MAX_SESSION_SECONDS = 4 * 60 * 60

ALLOWED_EVENTS = {
    "play",
    "pause",
    "seek",
    "volume",
    "eq",
    "crossfader",
    "mixer",
}


def now_iso():
    return datetime.now(
        timezone.utc
    ).isoformat()


async def ensure_indexes():

    await (
        db.realmlife_dj_sessions
        .create_index(
            "id",
            unique=True,
        )
    )

    await (
        db.realmlife_dj_sessions
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
                    "created_at",
                    -1,
                ),
            ]
        )
    )

    await (
        db.realmlife_dj_playlists
        .create_index(
            "id",
            unique=True,
        )
    )

    await (
        db.realmlife_dj_playlists
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
            ]
        )
    )


async def sound_collection():

    names = set(
        await db.list_collection_names()
    )

    preferred = [
        "sound_tracks",
        "sounds",
        "tracks",
    ]

    for name in preferred:

        if name not in names:
            continue

        sample = await (
            db[name]
            .find_one(
                {},
                {"_id": 0},
            )
        )

        if (
            sample is None
            or "id" in sample
        ):
            return (
                db[name],
                name,
            )


    for name in names:

        if (
            "sound"
            not in name.lower()
        ):
            continue

        sample = await (
            db[name]
            .find_one(
                {
                    "id": {
                        "$exists":
                            True
                    }
                },
                {"_id": 0},
            )
        )

        if sample:
            return (
                db[name],
                name,
            )


    raise HTTPException(
        status_code=503,
        detail=(
            "OurRealm Sounds library "
            "could not be resolved."
        ),
    )


def stream_url(
    sound,
):

    for field in [
        "stream_url",
        "audio_url",
        "file_url",
        "public_url",
        "url",
    ]:

        value = sound.get(
            field
        )

        if (
            isinstance(
                value,
                str,
            )
            and value.strip()
        ):
            return value.strip()


    for field in [
        "filename",
        "file_name",
        "stored_name",
        "storage_name",
        "audio_name",
        "file",
    ]:

        value = sound.get(
            field
        )

        if (
            isinstance(
                value,
                str,
            )
            and value.strip()
        ):
            return (
                "/api/sounds/file/"
                + quote(
                    value.strip()
                )
            )


    return None


def sound_owner_id(
    sound,
):

    return (
        sound.get(
            "user_id"
        )
        or sound.get(
            "owner_user_id"
        )
        or sound.get(
            "created_by"
        )
    )


def can_use_sound(
    sound,
    current,
):

    visibility = str(
        sound.get(
            "visibility"
        )
        or "public"
    ).lower()


    if visibility == "public":
        return True


    if (
        sound_owner_id(
            sound
        )
        == current["id"]
    ):
        return True


    if visibility == "custom":

        return (
            current["id"]
            in (
                sound.get(
                    "custom_user_ids"
                )
                or []
            )
        )


    return False


def public_sound(
    sound,
):

    return {
        "id":
            sound.get(
                "id"
            ),

        "title":
            sound.get(
                "title"
            )
            or sound.get(
                "name"
            )
            or "Untitled Sound",

        "artist":
            sound.get(
                "artist"
            )
            or sound.get(
                "username"
            )
            or sound.get(
                "author_username"
            )
            or "OurRealm",

        "username":
            sound.get(
                "username"
            )
            or sound.get(
                "author_username"
            ),

        "category":
            sound.get(
                "category"
            ),

        "duration":
            sound.get(
                "duration"
            )
            or sound.get(
                "duration_seconds"
            ),

        "stream_url":
            stream_url(
                sound
            ),
    }



# ============================================================
# REALMLIFE DJ TRUE AUDIO PROXY V5F2B1G
# ============================================================

async def playable_sound_for_user(
    sound_id,
    current,
):

    if not current:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
        )


    collection, _ = await (
        sound_collection()
    )


    sound = await collection.find_one(
        {
            "id": str(sound_id),
        },
        {
            "_id": 0,
        },
    )


    if not sound:
        raise HTTPException(
            status_code=404,
            detail="Sound not found.",
        )


    if sound.get("deleted_at"):
        raise HTTPException(
            status_code=404,
            detail="Sound not found.",
        )


    if not can_use_sound(
        sound,
        current,
    ):
        raise HTTPException(
            status_code=403,
            detail="Sound is not available to this user.",
        )


    return sound



def dj_upstream_audio_url(
    sound,
):

    from urllib.parse import (
        quote as url_quote,
        unquote,
        urlsplit,
    )


    source = stream_url(
        sound
    )


    if not source:
        raise HTTPException(
            status_code=404,
            detail="Sound has no audio source.",
        )


    source = str(source).strip()


    # --------------------------------------------
    # OurRealm canonical media proxy form:
    #
    # /api/media/audio/<filename>
    #
    # The actual stored media lives behind the
    # OurRealm media CDN.
    # --------------------------------------------

    prefix = "/api/media/audio/"

    if source.startswith(prefix):

        filename = unquote(
            source[len(prefix):]
        )


        if (
            not filename
            or "/" in filename
            or "\\" in filename
            or ".." in filename
        ):
            raise HTTPException(
                status_code=400,
                detail="Invalid Sound filename.",
            )


        return (
            "https://media.ourrealm.social/audio/"
            + url_quote(filename)
        )


    # --------------------------------------------
    # Legacy Sounds path.
    # --------------------------------------------

    legacy = "/api/sounds/file/"

    if source.startswith(legacy):

        filename = unquote(
            source[len(legacy):]
        )


        if (
            not filename
            or "/" in filename
            or "\\" in filename
            or ".." in filename
        ):
            raise HTTPException(
                status_code=400,
                detail="Invalid Sound filename.",
            )


        return (
            "https://media.ourrealm.social/audio/"
            + url_quote(filename)
        )


    # --------------------------------------------
    # Already on the approved OurRealm CDN.
    # --------------------------------------------

    if source.startswith(
        (
            "https://media.ourrealm.social/audio/",
            "http://media.ourrealm.social/audio/",
        )
    ):

        parsed = urlsplit(
            source
        )


        if (
            parsed.hostname
            != "media.ourrealm.social"
        ):
            raise HTTPException(
                status_code=400,
                detail="Unsupported Sound host.",
            )


        return source


    raise HTTPException(
        status_code=400,
        detail=(
            "RealmLife DJ does not support "
            "this Sound storage source yet."
        ),
    )



async def list_sounds(
    current,
    q="",
):

    collection, _ = await (
        sound_collection()
    )


    q = str(
        q or ""
    ).strip()[:100]


    visibility_query = {
        "$or": [
            {
                "visibility":
                    "public"
            },

            {
                "visibility": {
                    "$exists":
                        False
                }
            },

            {
                "user_id":
                    current["id"]
            },

            {
                "owner_user_id":
                    current["id"]
            },
        ]
    }


    query = visibility_query


    if q:

        regex = {
            "$regex":
                re.escape(q),

            "$options":
                "i",
        }


        query = {
            "$and": [
                visibility_query,

                {
                    "$or": [
                        {
                            "title":
                                regex
                        },

                        {
                            "name":
                                regex
                        },

                        {
                            "artist":
                                regex
                        },

                        {
                            "username":
                                regex
                        },
                    ]
                },
            ]
        }


    rows = await (
        collection.find(
            query,
            {"_id": 0},
        )
        .sort(
            "created_at",
            -1,
        )
        .limit(
            150
        )
        .to_list(
            length=150
        )
    )


    sounds = []

    for row in rows:

        if not can_use_sound(
            row,
            current,
        ):
            continue

        public = public_sound(
            row
        )

        if not public.get(
            "stream_url"
        ):
            continue

        sounds.append(
            public
        )


    return {
        "sounds":
            sounds
    }


async def ensure_default_playlist(
    game_id,
    current,
):

    await ensure_indexes()


    existing = await (
        db.realmlife_dj_playlists
        .find_one(
            {
                "game_id":
                    game_id,

                "owner_user_id":
                    current["id"],

                "is_default":
                    True,
            },
            {"_id": 0},
        )
    )


    if existing:
        return existing


    doc = {
        "id":
            "rldjpl-"
            + uuid.uuid4()
                .hex[:18],

        "game_id":
            game_id,

        "owner_user_id":
            current["id"],

        "owner_username":
            current.get(
                "username"
            ),

        "name":
            "My Recorded Mixes",

        "is_default":
            True,

        "session_ids":
            [],

        "created_at":
            now_iso(),

        "updated_at":
            now_iso(),
    }


    await (
        db.realmlife_dj_playlists
        .insert_one(
            doc
        )
    )


    doc.pop(
        "_id",
        None,
    )

    return doc


async def create_playlist(
    game_id,
    current,
    body,
):

    await ensure_indexes()


    count = await (
        db.realmlife_dj_playlists
        .count_documents(
            {
                "game_id":
                    game_id,

                "owner_user_id":
                    current["id"],
            }
        )
    )


    if count >= 30:

        raise HTTPException(
            status_code=400,
            detail=(
                "RealmLife Mix Playlist "
                "limit reached."
            ),
        )


    name = str(
        body.get(
            "name"
        )
        or "RealmLife Mixes"
    ).strip()[:80]


    if not name:

        name = (
            "RealmLife Mixes"
        )


    doc = {
        "id":
            "rldjpl-"
            + uuid.uuid4()
                .hex[:18],

        "game_id":
            game_id,

        "owner_user_id":
            current["id"],

        "owner_username":
            current.get(
                "username"
            ),

        "name":
            name,

        "is_default":
            False,

        "session_ids":
            [],

        "created_at":
            now_iso(),

        "updated_at":
            now_iso(),
    }


    await (
        db.realmlife_dj_playlists
        .insert_one(
            doc
        )
    )


    doc.pop(
        "_id",
        None,
    )


    return {
        "playlist":
            doc
    }


async def list_playlists(
    game_id,
    current,
):

    await ensure_default_playlist(
        game_id,
        current,
    )


    rows = await (
        db.realmlife_dj_playlists
        .find(
            {
                "game_id":
                    game_id,

                "owner_user_id":
                    current["id"],
            },
            {"_id": 0},
        )
        .sort(
            "created_at",
            1,
        )
        .to_list(
            length=30
        )
    )


    return {
        "playlists":
            rows
    }


def clean_track(
    raw,
):

    if not isinstance(
        raw,
        dict,
    ):
        return None


    sound_id = str(
        raw.get(
            "id"
        )
        or ""
    )[:120]


    if not sound_id:
        return None


    return {
        "id":
            sound_id,

        "title":
            str(
                raw.get(
                    "title"
                )
                or "Untitled"
            )[:160],

        "artist":
            str(
                raw.get(
                    "artist"
                )
                or ""
            )[:120],

        "stream_url":
            str(
                raw.get(
                    "stream_url"
                )
                or ""
            )[:1000],
    }


def clean_events(
    raw_events,
):

    if not isinstance(
        raw_events,
        list,
    ):
        return []


    out = []


    for event in raw_events[
        :MAX_EVENTS
    ]:

        if not isinstance(
            event,
            dict,
        ):
            continue


        event_type = str(
            event.get(
                "type"
            )
            or ""
        )


        if event_type not in (
            ALLOWED_EVENTS
        ):
            continue


        try:
            t = int(
                event.get(
                    "t"
                )
                or 0
            )
        except Exception:
            t = 0


        t = max(
            0,
            min(
                t,
                MAX_SESSION_SECONDS
                * 1000,
            ),
        )


        deck = str(
            event.get(
                "deck"
            )
            or ""
        ).upper()


        if deck not in {
            "",
            "A",
            "B",
        }:
            deck = ""


        clean = {
            "t":
                t,

            "type":
                event_type,

            "deck":
                deck,
        }


        for key in [
            "value",
            "band",
            "position",
            "enabled",
        ]:

            if key in event:

                value = event[
                    key
                ]


                if isinstance(
                    value,
                    (
                        int,
                        float,
                        bool,
                        str,
                    ),
                ):
                    clean[key] = value


        out.append(
            clean
        )


    out.sort(
        key=lambda e:
            e["t"]
    )


    return out


async def save_session(
    game_id,
    current,
    body,
):

    await ensure_indexes()


    title = str(
        body.get(
            "title"
        )
        or "RealmLife Mix"
    ).strip()[:100]


    if not title:

        title = (
            "RealmLife Mix"
        )


    try:
        duration_ms = int(
            body.get(
                "duration_ms"
            )
            or 0
        )
    except Exception:
        duration_ms = 0


    duration_ms = max(
        0,
        min(
            duration_ms,
            MAX_SESSION_SECONDS
            * 1000,
        ),
    )


    deck_a = clean_track(
        body.get(
            "deck_a"
        )
    )

    deck_b = clean_track(
        body.get(
            "deck_b"
        )
    )


    if not deck_a and not deck_b:

        raise HTTPException(
            status_code=400,
            detail=(
                "Load at least one "
                "Sound before saving a mix."
            ),
        )


    events = clean_events(
        body.get(
            "events"
        )
    )


    settings = (
        body.get(
            "settings"
        )
        if isinstance(
            body.get(
                "settings"
            ),
            dict,
        )
        else {}
    )


    doc = {
        "id":
            "rldjmix-"
            + uuid.uuid4()
                .hex[:20],

        "game_id":
            game_id,

        "owner_user_id":
            current["id"],

        "owner_username":
            current.get(
                "username"
            ),

        "title":
            title,

        "deck_a":
            deck_a,

        "deck_b":
            deck_b,

        "duration_ms":
            duration_ms,

        "events":
            events,

        "settings":
            settings,

        "created_at":
            now_iso(),

        "updated_at":
            now_iso(),
    }


    await (
        db.realmlife_dj_sessions
        .insert_one(
            doc
        )
    )


    playlist_id = str(
        body.get(
            "playlist_id"
        )
        or ""
    )[:100]


    playlist = None


    if playlist_id:

        playlist = await (
            db.realmlife_dj_playlists
            .find_one(
                {
                    "game_id":
                        game_id,

                    "id":
                        playlist_id,

                    "owner_user_id":
                        current["id"],
                },
                {"_id": 0},
            )
        )


    if not playlist:

        playlist = await (
            ensure_default_playlist(
                game_id,
                current,
            )
        )


    await (
        db.realmlife_dj_playlists
        .update_one(
            {
                "game_id":
                    game_id,

                "id":
                    playlist["id"],

                "owner_user_id":
                    current["id"],
            },
            {
                "$addToSet": {
                    "session_ids":
                        doc["id"]
                },

                "$set": {
                    "updated_at":
                        now_iso()
                },
            },
        )
    )


    doc.pop(
        "_id",
        None,
    )


    return {
        "ok":
            True,

        "session":
            doc,

        "playlist_id":
            playlist["id"],
    }


async def list_sessions(
    game_id,
    current,
):

    rows = await (
        db.realmlife_dj_sessions
        .find(
            {
                "game_id":
                    game_id,

                "owner_user_id":
                    current["id"],
            },
            {"_id": 0},
        )
        .sort(
            "created_at",
            -1,
        )
        .limit(
            100
        )
        .to_list(
            length=100
        )
    )


    return {
        "sessions":
            rows
    }
