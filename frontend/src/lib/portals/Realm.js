/**
 * OurRealm — Portals 1.1 · Realm base class
 * -----------------------------------------------------------------
 * Every Portal experience (Rainforest, Aquarium, Cyberpunk, Fantasy…)
 * extends this class. PortalEngine drives the lifecycle; the realm
 * builds its own THREE.Group and animates it.
 *
 *   class MyRealm extends Realm {
 *     constructor() { super("my-realm"); }
 *     async preload(engine)                 { … }   // optional
 *     mount(engine)                         { this.root.add(myThings); }
 *     onSurfacePlaced(pose, engine)         { … }
 *     update(dt, xrFrame, engine)           { … }
 *     unmount(engine)                       { … }
 *   }
 *
 * The base class handles:
 *   • allocating this.root (THREE.Group)
 *   • disposing all descendants on unmount
 */
import * as THREE from "three";

export class Realm {
  constructor(id) {
    if (!id) throw new Error("Realm: id is required");
    this.id = id;
    this.root = new THREE.Group();
    this.root.name = `realm:${id}`;
  }

  // Subclasses override. Defaults are no-ops so an "empty realm" is legal.
  async preload(_engine)                { /* override */ }
  mount(_engine)                        { /* override */ }
  onSurfacePlaced(_pose, _engine)       { /* override */ }
  update(_dt, _xrFrame, _engine)        { /* override */ }

  unmount(engine) {
    // Traverse root, dispose geometry/material, detach.
    if (!this.root) return;
    this.root.traverse((obj) => {
      if (obj.geometry?.dispose) obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => { if (m?.dispose) m.dispose(); });
    });
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

export default Realm;
