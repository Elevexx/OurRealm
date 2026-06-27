# OurRealm — Product Requirements Document (PRD)

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
