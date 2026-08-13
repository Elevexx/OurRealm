# SPAWN ZONE ASSET AUDIT — 2026-06 (ZERO Meshy credits used; balance 4684 → 4684)

## Verdict per model (all 6 verified individually in isolated viewer /admin/nexus/model-test)
| slug | lib id | Meshy task id | idem key | bytes | tris | textures | verdict |
|---|---|---|---|---|---|---|---|
| canopy_ring | af24a26ae3c1 | 019ff813-8bff-7cb8-8c77-a47e4d8f04e6 | nx-city-canopy_ring-ref-v1 | 3.98MB | 957k | 5 | REAL+DETAILED. Was placed unrotated at y=24 (vertical hoop) + invisible collider bug. Now = 2 walk-through boulevard gate rings (m_canopy z=18, m_canopy2 z=-34, scale 24, no_collide) |
| tower_blue | da16590d1ca1 | 019ff816-47e1 | nx-city-tower_blue-ref-v1 | 1.26MB | 174k | 5 | REAL. Holographic blue panel tower |
| tower_green | 1286a8e47fdc | 019ff818-3bb8 | nx-city-tower_green-ref-v1 | 1.11MB | 121k | 5 | REAL. Green panel tower |
| orai_tower | 553432310253 | 019ff819-f0ea | nx-city-orai_tower-ref-v1 | 1.39MB | 235k | 5 | REAL. Spire w/ cyan lattice, at [0,3,-46] h26 |
| storefront | 7abaa4c65b7a | 019ff81c-1e3e | nx-city-storefront-ref-v1 | 4.96MB | 1.14M | 5 | REAL. Detailed 3-story terrace bldg. Moved from x=±58 → ±30 flanking boulevard, rot ±1.57 |
| portal_arch | ba5a9521e690 | 019ff81f-c4d0 | nx-city-portal_arch-ref-v1 | 2.25MB | 475k | 5 | REAL. Ornate neon gate at ±20, z=34/-2 h8 |
All URLs: 307 → signed R2 → 200 public. Files match checksums in asset_library.

## ROOT CAUSES found (models were fine; the pipeline was broken)
1. (historic) Draco decoder was fetched from www.gstatic.com — blocked in some networks → silent load hangs.
   FIX: decoder now self-hosted at /app/frontend/public/draco/ (NexusWorld + questLevel).
2. In-world fetch throughput collapses ~30x vs idle page (render loop + 300ms polling contention).
   All 8+ GLBs were requested SIMULTANEOUSLY → nothing ever finished (models 0/29 after 60s).
   FIX: priority queue in loadGLB — max 4 concurrent, nearest-to-spawn models first (priority 1+dist/50),
   avatar 3.5, motion pack 4, crowd rigs 6. Result: 29/29 loaded, avatarReady true.
3. Avatar runtime files are 16MB EACH (starter_f rigged + walk + run = 48MB) and monopolized the queue
   at priority 0. Deprioritized below city models. (Optimizing avatar derivs = avatar-phase work, not done.)
4. Every model entity pushed a collider → the old y=24 canopy created an invisible wall mid-boulevard.
   FIX: colliders only when pos.y<2 and !props.no_collide (backend prop whitelisted).
5. Wireframe-green loading placeholders → replaced with dark silhouette + 0.6s grow-in.
6. Bloom overexposure → UnrealBloomPass strength 0.32 radius 0.4 threshold 0.85, ring emissive 1.6→1.1,
   spawn pad recolored #1b7fae. Auto-disable bloom after 3s sustained <20fps + localStorage nexus_bloom=off.
   localStorage nexus_gfx=low → no shadows, 0.7 DPR (low-end/test devices).
7. Primitive green box trees (nc_v2_tc*/tr* 16 ents) → new 'tree' entity type (neon holo trees, 8 planted).

## What primitives each model replaces
storefront→nc_bld primitive slabs (done in v17), towers→nc_sky/nc_sup slabs, canopy→boulevard gates (new),
trees→box+pillar trees (v19). Remaining primitives: floors/platform/lanes/benches (allowed), crowd capsules
(rigged clones stream in last), procedural rings/signs (stylistic).

## Published state
v19 (147 ents). Rollback snapshots: v17, v18 in nexus_versions. Meshy credits this audit: 0.

## Proof shots (chat 2026-06): 6 isolated model closeups + in-world 29/29 loaded + bloom-on no-clipping.

## Honest gaps
- Storefront facade rotation (±1.57) not yet verified from side view.
- Rigged crowd clones load last (heavy 16MB rigs) — visual confirm pending on real GPU.
- Device matrix (393x852/430x932/tablet/1920) + real-device FPS still to run (spawn checklist).
- This container uses software GL (0.4-21fps); real devices will be far faster.

## PROPOSED single canary (NOT generated — awaiting founder approval)
One LOW-POLY RIGGED crowd citizen (~1-2MB, walk loop) — the only genuinely missing asset class:
current crowd rigs reuse 16MB starter avatars (too heavy to clone 18x on mobile).
