# OurRealm — Product Requirements Document (PRD)

## Mission
Premium social platform rebranded from the original "widget-stage" / Orbit prototype.
Multi-mode visual system + drag-and-drop widget profiles + unified messaging + Sounds library.

## Core Modes
Neon, Business, Millennium, Stealth.

## Tech Stack
- **Frontend**: React 19, TailwindCSS, lucide-react, framer-motion, @dnd-kit, @supabase/supabase-js v2
- **Backend**: FastAPI + MongoDB (Motor) for users, profiles, posts, friends, images, geo, **sounds**
- **Messaging (Phase 3)**: **Supabase** (Postgres + Realtime) — single unified system for Chats/Groups/Realms
- **Audio (Phase 4A)**: FastAPI + disk-backed `services.audio_store`, `mutagen` for duration extraction
- **Geo**: `pgeocode` (offline ZIP → lat/long) — `ALLOWED_RADII = {10,20,50,100,250,500}`

## Architecture: dual-store
| Domain | Storage |
|---|---|
| Users, auth (JWT), profiles, widgets, friends, posts, comments, likes, notifications, images, **tracks**, **track_likes**, ZIP/radius | MongoDB (FastAPI) |
| Chats, Groups, Realms, Messages | **Supabase Postgres + Realtime** |
| Image binaries | `/app/backend/uploads/images/` |
| Audio binaries | `/app/backend/uploads/audio/` |

## Completed Phases
- **Phase 1** — Stealth password login, emojis, universal username nav, like/comment system, notifications, signup compliance gate.
- **Phase 2** — Centralized image hosting, `ImageUploadPicker`, profile/feed/messenger wiring.
- **Phase 2.5** — `Top8Editor`, private ZIP storage, radius filters on Discover/Friends/Sounds, `PresenceDot`.
- **Phase 3** — Supabase-only unified messaging. 4 tabs (Chats/Groups/Realms/Calls placeholder). E2E verified (462 ms realtime latency).
- **Phase 4A (Feb 2026 — SHIPPED)** — **Sounds Platform Foundation**.

## Phase 4A — Sounds Platform Foundation
### Backend
- `services/audio_store.py` — mirrors `image_store.py` pattern (single storage abstraction). 50 MB cap. Accepts MP3, M4A/AAC, WAV, OGG, FLAC, WebM. MIME sniff + filename + content-type fallback. Mutagen duration extraction with WAV header fallback.
- `routers/sounds.py` — 7 endpoints:
  - `POST /api/sounds/upload` — multipart + form metadata (title, category, genre, mood, optional cover_url)
  - `GET  /api/sounds/file/{name}` — public CDN-style serve with `Accept-Ranges: bytes` for HTML5 streaming
  - `GET  /api/sounds/feed` — filtered + sorted (Top 100 / Trending / New Releases / Up & Coming / Editor's Picks)
  - `GET  /api/sounds/charts/top100?page=1..5` — explicit pagination 1–20, 21–40, 41–60, 61–80, 81–100
  - `POST /api/sounds/{id}/play` — increment play count
  - `POST/DELETE /api/sounds/{id}/like` — like/unlike (idempotent)
  - `GET  /api/sounds/me/tracks` — current user's uploads
- AI category server-side rejected: `"Category must be one of Music, Podcasts, FX (AI is not uploadable)."`
- Author geo stamped at upload (mirrors `posts.py` pattern: `author_zip` private, `author_lat`/`author_lng` for radius filter)
- Engagement score: `plays + 3·likes`
- Future-proof fields (defaults inert): `is_ai_generated`, `live_room_id`, `remix_parent_id`, `playlist_ids`

### Frontend
- `lib/audioPlayer.js` — singleton HTML5 audio with pub/sub. Methods: `play`, `pause`, `resume`, `toggle`, `seek`, `setVolume`, `stop`. Auto-fires `/play` counter. Media Session API metadata for lockscreen / bg playback.
- `components/MiniPlayer.jsx` — sticky bottom mini-player (above nav). Cover, title, seek bar, play/pause, close. Renders only when something's playing. Wired globally in `App.js`.
- `components/SoundUploadPicker.jsx` — Title, Category (Music/Podcasts/FX), Genre, Mood, optional Cover (uses existing `ImageUploadPicker`). 50 MB client-side cap with friendly errors.
- `pages/Sounds.jsx` — complete rebuild:
  - 4 tabs with unique color + icon: Music (blue), Podcasts (purple), FX (orange), AI (green, "SOON" badge)
  - Filter row: Genre + Charts + Mood dropdowns
  - `RadiusChips` reused — options `10/20/50/100/250/500` (+ Any via chip toggle off)
  - Featured carousel (Top 6 by engagement; falls back to mock data ONLY when zero uploads platform-wide)
  - Top 100 with pagination buttons labeled by rank ranges (1–20, 21–40, …, 81–100)
  - AI tab: dedicated "Coming Soon" placeholder; upload button hidden; no listings/rankings
  - Empty state with "Upload Music/Podcasts/FX" CTA per category
- Phase 3 messenger untouched. Phase 4A 401/error states caught — no React error overlay on unauthed visits.

### Performance / Cost
- `audio.preload = "metadata"` — only fetches metadata up front
- Range support enabled — browsers stream chunks instead of full file download
- Pagination + `limit` parameter on all list endpoints; no full-table scans
- `radius_filter` reuses the same engine as posts/discover — zero duplication
- Mock fallback kept lazy & only when truly empty platform-wide

## Phase 3 — Auth bridging note (unchanged)
Schema ships with **RLS commented out**. OurRealm users live in MongoDB with JWT; `auth.uid()` is empty without Supabase Auth. Enable later via either (A) Supabase Auth signin, or (B) custom JWT signed with the Supabase project secret.

## Roadmap
| Priority | Item | Status |
|---|---|---|
| P1 | Group/Realm Member Directory | deferred |
| P1 | Pinned Chats | deferred |
| P1 | RLS enforcement | deferred |
| P1 | Track detail modal — full player + comments | not started |
| P2 | Profile mirror in Supabase | deferred |
| P2 | Sent/Delivered/Read on messages | deferred |
| P2 | Playlists, Track sharing into Messenger | not started |
| P2 | Real Wallet integrations | deferred |
| P3 | Voice/video Calls | deferred |
| P3 | AI Sounds (Phase 4B+) | placeholder shipped |
| P3 | Live audio rooms (Phase 4C) | schema field reserved |
| P3 | Remixing (Phase 4D) | schema field reserved |

## Known Mocked
- Calls tab — intentional placeholder
- Featured carousel mock fallback — only when zero uploads platform-wide; replaced as soon as any real track exists
- Wallet payments — placeholders

## Test Credentials
See `/app/memory/test_credentials.md`.

---
*Last updated: Feb 2026 — Phase 4A (Sounds Foundation) shipped. Backend curl-verified for upload/duration/feed/Top 100/play/like/unlike/me + AI rejection + Phase 3 isolation.*
