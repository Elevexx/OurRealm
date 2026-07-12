// OurRealm static app configuration (formerly mockData.js).
// June 2026 production data audit: ALL synthetic social content
// (mock characters, mock posts, mock notifications, mock friends,
// fake realm member counts, demo trending tracks) has been removed.
// Only real database content may appear in feeds, profiles, realms,
// and notifications. What remains here is genuine app configuration.

export const INTERESTS = [
  { id: "gaming",    label: "Gaming",       icon: "Gamepad2",      glow: "#10E670", desc: "Esports, streaming, and next-level plays" },
  { id: "music",     label: "Music",        icon: "Music",         glow: "#C26BFF", desc: "Discover new sounds and trending artists" },
  { id: "tech",      label: "Tech",         icon: "Cpu",           glow: "#2EA0FF", desc: "Gadgets, AI, and the future of innovation" },
  { id: "fitness",   label: "Fitness",      icon: "Dumbbell",      glow: "#F4A23B", desc: "Workouts, wellness, and healthy living" },
  { id: "travel",    label: "Travel",       icon: "Plane",         glow: "#6BD3FF", desc: "Explore new places and hidden gems" },
  { id: "art",       label: "Art & Design", icon: "Palette",       glow: "#FF6BA0", desc: "Creative minds and visual inspiration" },
  { id: "business",  label: "Business",     icon: "Briefcase",     glow: "#F4C84A", desc: "Entrepreneurship, stocks, and mindset" },
  { id: "movies",    label: "Movies & TV",  icon: "Film",          glow: "#C26BFF", desc: "Pop culture, reviews, and must-watch" },
  { id: "photography",label: "Photography", icon: "Camera",        glow: "#6BD3FF", desc: "Capture the world through your lens" },
  { id: "books",     label: "Books",        icon: "BookOpen",      glow: "#10E670", desc: "Stories that inspire and educate" },
  { id: "foodie",    label: "Foodie",       icon: "UtensilsCrossed",glow: "#FF6BA0",desc: "Recipes, reviews, and food lovers" },
  { id: "fashion",   label: "Fashion",      icon: "Shirt",         glow: "#C26BFF", desc: "Trends, style tips, and looks" },
  { id: "festivals", label: "Festivals",    icon: "PartyPopper",   glow: "#FF8AC2", desc: "Live music, lights, crowds" },
  { id: "dj",        label: "DJ Culture",   icon: "Disc3",         glow: "#6BD3FF", desc: "Mixes, decks, after-hours" },
  { id: "crypto",    label: "Crypto",       icon: "Bitcoin",       glow: "#F4C84A", desc: "Markets, chains, and on-chain culture" },
  { id: "sports",    label: "Sports",       icon: "Trophy",        glow: "#10E670", desc: "Plays, clips, and rivalries" },
  { id: "news",      label: "News",         icon: "Newspaper",     glow: "#2EA0FF", desc: "Breaking, trending, signal over noise" },
  { id: "education", label: "Education",    icon: "GraduationCap", glow: "#10E670", desc: "Learn, grow, and level up" },
  { id: "podcasts",  label: "Podcasts",     icon: "Mic",           glow: "#C26BFF", desc: "Long-form, real conversations" },
  { id: "science",   label: "Science",      icon: "Atom",          glow: "#6BD3FF", desc: "Discoveries that bend reality" },
];

const SCENES = [
  "https://images.unsplash.com/photo-1518972559570-7cc1309f3229?w=900",
  "https://images.unsplash.com/photo-1493676304819-0d7a8d026dcf?w=900",
  "https://images.unsplash.com/photo-1483721310020-03333e577078?w=900",
  "https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?w=900",
  "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=900",
  "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=900",
  "https://images.unsplash.com/photo-1488972685288-c3fd157d7c7a?w=900",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900",
];

// Demo trending tracks removed — Sounds/Music surfaces now render only
// real tracks from the database. Kept as an empty array so existing
// imports remain valid and simply contribute nothing.
export const TRENDING_TRACKS = [];

export const NOTIFICATION_CATEGORIES = [
  "All", "Likes", "Comments", "Shares", "Followers", "Messages", "Realm Activity", "Events",
];

// Wallet / Marketplace are pre-launch FEATURE DEMOS (clearly non-social
// placeholder pages) — retained pending their real implementations.
export const WALLET = {
  balance: 14820.42,
  pending: 2480.55,
  monthly_change_pct: 12.4,
  thirty_day: 5240.10,
  lifetime: 86420.18,
  rows: [
    { id: "creator",      label: "Creator Revenue",      amount: 6240.12, color: "#2EA0FF" },
    { id: "ads",          label: "Ad Revenue",            amount: 959.00,  color: "#F4C84A" },
    { id: "merch",        label: "Merch Revenue",         amount: 2860.00, color: "#10E670" },
    { id: "music",        label: "Music Revenue",         amount: 1820.55, color: "#C26BFF" },
    { id: "subscription", label: "Subscription Revenue", amount: 1840.75, color: "#FF8AC2" },
    { id: "tips",         label: "Tips",                  amount: 640.75,  color: "#FFB72E" },
    { id: "affiliate",    label: "Affiliate Revenue",     amount: 815.00,  color: "#6BD3FF" },
    { id: "referral",     label: "Referral Revenue",      amount: 320.00,  color: "#16C16C" },
  ],
  history: Array.from({ length: 12 }).map((_, i) => ({
    month: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i],
    creator:      400 + ((i * 73) % 900),
    ads:          120 + ((i * 31) % 250),
    merch:        200 + ((i * 41) % 600),
    music:        180 + ((i * 53) % 500),
    subscription: 240 + ((i * 47) % 400),
    tips:         60  + ((i * 19) % 200),
  })),
  transactions: [],
};

export const MARKETPLACE_ADS = Array.from({ length: 8 }).map((_, i) => ({
  id: `ad-${i}`,
  brand: ["LumenWave","Orbital Audio","Nullspace","Tessera","Veil Studio","Pulse Co.","Magnitude","Northstar Labs"][i],
  payout: `$${(0.4 + i * 0.15).toFixed(2)} / view`,
  size: ["Small","Medium","Large","Full Width"][i % 4],
  cover: SCENES[i % SCENES.length],
  category: ["Music","Tech","Fashion","Crypto"][i % 4],
}));

// ONLY THESE 15 WIDGET TYPES EXIST (Feb 24, 2026 spec). Backend
// enforces the same list via `core/widget_types.py:ALLOWED_WIDGET_TYPES`
// — any saved widget with a type not in this set is stripped on read
// AND on PATCH. Adding a new type requires updating BOTH files.
export const WIDGET_TYPES = [
  { id: "myfeed",    label: "My Feed",         icon: "Sparkles",    default_size: "large",  cat: "feed" },
  { id: "top8",      label: "Top 8 Friends",   icon: "Users",       default_size: "medium", cat: "social" },
  { id: "live",      label: "Live Stream",     icon: "Radio",       default_size: "large",  cat: "content" },
  { id: "videos",    label: "Videos",          icon: "PlayCircle",  default_size: "medium", cat: "content" },
  { id: "music",     label: "Music",           icon: "Music",       default_size: "medium", cat: "content" },
  { id: "podcasts",  label: "Podcasts",        icon: "Mic",         default_size: "medium", cat: "content" },
  { id: "photos",    label: "Photos",          icon: "Image",       default_size: "medium", cat: "content" },
  { id: "events",    label: "Events",          icon: "Calendar",    default_size: "small",  cat: "schedule" },
  { id: "weather",   label: "Weather",         icon: "CloudSun",    default_size: "small",  cat: "utility" },
  { id: "calendar",  label: "Calendar",        icon: "CalendarDays",default_size: "small",  cat: "utility" },
  { id: "countdown", label: "Countdown",       icon: "Timer",       default_size: "small",  cat: "utility" },
  { id: "notes",     label: "Notes",           icon: "StickyNote",  default_size: "small",  cat: "utility" },
  { id: "polls",     label: "Polls",           icon: "BarChart3",   default_size: "medium", cat: "engagement" },
  { id: "survey",    label: "Survey",          icon: "ClipboardList", default_size: "medium", cat: "engagement" },
  { id: "blog",      label: "Blog",            icon: "BookOpen",    default_size: "medium", cat: "content" },
  { id: "radar",     label: "Stealth Radar",   icon: "Radar",       default_size: "medium", cat: "signature" },
];

// Mirror of backend ALLOWED_WIDGET_TYPES — used to defensively filter
// any legacy widget rows the API might still hand us during the
// strip migration's rollout window.
export const ALLOWED_WIDGET_TYPES = new Set(WIDGET_TYPES.map((w) => w.id));

// Default profile widget layout for NEW users (Feb 20, 2026).
export const DEFAULT_WIDGETS = [
  { id: "w-top8",   type: "top8",   size: "medium" },
  { id: "w-myfeed", type: "myfeed", size: "large"  },
];

export const MODE_PREVIEW_IMG = {
  neon:       "https://images.pexels.com/photos/28122495/pexels-photo-28122495.jpeg",
  business:   "https://images.unsplash.com/photo-1763940018489-12e722c40bab",
  millennium: "https://images.unsplash.com/photo-1679269241012-f7640862d242",
  stealth:    "https://images.unsplash.com/photo-1650043996692-a51e3d749766",
  music:      "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17",
};
