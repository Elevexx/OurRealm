// REALMLIFE SECTOR STREAMING — home/HUD load first, distant
// sectors stream in/out by distance vs graphics draw distance.
import * as THREE from "three";

export function createSectorStreaming() {
  const sectors = [];
  const box = new THREE.Box3();

  // REALMLIFE PERFORMANCE:
  // Keep large world sectors off the GPU until the lightweight
  // home/player frame has rendered successfully.
  let suspended = false;

  // After startup unlock, force even overlapping/inside sectors
  // to reveal gradually instead of all compiling on one frame.
  let startupStaggerUntil = 0;

  function addSector(name, object, { margin = 30 } = {}) {
    if (!object?.isObject3D) return null;

    object.updateWorldMatrix(true, false);
    box.setFromObject(object);

    if (box.isEmpty()) return null;

    const rec = {
      name,
      object,
      minX: box.min.x,
      maxX: box.max.x,
      minZ: box.min.z,
      maxZ: box.max.z,
      margin,
      visible: false,
    };

    object.visible = false;
    sectors.push(rec);

    return rec;
  }

  let lastReveal = 0;

  function update(pos, drawDistance, now = performance.now()) {
    if (suspended) return;

    const startupStagger =
      now < startupStaggerUntil;

    for (const s of sectors) {
      // distance from the player to the sector's bounding box (0 inside)
      const dx = Math.max(s.minX - pos.x, 0, pos.x - s.maxX);
      const dz = Math.max(s.minZ - pos.z, 0, pos.z - s.maxZ);
      const d = Math.hypot(dx, dz);

      const showAt = drawDistance + s.margin;

      if (!s.visible && d < showAt) {
        // player inside a sector reveals instantly; distant reveals
        // are staggered so texture uploads never hitch a frame burst.
        const canReveal =
          startupStagger
            ? now - lastReveal >= 140
            : (
                d < 0.001
                ||
                now - lastReveal >= 120
              );

        if (canReveal) {
          s.visible = true;
          s.object.visible = true;
          lastReveal = now;

          // During startup, reveal at most ONE heavy sector
          // per update cycle.
          if (startupStagger) {
            break;
          }
        }
      } else if (s.visible && d > showAt + 60) {
        s.visible = false;
        s.object.visible = false;
      }
    }
  }

  function suspend() {
    suspended = true;

    sectors.forEach((s) => {
      s.visible = false;
      s.object.visible = false;
    });
  }

  function resume({
    staggerMs = 1400,
  } = {}) {
    suspended = false;

    const now =
      performance.now();

    startupStaggerUntil =
      now + staggerMs;

    // Prevent the first unlocked update from revealing a
    // sector immediately.
    lastReveal = now;
  }

  function stats() {
    return sectors.map((s) => ({
      name: s.name,
      visible: s.visible,
    }));
  }

  return {
    addSector,
    update,
    stats,
    suspend,
    resume,
  };
}
