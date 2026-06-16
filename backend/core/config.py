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
    {"id": "fw-merch",  "type": "merch",  "size": "full",   "title": "Stealth Merch"},
    {"id": "fw-tracks", "type": "music",  "size": "large",  "title": "Stealth Tracks"},
    {"id": "fw-events", "type": "events", "size": "medium", "title": "Upcoming Events"},
    {"id": "fw-fans",   "type": "polls",  "size": "medium", "title": "Fan Wall"},
    {"id": "fw-social", "type": "custom", "size": "small",  "title": "Connect with Stealth"},
]

# Early Adopter / VIP system: any account created while total
# registered count < VIP_CUTOFF gets the badge permanently.
VIP_CUTOFF = 1000
MYFEED_WIDGET_TYPE = "myfeed"
TOP8_WIDGET_TYPE = "top8"


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


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def get_cors_origins() -> list[str]:
    return [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",")]
