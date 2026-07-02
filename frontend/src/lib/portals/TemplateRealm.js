/**
 * OurRealm — Portals 1.4 · TemplateRealm
 * -----------------------------------------------------------------
 * A fully config-driven Realm. Every future Realm can be built by
 * supplying a plain JavaScript object to the TemplateRealm constructor
 * — no additional class definitions required — while still extending
 * the Realm base class and plugging into the existing PortalEngine.
 *
 * This class is intentionally scope-limited: it composes the SAME
 * primitives the hand-authored RainforestRealm (Portals 1.1) already
 * uses. It does NOT duplicate the WebXR runtime, the reticle, or the
 * hit-test pipeline (all of which live in PortalEngine).
 *
 * Config shape (all fields optional except `id`):
 *   {
 *     id                    — string  (registry key)
 *     metadata: {           — descriptive only, used by no runtime
 *       name, description, emoji
 *     },
 *     lighting: {
 *       hemi:    { skyColor, groundColor, intensity }
 *       dir:     { color, intensity, position: [x,y,z] }
 *       ambient: { color, intensity }               // optional 3rd
 *     },
 *     environment: {
 *       ground:  { color, radius, roughness }
 *       fog:     { color, near, far }               // scene fog
 *       river:   { color, length, width, position } // optional strip
 *     },
 *     spawn:  { position: [x,y,z], lookAt: [x,y,z] }
 *     portal: { position: [x,y,z], color, radius }  // exit-portal marker
 *     particles: [                                  // any # of systems
 *       { name, count, colour, size, radius, minY, maxY, speed }
 *     ],
 *     props: [                                      // simple placed props
 *       { kind: 'tree' | 'rock' | 'plant', position, scale?, colour? }
 *     ],
 *     ambientAudio: { url, volume }                 // reserved; deferred
 *     npcs:     [ … ]                               // reserved
 *     wildlife: [ … ]                               // reserved
 *   }
 *
 * Usage:
 *   import TemplateRealm from "./TemplateRealm";
 *   import rainforestConfig from "./realmTemplates/rainforest";
 *   const realm = new TemplateRealm(rainforestConfig);
 *
 *   // Or register in registry.js:
 *   const REALM_CLASSES = {
 *     ...,
 *     "rainforest-lite": () => new TemplateRealm(rainforestConfig),
 *   };
 */
import * as THREE from "three";
import Realm from "./Realm";

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

export class TemplateRealm extends Realm {
  constructor(config) {
    if (!config || !config.id) {
      throw new Error("TemplateRealm: config.id is required");
    }
    super(config.id);
    this.config          = config;
    this._particles      = [];      // { mesh, orbits, colour, speedMul }
    this._time           = 0;
    this._growStart      = null;
    this._portalCore     = null;
    this._namedGroups    = new Map(); // id → THREE.Object3D — future hooks
  }

  mount() {
    const cfg  = this.config;
    const root = this.root;
    root.visible = false;

    // ── Lighting ─────────────────────────────────────────────────
    const l = cfg.lighting || {};
    const hemi = new THREE.HemisphereLight(
      new THREE.Color(l.hemi?.skyColor    || 0xffffff),
      new THREE.Color(l.hemi?.groundColor || 0x223311),
      l.hemi?.intensity ?? 0.9,
    );
    root.add(hemi);
    if (l.dir) {
      const dir = new THREE.DirectionalLight(
        new THREE.Color(l.dir.color || 0xffffff),
        l.dir.intensity ?? 0.8,
      );
      const [dx, dy, dz] = l.dir.position || [1, 3, 1];
      dir.position.set(dx, dy, dz);
      root.add(dir);
    }
    if (l.ambient) {
      root.add(new THREE.AmbientLight(
        new THREE.Color(l.ambient.color || 0x334422),
        l.ambient.intensity ?? 0.3,
      ));
    }

    // ── Environment ──────────────────────────────────────────────
    const env = cfg.environment || {};
    // Ground disc
    const g = env.ground || {};
    const groundRadius = g.radius ?? 0.9;
    const groundGeo = new THREE.CircleGeometry(groundRadius, 48);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(g.color || 0x2f5d3a),
        roughness: g.roughness ?? 0.95,
      }),
    );
    ground.name = "template-ground";
    root.add(ground);
    this._namedGroups.set("ground", ground);

    // River (optional flat strip)
    if (env.river) {
      const r = env.river;
      const riverGeo = new THREE.PlaneGeometry(r.width ?? 0.16, r.length ?? 1.4);
      riverGeo.rotateX(-Math.PI / 2);
      const river = new THREE.Mesh(
        riverGeo,
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(r.color || 0x2b7bb9),
          transparent: true, opacity: 0.85,
          roughness: 0.15, metalness: 0.05,
        }),
      );
      const [rx, ry, rz] = r.position || [0, 0.001, 0];
      river.position.set(rx, ry, rz);
      river.name = "template-river";
      root.add(river);
      this._namedGroups.set("river", river);
    }

    // Scene-level fog goes on THREE.Scene — TemplateRealm doesn't own the
    // scene, so we expose the fog cfg via engine event later if needed.

    // ── Props ────────────────────────────────────────────────────
    for (const p of (cfg.props || [])) {
      const obj = this._buildProp(p);
      if (obj) {
        const [px, py, pz] = p.position || [0, 0, 0];
        obj.position.set(px, py, pz);
        if (p.rotationY != null) obj.rotation.y = p.rotationY;
        if (p.scale != null)     obj.scale.setScalar(p.scale);
        root.add(obj);
      }
    }

    // ── Portal marker (exit portal) ──────────────────────────────
    if (cfg.portal) {
      const p = cfg.portal;
      const portalGroup = new THREE.Group();
      portalGroup.name = "template-portal";
      const ringGeo = new THREE.TorusGeometry(p.radius ?? 0.12, 0.015, 12, 40);
      const ringMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(p.color || 0x86efac),
        transparent: true, opacity: 0.9,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      portalGroup.add(ring);
      // Inner glow disc
      const glowGeo = new THREE.CircleGeometry((p.radius ?? 0.12) * 0.85, 32);
      const glowMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(p.color || 0x86efac),
        transparent: true, opacity: 0.25, side: THREE.DoubleSide,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      portalGroup.add(glow);
      const [px, py, pz] = p.position || [0, 0.4, -0.6];
      portalGroup.position.set(px, py, pz);
      portalGroup.rotation.x = Math.PI / 2; // Face up so tapping lands.
      root.add(portalGroup);
      this._portalCore = portalGroup;
      this._namedGroups.set("portal", portalGroup);
    }

    // ── Particle systems ─────────────────────────────────────────
    for (const spec of (cfg.particles || [])) {
      const pts = this._buildParticleSystem(spec);
      if (pts) {
        this._particles.push(pts);
        root.add(pts.mesh);
        this._namedGroups.set(`particles:${spec.name || "unnamed"}`, pts.mesh);
      }
    }
  }

  onSurfacePlaced() {
    if (this.root) this.root.scale.setScalar(0.001);
    this._growStart = performance.now();
  }

  update(dt) {
    this._time += dt;

    // Smoothstep grow-in on placement.
    if (this._growStart) {
      const t = Math.min(1, (performance.now() - this._growStart) / 700);
      const s = t * t * (3 - 2 * t);
      this.root.scale.setScalar(s);
      if (t >= 1) this._growStart = null;
    }

    // Advance every particle system.
    for (const p of this._particles) {
      const arr = p.mesh.geometry.attributes.position.array;
      for (let i = 0; i < p.orbits.length; i++) {
        const o = p.orbits[i];
        o.angle += o.speed * dt;
        const ii = i * 3;
        arr[ii]     = Math.cos(o.angle) * o.radius;
        arr[ii + 1] = o.y + Math.sin(this._time * 2 + o.phase) * 0.05;
        arr[ii + 2] = Math.sin(o.angle) * o.radius;
      }
      p.mesh.geometry.attributes.position.needsUpdate = true;
      p.mesh.material.opacity = p.baseOpacity + Math.sin(this._time * 3) * 0.15;
    }

    // Portal marker gentle pulse.
    if (this._portalCore) {
      const s = 1 + Math.sin(this._time * 2.5) * 0.05;
      this._portalCore.scale.setScalar(s);
    }
  }

  // Hooks reserved for future NPC / wildlife AI, callable from
  // dev-console for testing.
  getNamedObject(key) { return this._namedGroups.get(key) || null; }

  // ── Prop builders ────────────────────────────────────────────
  _buildProp(spec) {
    switch (spec.kind) {
      case "tree":  return this._buildTree(spec);
      case "rock":  return this._buildRock(spec);
      case "plant": return this._buildPlant(spec);
      default:      return null;
    }
  }
  _buildTree(spec) {
    const g = new THREE.Group();
    const height   = spec.height   ?? 0.9;
    const trunkR   = spec.trunkR   ?? 0.04;
    const canopyR  = spec.canopyR  ?? 0.22;
    const trunkColour  = new THREE.Color(spec.trunkColour  || 0x5a3b22);
    const canopyColour = new THREE.Color(spec.canopyColour || 0x2f7a3a);

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(trunkR * 0.6, trunkR, height, 8),
      new THREE.MeshStandardMaterial({ color: trunkColour, roughness: 0.95 }),
    );
    trunk.position.y = height / 2;
    g.add(trunk);

    const canopyMat = new THREE.MeshStandardMaterial({
      color: canopyColour, roughness: 0.9, flatShading: true,
    });
    const blobCount = 3;
    for (let i = 0; i < blobCount; i++) {
      const blob = new THREE.Mesh(
        new THREE.IcosahedronGeometry(canopyR * rand(0.7, 1.0), 0),
        canopyMat,
      );
      blob.position.set(rand(-0.08, 0.08), height + rand(-0.05, 0.12), rand(-0.08, 0.08));
      g.add(blob);
    }
    return g;
  }
  _buildRock(spec) {
    const r = spec.size ?? 0.07;
    return new THREE.Mesh(
      new THREE.DodecahedronGeometry(r, 0),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(spec.colour || 0x3f3830),
        roughness: 0.9,
      }),
    );
  }
  _buildPlant(spec) {
    const g = new THREE.Group();
    const bladeCount = spec.blades ?? 5;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.colour || 0x22c55e),
      side: THREE.DoubleSide, roughness: 0.85, flatShading: true,
    });
    for (let i = 0; i < bladeCount; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.16), mat);
      m.rotation.y = (i / bladeCount) * TAU;
      m.rotation.x = -0.4;
      m.position.y = 0.06;
      g.add(m);
    }
    return g;
  }

  // ── Particle system builder ──────────────────────────────────
  _buildParticleSystem(spec) {
    const count = spec.count ?? 40;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const orbits = [];
    for (let i = 0; i < count; i++) {
      const radius = rand(0.15, spec.radius ?? 0.85);
      const angle  = rand(0, TAU);
      const y      = rand(spec.minY ?? 0.1, spec.maxY ?? 0.9);
      positions[i * 3]     = Math.cos(angle) * radius;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      orbits.push({
        angle, radius, y,
        phase: rand(0, TAU),
        speed: rand(0.15, spec.speed ?? 0.4) * (Math.random() < 0.5 ? -1 : 1),
      });
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(spec.colour || 0xd7ff9d),
      size: spec.size ?? 0.02,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Points(geo, mat);
    return { mesh, orbits, baseOpacity: 0.55 };
  }
}

export default TemplateRealm;
