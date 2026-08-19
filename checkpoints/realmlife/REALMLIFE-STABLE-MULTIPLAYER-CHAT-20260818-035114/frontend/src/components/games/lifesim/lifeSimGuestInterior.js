// REALMLIFE GUEST INTERIORS — CANONICAL BLUEPRINT PARITY
// Authorized guests stream the host's REAL persisted blueprint:
// identical furniture, positions, rotations, colors, wall colors
// and floor finishes. No generic replacement interiors.
import * as THREE from "three";

import {
  createBlueprintLayer,
  builtLevelKeys,
  LEVEL_LABELS,
} from "./lifeSimFurniture";

const FLOOR_HEX = {
  light_wood: "#d6b98c",
  medium_wood: "#b08b5c",
  dark_wood: "#6f4e2f",
  warm_tile: "#c9a578",
  cool_tile: "#b8bfc2",
  stone: "#9c968c",
  light_neutral: "#ded8cc",
  dark_neutral: "#58534b",
};

export function buildGuestResidence({
  lotSeq,
  x,
  z,
  w,
  d,
  scene,
  colliders,
  interactive,
  objectMap,
  blueprint,
  levelAccess,
}) {
  const group = new THREE.Group();
  group.name = `RealmLifeGuestInterior-${lotSeq}`;
  scene.add(group);

  const s = Math.min(w / 18.6, d / 14.6, 1);
  let bp = blueprint || { furniture: [], wall_colors: {}, floor_finishes: {} };
  let currentLevel = "ground";
  let layer = null;

  const wallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(bp.wall_colors?.ground || "#f1e5cf"),
    roughness: 0.9,
  });

  const floorMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(
      FLOOR_HEX[bp.floor_finishes?.ground] || FLOOR_HEX.warm_tile
    ),
    roughness: 0.85,
  });

  // Finished floor (repainted per level/finish).
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 1.2, d - 1.2),
    floorMat
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, 0.03, z);
  floor.receiveShadow = true;
  group.add(floor);

  // Finished ceiling — front-face points DOWN so it reads as a
  // real ceiling from inside without blocking the top-down camera.
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 1.2, d - 1.2),
    new THREE.MeshStandardMaterial({ color: 0xf3ecdd, roughness: 0.95 })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(x, 2.92, z);
  ceiling.visible = false;
  group.add(ceiling);

  // Ground-floor partition wall with doorway (living | bed/bath).
  const wallH = 2.7;
  const partA = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, wallH, d * 0.34),
    wallMat
  );
  partA.position.set(x + -1.6 * s, wallH / 2, z + -3.4 * s);
  group.add(partA);
  const partCollider = {
    x: x + -1.6 * s,
    z: z + -3.4 * s,
    hw: 0.4,
    hd: (d * 0.34) / 2 + 0.2,
    guestLot: lotSeq,
  };
  colliders.push(partCollider);

  const accessibleLevels = () => {
    const built = builtLevelKeys(
      bp.levels_above || 1,
      bp.levels_below || 0
    );
    return built.filter((k) => levelAccess?.[k]);
  };

  // Interior warm light for non-ground levels.
  const levelLight = new THREE.PointLight(0xffe2b8, 0, 16, 2);
  levelLight.position.set(x, 2.5, z);
  group.add(levelLight);

  const applyFinishes = () => {
    wallMat.color.set(bp.wall_colors?.[currentLevel] || "#f1e5cf");
    floorMat.color.set(
      FLOOR_HEX[bp.floor_finishes?.[currentLevel]] || FLOOR_HEX.warm_tile
    );
  };

  let stairsObj = null;

  const registerStairs = () => {
    const levels = accessibleLevels();
    if (stairsObj) {
      const idx = interactive.indexOf(stairsObj);
      if (idx >= 0) interactive.splice(idx, 1);
      objectMap?.delete(stairsObj.userData.id);
      group.remove(stairsObj);
      stairsObj = null;
    }
    if (levels.length <= 1) return;

    const stairs = new THREE.Group();
    const stepMat = new THREE.MeshStandardMaterial({
      color: 0x8a6a45,
      roughness: 0.7,
    });
    for (let i = 0; i < 4; i += 1) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.22, 0.5),
        stepMat
      );
      step.position.set(0, 0.11 + i * 0.24, -i * 0.42);
      step.castShadow = true;
      stairs.add(step);
    }
    stairs.position.set(x + -7.4 * s, 0, z + 0.6 * s);

    stairs.userData.lifeObject = true;
    stairs.userData.id = `guest${lotSeq}-stairs`;
    stairs.userData.label = "Stairs";
    stairs.userData.approach = [1.2, 0];
    stairs.userData.guestLot = lotSeq;
    stairs.userData.actions = levels
      .filter((lv) => lv !== currentLevel)
      .map((lv) => ({
        id: `guestlevel:${lotSeq}:${lv}`,
        label: `Go to ${LEVEL_LABELS[lv] || lv}`,
      }));

    group.add(stairs);
    interactive.push(stairs);
    objectMap?.set(stairs.userData.id, stairs);
    stairsObj = stairs;
  };

  const buildLevel = () => {
    layer?.dispose();
    layer = createBlueprintLayer({
      scene,
      colliders,
      interactive,
      objectMap,
      originX: x,
      originZ: z,
      scale: s,
      blueprint: bp,
      level: currentLevel,
      guest: true,
      idPrefix: `guest${lotSeq}-`,
    });
    partA.visible = currentLevel === "ground";
    partCollider.hw = currentLevel === "ground" ? 0.4 : 0.001;
    partCollider.hd =
      currentLevel === "ground" ? (d * 0.34) / 2 + 0.2 : 0.001;
    ceiling.visible = currentLevel !== "ground";
    levelLight.intensity = currentLevel === "ground" ? 0 : 1.1;
    applyFinishes();
    registerStairs();
  };

  buildLevel();

  return {
    lotSeq,
    group,

    get currentLevel() {
      return currentLevel;
    },

    get version() {
      return bp.version || 1;
    },

    setLevel(level) {
      if (!levelAccess?.[level]) return false;
      currentLevel = level;
      buildLevel();
      return true;
    },

    updateBlueprint(nextBp, nextAccess) {
      bp = nextBp || bp;
      if (nextAccess) levelAccess = nextAccess;
      if (!levelAccess?.[currentLevel]) currentLevel = "ground";
      buildLevel();
    },

    dispose(interactiveList) {
      layer?.dispose();
      for (let i = colliders.length - 1; i >= 0; i -= 1) {
        if (colliders[i].guestLot === lotSeq) colliders.splice(i, 1);
      }
      if (stairsObj) {
        const list = interactiveList || interactive;
        const idx = list.indexOf(stairsObj);
        if (idx >= 0) list.splice(idx, 1);
        objectMap?.delete(stairsObj.userData.id);
      }
      scene.remove(group);
    },
  };
}
