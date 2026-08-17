// REALMLIFE GUEST INTERIORS
// When a guest is authorized (server access-check) for another
// resident's home, the host's real furnished interior streams
// in at that lot — no empty shells. Interactions reuse proven
// action ids ("sit", "shower", "admire").
import * as THREE from "three";

export function buildGuestResidence({
  lotSeq,
  x,
  z,
  w,
  d,
  scene,
  colliders,
  register,
}) {
  const group = new THREE.Group();
  group.name = `RealmLifeGuestInterior-${lotSeq}`;
  scene.add(group);

  const s = Math.min(w / 18.6, d / 14.6, 1);
  const px = (lx) => x + lx * s;
  const pz = (lz) => z + lz * s;

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xf1e5cf,
    roughness: 0.9,
  });

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xc9a578,
    roughness: 0.85,
  });

  const guestColliders = [];
  const guestInteractives = [];

  const pushCollider = (c) => {
    const rec = { ...c, guestLot: lotSeq };
    colliders.push(rec);
    guestColliders.push(rec);
  };

  // Finished floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 1.2, d - 1.2),
    floorMat
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, 0.03, z);
  floor.receiveShadow = true;
  group.add(floor);

  // Interior partition wall with doorway (living | bedroom/bath)
  const wallH = 2.7;
  const partA = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, wallH, d * 0.34),
    wallMat
  );
  partA.position.set(px(-1.6), wallH / 2, pz(-3.4));
  group.add(partA);
  pushCollider({
    x: px(-1.6),
    z: pz(-3.4),
    hw: 0.4,
    hd: (d * 0.34) / 2 + 0.2,
  });

  const items = [
    {
      id: "bed",
      label: "Bed",
      lx: -5.1,
      lz: -4.2,
      size: [2.1, 0.75, 3.0],
      color: 0x9a4a5e,
      actions: [{ id: "sit", label: "Rest on Bed" }],
      approach: [1.6, 0],
    },
    {
      id: "shower",
      label: "Shower",
      lx: 6.2,
      lz: -4.6,
      size: [1.3, 2.3, 1.3],
      color: 0x7fd2c8,
      actions: [{ id: "shower", label: "Take Shower" }],
      approach: [-1.3, 0],
    },
    {
      id: "sofa",
      label: "Sofa",
      lx: 4.4,
      lz: 3.2,
      size: [2.6, 0.95, 1.15],
      color: 0x386179,
      actions: [{ id: "sit", label: "Sit & Relax" }],
      approach: [0, -1.4],
    },
    {
      id: "fridge",
      label: "Refrigerator",
      lx: -5.4,
      lz: 4.2,
      size: [1.1, 2.1, 1.0],
      color: 0xb9c4c9,
      actions: [{ id: "admire", label: "Peek Inside" }],
      approach: [0, -1.3],
    },
    {
      id: "stove",
      label: "Stove",
      lx: -3.6,
      lz: 4.2,
      size: [1.2, 1.05, 1.0],
      color: 0x4a4f55,
      actions: [{ id: "admire", label: "Admire Kitchen" }],
      approach: [0, -1.3],
    },
    {
      id: "tv",
      label: "TV",
      lx: 6.4,
      lz: 0.8,
      size: [0.4, 1.3, 2.2],
      color: 0x101418,
      actions: [{ id: "admire", label: "Check TV" }],
      approach: [-1.4, 0],
    },
  ];

  items.forEach((item) => {
    const obj = register({
      id: `guest${lotSeq}-${item.id}`,
      label: item.label,
      x: item.lx * s,
      z: item.lz * s,
      size: item.size,
      color: item.color,
      actions: item.actions,
      approach: item.approach,
      ox: x,
      oz: z,
    });
    if (obj) {
      obj.userData.guestLot = lotSeq;
      guestInteractives.push(obj);
    }
  });

  // Decor: rug + dining set + plant (visual only)
  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2 * s, 2.3 * s),
    new THREE.MeshStandardMaterial({ color: 0x8a4b5c, roughness: 0.95 })
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(px(4.4), 0.05, pz(1.4));
  group.add(rug);

  const tableM = new THREE.MeshStandardMaterial({
    color: 0x8a6a45,
    roughness: 0.6,
  });
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(1.8 * s, 0.85, 1.05 * s),
    tableM
  );
  table.position.set(px(-1.0), 0.43, pz(4.0));
  group.add(table);
  pushCollider({ x: px(-1.0), z: pz(4.0), hw: s, hd: 0.7 * s });

  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.33, 0.48, 7),
    new THREE.MeshStandardMaterial({ color: 0xa5593c, roughness: 0.8 })
  );
  pot.position.set(px(-7.2 * s > -w / 2 + 1 ? -7.2 : -w / 2 + 1), 0.24, pz(-5.4));
  const leaf = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.4, 0),
    new THREE.MeshStandardMaterial({ color: 0x3f8a4b, roughness: 0.9 })
  );
  leaf.position.set(pot.position.x, 0.82, pot.position.z);
  group.add(pot, leaf);

  return {
    lotSeq,
    group,
    dispose(interactiveList) {
      // remove colliders
      for (let i = colliders.length - 1; i >= 0; i -= 1) {
        if (colliders[i].guestLot === lotSeq) colliders.splice(i, 1);
      }
      // remove interactives
      guestInteractives.forEach((obj) => {
        obj.userData.guestRevoked = true;
        const idx = interactiveList?.indexOf(obj);
        if (idx >= 0) interactiveList.splice(idx, 1);
        obj.parent?.remove(obj);
      });
      scene.remove(group);
    },
  };
}
