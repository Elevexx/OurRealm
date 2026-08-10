# OurRealm — Product Requirements (UPDATED 2026-06 — ARCANE 3D COMPLETE, PAUSED FOR FOUNDER)

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
