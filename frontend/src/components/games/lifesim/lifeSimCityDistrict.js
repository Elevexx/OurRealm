import * as THREE from "three";
import { installRealmLifeAAAUpgrade } from "./lifeSimAAAUpgrade";


function material(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.04,
    ...extra,
  });
}


function box(
  group,
  {
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
  }
) {
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


function plane(
  group,
  {
    x = 0,
    y = 0,
    z = 0,
    w,
    d,
    color,
    mat = null,
  }
) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    mat || material(color)
  );

  mesh.rotation.x =
    -Math.PI / 2;

  mesh.position.set(
    x,
    y,
    z
  );

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
  padding = 0.18
) {
  colliders.push({
    x,
    z,
    hw: w / 2 + padding,
    hd: d / 2 + padding,
  });
}


function rotatedCollider(
  colliders,
  bx,
  bz,
  rot,
  lx,
  lz,
  w,
  d,
  padding = 0.14
) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);

  const x =
    bx +
    lx * c +
    lz * s;

  const z =
    bz -
    lx * s +
    lz * c;

  const quarterTurn =
    Math.abs(s) > 0.7;

  collider(
    colliders,
    x,
    z,
    quarterTurn ? d : w,
    quarterTurn ? w : d,
    padding
  );
}


function addLabel(
  group,
  text,
  {
    x = 0,
    y = 3.2,
    z = 0,
    scale = 5.2,
  } = {}
) {
  const canvas =
    document.createElement("canvas");

  canvas.width = 512;
  canvas.height = 128;

  const ctx =
    canvas.getContext("2d");

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.fillStyle =
    "rgba(8,15,23,.88)";

  ctx.fillRect(
    0,
    15,
    512,
    98
  );

  ctx.strokeStyle =
    "rgba(255,145,82,.9)";

  ctx.lineWidth = 6;

  ctx.strokeRect(
    4,
    19,
    504,
    90
  );

  ctx.fillStyle = "#ffffff";

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Dynamic text fit: shrink until the label fits — never crop.
  const cityLabel =
    String(text).toUpperCase();

  let fitFont = 46;

  ctx.font =
    `900 ${fitFont}px Arial, sans-serif`;

  while (
    fitFont > 16
    && ctx.measureText(cityLabel).width > 468
  ) {
    fitFont -= 3;

    ctx.font =
      `900 ${fitFont}px Arial, sans-serif`;
  }

  ctx.fillText(
    cityLabel,
    256,
    64
  );

  const texture =
    new THREE.CanvasTexture(
      canvas
    );

  texture.minFilter =
    THREE.LinearFilter;

  const sprite =
    new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      })
    );

  sprite.position.set(
    x,
    y,
    z
  );

  sprite.scale.set(
    scale,
    scale / 4,
    1
  );

  group.add(sprite);

  return sprite;
}


function addCityTree(
  group,
  colliders,
  x,
  z,
  scale = 1
) {
  const trunk =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.16 * scale,
        0.23 * scale,
        2.15 * scale,
        9
      ),
      material(0x70472f)
    );

  trunk.position.set(
    x,
    1.075 * scale,
    z
  );

  trunk.castShadow = true;

  group.add(trunk);

  const crown =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        0.95 * scale,
        12,
        9
      ),
      material(0x3d854d)
    );

  crown.position.set(
    x,
    2.55 * scale,
    z
  );

  crown.castShadow = true;

  group.add(crown);

  collider(
    colliders,
    x,
    z,
    0.5 * scale,
    0.5 * scale,
    0.08
  );
}


function addCityLight(
  group,
  colliders,
  x,
  z
) {
  const pole =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.07,
        0.1,
        4.4,
        8
      ),
      material(
        0x272d34,
        {
          metalness: 0.55,
          roughness: 0.4,
        }
      )
    );

  pole.position.set(
    x,
    2.2,
    z
  );

  pole.castShadow = true;

  group.add(pole);

  box(group, {
    x,
    y: 4.37,
    z,
    w: 0.65,
    h: 0.11,
    d: 0.65,
    color: 0x343b42,
  });

  const lamp =
    new THREE.PointLight(
      0xffc783,
      0,
      9,
      2
    );

  lamp.position.set(
    x,
    4.15,
    z
  );

  lamp.userData.lifeStreetLight =
    true;

  group.add(lamp);

  collider(
    colliders,
    x,
    z,
    0.28,
    0.28,
    0.05
  );
}


const FACING_ROTATION = {
  south: 0,
  east: -Math.PI / 2,
  north: Math.PI,
  west: Math.PI / 2,
};


function addOpenBuilding(
  group,
  colliders,
  registry,
  {
    id,
    label,
    type,

    x,
    z,

    w = 12,
    d = 9,

    facing = "south",

    color = 0xd8d1c2,
    floorColor = 0xb99f7d,
    accent = 0x426d81,

    towerLevels = 0,
  }
) {
  const building =
    new THREE.Group();

  building.name =
    `RealmLifeBuilding:${id}`;

  building.position.set(
    x,
    0,
    z
  );

  const rot =
    FACING_ROTATION[facing] ?? 0;

  building.rotation.y =
    rot;

  building.userData = {
    buildingId: id,
    buildingLabel: label,
    buildingType: type,

    enterable: true,
    interactionReady: true,
  };

  group.add(building);

  const wallH = 3.0;
  const wallT = 0.25;

  const halfW = w / 2;
  const halfD = d / 2;

  // local building geometry

  // Floor.
  box(building, {
    y: 0.025,
    w,
    h: 0.12,
    d,
    color: floorColor,
    cast: false,
  });


  // Back wall.
  box(building, {
    z: halfD,
    w,
    h: wallH,
    d: wallT,
    color,
  });

  rotatedCollider(
    colliders,
    x,
    z,
    rot,
    0,
    halfD,
    w,
    wallT
  );


  // Side walls.
  box(building, {
    x: -halfW,
    w: wallT,
    h: wallH,
    d,
    color,
  });

  rotatedCollider(
    colliders,
    x,
    z,
    rot,
    -halfW,
    0,
    wallT,
    d
  );

  box(building, {
    x: halfW,
    w: wallT,
    h: wallH,
    d,
    color,
  });

  rotatedCollider(
    colliders,
    x,
    z,
    rot,
    halfW,
    0,
    wallT,
    d
  );


  // Wide open storefront entrance.
  const doorWidth =
    Math.min(
      3.2,
      w * 0.34
    );

  const sidePiece =
    (w - doorWidth) / 2;


  box(building, {
    x:
      -(
        doorWidth / 2 +
        sidePiece / 2
      ),
    z: -halfD,
    w: sidePiece,
    h: wallH,
    d: wallT,
    color,
  });

  rotatedCollider(
    colliders,
    x,
    z,
    rot,
    -(
      doorWidth / 2 +
      sidePiece / 2
    ),
    -halfD,
    sidePiece,
    wallT
  );


  box(building, {
    x:
      doorWidth / 2 +
      sidePiece / 2,
    z: -halfD,
    w: sidePiece,
    h: wallH,
    d: wallT,
    color,
  });

  rotatedCollider(
    colliders,
    x,
    z,
    rot,
    doorWidth / 2 +
      sidePiece / 2,
    -halfD,
    sidePiece,
    wallT
  );


  // Door frame / accent.
  box(building, {
    x: -doorWidth / 2,
    y: 1.35,
    z: -halfD - 0.03,
    w: 0.12,
    h: 2.65,
    d: 0.18,
    color: accent,
  });

  box(building, {
    x: doorWidth / 2,
    y: 1.35,
    z: -halfD - 0.03,
    w: 0.12,
    h: 2.65,
    d: 0.18,
    color: accent,
  });

  box(building, {
    y: 2.65,
    z: -halfD - 0.03,
    w: doorWidth + 0.12,
    h: 0.12,
    d: 0.18,
    color: accent,
  });


  // Simple prototype counter / furnishing.
  box(building, {
    x: 0,
    y: 0.48,
    z: 1.45,
    w: Math.min(4.4, w * 0.42),
    h: 0.85,
    d: 0.8,
    color: accent,
  });

  rotatedCollider(
    colliders,
    x,
    z,
    rot,
    0,
    1.45,
    Math.min(4.4, w * 0.42),
    0.8,
    0.08
  );


  // Upper tower mass.
  // Ground floor remains physically enterable.
  if (towerLevels > 0) {
    const upperH =
      Math.max(
        4,
        towerLevels * 2.1
      );

    box(building, {
      y:
        3 +
        upperH / 2,
      w: w * 0.92,
      h: upperH,
      d: d * 0.92,
      color,
    });

    // Window bands.
    for (
      let yy = 4.1;
      yy <
      3 + upperH;
      yy += 2.1
    ) {
      box(building, {
        y: yy,
        z:
          -halfD * 0.93,
        w: w * 0.72,
        h: 0.55,
        d: 0.06,
        color: 0x5e94a7,
        cast: false,
      });
    }
  }


  const storefrontSign =
    addLabel(
      building,
      label,
      {
        y: 2.68,
        z: -halfD - 0.2,
        scale:
          Math.min(
            6.2,
            Math.max(
              4.4,
              label.length * 0.38
            )
          ),
      }
    );

  // GENESIS CITY:
  // Business ownership interaction belongs to the SIGN,
  // never the entire building/interior.
  storefrontSign.userData.businessSignFor =
    id;

  storefrontSign.userData.businessSignLabel =
    label;


  registry.push({
    id,
    label,
    type,
    x,
    z,
    facing,
    enterable: true,
  });

  return building;
}


function addRiverBarrierSegment(
  group,
  colliders,
  x,
  w,
  z
) {
  if (w <= 0) return;

  // Decorative low railing.
  box(group, {
    x,
    y: 0.42,
    z,
    w,
    h: 0.75,
    d: 0.12,
    color: 0x46515b,
  });

  collider(
    colliders,
    x,
    z,
    w,
    0.18,
    0.08
  );
}


export function buildCityDistrict(
  neighborhoodRoot,
  colliders
) {
  const city =
    new THREE.Group();

  city.name =
    "RealmLifeCityDistrictV1";

  neighborhoodRoot.add(city);

  const buildings = [];


  // ==========================================================
  // CITY TERRAIN
  // Extends the existing neighborhood northward.
  // ==========================================================

  plane(city, {
    x: 0,
    y: -0.045,
    z: 89.5,
    w: 90,
    d: 91,
    color: 0x6b995c,
  });


  // ==========================================================
  // MAIN STREET
  // North / south connector from the home district.
  // ==========================================================

  const MAIN_X = -14;


  // South section.
  plane(city, {
    x: MAIN_X,
    y: 0.008,
    z: 66,
    w: 10,
    d: 72,
    color: 0x383d42,
  });

  // Main Street sidewalks.
  plane(city, {
    x: MAIN_X - 6.2,
    y: 0.02,
    z: 66,
    w: 2.1,
    d: 72,
    color: 0xc7c5bd,
  });

  plane(city, {
    x: MAIN_X + 6.2,
    y: 0.02,
    z: 66,
    w: 2.1,
    d: 72,
    color: 0xc7c5bd,
  });


  // Center road markings.
  for (
    let z = 32;
    z <= 98;
    z += 6
  ) {
    box(city, {
      x: MAIN_X,
      y: 0.038,
      z,
      w: 0.17,
      h: 0.025,
      d: 3.0,
      color: 0xe4ca52,
      cast: false,
    });
  }


  // Commercial crosswalk.
  for (
    let x = MAIN_X - 4.1;
    x <= MAIN_X + 4.1;
    x += 1.2
  ) {
    box(city, {
      x,
      y: 0.041,
      z: 53,
      w: 0.58,
      h: 0.025,
      d: 4,
      color: 0xe7e7e1,
      cast: false,
    });
  }


  addLabel(
    city,
    "Main Street",
    {
      x: MAIN_X + 6,
      y: 4.6,
      z: 34,
      scale: 7.2,
    }
  );


  // ==========================================================
  // MAIN STREET COMMERCIAL BUILDINGS
  // All ground floors have real doorway openings.
  // ==========================================================

  addOpenBuilding(
    city,
    colliders,
    buildings,
    {
      id: "main-market",
      label: "Market",
      type: "market",

      x: -28.5,
      z: 50,

      w: 13,
      d: 10,

      facing: "east",

      color: 0xd8c49f,
      floorColor: 0xbda47f,
      accent: 0xd47c3e,
    }
  );


  addOpenBuilding(
    city,
    colliders,
    buildings,
    {
      id: "sunrise-cafe",
      label: "Sunrise Café",
      type: "cafe",

      x: 0.5,
      z: 50,

      w: 12,
      d: 9,

      facing: "west",

      color: 0x101820,
      floorColor: 0x18212a,
      accent: 0x2ee6ff,
    }
  );

  // ========================================================
  // GENESIS CITY — SUNRISE CAFÉ AAA DEFAULT INTERIOR
  //
  // Social / creator hangout only.
  // No hunger, needs or paid visitor interactions.
  // ========================================================

  const sunriseCafe =
    city.children.find(
      (child) =>
        child?.userData?.buildingId ===
        "sunrise-cafe"
    );

  if (sunriseCafe) {
    const CYAN = 0x2ee6ff;
    const MAGENTA = 0xd94cff;
    const GRAPHITE = 0x121922;
    const DARK = 0x080d14;
    const SOFT = 0xdce8ee;
    const GREEN = 0x43d18a;

    // Back service wall.
    box(sunriseCafe, {
      x: 0,
      y: 1.45,
      z: 4.15,
      w: 7.8,
      h: 2.35,
      d: 0.12,
      color: GRAPHITE,
    });

    // Neon menu board.
    box(sunriseCafe, {
      x: 0,
      y: 2.05,
      z: 4.03,
      w: 4.6,
      h: 0.78,
      d: 0.08,
      color: DARK,
      cast: false,
    });

    // Menu-board cyan edge.
    box(sunriseCafe, {
      x: 0,
      y: 2.48,
      z: 3.98,
      w: 4.75,
      h: 0.07,
      d: 0.11,
      color: CYAN,
      cast: false,
    });

    // Premium service counter overlay.
    box(sunriseCafe, {
      x: 0,
      y: 0.62,
      z: 1.45,
      w: 4.8,
      h: 0.18,
      d: 1.05,
      color: GRAPHITE,
    });

    // Counter neon strip.
    box(sunriseCafe, {
      x: 0,
      y: 0.72,
      z: 0.91,
      w: 4.55,
      h: 0.07,
      d: 0.05,
      color: CYAN,
      cast: false,
    });

    // Register / smart display.
    box(sunriseCafe, {
      x: 1.45,
      y: 1.05,
      z: 1.42,
      w: 0.72,
      h: 0.62,
      d: 0.12,
      color: DARK,
    });

    box(sunriseCafe, {
      x: 1.45,
      y: 1.05,
      z: 1.34,
      w: 0.58,
      h: 0.46,
      d: 0.04,
      color: CYAN,
      cast: false,
    });

    // Café tables.
    const tablePositions = [
      [-3.4, -1.6],
      [0, -1.7],
      [3.4, -1.6],
    ];

    tablePositions.forEach(
      ([tx, tz], index) => {
        box(sunriseCafe, {
          x: tx,
          y: 0.73,
          z: tz,
          w: 1.55,
          h: 0.12,
          d: 1.05,
          color:
            index === 1
              ? MAGENTA
              : CYAN,
        });

        box(sunriseCafe, {
          x: tx,
          y: 0.36,
          z: tz,
          w: 0.18,
          h: 0.72,
          d: 0.18,
          color: GRAPHITE,
        });

        // Two interactive café chairs per table.
        [-0.95, 0.95].forEach(
          (chairOffset, sideIndex) => {
            const chair =
              new THREE.Group();

            chair.position.set(
              tx + chairOffset,
              0,
              tz
            );

            chair.userData.genesisInteractiveId =
              `sunrise-chair-${index}-${sideIndex}`;

            chair.userData.genesisInteractiveLabel =
              "Sunrise Café Chair";

            chair.userData.genesisInteractiveActions =
              [
                {
                  id: "sit",
                  label: "Sit & Relax",
                },
              ];

            // Route directly to the seat's true world position.
            chair.userData.genesisInteractiveApproach =
              [0, 0];

            chair.userData.genesisInteractionAnchor =
              {
                x: 0,
                y: 0,
                z: 0,
              };

            sunriseCafe.add(chair);

            box(chair, {
              x: 0,
              y: 0.42,
              z: 0,
              w: 0.62,
              h: 0.62,
              d: 0.62,
              color: GRAPHITE,
            });

            box(chair, {
              x: 0,
              y: 0.82,
              z: 0.25,
              w: 0.62,
              h: 0.72,
              d: 0.12,
              color: GRAPHITE,
            });
          }
        );
      }
    );

    // Interactive lounge sofa along side wall.
    const sunriseLounge =
      new THREE.Group();

    sunriseLounge.position.set(
      -4.65,
      0,
      1.15
    );

    sunriseLounge.userData.genesisInteractiveId =
      "sunrise-lounge";

    sunriseLounge.userData.genesisInteractiveLabel =
      "Sunrise Café Lounge";

    sunriseLounge.userData.genesisInteractiveActions =
      [
        {
          id: "sit",
          label: "Sit & Relax",
        },
      ];

    sunriseLounge.userData.genesisInteractiveApproach =
      [0, 0];

    sunriseLounge.userData.genesisInteractionAnchor =
      {
        x: 0,
        y: 0,
        z: 0,
      };

    sunriseCafe.add(
      sunriseLounge
    );

    box(sunriseLounge, {
      x: 0,
      y: 0.42,
      z: 0,
      w: 1.05,
      h: 0.62,
      d: 3.6,
      color: 0x202936,
    });

    box(sunriseLounge, {
      x: -0.43,
      y: 0.88,
      z: 0,
      w: 0.18,
      h: 0.92,
      d: 3.6,
      color: MAGENTA,
    });

    // Interactive cyber planter.
    const sunrisePlanter =
      new THREE.Group();

    sunrisePlanter.position.set(
      4.65,
      0,
      2.85
    );

    sunrisePlanter.userData.genesisInteractiveId =
      "sunrise-planter";

    sunrisePlanter.userData.genesisInteractiveLabel =
      "Cyber Planter";

    sunrisePlanter.userData.genesisInteractiveActions =
      [
        {
          id: "admire",
          label: "Admire",
        },
      ];

    sunrisePlanter.userData.genesisInteractiveApproach =
      [0, 0];

    sunriseCafe.add(
      sunrisePlanter
    );

    box(sunrisePlanter, {
      x: 0,
      y: 0.34,
      z: 0,
      w: 0.8,
      h: 0.68,
      d: 0.8,
      color: GRAPHITE,
    });

    box(sunrisePlanter, {
      x: 0,
      y: 0.88,
      z: 0,
      w: 0.42,
      h: 0.82,
      d: 0.42,
      color: GREEN,
    });

    // Ceiling neon rails.
    [-2.7, 0, 2.7].forEach(
      (railX, index) => {
        box(sunriseCafe, {
          x: railX,
          y: 2.82,
          z: 0.2,
          w: 0.09,
          h: 0.05,
          d: 6.3,
          color:
            index === 1
              ? MAGENTA
              : CYAN,
          cast: false,
        });
      }
    );

    // Small café identity panel inside.
    addLabel(
      sunriseCafe,
      "SUNRISE",
      {
        x: 0,
        y: 1.35,
        z: 3.94,
        scale: 4.2,
      }
    );

    sunriseCafe.userData.aaaInterior =
      "sunrise-cafe-v1";
  }


  addOpenBuilding(
    city,
    colliders,
    buildings,
    {
      id: "city-outfitters",
      label: "Outfitters",
      type: "clothing_shop",

      x: -28.5,
      z: 68,

      w: 13,
      d: 10,

      facing: "east",

      color: 0xd9cbd9,
      floorColor: 0xb7a394,
      accent: 0x775381,
    }
  );


  addOpenBuilding(
    city,
    colliders,
    buildings,
    {
      id: "plaza-restaurant",
      label: "Restaurant",
      type: "restaurant",

      x: 0.5,
      z: 68,

      w: 13,
      d: 10,

      facing: "west",

      color: 0xdcc8b5,
      floorColor: 0xb89d82,
      accent: 0x984d3e,
    }
  );


  addOpenBuilding(
    city,
    colliders,
    buildings,
    {
      id: "fresh-grocery",
      label: "Grocery",
      type: "grocery",

      x: -28.5,
      z: 86,

      w: 13,
      d: 10,

      facing: "east",

      color: 0xcdd7bc,
      floorColor: 0xaea487,
      accent: 0x548348,
    }
  );


  addOpenBuilding(
    city,
    colliders,
    buildings,
    {
      id: "night-lounge",
      label: "Night Lounge",
      type: "nightclub",

      x: 0.5,
      z: 86,

      w: 13,
      d: 10,

      facing: "west",

      color: 0x332d46,
      floorColor: 0x262331,
      accent: 0x934bd4,
    }
  );


  // ==========================================================
  // SMALL DOWNTOWN PLAZA
  // ==========================================================

  plane(city, {
    x: 22,
    y: 0.015,
    z: 78,
    w: 27,
    d: 26,
    color: 0xbab4a4,
  });

  plane(city, {
    x: 22,
    y: 0.021,
    z: 78,
    w: 5,
    d: 24,
    color: 0xd0c6af,
  });

  plane(city, {
    x: 22,
    y: 0.023,
    z: 78,
    w: 25,
    d: 4,
    color: 0xd0c6af,
  });

  addLabel(
    city,
    "Downtown",
    {
      x: 22,
      y: 4.5,
      z: 78,
      scale: 7.5,
    }
  );


  for (const [x, z, s] of [
    [13, 69, 0.9],
    [31, 69, 1.0],
    [13, 87, 1.0],
    [31, 87, 0.9],
  ]) {
    addCityTree(
      city,
      colliders,
      x,
      z,
      s
    );
  }


  // ==========================================================
  // RIVER
  // ==========================================================

  const riverMat =
    material(
      0x2b7896,
      {
        roughness: 0.25,
        metalness: 0.12,
        transparent: true,
        opacity: 0.9,
      }
    );

  plane(city, {
    x: 0,
    y: 0.004,
    z: 106,
    w: 90,
    d: 10,
    color: 0x2b7896,
    mat: riverMat,
  });


  // South Riverwalk.
  plane(city, {
    x: 0,
    y: 0.022,
    z: 98.5,
    w: 90,
    d: 4.5,
    color: 0xc8bda8,
  });


  // North Riverwalk.
  plane(city, {
    x: 0,
    y: 0.022,
    z: 113.5,
    w: 90,
    d: 4.5,
    color: 0xc8bda8,
  });


  addLabel(
    city,
    "Riverwalk",
    {
      x: 18,
      y: 4.2,
      z: 97,
      scale: 7.8,
    }
  );


  // ==========================================================
  // TWO WALKABLE BRIDGES
  // ==========================================================

  // Main Street bridge.
  plane(city, {
    x: MAIN_X,
    y: 0.046,
    z: 106,
    w: 10,
    d: 13,
    color: 0x737b82,
  });


  // Pedestrian Riverwalk bridge.
  plane(city, {
    x: 24,
    y: 0.052,
    z: 106,
    w: 8,
    d: 13,
    color: 0xa69c89,
  });


  // North Main Street continuation.
  plane(city, {
    x: MAIN_X,
    y: 0.008,
    z: 123,
    w: 10,
    d: 22,
    color: 0x383d42,
  });

  plane(city, {
    x: MAIN_X - 6.2,
    y: 0.02,
    z: 123,
    w: 2.1,
    d: 22,
    color: 0xc7c5bd,
  });

  plane(city, {
    x: MAIN_X + 6.2,
    y: 0.02,
    z: 123,
    w: 2.1,
    d: 22,
    color: 0xc7c5bd,
  });


  // ==========================================================
  // WATER COLLISION
  //
  // River is blocked except at the two bridges.
  // ==========================================================

  collider(
    colliders,
    -31.5,
    106,
    25,
    10,
    0
  );

  collider(
    colliders,
    5.5,
    106,
    29,
    10,
    0
  );

  collider(
    colliders,
    36,
    106,
    16,
    10,
    0
  );


  // River railings — same bridge gaps.
  for (const railZ of [
    100.8,
    111.2,
  ]) {
    addRiverBarrierSegment(
      city,
      colliders,
      -31.5,
      25,
      railZ
    );

    addRiverBarrierSegment(
      city,
      colliders,
      5.5,
      29,
      railZ
    );

    addRiverBarrierSegment(
      city,
      colliders,
      36,
      16,
      railZ
    );
  }


  // ==========================================================
  // RIVERWALK BUSINESSES
  // ==========================================================

  addOpenBuilding(
    city,
    colliders,
    buildings,
    {
      id: "river-grill",
      label: "River Grill",
      type: "restaurant",

      x: 15,
      z: 91,

      w: 13,
      d: 9,

      facing: "north",

      color: 0xe2c8a7,
      floorColor: 0xb89b79,
      accent: 0xc9673f,
    }
  );


  addOpenBuilding(
    city,
    colliders,
    buildings,
    {
      id: "pulse-club",
      label: "Club 178",
      type: "nightclub",

      x: 33,
      z: 91,

      w: 13,
      d: 9,

      facing: "north",

      color: 0x272b42,
      floorColor: 0x202331,
      accent: 0x2ee6ff,
    }
  );


  // ==========================================================
  // DOWNTOWN TOWERS
  // Enterable lobby + prototype upper floors.
  // ==========================================================

  addOpenBuilding(
    city,
    colliders,
    buildings,
    {
      id: "river-condos",
      label: "River Condos",
      type: "condo",

      x: 2,
      z: 125,

      w: 15,
      d: 12,

      facing: "south",

      color: 0x9aaab5,
      floorColor: 0xa99d8c,
      accent: 0x4f819d,

      towerLevels: 5,
    }
  );


  addOpenBuilding(
    city,
    colliders,
    buildings,
    {
      id: "central-offices",
      label: "Central Offices",
      type: "office",

      x: 22,
      z: 125,

      w: 15,
      d: 12,

      facing: "south",

      color: 0x75858f,
      floorColor: 0x9d968a,
      accent: 0x496673,

      towerLevels: 7,
    }
  );


  addOpenBuilding(
    city,
    colliders,
    buildings,
    {
      id: "river-hotel",
      label: "River Hotel",
      type: "hotel",

      x: 39,
      z: 124,

      w: 10,
      d: 12,

      facing: "south",

      color: 0xb89f87,
      floorColor: 0xa79077,
      accent: 0xd28750,

      towerLevels: 6,
    }
  );


  // ==========================================================
  // CITY STREETLIGHTS
  // ==========================================================

  for (const z of [
    38,
    56,
    74,
    92,
    118,
    130,
  ]) {
    addCityLight(
      city,
      colliders,
      MAIN_X - 6.4,
      z
    );

    addCityLight(
      city,
      colliders,
      MAIN_X + 6.4,
      z + 4
    );
  }


  // Riverwalk lights.
  for (const x of [
    -38,
    -26,
    -2,
    10,
    36,
  ]) {
    addCityLight(
      city,
      colliders,
      x,
      97.5
    );
  }


  // ==========================================================
  // CITY REGISTRY
  // Foundation for later shops, schedules, ownership,
  // NPC employment, apartments and multiplayer.
  // ==========================================================

  const registry = {
    districtId:
      "downtown-riverwalk-v1",

    label:
      "Downtown Riverwalk",

    buildings,

    pois: [
      {
        id: "main-street",
        type: "street",
        x: MAIN_X,
        z: 66,
      },
      {
        id: "downtown-plaza",
        type: "plaza",
        x: 22,
        z: 78,
      },
      {
        id: "riverwalk",
        type: "promenade",
        x: 18,
        z: 98.5,
      },
      {
        id: "main-bridge",
        type: "bridge",
        x: MAIN_X,
        z: 106,
      },
      {
        id: "pedestrian-bridge",
        type: "bridge",
        x: 24,
        z: 106,
      },
    ],
  };

  city.userData.realmLifeDistrict =
    registry;

  neighborhoodRoot.userData
    .realmLifeCity =
    registry;

  installRealmLifeAAAUpgrade(city);

  return {
    root: city,
    registry,
  };
}
