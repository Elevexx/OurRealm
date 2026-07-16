# OurRealm CHANGELOG (memory)

## July 2026 — Profile Level & Progression System (iteration 76)

### Files created
Backend: `services/progression/{flags,eligibility,registry,calculators,engine,events,rewards,seed,backfill,indexes}.py`, `routers/progression.py`, `routers/progression_admin.py`, `tests/test_progression_core.py`
Frontend: `components/progression/{LevelBadge,ProgressCard,CelebrationModal}.jsx`, `pages/AdminLevelBuilder.jsx`

### Files modified
`server.py` (routers + startup indexes/seed), `routers/posts.py` (post_created event hook), `pages/Profile.jsx` (badge + card), `pages/FounderProfile.jsx` (public badge + card), `pages/ModesPage.jsx` (mode_selected app-event), `pages/PortalsHub.jsx` (portals_visited app-event), `App.js` (route), `pages/AdminHub.jsx` (card)

### Database
Collections: progression_levels, progression_level_versions, progression_tasks, user_level_progress, user_task_progress, user_level_history, progression_claims, progression_events, user_reward_grants, reputation_transactions, progression_recalculation_jobs, progression_manual_approvals, progression_audit_logs, progression_flags.
Unique indexes: level id; (level_id,version); task id; user_level_progress.user_id; (user,level,task,version) task progress; claims (user,level,version) partial status=success; events.event_id; reward grants idempotency_key; reputation idempotency_key; manual approvals (user,task).
Users gained `reputation_points` (synced from reputation_transactions ledger).

### Architecture
- Canonical task-type registry (~50 launch task types across profile/posting/social/realm/engagement/platform/custom) sharing 16 calculator strategies. Unknown/retired types fail safe (never auto-complete).
- Canonical For You eligibility: `services/progression/eligibility.is_foryou_eligible_post` (viewer-independent).
- Engine: backend-only source of truth; read-time TTL recalc (120s) + event-driven recalc + jobs. Claims idempotent (unique claim per user+level+version), concurrency-safe (guarded transition), celebration only after backend confirm. Already-claimed terminal level → highest_level_reached; auto-advance when a new next level is later published.
- Rewards: durable ledger, idempotent grants, retry/revoke (audited), reputation transactions ledger + synced balance, unlock checks via `rewards.has_unlock`.
- App events: authenticated, allowlisted keys only (realm_visited, portals_visited, mode_selected, post_shared, post_saved, daily_task_completed, onboarding_step, feature_used, tutorial_resumed), deterministic event ids (replay-safe). No arbitrary code/queries/URLs in custom rules (schema + allowlist validation).
- Feature flags (db.progression_flags): display, events, calculations, notifications, claims, rewards, builder, analytics. Rollback = flags off; data never deleted.
- Backfill/recalc jobs: batched (100), resumable (cursor), cancellable, dry-run never mutates, all-user run requires phrase "RECALCULATE ALL".

### API routes
User: GET /api/progression/me, /summary/{username}, /history/me, /rewards/me, /visibility; POST /recalc, /claim, /app-event; PATCH /visibility.
Founder (all require_founder + audited): /api/admin/progression/{flags, task-types, levels CRUD+publish+pause+unpause+archive+duplicate+reorder, levels/{id}/tasks CRUD+reorder, tasks/{id} patch/delete/duplicate, inspect/{username}, jobs start/list/get/cancel/resume, rewards/failed, rewards/{id}/retry|revoke, manual-approvals list/decide, analytics, audit-logs, claims, events, seed}.

### Testing status (honest)
- Implemented + automatically tested (16 pytest, all pass): seed publish, founder-only 401/403, backend-calculated progress, claim idempotency + 5x concurrent burst single record, reward dedupe, unknown task type fails safe, arbitrary code/config rejection, app-event allowlist + replay dedupe, published-level delete block, draft lifecycle, dry-run non-mutation, confirmation phrase, backend-enforced visibility, audit logging.
- Implemented + tested by testing_agent E2E (iteration_76.json): profile badge + card, history, real claim flow with celebration + highest-level state, public summary privacy, Level Builder CRUD/publish/archive/delete, analytics/jobs/flags/audit tabs, dry-run job, inspect, non-founder guard, feed regression.
- Manually verified: preview full backfill (91 real users, 89 changed, 0 failed); highest-level fix; auto-advance logic (code-reviewed, unit path covered indirectly).
- Deferred / known limitations: views_received counts 0 (no durable view tracking yet — never auto-completes); share/save/portals/mode/daily/onboarding/feature tasks count post-launch app-events only (no historical source exists); notifications flag has no push channel yet (in-app claim highlight + celebration only); per-mode visual QA of card in business/millennium/stealth pending full pass; reduced-motion honored in celebration; mobile layout responsive but not device-lab tested.
- Production rollout: deploy → flags OFF by default in prod DB → founder runs Dry Run then backfill from Level Builder Jobs tab (phrase RECALCULATE ALL) → enable display/events → notifications → claims → rewards. Preview data is NOT proof of production backfill.

### Update (same day) — visibility fixes + full level ladder
- All 8 flags enabled in preview (display, events, calculations, notifications, claims, rewards, builder, analytics).
- Level badge now also shows in profile EDIT mode (profile-level-badge-edit) — profile defaults to edit view, which previously hid it.
- Seeded 6 more editable published levels via scripts/seed_launch_levels.py: Creator, Rising Star, Influencer, Elite, Master, Legend (5 tasks + completion badge + reputation each, per-level accent colors). All editable in Level Builder, nothing hard-coded.
- Auto-advance verified live: stealth (claimed Explorer) automatically advanced to Creator when new levels were published, with pre-completed tasks recognized (4/5 instantly).
- Functional republish flow verified: Creator required_task_count 5→4 triggered confirmation gate, published v2, migrated 1 user; stealth claimed Creator → celebration modal → advanced to Rising Star (3/5, rep 300, 3 completed levels).
- Screenshots verified: desktop profile (Neon), mobile profile (Millennium), progress card + history, claim celebration with rewards, Level Builder levels list (8 levels), task builder + reward editor, analytics dashboard, jobs/repair with dry-run history.
- Preview DB note: 90/91 real users genuinely have empty avatar_url (this is preview data; production differs — founder Dry Run in production shows real counts).

## July 2026 — Phase 0.6 Fire Power lifecycle completion (iteration 82)

### Session fixes (fork continuation)
- AdminFirePower.jsx: removed 134 lines of orphaned duplicate JSX after component close (was breaking webpack compile of the whole frontend).
- AdminFirePower.jsx: implemented the missing `DashboardSection` (12-KPI live dashboard, GET /api/fire/admin/dashboard) and `InspectorSection` (user/post inspector + pause/restore/force-finalize/collect-on-behalf/reverse-reaction controls) that were referenced but undefined.

### Phase 0.6 certification (testing_agent iteration_82.json)
- Backend 19/19 pytest pass (/app/backend/tests/test_fire_phase06.py): full-value recipient accounting (5x → pool −4, pending +5, post +5), 24h edit window bound to created_at (4 edits → identical edit_deadline), difference-based edit accounting, 403 read-only after deadline, force-finalize pending→collectable, manual collect →vault, 5 parallel collects never double-credit, idempotency duplicate:true no-delta, founder-only 403 guard on all /fire/admin/*, dashboard/inspect/pause/restore/reverse (reason required), recalculate zero-drift, fire-ranked feed desc by fire_total, DM emoji reactions endpoint preserved.
- Frontend verified: /feed 47 fire buttons + 0 emoji launchers on public posts; picker desktop dialog + mobile bottom sheet (390px, no overflow); fire-wallet-card premium UI on /profile; admin command center all testids; non-founder guard; privacy JSON leak audit pass (hidden fields have NO value key).
- Preview flags all ON (fire_reactions, boosted_fire, fire_ranked_feed, fire_wallet_enabled, fire_collection_enabled, fire_pending_enabled, fire_collectable_enabled, fire_wallet_history_enabled, fire_admin_tools_enabled). PRODUCTION untouched — no migration executed, flags remain OFF in prod until founder activates.
- Background finalization loop: server.py starts fire_vault.finalization_loop(600) — pending→collectable every 10 min even while users are offline.

## July 2026 — Phase 0.6.1 Fire Pool Education (UI-only)
- FireButton.jsx only: ⓘ Info icon beside Daily Fire Pool bar in the Fire picker (data-testid {prefix}-pool-help-open) opens FirePoolHelpSheet portal (z-320, bottom sheet mobile / centered dialog desktop, Escape + backdrop + X close, testids {prefix}-pool-help / -pool-help-close). Content: Unlimited 1x, Boost cost = fire−1, rolling 24h pool, rationale, coming soon. No backend/API/DB/logic/flag changes. Verified mobile 390 + desktop 1920; closing help returns to picker intact.

## July 2026 — Premium 3D Fire Power icon (UI-only)
- Generated 3D flame asset (yellow core / orange body / deep red edges / blue-purple glow) via Gemini image gen; converted black-bg render to true RGBA via luminance→alpha; saved /app/frontend/public/fire-power-icon.png (512px, 353KB).
- FireButton.jsx picker header: replaced level_badge_url/placeholder img with the official icon (.fire-power-icon in 44px wrap, 86% fill, drop-shadow orange glow).
- index.css: fire-power-flicker keyframes (transform/opacity only, 2.6s) + prefers-reduced-motion off-switch.
- Verified mobile 390 + desktop 1920: icon loads, crisp, no white box.
