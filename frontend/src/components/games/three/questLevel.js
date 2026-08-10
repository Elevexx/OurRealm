/* Quest mode for the OurRealm 3D Runtime — spec-driven 3-level loop:
   NPC → ingredient objective → cooking station → guardian → key → portal.
   Genuine WebGL 3D: real geometry with generated PBR-style textures.
   Characters remain greybox primitives until validated Meshy GLBs land
   (founder mandate: no flat-sprite substitution). */
import * as THREE from "three";

const texCache = {};
function tex(url, rx = 1, ry = 1) {
  const k = `${url}|${rx}|${ry}`;
  if (!texCache[k]) {
    window.__OR3D_TEXDBG = window.__OR3D_TEXDBG || {};
    window.__OR3D_TEXDBG[url] = "loading";
    const t = new THREE.TextureLoader().load(url,
      () => { window.__OR3D_TEXDBG[url] = "loaded"; },
      undefined,
      (e) => { window.__OR3D_TEXDBG[url] = "error:" + (e?.message || e?.type || "unknown"); });
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.colorSpace = THREE.SRGBColorSpace;
    texCache[k] = t;
  }
  return texCache[k];
}

function slotUrl(assets, slot) {
  return assets && assets[slot] && assets[slot].url ? assets[slot].url : null;
}

export function buildLevel(scene, lvl, assets) {
  const g = { obstacles: [], pickups: [], meshes: [], lights: [] };
  const add = (m) => { scene.add(m); g.meshes.push(m); return m; };
  const gUrl = slotUrl(assets, lvl.ground_tex);
  const wUrl = slotUrl(assets, lvl.wall_tex);
  const ground = add(new THREE.Mesh(new THREE.BoxGeometry(44, 1, 34),
    gUrl ? new THREE.MeshStandardMaterial({ map: tex(gUrl, 7, 5.5), roughness: 0.92 })
         : new THREE.MeshStandardMaterial({ color: lvl.ground || "#3a4454", roughness: 0.95 })));
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  (lvl.walls || []).forEach(([x, z, w, d]) => {
    const mat = wUrl
      ? new THREE.MeshStandardMaterial({ map: tex(wUrl, Math.max(1, Math.round(Math.max(w, d) / 3)), 1), roughness: 0.85 })
      : new THREE.MeshStandardMaterial({ color: "#2b3242", roughness: 0.85 });
    const m = add(new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), mat));
    m.position.set(x, 1.2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.obstacles.push({ x, z, hw: w / 2 + 0.5, hd: d / 2 + 0.5 });
  });
  (lvl.props || []).forEach(([x, z, w, h, d]) => {
    const m = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      wUrl ? new THREE.MeshStandardMaterial({ map: tex(wUrl, 1, 1), roughness: 0.8 })
           : new THREE.MeshStandardMaterial({ color: "#4a3a2c", roughness: 0.8 })));
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    g.obstacles.push({ x, z, hw: w / 2 + 0.4, hd: d / 2 + 0.4 });
  });
  const mk = (geo, color, emissive, x, z, y = 0.8) => {
    const m = add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color, emissive: emissive || "#000000", emissiveIntensity: emissive ? 1.0 : 0 })));
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  };
  // characters/props: greybox primitives — replaced by validated Meshy GLBs
  g.npc = mk(new THREE.CapsuleGeometry(0.42, 0.8, 6, 10), lvl.npc_color || "#e8c07a", null, ...(lvl.npc || [-8, -6]), 1.0);
  g.station = mk(new THREE.CylinderGeometry(0.9, 1.1, 1.1, 10), "#c96f2f", "#ff7a1a", ...(lvl.station || [8, -6]), 0.55);
  g.guardian = mk(new THREE.CapsuleGeometry(lvl.guardian_scale || 0.7, 1.2, 6, 10),
    lvl.guardian_color || "#8a3fd0", "#4a1a80", ...(lvl.guardian || [10, 8]), 1.3);
  g.guardianHp = lvl.guardian_hp || 5;
  g.key = mk(new THREE.OctahedronGeometry(0.42), "#2ee87a", "#0f8a3f", ...(lvl.key || [0, 10]), 1.0);
  g.key.visible = false; // spawns after guardian falls
  const keyLight = new THREE.PointLight("#4dffa0", 0, 9);
  keyLight.position.set((lvl.key || [0, 10])[0], 2.2, (lvl.key || [0, 10])[1]);
  scene.add(keyLight); g.meshes.push(keyLight); g.keyLight = keyLight;
  g.portal = mk(new THREE.TorusGeometry(1.5, 0.2, 12, 36), "#37c8ff", "#1a7aff", ...(lvl.portal || [16, 0]), 1.8);
  // cinematic firelight: warm station glow + cool portal glow + level accents
  const st = lvl.station || [8, -6];
  const sl = new THREE.PointLight("#ffab52", 28, 14, 1.8);
  sl.position.set(st[0], 2.6, st[1]); scene.add(sl); g.meshes.push(sl);
  const pp = lvl.portal || [16, 0];
  const pl = new THREE.PointLight("#4db8ff", 20, 13, 1.8);
  pl.position.set(pp[0], 2.4, pp[1]); scene.add(pl); g.meshes.push(pl);
  (lvl.accent_lights || []).forEach(([x, z, c]) => {
    const al = new THREE.PointLight(c || "#ffcf7a", 14, 12, 1.9);
    al.position.set(x, 2.4, z); scene.add(al); g.meshes.push(al);
  });
  // drifting embers
  const n = 70, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 42;
    pos[i * 3 + 1] = Math.random() * 7;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 32;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.embers = add(new THREE.Points(pg, new THREE.PointsMaterial({
    color: lvl.ember_color || "#ffb35c", size: 0.14, transparent: true, opacity: 0.85 })));
  (lvl.ingredients || [[-4, 4], [3, -9], [-10, 8]]).forEach(([x, z]) => {
    g.pickups.push({ kind: "ingredient", mesh: mk(new THREE.IcosahedronGeometry(0.35, 0), "#7ee081", "#2e7d32", x, z, 0.7) });
  });
  (lvl.coins || [[-2, -2], [5, 3], [-6, -10], [9, -2], [12, 5], [-12, 2]]).forEach(([x, z]) => {
    g.pickups.push({ kind: "coin", mesh: mk(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 12), "#ffd34d", "#8a6d1a", x, z, 0.6) });
  });
  (lvl.gems || [[14, -10]]).forEach(([x, z]) => {
    g.pickups.push({ kind: "gem", mesh: mk(new THREE.OctahedronGeometry(0.32), "#c26bff", "#6a1b9a", x, z, 0.7) });
  });
  g.pickups.push({ kind: "star", mesh: mk(new THREE.TetrahedronGeometry(0.42), "#fff176", "#f9a825", ...(lvl.star || [-16, -12]), 0.8) });
  return g;
}

export function tickLevel(g, dt) {
  if (!g || !g.embers) return;
  const p = g.embers.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i) + dt * (0.5 + (i % 5) * 0.14);
    if (y > 7.5) y = 0;
    p.setY(i, y);
  }
  p.needsUpdate = true;
  if (g.key && g.key.visible) {
    g.key.rotation.y += dt * 2.2;
    if (g.keyLight) g.keyLight.intensity = 16 + Math.sin(Date.now() * 0.004) * 5;
  } else if (g.keyLight) g.keyLight.intensity = 0;
}

export function disposeLevel(scene, g) {
  g.meshes.forEach((m) => {
    scene.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
  });
}
