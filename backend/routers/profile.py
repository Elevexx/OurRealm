"""Profile endpoints (/api/profile/*)."""
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.security import hash_password, verify_password
from models.schemas import (
    ProfileUpdate, UsernameChangePayload, PasswordChangePayload, serialize_user,
)

router = APIRouter(prefix="/api/profile", tags=["profile"])

USERNAME_COOLDOWN_DAYS = 7


@router.get("/me")
async def get_my_profile(current: CurrentUser):
    return {"user": serialize_user(current)}


@router.patch("/me")
async def update_profile(update: ProfileUpdate, current: CurrentUser):
    set_doc = {k: v for k, v in update.model_dump(exclude_none=True).items()}
    # Validate visibility value
    if "profile_visibility" in set_doc and set_doc["profile_visibility"] not in (
        "public", "friends", "private",
    ):
        raise HTTPException(status_code=400, detail="Invalid visibility")
    # Cap Inner-8 at 8 entries
    if "inner_8" in set_doc:
        if len(set_doc["inner_8"]) > 8:
            raise HTTPException(
                status_code=400,
                detail="Remove a friend from Inner 8 to add a new one",
            )
        # Make sure each entry is actually a friend
        friend_ids = set(current.get("friends") or [])
        for uid in set_doc["inner_8"]:
            if uid not in friend_ids:
                raise HTTPException(status_code=400, detail="Inner 8 entry is not a friend")
    if set_doc:
        await db.users.update_one({"id": current["id"]}, {"$set": set_doc})
    user = await db.users.find_one({"id": current["id"]}, {"_id": 0})
    return {"user": serialize_user(user)}


@router.patch("/username")
async def change_username(payload: UsernameChangePayload, current: CurrentUser):
    new_un = payload.username.lower().strip()
    if new_un == (current.get("username") or "").lower():
        return {"ok": True, "user": serialize_user(current)}
    # Cooldown
    last = current.get("username_changed_at")
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            elapsed = datetime.now(timezone.utc) - last_dt
            if elapsed < timedelta(days=USERNAME_COOLDOWN_DAYS):
                days_left = USERNAME_COOLDOWN_DAYS - elapsed.days
                raise HTTPException(
                    status_code=429,
                    detail=f"You can change your username again in {days_left} day(s).",
                )
        except HTTPException:
            raise
        except Exception:
            pass
    # Availability
    if await db.users.find_one({"username": new_un}):
        raise HTTPException(status_code=400, detail="Username already taken")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {"username": new_un, "username_changed_at": now_iso}},
    )
    user = await db.users.find_one({"id": current["id"]}, {"_id": 0})
    return {"ok": True, "user": serialize_user(user)}


@router.post("/change-password")
async def change_password(payload: PasswordChangePayload, current: CurrentUser):
    if not verify_password(payload.current_password, current.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    return {"ok": True}


@router.get("/by-username/{username}")
async def get_public_profile_by_username(username: str):
    user = await db.users.find_one(
        {"username": username.lower()}, {"_id": 0, "password_hash": 0}
    )
    if not user:
        raise HTTPException(status_code=404, detail="Profile not found")
    out = serialize_user(user)
    out["widgets"] = user.get("widgets") or []
    out["social"] = user.get("social", {})
    return {"user": out}
