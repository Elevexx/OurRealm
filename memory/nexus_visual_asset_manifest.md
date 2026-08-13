# NEXUS VISUAL ASSET MANIFEST — vs FOUNDER MASTER GAMEPLAY REFERENCE
Reference: /app/memory/nexus_master_references.md (Reference B image = binding target)
Statuses: WORKING | NEEDS-REPAIR | IN-ENGINE | NEEDS-MODULAR-ASSET | NEEDS-PAID-GEN | INTEGRATED-VERIFIED | FOUNDER-APPROVED

## World / architecture
| Reference element | Status | Notes |
|---|---|---|
| Large central overhead canopy | INTEGRATED-VERIFIED (as gates) / NEEDS-REPAIR (overhead placement) | canopy_ring model real; used as 2 boulevard gates; reference wants overhead stadium canopy → needs renderer X-rotation support or dedicated placement pass |
| Central ORAi AI Core tower | INTEGRATED-VERIFIED | orai_tower at boulevard end; hologram head/panel = IN-ENGINE (holographic sign panel planned) |
| ORAi hologram + "AI CORE ONLINE" display | IN-ENGINE | build with emissive panel + sign entity (zero credit) |
| Blue hero tower | INTEGRATED-VERIFIED | tower_blue |
| Green hero tower | INTEGRATED-VERIFIED | tower_green |
| Background skyscraper family / deep skyline | INTEGRATED (v22: 6 placements m_b2_sky0-5) — verify on real GPU |
| Multi-level terraces + storefronts | INTEGRATED-VERIFIED (storefront model ±30) + NEEDS-MODULAR-ASSET for more variation |
| Elevated bridges / balconies | INTEGRATED (v22: circular skywalks m_b2_bridge0/1 at ±34, model is ring-shaped — placed as side skywalks) |
| Reflective central boulevard w/ blue/white/green path lighting | WORKING (in-engine lanes + reflective ground); white center dashed strip = IN-ENGINE todo |
| Trees / planters / landscaping | WORKING (in-engine neon holo trees x8); more variation IN-ENGINE |
| Multiple colored Realm portals | WORKING (4 portal rings + portal_arch models) |
| Business Realm flying structure | INTEGRATED (v22: m_b2_bship at -46,24,8) |
| Gaming Realm flying structure | INTEGRATED (v22: m_b2_gship at 46,24,8) |
| Flying vehicles | INTEGRATED (v22: 3 static m_b2_fv0-2; flight animation = IN-ENGINE todo) + traffic streaks WORKING |
| Holographic signage/billboards | WORKING (sign entities: GAMING REALM / BUSINESS REALM etc); richer displays IN-ENGINE |
| NEXUS SPAWN ZONE sky title | IN-ENGINE (sign entity, optional) |
| Living crowds | INTEGRATED-VERIFIED (v24): citizen v2 GENERATED (A-pose prompt, remesh 40k, rig+walk OK; task nx-cz2-* chain; LOD0 2.0MB/41.5k tris, LOD1 606KB, LOD2 203KB, walk 756KB). Crowd rigs = [citizen LOD1 + walk, starter_f] w/ HSL clothing variations + staggered timing, 18 rigged + instanced capsule far-fill. Distant impostor tier = PENDING |
| White boulevard center strip | INTEGRATED (v22: nc_strip0-13) |
| Star field / night sky depth | WORKING (gradient dome + 700 stars) |
| Player avatar scale/camera | WORKING (third-person, pitch clamped, anti-clip) |

## Mobile HUD (Reference B bottom-to-top)
| Element | Status |
|---|---|
| Glass EXIT pill w/ back arrow | WORKING (rebuilt, lucide ArrowLeft, states+aria) |
| NEXUS CENTRAL pill + green dot + REAL online | WORKING (real count, never hardcoded) |
| Map button (map icon) → real minimap | WORKING |
| Settings gear | WORKING |
| Reticle recenter | WORKING (Crosshair icon) |
| JUMP circle w/ up arrow | WORKING |
| INTERACT circle w/ hand icon | WORKING |
| Joystick: ring + 4 chevrons + glowing cyan thumb | WORKING (thumb tracks touch) |
| Chat button | WORKING |
| Reaction/smiley button | WORKING (sends real chat reactions) |
| Microphone | BLOCKING GAP — behind feature flag nexus_voice (OFF). Real proximity voice NOT implemented yet. Reported as blocking final approval per founder rule |
| Contextual Realm card w/ icon + green ENTER | WORKING (near portals) |

## NAVS status
- Masters immutable w/ checksums+task IDs in asset_library ✓
- LOD1 (optimized runtime) ✓; LOD2/LOD3 generation script (nexus_navs_lods.py) ✓; distant-first streaming + late hero upgrade ✓
- Draco chosen (self-hosted /draco/); meshopt/KTX2-Basis = PENDING (phase 2)
- Priority queue (4 concurrent, nearest-first) ✓; content-hash cached URLs ✓
- Adaptive tiers low/med/high/ultra via 4s real benchmark + hysteresis (8s cooldown) ✓
- Impostor/billboard LOD, occlusion culling, animation-keyframe compression = PENDING

## Instance Director / Realms / voice / NPC Machine
NOT STARTED this checkpoint (next in execution order). NPC Machine = separate later phase.
