# OurRealm — Product Requirements Document (PRD)

## ⏸️ FOUNDER SAFE CHECKPOINT PAUSE (Aug 10 2026) — ACTIVE STATE
All new runtime, visual-generation and Phase 13 work is PAUSED per founder directive.
MESHY_API_KEY=MESHY_KEY_PENDING placeholder created (backend/.env line 19, server-side only,
gitignored, zero frontend refs, never logged, no Meshy calls made). NOTE: production deployment
secrets are managed separately — founder must add/replace MESHY_API_KEY in Manage Publishing →
Secrets when deploying (workspace .env does not auto-copy to production; see Aug 4 incident).
Everything below this line is preserved completed work. Resume point: Creature RPG visual pass
(next in the 7-runtime order), then Card Battle, Tower Defense, Match-3, Racing, then Real 3D
WebGL engine (Meshy key intended for 3D model generation), then Phase 13B-13J.

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
