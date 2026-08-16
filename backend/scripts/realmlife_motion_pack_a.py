"""RealmLife Motion Pack A — Avery.

Bounded Meshy animation generation:
- Finds Avery's existing Streetwear rig task from the stored rigged model.
- Uses CURRENT Meshy action_id API.
- Generates exactly 10 approved life-sim motions.
- Serial generation: one task at a time.
- Stores every successful GLB immediately in OurRealm storage.
- Wires URLs into RealmLife game spec.
- Idempotency keys prevent accidental duplicate paid jobs.

Maximum planned animation spend: 30 Meshy credits.
"""

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, "/app/backend")

from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

from core.db import db  # noqa: E402
from services import meshy_provider as mp  # noqa: E402


GAME_ID = "realmlife-home-v1"

AVATAR_ID = "av_streetwear"

MODEL_URL = (
    "/api/media/models/"
    "cf0dfc028338e9d27670dd0adbb8913f.glb"
)

# Verified from the source asset behind the current KTX2
# Streetwear runtime model:
# fe59ed71ebde0f6ed51c393269bd7da7.glb
RIG_TASK_ID = "019ffa10-6664-7d07-a771-34776ab0c302"

MAX_CREDITS = 30

REPORT_PATH = Path(
    "/app/artifacts/realmlife/"
    "motion_pack_a_report.json"
)

# Current Meshy Animation Library action IDs.
#
# These are deliberate life-sim choices rather than guesses.
MOTIONS = [
    {
        "key": "sit_down",
        "action_id": 57,
        "meshy_name": "Stand_to_Sit_Transition_M",
    },
    {
        "key": "sit_idle",
        "action_id": 33,
        "meshy_name": "Chair_Sit_Idle_M",
    },
    {
        "key": "stand_up",
        "action_id": 53,
        "meshy_name": "Sit_to_Stand_Transition_M",
    },
    {
        "key": "lie_down",
        "action_id": 371,
        "meshy_name": "Sit_Lie_Bed",
    },
    {
        "key": "sleep",
        "action_id": 267,
        "meshy_name": "Sleep_Normally",
    },
    {
        "key": "wake_up",
        "action_id": 271,
        "meshy_name": "Wake_Up_and_Look_Up",
    },
    {
        "key": "talk",
        "action_id": 56,
        "meshy_name": "Stand_and_Chat",
    },
    {
        "key": "phone",
        "action_id": 312,
        "meshy_name": "Phone_Conversation",
    },
    {
        "key": "drink",
        "action_id": 342,
        "meshy_name": "Stand_and_Drink",
    },
    {
        "key": "open_door",
        "action_id": 285,
        "meshy_name": "open_door",
    },
]


def iso():
    return datetime.now(timezone.utc).isoformat()


async def wait_for_task(task_id, label, max_seconds=1200):
    elapsed = 0

    while elapsed < max_seconds:
        status = await mp.poll_task(
            db,
            "animation",
            task_id,
        )

        state = status.get("status")
        progress = status.get("progress", 0)

        print(
            f"[{label}] "
            f"{state} "
            f"{progress}% "
            f"credits={status.get('consumed_credits')}"
        )

        if state in mp.TERMINAL:
            return status

        await asyncio.sleep(12)
        elapsed += 12

    return {
        "status": "TIMEOUT",
        "progress": 0,
        "task_error": {
            "message": "Timed out waiting for Meshy"
        },
    }


async def discover_rig_task():
    """Trace current Streetwear runtime GLB back to its Meshy rig task."""

    asset = await db.asset_library.find_one(
        {"url": MODEL_URL},
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "url": 1,
            "workflow": 1,
            "meshy_task_id": 1,
            "context": 1,
        },
    )

    if asset:
        print("===== CURRENT STREETWEAR ASSET =====")
        print(json.dumps(asset, indent=2, default=str))

        if (
            asset.get("workflow") == "rig"
            and asset.get("meshy_task_id")
        ):
            return asset["meshy_task_id"]

    # Fallback: find successful Streetwear rig task by context.
    rows = await db.meshy_tasks.find(
        {
            "workflow": "rig",
            "status": "SUCCEEDED",
        },
        {
            "_id": 0,
            "meshy_task_id": 1,
            "context": 1,
            "created_at": 1,
            "stored_asset_id": 1,
        },
    ).sort(
        "created_at",
        -1,
    ).to_list(200)

    candidates = []

    for row in rows:
        blob = json.dumps(
            row.get("context") or {},
            default=str,
        ).lower()

        if (
            "streetwear" in blob
            or AVATAR_ID.lower() in blob
        ):
            candidates.append(row)

    if len(candidates) == 1:
        print("===== DISCOVERED STREETWEAR RIG =====")
        print(
            json.dumps(
                candidates[0],
                indent=2,
                default=str,
            )
        )
        return candidates[0]["meshy_task_id"]

    if len(candidates) > 1:
        # Prefer newest successfully stored candidate.
        stored = [
            x for x in candidates
            if x.get("stored_asset_id")
        ]

        if stored:
            print(
                "===== USING NEWEST STORED STREETWEAR RIG ====="
            )
            print(
                json.dumps(
                    stored[0],
                    indent=2,
                    default=str,
                )
            )
            return stored[0]["meshy_task_id"]

        print(
            "❌ Multiple Streetwear rig tasks found. "
            "Refusing to guess."
        )

        for c in candidates:
            print(
                json.dumps(
                    c,
                    indent=2,
                    default=str,
                )
            )

        return None

    print(
        "❌ Could not trace Streetwear model "
        "to a successful Meshy rig task."
    )

    return None


async def main():
    founder = await db.users.find_one(
        {"username": "stealth"},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
        },
    )

    if not founder:
        raise RuntimeError(
            "Founder account 'stealth' not found"
        )

    game = await db.games.find_one(
        {"id": GAME_ID},
        {
            "_id": 0,
            "id": 1,
            "title": 1,
            "spec": 1,
        },
    )

    if not game:
        raise RuntimeError(
            f"RealmLife game not found: {GAME_ID}"
        )

    print()
    print("===== MESHY STATUS / BALANCE =====")

    health = await mp.health()

    print(
        json.dumps(
            health,
            indent=2,
            default=str,
        )
    )

    if not health.get("ok"):
        raise RuntimeError(
            "Meshy health/balance check failed. "
            "No paid jobs submitted."
        )

    balance = health.get("balance")

    if isinstance(balance, (int, float)):
        if balance < MAX_CREDITS:
            raise RuntimeError(
                f"Meshy balance {balance} is below "
                f"the {MAX_CREDITS}-credit safety budget. "
                "No jobs submitted."
            )

    print()
    print("===== DISCOVERING EXISTING AVERY RIG =====")

    rig_task_id = RIG_TASK_ID

    if not rig_task_id:
        raise RuntimeError(
            "No unambiguous Avery rig task found. "
            "No paid jobs submitted."
        )

    print()
    print("RIG TASK:", rig_task_id)

    print()
    print("===== BOUNDED MOTION PLAN =====")

    for m in MOTIONS:
        print(
            f"{m['key']:12} "
            f"action_id={m['action_id']:3} "
            f"{m['meshy_name']}"
        )

    print()
    print(
        f"MAXIMUM PLANNED ANIMATION SPEND: "
        f"{MAX_CREDITS} Meshy credits"
    )

    report = {
        "game_id": GAME_ID,
        "avatar_id": AVATAR_ID,
        "rig_task_id": rig_task_id,
        "started_at": iso(),
        "max_credit_budget": MAX_CREDITS,
        "motions": {},
    }

    animation_urls = {}

    # --------------------------------------------------------
    # SERIAL GENERATION
    #
    # First motion is effectively the canary.
    # If it fails, stop immediately instead of submitting 9 more.
    # --------------------------------------------------------

    for index, motion in enumerate(MOTIONS):
        key = motion["key"]
        action_id = motion["action_id"]

        idem_key = (
            f"realmlife-avery-"
            f"{key}-action{action_id}-v1"
        )

        print()
        print(
            f"===== [{index + 1}/{len(MOTIONS)}] "
            f"{key.upper()} ====="
        )

        try:
            task = await mp.create_task(
                db,
                founder,
                "animation",
                {
                    "rig_task_id": rig_task_id,
                    "action_id": action_id,
                },
                idem_key,
                {
                    "game_id": GAME_ID,
                    "runtime": "life_sim_3d",
                    "avatar_id": AVATAR_ID,
                    "motion_key": key,
                    "action_id": action_id,
                    "meshy_name": motion[
                        "meshy_name"
                    ],
                    "pack": "realmlife_motion_pack_a",
                },
            )

        except Exception as exc:
            print(
                f"❌ Submit failed for {key}: {exc}"
            )

            report["motions"][key] = {
                "status": "SUBMIT_FAILED",
                "error": str(exc),
            }

            break

        task_id = task["task_id"]

        print(
            f"[submit] {key} -> {task_id} "
            f"replayed={task.get('replayed')}"
        )

        status = await wait_for_task(
            task_id,
            key,
        )

        report["motions"][key] = {
            "task_id": task_id,
            "status": status.get("status"),
            "consumed_credits":
                status.get("consumed_credits"),
            "task_error":
                status.get("task_error"),
        }

        if status.get("status") != "SUCCEEDED":
            print(
                f"❌ {key} did not succeed. "
                "Stopping pack here."
            )
            break

        asset = await mp.store_glb(
            db,
            founder,
            "animation",
            task_id,
            (
                f"RealmLife Avery — "
                f"{motion['meshy_name']}"
            ),
            {
                "game_id": GAME_ID,
                "runtime": "life_sim_3d",
                "avatar_id": AVATAR_ID,
                "motion_key": key,
                "action_id": action_id,
                "pack": "realmlife_motion_pack_a",
            },
        )

        animation_urls[key] = asset["url"]

        report["motions"][key].update(
            {
                "asset_id": asset["id"],
                "url": asset["url"],
                "animations":
                    asset.get("meta", {}).get(
                        "animations"
                    ),
                "bytes":
                    asset.get("meta", {}).get(
                        "bytes"
                    ),
            }
        )

        print(
            f"[stored] {key}: {asset['url']}"
        )

        # Wire each motion immediately so a later failure
        # cannot lose already-completed work.
        await db.games.update_one(
            {"id": GAME_ID},
            {
                "$set": {
                    (
                        "spec.life_sim.avatar."
                        f"animationUrls.{key}"
                    ): asset["url"],
                    (
                        "spec.life_sim.avatar."
                        "modelUrl"
                    ): MODEL_URL,
                    (
                        "spec.life_sim.avatar."
                        "id"
                    ): AVATAR_ID,
                    "updated_at": iso(),
                }
            },
        )

        print(
            f"[wired] {key} -> RealmLife spec"
        )

    report["finished_at"] = iso()

    report["generated_count"] = len(
        animation_urls
    )

    report["animation_urls"] = (
        animation_urls
    )

    REPORT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    REPORT_PATH.write_text(
        json.dumps(
            report,
            indent=2,
            default=str,
        )
    )

    print()
    print("===== REALMLIFE MOTION PACK A RESULT =====")
    print(
        json.dumps(
            report,
            indent=2,
            default=str,
        )
    )

    print()
    print(
        f"REPORT: {REPORT_PATH}"
    )

    if len(animation_urls) == len(MOTIONS):
        print(
            "✅ RealmLife Avery Motion Pack A complete."
        )
    else:
        print(
            "⚠️ Pack stopped early. "
            "Completed motions remain safely stored/wired."
        )


asyncio.run(main())
