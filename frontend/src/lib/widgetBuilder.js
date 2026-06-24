/**
 * widget-builder shared constants. Mirrors the backend
 * `core/widget_layouts.py` enums so the frontend can render the
 * builder without an extra round-trip when offline (the canonical
 * payload still comes from /api/admin/widgets/schema).
 *
 * The values listed here MUST stay in sync with the backend.
 * Both sides are intentionally permissive — adding a new layout
 * is one entry on each side and no other code changes.
 */

export const FIELD_TYPES = [
  { key: "text",       label: "Text",          icon: "Type",        supports: ["label", "placeholder", "max_length", "required", "default"] },
  { key: "long_text",  label: "Long Text",     icon: "AlignLeft",   supports: ["label", "placeholder", "max_length", "required", "default"] },
  { key: "number",     label: "Number",        icon: "Hash",        supports: ["label", "placeholder", "min", "max", "required", "default"] },
  { key: "toggle",     label: "Toggle",        icon: "ToggleRight", supports: ["label", "default"] },
  { key: "date",       label: "Date",          icon: "Calendar",    supports: ["label", "required", "default"] },
  { key: "datetime",   label: "Date + Time",   icon: "Clock",       supports: ["label", "required", "default"] },
  { key: "url",        label: "Link / URL",    icon: "Link",        supports: ["label", "placeholder", "required", "default"] },
  { key: "color",      label: "Color",         icon: "Palette",     supports: ["label", "default"] },
  { key: "image",      label: "Image",         icon: "Image",       supports: ["label", "max_count", "required"] },
  { key: "video",      label: "Video",         icon: "PlayCircle",  supports: ["label", "max_count"] },
  { key: "sound",      label: "Sound / Audio", icon: "Music",       supports: ["label", "max_count"] },
  { key: "option_list",label: "Options",       icon: "List",        supports: ["label", "max_count", "min_count"] },
  { key: "rich_item",  label: "Rich Item",     icon: "LayoutGrid",  supports: ["label", "max_count"] },
  { key: "embed",      label: "Embed URL",     icon: "Code",        supports: ["label", "placeholder", "required"] },
];

export const CATEGORY_GROUPS = [
  { key: "social",    label: "Social",    color: "#FF66A8" },
  { key: "media",     label: "Media",     color: "#7C5CFF" },
  { key: "community", label: "Community", color: "#00C2FF" },
  { key: "utility",   label: "Utility",   color: "#10E670" },
  { key: "business",  label: "Business",  color: "#F4C84A" },
  { key: "gaming",    label: "Gaming",    color: "#FF5A6B" },
  { key: "custom",    label: "Custom",    color: "#9C9C9C" },
];

export const PLACEMENTS = [
  { id: "profile", label: "Profile" },
  { id: "home",    label: "Home" },
  { id: "realm",   label: "Realm" },
];

export const ACCESS_GROUPS = [
  { id: "founder",    label: "Founder" },
  { id: "admin",      label: "Admin" },
  { id: "vip",        label: "VIP" },
  { id: "standard",   label: "Standard" },
  { id: "all_users",  label: "All Users" },
];

export const SIZES = ["small", "medium", "large", "xl"];

export const ICON_CHOICES = [
  "Sparkles", "Users", "Radio", "PlayCircle", "Music", "Mic", "Image",
  "Calendar", "CloudSun", "CalendarDays", "Timer", "StickyNote",
  "BarChart3", "ClipboardList", "BookOpen", "Radar", "Award", "Star",
  "Crown", "ShieldCheck", "Heart", "Flame", "Zap", "Gem", "Trophy",
  "Megaphone", "HeartHandshake", "HelpCircle", "Globe", "Instagram",
  "Link", "List", "LayoutGrid", "Grid3x3", "TrendingUp", "Code",
  "Hash", "Type", "AlignLeft", "ToggleRight", "Palette", "Clock",
];

// Empty editor_config skeleton when starting from scratch.
export const blankEditorConfig = (layout = "card") => ({
  schema_version: 1,
  layout,
  fields: [],
  data: {},
  data_source: { kind: "static", api: null, refresh_seconds: 0 },
  theme: {},
  limits: {},
});

// Snake-case a free-form name into a candidate widget key.
export const slugifyKey = (str) =>
  (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 64);
