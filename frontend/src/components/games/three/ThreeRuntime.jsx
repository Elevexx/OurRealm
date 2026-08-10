/* OurRealm 3D Runtime v1 — real WebGL (three.js), code-split.
   Modes: (a) orb demo (default), (b) QUEST mode when spec.levels_3d exists:
   NPC → ingredient objective → cooking station → guardian → key → portal,
   with a FIXED high-angle top-down camera that follows X/Z and never spins.
   ER note: pickups render client-side; Engagement Resource / Fire Power
   claims remain server-authoritative upstream. */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import apiClient from "@/api/client";
import { buildLevel, disposeLevel, tickLevel } from "./questLevel";

export default function ThreeRuntime({ game, onExit }) {
  const mountRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [hud, setHud] = useState({ mode: "orbs", level: 1, total: 1, phase: "talk",
    ing: 0, need: 3, coins: 0, gems: 0, stars: 0, orbs: 0, done: false, msg: "" });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let disposed = false;
    const spec = game?.spec || {};
    const world = spec.world_3d || {};
    const levels = Array.isArray(spec.levels_3d) ? spec.levels_3d : null;
    const quest = !!(levels && levels.length);
    try { window.__OR3D_ASSETS = Object.keys(spec.assets || {}); } catch { /* noop */ }

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(world.sky || "#141a2e");
    scene.fog = new THREE.Fog(world.sky || "#141a2e", 42, 130);
    const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.1, 220);
    scene.add(new THREE.AmbientLight(0x9aa8c8, 0.45));
    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x3a2c1e, 0.85);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe9c4, 1.25);
    sun.position.set(12, 22, 8);
    sun.castShadow = true;
    scene.add(sun);

    // player
    const player = new THREE.Group();
    scene.add(player);
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.9, 6, 12),
      new THREE.MeshStandardMaterial({ color: world.hero_color || "#37e0c8", roughness: 0.4 }));
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
        model.scale.setScalar(1.8 / Math.max(0.001, box.getSize(new THREE.Vector3()).y));
        player.add(model);
        if (g.animations?.length) { mixer = new THREE.AnimationMixer(model); mixer.clipAction(g.animations[0]).play(); }
      }, undefined, () => {});
    }

    // ---- world content ----
    let lvIdx = 0, L = null, phase = "talk", ing = 0, need = 3, hitCd = 0;
    let coins = 0, gems = 0, stars = 0, collected = 0, won = false;
    let obstacles = [], orbs = [], portal = null;
    const say = (msg) => setHud((h) => ({ ...h, msg }));

    function loadQuestLevel(i) {
      if (L) disposeLevel(scene, L);
      const lv = levels[i];
      L = buildLevel(scene, lv, spec.assets || {});
      obstacles = L.obstacles;
      need = (lv.ingredients || [1, 2, 3]).length;
      phase = "talk"; ing = 0;
      player.position.set(...(lv.spawn ? [lv.spawn[0], 0, lv.spawn[1]] : [-14, 0, 12]));
      const sky = new THREE.Color(lv.sky || world.sky || "#141a2e");
      scene.background = sky;
      if (scene.fog) scene.fog.color = sky;
      setHud((h) => ({ ...h, mode: "quest", level: i + 1, total: levels.length,
        phase: "talk", ing: 0, need, msg: `${lv.title || `Level ${i + 1}`} — speak with the chef!` }));
    }
    const submitScore = (completed, stageReached) => {
      apiClient.post(`/games/${game.id}/score`, {
        score: coins * 5 + gems * 15 + stars * 25,
        completed, stage_reached: stageReached, game_version: 2,
      }).catch(() => {});
    };
    const awardRealmKey = (levelIdx) => {
      apiClient.post("/realm-keys/award", { game_id: game.id, level_index: levelIdx }).catch(() => {});
    };

    if (quest) {
      loadQuestLevel(0);
    } else {
      const ground = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 1, 48),
        new THREE.MeshStandardMaterial({ color: world.ground || "#2c4034", roughness: 0.95 }));
      ground.position.y = -0.5; ground.receiveShadow = true; scene.add(ground);
      const obsMat = new THREE.MeshStandardMaterial({ color: "#3d4a63", roughness: 0.8 });
      (world.pillars || [[8, 4, 8], [-10, 6, 5], [4, 5, -12], [-7, 3, -9], [14, 7, -3]]).forEach(([x, h, z]) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, h, 10), obsMat);
        m.position.set(x, h / 2, z); m.castShadow = true; scene.add(m);
        obstacles.push({ x, z, r: 2.0 });
      });
      (world.orbs || [[6, 6], [-9, -4], [2, -10]]).forEach(([x, z]) => {
        const o = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1),
          new THREE.MeshStandardMaterial({ color: "#ffb347", emissive: "#ff7a1a", emissiveIntensity: 1.2 }));
        o.position.set(x, 1.1, z); scene.add(o); orbs.push(o);
      });
      portal = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.22, 12, 40),
        new THREE.MeshStandardMaterial({ color: "#37c8ff", emissive: "#1a7aff", emissiveIntensity: 0.4 }));
      portal.position.set(0, 1.9, -16); scene.add(portal);
      setHud((h) => ({ ...h, mode: "orbs", total: orbs.length }));
    }

    // ---- input ----
    const keys = {};
    const kd = (e) => { keys[e.key.toLowerCase()] = true; if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault(); };
    const ku = (e) => { keys[e.key.toLowerCase()] = false; };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    const touch = { x: 0, y: 0, on: false };
    const tstart = (e) => { touch.on = true; touch.sx = e.touches[0].clientX; touch.sy = e.touches[0].clientY; };
    const tmove = (e) => { if (!touch.on) return;
      touch.x = THREE.MathUtils.clamp((e.touches[0].clientX - touch.sx) / 50, -1, 1);
      touch.y = THREE.MathUtils.clamp((e.touches[0].clientY - touch.sy) / 50, -1, 1);
      e.preventDefault(); };
    const tend = () => { touch.on = false; touch.x = 0; touch.y = 0; };
    renderer.domElement.addEventListener("touchstart", tstart, { passive: false });
    renderer.domElement.addEventListener("touchmove", tmove, { passive: false });
    renderer.domElement.addEventListener("touchend", tend);

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    });
    ro.observe(mount);
    renderer.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());

    let heading = 0, raf = 0, running = true;
    const clock = new THREE.Clock();
    const vis = () => { running = document.visibilityState === "visible";
      if (running) { clock.getDelta(); loop(); } else cancelAnimationFrame(raf); };
    document.addEventListener("visibilitychange", vis);

    const near = (obj, d) => obj && player.position.distanceTo(
      new THREE.Vector3(obj.position.x, 0, obj.position.z)) < d;

    function loop() {
      if (disposed || !running) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (mixer) mixer.update(dt);
      hitCd = Math.max(0, hitCd - dt);
      let ix = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0) + touch.x;
      let iz = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0) + touch.y;
      const mag = Math.hypot(ix, iz);
      if (mag > 1) { ix /= mag; iz /= mag; } // normalized 8-direction diagonals
      const nx = player.position.x + ix * 7 * dt;
      const nz = player.position.z + iz * 7 * dt;
      if (mag > 0.05) heading = Math.atan2(ix, iz);
      const hits = (px, pz) => {
        let b = false;
        obstacles.forEach((o) => {
          if (o.r) { if (Math.hypot(px - o.x, pz - o.z) < o.r) b = true; }
          else if (Math.abs(px - o.x) < o.hw && Math.abs(pz - o.z) < o.hd) b = true;
        });
        if (quest ? (Math.abs(px) > 21 || Math.abs(pz) > 16) : Math.hypot(px, pz) > 38) b = true;
        return b;
      };
      // axis-separated sliding collision
      if (!hits(nx, player.position.z)) player.position.x = nx;
      if (!hits(player.position.x, nz)) player.position.z = nz;
      player.rotation.y = heading; // character faces movement direction

      if (quest && L) {
        if (phase === "talk" && near(L.npc, 1.8)) {
          phase = "gather";
          say(`Chef: gather ${need} ingredients, then use my cooking station!`);
          setHud((h) => ({ ...h, phase }));
        }
        L.pickups.forEach((p) => {
          if (!p.mesh.visible) return;
          p.mesh.rotation.y += dt * 2;
          if (near(p.mesh, 1.3)) {
            p.mesh.visible = false;
            if (p.kind === "ingredient" && phase !== "talk") { ing += 1; setHud((h) => ({ ...h, ing })); }
            else if (p.kind === "coin") { coins += 1; setHud((h) => ({ ...h, coins })); }
            else if (p.kind === "gem") { gems += 1; setHud((h) => ({ ...h, gems })); }
            else if (p.kind === "star") { stars += 1; setHud((h) => ({ ...h, stars })); }
            else p.mesh.visible = true;
          }
        });
        if (phase === "gather" && ing >= need && near(L.station, 2.0)) {
          phase = "fight";
          say("Dish cooked! The level guardian awakens — strike it by charging into it!");
          setHud((h) => ({ ...h, phase }));
        }
        if (phase === "fight" && L.guardian.visible) {
          const gp = L.guardian.position;
          const dx = player.position.x - gp.x, dz = player.position.z - gp.z;
          const d = Math.hypot(dx, dz);
          if (d > 1.2 && d < 14) { gp.x += (dx / d) * 2.4 * dt; gp.z += (dz / d) * 2.4 * dt; }
          if (d < 1.5 && hitCd <= 0) {
            hitCd = 0.6; L.guardianHp -= 1;
            L.guardian.material.emissiveIntensity = 2.2;
            setTimeout(() => { if (L.guardian) L.guardian.material.emissiveIntensity = 1.0; }, 140);
            if (L.guardianHp <= 0) {
              L.guardian.visible = false; L.key.visible = true;
              phase = "key"; say("Guardian defeated! Take the stage key.");
              setHud((h) => ({ ...h, phase }));
            }
          }
        }
        if (phase === "key" && L.key.visible && near(L.key, 1.5)) {
          L.key.visible = false; phase = "portal";
          L.portal.material.emissiveIntensity = 1.8;
          say("Key claimed — the portal is open!");
          setHud((h) => ({ ...h, phase }));
        }
        L.portal.rotation.y += dt * (phase === "portal" ? 1.8 : 0.25);
        tickLevel(L, dt);
        if (phase === "portal" && near(L.portal, 2.2)) {
          awardRealmKey(lvIdx);
          if (lvIdx + 1 >= levels.length) {
            won = true; setHud((h) => ({ ...h, done: true })); phase = "done";
            submitScore(true, levels.length);
          } else {
            submitScore(false, lvIdx + 1);
            lvIdx += 1; loadQuestLevel(lvIdx);
          }
        }
      } else if (!quest) {
        orbs.forEach((o) => {
          if (!o.visible) return;
          o.rotation.y += dt * 2;
          if (near(o, 1.4)) { o.visible = false; collected += 1; setHud((h) => ({ ...h, orbs: collected })); }
        });
        portal.rotation.z += dt * (collected >= orbs.length ? 1.6 : 0.2);
        portal.material.emissiveIntensity = collected >= orbs.length ? 1.6 : 0.3;
        if (!won && collected >= orbs.length && near(portal, 2.2)) { won = true; setHud((h) => ({ ...h, done: true })); }
      }

      if (quest) {
        // FIXED top-down follow camera — constant offset, never spins with heading
        const t = new THREE.Vector3(player.position.x, 15.5, player.position.z + 9.5);
        camera.position.lerp(t, 1 - Math.exp(-dt * 5));
        camera.lookAt(player.position.x, 0.6, player.position.z);
      } else {
        const t = new THREE.Vector3(player.position.x - Math.sin(heading) * 7.5, 5.2,
          player.position.z - Math.cos(heading) * 7.5);
        camera.position.lerp(t, 1 - Math.exp(-dt * 4));
        camera.lookAt(player.position.x, 1.4, player.position.z);
      }
      window.__OR3D = { x: player.position.x, z: player.position.z, level: lvIdx + 1,
        phase, ing, coins, gems, stars, orbs: collected, won,
        cam: { x: camera.position.x, z: camera.position.z } };
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

  const questHud = hud.mode === "quest";
  const [fs, setFs] = useState(false);
  const toggleFs = () => {
    const el = document.querySelector('[data-testid="three-runtime"]');
    if (!fs && el?.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (fs && document.exitFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setFs(!fs);
    document.body.classList.toggle("or3d-css-fs", !fs);
  };
  return (
    <div className={`relative w-full ${fs ? "or3d-fs" : ""}`}
      style={fs ? { position: "fixed", inset: 0, zIndex: 100, height: "100dvh", background: "#0c1120" }
                : { height: "min(70vh, 620px)" }} data-testid="three-runtime">
      <div ref={mountRef} className="absolute inset-0 rounded-xl overflow-hidden" data-testid="three-canvas-mount" />
      <div className="absolute top-2 left-3 text-xs font-semibold text-white/90 bg-black/40 rounded-lg px-3 py-1.5" data-testid="three-hud">
        {questHud
          ? `Level ${hud.level}/${hud.total} · 🥕 ${hud.ing}/${hud.need} · 🪙 ${hud.coins} · 💎 ${hud.gems} · ⭐ ${hud.stars}`
          : `${game?.title || "3D World"} · Ember Orbs ${hud.orbs}/${hud.total} ${hud.orbs >= hud.total ? "· Portal open!" : ""}`}
      </div>
      <button onClick={toggleFs} data-testid="three-fullscreen-toggle"
        className="absolute top-2 right-3 text-xs font-semibold text-white/90 bg-black/40 hover:bg-black/60 rounded-lg px-3 py-1.5">
        {fs ? "✕ Exit" : "⛶ Fullscreen"}
      </button>
      {questHud && hud.msg && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-white/95 bg-black/50 rounded-lg px-4 py-2 max-w-[90%]" data-testid="three-quest-msg">{hud.msg}</div>
      )}
      {hud.done && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl" data-testid="three-victory">
          <div className="text-center space-y-3">
            <div className="text-2xl font-bold text-white">{questHud ? "The Arcane Hearth is restored!" : "World Complete!"}</div>
            <button className="or-btn" onClick={onExit} data-testid="three-exit">Back to Games</button>
          </div>
        </div>
      )}
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Loading 3D world…</div>}
    </div>
  );
}
