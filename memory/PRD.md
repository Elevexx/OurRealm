# OurRealm — Product Requirements Document (PRD)

## Mission
Premium social platform rebranded from the original "widget-stage" / Orbit prototype.
Multi-mode visual system + drag-and-drop widget profiles + unified messaging + Sounds library + Polls + personalization.

## Core Modes
Neon, Business, Millennium, Stealth.

## Tech Stack
- **Frontend**: React 19, TailwindCSS, lucide-react, framer-motion, @dnd-kit, @supabase/supabase-js v2
- **Backend**: FastAPI + MongoDB (Motor) for users, profiles, posts (+polls), friends, images, geo, sounds, preferences
- **Messaging (Phase 3)**: **Supabase** (Postgres + Realtime) — single unified system for Chats/Groups/Realms
- **Audio (Phase 4A)**: FastAPI + disk-backed `services.audio_store`, `mutagen` duration extraction
- **Geo**: `pgeocode` — `ALLOWED_RADII = {10,20,50,100,250,500}`

## Architecture: dual-store (unchanged)
| Domain | Storage |
|---|---|
| Users, auth (JWT), profiles, widgets, friends, posts (with optional polls), comments, likes, notifications, images, tracks, track_likes, preferences, ZIP/radius | MongoDB |
| Chats, Groups, Realms, Messages | Supabase Postgres + Realtime |

## Completed Phases
- Phase 1, 2, 2.5, 3, 4A, 4A follow-up (Share to Chat) and Phase 4B (Polls, Personalization, Search) — all shipped & curl-verified.
- **Phase 4B follow-up (Feb 2026 — SHIPPED)**: "Made for You" rail above Top 100.
- **Landing + Modes refresh (Feb 2026 — SHIPPED)**: pure CSS/SVG mode previews + preview-only Landing selector.

## Phase 4B follow-up — "Made for You" rail
- New endpoint `GET /api/sounds/me/personalized` → `{ active, total_plays, total_likes }` using existing `prefs_summarise` + `personalization_active`.
- Sounds page renders horizontally-scrollable rail above Top 100 **only when** the user has crossed the activation threshold (`total_plays + 2·total_likes ≥ 5`).
- Reuses existing `/api/sounds/feed` endpoint with the 70/30 personalization blend — no new ranking system, no duplicated feed logic.
- Mobile-first horizontal scroll, 180 px cards, single click → play via the singleton audio player.

## Landing + Modes preview refresh
- **No backend or routing changes.** Mode names unchanged. Saved app mode persistence flow untouched.
- New component `components/ModePreviewArt.jsx` — CSS/SVG-only themed art for each mode (zero external images, zero copyright risk, fast loading, mobile-first).
  - **Neon**: deep purple→cyan base, hologram panels, particle grid
  - **Business**: cream gradient, frosted dashboard with gold analytics bars, silver pill
  - **Millennium**: sky-blue→green sky, soft clouds, glossy 3D chat-bubble & green orb, translucent card (original — no copy of any existing OS)
  - **Stealth**: dark grid + scan lines + animated radar sweep + telemetry chip (no IP references)
- `Landing.jsx`:
  - 2x2 full-screen quadrants (TL/TR/BL/BR).
  - **Preview-only click model**: clicking a quadrant updates LOCAL `previewMode` state — does NOT call `setMode`. Saved app mode unchanged until normal /modes flow.
  - Center widget re-skins on click: ambient halo, preview pill ("NEON MODE · PREVIEW"), logo drop-shadow, headline gradient, and welcome-text glow all reactively use the active preview's accent.
  - Sign up / Sign in / Browse-as-guest functionality preserved exactly.
- `ModesPage.jsx`: same `<ModePreviewArt>` swapped in for the previous external image. All mode selection + apply behavior preserved.

## Phase 3 Auth bridging (unchanged)
RLS commented out — enable via Supabase Auth signin OR custom JWT signed with project secret.

## Performance
- All mode-preview art is pure CSS/SVG → near-zero network cost vs. previous Unsplash images.
- "Made for You" rail uses the existing `/sounds/feed` endpoint — one extra HTTP request only when the user is activated.
- Sounds search debounced 300 ms; polls live-refresh every 8 s while open.

## Roadmap
| Priority | Item | Status |
|---|---|---|
| P1 | Track detail modal | not started |
| P1 | Group/Realm Member Directory | deferred |
| P1 | Pinned Chats | deferred |
| P1 | RLS enforcement | deferred |
| P2 | Sent/Delivered/Read indicators | deferred |
| P2 | Playlists (schema reserved) | not started |
| P2 | Wallet integrations | deferred |
| P3 | Voice/video Calls | deferred |
| P3 | AI Sounds (Phase 4C+) | placeholder shipped |
| P3 | Live audio rooms | schema reserved |
| P3 | Remixing | schema reserved |

## Known Mocked
- Calls tab (UI placeholder)
- Wallet payments
- Featured carousel mock fallback only when zero uploads platform-wide

## Test Credentials
See `/app/memory/test_credentials.md`.

---
*Last updated: Feb 2026 — "Made for You" rail + Landing/Modes CSS-art refresh shipped. Lint clean across all changes.*
