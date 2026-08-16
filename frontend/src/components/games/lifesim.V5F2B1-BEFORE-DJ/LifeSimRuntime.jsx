import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import apiClient from "@/api/client";
import { findGridPath } from "./lifeSimPathfinding";
import {
  createLifeAvatar,
  DEFAULT_AVERY_AVATAR,
  REALMLIFE_UNIVERSAL_MOTIONS,
} from "./lifeSimAvatar";
import { buildNeighborhoodWorld } from "./lifeSimNeighborhood";
import {
  buildRealmLifePortalWorld,
  buildRealmLifeFounderEstate,
} from "./lifeSimPortalWorld";
import { useRealmLifeFire } from "./useRealmLifeFire";
import RealmLifeFirePanel from "./RealmLifeFirePanel";
import { useRealmLifeProperty } from "./useRealmLifeProperty";
import RealmLifePropertyPanel from "./RealmLifePropertyPanel";
import { useRealmLifeEnvironment } from "./useRealmLifeEnvironment";
import RealmLifeFounderAdmin from "./RealmLifeFounderAdmin";
import { createRealmLifeEnvironment } from "./lifeSimEnvironment";
import {
  initRealmLifeAAAAssets,
} from "./lifeSimAAAAssets";

const clamp = (n, a = 0, b = 100) => Math.max(a, Math.min(b, n));

const NEED_META = [
  ["hunger", "Hunger", "🍔", "#ffb347"],
  ["energy", "Energy", "⚡", "#72d5ff"],
  ["hygiene", "Hygiene", "🚿", "#61e6d6"],
  ["fun", "Fun", "🎮", "#c58cff"],
  ["social", "Social", "💬", "#ff83ba"],
];

const DEFAULT_NEIGHBOR_AVATAR = {
  id: "av_ninja_f",
  label: "Neighbor",
  modelUrl: "/api/media/models/efbbeda362104c23a46577beb0e22541.glb",
  animationUrls: {
    idle: "/api/media/models/d421877571cfcff37bcffc54984d6dea.glb",
    walk: "/api/media/models/a0bb8db3c1c4a0d9813943a0bfa48250.glb",
    run: "/api/media/models/ea0e2fd670de9d59a4902c945c23dc77.glb",
    jump: "/api/media/models/dda41f52680e2e7f408d0f2c8a56a592.glb",
    fall: "/api/media/models/03ace7407091fba8f18dcf6b6e7f4907.glb",
    land: "/api/media/models/535c4ed0efe3e38bfbbb709c62bc8e4f.glb",
    greet: "/api/media/models/24b6c2f522d5de9db120440e5f900d04.glb",
  },
};

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
    fire_cost: 5,
    needs: { hunger: 22 },
    message: "Quick snack finished.",
  },
  cook: {
    label: "Cook Meal",
    minutes: 50,
    fire_cost: 10,
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

  const {
    account: realmFire,

    panelOpen: firePanelOpen,
    setPanelOpen: setFirePanelOpen,

    amount: fireAmount,
    setAmount: setFireAmount,

    busy: fireBusy,
    notice: fireNotice,

    markActive: markRealmLifeActive,

    addFromVault,
    withdrawToVault,

    burnBuild: burnRealmLifeBuild,
    burnAction: burnRealmLifeAction,
  } = useRealmLifeFire(game?.id);

  const realmProperty =
    useRealmLifeProperty(
      game?.id
    );

  const realmEnvironment =
    useRealmLifeEnvironment(
      game?.id
    );

  const mountRef = useRef(null);

  const simRef = useRef(normalizeSave(progress?.saved_state));
  const objectMapRef = useRef(new Map());

  const instantRealmTravelRef =
    useRef(null);
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

  const [
    realmTravelFade,
    setRealmTravelFade,
  ] = useState(false);

  // ----------------------------------------------------------
  // REALMLIFE CAMERA MODE
  //
  // world = existing elevated life-sim view
  // first = first-person POV
  //
  // Three.js reads cameraModeRef directly so switching cameras
  // does not recreate the RealmLife world.
  // ----------------------------------------------------------

  const [cameraMode, setCameraMode] =
    useState("world");

  const cameraModeRef =
    useRef("world");

  // ----------------------------------------------------------
  // POV CONTROL DIRECTION
  //
  // NORMAL is the default.
  // REVERSE restores the original POV look direction.
  // ----------------------------------------------------------

  const [controlDirection, setControlDirection] =
    useState(() => {
      try {
        return (
          window.localStorage.getItem(
            "realmlife-pov-controls"
          ) === "reverse"
            ? "reverse"
            : "normal"
        );
      } catch (_) {
        return "normal";
      }
    });

  const controlDirectionRef =
    useRef(controlDirection);

  const toggleControlDirection =
    useCallback(() => {
      const next =
        controlDirectionRef.current ===
          "normal"
          ? "reverse"
          : "normal";

      controlDirectionRef.current =
        next;

      setControlDirection(next);

      try {
        window.localStorage.setItem(
          "realmlife-pov-controls",
          next
        );
      } catch (_) {}

      markRealmLifeActive();
    }, [markRealmLifeActive]);

  const setRealmLifeCameraMode =
    useCallback(
      (mode) => {
        const next =
          mode === "first"
            ? "first"
            : "world";

        cameraModeRef.current =
          next;

        setCameraMode(next);

        markRealmLifeActive();
      },
      [markRealmLifeActive]
    );

  const toggleRealmLifeCamera =
    useCallback(() => {
      setRealmLifeCameraMode(
        cameraModeRef.current ===
          "first"
          ? "world"
          : "first"
      );
    }, [
      setRealmLifeCameraMode,
    ]);
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

    // ========================================================
    // REALMLIFE INSTANT TRAVEL ACTION
    //
    // Elevator and portal destination buttons are teleport
    // commands — never walk-to-object commands.
    // ========================================================

    if (
      (
        String(
          actionId
          || ""
        ).startsWith(
          "elevator:"
        )
        ||
        String(
          actionId
          || ""
        ).startsWith(
          "portal:"
        )
      )
      &&
      selected?.id
      &&
      instantRealmTravelRef.current
    ) {
      const sourceId =
        selected.id;

      setSelected(
        null
      );


      instantRealmTravelRef
        .current(
          actionId,
          sourceId
        );


      return;
    }

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

    initRealmLifeAAAAssets(
      renderer
    );

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

    const realmLifeEnvironmentController =
      createRealmLifeEnvironment(
        scene
      );
    scene.background = new THREE.Color(0x86c8e8);

    const camera = new THREE.PerspectiveCamera(
      38,
      mount.clientWidth / mount.clientHeight,
      0.1,
      320
    );

    let camAngle = Math.PI * 0.25;
    let camDistance = 17;

    const WORLD_CAMERA_FOV =
      camera.fov;

    const FIRST_PERSON_FOV =
      72;

    // --------------------------------------------------------
    // REALMLIFE CAMERA RIG
    //
    // Screen mode today.
    // Future WebXR can provide head/device pose through this
    // same rig without changing RealmLife world coordinates.
    // --------------------------------------------------------

    const cameraRig =
      new THREE.Group();

    cameraRig.name =
      "RealmLifeCameraRig";

    cameraRig.userData = {
      realmLifeCameraRig: true,
      xrReady: true,
      poseProvider: "screen",
      mode: "world",
    };

    scene.add(cameraRig);
    cameraRig.add(camera);

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

    // Seamless exterior world:
    // yard → sidewalk → road → neighboring lots → park.
    const neighborhood =
      buildNeighborhoodWorld(scene);

    colliders.push(
      ...neighborhood.colliders
    );

    // REALMLIFE V5F1 PORTAL + ESTATE WORLD

    // Expand the current navigation/click foundation enough for
    // the six estate interior instances. The city sector-streaming
    // conversion will replace this expanded transitional grid later.
    neighborhood.bounds.minX =
      Math.min(
        neighborhood.bounds.minX,
        -100
      );

    neighborhood.bounds.maxX =
      Math.max(
        neighborhood.bounds.maxX,
        100
      );

    neighborhood.bounds.minZ =
      Math.min(
        neighborhood.bounds.minZ,
        -150
      );

    neighborhood.bounds.maxZ =
      Math.max(
        neighborhood.bounds.maxZ,
        134
      );

    if (
      neighborhood.clickPlane
        ?.geometry
    ) {
      neighborhood
        .clickPlane
        .geometry
        .dispose();

      neighborhood.clickPlane.geometry =
        new THREE.PlaneGeometry(
          210,
          300
        );

      neighborhood.clickPlane
        .position.z = -8;
    }

    const portalWorld =
      buildRealmLifePortalWorld(
        scene
      );

    colliders.push(
      ...portalWorld.colliders
    );

    const founderEstate =
      buildRealmLifeFounderEstate(
        scene
      );

    colliders.push(
      ...founderEstate.colliders
    );

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

    // REALMLIFE V5F1 REGISTER WORLD INTERACTIVES

    [
      ...portalWorld.interactives,
      ...founderEstate.interactives,
    ].forEach((obj) => {
      interactive.push(obj);

      if (
        obj?.userData?.id
      ) {
        objectMapRef.current.set(
          obj.userData.id,
          obj
        );
      }
    });

    // --------------------------------------------------------
    // PRIVATE PROPERTY GATE
    // --------------------------------------------------------

    if (
      neighborhood.propertyGate
    ) {
      interactive.push(
        neighborhood.propertyGate
      );

      objectMapRef.current.set(
        neighborhood
          .propertyGate
          .userData.id,

        neighborhood.propertyGate
      );
    }

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
      interactionAnchor = null,
    }) => {
      const m = mesh || makeBox(size, color);
      m.position.x = x;
      m.position.z = z;

      m.userData.lifeObject = true;
      m.userData.id = id;
      m.userData.label = label;
      m.userData.actions = actions || [];
      m.userData.approach = approach;
      m.userData.interactionAnchor =
        interactionAnchor;

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

      interactionAnchor: {
        x: 0,
        y: 0,
        z: 0,
        rotationY:
          Math.PI / 2,
      },
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
      actions: [{ id: "snack", label: "Grab Snack · 🔥5" }],
      approach: [0, -1.3],
    });

    registerObject({
      id: "stove",
      label: "Stove",
      x: -3.8,
      z: 4.4,
      size: [1.5, 1.05, 1.05],
      color: 0x30353c,
      actions: [{ id: "cook", label: "Cook Meal · 🔥10" }],
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

      interactionAnchor: {
        x: 0,
        y: 0,
        z: -0.10,
        rotationY:
          Math.PI,
      },
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

    // --------------------------------------------------------
    // PLAYABLE RESIDENT
    //
    // Keep the primitive resident temporarily while the rigged GLB
    // and its motion pack stream in. If loading fails, gameplay
    // remains fully usable instead of losing the player character.
    // --------------------------------------------------------

    const resident = new THREE.Group();

    const residentPlaceholder =
      makePerson(0x16b9d4, 0xb24f32);

    resident.add(residentPlaceholder);

    // REALMLIFE SAFE EXTERIOR SPAWN GUARD
    //
    // Prevent old/corrupt exterior saves from spawning a user
    // inside the surrounding mountain ring or off-map void.
    //
    // Legitimate instanced interior travel happens later through
    // the elevator/portal controller and is not affected.
    const savedResidentX =
      Number(
        simRef.current
          .resident.x
        || 0
      );

    const savedResidentZ =
      Number(
        simRef.current
          .resident.z
        || 0
      );


    const savedExteriorIsUnsafe =
      !Number.isFinite(
        savedResidentX
      )
      ||
      !Number.isFinite(
        savedResidentZ
      )
      ||
      savedResidentX < -105
      ||
      savedResidentX > 105
      ||
      savedResidentZ < -50
      ||
      savedResidentZ > 138;


    if (
      savedExteriorIsUnsafe
    ) {
      simRef.current
        .resident.x =
          6.2;

      simRef.current
        .resident.z =
          4.2;

      resident.position.set(
        6.2,
        0,
        4.2
      );

      console.warn(
        "[RealmLife] Unsafe exterior save rescued to Level 1 spawn."
      );

    } else {
      resident.position.set(
        savedResidentX,
        0,
        savedResidentZ
      );
    }

    scene.add(resident);

    let residentAvatar = null;
    let residentInteractionBusy = false;

    // ========================================================
    // REALMLIFE INSTANCED ROOM TRAVEL CONTROLLER
    // ========================================================

    const waitRealmTravel = (
      ms
    ) =>
      new Promise(
        (resolve) =>
          window.setTimeout(
            resolve,
            ms
          )
      );


    const setRealmLocation = (
      requestedFloor
    ) => {
      const floor =
        String(
          requestedFloor
          || "WORLD"
        ).toUpperCase();


      const estateFloor =
        floor === "WORLD"
          ? "1"
          : floor;


      const result =
        founderEstate.setFloor(
          estateFloor
        );


      const indoor =
        !!result
          ?.interior;


      window.__REALMLIFE_INDOOR =
        indoor;


      /*
       * Exterior city/world and public portal network do not
       * exist visually while inside an estate interior.
       */
      neighborhood.root.visible =
        !indoor;

      portalWorld.root.visible =
        !indoor;


      /*
       * Founder estate root remains active because the selected
       * interior floor lives inside it.
       */
      founderEstate.root.visible =
        true;


      return {
        floor:
          estateFloor,

        indoor,
      };
    };


    const teleportResidentWithFade =
      async (
        spawn,
        floor,
        message
      ) => {
        if (!spawn)
          return;


        setRealmTravelFade(
          true
        );


        // Fade completely to black first.
        await waitRealmTravel(
          260
        );


        if (disposed)
          return;


        setRealmLocation(
          floor
        );


        moveTargetRef.current =
          null;

        pathRef.current =
          [];

        pendingActionRef.current =
          null;


        resident.position.set(
          Number(
            spawn.x
            || 0
          ),

          Number(
            spawn.y
            || 0
          ),

          Number(
            spawn.z
            || 0
          )
        );


        simRef.current
          .resident.x =
            resident.position.x;

        simRef.current
          .resident.z =
            resident.position.z;


        residentAvatar
          ?.setState?.(
            "idle",
            {
              force:
                true,
            }
          );


        setSelected(
          null
        );


        setHud(
          (h) => ({
            ...h,

            msg:
              message
              || "Arrived.",
          })
        );


        markRealmLifeActive();

        scheduleSave();


        /*
         * Allow the destination room and its lighting to render
         * before revealing the screen.
         */
        await waitRealmTravel(
          500
        );


        if (!disposed) {
          setRealmTravelFade(
            false
          );
        }
      };


    // Startup = normal RealmLife exterior.
    setRealmLocation(
      "WORLD"
    );


    instantRealmTravelRef.current =
      async (
        actionId,
        sourceId
      ) => {
        const action =
          String(
            actionId
            || ""
          );


        // ----------------------------------------------------
        // ELEVATOR
        // ----------------------------------------------------

        if (
          action.startsWith(
            "elevator:"
          )
        ) {
          const floor =
            action.slice(
              "elevator:"
                .length
            );


          const spawn =
            founderEstate
              .floorSpawns[
                floor
              ];


          if (!spawn) {
            setHud(
              (h) => ({
                ...h,

                msg:
                  "That elevator level is unavailable.",
              })
            );

            return;
          }


          const names = {
            "1":
              "Level 1 · Main Residence",

            "2":
              "Level 2 · Private Residence",

            "3":
              "Level 3 · Sky Lounge",

            "B1":
              "B1 · Private Cinema",

            "B2":
              "B2 · Recording Studio",

            "B3":
              "B3 · Founder Laboratory / Portal",
          };


          await teleportResidentWithFade(
            spawn,
            floor,

            `Elevator arrived · ${
              names[
                floor
              ]
              || floor
            }`
          );


          return;
        }


        // ----------------------------------------------------
        // PORTAL
        // ----------------------------------------------------

        if (
          action.startsWith(
            "portal:"
          )
        ) {
          const destinationId =
            action.slice(
              "portal:"
                .length
            );


          try {
            const response =
              await apiClient.post(
                `/games/${game.id}/realmlife/portal-travel`,

                {
                  source_portal_id:
                    sourceId,

                  destination_portal_id:
                    destinationId,
                }
              );


            const spawn =
              response.data
                ?.spawn;


            if (!spawn) {
              throw new Error(
                "Portal destination has no spawn."
              );
            }


            await teleportResidentWithFade(
              spawn,

              spawn.floor
                || "WORLD",

              `Portal arrival · ${
                response.data
                  ?.destination_label
                || destinationId
              }`
            );

          } catch (err) {
            setRealmTravelFade(
              false
            );


            const detail =
              err?.response
                ?.data
                ?.detail;


            setHud(
              (h) => ({
                ...h,

                msg:
                  typeof detail
                    === "string"
                    ? detail
                    : (
                        err
                          ?.message
                        ||
                        "Portal travel failed."
                      ),
              })
            );
          }


          return;
        }
      };



    // --------------------------------------------------------
    // REALMLIFE CHARACTER MOTION CORE
    //
    // Locomotion animation follows actual X/Z displacement,
    // so click-to-walk AND WASD both animate correctly.
    //
    // Jump has real vertical movement independent of the
    // currently equipped avatar having a dedicated jump clip.
    // --------------------------------------------------------

    let residentGrounded =
      true;

    let residentJumpVelocity =
      0;

    let residentJumpFrame =
      null;

    let residentMotionFrame =
      null;

    let motionShiftDown =
      false;

    let lastMotionX =
      resident.position.x;

    let lastMotionZ =
      resident.position.z;

    let lastMotionTime =
      performance.now();


    const requestResidentJump =
      () => {
        if (
          !residentGrounded
          ||
          residentInteractionBusy
        ) {
          return;
        }

        residentGrounded =
          false;

        residentJumpVelocity =
          6.4;

        residentAvatar
          ?.setAirborne(
            true
          );

        setHud(
          (h) => ({
            ...h,
            msg:
              "Jump",
          })
        );
      };


    const onResidentMotionKeyDown =
      (event) => {
        if (
          event.code
          === "ShiftLeft"
          ||
          event.code
          === "ShiftRight"
        ) {
          motionShiftDown =
            true;
        }

        if (
          event.code
          === "Space"
        ) {
          /*
           * Do not make Space scroll the web page while
           * RealmLife has focus.
           */
          if (
            document.activeElement
            === document.body
            ||
            mountRef.current
              ?.contains(
                document.activeElement
              )
          ) {
            event.preventDefault();
          }

          requestResidentJump();
        }
      };


    const onResidentMotionKeyUp =
      (event) => {
        if (
          event.code
          === "ShiftLeft"
          ||
          event.code
          === "ShiftRight"
        ) {
          motionShiftDown =
            false;
        }
      };


    const onResidentJumpEvent =
      () => {
        requestResidentJump();
      };


    window.addEventListener(
      "keydown",
      onResidentMotionKeyDown
    );

    window.addEventListener(
      "keyup",
      onResidentMotionKeyUp
    );

    window.addEventListener(
      "realmlife:jump",
      onResidentJumpEvent
    );


    const monitorResidentMotion =
      (now) => {
        if (disposed)
          return;

        const dt =
          Math.min(
            0.05,
            Math.max(
              0.001,
              (
                now
                - lastMotionTime
              )
              / 1000
            )
          );

        lastMotionTime =
          now;


        // ----------------------------------------------
        // PHYSICAL JUMP
        // ----------------------------------------------

        if (
          !residentGrounded
        ) {
          residentJumpVelocity -=
            15.5
            * dt;

          resident.position.y +=
            residentJumpVelocity
            * dt;


          if (
            resident.position.y
            <= 0
          ) {
            resident.position.y =
              0;

            residentJumpVelocity =
              0;

            residentGrounded =
              true;

            residentAvatar
              ?.setAirborne(
                false
              );
          }
        }


        // ----------------------------------------------
        // WALK / RUN / IDLE FROM REAL DISPLACEMENT
        // ----------------------------------------------

        const dx =
          resident.position.x
          - lastMotionX;

        const dz =
          resident.position.z
          - lastMotionZ;

        const planarDistance =
          Math.hypot(
            dx,
            dz
          );

        const planarSpeed =
          planarDistance
          / dt;

        lastMotionX =
          resident.position.x;

        lastMotionZ =
          resident.position.z;


        if (
          residentAvatar
          &&
          !residentInteractionBusy
          &&
          residentGrounded
        ) {
          if (
            planarSpeed
            > 0.08
          ) {
            residentAvatar.setState(
              motionShiftDown
                ? "run"
                : "walk"
            );

            if (
              planarDistance
              > 0.0005
            ) {
              resident.rotation.y =
                Math.atan2(
                  dx,
                  dz
                );
            }
          } else {
            residentAvatar.setState(
              "idle"
            );
          }
        }


        residentMotionFrame =
          requestAnimationFrame(
            monitorResidentMotion
          );
      };


    residentMotionFrame =
      requestAnimationFrame(
        monitorResidentMotion
      );

    let avatarCfg = {
      ...DEFAULT_AVERY_AVATAR,

      animationUrls: {
        ...REALMLIFE_UNIVERSAL_MOTIONS,
        ...(
          DEFAULT_AVERY_AVATAR
            .animationUrls
          || {}
        ),
      },
    };


    const resolveRealmLifeAvatar =
      async () => {
        try {
          const response =
            await apiClient.get(
              `/games/${game.id}/realmlife/avatar`
            );

          const nexusAvatar =
            response.data;

          if (
            nexusAvatar
              ?.model_url
          ) {
            avatarCfg = {
              modelUrl:
                nexusAvatar
                  .model_url,

              animationUrls: {
                /*
                 * Interaction pack first.
                 * The avatar's OWN Nexus motions override it
                 * when the same named animation exists.
                 */
                ...REALMLIFE_UNIVERSAL_MOTIONS,

                ...(
                  nexusAvatar
                    .animation_urls
                  || {}
                ),
              },
            };


            if (
              nexusAvatar
                ?.username
            ) {
              simRef.current
                .resident
                .name =
                  nexusAvatar
                    .username;
            }


            console.info(
              "[RealmLife] Nexus avatar",
              nexusAvatar
                .avatar_id,
              nexusAvatar
                .founder_private
                ? "(Founder private)"
                : ""
            );
          }
        } catch (err) {
          console.warn(
            "[RealmLife] Nexus avatar unavailable; using emergency fallback",
            err
          );
        }


        return createLifeAvatar({
          modelUrl:
            avatarCfg.modelUrl,

          animationUrls:
            avatarCfg.animationUrls,

          targetHeight:
            1.82,
        });
      };

    resolveRealmLifeAvatar()
      .then((ctrl) => {
        if (disposed) {
          ctrl.dispose();
          return;
        }

        residentAvatar = ctrl;

        residentPlaceholder.visible =
          false;

        resident.add(ctrl.model);

        setHud((h) => ({
          ...h,
          msg:
            "Avery is ready.",
        }));
      })
      .catch((err) => {
        console.error(
          "[RealmLife] Avery avatar failed to load",
          err
        );

        setHud((h) => ({
          ...h,
          msg:
            "Character model failed to load — using safe fallback.",
        }));
      });

    // --------------------------------------------------------
    // AUTONOMOUS NPC NEIGHBOR
    // --------------------------------------------------------

    const neighbor = new THREE.Group();

    const neighborPlaceholder =
      makePerson(0xff8a5a, 0x2c1a14);

    neighbor.add(neighborPlaceholder);

    neighbor.position.set(6.7, 0, 6.1);

    neighbor.userData.lifeObject = true;
    neighbor.userData.id = "neighbor";
    neighbor.userData.label = "Neighbor";
    neighbor.userData.actions = [
      { id: "talk", label: "Talk" },
    ];
    neighbor.userData.approach = [-1.1, 0];

    scene.add(neighbor);
    interactive.push(neighbor);
    objectMapRef.current.set(
      "neighbor",
      neighbor
    );

    let neighborAvatar = null;
    let neighborPath = [];
    let neighborMoveTarget = null;

    createLifeAvatar({
      modelUrl:
        DEFAULT_NEIGHBOR_AVATAR.modelUrl,
      animationUrls:
        DEFAULT_NEIGHBOR_AVATAR.animationUrls,
      targetHeight: 1.78,
    })
      .then((ctrl) => {
        if (disposed) {
          ctrl.dispose();
          return;
        }

        neighborAvatar = ctrl;
        neighborPlaceholder.visible = false;
        neighbor.add(ctrl.model);
      })
      .catch((err) => {
        console.error(
          "[RealmLife] Neighbor avatar failed to load",
          err
        );
      });

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
      if (
        x < neighborhood.bounds.minX ||
        x > neighborhood.bounds.maxX ||
        z < neighborhood.bounds.minZ ||
        z > neighborhood.bounds.maxZ
      ) return true;

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
          minX: neighborhood.bounds.minX,
          maxX: neighborhood.bounds.maxX,
          minZ: neighborhood.bounds.minZ,
          maxZ: neighborhood.bounds.maxZ,
        }
      );

    // --------------------------------------------------------
    // INPUT / CLICK-TO-WALK / BUILD MODE
    // --------------------------------------------------------

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const keys = {};

    // --------------------------------------------------------
    // FIRST-PERSON LOOK
    // --------------------------------------------------------

    let firstYaw = 0;
    let firstPitch = 0;

    let previousCameraMode =
      cameraModeRef.current;

    let lookPointerId = null;
    let lookLastX = 0;
    let lookLastY = 0;
    let lookTravel = 0;

    const LOOK_MOUSE_SPEED =
      0.0042;

    const LOOK_TOUCH_SPEED =
      0.0052;

    const MAX_LOOK_PITCH =
      Math.PI * 0.40;

    const setPointer = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };

    const performPointerAction = async (e) => {

      markRealmLifeActive();
      setPointer(e);

      const hits = raycaster.intersectObjects(interactive, true);

      if (hits.length) {
        let obj = hits[0].object;
        while (obj && !obj.userData?.lifeObject) obj = obj.parent;

        if (obj?.userData?.lifeObject) {
          buildItemRef.current = null;
          setBuildItemState(null);

          // REALMLIFE V5F1 DYNAMIC PORTAL DESTINATIONS
          let objectActions =
            obj.userData.actions || [];

          if (
            obj.userData
              .realmLifePortal
          ) {
            try {
              const response =
                await apiClient.get(
                  `/games/${game.id}/realmlife/portals`
                );

              objectActions =
                (
                  response.data
                    ?.portals || []
                )
                  .filter(
                    (p) =>
                      p.id !==
                        obj.userData.id
                      &&
                      p.accessible
                      &&
                      !p.locked
                  )
                  .map(
                    (p) => ({
                      id:
                        `portal:${p.id}`,

                      label:
                        (
                        p.id ===
                        response.data?.my_portal_id
                          ? "Return to My Portal"
                          : `Travel to ${p.label}`
                      ),
                    })
                  );
            } catch (err) {
              console.debug(
                "[RealmLife] portal destination load",
                err
              );
            }
          }

          setSelected({
            id: obj.userData.id,
            label: obj.userData.label,
            actions: objectActions,
          });

          return;
        }
      }

      const floorHit =
        raycaster.intersectObject(
          neighborhood.clickPlane,
          false
        )[0];
      if (!floorHit) return;

      let x = THREE.MathUtils.clamp(
        floorHit.point.x,
        neighborhood.bounds.minX,
        neighborhood.bounds.maxX
      );

      let z = THREE.MathUtils.clamp(
        floorHit.point.z,
        neighborhood.bounds.minZ,
        neighborhood.bounds.maxZ
      );

      // BUILD/BUY placement
      if (buildItemRef.current) {
        const kind = buildItemRef.current;
        const def = BUILD_CATALOG[kind];

        x = Math.round(x * 2) / 2;
        z = Math.round(z * 2) / 2;

        const lot =
          neighborhood.ownedLot;

        if (
          x < lot.minX ||
          x > lot.maxX ||
          z < lot.minZ ||
          z > lot.maxZ
        ) {
          setHud((h) => ({
            ...h,
            msg:
              "Build / Buy is limited to your home and yard.",
          }));

          return;
        }

        if (blocked(x, z)) {
          setHud((h) => ({ ...h, msg: "That spot is blocked." }));
          return;
        }

        let fireResult;

        try {
          fireResult =
            await burnRealmLifeBuild(kind);
        } catch (err) {
          setHud((h) => ({
            ...h,
            msg:
              err?.message ||
              "Not enough RealmLife Fire Power.",
          }));

          return;
        }

        const id = `placed-${simRef.current.nextPlacedId++}`;

        const rec = { id, kind, x, z };
        simRef.current.placed.push(rec);
        addPlacedObject(rec);

        setHud((h) => ({
          ...h,
          msg:
            `${def.label} placed · 🔥${fireResult.burned} Fire Power burned.`,
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

    const onPointer = async (e) => {
      markRealmLifeActive();

      if (
        cameraModeRef.current !==
        "first"
      ) {
        return performPointerAction(
          e
        );
      }

      if (
        e.button != null &&
        e.button !== 0
      ) {
        return;
      }

      lookPointerId =
        e.pointerId;

      lookLastX =
        e.clientX;

      lookLastY =
        e.clientY;

      lookTravel = 0;

      try {
        renderer.domElement
          .setPointerCapture?.(
            e.pointerId
          );
      } catch (_) {}
    };


    const onPointerMove = (e) => {
      if (
        cameraModeRef.current !==
          "first" ||
        lookPointerId == null ||
        e.pointerId !==
          lookPointerId
      ) {
        return;
      }

      const dx =
        e.clientX -
        lookLastX;

      const dy =
        e.clientY -
        lookLastY;

      lookLastX =
        e.clientX;

      lookLastY =
        e.clientY;

      lookTravel +=
        Math.abs(dx) +
        Math.abs(dy);

      const sensitivity =
        e.pointerType === "touch"
          ? LOOK_TOUCH_SPEED
          : LOOK_MOUSE_SPEED;

      const controlSign =
        controlDirectionRef.current ===
          "normal"
          ? -1
          : 1;

      // NORMAL = user-friendly opposite of the original POV
      // direction.
      //
      // REVERSE = exact original behavior.
      firstYaw +=
        dx *
        sensitivity *
        controlSign;

      firstPitch -=
        dy *
        sensitivity *
        controlSign;

      firstPitch =
        THREE.MathUtils.clamp(
          firstPitch,
          -MAX_LOOK_PITCH,
          MAX_LOOK_PITCH
        );

      markRealmLifeActive();
    };


    const finishFirstPersonPointer =
      async (
        e,
        cancelled = false
      ) => {
        if (
          lookPointerId == null ||
          e.pointerId !==
            lookPointerId
        ) {
          return;
        }

        const wasTap =
          !cancelled &&
          lookTravel < 8;

        try {
          renderer.domElement
            .releasePointerCapture?.(
              e.pointerId
            );
        } catch (_) {}

        lookPointerId = null;

        // Tap/click still performs normal RealmLife interaction.
        if (wasTap) {
          await performPointerAction(
            e
          );
        }
      };


    const onPointerUp = (e) => {
      finishFirstPersonPointer(
        e,
        false
      );
    };


    const onPointerCancel = (e) => {
      finishFirstPersonPointer(
        e,
        true
      );
    };


    const onWheel = (e) => {
      markRealmLifeActive();

      if (
        cameraModeRef.current ===
        "first"
      ) {
        e.preventDefault();
        return;
      }

      camDistance =
        THREE.MathUtils.clamp(
          camDistance +
            e.deltaY * 0.012,
          10,
          34
        );

      e.preventDefault();
    };

    const onKeyDown = (e) => {

      markRealmLifeActive();
      keys[e.key.toLowerCase()] = true;

      if (
        e.key.toLowerCase() ===
        "q"
      ) {
        if (
          cameraModeRef.current ===
          "first"
        ) {
          firstYaw -=
            (Math.PI / 12) *
            (
              controlDirectionRef.current ===
                "normal"
                ? -1
                : 1
            );
        } else {
          camAngle -=
            Math.PI / 12;
        }
      }

      if (
        e.key.toLowerCase() ===
        "e"
      ) {
        if (
          cameraModeRef.current ===
          "first"
        ) {
          firstYaw +=
            (Math.PI / 12) *
            (
              controlDirectionRef.current ===
                "normal"
                ? -1
                : 1
            );
        } else {
          camAngle +=
            Math.PI / 12;
        }
      }
    };

    const onKeyUp = (e) => {
      keys[e.key.toLowerCase()] = false;
    };

    renderer.domElement.addEventListener(
      "pointerdown",
      onPointer
    );

    renderer.domElement.addEventListener(
      "pointermove",
      onPointerMove
    );

    renderer.domElement.addEventListener(
      "pointerup",
      onPointerUp
    );

    renderer.domElement.addEventListener(
      "pointercancel",
      onPointerCancel
    );

    renderer.domElement.addEventListener(
      "wheel",
      onWheel,
      {
        passive: false,
      }
    );

    window.addEventListener(
      "keydown",
      onKeyDown
    );

    window.addEventListener(
      "keyup",
      onKeyUp
    );

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
    let neighborDecisionIn = 1.25;
    let neighborHoldUntil = 0;

    const applyAction = async (actionId, objectId = null) => {

      // ======================================================
      // REALMLIFE SPECIAL ACTION DELEGATE
      // ======================================================

      if (
        (
          String(
            actionId
            || ""
          ).startsWith(
            "elevator:"
          )
          ||
          String(
            actionId
            || ""
          ).startsWith(
            "portal:"
          )
        )
        &&
        instantRealmTravelRef.current
      ) {
        await instantRealmTravelRef
          .current(
            actionId,
            objectId
          );

        return;
      }

      // REALMLIFE V5F1 PORTAL + ELEVATOR ACTIONS

      if (
        actionId.startsWith(
          "elevator:"
        )
      ) {
        const floor =
          actionId.slice(
            "elevator:".length
          );

        const spawn =
          founderEstate
            .floorSpawns[
              floor
            ];

        if (!spawn) {
          setHud((h) => ({
            ...h,
            msg:
              "That elevator level is unavailable.",
          }));

          return;
        }

        moveTargetRef.current =
          null;

        pathRef.current = [];

        pendingActionRef.current =
          null;

        resident.position.set(
          spawn.x,
          0,
          spawn.z
        );

        simRef.current
          .resident.x =
            spawn.x;

        simRef.current
          .resident.z =
            spawn.z;

        residentAvatar
          ?.setState?.(
            "idle"
          );

        setSelected(null);

        setHud((h) => ({
          ...h,

          msg:
            floor === "B1"
              ? "Elevator arrived · B1 Private Cinema"
              : floor === "B2"
                ? "Elevator arrived · B2 Recording Studio"
                : floor === "B3"
                  ? "Elevator arrived · B3 Founder Laboratory"
                  : `Elevator arrived · Level ${floor}`,
        }));

        markRealmLifeActive();

        scheduleSave();

        return;
      }


      if (
        actionId.startsWith(
          "portal:"
        )
      ) {
        const destinationId =
          actionId.slice(
            "portal:".length
          );

        try {
          const response =
            await apiClient.post(
              `/games/${game.id}/realmlife/portal-travel`,
              {
                source_portal_id:
                  objectId,

                destination_portal_id:
                  destinationId,
              }
            );

          const spawn =
            response.data
              ?.spawn;

          if (!spawn) {
            throw new Error(
              "Portal destination has no spawn."
            );
          }

          moveTargetRef.current =
            null;

          pathRef.current = [];

          pendingActionRef.current =
            null;

          resident.position.set(
            Number(
              spawn.x || 0
            ),
            Number(
              spawn.y || 0
            ),
            Number(
              spawn.z || 0
            )
          );

          simRef.current
            .resident.x =
              Number(
                spawn.x || 0
              );

          simRef.current
            .resident.z =
              Number(
                spawn.z || 0
              );

          residentAvatar
            ?.setState?.(
              "idle"
            );

          setSelected(null);

          setHud((h) => ({
            ...h,

            msg:
              `Portal arrival · ${
                response.data
                  ?.destination_label
                || destinationId
              }`,
          }));

          markRealmLifeActive();

          scheduleSave();
        } catch (err) {
          const detail =
            err?.response
              ?.data?.detail;

          setHud((h) => ({
            ...h,

            msg:
              typeof detail
              === "string"
                ? detail
                : (
                    err?.message
                    ||
                    "Portal travel failed."
                  ),
          }));
        }

        return;
      }


      const fx = ACTION_EFFECTS[actionId];
      if (!fx) return;

      const s = simRef.current;

      if (residentInteractionBusy) {
        return;
      }

      if ((fx.fire_cost || 0) > 0) {
        try {
          await burnRealmLifeAction(
            actionId
          );
        } catch (err) {
          setHud((h) => ({
            ...h,
            msg:
              err?.message ||
              "Not enough RealmLife Fire Power.",
          }));

          return;
        }
      }

      // ----------------------------------------------------
      // REAL AAA CHARACTER INTERACTION SEQUENCES
      // ----------------------------------------------------

      if (residentAvatar) {
        const target =
          objectId
            ? objectMapRef.current.get(objectId)
            : null;

        if (target) {
          const dx =
            target.position.x -
            resident.position.x;

          const dz =
            target.position.z -
            resident.position.z;

          if (Math.hypot(dx, dz) > 0.01) {
            resident.rotation.y =
              Math.atan2(dx, dz);
          }
        }

        /*
         * Sit/Lie interactions use an exact object anchor,
         * rather than performing the animation beside the
         * furniture.
         */
        if (
          target
          &&
          (
            actionId === "relax"
            ||
            actionId === "sleep"
          )
          &&
          target.userData
            ?.interactionAnchor
        ) {
          const anchor =
            target.userData
              .interactionAnchor;

          resident.position.x =
            target.position.x
            + Number(
                anchor.x
                || 0
              );

          resident.position.y =
            Number(
              anchor.y
              || 0
            );

          resident.position.z =
            target.position.z
            + Number(
                anchor.z
                || 0
              );

          resident.rotation.y =
            Number.isFinite(
              Number(
                anchor.rotationY
              )
            )
              ? Number(
                  anchor.rotationY
                )
              : resident.rotation.y;


          simRef.current
            .resident.x =
              resident.position.x;

          simRef.current
            .resident.z =
              resident.position.z;
        }


        let sequence = null;

        if (actionId === "relax") {
          sequence = [
            { name: "sit_down" },
            {
              name: "sit_idle",
              mode: "loop",
              ms: 2600,
            },
            { name: "stand_up" },
          ];
        }

        if (actionId === "sleep") {
          sequence = [
            { name: "lie_down" },
            {
              name: "sleep",
              mode: "loop",
              ms: 3800,
            },
            { name: "wake_up" },
          ];
        }

        if (actionId === "talk") {
          sequence = [
            { name: "talk" },
          ];
        }

        if (sequence) {
          residentInteractionBusy = true;

          setHud((h) => ({
            ...h,
            msg:
              actionId === "sleep"
                ? "Sleeping…"
                : actionId === "relax"
                  ? "Relaxing…"
                  : "Talking…",
          }));

          try {
            await residentAvatar.playSequence(
              sequence
            );
          } finally {
            residentInteractionBusy = false;
          }
        }
      }

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

      if (actionId === "talk") {
        // Face each other before the social animation.
        const dx =
          neighbor.position.x -
          resident.position.x;

        const dz =
          neighbor.position.z -
          resident.position.z;

        if (Math.hypot(dx, dz) > 0.01) {
          resident.rotation.y =
            Math.atan2(dx, dz);

          neighbor.rotation.y =
            Math.atan2(-dx, -dz);
        }

        // Avery now uses the dedicated RealmLife
        // Stand-and-Chat animation. The neighbor still uses
        // their existing greeting motion until NPC Motion Pack
        // A is generated.
        neighborAvatar?.playOnce(
          "greet"
        );

        // Keep the NPC nearby until the greeting finishes.
        neighborHoldUntil =
          performance.now() + 2800;

        neighborMoveTarget = null;
        neighborPath = [];
      }

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

      let residentMoving = false;
      let residentRunning = false;

      const firstPersonMovement =
        cameraModeRef.current ===
        "first";

      const camForward =
        firstPersonMovement
          ? new THREE.Vector3(
              Math.sin(firstYaw),
              0,
              Math.cos(firstYaw)
            )
          : new THREE.Vector3(
              -Math.sin(camAngle),
              0,
              -Math.cos(camAngle)
            );

      const camRight =
        firstPersonMovement
          ? new THREE.Vector3(
              Math.cos(firstYaw),
              0,
              -Math.sin(firstYaw)
            )
          : new THREE.Vector3(
              Math.cos(camAngle),
              0,
              -Math.sin(camAngle)
            );

      // REALMLIFE NORMAL POV A/D FIX

      // Only NORMAL POV horizontal A/D is corrected.

      const realmLifeHorizontalInput = ((keys.d || keys.arrowright ? 1 : 0) -
        (keys.a || keys.arrowleft ? 1 : 0));

      let mx =

        firstPersonMovement &&

        controlDirectionRef.current === "normal"

          ? -realmLifeHorizontalInput

          : realmLifeHorizontalInput;

      let mz =
        (keys.s || keys.arrowdown ? 1 : 0) -
        (keys.w || keys.arrowup ? 1 : 0);

      if ((mx || mz) && !residentInteractionBusy) {
        moveTargetRef.current = null;
        pathRef.current = [];
        pendingActionRef.current = null;

        const v = new THREE.Vector3()
          .addScaledVector(camRight, mx)
          .addScaledVector(camForward, -mz);

        if (v.lengthSq() > 0) v.normalize();

        // REALMLIFE WALK RUN PHYSICAL SPEED
        // Normal movement = walking pace.
        // Shift = full running pace.
        v.multiplyScalar(
          motionShiftDown
            ? 1.0
            : 0.58
        );


        residentMoving = true;
        residentRunning =
          !!keys.shift;

        const moveSpeed =
          residentRunning
            ? 5.2
            : 3.5;

        const nx =
          resident.position.x +
          v.x * moveSpeed * dt;

        const nz =
          resident.position.z +
          v.z * moveSpeed * dt;

        if (!blocked(nx, resident.position.z))
          resident.position.x = nx;

        if (!blocked(resident.position.x, nz))
          resident.position.z = nz;

        if (v.lengthSq() > 0.01)
          resident.rotation.y = Math.atan2(v.x, v.z);
      }

      if (
        moveTargetRef.current &&
        !residentInteractionBusy
      ) {
        residentMoving = true;
        residentRunning = false;

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
              applyAction(
                pending.actionId,
                pending.objectId
              );
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

      if (residentAvatar) {
        residentAvatar.setState(
          residentMoving
            ? (
              residentRunning
                ? "run"
                : "walk"
            )
            : "idle"
        );

        residentAvatar.update(dt);
      }

      // ------------------------------------------------------
      // AUTONOMOUS NEIGHBOR A* NAVIGATION
      // ------------------------------------------------------

      let neighborMoving = false;

      const socialPending =
        pendingActionRef.current?.objectId ===
        "neighbor";

      const socialHold =
        performance.now() <
        neighborHoldUntil;

      if (socialPending || socialHold) {
        // Do not let the NPC walk away while Avery is
        // approaching or while a social action is playing.
        neighborMoveTarget = null;
        neighborPath = [];

        const dx =
          resident.position.x -
          neighbor.position.x;

        const dz =
          resident.position.z -
          neighbor.position.z;

        if (Math.hypot(dx, dz) > 0.01) {
          neighbor.rotation.y =
            Math.atan2(dx, dz);
        }
      } else {
        if (!neighborMoveTarget) {
          neighborDecisionIn -= dt;

          if (neighborDecisionIn <= 0) {
            // Simple household destinations. The pathfinder
            // decides whether each destination is reachable.
            const destinations = [
              { x: 6.0, z: 5.0 },
              { x: 3.8, z: 2.0 },
              { x: 0.0, z: 4.8 },
              { x: -4.0, z: 2.2 },
              { x: -6.2, z: -1.0 },
              { x: -5.3, z: -5.5 },
              { x: 0.0, z: -2.0 },
              { x: 6.2, z: -1.5 },
            ];

            const shuffled =
              [...destinations].sort(
                () => Math.random() - 0.5
              );

            let route = [];

            for (const destination of shuffled) {
              route =
                findPathRef.current?.(
                  {
                    x: neighbor.position.x,
                    z: neighbor.position.z,
                  },
                  destination
                ) || [];

              if (route.length) break;
            }

            if (route.length) {
              neighborPath = route.map(
                (p) =>
                  new THREE.Vector3(
                    p.x,
                    0,
                    p.z
                  )
              );

              neighborMoveTarget =
                neighborPath.shift() ||
                null;
            }

            neighborDecisionIn =
              2.5 + Math.random() * 4.5;
          }
        }

        if (neighborMoveTarget) {
          neighborMoving = true;

          const dx =
            neighborMoveTarget.x -
            neighbor.position.x;

          const dz =
            neighborMoveTarget.z -
            neighbor.position.z;

          const dist =
            Math.hypot(dx, dz);

          if (dist < 0.13) {
            if (neighborPath.length) {
              neighborMoveTarget =
                neighborPath.shift();
            } else {
              neighborMoveTarget = null;
              neighborMoving = false;

              neighborDecisionIn =
                2 + Math.random() * 4;
            }
          } else {
            const vx =
              dx /
              Math.max(dist, 0.001);

            const vz =
              dz /
              Math.max(dist, 0.001);

            const moveSpeed = 1.65;

            const nx =
              neighbor.position.x +
              vx * moveSpeed * dt;

            const nz =
              neighbor.position.z +
              vz * moveSpeed * dt;

            if (
              !blocked(
                nx,
                neighbor.position.z
              )
            ) {
              neighbor.position.x = nx;
            }

            if (
              !blocked(
                neighbor.position.x,
                nz
              )
            ) {
              neighbor.position.z = nz;
            }

            neighbor.rotation.y =
              Math.atan2(vx, vz);
          }
        }
      }

      if (neighborAvatar) {
        neighborAvatar.setState(
          neighborMoving
            ? "walk"
            : "idle"
        );

        neighborAvatar.update(dt);
      }

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
      // REALMLIFE MULTI-VIEW CAMERA
      //
      // WORLD
      //   Existing elevated life-sim camera.
      //
      // FIRST
      //   Eye-height first-person POV.
      //
      // XR LATER
      //   WebXR/device pose can take over RealmLifeCameraRig.
      // ------------------------------------------------------

      const activeCameraMode =
        cameraModeRef.current;

      cameraRig.userData.mode =
        activeCameraMode;


      // ------------------------------------------------------
      // MODE TRANSITION
      // ------------------------------------------------------

      if (
        previousCameraMode !==
        activeCameraMode
      ) {
        lookPointerId = null;

        if (
          activeCameraMode ===
          "first"
        ) {
          // Begin POV facing the same direction as Avery.
          firstYaw =
            Number.isFinite(
              resident.rotation.y
            )
              ? resident.rotation.y
              : 0;

          firstPitch = 0;

          // Stop an old click-to-walk route when switching
          // into direct first-person control.
          moveTargetRef.current =
            null;

          pathRef.current = [];

          camera.position.set(
            resident.position.x,
            1.62,
            resident.position.z
          );
        }

        previousCameraMode =
          activeCameraMode;
      }


      // ------------------------------------------------------
      // FOV
      // ------------------------------------------------------

      const desiredFov =
        activeCameraMode ===
          "first"
          ? FIRST_PERSON_FOV
          : WORLD_CAMERA_FOV;

      const nextFov =
        THREE.MathUtils.lerp(
          camera.fov,
          desiredFov,
          1 -
            Math.exp(
              -dt * 10
            )
        );

      if (
        Math.abs(
          nextFov -
          camera.fov
        ) >
        0.001
      ) {
        camera.fov =
          nextFov;

        camera
          .updateProjectionMatrix();
      }


      // ------------------------------------------------------
      // FIRST PERSON
      // ------------------------------------------------------

      if (
        activeCameraMode ===
        "first"
      ) {
        // Hide only Avery's local rendered body.
        // His actual RealmLife object remains active for:
        // - movement
        // - collision
        // - interactions
        // - saves
        // - future multiplayer replication
        resident.visible = false;

        const eye =
          new THREE.Vector3(
            resident.position.x,
            1.62,
            resident.position.z
          );

        camera.position.lerp(
          eye,
          1 -
            Math.exp(
              -dt * 18
            )
        );

        const cosPitch =
          Math.cos(
            firstPitch
          );

        const lookDirection =
          new THREE.Vector3(
            Math.sin(firstYaw) *
              cosPitch,

            Math.sin(firstPitch),

            Math.cos(firstYaw) *
              cosPitch
          );

        camera.lookAt(
          camera.position
            .clone()
            .add(
              lookDirection
            )
        );
      }


      // ------------------------------------------------------
      // EXISTING WORLD VIEW
      // ------------------------------------------------------

      else {
        resident.visible = true;

        const focus =
          new THREE.Vector3(
            resident.position.x,
            0.65,
            resident.position.z
          );

        const desiredCamera =
          new THREE.Vector3(
            focus.x +
              Math.sin(camAngle) *
                camDistance,

            12.8,

            focus.z +
              Math.cos(camAngle) *
                camDistance
          );

        camera.position.lerp(
          desiredCamera,
          1 -
            Math.exp(
              -dt * 5.5
            )
        );

        camera.lookAt(
          focus
        );
      }

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

      window.removeEventListener(
        "keydown",
        onResidentMotionKeyDown
      );

      window.removeEventListener(
        "keyup",
        onResidentMotionKeyUp
      );

      window.removeEventListener(
        "realmlife:jump",
        onResidentJumpEvent
      );

      if (
        residentMotionFrame
      ) {
        cancelAnimationFrame(
          residentMotionFrame
        );
      }

      if (
        residentJumpFrame
      ) {
        cancelAnimationFrame(
          residentJumpFrame
        );
      }

      residentAvatar?.dispose();
      residentAvatar = null;

      neighborAvatar?.dispose();
      neighborAvatar = null;
      neighborMoveTarget = null;
      neighborPath = [];

      clearTimeout(saveTimerRef.current);

      renderer.domElement.removeEventListener(
        "pointerdown",
        onPointer
      );

      renderer.domElement.removeEventListener(
        "pointermove",
        onPointerMove
      );

      renderer.domElement.removeEventListener(
        "pointerup",
        onPointerUp
      );

      renderer.domElement.removeEventListener(
        "pointercancel",
        onPointerCancel
      );

      renderer.domElement.removeEventListener(
        "wheel",
        onWheel
      );

      window.removeEventListener(
        "keydown",
        onKeyDown
      );

      window.removeEventListener(
        "keyup",
        onKeyUp
      );

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

      // REALMLIFE TRAVEL CLEANUP
      instantRealmTravelRef.current =
        null;

      window.__REALMLIFE_INDOOR =
        false;

      realmLifeEnvironmentController?.dispose();

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
          <button
            type="button"
            onClick={() => {
              markRealmLifeActive();
              setFirePanelOpen(true);
            }}
            className="text-[10px] mt-1"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "#ffcf66",
              border:
                "1px solid rgba(255,207,102,.22)",
              background:
                "rgba(255,138,76,.08)",
              borderRadius: 999,
              padding: "3px 7px",
              cursor: "pointer",
              fontWeight: 950,
            }}
            title="RealmLife Fire Power"
          >
            🔥{(
              realmFire?.fire_balance ?? 0
            ).toLocaleString()}

            <span
              style={{
                display: "inline-flex",
                width: 17,
                height: 17,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                background:
                  "rgba(255,138,76,.25)",
                color: "#fff",
                fontSize: 13,
                lineHeight: 1,
              }}
            >
              +
            </span>
          </button>
        </div>

        <div className="pointer-events-auto flex items-center gap-1">

          <button
            type="button"
            onClick={
              toggleRealmLifeCamera
            }
            className="px-2.5 py-1.5 rounded-lg text-xs font-black"
            style={{
              background:
                cameraMode ===
                  "first"
                  ? "rgba(255,138,76,.30)"
                  : "rgba(3,10,20,.72)",

              border:
                cameraMode ===
                  "first"
                  ? "1px solid rgba(255,138,76,.58)"
                  : "1px solid rgba(46,230,255,.28)",

              color: "#fff",
            }}
            title={
              cameraMode ===
                "first"
                ? "Return to World View"
                : "Enter First Person POV"
            }
          >
            {cameraMode ===
              "first"
              ? "🌐 WORLD"
              : "👁 POV"}
          </button>

          <button
            type="button"
            onClick={
              toggleControlDirection
            }
            className="px-2.5 py-1.5 rounded-lg text-xs font-black"
            style={{
              background:
                controlDirection ===
                  "normal"
                  ? "rgba(46,230,255,.22)"
                  : "rgba(197,140,255,.20)",

              border:
                controlDirection ===
                  "normal"
                  ? "1px solid rgba(46,230,255,.42)"
                  : "1px solid rgba(197,140,255,.42)",

              color: "#fff",
            }}
            title="Switch POV camera control direction"
          >
            {controlDirection ===
              "normal"
              ? "🎮 NORMAL"
              : "↔ REVERSE"}
          </button>

          <button
            type="button"
            onClick={() =>
              realmProperty.setOpen(
                true
              )
            }
            className="px-2.5 py-1.5 rounded-lg text-xs font-black"
            style={{
              background:
                "rgba(46,230,255,.12)",

              border:
                "1px solid rgba(46,230,255,.28)",

              color: "#fff",
            }}
            title="Property & Household"
          >
            🏠 PROPERTY
            {(
              realmProperty
                .inbox
                ?.pending_total ||
              0
            ) > 0
              ? ` (${
                  realmProperty
                    .inbox
                    .pending_total
                })`
              : ""}
          </button>

          {realmEnvironment.isFounder && (
            <button
              type="button"
              onClick={() =>
                realmEnvironment.setOpen(
                  true
                )
              }
              className="px-2.5 py-1.5 rounded-lg text-xs font-black"
              style={{
                background:
                  "rgba(255,170,70,.13)",

                border:
                  "1px solid rgba(255,170,70,.38)",

                color:
                  "#fff",
              }}
              title="Stealth Founder RealmLife Admin"
            >
              ⚙ ADMIN
            </button>
          )}

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
                onClick={() => {
                  if (
                    a.id ===
                    "property_manage"
                  ) {
                    realmProperty.setOpen(
                      true
                    );

                    setSelected(
                      null
                    );

                    return;
                  }

                  queueAction(
                    a.id
                  );
                }}
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

      <RealmLifeFirePanel
        open={firePanelOpen}
        onClose={() =>
          setFirePanelOpen(false)
        }
        account={realmFire}
        amount={fireAmount}
        setAmount={setFireAmount}
        busy={fireBusy}
        notice={fireNotice}
        onAdd={addFromVault}
        onWithdraw={withdrawToVault}
      />

      {/* REALMLIFE JUMP CONTROL */}
      <button
        type="button"
        onPointerDown={(event) => {
          event.preventDefault();

          window.dispatchEvent(
            new Event(
              "realmlife:jump"
            )
          );

          markRealmLifeActive();
        }}
        className="absolute right-4 bottom-[96px] z-30 w-[62px] h-[62px] rounded-full text-[11px] font-black"
        style={{
          background:
            "linear-gradient(180deg,rgba(16,54,78,.94),rgba(4,20,34,.94))",

          border:
            "1px solid rgba(46,230,255,.48)",

          color:
            "#fff",

          boxShadow:
            "0 8px 26px rgba(0,0,0,.38),0 0 22px rgba(46,230,255,.12)",

          backdropFilter:
            "blur(10px)",
        }}
        title="Jump"
      >
        <div className="text-lg leading-none">
          ↑
        </div>

        JUMP
      </button>


      {/* REALMLIFE CINEMATIC ROOM FADE */}
      {realmTravelFade && (
        <>
          <style>
            {`
              @keyframes realmLifeRoomFade {
                0% {
                  opacity: 0;
                }

                35% {
                  opacity: 1;
                }

                72% {
                  opacity: 1;
                }

                100% {
                  opacity: 0;
                }
              }
            `}
          </style>

          <div
            className="absolute inset-0 z-[500] pointer-events-none"
            style={{
              background:
                "#000",

              animation:
                "realmLifeRoomFade 760ms ease-in-out both",
            }}
          />
        </>
      )}

      <RealmLifeFounderAdmin
        {...realmEnvironment}
      />

      <RealmLifePropertyPanel
        {...realmProperty}
      />

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
              <span style={{ color: "#ffb36b" }}>
                🔥{(
                  realmFire
                    ?.build_costs?.[id]
                  ?? d.cost
                ).toLocaleString()}
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
        Click/tap: walk/interact · 👁 POV: first person · Drag in POV: look · WASD: walk · Shift: run · Space: jump · Q/E:
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
