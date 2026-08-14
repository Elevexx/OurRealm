# OurRealm — PRD (UPDATED 2026-06 — V33 VISUALS RELEASE COMPLETE, REPUBLISH READY)

## RESUME CHECKPOINT — nexus-v33-visuals (REPUBLISH READY — FOUNDER CLICKS REPUBLISH, latest)
- V33 FOUNDER DIRECTIVE (Unity visibility + original gamemaker art + AAA avatar thumbnails) DONE,
  TESTED (iteration_151: backend 10/10 pytest PASS, frontend all core flows + post-equip fix
  self-verified), deployment_agent PASS. ZERO Meshy credits spent (balance 3,505).
- 1) UNITY TOOLS: /admin/nexus topbar now ALWAYS shows ASSET MANAGER (→/admin/nexus/assets) +
  UNITY BUILDS (→/admin/nexus/assets?sec=unity) buttons (nexus-topbar-asset-manager /
  nexus-topbar-unity-builds); AdminNexusAssets reads ?sec=unity, Unity section headed
  "UNITY WEB BUILD IMPORTER & PREVIEW" (unity-importer-header, explicitly NOT a source editor).
  Access: founder 200 / member 403 ("Founder only.") / anon 401 on all /api/nexus/assets/*.
  Full V30 asset manager (resumable uploader, 3D inspector, Avatar Studio, Unity ZIP importer,
  staging, Magic Loops) intact — no rollback of later Nexus work.
- 2) GAMEMAKER ART: Card 6 CARD BATTLE = new ORIGINAL OurRealm cosmic arena key-art (generated,
  no third-party trade dress); 3D OPEN WORLD card restored at zero generation cost. Both
  re-hosted durable R2 content-hashed /api/media/images/*.webp with 512/1024/2048 WebP+AVIF
  derivatives + 7680px masters; GameMakerPage IMG/IMG_SET srcSet — mobile loads 512.
- 3) SIX PREMIUM AVATAR PORTRAITS: deterministic studio renders from each avatar's EXACT GLB
  (three.js + SwiftShader headless via /tmp harness pattern; harness: scripts kept at
  /app/backend/scripts/nexus_v33_images.py, renders were /tmp/v33). Three-quarter hero framing,
  ry=35, idle-clip pose t=0.4, dark Nexus studio bg (NO transparency checkerboard), own-equipment
  only (wizard staff fully inside own image, no sprite-sheet bleed). 7680px masters + w512/w1024/
  w2048 WebP + AVIF derivatives, all DURABLE R2. DB: nexus_avatars.thumb=w1024, thumbs{...,master8k}.
  AvatarCollection uses srcSet+sizes (mobile gets 512); public /nexus/av_*.webp replaced with new 512s.
- 4) YOUR AVATAR CARD: fixed /nexus/av_av_* 404 bug — now myAvatar.thumbs.w512 > thumb > bundled;
  dark SVG silhouette fallback (never an initial letter). previewAvatarId (bodyPick, init null)
  fully separate from equippedAvatarId: premium equipped → LIVE PREVIEW shows the equipped premium,
  NO auto Ninja highlight; browsing never equips; equip updates card+summary+live preview+ring
  WITHOUT reload (onEquipped(id) resets bodyPick + refetches avInfo); persists after reload.
- 5) RELEASE: nexus-v33-visuals v33, manifest 188/188 DURABLE (56 image files merged from
  /app/backend/release/nexus_v33_images.json with sha256/dims/mime/avatar-or-game id), idempotent
  startup migration applies avatar thumb docs in production on Republish boot. /api/nexus/public
  returns nexus-v33-visuals. deployment_agent PASS.
- KNOWN QUIRK: duplicate data-testid avatar-preview-state (starter LIVE PREVIEW + collection
  dialog) — documented, tests filter by ancestor. nexus-my-avatar-name testid absent (minor).
- FILE-EDIT CORRUPTION WATCH: three files (NexusWorld.jsx, AdminNexusAssets.jsx, NexusPage.jsx)
  had stray duplicated tail fragments from earlier session edits — all cleaned; babel-parse all
  edited JSX after bulk edits to catch this.
- DEFERRED (do NOT start unprompted): Unity runtime bridge, ORAi prompt reference generator,
  malware scanner interface, voice foundation / NPC machine.

## PREVIOUS CHECKPOINT — nexus-v32-final (deployed to production)
- ALL SIX V32 DIRECTIVES DONE, TESTED (iteration_150: backend 9/9 pytest PASS, frontend E2E 100%),
  deployment_agent PASS. ZERO Meshy credits spent (balance stays 3,505).
- 1) LEGACY STREETWEAR STARTERS: starter_m/starter_f/av_d5b60b3e stay archived + excluded from
  /api/nexus/avatars, /avatars/collection, release manifest. Gender-preserving user migration in
  services/nexus_release.py (starter_f→av_ninja_f, starter_m/av_d5b60b3e→av_ninja, lime glow) runs
  idempotently at startup in every env keyed by release_id nexus-v32-final. av_ninja is_default.
- 2) WALK ANIMATION FIXED (ZERO CREDIT): root cause = walk clip was Meshy action_id 1
  "Walking_Woman" (catwalk crossover) + 5.5 m/s walk speed vs ~1.3 m/s clip stride = severe
  foot-slide "drift". Fix: scripts/v32_walk_retarget.js (node, gltf-transform) transplanted the
  archived starter's natural "walking_man" forward clip onto all 8 rigs by bone name — kept each
  avatar's OWN bone-length translation tracks (no proportion distortion), rebased hips bob to each
  avatar's mean, FK-solved hips-Y offset so toe ground contact exactly matches the old clip.
  Verified analytically via scripts/v32_walk_fk.js (stride along +Z, matches known-good run axis).
  Applied by scripts/nexus_v32_apply.py (store→R2, animation_urls.walk swap, walk_prev kept for
  rollback, audit doc id v32-walk-retarget, ledger /app/artifacts/nexus/v32_ledger.json).
  NexusWorld pacing: walk timescale 1.25→1.6, walk speed 5.5→4.6 (run 9.5/1.15 UNTOUCHED).
- 3) PREMIUM PREVIEW/EQUIP: v31 AvatarPreview (LOADING: NAME → PREVIEWING, LOAD FAILED+RETRY, no
  ninja substitution) re-verified; SELECT saves exact ID; glow picker exists ONLY for starter
  ninjas; NEW: AvatarCollection onEquipped callback refreshes the YOUR AVATAR summary card
  instantly (verified STARTER NINJA → LEGENDARY VOID WIZARD → restore, no reload).
- 4) GRAPHICS QUALITY ON LANDING: NexusPage selector (nexus-landing-gfx, tiers low/bal/high/
  ultra/max) between ENTER NEXUS and YOUR AVATAR. Default BALANCED; precedence localStorage
  nexus_gfx5 > account my_gfx > "bal"; writes localStorage + POST /api/nexus/prefs when signed in.
  In-world FIG.01 boot-LOW-then-restore stability logic untouched.
- 5) PORTRAIT HUD: NexusWorld duplicate JSX closer removed (compile fix); Map (nexus-map-btn) and
  Settings (nexus-settings-btn) verified fully visible/clickable at 390px portrait.
- 6) RELEASE: manifest rebuilt (nexus-v32-final v32, 132/132 DURABLE incl. 8 new walk GLBs,
  meshy_balance_frozen 3505); /api/nexus/public returns nexus-v32-final; /api/nexus/admin/release
  republish_ready=true. Startup migration applied in preview (avatars 11 upserted, users 0 — prod
  computes own counts on Republish boot). deployment_agent: PASS, no blockers.
- DEFERRED (per directive, do NOT start unprompted): Unity Bridge + admin simulator, ORAi prompt
  reference generator, malware scanner interface, voice foundation / NPC machine.

## RESUME CHECKPOINT — nexus-v31-avatar-repair (FOUNDER REVIEW READY, latest)
- ROOT CAUSES FIXED: (1) green-stuck glow = emissive color baked green in ninja masters' emissive
  texture → zero-credit grayscale emissive-mask derivatives via scripts/ninja_mask.js
  (@gltf-transform/core + sharp, node deps under backend/scripts/node_modules) applied to masters →
  rebuilt lod0/1/2, docs updated with glow_mask:true (ktx2:false for ninjas now — masks are
  draco+png; re-run avatar ktx2 pass later if wanted); (2) premium showing ninja/wrong tint =
  applyGlowTint MUTATED SHARED CACHED MATERIALS → per-instance material clones everywhere;
  (3) sideways run = action_id 6 (BackRight_Run strafe) → replaced with 659 run_fast_3_inplace,
  paid animation-only repair for all 8 avatars (24cr, ledger /app/artifacts/nexus/v31_ledger.json,
  audit doc id v31-approval). Balance 3,529 → 3,505.
- PREVIEW STATE MODEL: AvatarPreview (exported) — LOADING/PREVIEWING badges, LOAD FAILED + RETRY
  (no silent ninja fallback), per-instance materials, live glow prop; NexusPage starter chooser
  has LIVE PREVIEW panel with instant glow switching + color-name label; collection dialog shows
  id/gen/cost/OWNED/EQUIPPED/ANIMS chips.
- TESTED: iteration_149 ALL PASS (glow persistence, rapid-switch race, wizard preview identity,
  V30 catalog intact). Run direction verified by clip identity (659 forward in-place), NOT
  visually frame-by-frame (software-GL) — founder should eyeball run in-world.
- V31 NOT DONE (deferred per repair-priority order, report honestly): Unity Bridge + simulator,
  ORAi prompt reference generator, real malware scanner interface, separate unity staging origin,
  full inspector upgrades (wireframe/skeleton/texture-memory), Magic Loops wiring of new events.

## RESUME CHECKPOINT — nexus-v30-asset-manager (FOUNDER REVIEW READY, latest)
- ASSET MANAGER + AVATAR STUDIO live at /admin/nexus/assets (founder-only; linked from the v29
  release strip). Backend: routers/nexus_assets.py (mounted in server.py).
- CHUNKED UPLOADS: init/part/complete/abort at /api/nexus/assets/upload/*; 16MB parts streamed to
  /data/nexus_uploads (never whole-file in memory), per-part sha, whole-file SHA-256 verify
  (tested: mismatch → 422), content-hash dedupe, 4GB cap (NEXUS_MAX_UPLOAD_GB), resumable session
  docs in db.nexus_uploads; client uploader has pause/resume/retry/progress/speed/ETA +
  localStorage session. E2E verified (asset f49db7ce… stored durable + catalogued).
- SECURITY: GLB magic+structure validation via mp.validate_glb; zip guards (traversal, symlink,
  ratio 120x bomb cap, executable/nested-archive block); founder-only (regular user → 403);
  avatar model versions require skins.
- UNITY WEB BUILDS: zip-only validation (loader/framework/wasm/data(.br/.gz) + index via flexible
  regex), staged extraction to /data/unity_stage, served at /api/nexus/assets/unity-stage/{id}/
  with correct MIME/Content-Encoding + COOP/COEP + sandbox CSP + no-store html. LIMITATION: same
  host origin (no separate staging domain available in this infra) — sandboxed via CSP; Three.js
  Nexus remains the live runtime; no Unity bridge messages implemented yet (documented).
- AVATAR STUDIO: /api/nexus/assets/catalog (8 avatars + owners/equipped/anims/lods/ktx2 stats);
  version drafts (nexus_avatar_versions), publish = atomic pointer swap w/ rb-{aid} rollback
  target (IDs/prices/ownership preserved), rollback endpoint; estimate (70cr) → generate REQUIRES
  approve=true (else 428) + balance guard; jobs recorded in nexus_jobs (pipeline queued marker —
  actual generation reuses scripts/nexus_avatars_v2 flow when run).
- MAGIC LOOPS: optional adapter — config server-side in db.nexus_ml_config (token never returned),
  emit_event() with event_id/idempotency_key/env/actor, delivery log + dead_letter in
  db.nexus_ml_events, test-connection endpoint, founder panel with recent events. Core works
  without it.
- RIGHTS ATTESTATION: /api/nexus/assets/attest records 4 statements + admin + hash + version.
- Meshy balance UNchanged: 3,529. v29 manifest/145 files untouched; rollbacks preserved.
- LIMITATIONS (honest): no malware AV engine (signature/structure checks only); gltf-zip→glb
  conversion pipeline stub; 3D inspector is the existing preview (no wireframe/skeleton tools);
  reference-image prompt generation not wired (upload path works); Unity bridge (section 7) not
  implemented; generation job runner is queued-marker (execute via existing scripts).

## RESUME CHECKPOINT — nexus-v29-parity (REPUBLISH READY, latest)
- DEPLOYMENT PARITY DONE (zero credits, balance 3,529): canonical release manifest at
  /app/backend/release/nexus_release.json (release_id nexus-v29-parity, world v28, 132 runtime
  GLBs + 13 static assets, checksums/sizes/categories/LOD/ktx2 flags). ALL 132 verified DURABLE
  in R2; 145/145 URLs return 200 + correct MIME through the deployed preview host (curl UA —
  python-urllib gets 403 from ingress bot-blocking, don't be fooled).
- STARTUP MIGRATION: services/nexus_release.py apply_nexus_release() runs from server.py startup
  in EVERY environment (idempotent, release-versioned via db.nexus_release_state). Seeds avatar
  catalog, archives legacy starters, promotes world if published_version < release, migrates
  legacy/empty users → av_ninja/lime, backfills founder vault BY ROLE (all founder-role users).
  Preview apply: avatars 11 upserted, founder grants +5, users 0 (already migrated). Production
  will compute its own counts on next Republish boot.
- ADMIN: GET /api/nexus/admin/release (founder) + release strip in /admin/nexus
  (nexus-release-panel: REPUBLISH READY · 132/132 DURABLE · KTX2 26 · AVATARS 8×7 anims ·
  FOUNDER VAULT 6/6 · rollbacks · migration state). /api/nexus/public now returns release_id.
- No service worker in app; JS bundles content-hashed by build; media filenames are content
  hashes (immutable-cache safe). Republish = platform action (founder clicks it; we never do).
- STATUS LABEL: REPUBLISH READY — FOUNDER VERIFICATION REQUIRED.

## RESUME CHECKPOINT v28 — FOUNDER AAA REBUILD + FIG.01-06 (FOUNDER REVIEW READY)
- Published v28 (v25 batch3, v26/v27 ktx2 city, v28 Master-A composition). All snapshots preserved.
  Meshy: 3,965 → 3,529 (436 spent: image-to-3d 35/avatar ×8, remesh 5, rig 5, anims 3; champion+
  sovereign rigs FAILED "pose estimation" on caped/gowned image-to-3d models — kept v1 runtimes per
  no-blind-retry rule; task ids in /app/artifacts/nexus/avatars_v2.json).
- STARTER NINJAS (FIG.03/06): av_ninja (male, default) + av_ninja_f (female) — image-to-3d from
  founder crops (/tmp/ref_av_ninja*.png, thumbs /nexus/av_ninja*.webp), 7 anims each, LOD0/1/2,
  glow_channel=true, status active/free. Legacy starters starter_m/starter_f/av_d5b60b3e ARCHIVED
  (masters intact, nexus_avatars_archive holds v1 docs). Migration script
  scripts/nexus_starter_migration.py (idempotent): migrated 2 legacy + 247 empty users → av_ninja;
  premium-equipped users untouched.
- PREMIUM v2 SWAPS: streetwear/tech_operative/realm_guardian/void_wizard now v2 (image-to-3d from
  transparent sheet xf98rh5w_EE4B449F). aether_champion + arcane_sovereign remain v1 (known
  limitation). Catalog IDs/prices/ownership unchanged.
- FOUNDER VAULT (FIG.05): _is_founder_user() role check in collection/unlock/select — all current
  AND FUTURE premium avatars auto-unlocked for founder, zero burns, idempotent grants, backfilled
  6 ownership docs. UI banner founder-vault-banner.
- GLOW (FIG.04/06): 9 colors, POST /api/nexus/avatars/glow + atomic POST /api/nexus/avatars/starter
  {id, color}; users.nexus_glow; presence broadcasts glow when avatar glow_channel; runtime emissive
  tint (applyGlowTint) — ONE master per body, 9 runtime variants, zero credits.
- FIG.01 GRAPHICS QUALITY: 5 stops LOW/BAL/HIGH/ULTRA/MAX in settings (nexus-gfx-*), LOW first-use
  default, saved in localStorage nexus_gfx5, boot always LOW then restore after 6s stable,
  window.__NEXUS_GFX.set() live-applies pr/shadows/far + drains heroQueue (deferred hero GLBs);
  NAVS auto-downgrade shows "Quality lowered to keep Nexus stable." banner. Warning triangle text
  under slider (exact founder copy).
- FIG.02 ROTATE POPUP: portrait+touch only, sessionStorage dismiss, fullscreen+orientation lock
  attempt with graceful physical-rotation hint fallback.
- AVATAR KTX2: scripts/nexus_avatar_ktx2.py converted all active/premium avatar LODs+anims to
  etc1s+draco (9 OK). NOTE: /usr/bin/ktx binary does NOT persist container restarts — reinstall
  KTX-Software-4.3.2-Linux-arm64.deb before offline encoding (runtime needs only /basis/ files).
- MASTER REFS: /app/artifacts/nexus/references/master_b_mobile.png (sha in checksums.txt); Master A
  world artwork + FIG06 board (8b27hoy9_0E5144BC) + FIG board (ikes27ma_6593BF9E) in artifacts CDN.
- TESTED: iteration_148 ALL PASS (15/15 backend + full frontend: starter chooser, vault banner,
  gfx slider live-apply, rotate popup, 7 anims × 8 avatars). World streams 72/72 models 0 failed.
  HONEST STATUS: FOUNDER REVIEW READY — emulation-verified only, no physical-device claim.

## RESUME CHECKPOINT v27 — FOUNDER MOBILE P0 REPAIR (latest)
- Published v27 (v25=batch3, v26=ktx partial, v27=ktx complete; all snapshots in nexus_versions).
  Meshy 3,965 — ZERO credits spent in this repair. Masters untouched.
- ROOT CAUSES of iPhone crash (v25): duplicate LOD residency (lod2+hero both downloaded, nothing
  disposed), 4-way parallel GLB decode, 38+ live PointLights + shadows + dpr2 before benchmark,
  no disposal on exit (re-entry accumulation), no webglcontextlost handling, ORAi FAB overlapping
  CTA, HUD pill truncation.
- FIXES (NexusWorld.jsx): safe Low tier DEFAULT on touch (nexus_gfx=high opts out), pixelRatio
  0.75 / no AA / no shadows / light cap 10 on low; GLB concurrency 1 (iOS/low-mem) / 2 (mobile) /
  4 (desktop); Low tier loads LOD2 ONLY (no hero download); non-low upgrades dispose lod2 via
  refcount (releaseGLB); abortable queue (abortGLBQueue); webglcontextlost → branded recovery
  screen (nexus-recovery-screen, RETRY forces low + remount via epoch state, RETURN TO NEXUS);
  visibilitychange pauses raf; full teardown on exit (scene traverse dispose + evictGLBCache +
  renderer.forceContextLoss); avatar fallback = dark silhouette capsule (never bright debug);
  player avatar priority 0 (loads first); mobile passes avatar lod1; diag overlay
  (?diag=1 / localStorage nexus_diag=1) shows tier/fps/pr/tex/geo/calls/tri/glb/queue/MB/ctxLost.
- KTX2 PASS: KTX-Software arm64 installed (toktx); scripts/nexus_ktx2_pass.py derives
  etc1s+draco runtimes (26/26 unique city GLBs), asset_library registered, entities carry
  props.ktx2 (72) / lod2k (44); _clean_entity whitelist += ktx2, lod2k; KTX2Loader with
  self-hosted /basis/ transcoder (public/basis/); automatic fallback to original draco+PNG URLs
  when KTX2 unsupported. NOTE: local media files for old assets may need re-download from
  http://localhost:8001/api/media/... before offline processing (R2-only).
- LANDING: hero has radial-gradient placeholder + onError fallback + lighter overlay; ORAi FAB
  hidden on all /nexus routes; HUD zone pill shows short label (<sm) — no truncation.
- TESTED: iteration_147 ALL PASS — v27 world, ktx2 URLs 200, basis 200, 6 avatars intact,
  mobile emulation (maxTouchPoints init script): lowGfx/tier=low/ktx2=true, 0 failed GLBs,
  3 enter/exit cycles: textures 31→31→31, geometries 137→138 (no accumulation), ctxLost 0.
  HONESTY: emulation only — real-iPhone verification still owed to founder at
  https://realm-deploy.preview.emergentagent.com/nexus (?diag=1 for overlay).
- FILE CORRUPTION LESSON: a search_replace batch once duplicated the file tail of
  NexusWorld.jsx — after batches, grep for marker strings to confirm all edits landed.


## RESUME CHECKPOINT v25 (exact — next agent starts here)
- FINAL CONTINUOUS RUN (founder-approved, no checkpoints): published v25. Meshy 4377→3965
  (412cr of 1,078 available; floor 3299 never approached; margin 666).
- SIX-AVATAR COLLECTION COMPLETE: av_streetwear/av_tech_operative/av_realm_guardian/
  av_aether_champion/av_arcane_sovereign/av_void_wizard ALL generated (text-to-3d preview+refine →
  remesh 40k → rig → 7 anims idle(0)/walk(1)/run(6)/jump(641)/fall(502)/land(506)/greet(28)).
  action_id 640 is broken server-side (fails uncharged) — use 641. Masters:
  /app/artifacts/nexus/av_*_rig_master.glb. LOD0/1/2 runtimes + thumb (/nexus/av_*.webp cropped from
  founder sheet rp0vfdr3_8828913B). Registry docs status='premium', eligibility='unlock'.
  Scripts: nexus_avatars6.py (batch) + nexus_avatars6_finish.py (consolidator — reuses succeeded
  tasks by idem_key, immune to payload-hash conflicts; ALWAYS run finisher after batch).
  LESSON: never launch the batch twice concurrently (duplicate rig charge 5cr happened once).
- FIRE POWER UNLOCKS LIVE: POST /api/nexus/avatars/{id}/unlock (atomic find_one_and_update burn on
  fire_wallets.vault_balance, duplicate-race refund, idempotent already_unlocked), select requires
  entitlement (nexus_avatar_unlocks). FIXED: _user_avatar_data + avatars_select now allow status
  premium (was active-only → premium could never equip/render).
- AVATAR UI: AvatarCollection.jsx — thumbnails first, on-demand GLB preview modal (three.js, lod1),
  burn dialog ('cannot be reversed'), SELECT/EQUIPPED states, LEGENDARY badge on wizard.
- RENDERER: motion pack now loads walk/run/jump/fall/land/greet; anim state machine: airborne
  vy>0.6→jump else fall; land window 320ms after hard landing (vy<-6); greet 1600ms on emoji
  reaction (window.__NEXUS_MOB.greet). Remote players share anim strings via presence.
- ARCHITECTURE BATCH 3 (v25, 120cr): led_tower x4, terrace_block x4, spire_cluster x7, holo_club x2
  (runtime draco 1024 + lod2 256 in asset_library, masters immutable). Zero-credit: deep skyline
  ring x8 (batch2 bg_skyline reused at r≈140-160), 5 extra orbit flying vehicles, OURREALM/NEXUS
  billboard signs. Scripts: nexus_batch3.py + nexus_batch3_integrate.py. Artifacts:
  /app/artifacts/nexus/batch3.json.
- TESTING: iteration_146 ALL PASS (backend 10/10: collection order/7-anims/unlock burn/idempotent
  repeat/402/404/403/equip/parallel-unlock-single-burn/join+public smoke; frontend: cards, preview
  modal, burn flow, equip, world entry regression). Container is software-GL: world GLBs stream
  slowly — visual parity vs founder references still requires founder real-device approval.
- REMAINING GAPS (honest): Reference B/wide-shot parity NOT claimed (needs real-GPU look pass,
  lighting/FX tuning); KTX2/meshopt encodings, animated distant impostors, occlusion culling still
  pending; voice SFU flag OFF; jump clip is Jump_Over_Obstacle_1_inplace (641) — founder may prefer
  another; ARCANE SOVEREIGN model has a horned headdress (acceptable interpretation, 1 replacement
  slot unused if founder rejects).


## RESUME CHECKPOINT (exact — next agent starts here)
- FINAL RUN RESULT: published v24, rollback v17-v23. Meshy 4499→4456 (43cr of 1200 ceiling: citizen v2
  preview10+refine20+remesh5+rig5+walk3; both earlier rig failures uncharged; floor 3299 never approached).
- CITIZEN V2 (living crowd): nx-cz2-* task chain SUCCEEDED. LOD0 2.0MB(41.5k tris)/LOD1 606KB/LOD2
  203KB/walk 756KB, skins=1, Walking_Woman clip. Crowd = citizen LOD1 + starter_f, HSL clothing
  variations, staggered timing, 18 rigged + instanced far capsules. NOTE: Meshy animation API needs
  action_id INT (1=walking), not action string. Masters: /app/artifacts/nexus/citizen_v2_*_master.glb.
  v1 remesh 30k proved unriggable twice (pose estimation) — replacement path was founder-authorized.
- INSTANCE DIRECTOR HARDENED: expiring non-guessable invites (POST /api/nexus/invite, 15min,
  join {invite:token}, 410 invalid), duplicate-join 429 (1.5s), realm creation requires accept_terms
  (428), presence_friends filters nexus_presence_hidden/invisible users, presence paused when tab
  hidden. LOAD SIM PASSED: 50/100/250/500/1000 SIMULATED users → 46 instances, max pop 22<=24, zero
  over-capacity, p95 join 113ms (logical capacity only — NOT physical autoscaling proof).
- LEGAL/PROVENANCE: /app/THIRD_PARTY_NOTICES.md created (three/draco/gltf-transform/meshopt/lucide/
  meshy); asset_library backfilled license+owner on 65 assets. Voice: architecture doc
  /app/memory/nexus_voice_architecture.md, flag OFF — SFU infrastructure dependency (needs founder
  authorization to provision). Under-13 block preserved; benchmark stores only coarse tier, no GPU ids.
- TESTING: iteration_145 ALL PASS (11/11 backend incl. invite/realm/party/429/409/410/428/403 +
  frontend landing/world/HUD/map/exit/routes/regression). All testing = emulation/simulation; real
  device + physical load still pending founder hardware.
- REMAINING GAPS (honest): KTX2/Basis + meshopt encodings, distant animated impostors, occlusion
  culling, voice SFU, real-device perf, 20-30min soak test, richer ORAi hologram, more terrace/
  storefront variation, portal-to-specific-instance routing UI, guardian/teen granular permissions,
  qualified legal review. Reference B visual parity NOT claimed — founder approval still required.

- CK2 DONE (published v23; rollback v17-v22 snapshots preserved). Meshy 4504→4499 (remesh 5cr only).
- CROWD CANARY STATUS: remesh→30k SUCCEEDED (task 019ff908-9313-7d89-84c4-eca30495a8b2, master saved
  /app/artifacts/nexus/citizen30k_remesh_master.glb, 20MB). RIG FAILED "Pose estimation failed" (NOT
  charged). STOPPED per founder no-paid-retry rule. Next needs founder approval: one rig re-attempt
  (5cr) on remesh output (or remesh at higher polycount first). Budget used 5/20. Idem keys:
  nx-b2-citizen-remesh-v1 / -rig30k-v1 (burned; use -v2 for approved retry).
- CK2 zero-credit shipped:
  1) X/Z rotation support for model entities; canopy now OVERHEAD (m_canopy rot.x=90° y=26 scale46;
     m_canopy2 tilted y=33 z=-52) — visual confirm on real GPU pending (software-GL too slow to catch).
  2) Flight paths: props flight/fspeed/fradius (whitelisted) + renderer orbit anim w/ gentle bob +
     heading; applied to bship/gship/fv0-2 (v23).
  3) Crowd clothing-color variations (HSL offset per clone) + staggered anim timing (existing).
  4) INSTANCE DIRECTOR v1 (services/nexus_instances.py + routers/nexus.py): nexus_instances collection,
     smart join order (direct→realm→friend→friends-first→fullest-healthy-public w/ 2-slot party
     headroom→create new), POST /api/nexus/join (server-authoritative, 409 on bad access),
     GET /api/nexus/presence/friends (public instances only, hidden users never revealed),
     POST /api/nexus/instances/realm (founder; persistent identity, sleep/wake), GET /api/nexus/instances
     (founder), POST /api/nexus/party/reserve (60s reservations). Lazy maintain(): drain/close empty
     publics (300s grace, public-1 kept), realm instances sleep not delete. Presence now carries
     instance_id; peers filtered per instance. CURL-TESTED ALL PASS (smart/realm/direct/bad/reserve).
  5) Frontend: routes /nexus/nexus-central[, /instance/:id, /realm/:slug] (backward compat /nexus kept),
     enter() calls /join first, NexusWorld gets instanceId, landing shows JOIN FRIENDS button when
     friends online (10s poll). BUG FIXED: async-generator sum in _reserved.
- KNOWN GAPS: real proximity voice (flagged OFF, blocking), citizen rig (awaiting approval), canopy/
  flight visual proof on real device, load tests 50-1000 users NOT run, invites/blocking/invisible
  privacy checks minimal, KTX2/impostors pending, crowd 1/6/18 perf test pending real citizen.

- FOUNDER MASTER GAMEPLAY REFERENCE is the permanent top-priority target:
  /app/memory/nexus_master_references.md (Reference B). Manifest with statuses:
  /app/memory/nexus_visual_asset_manifest.md. Full production directive was given 2026-06 (this session):
  NAVS, exact HUD, Batch2, crowd canary, Instance Director, friend-first join, Realm instances,
  network interest mgmt, load tests 50→1000 users, final founder approval required.
- PUBLISHED v22. Rollback: v17-v21 snapshots in nexus_versions. Meshy 4684→4504 (Batch2 = 180 credits,
  founder approved). NO further paid generations without approval.
- DONE this checkpoint:
  1) Batch 2 GENERATED+INTEGRATED (v22): bg_skyline x6, circular skywalks x2 (±34,8,-22), business_ship,
     gaming_ship, flying_vehicle x3 (static), white boulevard center strip. Masters+runtimes in
     asset_library (/app/artifacts/nexus/batch2.json).
  2) CROWD CANARY BLOCKED: refine 535k faces > Meshy 320k rig limit → needs ONE paid remesh
     (POST /openapi/v2/remesh target_polycount<=300k) then rig+walk. AWAITING FOUNDER APPROVAL.
     Idem keys nx-b2-crowd_citizen-* (preview/refine already paid+stored).
  3) NAVS v1: LOD2/LOD3 generated for 6 city assets (nexus_navs_lods.py, v21 tagged 27 entities,
     lod2/lod3 props); renderer streams lod2 first for entities >60u from spawn then upgrades to hero
     LOD at idle priority; adaptive tiers low/med/high/ultra via 4s real-frame benchmark + hysteresis
     (8s cooldown) exposed at window.__NEXUS.tier. PENDING: KTX2/Basis, meshopt option, impostors,
     occlusion culling, anim keyframe compression.
  4) EXACT REFERENCE HUD rebuilt (lucide icons, no emojis for controls): glass EXIT pill w/ arrow,
     zone pill w/ green dot + REAL online, map-pin + gear squares, Crosshair recenter, JUMP (ArrowUp),
     INTERACT (Hand), joystick ring w/ 4 chevrons + glowing cyan thumb (tracks touch via
     #nexus-joy-thumb), chat + Smile reactions (send real chat), portal card w/ Gamepad2 icon + glowing
     green ENTER. All: aria-labels, active/focus states, >=44px. MIC = feature flag nexus_voice (OFF) —
     real proximity voice NOT built = BLOCKING GAP for final approval.
- NOT STARTED (next in execution order): Instance Director (provider-neutral, routes
  /nexus/nexus-central[/instance/{id}|/realm/{slug}]), friend-first smart join, Realm-owned instances,
  interest management, load tests 50-1000 simulated users, voice chat, 20-30min soak/memory tests,
  founder real-device test.
- Perf note: preview container is software-GL; fps 21 in low tier. All testing = emulation, no real device yet.

- PUBLISHED v20. Snapshots v17/v18/v19 recoverable in nexus_versions. Meshy balance 4684 (LOCKED —
  zero credits used in audit + foundation pass; founder must approve any generation).
- MASTER REFERENCES (permanent visual targets): /app/memory/nexus_master_references.md
  (Reference A = landing page, Reference B = mobile gameplay target).
- FOUNDATION PASS DONE (testing agent iteration_144.json ALL PASS):
  1) ASSET OPTIMIZATION (zero credit, gltf-transform): 6 city models simplified 0.35 + draco + 1K
     textures (e.g. storefront 4.9MB→2.5MB, canopy 3.9MB→2.0MB); starter avatars 15.9MB→2.6-3.1MB each
     (skins+anims verified intact in /admin/nexus/model-test). Masters preserved in asset_library +
     nexus_avatars.master_rigged_url/master_animation_urls. Mapping:
     /app/artifacts/nexus/mobile_optimize.json. World payload ~60MB→~15MB. v20 swapped 31 URLs.
  2) LANDING PAGE (Reference A) rebuilt in NexusPage.jsx: hero webp crops (/public/nexus/hero_*.webp),
     real online/zones/systems from /api/nexus/public (5s poll), YOUR AVATAR card w/ real thumbs
     (/public/nexus/av_starter_f.webp, av_starter_m.webp) + CHANGE picker, feature chips, explore cards,
     footer. Landscape-phone CTA above fold (landscape:max-lg utilities).
  3) PLAYER SHELL (Reference B): fixed 100dvh shell, browser-Back exits world first, exit releases
     pointer lock/fullscreen, retry on load error, orientation swap WITHOUT world remount (verified),
     minimap overlay (nexus-map-btn, real SVG from zone entities + player), emoji quick bar, contextual
     portal card w/ ENTER (nexus-portal-card), camera anti-clip (collider-aware dist), adaptive quality
     (bloom auto-off <20fps, then pixel-ratio steps to 0.6; localStorage nexus_bloom=off / nexus_gfx=low).
- Earlier audit findings (see /app/memory/spawn_zone_asset_audit.md): draco self-hosted /draco/,
  priority GLB queue (4 concurrent, nearest-first), model collider y<2/no_collide rule, 'tree' entity
  type, canopy gates, storefronts at ±30 rot ±1.57.
- TESTING HONESTY: all device-matrix tests were BROWSER EMULATION (playwright); no real hardware.
  This container is software-GL (fps 0.4-21); real devices will be much faster.
- REMAINING GAPS: no per-distance LOD tiers yet (single optimized runtime per asset); Reference B
  visual parity NOT claimed (needs architecture batch 2, street detail, crowd characters, vehicles,
  final lighting — ALL awaiting founder approval); mic button intentionally absent (no real voice);
  storefront facade rotation verified from spawn view only.
- QUEUED: crowd canary (one low-poly rigged citizen) — PROPOSED, NOT APPROVED. Architecture Batch 2 —
  NOT APPROVED. AVATAR COLLECTION only on explicit "START AVATAR PHASE"
  (/app/memory/avatar_collection_directive.md: canary Streetwear first, reference sheet MANDATORY).
  Unity importer + NPC Machine on hold.




## SPAWN ZONE VISUAL DIRECTIVE (latest pass; published v15, 140 ents in nexus_central)
- Renderer upgrades (NexusWorld.jsx): ACES tone mapping (exposure 1.18), glossy reflective ground
  (metal 0.55/rough 0.22), fog scaled to zone size, default camera pitch 0.16 dist 9 (cinematic
  entry), new entity types rendered: sign (glowing canvas text sprite), ring (emissive torus
  canopy, slow spin), crowd (InstancedMesh walkers w/ neon-glow heads, props.count+radius span),
  traffic (instanced flying vehicles). Ambient anim loop updates walkers/ships/rings.
- Backend: ENTITY_TYPES += sign/ring/crowd/traffic; props += text/count/radius.
- nexus_central content: spawn moved to (0,72) facing boulevard; 3 canopy rings (cyan/purple/
  green), 'NEXUS SPAWN ZONE' title, 'ORAi CORE ONLINE' sign, 6 district signs (GAMING/GAMEMAKER/
  EVENTS/BUSINESS/LIVE CLUB/SOCIAL TERRACE), 46-walker crowd, 12 flying vehicles, orange/green
  accent lanes, 8 boulevard trees, 4 decorative Nexus Arch portals, fill lights at spawn.
  Scripts: scripts/nexus_central_build.py + nexus_central_pass2.py.
- HONEST visual critic score vs photoreal reference: ~72/100 (composition 88, signage 85,
  portals 85, lighting 80, scale 78, density 72, polish 70, architecture 55). The 95/100 target
  needs Meshy modular building/canopy families, real crowd characters and bloom post-processing
  — NOT achievable with procedural primitives alone; reported as blocker, work preserved.
- /games: single 'ENTER NEXUS' purple CTA (games-nexus-cta, from earlier fork) below Game Maker
  CTA — agent's duplicate removed. Avatars untouched this pass per directive.
- Rollback: nexus_versions snapshots v13/v14 (pre-pass states), spawn positions cleared once.


## NEXUS V1 STATUS (final directive pass; iteration_143 backend 16/16 + regression 42/42 green)
- WORLD (published v12, draft=published, clean): zones = nexus_central (117 ents, DEFAULT entry,
  futuristic city: arrival platform spawn 0,84 → boulevard w/ nav lights → crown ring (floating,
  colliders skipped for y≥2 objects) → ORAi monument+guide NPC → portals: plaza/gardens (working)
  + Games/GameMaker/Events/Business (expansion) + terraces w/ Meshy pavilion GLBs + buildings +
  skyline), plaza (14), emerald_gardens (9). Two-way portal travel incl. return portals to central.
- AVATARS: nexus_avatars registry — starter_m (male streetwear, DEFAULT, walk-in-place clip
  'Armature|Casual_Walk_inplace', url 2d71459092a9...glb) + starter_f (female streetwear, rigged,
  url c398c4cf7085...glb, corrective T-pose attempt after 1st rig failed pose estimation).
  Landing avatar picker (nexus-avatar-picker) saves selection server-side (users.nexus_avatar_id),
  synced cross-device; remote players render each other's avatar (presence.avatar_url, 30s cache).
  Anim states: walk=1x, run=1.7x, idle=0.06x slow-mo, GLB load retries 3x w/ cache eviction,
  capsule fallback + console.error on failure. window.__NEXUS.avatarReady debug flag.
- CHAT: proximity (18u server-enforced), 160 chars, 2s rate limit, muted/suspended blocked,
  bubbles above avatars (6s), input bottom-center, radius inclusion/exclusion test-proven.
- LIVE SYNC: presence returns pv → 'World Updated' toast + atomic world swap without re-entry.
- ADMIN: NexusStudios.jsx = 3D Asset Studio (text-to-3D generate, upload GLB w/ validation 422,
  refine/rig/poll/store advance, library w/ assign→entity (model type) / →avatar) + Avatar Studio
  (set default, hide/activate, eligibility 'assigned', assign users). ORAi: spoken replies
  (speechSynthesis + mute/stop/volume), voice input, undo of approved ops (inverse_ops→undo stack),
  zone isolation (proposals target founder-selected zone only). Magic Loop scorer fixed: only
  inspects targeted/touched entities (was flooding repair ops >40 in big zones), labels required
  only for portal/npc, repair ops capped at 40. asyncio task refs kept (_RUN_TASKS).
- Meshy usage this directive: ~133 credits (balance 5147→5014): plaza kit env 30, male avatar
  chain 35, female avatar 68 (2 attempts). Task IDs in /app/artifacts/nexus/canary_report.json +
  meshy_tasks (idem keys nexus-canary-*, nexus-avatar-f-*-v2). Masters+draco 2K runtime derivs.
- ROLLBACK IDS: nexus_versions v1-v12 snapshots + WP1 baseline v2029 + wp1_snapshot.json.
- HONEST LIMITATIONS (remaining backlog): WebSocket transport NOT built (300ms polling is the
  verified transport; WS+fallback deferred); avatar clips: single walk clip per avatar mapped to
  idle/walk/run via timeScale — distinct idle/jump/landing/greeting clips + crossfades deferred
  (needs Meshy animation action_id API + clip merge pipeline); ORAi media uploads disabled
  (honest label); tablet viewport not separately verified; Meshy remesh/animate/cancel buttons
  not in studio UI (rig/refine/store are). Headless-only flakiness: platform service worker
  'controllerchange' reload can abort GLB/chunk loads in automated tests (auto-retry added;
  real-browser proof: male avatar rendered 02:23 run, female 02:28 run).
- FILES: backend routers/nexus.py (chat/avatars/assets/magic), services/nexus_magic.py,
  services/nexus_world.py (model type, url/spin props), scripts/nexus_central_build.py,
  scripts/nexus_canary*.py, scripts/nexus_avatar_f.py; frontend NexusWorld.jsx (GLB avatars,
  chat, inline draco loader), NexusPage.jsx (picker, default zone, travel, live sync),
  AdminNexus.jsx, NexusStudios.jsx, OraiArchitect.jsx, MagicLoop.jsx, ActiveRuns.jsx.
- TESTS: tests/test_nexus_phase1.py (24), test_nexus_magic.py (26), test_nexus_central_iter143.py
  (16) — ALL GREEN. WARNING: suites mutate live draft/published — clean after running.
- NEXT: WebSockets, multi-clip avatar state machine, ORAi multimodal uploads, remesh/animate UI,
  friend-instance capacity, production deploy (founder action via Deploy button after approval).


## NEXUS V1 — CHECKPOINT A.5 COMPLETE ✅ (iteration_142: backend 26/26 + full frontend pass)
- /admin/nexus rebuilt to founder reference: dark-glass 3-col layout, topbar (Public World /
  Admin Builder, DRAFT chip, LIVE PREVIEW toggle [plays PUBLISHED world in viewport],
  Multiplayer World link, Publish Update / Save Version / Roll Back), left cards (World&Zones,
  3D Asset Studio [Meshy connected, buttons honestly disabled until Checkpoint B], Systems,
  Versions, Multiplayer Users [real /admin/presence count]), center (viewport + AI Magic Loop +
  Avatar Studio Phase C placeholder), right (ORAi Architect w/ browser voice input +
  Checkpoint-B-labeled upload buttons, Active Runs, Safe Publish Checklist [real computed],
  Activity Log [real audit]). Mobile = 5 tabs (build/magic/orai/runs/system), no overflow,
  portrait+landscape verified.
- AI MAGIC LOOP (REAL, founder-only, Mongo-backed): modes improve_draft / clone_variant /
  animation_style / runtime_style / living_editor. Stages Build→Review→Compare→Improve→Verify
  as async engine (services/nexus_magic.py); pause/resume/stop + pause-all/stop-all; runs
  survive refresh (stall detector marks interrupted runs honestly); results are approvable
  proposals → Approve applies to DRAFT ONLY (published isolation test-asserted); dry runs
  cannot be applied; clone creates recoverable variants (load→draft makes auto-backup first);
  scores are HONEST deterministic heuristics (labeled), never invented; Founder Max unlocks
  stop-score≤99/attempts≤5/cycles≤3 (bounded, audited, never infinite); estimate endpoint
  reports 0-credit deterministic plan; only supported animation (portal spin via props.spin —
  renderer support added; light intensity) / runtime (zone lighting presets) styles selectable,
  unsupported ones honestly labeled+rejected 400. living_editor real mode = LLM; mock mode for
  tests. save-version = manual draft snapshots (v1001+); audit covers all magic_* actions.
- Endpoints: /api/nexus/magic/{config,estimate,start,runs,runs/{id}/control,control-all,
  runs/{id}/decide,variants,variants/{id}/load}, /api/nexus/admin/{presence,save-version}.
- Regression suites: backend/tests/test_nexus_magic.py (26) + test_nexus_phase1.py (23+1 LLM
  deselected) — 49/49 green. WARNING: running these suites dirties the live draft/published
  world (they publish/rollback) — clean up after (published v8 = original 13-entity plaza).
- Credits used in A.5: Meshy 0, image 0, real LLM 0 (magic modes are deterministic-local).
- BUG FIXED: AdminNexus founder guard — auth user object exposes `role` (not `admin_role`);
  guard now checks (user.role || user.admin_role) === 'founder'. tftwo denial re-verified.
- AWAITING founder gate for Checkpoint B (Meshy env asset + rigged avatar canary + cost report).


## NEXUS V1 — CHECKPOINT A COMPLETE ✅ (iteration_141: backend 24/24 PASS, frontend pass)
- Routes LIVE: /nexus (public landing + signed-in world entry) and /admin/nexus (founder-only,
  guarded in frontend via useAuth admin_role AND backend require_founder on every endpoint).
- REAL multiplayer PROVEN with 2 simultaneous browser sessions (stealth + tftwo): both see each
  other's named avatar, movement syncs (300ms presence poll + lerp interpolation), join/move/
  stop/disconnect (remotes→0, HUD 1 online)/reconnect (remotes→1) all verified. Online counts
  are real DB values (nexus_presence ts>now-12s). Server rejects: out-of-bounds 400, teleports
  (snap-back), spam <120ms 429. Position persists (nexus_positions, 5s save + unmount save).
- World editor: add box/ramp/pillar/light/portal/npc, select/drag-move/numeric pos-rot-scale/
  color/duplicate/remove/undo (inverse-ops), Draft→Publish (snapshot)→Rollback-to-draft,
  audit trail. Draft/published isolation asserted in tests (rollback never touches published).
- ORAi World Architect LIVE: propose (gpt-5-mini json_mode, max_tokens=4000 — was 600, fixed)
  → plan + structured ops diff → founder approve applies to DRAFT only / reject. Dry-run
  validation via nw.apply_ops before saving proposal. Never touches published world.
- Controls: PC WASD (+arrows), pointer lock, Space jump, Shift sprint, E interact, wheel zoom,
  sensitivity + invert H/V (localStorage). Mobile: left joystick, right cam drag, pinch zoom,
  JUMP/E/RUN buttons (gate: pointer:coarse OR maxTouchPoints>0, reactive to resize/orientation).
  Portrait 390x844 + landscape 844x390 verified, canvas matches viewport (no stretch).
- BUG FIXED this session: W/S was inverted relative to camera (dx/dz basis signs) — W now
  moves -z at yaw=0, verified with yaw exposed on window.__NEXUS.
- Files: backend/routers/nexus.py, backend/services/nexus_world.py,
  frontend/src/components/nexus/NexusWorld.jsx, pages/NexusPage.jsx, pages/AdminNexus.jsx,
  routes in App.js. Regression suite: backend/tests/test_nexus_phase1.py (24 cases).
- ZERO paid media used (greybox primitives only). Meshy credits used this session: 0.
- DB: nexus_worlds (draft+published), nexus_versions, nexus_presence, nexus_positions,
  nexus_proposals, nexus_audit. World cleaned post-test: published v4 = original 13-entity plaza.
- Known headless-only limitations (NOT product bugs): RAF throttling slows movement, Esc
  doesn't release pointer lock (use document.exitPointerLock()), pointer:coarse needs touch emu.
- NEXT (founder gate): Checkpoint B — 1 Meshy env asset + 1 rigged avatar canary w/ cost report;
  then Checkpoint C — 2 streetwear avatars + polished plaza. Chat/voice/media tools Phase B.


## STARTING GATE RESULTS (Nexus directive received — gate executed, PAUSED pre-Nexus)
- Production (ourrealm.social): backend healthy; ALL 10 runtime GLB URLs return 307→R2 publicly
  (shared bucket; middleware exemption already deployed). Founder-auth flows unverifiable from
  preview (no prod credentials — by design).
- PRODUCTION DB GAP CLOSED: game docs/registry live in preview Mongo only → built
  services/wkq_fixtures.py + fixtures/wkq_flagships.json (version-stamped idempotent startup
  importer, upserts 2 games + 6 realm keys, never touches player data). Proven in preview.
  Production converges on founder's NEXT REDEPLOY.
- 10-vs-8 GLB inventory answer: L1 loads 9 after env-kit fix (was 8: model_env_kit existed but
  wasn't consumed by props — now attached); model_boss loads only in L5 (boss:true).
- Preview verification: iter140 full pass; scale/controls/awards all confirmed.
- AWAITING: founder redeploy + production play-test approval → then begin NEXUS Phase 1.

## NEXUS V1 DIRECTIVE (QUEUED — full text in chat 2026-06; Images 1+2 binding references)
- Routes: /nexus (public + signed-in world entry), /admin/nexus (founder builder per Image 1).
- Phase 1 greybox FIRST (no paid media): Three.js world, third-person avatar, collision/spawn,
  portals, persistent position, draft/published/versions/rollback, 2-session real multiplayer,
  founder editor perms, ORAi structured-diff edit workflow (no eval).
- Then: PC pointer-lock camera + invert H/V + sensitivity; mobile joystick/drag/pinch/left-hand;
  real multiplayer (server-authoritative, interpolation, rate limits, REAL online counts only);
  admin editor (select/move/rotate/scale/dup/remove/undo, zones, lighting, portals, NPCs);
  ORAi World Architect (Understand→Plan→Diff→Preview→Approve→Apply-to-draft, audit);
  chat/voice/media/GLB uploads; Meshy studio with Arcane safeguards; Avatar Studio (2 original
  starter avatars AFTER greybox+multiplayer gates; skinned GLBs w/ idle/walk/run/jump/land/interact).
- Checkpoints: A greybox+multiplayer (no paid gen) → B Meshy env asset + avatar canary w/ cost
  report → C two avatars + polished plaza zone. Visual gate 90+ vs Images, max 3 paid/asset,
  max 2 repair cycles. Reuse: ThreeRuntime/draco, meshy_provider, GLB validation, job engine,
  ORAi routing, voice, auth/audit, fire/ER systems. Preserve Arcane unchanged (extract shared services).


## ARCANE HEARTH — COMPLETE (deploy-ready checkpoint, iteration 140 FULL PASS)
- 10 validated Meshy GLB models wired into wkq-arcane-hearth-3d-v1 (all draco+2K runtime
  derivatives 1-12MB; 8K/4K masters retained in R2 + /app/artifacts/wkq/models):
  player_model = RIGGED Maeve + walking clip (rig task 019fedc0-6f33-72b2-b7ca-da33187eee84),
  model_guardian (pantry imp), model_boss (mask guardian), model_npc (chef), model_station,
  model_hazard (brazier), model_portal, model_ingredient, model_env_kit, model_key (canary
  019fed73-016b-7c2f-aa0e-20dbeb8de9a9 — NEVER resubmit).
- Meshy credits: 5,477 → 5,147 = 330 total (canary 35, 9-model batch 270 [image models 30ea,
  text preview+refine 10ea], remesh 5, rig 5, ~15 founder-console/timing gap). Report:
  /app/artifacts/wkq/meshy_report.json. All models first-attempt SUCCEEDED.
- Zero uncaught console errors; fullscreen (or3d-css-fs) verified; portrait/landscape verified;
  walk anim plays only while moving; /api/media/models GET exempted from global auth
  (GLTFLoader sends no headers) in server.py middleware.
- Known automation-only limitation (NOT a product bug): headless RAF throttling prevents
  scripted full-loop playthrough; loop primitives all verified + server endpoints proven.
- Optional (unactioned per founder stop order): __OR3D_TP debug hook; gentler L1 NPC route.

## FOUNDER STOP ORDER (ACTIVE)
- Arcane complete → STOP. Await founder approval/testing/deploy.
- DO NOT start Skybound 3D conversion (no paid Skybound generation was ever submitted).
- DO NOT start OurRealm Nexus (next founder-directed project after approval).
- Preserve current Skybound 2D game unchanged (iteration 138 state).


## LATEST STATE (this session)
- **Skybound Chef (wkq-skybound-chef-v2)**: COMPLETE in preview (iteration 138 pass).
  3 AAA chapters (Sky Harbor Market / Neon Sushi District / Arcane Hearth Nexus finale
  with boss-gated portal + Hearth Guardian). 33 original assets wired (Aurora identity-locked
  hero set ×10, foes ×4, items/portals ×10, 3 env families far+mid+tile). 8 old greybox
  stages preserved in spec.wip_stages. ONE 10,000 FP finale reward (idempotent gfp:final);
  forbidden pool banner replaced with honest reward summary. Landscape=wider world,
  portrait=safe-area — verified by screenshots.
- **Arcane Hearth (wkq-arcane-hearth-3d-v1)**: 3 textured genuine-WebGL-3D levels
  (Sky Harbor Kitchens / Copper Stormworks / Festival Citadel) — iteration 139 pass.
  L2/L4 preserved in spec.wip_levels_3d. Quest loop + realm-key award + score submit +
  fire economy (+50/level, +250 finale) + fullscreen toggle (or3d-css-fs hides nav).
  Characters = greybox primitives UNTIL Meshy GLB pass (founder mandate: no sprite substitution).
- **Emerald Realm Key system**: /app/backend/routers/realm_keys.py — registry (db.realm_keys),
  ownership (db.user_realm_keys, unique user+key), award idempotent/server-authoritative,
  /mine collection. 6 registry entries (3 per game), art wired from 8K-mastered item_key.
- **MESHY CANARY (0/1, BLOCKED)**: founder chose Option A + canary gate (Emerald Key first:
  8K texture → GLB validation → ThreeRuntime load → desktop/portrait/landscape shots →
  credit report → pause for gate). MESHY_API_KEY still placeholder in preview .env —
  founder adding via Secrets panel. Plan: /app/memory/meshy_3d_plan.md (10 models, limits:
  3 paid attempts/model, 2 repair cycles/milestone, 650 Meshy credit stop threshold).
- Paid image generation: 43 assets, 43 paid attempts (zero retries), all via founder's
  OpenAI key (gpt-image-2). Manifest/ledger: /app/artifacts/wkq/. 8K masters: master8k/.
- Level audit: /app/memory/wkq_level_audit.md (no level exceeded 50% → exactly 3+3 AAA).

## NEXT (strict order)
1. Meshy canary when key lands: restart backend → auth check (never print key) → canary.
2. If canary passes: remaining 9 models w/ per-model report (task id, credits, validation).
3. Final cross-device testing, ER verification, production publish of both games.
4. Paused backlog: Phase 13B-13H (daily tasks/badges, ORAi quick buttons, hub pinning,
   voice repair, saved-games card, dynamic catalogs, artwork admin).

## KEY FILES
- Engines: frontend/src/components/games/GameRuntime.jsx (arpgXY ~line 2005+, per-zone
  bg/tiles, boss-gated portals, realm_level_complete postMessage ~2555, shell award ~3290),
  three/ThreeRuntime.jsx + three/questLevel.js (textures, lights, embers, quest loop).
- Seeds: backend/scripts/seed_wkq_skybound_v3.py, seed_wkq_arcane_v2.py (ground truth).
- Gen pipeline: backend/scripts/wkq_gen.py (chroma-key, 8K masters, wire_slot,
  3-attempt ledger), wkq_batch_skybound.py, wkq_batch_arcane.py, wire_wkq_skybound.py.
- Identity locks: /app/memory/character_identity_lock.md (Aurora ✓ shipped, Maeve refs ready).

## GUARDRAILS (founder mandates, permanent)
- Complexity/AI Power always 10/10. Max 3 paid attempts per asset. No checkerboards,
  no board text, no stretched art. Identity locks binding. Server-authoritative ER;
  browser never picks reward type/amount. Never print/log the Meshy key.
- PRODUCTION exists: https://ourrealm.social (no agent access; changes need redeploy).

quirements Document (PRD)

## ✅ MILESTONE (Aug 10 2026): ALL 10 GAMEMAKER RUNTIMES HONESTLY LIVE + MESHY + 3D FOUNDATION
Iterations 131-136 all PASS. Catalog truth: 10 live runtimes, 1 beta (open_world_3d — new OurRealm 3D Runtime v1, three.js WebGL, stays Beta until Meshy-model production pass).
Runtime → featured demo: action_rpg_2_5d→Jungle Ruins/Graybox XY; shooter→Neon Breach (demo-shooter-neon-breach-v1); open_world_rpg→Emberwild (demo-owr-emberwild-v1); platformer→Crystal Caverns (850b4ee4…); top_down_adventure→Cyber Heist (af6cab00…); turn_based_creature_rpg→Dragon Realm (dedicated pixel renderer) + Emberling Grove (demo-crpg-emberling-grove-v1, generic runtime); card_battle→Realm Legends 2-duel arc (fe027e6a…); tower_defense→Realm Defense (70d5bee3…); match3→Crystal Fusion (c0c208b9…); racing→Nitro Circuit GP (465e7b15…); open_world_3d→Ember Spire 3D (demo-3d-ember-spire-v1, renderer_three_v1).
All demo records carry complexity:10 + ai_power:10. All art is original generated (franchise-safe prompts), keyed/trimmed/validated via scripts/wire_assets.py.

### Meshy 3D (Section 5) — foundation COMPLETE in preview, real-key connectivity PENDING production
- services/meshy_provider.py + routers/meshy_admin.py + /admin/meshy founder panel. Workflows mapped per official playbook (text preview/refine v2, image/multi-image/remesh/convert/rig/animation v1, balance health test = no-credit). Idempotency keys, credits per task, GLB validator (magic/version/meshes/materials/animations/checksum), storage via media adapter kind 'models' (/api/media/models/*.glb), archive-before-cancel, global enable toggle, per-task audit. Key NEVER logged/echoed (tested).
- Preview key is placeholder MESHY_KEY_PENDING (honest ok:false). REAL KEY lives in production secrets only → connectivity test + first low-cost model task must run on production (or founder supplies a staging key).
- Queued next: ORAi structured Meshy tools + GameMaker asset-resolution stage 3D controls (generate/preview/approve/rig/animate/save-to-library) — build after real-key connectivity proof.

### OurRealm 3D Runtime v1 (Section 6) — foundation COMPLETE (Beta)
components/games/three/ThreeRuntime.jsx (code-split lazy): WebGL renderer, GLB loading (spec.assets.player_model.url) w/ greybox capsule fallback, PBR-ready lights/shadows/fog, third-person follow camera both axes, normalized WASD/arrow + touch-drag input, circle collision + world bounds, orbs→portal→victory loop (proven E2E incl. collision + victory overlay), DPR cap 2, ResizeObserver, visibility pause (no duplicate rAF), context-loss handlers, window.__OR3D debug. Routed via spec.renderer_id==='renderer_three_v1' in GamesHub.jsx. Promote to Live only after Meshy GLB asset pass + mobile perf proof.

### PRODUCTION BLOCKERS (honest)
1. Production founder credentials differ from preview — cannot run Skybound repair/API/screenshots on https://ourrealm.social. Founder must redeploy (new build string 2026-08-10-runtime-visual-pass-ck3 verifies via /api/health/version), then click Admin→Games→Skybound Chef→Production Repair (keep_stages=11, snapshot+rollback built), or provide prod founder access.
2. Prod DB does not contain the preview demo records/assets. Need a founder-triggered "Sync Showcase Demos" import (bundle export/import endpoint) — QUEUED P0 for next session.
3. Meshy real-key connectivity + first controlled generation: production-only.

## NEXT TASKS (priority)
- P0: Showcase-demo sync bundle endpoint (export from preview → founder one-click import in prod).
- P0 after deploy: Skybound production repair + production screenshots; production acceptance matrix re-run.
- P1: Meshy ORAi tools + GameMaker 3D asset stage; first Meshy GLB into Ember Spire 3D.
- P1: Universal player-shell polish leftovers (pause/mute/restart buttons on parent shell; hide bottom nav in CSS fullscreen — verify).
- P2: Phase 13B-13J (daily-task live updates, ORAi quick buttons, hub pinning, voice-to-voice, saved-games card, dynamic More catalogs, artwork mgmt, multiplayer Coming Soon).

## P0 — VISUAL PRODUCTION PASS PROGRAM (Aug 10 2026) — CHECKPOINTS 1 & 2 COMPLETE ✅
### Founder execution order: Deploy-check → Skybound → Orientation/Fullscreen → Visual passes (2-runtime checkpoints) → Real 3D → Phase 13
### Runtime status truth (catalog routers/gamemaker.py + GameMakerPage fallback)
- LIVE (5): action_rpg_2_5d, shooter, open_world_rpg, platformer, top_down_adventure
- BETA (5): turn_based_creature_rpg, card_battle, tower_defense, match3, racing
- Promotion rule enforced: Live ONLY after real original art integrated in published demo + browser-proven mechanics + zero console errors.

### Checkpoint 1 — Shooter + Open World RPG → LIVE (iteration_131 PASS 12/12 backend, 100% frontend)
- Demos: Neon Breach demo-shooter-neon-breach-v1 (player mech/enemy drones/hex arena art), Emberwild demo-owr-emberwild-v1 (painterly vale, player/enemy/NPC sprites).
- Mechanics browser-proven via temp founder-only proof games (deleted after): shooter portal + stage transition; OWR NPC dialog + quest accept + sealed-gate honesty + defeat quest + world gate + DEMO COMPLETE.
- Asset pipeline learnings: sprites alpha-trimmed via scripts/trim_sprite_padding.py; INCIDENT: a deadlocked production-repair run stripped shooter assets (event-loop block on self-HTTP fetch) — fixed with asyncio.to_thread + unreachable-assets-are-warnings; assets restored from snapshot; guardrail test exists (test_iter131_production_repair.py no-op check).

### Checkpoint 2 — Platformer + Top-Down Adventure → LIVE (iteration_132 PASS + manual td portal proof)
- Demos: Crystal Caverns 850b4ee4 (explorer hero, crystal beetle, cavern art), Cyber Heist af6cab00 (overhead operative w/ glow ring, security drone, facility floor art; td() switched drawEnv→drawBg to kill procedural building clutter).
- New art wired via scripts/wire_pf_td_assets.py (flood-key checker/uniform bg, alpha-trim, validate; checker gray range widened to 60-252 incl. pure white).
- Mechanics proven: platformer walk/jump/collision/pickup/goal-portal ('complete!' in 4s); top_down cores→portal unlock→entry→DEMO COMPLETE (real Playwright keyboard; the iter132 automation stall was a dispatchEvent injection quirk, NOT a game bug). Proof games deleted.
- window.__DBG_TD debug hook added to td() ({cores, portal, obs}).

### Shared engine upgrades this session (GameRuntime.jsx)
- Sprite draw sizes: paintHeroSide h*1.85 + ground glow; paintHeroTop r*4.2 + glow + locator ring; enemy r*3.4, boss r*4.2; npc 46px.
- rotatePrompt self-removes when landscape (iter132-verified).
- Mobile landscape (pointer:coarse, height<520): auto-enters CSS fullscreen container so touch controls stay in viewport.

### Skybound Chef production repair tooling (production verification PENDING deploy — game exists only in prod)
- POST /api/admin/games/{id}/production-repair {keep_stages} (founder-only): full spec snapshot to gm_spec_history, stage trim w/ boss finale preserved, asset validation purge (baked checkerboard / no-alpha / empty sprites; unreachable = warning only), key/portal relationship audit (clears requirements pointing at nonexistent keys), audited.
- POST /api/admin/games/{id}/production-repair/rollback (restores latest snapshot).
- UI: AdminGames.jsx "Production Repair" button (data-testid=game-production-repair).
- After deploy: run production-repair on Skybound Chef with keep_stages=11, then verify Stage 1/11, no checkerboard, HUD, mobile controls on the prod record.

### MAXIMUM QUALITY MODE (founder directive, Aug 10) — clamp audit COMPLETE ✅
- Removed silent AI-power cap min(...,5) in game_build_engine.build_review and game_platform/pipeline (both now honor 1-10; tier 10 = gpt-5.6-terra per llm_router AI_POWER_TIERS).
- Removed complexity clamp min(cx,8) in orai_projects game tool; stage-count cap raised 8→20 (explicit level counts authoritative).
- Defaults raised to 10/10 across: gamemaker quote+create (complexity default was 4!), games.py estimate, orai_projects plan, game_blueprints, platform planner, GameMakerPage aiPower slider.
- MAX_COMPLEXITY already 10 (unlocked). Explicit stage counts remain authoritative (trim/production-repair honor exact numbers).
- 105 gamemaker/blueprint/platform tests pass post-change; production build green.

### Deployment-readiness check (Aug 10) — PASS
- Frontend prod build ✓ (3 rebuild-verifications, exit 0) · backend targeted regressions 12/12 ✓ · health/version keys clean ✓ · no secrets in build JS ✓ · demo seeding idempotent (fixed ids + guarded upserts) ✓ · git auto-commit checkpoints present ✓ · srcdoc parses + games run with zero non-401 console errors (browser-verified) ✓.
- Requires PRODUCTION verification after founder deploys: Skybound repair, prod demo art loading (S3 mirror), prod catalog statuses.

## NEXT AFTER PAUSE (priority order)
1. Creature RPG visual pass (demo: Dragon Realm turn_based_creature_rpg dragonre... published) — then Card Battle (fe027e6a Realm Legends), checkpoint #3.
2. Tower Defense (70d5bee3) + Match-3 (c0c208b9), checkpoint #4.
3. Racing (465e7b15), checkpoint #5.
4. Real 3D WebGL engine (three.js/babylon, code-split; GLB/glTF loading — MESHY_API_KEY intended for model generation once founder supplies real key), Open World RPG + Racing first; greybox foundation ok, Live needs polished original assets.
5. Phase 13B-13J queued (13B daily-task live updates analysis done: follow latest published level config_version, /me?force after claim, focus/poll refresh).

---
(Historical PRD below — see /app/memory/CHANGELOG.md for full details of earlier work.)

## P0 — PHASE 18: PRODUCTION ART (Aug 8 2026) — MILESTONE 1 COMPLETE ✅
Hero Master + Hero Animation V2 + Blue Nexus Portal wired into arpgXY engine; asset pipeline scripts/ingest_phase18_assets.py (S3 upload critical); remaining families gated on founder approval.

## P0 — XY ENGINE V2 (Aug 8 2026) ✅ gray-box vertical slice complete, full traversal E2E PASS (game 9b9b...9b01, schema_version 2 dispatch, arpgSS untouched).

## Aug 4-6 2026 ✅ — Account closure/privacy erasure system, Privacy Center, Legal Center, ORAi platform upgrade (runtime selection, diagnostics, creature RPG v2 ext, fire rewards), production OpenAI-key hardening (health/version reports key cleanliness).

## Aug 2-3 2026 ✅ — Game Creator Phases 1-3, AAA showcase pass (10 games), Fire economy, controls/access systems, education automation, media retry engine, AI access policies.

## Key API endpoints
- /api/gamemaker/* (catalog quote create; statuses live/beta), /api/games/* (+/{id} play data incl. spec.assets), /api/admin/games/* (actions, trim-stages, production-repair[/rollback], fire-economy, controls, orai-edit)
- /api/orai/platform/* (registries, planner, pipeline), /api/media/images/* (307 → S3)

## Key learnings / gotchas
- NEVER fetch own HTTP endpoints synchronously inside a request handler (event-loop deadlock strips data on timeout paths).
- image_store.save_bytes auto-mirrors to S3 (307 redirect path verified).
- games_play access policy blocks non-founder members from legacy showcase games w/o explicit access config (pre-existing; founder-only testing period).
- Playwright: login via /signin form fill (fetch-in-evaluate flaky); iframe content_frame() for game DOM; use REAL page.keyboard (dispatchEvent injection stalls td runtime).
- Backend hot-reload kills in-flight builds; never edit backend files during a build.
