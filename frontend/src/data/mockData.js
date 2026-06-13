// OurRealm mock data — used to power Feed, Discover, Music, Friends, Notifications, Wallet
// Images sourced from Unsplash/Pexels (public CDN URLs).

export const INTERESTS = [
  { id: "music", label: "Music", icon: "Music" },
  { id: "dj", label: "DJ Culture", icon: "Disc3" },
  { id: "psytrance", label: "Psytrance", icon: "Radio" },
  { id: "house", label: "House Music", icon: "Speaker" },
  { id: "festivals", label: "Festivals", icon: "PartyPopper" },
  { id: "gaming", label: "Gaming", icon: "Gamepad2" },
  { id: "sports", label: "Sports", icon: "Trophy" },
  { id: "crypto", label: "Crypto", icon: "Bitcoin" },
  { id: "tech", label: "Technology", icon: "Cpu" },
  { id: "business", label: "Business", icon: "Briefcase" },
  { id: "science", label: "Science", icon: "Atom" },
  { id: "travel", label: "Travel", icon: "Plane" },
  { id: "fashion", label: "Fashion", icon: "Shirt" },
  { id: "food", label: "Food", icon: "UtensilsCrossed" },
  { id: "fitness", label: "Fitness", icon: "Dumbbell" },
  { id: "news", label: "News", icon: "Newspaper" },
  { id: "education", label: "Education", icon: "GraduationCap" },
  { id: "art", label: "Art & Design", icon: "Palette" },
  { id: "film", label: "Film & TV", icon: "Film" },
  { id: "podcasts", label: "Podcasts", icon: "Mic" },
  { id: "photography", label: "Photography", icon: "Camera" },
  { id: "books", label: "Books", icon: "BookOpen" },
  { id: "anime", label: "Anime", icon: "Sparkles" },
  { id: "nature", label: "Nature", icon: "Leaf" },
  { id: "space", label: "Space", icon: "Rocket" },
  { id: "spirituality", label: "Spirituality", icon: "Sun" },
  { id: "comics", label: "Comics", icon: "BookMarked" },
  { id: "cars", label: "Cars", icon: "Car" },
];

const IMG = {
  cypher: "https://images.pexels.com/photos/28122495/pexels-photo-28122495.jpeg",
  business: "https://images.unsplash.com/photo-1763940018489-12e722c40bab",
  millennium: "https://images.unsplash.com/photo-1679269241012-f7640862d242",
  stealth: "https://images.unsplash.com/photo-1650043996692-a51e3d749766",
  avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb",
  music: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17",
};

const portraits = [
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200",
  "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=200",
  "https://images.unsplash.com/photo-1502685104226-ee32379fefbe?w=200",
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200",
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200",
  "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=200",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200",
  "https://images.unsplash.com/photo-1554151228-14d9def656e4?w=200",
];

const scenes = [
  "https://images.unsplash.com/photo-1518972559570-7cc1309f3229?w=900", // festival
  "https://images.unsplash.com/photo-1493676304819-0d7a8d026dcf?w=900", // dj booth
  "https://images.unsplash.com/photo-1483721310020-03333e577078?w=900", // city night
  "https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?w=900", // crypto
  "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=900", // gaming
  "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=900", // sports
  "https://images.unsplash.com/photo-1488972685288-c3fd157d7c7a?w=900", // business
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900", // travel
];

const handles = [
  "nova_riser", "kairo.bass", "luma_synth", "echo_drift", "axiom_one",
  "vela_dust", "neon_kit", "obsidian.fm", "polar_eve", "raven_orbit",
];

const captions = [
  "Mixed a new set under the city lights.",
  "Field recording from the festival mainstage — open in headphones.",
  "Studio progress: layering pads + 808 sub. Drop incoming.",
  "Sketches from the cabin trip. Realm pass = unlocked.",
  "Live from the rooftop — talk crypto with me.",
  "Tour dates dropped. Where should we go next?",
  "Quick thought: discover is broken everywhere else. Not here.",
  "New podcast episode on creator economy.",
  "Weekend lift PRs.",
  "Frame I caught at golden hour.",
];

export function makeMockPosts(count = 30) {
  const types = ["image", "video", "live", "sound", "post"];
  const posts = [];
  for (let i = 0; i < count; i++) {
    const t = types[i % types.length];
    posts.push({
      id: `mock-${i}`,
      author_id: `mockuser-${i % handles.length}`,
      author_name: handles[i % handles.length],
      author_avatar: portraits[i % portraits.length],
      content: captions[i % captions.length],
      media_type: t,
      media_url: t === "post" ? null : scenes[i % scenes.length],
      tags: [],
      likes: 80 + ((i * 37) % 4000),
      comments: 5 + ((i * 11) % 240),
      created_at: new Date(Date.now() - i * 3600 * 1000 * (1 + (i % 5))).toISOString(),
    });
  }
  return posts;
}

export const TRENDING_TRACKS = Array.from({ length: 12 }).map((_, i) => ({
  id: `tr-${i}`,
  title: ["Phase Shift", "Orbital Drift", "Pulse Garden", "Static Bloom", "Velvet Static",
          "Crystal Run", "After Hours", "Magnetic North", "Solstice", "Ghost Mode",
          "Hyperreal", "Nebulae"][i],
  artist: handles[i % handles.length],
  cover: IMG.music + `?sig=${i}`,
  duration: "3:" + (20 + (i % 30)).toString().padStart(2, "0"),
  genre: ["Psytrance", "House", "Techno", "Drum & Bass", "Ambient", "Hip-Hop", "Indie"][i % 7],
  distance_miles: 5 + ((i * 17) % 240),
  plays: 1200 + ((i * 113) % 80000),
}));

export const DISCOVER_ROWS = [
  { id: "trending", title: "Trending", icon: "Flame" },
  { id: "hot", title: "Hot", icon: "Zap" },
  { id: "favorites", title: "Favorites", icon: "Heart" },
  { id: "new", title: "New", icon: "Sparkles" },
  { id: "rising", title: "Up & Coming", icon: "Rocket" },
  { id: "music", title: "Music", icon: "Music" },
  { id: "videos", title: "Videos", icon: "PlayCircle" },
  { id: "lives", title: "Lives", icon: "Radio" },
  { id: "news", title: "News", icon: "Newspaper" },
  { id: "crypto", title: "Crypto", icon: "Bitcoin" },
  { id: "business", title: "Business", icon: "Briefcase" },
  { id: "gaming", title: "Gaming", icon: "Gamepad2" },
  { id: "sports", title: "Sports", icon: "Trophy" },
];

export const NOTIFICATIONS = [
  { id: 1, type: "like", actor: "nova_riser", target: "your post 'Phase Shift'", when: "2m" },
  { id: 2, type: "comment", actor: "kairo.bass", target: "your reel", when: "12m" },
  { id: 3, type: "follow", actor: "luma_synth", target: null, when: "1h" },
  { id: 4, type: "mention", actor: "echo_drift", target: "in a community post", when: "3h" },
  { id: 5, type: "message", actor: "axiom_one", target: "sent you a voice note", when: "5h" },
  { id: 6, type: "friend_request", actor: "vela_dust", target: null, when: "1d" },
  { id: 7, type: "share", actor: "neon_kit", target: "your live stream", when: "1d" },
];

export const FRIENDS = handles.slice(0, 8).map((h, i) => ({
  id: `friend-${i}`,
  handle: h,
  name: h.replace(/[._]/g, " "),
  avatar: portraits[i % portraits.length],
  is_online: i % 3 === 0,
  mutuals: 3 + ((i * 7) % 14),
}));

export const MESSAGES_THREADS = FRIENDS.slice(0, 6).map((f, i) => ({
  id: `thread-${i}`,
  friend: f,
  last: [
    "Coming to the launch?",
    "Sent the stems 🎚️",
    "Saw your widget — fire",
    "Where's the after?",
    "Reposted your set",
    "🔥🔥🔥",
  ][i],
  unread: i < 2 ? (i + 1) : 0,
  when: ["just now", "6m", "20m", "1h", "yesterday", "2d"][i],
  messages: [
    { from: "them", text: "Hey! Saw your latest drop. The arrangement around 2:14 is wild.", t: "10:24" },
    { from: "me", text: "Thanks 🙏 Iterated on that hook for like 3 days.", t: "10:26" },
    { from: "them", text: "Worth it. Got a sec to talk collab?", t: "10:28" },
    { from: "me", text: "Always. Tomorrow afternoon work?", t: "10:30" },
  ],
}));

export const WALLET = {
  balance: 14820.42,
  monthly_change_pct: 12.4,
  rows: [
    { id: "rewards", label: "Creator Rewards", amount: 6240.12 },
    { id: "shop", label: "Shop Commissions", amount: 2860.0 },
    { id: "royalties", label: "Royalties", amount: 3120.55 },
    { id: "earnings", label: "Earnings", amount: 1640.75 },
    { id: "ads", label: "Ad Revenue", amount: 959.0 },
  ],
  history: Array.from({ length: 12 }).map((_, i) => ({
    month: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i],
    rewards: 400 + ((i * 73) % 900),
    shop: 200 + ((i * 41) % 600),
    royalties: 300 + ((i * 53) % 700),
  })),
};

export const MARKETPLACE_ADS = Array.from({ length: 8 }).map((_, i) => ({
  id: `ad-${i}`,
  brand: ["LumenWave", "Orbital Audio", "Nullspace", "Tessera", "Veil Studio",
          "Pulse Co.", "Magnitude", "Northstar Labs"][i],
  payout: `$${(0.4 + i * 0.15).toFixed(2)} / view`,
  size: ["Small", "Medium", "Large", "Full Width"][i % 4],
  cover: scenes[i % scenes.length],
  category: ["Music", "Tech", "Fashion", "Crypto"][i % 4],
}));

export const WIDGET_TYPES = [
  { id: "live", label: "Live Stream", icon: "Radio", default_size: "large" },
  { id: "videos", label: "Videos", icon: "PlayCircle", default_size: "medium" },
  { id: "music", label: "Music", icon: "Music", default_size: "medium" },
  { id: "podcasts", label: "Podcasts", icon: "Mic", default_size: "medium" },
  { id: "photos", label: "Photos", icon: "Image", default_size: "medium" },
  { id: "events", label: "Events", icon: "Calendar", default_size: "small" },
  { id: "merch", label: "Merch", icon: "ShoppingBag", default_size: "full" },
  { id: "tour", label: "Tour Dates", icon: "MapPin", default_size: "medium" },
  { id: "friends", label: "Friends", icon: "Users", default_size: "small" },
  { id: "weather", label: "Weather", icon: "Cloud", default_size: "small" },
  { id: "news", label: "News", icon: "Newspaper", default_size: "medium" },
  { id: "crypto", label: "Crypto", icon: "Bitcoin", default_size: "small" },
  { id: "stocks", label: "Stocks", icon: "TrendingUp", default_size: "small" },
  { id: "notes", label: "Notes", icon: "StickyNote", default_size: "small" },
  { id: "polls", label: "Polls", icon: "BarChart3", default_size: "medium" },
  { id: "ads", label: "Marketplace Ads", icon: "Megaphone", default_size: "medium" },
  { id: "custom", label: "Custom", icon: "Sparkles", default_size: "small" },
];

export const DEFAULT_WIDGETS = [
  { id: "w1", type: "live", size: "large" },
  { id: "w2", type: "music", size: "medium" },
  { id: "w3", type: "photos", size: "medium" },
  { id: "w4", type: "friends", size: "small" },
  { id: "w5", type: "weather", size: "small" },
  { id: "w6", type: "events", size: "small" },
  { id: "w7", type: "tour", size: "medium" },
  { id: "w8", type: "merch", size: "full" },
];

export const MODE_PREVIEW_IMG = IMG;
