/* NexusWorld — genuine Three.js third-person world client (Phase 1 greybox).
   mode "play": pointer-lock camera, movement, collision, portals, presence multiplayer.
   mode "build": orbit camera, click-select, drag-move on ground (founder editor viewport). */
import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { makeGLTFLoader } from "@/components/games/three/questLevel";
import apiClient from "@/api/client";

const CAMS = () => { try { return JSON.parse(localStorage.getItem("nexus_cam") || "{}"); } catch { return {}; } };
const GLB_CACHE = {};
const loadGLB = (url) => {
  if (!GLB_CACHE[url]) GLB_CACHE[url] = new Promise((res, rej) => makeGLTFLoader().load(url, res, undefined, rej));
  return GLB_CACHE[url];
};

function geometryBounds(obj) {
  const box = new THREE.Box3();
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
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
    ? THREE.MathUtils.clamp(rawScale, 0.0001, 5)
    : 1;
  obj.scale.setScalar(safeScale);
  obj.updateMatrixWorld(true);
  box = geometryBounds(obj);
  const center = box.getCenter(new THREE.Vector3());
  obj.position.set(-center.x, -box.min.y, -center.z);
  obj.updateMatrixWorld(true);
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

function makeAvatar(color, label, avatarUrl, mixers) {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.9, 6, 12),
    new THREE.MeshStandardMaterial({ color }));
  body.position.y = 1.0; body.castShadow = true; grp.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 8),
    new THREE.MeshStandardMaterial({ color: "#ffffff" }));
  nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.45, 0.42); grp.add(nose);
  if (label) grp.add(nameSprite(label));
  if (avatarUrl) {
    loadGLB(avatarUrl).then((g) => {
      if (grp.userData.disposed) return;
      const inst = skeletonClone(g.scene);
      const holder = new THREE.Group();
      holder.add(inst);
      fitToHeight(holder, 1.8);
      holder.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      grp.remove(body); grp.remove(nose);
      grp.add(holder);
      if (g.animations?.length) {
        const mixer = new THREE.AnimationMixer(inst);
        const action = mixer.clipAction(g.animations[0]);
        action.play();
        action.timeScale = 0;
        grp.userData.mix = { mixer, action };
        mixers.push(grp.userData.mix);
      }
    }).catch(() => { /* keep capsule fallback */ });
  }
  return grp;
}

function setAvatarAnim(grp, state) {
  const m = grp.userData.mix;
  if (!m) return;
  if (state === "walk") m.action.timeScale = 1;
  else if (state === "run") m.action.timeScale = 1.7;
  else m.action.timeScale = 0;
}

export default function NexusWorld({ mode = "play", world, zoneId = "plaza", username = "you",
  onSelect, selectedId, onEntityMove, onPortal, onPublishedVersion, travelRef, refreshKey = 0 }) {
  const mountRef = useRef(null);
  const [hud, setHud] = useState({ online: 1, zone: "", prompt: "", locked: false });
  const [showSet, setShowSet] = useState(false);
  const [chatText, setChatText] = useState("");
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
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(zone.sky || "#101a30");
    scene.fog = new THREE.Fog(zone.sky || "#101a30", 60, 160);
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 300);
    scene.add(new THREE.AmbientLight(0x9fb2d8, zone.ambient ?? 0.55));
    scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x2a2416, 0.6));
    const sun = new THREE.DirectionalLight(0xffeecc, zone.sun ?? 1.1);
    sun.position.set(24, 40, 18); sun.castShadow = true;
    sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
    scene.add(sun);
    const [ZW, ZD] = zone.size || [80, 80];
    const ground = new THREE.Mesh(new THREE.BoxGeometry(ZW, 1, ZD),
      new THREE.MeshStandardMaterial({ color: zone.ground_color || "#2c3450", roughness: 0.95 }));
    ground.position.y = -0.5; ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.GridHelper(Math.max(ZW, ZD), Math.max(ZW, ZD) / 2, 0x3a4a6a, 0x28324e);
    grid.position.y = 0.01; scene.add(grid);

    const colliders = []; const portals = []; const npcs = []; const pickables = [];
    const entMeshes = {};
    const mixers = [];
    const avatarUrl = world?.meta?.starter_avatar_url || null;
    zone.entities.forEach((e) => {
      let m = null;
      const [sx, sy, sz] = e.scale;
      if (e.type === "box" || e.type === "pillar" || e.type === "ramp") {
        m = new THREE.Mesh(e.type === "pillar" ? new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 14)
          : new THREE.BoxGeometry(sx, sy, sz),
          new THREE.MeshStandardMaterial({ color: e.color || "#4a4f66", roughness: 0.85 }));
        m.position.set(e.pos[0], e.pos[1] + sy / 2, e.pos[2]);
        m.rotation.y = e.rot[1] || 0; m.castShadow = true; m.receiveShadow = true;
        colliders.push({ x: e.pos[0], z: e.pos[2], hw: Math.max(sx, sz) / 2, hd: Math.max(sx, sz) / 2, top: e.pos[1] + sy });
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
        m = makeAvatar(e.color || "#e8c07a", e.props?.label || "NPC", null, mixers);
        m.position.set(e.pos[0], 0, e.pos[2]); m.rotation.y = e.rot[1] || 0;
        npcs.push({ e, mesh: m });
        colliders.push({ x: e.pos[0], z: e.pos[2], hw: 0.6, hd: 0.6, top: 1.9 });
      } else if (e.type === "model" && e.props?.url) {
        m = new THREE.Group();
        const ph = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz),
          new THREE.MeshStandardMaterial({ color: e.color || "#2ee87a", transparent: true, opacity: 0.25, wireframe: true }));
        ph.position.y = sy / 2; m.add(ph);
        loadGLB(e.props.url).then((g) => {
          if (disposed) return;
          const inst = g.scene.clone(true);
          const holder = new THREE.Group();
          holder.add(inst);
          fitToHeight(holder, sy);
          holder.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          m.add(holder); m.remove(ph);
        }).catch(() => { ph.material.wireframe = false; ph.material.opacity = 0.85; });
        m.position.set(e.pos[0], e.pos[1], e.pos[2]); m.rotation.y = e.rot[1] || 0;
        colliders.push({ x: e.pos[0], z: e.pos[2], hw: sx / 2, hd: sz / 2, top: e.pos[1] + sy });
      }
      if (m) { scene.add(m); m.userData.entityId = e.id; entMeshes[e.id] = m; pickables.push(m); }
    });

    const player = makeAvatar("#37c8ff", mode === "play" ? username : null, mode === "play" ? avatarUrl : null, mixers);
    scene.add(player);
    const spawn = zone.spawn || { x: 0, z: 0 };
    player.position.set(spawn.x, 0, spawn.z);
    player.visible = mode === "play";
    let vy = 0; let grounded = true; let sprint = false;
    let yaw = 0; let pitch = 0.42; let dist = 7;
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
        if (t.identifier === joy.id) { joy.id = null; touch.x = 0; touch.y = 0; }
        if (t.identifier === camT.id) camT.id = null;
      }
    };
    renderer.domElement.addEventListener("touchstart", onTS, { passive: true });
    renderer.domElement.addEventListener("touchmove", onTM, { passive: true });
    renderer.domElement.addEventListener("touchend", onTE, { passive: true });
    window.__NEXUS_MOB = { jump: () => { jumpReq = true; }, interact: () => { interactReq = true; }, sprint: (v) => { sprint = v; } };

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
    const anim = () => (!grounded ? "jump" : (Math.hypot(touch.x, touch.y) > 0.1 || keys.w || keys.a || keys.s || keys.d || keys.arrowup || keys.arrowdown || keys.arrowleft || keys.arrowright) ? (sprint || keys.shift ? "run" : "walk") : "idle");
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
        apiClient.post("/nexus/presence", {
          zone_id: zone.id, x: player.position.x, y: player.position.y, z: player.position.z,
          ry: player.rotation.y, anim: anim(),
        }).then((r) => {
          setHud((h) => ({ ...h, online: r.data.online }));
          if (r.data.pv && r.data.pv !== lastPv) { lastPv = r.data.pv; onPublishedVersion?.(r.data.pv); }
          const seen = new Set();
          (r.data.players || []).forEach((pl) => {
            seen.add(pl.user_id);
            if (!remotes[pl.user_id]) {
              remotes[pl.user_id] = { grp: makeAvatar("#ff9a5c", pl.username, avatarUrl, mixers), tgt: new THREE.Vector3(pl.x, pl.y, pl.z), ry: pl.ry, anim: pl.anim };
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
        const spd = (sprint || keys.shift ? 9.5 : 5.5);
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
        for (const p of portals) {
          p.mesh.rotation.z += dt * (p.e.props?.spin ?? 0.8);
          const d = Math.hypot(p.e.pos[0] - player.position.x, p.e.pos[2] - player.position.z);
          if (d < 3) prompt = `E — ${p.e.props?.label || "Portal"}`;
          if (d < 3 && interactReq) onPortal?.(p.e);
        }
        for (const n of npcs) {
          const d = Math.hypot(n.e.pos[0] - player.position.x, n.e.pos[2] - player.position.z);
          if (d < 2.6) prompt = `E — talk to ${n.e.props?.label || "NPC"}`;
          if (d < 2.6 && interactReq) onPortal?.(n.e);
        }
        interactReq = false;
        setHud((h) => (h.prompt === prompt ? h : { ...h, prompt }));
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
      camera.position.set(
        focus.x + Math.sin(yaw) * Math.cos(pitch) * dist,
        focus.y + 1.6 + Math.sin(pitch) * dist,
        focus.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.lookAt(focus.x, focus.y + 1.4, focus.z);
      mixers.forEach((m) => m.mixer.update(dt));
      renderer.render(scene, camera);
      window.__NEXUS = { x: player.position.x, y: player.position.y, z: player.position.z, yaw, online: hud.online, mode, zone: zone.id, remotes: Object.keys(remotes).length };
    };
    step();
    const ro = new ResizeObserver(() => {
      camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
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
        apiClient.post("/nexus/position/save", { zone_id: zone.id, x: player.position.x, y: player.position.y, z: player.position.z, ry: player.rotation.y }).catch(() => {});
        apiClient.post("/nexus/presence/leave").catch(() => {});
      }
      window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      window.removeEventListener("mousemove", onBuildMove);
      window.removeEventListener("mouseup", onUp);
      ro.disconnect();
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
          <div className="absolute top-2 left-3 text-xs font-semibold text-white/90 bg-black/45 rounded-lg px-3 py-1.5" data-testid="nexus-hud">
            {hud.zone} · <span data-testid="nexus-online">{hud.online} online</span>
          </div>
          {hud.prompt && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 text-sm font-bold text-white bg-black/60 rounded-xl px-4 py-2" data-testid="nexus-prompt">{hud.prompt}</div>
          )}
          <form
            onSubmit={async (ev) => {
              ev.preventDefault();
              const value = chatText.trim();
              if (!value || !chatApiRef.current) return;
              setChatError("");
              try {
                await chatApiRef.current(value);
                setChatText("");
              } catch (err) {
                setChatError(err?.response?.data?.detail || "Chat failed");
              }
            }}
            className={`absolute z-20 ${mob ? "bottom-36" : "bottom-12"} left-1/2 -translate-x-1/2 flex gap-1 w-[min(88vw,420px)]`}
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
            <button type="submit"
              className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-black text-black"
              data-testid="nexus-chat-send">SEND</button>
          </form>
          {!hud.locked && !mob && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-white/70 bg-black/40 rounded-lg px-3 py-1.5">
              Click to lock camera · WASD move · Space jump · Shift sprint · E interact · Wheel zoom · Esc release
            </div>
          )}
          <button data-testid="nexus-settings-btn" onClick={() => setShowSet(!showSet)}
            className="absolute top-2 right-3 text-xs text-white/90 bg-black/45 rounded-lg px-3 py-1.5">⚙ Camera</button>
          {showSet && (
            <div className="absolute top-10 right-3 bg-black/75 rounded-xl p-3 text-xs text-white/90 space-y-2 w-52" data-testid="nexus-settings">
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
              <button className="absolute bottom-6 right-4 w-16 h-16 rounded-full bg-cyan-500/70 text-white font-bold"
                onTouchStart={() => window.__NEXUS_MOB?.jump()} data-testid="nexus-jump-btn">JUMP</button>
              <button className="absolute bottom-24 right-6 w-12 h-12 rounded-full bg-emerald-500/70 text-white font-bold"
                onTouchStart={() => window.__NEXUS_MOB?.interact()} data-testid="nexus-interact-btn">E</button>
              <button className="absolute bottom-6 right-24 w-12 h-12 rounded-full bg-orange-500/60 text-white text-xs font-bold"
                onTouchStart={() => window.__NEXUS_MOB?.sprint(true)} onTouchEnd={() => window.__NEXUS_MOB?.sprint(false)}
                data-testid="nexus-sprint-btn">RUN</button>
              <div className="absolute bottom-8 left-6 w-24 h-24 rounded-full border-2 border-white/25 pointer-events-none" />
            </>
          )}
        </>
      )}
    </div>
  );
}
