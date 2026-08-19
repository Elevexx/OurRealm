// REALMLIFE STARTER AVATAR — stylized low-poly procedural player.
// Fully recolorable, two silhouettes (STYLE A / STYLE B), accessories.
// Controller API mirrors createLifeAvatar (setState/update/dispose/...).
import * as THREE from "three";

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.82,
    metalness: opts.metalness ?? 0.05,
    flatShading: true,
    ...(opts.emissive
      ? { emissive: new THREE.Color(opts.emissive), emissiveIntensity: opts.emissiveIntensity ?? 0.7 }
      : {}),
  });

const box = (w, h, d, m) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const sphere = (r, m, ws = 10, hs = 8) => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m);
  mesh.castShadow = true;
  return mesh;
};

export const TIER_ACCENTS = {
  rl_premium: "#22d3ee",
  rl_rare: "#3b82f6",
  rl_epic: "#8b5cf6",
  rl_elite: "#ec4899",
  rl_mythic: "#f97316",
  rl_legendary: "#eab308",
};

export function buildStarterModel({ style = "style_a", custom = {}, tier = null }) {
  const c = {
    skin: "#eab98c",
    hair_style: "crop",
    hair_color: "#2c2118",
    eye_color: "#3b6fb0",
    shirt_color: "#f5f5f0",
    bottoms: "shorts",
    bottoms_color: "#7a5230",
    shoe_color: "#f5f5f0",
    accessories: {},
    ...custom,
  };

  const A = style !== "style_b";
  const shoulderW = A ? 0.46 : 0.4;
  const hipW = A ? 0.34 : 0.36;
  const height = A ? 1.74 : 1.66;

  const skinM = mat(c.skin);
  const shirtM = mat(c.shirt_color);
  const bottomM = mat(c.bottoms_color);
  const shoeM = mat(c.shoe_color);
  const hairM = mat(c.hair_color, { roughness: 0.9 });

  const root = new THREE.Group();
  root.name = "RealmLifeStarterAvatar";

  const legLen = height * 0.47;
  const torsoH = height * 0.34;
  const headR = height * 0.115;

  // ---- legs (pivot at hip) ----
  const mkLeg = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * hipW * 0.28, legLen, 0);
    const shorts = c.bottoms === "shorts";
    const upperM = bottomM;
    const lowerM = shorts ? skinM : bottomM;
    const upper = box(0.15, legLen * 0.5, 0.17, upperM);
    upper.position.y = -legLen * 0.25;
    const lower = box(0.13, legLen * 0.42, 0.15, lowerM);
    lower.position.y = -legLen * 0.71;
    const premium = !!c.accessories?.premium_shoes?.equipped;
    const shoeMat = premium
      ? mat(c.accessories.premium_shoes.color || c.shoe_color, {
          emissive: TIER_ACCENTS.rl_premium, emissiveIntensity: 0.35 })
      : shoeM;
    const shoe = box(0.16, 0.1, premium ? 0.3 : 0.26, shoeMat);
    shoe.position.set(0, -legLen + 0.05, 0.045);
    pivot.add(upper, lower, shoe);
    return pivot;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);
  root.add(legL, legR);

  // ---- torso ----
  const torso = new THREE.Group();
  torso.position.y = legLen;
  root.add(torso);

  const chest = box(shoulderW, torsoH, 0.24, shirtM);
  chest.position.y = torsoH * 0.5;
  torso.add(chest);

  const waist = box(hipW, torsoH * 0.22, 0.22, shirtM);
  waist.position.y = torsoH * 0.08;
  torso.add(waist);

  if (c.accessories?.jacket?.equipped) {
    const jm = mat(c.accessories.jacket.color || "#22262e");
    const jl = box(0.1, torsoH * 0.94, 0.27, jm);
    jl.position.set(-shoulderW * 0.5, torsoH * 0.5, 0);
    const jr = jl.clone();
    jr.position.x = shoulderW * 0.5;
    const jb = box(shoulderW * 1.04, torsoH * 0.94, 0.07, jm);
    jb.position.set(0, torsoH * 0.5, -0.12);
    torso.add(jl, jr, jb);
  }

  if (c.accessories?.backpack?.equipped) {
    const bm = mat(c.accessories.backpack.color || "#4a5568");
    const pack = box(shoulderW * 0.72, torsoH * 0.62, 0.16, bm);
    pack.position.set(0, torsoH * 0.52, -0.21);
    torso.add(pack);
  }

  // ---- arms (pivot at shoulder) ----
  const armLen = torsoH * 1.06;
  const mkArm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (shoulderW * 0.5 + 0.07), torsoH * 0.92, 0);
    const sleeve = box(0.12, armLen * 0.46, 0.13, shirtM);
    sleeve.position.y = -armLen * 0.23;
    const fore = box(0.1, armLen * 0.4, 0.11, skinM);
    fore.position.y = -armLen * 0.66;
    const hand = sphere(0.06, skinM, 8, 6);
    hand.position.y = -armLen * 0.9;
    pivot.add(sleeve, fore, hand);
    if (side > 0 && c.accessories?.watch?.equipped) {
      const w = box(0.12, 0.05, 0.13, mat(c.accessories.watch.color || "#d3d7dd", { metalness: 0.5 }));
      w.position.y = -armLen * 0.52;
      pivot.add(w);
    }
    if (side < 0 && c.accessories?.bracelet?.equipped) {
      const b = box(0.115, 0.04, 0.125, mat(c.accessories.bracelet.color || "#eab308", { metalness: 0.6 }));
      b.position.y = -armLen * 0.55;
      pivot.add(b);
    }
    return pivot;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  torso.add(armL, armR);

  // ---- head ----
  const head = new THREE.Group();
  head.position.y = torsoH + headR * 0.9;
  torso.add(head);

  const skull = sphere(headR, skinM, 12, 10);
  skull.scale.set(0.92, 1.05, 0.95);
  head.add(skull);

  const neck = box(0.09, 0.08, 0.09, skinM);
  neck.position.y = -headR * 0.95;
  head.add(neck);

  const eyeM = mat("#ffffff", { roughness: 0.4 });
  const irisM = mat(c.eye_color, { roughness: 0.3 });
  [-1, 1].forEach((s) => {
    const eye = sphere(headR * 0.17, eyeM, 8, 6);
    eye.position.set(s * headR * 0.34, headR * 0.08, headR * 0.88);
    const iris = sphere(headR * 0.085, irisM, 8, 6);
    iris.position.set(s * headR * 0.34, headR * 0.08, headR * 1.02);
    head.add(eye, iris);
  });

  // hair styles (top dome only — never covers the face)
  const hairDome = (r) =>
    new THREE.Mesh(
      new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
      hairM
    );

  const hs = c.hair_style;
  if (hs !== "buzz") {
    const cap = hairDome(headR * 1.06);
    cap.castShadow = true;
    cap.scale.set(0.95, hs === "curly" ? 1.15 : 0.9, 0.95);
    cap.position.y = headR * (hs === "curly" ? 0.18 : 0.22);
    head.add(cap);
    if (hs === "side") {
      const fringe = box(headR * 1.2, headR * 0.35, headR * 0.5, hairM);
      fringe.position.set(headR * 0.2, headR * 0.62, headR * 0.6);
      head.add(fringe);
    }
    if (hs === "ponytail" || hs === "long") {
      const tail = box(headR * 0.5, headR * (hs === "long" ? 1.9 : 1.3), headR * 0.5, hairM);
      tail.position.set(0, -headR * 0.25, -headR * 0.85);
      head.add(tail);
    }
  } else {
    const buzz = hairDome(headR * 1.02);
    buzz.castShadow = true;
    buzz.scale.set(0.94, 0.8, 0.94);
    buzz.position.y = headR * 0.3;
    head.add(buzz);
  }

  if (c.accessories?.cap?.equipped) {
    const cm = mat(c.accessories.cap.color || "#c0392b");
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 1.1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.45),
      cm
    );
    crown.castShadow = true;
    crown.scale.set(0.95, 0.9, 0.95);
    crown.position.y = headR * 0.3;
    const brim = box(headR * 1.1, headR * 0.12, headR * 0.85, cm);
    brim.position.set(0, headR * 0.52, headR * 0.95);
    head.add(crown, brim);
  }

  if (c.accessories?.sunglasses?.equipped) {
    const gm = mat(c.accessories.sunglasses.color || "#101418", { roughness: 0.25, metalness: 0.4 });
    const band = box(headR * 1.55, headR * 0.28, headR * 0.22, gm);
    band.position.set(0, headR * 0.12, headR * 0.88);
    head.add(band);
  }

  // premium tier accent trim
  if (tier && TIER_ACCENTS[tier]) {
    const trim = box(shoulderW * 1.02, 0.045, 0.26,
      mat(TIER_ACCENTS[tier], { emissive: TIER_ACCENTS[tier], emissiveIntensity: 1.4 }));
    trim.position.y = torsoH * 0.86;
    torso.add(trim);
  }

  return { root, parts: { legL, legR, armL, armR, torso, head }, height };
}

export function createRealmLifeStarterAvatar({ style, custom, tier = null, targetHeight = 1.72 }) {
  const { root, parts, height } = buildStarterModel({ style, custom, tier });
  root.scale.setScalar(targetHeight / height);

  let state = "idle";
  let t = 0;
  let airborne = false;
  let disposed = false;

  const setState = (next) => {
    if (next === state) return;
    state = next;
  };

  const update = (dt) => {
    if (disposed) return;
    t += Math.min(0.08, Math.max(0, dt || 0));
    const { legL, legR, armL, armR, torso, head } = parts;

    if (airborne || state === "jump") {
      legL.rotation.x = -0.5;
      legR.rotation.x = 0.35;
      armL.rotation.x = -2.4;
      armR.rotation.x = -2.4;
      torso.rotation.x = 0.06;
      return;
    }

    if (state === "walk" || state === "run") {
      const speed = state === "run" ? 11.5 : 7.2;
      const amp = state === "run" ? 0.85 : 0.55;
      const s = Math.sin(t * speed);
      legL.rotation.x = s * amp;
      legR.rotation.x = -s * amp;
      armL.rotation.x = -s * amp * 0.85;
      armR.rotation.x = s * amp * 0.85;
      torso.rotation.x = state === "run" ? 0.14 : 0.05;
      torso.position.y = torso.position.y * 0.9 + (Math.abs(Math.cos(t * speed)) * 0.03 + (height * 0.47)) * 0.1;
      head.rotation.x = 0;
    } else if (state === "sit") {
      legL.rotation.x = -1.35;
      legR.rotation.x = -1.35;
      armL.rotation.x = -0.35;
      armR.rotation.x = -0.35;
      torso.rotation.x = 0.05;
    } else if (state === "sleep" || state === "lie") {
      legL.rotation.x = 0.1;
      legR.rotation.x = 0.1;
      armL.rotation.x = 0.15;
      armR.rotation.x = 0.15;
    } else {
      // idle breathing
      const b = Math.sin(t * 1.8) * 0.02;
      legL.rotation.x *= 0.85;
      legR.rotation.x *= 0.85;
      armL.rotation.x = Math.sin(t * 1.8) * 0.06;
      armR.rotation.x = -Math.sin(t * 1.8) * 0.06;
      torso.rotation.x = 0.01 + b * 0.3;
      head.rotation.x = b * 0.5;
    }
  };

  return {
    model: root,
    mixer: null,
    actions: {},
    clips: [],
    has: () => false,
    setState,
    playOnce: () => Promise.resolve(false),
    playSequence: () => Promise.resolve(false),
    setAirborne(v) {
      airborne = !!v;
      if (airborne) setState("jump");
    },
    isAirborne: () => airborne,
    isSequenceBusy: () => false,
    update,
    dispose() {
      disposed = true;
      root.traverse((o) => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => m.dispose?.());
      });
    },
  };
}
