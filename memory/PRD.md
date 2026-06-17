# OurRealm — Product Requirements Document (PRD)

## Mission
Premium social platform with multi-mode UI, widget profiles, unified messaging, Sounds library, Polls, personalization, Home Dashboard, and Admin analytics.

## Tech Stack
React 19 · FastAPI · MongoDB (Motor) · Supabase (Postgres + Realtime for messaging only) · Mutagen · pgeocode.

## Architecture: dual-store
| Domain | Storage |
|---|---|
| Users, auth (JWT), profiles, widgets, friends, posts (+polls), comments, likes, notifications, images, tracks, track_likes, preferences, **dashboards** (Phase 5), ZIP/radius | MongoDB |
| Chats, Groups, Realms, Messages | Supabase Postgres + Realtime |

## Completed Phases
- 1, 2, 2.5, 3, 4A (+ Share to Chat follow-up), 4B (Polls/Personalization/Search), 4B follow-up (Made for You rail), Landing/Modes refresh, PWA icon update, mode animations.
- **Phase 5 (Feb 2026 — SHIPPED foundation)**: Home Dashboard, Admin Analytics, PWA install prompt, media autoplay hook.

## Phase 5 — what shipped this round
### PWA install prompt (`components/InstallPrompt.jsx`)
- Globally mounted in `App.js`. Auto-shows ~5.5s after first paint for non-standalone visitors; remembers dismissal in localStorage for 14 days.
- Android: uses `beforeinstallprompt` for one-tap install.
- iOS/Safari: Share → Add to Home Screen → Add walkthrough (3 steps with icons).
- Themed via existing OurRealm surfaces; shows `/icon-192.png` (the new transparent maskable icon).
- Detects standalone mode and never shows when already installed.

### Home Dashboard (`pages/HomeDashboard.jsx`, `routers/phase5.py`)
- New `/home` route now renders the dashboard. Legacy interest-picker home preserved at `/home/legacy`.
- Backend persistence: `GET/PUT /api/dashboard/layout` (per-user widget list). First call seeds 5 defaults.
- Customize mode: reorder (up/down arrows), remove, per-widget visibility (Public/Friends/Private — Custom shape stored, multi-select UI deferred).
- Widget library modal with all 14 widget types from spec.
- Live widgets implemented: **For You Feed**, **Weather** (ZIP-aware placeholder structure), **Realms** (reads Supabase), **Groups** (reads Supabase), **Top News** (placeholder rows), **Trending Sounds** (reads `/sounds/charts/top100`). Remaining widget types render a clean "structurally ready" placeholder.
- "Add Home Widgets" outlined dashed tile at end of grid.

### Admin Analytics (`pages/AdminAnalytics.jsx`, `/api/admin/analytics`)
- **Server-side guarded** — checks `current["username"] == "stealth"`; non-admin gets HTTP 403 (curl-verified).
- Aggregated user metrics (total/new signups/DAU/MAU/retention), content (posts series + media distribution + likes/comments), messaging (messages/chats/groups/realms), sounds (uploads series + category distribution + total plays + top 10).
- Time range selector: 24h / 7d / 30d / all time.
- Inline SVG line charts + horizontal bar charts (zero chart-lib weight).
- Accessible at `/admin` and `/admin/analytics`.

### Media autoplay hook (`lib/useAutoplayOnVisible.js`)
- `IntersectionObserver`-based; threshold 0.5. Auto-plays muted video when ≥50% visible; pauses when off-screen. Ready to drop into feed cards, profile media, etc.

### Existing endpoints + Phase 3 messenger: untouched.

## ⚠️ Explicitly deferred in Phase 5 (next pass)
These are written into the spec but not yet implemented — flagging so they're not assumed shipped:

1. **Custom-visibility multi-select friends UI** — schema stores `custom_user_ids[]` but the multi-select picker is not wired (visibility currently chooses among Public/Friends/Private).
2. **Widget resize** — `size` field is persisted (`sm/md/lg/xl`), but no drag-to-resize UI yet.
3. **Feed Customize page rename + "Pick your interest" subtitle + icon-only small-mobile bars** — current Feed page already has a "Customize Feed" CTA, but the legacy /home/legacy page wasn't fully re-titled.
4. **Sounds UI polish — bigger category cards with unique colors/graphics** — tabs already colored & iconed; full "card hero" treatment not done.
5. **Mode visual updates — additional representative imagery beyond CSS art** — the CSS-art previews already shipped; no extra imagery added this pass.
6. **Media autoplay wired into every feed card** — the hook ships, but I did NOT touch all consumer components in this pass (Feed, Profile, RealmDetail). Drop `useAutoplayOnVisible` into the `<video>` JSX where needed.
7. **Real weather + news API integration** — placeholders exist; pick provider keys next.

## Test Credentials
See `/app/memory/test_credentials.md`.

---
*Last updated: Feb 2026 — Phase 5 foundation shipped (PWA install prompt, Home Dashboard, Admin analytics, autoplay hook). Deferred items documented above.*
