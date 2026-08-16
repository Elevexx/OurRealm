import * as THREE from "three";

/*
 * REALMLIFE V5G1B1
 * Spanish Luxury Interior Visual Foundation
 *
 * IMPORTANT:
 * Existing object IDs, positions, interactions and colliders remain
 * authoritative. This module only upgrades presentation.
 */

const mat = (
  color,
  {
    roughness = 0.62,
    metalness = 0.04,
    emissive = 0x000000,
    emissiveIntensity = 0,
    transparent = false,
    opacity = 1,
  } = {}
) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
    transparent,
    opacity,
  });


function part(
  parent,
  geometry,
  material,
  {
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    cast = true,
    receive = true,
  } = {}
) {
  const mesh =
    new THREE.Mesh(
      geometry,
      material
    );

  mesh.position.set(
    x,
    y,
    z
  );

  mesh.rotation.set(
    rx,
    ry,
    rz
  );

  mesh.castShadow =
    cast;

  mesh.receiveShadow =
    receive;

  parent.add(
    mesh
  );

  return mesh;
}


function replaceMaterial(
  object,
  material
) {
  if (!object?.isMesh)
    return;

  object.material =
    material;
}


function polishBed(root) {

  replaceMaterial(
    root,
    mat(
      0x5a321f,
      {
        roughness: 0.7,
      }
    )
  );


  /*
   * Walnut frame + cream mattress +
   * terracotta throw = Spanish luxury.
   */

  part(
    root,
    new THREE.BoxGeometry(
      2.78,
      0.24,
      1.78
    ),
    mat(0xf1e4cf),
    {
      y: 0.42,
    }
  );


  part(
    root,
    new THREE.BoxGeometry(
      0.18,
      1.25,
      2.06
    ),
    mat(0x4a291b),
    {
      x: -1.5,
      y: 0.48,
    }
  );


  part(
    root,
    new THREE.BoxGeometry(
      0.55,
      0.14,
      0.65
    ),
    mat(0xf8f1e5),
    {
      x: -1.03,
      y: 0.61,
      z: -0.43,
    }
  );


  part(
    root,
    new THREE.BoxGeometry(
      0.55,
      0.14,
      0.65
    ),
    mat(0xf8f1e5),
    {
      x: -1.03,
      y: 0.61,
      z: 0.43,
    }
  );


  part(
    root,
    new THREE.BoxGeometry(
      1.35,
      0.06,
      1.76
    ),
    mat(0xb65a39),
    {
      x: 0.63,
      y: 0.59,
    }
  );
}


function polishSofa(root) {

  replaceMaterial(
    root,
    mat(0xc49a73)
  );


  part(
    root,
    new THREE.BoxGeometry(
      2.88,
      0.72,
      0.25
    ),
    mat(0xa86d4d),
    {
      y: 0.56,
      z: 0.48,
    }
  );


  for (
    const x of [
      -0.93,
      0,
      0.93,
    ]
  ) {

    part(
      root,
      new THREE.BoxGeometry(
        0.84,
        0.18,
        0.83
      ),
      mat(0xe0c09d),
      {
        x,
        y: 0.50,
        z: -0.08,
      }
    );
  }


  for (
    const x of [
      -1.43,
      1.43,
    ]
  ) {

    part(
      root,
      new THREE.BoxGeometry(
        0.22,
        0.58,
        1.12
      ),
      mat(0x8d573d),
      {
        x,
        y: 0.35,
      }
    );
  }
}


function polishFridge(root) {

  replaceMaterial(
    root,
    mat(
      0xd8d6cf,
      {
        roughness: 0.32,
        metalness: 0.45,
      }
    )
  );


  part(
    root,
    new THREE.BoxGeometry(
      0.04,
      0.72,
      0.06
    ),
    mat(
      0x3e4347,
      {
        metalness: 0.72,
        roughness: 0.25,
      }
    ),
    {
      x: 0.32,
      y: 0.28,
      z: -0.57,
    }
  );


  part(
    root,
    new THREE.BoxGeometry(
      1.05,
      0.025,
      0.03
    ),
    mat(0x8c8c86),
    {
      y: -0.08,
      z: -0.56,
    }
  );
}


function polishStove(root) {

  replaceMaterial(
    root,
    mat(
      0x39322e,
      {
        metalness: 0.32,
        roughness: 0.38,
      }
    )
  );


  const cooktop =
    part(
      root,
      new THREE.BoxGeometry(
        1.38,
        0.07,
        0.95
      ),
      mat(
        0x121416,
        {
          metalness: 0.32,
          roughness: 0.18,
        }
      ),
      {
        y: 0.56,
      }
    );


  for (
    const x of [-0.4, 0.4]
  ) {
    for (
      const z of [-0.25, 0.25]
    ) {

      part(
        cooktop,
        new THREE.CylinderGeometry(
          0.14,
          0.14,
          0.025,
          20
        ),
        mat(
          0x232323,
          {
            metalness: 0.55,
          }
        ),
        {
          x,
          y: 0.05,
          z,
        }
      );
    }
  }


  part(
    root,
    new THREE.BoxGeometry(
      0.84,
      0.47,
      0.025
    ),
    mat(
      0x090b0d,
      {
        roughness: 0.12,
        metalness: 0.25,
      }
    ),
    {
      y: -0.02,
      z: -0.54,
    }
  );
}


function polishTV(root) {

  replaceMaterial(
    root,
    mat(
      0x111417,
      {
        roughness: 0.25,
        metalness: 0.28,
      }
    )
  );


  part(
    root,
    new THREE.BoxGeometry(
      1.88,
      1.15,
      0.025
    ),
    mat(
      0x07141a,
      {
        emissive: 0x123f4f,
        emissiveIntensity: 0.7,
        roughness: 0.12,
      }
    ),
    {
      z: -0.215,
    }
  );


  part(
    root,
    new THREE.BoxGeometry(
      0.45,
      0.08,
      0.32
    ),
    mat(0x27211d),
    {
      y: -0.73,
    }
  );
}


function polishComputer(root) {

  replaceMaterial(
    root,
    mat(0x74492e)
  );


  part(
    root,
    new THREE.BoxGeometry(
      1.18,
      0.70,
      0.08
    ),
    mat(
      0x12191e,
      {
        emissive: 0x0a4555,
        emissiveIntensity: 0.55,
      }
    ),
    {
      y: 0.58,
      z: -0.34,
    }
  );


  part(
    root,
    new THREE.BoxGeometry(
      0.10,
      0.38,
      0.10
    ),
    mat(0x272727),
    {
      y: 0.23,
      z: -0.28,
    }
  );
}


function polishShower(root) {

  replaceMaterial(
    root,
    mat(
      0x9bdde2,
      {
        transparent: true,
        opacity: 0.26,
        roughness: 0.1,
        metalness: 0.08,
      }
    )
  );


  const frame =
    mat(
      0x3c4747,
      {
        metalness: 0.65,
        roughness: 0.28,
      }
    );


  for (
    const x of [-0.70, 0.70]
  ) {
    for (
      const z of [-0.70, 0.70]
    ) {

      part(
        root,
        new THREE.BoxGeometry(
          0.06,
          2.05,
          0.06
        ),
        frame,
        {
          x,
          z,
        }
      );
    }
  }
}


function polishToilet(root) {

  replaceMaterial(
    root,
    mat(0xf0ede4)
  );


  part(
    root,
    new THREE.CylinderGeometry(
      0.36,
      0.30,
      0.16,
      24
    ),
    mat(0xf7f4eb),
    {
      y: 0.40,
      rx: Math.PI / 2,
    }
  );


  part(
    root,
    new THREE.BoxGeometry(
      0.68,
      0.58,
      0.32
    ),
    mat(0xf1eee6),
    {
      y: 0.46,
      z: 0.34,
    }
  );
}


function polishChair(root) {

  replaceMaterial(
    root,
    mat(0xa25f3f)
  );


  part(
    root,
    new THREE.BoxGeometry(
      0.92,
      0.18,
      0.90
    ),
    mat(0xe1b98e),
    {
      y: 0.27,
    }
  );


  part(
    root,
    new THREE.BoxGeometry(
      0.92,
      0.88,
      0.16
    ),
    mat(0x8e5137),
    {
      y: 0.54,
      z: 0.46,
    }
  );
}


function polishPlant(root) {

  replaceMaterial(
    root,
    mat(0x8d5a38)
  );


  part(
    root,
    new THREE.CylinderGeometry(
      0.31,
      0.24,
      0.46,
      16
    ),
    mat(0xb86b48),
    {
      y: 0.24,
    }
  );


  for (
    let i = 0;
    i < 7;
    i += 1
  ) {

    const angle =
      (i / 7) *
      Math.PI *
      2;


    part(
      root,
      new THREE.SphereGeometry(
        0.25,
        10,
        8
      ),
      mat(0x347647),
      {
        x:
          Math.cos(angle) *
          0.22,

        y:
          0.65
          + (i % 2) *
            0.18,

        z:
          Math.sin(angle) *
          0.22,
      }
    );
  }
}


function polishBookcase(root) {

  replaceMaterial(
    root,
    mat(0x5a341f)
  );


  const shelfMaterial =
    mat(0x321c12);


  for (
    const y of [
      -0.65,
      -0.15,
      0.35,
      0.82,
    ]
  ) {

    part(
      root,
      new THREE.BoxGeometry(
        1.30,
        0.06,
        0.50
      ),
      shelfMaterial,
      {
        y,
      }
    );
  }


  const bookColors = [
    0x9c4638,
    0x2f5a67,
    0xc28a3f,
    0x526a43,
    0x6c486f,
  ];


  for (
    let i = 0;
    i < 10;
    i += 1
  ) {

    part(
      root,
      new THREE.BoxGeometry(
        0.085,
        0.34,
        0.32
      ),
      mat(
        bookColors[
          i %
          bookColors.length
        ]
      ),
      {
        x:
          -0.51
          + i * 0.11,

        y: 0.12,
        z: -0.08,
      }
    );
  }
}


export function polishRealmLifeObject(
  object
) {

  if (
    !object
    ||
    object.userData
      ?.realmLifeVisualPolished
  ) {
    return;
  }


  const id =
    String(
      object.userData?.id
      || ""
    ).toLowerCase();


  const label =
    String(
      object.userData?.label
      || ""
    ).toLowerCase();


  if (id === "bed")
    polishBed(object);

  else if (id === "sofa")
    polishSofa(object);

  else if (id === "fridge")
    polishFridge(object);

  else if (id === "stove")
    polishStove(object);

  else if (id === "tv")
    polishTV(object);

  else if (id === "computer")
    polishComputer(object);

  else if (id === "shower")
    polishShower(object);

  else if (id === "toilet")
    polishToilet(object);

  else if (
    label.includes(
      "cozy chair"
    )
  )
    polishChair(object);

  else if (
    label.includes(
      "house plant"
    )
  )
    polishPlant(object);

  else if (
    label.includes(
      "bookcase"
    )
  )
    polishBookcase(object);

  else
    return;


  object.userData
    .realmLifeVisualPolished =
      true;
}


export function applyRealmLifeVisualPolish(
  scene
) {

  if (!scene)
    return;


  const targets = [];


  scene.traverse(
    (object) => {

      if (
        object.userData
          ?.lifeObject
      ) {
        targets.push(
          object
        );
      }
    }
  );


  targets.forEach(
    polishRealmLifeObject
  );


  console.log(
    "[RealmLife] Spanish luxury furniture visual pass:",
    targets.length,
    "interactive objects scanned"
  );
}
