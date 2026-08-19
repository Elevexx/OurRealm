// REALMLIFE GRAPHICS QUALITY SYSTEM — AUTO / LOW / MEDIUM / HIGH / ULTRA.
import * as THREE from "three";

export const GRAPHICS_MODES = ["AUTO", "LOW", "MEDIUM", "HIGH", "ULTRA"];

// REALMLIFE ADAPTIVE DPR GOVERNOR
// Watches real framerate and gently lowers/raises the renderer
// pixel ratio between 0.75 and the active graphics-tier cap so
// mobile devices never crash or grind while PCs keep quality.
export function createAdaptiveDPR(renderer) {
  let cap = renderer.getPixelRatio() || 1;
  let frames = 0;
  let windowStart = 0;
  let lastAdjust = 0;

  function setCap(v) {
    cap = Math.max(0.75, v || 1);
    if (renderer.getPixelRatio() > cap) applyDPR(cap);
  }

  function applyDPR(v) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    renderer.setPixelRatio(v);
    renderer.setSize(size.x, size.y, false);
  }

  function tick(nowMs) {
    if (!windowStart) windowStart = nowMs;
    frames += 1;

    const span = nowMs - windowStart;
    if (span < 2000) return;

    const fps = (frames * 1000) / span;
    frames = 0;
    windowStart = nowMs;

    if (nowMs - lastAdjust < 3000) return;

    const current = renderer.getPixelRatio();

    if (fps < 34 && current > 0.75) {
      applyDPR(Math.max(0.75, current - 0.25));
      lastAdjust = nowMs;
    } else if (fps > 56 && current < cap) {
      applyDPR(Math.min(cap, current + 0.25));
      lastAdjust = nowMs;
    }
  }

  return { tick, setCap };
}

const TIER_ORDER = ["LOW", "MEDIUM", "HIGH", "ULTRA"];

const TIERS = {
  LOW: { pixelRatio: 1, shadows: false, shadowSize: 512, far: 300, exposure: 1.02 },
  MEDIUM: { pixelRatio: 1.25, shadows: true, shadowSize: 1024, far: 430, exposure: 1.05 },
  HIGH: { pixelRatio: 1.75, shadows: true, shadowSize: 2048, far: 580, exposure: 1.08 },
  ULTRA: { pixelRatio: 2, shadows: true, shadowSize: 4096, far: 760, exposure: 1.12 },
};

const STORAGE_KEY = "realmlife_graphics_mode";

function isCoarseDevice() {
  try {
    return (
      window.matchMedia?.("(pointer: coarse)")?.matches
      || window.innerWidth < 900
      || (navigator.hardwareConcurrency || 8) <= 4
    );
  } catch {
    return false;
  }
}

export function createRealmLifeGraphics({
  renderer,
  camera,
  shadowLights = [],
  onChange = null,
}) {
  const autoCap = isCoarseDevice() ? "MEDIUM" : "HIGH";
  const autoStart = isCoarseDevice() ? "LOW" : "MEDIUM";

  let mode = "AUTO";

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (GRAPHICS_MODES.includes(saved)) mode = saved;
  } catch {
    // storage unavailable — keep AUTO
  }

  let tier = null;
  let autoTier = autoStart;

  const sizeScratch = new THREE.Vector2();

  function notify() {
    onChange?.({ mode, tier });
  }

  function applyTier(name) {
    const t = TIERS[name];

    if (!t) return;

    if (name === tier) {
      notify();
      return;
    }

    tier = name;

    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, t.pixelRatio)
    );

    // re-apply size so the new pixel ratio takes effect immediately
    renderer.getSize(sizeScratch);
    renderer.setSize(sizeScratch.x, sizeScratch.y, false);

    renderer.toneMappingExposure = t.exposure;

    shadowLights.forEach((light) => {
      if (!light?.shadow) return;

      light.castShadow = t.shadows;

      if (t.shadows && light.shadow.mapSize.x !== t.shadowSize) {
        light.shadow.mapSize.set(t.shadowSize, t.shadowSize);

        if (light.shadow.map) {
          light.shadow.map.dispose();
          light.shadow.map = null;
        }
      }
    });

    camera.far = t.far;
    camera.updateProjectionMatrix();

    notify();
  }

  function setMode(next) {
    if (!GRAPHICS_MODES.includes(next)) return;

    mode = next;

    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }

    fpsFrames = 0;
    fpsStart = performance.now();

    applyTier(mode === "AUTO" ? autoTier : mode);
    notify();
  }

  // AUTO adaptive FPS tuning
  let fpsFrames = 0;
  let fpsStart = performance.now();

  function frame() {
    if (mode !== "AUTO") return;

    fpsFrames += 1;

    const now = performance.now();
    const elapsed = now - fpsStart;

    if (elapsed < 4000) return;

    const fps = (fpsFrames / elapsed) * 1000;

    fpsFrames = 0;
    fpsStart = now;

    const idx = TIER_ORDER.indexOf(autoTier);

    if (fps < 26 && idx > 0) {
      autoTier = TIER_ORDER[idx - 1];
      applyTier(autoTier);
    } else if (fps > 55 && idx < TIER_ORDER.indexOf(autoCap)) {
      autoTier = TIER_ORDER[idx + 1];
      applyTier(autoTier);
    }
  }

  setMode(mode);

  return {
    setMode,
    frame,
    getMode: () => mode,
    getTier: () => tier,
    getDrawDistance: () => (TIERS[tier]?.far || 430) * 0.95,
    modes: GRAPHICS_MODES,
  };
}
