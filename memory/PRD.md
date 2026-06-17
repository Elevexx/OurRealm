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
Phase 1 · 2 · 2.5 · 3 · 4A · 4A follow-up · 4B (Polls/Personalization) · 4B follow-up (Made for You) · Landing/Modes refresh · PWA icon · mode animations · Phase 5 foundation (Home Dashboard + Admin Analytics + PWA prompt + autoplay) · **Phase 5 MVP + deferred polish (Feb 2026)** · **Phase 5+ Parts 0/1/2/3 (Feb 2026)** · **Phase A — Moderation Engine (Feb 2026)** · **Phase B — Support Messaging System (Feb 2026)** · **Phase 8 — FAQ + Messages popup polish (Feb 2026)** · **Phase 4 — Comment likes/replies + Universal Reporting (Feb 2026)** · **Phase 5 — In-feed video + Share-to-user + Shared-post popup (Feb 2026)**.

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

### Video posts — production hotfix (Feb 2026)

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
