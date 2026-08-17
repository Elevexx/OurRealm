import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import apiClient from "@/api/client";
import { findGridPath } from "./lifeSimPathfinding";

const clamp = (n, a = 0, b = 100) => Math.max(a, Math.min(b, n));

const NEED_META = [
  ["hunger", "Hunger", "🍔", "#ffb347"],
  ["energy", "Energy", "⚡", "#72d5ff"],
  ["hygiene", "Hygiene", "🚿", "#61e6d6"],
  ["fun", "Fun", "🎮", "#c58cff"],
  ["social", "Social", "💬", "#ff83ba"],
];

const BUILD_CATALOG = {
  chair: {
    label: "Cozy Chair",
    cost: 80,
    size: [1.1, 1.2, 1.1],
    color: 0x2f7f91,
    actions: [{ id: "sit", label: "Sit & Relax" }],
  },
  plant: {
    label: "House Plant",
    cost: 35,
    size: [0.8, 1.4, 0.8],
    color: 0x397a4b,
    actions: [{ id: "admire", label: "Admire Plant" }],
  },
  bookcase: {
    label: "Bookcase",
    cost: 120,
    size: [1.4, 2.2, 0.55],
    color: 0x70492c,
    actions: [{ id: "read", label: "Read" }],
  },
};

const ACTION_EFFECTS = {
  sleep: {
    label: "Sleep",
    minutes: 180,
    needs: { energy: 42, hunger: -8, hygiene: -4 },
    message: "You feel rested.",
  },
  shower: {
    label: "Take Shower",
    minutes: 35,
    needs: { hygiene: 48 },
    message: "Fresh and clean.",
  },
  toilet: {
    label: "Use Toilet",
    minutes: 15,
    needs: { hygiene: 5 },
    message: "Much better.",
  },
  snack: {
    label: "Grab Snack",
    minutes: 20,
    money: -5,
    needs: { hunger: 22 },
    message: "Quick snack finished.",
  },
  cook: {
    label: "Cook Meal",
    minutes: 50,
    money: -10,
    needs: { hunger: 38, fun: 4 },
    message: "Home-cooked meal complete.",
  },
  relax: {
    label: "Relax",
    minutes: 40,
    needs: { fun: 18, energy: 5 },
    message: "That was relaxing.",
  },
  tv: {
    label: "Watch TV",
    minutes: 50,
    needs: { fun: 28, social: 2 },
    message: "Caught up on your favorite show.",
  },
  computer: {
    label: "Use Computer",
    minutes: 45,
    needs: { fun: 23 },
    message: "A little screen time.",
  },
  talk: {
    label: "Talk",
    minutes: 30,
    needs: { social: 32, fun: 6 },
    relationship: 8,
    message: "Good conversation with your neighbor.",
  },
  sit: {
    label: "Sit & Relax",
    minutes: 25,
    needs: { fun: 8, energy: 4 },
    message: "A comfortable break.",
  },
  admire: {
    label: "Admire Plant",
    minutes: 10,
    needs: { fun: 5 },
    message: "A little greenery helps.",
  },
  read: {
    label: "Read",
    minutes: 45,
    needs: { fun: 16 },
    message: "You enjoyed a good book.",
  },
};

function freshSave() {
  return {
    version: 1,
    day: 1,
    minutes: 8 * 60,
    money: 750,
    relationship: 10,
    resident: { name: "Avery", x: 0, z: 5 },
    needs: {
      hunger: 82,
      energy: 88,
      hygiene: 90,
      fun: 76,
      social: 70,
    },
    placed: [],
    nextPlacedId: 1,
  };
}

function normalizeSave(raw) {
  const f = freshSave();
  if (!raw || typeof raw !== "object") return f;

  return {
    ...f,
    ...raw,
    resident: { ...f.resident, ...(raw.resident || {}) },
    needs: { ...f.needs, ...(raw.needs || {}) },
    placed: Array.isArray(raw.placed) ? raw.placed : [],
    nextPlacedId: Math.max(1, Number(raw.nextPlacedId || 1)),
  };
}

function timeLabel(minutes) {
  const m = Math.floor(minutes) % 1440;
  let h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h %= 12;
  if (!h) h = 12;
  return `${h}:${mm} ${ap}`;
}

function makePerson(primary = 0x2bd4ff, accent = 0xff8a5a) {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.4, 0.95, 12),
    new THREE.MeshStandardMaterial({ color: primary, roughness: 0.65 })
  );
  body.position.y = 0.82;
  body.castShadow = true;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xd9a379, roughness: 0.72 })
  );
  head.position.y = 1.53;
  head.castShadow = true;

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.315, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.8 })
  );
  hair.position.y = 1.63;
  hair.castShadow = true;

  g.add(body, head, hair);
  return g;
}

function makeBox(size, color, y = null) {
  const [w, h, d] = size;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.72,
      metalness: 0.04,
    })
  );
  m.position.y = y ?? h / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export default function LifeSimRuntime({ game, progress, onExit }) {
  const mountRef = useRef(null);

  const simRef = useRef(normalizeSave(progress?.saved_state));
  const objectMapRef = useRef(new Map());
  const moveTargetRef = useRef(null);
  const pathRef = useRef([]);
  const findPathRef = useRef(null);
  const pendingActionRef = useRef(null);
  const dirtyRef = useRef(false);
  const speedRef = useRef(1);
  const buildItemRef = useRef(null);
  const saveTimerRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(null);
  const [speed, setSpeedState] = useState(1);
  const [buildItem, setBuildItemState] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [hud, setHud] = useState(() => {
    const s = simRef.current;
    return {
      day: s.day,
      minutes: s.minutes,
      money: s.money,
      relationship: s.relationship,
      needs: { ...s.needs },
      msg: "Welcome home.",
    };
  });

  const setSpeed = (n) => {
    speedRef.current = n;
    setSpeedState(n);
  };

  const chooseBuildItem = (id) => {
    buildItemRef.current = id;
    setBuildItemState(id);
    setSelected(null);
  };

  const persist = useCallback(async () => {
    if (!game?.id) return;
    clearTimeout(saveTimerRef.current);
    try {
      setSaveStatus("Saving…");
      await apiClient.put(`/games/${game.id}/state`, {
        title: game.title,
        state: simRef.current,
      });
      dirtyRef.current = false;
      setSaveStatus("Saved");
      saveTimerRef.current = setTimeout(() => setSaveStatus(""), 1200);
    } catch {
      setSaveStatus("Save failed");
    }
  }, [game?.id, game?.title]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persist(), 1200);
  }, [persist]);

  const queueAction = (actionId) => {
    if (!selected) return;
    const obj = objectMapRef.current.get(selected.id);
    if (!obj) return;

    const ap = obj.userData.approach || [0, 1.2];

    const destination = {
      x: obj.position.x + ap[0],
      z: obj.position.z + ap[1],
    };

    const finder = findPathRef.current;

    if (!finder) return;

    const route = finder(
      {
        x: simRef.current.resident.x,
        z: simRef.current.resident.z,
      },
      destination
    );

    if (!route.length) {
      moveTargetRef.current = null;
      pathRef.current = [];
      pendingActionRef.current = null;

      setHud((h) => ({
        ...h,
        msg: `No clear route to ${selected.label}.`,
      }));

      return;
    }

    pathRef.current = route.map(
      (p) => new THREE.Vector3(p.x, 0, p.z)
    );

    moveTargetRef.current =
      pathRef.current.shift() || null;

    pendingActionRef.current = {
      objectId: selected.id,
      actionId,
    };

    setHud((h) => ({
      ...h,
      msg: `Going to ${selected.label}…`,
    }));
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let disposed = false;
    let raf = 0;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.cssText =
      "width:100%;height:100%;display:block;touch-action:none";

    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x86c8e8);

    const camera = new THREE.PerspectiveCamera(
      38,
      mount.clientWidth / mount.clientHeight,
      0.1,
      120
    );

    let camAngle = Math.PI * 0.25;
    let camDistance = 17;

    const ambient = new THREE.HemisphereLight(0xdff3ff, 0x51412c, 1.05);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffe1b0, 2.2);
    sun.position.set(8, 16, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    scene.add(sun);

    const warm = new THREE.PointLight(0xff9f52, 14, 8, 2);
    warm.position.set(-2, 2.8, 3.5);
    scene.add(warm);

    // --------------------------------------------------------
    // HOUSE SHELL
    // --------------------------------------------------------

    const foundation = makeBox([18, 0.18, 14], 0xd7c7a5);
    foundation.position.y = -0.09;
    scene.add(foundation);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 14),
      new THREE.MeshStandardMaterial({
        color: 0xcbb58c,
        roughness: 0.82,
      })
    );

    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.userData.ground = true;
    scene.add(floor);

    const colliders = [];

    const addWall = (x, z, w, d, h = 2.8) => {
      const wall = makeBox([w, h, d], 0xf1e5cf);
      wall.position.set(x, h / 2, z);
      scene.add(wall);
      colliders.push({ x, z, hw: w / 2 + 0.3, hd: d / 2 + 0.3 });
    };

    // Dollhouse-style open front.
    addWall(0, -7, 18, 0.28);
    addWall(-9, 0, 0.28, 14);
    addWall(9, 0, 0.28, 14);

    // Interior room divisions.
    addWall(2.7, -3.2, 0.22, 7.2, 2.4);
    addWall(5.8, 0.4, 6.1, 0.22, 2.4);

    const interactive = [];

    const registerObject = ({
      id,
      label,
      x,
      z,
      size,
      color,
      actions,
      approach = [0, 1.25],
      collider = true,
      mesh = null,
    }) => {
      const m = mesh || makeBox(size, color);
      m.position.x = x;
      m.position.z = z;

      m.userData.lifeObject = true;
      m.userData.id = id;
      m.userData.label = label;
      m.userData.actions = actions || [];
      m.userData.approach = approach;

      scene.add(m);
      interactive.push(m);
      objectMapRef.current.set(id, m);

      if (collider) {
        colliders.push({
          x,
          z,
          hw: size[0] / 2 + 0.22,
          hd: size[2] / 2 + 0.22,
          objectId: id,
        });
      }

      return m;
    };

    // Bedroom
    registerObject({
      id: "bed",
      label: "Bed",
      x: -5.3,
      z: -4.6,
      size: [3.0, 0.65, 2.0],
      color: 0x397ea5,
      actions: [{ id: "sleep", label: "Sleep" }],
      approach: [0, 1.6],
    });

    // Bathroom
    registerObject({
      id: "shower",
      label: "Shower",
      x: 5.8,
      z: -4.7,
      size: [1.55, 2.15, 1.55],
      color: 0x7ad4e5,
      actions: [{ id: "shower", label: "Take Shower" }],
      approach: [0, 1.3],
    });

    registerObject({
      id: "toilet",
      label: "Toilet",
      x: 7.5,
      z: -2.8,
      size: [0.9, 0.75, 1.0],
      color: 0xf2f2eb,
      actions: [{ id: "toilet", label: "Use Toilet" }],
      approach: [0, 1.15],
    });

    // Kitchen
    registerObject({
      id: "fridge",
      label: "Refrigerator",
      x: -5.7,
      z: 4.4,
      size: [1.2, 2.2, 1.1],
      color: 0xc5d3d6,
      actions: [{ id: "snack", label: "Grab Snack · $5" }],
      approach: [0, -1.3],
    });

    registerObject({
      id: "stove",
      label: "Stove",
      x: -3.8,
      z: 4.4,
      size: [1.5, 1.05, 1.05],
      color: 0x30353c,
      actions: [{ id: "cook", label: "Cook Meal · $10" }],
      approach: [0, -1.3],
    });

    // Living room
    registerObject({
      id: "sofa",
      label: "Sofa",
      x: 4.6,
      z: 3.4,
      size: [3.0, 1.0, 1.2],
      color: 0x6f4ba8,
      actions: [{ id: "relax", label: "Relax" }],
      approach: [0, -1.3],
    });

    registerObject({
      id: "tv",
      label: "Television",
      x: 6.7,
      z: 0.9,
      size: [2.1, 1.4, 0.4],
      color: 0x161a22,
      actions: [{ id: "tv", label: "Watch TV" }],
      approach: [-1.8, 0],
    });

    registerObject({
      id: "computer",
      label: "Computer",
      x: 0.2,
      z: -4.5,
      size: [1.5, 1.25, 0.75],
      color: 0x375d6c,
      actions: [{ id: "computer", label: "Use Computer" }],
      approach: [0, 1.2],
    });

    // --------------------------------------------------------
    // RESIDENT + NEIGHBOR
    // --------------------------------------------------------

    const resident = makePerson(0x16b9d4, 0xb24f32);
    resident.position.set(
      simRef.current.resident.x,
      0,
      simRef.current.resident.z
    );
    scene.add(resident);

    const neighbor = makePerson(0xff8a5a, 0x2c1a14);
    neighbor.position.set(6.7, 0, 6.1);
    neighbor.userData.lifeObject = true;
    neighbor.userData.id = "neighbor";
    neighbor.userData.label = "Neighbor";
    neighbor.userData.actions = [{ id: "talk", label: "Talk" }];
    neighbor.userData.approach = [-1.1, 0];

    scene.add(neighbor);
    interactive.push(neighbor);
    objectMapRef.current.set("neighbor", neighbor);

    // --------------------------------------------------------
    // RESTORE PLAYER-PLACED FURNITURE
    // --------------------------------------------------------

    const addPlacedObject = (rec) => {
      const def = BUILD_CATALOG[rec.kind];
      if (!def) return null;

      return registerObject({
        id: rec.id,
        label: def.label,
        x: rec.x,
        z: rec.z,
        size: def.size,
        color: def.color,
        actions: def.actions,
        approach: [0, 1.0],
      });
    };

    simRef.current.placed.forEach(addPlacedObject);

    const blocked = (x, z, ignoreObject = null) => {
      if (x < -8.45 || x > 8.45 || z < -6.45 || z > 6.45) return true;

      for (const c of colliders) {
        if (ignoreObject && c.objectId === ignoreObject) continue;
        if (
          Math.abs(x - c.x) < c.hw &&
          Math.abs(z - c.z) < c.hd
        ) return true;
      }
      return false;
    };

    // Grid A* navigation. Collision geometry remains authoritative,
    // so placed Build/Buy furniture automatically becomes an obstacle.
    findPathRef.current = (from, to) =>
      findGridPath(
        from,
        to,
        (x, z) => blocked(x, z),
        {
          step: 0.5,
          minX: -8,
          maxX: 8,
          minZ: -6,
          maxZ: 6,
        }
      );

    // --------------------------------------------------------
    // INPUT / CLICK-TO-WALK / BUILD MODE
    // --------------------------------------------------------

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const keys = {};

    const setPointer = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };

    const onPointer = (e) => {
      setPointer(e);

      const hits = raycaster.intersectObjects(interactive, true);

      if (hits.length) {
        let obj = hits[0].object;
        while (obj && !obj.userData?.lifeObject) obj = obj.parent;

        if (obj?.userData?.lifeObject) {
          buildItemRef.current = null;
          setBuildItemState(null);

          setSelected({
            id: obj.userData.id,
            label: obj.userData.label,
            actions: obj.userData.actions || [],
          });

          return;
        }
      }

      const floorHit = raycaster.intersectObject(floor, false)[0];
      if (!floorHit) return;

      let x = THREE.MathUtils.clamp(floorHit.point.x, -8, 8);
      let z = THREE.MathUtils.clamp(floorHit.point.z, -6, 6);

      // BUILD/BUY placement
      if (buildItemRef.current) {
        const kind = buildItemRef.current;
        const def = BUILD_CATALOG[kind];

        x = Math.round(x * 2) / 2;
        z = Math.round(z * 2) / 2;

        if (blocked(x, z)) {
          setHud((h) => ({ ...h, msg: "That spot is blocked." }));
          return;
        }

        if (simRef.current.money < def.cost) {
          setHud((h) => ({ ...h, msg: "Not enough money." }));
          return;
        }

        const id = `placed-${simRef.current.nextPlacedId++}`;

        const rec = { id, kind, x, z };
        simRef.current.placed.push(rec);
        simRef.current.money -= def.cost;

        addPlacedObject(rec);

        setHud((h) => ({
          ...h,
          money: simRef.current.money,
          msg: `${def.label} placed.`,
        }));

        scheduleSave();
        return;
      }

      setSelected(null);
      pendingActionRef.current = null;

      const route = findPathRef.current?.(
        {
          x: resident.position.x,
          z: resident.position.z,
        },
        { x, z }
      ) || [];

      if (!route.length) {
        moveTargetRef.current = null;
        pathRef.current = [];

        setHud((h) => ({
          ...h,
          msg: "No clear route there.",
        }));

        return;
      }

      pathRef.current = route.map(
        (p) => new THREE.Vector3(p.x, 0, p.z)
      );

      moveTargetRef.current =
        pathRef.current.shift() || null;
    };

    const onWheel = (e) => {
      camDistance = THREE.MathUtils.clamp(
        camDistance + e.deltaY * 0.012,
        11,
        24
      );
      e.preventDefault();
    };

    const onKeyDown = (e) => {
      keys[e.key.toLowerCase()] = true;

      if (e.key.toLowerCase() === "q") camAngle -= Math.PI / 12;
      if (e.key.toLowerCase() === "e") camAngle += Math.PI / 12;
    };

    const onKeyUp = (e) => {
      keys[e.key.toLowerCase()] = false;
    };

    renderer.domElement.addEventListener("pointerdown", onPointer);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;

      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });

    ro.observe(mount);

    const clock = new THREE.Clock();
    let hudAccumulator = 0;
    let autoSaveAccumulator = 0;
    let neighborT = 0;

    const applyAction = (actionId) => {
      const fx = ACTION_EFFECTS[actionId];
      if (!fx) return;

      const s = simRef.current;

      if ((fx.money || 0) < 0 && s.money < Math.abs(fx.money)) {
        setHud((h) => ({ ...h, msg: "Not enough money." }));
        return;
      }

      s.money += fx.money || 0;

      for (const [k, v] of Object.entries(fx.needs || {})) {
        s.needs[k] = clamp((s.needs[k] || 0) + v);
      }

      s.relationship = clamp(
        s.relationship + (fx.relationship || 0)
      );

      s.minutes += fx.minutes || 0;

      while (s.minutes >= 1440) {
        s.minutes -= 1440;
        s.day += 1;
      }

      dirtyRef.current = true;

      setHud({
        day: s.day,
        minutes: s.minutes,
        money: s.money,
        relationship: s.relationship,
        needs: { ...s.needs },
        msg: fx.message || fx.label,
      });

      scheduleSave();
    };

    const loop = () => {
      if (disposed) return;

      raf = requestAnimationFrame(loop);

      const dt = Math.min(clock.getDelta(), 0.05);
      const simSpeed = speedRef.current;

      // ------------------------------------------------------
      // SIMULATION CLOCK + NEED DECAY
      // ------------------------------------------------------

      if (simSpeed > 0) {
        const minutesPerSecond = [0, 1, 4, 12][simSpeed] || 1;
        const dm = dt * minutesPerSecond;
        const hours = dm / 60;

        const s = simRef.current;

        s.minutes += dm;

        while (s.minutes >= 1440) {
          s.minutes -= 1440;
          s.day += 1;
        }

        s.needs.hunger = clamp(s.needs.hunger - 2.0 * hours);
        s.needs.energy = clamp(s.needs.energy - 1.35 * hours);
        s.needs.hygiene = clamp(s.needs.hygiene - 0.9 * hours);
        s.needs.fun = clamp(s.needs.fun - 0.72 * hours);
        s.needs.social = clamp(s.needs.social - 0.82 * hours);

        dirtyRef.current = true;
      }

      // ------------------------------------------------------
      // MOVEMENT
      // ------------------------------------------------------

      const camForward = new THREE.Vector3(
        -Math.sin(camAngle),
        0,
        -Math.cos(camAngle)
      );

      const camRight = new THREE.Vector3(
        Math.cos(camAngle),
        0,
        -Math.sin(camAngle)
      );

      let mx =
        (keys.d || keys.arrowright ? 1 : 0) -
        (keys.a || keys.arrowleft ? 1 : 0);

      let mz =
        (keys.s || keys.arrowdown ? 1 : 0) -
        (keys.w || keys.arrowup ? 1 : 0);

      if (mx || mz) {
        moveTargetRef.current = null;
        pathRef.current = [];
        pendingActionRef.current = null;

        const v = new THREE.Vector3()
          .addScaledVector(camRight, mx)
          .addScaledVector(camForward, -mz);

        if (v.lengthSq() > 0) v.normalize();

        const nx = resident.position.x + v.x * 3.5 * dt;
        const nz = resident.position.z + v.z * 3.5 * dt;

        if (!blocked(nx, resident.position.z))
          resident.position.x = nx;

        if (!blocked(resident.position.x, nz))
          resident.position.z = nz;

        if (v.lengthSq() > 0.01)
          resident.rotation.y = Math.atan2(v.x, v.z);
      }

      if (moveTargetRef.current) {
        const target = moveTargetRef.current;

        const dx = target.x - resident.position.x;
        const dz = target.z - resident.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist < 0.13) {
          if (pathRef.current.length) {
            moveTargetRef.current =
              pathRef.current.shift();
          } else {
            moveTargetRef.current = null;

            const pending = pendingActionRef.current;

            if (pending) {
              pendingActionRef.current = null;
              applyAction(pending.actionId);
            }
          }
        } else {
          const vx = dx / Math.max(dist, 0.001);
          const vz = dz / Math.max(dist, 0.001);

          const nx = resident.position.x + vx * 3.35 * dt;
          const nz = resident.position.z + vz * 3.35 * dt;

          if (!blocked(nx, resident.position.z))
            resident.position.x = nx;

          if (!blocked(resident.position.x, nz))
            resident.position.z = nz;

          resident.rotation.y = Math.atan2(vx, vz);
        }
      }

      simRef.current.resident.x = resident.position.x;
      simRef.current.resident.z = resident.position.z;

      // ------------------------------------------------------
      // SIMPLE NEIGHBOR AUTONOMY
      // ------------------------------------------------------

      neighborT += dt * 0.42;

      const neighborTargetX = 6 + Math.sin(neighborT) * 1.2;
      const neighborTargetZ = 5.3 + Math.cos(neighborT * 0.7) * 0.8;

      const ndx = neighborTargetX - neighbor.position.x;
      const ndz = neighborTargetZ - neighbor.position.z;

      neighbor.position.x += ndx * dt * 0.65;
      neighbor.position.z += ndz * dt * 0.65;

      if (Math.hypot(ndx, ndz) > 0.05)
        neighbor.rotation.y = Math.atan2(ndx, ndz);

      // ------------------------------------------------------
      // DAY / NIGHT PRESENTATION
      // ------------------------------------------------------

      const hour = simRef.current.minutes / 60;
      const daylight = clamp(
        Math.sin(((hour - 6) / 24) * Math.PI * 2) * 0.7 + 0.55,
        0.12,
        1
      );

      sun.intensity = 0.45 + daylight * 1.9;
      ambient.intensity = 0.35 + daylight * 0.8;
      warm.intensity = 8 + (1 - daylight) * 18;

      const nightColor = new THREE.Color(0x152442);
      const dayColor = new THREE.Color(0x86c8e8);

      scene.background.copy(nightColor).lerp(dayColor, daylight);

      // ------------------------------------------------------
      // ISOMETRIC FOLLOW CAMERA
      // ------------------------------------------------------

      const focus = new THREE.Vector3(
        resident.position.x,
        0.65,
        resident.position.z
      );

      const desiredCamera = new THREE.Vector3(
        focus.x + Math.sin(camAngle) * camDistance,
        12.8,
        focus.z + Math.cos(camAngle) * camDistance
      );

      camera.position.lerp(
        desiredCamera,
        1 - Math.exp(-dt * 5.5)
      );

      camera.lookAt(focus);

      // ------------------------------------------------------
      // HUD + AUTOSAVE
      // ------------------------------------------------------

      hudAccumulator += dt;
      autoSaveAccumulator += dt;

      if (hudAccumulator >= 0.25) {
        hudAccumulator = 0;
        const s = simRef.current;

        setHud((h) => ({
          ...h,
          day: s.day,
          minutes: s.minutes,
          money: s.money,
          relationship: s.relationship,
          needs: { ...s.needs },
        }));
      }

      if (autoSaveAccumulator >= 10) {
        autoSaveAccumulator = 0;
        if (dirtyRef.current) persist();
      }

      renderer.render(scene, camera);
    };

    setReady(true);
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);

      moveTargetRef.current = null;
      pathRef.current = [];
      findPathRef.current = null;
      pendingActionRef.current = null;

      clearTimeout(saveTimerRef.current);

      renderer.domElement.removeEventListener("pointerdown", onPointer);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);

      ro.disconnect();

      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();

        if (o.material) {
          const mats = Array.isArray(o.material)
            ? o.material
            : [o.material];

          mats.forEach((m) => m.dispose?.());
        }
      });

      renderer.dispose();

      if (renderer.domElement.parentNode === mount)
        mount.removeChild(renderer.domElement);
    };
  }, [persist, scheduleSave]);

  const toggleFullscreen = async () => {
    const el = mountRef.current?.parentElement;
    if (!el) return;

    if (!document.fullscreenElement)
      await el.requestFullscreen?.();
    else
      await document.exitFullscreen?.();
  };

  return (
    <div
      className="relative w-full rounded-xl overflow-hidden"
      style={{
        height: 620,
        background: "#071018",
        border: "1px solid rgba(46,230,255,.25)",
      }}
      data-testid="life-sim-runtime"
    >
      <div
        ref={mountRef}
        className="absolute inset-0"
        data-testid="life-sim-canvas"
      />

      {/* TOP BAR */}
      <div
        className="absolute top-3 left-3 right-3 flex items-center justify-between gap-3 pointer-events-none"
      >
        <div
          className="pointer-events-auto rounded-xl px-3 py-2 text-xs font-bold"
          style={{
            background: "rgba(3,10,20,.78)",
            border: "1px solid rgba(46,230,255,.28)",
            color: "#eafaff",
            backdropFilter: "blur(10px)",
          }}
        >
          <div>
            DAY {hud.day} · {timeLabel(hud.minutes)}
          </div>
          <div
            className="text-[10px] mt-0.5"
            style={{ color: "#ffcf66" }}
          >
            💰 ${Math.round(hud.money)}
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-1">
          {[0, 1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => setSpeed(n)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-black"
              style={{
                background:
                  speed === n
                    ? "rgba(46,230,255,.28)"
                    : "rgba(3,10,20,.72)",
                border: "1px solid rgba(46,230,255,.28)",
                color: "#eaffff",
              }}
            >
              {n === 0 ? "Ⅱ" : `${n}×`}
            </button>
          ))}

          <button
            onClick={persist}
            className="px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{
              background: "rgba(3,10,20,.72)",
              border: "1px solid rgba(255,255,255,.18)",
              color: "#fff",
            }}
          >
            💾 {saveStatus || "Save"}
          </button>

          <button
            onClick={toggleFullscreen}
            className="px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{
              background: "rgba(3,10,20,.72)",
              border: "1px solid rgba(255,255,255,.18)",
              color: "#fff",
            }}
          >
            ⛶
          </button>
        </div>
      </div>

      {/* NEEDS PANEL */}
      <div
        className="absolute left-3 bottom-3 w-[210px] rounded-xl p-3"
        style={{
          background: "rgba(3,10,20,.82)",
          border: "1px solid rgba(46,230,255,.25)",
          backdropFilter: "blur(12px)",
          color: "white",
        }}
      >
        <div className="font-black text-sm mb-2">
          {simRef.current.resident.name}
        </div>

        {NEED_META.map(([key, label, icon, color]) => {
          const value = clamp(hud.needs?.[key] || 0);

          return (
            <div key={key} className="mb-1.5">
              <div className="flex justify-between text-[10px] mb-0.5">
                <span>
                  {icon} {label}
                </span>
                <span>{Math.round(value)}</span>
              </div>

              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,.12)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${value}%`,
                    background: color,
                    transition: "width .25s ease",
                  }}
                />
              </div>
            </div>
          );
        })}

        <div
          className="text-[10px] mt-2 pt-2"
          style={{
            borderTop: "1px solid rgba(255,255,255,.12)",
            color: "#ff9fd0",
          }}
        >
          ❤️ Neighbor friendship {Math.round(hud.relationship)}/100
        </div>
      </div>

      {/* INTERACTION MENU */}
      {selected && !buildItem && (
        <div
          className="absolute right-3 top-20 w-[190px] rounded-xl p-3"
          style={{
            background: "rgba(3,10,20,.86)",
            border: "1px solid rgba(197,140,255,.35)",
            backdropFilter: "blur(12px)",
            color: "white",
          }}
        >
          <div className="font-black text-sm mb-2">
            {selected.label}
          </div>

          <div className="space-y-1.5">
            {(selected.actions || []).map((a) => (
              <button
                key={a.id}
                onClick={() => queueAction(a.id)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-bold"
                style={{
                  background: "rgba(197,140,255,.13)",
                  border: "1px solid rgba(197,140,255,.25)",
                }}
              >
                {a.label}
              </button>
            ))}

            {!selected.actions?.length && (
              <div className="text-[10px] opacity-60">
                Decorative object
              </div>
            )}
          </div>
        </div>
      )}

      {/* BUILD / BUY */}
      <div
        className="absolute right-3 bottom-3 rounded-xl p-2"
        style={{
          background: "rgba(3,10,20,.82)",
          border: "1px solid rgba(255,138,90,.3)",
          color: "white",
        }}
      >
        <div className="text-[10px] font-black mb-1.5">
          🔨 BUILD / BUY
        </div>

        <div className="flex gap-1">
          {Object.entries(BUILD_CATALOG).map(([id, d]) => (
            <button
              key={id}
              onClick={() =>
                chooseBuildItem(buildItem === id ? null : id)
              }
              className="px-2 py-1.5 rounded-lg text-[10px] font-bold"
              style={{
                background:
                  buildItem === id
                    ? "rgba(255,138,90,.3)"
                    : "rgba(255,255,255,.08)",
                border: "1px solid rgba(255,255,255,.12)",
              }}
            >
              {d.label}
              <br />
              <span style={{ color: "#ffd36f" }}>
                ${d.cost}
              </span>
            </button>
          ))}
        </div>

        {buildItem && (
          <div className="text-[9px] mt-1.5 opacity-70">
            Click the floor to place · click item again to cancel
          </div>
        )}
      </div>

      {/* STATUS */}
      <div
        className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg px-4 py-2 text-xs font-semibold"
        style={{
          background: "rgba(3,10,20,.72)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,.12)",
        }}
      >
        {hud.msg}
      </div>

      <div
        className="absolute top-16 left-3 text-[10px] rounded-lg px-3 py-1.5"
        style={{
          background: "rgba(3,10,20,.62)",
          color: "#d7faff",
        }}
      >
        Click floor: move · Click objects: interact · WASD: walk · Q/E:
        rotate · Wheel: zoom
      </div>

      <button
        onClick={onExit}
        className="absolute top-[62px] right-3 px-3 py-1.5 rounded-lg text-[10px] font-bold"
        style={{
          background: "rgba(3,10,20,.72)",
          border: "1px solid rgba(255,255,255,.16)",
          color: "#fff",
        }}
      >
        EXIT
      </button>

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-white/80">
          Building your home…
        </div>
      )}
    </div>
  );
}
