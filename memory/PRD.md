# OurRealm — Product Requirements Document

## Phase 7 — Top 8 Friends, Messenger anchored menu, Thoughts, Feed media composer (Feb 2026)

**Top 8 Friends widget (drag-reorder)**
- New `<TopEightWidget>` component renders on Profile via the WidgetBody `case 'top8'`.
- `DEFAULT_WIDGETS` in `/app/frontend/src/data/mockData.js` now includes a Top 8 entry so new accounts always start with it.
- `core/config.py` adds `TOP8_WIDGET_TYPE = "top8"` + `default_top8_widget()`; `core/seed.py` runs an idempotent startup migration (`migrate_inject_top8_widget`) that injects Top 8 into every existing user that doesn't already have one (positioned directly after My Feed).
- Drag-and-drop reorder via existing `@dnd-kit` infrastructure; layout is persisted via the same Save flow as other widgets.

**Messenger anchored long-press edit/delete menu**
- Long-press (or right-click ~700ms) on a sent bubble opens `[data-testid=real-msg-menu]` anchored INSIDE the bubble (top:100% / right:0 for own messages).
- Edit reveals an inline input with Save → bubble text updates and `[data-testid=real-msg-edited-{id}]` indicator appears.
- Delete removes the bubble immediately; deletion persists after reload via `DELETE /api/messages/{msg_id}`.

**Thoughts post classification (with backfill)**
- Text-only posts from the Feed composer now save with `media_type='thought'`.
- Startup migration `migrate_text_posts_to_thoughts` reclassifies any legacy posts with `media_type` in `{text, post}` → `thought`. Idempotent.

**Feed composer media options**
- Composer exposes Thought / Image / Video / Link chips with `data-testid=feed-composer-type-{id}`.
- Selecting Image/Video/Link reveals a URL input; Image and Link show inline previews; Video shows a render hint.

**Media Selection bar persistence**
- Selection persists across SPA navigation via the `ourrealm.feedMedia` localStorage key (verified `aria-pressed=true` round-trip).

**Iteration 4 polish — code-quality fixes**
- Fixed React duplicate-key warning on `/feed`: `BottomNav.ITEMS_LEFT` had two entries with `to:"/feed"` (Home + For You) and was keyed by `to`. Re-keyed by `testid`.
- Fixed three nested-`<button>` hydration violations by converting outer interactive container to `<div role="button" tabIndex={0} onKeyDown=…>` in:
  - `Messages.jsx` real DM row (dm-{username}) which contained `dm-pin-*` button.
  - `Discover.jsx` `CreatorCard` which contained an inner Follow button.
  - `ModesPage.jsx` `modes-card-{m}` which contained `modes-apply-{m}` button.
- Feed now de-dupes the merged server+mock post list by `id` to defensively avoid future key collisions.

## Phase 6 — Early Adopter, My Feed, Privacy & UX upgrades (Feb 2026)

**Early Adopter / VIP system**
- New `is_vip` + `vip_joined_at` fields on user docs. `VIP_CUTOFF=1000` enforced server-side at `/api/auth/register` — anyone joining while total users < 1000 receives a permanent VIP badge; once reached, no new grants.
- Idempotent grandfather migration on startup: every pre-existing account inherits `is_vip=true` with `vip_joined_at = created_at`.
- One-time migration strips `is_founder` / `role=founder` from every account except `@stealth`.
- New `<VipBadge>` component with hover/tap tooltip "VIP Member · Joined {date}". Surfaced on own profile (Profile.jsx in both edit + view modes), public profiles (FounderProfile.jsx), and Account Settings header. Founder badge still renders for @stealth.

**My Feed default widget**
- New default widget type `myfeed`, auto-prepended on register via `default_myfeed_widget()` in `core/config.py`.
- Idempotent startup migration injects My Feed at the top of every existing profile that doesn't already have one (preserves the user's saved custom layout).
- New endpoint `GET /api/posts/feed/by-user/{username}` returns the owner's posts newest-first with audience filtering. Wired into `MyFeedWidget.jsx` which is rendered by both Profile.jsx and FounderProfile.jsx widget grids.
- `WIDGET_TYPES` in `mockData.js` now lists My Feed first so the widget-library suggestion menu surfaces it as the top option.
- Users can move / resize / remove via the existing drag-and-drop infrastructure; deletions are not auto-restored.

**Post privacy controls (Public / Friends / Private / Custom)**
- New `audience` Pydantic schema on `PostCreate` with `visibility`, `user_ids`, and a reserved `friend_group_ids` field (accepted but unused — ready for the future Friend Groups release without a migration).
- Backend `_visibility_query` enforces: public is global, friends-only requires authorship by a friend, private is author-only, custom requires viewer in `user_ids`.
- New `<AudiencePicker>` modal (mobile-friendly bottom sheet on small screens) with friend multi-select + "Friend Groups — Coming Soon" placeholder.
- Wired into the Feed composer; the selected audience is sent to `/api/posts` on submit.

**Home page cleanup + interest persistence bug fix**
- Removed the Top Categories pill row and the People/Lives carousel from `/home` as requested.
- Categories now appear higher with a responsive grid (`grid-cols-3` mobile, `sm:grid-cols-4`, `lg:grid-cols-6`).
- Header + star bar + media-selection bar untouched.
- **Interest persistence bug fix**: previously the toggle's `setSelected` updater mutated a `Set` non-idempotently, which React 18 Strict Mode double-invoked in dev, undoing some selections. Rewrote the toggle to compute the next set from current closure state and pass a plain value to `setSelected`. Persistence is now reliable across refreshes and round-trips to the For You feed.
- Server PATCH happens once on Next (avoids per-toggle request races).

**Top-left logo + Signup logged-in behavior**
- Top-left logo now routes to `/` (landing) in both states.
- Landing, when logged in: replaces the Sign Up / Sign In pills with `CONTINUE AS @username` + `SIGN OUT` + `Browse as Guest`. Sign-out reloads the page.
- `/signup` always shows the signup form + mode selector. If logged in, a small `signup-loggedin-strip` shows above the form with Continue / Sign Out actions. No automatic redirect away.

**Bottom Nav routing**
- Bottom-nav Home → `/feed`.
- `/feed` got a "Customize Feed" CTA that routes back to `/home` (interest picker). The `/home` URL is unchanged so bookmarks keep working.

**Account Settings**
- New `/settings/account` page (linked from the gear icon visible top-right of own profile in edit mode).
- Lists 8 future account sections (profile info, username, password, email, privacy defaults, notifications, blocked, delete) — each clearly tagged "Coming Soon". The header shows the user's name + VIP badge if applicable.
- Existing `/settings` still owns appearance/mode preferences; there's a back-link between the two.

## Earlier Phases

## Vision
A premium social platform powered by:
- A 4-mode visual system (Neon, Business, Millennium, Stealth) that re-themes the entire app.
- A drag-and-drop widget-based Profile system.
- Public usernames, friend graph, friends-only DMs, communities ("Realms"), feeds, sounds and wallets.

## Personas
- **Founders/creators** showcase widgets (live, music, merch, polls, wallet, events) on a customisable canvas.
- **Fans** discover creators, follow profiles, become friends and message each other.
- **Stealth (founder)** — the official seeded account every user is automatically friended with.

## Tech Stack
- Frontend: React, TailwindCSS, React Router, @dnd-kit, lucide-react, axios.
- Backend: FastAPI, MongoDB (motor), JWT cookie + Bearer auth, OTP flow for founder.
- All third-party access via REACT_APP_BACKEND_URL → ingress → backend `/api/*`.

## Core Pages (built)
Landing, SignUp (with username availability + suggestions), SignIn, Founder OTP, Home (interest+media picker), For You Feed, Discover 2.0 (+ Profile Widget Swiper), Sounds, Realms, Messages (with friends-only real DM overlay), Wallet, Friends (Friends/Requests/Find People), Profile (drag-and-drop widgets, Public toggle), Public Profile (`/public/:username`), Modes.

## Implemented (latest session — Feb 2026)
**Phase 1 — Public Profile & Friend system**
- `/public/:username` dynamic route renders the public profile component.
- Sign-up now collects username (3-24 chars, regex-validated, debounced live availability + smart suggestions).
- `AuthContext.register()` accepts a `username` parameter.
- Friends page rebuilt: real backend search (`/api/users/search`), three tabs (Friends/Requests/Find People), Add Friend / Accept / Decline / Cancel actions wired to `/api/friends/*`.
- Public profile shows Friend status (none/outgoing/incoming/friends/self) with Add Friend / Accept / Pending / Friends chip.
- Public profile Message button is friends-only with inline error UI.

**Phase 2 — New requirements (Message 170)**
- Top-Star-Bar logo navigates to `/signup` instead of `/home`.
- `Home.jsx` standalone "Continue" button removed; only the MediaTypeBar Next arrow remains and routes to `/feed`.
- Every newly-registered user is auto-friended with `stealth`; startup migration backfills the same for existing users.
- Messaging is restricted to friends: backend (`/api/messages` + `/api/messages/thread/{u}` + `/api/messages/can-message/{u}`) returns 403 "You can only message friends" for non-friends; UI shows a blocked overlay with "Open profile" CTA.
- `Profile.jsx` defaults own-profile to Edit mode; "View as Public" button navigates to `/public/{me}`. On a self-public profile, a "Switch to Edit" button routes back to `/profile?edit=1`.
- Discover page now has a "Profiles & Their Widgets" horizontal swiper using `/api/users/featured`; each card renders up to 4 `MiniWidget` mini-cards of the user's actual saved widgets.

**Phase 3 — QA**
- Pytest backend suite: 17/17 Phase-2 tests + 20/20 prior tests pass.
- Playwright frontend: all requested user flows verified (`/app/test_reports/iteration_2.json`).

**Phase 5 — Backend refactor + ID-based friend graph + real Pinned/DMs (Feb 2026)**
- Split monolithic `server.py` into routers:
  - `backend/core/{config.py, db.py, security.py, deps.py, seed.py}` (env, mongo, bcrypt + JWT + cookies, current-user dep + lockout, startup seed/migration).
  - `backend/models/schemas.py` (Pydantic request/response models + `serialize_user`).
  - `backend/routers/{auth.py, friends.py, messages.py, profile.py, posts.py}`.
  - `server.py` is now ~60 lines of wiring (app factory, CORS, router mount, startup/shutdown).
- **Friend graph migrated from usernames → user_ids** for rename safety. All `friends / friend_requests_in / friend_requests_out / pinned_threads` arrays on user docs store user_ids; `messages.conv_id` is now `min(uid):max(uid)`; each message stores `from_user_id` + `to_user_id` (with username snapshots for display).
- Idempotent startup migration converts legacy username-based docs to id-based — verified migrating 42 users + 4 legacy messages on first boot.
- Backwards-compatible API surface: clients still address friends and message targets by `username`; routers translate to id internally.
- New `GET /api/messages/threads` returns `[{conv_id, peer:{id,username,name,avatar_url,is_founder}, last_text, last_at, last_from_me, is_pinned}]` sorted pinned-first then by recency.
- New `POST /api/messages/threads/pin` & `/unpin` (body `{peer_username}`).
- Messages.jsx Pinned + DM lists now driven by real `/api/messages/threads`. Pinned section falls back to mock cards only when the user has zero pins (preserves visual design). Clicking a real DM opens the existing friends-only real-chat overlay via `?to=username`. Pin/unpin icons inline on each DM row. Group Chats section remains mocked (no group infra yet) — keeping the UI intact per user instruction.

**Verification** (manual + automated curl): friend-request lifecycle (none → outgoing → incoming → friends → decline → none), 403 enforcement, message persistence with id-based conv_id, thread aggregation, pin sorting, refresh-on-send.

**Phase 4 — App-wide Responsive Design Audit (Feb 2026)**
- Global foundation in `index.css`: `box-sizing: border-box`, `html/body/#root { max-width: 100%; overflow-x: hidden }`, responsive `img/video/iframe { max-width: 100%; height: auto }`, fluid clamp-based typography (`.or-text-h1/h2/h3/body/small`), `.or-hscroll` utility for horizontal-scroll rows, `:where(main,section,article) > * { min-width: 0 }` to fix flex/grid blowouts, dedicated 640-1023px tablet hooks, iPhone-SE (≤380px) sizing for nav.
- `index.html` viewport meta now uses `viewport-fit=cover` for proper notch/home-indicator handling.
- `Layout.jsx`, `TopStarBar.jsx`, `BottomNav.jsx` all consume `env(safe-area-inset-*)`.
- `BottomNav` rewrite — flex items use `flex: 1 1 0%; min-width: 0` + ellipsizing labels so all 7 buttons (Home/Discover/For You/+/Wallet/Friends/Profile) fit cleanly at 320px.
- Messages page grid: `md:grid-cols-[180px_minmax(0,1fr)]` + `min-w-0` on aside & main panel to prevent the 234px content blowout previously seen at 320px.
- Friends featured 8-circle row converted from fixed 80×80 px to `aspect-square w-full` so they shrink on tiny screens.
- ModeSwitcher pills are now `overflow-x: auto` with snap so all 4 mode chips remain accessible.
- Result: **0 horizontal overflow** at 320 / 375 / 390 / 414 / 430 / 768 / 1024 / 1440 across all 15 routes, verified via Playwright probes and full testing_agent_v3_fork sweep.

## Data Models
- users `{id, email, username (unique), password_hash, name, bio, avatar_url, is_founder, is_verified, widgets[], friends[], friend_requests_in[], friend_requests_out[], created_at}`
- otp_codes `{email, code, expires_at}`
- posts `{user_id, media_type, content, likes, created_at}`
- messages `{id, conv_id, from_username, to_username, text, created_at}`

## Key API Endpoints
`/api/auth/{register,login,logout,me,refresh,otp/request,otp/verify,username/check}` ·
`/api/users/{search,featured}` ·
`/api/profile/by-username/{u}` ·
`/api/friends/{list,status/{u},request,accept,decline}` ·
`/api/messages/{can-message/{u},thread/{u}, POST /api/messages}`

## Backlog
**P1**
- Block/Unblock users + reporting flow.
- Soft-delete + privacy toggle on `/api/users/featured`.
- Refactor `server.py` into routers (`auth.py`, `friends.py`, `messages.py`, `profile.py`).
- Replace username-based friend storage with `user_id` foreign keys.
- Replace the still-mocked Messages.jsx top sections with live data (recent threads from `/api/messages/threads`).

**P2**
- Username rename feature (with cascading update across friend lists).
- Pagination on message threads.
- Realm membership + community DM threads.
- Notifications service driven by friend requests + messages.

## Credentials
See `/app/memory/test_credentials.md`.
