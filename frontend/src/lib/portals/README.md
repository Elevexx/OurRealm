# OurRealm · Portals Architecture

> **Status (Feb 2026):** Portals 1.2 · Founder-only Development Hub.
> Public users see the Opening Soon page at `/portals` and cannot reach
> any unfinished Realm.

## Directory Layout

```
frontend/src/lib/portals/
├── PortalEngine.js          # Three.js + WebXR runtime (framework-agnostic)
├── Realm.js                 # Base class every Realm extends
├── PlaceholderRealm.js      # Fallback scene used for metadata-only Realms
├── realmMetadata.js         # Rich catalogue of every Realm (12 entries today)
├── registry.js              # id → gameplay class map + createRealm()/listRealmIds()
└── realms/
    └── RainforestRealm.js   # First real 3D Realm (procedural Amazon slice)

frontend/src/pages/
├── PortalsHub.jsx           # Public "Opening Soon" hub — NEVER exposes unfinished content
├── PortalAR.jsx             # Preview overlay page (Founder-gated)
├── PortalXRSession.jsx      # Real WebXR immersive-ar page (Founder-gated)
├── PortalVR.jsx             # VR placeholder (Founder-gated)
├── AdminPortalsHub.jsx      # /admin/portals — Founder Dev Hub
└── AdminPortalDetail.jsx    # /admin/portals/:realmId — metadata inspector + notes
```

## Public vs Founder Surface

| Route                                  | Access   | Purpose                                  |
| -------------------------------------- | -------- | ---------------------------------------- |
| `/portals`                             | Public   | Opening Soon teaser (vortex + Notify Me) |
| `/realms/portals/ar`                   | Founder  | Camera-passthrough Preview Overlay       |
| `/realms/portals/ar/xr?realm=<id>`     | Founder  | Real WebXR immersive-ar session          |
| `/realms/portals/vr`                   | Founder  | VR placeholder                            |
| `/admin/portals`                       | Founder  | Portal Development Hub                   |
| `/admin/portals/:realmId`              | Founder  | Realm detail / notes editor              |

The gate is `isAdmin(user)` from `@/lib/isAdmin` (founder + `role === admin`
+ well-known admin usernames). Non-admins visiting `/realms/portals/*` are
redirected to `/portals` (Opening Soon).

## Adding a New Realm

### 1. Metadata

Add a new entry to `REALM_METADATA` in `realmMetadata.js`:

```js
{
  id: "aquarium",
  name: "Aquarium",
  emoji: "🌊",
  description: "Coral reef with schools of fish, kelp columns and caustics.",
  thumbnail: "linear-gradient(135deg, #082f49 0%, #0284c7 50%, #22d3ee 100%)",
  accent: "#06b6d4",
  secondary: "#67e8f9",
  supportedPlatforms: ["ar", "vr", "phone", "tablet"],
  requiredCapabilities: ["webxr:immersive-ar", "webxr:hit-test"],
  version: "0.1.0",
  status: REALM_STATUS.DRAFT,
  lastUpdated: "2026-02-07",
  audioProfile: "ambient",
  lightingProfile: "underwater",
  weatherProfile: "none",
  performanceLevel: "medium",
  tags: ["nature", "water"],
  hasGameplay: false,
}
```

The Realm is now visible in `/admin/portals` and can be Launched — it will
run `PlaceholderRealm` (a small obelisk + orbit particles) until you build
the real gameplay class.

### 2. Gameplay class (optional)

Create `/lib/portals/realms/AquariumRealm.js`:

```js
import Realm from "../Realm";
export class AquariumRealm extends Realm {
  constructor() { super("aquarium"); }
  mount(engine)                { /* add fish, kelp, caustics to this.root */ }
  onSurfacePlaced(pose, engine){ /* anchor logic */ }
  update(dt)                   { /* per-frame animation */ }
}
export default AquariumRealm;
```

Then register it in `registry.js`:

```js
import AquariumRealm from "./realms/AquariumRealm";

const REALM_CLASSES = {
  rainforest: RainforestRealm,
  aquarium:   AquariumRealm,
};
```

Set `hasGameplay: true` on the metadata entry and bump the version.

### 3. Graduate to public

Change `status` to `REALM_STATUS.RELEASED` on the metadata entry. The
future Portal Selector (Portals 1.4+) will pick it up automatically via
`listPublicRealms()`.

## PortalEngine Contract

```
const engine = new PortalEngine({ container, realm, onEvent, overlayEl });
await engine.init();          // build Three.js scene, mount realm.root
await engine.startXR();       // request immersive-ar session
engine.dispose();             // full teardown
```

Events emitted through `onEvent({ type, ... })`:

- `engine:init`
- `xr:started` · `xr:ended` · `xr:error` · `xr:unavailable`
- `surface:detected` · `surface:lost` · `surface:placed`

The engine owns:
- Renderer, scene, camera
- Reference spaces (`local`, `viewer`)
- Hit-test source + green reticle
- Render loop (`renderer.setAnimationLoop`)
- Full GPU disposal on `dispose()`

## Realm Lifecycle

```
new Realm(id)
  → preload(engine)            (async, optional)
  → mount(engine)              (add THREE objects to this.root)
  → onSurfacePlaced(pose, engine)  (called when user taps a detected plane)
  → update(dt, xrFrame, engine)    (per-frame)
  → unmount(engine)            (base class disposes all descendants)
```

## Performance Guidelines

Each Realm should aim for:
- ≤ 30k triangles on screen at once (mobile AR budget)
- ≤ 6 draw calls per prop group — use `InstancedMesh` for grass / crowds
- Additive Points systems for particle FX (no billboarded quads)
- All animations `transform`/`opacity` only (no layout thrash in overlays)
- `respectsReducedMotion: true` in the metadata

Optimisation techniques the engine will progressively adopt:

- GPU Instancing (already used for Rainforest grass)
- LOD swapping via `THREE.LOD` (Portals 1.3)
- Frustum culling (default in Three.js)
- Object pooling for creature spawners (Portals 1.3)
- Texture streaming for high-detail realms (Portals 2.0)
- Low-end device fallback via `performanceLevel === 'low'` in the metadata

## Public Portal Selector (Future)

Portals 1.4+ will replace the Opening Soon page with a real selector.
The selector will read `listPublicRealms()` and expose sections:

- Featured Portals · Popular · Nearby · Friends · Favorites
- Search · Categories · Newest · Recently Visited · Trending · Continue Watching

All backing metadata is already reserved on `REALM_METADATA` — the UI just
hasn't shipped yet.

## Roadmap

| Phase | Focus |
| ----- | ----- |
| **1.0** | Opening Soon (`/portals`) ✅ |
| **1.1** | Real WebXR + Rainforest gameplay ✅ |
| **1.2** | Founder Dev Hub + rich metadata for 12 Realms ✅ |
| **1.3** | Second playable Realm (Aquarium) + object pooling + LOD + dynamic weather |
| **1.4** | Public Portal Selector (Featured / Search / Categories) |
| **2.0** | Cloud Anchors · shared multiplayer sessions · voice chat |
| **2.5** | Portal Transitions between adjacent Realms · quest system |
| **3.0** | Creator-built Realms (marketplace) · seasonal events · reputation integration |
