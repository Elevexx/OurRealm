import * as THREE from "three";


function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.68,
    metalness: 0.08,
    ...extra,
  });
}


function box(
  root,
  {
    x = 0,
    y = null,
    z = 0,
    w = 1,
    h = 1,
    d = 1,
    color = 0xffffff,
    material = null,
  }
) {
  const mesh =
    new THREE.Mesh(
      new THREE.BoxGeometry(
        w,
        h,
        d
      ),
      material || mat(color)
    );

  mesh.position.set(
    x,
    y ?? h / 2,
    z
  );

  mesh.castShadow = true;
  mesh.receiveShadow = true;

  root.add(mesh);

  return mesh;
}


function plane(
  root,
  {
    x,
    z,
    w,
    d,
    color,
  }
) {
  const mesh =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        w,
        d
      ),
      mat(color)
    );

  mesh.rotation.x =
    -Math.PI / 2;

  mesh.position.set(
    x,
    0.035,
    z
  );

  mesh.receiveShadow = true;

  root.add(mesh);

  return mesh;
}


function glow(
  root,
  {
    x = 0,
    y = 0.1,
    z = 0,
    w = 1,
    h = 0.08,
    d = 0.08,
    color,
  }
) {
  return box(root, {
    x,
    y,
    z,
    w,
    h,
    d,

    material: mat(
      color,
      {
        emissive: color,
        emissiveIntensity: 1.7,
        roughness: 0.28,
      }
    ),
  });
}


function labelSprite(
  text,
  color
) {
  const canvas =
    document.createElement("canvas");

  canvas.width = 512;
  canvas.height = 128;

  const ctx =
    canvas.getContext("2d");

  ctx.fillStyle =
    "rgba(5,10,15,.94)";

  ctx.fillRect(
    0,
    0,
    512,
    128
  );

  ctx.strokeStyle =
    `#${color.toString(16).padStart(6, "0")}`;

  ctx.lineWidth = 7;

  ctx.strokeRect(
    5,
    5,
    502,
    118
  );

  ctx.fillStyle =
    "#ffffff";

  ctx.font =
    "900 38px Arial";

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "middle";

  ctx.fillText(
    text,
    256,
    64
  );

  const texture =
    new THREE.CanvasTexture(
      canvas
    );

  const sprite =
    new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      })
    );

  sprite.scale.set(
    14,
    3.5,
    1
  );

  return sprite;
}


function addFence(
  root,
  width,
  depth,
  color
) {
  const fenceH = 1.15;
  const fenceT = 0.15;

  // back
  box(root, {
    y: fenceH / 2,
    z: depth / 2,
    w: width,
    h: fenceH,
    d: fenceT,
    color: 0x18222a,
  });

  // sides
  box(root, {
    x: -width / 2,
    y: fenceH / 2,
    w: fenceT,
    h: fenceH,
    d: depth,
    color: 0x18222a,
  });

  box(root, {
    x: width / 2,
    y: fenceH / 2,
    w: fenceT,
    h: fenceH,
    d: depth,
    color: 0x18222a,
  });


  // FRONT FENCE WITH ENTRANCE GAP
  const entranceWidth = 8;

  const sideWidth =
    (
      width -
      entranceWidth
    ) / 2;

  box(root, {
    x:
      -(
        entranceWidth / 2 +
        sideWidth / 2
      ),

    y:
      fenceH / 2,

    z:
      -depth / 2,

    w:
      sideWidth,

    h:
      fenceH,

    d:
      fenceT,

    color:
      0x18222a,
  });


  box(root, {
    x:
      entranceWidth / 2 +
      sideWidth / 2,

    y:
      fenceH / 2,

    z:
      -depth / 2,

    w:
      sideWidth,

    h:
      fenceH,

    d:
      fenceT,

    color:
      0x18222a,
  });


  // entrance glow posts
  glow(root, {
    x: -entranceWidth / 2,
    y: 1.45,
    z: -depth / 2,
    w: 0.18,
    h: 2.9,
    d: 0.18,
    color,
  });

  glow(root, {
    x: entranceWidth / 2,
    y: 1.45,
    z: -depth / 2,
    w: 0.18,
    h: 2.9,
    d: 0.18,
    color,
  });
}


function addFestivalJungle(
  festival
) {
  const environment =
    new THREE.Group();

  environment.name =
    "RealmLifeFestivalJungle";

  festival.add(
    environment
  );


  // ========================================================
  // FESTIVAL GRASSLAND
  //
  // Covers the entire dedicated festival parcel.
  // Stage lawns remain layered slightly above this.
  // ========================================================

  const grass =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        250,
        140
      ),
      new THREE.MeshStandardMaterial({
        color:
          0x163f27,

        roughness:
          0.96,

        metalness:
          0.0,
      })
    );

  grass.rotation.x =
    -Math.PI / 2;

  grass.position.set(
    0,
    0.012,
    205
  );

  grass.receiveShadow =
    true;

  grass.name =
    "FestivalJungleGrass";

  environment.add(
    grass
  );


  // Slightly brighter center meadow underneath the stages.
  const meadow =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        205,
        100
      ),
      new THREE.MeshStandardMaterial({
        color:
          0x235b32,

        roughness:
          1,
      })
    );

  meadow.rotation.x =
    -Math.PI / 2;

  meadow.position.set(
    0,
    0.018,
    200
  );

  meadow.receiveShadow =
    true;

  environment.add(
    meadow
  );


  // ========================================================
  // PERFORMANCE-SAFE RAINFOREST TREES
  //
  // One trunk InstancedMesh +
  // three canopy InstancedMeshes.
  // ========================================================

  const positions = [];

  const stageCenters = [
    {
      x: -60,
      z: 200,
    },

    {
      x: 0,
      z: 200,
    },

    {
      x: 60,
      z: 200,
    },
  ];



  const amenityClearings = [
    {
      x: -116,
      z: 170,
      w: 22,
      d: 18,
    },
    {
      x: -116,
      z: 225,
      w: 18,
      d: 14,
    },
    {
      x: 0,
      z: 250,
      w: 26,
      d: 18,
    },
    {
      x: -26,
      z: 246,
      w: 14,
      d: 12,
    },
    {
      x: 26,
      z: 246,
      w: 14,
      d: 12,
    },
    {
      x: 116,
      z: 170,
      w: 22,
      d: 18,
    },
    {
      x: 116,
      z: 225,
      w: 18,
      d: 14,
    },
    {
      x: -58,
      z: 262,
      w: 17,
      d: 15,
    },
    {
      x: 58,
      z: 262,
      w: 17,
      d: 15,
    },
  ];


  const insideAmenityClearing =
    (
      x,
      z
    ) => {
      for (
        const zone of
        amenityClearings
      ) {
        if (
          Math.abs(
            x -
            zone.x
          ) <
            zone.w / 2
          &&
          Math.abs(
            z -
            zone.z
          ) <
            zone.d / 2
        ) {
          return true;
        }
      }

      return false;
    };



  // Reserved U-shaped Riverwalk corridor.
  const insideFestivalRiverCorridor =
    (
      x,
      z
    ) => {

      const sideLeg =
        (
          (
            Math.abs(
              x + 98
            ) < 13
            ||
            Math.abs(
              x - 98
            ) < 13
          )
          &&
          z >= 106
          &&
          z <= 276
        );

      const rearLeg =
        (
          Math.abs(
            z - 274
          ) < 13
          &&
          x >= -110
          &&
          x <= 110
        );

      return (
        sideLeg ||
        rearLeg
      );
    };


  const insideStageClearing =
    (
      x,
      z
    ) => {

      for (
        const stage of
        stageCenters
      ) {
        if (
          Math.abs(
            x -
            stage.x
          ) < 25
          &&
          Math.abs(
            z -
            stage.z
          ) < 28
        ) {
          return true;
        }
      }

      return false;
    };


  // Keep the main approach to the center stage readable.
  const insideEntrancePath =
    (
      x,
      z
    ) =>
      (
        Math.abs(x) < 11
        &&
        z > 135
        &&
        z < 178
      );


  // Keep a little breathing room on the city-facing edge.
  const tooCloseToCity =
    (
      x,
      z
    ) =>
      z < 145;


  // Deterministic grid = same jungle every load.
  for (
    let z = 145;
    z <= 270;
    z += 10
  ) {
    for (
      let x = -120;
      x <= 120;
      x += 10
    ) {

      if (
        insideStageClearing(
          x,
          z
        )
      ) {
        continue;
      }

      if (
        insideAmenityClearing(
          x,
          z
        )
      ) {
        continue;
      }

      if (
        insideEntrancePath(
          x,
          z
        )
      ) {
        continue;
      }

      if (
        tooCloseToCity(
          x,
          z
        )
      ) {
        continue;
      }


      // Structured jitter keeps it natural without Math.random().
      const seed =
        (
          x * 19 +
          z * 31
        );

      const jitterX =
        Math.sin(seed) *
        3.2;

      const jitterZ =
        Math.cos(
          seed * 0.61
        ) *
        3.2;


      // Thin interior slightly so it feels like a park/jungle,
      // not an impassable wall.
      const perimeter =
        (
          Math.abs(x) >
            96
          ||
          z >
            247
          ||
          z <
            164
        );

      const selector =
        Math.abs(
          Math.floor(seed)
        ) %
        4;

      if (
        !perimeter
        &&
        selector === 0
      ) {
        continue;
      }


      positions.push({
        x:
          x +
          jitterX,

        z:
          z +
          jitterZ,

        seed,
      });
    }
  }


  const treeCount =
    positions.length;


  const trunkGeometry =
    new THREE.CylinderGeometry(
      0.62,
      1.05,
      1,
      7
    );

  const trunkMaterial =
    new THREE.MeshStandardMaterial({
      color:
        0x4a2e1a,

      roughness:
        0.95,
    });

  const trunks =
    new THREE.InstancedMesh(
      trunkGeometry,
      trunkMaterial,
      treeCount
    );

  trunks.name =
    "FestivalRainforestTrunks";

  trunks.castShadow =
    true;

  trunks.receiveShadow =
    true;


  const canopyGeometry =
    new THREE.IcosahedronGeometry(
      1,
      1
    );


  const canopyLower =
    new THREE.InstancedMesh(
      canopyGeometry,
      new THREE.MeshStandardMaterial({
        color:
          0x073d24,

        roughness:
          0.9,
      }),
      treeCount
    );


  const canopyMiddle =
    new THREE.InstancedMesh(
      canopyGeometry,
      new THREE.MeshStandardMaterial({
        color:
          0x086331,

        roughness:
          0.88,
      }),
      treeCount
    );


  const canopyTop =
    new THREE.InstancedMesh(
      canopyGeometry,
      new THREE.MeshStandardMaterial({
        color:
          0x0c8741,

        roughness:
          0.84,
      }),
      treeCount
    );


  canopyLower.name =
    "FestivalRainforestCanopyLower";

  canopyMiddle.name =
    "FestivalRainforestCanopyMiddle";

  canopyTop.name =
    "FestivalRainforestCanopyTop";


  canopyLower.castShadow =
    true;

  canopyMiddle.castShadow =
    true;

  canopyTop.castShadow =
    true;


  const dummy =
    new THREE.Object3D();


  positions.forEach(
    (
      pos,
      index
    ) => {

      const normalized =
        (
          Math.sin(
            pos.seed *
            0.21
          ) +
          1
        ) /
        2;


      // Tall rainforest scale.
      const height =
        15 +
        normalized *
        11;


      const trunkWidth =
        0.8 +
        normalized *
        0.45;


      dummy.position.set(
        pos.x,
        height / 2,
        pos.z
      );

      dummy.rotation.set(
        0,
        Math.sin(
          pos.seed
        ) *
          Math.PI,
        0
      );

      dummy.scale.set(
        trunkWidth,
        height,
        trunkWidth
      );

      dummy.updateMatrix();

      trunks.setMatrixAt(
        index,
        dummy.matrix
      );


      const canopyScale =
        4.5 +
        normalized *
        2.6;


      // Lower broad canopy
      dummy.position.set(
        pos.x,
        height -
          3.4,
        pos.z
      );

      dummy.rotation.set(
        0,
        pos.seed *
          0.013,
        0
      );

      dummy.scale.set(
        canopyScale *
          1.1,
        canopyScale *
          0.67,
        canopyScale *
          1.05
      );

      dummy.updateMatrix();

      canopyLower.setMatrixAt(
        index,
        dummy.matrix
      );


      // Middle canopy
      dummy.position.set(
        pos.x +
          Math.sin(
            pos.seed
          ) *
          0.7,

        height +
          0.3,

        pos.z +
          Math.cos(
            pos.seed
          ) *
          0.7
      );

      dummy.rotation.set(
        0,
        pos.seed *
          0.019,
        0
      );

      dummy.scale.set(
        canopyScale,
        canopyScale *
          0.74,
        canopyScale
      );

      dummy.updateMatrix();

      canopyMiddle.setMatrixAt(
        index,
        dummy.matrix
      );


      // Upper crown
      dummy.position.set(
        pos.x,
        height +
          3.1,
        pos.z
      );

      dummy.rotation.set(
        0,
        pos.seed *
          0.027,
        0
      );

      dummy.scale.set(
        canopyScale *
          0.72,
        canopyScale *
          0.82,
        canopyScale *
          0.72
      );

      dummy.updateMatrix();

      canopyTop.setMatrixAt(
        index,
        dummy.matrix
      );
    }
  );


  trunks.instanceMatrix.needsUpdate =
    true;

  canopyLower.instanceMatrix.needsUpdate =
    true;

  canopyMiddle.instanceMatrix.needsUpdate =
    true;

  canopyTop.instanceMatrix.needsUpdate =
    true;


  environment.add(
    trunks,
    canopyLower,
    canopyMiddle,
    canopyTop
  );


  environment.userData.realmLifeFestivalJungle = {
    treeCount,

    district:
      "jungle-festival",

    riverReserved:
      true,
  };


  return environment;
}



function addFestivalAmenities(
  festival
) {
  const amenities =
    new THREE.Group();

  amenities.name =
    "RealmLifeFestivalAmenities";

  festival.add(
    amenities
  );


  const matDark =
    new THREE.MeshStandardMaterial({
      color:
        0x111418,

      roughness:
        0.95,
    });

  const matWood =
    new THREE.MeshStandardMaterial({
      color:
        0x5b3720,

      roughness:
        0.96,
    });

  const matSeat =
    new THREE.MeshStandardMaterial({
      color:
        0x1f242d,

      roughness:
        0.92,
    });

  const matLight =
    new THREE.MeshStandardMaterial({
      color:
        0xfff2c8,

      emissive:
        0xffd27a,

      emissiveIntensity:
        1.2,

      roughness:
        0.4,
    });

  const neonMat =
    (
      color,
      intensity = 1.7
    ) =>
      new THREE.MeshStandardMaterial({
        color,
        emissive:
          color,
        emissiveIntensity:
          intensity,
        roughness:
          0.45,
        metalness:
          0.1,
      });


  function addFloorPad(
    parent,
    {
      width,
      depth,
      color = 0x1a1f25,
      y = 0.035,
    }
  ) {
    const pad =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width,
          0.08,
          depth
        ),
        new THREE.MeshStandardMaterial({
          color,
          roughness:
            0.95,
        })
      );

    pad.position.y =
      y;

    pad.receiveShadow =
      true;

    parent.add(
      pad
    );

    return pad;
  }


  function addCornerBulbs(
    parent,
    width,
    depth,
    roofY
  ) {
    const bulbGeo =
      new THREE.SphereGeometry(
        0.22,
        10,
        10
      );

    const offsets = [
      [
        -width / 2 + 0.9,
        roofY - 0.45,
        -depth / 2 + 0.9,
      ],
      [
        width / 2 - 0.9,
        roofY - 0.45,
        -depth / 2 + 0.9,
      ],
      [
        -width / 2 + 0.9,
        roofY - 0.45,
        depth / 2 - 0.9,
      ],
      [
        width / 2 - 0.9,
        roofY - 0.45,
        depth / 2 - 0.9,
      ],
    ];

    offsets.forEach(
      (
        [
          x,
          y,
          z
        ]
      ) => {
        const bulb =
          new THREE.Mesh(
            bulbGeo,
            matLight
          );

        bulb.position.set(
          x,
          y,
          z
        );

        parent.add(
          bulb
        );
      }
    );
  }


  function addStringBulbs(
    parent,
    width,
    zLine,
    roofY,
    count,
    color = 0xffe28a
  ) {
    const bulbGeo =
      new THREE.SphereGeometry(
        0.15,
        8,
        8
      );

    const bulbMat =
      new THREE.MeshStandardMaterial({
        color,
        emissive:
          color,
        emissiveIntensity:
          1.25,
      });

    for (
      let i = 0;
      i < count;
      i += 1
    ) {
      const bulb =
        new THREE.Mesh(
          bulbGeo,
          bulbMat
        );

      const t =
        count === 1
          ? 0.5
          : i / (count - 1);

      bulb.position.set(
        -width / 2 + 1.1 + t * (width - 2.2),
        roofY - 0.55,
        zLine
      );

      parent.add(
        bulb
      );
    }
  }


  function addHighTopTable(
    parent,
    x,
    z,
    accent = 0x55ddff
  ) {
    const pole =
      new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.12,
          0.18,
          1.05,
          8
        ),
        matDark
      );

    pole.position.set(
      x,
      0.55,
      z
    );

    const top =
      new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.58,
          0.58,
          0.08,
          14
        ),
        neonMat(
          accent,
          0.7
        )
      );

    top.position.set(
      x,
      1.08,
      z
    );

    parent.add(
      pole,
      top
    );

    const stoolOffsets = [
      [ 0.78, 0 ],
      [ -0.39, 0.67 ],
      [ -0.39, -0.67 ],
    ];

    stoolOffsets.forEach(
      (
        [
          dx,
          dz
        ]
      ) => {
        const stool =
          new THREE.Mesh(
            new THREE.CylinderGeometry(
              0.2,
              0.24,
              0.6,
              8
            ),
            matSeat
          );

        stool.position.set(
          x + dx,
          0.3,
          z + dz
        );

        parent.add(
          stool
        );
      }
    );
  }


  function addCoffeeTable(
    parent,
    x,
    z,
    accent = 0xff5adb
  ) {
    const base =
      new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.14,
          0.18,
          0.55,
          8
        ),
        matDark
      );

    base.position.set(
      x,
      0.3,
      z
    );

    const top =
      new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.52,
          0.52,
          0.08,
          12
        ),
        neonMat(
          accent,
          0.65
        )
      );

    top.position.set(
      x,
      0.62,
      z
    );

    parent.add(
      base,
      top
    );
  }


  function addBench(
    parent,
    x,
    z,
    width,
    depth,
    accent = 0xff5adb
  ) {
    const base =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width,
          0.48,
          depth
        ),
        new THREE.MeshStandardMaterial({
          color:
            0x242935,
          roughness:
            0.95,
        })
      );

    base.position.set(
      x,
      0.28,
      z
    );

    parent.add(
      base
    );

    const trim =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width + 0.08,
          0.06,
          depth + 0.08
        ),
        neonMat(
          accent,
          0.9
        )
      );

    trim.position.set(
      x,
      0.55,
      z
    );

    parent.add(
      trim
    );
  }


  function addBarCounter(
    parent,
    x,
    z,
    width,
    accent = 0x55ddff
  ) {
    const bar =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width,
          1.08,
          1.05
        ),
        new THREE.MeshStandardMaterial({
          color:
            0x1d232b,
          roughness:
            0.9,
        })
      );

    bar.position.set(
      x,
      0.55,
      z
    );

    parent.add(
      bar
    );

    const top =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width + 0.12,
          0.1,
          1.18
        ),
        neonMat(
          accent,
          0.75
        )
      );

    top.position.set(
      x,
      1.13,
      z
    );

    parent.add(
      top
    );

    for (
      let i = 0;
      i < 4;
      i += 1
    ) {
      const t =
        4 === 1
          ? 0.5
          : i / 3;

      const stool =
        new THREE.Mesh(
          new THREE.CylinderGeometry(
            0.2,
            0.24,
            0.64,
            8
          ),
          matSeat
        );

      stool.position.set(
        x - width / 2 + 0.85 + t * (width - 1.7),
        0.32,
        z + 1.05
      );

      parent.add(
        stool
      );
    }
  }


  function addBoothCounter(
    parent,
    x,
    z,
    width,
    depth,
    accent = 0xffb347
  ) {
    const front =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width,
          1.05,
          0.85
        ),
        new THREE.MeshStandardMaterial({
          color:
            0x242126,
          roughness:
            0.92,
        })
      );

    front.position.set(
      x,
      0.54,
      z + depth / 2 - 0.6
    );

    parent.add(
      front
    );

    const top =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width + 0.08,
          0.08,
          0.95
        ),
        neonMat(
          accent,
          0.72
        )
      );

    top.position.set(
      x,
      1.12,
      z + depth / 2 - 0.6
    );

    parent.add(
      top
    );

    const backWall =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width,
          2.2,
          0.26
        ),
        new THREE.MeshStandardMaterial({
          color:
            0x181d23,
          roughness:
            0.93,
        })
      );

    backWall.position.set(
      x,
      1.22,
      z - depth / 2 + 0.35
    );

    parent.add(
      backWall
    );
  }


  function addTentStructure(
    parent,
    {
      width,
      depth,
      roofColor = 0x171b20,
      accent = 0xff5adb,
      wallColor = 0x1a1f25,
      openFront = true,
    }
  ) {
    const postGeo =
      new THREE.CylinderGeometry(
        0.18,
        0.22,
        6.8,
        8
      );

    const postMat =
      new THREE.MeshStandardMaterial({
        color:
          0x282d33,
        roughness:
          0.92,
      });

    const roofY = 6.65;

    const postOffsets = [
      [
        -width / 2 + 0.45,
        3.4,
        -depth / 2 + 0.45,
      ],
      [
        width / 2 - 0.45,
        3.4,
        -depth / 2 + 0.45,
      ],
      [
        -width / 2 + 0.45,
        3.4,
        depth / 2 - 0.45,
      ],
      [
        width / 2 - 0.45,
        3.4,
        depth / 2 - 0.45,
      ],
    ];

    postOffsets.forEach(
      (
        [
          x,
          y,
          z
        ]
      ) => {
        const post =
          new THREE.Mesh(
            postGeo,
            postMat
          );

        post.position.set(
          x,
          y,
          z
        );

        post.castShadow =
          true;

        parent.add(
          post
        );
      }
    );

    const roof =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width,
          0.32,
          depth
        ),
        new THREE.MeshStandardMaterial({
          color:
            roofColor,
          roughness:
            0.9,
        })
      );

    roof.position.set(
      0,
      roofY,
      0
    );

    roof.castShadow =
      true;

    parent.add(
      roof
    );

    const trimSizes = [
      [
        width,
        0.12,
        0.14,
        0,
        roofY - 0.14,
        -depth / 2,
      ],
      [
        width,
        0.12,
        0.14,
        0,
        roofY - 0.14,
        depth / 2,
      ],
      [
        0.14,
        0.12,
        depth,
        -width / 2,
        roofY - 0.14,
        0,
      ],
      [
        0.14,
        0.12,
        depth,
        width / 2,
        roofY - 0.14,
        0,
      ],
    ];

    trimSizes.forEach(
      (
        [
          sx,
          sy,
          sz,
          px,
          py,
          pz
        ]
      ) => {
        const trim =
          new THREE.Mesh(
            new THREE.BoxGeometry(
              sx,
              sy,
              sz
            ),
            neonMat(
              accent,
              1.3
            )
          );

        trim.position.set(
          px,
          py,
          pz
        );

        parent.add(
          trim
        );
      }
    );

    const backDrape =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width - 1.2,
          2.6,
          0.12
        ),
        new THREE.MeshStandardMaterial({
          color:
            wallColor,
          roughness:
            0.94,
        })
      );

    backDrape.position.set(
      0,
      4.2,
      -depth / 2 + 0.3
    );

    parent.add(
      backDrape
    );

    const leftDrape =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.12,
          2.5,
          depth - 1.2
        ),
        new THREE.MeshStandardMaterial({
          color:
            wallColor,
          roughness:
            0.94,
        })
      );

    leftDrape.position.set(
      -width / 2 + 0.3,
      4.15,
      0
    );

    const rightDrape =
      leftDrape.clone();

    rightDrape.position.x =
      width / 2 - 0.3;

    parent.add(
      leftDrape,
      rightDrape
    );

    addCornerBulbs(
      parent,
      width,
      depth,
      roofY
    );

    addStringBulbs(
      parent,
      width,
      depth / 2 - 0.55,
      roofY,
      6
    );

    addStringBulbs(
      parent,
      width,
      -depth / 2 + 0.55,
      roofY,
      6
    );
  }


  function addLoungeTent(
    {
      x,
      z,
      width,
      depth,
      accent,
      padColor,
      roofColor,
    }
  ) {
    const g =
      new THREE.Group();

    g.position.set(
      x,
      0,
      z
    );

    amenities.add(
      g
    );

    addFloorPad(
      g,
      {
        width:
          width + 2.8,
        depth:
          depth + 2.4,
        color:
          padColor,
      }
    );

    addTentStructure(
      g,
      {
        width,
        depth,
        accent,
        roofColor,
        wallColor:
          0x181d27,
      }
    );

    addBench(
      g,
      -width * 0.22,
      0,
      2.6,
      1.25,
      accent
    );

    addBench(
      g,
      width * 0.22,
      0,
      2.6,
      1.25,
      accent
    );

    addBench(
      g,
      0,
      -depth * 0.16,
      3.2,
      1.15,
      accent
    );

    addCoffeeTable(
      g,
      0,
      0.7,
      accent
    );

    addHighTopTable(
      g,
      -width * 0.28,
      depth * 0.22,
      accent
    );

    addHighTopTable(
      g,
      width * 0.28,
      depth * 0.22,
      accent
    );
  }


  function addBarTent(
    {
      x,
      z,
      width,
      depth,
      accent,
      padColor,
      roofColor,
    }
  ) {
    const g =
      new THREE.Group();

    g.position.set(
      x,
      0,
      z
    );

    amenities.add(
      g
    );

    addFloorPad(
      g,
      {
        width:
          width + 3.2,
        depth:
          depth + 2.4,
        color:
          padColor,
      }
    );

    addTentStructure(
      g,
      {
        width,
        depth,
        accent,
        roofColor,
        wallColor:
          0x131b24,
      }
    );

    addBarCounter(
      g,
      0,
      -depth * 0.1,
      width * 0.58,
      accent
    );

    addHighTopTable(
      g,
      -width * 0.25,
      depth * 0.24,
      accent
    );

    addHighTopTable(
      g,
      width * 0.25,
      depth * 0.24,
      accent
    );
  }


  function addBoothTent(
    {
      x,
      z,
      width,
      depth,
      accent,
      padColor,
      roofColor,
    }
  ) {
    const g =
      new THREE.Group();

    g.position.set(
      x,
      0,
      z
    );

    amenities.add(
      g
    );

    addFloorPad(
      g,
      {
        width:
          width + 2.2,
        depth:
          depth + 1.8,
        color:
          padColor,
      }
    );

    addTentStructure(
      g,
      {
        width,
        depth,
        accent,
        roofColor,
        wallColor:
          0x1a1b1f,
      }
    );

    addBoothCounter(
      g,
      0,
      0,
      width * 0.72,
      depth,
      accent
    );
  }


  function addOpenPicnicCluster(
    {
      x,
      z,
      width,
      depth,
      accent,
      padColor,
    }
  ) {
    const g =
      new THREE.Group();

    g.position.set(
      x,
      0,
      z
    );

    amenities.add(
      g
    );

    addFloorPad(
      g,
      {
        width,
        depth,
        color:
          padColor,
      }
    );

    const lanternOffsets = [
      [
        -width / 2 + 0.7,
        -depth / 2 + 0.7,
      ],
      [
        width / 2 - 0.7,
        -depth / 2 + 0.7,
      ],
      [
        -width / 2 + 0.7,
        depth / 2 - 0.7,
      ],
      [
        width / 2 - 0.7,
        depth / 2 - 0.7,
      ],
    ];

    lanternOffsets.forEach(
      (
        [
          lx,
          lz
        ]
      ) => {
        const pole =
          new THREE.Mesh(
            new THREE.CylinderGeometry(
              0.1,
              0.12,
              2.6,
              8
            ),
            matDark
          );

        pole.position.set(
          lx,
          1.3,
          lz
        );

        const glow =
          new THREE.Mesh(
            new THREE.SphereGeometry(
              0.18,
              8,
              8
            ),
            neonMat(
              accent,
              1.2
            )
          );

        glow.position.set(
          lx,
          2.72,
          lz
        );

        g.add(
          pole,
          glow
        );
      }
    );

    addHighTopTable(
      g,
      -2.4,
      0,
      accent
    );

    addHighTopTable(
      g,
      2.4,
      0,
      accent
    );
  }


  // ========================================================
  // WEST SIDE
  // ========================================================

  addLoungeTent({
    x: -116,
    z: 170,
    width: 14,
    depth: 10,
    accent: 0xff59dc,
    padColor: 0x271727,
    roofColor: 0x17161d,
  });

  addBoothTent({
    x: -116,
    z: 225,
    width: 12,
    depth: 8,
    accent: 0xffae42,
    padColor: 0x2c2118,
    roofColor: 0x241d17,
  });


  // ========================================================
  // CENTER / BACK
  // ========================================================

  addBarTent({
    x: 0,
    z: 250,
    width: 18,
    depth: 11,
    accent: 0x46d9ff,
    padColor: 0x142330,
    roofColor: 0x161d25,
  });

  addOpenPicnicCluster({
    x: -26,
    z: 246,
    width: 10,
    depth: 8,
    accent: 0x7b6dff,
    padColor: 0x18212a,
  });

  addOpenPicnicCluster({
    x: 26,
    z: 246,
    width: 10,
    depth: 8,
    accent: 0xffd34c,
    padColor: 0x2b2618,
  });


  // ========================================================
  // EAST SIDE
  // ========================================================

  addLoungeTent({
    x: 116,
    z: 170,
    width: 14,
    depth: 10,
    accent: 0x4effcb,
    padColor: 0x163127,
    roofColor: 0x162019,
  });

  addBoothTent({
    x: 116,
    z: 225,
    width: 12,
    depth: 8,
    accent: 0x9f6dff,
    padColor: 0x20192d,
    roofColor: 0x1c1626,
  });


  // ========================================================
  // REAR EDGE SMALLER TENTS
  // ========================================================

  addLoungeTent({
    x: -58,
    z: 262,
    width: 11,
    depth: 9,
    accent: 0xffd247,
    padColor: 0x312b16,
    roofColor: 0x241f14,
  });

  addLoungeTent({
    x: 58,
    z: 262,
    width: 11,
    depth: 9,
    accent: 0x6dff7d,
    padColor: 0x17301d,
    roofColor: 0x162016,
  });


  amenities.userData.realmLifeFestivalAmenities = {
    zones: [
      "west-lounge",
      "west-food-booth",
      "center-glow-bar",
      "rear-picnic-left",
      "rear-picnic-right",
      "east-lounge",
      "east-merch-booth",
      "rear-vip-left",
      "rear-vip-right",
    ],
  };

  return amenities;
}



function addFestivalRiverwalkExtension(
  festival
) {
  const riverwalk =
    new THREE.Group();

  riverwalk.name =
    "RealmLifeFestivalRiverwalk";

  festival.add(
    riverwalk
  );


  const WATER_WIDTH =
    8;

  const WALK_WIDTH =
    2.4;

  const SIDE_X =
    98;

  const START_Z =
    106;

  const REAR_Z =
    274;


  const waterMaterial =
    new THREE.MeshStandardMaterial({
      color:
        0x087f9d,

      emissive:
        0x063d54,

      emissiveIntensity:
        0.7,

      roughness:
        0.32,

      metalness:
        0.12,
    });


  const walkMaterial =
    new THREE.MeshStandardMaterial({
      color:
        0x171c22,

      roughness:
        0.94,
    });


  const neonMaterial =
    new THREE.MeshStandardMaterial({
      color:
        0x2ee6ff,

      emissive:
        0x2ee6ff,

      emissiveIntensity:
        1.45,

      roughness:
        0.35,
    });


  function addWaterBox(
    x,
    z,
    width,
    depth
  ) {
    const water =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width,
          0.10,
          depth
        ),
        waterMaterial
      );

    water.position.set(
      x,
      0.055,
      z
    );

    water.receiveShadow =
      true;

    riverwalk.add(
      water
    );

    return water;
  }


  function addWalkBox(
    x,
    z,
    width,
    depth
  ) {
    const walk =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width,
          0.14,
          depth
        ),
        walkMaterial
      );

    walk.position.set(
      x,
      0.10,
      z
    );

    walk.receiveShadow =
      true;

    riverwalk.add(
      walk
    );

    return walk;
  }


  function addNeonBox(
    x,
    z,
    width,
    depth
  ) {
    const glow =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          width,
          0.035,
          depth
        ),
        neonMaterial
      );

    glow.position.set(
      x,
      0.185,
      z
    );

    riverwalk.add(
      glow
    );
  }


  // ========================================================
  // LEFT SIDE — existing Riverwalk -> festival rear
  // ========================================================

  {
    const length =
      REAR_Z -
      START_Z;

    const centerZ =
      (
        START_Z +
        REAR_Z
      ) /
      2;

    addWaterBox(
      -SIDE_X,
      centerZ,
      WATER_WIDTH,
      length
    );


    // Riverwalk on both banks.
    addWalkBox(
      -SIDE_X -
        WATER_WIDTH / 2 -
        WALK_WIDTH / 2,
      centerZ,
      WALK_WIDTH,
      length
    );

    addWalkBox(
      -SIDE_X +
        WATER_WIDTH / 2 +
        WALK_WIDTH / 2,
      centerZ,
      WALK_WIDTH,
      length
    );


    // Cyan edge lights.
    addNeonBox(
      -SIDE_X -
        WATER_WIDTH / 2 -
        WALK_WIDTH,
      centerZ,
      0.10,
      length
    );

    addNeonBox(
      -SIDE_X +
        WATER_WIDTH / 2 +
        WALK_WIDTH,
      centerZ,
      0.10,
      length
    );
  }


  // ========================================================
  // RIGHT SIDE — existing Riverwalk -> festival rear
  // ========================================================

  {
    const length =
      REAR_Z -
      START_Z;

    const centerZ =
      (
        START_Z +
        REAR_Z
      ) /
      2;

    addWaterBox(
      SIDE_X,
      centerZ,
      WATER_WIDTH,
      length
    );


    addWalkBox(
      SIDE_X -
        WATER_WIDTH / 2 -
        WALK_WIDTH / 2,
      centerZ,
      WALK_WIDTH,
      length
    );

    addWalkBox(
      SIDE_X +
        WATER_WIDTH / 2 +
        WALK_WIDTH / 2,
      centerZ,
      WALK_WIDTH,
      length
    );


    addNeonBox(
      SIDE_X -
        WATER_WIDTH / 2 -
        WALK_WIDTH,
      centerZ,
      0.10,
      length
    );

    addNeonBox(
      SIDE_X +
        WATER_WIDTH / 2 +
        WALK_WIDTH,
      centerZ,
      0.10,
      length
    );
  }


  // ========================================================
  // REAR CONNECTION
  //
  // Joins both sides behind the three stages.
  // ========================================================

  {
    const length =
      SIDE_X * 2 +
      WATER_WIDTH;

    addWaterBox(
      0,
      REAR_Z,
      length,
      WATER_WIDTH
    );


    addWalkBox(
      0,
      REAR_Z -
        WATER_WIDTH / 2 -
        WALK_WIDTH / 2,
      length,
      WALK_WIDTH
    );

    addWalkBox(
      0,
      REAR_Z +
        WATER_WIDTH / 2 +
        WALK_WIDTH / 2,
      length,
      WALK_WIDTH
    );


    addNeonBox(
      0,
      REAR_Z -
        WATER_WIDTH / 2 -
        WALK_WIDTH,
      length,
      0.10
    );

    addNeonBox(
      0,
      REAR_Z +
        WATER_WIDTH / 2 +
        WALK_WIDTH,
      length,
      0.10
    );
  }


  // ========================================================
  // SIMPLE RIVERWALK LIGHT POSTS
  // ========================================================

  const lampMaterial =
    new THREE.MeshStandardMaterial({
      color:
        0x15191f,

      roughness:
        0.9,
    });


  const lampGlow =
    new THREE.MeshStandardMaterial({
      color:
        0xbdf7ff,

      emissive:
        0x5eeaff,

      emissiveIntensity:
        1.5,
    });


  function addLamp(
    x,
    z
  ) {
    const pole =
      new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.09,
          0.12,
          3.6,
          8
        ),
        lampMaterial
      );

    pole.position.set(
      x,
      1.8,
      z
    );

    riverwalk.add(
      pole
    );


    const light =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.55,
          0.14,
          0.38
        ),
        lampGlow
      );

    light.position.set(
      x,
      3.65,
      z
    );

    riverwalk.add(
      light
    );
  }


  for (
    let z =
      START_Z + 18;
    z <
      REAR_Z - 12;
    z += 28
  ) {
    addLamp(
      -SIDE_X - 6.6,
      z
    );

    addLamp(
      SIDE_X + 6.6,
      z
    );
  }


  for (
    let x = -80;
    x <= 80;
    x += 32
  ) {
    addLamp(
      x,
      REAR_Z + 6.6
    );
  }


  riverwalk.userData.realmLifeRiverwalk = {
    id:
      "festival-riverwalk-extension",

    layout:
      "u-shaped",

    stageCenters: [
      [-60, 200],
      [0, 200],
      [60, 200],
    ],

    connectsTo:
      "downtown-riverwalk",
  };


  return riverwalk;
}



function addFestivalStage(
  festival,
  {
    id,
    label,
    x,
    z,
    color,
  }
) {
  const root =
    new THREE.Group();

  root.name =
    `RealmLifeFestivalStage:${id}`;

  root.position.set(
    x,
    0,
    z
  );


  root.userData.realmLifeStage = {
    id,

    accessMode:
      "public_open",

    entranceOnly:
      true,

    audioZone:
      `${id}-audio`,
  };


  // Existing Genesis City interaction bridge automatically
  // registers these with click/tap/mobile interaction.
  root.userData.genesisInteractiveId =
    id;

  root.userData.genesisInteractiveLabel =
    label;

  root.userData.genesisInteractiveActions = [
    {
      id:
        "festival:stage-control",

      label:
        "🎵 Stage Control",
    },
  ];

  root.userData.genesisInteractiveApproach =
    [
      0,
      -22,
    ];


  festival.add(root);


  const lawnW = 42;
  const lawnD = 44;


  // Giant lawn
  plane(root, {
    x: 240,
    z: 340,
    w: lawnW,
    d: lawnD,
    color: 0x214f2f,
  });


  // Lawn glow outline
  glow(root, {
    x: 0,
    z: -lawnD / 2,
    w: lawnW,
    color,
  });

  glow(root, {
    x: 0,
    z: lawnD / 2,
    w: lawnW,
    color,
  });

  glow(root, {
    x: -lawnW / 2,
    z: 0,
    w: 0.08,
    d: lawnD,
    color,
  });

  glow(root, {
    x: lawnW / 2,
    z: 0,
    w: 0.08,
    d: lawnD,
    color,
  });


  addFence(
    root,
    lawnW,
    lawnD,
    color
  );


  // MAIN STAGE AT BACK OF LAWN
  box(root, {
    x: 0,
    y: 1.2,
    z: 15,
    w: 22,
    h: 2.4,
    d: 8,
    color: 0x0c1219,
  });


  // Stage roof
  box(root, {
    x: 0,
    y: 8,
    z: 16,
    w: 25,
    h: 0.8,
    d: 10,
    color: 0x101820,
  });


  // Four towers
  for (
    const sx of [-11, 11]
  ) {
    for (
      const sz of [12, 20]
    ) {
      box(root, {
        x: sx,
        y: 4.5,
        z: sz,
        w: 0.55,
        h: 9,
        d: 0.55,
        color: 0x202a34,
      });

      glow(root, {
        x: sx,
        y: 4.5,
        z: sz - 0.32,
        w: 0.16,
        h: 8,
        d: 0.12,
        color,
      });
    }
  }


  // Giant LED stage screen
  glow(root, {
    x: 0,
    y: 4.8,
    z: 11.9,
    w: 15,
    h: 6,
    d: 0.18,
    color,
  });


  const stageSign =
    labelSprite(
      label,
      color
    );

  stageSign.position.set(
    0,
    10.2,
    15
  );

  root.add(
    stageSign
  );


  const entranceSign =
    labelSprite(
      `${label} · ENTRANCE`,
      color
    );

  entranceSign.position.set(
    0,
    4,
    -lawnD / 2
  );

  entranceSign.scale.set(
    10,
    2.5,
    1
  );

  root.add(
    entranceSign
  );


  return {
    id,
    label,
    x,
    z,
    accessMode:
      "public_open",
    audioZone:
      `${id}-audio`,
  };
}


/*
 * TEMP FESTIVAL VISUAL TEST
 *
 * NO NEW RIVER
 * NO NEW HQ
 * NO NEW CENTRAL STATION
 *
 * Existing city / Riverwalk / homes / neighborhoods remain.
 */
export function installRealmLifeGenesisExpansion({
  root,
}) {
  if (!root) {
    return {
      root: null,
      pois: [],
    };
  }


  const festival =
    new THREE.Group();

  festival.name =
    "RealmLifeJungleFestivalVisualTest";

  root.add(
    festival
  );


  // This is the former north station / tower area.
  // Three stages only for the visual layout test.
  // Permanent jungle/park environment surrounding
  // all three festival stage lawns.
  addFestivalJungle(
    festival
  );

  addFestivalAmenities(
    festival
  );

  addFestivalRiverwalkExtension(
    festival
  );


  const stages = [
    addFestivalStage(
      festival,
      {
        id:
          "festival-stage-one",

        label:
          "STAGE ONE",

        x:
          -60,

        z:
          200,

        color:
          0x10e670,
      }
    ),

    addFestivalStage(
      festival,
      {
        id:
          "festival-stage-two",

        label:
          "STAGE TWO",

        x:
          0,

        z:
          200,

        color:
          0xff4fd8,
      }
    ),

    addFestivalStage(
      festival,
      {
        id:
          "festival-stage-three",

        label:
          "STAGE THREE",

        x:
          60,

        z:
          200,

        color:
          0x2ea0ff,
      }
    ),
  ];


  festival.userData.realmLifeFestival = {
    districtId:
      "jungle-festival",

    accessMode:
      "public_open",

    stages,
  };


  return {
    root:
      festival,

    pois:
      stages.map(
        (stage) => ({
          id:
            stage.id,

          type:
            "festival_stage",

          x:
            0,

          z:
            315,
        })
      ),
  };
}
