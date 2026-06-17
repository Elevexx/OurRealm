"""Profile endpoints (/api/profile/*)."""
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.security import hash_password, verify_password
from core.geo import is_valid_zip, resolve_zip
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
    # `exclude_unset=True` so callers can explicitly send a field as
    # `null` to clear it (e.g. {"avatar_url": null} for "Remove Photo").
    # `exclude_none=True` would have hidden that signal.
    set_doc = update.model_dump(exclude_unset=True)
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
    # Phase-2 — ZIP code validation + coords resolution. The 5-digit
    # prefix is geocoded server-side via pgeocode; lat/lng is stored in
    # private fields used by the radius-filter helpers. Pass an empty
    # string to clear the ZIP and its derived coords.
    if "zip_code" in set_doc:
        raw = (set_doc.pop("zip_code") or "").strip()
        if raw == "":
            set_doc["zip_code"] = None
            set_doc["zip_lat"] = None
            set_doc["zip_lng"] = None
        else:
            if not is_valid_zip(raw):
                raise HTTPException(status_code=400, detail="Please enter a valid 5-digit US ZIP code.")
            coords = resolve_zip(raw)
            if coords is None:
                raise HTTPException(status_code=400, detail="Could not locate that ZIP code. Try a different one.")
            set_doc["zip_code"] = raw[:10]
            set_doc["zip_lat"] = coords[0]
            set_doc["zip_lng"] = coords[1]
    if set_doc:
        await db.users.update_one({"id": current["id"]}, {"$set": set_doc})
    user = await db.users.find_one({"id": current["id"]}, {"_id": 0})
    return {"user": serialize_user(user)}


@router.patch("/username")
async def change_username(payload: UsernameChangePayload, current: CurrentUser):
    new_un = payload.username.lower().strip()
    if new_un == (current.get("username") or "").lower():
        return {"ok": True, "user": serialize_user(current)}
    # Phase B — @support is a protected system account; refuse rename.
    if current.get("is_protected") or (current.get("username") or "").lower() == "support":
        raise HTTPException(status_code=403, detail="This account is protected and cannot be renamed.")
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
        {"$set": {
            "password_hash": hash_password(payload.new_password),
            # Marks the account so the founder-seed migration won't overwrite
            # the password back to the temporary value on the next boot.
            "password_set_by_user": True,
        }},
    )
    return {"ok": True}


@router.post("/by-ids")
async def get_profiles_by_ids(payload: dict):
    """Resolve a list of user_ids → minimal public profile cards.

    Used by the Supabase-powered messenger to display sender info
    (username, name, avatar) for message rows. Accepts at most 200 ids.
    """
    ids = payload.get("ids") or []
    if not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="ids must be an array")
    ids = [str(x) for x in ids if isinstance(x, str)][:200]
    if not ids:
        return {"users": []}
    out = []
    async for u in db.users.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1,
         "is_founder": 1, "is_verified": 1, "is_vip": 1},
    ):
        out.append({
            "id": u.get("id"),
            "username": u.get("username"),
            "name": u.get("name") or u.get("username") or "",
            "avatar_url": u.get("avatar_url"),
            "is_founder": bool(u.get("is_founder")),
            "is_verified": bool(u.get("is_verified")),
            "is_vip": bool(u.get("is_vip")),
        })
    return {"users": out}


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
    # ── PRIVACY: ZIP code never leaves the owner's session. ──
    # The serializer adds it for /auth/me; we strip here for the public
    # by-username endpoint that anyone can hit.
    out.pop("zip_code", None)
    return {"user": out}
