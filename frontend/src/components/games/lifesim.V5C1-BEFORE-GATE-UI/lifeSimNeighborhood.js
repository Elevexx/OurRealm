import * as THREE from "three";
import { buildCityDistrict } from "./lifeSimCityDistrict";

function material(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.82,
    metalness: 0.02,
    ...extra,
  });
}

function box(group, {
  x = 0,
  y = null,
  z = 0,
  w = 1,
  h = 1,
  d = 1,
  color = 0xffffff,
  cast = true,
  receive = true,
  mat = null,
}) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    mat || material(color)
  );

  mesh.position.set(
    x,
    y ?? h / 2,
    z
  );

  mesh.castShadow = cast;
  mesh.receiveShadow = receive;

  group.add(mesh);

  return mesh;
}

function plane(group, {
  x = 0,
  y = 0,
  z = 0,
  w,
  d,
  color,
  transparent = false,
  opacity = 1,
}) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    material(color, {
      transparent,
      opacity,
      depthWrite: !transparent,
    })
  );

  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;

  group.add(mesh);

  return mesh;
}

function collider(
  colliders,
  x,
  z,
  w,
  d,
  padding = 0.22
) {
  colliders.push({
    x,
    z,
    hw: w / 2 + padding,
    hd: d / 2 + padding,
  });
}

function addTree(
  group,
  colliders,
  x,
  z,
  scale = 1
) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.18 * scale,
      0.25 * scale,
      2.2 * scale,
      10
    ),
    material(0x70452c)
  );

  trunk.position.set(
    x,
    1.1 * scale,
    z
  );

  trunk.castShadow = true;
  group.add(trunk);

  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(
      1.15 * scale,
      14,
      10
    ),
    material(0x3f8b4d)
  );

  crown.position.set(
    x,
    2.75 * scale,
    z
  );

  crown.castShadow = true;
  group.add(crown);

  collider(
    colliders,
    x,
    z,
    0.55 * scale,
    0.55 * scale,
    0.15
  );
}

function addStreetlight(
  group,
  colliders,
  x,
  z,
  rot = 0
) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.09,
      0.12,
      4.8,
      10
    ),
    material(0x343b42, {
      metalness: 0.55,
      roughness: 0.42,
    })
  );

  pole.position.set(x, 2.4, z);
  pole.castShadow = true;

  group.add(pole);

  const arm = box(group, {
    x: x + Math.cos(rot) * 0.48,
    y: 4.55,
    z: z + Math.sin(rot) * 0.48,
    w: 1,
    h: 0.09,
    d: 0.09,
    color: 0x343b42,
  });

  arm.rotation.y = -rot;

  const lamp = new THREE.PointLight(
    0xffd49a,
    0,
    8,
    2
  );

  lamp.position.set(
    x + Math.cos(rot) * 0.88,
    4.35,
    z + Math.sin(rot) * 0.88
  );

  lamp.userData.lifeStreetLight = true;

  group.add(lamp);

  collider(
    colliders,
    x,
    z,
    0.35,
    0.35,
    0.05
  );
}

function addHouseShell(
  group,
  colliders,
  {
    x,
    z,
    w = 12,
    d = 10,
    color = 0xe8dcc4,
    floorColor = 0xc4aa82,
    accent = 0x426d81,
    label = "Home",
  }
) {
  const house = new THREE.Group();
  house.position.set(x, 0, z);
  house.userData.buildingLabel = label;

  group.add(house);

  // Floor
  box(house, {
    w,
    h: 0.12,
    d,
    y: 0.02,
    color: floorColor,
    cast: false,
  });

  const wallH = 2.8;
  const wallT = 0.24;
  const halfW = w / 2;
  const halfD = d / 2;

  // Back wall
  box(house, {
    z: halfD,
    w,
    h: wallH,
    d: wallT,
    color,
  });

  collider(
    colliders,
    x,
    z + halfD,
    w,
    wallT
  );

  // Side walls
  box(house, {
    x: -halfW,
    w: wallT,
    h: wallH,
    d,
    color,
  });

  collider(
    colliders,
    x - halfW,
    z,
    wallT,
    d
  );

  box(house, {
    x: halfW,
    w: wallT,
    h: wallH,
    d,
    color,
  });

  collider(
    colliders,
    x + halfW,
    z,
    wallT,
    d
  );

  // Front wall with REAL doorway opening.
  const doorWidth = 2.0;
  const sidePiece =
    (w - doorWidth) / 2;

  box(house, {
    x: -(doorWidth / 2 + sidePiece / 2),
    z: -halfD,
    w: sidePiece,
    h: wallH,
    d: wallT,
    color,
  });

  collider(
    colliders,
    x - (doorWidth / 2 + sidePiece / 2),
    z - halfD,
    sidePiece,
    wallT
  );

  box(house, {
    x: doorWidth / 2 + sidePiece / 2,
    z: -halfD,
    w: sidePiece,
    h: wallH,
    d: wallT,
    color,
  });

  collider(
    colliders,
    x + (doorWidth / 2 + sidePiece / 2),
    z - halfD,
    sidePiece,
    wallT
  );

  // Door frame.
  box(house, {
    x: -doorWidth / 2,
    z: -halfD - 0.03,
    w: 0.12,
    h: 2.35,
    d: 0.18,
    color: accent,
  });

  box(house, {
    x: doorWidth / 2,
    z: -halfD - 0.03,
    w: 0.12,
    h: 2.35,
    d: 0.18,
    color: accent,
  });

  box(house, {
    y: 2.28,
    z: -halfD - 0.03,
    w: doorWidth + 0.12,
    h: 0.12,
    d: 0.18,
    color: accent,
  });

  // Interior partition with a doorway.
  const splitZ = 0.8;

  box(house, {
    x: -3.4,
    z: splitZ,
    w: 4.2,
    h: 2.35,
    d: 0.18,
    color,
  });

  collider(
    colliders,
    x - 3.4,
    z + splitZ,
    4.2,
    0.18
  );

  box(house, {
    x: 3.4,
    z: splitZ,
    w: 4.2,
    h: 2.35,
    d: 0.18,
    color,
  });

  collider(
    colliders,
    x + 3.4,
    z + splitZ,
    4.2,
    0.18
  );

  // Primitive interior furnishings for spatial proof.
  box(house, {
    x: -3.6,
    z: 2.6,
    w: 2.6,
    h: 0.65,
    d: 1.8,
    color: accent,
  });

  collider(
    colliders,
    x - 3.6,
    z + 2.6,
    2.6,
    1.8
  );

  box(house, {
    x: 2.8,
    z: 2.6,
    w: 2.8,
    h: 0.9,
    d: 1.1,
    color: 0x75513a,
  });

  collider(
    colliders,
    x + 2.8,
    z + 2.6,
    2.8,
    1.1
  );

  return house;
}

function addPark(
  group,
  colliders
) {
  plane(group, {
    x: 27,
    y: 0.016,
    z: -23,
    w: 25,
    d: 22,
    color: 0x6fae62,
  });

  // Walking path
  plane(group, {
    x: 27,
    y: 0.022,
    z: -23,
    w: 4,
    d: 20,
    color: 0xc9b997,
  });

  plane(group, {
    x: 27,
    y: 0.024,
    z: -23,
    w: 22,
    d: 3.2,
    color: 0xc9b997,
  });

  // Benches
  for (const [x, z] of [
    [22, -18],
    [32, -18],
    [22, -28],
    [32, -28],
  ]) {
    box(group, {
      x,
      y: 0.55,
      z,
      w: 2.2,
      h: 0.35,
      d: 0.65,
      color: 0x7d5738,
    });

    collider(
      colliders,
      x,
      z,
      2.2,
      0.65
    );
  }

  for (const [x, z, s] of [
    [18, -16, 1.05],
    [36, -16, 1.15],
    [18, -30, 1.2],
    [36, -30, 1.0],
    [31, -33, 0.9],
  ]) {
    addTree(
      group,
      colliders,
      x,
      z,
      s
    );
  }
}

export function buildNeighborhoodWorld(
  scene
) {
  const root = new THREE.Group();
  root.name = "RealmLifeNeighborhood";

  scene.add(root);

  const colliders = [];

  const bounds = {
    minX: -44,
    maxX: 44,
    minZ: -44,
    maxZ: 134,
  };

  const ownedLot = {
    minX: -10,
    maxX: 10,
    minZ: -9,
    maxZ: 16,
  };

  // ----------------------------------------------------------
  // WORLD CLICK SURFACE
  // Invisible plane allows seamless click-to-walk everywhere.
  // ----------------------------------------------------------

  const clickPlane =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        90,
        180
      ),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );

  clickPlane.rotation.x =
    -Math.PI / 2;

  clickPlane.position.set(
    0,
    -0.015,
    45
  );

  clickPlane.userData.ground = true;

  root.add(clickPlane);

  // ----------------------------------------------------------
  // BASE TERRAIN
  // ----------------------------------------------------------

  plane(root, {
    y: -0.04,
    w: 90,
    d: 90,
    color: 0x669a59,
  });

  // Home lot lawn.
  plane(root, {
    y: -0.012,
    w: 25,
    d: 31,
    z: 1,
    color: 0x78aa63,
  });

  // Front walkway.
  plane(root, {
    y: 0.012,
    x: 0,
    z: 11.2,
    w: 2.2,
    d: 8.4,
    color: 0xcabda7,
  });

  // Driveway.
  plane(root, {
    y: 0.014,
    x: 6.4,
    z: 11.5,
    w: 5.2,
    d: 9,
    color: 0x9b9b96,
  });

  // ----------------------------------------------------------
  // STREET
  // ----------------------------------------------------------

  plane(root, {
    y: 0.005,
    z: 22,
    w: 90,
    d: 11,
    color: 0x3e4348,
  });

  // Near sidewalk.
  plane(root, {
    y: 0.018,
    z: 15.7,
    w: 90,
    d: 2.2,
    color: 0xc2c1ba,
  });

  // Far sidewalk.
  plane(root, {
    y: 0.018,
    z: 28.3,
    w: 90,
    d: 2.2,
    color: 0xc2c1ba,
  });

  // Center line.
  for (
    let x = -42;
    x <= 42;
    x += 6
  ) {
    box(root, {
      x,
      y: 0.035,
      z: 22,
      w: 3.1,
      h: 0.025,
      d: 0.16,
      color: 0xe4c952,
      cast: false,
    });
  }

  // Crosswalk.
  for (
    let z = 17.5;
    z <= 26.5;
    z += 1.25
  ) {
    box(root, {
      x: -16,
      y: 0.038,
      z,
      w: 4.2,
      h: 0.025,
      d: 0.55,
      color: 0xe5e5df,
      cast: false,
    });
  }

  // ----------------------------------------------------------
  // STREET FURNITURE + TREES
  // ----------------------------------------------------------

  for (const x of [
    -36,
    -24,
    -10,
    12,
    25,
    38,
  ]) {
    addStreetlight(
      root,
      colliders,
      x,
      14.1,
      Math.PI / 2
    );

    addStreetlight(
      root,
      colliders,
      x + 4,
      29.9,
      -Math.PI / 2
    );
  }

  for (const [x, z, s] of [
    [-10, 11.8, 0.9],
    [10, 12.2, 1.0],
    [-18, 12, 1.1],
    [18, 12, 0.9],
    [-34, 32, 1.0],
    [-16, 32, 0.9],
    [16, 32, 1.1],
    [34, 32, 0.95],
  ]) {
    addTree(
      root,
      colliders,
      x,
      z,
      s
    );
  }

  // ----------------------------------------------------------
  // ENTERABLE NEIGHBOR HOMES
  // ----------------------------------------------------------

  addHouseShell(
    root,
    colliders,
    {
      x: -26,
      z: 37,
      w: 14,
      d: 12,
      color: 0xe8d4be,
      floorColor: 0xbfa27d,
      accent: 0x5c7995,
      label: "Maple House",
    }
  );

  addHouseShell(
    root,
    colliders,
    {
      x: 0,
      z: 37,
      w: 15,
      d: 12,
      color: 0xd7dfd0,
      floorColor: 0xb9aa87,
      accent: 0x55775d,
      label: "Garden House",
    }
  );

  addHouseShell(
    root,
    colliders,
    {
      x: 27,
      z: 37,
      w: 14,
      d: 12,
      color: 0xe0d1dd,
      floorColor: 0xc3aa98,
      accent: 0x765781,
      label: "Violet House",
    }
  );

  // ----------------------------------------------------------
  // PARK
  // ----------------------------------------------------------

  addPark(
    root,
    colliders
  );

  // ----------------------------------------------------------
  // MAIN STREET + DOWNTOWN + RIVERWALK
  // ----------------------------------------------------------

  buildCityDistrict(
    root,
    colliders
  );

  return {
    root,
    colliders,
    clickPlane,
    bounds,
    ownedLot,
  };
}
