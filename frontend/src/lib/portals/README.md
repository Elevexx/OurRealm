# OurRealm · Portals Architecture

> **Status (Feb 2026):** Portals 1.2 · Founder-only Development Hub.
> Public users see the Opening Soon page at `/portals` and cannot reach

## Portals 1.3 — Backend Persistence & Platform Foundation

Portals 1.3 replaces the browser-only sessionStorage overrides with a
proper backend collection so **every founder edit persists across
sessions and devices**, while retaining sessionStorage as an offline
fallback if the backend is unreachable.

### MongoDB collection: `portal_realm_overrides`

```
{
  realm_id:            "rainforest",
  notes:               "…free-form founder notes…",
  status:              "founder_preview",
  enabled:             true,
  version:             "1.1.0",
  platform_readiness:  {                             // 7 platform keys
    ios_arkit:          { supported, status, minimum_device_requirements,
                          unity_build_profile, deployment_path,
                          known_limitations, testing_status,
                          last_tested_at, notes },
    android_arcore:     {…},
    visionos:           {…},
    meta_quest:         {…},
    webxr:              {…},
    desktop_preview:    {…},
    mobile_non_ar_fallback: {…},
  },
  asset_scrolls: [
    { asset_scroll_id, name, category, status, supported_platforms,
      source_type, file_type, unity_prefab_path, web_asset_path,
      thumbnail, version, notes, approved_by, approved_at }
  ],
  unity_deployment: {
    unity_project_name, unity_scene_name, unity_build_target,
    unity_bundle_id, unity_version,
    asset_bundle_url, addressables_catalog_url, webgl_build_url,
    ios_build_status, android_build_status,
    visionos_build_status, quest_build_status,
    release_channel, deployment_notes
  },
  ar_vr_compatibility: {
    ar_supported, vr_supported, passthrough_ar_supported,
    hand_tracking_supported, controller_supported,
    minimum_ios_version, minimum_android_version,
    minimum_visionos_version, minimum_quest_firmware,
    webxr_features_used, known_incompatibilities
  },
  roadmap_notes,
  performance_notes,
  audit_history: [
    { at, by_id, by_username, field, action, before, after }
  ],
  updated_at, updated_by_id, updated_by_username, created_at
}
```

### Backend routes (all `require_admin(user)`)

| Method | Path                                                     | Purpose |
| ------ | -------------------------------------------------------- | ------- |
| GET    | `/api/admin/portals/overrides`                           | List every persisted override |
| GET    | `/api/admin/portals/{realm_id}/override`                 | Single realm's override |
| POST   | `/api/admin/portals/{realm_id}/notes`                    | Update free-form notes |
| POST   | `/api/admin/portals/{realm_id}/status`                   | Change realm status |
| POST   | `/api/admin/portals/{realm_id}/toggle`                   | Enable / disable |
| POST   | `/api/admin/portals/{realm_id}/platform-readiness`       | Merge one platform block |
| POST   | `/api/admin/portals/{realm_id}/asset-scrolls`            | Replace attached Asset Scrolls |
| POST   | `/api/admin/portals/{realm_id}/unity-deployment`         | Merge Unity metadata |
| POST   | `/api/admin/portals/{realm_id}/ar-vr-compatibility`      | Merge AR/VR capability block |
| POST   | `/api/admin/portals/{realm_id}/roadmap-notes`            | Update roadmap notes |
| POST   | `/api/admin/portals/{realm_id}/performance-notes`        | Update performance notes |
| DELETE | `/api/admin/portals/{realm_id}/override`                 | Reset to catalogue defaults |

Anonymous → **401**. Non-admin → **403**. Unknown realm id → **404**.
Every mutation appends to `audit_history` (last 200 entries kept).

### Frontend integration

- `/lib/portals/portalsApi.js` — one axios wrapper per endpoint. Every
  method returns `{ ok, override }` on success or `{ ok:false, detail }`
  on failure. Callers decide whether to fall back to sessionStorage.
- `/pages/AdminPortalsHub.jsx` — loads `/overrides` on mount, hydrates
  status/enabled from the backend, optimistic UI on Disable/Enable +
  server round-trip.
- `/pages/AdminPortalDetail.jsx` — hydrates the full override on mount,
  edits per-field with dedicated Save buttons + Loader/flash indicators
  and audit history panel.

### OurRealm Asset Scrolls foundation

Portals 1.3 ships the **schema + admin UI** but not the marketplace.
Each realm can attach any number of Asset Scroll references:

```
{
  asset_scroll_id:      "tree_amazon_001",
  name:                 "Kapok Tree",
  category:             "trees",
  status:               "approved",
  supported_platforms:  ["ar", "vr", "phone"],
  source_type:          "unity_prefab",  // or 'web', 'gltf', 'shader', …
  file_type:            "prefab",
  unity_prefab_path:    "Assets/Portals/Trees/KapokTree.prefab",
  web_asset_path:       "https://cdn.ourrealm.social/assets/kapok.glb",
  thumbnail:            "https://…",
  version:              "1.0.0",
  approved_by:          "stealth",
  approved_at:          "2026-02-07T…"
}
```

The founder can add / remove Asset Scrolls right from
`/admin/portals/:realmId`. When the marketplace ships (Portals 3.0),
these references just start pointing at real approved assets — the
schema is stable.

### AR / VR platform readiness

`platform_readiness` tracks 7 targets:

- `ios_arkit`
- `android_arcore`
- `visionos`
- `meta_quest`
- `webxr`
- `desktop_preview`
- `mobile_non_ar_fallback`

Each entry stores `supported`, `status`, `minimum_device_requirements`,
`build_target`, `unity_build_profile`, `deployment_path`,
`known_limitations`, `testing_status`, `last_tested_at`, `notes`.

### Unity deployment schema

Reserved fields on every realm so future Unity-built experiences drop
in without a schema migration: `unity_project_name`, `unity_scene_name`,
`unity_build_target`, `unity_bundle_id`, `unity_version`,
`asset_bundle_url`, `addressables_catalog_url`, `webgl_build_url`,
`ios_build_status`, `android_build_status`, `visionos_build_status`,
`quest_build_status`, `release_channel`, `deployment_notes`.

### How to prepare a Unity Realm for future deployment

1. Build the realm inside Unity with the target profile (ARKit / ARCore /
   visionOS / Quest / WebGL).
2. Fill in the Unity Deployment panel on `/admin/portals/:realmId` with
   the project name, scene name, build target, bundle id, and asset
   bundle URL.
3. Set the corresponding `platform_readiness.<platform>.status =
   "testing"` and paste the `unity_build_profile` name so QA knows what
   to run.
4. Once the build is verified, flip `platform_readiness.<platform>.supported = true`
   and change the realm status to `private_beta` (later `public_beta`,
   then `released`). Only `released` realms are ever visible to end-users.

### Security summary

- Public users hitting `/portals` → Opening Soon (unchanged).
- Public users hitting `/realms/portals/ar*` or `/realms/portals/vr` →
  redirected to `/portals` via `<PortalsAdminGate>`.
- Anonymous API traffic → **401** on every `/api/admin/portals/*` route.
- Non-admin API traffic → **403**.
- Every mutation writes an `audit_history` entry with user id + username.


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
