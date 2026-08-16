import * as THREE from "three";
import { makeGLTFLoader } from "../three/questLevel";

function disposeTree(root) {
  if (!root) return;

  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose?.();

    if (o.material) {
      const mats = Array.isArray(o.material)
        ? o.material
        : [o.material];

      mats.forEach((m) => m.dispose?.());
    }
  });
}

function prepareModel(model) {
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = true;
    }
  });
}

function fitToHeight(model, targetHeight = 1.82) {
  model.updateMatrixWorld(true);

  let box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());

  const scale =
    targetHeight / Math.max(0.001, size.y);

  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);

  box = new THREE.Box3().setFromObject(model);

  const center = box.getCenter(new THREE.Vector3());

  // Center avatar on its movement root and place feet on y=0.
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  model.updateMatrixWorld(true);
}

async function loadGLB(url) {
  const loader = makeGLTFLoader();
  return loader.loadAsync(url);
}

export async function createLifeAvatar({
  modelUrl,
  animationUrls = {},
  targetHeight = 1.82,
}) {
  if (!modelUrl) {
    throw new Error("Life avatar model URL missing");
  }

  const base = await loadGLB(modelUrl);
  const model = base.scene;

  prepareModel(model);
  fitToHeight(model, targetHeight);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};

  const motionNames = [
    "idle",
    "walk",
    "run",
    "greet",
  ];

  const motionFiles = await Promise.all(
    motionNames.map(async (name) => {
      const url = animationUrls[name];

      if (!url) return null;

      try {
        const glb = await loadGLB(url);

        const clip =
          glb.animations?.[0] || null;

        // Animation GLB geometry isn't rendered.
        // The AnimationClip itself is all we retain.
        disposeTree(glb.scene);

        return { name, clip };
      } catch (err) {
        console.warn(
          `[RealmLife] animation load failed: ${name}`,
          err
        );

        return null;
      }
    })
  );

  motionFiles.forEach((entry) => {
    if (!entry?.clip) return;

    const action =
      mixer.clipAction(entry.clip);

    action.enabled = true;
    action.setEffectiveWeight(0);
    action.setEffectiveTimeScale(
      entry.name === "walk"
        ? 1.15
        : entry.name === "run"
          ? 1.05
          : 1
    );

    action.setLoop(
      THREE.LoopRepeat,
      Infinity
    );

    action.play();

    actions[entry.name] = action;
  });

  let currentName = null;
  let currentAction = null;
  let oneShotAction = null;

  const transition = (
    name,
    fade = 0.16
  ) => {
    let wanted = name;

    if (!actions[wanted]) {
      if (
        wanted === "run" &&
        actions.walk
      ) {
        wanted = "walk";
      } else {
        wanted = actions.idle
          ? "idle"
          : actions.walk
            ? "walk"
            : null;
      }
    }

    if (!wanted) return;

    const next = actions[wanted];

    if (
      !next ||
      next === currentAction
    ) {
      return;
    }

    if (currentAction) {
      currentAction.fadeOut(fade);
    }

    next.enabled = true;
    next.setLoop(
      THREE.LoopRepeat,
      Infinity
    );
    next.clampWhenFinished = false;
    next.reset();

    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(
      wanted === "walk"
        ? 1.15
        : wanted === "run"
          ? 1.05
          : 1
    );

    next.fadeIn(fade);
    next.play();

    currentName = wanted;
    currentAction = next;
  };

  const finished = (e) => {
    if (
      oneShotAction &&
      e.action === oneShotAction
    ) {
      oneShotAction = null;
      transition("idle", 0.18);
    }
  };

  mixer.addEventListener(
    "finished",
    finished
  );

  // Start in a true idle animation.
  transition("idle", 0);

  return {
    model,
    mixer,
    actions,

    setState(name) {
      // Don't interrupt greet / future interaction animations.
      if (oneShotAction) return;

      transition(name, 0.16);
    },

    playOnce(name) {
      const next = actions[name];

      if (!next) return false;

      if (
        currentAction &&
        currentAction !== next
      ) {
        currentAction.fadeOut(0.14);
      }

      next.enabled = true;
      next.reset();
      next.setLoop(
        THREE.LoopOnce,
        1
      );
      next.clampWhenFinished = true;
      next.setEffectiveWeight(1);
      next.setEffectiveTimeScale(1);
      next.fadeIn(0.14);
      next.play();

      currentName = name;
      currentAction = next;
      oneShotAction = next;

      return true;
    },

    update(dt) {
      mixer.update(dt);
    },

    getState() {
      return currentName;
    },

    dispose() {
      mixer.removeEventListener(
        "finished",
        finished
      );

      mixer.stopAllAction();

      Object.values(actions).forEach(
        (a) => {
          try {
            mixer.uncacheAction(
              a.getClip(),
              model
            );
          } catch {
            // noop
          }
        }
      );

      try {
        mixer.uncacheRoot(model);
      } catch {
        // noop
      }
    },
  };
}
