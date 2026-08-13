/* NexusWorld — genuine Three.js third-person world client (Phase 1 greybox).
   mode "play": pointer-lock camera, movement, collision, portals, presence multiplayer.
   mode "build": orbit camera, click-select, drag-move on ground (founder editor viewport). */
import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { ArrowLeft, Map as MapIcon, Settings as GearIcon, Crosshair, ArrowUp, Hand, MessageSquare, Smile, Mic, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Gamepad2, DoorOpen } from "lucide-react";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import apiClient from "@/api/client";

const _draco = new DRACOLoader();
_draco.setDecoderPath("/draco/");
const makeGLTFLoader = () => {
  const l = new GLTFLoader();
  l.setDRACOLoader(_draco);
  return l;
};

const CAMS = () => { try { return JSON.parse(localStorage.getItem("nexus_cam") || "{}"); } catch { return {}; } };
const GLB_CACHE = {};
// bandwidth-aware loader: max 3 concurrent GLB downloads, lowest priority number first
const _glbQueue = [];
let _glbActive = 0;
const _pumpGLB = () => {
  while (_glbActive < 4 && _glbQueue.length) {
    _glbQueue.sort((a, b) => a.priority - b.priority);
    const job = _glbQueue.shift();
    _glbActive += 1;
    new Promise((res, rej) => makeGLTFLoader().load(job.url, res, undefined, rej))
      .then((g) => { _glbActive -= 1; _pumpGLB(); job.resolve(g); })
      .catch((err) => { _glbActive -= 1; _pumpGLB(); job.reject(err); });
  }
};
const loadGLB = (url, priority = 5, attempt = 0) => {
  if (!GLB_CACHE[url]) {
    GLB_CACHE[url] = new Promise((resolve, reject) => { _glbQueue.push({ url, priority, resolve, reject }); _pumpGLB(); })
      .catch((err) => {
        delete GLB_CACHE[url];
        if (attempt < 3) return new Promise((r) => setTimeout(r, 2500)).then(() => loadGLB(url, priority, attempt + 1));
        throw err;
      });
  }
  return GLB_CACHE[url];
};

function geometryBounds(obj) {
  const box = new THREE.Box3();
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (o.isSkinnedMesh) {
      o.computeBoundingBox();
      if (o.boundingBox && !o.boundingBox.isEmpty()) box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
      return;
    }
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (!o.geometry.boundingBox || o.geometry.boundingBox.isEmpty()) return;
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box;
}

function fitToHeight(obj, targetH) {
  obj.position.set(0, 0, 0);
  obj.scale.set(1, 1, 1);
  let box = geometryBounds(obj);
  const size = box.getSize(new THREE.Vector3());
  const rawScale = targetH / Math.max(0.01, size.y);
  const safeScale = Number.isFinite(rawScale)
    ? THREE.MathUtils.clamp(rawScale, 0.001, 20)
    : 1;
  obj.scale.setScalar(safeScale);
  obj.updateMatrixWorld(true);
  box = geometryBounds(obj);
  const center = box.getCenter(new THREE.Vector3());
  obj.position.set(-center.x, -box.min.y, -center.z);
  obj.updateMatrixWorld(true);
}

function signSprite(text, color = "#37c8ff", widthUnits = 20) {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 256;
  const g = c.getContext("2d");
  g.font = "900 110px 'Arial Black', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = color; g.shadowBlur = 46;
  g.fillStyle = color; g.fillText(String(text).slice(0, 26).toUpperCase(), 512, 128);
  g.shadowBlur = 14; g.fillStyle = "#eaf6ff"; g.fillText(String(text).slice(0, 26).toUpperCase(), 512, 128);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(widthUnits, widthUnits / 4, 1);
  return s;
}

function chatSprite(text) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 160;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(240,246,255,0.92)";
  g.beginPath(); g.roundRect(6, 6, 500, 130, 22); g.fill();
  g.fillStyle = "#101a30"; g.font = "bold 30px sans-serif"; g.textAlign = "center";
  const words = String(text).split(" "); const lines = [""];
  words.forEach((w) => {
    if ((lines[lines.length - 1] + " " + w).length > 30 && lines.length < 3) lines.push(w);
    else lines[lines.length - 1] = (lines[lines.length - 1] + " " + w).trim();
  });
  lines.forEach((ln, i) => g.fillText(ln.slice(0, 34), 256, 48 + i * 38));
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.userData.chatTexture = t;
  s.scale.set(3.4, 1.06, 1); s.position.y = 3.1; return s;
}

function nameSprite(text) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(10,14,26,0.72)"; g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#cfe6ff"; g.font = "bold 30px sans-serif"; g.textAlign = "center";
  g.fillText(String(text || "?").slice(0, 14), 128, 42);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set(2.2, 0.55, 1); s.position.y = 2.35; return s;
}

function makeAvatar(color, label, avatarUrl, motionUrls, mixers) {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.9, 6, 12),
    new THREE.MeshStandardMaterial({ color }));
  body.position.y = 1.0; body.castShadow = true; grp.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 8),
    new THREE.MeshStandardMaterial({ color: "#ffffff" }));
  nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.45, 0.42); grp.add(nose);
  if (label) grp.add(nameSprite(label));
  if (avatarUrl) {
    loadGLB(avatarUrl, 3.5).then((g) => {
      if (grp.userData.disposed) return;
      const inst = skeletonClone(g.scene);
      let skinned = 0;
      inst.traverse((o) => { if (o.isSkinnedMesh) skinned += 1; });
      const b = geometryBounds(inst);
      const bs = b.getSize(new THREE.Vector3());
      const deformed = !skinned || !Number.isFinite(bs.y) || bs.y <= 0.01
        || (bs.y / Math.max(0.01, Math.max(bs.x, bs.z))) < 0.55;
      if (deformed) {
        console.error("[nexus] avatar GLB rejected (no skin or deformed bounds) — keeping safe fallback:", avatarUrl);
        return;
      }
      inst.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; } });
      const holder = new THREE.Group();
      holder.add(inst);
      fitToHeight(holder, 1.8);
      grp.remove(body); grp.remove(nose);
      grp.add(holder);
      const mixer = new THREE.AnimationMixer(inst);
      const actions = {};

      const addAction = (name, clip) => {
        if (!clip || actions[name]) return;
        const action = mixer.clipAction(clip);
        action.enabled = true;
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.setEffectiveWeight(0);
        action.play();
        actions[name] = action;
      };

      addAction("idle", g.animations?.[0]);

      const mix = {
        mixer,
        actions,
        current: "idle",
        currentAction: actions.idle || null,
      };

      if (actions.idle) {
        actions.idle.setEffectiveWeight(1);
        actions.idle.setEffectiveTimeScale(1);
      }

      grp.userData.mix = mix;
      mixers.push(mix);

      const pack = motionUrls || {};

      Promise.all([
        pack.walk
          ? loadGLB(pack.walk, 4).catch(() => null)
          : Promise.resolve(null),
        pack.run
          ? loadGLB(pack.run, 4).catch(() => null)
          : Promise.resolve(null),
      ]).then(([walkFile, runFile]) => {
        if (grp.userData.disposed) return;
        addAction("walk", walkFile?.animations?.[0]);
        addAction("run", runFile?.animations?.[0]);
      });
    }).catch((err) => { console.error("[nexus] avatar GLB load failed:", avatarUrl, err?.message || err); });
  }
  return grp;
}

function setAvatarAnim(grp, state) {
  const mix = grp.userData.mix;
  if (!mix?.actions) return;

  const wanted =
    state === "run" ? "run" :
    state === "walk" ? "walk" :
    "idle";

  const next =
    mix.actions[wanted] ||
    (wanted === "run" ? mix.actions.walk : null) ||
    mix.actions.idle;

  if (!next || mix.currentAction === next) return;

  if (mix.currentAction) {
    mix.currentAction.fadeOut(0.18);
  }

  next.enabled = true;
  next.reset();
  next.setEffectiveWeight(1);
  next.setEffectiveTimeScale(
    wanted === "walk" ? 1.25 :
    wanted === "run" ? 1.15 :
    1
  );
  next.fadeIn(0.18);
  next.play();

  mix.current = wanted;
  mix.currentAction = next;
}

export default function NexusWorld({ mode = "play", world, zoneId = "nexus_central", username = "you",
  avatarUrl = null, avatarMotion = null, onSelect, selectedId, onEntityMove, onPortal, onPublishedVersion, travelRef, onExit, refreshKey = 0, instanceId = "public-1" }) {
  const mountRef = useRef(null);
  const [hud, setHud] = useState({ online: 1, zone: "", prompt: "", locked: false, portal: "" });
  const [showSet, setShowSet] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const voiceEnabled = typeof window !== "undefined" && localStorage.getItem("nexus_voice") === "on";
  const [showMap, setShowMap] = useState(false);
  const [mapTick, setMapTick] = useState(0);
  const nearPortalRef = useRef(null);
  useEffect(() => {
    if (!showMap) return undefined;
    const t = setInterval(() => setMapTick((v) => v + 1), 500);
    return () => clearInterval(t);
  }, [showMap]);
  const [chatText, setChatText] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatError, setChatError] = useState("");
  const chatApiRef = useRef(null);
  const [cam, setCam] = useState({ sens: CAMS().sens ?? 1, invH: !!CAMS().invH, invV: !!CAMS().invV });
  const camRef = useRef(cam);
  camRef.current = cam;
  const saveCam = (c) => { setCam(c); localStorage.setItem("nexus_cam", JSON.stringify(c)); };
  const selRef = useRef(selectedId);
  selRef.current = selectedId;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !world) return undefined;
    const zone = world.zones.find((z) => z.id === zoneId) || world.zones[0];
    let disposed = false;
    const lowGfx = localStorage.getItem("nexus_gfx") === "low";
    const renderer = new THREE.WebGLRenderer({ antialias: !lowGfx });
    renderer.setPixelRatio(lowGfx ? 0.7 : Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = !lowGfx;
    mount.appendChild(renderer.domElement);
    const usePost = !(window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0)
      && localStorage.getItem("nexus_bloom") !== "off";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(zone.sky || "#101a30");
    const _zd = (zone.size || [80, 80])[1];
    scene.fog = new THREE.Fog(zone.sky || "#101a30", Math.max(60, _zd * 0.5), Math.max(160, _zd * 1.4));
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 480);
    scene.add(new THREE.AmbientLight(0x9fb2d8, zone.ambient ?? 0.55));
    scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x2a2416, 0.82));
    // gradient sky dome + starfield (depth instead of flat clear color)
    const worldR = Math.max((zone.size || [80, 80])[0], (zone.size || [80, 80])[1]) * 1.35;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(worldR, 24, 14), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color("#02040c") }, bottom: { value: new THREE.Color(zone.sky || "#101a30") } },
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 1.7 + 0.24, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }",
    }));
    sky.renderOrder = -10; scene.add(sky);
    const starN = 700; const starPos = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const th = Math.random() * Math.PI * 2; const ph = Math.acos(1 - Math.random() * 0.72);
      const r = worldR * 0.96;
      starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      starPos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) + 8;
      starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xaac6ff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false }));
    scene.add(stars);
    const sun = new THREE.DirectionalLight(0xffeecc, zone.sun ?? 1.1);
    sun.position.set(24, 40, 18); sun.castShadow = true;
    sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
    scene.add(sun);
    const [ZW, ZD] = zone.size || [80, 80];
    const ground = new THREE.Mesh(new THREE.BoxGeometry(ZW, 1, ZD),
      new THREE.MeshStandardMaterial({ color: zone.ground_color || "#2c3450", roughness: 0.22, metalness: 0.55 }));
    ground.position.y = -0.5; ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.GridHelper(Math.max(ZW, ZD), Math.max(ZW, ZD) / 2, 0x3a4a6a, 0x28324e);
    grid.position.y = 0.01; scene.add(grid);

    const colliders = []; const portals = []; const npcs = []; const pickables = [];
    const entMeshes = {};
    const mixers = [];
    const ambient = [];
    const modelStats = { total: 0, loaded: 0, failed: 0 };
    const _m4 = new THREE.Matrix4();
    const defaultAvatarUrl = avatarUrl || world?.meta?.starter_avatar_url || null;
    const defaultAvatarMotion = avatarMotion || {};
    zone.entities.forEach((e) => {
      let m = null;
      const [sx, sy, sz] = e.scale;
      if (e.type === "box" || e.type === "pillar" || e.type === "ramp") {
        m = new THREE.Mesh(e.type === "pillar" ? new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 14)
          : new THREE.BoxGeometry(sx, sy, sz),
          new THREE.MeshStandardMaterial({ color: e.color || "#4a4f66", roughness: 0.85 }));
        m.position.set(e.pos[0], e.pos[1] + sy / 2, e.pos[2]);
        m.rotation.y = e.rot[1] || 0; m.castShadow = true; m.receiveShadow = true;
        if (e.pos[1] < 2 && sy > 0.35) colliders.push({ x: e.pos[0], z: e.pos[2], hw: Math.max(sx, sz) / 2, hd: Math.max(sx, sz) / 2, top: e.pos[1] + sy });
      } else if (e.type === "light") {
        const l = new THREE.PointLight(e.color || "#ffd9a0", e.props?.intensity ?? 18, 18, 1.9);
        l.position.set(e.pos[0], 3.2, e.pos[2]); scene.add(l);
        m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10),
          new THREE.MeshStandardMaterial({ color: e.color, emissive: e.color, emissiveIntensity: 1.4 }));
        m.position.set(e.pos[0], 3.2, e.pos[2]);
      } else if (e.type === "portal") {
        m = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.18, 12, 36),
          new THREE.MeshStandardMaterial({ color: e.color, emissive: e.color, emissiveIntensity: 0.9 }));
        m.position.set(e.pos[0], 2.0, e.pos[2]); m.rotation.y = e.rot[1] || 0;
        portals.push({ e, mesh: m });
        const pl = new THREE.PointLight(e.color, 12, 10, 1.8);
        pl.position.set(e.pos[0], 2.2, e.pos[2]); scene.add(pl);
      } else if (e.type === "npc") {
        m = makeAvatar(e.color || "#e8c07a", e.props?.label || "NPC", null, defaultAvatarMotion, mixers);
        m.position.set(e.pos[0], 0, e.pos[2]); m.rotation.y = e.rot[1] || 0;
        npcs.push({ e, mesh: m });
        colliders.push({ x: e.pos[0], z: e.pos[2], hw: 0.6, hd: 0.6, top: 1.9 });
      } else if (e.type === "model" && e.props?.url) {
        m = new THREE.Group();
        // solid dark silhouette while the GLB streams in (no wireframe flash)
        const ph = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.92, sy, sz * 0.92),
          new THREE.MeshStandardMaterial({ color: "#0b1428", emissive: "#14264e", emissiveIntensity: 0.4, transparent: true, opacity: 0.35, depthWrite: false }));
        ph.position.y = sy / 2; m.add(ph);
        modelStats.total += 1;
        const spawnRef = zone.spawn || { x: 0, z: 0 };
        const distSpawn = Math.hypot(e.pos[0] - spawnRef.x, e.pos[2] - spawnRef.z);
        const pr = 1 + distSpawn / 50;
        let currentHolder = null;
        const attach = (g) => {
          if (disposed) return;
          const inst = g.scene.clone(true);
          const holder = new THREE.Group();
          holder.add(inst);
          fitToHeight(holder, sy);
          holder.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          const grow = new THREE.Group(); grow.add(holder);
          if (currentHolder) { m.remove(currentHolder); currentHolder = grow; m.add(grow); return; }
          grow.scale.y = 0.05;
          m.add(grow); m.remove(ph);
          currentHolder = grow;
          ambient.push({ kind: "grow", grp: grow, t: 0 });
        };
        // NAVS: distant entities stream a lightweight LOD first; hero quality upgrades later
        if (e.props.lod2 && distSpawn > 60) {
          loadGLB(e.props.lod2, pr - 0.8).then((g) => { modelStats.loaded += 1; attach(g); })
            .catch((err) => { modelStats.failed += 1; console.error("[nexus] lod2 failed:", e.props.lod2, err?.message || err); ph.material.opacity = 0.7; });
          loadGLB(e.props.url, 9 + pr).then(attach).catch(() => {});
        } else {
          loadGLB(e.props.url, pr).then((g) => { modelStats.loaded += 1; attach(g); })
            .catch((err) => { modelStats.failed += 1; console.error("[nexus] model GLB failed:", e.props.url, err?.message || err); ph.material.opacity = 0.7; });
        }
        m.position.set(e.pos[0], e.pos[1], e.pos[2]);
        m.rotation.set((e.rot && e.rot[0]) || 0, (e.rot && e.rot[1]) || 0, (e.rot && e.rot[2]) || 0);
        if (e.props?.flight) {
          ambient.push({ kind: "flight", grp: m, cx: e.pos[0], cy: e.pos[1], cz: e.pos[2],
            r: parseFloat(e.props.fradius) || 10, sp: parseFloat(e.props.fspeed) || 0.05, ph: Math.random() * 6.28 });
        }
        if (e.pos[1] < 2 && !e.props?.no_collide) colliders.push({ x: e.pos[0], z: e.pos[2], hw: sx / 2, hd: sz / 2, top: e.pos[1] + sy });
      } else if (e.type === "tree") {
        const th = Math.max(3, sy);
        const grp3 = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(th * 0.028, th * 0.04, th * 0.52, 8),
          new THREE.MeshStandardMaterial({ color: "#141d33", roughness: 0.8, metalness: 0.3 }));
        trunk.position.y = th * 0.26; grp3.add(trunk);
        const fol = new THREE.MeshStandardMaterial({ color: e.color || "#2ee87a", emissive: e.color || "#2ee87a", emissiveIntensity: 0.5, roughness: 0.45, transparent: true, opacity: 0.9 });
        const c1 = new THREE.Mesh(new THREE.IcosahedronGeometry(th * 0.3, 1), fol);
        c1.position.y = th * 0.6; grp3.add(c1);
        const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(th * 0.19, 1), fol.clone());
        c2.material.emissiveIntensity = 0.75; c2.position.y = th * 0.86; grp3.add(c2);
        grp3.rotation.y = (e.rot && e.rot[1]) || (e.pos[0] * 0.7);
        m = grp3; m.position.set(e.pos[0], e.pos[1], e.pos[2]);
        colliders.push({ x: e.pos[0], z: e.pos[2], hw: 0.5, hd: 0.5, top: th });
      } else if (e.type === "sign") {
        m = signSprite(e.props?.text || e.props?.label || "NEXUS", e.color || "#37c8ff", Math.max(6, sx));
        m.position.set(e.pos[0], e.pos[1] + sy / 2, e.pos[2]);
      } else if (e.type === "ring") {
        const rr = Math.max(6, Number(e.props?.radius) || 36);
        m = new THREE.Mesh(new THREE.TorusGeometry(rr, Math.max(0.22, sy / 4), 12, 80),
          new THREE.MeshStandardMaterial({ color: e.color || "#37c8ff", emissive: e.color || "#37c8ff", emissiveIntensity: 1.1, metalness: 0.4, roughness: 0.3 }));
        m.rotation.x = Math.PI / 2;
        m.position.set(e.pos[0], e.pos[1], e.pos[2]);
        ambient.push({ kind: "ring", mesh: m });
      } else if (e.type === "crowd") {
        const n = Math.min(80, Math.max(4, Math.round(Number(e.props?.count) || 30)));
        const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.3, 0.85, 4, 8),
          new THREE.MeshStandardMaterial({ color: "#2b3558", roughness: 0.6, metalness: 0.25, emissive: "#131b38", emissiveIntensity: 0.7 }), n);
        const trim = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 8),
          new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 1.2 }), n);
        const cols = ["#37c8ff", "#2ee87a", "#c26bff", "#ff9a5c", "#5cffe2"];
        const span = Number(e.props?.radius) || sz || 120;
        const walkers = [];
        for (let i = 0; i < n; i++) {
          const lane = (i % 6) - 2.5;
          walkers.push({ x: e.pos[0] + lane * 7 + (Math.random() - 0.5) * 4, z: e.pos[2] + (Math.random() - 0.5) * span, s: 0.5 + Math.random() * 0.9, dir: Math.random() > 0.5 ? 1 : -1 });
          trim.setColorAt(i, new THREE.Color(cols[i % cols.length]));
        }
        const grp2 = new THREE.Group(); grp2.add(body); grp2.add(trim); m = grp2;
        ambient.push({ kind: "crowd", body, trim, walkers, halfZ: span / 2, cz: e.pos[2] });
        // rigged animated citizens (desktop): replace up to 18 capsules with skinned walkers
        const rigDefs = Array.isArray(e.props?.rigs) ? e.props.rigs.filter((r) => r && r.url) : [];
        const coarse = window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
        if (rigDefs.length && !coarse) {
          Promise.all(rigDefs.map((r) =>
            Promise.all([loadGLB(r.url, 6), r.walk ? loadGLB(r.walk, 6).catch(() => null) : Promise.resolve(null)]).catch(() => null)
          )).then((loaded) => {
            if (disposed) return;
            const ok = loaded.filter(Boolean);
            if (!ok.length) return;
            const riggedN = Math.min(walkers.length, 18);
            for (let i = 0; i < riggedN; i++) {
              const [baseG, walkG] = ok[i % ok.length];
              const inst = skeletonClone(baseG.scene);
              let skinned = 0;
              inst.traverse((o) => {
                if (o.isSkinnedMesh) skinned += 1;
                if (o.isMesh || o.isSkinnedMesh) {
                  o.frustumCulled = false; o.castShadow = false;
                  if (o.material) { o.material = o.material.clone(); o.material.color.offsetHSL((Math.random() - 0.5) * 0.16, 0, (Math.random() - 0.5) * 0.12); }
                }
              });
              if (!skinned) continue;
              const holder = new THREE.Group(); holder.add(inst);
              fitToHeight(holder, 1.62 + Math.random() * 0.22);
              const clip = walkG?.animations?.[0] || baseG.animations?.[0];
              if (!clip) continue;
              const mixer = new THREE.AnimationMixer(inst);
              const act = mixer.clipAction(clip);
              act.play(); act.time = Math.random() * clip.duration;
              act.setEffectiveTimeScale(0.9 + Math.random() * 0.35);
              mixers.push({ mixer });
              const wrap = new THREE.Group(); wrap.add(holder);
              scene.add(wrap);
              walkers[i].rig = wrap;
            }
          });
        }
      } else if (e.type === "traffic") {
        const n = Math.min(24, Math.max(2, Math.round(Number(e.props?.count) || 10)));
        const ships = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.5, 1.1),
          new THREE.MeshStandardMaterial({ color: "#0e1830", emissive: e.color || "#37c8ff", emissiveIntensity: 0.9 }), n);
        const lanes = [];
        for (let i = 0; i < n; i++) lanes.push({ y: 34 + (i % 4) * 8, z: -90 + (i % 5) * 36, x: (Math.random() - 0.5) * 190, s: 4 + Math.random() * 6, dir: i % 2 ? 1 : -1 });
        m = ships;
        ambient.push({ kind: "traffic", ships, lanes });
      }
      if (m) { scene.add(m); m.userData.entityId = e.id; entMeshes[e.id] = m; pickables.push(m); }
    });

    const player = makeAvatar("#37c8ff", mode === "play" ? username : null, mode === "play" ? defaultAvatarUrl : null, defaultAvatarMotion, mixers);
    scene.add(player);
    const spawn = zone.spawn || { x: 0, z: 0 };
    player.position.set(spawn.x, 0, spawn.z);
    player.visible = mode === "play";
    let vy = 0; let grounded = true; let sprint = false;
    let yaw = 0; let pitch = 0.16; let dist = 9;
    const keys = {}; const touch = { x: 0, y: 0 }; let jumpReq = false; let interactReq = false;
    const remotes = {};

    const onKey = (d) => (ev) => {
      if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA")) return;
      keys[ev.key.toLowerCase()] = d;
      if (d && ev.key === " ") { jumpReq = true; ev.preventDefault(); }
      if (d && ev.key.toLowerCase() === "e") interactReq = true;
    };
    const kd = onKey(true); const ku = onKey(false);
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);

    // pointer-lock camera (play) / orbit-drag (build)
    const onMouseMove = (ev) => {
      if (mode === "play" && document.pointerLockElement === renderer.domElement) {
        const c = camRef.current; const s = 0.0022 * c.sens;
        yaw -= ev.movementX * s * (c.invH ? -1 : 1);
        pitch = Math.min(1.25, Math.max(-0.25, pitch + ev.movementY * s * (c.invV ? -1 : 1)));
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    const onLockChange = () => setHud((h) => ({ ...h, locked: document.pointerLockElement === renderer.domElement }));
    document.addEventListener("pointerlockchange", onLockChange);
    const ray = new THREE.Raycaster();
    let dragSel = false;
    const onDown = (ev) => {
      if (mode === "play") { renderer.domElement.requestPointerLock?.(); return; }
      const r = renderer.domElement.getBoundingClientRect();
      const p = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(p, camera);
      const hit = ray.intersectObjects(pickables, true)[0];
      let obj = hit?.object;
      while (obj && !obj.userData.entityId) obj = obj.parent;
      if (obj?.userData.entityId) {
        onSelect?.(obj.userData.entityId);
        dragSel = true;
      } else { onSelect?.(null); }
    };
    let orbiting = false; let lastX = 0; let lastY = 0;
    const onBuildMove = (ev) => {
      if (mode !== "build") return;
      if (dragSel && selRef.current && entMeshes[selRef.current]) {
        const r = renderer.domElement.getBoundingClientRect();
        const p = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(p, camera);
        const t = new THREE.Vector3();
        ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), t);
        if (t) { entMeshes[selRef.current].position.x = t.x; entMeshes[selRef.current].position.z = t.z; }
      } else if (orbiting) {
        yaw -= (ev.clientX - lastX) * 0.005; pitch = Math.min(1.3, Math.max(0.05, pitch + (ev.clientY - lastY) * 0.005));
        lastX = ev.clientX; lastY = ev.clientY;
      }
    };
    const onUp = () => {
      if (mode === "build" && dragSel && selRef.current && entMeshes[selRef.current]) {
        const m = entMeshes[selRef.current];
        onEntityMove?.(selRef.current, [Math.round(m.position.x * 10) / 10, 0, Math.round(m.position.z * 10) / 10]);
      }
      dragSel = false; orbiting = false;
    };
    const onCtx = (ev) => { if (mode === "build") { ev.preventDefault(); orbiting = true; lastX = ev.clientX; lastY = ev.clientY; } };
    renderer.domElement.addEventListener("mousedown", onDown);
    renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
    renderer.domElement.addEventListener("mousedown", (e) => { if (e.button === 2) onCtx(e); });
    window.addEventListener("mousemove", onBuildMove);
    window.addEventListener("mouseup", onUp);
    const onWheel = (ev) => { dist = Math.min(16, Math.max(2.5, dist + ev.deltaY * 0.01)); };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: true });

    // mobile: left joystick / right camera drag / pinch zoom
    const joy = { id: null, cx: 0, cy: 0 };
    const camT = { id: null, lx: 0, ly: 0 };
    let pinch = 0;
    const onTS = (ev) => {
      for (const t of ev.changedTouches) {
        if (t.clientX < window.innerWidth / 2 && joy.id === null) { joy.id = t.identifier; joy.cx = t.clientX; joy.cy = t.clientY; }
        else if (camT.id === null) { camT.id = t.identifier; camT.lx = t.clientX; camT.ly = t.clientY; }
      }
      if (ev.touches.length === 2) pinch = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY);
    };
    const onTM = (ev) => {
      for (const t of ev.changedTouches) {
        if (t.identifier === joy.id) { touch.x = Math.max(-1, Math.min(1, (t.clientX - joy.cx) / 46)); touch.y = Math.max(-1, Math.min(1, (t.clientY - joy.cy) / 46)); }
        else if (t.identifier === camT.id) {
          const c = camRef.current; yaw -= (t.clientX - camT.lx) * 0.006 * c.sens * (c.invH ? -1 : 1);
          pitch = Math.min(1.25, Math.max(-0.25, pitch + (t.clientY - camT.ly) * 0.006 * c.sens * (c.invV ? -1 : 1)));
          camT.lx = t.clientX; camT.ly = t.clientY;
        }
      }
      if (ev.touches.length === 2) {
        const d = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY);
        dist = Math.min(16, Math.max(2.5, dist - (d - pinch) * 0.03)); pinch = d;
      }
    };
    const onTE = (ev) => {
      for (const t of ev.changedTouches) {
        if (t.identifier === joy.id) {
          joy.id = null; touch.x = 0; touch.y = 0;
          const th = document.getElementById("nexus-joy-thumb");
          if (th) th.style.transform = "translate(0px, 0px)";
        }
        if (t.identifier === camT.id) camT.id = null;
      }
    };
    renderer.domElement.addEventListener("touchstart", onTS, { passive: true });
    renderer.domElement.addEventListener("touchmove", onTM, { passive: true });
    renderer.domElement.addEventListener("touchend", onTE, { passive: true });
    window.__NEXUS_MOB = { jump: () => { jumpReq = true; }, interact: () => { interactReq = true; }, sprint: (v) => { sprint = v; }, recenter: () => { yaw = player.rotation.y; pitch = 0.16; dist = 9; } };

    // presence loop (real multiplayer, server-validated)
    let presTimer = null; let saveTimer = null;
    const bubbles = {}; // user_id -> {id, sprite, holder, at}
    const dropBubble = (uid) => {
      const b = bubbles[uid];
      if (!b) return;
      b.holder.remove(b.sprite);
      b.sprite.userData.chatTexture?.dispose();
      b.sprite.material?.dispose();
      delete bubbles[uid];
    };
    const showBubble = (holder, uid, text, id) => {
      if (bubbles[uid]?.id === id) return;
      dropBubble(uid);
      const s = chatSprite(text);
      holder.add(s);
      bubbles[uid] = { id, sprite: s, holder, at: Date.now() };
    };
    const anim = () => (!grounded ? "jump" : (Math.hypot(touch.x, touch.y) > 0.1 || keys.w || keys.a || keys.s || keys.d || keys.arrowup || keys.arrowdown || keys.arrowleft || keys.arrowright) ? (sprint || keys.shift || Math.hypot(touch.x, touch.y) > 0.78 ? "run" : "walk") : "idle");
    let lastPv = 0;
    if (mode === "play") {
      chatApiRef.current = async (text) => {
        const r = await apiClient.post("/nexus/chat", { text });
        showBubble(player, "self", r.data.message.text, r.data.message.id);
      };
      apiClient.get("/nexus/position").then((r) => {
        const p = r.data?.position;
        if (p && p.zone_id === zone.id) {
          const cx = Math.max(-(ZW / 2 - 1), Math.min(ZW / 2 - 1, p.x));
          const cz = Math.max(-(ZD / 2 - 1), Math.min(ZD / 2 - 1, p.z));
          player.position.set(cx, Math.max(0, Math.min(20, p.y)), cz);
          yaw = p.ry || 0;
        }
      }).catch(() => {});
      presTimer = setInterval(() => {
        if (document.hidden) return;
        apiClient.post("/nexus/presence", {
          zone_id: zone.id, instance_id: instanceId, x: player.position.x, y: player.position.y, z: player.position.z,
          ry: player.rotation.y, anim: anim(),
        }).then((r) => {
          setHud((h) => ({ ...h, online: r.data.online }));
          if (r.data.pv && r.data.pv !== lastPv) { lastPv = r.data.pv; onPublishedVersion?.(r.data.pv); }
          const seen = new Set();
          (r.data.players || []).forEach((pl) => {
            seen.add(pl.user_id);
            if (!remotes[pl.user_id]) {
              remotes[pl.user_id] = { grp: makeAvatar("#ff9a5c", pl.username, pl.avatar_url || defaultAvatarUrl, pl.avatar_motion || defaultAvatarMotion, mixers), tgt: new THREE.Vector3(pl.x, pl.y, pl.z), ry: pl.ry, anim: pl.anim };
              scene.add(remotes[pl.user_id].grp);
              remotes[pl.user_id].grp.position.set(pl.x, pl.y, pl.z);
            }
            remotes[pl.user_id].tgt.set(pl.x, pl.y, pl.z);
            remotes[pl.user_id].ry = pl.ry;
            remotes[pl.user_id].anim = pl.anim;
          });
          Object.keys(remotes).forEach((id) => {
            if (!seen.has(id)) {
              dropBubble(id);
              remotes[id].grp.userData.disposed = true;
              scene.remove(remotes[id].grp);
              delete remotes[id];
            }
          });
          (r.data.chats || []).forEach((c) => {
            const holder = c.username === username ? player : remotes[c.user_id]?.grp;
            const uid = c.username === username ? "self" : c.user_id;
            if (holder) showBubble(holder, uid, c.text, c.id);
          });
        }).catch(() => {});
      }, 300);
      saveTimer = setInterval(() => {
        apiClient.post("/nexus/position/save", { zone_id: zone.id, x: player.position.x, y: player.position.y, z: player.position.z, ry: player.rotation.y }).catch(() => {});
      }, 5000);
    }

    setHud((h) => ({ ...h, zone: zone.name }));
    let composer = null;
    if (usePost) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.32, 0.4, 0.85));
      composer.addPass(new OutputPass());
    }
    let fpsFrames = 0; let fpsAcc = 0; let fpsVal = 0; let lowFpsSecs = 0;
    // NAVS adaptive tiers: benchmark first seconds of real frame time, then hysteresis-guarded switches
    let qualityTier = lowGfx ? "low" : "high";
    let tierAge = 0; let tierCooldown = 0; let benchDone = lowGfx;
    const applyTier = (t) => {
      qualityTier = t;
      tierCooldown = 8;
      if (t === "low") { renderer.setPixelRatio(0.7); renderer.shadowMap.enabled = false; composer = null; }
      else if (t === "medium") { renderer.setPixelRatio(1); renderer.shadowMap.enabled = false; composer = null; }
      else if (t === "high") { renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); }
      else { renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); }
      scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
      console.warn("[nexus] NAVS quality tier:", t);
    };
    const clock = new THREE.Clock();
    let raf = 0;
    const step = () => {
      if (disposed) return;
      raf = requestAnimationFrame(step);
      const dt = Math.min(clock.getDelta(), 0.05);
      mixers.forEach((m) => m.mixer.update(dt));
      Object.keys(bubbles).forEach((uid) => {
        if (Date.now() - bubbles[uid].at > 7000) dropBubble(uid);
      });
      if (mode === "play") {
        let ix = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0) + touch.x;
        let iz = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0) + touch.y;
        const mag = Math.hypot(ix, iz);
        const joyMag = Math.hypot(touch.x, touch.y);
        const spd = (sprint || keys.shift || joyMag > 0.78 ? 9.5 : 5.5);
        if (mag > 0.06) {
          ix /= Math.max(1, mag); iz /= Math.max(1, mag);
          const dx = (ix * Math.cos(yaw) + iz * Math.sin(yaw)) * spd * dt;
          const dz = (-ix * Math.sin(yaw) + iz * Math.cos(yaw)) * spd * dt;
          const half = { x: ZW / 2 - 0.6, z: ZD / 2 - 0.6 };
          const tryMove = (nx, nz) => {
            for (const c of colliders) {
              if (player.position.y >= c.top - 0.05) continue;
              if (Math.abs(nx - c.x) < c.hw + 0.4 && Math.abs(nz - c.z) < c.hd + 0.4) return false;
            }
            return Math.abs(nx) < half.x && Math.abs(nz) < half.z;
          };
          const nx = player.position.x + dx; const nz = player.position.z + dz;
          if (tryMove(nx, player.position.z)) player.position.x = nx;
          if (tryMove(player.position.x, nz)) player.position.z = nz;
          player.rotation.y = Math.atan2(dx, dz);
        }
        if (jumpReq && grounded) { vy = 7.4; grounded = false; }
        jumpReq = false;
        vy -= 20 * dt;
        player.position.y += vy * dt;
        let floor = 0;
        for (const c of colliders) {
          if (Math.abs(player.position.x - c.x) < c.hw + 0.3 && Math.abs(player.position.z - c.z) < c.hd + 0.3 && player.position.y >= c.top - 0.5 && c.top > floor) floor = c.top;
        }
        if (player.position.y <= floor) { player.position.y = floor; vy = 0; grounded = true; }
        setAvatarAnim(player, anim());
        // interactions
        let prompt = "";
        let nearP = null;
        for (const p of portals) {
          p.mesh.rotation.z += dt * (p.e.props?.spin ?? 0.8);
          const d = Math.hypot(p.e.pos[0] - player.position.x, p.e.pos[2] - player.position.z);
          if (d < 3) { prompt = `E — ${p.e.props?.label || "Portal"}`; nearP = p.e; }
          if (d < 3 && interactReq) onPortal?.(p.e);
        }
        nearPortalRef.current = nearP;
        const portalLabel = nearP ? (nearP.props?.label || "Portal") : "";
        for (const n of npcs) {
          const d = Math.hypot(n.e.pos[0] - player.position.x, n.e.pos[2] - player.position.z);
          if (d < 2.6) prompt = `E — talk to ${n.e.props?.label || "NPC"}`;
          if (d < 2.6 && interactReq) onPortal?.(n.e);
        }
        interactReq = false;
        setHud((h) => (h.prompt === prompt && h.portal === portalLabel ? h : { ...h, prompt, portal: portalLabel }));
        Object.values(remotes).forEach((r2) => {
          r2.grp.position.lerp(r2.tgt, 0.16);
          r2.grp.rotation.y += (r2.ry - r2.grp.rotation.y) * 0.2;
          setAvatarAnim(r2.grp, r2.anim);
        });
      } else {
        for (const p of portals) p.mesh.rotation.z += dt * (p.e.props?.spin ?? 0.8);
      }
      if (selRef.current && entMeshes[selRef.current]) {
        entMeshes[selRef.current].traverse?.(() => {});
      }
      const focus = mode === "play" ? player.position : new THREE.Vector3(0, 0, 0);
      let camD = dist;
      for (let ci = 0; ci < 5; ci++) {
        const cx = focus.x + Math.sin(yaw) * Math.cos(pitch) * camD;
        const cy = Math.max(0.35, focus.y + 1.6 + Math.sin(pitch) * camD);
        const cz = focus.z + Math.cos(yaw) * Math.cos(pitch) * camD;
        let blocked = false;
        for (const c of colliders) {
          if (Math.abs(cx - c.x) < c.hw + 0.35 && Math.abs(cz - c.z) < c.hd + 0.35 && cy < c.top + 0.25) { blocked = true; break; }
        }
        if (!blocked || camD <= 2.2) { camera.position.set(cx, cy, cz); break; }
        camD *= 0.72;
        if (ci === 4) camera.position.set(cx, cy, cz);
      }
      camera.lookAt(focus.x, focus.y + 1.4, focus.z);
      const tNow = clock.elapsedTime;
      for (const a of ambient) {
        if (a.kind === "ring") a.mesh.rotation.z += dt * 0.04;
        else if (a.kind === "flight") {
          a.ph += dt * a.sp;
          a.grp.position.set(a.cx + Math.cos(a.ph) * a.r, a.cy + Math.sin(tNow * 0.4 + a.ph) * 0.9, a.cz + Math.sin(a.ph) * a.r);
          a.grp.rotation.y = -a.ph;
        }
        else if (a.kind === "grow") {
          if (a.t < 0.6) {
            a.t += dt;
            const s = Math.min(1, a.t / 0.6);
            a.grp.scale.y = 0.05 + 0.95 * (1 - (1 - s) * (1 - s));
          }
        } else if (a.kind === "crowd") {
          for (let i = 0; i < a.walkers.length; i++) {
            const w = a.walkers[i];
            w.z += w.dir * w.s * dt;
            if (w.z > a.cz + a.halfZ) w.z = a.cz - a.halfZ;
            if (w.z < a.cz - a.halfZ) w.z = a.cz + a.halfZ;
            if (w.rig) {
              w.rig.position.set(w.x, 0, w.z);
              w.rig.rotation.y = w.dir > 0 ? 0 : Math.PI;
              _m4.makeScale(0.0001, 0.0001, 0.0001);
              a.body.setMatrixAt(i, _m4);
              a.trim.setMatrixAt(i, _m4);
              continue;
            }
            const bob = Math.sin(tNow * 6 + i) * 0.05;
            _m4.makeTranslation(w.x, 0.95 + bob, w.z);
            a.body.setMatrixAt(i, _m4);
            _m4.makeTranslation(w.x, 1.75 + bob, w.z);
            a.trim.setMatrixAt(i, _m4);
          }
          a.body.instanceMatrix.needsUpdate = true;
          a.trim.instanceMatrix.needsUpdate = true;
        } else if (a.kind === "traffic") {
          for (let i = 0; i < a.lanes.length; i++) {
            const l = a.lanes[i];
            l.x += l.dir * l.s * dt;
            if (l.x > 110) l.x = -110;
            if (l.x < -110) l.x = 110;
            _m4.makeTranslation(l.x, l.y, l.z);
            a.ships.setMatrixAt(i, _m4);
          }
          a.ships.instanceMatrix.needsUpdate = true;
        }
      }
      if (composer) composer.render(); else renderer.render(scene, camera);
      fpsFrames += 1; fpsAcc += dt;
      if (fpsAcc >= 1) {
        fpsVal = Math.round(fpsFrames / fpsAcc); fpsFrames = 0; fpsAcc = 0;
        tierAge += 1;
        if (tierCooldown > 0) tierCooldown -= 1;
        if (!benchDone && tierAge >= 4) {
          benchDone = true;
          if (fpsVal < 20) applyTier("low");
          else if (fpsVal < 32) applyTier("medium");
          else if (fpsVal < 50) applyTier("high");
          else applyTier("ultra");
        }
        if (composer) {
          lowFpsSecs = fpsVal < 20 ? lowFpsSecs + 1 : 0;
          if (lowFpsSecs >= 3) { composer = null; lowFpsSecs = 0; console.warn("[nexus] bloom auto-disabled (sustained low fps)"); }
        } else if (benchDone && tierCooldown === 0) {
          lowFpsSecs = fpsVal < 18 ? lowFpsSecs + 1 : 0;
          if (lowFpsSecs >= 3) {
            lowFpsSecs = 0; tierCooldown = 8;
            const pr = renderer.getPixelRatio();
            if (pr > 0.6) { renderer.setPixelRatio(Math.max(0.6, pr - 0.25)); console.warn("[nexus] pixel ratio reduced for performance:", renderer.getPixelRatio()); }
          }
        }
      }
      window.__NEXUS = { x: player.position.x, y: player.position.y, z: player.position.z, yaw, online: hud.online, mode, zone: zone.id, remotes: Object.keys(remotes).length, avatarReady: !!player.userData.mix, fps: fpsVal, bloom: !!composer, tier: qualityTier, models: { ...modelStats } };
    };
    step();
    const ro = new ResizeObserver(() => {
      camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      composer?.setSize(mount.clientWidth, mount.clientHeight);
    });
    ro.observe(mount);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (presTimer) clearInterval(presTimer);
      if (saveTimer) clearInterval(saveTimer);
      chatApiRef.current = null;
      player.userData.disposed = true;
      Object.values(remotes).forEach((r) => { r.grp.userData.disposed = true; });
      Object.keys(bubbles).forEach(dropBubble);
      mixers.forEach((m) => m.mixer.stopAllAction());
      if (mode === "play") {
        const tv = travelRef?.current;
        if (tv) {
          apiClient.post("/nexus/position/save", { zone_id: tv.zone_id, x: tv.x, y: 0, z: tv.z, ry: 0 }).catch(() => {});
          travelRef.current = null;
        } else {
          apiClient.post("/nexus/position/save", { zone_id: zone.id, x: player.position.x, y: player.position.y, z: player.position.z, ry: player.rotation.y }).catch(() => {});
          apiClient.post("/nexus/presence/leave").catch(() => {});
        }
      }
      window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      window.removeEventListener("mousemove", onBuildMove);
      window.removeEventListener("mouseup", onUp);
      ro.disconnect();
      composer?.dispose?.();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, zoneId, mode, refreshKey]);

  const [mob, setMob] = useState(() => typeof window !== "undefined"
    && (window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0));
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: coarse)");
    const upd = () => setMob(mq?.matches || navigator.maxTouchPoints > 0);
    mq?.addEventListener?.("change", upd);
    window.addEventListener("resize", upd);
    return () => { mq?.removeEventListener?.("change", upd); window.removeEventListener("resize", upd); };
  }, []);
  return (
    <div className="relative w-full h-full" data-testid="nexus-world">
      <div ref={mountRef} className="absolute inset-0" data-testid="nexus-canvas-mount" />
      {mode === "play" && (
        <>
          <div className="absolute left-0 right-0 top-0 flex items-center gap-2 px-3"
            style={{ paddingTop: "max(env(safe-area-inset-top), 10px)" }}>
            {onExit && (
              <button onClick={onExit} data-testid="nexus-hud-exit" aria-label="Exit Nexus"
                className="flex items-center gap-2 min-h-[44px] text-sm font-black text-white bg-black/45 backdrop-blur-md border border-white/25 rounded-full pl-3.5 pr-5 py-2.5 shrink-0 active:scale-95 active:bg-white/15 focus-visible:ring-2 focus-visible:ring-cyan-400 outline-none transition-transform">
                <ArrowLeft className="w-5 h-5" strokeWidth={2.6} /> EXIT
              </button>
            )}
            <div className="mx-auto flex items-center gap-2 min-h-[44px] text-xs font-bold text-white bg-black/45 backdrop-blur-md border border-white/25 rounded-full px-5 py-2.5 truncate" data-testid="nexus-hud">
              <span className="truncate tracking-wide">{(hud.zone || "").toUpperCase()}</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="text-emerald-300 whitespace-nowrap" data-testid="nexus-online">{hud.online} ONLINE</span>
            </div>
            <button data-testid="nexus-map-btn" onClick={() => setShowMap(!showMap)} aria-label="Toggle map" aria-pressed={showMap}
              className={`flex items-center justify-center w-11 h-11 rounded-2xl backdrop-blur-md border shrink-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400 outline-none transition-transform ${showMap ? "bg-cyan-500/80 border-cyan-300/60 text-black" : "bg-black/45 border-white/25 text-white"}`}>
              <MapIcon className="w-5 h-5" strokeWidth={2.2} />
            </button>
            <button data-testid="nexus-settings-btn" onClick={() => setShowSet(!showSet)} aria-label="Settings" aria-pressed={showSet}
              className={`flex items-center justify-center w-11 h-11 rounded-2xl backdrop-blur-md border shrink-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400 outline-none transition-transform ${showSet ? "bg-cyan-500/80 border-cyan-300/60 text-black" : "bg-black/45 border-white/25 text-white"}`}>
              <GearIcon className="w-5 h-5" strokeWidth={2.2} />
            </button>
          </div>
          {showMap && (() => {
            const zn = world?.zones?.find((zx) => zx.id === zoneId) || world?.zones?.[0];
            if (!zn) return null;
            const [mw, md] = zn.size || [80, 80];
            const px = window.__NEXUS?.x ?? 0; const pz = window.__NEXUS?.z ?? 0; const pyaw = window.__NEXUS?.yaw ?? 0;
            void mapTick;
            return (
              <div className="absolute left-1/2 -translate-x-1/2 z-30 bg-black/85 border border-cyan-400/30 rounded-2xl p-3"
                style={{ top: "max(calc(env(safe-area-inset-top) + 52px), 60px)" }} data-testid="nexus-map-overlay">
                <div className="text-[10px] font-bold tracking-[0.25em] text-cyan-300 mb-1.5 text-center">{zn.name?.toUpperCase()}</div>
                <svg width="228" height="228" viewBox={`${-mw / 2} ${-md / 2} ${mw} ${md}`} className="rounded-lg bg-[#0a1226]">
                  {zn.entities.filter((ee) => ["box", "model", "pillar"].includes(ee.type) && ee.scale[1] > 3).map((ee) => (
                    <rect key={ee.id} x={ee.pos[0] - ee.scale[0] / 2} y={ee.pos[2] - ee.scale[2] / 2}
                      width={Math.max(2, ee.scale[0])} height={Math.max(2, ee.scale[2])} fill="#22304e" />
                  ))}
                  {zn.entities.filter((ee) => ee.type === "tree").map((ee) => (
                    <circle key={ee.id} cx={ee.pos[0]} cy={ee.pos[2]} r="1.6" fill="#1d7a4d" />
                  ))}
                  {zn.entities.filter((ee) => ee.type === "portal").map((ee) => (
                    <circle key={ee.id} cx={ee.pos[0]} cy={ee.pos[2]} r="3" fill={ee.color || "#37c8ff"} opacity="0.9" />
                  ))}
                  <g transform={`translate(${px} ${pz}) rotate(${180 - (pyaw * 180) / Math.PI})`}>
                    <polygon points="0,-4.5 3,3.5 -3,3.5" fill="#37c8ff" stroke="#eaffff" strokeWidth="0.7" />
                  </g>
                </svg>
                <div className="mt-1.5 flex justify-center gap-3 text-[9px] text-white/55">
                  <span><span className="inline-block w-2 h-2 rounded-full bg-cyan-400 mr-1" />You</span>
                  <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1" />Portals</span>
                  <span><span className="inline-block w-2 h-2 rounded-sm bg-[#22304e] mr-1" />Structures</span>
                </div>
              </div>
            );
          })()}
          {hud.portal && (
            <div className="absolute right-3 bottom-56 sm:bottom-40 z-20 bg-black/70 backdrop-blur-md border border-white/20 rounded-2xl p-3.5 w-52" data-testid="nexus-portal-card">
              <div className="flex items-center gap-2.5">
                <span className="w-10 h-10 rounded-xl bg-purple-500/25 border border-purple-400/40 flex items-center justify-center shrink-0">
                  {/(game|gaming)/i.test(hud.portal) ? <Gamepad2 className="w-5 h-5 text-purple-300" /> : <DoorOpen className="w-5 h-5 text-purple-300" />}
                </span>
                <div className="font-black text-sm leading-tight">{hud.portal}</div>
              </div>
              <button data-testid="nexus-portal-enter-btn" aria-label={`Enter ${hud.portal}`}
                onClick={() => { if (nearPortalRef.current) onPortal?.(nearPortalRef.current); }}
                className="mt-3 w-full h-11 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 text-black font-black text-sm tracking-widest shadow-[0_0_18px_rgba(52,211,153,0.5)] active:scale-95 focus-visible:ring-2 focus-visible:ring-emerald-300 outline-none transition-transform">
                ENTER
              </button>
            </div>
          )}
          {hud.prompt && (
            <div className="absolute bottom-32 left-1/2 -translate-x-1/2 text-sm font-bold text-white bg-black/70 border border-cyan-400/40 rounded-xl px-5 py-3 text-center" data-testid="nexus-prompt">
              {hud.prompt}
            </div>
          )}
          {(!mob || chatOpen) && (
          <form
            onSubmit={async (ev) => {
              ev.preventDefault();
              const value = chatText.trim();
              if (!value || !chatApiRef.current) return;
              setChatError("");
              try {
                await chatApiRef.current(value);
                setChatText("");
                if (mob) setChatOpen(false);
              } catch (err) {
                setChatError(err?.response?.data?.detail || "Chat failed");
              }
            }}
            className={`absolute z-20 ${mob ? "bottom-40" : "bottom-12"} left-1/2 -translate-x-1/2 flex gap-1 w-[min(88vw,420px)]`}
            data-testid="nexus-chat-form">
            {chatError && (
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-red-200 bg-red-950/80 rounded px-2 py-1">
                {chatError}
              </span>
            )}
            <input
              value={chatText}
              onChange={(ev) => setChatText(ev.target.value)}
              maxLength={160}
              aria-label="Nearby chat"
              placeholder="Talk to nearby players…"
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/65 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
              data-testid="nexus-chat-input"
            />
            <button type="submit" aria-label="Send chat"
              className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-black text-black active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-300 outline-none"
              data-testid="nexus-chat-send">SEND</button>
          </form>
          )}
          {reactOpen && (
            <div className="absolute z-30 left-1/2 -translate-x-1/2 flex gap-2 bg-black/70 backdrop-blur-md border border-white/20 rounded-full px-3 py-2"
              style={{ bottom: "max(calc(env(safe-area-inset-bottom) + 74px), 86px)" }} data-testid="nexus-emoji-bar">
              {["👋", "😄", "🔥", "💚", "🎉"].map((em) => (
                <button key={em} type="button" aria-label={`React ${em}`}
                  onClick={async () => { try { await chatApiRef.current?.(em); } catch { /* offline */ } setReactOpen(false); }}
                  className="w-11 h-11 rounded-full bg-white/10 border border-white/15 text-lg active:scale-90 focus-visible:ring-2 focus-visible:ring-cyan-400 outline-none transition-transform"
                  data-testid={`nexus-emoji-${em}`}>{em}</button>
              ))}
            </div>
          )}
          {!hud.locked && !mob && (
            <div className="hidden sm:block absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-white/70 bg-black/40 rounded-lg px-3 py-1.5 whitespace-nowrap">
              Click to lock camera · WASD move · Space jump · Shift sprint · E interact · Wheel zoom · Esc release
            </div>
          )}
          <button data-testid="nexus-settings-btn-legacy" style={{ display: "none" }} onClick={() => setShowSet(!showSet)} />
          {showSet && (
            <div className="absolute right-3 bg-black/80 rounded-xl p-3 text-xs text-white/90 space-y-2 w-52 z-30"
              style={{ top: "max(calc(env(safe-area-inset-top) + 52px), 60px)" }} data-testid="nexus-settings">
              <label className="block">Sensitivity {cam.sens.toFixed(1)}
                <input type="range" min="0.3" max="2.5" step="0.1" value={cam.sens} className="w-full"
                  onChange={(e) => saveCam({ ...cam, sens: parseFloat(e.target.value) })} data-testid="nexus-sens" />
              </label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={cam.invH}
                onChange={(e) => saveCam({ ...cam, invH: e.target.checked })} data-testid="nexus-invert-h" /> Invert Horizontal</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={cam.invV}
                onChange={(e) => saveCam({ ...cam, invV: e.target.checked })} data-testid="nexus-invert-v" /> Invert Vertical</label>
            </div>
          )}
          {mob && (
            <>
              {/* right control column: recenter, JUMP, INTERACT */}
              <button aria-label="Recenter camera"
                className="absolute right-5 flex items-center justify-center w-12 h-12 rounded-full bg-black/40 backdrop-blur-md border border-white/25 text-white active:scale-90 active:bg-white/20 focus-visible:ring-2 focus-visible:ring-cyan-400 outline-none transition-transform"
                style={{ bottom: "max(calc(env(safe-area-inset-bottom) + 216px), 228px)" }}
                onTouchStart={() => window.__NEXUS_MOB?.recenter()} data-testid="nexus-recenter-btn">
                <Crosshair className="w-6 h-6" strokeWidth={2} />
              </button>
              <button aria-label="Jump"
                className="absolute right-4 flex flex-col items-center justify-center w-[84px] h-[84px] rounded-full bg-black/40 backdrop-blur-md border-2 border-white/30 text-white shadow-[0_0_22px_rgba(52,211,153,0.25)] active:scale-95 active:bg-emerald-500/30 active:border-emerald-300/70 focus-visible:ring-2 focus-visible:ring-emerald-300 outline-none transition-transform"
                style={{ bottom: "max(calc(env(safe-area-inset-bottom) + 118px), 130px)" }}
                onTouchStart={() => window.__NEXUS_MOB?.jump()} data-testid="nexus-jump-btn">
                <ArrowUp className="w-7 h-7" strokeWidth={3} />
                <span className="text-[11px] font-black tracking-widest mt-0.5">JUMP</span>
              </button>
              <button aria-label="Interact"
                className="absolute right-3 flex flex-col items-center justify-center w-[96px] h-[96px] rounded-full bg-black/40 backdrop-blur-md border-2 border-white/30 text-white shadow-[0_0_22px_rgba(255,255,255,0.12)] active:scale-95 active:bg-cyan-500/30 active:border-cyan-300/70 focus-visible:ring-2 focus-visible:ring-cyan-300 outline-none transition-transform"
                style={{ bottom: "max(env(safe-area-inset-bottom), 12px)" }}
                onTouchStart={() => window.__NEXUS_MOB?.interact()} data-testid="nexus-interact-btn">
                <Hand className="w-7 h-7" strokeWidth={2.4} />
                <span className="text-[11px] font-black tracking-widest mt-0.5">INTERACT</span>
              </button>
              {/* bottom-center: chat / reactions / mic (mic behind feature flag) */}
              <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3"
                style={{ bottom: "max(calc(env(safe-area-inset-bottom) + 8px), 18px)" }}>
                <button aria-label="Toggle chat" aria-pressed={chatOpen}
                  className={`flex items-center justify-center w-12 h-12 rounded-full backdrop-blur-md border active:scale-90 focus-visible:ring-2 focus-visible:ring-cyan-400 outline-none transition-transform ${chatOpen ? "bg-cyan-500/80 border-cyan-300/60 text-black" : "bg-black/40 border-white/25 text-white"}`}
                  onTouchStart={() => { setChatOpen((v) => !v); setReactOpen(false); }} data-testid="nexus-chat-toggle">
                  <MessageSquare className="w-6 h-6" strokeWidth={2.2} />
                </button>
                <button aria-label="Reactions" aria-pressed={reactOpen}
                  className={`flex items-center justify-center w-12 h-12 rounded-full backdrop-blur-md border active:scale-90 focus-visible:ring-2 focus-visible:ring-cyan-400 outline-none transition-transform ${reactOpen ? "bg-cyan-500/80 border-cyan-300/60 text-black" : "bg-black/40 border-white/25 text-white"}`}
                  onTouchStart={() => { setReactOpen((v) => !v); setChatOpen(false); }} data-testid="nexus-react-toggle">
                  <Smile className="w-6 h-6" strokeWidth={2.2} />
                </button>
                {voiceEnabled && (
                  <button aria-label="Microphone (muted)" aria-pressed="false" disabled
                    className="flex items-center justify-center w-12 h-12 rounded-full bg-black/40 backdrop-blur-md border border-white/25 text-white/40"
                    data-testid="nexus-mic-btn">
                    <Mic className="w-6 h-6" strokeWidth={2.2} />
                  </button>
                )}
              </div>
              {/* movement controller: ring + chevrons + glowing thumb */}
              <div className="absolute left-4 w-32 h-32 rounded-full border-2 border-white/25 bg-black/30 backdrop-blur-sm pointer-events-none"
                style={{ bottom: "max(env(safe-area-inset-bottom), 12px)" }} data-testid="nexus-joystick-ring">
                <ChevronUp className="absolute top-1 left-1/2 -translate-x-1/2 w-4 h-4 text-white/60" />
                <ChevronDown className="absolute bottom-1 left-1/2 -translate-x-1/2 w-4 h-4 text-white/60" />
                <ChevronLeft className="absolute left-1 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60" />
                <ChevronRight className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60" />
                <div id="nexus-joy-thumb" data-testid="nexus-joystick-thumb"
                  className="absolute left-1/2 top-1/2 -ml-7 -mt-7 w-14 h-14 rounded-full bg-gradient-to-b from-cyan-300 to-cyan-600 shadow-[0_0_24px_rgba(34,211,238,0.65)] border border-cyan-200/70 transition-transform duration-75" />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
