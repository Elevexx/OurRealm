/**
 * OurRealm — Portals 1.0 registry.
 *
 * A frontend-only configuration that future phases can extend (or migrate to
 * a backend collection). Every portal declares its identity, route, supported
 * modes, overlay layers, creatures, ambient effects, and a performance
 * profile. The AR/VR pages render dynamically from this metadata.
 *
 * Phase 1.0 ships ONE playable realm — Rainforest. Add new entries below
 * with status='live' to expose them in the Portals Hub.
 */

export const PORTAL_STATUS = {
  LIVE:        "live",
  COMING_SOON: "coming_soon",
  BETA:        "beta",
};

export const PORTAL_MODE = {
  AR: "ar",
  VR: "vr",
};

/**
 * Overlay layer schema (used by PortalAR):
 *   { id, kind: 'gradient' | 'svg' | 'particles', position: 'top'|'bottom'|'edges'|'walls', config: {…} }
 *
 * Creature schema:
 *   { id, name, emoji?, svg?, animation, count, scaleRange, opacity, layer }
 */

export const PORTALS = [
  {
    portalId: "rainforest-ar",
    realmId: "rainforest",
    realmName: "Rainforest Realm",
    theme: {
      accent: "#22C55E",       // neon green
      glow: "#86EFAC",
      backdrop: "#031814",     // deep jungle dark
      mist: "rgba(134,239,172,0.18)",
    },
    route: "/realms/portals/ar",
    hubBlurb:
      "Transform your room into a living Amazon rainforest. Look around to watch the canopy breathe, the river flow, and creatures roam.",
    longDescription:
      "An immersive AR experience that overlays layered jungle holograms onto your live camera feed. Tilt your phone upward to peek through the canopy.",
    status: PORTAL_STATUS.LIVE,
    supportedModes: [PORTAL_MODE.AR],
    overlayLayers: [
      { id: "sky",     position: "top",    kind: "gradient" },
      { id: "canopy",  position: "top",    kind: "svg" },
      { id: "rays",    position: "all",    kind: "gradient" },
      { id: "vines",   position: "edges",  kind: "svg" },
      { id: "trees",   position: "walls",  kind: "svg" },
      { id: "ground",  position: "bottom", kind: "svg" },
      { id: "river",   position: "bottom", kind: "svg" },
      { id: "mist",    position: "all",    kind: "particles" },
    ],
    creatures: [
      { id: "caiman", name: "Caiman", emoji: "🐊", animation: "swim",   count: 1, scaleRange: [0.9, 1.1], layer: "river"  },
      { id: "jaguar", name: "Jaguar", emoji: "🐆", animation: "pace",   count: 1, scaleRange: [1.0, 1.2], layer: "ground" },
      { id: "macaw",  name: "Macaw",  emoji: "🦜", animation: "fly",    count: 3, scaleRange: [0.4, 1.0], layer: "sky"    },
      { id: "toucan", name: "Toucan", emoji: "🐦", animation: "fly",    count: 2, scaleRange: [0.5, 0.9], layer: "sky"    },
      { id: "monkey", name: "Monkey", emoji: "🐒", animation: "climb",  count: 2, scaleRange: [0.7, 1.0], layer: "trees"  },
      { id: "frog",   name: "Frog",   emoji: "🐸", animation: "hop",    count: 1, scaleRange: [0.7, 0.9], layer: "ground" },
    ],
    ambientEffects: {
      mist:       true,
      lightRays:  true,
      fireflies:  true,
      soundscape: false, // wired in a future phase
    },
    performanceProfile: {
      defaultMode: "balanced",   // balanced | low
      maxParticles: 24,
      respectsReducedMotion: true,
    },
    // Future hooks intentionally left as no-ops in Phase 1.0.
    futureHooks: {
      spatialMapping: false,
      webxr: false,
      unityBridge: false,
      multiplayer: false,
      persistence: false,
    },
  },
  {
    portalId: "rainforest-vr",
    realmId: "rainforest",
    realmName: "Rainforest Realm (VR)",
    theme: { accent: "#A78BFA", glow: "#C4B5FD", backdrop: "#0B0526", mist: "rgba(196,181,253,0.18)" },
    route: "/realms/portals/vr",
    hubBlurb:
      "Step inside the rainforest with a fully immersive VR experience. Coming soon.",
    longDescription:
      "Reserved for the WebXR / Unity bridge build of Portals. The Phase 1.0 page is a stub.",
    status: PORTAL_STATUS.COMING_SOON,
    supportedModes: [PORTAL_MODE.VR],
    overlayLayers: [],
    creatures: [],
    ambientEffects: {},
    performanceProfile: { defaultMode: "balanced" },
    futureHooks: { webxr: true, unityBridge: true, multiplayer: true },
  },
];

export function getPortalByRoute(route) {
  return PORTALS.find((p) => p.route === route) || null;
}
export function getPortalById(portalId) {
  return PORTALS.find((p) => p.portalId === portalId) || null;
}
export function listLivePortals() {
  return PORTALS.filter((p) => p.status === PORTAL_STATUS.LIVE);
}
export function listComingSoonPortals() {
  return PORTALS.filter((p) => p.status === PORTAL_STATUS.COMING_SOON);
}
