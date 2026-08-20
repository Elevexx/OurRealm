import * as THREE from "three";
import { installRealmLifeAAAUpgrade } from "./lifeSimAAAUpgrade";
import { installRealmLifeGenesisExpansion } from "./lifeSimGenesisExpansion";


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
    color: 0x252b34,
  });

  plane(city, {
    x: MAIN_X + 6.2,
    y: 0.02,
    z: 66,
    w: 2.1,
    d: 72,
    color: 0x252b34,
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
      color: 0x9fb0bd,
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
      label: "Realm Market",
      type: "market",

      x: -28.5,
      z: 50,

      w: 13,
      d: 10,

      facing: "east",

      color: 0x101820,
      floorColor: 0x161d26,
      accent: 0xff8a3d,
    }
  );

  // ========================================================
  // GENESIS CITY — REALM MARKET AAA DEFAULT INTERIOR
  //
  // Free social storefront / browsing space.
  // No survival shopping, money system or visitor fees.
  // ========================================================

  const mainMarket =
    city.children.find(
      (child) =>
        child?.userData?.buildingId ===
        "main-market"
    );

  if (mainMarket) {
    const CYAN = 0x2ee6ff;
    const ORANGE = 0xff8a3d;
    const GRAPHITE = 0x121922;
    const DARK = 0x080d14;
    const SOFT = 0xdce8ee;

    // Premium rear feature wall.
    box(mainMarket, {
      x: 0,
      y: 1.45,
      z: 4.68,
      w: 9.2,
      h: 2.35,
      d: 0.12,
      color: GRAPHITE,
    });

    // Rear neon header.
    box(mainMarket, {
      x: 0,
      y: 2.52,
      z: 4.59,
      w: 7.2,
      h: 0.08,
      d: 0.08,
      color: ORANGE,
      cast: false,
    });

    addLabel(
      mainMarket,
      "REALM MARKET",
      {
        x: 0,
        y: 2.03,
        z: 4.54,
        scale: 4.8,
      }
    );

    // Upgrade the existing prototype checkout counter.
    box(mainMarket, {
      x: 0,
      y: 0.63,
      z: 1.45,
      w: 4.9,
      h: 0.18,
      d: 1.08,
      color: GRAPHITE,
    });

    box(mainMarket, {
      x: 0,
      y: 0.73,
      z: 0.90,
      w: 4.65,
      h: 0.07,
      d: 0.05,
      color: ORANGE,
      cast: false,
    });

    // Interactive smart market kiosk.
    const marketKiosk =
      new THREE.Group();

    marketKiosk.position.set(
      1.45,
      0,
      1.42
    );

    marketKiosk.userData.genesisInteractiveId =
      "realm-market-kiosk";

    marketKiosk.userData.genesisInteractiveLabel =
      "Realm Market Smart Kiosk";

    marketKiosk.userData.genesisInteractiveActions =
      [
        {
          id: "explore_market",
          label: "Explore Market",
        },
      ];

    marketKiosk.userData.genesisInteractiveApproachLocal =
      [0, -0.9];

    mainMarket.add(
      marketKiosk
    );

    box(marketKiosk, {
      x: 0,
      y: 1.05,
      z: 0,
      w: 0.72,
      h: 0.62,
      d: 0.12,
      color: DARK,
    });

    box(marketKiosk, {
      x: 0,
      y: 1.05,
      z: -0.08,
      w: 0.58,
      h: 0.46,
      d: 0.04,
      color: CYAN,
      cast: false,
    });

    // Four premium display shelves.
    const marketShelves = [
      [-4.15, -1.15],
      [-4.15, 2.05],
      [4.15, -1.15],
      [4.15, 2.05],
    ];

    marketShelves.forEach(
      ([sx, sz], index) => {
        const shelf =
          new THREE.Group();

        shelf.position.set(
          sx,
          0,
          sz
        );

        shelf.userData.genesisInteractiveId =
          `realm-market-shelf-${index}`;

        shelf.userData.genesisInteractiveLabel =
          `Realm Market Display ${index + 1}`;

        shelf.userData.genesisInteractiveActions =
          [
            {
              id: "browse_market",
              label: "Browse Display",
            },
          ];

        shelf.userData.genesisInteractiveApproachLocal =
          [0, -1.05];

        mainMarket.add(
          shelf
        );

        // Main shelf body.
        box(shelf, {
          x: 0,
          y: 0.92,
          z: 0,
          w: 2.35,
          h: 1.82,
          d: 0.68,
          color: GRAPHITE,
        });

        // Three display tiers.
        [0.38, 0.92, 1.46].forEach(
          (yy, tierIndex) => {
            box(shelf, {
              x: 0,
              y: yy,
              z: -0.37,
              w: 2.18,
              h: 0.07,
              d: 0.10,
              color:
                (
                  index + tierIndex
                ) % 2 === 0
                  ? CYAN
                  : ORANGE,
              cast: false,
            });
          }
        );

        // Product/display blocks.
        [-0.72, 0, 0.72].forEach(
          (px, productIndex) => {
            box(shelf, {
              x: px,
              y:
                0.66
                +
                (
                  productIndex
                  % 2
                ) * 0.52,
              z: -0.45,
              w: 0.34,
              h: 0.42,
              d: 0.22,
              color:
                productIndex === 1
                  ? SOFT
                  : ORANGE,
            });
          }
        );
      }
    );

    // Interactive central holographic product pedestal.
    const marketHologram =
      new THREE.Group();

    marketHologram.position.set(
      0,
      0,
      -1.55
    );

    marketHologram.userData.genesisInteractiveId =
      "realm-market-hologram";

    marketHologram.userData.genesisInteractiveLabel =
      "Realm Market Hologram";

    marketHologram.userData.genesisInteractiveActions =
      [
        {
          id: "view_market_hologram",
          label: "View Hologram",
        },
      ];

    marketHologram.userData.genesisInteractiveApproachLocal =
      [0, -1.25];

    mainMarket.add(
      marketHologram
    );

    box(marketHologram, {
      x: 0,
      y: 0.22,
      z: 0,
      w: 1.55,
      h: 0.44,
      d: 1.55,
      color: GRAPHITE,
    });

    box(marketHologram, {
      x: 0,
      y: 0.49,
      z: 0,
      w: 1.18,
      h: 0.08,
      d: 1.18,
      color: CYAN,
      cast: false,
    });

    box(marketHologram, {
      x: 0,
      y: 1.12,
      z: 0,
      w: 0.48,
      h: 1.15,
      d: 0.48,
      color: ORANGE,
      cast: false,
    });

    // Interactive social bench.
    const marketLounge =
      new THREE.Group();

    marketLounge.position.set(
      -5.15,
      0,
      -3.25
    );

    marketLounge.userData.genesisInteractiveId =
      "realm-market-lounge";

    marketLounge.userData.genesisInteractiveLabel =
      "Realm Market Lounge";

    marketLounge.userData.genesisInteractiveActions =
      [
        {
          id: "sit",
          label: "Sit & Relax",
        },
      ];

    marketLounge.userData.genesisInteractiveApproach =
      [0, 0];

    marketLounge.userData.genesisInteractionAnchor =
      {
        x: 0,
        y: 0,
        z: 0,
      };

    mainMarket.add(
      marketLounge
    );

    box(marketLounge, {
      x: 0,
      y: 0.42,
      z: 0,
      w: 0.95,
      h: 0.62,
      d: 2.45,
      color: 0x202936,
    });

    box(marketLounge, {
      x: -0.39,
      y: 0.86,
      z: 0,
      w: 0.16,
      h: 0.86,
      d: 2.45,
      color: CYAN,
    });

    // Ceiling neon rails.
    [-3.3, 0, 3.3].forEach(
      (railX, index) => {
        box(mainMarket, {
          x: railX,
          y: 2.82,
          z: 0,
          w: 0.09,
          h: 0.05,
          d: 7.3,
          color:
            index === 1
              ? ORANGE
              : CYAN,
          cast: false,
        });
      }
    );

    mainMarket.userData.aaaInterior =
      "realm-market-v1";
  }


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
      label: "City Outfitters",
      type: "clothing_shop",

      x: -28.5,
      z: 68,

      w: 13,
      d: 10,

      facing: "east",

      color: 0x10141d,
      floorColor: 0x171b24,
      accent: 0xd946ef,
    }
  );

  // ========================================================
  // GENESIS CITY — CITY OUTFITTERS AAA DEFAULT INTERIOR
  //
  // Social fashion showroom / creator hangout.
  // No shopping economy, survival needs or visitor fees.
  // ========================================================

  const cityOutfitters =
    city.children.find(
      (child) =>
        child?.userData?.buildingId ===
        "city-outfitters"
    );

  if (cityOutfitters) {
    const CYAN = 0x2ee6ff;
    const MAGENTA = 0xd946ef;
    const GRAPHITE = 0x121722;
    const DARK = 0x080b12;

    // Premium rear feature wall.
    box(cityOutfitters, {
      x: 0,
      y: 1.45,
      z: 4.68,
      w: 9.4,
      h: 2.35,
      d: 0.12,
      color: GRAPHITE,
    });

    // Neon fashion header.
    box(cityOutfitters, {
      x: 0,
      y: 2.52,
      z: 4.59,
      w: 7.4,
      h: 0.08,
      d: 0.08,
      color: MAGENTA,
      cast: false,
    });

    addLabel(
      cityOutfitters,
      "CITY OUTFITTERS",
      {
        x: 0,
        y: 2.03,
        z: 4.54,
        scale: 4.35,
      }
    );

    // Left interactive illuminated mirror wall.
    const outfittersMirrorLeft =
      new THREE.Group();

    outfittersMirrorLeft.position.set(
      -4.65,
      0,
      1.45
    );

    outfittersMirrorLeft.userData.genesisInteractiveId =
      "city-outfitters-mirror-left";

    outfittersMirrorLeft.userData.genesisInteractiveLabel =
      "City Outfitters Mirror";

    outfittersMirrorLeft.userData.genesisInteractiveActions =
      [
        {
          id: "view_look",
          label: "View Look",
        },
      ];

    // Stand inside the showroom facing the left wall mirror.
    outfittersMirrorLeft.userData.genesisInteractiveApproachLocal =
      [1.0, 0];

    cityOutfitters.add(
      outfittersMirrorLeft
    );

    box(outfittersMirrorLeft, {
      x: 0,
      y: 1.35,
      z: 0,
      w: 0.10,
      h: 2.45,
      d: 2.55,
      color: DARK,
    });

    box(outfittersMirrorLeft, {
      x: 0.08,
      y: 1.35,
      z: 0,
      w: 0.04,
      h: 2.15,
      d: 2.15,
      color: CYAN,
      cast: false,
    });

    // Right interactive illuminated mirror wall.
    const outfittersMirrorRight =
      new THREE.Group();

    outfittersMirrorRight.position.set(
      4.65,
      0,
      1.45
    );

    outfittersMirrorRight.userData.genesisInteractiveId =
      "city-outfitters-mirror-right";

    outfittersMirrorRight.userData.genesisInteractiveLabel =
      "City Outfitters Mirror";

    outfittersMirrorRight.userData.genesisInteractiveActions =
      [
        {
          id: "view_look",
          label: "View Look",
        },
      ];

    // Stand inside the showroom facing the right wall mirror.
    outfittersMirrorRight.userData.genesisInteractiveApproachLocal =
      [-1.0, 0];

    cityOutfitters.add(
      outfittersMirrorRight
    );

    box(outfittersMirrorRight, {
      x: 0,
      y: 1.35,
      z: 0,
      w: 0.10,
      h: 2.45,
      d: 2.55,
      color: DARK,
    });

    box(outfittersMirrorRight, {
      x: -0.08,
      y: 1.35,
      z: 0,
      w: 0.04,
      h: 2.15,
      d: 2.15,
      color: MAGENTA,
      cast: false,
    });

    // Interactive central fashion showcase platform.
    const outfittersShowcase =
      new THREE.Group();

    outfittersShowcase.position.set(
      0,
      0,
      0.25
    );

    outfittersShowcase.userData.genesisInteractiveId =
      "city-outfitters-showcase";

    outfittersShowcase.userData.genesisInteractiveLabel =
      "City Outfitters Showcase";

    outfittersShowcase.userData.genesisInteractiveActions =
      [
        {
          id: "explore_showcase",
          label: "Explore Showcase",
        },
      ];

    outfittersShowcase.userData.genesisInteractiveApproachLocal =
      [0, -1.85];

    cityOutfitters.add(
      outfittersShowcase
    );

    box(outfittersShowcase, {
      x: 0,
      y: 0.14,
      z: 0,
      w: 2.8,
      h: 0.28,
      d: 2.8,
      color: GRAPHITE,
    });

    box(outfittersShowcase, {
      x: 0,
      y: 0.30,
      z: 0,
      w: 2.45,
      h: 0.06,
      d: 2.45,
      color: MAGENTA,
      cast: false,
    });

    // Ceiling runway lighting.
    [-3.3, 0, 3.3].forEach(
      (railX, index) => {
        box(cityOutfitters, {
          x: railX,
          y: 2.82,
          z: 0,
          w: 0.08,
          h: 0.05,
          d: 7.3,
          color:
            index === 1
              ? MAGENTA
              : CYAN,
          cast: false,
        });
      }
    );

    // --------------------------------------------------------
    // PREMIUM FASHION DISPLAY RACKS
    // --------------------------------------------------------

    const outfitDisplayPositions = [
      [-3.65, -1.35],
      [-3.65,  2.20],
      [ 3.65, -1.35],
      [ 3.65,  2.20],
    ];

    outfitDisplayPositions.forEach(
      ([rx, rz], index) => {
        const rack =
          new THREE.Group();

        rack.position.set(
          rx,
          0,
          rz
        );

        rack.userData.genesisInteractiveId =
          `city-outfitters-rack-${index}`;

        rack.userData.genesisInteractiveLabel =
          `City Outfitters Rack ${index + 1}`;

        rack.userData.genesisInteractiveActions =
          [
            {
              id: "browse_styles",
              label: "Browse Styles",
            },
          ];

        rack.userData.genesisInteractiveApproachLocal =
          [0, -1.05];

        cityOutfitters.add(
          rack
        );

        // Dark premium display base.
        box(rack, {
          x: 0,
          y: 0.08,
          z: 0,
          w: 2.15,
          h: 0.16,
          d: 0.72,
          color: GRAPHITE,
        });

        // Vertical frame supports.
        [-0.92, 0.92].forEach(
          (px) => {
            box(rack, {
              x: px,
              y: 1.02,
              z: 0,
              w: 0.08,
              h: 1.92,
              d: 0.08,
              color:
                index % 2 === 0
                  ? CYAN
                  : MAGENTA,
              cast: false,
            });
          }
        );

        // Upper fashion rail.
        box(rack, {
          x: 0,
          y: 1.92,
          z: 0,
          w: 1.92,
          h: 0.07,
          d: 0.07,
          color:
            index % 2 === 0
              ? CYAN
              : MAGENTA,
          cast: false,
        });

        // Abstract hanging garment displays.
        [-0.58, 0, 0.58].forEach(
          (gx, garmentIndex) => {
            box(rack, {
              x: gx,
              y:
                garmentIndex === 1
                  ? 1.18
                  : 1.12,
              z: 0,
              w: 0.42,
              h:
                garmentIndex === 1
                  ? 1.05
                  : 0.90,
              d: 0.18,
              color:
                garmentIndex === 1
                  ? 0xe8edf4
                  : (
                      index % 2 === 0
                        ? 0x214b5a
                        : 0x54205d
                    ),
            });
          }
        );

        // Small illuminated display edge.
        box(rack, {
          x: 0,
          y: 0.20,
          z: -0.39,
          w: 1.88,
          h: 0.05,
          d: 0.05,
          color:
            index % 2 === 0
              ? CYAN
              : MAGENTA,
          cast: false,
        });
      }
    );

    // --------------------------------------------------------
    // SOCIAL FASHION LOUNGE
    // --------------------------------------------------------

    const outfittersLounge =
      new THREE.Group();

    outfittersLounge.position.set(
      -4.75,
      0,
      -3.25
    );

    outfittersLounge.userData.genesisInteractiveId =
      "city-outfitters-lounge";

    outfittersLounge.userData.genesisInteractiveLabel =
      "City Outfitters Lounge";

    outfittersLounge.userData.genesisInteractiveActions =
      [
        {
          id: "sit",
          label: "Sit & Relax",
        },
      ];

    outfittersLounge.userData.genesisInteractiveApproachLocal =
      [0, 0];

    outfittersLounge.userData.genesisInteractionAnchor =
      {
        x: 0,
        y: 0,
        z: 0,
      };

    cityOutfitters.add(
      outfittersLounge
    );

    // Main lounge seat.
    box(outfittersLounge, {
      x: 0,
      y: 0.38,
      z: 0,
      w: 1.05,
      h: 0.58,
      d: 2.35,
      color: 0x202735,
    });

    // Backrest.
    box(outfittersLounge, {
      x: -0.43,
      y: 0.82,
      z: 0,
      w: 0.17,
      h: 0.82,
      d: 2.35,
      color: GRAPHITE,
    });

    // Cyan lounge accent.
    box(outfittersLounge, {
      x: -0.53,
      y: 0.82,
      z: 0,
      w: 0.05,
      h: 0.72,
      d: 2.12,
      color: CYAN,
      cast: false,
    });

    // --------------------------------------------------------
    // SMALL CREATOR / STYLE DISPLAY TABLE
    // --------------------------------------------------------

    box(cityOutfitters, {
      x: 4.60,
      y: 0.38,
      z: -3.20,
      w: 1.55,
      h: 0.18,
      d: 1.25,
      color: GRAPHITE,
    });

    box(cityOutfitters, {
      x: 4.60,
      y: 0.50,
      z: -3.20,
      w: 1.30,
      h: 0.05,
      d: 1.00,
      color: MAGENTA,
      cast: false,
    });

    // Decorative folded-item blocks.
    [-0.38, 0, 0.38].forEach(
      (offset, index) => {
        box(cityOutfitters, {
          x: 4.60 + offset,
          y: 0.61,
          z: -3.20,
          w: 0.28,
          h: 0.16,
          d: 0.42,
          color:
            index === 1
              ? 0xe8edf4
              : MAGENTA,
        });
      }
    );

    cityOutfitters.userData.aaaInterior =
      "city-outfitters-v1";
  }


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
    color: 0x14181f,
  });

  plane(city, {
    x: 22,
    y: 0.021,
    z: 78,
    w: 5,
    d: 24,
    color: 0x1c222c,
  });

  plane(city, {
    x: 22,
    y: 0.023,
    z: 78,
    w: 25,
    d: 4,
    color: 0x1c222c,
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
    color: 0x181d26,
  });


  // North Riverwalk.
  plane(city, {
    x: 0,
    y: 0.022,
    z: 113.5,
    w: 90,
    d: 4.5,
    color: 0x181d26,
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
    color: 0x2a2f38,
  });


  // Pedestrian Riverwalk bridge.
  plane(city, {
    x: 24,
    y: 0.052,
    z: 106,
    w: 8,
    d: 13,
    color: 0x232833,
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
    color: 0x252b34,
  });

  plane(city, {
    x: MAIN_X + 6.2,
    y: 0.02,
    z: 123,
    w: 2.1,
    d: 22,
    color: 0x252b34,
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

  // ==========================================================
  // GENESIS CITY V1 — VENUE FURNISHING + NEON/CYBER ART PASS
  // Dark premium cyan/purple/magenta neon target.
  // ==========================================================

  const NEON = {
    cyan: 0x2ee6ff,
    purple: 0xb14bff,
    magenta: 0xff4fd8,
    orange: 0xff7a3d,
    mint: 0x39ffb4,
    violet: 0x7a5cff,
  };

  const GRAPHITE = 0x121922;

  const findBuilding = (id) =>
    city.children.find(
      (c) => c?.userData?.buildingId === id
    );

  const addNeonStrip = (group, cfg) =>
    box(group, {
      ...cfg,
      cast: false,
      mat: material(cfg.color, {
        emissive: cfg.color,
        emissiveIntensity: 1.35,
        roughness: 0.4,
      }),
    });

  const addSeat = (root, id, i, sx, sz, sign, neon) => {
    const seat = new THREE.Group();
    seat.position.set(sx, 0, sz);
    seat.userData.genesisInteractiveId = `${id}-seat-${i}`;
    seat.userData.genesisInteractiveLabel = `${sign} Seat`;
    seat.userData.genesisInteractiveActions = [
      { id: "sit", label: "Sit & Hang Out" },
    ];
    seat.userData.genesisInteractiveApproach = [0, 0];
    seat.userData.genesisInteractionAnchor = { x: 0, y: 0, z: 0 };
    root.add(seat);
    box(seat, { y: 0.26, w: 0.62, h: 0.52, d: 0.62, color: GRAPHITE });
    box(seat, { y: 0.72, z: -0.27, w: 0.62, h: 0.46, d: 0.08, color: 0x080d14 });
    addNeonStrip(seat, { y: 0.54, z: 0.3, w: 0.58, h: 0.04, d: 0.04, color: neon });
    return seat;
  };

  const furnishGenesisVenue = (cfg) => {
    const root = findBuilding(cfg.id);
    if (!root || root.userData.aaaInterior) return;

    const rear = cfg.rear;

    // Rear feature wall + neon header + sign.
    box(root, { x: 0, y: 1.45, z: rear, w: cfg.wallW, h: 2.35, d: 0.12, color: GRAPHITE });
    addNeonStrip(root, { x: 0, y: 2.52, z: rear - 0.09, w: cfg.wallW - 2, h: 0.08, d: 0.08, color: cfg.neon });
    addLabel(root, cfg.sign, { x: 0, y: 2.03, z: rear - 0.16, scale: 4.4 });

    // Signature interactive.
    (cfg.items || []).forEach((item) => {
      const g = new THREE.Group();
      g.position.set(item.x, 0, item.z);
      g.userData.genesisInteractiveId = `${cfg.id}-${item.key}`;
      g.userData.genesisInteractiveLabel = item.label;
      g.userData.genesisInteractiveActions = item.actions;
      g.userData.genesisInteractiveApproachLocal = item.approach || [0, -1.0];
      root.add(g);
      (item.parts || []).forEach((p) =>
        p.neon
          ? addNeonStrip(g, { ...p, color: p.color ?? cfg.neon })
          : box(g, p)
      );
    });

    // Decor (non-interactive).
    (cfg.decor || []).forEach((p) =>
      p.neon
        ? addNeonStrip(root, { ...p, color: p.color ?? cfg.neon })
        : box(root, p)
    );

    // Social seating.
    (cfg.seats || []).forEach(([sx, sz], i) =>
      addSeat(root, cfg.id, i, sx, sz, cfg.sign, cfg.neon)
    );

    // Exterior door neon posts (front = local -z).
    const front = -cfg.rear - 0.1;
    [-1.7, 1.7].forEach((px) =>
      addNeonStrip(root, { x: px, y: 1.3, z: front, w: 0.09, h: 2.6, d: 0.09, color: cfg.neon })
    );

    root.userData.aaaInterior = `${cfg.id}-v1`;
  };

  const counterItem = (key, label, actions, x = 0, z = 1.4) => ({
    key,
    label,
    actions,
    x,
    z,
    parts: [
      { y: 0.55, w: 3.6, h: 1.1, d: 1.0, color: GRAPHITE },
      { y: 1.14, w: 3.7, h: 0.06, d: 1.06, color: 0x080d14 },
      { y: 0.62, z: -0.54, w: 3.4, h: 0.06, d: 0.05, neon: true },
    ],
  });

  furnishGenesisVenue({
    id: "plaza-restaurant",
    sign: "PLAZA RESTAURANT",
    neon: NEON.magenta,
    rear: 4.6,
    wallW: 9.2,
    items: [
      counterItem("chef-counter", "Chef's Counter", [
        { id: "chef_special", label: "Chef's Tasting — FREE" },
      ]),
    ],
    decor: [
      { x: -3.4, y: 0.72, z: -1.5, w: 1.5, h: 0.12, d: 1.05, color: GRAPHITE },
      { x: 3.4, y: 0.72, z: -1.5, w: 1.5, h: 0.12, d: 1.05, color: GRAPHITE },
      { x: -3.4, y: 0.36, z: -1.5, w: 0.18, h: 0.72, d: 0.18, color: 0x080d14 },
      { x: 3.4, y: 0.36, z: -1.5, w: 0.18, h: 0.72, d: 0.18, color: 0x080d14 },
    ],
    seats: [[-4.4, -1.5], [-2.4, -1.5], [2.4, -1.5], [4.4, -1.5]],
  });

  furnishGenesisVenue({
    id: "fresh-grocery",
    sign: "FRESH GROCERY",
    neon: NEON.mint,
    rear: 4.6,
    wallW: 9.2,
    items: [
      {
        key: "smart-shelves",
        label: "Fresh Grocery Smart Shelves",
        actions: [{ id: "browse_goods", label: "Browse Goods — FREE" }],
        x: 0,
        z: 2.6,
        parts: [
          { y: 0.85, w: 6.4, h: 1.7, d: 0.7, color: GRAPHITE },
          { y: 1.74, w: 6.5, h: 0.06, d: 0.76, neon: true },
          { y: 1.2, z: -0.38, w: 6.0, h: 0.5, d: 0.06, color: 0x0e2b22 },
        ],
      },
    ],
    decor: [
      { x: -2.6, y: 0.6, z: -0.8, w: 3.2, h: 1.2, d: 0.85, color: GRAPHITE },
      { x: 2.6, y: 0.6, z: -0.8, w: 3.2, h: 1.2, d: 0.85, color: GRAPHITE },
      { x: -2.6, y: 1.24, z: -0.8, w: 3.3, h: 0.05, d: 0.9, neon: true },
      { x: 2.6, y: 1.24, z: -0.8, w: 3.3, h: 0.05, d: 0.9, neon: true },
    ],
  });

  furnishGenesisVenue({
    id: "night-lounge",
    sign: "NIGHT LOUNGE",
    neon: NEON.purple,
    rear: 4.6,
    wallW: 9.2,
    items: [
      {
        key: "dance-floor",
        label: "Night Lounge Dance Floor",
        actions: [{ id: "dance_floor", label: "Hit the Dance Floor — FREE" }],
        x: 0,
        z: 0.6,
        approach: [0, -2.2],
        parts: [
          { y: 0.03, w: 4.6, h: 0.06, d: 4.0, color: 0x14101f },
          { y: 0.07, w: 4.7, h: 0.03, d: 0.1, z: 2.0, neon: true },
          { y: 0.07, w: 4.7, h: 0.03, d: 0.1, z: -2.0, neon: true },
          { y: 0.07, w: 0.1, h: 0.03, d: 4.0, x: 2.3, neon: true, color: 0xff4fd8 },
          { y: 0.07, w: 0.1, h: 0.03, d: 4.0, x: -2.3, neon: true, color: 0xff4fd8 },
        ],
      },
    ],
    decor: [
      { x: -4.2, y: 0.55, z: 3.4, w: 2.6, h: 1.1, d: 0.9, color: GRAPHITE },
      { x: -4.2, y: 1.14, z: 3.4, w: 2.7, h: 0.05, d: 0.95, neon: true, color: 0xff4fd8 },
    ],
    seats: [[-5.0, -1.6], [-5.0, 0.6], [5.0, -1.6], [5.0, 0.6]],
  });

  furnishGenesisVenue({
    id: "river-grill",
    sign: "RIVER GRILL",
    neon: NEON.orange,
    rear: 4.15,
    wallW: 9.2,
    items: [
      counterItem("grill-counter", "River Grill Counter", [
        { id: "waterside_dine", label: "Waterside Bites — FREE" },
      ], 0, 1.6),
    ],
    decor: [
      { x: -3.6, y: 0.72, z: -1.2, w: 1.5, h: 0.12, d: 1.0, color: GRAPHITE },
      { x: 3.6, y: 0.72, z: -1.2, w: 1.5, h: 0.12, d: 1.0, color: GRAPHITE },
    ],
    seats: [[-4.8, -1.2], [-2.4, -1.2], [2.4, -1.2], [4.8, -1.2]],
  });

  furnishGenesisVenue({
    id: "pulse-club",
    sign: "CLUB 178",
    neon: NEON.cyan,
    rear: 4.15,
    wallW: 9.2,
    items: [
      {
        key: "dj-stage",
        label: "Club 178 Main Floor",
        actions: [{ id: "club_dance", label: "Dance — FREE" }],
        x: 0,
        z: 0.4,
        approach: [0, -2.0],
        parts: [
          { y: 0.03, w: 5.0, h: 0.06, d: 3.6, color: 0x0c1420 },
          { y: 0.5, z: 2.4, w: 3.2, h: 1.0, d: 1.0, color: GRAPHITE },
          { y: 1.05, z: 2.4, w: 3.3, h: 0.06, d: 1.06, neon: true },
          { y: 1.6, z: 2.9, w: 2.4, h: 0.9, d: 0.1, color: 0x06121e },
          { y: 1.6, z: 2.84, w: 2.2, h: 0.7, d: 0.03, neon: true, color: 0xb14bff },
        ],
      },
    ],
    decor: [
      { x: -5.2, y: 1.5, z: 0, w: 0.1, h: 3.0, d: 0.1, neon: true },
      { x: 5.2, y: 1.5, z: 0, w: 0.1, h: 3.0, d: 0.1, neon: true, color: 0xff4fd8 },
    ],
    seats: [[-5.0, -2.6], [5.0, -2.6]],
  });

  furnishGenesisVenue({
    id: "central-offices",
    sign: "CENTRAL OFFICES",
    neon: 0x4fd8ff,
    rear: 5.6,
    wallW: 11,
    items: [
      {
        key: "creator-desks",
        label: "Creator Workspace",
        actions: [{ id: "creator_desk", label: "Work on Projects — FREE" }],
        x: 0,
        z: 2.6,
        parts: [
          { y: 0.72, w: 5.6, h: 0.1, d: 1.4, color: GRAPHITE },
          { y: 1.2, z: -0.6, w: 5.2, h: 0.7, d: 0.06, color: 0x06121e },
          { y: 1.2, z: -0.56, w: 5.0, h: 0.5, d: 0.02, neon: true },
          { x: -2.4, y: 0.36, w: 0.16, h: 0.72, d: 1.2, color: 0x080d14 },
          { x: 2.4, y: 0.36, w: 0.16, h: 0.72, d: 1.2, color: 0x080d14 },
        ],
      },
    ],
    decor: [
      { x: -4.6, y: 0.55, z: -1.6, w: 2.4, h: 1.1, d: 0.9, color: GRAPHITE },
      { x: -4.6, y: 1.14, z: -1.6, w: 2.5, h: 0.05, d: 0.95, neon: true },
    ],
    seats: [[4.4, -1.6], [4.4, 0.6]],
  });

  furnishGenesisVenue({
    id: "river-hotel",
    sign: "RIVER HOTEL",
    neon: 0xd18cff,
    rear: 5.6,
    wallW: 7.4,
    items: [
      {
        key: "reception",
        label: "River Hotel Reception",
        actions: [{ id: "lobby_lounge", label: "Check In & Relax — FREE" }],
        x: 0,
        z: 3.4,
        parts: [
          { y: 0.6, w: 3.4, h: 1.2, d: 0.9, color: GRAPHITE },
          { y: 1.24, w: 3.5, h: 0.06, d: 0.96, color: 0x080d14 },
          { y: 0.7, z: -0.5, w: 3.2, h: 0.06, d: 0.05, neon: true },
        ],
      },
    ],
    decor: [
      { x: 0, y: 0.02, z: -0.6, w: 4.2, h: 0.05, d: 3.4, color: 0x1a1420 },
    ],
    seats: [[-2.6, -0.8], [2.6, -0.8], [0, -2.2]],
  });

  // --------------------------------------------------------
  // CITY OUTFITTERS — FINAL 3: fitting pod, style hologram,
  // exterior neon marquee.
  // --------------------------------------------------------
  {
    const outfitters = findBuilding("city-outfitters");
    if (outfitters) {
      const MAGENTA = 0xff4fd8;

      const pod = new THREE.Group();
      pod.position.set(-4.6, 0, 3.4);
      pod.userData.genesisInteractiveId = "city-outfitters-fitting-pod";
      pod.userData.genesisInteractiveLabel = "Fitting Pod";
      pod.userData.genesisInteractiveActions = [
        { id: "view_look", label: "Try a Look — FREE" },
      ];
      pod.userData.genesisInteractiveApproachLocal = [0, -1.1];
      outfitters.add(pod);
      box(pod, { y: 1.25, w: 1.5, h: 2.5, d: 1.3, color: GRAPHITE });
      addNeonStrip(pod, { y: 2.44, w: 1.56, h: 0.06, d: 1.36, color: MAGENTA });
      box(pod, { y: 1.2, z: 0.66, w: 1.1, h: 2.0, d: 0.04, color: 0x0b1a26 });

      const holo = new THREE.Group();
      holo.position.set(4.6, 0, 3.6);
      holo.userData.genesisInteractiveId = "city-outfitters-style-holo";
      holo.userData.genesisInteractiveLabel = "Style Hologram";
      holo.userData.genesisInteractiveActions = [
        { id: "browse_styles", label: "Browse Styles — FREE" },
      ];
      holo.userData.genesisInteractiveApproachLocal = [0, -1.1];
      outfitters.add(holo);
      box(holo, { y: 0.24, w: 1.2, h: 0.48, d: 1.2, color: GRAPHITE });
      addNeonStrip(holo, { y: 1.35, w: 0.55, h: 1.7, d: 0.55, color: 0x2ee6ff });

      // Exterior neon marquee above the entrance.
      addNeonStrip(outfitters, { y: 3.15, z: -4.7, w: 7.4, h: 0.12, d: 0.12, color: MAGENTA });
      addLabel(outfitters, "CITY OUTFITTERS", { x: 0, y: 3.6, z: -4.72, scale: 5.2 });
    }
  }

  // --------------------------------------------------------
  // CITYWIDE NEON / CYBER ART PASS — street-level glow.
  // --------------------------------------------------------
  const addCityNeon = (cfg) =>
    box(city, {
      ...cfg,
      cast: false,
      mat: material(cfg.color, {
        emissive: cfg.color,
        emissiveIntensity: 1.3,
        roughness: 0.4,
      }),
    });

  // Main Street sidewalk edge glow.
  addCityNeon({ x: MAIN_X - 5.15, y: 0.05, z: 65, w: 0.12, h: 0.05, d: 66, color: 0x2ee6ff });
  addCityNeon({ x: MAIN_X + 5.15, y: 0.05, z: 65, w: 0.12, h: 0.05, d: 66, color: 0xb14bff });

  // North continuation glow.
  addCityNeon({ x: MAIN_X - 5.15, y: 0.05, z: 123, w: 0.12, h: 0.05, d: 22, color: 0x2ee6ff });
  addCityNeon({ x: MAIN_X + 5.15, y: 0.05, z: 123, w: 0.12, h: 0.05, d: 22, color: 0xb14bff });

  // Downtown plaza neon ring.
  addCityNeon({ x: 22, y: 0.05, z: 66.4, w: 25, h: 0.05, d: 0.12, color: 0xff4fd8 });
  addCityNeon({ x: 22, y: 0.05, z: 89.6, w: 25, h: 0.05, d: 0.12, color: 0x2ee6ff });
  addCityNeon({ x: 10.4, y: 0.05, z: 78, w: 0.12, h: 0.05, d: 23, color: 0xb14bff });
  addCityNeon({ x: 33.6, y: 0.05, z: 78, w: 0.12, h: 0.05, d: 23, color: 0xb14bff });

  // Riverwalk promenade glow lines.
  addCityNeon({ x: 0, y: 0.055, z: 100.6, w: 90, h: 0.05, d: 0.12, color: 0x2ee6ff });
  addCityNeon({ x: 0, y: 0.055, z: 111.4, w: 90, h: 0.05, d: 0.12, color: 0x2ee6ff });

  // --------------------------------------------------------
  // PUBLIC HANGOUT ZONES
  // --------------------------------------------------------

  // Downtown Plaza fire ring hangout.
  {
    const fireRing = new THREE.Group();
    fireRing.position.set(22, 0, 78);
    fireRing.userData.genesisInteractiveId = "plaza-fire-ring";
    fireRing.userData.genesisInteractiveLabel = "Plaza Fire Ring";
    fireRing.userData.genesisInteractiveActions = [
      { id: "plaza_hangout", label: "Gather at the Fire Ring — FREE" },
    ];
    fireRing.userData.genesisInteractiveApproachLocal = [0, -1.6];
    city.add(fireRing);
    box(fireRing, { y: 0.22, w: 1.7, h: 0.44, d: 1.7, color: GRAPHITE });
    addNeonStrip(fireRing, { y: 0.5, w: 1.1, h: 0.16, d: 1.1, color: 0xff7a3d });

    [[-2.6, 0], [2.6, 0], [0, -2.6], [0, 2.6]].forEach(([sx, sz], i) => {
      const bench = new THREE.Group();
      bench.position.set(22 + sx, 0, 78 + sz);
      bench.userData.genesisInteractiveId = `plaza-bench-${i}`;
      bench.userData.genesisInteractiveLabel = "Plaza Bench";
      bench.userData.genesisInteractiveActions = [
        { id: "sit", label: "Sit & Hang Out" },
      ];
      bench.userData.genesisInteractiveApproach = [0, 0];
      bench.userData.genesisInteractionAnchor = { x: 0, y: 0, z: 0 };
      city.add(bench);
      box(bench, { y: 0.26, w: 1.5, h: 0.5, d: 0.6, color: GRAPHITE });
      addNeonStrip(bench, { y: 0.06, w: 1.5, h: 0.05, d: 0.6, color: 0xb14bff });
    });
  }

  // Riverwalk overlook hangout.
  {
    const overlook = new THREE.Group();
    overlook.position.set(18, 0, 99.6);
    overlook.userData.genesisInteractiveId = "river-overlook";
    overlook.userData.genesisInteractiveLabel = "Riverwalk Overlook";
    overlook.userData.genesisInteractiveActions = [
      { id: "river_overlook", label: "Take in the River View — FREE" },
    ];
    overlook.userData.genesisInteractiveApproachLocal = [0, -1.2];
    city.add(overlook);
    addNeonStrip(overlook, { y: 1.0, w: 3.2, h: 0.07, d: 0.07, color: 0x2ee6ff });
    box(overlook, { x: -1.55, y: 0.5, w: 0.09, h: 1.0, d: 0.09, color: GRAPHITE });
    box(overlook, { x: 1.55, y: 0.5, w: 0.09, h: 1.0, d: 0.09, color: GRAPHITE });

    [[-4.5, 0], [4.5, 0]].forEach(([sx], i) => {
      const bench = new THREE.Group();
      bench.position.set(18 + sx, 0, 99.4);
      bench.userData.genesisInteractiveId = `river-bench-${i}`;
      bench.userData.genesisInteractiveLabel = "Riverwalk Bench";
      bench.userData.genesisInteractiveActions = [
        { id: "sit", label: "Sit & Hang Out" },
      ];
      bench.userData.genesisInteractiveApproach = [0, 0];
      bench.userData.genesisInteractionAnchor = { x: 0, y: 0, z: 0 };
      city.add(bench);
      box(bench, { y: 0.26, w: 1.5, h: 0.5, d: 0.6, color: GRAPHITE });
      addNeonStrip(bench, { y: 0.06, w: 1.5, h: 0.05, d: 0.6, color: 0x2ee6ff });
    });
  }

  // ========================================================
  // GENESIS CITY NORTH EXPANSION
  // Additive only — current city + homes remain authoritative.
  // ========================================================

  const genesisExpansion =
    installRealmLifeGenesisExpansion({
      root: city,
      colliders,
    });

  if (
    Array.isArray(
      genesisExpansion?.pois
    )
  ) {
    registry.pois.push(
      ...genesisExpansion.pois
    );
  }

  city.userData.realmLifeGenesisExpansion =
    genesisExpansion;

  installRealmLifeAAAUpgrade(city);

  return {
    root: city,
    registry,
  };
}
