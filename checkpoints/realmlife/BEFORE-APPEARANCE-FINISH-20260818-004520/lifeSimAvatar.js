import * as THREE from "three";

import {
  GLTFLoader,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  DRACOLoader,
} from "three/examples/jsm/loaders/DRACOLoader.js";


const draco =
  new DRACOLoader();

draco.setDecoderPath(
  "/draco/"
);


function loader() {
  const l =
    new GLTFLoader();

  l.setDRACOLoader(
    draco
  );

  return l;
}


function loadGLTF(url) {
  return cachedLoadGLTF(url);
}


// ==========================================================
// REALMLIFE AVATAR LOAD CACHE
//
// 1) In-memory: the same GLB is parsed at most once per
//    session (camera/tab switches reuse the parsed source).
// 2) Cache Storage: content-hashed model URLs are immutable,
//    so the raw bytes persist across visits — repeat loads
//    skip the network completely.
// ==========================================================

const gltfMemoryCache = new Map();

const MODEL_CACHE_NAME = "realmlife-models-v1";

async function fetchModelBytes(url) {
  const abs = url.startsWith("http")
    ? url
    : `${window.location.origin.includes("localhost")
        ? (process.env.REACT_APP_BACKEND_URL || "")
        : ""}${url}`;

  try {
    if ("caches" in window) {
      const cache = await caches.open(MODEL_CACHE_NAME);
      const hit = await cache.match(abs);
      if (hit) return hit.arrayBuffer();

      const res = await fetch(abs);
      if (!res.ok) throw new Error(`model fetch ${res.status}`);
      try {
        await cache.put(abs, res.clone());
      } catch (_) {}
      return res.arrayBuffer();
    }
  } catch (_) {}

  const res = await fetch(abs);
  if (!res.ok) throw new Error(`model fetch ${res.status}`);
  return res.arrayBuffer();
}

function parseGLTF(buffer) {
  return new Promise((resolve, reject) => {
    loader().parse(buffer, "", resolve, reject);
  });
}

function cachedLoadGLTF(url) {
  if (gltfMemoryCache.has(url)) {
    return gltfMemoryCache.get(url);
  }

  const promise = fetchModelBytes(url)
    .then(parseGLTF)
    .catch((err) => {
      gltfMemoryCache.delete(url);
      // fallback to the classic loader path
      return new Promise((resolve, reject) => {
        loader().load(url, resolve, undefined, reject);
      });
    });

  gltfMemoryCache.set(url, promise);
  return promise;
}

// Background warm-up used by /realmlife to preload the selected
// player's gameplay model while the page is idle.
export function preloadRealmLifeModel(url) {
  if (!url) return;
  const start = () => {
    fetchModelBytes(url).catch(() => {});
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 8000 });
  } else {
    window.setTimeout(start, 2500);
  }
}


function wait(ms) {
  return new Promise(
    (resolve) =>
      window.setTimeout(
        resolve,
        ms
      )
  );
}


function normalizeName(name) {
  return String(
    name || ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /[\s-]+/g,
      "_"
    );
}


const NAME_ALIASES = {
  idle:
    [
      "idle",
      "standing_idle",
      "stand_idle",
    ],

  walk:
    [
      "walk",
      "walking",
      "walk_forward",
    ],

  run:
    [
      "run",
      "running",
      "run_forward",
    ],

  jump:
    [
      "jump",
      "jumping",
    ],

  sit_down:
    [
      "sit_down",
      "sitdown",
      "sitting_down",
    ],

  sit_idle:
    [
      "sit_idle",
      "sitting",
      "seated_idle",
    ],

  stand_up:
    [
      "stand_up",
      "standup",
      "standing_up",
    ],

  lie_down:
    [
      "lie_down",
      "liedown",
      "lay_down",
      "laying_down",
    ],

  sleep:
    [
      "sleep",
      "sleeping",
    ],

  wake_up:
    [
      "wake_up",
      "wakeup",
    ],

  talk:
    [
      "talk",
      "talking",
      "conversation",
    ],

  greet:
    [
      "greet",
      "greeting",
      "wave",
    ],

  phone:
    [
      "phone",
      "phone_use",
    ],

  drink:
    [
      "drink",
      "drinking",
    ],

  open_door:
    [
      "open_door",
      "door_open",
    ],
};



/*
 * ===========================================================
 * REALMLIFE — DISCRETE PLAYER APPEARANCE MODELS
 * ===========================================================
 *
 * These are REAL GLB model swaps.
 *
 * No shader skin recoloring is used for Player 1 / Player 2.
 *
 * Appearance:
 *   1 = original/default
 *   2 = medium
 *   3 = dark
 * ===========================================================
 */

export const REALMLIFE_APPEARANCE_MODELS = {
  player_1: {
    1:
      REALMLIFE_PLAYER_MODELS.player_1.modelUrl,

    2:
      "/api/media/models/8c298548650e7157896cfdb452254cc9.glb",

    3:
      "/api/media/models/299c448ae83122d3549c3492699c8521.glb",
  },

  player_2: {
    1:
      REALMLIFE_PLAYER_MODELS.player_2.modelUrl,

    2:
      "/api/media/models/7f33f4911a278210ebfde44eeaf62a86.glb",

    3:
      "/api/media/models/2820f03039de848e0d4e871989ecb712.glb",
  },
};


export function getRealmLifeAppearanceModel(
  playerId,
  appearance = 1
) {
  const family =
    REALMLIFE_APPEARANCE_MODELS[
      playerId
    ];

  if (!family) {
    return (
      REALMLIFE_PLAYER_MODELS[
        playerId
      ]?.modelUrl
      || null
    );
  }

  const number =
    Math.max(
      1,
      Math.min(
        3,
        Number(
          appearance
        ) || 1
      )
    );

  return (
    family[number]
    || family[1]
  );
}

function canonicalName(
  raw
) {
  const n =
    normalizeName(raw);

  for (
    const [
      canonical,
      aliases,
    ]
    of Object.entries(
      NAME_ALIASES
    )
  ) {
    if (
      aliases.includes(n)
    ) {
      return canonical;
    }
  }

  return n;
}


/*
 * Universal RealmLife interaction motion pack.
 *
 * Nexus supplies each avatar's own locomotion motion wherever
 * available. These are the RealmLife interaction motions that
 * can be shared by compatible humanoid rigs.
 */
export const REALMLIFE_UNIVERSAL_MOTIONS = {
  sit_down:
    "/api/media/models/33efee3c19c75925f5d3b0e31ec22bb4.glb",

  sit_idle:
    "/api/media/models/40dc7c75b25d8e2bbc6cb750622da1a5.glb",

  stand_up:
    "/api/media/models/83b9490897ccec3b19c744fb2850041f.glb",

  lie_down:
    "/api/media/models/8b660ce1ba67aaccec3c5724e74bc0fa.glb",

  sleep:
    "/api/media/models/4075ce21d999900d7c85c016c0b20aca.glb",

  wake_up:
    "/api/media/models/2153f3b1dc6e760de979dabc0df5a1d3.glb",

  talk:
    "/api/media/models/238d154636ea64b49248f995e2507013.glb",

  phone:
    "/api/media/models/89e5cb5314b6e491afec0b0dec6ec854.glb",

  drink:
    "/api/media/models/45aa7de86bc5c49204ff1ff02a10b181.glb",

  open_door:
    "/api/media/models/06ac4870b852cce736420bee0d91a0ec.glb",
};


/*
 * ===========================================================
 * REALMLIFE FINAL PLAYER MODEL REGISTRY
 * ===========================================================
 *
 * RealmLife is independent from Nexus avatar selection.
 *
 * DO NOT replace or modify Founder Stealth without an explicit
 * Founder request.
 */
export const REALMLIFE_PLAYER_MODELS = {
  founder_stealth: {
    id:
      "founder_stealth",

    modelUrl:
      "/api/media/models/e1f28ff8f8fe3ea0df4b6b0cf848b756.glb",
  },

  player_1: {
    id:
      "player_1",

    label:
      "Player 1",

    modelUrl:
      "/api/media/models/698bcea39a7e273b446da21a6580a30a_game.glb",
  },

  player_2: {
    id:
      "player_2",

    label:
      "Player 2",

    modelUrl:
      "/api/media/models/8787f255e4c1d0db42460c66bdc1bafc_game.glb",
  },
};


/*
 * Emergency fallback only.
 *
 * Normal RealmLife player loading now comes from Nexus.
 */
export const DEFAULT_AVERY_AVATAR = {
  modelUrl:
    REALMLIFE_PLAYER_MODELS.player_1.modelUrl,

  animationUrls: {
    ...REALMLIFE_UNIVERSAL_MOTIONS,
  },
};



function parseMotionSpec(raw) {
  const value =
    String(raw || "");

  const hash =
    value.indexOf("#");

  if (hash < 0) {
    return {
      url: value,
      clipName: null,
      speed: 1,
    };
  }

  const url =
    value.slice(
      0,
      hash
    );

  const fragment =
    value.slice(
      hash + 1
    );

  const at =
    fragment.lastIndexOf("@");

  let clipName =
    fragment;

  let speed =
    1;

  if (at >= 0) {
    clipName =
      fragment.slice(
        0,
        at
      );

    const rawSpeed =
      fragment.slice(
        at + 1
      );

    if (rawSpeed !== "") {
      const parsed =
        Number(rawSpeed);

      if (
        Number.isFinite(parsed)
      ) {
        speed = parsed;
      }
    }
  }

  return {
    url,
    clipName:
      clipName || null,
    speed,
  };
}


function findMotionClip(
  animations,
  requestedName
) {
  const clips =
    animations || [];

  if (!clips.length)
    return null;

  if (!requestedName)
    return clips[0];

  const wanted =
    String(
      requestedName
    ).toLowerCase();

  return (
    clips.find(
      (clip) =>
        String(
          clip?.name || ""
        ).toLowerCase()
        === wanted
    )
    ||
    clips.find(
      (clip) =>
        String(
          clip?.name || ""
        ).toLowerCase()
        .includes(wanted)
    )
    ||
    clips[0]
  );
}


function normalizeModel(
  model,
  targetHeight
) {
  model.updateMatrixWorld(
    true
  );

  let box =
    new THREE.Box3()
      .setFromObject(
        model
      );

  const height =
    Math.max(
      0.01,
      box.max.y
      - box.min.y
    );

  const scale =
    targetHeight
    / height;

  model.scale.multiplyScalar(
    scale
  );

  model.updateMatrixWorld(
    true
  );

  box =
    new THREE.Box3()
      .setFromObject(
        model
      );

  const center =
    new THREE.Vector3();

  box.getCenter(
    center
  );

  model.position.x -=
    center.x;

  model.position.z -=
    center.z;

  model.position.y -=
    box.min.y;

  model.updateMatrixWorld(
    true
  );
}


export async function createLifeAvatar({
  modelUrl,
  animationUrls = {},
  targetHeight = 1.82,
  selfDriveMixer = false,
  animationRootName = null,
}) {
  if (!modelUrl) {
    throw new Error(
      "Avatar model URL missing."
    );
  }


  const base =
    await loadGLTF(
      modelUrl
    );

  const model =
    base.scene;

  model.name =
    "RealmLifeAvatar";

  normalizeModel(
    model,
    targetHeight
  );


  model.traverse(
    (obj) => {
      if (
        obj.isMesh
        || obj.isSkinnedMesh
      ) {
        obj.castShadow =
          true;

        obj.receiveShadow =
          true;

        obj.frustumCulled =
          false;
      }
    }
  );


  /*
   * Meshy humanoid GLBs expose their animated skeleton below
   * an Armature node.
   *
   * Normal RealmLife/Nexus avatars continue using the model
   * root. Starter 1 / Starter 2 explicitly request Armature.
   */
  const animationRoot =
    (
      animationRootName
      && model.getObjectByName(
        animationRootName
      )
    )
    || model;


  if (animationRootName) {
    console.info(
      "[RealmLife] Animation root",
      animationRootName,
      animationRoot?.name,
      animationRoot === model
        ? "(fallback model root)"
        : "(direct skeleton root)"
    );
  }


  const mixer =
    new THREE.AnimationMixer(
      animationRoot
    );


  /*
   * =========================================================
   * OPTIONAL SELF-DRIVEN MIXER
   * =========================================================
   *
   * RealmLife starter Meshy avatars use this so their
   * Walking / Running skeletal clips advance independently
   * from the world movement-monitor loop.
   *
   * Founder Stealth does NOT enable this option.
   */
  let selfDriveFrame =
    null;

  let selfDriveLast =
    performance.now();

  let selfDriveStopped =
    false;


  const selfDriveTick =
    (now) => {
      if (
        selfDriveStopped
        || !selfDriveMixer
      ) {
        return;
      }

      const dt =
        Math.min(
          0.08,
          Math.max(
            0,
            (
              now
              - selfDriveLast
            )
            / 1000
          )
        );

      selfDriveLast =
        now;

      mixer.update(
        dt
      );

      /*
       * The Meshy starters are one SkinnedMesh bound to the
       * animated Armature. Explicitly refresh the matrices after
       * the mixer updates so the visible mesh always receives
       * the current bone transforms.
       */
      model.updateMatrixWorld(
        true
      );

      model.traverse(
        (obj) => {
          if (
            obj.isSkinnedMesh
            && obj.skeleton
          ) {
            obj.skeleton.update();
          }
        }
      );

      selfDriveFrame =
        window.requestAnimationFrame(
          selfDriveTick
        );
    };


  if (selfDriveMixer) {
    console.info(
      "[RealmLife] Starter AnimationMixer self-drive enabled"
    );

    selfDriveFrame =
      window.requestAnimationFrame(
        selfDriveTick
      );
  }


  const clips =
    new Map();

  const actions =
    new Map();


  const registerClip = (
    requestedName,
    clip,
    playbackScale = 1
  ) => {
    if (!clip)
      return;

    const name =
      canonicalName(
        requestedName
        || clip.name
      );

    if (!name)
      return;

    const cloned =
      clip.clone();

    cloned.name =
      name;

    clips.set(
      name,
      cloned
    );

    const action =
      mixer.clipAction(
        cloned,
        animationRoot
      );

    action.__realmPlaybackScale =
      Number.isFinite(
        Number(playbackScale)
      )
        ? Number(playbackScale)
        : 1;

    actions.set(
      name,
      action
    );
  };


  /*
   * Embedded clips inside the main Nexus GLB.
   */
  for (
    const clip
    of (
      base.animations
      || []
    )
  ) {
    registerClip(
      clip.name,
      clip
    );
  }


  /*
   * External motion clips.
   *
   * Failure of one optional clip MUST NOT prevent the avatar
   * itself from appearing or walking.
   */
  await Promise.allSettled(
    Object.entries(
      animationUrls || {}
    ).map(
      async (
        [
          requestedName,
          url,
        ]
      ) => {
        if (!url)
          return;

        try {
          const spec =
            parseMotionSpec(
              url
            );

          const gltf =
            await loadGLTF(
              spec.url
            );

          const clip =
            findMotionClip(
              gltf.animations,
              spec.clipName
            );

          if (clip) {
            registerClip(
              requestedName,
              clip,
              spec.speed
            );
          }
        } catch (err) {
          console.debug(
            "[RealmLife Avatar] optional motion unavailable",
            requestedName,
            err
          );
        }
      }
    )
  );


  let activeName =
    null;

  let activeAction =
    null;

  let sequenceDepth =
    0;

  let airborne =
    false;

  let disposed =
    false;


  const getAction = (
    requested
  ) => {
    const name =
      canonicalName(
        requested
      );

    if (
      actions.has(name)
    ) {
      return {
        name,
        action:
          actions.get(name),
      };
    }


    const aliases =
      NAME_ALIASES[
        name
      ]
      || [];

    for (
      const alias
      of aliases
    ) {
      const candidate =
        canonicalName(
          alias
        );

      if (
        actions.has(
          candidate
        )
      ) {
        return {
          name:
            candidate,

          action:
            actions.get(
              candidate
            ),
        };
      }
    }

    return null;
  };


  const transition = (
    requested,
    {
      loop = true,
      fade = 0.18,
      force = false,
    } = {}
  ) => {
    if (disposed)
      return false;

    const hit =
      getAction(
        requested
      );

    if (!hit)
      return false;

    if (
      !force
      &&
      activeName
      === hit.name
    ) {
      return true;
    }

    const previous =
      activeAction;

    const next =
      hit.action;

    next.enabled =
      true;

    next.reset();

    /*
     * Generated idle actions may start from a natural
     * Walking frame instead of frame zero / bind pose.
     */
    next.paused =
      false;

    if (
      Number.isFinite(
        Number(
          next.__realmStartTime
        )
      )
    ) {
      next.time =
        Number(
          next.__realmStartTime
        );
    }

    next.clampWhenFinished =
      !loop;

    next.setLoop(
      loop
        ? THREE.LoopRepeat
        : THREE.LoopOnce,

      loop
        ? Infinity
        : 1
    );

    next.setEffectiveWeight(
      1
    );

    next.setEffectiveTimeScale(
      Number.isFinite(
        Number(
          next.__realmPlaybackScale
        )
      )
        ? Number(
            next.__realmPlaybackScale
          )
        : 1
    );

    next.play();


    if (
      previous
      && previous !== next
    ) {
      previous.crossFadeTo(
        next,
        Math.max(
          0.03,
          fade
        ),
        false
      );
    }


    activeName =
      hit.name;

    activeAction =
      next;

    return true;
  };


  const setState = (
    requested,
    opts = {}
  ) => {
    const name =
      canonicalName(
        requested
      );

    /*
     * Interaction sequences own the animation mixer until
     * they complete. Walking/idle cannot cancel sitting,
     * sleeping, talking, etc.
     */
    if (
      sequenceDepth > 0
      && !opts.force
    ) {
      return false;
    }


    /*
     * While physically airborne, ordinary locomotion cannot
     * overwrite the jump pose.
     */
    if (
      airborne
      && !opts.force
      && ![
        "jump",
        "fall",
      ].includes(
        name
      )
    ) {
      return false;
    }


    /*
     * Some Nexus avatars may not yet have a dedicated Run.
     * In that case use Walk rather than freezing.
     */
    if (
      name === "run"
      && !getAction(
        "run"
      )
    ) {
      return transition(
        "walk",
        opts
      );
    }


    /*
     * Same for Jump. Physical jumping still works even if the
     * current avatar does not yet have a jump clip.
     */
    if (
      name === "jump"
      && !getAction(
        "jump"
      )
    ) {
      return transition(
        "idle",
        {
          ...opts,
          force: true,
        }
      );
    }


    return transition(
      name,
      opts
    );
  };


  const playOnce = (
    requested,
    {
      fade = 0.14,
    } = {}
  ) =>
    new Promise(
      (resolve) => {
        const hit =
          getAction(
            requested
          );

        if (!hit) {
          resolve(false);
          return;
        }

        const action =
          hit.action;

        transition(
          hit.name,
          {
            loop: false,
            fade,
            force: true,
          }
        );


        let finished =
          false;

        const done = () => {
          if (finished)
            return;

          finished =
            true;

          mixer.removeEventListener(
            "finished",
            onFinished
          );

          resolve(true);
        };


        const onFinished = (
          event
        ) => {
          if (
            event.action
            === action
          ) {
            done();
          }
        };


        mixer.addEventListener(
          "finished",
          onFinished
        );


        const durationMs =
          Math.max(
            350,
            (
              action
                .getClip()
                .duration
              || 1
            )
            * 1000
            + 300
          );


        window.setTimeout(
          done,
          durationMs
        );
      }
    );


  const playSequence =
    async (
      sequence = []
    ) => {
      sequenceDepth +=
        1;

      try {
        for (
          const step
          of sequence
        ) {
          if (disposed)
            break;

          const name =
            canonicalName(
              step?.name
            );

          if (!name)
            continue;


          if (
            step?.mode
            === "loop"
          ) {
            transition(
              name,
              {
                loop: true,
                force: true,
              }
            );

            await wait(
              Math.max(
                0,
                Number(
                  step?.ms
                  || 1000
                )
              )
            );

            continue;
          }


          await playOnce(
            name
          );
        }
      } finally {
        sequenceDepth =
          Math.max(
            0,
            sequenceDepth - 1
          );

        if (
          sequenceDepth === 0
        ) {
          setState(
            "idle",
            {
              force: true,
            }
          );
        }
      }
    };


  /*
   * =========================================================
   * REALMLIFE GENERATED IDLE FALLBACK
   * =========================================================
   *
   * Meshy Starter 1 / Starter 2 currently contain:
   *   Walking
   *   Running
   *
   * but no dedicated Idle clip.
   *
   * Reuse a natural frame from Walking at an almost-zero
   * playback rate so standing residents do not return to
   * their exported T-pose.
   */
  if (
    !actions.has(
      "idle"
    )
    &&
    clips.has(
      "walk"
    )
  ) {
    const walkClip =
      clips.get(
        "walk"
      );

    registerClip(
      "idle",
      walkClip,
      0.0001
    );

    const idleAction =
      actions.get(
        "idle"
      );

    if (idleAction) {
      idleAction.__realmStartTime =
        Math.max(
          0.04,
          Math.min(
            walkClip.duration
              * 0.18,
            Math.max(
              0.04,
              walkClip.duration
                - 0.04
            )
          )
        );
    }

    console.info(
      "[RealmLife] Generated idle pose from Walking"
    );
  }


  /*
   * Choose a safe first animation.
   */
  if (
    !setState(
      "idle",
      {
        force: true,
      }
    )
  ) {
    const first =
      actions.keys()
        .next()
        .value;

    if (first) {
      transition(
        first,
        {
          force: true,
        }
      );
    }
  }


  return {
    model,

    mixer,

    animationRoot,

    actions,

    clips,

    has(
      name
    ) {
      return !!getAction(
        name
      );
    },

    setState,

    playOnce,

    playSequence,

    setAirborne(
      value
    ) {
      airborne =
        !!value;

      if (
        airborne
      ) {
        setState(
          "jump",
          {
            force: true,
          }
        );
      }
    },

    isAirborne() {
      return airborne;
    },

    isSequenceBusy() {
      return (
        sequenceDepth > 0
      );
    },

    update(dt) {
      if (
        !disposed
      ) {
        mixer.update(
          Math.min(
            0.08,
            Math.max(
              0,
              dt || 0
            )
          )
        );
      }
    },

    dispose() {
      disposed =
        true;

      selfDriveStopped =
        true;

      if (
        selfDriveFrame
        !== null
      ) {
        window.cancelAnimationFrame(
          selfDriveFrame
        );

        selfDriveFrame =
          null;
      }

      mixer.stopAllAction();

      model.traverse(
        (obj) => {
          if (
            obj.geometry
          ) {
            obj.geometry
              .dispose?.();
          }

          const materials =
            Array.isArray(
              obj.material
            )
              ? obj.material
              : obj.material
                ? [
                    obj.material
                  ]
                : [];

          for (
            const material
            of materials
          ) {
            material.dispose?.();
          }
        }
      );
    },
  };
}


/*
 * ===========================================================
 * REALMLIFE OPTION AVATAR CONTROLLER
 * ===========================================================
 *
 * Temporary clean avatar runtime for Player 1 / Player 2.
 *
 * Both GLBs provide:
 *   Walking
 *   Running
 *
 * RealmLife supplies physical jump movement. With no dedicated
 * Jump clip, a paused locomotion frame is used as the airborne
 * pose.
 */
export async function createRealmLifeOptionAvatar({
  modelUrl,
  targetHeight = 1.82,
  skinColor = null,
}) {
  const g =
    await loadGLTF(
      modelUrl
    );

  const model =
    g.scene;

  if (skinColor) {
    try {
      const {
        applyAvatarSkinTone,
      } = await import(
        "./realmLifeRecolor"
      );
      applyAvatarSkinTone(
        model,
        skinColor
      );
    } catch (_) {}
  }

  model.name =
    "RealmLifeOptionAvatar";

  normalizeModel(
    model,
    targetHeight
  );

  model.traverse(
    (obj) => {
      if (
        obj.isMesh
        || obj.isSkinnedMesh
      ) {
        obj.castShadow =
          true;

        obj.receiveShadow =
          true;

        obj.frustumCulled =
          false;
      }
    }
  );


  const sourceClips =
    g.animations || [];


  const findClip =
    (wanted) => {
      const key =
        String(
          wanted || ""
        ).toLowerCase();

      return (
        sourceClips.find(
          (clip) =>
            String(
              clip?.name || ""
            ).toLowerCase()
            === key
        )
        ||
        sourceClips.find(
          (clip) =>
            String(
              clip?.name || ""
            ).toLowerCase()
              .includes(
                key
              )
        )
        ||
        null
      );
    };


  const sourceWalk =
    findClip(
      "Walking"
    );

  const sourceRun =
    findClip(
      "Running"
    );


  if (!sourceWalk) {
    throw new Error(
      "RealmLife Option avatar is missing Walking."
    );
  }


  /*
   * Remove exported root-motion translation from Hips so the
   * animation stays attached to the RealmLife resident anchor.
   */
  const cleanClip =
    (
      clip,
      name
    ) => {
      const cloned =
        clip.clone();

      cloned.name =
        name;

      cloned.tracks =
        cloned.tracks.filter(
          (track) => {
            const n =
              String(
                track?.name || ""
              ).toLowerCase();

            return !(
              n.includes(
                "hips.position"
              )
              ||
              n.includes(
                "hips.translation"
              )
            );
          }
        );

      return cloned;
    };


  const walkClip =
    cleanClip(
      sourceWalk,
      "RealmLifeOptionWalk"
    );

  const runClip =
    cleanClip(
      sourceRun || sourceWalk,
      "RealmLifeOptionRun"
    );

  const idleClip =
    cleanClip(
      sourceWalk,
      "RealmLifeOptionIdle"
    );

  const jumpClip =
    cleanClip(
      sourceRun || sourceWalk,
      "RealmLifeOptionJumpPose"
    );


  /*
   * Match the simple animation structure already proven in
   * Nexus: mixer on the loaded instance + direct clipAction().
   */
  const mixer =
    new THREE.AnimationMixer(
      model
    );

  const actions = {};


  const makeAction =
    (
      name,
      clip,
      timeScale = 1
    ) => {
      const action =
        mixer.clipAction(
          clip
        );

      action.enabled =
        true;

      action.setLoop(
        THREE.LoopRepeat,
        Infinity
      );

      action.setEffectiveWeight(
        0
      );

      action.setEffectiveTimeScale(
        timeScale
      );

      action.play();

      actions[name] =
        action;

      return action;
    };


  makeAction(
    "walk",
    walkClip,
    1.35
  );

  makeAction(
    "run",
    runClip,
    1.15
  );

  makeAction(
    "idle",
    idleClip,
    1
  );

  makeAction(
    "jump",
    jumpClip,
    1
  );


  let currentName =
    null;

  let currentAction =
    null;

  let airborne =
    false;

  let disposed =
    false;


  const poseAction =
    (
      action,
      fraction
    ) => {
      action.paused =
        false;

      action.reset();

      action.play();

      action.time =
        Math.max(
          0,
          action
            .getClip()
            .duration
          * fraction
        );

      /*
       * Pausing after selecting the frame still allows the mixer
       * to apply that pose when mixer.update(0) runs.
       */
      action.paused =
        true;
    };


  const activate =
    (
      requested,
      force = false
    ) => {
      if (disposed)
        return false;

      const wanted =
        requested === "run"
          ? "run"
          : requested === "walk"
            ? "walk"
            : requested === "jump"
              ? "jump"
              : "idle";

      if (
        !force
        && currentName
          === wanted
      ) {
        return true;
      }


      const next =
        actions[wanted]
        || actions.idle;


      for (
        const action
        of Object.values(
          actions
        )
      ) {
        action.setEffectiveWeight(
          0
        );
      }


      next.enabled =
        true;

      next.setEffectiveWeight(
        1
      );


      if (
        wanted === "idle"
      ) {
        poseAction(
          next,
          0.18
        );
      }
      else if (
        wanted === "jump"
      ) {
        poseAction(
          next,
          0.22
        );
      }
      else {
        next.paused =
          false;

        next.reset();

        next.play();

        next.setEffectiveTimeScale(
          wanted === "walk"
            ? 1.35
            : 1.15
        );
      }


      currentName =
        wanted;

      currentAction =
        next;

      mixer.update(
        0
      );

      model.updateMatrixWorld(
        true
      );

      return true;
    };


  activate(
    "idle",
    true
  );


  let frame =
    null;

  let last =
    performance.now();


  const tick =
    (now) => {
      if (disposed)
        return;

      const dt =
        Math.min(
          0.05,
          Math.max(
            0,
            (
              now
              - last
            )
            / 1000
          )
        );

      last =
        now;

      mixer.update(
        dt
      );

      model.updateMatrixWorld(
        true
      );

      model.traverse(
        (obj) => {
          if (
            obj.isSkinnedMesh
            && obj.skeleton
          ) {
            obj.skeleton.update();
          }
        }
      );

      frame =
        window.requestAnimationFrame(
          tick
        );
    };


  frame =
    window.requestAnimationFrame(
      tick
    );


  const setState =
    (
      requested,
      opts = {}
    ) => {
      if (airborne) {
        return activate(
          "jump",
          !!opts.force
        );
      }

      const state =
        canonicalName(
          requested
        );

      return activate(
        state,
        !!opts.force
      );
    };


  return {
    model,
    mixer,
    actions,

    has(name) {
      const n =
        canonicalName(
          name
        );

      return !!actions[n];
    },

    setState,

    playOnce() {
      return Promise.resolve(
        false
      );
    },

    playSequence() {
      return Promise.resolve(
        false
      );
    },

    setAirborne(value) {
      airborne =
        !!value;

      activate(
        airborne
          ? "jump"
          : "idle",
        true
      );
    },

    isAirborne() {
      return airborne;
    },

    isSequenceBusy() {
      return false;
    },

    /*
     * Mixer is self-driven by requestAnimationFrame.
     * Kept for controller API compatibility.
     */
    update() {},

    dispose() {
      disposed =
        true;

      if (
        frame !== null
      ) {
        window.cancelAnimationFrame(
          frame
        );
      }

      mixer.stopAllAction();
    },
  };
}

