"""Widget template library (Phase 2A — Custom Widget Builder).

Pre-baked starter templates the builder can clone. Each template is
a complete `editor_config` payload that satisfies the layout
contract in `core/widget_layouts.py`. Adding a template = appending
one entry to TEMPLATES.

The frontend renders these from `GET /api/admin/widgets/templates`
and the create-from-template endpoint clones the template into a
new draft widget the admin can iterate on.
"""
from __future__ import annotations
from typing import List, Dict, Any


def _ec(layout: str, fields: List[Dict[str, Any]], data: Dict[str, Any],
        *, theme: Dict[str, Any] | None = None,
        limits: Dict[str, Any] | None = None,
        data_source: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """editor_config builder — keeps the shape identical everywhere."""
    return {
        "schema_version": 1,
        "layout": layout,
        "fields": fields,
        "data": data,
        "data_source": data_source or {"kind": "static", "api": None, "refresh_seconds": 0},
        "theme": theme or {},
        "limits": limits or {},
    }


TEMPLATES: List[Dict[str, Any]] = [
    {
        "key": "countdown",
        "name": "Countdown",
        "icon": "Timer",
        "category_group": "utility",
        "description": "A countdown to a future date with a label.",
        "default_size": "small",
        "editor_config": _ec(
            "stat",
            [
                {"key": "label", "type": "text", "label": "Label", "required": True, "max_length": 60},
                {"key": "target_date", "type": "datetime", "label": "Target Date", "required": True},
                {"key": "value", "type": "text", "label": "Display", "max_length": 24},
            ],
            {"label": "Drop launches in", "target_date": "", "value": "07d 14h"},
        ),
    },
    {
        "key": "poll",
        "name": "Poll",
        "icon": "BarChart3",
        "category_group": "community",
        "description": "Single-question, multi-option poll with live tallies.",
        "default_size": "medium",
        "editor_config": _ec(
            "poll",
            [
                {"key": "question", "type": "text", "label": "Question", "required": True, "max_length": 120},
                {"key": "options", "type": "option_list", "label": "Choices", "min_count": 2, "max_count": 8},
            ],
            {"question": "What should we ship next?", "options": [
                {"id": "a", "label": "Option A", "votes": 0},
                {"id": "b", "label": "Option B", "votes": 0},
            ]},
        ),
    },
    {
        "key": "link_hub",
        "name": "Link Hub",
        "icon": "Link",
        "category_group": "social",
        "description": "A linktree-style list of outbound links.",
        "default_size": "medium",
        "editor_config": _ec(
            "list",
            [
                {"key": "title", "type": "text", "label": "Title", "required": True, "max_length": 80},
                {"key": "items", "type": "rich_item", "label": "Links", "max_count": 20},
            ],
            {"title": "My Links", "items": [
                {"id": "l1", "label": "Website", "url": "https://", "icon": "Globe"},
                {"id": "l2", "label": "Spotify", "url": "https://", "icon": "Music"},
                {"id": "l3", "label": "Instagram", "url": "https://", "icon": "Instagram"},
            ]},
        ),
    },
    {
        "key": "faq",
        "name": "FAQ",
        "icon": "HelpCircle",
        "category_group": "utility",
        "description": "Collapsible question-and-answer list.",
        "default_size": "large",
        "editor_config": _ec(
            "list",
            [
                {"key": "title", "type": "text", "label": "Title", "max_length": 80},
                {"key": "items", "type": "rich_item", "label": "Q & A", "max_count": 20},
            ],
            {"title": "Frequently Asked", "items": [
                {"id": "q1", "label": "What is OurRealm?", "body": "A creator-first social platform."},
                {"id": "q2", "label": "How do I claim VIP?", "body": "Subscribe via /vip."},
            ]},
        ),
    },
    {
        "key": "gallery",
        "name": "Gallery",
        "icon": "Image",
        "category_group": "media",
        "description": "A media grid for images and videos.",
        "default_size": "large",
        "editor_config": _ec(
            "media_grid",
            [
                {"key": "title", "type": "text", "label": "Title", "max_length": 80},
                {"key": "media", "type": "image", "label": "Gallery", "max_count": 12},
            ],
            {"title": "Recent Drops", "media": []},
        ),
    },
    {
        "key": "leaderboard",
        "name": "Leaderboard",
        "icon": "Trophy",
        "category_group": "gaming",
        "description": "Ranked list with avatar, name, and score.",
        "default_size": "large",
        "editor_config": _ec(
            "list",
            [
                {"key": "title", "type": "text", "label": "Title", "max_length": 80},
                {"key": "items", "type": "rich_item", "label": "Rankings", "max_count": 20},
            ],
            {"title": "Top Creators", "items": [
                {"id": "r1", "label": "@stealth", "value": "12,840 pts", "image": ""},
                {"id": "r2", "label": "@tftwo", "value": "9,212 pts", "image": ""},
                {"id": "r3", "label": "@tfone", "value": "6,015 pts", "image": ""},
            ]},
        ),
    },
    {
        "key": "donation_goal",
        "name": "Donation Goal",
        "icon": "HeartHandshake",
        "category_group": "business",
        "description": "Donation tracker with goal, current amount, and progress bar.",
        "default_size": "medium",
        "editor_config": _ec(
            "stat",
            [
                {"key": "label", "type": "text", "label": "Title", "required": True, "max_length": 60},
                {"key": "value", "type": "text", "label": "Current Amount", "required": True, "max_length": 24},
                {"key": "delta", "type": "text", "label": "Goal", "max_length": 24},
                {"key": "trend", "type": "toggle", "label": "Show Progress Bar", "default": True},
            ],
            {"label": "Studio Renovation", "value": "$3,420", "delta": "$10,000", "trend": True},
            theme={"accent": "#FF66A8"},
        ),
    },
    {
        "key": "event_card",
        "name": "Event Card",
        "icon": "Calendar",
        "category_group": "community",
        "description": "Event poster with date, location, and CTA.",
        "default_size": "medium",
        "editor_config": _ec(
            "card",
            [
                {"key": "title", "type": "text", "label": "Title", "required": True, "max_length": 80},
                {"key": "subtitle", "type": "text", "label": "Date · Venue", "max_length": 120},
                {"key": "image", "type": "image", "label": "Event Image", "max_count": 1},
                {"key": "body", "type": "long_text", "label": "Description", "max_length": 500},
                {"key": "cta_label", "type": "text", "label": "CTA", "max_length": 24, "default": "RSVP"},
                {"key": "cta_url", "type": "url", "label": "RSVP Link"},
            ],
            {
                "title": "Realm Festival",
                "subtitle": "Sat · 9 PM · Sky Park",
                "image": "",
                "body": "An invite-only mini festival inside the OurRealm community.",
                "cta_label": "RSVP",
                "cta_url": "https://",
            },
        ),
    },
    {
        "key": "announcement",
        "name": "Announcement",
        "icon": "Megaphone",
        "category_group": "social",
        "description": "Highlighted announcement card with tag + CTA.",
        "default_size": "medium",
        "editor_config": _ec(
            "card",
            [
                {"key": "title", "type": "text", "label": "Headline", "required": True, "max_length": 80},
                {"key": "subtitle", "type": "text", "label": "Tag", "max_length": 32, "default": "NEW"},
                {"key": "body", "type": "long_text", "label": "Body", "max_length": 500},
                {"key": "cta_label", "type": "text", "label": "CTA", "max_length": 24},
                {"key": "cta_url", "type": "url", "label": "CTA Link"},
            ],
            {
                "title": "Beta Drop incoming",
                "subtitle": "NEW",
                "body": "We're rolling out the new Widgets system this week.",
                "cta_label": "Read more",
                "cta_url": "",
            },
            theme={"accent": "#10E670"},
        ),
    },
    {
        "key": "achievement_showcase",
        "name": "Achievement Showcase",
        "icon": "Award",
        "category_group": "gaming",
        "description": "Highlight earned achievements with icon + label.",
        "default_size": "medium",
        "editor_config": _ec(
            "grid",
            [
                {"key": "title", "type": "text", "label": "Title", "max_length": 80},
                {"key": "items", "type": "rich_item", "label": "Achievements", "max_count": 12},
            ],
            {"title": "My Wins", "items": [
                {"id": "a1", "label": "First Post", "icon": "Star"},
                {"id": "a2", "label": "100 Friends", "icon": "Users"},
                {"id": "a3", "label": "Top Creator", "icon": "Crown"},
            ]},
        ),
    },

    # ─── Phase 3 — API-backed starter templates. Ship as DRAFT until
    # the founder adds the corresponding env key + launches.
    {
        "key": "live_weather",
        "name": "Live Weather",
        "icon": "CloudSun",
        "category_group": "utility",
        "description": "Current temperature + conditions for a city (OpenWeather).",
        "default_size": "small",
        "editor_config": _ec(
            "stat",
            [
                {"key": "label", "type": "text", "label": "City", "required": True, "max_length": 60},
                {"key": "value", "type": "text", "label": "Temperature", "required": True, "max_length": 24},
                {"key": "delta", "type": "text", "label": "Conditions", "max_length": 32},
            ],
            {"label": "London", "value": "—", "delta": "—"},
            data_source={
                "kind": "api", "provider": "openweather", "endpoint_key": "current",
                "params": {"q": "London", "units": "metric"},
                "response_map": {"label": "name", "value": "main.temp", "delta": "weather[0].main"},
                "refresh_seconds": 600, "cache_seconds": 600,
            },
        ),
    },
    {
        "key": "live_crypto",
        "name": "Live Crypto",
        "icon": "Bitcoin",
        "category_group": "business",
        "description": "Bitcoin USD price + 24h change (CoinGecko, no key needed).",
        "default_size": "small",
        "editor_config": _ec(
            "stat",
            [
                {"key": "label", "type": "text", "label": "Label", "required": True, "max_length": 32},
                {"key": "value", "type": "text", "label": "Price (USD)", "required": True, "max_length": 24},
                {"key": "delta", "type": "text", "label": "24h Change", "max_length": 24},
            ],
            {"label": "Bitcoin", "value": "—", "delta": "—"},
            data_source={
                "kind": "api", "provider": "coingecko", "endpoint_key": "simple_price",
                "params": {"ids": "bitcoin", "vs_currencies": "usd", "include_24hr_change": True},
                "response_map": {"value": "bitcoin.usd", "delta": "bitcoin.usd_24h_change"},
                "refresh_seconds": 120, "cache_seconds": 120,
            },
        ),
    },
    {
        "key": "live_nasa_apod",
        "name": "NASA APOD",
        "icon": "Rocket",
        "category_group": "media",
        "description": "Astronomy Picture of the Day (DEMO_KEY works without signup).",
        "default_size": "large",
        "editor_config": _ec(
            "card",
            [
                {"key": "title", "type": "text", "label": "Title", "max_length": 120},
                {"key": "image", "type": "image", "label": "Cover", "max_count": 1},
                {"key": "body", "type": "long_text", "label": "Explanation", "max_length": 800},
            ],
            {"title": "—", "image": "", "body": ""},
            data_source={
                "kind": "api", "provider": "nasa", "endpoint_key": "apod",
                "params": {},
                "response_map": {"title": "title", "image": "url", "body": "explanation"},
                "refresh_seconds": 86400, "cache_seconds": 86400,
            },
        ),
    },
    {
        "key": "live_github_repo",
        "name": "GitHub Repo",
        "icon": "Github",
        "category_group": "utility",
        "description": "Live stars + open issues for a public repo (no auth required).",
        "default_size": "medium",
        "editor_config": _ec(
            "stat",
            [
                {"key": "label", "type": "text", "label": "Repo", "required": True, "max_length": 60},
                {"key": "value", "type": "text", "label": "Stars", "required": True, "max_length": 24},
                {"key": "delta", "type": "text", "label": "Open Issues", "max_length": 24},
            ],
            {"label": "torvalds/linux", "value": "—", "delta": "—"},
            data_source={
                "kind": "api", "provider": "github", "endpoint_key": "repo",
                "params": {"owner": "torvalds", "repo": "linux"},
                "response_map": {"label": "full_name", "value": "stargazers_count", "delta": "open_issues_count"},
                "refresh_seconds": 600, "cache_seconds": 600,
            },
        ),
    },
    {
        "key": "live_reddit_top",
        "name": "Reddit Top Posts",
        "icon": "MessageSquare",
        "category_group": "community",
        "description": "Top posts from a subreddit (no key needed).",
        "default_size": "large",
        "editor_config": _ec(
            "list",
            [
                {"key": "title", "type": "text", "label": "Title", "max_length": 80},
                {"key": "items", "type": "rich_item", "label": "Posts", "max_count": 5},
            ],
            {"title": "r/programming (top today)", "items": []},
            data_source={
                "kind": "api", "provider": "reddit", "endpoint_key": "subreddit_top",
                "params": {"subreddit": "programming", "limit": 5, "t": "day"},
                "response_map": {},  # NOTE: structured list-binding via transforms lands in Phase 3.1
                "refresh_seconds": 600, "cache_seconds": 600,
            },
        ),
    },
]

TEMPLATE_KEYS = {t["key"] for t in TEMPLATES}


def get_template(key: str) -> Dict[str, Any] | None:
    for t in TEMPLATES:
        if t["key"] == key:
            return t
    return None


__all__ = ["TEMPLATES", "TEMPLATE_KEYS", "get_template"]
