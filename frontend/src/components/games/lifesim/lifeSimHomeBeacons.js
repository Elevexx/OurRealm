// REALMLIFE ORIGINAL HOME BEACONS
// Original OurRealm navigation element: thin vertical energy
// beam + floating geometric home marker above each resident's
// primary home. Own home = brighter; neighbors = subtle.
import * as THREE from "three";

const COLS = [-130, -104, -78, -52, -26, 0, 27, 53, 79, 105];
const ROWS = [37, 63, 89, 115, 141, 205, 231, 257, 283, 309];

export function realmLotPosition(seq) {
  const s = Math.max(1, Math.min(100, Number(seq) || 1));
  return {
    x: COLS[(s - 1) % 10],
    z: ROWS[Math.floor((s - 1) / 10)],
  };
}

const BEAM_GEO = new THREE.CylinderGeometry(0.14, 0.22, 30, 6, 1, true);
const MARKER_GEO = new THREE.OctahedronGeometry(0.9, 0);

const OWN_BEAM_MAT = new THREE.MeshBasicMaterial({
  color: 0x7dfcff,
  transparent: true,
  opacity: 0.55,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const OTHER_BEAM_MAT = new THREE.MeshBasicMaterial({
  color: 0x2ee6ff,
  transparent: true,
  opacity: 0.16,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const OWN_MARKER_MAT = new THREE.MeshBasicMaterial({
  color: 0xbdfeff,
  transparent: true,
  opacity: 0.95,
});

const OTHER_MARKER_MAT = new THREE.MeshBasicMaterial({
  color: 0x2ee6ff,
  transparent: true,
  opacity: 0.42,
});

export function createHomeBeacons(scene) {
  const group = new THREE.Group();
  group.name = "RealmLifeHomeBeacons";
  scene.add(group);

  let beacons = [];

  function clear() {
    beacons.forEach((b) => group.remove(b.root));
    beacons = [];
  }

  function setBeacons(list) {
    clear();

    (list || []).forEach((item) => {
      if (!item?.active && !item?.is_self) return;

      const { x, z } = realmLotPosition(item.lot_seq);
      const own = !!item.is_self;

      const root = new THREE.Group();
      root.position.set(x, 0, z);

      const beam = new THREE.Mesh(
        BEAM_GEO,
        own ? OWN_BEAM_MAT : OTHER_BEAM_MAT
      );
      beam.position.y = 19;
      root.add(beam);

      const marker = new THREE.Mesh(
        MARKER_GEO,
        own ? OWN_MARKER_MAT : OTHER_MARKER_MAT
      );
      marker.position.y = 35;
      if (own) marker.scale.setScalar(1.35);
      root.add(marker);

      group.add(root);
      beacons.push({ root, marker, own, baseY: 35 });
    });
  }

  function update(elapsed, playerX, playerZ) {
    for (const b of beacons) {
      const dx = b.root.position.x - playerX;
      const dz = b.root.position.z - playerZ;
      const d2 = dx * dx + dz * dz;

      // distance cull — own beacon stays visible farther out
      const maxD = b.own ? 640 : 380;
      const visible = d2 < maxD * maxD;
      if (b.root.visible !== visible) b.root.visible = visible;
      if (!visible) continue;

      // near LOD: only animate markers reasonably close
      if (d2 < 220 * 220) {
        b.marker.rotation.y = elapsed * (b.own ? 1.2 : 0.6);
        b.marker.position.y =
          b.baseY + Math.sin(elapsed * 1.6) * (b.own ? 0.8 : 0.4);
      }
    }
  }

  function dispose() {
    clear();
    scene.remove(group);
  }

  return { setBeacons, update, dispose, group };
}
