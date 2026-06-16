# OurRealm — Product Requirements Document (PRD)

## Mission
Premium social platform rebranded from the original "widget-stage" / Orbit prototype.
Multi-mode visual system + drag-and-drop widget profiles + unified messaging + Sounds library + Polls/personalization.

## Core Modes
Neon, Business, Millennium, Stealth.

## Tech Stack
- **Frontend**: React 19, TailwindCSS, lucide-react, framer-motion, @dnd-kit, @supabase/supabase-js v2
- **Backend**: FastAPI + MongoDB (Motor) for users, profiles, posts, friends, images, geo, sounds, polls, preferences
- **Messaging (Phase 3)**: **Supabase** (Postgres + Realtime) — single unified system for Chats/Groups/Realms
- **Audio (Phase 4A)**: FastAPI + disk-backed `services.audio_store`, `mutagen` for duration extraction
- **Geo**: `pgeocode` (offline ZIP → lat/long) — `ALLOWED_RADII = {10,20,50,100,250,500}`

## Architecture: dual-store
| Domain | Storage |
|---|---|
| Users, auth (JWT), profiles, widgets, friends, posts (with optional polls), comments, likes, notifications, images, tracks, track_likes, **preferences**, ZIP/radius | MongoDB (FastAPI) |
| Chats, Groups, Realms, Messages | **Supabase Postgres + Realtime** |
| Image binaries | `/app/backend/uploads/images/` |
| Audio binaries | `/app/backend/uploads/audio/` |

## Completed Phases
- **Phase 1** — Stealth password, emojis, like/comment, notifications, signup compliance.
- **Phase 2 / 2.5** — Image hosting, Top 8 editor, ZIP/radius infra, Discover/Friends/Sounds radius filters, PresenceDot.
- **Phase 3** — Supabase-only unified messaging. 4 tabs. E2E verified at 462 ms realtime latency.
- **Phase 4A** — Sounds Platform Foundation. 4 tabs (Music/Podcasts/FX/AI-SOON), uploads, Top 100 paginated, MiniPlayer, RadiusChips reuse.
- **Phase 4A follow-up** — Share to Chat. Track cards expose a `Send` action → opens reusable `FriendPicker` → sends a Supabase chat message containing the public stream URL. Messenger renderText now plays shared `.mp3/.wav/...` URLs inline via `<audio controls>`.
- **Phase 4B (Feb 2026 — SHIPPED)** — Polls, Personalization, Sounds Search.

## Phase 4B — Polls, Personalization, Discovery Intelligence
### Polls (on existing posts — NOT a new post type)
- Schema: `PollPayload` with `question` (1–200), `options` (2–10, each 1–100 chars), `duration_hours` ∈ {0, 24, 72, 168, 720}.
- Backend: `POST /api/posts` accepts optional `poll`. `POST/DELETE /api/posts/{id}/poll/vote`. One vote per user, change-vote allowed, server-side dedup, expiration enforced.
- `_public_post` computes tallies + percentages + `my_vote` + `expired` from the raw votes dict — frontend never sees votes.
- Frontend: `PollComposer` modal attached to the existing "What's happening in your Realm?" composer via a `Poll` chip. `PollDisplay` inside `FeedCard` with vote bars, selected highlight, percentages, and live polling (8 s interval, stops at expiry).
- Realtime: lightweight HTTP polling per spec (no shared realtime outside messaging).

### Personalization Engine (`services/preferences.py`)
- Per-user `preferences` sub-doc with rolling counters: `categories`, `genres`, `moods`, `radii`, `total_plays`, `total_likes`.
- Weighted signals: play = 1, like = 3 (+2 reserved for comment/share/save).
- Single `$inc` write per signal — zero aggregation pipelines.
- Activates at `total_plays + 2·total_likes ≥ 5` so new users get pure global rankings.

### Discovery Intelligence (`/sounds/feed` + `/sounds/charts/top100`)
- 70/30 blend: `0.7 × global_norm + 0.3 × personal_boost`.
- `personal_boost = 0.4·category + 0.4·genre + 0.2·mood` (each normalized to user's max).
- Applied BEFORE Top 100 truncation so a strongly-matched track can surface from rank 100–200.
- Skipped for "New Releases" / "Up & Coming" to preserve their meaning.

### Search (`q` query param)
- Case-insensitive regex across `title` + `genre`.
- Lives on existing `/sounds/feed` AND `/sounds/charts/top100`.
- Frontend: debounced 300 ms input above the radius bar. Changing search **does not** reset filters. Changing filters **does not** clear search.
- Empty search behaves identically to no `q` param.

### Radius (reused, unchanged)
- All endpoints accept `radius` ∈ {10, 20, 50, 100, 250, 500, any/""}. Personalization combines with radius for the final ordering.

### Engagement Signals (lightweight)
- Aggregated counters on `tracks`: `plays`, `likes`, `liked_by[]` (existing).
- Future-proof inert fields shipped earlier: `is_ai_generated`, `live_room_id`, `remix_parent_id`, `playlist_ids`.

## Phase 3 Auth bridging note (unchanged)
Schema ships with **RLS commented out**. Enable via Supabase Auth signin OR custom JWT signed with the project secret.

## Performance / Cost
- Debounced search (300 ms), polls live every 8 s, sounds list paginates at 20/page.
- All filter changes are pure additions — no recomputed rankings on every keystroke.
- Mock fallback for Featured carousel only when zero uploads platform-wide.

## Roadmap
| Priority | Item | Status |
|---|---|---|
| P1 | Track detail modal — full player + comments | not started |
| P1 | Group/Realm Member Directory | deferred |
| P1 | Pinned Chats | deferred |
| P1 | RLS enforcement | deferred |
| P2 | Profile mirror in Supabase | deferred |
| P2 | Sent/Delivered/Read indicators | deferred |
| P2 | Playlists (schema field `playlist_ids` already in place) | not started |
| P2 | Wallet integrations | deferred |
| P3 | Voice/video Calls | deferred |
| P3 | AI Sounds (Phase 4C+) | placeholder shipped |
| P3 | Live audio rooms | schema reserved |
| P3 | Remixing | schema reserved |

## Known Mocked
- Calls tab UI-only placeholder
- Featured carousel mock fallback only when zero uploads platform-wide
- Wallet payments

## Test Credentials
See `/app/memory/test_credentials.md`.

---
*Last updated: Feb 2026 — Phase 4A follow-up (Share to Chat) + Phase 4B (Polls, Personalization, Search) shipped. Backend curl-verified for poll create/vote/change/withdraw, search across title+genre, personalization counters bumped on play/like.*
