# OurRealm — Product Requirements Document (PRD)

## Mission
Premium social platform rebranded from the original "widget-stage" / Orbit prototype.
Multi-mode visual system + drag-and-drop widget profiles + unified messaging.

## Core Modes
Neon, Business, Millennium, Stealth.

## Tech Stack
- **Frontend**: React 19, TailwindCSS, lucide-react, framer-motion, @dnd-kit, @supabase/supabase-js v2
- **Backend**: FastAPI + MongoDB (Motor) for users, profiles, posts, friends, images, geo
- **Messaging (Phase 3)**: **Supabase** (Postgres + Realtime) — single unified system for Chats/Groups/Realms
- **Geo**: `pgeocode` (offline ZIP → lat/long)

## Architecture: dual-store
| Domain | Storage |
|---|---|
| Users, auth (JWT), profiles, widgets, friends, posts, comments, likes, notifications, images, ZIP/radius | MongoDB (FastAPI) |
| Chats, Groups, Realms, Messages | **Supabase Postgres + Realtime** |

Existing OurRealm user ids are already UUID v4 strings — they map 1:1 into Supabase `uuid` columns. No user migration needed.

## Completed Phases (high level)
- **Phase 1** — Stealth password login, emojis everywhere, universal username profile nav, full post like + comment system (178 char limit), notification deep linking, account creation compliance gate.
- **Phase 2** — Centralized image hosting (`/api/images/*`), `ImageUploadPicker`, wired to profile avatar / feed composer / messenger.
- **Phase 2.5** — `Top8Editor`, private ZIP storage (`pgeocode`), radius filters (5/10/25/50 mi) on Discover + Friends + Sounds, `PresenceDot`.
- **Phase 3 (Feb 2026, current)** — **Supabase-only unified messaging**: 4 tabs (Chats, Groups, Realms, Calls placeholder), realtime via `messages` table publication, RLS policies written ready-to-enable.

## Phase 3 — Files of Reference
- `/app/supabase/schema.sql` — paste into Supabase SQL editor (tables + indexes + realtime + commented RLS)
- `/app/supabase/README.md` — setup instructions
- `/app/frontend/src/lib/supabase.js` — client init (graceful when env vars are missing)
- `/app/frontend/src/lib/messaging.js` — unified CRUD + realtime subscription
- `/app/frontend/src/pages/Messages.jsx` — full UI with 4 tabs, friend picker, create-thread modal, conversation overlay
- `/app/backend/routers/profile.py` — added `POST /api/profile/by-ids` for sender lookup

## Phase 3 — Environment
Add to `/app/frontend/.env`:
```
REACT_APP_SUPABASE_URL=https://xxxxxxxx.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGciOi...
```
Until set, the Messenger renders a friendly "not configured" page — rest of the app works.

## Phase 3 — Auth bridging note
The schema ships with **RLS commented out**. Reason: OurRealm users live in MongoDB with their own JWT; `auth.uid()` is empty without Supabase Auth. To enforce RLS later, either:
- (A) Also sign users into Supabase Auth client-side, OR
- (B) Mint custom Supabase JWTs on FastAPI signed with the Supabase project JWT secret (`sub=<ourrealm_user_id>`) and call `supabase.auth.setSession(...)`.

Then uncomment the `ENABLE RLS LATER` block in `schema.sql` and re-run.

## Roadmap (post Phase 3)
| Priority | Item |
|---|---|
| P1 | Group/Realm Member Directory — "View All" popup with add-friend + view profile |
| P1 | Pinned Chats (Supabase: optional `pinned_by uuid[]` on `chats`) |
| P1 | RLS enforcement — pick auth bridge option (A or B) above |
| P2 | Sender info denormalized into a Supabase `profiles` mirror table (drop the by-ids backend call) |
| P2 | Sent/Delivered/Read indicators using `read_by uuid[]` (already in schema) |
| P2 | Real Wallet integrations (Stripe / crypto) |
| P3 | Voice/video Calls tab |

## Known Mocked
- Calls tab — intentional placeholder ("coming soon")
- Wallet payments — placeholders

## Test Credentials
See `/app/memory/test_credentials.md`.

---
*Last updated: Feb 2026 — Phase 3 (Supabase) shipped structurally; credentials & SQL paste are user-side actions.*
