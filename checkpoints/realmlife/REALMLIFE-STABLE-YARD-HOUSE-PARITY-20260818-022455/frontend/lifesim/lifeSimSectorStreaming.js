// REALMLIFE SECTOR STREAMING — home/HUD load first, distant
// sectors stream in/out by distance vs graphics draw distance.
import * as THREE from "three";

export function createSectorStreaming() {
  const sectors = [];
  const box = new THREE.Box3();

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
    for (const s of sectors) {
      // distance from the player to the sector's bounding box (0 inside)
      const dx = Math.max(s.minX - pos.x, 0, pos.x - s.maxX);
      const dz = Math.max(s.minZ - pos.z, 0, pos.z - s.maxZ);
      const d = Math.hypot(dx, dz);

      const showAt = drawDistance + s.margin;

      if (!s.visible && d < showAt) {
        // player inside a sector reveals instantly; distant reveals
        // are staggered so texture uploads never hitch a frame burst.
        if (d < 0.001 || now - lastReveal >= 120) {
          s.visible = true;
          s.object.visible = true;
          lastReveal = now;
        }
      } else if (s.visible && d > showAt + 60) {
        s.visible = false;
        s.object.visible = false;
      }
    }
  }

  function stats() {
    return sectors.map((s) => ({
      name: s.name,
      visible: s.visible,
    }));
  }

  return { addSector, update, stats };
}
