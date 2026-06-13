// OurRealm mock data — characters & content per uploaded screenshots
// Character lineup: LunaX, Jaxon, Nova, Striker, Zara, Kai, Milo (current user: Alex Carter)

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

const PORTRAITS = {
  LunaX:  "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400",
  Jaxon:  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
  Nova:   "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400",
  Striker:"https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=400",
  Zara:   "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400",
  Kai:    "https://images.unsplash.com/photo-1502685104226-ee32379fefbe?w=400",
  Milo:   "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
  Alex:   "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
};

export const CHARACTERS = [
  { id: "lunax",   handle: "LunaX",   name: "LunaX",   avatar: PORTRAITS.LunaX,   status: "live",    label: "LIVE",         ringColor: "#FF3F5A" },
  { id: "jaxon",   handle: "Jaxon",   name: "Jaxon",   avatar: PORTRAITS.Jaxon,   status: "live",    label: "LIVE",         ringColor: "#FF3F5A" },
  { id: "nova",    handle: "Nova",    name: "Nova",    avatar: PORTRAITS.Nova,    status: "in-app",  label: "In Messenger", ringColor: "#2EA0FF" },
  { id: "striker", handle: "Striker", name: "Striker", avatar: PORTRAITS.Striker, status: "online",  label: "Online",       ringColor: "#10E670" },
  { id: "zara",    handle: "Zara",    name: "Zara",    avatar: PORTRAITS.Zara,    status: "online",  label: "Online",       ringColor: "#10E670" },
  { id: "kai",     handle: "Kai",     name: "Kai",     avatar: PORTRAITS.Kai,     status: "online",  label: "Online",       ringColor: "#10E670" },
  { id: "milo",    handle: "Milo",    name: "Milo",    avatar: PORTRAITS.Milo,    status: "offline", label: "Offline",      ringColor: "#5A6378" },
];

export const CURRENT_PERSONA = {
  name: "Alex Carter",
  level: 24,
  rp: 4250,
  avatar: PORTRAITS.Alex,
};

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

const CAPTIONS = [
  "Mixed a new set under the city lights.",
  "Studio progress: layering pads and 808 sub. Drop incoming.",
  "Field recording from the festival mainstage — headphones up.",
  "Quick thought: discovery is broken everywhere else. Not here.",
  "Live from the rooftop — talk crypto with me.",
  "New podcast episode on the creator economy.",
  "Weekend lift PRs.",
  "Frame I caught at golden hour.",
];

export function makeMockPosts(count = 30) {
  const types = ["image", "video", "live", "sound", "post", "thought"];
  return Array.from({ length: count }).map((_, i) => {
    const ch = CHARACTERS[i % CHARACTERS.length];
    const t = types[i % types.length];
    return {
      id: `mock-${i}`,
      author_id: ch.id,
      author_name: ch.name,
      author_avatar: ch.avatar,
      content: CAPTIONS[i % CAPTIONS.length],
      media_type: t,
      media_url: t === "post" || t === "thought" ? null : SCENES[i % SCENES.length],
      tags: [],
      likes: 80 + ((i * 37) % 4000),
      comments: 5 + ((i * 11) % 240),
      created_at: new Date(Date.now() - i * 3600 * 1000 * (1 + (i % 5))).toISOString(),
    };
  });
}

// ---- Messages page data ----
export const PINNED_CONVERSATIONS = [
  { id: "pin-1", character: CHARACTERS[0], badge: "LIVE",    badgeColor: "#FF3F5A", text: "Going live in 5 mins! 🔥" },
  { id: "pin-2", character: CHARACTERS[1], badge: "LIVE",    badgeColor: "#FF3F5A", text: "Let's squad up tonight" },
  { id: "pin-3", character: CHARACTERS[2], badge: "In App",  badgeColor: "#2EA0FF", text: "Check out this new track" },
  { id: "pin-4", character: CHARACTERS[3], badge: "Online",  badgeColor: "#10E670", text: "Want to run some matches?" },
];

export const GROUP_CHATS = [
  { id: "g-1", name: "Realm Raiders", emoji: "👑", time: "9:41 PM", preview: "Let's dominate the arena tonight. Everyone ready?", count: 12, accent: "#2EA0FF" },
  { id: "g-2", name: "Music Underground",         time: "8:30 PM", preview: "New beats dropping this weekend!",                count: 24, accent: "#C26BFF" },
  { id: "g-3", name: "Gaming Legends",            time: "7:15 PM", preview: "Tournament brackets are live. Let's go!",          count: 36, accent: "#10E670" },
  { id: "g-4", name: "Late Night Vibes", emoji: "🌙", time: "6:02 PM", preview: "Chill chat, no rules, just good vibes",         count: 18, accent: "#F4A23B" },
];

export const DIRECT_MESSAGES = [
  { id: "dm-1", character: CHARACTERS[0], time: "9:50 PM", preview: "Going live in 5 mins! 🔥", badge: "LIVE",        badgeColor: "#FF3F5A", unread: 1 },
  { id: "dm-2", character: CHARACTERS[2], time: "9:41 PM", preview: "Check out this new track!", badge: "In Messenger",badgeColor: "#2EA0FF", unread: 0 },
  { id: "dm-3", character: CHARACTERS[1], time: "9:32 PM", preview: "Let's vibe to this drop",   badge: "LIVE",        badgeColor: "#FF3F5A", pinned: true },
  { id: "dm-4", character: CHARACTERS[3], time: "9:15 PM", preview: "Want to run some matches?", badge: "Online",      badgeColor: "#10E670", pinned: true },
  { id: "dm-5", character: CHARACTERS[4], time: "8:47 PM", preview: "🔥 That beat is fire",       badge: "Online",      badgeColor: "#10E670" },
  { id: "dm-6", character: CHARACTERS[5], time: "8:30 PM", preview: "See you at the event!",     badge: "Online",      badgeColor: "#10E670" },
  { id: "dm-7", character: CHARACTERS[6], time: "7:58 PM", preview: "Yo, you free later?",       badge: "Offline",     badgeColor: "#5A6378", unread: 2 },
];

// ---- Music / Sounds ----
const COVERS = [
  "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=400",
  "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400",
  "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400",
  "https://images.unsplash.com/photo-1485579149621-3123dd979885?w=400",
  "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=400",
  "https://images.unsplash.com/photo-1471478331149-c72f17e33c73?w=400",
  "https://images.unsplash.com/photo-1499415479124-43c32433a620?w=400",
  "https://images.unsplash.com/photo-1493676304819-0d7a8d026dcf?w=400",
];
const TITLES = ["Phase Shift","Orbital Drift","Pulse Garden","Static Bloom","Velvet Static","Crystal Run","After Hours","Magnetic North","Solstice","Ghost Mode","Hyperreal","Nebulae"];

export const TRENDING_TRACKS = TITLES.map((title, i) => ({
  id: `tr-${i}`,
  title,
  artist: CHARACTERS[i % CHARACTERS.length].name,
  artist_id: CHARACTERS[i % CHARACTERS.length].id,
  cover: COVERS[i % COVERS.length],
  duration: "3:" + (20 + (i % 30)).toString().padStart(2, "0"),
  genre: ["Psytrance","House","Techno","Drum & Bass","Ambient","Hip-Hop","Indie"][i % 7],
  category: ["Music","Music","Podcasts","Music","FX","AI","Music"][i % 7],
  mood: ["Energetic","Chill","Dark","Uplifting","Focus","Party"][i % 6],
  distance_miles: 5 + ((i * 17) % 240),
  plays: 1200 + ((i * 113) % 80000),
}));

// ---- Discover rows ----
export const DISCOVER_ROWS = [
  { id: "top",        title: "Top",          icon: "Crown" },
  { id: "trending",   title: "Trending",     icon: "Flame" },
  { id: "rising",     title: "Up & Coming",  icon: "Rocket" },
  { id: "new",        title: "New",          icon: "Sparkles" },
  { id: "creators",   title: "Creators",     icon: "Users" },
  { id: "videos",     title: "Videos",       icon: "PlayCircle" },
  { id: "lives",      title: "Lives",        icon: "Radio" },
  { id: "music",      title: "Music",        icon: "Music" },
  { id: "podcasts",   title: "Podcasts",     icon: "Mic" },
  { id: "businesses", title: "Businesses",   icon: "Briefcase" },
  { id: "profiles",   title: "Profiles",     icon: "User" },
];

// ---- Notifications, Friends, Wallet, Marketplace, Widgets ----
export const NOTIFICATIONS = [
  { id: 1, type: "like",           actor: "LunaX",   target: "your post 'Phase Shift'",   when: "2m" },
  { id: 2, type: "comment",        actor: "Jaxon",   target: "your reel",                 when: "12m" },
  { id: 3, type: "follow",         actor: "Nova",    target: null,                        when: "1h" },
  { id: 4, type: "mention",        actor: "Striker", target: "in a community post",       when: "3h" },
  { id: 5, type: "message",        actor: "Zara",    target: "sent you a voice note",     when: "5h" },
  { id: 6, type: "friend_request", actor: "Kai",     target: null,                        when: "1d" },
  { id: 7, type: "share",          actor: "Milo",    target: "your live stream",          when: "1d" },
];

export const FRIENDS = CHARACTERS.map((c, i) => ({
  id: `friend-${c.id}`,
  handle: c.handle,
  name: c.name,
  avatar: c.avatar,
  is_online: c.status !== "offline",
  mutuals: 3 + ((i * 7) % 14),
}));

export const WALLET = {
  balance: 14820.42,
  monthly_change_pct: 12.4,
  rows: [
    { id: "rewards",   label: "Creator Rewards", amount: 6240.12 },
    { id: "ads",       label: "Ad Revenue",      amount: 959.00  },
    { id: "royalties", label: "Royalties",       amount: 3120.55 },
    { id: "sales",     label: "Sales",           amount: 2860.00 },
    { id: "tips",      label: "Tips",            amount: 1640.75 },
    { id: "affiliate", label: "Affiliate Revenue", amount: 815.00 },
  ],
  history: Array.from({ length: 12 }).map((_, i) => ({
    month: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i],
    rewards: 400 + ((i * 73) % 900),
    sales:   200 + ((i * 41) % 600),
    royalties: 300 + ((i * 53) % 700),
  })),
};

export const MARKETPLACE_ADS = Array.from({ length: 8 }).map((_, i) => ({
  id: `ad-${i}`,
  brand: ["LumenWave","Orbital Audio","Nullspace","Tessera","Veil Studio","Pulse Co.","Magnitude","Northstar Labs"][i],
  payout: `$${(0.4 + i * 0.15).toFixed(2)} / view`,
  size: ["Small","Medium","Large","Full Width"][i % 4],
  cover: SCENES[i % SCENES.length],
  category: ["Music","Tech","Fashion","Crypto"][i % 4],
}));

export const WIDGET_TYPES = [
  { id: "live",     label: "Live Stream",     icon: "Radio",       default_size: "large" },
  { id: "videos",   label: "Videos",          icon: "PlayCircle",  default_size: "medium" },
  { id: "music",    label: "Music",           icon: "Music",       default_size: "medium" },
  { id: "podcasts", label: "Podcasts",        icon: "Mic",         default_size: "medium" },
  { id: "photos",   label: "Photos",          icon: "Image",       default_size: "medium" },
  { id: "merch",    label: "Merch",           icon: "ShoppingBag", default_size: "full" },
  { id: "tour",     label: "Tour Dates",      icon: "MapPin",      default_size: "medium" },
  { id: "friends",  label: "Friends",         icon: "Users",       default_size: "small" },
  { id: "wallet",   label: "Wallet",          icon: "Wallet",      default_size: "small" },
  { id: "weather",  label: "Weather",         icon: "Cloud",       default_size: "small" },
  { id: "events",   label: "Events",          icon: "Calendar",    default_size: "small" },
  { id: "news",     label: "News",            icon: "Newspaper",   default_size: "medium" },
  { id: "crypto",   label: "Crypto",          icon: "Bitcoin",     default_size: "small" },
  { id: "stocks",   label: "Stocks",          icon: "TrendingUp",  default_size: "small" },
  { id: "notes",    label: "Notes",           icon: "StickyNote",  default_size: "small" },
  { id: "polls",    label: "Polls",           icon: "BarChart3",   default_size: "medium" },
  { id: "ads",      label: "Marketplace Ads", icon: "Megaphone",   default_size: "medium" },
  { id: "custom",   label: "Custom",          icon: "Sparkles",    default_size: "small" },
];

export const DEFAULT_WIDGETS = [
  { id: "w1", type: "live",   size: "large" },
  { id: "w2", type: "music",  size: "medium" },
  { id: "w3", type: "photos", size: "medium" },
  { id: "w4", type: "friends",size: "small" },
  { id: "w5", type: "wallet", size: "small" },
  { id: "w6", type: "events", size: "small" },
  { id: "w7", type: "tour",   size: "medium" },
  { id: "w8", type: "merch",  size: "full" },
];

export const MODE_PREVIEW_IMG = {
  neon:       "https://images.pexels.com/photos/28122495/pexels-photo-28122495.jpeg",
  business:   "https://images.unsplash.com/photo-1763940018489-12e722c40bab",
  millennium: "https://images.unsplash.com/photo-1679269241012-f7640862d242",
  stealth:    "https://images.unsplash.com/photo-1650043996692-a51e3d749766",
  music:      "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17",
};
