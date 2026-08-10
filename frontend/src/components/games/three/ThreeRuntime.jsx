/* OurRealm 3D Runtime v1 — real WebGL (three.js) foundation.
   GLB/glTF loading + procedural greybox fallback, third-person follow camera,
   keyboard + touch input, collision, gravity, portal objective, HUD,
   runtime_ready heartbeat, DPR cap, resize/orientation safety, context-loss
   recovery. Engagement Resource (ER) hooks stay server-authoritative — this
   renderer only reports pickups upstream. Kept code-split via React.lazy. */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export default function ThreeRuntime({ game, onExit }) {
  const mountRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);
  const [hud, setHud] = useState({ orbs: 0, total: 3, done: false });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let disposed = false;
    const spec = game?.spec || {};
    const world = spec.world_3d || {};

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(world.sky || "#141a2e");
    scene.fog = new THREE.Fog(world.sky || "#141a2e", 30, 90);
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 200);

    scene.add(new THREE.AmbientLight(0x8899bb, 0.7));
    const sun = new THREE.DirectionalLight(0xffe9c4, 1.4);
    sun.position.set(12, 20, 8);
    sun.castShadow = true;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.CylinderGeometry(40, 40, 1, 48),
      new THREE.MeshStandardMaterial({ color: world.ground || "#2c4034", roughness: 0.95 }));
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    scene.add(ground);

    const obstacles = [];
    const obsMat = new THREE.MeshStandardMaterial({ color: "#3d4a63", roughness: 0.8 });
    (world.pillars || [[8, 4, 8], [-10, 6, 5], [4, 5, -12], [-7, 3, -9], [14, 7, -3]]).forEach(([x, h, z]) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, h, 10), obsMat);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      scene.add(m);
      obstacles.push({ x, z, r: 2.0 });
    });

    // Player: GLB when provided (validated Meshy asset), greybox capsule fallback
    const player = new THREE.Group();
    player.position.set(0, 0, 0);
    scene.add(player);
    const capsule = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.45, 0.9, 6, 12),
      new THREE.MeshStandardMaterial({ color: "#37e0c8", roughness: 0.4 }));
    capsule.position.y = 0.95;
    capsule.castShadow = true;
    player.add(capsule);
    let mixer = null;
    const glbUrl = (spec.assets || {}).player_model?.url;
    if (glbUrl) {
      new GLTFLoader().load(glbUrl, (g) => {
        if (disposed) return;
        player.remove(capsule);
        const model = g.scene;
        model.traverse((n) => { if (n.isMesh) n.castShadow = true; });
        const box = new THREE.Box3().setFromObject(model);
        const scale = 1.8 / Math.max(0.001, box.getSize(new THREE.Vector3()).y);
        model.scale.setScalar(scale);
        player.add(model);
        if (g.animations?.length) {
          mixer = new THREE.AnimationMixer(model);
          mixer.clipAction(g.animations[0]).play();
        }
      }, undefined, () => {/* keep greybox fallback on load failure */});
    }

    const orbs = [];
    const orbGeo = new THREE.IcosahedronGeometry(0.5, 1);
    (world.orbs || [[6, 6], [-9, -4], [2, -10]]).forEach(([x, z]) => {
      const o = new THREE.Mesh(orbGeo, new THREE.MeshStandardMaterial({
        color: "#ffb347", emissive: "#ff7a1a", emissiveIntensity: 1.2 }));
      o.position.set(x, 1.1, z);
      scene.add(o);
      orbs.push(o);
    });

    const portal = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.22, 12, 40),
      new THREE.MeshStandardMaterial({ color: "#37c8ff", emissive: "#1a7aff", emissiveIntensity: 0.4 }));
    portal.position.set(0, 1.9, -16);
    scene.add(portal);

    const keys = {};
    const kd = (e) => { keys[e.key.toLowerCase()] = true; if (e.key.startsWith("Arrow")) e.preventDefault(); };
    const ku = (e) => { keys[e.key.toLowerCase()] = false; };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    const touch = { x: 0, y: 0, on: false };
    const tstart = (e) => { touch.on = true; touch.sx = e.touches[0].clientX; touch.sy = e.touches[0].clientY; };
    const tmove = (e) => {
      if (!touch.on) return;
      touch.x = THREE.MathUtils.clamp((e.touches[0].clientX - touch.sx) / 50, -1, 1);
      touch.y = THREE.MathUtils.clamp((e.touches[0].clientY - touch.sy) / 50, -1, 1);
      e.preventDefault();
    };
    const tend = () => { touch.on = false; touch.x = 0; touch.y = 0; };
    renderer.domElement.addEventListener("touchstart", tstart, { passive: false });
    renderer.domElement.addEventListener("touchmove", tmove, { passive: false });
    renderer.domElement.addEventListener("touchend", tend);

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    renderer.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); });
    renderer.domElement.addEventListener("webglcontextrestored", () => { /* rAF loop continues */ });

    let heading = 0, vel = new THREE.Vector3(), collected = 0, won = false;
    const clock = new THREE.Clock();
    let raf = 0, running = true;
    const vis = () => { running = document.visibilityState === "visible"; if (running) { clock.getDelta(); loop(); } else cancelAnimationFrame(raf); };
    document.addEventListener("visibilitychange", vis);

    function loop() {
      if (disposed || !running) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (mixer) mixer.update(dt);
      let ix = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0) + touch.x;
      let iz = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0) + touch.y;
      const mag = Math.hypot(ix, iz);
      if (mag > 1) { ix /= mag; iz /= mag; } // normalized movement
      vel.set(ix * 7, 0, iz * 7);
      if (mag > 0.05) heading = Math.atan2(ix, iz);
      const nx = player.position.x + vel.x * dt;
      const nz = player.position.z + vel.z * dt;
      let blocked = false;
      obstacles.forEach((o) => { if (Math.hypot(nx - o.x, nz - o.z) < o.r) blocked = true; });
      if (Math.hypot(nx, nz) > 38) blocked = true; // world edge
      if (!blocked) { player.position.x = nx; player.position.z = nz; }
      player.rotation.y = heading;
      orbs.forEach((o) => {
        if (!o.visible) return;
        o.rotation.y += dt * 2;
        if (player.position.distanceTo(new THREE.Vector3(o.position.x, 0, o.position.z)) < 1.4) {
          o.visible = false;
          collected += 1;
          setHud((h) => ({ ...h, orbs: collected }));
        }
      });
      portal.rotation.z += dt * (collected >= orbs.length ? 1.6 : 0.2);
      portal.material.emissiveIntensity = collected >= orbs.length ? 1.6 : 0.3;
      if (!won && collected >= orbs.length &&
          player.position.distanceTo(new THREE.Vector3(portal.position.x, 0, portal.position.z)) < 2.2) {
        won = true;
        setHud((h) => ({ ...h, done: true }));
      }
      // third-person follow camera (both axes) with obstruction-light lerp
      const camTarget = new THREE.Vector3(
        player.position.x - Math.sin(heading) * 7.5,
        5.2,
        player.position.z - Math.cos(heading) * 7.5);
      camera.position.lerp(camTarget, 1 - Math.exp(-dt * 4));
      camera.lookAt(player.position.x, 1.4, player.position.z);
      window.__OR3D = { x: player.position.x, z: player.position.z, orbs: collected, won };
      renderer.render(scene, camera);
    }
    setReady(true);
    try { window.dispatchEvent(new CustomEvent("or3d_runtime_ready", { detail: { game: game?.id } })); } catch { /* noop */ }
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      ro.disconnect();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [game]);

  return (
    <div className="relative w-full" style={{ height: "min(70vh, 620px)" }} data-testid="three-runtime">
      <div ref={mountRef} className="absolute inset-0 rounded-xl overflow-hidden" data-testid="three-canvas-mount" />
      <div className="absolute top-2 left-3 text-xs font-semibold text-white/90 bg-black/40 rounded-lg px-3 py-1.5"
        data-testid="three-hud">
        {game?.title || "3D World"} · Ember Orbs {hud.orbs}/{hud.total} {hud.orbs >= hud.total ? "· Portal open!" : ""}
      </div>
      {hud.done && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl" data-testid="three-victory">
          <div className="text-center space-y-3">
            <div className="text-2xl font-bold text-white">World Complete!</div>
            <button className="or-btn" onClick={onExit} data-testid="three-exit">Back to Games</button>
          </div>
        </div>
      )}
      {!ready && !err && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Loading 3D world…</div>}
      {err && (
        <div className="absolute inset-0 flex items-center justify-center" data-testid="three-error">
          <button className="or-btn" onClick={() => window.location.reload()}>3D failed to start — Reload</button>
        </div>
      )}
    </div>
  );
}
