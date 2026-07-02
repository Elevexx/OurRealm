/**
 * OurRealm — Portals 1.4 · Rainforest Template Configuration
 * -----------------------------------------------------------------
 * Reference configuration for the config-driven TemplateRealm. Serves
 * two purposes:
 *   1. Proves the template pattern — a Realm can be authored purely
 *      as data.
 *   2. Is the first ever Realm placeholder shipped through the
 *      template system (not the same as the hand-authored
 *      RainforestRealm which retains the full playable experience).
 *
 * Add a new Realm in the future by copying this file, editing the
 * config, and registering the new id in `registry.js`.
 */
export const rainforestTemplateConfig = {
  id: "rainforest-lite",
  metadata: {
    name:        "Rainforest (Template)",
    description: "Config-driven rainforest placeholder built via the reusable Realm template.",
    emoji:       "🌱",
  },

  // ── Lighting — warm daytime canopy filtering through leaves.
  lighting: {
    hemi: { skyColor: 0xd7f5c4, groundColor: 0x1f3a24, intensity: 0.95 },
    dir:  { color: 0xfff5c8, intensity: 0.85, position: [1.2, 3.5, 0.8] },
    ambient: { color: 0x264d34, intensity: 0.15 },
  },

  // ── Environment — mossy ground disc + tiny meandering river.
  environment: {
    ground: { color: 0x2f5d3a, radius: 0.9, roughness: 0.95 },
    river:  { color: 0x2b7bb9, width: 0.14, length: 1.6, position: [0.2, 0.001, 0] },
  },

  // ── Spawn + exit-portal locations (rendered as a glowing torus).
  spawn:  { position: [0, 0.05, 0.55], lookAt: [0, 0.4, -0.6] },
  portal: { position: [0, 0.4, -0.7],  color: 0x86efac, radius: 0.12 },

  // ── Firefly particle preset.
  particles: [
    {
      name:   "fireflies",
      count:  50,
      colour: 0xd7ff9d,
      size:   0.022,
      radius: 0.8,
      minY:   0.15,
      maxY:   0.9,
      speed:  0.4,
    },
  ],

  // ── Placeholder props laid out in a rough ring around the spawn.
  props: (() => {
    const arr = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      arr.push({
        kind: "tree",
        position: [Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75],
        rotationY: Math.random() * Math.PI * 2,
        canopyColour: [0x2f7a3a, 0x3d8f4a, 0x27692e][i % 3],
      });
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      arr.push({
        kind: "rock",
        position: [Math.cos(a) * 0.4, 0.02, Math.sin(a) * 0.4],
        size: 0.05 + Math.random() * 0.03,
      });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.15;
      arr.push({
        kind: "plant",
        position: [Math.cos(a) * 0.25, 0.02, Math.sin(a) * 0.25],
      });
    }
    return arr;
  })(),

  // Reserved hooks for future work (Portals 1.5+ / Portals 2.0).
  ambientAudio: { url: null, volume: 0.4 },   // wire in once R2 URL stable
  npcs:         [],
  wildlife:     [],
};

export default rainforestTemplateConfig;
