import { buildRealmLifeCommunityCore } from "./lifeSimCommunityCore";
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

  // ==========================================================
  // REALMLIFE V5G1B1 — SPANISH / PALM LANDSCAPING
  // ==========================================================

  const palm =
    new THREE.Group();

  palm.position.set(
    x,
    0,
    z
  );


  const trunkMaterial =
    material(
      0x8a5a36,
      {
        roughness: 0.86,
      }
    );


  const trunk =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.15 * scale,
        0.28 * scale,
        3.6 * scale,
        12
      ),
      trunkMaterial
    );


  trunk.position.y =
    1.8 * scale;

  trunk.rotation.z =
    0.025;

  trunk.castShadow =
    true;

  trunk.receiveShadow =
    true;

  palm.add(
    trunk
  );


  /*
   * Segmented trunk rings.
   */

  for (
    let i = 0;
    i < 7;
    i += 1
  ) {

    const ring =
      new THREE.Mesh(
        new THREE.TorusGeometry(
          (0.18 +
            i * 0.006) *
            scale,
          0.025 * scale,
          6,
          14
        ),
        material(
          0x704229,
          {
            roughness: 0.9,
          }
        )
      );


    ring.rotation.x =
      Math.PI / 2;

    ring.position.y =
      (0.50 +
        i * 0.45) *
      scale;

    palm.add(
      ring
    );
  }


  const leafMaterial =
    material(
      0x2e7844,
      {
        roughness: 0.72,
      }
    );


  const leafLightMaterial =
    material(
      0x438f50,
      {
        roughness: 0.70,
      }
    );


  for (
    let i = 0;
    i < 10;
    i += 1
  ) {

    const angle =
      (i / 10) *
      Math.PI *
      2;


    const leaf =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.18 * scale,
          0.055 * scale,
          2.15 * scale
        ),
        i % 2
          ? leafMaterial
          : leafLightMaterial
      );


    leaf.position.set(
      Math.sin(angle) *
        0.78 *
        scale,

      3.62 * scale
        - (i % 3) *
          0.05 *
          scale,

      Math.cos(angle) *
        0.78 *
        scale
    );


    leaf.rotation.set(
      -0.18
        - (i % 2) *
          0.12,

      angle,

      0
    );


    leaf.castShadow =
      true;

    palm.add(
      leaf
    );
  }


  /*
   * Short upper fronds give the crown more volume.
   */

  for (
    let i = 0;
    i < 5;
    i += 1
  ) {

    const angle =
      (i / 5) *
      Math.PI *
      2;


    const leaf =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.15 * scale,
          0.05 * scale,
          1.25 * scale
        ),
        leafLightMaterial
      );


    leaf.position.set(
      Math.sin(angle) *
        0.35 *
        scale,

      3.83 * scale,

      Math.cos(angle) *
        0.35 *
        scale
    );


    leaf.rotation.set(
      0.10,
      angle,
      0
    );


    leaf.castShadow =
      true;

    palm.add(
      leaf
    );
  }


  const coconutMaterial =
    material(
      0x60402a,
      {
        roughness: 0.90,
      }
    );


  for (
    let i = 0;
    i < 3;
    i += 1
  ) {

    const angle =
      (i / 3) *
      Math.PI *
      2;


    const coconut =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.12 * scale,
          10,
          8
        ),
        coconutMaterial
      );


    coconut.position.set(
      Math.cos(angle) *
        0.18 *
        scale,

      3.48 * scale,

      Math.sin(angle) *
        0.18 *
        scale
    );


    coconut.castShadow =
      true;

    palm.add(
      coconut
    );
  }


  group.add(
    palm
  );


  collider(
    colliders,
    x,
    z,
    0.58 * scale,
    0.58 * scale,
    0.15
  );


  return palm;
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


// ============================================================
// REALMLIFE FULL HOUSE PRIVACY V5G1B2
//
// Residential exteriors are COMPLETE from the public world.
//
// Own residence:
//   FULL     = roof + complete exterior visible
//   CUTAWAY  = privacy shell hidden for interior gameplay
//
// Other residential houses:
//   remain FULL while private.
// ============================================================

function createSpanishResidentialPrivacyShell({
  x = 0,
  z = 0,
  w = 16,
  d = 13,
  label = "Residence",
  own = false,
  levelsAbove = 1,
  levelsBelow = 0,
}) {

  const house =
    new THREE.Group();

  house.name =
    `RealmLife Full House · ${label}`;

  house.position.set(
    x,
    0,
    z
  );


  const stucco =
    new THREE.MeshStandardMaterial({
      color: 0xd8b98e,
      roughness: 0.88,
      metalness: 0.01,
    });


  const stuccoLight =
    new THREE.MeshStandardMaterial({
      color: 0xead5b3,
      roughness: 0.88,
      metalness: 0.01,
    });


  const terracotta =
    new THREE.MeshStandardMaterial({
      color: 0xa94f2f,
      roughness: 0.82,
      metalness: 0.01,
    });


  const terracottaDark =
    new THREE.MeshStandardMaterial({
      color: 0x74311f,
      roughness: 0.86,
    });


  const darkWood =
    new THREE.MeshStandardMaterial({
      color: 0x3a2015,
      roughness: 0.72,
      metalness: 0.02,
    });


  const trim =
    new THREE.MeshStandardMaterial({
      color: 0xf1ddba,
      roughness: 0.82,
    });


  const glass =
    new THREE.MeshStandardMaterial({
      color: 0x315e70,
      emissive: 0x0b2935,
      emissiveIntensity: 0.18,
      roughness: 0.18,
      metalness: 0.12,
    });


  const addBox = ({
    px = 0,
    py = 0,
    pz = 0,
    bw = 1,
    bh = 1,
    bd = 1,
    material = stucco,
  }) => {

    const mesh =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          bw,
          bh,
          bd
        ),
        material
      );

    mesh.position.set(
      px,
      py,
      pz
    );

    mesh.castShadow =
      true;

    mesh.receiveShadow =
      true;

    house.add(mesh);

    return mesh;
  };


  // REALMLIFE 3 STORY GOLDEN HOUSE V1

  const storyHeight =
    3.25;

  const levelCount =
    Math.max(
      1,
      Math.min(
        3,
        Math.round(
          Number(levelsAbove) || 1
        )
      )
    );

  const basementCount =
    Math.max(
      0,
      Math.min(
        3,
        Math.round(
          Number(levelsBelow) || 0
        )
      )
    );

  const wallHeight =
    storyHeight *
    levelCount;


  const wallThickness =
    0.24;


  // ----------------------------------------------------------
  // BACK WALL
  // ----------------------------------------------------------

  addBox({
    py:
      wallHeight / 2,

    pz:
      -d / 2,

    bw:
      w,

    bh:
      wallHeight,

    bd:
      wallThickness,
  });


  // ----------------------------------------------------------
  // SIDE WALLS
  // ----------------------------------------------------------

  addBox({
    px:
      -w / 2,

    py:
      wallHeight / 2,

    bw:
      wallThickness,

    bh:
      wallHeight,

    bd:
      d,
  });


  addBox({
    px:
      w / 2,

    py:
      wallHeight / 2,

    bw:
      wallThickness,

    bh:
      wallHeight,

    bd:
      d,
  });


  // ----------------------------------------------------------
  // FRONT FACADE
  //
  // Built in sections so the entry has architectural depth.
  // ----------------------------------------------------------

  const doorWidth =
    1.65;


  const sideWidth =
    (w - doorWidth) /
    2;


  addBox({
    px:
      -(
        doorWidth / 2
        +
        sideWidth / 2
      ),

    py:
      wallHeight / 2,

    pz:
      d / 2,

    bw:
      sideWidth,

    bh:
      wallHeight,

    bd:
      wallThickness,
  });


  addBox({
    px:
      (
        doorWidth / 2
        +
        sideWidth / 2
      ),

    py:
      wallHeight / 2,

    pz:
      d / 2,

    bw:
      sideWidth,

    bh:
      wallHeight,

    bd:
      wallThickness,
  });


  addBox({
    py:
      2.85,

    pz:
      d / 2,

    bw:
      doorWidth,

    bh:
      0.8,

    bd:
      wallThickness,
  });


  // ----------------------------------------------------------
  // DARK WOOD FRONT DOOR
  // ----------------------------------------------------------

  addBox({
    py:
      1.18,

    pz:
      d / 2
      + 0.10,

    bw:
      1.34,

    bh:
      2.35,

    bd:
      0.10,

    material:
      darkWood,
  });


  // Door inset detail.

  addBox({
    py:
      1.18,

    pz:
      d / 2
      + 0.17,

    bw:
      0.82,

    bh:
      1.72,

    bd:
      0.035,

    material:
      terracottaDark,
  });


  // ----------------------------------------------------------
  // SPANISH ENTRY ARCH VISUAL
  // ----------------------------------------------------------

  const arch =
    new THREE.Mesh(
      new THREE.TorusGeometry(
        0.95,
        0.12,
        10,
        28,
        Math.PI
      ),
      trim
    );

  arch.rotation.z =
    Math.PI;

  arch.position.set(
    0,
    2.30,
    d / 2
      + 0.18
  );

  arch.castShadow =
    true;

  house.add(
    arch
  );


  // ----------------------------------------------------------
  // FRONT WINDOWS
  // ----------------------------------------------------------

  for (
    const wx of [
      -w * 0.29,
      w * 0.29,
    ]
  ) {

    addBox({
      px:
        wx,

      py:
        1.68,

      pz:
        d / 2
        + 0.15,

      bw:
        2.2,

      bh:
        1.45,

      bd:
        0.08,

      material:
        trim,
    });


    addBox({
      px:
        wx,

      py:
        1.68,

      pz:
        d / 2
        + 0.21,

      bw:
        1.82,

      bh:
        1.10,

      bd:
        0.055,

      material:
        glass,
    });


    // Mullions.

    addBox({
      px:
        wx,

      py:
        1.68,

      pz:
        d / 2
        + 0.26,

      bw:
        0.055,

      bh:
        1.08,

      bd:
        0.04,

      material:
        darkWood,
    });


    addBox({
      px:
        wx,

      py:
        1.68,

      pz:
        d / 2
        + 0.26,

      bw:
        1.80,

      bh:
        0.055,

      bd:
        0.04,

      material:
        darkWood,
    });
  }


  // ----------------------------------------------------------
  // TERRACOTTA HIP ROOF
  // ----------------------------------------------------------

  const roof =
    new THREE.Mesh(
      new THREE.ConeGeometry(
        1,
        1.85,
        4
      ),
      terracotta
    );


  roof.rotation.y =
    Math.PI / 4;


  roof.position.y =
    wallHeight
    + 0.88;


  roof.scale.set(
    w * 0.76,
    1,
    d * 0.76
  );


  roof.castShadow =
    true;

  roof.receiveShadow =
    true;

  house.add(
    roof
  );


  // ----------------------------------------------------------
  // ROOF EDGE / CLAY TRIM
  // ----------------------------------------------------------

  addBox({
    py:
      wallHeight
      + 0.06,

    pz:
      d / 2
      + 0.08,

    bw:
      w + 0.8,

    bh:
      0.13,

    bd:
      0.28,

    material:
      terracottaDark,
  });


  addBox({
    py:
      wallHeight
      + 0.06,

    pz:
      -d / 2
      - 0.08,

    bw:
      w + 0.8,

    bh:
      0.13,

    bd:
      0.28,

    material:
      terracottaDark,
  });


  // ----------------------------------------------------------
  // SIMPLE FRONT PORCH / STONE STEP
  // ----------------------------------------------------------

  addBox({
    py:
      0.08,

    pz:
      d / 2
      + 0.60,

    bw:
      3.8,

    bh:
      0.16,

    bd:
      1.25,

    material:
      stuccoLight,
  });



  // ============================================================
  // REALMLIFE AAA GOLDEN SPANISH HOUSE V1
  // Owner residence visual upgrade only.
  // Existing gameplay/collision/interior systems remain authoritative.
  // ============================================================

  if (own) {

    house.userData.realmLifeAAATier =
      "golden-spanish-v1";

    // Replace the primitive pyramid-like roof for the owner's home.
    roof.visible =
      false;


    const stone =
      new THREE.MeshStandardMaterial({
        color: 0xb9a27e,
        roughness: 0.93,
        metalness: 0.0,
      });


    const iron =
      new THREE.MeshStandardMaterial({
        color: 0x171717,
        roughness: 0.48,
        metalness: 0.72,
      });


    const clayAccent =
      new THREE.MeshStandardMaterial({
        color: 0x873a24,
        roughness: 0.78,
        metalness: 0.01,
      });


    const warmGlass =
      new THREE.MeshStandardMaterial({
        color: 0xffc783,
        emissive: 0xff8b35,
        emissiveIntensity: 1.15,
        roughness: 0.26,
        metalness: 0.02,
      });


    const addCylinder = ({
      px = 0,
      py = 0,
      pz = 0,
      radius = 0.15,
      height = 1,
      material = stuccoLight,
      segments = 16,
    }) => {

      const mesh =
        new THREE.Mesh(
          new THREE.CylinderGeometry(
            radius,
            radius,
            height,
            segments
          ),
          material
        );

      mesh.position.set(
        px,
        py,
        pz
      );

      mesh.castShadow =
        true;

      mesh.receiveShadow =
        true;

      house.add(
        mesh
      );

      return mesh;
    };


    const addRoofBeam = (
      a,
      b,
      radius = 0.075
    ) => {

      const start =
        new THREE.Vector3(
          ...a
        );

      const end =
        new THREE.Vector3(
          ...b
        );

      const delta =
        new THREE.Vector3()
          .subVectors(
            end,
            start
          );

      const length =
        delta.length();

      const beam =
        new THREE.Mesh(
          new THREE.CylinderGeometry(
            radius,
            radius,
            length,
            12
          ),
          clayAccent
        );

      beam.position
        .copy(start)
        .add(end)
        .multiplyScalar(0.5);

      beam.quaternion
        .setFromUnitVectors(
          new THREE.Vector3(
            0,
            1,
            0
          ),
          delta
            .clone()
            .normalize()
        );

      beam.castShadow =
        true;

      beam.receiveShadow =
        true;

      house.add(
        beam
      );

      return beam;
    };


    // ----------------------------------------------------------
    // TRUE HIPPED SPANISH ROOF
    // ----------------------------------------------------------

    const roofOverhang =
      0.72;

    const roofW =
      w
      + roofOverhang * 2;

    const roofD =
      d
      + roofOverhang * 2;

    const roofBaseY =
      wallHeight
      + 0.15;

    const roofRise =
      1.72;

    const roofTopY =
      roofBaseY
      + roofRise;

    const ridgeHalf =
      Math.max(
        1.9,
        roofW * 0.235
      );


    const A = [
      -roofW / 2,
      roofBaseY,
      roofD / 2,
    ];

    const B = [
      roofW / 2,
      roofBaseY,
      roofD / 2,
    ];

    const C = [
      roofW / 2,
      roofBaseY,
      -roofD / 2,
    ];

    const D = [
      -roofW / 2,
      roofBaseY,
      -roofD / 2,
    ];

    const R1 = [
      -ridgeHalf,
      roofTopY,
      0,
    ];

    const R2 = [
      ridgeHalf,
      roofTopY,
      0,
    ];


    const roofGeometry =
      new THREE.BufferGeometry();

    roofGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          // Front plane
          ...A, ...B, ...R2,
          ...A, ...R2, ...R1,

          // Back plane
          ...C, ...D, ...R1,
          ...C, ...R1, ...R2,

          // Left hip
          ...D, ...A, ...R1,

          // Right hip
          ...B, ...C, ...R2,
        ],
        3
      )
    );

    roofGeometry.computeVertexNormals();


    const spanishRoof =
      new THREE.Mesh(
        roofGeometry,
        new THREE.MeshStandardMaterial({
          color: 0xa84d2d,
          roughness: 0.76,
          metalness: 0.01,
          side: THREE.DoubleSide,
        })
      );

    spanishRoof.castShadow =
      true;

    spanishRoof.receiveShadow =
      true;

    house.add(
      spanishRoof
    );


    // Roof ridge caps.
    addRoofBeam(
      R1,
      R2,
      0.10
    );

    addRoofBeam(
      A,
      R1,
      0.08
    );

    addRoofBeam(
      D,
      R1,
      0.08
    );

    addRoofBeam(
      B,
      R2,
      0.08
    );

    addRoofBeam(
      C,
      R2,
      0.08
    );


    // Clay tile courses across the visible front/back slopes.
    for (
      const t of [
        0.17,
        0.34,
        0.51,
        0.68,
        0.84,
      ]
    ) {

      const rowWidth =
        roofW * (1 - t)
        + ridgeHalf * 2 * t;

      const rowY =
        roofBaseY
        + roofRise * t
        + 0.035;

      const rowZ =
        roofD / 2
        * (1 - t);


      addBox({
        py:
          rowY,

        pz:
          rowZ,

        bw:
          rowWidth,

        bh:
          0.045,

        bd:
          0.10,

        material:
          clayAccent,
      });


      addBox({
        py:
          rowY,

        pz:
          -rowZ,

        bw:
          rowWidth,

        bh:
          0.045,

        bd:
          0.10,

        material:
          clayAccent,
      });
    }


    // ----------------------------------------------------------
    // STONE FOUNDATION COURSE
    // ----------------------------------------------------------

    addBox({
      py:
        0.25,

      pz:
        d / 2
        + 0.14,

      bw:
        w + 0.16,

      bh:
        0.50,

      bd:
        0.22,

      material:
        stone,
    });


    // ----------------------------------------------------------
    // DEEP SPANISH ENTRY
    // ----------------------------------------------------------

    for (
      const cx of [
        -1.75,
        1.75,
      ]
    ) {

      addCylinder({
        px:
          cx,

        py:
          1.35,

        pz:
          d / 2
          + 0.82,

        radius:
          0.19,

        height:
          2.55,

        material:
          stuccoLight,

        segments:
          20,
      });


      addBox({
        px:
          cx,

        py:
          0.13,

        pz:
          d / 2
          + 0.82,

        bw:
          0.52,

        bh:
          0.26,

        bd:
          0.52,

        material:
          stone,
      });


      addBox({
        px:
          cx,

        py:
          2.63,

        pz:
          d / 2
          + 0.82,

        bw:
          0.50,

        bh:
          0.22,

        bd:
          0.50,

        material:
          trim,
      });
    }


    // Entry beam.
    addBox({
      py:
        2.72,

      pz:
        d / 2
        + 0.82,

      bw:
        4.25,

      bh:
        0.27,

      bd:
        0.34,

      material:
        stuccoLight,
    });


    // Terracotta porch canopy.
    const canopyLeft =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          4.7,
          0.13,
          1.15
        ),
        terracotta
      );

    canopyLeft.position.set(
      0,
      2.98,
      d / 2 + 0.52
    );

    canopyLeft.rotation.x =
      -0.28;

    canopyLeft.castShadow =
      true;

    house.add(
      canopyLeft
    );


    const canopyRight =
      canopyLeft.clone();

    canopyRight.position.z =
      d / 2 + 1.46;

    canopyRight.rotation.x =
      0.28;

    house.add(
      canopyRight
    );


    // ----------------------------------------------------------
    // FACADE DEPTH / PILASTERS
    // ----------------------------------------------------------

    for (
      const px of [
        -w * 0.43,
        -w * 0.15,
        w * 0.15,
        w * 0.43,
      ]
    ) {

      addBox({
        px,

        py:
          wallHeight / 2,

        pz:
          d / 2
          + 0.18,

        bw:
          0.28,

        bh:
          wallHeight - 0.20,

        bd:
          0.28,

        material:
          stuccoLight,
      });
    }


    // ----------------------------------------------------------
    // WOOD SHUTTERS + WINDOW SILLS
    // ----------------------------------------------------------

    for (
      const wx of [
        -w * 0.29,
        w * 0.29,
      ]
    ) {

      addBox({
        px:
          wx - 1.18,

        py:
          1.68,

        pz:
          d / 2
          + 0.31,

        bw:
          0.28,

        bh:
          1.34,

        bd:
          0.10,

        material:
          darkWood,
      });


      addBox({
        px:
          wx + 1.18,

        py:
          1.68,

        pz:
          d / 2
          + 0.31,

        bw:
          0.28,

        bh:
          1.34,

        bd:
          0.10,

        material:
          darkWood,
      });


      addBox({
        px:
          wx,

        py:
          0.98,

        pz:
          d / 2
          + 0.32,

        bw:
          2.48,

        bh:
          0.13,

        bd:
          0.32,

        material:
          stone,
      });
    }


    // ----------------------------------------------------------
    // IRON FRONT-DOOR HARDWARE
    // ----------------------------------------------------------

    addBox({
      px:
        0.42,

      py:
        1.20,

      pz:
        d / 2
        + 0.245,

      bw:
        0.055,

      bh:
        0.62,

      bd:
        0.045,

      material:
        iron,
    });


    // ----------------------------------------------------------
    // WARM ARCHITECTURAL SCONCES
    // ----------------------------------------------------------

    for (
      const sx of [
        -1.28,
        1.28,
      ]
    ) {

      addBox({
        px:
          sx,

        py:
          2.03,

        pz:
          d / 2
          + 0.34,

        bw:
          0.16,

        bh:
          0.30,

        bd:
          0.14,

        material:
          iron,
      });


      const lamp =
        new THREE.Mesh(
          new THREE.SphereGeometry(
            0.10,
            12,
            8
          ),
          warmGlass
        );

      lamp.position.set(
        sx,
        1.99,
        d / 2 + 0.44
      );

      house.add(
        lamp
      );


      const light =
        new THREE.PointLight(
          0xffa95c,
          0.72,
          6.5,
          2
        );

      light.position.set(
        sx,
        2.05,
        d / 2 + 0.72
      );

      house.add(
        light
      );
    }


    // ==========================================================
    // UPPER STORIES — FLOORS 2 + 3
    // ==========================================================

    for (
      let floorIndex = 1;
      floorIndex < levelCount;
      floorIndex += 1
    ) {

      const floorBase =
        floorIndex *
        storyHeight;

      const windowY =
        floorBase +
        1.68;


      // Decorative band separating each story.
      addBox({
        py:
          floorBase + 0.08,

        pz:
          d / 2 + 0.19,

        bw:
          w + 0.22,

        bh:
          0.16,

        bd:
          0.25,

        material:
          trim,
      });


      // Three windows per upper floor.
      for (
        const wx of [
          -w * 0.29,
          0,
          w * 0.29,
        ]
      ) {

        // Window frame.
        addBox({
          px:
            wx,

          py:
            windowY,

          pz:
            d / 2 + 0.15,

          bw:
            2.20,

          bh:
            1.45,

          bd:
            0.08,

          material:
            trim,
        });


        // Glass.
        addBox({
          px:
            wx,

          py:
            windowY,

          pz:
            d / 2 + 0.21,

          bw:
            1.82,

          bh:
            1.10,

          bd:
            0.055,

          material:
            glass,
        });


        // Vertical mullion.
        addBox({
          px:
            wx,

          py:
            windowY,

          pz:
            d / 2 + 0.26,

          bw:
            0.055,

          bh:
            1.08,

          bd:
            0.04,

          material:
            darkWood,
        });


        // Horizontal mullion.
        addBox({
          px:
            wx,

          py:
            windowY,

          pz:
            d / 2 + 0.26,

          bw:
            1.80,

          bh:
            0.055,

          bd:
            0.04,

          material:
            darkWood,
        });


        // Stone sill.
        addBox({
          px:
            wx,

          py:
            windowY - 0.70,

          pz:
            d / 2 + 0.30,

          bw:
            2.42,

          bh:
            0.12,

          bd:
            0.28,

          material:
            stone,
        });
      }


      // Spanish center balcony.
      addBox({
        py:
          floorBase + 0.94,

        pz:
          d / 2 + 0.57,

        bw:
          2.75,

        bh:
          0.14,

        bd:
          0.74,

        material:
          stone,
      });


      for (
        const bx of [
          -1.04,
          -0.52,
          0,
          0.52,
          1.04,
        ]
      ) {

        addCylinder({
          px:
            bx,

          py:
            floorBase + 1.42,

          pz:
            d / 2 + 0.87,

          radius:
            0.035,

          height:
            0.80,

          material:
            iron,

          segments:
            8,
        });
      }


      addBox({
        py:
          floorBase + 1.81,

        pz:
          d / 2 + 0.87,

        bw:
          2.35,

        bh:
          0.07,

        bd:
          0.07,

        material:
          iron,
      });
    }


    // ----------------------------------------------------------
    // EAVE BAND
    // ----------------------------------------------------------

    addBox({
      py:
        wallHeight
        + 0.03,

      pz:
        d / 2
        + 0.12,

      bw:
        w + 0.38,

      bh:
        0.22,

      bd:
        0.30,

      material:
        trim,
    });


    addBox({
      py:
        wallHeight
        + 0.03,

      pz:
        -d / 2
        - 0.12,

      bw:
        w + 0.38,

      bh:
        0.22,

      bd:
        0.30,

      material:
        trim,
    });


    console.info(
      "[RealmLife AAA] Golden Spanish residence installed"
    );
  }


  // ----------------------------------------------------------
  // PRIVACY METADATA
  // ----------------------------------------------------------

  house.userData
    .realmLifeResidentialShell =
      true;


  house.userData
    .privateByDefault =
      true;


  house.userData
    .ownProperty =
      !!own;


  house.userData
    .propertyLabel =
      label;

  house.userData
    .levelsAbove =
      levelCount;

  house.userData
    .levelsBelow =
      basementCount;


  return house;
}



function installRealmLifeResidentialPrivacy(
  root,
  colliders = null
) {

  const privacyRoot =
    new THREE.Group();


  privacyRoot.name =
    "RealmLife Residential Privacy Shells";


  root.add(
    privacyRoot
  );


  // ----------------------------------------------------------
  // OWN STARTER RESIDENCE
  //
  // Current starter-home interior occupies approximately
  // the central home lot.
  // This is a VISUAL privacy shell only. Existing interactions,
  // collisions and furniture remain authoritative.
  // ----------------------------------------------------------

  const ownShell =
    createSpanishResidentialPrivacyShell({
      x: 0,
      z: 0,
      w: 18.2,
      d: 14.2,
      label:
        "Your Residence",
      own:
        true,
      levelsAbove:
        3,
      levelsBelow:
        3,
    });


  privacyRoot.add(
    ownShell
  );


  // ----------------------------------------------------------
  // EXISTING RESIDENTIAL PROTOTYPES
  //
  // These homes remain FULL from the public world.
  // Their private interior must not be visible from the street.
  // ----------------------------------------------------------

  // ========================================================
  // CITY 001 — 100 NORMAL RESIDENTIAL HOMES
  //
  // 10 columns x 10 rows.
  //
  // Maple / Garden / Violet stay at their original physical
  // coordinates as part of Row 1.
  //
  // A large center gap is intentionally reserved for the
  // Community Center / pool / park / portal in V6B2.
  // ========================================================

  const communityColumns = [
    -130,
    -104,
    -78,
    -52,
    -26,
    0,
    27,
    53,
    79,
    105,
  ];


  const communityRows = [
    37,
    63,
    89,
    115,
    141,

    // Central community district gap.

    205,
    231,
    257,
    283,
    309,
  ];


  const privateHomes = [];


  for (
    let rowIndex = 0;
    rowIndex < 10;
    rowIndex += 1
  ) {

    for (
      let colIndex = 0;
      colIndex < 10;
      colIndex += 1
    ) {

      const lotSeq =
        rowIndex * 10
        + colIndex
        + 1;


      let x =
        communityColumns[
          colIndex
        ];

      const z =
        communityRows[
          rowIndex
        ];


      let label =
        `City 001 Residence ${String(
          lotSeq
        ).padStart(
          3,
          "0"
        )}`;


      // Preserve the original three working prototype homes.
      if (
        rowIndex === 0
        &&
        colIndex === 4
      ) {
        x = -26;
        label = "Maple House";
      }


      if (
        rowIndex === 0
        &&
        colIndex === 5
      ) {
        x = 0;
        label = "Garden House";
      }


      if (
        rowIndex === 0
        &&
        colIndex === 6
      ) {
        x = 27;
        label = "Violet House";
      }


      // Small deterministic size variation keeps the street
      // from looking like 100 identical copy/paste boxes.
      const variant =
        lotSeq % 4;


      const w =
        variant === 0
          ? 15.5
          : variant === 1
            ? 14
            : variant === 2
              ? 14.8
              : 13.8;


      const d =
        variant === 0
          ? 12.8
          : variant === 1
            ? 12
            : variant === 2
              ? 12.4
              : 11.8;


      privateHomes.push({
        x,
        z,
        w,
        d,

        label,

        lotSeq,

        cityId:
          "city-001",
      });
    }
  }


  const privateShells =
    privateHomes.map(
      (home) => {

        const shell =
          createSpanishResidentialPrivacyShell({
            ...home,
            own:
              false,
          });


        privacyRoot.add(
          shell
        );


        shell.userData
          .cityId =
            home.cityId
            || "city-001";


        shell.userData
          .cityLotSeq =
            home.lotSeq
            || null;


        shell.userData
          .residentialCommunity =
            true;


        /*
         * These are full private exterior houses.
         * They must physically block world movement even though
         * their interiors are not streamed until authorized.
         */
        if (
          Array.isArray(
            colliders
          )
        ) {

          colliders.push({
            x:
              home.x,

            z:
              home.z,

            hw:
              home.w / 2,

            hd:
              home.d / 2,

            residentialHouse:
              true,

            cityId:
              home.cityId
              || "city-001",

            lotSeq:
              home.lotSeq
              || null,
          });
        }


        return shell;
      }
    );


  let ownMode =
    "full";


  const api = {

    setOwnMode(
      requestedMode
    ) {

      ownMode =
        requestedMode ===
          "cutaway"
          ? "cutaway"
          : "full";


      ownShell.visible =
        ownMode ===
        "full";


      if (
        typeof window !==
        "undefined"
      ) {

        window
          .__REALMLIFE_HOUSE_MODE =
            ownMode;
      }


      return ownMode;
    },


    getOwnMode() {

      return ownMode;
    },


    setPrivateHomesFull() {

      privateShells
        .forEach(
          (shell) => {

            shell.visible =
              true;
          }
        );
    },


    ownShell,

    privateShells,

    root:
      privacyRoot,
  };


  // Neighbor residential houses start FULL.
  api.setPrivateHomesFull();


  // Own residence starts FULL unless runtime changes it.
  api.setOwnMode(
    "full"
  );


  if (
    typeof window !==
    "undefined"
  ) {

    window
      .__REALMLIFE_HOUSE_PRIVACY =
        api;
  }


  return api;
}


export function buildNeighborhoodWorld(
  scene
) {
  const root = new THREE.Group();
  root.name = "RealmLifeNeighborhood";

  scene.add(root);

  const colliders = [];

  // ========================================================
  // REALMLIFE V6B1 100-HOME COMMUNITY GRID
  // ========================================================

  const bounds = {
    minX: -320,
    maxX: 320,
    minZ: -200,
    maxZ: 760,
  };

  const ownedLot = {
    minX: -10,
    maxX: 10,
    minZ: -9,
    maxZ: 16,
  };

  // ----------------------------------------------------------
  // PRIVATE PROPERTY BOUNDARY
  //
  // This is the current prototype physical lot.
  // Server ownership / household authority is separate from
  // these coordinates so future residential sectors can bind
  // different physical lots to different property records.
  // ----------------------------------------------------------

  const propertyBoundary = {
    minX: ownedLot.minX,
    maxX: ownedLot.maxX,
    minZ: ownedLot.minZ,
    maxZ: ownedLot.maxZ,
  };

  const outsideSpawn = {
    x: 0,
    y: 0,
    z: 17.6,
  };


  const fenceMaterial =
    new THREE.MeshStandardMaterial({
      color: 0x132536,
      roughness: 0.34,
      metalness: 0.62,
    });


  const addFenceSegment = (
    x,
    z,
    w,
    d,
    collider = true
  ) => {
    const fence =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          w,
          1.15,
          d
        ),
        fenceMaterial
      );

    fence.position.set(
      x,
      0.58,
      z
    );

    fence.castShadow = true;
    fence.receiveShadow = true;

    root.add(fence);

    if (collider) {
      colliders.push({
        x,
        z,
        hw: w / 2,
        hd: d / 2,
        propertyFence: true,
      });
    }

    return fence;
  };


  // Back wall.
  addFenceSegment(
    0,
    propertyBoundary.minZ,
    20.4,
    0.26
  );

  // Left / right property walls.
  addFenceSegment(
    propertyBoundary.minX,
    3.4,
    0.26,
    25.0
  );

  addFenceSegment(
    propertyBoundary.maxX,
    3.4,
    0.26,
    25.0
  );


  // Front wall leaves a centered gate opening.
  addFenceSegment(
    -5.9,
    15.65,
    8.2,
    0.26
  );

  addFenceSegment(
    5.9,
    15.65,
    8.2,
    0.26
  );


  // ----------------------------------------------------------
  // INTERACTIVE PROPERTY GATE
  // ----------------------------------------------------------

  const propertyGate =
    new THREE.Group();

  propertyGate.name =
    "RealmLifePrivatePropertyGate";

  propertyGate.position.set(
    0,
    0,
    15.65
  );

  propertyGate.userData.lifeObject =
    true;

  propertyGate.userData.id =
    "private-property-gate";

  propertyGate.userData.label =
    "🔒 Private Property";

  propertyGate.userData.actions = [
    {
      id:
        "property_manage",

      label:
        "🏠 Property & Household",
    },
  ];

  propertyGate.userData.approach =
    [0, 1.35];

  propertyGate.userData.realmLifePropertyGate =
    true;


  const gateMaterial =
    new THREE.MeshStandardMaterial({
      color: 0x1d4259,
      emissive: 0x063148,
      emissiveIntensity: 0.55,
      roughness: 0.26,
      metalness: 0.72,
    });


  const glowMaterial =
    new THREE.MeshStandardMaterial({
      color: 0x2ee6ff,
      emissive: 0x2ee6ff,
      emissiveIntensity: 2.2,
      roughness: 0.2,
      metalness: 0.25,
    });


  for (
    const x of [-1.42, 1.42]
  ) {
    const post =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.22,
          2.15,
          0.30
        ),
        gateMaterial
      );

    post.position.set(
      x,
      1.08,
      0
    );

    post.castShadow = true;

    propertyGate.add(
      post
    );
  }


  for (
    const x of [-0.72, 0.72]
  ) {
    const panel =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          1.32,
          1.32,
          0.13
        ),
        gateMaterial
      );

    panel.position.set(
      x,
      0.82,
      0
    );

    panel.castShadow = true;

    propertyGate.add(
      panel
    );
  }


  const gateGlow =
    new THREE.Mesh(
      new THREE.BoxGeometry(
        2.75,
        0.075,
        0.07
      ),
      glowMaterial
    );

  gateGlow.position.set(
    0,
    1.48,
    -0.09
  );

  propertyGate.add(
    gateGlow
  );


  const lock =
    new THREE.Mesh(
      new THREE.BoxGeometry(
        0.28,
        0.34,
        0.16
      ),
      glowMaterial
    );

  lock.position.set(
    0,
    0.82,
    -0.13
  );

  propertyGate.add(
    lock
  );


  root.add(
    propertyGate
  );



  // ----------------------------------------------------------
  // WORLD CLICK SURFACE
  // Invisible plane allows seamless click-to-walk everywhere.
  // ----------------------------------------------------------

  const clickPlane =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        680,
        1040
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
    280
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

  // ========================================================
  // REALMLIFE V6B2 CITY SHIFT + COMMUNITY CORE
  //
  // Preserve the original working Downtown/Riverwalk geometry,
  // but move it north beyond the 100-home residential district.
  //
  // Collider coordinates are shifted by the exact same amount.
  // ========================================================

  const cityColliderStart =
    colliders.length;


  const cityDistrict =
    buildCityDistrict(
      root,
      colliders
    );


  const realmLifeDowntownShiftZ =
    360;


  if (
    cityDistrict
    ?.root
  ) {
    cityDistrict
      .root
      .position.z +=
        realmLifeDowntownShiftZ;
  }


  for (
    let i =
      cityColliderStart;

    i <
      colliders.length;

    i += 1
  ) {
    if (
      Number.isFinite(
        colliders[i]?.z
      )
    ) {
      colliders[i].z +=
        realmLifeDowntownShiftZ;
    }
  }


  const communityCore =
    buildRealmLifeCommunityCore(
      root,
      colliders
    );


  // ==========================================================
  // REALMLIFE V5G1B2 — FULL HOUSE / PRIVATE RESIDENTIAL VIEW
  // ==========================================================

  const housePrivacy =
    installRealmLifeResidentialPrivacy(
      root,
      colliders
    );



  return {
    root,
    colliders,
    clickPlane,
    bounds,
    ownedLot,

    propertyBoundary,
    propertyGate,
    outsideSpawn,

    housePrivacy,

    cityDistrict,
    communityCore,
  };
}
