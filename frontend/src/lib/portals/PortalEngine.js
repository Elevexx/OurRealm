/**
 * OurRealm — Portals 1.1 · PortalEngine
 * -----------------------------------------------------------------
 * A reusable WebXR + Three.js runtime for Portals. Every Realm
 * (Rainforest, Aquarium, Cyberpunk, Fantasy, …) plugs into the SAME
 * engine: the engine owns the XR session, the scene, the camera, the
 * hit-test pipeline, the reticle, and the render loop. Realms only
 * own their own THREE.Group and lifecycle callbacks.
 *
 * Contract
 * --------
 *   const engine = new PortalEngine({ container, realm, onEvent });
 *   await engine.init();          // creates renderer/scene/camera
 *   const ok = await engine.startXR();  // requests immersive-ar session
 *   engine.dispose();             // full teardown
 *
 * Realm interface (see /lib/portals/Realm.js):
 *   • preload()                        — optional async
 *   • mount(engine)                    — engine.scene.add(realm.root)
 *   • onSurfacePlaced(matrix, engine)  — user tapped a detected plane
 *   • update(dt, xrFrame, engine)      — called every frame
 *   • unmount(engine)                  — release GPU resources
 *
 * The engine is intentionally framework-agnostic — no React inside.
 * The React page (PortalXRSession) just gives it a <div> and buttons.
 */
import * as THREE from "three";

const REQUIRED_FEATURES = ["hit-test"];
const OPTIONAL_FEATURES = ["dom-overlay", "light-estimation", "anchors"];

export class PortalEngine {
  constructor({ container, realm, onEvent, overlayEl = null }) {
    if (!container) throw new Error("PortalEngine: container is required");
    if (!realm)     throw new Error("PortalEngine: realm is required");
    this.container = container;
    this.realm     = realm;
    this.overlayEl = overlayEl;
    this.onEvent   = typeof onEvent === "function" ? onEvent : () => {};

    // three
    this.renderer  = null;
    this.scene     = null;
    this.camera    = null;
    this.clock     = new THREE.Clock();

    // xr state
    this.session               = null;
    this.refSpace              = null;    // 'local' reference space
    this.viewerSpace           = null;    // 'viewer' reference space
    this.hitTestSource         = null;
    this.reticle               = null;
    this.reticleVisible        = false;
    this._boundOnSelect        = null;
    this._boundOnSessionEnd    = null;

    this._placed               = false;   // realm already anchored?
    this._loopStarted          = false;
    this._disposed             = false;
  }

  // ── Static capability probe ──────────────────────────────────────
  static async probe() {
    const out = {
      hasNavXR: false,
      arSupported: false,
      hitTestFeature: true,   // required-feature-support isn't inspectable pre-session; assume true when arSupported
      reason: "",
    };
    if (typeof navigator === "undefined" || !navigator.xr) {
      out.reason = "navigator.xr not available";
      return out;
    }
    out.hasNavXR = true;
    try {
      out.arSupported = !!(await navigator.xr.isSessionSupported?.("immersive-ar"));
      if (!out.arSupported) out.reason = "immersive-ar unsupported (likely iOS Safari or desktop)";
    } catch (e) {
      out.reason = `probe threw: ${e?.message || e}`;
    }
    return out;
  }

  // ── Init (renderer, scene, camera) ───────────────────────────────
  async init() {
    if (this._disposed) return;

    // Renderer — alpha:true keeps camera passthrough visible behind Three.
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.xr.enabled = true;
    this.container.appendChild(renderer.domElement);
    renderer.domElement.style.width  = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    this.renderer = renderer;

    // Scene + camera. Camera pose is driven by WebXR when the session starts.
    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 40);

    // Neutral, realm-friendly lighting.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x223311, 0.9);
    const dir  = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(1, 3, 1);
    this.scene.add(hemi, dir);

    // Reticle — a green ring that snaps to detected surfaces.
    const ringGeom = new THREE.RingGeometry(0.09, 0.11, 32).rotateX(-Math.PI / 2);
    const ringMat  = new THREE.MeshBasicMaterial({
      color: 0x86efac, transparent: true, opacity: 0.9,
    });
    const reticle = new THREE.Mesh(ringGeom, ringMat);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    reticle.name = "portal-reticle";
    this.scene.add(reticle);
    this.reticle = reticle;

    // Resize handler (no-op inside an XR session, active only for the
    // rare non-XR canvas mode used by inspectors).
    this._onResize = () => this._resizeCanvas();
    window.addEventListener("resize", this._onResize);

    // Realm preload (asynchronous asset build if any).
    if (typeof this.realm.preload === "function") {
      await this.realm.preload(this);
    }
    // Mount the realm root but keep it hidden until surface-placed.
    if (typeof this.realm.mount === "function") {
      this.realm.mount(this);
    }
    if (this.realm.root) {
      this.realm.root.visible = false;
      if (!this.scene.children.includes(this.realm.root)) {
        this.scene.add(this.realm.root);
      }
    }

    this._emit("engine:init", { renderer: !!renderer, realm: this.realm?.id });
  }

  _resizeCanvas() {
    if (!this.renderer || !this.camera) return;
    const w = this.container.clientWidth  || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ── Start immersive-ar XR session ────────────────────────────────
  async startXR() {
    if (this._disposed) return false;
    if (!navigator.xr) { this._emit("xr:unavailable", { reason: "no navigator.xr" }); return false; }

    try {
      const initOpts = {
        requiredFeatures: REQUIRED_FEATURES,
        optionalFeatures: OPTIONAL_FEATURES,
      };
      if (this.overlayEl) {
        initOpts.optionalFeatures.push("dom-overlay");
        initOpts.domOverlay = { root: this.overlayEl };
      }
      const session = await navigator.xr.requestSession("immersive-ar", initOpts);
      this.session = session;

      await this.renderer.xr.setReferenceSpaceType("local");
      await this.renderer.xr.setSession(session);

      // Hit-test source anchored to the viewer.
      this.viewerSpace = await session.requestReferenceSpace("viewer");
      this.refSpace    = await session.requestReferenceSpace("local");
      this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });

      this._boundOnSelect = () => this._onSelect();
      this._boundOnSessionEnd = () => this._onSessionEnd();
      session.addEventListener("select", this._boundOnSelect);
      session.addEventListener("end", this._boundOnSessionEnd);

      this._startLoop();
      this._emit("xr:started", { features: REQUIRED_FEATURES });
      return true;
    } catch (e) {
      this._emit("xr:error", { message: e?.message || String(e) });
      return false;
    }
  }

  _startLoop() {
    if (this._loopStarted) return;
    this._loopStarted = true;
    this.renderer.setAnimationLoop((_, xrFrame) => this._frame(xrFrame));
  }

  _frame(xrFrame) {
    if (this._disposed) return;
    const dt = this.clock.getDelta();

    // Hit-test: update reticle when a surface is under the viewer's aim.
    if (xrFrame && this.hitTestSource && this.refSpace) {
      const hits = xrFrame.getHitTestResults(this.hitTestSource);
      if (hits.length > 0) {
        const pose = hits[0].getPose(this.refSpace);
        if (pose) {
          this.reticle.visible = !this._placed; // hide once realm is placed
          this.reticle.matrix.fromArray(pose.transform.matrix);
          if (!this.reticleVisible) {
            this.reticleVisible = true;
            this._emit("surface:detected", { });
          }
        }
      } else if (this.reticleVisible) {
        this.reticleVisible = false;
        this.reticle.visible = false;
        this._emit("surface:lost", { });
      }
    }

    // Realm update.
    if (this.realm && typeof this.realm.update === "function") {
      this.realm.update(dt, xrFrame, this);
    }

    this.renderer.render(this.scene, this.camera);
  }

  _onSelect() {
    if (this._placed) return;
    if (!this.reticle.visible) return;
    // Extract position + quaternion from the reticle matrix.
    const m = this.reticle.matrix;
    const pos  = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl  = new THREE.Vector3();
    m.decompose(pos, quat, scl);

    if (this.realm) {
      if (this.realm.root) {
        this.realm.root.position.copy(pos);
        this.realm.root.quaternion.copy(quat);
        this.realm.root.visible = true;
      }
      if (typeof this.realm.onSurfacePlaced === "function") {
        this.realm.onSurfacePlaced({ position: pos, quaternion: quat }, this);
      }
    }
    this._placed = true;
    this.reticle.visible = false;
    this._emit("surface:placed", { position: pos.toArray() });
  }

  _onSessionEnd() {
    this._emit("xr:ended", {});
    this.session = null;
    this.hitTestSource = null;
    this.viewerSpace = null;
    this.refSpace = null;
    this._placed = false;
    if (this.renderer) this.renderer.setAnimationLoop(null);
    this._loopStarted = false;
  }

  async endXR() {
    if (this.session) {
      try { await this.session.end(); } catch (_) { /* already ending */ }
    }
  }

  // ── Public helpers Realms can call ───────────────────────────────
  addToRealmRoot(obj3d) {
    if (this.realm?.root && obj3d) this.realm.root.add(obj3d);
  }

  isPlaced() { return this._placed; }

  // ── Teardown ─────────────────────────────────────────────────────
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    try { this.endXR(); } catch (_) { /* noop */ }
    if (this.realm && typeof this.realm.unmount === "function") {
      try { this.realm.unmount(this); } catch (_) { /* noop */ }
    }
    if (this._onResize) window.removeEventListener("resize", this._onResize);
    if (this.renderer) {
      try {
        this.renderer.setAnimationLoop(null);
        this.renderer.dispose();
        if (this.renderer.domElement?.parentNode) {
          this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
      } catch (_) { /* noop */ }
      this.renderer = null;
    }
    // Traverse scene to dispose geometries + materials.
    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.geometry?.dispose) obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => { if (m?.dispose) m.dispose(); });
      });
      this.scene = null;
    }
  }

  _emit(type, payload) {
    try { this.onEvent({ type, ...payload }); } catch (_) { /* noop */ }
  }
}

export default PortalEngine;
