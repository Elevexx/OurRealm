// REALMLIFE AAA UPGRADE PASS 1 — neon district signage, marina, boats, palms, water polish.
// Cheap boxes/planes only (mobile-safe), added inside the city group so the V6B2 shift applies.
import * as THREE from "three";

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...extra });
}

function bx(group, { x = 0, y = null, z = 0, w = 1, h = 1, d = 1, color = 0xffffff, m = null }) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || mat(color));
  mesh.position.set(x, y ?? h / 2, z);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function neonPanel(group, { text, sub = "", x, y, z, w = 10, h = 2.4, ry = 0, glow = "#39dfff" }) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = Math.round((h / w) * 1024);
  const g = c.getContext("2d");
  g.fillStyle = "#060b18";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = glow; g.lineWidth = 10;
  g.strokeRect(10, 10, c.width - 20, c.height - 20);
  g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = glow; g.shadowBlur = 28;
  g.fillStyle = "#eafcff";
  g.font = `900 ${sub ? 120 : 140}px system-ui`;
  g.fillText(text, c.width / 2, sub ? c.height * 0.38 : c.height / 2);
  if (sub) {
    g.font = "700 62px system-ui";
    g.fillStyle = glow;
    g.fillText(sub, c.width / 2, c.height * 0.74);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.25),
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.4 })
  );
  panel.position.set(x, y, z);
  panel.rotation.y = ry;
  group.add(panel);
  return panel;
}

function gatewaySign(group, opts) {
  const { x, z, w = 12 } = opts;
  const panel = neonPanel(group, { ...opts, y: opts.y ?? 5.1 });
  for (const side of [-1, 1]) {
    const px = x + Math.cos(opts.ry || 0) * side * (w / 2 + 0.4);
    const pz = z - Math.sin(opts.ry || 0) * side * (w / 2 + 0.4);
    bx(group, { x: px, z: pz, w: 0.5, h: 6.4, d: 0.5, color: 0x1a2438 });
    bx(group, { x: px, y: 6.55, z: pz, w: 0.7, h: 0.3, d: 0.7, color: 0x39dfff, m: mat(0x123c4a, { emissive: new THREE.Color(0x39dfff), emissiveIntensity: 1.2 }) });
  }
  return panel;
}

function palm(group, x, z, s = 1) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * s, 0.22 * s, 3.4 * s, 6), mat(0x8a6a44));
  trunk.position.set(x, 1.7 * s, z);
  trunk.rotation.z = (Math.sin(x * 3.7 + z) * 6 * Math.PI) / 180;
  group.add(trunk);
  const leafM = mat(0x2f8a4a, { roughness: 0.7 });
  for (let i = 0; i < 6; i += 1) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.0 * s, 0.06, 0.5 * s), leafM);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(x + Math.cos(a) * 0.85 * s, 3.45 * s, z + Math.sin(a) * 0.85 * s);
    leaf.rotation.y = -a;
    leaf.rotation.z = 0.42;
    group.add(leaf);
  }
}

function boat(group, { x, z, hull = 0xf2f5f8, trim = 0x21415e, len = 6, ry = 0 }) {
  const b = new THREE.Group();
  b.position.set(x, 0.02, z);
  b.rotation.y = ry;
  group.add(b);
  bx(b, { y: 0.42, w: len, h: 0.8, d: 2.0, color: hull });
  bx(b, { y: 0.9, w: len * 0.94, h: 0.16, d: 2.1, color: trim });
  bx(b, { x: -len * 0.12, y: 1.35, w: len * 0.42, h: 0.8, d: 1.5, color: hull });
  bx(b, { x: -len * 0.12, y: 1.82, w: len * 0.46, h: 0.12, d: 1.6, color: trim });
  const glow = bx(b, { x: len * 0.28, y: 0.95, w: 0.2, h: 0.2, d: 1.4, color: 0x39dfff, m: mat(0x0c2a33, { emissive: new THREE.Color(0x39dfff), emissiveIntensity: 1.3 }) });
  glow.rotation.y = Math.PI / 2;
  return b;
}

export function installRealmLifeAAAUpgrade(city) {
  const fx = new THREE.Group();
  fx.name = "RealmLifeAAAUpgradeV1";
  city.add(fx);

  // ---- PHASE 6: TOWER FACADE PASS ----
  // Decorate existing tall placeholder boxes: neon edge strips, parapets, rooftop beacons.
  const towers = [];
  const wscale = new THREE.Vector3();
  city.traverse((o) => {
    if (o.isMesh && o.geometry?.type === "BoxGeometry") {
      const p = o.geometry.parameters;
      if (!p) return;
      o.getWorldScale(wscale);
      const eh = p.height * Math.abs(wscale.y);
      const ew = p.width * Math.abs(wscale.x);
      const ed = p.depth * Math.abs(wscale.z);
      if (eh >= 12 && ew >= 5 && ed >= 5) towers.push({ mesh: o, ew, eh, ed });
    }
  });
  const neonColors = [0x39dfff, 0xc084fc, 0xa3ff12, 0x60a5fa];
  // shared lit-window texture (one canvas for all towers — cheap)
  const winC = document.createElement("canvas");
  winC.width = 256; winC.height = 512;
  const wg = winC.getContext("2d");
  wg.fillStyle = "#0a1220"; wg.fillRect(0, 0, 256, 512);
  for (let r = 0; r < 16; r += 1) {
    for (let col = 0; col < 6; col += 1) {
      const lit = Math.sin(r * 7 + col * 13) > -0.2;
      wg.fillStyle = lit ? (Math.sin(r * 3 + col) > 0.4 ? "#ffd9a0" : "#9fd8ff") : "#141e30";
      wg.fillRect(10 + col * 41, 12 + r * 31, 28, 18);
    }
  }
  const winTex = new THREE.CanvasTexture(winC);
  winTex.colorSpace = THREE.SRGBColorSpace;
  // three shared facade variants for skyline variety (PASS 2B)
  const winMats = [0.55, 0.8, 0.35].map((ei) =>
    new THREE.MeshStandardMaterial({ map: winTex, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: ei, roughness: 0.5 }));
  const winMat = winMats[0];
  void winMat;
  towers.slice(0, 30).forEach((tw, i) => {
    const t = tw.mesh;
    const p = { width: tw.ew, height: tw.eh, depth: tw.ed };
    const wp = new THREE.Vector3();
    t.getWorldPosition(wp);
    city.worldToLocal(wp);
    const topY = wp.y + p.height / 2;
    const glowM = mat(0x0c1626, { emissive: new THREE.Color(neonColors[i % 4]), emissiveIntensity: 1.1 });
    // vertical neon edge strips on two front corners
    for (const sx of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.18, p.height * 0.86, 0.18), glowM);
      strip.position.set(wp.x + sx * (p.width / 2 + 0.02), wp.y, wp.z - p.depth / 2 - 0.02);
      fx.add(strip);
    }
    // parapet crown + beacon
    bx(fx, { x: wp.x, y: topY + 0.25, z: wp.z, w: p.width + 0.5, h: 0.5, d: p.depth + 0.5, color: 0x131c2e });
    // lit window grids on ALL FOUR faces (no black boxes from any angle) — shared materials
    const wm = winMats[i % 3];
    for (const side of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(p.width * 0.92, p.height * 0.82), wm);
      win.position.set(wp.x, wp.y + p.height * 0.02, wp.z + side * (p.depth / 2 + 0.04));
      if (side === -1) win.rotation.y = Math.PI;
      fx.add(win);
      const winS = new THREE.Mesh(new THREE.PlaneGeometry(p.depth * 0.92, p.height * 0.82), wm);
      winS.position.set(wp.x + side * (p.width / 2 + 0.04), wp.y + p.height * 0.02, wp.z);
      winS.rotation.y = side * Math.PI / 2;
      fx.add(winS);
    }
    // horizontal floor-division band + illuminated lobby base
    bx(fx, { x: wp.x, y: wp.y, z: wp.z, w: p.width + 0.12, h: 0.3, d: p.depth + 0.12, color: 0x1b2740 });
    bx(fx, { x: wp.x, y: wp.y - p.height / 2 + 1.6, z: wp.z, w: p.width + 0.2, h: 0.25, d: p.depth + 0.2, color: 0x0c1626, m: mat(0x0c1626, { emissive: new THREE.Color(neonColors[(i + 1) % 4]), emissiveIntensity: 0.9 }) });
    // rooftop mechanical detail + antenna on some towers
    if (i % 2 === 0) bx(fx, { x: wp.x + p.width * 0.18, y: topY + 1.0, z: wp.z - p.depth * 0.15, w: p.width * 0.3, h: 1.4, d: p.depth * 0.3, color: 0x1a2438 });
    if (i % 4 === 1) bx(fx, { x: wp.x, y: topY + 2.2, z: wp.z, w: 0.14, h: 3.4, d: 0.14, color: 0x2a3648 });
    if (i % 3 === 0) {
      const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), glowM);
      beacon.position.set(wp.x, topY + 1.3, wp.z);
      fx.add(beacon);
    }
  });

  // ---- PHASE 7: STREET DETAIL PASS (Main Street x=-14, z 64..96) ----
  for (let z = 66; z <= 94; z += 9) {
    for (const side of [-1, 1]) {
      const lx = -14 + side * 4.6;
      bx(fx, { x: lx, y: 2.5, z, w: 0.16, h: 5, d: 0.16, color: 0x2a3648 });
      const arm = bx(fx, { x: lx - side * 0.75, y: 4.9, z, w: 1.5, h: 0.12, d: 0.12, color: 0x2a3648 });
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.3),
        mat(0x1a2438, { emissive: new THREE.Color(0xffe9b8), emissiveIntensity: 1.4 }));
      head.position.set(lx - side * 1.45, 4.84, z);
      fx.add(head);
      void arm;
    }
  }
  // crosswalk stripes at the riverwalk intersection
  for (let i = 0; i < 6; i += 1) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 3.4), mat(0xe8eef4, { roughness: 0.6 }));
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(-16.5 + i * 1.1, 0.03, 95.2);
    fx.add(stripe);
  }
  // benches + planters along Main Street
  for (const z of [70, 79, 88]) {
    for (const side of [-1, 1]) {
      const bxp = -14 + side * 5.6;
      bx(fx, { x: bxp, y: 0.3, z, w: 1.7, h: 0.12, d: 0.55, color: 0x8a6a44 });
      bx(fx, { x: bxp, y: 0.14, z, w: 1.5, h: 0.28, d: 0.4, color: 0x2a3648 });
      bx(fx, { x: bxp, y: 0.26, z: z + 2.2, w: 0.8, h: 0.52, d: 0.8, color: 0x37455c });
    }
  }

  // ---- DISTRICT GATEWAY SIGNAGE (reference-image language) ----
  gatewaySign(fx, { text: "REALMLIFE DOWNTOWN", sub: "SHOP. PLAY. EXPLORE.", x: -14, z: 64, w: 13, glow: "#39dfff" });
  neonPanel(fx, { text: "MAIN STREET", x: -8.6, y: 4.4, z: 80, w: 6.5, h: 1.6, ry: Math.PI / 2, glow: "#c084fc" });
  gatewaySign(fx, { text: "RIVERWALK", sub: "RELAX. SOCIALIZE. UNWIND.", x: 6, z: 96.4, w: 11, glow: "#5eead4" });
  gatewaySign(fx, { text: "REALMLIFE MARINA", sub: "SAIL. DOCK. DISCOVER.", x: 30, z: 99.5, w: 12, glow: "#60a5fa" });
  neonPanel(fx, { text: "NEXUS ARCADE", x: 24, y: 6.2, z: 82, w: 9, h: 2.0, glow: "#f472b6" });
  // rooftop brand screens
  neonPanel(fx, { text: "PLAY. CONNECT. BELONG.", x: -30, y: 9.4, z: 78, w: 14, h: 2.6, ry: 0.35, glow: "#39dfff" });
  neonPanel(fx, { text: "LEVEL UP TOGETHER", x: 12, y: 8.6, z: 70, w: 12, h: 2.4, ry: -0.3, glow: "#a3ff12" });
  neonPanel(fx, { text: "LIVE EVENTS DAILY", x: -2, y: 7.8, z: 112.5, w: 12, h: 2.4, ry: Math.PI, glow: "#fbbf24" });
  // PASS 2D additions
  gatewaySign(fx, { text: "NEXUS CENTRAL", sub: "PLAY. CONNECT. BELONG.", x: -14, z: 86, w: 12, glow: "#39dfff" });
  neonPanel(fx, { text: "NEXUS SPAWN ZONE", x: -14, y: 7.0, z: 58, w: 11, h: 2.2, ry: Math.PI, glow: "#a3ff12" });

  // ---- WATER POLISH: deep base + glossy top + neon reflection strips ----
  const deep = new THREE.Mesh(new THREE.PlaneGeometry(90, 10),
    mat(0x0b3346, { roughness: 0.9, metalness: 0.05 }));
  deep.rotation.x = -Math.PI / 2;
  deep.position.set(0, -0.02, 106);
  fx.add(deep);
  const gloss = new THREE.Mesh(new THREE.PlaneGeometry(90, 10),
    mat(0x1e6f92, { roughness: 0.08, metalness: 0.55, transparent: true, opacity: 0.55 }));
  gloss.rotation.x = -Math.PI / 2;
  gloss.position.set(0, 0.055, 106);
  fx.add(gloss);
  for (let i = 0; i < 7; i += 1) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(2.6 + (i % 3), 0.16),
      mat(0x0c2a33, { emissive: new THREE.Color(i % 2 ? 0x39dfff : 0xc084fc), emissiveIntensity: 0.8, transparent: true, opacity: 0.5 }));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(-36 + i * 12, 0.07, 103.4 + (i % 3));
    fx.add(strip);
  }

  // ---- MARINA: seawall, piers, boats ----
  bx(fx, { x: 0, y: 0.35, z: 100.9, w: 90, h: 0.7, d: 0.5, color: 0x9aa7b5 });
  for (const px of [16, 30, 44]) {
    bx(fx, { x: px, y: 0.28, z: 104.4, w: 1.6, h: 0.22, d: 6.4, color: 0xa8865f });
    for (const pz of [102.2, 104.4, 106.6]) {
      bx(fx, { x: px - 0.95, y: 0.5, z: pz, w: 0.16, h: 0.8, d: 0.16, color: 0x6e5236 });
      bx(fx, { x: px + 0.95, y: 0.5, z: pz, w: 0.16, h: 0.8, d: 0.16, color: 0x6e5236 });
    }
  }
  boat(fx, { x: 23, z: 105.4, len: 6.5, ry: 0.12 });
  boat(fx, { x: 37, z: 105.8, hull: 0xdfe8ee, trim: 0x7c3aed, len: 5.4, ry: -0.1 });
  boat(fx, { x: 9.5, z: 106.2, hull: 0xe8eef4, trim: 0x0e7490, len: 7.5, ry: 0.05 });
  // PASS 2E: more vessels (reused builder — small motorboat, sport boat, luxury yacht)
  boat(fx, { x: -6, z: 105.6, hull: 0xf5f7f9, trim: 0x334155, len: 4.2, ry: 0.2 });
  boat(fx, { x: -20, z: 106.4, hull: 0xe2ecf2, trim: 0xb45309, len: 6.0, ry: -0.15 });
  boat(fx, { x: -34, z: 105.2, hull: 0xffffff, trim: 0x0f766e, len: 10.5, ry: 0.06 });
  // dock lights on pier ends
  for (const px of [16, 30, 44, -6, -20]) {
    bx(fx, { x: px, y: 0.85, z: 107.4, w: 0.12, h: 1.3, d: 0.12, color: 0x2a3648 });
    bx(fx, { x: px, y: 1.55, z: 107.4, w: 0.26, h: 0.26, d: 0.26, color: 0x123c4a, m: mat(0x123c4a, { emissive: new THREE.Color(0xffe9b8), emissiveIntensity: 1.5 }) });
  }

  // ---- RIVERWALK PALMS + PLANTERS ----
  for (let i = 0; i < 8; i += 1) {
    const px = -38 + i * 11;
    palm(fx, px, 97.6, 0.9 + (i % 3) * 0.12);
    bx(fx, { x: px, y: 0.22, z: 97.6, w: 0.9, h: 0.44, d: 0.9, color: 0x37455c });
  }
  // glowing pathway edge along the riverwalk
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(90, 0.22),
    mat(0x0c2a33, { emissive: new THREE.Color(0x39dfff), emissiveIntensity: 1.0 }));
  edge.rotation.x = -Math.PI / 2;
  edge.position.set(0, 0.045, 96.6);
  fx.add(edge);

  return fx;
}
