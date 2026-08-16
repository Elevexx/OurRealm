import * as THREE from "three";


function material(
  color,
  {
    metalness = 0.45,
    roughness = 0.3,
    emissive = 0x000000,
    emissiveIntensity = 0,
    transparent = false,
    opacity = 1,
  } = {}
) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
    emissive,
    emissiveIntensity,
    transparent,
    opacity,
  });
}


function box(
  group,
  size,
  position,
  mat
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      ...size
    ),
    mat
  );

  mesh.position.set(
    ...position
  );

  mesh.castShadow = true;
  mesh.receiveShadow = true;

  group.add(mesh);

  return mesh;
}


function textSprite(
  text,
  {
    width = 760,
    height = 120,
    scale = [5.8, 0.92, 1],
    font = 46,
  } = {}
) {
  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width = width;
  canvas.height = height;

  const ctx =
    canvas.getContext(
      "2d"
    );

  ctx.clearRect(
    0,
    0,
    width,
    height
  );

  ctx.fillStyle =
    "rgba(2,12,25,.86)";

  ctx.fillRect(
    0,
    0,
    width,
    height
  );

  ctx.strokeStyle =
    "rgba(80,230,255,.95)";

  ctx.lineWidth = 6;

  ctx.strokeRect(
    4,
    4,
    width - 8,
    height - 8
  );

  ctx.font =
    `900 ${font}px system-ui`;

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "middle";

  ctx.fillStyle =
    "#f4fbff";

  ctx.fillText(
    text,
    width / 2,
    height / 2
  );

  const texture =
    new THREE.CanvasTexture(
      canvas
    );

  texture.colorSpace =
    THREE.SRGBColorSpace;

  const sprite =
    new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      })
    );

  sprite.scale.set(
    ...scale
  );

  return sprite;
}


function portal(
  {
    id,
    label,
    x,
    z,
    color = 0x39dfff,
    fallbackActions = [],
  }
) {
  const g =
    new THREE.Group();

  g.name =
    `RealmLifePortal:${id}`;

  g.position.set(
    x,
    0,
    z
  );

  const baseMat =
    material(
      0x122334,
      {
        metalness: 0.9,
        roughness: 0.16,
      }
    );

  box(
    g,
    [4.6, 0.38, 2.6],
    [0, 0.19, 0],
    baseMat
  );

  box(
    g,
    [3.7, 0.22, 1.8],
    [0, 0.48, 0],
    material(
      0x25394a,
      {
        metalness: 0.85,
        roughness: 0.2,
      }
    )
  );

  const ringMat =
    material(
      0x071822,
      {
        metalness: 0.72,
        roughness: 0.13,
        emissive: color,
        emissiveIntensity: 3.2,
      }
    );

  const ring =
    new THREE.Mesh(
      new THREE.TorusGeometry(
        1.65,
        0.16,
        28,
        96
      ),
      ringMat
    );

  ring.position.y = 2.18;
  ring.castShadow = true;

  g.add(ring);

  const ring2 =
    new THREE.Mesh(
      new THREE.TorusGeometry(
        1.37,
        0.045,
        20,
        96
      ),
      material(
        0xb5f6ff,
        {
          metalness: 0.2,
          roughness: 0.18,
          emissive: color,
          emissiveIntensity: 4.5,
        }
      )
    );

  ring2.position.y = 2.18;

  g.add(ring2);

  const energyMat =
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      side:
        THREE.DoubleSide,

      blending:
        THREE.AdditiveBlending,

      depthWrite: false,
    });

  const energy =
    new THREE.Mesh(
      new THREE.CircleGeometry(
        1.48,
        64
      ),
      energyMat
    );

  energy.position.y = 2.18;
  energy.position.z = 0.025;

  g.add(energy);

  const labelSprite =
    textSprite(label, {
      scale:
        [6.5, 1.0, 1],
      font: 42,
    });

  labelSprite.position.set(
    0,
    4.25,
    0
  );

  g.add(
    labelSprite
  );

  const light =
    new THREE.PointLight(
      color,
      18,
      12,
      2
    );

  light.position.set(
    0,
    2.2,
    1
  );

  g.add(light);

  const start =
    Math.random()
    * Math.PI * 2;

  ring2.onBeforeRender =
    () => {
      const t =
        performance.now()
        * 0.001;

      ring2.rotation.z =
        start + t * 0.7;

      energy.material.opacity =
        0.26
        + Math.sin(
            t * 2.6
          )
          * 0.08;

      light.intensity =
        16
        + Math.sin(
            t * 3
          )
          * 4;
    };

  g.userData.lifeObject =
    true;

  g.userData.realmLifePortal =
    true;

  g.userData.id = id;
  g.userData.label = label;

  g.userData.actions =
    fallbackActions;

  g.userData.approach =
    [0, 2.7];

  return g;
}


function floorRoom(
  root,
  colliders,
  {
    key,
    name,
    x,
    z,
    accent,
  }
) {
  const g =
    new THREE.Group();

  g.name =
    `FounderEstate:${key}`;

  g.position.set(
    x,
    0,
    z
  );

  root.add(g);

  // ==========================================================
  // REALMLIFE INSTANCED INTERIOR VOID SHELL
  //
  // Estate levels are intentionally stored outside the public
  // map, but while active they behave as their own private
  // interior world.
  // ==========================================================

  g.userData.realmLifeInterior =
    true;

  g.userData.floorKey =
    key;


  const interiorShellMat =
    material(
      0x080d13,
      {
        metalness: 0.08,
        roughness: 0.72,
      }
    );


  // Large floor extending well beyond the playable room.
  box(
    g,
    [48, 0.32, 44],
    [0, -0.18, 0],
    interiorShellMat
  );


  // High ceiling so elevated WORLD camera cannot see outside.
  box(
    g,
    [48, 0.38, 44],
    [0, 18.5, 0],
    interiorShellMat
  );


  const shellWalls = [
    {
      x: 0,
      z: -22,
      w: 48,
      d: 0.45,
    },

    {
      x: 0,
      z: 22,
      w: 48,
      d: 0.45,
    },

    {
      x: -24,
      z: 0,
      w: 0.45,
      d: 44,
    },

    {
      x: 24,
      z: 0,
      w: 0.45,
      d: 44,
    },
  ];


  shellWalls.forEach(
    (wall) => {
      box(
        g,

        [
          wall.w,
          19,
          wall.d,
        ],

        [
          wall.x,
          9.5,
          wall.z,
        ],

        interiorShellMat
      );


      colliders.push({
        x:
          x
          +
          wall.x,

        z:
          z
          +
          wall.z,

        hw:
          wall.w / 2
          + 0.2,

        hd:
          wall.d / 2
          + 0.2,
      });
    }
  );


  // ----------------------------------------------------------
  // INDEPENDENT INTERIOR LIGHTING
  // ----------------------------------------------------------

  const roomAmbient =
    new THREE.AmbientLight(
      0xeaf5ff,
      1.45
    );

  g.add(
    roomAmbient
  );


  [
    [-9, -5],
    [9, -5],
    [-9, 6],
    [9, 6],
    [0, 1],
  ].forEach(
    ([
      lightX,
      lightZ,
    ]) => {
      const light =
        new THREE.PointLight(
          0xf6fbff,
          48,
          34,
          2
        );


      light.position.set(
        lightX,
        8.5,
        lightZ
      );


      light.castShadow =
        false;


      g.add(
        light
      );


      box(
        g,

        [
          3.4,
          0.08,
          1.15,
        ],

        [
          lightX,
          8.35,
          lightZ,
        ],

        material(
          0xffffff,
          {
            emissive:
              0xdff8ff,

            emissiveIntensity:
              3.2,

            roughness:
              0.12,
          }
        )
      );
    }
  );


  const accentLight =
    new THREE.PointLight(
      accent,
      28,
      32,
      2
    );


  accentLight.position.set(
    0,
    5,
    -6
  );


  g.add(
    accentLight
  );


  const floorMat =
    material(
      0x17212a,
      {
        metalness: 0.15,
        roughness: 0.58,
      }
    );

  box(
    g,
    [22, 0.2, 18],
    [0, -0.1, 0],
    floorMat
  );

  const wallMat =
    material(
      0x24303a,
      {
        metalness: 0.2,
        roughness: 0.45,
      }
    );

  const addWall =
    (
      px,
      pz,
      w,
      d,
      h = 3.5
    ) => {
      box(
        g,
        [w, h, d],
        [px, h / 2, pz],
        wallMat
      );

      colliders.push({
        x: x + px,
        z: z + pz,
        hw: w / 2 + 0.2,
        hd: d / 2 + 0.2,
      });
    };

  addWall(
    0,
    -9,
    22,
    0.35
  );

  addWall(
    -11,
    0,
    0.35,
    18
  );

  addWall(
    11,
    0,
    0.35,
    18
  );

  const trim =
    material(
      accent,
      {
        metalness: 0.7,
        roughness: 0.18,
        emissive: accent,
        emissiveIntensity:
          0.7,
      }
    );

  box(
    g,
    [21.2, 0.06, 0.08],
    [0, 2.9, -8.78],
    trim
  );

  const sign =
    textSprite(name, {
      scale:
        [7.0, 1.0, 1],
    });

  sign.position.set(
    0,
    3.5,
    -8.7
  );

  g.add(sign);

  return g;
}


const ELEVATOR_ACTIONS = [
  {
    id: "elevator:3",
    label: "Level 3",
  },
  {
    id: "elevator:2",
    label: "Level 2",
  },
  {
    id: "elevator:1",
    label: "Level 1",
  },
  {
    id: "elevator:B1",
    label: "B1 · Home Theater",
  },
  {
    id: "elevator:B2",
    label: "B2 · Music Studio",
  },
  {
    id: "elevator:B3",
    label: "B3 · Laboratory / Portal",
  },
];


function elevatorPanel(
  group,
  worldX,
  worldZ,
  localX,
  localZ
) {
  const e =
    new THREE.Group();

  e.position.set(
    localX,
    0,
    localZ
  );

  const frame =
    material(
      0x263847,
      {
        metalness: 0.9,
        roughness: 0.12,
      }
    );

  box(
    e,
    [2.8, 3.2, 0.4],
    [0, 1.6, 0],
    frame
  );

  box(
    e,
    [2.1, 2.65, 0.08],
    [0, 1.5, 0.23],
    material(
      0x111820,
      {
        metalness: 0.75,
        roughness: 0.22,
      }
    )
  );

  const glow =
    new THREE.PointLight(
      0x5ee9ff,
      7,
      5,
      2
    );

  glow.position.set(
    0,
    2.3,
    0.8
  );

  e.add(glow);

  e.userData.lifeObject =
    true;

  e.userData.id =
    `estate-elevator-${worldX}-${worldZ}`;

  e.userData.label =
    "Estate Elevator";

  e.userData.actions =
    ELEVATOR_ACTIONS;

  e.userData.approach =
    [0, 1.5];

  group.add(e);

  return e;
}


export function buildRealmLifePortalWorld(
  scene
) {
  const root =
    new THREE.Group();

  root.name =
    "RealmLifePortalNetwork";

  scene.add(root);

  // ==========================================================
  // REALMLIFE CINEMATIC MOUNTAIN RING
  // ==========================================================

  const mountains =
    new THREE.Group();

  mountains.name =
    "RealmLifeMountainRing";

  root.add(
    mountains
  );


  const mountainGeometry =
    new THREE.ConeGeometry(
      1,
      1,
      8
    );


  const mountainMats = [
    material(
      0x182124,
      {
        metalness: 0.01,
        roughness: 0.98,
      }
    ),

    material(
      0x26312d,
      {
        metalness: 0.01,
        roughness: 0.96,
      }
    ),

    material(
      0x343a3c,
      {
        metalness: 0.01,
        roughness: 0.94,
      }
    ),
  ];


  const snowMat =
    material(
      0xe5eef2,
      {
        metalness: 0,
        roughness: 0.82,
      }
    );


  const mountainCenterZ =
    45;

  const mountainRadius =
    145;

  const mountainCount =
    52;


  for (
    let i = 0;
    i < mountainCount;
    i += 1
  ) {
    const angle =
      (
        i
        / mountainCount
      )
      * Math.PI
      * 2;


    const radius =
      mountainRadius
      +
      Math.sin(
        i * 2.13
      )
      * 10;


    const height =
      42
      +
      (
        (
          i * 19
        )
        % 42
      );


    const width =
      17
      +
      (
        (
          i * 11
        )
        % 15
      );


    const depth =
      width
      * 0.85;


    const peak =
      new THREE.Mesh(
        mountainGeometry,
        mountainMats[
          i
          % mountainMats.length
        ]
      );


    peak.position.set(
      Math.cos(angle)
        * radius,

      height / 2
        - 2,

      mountainCenterZ
        +
        Math.sin(angle)
        * radius
    );


    peak.scale.set(
      width,
      height,
      depth
    );


    peak.rotation.y =
      angle
      +
      (
        i % 4
      )
      * 0.13;


    peak.castShadow =
      true;

    peak.receiveShadow =
      true;


    mountains.add(
      peak
    );


    if (
      height > 57
    ) {
      const snow =
        new THREE.Mesh(
          mountainGeometry,
          snowMat
        );


      snow.position.set(
        peak.position.x,

        height * 0.84,

        peak.position.z
      );


      snow.scale.set(
        width * 0.40,
        height * 0.27,
        depth * 0.40
      );


      snow.rotation.y =
        peak.rotation.y;


      mountains.add(
        snow
      );
    }
  }


  const community =
    portal({
      id:
        "community-central",

      label:
        "COMMUNITY CENTRAL",

      x: 0,
      z: 52,

      color:
        0x39e8ff,

      fallbackActions: [
        {
          id:
            "portal:downtown-riverwalk",
          label:
            "Downtown Riverwalk",
        },
      ],
    });

  root.add(
    community
  );

  const downtown =
    portal({
      id:
        "downtown-riverwalk",

      label:
        "DOWNTOWN CENTRAL STATION",

      x: 26,
      z: 91,

      color:
        0x8e7dff,

      fallbackActions: [
        {
          id:
            "portal:community-central",
          label:
            "Community Central",
        },
      ],
    });

  root.add(
    downtown
  );

  // ----------------------------------------------------------
  // HIGHSPEED TRAIN STATION — CONSTRUCTION FOUNDATION
  // ----------------------------------------------------------

  const train =
    new THREE.Group();

  train.position.set(
    36,
    0,
    91
  );

  root.add(train);

  const bodyMat =
    material(
      0xc8d8df,
      {
        metalness: 0.82,
        roughness: 0.16,
      }
    );

  const glassMat =
    material(
      0x204c61,
      {
        metalness: 0.35,
        roughness: 0.12,
        emissive:
          0x12394c,
        emissiveIntensity:
          0.7,
      }
    );

  for (
    let i = 0;
    i < 3;
    i++
  ) {
    const car =
      new THREE.Group();

    car.position.z =
      (i - 1) * 5.7;

    box(
      car,
      [3.4, 1.8, 5.2],
      [0, 1.2, 0],
      bodyMat
    );

    box(
      car,
      [3.15, 0.65, 3.5],
      [0, 1.55, 0],
      glassMat
    );

    train.add(car);
  }

  const construction =
    textSprite(
      "HIGH-SPEED TRAIN · UNDER CONSTRUCTION",
      {
        scale:
          [8.8, 1.1, 1],
        font: 38,
      }
    );

  construction.position.set(
    33,
    3.3,
    88
  );

  root.add(
    construction
  );

  return {
    root,

    colliders: [],

    interactives: [
      community,
      downtown,
    ],
  };
}


export function buildRealmLifeFounderEstate(
  scene
) {
  const root =
    new THREE.Group();

  root.name =
    "RealmLifeFounderEstate";

  scene.add(root);

  const colliders = [];
  const interactives = [];

  const floorSpawns = {
    "1": {
      x: 6.2,
      z: 4.2,
    },

    "2": {
      x: -70,
      z: -63,
    },

    "3": {
      x: 70,
      z: -63,
    },

    "B1": {
      x: -70,
      z: -113,
    },

    "B2": {
      x: 70,
      z: -113,
    },

    "B3": {
      x: 0,
      z: -113,
    },
  };


  // ----------------------------------------------------------
  // LEVEL 1 — GARAGE + ELEVATOR
  // ----------------------------------------------------------

  const garage =
    new THREE.Group();

  garage.position.set(
    13.5,
    0,
    5
  );

  root.add(garage);

  box(
    garage,
    [8, 0.2, 8],
    [0, -0.1, 0],
    material(
      0x26313a,
      {
        metalness: 0.18,
        roughness: 0.55,
      }
    )
  );

  box(
    garage,
    [8, 3.3, 0.3],
    [0, 1.65, -4],
    material(
      0x33414c,
      {
        metalness: 0.45,
        roughness: 0.34,
      }
    )
  );

  box(
    garage,
    [0.3, 3.3, 8],
    [4, 1.65, 0],
    material(
      0x33414c
    )
  );

  const garageSign =
    textSprite(
      "PRIVATE GARAGE",
      {
        scale:
          [4.8, 0.8, 1],
        font: 40,
      }
    );

  garageSign.position.set(
    0,
    3.5,
    -3.8
  );

  garage.add(
    garageSign
  );

  const mainElevator =
    elevatorPanel(
      root,
      0,
      0,
      7.2,
      4.8
    );

  interactives.push(
    mainElevator
  );


  // ----------------------------------------------------------
  // LEVEL 2
  // ----------------------------------------------------------

  const level2 =
    floorRoom(
      root,
      colliders,
      {
        key: "2",
        name:
          "LEVEL 2 · PRIVATE RESIDENCE",
        x: -70,
        z: -70,
        accent:
          0x66caff,
      }
    );

  box(
    level2,
    [5.4, 0.75, 2.3],
    [-3.3, 0.45, -1],
    material(
      0x315f80,
      {
        roughness: 0.4,
      }
    )
  );

  box(
    level2,
    [4.7, 0.7, 2.1],
    [3.8, 0.4, 2.2],
    material(
      0x72505d,
      {
        roughness: 0.42,
      }
    )
  );

  interactives.push(
    elevatorPanel(
      level2,
      -70,
      -70,
      8,
      5.8
    )
  );


  // ----------------------------------------------------------
  // LEVEL 3
  // ----------------------------------------------------------

  const level3 =
    floorRoom(
      root,
      colliders,
      {
        key: "3",
        name:
          "LEVEL 3 · SKY LOUNGE",
        x: 70,
        z: -70,
        accent:
          0x9c82ff,
      }
    );

  box(
    level3,
    [8, 0.65, 2.6],
    [0, 0.38, -2],
    material(
      0x503d70,
      {
        roughness: 0.35,
      }
    )
  );

  interactives.push(
    elevatorPanel(
      level3,
      70,
      -70,
      8,
      5.8
    )
  );


  // ----------------------------------------------------------
  // B1 — HOME THEATER
  // ----------------------------------------------------------

  const theater =
    floorRoom(
      root,
      colliders,
      {
        key: "B1",
        name:
          "B1 · PRIVATE CINEMA",
        x: -70,
        z: -120,
        accent:
          0xff6c85,
      }
    );

  box(
    theater,
    [13, 6.2, 0.25],
    [0, 3.1, -8.4],
    material(
      0x080b0e,
      {
        metalness: 0.1,
        roughness: 0.25,
        emissive:
          0x17334d,
        emissiveIntensity:
          0.8,
      }
    )
  );

  for (
    let row = 0;
    row < 3;
    row++
  ) {
    for (
      let seat = -2;
      seat <= 2;
      seat++
    ) {
      box(
        theater,
        [2.1, 1.15, 1.65],
        [
          seat * 2.25,
          0.6
            + row * 0.18,
          -2.6
            + row * 2.2,
        ],
        material(
          0x351a25,
          {
            roughness: 0.48,
          }
        )
      );
    }
  }

  // Concession counter.
  box(
    theater,
    [5.5, 1.1, 1.5],
    [-7.2, 0.55, 6.4],
    material(
      0x75472d,
      {
        roughness: 0.42,
      }
    )
  );

  const concession =
    textSprite(
      "CONCESSIONS",
      {
        scale:
          [3.6, 0.6, 1],
        font: 38,
      }
    );

  concession.position.set(
    -7.2,
    2.1,
    6.2
  );

  theater.add(
    concession
  );

  interactives.push(
    elevatorPanel(
      theater,
      -70,
      -120,
      8,
      5.8
    )
  );


  // ----------------------------------------------------------
  // B2 — MUSIC STUDIO
  // ----------------------------------------------------------

  const studio =
    floorRoom(
      root,
      colliders,
      {
        key: "B2",
        name:
          "B2 · RECORDING STUDIO",
        x: 70,
        z: -120,
        accent:
          0xff9d3d,
      }
    );

  // Producer desk.
  box(
    studio,
    [7.5, 0.9, 2.2],
    [0, 0.55, 3.6],
    material(
      0x2a3136,
      {
        metalness: 0.48,
        roughness: 0.28,
      }
    )
  );

  // Mixing console.
  box(
    studio,
    [6.5, 0.28, 1.65],
    [0, 1.13, 3.2],
    material(
      0x182a36,
      {
        metalness: 0.65,
        roughness: 0.2,
        emissive:
          0x1a759a,
        emissiveIntensity:
          0.55,
      }
    )
  );

  // Monitor.
  box(
    studio,
    [2.6, 1.55, 0.16],
    [0, 2.05, 2.55],
    material(
      0x061119,
      {
        emissive:
          0x135f8a,
        emissiveIntensity:
          1.1,
      }
    )
  );

  // Studio speakers.
  for (
    const sx of [-5.1, 5.1]
  ) {
    box(
      studio,
      [1.5, 3.2, 1.3],
      [sx, 1.6, 1.8],
      material(
        0x111820,
        {
          metalness: 0.35,
          roughness: 0.4,
        }
      )
    );
  }

  // Recording booth window.
  box(
    studio,
    [8, 2.9, 0.12],
    [0, 1.8, -4.3],
    material(
      0x5b91a5,
      {
        metalness: 0.2,
        roughness: 0.1,
        transparent: true,
        opacity: 0.38,
      }
    )
  );

  interactives.push(
    elevatorPanel(
      studio,
      70,
      -120,
      8,
      5.8
    )
  );


  // ----------------------------------------------------------
  // B3 — FOUNDER LAB + PRIVATE PORTAL
  // ----------------------------------------------------------

  const lab =
    floorRoom(
      root,
      colliders,
      {
        key: "B3",
        name:
          "B3 · FOUNDER LABORATORY",
        x: 0,
        z: -120,
        accent:
          0x45ff9a,
      }
    );

  for (
    const lx of [
      -7,
      -3.5,
      3.5,
      7,
    ]
  ) {
    box(
      lab,
      [2.6, 1.1, 4],
      [lx, 0.55, 1.8],
      material(
        0x25353b,
        {
          metalness: 0.62,
          roughness: 0.24,
        }
      )
    );

    const labGlow =
      new THREE.PointLight(
        0x42ffad,
        4,
        4,
        2
      );

    labGlow.position.set(
      lx,
      2.2,
      1.5
    );

    lab.add(
      labGlow
    );
  }

  // Lab containment tanks.
  for (
    const lx of [-6, 6]
  ) {
    const tank =
      new THREE.Mesh(
        new THREE.CylinderGeometry(
          1.15,
          1.15,
          3.8,
          32
        ),
        new THREE.MeshStandardMaterial({
          color:
            0x70e8d0,
          metalness:
            0.2,
          roughness:
            0.08,
          transparent:
            true,
          opacity:
            0.35,
          emissive:
            0x1b6d58,
          emissiveIntensity:
            0.55,
        })
      );

    tank.position.set(
      lx,
      1.9,
      -4.3
    );

    lab.add(tank);
  }

  const privatePortal =
    portal({
      id:
        "founder-bunker",

      label:
        "FOUNDER PRIVATE PORTAL",

      x: 0,
      z: -126,

      color:
        0x45ff9a,

      fallbackActions: [
        {
          id:
            "portal:community-central",
          label:
            "Community Central",
        },
        {
          id:
            "portal:downtown-riverwalk",
          label:
            "Downtown Riverwalk",
        },
      ],
    });

  root.add(
    privatePortal
  );

  interactives.push(
    privatePortal
  );

  interactives.push(
    elevatorPanel(
      lab,
      0,
      -120,
      8,
      5.8
    )
  );


  // ========================================================
  // REALMLIFE ESTATE FLOOR VISIBILITY AUTHORITY
  // ========================================================

  const floorGroups = {
    "2":
      level2,

    "3":
      level3,

    "B1":
      theater,

    "B2":
      studio,

    "B3":
      lab,
  };


  const interiorFloors =
    new Set(
      Object.keys(
        floorGroups
      )
    );


  const setFloor = (
    requested = "1"
  ) => {
    const floor =
      String(
        requested
        || "1"
      ).toUpperCase();


    Object.entries(
      floorGroups
    ).forEach(
      ([
        key,
        group,
      ]) => {
        group.visible =
          key === floor;
      }
    );


    const interior =
      interiorFloors.has(
        floor
      );


    // Level 1 remains part of the real exterior estate.
    garage.visible =
      !interior;

    mainElevator.visible =
      !interior;


    // The private bunker portal belongs only to B3.
    privatePortal.visible =
      floor === "B3";


    root.userData.activeFloor =
      floor;

    root.userData.isInterior =
      interior;


    return {
      floor,
      interior,
    };
  };


  // Startup is normal public RealmLife exterior.
  setFloor(
    "1"
  );


  return {
    root,
    colliders,
    interactives,
    floorSpawns,
    floorGroups,
    setFloor,

    isInteriorFloor(
      floor
    ) {
      return interiorFloors.has(
        String(
          floor
          || ""
        ).toUpperCase()
      );
    },
  };
}
