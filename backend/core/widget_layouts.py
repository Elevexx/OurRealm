"""Widget layout registry (Phase 2A — Custom Widget Builder).

Source of truth for every layout the custom-widget builder supports.
Each layout declares:
  • `key`         — stable identifier (snake_case) stored in editor_config.layout
  • `name`        — human-friendly label shown in the builder
  • `icon`        — lucide-react icon name (frontend-only hint)
  • `description` — short blurb for the builder UI
  • `fields`      — ordered list of FIELDS this layout SUPPORTS. The
                    builder uses these as the default field set; the
                    admin can add/remove/rename freely.
  • `field_caps`  — per-field-type cap so 'media_grid' can demand
                    ≥1 image and Card stays single-asset by default.
  • `category_hint` — default category_group for the builder.

Adding a new layout is a one-entry-append operation — no other code
changes required because the renderer dispatches on `layout` and the
field types are themselves registry-driven (see FIELD_TYPES).

Field types are intentionally generic primitives so future
data-source plugins (Phase 3 — Weather, News, Stocks, etc.) can
emit values for the same primitives without bespoke renderers.
"""
from __future__ import annotations
from typing import List, Dict, Any

# ─────────────────────────────────────────────────────────────────────
# FIELD TYPES — primitives the builder/renderer both understand.
# Adding a new type means (a) appending here and (b) handling it in
# CustomWidgetRenderer.jsx + FieldEditor.jsx. No backend changes
# needed because editor_config is stored as a free-form dict.
# ─────────────────────────────────────────────────────────────────────
FIELD_TYPES: List[Dict[str, Any]] = [
    {"key": "text",      "label": "Text",         "icon": "Type",          "supports": ["label", "placeholder", "max_length", "required", "default"]},
    {"key": "long_text", "label": "Long Text",    "icon": "AlignLeft",     "supports": ["label", "placeholder", "max_length", "required", "default"]},
    {"key": "number",    "label": "Number",       "icon": "Hash",          "supports": ["label", "placeholder", "min", "max", "required", "default"]},
    {"key": "toggle",    "label": "Toggle",       "icon": "ToggleRight",   "supports": ["label", "default"]},
    {"key": "date",      "label": "Date",         "icon": "Calendar",      "supports": ["label", "required", "default"]},
    {"key": "datetime",  "label": "Date + Time",  "icon": "Clock",         "supports": ["label", "required", "default"]},
    {"key": "url",       "label": "Link / URL",   "icon": "Link",          "supports": ["label", "placeholder", "required", "default"]},
    {"key": "color",     "label": "Color",        "icon": "Palette",       "supports": ["label", "default"]},
    {"key": "image",     "label": "Image",        "icon": "Image",         "supports": ["label", "max_count", "required"]},
    {"key": "video",     "label": "Video",        "icon": "PlayCircle",    "supports": ["label", "max_count"]},
    {"key": "sound",     "label": "Sound / Audio","icon": "Music",         "supports": ["label", "max_count"]},
    {"key": "option_list","label": "Options",     "icon": "List",          "supports": ["label", "max_count", "min_count"]},
    {"key": "rich_item", "label": "Rich Item",    "icon": "LayoutGrid",    "supports": ["label", "max_count"]},
    {"key": "embed",     "label": "Embed URL",    "icon": "Code",          "supports": ["label", "placeholder", "required"]},
    # Phase 3.5 — Conversational AI primitives.
    {"key": "chat_input",  "label": "Chat Input",  "icon": "MessageSquare", "supports": ["label", "placeholder", "max_length", "required", "multiline"]},
    {"key": "ai_response", "label": "AI Response", "icon": "Sparkles",      "supports": ["label", "markdown", "code_blocks", "copy_button", "show_timestamp"]},
]

# Quick lookup
FIELD_TYPE_KEYS = {f["key"] for f in FIELD_TYPES}


def _f(key: str, ftype: str, label: str, **extra) -> Dict[str, Any]:
    """Convenience for the layout default-field declarations below."""
    base = {"key": key, "type": ftype, "label": label, "required": False}
    base.update(extra)
    return base


# ─────────────────────────────────────────────────────────────────────
# LAYOUTS — every layout the custom builder can produce.
# ─────────────────────────────────────────────────────────────────────
LAYOUTS: List[Dict[str, Any]] = [
    {
        "key": "card",
        "name": "Card",
        "icon": "Square",
        "description": "A single tile with a title, optional image, body text, and CTA.",
        "category_hint": "social",
        "fields": [
            _f("title", "text", "Title", max_length=80, required=True),
            _f("subtitle", "text", "Subtitle", max_length=120),
            _f("image", "image", "Cover Image", max_count=1),
            _f("body", "long_text", "Body", max_length=500),
            _f("cta_label", "text", "CTA Label", max_length=24),
            _f("cta_url", "url", "CTA Link"),
        ],
    },
    {
        "key": "list",
        "name": "List",
        "icon": "List",
        "description": "A vertical list of items with icons + labels.",
        "category_hint": "utility",
        "fields": [
            _f("title", "text", "Title", max_length=80, required=True),
            _f("items", "rich_item", "List Items", max_count=20),
        ],
    },
    {
        "key": "grid",
        "name": "Grid",
        "icon": "Grid3x3",
        "description": "A responsive grid of tiles (cards, links, or stats).",
        "category_hint": "community",
        "fields": [
            _f("title", "text", "Title", max_length=80),
            _f("items", "rich_item", "Grid Items", max_count=24),
        ],
    },
    {
        "key": "media_grid",
        "name": "Media Grid",
        "icon": "LayoutGrid",
        "description": "Image or video gallery (1-12 tiles, lightbox on click).",
        "category_hint": "media",
        "fields": [
            _f("title", "text", "Title", max_length=80),
            _f("media", "image", "Gallery", max_count=12),
        ],
    },
    {
        "key": "poll",
        "name": "Poll",
        "icon": "BarChart3",
        "description": "A single-question multi-option poll with live tallies.",
        "category_hint": "community",
        "fields": [
            _f("question", "text", "Question", max_length=120, required=True),
            _f("options", "option_list", "Choices", min_count=2, max_count=8),
        ],
    },
    {
        "key": "stat",
        "name": "Stat",
        "icon": "TrendingUp",
        "description": "A single big number with an optional label + delta.",
        "category_hint": "business",
        "fields": [
            _f("label", "text", "Label", max_length=60, required=True),
            _f("value", "text", "Value", max_length=24, required=True),
            _f("delta", "text", "Delta (optional)", max_length=24),
            _f("trend", "toggle", "Trend Up?"),
        ],
    },
    {
        "key": "embed",
        "name": "Embed",
        "icon": "Code",
        "description": "Render an external embed URL (YouTube, Spotify, Twitch, …).",
        "category_hint": "media",
        "fields": [
            _f("title", "text", "Title", max_length=80),
            _f("embed_url", "embed", "Embed URL", required=True),
            _f("aspect", "text", "Aspect Ratio", default="16/9", max_length=10),
        ],
    },
    # Phase 3.5 — Conversational AI layout.
    {
        "key": "chat",
        "name": "Chat",
        "icon": "MessageSquare",
        "description": "Conversational AI widget — chat input, AI response, persistent history.",
        "category_hint": "utility",
        "fields": [
            _f("title", "text", "Header Title", max_length=80, default="AI Assistant"),
            _f("input", "chat_input", "Message Input", placeholder="Ask anything…"),
            _f("response", "ai_response", "AI Response", markdown=True, copy_button=True),
        ],
    },
]

LAYOUT_KEYS = {layout["key"] for layout in LAYOUTS}

# ─────────────────────────────────────────────────────────────────────
# CATEGORY GROUPS — coarse buckets surfaced in the admin builder.
# Free-form `category` on widgets still exists for finer tagging;
# `category_group` is what powers the discovery filters.
# ─────────────────────────────────────────────────────────────────────
CATEGORY_GROUPS: List[Dict[str, str]] = [
    {"key": "social",    "label": "Social",    "color": "#FF66A8"},
    {"key": "media",     "label": "Media",     "color": "#7C5CFF"},
    {"key": "community", "label": "Community", "color": "#00C2FF"},
    {"key": "utility",   "label": "Utility",   "color": "#10E670"},
    {"key": "business",  "label": "Business",  "color": "#F4C84A"},
    {"key": "gaming",    "label": "Gaming",    "color": "#FF5A6B"},
    {"key": "custom",    "label": "Custom",    "color": "#9C9C9C"},
]

CATEGORY_GROUP_KEYS = {c["key"] for c in CATEGORY_GROUPS}


# ─────────────────────────────────────────────────────────────────────
# DATA SOURCE KINDS — Phase 3 plugin hook. The renderer reads
# editor_config.data_source.kind and either renders static field
# values (kind=static) or, eventually, calls a backend API plugin
# (kind=api) keyed by `provider`. Listed here so the builder can
# preview-config them today even though the live API wiring lands later.
# ─────────────────────────────────────────────────────────────────────
DATA_SOURCE_KINDS: List[Dict[str, Any]] = [
    {"key": "static", "label": "Manual / Static", "description": "Admin types the values directly. Always available."},
    {"key": "api",    "label": "Live API",        "description": "Pulls from a backend data provider on render. (Phase 3 — providers register here.)"},
]


def schema_payload() -> Dict[str, Any]:
    """Single endpoint payload that boots the frontend builder."""
    return {
        "schema_version": 1,
        "layouts": LAYOUTS,
        "field_types": FIELD_TYPES,
        "category_groups": CATEGORY_GROUPS,
        "data_source_kinds": DATA_SOURCE_KINDS,
    }


__all__ = [
    "LAYOUTS",
    "LAYOUT_KEYS",
    "FIELD_TYPES",
    "FIELD_TYPE_KEYS",
    "CATEGORY_GROUPS",
    "CATEGORY_GROUP_KEYS",
    "DATA_SOURCE_KINDS",
    "schema_payload",
]
