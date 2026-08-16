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

  const center =
    box.getCenter(new THREE.Vector3());

  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  model.updateMatrixWorld(true);
}

async function loadGLB(url) {
  const loader = makeGLTFLoader();
  return loader.loadAsync(url);
}

const wait = (ms) =>
  new Promise((resolve) =>
    setTimeout(resolve, ms)
  );

export async function createLifeAvatar({
  modelUrl,
  animationUrls = {},
  targetHeight = 1.82,
}) {
  if (!modelUrl) {
    throw new Error(
      "Life avatar model URL missing"
    );
  }

  const base = await loadGLB(modelUrl);
  const model = base.scene;

  prepareModel(model);
  fitToHeight(model, targetHeight);

  const mixer =
    new THREE.AnimationMixer(model);

  const actions = {};
  const loading = new Map();

  let disposed = false;
  let currentName = null;
  let currentAction = null;
  let sequenceVersion = 0;
  let sequenceActive = false;

  const createAction = (
    name,
    clip
  ) => {
    if (!clip || disposed) return null;

    const action =
      mixer.clipAction(clip);

    action.enabled = true;

    action.setEffectiveWeight(0);

    action.setEffectiveTimeScale(
      name === "walk"
        ? 1.15
        : name === "run"
          ? 1.05
          : 1
    );

    action.setLoop(
      THREE.LoopRepeat,
      Infinity
    );

    actions[name] = action;

    return action;
  };

  const ensureAction = async (name) => {
    if (actions[name])
      return actions[name];

    if (loading.has(name))
      return loading.get(name);

    const url = animationUrls[name];

    if (!url) return null;

    const promise = (async () => {
      try {
        const glb = await loadGLB(url);

        if (disposed) {
          disposeTree(glb.scene);
          return null;
        }

        const clip =
          glb.animations?.[0] || null;

        disposeTree(glb.scene);

        if (!clip) {
          console.warn(
            `[RealmLife] no clip in ${name}`
          );

          return null;
        }

        const action =
          createAction(name, clip);

        console.info(
          `[RealmLife] loaded motion: ${name}`
        );

        return action;
      } catch (err) {
        console.warn(
          `[RealmLife] motion load failed: ${name}`,
          err
        );

        return null;
      } finally {
        loading.delete(name);
      }
    })();

    loading.set(name, promise);

    return promise;
  };

  const transition = async (
    name,
    {
      fade = 0.16,
      loop = true,
      reset = true,
    } = {}
  ) => {
    let wanted = name;

    let next =
      await ensureAction(wanted);

    if (!next) {
      if (
        wanted === "run"
      ) {
        wanted = "walk";
        next =
          await ensureAction("walk");
      }

      if (!next) {
        wanted = "idle";
        next =
          await ensureAction("idle");
      }
    }

    if (!next || disposed)
      return null;

    if (
      currentAction &&
      currentAction !== next
    ) {
      currentAction.fadeOut(fade);
    }

    next.enabled = true;

    next.setLoop(
      loop
        ? THREE.LoopRepeat
        : THREE.LoopOnce,
      loop ? Infinity : 1
    );

    next.clampWhenFinished =
      !loop;

    next.setEffectiveWeight(1);

    next.setEffectiveTimeScale(
      wanted === "walk"
        ? 1.15
        : wanted === "run"
          ? 1.05
          : 1
    );

    if (reset) next.reset();

    next.fadeIn(fade);
    next.play();

    currentName = wanted;
    currentAction = next;

    return next;
  };

  const waitForFinish = (
    action,
    version
  ) =>
    new Promise((resolve) => {
      if (!action || disposed) {
        resolve(false);
        return;
      }

      const onFinished = (ev) => {
        if (ev.action !== action)
          return;

        mixer.removeEventListener(
          "finished",
          onFinished
        );

        resolve(
          !disposed &&
          version === sequenceVersion
        );
      };

      mixer.addEventListener(
        "finished",
        onFinished
      );
    });

  // Core locomotion preloads.
  await Promise.all([
    ensureAction("idle"),
    ensureAction("walk"),
    ensureAction("run"),
    ensureAction("greet"),
  ]);

  await transition(
    "idle",
    { fade: 0 }
  );

  return {
    model,
    mixer,
    actions,

    async setState(name) {
      if (
        disposed ||
        sequenceActive
      ) {
        return;
      }

      if (
        name === currentName
      ) {
        return;
      }

      await transition(name);
    },

    async playOnce(name) {
      if (disposed) return false;

      const version =
        ++sequenceVersion;

      sequenceActive = true;

      const action =
        await transition(
          name,
          {
            fade: 0.14,
            loop: false,
          }
        );

      if (!action) {
        sequenceActive = false;
        await transition("idle");
        return false;
      }

      await waitForFinish(
        action,
        version
      );

      if (
        version === sequenceVersion &&
        !disposed
      ) {
        sequenceActive = false;
        await transition(
          "idle",
          { fade: 0.18 }
        );
      }

      return true;
    },

    async playSequence(steps = []) {
      if (
        disposed ||
        !Array.isArray(steps) ||
        !steps.length
      ) {
        return false;
      }

      const version =
        ++sequenceVersion;

      sequenceActive = true;

      for (const step of steps) {
        if (
          disposed ||
          version !== sequenceVersion
        ) {
          return false;
        }

        const name =
          typeof step === "string"
            ? step
            : step.name;

        const mode =
          typeof step === "string"
            ? "once"
            : (step.mode || "once");

        if (!name) continue;

        if (mode === "loop") {
          const action =
            await transition(
              name,
              {
                fade:
                  step.fade ?? 0.14,
                loop: true,
              }
            );

          if (!action) continue;

          await wait(
            Math.max(
              0,
              step.ms || 1500
            )
          );
        } else {
          const action =
            await transition(
              name,
              {
                fade:
                  step.fade ?? 0.14,
                loop: false,
              }
            );

          if (!action) continue;

          const completed =
            await waitForFinish(
              action,
              version
            );

          if (!completed)
            return false;
        }
      }

      if (
        !disposed &&
        version === sequenceVersion
      ) {
        sequenceActive = false;

        await transition(
          "idle",
          { fade: 0.18 }
        );
      }

      return true;
    },

    cancelSequence() {
      sequenceVersion += 1;
      sequenceActive = false;

      transition(
        "idle",
        { fade: 0.12 }
      );
    },

    isBusy() {
      return sequenceActive;
    },

    async preload(name) {
      return ensureAction(name);
    },

    update(dt) {
      mixer.update(dt);
    },

    getState() {
      return currentName;
    },

    dispose() {
      disposed = true;
      sequenceVersion += 1;
      sequenceActive = false;

      mixer.stopAllAction();

      Object.values(actions).forEach(
        (action) => {
          try {
            mixer.uncacheAction(
              action.getClip(),
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
