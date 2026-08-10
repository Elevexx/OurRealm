"""Phase 13 one-time startup migrations (founder directive, June 2026).
Each task is flag-guarded in db.migrations so it runs exactly once per
environment (preview AND production self-heal on deploy). Founders can
change anything afterwards — these never re-apply.
"""
import logging

from core.db import db

log = logging.getLogger("ourrealm.phase13")


async def _once(flag: str) -> bool:
    r = await db.migrations.update_one({"id": flag}, {"$setOnInsert": {"id": flag}}, upsert=True)
    return bool(r.upserted_id)


async def run():
    # 13A — turn the signup waitlist OFF (one-time; founder can re-enable)
    if await _once("phase13_waitlist_off"):
        from services import waitlist as wl
        cur = await wl.get_signup_mode()
        if cur["mode"] != "open":
            await db.platform_settings.update_one(
                {"id": "signup"},
                {"$set": {"id": "signup", "mode": "open", "allow_new_signups": True,
                          "mode_reason": None,
                          "mode_changed_at": wl._now_iso(),
                          "mode_changed_by": "founder-directive-phase13"}}, upsert=True)
            log.info("[phase13] signup waitlist turned OFF (mode=open)")

    # Runtime launch — seed shooter/OWR demos + promote registries (idempotent)
    if await _once("phase13_shooter_owr_launch"):
        try:
            from scripts.launch_shooter_owr import main as launch
            rc = await launch(publish=True)
            log.info(f"[phase13] shooter/owr launch seeding rc={rc}")
        except Exception as e:  # noqa: BLE001
            log.error(f"[phase13] launch seeding failed: {e}")
            await db.migrations.delete_one({"id": "phase13_shooter_owr_launch"})
