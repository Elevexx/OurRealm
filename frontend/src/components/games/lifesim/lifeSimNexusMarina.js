
import * as THREE from "three";


// ============================================================
// REALMLIFE V7A
// PROCEDURAL NEXUS DISTRICT + OCEAN + MARINA
//
// No Meshy assets required.
//
// This is the premium procedural foundation that future GLBs
// can replace piece-by-piece without changing the world layout.
// ============================================================


function standard(
  color,
  {
    roughness = 0.52,
    metalness = 0.12,
    emissive = 0x000000,
    emissiveIntensity = 0,
    transparent = false,
    opacity = 1,
  } = {}
) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
    transparent,
    opacity,
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

    material,
    color = 0xffffff,

    cast = true,
    receive = true,
  }
) {
  const mesh =
    new THREE.Mesh(
      new THREE.BoxGeometry(
        w,
        h,
        d
      ),
      material
      || standard(
        color
      )
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

    material,
    color = 0xffffff,
  }
) {
  const mesh =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        w,
        d
      ),
      material
      || standard(
        color
      )
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


function makeLabel(
  text,
  {
    scale = 8,
    color = "#dff9ff",
    border = "#48e6ff",
    background =
      "rgba(5,12,24,0.86)",
  } = {}
) {
  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width =
    768;

  canvas.height =
    150;


  const ctx =
    canvas.getContext(
      "2d"
    );


  ctx.fillStyle =
    background;

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  );


  ctx.strokeStyle =
    border;

  ctx.lineWidth =
    7;

  ctx.strokeRect(
    5,
    5,
    canvas.width - 10,
    canvas.height - 10
  );


  ctx.fillStyle =
    color;

  ctx.font =
    "900 54px Arial";

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "middle";

  ctx.fillText(
    String(
      text
      || ""
    ).slice(
      0,
      34
    ),
    canvas.width / 2,
    canvas.height / 2
  );


  const texture =
    new THREE.CanvasTexture(
      canvas
    );


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
    scale * 0.195,
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
    standard(
      0x765034,
      {
        roughness:
          0.94,
      }
    );


  const leafMat =
    standard(
      0x1f7847,
      {
        roughness:
          0.88,
      }
    );


  const trunk =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.18 * scale,
        0.30 * scale,
        4.8 * scale,
        8
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
    i < 8;
    i += 1
  ) {
    const angle =
      (
        i / 8
      )
      * Math.PI
      * 2;


    const leaf =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.70 * scale,
          7,
          4
        ),
        leafMat
      );


    leaf.scale.set(
      1.8,
      0.18,
      0.50
    );


    leaf.position.set(
      Math.cos(
        angle
      )
        * 0.85
        * scale,

      4.75
        * scale,

      Math.sin(
        angle
      )
        * 0.85
        * scale
    );


    leaf.rotation.y =
      -angle;


    palm.add(
      leaf
    );
  }


  group.add(
    palm
  );

  return palm;
}


function addLightPole(
  group,
  x,
  z,
  accent = 0x45e6ff
) {
  const metal =
    standard(
      0x25313a,
      {
        roughness:
          0.34,

        metalness:
          0.72,
      }
    );


  const glow =
    standard(
      accent,
      {
        roughness:
          0.18,

        metalness:
          0.18,

        emissive:
          accent,

        emissiveIntensity:
          2.8,
      }
    );


  box(
    group,
    {
      x,
      y:
        2.25,
      z,

      w:
        0.12,
      h:
        4.5,
      d:
        0.12,

      material:
        metal,
    }
  );


  box(
    group,
    {
      x,
      y:
        4.55,
      z,

      w:
        0.55,
      h:
        0.11,
      d:
        0.55,

      material:
        glow,

      cast:
        false,
    }
  );
}


function addBench(
  group,
  x,
  z,
  rotation = 0
) {
  const bench =
    new THREE.Group();

  bench.position.set(
    x,
    0,
    z
  );

  bench.rotation.y =
    rotation;


  const metal =
    standard(
      0x25323b,
      {
        metalness:
          0.62,

        roughness:
          0.38,
      }
    );


  const wood =
    standard(
      0x765137,
      {
        roughness:
          0.72,
      }
    );


  box(
    bench,
    {
      y:
        0.54,

      w:
        2.8,

      h:
        0.14,

      d:
        0.65,

      material:
        wood,
    }
  );


  box(
    bench,
    {
      y:
        1.05,

      z:
        0.27,

      w:
        2.8,

      h:
        0.82,

      d:
        0.12,

      material:
        wood,
    }
  );


  for (
    const xLeg
    of [
      -1.05,
      1.05,
    ]
  ) {
    box(
      bench,
      {
        x:
          xLeg,

        y:
          0.28,

        w:
          0.10,

        h:
          0.56,

        d:
          0.55,

        material:
          metal,
      }
    );
  }


  group.add(
    bench
  );
}


function addCrowdPerson(
  group,
  x,
  z,
  index
) {
  const person =
    new THREE.Group();


  const palette = [
    0x29d8ee,
    0x865cff,
    0x32d57f,
    0xe69653,
    0xc04ee7,
  ];


  const accent =
    palette[
      index
      %
      palette.length
    ];


  const bodyMat =
    standard(
      0x182229,
      {
        roughness:
          0.58,
      }
    );


  const accentMat =
    standard(
      accent,
      {
        emissive:
          accent,

        emissiveIntensity:
          1.1,

        roughness:
          0.28,
      }
    );


  box(
    person,
    {
      y:
        1.05,

      w:
        0.48,

      h:
        1.25,

      d:
        0.28,

      material:
        bodyMat,
    }
  );


  const head =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        0.23,
        8,
        6
      ),
      standard(
        0xa77f68
      )
    );

  head.position.y =
    1.86;

  person.add(
    head
  );


  box(
    person,
    {
      y:
        1.12,

      z:
        -0.16,

      w:
        0.12,

      h:
        0.75,

      d:
        0.08,

      material:
        accentMat,

      cast:
        false,
    }
  );


  person.position.set(
    x,
    0,
    z
  );


  person.rotation.y =
    (
      index
      * 0.87
    )
    %
    (
      Math.PI
      * 2
    );


  group.add(
    person
  );
}


function addNexusTower(
  group,
  colliders,
  {
    x,
    z,

    w = 18,
    d = 16,
    h = 18,

    accent = 0x46e8ff,

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


  const shell =
    standard(
      0x131c26,
      {
        roughness:
          0.34,

        metalness:
          0.48,
      }
    );


  const glass =
    standard(
      0x193a50,
      {
        roughness:
          0.12,

        metalness:
          0.32,

        emissive:
          0x092c3c,

        emissiveIntensity:
          0.55,
      }
    );


  const neon =
    standard(
      accent,
      {
        emissive:
          accent,

        emissiveIntensity:
          3.2,

        roughness:
          0.16,

        metalness:
          0.18,
      }
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
        shell,
    }
  );


  // Glass front.
  box(
    tower,
    {
      y:
        h * 0.46,

      z:
        -d / 2
        - 0.04,

      w:
        w * 0.72,

      h:
        h * 0.62,

      d:
        0.12,

      material:
        glass,
    }
  );


  for (
    let y =
      2.2;

    y <
      h - 1;

    y += 2.5
  ) {
    box(
      tower,
      {
        y,

        z:
          -d / 2
          - 0.13,

        w:
          w * 0.82,

        h:
          0.08,

        d:
          0.09,

        material:
          neon,

        cast:
          false,
      }
    );
  }


  // Vertical edge accents.
  for (
    const xx
    of [
      -w / 2 + 0.45,
      w / 2 - 0.45,
    ]
  ) {
    box(
      tower,
      {
        x:
          xx,

        y:
          h * 0.52,

        z:
          -d / 2
          - 0.10,

        w:
          0.14,

        h:
          h * 0.84,

        d:
          0.10,

        material:
          neon,

        cast:
          false,
      }
    );
  }


  if (
    label
  ) {
    const sign =
      makeLabel(
        label,
        {
          scale:
            7,
        }
      );

    sign.position.set(
      0,
      h + 2.2,
      -d / 2
      - 0.55
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
      nexusBuilding:
        true,
    }
  );


  return tower;
}


function addCentralNexusPortal(
  group,
  x,
  z
) {
  const portal =
    new THREE.Group();

  portal.position.set(
    x,
    0,
    z
  );


  portal.name =
    "RealmLifeNexusCorePortal";


  portal.userData
    .nexusCore =
      true;


  const pedestal =
    standard(
      0x121a25,
      {
        metalness:
          0.68,

        roughness:
          0.26,
      }
    );


  const glowBlue =
    standard(
      0x39e6ff,
      {
        emissive:
          0x39e6ff,

        emissiveIntensity:
          4.3,

        roughness:
          0.10,

        metalness:
          0.14,
      }
    );


  const glowGreen =
    standard(
      0x47f586,
      {
        emissive:
          0x47f586,

        emissiveIntensity:
          2.6,

        roughness:
          0.12,
      }
    );


  const base =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        8.8,
        10.2,
        0.65,
        48
      ),
      pedestal
    );

  base.position.y =
    0.32;

  base.receiveShadow =
    true;

  portal.add(
    base
  );


  const ring =
    new THREE.Mesh(
      new THREE.TorusGeometry(
        5.7,
        0.38,
        18,
        72
      ),
      glowBlue
    );

  ring.position.y =
    6.4;

  portal.add(
    ring
  );


  const inner =
    new THREE.Mesh(
      new THREE.TorusGeometry(
        4.55,
        0.12,
        12,
        64
      ),
      glowGreen
    );

  inner.position.y =
    6.4;

  portal.add(
    inner
  );


  const beam =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        1.25,
        2.8,
        9.0,
        28,
        1,
        true
      ),
      new THREE.MeshStandardMaterial({
        color:
          0x45dfff,

        emissive:
          0x27cfff,

        emissiveIntensity:
          2,

        transparent:
          true,

        opacity:
          0.18,

        roughness:
          0.1,

        side:
          THREE.DoubleSide,
      })
    );

  beam.position.y =
    4.8;

  portal.add(
    beam
  );


  const sign =
    makeLabel(
      "OurRealm · NEXUS",
      {
        scale:
          11,
      }
    );

  sign.position.set(
    0,
    12.3,
    0
  );

  portal.add(
    sign
  );


  group.add(
    portal
  );


  return portal;
}


function addNexusGateway(
  group,
  x,
  z
) {
  const gateway =
    new THREE.Group();

  gateway.position.set(
    x,
    0,
    z
  );


  const dark =
    standard(
      0x101923,
      {
        roughness:
          0.26,

        metalness:
          0.72,
      }
    );


  const glow =
    standard(
      0x4adfff,
      {
        emissive:
          0x4adfff,

        emissiveIntensity:
          3.1,

        roughness:
          0.12,
      }
    );


  for (
    const xx
    of [
      -14,
      14,
    ]
  ) {
    box(
      gateway,
      {
        x:
          xx,

        y:
          6.4,

        w:
          2.2,

        h:
          12.8,

        d:
          2.5,

        material:
          dark,
      }
    );


    box(
      gateway,
      {
        x:
          xx,

        y:
          6.4,

        z:
          -1.35,

        w:
          0.24,

        h:
          10.5,

        d:
          0.16,

        material:
          glow,

        cast:
          false,
      }
    );
  }


  const arch =
    new THREE.Mesh(
      new THREE.TorusGeometry(
        14,
        0.48,
        14,
        72,
        Math.PI
      ),
      dark
    );

  arch.position.y =
    8.3;

  arch.rotation.z =
    0;

  gateway.add(
    arch
  );


  const neonArch =
    new THREE.Mesh(
      new THREE.TorusGeometry(
        13.25,
        0.14,
        10,
        72,
        Math.PI
      ),
      glow
    );

  neonArch.position.y =
    8.3;

  gateway.add(
    neonArch
  );


  const nexusText =
    makeLabel(
      "NEXUS SPAWN ZONE",
      {
        scale:
          13,
      }
    );

  nexusText.position.set(
    0,
    14.2,
    0
  );

  gateway.add(
    nexusText
  );


  group.add(
    gateway
  );
}


function addBoat(
  group,
  x,
  z,
  scale,
  accent
) {
  const boat =
    new THREE.Group();

  boat.position.set(
    x,
    0.25,
    z
  );


  const hull =
    standard(
      0xe9eef1,
      {
        roughness:
          0.28,

        metalness:
          0.12,
      }
    );


  const dark =
    standard(
      0x15212c,
      {
        roughness:
          0.34,

        metalness:
          0.38,
      }
    );


  const neon =
    standard(
      accent,
      {
        emissive:
          accent,

        emissiveIntensity:
          1.7,
      }
    );


  const hullMesh =
    box(
      boat,
      {
        y:
          0.45,

        w:
          4.8 * scale,

        h:
          0.65 * scale,

        d:
          1.8 * scale,

        material:
          hull,
      }
    );


  hullMesh.rotation.y =
    -0.08;


  box(
    boat,
    {
      x:
        0.5 * scale,

      y:
        1.05 * scale,

      w:
        2.0 * scale,

      h:
        0.75 * scale,

      d:
        1.35 * scale,

      material:
        dark,
    }
  );


  box(
    boat,
    {
      x:
        -1.6 * scale,

      y:
        0.55 * scale,

      z:
        -0.93 * scale,

      w:
        1.2 * scale,

      h:
        0.10 * scale,

      d:
        0.09 * scale,

      material:
        neon,

      cast:
        false,
    }
  );


  group.add(
    boat
  );
}


function buildMarina(
  root,
  colliders
) {
  const marina =
    new THREE.Group();

  marina.name =
    "RealmLifeMarinaDistrict";

  root.add(
    marina
  );


  const oceanMaterial =
    new THREE.MeshPhysicalMaterial({
      color:
        0x087393,

      roughness:
        0.20,

      metalness:
        0.08,

      clearcoat:
        0.45,

      clearcoatRoughness:
        0.22,

      transparent:
        true,

      opacity:
        0.92,

      side:
        THREE.DoubleSide,
    });


  const shallowMaterial =
    new THREE.MeshPhysicalMaterial({
      color:
        0x12a7bc,

      roughness:
        0.15,

      metalness:
        0.05,

      clearcoat:
        0.50,

      transparent:
        true,

      opacity:
        0.72,

      side:
        THREE.DoubleSide,
    });


  // Large coastal ocean.
  plane(
    marina,
    {
      x:
        275,

      y:
        -0.22,

      z:
        475,

      w:
        110,

      d:
        470,

      material:
        oceanMaterial,
    }
  );


  // Shallow glowing coastal edge.
  plane(
    marina,
    {
      x:
        229,

      y:
        -0.18,

      z:
        475,

      w:
        18,

      d:
        430,

      material:
        shallowMaterial,
    }
  );


  const stone =
    standard(
      0x8b8d87,
      {
        roughness:
          0.82,
      }
    );


  // Sea wall.
  box(
    marina,
    {
      x:
        220,

      y:
        1.0,

      z:
        475,

      w:
        2.2,

      h:
        2.0,

      d:
        440,

      material:
        stone,
    }
  );


  addCollider(
    colliders,
    220,
    475,
    2.2,
    440,
    {
      seawall:
        true,
    }
  );


  // Marina boardwalk.
  plane(
    marina,
    {
      x:
        211,

      y:
        0.04,

      z:
        465,

      w:
        16,

      d:
        280,

      color:
        0xc7bca7,
    }
  );


  const marinaLabel =
    makeLabel(
      "REALMLIFE MARINA",
      {
        scale:
          11,

        border:
          "#7af5ff",
      }
    );

  marinaLabel.position.set(
    211,
    7,
    350
  );

  marina.add(
    marinaLabel
  );


  // Docks.
  const dockZs = [
    375,
    405,
    435,
    465,
    495,
    525,
    555,
  ];


  for (
    let i = 0;
    i < dockZs.length;
    i += 1
  ) {
    const z =
      dockZs[i];


    box(
      marina,
      {
        x:
          251,

        y:
          0.12,

        z,

        w:
          60,

        h:
          0.25,

        d:
          2.4,

        color:
          0x8b6b48,
      }
    );


    box(
      marina,
      {
        x:
          280,

        y:
          0.70,

        z,

        w:
          0.10,

        h:
          1.4,

        d:
          0.10,

        color:
          0x31383d,
      }
    );


    addBoat(
      marina,
      242
        +
        (
          i % 2
        )
        * 19,

      z
        + (
          i % 2
          ? 5
          : -5
        ),

      0.78
        +
        (
          i % 3
        )
        * 0.13,

      i % 2
        ? 0x48e9ff
        : 0x9b65ff
    );
  }


  // Marina palms / lights.
  for (
    let z =
      350;

    z <=
      585;

    z += 26
  ) {
    addPalm(
      marina,
      205,
      z,
      0.88
    );


    addLightPole(
      marina,
      216,
      z + 8,
      0x48dfff
    );
  }


  return marina;
}


export function buildRealmLifeNexusMarina(
  root,
  colliders
) {
  const nexus =
    new THREE.Group();

  nexus.name =
    "RealmLifeNexusDistrictV7A";

  root.add(
    nexus
  );


  // ==========================================================
  // NEXUS FOOTPRINT
  //
  // Runs perpendicular through the open transition between the
  // residential community and Downtown.
  // ==========================================================

  const CENTER_X =
    85;

  const CENTER_Z =
    360;


  const plazaMat =
    standard(
      0x18242d,
      {
        roughness:
          0.32,

        metalness:
          0.28,
      }
    );


  const pathMat =
    standard(
      0x29343b,
      {
        roughness:
          0.40,

        metalness:
          0.18,
      }
    );


  const blueGlow =
    standard(
      0x36e3ff,
      {
        emissive:
          0x36e3ff,

        emissiveIntensity:
          3.0,

        roughness:
          0.14,
      }
    );


  const purpleGlow =
    standard(
      0x9259ff,
      {
        emissive:
          0x9259ff,

        emissiveIntensity:
          2.8,

        roughness:
          0.14,
      }
    );


  // Huge perpendicular Nexus promenade.
  plane(
    nexus,
    {
      x:
        CENTER_X,

      y:
        0.055,

      z:
        CENTER_Z,

      w:
        220,

      d:
        38,

      material:
        plazaMat,
    }
  );


  // Central walking lane.
  plane(
    nexus,
    {
      x:
        CENTER_X,

      y:
        0.075,

      z:
        CENTER_Z,

      w:
        210,

      d:
        16,

      material:
        pathMat,
    }
  );


  // Main cyan guide lines.
  for (
    const dz
    of [
      -4.8,
      0,
      4.8,
    ]
  ) {
    box(
      nexus,
      {
        x:
          CENTER_X,

        y:
          0.10,

        z:
          CENTER_Z
          + dz,

        w:
          205,

        h:
          0.045,

        d:
          dz === 0
            ? 0.36
            : 0.18,

        material:
          dz === 0
            ? blueGlow
            : purpleGlow,

        cast:
          false,
      }
    );
  }


  // Connection from Main Street / community road.
  plane(
    nexus,
    {
      x:
        -3,

      y:
        0.068,

      z:
        CENTER_Z,

      w:
        45,

      d:
        18,

      material:
        pathMat,
    }
  );


  addNexusGateway(
    nexus,
    -4,
    CENTER_Z
  );


  addCentralNexusPortal(
    nexus,
    CENTER_X,
    CENTER_Z
  );


  // ==========================================================
  // SOCIAL / GAMING BUILDINGS
  // ==========================================================

  addNexusTower(
    nexus,
    colliders,
    {
      x:
        35,

      z:
        339,

      w:
        28,

      d:
        20,

      h:
        18,

      accent:
        0x35e5ff,

      label:
        "NEXUS SHOPS",
    }
  );


  addNexusTower(
    nexus,
    colliders,
    {
      x:
        35,

      z:
        382,

      w:
        28,

      d:
        20,

      h:
        20,

      accent:
        0x4cf08c,

      label:
        "SOCIAL HUB",
    }
  );


  addNexusTower(
    nexus,
    colliders,
    {
      x:
        138,

      z:
        339,

      w:
        30,

      d:
        20,

      h:
        19,

      accent:
        0x925cff,

      label:
        "NEXUS ARCADE",
    }
  );


  addNexusTower(
    nexus,
    colliders,
    {
      x:
        138,

      z:
        382,

      w:
        30,

      d:
        20,

      h:
        22,

      accent:
        0xf054df,

      label:
        "LIVE EVENTS",
    }
  );


  // Tall rear landmark towers.
  addNexusTower(
    nexus,
    colliders,
    {
      x:
        183,

      z:
        344,

      w:
        18,

      d:
        17,

      h:
        42,

      accent:
        0x3fdcff,

      label:
        null,
    }
  );


  addNexusTower(
    nexus,
    colliders,
    {
      x:
        183,

      z:
        378,

      w:
        18,

      d:
        17,

      h:
        48,

      accent:
        0x9a63ff,

      label:
        null,
    }
  );


  // ==========================================================
  // ELEVATED NEXUS TRANSIT / WALKWAYS
  // ==========================================================

  const railMat =
    standard(
      0x202c35,
      {
        metalness:
          0.66,

        roughness:
          0.30,
      }
    );


  box(
    nexus,
    {
      x:
        88,

      y:
        7.4,

      z:
        331,

      w:
        130,

      h:
        0.65,

      d:
        2.2,

      material:
        railMat,
    }
  );


  box(
    nexus,
    {
      x:
        88,

      y:
        7.4,

      z:
        389,

      w:
        130,

      h:
        0.65,

      d:
        2.2,

      material:
        railMat,
    }
  );


  for (
    const x
    of [
      30,
      60,
      90,
      120,
      150,
    ]
  ) {
    box(
      nexus,
      {
        x,

        y:
          3.7,

        z:
          331,

        w:
          0.7,

        h:
          7.4,

        d:
          0.7,

        material:
          railMat,
      }
    );


    box(
      nexus,
      {
        x,

        y:
          3.7,

        z:
          389,

        w:
          0.7,

        h:
          7.4,

        d:
          0.7,

        material:
          railMat,
      }
    );
  }


  // Futuristic transit shuttles.
  const shuttleA =
    box(
      nexus,
      {
        x:
          71,

        y:
          8.35,

        z:
          331,

        w:
          18,

        h:
          1.65,

        d:
          3.0,

        material:
          standard(
            0x18232d,
            {
              metalness:
                0.62,

              roughness:
                0.22,
            }
          ),
      }
    );


  box(
    nexus,
    {
      x:
        71,

      y:
        8.42,

      z:
        329.43,

      w:
        15.5,

      h:
        0.20,

      d:
        0.10,

      material:
        blueGlow,

      cast:
        false,
    }
  );


  const shuttleB =
    box(
      nexus,
      {
        x:
          116,

        y:
          8.35,

        z:
          389,

        w:
          16,

        h:
          1.55,

        d:
          2.9,

        material:
          standard(
            0x211a31,
            {
              metalness:
                0.58,

              roughness:
                0.22,
            }
          ),
      }
    );


  shuttleA.userData
    .nexusTransit =
      true;

  shuttleB.userData
    .nexusTransit =
      true;


  // ==========================================================
  // LANDSCAPE / LIGHTS / SOCIAL SPACE
  // ==========================================================

  for (
    const x
    of [
      0,
      18,
      54,
      72,
      98,
      116,
      154,
      172,
    ]
  ) {
    addLightPole(
      nexus,
      x,
      348,
      0x40e4ff
    );


    addLightPole(
      nexus,
      x + 7,
      372,
      0x9660ff
    );
  }


  for (
    const [
      x,
      z,
      s,
    ]
    of [
      [
        12,
        343,
        0.85,
      ],

      [
        18,
        377,
        0.92,
      ],

      [
        55,
        343,
        0.80,
      ],

      [
        58,
        378,
        0.88,
      ],

      [
        112,
        343,
        0.92,
      ],

      [
        110,
        378,
        0.85,
      ],

      [
        162,
        343,
        0.88,
      ],

      [
        165,
        378,
        0.95,
      ],
    ]
  ) {
    addPalm(
      nexus,
      x,
      z,
      s
    );
  }


  for (
    const [
      x,
      z,
      rot,
    ]
    of [
      [
        15,
        351,
        0,
      ],

      [
        45,
        368,
        Math.PI,
      ],

      [
        120,
        351,
        0,
      ],

      [
        155,
        369,
        Math.PI,
      ],
    ]
  ) {
    addBench(
      nexus,
      x,
      z,
      rot
    );
  }


  // Fountain pools beside the portal.
  for (
    const xx
    of [
      67,
      103,
    ]
  ) {
    const basin =
      new THREE.Mesh(
        new THREE.CylinderGeometry(
          6,
          6,
          0.45,
          36
        ),
        standard(
          0x5c6870,
          {
            roughness:
              0.56,
          }
        )
      );

    basin.position.set(
      xx,
      0.22,
      CENTER_Z
    );

    nexus.add(
      basin
    );


    const water =
      new THREE.Mesh(
        new THREE.CylinderGeometry(
          5.3,
          5.3,
          0.12,
          36
        ),
        new THREE.MeshPhysicalMaterial({
          color:
            0x2bc8e5,

          emissive:
            0x0b718b,

          emissiveIntensity:
            0.75,

          transparent:
            true,

          opacity:
            0.78,

          roughness:
            0.16,

          clearcoat:
            0.6,
        })
      );

    water.position.set(
      xx,
      0.48,
      CENTER_Z
    );

    nexus.add(
      water
    );
  }


  // Lightweight social crowd.
  for (
    let i = 0;
    i < 34;
    i += 1
  ) {
    const progress =
      i / 33;


    const x =
      -8
      +
      progress
      * 185;


    const z =
      CENTER_Z
      +
      Math.sin(
        i * 1.73
      )
      * 6.2;


    addCrowdPerson(
      nexus,
      x,
      z,
      i
    );
  }


  // Nexus quality / identity labels.
  const connectLabel =
    makeLabel(
      "PLAY · CONNECT · BELONG",
      {
        scale:
          9,

        border:
          "#43e8ff",
      }
    );

  connectLabel.position.set(
    35,
    15,
    328
  );

  nexus.add(
    connectLabel
  );


  const levelLabel =
    makeLabel(
      "LEVEL UP TOGETHER",
      {
        scale:
          9,

        border:
          "#a56cff",
      }
    );

  levelLabel.position.set(
    138,
    16.5,
    328
  );

  nexus.add(
    levelLabel
  );


  const marina =
    buildMarina(
      root,
      colliders
    );


  return {
    root:
      nexus,

    marina,

    center: {
      x:
        CENTER_X,

      z:
        CENTER_Z,
    },

    portal: {
      x:
        CENTER_X,

      z:
        CENTER_Z,
    },
  };
}
