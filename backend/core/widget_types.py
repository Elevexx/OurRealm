"""Single source of truth for profile widget types (Feb 24, 2026).

Spec: ONLY the 15 types listed below are allowed anywhere in the app.
Any other widget type is stripped on save (PATCH /api/profile/me),
filtered out on public read (/profile/by-username), and pruned by the
boot migration `migrate_strip_deprecated_widgets()`.

Per-widget limits are enforced in `routers/profile.py:update_profile`.
"""

ALLOWED_WIDGET_TYPES: set[str] = {
    "myfeed",
    "top8",
    "live",
    "videos",
    "music",
    "podcasts",
    "events",
    "weather",
    "calendar",
    "countdown",
    "notes",
    "polls",
    "survey",
    "blog",
    "radar",
}

# Per-widget array-size caps (videos, music, podcasts).
VIDEOS_MAX = 4
MUSIC_SOUNDS_MAX = 10
PODCASTS_SOUNDS_MAX = 10

# Character limits per role. Stealth bypasses (None = unlimited).
NOTES_LIMIT_STANDARD = 300
NOTES_LIMIT_VIP = 500
BLOG_LIMIT_STANDARD = 100
BLOG_LIMIT_VIP = 2000


def notes_limit_for(user: dict) -> int | None:
    if (user.get("username") or "").lower() == "stealth":
        return None  # unlimited
    return NOTES_LIMIT_VIP if user.get("is_vip") else NOTES_LIMIT_STANDARD


def blog_limit_for(user: dict) -> int | None:
    if (user.get("username") or "").lower() == "stealth":
        return None  # unlimited
    return BLOG_LIMIT_VIP if user.get("is_vip") else BLOG_LIMIT_STANDARD
