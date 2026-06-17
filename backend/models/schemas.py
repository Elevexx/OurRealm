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
    # ── Compliance acknowledgements (Phase 1) ──
    # All four must be true for the account to be created.
    accepted_terms: bool = False
    accepted_privacy: bool = False
    accepted_conditions: bool = False
    age_confirmed_13: bool = False
    # Optional client-supplied policy version for audit trail.
    policy_version: Optional[str] = None


class LoginPayload(BaseModel):
    # Accepts an email OR a username. Validated leniently at the route so
    # both founder and standard accounts can sign in with either identifier.
    email: str
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
    # Inner-8 / Top-8 friends ordered list of user_ids (max 8)
    inner_8: Optional[List[str]] = None
    # Phase-2: presence indicator visibility (default true). When false the
    # animated radar dot is hidden on the public profile.
    presence_visible: Optional[bool] = None
    # Phase-2: PRIVATE 5-digit US ZIP. Never exposed by the public profile
    # serializer; only used server-side for radius filtering and surfaced
    # back to the owner via /auth/me. Pass empty string to clear.
    zip_code: Optional[str] = Field(default=None, max_length=10)


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


class PollOptionPayload(BaseModel):
    """One option in a poll. id is generated server-side if missing."""
    id: Optional[str] = None
    text: str = Field(min_length=1, max_length=100)


class PollPayload(BaseModel):
    """Poll attached to a post (Phase 4B).

    `duration_hours`: 24, 72, 168, 720, or 0 for no expiration.
    Future-proofed for: multi-vote polls, anonymous polls, image options.
    """
    question: str = Field(min_length=1, max_length=200)
    options: List[PollOptionPayload] = Field(min_length=2, max_length=10)
    duration_hours: int = 0   # 0 = no expiration; 24/72/168/720 supported


class PostCreate(BaseModel):
    # Hard ceiling that mirrors POST_LIMITS["founder"] in services/post_limits.py.
    # Role-based cap (founder 2000 / VIP 500 / default 300) is enforced
    # centrally via enforce_post_content_limit. If POST_LIMITS["founder"] ever
    # changes, this max_length must move in lockstep.
    # Production-bug fix (Feb 2026): media-only posts (a video/image/link
    # upload with no caption) were rejected with 422 because of the old
    # `min_length=1`. Caption is now optional; `create_post` validates
    # server-side that the post carries SOMETHING (content, any media URL,
    # or a poll) so we still reject truly empty payloads.
    content: str = Field(default="", max_length=2000)
    media_type: str = Field(default="thought")
    media_url: Optional[str] = None
    # Optional rich-media URLs. Any combination may be set in addition to
    # (or instead of) the legacy media_url/media_type pair. Existing posts
    # without these fields continue to render text-only.
    image_url: Optional[str] = None
    # Album support — list of additional image URLs (the "album" view in
    # the feed). When set, the feed renders a grid of all images. Stored
    # alongside `image_url` (the primary thumbnail) for back-compat.
    image_urls: Optional[List[str]] = None
    video_url: Optional[str] = None
    link_url: Optional[str] = None
    # Sound post — references an uploaded track from /api/sounds/upload.
    # `sound_track_id` is the track's id (used to bump plays, fetch
    # cover/meta on demand). `sound_url` is the streaming URL for the
    # in-feed audio element. Either may be present.
    sound_track_id: Optional[str] = None
    sound_url: Optional[str] = None
    sound_title: Optional[str] = None
    sound_cover_url: Optional[str] = None
    sound_duration: Optional[float] = None
    tags: List[str] = []
    audience: Optional[AudiencePayload] = None
    poll: Optional[PollPayload] = None   # Phase 4B — optional poll attached


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
        # Spec alias — same value as avatar_url, exposed under the spec's
        # name so the frontend may use either field interchangeably.
        "profileImageUrl": doc.get("avatar_url"),
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
        # Phase-2 — presence indicator visibility (default ON).
        "presence_visible": doc.get("presence_visible", True),
        # Phase C — Real-Time Presence System
        # `presence_status_choice` is what the USER picked
        # (live/online/invisible). `presence_status` is the live status
        # the server has on file — may be offline if no socket attached.
        "presence_status_choice": (doc.get("presence_status_choice") or "online"),
        "presence_status": (doc.get("presence_status") or "offline"),
        # Number of friends — used by Trending. Falls back to live count.
        "follower_count": int(doc.get("follower_count")
                              if doc.get("follower_count") is not None
                              else len(doc.get("friends") or [])),
        # PRIVATE — only returned via `/auth/me` (the owner). The public
        # `/profile/by-username/...` route MUST omit this field. See
        # routers/profile.py:public_profile() for the redaction.
        "zip_code": doc.get("zip_code") or None,
        "social": doc.get("social", {}),
        # `friends` is a list of user_ids internally — UI can resolve via /friends/list
        "friends": doc.get("friends", []),
        "created_at": doc.get("created_at") if isinstance(doc.get("created_at"), datetime)
        else datetime.fromisoformat(doc["created_at"]) if doc.get("created_at") else datetime.now(timezone.utc),
    }
