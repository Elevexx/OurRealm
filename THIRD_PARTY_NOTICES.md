# THIRD PARTY NOTICES — OurRealm / Nexus (NAVS orchestration layer)

NAVS (Nexus Adaptive Visual Streaming) is OurRealm's proprietary orchestration layer built on the
following proven open technologies. OurRealm does not claim authorship of these projects.

## three (^0.185.1) — MIT License
Copyright © 2010-2026 three.js authors. https://github.com/mrdoob/three.js
Used for WebGL rendering, GLTFLoader, DRACOLoader, postprocessing (EffectComposer, UnrealBloomPass).

## Draco 3D Data Compression — Apache License 2.0
Copyright 2017 The Draco Authors. https://github.com/google/draco
Decoder (draco_decoder.js / draco_decoder.wasm / draco_wasm_wrapper.js) self-hosted at
/app/frontend/public/draco/ — redistributed unmodified from the three.js distribution.

## @gltf-transform/cli (4.x) — MIT License
Copyright © Don McCurdy. https://github.com/donmccurdy/glTF-Transform
Used offline (build pipeline only) for mesh simplification, texture resizing, Draco compression.

## meshoptimizer / MeshoptSimplifier — MIT License
Copyright © 2016-2026 Arseny Kapoulkine. https://github.com/zeux/meshoptimizer
Used transitively by glTF-Transform's simplify() in the offline pipeline. Meshopt runtime encoding
and KTX2/Basis Universal (KTX-Software, Binomial LLC — Apache 2.0) are planned; when shipped, their
notices will be added here for the exact versions used.

## lucide-react — ISC License
Copyright © Lucide Contributors. https://lucide.dev — HUD icon set.

## Meshy (https://www.meshy.ai) — commercial API
3D asset generation provider. Task IDs, plan/license status recorded per asset in `asset_library`
(fields: provider, meshy_task_id, license). Assets generated under the workspace's paid Meshy plan
are private/commercial-use per Meshy's paid-plan terms; any free-plan asset requiring CC BY 4.0
attribution must be flagged in `asset_library.license` and attributed in-app.

Modifications notice: OurRealm ships unmodified copies of the above libraries; only configuration
and orchestration code (NAVS) is original OurRealm work.
