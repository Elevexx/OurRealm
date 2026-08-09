# OurRealm — Product Requirements Document (PRD)

## P0 — PHASE 18: PRODUCTION ART (Aug 8 2026) — MILESTONE 1 COMPLETE ✅ (Hero Master + Hero Animation V2 + Blue Nexus Portal wired into the REAL game; awaiting user go-ahead for the remaining asset families)
### Master blueprint = authoritative visual reference (user-attached image, Aug 8). Engine/gameplay LOCKED — art skins the working geometry.
### Delivered this milestone
- Hero Master generated + identity LOCKED (young jungle adventurer, brown spiky hair, brown/gold+green armor, cyan sword). Used as reference image for every animation sheet (identity consistent in-game).
- Hero Animation V2 sheets wired: idle 8f, run 12f, jump_rise 4f, jump_fall 4f, land 4f, attack 10f, dash 8f, cast 8f, hurt 4f, death 8f, climb 6f (climb sheet has ladder baked in — flagged, acceptable, review later).
- Blue Nexus Portal: separate stone frame (magenta-keyed alpha) + vortex sheets drawn with screen-blend: locked 4f / unlocking 8f (plays over the 1.5s unlock) / active 8f loop. ~2 hero heights. Cell-edge artifacts removed (10px border erase + black-floor <56).
- Engine additions (smallest, backward-compatible, in arpgXY only): `sprSt()` bottom-anchored sprite renderer with loop/clamp per state, HSLOT state→slot map, sprite portal rendering with screen-blend; procedural gray-box remains the automatic fallback when a slot is missing. `hero_h:64`, `portal_h:130` spec keys.
- Asset pipeline: `/app/backend/scripts/ingest_phase18_assets.py` — downloads generated grids, slices rows×cols, chroma-keys (magenta for characters / black-floor for glow sheets), normalizes bottom-center baselines, stitches horizontal strips, saves to media dir, **uploads via storage adapter (S3)** — CRITICAL: media_dir alone 404s because /api/public/game-assets 307-redirects to S3 — registers db.orai_assets records, wires spec.assets. author_graybox_v2.py now PRESERVES wired assets on rerun.
- Regression with art active: full traversal drive PASS (1:11) — key pickup, ladder climb, gap cross, summit, portal locked→unlocking→active, stage transition with key carried, DEMO COMPLETE. Screenshots: /app/memory/phase18_shots/.
### NEXT (user gate before mass generation)
- Remaining families per master blueprint: enemies (grunt/viper/skeleton/shaman), Jungle Titan boss, purple underground portal, items (large Ancient Key, chests, potions, heart, fire orb, crystals, torches), terrain kit + pyramid modules, 5-layer parallax backgrounds, Level 2 Nexus set (void drone/energy sentinel/gravity golem, floating platforms, nebula), HUD upgrade, control button reskin, final polish pass.

## P0 — XY ENGINE V2: TRUE 2D MULTI-ELEVATION REBUILD (Aug 8 2026) ✅ GRAY-BOX VERTICAL SLICE COMPLETE — full traversal E2E PASS (awaiting user approval before ANY art generation)
### What was built (user's 28-step plan, Phases 1–17 equivalent)
- Backups: /app/memory/backups_jungle_rebuild/ (GameRuntime.jsx.bak, game_studio.py.bak, author_jungle_spec.py.bak, make_test_game.py.bak).
- NEW engine `arpgXY` in `/app/frontend/src/components/games/GameRuntime.jsx` (search "XY ENGINE V2"). Dispatched ONLY when a stage has `schema_version: 2` — old `arpgSS` untouched, Dragon Realm + jungle v3 fully backward compatible (validate_spec PASS on all legacy games).
- Schema v2 (per stage): world_w/world_h/view_h, spawn{x,y}, solids[] (full AABB walls/floors/ceilings), stairs[] ({x,w,yl,yr} walkable ramps), one_way[] (drop-through with down+jump), ladders[], rooms[] (labels+tints), hazards[] (damage+bounce, NO death pits), checkpoints[] (44px capture radius, heals, keys kept on respawn), keys[] ({key_id,label,x,y}), portals[] ({portal_id, required_key_id, target:'next'|'end', color,label}), pickups[], enemies[] (walker/bat/brute, terrain-probing AI).
- Physics: AABB resolve X-then-Y, 16u step-up assist (fixes ramp→solid seams), coyote time, ramp snap while walking, ladder climb (jump/up engages, exits at top onto one-way), edge-latched jump.
- Camera: smooth X follow with face look-ahead + Y deadzone follow (0.35–0.62 band), world-clamped, shake — whole world renders under one scale/translate (the old arpgSS camY bug where only the hero translated is bypassed entirely in v2).
- Key/Portal state machine: exact key_id→required_key_id; portal states locked → unlocking (1.5s animation when key holder approaches within 160u) → active → enter; keys persist across checkpoints, deaths AND stages (window.__INV2__ + game_key postMessage to Fire Vault with exact key_id).
- Animation V2: distinct blended poses — idle, run, jump_rise, jump_fall, land, dash (afterimages), attack (slash arc), cast (ring), hurt, death, climb; gray-box mannequin.
- Mobile controls REWORKED: fixed-to-viewport circular translucent buttons (no D-pad cross, no Game Boy letters): xy-btn-left/right bottom-left, xy-btn-jump/attack/dash/cast bottom-right, safe-area aware, pressed states, keyboard unchanged on desktop.
- Backend: validate_spec accepts schema v2 (solids/spawn/world dims/portal↔key cross-stage check) — additive, old checks intact.
- Planner routing regression FIXED: `services/game_platform/planner.py` realignment now only swaps to the family engine when its capability score >= the deterministic pick's score (top_down 0.6 could previously override action_rpg_2_5d 1.0). tests/test_arpg_iter122.py 11/11 PASS.
### Gray-box slice (NO ART — per user constraint)
- Game id `9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b01` "GRAYBOX XY ENGINE V2" (published, founder-only access), authored by `/app/backend/scripts/author_graybox_v2.py` (idempotent — rerun to reset).
- Level 1 "Jungle Ruins" 4200×1200: surface → shaft descent (x1560 gap) → underground ruins → spikes/pillar → hidden Ancient Key on pedestal → backtrack left → ladder ascent (x318) → surface backtrack right → gap jump → pyramid WEST ramp up → solid summit → EAST ramp down → guardian brute plateau → Nexus Gate (requires ancient_key) → Level 2 "Nexus Test Area" 1800×800 → Rift Home end portal → PART 2 / COMING SOON. NO fall-to-death anywhere (solid world floor).
- E2E: full traversal script `/app/backend/scripts/e2e_graybox_drive.py` (headless playwright, logs to /tmp/gb_drive.log) — ALL milestones PASS in 56s: descent+Y-cam, key pickup ['ancient_key'], climb state, gap cross, summit y=520, portal ['unlocking','active'], stage transition with key carried, DEMO COMPLETE. Testing agent (iteration_126) verified movement/cameras/ramps/mobile buttons; its 2 blockers (checkpoint radius miss → death respawn confusion; summit seam block) fixed + re-verified.
- Debug hooks for QA: iframe `window.__GB__` (per-frame player/portal/camera state) and `window.__GBGEO__` (full level geometry).
### NEXT (user gate)
- ⛔ DO NOT run the 41 production art jobs until the user approves the gray-box slice.
- After approval: Phase 18+ — art generation, replace gray-box, full Level 1/2 with boss integration, regression tests.

## REUSE-FIRST ADMIN, PRIVACY & LEGAL UPGRADE (Aug 6 2026) ✅ COMPLETE — smoke-tested per user's minimal-testing directive
### Part 1-5: Privacy Center / Recovery / Founder Stats / Data Map / Delete Preview (all extend the Aug 5 closure/erasure/export system)
- Settings>Privacy = unified Privacy Center (`components/account/PrivacyCenter.jsx`, one aggregate endpoint GET /api/account/privacy-center): Data Map (12 real categories with live counts from existing collections), per-category export (data_export.py `_collect(categories)`, reuse keyed by categories_sig), Download My Data, sessions/login-history/devices (NEW `login_history` collection written on login in auth.py, 90-day sweep in purge cron; devices = distinct real user-agents, NO invented data), Sign-out-everywhere (password-gated, reuses password_changed_at revocation), Connected accounts (google_auth) + third-party processor list, Fire Power summary (fire_vault.wallet_for), closure/erasure/permanent-delete cards MOVED here from Account tab (pointer card left behind).
- Recovery card: countdown, scheduled date, reason, Restore, Extend window (POST /api/account/closure/extend, capped 365d total from deleted_at).
- Delete Preview: dataMap prop in CloseAccountModal + ImmediateDeleteModal shows exact per-category removal counts.
- Founder stats: GET /api/admin/privacy/stats rendered as stat grid on the existing /admin/privacy-requests page (pending/overdue requests, pending/completed deletions, closed accounts, restricted retention, avg completion days).
### Part 6: Legal Center
- Backend: `services/legal_docs.py` + `services/legal_seed_content.py` (auto-extracted EXACT wording of the 8 pre-existing static legal pages → seeded as PUBLISHED v1; 4 standard docs seeded as UNPUBLISHED skeleton drafts: acceptable-use, fire-power, responsibility-center, orai; custom pages supported). `routers/legal.py`: /api/admin/legal/* (founder-only) + /api/legal/* public (allow-listed GET in server.py global auth guard).
- Lifecycle: draft/published/archived, immutable `legal_document_versions`, rollback = republish-as-new-version, change summary + effective date required, founder PASSWORD REAUTH on publish/rollback/notices, server-side sanitization (script/iframe/on*/javascript: stripped).
- ORAi section patches: reuses chat_conversations.call_openai_chat (gpt-5-mini), edits ONLY selected '## ' section, minimal diff, before/after, explicit Apply→draft, publish always separate, patches stored in `legal_patches` (doc/section/original/proposed/instruction/model/approver/publication_version) with sha256 duplicate prevention, labeled "Founder Draft (AI-assisted)".
- Notices: `legal_notices` + `legal_notice_acks` (server-side per-user dedupe across devices), modes one_time / ack_required, shown via `components/LegalNoticeGate.jsx` in the authenticated shell.
- Frontend: `/admin/legal` (`pages/AdminLegal.jsx`: doc list, markdown editor, desktop/mobile preview, draft-vs-published compare, history+restore, ORAi panel, publish modal w/ notice composer, custom page creation), public `/legal` + `/legal/:slug` (`pages/LegalCenter.jsx`, published-only, TOC anchors, effective/last-updated). Old routes /terms /privacy /terms-conditions /community /dmca /copyright /safety /cookies /account-deletion now alias into the DB-served pages (LegalPages.jsx static components no longer routed). AdminHub cards added: Privacy Requests (admins) + Legal Center (founder-only).
- NOTE: static /app/frontend/src/pages/LegalPages.jsx retained on disk as wording reference but unrouted.
### Smoke tests run (all pass)
build ✓, founder 403 for non-founder ✓, privacy center aggregate ✓, category export ✓, sanitization ✓, publish reauth (wrong pwd 401) ✓, v1→v2→rollback→v3 immutable history ✓, ORAi patch + dedupe + apply ✓, notice pending→ack→gone ✓, public archive 404 ✓, UI renders (Privacy Center, /legal/terms, /admin/legal editor+ORAi panel, founder stats) ✓.
### Limitations
- Email delivery still MOCKED (no RESEND_API_KEY) — links delivered in-app.
- ORAi legal editing uses the existing OpenAI key per user approval; founder is unrestricted by existing AI policy engine (no per-founder cap system exists → nothing to raise).
- Legal notices "affected users" audience currently behaves as "all users" (no per-doc acceptance tracking predates this feature).

## P0 — ACCOUNT CLOSURE & PRIVACY ERASURE REQUEST SYSTEM (Aug 5 2026) ✅ COMPLETE — tested (iteration_124: backend 13/13, frontend 100%, zero blockers; session-revocation hardening self-verified after)
### User decisions honoured
- Immediate deletion = truly permanent, NO hidden 7-day buffer. Protection = password reauth + exact username confirm + single-use 30-min email confirmation link (in-app notification fallback when no email provider) + all sessions revoked. Founder can stop a running job ONLY before irreversible erasure.
- Privacy erasure requests REQUIRE admin review (no auto-approve/refuse, no indefinite pending — deadline tracking + escalation + overdue + emergency view). Calendar-month GDPR deadlines (1mo, +2mo extension once w/ documented reason within original period; Feb/month-end proven).
- Privacy request alone does NOT hide the account — requester chooses keep-active vs hide-now. Refusal/partial NEVER auto-restores visibility.
- "Apply Restricted Retention" (not generic legal hold): categories + purpose + approver + review date + expiry; founder-only; release endpoint.
### Backend (`services/account_deletion.py`, `privacy_requests.py`, `data_export.py`, `mailer.py`; routers `account_privacy.py` /api/account/*, `admin_privacy.py` /api/admin/privacy/*)
- Separated concepts: Public Removal Service (`remove_public_access` — disabled+status+password_changed_at bump+refresh/user_sessions purge, synchronous), Recoverable Closure (1-365d custom, presets 30/60/90/365), Privacy Request Review, Permanent Erasure Service, Restricted Retention Records.
- 13-stage idempotent claim-locked erasure job worker (30s loop): queued→frozen→auth revoked→public removed→core profile erased(IRREVERSIBLE)→social refs→content→messages→media→processor cleanup(visible/retryable ledger)→backup suppression ledger→integrity verify→completed+requester notified (contact snapshot w/ 90d retention). Retry w/ backoff (max 8/stage), admin retry + founder stop-before-irreversible.
- `deletion_suppression` ledger + `run_suppression_pass()` (every ~30min) re-erases accounts resurrected by backup restore.
- Recoverable-closure expiry now routes through the SAME job pipeline (`run_purge_pass` → enqueue, source=closure_expired). Purge cron also runs: privacy reminder pass (admin notifications urgent/overdue, 1/day/request), closure-expiry warnings (7d before, once), export expiry sweep.
- Data export: JSON of own data only, token-gated (sha256), 48h expiry, 5 downloads, audit-logged create+access.
- Mailer abstraction: Resend if RESEND_API_KEY set, else records to `outbound_emails` (status logged_no_provider) + in-app notification fallback for the deletion confirm link. NO EMAIL PROVIDER CONFIGURED YET.
- SESSION REVOCATION HARDENED: `core/deps.py` pending-restore early-return now also enforces iat<password_changed_at → pre-closure access JWTs die instantly (self-verified 401).
- Manual intake endpoint (backdated received_at + original message preserved as restricted evidence) for requests received via other channels — use for the real user's pending request via /admin/privacy-requests → "Log request received elsewhere".
### Frontend
- Settings>Account "Data & Privacy" zone (4 cards): DataExportCard, CloseAccountModal (presets+custom 1-365, reauth), PrivacyRequestModal (jurisdiction, keep-active vs hide-now, reauth), ImmediateDeleteModal (2-step w/ confirm link) + open-request status card w/ withdraw. Old DeleteAccountModal REMOVED.
- `/confirm-deletion?token=` final-warning page; `/admin/privacy-requests` queue (stats, emergency/overdue views, decision panel incl. founder restricted-retention form, extension, identity actions, manual intake, Deletion Jobs tab w/ 13-stage checklist + retry/stop). Linked from /admin/support header.
### New collections
`privacy_erasure_requests`, `account_deletion_jobs`, `account_deletion_confirmations`, `deletion_suppression`, `restricted_retention_records`, `processor_cleanup_tasks`, `data_export_jobs`, `data_export_files`, `outbound_emails`.
### Backlog from this task
- P1: Configure a real email provider (Resend key) so confirmation links + lifecycle emails send for real; set PUBLIC_APP_ORIGIN for absolute links.
- P2: Known pre-existing dev-only hydration warning (<span> in <option>, platform instrumentation) — cosmetic.

## P0 — COMPLETE ORAi PROJECT CREATOR PLATFORM UPGRADE (Aug 5 2026) ✅ ALL 6 PHASES DONE — 29/29 targeted checks + desktop/mobile UI verified
### Phase 1 — Runtime Selection Accuracy (finished the in-flight patch)
- `services/runtime_selection.py`: 36-mechanic deterministic taxonomy (regex patterns incl. real-time movement, action combat, cooldown abilities, top-down exploration, platforming, puzzle solving, boss battles, survival, tower defense, card battles, evolution), 22-runtime capability matrix (supported vs honest approximation), CORE-mechanic gating, ranked walk-down, deterministic pick ALWAYS beats the LLM hint.
- `gb.plan_blueprint` runs selection BEFORE the LLM call → incompatible requests get HTTP 422 with report {requested_mechanics, closest_matching_runtime, compatibility_score, supported_mechanics, unsupported_mechanics, missing_runtime_capabilities, blocking_reason, recommendations} — ZERO LLM cost, no blueprint ever created. Doc gains additive `runtime_selection` + `runtime_recommendation.mechanics_selection`.
- Platform planner only realigns to family engine when that engine is in `compatible_runtimes`.
- Frontend OraiProjects.jsx: `compatReport` state + panel (data-testid compat-report/-requested/-closest/-supported/-unsupported/-recommendations/-dismiss); cleared at every plan start (no stale data); loading always ends (finally). Verified desktop + mobile (no overflow).
- Verified: action prompt→top_down (never tbcr); creature prompt→tbcr; plain rpg→rpg; RTS→422 stop.
### Phase 2 — Diagnostics & Founder Visibility (`services/game_platform/diagnostics.py`)
- 14-category Founder Validation Report (runtime_contract…platform_compatibility) each with status/rule/exact error/affected/suggested_fix; GET /api/orai/platform/blueprints/{bid}/report returns report+timeline+summary+history (copy/download-ready JSON).
- Deterministic Auto Fix (POST …/autofix, NO LLM): dedupe req_ids, reset broken asset links, relink registry family, declare save hooks, insert missing NPC/quest-giver + catchable creature in built specs, attach default fire economy (disabled). History in `autofix_history`.
- 10-stage live timeline (Planning→Publish) with waiting/running/passed/auto-fixed/failed; completion summary (runtime, compat score, assets reused/deferred, validations, auto-fixes, warnings, est vs actual AI usage, build time); build history (last 10 games per blueprint). Actions: Retry Validation=/validate, Auto Fix=/autofix, Retry Build=/build (duplicate-proof+stale-resume).
### Phase 3 — Creature RPG V2 extensions (`services/game_platform/creature_ext.py`, registry `creature_rpg_extensions`, all optional/versioned/rollback-safe)
- evolution (level/item/quest/condition triggers, branching, stat/ability changes, v1 save migration via evolution_stage) — POST /creature/evolution/apply
- multiplayer_foundation (lobby create/join/leave/reconnect, invite codes, max_party, single-player fallback; NOT MMO) — /creature/sessions/{action}, collection `game_sessions`
- trading (two-party confirm, atomic find_one_and_update status transition, duplicate accept→409, cancel/timeout, history, no real money) — /creature/trades/{action}, collection `creature_trades`
- procedural_regions (sha256-seeded deterministic tiles/encounters/landmark/objective; same seed → identical region) — /creature/regions/generate
- crafting (single guarded $inc update = atomic consume+produce; missing_ingredients 422) — /creature/craft
- battle_ai (profiles aggressive/defensive/boss_phase, lowest_hp/highest_attack targeting, elemental fire>grass>water>fire, status awareness, phase multipliers, difficulty scaling, deterministic fallback) — /creature/battle-ai/decide
### Phase 4 — Editor + assets
- Universal Editor sections added: evolution_rules, parties, ai_profiles, multiplayer_rules, trades, procedural_settings, recipes, items, difficulty, accessibility, fire_power (→ blueprint.extensions.*).
- Asset priority classification on every requirement: required_to_play / optional_gameplay / polish / marketing (music/sfx/voice=polish, promotional/cinematic=marketing). Prototypes never blocked by optional media.
### Phase 5 — Fire Power creature rewards (registry data, zero hardcoded amounts)
- economy registry fire_power gains `creature_rewards` table (creature_victory 5, boss_victory 30, capture 10, evolution 15, quest 20, achievement 10, region 12, multiplayer 8, event 25, daily 15, seasonal 40, difficulty_bonus_pct) + policy flags (burn confirmation, never required for story, no monetary value). Founder edits via registry upsert (versioned/rollback).
- POST /creature/rewards/claim: atomic claimed-marker guard + idempotent fire_vault credit_fire (gfp:* key), duplicate→409, ledger rollback on credit failure. VERIFIED claim + duplicate rejection.
### Known bugs fixed during verification
- claim duplicate-check used projection {"id":1} → empty-dict falsy → duplicates paid; fixed with {_id:1} + `is not None`.
- battle AI elemental table was inverted (fire beat water); fixed to fire>grass>water>fire.
### Test artifacts: /tmp/test_phase_all.py (29 checks). V1 game afd7f93… + blueprint ef83944… intact.

## P0 — TURN-BASED CREATURE RPG RUNTIME v1 (Aug 4 2026) ✅ COMPLETE — minimal-credit build, all checks verified
- Promoted `turn_based_creature_rpg` from scaffolded to a FIRST-CLASS generatable runtime (`runtime_turn_based_creature_rpg_v1`, `tpl_turn_based_creature_rpg_v1`) reusing the vetted rpg engine machinery (renderer alias in GameRuntime.jsx `turn_based_creature_rpg: rpg` — party/catch/turn-based combat/quests/XP already engine features).
- game_studio.py: RUNTIMES + labels + WIN_LOSS + RUNTIME_MECHANICS (15 systems) + IDENTITY_BASE + controls maps + EST/SPEC prompts + spec schema (creatures 1-3 catchable REQUIRED, starter_creature REQUIRED) + validate_spec creature rules. SCAFFOLDED_RUNTIMES now empty. GENRE_MAP: jrpg/party combat/tame monsters/wizard rpg/dragon collecting/creature battles → tbcr ("rpg" alone still → rpg).
- Platform registry: family updated (engine tbcr, runtime_id/template_id v1, extension_points: advanced_evolution, multiplayer_battles, procedural_regions, crafting, advanced_battle_ai); creature_collector family → tbcr engine. Capability recommend verified.
- mechanics_support FIX (all runtimes): LLM-flagged unsupported mechanics now override token-overlap (never fake support); tbcr vocabulary enriched. Verified: taming/village quest/party combat supported; online trading honestly unsupported.
- BUILD ENGINE FIX (all runtimes): first spec pass returning empty/invalid JSON no longer kills the build — logged + retried in the refinement loop (root cause of one failed build during testing).
- Universal Editor: new sections creatures/npcs/battles/regions (aliases into blueprint gameplay paths). Verified live edit ("Moonlit Owl Spirit") + version bump.
- Fire Power: reused existing infra — FIRE_ECON_DEFAULTS auto-attach on build; founder-editable via PATCH /api/admin/games/{id}/fire-economy (verified 12); claims stay ledger-backed/idempotent. No redesign.
- E2E verified (preview): platform plan → family+engine tbcr, blocked-report for unsupported → approve → build (c1/p3, ~$0.06 total) → game "Ranger of the Woodland Spirits (Simple)" tests-passed, PLAYABLE (Elder's Village grid, HP/Lv/XP HUD, quest, NPCs, catchable creatures, party slot). Game left in pending_approval for founder; blueprint "Whisperwood Bonds" draft. No media generated, nothing published, Dragon Realm untouched.

## ORAi PROJECT CREATOR — FOUNDATIONAL PLATFORM UPGRADE (P0, Aug 4 2026) ✅ COMPLETE — tested (self 35/35 + iteration_121 18/18, zero action items)
### Architecture: registry-based reusable game platform (`services/game_platform/` + `routers/game_platform.py`, all additive — zero contract changes)
- `registry_core.py` — ONE generic versioned Registry engine (collection `platform_registries`): code-seeded defaults + DB overrides/additions (new entries = DB insert, no core-code change), version bump + 15-entry history + rollback + enable/disable, 15s cache.
- **10 registries live**: runtimes (35 families), templates, renderers (canvas_2d/dom_ui/hybrid/webgl_light-foundation), gameplay_systems (19), economy (5 modules), fire_hooks (10), ai_capabilities (7), validators (10), plugins (hook points), + virtual assets (orai_asset_library) & projects (blueprints+games) registries in the overview.
- **Runtime engine** (`runtime_registry.py`): 35 families with honest maturity — 21 generatable (direct vetted engine), 9 partial (approximation with DECLARED substitutions: action_rpg, open_world_rpg, survival, shooter, twin_stick, simulation, party_game, horror, metroidvania), 5 foundation (rts, sandbox, mmo_foundation, sports, physics_sandbox — build REJECTED). `recommend_capability_runtime`: capability-token overlap + genre boost + multiplayer penalty; refuses forced fits (foundation family dominating by >0.2 → recommended=None with guidance). Stealth = generatable (top_down vision cones).
- **Multi-stage planner** (`planner.py`): 15 recorded stages — understand → detect genres/mechanics/multiplayer/economy (1 cheap LLM analysis call) → capability runtime rec (reject bad fits) → renderer rec → blueprint via existing vetted gb.plan_blueprint (+change_runtime alignment) → reusable-asset detection → library search → cost estimate → grouped validation → unsupported report → recommendations → blocker check. Doc gains additive `platform{runtime_family, renderer, analysis, capability_recommendation, grouped_validation, providers}` + `planning_stages`.
- **Validation registry** (`validation_registry.py`): 10 parallel validators (runtime/mechanics/assets/economy/save/multiplayer/mobile/desktop/performance/security) → grouped {supported, partially_supported, missing, recommendations, overall}. Never silently downgrades.
- **Universal editor** (`pipeline.py`): 14 editable sections (mechanics/levels/enemies/bosses/maps/dialogue/quests/rewards/assets/lighting/audio/ai/ui/progression) — LLM patches ONLY that section (type-checked), version bump, `edit_history` (30 entries) with per-edit rollback. Games remain editable via existing orai-edit.
- **Unified resumable pipeline** (`pipeline.py`): Blueprint→Asset Resolution→Content Generation→Runtime Assembly→Validation→Founder Preview→Publish. Stage state DERIVED from ground truth (blueprint + linked game) → always accurate after interruption. Duplicate builds → 409; stale interrupted builds (>10 min no progress) auto-failed with root_cause + recommendation and resumed fresh. Pre-build validation failure → 422 with root cause. E2E-verified: approve → build (dup 409) → generating_spec → refining → pending_approval → approve+publish = 7/7 → test game unpublished+archived.
- **Provider system** (`capability_registry.py`): text/image/video/audio/music/voice/3d → priority provider selection with key-sanity check (non-ASCII keys rejected) + honest degradation (music/3d degrade to library-reuse/2.5D).
- **Economy framework** (`system_registry.py`): fire_power/experience/coins/resources/custom modules — reward tables are REGISTRY DATA (founder edits via registry upsert, versioned+rollback; verified pickup 1→2→rollback). 10 Fire Power hooks all route through the existing ledger-backed idempotent grant path (gfp:* keys, atomic pool decrement, server-authoritative).
- **Routes** (`/api/orai/platform/*`, founder-only, non-founder 403): registries overview/entries/upsert/rollback/enabled, runtimes catalog, recommend, plan (30/hr rate-limited), providers, systems, economy, blueprints/{bid}/validate|edit-section|edit-rollback|pipeline|build, projects.
- **Regression verified**: legacy /api/orai/projects/blueprints/plan contract unchanged; /api/games hub (28 games) intact; ORAi chat 200 direct OpenAI; no DB migrations (all new collections/fields additive).
- Frontend cockpit for these APIs = P8 (Game Creator Founder Cockpit) — not in this task's scope.

## PRODUCTION VERIFICATION — "Hit a snag" P0 ✅ RESOLVED & FULLY VERIFIED (Aug 4, 2026)
### ROOT CAUSE (production-only 500 on ORAi chat)
- Production deployment's `OPENAI_API_KEY` env var contained a corrupted character: Cyrillic "Т" (U+0422) at position 15 instead of Latin "T" (paste artifact). httpx raised `UnicodeEncodeError` while building the Authorization header — BEFORE any HTTP request — and that exception type escaped `except httpx.HTTPError`, hitting the global 500 handler. Preview's key was clean → preview always worked. Production env vars are managed separately in deployment settings (NOT copied from workspace .env).
- Discovery path: global 500 handler now persists tracebacks to `unhandled_errors` collection; founder-only `GET /api/admin/system/errors?request_id=` returns them. This is how the prod traceback was captured remotely.

### Fixes shipped (build `2026-08-04-openai-key-hardening`, live on prod)
- `services/chat_conversations.py` `call_openai_chat`: `_clean_key()` strips + rejects non-ASCII keys with a precise log (position + codepoint); corrupted primary key → graceful Emergent fallback instead of 500. Attempt-1 also catches generic `Exception` → falls through to fallback. Covers ORAi chat AND llm_router (planning) since router routes via call_openai_chat.
- `server.py`: `/api/health/version` now reports `openai_key_clean` / `emergent_key_clean` booleans (remote env validation, no secrets); unhandled-error traceback store + founder errors endpoint.
- User re-pasted a clean OPENAI_API_KEY into deployment env settings + redeployed.

### FINAL PRODUCTION VERIFICATION (all PASSED Aug 4, 2026)
- /api/health/version → build `2026-08-04-openai-key-hardening`, openai_key_clean=true
- ORAi chat: HTTP 200, exact reply "production matches preview.", provider=openai, model=gpt-5-mini-2025-08-07, fallback_used=False
- Planning smoke test (Complexity 1, AI Power 3, text-only): blueprint "Arena of the Apprentice" (top_down, 26 asset requirements, valid_with_warnings, pending_founder_approval), asset library search ran (prod library empty — expected), build/status = draft/no game, NO media generated, NO build started. Draft left on prod (harmless).
- Desktop 1920px + mobile 390px production UI: user message renders ONCE, reply ONCE, no "hit a snag", Project Summary NOT auto-filled, no horizontal overflow.
- KNOWN QUIRK (cosmetic, first load after each deploy): service worker `controllerchange` reload can abort an in-flight login (`asset-fail reason: controllerchange`) — a page reload fixes it; consider deferring SW-triggered reloads while a form submit is in flight (backlog P2).
- Production now MATCHES preview. User told it is SAFE to revert the temporary stealth password.
- ZERO COST RULE held: no media, no Dragon Realm build. P1-P11 NOT started (next up: P1 Founder Moderation Cockpit).

## AAA SHOWCASE QUALITY PASS — Complete 10-Game Library (Aug 3, 2026) ✅ COMPLETE — tested (iteration_115, 100%)
### The 10 Founder Showcase games (all published, unique runtime/mode/rep, cover art + genre, demo reward 100 🔥)
1. Temple of Echoes dfb1c04e (puzzle_room · Puzzle Exploration)
2. Galaxy Salvager d36d0d04 (dodge/space_flight/spaceship · Space Survival)
3. Crystal Caverns 850b4ee4 (platformer/platform_hero · Platform Adventure)
4. Cyber Heist af6cab00 (top_down/stealth_operative · Top-Down Stealth)
5. Starlight Drummer cef889d9 (rhythm · Rhythm & Music)
6. Neon Core Rush: Velocity Demo 5b171783 (dodge/road_3d/hovercraft · Arcade Racer)
7. Arcanum Cards 5eb9556d (matching/cards · Memory Strategy)
8. Skyforge Cargo Command 88b63899 (sorting/cards · Sorting Strategy)
9. Neon Tunnel Drift 2f9d083b (dodge/tunnel/hover_bike · Tunnel Racer)
10. Chrono Rift 9f2895d0 (quiz_adventure/puzzle_cursor · Story Adventure)
Diversity endpoint: 0 flagged pairs. Original "Neon Core Rush" (193b8eeb) unpublished (duplicate of Velocity Demo). RTTEST games unpublished earlier.

### Engine-wide AAA polish (GameRuntime.jsx — ALL games inherit automatically)
- Cinematic title screen ("ORAi PRESENTS" + animated glowing title + ambient particles + TAP/KEY to start)
- Stage intro banners (STAGE N/M + title, animated in/out), victory screen (trophy, stats grid: score/best/time/combo/accuracy, confetti, achievements chips, Fire Vault hint), game-over screen (stats grid), CSS vignette + top-glow bloom overlays on every canvas, checkpoint "⚑ CHECKPOINT" popups, injected keyframe animation system (orpop/orbanner/orconf/orglow...)

### Living Projects v1 — Edit with ORAi (games_plus.py orai-edit + GameOraiEdit.jsx)
- POST /api/admin/games/{id}/orai-edit {prompt, scope, add_stages, ai_power, dry_run} — dry_run returns cost estimate FIRST; real run patches ONLY the requested scope, preserves the rest, forces runtime+player_rep, validates spec, creates a new version, audits cost
- EDIT_SYSTEM has an honest ENGINE_CAPS contract: unsupported asks (multiplayer, gamepad, 3D, video, voice) are declared in `_substitutions`, never faked
- UI: prompt box + quick chips (New Biome, Boss Stage, Better HUD, More Animations, New Ending, Endless Mode Feel, Side Quests, Seasonal Event) + dimmed Multiplayer/Controller chips with honest warnings + Generate More Levels (add_stages) + scope select + Estimate→Apply flow

### Fire economy upgrades
- Demo completion reward default 100 🔥 (all showcase + new games), anti-abuse: daily_player_cap + claim_cooldown_s enforced in _pool_grant (ledger-backed), editable in Fire panel
- Runtime router hardened: word-boundary keyword matching + generic action keywords checked LAST (fixes "rift-runner"→dodge misroute); story/quiz phrasing now routes correctly

### Premium /games hub
- 10 AI-generated cinematic covers (stored on game.cover_url + genre label); public list returns cover_url/genre/fire_max; card grid: cover art (4/5), genre chip, "🔥 up to N", Play button, hover scale — matches the user's reference image
- Public GET /api/games/{id} now always returns populated controls (defaults applied)

### Known learnings
- Backend hot-reload KILLS in-flight game builds (async task lost → stuck "building"). Never edit backend files while a build is running; stuck builds must be deleted via DB.
- Nohup launches from execute_bash can double-fire if the command times out — check for duplicate runs.

## GAME CREATOR POLISH — Player Diversity + Fire Economy + Controls (Aug 3, 2026) ✅ COMPLETE — tested (iteration_114, 100%)
**User plan approved: Phase A (diversity) → Phase C (engine polish) → Phase B (Living Projects). A is DONE; C is NEXT; B after.**

### Fixed first: GameRuntime.jsx compile error (stray `;}` at EOF) — production build verified before any paid generation.

### Founder Showcase — first batch LIVE (6 showcase games, published)
- Temple of Echoes (puzzle_room, C6, puzzle_cursor) dfb1c04e68f64a55bb7673ead2bacae0
- Galaxy Salvager (dodge_collect/space_flight, C8, spaceship) d36d0d0472054c5ab6da438d0bc8f865
- Crystal Caverns (platformer, C7, platform_hero) 850b4ee4b6ed48899229355aa86d5e9a
- Cyber Heist (top_down, C7, stealth_operative) af6cab00d0d2406892d8bcb0b419e234
- Starlight Drummer (rhythm, C5, rhythm_notes) cef889d900e04908bf69efdc6e1321fa
- Neon Core Rush: Velocity Demo (dodge_collect/road_3d, C10, hovercraft) 5b171783b8714cc8a63be54ca0105d39
- AWAITING USER REVIEW before generating the remaining games (user wants /games to feel like a pro indie showcase).

### Phase A — Player Representation + Structural Diversity (game_studio.py, games_plus.py, games.py, GameRuntime.jsx)
- `PLAYER_REPS` contract per runtime; `player_representation` REQUIRED in plan+spec (validate_spec enforces); renderer painters: hovercraft/spaceship/hover_bike/runner/rolling_orb (dodge), animated humanoid heroes w/ knight/robot/wizard/explorer variants (platformer), overhead operative w/ vision cone/robot/knight/wizard (top_down). No more default rockets.
- `plan_identity()` + `identity_similarity()` — structural comparison (runtime family, control model, player rep, camera, mode, interaction, environments). Estimate shows Game Identity block + showcase similarity; `blocked` at >=0.75 → approve_and_build returns 400. games_plus spec_similarity rewritten to use it. Verified: Galaxy Salvager reskin scored 0.9 → blocked; unique concepts pass.

### Fire Power Economy (per game — reuses existing Fire Vault ledger, NO parallel economy)
- `fire_economy` on every game: pool 1,000,000 default, enabled by default, pausable; rewards config (completion/perfect/speed+speed_time_s/hidden_objective/achievement/boss/daily/weekly/final_completion).
- Grants on validated score submit: atomic pool decrement guard + `credit_fire(sender="game_fire_pool", finalize_at=now)` → immediately claimable in Fire Vault → player presses Claim (`POST /api/fire/wallet/collect {"collect_all":true}`). Idempotency keys `gfp:*` make replay/refresh/duplicate abuse impossible (verified: replay returns []).
- Endpoints: GET/PATCH `/api/admin/games/{id}/fire-economy` (+actions refill/reset; every change = new game version), public GET `/api/games/{id}/fire-info` ("Fire Rewards Currently Disabled" when off/paused). Analytics: distributed/claimed/unique claimants/avg/largest/claims today-week-month.
- UI: `GameFireEconomy.jsx` founder panel (stats grid, toggles, pool+refill/reset, reward inputs, preview: avg/max per player, worst-case month, completions supported, % remaining); GamesHub fire banner before play. Clones get a fresh full pool.

### Controls & Input Modes (per game, versioned)
- `controls` config: desktop_enabled/mobile_enabled (both default ON), keyboard_map remapping (conflict + missing-action validation, 400 on invalid; publish BLOCKED when no mode can play), touch settings (button size/opacity/position, joystick size, sensitivity, swipe, hold/toggle), accessibility (left-handed, haptics, reduced motion, high contrast, control guide).
- Renderer honors all of it: `act()` remap layer, P pause / R restart, pointerType gating (touch vs mouse), input auto-detect + seamless switching, control-guide overlay at start, vibration on hit, reduced-motion shake gate, high-contrast filter.
- Endpoints GET/PATCH `/api/admin/games/{id}/controls`; UI `GameControlsPanel.jsx`; creation flow "Supported controls" select (Auto/Desktop/Mobile/Both, default Both) + estimate identity shows desktop map + touch layout.

### NEXT (user-approved order)
1. **Phase C — engine-wide polish** (animations, particles, lighting, HUD, transitions, stage intros/outros, ambience, camera, menus, procedural variety) so every game inherits it.
2. **Phase B — Living Projects** (ORAi Project panel w/ per-section Edit with ORAi, Generate More Levels, prompt box, scope-limited regeneration, version compare/fork/merge). Cost shown before every targeted edit; never rebuild more than requested.
3. Remaining showcase games after user reviews the first batch.
- Backlog: modularize AdminOrion.jsx (P2); AdminGames.jsx growing (463→~540 lines, watch).

## PHASE 3 — Game Creator Phase 1 + Education Completions (Aug 2-3, 2026) ✅ COMPLETE — tested (iteration_113, 95%→fix applied)
**Verified E2E: estimate ($0.04 shown BEFORE build) → founder Approve & Build → staged build (design→spec→refine→automated validation tests) → pending_approval → publish → /games hub → playable sandboxed game → progress save → non-founder 403 → full audit. ORAi chat "create a game..." → GAME PLAN READY card → PREVIEW BUILD deep link → estimate card → cancel (no build). Review Friday lesson + Parent Digest verified.**
- `services/llm_router.py`: provider-agnostic AI Power 1-10 routing — ALL tiers via direct OPENAI_API_KEY (Emergent universal key only as fallback inside call_openai_chat): 1-2 gpt-5-nano · 3-6 gpt-5-mini · 7-8 gpt-5 · 9 gpt-5.6-luna · 10 gpt-5.6-terra, real passes + token budgets + est cost per tier; router-level fallback openai/gpt-5. (Repaired June 2026 — obsolete gpt-5.4* names removed; temperature stripped for all gpt-5* models since the family rejects non-default temperature, which had been forcing every call onto the Emergent fallback and burning budget.)
- `services/game_studio.py`: sandboxed spec + vetted runtime architecture. 5 runtimes: quiz_adventure, matching, sorting, memory, rhythm. Complexity 1-3 functional (3 = adaptive+achievements), 4-10 honestly locked (API 400 + UI lock note). `create_estimate` ALWAYS before build; `start_build` async staged pipeline w/ build_log, refinement passes per AI Power, `validate_spec` automated tests (block approval), actual_cost tracked. Collections: games, game_estimates, game_progress, game_audit, game_reports.
- `routers/games.py`: founder `/api/admin/games` (overview, estimate, build, cancel, actions approve|decline|publish|unpublish|archive|regenerate(feedback)|delete, audit) + public `/api/games` (hub w/ search, play data, progress w/ best score/attempts, report). games_play + game_creator registered in Access Policy Engine; DEFAULT founder-only (invite_only seeded) — configurable at /admin/ai-policies (now 6 features).
- ORAi chat: "create/build/make…game" (founder + policy) → estimate → chat card "GAME PLAN READY — APPROVAL REQUIRED" w/ cost + PREVIEW BUILD → /admin/games?estimate={id}. Nothing builds without approval.
- Frontend: `components/games/GameRuntime.jsx` (iframe sandbox="allow-scripts", separate origin, postMessage scores only), `pages/AdminGames.jsx` (/admin/games Game Studio: Complexity slider locked 4-10 + AI Power slider w/ tier labels, estimate approval card, build polling, playable preview, action bar, 403 denied panel), `pages/GamesHub.jsx` (/games: search, continue playing, play view w/ best score + report). AdminHub "Game Studio" card.
- Education completions: **Review Fridays** (schedule.review_day default fri → weekly recap lesson from the week's lessons + quiz results; verified "Weekly Review: Number Sense and Programs") and **Parent Digest** (`edu_plan_digests` + owner notification after each daily generation: per-student lesson/status/prev-quiz/adaptation; panel on EduPlans page).
- Demo: published game "Bake the Fraction Feast" (4ac780017dc7472eac2e2a59d7475988).

## STAGE 1 — Autonomous Multi-Student Education (Aug 2, 2026) ✅ COMPLETE — tested (iterations 111+112)
**Verified E2E in preview: ORAi chat command → LEARNING PLAN READY card → PREVIEW & APPROVE deep link → approve & activate → 4 first lessons generated (grade/subject/accessibility-aware, adaptation notes, quizzes, images) → adaptive day-2 lesson (subject rotation, prev-progress context) → dedup, cap-pause+notify, resume, audit trail. Testing agent: backend 5/5, frontend 100% (after 2 fixes).**
- `services/education_plans.py`: plan engine. `draft_plan` (LLM parse of natural language → students/days/duration/time/mode/notes; reads LIVE `rc_member_education` grade/subjects/ai_power/accessibility + `rc_course_progress` stats; flags missing info instead of asking twice). Statuses: pending_approval→approved→active→paused/completed/declined/changes_requested/archived. `activate` generates first lessons immediately + sets schedule. Adaptive `_generate_student_lesson`: subject rotation across selected subjects, continues from previous same-subject lesson + quiz score (reinforce if weak), one course per student ("Daily Lessons" module, published), image per lesson (media_retry on failure), student notification, parent_note stored. Caps (daily/weekly/monthly/total lessons + cost): pause + notify owner, never silently exceed; resume allowed. Scheduler: 5-min DB-only loop (started at startup, restart-safe, claim-locked via last_generated_date), fires at plan generation_time in center timezone, weekday/skip-date aware, auto-completes plans past end_date. Collections: edu_plans, edu_plan_runs, edu_plan_audit.
- `routers/education_plans.py`: `/api/responsibility-center/{cid}/edu-plans` (draft/list/detail w/ upcoming dates + can_approve, PATCH edit — student grade/subjects edits persist back to rc_member_education, action endpoint: approve[+activate]/decline/request_changes/activate/pause/resume/skip_date/generate_next_now/retry_failed/end/archive/delete). Approval = center creator or founder (manage_roles). course_maker policy checked on draft.
- ORAi chat hook (`orai_assistant.py`): education intents ("create/plan + lesson/curriculum/learning plan") → drafts plan from live center data → returns structured `card` {title LEARNING PLAN READY / NEEDS DETAILS, lines (students/days/schedule/estimated $), button PREVIEW & APPROVE → `/responsibility-center/{cid}/edu-plans?plan={id}`} in chat response + stored in history.
- Frontend: NEW `pages/EduPlans.jsx` (`/edu-plans` route, linked from Education Center nav "Education Automation"): plans list, detail w/ status pill, 6-stat grid (students/days/lessons/time/est-daily/est-total), full action bar per status, live student profile editor (grade/subjects/adjustments → saves to education profiles), upcoming lessons, generated runs w/ adaptation notes + failed retry. `OraiAssistantPanel.jsx` renders green result cards w/ big deep-link button.
- **P0 Desktop ORAi panel FIXED**: portaled to document.body + inline `position:'fixed'` (`.or-surface{position:relative}` in index.css was overriding Tailwind `.fixed` — root cause). Verified at 1920/1366/768/390 widths: bottom-right 460px desktop, 420px tablet drawer, mobile bottom sheet, internal scroll, no page reflow.
- **Regression fixed**: CourseMaker `locked` undefined crash (a prior edit was reverted by a test checkout; re-applied banner + const).
- Preview stand-in students seeded (production will use real members): ash/pixelprincess/dragonx/neo (Student1$) in Johnson Family Learning center — see test_credentials.md. ACTIVE demo plan eba3173816ef4e5c833af20793807444 generates 4 lessons daily at 19:00 UTC (~$0.24/day) — pause from /edu-plans anytime.

## STAGE 2 — ORAi Game Creator Phase 1 (NOT STARTED — next up, user approved plan)
User decisions: sandboxed game-spec + vetted runtime architecture (Complexity 1–3 real, 4–10 visible but locked); AI Power 1–10 all functional via multi-provider Emergent universal key routing; cost estimate ALWAYS before build; approval before build + publish; /admin/games (OurRealm Game Studio) + /games hub + Course Player mini-game blocks; release/access modes via AI Access Policy Engine (extend with blocklists, account age, course membership, AND/OR groups); Fire Power options (burn per game/generation/month); full audit; mobile QA.

## Sprint 1 — Configurable Media Retry Engine (Aug 2, 2026) ✅ COMPLETE — tested (iteration_109, 100%)
**Verified: self-test E2E (seeded video retry → worker ran dry-run pipeline → attached to block; cover retry generated real cover; failure path proven with exact provider error + backoff scheduling) + testing_agent 7/7 backend, 100% frontend.**
- `services/media_retry.py`: DB-backed retry engine for failed media-pack assets (cover/image/video). Configurable schedule `ai_video_settings.retry_schedule_seconds` (default [20,120,300,900,1800] — editable in /admin/ai-video Settings, `aiv-set-retry-schedule`). Worker loop (15s scan, claim-locked) started at startup after 5s; RESTART-SAFE (reclaims `retrying` → `waiting`, reads only DB → resumes after refresh/reconnect/deploy/restart). After final attempt → `needs_attention` with EXACT provider error preserved + user notification. Manual requeue (selected ids or all) resets attempt cycle, runs immediately. Video retries rotate through generation providers in priority order (failover; `start_video_job` gained `provider_name` param). Collection `rc_media_retry_tasks`.
- `rc_courses.py`: `_generate_media_pack` enqueues every failed asset (cover/image/video-blocked/video-failed) for auto retry; gen job gets `course_id` set as soon as the course doc exists (dashboard attaches mid-run). NEW endpoints: GET `/{cid}/courses/{course_id}/media-status` (unified dashboard: stage, current_task, provider_label masked, queue_length+position, retry_count, pending_retries, eta_seconds, overall_pct, images/videos/audio/activities {planned,done,failed}, remaining_assets, failed_assets w/ error+attempt+next_retry_at) and POST `.../media-retry` {task_ids|null}. `course-gen/active` also reconnects to DONE jobs whose media still retries/needs attention. Cancel endpoint also cancels pending retry tasks.
- Frontend: NEW `components/rc/MediaPackDashboard.jsx` (polls 6s; stage header, engine/queue/retries/ETA/remaining stat row, 4 media tiles, retrying list w/ attempt counters, needs-attention list w/ checkboxes + exact errors, Retry Selected / Retry All Failed, Open Course in Editor; testids `media-dash-*`). `CourseMaker.jsx`: renders dashboard when job.course_id exists; on done does NOT navigate away if media still pending/failed.

## Sprint 2 — Reusable AI Access Policy Engine (Aug 2, 2026) ✅ COMPLETE — tested (iteration_110, 100%)
**Verified: self-test curl of every rule type (level deny, badge allow, invite-only deny→grant→allow, maintenance deny, founder always, FP burn 800→750, daily-limit block, /me remaining, grants CRUD, audit trail) + testing_agent 4/4 backend + 16/16 frontend. All policies left at OPEN defaults (no behavior change until founder configures).**
- `services/access_policy.py`: ONE modular engine. Registry `AI_FEATURES` (course_maker, ai_video, ai_images, orai_assistant) — new feature = 1 dict entry + 1 `require_access()` call. Per-feature policy (`ai_access_policies` + `_history`): restricted, invite_only, allow_roles (platform_admin/center_owner/center_admin/center_manager), allow_usernames, required_badges (any/all, from `badge_registry`/`user_badges`), min_level (`user_level_progress.current_level_number`), min_fire_power + fire_power_cost per use (atomic burn from `fire_wallets.vault_balance`), limits daily/weekly/monthly/yearly (rolling windows via `ai_access_usage`), maintenance + bypass (founder always), custom denial message. Founder ALWAYS allowed. Evaluation: founder → maintenance → identity (username/grant/role) → earned (badges AND level AND FP) → limits → FP cost. Grants w/ expiry in `ai_access_grants`; audit in `ai_access_audit`.
- `routers/access_policy.py`: founder `/api/admin/ai-policies` (list w/ usage, badges, PATCH w/ reason≥5 audited, grants CRUD, simulate-as-user w/ trace, audit) + user `/api/ai-policies/me?center_id=` (allowed/reason/remaining per feature).
- Enforcement wired (consume=True): `generate_course_async` (course_maker), `lesson_image` (ai_images), `video_generate` (ai_video), media-pack auto-videos (ai_video, denial = skipped asset w/ reason, no retry), `assistant_chat` (orai_assistant, layered AFTER Private ORAi Access).
- Frontend: NEW `pages/AdminAiPolicies.jsx` (`/admin/ai-policies`, AdminHub card "AI Access Policies", founder): per-feature cards w/ status pill (Open/Restricted/Invite-only/Maintenance) + usage; full rule builder (toggles, role chips, username chips, badge chips + any/all, level/FP/cost/limits inputs, custom message), invite grants panel, simulate-as-user test bench w/ pass/fail trace, save w/ audited reason. `CourseMaker.jsx` shows a lock banner + disables generate when `/ai-policies/me` denies course_maker.
- Current state: all 4 policies at open defaults; zero grants. Retry-engine + policies are additive — no existing flow changed until configured.

## Universal AI Education Studio Upgrade (Aug 2, 2026) ✅ COMPLETE — PREVIEW, dry-run still ON
**Verified: Intro to Robotics course generated E2E with style profile (storyboard w/ "Bolt" mascot carried into images — character consistency proven in screenshot), prompt-engine dry-run video attached & playing, 46-style selector rendering in Course Maker, presets API working.**

### Universal Animation Style System
- `services/animation_styles.py`: DB-backed registry (`animation_style_registry`, seeded w/ 46 styles: Auto, Photorealistic, Cinematic, Pixar/DreamWorks-inspired, Anime, Manga, Comic, Cartoon, Children's Book, Watercolor, Oil, Pencil, Chalk, Claymation, Stop Motion, Paper Craft, LEGO, Low Poly, Voxel, Minecraft/Roblox/Fortnite-inspired, Stylized/Realistic 3D, Cyberpunk, Sci-Fi, Fantasy, Medieval, Steampunk, Retro 80s, Vaporwave, Neon, Motion Graphics, Whiteboard, Infographic, Blueprint, ArchViz, Nature Doc, Digital Painting, Pixel Art, Isometric, Chibi, Kawaii, Comic Noir) — each with prompt_fragment, gradient preview, subjects/ages/difficulty metadata. New styles = DB insert, ZERO code changes. 19 camera styles. `profile_to_prompt()` renders style_profile {primary, secondary, mix%, custom_prompt, camera, quality sliders (13), negative/lighting/motion/palette/environment prompts} → art-direction text.
- Routes `/api/ai-styles` (GET registry+cameras) + `/presets` GET/POST/DELETE (per-user unlimited presets, e.g. "OurRealm Neon" saved).
- `components/rc/StyleSelector.jsx` (full + compact modes): premium gradient thumbnail cards, ORAi style recommendations by grade+subject (recommendStyles heuristics), blend slider, custom style prompt, camera select, 13 quality sliders, advanced prompt fields, preset save/apply/delete. Mounted in **Course Maker** (course-level style) and **video EstimateModal** (lesson-level override).

### Smart Video Prompt Engine
- `services/video_prompt_engine.py`: LLM director converts user request + course storyboard + lesson block + style profile into a 60-130 word cinematic production prompt (family-friendly, no brands/text). Pipeline stage `designing_prompt`; stored as `production_prompt` on the job (visible for audit); raw lesson text is NEVER sent to the video model. Template fallback if LLM fails. VERIFIED: robotics test produced full cinematic prompt featuring Bolt + makerspace + style blend.

### Course Storyboard (style bible)
- `rc_courses.py`: new generation stage `designing_storyboard` — STORYBOARD_SYSTEM JSON {visual_style, characters, environment, palette, narrator, pacing, camera_language, branding} stored on course; injected into every module-generation prompt AND `_auto_illustrate` image prompts AND video prompt engine → cross-lesson character/style consistency. Course also stores `style_profile`.
- GEN_SYSTEM upgraded with WRITING QUALITY rules (conversational educator voice, no AI phrasing, no walls of text, varied structure, frequent interaction).

### Reliability
- `recover_orphaned_jobs()` on startup (admin_router startup event, 3s delay): interrupted video jobs resume — provider jobs re-enter the poll loop (create_job skipped when provider_job_id exists), dry runs re-run.

### Player polish
- `CoursePlayer.jsx`: lesson-complete celebration burst (star + color sparks) with auto-advance to next lesson; course-complete 🏆 celebration overlay. (Fixed a rules-of-hooks violation: celebrate state must live at top.) Resume playback + posters already shipped earlier.

### QA courses generated so far
- Intro to Robotics Workshop (6th grade, stylized_3d 70/30 motion_graphics, Bolt mascot) id=df890c1fb03d44c9ba26e10761d89a27 ✓ storyboard ✓ style-consistent images ✓ prompt-engine video (dry run) attached.
- Music Production + Fractions (earlier, pre-styles). REMAINING on demand: Personal Finance, Beginner Coding, World History (avoid burning credits without user request).

### Honest gaps (not yet built)
- Sound effects + background music generation: NOT implemented (no provider wired). Narration = ORAi voice TTS (audio_note/read-aloud) — real.
- Per-asset regeneration exists for image (lesson_image endpoint) and video (Regenerate button); activity/worksheet/quiz single-block regeneration NOT built yet.
- Module-level style overrides: course-level + lesson-video-level exist; per-module UI not built.

## Private ORAi Access Control (Aug 2, 2026) ✅ COMPLETE — PREVIEW
**Verified: full backend lifecycle via curl (grant→use→toggle→revoke→instant 403, founder unremovable, export, audit) + screenshots (normal user sees NOTHING, founder fab+panel+shortcuts, mobile 390×844 no overflow, landscape, admin sections).**

### Server-side enforcement (`services/orai_access.py`)
- Floating ORAi assistant is founder-only (@stealth via `get_admin_role=="founder"`) + explicit grants in `orai_private_access` {user_id, username, granted_by(+username), granted_at, note, expires_at, last_used_at, chat/voice/generation_enabled}.
- `require_orai_access(user, capability)` on EVERY `/api/orai/assistant/chat` + `/history` request → 403 Forbidden for unauthorized/expired/capability-off. No caching → revocation is INSTANT (open sessions die on next request; frontend closes+hides on 403 silently). Expiry auto-checked; audit `access_expired`/`access_denied`.
- GET `/api/orai/assistant/access` → `{allowed:false}` ONLY for unauthorized (reveals nothing); else flags + capability `limits` list. Limits also injected into the chat system prompt ("THIS USER CANNOT USE…") so ORAi never offers video/voice/course/admin actions the user lacks (op.allowed_actions already filters action buttons).
- Audit collection `orai_access_audit`: access_granted/updated/revoked (+bulk), access_denied, access_expired, chat_session_started, founder_shortcut_used, private_access_viewed, access_list_exported. POST `/api/orai/assistant/log-shortcut` (founder).

### Founder admin (`access_admin` router → `/api/admin/orai/*`, require_founder)
- `private-access` GET(list w/ q+active/expired filter+computed active)/POST(add by username, note, expiration, capability flags)/PATCH(toggle chat/voice/generation, note, expiry)/DELETE(revoke; founder returns 400 "The founder always has access")/`bulk-remove`/`export`(CSV)/`access-audit`.
- `usage` — AI Usage Dashboard rollup: ORAi chats today/week/month, videos (done/active/failed), courses (done/today/running/failed), images stored today, queue length, pending/failed jobs, top users (7d) + top centers (course gen, names from `responsibility_centers`), spend + budget remaining (reuses video_generation settings), emergency/dry-run status, rate-limit list. voice_minutes/avg_response_time = null (honestly not tracked).

### Frontend
- `OraiAssistantPanel.jsx` REWRITTEN: renders null unless `/access` says allowed (no button/placeholder/hint for others); 403 mid-session silently hides everything; founder strip (7 shortcuts: ORAi Admin, AI Dashboard→/admin/orai state.section=ai-usage, AI Queue, Video Queue, Provider Health, Command Center + Emergency Disable w/ confirm → PATCH ai-video settings; logs each use) + live "AI spend today"; per-message "Listen" (oraiVoice.speak) only when voice_enabled; MOBILE FIX: full-width bottom sheet (inset-x-0, rounded-t-2xl, 72dvh, safe-area padding, no horizontal overflow, input/send always visible, internal scroll, entrance animation), sm+ keeps 380px floating card.
- AdminOrion (`/admin/orai`): 2 new sidebar sections wired + REGISTERED_HANDLERS: **Private ORAi Access** (`components/admin/OraiPrivateAccess.jsx` — grant form w/ note+expiry, permanent @stealth row, per-user capability chips, revoke, bulk revoke, search/filter, CSV export) and **AI Usage** (`components/admin/OraiUsageDashboard.jsx` — 12 live stat cards, budgets, rate limits, top users/centers, provider health free probe, 10s auto-refresh, emergency/dry-run banners). AdminOrion reads router state `section` for deep links.
- Currently no one but @stealth has access (test grant for tftwo was revoked during verification).

## Phase 7 — Provider-Agnostic AI Video Generation (Aug 2, 2026) ✅ COMPLETE — PREVIEW, dry-run ON, no paid generation has ever run
**Verified via self-test: free health probes, full dry-run pipeline E2E (job → ffmpeg test clip → R2 upload → thumbnail → attach → plays in Course Player), budget enforcement proven ($0.05 cap blocked a $0.40 request), 403s for non-founders, screenshots of admin page + player.**

### Provider layer (`services/video_providers/`)
- `provider_base.py` (VideoProvider interface: estimate_cost/create_job/poll/fetch_file/cleanup/health), `openai_provider.py` (sora-2/sora-2-pro via raw httpx, PRICING per (model,size), free health probe = invalid-seconds validation trick), `manual_upload_provider.py`, `external_video_provider.py`, registry in `__init__.py`. Course Maker NEVER references a provider — swap-ready for Runway/Veo/Pika/Luma. Sora sunset (reported Sep 24, 2026) only affects one disposable file.

### Orchestrator (`services/video_generation.py`)
- Settings `ai_video_settings` (+`_history`, cached 10s): enabled, emergency_disabled, **dry_run (DEFAULT TRUE — ffmpeg testsrc2 clip, $0, full pipeline)**, expose_provider_names (default FALSE — users see "ORAi Video Engine"), default provider/model/size/seconds/quality, daily/monthly budgets ($5/$50), max_per_video ($2), max_per_course ($10), max_concurrent_jobs (2), provider_priority.
- `build_estimate()` → cost/time/resolution/duration/masked provider/daily+monthly remaining/course total/blockers. `start_video_job()` re-checks every gate server-side. Pipeline stages: queued→generating(poll provider)→downloading→uploading_r2 (video_dir + `mirror_to_cloud("videos",…)` → `/api/media/videos/{hex32}.mp4`)→optimizing (ffmpeg thumbnail → image_store)→attaching (block video_url/thumbnail/source/status)→complete. Cancellation via cancel_requested flag; provider copy deleted after success; RC notifications rc_course_video_ready/_failed; audit rows in `ai_video_audit`. Jobs in `ai_video_jobs` with full metadata (prompt, negative_prompt, provider, model, seconds, size, costs, seed, version, center/course/lesson/block, creator).

### Routes (`routers/ai_video.py`, wired in server.py)
- Founder-only `/api/admin/ai-video/*`: settings GET/PATCH (reason≥5 audited), providers/health (FREE probe), queue, history (filters status/provider/center/course/creator/q/archived), analytics, jobs cancel/archive/DELETE, audit.
- Course-manager `/api/responsibility-center/{cid}/courses/{course_id}/lessons/{lesson_id}/video/*`: estimate, generate (**requires approve_cost:true + approved_cost matching server figure — never auto-spends**; rate limit 10/hr), jobs/{id} (provider masked), jobs/{id}/cancel, attach (uploaded /api/ or https external), remove.
- FIX: rc_courses `update_lesson` now PRESERVES interactive payloads + video metadata + block ids on editor saves (previously stripped them — pre-existing bug).

### Frontend
- NEW `components/rc/LessonVideoPanel.jsx` (in CourseEditor for video_embed blocks): preview player w/ poster, status chips (queued/generating/…/ready/failed/cancelled), Generate/Regenerate → EstimateModal (cost, time, resolution, duration, engine label, daily remaining, course total, dry-run notice, blockers, "Approve & Generate ($X)"), job polling w/ cancel, Upload (existing /api/videos/upload + audio-rights confirm), Paste URL, Remove.
- NEW `pages/AdminAiVideo.jsx` (`/admin/ai-video`, AdminHub card "AI Video Settings", founder): Settings/Queue/Video Library (search+status filters, preview, archive, delete)/Analytics tabs + free provider health check.
- MOD `CourseEditor.jsx` (all 15 block types in select, video panel), `ActivityBlock.jsx` (ResumableVideo: sessionStorage resume + poster; placeholder unchanged when no URL).
- Player: generated video verified playing in "What a DAW Does" (Music Production course).

### Ready for founder's paid test
Flip dry_run OFF in /admin/ai-video → Generate on any video_embed block → 4s 720p sora-2 = $0.40, explicit approval modal. NOT done yet per instruction.

## AI Course Maker + Interactive Lesson Capability (Aug 2, 2026) ✅ COMPLETE — PREVIEW ONLY, awaiting founder review before production deploy
**Verified: self-test pass — async jobs via curl (2 real courses generated E2E), desktop+mobile screenshots of Course Maker page, player interactive/placeholder blocks confirmed via DOM assertions.**

### Cloudflare-timeout fix — background generation (rc_courses.py)
- Frontend now NEVER holds a long HTTP request: POST `/{cid}/courses/generate-async` returns `job_id` instantly; UI polls GET `/{cid}/courses/generate-jobs/{job_id}` every 3.5s. Job doc in `rc_course_gen_jobs` (status running/done/failed + stage).
- Honest stages: starting → designing_course → building_lessons:{i}/{n} (per module) → creating_images → complete/failed.
- **Chunked generation** (fixes LLM JSON truncation that broke single-shot 8-lesson courses): Step 1 skeleton (approved blueprint if provided, else small SKELETON_SYSTEM call), Step 2 ONE LLM call PER MODULE (GEN_SYSTEM, max_tokens 10000, json_mode). `call_openai_chat` gained `json_mode` kwarg → OpenAI `response_format: json_object`. `_parse_course_json` now salvages truncated JSON via `_balance_json` (bracket/string balancer) as a safety net.
- `options` dict honored in generation prompt: style, difficulty, lesson_length, media_types, accessibility, goals, final_project (blueprint endpoint already accepted these).
- `generate_images: true` → `_auto_illustrate()` during the job: up to 4 AI images per course (first text block of lessons) via existing `generate_orai_image` + `image_store.save_bytes`, failure-tolerant.
- GEN_SYSTEM updated: audio_note (script read aloud by ORAi voice) + video_embed (NEVER invent URLs — omit video_url; renders as labeled placeholder).

### Dedicated Course Maker page
- NEW `/responsibility-center/:id/course-maker` (`pages/CourseMaker.jsx`, AccessGate feature course_player). Full workspace: prompt, grade, lesson count, difficulty, course style, lesson length, media/activity toggles (AI images, interactive, ORAi voice audio, video placeholders), goals, final project, accessibility → Draft Blueprint (editable title/description/modules) → Approve & Generate → polled progress card with stage label + step bar → auto-opens the draft in the Course Editor.
- `CourseStudio.jsx` (`/courses`): inline generation card REMOVED; now a CTA card — "Open Course Maker" (`open-course-maker-btn`) + Open-in-new-tab (`open-course-maker-newtab`). Courses page stays focused on viewing/managing; generated courses appear in the normal list (verified).

### Player interactive wiring
- `CoursePlayer.jsx` now renders interactive blocks through `components/rc/ActivityBlock.jsx` (tap_select, matching, ordering, short_answer, reflection, scenario, checklist, video_embed) — previously they fell through to plain text. NEW `AudioNoteBlock` in CoursePlayer: audio_note blocks get a "Play with ORAi voice" button (oraiVoice.speak). `ActivityBlock` video_embed without URL renders an HONEST labeled "Video placeholder" card (real video generation NOT connected — placeholder by design).

### Capability test results (preview center 3ed43c2b553547fbb3e6ca23b405eb91, drafts by stealth)
- "Intro to Music Production" id=9c34100d05b5426291af0bf1fe23eb4a — 10th Grade, 4 modules / 20 lessons, 42 quiz Qs, blocks: video_embed×10 (placeholders), audio_note×4, ordering×4, scenario×5, checklist×4, tap_select×3, matching×2, worksheets/homework/project, 4 AI images (incl. DAW visual). Teen tone.
- "Fractions Through Baking" id=3b9fff0787bd4129a7407db92011ee82 — 3rd Grade, 3 modules / 11 lessons, 15 quiz Qs, blocks: tap_select×5, matching×3, ordering×4, short_answer×3, checklist×3, baking project, 4 AI images. Kid-friendly tone. Clearly different language/structure/difficulty vs music course.
- Known nit: without a blueprint, the skeleton may plan MORE lessons than the requested count (20 vs 8 requested) — richer, not broken; blueprint flow gives exact user control. Rate limit: 6 generations/hour/user.

### Media capability map (honest)
- AI images: REAL (gpt-image via orai_images, capped 4/course auto + per-lesson editor button). Audio: REAL via ORAi voice TTS (audio_note play button + lesson read-aloud). Video: PLACEHOLDER ONLY (labeled card; generation not connected). Interactive activities: REAL client-side (feedback, matching, reordering, scenarios).

### DO NOT DEPLOY TO PRODUCTION until founder confirms (user instruction Aug 2, 2026).

### OpenAI Video Access Verification (Aug 2, 2026) — INSPECTION ONLY, nothing built
- Existing backend `OPENAI_API_KEY` (backend/.env, project-scoped key) CAN access **sora-2 AND sora-2-pro** via the Videos API (`/v1/videos`). Proven with FREE 400-validation probes (invalid `seconds` param → model accepted, param rejected, no job created, $0 spent). Note: sora models never appear in `/v1/models` (expected), so model-list checks 404 — use Videos API probes.
- Videos API: async jobs (POST /v1/videos → id+status), polling (GET /v1/videos/{id}), download (GET /{id}/content), DELETE. Durations 4/8/12s; sora-2 sizes 720x1280/1280x720; pro adds 1024x1792/1792x1024. Pricing: sora-2 $0.10/s; pro $0.30/s @720p ($0.50 @1024p, $0.70 @1080p). Smallest test = sora-2 4s 720p = **$0.40** (needs founder approval before running).
- Installed `openai` SDK 1.99.9 does NOT include `client.videos` (added later) — but backend already calls OpenAI via raw httpx (chat_conversations.py pattern), so no SDK upgrade required.
- Sora API reportedly sunsets Sep 24, 2026 (third-party reports) → any future integration MUST be provider-agnostic: a `video_providers` service with a common interface (create_job/poll/fetch_file) + providers: openai_sora, manual_upload, external_url, future providers; permanent storage in existing R2 pipeline (OpenAI-hosted files expire). Course blocks keep `video_url` + add `video_source` metadata. NOT implemented yet per founder instruction.


## Responsibility Center — Bundle F (Aug 1, 2026) ✅ COMPLETE — awaiting founder review (STOPPED before Bundle G)
**Verified: 21/21 new pytest (`tests/test_bundle_f_reports.py`) + Bundle E (29) & D (16) re-passed after changes + testing_agent iteration_101 frontend E2E (100% of in-scope flows, zero action items).**

### Universal reporting engine (`services/rc_reports.py`)
- ONE registry (`REPORTS`) for every Center type — 12 real-data reports: work_summary, member_workload (with non-judgmental workload indicator + disclaimer), unit_workload, approval_report (immutable history), attendance_summary, attendance_detail (perm `view_detailed_attendance`, privacy note), calendar_summary (RSVP dist, cancellations, conflict overrides), fire_power_activity (non-monetary language, transaction_type ledger), vault_report (balance, added/burned, coverage estimate), renewal_report (membership_user_id/result/fire_power_needed), membership_summary, lifecycle_report (explicitly states permanent deletion NOT implemented — locked-closed state).
- Common filters via `parse_filters`: date range (max 366d validated), member/unit/status/priority/item_type/event_type/include_archived/group_by; server-side aggregation ($group, $unwind for assignee arrays), row caps (200-500 detail, 100 shown in UI), UTC internal + Center timezone echoed.
- Endpoints (routers/rc_reports.py): GET `/{cid}/reports` (perm-filtered catalog), POST `/{cid}/reports/{key}` (data), POST `/{cid}/reports-export`, GET `/{cid}/report-runs` (+/{id}/download, /{id}/retry POST), saved views CRUD `/{cid}/saved-report-views`, GET `/digest/preview`, GET/PATCH `/{cid}/birthday-settings`, POST `/{cid}/birthday-consent`, admin GET `/api/admin/responsibility-center/reports/overview`.

### Export engine (`services/rc_exports.py`)
- Async report runs: statuses queued→processing→ready/failed/expired; idempotency_key unique partial index (same client_token = one run, duplicate:true); claim-locked worker `run_export_pass()` (claim_until, PROVEN one-file under concurrent workers in pytest); immediate kick via asyncio.create_task + hourly scheduler pass; rate limit 15 exports/10min/user.
- **CSV**: UTF-8-sig, header meta, formula-injection neutralized ('-prefix for =,+,-,@ — pytest-proven). **XLSX**: openpyxl, Summary+Data sheets, frozen header, safe cells, column widths. **PDF**: reportlab platypus — center name, title, range, generated-by, summary/breakdown/detail tables (row caps), HTML-escaped text, page-number+confidentiality footer. Logo embedding deferred (text branding).
- Files stored as bytes in `responsibility_center_report_files` (48h TTL); download endpoint re-checks membership + report perm + requester (or manage_roles) + expiry (410 after) and marks downloaded_at once; expiry sweep deletes files but PRESERVES run audit rows (status=expired); retry re-queues own failed/expired runs; notifications report_ready/report_failed deep-link `?tab=reports&run=`.
- **Birthday auto-events**: center opt-in flags (birthday_auto_events_enabled/show_year, owner PATCH, off by default) + per-member explicit consent (`responsibility_center_birthday_consents` — user provides month/day, nothing inferred; no dob field exists on users); `run_birthday_pass()` (hourly) creates yearly all-day birthday events for consented ACTIVE members in enabled ACTIVE centers within 180d window — unique (center,user,year) claim index (concurrent-proof); consent withdrawal cancels active event + deletes claim.
- **Digest preview** (`rc_calendar.digest_preview`): builds live sections with current settings/permissions, NEVER inserts digest_log / consumes dedup key (pytest-proven), labeled "Preview — Not Sent", empty message included.

### Permissions (added to ROLE_PERMISSIONS)
- REPORT_PERMS_FULL (owner/admin): view/create/export_reports, saved views, all work/attendance/fire-power/vault/renewal/lifecycle report+export perms. REPORT_PERMS_MANAGER: work + attendance + saved views + export (NO fire power/vault/renewal/lifecycle). member: none (Reports tab hidden in UI, backend 403).

### Frontend
- NEW `components/rc/RcReportsTab.jsx`: catalog cards by category (perm-filtered), viewer (date presets last7/30/90/this-last month/this year/next30/custom, member+unit filters, Apply), summary tile grid, accessible CSS bar breakdowns (aria-labels), detail table (100-row cap + export hint), CSV/Excel/PDF export buttons, Print (body.rc-printing + @media print CSS in index.css — visibility-based, black-on-white, row page-break rules), Save view (prompt), saved views list (open/delete), Export History (status chips, blob download, retry, refresh). Reports tab hidden for roles without view_reports.
- NEW `components/rc/RcBirthdayPanel.jsx` (in Center Settings tab): center toggle (managers) + personal month/day opt-in / stop-sharing.
- MOD `RcWorkDigestCard.jsx`: "Preview My Work Digest" button + panel (label, delivery time, per-section items with links, empty message).
- MOD `AdminResponsibilityCenter.jsx`: new "Reports" tab (rc-admin-tab-reports) — platform aggregate metric cards + status/type breakdowns + range select (counts only, no private content).
- MOD `ResponsibilityCenterDashboard.jsx`: Reports tab (BarChart3) between Calendar and Members.

### New collections (additive)
`responsibility_center_report_runs` (uniq center+idempotency_key), `responsibility_center_report_files` (bytes, TTL-swept), `responsibility_center_saved_report_views`, `responsibility_center_birthday_consents`, `responsibility_center_birthday_events` (uniq center+user+year).

### Bundle F deferred / notes
- Scheduled report DELIVERY: foundation-only per spec (no `responsibility_center_scheduled_reports` delivery loop built — deliberately not silently enabled; collection/endpoints can be added in Bundle G if wanted).
- PDF chart images + Media-Manager logo embedding in PDFs: deferred (accurate tables/summaries exported instead of fake chart screenshots, per spec).
- Report definitions are code-registry-based (system reports) rather than DB `report_definitions` rows — simpler, equally universal; custom user-defined report definitions deferred.
- group_by filter parsed/validated but breakdowns are per-report fixed sets.
- Dev-mode React warning from platform x-* instrumentation on <option> elements (cosmetic, dev only).

### Next: Bundle G (Templates, widgets, universal search, moderation integration, final polish) — NOT STARTED, awaiting founder approval.

## Responsibility Center — Bundle E (Aug 1, 2026) ✅ COMPLETE — awaiting founder review (STOPPED before Bundle F)
**Verified: 29/29 new pytest (`tests/test_bundle_e_units_calendar.py`, incl. recurrence + digest concurrency proofs) + all prior suites pass individually (A 34, B 24, C+Phase1 52, D 16 = 155 total) + testing_agent iteration_100 frontend E2E (~95%, zero action items) + main-agent self-test of conversion UI & deadline deep-link (screenshots).**

### Universal Units engine (`services/rc_units.py` + routes in `routers/rc_units.py`)
- ONE engine for every Center type: 15 unit types (group/subgroup/department/division/class/grade/team/committee/ministry/household/project/club/shift/volunteer/custom). Max depth 5 (walk-up check + subtree-depth on moves), BFS cycle prevention, cross-Center parents rejected, create idempotency via client_token (partial unique index). Visibilities center/unit/leaders (`_can_see_unit`); leader must be ACTIVE center member (paused/removed rejected); unit memberships unique-active index, removal → status "left" (history preserved); member leave/removal from Center auto-deactivates unit memberships + clears leaderships (`deactivate_center_member_units`, wired into rc_lifecycle). Unit archive blocks member-adds (409) + work assignment (409) without deleting; center paused/archived/closed gating via `_ctx` (member 403, manager read-only, writes 409). Sort_order move up/down, list carries member_count / open_items / leader_username aggregates.
- **Unit assignments** (`assign_work_to_unit`): mode=individual → one item snapshot per current eligible ACTIVE unit member (paused center-members skipped, per-member client_token `{base}-{uid}` prevents dupes, items tagged unit_id+unit_group_key); mode=shared → one unit-tagged item (leader-assigned when present, unit_shared=true). History preserved on membership change; new members never inherit old individual assignments.
- **Education conversion** (`convert_self_task`, POST /{cid}/items/{iid}/convert): perm `convert_student_task_to_assignment` (manager/admin/owner — students 403). Modes: personal (same person official), selected (chosen members), unit (class/unit, individual or shared). Original self-task NEVER modified/deleted — gains converted_to/converted_at/converted_by; officials carry source_item_id + source_created_by(_username); duplicate conversion → 409; activity `converted_to_assignment` + creator notified. UI: RcConvertModal via `rc-drawer-convert-btn` in RcItemDrawer (converted/source banners).

### Calendar engine (`services/rc_calendar.py`)
- Event types: event/meeting/class/practice/shift/appointment/deadline/birthday/important_date/announcement/custom. Visibilities center/unit/attendees. Create (idempotent client_token), feed by date range (max 62d, filters unit/type/scope=mine/member_id — member feed requires manage_event_attendance or view_private_events), detail (me: my_response/can_edit/can_cancel/can_mark_attendance), edit (optimistic `expected_version` → 409 on stale; scopes occurrence/future/series — non-time fields propagate to template + scheduled occurrences; recurrence change cancels future occs, bumps recurrence_rev, regenerates from new anchor), cancel (scopes occurrence/future/series; series → ended + future occs canceled; canceled events never get reminders).
- **Unified task projection**: feed live-queries `responsibility_items` due dates as kind=item deadline entries (NO duplication); due-date PATCH updates feed instantly; completion → completed flag; Bundle C permissions (`rc_items._can_see`) enforced. Clicking a deadline deep-links to Work tab drawer.
- **Conflict detection**: member/unit/organizer overlap on create+edit → 409 with conflicts payload (title, range, overlapping_members, unit_conflict); authorized override needs `override_schedule_conflicts` perm, optional reason (required when center.require_conflict_override_reason), logged to activity. Non-overlap → no warning; never auto-blocks.
- **Event recurrence**: reuses Bundle C rc_recurrence patterns (daily/weekdays/weekly-multi/biweekly/monthly incl. nth-weekday/custom X days-weeks-months; end by date/count/never) with rolling 14-day window, unique (series_id, occurrence_key[+rev]) partial index, claim-locked pass (`gen_claim_until`), no back-fill >24h, skips paused/archived/closed centers — concurrent generation PROVEN no-dup in pytest.
- **Attendance foundation**: per-attendee present/absent/late/excused/remote/not_required/unknown + note + marked_by + marked_at; requires event `attendance_enabled` (else 409) AND (`manage_event_attendance` perm OR organizer) — participants 403; bulk marks (≤100); every change logged to `responsibility_center_unit_activity` (action attendance_changed). NOT connected to grades/Fire Power/discipline; reports = Bundle F.
- **Event reminders**: pass sends deduped (event, offset, start-version, recipient) via unique dedup_key insert-before-send; skips declined RSVPs, inactive members, non-active centers, stale (>30min past start).
- **Daily Work Digest**: OFF by default for everyone; opt-in via GET/PATCH `/api/responsibility-center/digest-settings` (digest_hour 0-23 default 8, digest_timezone zoneinfo-validated — UI sends browser tz on enable, 7 include toggles: due_today/due_soon/overdue/approvals/changes_requested/recently_assigned/events). `run_work_digest_pass()` in hourly scheduler: fires at user's local hour, one per user per LOCAL day via unique dedup_key in `responsibility_center_digest_log` (overlap-proof — concurrent double-run = exactly 1), EMPTY DIGESTS SKIPPED, paused/archived/closed centers + inactive memberships excluded (`_digest_active_centers`), sections grouped with center_name/title/due/priority/status/deep-link (events split meetings/classes/practices/shifts today), in-app notification `responsibility_center_work_digest` with count summary. GET `/digest/latest` returns stored payload. Critical immediate alerts untouched.

### Frontend
- NEW `components/rc/RcUnitsTab.jsx` — Groups tab: flattened-iterative hierarchy tree (visual-edits babel plugin can't transform recursive JSX — keep it iterative!), tree/list toggle, archived filter, search, per-row type badge/leader/member count/open items/sub-unit count, move up/down, edit/members/archive/restore, create+edit modal (type/parent/leader/visibility/member chips, client_token), members modal (add w/ role, remove).
- NEW `components/rc/RcCalendarTab.jsx` — Month grid / Week columns / Agenda (DEFAULT ON MOBILE <768px), Today + prev/next nav, type/unit/mine filters, event create modal (all fields + attendee chips + RcRecurrenceEditor + conflict warning panel w/ reason + "Schedule anyway"), EventDrawer (RSVP Going/Maybe/Can't-go, attendee list w/ per-attendee attendance selects + All-present + Save, edit panel w/ series scope select + expected_version, cancel w/ one/future/all prompt). URL sync `?tab=calendar&event=`.
- NEW `components/rc/RcConvertModal.jsx`, `components/rc/RcWorkDigestCard.jsx` (in AccountSettings → Centers tab under "Daily Work Digest").
- MOD `ResponsibilityCenterDashboard.jsx` (TABS + Groups/Calendar renders + deep links), `RcItemDrawer.jsx` (convert button + converted/source banners, me.can_convert from backend), `rc_items.item_detail` (can_convert + converted fields).

### New collections (additive)
`responsibility_center_units`, `responsibility_center_unit_memberships`, `responsibility_center_unit_activity`, `responsibility_center_calendar_events` (series templates + occurrences, embedded attendees), `responsibility_center_event_reminders`, `responsibility_center_digest_log`, `user_rc_prefs`.

### Bundle E deferred / notes
- Location-based conflict overlap (optional per spec) — not implemented. Push/email digest channels — in-app only for now (per spec, in-app first; external channels need explicit opt-in later + privacy-safe previews already the rule). Attendance reports/exports — Bundle F. Event time-of-day edits at series scope limited to recurrence-change path (occurrence-scope time edits fully supported). Groups tab mobile: action buttons wrap to second row (usable, cosmetic).
- Scheduler: all Bundle E passes (event recurrence, event reminders, work digest) already wired in the hourly rc_renewals `_loop()`.

### Next: Bundle F (Reports & Exports) — NOT STARTED, awaiting founder approval. Then G = Templates/Widgets/Search/Moderation.

## Responsibility Center — Bundle D (Aug 1, 2026) ✅ COMPLETE — awaiting founder review (STOPPED before Bundle E)
**Verified: 16/16 new pytest (`tests/test_bundle_d_lifecycle.py`, incl. concurrency proofs) + 110/110 full regression (Phase 1 + A + B + C) + testing_agent iteration_99 frontend E2E (100%, 13/13 flows, zero action items).**

### Lifecycle engine (`services/rc_lifecycle.py` + `routers/rc_lifecycle.py`)
- **Ownership transfer** — two-party: owner creates request (eligible active member only; self/non-member/wrong-name confirm rejected; one pending per Center via partial unique index; typed Center-name confirmation; post-transfer role admin/manager/member/leave; optional note). Proposed owner accepts/declines. Acceptance is claim-locked (`pending→accepting` find_one_and_update, single winner) + guarded role swap (demote-while-owner, promote-while-not-owner, rollback on failure) — **concurrent accepts proven: exactly one owner, never zero/two**. Vault, items, attribution untouched. `ownership_history` appended on center doc. Requests expire (default 7d, Global Setting) via scheduler with once-only notification. Owner/admin cancel (admin needs written reason).
- **Ownership recovery** — admin/manager members request with reason (never auto-transfers); founder admin approves (guarded swap, old owner→member) or denies with reason; all audited. Temporary Steward: **DEFERRED** (foundation only — conflicts avoided per spec).
- **Member departure** — leave-preview endpoint (open items, pending approvals, attribution/Fire Power notes); leave blocked for owner and for pending-transfer participants; membership→left, counts updated, historical attribution preserved, duplicate leave clean 4xx. **Member removal** — written reason required, rank rules preserved, work_mode keep/unassign/reassign(+target); target must be active member.
- **Open-work reassignment** — bulk endpoint (reassign/unassign/cancel) covering assignee_ids, approver, reviewer, recurring series; original history + immutable approvals preserved; new assignee notified; audited.
- **Owner pause / archive / restore** — pause (confirm, reversible, guarded conditional → idempotent/409 on repeat), archive (typed-name confirm), restore (idempotent, blocked by retention hold / pending closure / missing owner). Work engine gating in `rc_items._ctx(write=)`: closed→409 for all; paused/archived→403 plain members, read-only owner/admin/manager, 409 on writes. Recurrence generation + due reminders skip paused/archived/closed; My Work excludes them; renewal scheduler already skips non-active (verified).
- **Safe closure** — request requires typed Center name + phrase "CLOSE THIS CENTER" + reason; blocked by pending transfer; one active request (guarded); center auto-pauses (paused_by=closure); vault freezes (Global Setting, reuses `vault_frozen` fund guard). Cancellation window default 14d (Global Setting). Owner cancel restores prior status + unfreezes vault. Admin approve/deny with reason. **Retention hold blocks completion even past deadline** (proven). Scheduler completes approved closures past deadline exactly once (concurrency-proven) → locked `closed` state: `closure.final_vault_balance` recorded, vault frozen, ordinary access 409. **NO DATA DELETED — permanent deletion deferred to a reviewed retention policy** (fields present: requested_at/approved_at/cancellation_deadline/retention_hold/…).
- **Data export** — owner/Center-admin JSON export (center, members+usernames, items, comments, approvals, activity, vault transactions, renewal attempts, transfers, lifecycle audit); admin-notes excluded; exports_locked honored; logged to audit. ZIP/CSV/PDF + async jobs: **DEFERRED**.
- **Immutable audit** — `responsibility_center_lifecycle_audit` (actor, action, before/after, reason) for every lifecycle event; surfaced in admin tab.
- **Global Settings added** (`RC_SETTINGS_DEFAULTS`): transfer_expiry_days=7, closure_cancel_window_days=14, closure_requires_admin_approval=True, allow_owner_pause/archive/closure=True, allow_member_leave=True, allow_recovery_requests=True, freeze_vault_on_closure=True.
- **Admin perms added** (founder-only via existing RC_ADMIN_PERMS): transfer_ownership, manage_ownership_recovery, review_closure, cancel_closure, manage_retention_hold, view_lifecycle_audit.
- **Scheduler** — `run_lifecycle_pass()` in the existing hourly RC loop: transfer expiry + closure completion (idempotent, guarded, concurrency-proven).
- **New collections**: `responsibility_center_transfers`, `responsibility_center_recovery_requests`, `responsibility_center_lifecycle_audit`. Center doc additions: ownership_status, ownership_history, owner_user_id, paused_by/reason, archived_at/by, closure{...}, vault_frozen (reused).

### Frontend
- NEW `components/rc/RcLifecyclePanel.jsx` (in Settings tab): state grid (blue=ownership, orange=pause/archive, red=closure, green=restore), transfer form (member+post-role+note+typed confirm; submit disabled until exact match), pending-transfer banner (accept/decline for proposed owner, cancel for owner), pause/restore/archive (typed confirm), Export Data (JSON download), two-step closure (alternatives comparison → typed name + phrase + reason), closure-pending banner with deadline + cancel, recovery request form (admins/managers), member leave preview with Stay/Confirm.
- NEW `components/admin/RcLifecycleAdminTab.jsx` + "Lifecycle" tab on `/admin/responsibility-center/{id}`: state grid, closure approve/deny/cancel, retention hold toggle, admin restore, transfer cancel, recovery approve/deny (all window.prompt reason-gated), transfer history, immutable audit list.
- SettingsTab old direct leave button replaced by the lifecycle panel.

### Bundle D deferred / notes (per completion report)
- Temporary Steward — foundation deferred. Work Digest — **DEFERRED** (would have expanded Bundle D; recommend as Bundle E companion). Scheduled (delayed) member removal — immediate/reassign modes only. Export formats beyond JSON — deferred. Permanent deletion — intentionally NOT implemented; closure = locked retained state, exactly as reported to users.
- Admin reason prompts use window.prompt (tester UX note — consider inline modal later).

### Next: Bundle E (Groups/Departments/Classes/Teams + Calendar) — NOT STARTED, awaiting founder approval. Then F = Reports & Exports, G = Moderation integration.

## Responsibility Center — Bundle C (Aug 1, 2026) ✅ COMPLETE — awaiting founder review
**Verified: 25/25 new pytest (`tests/test_bundle_c_items.py`) + 85/85 regression (Phase 1 + Bundle A + Bundle B) + testing_agent iteration_98 frontend E2E (~92%, 3 findings all fixed & re-verified via screenshots: timezone-save type=button, My-Work deep-link URL sync, live progress-slider label).**

### Universal Responsibilities & Tasks engine (one engine, every Center type)
- NEW `services/rc_items.py` (~900 lines): item types task/responsibility/goal/milestone; priorities low→urgent; visibilities center/assigned/managers; server-side status machine (draft/assigned/accepted/declined/in_progress/waiting/blocked/submitted/pending_approval/changes_requested/approved/completed/canceled/archived) via TRANSITIONS table with role gates (assignee/manager/either) + idempotent retries (same-status action returns 200). Optimistic concurrency: every mutation `$inc version`; PATCH accepts `expected_version` → 409 with clear "refresh and review" message on stale edits. Create idempotency via `client_token` (partial unique index center+creator+token). Subtasks max 2 levels (`parent_id`); dependencies with BFS cycle prevention. Progress methods manual/checklist/subtasks/status — manual updates rejected (409) when method is automatic; method change = creator/manager only. Checklists (30 max, idempotent `set` op), comments (@mentions notify only active Center members, 15/min rate limit, soft delete), attachments (durable-URL/media-pipeline only + links, add/remove logged). Private-visibility items never leak titles into notifications (`item_notify_title`). Full activity trail (created/edited/due_changed/visibility_changed/reassigned/accept/start/submit/approval_*/checklist_changed/progress_changed/commented/mentioned/attachment_added|removed/recurrence_changed/occurrence_generated/series_*).
- Approvals: immutable per-cycle decision rows (`responsibility_item_approvals`, conditional update, second decide → 409; same-decision retry → 200 idempotent). Reject/request-changes REQUIRE a note; corrections create a NEW cycle via resubmission. Approve → completed.
- SELF-TASKS: plain members get virtual `create_self_tasks` perm when Center allows. Restrictions enforced backend-side: task-only, self-assigned-only, no reviewers/approvers/approval_required, no managers visibility; member fully manages own personal task (complete/cancel/archive/reopen). Manager broadening assignees converts `is_self_task→false`. Center setting `allow_member_self_tasks` (owner-only PATCH, null=template default: family/household ON, business/team/organization/community/other OFF).
- NEW `services/rc_recurrence.py`: patterns one_time/daily/weekdays/weekly(multi-weekday)/biweekly(anchor-week parity)/monthly(day_of_month clamped — 31st→last valid day, returns to 31 in longer months, computed from anchor; first_weekday/last_weekday/nth_weekday)/custom every X days/weeks/months. End by date, by occurrence count (auto-ends series + notifies), or never. Rolling 14-day generation window (never unlimited records), claim-locked pass (`generation_claim_until`), unique (series_id, occurrence_key) partial index — concurrent passes PROVEN no-dup in pytest. Past anchors never back-fill (>24h-old occurrences skipped). Center timezone drives schedule (`center.timezone`, owner-editable, zoneinfo-validated); UTC storage. Series controls: pause/resume/end/archive; edit scopes: occurrence-only (normal PATCH), future (template), entire series (template + open occurrences). Skips archived/paused/ended series and archived/paused/deleted centers.
- Due reminders in the same pass: due_soon (T-24h) / due_now / overdue (T+1h), one per (item, kind, due-date version, recipient) via unique `dedup_key` insert-before-send (`responsibility_item_reminders`) — overlap-safe, due-date change creates fresh keys, obsolete never resent; recipients revalidated as active members.
- NEW `routers/rc_items.py` (~20 endpoints, included BEFORE the /{center_id} router): `GET /my-work` (cross-Center buckets: overdue/due_today/due_soon/in_progress/pending_my_approval/recently_completed, authorized items only, carries center name/type), items CRUD + list (scopes all/mine/created/unassigned/due_today/overdue/my_approvals/submitted_by_me/recently_completed/series; filters q/type/status/priority/assignee/creator/recurring/category/label/due range; 7 sorts; visibility-filtered for non-managers), items-summary, actions/{action}, approval, checklist, progress, comments (+delete), attachments (+delete), series PATCH + series/{action}.
- `update_center` extended: `allow_member_self_tasks` (owner-only), `timezone`. `_public_center` exposes both. Notification deep links: `/responsibility-center/{cid}?tab=work&item={id}`.

### Frontend
- NEW `components/rc/`: `RcWorkTab.jsx` (8 clickable summary stat cards, 9 scope chips incl. Recurring Series with pause/resume/end, search + type/status/priority/recurring filters + 7 sorts, paginated list, per-row priority dot/overdue flag/progress/status pill), `RcItemCreateModal.jsx` (adaptive: full manager form vs restricted member form labeled "Personal task inside this Center"; assignee chips, approver select, checklist builder, per-session client_token), `RcRecurrenceEditor.jsx` (plain-language: all patterns, weekday chips, monthly modes incl. nth-weekday, custom X days/weeks/months, end never/date/count, short-month note) + `recurrenceLabel()`, `RcItemDrawer.jsx` (right drawer / mobile full-width: status+priority pills, meta grid, live progress bar + debounced manual slider, context-aware action buttons with confirm on destructive, approval decide panel with required-note prompts, checklist ticking, subtasks, dependencies, attachments upload via /api/images/upload + links + remove, chronological approval history, comments with mentions, activity trail, Esc/scrim close), `RcMyWork.jsx` (hub cross-Center buckets, deep-links).
- MOD `ResponsibilityCenterDashboard.jsx`: Work tab added; `?tab=&item=` URL sync (drawer open/close updates the query string — shareable deep links); SettingsTab owner panel "Work & tasks" (self-task select default/on/off + Center timezone input with datalist, type="button" save).
- MOD `ResponsibilityCenterHub.jsx`: My Work section.

### New collections (additive)
`responsibility_items` (items + series templates + occurrences; embedded checklist/attachments), `responsibility_item_comments`, `responsibility_item_approvals`, `responsibility_item_activity`, `responsibility_item_reminders`.

### Bundle C deferred / notes
- Reviewer role is stored/displayed but has no dedicated review step (approver flow covers it). Category/label filters exist API-side; UI exposes main filters only. Series edit "this and future" = template scope (occurrence regeneration on recurrence change resets from new anchor). Attachment uploads are images (existing pipeline); other file types via link attachments. Education-specific student/teacher conversion flows arrive with Bundle E groups.

### Next: Bundle D (Owner Transfer + Safe Center Closure) — NOT STARTED, awaiting founder approval
Then E = Groups/Departments/Classes/Teams + Calendar, F = Reports & Exports, G = Moderation/Reporting integration.

## Responsibility Center — Bundle B (Jul 31, 2026) ✅ COMPLETE — awaiting founder review
**Verified: testing_agent iteration_97 — 24/24 new pytest (`tests/test_bundle_b_rc_media.py`) + 61/61 regression (Bundle A 34 + Phase 1 27) + 8/8 renewal sim + full frontend E2E. Zero issues. Real logo upload E2E through /api/images/upload verified.**

### Admin Media & Branding
- NEW `services/rc_media.py`: system-asset registry — 69 stable asset keys in 6 sections (branding 10, landing 10, center_types 13, dashboard 13, education 11, admin_system 12). Collections: `rc_system_assets`, `rc_system_asset_versions`, `rc_branding`. One active version per (key, theme, device variant); history preserved; restore/reset audited; 30s-cached manifest invalidated on activation; durable-URL-only (blob:/data: rejected); binary uploads reuse the EXISTING /api/images/upload R2 pipeline (MIME+signature+size+content-safety).
- NEW `routers/rc_media.py`: `/api/admin/responsibility-center/media/*` (assets list, versions, upload version [inactive-first], activate, reset, alt text, branding GET/PATCH) + authenticated `/api/responsibility-center/media/manifest` + feature-flagged `PATCH /api/responsibility-center/{cid}/branding` (center-specific branding foundation; fallback order center→template→global→built-in). New admin perm `responsibility_center.manage_media` (founder). All mutations: reason (min 5) + immutable audit (media_version_uploaded/activated, media_reset_to_default, media_alt_text_changed, branding_changed).
- Branding config: product_name / short_name / tagline (defaults "OurRealm Responsibility Center" / "Responsibility Center" / "One System. Endless Possibilities.") + flags center_branding_enabled, template_logo_overrides_enabled, user_center_logo_allowed, user_center_cover_allowed (all default false).
- NEW frontend `pages/AdminRcMedia.jsx` (`/admin/media/responsibility-center`): section chips, asset cards (preview/key-copy/usage/dims/version info), upload modal (current-vs-new preview, client validation PNG/JPEG/WebP ≤3MB, dims capture, variant selects, reason, inactive-first then explicit Activate), versions modal (restore), branding settings panel. Linked from AdminResponsibilityCenter ("Media" btn) + AdminWebsiteMedia card.
- NEW `lib/rcAssets.js`: session-cached manifest, `RcImg` (lazy, reserved dims, onError fallback — never broken images), `useRcBranding`, `refreshRcManifest`. Integrated: hub (main_logo, hero, no_centers, title/tagline from branding), wizard (create_center illustration), dashboard (center branding icon → default_center_icon → lucide fallback; paused_member illustration), AdminResponsibilityCenter header (admin_icon). Zero visual regression when no assets uploaded.

### Renewal Digest & Preferences
- `run_digest_pass()` in rc_renewals.py: one grouped digest per Center per UTC day (unique dedup_key claim in `responsibility_center_digests` — overlap-safe), recipients owner+admins, empty digests never sent, counts+vault+shortfall in message, deep-link payload, send status recorded. Runs in the hourly scheduler loop (self-dedups daily).
- Warning suppression: when recipient's daily_digest pref on, 7/3-day individual reminders are covered by the digest (keys marked); 1-day reminder + all critical alerts (failed/paused/frozen) stay immediate. Digest off → individual reminders resume.
- Preferences: `rc_notification_prefs` (5 keys, default true) via GET/PATCH `/api/responsibility-center/preferences` (route ordered BEFORE /{center_id}); gates renewal-success + paused-member owner notifications. UI: Account Settings → Centers tab (5 toggles).

### Bundle B limitations/deferred
- Center timezone for digest timing = UTC (no center timezone field yet). SVG uploads not accepted (no sanitizer — by design). Template-specific asset overrides = flag only (templates ship in later bundle). Center-owner branding UI minimal (API + flags done; richer UI later). Education assets = media support only.

### Next: Bundle C (Responsibilities & Tasks) — NOT STARTED, awaiting founder approval

## Responsibility Center — Bundle A (Jul 31, 2026) ✅ COMPLETE — awaiting founder review
**Verified: testing_agent iteration_96 — 34/34 admin pytest (`tests/test_bundle_a_rc_admin.py`) + 8/8 renewal engine sim (`tests/sim_bundle_a_renewals.py`) + 27/27 Phase 1 regression + full frontend E2E. Zero issues.**

### 1. Admin Panel (`/admin/responsibility-center` + `/:centerId`)
- NEW `routers/rc_admin.py` (~18 endpoints, prefix `/api/admin/responsibility-center`): overview (real DB stats: center growth, memberships/adoption, vault coverage/warnings, Fire Power activity, recent admin actions), All Centers table (search name/ID/owner, status+flag filters, pagination), center detail + members/transactions/renewals/activity/audit/notes subresources, actions (pause/restore/archive/lock+unlock invitations/freeze+unfreeze vault/mark+clear needs_review), vault adjust (±, idempotent, before/after), transaction reverse (compensating txn, single-shot), member retry-renewal/reactivate, settings GET/PATCH, JSON export (logged).
- Granular perms: 14 `responsibility_center.*` perms; founder=all, other admin roles=view-only. Enforced backend-side (`require_rc_perm`). Non-admins 403 everywhere.
- Every mutation requires written reason (min 5 chars) → immutable audit row in `responsibility_center_admin_audit` (admin identity, timestamp, before/after).
- NEW frontend: `AdminResponsibilityCenter.jsx` (Overview/All Centers/Global Settings tabs), `AdminResponsibilityCenterDetail.jsx` (9 tabs + ReasonModal), AdminHub card, App.js routes.

### 2. Global Settings (versioned, audited, prospective-only)
- `responsibility_center_settings` (_id="settings") + `_settings_history`. 14 keys: create_cost(1000), seat_cost(100), period_days(30), creator_first_seat_included(T), owner_exempt(T — owner seat never auto-renews/pauses), reminder_days([7,3,1]), grace_days(0), auto_renewals_enabled(T), emergency_renewal_pause(F), max_centers_per_user(0), max_members_per_center(0), invitation_limit(50), center_creation_enabled(T), member_activation_enabled(T).
- `get_rc_settings()` (10s cache) wired into create/invite/accept/config. Defaults exactly preserve Phase 1 behavior.

### 3. Renewal Scheduler (`services/rc_renewals.py`)
- Hourly asyncio worker (env `RC_RENEWAL_INTERVAL_SECONDS`, default 3600), started/stopped in server.py lifespan (purge_cron pattern). UTC internal.
- Claim-based locking (`renewal_claim_until`, 10 min) + period-scoped unique idempotency key (`rc-renew:{cid}:{uid}:{period_end}`) → PROVEN: 2 concurrent workers = exactly 1 burn.
- Success: burn seat_cost from Center Vault (conditional $gte), extend period from due date, ledger `seat_renewal`, attempt record, activity, owner notification.
- Insufficient: NO burn, membership → paused (or `awaiting_fire_power` during grace_days>0), attempt record with exact FP needed, owner+member notified, all data preserved.
- Warnings pass: 7/3/1-day reminders to owner, deduped per (period, closest threshold) via `warnings_sent`; larger thresholds marked covered (bug found+fixed in testing).
- Emergency pause: skips processing, touches nothing.

### 4. Paused-member & warning flows
- Member states: active / renewal_soon / awaiting_fire_power / paused / invited / declined / left / removed (derived via `membership_state`).
- Paused dashboard: safe status info ONLY (paused_notice payload — no members/activity/vault txns). Paused members blocked from all actions (_require_member).
- Owner dashboard renewal panel: renewing 7/3/1-day counts, awaiting, paused, vault balance/coverage, FP needed+shortfall 7d, Add Fire Power btn, Reactivate Eligible Members btn.
- Reactivation: `POST /{cid}/members/{uid}/reactivate` + `/reactivate-eligible` (perm `manage_renewals` = owner/admin) — burns seat_cost, NEW period from now, duplicate-safe, ledger `seat_reactivation`, member notified.
- New notification kinds: rc renewal_reminder / renewal / renewal_failed / member_paused / paused / reactivated / admin_action — all deep-link via payload.link (Notifications.jsx default case navigates).
- Enforcements: vault_frozen blocks fund/accept/renew/reactivate; invitations_locked blocks invites; paused/archived center blocks invites+activation (funding allowed while paused for recovery).

### New collections (Bundle A, additive)
`responsibility_center_settings`, `_settings_history`, `_renewal_attempts`, `_admin_audit`, `_admin_notes`. New ledger txn types: `seat_renewal`, `seat_reactivation`, `admin_adjustment`, `admin_reversal`.

### Bundle A known limitations / deferred
- Admin table "Official" flag settable only via DB (create_official UI = later bundle). Export = JSON (PDF/CSV in Bundle F). Owner transfer/closure = Bundle D. Reported-centers stat reads `open_reports` field (moderation integration = later bundle). Admin roles other than founder are view-only (per-admin perm assignment later).

### Next: Bundle B (admin media & logo management) — NOT STARTED, awaiting founder approval
Then C = Responsibilities & Tasks, D = Owner Transfer + Granular Permissions, E = Groups + Calendar, F = Reports + Notifications expansion, G = Templates/Widgets/Search/Moderation/polish.

## Responsibility Center — Phase 1, Step 1 (Jul 31, 2026) ✅ COMPLETE — awaiting founder verification

**Verified: testing_agent iteration_95 — 27/27 backend pytest (`tests/test_responsibility_center.py`) + 100% frontend E2E (hub, wizard, dashboard, settings tab). Zero issues.**

### Business rules (Fire Power only — never money)
- Create a Center: burns **1,000 FP** from creator's `fire_wallets.vault_balance` (atomic conditional `$inc`, idempotent via `client_token` unique-index reservation). Includes creator's first 30-day owner seat.
- Member seat: **100 FP per user per 30 days**, paid from the **CENTER VAULT** when an invitee accepts (409 with friendly message if vault < 100). Race-safe transition with refund on conflict.
- Center Vault: any active member funds it from their own Fire Vault (atomic, idempotent per `idempotency_key`).
- Roles: owner(4) > admin(3) > manager(2) > member(1). Permission sets in `ROLE_PERMISSIONS` (edit_center, invite_members, remove_members, manage_roles, view_vault, view_activity, fund_vault). Owner role can never be assigned/changed/removed; owner cannot leave in Phase 1.

### Backend
- NEW `/app/backend/services/responsibility_center.py` — create_center, fund_vault, invite_member, respond_invite, set_role, remove_member, leave_center, update_center, list_mine, center_members, center_dashboard, log_activity, ledger.
- NEW `/app/backend/routers/responsibility_center.py` — `/api/responsibility-center/*`: GET config, POST create, GET mine, GET/{id}, GET/{id}/members, PATCH/{id}, POST/{id}/vault/fund, POST/{id}/invite, POST/{id}/invites/respond, POST/{id}/members/{uid}/role, POST/{id}/members/{uid}/remove, POST/{id}/leave.
- Collections: `responsibility_centers` (holds vault_balance + member_count), `responsibility_center_memberships` ((center_id,user_id) unique; invited/active/declined/left/removed), `responsibility_center_transactions` (ledger, idempotency_key unique sparse), `responsibility_center_activity_logs`.
- Invite creates a `notifications` row kind=`responsibility_center_invite` (failure never blocks invite).
- Dashboard payload gates `vault_transactions` behind `view_vault` (manager+); plain members see balance only.

### Frontend
- NEW pages: `ResponsibilityCenterHub.jsx` (`/responsibility-center` — explainer, balance, my centers, pending invites accept/decline), `ResponsibilityCenterCreate.jsx` (3-step wizard: type → details → review/confirm burn; disabled when balance < 1,000), `ResponsibilityCenterDashboard.jsx` (`/responsibility-center/:id` — stats + Overview/Members/Vault/Settings tabs; invite, role select, remove, fund vault, edit center, leave).
- NEW `lib/rcTypes.js` (7 center types + role colors). MOD `App.js` (3 routes), `AccountSettings.jsx` (new "Centers" tab), `Settings.jsx` (Open Responsibility Center link).

### Step 2 (NOT built — next)
- Admin management panel `/admin/responsibility-center` (founder tools: browse all centers, adjust vaults, force actions, audit).
- 30-day renewal background scheduler (idempotent seat renewals from Center Vault, grace handling, `responsibility_center_renewal_attempts`), renewal notifications, seat-expiry enforcement.
- Owner transfer / center closure.

### Test state (preview DB)
- Demo center "Rivera Family" id=`cf5a475c04cd4860976920cda63fa6ff` (owner stealth, member tftwo). stealth FP vault ≈1,695; tftwo ≈800 (balances were set manually for testing).


## Increment B — Quick Fire Foundation (Jul 25, 2026) ✅ COMPLETE (awaiting founder approval for next increment)

**Verified: 10/10 new pytest (`test_quick_fire.py`) + full fire regression green (phase06 19/19, vault 21/21, fire_up 11/11, widget) + testing-agent E2E pass (iteration_91, all 13 checkpoints, desktop + mobile + newbie).**

### Behavior
- Main Fire button on EVERY post surface now ALWAYS opens the compact **QuickFireSheet** — never sends immediately (all levels/states). Chevron beside it (aria-label "Open full Fire Power controls") opens the existing full picker. Only one sheet open at a time; quick→full switch button inside the sheet.
- Quick sheet: slider default 1🔥 (init to current when reaction exists), "Send X🔥" confirm (disabled + "Current: X×" when unchanged), Remove chip, meta line (Level max / Up to X now / boost left / Current), Newbie fixed visible 1× slider with note. Nothing sent on open/slide/close/Escape/backdrop.
- **Server-authoritative range**: `GET /api/fire/quick-state/{post_id}` (`fire_power.quick_state()`) — same engine as react(): level max, pool available, reserved-for-reaction, finalized/edit-deadline, fire-paused, post eligibility (+reason). NO frontend range formula.
- ONE fire engine: both pickers call `sendFire` → `POST /api/fire/react` with per-call idempotency_key (existing `fire_idempotency` dedupe), difference-based charge/release, no-op when unchanged (no transaction), optimistic UI with rollback + toast on failure, postStore syncs duplicate mounted instances, pool display updates from response.
- A11y: dialog semantics, slider auto-focus + arrow keys + aria-valuetext, Escape close, focus returns to fire button, labeled controls.

### Files
- NEW `frontend/src/components/fire/QuickFireSheet.jsx`, `backend/tests/test_quick_fire.py`
- MOD `frontend/src/components/fire/FireButton.jsx` (sheet state machine, quickTap always opens quick, chevron relabeled, focus return, hint text), `backend/services/fire_power.py` (+quick_state), `backend/routers/fire.py` (+GET /quick-state/{post_id})
- Stale legacy fire tests aligned with current policy (auth-required endpoints post-iter88; lifetime credits at settlement; reaction settlement = 24h edit window): `test_fire_phase06.py`, `test_fire_vault_privacy.py`. `test_fire_power.py` remains a stale pre-0.6 suite (documented, not policy-accurate).
- New test account: quickfire.newbie@example.com / Password1$ (Newbie level, fixed 1×).

## Phase 3 — Media Sound Selector (Jul 25, 2026) ✅ APPROVED BY FOUNDER

**Verified: 13/13 pytest (`test_phase3_sound_selector.py`) + 9/9 media-rights regression + testing-agent frontend E2E pass (iteration_90, desktop + mobile), screenshots taken.**

### Backend
- `GET /api/sounds/browse` — permission-gated Sound browser feed: `use_type` (image_posts|video_posts), `q` search, `category` (Music/Podcast/FX), `genre`, `mood`, `sort` (trending|newest), `tab` (all|saved|mine|recent), `include_facets` (distinct genres/moods). Each row carries `reuse_eligible` + badge ("Available for OurRealm Reuse" / "Playable Only").
- `services/sound_attachments.py` — `browse_sounds`, `validate_attachment` (authoritative publication-time gate: deleted→410, private→410, moderation-blocked→410, suspended owner→410, not-enabled→403, all with "select another Sound" messaging), `sanitize_settings` (start/duration≤600s/volume 0–2/fades 0–10s/loop image-only), `attachment_doc` (frozen `permission_snapshot`), `record_recent_use` (`user_recent_sounds` collection).
- `POST /api/posts` — accepts `sound_attachment` {track_id,start_seconds,duration_seconds,volume,fade_in,fade_out,loop} on image/video posts (revalidated + snapshotted server-side) and `client_token` (duplicate-publish idempotency: same author+token returns the existing post).
- `POST /api/videos/{video_id}/replace-audio` — owner-only; revalidates Sound eligibility; creates a NEW derivative video: base video's VIDEO STREAM ONLY (`-map 0:v:0` — original audio structurally excluded) + Sound with trim/volume/fades; never overwrites base or private original; idempotent per (base, track, params) via `replace_params_hash`; derivative gets `audio_rights_status: replaced_with_ourrealm_sound` + `video_audio_rights` row with `rights_source: ourrealm_sound_reuse` + snapshot; mirrored to R2.

### Frontend
- `SoundAttachPicker.jsx` — compact modal browser (search, tabs Browse/Saved/My Sounds/Recently Used, category chips, trending/newest, genre/mood selects, preview play, eligibility badges, disabled Select for playable-only). Bottom-sheet on mobile, max-h 78vh.
- `SoundAttachmentEditor.jsx` — start/segment/fades, volume (video), loop (image), segment preview, remove/replace.
- `VideoUploadPicker.jsx` — "Replace with an OurRealm Sound" now live: pick sound → editor → upload muted base → auto replace-audio → publishes derivative; upload disabled until a Sound chosen in replace mode; Publish Muted remains DEFAULT; silent publish always possible.
- `Feed.jsx` — image posts: "Add an OurRealm Sound" button after staging images; `client_token` per compose session; posts render `PostSoundBadge` (image: client-side segment playback honoring start/duration/loop; video: attribution chip "♪ title — @owner").

### Demo data
- Track `d22ef302256a4652a34d348a3dc65194` "Neon Realm Groove" (owner stealth, preset media_posts) kept as the eligible demo Sound.

### Known pre-existing issue (NOT Phase 3)
- `tests/test_video_upload.py` uses deleted legacy user testfriend1 → login 401 setup errors (fails identically on the phase-1-2 tag).

## Media Studio Phases 1–2 — Video Audio Rights + Sound Reuse Permissions (Jul 25, 2026) ✅ APPROVED BY FOUNDER

**Verified: 9/9 pytest (`test_media_rights.py`), live curl enforcement checks, desktop + mobile screenshots of the composer Audio Rights panel.**

### Phase 1 — Video audio safety (server-enforced)
- `POST /api/videos/upload` accepts `audio_choice` (mute|original|replace, default **mute**), `rights_confirmed` (bool, default false), `upload_session_id` (dedupe key).
- `video_store.save_video()`: ffmpeg probes for audio streams (`_probe_has_audio`; unknown ⇒ assume audio = safe path). Audio publishes ONLY when `audio_choice=="original" AND rights_confirmed==true`. Otherwise a **muted derivative** is written (`_strip_audio`, video stream copied, `-an`); the original file moves to a private `.orig.<ext>` name that the public serve route rejects (400).
- Audit collection **`video_audio_rights`**: one row per upload — audio_detected, audio_choice, rights_confirmed(+at), terms_version, original_asset_ref, original_audio_volume.
- Idempotency: same `upload_session_id` ⇒ same video doc returned, count stays 1. Frontend also guards with `busy` flag + fresh UUID per staged file.
- `videos` docs carry `audio_rights_status`: `confirmed` / `muted_no_confirmation` / `no_audio` / `legacy_confirmation_not_collected`.
- UI (`VideoUploadPicker.jsx`): staging step with AUDIO RIGHTS panel — 🔇 Publish Muted (default), 🎵 Replace with OurRealm Sound (disabled until Phase 3, never exposes original audio server-side), 🎤 Keep Original Audio + unchecked rights checkbox + amber warning when unchecked.

### Phase 2 — Sound reuse permissions
- `services/sound_permissions.py`: 9 reuse flags (image_posts, video_posts, personal/group/community_realm, portal, nexus_district, world, future_environments), presets (playable_only / media_posts / realm_soundscapes / everywhere / custom), `can_reuse()` server gate, `permission_snapshot()` (frozen copy per use).
- `GET/PATCH /api/sounds/{id}/reuse-permissions` — owner or founder only (others 403).
- Migration (metadata-only, non-destructive): sounds missing perms → `playable_only`; historical videos → labeled `legacy_confirmation_not_collected` (files NEVER touched, never auto-muted).
- **Startup is DRY-RUN ONLY** (logs totals). Execution requires founder endpoint `POST /api/sounds/admin/media-rights/execute` with: exact phrase `APPLY MEDIA RIGHTS MIGRATION` + `target_environment` matching the server's own environment (derived from FRONTEND_URL: ourrealm.social ⇒ "production", else "preview") + non-empty audit `reason` + a dry-run on record within 24h (dry-runs are logged to `media_rights_migration_log` with runner identity). Execute records migration_version `media-rights-v1`, environment, reason, executor. Idempotent (verified: second execute modified 0 records).
- Git restore point: annotated tag **`phase-1-2-media-rights-verified`** → commit `7af25cc` on `main`.
- NOTE: preview DB migration already executed on 2026-07-25 (6 sounds → playable_only, 6 videos → legacy label) via the pre-gating startup hook. Production has NOT been migrated (no deploy). Log collection: `media_rights_migration_log`.

### Files
- MOD `/app/backend/services/video_store.py`, `/app/backend/routers/videos.py`, `/app/backend/routers/sounds.py`, `/app/backend/server.py`, `/app/frontend/src/components/VideoUploadPicker.jsx`
- NEW `/app/backend/services/sound_permissions.py`, `/app/backend/tests/test_media_rights.py` (9 tests, self-cleaning)

### Next (pending founder approval)
- Phase 3: Media Sound Selector · Phase 4: Media Studio · Phase 5: Realm Audio Context · Phase 6: Soundscape Playlist Widget · Phase 7: Portals/Nexus/Worlds audio · Phase 8: Moderation/Backfill/Deployment.

## Portals 1.4 — Config-driven Realm Template Foundation (Feb 7, 2026) ✅ COMPLETE

**Purpose:** finalize the reusable Realm architecture so every future Realm can ship as a single JavaScript config file, not a new class. Zero regressions on Portals 1.0–1.3.

### What shipped
- **`/src/lib/portals/TemplateRealm.js`** (~305 lines) — extends `Realm`; consumes a plain JS config with `metadata`, `lighting` (hemi + directional + ambient), `environment` (ground disc + optional river), `spawn`, `portal` (glowing torus marker), `particles` (any # of additive Points systems), `props` (`kind: 'tree' | 'rock' | 'plant'`), `ambientAudio`, `npcs`, `wildlife` (reserved hooks). Grows smoothstep on placement; portal core gently pulses; particles orbit; `getNamedObject(key)` exposes any placed node for future AI hooks.
- **`/src/lib/portals/realmTemplates/rainforest.js`** (~90 lines) — first-ever config-driven Realm. Full working scene: mossy ground disc + river strip + 8 procedural trees around the spawn + 5 rocks + 8 fern plants + 50-firefly additive particle preset + exit-portal marker + warm daytime lighting. **All authored as pure data.**
- **`/src/lib/portals/RealmTransition.jsx`** (~120 lines) — full-screen CSS fade overlay with pulsing accent-coloured portal rings + core, entering/exiting phases, GPU-composited, respects `prefers-reduced-motion`.
- **Registry upgrade** — `createRealm(id)` now accepts either a class OR a factory function (arrow function detection via `.prototype`), so config-driven realms register in one line: `"rainforest-lite": () => new TemplateRealm(rainforestTemplateConfig)`.
- **Metadata catalogue** — added `rainforest-lite` entry (status `internal_testing`, v1.4.0). Total realms now **13**.
- **Backend `VALID_REALM_IDS`** updated to accept `rainforest-lite` for override persistence.
- **PortalXRSession wiring** — imports `RealmTransition`, fires `{phase:"entering"}` when starting a session and `{phase:"exiting"}` on exit; transitions auto-dismiss after 900 ms / 700 ms respectively.
- **README.md** — new "Portals 1.4" section: TemplateRealm config surface, three-file recipe for adding a new Realm, RealmTransition usage, registry factory-vs-class contract.

### Verification
- Portal Dev Hub renders **13 realm cards**, `rainforest-lite` card present with correct badge + version. ✅
- `/realms/portals/ar/xr?realm=rainforest-lite` loads without errors, shows graceful "Immersive AR unavailable" on headless browsers (expected). ✅
- Public `/portals` Opening Soon vortex still spins. ✅
- Portals 1.0–1.3 fully intact: PortalsHub, PortalAR, PortalXRSession, AdminPortalsHub, AdminPortalDetail, PortalEngine, Realm, RainforestRealm, PlaceholderRealm, realmMetadata, registry, portalsApi, useAnimationVisibility all unchanged in behavior. ✅
- Backend supervisor restarts cleanly. ✅
- Zero lint issues on 5 new/modified JS files + admin_portals.py. ✅
- Zero console errors on `/admin/portals`, XR route, `/portals`. ✅

### Adding a new Realm going forward
1. Copy `/lib/portals/realmTemplates/rainforest.js` → `/lib/portals/realmTemplates/my-realm.js` and edit config.
2. Add one line to `REALM_CLASSES` in `registry.js`: `"my-realm": () => new TemplateRealm(myRealmConfig)`.
3. Add matching entry to `REALM_METADATA` in `realmMetadata.js`.
4. Realm is instantly launchable at `/realms/portals/ar/xr?realm=my-realm` (founder-gated) and appears in `/admin/portals`.

### Files
- **NEW** `/app/frontend/src/lib/portals/TemplateRealm.js`
- **NEW** `/app/frontend/src/lib/portals/realmTemplates/rainforest.js`
- **NEW** `/app/frontend/src/lib/portals/RealmTransition.jsx`
- **MOD** `/app/frontend/src/lib/portals/registry.js` (factory support + rainforest-lite)
- **MOD** `/app/frontend/src/lib/portals/realmMetadata.js` (new rainforest-lite metadata entry)
- **MOD** `/app/frontend/src/pages/PortalXRSession.jsx` (transition overlay wired)
- **MOD** `/app/frontend/src/lib/portals/README.md` (Portals 1.4 architecture section)
- **MOD** `/app/backend/routers/admin_portals.py` (VALID_REALM_IDS += rainforest-lite)



## Portals 1.3 — Backend Persistence + Platform Foundation (Feb 7, 2026) ✅ COMPLETE

**Founder edits now persist server-side + reusable schema for future iOS ARKit / Android ARCore / visionOS / Meta Quest / WebXR / desktop preview / mobile-fallback Realms, Unity deployments, and OurRealm Asset Scrolls. Verified by `testing_agent_v3_fork` iteration 71: 33/33 backend pytest + 14/14 frontend flows (100%).**

### Backend (new router `/app/backend/routers/admin_portals.py`)
MongoDB collection: **`portal_realm_overrides`** (+ `portal_realm_overrides_deleted` for forensics).
All routes gated by `require_admin(user)` — anon → 401, non-admin → 403, unknown realm → 404, invalid status → 422, and every mutation appends to `audit_history` (max 200 entries).

| Route | |
|---|---|
| GET `/api/admin/portals/overrides` | list all |
| GET `/api/admin/portals/{realm_id}/override` | fetch one |
| POST `/api/admin/portals/{realm_id}/notes` | free-form notes |
| POST `/api/admin/portals/{realm_id}/status` | change status (draft / internal_testing / founder_preview / private_beta / public_beta / released / disabled) |
| POST `/api/admin/portals/{realm_id}/toggle` | enable/disable (auto-flips status to `disabled` when toggled off) |
| POST `/api/admin/portals/{realm_id}/platform-readiness` | per-platform block merge (7 platforms) |
| POST `/api/admin/portals/{realm_id}/asset-scrolls` | replace attached Asset Scroll refs |
| POST `/api/admin/portals/{realm_id}/unity-deployment` | Unity project + build + release metadata |
| POST `/api/admin/portals/{realm_id}/ar-vr-compatibility` | AR/VR capability block |
| POST `/api/admin/portals/{realm_id}/roadmap-notes` | founder roadmap notes |
| POST `/api/admin/portals/{realm_id}/performance-notes` | performance notes |
| DELETE `/api/admin/portals/{realm_id}/override` | reset to catalogue defaults |

### Frontend
- **`/lib/portals/portalsApi.js`** — axios wrapper returning `{ok, override}` or `{ok:false, detail}`
- **`/pages/AdminPortalsHub.jsx`** — hydrates from `/overrides` on mount, optimistic Disable/Enable + server round-trip, load-error banner + Retry
- **`/pages/AdminPortalDetail.jsx`** — rewritten. Panels for Status/Toggle, Realm Profile, Platforms, Required Capabilities, Notes (auto-save), Roadmap Notes, Performance Notes, Platform Readiness (7 checkbox+textbox cards), Unity Deployment Metadata (14 fields), Asset Scrolls (add/remove refs with category + source_type), Audit History, Raw Persisted JSON. Each panel has its own Save button + loader + flash indicator. sessionStorage fallback for notes when backend is unreachable.

### Storage summary
- 1 primary collection (`portal_realm_overrides`) — 1 doc per realm, keyed by `realm_id`, upserted.
- 1 tombstone collection (`portal_realm_overrides_deleted`) — hard-delete snapshots with `deleted_at`/`deleted_by_*` metadata.
- Embedded `audit_history` per realm (max 200 recent entries, older ones auto-trimmed via `$push { $slice: -200 }`).

### Asset Scrolls foundation
Metadata-only for now (marketplace ships Portals 3.0). Each ref stores `asset_scroll_id`, `name`, `category`, `status`, `supported_platforms`, `source_type` (unity_prefab / web / gltf / …), `file_type`, `unity_prefab_path`, `web_asset_path`, `thumbnail`, `version`, `notes`, `approved_by`, `approved_at`. Founder can add/remove refs from the detail page today; when the marketplace ships, references simply start resolving to real assets — the schema is stable.

### AR/VR platform foundation
7 platform keys tracked per realm: `ios_arkit`, `android_arcore`, `visionos`, `meta_quest`, `webxr`, `desktop_preview`, `mobile_non_ar_fallback`. Each stores `supported`, `status`, `minimum_device_requirements`, `build_target`, `unity_build_profile`, `deployment_path`, `known_limitations`, `testing_status`, `last_tested_at`, `notes`.

### Unity deployment readiness
14 reserved fields per realm: `unity_project_name`, `unity_scene_name`, `unity_build_target`, `unity_bundle_id`, `unity_version`, `asset_bundle_url`, `addressables_catalog_url`, `webgl_build_url`, `ios_build_status`, `android_build_status`, `visionos_build_status`, `quest_build_status`, `release_channel`, `deployment_notes`. Full admin editor with per-field inputs + Save.

### Security summary
- Anon → 401 on every `/api/admin/portals/*`
- Non-admin authenticated → 403
- Unknown realm id (must be one of the 12 canonical ids) → 404
- Every mutation writes `{at, by_id, by_username, field, action, before, after}` to `audit_history`
- Public users still see `/portals` Opening Soon; `/realms/portals/ar*` still redirect anon to `/portals`

### Files
- **NEW** `/app/backend/routers/admin_portals.py` (~370 lines)
- **NEW** `/app/frontend/src/lib/portals/portalsApi.js` (~40 lines)
- **MOD** `/app/backend/server.py` (import + include_router)
- **MOD** `/app/frontend/src/pages/AdminPortalsHub.jsx` (backend hydration + optimistic toggle)
- **REWRITE** `/app/frontend/src/pages/AdminPortalDetail.jsx` (~600 lines, per-field persistence)
- **MOD** `/app/frontend/src/lib/portals/README.md` (Portals 1.3 architecture + schema + Unity+Asset Scrolls plan + Security summary)



## Portals 1.2 — Founder-only Portal Development Hub (Feb 7, 2026) ✅ COMPLETE

**Public surface unchanged. Every unfinished Realm is now invisible to normal users. Verified by `testing_agent_v3_fork` iteration 70 (13/13 scenarios pass, 100%).**

### What shipped
- **12-Realm metadata catalogue** (`/src/lib/portals/realmMetadata.js`). Rich schema: id, name, emoji, description, longDescription, thumbnail, accent, secondary, supportedPlatforms (AR/VR/Phone/Tablet/Desktop), requiredCapabilities, version, status (Draft / Internal Testing / Founder Preview / Private Beta / Public Beta / Released / Disabled), lastUpdated, notes, audioProfile, lightingProfile, weatherProfile, performanceLevel, estimatedFps, tags, hasGameplay. Query helpers: `listAllRealms`, `listPublicRealms`, `listFounderRealms`, `getRealmMeta`, `isRealmPublic`.
- **12 Realms registered**: Rainforest 🌴 (Founder Preview, v1.1.0, real gameplay), Aquarium 🌊, Cyberpunk 🌆, Snow ❄, Desert 🏜, Volcano 🌋, Space 🌌, Fantasy 🏰, Jurassic 🦕, Ancient Ruins 🏛, Tropical Island 🏝, Moon Colony 🌙 (Draft, placeholder gameplay).
- **PlaceholderRealm** (`/src/lib/portals/PlaceholderRealm.js`) — reusable Three.js fallback (neon obelisk + orbiting glyph particles + soft ground disc coloured from the realm's accent). Every metadata-only realm is instantly launchable.
- **Auto-discovering registry** (`/src/lib/portals/registry.js`) — `createRealm(id)` returns the registered class or a `PlaceholderRealm(meta)`. Adding a new realm = 1 metadata entry (`hasGameplay: false`); promoting to full gameplay = 1 line in `REALM_CLASSES`.
- **Portal Development Hub** (`/admin/portals`, `/src/pages/AdminPortalsHub.jsx`) — Founder-gated. Hero panel with 3 live stats (Total Realms / With Gameplay / Public). Search box (name/description/tags). Status filter chips. Grid of 12 cards each with: gradient thumbnail + emoji, status badge, name + version, description, platform chips, performance/weather/audio/updated grid, notes, and 3 actions (Launch → `/realms/portals/ar/xr?realm=<id>`, Edit → detail, Disable/Enable → session override).
- **Realm Detail** (`/admin/portals/:realmId`, `/src/pages/AdminPortalDetail.jsx`) — Founder-gated. Hero with launch CTA. Panels: Platforms, Required Capabilities, Profiles, Tags, editable Notes textarea (sessionStorage-persisted with dirty-flag Save button), Raw Metadata JSON.
- **AdminHub integration** — new "Portal Development Hub" card added to `/admin` (Founder-only).
- **Access hardening** — `/realms/portals/ar`, `/realms/portals/ar/xr`, `/realms/portals/vr` are all wrapped in a new `<PortalsAdminGate>` in `App.js`. Non-admin visitors are redirected to `/portals` (Opening Soon). Direct URL entry to unfinished realms is impossible for public users.
- **Documentation** — `/src/lib/portals/README.md` (architecture + step-by-step "How to add a new Realm" + full public/founder route table + roadmap).

### Success criteria — all met
- ✅ Public users still see the Opening Soon page at `/portals`.
- ✅ Founder / Admin users have a dedicated Portal Development Hub at `/admin/portals`.
- ✅ Rainforest is only reachable inside Founder tools.
- ✅ New Realms can be added with a single metadata entry (or one metadata entry + one class registration for gameplay).
- ✅ Engine is prepared for the future Portal Selector (query helpers reserved on `realmMetadata.js`).
- ✅ No regressions on `/portals`, `/realms`, `/admin`, `/admin/orion`, `/admin/analytics`.
- ✅ Responsive on mobile / tablet / desktop.
- ✅ Testing agent iteration 70: 13/13 (100%), 0 UI bugs, 0 integration issues, 0 design issues, 0 action items.

### Files
- **NEW** `/app/frontend/src/lib/portals/realmMetadata.js` (~245 lines)
- **NEW** `/app/frontend/src/lib/portals/PlaceholderRealm.js` (~115 lines)
- **NEW** `/app/frontend/src/lib/portals/README.md` (architecture + how-to)
- **NEW** `/app/frontend/src/pages/AdminPortalsHub.jsx` (~370 lines)
- **NEW** `/app/frontend/src/pages/AdminPortalDetail.jsx` (~310 lines)
- **MOD** `/app/frontend/src/lib/portals/registry.js` (auto-discovery + Placeholder fallback)
- **MOD** `/app/frontend/src/App.js` (new PortalsAdminGate; wired /admin/portals* and gated /realms/portals/*)
- **MOD** `/app/frontend/src/pages/AdminHub.jsx` (added Portal Dev Hub card)



## Portals 1.1 — Real WebXR AR Foundation (Feb 7, 2026) ✅ COMPLETE

**Modular reusable engine + first real 3D Realm. Verified via `testing_agent_v3_fork` iteration 69 (7/7 scenarios pass, 100%).**

### What shipped
- **PortalEngine** (`/src/lib/portals/PortalEngine.js`) — reusable Three.js + WebXR runtime. Static `PortalEngine.probe()` returns device capability. Owns WebGLRenderer, scene, camera, reference spaces, hit-test source, reticle, render loop, session lifecycle, and full GPU teardown. Emits typed events (`engine:init`, `xr:started`, `surface:detected/lost/placed`, `xr:ended`, `xr:error`).
- **Realm base class** (`/src/lib/portals/Realm.js`) — every future realm extends this; lifecycle: `preload / mount / onSurfacePlaced / update / unmount`. Base class handles GPU disposal.
- **RainforestRealm** (`/src/lib/portals/realms/RainforestRealm.js`) — first real 3D Realm. 12 procedural trees (trunk + rounded canopy blobs), 40 grass tufts (InstancedMesh), rocks, ferns, 60-point additive-blend firefly system with per-particle orbits, 3 procedural parrots that circle the canopy with flapping wings, smoothstep grow-in animation.
- **Realm registry** (`/src/lib/portals/registry.js`) — lazy `createRealm(id)` factory. Add a realm = 1 line.
- **PortalXRSession** (`/src/pages/PortalXRSession.jsx`) — new route `/realms/portals/ar/xr?realm=<id>`. Handles the full immersive-ar flow: probe → "Enter Immersive AR" CTA → session start → hit-test reticle → tap-to-place → in-session HUD → exit + re-enter. Graceful fallback UI with device-specific instructions when WebXR is unsupported.
- **Preview upgrade** — `/realms/portals/ar` now surfaces an "Enter Immersive AR" CTA inside the Preview card **only when** `navigator.xr.isSessionSupported('immersive-ar')` resolves true (i.e. ARCore Android Chrome).

### Contract for future realms
```
class MyRealm extends Realm {
  constructor()                    { super("my-realm"); }
  async preload(engine)            { /* async assets */ }
  mount(engine)                    { /* add to this.root */ }
  onSurfacePlaced(pose, engine)    { /* anchor logic */ }
  update(dt, xrFrame, engine)      { /* per-frame anim */ }
}
```
Register once in `/lib/portals/registry.js` → route `/realms/portals/ar/xr?realm=my-realm` works.

### Constraints & limits (intentional)
- iOS Safari **does not** support WebXR immersive-ar in 2026 — those users see the graceful fallback + keep the /realms/portals/ar preview.
- Headless Playwright cannot start an immersive-ar session. Testing agent verifies the fallback UI, cleanup on unmount, engine dispose contract, and no regressions on existing routes.
- 3D models are **procedural** — no external GLTF assets, so the entire bundle stays lightweight.

### Files
- **NEW** `/app/frontend/src/lib/portals/PortalEngine.js` (~260 lines)
- **NEW** `/app/frontend/src/lib/portals/Realm.js` (~50 lines)
- **NEW** `/app/frontend/src/lib/portals/realms/RainforestRealm.js` (~230 lines)
- **NEW** `/app/frontend/src/lib/portals/registry.js` (~25 lines)
- **NEW** `/app/frontend/src/pages/PortalXRSession.jsx` (~380 lines)
- **MOD** `/app/frontend/src/pages/PortalAR.jsx` (added `Enter Immersive AR` button in preview card)
- **MOD** `/app/frontend/src/App.js` (wired `/realms/portals/ar/xr` route)
- **DEP** `three@0.170.0` added via yarn.

---

## Portals 1.0.4 — Opening Soon Hub (Feb 7, 2026) ✅ COMPLETE

The `/portals` route now ships a full **Opening Soon** teaser (replacing the Phase-1.0 registry-driven browser). Massive spinning neon-green energy vortex (3 layered `conic-gradient` planes rotating at different rates), orbiting rim particles, outer bloom, electric flicker overlay, drifting dust motes, animated grid + fog backdrop, cycling status text ("Initializing Portal Network... / Constructing Realms... / Stabilizing Portal Energy... / Preparing for Launch...") that pauses when the tab is hidden, and a **Notify Me When Portals Launch** CTA that triggers a local toast ("Portals are currently under development."). CSS-only animations, 60fps-friendly, respects `prefers-reduced-motion`, safely clears the fixed BottomNav on mobile / tablet / desktop.



## Portals 1.0 — Rainforest Realm AR Foundation (Mar 1, 2026) ✅ COMPLETE

**Frontend-only, mobile-first. Lightweight build (4 new files, 1 modified). Verified via smoke-test on iPhone-size viewport (390×844).**

### Routes shipped
- `GET /portals` — **Portals Hub**. Neon-green "Step Through Reality" page driven dynamically by `/src/config/portals.js`. Featured Rainforest AR card + Coming-Soon VR card. Renders inside ShellRoute (Layout chrome preserved).
- `GET /realms/portals/ar` — **Rainforest Realm AR**. Fullscreen `getUserMedia({facingMode:'environment'})` camera passthrough + layered CSS/SVG jungle holograms. Renders **outside** ShellRoute so the camera + HUD use the entire viewport (incl. iOS safe-area insets).
- `GET /realms/portals/vr` — **VR Coming Soon** placeholder with the same Portals aesthetic (purple variant). Back-to-Portals link.

### Rainforest AR experience
- **Camera lifecycle** — explicit permission gate ("Allow Camera & Enter" CTA), live state machine (`idle / requesting / live / denied / unavailable`), friendly denied-state with iOS/Android specific instructions, automatic cleanup on unmount (every track `.stop()`-ed).
- **Layered overlays**:
  - Canopy SVG + radial leaf gradient at the top (opacity scales with phone tilt via `deviceorientation.beta`).
  - 3 animated light rays through the canopy (CSS keyframe flicker).
  - Mist veil + up to 12 fireflies (low-quality mode dims to 0).
  - Left + right vertical tree trunks with leaf clusters (SVG silhouettes).
  - Ground silhouettes + flowing river (dual-layer 90deg gradient + repeating water lines, GPU-friendly `background-position` animation).
- **Looping creatures** (all CSS-keyframe loops, GPU-friendly transforms only):
  - **Caiman** 🐊 swimming back and forth in the river (14s loop, mirrors direction).
  - **Jaguar** 🐆 pacing along the riverbank (11s loop, mirrors direction).
  - **Macaws + Toucans** 🦜🐦 flying across with depth-fake scale + opacity changes (3–5 birds).
  - **Monkeys** 🐒 climbing the left + right tree trunks toward the canopy (10–12s loop).
  - **Frog** 🐸 hopping in place near the ground.
- **HUD controls** — Rainforest Realm label (with live pulse dot), Ambient toggle, Creatures toggle, Quality (Balanced / Low), Exit Portal button → `/portals`.
- **Performance** — `prefers-reduced-motion` respected, Low-quality mode cuts particle count + creature counts, animations limited to `transform/opacity` (no layout thrash), no external assets, no 3D models.

### Future-ready architecture
`/src/config/portals.js` ships a typed registry: `{ portalId, realmId, realmName, theme, route, status, supportedModes, overlayLayers, creatures, ambientEffects, performanceProfile, futureHooks }`. Adding a second realm = 1 entry. `futureHooks` lists the stubs for WebXR / Unity bridge / spatial mapping / multiplayer / persistence so Phase 1.1+ can flip them on without a route refactor.

### Compatibility & regressions
- Zero changes to existing routes / backend. `/`, `/signin`, `/admin`, `/admin/orion`, `/realms` all still 200.
- No backend endpoints added.
- All Phase 3.7.x Orion work untouched.

### Known limitations (intentional, per credit cap)
- Camera-live overlay can only be visually verified on a real device — Playwright headless has no camera hardware.
- iOS Safari requires a user gesture for `DeviceOrientationEvent.requestPermission()`; we trigger it inside the same click that requests camera so most users get both at once. If the user dismisses motion, the canopy still renders at its baseline 45% opacity.
- Only the Rainforest Realm is live in Phase 1.0 — additional realms / Unity bridge / multiplayer reserved for future phases.

---

## Phase 3.7.5 — Orion Approval UX Polish (Mar 1, 2026) ✅ COMPLETE

**Frontend-only UI polish. Verified via testing_agent_v3_fork iter_68 → 100% (21/21 checks + 3 regression). Zero bugs, zero backend changes.**

### What shipped
- **Polished list cards** (`ApprovalsPanel` rewrite) — 2-column grid on desktop, single-column on mobile. Each card now shows: colored 44px icon, kind label (Badge / Widget / Announcement / Moderation / Support reply / Provider) in accent color, "Generated by Orion" author tag, relative timestamp (4h ago / 18h ago / Jun 26), truncated draft title, optional one-line summary, **PENDING** (amber) + **DRAFT ONLY** (slate) status pills, right-chevron. Hover lifts and tints the border with the accent color.
- **Read-only details modal** (`ApprovalDetailsModal`) — React-portal-mounted (`document.body`) so it never gets z-index-trapped. Shows: header with kind + author + full timestamp, X close, **Draft Preview** (markdown), **Properties** grid (8 fields — Type, Tool, Created, Status, Confirmation required, Prepared draft, Result, Latency), Orion summary, **amber draft-only notice** with the exact spec text "This draft is awaiting execution. Live approval and publishing will be available in Phase 3.8.", 4 **disabled** Phase 3.8 action buttons (Edit / Approve / Decline / Delete) with `title="Available in Phase 3.8"` and a `Phase 3.8` tag pill.
- **Modal UX**: Esc closes, scrim click closes, body scroll preserved, blur backdrop, accent-tinted glow.
- **Refresh button** + loading spinner + clean green-check empty state.
- **Backend untouched** — reuses `/api/admin/orion-logs/actions?approval_status=pending`. Zero API calls fired by clicking the disabled action buttons (verified).
- **Mobile responsive** — single-column at <880px, right-side pill column hidden at <520px, 4-button footer wraps 2×2.

### Carry-over (untouched by Phase 3.7.5)
- All Phase 3.7.1 / 3.7.2 / 3.7.3 / 3.7.4 functionality preserved. No regressions to Cmd+K palette, AdminHub Orion status pill, Quick Actions favorites, Health Dashboard, CSV export, provider audit logs.

### Reserved for Phase 3.8
- Real execution wiring on Edit / Approve / Decline / Delete with the existing approval gate.
- Live publish path that returns real IDs and writes to existing collections (badges, widget_registry, announcements).
- Founder-confirmation token round-trip.

---

## Phase 3.7.4 — Orion Operations Center Polish & Reliability (Mar 1, 2026) ✅ COMPLETE

**Backend + frontend extension. Verified via testing_agent_v3_fork iter_67 → 100% (11/11 pytest + 22/22 frontend smoke).**

### Reliability & audit logging
- **Provider event audit**: new `services.orion_analytics.log_provider_event()` appends `provider_switch` / `provider_failure` rows to the existing `orion_action_logs` collection (reusing the audit infra — no new collection). `widget_chat` wraps the LLM call in try/except and logs both fallback successes and total failures.
- **No new provider logic** — Phase 3.7.3's OpenAI → Emergent fallback is preserved untouched.

### Live health endpoint v2 (`/api/admin/orion/health`)
Now ships 10 checks (was 6): widget_registry, chat_config, llm_provider, sidebar_ids, dashboard_tiles, palette_entries, **mongodb**, **r2_storage**, **supabase**, **backend_api**.
- 30s in-memory cache (`_CACHE`) + `?fresh=1` bypass.
- Async checks run concurrently with `asyncio.gather` → cold call ~50ms (well under 500ms budget).
- Top-level fields: `ok`, `auto_healed`, `active_provider`, `cached`, `age_s`, `founder`.

### Admin Hub Orion live status pill
- New `OrionStatusPill` on the Orion card (Phase 3.7.2 card). Polls `/api/admin/orion/health` every 30s for founders only.
- Smart color/label semantics:
  - 🟢 **Healthy** — all checks ok.
  - 🟡 **Auto-Healed** — ok but widget_registry was rebuilt this session.
  - 🟡 **Warning** — non-LLM check failed (e.g. Supabase env missing).
  - 🔴 **Provider Down** — only when `llm_provider` check fails.
  - 🔴 **Unreachable** — endpoint refused / timed out.
- Tooltip surfaces `provider=…`, `failing=…`, `checked Ns ago`.

### Health Dashboard inside Orion Settings
- `SettingsPanel` rewritten to embed the live 10-row health grid with per-row color borders, refresh button (forces `?fresh=1`), and a meta line (`Overall · auto-healed · checked Ns ago · cached`).
- Reuses the same `/api/admin/orion/health` endpoint — no duplicate logic.

### Audit logs CSV export
- `GET /api/admin/orion-logs/queries/export` and `/actions/export` stream filtered rows as CSV with proper `Content-Disposition` headers. Reuses `_build_filter` so filters match the JSON endpoint exactly.
- Frontend: Export CSV button on `AdminOrionLogs` (per-tab, respects current filters, downloads via blob).

### Quick Actions polish
- localStorage-backed favorites (`orion-cc-quick-favorites`) + recently used (`orion-cc-quick-recent`).
- Search input filters tiles by label/prompt.
- Pin/unpin button per tile; Favorites group renders at top when populated; Clear-favorites action.

### Frontend startup validation tightened
- Console log on `/admin/orion` mount: `[Orion] backend health check ok (10 checks).` on full green, or a `console.warn` listing failing checks with their detail messages (cleaner than the previous error-only behaviour).

### Out of scope (reserved for Phase 3.8)
- Badge / widget / moderation **execution** tools.
- Database write tools.
- Wallet features.

---

## Phase 3.7.3 — Orion P0 Bug Fix: "Widget Not Found" + LLM 403/502 (Feb 28, 2026) ✅ COMPLETE

**Backend + frontend hotfix. Verified via testing_agent_v3_fork iter_66 (100% — 9/9 pytest + frontend smoke).**

### Bugs fixed
1. **Production "Widget Not Found"**: production `widget_registry` was missing the canonical `stealth_ai_5a6` row → every Orion chat call returned 404. Fix:
   - `widget_chat._load_widget()` now synthesizes a virtual widget from `widget_templates.stealth_ai` whenever the registry row is missing AND `widget_id ∈ ORION_WIDGET_KEYS = ("stealth_ai_5a6","stealth_ai","orion")`. Non-Orion widget IDs still 404 as before.
   - `widget_chat._heal_orion_registry()` upserts the canonical row via `$setOnInsert` (idempotent, never overwrites real seeds, marks `auto_healed:true`).
   - `server.on_startup()` kicks the heal hook on every boot.
2. **OpenAI 403 → Cloudflare 502 hang**: when OPENAI_API_KEY was rejected, the backend hung until the proxy returned a Cloudflare 502 HTML page. Fix:
   - `chat_conversations.call_openai_chat()` now chains two attempts: (a) OpenAI direct with our key, (b) Emergent Universal LLM Key via `emergentintegrations.LlmChat` (gpt-4o-mini). Auth failures collapse to a clean **HTTP 503** with detail `"Orion LLM provider is unavailable or misconfigured."` — never a 502, never a hang past the 45s `OPENAI_TIMEOUT_SECONDS`.

### New: `/api/admin/orion/health` (founder-only)
6-check diagnostic endpoint:
1. `widget_registry` — canonical Orion widget present (auto-heals if missing).
2. `chat_config` — editor_config.chat valid.
3. `llm_provider` — OPENAI_API_KEY and/or EMERGENT_LLM_KEY configured.
4. `sidebar_ids` — every sidebar id maps to a registered SectionRouter handler or `soon` flag.
5. `dashboard_tiles` — every QUICK_TILES id is registered (FE/BE id parity).
6. `palette_entries` — Cmd+K palette mirrors sidebar+tiles cleanly.

### Frontend: AdminOrion startup validation
`useEffect` on mount logs descriptive console errors for:
- NAV_SECTIONS ids without a SectionRouter handler (and not soon-flagged).
- QUICK_TILES missing prompt or id.
- Empty PROMPT_LIBRARY groups.
- Probes `/api/admin/orion/health` and logs `[Orion] backend health check ok (N checks)` or the failing checks list.

### Env update
Added `EMERGENT_LLM_KEY` to `/app/backend/.env` so the fallback path works without a redeploy of secrets.

### Production redeploy
Preview is verified GREEN. User must redeploy to production for the fix to land on https://ourrealm.social. Once redeployed, the startup heal hook + the auto-heal-on-chat path will repair prod automatically on first chat call.

---

## Phase 3.7.2 — Orion Command Center Polish + Admin Hub Card (Feb 28, 2026) ✅ COMPLETE

**Frontend-only enhancement. Verified via testing_agent_v3_fork iter_64 (49/52) + iter_65 (6/6 retest, 100%).**

### Added in this phase
- **Cmd/Ctrl+K Command Palette** (`AdminOrion.jsx`): global keydown listener toggles `paletteOpen`; new `<CommandPalette/>` component renders a full-screen scrim with backdrop blur, focused search input, keyboard nav (↑/↓/Enter/Esc), and a results list sourced from `NAV_SECTIONS` + the `PROMPT_LIBRARY`. Section rows jump section, prompt rows dispatch `orion-prefill` into Orion Chat. All `.orion-palette-*` CSS appended to `OrionStyles`.
- **Dynamic thinking states + streamReveal** wrapper: AI replies fade in token-by-token for a snappy streaming feel (no backend rewrite needed).
- **Prompt Library** quick-action tiles that dispatch into Orion Chat via the existing `orion-prefill` CustomEvent.
- **Admin Hub Orion Command Center card** (`AdminHub.jsx`): new card (`data-testid=admin-hub-card-orion`) sits alongside existing admin tools with purple accent (`#C26BFF`), `FOUNDER ONLY` badge, exact description ("AI assistant hub for founder operations, analytics, reports, drafts, approvals, and Orion tools."), and footer line `✦ Open Orion Command Center`. Founder-only via `roles:['founder']`. Renders the optional `card.footer` line via a new HubCard branch.

### Verified
- Founder sees the card in /admin (3-col desktop, 1-col mobile); clicking navigates to /admin/orion.
- Support admin does NOT see the card; existing 7 admin cards still render.
- Ctrl+K opens palette, filter works, Enter selects, Esc & scrim-click close, mobile (390x844) palette adapts to ~94vw.
- No regressions to the existing /admin/orion Mission Control UI (Phase 3.7.1).

---

## Phase 3.7.1 — Orion Full-Screen Founder Command Center (Feb 28, 2026) ✅ COMPLETE

**Frontend-only enhancement. Verified via direct screenshot smoke (desktop 1440×900 + mobile 390×844). Backend unchanged → covered by iter 63's 32/32 Phase 3.7 pytest.**

### UI architecture
A new founder-only **mission control** route at `/admin/orion` with a permanent left nav, a flexible main panel, and a right context rail (≥1280px). The existing profile widget remains a quick launcher — its header gains a small "Open in Command Center" icon for the founder. All chat traffic still goes through the same `/api/widgets/chat/{message,history,clear}` endpoints scoped to the `stealth_ai_5a6` founder widget.

### Screens / sections
Sidebar exposes 16 sections plus a reserved "Phase 4.0" group:
- **Dashboard** (default) — 6 live stat cards (queries today / all-time / refused / actions today / drafts pending / approvals) + Jump-In tiles + Sections grid.
- **Orion Chat** — full conversational workspace. Loads persistent history on mount. Renders Phase 3.7 drafts as structured **Draft Cards** (icon, eyebrow, title, body, Status/Impact/Risks/Launch meta rows, collapsible Technical details, Approve/Pin actions). Approval button injects the `Yes, execute` phrase via a `orion-prefill` CustomEvent.
- **Founder Briefing** — auto-fires the briefing on mount.
- **Quick Actions** — 12-tile grid (Founder Briefing, Investor Snapshot, Draft Badge, Draft Widget, Create Announcement, Support Digest, Moderation Digest, Growth/Realm/Health Report, Task Plan, Draft Support Reply). Each tile dispatches into Orion Chat with the right prompt.
- **Reports / Alerts / Support / Moderation / Realms / Widgets / Badges** — one-tap prompt lists.
- **Approvals** — live `/api/admin/orion-logs/actions?approval_status=pending` table.
- **Settings** — read-only Orion runtime state.
- **Phase 4.0 reserved**: Agents, Memory, Integrations (rendered disabled).

### Components added
- `/app/frontend/src/pages/AdminOrion.jsx` — entire page (~720 lines, scoped CSS in a `<style>` block to keep the Orion aesthetic isolated).
- Sub-components: `AdminOrion`, `SectionRouter`, `Dashboard`, `OrionChat`, `BriefingPanel`, `QuickActions`, `SimplePromptList`, `ApprovalsPanel`, `SettingsPanel`, `ChatBubble`, `Markdown` / `BasicMarkdown` / `inlineFormat`, `DraftCard` + `extractDraftFields`, `StatusCard`, `ContextDraftCard`, `RecentActivityCard`, `RoadmapCard`, `NavItem`, `SectionHeader`, `Stat`, `OrionLogo`, `OrionStyles`.
- `extractDraftFields()` + `DRAFT_HEADERS` regex set parses Phase 3.7 draft replies into structured cards.

### Routes
- `/admin/orion` (NEW) — `<Route path="/admin/orion" element={<ShellRoute><AdminOrion/></ShellRoute>}/>` in `App.js`.
- Existing `/admin/orion-logs` (Phase 3.7) linked from the sidebar footer + mobile topbar + Recent Activity card.

### Existing systems reused (no duplication)
- `/api/widgets/chat/{message,history,clear}` (Phase 3.5) — full conversational pipeline.
- `/api/admin/orion-logs/{summary,actions}` (Phase 3.7) — stats + approvals.
- Founder gate (`username === "stealth"`) duplicated at the page + backend (Phase 3.7).

### Responsiveness
- ≥1280px: 3-column grid `260px / 1fr / 320px`.
- 1024–1279px: 2-column `260px / 1fr` (context rail hidden).
- <1024px: single column, sidebar becomes a slide-in drawer triggered by `orion-cc-sidebar-toggle`. Mobile topbar with hamburger + ORION wordmark + audit-logs shortcut. Stat grid wraps to 2 cols, tile grid wraps to 2 cols. Verified no horizontal overflow on 390×844 (iPhone 14 size).

### Performance optimisations
- Single `<style>` block scoped via `.orion-cc-root` — zero global CSS bleed.
- Stat / activity / draft cards consume the same `/summary` payload (one GET per page mount).
- Briefing panel pulls live numbers once on tab mount (cancellable via cleanup).
- Chat composer auto-resizes inline (1–6 rows) without forcing layout thrash.
- `orion-prefill` CustomEvent pattern keeps Quick Actions / Tiles → Chat decoupled (no prop drilling).

### Accessibility
- Every interactive element has a `data-testid` for E2E.
- `aria-label` on icon-only buttons (sidebar toggle, close, audit-logs link).
- Keyboard: Enter submits chat; Shift+Enter newline; Escape closes mobile drawer (via existing scrim click).
- Color contrast: `--orion-fg=#E2F1FF` over deep navy passes AA against ≥4.5:1.

### Visual language
Deep navy gradient + radial cyan / blue / violet glows; sparse white-dot star field with a 12s twinkle keyframe; glassmorphism panels (`backdrop-filter: blur(18px)`); neon-cyan accents on active nav and primary buttons; per-stat hue glows (`--stat-hue`) using `color-mix` for subtle depth; smooth `transform: translateY(-1px)` hover lift on tiles. The OrionLogo component is a radial-gradient circle with a glow halo behind a `Sparkles` icon — used as both wordmark and chat-bubble avatar.

### Test results
- **Smoke (Playwright)**: page renders, dashboard shows live summary (90/90/9/20/11/9), sidebar nav switches to Orion Chat, suggested chip "Give me today's founder briefing" fires a real backend call and the briefing markdown renders with sections + bullets. Mobile 390×844: hamburger button present, dashboard collapses cleanly with no horizontal overflow.
- **Backend regression**: Phase 3.7 backend untouched → iter 63's 32/32 pytest covers it. No new backend code paths in this iteration.
- **Lint**: `mcp_lint_javascript` clean on `AdminOrion.jsx` + `ChatLayout.jsx`.

### Example founder workflows that now feel native
- **Briefing → Action**: Dashboard → "Founder Briefing" tile → briefing renders inline → chat continues with "Inactive realms" chip → result threads into the same session → "Draft an announcement about our growth this month" → Draft Card appears with Approve button.
- **Triage**: Sidebar → Moderation → tap "Most reported users this week" → result in chat → tap "Any risky moderation issues" → moderation risk card with draft footer.
- **Draft editing flow**: Phase 3.7 backend doesn't yet support patch-style edits ("change the icon" still regenerates). The UI is wired for it (DraftCard exposes Approve + Pin) and ready for Phase 3.8.
- **Conversation continuity**: chat history is persisted server-side (memory_mode='persistent') so returning to /admin/orion later restores the same thread.

### Files added / changed
- `/app/frontend/src/pages/AdminOrion.jsx` (NEW)
- `/app/frontend/src/App.js` — import + `/admin/orion` route.
- `/app/frontend/src/components/widgets/ChatLayout.jsx` — small founder-only "Open Command Center" launcher icon in the chat widget header.

### Limitations (deferred to Phase 4.0)
- **In-chat draft mutations** ("change the icon", "make it blue") — UI is ready; backend tools still emit fresh full drafts. A diff-style intent layer would land in Phase 3.8 / 4.0.
- **Charts** — Phase 3.7 returns markdown text; mini-charts (svg sparklines for DAU/WAU/MAU) would be a small additive Phase 4.0 task.
- **Conversation folders / multi-thread** — Orion is a single persistent thread per widget. Multi-thread UI would need a new backend `conversations` resource.
- **Streaming** — current `/widgets/chat/message` is buffered. Phase 3.5 SSE `/widgets/chat/stream` exists; wiring it into the AdminOrion chat is a 10-line follow-up.
- **Voice / agents / image gen / workflow builder** — explicitly Phase 4.0; sidebar slots are reserved with `soon` chips and disabled state.


## Phase 3.7 — Orion Founder Command Center (Feb 28, 2026) ✅ COMPLETE

**Tested via `testing_agent_v3_fork` — iter 63, 32/32 backend pytest + complete frontend e2e (desktop + mobile + founder + non-founder).**

### Architecture
Orion (the chat-widget AI surface) gains a **draft-only** Founder/Admin operations layer on top of the read-only Phase 3.6 analytics. New intents are inserted at the TOP of `INTENTS` so they win first-match over Phase 3.6. Draft tools emit text-only specs with a "**This is only a draft. Nothing has been created, launched, or executed.**" footer. **Explicit-confirmation phrases** ("Yes, execute" / "Confirm" / "Approve this action" / "Launch it now") are detected; vague replies ("ok", "looks good", "sure") never count. Even an explicit approval just logs `approval_status=approved + result=draft_only` and replies that nothing was executed — Phase 3.7 contains zero execution paths.

### New intents (13)
**Read-only**: founder_briefing, top_reported_users, top_reported_content, oldest_tickets, widget_launch_list, disabled_widgets, badge_holders, inactive_realms.
**Draft (logged to orion_action_logs as `pending`)**: moderation_risks, draft_badge, draft_widget, draft_announcement, draft_support_reply.

### Explicit-confirmation system
- `is_explicit_confirmation()` matches only the 4 strict phrases.
- Confirmation → row in `orion_action_logs` with `action_type=confirmation_received`, `approval_status=approved`, `result=draft_only`, `short_result_summary='approval_received_but_phase37_is_draft_only'`.
- Reply: *"Approval recorded in the audit log. No live action has been executed — Phase 3.7 is draft-only…"*

### New DB collections
- **`orion_action_logs`** (new): user_id, username, role, action_type, requested_action (≤500c), prepared_draft, confirmation_required, approval_status (pending/approved/declined/n/a), tool_called, timestamp, result (always `draft_only` in Phase 3.7), success, short_result_summary (≤200c), execution_time_ms.
- `orion_admin_query_logs` (Phase 3.6, unchanged) — still records every analytics query.

### New endpoints (founder-only — `stealth` gate)
- `GET /api/admin/orion-logs/queries` — paginated audit rows with filters: user, tool, intent, success, since/until, limit, offset.
- `GET /api/admin/orion-logs/actions` — same + `approval_status` filter, `action_type` filter.
- `GET /api/admin/orion-logs/summary` — 6 counters: query_total, query_today, query_refused, action_total, action_today, action_pending, action_approved.

### Founder-only page `/admin/orion-logs`
- 6-card summary header (Queries all-time / Today / Refused / Actions all-time / Pending / Approved).
- Two tabs: **Queries** (default) / **Actions**.
- Inline filter bar (≥1024px): user search, tool, intent/action-type, success select, approval-status select (Actions tab only), datetime-local since + until, Reset.
- Non-founder visitors see a polite "Founder-only" refusal card; backend still independently enforces 403.

### Security
- Founder/Admin gate (`is_admin_user`) for chat-side analytics; **Founder-only** (`username==stealth`) for `/admin/orion-logs/*` endpoints AND the page component.
- Non-admin chat queries → polite refusal at HTTP 200 (no endpoint leak).
- Read-only invariant statically verified: only writes in `services/orion_analytics.py` are to `orion_admin_query_logs` + `orion_action_logs`. ZERO writes to users/posts/reports/support_tickets/badges/widgets/realms/community_*.
- No secrets / JWTs / api_keys / raw rows ever logged.

### Files added / changed
- `/app/backend/services/orion_analytics.py` — +DRAFT_INTENTS, CONFIRM_PATTERNS, `is_explicit_confirmation()`, 13 new tools, `_log_action()`, extended dispatcher with confirmation branch + draft logging.
- `/app/backend/routers/orion_logs.py` (NEW)
- `/app/backend/server.py` — registered new router.
- `/app/frontend/src/pages/AdminOrionLogs.jsx` (NEW)
- `/app/frontend/src/App.js` — `/admin/orion-logs` route.
- `/app/backend/tests/test_phase37_orion_command_center.py` (NEW, 32 tests).

### Sample founder commands that now work
- *"Give me a founder briefing"* → composite executive summary
- *"Draft a badge for users who upload 1000 sounds"* → full YAML spec + risks + launch notes
- *"Draft a widget for …"* / *"Draft an announcement about our growth"* / *"Draft a reply for the oldest support ticket"*
- *"Most reported users this week"* / *"Most reported content"*
- *"Oldest unresolved tickets"* / *"Tickets needing urgent attention"*
- *"All launched widgets"* / *"Disabled widgets"*
- *"How many beta holders?"* (founder badge holders count)
- *"Inactive realms"* / *"Stale realms"*
- *"Any risky moderation issues right now?"* → risk assessment + draft recommendations
- *"Yes, execute"* / *"Confirm"* → approval logged, no execution

### Test agent NITs (non-blocking)
- Filter inputs debounce — currently re-issue GET on every keystroke. Consider 250ms debounce on text fields for production traffic.
- Audit timestamp is an ISO string — works for range queries because ISO sorts lex == chrono, but a BSON `Date` would be more robust.
- Founder check (`username=='stealth'`) is duplicated in 3 places. Centralising into `is_founder()` helper or a JWT claim would prevent drift if the founder username ever changes.
- `_build_filter` `$or`-on-intent could collide if future filters need their own `$or` — switch to merged `$and` if that day comes.

### Metrics not currently available (Phase 3.7 gracefully omits)
- View counts ("most viewed creators") — no view-tracking collection.
- Live streams — no `live_streams` collection.
- Mute history — `community_mutes` collection not currently populated.
- Suspension history — no `user_suspensions` collection yet.

### Future (Phase 3.8+, NOT in 3.7)
- Execution gating (the `Yes, execute` phrase actually performs an action) — needs strict per-tool whitelist + dry-run preview + reversibility plan.
- Per-admin RBAC beyond "founder vs non-founder" (e.g. `support_admin` can see support logs only).


## Phase 3.6 — Orion Founder/Admin Analytics Assistant (Feb 28, 2026) ✅ COMPLETE

**Tested via `testing_agent_v3_fork` — iter 62, 30/31 pytest PASS → 31/31 after the regex fix below.**

### Architecture
- **New service**: `/app/backend/services/orion_analytics.py` — 17 regex intents + 17 read-only tools + `detect_intent()` + `maybe_handle_admin_query()` + `_log_query()` audit writer.
- **Integration**: `/app/backend/routers/widget_chat.py:chat_message` calls `maybe_handle_admin_query(current, payload.message)` AFTER `_enforce_access()` and BEFORE the OpenAI / rate-limit path. When the intent matches, the OpenAI call is **skipped** and a deterministic markdown reply (`model="orion-analytics"`, `finish_reason="analytics_tool"`) is returned. All other paths (history, clear, regenerate, stream) are unchanged.
- **Read-only**: every tool only READS via `services/realm_pulse.py` + `db.<coll>.count_documents()` / `aggregate()`. The ONLY write in the entire service is the audit log insert.

### Tools (17 — all reuse existing analytics)
| Intent | Tool fn | Source |
|---|---|---|
| `today_snapshot` | `_tool_today_snapshot` | `realm_pulse.dau()` + counts |
| `investor_snapshot` | `_tool_investor_snapshot` | `realm_pulse.investor_snapshot()` + `community_totals()` |
| `dau` / `wau` / `mau` | `_tool_dau` / `_tool_wau` / `_tool_mau` | `realm_pulse.dau/wau/mau()` |
| `signups` / `total_users` | `_tool_signups` / `_tool_total_users` | `users` count |
| `content_today` / `content_week` | `_tool_content_today/week` | `posts`/`sounds`/`podcasts` count |
| `messages` | `_tool_messages` | `messages` + `community_messages` count (gracefully reports "not tracked" if neither coll exists) |
| `top_realms` / `new_realms` | `_tool_top_realms` / `_tool_new_realms` | `community_messages` aggregate → fallback to `community_hub_posts` → fallback to `community_memberships` |
| `top_creators` | `_tool_top_creators` | `posts` group-by author |
| `moderation` | `_tool_moderation` | `reports` count |
| `support` | `_tool_support` | `support_tickets` count |
| `badges` | `_tool_badges` | `user_badges` group-by `badge_key` |
| `widgets` | `_tool_widgets` | `users.widgets` unwind+group |

### Security
- **Founder/Admin gate**: `is_admin_user(current)` (from `core/deps`). Stealth is detected as `role="founder"` in audit logs.
- **Non-admin refusal**: returns `model="orion-analytics"`, HTTP 200, body: *"Those administrative analytics are only available to authorized OurRealm administrators."* — no 403, no endpoint name leak.
- **No secrets logged**: question is truncated to 500 chars; never the auth header / token / api_key body.
- **Direct DB access from frontend prohibited**: every analytics path is via the existing `/api/widgets/chat/message` endpoint over JWT.
- **Existing dashboards untouched**: admin/moderation/support/realm-pulse endpoints still return their original schemas.

### Audit log
New collection: `orion_admin_query_logs`. Fields: `user_id`, `username`, `role`, `question` (≤500c), `detected_intent`, `tool_called`, `timestamp` (ISO UTC), `success` (bool), `execution_time_ms`, `short_result_summary` (≤200c, NO raw rows). Refused non-admin attempts logged with `success=false` + `short_result_summary="refused: not_admin"`.

### Performance
- p50 / p95 per call: **3–9ms** (5 sequential `today_snapshot` calls all <2s by a 200× margin).
- Test agent NIT noted: `_safe_count` issues `list_collection_names()` once per tool call. Acceptable at current load; can be cached per request if hot path tightens.

### Fix-up post-iter-62
- Intent regex for `signups` extended to match past-tense verb: `\b(sign[\s-]?ups?|signed[\s-]?up|new\s+users|registrations|new\s+sign[\s-]?ups)\b`. Now `"How many users signed up this week?"` → `signups` (was → `total_users` due to ordering + missing pattern).

### Files touched
- `/app/backend/services/orion_analytics.py` (NEW)
- `/app/backend/routers/widget_chat.py` (analytics interceptor inserted in `chat_message`)
- `/app/backend/tests/test_phase36_orion_analytics.py` (NEW, 31 tests written by test agent)

### Sample queries that now work
- "Show today's snapshot" / "How are we doing today?"
- "Give me an investor snapshot" / "board update"
- "What's the DAU?" / "weekly active users" / "monthly active users"
- "How many users signed up this week?" / "How many sign-ups today?" / "new users this week"
- "How many users total?"
- "Thoughts created today" / "Sounds uploaded today" / "Videos uploaded today"
- "Top realms" / "fastest-growing realms" / "most active realms"
- "New realms this week"
- "Top creators" / "most active creators"
- "Open moderation reports" / "Moderation queue" / "Reports this week"
- "Open support tickets" / "Tickets today"
- "How many VIP holders?" / "badge counts" / "founder count"
- "Most used widgets" / "top widgets"

### Metrics deliberately NOT yet covered
- Stickiness segmentation (cohort retention beyond `realm_pulse.investor_snapshot`'s D30).
- Real "DAU/MAU" by privacy-preserving heuristic vs. raw active-session count — current implementation uses `realm_pulse.dau()` which is correct for the existing schema.
- "Most viewed creators" / "view count" — no view-tracking collection exists yet; gracefully omitted.
- Live streams — no `live_streams` collection; gracefully reported "not currently tracked".
- Messaging counts when `messages` + `community_messages` are both empty — surfaced as "not tracked" message.

### Future scope (NOT in Phase 3.6 — read-only only)
- Support AI assistant — Orion may *suggest* responses / *prioritize* / *detect duplicates* / *summarize trends* on tickets, but must NEVER send replies, change status, or modify ticket data. (Phase 3.7+)


## Phase 3.7 — Badge editor unlock + VIP outline color fix (Feb 28, 2026) ✅ COMPLETE

**Tested via `testing_agent_v3_fork` — iter 61, 100% backend (19/19 pytest) + 100% frontend Playwright pipeline.**

### Bug
Admin saves of VIP `border_color` (and any other system-badge visual field) silently reverted to the seeded green on the next render — the user reported VIP outline was "permanently stuck on green even after saving a new color."

### Root cause (three-fold)
1. **PATCH endpoint blocked locked badges entirely** — `/admin/badges/{id}` returned 403 if `doc.locked` was true, regardless of who called it. FOUNDER (and effectively any "locked" badge) was uneditable even by stealth.
2. **`seed_default_badges()` overwrote visuals on every backend boot** — the seed function ran a blanket `$set` of `border_color/glow_color/gradient/bg_color/text_color/icon` from `DEFAULT_BADGES` over the existing row, reverting any admin save the next time supervisor restarted backend.
3. **BadgeEditor UI exposed only 3 color pickers** — admins could change `color`, `gradient`, `glow_color` but had NO control over `bg_color`, `border_color`, or `text_color`. The user's edits were happening through some other path or being mis-attributed.

### Fix
- **Backend `update_badge`** (`/app/backend/routers/admin_widgets.py`): `_is_stealth(current)` now bypasses the lock check — founders can edit every visual + assignment property on every badge, including locked ones. Non-founder admins still hit the 403. DELETE still rejects locked + is_system for all callers (no change). PATCH now treats `bg_color`, `gradient`, `text_color`, `border_color`, `glow_color`, `description` as nullable — explicit `null` AND empty-string `""` both normalise to DB `null` so the runtime fallback chain takes over.
- **Backend seed** (`/app/backend/core/seed.py`): `seed_default_badges()` now only **backfills keys that are missing** on the existing doc (`k not in existing`). Admin edits are preserved across backend restarts. Verified by curl restart cycle.
- **Frontend `BadgeEditor`** (`/app/frontend/src/pages/AdminWidgets.jsx`): exposes 5 color pickers — Color (accent), Background, Border, Text, Glow — plus Gradient with presets. All 5 are `clearable`. On save, empty strings normalise to `null`. **`BadgePreview` updated** to mirror the runtime `ProfileBadges.BadgePill` truthfully (now honors `bg_color`, `text_color`, `border_color` fallback chain instead of the previous hardcoded `border=accent`, `fg=#0a0a0a`).
- **Renderer `/app/frontend/src/components/ProfileBadges.jsx`** — UNCHANGED. Already used `border = b.border_color || accent` where `accent = b.color || '#00FF66'`. The renderer was correct all along; the bug was upstream.

### Audit confirmation
- Zero hardcoded VIP / system-badge colors found in frontend (grepped for `#00FF66`/`#00ff66`/`VIP_DEFAULT`/`vipColor`/etc. — only matches are in the seed `DEFAULT_BADGES` baseline, the BadgePreview accent fallback, and the BadgeRow icon tint preview, all of which read from the badge doc).
- Renderer uses **only** database values for `text_color / bg_color / border_color / glow_color / gradient / icon / title / color`.

### Backward compatibility
- Existing badge assignments untouched — `user_badges` collection not modified.
- Auto-assignment rules untouched.
- Missing visual fields fall back through: `gradient → bg_color → color`, `border_color → color`, `text_color → #0a0a0a`, `glow_color → color`. All unchanged from before.

### Files touched
- `/app/backend/routers/admin_widgets.py` — `update_badge()` founder-bypass + nullable color set.
- `/app/backend/core/seed.py` — `seed_default_badges()` backfill-only mode.
- `/app/frontend/src/pages/AdminWidgets.jsx` — 3 new pickers (bg/border/text) + truthful `BadgePreview`.
- `/app/backend/tests/test_badge_editor_phase37.py` (new, 19 cases written by test agent).

### Test highlights
- VIP `border_color = #FF8800` → /profile/stealth pill computed border `rgb(255,136,0)` (no longer green).
- `supervisorctl restart backend` after edit → admin save persists (seed reset bug fixed).
- Empty-string → null normalisation verified end-to-end.
- `support_admin` (non-founder) → 403 when PATCHing locked FOUNDER (lock still respected for non-founders).
- Stealth can edit FOUNDER glow to magenta → /profile/stealth renders magenta glow.
- Gradient preset → solid color fallback chain confirmed.
- All 3 system badges restored to seed defaults at end of run.


## Phase X.4 — Realm widget management parity (Edit · Resize · Delete) (Feb 28, 2026) ✅ COMPLETE

**Backend smoke-tested via curl (PATCH config + PATCH size + DELETE all 200 OK). Frontend verified via `testing_agent_v3_fork` (iter 60) + screenshot — all 7 chips render on every existing realm tile in edit mode.**

### What changed
Realm founders/admins entering Widget Edit Mode on `/realms/:id` now see a full 7-chip control row on every widget tile:
- **Size**: S / M / L / XL (existing — `realm-widget-size-{size}-<id>`)
- **Move**: drag handle (existing — `realm-widget-drag-<id>`)
- **Edit (NEW)**: Settings icon → opens portal-mounted settings modal (`realm-widget-edit-<id>`)
- **Delete (NEW)**: Trash icon → opens portal-mounted confirmation modal (`realm-widget-delete-<id>`)

### Settings modal — registry-driven per-type fields
`RealmWidgetSettingsModal` PATCHes `/api/communities/realm/:id/widgets/:wid` with `{config}`. Field map:
- **poll**: question + options string-list (preserves `{id, votes}` by index → votes survive renames; new options get fresh `crypto.randomUUID` with `votes=0`)
- **countdown**: title + `datetime-local` target_date (ISO round-tripped)
- **notes / blog**: title + textarea body
- **calendar**: title + default_view select (month/week/day)
- **weather**: title + location
- **DEFAULT** (myfeed/top8/photos/videos/music/podcasts/events/etc.): title + subtitle pair → any future registry widget gets a working editor for free.

### Delete modal
Copy: *"Remove '<title>' from this Realm?"*. Confirm fires `DELETE /api/communities/realm/:id/widgets/:wid` (scoped to `community_widgets` only — `widget_registry` definition is preserved, other realms unaffected). Cancel + backdrop + Escape all close cleanly.

### Portal escape + mobile
Both modals mounted via `createPortal(document.body)` so they escape the grid's CSS transform/overflow context. Mobile bottom-sheet + desktop popover. Chip min size 28×28 with `touchAction: manipulation` → meets ≥28×28 tap target spec.

### Permissions
`showControls = isAdmin && editMode` — non-admin members see ZERO edit chips even with edit mode forced on via URL. The `draggable` attribute is also gated, so non-admins cannot start a drag.

### Files touched
- `/app/frontend/src/components/RealmWidgetSettingsModal.jsx` (NEW)
- `/app/frontend/src/components/RealmWidgetGrid.jsx` (added imports, props `onDeleted`, modals, Edit + Delete chips)
- `/app/frontend/src/pages/RealmDetail.jsx` (passes `onDeleted` to grid)

### Test agent notes & follow-ups (NIT, not blocking)
- `realm-widget-controls-<id>` uses `absolute -top-1 -right-1`; on viewport heights <820px the chip cluster briefly clips behind the realm tab bar. Consider lowering to `-top-3` or moving into tile padding.
- Per-tile button handlers re-create closures each render. Acceptable for current realm sizes (<30 widgets). Add memoization if a realm grows past ~30 tiles.
- PATCH (resize) error is silently swallowed in `setSize`'s catch — chip un-highlights without admin feedback. Consider a toast on PATCH error.
- "Customize Community" header button opens the chat-rename modal, not the widget editor. Same UX nit flagged in iter 59 — recommend renaming to "Rename Chat" so the toolbar Edit Widgets button becomes the obvious widget-management surface.


## Phase X.3 — Realm widgets restoration + CommunityChat actions parity (Feb 28, 2026) ✅ COMPLETE

**Tested via `testing_agent_v3_fork` — iter 59, 100% backend (15/15 pytest), ~95% frontend.**

### PART 1 — Realm widget registry now exposes the full social set
- Added `hub` to `SYSTEM_WIDGETS` with `placements: ["realm"]` (name="Realm Feed").
- `seed_system_widgets()` now honors a per-widget `placements` override (`w.get("placements") or ["profile","home","realm"]`).
- After re-seed, `/api/widgets/available?placement=realm` returns **17** widgets including hub; `?placement=profile` (17) and `?placement=home` (16) BOTH correctly exclude hub.
- Realm picker on `RealmDetail` (unchanged code) now exposes: myfeed, top8, live, videos, music, podcasts, photos, events, weather, calendar, countdown, notes, polls, survey, blog, radar, **hub**.
- Hub uses the existing `CommunityHubWidget` + backend `/api/communities/realm/:id/widgets/:wid/hub/posts` (Thoughts / Photos / Videos / Sounds / Events). Poll widget uses existing `RealmPollWidget`. Others fall through to `CustomWidgetRenderer` as labelled placeholders.
- Zero wallet / ads / marketplace / payments / crypto / banking / monetization widgets in the picker (DOM scan + API key list both verified).

### PART 2 — CommunityChat now uses the shared MessageActionMenu
- Replaced inline pencil/trash icons with a portal-mounted Edit / Delete / Cancel popup (the same `MessageActionMenu` used by DMConversationOverlay).
- Bubble interactions: click (own only), long-press 450ms (mobile), right-click (desktop) → opens the menu.
- Mobile bottom-sheet + desktop popover both rendered cleanly; on 375×812 iPhone viewport the sheet sits at `{16, 359, 522.5, 724}` — fully inside viewport.
- Mine-only gate: peer bubbles are non-interactive — zero `community-chat-actions-*` testids render.
- Edit reuses `PATCH /api/community-chats/messages/:id`; Delete reuses `DELETE` (instant, no per-message confirm — matches DM behavior).
- Removed unused `Trash2`, `MoreVertical` imports; `Edit3` retained for the Rename CTA.
- Zero `validateDOMNesting` / button-in-button warnings, zero uncaught errors.

### Files touched
- `/app/backend/routers/admin_widgets.py` — `SYSTEM_WIDGETS` gains `hub`; `seed_system_widgets()` honors per-widget `placements`.
- `/app/frontend/src/components/CommunityChat.jsx` — refactored bubble actions to use `MessageActionMenu` portal.
- `/app/backend/tests/test_realm_hub_widget.py` (new, 15 tests).

### Notes
- 13 admin-disabled widgets are hidden from the realm picker via the existing access-groups filter — admins can re-enable them at `/admin/widgets`.
- "Customize Community" button on the realm header → opens chat-rename modal (not widget editor). Widget editor is reached via `realm-customize` toolbar → `realm-widgets-edit-toggle`. Labeling is slightly confusing but functionally correct; logged as nit, not a fix in scope.


## Phase X.1 — VIP grant via badge_registry only (Feb 28, 2026) ✅ COMPLETE

**Tested via `testing_agent_v3_fork` — iter 57, 8/8 pytest cases pass.**

### What changed
`POST /api/auth/register` no longer uses the hardcoded `VIP_CUTOFF` user-count branch. VIP grants are now driven **exclusively** by the live `vip` entry in `badge_registry` (auto_rule='first_1000', cap = first_x). New user docs initialise with `is_vip=False` / `vip_joined_at=None`; the registry-driven block flips both fields when capacity exists.

- Removed `VIP_CUTOFF` import + the `current_count = await db.users.count_documents({})` branch from `/app/backend/routers/auth.py`.
- Initial doc: `is_vip=False`, `vip_joined_at=None` (was conditional on count < VIP_CUTOFF).
- Registry block (try/except-wrapped) remains the only path that sets `is_vip=True` + `vip_joined_at=now` + creates the `user_badges` row.
- Behavior preserved for the common case (live badge, holders < 1000) — same signups get VIP. When badge is draft / disabled / over cap, no VIP grant (the intended admin lever).

### Tests (iter 57, all pass)
- Static: no `VIP_CUTOFF` import, no `current_count` line in `auth.py`.
- Happy-path under cap → `is_vip=true`, `vip_joined_at` ISO, user_badges row with `source='first_1000'`.
- `/api/auth/me` round-trips `is_vip=true`.
- Cap full (PATCH `first_x=1`, 141 holders) → new signup `is_vip=false`, no badge row.
- Badge draft → new signup 200 OK with `is_vip=false`, no badge row, no 500.
- Founder/admin flows + reconcile unaffected; VIP holder count stable across PATCH down/up cycle.
- Cleanup: per-test `finally` blocks + module-scoped fixture remove all transient users + badge rows.

### Files touched
- `/app/backend/routers/auth.py` — removed legacy VIP block + import.
- `/app/backend/tests/test_iter57_vip_badge_registry_source_of_truth.py` (new, 8 tests).

### Non-blocking follow-up
- `models/schemas.py` `serialize_user` returns `vip_joined_at = doc.get('vip_joined_at') or doc.get('created_at')` — the `or created_at` fallback masks the truth on the wire when `is_vip=false`. Mongo source is correct (None). Consider dropping the fallback so non-VIP users serialize as `vip_joined_at: null`.
- iter55-leftover test users (`test_vip*` / `test_vipcap*` / `test_vipdraft*`, ~10 rows) remain in `users` + `user_badges` from a prior run that lacked finally-cleanup. Safe to leave; iter57 file is properly self-cleaning.


## Phase X.2 — Messages row-click regression fix (Feb 28, 2026) ✅ COMPLETE

**Tested via `testing_agent_v3_fork` — iter 58, 100% pass on exercised paths.**

### Bug
The iter 56 changes added `chat-row-<u>-avatar` and `chat-row-<u>-name` buttons inside the chat row, so clicking on the avatar or the peer's name navigated to `/profile/<u>` instead of opening the DM thread. This made the most-natural click target the wrong action.

### Fix
ChatsTab row reverted to its pre-regression shape — Avatar lives inside the single `chat-row-<u>-open` button along with the name + subline + timestamp, all sharing one `onClick={() => setActive(t)}` → DM overlay. The `openPeerProfile` helper and the unused `useNavigate` import in `ChatsTab` were removed.

Profile navigation from `/messages` now happens **exclusively** in two places:
- **DM overlay header**: `dm-header-avatar` + `dm-header-name` → close overlay → navigate.
- **Group/Realm `msg-sender-<u>` bubble label** → close overlay → navigate.

### Verified
- 4× click positions (avatar / name / subline / timestamp) on a chat row all open DM overlay, URL stays on `/messages?tab=chats`.
- `dm-header-avatar` + `dm-header-name` navigate to `/profile/<u>` and close overlay; browser-back returns cleanly.
- Pin/Unpin/Delete buttons on rows still work (sibling `e.stopPropagation()`).
- Realm row hub chevron still navigates to `/realms/<slug>`.
- Zero `validateDOMNesting` / button-in-button warnings, zero console errors.
- Selectors confirmed stable: `chat-row-<u>`, `-open`, `-pin`, `-delete`, `-pinned-badge`, `dm-overlay`, `dm-header-avatar`, `dm-header-name`, `conversation-overlay`, `msg-sender-<u>`.

### Files touched
- `/app/frontend/src/pages/Messages.jsx` — reverted ChatsTab row to pre-regression shape; DM header + group/realm sender nav untouched.



**Tested via `testing_agent_v3_fork` — iter 56, 100% pass on exercised paths.**

### Feature 1 — Profile navigation from Messages
- `/messages` Chats row: peer **avatar** (`chat-row-<u>-avatar`) and **name span** (`chat-row-<u>-name`) navigate to `/profile/<u>`. Row body (`chat-row-<u>-open`) still opens the DM overlay (unchanged).
- DM overlay header: **avatar** (`dm-header-avatar`) and **name** (`dm-header-name`) both close the overlay then `navigate('/profile/<u>')`.
- Group/Realm ConversationOverlay: peer sender label is now a button (`msg-sender-<u>`) that closes the overlay and navigates to `/profile/<u>`. Self ("mine") bubbles intentionally render no sender label.
- Self-navigation guard: `openPeerProfile` no-ops when `peer.username === me.username`.
- HTML compliance: lifted the avatar out of the nested `<button-in-button>` it previously sat in.

### Feature 2 — AdminWidgets BadgesTab editor pickers
- New form fields in `BadgeEditor`: `gradient`, `glow_color` (backend already accepts both on POST/PATCH).
- **ColorPicker**: native `<input type=color>` swatch + hex text input, defensive fallback so the swatch never throws on a partial hex.
- **GradientPicker**: From/To color pickers + angle range slider (0–360°), raw `linear-gradient(...)` CSS textbox, six presets (Gold, Green, Blue, Sunset, Violet, Ocean), and a Clear button.
- **Glow picker**: ColorPicker with `clearable` for `glow_color`.
- **BadgePreview** pill mirrors the runtime `ProfileBadges.BadgePill` renderer so admins see exactly the saved look.
- Empty gradient/glow strings are sent as `null` so the backend stores clean nulls instead of empty strings.

### Files touched
- `frontend/src/pages/Messages.jsx` — `openPeerProfile`, chat row markup, DM header buttons, group/realm sender button.
- `frontend/src/pages/AdminWidgets.jsx` — `BadgeEditor` form state + fields, new `ColorPicker` / `GradientPicker` / `BadgePreview` / `parseLinearGradient` helpers.

### Test coverage notes
- 4/4 Messages nav paths verified (chat row avatar + name, DM header avatar + name).
- Self-guard verified (no `chat-row-stealth-*` rendered for own user, no `msg-sender-*` on "mine" bubbles).
- 14/14 AdminWidgets editor checks verified (all pickers present, presets write CSS + reflect in preview, save+roundtrip+delete cleanup all pass).
- `msg-sender-<u>` path could not be exercised against the live preview dataset (Groups empty for stealth, dj realm has no peer messages). Logic is a direct mirror of `openPeerProfile`.



## Phase 3.3 — Signup-time VIP first_1000 + Playable Music/Podcasts (Feb 26, 2026) ✅ COMPLETE

**Tested via `testing_agent_v3_fork` — 21/21 pass (iter 55 report).**

### Fix 1 — VIP first_1000 auto-grant at /register
`POST /api/auth/register` now grants the VIP badge inline when the live `vip` badge has `auto_rule=first_1000` AND current_holders < `first_x`. Closes the gap where signup #998/999/1000 had to wait for the next backend boot or admin /reconcile click. Wrapped in try/except so a badge hiccup never blocks signup. Mirrors `is_vip = True` + `vip_joined_at` on the user doc for backwards-compat. Idempotent ($setOnInsert + upsert).

### Fix 2 — Music/Podcasts widgets now play actual audio
- New `<PlayableSoundRow>` adapter wraps the existing `<SoundPlayerCard>` (the same component used by the Sounds page & For You feed). Selected sounds render as real playable cards with play/pause/progress, not text.
- Track → post adapter: `{id, file_url, cover_url, title}` → `{id, sound_url, sound_cover_url, sound_title}`.
- Owner-only X remove button overlay (top-right, z-10, semitransparent black). Public viewers never see it.
- Subtitle row: `@username · category · duration` for context.
- All audio playback uses the existing `mediaUrl()` resolver → goes through `/api/media/audio/{filename}` proxy → R2 signed URLs work on Safari/iPhone.

### Fix 3 — Podcasts category case-insensitive
`/api/sounds/by-user/:u?category=podcast|Podcast|PODCASTS|podcasts|Podcasts` all return 200 now. Normalizes to canonical "Podcasts" before querying. Music + FX casing also normalized.

### Tests (testing_agent_v3_fork iter 55)
- VIP grant under cap → new signup gets VIP with `source='first_1000'`.
- VIP cap gate → when first_x=1, the 2nd signup doesn't get VIP.
- Draft safety → registration succeeds even when VIP badge is draft/deleted.
- Podcasts case-insensitive (×5 casings) → all 200.
- Music widget renders SoundPlayerCard, picker portals to body (`parentTag='BODY'`), X removes correctly, public viewer never sees X.
- Backend regression: 12/12 Phase 3.1 + 3.2 still pass.
- **21/21 total pass.**

### Files touched
- `backend/routers/auth.py` (VIP first_1000 inline grant at /register, lines 133-162)
- `backend/routers/sounds.py` (case-insensitive category normalization)
- `frontend/src/components/ProfileWidgetBodies.jsx` (PlayableSoundRow + SoundsBody update; SoundPlayerCard import)
- `backend/tests/test_iter55_register_vip_and_podcasts.py` (new, 9 tests by testing agent)

### Minor optional follow-up
Legacy `is_vip = current_count < VIP_CUTOFF` in /register (auth.py L60) duplicates the new badge-derived VIP source. Consolidating onto badge_registry-only would simplify the logic but isn't blocking — same behavior as before.



## Phase 3.2 — Live Badge Reconciliation (Feb 26, 2026) ✅ COMPLETE

### Endpoint
- **POST /api/admin/badges/reconcile** — re-runs the assignment rule for every live badge in the registry. Admin/founder only. Optional `?prune=true` query param removes recipients that no longer qualify (locked/founder badges and manual-only badges are skipped from pruning).
- Returns `{success, badges_processed, new_assignments, pruned, badges: [{badge, key, assigned, pruned, error?}]}`.

### Engine
Refactored `_apply_badge_assignment_rule(badge, *, prune=False)` to return `{assigned, pruned}` instead of an int. Prune mode tracks the set of qualifying user IDs during reconciliation and `delete_many` user_badges where `user_id $nin eligible_ids`. Existing /launch + /create + /patch paths updated to read `summary["assigned"]`.

### Admin UI
- New "Reconcile Live Badges" button in `AdminWidgets.jsx → BadgesTab`, placed next to "Create Badge" (data-testid=`badges-reconcile`).
- Confirmation dialog before firing, loading state during, results modal (`badge-reconcile-result`) after.
- Per-badge result rows show `+assigned` (green) and `−pruned` (when applicable). Failures show `ERR · …` in red.

### Tests (Phase 3.2 — 6 new pytests)
- Endpoint requires admin (403 for tfone).
- Basic run returns a summary covering FOUNDER + VIP + VERIFIED + any custom live badges.
- New user signup → reconcile picks them up immediately (no manual re-launch needed).
- Idempotent — re-running returns `new_assignments=0`.
- prune=true removes invalid recipients on `specific`-type badges.
- prune mode never touches FOUNDER badge (locked guard).
- **12/12 pass** across Phase 3.1 + 3.2 badge suites.

### Files touched
- `backend/routers/admin_widgets.py` — `_apply_badge_assignment_rule()` refactor + reconcile endpoint.
- `frontend/src/pages/AdminWidgets.jsx` — Reconcile button + `ReconcileResultModal` component.
- `backend/tests/test_phase32_badge_reconcile.py` (new, 6 tests).



## Badge Assignment Auto-Apply + Music/Podcasts Black Overlay Fix (Feb 26, 2026) ✅

### Issue 1 — Save + Launch didn't auto-apply group assignments
**Root cause:** `POST /api/admin/badges/{id}/launch` only flipped `status → live`. It did NOT iterate users to apply the chosen `assignment_type` rule. Admins clicking "all_users / founder / admin / vip / standard" + Save+Launch saw no user_badges rows created until they manually opened the assign modal and typed usernames.

**Fix:** New `_apply_badge_assignment_rule(badge)` helper in `routers/admin_widgets.py` that translates each `assignment_type` value into a Mongo `users` filter:
- `all` / `all_users` → every active (non-disabled, non-purged) user
- `founder` → users with `role|admin_role = founder` OR `username = stealth`
- `admin` → `role|admin_role ∈ {founder, admin, support_admin, moderator}` OR `is_admin = True`
- `vip` → users with `is_vip = True`
- `standard` → non-VIP, non-admin, non-stealth users
- `first_1000` / `first_x` → first N users by `created_at` ascending
- `specific` / `manual` → explicit `selected_usernames` list only

Hooked into:
- `POST /api/admin/badges` — applies immediately if created with `status=live`.
- `POST /api/admin/badges/{id}/launch` — applies on every launch.
- `PATCH /api/admin/badges/{id}` — applies when `assignment_type`, `selected_usernames`, `first_x`, or `status` changes on a live badge.

All paths use `$setOnInsert` upserts → re-launching is idempotent, no duplicate `user_badges` rows. Returns `newly_assigned` count in the response. Founder badge `locked` guard still 403s on PATCH/DELETE/assign/remove.

### Issue 2 — Music / Podcasts black overlay on widget cards
**Root cause:** `SoundPicker` modal used `fixed inset-0 z-[80]` with a `rgba(0,0,0,0.7)` backdrop. When opened, `position: fixed` should escape to the viewport — but the parent `SortableWidget` has an inline `transform` (applied by dnd-kit for drag preview). CSS spec: when an ancestor has a non-identity `transform`, descendants with `position: fixed` are positioned relative to that ancestor's containing block instead of the viewport. Result: the modal backdrop covered ONLY the Music/Podcasts widget card, creating the "black rectangle on top of the widget" bug.

**Fix:** Rendered the picker modal via `createPortal(<modal/>, document.body)` so it bypasses any transformed ancestor. Applied the same fix to PinVideoPicker and PinPhotoPicker which had the same issue. Music/Podcasts widget cards now stay clean at every size (S/M/L) and on resize/scroll/drag.

### Frontend visual fix — custom badge filled style
- `BadgePill` renderer: when only `color` is set on a custom badge, that color is now used as the FILLED pill background (was previously rendered as an outline-style with 18% transparency). Matches the seeded FOUNDER / VIP / VERIFIED visual style.
- `text_color` defaults to `#0a0a0a` (dark) for max contrast on filled bright accent backgrounds.
- Gradient / bg_color / border_color / glow_color still take precedence when provided.

### Tests
- **NEW `/app/backend/tests/test_phase31_badge_assignment.py`** — 6 tests:
  - Create-live with `all_users` immediately assigns to every active user.
  - Launching a draft `admin` badge assigns to admin tier (stealth + support).
  - Re-launching is idempotent (newly_assigned=0, no duplicates).
  - PATCH `assignment_type` on a live badge expands recipients.
  - Custom badge color round-trips through `/api/profile/{u}/badges`.
  - Founder badge still locked (PATCH/DELETE/assign all 403; launch is no-op).
- 60/60 pass across all related suites (Phase 3.1 badges, badge phase1, registry hydration, profile widgets, chat).

### Files touched
- `backend/routers/admin_widgets.py` — `_apply_badge_assignment_rule()` + hooks in create/launch/patch + `all_users` literal.
- `frontend/src/components/ProfileBadges.jsx` — filled-style fallback for custom badges with only `color`.
- `frontend/src/components/ProfileWidgetBodies.jsx` — 3 modals (SoundPicker / PinVideoPicker / PinPhotoPicker) wrapped in `createPortal(document.body)`.
- `backend/tests/test_phase31_badge_assignment.py` (new, 6 tests).



## Three-Phase UI Update (Feb 26, 2026) ✅ COMPLETE

### Phase 1 — Music/Podcasts black-overlay fix
**Root cause:** My previous height-cap change applied `flex flex-col` + `flex-1 min-h-0` to ALL widget cards. Inside the auto-row grid (`gridAutoRows: "minmax(150px, auto)"`), widgets without an explicit maxHeight had no determinate parent height — `flex-1` collapsed to 0, leaving the dark `.or-surface` background as a black overlay with hidden controls underneath.

**Fix:** Scoped the new flex layout to widgets that actually need internal scroll (chat / notes / blog). Other widgets (music / podcasts / videos / photos / etc.) keep the original block flow with `h-[calc(100%-2rem)]`. Music/podcast cards render normally again.

### Phase 2 — Star bar reduced to 4 icons
Removed the Profile (👤) entry from `TopStarBar`. Profile remains accessible via the bottom-nav avatar, user avatars across the app, profile links, mentions, friends, realm members, and direct URLs.

### Phase 3 — Badge Creator Upgrade (Founder / VIP / Verified system)
**Backend:**
- Extended `BadgeCreate` / `BadgePatch` schemas with rectangular visual fields: `bg_color`, `gradient`, `text_color`, `border_color`, `glow_color`, `badge_type` (system/manual/automatic), `locked`, `auto_rule` (first_1000/founder/admin).
- New `seed_default_badges()` (idempotent) seeds:
  - **FOUNDER** — locked, system, auto-assigned to @stealth only, gold gradient.
  - **VIP** — automatic, `auto_rule=first_1000`, green gradient.
  - **VERIFIED** — manual, blue gradient.
- New `backfill_first_1000_vip()` — auto-awards VIP to the first 1000 users by `created_at` ascending. Idempotent (won't re-award already-assigned users).
- Founder-lock guards on PATCH / DELETE / `/assign` / `/remove` endpoints — locked badges return 403 on any of these attempts.
- `/api/profile/{username}/badges` now surfaces all visual fields (gradient, glow, etc.) so the frontend can render rectangular pills.

**Frontend:**
- `ProfileBadges.jsx` rewritten as a `<BadgePill/>` renderer that uses the new visual fields. Falls back to the legacy single-accent style when only `color` is set, so older admin badges still render.
- Removed duplicate inline `FOUNDER` / `VIP` / `VERIFIED` badges from `FounderProfile.jsx` — the rectangular pills below the username are now the single source of truth.

**Live verification:**
- /api/admin/badges returns 5 badges (FOUNDER, VIP, VERIFIED + 2 pre-existing) with full visual fields.
- DELETE / assign on FOUNDER returns 403 "System / locked badges cannot be deleted." / "This badge cannot be manually assigned."
- VIP backfilled to 133 existing users (first_1000 rule).
- Public profile shows 3 rectangular badge pills (founder/og/vip) with gradients, no duplicate inline icons above.
- `/profile/stealth/badges` returns the full visual payload.

### Tests
- 41/41 pass across admin_widgets_badges_phase1, registry_widget_hydration, and profile_widgets_top8 suites.

### Files touched
- `frontend/src/pages/Profile.jsx` (scrollInternally flag; only chat/notes/blog use flex-col)
- `frontend/src/pages/FounderProfile.jsx` (mirror + removed duplicate inline badges)
- `frontend/src/components/TopStarBar.jsx` (Profile entry removed)
- `frontend/src/components/ProfileBadges.jsx` (rewritten as rectangular pill renderer)
- `backend/routers/admin_widgets.py` (extended badge schemas + founder-lock guards + visual fields in public endpoint)
- `backend/core/seed.py` (seed_default_badges + backfill_first_1000_vip + boot hookup)

### Known minor follow-ups (non-blocking)
- New user signups don't yet auto-trigger the VIP `first_1000` rule — they're awarded on the next boot. A `/api/auth/register` hook would close that loop. (Backfill covers all existing + restart users.)
- The admin Badge editor UI (in `AdminWidgets.jsx → BadgesTab`) doesn't yet expose the new visual fields (bg_color/gradient/glow). Endpoints accept them via curl/API; UI extension is a separate task.



## Fixes — Chat height / Video thumbnails / Sounds picker (Feb 26, 2026) ✅

### Issue 1 — Orion AI chat widget grew forever
**Root cause:** Profile grid used `gridAutoRows: "minmax(150px, auto)"` and the SortableWidget card had no max-height. ChatLayout's internal `overflow-y-auto` never engaged because the outer `or-surface` kept stretching to fit messages.

**Fix:**
- Added `SIZE_MAX_HEIGHT_PX` cap (small/medium=220, large=460, full=320) in both `Profile.jsx` and `FounderProfile.jsx`.
- Cap applied via inline `style={{maxHeight: …}}` only for layouts that scroll internally (chat / notes / blog). Other widget types stay auto-sized as before.
- Switched the WidgetBody wrapper from `h-[calc(100%-2rem)]` to `flex-1 min-h-0` so flexbox properly propagates the max-height into the scrollable child.
- `.or-surface` card now declares `flex flex-col` so header (auto) + body (flex-1 min-h-0) + ChatLayout footer (auto) compose cleanly.

**Verified:** card height = 451 px at `large` size, messages area scrolls internally (315 px scroll container). Conversation stays inside the widget regardless of message count.

### Issue 2 — Video tiles showed only a play badge (no preview frame)
**Root cause:** `<video>/upload` saved `{kind, url, video_id}` with NO `thumbnail` field. The renderer's fallback (`<video preload="metadata">`) is unreliable on mobile Safari and on ranged streams. So all videos rendered as a black tile with just a play icon.

**Fix:** Added `uploadVideoThumbnail(file)` in `ProfileWidgetBodies.jsx` — client-side first-frame extraction:
1. Spin up a hidden `<video>` with the local File object URL.
2. Wait for `loadedmetadata`, seek to `~0.1 s` (avoids the all-black before-keyframe slot), wait for `seeked`.
3. Draw to a `<canvas>` (capped at 800 px wide, preserves aspect ratio).
4. `canvas.toBlob('image/jpeg', 0.78)` → POST to `/api/images/upload` → save the returned URL as `item.thumbnail`.

Server stays ffmpeg-free. Renderer's existing `poster ? <img> : <video>` chain now consistently picks the baked image, even on mobile Safari.

**Fallbacks preserved:** if thumbnail extraction fails (timeout, blocked, codec quirk), the `<video preload="metadata">` fallback path remains for browsers that can render a first frame.

### Issue 3 — Music / Podcasts pickers showed no uploads
**Root cause investigated end-to-end:**
- Backend `/api/sounds/by-user/:u?category=Music` returns 3 Music tracks for stealth (verified live).
- `/api/sounds/by-user/:u?category=Podcasts` returns 0 for stealth because he has uploaded zero Podcasts — by design.
- Frontend `SoundsBody` + `SoundPicker` (`ProfileWidgetBodies.jsx` lines 395-553) correctly call the API with the right `ownerUsername` + `category` and render results.

**Conclusion:** the data + UI both work. Empty picker means the user hasn't uploaded a Music/Podcast track yet OR uploaded with the wrong category. The picker already displays a clear empty-state hint: *"You don't have any music sounds yet. Upload one from the Sounds page (set category to Music on upload)…"*

**No code change needed.** If founder reports a regression in production, they should verify:
1. The upload's `category` field is one of `Music | Podcasts | FX` (the only accepted values; AI uploads are intentionally disallowed).
2. The track's `visibility` is `public` (or the viewer is the owner).
3. `/api/sounds/by-user/<their_username>?category=Music` returns the expected list.

### Tests
- 60/61 pass across Phase 3.4 / 3.5 / registry-hydration / profile-widgets suites. The 1 failure (`test_phase34_providers::test_stealth_ok`) is an OpenAI 429 rate-limit hiccup — passes in isolation, unrelated to these changes.

### Files touched
- `frontend/src/pages/Profile.jsx` (SIZE_MAX_HEIGHT_PX + scrollable widget wrapper)
- `frontend/src/pages/FounderProfile.jsx` (mirror of Profile.jsx)
- `frontend/src/components/ProfileWidgetBodies.jsx` (uploadVideoThumbnail helper + Videos upload path)



## Bug fix — Registry widgets now render on profiles (Feb 26, 2026) ✅

**Reported:** Stealth AI (Founder-Only) and other launched registry widgets save to profile layouts but do not render anywhere on the profile.

**Root cause — three independent chokepoints all dropping registry widgets:**

1. **`migrate_strip_deprecated_widgets()` in `core/seed.py`** — runs on every startup and strips any widget whose `type` is not in the hardcoded `ALLOWED_WIDGET_TYPES` set. Was wiping the stealth_ai_5a6 widget right after the user saved it.
2. **`_filter_allowed_widgets()` in `models/schemas.py`** — same strict allowlist applied at `/auth/me` serialization. Even when the widget survived the DB, it was stripped before reaching the client.
3. **Profile.jsx + FounderProfile.jsx** — frontend filter `widgets.filter(w => ALLOWED_WIDGET_TYPES.has(w.type))` dropped any registry widget before it could reach `CustomWidgetRenderer`.

**Plus a fourth gap:** /auth/me + /profile/me + /profile/by-username never carried `editor_config` for registry widgets, so even if they had passed the filters there was nothing to render.

### The fix
- **New service `services/widget_hydration.py`** — caches `db.widget_registry` (TTL 30 s, cross-process Mongo stamp invalidation), exposes:
  - `valid_widget_types()` — union of hardcoded types + every live registry key.
  - `hydrate_registry_widgets(widgets, viewer)` — merges `editor_config` + `name` + `icon` from the registry onto each saved widget; drops stale references and access-group-restricted widgets the viewer can't see.
  - `invalidate_widget_registry_cache()` — bumps a Mongo `widget_registry_stamps` doc so OTHER worker processes pick up new widgets within one request.
- **`routers/profile.py`** — PATCH /me uses the dynamic `valid_widget_types()` allowlist. /me and /by-username/:u hydrate via `hydrate_registry_widgets()`. Stored docs stay minimal `{id, type, size}` — never bloat user records with hydrated config.
- **`routers/auth.py`** — `/auth/me` also hydrates so the owner-edit profile sees its custom widgets.
- **`models/schemas.py`** — `_filter_allowed_widgets()` relaxed to keep any widget with a non-empty `type` string. Stale validation handled downstream by the hydrator.
- **`core/seed.py`** — `migrate_strip_deprecated_widgets()` now uses the dynamic allowlist (hardcoded ∪ live registry keys) so registry widgets survive boot self-heal. Stealth's @founder cluster is preserved verbatim.
- **`routers/admin_widgets.py`** — every registry mutation (insert/update/delete/clone/launch/disable/from-template) now calls `invalidate_widget_registry_cache()`.
- **`Profile.jsx` + `FounderProfile.jsx`** — filter relaxed to `ALLOWED_WIDGET_TYPES.has(w.type) || !!w.editor_config`. SortableWidget header falls back to `w.name` then a prettified type string instead of `w.type` raw key. Picker carries `editor_config` + `widget_type` forward.
- **`ChatLayout.jsx`** — uses `widget.key` (registry key) when calling `/api/widgets/chat/*` instead of the per-instance saved id. Backend `_load_widget` accepts EITHER `id` or `key` for backward compat.
- **`core/deps.py`** — new `OptionalUser` dep for `/profile/by-username/:u` so the public endpoint can still personalize access checks for logged-in viewers (founder vs anonymous).
- **`CustomWidgetRenderer.jsx`** — already has a safe `CardLayout` fallback when `editor_config.layout` is unknown; no change needed.

### Tests
- **New `/app/backend/tests/test_registry_widget_hydration.py`** — 8 tests:
  - Save round-trip preserves registry widget.
  - `/auth/me` hydrates editor_config.
  - `/profile/me` hydrates.
  - Public `/profile/by-username/:u` hydrates (anonymous + logged-in).
  - Access-group restricted widgets hidden from non-members.
  - Stale registry references silently dropped.
  - Saved widget stays minimal in storage (no editor_config bloat).
- **Updated `test_profile_widgets_top8_above_myfeed.py`** — assertions now allow registry keys in addition to hardcoded types.
- **Test suite total: 61/61 pass** (13 phase35_chat + 6 phase35_extras + 25 phase34_providers + 9 profile_widgets_top8 + 8 registry_widget_hydration).

### How Orion / Stealth AI / any launched widget now works
1. Founder launches widget via `/admin/widgets` → `widget_registry` insert + cache stamp bump.
2. User opens the picker → `/api/widgets/available?placement=profile` returns the widget tile.
3. User selects it → frontend appends `{id: w-…, type: <registry_key>, size}` to local state.
4. User saves → PATCH `/api/profile/me` accepts the registry key (in dynamic allowlist), strips hydrated fields, persists only `{id, type, size}`.
5. Subsequent reads hydrate `editor_config` + `name` + `icon` from the registry on every response.
6. Profile.jsx / FounderProfile.jsx see `editor_config` on the saved widget, pass it through `CustomWidgetRenderer` → dispatched to `LAYOUT_RENDERERS[layout]` (ChatLayout / CardLayout / StatLayout / etc.).
7. Stale references (widget deleted/disabled) silently drop in the hydrator. Access-group-restricted widgets disappear for unauthorized viewers.

### Files touched
- `backend/services/widget_hydration.py` (new)
- `backend/routers/profile.py` (hydrate + dynamic allowlist + strip-on-save)
- `backend/routers/auth.py` (`/me` hydration)
- `backend/routers/admin_widgets.py` (cache invalidation on all mutations)
- `backend/core/seed.py` (strip migration uses dynamic allowlist)
- `backend/core/deps.py` (new `OptionalUser` dep)
- `backend/models/schemas.py` (`_filter_allowed_widgets` relaxed)
- `backend/tests/test_registry_widget_hydration.py` (new, 8 tests)
- `backend/tests/test_profile_widgets_top8_above_myfeed.py` (allowlist relaxed)
- `frontend/src/pages/Profile.jsx` (filter relaxed + picker carries editor_config + header label fallback)
- `frontend/src/pages/FounderProfile.jsx` (filter relaxed + header label fallback)
- `frontend/src/components/widgets/ChatLayout.jsx` (uses registry key for API calls)
- `backend/routers/widget_chat.py` (`_load_widget` accepts id OR key)

### Mobile polish (verified)
- Chat widget renders cleanly on 390 × 844 viewport (iPhone). Input + send button readable + tappable. Conversation bubbles wrap correctly.



## Phase 3.5 — Conversational AI Widgets (Feb 26, 2026, iters 53–54) ✅ COMPLETE

**Status:** 26/26 backend pytest pass + Playwright E2E builder pre-population verified. Zero critical/minor issues remaining. Zero OpenAI key leaks. SSE streaming working.

### What shipped
Founders can now create true ChatGPT-style conversational widgets through the Custom Widget Builder. Persistent per-user history. Founder-only gating. SSE streaming. Variable interpolation. All OpenAI traffic stays inside the backend pod — the browser never sees an API key.

### Backend
- `services/chat_conversations.py` (new):
  - `widget_conversations` Mongo collection, keyed `widget_id::user_id`, capped at 40 turns.
  - Variable interpolation: `{{user_message}}` `{{username}}` `{{display_name}}` `{{profile_id}}` `{{widget_id}}` `{{realm_id}}`.
  - `call_openai_chat()` — non-streaming Chat Completions wrapper.
  - `compose_messages()` — builds the OpenAI message array from system_prompt + history + new user turn (memory-mode aware).
- `routers/widget_chat.py` (new):
  - `POST /api/widgets/chat/message` — send a user turn, get AI reply (persisted iff memory ≠ off).
  - `GET  /api/widgets/chat/history` — load persisted history.
  - `POST /api/widgets/chat/clear` — wipe a conversation.
  - `POST /api/widgets/chat/regenerate` — re-run the last user turn.
  - `POST /api/widgets/chat/stream` — SSE streaming reply (Phase 3.5d).
  - All endpoints honor provider enabled flag + sliding-window rate limit (30 calls/min per user+widget) + founder-only access flag.
- `core/widget_layouts.py` — added `chat` layout + `chat_input` / `ai_response` field types.
- `core/widget_templates.py` — added `stealth_ai` (founder-only, streaming, memory=persistent) and `realm_assistant` (public, memory=persistent) templates.
- `routers/admin_widgets.py` — `_validate_editor_config` now calls a new `_validate_chat_config` that validates mode / system_prompt(≤8000) / model(≤64) / temperature(0..2) / max_tokens(1..4000) / memory_mode(off|session|persistent) / founder_only / enable_streaming / quick_actions(≤8, ≤120 chars each). Each invalid input emits 400 with a clear field-named message.
- `core/api_providers.py` already supports OpenAI chat completions (from Phase 3.4) — no changes needed.

### Frontend
- `components/widgets/ChatLayout.jsx` (new) — full chat UI:
  - User bubble (right) / AI bubble (left) with Markdown + code blocks + copy button.
  - Quick-action chips (configurable per widget).
  - Multiline input (Enter to send, Shift+Enter for newline).
  - Send / Clear / Regenerate buttons.
  - SSE streaming via POST + fetch + ReadableStream (token-by-token render).
  - Graceful fallback to non-streaming on stream errors.
  - Auto-scroll on new messages + typing indicator.
- `components/widgets/CustomWidgetRenderer.jsx` — `chat` layout wired into LAYOUT_RENDERERS; full widget object now passed to renderers so chat can read `id` + `editor_config.chat`.
- `components/widget-builder/WidgetBuilder.jsx` — new `Chat AI` section tab with System Prompt, Model, Temperature, Max Tokens, Memory mode, Founder Only toggle, Enable Streaming toggle, Quick Actions textarea. seedForm now defaults a `chat` block.
- `lib/widgetBuilder.js` — FIELD_TYPES list updated.

### Security (verified)
- `OPENAI_API_KEY` referenced ONLY in backend files: `/app/backend/.env`, `/app/backend/core/api_providers.py`, `/app/backend/services/chat_conversations.py`, `/app/backend/routers/widget_chat.py`, `/app/backend/tests/*.py`, `/app/memory/PRD.md`. Zero frontend references.
- All OpenAI traffic originates from the backend pod. Browser sees only `/api/widgets/chat/*`. No `Authorization: Bearer sk-…` ever leaves the backend.
- Founder-only gate enforced at request time: tfone POSTing to a stealth_ai widget returns 403.
- Rate limit (30/min per user+widget) returns 429 with `Retry-After` header.

### Templates
- **Stealth AI (Founder-Only)** — private @stealth assistant with persistent memory, streaming, and 3 starter quick actions.
- **Realm Assistant** — public friendly assistant for community realms.

### Tests
- `/app/backend/tests/test_phase35_chat.py` — 13 tests (auth gates, happy path, regenerate, clear, founder-only, variable interpolation, memory modes, streaming, security).
- `/app/backend/tests/test_phase35_chat_extras.py` — 6 tests (schema, templates, clone, rate-limit, provider-disable, streaming-disabled).
- `/app/backend/tests/test_phase35_chat_e2e.py` — 7 E2E tests against public URL.
- Combined: **26/26 pass.** Plus the 25 Phase 3.4 tests still pass → 51/51 across both phases.

### Files touched (Phase 3.5)
- `backend/services/chat_conversations.py` (new)
- `backend/routers/widget_chat.py` (new)
- `backend/routers/admin_widgets.py` (`_validate_chat_config` + chat passthrough fix)
- `backend/core/widget_layouts.py` (chat layout + field types)
- `backend/core/widget_templates.py` (stealth_ai + realm_assistant)
- `backend/server.py` (router include)
- `backend/tests/test_phase35_chat.py` (new, 13)
- `backend/tests/test_phase35_chat_extras.py` (new, 6)
- `backend/tests/test_phase35_chat_e2e.py` (new, 7)
- `frontend/src/components/widgets/ChatLayout.jsx` (new)
- `frontend/src/components/widgets/CustomWidgetRenderer.jsx` (chat hookup)
- `frontend/src/components/widget-builder/WidgetBuilder.jsx` (Chat AI section)
- `frontend/src/lib/widgetBuilder.js` (FIELD_TYPES)

### Known minor follow-ups (not blocking)
- The Stealth AI template uses `max_tokens=600`. Consider lowering to 200–300 to keep cost predictable on heavily-used widgets.
- ToggleChip uses `<button>` instead of `<input type=checkbox>` — Playwright `is_checked()` doesn't work on it. Adding `role="switch" aria-checked` would simplify future E2E assertions.



## Phase 3.4 — Provider Integrations + API Key Management (Feb 26, 2026, iter 52) ✅ COMPLETE

**Status:** Backend 25/25 pytest pass, frontend verified for founder + support admin on desktop & mobile, zero secret leaks, zero regressions.

### Goals
Build a single source-of-truth admin surface for every external API the Widget Builder can call. Keys live ONLY in `/app/backend/.env`. Founder (`@stealth`) can enable/disable providers without touching env vars. Any admin tier can re-test health and view analytics. Providers feed into the Widget Builder so only configured + enabled providers are selectable.

### Backend
- `services/provider_registry.py` (new):
  - `is_enabled` / `set_enabled` / `all_enabled_map` — operational enabled flag persisted in `provider_settings`.
  - `get_health(provider_key, force=False)` — sliding 5-min cache (`provider_health`) with per-provider `HEALTH_PROBES` mapping to cheap, low-cost endpoints (e.g. OpenAI `chat` with `max_tokens=1`).
  - `analytics_snapshot()` — per-provider calls/errors/avg latency from `provider_metrics`.
  - `full_provider_view()` — merges static catalog + configured + enabled + status for the admin page.
- `routers/api_widgets.py` — Phase 3.4 endpoints:
  - `GET /api/admin/providers` (admin) — full provider view.
  - `GET /api/admin/providers/status` (admin) — compact view.
  - `POST /api/admin/providers/toggle` (**@stealth-only**) — persists enabled flag + invalidates health cache. 404 for unknown id.
  - `POST /api/admin/providers/test` (admin) — forces fresh health probe.
  - `GET /api/admin/analytics/providers` (admin) — analytics snapshot.
  - `GET /api/admin/widgets/api-providers` now merges per-provider `enabled` so the builder can grey out admin-disabled providers.
  - `POST /api/widgets/api-call` and `POST /api/admin/widgets/test-api` refuse `provider_is_enabled = false` with 403 "disabled by admin".

### Frontend
- `pages/AdminProviders.jsx` (new) — `/admin/providers` route:
  - Grid of provider cards with status pill (healthy / untested / error / disabled / unconfigured / coming_soon).
  - Configured / Enabled / Available badges + capabilities chips.
  - "Test" button (any admin) — hits `/admin/providers/test`, inlines latency + error.
  - "Enable" / "Disable" toggle button — **founder-only**, hits `/admin/providers/toggle`.
  - Inline analytics row (calls / errors / avg latency).
  - Unconfigured providers show inline `Add OPENWEATHER_API_KEY to /app/backend/.env` hint.
- Route registered in `App.js`; entry added to `AdminHub.jsx`.
- Route gate now uses shared `lib/isAdmin.js` (fix iter 52) — was previously rejecting `@support` admins because the auth payload doesn't include `admin_role`.

### Security guarantees (verified)
- `OPENAI_API_KEY` / `NEWSAPI_KEY` / `OPENWEATHER_API_KEY` / `ALPHAVANTAGE_API_KEY` referenced in **backend-only** files: `/app/backend/.env`, `/app/backend/core/api_providers.py`, `/app/backend/tests/test_phase34_providers.py`. **Zero** frontend references confirmed by grep.
- All provider HTTP traffic originates from the backend pod; the browser sees only `/api/widgets/api-call` and `/api/admin/providers*`. No `Authorization: Bearer sk-…` headers ever leave the backend.
- Admin API responses include `auth_env_var` NAME (e.g. `"OPENAI_API_KEY"`) + `configured: bool` — never the value.
- `has_credential()` strips secrets before `public_provider_view()` is returned to the client.

### Verified end-to-end (iter 52)
- Backend pytest: 25/25 green (`/app/backend/tests/test_phase34_providers.py`).
- Frontend: 11 cards render for stealth (8 toggle buttons + 5 test buttons), 11 cards render for support (0 toggle buttons + 5 test buttons), normal users redirected away.
- Mobile + desktop layouts confirmed.
- Toggle off/on persists, status flips to `disabled` then back to `untested → healthy` after Test.
- Disabled providers refused by both `/api/widgets/api-call` and `/api/admin/widgets/test-api` with 403.

### Files touched (Phase 3.4)
- `backend/services/provider_registry.py` (new)
- `backend/routers/api_widgets.py` (provider endpoints)
- `backend/core/api_providers.py` (catalog + has_credential + public_provider_view)
- `backend/tests/test_phase34_providers.py` (new — 25 pytest cases)
- `frontend/src/pages/AdminProviders.jsx` (new)
- `frontend/src/pages/AdminHub.jsx` (link)
- `frontend/src/App.js` (route)
- `frontend/src/components/widget-builder/ApiSourceTab.jsx` (greys out disabled/unconfigured tiles)

### Known limitations / future polish
- `ApiSourceTab` shows disabled/unconfigured tiles in greyed/non-selectable state (with "Add Key" / "Off" / "Soon" pills) instead of hiding them. This is intentional — founders see at a glance what providers exist and what they need to do. Hiding tiles entirely is a one-line change if preferred.
- `nasa` reports `configured: true` via DEMO_KEY fallback even when no `NASA_API_KEY` env var is set. Documented behavior.
- OpenAI key in `.env` is a real production key — health probes use `max_tokens=1` to keep cost negligible.



## Phase 3.3 — Native OurRealm Sounds Library Picker (Feb 25, 2026, iter 51) ✅ COMPLETE

**Status:** Backend 8/8 pytest pass, frontend zero issues, zero regressions, zero action items.

### Goals
Sound/Audio fields in custom widgets accept native OurRealm sound IDs in addition to legacy raw URLs. Saved sound IDs hydrate at render time so renames / cover updates / private-flag changes propagate automatically.

### Backend
- `routers/sounds.py` — new `GET /api/sounds/resolve?ids=a,b,c`:
  - Optional auth (lazy `get_current_user` import — public tracks visible to anonymous viewers; private tracks only to owner / authorized viewer via existing `_can_view_track` gate).
  - Caps at 50 IDs per call.
  - Preserves caller-supplied ID order so the renderer's array indices line up.
  - Silently drops missing/unauthorized IDs (renderer shows "Sound unavailable" fallback).

### Frontend
- `components/SoundsLibraryPicker.jsx` (new) — full-screen modal driven by `GET /api/sounds/me/tracks`:
  - Per-row: cover thumbnail, title, category/genre/mood, inline play-preview button, Add/Pick toggle.
  - Single + multi modes. Multi-mode shows live counter ("Use 3 sounds").
  - Empty-state with deep-link to `/sounds`.
  - Module-level audio singleton — only one preview plays at a time.
- `components/widget-builder/WidgetBuilder.jsx` `MediaListInput`:
  - Adds "Select from Sounds Library" button when `field.type === "sound"`.
  - Multi-mode merges new IDs with any existing legacy URLs (keeps both).
  - Renders a "NATIVE ID" green badge next to UUID-shaped rows.
  - Help text clarifies legacy URLs still work.
- `components/widgets/CustomWidgetRenderer.jsx`:
  - Detects sound-type fields via `editor_config.fields`; collects all UUID-shaped values across them.
  - One bulk `/api/sounds/resolve` call hydrates them; renders `NativeSoundList` inline below the main layout.
  - Each row: `NativeSoundRow` for resolved (cover, title, category, play/pause button, hidden `<audio>`) / `LegacyUrlRow` for plain URLs / missing-state row with AlertTriangle icon for null tracks.

### Verified end-to-end
- Picker opens with 3 stealth tracks, multi-select counter increments, confirm writes IDs.
- Live preview pane shows `FORYOU_PROBE_UPLOAD / Music` native player with cover + play button.
- NATIVE ID badge confirms UUID detection works.
- Anonymous /api/sounds/resolve returns public tracks only (gated).
- Bogus / nonexistent IDs return `{tracks:[]}` cleanly (no 500).
- Legacy URLs still render via LegacyUrlRow path.

### Files touched (Phase 3.3)
- `backend/routers/sounds.py` — `/api/sounds/resolve` endpoint
- `frontend/src/components/SoundsLibraryPicker.jsx` (new)
- `frontend/src/components/widget-builder/WidgetBuilder.jsx` — MediaListInput
- `frontend/src/components/widgets/CustomWidgetRenderer.jsx` — NativeSoundList + NativeSoundRow + LegacyUrlRow

### Known limitations
- Picker pulls `/api/sounds/me/tracks` (the founder's uploads). If we later want to allow pinning OTHER users' public sounds, a `/api/sounds/search` integration would slot in here.
- Native sound player is a minimal inline component; could be replaced with the full `SoundPlayerCard` for a richer experience in larger layouts.

---


## Phase 3.2 — Value Formatters + Sliding-Window Rate Limit (Feb 25, 2026, iter 50) ✅ COMPLETE

**Status:** 16/21 backend tests pass on a single run; remaining 5 skipped due to CoinGecko upstream rate limit (spec explicitly allows this — not code defects). Direct-module formatter math 8/8, sliding-window unit test pass, headers + 429 shape verified, frontend zero issues, zero regressions. One optional 2-line hardening applied (`isinstance` guard on `editor_config.layout`).

### Part 1 — Value Formatters

**Backend**
- `utils/value_formatters.py` — pure functions for currency / percent / number / compact / date / relative_time / uppercase / lowercase / titlecase. Each formatter accepts decimals, prefix/suffix, symbol, positive/negative_color, date pattern. Returns `{raw, formatted, color}` dict; renderer can fall back to raw when formatter doesn't apply.
- `services/api_widget_proxy.py` `call_api()` extended with `formatters` arg; `_format_arrays()` applies per-item formatters declared on each array_binding. Output includes `mapped_formatted` + `mapped_arrays_formatted` alongside the raw `mapped`/`mapped_arrays`.
- `routers/admin_widgets.py` validates `data_source.formatters` + `array_bindings[*].item_formatters` as dicts.
- `core/widget_templates.py` — `live_crypto` now ships with currency + percent formatters (with red/green colors). `live_crypto_markets` ships with `item_formatters` (currency on value, uppercase on body).

**Frontend**
- `lib/valueFormatters.js` — mirror of the backend catalog + client-side `applyFormatter()` so the picker can show inline previews without an extra round trip.
- `components/widget-builder/FormatterPicker.jsx` — collapsible inline picker (chevron toggle, green badge when active, inline preview e.g. "Currency · → $62,876.00"). Reveals only the settings relevant to the chosen format type.
- `components/widget-builder/ApiSourceTab.jsx` — FormatterPicker wired into single-value field bindings AND per-item array bindings (renders beneath each mapped item key).
- `components/widgets/CustomWidgetRenderer.jsx` — prefers `mapped_formatted.{field}.formatted` over raw `mapped.{field}`; applies color hints via `data._colors` (StatLayout.value/delta) and per-item `it._colors.value` (ListLayout). 429 detail parsing handles the new structured shape.

### Part 2 — Sliding-Window Rate Limit

**Backend**
- `utils/sliding_window_rate_limit.py` — in-memory deque per key with per-key `asyncio.Lock`, lazy eviction on every check, periodic GC of empty buckets (60s interval). Public API `rate_limit(key, max_requests, window_seconds)` returns `{allowed, limit, remaining, reset_in, retry_after}`. Denied events persist into `db.rate_limit_events` (TTL 24h) for the analytics view.
- `services/api_widget_proxy.py` `_check_rate()` — replaced the fixed-minute Mongo bucket with sliding-window for the per-provider AND per-widget burst caps; kept the hourly provider quota on the existing Mongo bucket (long-window, fixed-bucket is fine there). Returns header metadata so routes can attach X-RateLimit-* headers.
- `routers/api_widgets.py` — both test-api and api-call now inject `Response` and call `_set_rate_headers()` to attach `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. 429 raises with a structured `{error, scope, retry_after, message}` body + `Retry-After` header.
- New `GET /api/admin/analytics/rate-limits?hours=24` — aggregates the last N hours of denials into `top_keys`, `top_users`, `top_ips`, `top_endpoints`. Admin-tier only.

### Verified end-to-end
- Currency, percent (with negative-color), compact, date, relative_time, casing formatters all produce expected strings.
- Sliding window correctly denies 4th request after 3 in 2s window; recovers smoothly after window elapses (no fresh-bucket exploit).
- `X-RateLimit-Limit: 60`, `Remaining` decreases on subsequent calls.
- Builder live preview shows formatted `BITCOIN $62,841.00 / -0.77%` (red) end-to-end from CoinGecko → proxy → mapped_formatted → renderer.

### Files touched (Phase 3.2)
- `backend/utils/value_formatters.py` (new)
- `backend/utils/sliding_window_rate_limit.py` (new)
- `backend/services/api_widget_proxy.py` — sliding-window, formatters, mapped_formatted/mapped_arrays_formatted
- `backend/routers/api_widgets.py` — payloads + headers + analytics endpoint
- `backend/routers/admin_widgets.py` — validators extended; layout isinstance hardening
- `backend/core/widget_templates.py` — `live_crypto` + `live_crypto_markets` ship with formatters
- `backend/server.py` — startup ensure_indexes wires
- `frontend/src/lib/valueFormatters.js` (new)
- `frontend/src/components/widget-builder/FormatterPicker.jsx` (new)
- `frontend/src/components/widget-builder/ApiSourceTab.jsx` — FormatterPicker wired into both binding types
- `frontend/src/components/widgets/CustomWidgetRenderer.jsx` — formatted-value preference, colors, structured 429 parsing

### Known limitations / backlog
- Admin Analytics UI page (frontend view of `/admin/analytics/rate-limits`) NOT YET BUILT — the endpoint is live and tested but the page surface is deferred to Phase 3.3 / on-demand.
- Single-pod deployment only (in-memory deque). Horizontal-scale → swap `_BUCKETS` for Redis ZSET or Mongo TTL collection without changing the public API.

---


## Phase 3.1 — List / Array Bindings for API Widgets (Feb 25, 2026, iter 49) ✅ COMPLETE

**Status:** Backend 13/13 tests pass. Frontend smoke-verified. Zero critical/minor functional issues; only optional REST-hygiene suggestion (return 201 instead of 200 on create).

### Goals
API widgets can now map JSON arrays (NewsAPI articles, Reddit posts, CoinGecko markets) onto repeated-item widget fields (List, Grid, Media Grid, Card collections). Single-value mappings still work; empty/loading/error states handled gracefully.

### Backend
- `services/api_widget_proxy.py`:
  - New `_apply_array_bindings(data, bindings)` — resolves each binding's `array_path` against the response, slices to `max_items`, applies per-item `item_map`, and emits an array of objects shaped for rich_item rendering. Special scalar mode (`item_map={"_":"<path>"}`) for media_grid (emits array of URL strings).
  - `call_api()` extended signature: `array_bindings: List[Dict]` parameter. Returns `mapped_arrays` alongside existing `mapped`.
- `routers/api_widgets.py` — `ApiTestPayload` + `ApiCallPayload` now accept `array_bindings`. Both endpoints forward it to `call_api()`. Widget-id path also reads `array_bindings` from `editor_config.data_source.array_bindings`.
- `routers/admin_widgets.py` `_validate_editor_config()` — validates `data_source.array_bindings` as a list of `{field_key, array_path, item_map, max_items, empty_text}` dicts.
- `core/api_providers.py` — `_ep()` accepts `array_hints`. Declared for NewsAPI (`articles`), Reddit (`data.children`), CoinGecko markets (root array). Reddit provider now sends a desktop-Chrome `user_agent` to dodge Cloudflare bot detection (works in some egress IPs; soft-fails in others — expected behaviour).
- `core/widget_templates.py` — `live_reddit_top` upgraded to use array_bindings; **2 new templates**: `live_news_headlines` (NewsAPI articles → list), `live_crypto_markets` (CoinGecko top-10 markets → list).

### Frontend
- `components/widget-builder/ApiSourceTab.jsx`:
  - New `ArrayBindingsPanel` + `ArrayBindingRow` subcomponents below the existing single-value bindings.
  - **Quick presets** (green chips from `endpoint.array_hints`) populate a binding with one click.
  - Per-row UI: target field selector (filtered to rich_item/option_list/image-multi/video/sound), array path input, max items, empty state text, item field mapping table (key → relative path), and a live **preview of the first 3 resolved items** rendered as JSON.
  - Client-side `resolvePath()` mirrors backend `get_path()` so preview is instant (no extra proxy call per keystroke).
- `components/widgets/CustomWidgetRenderer.jsx`:
  - Merges `mapped` (single values) and `mapped_arrays` (repeated items) into the layout's `data` dict.
  - Bubbles `array_bindings[*].empty_text` into `data._empty_text` so layouts show the configured empty fallback instead of generic "No items yet."
  - `MediaGridLayout` now accepts either `string[]` or `{image:url}[]` shape — backward compatible AND array-binding compatible.

### Verified end-to-end
- CoinGecko `markets` → 10 items returned with label/body/value/image populated, cached on 2nd call.
- Empty `array_path` resolution returns `[]` cleanly (no crash); renderer shows `empty_text`.
- Scalar mode (`item_map.{_:'image'}`) emits array of URL strings for media_grid.
- @stealth gate still enforced on test-api/direct-call; widget-id path open to authenticated users.
- Phase 2A custom widget create + clone + version-rollback unaffected (regression clean).

### Files touched (Phase 3.1)
- `backend/services/api_widget_proxy.py` — `_apply_array_bindings`, scalar mode, response shape extended
- `backend/routers/api_widgets.py` — payloads + threading
- `backend/routers/admin_widgets.py` — validation extended
- `backend/core/api_providers.py` — `array_hints`, Reddit UA, new CoinGecko `markets` endpoint
- `backend/core/widget_templates.py` — `live_reddit_top` upgraded; `live_news_headlines` + `live_crypto_markets` added
- `frontend/src/components/widget-builder/ApiSourceTab.jsx` — ArrayBindingsPanel + ArrayBindingRow + resolvePath
- `frontend/src/components/widgets/CustomWidgetRenderer.jsx` — mapped_arrays merge + empty_text bubble + MediaGridLayout dual-shape support

### Known limitations / backlog
- Reddit upstream blocked by Cloudflare from many shared egress IPs (returns 502/403). Code path is correct; this is an external concern.
- POST endpoints return 200 instead of 201 on create (optional/cosmetic).
- Per-minute provider burst (60/min) easily hit when blasting tests back-to-back; fixed-minute window deferred as P3.

---


## Phase 3 — API Widget Sources (Feb 25, 2026, iter 48) ✅ COMPLETE

**Status:** Backend 19/19 tests pass. Frontend smoke-verified. Two MINOR/optional improvements suggested by testing agent — one (upstream 429 passthrough) applied; the other (sliding-window rate limit) deferred as P3.

### Goals
Founder (@stealth)-only authoring of widgets backed by live third-party APIs. All credentials backend-only; never exposed to frontend. Two-tier cache + provider/widget rate limits.

### Backend
- `core/api_providers.py` — pluggable provider registry. 11 providers:
  - **Ready (no key):** CoinGecko, GitHub (public), Reddit (public), NASA (DEMO_KEY)
  - **Need env key:** OpenWeather (`OPENWEATHER_API_KEY`), NewsAPI (`NEWSAPI_KEY`), Alpha Vantage (`ALPHA_VANTAGE_KEY`), OpenAI (`OPENAI_API_KEY`)
  - **Coming Soon (OAuth):** Spotify, YouTube, Google Maps
  - Each provider declares: auth_kind, endpoints, default refresh/cache, hourly quota, sample paths
  - `public_provider_view()` strips `auth_env_var` before returning to frontend
- `services/api_widget_proxy.py` — credentials injection + L1 (in-memory) + L2 (Mongo `api_cache`) two-tier cache, provider hourly quota + provider per-minute burst (60/min) + per-widget burst (30/min) via Mongo `api_quota` collection (TTL'd). Forwards upstream 429/503/504 verbatim; collapses other 4xx/5xx to 502 to avoid leaking provider errors.
- `routers/api_widgets.py` — three endpoints:
  - `GET /api/admin/widgets/api-providers` (any admin) — list providers + endpoint specs
  - `POST /api/admin/widgets/test-api` (@stealth only) — ad-hoc test with response_map application
  - `POST /api/widgets/api-call` (authed) — proxy for live widgets. Two modes: widget_id → hydrate from registry (trusted) OR direct provider/endpoint (@stealth only)
- `routers/admin_widgets.py` `_validate_editor_config()` — extended to accept `data_source.kind='api'` with provider/endpoint validation, params dict, response_map dict
- `core/widget_templates.py` — added 5 API templates: `live_weather`, `live_crypto`, `live_nasa_apod`, `live_github_repo`, `live_reddit_top` (ship as draft)
- `server.py` — wires router + `ensure_indexes()` for TTL'd cache/quota collections

### Frontend
- `components/widget-builder/ApiSourceTab.jsx` — new "API Source" tab in the WidgetBuilder. Provider tiles (ready/add-key/coming-soon badges), endpoint pills, typed param inputs, Test API button, raw JSON viewer, quick-bind chips, field bindings, refresh/cache duration controls
- `components/widget-builder/WidgetBuilder.jsx` — added `api` section between `data` and `placement`
- `components/widgets/CustomWidgetRenderer.jsx` — when `editor_config.data_source.kind='api'`, polls `/api/widgets/api-call` on mount + at refresh interval; overlays mapped fields on top of static fallbacks; surfaces a small "API" error badge on failure

### Security guarantees verified by tests
- API keys ONLY in `.env` — frontend payload contains zero credentials (`auth_env_var` stripped)
- `@stealth`-only for `test-api`, direct provider call, and from-template/clone/rollback (already)
- Authenticated users with `widget_id` can render launched widgets; draft widgets return 404 to non-admins
- Anonymous → 401 on all proxy endpoints
- Coming-soon providers → 400 (no upstream call attempted)
- Missing credential → 503 (provider config error, not 500)
- Provider per-minute burst 429 confirmed firing in load test

### Files touched (Phase 3)
- `backend/core/api_providers.py` (new)
- `backend/services/api_widget_proxy.py` (new)
- `backend/routers/api_widgets.py` (new)
- `backend/routers/admin_widgets.py` — `_validate_editor_config` upgraded
- `backend/core/widget_templates.py` — `_ec()` accepts data_source; 5 new templates appended
- `backend/server.py` — router include + ensure_indexes
- `frontend/src/components/widget-builder/ApiSourceTab.jsx` (new)
- `frontend/src/components/widget-builder/WidgetBuilder.jsx` — API tab wiring
- `frontend/src/components/widgets/CustomWidgetRenderer.jsx` — live polling

### Known limitations / backlog
- Rate-limit window is fixed-minute (strftime bucket). At the :59→:00 boundary up to 2× cap can squeak through. Sliding-window upgrade deferred (testing agent flagged as optional).
- `live_reddit_top` template's response_map is empty — list-of-objects → rich_item list transforms land in Phase 3.1.
- OAuth providers (Spotify, YouTube, Google Maps) ship as Coming Soon tiles only — refuse upstream calls server-side.

---


## Phase-1 Widgets & Badges Admin Panel — /admin/widgets (Feb 24, 2026, iter 44)

**Status: ✅ COMPLETE** — Backend 24/24 phase-1 pytest pass; frontend live-verified including the picker disable + admin banner fix.

### Backend — `db.widget_registry` + `db.badge_registry` + `db.user_badges`
- Single new router `/app/backend/routers/admin_widgets.py` with:
  - **Widgets**: GET (filters: status/placement/access_group/q), POST (uniqueness on `key`), PATCH, DELETE (system widgets refuse 400), POST /launch, POST /disable.
  - **Badges**: same CRUD shape + POST /assign, POST /remove, GET /:id/recipients, DELETE cascades to user_badges.
  - **Public**: GET /api/widgets/available?placement= (status=live ∧ placement match ∧ access_group ∩ viewer's groups), GET /api/widgets/disabled (admin-only — keys + status), GET /api/profile/{username}/badges (status=live only).
- Admin gate via `_require_admin` calling existing `is_admin_user`. Stealth + role='admin'/'founder' + `is_admin=True` all qualify.
- **System seed**: 16 canonical widgets (myfeed, top8, live, videos, music, podcasts, photos, events, weather, calendar, countdown, notes, polls, survey, blog, radar) seeded on first boot with `is_system=true` + status=live. Idempotent — admin edits stick.
- **Unique indexes**: `widget_registry.key`, `badge_registry.key`, `(user_badges.user_id, user_badges.badge_key)` so dup assignments are impossible at the DB layer.

### Frontend — `/admin/widgets` (`pages/AdminWidgets.jsx`)
- Two-tab admin console (Widgets | Badges) in the neon admin style.
- **Widgets tab**: row list with status pill + left accent stripe (live=green / draft=yellow / disabled=red), search + status/placement/access filters, full editor modal (name, key, category, icon dropdown, default size, sort order, placement checkboxes, access group checkboxes, allowed sizes checkboxes, status buttons), launch/disable/edit/delete actions. System widgets show a "System" pill and have no delete button + locked key field.
- **Badges tab**: same shape, plus the **Assigner** modal (comma/space separated usernames, recipients list with remove buttons, assigned-at timestamps).
- **Non-admin gate**: anyone hitting /admin/widgets without admin role is redirected to / via `useEffect`.

### Picker enforcement (Profile.jsx `AddWidgetPicker`)
- Fetches `/api/widgets/available?placement=profile` on open; falls back to the local 16-tile `WIDGET_TYPES` only if the call genuinely fails (AbortController instead of the previous fragile `cancelled` flag — fixed a state-race that was leaving disabled tiles visible).
- Admins also fetch `/api/widgets/disabled` in a SEPARATE useEffect (re-runs once `viewer` hydrates), then render a banner: "N widget(s) currently disabled by an admin and hidden from this picker. Manage at /admin/widgets."
- **Disabled widgets** are hard-hidden from non-admins; admins see the banner. Saved widget bodies on profiles are unaffected by status changes (this is intentional — Phase 1 hides them only from the LIBRARY; later phases can hide rendered instances too).

### Profile badge rendering
- New `components/ProfileBadges.jsx` pulls `/api/profile/{username}/badges` and renders a pill list next to the username on both `/profile` (owner) and `/profile/:username` (public/founder). Empty users render nothing — zero layout shift.

### AdminHub card
- `pages/AdminHub.jsx` includes a new "Widgets & Badges Manager" card with the `LayoutGrid` icon, purple accent, founder/admin role gate. Links to /admin/widgets.

### Files touched
- `backend/routers/admin_widgets.py` (new) — full registry + assignment + public read.
- `backend/server.py` — included the router + ensure_indexes() + seed_system_widgets() on startup.
- `backend/tests/test_admin_widgets_badges_phase1.py` (new) — 24 regression tests.
- `frontend/src/pages/AdminWidgets.jsx` (new) — complete admin UI.
- `frontend/src/pages/AdminHub.jsx` — Widgets & Badges card.
- `frontend/src/App.js` — `/admin/widgets` route.
- `frontend/src/components/ProfileBadges.jsx` (new) — profile badge pills.
- `frontend/src/pages/Profile.jsx` — split picker effects (race fix) + import apiClient + ProfileBadges injection.
- `frontend/src/pages/FounderProfile.jsx` — ProfileBadges injection.


## Phase-16 Media Widgets Fix + Photos Widget (Feb 24, 2026, iter 43)

**Status: ✅ COMPLETE** — Backend 19/19 pytest (13 phase-15 updated + 6 phase-16 new) + frontend live-verified.

### Allow-list grows from 15 → 16: Photos added
- `core/widget_types.py`: `ALLOWED_WIDGET_TYPES` includes `photos`; `PHOTOS_MAX=12` cap.
- `routers/profile.py`: photos validation block enforces max 12 with HTTP 400 'Photos widget supports max 12 photos'; slices to 12 on overflow.
- Frontend mirror: `WIDGET_TYPES` is now 16 entries (added `photos` with Image icon).

### Videos playback fixed
- Previous render placed a non-clickable `PlayCircle` icon over a poster-less `<video preload="metadata">` — playback was unreachable.
- New `VideoTile` sub-component: while inactive renders thumbnail (poster for pinned posts, first-frame muted preload for uploads) + clickable PlayCircle overlay. On tap React state flips to `<video controls autoPlay playsInline>` so the browser owns playback.
- Verified end-to-end with a real upload URL: `/api/media/videos/{id}.mp4` resolves to a 307 → presigned R2 URL which the browser plays cleanly.

### New Photos widget
- `PhotosBody` + `PinPhotoPicker` in `components/ProfileWidgetBodies.jsx`.
- Owner can upload (POST `/api/images/upload`), pin existing image posts (GET `/api/posts?username&media_type=image`), remove, and move-left to reorder.
- Items stored as `{kind:'upload', url, thumbnail_url}` or `{kind:'post', post_id, url}`. Grid cols scale with widget size (small=2, otherwise=3).
- Max 12, friendly empty state, lazy-loaded thumbnails.

### Friendly empty states everywhere
- Videos / Photos: `No videos yet` / `No photos yet` on public view + owner non-edit view.
- Music / Podcasts: empty state in the widget AND in the picker explains "Upload one from the Sounds page (set category to {Music|Podcasts}) and it'll appear here."

### Files touched
- `backend/core/widget_types.py` — `photos` + `PHOTOS_MAX=12`.
- `backend/routers/profile.py` — photos validation.
- `backend/tests/test_photos_widget_phase16.py` (new) — 6 regression tests.
- `backend/tests/test_widget_allowlist_phase15.py` — ALLOWED set + strip test updated to include `photos`.
- `frontend/src/components/ProfileWidgetBodies.jsx` — `VideoTile` sub-component, `PhotosBody`, `PinPhotoPicker`, empty states for Videos/Photos/Music/Podcasts.
- `frontend/src/data/mockData.js` — `WIDGET_TYPES` 16th entry: photos.
- `frontend/src/pages/Profile.jsx` + `pages/FounderProfile.jsx` — `case 'photos'` in both WidgetBody switches.


## Phase-15 Widget Lockdown + Editable Notes/Blog/Polls/Music/Podcasts/Videos (Feb 24, 2026, iter 41–42)

**Status: ✅ COMPLETE** — Backend 22/22 pytest pass (13 phase-15 + 9 prior); frontend 100% live-verified.

### Widget allow-list — 15 types only
- `core/widget_types.py` is the single source of truth: `myfeed, top8, live, videos, music, podcasts, events, weather, calendar, countdown, notes, polls, survey, blog, radar`.
- Backend `PATCH /api/profile/me` filters disallowed types silently and validates per-type caps.
- Backend `serialize_user()` runs `_filter_allowed_widgets()` on every read.
- Frontend `WIDGET_TYPES = [...15...]` mirror in `data/mockData.js`; `ALLOWED_WIDGET_TYPES` Set used to defensively filter render lists in both Profile and FounderProfile.
- Boot migration `migrate_strip_deprecated_widgets()` removes legacy types from every user (including stealth — merch/custom no longer pass).

### Per-widget caps + char limits
- Videos `items`: max 4 (combined uploaded + pinned).
- Music / Podcasts `sound_ids`: max 10 each.
- Notes `text`: 300 chars standard / 500 VIP / unlimited stealth.
- Blog `text`: 100 chars standard / 2000 VIP / unlimited stealth.
- Backend raises HTTP 400 on overflow; frontend textareas use `maxLength` for the dual-layer enforcement.

### Multi-select Widget Library
- Single Save button adds all selected widgets at once. Modal resets selection on every open. Both Cancel and backdrop click close without mutating state.
- `data-testid='open-widget-picker'` (header button) + `data-testid='profile-add-widget-tile'` (grid +Add tile) both open the modal. Selected tiles get `data-selected='true'` + check icon.

### Notes / Blog — editable + persistent + char-counted
- Shared `NotesBody` + `BlogBody` in `components/ProfileWidgetBodies.jsx`. Owner-edit mode renders textarea with live "N chars left" counter; public view renders read-only italic/plain block. Falls back to default text when blank.
- Same renderer used on `/profile` (owner) and `/profile/:username` (public/founder) — saved content shows identically.

### Polls — inline config + visitor voting
- Owner sets question + options inline (max 6 options, 200 char question, 100 char per option).
- Visitor votes via `POST /api/profile-poll/{owner}/{widget_id}/vote` (auth required). Unique `(widget_id, user_id)` index enforces 1 vote per visitor; re-voting is upsert (idempotent).
- Public read at `GET /api/profile-poll/{owner}/{widget_id}` returns tally + state without auth.
- Verified end-to-end: tftwo creates "Best pizza topping?" with 2 options → tfone votes → results render with percentage bars; re-vote leaves count at 1.

### Videos — upload + pin existing
- `VideosBody` renders a 4-cell grid. Owner sees Upload tile (POST `/api/videos/upload`) AND Pin tile (modal lists user's existing video posts via `GET /api/posts?username&media_type=video`).
- `items[]` entries are `{kind:'upload', url, video_id}` or `{kind:'post', post_id, url, thumbnail}`. Deletion in edit mode just splices the array; existing video record / post is untouched.

### Music / Podcasts — sound library reference (no duplicate storage)
- `SoundsBody` (used by both `MusicBody` and `PodcastsBody`) calls `GET /api/sounds/by-user/{username}?category=Music|Podcasts`. Owner-edit shows a picker modal; selected sound IDs are stored on the widget as `sound_ids[]`. Visible row count scales with widget size (small=3, medium=5, large=10).
- No duplicate audio storage — IDs reference the existing `tracks` collection.

### Self-healing + idempotency
- `seed_founder()` re-appends any missing `FOUNDER_WIDGETS` types on every boot (now: live, music, events, polls, blog).
- `migrate_reorder_top8_above_myfeed()` + `migrate_strip_deprecated_widgets()` are both idempotent — log lines stay at 0 affected on subsequent boots.

### Files touched
- `backend/core/widget_types.py` (new) — allow-list + caps + per-role limit helpers.
- `backend/core/config.py` — FOUNDER_WIDGETS trimmed to allow-list types.
- `backend/core/seed.py` — `migrate_strip_deprecated_widgets()` + ordering.
- `backend/models/schemas.py` — `_filter_allowed_widgets()` applied to serializer.
- `backend/routers/profile.py` — widgets validation pipeline.
- `backend/routers/profile_polls.py` (new) — public GET + auth vote with unique-vote index.
- `backend/routers/sounds.py` — `GET /api/sounds/by-user/{username}` public endpoint.
- `backend/server.py` — wired `profile_polls` router + `ensure_indexes()`.
- `frontend/src/data/mockData.js` — `WIDGET_TYPES` trimmed to 15 + `ALLOWED_WIDGET_TYPES` Set.
- `frontend/src/components/ProfileWidgetBodies.jsx` (new) — shared bodies for Notes, Blog, Videos, Music, Podcasts, Polls, Radar.
- `frontend/src/pages/Profile.jsx` — slim WidgetBody (15 cases), multi-select AddWidgetPicker, addWidgets() with size default, w.size guard.
- `frontend/src/pages/FounderProfile.jsx` — slim WidgetBody parity, ALLOWED_WIDGET_TYPES render filter, w.size guard.
- `backend/tests/test_widget_allowlist_phase15.py` (new) — 13 regression tests.


## Profile Widget Order + Editable Notes + Public Animated Widgets (Feb 24, 2026, iter 40)

**Status: ✅ COMPLETE** — Backend 9/9 pytest pass; frontend owner-edit + public-view verified live.

### New default widget order
- Signup default already was `[Top 8, My Feed]` — unchanged. The previous boot migration that injected Top 8 placed it AFTER My Feed; new boot migration `migrate_reorder_top8_above_myfeed()` (in `core/seed.py`) swaps the two for any user where `profile_widgets_customized != True` AND username ≠ stealth. Preserves sizes, preserves every other widget's relative order.

### `profile_widgets_customized` flag
- New field on `users` collection. Auto-flipped to `True` by `update_profile` whenever the `widgets` array is included in the payload **except** when the caller is @stealth (founder layout is sacred).
- Schema serializer exposes the flag in `/api/auth/me` and `/api/profile/by-username`.

### @stealth self-healing
- `seed_founder()` now compares stealth's widgets against `FOUNDER_WIDGETS` on every boot. Any missing type from {live, merch, music, events, polls, custom} is re-appended without altering existing entries or order. Idempotent — no churn when everything is present.

### Notes widget — editable + persistent
- `pages/Profile.jsx`: new `NotesBody` component renders an inline `<textarea data-testid="notes-edit-{id}">` in owner-edit mode and a read-only `<div data-testid="notes-body-{id}">` everywhere else. Falls back to the shipping-log quote when text is blank.
- `pages/FounderProfile.jsx`: added `notes` and `radar` cases to the public WidgetBody switch — these were missing and were the root cause of "animated widgets only show after edit+save" (public view literally rendered nothing for those types).
- `updateWidget(id, patch)` threads through `SortableWidget` → `WidgetBody` → `NotesBody`. Editing text updates state in place; clicking Save persists the entire widgets array via `PATCH /api/profile/me`.

### Migration idempotency loop — root cause + fix
- Earlier seed had `seed_support_account()` resetting `widgets:[]` to empty on every boot. `migrate_inject_myfeed_widget` + `migrate_inject_top8_widget` then filled them back in `[myfeed, top8]` and my reorder migration swapped them. Result: 1 row touched per restart.
- Fix: seed @support directly with `[top8, myfeed]` and `profile_widgets_customized=True`. Migration now converges to 0 reorders on every subsequent boot.

### Files touched
- `backend/core/config.py` — `default_notes_widget()`, `DEFAULT_NOTES_TEXT`, `NOTES_WIDGET_TYPE`.
- `backend/core/seed.py` — `migrate_reorder_top8_above_myfeed`, seed_founder self-heal, seed_support_account widgets default.
- `backend/models/schemas.py` — `ProfileUpdate.profile_widgets_customized` + serializer.
- `backend/routers/profile.py` — auto-flip on widgets PATCH (skip stealth).
- `backend/tests/test_profile_widgets_top8_above_myfeed.py` — 9 regression tests.
- `frontend/src/pages/Profile.jsx` — `NotesBody`, threading editing+onUpdate, `updateWidget`.
- `frontend/src/pages/FounderProfile.jsx` — `radar` + `notes` cases in public WidgetBody.


## Notifications Cleanup + Calls Tab Restoration (Feb 24, 2026, iter 38)

**Status: ✅ COMPLETE** — Backend 3/3 pytest pass; frontend live-verified on mobile + desktop.

### Marketplace & Wallet notifications removed from UI surface
- **Hidden kinds** (`backend/routers/notifications.py _HIDDEN_KINDS`): `marketplace`, `marketplace_ad`, `marketplace_listing`, `ads`, `ad`, `ad_payout`, `promoted`, `promotion`, `wallet`, `tip`, `tipped`, `payment`, `purchase`, `sale`, `transaction`, `balance`, `transfer`, `deposit`, `withdrawal`.
- **Backend filter** applied to `/api/notifications/unread-count`, `/list`, AND `/mark-seen` via shared `_KIND_NOT_HIDDEN` Mongo fragment. Also baked into `emit_notification()` so future producers can't even insert these kinds.
- **DB rows preserved** — never deleted, only filtered (verified by pytest: raw Mongo count of unseen hidden rows stays the same after mark-seen).
- **Frontend `data/mockData.js`** stripped of Marketplace + Wallet entries and categories.
- **`pages/Notifications.jsx`** drops `Megaphone`/`WalletIcon` imports and the `ad_payout`/`tip` ICONS entries; adds a defensive client-side `HIDDEN_KINDS` Set so even stale caches stay clean.

### Calls tab restored
- `/messages` TABS order is now `Chats → Groups → Realms → Calls` exactly.
- `CallsTab` is a pure render — no fetch, no useEffect, no `/api/calls/*` traffic. Copy: **"Calls Coming Soon — Voice and video calling will be available in a future update."**
- `?tab=` query whitelist updated to `["chats","groups","realms","calls"]`.

### Notifications page mobile header layout fixed
- Header uses `flex flex-wrap items-start justify-between gap-3`; title block has `min-w-0`; Mark-All-Read button has `shrink-0 self-start sm:self-auto`.
- Verified at 360×640, 375×812, 768×1024: title fully visible, button wraps below on phones, inline on tablet+, zero overlap.

### Files touched
- `backend/routers/notifications.py` — _HIDDEN_KINDS, _KIND_NOT_HIDDEN, applied to all 3 endpoints + emit_notification.
- `backend/tests/test_notifications_hidden_kinds.py` — 3 regression tests (seed → assert filter → cleanup).
- `frontend/src/pages/Notifications.jsx` — icon cleanup, HIDDEN_KINDS Set, responsive header.
- `frontend/src/pages/Messages.jsx` — TABS restored to 4 entries; CallsTab placeholder copy.
- `frontend/src/data/mockData.js` — Marketplace + Wallet seed/category entries removed.


## P3 + P4 — Conversation Pin/Delete & Realm Message Edit/Delete (Feb 24, 2026, iter 37)

**Status: ✅ COMPLETE** — Backend 7/7 pytest pass; frontend live-verified for P3 Chats tab.

### P3: Messages list — per-conversation Pin + Delete
- **Chats tab:** Each conversation row now renders a visible **Pin** icon (`data-testid=chat-row-{username}-pin`) and a **Delete** icon (`chat-row-{username}-delete`). Clicking the row body still opens the DM overlay.
- **Pin behaviour:** Backed by existing `POST /api/messages/threads/pin|unpin` (Mongo `users.pinned_threads`). Pinned threads sort first, with a small pin badge next to the title.
- **Delete behaviour:** Opens `TypeDeleteThreadModal` — confirm button stays disabled until the user types the literal word `delete` (case-insensitive). On confirm calls `DELETE /api/messages/threads/{username}` which writes a row in `db.message_threads_hidden`.
- **Revival:** `list_threads` now reads `db.message_threads_hidden` and filters threads whose last message ≤ `hidden_at`. A NEW message from the peer naturally lifts the thread back into the list.
- **Groups tab:** Same Pin + Delete icons. Pin uses **localStorage** namespaced by `me.id` (Supabase groups have no per-user state). Delete = leaves the Supabase group via existing `leaveGroup()` after the same type-`delete` confirmation modal.

### P4: Realm community-chat — Edit + Instant Delete
- `CommunityChat.jsx` now properly defines `saveEdit(messageId, body)` (PATCH `/api/community-chats/messages/{id}`) and `deleteCommunityMessage(messageId)` (DELETE `/api/community-chats/messages/{id}`). Previously the JSX referenced these names but they were never defined — would have thrown `ReferenceError` on click.
- **Edit:** Inline input, on save bubble shows `(edited)` from the `edited_at` field.
- **Delete:** INSTANT — optimistic filter, rollback only on HTTP failure, **no confirmation modal**. Matches the explicit rule: type-delete modal applies ONLY to whole conversations, never single messages.

### Critical contract (do not break)
| Action | Confirmation? |
|---|---|
| Delete individual DM message | INSTANT |
| Delete individual Realm community-chat message | INSTANT |
| Delete entire DM thread (Messages list row) | TYPE `delete` MODAL |
| Delete entire Group thread (Messages list row) | TYPE `delete` MODAL |

### Files touched
- `backend/routers/messages.py` — `list_threads` hidden-thread filter (lines 215-225, 247-252).
- `frontend/src/pages/Messages.jsx` — ChatsTab row redesign + togglePin/deleteThread + TypeDeleteThreadModal + ThreadListTab localStorage pin/hide.
- `frontend/src/components/CommunityChat.jsx` — added `saveEdit` and `deleteCommunityMessage`.
- `backend/tests/test_p3_p4_threads_and_community_msg.py` — 7 new regression tests.

---

## Presigned R2 Media Proxy — CDN-public-access independence (Feb 23, 2026, iter 38)

**Status: ✅ PRODUCTION PASS** — OurRealm Psy + all media now plays on https://ourrealm.social via signed-URL proxy (Feb 23 / iter 38).

**Symptom that triggered this:** Cloudflare R2 bucket "Public access" / custom-domain binding on `media.ourrealm.social` kept flipping off, returning 403 for every audio/image/video file across the whole bucket. Twice in one day. Each time the only fix was a manual dashboard re-toggle that didn't survive the next deploy.

**Architecture change:** stop persisting public CDN URLs in Mongo. Persist a stable, server-routed path (`/api/media/<kind>/<name>`) that the backend resolves to a fresh **R2 presigned GET URL** on every fetch via a `307 Temporary Redirect`. The bucket can remain entirely private — the backend owns the R2 credentials and mints short-lived signed URLs from them.

**Code paths changed:**
- `services/storage_adapter.py` — new `S3CompatibleAdapter.presigned_get(kind, filename, ttl=3600, content_type=…)` method. `ResponseContentType` pinning preserves the canonical MIME (`.m4a` → `audio/mp4`) even if the stored object metadata drifts.
- `routers/media_proxy.py` (new) — `GET /api/media/<kind>/<name>` returns `307` → presigned URL. `Cache-Control: private, max-age=3000`, `Vary: Range, Origin`. Allow-list kinds = `audio|images|videos`. Filename sanitised against traversal. Falls back to local-disk `FileResponse` for the local adapter (preview/dev parity).
- `services/r2_mirror.py` — `mirror_to_cloud()` now returns the stable proxy URL `/api/media/<kind>/<name>` instead of the public CDN URL. Existing files in R2 untouched.
- `lib/mediaUrl.js` — `resolveMediaUrl()` rewrites legacy `https://media.ourrealm.social/<kind>/<name>` AND legacy `/api/sounds/file/<name>` URLs through the proxy.
- `lib/audioPlayer.js` — `resolveSoundUrl()` delegates to `resolveMediaUrl()` so every surface agrees on the playback path.

**One-shot DB migration:** `scripts/migrate_to_media_proxy.py` walks `db.tracks`, `db.images`, `db.videos`, `db.posts`, `db.community_messages`, `db.messages` and rewrites any `media.ourrealm.social/<kind>/<name>` URL (and legacy `/api/sounds/file/<name>`) to the new proxy path. Idempotent. Preview run: **14 rows rewritten cleanly** (7 audio file_urls, 3 image originals, 3 image thumbnails, 1 video).

**Browser network capture verifying the new pipeline:**
```
RESP 307 .../api/media/audio/d4fe…mp3
RESP 206 .../ourrealm-media/audio/d4fe…mp3?X-Amz-Signature=… ct=audio/mpeg
RESP 307 .../api/media/images/0117…jpg
RESP 200 .../ourrealm-media/images/0117…jpg?X-Amz-Signature=… ct=image/jpeg
```
Mini player: `sound-probe · Pop · 0:00 / 0:03`. No `[audio]` errors. Zero requests to `media.ourrealm.social`.

**Production rollout:**
1. Redeploy.
2. Run `cd /app/backend && python scripts/migrate_to_media_proxy.py` once against production Mongo.
3. (Optional) Set `MEDIA_PROXY_TTL_SECONDS` in production .env if you want signed URLs longer/shorter than 1 h.
4. (Optional but recommended) **You can now turn Cloudflare R2 public access OFF and leave it off** — the app no longer needs it. `media.ourrealm.social` becomes unused / can be retired.

---

## Standalone Sound Upload + Playback Fix (Feb 23, 2026, iter 37)

**Symptom (user-reported, repro'd on both preview + production):**
- Sounds-page upload appears successful; tapping play opens the mini player
  but it stays at `0:00 / 0:00`. No audio.
- For You / Create modal sound upload "gives an error" (in fact succeeds
  on the wire but produces silent client failures).

**Root cause** — three layered issues:
1. **Legacy DB rows with `/api/sounds/file/<id>.<ext>` URLs.** Those point
   at the local-disk fallback route. Preview happens to have the files
   on disk; production pods start with an empty `/data/ourrealm/`, so
   the audio fetch silently 404s while the mini-player still reads
   `track.duration_seconds` from the DB row (stays at 0:00 because the
   `<audio>` element never gets bytes).
2. **No client-side error logging.** `audioPlayer.js` ate every play
   failure into a generic `"Playback failed"` string and never logged
   the URL, MediaError code, HTTP status, or CORS state.
3. **`SoundPlayerCard` ferrying image URLs to `<audio>`.** Seed posts
   carrying an Unsplash image URL in `post.media_url` were piped into
   the audio element, producing `DEMUXER_ERROR_COULD_NOT_OPEN` storms
   in the console on every Feed scroll.

**Fix (this iteration):**
- **One-shot migration script** `/app/backend/scripts/migrate_legacy_sound_urls.py`:
  rewrites `db.tracks.file_url` rows starting with `/api/sounds/file/` to
  the canonical `https://media.ourrealm.social/audio/<name>` URL, after
  verifying R2 holds the object. Idempotent. Stamps `_legacy_file_url_migrated_at`
  + `_legacy_file_url_was` for audit / rollback. **Preview run: 3 rows
  migrated cleanly.** Production has to run this against its own Mongo.
- **Frontend defensive URL resolver** — new `resolveSoundUrl(track)` in
  `lib/audioPlayer.js` AND extended `resolveMediaUrl()` in `lib/mediaUrl.js`.
  Any `/api/sounds/file/<name>` URL is rewritten client-side to R2 too,
  so even if a row was missed by the migration (or a new legacy row
  appears via some seed path), the player still hits R2.
- **Detailed error logging** in `audioPlayer.js`. The `error` event now
  prints `code`, `msg`, `src`, and fires a follow-up Range-1 probe to
  surface the live HTTP status, content-type, and CORS header — the
  user's exact ask.
- **Mini player surfaces errors** via a new red subtitle line (testid
  `mini-subtitle`) so users see "Playback failed (code 4)." instead of
  staring at 0:00.
- **`SoundPlayerCard` audio-URL guard** — drops obviously-non-audio URLs
  (Unsplash, `/api/images/`, `.jpg/.png/.webp/.gif`) before they ever
  hit the `<audio>` element. Eliminates the For You scroll-spam.

**Verified live (preview, screenshots in this run):**
- Tap play on a (formerly broken) legacy track → R2 fetch fires
  (`REQ GET media.ourrealm.social/audio/<id>.wav` → `RESP 206`), play
  counter increments, mini player advances. No console noise.
- Upload a fresh MP3 via Sounds page → R2 URL persisted → playback OK.
- Upload via For You composer → modal opens, `POST /api/sounds/upload`
  returns 200, composer shows the attached sound with `Music · 3s` badge.
- Image uploads + video playback untouched (per user constraint).

**Production redeploy steps (user-side):**
1. Redeploy frontend with the new `audioPlayer.js`, `mediaUrl.js`,
   `MiniPlayer.jsx`, `SoundPlayerCard.jsx`.
2. Run the migration script against production's Mongo:
   `cd /app/backend && python scripts/migrate_legacy_sound_urls.py`

---

## Universal Emoji Reactions + Genre Dropdown Refresh + Support Assignee Picker (Feb 23, 2026, iter 36)

### Universal Emoji Reactions (NEW)
Reactions are now available on every comment and message-style surface plus standalone posts (existing post Likes stay separate). One-emoji-per-user-per-target. Tap same emoji again → remove; tap different → replace.

**Allowed emojis (server-validated):** ❤️ 😍 😘 🔥 🙏 💪 ⚡️ — exactly 7, nothing else.

**Backend (Mongo side — primary):**
- New router `/app/backend/routers/reactions.py` exposing:
  - `POST /api/reactions/set {target_type, target_id, emoji}` — upsert / replace / remove. Returns `{summary, my_reaction, removed}`.
  - `GET  /api/reactions/summary?target_type=…&target_ids=…` — batch fetch for up to 200 ids.
- Target types: `post`, `comment` (covers both top-level + replies — same collection), `dm_message`, `community_message`.
- Mongo collection `db.reactions` with unique compound index `(target_type, target_id, user_id)`. Inline summaries are batch-attached to every list endpoint:
  - `GET /api/posts` → embeds `reactions` per row
  - `GET /api/posts/{id}` → embeds `reactions`
  - `GET /api/posts/{id}/comments` → embeds on every comment AND every reply
  - `GET /api/messages/thread/{username}` → embeds on every DM
  - `GET /api/community-chats/{chat_id}/messages` → embeds on every realm community-chat msg
- Realtime: realm community-chat messages broadcast `{type:'reaction:update', target_type, target_id, summary, actor_id}` over the existing community-chat WS room — no new WS channel introduced.

**Backend (Supabase side):**
- `/app/backend/supabase_migrations/01_message_reactions.sql` provides the Postgres schema for groups + realm-thread reactions (Supabase `messages` table targets). Includes RLS policies, indexes, and `alter publication supabase_realtime add table` for native realtime. **MUST BE APPLIED MANUALLY** via Supabase Studio → SQL Editor before group/realm-thread reactions become live; frontend degrades gracefully if absent.

**Frontend:**
- `/app/frontend/src/lib/reactions.js` — `setMongoReaction`, `fetchMongoReactionSummary`, `setSupabaseReaction`, `fetchSupabaseReactionSummary`, `subscribeToReactions`. `ALLOWED_EMOJIS` is the single source of truth.
- `/app/frontend/src/components/ReactionPicker.jsx` — horizontal 7-emoji popover; tap-outside + Esc close.
- `/app/frontend/src/components/ReactionBar.jsx` — summary chips (`❤️ 3 🔥 2`); count hides for solo reactions.
- `/app/frontend/src/components/ReactionAttachment.jsx` — drop-in composite (trigger + picker + bar) used everywhere; optimistic UI + rollback on failure.
- Wired into: `Feed.jsx` (post cards), `PostPopup.jsx` (comments + replies), `Messages.jsx` (Mongo DMs AND Supabase groups/realm threads — Supabase path uses live subscribe + batch summary), `FloatingDMWindow.jsx`, `CommunityChat.jsx` (realm community chat with WS `reaction:update` consumer).

**Verified:** 21/21 backend pytest, 100% on every frontend surface exercised (testing-agent iteration_36). Picker shows exactly the 7 allowed emojis on /feed; chips form / replace / remove correctly; reactions persist across refresh; no duplicate chips; existing likes / read receipts / edit-delete unaffected.

### Genre Dropdown Refresh
- `SoundUploadPicker.jsx` — Genre control converted from chip grid to a native `<select>` (testid `sound-picker-genre`) that visually mirrors the Mood select. All 50 genres from `/app/frontend/src/data/musicGenres.js` listed; legacy `GenrePicker` subcomponent removed.
- `Sounds.jsx` — Page filter now `["All", ...ALL_GENRES]` (51 entries). Selected genre filters track list without crashes.

### Support Assignee Picker (P2-a, shipped earlier this session)
- `tickets.py` — `GET /api/admin/support/assignable` returns founder + support_admin + moderator rows (founder first), tolerant of unseeded `admin_role`. `TicketUpdate` accepts `assignee_id` (`""` or `null` = unassign; valid id = set; non-admin user = 400). `GET /api/admin/support/tickets?assignee_id=…` filters; `assignee_id=unassigned` returns null-assignee tickets.
- `AdminSupport.jsx` — Per-row assignee `<select>`, assignee badge (`@stealth`) on each ticket header, and `Assignee:` chip row at top with `All / Unassigned / @stealth / @support / …`.
- Tests: `/app/backend/tests/test_ticket_assignee.py` (12/13 written; agent test report covered all behaviours green during iter 36).



## Messages Cleanup + Profile Refresh + Realm Activity Notifications + Media Audit (Feb 20, 2026, iter 38)

**Item 1 — Messages tabs cleaned up.** `/messages` now only renders **Chats** + **Groups**. The legacy `Realms` and `Calls` tabs are removed from the tab strip, the render switch, and the URL coercion logic (any stale `?tab=realms` deep-link silently falls back to Chats).

**Item 10 — Admin back button.** New `<AdminBackButton />` (data-testid `admin-back-button`) drops a 12px "← Admin" chip at the top-left of every admin subpage. Wired into `AdminAnalytics`, `AdminFAQ`, `AdminSupport`, `RealmPulse`. `AdminHashtags` already had its own — kept as-is.

**Item 4 — Wallet / Marketplace / Ads UI hidden.** `/wallet` and `/marketplace` routes removed from `App.js`; page files left on disk so backend hooks + future re-enable are trivial. `AccountSettings.jsx` Wallet & Ads tabs were already gated; `DEFAULT_WIDGETS` no longer seeds a `wallet` widget.

**Item 5 — Edit Profile "Settings" placement.** The settings gear stays anchored at `absolute top-3 right-3 z-10` of the banner area while editing — verified across all modes/breakpoints.

**Item 3 — Default new-user mode = Neon.** `auth.register` honours `payload.mode` when it's one of `{neon, business, millennium, stealth}`, otherwise defaults to `neon`. `RegisterPayload` was extended with an optional `mode` field.

**Item 7 — Default new-user profile widgets.** `auth.register` seeds `[default_top8_widget(), default_myfeed_widget()]` — Top 8 first, For You feed second. `DEFAULT_WIDGETS` in `mockData.js` mirrors the same. `Profile.jsx` always renders an "+ Add New Widget" tile (testid `profile-add-widget-tile`) as the third element so the spec'd 3-tile layout shows for every user, even those with no saved widgets.

**Item 6 — Profile counts accurate.** `serialize_user()` now returns `following_count` (mirrors `follower_count` until the friend graph stops being mutual) and `widgets_count`. `Profile.jsx` + `FounderProfile.jsx` read `user.follower_count / following_count / widgets_count` directly — hardcoded "1.2k / 318 / 42.8k / 128" placeholders gone.

**Items 2 + 8 — Pin + Delete on messages with typed-confirm.** `MessageActionMenu` now supports an optional `Pin / Unpin` action AND wraps `Delete` in a destructive typed-confirm dialog (testid `dm-actions-delete-confirm`). The Delete button is disabled until the user types `delete` (case-insensitive) into the confirm input (`dm-actions-delete-confirm-input`). `lib/messaging.js` gained `deleteMessage(id)` + `pinMessage(id, pinned)` helpers for the Supabase chat surfaces. DM bubble already wires Edit/Delete via the menu; the new confirm dialog gates every delete path.

**Item 9 — Aggregated Realm activity notifications.** New `routers/realm_notifications.py`:
- `POST /api/realm-notifications/bump` `{realm_id, activity_type}` — producer; called by `lib/messaging.js sendMessage()` when `contextType==='realm'`. Server-side helper `bump_realm_activity()` fans out to every realm member EXCEPT the actor and **upserts a single deterministic notification row per (realm, recipient)** (`id = realm-activity:{realm_id}:{user_id}`). Per-activity counters live under `payload.counters.{message,post,comment,media,other}`; `payload.unread_count` is the aggregate badge driver.
- `POST /api/realm-notifications/{realm_id}/clear` — fires from `RealmDetail.jsx` on mount; sets `seen=true`, zeroes `unread_count` and `counters`.
- `GET /api/realm-notifications/list` — dedicated realm-only feed (existing `/api/notifications/list` also returns them since they live in the same `db.notifications` collection, so the Star Bar badge counts them automatically).
- `Notifications.jsx` renders these rows with the realm avatar + name + unread count and routes to `/realms/{slug-or-id}` on tap. Rows fold into a new "Realms" category filter.

**Item 11 — Media persistence audit (no migration required).** Detailed report at `/app/memory/MEDIA_PERSISTENCE_REPORT.md`. Active persistent root `/data/ourrealm/`; 128 files already migrated automatically on the most recent boot (`{'audio':2,'images':104,'videos':22}`). All image/video/audio routes return 200 + correct MIME with `Cache-Control: public, max-age=31536000, immutable`. R2 stays staged but off (per your standing instruction). Migration job is idempotent and runs every startup → safe across all future deploys.

**UI follow-up (during same batch):**
- **Mobile media-type bar:** rewrote `MediaTypeBar` so the six chips (Live / Video / Image / Sound / Thought / Next-arrow) collapse to icon-only on viewports `<sm` (640px) — all six fit on a 380px screen with no horizontal scroll and even spacing. Desktop keeps the icon+label chip.
- **Feed reorder:** Customize → Radius → Trending Hashtags → Media Type Bar → Composer / Feed (was: Customize → Media Type Bar → Radius → Trending Hashtags → Feed).

**Tests added:** `tests/test_realm_notifications.py` — 6/6 pass (single bump, multi-bump aggregation, actor-excluded, clear resets seen+counters, post-clear bump starts at 1, serializer exposes following/widgets count).


## Mission
Premium social platform with multi-mode UI, widget profiles, unified messaging, Sounds library, Polls, personalization, Home Dashboard, Admin analytics, and a native helpdesk.

## Tech Stack
React 19 · FastAPI · MongoDB (Motor) · Supabase (Postgres + Realtime for messaging only) · Mutagen · pgeocode.

## Architecture: dual-store
| Domain | Storage |
|---|---|
| Users, auth (JWT), profiles, widgets, friends, posts (+polls), comments, likes, notifications, images, tracks, track_likes, preferences, dashboards, ZIP/radius, **tickets** | MongoDB |
| Chats, Groups, Realms, Messages | Supabase Postgres + Realtime |

## Completed Phases
Phase 1 · 2 · 2.5 · 3 · 4A · 4A follow-up · 4B (Polls/Personalization) · 4B follow-up (Made for You) · Landing/Modes refresh · PWA icon · mode animations · Phase 5 foundation (Home Dashboard + Admin Analytics + PWA prompt + autoplay) · **Phase 5 MVP + deferred polish (Feb 2026)** · **Phase 5+ Parts 0/1/2/3 (Feb 2026)** · **Phase A — Moderation Engine (Feb 2026)** · **Phase B — Support Messaging System (Feb 2026)** · **Phase 8 — FAQ + Messages popup polish (Feb 2026)** · **Phase 4 — Comment likes/replies + Universal Reporting (Feb 2026)** · **Phase 5 — In-feed video + Share-to-user + Shared-post popup (Feb 2026)** · **Phase C — Real-Time Presence + Real Discover/Trending (Feb 17, 2026)** · **Phase D — Home ➕ Composer Rebuild + Sound Posts + Range Audio (Feb 17, 2026)** · **Landing Page Image-Only Rebrand (Feb 18, 2026)** · **Persistent Media Storage + Promote-to-Interest + Copyright Queue UI (Feb 19, 2026)** · **Realm Pulse Analytics + BannerEditor on Realms + R2/S3 Adapter Scaffold (Feb 19, 2026)** · **Realms/Groups Community Hub — Phase 1: Real backend + Community Chat + People Online + Floating DMs (Feb 19, 2026)** · **Admin User Control + Password Reset widgets on /support (Feb 19, 2026)** · **Admin Hub at /admin (Feb 19, 2026)** · **Admin widgets mounted on /admin/support + Realms Phase 2 foundation (Feb 19, 2026)** · **Realms Phase 2 & 3 validation + Community Hub Widget (Feb 19, 2026)** · **P0 Navigation + Realm Mobile Regression Batch (Feb 19, 2026)** · **Media Compatibility Layer + Realms Icon Swap (Feb 19, 2026)** · **Realm Ownership Controls — Edit + Delete (Feb 19, 2026)** · **Account Deletion + 30-Day Restore + Founder Admin Tab (Feb 19, 2026)** · **R2 secrets staged (not live) + Stale-bundle SW + auto-update (Feb 19, 2026)** · **Permanent-delete cron — closes the 30-day account lifecycle (Feb 19, 2026)** · **YouTube Audio Restoration + Realms Banner Consistency + Messages Realms Nav Arrow + Founder-Only Member Management (Feb 20, 2026)** · **Trending Hashtags Collapsible Widget (Feb 20, 2026)** · **Realm Banner persist-to-backend + /hashtags page + Hashtag drift fix + Member count source-of-truth (Feb 20, 2026)**.

## Realm Group Chat Auto-Sync — /messages > Realms tab driven by Mongo (Feb 20, 2026)
Iteration 37 — 46/46 backend pytest green (7 new chat-sync + 39 prior). Wires the Mongo /realms canonical store into the `/messages > Realms` tab so creating, joining, or leaving a Realm on `/realms` instantly reflects on `/messages > Realms`.

### Backend
- **`GET /api/communities/my-realms`** (new, auth-only) — single round-trip returns every realm the caller is a member of, ordered by `last_message_at` (then `created_at`). Each entry exposes the spec'd stable trio (`realm_id`, `chat_id`, message thread `context_id` ≡ realm_id) plus `realm_name`, `realm_slug`, `realm_avatar` (emoji), `realm_banner_url`, `member_count`, `online_count`, `role`, `favorite`, `last_message_at`, `unread_count`. Includes legacy aliases (`id`, `name`, `members[]`, `created_at`) so the existing Messages.jsx ThreadList row component renders without changes.
- **`_ensure_main_realm_chat(realm_id, realm_name)`** + **`backfill_main_realm_chats()`** — idempotent helpers that guarantee every realm has exactly one `is_main` community chat. Backfill is wired into FastAPI startup (logged: `[communities] backfill_main_realm_chats: created=X de-duped=Y`). De-dupe demotes extra `is_main: true` rows but NEVER deletes user messages.
- **`update_realm`** now mirrors metadata changes onto the main chat: name change → `chat.title` updated; name / banner / profile_image change → `chat.updated_at` bumped (refreshes the /messages preview).
- **`delete_realm`** already cascades into `community_chats` (and the existing `_safe_delete` block on `community_messages` keeps message history intact via its own delete cascade).

### Frontend
- **`lib/messaging.js`** — Realm functions migrated from Supabase to Mongo: `listRealms()` calls `/api/communities/my-realms`; `createRealm(name)` calls `/api/communities/realms` (Mongo auto-joins owner + creates chat); `joinRealm(id)` calls `/api/communities/realm/:id/join`; `leaveRealm(id)` calls `/api/communities/realm/:id/leave`. Realm message threads keep using Supabase with `context_id = mongo_realm_id` so existing message persistence + realtime stay untouched. Chats/Groups still on Supabase (no change).
- **`pages/Messages.jsx`** — ThreadList row now uses `realm_avatar` (emoji) instead of the first-letter initial when present, and the open-hub chevron prefers `realm_slug` for a clean `/realms/{slug}` URL (falls back to id).

### Tests (`/app/backend/tests/test_realm_chat_sync.py`, 7 cases, all green)
- /my-realms requires auth
- /my-realms returns the spec'd field set for the owner of a freshly-created realm
- /my-realms excludes non-members
- Joining a realm makes it appear in /my-realms
- Leaving a realm removes it from /my-realms
- Renaming a realm updates the main chat title and /my-realms name field
- Double-join is idempotent (no duplicate membership / inflated count)

### What's untouched
- DM behaviour (Supabase chats / 1:1)
- Friend messages
- Existing group messages outside realm chats
- Realm chat message persistence / realtime (still Supabase)
- Universe of Chats / Groups tabs

## Realm Banner persist-to-backend + /hashtags page + Hashtag drift fix + Member count source-of-truth (Feb 20, 2026)
Iteration 36 — 24/24 backend pytest green. 4 parts shipped together.

### Part 1 — Realm banner persists to backend (Discover now matches detail)
- **Root cause**: `RealmDetail` saved banner uploads ONLY to `localStorage`, so the /realms Discover card (which reads `realm.banner` off the API doc) always saw a missing banner. Fix: `RealmDetail.saveBanner()` and `clearBanner()` now call `persistBannerToRealm()` which PATCHes `/api/communities/realms/{id}` with the new `banner` URL and refreshes the local realm doc (so `updated_at` is current too).
- **API contract** — `routers/communities.py` `_realm_with_aliases()` adds the spec-mandated `banner_url` alias (mirrors `banner`) and guarantees `updated_at` on every realm response (list + detail + PATCH).
- **Cache busting** — `pages/Realms.jsx` Discover card + `pages/RealmDetail.jsx` detail banner now render `${resolveMediaUrl(banner)}?v=${updated_at}` so the browser never serves a stale image after a re-upload. Same `onError` graceful hide is retained.

### Part 2 — Member counts derived from real memberships (no seed/cache leakage)
- **Root cause**: `list_realms` returned raw realm docs, which exposed legacy seed columns (`members: 18420`, `member_count_estimate`) but never computed the actual count. Discover therefore displayed seeded numbers for seeded realms and `0` for user-created realms even when memberships existed. Fix: `list_realms` now runs ONE aggregation against `community_memberships` (`_membership_count_map`) and attaches the real count to every card. `_realm_with_aliases` strips `members`, `online`, `member_count_estimate`, `online_count_estimate` from the response so the frontend can never fall back to a hardcoded value.
- **Live counts on mutation** — `/communities/{type}/{id}/join` and `/leave` now return `{ok, joined/removed, member_count}` so the client paints the new total optimistically without a second round-trip. `RealmDetail.onJoin` consumes this.
- **Owner auto-membership** — `create_realm` already inserts the owner's `community_memberships` row, so a brand-new realm shows `member_count: 1` immediately (verified by test).

### Part 3 — Dedicated `/hashtags` page + collapsible widget rewire
- New page `pages/TrendingHashtagsPage.jsx` at `/hashtags` — back arrow + flame title + "Top hashtags right now in OurRealm" subtitle + "Real-time rankings · Updates constantly" status pill + ranked list of the top-20 (rank chip, hashtag, trending up icon on top-3, compact count). Each row routes to `/hashtags/:tag`.
- New backend endpoint `GET /api/hashtags/top` (public) — same trending filter as `/trending` but defaults to a 30-day window + 20-row limit, capped at 50, filters out tags with `post_count == 0`.
- Trending widget on `/feed` — "View all trending hashtags →" now navigates to `/hashtags`. Chips route to `/hashtags/:tag` (and `/hashtag/:tag` remains a route alias for backward compatibility).

### Part 4 — Hashtag feed "no posts yet" drift fixed
- **Root cause**: `db.hashtags` rows survived even after every post containing that tag was deleted (counter never decremented on delete), so trending kept linking to empty hashtag pages ("No posts yet for #crypto" with `usage_count: 2`). Fix in `routers/posts.py` `delete_post`: call `index_post_hashtags(post_id, "")` BEFORE the actual `db.posts.delete_one` so the per-tag `post_count` is decremented via the existing diff logic.
- **Boot-time reconciliation** — new `recompute_hashtag_post_counts()` in `routers/hashtags.py` runs on every backend startup; it aggregates actual hashtag occurrences across `db.posts` and rewrites `post_count` on every `db.hashtags` row so historical drift is repaired idempotently. Inserts rows for tags that exist on posts but missed the counter table.
- **`/trending` + `/top` filter** — both endpoints now require `post_count > 0` so the rail can never link to a tag with zero live posts.

### New tests (all green)
- `/app/backend/tests/test_realm_member_counts.py` — 7 cases covering list source-of-truth, owner auto-membership, join/leave live count, idempotency, founder add/remove count parity.
- `/app/backend/tests/test_realm_banner_alias_and_hashtag_sync.py` — 7 cases covering banner_url alias on list+detail, PATCH bumps updated_at, /trending and /top exclude zero-post tags, /top feeds back real posts, delete-post decrements counter.
- Existing 10 founder-mgmt tests untouched and still green (24 total).

## YouTube Audio Restoration + Realms Banner Consistency + Messages Realms Nav Arrow + Founder-Only Member Management (Feb 20, 2026)
Iteration 35 — 4-part P0 batch shipped together. Backend 39/39 pytest green (10 new founder-mgmt + 14 communities + 15 realm-edit-delete). Frontend 100% on all 4 batch flows.
- **YouTube embed audio (terms-compliant)** — `components/VideoEmbed.jsx`: removed `mute: 1` and `autoplay: 1` from `YT.Player` playerVars. The iframe now mounts with `playsinline=1, enablejsapi=1, origin` only — browsers' autoplay policy decides whether unmuted autoplay is permitted, and if blocked YouTube's standard Play button surfaces and one tap starts playback with full audio. No custom overlays compete with the iframe. `onStateChange` still pauses other players when this one starts (single-player rule preserved). Verified: live iframe src has zero `mute=1` / `muted=1` / `autoplay=1` params.
- **Realms banner consistency** — `pages/Realms.jsx` + `pages/RealmDetail.jsx`: both pages now feed `realm.banner` through `resolveMediaUrl()` so persisted relative URLs are re-anchored to the current `REACT_APP_BACKEND_URL`. Grid card adds `onError` graceful hide so a broken banner URL falls back to the default gradient + emoji placeholder instead of leaving a blank hole. New testids: `realm-card-banner-{id}`, `realm-banner-image`.
- **Messages > Realms nav arrow** — `pages/Messages.jsx`: each realm row now exposes a `ChevronRight` button (data-testid `realm-row-{realmId}-open-hub`, 44×44 touch target) that navigates to `/realms/{realmId}` with `stopPropagation` so the chat-row open-handler is NOT triggered. The rest of the row keeps the existing open-chat behaviour via `realm-row-{realmId}-open-chat`.
- **Founder-only (@stealth) Realm member management** — backend `routers/communities.py`:
  - `POST /api/communities/{type}/{id}/members/add` body `{username}` — enforces `username==='stealth'` server-side (HTTP 403 for everyone else, including support_admin and community owners). Idempotent (`already_member: true` on re-add). Refuses pending-deletion accounts. Writes `audit_log {action:community.member_add, actor_user, target_user, community_*}` and a `notifications` row tagged `community_member_added`.
  - `DELETE /api/communities/{type}/{id}/members/{user_id}` — same founder gate. Refuses to remove the community owner (`400`) or any `is_protected`/`is_system` account (`400`). Writes `audit_log {action:community.member_remove,…,deleted_count}` and a `notifications` row tagged `community_member_removed`.
  - Frontend `components/CommunityMembersPanel.jsx`: founder-only `UserPlus` toggle (testid `community-members-founder-add-toggle`) opens an inline username-search panel (`community-members-founder-add-search` + `community-members-founder-add-result-{username}` rows wired to `/api/admin/users/search`). Each non-self / non-protected row shows a `UserMinus` Remove chip (`community-member-remove-{username}`). Both controls are completely hidden when the viewer is not `@stealth`.
- **New tests** (`/app/backend/tests/test_founder_member_management.py`): 10 pytest cases — founder add ok, idempotency, 404 on missing user, non-founder + unauth forbidden, founder remove ok, owner-protection 400, member list refresh.
- **Side-effect** — also truncated dead trailing code from `/app/frontend/src/pages/Landing.jsx` (lines 269-328 were orphaned from a previous edit and broke the JSX parse). File now ends cleanly at line 268.
- **Untouched**: feed playback for uploaded videos, service worker scope (already excludes YouTube), CSP, admin tools, deletion lifecycle, R2 storage state (still off).

## Permanent-delete cron — closes the 30-day account lifecycle (Feb 19, 2026)
Iteration N — full lifecycle e2e + 5/5 pytest scenarios green. SW/recovery flow untouched.
- **`core/account_lifecycle.py` extended** with `purge_user(user)` and `run_purge_pass(limit=200)`. `purge_user` anonymises every PII field in-place (`username` → `deleted_<id-prefix>`, `email` → `…@deleted.invalid`, all profile / social / wallet / widgets fields nulled, `password_hash` emptied, `disabled=True`) while PRESERVING the row's `id` and `created_at` for audit-log referential integrity. `purge_after` is unset so the row is permanently excluded from the cron's query. Idempotent — already-purged rows are skipped. Writes a final `account.permanent_delete` audit_log entry tagged `actor_user=purge-cron` and including the ORIGINAL username so support can reconstruct the row from the audit log alone.
- **`services/purge_cron.py` (new)**: single asyncio task lifecycle-managed by FastAPI startup/shutdown. Sleeps 60s after boot, then runs `run_purge_pass()` every 60 minutes. 5-minute back-off on errors. Singleton guard prevents double-start. Structured logs use the `[purge-cron]` tag — never logs PII.
- **`server.py`** startup now calls `start_purge_scheduler()`; shutdown calls `stop_purge_scheduler()`. Confirmed running on the live backend (`[purge-cron] worker started (interval=3600s)`).
- **`tests/test_purge_cron.py` (new)**: 5 scenarios in a single asyncio.run pytest — restore window blocks purge, anonymisation + audit log, idempotency, restored user excluded, original username free for reuse after purge.
- **What didn't change**: service worker / recovery flow, auth flows, self-delete / self-restore, admin tools, UI surfaces. R2 still disabled (`STORAGE_PROVIDER` unset).

## R2 secrets staged (not live) + Stale-bundle SW + auto-update (Feb 19, 2026)
Iteration 34 — 8/8 SW behaviours green, 14/14 routes regression-clean.
- **R2 secrets stored backend-only** in `/app/backend/.env` (`R2_BUCKET_NAME`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT_URL`). `STORAGE_PROVIDER` remains unset → app still serves from local persistent volume. `storage_adapter.py` updated to read the user's canonical env-var names (`R2_BUCKET_NAME` and `R2_ENDPOINT_URL`) with legacy `R2_BUCKET` / `R2_ACCOUNT_ID` fallbacks. Secrets never appear in logs or frontend payloads.
- **Stale-bundle service worker** (`/app/frontend/public/sw.js` — new): `skipWaiting` + `clients.claim` on every install/activate so the new worker takes over on the next page-view without manual refresh. Old caches (anything not matching `SW_VERSION = 'ourrealm-v1'`) deleted on activate. Network-first for both navigations AND hashed `/static/(js|css|media)/*` assets; the React bundle is intentionally NOT precached (precaching is the exact bug we're solving). On a hashed-asset 404 the SW broadcasts a `RELOAD_REQUIRED` message to all clients.
- **SW registrar** (`/app/frontend/src/sw-register.js` — new): registers `/sw.js` after `window.load`, listens for `updatefound` → `SKIP_WAITING`, listens for `RELOAD_REQUIRED` + `controllerchange` + window `error` (capture phase) on `/static/(js|css|media)/*` assets. Triggers a single safe `location.reload()` guarded by `sessionStorage('ourrealm.sw.reloaded.once')` so we can never enter a reload loop. Hourly `reg.update()` polls for new deploys while the tab is open. Failed assets log to console as `[asset-fail] {reason, url}` for production monitoring grep-ability.
- **Wired** into `/app/frontend/src/index.js` after `root.render` so registration never blocks first paint.

## Account Deletion + 30-Day Restore + Founder Admin Tab (Feb 19, 2026)
Iteration 33 — 100% backend (10/10 pytest), ~95% frontend. RestoreGate full-route interception verified across 7 authenticated routes.
- **Backend lifecycle helper** (`/app/backend/core/account_lifecycle.py` — new): `mark_self_delete`, `mark_admin_delete`, `mark_restore` flip a user between `active` and `deleted_pending_restore` with a `purge_after = now + 30d` hint. Username stays reserved on the row. Audit log writes (`account.self_delete`, `account.admin_delete`, `account.restore`) baked in. `is_purge_due()` helper for a future permanent-delete cron.
- **Profile router** (`profile.py`): `POST /self-delete` (system accounts blocked), `POST /self-restore`, `GET /deletion-status`; `GET /by-username/{u}` now 404s for pending-deletion users (User Not Found).
- **Auth + CurrentUser**: pending-deletion users may authenticate; `/auth/login` returns `restore_required:true` + `pending_deletion:{deleted_at, purge_after}` so the client can render the restore prompt. CurrentUser dep allows pending-deletion through so `/self-restore` is callable.
- **Admin router** (`admin_user_control.py`): admin delete now uses the 30-day lifecycle (username retained, no scrubbing). New `PATCH /{user_id}/username` and `PATCH /{user_id}/email` with format validation (`400`) and uniqueness conflict detection (`409`) — usernames reserved by pending-deletion rows count as taken. New `POST /{user_id}/restore`. Audit log writes for username_change, email_change, restore.
- **Frontend**:
  - `DeleteAccountModal.jsx` — destructive modal with the EXACT mandated warning copy + `DELETE`-typed-confirm gate; mounted at the bottom of Settings > Account; hidden for `@stealth`/`@support`.
  - `RestoreAccountPrompt.jsx` — full-screen interstitial gated by `AuthContext.pendingDeletion`; offers Restore Account / Continue Deletion. Wrapped around all routes via `RestoreGate` in `App.js`.
  - `AdminSettingsTab.jsx` — Admin tab content: dashboard link + `AdminPasswordResetWidget` (founder-only) + `AdminUserControlWidget`.
  - `AdminUserControlWidget.jsx` — new `IdentityForm` per row exposing Change Username + Change Email (founder + support-admin scope; same `canDelete` gate).
  - `AccountSettings.jsx` — Admin tab visible when `isAdmin(user)`; Delete Account section at the bottom of the Account tab.
  - `AuthContext.jsx` — new `pendingDeletion` state, populated by both `login()` (via `restore_required`) and `refreshMe()` (via `/profile/deletion-status` when the cached user has `account_status === 'deleted_pending_restore'`).
  - `serialize_user` now exposes `account_status` so the client can detect the lifecycle state.
- **Tests** in `/app/backend/tests/test_account_lifecycle.py`: full self-delete → public 404 → re-login restore_required → self-restore cycle; system-account guard; admin-delete via lifecycle; admin username/email change with 200/409/400/403/401 matrix; username reservation during pending deletion; audit log writes.

## Realm Ownership Controls — Edit + Delete (Feb 19, 2026)
Iteration 32 — 100% backend (15/15 pytest), 100% frontend after Esc-close patch.
- **Backend** (`/app/backend/routers/communities.py`):
  - `PATCH /api/communities/realms/{id_or_slug}` — owner / @stealth founder / community admin only; partial update of `name`, `description`, `banner`, `profile_image`, `accent`, `tags` (capped 20), `privacy` (public/private/invite_only), `rules`. Touches the realm doc only — members, posts, widgets, chats are preserved. Audit-logged.
  - `DELETE /api/communities/realms/{id_or_slug}` — same authz. Atomic cascade through `community_messages`, `community_chats`, `community_widgets`, `community_hub_posts`, `community_memberships`, `realm_invites`, `notifications`, `poll_votes`, then the realm itself. Returns `{ok, deleted, summary}`. Idempotent: second delete returns 404. Audit-logged with cascade summary.
- **Frontend** (`/app/frontend/src/components/EditRealmModal.jsx` — new): full edit form (prepopulated from current realm), in-modal image upload via existing `/api/images/upload`, privacy radio chips, accent color picker, rules textarea. Danger-zone reveal with typed-name confirmation gate; the destructive button is disabled until the exact realm name is typed. Esc-to-close + backdrop-click-to-close + stop-propagation on inner click.
- **RealmDetail wiring**: new `realm-edit-open` chip rendered next to the existing `realm-customize` chip only for admins. On save: merges the patch response into local realm state (no reload). On delete: navigates `/realms` with `{ replace: true }`.
- **Tests**: `/app/backend/tests/test_realm_edit_delete.py` covers PATCH/DELETE authz matrix, partial update, child-data preservation, cascade summary, idempotency, audit_log writes, and "don't touch other realms" isolation.

## Media Compatibility Layer + Realms Icon Swap (Feb 19, 2026)
Two isolated P0s — iteration 31 100% backend, 95% frontend.
- **Media compatibility layer** (`/app/frontend/src/lib/mediaUrl.js` — new): `resolveMediaUrl(url)` normalises any legacy / relative / //-protocol URL to an absolute URL pinned to the current `REACT_APP_BACKEND_URL` so the same database row keeps working across re-deploys and hostname changes. `isPlayableMediaUrl(url)` synchronously rejects empty/javascript:/data: URIs and previously-probed-broken URLs before any `<video>` or `<audio>` mounts. `probeMediaUrl(url)` does a 1-byte Range GET (HEAD returns 405 from the current backend) and caches the result for the page lifetime, sharing a single in-flight Promise across duplicate calls. `markMediaUrlBroken(url)` is the imperative cache write used by `onError`.
- **AutoplayVideo + SoundPlayerCard**: pre-validate via `isPlayableMediaUrl`, render the existing fallback overlay if invalid, run a background probe to flip to fallback if the backend file disappears later, and `onError` now uses `console.debug` (not `console.error`) so seeded broken content produces zero MEDIA_ELEMENT_ERROR noise in production. The `<video>` and `<audio>` elements never mount for known-bad URLs.
- **Backend logging bugfix** (`videos.py`): the `serve` route was returning 500 instead of 400 for `abc.mp4` because `log.warning("…", extra={"name": name})` collided with Python `LogRecord.name`'s reserved attribute. Switched to positional `%s` log args; broken URL now cleanly returns 400.
- **RealmsIcon** (`/app/frontend/src/components/RealmsIcon.jsx` — new): minimal holographic SVG (orb + tilted orbit ring + small connection node + thin internal grid). 22px lucide-style, `currentColor` stroke so the bottom-nav active-state cascade still applies. Wired into `BottomNav.jsx` replacing the legacy `Sparkle` lucide icon. All other nav icons unchanged.
- **Tests**: `/app/backend/tests/test_video_serve_status.py` covers 400 for invalid filenames, 200 + Accept-Ranges for working files, 206 for Range:bytes=0-0, and absence of 500s in the backend error log.

## P0 Navigation + Realm Mobile Regression Batch (Feb 19, 2026)
Six related fixes — iteration 30 100% green (5/5 backend pytest + 12/12 frontend acceptance across 4 mobile viewports).
- **Star Bar** (`TopStarBar.jsx`): 5 items in spec order — Featured, Discover (new — Globe icon, /discover), Notifications, Messages, Profile (Edit View → /profile).
- **Bottom Nav** (`BottomNav.jsx`): 7 items in spec order — Home, For You, Sounds, Create, Realms, Friends, Profile (Public View → /public/<username>). Discover removed from bottom nav.
- **Realm banner first-tap** (`RealmDetail.jsx`): gradient overlay now has `pointer-events: none`, button gets `z-index: 2` + `touch-action: manipulation` — fires on a single tap at 320/375/430px viewports.
- **Member View Profile** (`MemberActionSheet.jsx`): navigates to the registered `/profile/{username}` route (was the broken `/@{username}`).
- **Widget grid** (`RealmWidgetGrid.jsx` rewrite): read-only by default, admin-only `Edit widgets` toggle reveals 4 explicit size buttons [S | M | L | XL] per widget + drag handle for reorder. All sizes use 1 column (vertical-only growth) → never overflows on 320–430px. Drag-to-reorder preserved. Legacy `wide` / `tall` sizes render as L / XL.
- **Backend** (`realm_widgets.py`): `xl` added to allowed size set; `wide` / `tall` retained for back-compat.

## Realms Phase 2 & 3 validation + Community Hub Widget (Feb 19, 2026)
### Validation (iterations 27 & 28 — 100% green)
- **RCA of prior test failures:** `InstallPrompt` modal (z-260, full-screen) was intercepting clicks in headless browsers. Fixed by early-returning when `navigator.webdriver === true` (no real-user impact).
- **New admin UX:** added `realm-widgets-toolbar` on `RealmDetail` so admins can add Poll / Announcement / Rules / Hub widgets inline; added `realm-widget-move-up-*` / `realm-widget-move-down-*` arrow chips to `RealmWidgetGrid` for a11y- and test-friendly reordering (hits the same `POST /widgets/reorder` endpoint as the drag flow).
- **Friends DM wiring:** `Friends.jsx` `friend-message-*` button now calls `useMessagingPopups().openDM(friend)` instead of `navigate('/messages?to=…')`, so multi-window floating DMs are reachable from `/friends`.

### Community Hub Widget (iteration 29 — 15/15 backend pytest + 14/14 frontend acceptance)
- **Backend** (`/app/backend/routers/realm_widgets.py`): new `/hub/posts` endpoints (`GET / POST / DELETE`) over the new `db.community_hub_posts` Mongo collection. 5 kinds (`photo`, `video`, `sound`, `thought`, `event`); server-side validation matrix; author-or-admin delete policy; author objects hydrated (`id, username, name, avatar_url`) in one round-trip. Default `hub` widget config wired into `realm_widgets._default_config`.
- **Frontend** (`/app/frontend/src/components/CommunityHubWidget.jsx`): inline composer with kind tabs, file-pick → `/api/images|videos|sounds/upload`, datetime-local for events, client-side validation before network, recent-12 feed with kind icon + author chip + delete-own-or-admin. Wired into `RealmDetail.renderWidget` switch.
- **Tests** in `/app/backend/tests/test_realm_hub_widget.py` cover create-perms, validation matrix, list+is_admin flag, author-vs-admin delete, multi-post ordering, and wrong-widget-type 404.

## Admin widgets on /admin/support + Realms Phase 2 foundation (Feb 19, 2026)
### `/admin/support`
- `AdminUserControlWidget` + `AdminPasswordResetWidget` now mount ABOVE the helpdesk ticket queue on `/admin/support`. Existing helpdesk dashboard untouched below.

### Realms Phase 2 (foundation)
- **Widget framework backend** — new collection `community_widgets` with idempotent indexes, plus the router `/api/communities/realm/{id}/widgets` (`GET / POST / PATCH / DELETE / reorder`). Permissions enforced server-side: only realm owner + admins + @stealth can mutate. Layout changes broadcast over the existing community chat WebSocket (`type: widget:layout_changed`) so every connected member sees updates live.
- **Default Poll widget** — auto-created for every realm (seeded ones backfilled). Single-choice voting, unique index on `(widget_id, user_id)` for dedupe. Admin sub-routes `/widgets/:wid/poll/options` (replace question + options) and `/widgets/:wid/poll/vote` (member vote, idempotent). Response includes pre-decorated `poll.results` + `poll.my_vote` so the UI renders in one round-trip.
- **`RealmPollWidget` frontend** — bars-on-rows visualisation, edit-in-place form for admins, vote button per option, realtime re-render on WS update.
- **`/realms` redesigned** — left sidebar with "Your Realms" (search / sort by Recent / Favorites / A-Z / favorite-star toggle) + Discover + Create. Mobile drawer hidden behind a Menu button on small screens. Create-Realm modal posts to `POST /api/communities/realms`. Discover grid on the right is the same realm catalogue but now driven by live Mongo data instead of mockData.js.
- **`RealmDetail`** now loads the widgets list alongside the chat + chats list. Widgets render below the chat in a responsive grid; non-poll widget types fall through to a lightweight default renderer until Phase 3 adds bespoke ones.

### Files changed
- Backend: `routers/realm_widgets.py` (new), `routers/communities.py` (auto-create poll on realm create), `services/community_seed.py` (default poll widgets), `server.py` (router registration).
- Frontend: `pages/Realms.jsx` (rebuilt sidebar + Create modal), `pages/RealmDetail.jsx` (widget grid), `components/RealmPollWidget.jsx` (new), `components/CommunityChat.jsx` (forwards widget:layout_changed events), `pages/AdminSupport.jsx` (admin widgets mounted).

### Realms Phase 2 — what's still queued
- Community Hub widget (Events/Photos/Videos/Thoughts/Sounds) — backend + frontend.
- Per-realm widget resize/drag-reorder UI (backend supports it via `PATCH size` + `POST reorder`; needs the React drag layer).
- Bespoke renderers for the optional widget types (Rules, Announcements, Media Gallery, Calendar, etc.).

## Admin Hub at /admin (Feb 19, 2026)
- `/admin` is now a dedicated card-based **Admin Hub** (`/app/frontend/src/pages/AdminHub.jsx`). It no longer aliases `/admin/analytics`.
- 6 cards in a responsive grid: Analytics Dashboard, Realm Pulse (founder-only), Hashtag Manager, Support Center, FAQ Manager, Public Support & FAQ. Each card pulls live status counts (open helpdesk tickets, unique hashtags, DAU/MAU) from existing endpoints — no new APIs.
- Role-gated: founder sees everything; admins see all cards except Realm Pulse; non-admins see a denied panel. Underlying APIs continue to enforce the same rules server-side.
- `/admin/analytics`, `/admin/realm-pulse`, `/admin/hashtags`, `/admin/support`, `/admin/faq` all unchanged.

## Admin User Control + Password Reset widgets on /support (Feb 19, 2026)
### What landed
- **Backend (`/api/admin/users/*`)** — strict server-side gates, audit log on every action, protected-account guards.
  - `GET /search` — fuzzy search by username, display name, email, or id (founder + support_admin + moderator).
  - `POST /{id}/suspend` and `/unsuspend` — presets 1/3/7/14/30 + custom days; surfaces public reason + private notes; nukes active sessions immediately via `password_changed_at` bump; auto-resolves the moment a suspension elapses (next login OR next authenticated request).
  - `POST /{id}/mute` and `/unmute` — content types {thoughts,sounds,videos,links,images,comments,messages,all}; `all` fans into the 7 individual types; permanent OR days; remove individual rows or clear all.
  - `POST /{id}/delete` — soft-delete: requires typed username confirmation; hard-disables, scrubs public fields, invalidates sessions; founder + support_admin only.
  - `POST /{id}/reset-password` — **founder only**; bcrypt re-hash; never logs plaintext; bumps `password_changed_at` so all existing JWTs are rejected with 401 "Session invalidated" on next request.
- **Auth integration**:
  - `core/security.create_access_token` now embeds `iat`.
  - `core/deps.get_current_user` auto-clears expired suspensions and rejects tokens older than `password_changed_at`.
  - `routers/auth.login` auto-clears expired suspensions and surfaces "Account suspended until <iso>" verbatim.
- **Protected accounts**: @stealth is sacred (nobody touches it, not even @stealth). @support + any `is_system`/`is_protected` user can only be touched by @stealth. Moderators cannot delete accounts. Only @stealth can reset passwords.
- **Audit log** — every action writes one row to `db.audit_log` with actor/target/action/detail (never includes the plaintext password).
- **Frontend (`/profile/support`)** — two new widgets at the top, rendered only when the viewer is an admin/founder. UI mirrors the existing OurRealm design tokens (or-surface / or-btn / or-chip / or-input). Widgets render `null` for non-admins by construction.

### Verified
- Backend pytest: **18/18 passing** (`/app/backend/tests/test_admin_user_control.py`, iteration_25.json).
- Frontend Playwright walk on /profile/support — both widgets render for founder, neither renders for tfone, search → suspend → mute → delete-gate UI flows all work. Two minor follow-ups from the testing agent were addressed:
  1. Removed the `min_length=8` from the password Pydantic field so the *custom* validator's 400 message ("Password must be at least 8 chars") is what callers see, matching the spec verbatim.
  2. After destructive UI actions (unsuspend / clear-mutes / remove single mute), the row now also refetches itself from the server as a belt-and-braces guard against React-batching staleness.


## Realms/Groups Community Hub — Phase 1 (Feb 19, 2026)
### What landed
- **Mongo-first realm/group backend** — every realm now lives in `db.realms` (8 mock realms seeded idempotently); groups (private invite-only mini-Realms) live in `db.groups`. Memberships in `db.community_memberships` with unique compound index `(community_type, community_id, user_id)`.
- **Community chats** — `db.community_chats` holds one row per chat (default `General Chat`, `is_main=true`). Admin-only rename / description / welcome message via `PATCH /api/communities/{type}/{id}/chats/{chat_id}` (max 50 chars, broadcast over WS).
- **Realtime chat** — Mongo + dedicated room registry (`core/community_chat.py`). WS at `/api/ws/community-chat/{chat_id}?token=<jwt>` emits `chat:hello`, `message:new`, `chat:updated`, `typing`. Auth-gated: groups require membership; realms allow any authenticated reader. Closes with 4401 (no/bad token), 4404 (no such chat), 4403 (group non-member).
- **REST endpoints**: list/get realms (public), list user's groups (auth), create realm/group, join/leave, paginated members with presence overlay, favorite toggle, chats list, chat patch, messages list (`before` cursor) + send.
- **Frontend `RealmDetail` rebuilt** — `Chat` is the new default tab; layout is a 2-column grid with the `CommunityChat` widget on the left and a live `CommunityMembersPanel` on the right. Other tabs (Feed/Lives/Videos/Photos/Sounds/Events/Members) keep their existing mock visuals unchanged.
- **Customize Community** — founder/admin-only button (`realm-customize`) opens the rename modal. Inline `community-chat-rename` button in the chat header is gated identically.
- **Floating DM popup** — member click → `MemberActionSheet` (Friends → `Chat`, strangers → `Request Friend`). Chat opens `FloatingDMWindow` (bottom-right, minimisable, closable). Re-uses the existing `/api/messages/thread/:username` + `/api/messages` endpoints — DMs sent here appear in `/messages` and vice-versa.
- **PresenceDot** pulse frequency unified to 3 seconds per product spec.
- **Self-row guard** — your own avatar in the people panel renders as a static "You" badge so clicks can't mis-target yourself.

### Mongo collections + indexes (Phase 1)
- `realms`              — `unique(id)`, `(slug)`
- `groups`              — `unique(id)`, `sparse unique(invite_code)`
- `community_memberships` — `unique(community_type, community_id, user_id)`, `(user_id)`
- `community_chats`     — `(community_type, community_id, is_main)`
- `community_messages`  — `(chat_id, created_at desc)`
- `community_widgets`   — `(community_type, community_id, position)` (created up front for Phase 2)

### Verified
- Backend pytest: **14/14 passing** (`/app/backend/tests/test_communities_realms.py`, iteration_24.json) — includes 3 WebSocket cases (`chat:hello` on connect, `message:new` broadcast between two clients, auth/404 close codes).
- Frontend Playwright (live preview URL with localStorage JWT) — 10/11 testids verified; the 11th (member-action-sheet via click) blocked only because the test attempted to click the self-row which is by-design un-clickable; that path is fixed now (self-row no longer carries the `community-member-<username>` testid).
- One real bug found + fixed during test: `POST /api/communities/realms` and `POST /api/communities/groups` previously returned the Motor-mutated insert doc still carrying `_id: ObjectId(...)`, blowing up FastAPI serialization. Fixed via `doc.pop("_id", None)` after insert (matches the rest of the file's `_id: 0` projection pattern).

## Realms/Groups Phase 2 (queued)
- Widget framework (add/remove/resize/reorder/pin/collapse) + Mongo persistence per-community.
- Default Poll widget + Community Hub widget (Events/Photos/Videos/Thoughts/Sounds).
- Left sidebar rebuild: "Your Realms" / "Your Groups" / Discover / Create, with realtime activity + unread badges + favorites + sort.
- Mobile slide-out drawer.

## Realms/Groups Phase 3 (queued)
- Extra widgets (Announcements, Rules, Resources, Links, Q&A, Calendar, Media Gallery, Leaderboard, Top Contributors, Pinned Posts, Stream Placeholder, Upcoming Events, Shared Files, Topic Tags, Member Spotlight).
- Multi-window floating DMs.
- Discover/search + invite links.


## Realm Pulse Analytics + BannerEditor on Realms + R2/S3 Adapter Scaffold (Feb 19, 2026)
### Realm Pulse — founder/investor-grade analytics
- **Heartbeat endpoint** `POST /api/analytics/heartbeat` — any authenticated user, idempotent per-day via the unique compound index on `(user_id, day)` in `user_activity_days`. The frontend hook `useHeartbeat` only fires after 30s of continuous foreground activity and throttles to one ping every 5min via localStorage.
- **Founder-only endpoints** (all under `/api/admin/realm-pulse/...`):
  - `GET /overview?window=7d|30d|90d|custom` — DAU/WAU/MAU + DAU/MAU ratio + retention (D1/D7/D30 cohort-based) + engagement (avg posts/messages/sounds/comments/actions/sessions) + growth (new users, growth rate, invites, viral coefficient) + community totals + top insights.
  - `GET /investor-snapshot?window=30d` — compact `{dau,wau,mau,dau_mau_ratio_pct,user_growth_rate_pct,d30_retention_pct,status}` where status ∈ {Early traction, Strong engagement, High growth, Needs attention}.
  - `GET /export?format=csv|pdf|xlsx` — CSV (utf-8), PDF (reportlab), XLSX (openpyxl). All formats reuse the same `overview()` payload, no PII by construction.
  - `POST /refresh-snapshot?window=…` — force-run the hourly aggregation now (useful for investor demos).
  - `GET /diagnostics` — latest snapshot timestamp + DAU/activity counts.
- **Hourly background job** `_realm_pulse_loop()` in `server.py` writes a snapshot row per built-in window (7d/30d/90d) into `realm_pulse_snapshots`. Dashboard reads the latest row directly; the live DAU is overlaid per-request so the headline counter never goes stale.
- **Active-user definition** (canonical, enforced everywhere): sign-in OR ≥30s feed view OR content creation OR message send OR comment OR react OR media upload. The login endpoint now calls `record_activity()` so DAU starts ticking before the first heartbeat lands.
- **Frontend**:
  - `pages/RealmPulse.jsx` at `/admin/realm-pulse` — Investor Snapshot card with status pill, growth tiles, expandable retention/engagement/growth/community/insights sections (default = collapsed except retention), date window selector (Today/7d/30d/90d/Custom).
  - One-click downloads for CSV/PDF/XLSX, all annotated with a "no PII" footer.
  - `pages/AdminAnalytics.jsx` — new "Realm Pulse" pill (data-testid=`open-realm-pulse`) visible only when `user.username === "stealth"`.
  - `hooks/useHeartbeat.js` wired into Feed, Messages, Sounds, Profile, RealmDetail. Pauses on tab blur/visibility hide; capped at 1 ping per 5min.
- **Mongo collections / indexes added**:
  - `user_activity_days` — `unique(user_id, day)` + `(day)` for window scans.
  - `realm_pulse_snapshots` — `(generated_at, -1)` for latest-snapshot reads.

### BannerEditor on Realms (P2)
- `pages/RealmDetail.jsx` — gated to `user.username === "stealth"` (until the Realms backend exposes per-realm owners). Banner state persisted to `localStorage` keyed by realm id (`ourrealm.realm_banner.<id>`). Reuses the same `BannerEditor` modal + `BannerView` renderer as the profile pages, with drag-to-reposition + scale controls.

### R2/S3 Storage Adapter Scaffold (P1)
- New `services/storage_adapter.py` — `LocalAdapter` (default; identical to current behaviour) + `S3CompatibleAdapter` for both R2 and AWS S3. Selected via `STORAGE_PROVIDER` env var; missing/incomplete credentials transparently fall back to `LocalAdapter` and log a warning so the app never silently degrades.
- `boto3` added to backend `requirements.txt`. No call site changes — flipping providers is a single env tweak + restart.
- Documented env vars in the module docstring: R2 (`R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL`) or S3 (`AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET, S3_PUBLIC_BASE_URL`).

### Verified
- Backend regression suite at `/app/backend/tests/test_realm_pulse.py` — 17/17 passing (`iteration_23.json`).
- Frontend Playwright walk — all required testids present, exports download, non-founder denied, BannerEditor opens on /realms/gaming.
- No PII in any export — confirmed by inspection of CSV / PDF / XLSX bytes.


## Persistent Media Storage + Promote-to-Interest + Copyright Queue UI (Feb 19, 2026)
### Persistent Storage (already landed; verified)
- `services/storage.py` resolves `UPLOADS_ROOT=/data/ourrealm`; `migrate_legacy_uploads()` runs in the startup hook to safely copy any files still under `/app/backend/uploads/<kind>` into the persistent volume without overwriting (uses `shutil.copy2` only when target doesn't exist; leaves source untouched for in-flight requests). Startup log confirms `uploads_root=/data/ourrealm persistent=True`.
- `GET /api/admin/storage/status` (founder-only) reports per-kind directory, file count, total bytes, and env var resolution for deploy verification.

### Promote hashtag → Featured Interest Card (NEW)
- **Backend (`routers/hashtags.py`)** — single source of truth for the `db.interest_cards` collection (`{id, label, source, use_count, is_enabled, is_featured, sort_order, promoted_by, created_at, updated_at}`, `label` unique).
  - `POST /api/hashtags/{tag}/promote-to-interest` — founder/support — idempotent; assigns next `sort_order` on insert, refreshes timestamp/popularity on re-promote.
  - `GET  /api/hashtags/interest-cards` — **public** — sorted by `sort_order` asc then `use_count` desc.
  - `PATCH /api/hashtags/interest-cards/reorder` — founder/support — accepts `{order: [label, …]}` and writes contiguous indices.
  - `DELETE /api/hashtags/interest-cards/{label}` — founder/support — un-promotes; 404 when missing.
  - `GET  /api/hashtags/interest-cards/analytics?window=…` — founder/support — per-card `{users_selecting, post_count, engagement.{likes,comments,total}, growth_posts}` aggregated against `db.users.interests` + `db.posts.hashtags`.
- **Frontend `/admin/hashtags`** (`AdminHashtags.jsx`) — new **Featured Interest Cards** row at top (data-testid `featured-interest-cards`) with per-card metrics + ⬆⬇ reorder + delete. Each hashtag in the catalogue grid now exposes a **Promote** button (data-testid `admin-hashtags-promote-<tag>`); promoted tags switch to a green "Featured" badge instead.
- **Frontend `/interests`** (`Home.jsx`) — fetches `/api/hashtags/interest-cards` and:
  - Adds a `★ Featured` badge to any static interest card whose id matches a promoted hashtag (no duplication, existing card design reused).
  - Renders a new "Featured by OurRealm" section ABOVE Recommended for non-static promoted labels (e.g. `#memes`), using the existing `InterestCard` design with auto-rotated glow colours.
  - **No auto-assign** — promotion never writes to existing users' `interests` arrays; selection stays opt-in.

### Copyright Queue UI (NEW)
- **Frontend `/admin/analytics`** (`AdminAnalytics.jsx`) — added `CopyrightQueueCard` at the bottom (data-testid `copyright-queue-card`). Status filter chips (open/resolved/all), one-click founder-only **Remove / Hide / Keep** actions hitting `POST /api/admin/moderation/{ct}/{id}/action`. Reuses the existing copyright queue backend (`GET /api/admin/moderation/copyright/queue`) and resolution metadata (`resolution_status`, `removed_at`, …) without duplicating moderation state.

### Verified
- Backend: 18/18 pytest suite at `/app/backend/tests/test_promote_interest_cards.py` (iteration_22.json) — covers happy paths, idempotency, public list visibility, reorder semantics, 404 delete, analytics shape, and 403 enforcement for non-admins.
- Frontend: self-test via Playwright (landing → sign in → /admin/hashtags) confirmed `featured-interest-cards` renders, `admin-hashtags-promote-<tag>` promotes successfully (crypto moved into Featured row), `/admin/analytics` shows the `copyright-queue-card` block.
- Persistent storage migration verified via startup log + `/api/admin/storage/status` regression check.


## Landing Page Image-Only Rebrand (Feb 18, 2026)
- `/app/frontend/src/pages/Landing.jsx` fully rewritten. All previous UI removed (4-mode quadrant grid, neon CTA pills, decorative dot grid, mode preview art, welcome headline, trust strip).
- Renders a single full-viewport static artwork (`B1C6C04B-...png`, 9:16 portrait) inside a centered aspect-ratio container using `width: min(100vw, calc(100vh * 9/16))` so the entire image always remains visible without stretching or cropping at any breakpoint.
- Three invisible, transparent `<button>` overlays positioned via percentage coordinates (Sign Up 67.8% · Sign In 77.2% · Browse as Guest 86.6%, each 8% tall × 65% wide centered) exactly over the artwork's pill buttons. Buttons stay perfectly aligned because they're absolutely positioned inside the same aspect-ratio container as the image.
- Preserved routes: `/signup`, `/signin`, and guest → `setGuest(true); navigate("/home")`. Deep-link passthrough (`?to=` / `?next=`) for logged-in users retained. No other pages, auth flows, signup/signin/onboarding/modes/terms touched.
- data-testids: `landing-page`, `landing-image`, `landing-signup-button`, `landing-signin-button`, `landing-guest-button`.

## Phase D — Home ➕ Composer Rebuild (Feb 17, 2026)
### Goals
Remove all placeholder/demo content from the Home ➕ composer; reuse existing upload pipelines for every media type; promote **Sound** to a first-class post type in both the Home ➕ workflow AND the Feed composer; harden audio playback (HTTP Range + iOS Safari load() pattern).

### Backend
- **`models/schemas.py PostCreate`** — new optional fields: `image_urls: List[str]`, `sound_track_id`, `sound_url`, `sound_title`, `sound_cover_url`, `sound_duration`. Backwards-compatible (all optional).
- **`routers/posts.py`** — `create_post` persists the new fields and updates the empty-payload guard to accept posts that have only `image_urls` or only `sound_url`.
- **`routers/sounds.py serve()`** — true HTTP Range support: parses `Range: bytes=…`, returns **206 Partial Content** with `Content-Range`, streams 64 KiB chunks. Fixes iOS Safari scrub-seek and audio buffering hangs.

### Frontend
- **`components/BottomNav.jsx CreateWorkflow`** — REBUILT
  - Image: initial state is `images: []` (no demo Picsum). 6 slots, each clickable. Empty slot opens `ImageUploadPicker`; filled slot opens picker in **replace** mode; trash icon removes. Publish creates a single post with `image_url` (primary) + `image_urls` (album).
  - Sound: waveform tile (`create-sound-launch`) opens `SoundUploadPicker` (the EXACT picker used on `/sounds`). After upload, preview card with HTML5 `<audio controls>`. Publish creates a `media_type='sound'` post with `sound_track_id`/`sound_url`/`sound_title`/etc.
  - Live / Video / Thought workflows unchanged — same existing pipelines.
- **`pages/Feed.jsx`**
  - Composer chips now include **Sound** (`feed-composer-type-sound`) alongside Thought/Image/Video/Link.
  - Tapping Sound opens the SAME `SoundUploadPicker`. Sound preview + clear button.
  - Publish path attaches sound metadata to `POST /api/posts`.
  - `FeedCard` renders image albums as a responsive grid (`feed-image-album-{id}`) and sound posts via the new `SoundPlayerCard`.
- **`components/SoundPlayerCard.jsx`** — NEW. Self-contained `<audio controls>` with cover + title. Module-level WeakSet auto-pauses all other sound cards when one starts playing (only one audio at a time).
- **`components/PostPopup.jsx`** — Parity rendering for image albums + sound posts inside the popup viewer.
- **`lib/audioPlayer.js` (Sounds page singleton)** — Hardened:
  - Forces `audio.load()` after assigning a new `src` (standard iOS Safari fix for "play button flips but audio never starts").
  - `toggle()` trusts live `audio.paused` instead of cached `current.playing` flag — eliminates state desync.

### Verified by testing_agent_v3_fork (iteration_21.json)
- Backend pytest: 10/10 PASS (image_urls persistence, sound_* persistence, empty-payload guard, sound_url-only validity, file serving).
- Frontend live verify: image composer opens with 6 empty slots (zero `<img>` inside slots), all clickable; sound chip + Sound workflow open the canonical `SoundUploadPicker` (no duplicate); ALL 5 Home ➕ launchers (live/video/image/sound/thought) present.
- P2 Range support: FIXED — `Range: bytes=0-1023` now returns `206 Partial Content` with `Content-Range: bytes 0-1023/<total>`.

## Completed Phases

## Phase C — Real-Time Presence + Real Discover (Feb 17, 2026)
### Goals
Replace all fake/AI users on Discover/Featured with real-DB queries. Add a WebSocket-backed presence system with selectable status (live/online/invisible) and the auto-status `messenger`.

### Backend
- **`core/presence.py`** — in-process WebSocket registry `connect`/`disconnect`/`broadcast`/`is_online`.
- **`routers/presence.py`**
  - `WS  /api/ws/presence?token=<jwt>` — auths via query token, sends `presence:hello`, accepts `heartbeat`/`presence:set`/`presence:focus`, broadcasts `presence:update` to friends, marks user offline on last-socket close.
  - `PATCH /api/users/status` — `{status: live|online|invisible}` persists `presence_status_choice`.
  - `GET   /api/presence/me`  → `{status, public_status}`.
  - `GET   /api/presence/friends` — hydrated friend list with current public status, sorted by status priority then last-seen.
  - `GET   /api/users/newest`   — sorted by `created_at DESC`, excludes `@support`, limit clamp 1..60.
  - `GET   /api/users/trending` — sorted by `follower_count DESC` (aggregate `$ifNull` fallback to `len(friends)`), excludes `@support`.
- **`routers/friends.py`** — `/users/featured` excludes `@support`; friend accept syncs `follower_count` on both sides.
- **`routers/auth.py`** — new users seeded with `presence_status='offline'`, `presence_status_choice='online'`, `follower_count=0`.
- **`models/schemas.py serialize_user`** — emits `presence_status`, `presence_status_choice`, `follower_count`.
- **`core/seed.migrate_backfill_presence`** — idempotent boot migration backfills presence fields + recomputes `follower_count` from friends array length.

### Frontend
- **`lib/presenceSocket.js`** — single-connection WebSocket client with 25s heartbeat + exponential-backoff reconnect.
- **`contexts/PresenceContext.jsx`** — provides `{statuses, myStatus, setMyStatus, refreshFriendsPresence}`; auto-connects after login and disconnects on logout.
- **`components/PresenceDot.jsx`** — colors per status: `live=#FF3F5A`, `online=brand-green`, `messenger=#2EA0FF`, `invisible/offline=#5A6378` (hidden by default when offline).
- **`pages/Discover.jsx`** — REBUILT. Two real-user rows: "Trending Creators" (`/api/users/trending`) and "Newest on OurRealm" (`/api/users/newest`); auto "Rising" derived from newest with `follower_count > 0`.
- **`pages/Featured.jsx`** — REBUILT. "Top creators by followers" grid from `/api/users/trending`.
- **`pages/AccountSettings.jsx`** — new **`StatusSelectorCard`** with live/online/invisible options.
- **`pages/Messages.jsx`** — auto-fires `presence:focus messenger=true` on mount and reverts on unmount; `ChatsTab` sorts threads by peer status priority and renders PresenceDot on avatars.
- **`App.js`** — wraps the tree in `<PresenceProvider>`.

### Constraints
- `live` is a SELECTABLE status only — NO live-streaming functionality wired yet.
- `@support` and `@stealth` remain hidden from public discovery lists.
- Presence registry is single-process (in-memory) — works on single pod; multi-pod scale-out would need Redis pub/sub.

## Completed Phases

## Phase B — Support Messaging System (Feb 2026)

### Goals
Native helpdesk riding on the existing MongoDB DM messenger. No new third-party integration.

### Backend
- **`routers/tickets.py`** — endpoints
  - `POST /api/tickets/ensure` (any user): idempotent. If no open ticket exists for the user's @support conversation, create one with status='Submitted' and auto-post a DM from @support → user with the templated submission message.
  - `GET /api/tickets/me` (any user): caller's tickets only, newest first.
  - `GET /api/admin/support/summary` (admin): `{total, Submitted, "In Progress", Completed, Incomplete}` counts.
  - `GET /api/admin/support/tickets?status=` (admin): filterable list, max 500.
  - `POST /api/admin/support/tickets/{id}` (admin): change status and/or subject; status changes auto-post a templated DM from @support into the user's thread.
- **`core/seed.seed_support_account()`** — creates / refreshes the protected `@support` system account (`id="00000000-0000-0000-0000-000000005500"`, `is_protected=true`, `is_system=true`) and auto-friends every existing user.
- **`routers/auth.register`** — auto-friends every new account with `@support` immediately after the founder backfill.
- **`core/deps.is_admin_user / require_admin`** — shared admin gate. **@stealth** (founder), **@support** (system), and any `role==='admin'` user pass. All of `tickets.py`, `moderation.py`, and `phase5.admin_analytics` route through it, so every `/api/admin/*` endpoint is consistently gated.
- **Protected-account guards** — `routers/profile.change_username` and `routers/moderation.take_action(ban|delete)` reject any mutation targeting `is_protected` users (covers @support + @stealth).

### Frontend
- **`pages/Support.jsx` (`/profile/support`)** — user-facing helpdesk: subject input + "Create Support Ticket" CTA → `POST /api/tickets/ensure` → navigates to `/messages?dm=support`. Below: list of the user's tickets with status pills (Submitted / In Progress / Completed / Incomplete) and per-row "Open" button that re-opens the DM.
- **`pages/AdminSupport.jsx` (`/admin/support`)** — admin dashboard with 5 summary stat cards, status filter pills, ticket grid (subject inline edit + status dropdown + "Chat" deep link).
- **`lib/isAdmin.js`** — frontend admin gate mirroring backend (`stealth`, `support`, `role==='admin'`).
- **`pages/Messages.jsx ChatsTab`** — new `?dm=<username>` deep-link handler that opens the existing `DMConversationOverlay` for the given peer.
- **`pages/Profile.jsx`** — new `Support` button (`data-testid='profile-support-link'`) next to "Edit Widgets".

### Audit / Data model
- `db.tickets` — `{id, ticket_number (>=1001), user_id, username, conv_id, subject (≤100), preview, status, assignee_id, created_at, updated_at}`. Status DMs are written into `db.messages` with `moderation_status='approved'` from the @support id.

### Test coverage
- testing_agent_v3_fork iteration_16 — Backend 13/13 PASS · Frontend critical paths PASS (`support-page`, `admin-support-page`, status mutations, subject edit, role-based forbidden, @support full admin access). Report: `/app/test_reports/iteration_16.json`. Pytest suite: `/app/backend/tests/test_phase_b_support.py`.

### What's NOT in Phase B (deferred)
- ~~FAQ editor + storage (Phase 8 — P1).~~ → shipped in **Phase 8** (Feb 2026).
- Per-ticket assignee picker (currently unset).
- ~~Monotonic ticket counter via `db.counters` `$inc`~~ → shipped Feb 2026 (race-free atomic counter; first-call migration seeds seq from `max(existing ticket_number)+1`).

---

## Phase 8 — FAQ + Messages popup polish + tooling (Feb 2026)

### Backend
- **`routers/faq.py`** — `GET /api/faq` (public, published only, sorted by `order_index`), `GET /api/admin/faq` (all incl. drafts), `POST /api/admin/faq`, `PATCH /api/admin/faq/{id}`, `DELETE /api/admin/faq/{id}`. Pydantic validates `question ≤ 200`, `answer ≤ 2000`. Admin gate via shared `core/deps.require_admin`.
- **`db.faq`** — `{id, question, answer, is_published, order_index, created_at, updated_at, created_by}`.
- **Atomic ticket counter** — `routers/tickets._next_ticket_number` now uses `db.counters.find_one_and_update(_id='tickets', $inc seq, ReturnDocument.AFTER)`. Race-free. First-call migration seeds `seq = max(existing ticket_number, 1000) + 1` so historical numbering is preserved.
- **`SUPPORT_PASSWORD` env override** — `core/seed.seed_support_account` reads `os.environ['SUPPORT_PASSWORD']` (fallback `Password1$`) and force-resets the support hash on every boot. Mirrors `STEALTH_INITIAL_PASSWORD`.

### Frontend
- **`pages/AdminFAQ.jsx` (`/admin/faq`)** — admin CRUD with inline edit, up/down reorder, publish toggle, draft badge, create panel.
- **`pages/Support.jsx`** — adds a "Frequently asked" accordion above the create-ticket panel sourced from `GET /api/faq`. Hidden when empty.
- **`pages/AdminSupport.jsx`** — header includes an "FAQ" link to `/admin/faq`.
- **`components/MessageActionMenu.jsx`** — new portal-mounted Edit / Delete / Cancel popup that mirrors `PostManagementMenu` (mobile bottom-sheet + desktop popover anchored to bubble rect).
- **`pages/Messages.jsx DMConversationOverlay`** — tap, long-press (450 ms touch hold), and right-click on own bubbles all open the portal popup. Edit, Delete, and Cancel flows + Delivered/Read status pill preserved. Bubble `user-select:none` on iOS prevents the native callout from intercepting long-press.

### Test coverage
- testing_agent_v3_fork iteration_17 — Backend 11/11 PASS (pytest `/app/backend/tests/test_phase8_faq_counter.py`). Frontend core flows PASS: `support-faq` accordion, `admin-faq-page` for admins, `admin-faq-forbidden` for non-admins, DM popup portal opens with Edit/Delete/Cancel + backdrop on own-bubble tap, `dm-status` Delivered/Read pill renders before and after popup interaction. Two LOW-priority automation-only quirks (opacity enter-animation + repeated SPA-session toggle) — no real bugs. Report: `/app/test_reports/iteration_17.json`.

---

## Phase 4 — Comment likes / replies + Universal Reporting (Feb 2026)

### Comment engagement
- **`db.comments`** gains `liked_by:[uid]`, `likes`, `parent_id` (nullable). Indexed via existing collection.
- **`POST /api/posts/{post_id}/comments/{comment_id}/like`** — toggle, mirrors `/posts/{id}/like` (addToSet/$pull + $inc). Fires a `comment_like` notification on transition to liked (skipped when actor==author).
- **`POST /api/posts/{post_id}/comment`** now accepts optional `parent_id`. Single-level cap enforced server-side: if the parent itself has a `parent_id`, the new reply is re-parented to the grandparent so the tree never deepens beyond 2 rows. `reply` notifications target the parent comment author.
- **`GET /api/posts/{post_id}/comments?viewer=<username>`** returns top-level comments with a `replies:[]` array; hydrates per-viewer `liked` boolean from `liked_by[]` (raw array is hidden).
- **Frontend `PostPopup.jsx`** new `CommentRow` / `CommentBody` components render a heart + count, a Reply button, and a Report flag on every comment AND every reply. Reply composer reuses the 178-char limit. Replies are likeable and reportable (`target_type='reply'`).

### Universal Reporting System
- **`POST /api/reports`** extended: accepts `screenshots: list[str]` (image ids from `/api/images/upload`, capped at 8) and a 500-char `description`. Supports content_type ∈ `{profile, post, comment, reply, image, video, message}`. Reasons union — both legacy scanner reasons and the new 11 user-facing reasons (spam, harassment, hate_speech, sexual_content, self_harm, violence, misinformation, scam_fraud, impersonation, privacy_concern, other).
- Every successful report opens a support ticket (atomic counter), routes it into `/admin/support` with subject `[Report:{Type}] {Reason}`, and posts an `@support → reporter` confirmation DM referencing the ticket number.
- **PRIVACY GATE for `message`** — the only branch that intentionally skips the moderation-status bump on the target collection so admins can never page through the `db.messages` body via the moderation queue. The ticket preview is metadata-only (`reason`, `target_ref`, `screenshot count`) — the message text is never read or copied anywhere in this flow.
- Idempotent — duplicate reports from the same user against the same target return `{duplicate: true, ticket: {id, ticket_number}}` and reuse the original ticket.
- **`GET /api/admin/support/tickets/{id}/report`** (admin) returns `{ticket, report{reason, detail, content_type, content_id, screenshots:[{id,url,thumbnail_url}]}}`. Never fetches `db.messages`. 404 for tickets without a linked report, 403 for non-admin.

### Frontend
- **`components/ReportModal.jsx`** — universal portal modal: 11-reason picker, optional description (500-char), up to 8 screenshot uploads via the existing `ImageUploadPicker`. Submits to `/api/reports` and shows the ticket number toast on success.
- **`components/ReportButton.jsx`** rewritten as a thin wrapper around `ReportModal` (backward-compatible with legacy `contentType` / `contentId` props). New `variant="icon"` for compact placements.
- **Surfaces wired**: profile header (other users only), Feed posts (already), comments + replies (in `PostPopup`), and message bubbles (non-own, footer icon).
- **`pages/AdminSupport.jsx`** — per-ticket "Report" toggle that hits the admin endpoint and renders a privacy-safe details panel: reason, content type, target id, description, screenshot grid. For message reports the panel shows an amber "Privacy: the reported conversation is not visible" banner.

### Misc polish
- **`components/InstallPrompt.jsx`** now also respects a session-level dismiss flag (`sessionStorage 'or.installPromptDismissedSession'`) so the prompt cannot re-appear after a user closes it within the same SPA session (was a low-priority QA quirk in iteration_18).

### Test coverage
- testing_agent_v3_fork iteration_18 — Backend **31/31 PASS** (pytest `/app/backend/tests/test_phase4_reporting.py`). Frontend Feed → ReportModal portal verified live with all 11 reasons + description + 8-shot uploader + submit; admin Report detail panel verified live; admin privacy banner present for `target_type='message'`. Report: `/app/test_reports/iteration_18.json`.

---

## Phase 5 — In-feed video + Share-to-user + Shared-post popup (Feb 2026)

### In-feed video
- **`components/VideoEmbed.jsx`** — universal video renderer. Detects YouTube (`youtube.com`, `youtu.be`, shorts) and Vimeo URLs → renders an inline 16:9 iframe (YouTube via `youtube-nocookie.com` privacy-enhanced; Vimeo via `player.vimeo.com` with `dnt=1`). Direct files (`.mp4/.webm/.ogg/.mov`) fall through to the existing `<AutoplayVideo/>`. Unknown providers degrade to a click-through preview card.
- **IntersectionObserver** controls a `?autoplay=0|1` query swap (iframe remounts via React `key`) so the embed pauses when scrolled out of view *where the provider supports it*. Mobile Safari / providers that block the hint fail gracefully — the user can always tap play.
- **`Feed.jsx`** + **`PostPopup.jsx`** both use `VideoEmbed`. The legacy "Watch video" anchor is removed.

### Share-to-user
- **`components/ShareToUserModal.jsx`** — friend picker (uses `/api/friends/list`), multi-select, sends DMs via `POST /api/messages` with `media={kind:'post_share', post_id}`. The body is metadata-only — never a copy of the post.
- **Backend `routers/messages.MessageMediaPayload`** extended with optional `post_id` (and made `url` optional). `send_message` server-sanitises any `post_share` media so even if a client sets `url` / `preview`, they're stripped — defense-in-depth privacy for `post_share`.
- **Share button wired** on Feed cards (`feed-share-{postid}` → `feed-share-modal-{postid}`), PostPopup (`post-popup-share` → `post-popup-share-modal`). Guests see the button disabled with `title="Sign in to share"` (matches existing Like / Comment guest behavior).

### Shared-post popup
- **`components/SharedPostCard.jsx`** — DM-inline preview rendered when `message.media.kind === 'post_share'`. Fetches the live `/api/posts/{id}` (single source of truth) and on tap opens the canonical `PostPopup` via `openPostPopup`. Renders author chip, content, image/video thumb, and live like/comment counts. Deleted/hidden posts show a friendly placeholder.
- **`PostPopup.jsx` additions**: friend status fetched on every open; header shows one of `friends` pill, `Requested` pill, `Add friend`, `Re-request` (on declined), or `Accept` (on incoming) — all via existing `/api/friends/status`, `/friends/request`, `/friends/accept`. Share button + Report icon in the action row. All like/comment/share state continues to flow through `postStore`, so engagement updates in Feed / Profile / Messages stay consistent automatically.

### Test coverage
- testing_agent_v3_fork iteration_19 — Backend **7/7 PASS** (pytest `/app/backend/tests/test_phase5_share_video.py` — DM payload echo, image/link regression, friends payload shape, video post create/fetch). Frontend Feed YouTube iframe + share modal + guest disabled + DM privacy verified live. PostPopup SharedPostCard click-through verified manually (popup, X close, Share, Friends pill, in-popup iframe all PASS) after pre-setting the install-prompt session flag — the testing agent couldn't reach this flow because the WelcomeChooser at `/` intercepts authenticated deep links (carry-over backlog item).

### Polish
- **`InstallPrompt.jsx`** session-storage gate already shipped in Phase 8; documented here for completeness.
- `ShareToUserModal` success-Sent visible duration bumped to 1500 ms.
- **iOS Safari uploaded-video regression hotfix (Feb 2026)** — `AutoplayVideo` now sets `autoPlay`, `muted`, `playsInline`, `controls`, `preload="metadata"` plus `webkit-playsinline` / `x5-playsinline` directly on the JSX so iOS does not short-circuit playback and render the crossed-out play badge. `VideoEmbed.classifyVideoUrl` strips `?query` / `#fragment` before matching and treats any URL containing `/api/videos/` as a file — uploaded videos can never accidentally route to the iframe branch even with query strings appended.

### Video posts — production hotfix #2 (Feb 2026, post-redeploy)

After the first redeploy, uploaded videos failed on refresh and YouTube embeds rendered black boxes. Root causes + fixes:

1. **VideoUploadPicker was persisting ABSOLUTE URLs** baked from the preview `REACT_APP_BACKEND_URL`. Posts created in preview pointed at `https://realm-deploy.preview.emergentagent.com/api/videos/<id>.mp4`; from production (`ourrealm.social`) those requests went cross-origin and failed. **Fix**: store RELATIVE paths (`/api/videos/<id>.mp4`). The browser resolves against the current origin at render time so the same post document works on both deployments.
2. **One-time migration** `migrate_video_urls_to_relative` in `core/seed.run_startup` strips `https?://<host>` from any `video_url` / `image_url` / `media_url` field starting with `/api/videos/` or `/api/images/`. Verified live: zero absolute URLs remaining post-migration.
3. **VideoEmbed iframe was remounting on every scroll** via `key={id:autoplay}` — YouTube reloaded cold each time, often producing a black box because autoplay was throttled. **Fix**: rendered ONCE with stable `autoplay=1&mute=1` params; the intersection observer is gone for iframes. YouTube/Vimeo native controls (incl. sound) stay accessible.
4. **"Tap for sound" overlay** dismisses itself on first tap so it can NEVER intercept provider controls. No invisible blocker over the iframe.
5. **Embed-failure fallback** — if the iframe doesn't fire `load` within 6 s, or fires `error`, we render "Video failed to load" + an "Open on YouTube/Vimeo" external link button (never a black box). Console-logged for debugging.
6. **Custom mute pill is uploaded-video-only** — only `AutoplayVideo` renders it; the YouTube/Vimeo iframe path doesn't, matching the spec ("don't show a mute pill that can't actually control iframe audio").

### Image lightbox (Feb 2026)
- **`components/ImageLightbox.jsx`** — portal-mounted full-view modal. Dark backdrop, X button top-right, click-outside closes, Escape closes, body scroll locked while open. Aspect ratio preserved via `object-fit: contain`.
- Wired in `Feed.jsx` (clicking the feed image) and `PostPopup.jsx` (clicking the popup image). Profile posts open the same `PostPopup` so they pick up the lightbox transitively. No navigation change — clicking the image keeps the user on the current page.
- Verified live: lightbox opens on image click, Escape closes, backdrop click closes.

**Root causes** of the live-site bug where video posts vanished after Share:

1. **`models/schemas.PostCreate.content`** had `min_length=1` — POSTs with no caption returned 422. The Feed composer silently swallowed the error, the BottomNav composer happily closed the modal because its early-return path ran. **Fix**: `content` is now optional; `routers/posts.create_post` requires either text, a media URL, or a poll (returns a friendly 400 otherwise).
2. **`pages/Feed.jsx submitPost`** early-returned when there was no text or poll, ignoring the uploaded video. **Fix**: also treats a present `composeMediaUrl` as a valid post and surfaces server errors via `alert` + `console.error`.
3. **`components/BottomNav.jsx`** had a UI-only video "dropzone" — clicking it did nothing, so users typed a title, hit Share, and got a post with `media_type='video'` + `video_url=null`. **Fix**: the dropzone is replaced with the existing `<VideoUploadPicker/>` and `submit()` includes `video_url`/`media_url` in the POST body.
4. **`components/VideoUploadPicker.jsx`** returned the relative `/api/videos/<id>.<ext>` URL — broke in any deployment where the frontend origin differs from the backend. **Fix**: `absUrl()` is applied before persisting, so post documents always carry an absolute URL.
5. **`routers/videos.serve`** returned HTTP 200 with the whole file even on `Range:` requests. Mobile Safari REQUIRES HTTP 206 to start playback at all. **Fix**: range-aware streaming endpoint that returns 206 + `Content-Range` for `Range:` requests, 416 for malformed ranges, and 200 + `Accept-Ranges: bytes` for unranged requests, streamed in 1 MB chunks. Verified live: ranged GET → 206; unranged GET → 200; malformed → 416.

### Playback controls overhaul
- **`components/AutoplayVideo.jsx`** rewritten:
  - Native `<video controls>` is OFF by default and revealed for 2.5 s on tap (auto-fade). Re-tap extends the window. Matches the "controls only appear when the user taps the video" spec.
  - Persistent **mute/unmute pill** in the bottom-right corner. Tapping it `stopPropagation`s the reveal logic, calls `video.play().catch(() => {})` on unmute so iOS Safari resumes playback after the gesture.
  - **Error overlay** — on a `<video>` `error` event we hide the broken element and render "Video failed to load" instead of a black box. Console-logs `{src, networkState, readyState, errorCode, errorMessage}` for debugging.
- All four `AutoplayVideo` consumers (Feed, PostPopup, Profile, RealmDetail) pick up the new behavior automatically since the component is the single render path for uploaded videos. YouTube / Vimeo iframe path in `VideoEmbed` is unchanged.

### What's NOT in Phase 5
- ~~WelcomeChooser deep-link passthrough — when the user is authenticated, hitting `/messages/<peer>` directly should bypass the chooser.~~ → shipped Feb 2026.
- Generic OG-preview card for non-YouTube external links (intentionally out of scope per user direction).

### Deep-link passthrough (Feb 2026)
- **`pages/Landing.jsx`** — added `useEffect` that reads `?to=` / `?next=` and `navigate(replace)`s into the requested same-origin path the moment auth finishes loading. Refuses external redirects (`//` and non-`/` paths).
- **`pages/SignIn.jsx`** — accepts `?next=` / `?to=`; on successful password OR OTP login, redirects to that path instead of always `/feed`. Same same-origin guard.
- Live-verified: `/signin?next=/admin/support` → after login lands on `/admin/support`; `/?to=/messages` → after auth load bounces to `/messages` (rendering `OurRealm Messenger`).

---

## Phase 5+ — Moderation Foundation (Phase A, Feb 2026)

### Backend
- **`services/moderation.py`** — rule-based scanner covering threats / self-harm / hate / sexual / bullying / phishing / scam / spam / suspicious URL. Returns a `ModerationDecision { status, reason, score, triggered_reasons, moderated_by }`. Status ladder: `approved` (<0.4) · `pending_review` (0.4–0.79) · `hidden` (≥0.8). LLM fallback interface present but disabled by default — fires only when `MODERATION_LLM_ENABLED=1` AND `EMERGENT_LLM_KEY` is set, only on borderline `pending_review` items.
- **`routers/moderation.py`** — `POST /api/reports` (duplicate-protected, per-user-per-content), `GET /api/admin/moderation/summary | queue | removed | log` (admin-only), `POST /api/admin/moderation/{type}/{id}/action` with actions `approve / hide / restore / delete / ban / acknowledge`. All actions logged to `db.moderation_log` with user/actor/reason/timestamp.
- **`routers/posts.py`** — `create_post` now calls `scan_and_apply` before returning. `_visibility_query` adds a moderation gate so hidden / rejected posts are filtered out for everyone except the author and `@stealth`.
- **`server.py`** — 5-minute background `_moderation_loop` task rescans recently-created `posts` with `pending_review` or no moderation metadata (handles imports + post-creation gaps).

### Frontend
- **`components/ReportButton.jsx`** — viewport-fixed modal with 8 reasons (spam / harassment / hate / sexual / threats / self-harm / scam / other) + optional 500-char detail. Mounted in Feed cards for non-owners.
- **`components/ModerationPanel.jsx`** — analytics cards (Pending review · Auto-hidden · Total reports · Removed today) + pending-review queue with per-row Approve / Hide / Restore / Delete / Ban / Acknowledge buttons + Removed Content drawer at the bottom. All data sourced from the existing `/api/admin/moderation/*` endpoints.
- **`pages/AdminAnalytics.jsx`** — mounts `<ModerationPanel />` below the existing analytics surfaces; vertical scroll preserved (page already used `mb-12` and friend bottom padding).

### Audit / Observability
- `db.moderation_log` records every auto + manual action with `{action, content_type, content_id, user_id, actor_id, reason, meta, created_at}`.
- `db.reports` stores user reports with `{reporter_id, content_type, content_id, reason, detail, status, created_at}`.

### What's NOT in Phase A (deferred to next turn)
- ~~`@support` system account · `/profile/support` page · ticket model + `/admin/support` dashboard~~ → shipped in **Phase B** (Feb 2026).
- FAQ editor (Phase 8 — P1).

---



### Backend (mirrors images.py)
- `services/upload_limits.py` — `LIMITS["video"]` raised to `100 MB / 3 per 24h / 60 s`; counter switched to a dedicated `db.videos` collection so uploads count independently of post creation.
- `services/video_store.py` (NEW) — saves to `/app/backend/uploads/videos/{32hex}.{ext}` and inserts metadata into `db.videos`. Accepts `video/mp4 · video/quicktime · video/webm` (with `.mp4 / .mov / .webm` fallback when browsers send `application/octet-stream`).
- `routers/videos.py` (NEW):
  - `POST /api/videos/upload` — multipart `file` + optional `duration` form field, runs `enforce_pre_upload` (100 MB / per-day) then `enforce_duration` (60 s if client measured).
  - `GET /api/videos/{name}` — public CDN-style streaming with `Cache-Control: public, max-age=31536000, immutable`.
  - `GET /api/videos/me/list` — current user's upload history.
- `server.py` registers `videos_router_mod`.

### Frontend
- `components/VideoUploadPicker.jsx` (NEW) — small picker that:
  - opens the device file picker (`accept="video/mp4,video/quicktime,video/webm"`)
  - probes `HTMLVideoElement.duration` locally, rejects >60 s before upload
  - shows a thumbnail preview (object-URL while uploading, server URL once saved)
  - shows an `onUploadProgress` bar that fills to 100%
  - surfaces 413 / 429 / 400 errors with friendly copy
  - displays remaining daily quota
- `pages/Feed.jsx` mounts the picker **below** the existing Video URL input when `composeMediaType === "video"` — URL field kept as the optional fallback. Both write into the same `composeMediaUrl` state so the existing Share submit path is unchanged.
- `pages/Feed.jsx` FeedCard + `components/PostPopup.jsx` promote relative `/api/videos/*` URLs to absolute via `absoluteImageUrl(...)`.

### Test coverage
- testing_agent_v3_fork iteration_15 — 9/9 new video tests + 13/13 regression PASS · 100% backend · 92% frontend (preview-src nit fixed post-test). Report `/app/test_reports/iteration_15.json`.

---



### Mobile post-action menu — portal refactor
- `components/PostManagementMenu.jsx` now renders the open menu via `createPortal(document.body)` instead of an absolute child of the post card. This removes every parent stacking context that was clipping the menu against the post card.
- Mobile (<640px): `position: fixed; left: 16; right: 16; bottom: calc(88px + env(safe-area-inset-bottom)); max-width: calc(100vw - 32px); max-height: 70vh; overflow-y: auto; overflow-x: hidden; z-index: 9999`. Bottom-aligned above the bottom navigation, never off-screen.
- Desktop (≥640px): a fixed popover anchored via `getBoundingClientRect()` of the toggle button — preserves the previous right-aligned look without using absolute positioning inside the post card.
- Backdrop + Esc + window-resize all close the menu.
- Owner sees 2×2 grid (Public / Friends Only / Custom / Stealth) + Delete in its own destructive section below; `@stealth` on others' posts sees Delete only; non-owners get no toggle. Permission logic unchanged.
- Mobile and desktop child testids are namespaced separately (`tid` vs `${tid}-desktop`) so tests can scope cleanly to one variant.

### Long-text overflow guards
- `pages/Feed.jsx` post content `<p>` now uses `whiteSpace:'pre-wrap'; overflowWrap:'anywhere'; wordBreak:'break-word'; maxWidth:'100%'; minWidth:0;` — long URLs/no-space strings now wrap inside the card.
- `index.css`: extended `.or-wrap` and added overflow safety on every `[data-testid^="feed-post-"]` / `[data-testid^="myfeed-post-"]` (and all descendants) plus global `html, body, #root { max-width:100%; overflow-x:hidden; }`.

### Test coverage
- testing_agent_v3_fork iteration_14 — every spec item PASS at 320 / 360 / 375 / 414 / 768 / 1280. Backdrop always 0/0/full-viewport, menu always `box.left ≥ 0 && box.right ≤ innerWidth`, PATCH/DELETE permission flows intact. Report: `/app/test_reports/iteration_14.json`.

---



### Routing
- **Bottom nav**: `Home` → `/home` (HomeDashboard widgets), `Discover` → `/discover`, `For You` → `/feed` (was previously routing Home → /feed).
- **New signup**: `SignUp.jsx` now routes to `/interests` after registration.
- **Interest picker** is now reachable at both `/interests` (canonical) and `/home/legacy` (back-compat).
- **Feed → Customize Feed** button now routes to `/interests` (was `/home`).
- **Widget save sync**: `HomeDashboard.save()` now uses the server-cleaned response (`PUT /api/dashboard/layout` echoes `widgets`) so local + server state can't diverge — fixes the "widgets no longer customizable after save" symptom.

### Mobile post-management menu
- `components/PostManagementMenu.jsx` now renders as a **centered bottom sheet** under 640px:
  - 2×2 visibility grid (Public / Friends Only / Custom / Stealth)
  - Delete in its own destructive section below, separated by a top divider
  - `max-width: calc(100vw - 32px)`, `max-height: 80vh`, `paddingBottom: env(safe-area-inset-bottom)`
  - Backdrop tap closes (`{tid}-backdrop`)
- Desktop (≥640px) retains the right-anchored popover unchanged.
- Permission gating preserved: owners see grid + Delete; `@stealth` on others' posts sees Delete only; everyone else sees nothing.

### Profile picture upload
- New `components/AvatarPicker.jsx` — modal with two tabs:
  - **Upload Photo** → `POST /api/images/upload` (CDN-rehosted, respects daily limits)
  - **Post Image URL** → `POST /api/images/from-url` (server fetches + rehosts)
- Persists via `PATCH /api/profile/me { avatar_url }` and calls `refreshMe()` so the avatar updates everywhere (posts, comments, friend lists, messages, notifications) via the global user state.
- Profile page (in edit mode) shows a **Camera** overlay if `avatar_url` is set, a **Plus** icon otherwise.

### Test coverage
- Backend 14/14 pytest pass · Frontend 13/13 Playwright assertions pass · zero defects.
- New regression suite: `/app/backend/tests/test_launch_fixes.py`. Report: `/app/test_reports/iteration_13.json`.

---



### Messaging restoration
- **Root cause of missing chats**: `pages/Messages.jsx` `ChatsTab` was querying ONLY the Supabase `chats` table; the 9 historical conversations in MongoDB `db.messages` were invisible.
- **Fix**: `ChatsTab` now calls `GET /api/messages/threads` (MongoDB-backed) for the 1:1 list. New `DMConversationOverlay` component renders the conversation using REST endpoints (`/thread/{username}`, `POST /messages`, `PATCH /messages/{id}`, `DELETE /messages/{id}`, `POST /messages/{id}/read`) — restoring Edit, Delete, Cancel, Delivered, and Read receipts. Polling every 4s flips Delivered → Read without a refresh.
- Groups + Realms continue to use the Supabase `ConversationOverlay`.

### Mobile modal layout
- **Root cause**: Both overlays used `w-full h-[80vh]` + `items-end sm:items-center` + `pb-24`, which clipped under the iOS status bar/home indicator and overflowed horizontally on narrow Android viewports.
- **Fix**: Both overlays now use `width: min(100vw - 24px, 640px)` + `max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px)` with `paddingTop/Bottom: max(12px, env(safe-area-inset-*))` on the backdrop. Verified at 375×800 and 360×780.

### Post management controls (NEW)
- `routers/posts.py`: new `PATCH /api/posts/{id}` (owner-only `visibility` + `custom_user_ids`) and `DELETE /api/posts/{id}` (owner OR `@stealth`). `_normalize_visibility` maps the public `"stealth"` label to the existing stored `"private"` (same owner-only semantic).
- `/api/posts` list endpoint now applies `_visibility_query` directly in the Mongo query — defense-in-depth so private posts never travel over the wire even if a client calls the raw endpoint.
- `components/PostManagementMenu.jsx`: inline action row mounted in Feed cards (`FeedCard` header) and MyFeedWidget rows (top-right). Owner sees `Public / Friends Only / Custom (FriendMultiPicker) / Stealth / Delete`. `@stealth` viewing another user's post sees `Delete` only. Everyone else: nothing rendered.

### Test coverage
- 16/16 backend pytest cases pass (`backend/tests/test_messaging_and_post_mgmt.py`).
- 18/18 frontend UI assertions pass across 3 user roles and mobile + desktop viewports.
- Report: `/app/test_reports/iteration_12.json`.

---



### Part 1 — Mode descriptions refreshed
`/modes` cards now ship the official taglines and body copy for Neon, Business, Millennium, Stealth. Rendered at `data-testid="modes-description-{mode}"`.

### Part 2 — Top 8 quick action + picker search
- Every friend card on `/friends` shows `friend-add-top8-{username}` (or `friend-in-top8-{username}` when already in slots).
- Hitting the cap returns the exact message **"Please remove friend from top 8 to add more"**.
- Picker modals on both `Friends.jsx` (`inner8-picker-search`) and `Top8Editor.jsx` (`top8-picker-search`) now expose a client-side filter on display name + `@username`.

### Part 3 — Role-based post character limits
| Role          | Limit |
|---------------|-------|
| Founder (`@stealth` / `is_founder`) | 2,000 |
| VIP (`is_vip`)                       |   500 |
| Default                              |   300 |

- Backend: `services/post_limits.py` — `character_limit_for(user)`, `enforce_post_content_limit(user, content)`. Wired into `POST /api/posts`.
- Frontend: `lib/postLimits.js` — `getPostCharacterLimit(user)`. Feed composer shows live counter `data-testid="feed-composer-charcount"` and disables `feed-composer-submit` when over.
- `PostCreate.content` Pydantic `max_length=2000` is the absolute hard ceiling (= founder cap); a comment in `schemas.py` notes the cross-file dependency.

### Part 0 — Polish
- **A** (core social polish) – no functional regressions; `refreshMe()` is called after Top-8 mutation so the Friends UI updates without a manual reload.
- **B** (Top 8 + widget persistence) – preserved; `inner_8` and `dashboard.widgets` still persist via existing endpoints.
- **C** (mode visual enhancements, CSS-only) – additive keyframes appended to `index.css`:
  - Neon: `neon-glow-pulse` on `.or-surface` + `neon-particle-drift` on the existing star field.
  - Business: `biz-sheen-pulse` on `.or-surface`.
  - Millennium: `millen-chrome-shine` on `.or-btn::before` + body-level `millen-star-twinkle` overlay (pointer-events: none).
  - Stealth: `stealth-pulse-ring` on `.or-btn::after`.
  - `prefers-reduced-motion` disables all animations.
- **D** (drag-to-resize widgets) – `HomeDashboard.jsx` SE-corner handle (`widget-{id}-resize`) uses pointer events + `SIZE_DIM` table to cycle through `sm → md → lg → xl`, persisted via existing `PUT /api/dashboard/layout`. `lg`/`xl` widgets get `gridColumn: span 2`.

## Phase 5 — Media Upload Limits (already shipped earlier this session)
- Server caps via `services/upload_limits.py` (3 MB / 20 per day for images, 5 MB / 10 / 60 s for audio, 10 MB / 3 / 30 s for video) with `@stealth` exempt.
- `GET /api/upload-limits/me` exposed and consumed by ImageUploadPicker + SoundUploadPicker.

## ⚠️ Backlog
1. Real weather + news API integration for dashboard widgets.
2. Advanced message status (Sent/Delivered/Read) — Supabase messenger.
3. Group/Realm member directory UI enhancements.
4. Real Wallet integration (currently mocked).
5. Dedicated "Manage Top 8" button on `/friends` for picker discoverability (suggested by tester).

## Test Credentials
See `/app/memory/test_credentials.md`. Note: `core/seed.py` backfills `is_vip=true` for all pre-existing users on every boot, so freshly-registered accounts are the only path to exercise the pure 300 default cap end-to-end.

---
*Last updated: Feb 2026 — Phase 5 shipped: VideoEmbed (YouTube/Vimeo inline iframe + IntersectionObserver pause), Share-to-user (DM with metadata-only post_share, server-sanitised), SharedPostCard inline DM preview that opens the canonical PostPopup, PostPopup friend-request CTA + Share. Backend 7/7 PASS; frontend Feed flow PASS via test agent and PostPopup SharedPostCard click-through verified manually. Carries forward Phase 4 reporting + Phase 8 FAQ + Phase B Support + Phase A Moderation + Phase 5+ Parts 0/1/2/3.*

---

# June 2026 — Production Data Audit & Repair (Data Health Suite)

## Problem
Production (ourrealm.social) had: missing profile pictures after DB recovery, videos failing to play, real-user signup errors, mock/demo posts in For You that couldn't be deleted, and admin metrics inflated by test/seed accounts.

## Root causes found
1. **Undeletable For You posts**: `Feed.jsx` merged 24 hardcoded `makeMockPosts()` client-side; RealmDetail/Home/Notifications also rendered mock characters (LunaX, Jaxon, Nova, …). Not DB rows — hence undeletable. REMOVED entirely; polished empty states added.
2. **Video failures**: (a) `video_store.save_video` mirrored to R2 but discarded the returned `/api/media/videos/...` proxy URL (checked `startswith("http")`), storing ephemeral local paths that die on redeploy; (b) iPhone MOV containers don't play in Chrome/Android. FIXED: proxy URL now persisted; MOV uploads remuxed server-side to MP4 (`imageio-ffmpeg`, `-c copy +faststart`) or rejected with a helpful message.
3. **Signup errors**: raw Pydantic 422s surfaced as vague errors; duplicate-race unhandled; partial signups could linger. FIXED: friendly field-specific messages (register 422 handler in server.py), duplicate email/username/race messages, full rollback on post-insert failure, `signup_events` telemetry (redacted: domain + hash only).
4. **Inflated metrics**: `count_documents({})` counted @support, neutralised legacy admin, and test accounts. FIXED: `core/analytics_filters.real_member_filter()` — canonical definition of a real member — applied to `/api/admin/analytics` (total/new/DAU/MAU).
5. **Seed fixtures**: `community_seed.seed_realms` ran on every boot with fake member counts (18k/32k). NOW gated behind `ENABLE_DEMO_SEEDS=true` (default OFF everywhere); legacy fake-count fields `$unset` from realm docs on startup; realm APIs already derive real counts from `community_memberships`.

## New: Founder-only Data Health & Audit suite
- Backend: `/app/backend/routers/admin_data_audit.py` → `/api/admin/data-health/*` (all `require_founder`):
  - `GET /identity` — env label (preview/production), DB name/host, R2 bucket, collection counts, real member count, founder presence check.
  - `GET /media-audit` + `POST /media-repair {dry_run}` — classifies stored avatar/banner/post media values (proxy | expired_presigned | legacy_r2_public | absolute_host | legacy_local | external | missing), checks R2 object existence, rewrites only provably-broken values to `/api/media/<kind>/<name>`.
  - `GET /synthetic-scan` — classifier: system_required (stealth/support), confirmed_synthetic (explicit flags, example.com/test.com domains, legacy admin), likely_synthetic (name patterns → NEVER auto-deleted, founder review required), real. Per-user linked counts across 12 collections.
  - `POST /review {user_id, decision: real|synthetic|clear}` — founder overrides stored in `synthetic_review`.
  - `POST /cleanup/dry-run` — exact proposed deletion totals by collection; rejects non-confirmed accounts.
  - `POST /cleanup/execute {confirm: "DELETE CONFIRMED SYNTHETIC DATA"}` — cascade delete (posts, comments, reactions, messages, community msgs/memberships, notifications, media records, badges, tickets, tokens, graph refs pulled) + R2 object deletion ONLY when no retained record references the object (one-pass retained-names check) + `cleanup_audit` record. Refuses system/real/likely accounts.
  - `GET /signup-health`, `POST /backfill-eligibility` (stamps account_type/is_synthetic/analytics_eligible/signup_completed), `GET /orphans`, `GET /cleanup/audit`.
- Frontend: `/app/frontend/src/pages/AdminDataHealth.jsx` at `/admin/data-health` (AdminHub card added). Tabs: Overview / Media Audit / Synthetic Accounts (dry-run → confirm-phrase execute) / Signup Health / Orphans / Audit Log. Environment badge (PREVIEW/PRODUCTION).
- New user docs get `account_type=human, is_synthetic=false, analytics_eligible=true, signup_completed=true, email_verified=false` at register.

## Production runbook (founder, after Replace Deployment)
1. `/admin/data-health` → Overview: verify PRODUCTION label, correct DB, bucket `ourrealm-media`, founder present. **Back up DB before any cleanup.**
2. Media Audit → Run → Repair dry-run → Apply Repairs (only rewrites provably-broken URLs).
3. Synthetic Accounts → Run Scan → review likely_synthetic rows (mark real/synthetic) → select confirmed rows → Dry-run → type confirm phrase → Execute (in small batches; large accounts with many media objects can take ~60s).
4. Overview → Run Backfill (analytics eligibility) → verify Total Members on /admin/analytics.
5. Signup Health tab monitors registrations going forward.

## Testing
- `/app/test_reports/iteration_72.json` — 100% pass (21/21 backend pytest incl. live one-account cleanup + audit row; all frontend flows: no-mock feed/realms/notifications, admin console, friendly signup errors). Regression suite: `/app/backend/tests/test_iter72_data_health.py`.
- Deployment agent: PASS (June 2026).

## Notes / deferred
- Wallet/Marketplace pages still use placeholder feature-demo data (non-social, flagged to user).
- `TRENDING_TRACKS` emptied — Sounds/Music show real tracks only.
- tfone test account deleted during cleanup verification (see test_credentials.md).
- Future: background job queue for very large cleanup batches; JWT_SECRET rotation + CORS scoping on production env (user-action items).

---

# June 2026 — UI, Social, Widgets & Feed Repairs (Iteration 73)

## 1+2. Professional image cropper (banner + avatar)
- New shared `ImageCropperModal.jsx` on `react-easy-crop@5.5.6` (locked): wheel zoom, pinch-to-zoom, touch drag, zoom buttons + slider, reset/cancel/apply, aspect-locked crop box.
- `lib/cropImage.js` bakes the crop via canvas (high-quality smoothing, capped output: banner 2560px / avatar 1024px) → uploaded through existing `/api/images/upload` R2 pipeline → durable `/api/media/...` URLs only (never blobs).
- `BannerEditor.jsx`: 4:1 crop; legacy banners keep offset/scale rendering via untouched `BannerView`. GIFs bypass cropping (animation preserved).
- `AvatarPicker.jsx`: square stage + circular crop; URL tab rehosts via `/images/from-url` then crops the local same-origin copy (no canvas taint). Cropped avatar renders everywhere plain `<img>` is used.

## 3. Relationship audit & repair
- `GET /api/admin/data-health/relationships` — per-user stored vs recalculated follower_count, dangling refs, synthetic refs, asymmetric friendships with evidence-based proposals (restore_reciprocal only with DM history + no pending request; otherwise remove_one_way; each with reason).
- `POST /relationships/repair` (confirm `REPAIR RELATIONSHIPS`) — strips dangling refs from friends/requests/inner_8, applies proposals, resyncs ALL follower_counts, audit-logged. Executed on preview: 14 dangling removed, 6 one-way removed, 8 counts resynced → graph clean.
- Cleanup engine now resyncs follower_count of affected users after synthetic-account deletion.
- New Relationships tab in `/admin/data-health`.

## 4. Realm widgets blank-render fix
- ROOT CAUSES: (a) picker posted registry UUID as widget `type` (unrenderable), (b) built-in library types had no realm renderer — generic CustomWidgetRenderer expected editor_config → blank cards.
- Fixes: picker sends `item.key`; backend `_resolve_widget_type` maps UUIDs→keys and `polls`→`poll`; `GET /widgets/available?placement=realm` only offers renderable types (REALM_SUPPORTED_TYPES + custom widgets with editor_config).
- New `RealmBuiltinWidget.jsx`: announcements/rules/notes (admin inline edit), countdown (live timer + setup card), calendar (real month), top8 (real members), events (admin-managed list); custom registry widgets hydrate editor_config; unsupported legacy types render a labelled card with Remove button — NEVER blank. Loading states included.
- Founder migration `GET/POST /api/admin/data-health/realm-widgets/*` (confirm `NORMALIZE WIDGETS`) fixes legacy saved UUID/alias types.

## 5. Poll / Thought separation
- ROOT CAUSE: composer saved polls as `media_type="thought"` + poll object; backend filter matched literal media_type.
- Fixes: `create_post` forces `media_type="poll"` when a poll is attached; `?media_type=poll` matches by attached poll (covers legacy rows); `?media_type=thought` excludes polls; Feed.jsx client multi-filter mirrors the rules.
- Founder migration `GET/POST /api/admin/data-health/poll-migration/*` (confirm `MIGRATE POLLS`) reclassifies legacy mis-typed polls — only media_type changes (votes/comments/reactions/timestamps preserved). Preview: 0 affected.
- New Migrations tab in `/admin/data-health`.

## Testing
- `/app/backend/tests/test_iter73_updates.py` — 13/13 pass (poll separation, widget normalization, available-filtering, migrations guards, relationships shape/auth).
- `/app/test_reports/iteration_73.json` — 100% backend + 100% frontend (poll composer→filter→vote, avatar & banner crop persist after refresh, realm widget picker/setup cards/unsupported card, admin tabs, friends counts match).
- Deleted 3 preview-only `testu*` fixture posts referencing example.com/v.mp4 (console noise).

## Production runbook additions (after Replace Deployment)
1. `/admin/data-health` → Migrations: Poll dry-run → review → `MIGRATE POLLS`; Widget dry-run → review → `NORMALIZE WIDGETS`.
2. Relationships: Run audit → review every proposed action + reason → `REPAIR RELATIONSHIPS`.

---

# July 2026 — Website Media (Founder-Only) — Iteration 74

## Feature
`/admin/WebsiteMedia` (+ Admin Hub card, roles=["founder"], STEALTH ONLY badge). Two sections:
1. **Logos & Wordmarks** — per-mode branding (13 modes: neon, jungle, aquaria, terra_vetus, cyber, retro, ancient_egypt, alien, adventure, business, social, millennium, stealth; extensible via MODES list in `routers/website_media.py`). Upload → shared cropper (logo 1:1 / wordmark 5:1, PNG/JPG/WebP ≤5MB) → draft → preview nav mock → Publish (validated, atomic per-mode, previous version kept) → Discard / Rollback. Filters + search.
2. **New User Tutorial Builder** — image/video slides (R2 pipelines, image ≤10MB, video ≤100MB w/ MOV remux), title/description/alt/button (next|finish|route-validated|none), autoplay/loop/muted/controls, enable/disable, up/down reorder (persists), duplicate, delete, settings (name/status/audience/delay/skip/close/progress), Save Draft / Preview (founder-only TutorialPopup preview mode) / Publish (versioned snapshots in `tutorial_versions`, confirm modal w/ counts + "show to everyone") / Rollback / Delete Draft (typed phrase).

## Live behavior
- `Logo.jsx` now dynamic: reads `GET /api/website-media/published` (module cache + version cache-busting, invalidated on publish) for the active theme mode. Fallback: mode asset → neon published → hardcoded master logo. Never a broken image. Wordmark renders beside icon only when configured.
- `TutorialPopup.jsx` mounted in Layout: fetches `/api/tutorial/active` (server decides eligibility by audience + version + server-side completion), swipe/keyboard/dots/skip/finish, videos pause on slide change, progress via `/api/tutorial/progress/{start,update,complete,skip}` (unique per user/version). localStorage only a perf hint.

## Data & API
- Collections: `website_media_modes`, `tutorials` (id "main", draft_slides embedded), `tutorial_versions`, `user_tutorial_progress` (unique index user+tutorial+version), `admin_audit_logs` (all founder actions).
- Endpoints in `routers/website_media.py`: admin (require_founder): GET /api/admin/website-media, PATCH /modes/{key}, POST /publish /discard-draft /rollback; GET/PATCH /api/admin/tutorial, slides POST/PATCH/DELETE/duplicate/reorder, POST /tutorial/publish /rollback, DELETE /tutorial/draft. Public: GET /api/website-media/published (cached), GET /api/tutorial/active, POST /api/tutorial/progress/*.
- Durable-URL enforcement server-side (rejects blob:/data:), safe internal route validation for slide buttons.
- Startup seed `ensure_website_media_seed()` (idempotent, seeds current logo as Neon published; never overwrites).

## Testing
- Backend: `/app/backend/tests/test_website_media.py` 6/6 (401/403 gating, durable upload, draft≠published, publish/rollback, tutorial CRUD/reorder/publish/version/progress-unique/completed-hidden, unsafe route rejection).
- `/app/test_reports/iteration_74.json`: 100% backend (19/19 incl. iter73 regression) + 100% frontend (card visibility both roles, upload→crop→draft→publish→rollback, tutorial build/reorder-persist/preview/publish, popup shows for normal user → finish → never re-shows, header logo regression).
- Final preview state: tutorial status=published audience=new_users (hidden from existing users), no mode drafts pending.

---

# July 2026 — Transparent PNG Fix (Website Media logo pipeline)

## Root cause
`lib/cropImage.js` exported crops as `image/jpeg` by default — JPEG has no alpha channel, so transparent pixels flattened to black. Secondary: backend thumbnails converted RGBA→RGB (black fill).

## Fixes
- `cropImage.js`: canvas `getContext("2d", {alpha:true})` + `clearRect` (no background fill), honors `mime` option.
- `ImageCropperModal.jsx`: new `outputMime` prop (default jpeg unchanged).
- `AdminWebsiteMedia.jsx`: logo + wordmark crops always export `image/png`.
- `AvatarPicker.jsx` / `BannerEditor.jsx`: PNG/WebP sources export PNG (photos stay JPEG); upload filenames match type.
- `services/image_store.py`: thumbnails of alpha images now saved as PNG (JPEG kept for opaque sources; GIF preserved). R2 already stores `.png` with `image/png` content type.

## Validation (all passed)
- API roundtrip: uploaded RGBA PNG → downloaded via R2 proxy → mode RGBA, corner alpha 0, content-type image/png; thumbnail also RGBA PNG.
- Real UI E2E: Website Media → Replace Logo (Retro) → cropper → Apply → draft stored `/api/media/images/*.png`, RGBA, corner alpha 0, center 255; thumbnail rendered transparent on the dark card. Draft discarded after test.
- Regression: `test_website_media.py` + `test_upload_limits.py` 18 passed / 1 skipped; frontend build clean. (Also repaired `test_upload_limits.py` fixture that referenced the deleted `tfone` test account → now uses `auditcheckreal`.)

---

# June/July 2026 — Iteration 75: Nine-Point Update (Composers, FAQ, ORAi rebrand, Modes colors)

## Shipped (all tested — /app/test_reports/iteration_75.json, 100% backend + frontend)
1. **No auto "Image" text**: `BottomNav.jsx` CreateWorkflow no longer injects `option.label` when title/caption empty — media-only posts publish with empty content (backend already allowed it). Titles now "optional".
2. **Hashtags in every composer**: new shared `components/composer/HashtagInput.jsx` (chips input, max 10, `appendHashtags()` appends `#tags` to content on submit → existing backend indexing + clickable `HashtagText` work unchanged). Wired into Feed inline composer AND all 5 "+" workflows.
3. **Tutorial popup resized**: `TutorialPopup.jsx` now a centered modal with visible margins on ALL screens (width min(100vw-32px,560px), height min(100dvh-40px-safe-area,680px)), lighter backdrop — site visible behind on desktop and mobile.
4. **Unified composers**: shared `components/composer/AlbumPicker.jsx` (6-slot album grid) used by BOTH the For You inline composer (now supports multi-image albums, previously single) and the "+" modal. "+" workflows also gained AudiencePicker parity.
5. **Multi-image upload fix**: `ImageUploadPicker.jsx` rewritten — `multiple`/`maxCount` props, sequential uploads with progress ("Uploading 2 of 4…"), and new `lib/imageCompress.js` client-side compression (≤2048px, ≤2.5MB, preserves PNG alpha, GIF passthrough) so >3MB phone photos no longer 413 at the proxy/backend.
6. **Settings button position fix**: root cause = `html[data-mode="millennium|stealth"] .or-btn { position: relative }` overrode Tailwind `.absolute`. Fixed with `.or-btn:not(.absolute)` in `index.css`. Verified top-right in Millennium + Stealth.
7. **UI Color Customization**: `components/ColorCustomizer.jsx` on /modes — primary + secondary accent pickers (native color input + 10 presets + hex display + reset). `ThemeContext.jsx` applies per-mode overrides as inline CSS vars on documentElement; persisted in localStorage `ourrealm.customColors` per mode.
8. **Public FAQ**: new `/faq` page (`pages/FAQPage.jsx`, accordion + search + Contact Support + founder Manage link). Links added in Settings (Help section + About footer) and LegalPages "Other policies" footer. Seeded 10 starter FAQs via `backend/scripts/seed_faq_entries.py` (idempotent); admin CRUD at /admin/faq already existed. 11 published entries live.
9. **ORAi rebrand**: all user-facing "Orion"/"ORION" → "ORAi" (AdminOrion.jsx, AdminHub.jsx, AdminOrionLogs.jsx, ChatLayout.jsx, backend chat_conversations.py system prompt + error details, widget name "ORAi (Founder)", model label "orai-analytics"). Internal identifiers (routes /admin/orion, ORION_WIDGET_KEY, orion-* CSS, api paths) intentionally unchanged. NEVER use "OurReam", "ORAI", "Orion".

## Backlog / next
- P1: Rotate production `JWT_SECRET` (shared with preview) + scope production `CORS_ORIGINS` (currently `*`).
- P2: Optional server-side persistence of custom mode colors (currently per-device localStorage).
- P2: Consider renaming internal orion_* modules/routes if ever safe (needs migration; low value).

---

# July 2026 — Profile Level & Progression System (Iterations 76)
Full spec implemented across 4 phases. See /app/memory/CHANGELOG.md ("Progression System") for the complete completion report, architecture, collections, API routes, flags, backfill results, and known limitations.
Key state: seeded Newbie(3 tasks) + Explorer(5 tasks) published v1; 8 feature flags in db.progression_flags (preview: display/claims/calculations/builder ON; events/notifications/rewards-gate/analytics configurable); preview backfill completed (91 real users, 0 failures). PRODUCTION: deploy code → flags default OFF → founder runs Dry Run + backfill from /admin/level-builder Jobs tab → enable flags.

---

# July 2026 — Iteration 77: Leaderboards + Profile Progression Parity (COMPLETE, tested 100%)

## Shipped (test report: /app/test_reports/iteration_77.json — 12/12 backend, 10/10 frontend)
1. **Leaderboards backend** (`routers/leaderboards.py`): GET /api/leaderboards — 10 categories (reputation, level, achievements, posts, likes, comments, followers, realms, weekly_activity, alltime_activity) × 4 periods (all/month/week/today) × 3 audiences (global/friends/realm), search, pagination, cached snapshots (db.leaderboard_cache, default 300s). Real members only: excludes synthetic, null-username, purged/deleted accounts. GET /api/leaderboards/me = private rank summary.
2. **Public /leaderboards page** (`pages/Leaderboards.jsx`): category/period/audience chips, my-rank banner, top-3 highlight, search, pagination, row tap → user profile. Mobile + desktop verified.
3. **Profile parity**: ProgressCard + ProgressionBadges + VIEW LEADERBOARDS button render in BOTH edit and view mode on /profile, and on public profiles (FounderProfile.jsx). Badge tap → detail panel; level badge tap → scrolls to progress card.
4. **ProgressionBadges** (`components/progression/ProgressionBadges.jsx`): earned/current/locked ladder badges, reputation + global-rank summary (owner), View Leaderboards button beneath.
5. **Founder Leaderboard Settings** (`/admin/leaderboards`, `pages/AdminLeaderboardSettings.jsx` + admin endpoints): enable/disable categories (stable order), friends/realm boards, top-3 highlight, cache seconds (30–86400 clamp), tie-breaker (reputation|alphabetical, cache auto-invalidated on change), hidden users (public-exclusion ONLY — progression/reputation/rewards kept, private rank preserved via me.hidden=true, reversible), Clear cache. All changes audited in db.progression_audit_logs. AdminHub card added.
6. **Founder policy**: founder appears on public boards by default; any account (incl. founder) can be hidden via settings.

## Production rollout (user must click Deploy)
1. Deploy to production. 2. Log in as founder → /admin/level-builder → Jobs tab → run Dry Run, then backfill. 3. Enable progression flags (display/claims/calculations). 4. Visit /admin/leaderboards → verify settings; POST refresh clears cache. Leaderboards need no backfill — computed live from existing data.

## Backlog
- P1: Rotate production JWT_SECRET + scope CORS_ORIGINS (currently *).
- P1: Task-accuracy audit (self-likes, deleted posts, synthetic actors in progression counters).
- P2: Leaderboard growth cliff: _compute_rows caps at 5000 users; Pydantic schema for settings PATCH.
- P3: show_movement (rank delta arrows) setting exists but UI not implemented.

---

# July 2026 — Iteration 78: Production Activation Workflow (Option C — founder-driven, no credential sharing)

## Root cause of "production shows old profile" (VERIFIED, not guessed)
- Production ourrealm.social HAS the latest code: bundle main.dfdaaab7.js contains progression-badges/view-leaderboards-button/admin-leaderboard-settings; /api/leaderboards + /api/progression/* return 401 (exists) not 404.
- Cache/SW healthy: index.html no-store, hashed assets immutable, network-first SW with skipWaiting. NOT a cache issue.
- Actual cause: production DATABASE (separate from preview by design) has progression flags OFF (default), no seeded levels, no backfill. display=false → /api/progression/me returns enabled:false → UI hides → "old profile".
- Production login for stealth uses a DIFFERENT password than preview (1 login attempt made, rejected, no retries). NEVER ask for or store the production password (user directive).

## Shipped (self-tested in preview + fresh-DB simulation)
1. `seed.py`: `LAUNCH_LADDER` (full founder-approved 8-level spec incl. tasks + rewards + reputation 100→5000), `seed_launch_ladder()` (idempotent by level NAME — existing levels never touched), `ensure_progression_indexes()` (8 backward-compatible indexes).
2. `progression_admin.py`: `POST /api/admin/progression/seed-launch` (founder-only, requires {"confirm":true}, audited, returns created/existed/indexes) + `GET /api/admin/progression/activation` (13-step checklist status: levels, indexes, last dry-run/backfill jobs, reconciliation eligible-vs-tracked, flags, leaderboard readiness).
3. Flags gate: PATCH /flags now REJECTS enabling claims or rewards until a completed non-dry-run backfill job exists.
4. `components/admin/ActivationChecklist.jsx` + "Activation" tab in /admin/level-builder: guided 13 steps — Seed → Dry Run → Review → Backfill (RECALCULATE ALL phrase) → Reconcile → Inspect @stealth → enable calculations/display/events/notifications/claims/rewards in order → Verify leaderboards. Job polling every 3s.

## Test evidence
- Fresh-DB simulation (scratch db, dropped after): created 8 published levels/38 tasks/8 versions/1 starting level, correct rep ladder, 2nd run created 0.
- Preview: seed-launch without confirm → 400; with confirm → existed:8 created:0. Activation tab renders all 13 steps, inspect @stealth works (Rising Star 3/5), leaderboard verify shows 77 ranked.

## PRODUCTION RUNBOOK (user executes after redeploy)
Route: https://ourrealm.social/admin/level-builder → "Activation" tab. Click steps 1→13 in order. builder+calculations flags default ON so the page is reachable. Claims/rewards blocked until backfill succeeds.

## Backlog (unchanged, deferred per user)
- P1 JWT_SECRET rotation + CORS scoping; P1 task-accuracy audit; P2/P3 as before. NO new feature work until production activation verified by user.

---

# July 2026 — Iteration 78-79: Production Progression Bug-Fix Pass + Responsive Audit (COMPLETE, 100% tested)

## User confirmed production activation succeeded (47 eligible = 47 tracked, 0 failures, all flags ON).

## Bug 1 — Progress Card accordion (FIXED)
ProgressCard.jsx: header is now a full-width ≥44px button with aria-expanded; whole row tappable; chevron down=collapsed/up=expanded; collapsed shows header+count+progress bar only; expanded state persists across remounts via module-level `expandedMemory` Map keyed by username; after successful claim card re-expands showing the new level.

## Bug 2 — Black screen on claim (ROOT CAUSE + FIX)
Root cause: nested backdrop-filters — the CelebrationModal backdrop was rgba(0,0,0,0.7)+blur(8px) and the inner card used .or-surface which in neon mode is rgba(15,35,60,0.55) glass with its OWN blur(18px). Stacked backdrop-filters inside a dimmed fixed overlay render near-black on iOS Safari (known WebKit issue), making the modal invisible → page looked black + "stuck" (tapping the invisible card hit stopPropagation).
Fix: backdrop rgba(0,0,0,0.45) with NO blur; new `.or-modal-card` CSS (index.css) = opaque layered background (#0d1626 base) + `backdrop-filter:none !important`; Escape-to-close; claimingRef double-submit guard; celebration only if response.completed_level; refetch failure ≠ claim failure; finally-block cleanup. Verified via getComputedStyle in tests: card bg rgb(13,22,38) opaque, no filters.

## Bug 3 — Stale leaderboards after claim (ROOT CAUSE + FIX)
Root cause: leaderboard_cache has 300s TTL and claims never invalidated it; frontend rank fetched only on mount.
Fix: engine.py claim_level() now `db.leaderboard_cache.delete_many({})` after successful non-idempotent claim; ProgressCard dispatches `or-progression-claimed` CustomEvent; ProgressionBadges listens → refetches ladder+summary+/leaderboards/me. Profile rank and leaderboard page both read the same _cached_rows source (canonical). Founder repair action already exists: POST /api/admin/leaderboards/refresh (idempotent, audited).

## Task 4 — Responsive audit (CERTIFIED)
ProgressionBadges: CSS grid `repeat(auto-fill, minmax(min(104px,100%),1fr))`, equal-height 76px cards, all 8 badges always visible, states distinct. TaskRow: flex-wrap + min-w-[180px] + break-words; action chips wrap below text at narrow widths. Layout global bottom padding calc(110px + safe-area) verified clearing bottom nav everywhere.
Certified at 18 viewports 320x568→2560x1440: 0px horizontal overflow, min badge width ≥105px, columns 2@320→3@390→4@600→6-7@768-834→8@≥1024; zoom 150%/200% pass; long content pass; celebration modal fits at 320 and 1920. LIMITATION: test tooling is chromium-only (webkit/firefox engines unavailable); CSS techniques used are standard and safe cross-engine.

## Tests
- Backend: 10/10 test_progression_claim_flow.py (claim advance-one-level, idempotent replay no duplicates, cache invalidation, rank consistency, stealth untouched) + 12/12 test_leaderboards.py regression = 22/22.
- Frontend E2E: iteration_78 (claim flow, no black screen, live rank update) + iteration_79 (10-viewport matrix, accordion, wraps, zoom) = all pass. Screenshots in /app/test_reports/iter79_*.png.
- Preview throwaway QA user: clmc8069d / Password1$ (Explorer, 100 rep) left in preview DB intentionally.

## Deploy note: user must click Deploy to push these fixes to ourrealm.social.

## Iteration 79b — Unified Progression Accordion (Task 5, verified)
- New shared `components/progression/CollapsibleHeader.jsx`: `CollapsibleHeader` (identical typography/height/padding/arrow rotation/a11y) + `useAccordionState(key)` hook (module-level Map persistence).
- ProgressCard refactored to use it (no lookalike duplication); ProgressionBadges now uses the SAME component — header matches Progress card exactly (computed styles verified: 14px/600/same color/44px), whole row tappable, aria-expanded, ChevronDown rotates 180°.
- Collapsed badges section hides grid + reputation + weekly + rank + View Leaderboards with zero residual height (78px section = padding+header); state persists across profile Save rerenders (keys progress:${username} / badges:${username}).
- Testids: progression-badges-header/-title/-toggle. Needs user redeploy to reach production.

## Iteration 79c — Progression accordions default COLLAPSED (Task 6, verified)
- useAccordionState: no persistence (no Map/storage); default false; resets on key change (viewed username) and on remount. Manual toggles survive ordinary rerenders only.
- ProgressCard: single CollapsibleHeader for owner AND non-owner (public profiles now toggleable too); body gated by expanded only; claim success sets expanded=false (new level stays collapsed per spec).
- ProgressionBadges default collapsed (title + arrow only when closed).
- Verified E2E: own profile / refresh / other user / return-to-first all open collapsed; manual expand works; collapsed shows name+count+bar+arrow only. Needs redeploy to reach production.

## Iteration 80 — Premium Badge Artwork System (Tasks 7-9, verified, 22/22 regression pass)
- CANONICAL BADGE SET: 8 premium shield/crest artworks (user-approved v2 renders), consistency-processed via scripts/process_badge_set.py: radial medallion detection, true alpha (unmult), identical 1024px canvas + 760px shield diameter + centering, connectivity filter (kills bokeh), tiered glow 1.00→1.40, PNG+WebP export, programmatic QA gate (disk opacity, bg residual 0, no edge clip). Uploaded via durable media pipeline (WebP primary + PNG + auto alpha-preserving thumbs).
- FIELDS (all in level.graphics, managed via Level Builder): badge_url (webp), badge_png_url, badge_thumb_url, alt_text, accent_color, glow_color, glow_intensity, locked_treatment (darken|icon). Builder UI: upload/preview(44px)/replace/clear, glow color picker, locked-treatment select.
- KEY BACKEND FIX: cosmetic graphics were frozen in version snapshots → added engine.live_graphics() overlay in /progression/me, /progression/summary/{username}, claim responses, and level history writes. Cosmetic art changes now propagate instantly without republish. leaderboard rows now include level_badge_url.
- DISPLAY LOCATIONS (all using same canonical asset): profile header LevelBadge (clamp(24px,16px+1.4vw,36px), drop-shadow glow, claim-event live refresh, star fallback), ProgressionBadges grid (56px art, current=strong glow+2px border+CURRENT tag, earned=subtle glow, locked=darkened art+lock overlay, BadgeArt fallback component), CelebrationModal (84px art), Leaderboards level chips (14px thumb).
- Verified: E2E screenshots (header/grid/leaderboards all rendering artwork), 22/22 backend regression, progression data untouched (all patches functional_change=False).
- NOTE: production DB has its own levels — after redeploy, founder must re-upload/assign artwork in production Level Builder OR agent can provide the processed files (/tmp/badges2/*.png|webp — NOT persistent; regenerate via scripts/process_badge_set.py if needed).

## Iteration 80b — Production Badge Artwork Migration (verified)
ROOT CAUSE of production legacy icons: production has its own DB + media store — artwork existed only in preview. FIX: bundled the 8 canonical webp badges into /app/backend/assets/badges/ (ships with deploy, 1.6MB) + new founder-only idempotent POST /api/admin/progression/apply-badge-artwork (imports via save_bytes into the environment's OWN media pipeline, assigns graphics to levels missing artwork, skips levels that have it, audited). "Apply Premium Badge Artwork" button added next to Step 1 in Activation tab. Tested: idempotent run skips 8/8; cleared-art simulation applies correctly and ladder/summary serve new URLs instantly (live_graphics overlay). Legacy icon fallbacks retained ONLY as broken-image safety; with artwork guaranteed they never render.
PRODUCTION STEPS: Deploy → /admin/level-builder → Activation → click "Apply Premium Badge Artwork" → verify profile header/grid/leaderboards show artwork.

## Iteration 81 — Profile Header Responsive Polish + Badge Card System (verified, 22/22 regression)
PART 1/4 HEADER: .or-profile-banner CSS (128px mobile / 190px tablet ≥768 / 230px desktop ≥1200, image object-fit cover never sets height). Avatar overlap now anchored to the AVATAR (-mt-12 / sm:-mt-[50px]) not the row → consistent 50-52% overlap at ALL widths on BOTH /profile and /profile/:username (was -33%..48% drift with items-end). Content flows below card (no absolute positioning); desktop spacing increased (px-10, pt-3, larger gaps).
PART 2/3 BADGES: new shared components/progression/ProgressionBadgeCard.jsx (single renderer used everywhere via ProgressionBadges). States: completed (color+glow+border), current (strong glow + CURRENT + or-badge-pulse animation, reduced-motion safe), next (grayscale art + colored outline + progress text e.g. "3/5 Tasks"), locked (grayscale(100%) brightness(.45) opacity .55 + small lock overlay — REAL art always shown). Missing artwork → explicit dashed ImageOff placeholder + console.warn (never silent substitute). Art fallback chain thumb→full→png→placeholder.
CRITICAL PIPELINE BUG FIXED (production-relevant): services/image_store.py save_bytes mirrored thumbnails to R2 with hardcoded `_thumb.jpg` name — alpha PNG thumbs were never mirrored, and when the ephemeral /data disk recycled, all PNG thumb URLs 404'd (broke badges + some avatars). Fixed to mirror the actual thumb filename. All 8 badge records repaired via apply-badge-artwork → both original+thumb now durable /api/media/... R2 URLs (200 verified).
VIEWPORTS TESTED: 375/390/768/820/1024/1280/1366/1440/1600/1920 on both profile pages — 0 overflow, banner heights correct, overlap 50-52% everywhere.
EDGE CASE: preview test user clmc8069d has a pre-fix avatar pointing at a wiped local file (broken img) — data casualty of ephemeral disk, not code; future uploads are durable.
DEPLOY NOTE: after redeploy, production founder should re-run "Apply Badge Artwork"? NO — production artwork applied there will use the FIXED pipeline; if production was already applied with broken thumbs, clear+reapply may be needed (frontend fallback chain covers it either way).

## Iteration 82 — FIRE POWER Reaction System, Phases 1–4 COMPLETE (June 2026, verified iter_80.json full pass)
REPLACES Likes on PUBLIC posts with progression-gated Fire reactions. Private/DM/group/community emoji reactions (routers/reactions.py) UNTOUCHED. Legacy likes NEVER deleted.

ACCOUNTING RULES (backend authoritative, services/fire_power.py):
- 1x Fire always unlimited/free. Boosted (2x+) cost = max(fire_value - 1, 0) against rolling 24h Daily Fire Pool.
- Each boost spend expires exactly 24h later (per-transaction expiry, no midnight reset) — lazy expiry decrements fire_pool_counters.spent_active.
- Concurrency: atomic conditional update {spent_active: {$lte: pool - cost}} + $inc — verified with 10 parallel requests, zero overspend.
- Idempotency: fire_idempotency collection (_id = client key); duplicate returns duplicate:true, no double charge; key released on 409 so retry works.
- Lowering/removing fire = NO pool refund (anti pump-and-dump); re-raising charges only delta above still-paid amount for that reaction.

COLLECTIONS: post_fire_reactions (uniq post_id+user_id; fire_value, boosted_cost, active, source user|migration), fire_power_transactions (reaction_id, boosted_amount, effective_at, expires_at, status active|expired), fire_pool_counters (_id=user_id, spent_active), fire_flags (singleton), fire_idempotency, fire_migration_log, fire_audit_logs. Posts get denormalised fire_total/fire_count.

FLAGS (db.fire_flags, ALL DEFAULT OFF; founder-only /admin/fire-power UI): fire_reactions, boosted_fire, fire_ranked_feed, fire_notifications. PRODUCTION = all OFF (untouched). PREVIEW currently: first 3 ON for testing, notifications OFF.

LEVEL FIRE DEFAULTS (progression_levels.fire_settings; editable in Level Builder + /admin/fire-power): L1 Newbie 1x/0, L2 Explorer 2x/10, L3 Creator 5x/25, L4 Rising Star 10x/50, L5 Influencer 20x/100, L6 Elite 35x/200, L7 Master 50x/350, L8 Legend 100x/500. Seed defaults via POST /api/fire/admin/seed-defaults (fills only missing).

API: GET /api/fire/status (OptionalUser; flags+config+pool), POST /api/fire/react {post_id, fire_value, idempotency_key}, GET /api/fire/post/{id}; founder admin: GET /api/fire/admin/overview, PATCH /admin/flags, PATCH /admin/levels/{id}, POST /admin/seed-defaults, POST /admin/migration/{dry-run|execute|rollback|reconcile}. Feed: GET /api/posts?sort=fire&window=1h|12h|24h|1w|1m|all (gated on fire_ranked_feed; pinned post stays first; fire{total,count,my_fire} attached when fire_reactions on).

MIGRATION WORKFLOW (founder-only, phrase-guarded): dry-run (read-only totals) → execute (phrase "MIGRATE LIKES TO FIRE"; converts public liked_by→1x fire source=migration via $setOnInsert only; 0 pool consumed; idempotent; likes untouched) → reconcile (fix:true repairs denormalised counters) → rollback (phrase "ROLLBACK FIRE MIGRATION"; deletes ONLY source=migration reactions + recompute). Preview: 8 legacy likes migrated + rollback tested + re-executed. PRODUCTION: NOT run (awaiting founder approval after dry-run review).

FRONTEND: components/fire/FireButton.jsx (flame tap=1x toggle, long-press/chevron=Fire Picker with multiplier chips, Fire Meter available/pool bar + next-recovery countdown), lib/fireApi.js (auth-aware cached /fire/status), Feed.jsx (FireButton swap on public posts only, Latest/🔥Top Fire + window chips), PostPopup.jsx (same swap), pages/AdminFirePower.jsx (/admin/fire-power: stats, flags, level table, migration console), AdminLevelBuilder LevelEditor Fire Power section, AdminHub card. When flags OFF → UI falls back to legacy Likes automatically (production-safe).

PRODUCTION ACTIVATION STEPS (when founder approves): 1) deploy 2) /admin/fire-power → Seed defaults 3) Dry Run → review totals 4) Execute migration (phrase) 5) Reconcile (expect 0 mismatches) 6) enable fire_reactions flag 7) optionally boosted_fire, fire_ranked_feed, fire_notifications. ROLLBACK = flags OFF (UI reverts to Likes instantly, data preserved) + optional migration rollback.

TESTED: iteration_80.json — backend 22/22, frontend 12/12 flows, no regressions (legacy like + emoji reactions verified unchanged).

REMAINING (P1 backlog): Fire notifications grouping ("X and 3 others fired your post"), Fire analytics dashboard, live fire count updates (websocket), Fire on profile My Feed widget (still shows likes there).

## Iteration 83 — Phase 0.5 FIRE VAULT + Portal Fire Picker + Phase 1 Fire Wallet Privacy (June 2026, iter_81.json 100% pass)
ADDITIVE ONLY. Fire Pool accounting, ranking, migration, DM reactions untouched.

FIRE VAULT (services/fire_vault.py): permanent earned-fire wallet. Creator earns FULL fire value of reactions on their public posts → pending_balance → settles into vault_balance after founder-configurable delay (db.fire_wallet_config.settlement_hours, default 24). Lazy atomic settlement in wallet_for/settle_due. Sender NEVER earns; self-fire earns nothing. Anti-farming: post_fire_reactions.max_fire_value high-water mark — only net-new fire above historical max credits. Accrual ALWAYS on; `fire_wallet_enabled` flag (5th fire flag, default OFF) gates UI only. Vault NOT spendable (future: marketplace, unlocks, gifting, staking etc plug into fire_wallet_transactions ledger).
COLLECTIONS: fire_wallets (uniq user_id; vault_balance, pending_balance, lifetime_fire_earned/received, largest_single/daily/weekly/monthly_fire, last_fire_received_at), fire_wallet_transactions (user_id, sender_id, post_id, reaction_id, amount, type earn, status pending|settled, settle_after, idem key uniq sparse, audit), fire_wallet_config singleton.
APIS: GET /api/fire/wallet (own: wallet+pool+fire_given+fire_received+recent history), founder: GET /admin/wallets/overview (totals, largest wallet/pending, top earners/senders), PATCH /admin/wallets/config, POST /admin/wallets/recalculate (repair from ledger), POST /admin/wallets/settle-now, GET /admin/wallets/transactions.
UI: FireWalletCard.jsx — full card on own /profile (pool, vault, pending, lifetime, given, received, recovery timer, recent history, "not spendable yet" note) + compact variant on /home. WalletAdminSection in /admin/fire-power.

PORTAL FIRE PICKER (FireButton.jsx rewrite): picker renders via createPortal(document.body) z-[300] — bottom sheet <640px (safe-area padded, above bottom nav) / centered dialog desktop. Contains level badge+name (config.level_badge_url), Fire Meter (avail/pool/used + next recovery), synced slider+number input, quick chips, Send Xx 🔥 button, Remove control, newbie simple-state (max 1 → no slider), exhausted state. Quick tap = 1x toggle; tap with existing boost >1 opens picker (no silent downgrade); long-press AND caret open picker; keyboard accessible; Escape/backdrop close; body scroll locked/restored. First-use dismissible hint (localStorage ourrealm.fireHint.v1).

FIRE WALLET PRIVACY (Phase 1): users.fire_privacy {vault_balance: only_me, lifetime_fire: everyone, fire_given: friends, fire_received: everyone} (defaults). Backend authoritative: GET /api/fire/wallet/stats/{username} returns {visible:false} with NO value for hidden fields. Owner + founder always see all; friends = accepted only (pending doesn't count). Seeded 151 users idempotently (POST /api/fire/admin/privacy/seed-defaults). APIs: GET/PATCH /api/fire/privacy. UI: FireWalletPrivacy.jsx in /settings (4 shadcn selects), PublicFireStats.jsx on public profiles (🔒 Private for hidden). No block system exists in the app — friend/owner/founder gating covers all current cases.

fireApi.js: auth-aware cached status + one-retry on aborted fetch. fire_given = sum of vault txn amounts where sender_id=user.
TESTED: iteration_81.json — backend 21/21 pytest (tests in /app/backend/tests/test_fire_vault_privacy.py), frontend 100% incl. 320–1920px responsive, friend-privacy flow, JSON/DOM leak audit. Cosmetic recovery-label rollover (22h 60m) fixed post-test.
PREVIEW FLAGS: fire_reactions/boosted_fire/fire_ranked_feed/fire_wallet_enabled ON, fire_notifications OFF. PRODUCTION: all OFF, untouched.
REMAINING: P1 fire notifications grouping + analytics, live fire updates, founder-editable privacy defaults, public creator metrics feature.

## Iteration 84 — Fire Button UX Improvement (June 2026, self-tested)
UI/UX only; no accounting/lifecycle changes.
- Quick tap when NOT reacted → sends 1x instantly (unchanged). Tap with ANY existing fire (1x or boosted) now OPENS THE PICKER — never silently removes/downgrades. Removal is intentional via picker Remove button.
- Picker additions: "Selected Fire / Boosted Pool Cost / Creator Receives" summary grid, edit-deadline countdown ("Editable for Xh Ym — then it finalizes"), current value pre-selected.
- FINALIZED read-only picker state: if my reaction is >24h old (my_fire_finalized), picker shows "Nx 🔥 / Finalized / This Fire can no longer be edited" — slider/input/chips/remove hidden. DISPLAY-ONLY: backend does NOT yet enforce the 24h edit window (that's Phase 0.6 Part D). attach_fire() now returns my_fire_deadline (created_at+24h) + my_fire_finalized (additive).
- Accessibility: 44px touch targets (negative-margin trick, no layout shift) on flame + caret, focus-visible outlines, aria labels updated.
- FIXED RACE: fireApi.js cache writes now sequence-guarded (_seq/_writtenSeq) so a stale guest /fire/status can never overwrite an authed one; FireButton.openPicker fetches fresh status (fetchFireStatus(true)) and prefers it over the prop — picker config always correct.

## Iteration 85 — PHASE 0.6 COMPLETE & CERTIFIED (June 2026, iteration_82.json — backend 19/19, frontend pass)
All parts A–AB implemented + E2E verified. Emoji launchers fully removed from public posts (47 fire buttons, 0 emoji on /feed); emoji preserved in DM/group/realm/community messaging. Recipient earns FULL fire_value; sender charged only max(fire_value−1,0). 24h edit deadline bound to created_at (edits never restart, verified 4 edits = identical deadline); difference-based edit accounting via append-only pool_charge/pool_release ledger rows with lazy expiry. Server-enforced read-only after deadline (403). Lifecycle: Active→Pending→Collectable (background finalization_loop every 600s + admin force-finalize)→Collected via manual COLLECT FIRE/COLLECT ALL (atomic per-txn status flip; 5 parallel collects never double-credit; never expires). Fire Wallet premium redesign (pool bar/vault/pending/collectable/received/given/collected/future utilities). Admin Fire Command Center: live dashboard (12 KPIs), user/post inspectors, pause/restore/force-finalize/collect-on-behalf/reverse-reaction (reason required, audited), wallet repair zero-drift. Privacy backend-authoritative (hidden fields emit no value key). Fire-ranked feed = post fire activity; vault rankings = collected only. Flags: preview all ON; PRODUCTION flags remain OFF, no migration executed. Session fixes: AdminFirePower.jsx orphaned-JSX compile break removed; missing DashboardSection/InspectorSection implemented. Tests: /app/backend/tests/test_fire_phase06.py (19), report /app/test_reports/iteration_82.json.

## Iteration 86 — SOUNDS ⇄ FOR YOU UNIFICATION COMPLETE (June 2026, iteration_83.json — backend 15/15) + collapsible Fire Power profile cards
Canonical sound-post model (one post per track; fire/comments/audience on post), shared creation service both composers, Fire button on Sound cards (Heart removed), 🔥 Top Fire chart with windows, db-managed classifications, two-way sync + delete, founder migration dry-run/execute/rollback (preview executed: 5 tracks; production untouched). Fire Power cards on own+public profiles collapsed by default via CollapsibleHeader. See CHANGELOG July 2026.

## Iteration 87 — FOUNDING VIP MEMBER REWARD COMPLETE (June 2026, iteration_84.json 21/24 + 2 bugs fixed & verified)
Option 3 delivered: claim-based reward for member numbers 1–1000 (permanent, counter-based, signup hook) = VIP role + permanent Founding VIP badge + 1,000🔥 to vault on manual claim. Idempotent/concurrent-safe, corrections workflow, founder admin (stats/editor/versions/user mgmt/exports/audit), claim card + login popup + profile chip. Preview backfill executed (101 records). Production untouched — founder runs dry-run/execute post-deploy. See CHANGELOG.

## NEXT (user-approved): FOUNDING VIP MEMBER REWARD (Option 3 design)
First 1,000 real members (permanent member_number 1–1000) get claim-based reward: existing VIP role + separate permanent "Founding VIP" badge + 1,000🔥 to permanent Vault on manual claim. Full spec in user message (member-number migration, claim card, login popup, founder admin on /admin/fire-power, editable content w/ versions, force-claim, corrections, exports, idempotent claim txn). Do NOT auto-deposit; do NOT double-grant; manually-awarded VIPs excluded by default.

## COMPLETED spec reference: PHASE 0.6 — 3-part spec (UI cleanup + full Fire lifecycle)
Original key items (ALL DONE, see Iteration 85):
- PART A: remove emoji reaction launcher (ReactionAttachment/picker) from ALL public post surfaces (Feed.jsx line ~833 reactions row, PostPopup) — keep for DM/group/realm/community messaging.
- PART B: verify creator receives FULL fire value (current impl already credits full value — confirm + regression).
- PART C/D/E/F: true lifecycle Active→Pending→Collectable→Collected Vault; 24h edit window ENFORCED server-side (deadline=created_at+24h, edits never restart); difference-based accounting: lowering releases pool reservation difference (CHANGES current no-refund rule!), pending mirrors current active value live; finalized reactions immutable (sender edits rejected).
- PART G/H/I: pending fire live updates; collectable never expires; manual "COLLECT FIRE"/"COLLECT ALL FIRE" (never "Claim") atomic+idempotent; wallet collectable_balance + lifetime_fire_collected.
- PART K: metrics separation (post fire live for feed rankings; vault rankings = collected only).
- PART L/M/N/O/P: Fire Wallet premium redesign (7 sections incl. Future Utilities "Coming Later"), remove "not spendable yet" wording → "Permanent Fire Vault"; Public Fire Stats redesign (+unique supporters, most fired post, weekly fire, fire collected); picker/quick values polish (mostly done in iter 84).
- PART R/S: grouped collectable notifications + wallet history with filters.
- PART T/U/V/W: admin fire command center (dashboard totals, user fire inspector, post fire inspector, repair/reverse/pause tools with reason+audit).
- PART X/Y/Z: ledger-first fields (edit_deadline, finalized_at, collectable_at, collected_at, policy_version), background finalization job (cron like purge_cron pattern in server.py startup ~line 400), atomic collection.
- PART AB: new flags fire_collection_enabled, fire_pending_enabled, fire_collectable_enabled, fire_wallet_history_enabled, fire_admin_tools_enabled (default OFF).
- Testing: full backend + frontend + viewports, completion report per PART AG.
NOTES for implementation: pool release rows can be negative-amount active txns with expires_at=edit_deadline (lazy expiry math self-reverses); map legacy settled txns as collected; ReactionBar/ReactionAttachment used at Feed.jsx ~line 833; emit_notification(recipient_id, kind, actor_username, payload) in routers/notifications.py; DB test fixture: reaction da8c46b2 on post 8aec11dc backdated 30h for finalized-state testing.

## July 24, 2026 — Guest Browsing Removed + Global Auth Enforcement (P0, TESTED iteration_88: 25/25 backend, 12/12 frontend)
- **Landing page and guest mode DELETED**: `Landing.jsx`, `GuestPrompt.jsx` removed; `isGuest`/`setGuest`/`ourrealm.guest` localStorage removed from `AuthContext.jsx`; all guest branches removed from Feed, Profile, Home, HomeDashboard, BottomNav, PostPopup, FireButton, ReactionAttachment, SignUp.
- **Frontend route guard**: `ShellRoute` (App.js) redirects anonymous users to `/signup?next=<encoded-path>`. `/` → `RootRedirect` (anon → /signup, authed → /feed, honors ?next). `/login` alias added for SignIn. Deep linking: SignIn/SignUp read `?next` (same-origin only) and return the user to the original URL after auth (SignIn fallback /feed, SignUp fallback /interests). Sign-in/sign-up cross links preserve ?next.
- **Backend lockdown**: `global_auth_guard` middleware in `server.py` — every `/api/*` path requires a valid session (via `get_current_user`, 401 otherwise) EXCEPT allow-list: `/api` health, `/api/auth/{register,username/check,login,logout,refresh,otp/request,otp/verify,forgot-password,reset-password}`. Covers `/api/v1/*` alias too (alias middleware rewrites path before guard). Pending-deletion users still pass (restore flow intact). OPTIONS preflight skipped.
- **Kept public (compliance)**: static legal pages /terms, /terms-conditions, /privacy, /community, /dmca, /safety, /cookies, /account-deletion — required by signup compliance checkboxes; contain no user data.
- Regression test file: `/app/backend/tests/test_auth_guard_iter88.py`.

### Remaining backlog (unchanged)
- P1: Fire Power Analytics & Grouped Notifications
- P2: JWT_SECRET rotation, CORS_ORIGINS scoping to custom domain, Task Accuracy Validation, Mini profile hover-card
- Do NOT implement until instructed: Fire Marketplace, Portal unlocks, Realm unlock costs, Fire gifting, Fire quests, Creator economy

## July 24, 2026 — Signed-in /signin panel restored + header logo → /signin (TESTED via screenshot flow)
- SignIn.jsx: logged-in users see "Continue as @username" (→ ?next or /feed) and "Sign Out" (logs out, stays on /signin showing the form). No guest option restored.
- TopStarBar.jsx: header logo click now navigates to /signin (was "/").

## July 25, 2026 — Sound Uploads for Musicians (TESTED end-to-end via curl, all cases pass)
- Limits raised: audio 5MB→50MB, 60s→10 min (upload_limits.py LIMITS.audio: max_bytes 50MB, max_seconds 600; per-day 10 unchanged; founder exempt unchanged). audio_store MAX_BYTES was already 50MB. Friendly error: "Audio too long — max 10 minutes."
- Audio optimization: save_audio (services/audio_store.py) now transcodes every upload to streaming AAC 128k .m4a (+faststart) via imageio-ffmpeg static binary (already in requirements.txt, works in prod deploys) in asyncio.to_thread; skips re-encode only when already AAC ≤192kbps or duration >660s; original file deleted after successful transcode; on ffmpeg failure the original is kept and served (backward compatible). R2 mirror uploads the optimized m4a; playback via /api/media/audio/*.m4a signed-redirect verified (206 range, valid ftyp).
- UI: SoundUploadPicker helper text → "Up to 10 minutes • Max 50 MB. Audio is automatically optimized and streamed from our CDN for fast playback." 413 fallback message updated.
- Verified: 3-min MP3, 4-min MP3, 8-min WAV (41MB→7.8MB m4a), 38MB FLAC (→4.9MB m4a) all accepted+transcoded; 51MB rejected 413; 10.5-min rejected 400; originals removed; no orphan tmp files; quota endpoint intact; test tracks cleaned from DB.

## July 25, 2026 — Legacy Sound Posts → Fire Power Unification (TESTED: pytest 7/7 + testing agent iteration_89 + self-verified fixes)
- **Startup migration (restart-safe, idempotent)**: server.py startup calls sound_posts.run_startup_migration() — logs a dry-run report (scanned, already canonical, to backfill, missing links, dupes, likes to convert, fire preserved, skipped+reasons) then executes only if work exists. Founder admin endpoints (sounds.py /admin migration routes) remain for manual runs.
- **backfill_canonical_for_track** (sound_posts.py): idempotent — creates ONE canonical post per legacy track (preserves creator, title, cover, audio, duration, visibility, original created_at) and converts hearts → exactly 1× Fire per unique user (source="sound_migration", boosted_cost=0 = no pool charge, $setOnInsert = never duplicates), then recompute_post_fire. Skips deleted/moderation-blocked tracks with reasons. Duplicate canonical repair: keeps most-engaged (fire+comments, tie→oldest), demotes extras (no deletion).
- **No raw track rows anywhere**: posts.py sound feed merge now heals stragglers (e.g. abandoned deferred uploads) into canonical posts on the fly instead of injecting is_sound_track rows; attach_posts_to_tracks lazy-heals too (covers /sounds, profile lists). Feed.jsx FireButton condition no longer excludes p.is_sound_track.
- **Sounds page bug fixed**: queries used {"is_ai_generated": False} which excluded legacy tracks missing the field → changed to {"$ne": True} (3 spots in sounds.py).
- **Regression tests**: /app/backend/tests/test_sound_fire_migration.py (7/7): dry-run report, backfill+like→fire, idempotency (no dup posts/fire), duplicate repair, fire add/increase/decrease/remove via API on migrated post, no raw rows in feed, new upload canonical.
- Verification artifact left in preview DB: "Calling in The City" (track e8e5aa8b..., canonical post d7e3d36d-..., 1×🔥 from stealth converted from legacy heart). PostPopup for sounds opens via the comment button (same as all post types) and shows the Fire control.
- NOTE: production gets backfilled automatically by the startup migration on next redeploy.

## July 25, 2026 — Progression System Audit & Global Backfill (TESTED: pytest 7/7 + curl + UI smoke)
- **New calculators** (services/progression/calculators.py): fire_received (total fire on user's posts; unique='user' → unique real supporters), fire_sent (fire given to other creators), inner_realm_complete (len(users.inner_8) vs inner_realm_size 4/8/12/24, default 8, legacy top_8 fallback). engagement_received now counts fire senders for kind 'any'/'fire' (fixes unique_engagers). Registry keys added: fire_received, fire_unique_supporters, fire_sent, fire_unique_creators, inner_realm_complete.
- **Repair module** (services/progression/repair.py) run_progress_repair(): Phase 1 converts likes_received→fire_received ("Receive N valid likes"→"Receive N Fire Power") and top8_add/inner8_add→inner_realm_complete in BOTH progression_tasks AND frozen published snapshots (task ids preserved, no version bump); merges duplicates (same level+type+target+config or "(copy)" name — keeps oldest, moves user_task_progress, archives copies, strips from snapshots); archives placeholder tasks on archived levels. Phase 2 recalculates every eligible user from full history (idempotent; XP/rewards flow through existing claim path — one claim per user/level/version, never duplicated). Phase 3 writes report to db.progression_repair_reports.
- **Auto-run**: startup hook (server.py) runs once per REPAIR_VERSION marker (progression_flags key progress_repair_version) as background task — production repairs itself on redeploy. Founder endpoints: POST /api/admin/progression/repair/run, GET /api/admin/progression/repair/latest.
- **Future-proofing**: level_publish now triggers backfill_new_task() — users on the level are recalculated from history immediately after any new/changed task publish.
- **Seed defaults updated** (progression/seed.py): fresh installs seed Fire tasks + inner_realm_complete.
- **First-run report (preview)**: 42 tasks audited, 6 like→fire conversions, 1 inner realm repointed, 6 renamed, 4 placeholder tasks archived, 12 snapshot tasks converted, 123 users scanned, 119 repaired, 0 failed, 0 errors. Second run = clean no-op (idempotent). Stealth verified: Join 3 Realms 3/3 ✓, Inner Realm 8/8 ✓, "Receive 100 Fire Power" 15/100 live.
- Tests: /app/backend/tests/test_progression_repair.py (7/7).

## July 25, 2026 — Feed layout reorder (layout-only, verified via screenshots desktop+mobile)
- Feed.jsx order now: Composer → MediaTypeBar → TrendingHashtags → Radius chips → Latest/Top Fire → posts. Single MediaTypeBar instance; no behavior changes.

## July 25, 2026 — Duplicate Sound posts in For You feed: permanent fix (TESTED: 19/19 pytest across 3 suites)
- **Root cause**: concurrent feed-heal / startup-migration requests could both pass the "no canonical yet" check and insert two canonical posts for one track (race); earlier repair demoted (not removed) extras, leaving visible duplicates in feeds.
- **Fixes**:
  1. Partial UNIQUE index `uniq_canonical_sound` on posts.sound_track_id where is_canonical_sound=True — a second canonical can never be inserted. backfill_canonical_for_track catches the DuplicateKeyError and converges on the existing post (race-safe, verified with 3 concurrent heals → exactly 1 post).
  2. repair_duplicate_sound_posts() (sound_posts.py) replaces demote-only repair: keeps the OLDEST valid canonical, migrates fire (no double-count per user), comments, emoji reactions, saves/shares/notifications, recomputes fire totals, then DELETES duplicates + old demoted migration artifacts. Idempotent; runs at startup BEFORE index creation (run_startup_migration ordering).
  3. Strict server-side feed dedupe in posts.py list_posts final step: one post id per response + one canonical instance per sound_track_id (highest-ranked kept). Intentional creator reposts (non-canonical) unaffected. Covers Latest/Top Fire/Sounds/pagination/refresh (limit-based feed).
- Tests: tests/test_feed_dedupe.py (5) + updated test_sound_fire_migration.py duplicate-repair test; shared event loop helper tests/_shared_loop.py added (motor one-loop-per-process). All 19 pass together.
- Production duplicates auto-repair on next redeploy via startup migration.

## July 25, 2026 — Trending Hashtag post interaction (TESTED e2e via browser automation)
- HashtagFeed.jsx cards now open the canonical global PostPopup (openPostPopup) on tap; avatar/username/hashtag taps stopPropagation and navigate independently.
- PostPopup.jsx gained shareable-URL sync: ?post=<id> pushed while open (works on every page that opens the popup), browser Back/Android gesture closes it, Escape/X/overlay close cleans the URL, refresh/direct ?post= URL deep-links the post (auth-gated), hashtag page state preserved on close (no feed reload). Safe-area insets added to the overlay padding.
- Verified: card click → popup + URL, fire control, live comment, back-close, deep link, escape-close, username→profile without popup.

## July 25, 2026 — External post link sharing (TESTED e2e via browser)
- New lib /app/frontend/src/lib/sharePost.js: sharePostLink(post) — Web Share API on mobile, clipboard + "Post link copied" toast fallback; repeated-tap guard; URL format https://ourrealm.social/feed?post=<id> (REACT_APP_SHARE_ORIGIN in frontend/.env, hardcoded prod fallback — NEVER preview domain).
- ShareToUserModal now has a "Share post link" button at top (single logic for every surface — Feed + PostPopup cover Home/profiles/Sounds/hashtags/search since all use the same modal). Friend-DM sharing unchanged.
- Recipient flow verified: logged-out visit → /signup?next=/feed?post=id → signin → lands on exact post popup. Server enforces permissions on the shared post (deleted/private/blocked return errors in popup).
- Preview DB hygiene: removed 29 orphan sound posts (old TEST_iter83 artifacts whose tracks were deleted).

## July 25, 2026 — P0 duplicate posts across all feeds (TESTED: 14/14 pytest + endpoint + UI checks)
- Backend safety net centralized: _dedupe_post_items() in routers/posts.py applied to list_posts, feed_by_user (profile/MyFeed/PublicFireStats), and hashtags feed. Realms use community_hub_posts (single-query, no dup path). Unique canonical index remains the DB-level guarantee.
- Repair extended (sound_posts.repair_duplicate_sound_posts): now scans ALL same-track sound posts, merging (engagement → oldest valid canonical, then delete) (a) extra canonicals, (b) earlier-repair artifacts, (c) pre-unification same-author copies with NO distinct caption. Captioned creator reposts and other users' posts are always kept. Runs automatically at startup — production repairs itself on redeploy.
- Frontend safety net: lib/dedupePosts.js applied in Feed.jsx (serverPosts), HashtagFeed, MyFeedWidget — duplicate API data can never render duplicate cards.
- Regression tests: test_all_feed_endpoints_unique (fails if ANY feed returns a post id twice), test_same_author_captionless_copy_merged_but_captioned_repost_kept, plus prior race/index/merge suites. Verified live: 176-item feed unique, 200 rendered cards 0 duplicates.

## Bundle 1 — Personal Playlists + Sound-Player Fire (Jul 25, 2026) — COMPLETE, AWAITING USER APPROVAL
- Private-only personal playlists: /api/playlists CRUD, add/remove/reorder, duplicate prevention (unique index), owner-only auth, reuse gates (deleted 410 / restricted 403 / foreign-private 403), limits in core/config.py (MAX_PLAYLISTS_PER_USER=50, MAX_TRACKS_PER_PLAYLIST=500, env-overridable).
- Canonical Sound Fire on all existing Sound surfaces: Sounds page TrackCard, feed SoundPlayerCard footer, global MiniPlayer — all via SoundFireControl → GET /api/sounds/{tid}/canonical-post → shared FireButton/QuickFireSheet. One total, idempotent, no new fire records.
- Add-to-Playlist popup (quick-create inline) on all three surfaces; Account Settings → Sound Playlists tab (list/create/rename/delete/remove/reorder only).
- Tests: backend 18/18 (test_playlists_bundle1.py) + fire/sound regressions green; frontend e2e iteration_92 9/9 desktop+mobile. Pre-existing unrelated failures documented: test_fire_power.py (guest 401s from iter-88 auth guard; refund accounting superseded by Increment B — test_quick_fire.py is authoritative).
- NEXT: user approval → Bundle 2 (Sounds Control Center /admin/sounds, Genre/Mood managers, Copyright tool, strikes/restrictions). Then Bundle 3 (Realm Audio Context, migration dry runs). Backlog: JWT_SECRET rotation (P2), CORS scoping (P2), mini profile hover-card (P2).

## July 26, 2026 — Google Sign-In onboarding flow VERIFIED (minimal scope, user credit-constrained)
- Re-ran tests/test_google_auth_mock.py: 16/16 PASS — existing users matched by verified email (no duplicate doc), new Google users get needs_username_onboarding flag + auto username, onboarding modal gated in App.js, availability via shared premium-usernames service (rules/reserved/premium pricing), rename clears flag, dismiss persists.
- Added inline verification: suspended (401 "Account suspended until…") and banned/disabled (401 "This account is not available.") users are BLOCKED from Google login — same policy as /login. New Google signups get auto-friends (founder+support), VIP first_1000 eligibility, founding-VIP hook, identical JWT access/refresh tokens.
- Fallback verified: AuthCallback.jsx — missing session_id → redirect /signin; backend 401/failed exchange → error message + "Back to sign in" button. Live API check: bad session_id → 401.
- Fix: test cleanup now also deletes username_claims (stale claim from a prior partial run caused a false rename failure).
- Content Safety Phase 2 code is COMPLETE but final testing_agent verification PAUSED by user (credit conservation). Phase 3 not started.

## July 29, 2026 — Google signup Terms gate (TESTED 19/19 mock + signup UI screenshot)
- NEW Google users must accept ToS/T&C/Privacy/13+ BEFORE account creation: /auth/google/session now returns {requires_terms, pending_token} for unknown emails without acceptance flags (Google profile stashed in pending_google_signups, 15-min expiry, token consumed on create). Second call with pending_token + the 4 acceptance booleans creates the account.
- Shared ComplianceCheckboxes.jsx extracted from SignUp.jsx (identical UI/testids for email signup, "google-" prefix on AuthCallback). AuthCallback shows the acceptance step with Agree/Cancel; existing users and repeat logins unchanged (no prompt).
- Verified: no user doc before acceptance, token consumed, existing-account link untouched, email signup renders identically.

## July 30, 2026 — SignUp layout reorder (screenshot verified)
- "Sign Up with Google" moved directly below heading/subtitle with OR divider beneath it, then form fields → checkboxes → Join button. GoogleSignInButton gained a `divider` prop ("above" default keeps SignIn unchanged; "below" on SignUp). No styling/logic changes.

## July 30, 2026 — Mode order + Text & Icons color (screenshot + live-var verified)
- MODES array in ThemeContext reordered to [neon, millennium, stealth, business] — single source drives signup ModeSwitcher and Modes page identically. No IDs/routes/logic touched.
- Modes page "Customize your colors" gained a third PickerRow "Text & icons" (testid modes-color-text) reusing the exact accent-picker architecture: overrides --text-main CSS var via ThemeContext inline vars, per-mode localStorage persistence (ourrealm.customColors), instant live apply, reset restores mode default. Verified: preset applies (#FF3F5A), survives reload, reset → #E6F2FF.

## July 30, 2026 — Notification content upgrade (frontend-only, screenshot verified)
- Notifications.jsx now renders descriptive per-kind content: "@actor <verb>" line (like/comment/reply/comment_like/share/save/mention/message/fire with fire_value "sent 25🔥 to your post:"), quoted 2-line-clamped content preview from payload.preview, "Tap to reply." hint on comment/reply/message/mention, sentence-style rendering for friend_request/follow/moderation/premium_username/founding_vip/fire_collectable/realm_activity, graceful fallbacks when preview missing.
- Relative time added (now/m/h/Yesterday/d/date) — server items previously showed NO timestamp (n.when was undefined).
- Deep links extended: reply/comment_like → post popup; moderation with post_id → post popup. Backend untouched (payload previews already existed on all producers).

## July 30, 2026 — Notifications: avatars, unread dot, date grouping (browser verified)
- /api/notifications/list now attaches actor_avatar via one batched users lookup (read path only, no schema change).
- Notifications.jsx: actor cards show UserAvatar (dicebear fallback) with a small kind-icon badge; system cards keep the icon circle. Glowing blue unread dot (testid notification-unread-dot-*) hides on markOne/markAllRead (these now also update serverItems locally). Section headers Today/Yesterday/Earlier This Week/Older inserted inline (sorting unchanged). Verified: 6 dots → 5 after mark-read, all 4 group headers rendered.

## July 30, 2026 — ORAi Control Center dashboard upgrade (curl + screenshot verified)
- New founder-only backend router routers/orion_control.py (/api/admin/orion/*): GET/PUT settings (enabled, power_level 1-10, notifications, scan scheduler manual/hourly/daily/weekly/custom d-h-m) persisted in single orion_settings doc; POST /scan (read-only counts, saves last_scan); GET /overview (status/last_scan/recs/usage/tasks/cost placeholder/7-day series); GET /providers (env-derived: emergent+openai connected, anthropic+gemini empty) with toggle+test; GET /recommendations (orion_recommendations, empty state). Settings changes + scans logged to EXISTING orion_action_logs (feeds activity + audit).
- New frontend components/admin/OraiDashboard.jsx wired as default dashboard section in AdminOrion.jsx (old dashboard kept at section id "classic"). Collapsible glass cards reusing orion-* CSS: 6 overview stats, power slider w/ Economy-Balanced-Advanced-Maximum tiers (debounced autosave), scan scheduler, usage monitor w/ SVG 7-day chart, provider cards + Add Provider, activity feed (real orion_action_logs), recommendations table w/ empty state, quick actions (Run Scan / Pause / Settings), settings toggles. No orchestration/routing/codegen built (per safety constraints).

## July 30, 2026 — ORAi "alive" upgrade (all 10 acceptance tests verified via curl + browser)
- Real background scheduler (asyncio loop, 60s tick, started in server.py startup): runs saved schedule (hourly/daily/weekly/custom d-h-m), asyncio lock prevents overlap (skip not queue). Verified: two scheduled scans ran on a 1-min custom interval; last_scan/next_scan/activity auto-update.
- Scan pipeline (_execute_scan in orion_control.py): real read-only metrics (users/posts/queries/failed/drafts/open reports today+yesterday) → heuristic recommendations upserted to orion_recommendations w/ dedupe keys + auto-resolve, scored confidence/priority/impact/effort/risk → intelligence report (top-5 findings, top rec, largest ± change vs prev scan, warnings, "Not enough activity yet." fallback) stored in settings doc → optional founder notification. Logs scan_started/scan_completed/recommendation_created/provider_tested/settings_change to existing orion_action_logs.
- Overview adds health score (Excellent/Good/Warning/Critical from failures/backlogs/staleness — live value 53 Warning), next_scan, max-5 real-data insights, last_report. Provider tests record last_success_at/last_fail_at (shown on cards).
- Frontend: Today's Review card (health ring, recs waiting, last/next scan, Run Scan/Review Recs/Open Activity), Intelligence Report + Smart Insights cards, recs table w/ colored low/med/high badges for all 5 scores, provider test history, settings toggles Auto Scan/Auto Report/Notify Founder (persist verified). NO AI provider calls anywhere — pure heuristics.

## July 30, 2026 — ORAi redesign: /admin/orai + official logo + hero chat/voice UI (screenshot verified desktop+mobile)
- Route renamed /admin/orion → /admin/orai with redirect for old links; AdminHub + ChatLayout links updated.
- Official ORAi logo (customer asset euhwrktr_572E9969...png, exported as ORAI_LOGO_URL from OraiDashboard.jsx) replaces OrionLogo everywhere (sidebar, topbar, chat empty state, bubbles) + large centered hero logo.
- Dashboard hero: centered logo → existing OrionChat embedded (constrained stream height) → VoiceBar UI foundation (glowing mic below input, 11-bar animated waveform, "Listening…" indicator, audit note "Voice conversations are transcribed and stored securely."). No voice backend — UI only.
- Style polish in OrionStyles: nav hover translate+glow, card hover lift for orai cards/stats, glowing chat input focus, hero entrance animation, mobile breakpoints. All existing functionality untouched.

## July 30, 2026 — ORAi voice STT + model upgrade (browser + curl verified)
- VOICE AUDIT: previous implementation was getUserMedia capture only (no STT, no Web Speech API). Migrated to MediaRecorder → POST /api/admin/orion/voice/transcribe (founder-only, orion_control.py) → OpenAI whisper-1 via emergentintegrations OpenAISpeechToText + EMERGENT_LLM_KEY. Cross-browser: audio/webm (Chrome/Edge), audio/mp4 (iPhone Safari), 25MB cap, transcript dispatched via existing "orion-prefill" event into chat input. Errors handled without refresh: NotAllowedError/NotFoundError/unsupported browser/upload failures → toasts. States: Listening (waveform) → Transcribing (spinner). Every transcription audit-logged (action_type voice_transcribed).
- MODEL UPGRADE: gpt-4o-mini → gpt-5.4-mini (playbook-recommended mini tier) across 8 files/16 refs: widget_chat.py, admin_widgets.py, core/api_providers.py, core/widget_templates.py, services/{provider_registry,content_safety,moderation,chat_conversations}.py. DB scan confirmed no stored widget configs pinned the old model. Verified live: ORAi chat replies with model gpt-5.4-mini; direct emergentintegrations call OK.

## July 30, 2026 — OpenAI model audit & upgrade (curl verified)
- Chat: default gpt-5.4-mini everywhere; NEW pick_openai_model() in chat_conversations.py escalates founder ORAi messages matching complex-task regex (debug/refactor/architecture/algorithm/roadmap/etc.) to gpt-5.6-terra on the direct-OpenAI path only (Emergent fallback stays 5.4-mini). Wired at 3 call sites in widget_chat.py (/message, /regenerate, /stream).
- STT: /admin/orion/voice/transcribe now tries gpt-4o-transcribe with OPENAI_API_KEY first, falls back to whisper-1 + EMERGENT_LLM_KEY. Audit log records which model transcribed.
- Constants reserved for future: REALTIME_MODEL="gpt-realtime-1.5", VOICE_RESPONSE_MODEL="gpt-audio-1.5" (no TTS/realtime implemented — push-to-talk unchanged).
- WidgetBuilder model picker: gpt-5.4-mini (default) / gpt-5.4-nano / gpt-5.6-terra. Legacy gpt-4o-mini/gpt-4o removed from ALL code incl. 4 test files — repo-wide grep = 0 legacy refs. No OpenAI image-gen/embeddings/moderation-endpoint calls exist in this project (images run on Gemini Nano Banana).
- KNOWN ENV FACT: preview OPENAI_API_KEY returns 403 (rotated) — all OpenAI-direct calls auto-fall back to Emergent key in preview; production key will engage terra + gpt-4o-transcribe.

## July 30, 2026 — OPENAI_API_KEY investigation + real fixes (all verified via live API)
- KEY IS VALID: preview OPENAI_API_KEY (sk-proj-, project proj_RL4DKF4Sd03UPjtuKsXUefd5) returns 200 on /v1/models listing exactly the user's 9 models. Previous "403" diagnosis was WRONG.
- REAL ROOT CAUSES (3): (1) ORAi widget stealth_ai_5a6 editor_config.chat.model in widget_registry DB was still "gpt-4o-mini" → OpenAI 403 model_not_found (project lacks that model). Fixed in DB. (2) gpt-5.x rejects max_tokens → switched to max_completion_tokens in call_openai_chat + stream body. (3) gpt-5.6-terra only supports default temperature → temperature omitted for terra.
- STT: emergentintegrations wrapper hard-validates model to whisper-1 only → primary path now calls OpenAI /v1/audio/transcriptions directly via httpx with gpt-4o-transcribe; whisper-1+Emergent stays as fallback.
- VERIFIED LIVE: default chat → gpt-5.4-mini-2026-03-17 (direct OpenAI), complex founder message → gpt-5.6-terra, transcription → gpt-4o-transcribe. 403 log line now includes response body for future debugging.

## July 30, 2026 — Production terra-routing bug found via preview reproduction + FIXED
- ROOT CAUSE: production widget_registry DB pins editor_config.chat.model="gpt-4o-mini"; pick_openai_model compared cfg vs DEFAULT before the legacy remap → escalation never fired → legacy remap later coerced to gpt-5.4-mini (direct OpenAI, dated id seen in prod header). Reproduced exactly in preview by re-pinning gpt-4o-mini.
- FIX: pick_openai_model now normalizes LEGACY_MODELS → DEFAULT_MODEL BEFORE the complex-task check (deploy-safe; stale prod DB can no longer block terra). Verified with DB still pinned legacy: matched rule → requested gpt-5.6-terra → returned gpt-5.6-terra → provider openai (logs "ORAi routing: ...").
- Response now includes provider + requested_model; chat header shows actual model + " · FALLBACK" when Emergent answered. UI verified: "ORAI · GPT-5.6-TERRA". Routing INFO logs added for production verification.
- IN PROGRESS (next): ORAi image generation/editing — services/orai_images.py created (Gemini Nano Banana primary via Emergent key, gpt-image-2 fallback), ChatMessagePayload.image_b64 added, _sanitize_msg persists image_url, ChatBubble renders image_url. REMAINING: insert image-intent branch into widget_chat /message (edit failed on ambiguous anchor), frontend attach button + progress state, tests.

## July 31, 2026 — ORAi image generation & editing COMPLETE (all tests passed)
- Backend: services/orai_images.py (Gemini Nano Banana gemini-3.1-flash-image-preview primary via Emergent key; gpt-image-2 fallback on founder OpenAI key — /v1/images/generations + /edits; explicit provider logging incl. "FALLBACK"). widget_chat /message founder-only image branch: routes on upload OR gen-intent OR (edit-intent + last conversation image as reference via load_reference_from_image_url, handles /api/media/images + cloud URLs). Images stored via image_store.save_bytes → normal /api/media/images URL + persisted in conversation (image_url survives _sanitize_msg → reload persistence).
- Frontend (AdminOrion.jsx): composer attach button (10MB cap, preview chip, remove), progress states (Uploading/Generating image/Editing image vs ThinkingStates), inline image bubbles with action row (Regenerate/Variation/Edit again/Full screen/Save-download), local upload preview in user bubble, imgSrc helper for absolute/relative URLs.
- TESTS PASSED: fresh generation (gemini), follow-up edit w/ reference (gemini edit=True), uploaded-image edit, forced-failure fallback → gpt-image-2 (698KB image), reload persistence, mobile render, terra routing regression (gpt-5.6-terra), normal chat (gpt-5.4-mini dated). 
- WARNING for future agents: AdminOrion.jsx intermittently LOSES search_replace edits (3 occurrences) — always grep-verify after editing this file.

## Aug 1, 2026 — Bundle G COMPLETE (Responsibility Center final core bundle) + tested
- Template Picker: 4-step creation wizard (Type/Details/Starter Setup/Confirm) with template preview (name, version, starter groups/items, widgets, defaults, privacy), setup modes Recommended/Simple/Customize/Skip, recoverable "Retry Setup" state (no re-burn, no duplicates — idempotency key tpl:{cid}:{key}:v{n}).
- Widget Board: RcWidgetBoard on dashboard Overview (ONE combined endpoint /dashboard-widgets), accessible non-drag controls (up/down/remove/add/collapse/reset/set-center-default), layout fallback user > center_default > template > system, 409 on stale version.
- Universal Search: RcSearchPanel on Hub (cross-center) + dashboard (center-scoped) at /search endpoints; permission-aware (private units, closed centers, removed members excluded), debounced, deep-links.
- Admin Template Manager: /admin/responsibility-center/templates[/create|/:id|/:id/edit|/:id/preview] (AdminRcTemplates.jsx). Backend DB overlay in rc_templates.py: system templates = code-managed (status override + duplicate-to-customize); admin drafts fully editable; states draft/review/published/disabled/archived; publish requires change_summary + bumps version + versions snapshot; audit in responsibility_center_template_audit; disabled templates hidden from users + blocked for new applies (retry allowed). Founder-only read-only JSON view.
- Scheduled Reports UI: RcScheduledReportsPanel in Reports tab. Explicit opt-in (enabled=false default), weekly/monthly (NO quarterly — backend unsupported), day-of-week/day-of-month + send_hour + timezone (zoneinfo, _next_run_for), format, recipients, pause/resume/edit/delete, failure display, in-app delivery only (never email).
- Moderation integration: ReportModal reused for rc_center/rc_item/rc_comment/rc_event/rc_unit (flag buttons on dashboard header [non-owner], item drawer, comments, unit rows, event drawer). Backend CONTENT_TYPES already had rc_* with 404 existence-leak protection. Admin moderation reports filter content_group=rc/core (chips ts-report-group-*).
- TESTED: iteration_102.json — backend pytest 21/21 PASS, full frontend E2E pass. Testing agent FIXED critical NameError in create_center (settings/create_cost undefined — verified in place at responsibility_center.py:298). Fixed HIGH issue: RcSearchPanel render restored on dashboard.
- Terminology sweep (Aug 1): Fund→Fire Up across RC UI + backend user-facing strings ("Fire Up Vault" btn, "Vault fired up" txn label, "Fire Up the Center Vault" hub card, "fire up the Center Vault" 403 detail, "Vault balance"→"Vault Fire Power"). DB fields/routes/vars unchanged. Grep-verified zero remaining financial terms in RC user-facing strings.
- Top nav: Responsibility Center ShieldCheck icon added to TopStarBar between Featured and Discover (testid star-responsibility-center), prefix-matched active state for all /responsibility-center/* routes, tooltip + aria-label, brand-green, mobile no-overflow verified. NOTE: label is sr-only + tooltip to exactly match existing icon-only star bar buttons (no visible two-line label — existing buttons have none).
- Minor known item: PATCH /scheduled-reports/{id} returns {ok:true} without the updated doc (cosmetic).

## Aug 1, 2026 — Phase 1: ORAi per-Center Assistant (production upgrade plan approved by user)
User approved 4-phase plan: P1 ORAi text chat (DONE) → P2 Voice Mode (record→Whisper STT→ORAi→TTS; user has own OpenAI key so WebRTC realtime possible) → P3 AI Course Creation + Player + Tutor → P4 full audit/repair sweep. User's own OPENAI_API_KEY (backend/.env) is the AI provider.
- Backend: services/rc_orai.py — chat/sessions/messages/delete; permission-filtered real-data context (_center_context: items scoped to self for non-managers, vault only with view_vault, calendar/activity gated); POWER_TUNING by education ai_power_level; reuses chat_conversations.call_openai_chat (gpt-5.4-mini default, gpt-5.6-terra escalation for enhanced/high complex asks, Emergent fallback). Collections: rc_orai_sessions, rc_orai_messages. Activity log: orai_session_started.
- Routes: POST/GET/DELETE /api/responsibility-center/{cid}/orai/* (rc_reports.py).
- Frontend: components/rc/RcOraiPanel.jsx (drawer: session chips, prompts, md-bold rendering, disclaimer). Wired: dashboard header '✦ ORAi' + ?orai=1; education FAB (edu-orai-fab, bottom-24 md:bottom-6 z-[60] after overlap fix) + 'AI Teaching' nav; hub 'Open AI Assistant'.
- TESTED: iteration_104.json — backend 15/16 (1 skip), frontend all flows incl mobile; FAB overlap bug FIXED and re-verified via elementFromPoint on desktop+mobile. Compliance reply check passed (Fire Power never money).
- Minor noted: no member-facing /activity read route (admin path only) — optional later.

## Aug 1, 2026 — RC Branding & Media Upgrade (user-provided logo)
- New official RC logo seeded as ACTIVE version across 10 branding slots via scripts/seed_rc_logo.py (PIL variants: 1024 full, 512/256 squares, 192/128 emblem-crops for nav/favicon — aspect preserved, never stretched). Stored through image_store (R2 mirror) + rc_media create_version/activate_version with audit reason.
- Live wiring: TopStarBar RC nav item now renders RcImg navigation_icon (ShieldCheck fallback); hub sidebar main_logo now displays; education header/sidebar use education.logo + education.compact_icon.
- AdminRcMedia upgrades: clickable thumbnails → Lightbox; "Preview in App" per asset + "Preview Changes Across App" in upload modal (device toggle mobile/tablet/desktop, 6 context mocks); "Built-in default" boxes replaced with icon+label; existing before/after, apply/cancel/reset/rollback, version history w/ thumbnails, usage list all retained.
- NOTE: /api/media/* images require auth cookie (access_token) — works in browser, 401 via bare curl (expected).
- Self-tested via browser automation (lightbox=1, preview modal=1, version thumbs=20, nav+hub logo loaded). Phase 2 Voice Mode still awaiting start approval.

---
## June 2026 — Session additions (fork)

### OurRealm Global Access Control (DONE, tested 27/27 iteration_108)
- `services/access_control.py` + `routers/admin_access.py` + HTTP middleware in server.py
- 11 features (2 masters + 9 sub), 10 modes, emergency lock w/ snapshot restore, allowlist, one-time+recurring schedules (60s worker), impact preview, preview-as personas, audit. Founder-only. Public: /api/access-control/status, /preview-demo.
- Production state preserved: all full_access, rc_public_preview=hidden.

### Teen/Adult Guardian Controls (DONE, curl-smoke tested; no full E2E per user credit limit)
- users.age_class ("teen"/"adult"; NOTE: legacy users.account_type='human' is a DIFFERENT field — do not reuse)
- birth_date at signup (under-13 blocked; 13-17 teen; auto age-out to adult at 18)
- `services/guardian_control.py` (registry ~40 features, media types/sources, centers, presets strict/balanced/open, schedule/bedtime/screen-time gates, heartbeat dedupe, middleware) + `routers/guardian.py` (/api/guardian/*)
- Collections: guardian_links, guardian_permissions, guardian_routines, guardian_audit, guardian_screen_time, rc_member_education, signup_reservations, platform_settings
- Frontend: /parent (ParentDashboard), /parent/teens/:id (ParentTeenManage), /my-limits (MyLimits), TeenGuard lock overlay + 60s heartbeat, Settings→Family tab, SignUp dob + paused reservation screen
- Founder "New Signup Access" card in Settings→Admin (API: /api/admin/access-control/signup; register enforces pause)

### AI Courses Preview (DONE, backend smoke tested)
- rc_courses.py: GET /{cid}/courses-preview (+/course detail), PATCH /{cid}/members/{mid}/education (grade_text + normalized grade_level + ai_power), tutor-history (owner read-only), grade-aware generation (VISUAL_STYLE by level), tutor auto-context (learner level + progress)
- Frontend: components/rc/RcCoursesPreview.jsx embedded top of CourseStudio — member selector (single/multi, select all/clear/count, glow+check), interactive lesson content, inline quiz, back/next, mark complete, TutorPanel (self) / TutorHistoryPanel (owner), grade input + AI power slider, summary cards, mobile single-column
- RC Dashboard mobile fix: .rc-dash-head/.rc-dash-actions + index.css ≤430px swipeable action row

### Backlog / follow-ups (not built, per credit limit)
- Feed-level media-type filtering for teens (uploads ARE blocked server-side; feed render filtering pending)
- external_links/camera/mic/screen_recording stored but client-capability level only
- Weekly screen-time limit UI (field exists), preset cloning, audit search, scheduled routine activation UI (backend `active_when` supported)
- Frontend E2E testing of /parent, /my-limits, courses preview (user will self-test)
- Deployment failure root cause (SignUp.jsx corruption) FIXED — safe to redeploy

### ORAi Operating Assistant + Site Access Modes (June 2026, curl-smoke tested)
- `services/orai_platform.py` (admin-gated live platform snapshot, ACTION_CATALOG w/ [[action:id]] markers, page awareness) + `routers/orai_assistant.py` (/api/orai/assistant/chat|history, sessions in orai_assistant_messages)
- Frontend: `components/orai/OraiAssistantPanel.jsx` — global floating ✦ FAB, page context auto-sent, smart action buttons (navigate/api/client kinds; pause/resume signups founder-only, confirmed)
- Course Blueprint flow: POST /{cid}/courses/blueprint → editable approval card in CourseStudio (Approve & Generate / Regenerate / Discard); generate accepts `blueprint`; GEN_SYSTEM expanded to any topic (music production, business, trades, hobbies…)
- Site Access Modes: `services/site_access.py` + middleware (server-side 423), endpoints in admin_access.py (/api/admin/access-control/site-mode*, public /api/access-control/site-status), founder card in Settings→Admin (mode selector, per-mode title/message, Always-Allow search/bulk add/remove, per-mode Preview button), `components/SiteModeGate.jsx` full-screen gate (signin/signup stay reachable). Mode left on LIVE.
- Guardian: /api/orai/assistant mapped to orai_chat permission for teens

### P0 Fixes: Video Playback + Regenerate Blank Page (Aug 2026, verified 390/430/1366/1920)
- **Blank page root cause**: `LessonVideoPanel.jsx` used `<StyleSelector>` in EstimateModal without importing it → ReferenceError crashed the React tree on Generate/Regenerate. Fixed import; added `VideoPanelBoundary` crash guard (inline error + Reload panel, editor/edits never lost). App has catch-all route `*→/` so no blank routes possible.
- **Color-bar root cause**: NOT a bug — AI Video Settings `dry_run: true` (settings doc confirmed); clip is intentional ffmpeg testsrc2 placeholder. All existing jobs were dry_run.
- Dry-run labeling: "DRY RUN TEST CLIP" chip in LessonVideoPanel + ActivityBlock learner badge (`video_dry_run` flag; backfilled 5 legacy blocks from ai_video_jobs). Modal button: "Approve & Generate (FREE dry run)".
- Founder Video Diagnostics: new `components/rc/VideoDiagnostics.jsx` — collapsible (collapsed default) under each video block; shows dry run, provider, job id, statuses, storage/asset/player URLs, MIME, size, last error/retry, timestamps, verdict; Copy Diagnostics / Refresh Status / Open Video Settings (new tab → /admin/ai-video, preserves edits). Backend `/api/admin/ai-video/diagnose` extended: settings_dry_run, mime_type, created/finished_at, last_error, R2 head-check (storage_location + real byte size — local disk check alone falsely reported "missing").
- No paid generation was run ($0 spent). Real-video test after founder turns Dry Run OFF still pending user approval.

### ORAi → Build-Agent Bridge v1 (Aug 2026, founder-only, E2E verified)
- Minimal bridge: ORAi chat drafts a `preview_build` request → founder approval card → approved prompt runs through the EXISTING internal build workflow (`services/llm_router.call_llm`, same engine as Game Studio) → self-contained HTML preview rendered sandboxed (iframe allow-scripts, no fetch/XHR/external resources) at admin-only `/admin/previews/:buildId`.
- New: `backend/routers/orai_builds.py` (collection `orai_preview_builds`; GET /api/orai/builds/{id}, POST /{id}/approve, both `require_founder`; regex blocklist: production deploy, migrations, delete files/data, auth, billing, secrets/env — checked against the founder's ORIGINAL message, not ORAi's rewritten prompt, to avoid negation false positives), `frontend/src/pages/AdminPreview.jsx`, `PreviewBuildActions` in `OraiAssistantPanel.jsx` (Approve and Build Preview + Copy for Emergent buttons, 3s polling, result message with route + changed files + Open Preview action).
- Modified: `orai_assistant.py` (draft branch, follows edu-plan/game-estimate card pattern, audits via orai_audit), `server.py` (router), `App.js` (route).
- NOT a repo writer: "changed files" are virtual sandboxed artifacts. Emergent platform agent has no callable API — "Copy for Emergent" gives a paste-ready instruction for the real repo path.
- Verified: FAQ + banner builds E2E (draft→approve→build→preview render), billing prompt blocked with polite ORAi explanation, non-founder 403.

### P0 Game Creator Runtime Overhaul (Aug 2026, E2E verified, self-tested)
- ROOT CAUSE of "everything becomes a TAP game": only 5 content runtimes existed (quiz/matching/sorting/memory/rhythm) — zero movement/arcade runtimes; EST_SYSTEM forced the LLM to pick among them; hard fallback `plan["runtime"]="quiz_adventure"` silently substituted; complexity only changed prompt text; ORAi chat hardcoded complexity=2/power=5 ignoring "Complexity 3" requests.
- 4 NEW sandboxed runtimes in `GameRuntime.jsx` (one data-driven renderer, 9 families total): `dodge_collect` (canvas arcade: falling cores/hazards, drag/keys, speed ramp), `top_down` (arena: 4-dir movement, patrol+chaser hazards, obstacles, finish portal), `platformer` (gravity/jump, %-coordinate platforms, spikes, goal, on-screen touch buttons), `puzzle_room` (riddle/code/sequence/choice puzzles, hints, room progression). Shared engine: lives ♥ HUD, combo multiplier (x1.0-x4), checkpoints, achievements, unlockables, best-score/progress save via postMessage→localStorage (`gameId` prop, sandbox has opaque origin), stage fade transitions, game-over/results screens, glow FX.
- `game_studio.py`: deterministic `GENRE_MAP` router (action can NEVER silently become rhythm/quiz — reroutes with honest substitution notes), RUNTIME_LABELS/RUNTIME_MECHANICS/COMPLEXITY_FEATURES contracts, plan enriched (runtime_label, mechanics, unsupported_mechanics, substitutions, gameplay_summary, stages by complexity: 1/3-5/5+, est_play_minutes, save_features), SPEC_SYSTEM schemas for new runtimes, validate_spec(complexity) enforces stage minimums + combo/achievements at C3 + difficulty ramp; _run_build forces the routed runtime (`spec["runtime"]=game["runtime"]`), strips combo/checkpoints/unlockables below C3, passes plan+complexity contract to the builder.
- `orai_assistant.py` game branch parses "Complexity N"/"AI Power N" from chat + card shows runtime/mechanics/substitutions. `AdminGames.jsx` enhanced estimate card (Runtime Selected / Stages·Play Time / Save Features / Mechanics chips / Complexity Features / Honest limits & substitutions) mirroring the reference design. gameId passed to GameRuntime in AdminGames + GamesHub.
- VERIFIED: 9-genre router unit test all pass; "Neon Core Rush" C3/P5 rebuilt as dodge_collect (5 stages, ramp fall 120→268/spawn 900→450, 3 lives, combo, checkpoints, 5 achievements, 3 unlockables) and PUBLISHED to /games; 7 RTTEST fixture games (status approved, founder-only) prove every family renders distinct gameplay; ORAi chat "escape room Complexity 3 Power 4" → Puzzle Room C3 P4; mobile 390×844 + desktop verified. RTTEST fixtures left in studio for founder inspection (delete anytime).
- KNOWN GOTCHA: search_replace on game_studio.py corrupted once (duplicate tail lines) — always `python3 -c "import ast; ast.parse(...)"` after batch edits to this file.

### Game Creator Level Unlock + Founder Access Settings (Aug 2026, verified)
- MAX_COMPLEXITY 3→10; sliders fully unlocked (Complexity 1-10, AI Power 1-10); removed frontend `Math.min(complexity,3)` clamp + `lockedAbove={3}`.
- Complexity 4-10 honestly extend Phase 1: `min_stages_for(c)` = 5+(c-3) stages, `complexity_features(c)` extends the C3 contract; validate_spec + build contract handle all 10 levels (combo/achievements required at ≥3).
- Founder settings: `game_studio_settings` doc; GET/PATCH `/api/admin/games/settings` (founder-only, audited, routes placed BEFORE /{game_id}); modes all/range(min-max)/custom(level picks) for both Complexity and AI Power; `levels_from(cfg)` helper. Founders always keep 1-10; config gates non-founders via the game_creator access-policy flow (enforcement stub in estimate route — activates when creation opens beyond founders).
- UI: `AccessConfig` component + collapsible "Game Creator Access" panel in AdminGames; Slider now takes `allowed` array (lock icons + disabled estimate for disallowed levels).
- Verified: C5/P6 estimate → top_down, 7 stages (then cancelled, $0 build); PATCH range/custom/all roundtrip; UI slider at 8 unlocked; access panel modes/chips/save work. Settings currently mode=all/all.

### P0 Runtime Visual Asset System v3 (Aug 2026, verified) — Complexity/Power now visibly scale
- ROOT CAUSE of "C10 looks like C6": renderer only had geometric primitives (triangle/circle/diamond) and one vertical mode; complexity only changed stage counts/params.
- `GameRuntime.jsx` v3: procedural asset painters (paintPlayer hover vehicle w/ thrusters+canopy+fins+shield bubble+boost flames, paintCore pulsing orb+ring, paintHazard families: drone/barrier/seeker/mine, paintShieldPickup hex, paintBoostPickup chevrons, paintPortal animated arcs+orbiting particles) + 7 layered parallax environments (cyber_city w/ lit-window skylines, space starfield+nebula, sunset, crystal, lava w/ ember rise, tunnel rings, grid) + particles/burst/popups/screen-shake/stage banners/canvas HUD (core counter, shield count, boost meter, env·mode label).
- Dodge & Collect 6 presentation modes: vertical | lane_runner (discrete lanes, tap-side/keys) | road_3d (perspective road, z-projection, neon rails+lane dashes) | space_flight (horizontal, free 2D) | arena_360 (edge spawns) | tunnel (road_3d variant + oscillating rx). Per-stage: mode, environment, hazard_types, pickups{shield,boost}, formation (zigzag/line/arc/random), lanes. Shield absorbs a hit; boost = 4s speed/multiplier.
- `game_studio.py`: SPEC_SYSTEM visual_theme (env/player/palette) + per-stage variation schema + VISUAL SCALING contract (C4-6: theme+2 envs+2 hazards+pickups; C7-10: ≥4 distinct envs, ≥3 hazard kinds, shield AND boost — enforced in validate_spec); EST plan.visual_plan {presentation_mode, visual_style_summary, player_appearance, environment_themes, hazard/pickup counts, stage_visual_groups, fallback_shapes, visual_warning (honest: UI runtimes can't scale visually / C1-3 = basic shapes)}; AI Power ≥7 adds ART DIRECTION PASS (extra LLM pass enriching visuals/variation, re-validated). AdminGames card: "Presentation & Visual Plan" purple section.
- VERIFIED: Neon Core Rush: Velocity Demo rebuilt C10/P10 ($0.45, passes: spec→refine→art_direction) — 12 stages, 7 envs, 4 modes, all 4 hazard kinds, shield+boost, PUBLISHED to /games (id 5b171783b8714cc8a63be54ca0105d39). Screenshots confirm: perspective neon road + cyber-city + hover vehicle + glowing cores + boost pickups (stage 1), lava lane-runner, space flight w/ BOOST popup, tunnel rings — no placeholder geometry. RTTEST mode fixtures added (Lane Lava / Space Flight / Tunnel Run).
- DEFERRED (user pivoted): Phase 1.5 (sounds, leaderboards, achievements engine, Fire Power rewards via fire_vault.credit_fire, course mini-games, player progression) — ask_human options were sent but superseded by this P0.

## 2026-06 Fork — Phase C fully complete (all 21 runtimes live)
- Farming crop picker fixed: empty plot tap → `frm-plant-<Crop>` chips + cancel (iter 116 gap closed).
- Roguelike / Tactics / Idle / Visual Novel / Fishing fully implemented (backend classification + spec schemas + validation; frontend engines in GameRuntime.jsx). SCAFFOLDED_RUNTIMES now empty.
- 5 founder-preview demo games imported (label `runtime-test`, approved/unpublished): rgl 3a0f96ab, tac 8d4fec1e, idl 70f57f67, vn 410bf9e8, fsh 59b4e1ca.
- Validated by testing agent iteration_117 (backend 13/13, frontend 100%). Regression pytest: /app/backend/tests/test_phase_c_iter117.py.
- Remaining backlog: publish/curate showcase games for the 5 new runtimes; optional per-runtime file split of GameRuntime.jsx (1386 lines).

## 2026-06 — Cover Art Workflow (P0) COMPLETE
- Every game (existing + future) has an optional founder-approved cover flow: suggested prompt, est cost, generate/regenerate/edit-prompt/upload/remove/restore-previous, missing-covers list + bulk generate with total cost approval. Exact 4:5 card crops (832×1040), original + crop + meta + history stored. Honest text-card fallback retained; broken images auto-hidden.
- E2E tested on "Bake the Fraction Feast" — now has a generated cover live on /games.

## 2026-06 — Dragon Realm: The Fire Quest (vertical slice COMPLETE, awaiting founder verification)
- Phase 1 audit + contract and Phase 2 Enchanted Forest slice done per user directive: no FP burning, rewards 25/10/100 founder-only admin-configurable, real Fire Vault ledger, idempotent/replay-proof claims.

## 2026-06 (later) — Dragon Realm FULL WORLD BUILD (Phases 3 & 4) COMPLETE + VERIFIED
- 6 regions / 36 dragons / 6 bosses served from backend content (services/dragon_realm.py); region_order gating server-enforced.
- Multi-phase LEGENDARY DRAGON KING: P1 two support heads (multi-target UI) → P2 King joins → P3 transform +80HP + ULTIMATE CATACLYSM channel (interrupt with 18+ dmg or Defend) → P4 FINAL WARDEN STRIKE finisher overlay.
- Bugs fixed this session: (1) engine.act() early-return blocked the P4 finisher (fight was unwinnable) — fixed; (2) REGION_ORDER was imported by DragonRealmRuntime but never exported from engine.js — added; (3) Games Admin Panel had NO Dragon Realm section — added DragonRealmAdminPanel.jsx (enabled, access_mode, all 8 reward amounts, per-user progress reset w/ reason+audit) wired to GET/PUT /api/dragon-realm/admin/config + POST /admin/reset-progress; (4) game was status 'approved' not 'published' → not in /games hub — published (id dragonrealm-firequest-v1); (5) stale stored game_version → 0.2.0-full-world.
- Testing: iteration_119 — backend 12/12 pytest (locking, rate-limit 4s, king gate, claim idempotency vault +100 exact then 400 'Already claimed' no double credit, claim-all, admin config, reset), frontend 100% on tested surface. Manual browser E2E: all 6 region explores + all 5 region bosses screenshotted; full in-browser Dragon King fight through all 4 phases, finisher click won, WARDEN overlay, boss_dragon_king claim moved vault 906 → 1,156 (+250 exact).
- Per-region chiptune music (WebAudio, per-region key/tempo) plays in explore only; options toggles persist.
- NOTE: founder's current save has an E2E test wizard (Lv20, boosted stats) and ~830🔥 of unclaimed rewards left to enjoy; Admin → Dragon Realm → Reset Progress gives a fresh authentic playthrough (new epoch, rewards re-earnable).
- Pending (user-gated): Phase 5 polish (flame particles, accessibility pass), Phase 6 beta validation, Fire Power burning (explicitly ON HOLD until instructed).

## 2026-06 — ORAi Multi-Tool Project Creator (COMPLETE, verified iteration_120)
- Founder-only Project Creator at /admin/orai (primary ORAi landing; old dashboard at /admin/orai/dashboard).
- Workflow: ORAi Chat (reuses assistant endpoints, chat-first desktop+mobile) → Tools → Providers (connected via Emergent key; ElevenLabs/Runway/Pika/Stability/Replicate registered but disabled 'Not connected') → 3 Smart Suggestions → Complexity + AI Power sliders → dynamic per-tool settings + Existing Sound picker (server-side eligibility) → debounced real-time estimate (labeled internal estimate / provider price table) → Review + Validation + explicit Approve → idempotent async background job with persisted stages, live outputs, refresh recovery, cancel/retry → Complete page (estimate vs actual usage) → History (duplicate/archive, paginated).
- Permanent library: orai_assets records + images into Media Library, narration into private Sounds tracks (playable_only default), games via Game Studio, courses via Course Maker (needs a Responsibility Center — founder currently has none, tool disabled with reason).
- Key endpoints: /api/orai/projects/{capabilities,suggest,estimate,sounds/eligible,draft,library} + /{id}/{validate,approve,cancel,retry,duplicate,archive}.
- NOT executed by design: Sora video + full game/course generation in tests (expensive); video estimates use the sora price table; suggestions never pick disconnected providers.
- Pending backlog: P1 preset saving from a finished project; P1 library admin controls page (search/retag/feature); P2 duplicate-detection (hash) on generated assets; P2 provider health probes for creative providers.

## ORAi Projects AAA Upgrade — Phases 1-14 (Aug 4, 2026) ✅ COMPLETE
**P0 routing repair (same session):** obsolete `gpt-5.4*` → `gpt-5-nano/-mini/gpt-5`, AI Power 9→gpt-5.6-luna, 10→gpt-5.6-terra, all-tier direct OPENAI_API_KEY (Emergent = fallback only), temperature stripped for gpt-5 family (was forcing every call onto Emergent → budget errors). Production "ORAi hit a snag" = stale pre-repair deploy + a new `ctx.page` AttributeError in diagnostics (fixed → `ctx.path`). **User must redeploy for production fix.**
**Env repairs:** frontend dev server restarted (stale REACT_APP_BACKEND_URL baked in), CORS_ORIGINS="*" was rejected by wildcard guard → explicit list (ourrealm.social + realm-deploy preview + localhost). True preview host: https://realm-deploy.preview.emergentagent.com
**New systems (all planning-only, founder approval gate everywhere, nothing generates):**
- `services/game_blueprints.py` + `routers/game_blueprints.py` (`/api/orai/projects/blueprints/*`): versioned AAA blueprint schema v1 (identity/runtime/gameplay/systems/media/meta — family-agnostic), plan/revise/runtime-change/duplicate/approve/cancel, asset-requirement derivation + library matching, media-package plan (11 items + store copy), diagnostics (provider/model/duration/request_id/fallback/validation), `orai_routing_events` + `/diagnostics/health`.
- `services/asset_library.py`: universal library `game_asset_library` (29 categories, fingerprint dup-detection, favorites, usage, recent, versions), backfill from orai_assets (no file duplication), scored requirement matching.
- `services/sprite_studio.py`: auto/manual slicing, 11 standard states, fps, hitboxes, runtime export manifest — `/library/{id}/sprite-slice`.
- `services/game_editor.py` + `routers/game_editor.py`: whitelist no-regen editing + snapshots/rollback (`game_edit_versions`, 20 kept), Remix (7 types, original never modified), Release Modes (6 modes + badges/users/level/fire/beta reqs; enforced in /api/games hub; founder override; legacy games unrestricted).
- Frontend: `BlueprintPlanner.jsx` (planning preview: summary/runtime/mechanics/assets/decisions/stages/validation/controls), `AssetLibrarySearch.jsx` (instant search, filters, favorites, sprite preview), blueprint CTA in OraiProjects.jsx. Chat error contract hardened (success flag, error_code, request_id).
- Router order: game_blueprints + game_editor registered BEFORE orai_projects (literal paths beat /{pid}).
**Validation:** Phase 14 regression 10/10 families planning-only (platformer/rpg/card_battle/tower_defense/match3/puzzle_room/board(honest match3)/fantasy arena(top_down 0.9)/visual_novel/light-3D(top_down + honest 3D warning)). All direct OpenAI gpt-5-mini. Zero media, zero builds. UI E2E: chat no-snag + planner + library panel verified in browser.
**Remaining/tech debt:** editor/remix/release-mode founder UI (API-only today); library thumbnails rely on preview_url; sprite preview assumes 48px cell; member games-hub still founder-gated by access policy (pre-existing); production redeploy pending.

## Phase 15 — Blueprint → Build Engine (Aug 4, 2026) ✅ COMPLETE
- `services/game_build_engine.py`: pipeline Blueprint → Runtime Selection → Asset Resolution (library → upload → placeholder → deferred, NEVER auto-generates art) → Project Assembly → Scene Creation (12 scene types, deterministic graph w/ dup-ID + broken-link checks) → Gameplay Generation (reuses game_studio's vetted `_run_build` spec builder + validate_spec) → Runtime Validation → Founder Review gate → Playable Build.
- Routes: GET `/blueprints/{bid}/build/review` (validation + estimates, never builds), POST `/{bid}/build/approve` (ONLY build trigger, rate-limited 10/hr), GET `/{bid}/build/status`.
- Build output = `games` doc: spec (validated), scene_graph, asset_resolution, game_package (logo/icon/cover/screenshots/music/sfx/tutorial/loading placeholders + store/achievement/world-map metadata, media_generated:false), build_meta (engine v1, blueprint link), fire_economy, release founder_only, edit_version 0 → fully compatible with Universal Game Editor (patch+rollback verified) and Remix (clone verified, original untouched). Library deps get usage + used_in_projects tracking.
- UI: `BuildReviewPanel` in BlueprintPlanner (approved state) — review chips, Approve Build/Save draft/Cancel, live build progress polling, done state.
- **Reference build validated:** "Moonlit Wizard Arena" (top_down, complexity 1, AI Power 3, $0.04, 2 LLM passes): validate_spec 0 errors, stage has waves+hazards, 11 scenes, pending_approval (publish gate intact), renders playable in sandboxed mobile+desktop runtime (screenshot verified). No artwork/audio/video generated.
- Remaining: build engine UI polish (revise-from-review), uploads flow into asset resolver (searches library by req tag today), Dragon Realm NOT built (restricted).

## Trust & Safety Command Center + ORAi Moderation (Aug 4, 2026) ✅ COMPLETE
Extends (never replaces) services/moderation.py + content_safety.py into a unified ORAi-powered T&S platform.
- `services/trust_safety.py`: 12-dimension scoring (spam/toxicity/harassment/hate/scam/sexual/violence/self_harm/illegal/impersonation/bot_probability/confidence) incl SQLi + impersonation + behavioral (duplicate fingerprint + rate); progressive Trust Score (0-100, factors: age/email/phone/violations/reports/mod-actions/appeals/rate) → 4 tiers (limited/standard/trusted/veteran) with per-day posting/comment/DM caps + livestream/realm-creation unlocks; escalation ladder (warn → temp-limit 24h → AUTO-LOCK pending founder review at 2 severe/5 total in 24h) — hides posts+comments, sets 72h suspension; NL command parser (20+ intents); bulk actions (21); undo w/ inverse map; appeals. **AI never permanently bans/deletes — CONFIRM_REQUIRED gate + founder-only routes.**
- `routers/trust_safety.py`: `/api/admin/trust-safety/*` (dashboard, queue, case/{id} full context, command, bulk/{uid}, case resolve, audit, user trust, appeals + resolve) all `require_founder`; `/api/appeals` user-facing (submit + mine).
- Hooks: `moderation.scan_and_apply` fires `on_content_scanned` (async task) on every scan across posts/comments/messages/images/videos/communities; `ensure_not_limited` now also enforces trust-tier daily rate caps (fail-open); reports now store resolved `target_user_id`.
- Frontend: `AdminMTrustSafety.jsx` (`/admin/trust-safety`, lazy) — dashboard cards, ORAi recommendations, trending abuse, priority queue, case detail (trust/timeline/violations/posts/DMs/audit), NL command bar w/ destructive-confirm prompt + undo, 21 bulk-action chips, appeals tab. AdminHub tile updated (legacy Moderation Center kept).
- New collections: ts_events, ts_cases, ts_audit, ts_appeals, ts_username_history. User fields: trust, ts_status, account_limits, require_*.
- Validation: 25/25 backend checks (SQLi detection, trust decrease, auto-lock pending review, queue populated, content hidden, locked account blocked, all NL commands, bulk actions, undo, appeals restore, audit AI+human decisions, **NO AI-only permanent bans**); API 200s + non-founder 403; UI smoke verified; posting regression clean.
- Remaining: IP/device history surfaced as "unavailable" (not tracked); livestream/realm-creation unlock flags computed but consuming features must read `trust.limits`; LLM-assisted scoring still uses rule triggers (content_safety vision already separate).

## P0 — ORAi "Hit a Snag" Production Regression (Aug 4, 2026) ✅ FIXED IN PREVIEW — awaiting redeploy
ROOT CAUSE: production (ourrealm.social) runs OLD pre-repair code + a SEPARATE database (founder stealth/Password1$ works in preview, 401 in prod — cannot log into prod). The ctx.page→ctx.path AttributeError fix + structured-JSON contract + frontend duplicate-render fix were never deployed to prod. Prod API/CORS/auth all healthy (preflight returns access-control-allow-origin: https://ourrealm.social); the snag is purely stale code.
DUPLICATE-RENDER ROOT CAUSE: `OraiProjectChat.jsx` called `onUsePrompt(msg,{silent:true})` on every send, auto-filling the Project Summary → the prompt appeared both in the chat thread AND as a summary card. Fixed: prompt only fills when the user taps "Use as project prompt". Placeholder text updated.
CONTRACT: success responses now include success/assistant_reply(+reply alias)/request_id/provider/model/conversation_id(+session_id)/fallback_used; failures already return success:false/error_code/message/request_id (founder-only detail). Verified preview: "Reply with only: production ORAi is working." → 200, provider openai, model gpt-5-mini-2025-08-07, fallback False, reply once, no snag, prompt box NOT auto-filled, user msg appears once.
CORS HARDENING: added `allow_origin_regex` for `*.emergent.host` + `*.preview.emergentagent.com` (additive) so redeploy can't break CORS on either the custom domain or Emergent-managed domain; untrusted origins still blocked.
Files: routers/orai_assistant.py (contract), components/oraiprojects/OraiProjectChat.jsx (dup fix), pages/OraiProjects.jsx (placeholder), server.py (CORS regex). Deployment_agent: pass (only pre-existing seed-password warn + now-resolved CORS note). Planning smoke re-verified 200/top_down/no media/no build.
ACTION REQUIRED: user must click **Deploy** in Emergent to push preview→production. I cannot deploy or access prod.

## P0 — Production ORAi Backend Mismatch (Aug 4, 2026) — DIAGNOSED + HARDENED, awaiting redeploy
EVIDENCE: prod frontend bundle IS new (chat copy + dup-fix live) but `GET https://ourrealm.social/api/health/version` → 401 (route absent = backend running the OLD build), while preview returns the full build marker `2026-08-04-ts-p0-cors500`. Conclusion: last deploy updated the frontend but the production BACKEND did not rebuild/restart with the repaired code (partial deploy).
SYMPTOM MECHANISM (why the snag is generic): Starlette ServerErrorMiddleware sits OUTSIDE CORSMiddleware → an unhandled 500 carries NO Access-Control-Allow-Origin → browser blocks the response → axios has no e.response → frontend falls to its last-resort "ORAi hit a snag — try again." string.
FIXES (in preview, ship on redeploy):
- Global `@app.exception_handler(Exception)` in server.py: any unhandled error now returns `{success:false, error_code:"internal_error", message, request_id}` WITH manually-echoed CORS headers for trusted origins (explicit list + emergent.host/preview regex); untrusted origins get no ACAO. Verified via TestClient: trusted→500+ACAO+contract, emergent.host→ACAO, evil.example.com→blocked. Traceback logged server-side with ref id.
- Public no-secret `GET /api/health/version` (in PUBLIC_API_PATHS): build marker + feature booleans (ctx_path_fix, structured contract, CORS-500 handler, routing, temp strip, build engine, T&S) + env presence booleans (openai_key_set, emergent_key_set, cors_origins_count, db_name_set). Lets anyone verify WHICH build production runs and whether prod env has LLM keys.
- Chat success contract already includes success/assistant_reply/reply/request_id/provider/model/conversation_id/session_id/fallback_used — re-verified with exact phrase "Reply with only: production matches preview." → 200, openai/gpt-5-mini-2025-08-07, fallback false.
POST-REDEPLOY CHECKLIST (user): 1) open https://ourrealm.social/api/health/version — must show backend_build 2026-08-04-ts-p0-cors500 and openai_key_set:true (if false → env var missing in prod, contact Emergent support). 2) ORAi Projects chat: "Reply with only: production matches preview." 3) wizard-arena planning smoke. Mobile Safari + desktop.

## 2.5D Action RPG Runtime + Asset Wiring Pipeline (Aug 5, 2026) ✅ COMPLETE — see CHANGELOG.md for full detail
- Asset Wiring Pipeline (library-first reuse → generate missing only → spec.assets → runtime slot adapters → renderer), publish gated on required assets, art presets (fantasy_hd default for arpg).
- action_rpg_2_5d: permanent first-class real-time runtime (runtime_action_rpg_2_5d_v1), fully registered across planner/registry/contracts/editor/controls/asset slots.
- Proof game 254523a78f694547ac36a6845e037e92 in FOUNDER REVIEW (unpublished) — awaiting founder approval.
- Dragon Realm batch v2 HALTED with v1–v3 built+wired UNPUBLISHED (/tmp/dragon_v2_state.json resumable) — do not restart unless founder asks.

## Phase 16 — P0 Spec-Pipeline Fix + Shared Runtime/Asset Foundation (Aug 7, 2026) ✅ COMPLETE
**P0 ROOT CAUSE (misleading "unknown runtime"):** action_rpg_2_5d was registered correctly everywhere. Real failure: spec-gen token budget (~6k, AI_POWER_TIERS) is shared with gpt-5-mini's internal *reasoning* tokens → JSON output truncated → both passes unparseable → spec stayed {} → validate_spec reported bare "unknown runtime".
**Fixes (services/game_studio.py):** spec-gen calls now pass max_tokens = max(tier*3, 16000); new `parse_spec_json()` salvage (fences + balanced-brace extraction); honest validation errors ("spec generation produced no valid JSON…", "runtime 'x' not in the engine runtime registry"); missing runtime field auto-filled from the hard contract; request capped at 4000 chars in user_msg.
**P0 acceptance (REAL pipeline run):** blueprint 853c66b5… "JUNGLE RUINS TO NEXUS PORTAL" (action_rpg_2_5d, C5/P5) → build approve → game a1fa88be6bdf48c5bf28b0fab18fb1dc → first spec pass parsed clean, 5 validated regions (forest/ruins/caves/swamp/castle+boss), pending_approval, $0.06. Asset wiring: 0 library reuse (no Dragon Realm art), 11/11 slots generated+wired (~$0.77), playable preview screenshot-verified with real sprites/parallax. No runtime switching, no card_battle fallback, no fake unsupported warnings.
**P1:** `RUNTIME_ENUM = "|".join(RUNTIMES)` in game_studio — EST_SYSTEM + game_blueprints PLAN_SYSTEM enums now derived (were hardcoded, missing action_rpg_2_5d); routing hints + player_representation updated. Aliases/back-compat untouched.
**P2:** `services/game_platform/asset_animation_foundation.py` — asset_roles registry (17 roles incl parallax_layer, derived from game_assets.SLOTS + RUNTIME_SLOTS) + animation_states registry (11 sprite_studio states, core=idle/walk/jump) via existing Registry engine; GET /api/orai/platform/asset-profile/{family} inspection (foundation families answer honestly with no slots). Registries overview now 14.
**Tests:** tests/test_runtime_foundation_iter125.py (7 passed); stale assertions fixed in test_arpg_iter122 (placeholder<=20) + test_game_platform_iter121 (14 registries); full arpg+platform suites pass.
**Remaining:** Jungle game awaits founder review/publish; icon_set+ui_frame were generated in a 2nd job after ceiling skip; game content is the pipeline's interpretation (2-level Jungle/Nexus fine-tuning via editor/remix if desired); MMO/RTS/sandbox etc still foundation-only by design; production redeploy pending (user deploys).

## Phase 17 — Reference-Match Overhaul: Jungle Ruins to Nexus Portal (Aug 7, 2026) ✅ COMPLETE
Gold-standard rebuild of game a1fa88be… to match the two founder reference images. All changes live in the shared side_scroll mode of action_rpg_2_5d (arpgSS in GameRuntime.jsx) — every future side-scroll game inherits them.
**Runtime/OPC systems improved:**
- Classic D-pad control profile (mobile): fixed 4-way D-pad (data-testid ss-dpad-*) + A/B/X/Y diamond buttons (ss-btn-*: B=JUMP, A=ATTACK, X=ABILITY, Y=DODGE), press-and-hold, simultaneous inputs, hold-to-repeat attack/ability, hold-B bunny hop. Drag-joystick removed for side_scroll. Desktop keys/gamepad unchanged.
- 5-layer parallax: background (0.18) + painted background_near midground (0.45, alpha .5 + depth-haze gradient, replaces procedural silhouettes) + procedural fallback + gameplay + foreground overlay (1.3, bottom 32%, drawn over hero). New asset slots background_near/foreground (transparent, chroma-keyed) + _l2/_l3 variants in SLOTS + RUNTIME_SLOTS.
- ambient:"bright" stage flag (dim 0.20→0.05, vignette 0.4→0.14); hero_scale per stage (jungle uses 1.3 → ~135px hero); zone:"nexus" (starfield, nebulae, floating-rock silhouettes, void hazard with purple mist, cyan/purple embers).
- Grand portal renderer: stone ring w/ 8 glowing studs, animated inner swirl, orbiting particles, ground light pool, sealed state (dark + key icon) — size via exit.size.
- Key-locked exits: exit.requires_keys — portal sealed until keys collected (+ boss dead); HUD objective + "portal is sealed" hint.
- Ending sequence: stage.ending/ending_title/ending_subtitle → cinematic "PART 2 / COMING SOON" canvas overlay then completion.
- Compact HUD: portrait chip (character_portrait), thin hp/mana/xp bars, hearts/Lv/coins/keys row, top-right objective + level chip. Old 206x72 panel gone.
- Platform polish: top rim highlight, under-shadow for floating platforms, nexus body palette.
- Animation QA (game_assets._anim_qa): sprite strips checked for per-frame alpha coverage + inter-frame pose diff, auto-retry once on fail, meta.anim_qa stored. Wired hero sprite passes (diffs 9.9-14.4).
- validate_spec: side_scroll boss now required on ≥1 level (was every level); SPEC_SYSTEM documents full side_scroll schema for future LLM builds.
**Authored content (scripts/author_jungle_spec.py):** L1 Ancient Jungle Ruins (4400px, 20 platforms, upper/lower routes, underground key forcing real backtrack, 6-step pyramid ascent+descent, 2 bridges, 4 checkpoints, 3 chests, 8 enemies, Jungle Titan boss, key-locked grand portal). L2 Nexus Portal Realm (3200px, 15 floating platforms incl. moving+crumbling, NO ground, void respawn, 4 enemies, nexus key, chest, ending portal → PART 2 COMING SOON).
**Art:** 13 new premium coordinated assets (L1: bg/near/fg/tileset/hero/enemy/boss/portrait, L2: bg_l2/near_l2/fg_l2/tileset_l2/enemy_l2), custom prompts, ~$0.91 provider.
**Verified via scripted playthroughs (screenshots):** bright layered jungle w/ large hero ✓, key collect + 🗝n/n HUD ✓, sealed portal + hint ✓, open grand portal ✓, level transition ✓, nexus level w/ floating platforms ✓, void fall→checkpoint respawn ✓, PART 2 COMING SOON overlay ✓, mobile D-pad hold-move + jump ✓, pytest suites pass, legacy games unaffected.
**Known limits:** hero animation = 4-frame QA'd run strip + procedural pose blending (not per-state authored sheets); vertical routes bounded by 360-unit screen (underground = cave-dressed lower tier); UP/DOWN reserved (no ladders yet); boss fight not scripted-played E2E (pre-existing Dragon Realm system, unchanged).

## Phase 18 — True 2D Vertical World + Camera + Controls v3 (Aug 7, 2026) ✅ COMPLETE
Founder mandate: strict 2D gameplay plane, scrolling camera (X **and Y**), vertical multi-tier map, no death pits in L1, circular translucent controls (NOT Game Boy), double jump, 2-3x item/portal prominence, key/portal reliability. All changes in shared arpgSS runtime (GameRuntime.jsx).
**Engine (arpgSS):**
- Vertical world: `st.world_h` (>360 units) + smooth camY follow w/ dead-zone (0.30-0.68 view band), faster snap on ground, clamped to world bounds; world rendering wrapped in translate(0,-camY); bg/mid/near layers get slower camY parallax (0.14/0.25/0.42/0.45); hazard strips moved to world bottom; vignette + depth-darkening (deeper = darker, torch-lit feel).
- `st.ground_default`, platform `depth` (capped terrace fill) + `deep` override (floating islands); groundYAt honors world height.
- Double jump (air jump -470, `st.double_jump!==false`), landing resets, desktop key-edge detection.
- Keys survive death respawn (resetLevel(keepCp) preserves collected key picks + keysL) — fixes "collected key lost on death".
- Feature `y` + prop `y` placement (multi-tier), new 'arch' decorative glowing doorway feature.
- Items 2-3x: 38px pickups w/ glow halos (key/potion/fire/star/mana), 50px chests w/ gold glow, 78-unit checkpoint flags.
- Portal: color option (st.exit.color, L2 purple #B26BFF), spec sizes 2.0/2.2 → massive set pieces; sealed shows key icon.
- Controls: circular translucent glass buttons — ◀ ▶ left; ➠ ✦ ⚔ + big ⬆ jump right (testids ss-dpad-left/right, ss-btn-*); press-hold, simultaneous, cooldown dimming. D-pad grid removed.
**Map v3 (scripts/author_jungle_spec.py):** L1 3400x720: surface tier (300) → branch gap drops to underground ruins (480, torches/arch/chest) → stairs to deep caves (660 full-width safety floor — NO bottomless pits) holding the Ancient Key → return stair column (600→330) rejoins surface → pyramid ascent (132 summit) → bridge → Jungle Titan → key-locked portal. L2 3000x540 floating nexus islands, void respawn, purple final portal, PART 2 COMING SOON.
**Verified (scripted playthroughs + screenshots):** tier fall + camY scroll-down (debug: x886 y458 camY169) ✓, underground torch scene ✓, checkpoint ✓, stairs ✓, key collect→portal open→L2 transition (Score 40, stage 2/2) ✓, sealed portal + key icon + 0/1 HUD ✓, ending overlay "PART 2 / COMING SOON" under v3 ✓, mobile circular controls move+jump via dispatch ✓, hero reference-scale on mobile ✓, esbuild pass, legacy games unaffected (region-mode untouched).
**Notes/limits:** scripted E2E of real map's full loop is timing-flaky (combat knockback) — mechanics proven on deterministic twin; boss kill not script-played (unchanged Dragon Realm system); UP/ladder traversal not implemented (stairs = platform steps); checkpoint X-trigger picks highest tier at that x.

## Release Validation — Critical Path Freeze (Jun 2026) ✅ PASS, NO CHANGES MADE
Credit-conservation finalization: all art/assets/mechanics LOCKED per founder. Re-ran e2e_graybox_drive.py + one mobile check.
- L1: load ✓, move/jump ✓, key pickup ✓ (P4 PASS), ladder ✓, pyramid ✓, portal unlock/entry ✓ (P10/P11 PASS), enemy/boss path traversed w/ fight=True ✓
- L2: loads w/ key carried ✓, platform crossing ✓ (P12 PASS), final portal ✓, ending "DEMO COMPLETE" modal + PART 2/COMING SOON canvas overlay ✓ (P13)
- Mobile: 6 glass buttons render; right-hold moved hero 90→348; jump tap airborne ✓ (PASS)
- Cosmetic notes (documented, unchanged): none release-blocking found.
- Zero code/asset modifications this session.

## Public Games Release (Jun 2026) ✅ DONE — minimum-change build
Goal: /games public for ANY visitor (published games only), reusing existing Dragon Realm guest flow. Site modes, admin/ORAi/OPC protection, engines, art untouched.
**Backend:** game_urls.py + GET /api/public/game-path/hub (anon list of published+guest-visible games) and GET /api/public/game-path/meta/{id} (anon per-game meta, spec when guest allowed); resolve_path include_spec now acc.allowed; "meta" reserved slug. game_access_ctl.evaluate guest branch: mode "published" now guest-playable with public_preview flags (fire/keys/saves OFF for guests; signed-in reward flags unchanged).
**Frontend:** App.js GamesRoute (/games → authed GamesHub via ShellRoute, anon → new PublicGamesHub.jsx); GamePublicPage no-slug branch renders guest meta for anon; TopStarBar Games+RC icons always visible (routes still enforce access).
**Verified:** anon /games hub (28 games) ✓, guest play RTTEST Tunnel Run via slug page ✓, founder_only games excluded ✓, /api/games + /api/admin/* + /api/orai/* still 401 anon ✓, signed-in member hub + star icons ✓, deployment_agent PASS ✓.
**Intentionally unchanged:** invite-only platform gate still limits signed-in non-invited members' hub list (existing site-mode logic); RTTEST games remain listed because they are marked published (founder manages via existing controls).

## OurRealm Game Maker — Phase 1 (Aug 2026) ✅ COMPLETE — awaiting founder review before Phase 2
Master build: canonical public name "OurRealm Game Maker" (internal orai_*/OPC identifiers preserved, documented in memory/gamemaker_phase1_learnings.md).
**P0 Job system:** services/job_engine.py (persistent gm_jobs, phases, idempotency, cancel/retry, stale reaper, 30d TTL retention) + routers/jobs.py. orai-edit converted to job (202 + job_id, dry_run stays sync). Proven: 65s+90s simulated provider jobs return in <0.2s and complete in background. CRITICAL fix: sparse unique idx + explicit null idem_key.
**Engagement Resources:** services/resources.py + routers/resources.py — registry (fire/keys adapters, stars/coins/gems native), append-only resource_ledger, atomic resource_balances, replay-safe idempotency, audited adjustments (reason required), compensating reversals, freeze, per-user caps. Fire Power untouched (adapter parity test passes).
**Routes:** /gamemaker (public page, founder-only flag w/ modes founder_only|beta|signed_in|public), /gamemaker/saved, /admin/gamemaker (9 sections), /admin/gamemaker/studio (moved OPC), /admin/orai = ORAi dashboard, old deep links redirect (orai-projects, orai/dashboard, ?project= params).
**Frontend:** GameMakerPage.jsx exact replica of founder reference (gradient logo, GAME MAKER, 10 style cards + 10 runtime cards w/ 20 generated art thumbs, truthful Coming Soon on Open World RPG + Shooter, CHAT WITH ORAI, UPLOAD MEDIA, estimate→create→persistent job progress that survives refresh). GameMakerAdmin.jsx (overview/saved/jobs/published/resources/ledger/registry/diagnostics/access). GameMakerSaved.jsx (play/publish/publish+ForYou/unpublish/rename/archive). ResourceBalances strip in FireWalletCard. AdminHub Game Maker card.
**Publishing:** gamemaker_publish job — validates controls before flipping status, idempotent For You post (one post per game, republish updates it, foryou_post_id).
**Production visibility:** root cause = prod deploy predates repo seed_bundles (28 games auto-import at startup via existing game_promotion). Also built founder migration tool: /api/admin/gamemaker/migration/report (dry-run diff), /apply (insert-only, selected ids), /rollback; bundle backend/data/games_migration_bundle.json (31 published games). Redeploy → prod /games fills automatically; Diagnostics tab shows the dry-run report in prod.
**Testing:** iteration_127 — 23 backend pytest pass (tests/test_gamemaker_phase1.py), full frontend flows verified incl. mobile 390px, regression (public hub, fire wallet, auth) green. deployment_agent PASS.
**Phase 2+ backlog (do NOT start until founder approves Phase 1):** versioned engine/runtime/pipeline registries + admin control center wizard, capability matrix, contract tests; Phase 3 ten runtimes (open_world_rpg + shooter must be genuinely implemented before Live); Phase 4 media uploads via object storage + ORAi live editing previews/version compare; Phase 5 ten reference games (Emberfall Warden, Neon Beasts, Skyforge Sprint, Relicbound, Echoes of Aetherwild, Vaultbound Tactics, Nexus Bastion, Prism Forge, Neon Rift Rally, Obsidian Strike).

## OurRealm Game Maker — Phase 1.5 (Aug 2026) ✅ COMPLETE — awaiting founder review before Phase 2
**Economy sliders:** GAME ECONOMY + AI POWER (1-10, tier names) on /gamemaker between runtimes and chat panels; live 🔥 requirement chip; resource picker (build-eligible only).
**Pricing:** gm_pricing_rules (versioned, immutable; default base 10/linear/min20/max200 → 10×(E+P)); admin editor + 100-combo preview grid; quotes/holds pin their rule version.
**Quote→Hold→Build→Burn:** gm_quotes (20-min expiry) → POST /quote/{id}/confirm places atomic hold (fire adapter: $gte-guarded vault dec + fire_wallet_transactions gm_hold/gm_hold_release/gm_burn_finalized entries; native: guarded balance dec) → job runs → burn ONLY after validation+save; failed keeps hold (Retry reuses hold, Return releases); cancel releases; 72h expiry reaper; founder_exempt. Reconciliation endpoint proves adapter parity (✓ BALANCED).
**Exchange:** gm_exchange_rules (versioned pairs/min/max/fee/frozen, floor rounding anti-arbitrage, reverse-pair warning); user flow in Fire Vault ResourceBalances (quote→confirm, linked ledger entries w/ shared exchange id, replay-safe). Keys stay read-only.
**ORAi Public Access:** orai_policies (10 repo-discovered capabilities, backend-enforced via check_policy in /gamemaker/quote), immutable versions + rollback + audit; founder Rules Chat (LLM→structured proposal→before/after diff→explicit Apply/Cancel, never auto-applies) in /admin/orai → "Public Access & Rules".
**Admin:** /admin/gamemaker Economy & Pricing tab (rule editor, grid, reconciliation, holds w/ reasoned release) + Exchange tab (equivalences, pairs).
**Tests:** 18 phase1.5 pytest + 23 phase1 regression ALL PASS (no paid providers; lifecycle via test-economy-cycle diagnostic endpoint); frontend iteration_128 pass after fixing 2 bugs: AdminOrion public-rules routing lost in parallel edit (re-applied) + useEffect returning promise in OraiPublicAccess ("destroy is not a function"). 320/390px no overflow.
**Learnings:** parallel search_replace edits to the SAME file can lose earlier edits (last-write-wins) — apply same-file edits sequentially. useEffect(fn,[]) must not return a promise.

## OurRealm Game Maker — Phase 1.6 (Jun 2026) ✅ COMPLETE — awaiting founder approval before Phase 2
**Resource Visual Studio:** services/resource_visuals.py — versioned visual packs (never overwritten), one master 1024px generation → all sizes derived mechanically free (512/256/128/64/32 + 320x200 thumb + light/dark previews), activation flips active version w/ ?v= cache-bust into resource_registry.active_visual, rollback = activate older version. Sources: generated (persistent job resource_visual_gen w/ dry-run quote $0.04, ORAi policy check, idempotency), uploaded (b64, PIL-verified, 12MB max), reuse from existing asset URL.
**Burn-into controls:** POST /api/admin/resources/{key}/burn-into — per-pair configs (src/dst amounts, min/max, daily limit, cooldown, fee, rounding, audience, schedule, frozen), preview mode w/ before/after, arbitrage cycle detection blocks (409) without explicit confirm_arbitrage.
**Universal Placement Registry:** 8 builtin surfaces (vault/foryou/games/saved_games/responsibility_center/profiles/notifications/admin) w/ capability matrix; modes unsupported|disabled|display|full|custom; per-surface overrides may only RESTRICT never expand; enable_everywhere respects surface caps; drafts hidden from placements. Future-surface adapter contract: POST /surfaces/register → gm_surface_adapters + auto-discovery of enable_everywhere resources (audited).
**Collections added:** resource_visuals (idx: id unique, resource_key+version desc), gm_surface_adapters (idx: key unique).
**P0 fix (this fork):** 401 on /api/media/resource_visuals/* — global_auth_guard now allows anon GET/HEAD for that exact prefix only; media_proxy restricts kind to image extensions, returns 404 for missing cloud objects, path traversal still rejected. Verified: valid 200 image/png, HEAD ok, missing 404, POST/DELETE 401, other media kinds still 401 anon.
**Tests:** 54/54 pytest pass (23 phase1 + 18 phase1.5 + 13 phase1.6, mocked providers, $0 spend). Fire reconciliation BALANCED (240 held = 120 released + 120 burned, orphaned_delta 0). Icons render desktop 1920px + mobile 390px (all imgs naturalWidth>0).
**Provider costs Phase 1.6:** $0.00 (all 6 crystal visual versions generated with mock provider or uploads).
**Rollback:** visuals → activate prior version; exchange/pricing rules → versioned immutable, insert new version; auth-guard fix → revert 6-line server.py block.
**DO NOT START PHASE 2 until founder approves this checkpoint.**

## Phase 1.6A — Vault Correction (Jun 2026) ✅ COMPLETE — awaiting founder approval before Phase 2
**Fire Power collapsed balance:** FireWalletCard CollapsibleHeader `right` slot now always shows authoritative vault balance (fmt(animVault) 🔥, fire-glow, testid fire-wallet-collapsed-balance) + "N 🔥 held" chip when gm_holds open (testid fire-wallet-collapsed-held). Backend: /api/fire/wallet adds `held_fire` (sum gm_holds user+fire+state held). Reads fire_vault service only — NO duplicate balance/ledger.
**Canonical gold coin:** exact asset identified = founder collectible sheet cell 0 (orai_asset 58a9475819604948be068969a228e120, file 3be1c0d624b748ed99507e6d19c57775.png) — the icon_set wired into published "Dragon Realm: The Fire Quest — 2.5D Demo" (spec.assets.icon_set; GameRuntime idx map coin=0). Registered via scripts/register_gold_coin_visual.py (idempotent, $0): crop cell → square pad → standard visual pack → active Coins visual v1 with `animation:"gold-coin"` (propagated by activate()). balances() now returns icon_animation.
**Shared render path:** components/resources/GoldCoin.jsx + index.css .or-coin-wrap/.or-coin-anim (@keyframes or-coin-flip, transform-only rotateY+bob, fixed wrapper = zero layout movement, prefers-reduced-motion → static). Consumed data-driven (visual.animation==="gold-coin") in ResourceBalances, GameMakerAdmin resource rows + Placement Matrix; all other surfaces get it via registry active_visual (?v=1 cache-bust kills stale emoji/silver).
**Verified:** 10/10 founder checks — collapsed balance desktop+mobile (1,866 🔥 = authoritative vault), expanded breakdown intact, coin img loaded + animationName or-coin-flip, reduced-motion → animationName none, coins balance unchanged (15), single visual version, no new ledger/balance rows, 54/54 Phase 1–1.6 pytest green.
**STILL DO NOT START PHASE 2 until founder approves.**

## Phase 2 — Versioned Engine/Runtime/Pipeline Registries + Control Center (Jun 2026) ✅ COMPLETE — awaiting founder approval before Phase 3
**Service:** services/engine_registry.py — families engine|runtime|pipeline|schema in gm_registry_items + gm_registry_versions (unique idx family+key, family+key+version); gm_game_pins (insert-only overlay, game docs NEVER touched); gm_registry_audit (append-only). Lifecycle draft→internal→beta→live→disabled (sequential promote; live unique per key; released=immutable, edits require clone; runtime promote to beta/live requires passing contract test). Truthful capability enforcement: RUNTIME_MECHANICS map = repo ground truth (GameRuntime.jsx impls); contract test FAILS any cap=true not implemented. Disable (version or item) blocks NEW use only (guard in gamemaker quote+create via new_use_allowed); existing pins unaffected.
**Seeds:** 2 engines (orc_canvas_v1, dragon_realm_v1), 26 runtimes (24 implemented live v1 incl dragon_realm_rpg; open_world_rpg+shooter DRAFT with all caps false), 5 pipelines, 28 schemas (24 spec + arpg v2 + save_game_progress + resource_manifest_engagement). Seed idempotent insert-only at startup.
**Jobs (Cloudflare-safe):** gm_contract_test, gm_registry_migration (pin apply, idempotent by run_id), gm_sandbox_demo (clones REAL working game spec — never fabricates; fails honestly for planned runtimes).
**Migration:** inventory + migration/preview endpoints (map before apply); apply=insert-only pins with run_id; rollback deactivates per run_id. Currently 66 active pins; 4 skipped (failed/building, no runtime in spec). New games auto-pin post-create (non-fatal hook in _run_create).
**Router:** routers/registry_admin.py (/api/admin/gamemaker/registry/*, founder-only; member=403, anon=401).
**UI:** pages/GameMakerRegistry.jsx — "Engine Registry" tab in /admin/gamemaker: inventory+migration panel, family tabs, version drill-down, capability chips editing (drafts), promote/disable/rollback, contract test + checks display, sandbox demo, compare versions, pinned-games list, new/clone runtime drafts.
**Tests:** tests/test_gamemaker_phase2.py 13/13 pass + full 67/67 (phase1+15+16+2). NOTE: tests create v2 draft versions on platformer/match3 + sandbox demos — cleanup: archive sandbox games, purge v>1 test versions, re-enable racing (done post-run).

## Wording + /games CTA task (Jun 2026) ✅ COMPLETE
**Burn wording:** "Pay with X"→"Burn X" (dynamic per resource); "Exact Fire Power requirement shown before you confirm"; "Your build quote"→"Build Requirement"; "Economy & Pricing" tab→"Economy & Burn Rules"; "Pricing rule"→"Burn rule"; FireWalletCard "Fire Wallet"→"Fire Power", "View wallet"→"View Fire Vault", "Wallet History"→"Vault History", "after each spend"→"after each use"; FireWalletPrivacy + FoundingVipPopup + AdminFirePower → Vault terminology; GameRuntime golden key popup → "Fire Vault"; ResourceBalances fee→"extra burned"; backend economy.py "Quote..."→"Build requirement..."/"Exchange preview...", fire.py wallet/history messages → Vault. Internal identifiers (fire_wallet API paths, gm_quotes, fee_pct fields, data-testids) UNCHANGED. Permitted money wording: LegalPages + Wallet.jsx negative disclaimers; real USD provider-cost founder dashboards; in-game gameplay currencies.
**CTA:** components/games/GameMakerCTA.jsx (two-line "CREATE YOUR OWN GAME! / OurRealm Game Maker", 44px min, always rendered) in PublicGamesHub + GamesHub headers (one per page). Verified 1920/390/320 px, no overflow, navigates /gamemaker, anon gets clear "sign in to check access" panel.
**STOP: DO NOT START PHASE 3 until founder approves the Phase 2 report.**

## V1 COMPLETION (Jun 2026) ✅ — OurRealm Game Maker V1 delivered
**E2E proven (one real low-power build):** quote (Build Requirement) → confirm (hold) → persistent build job → saved+auto-pinned+13+ → play → score/results (fire_rewards) → Continue Playing → publish job → idempotent For You post (republish returns SAME post_id). Proof game: "V1 Launch Proof: Lava Cave Ember Quest" id 14131904327c467bad53ae5ea6ce3121.
**Bug fixed (audit find):** gamemaker.py ownership checks used non-existent `creator_id` (games use `created_by`) — publish/saved/rename/archive now match either field. Empty-projection falsy dict caused "Game not found" on publish.
**Continue Playing:** components/games/ContinuePlaying.jsx — closed by default, chevron aria-expanded, dedup by game, sort last_played desc, scrollable (max 224px), 44px rows; GamesHub (server my_progress, now filtered to visible games, limit 60) + PublicGamesHub (guest localStorage or_guest_played, removed-game safe).
**13+:** scripts/migrate_age_13.py (versioned migrations doc `age_rating_13plus_v1`, dry/apply/rollback, 71 games → "13+"); new builds set 13+ in _run_create; publish coerces below-13 → 13+; guest age modal (localStorage or_guest_13_ok) before first launch on public hub; 13+ copy on /games (both hubs) + GameMakerPage; animation_styles 10+→13+; games list projection now includes age_rating + foryou_post_id.
**Cross-game gates:** services/resource_gates.py + endpoints in routers/resources.py (admin POST/GET /admin/resources/gates..., user GET/POST /resources/gates/{game_id}[/unlock]). balance ("Required to Hold", nothing burned) | burn ("Confirm Burn", idempotent by user+gate version, auto-reversal via rs.reverse if unlock record fails). Immutable gate versions per game. V1 = ledger resources only (adapter resources rejected w/ clear msg). UI: components/games/GameGate.jsx rendered in GamesHub play view before runtime.
**Safeguards:** _guard_resource_config on admin resource create/edit/gates — blocks transferable/tradeable/cash_out/marketplace/random_reward/loot_box/gambling/allow_negative + negative caps. SOURCE_TYPES += gate_burn.
**Legal:** scripts/legal_v1_resource_rules.py — appended "Engagement Resources & Game Maker (Ages 13+)" (marker <!-- v1-resource-rules -->) to terms + fire-power docs via versioned ld.save_draft/publish + one_time notice (verified pending for members).
**Runtime status:** LIVE+contract PASS: platformer, top_down, action_rpg_2_5d, turn_based_creature_rpg, card_battle, tower_defense, match3, racing, dragon_realm_rpg (each with published reference game). Coming Soon (draft, caps all false, creation blocked): open_world_rpg, shooter.
**Tests:** tests/test_gamemaker_v1.py 13/13 (wording regression guard, 13+ migration, CP order/dedup, safeguards, gates x4, ForYou idempotency, reconciliation). Full final pass: phase1+15+16+2+v1 all green (phase15 gems-balance interaction fixed via fixture drain cleanup). Reconciliation BALANCED, 0 open holds, 0 active gates, 68 active pins.
