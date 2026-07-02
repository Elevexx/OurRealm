/**
 * OurRealm — Portals 1.2 · Placeholder Realm
 * -----------------------------------------------------------------
 * Renders a stylised placeholder scene when a Realm has metadata but
 * no gameplay class registered yet. This lets the founder LAUNCH
 * any Realm from the Dev Hub and still see something meaningful —
 * essential when planning content pipelines for 12+ realms.
 *
 * The placeholder shows:
 *   • A neon-outlined obelisk in the realm's accent colour
 *   • Orbiting glyph particles (colour = accent)
 *   • Soft ground disc
 */
import * as THREE from "three";
import Realm from "./Realm";

export class PlaceholderRealm extends Realm {
  constructor(meta) {
    super(meta?.id || "placeholder");
    this.meta = meta || { name: "Realm", accent: "#22c55e", secondary: "#86efac" };
    this.orbits = [];
    this.time = 0;
  }

  mount() {
    const accent    = new THREE.Color(this.meta.accent || "#22c55e");
    const secondary = new THREE.Color(this.meta.secondary || "#86efac");

    // Ground disc.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 40).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: accent.clone().multiplyScalar(0.25),
        roughness: 0.85,
      }),
    );
    this.root.add(ground);

    // Obelisk — tall thin pyramid.
    const obeliskGeom = new THREE.CylinderGeometry(0.02, 0.09, 0.65, 4);
    const obeliskMat  = new THREE.MeshStandardMaterial({
      color: accent, emissive: accent.clone().multiplyScalar(0.3), roughness: 0.4, metalness: 0.25,
    });
    const obelisk = new THREE.Mesh(obeliskGeom, obeliskMat);
    obelisk.position.y = 0.34;
    obelisk.name = "placeholder-obelisk";
    this.root.add(obelisk);

    // Glowing tip.
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 12, 8),
      new THREE.MeshBasicMaterial({ color: secondary, transparent: true, opacity: 0.9 }),
    );
    tip.position.y = 0.75;
    this.root.add(tip);
    this._tip = tip;

    // Orbiting glyph particles.
    const orbitCount = 18;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(orbitCount * 3);
    for (let i = 0; i < orbitCount; i++) {
      const radius = 0.28 + Math.random() * 0.28;
      const angle  = (i / orbitCount) * Math.PI * 2;
      const y      = 0.15 + Math.random() * 0.6;
      positions[i * 3]     = Math.cos(angle) * radius;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      this.orbits.push({ angle, radius, y, speed: 0.3 + Math.random() * 0.6 });
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: secondary, size: 0.03, transparent: true, opacity: 0.85,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this._particles = pts;
    this.root.add(pts);
  }

  onSurfacePlaced() {
    if (this.root) this.root.scale.setScalar(0.001);
    this._growStart = performance.now();
  }

  update(dt) {
    this.time += dt;
    // Grow-in.
    if (this._growStart) {
      const t = Math.min(1, (performance.now() - this._growStart) / 600);
      const s = t * t * (3 - 2 * t);
      this.root.scale.setScalar(s);
      if (t >= 1) this._growStart = null;
    }
    // Orbit particles.
    if (this._particles) {
      const arr = this._particles.geometry.attributes.position.array;
      for (let i = 0; i < this.orbits.length; i++) {
        const o = this.orbits[i];
        o.angle += o.speed * dt;
        const ii = i * 3;
        arr[ii]     = Math.cos(o.angle) * o.radius;
        arr[ii + 1] = o.y + Math.sin(this.time * 2 + i) * 0.03;
        arr[ii + 2] = Math.sin(o.angle) * o.radius;
      }
      this._particles.geometry.attributes.position.needsUpdate = true;
    }
    // Tip pulse.
    if (this._tip) {
      const s = 1 + Math.sin(this.time * 3) * 0.12;
      this._tip.scale.setScalar(s);
    }
  }
}

export default PlaceholderRealm;
