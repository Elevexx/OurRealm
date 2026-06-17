# OurRealm — Product Requirements Document (PRD)

## Mission
Premium social platform with multi-mode UI, widget profiles, unified messaging, Sounds library, Polls, personalization, Home Dashboard, and Admin analytics.

## Tech Stack
React 19 · FastAPI · MongoDB (Motor) · Supabase (Postgres + Realtime for messaging only) · Mutagen · pgeocode.

## Architecture: dual-store
| Domain | Storage |
|---|---|
| Users, auth (JWT), profiles, widgets, friends, posts (+polls), comments, likes, notifications, images, tracks, track_likes, preferences, dashboards, ZIP/radius | MongoDB |
| Chats, Groups, Realms, Messages | Supabase Postgres + Realtime |

## Completed Phases
Phase 1 · 2 · 2.5 · 3 · 4A · 4A follow-up · 4B (Polls/Personalization) · 4B follow-up (Made for You) · Landing/Modes refresh · PWA icon · mode animations · Phase 5 foundation (Home Dashboard + Admin Analytics + PWA prompt + autoplay) · **Phase 5 MVP + deferred polish (Feb 2026)** · **Phase 5+ Parts 0/1/2/3 (Feb 2026)**.

## Phase 5+ — Parts 0/1/2/3 (Feb 2026)

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
*Last updated: Feb 2026 — Phase 5+ Parts 0/1/2/3 shipped (13/13 backend tests pass; all frontend flows verified).*
