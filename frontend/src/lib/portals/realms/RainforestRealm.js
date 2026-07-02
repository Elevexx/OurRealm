/**
 * OurRealm — Portals 1.1 · RainforestRealm
 * -----------------------------------------------------------------
 * The first real 3D Realm. Built with pure Three.js primitives — no
 * external GLTF models — so the entire experience ships with the JS
 * bundle and mounts instantly on-device.
 *
 * When the user taps a detected floor surface, this realm plants an
 * ~1.6m wide slice of Amazon jungle at that anchor:
 *   • Mossy ground disc
 *   • Rock/stump props
 *   • 12 procedural low-poly trees (trunk + rounded canopy)
 *   • Ferns / undergrowth
 *   • Firefly particle system that gently orbits
 *   • Three parrots that circle the canopy on independent paths
 *
 * update() drives all motion; every animation is delta-time based so
 * frame-rate differences don't warp the scene.
 */
import * as THREE from "three";
import Realm from "../Realm";

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

export class RainforestRealm extends Realm {
  constructor() {
    super("rainforest");
    // Runtime handles used by update().
    this.fireflies    = null;   // THREE.Points
    this.parrots      = [];     // { mesh, radius, y, speed, phase }
    this.canopyLeaves = [];     // { mesh, base, amp, phase, speed }
    this.time         = 0;
  }

  mount(engine) {
    const root = this.root;
    root.visible = false; // engine flips on when surface is placed

    // Ground disc — mossy dark green with subtle noise.
    const groundGeo = new THREE.CircleGeometry(0.9, 48);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2f5d3a, roughness: 0.95, metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.name = "rainforest-ground";
    root.add(ground);

    // Grass tufts — 40 tiny cones for texture.
    const grassGeo = new THREE.ConeGeometry(0.015, 0.05, 5);
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.9 });
    const grassMerged = new THREE.InstancedMesh(grassGeo, grassMat, 40);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 40; i++) {
      const r = Math.sqrt(Math.random()) * 0.85;
      const a = Math.random() * TAU;
      dummy.position.set(Math.cos(a) * r, 0.025, Math.sin(a) * r);
      dummy.rotation.y = Math.random() * TAU;
      dummy.updateMatrix();
      grassMerged.setMatrixAt(i, dummy.matrix);
    }
    grassMerged.instanceMatrix.needsUpdate = true;
    root.add(grassMerged);

    // Rocks — 4 small polygons.
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3f3830, roughness: 0.85 });
    for (let i = 0; i < 4; i++) {
      const rockGeo = new THREE.DodecahedronGeometry(rand(0.05, 0.09), 0);
      const rock = new THREE.Mesh(rockGeo, rockMat);
      const a = rand(0, TAU);
      const r = rand(0.35, 0.8);
      rock.position.set(Math.cos(a) * r, rand(0.02, 0.04), Math.sin(a) * r);
      rock.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
      root.add(rock);
    }

    // Trees — 12 procedural trees.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + rand(-0.15, 0.15);
      const r = rand(0.55, 0.85);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const tree = this._buildTree();
      tree.position.set(x, 0, z);
      tree.rotation.y = Math.random() * TAU;
      root.add(tree);
    }

    // Ferns — small flat leaves.
    for (let i = 0; i < 14; i++) {
      const fern = this._buildFern();
      const a = rand(0, TAU);
      const r = rand(0.1, 0.7);
      fern.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
      fern.rotation.y = rand(0, TAU);
      root.add(fern);
    }

    // Fireflies — 60 additive points.
    this.fireflies = this._buildFireflies(60, 0.9, 0.05, 0.85);
    root.add(this.fireflies);

    // Parrots — 3 birds circling above the canopy.
    for (let i = 0; i < 3; i++) {
      const parrot = this._buildParrot();
      const speed  = rand(0.4, 0.7) * (i % 2 === 0 ? 1 : -1);
      const radius = rand(0.55, 0.85);
      const y      = rand(0.9, 1.25);
      const phase  = (i / 3) * TAU;
      parrot.userData = { speed, radius, y, phase };
      root.add(parrot);
      this.parrots.push(parrot);
    }
  }

  onSurfacePlaced(_pose, _engine) {
    // Small "pop" animation could go here in a later polish pass.
    if (this.root) this.root.scale.setScalar(0.001);
    // Grow the realm from 0 → 1 over ~700ms in update().
    this._growStart = performance.now();
  }

  update(dt) {
    this.time += dt;

    // Grow-in animation after placement.
    if (this._growStart) {
      const t = Math.min(1, (performance.now() - this._growStart) / 700);
      const s = t * t * (3 - 2 * t); // smoothstep
      this.root.scale.setScalar(s);
      if (t >= 1) this._growStart = null;
    }

    // Firefly twinkle — advance the Points geometry angles.
    if (this.fireflies && this.fireflies.userData.orbits) {
      const positions = this.fireflies.geometry.attributes.position.array;
      const orbits    = this.fireflies.userData.orbits;
      for (let i = 0; i < orbits.length; i++) {
        const o = orbits[i];
        o.angle += o.speed * dt;
        const ii = i * 3;
        positions[ii]     = Math.cos(o.angle) * o.radius;
        positions[ii + 1] = o.y + Math.sin(this.time * 2 + o.phase) * 0.05;
        positions[ii + 2] = Math.sin(o.angle) * o.radius;
      }
      this.fireflies.geometry.attributes.position.needsUpdate = true;
      // Subtle brightness pulse.
      this.fireflies.material.opacity = 0.55 + Math.sin(this.time * 3) * 0.15;
    }

    // Parrots circling.
    for (const p of this.parrots) {
      const { speed, radius, y, phase } = p.userData;
      const a = this.time * speed + phase;
      p.position.set(Math.cos(a) * radius, y + Math.sin(this.time * 3 + phase) * 0.06, Math.sin(a) * radius);
      // Face tangent + gentle wing flap.
      p.rotation.y = -a + Math.PI / 2;
      const wingL = p.getObjectByName("wing-l");
      const wingR = p.getObjectByName("wing-r");
      const flap  = Math.sin(this.time * 12 + phase) * 0.6;
      if (wingL) wingL.rotation.z =  0.2 + flap;
      if (wingR) wingR.rotation.z = -0.2 - flap;
    }

    // Canopy sway.
    for (const l of this.canopyLeaves) {
      l.mesh.position.y = l.base + Math.sin(this.time * l.speed + l.phase) * l.amp;
      l.mesh.rotation.z = Math.sin(this.time * l.speed * 0.6 + l.phase) * 0.05;
    }
  }

  // ── Builders ─────────────────────────────────────────────────────
  _buildTree() {
    const g = new THREE.Group();
    const height   = rand(0.7, 1.15);
    const trunkR   = rand(0.03, 0.05);
    const canopyR  = rand(0.18, 0.28);

    const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.6, trunkR, height, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.95 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = height / 2;
    g.add(trunk);

    const canopyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.32 + rand(-0.02, 0.02), 0.55, 0.35 + rand(-0.05, 0.05)),
      roughness: 0.9,
      flatShading: true,
    });

    // 3-4 rounded blobs = fuller canopy.
    const blobCount = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < blobCount; i++) {
      const blobGeo = new THREE.IcosahedronGeometry(canopyR * rand(0.7, 1.0), 0);
      const blob = new THREE.Mesh(blobGeo, canopyMat);
      const yOff = height - 0.05 + rand(-0.05, 0.12);
      blob.position.set(rand(-0.08, 0.08), yOff, rand(-0.08, 0.08));
      g.add(blob);
      this.canopyLeaves.push({
        mesh: blob, base: blob.position.y,
        amp: rand(0.005, 0.015), speed: rand(1.2, 2.0), phase: rand(0, TAU),
      });
    }
    return g;
  }

  _buildFern() {
    const g = new THREE.Group();
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e, roughness: 0.85, side: THREE.DoubleSide, flatShading: true,
    });
    const bladeCount = 5;
    for (let i = 0; i < bladeCount; i++) {
      const geo = new THREE.PlaneGeometry(0.08, 0.16);
      const m = new THREE.Mesh(geo, leafMat);
      m.rotation.y = (i / bladeCount) * TAU;
      m.rotation.x = -0.4;
      m.position.y = 0.06;
      g.add(m);
    }
    return g;
  }

  _buildFireflies(count, spread, minY, maxY) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const orbits    = [];
    for (let i = 0; i < count; i++) {
      const radius = rand(0.15, spread);
      const angle  = rand(0, TAU);
      const y      = rand(minY, maxY);
      positions[i * 3]     = Math.cos(angle) * radius;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      orbits.push({ angle, radius, y, phase: rand(0, TAU), speed: rand(0.15, 0.45) * (Math.random() < 0.5 ? -1 : 1) });
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xd7ff9d,
      size: 0.02,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.userData.orbits = orbits;
    return pts;
  }

  _buildParrot() {
    const g = new THREE.Group();
    // Body — bright red, small ovoid.
    const bodyGeo = new THREE.SphereGeometry(0.045, 12, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.6 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.scale.set(1.4, 0.9, 0.9);
    g.add(body);

    // Head.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), bodyMat);
    head.position.set(0.06, 0.015, 0);
    g.add(head);

    // Beak.
    const beakGeo = new THREE.ConeGeometry(0.012, 0.03, 6);
    beakGeo.rotateZ(-Math.PI / 2);
    const beak = new THREE.Mesh(beakGeo, new THREE.MeshStandardMaterial({ color: 0xf9d34c }));
    beak.position.set(0.088, 0.015, 0);
    g.add(beak);

    // Wings — two planes; flapped in update().
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb, side: THREE.DoubleSide, roughness: 0.7,
    });
    const wingGeo = new THREE.PlaneGeometry(0.09, 0.045);
    const wingL = new THREE.Mesh(wingGeo, wingMat);
    wingL.name = "wing-l";
    wingL.position.set(-0.02, 0.02, 0.03);
    wingL.rotation.y = Math.PI / 2;
    g.add(wingL);
    const wingR = new THREE.Mesh(wingGeo, wingMat);
    wingR.name = "wing-r";
    wingR.position.set(-0.02, 0.02, -0.03);
    wingR.rotation.y = Math.PI / 2;
    g.add(wingR);

    // Tail — small yellow triangle.
    const tailGeo = new THREE.ConeGeometry(0.02, 0.05, 4);
    tailGeo.rotateZ(Math.PI / 2);
    const tail = new THREE.Mesh(tailGeo, new THREE.MeshStandardMaterial({ color: 0xfbbf24 }));
    tail.position.set(-0.07, 0.005, 0);
    g.add(tail);

    return g;
  }
}

export default RainforestRealm;
