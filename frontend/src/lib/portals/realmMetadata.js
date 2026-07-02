/**
 * OurRealm — Portals 1.2 · Rich Realm Metadata
 * -----------------------------------------------------------------
 * The authoritative catalogue of every Realm the platform knows about.
 * Only entries with `status: "released"` are visible to end-users. All
 * other statuses are visible only inside the Founder Portal Dev Hub
 * (`/admin/portals`).
 *
 * Metadata schema (open-ended — new fields can be appended without
 * breaking older callers because every field is optional except id,
 * name, status, and version).
 *
 *   id                — kebab-case slug (matches the registry key)
 *   name              — display name
 *   emoji             — quick-reference glyph for the Dev Hub cards
 *   description       — 1–2 sentence blurb
 *   longDescription   — paragraph for the Realm detail page
 *   thumbnail         — CSS gradient / URL used by the Dev Hub card art
 *   accent            — primary neon colour driving the card / UI
 *   secondary         — supporting colour for the gradient
 *   supportedPlatforms— array: 'ar' | 'vr' | 'phone' | 'tablet' | 'desktop'
 *   requiredCapabilities — array of required device features
 *   version           — semver-ish string
 *   status            — see REALM_STATUS below
 *   lastUpdated       — ISO date string
 *   notes             — internal notes / TODOs (dev-hub only)
 *   audioProfile      — 'ambient' | 'action' | 'silent' | 'exploration'
 *   lightingProfile   — 'daytime' | 'dusk' | 'night' | 'underwater' | 'neon' | …
 *   weatherProfile    — 'clear' | 'rain' | 'snow' | 'storm' | 'volcanic' | 'sandstorm' | 'none'
 *   performanceLevel  — 'low' | 'medium' | 'high' — target device tier
 *   estimatedFps      — string hint shown in the dev hub
 *   tags              — free-form array
 */

export const REALM_STATUS = {
  DRAFT:            "draft",
  INTERNAL_TESTING: "internal_testing",
  FOUNDER_PREVIEW:  "founder_preview",
  PRIVATE_BETA:     "private_beta",
  PUBLIC_BETA:      "public_beta",
  RELEASED:         "released",
  DISABLED:         "disabled",
};

// Realms with these statuses are exposed to normal users. Everything
// else is Founder-only. Portals 1.2 ships with NO released realms;
// the public sees the Opening Soon hub.
export const PUBLIC_STATUSES = new Set([REALM_STATUS.RELEASED]);

export const PLATFORMS = ["ar", "vr", "phone", "tablet", "desktop"];

/** Human-readable label for each status — for the Dev Hub badges. */
export const REALM_STATUS_LABEL = {
  [REALM_STATUS.DRAFT]:            "Draft",
  [REALM_STATUS.INTERNAL_TESTING]: "Internal Testing",
  [REALM_STATUS.FOUNDER_PREVIEW]:  "Founder Preview",
  [REALM_STATUS.PRIVATE_BETA]:     "Private Beta",
  [REALM_STATUS.PUBLIC_BETA]:      "Public Beta",
  [REALM_STATUS.RELEASED]:         "Released",
  [REALM_STATUS.DISABLED]:         "Disabled",
};

export const REALM_STATUS_COLOR = {
  [REALM_STATUS.DRAFT]:            "#6b7280",
  [REALM_STATUS.INTERNAL_TESTING]: "#f59e0b",
  [REALM_STATUS.FOUNDER_PREVIEW]:  "#86efac",
  [REALM_STATUS.PRIVATE_BETA]:     "#c4b5fd",
  [REALM_STATUS.PUBLIC_BETA]:      "#60a5fa",
  [REALM_STATUS.RELEASED]:         "#22c55e",
  [REALM_STATUS.DISABLED]:         "#ef4444",
};

/**
 * REALM_METADATA — the authoritative list. When you build a real
 * gameplay class (extends Realm), also register it in
 * /lib/portals/registry.js. Metadata alone is enough to show the
 * realm in the Dev Hub with placeholder gameplay.
 */
export const REALM_METADATA = [
  {
    id: "rainforest",
    name: "Rainforest",
    emoji: "🌴",
    description: "Amazon canopy realm with fireflies, parrots and mossy forest floor.",
    longDescription:
      "The flagship Portal experience. Twelve procedural trees, an InstancedMesh grass system, an additive-blend firefly cloud and three circling parrots plant a jungle wherever the user taps.",
    thumbnail: "linear-gradient(135deg, #052e1e 0%, #14532d 50%, #22c55e 100%)",
    accent: "#22c55e",
    secondary: "#86efac",
    supportedPlatforms: ["ar", "phone", "tablet"],
    requiredCapabilities: ["webxr:immersive-ar", "webxr:hit-test", "camera"],
    version: "1.1.0",
    status: REALM_STATUS.FOUNDER_PREVIEW,
    lastUpdated: "2026-02-07",
    notes: "Portals 1.1 · Real WebXR AR. Registered gameplay class present. Preview overlay works on iOS via camera passthrough.",
    audioProfile: "ambient",
    lightingProfile: "daytime",
    weatherProfile: "clear",
    performanceLevel: "medium",
    estimatedFps: "45–60fps on modern Android",
    tags: ["nature", "flagship", "portals-1.1"],
    hasGameplay: true,
  },
  {
    id: "aquarium",
    name: "Aquarium",
    emoji: "🌊",
    description: "Coral reef with schools of fish, kelp columns and shafts of caustic light.",
    longDescription:
      "Portal transforms the room into an underwater biome. Bubbles rise, fish schools navigate around the viewer, and a soft blue caustics layer shimmers on every surface.",
    thumbnail: "linear-gradient(135deg, #082f49 0%, #0284c7 50%, #22d3ee 100%)",
    accent: "#06b6d4",
    secondary: "#67e8f9",
    supportedPlatforms: ["ar", "vr", "phone", "tablet"],
    requiredCapabilities: ["webxr:immersive-ar", "webxr:hit-test"],
    version: "0.1.0",
    status: REALM_STATUS.DRAFT,
    lastUpdated: "2026-02-07",
    notes: "Awaiting fish flocking system + caustics shader.",
    audioProfile: "ambient",
    lightingProfile: "underwater",
    weatherProfile: "none",
    performanceLevel: "medium",
    estimatedFps: "target 45fps",
    tags: ["nature", "water"],
    hasGameplay: false,
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    emoji: "🌆",
    description: "Neon-drenched megacity block with holo billboards and rain-slick asphalt.",
    longDescription:
      "Portal materialises a slice of Neo-Kowloon over the user's room. Volumetric fog, floating drones and animated ad boards create a dense, layered scene at night.",
    thumbnail: "linear-gradient(135deg, #1a032c 0%, #7c3aed 50%, #ec4899 100%)",
    accent: "#a855f7",
    secondary: "#f472b6",
    supportedPlatforms: ["ar", "vr", "desktop"],
    requiredCapabilities: ["webxr:immersive-ar"],
    version: "0.1.0",
    status: REALM_STATUS.DRAFT,
    lastUpdated: "2026-02-07",
    notes: "Design pass required — needs building card + neon shader library.",
    audioProfile: "ambient",
    lightingProfile: "neon",
    weatherProfile: "rain",
    performanceLevel: "high",
    estimatedFps: "target 40fps",
    tags: ["urban", "sci-fi"],
    hasGameplay: false,
  },
  {
    id: "snow",
    name: "Snow",
    emoji: "❄",
    description: "Arctic tundra with pine forests, snowfall and gentle aurora overhead.",
    thumbnail: "linear-gradient(135deg, #0c4a6e 0%, #93c5fd 50%, #ffffff 100%)",
    accent: "#93c5fd",
    secondary: "#e0f2fe",
    supportedPlatforms: ["ar", "phone", "tablet"],
    version: "0.1.0",
    status: REALM_STATUS.DRAFT,
    lastUpdated: "2026-02-07",
    audioProfile: "ambient",
    lightingProfile: "daytime",
    weatherProfile: "snow",
    performanceLevel: "low",
    tags: ["winter", "nature"],
    hasGameplay: false,
  },
  {
    id: "desert",
    name: "Desert",
    emoji: "🏜",
    description: "Sunbaked dunes with palm oases, camels and swirling sandstorms.",
    thumbnail: "linear-gradient(135deg, #78350f 0%, #f59e0b 50%, #fde68a 100%)",
    accent: "#f59e0b",
    secondary: "#fde68a",
    supportedPlatforms: ["ar", "phone", "tablet", "desktop"],
    version: "0.1.0",
    status: REALM_STATUS.DRAFT,
    lastUpdated: "2026-02-07",
    audioProfile: "exploration",
    lightingProfile: "daytime",
    weatherProfile: "sandstorm",
    performanceLevel: "medium",
    tags: ["arid", "nature"],
    hasGameplay: false,
  },
  {
    id: "volcano",
    name: "Volcano",
    emoji: "🌋",
    description: "Basalt slopes, glowing lava rivers and drifting ash on hot updrafts.",
    thumbnail: "linear-gradient(135deg, #450a0a 0%, #ea580c 50%, #fbbf24 100%)",
    accent: "#ea580c",
    secondary: "#fbbf24",
    supportedPlatforms: ["ar", "vr"],
    version: "0.1.0",
    status: REALM_STATUS.DRAFT,
    lastUpdated: "2026-02-07",
    audioProfile: "action",
    lightingProfile: "dusk",
    weatherProfile: "volcanic",
    performanceLevel: "high",
    tags: ["extreme", "nature"],
    hasGameplay: false,
  },
  {
    id: "space",
    name: "Space",
    emoji: "🌌",
    description: "Zero-g nebula field with orbiting satellites and distant pulsing stars.",
    thumbnail: "linear-gradient(135deg, #030712 0%, #1e1b4b 50%, #7c3aed 100%)",
    accent: "#818cf8",
    secondary: "#c4b5fd",
    supportedPlatforms: ["ar", "vr", "desktop"],
    version: "0.1.0",
    status: REALM_STATUS.DRAFT,
    lastUpdated: "2026-02-07",
    audioProfile: "ambient",
    lightingProfile: "night",
    weatherProfile: "none",
    performanceLevel: "medium",
    tags: ["sci-fi", "exploration"],
    hasGameplay: false,
  },
  {
    id: "fantasy",
    name: "Fantasy",
    emoji: "🏰",
    description: "Enchanted glade with floating runes, ancient trees and a wisp trail.",
    thumbnail: "linear-gradient(135deg, #1e1b4b 0%, #6d28d9 50%, #f0abfc 100%)",
    accent: "#a855f7",
    secondary: "#f0abfc",
    supportedPlatforms: ["ar", "vr"],
    version: "0.1.0",
    status: REALM_STATUS.DRAFT,
    lastUpdated: "2026-02-07",
    audioProfile: "exploration",
    lightingProfile: "dusk",
    weatherProfile: "clear",
    performanceLevel: "medium",
    tags: ["magic", "narrative"],
    hasGameplay: false,
  },
  {
    id: "jurassic",
    name: "Jurassic",
    emoji: "🦕",
    description: "Prehistoric plains with towering ferns and roaming dinosaurs.",
    thumbnail: "linear-gradient(135deg, #14532d 0%, #65a30d 50%, #fef08a 100%)",
    accent: "#65a30d",
    secondary: "#fef08a",
    supportedPlatforms: ["ar", "vr", "tablet", "desktop"],
    version: "0.1.0",
    status: REALM_STATUS.DRAFT,
    lastUpdated: "2026-02-07",
    audioProfile: "action",
    lightingProfile: "daytime",
    weatherProfile: "clear",
    performanceLevel: "high",
    tags: ["nature", "adventure"],
    hasGameplay: false,
  },
  {
    id: "ancient-ruins",
    name: "Ancient Ruins",
    emoji: "🏛",
    description: "Overgrown temple courtyards with drifting motes of golden light.",
    thumbnail: "linear-gradient(135deg, #422006 0%, #a16207 50%, #fef3c7 100%)",
    accent: "#a16207",
    secondary: "#fef3c7",
    supportedPlatforms: ["ar", "vr", "desktop"],
    version: "0.1.0",
    status: REALM_STATUS.DRAFT,
    lastUpdated: "2026-02-07",
    audioProfile: "exploration",
    lightingProfile: "dusk",
    weatherProfile: "clear",
    performanceLevel: "medium",
    tags: ["history", "narrative"],
    hasGameplay: false,
  },
  {
    id: "tropical-island",
    name: "Tropical Island",
    emoji: "🏝",
    description: "Palm-fringed lagoon, warm sand and gentle surf under a soft sunset.",
    thumbnail: "linear-gradient(135deg, #0e7490 0%, #22d3ee 50%, #fed7aa 100%)",
    accent: "#22d3ee",
    secondary: "#fed7aa",
    supportedPlatforms: ["ar", "phone", "tablet"],
    version: "0.1.0",
    status: REALM_STATUS.DRAFT,
    lastUpdated: "2026-02-07",
    audioProfile: "ambient",
    lightingProfile: "dusk",
    weatherProfile: "clear",
    performanceLevel: "low",
    tags: ["beach", "chill"],
    hasGameplay: false,
  },
  {
    id: "moon-colony",
    name: "Moon Colony",
    emoji: "🌙",
    description: "Low-g lunar base with sealed domes, Earth-rise and dust plumes.",
    thumbnail: "linear-gradient(135deg, #111827 0%, #4b5563 50%, #d1d5db 100%)",
    accent: "#94a3b8",
    secondary: "#e5e7eb",
    supportedPlatforms: ["vr", "desktop"],
    version: "0.1.0",
    status: REALM_STATUS.DRAFT,
    lastUpdated: "2026-02-07",
    audioProfile: "ambient",
    lightingProfile: "night",
    weatherProfile: "none",
    performanceLevel: "medium",
    tags: ["sci-fi", "colonization"],
    hasGameplay: false,
  },
];

// ─────────────────────────────────────────────────────────────────
// Query helpers — used by both the public Portal Selector (future)
// and the founder-only Dev Hub. All are pure.
// ─────────────────────────────────────────────────────────────────
export function listAllRealms() {
  return REALM_METADATA.slice();
}
export function listPublicRealms() {
  return REALM_METADATA.filter((r) => PUBLIC_STATUSES.has(r.status));
}
export function listFounderRealms() {
  // The founder sees every realm regardless of status.
  return REALM_METADATA.slice();
}
export function getRealmMeta(id) {
  return REALM_METADATA.find((r) => r.id === id) || null;
}
export function isRealmPublic(id) {
  const r = getRealmMeta(id);
  return !!r && PUBLIC_STATUSES.has(r.status);
}
