import * as THREE from "three";

import {
  GLTFLoader,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  DRACOLoader,
} from "three/examples/jsm/loaders/DRACOLoader.js";

import {
  KTX2Loader,
} from "three/examples/jsm/loaders/KTX2Loader.js";

import {
  clone as skeletonClone,
} from "three/examples/jsm/utils/SkeletonUtils.js";


const draco =
  new DRACOLoader();

draco.setDecoderPath(
  "/draco/"
);


let ktx2 =
  null;

const cache =
  new Map();


export function initRealmLifeAAAAssets(
  renderer
) {
  if (
    renderer
    && !ktx2
  ) {
    ktx2 =
      new KTX2Loader()
        .setTranscoderPath(
          "/basis/"
        );

    ktx2.detectSupport(
      renderer
    );
  }
}


function makeLoader() {
  const loader =
    new GLTFLoader();

  loader.setDRACOLoader(
    draco
  );

  if (ktx2) {
    loader.setKTX2Loader(
      ktx2
    );
  }

  return loader;
}


async function source(
  url
) {
  if (!url)
    throw new Error(
      "RealmLife asset URL missing."
    );

  if (
    !cache.has(url)
  ) {
    cache.set(
      url,
      new Promise(
        (
          resolve,
          reject
        ) => {
          makeLoader().load(
            url,
            resolve,
            undefined,
            reject
          );
        }
      )
    );
  }

  return cache.get(
    url
  );
}


export async function loadRealmLifeAAAAsset({
  url,

  height = null,

  scale = 1,

  rotationY = 0,

  castShadow = true,

  receiveShadow = true,
}) {
  const gltf =
    await source(
      url
    );

  const root =
    skeletonClone(
      gltf.scene
    );

  root.rotation.y =
    rotationY;


  if (
    Number.isFinite(
      Number(height)
    )
    && Number(height) > 0
  ) {
    root.updateMatrixWorld(
      true
    );

    let box =
      new THREE.Box3()
        .setFromObject(
          root
        );

    const currentHeight =
      Math.max(
        0.001,
        box.max.y
        - box.min.y
      );

    root.scale.multiplyScalar(
      Number(height)
      / currentHeight
    );
  }


  root.scale.multiplyScalar(
    Number(scale)
    || 1
  );


  root.traverse(
    (obj) => {
      if (
        obj.isMesh
        || obj.isSkinnedMesh
      ) {
        obj.castShadow =
          castShadow;

        obj.receiveShadow =
          receiveShadow;
      }
    }
  );


  return {
    root,

    animations:
      gltf.animations
      || [],
  };
}


export function clearRealmLifeAssetCache() {
  cache.clear();
}
