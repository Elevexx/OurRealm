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
- **Phase 5 (Feb 2026 — SHIPPED MVP + polish)**: Media Upload Limits + Phase 5 deferred polish.

## Phase 5 — Media Upload Limits MVP (Feb 2026)
### Server-enforced caps (rolling 24h, founder `@stealth` exempt)
| Kind   | Per file | Per day | Max duration |
|--------|----------|---------|--------------|
| image  | 3 MB     | 20      | n/a          |
| audio  | 5 MB     | 10      | 60 s         |
| video  | 10 MB    | 3       | 30 s (counted only when posts.media_type="video"; external URLs not counted) |

### Enforcement points
- `services/upload_limits.py` — `enforce_pre_upload`, `enforce_duration`, `remaining_for_user`, `is_founder`.
- `routers/images.py` — both `/upload` and `/from-url` call `enforce_pre_upload` (from-url fetches first so the real size is checked).
- `routers/sounds.py` — `/upload` calls `enforce_pre_upload` and then `enforce_duration` after mutagen reads the file; on duration reject the on-disk file is deleted.
- Legacy in-store 5-min rate limits in `image_store.py` / `audio_store.py` removed (replaced by the centralized service).

### Client UX
- `GET /api/upload-limits/me` → `{limits: {image, audio, video}}` with `{used, remaining, per_day}`; founder gets `remaining: "unlimited"`.
- `ImageUploadPicker.jsx` and `SoundUploadPicker.jsx` fetch the quota on open, display "N of N remaining today" (or "Founder account — unlimited uploads."), and surface HTTP 413/429 detail messages from the API.

## Phase 5 — Deferred polish (now shipped)
- **Customize Feed page** — `/home/legacy` (interest picker) renamed to "Customize Feed" with subtitle "Pick your interest".
- **AutoplayVideo** — new component (`components/AutoplayVideo.jsx`) wrapping `useAutoplayOnVisible`; used by `pages/Feed.jsx` and `components/PostPopup.jsx`. Videos auto-play muted when ≥50% visible and pause off-screen.
- **Sounds tabs hero polish** — Music / Podcasts / FX / AI now render as a 4-up grid of large color-gradient cards with decorative orbs and an iconized chip per tab. `data-testid="sounds-tab-*"` preserved.
- **Custom visibility multi-select friends UI** — Home Dashboard widgets now expose a 4th visibility option `Custom`. New `components/FriendMultiPicker.jsx` modal opens automatically when Custom is selected; choosing friends saves `custom_user_ids[]` via existing `PUT /api/dashboard/layout`. A "N chosen / Pick friends" button reopens the picker.

## Existing endpoints + Phase 3 messenger: untouched.

## ⚠️ Still deferred (next pass)
1. **Widget resize** — `size` field is persisted (`sm/md/lg/xl`), but no drag-to-resize UI yet.
2. **Mode visual updates — additional representative imagery beyond CSS art**.
3. **Real weather + news API integration** — placeholders exist; pick provider keys next.
4. **Advanced message status (Sent/Delivered/Read)** — deferred per user.
5. **Group/Realm Member Directory UI enhancements** — deferred per user.
6. **Real Wallet integration** — currently mocked.

## Test Credentials
See `/app/memory/test_credentials.md`.

---
*Last updated: Feb 2026 — Phase 5 Media Upload Limits MVP + deferred polish shipped (13/13 backend tests pass; frontend flows verified).*
