"""Canonical eligibility rules shared by feed + progression.

`is_foryou_eligible_post` is THE single definition of a "backend-eligible
For You post". The progression engine and any feed logic must use this,
never a private re-implementation.
"""
from core.analytics_filters import real_member_filter

SUPPORTED_POST_TYPES = {"thought", "image", "video", "link", "sound", "poll", "live"}
OK_MODERATION = (None, "approved", "pending_review")

# Known default / placeholder media URL fragments. A profile picture or
# banner only counts as "real" when it is a durably stored upload and not
# one of these defaults.
DEFAULT_MEDIA_FRAGMENTS = (
    "dicebear", "ui-avatars", "gravatar", "placeholder", "default-avatar",
    "default_banner", "default-banner", "avatar-default", "placehold",
)


def is_real_media_url(url) -> bool:
    if not url or not isinstance(url, str):
        return False
    u = url.strip().lower()
    if not u or u.startswith(("blob:", "data:")):
        return False
    return not any(f in u for f in DEFAULT_MEDIA_FRAGMENTS)


def is_foryou_eligible_post(post: dict) -> bool:
    """Deterministic, viewer-independent For You distribution eligibility."""
    if not post or not post.get("id") or not post.get("author_id"):
        return False
    if post.get("deleted_at") or post.get("is_draft"):
        return False
    if post.get("moderation_status") not in OK_MODERATION:
        return False
    mt = post.get("media_type") or "thought"
    if mt not in SUPPORTED_POST_TYPES:
        return False
    vis = ((post.get("audience") or {}).get("visibility") or "public")
    if vis != "public":
        return False
    has_media = any(post.get(k) for k in ("media_url", "image_url", "video_url", "link_url", "sound_url")) \
        or bool(post.get("image_urls")) or bool(post.get("poll"))
    return bool((post.get("content") or "").strip()) or has_media


def foryou_eligible_query(author_id: str) -> dict:
    """Mongo pre-filter matching most eligibility rules (final check in python)."""
    return {
        "author_id": author_id,
        "deleted_at": {"$exists": False},
        "is_draft": {"$ne": True},
        "$or": [
            {"moderation_status": {"$in": ["approved", "pending_review"]}},
            {"moderation_status": {"$exists": False}},
            {"moderation_status": None},
        ],
        "audience.visibility": {"$in": ["public", None]},
    }


def progression_eligible_user_filter() -> dict:
    """Real members only — canonical analytics filter."""
    return real_member_filter()
