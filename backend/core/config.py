"""Application config constants. Reads env vars lazily where possible."""
import os

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 24  # 1 day
REFRESH_TOKEN_DAYS = 30
LOCKOUT_THRESHOLD = 5
LOCKOUT_MINUTES = 15

# Founder account
FOUNDER_EMAIL = "slopestyle2022@gmail.com"
FOUNDER_USERNAME = "stealth"
FOUNDER_AVATAR = "https://customer-assets.emergentagent.com/job_realm-deploy/artifacts/qnqnnlzv_IMG_0993.jpeg"
FOUNDER_WIDGETS = [
    {"id": "fw-live",   "type": "live",   "size": "large",  "title": "Stealth Live"},
    {"id": "fw-tracks", "type": "music",  "size": "large",  "title": "Stealth Tracks"},
    {"id": "fw-events", "type": "events", "size": "medium", "title": "Upcoming Events"},
    {"id": "fw-fans",   "type": "polls",  "size": "medium", "title": "Fan Wall"},
    {"id": "fw-blog",   "type": "blog",   "size": "medium", "title": "Founder Log"},
]

# Early Adopter / VIP system: any account created while total
# registered count < VIP_CUTOFF gets the badge permanently.
VIP_CUTOFF = 1000
MYFEED_WIDGET_TYPE = "myfeed"
TOP8_WIDGET_TYPE = "top8"
NOTES_WIDGET_TYPE = "notes"
DEFAULT_NOTES_TEXT = '"Discover should feel inevitable, not optional."\n— shipping log'


def default_myfeed_widget() -> dict:
    return {
        "id": "w-myfeed",
        "type": MYFEED_WIDGET_TYPE,
        "size": "large",
        "title": "My Feed",
        "audience": {"visibility": "public", "user_ids": []},
    }


def default_top8_widget() -> dict:
    return {
        "id": "w-top8",
        "type": TOP8_WIDGET_TYPE,
        "size": "medium",
        "title": "Top 8 Friends",
    }


def default_notes_widget() -> dict:
    """Notes widget — `text` defaults to the shipping-log quote but is
    owner-editable from the profile edit UI."""
    return {
        "id": "w-notes",
        "type": NOTES_WIDGET_TYPE,
        "size": "small",
        "title": "Notes",
        "text": DEFAULT_NOTES_TEXT,
    }


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def get_cors_origins() -> list[str]:
    """Trusted CORS origins.

    Production must configure CORS_ORIGINS explicitly — we never fall
    back to `*` in production HTTPS. If the env var is missing we return
    the production hostname plus the known preview hostname as a safe
    default; wildcard is only honoured when CORS_ALLOW_WILDCARD=true
    (intended for local docker / dev runs only).
    """
    raw = os.environ.get("CORS_ORIGINS")
    if raw:
        origins = [o.strip() for o in raw.split(",") if o.strip()]
        if origins == ["*"] and os.environ.get("CORS_ALLOW_WILDCARD", "false").lower() != "true":
            # Reject wildcard unless explicitly opted-in. Fall through to
            # the trusted default list below.
            origins = []
        if origins:
            return origins
    # Trusted default — production domain + preview domain. Add new
    # trusted origins via CORS_ORIGINS=... env var.
    return [
        "https://ourrealm.social",
        "https://www.ourrealm.social",
        "https://realm-deploy.preview.emergentagent.com",
    ]
