"""Profile endpoints (/api/profile/*)."""
from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from models.schemas import ProfileUpdate, serialize_user

router = APIRouter(prefix="/api/profile", tags=["profile"])


@router.get("/me")
async def get_my_profile(current: CurrentUser):
    return {"user": serialize_user(current)}


@router.patch("/me")
async def update_profile(update: ProfileUpdate, current: CurrentUser):
    set_doc = {k: v for k, v in update.model_dump(exclude_none=True).items()}
    if set_doc:
        await db.users.update_one({"id": current["id"]}, {"$set": set_doc})
    user = await db.users.find_one({"id": current["id"]}, {"_id": 0})
    return {"user": serialize_user(user)}


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
