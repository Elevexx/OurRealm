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

## July 2026 — Sounds ⇄ For You unification (iteration 83, 15/15 backend pass)
- Canonical model: every track gets ONE post (media_type/content_type "sound", is_canonical_sound, sound_track_id). Fire/comments/caption/hashtags/audience live on the post; db.tracks stays the audio asset.
- NEW services/sound_posts.py: create_canonical_post (idempotent), attach_posts_to_tracks (batch fire embed), sync track⇄post (title/cover/audience), delete both directions, db-managed sound_classifications (music/podcasts/fx/other, admin-renameable PATCH /api/sounds/admin/classifications/{id}), migration dry-run/execute("MIGRATE SOUNDS TO POSTS")/rollback("ROLLBACK SOUND MIGRATION") with sound_migration_log; likes→1x fire (source sound_migration, no pool charge).
- sounds.py: upload creates canonical post (defer_post=true for For You composer), GET /classifications, feed sort=fire&window (1h/12h/24h/1w/1m/all), top100/by-user embed t.post, PATCH/DELETE sync canonical.
- posts.py: create_post marks canonical when owner+first post for track (source_composer foryou), global canonical dedupe in track merge, delete canonical post deletes track+file, audience sync post→track.
- Frontend: Sounds cards show FireButton (sounds-fire-{id}-btn) replacing Heart (Heart fallback for legacy no-post tracks); "🔥 Top Fire" chart + Window dropdown (sounds-fire-window); SoundUploadPicker loads shared classifications + sends classification_id/defer_post; Feed composer passes deferPost.
- Preview migration EXECUTED: 5 tracks backfilled, idempotent re-run (0 created/5 skipped). PRODUCTION untouched.
- fire_vault post_inspector projection extended with sound fields. server.py seeds classifications + indexes (posts by_sound_track, by_media_created).
- Bugs fixed post-test: delete_track canonical cleanup + CHARTS/FIRE_WINDOWS consts (edits had been reverted); useFireStatus ordering crash on Sounds.

## July 2026 — Collapsible Fire Power profile cards (UI-only)
- FireWalletCard (collapsible prop, used on /profile) + PublicFireStats now use progression CollapsibleHeader/useAccordionState: title "Fire Power", ALWAYS collapsed on open, not persisted, same animation as Creator Progress/Progression Badges. Testids: fire-wallet-header/-toggle, public-fire-stats-header/-toggle. HomeDashboard compact wallet unchanged.

## July 2026 — Founding VIP Member Reward (iteration 84 + fixes, backend 21/24 pass then 2 bugs fixed & verified)
- NEW services/founding_vip.py + routers/founding_vip.py (/api/founding-vip/*). Claim-based: member numbers 1-1000 → eligibility record → manual claim grants VIP role (if missing) + permanent founding_vip badge + exactly 1000🔥 to vault. Idempotent: unique (rule_id,user_id), unique wallet txn idempotency key founding_vip:v{ver}:{uid}[:g{gen}], atomic eligible→processing→claimed flip, self-healing resume. 5-parallel-claims = single grant (verified).
- Permanent member numbers via db.counters atomic $inc; signup hook in auth.py register; backfill dry-run/execute("ACTIVATE FOUNDING VIP")/rollback("ROLLBACK FOUNDING VIP"). Preview backfill EXECUTED: 101 real accounts numbered+eligible; counter ~118.
- Config: founding_vip_config w/ draft/publish/version history (rule_version bumps on min/max/fire/destination change), restore, unpublish, sanitized text. Records: founding_vip_rewards (full ledger fields), founding_vip_corrections (claim reset preserves originals, vault never negative, allow_reclaim bumps claim_generation), founding_vip_audit (all founder actions + reason).
- Admin: stats(18 KPIs)/users search+filter/inspect/exclude/include/revoke/extend|remove-expiration/force-claim/reset-claim/exports CSV/audit — all founder-only (403 tested).
- Frontend: FoundingVipCard (claim card on /profile above wallet, confetti success state, double-click safe), FoundingVipPopup (one-time login reminder, Claim Now/View Wallet/Dismiss, server dismissed flag), Founding VIP chip next to VIP badge, FoundingVipAdminSection in /admin/fire-power (stats, dry-run/execute, content editor draft/publish/versions, user mgmt, exports).
- Bugs found by testing agent & FIXED: (1) CRITICAL assign_member_number falsy-projection guard broke signup hook — fixed, new signup verified member#117+eligible; (2) reset-claim allow_reclaim couldn't re-deposit (same idem key) — fixed via claim_generation, full cycle verified 0→1000→0→1000.
- PRODUCTION: nothing executed there. After deploy: founder runs Dry Run then Execute backfill in admin.

## July 2026 — Messenger reaction picker expansion + Founding VIP completion items
- reactions.js: REACTION_CATEGORIES (Popular/Celebrate/Fun/Surprise/Feelings/Responses/OurRealm) — 42 emojis incl. legacy ⚡️; 🔥 excluded from picker (Fire Power confusion) but kept in backend allow-list for legacy display/removal. reactions.py backend allow-list extended.
- ReactionPicker.jsx: multi-row category panel via body portal + fixed positioning w/ viewport clamp (fixes clipping behind chat header/sticky bars), closes on pick, 36px targets, scrollable. Verified live: open/add/switch/remove on mobile 390 + desktop, server accepts new emojis. Fire Power button untouched/separate.
- Founding VIP completion: founding_vip badge seeded into badge_registry (single source of truth); public /api/profile/{u}/badges shows "Founding VIP #N" (verified on stealth: pill renders on public profile); claim writes lowercase username to user_badges; admin label "Automatically eligible · manually claimed" chip added; signup-hook canary test updated (hook fixed). Pytest 22 pass/2 skip.

## Jul 22, 2026 — 4 UI/UX bug fixes verified + 2 latent bugs found & fixed during verification
- FIX1 For You profile links: avatar onClick added previously was BROKEN — `navigate` was undefined inside `FeedCard` (only defined in parent `Feed`). Added `const navigate = useNavigate()` to FeedCard (`/app/frontend/src/pages/Feed.jsx`). Verified desktop+mobile: avatar & username clicks navigate to profiles.
- FIX2 Profile "Message" button: deep-link effect in `Messages.jsx ChatsTab` had a React 18 StrictMode race — the `cancelled` cleanup flag + `finally`-block param strip cancelled BOTH effect instances, so the DM overlay never opened. Rewrote effect: strip `?dm/to/user` params synchronously first, removed cancellation flag (`/app/frontend/src/pages/Messages.jsx`). Verified desktop+mobile: DM overlay opens with correct peer.
- FIX3 Mobile poll composer: max-h/overflow/min-w-0 clamps verified — modal fits 390px viewport, no horizontal scroll (scrollWidth=390).
- FIX4 Widget persistence: `Array.isArray(user?.widgets)` state init verified — saved single-widget layout renders after reload, no revert to DEFAULT_WIDGETS. Backend PATCH /profile/me + GET /auth/me round-trip confirmed.

## Jul 22, 2026 — Fire Power Widget Upgrade + Secure Public Profile Version (COMPLETE, iter85 100%)
- Redesigned FireWalletCard: section order Pool → Vault(centerpiece w/ 3D flame art + PERMANENT badge + glow) → Pending → Collectable(+COLLECT ALL) → Statistics → Wallet History. Future Utilities section REMOVED. No money/crypto wording.
- Owner's own public profile (/profile/<self>) now renders the FULL FireWalletCard (shared component with Edit Profile); other viewers get the new PublicFireStats summary (Level+badge, Fire Received privacy-filtered, Max Fire/Reaction, 2-line public footer). FounderProfile.jsx branches on isOwner.
- Grouped 🔥-ready notification: fire_vault.upsert_fire_ready_notification (single unresolved row per user, updated in place) + resolve_fire_ready_notifications on collect (message → 'Fire collected into your Vault.'). New cycle → new row. fire_notifications flag ENABLED in preview via founder admin endpoint.
- Deep link: Notifications.jsx fire_collectable click sets sessionStorage 'ourrealm.fire.deeplink'=1 → own profile → FireWalletCard consumes flag once → auto-expand + scroll + 2.6s highlight. Normal visits stay collapsed.
- /api/fire/wallet/stats/{username} now returns public_summary {level_number, level_name, level_badge_url, max_fire_per_reaction} (progression facts only).
- Notifications page: added Flame icon + message rendering for fire_collectable + founding_vip_claimed kinds, 'fired your post 🔥' verb for pre-existing blank 'fire' rows.
- Backend accounting UNTOUCHED (only notification emission + stats response shape changed). Wallet endpoints anon→401, non-owner privacy {visible:false} with no value key verified.
- Tests: iter85 6/6 backend pytest + 9/9 UI flows (test file /app/backend/tests/test_fire_widget_iter85.py).

## Jul 22, 2026 — FIRE UP 🔥 Vault → Daily Pool refill system (COMPLETE, iter86 100%)
- Backend: services/fire_vault.py fire_up() + _fire_up_state() — server-authoritative amount min(missing, vault) at CURRENT level; rolling 24h cooldown from exact server UTC timestamp of last success; atomic single-UpdateOne cooldown gate doubles as concurrency lock (race: 1 success/1 409); conditional $gte vault deduction; spent_active $inc credit + clamp (pool never exceeds max, recovery entries untouched); idempotency_key replay; rollback restores prev last_fire_up_at on any failure. Ledger txn type=fire_up with full before/after audit fields. recalculate_wallet now subtracts fire_up totals.
- Endpoints: GET /api/fire/fire-up/preview, POST /api/fire/fire-up (owner-only, 401 anon); /fire/wallet response includes fire_up block (single shared request).
- UI: FireWalletCard vault renamed FIRE VAULT (no 'Permanent' anywhere), caption 'Collected Fire you have saved. Use it to Fire Up your Daily Pool.'; FireUpSection with hint, FIRE UP N 🔥 button, bottom-sheet confirm modal (before/after values), cooldown countdown + absolute time, error states (pool_full/vault_empty/paused). Wallet history renders 'Fire Up → Daily Pool' rows.
- Notification: one fire_up_complete per transfer (keyed to txn id), deep-links to own profile w/ widget expanded once. Admin inspector fire_up audit block (AdminFirePower.jsx + user_inspector).
- Tests: iter86 11/11 backend + 6/6 UI (100%). Suite: /app/backend/tests/test_fire_up_iter86.py.
- PRODUCTION: deployed build includes Fire widget upgrade + View Fire Powered Posts (verified via anon smoke: 401s, privacy filters, public_summary, sort=fire). FIRE UP requires REDEPLOY. fire_notifications flag NOT yet enabled in production (prod founder credentials differ — founder must toggle in Admin → Fire Power).

## Jul 22, 2026 — Fire Power UX polish (UI only, no backend changes)
- Fire Up hint reworded: "Restore your Daily Pool using X 🔥 from your Fire Vault."
- Cooldown state: "✅ You've already restored your Daily Pool today." + "Available again <date/time>." line kept
- Success toast: "🔥 Daily Pool fully restored! Ready to send boosted Fire again." (partial variant keeps amount text). ROOT CAUSE FIX: sonner <Toaster> was never mounted app-wide — added to App.js (top-center, theme-var styled). All existing toast() calls now render.
- 400ms ease-out count animations (useAnimatedNumber rAF hook): vault balance, pool available (+progress bar fill), boosted-used countdown
- Vault card secondary stat "Daily Pool: X / Y" (testid fire-wallet-vault-pool-stat), uses existing wallet payload — no new requests

## Jul 23, 2026 — Widget persistence ROOT FIX + Home sections + Inner Realm rename + Inner Realm size (iter87 + fixes)
- ROOT CAUSE of removed-widgets-returning: core/seed.py migrate_inject_myfeed_widget/migrate_inject_top8_widget re-injected defaults into EVERY profile on each backend boot/redeploy. Now skip profile_widgets_customized=true + founder. Frontend Profile.jsx resolveSavedWidgets honors empty arrays for customized profiles (defaults only for never-customized). Verified: widgets=[top8] and widgets=[] both survive backend restart.
- Home (/home): shared FireWalletCard(collapsible) + ProgressCard + ProgressionBadges for logged-in non-guests, all default-collapsed, expand in place. Hidden for logged-out.
- Inner Realm rename (was Top 8/Inner 8): all user-facing text in Top8Editor, TopEightWidget (rewritten, size-aware), Friends.jsx, mockData label, core/config default title, admin_widgets registry seed, progression registry/seed labels. Idempotent boot migration migrate_rename_top8_titles renames stored widget titles (180 profiles), widget_registry, progression_tasks AND progression_level_versions snapshot tasks. Internal ids (top8, inner_8) unchanged.
- Inner Realm size: users.inner_realm_size (4/8/12/24, default 8) via PATCH /profile/me; backend storage cap 24, non-friend validation; lowering size hides extras (never deletes — mutations operate on full stored list), raising restores original order. Size select + hidden-note in Top8Editor; Friends.jsx InnerEight size-aware; TopEightWidget caps display.
- LESSON (memory): parallel search_replace edits to the SAME file can race and drop changes — edit one file sequentially.
- Tests: iter87 backend 16/17 pass; all reported UI defects fixed + screenshot-verified after.

## Jul 25, 2026 — BUNDLE 1: Personal Playlist Foundation + Sound-Player Fire (COMPLETE, tested)
- Playlists backend `/api/playlists` (routers/playlists.py): create/rename/delete, add/remove/reorder items, GET /mine, GET /containing/{track_id}, GET detail. Private-only. Owner-only enforcement. Duplicate entry blocked by unique (playlist_id, track_id) index → 409. Add-permission gate: deleted → 410, moderated → 403, foreign private track → 403 (owner CAN add own private). Deleting a playlist never deletes Sounds.
- Limits in core/config.py (env-overridable): MAX_PLAYLISTS_PER_USER=50, MAX_TRACKS_PER_PLAYLIST=500 → 409 with clear detail.
- Sound-Player Fire: existing canonical engine reused (GET /api/sounds/{tid}/canonical-post already existed at sounds.py:995 — the previous fork had built it; a duplicate route I appended was removed). SoundFireControl wired into: Sounds page TrackCard (was done), SoundPlayerCard feed footer (new, renders only when post.sound_track_id), MiniPlayer (new: mini-fire + mini-add-playlist). Same fire_total across all surfaces (verified), idempotency-key replay does not double-charge.
- Add to Playlist popup (private-only, quick-create inline) on Sounds page, feed sound cards, mini player. Account Settings → Sound Playlists tab simplified to approved scope (list/create/rename/delete/remove/reorder) — archive/duplicate/visibility/cover/desc UI removed.
- Fixes: playlists.py imported CurrentUser from core.security (broke backend boot) → core.deps; SoundFireControl imported @/context/AuthContext → @/contexts/AuthContext; testing agent fixed missing ListPlus + AddToPlaylistPopup imports in Sounds.jsx (runtime crash on /sounds).
- Tests: backend tests/test_playlists_bundle1.py 18/18 PASS. Regressions: test_quick_fire, test_sound_unification, test_sound_fire_migration, test_phase3_sound_selector, test_sound_fire_frontend_review PASS. PRE-EXISTING failures (NOT Bundle 1): test_fire_power.py 10 fails — guest 401s from iter-88 auth guard + refund accounting intentionally changed in Increment B (test_quick_fire is authoritative). Frontend e2e: iteration_92.json — 9/9 flows pass, desktop + mobile screenshots in /app/test_reports/screenshots_iter92/. Feed SoundPlayerCard footer verified separately via seeded sound post (then cleaned up).

## Jul 26, 2026 — Bundle 1b (credit-lean): Video Audio Options / Playlist Playback / Realm Soundtrack — COMPLETE & TESTED
- Video Audio Options: already fully built in VideoUploadPicker (muted default, rights confirmation, Sound Selector) inside the real composer — verified via test_media_rights.py (9/9) + phase3 suite. No new code needed.
- Playlist Playback: extended lib/audioPlayer.js singleton with queue (playQueue/next/prev/toggleShuffle/toggleRepeat, auto-advance on ended, bounded skip of failed tracks, index sync/clear on out-of-queue play). MiniPlayer: prev/next buttons, queue position, shuffle/repeat toggles (mini-prev/mini-next/mini-queue-pos/mini-shuffle/mini-repeat). ManagePlaylistsTab: Play All + per-track play-from-here.
- Realm Soundtrack: reusable RealmSoundtrack.jsx (context-generic data model db.realm_soundtracks {context_type, context_id}) mounted on Profile.jsx (owner) + FounderProfile.jsx (public). Owner editor (playlist/start-track/shuffle/repeat/autoplay, save/remove); visitor view (name, compact list, Start button, prev/play/next, current, position). Autoplay attempted once per username (module Set) — no restart on rerender; verified queue persists across SPA nav. Backend: PUT /api/playlists/soundtrack (own playlists only), GET /api/playlists/soundtrack/by-user/{username} (private tracks hidden from visitors). Tests: test_realm_soundtrack.py 6/6.

## Jul 26, 2026 — Premium Usernames with Fire Power + Bulk Admin Tool — COMPLETE & TESTED (21/21)
- routers/premium_usernames.py: config doc (premium_username_config: enabled, max_premium_len=6, tier_costs 500→1M, tier_enabled, min_account_age_days, require_verification, change_cooldown_days, maintenance_lock), username_rules (reserved/prohibited/retired/admin_only/verification_required/free + custom_cost + force_premium), username_history, username_claims (unique idx = concurrency gate), npc_issuance + counters._id=npc_username (atomic seq, consumed post-insert, never reused, no gap fill).
- Lazy idempotent grandfather migration (db.migrations marker) — 215 users flagged username_grandfathered/premium_username_exempt; never renames.
- Signup gate wired into /auth/register (422 {message, suggestions}) + /auth/username/check (live lock message + suggestions incl. next npc_#). SignUp.jsx shows message.
- Unlock: GET /check (rate-limited, vault math), POST /unlock — idempotency-key replay, cooldown/account-age/verification checks, atomic claim insert → conditional vault_balance deduction ($gte) → assign → auto-retire old premium-length name → history + fire_wallet_transactions type=premium_username_burn (label "Premium Username Unlock") + audit + notification; full compensation on failure. Vault ONLY — pool/pending/claimable untouched.
- Frontend: Profile "Unlock Premium Username! 🔥" button + PremiumUsernameModal (balances, debounced search, all states, confirm-burn step, success toast + refreshMe). /admin/premium-usernames (AdminHub card): stats, length/pricing config, lookup + per-name rules + grant (reason required), BULK tool (comma/newline parse, 9 shared rule actions, preview table w/ warnings, Apply to X, per-name + bulk audit records, idempotent, never overwrites owners), rules table, conflicts endpoint.
- Tests: backend/tests/test_premium_usernames.py 21/21. Regression: playlists/soundtrack 24/24, auth_guard pass. PRE-EXISTING unrelated failures: test_iter55 podcasts guest-401s (iter-88 auth guard class), test_fire_power legacy refund accounting.
- GOTCHAS: (1) auth.py registration gate got lost once due to concurrent search_replace corruption — verify grep "signup_gate" TWICE in routers/auth.py if editing register. (2) Playwright force-clicks below 800px viewport hit the fixed BottomNav ("For You" nav steal) — scroll_into_view or JS .click() when testing admin page lower sections. (3) sounds.py ALREADY had GET /{track_id}/canonical-post at line ~995.

## Jul 28, 2026 — Unified Username Change (lean patch) + Realm Creation Fire Lock — COMPLETE & TESTED
- Unified username change: PATCH /api/profile/username now delegates to perform_username_change() in routers/premium_usernames.py — THE single rename service (signup gate separate). Standard (>threshold) names rename free w/ history method "rename"; premium names burn Vault via same atomic path; reserved/rules/cooldown/availability enforced everywhere; deterministic idempotency key for profile path. /check no longer 403s when feature disabled (standard renames still work). DEFAULT change_cooldown_days now 7 (was profile.py's hardcoded 7; admin-configurable). AccountSettings username card: live check UI (Available/Unavailable, Normal/Premium, Requires X 🔥, Vault balance, dynamic "Burn X 🔥 to Unlock" button, disabled on insufficient). PremiumUsernameModal: standard names get free "Change username" button + Normal/Premium chip. Admin repair report GET /api/premium-usernames/admin/unpaid-renames (read-only; finds premium-length renames w/o burns; @matrix case exists only in PRODUCTION db — report will surface it there after redeploy). Tests: test_premium_usernames.py 24/24.
- Realm creation lock: /api/communities/realms POST requires 2,000 🔥 Vault burn for non-admins (get_admin_role bypass). Pre-check 402 w/ exact message → create → conditional $gte deduction → race rollback deletes realm/membership/chat/widget → ledger txn type "realm_creation_burn" label "Realm Creation". No refund on realm deletion (nothing refunds by design). CreateRealmModal (Realms.jsx): fetches vault, insufficient notice, two-step Continue → "Burn 2,000 🔥 & Create" confirm w/ permanent-burn warning; Cancel steps back. Verified via curl (402/burn-exactly-2000/admin-no-burn) + screenshots (both states).
- LEARNINGS: (1) test data account auditcheckreal got renamed by an old test once unlock accepted standard names — restored; watch tests that post real renames. (2) db premium config doc can hold stale values from old test fixtures (change_cooldown_days was 0) — restore fixture now writes 7. (3) preview 502s from proxy can cause flaky single-test runs.

## June 2026 — RC Logo Layout Update (Hub)
- Desktop sidebar (ResponsibilityCenterHub.jsx): main_logo now renders at 88% of card width (~181px in w-60 card), centered, aspect preserved, OURREALM wordmark + tagline stacked beneath. Logo is the sidebar focal point.
- Mobile/tablet (<lg): NEW hero logo block above "Welcome back" — 72% width (max 340px), centered, with paddingTop calc(env(safe-area-inset-top) + 20px) so it fully clears the sticky TopStarBar (36px+ gap verified). testids: rc-hub-mobile-hero, rc-hub-mobile-logo.
- Verified via screenshots + bounding boxes at 1920, 768x1024, 390x844, 393x852, 430x932. Header ends y=61, logo starts y=97 on 390. No overlap/clipping; full logo visible without scrolling.

## June 2026 — Production Phases 2-4 + Polish (ORAi Voice, Course Studio, Course Player)
- Phase 2 ORAi Voice: routers/orai_voice.py — /api/orai/voice/{library,prefs,tts,preview/{v},transcribe}. 8 native voices (Nova/Atlas/Aurora/Ember/Luna/Orion/Echo/Titan) mapped internally to provider voices; _public() strips _engine_voice — NO provider names leak (tested). tts-1 + whisper-1 via emergentintegrations, OPENAI_API_KEY primary → EMERGENT_LLM_KEY fallback. Previews cached at backend/cache/orai_voice_previews/. Prefs per-user in orai_voice_prefs (voice/speed/pitch/volume/auto_speak/mode/favorites, server-clamped).
- Frontend voice engine: lib/oraiVoiceEngine.js singleton (Web Audio: TTS through Gain→Analyser, detune=pitch*100 with server speed pre-compensation speed/2^(pitch/12); MediaRecorder webm/mp4; VAD 1.5s-silence auto-stop for hands-free loop). components/orai/{OraiVoiceBar,OraiVoiceLibrary,OraiWaveform}.jsx. Wired into RcOraiPanel (RC+Education+Business centers), OrionChat in AdminOrion (Founder Command Center), and CoursePlayer TutorPanel.
- Phase 3 Course Studio: routers/rc_courses.py — POST /courses/generate (one prompt → modules/lessons/blocks[text|activity|worksheet|homework|project|review]/quizzes with answer keys/checkpoints, JSON-mode gen ~40-90s), full CRUD, lesson image gen via orai_images. pages/CourseStudio.jsx + CourseEditor.jsx.
- Phase 4 Course Player: pages/CoursePlayer.jsx — prev/next, resume (rc_course_state position), server-graded quizzes w/ inline explanations, checkpoint → pending_approval when settings.requires_approval (manager approve/reject via /approvals), achievements (25/50/75/100/ace), certificate (409 until 100%, non-accredited disclaimer), manager report, ORAi Tutor panel (rc_course_tutor_messages, guides without giving quiz answers) + voice bar.
- Polish: index.css orrc-logo-cinematic (hub logos), rcx-page-enter + rcx-stagger transitions, rcx-loader spinners, rcx-hover-lift + or-btn hover glow, prefers-reduced-motion respected.
- LEARNING/BUG: rcx-page-enter keeps transform (animation-fill both) → fixed-position modals inside the page get trapped in a stacking context BELOW BottomNav (z-40). FIX: portal all fixed overlays to document.body (TutorPanel, CertificateModal, ReportModal). This was also the root cause of iter-104 "bottom nav absorbs clicks".
- Tests: iteration_105.json — backend 25/26 pass (1 skip), frontend 95%; both reported issues fixed + visually verified (tutor replies, quiz explanations render). tftwo is now an active member of center 3ed43c2b553547fbb3e6ca23b405eb91. Test course: 075f90ffcc3f41088b279dca7163c204 (published, 9 lessons).

## Aug 2026 — Phase 5: ORAi Intelligence & Automation (COMPLETE, iter-106 34/34 pass)
NEW BACKEND ROUTERS:
- rc_intelligence.py (/api/responsibility-center/...): /orai/memory CRUD+reset+export+settings (manager-only, all audited via log_activity), /orai/recommendations (center-type-aware suggestions, never auto-acts), /health (7 weighted factors → Excellent/Good/Needs Attention/At Risk), /orai/drafts generate/approve/reject (approve creates real item/event/announcement/course/lesson; report stays copyable), /intelligence/overview (health+trends+stats+conversations). build_memory_context() exported → injected into rc_orai chat with admin safety_rules.
- rc_automations.py: /automations CRUD + fire_trigger(center,trigger,ctx) engine. Triggers: lesson_completed (hooked in rc_courses.complete_lesson), checkpoint_approved (hooked in decide_approval), task_overdue+birthday (via /run-check, deduped daily by context.dedupe_key). Safe actions execute immediately; award_fire_power queues in rc_automation_runs status pending_approval → /runs/{id}/approve does atomic vault-guarded deduction ($gte filter) + fire_wallets credit. /templates full lifecycle (save snapshot of course/automation/task/calendar, preview, install, duplicate, export, import, archive).
- admin_orai.py (/api/admin/orai): config (model routing, course_generator settings honored by rc_courses.generate, safety_rules injected to chats, voices_disabled+default_voice honored by orai_voice tts, memory_enabled_global), prompt library CRUD, analytics, AI audit (activity actions list), providers health, cross-center memory/automations/templates managers. Founder write / any-admin read via core.permissions.get_admin_role.
- rc_courses.py additions: /courses/{id}/share (private/invite/organization; org = all centers by same owner via rc_course_shares), /courses-shared (list w/ credit), /courses-shared/{id}/import (editable draft copy, credit={original_course_id, original_center, original_creator}).
- orai_voice.py: logs orai_voice_usage (tts/stt) per call.
NEW COLLECTIONS: rc_orai_memory, rc_orai_drafts, rc_automations, rc_automation_runs, rc_templates_user, rc_course_shares, orai_prompt_library, orai_admin_config, orai_voice_usage.
NEW FRONTEND: RcIntelligence.jsx (/responsibility-center/:id/intelligence — tabs Overview/Suggestions/Memory/Automations/Drafts/Templates; drag-reorder automation builder; voice guide + read-aloud), AdminOraiControl.jsx (/admin/orai-control — 8 sections), CourseStudio share modal + shared-with-me + save-as-template, CoursePlayer Read-aloud button. Links: rc-dash-intelligence-btn on center dashboard, Education sidebar 'Intelligence', AdminOrion nav 'AI Command' (href support added to NAV click).
TESTS: iteration_106.json — backend 34/34 (pytest /app/backend/tests/test_phase5_intelligence.py), frontend 100%. Member permission gating verified (tftwo 403s + hidden tabs). Config restored + duplicate imported course copies cleaned after test.
KNOWN (pre-existing, by design): bottom mobile nav renders on desktop too — user said do not redesign existing UI; all overlays are portaled above it.

## Aug 2026 — Phase 6: Production Hardening (COMPLETE, iter-107 21/21 + full crawl clean)
- PERF: startup ensure_indexes() in rc_intelligence.py for all Phase 2-5 collections (incl unique rc_course_progress idx); list_courses N+1 → single aggregation; React.lazy code-splitting for CourseStudio/Editor/Player/RcIntelligence/AdminOraiControl (Lazy wrapper in App.js).
- SECURITY: sliding-window rate limits (utils/sliding_window_rate_limit.rate_limit) — course generate 6/hr, drafts 15/hr, tutor 60/hr, tts+stt 150/hr per user (429 friendly). _safe_int clamping on automation/draft numeric inputs (no 500 on 'abc'). Audit verified: member 403s on all manager/admin endpoints, 401 unauth, IDOR blocked, XSS content stored+rendered inert (no dangerouslySetInnerHTML in RC surfaces), draft validation before LLM spend.
- NEW: Founder Readiness dashboard — GET /api/admin/orai/readiness (9 checks: database ping, ai_chat, voice, automations, drafts queue, vault/fire health, media, approvals, jobs → score+label) + Readiness tab (default) in AdminOraiControl. Current: 100 'Production Ready'.
- A11Y: aria-labels on all icon-only buttons in RcIntelligence/AdminOraiControl; prefers-reduced-motion already respected; responsive sweep clean at 1920/1366/768/390/430 (no overflow).
- Terminology scan clean (no monetary terms in RC user-facing text; certificate 'not accredited' wording intentional).
- Tests: iteration_107.json + /app/backend/tests/test_phase6_hardening.py (21 tests). Known/accepted: bottom nav renders on desktop (pre-existing app-wide design; all overlays portal above it).

## 2026-06 — P0 Deployment Failure Fix (fork session)
- ROOT CAUSE (2 issues): (1) K8s probe hits GET /health on port 8001 but the app only had /api/ (root health router) — /health returned 404 and /api/health is auth-gated (401). (2) @app.on_event("startup") in server.py AWAITED the full migration chain (seed, hashtag reindex/recompute, sound migrations, media-rights, communities backfill, media-proxy URL migration) BEFORE uvicorn bound port 8001 → on production cold start the port never opened in time → "connection refused" → deployment timeout.
- FIX in /app/backend/server.py: added unauthenticated `@app.get("/health")` returning {"status":"ok"} instantly; renamed startup body to `_deferred_startup()` and on_startup now just `asyncio.create_task(_deferred_startup())`; wrapped seed_mod.run_startup() in try/except so a seed error can't kill the deferred chain. Port binds in ~2s; migrations complete in background (log line "OurRealm startup complete" confirmed).
- Deployment readiness scan found one more blocker: .gitignore had `.env` / `.env.*` / `*.env` (lines 166-168) which would exclude backend/.env + frontend/.env from the deploy repo. Removed; `git check-ignore` confirms env files tracked. Re-scan: PASS, zero findings.
- Verified e2e: /health 200 in ~2s after restart; login as stealth + GET /api/games returns all 11 showcase games. NO games generated/modified, NO ORAi calls, NO LLM credits spent.

## 2026-06 — P0 Production login 520 investigation + startup hardening (fork session)
- SYMPTOM: production (ourrealm.social) frontend loads, but EVERY /api/* request (incl. unauthenticated /api/, /api/auth/signup-status, /api/auth/login) returns Cloudflare 520 instantly (~0.1-0.4s). Preview works perfectly through the same Cloudflare stack.
- FORENSICS (all via curl, zero LLM credits):
  * Stopped preview backend → preview /api returns **502** through Cloudflare → "backend down" = 502, NOT 520.
  * SIGSTOP-froze preview backend (port open, unresponsive) → requests hang ≥45s → "blocked event loop" ≠ instant 520 either.
  * Cold probe after 90s idle → still instant 520 → origin failure is immediate, not a timeout.
  * prod /health returns 200 but it is the FRONTEND catch-all (index.html), not the backend.
  * emergent.host origin is also Cloudflare-fronted, raw origin response not observable from here.
- CONCLUSION: production backend process is not serving (crashed after passing the deploy health check, or supervisor gave up), or Emergent LB maps its failure differently than preview. Root cause is ONLY visible in the production deployment logs (Emergent dashboard) — not reproducible in preview.
- HARDENING applied to /app/backend/server.py so no code-side cause can survive:
  1. `_safe_startup()` wrapper catches **BaseException** (incl. SystemExit) so nothing in the deferred chain can ever kill the event loop/process.
  2. `[startup-step] <name>` INFO markers before every boot-migration block (seed, hashtags, sound-migration, media-rights, sound-indexes, realm-pulse, admin-widgets, orion-heal, progression, communities, website-media, storage, media-proxy-migration) → next deploy's logs pinpoint the exact dying step.
  3. `migrate_legacy_uploads` now runs via `asyncio.to_thread` (sync file copy off the event loop).
  4. Kill switch: env `STARTUP_MIGRATIONS=off` (settable in Emergent dashboard) skips all boot migrations and only arms the moderation loop.
- VERIFIED in preview: full startup-step sequence completes, /health 200, stealth login OK, /api/auth/me 200, 11 showcase games intact.
- NEXT: user must redeploy (Replace Deployment). If /api still 520s, pull deployment logs from dashboard; if logs show "OurRealm startup complete" yet /api 520s, it's platform-side (Emergent Support).

## 2026-06 — P0 follow-up: raw HTTP capture + auth response validator (fork session)
- Captured raw login response on localhost via raw socket: HTTP/1.1 200, headers 754B, zero control chars, zero duplicate headers, content-length exact (13199=13199), 2 valid Set-Cookie, valid JSON. NOTHING malformed.
- Cloudflare COMPARISON: identical code through preview's Cloudflare returns 200 (edge rewrites cookies to SameSite=None; Partitioned + adds __cf_bm — both valid, done by Emergent proxy). Proves CF accepts this app's responses byte-for-byte.
- Production ourrealm.social STILL 520s every /api route incl. GET /api/ (4 plain headers, no cookies, no DB) in ~0.15s → the failing responses cannot originate from this response path; production origin process is not serving.
- Added `auth_response_validator` middleware (outermost, /api/auth only) in server.py: validates status range, header name/value control chars, duplicate headers, JSON body parse, exact content-length; rebuilds response with recomputed content-length; on violation logs offending header + returns clean JSON 500; wraps call_next in try/except so auth NEVER emits an unhandled exception response.
- Verified via raw sockets: login 200 / bad-password 401 / signup-status 200 / me 401 / refresh 401 / logout 200 — all valid JSON, exact CL, clean headers. Via CF preview: login 200 + cookies preserved, google/session 400 JSON, signup-status 200. Zero validator violations logged.

## 2026-06 — EMERGENCY P0: production restore package (fork session)
- EMERGENCY startup mode: STARTUP_MIGRATIONS now defaults to OFF — backend binds instantly, skips ALL boot migrations, arms background workers (moderation, orai scheduler, fire finalize, realm pulse, purge, rc renewals) after bind. Log line: "OurRealm startup complete (EMERGENCY MODE — workers armed, migrations skipped)". Set STARTUP_MIGRATIONS=on to restore migrations later.
- Added public GET /api/health (instant JSON, added to PUBLIC_API_PATHS) — externally verifiable on production since bare /health is swallowed by the frontend catch-all.
- Fixed SyntaxError from kill-switch globals (declared once at top of _deferred_startup).
- GAME PRESERVATION: exported all 11 published showcase games (404KB, full docs: spec/economy/controls/covers/status) to /app/backend/seeds/showcase_games.json (ships with the deploy). Covers are on external CDN (static.prod-images.emergentagent.com) → load on production without asset transfer.
- Added founder-only POST /api/admin/games/import-showcase — INSERT-ONLY (never overwrites existing records). Verified in preview: 11/11 skipped (already present), unauth → 401.
- VERIFIED in preview (through Cloudflare): /api/health 200 JSON, /api/ 200, stealth sign-in, /api/auth/me 200, signup (qe2emerg*) OK, google/session flow alive (400 JSON w/o session), /api/games → 11 published w/ covers, game fetch w/ spec OK, /games UI renders all covers + Play buttons (screenshot).
- AFTER USER REDEPLOYS: 1) verify https://ourrealm.social/api/health, 2) login as stealth on production, 3) POST /api/admin/games/import-showcase with founder token to install the 11 games into the production DB, 4) verify /games. If /api still 520 with "startup complete" in deploy logs → escalate to Emergent Support (origin /api routing).

## 2026-06 — PHASE A COMPLETE: production games migration (fork session)
- Production restored after redeploy w/ emergency-mode code: /api/health 200 on ourrealm.social + realm-deploy.emergent.host.
- Login flap explained: founder had changed prod password; temporarily reset to Password1$ for migration (user will rotate again). NOTE: production founder password ≠ preview after rotation.
- MIGRATION (insert-only via POST /api/admin/games/import-showcase): collection touched: `games` ONLY. Examined 11 seed records; inserted 11; skipped 0; failed 0; duplicates 0. Idempotency re-run: inserted 0 / skipped 11.
- Production had 5 pre-existing games (Dragon Spellkeeper: Forest Trials [47 plays], Mystic Hollow, Neon Tunnel Overdrive, Neon Core Rush: Rift Escape, Neon Core Rush) — all preserved w/ live play counts. Total now 16, zero dup ids.
- VERIFIED on ourrealm.social: /games shows all games w/ covers/genre/Fire info; desktop launch OK (Mystic Hollow runtime + Fire banner); MOBILE launch OK (Velocity Demo playing, Stage 1/12, score ticking, road_3d cyber city); admin endpoints unauth → 401; 11/11 health polls 200 over 5 min.
- PHASE B (true game-type routing: registry, no silent fallback, card battle/tower defense/match-3 runtimes + debug panel) — AWAITING USER APPROVAL per instruction.

## 2026-06 — PHASE B COMPLETE: true game-type validation (fork session)
- ROOT CAUSE (B1): unrelated prompts collapsed into arcade structure because (a) the runtime registry had no card/TD/match-3 families, (b) unrouted genres silently became quiz/dodge via LLM "closest fit" with no fallback flag, (c) approval card lacked template/win/loss/fallback fields.
- REGISTRY (B2/B4): RUNTIMES += card_battle, tower_defense, match3 · TEMPLATE_IDS (tpl_<rt>_v1 for every family) · WIN_LOSS per family · RUNTIME_MECHANICS · PLAYER_REPS (card_commander/tower_commander) · IDENTITY_BASE control/camera/loop entries · GENRE_MAP keywords (card battle/tower defense/match 3 checked FIRST) · plan.classification {detected_genre, confidence, method(keyword_router|llm_plan), runtime_id, template_id, fallback_used, fallback_reason}.
- NO SILENT FALLBACK (B5): UNSUPPORTED_GENRES list (cooking/time-mgmt, word puzzle, bubble shooter, tycoon, brawler) → fallback_used=YES + exact "This game type is not supported yet (<genre>)" reason; Approve button becomes "Accept substitution & Build". Verified: "cooking shift game" → fallback YES w/ correct message; "wizard card battler" → card_battle conf 1.0 fallback NO.
- RUNTIMES (frontend GameRuntime.jsx iframe engine, additive): cb() card battle (hand/mana/turns/intent/block/draw-discard reshuffle, data-testids cb-*), tdf() tower defense (canvas path+waypoints, place/upgrade/sell, wave counter, resources, base HP, pause + 1x/2x speed, td-*), m3() match-3 (no-initial-match board gen, swap validation w/ revert, cascades+gravity+refill, combo multiplier, objective tracker, move limit, m3-*). Registered in dispatch map + touch hints. NO movement/portals/collectibles in any of the three.
- SPEC_SYSTEM schemas + validate_spec contracts for the 3 families incl. banned-field checks (movement/collectible fields rejected).
- UI (AdminGames.jsx): approval card += Template/Win/Loss rows + "Fallback used: YES/NO" banner + collapsed "ORAi Debug (founder only)" on estimate AND game detail (genre, confidence, runtime/template id, fallback, job id, validation, similarity, builder/renderer versions, prompt, spec JSON).
- VALIDATION GAMES (zero LLM cost, handcrafted specs via scripts/seed_validation_games.py, idempotent): Realm Legends: Card Clash (fe027e6a…), Realm Defense (70d5bee3…), Crystal Fusion (c0c208b9…) — status approved, labels [founder_validation], NOT published (hub shows 11 unchanged); founders can play approved games via /games?play= (games.py play-fetch founder branch).
- VERIFIED (preview screenshots+API): card played+turn advanced+enemy AI hit back · TD towers placed, enemies pathed, bounties earned, pause/speed OK · M3 invalid swap reverted w/o move loss, valid swap scored 105 w/ Combo x2 · template IDs all different · debug panel renders · regression: Velocity Demo (dodge_collect) unchanged · hub leak: 0.
- NOTE: Phase B exists in PREVIEW only (not deployed). Validation games in preview DB only.

## 2026-06 — PHASE C COMPLETE: runtime library expansion + universal editor (fork session, preview only)
- REGISTRY: catalog = 16 buildable + 5 scaffolded families. Fully implemented: rpg (tpl_rpg_v1), racing (tpl_racing_v1), farming (tpl_farming_v1), city_builder (tpl_city_builder_v1) — each w/ unique loop/renderer/controls/HUD/validation contract/save model (SAVE_X: rpg level+xp+party, racing best_position, farming coins, city population). Scaffolded catalog-only: roguelike, tactics, idle, visual_novel, fishing — classified but generation refuses w/ "not supported yet (X registered — coming soon)" fallback gate.
- RPG P0 (creature classification): GENRE_MAP rpg keywords += creature collect/monster taming/pokemon etc; validate_spec(expected_runtime=) hard-rejects runtime substitution at build ("spec runtime does not match approved plan runtime"); RPG engine has creature collection (CATCH w/ HP-based odds), party (3 max, swap, active fights via creature-attack), creature XP/level/EVOLUTION, world-map zone banner (town/dungeon/overworld), starter creature. Verified E2E: "creature collecting RPG…" estimate → runtime=rpg tpl_rpg_v1 conf 1.0 fallback NO (estimate cancelled, no build).
- UNIVERSAL EDITOR (games_plus.py): PATCH /{id}/meta (title/desc/genre/labels/complexity, version snapshot), POST /{id}/reroll-audio music|sfx (spec.audio_variant_* — engine shifts procedural SFX freq / music transposition), POST /{id}/regen-cover (generate_orai_image + image_store, founder-click only), GET /{id}/export + POST /import (insert-only, 'imported' label), POST /{id}/versions/{idx}/duplicate; version cap 5→30 everywhere; _versions_entry += title/desc/genre/labels/cover_url. Frontend: GameQuickActions.jsx mounted in AdminGames detail (edit form, export download, import file, reroll buttons, cover regen w/ confirm).
- VALIDATION GAMES (founder-only, zero LLM): Emberbound Chronicles (rpg e23dde50...), Nitro Circuit GP (racing 465e7b15...), Harvest Hollow (farming cd4e50c8...), New Haven Rising (city_builder 27a53ffb...) via scripts/seed_validation_games.py (now 7 total).
- TESTING (iteration_116): backend 6/6 pass; frontend pass incl. all 4 runtimes playable + editor actions + hub regression (11 games, Velocity Demo OK). Testing agent added missing GameQuickActions import in AdminGames.jsx (my miss). RPG battle overlay verified working (attack/creature-attack/catch/flee; catch fail message OK). Fixed invalid 5-digit hex on FLEE/SWAP buttons ('#667'+'88' → '#778899').
- NOTE: all Phase C work is PREVIEW-only until next deploy.

## 2026-06 (fork) — Phase C completion: all 21 runtimes live
- Farming runtime: replaced auto-plant with crop picker — tapping an empty plot opens `frm-plant-<Crop>` chips + `frm-plant-cancel` (old `frm-seed-N` chips removed).
- Fully implemented the 5 scaffolded runtimes end-to-end: **roguelike** (procedural floors, bump combat, boon picks, permadeath), **tactics** (grid squad combat, move/attack ranges, cover, enemy phase), **idle** (tap/generators/upgrades/prestige), **visual_novel** (typewriter scenes, branching choices, endings), **fishing** (bait, cast, timing-bar hook, rarity collection).
- Backend: RUNTIMES now 21, SCAFFOLDED_RUNTIMES empty; added WIN_LOSS, PLAYER_REPS, IDENTITY_BASE, EST_SYSTEM routing, SPEC_SYSTEM schemas + validate_spec branches for the 5. Removed stale "city builder/farming sim" entries from UNSUPPORTED_GENRES (they were falsely flagging supported runtimes as fallbacks).
- 5 approved (unpublished) demo games imported with label `runtime-test` for founder preview: roguelike 3a0f96ab…, tactics 8d4fec1e…, idle 70f57f67…, visual_novel 410bf9e8…, fishing 59b4e1ca… (play via /games?play=<id> as founder; delete via admin action=delete when done).
- Tested: iteration_117 — backend 13/13 after PLAYER_REPS fix, frontend 100% (all 5 runtimes interactive, farming picker validated, hub shows exactly 11 published games, no leak, Neon Core Rush regression OK).
- Learning: parallel search_replace batches on the SAME file can clobber each other (RUNTIMES + PLAYER_REPS edits were silently lost twice) — verify grep after batched same-file edits.

## 2026-06 — Game cover art workflow (P0)
- Suggested cover prompts auto-composed from game record (title/runtime/rep/world/enemies/theme/camera/loop) — stored on build via `game_studio.build_cover_prompt`, computed on-demand for older games via GET /api/admin/games/{id}/cover-suggestion. NEVER auto-generates.
- Cover endpoints (founder-only, games_plus.py): regen-cover (accepts prompt, defaults to suggestion), cover-upload (b64), cover-remove, cover-restore (history swap), covers/missing (published+coverless), covers/bulk-generate (≤12, background, audit per game, cost $0.04/img).
- Perfect card fit: `_crop_cover_bytes` → exact 832×1040 (4:5) JPEG q86, focal 0.42; stores cover_url (card crop) + cover_original_url + cover_meta {prompt,model,source,cost,card_crop} + cover_history (10) + version bump + audit w/ cost.
- Frontend: GameCoverPanel.jsx (qa-cover-* testids) in admin detail; Missing Covers panel in AdminGames list (adm-covers-*, per-game + bulk with total cost confirm); GamesHub img onError hides broken images (text-card fallback stays).
- E2E on Bake the Fraction Feast (only published coverless game): suggestion → $0.04 estimate → Gemini generation → 832×1040 crop → hub thumbnail (desktop+mobile) → regenerate → restore → remove → restore. All verified via curl + screenshots.
- Note: /api/media/images/* is behind the site-access gate (401 for anon curl) — fine in-app since /games requires login.

## 2026-06 — Dragon Realm: The Fire Quest (Phase 1 + 2 vertical slice)
- New reusable runtime family `turn_based_creature_rpg` (SCAFFOLDED so ORAi classifies creature prompts to it and refuses generic fallback). IDs: runtime_dragon_realm_rpg_v1 / tpl_dragon_realm_fire_quest_v1 / renderer_pixel_creature_rpg_v1.
- Backend: services/dragon_realm.py + routers/dragon_realm.py — founder-only access modes, server-authoritative content (6 forest dragons, THORNBEAST, quest), event validation (4s rate limit, boss gate prerequisites, unknown-enemy reject), idempotent claims via real fire_vault ledger (credit→stamp claimed→vault-collect; reset-epoch in idem keys; race-safe; admin config PUT requires reason + audited; admin reset-progress audited). Collections: dragon_realm_saves, dragon_realm_config, dragon_realm_resets. Rewards: quest 25 / dragon first-defeat 10 / boss 100 (admin-configurable). NO burning (user directive).
- Frontend: components/games/dragonrealm/* — DragonRealmRuntime (title/HUD/quest/claims/save sync), ExploreView (20x14 pixel map, WASD/arrows/tap/D-pad), BattleView (Fight/Spell/Dragon/Item/Defend/Run + tap-dragon-to-cast + befriend, floating dmg, statuses, boss intent), engine.js (deterministic seeded combat, 10 elements, Thornbeast mechanics), sprites.js (original pixel art). Mounted via GamesHub for runtime turn_based_creature_rpg; iframe runtime shows honest fallback for unknown runtimes.
- Game record: db.games id dragonrealm-firequest-v1 (approved, founder-visible only, NOT in public hub).
- Tested: iteration_118 — backend 10/10 pytest (tests/test_dragon_realm.py), frontend 100% full playthrough incl. real +10 FP claim (741→751 exact), persistence, mobile D-pad, hub regression. Applied post-review fix: claim stamps 'claimed' immediately after ledger credit; vault move best-effort.
- Founder progress state: emberling defeated + claimed by testing agent; use POST /api/dragon-realm/admin/reset-progress to start fresh (epoch keeps claims replay-proof across resets).

## 2026-06 — Dragon Realm Full World Build verified (fork session)
- Fixed finale finisher block in engine.act(), missing REGION_ORDER export, added DragonRealmAdminPanel (rewards/access/reset), published dragonrealm-firequest-v1 to /games.
- testing_agent iteration_119: backend 12/12, frontend pass. Manual browser E2E: all 6 regions, 6 bosses, 4-phase Dragon King, finisher win, real +250 FP claim (906→1156), idempotent replay rejected.

## 2026-06 — ORAi Multi-Tool Project Creator (fork session, Phases A–F complete)
- NEW: /admin/orai = ORAi Projects (primary landing); old dashboard kept at /admin/orai/dashboard.
- Backend: services/orai_projects.py + routers/orai_projects.py (founder-only). Capabilities/suggest/estimate/sounds-eligible/draft/validate/approve(idempotent, rate-limited)/detail/cancel/retry/duplicate/archive/history/library. Collections: orai_projects, orai_assets, orai_project_audit.
- Reuses: orai_assistant chat, llm_router AI-Power tiers, orai_images, orai_voice TTS, audio/image/video stores, sound_permissions, game_studio estimate+build, rc_courses Course Maker, sora price table.
- Frontend: pages/OraiProjects.jsx + 11 components in components/oraiprojects/ (chat-first layout desktop+mobile, colorful tool cards, provider connect states, 3 smart suggestions, Complexity+AI Power sliders, dynamic settings, sound picker, debounced estimate, review/approve gate, live progress w/ refresh recovery, history).
- Providers registered but NOT connected (no keys): ElevenLabs, Runway, Pika, Stability, Replicate — disabled with reason, never suggested.
- Testing: iteration_120 — backend 15/15, frontend 100%; real tiny text project generated end-to-end (~$0.02); double-approve idempotency verified; mobile 390px no overflow. Post-test hardening: moderation filter on all eligible sounds, multi-word library search, retry audit action, count=0 estimate fix, video no-provider suggestion note (regression 13/13 pass).

## 2026-06 — ORAi Zero-Cost Recovery Repair + Migration status
- FIXED root causes: (1) VideoRecord.file_url AttributeError in orai_projects video stage -> services/video_store.playable_info() normalized helper (url/thumbnail/mime/provider/model/duration/status, never fs paths); save_video now audio_choice=original; (2) audio 0:00 -> repair endpoint recomputes duration via mutagen from real file; (3) Dragon Realm prompts routed to generic rpg -> game_studio GENRE_MAP extended (dragon realm/fire quest/battle dragons/etc -> turn_based_creature_rpg, existing dedicated runtime); (4) Asset Studio library now includes founder's ORAi image outputs (reusable, no regen); (5) manifest exposes cover status via existing cover workflow; (6) _cancelled treats deleted project as cancel (kills orphan pollers).
- NEW endpoint: POST /api/orai/projects/{pid}/repair (founder, ZERO-COST): reconnects orphan image assets, recomputes audio durations, keeps video honestly retryable, per-stage retry independence preserved.
- Tests: tests/test_orai_repair.py — 3 unit + full synthetic-damage integration PASS (metered retry part is opt-in via ALLOW_METERED_RETRY=1).
- INCIDENT: integration test's retry accidentally started ONE real Sora 8s job (~$0.40-0.80) before opt-in guard added; cancel not supported mid-processing. Guarded now.
- IMPORTANT: The user's damaged Dragon Realm ORAi project lives on PRODUCTION (not preview). Prod founder password reverted -> repairs reach prod only via redeploy; then user clicks nothing—repair endpoint must be called for that project, video stage retried via existing Retry.
- MIGRATION STILL PENDING: /tmp wiped by env restart killed the auto-migrate poller before any deploy; prod probe still 405 at last check + creds invalid. Export regenerated: /tmp/preview_games_export.json (37 games, decisions 1c/2b/3a). Executor: /tmp/auto_migrate.py (launch with MIG_USER/MIG_PW env when creds valid).

## Aug 5, 2026 — Asset Wiring Pipeline + 2.5D Action RPG Runtime (action_rpg_2_5d)
### Asset Wiring Pipeline ✅
- NEW `services/game_platform/asset_wiring.py`: RUNTIME_SLOTS adapters (23 runtimes → slots the renderer ACTUALLY consumes), placeholder_pct (required 2x weight), validate_wiring (required assets block PUBLISH only, never testing; broken → primitive fallback), find_library_match (library-search-before-generate, cross-game reuse), wire_assets (reuse_only | generate_required_only | generate_missing).
- Routes: POST /api/admin/games/{gid}/assets/wire, GET .../assets/wiring-report, POST .../assets/art-preset. Publish action in routers/games.py gated on validate_wiring publish_blockers.
- New slots: creature_sprite, card_face, tower_sprite, projectile_sprite, music_theme (audio: NO generation provider — library reuse or WebAudio synth fallback, honest).
- GameRuntime.jsx renderer consumption added for rpg/tbcr (sprites+battle bg), card_battle (card frames + enemy art + battle scene), tower_defense (tower/enemy/projectile sprites + projectile tracers), match3 (icon_set 4x2 slicing), tactics, roguelike, visual_novel portrait, body background for all, music_theme playback in music().
- suggest_prompt hardening: _slot_conventions (magenta chroma-key/tileset-grid/anim-strip) now appended to CUSTOM prompts too (was root cause of opaque sprites).
- Verified on 3 micro-demos: 10 generated + 7 library-reused, 0% placeholders, diversity gate pass ($0.40).
### Dragon Realm batch v2 (HALTED at founder request)
- /tmp/dragon_v2.py resumable orchestrator (build → wire → validate → diversity → auto-publish). v1–v3 built_wired UNPUBLISHED (library reuse 6/1/6 slots, $0.32 total) then founder pivoted to the runtime P0. State: /tmp/dragon_v2_state.json. DO NOT restart without founder ask.
### action_rpg_2_5d — first-class 2.5D Action RPG runtime ✅ (proof in Founder Review, NOT published)
- Frontend `arpg()` in GameRuntime.jsx (~250 lines): real-time 8-dir movement w/ accel, camera follow+look-ahead+bounds+arena-lock+shake, layered 2.5D (parallax bg, mirrored-ground, y-sort depth, depth-scaled sprites, shadows, lighting+fog overlays, ambient particles), melee/spell(mana)/dodge(i-frames, stamina), crits, knockback, burn status, enemy AI (patrol/chase/retreat/melee/ranged/caster + telegraphs), multi-phase boss w/ enrage+summons, loot/equipment/potions, NPC dialog (click OR E key; data-testid arpg-dialog/-close), quests (defeat/collect), XP/level, checkpoint respawn w/ lives, exit portal region transitions, SAVE_X.arpg save adapter, gamepad, mobile joystick + testable touch buttons (arpg-touch-*). Edge-triggered key latch fixes fast keypresses.
- Registered EVERYWHERE: game_studio (RUNTIMES/labels/WIN_LOSS/GENRE_MAP/mechanics/PLAYER_REPS/identity/SPEC_SYSTEM schema/validate_spec), runtime_selection capability matrix, runtime_registry (runtime_action_rpg_2_5d_v1 / tpl / renderer_action_rpg_2_5d_v1 + action_rpg family upgraded partial→generatable), execution_contracts (impl arpg, renderer action_rpg_2_5d_layered), asset_wiring slots, pipeline EDIT_SECTIONS (+13 editor sections), games_plus RUNTIME_KEY_ACTIONS/TOUCH_LAYOUTS.
- ART PRESETS (game_assets.py): fantasy_hd (DEFAULT for action_rpg_2_5d, quality-3 uplift) | pixel | stylized | cartoon | realistic; ARPG_SLOT_EMPHASIS bakes the founder reference-image benchmark into every future arpg game. Founder switch: POST .../assets/art-preset.
- Proof game "Dragon Realm: The Fire Quest — 2.5D Runtime Proof" (id 254523a78f694547ac36a6845e037e92, pending_approval): built via OPC plan→build, 9 premium assets ($1.05 incl 6 regenerated after chroma-key fix), 0% placeholder. Verified live: planner routing both ways, contracts, movement+camera, melee/spell/dodge, enemy AI, NPC dialog, quest completion, equipment pickup, checkpoint, boss PHASE 1 engagement + arena lock + boss bar, fire claim + duplicate 409, save row, mobile 390px, regression on other runtimes (testing agent iteration_122 + manual screenshots). PHASE 1→2 transition verified in code only (automation couldn't out-DPS the boss).
- Known honest limits: no 3D/WebGL; environment animation = ambient particles/fog/parallax (painted backgrounds are static); sprite anim = frame-strip capable but generated assets are single-frame; canvas HUD not DOM.

## 2.5D Dragon Realm Demo — Full Runtime Upgrade v2 (Aug 5, 2026) ✅ FOUNDER REVIEW (NOT published)
Game: "Dragon Realm: The Fire Quest — 2.5D Demo" id=94f0cbaec37c4f08bd1a0a11627040ad, status=approved (founder-playable via /games?play=..., hidden from public hub until published).
Engine (runtime_action_rpg_2_5d_v1, arpgSS in GameRuntime.jsx — full rewrite):
- Levels 3–3.5× longer: 7,200 / 7,800 / 8,400 px (was 2,400–2,600). Flat-test-level debug hack REMOVED, real geometry restored + regenerated.
- Camera: smooth lerp w/ velocity lookahead + hard clamps (player always within 18–64% of screen — can never be outrun).
- Wizard 2×: 100·k sprite (~28% of scene height, matches reference), soft shadow, staff glow when Fire-buffed.
- Animation blending: per-state pose targets (idle/walk/run/jump/fall/attack/cast/dodge/hurt/death) lerp-blended each frame + landing squash, attack arc slash, cast ring, death fall+fade.
- Layered parallax: bg image (0.18) + procedural mid silhouettes per zone (castle+tree lines / stalactites+crystal glow / volcano+ridges) + zone ambient particles (fireflies/sparkles/embers).
- Terrain: natural elevation steps (y 240–300), river/lava gaps, wooden bridges (arched, planked), waterfalls w/ spray, floating platforms (moving in Caverns), crumbling ledges (Volcano), cave mouths, tree/crystal/rock props.
- Hidden paths: 3 upper platform chains per level (gems + Fire pickup at top) + lower ledge under first bridge.
- Checkpoints: 3 per level (flags, green when passed, +6HP/full mana). Hazard fall = -1 life + respawn at last checkpoint WITHOUT world reset; combat death = level reset at checkpoint.
- Enemies: walker/spitter/bat + new brute (slow heavy hitter), 19–24 per level, platform-bound patrol/chase AI, telegraphs, hp bars.
- Bosses: multi-phase w/ phase pips on HP bar, homing altitude (drops into melee reach), volley/swoop + NEW fire-breath sweep (phase 2+), enrage, death anim (fall+bursts+loot drop). Ember(55hp/2ph) / Crystal Shadow(70/2) / Infernal(85/3).
- Fire Power: pickups grant 8s +50% dmg buff + HUD meter; completion awards land in Fire Vault (verified server-side: +5 toast, pool 1,000,000→999,890).
- HUD: panel w/ hearts, HP(numbers)/MP/XP bars, Lv, coins/gems/fire, Fire-buff timer, stage label top-right, boss bar w/ phases, objective line.
- Coyote time (0.12s), jump buffer via latched keys, gamepad + mobile joystick retained.
Data: spec.stages regenerated via /tmp/dr25d_upgrade.py (25/31/27 platforms, 19/20/24 enemies, 55/56/63 pickups per level). Controls/description text corrected (J attack, K spell, L dodge).
Testing: scripted Playwright playtests — boss kill loop E2E (engage→phases→breath→death→portal→DEMO COMPLETE→Fire award), full L1 traversal (checkpoint respawn verified), 3-stage transition run w/ per-level assets (_l2/_l3) confirmed, final Score 404 completion screen. Internal boss-test clone deleted after use.
Costs: $0.00 OpenAI this session — 15/15 asset slots reused from existing ORAi library (100% reuse, 0 generated).

## 2.5D Demo — Media Quality Upgrade v3 (Aug 5, 2026) ✅ FOUNDER REVIEW (NOT published)
- Polish iteration 2 (code, $0): movement-synced sprite animation speed, run dust puffs, forest god rays + drifting clouds, lava bubbles, cavern water drips, gem/fire sparkle twinkles, enemy projectile trails, cinematic camera (stronger facing lookahead, softer lerp, hard never-outrun clamps), hero 104·k, alternate elevated ROUTES (2 long plateaus/level w/ step platforms, own enemies+gems), waterfall SECRETS (gems + fire behind first 2 falls), pre-boss checkpoint added (4 per level).
- Media generated via ORAi pipeline (job dr25d_media_v3, $0.10): icon_set (perfect 4x2 grid: coin/gem/potion/fire/mana/star/chest/key — wired, renderer map {coin:0,gem:1,potion:2,fire:3,mana:4}) + ui_frame (generated but UNWIRED — border-image slicing broke DOM HUD; kept in library). icon_set + ui_frame added as optional slots for action_rpg_2_5d in asset_wiring.py.
- Boss portrait in canvas HUD ($0): circular clipped boss_sprite beside boss HP bar, enrage-colored ring.
- Verified via scripted playtests: icons in-world, plateau routes, god rays, checkpoint respawn, boss portrait + phases + breath. Wizard sheet confirmed HD 4-frame walk cycle (reuse, no regen needed).
- Cumulative AI cost for this game: $0.89 (build $0.04 + art v1 $0.75 + media v3 $0.10). Session spend: $0.10 of approved $25.
- Honest limitations: no music provider connected (synth fallback; music_theme slot ready), per-state drawn animation frames not supported (procedural pose blending instead), no NPC/dialogue mechanic, stepped terrain (no true slopes), ui_frame DOM styling incompatible with arbitrary generated frames.

## Media Quality v4 + OPC Project Media Import (Aug 5, 2026) ✅ FOUNDER REVIEW (NOT published)
Dragon Realm polish (code, $0 API):
- Ground rework: tileset surface caps + zone-tinted earth-gradient body w/ sparse embedded detail (no more repeated flat tiles), per-tile shade variance, edge AO.
- Trees: layered dark-canopy painter w/ per-tree color variance + sun highlight, moved to back paint pass (behind platforms).
- Destructible props: treasure chests (icon_set chest sprite) — melee breaks them → coins + gem/potion burst. 3/level (behind waterfall, plateau, pre-boss).
- Spell pickup: 'star' = ARCANE SURGE (6s rapid casting: 1 mana, 0.28s cd) + full mana; 2/level, HUD SURGE timer.
- Desktop canvas ability toolbar (bottom-center, ref #2 style): melee/spell/dodge slots w/ cooldown sweep + key labels (mobile keeps touch row). Msg line moved up to avoid overlap.
- Boss ambient ember particles while engaged. Icon map now includes star:5.
- Stage data regenerated (same seed → same layout) + props/stars + pre-boss checkpoint in generator (/tmp/dr25d_upgrade.py).
NEW OPC FEATURE — Project Media (reusable for ALL future projects incl. Unity/VR/AR):
- backend/routers/project_media.py: POST /api/orai/media/upload (multipart; images/sheets/audio/video/GIF/GLB/FBX/OBJ/Blender/Unity packages/prefabs/materials/HDRI/Unreal(stored)/PDF/ZIP), auto ANALYSIS (PIL dims, transparency, sprite-sheet frame detection, audio duration via mutagen, zip entries), auto-tagging, runtime-usage mapping; GET /api/orai/media (search); replace w/ VERSIONING + restore + versions compare; founder approve/reject moderation; DELETE archive; GET/POST /limits (founder unlimited, users configurable — default 50 files/250MB, set to 75/300).
- Uploads register into game_asset_library → instantly searchable by blueprint matching + AssetLibrarySearch + OPC generation reuse.
- Public serving /api/public/project-media/{name} (whitelisted in server.py global auth guard) for runtime/iframe use.
- Frontend: components/oraiprojects/ProjectMedia.jsx (drag&drop, search, preview grid, replace/restore/approve/reject/archive) mounted on OPC page under ORAi Chat.
- Tested via curl E2E: upload→analysis (4-frame sheet detected from 512x128)→search→replace(v2)→versions→restore(v3)→approve→limits; GLB typed model_3d/unity; public serve 200; test assets archived after.
Known quirk: GameRuntime.jsx suffered two duplicate-tail write artifacts this session (stale fragments after component end causing compile errors + one lost edit) — both fixed; verify file tail if editing again.
Session AI cost: $0.10 total (icon_set+ui_frame job earlier). Cumulative game total $0.89.

## Dragon Realm V1 — FINAL COMPLETION & PUBLISH (Aug 5, 2026) ✅ PUBLISHED to /games
- Founder Reference #3 collectible sheet WIRED as official icon_set (fetched from founder upload, transparent 1408x768 4x2 grid, pushed through S3 storage adapter — fixed 307-redirect/broken-image issue caused by local-only file copy).
- CRITICAL FIX: 'dt is not defined' crash in drawWorld boss ember line (killed hero/HUD/boss rendering each frame once boss engaged) → fixed-rate spawn. Hardened all direct drawImage calls with naturalWidth guards (broken image can no longer crash the render loop).
- Collectible economy: coin +10🔥, diamond +50🔥, fire +100🔥 (+dmg buff), star +500🔥 (+surge), red potion 50% HP, blue potion FULL restore, enemy kills +3-10🔥, dragons +1000🔥; in-game FP counter in HUD.
- GOLDEN KEYS: 1 hidden per level → permanent Fire Vault Key Wallet. Backend: POST /api/fire/keys/collect (idempotent), GET /api/fire/keys (wallet + future uses: Portals/Games/Realms/Nexus/AR/VR/XR). GameRuntime component forwards iframe 'game_key' postMessage → API. VERIFIED: real key persisted for stealth during playtest.
- Treasure chest: exactly ONE per level after brute encounter, randomized rewards (2 coins + gem/potion/fire/star).
- Enemies ~2x size (walker/spitter 88k, bat 68k, brute 116k) w/ corrected feet/collision/hp-bar geometry; player feet-contact fix (draw center -0.24·HERO).
- Levels halved & densified: 3600/3900/4200px, 13/15/17 enemies, 3 checkpoints incl. pre-boss, 2 plateau routes, 2 hidden chains, waterfall secrets, 1 star + 1 key hidden per level.
- Combat juice: screen shake on all hits, +N🔥 kill popups, bigger impact bursts.
- project_media now S3-aware (adapter put on upload, redirect fallback on serve) — production-safe.
- VALIDATION (scripted playtests): icons/chest/key render from founder sheet ✓, FP economy popups ✓, key→wallet E2E ✓, boss visible/phases/portrait/breath/arena ✓, checkpoint respawn ✓, stage transitions + per-level assets ✓ (proven earlier same runtime), boss kill→rewards→portal→complete→Fire award ✓ (proven earlier).
- PUBLISHED: status=published, live in /games list. AI cost this final phase: $0.00 (founder-supplied art reused). Cumulative: $0.89.

## P0 — Preview→Production Game Publishing FIX (Aug 5, 2026) ✅
ROOT CAUSE: preview (DB test_database @ localhost) and production run SEPARATE MongoDB databases; deploys ship code only — published game records never reached production. Media itself is in SHARED R2 storage (media.ourrealm.social), so only DB records were missing.
SOLUTION — seed-bundle promotion system:
- services/game_promotion.py: build_bundle (game doc + referenced orai_assets records + R2 existence check w/ self-heal upload), import_bundle (idempotent; insert-if-missing; force-mode backs up existing to game_promotion_backups + never overwrites newer prod records + preserves prod play counters), startup_import (boot-time import of repo-shipped bundles — armed unconditionally in _safe_startup, runs on production at every deploy), verify_game (env-local record+status+asset checks).
- routers/game_promotion.py (founder-only): /api/admin/games/promotion/{status,seed,export/{gid},import,unpublish/{gid},verify/{gid},history}. Every action audited in db.game_promotions.
- backend/seed_bundles/: 27 bundles written (ALL published games; 3 RTTEST internal test records auto-skipped). Ships with deploy (not gitignored). Dragon Realm bundle: 16 asset records, 0 missing.
- frontend components/admin/ProductionPromotion.jsx on /admin/games: env-aware panel (PREVIEW vs PRODUCTION banner), Write Seed Bundles, Import Bundle (file), per-game Export/Verify/Unpublish, Promotion History.
- Cover URLs already production-safe (/api/media/* is a stateless R2 presigned proxy); spec asset URLs stay /api/public/game-assets/* and work because bundles carry the orai_assets records.
TESTED: seed write (27 written/3 skipped), idempotent re-import (skipped: already present), fresh-import simulation (imported + appears in /api/games + verify all-green), startup boot pass, audit history, UI panel screenshot. Test import record cleaned up.
AFTER NEXT DEPLOY: production boots → startup_import inserts all 27 published games → they appear on production /games automatically.

## P0 — promotion_version Upgrade Path + Mobile Playability Hotfix (Aug 5, 2026) ✅
### Backend — versioned production upgrades (services/game_promotion.py, routers/game_promotion.py)
- import_bundle now version-aware: upgrades in place ONLY when bundle promotion_version > existing (never downgrades, never duplicates); forced replace w/o version bump keeps the updated_at recency safety net.
- Production-state preservation on upgrade: plays, saves, stats, created_at + fire_economy.pool/distributed merged into the new config (Fire never re-issued/wiped). Full pre-upgrade backup → game_promotion_backups.
- startup_import simplified: one code path via import_bundle; logs imported/upgraded.
- Deterministic digest for version bumping now excludes volatile fields (plays, stats, saves, updated_at, fire_economy).
- Dragon Realm bundle REGENERATED: promotion_version 2, 17 assets, 0 missing. Production (record at v1/None) will upgrade in place on next deploy.
- TESTED: /tmp/test_promotion_upgrade.py against isolated fake-production DB — 19/19 pass (fresh import, idempotent skip, downgrade rejected, upgrade preserves plays/saves/stats/created_at/fire pool, backup written, startup idempotent).
### Frontend — mobile 2.5D controls (components/games/GameRuntime.jsx, arpgSS)
- Joystick: pointerId-tracked + setPointerCapture (drag continues off-canvas; a 2nd finger can't hijack it).
- Jump/Melee/Spell/Dodge buttons: pointerdown/pointerup + setPointerCapture + touch-action:none + -webkit-touch-callout:none; latch-buffered (350ms) into the game loop.
- Overlap fix already in place: body.or-game-playing hides bottom nav + ORAi FAB during play (App.css/index.css).
- Ground contact verified visually: sprite bottom padding 0.19 vs draw offset 0.303·HERO → feet flush on tile tops.
- TESTED at iPhone viewport 390x844 with REAL CDP touch events: all 4 buttons fire; multi-touch run+jump, run+melee, run+spell all work; hazard fall respawns correctly; wizard grounded (no hover).
