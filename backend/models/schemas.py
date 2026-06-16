"""Pydantic request/response schemas and the user serializer."""
from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field, ConfigDict


# ----- Auth -----
class RegisterPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=80)
    username: str = Field(min_length=3, max_length=24, pattern=r"^[a-zA-Z0-9_.]+$")


class LoginPayload(BaseModel):
    email: EmailStr
    password: str


class UsernameCheck(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[a-zA-Z0-9_.]+$")


class ForgotPayload(BaseModel):
    email: EmailStr


class ResetPayload(BaseModel):
    token: str
    new_password: str = Field(min_length=6, max_length=128)


class OtpRequest(BaseModel):
    email: EmailStr


class OtpVerify(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=10)


# ----- Friends -----
class FriendActionPayload(BaseModel):
    """Friend actions are addressed by username (stable for the UI),
    but stored internally as user_ids."""
    username: str


# ----- Messages -----
class MessageCreate(BaseModel):
    to_username: str
    text: str = Field(min_length=1, max_length=2000)


class PinThreadPayload(BaseModel):
    peer_username: str


# ----- Profile -----
class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    interests: Optional[List[str]] = None
    mode: Optional[str] = None
    widgets: Optional[List[dict]] = None
    # Privacy visibility: public | friends | private
    profile_visibility: Optional[str] = None
    # Wallet payment placeholders (stored as-is, no real ACH)
    wallet: Optional[dict] = None
    # Inner-8 friends ordered list of user_ids (max 8)
    inner_8: Optional[List[str]] = None


class UsernameChangePayload(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[a-zA-Z0-9_.]+$")


class PasswordChangePayload(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)


# ----- Posts -----
class AudiencePayload(BaseModel):
    """Audience for a post or widget. Designed so a future
    `friend_group_ids` field can be added without a migration —
    clients should only send fields they understand."""
    visibility: str = Field(default="public")  # public | friends | private | custom
    user_ids: List[str] = []
    # `friend_group_ids` is reserved — accepted but ignored until the
    # friend-groups feature ships.
    friend_group_ids: Optional[List[str]] = None


class PostCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    media_type: str = Field(default="thought")
    media_url: Optional[str] = None
    tags: List[str] = []
    audience: Optional[AudiencePayload] = None


class UserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: EmailStr
    name: str
    role: str = "user"
    avatar_url: Optional[str] = None
    bio: Optional[str] = ""
    interests: List[str] = []
    mode: str = "neon"
    widgets: List[dict] = []
    created_at: datetime


# ----- Serializer -----
def serialize_user(doc: dict) -> dict:
    """Public serialization of a user doc — friend arrays are kept as
    user_ids internally; the API additionally returns the resolved
    friend_usernames where convenient (handled by the friends router)."""
    return {
        "id": doc["id"],
        "email": doc["email"],
        "username": doc.get("username"),
        "name": doc.get("name", ""),
        "role": doc.get("role", "user"),
        "avatar_url": doc.get("avatar_url"),
        "bio": doc.get("bio", ""),
        "interests": doc.get("interests", []),
        "mode": doc.get("mode", "neon"),
        "widgets": doc.get("widgets", []),
        "is_founder": bool(doc.get("is_founder")),
        "is_verified": bool(doc.get("is_verified")),
        "is_vip": bool(doc.get("is_vip")),
        "vip_joined_at": doc.get("vip_joined_at") or doc.get("created_at"),
        "username_changed_at": doc.get("username_changed_at"),
        "profile_visibility": doc.get("profile_visibility", "public"),
        "wallet": doc.get("wallet", {}),
        "inner_8": doc.get("inner_8", []),
        "social": doc.get("social", {}),
        # `friends` is a list of user_ids internally — UI can resolve via /friends/list
        "friends": doc.get("friends", []),
        "created_at": doc.get("created_at") if isinstance(doc.get("created_at"), datetime)
        else datetime.fromisoformat(doc["created_at"]) if doc.get("created_at") else datetime.now(timezone.utc),
    }
