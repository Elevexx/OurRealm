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
        limits: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """editor_config builder — keeps the shape identical everywhere."""
    return {
        "schema_version": 1,
        "layout": layout,
        "fields": fields,
        "data": data,
        "data_source": {"kind": "static", "api": None, "refresh_seconds": 0},
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
]

TEMPLATE_KEYS = {t["key"] for t in TEMPLATES}


def get_template(key: str) -> Dict[str, Any] | None:
    for t in TEMPLATES:
        if t["key"] == key:
            return t
    return None


__all__ = ["TEMPLATES", "TEMPLATE_KEYS", "get_template"]
