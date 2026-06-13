# OurRealm — Product Requirements Document

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
