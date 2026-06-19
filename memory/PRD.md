# OurRealm — Product Requirements Document (PRD)

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
Phase 1 · 2 · 2.5 · 3 · 4A · 4A follow-up · 4B (Polls/Personalization) · 4B follow-up (Made for You) · Landing/Modes refresh · PWA icon · mode animations · Phase 5 foundation (Home Dashboard + Admin Analytics + PWA prompt + autoplay) · **Phase 5 MVP + deferred polish (Feb 2026)** · **Phase 5+ Parts 0/1/2/3 (Feb 2026)** · **Phase A — Moderation Engine (Feb 2026)** · **Phase B — Support Messaging System (Feb 2026)** · **Phase 8 — FAQ + Messages popup polish (Feb 2026)** · **Phase 4 — Comment likes/replies + Universal Reporting (Feb 2026)** · **Phase 5 — In-feed video + Share-to-user + Shared-post popup (Feb 2026)** · **Phase C — Real-Time Presence + Real Discover/Trending (Feb 17, 2026)** · **Phase D — Home ➕ Composer Rebuild + Sound Posts + Range Audio (Feb 17, 2026)** · **Landing Page Image-Only Rebrand (Feb 18, 2026)** · **Persistent Media Storage + Promote-to-Interest + Copyright Queue UI (Feb 19, 2026)** · **Realm Pulse Analytics + BannerEditor on Realms + R2/S3 Adapter Scaffold (Feb 19, 2026)** · **Realms/Groups Community Hub — Phase 1: Real backend + Community Chat + People Online + Floating DMs (Feb 19, 2026)** · **Admin User Control + Password Reset widgets on /support (Feb 19, 2026)** · **Admin Hub at /admin (Feb 19, 2026)** · **Admin widgets mounted on /admin/support + Realms Phase 2 foundation (Feb 19, 2026)** · **Realms Phase 2 & 3 validation + Community Hub Widget (Feb 19, 2026)** · **P0 Navigation + Realm Mobile Regression Batch (Feb 19, 2026)** · **Media Compatibility Layer + Realms Icon Swap (Feb 19, 2026)** · **Realm Ownership Controls — Edit + Delete (Feb 19, 2026)** · **Account Deletion + 30-Day Restore + Founder Admin Tab (Feb 19, 2026)**.

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
