
import * as THREE from "three";


// ============================================================
// REALMLIFE V6B2
// 100-HOME GATED COMMUNITY + METRO EXPANSION
// ============================================================


function mat(
  color,
  {
    roughness = 0.72,
    metalness = 0.05,
    transparent = false,
    opacity = 1,
    emissive = 0x000000,
    emissiveIntensity = 0,
  } = {}
) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    transparent,
    opacity,
    emissive,
    emissiveIntensity,
  });
}


function box(
  group,
  {
    x = 0,
    y = 0,
    z = 0,

    w = 1,
    h = 1,
    d = 1,

    color = 0xffffff,

    material = null,

    cast = true,
    receive = true,
  } = {}
) {
  const mesh =
    new THREE.Mesh(
      new THREE.BoxGeometry(
        w,
        h,
        d
      ),
      material
      || mat(color)
    );

  mesh.position.set(
    x,
    y,
    z
  );

  mesh.castShadow =
    cast;

  mesh.receiveShadow =
    receive;

  group.add(
    mesh
  );

  return mesh;
}


function plane(
  group,
  {
    x = 0,
    y = 0,
    z = 0,

    w = 1,
    d = 1,

    color = 0xffffff,

    material = null,
  } = {}
) {
  const mesh =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        w,
        d
      ),
      material
      || mat(color)
    );

  mesh.rotation.x =
    -Math.PI / 2;

  mesh.position.set(
    x,
    y,
    z
  );

  mesh.receiveShadow =
    true;

  group.add(
    mesh
  );

  return mesh;
}


function addCollider(
  colliders,
  x,
  z,
  w,
  d,
  extra = {}
) {
  colliders.push({
    x,
    z,

    hw:
      w / 2,

    hd:
      d / 2,

    ...extra,
  });
}


function labelSprite(
  text,
  {
    width = 512,
    height = 128,
    scale = 8,
  } = {}
) {
  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width =
    width;

  canvas.height =
    height;

  const ctx =
    canvas.getContext(
      "2d"
    );

  ctx.fillStyle =
    "rgba(12,20,27,0.90)";

  ctx.fillRect(
    0,
    0,
    width,
    height
  );

  ctx.strokeStyle =
    "rgba(255,213,130,0.80)";

  ctx.lineWidth =
    5;

  ctx.strokeRect(
    4,
    4,
    width - 8,
    height - 8
  );

  ctx.fillStyle =
    "#fff7e7";

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "middle";

  // Dynamic text fit: shrink until the label fits — never crop.
  const coreLabel =
    String(text || "");

  let fitFont = 40;

  ctx.font =
    `bold ${fitFont}px Arial`;

  while (
    fitFont > 14
    && ctx.measureText(coreLabel).width > width - 36
  ) {
    fitFont -= 3;

    ctx.font =
      `bold ${fitFont}px Arial`;
  }

  ctx.fillText(
    coreLabel,
    width / 2,
    height / 2
  );

  const texture =
    new THREE.CanvasTexture(
      canvas
    );

  texture.needsUpdate =
    true;

  const sprite =
    new THREE.Sprite(
      new THREE.SpriteMaterial({
        map:
          texture,

        transparent:
          true,

        depthTest:
          false,
      })
    );

  sprite.scale.set(
    scale,
    scale * 0.25,
    1
  );

  return sprite;
}


function addPalm(
  group,
  x,
  z,
  scale = 1
) {
  const palm =
    new THREE.Group();

  palm.position.set(
    x,
    0,
    z
  );


  const trunkMat =
    mat(
      0x845637,
      {
        roughness:
          0.94,
      }
    );


  const leafMat =
    mat(
      0x276e3d,
      {
        roughness:
          0.90,
      }
    );


  const trunk =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.20 * scale,
        0.32 * scale,
        4.8 * scale,
        9
      ),
      trunkMat
    );

  trunk.position.y =
    2.4 * scale;

  trunk.castShadow =
    true;

  palm.add(
    trunk
  );


  for (
    let i = 0;
    i < 7;
    i += 1
  ) {
    const leaf =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.72 * scale,
          8,
          5
        ),
        leafMat
      );

    const a =
      (
        i
        / 7
      )
      * Math.PI
      * 2;

    leaf.scale.set(
      1.8,
      0.24,
      0.55
    );

    leaf.position.set(
      Math.cos(a)
        * 0.80
        * scale,

      4.70
        * scale,

      Math.sin(a)
        * 0.80
        * scale
    );

    leaf.rotation.y =
      -a;

    leaf.rotation.z =
      (
        i % 2
        ? 0.24
        : -0.24
      );

    leaf.castShadow =
      true;

    palm.add(
      leaf
    );
  }


  group.add(
    palm
  );

  return palm;
}


function addStreetLight(
  group,
  x,
  z
) {
  const poleMat =
    mat(
      0x30363b,
      {
        roughness:
          0.38,

        metalness:
          0.65,
      }
    );


  const lampMat =
    mat(
      0xffd998,
      {
        roughness:
          0.25,

        emissive:
          0xffa62b,

        emissiveIntensity:
          1.7,
      }
    );


  box(
    group,
    {
      x,
      y:
        2.1,
      z,

      w:
        0.12,
      h:
        4.2,
      d:
        0.12,

      material:
        poleMat,
    }
  );


  box(
    group,
    {
      x,
      y:
        4.22,
      z,

      w:
        0.48,
      h:
        0.17,
      d:
        0.48,

      material:
        lampMat,
    }
  );
}


function addHorizontalRoad(
  group,
  z,
  west,
  east
) {
  const width =
    east - west;

  const center =
    (
      west
      + east
    )
    / 2;


  plane(
    group,
    {
      x:
        center,

      y:
        0.010,

      z,

      w:
        width,

      d:
        12.8,

      color:
        0xc5c2ba,
    }
  );


  plane(
    group,
    {
      x:
        center,

      y:
        0.025,

      z,

      w:
        width,

      d:
        8.4,

      color:
        0x3b4045,
    }
  );


  for (
    let x =
      west + 4;

    x <
      east - 4;

    x += 10
  ) {
    box(
      group,
      {
        x,
        y:
          0.047,
        z,

        w:
          4.2,
        h:
          0.025,
        d:
          0.14,

        color:
          0xe3c95c,

        cast:
          false,
      }
    );
  }
}


function addVerticalRoad(
  group,
  x,
  south,
  north
) {
  const depth =
    north - south;

  const center =
    (
      south
      + north
    )
    / 2;


  plane(
    group,
    {
      x,

      y:
        0.010,

      z:
        center,

      w:
        12.8,

      d:
        depth,

      color:
        0xc5c2ba,
    }
  );


  plane(
    group,
    {
      x,

      y:
        0.025,

      z:
        center,

      w:
        8.4,

      d:
        depth,

      color:
        0x3b4045,
    }
  );


  for (
    let z =
      south + 4;

    z <
      north - 4;

    z += 10
  ) {
    box(
      group,
      {
        x,

        y:
          0.047,

        z,

        w:
          0.14,
        h:
          0.025,
        d:
          4.2,

        color:
          0xe3c95c,

        cast:
          false,
      }
    );
  }
}


function addWallSegment(
  group,
  colliders,
  x,
  z,
  w,
  d,
  {
    collider = true,
  } = {}
) {
  const stoneMat =
    mat(
      0xb69d7a,
      {
        roughness:
          0.92,
      }
    );


  const stuccoMat =
    mat(
      0xd6c19d,
      {
        roughness:
          0.86,
      }
    );


  box(
    group,
    {
      x,
      y:
        1.45,
      z,

      w,
      h:
        2.9,
      d,

      material:
        stuccoMat,
    }
  );


  box(
    group,
    {
      x,
      y:
        0.25,
      z,

      w:
        w + 0.25,
      h:
        0.50,
      d:
        d + 0.25,

      material:
        stoneMat,
    }
  );


  if (
    collider
  ) {
    addCollider(
      colliders,
      x,
      z,
      w,
      d,
      {
        communityWall:
          true,
      }
    );
  }
}


function addGateFeature(
  group,
  x,
  z,
  label,
  facingNorth = true
) {
  const gate =
    new THREE.Group();

  gate.position.set(
    x,
    0,
    z
  );


  gate.userData
    .realmLifeCommunityGate =
      true;

  gate.userData
    .label =
      label;


  const pillarMat =
    mat(
      0xd7c39f,
      {
        roughness:
          0.82,
      }
    );


  const stoneMat =
    mat(
      0x8e765c,
      {
        roughness:
          0.90,
      }
    );


  const ironMat =
    mat(
      0x22282b,
      {
        roughness:
          0.30,

        metalness:
          0.75,
      }
    );


  for (
    const px
    of [
      -10,
      10,
    ]
  ) {
    box(
      gate,
      {
        x:
          px,

        y:
          2.2,

        w:
          1.8,

        h:
          4.4,

        d:
          1.8,

        material:
          pillarMat,
      }
    );


    box(
      gate,
      {
        x:
          px,

        y:
          0.35,

        w:
          2.2,

        h:
          0.7,

        d:
          2.2,

        material:
          stoneMat,
      }
    );
  }


  // Decorative OPEN gate leaves.
  for (
    const side
    of [
      -1,
      1,
    ]
  ) {
    const leaf =
      box(
        gate,
        {
          x:
            side * 6.8,

          y:
            1.45,

          w:
            5.2,

          h:
            2.8,

          d:
            0.18,

          material:
            ironMat,
        }
      );

    leaf.rotation.y =
      side
      * (
        facingNorth
        ? 0.54
        : -0.54
      );
  }


  const sign =
    labelSprite(
      label,
      {
        scale:
          10,
      }
    );

  sign.position.set(
    0,
    5.2,
    0
  );

  gate.add(
    sign
  );


  group.add(
    gate
  );

  return gate;
}


function addCommunityCenter(
  group,
  colliders
) {
  const center =
    new THREE.Group();

  center.position.set(
    -50,
    0,
    173
  );


  const wallMat =
    mat(
      0xe3cfaa,
      {
        roughness:
          0.78,
      }
    );


  const roofMat =
    mat(
      0x9a4f32,
      {
        roughness:
          0.80,
      }
    );


  const stoneMat =
    mat(
      0x9d8467,
      {
        roughness:
          0.91,
      }
    );


  box(
    center,
    {
      y:
        3.6,

      w:
        34,

      h:
        7.2,

      d:
        24,

      material:
        wallMat,
    }
  );


  box(
    center,
    {
      y:
        0.35,

      w:
        35,

      h:
        0.7,

      d:
        25,

      material:
        stoneMat,
    }
  );


  const roof =
    new THREE.Mesh(
      new THREE.ConeGeometry(
        1,
        1,
        4
      ),
      roofMat
    );

  roof.position.y =
    8.1;

  roof.scale.set(
    25,
    5,
    18
  );

  roof.rotation.y =
    Math.PI / 4;

  roof.castShadow =
    true;

  center.add(
    roof
  );


  for (
    const x
    of [
      -11,
      -5.5,
      5.5,
      11,
    ]
  ) {
    box(
      center,
      {
        x,

        y:
          3.5,

        z:
          -12.05,

        w:
          3.1,

        h:
          3.4,

        d:
          0.16,

        material:
          mat(
            0x6da9be,
            {
              roughness:
                0.20,

              metalness:
                0.08,
            }
          ),
      }
    );
  }


  const sign =
    labelSprite(
      "REALMLIFE COMMUNITY CENTER",
      {
        scale:
          11,
      }
    );

  sign.position.set(
    0,
    8.6,
    -12.7
  );

  center.add(
    sign
  );


  group.add(
    center
  );


  addCollider(
    colliders,
    -50,
    173,
    34,
    24,
    {
      communityCenter:
        true,
    }
  );


  return center;
}


function addCommunityPool(
  group
) {
  // Deck.
  plane(
    group,
    {
      x:
        10,

      y:
        0.045,

      z:
        173,

      w:
        44,

      d:
        30,

      color:
        0xd2c5aa,
    }
  );


  const water =
    plane(
      group,
      {
        x:
          10,

        y:
          0.105,

        z:
          173,

        w:
          34,

        d:
          19,

        material:
          mat(
            0x1b9dbe,
            {
              roughness:
                0.18,

              metalness:
                0.10,

              transparent:
                true,

              opacity:
                0.86,
            }
          ),
      }
    );


  water.name =
    "RealmLifeCommunityPoolWater";


  // Diving board foundation.
  box(
    group,
    {
      x:
        10,

      y:
        0.52,

      z:
        160.7,

      w:
        1.8,

      h:
        0.8,

      d:
        2.8,

      color:
        0xf1f1e7,
    }
  );


  box(
    group,
    {
      x:
        10,

      y:
        1.08,

      z:
        162.6,

      w:
        1.2,

      h:
        0.18,

      d:
        4.6,

      color:
        0xe7eee7,
    }
  );


  const poolSign =
    labelSprite(
      "COMMUNITY POOL",
      {
        scale:
          7,
      }
    );

  poolSign.position.set(
    10,
    4.5,
    188.3
  );

  group.add(
    poolSign
  );
}


function addPortalPlaza(
  group
) {
  const plaza =
    new THREE.Group();

  plaza.position.set(
    65,
    0,
    173
  );


  const ring =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        10,
        10,
        0.34,
        48
      ),
      mat(
        0xc1b28f,
        {
          roughness:
            0.72,
        }
      )
    );

  ring.position.y =
    0.16;

  plaza.add(
    ring
  );


  const inner =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        7.8,
        7.8,
        0.40,
        48
      ),
      mat(
        0x465b62,
        {
          roughness:
            0.36,

          metalness:
            0.22,
        }
      )
    );

  inner.position.y =
    0.22;

  plaza.add(
    inner
  );


  const sign =
    labelSprite(
      "COMMUNITY CENTRAL PORTAL",
      {
        scale:
          9,
      }
    );

  sign.position.set(
    0,
    5.2,
    -9.5
  );

  plaza.add(
    sign
  );


  group.add(
    plaza
  );
}


function addTower(
  group,
  colliders,
  {
    x,
    z,
    w = 22,
    d = 18,
    h = 28,
    color = 0x8da0aa,
    accent = 0x54d8e8,
    label = null,
  }
) {
  const tower =
    new THREE.Group();

  tower.position.set(
    x,
    0,
    z
  );


  box(
    tower,
    {
      y:
        h / 2,

      w,
      h,
      d,

      material:
        mat(
          color,
          {
            roughness:
              0.48,

            metalness:
              0.18,
          }
        ),
    }
  );


  const windowMat =
    mat(
      accent,
      {
        roughness:
          0.22,

        metalness:
          0.22,

        emissive:
          accent,

        emissiveIntensity:
          0.18,
      }
    );


  const levels =
    Math.max(
      3,
      Math.floor(
        h / 4
      )
    );


  for (
    let level = 0;
    level < levels;
    level += 1
  ) {
    const y =
      2.5
      + level
      * 3.4;

    if (
      y
      >= h - 1
    ) {
      break;
    }

    for (
      const side
      of [
        -1,
        1,
      ]
    ) {
      box(
        tower,
        {
          x:
            side
            * (
              w / 2
              + 0.03
            ),

          y,

          z:
            0,

          w:
            0.10,

          h:
            1.5,

          d:
            d * 0.62,

          material:
            windowMat,

          cast:
            false,
        }
      );
    }
  }


  if (
    label
  ) {
    const sign =
      labelSprite(
        label,
        {
          scale:
            7,
        }
      );

    sign.position.set(
      0,
      Math.min(
        h + 3,
        38
      ),
      -d / 2
      - 1
    );

    tower.add(
      sign
    );
  }


  group.add(
    tower
  );


  addCollider(
    colliders,
    x,
    z,
    w,
    d,
    {
      cityBuilding:
        true,
    }
  );


  return tower;
}


function addMetroExpansion(
  root,
  colliders
) {
  const metro =
    new THREE.Group();

  metro.name =
    "RealmLifeV6B2MetroExpansion";

  root.add(
    metro
  );


  // ==========================================================
  // RESIDENTIAL → DOWNTOWN BOULEVARD
  // ==========================================================

  plane(
    metro,
    {
      x:
        -16,

      y:
        0.008,

      z:
        365,

      w:
        17,

      d:
        82,

      color:
        0xc6c4bd,
    }
  );


  plane(
    metro,
    {
      x:
        -16,

      y:
        0.028,

      z:
        365,

      w:
        11,

      d:
        82,

      color:
        0x353b40,
    }
  );


  // ==========================================================
  // MUCH LARGER DOWNTOWN FOUNDATION
  // ==========================================================

  plane(
    metro,
    {
      x:
        0,

      y:
        -0.02,

      z:
        430,

      w:
        470,

      d:
        92,

      color:
        0x777d79,
    }
  );


  // Commercial side avenues.
  for (
    const x
    of [
      -190,
      -145,
      -100,
      -60,
      60,
      100,
      145,
      190,
    ]
  ) {
    plane(
      metro,
      {
        x,

        y:
          0.026,

        z:
          430,

        w:
          9,

        d:
          80,

        color:
          0x343a3f,
      }
    );
  }


  // Cross streets.
  for (
    const z
    of [
      400,
      430,
      458,
    ]
  ) {
    plane(
      metro,
      {
        x:
          0,

        y:
          0.029,

        z,

        w:
          450,

        d:
          9,

        color:
          0x343a3f,
      }
    );
  }


  // ==========================================================
  // EXPANDED RIVER + RIVERWALK
  //
  // Original city river moves from Z 106 -> 466.
  // Existing 90-unit center remains intact.
  // These wings make the total river about 460 units wide.
  // ==========================================================

  const riverMat =
    mat(
      0x22799a,
      {
        roughness:
          0.20,

        metalness:
          0.08,

        transparent:
          true,

        opacity:
          0.88,
      }
    );


  plane(
    metro,
    {
      x:
        0,

      y:
        0.001,

      z:
        466,

      w:
        460,

      d:
        14,

      material:
        riverMat,
    }
  );


  plane(
    metro,
    {
      x:
        0,

      y:
        0.035,

      z:
        455.5,

      w:
        460,

      d:
        6.2,

      color:
        0xc9bea8,
    }
  );


  plane(
    metro,
    {
      x:
        0,

      y:
        0.035,

      z:
        476.5,

      w:
        460,

      d:
        6.2,

      color:
        0xc9bea8,
    }
  );


  // Water collision outside the original 90-wide river.
  addCollider(
    colliders,
    -137.5,
    466,
    185,
    14,
    {
      river:
        true,
    }
  );


  addCollider(
    colliders,
    137.5,
    466,
    185,
    14,
    {
      river:
        true,
    }
  );


  // ==========================================================
  // COMMERCIAL / BUSINESS EXPANSION WINGS
  // ==========================================================

  const towers = [
    [
      -195,
      420,
      24,
      18,
      24,
      0xc19b79,
      0xffc55b,
      "ARTISAN DISTRICT",
    ],

    [
      -155,
      420,
      26,
      19,
      34,
      0x798c95,
      0x5bdcff,
      "REALM TECH",
    ],

    [
      -112,
      420,
      28,
      20,
      29,
      0x9b8c7b,
      0xe1a45b,
      "HOME GALLERY",
    ],

    [
      -72,
      420,
      24,
      18,
      26,
      0x6a727d,
      0x8feaff,
      "WELLNESS",
    ],

    [
      72,
      420,
      24,
      18,
      27,
      0x34384e,
      0x9a6dff,
      "REALM ARCADE",
    ],

    [
      112,
      420,
      26,
      19,
      35,
      0x8b795f,
      0xffb55e,
      "MARKET ROW",
    ],

    [
      155,
      420,
      28,
      20,
      30,
      0x6c818c,
      0x4bdcf1,
      "OFFICE DISTRICT",
    ],

    [
      198,
      420,
      25,
      18,
      25,
      0x8f745e,
      0xf9c36b,
      "CINEMA",
    ],
  ];


  for (
    const [
      x,
      z,
      w,
      d,
      h,
      color,
      accent,
      label,
    ]
    of towers
  ) {
    addTower(
      metro,
      colliders,
      {
        x,
        z,
        w,
        d,
        h,
        color,
        accent,
        label,
      }
    );
  }


  // North-bank skyline.
  for (
    const [
      x,
      h,
      color,
    ]
    of [
      [
        -190,
        42,
        0x586c78,
      ],

      [
        -145,
        55,
        0x677983,
      ],

      [
        -95,
        46,
        0x526874,
      ],

      [
        88,
        50,
        0x66747e,
      ],

      [
        135,
        62,
        0x4e6572,
      ],

      [
        184,
        48,
        0x726b65,
      ],
    ]
  ) {
    addTower(
      metro,
      colliders,
      {
        x,

        z:
          503,

        w:
          26,

        d:
          22,

        h,

        color,

        accent:
          0x78dff2,
      }
    );
  }


  // ==========================================================
  // CENTRAL STATION FOUNDATION
  // ==========================================================

  const station =
    new THREE.Group();

  station.position.set(
    -16,
    0,
    545
  );


  box(
    station,
    {
      y:
        4,

      w:
        70,

      h:
        8,

      d:
        28,

      color:
        0x6d767b,
    }
  );


  box(
    station,
    {
      y:
        8.8,

      w:
        74,

      h:
        1.2,

      d:
        31,

      color:
        0x30383d,
    }
  );


  const stationSign =
    labelSprite(
      "CENTRAL STATION · INTER-CITY TRAIN",
      {
        scale:
          13,
      }
    );

  stationSign.position.set(
    0,
    12,
    -16
  );

  station.add(
    stationSign
  );


  const constructionSign =
    labelSprite(
      "HYPER-SPEED TRAIN · UNDER CONSTRUCTION",
      {
        scale:
          11,
      }
    );

  constructionSign.position.set(
    0,
    8,
    -16.3
  );

  station.add(
    constructionSign
  );


  metro.add(
    station
  );


  addCollider(
    colliders,
    -16,
    545,
    70,
    28,
    {
      trainStation:
        true,
    }
  );


  // Station plaza.
  plane(
    metro,
    {
      x:
        -16,

      y:
        0.02,

      z:
        520,

      w:
        90,

      d:
        20,

      color:
        0xc2bba9,
    }
  );


  return metro;
}


export function buildRealmLifeCommunityCore(
  root,
  colliders
) {
  const community =
    new THREE.Group();

  community.name =
    "RealmLifeV6B2CommunityCore";

  root.add(
    community
  );


  const WEST =
    -146;

  const EAST =
    121;

  const SOUTH =
    30;

  const NORTH =
    325;

  const CENTER_X =
    (
      WEST
      + EAST
    )
    / 2;

  const CENTER_Z =
    (
      SOUTH
      + NORTH
    )
    / 2;


  // ==========================================================
  // LARGE COMMUNITY LANDSCAPE BASE
  // ==========================================================

  plane(
    community,
    {
      x:
        CENTER_X,

      y:
        -0.055,

      z:
        CENTER_Z,

      w:
        EAST
        - WEST
        + 10,

      d:
        NORTH
        - SOUTH
        + 10,

      color:
        0x64965b,
    }
  );


  // ==========================================================
  // FULL INTERNAL ROAD GRID
  // ==========================================================

  for (
    const z
    of [
      50,
      76,
      102,
      128,
      151,
      195,
      218,
      244,
      270,
      296,
    ]
  ) {
    addHorizontalRoad(
      community,
      z,
      WEST + 4,
      EAST - 4
    );
  }


  for (
    const x
    of [
      -117,
      -65,
      -13,
      40,
      92,
    ]
  ) {
    addVerticalRoad(
      community,
      x,
      SOUTH + 4,
      NORTH - 4
    );
  }


  // ==========================================================
  // MASONRY PERIMETER WALL
  // ==========================================================

  addWallSegment(
    community,
    colliders,
    WEST,
    CENTER_Z,
    0.80,
    NORTH - SOUTH
  );


  addWallSegment(
    community,
    colliders,
    EAST,
    CENTER_Z,
    0.80,
    NORTH - SOUTH
  );


  // South wall, leaving entrance opening centered at x=-13.
  addWallSegment(
    community,
    colliders,
    -84,
    SOUTH,
    124,
    0.80
  );


  addWallSegment(
    community,
    colliders,
    58.5,
    SOUTH,
    125,
    0.80
  );


  // North wall, also leaves controlled city exit.
  addWallSegment(
    community,
    colliders,
    -84,
    NORTH,
    124,
    0.80
  );


  addWallSegment(
    community,
    colliders,
    58.5,
    NORTH,
    125,
    0.80
  );


  const southGate =
    addGateFeature(
      community,
      -13,
      SOUTH,
      "REALMLIFE RESIDENTIAL · MAIN GATE",
      true
    );


  const northGate =
    addGateFeature(
      community,
      -13,
      NORTH,
      "REALMLIFE RESIDENTIAL · DOWNTOWN GATE",
      false
    );


  // ==========================================================
  // COMMUNITY CENTRAL DISTRICT
  // ==========================================================

  plane(
    community,
    {
      x:
        7,

      y:
        0.005,

      z:
        173,

      w:
        245,

      d:
        40,

      color:
        0x729960,
    }
  );


  addCommunityCenter(
    community,
    colliders
  );


  addCommunityPool(
    community
  );


  addPortalPlaza(
    community
  );


  // Community park.
  plane(
    community,
    {
      x:
        98,

      y:
        0.025,

      z:
        173,

      w:
        38,

      d:
        34,

      color:
        0x5e8c52,
    }
  );


  // Palms through central district.
  for (
    const [
      x,
      z,
      s,
    ]
    of [
      [
        -70,
        158,
        1.15,
      ],

      [
        -31,
        157,
        1.0,
      ],

      [
        -28,
        189,
        1.05,
      ],

      [
        32,
        157,
        1.10,
      ],

      [
        34,
        189,
        0.95,
      ],

      [
        51,
        155,
        0.90,
      ],

      [
        78,
        155,
        1.05,
      ],

      [
        84,
        190,
        1.10,
      ],

      [
        105,
        160,
        0.95,
      ],

      [
        108,
        187,
        1.05,
      ],
    ]
  ) {
    addPalm(
      community,
      x,
      z,
      s
    );
  }


  // Streetlights distributed without creating expensive
  // real-time PointLights.
  for (
    const z
    of [
      50,
      102,
      151,
      195,
      244,
      296,
    ]
  ) {
    for (
      const x
      of [
        -138,
        -73,
        -21,
        48,
        112,
      ]
    ) {
      addStreetLight(
        community,
        x,
        z - 6
      );
    }
  }


  // Main boulevard landscaping.
  for (
    let z =
      40;

    z <=
      315;

    z += 28
  ) {
    addPalm(
      community,
      -20,
      z,
      0.82
    );
  }


  const metro =
    addMetroExpansion(
      root,
      colliders
    );


  return {
    root:
      community,

    metro,

    bounds: {
      west:
        WEST,

      east:
        EAST,

      south:
        SOUTH,

      north:
        NORTH,
    },

    gates: {
      south:
        southGate,

      north:
        northGate,
    },

    communityPortal: {
      x:
        65,

      z:
        173,
    },

    downtownShiftZ:
      360,
  };
}
