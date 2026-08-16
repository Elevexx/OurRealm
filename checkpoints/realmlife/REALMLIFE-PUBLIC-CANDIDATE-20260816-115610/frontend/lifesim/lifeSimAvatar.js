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
  return new Promise(
    (
      resolve,
      reject
    ) => {
      loader().load(
        url,
        resolve,
        undefined,
        reject
      );
    }
  );
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
 * Emergency fallback only.
 *
 * Normal RealmLife player loading now comes from Nexus.
 */
export const DEFAULT_AVERY_AVATAR = {
  modelUrl:
    "/api/media/models/fe59ed71ebde0f6ed51c393269bd7da7.glb",

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


  const mixer =
    new THREE.AnimationMixer(
      model
    );


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
        model
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
