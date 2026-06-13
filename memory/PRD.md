# OurRealm — Product Requirements (Living Doc)

## Problem statement
Build OurRealm, a premium next-gen social platform replacing an "Orbit / widget-stage" prototype.
Tagline: "Live. Connect. Experience." Combines social feed, widget profiles, discovery, music,
creator tools, messaging, wallet, marketplace ads, and four immersive visual modes
(Cypher / Business / Millennium / Stealth) that re-style the entire app.

## User decisions (from initial ask_human)
- Rebuild as OurRealm (original widget-stage codebase not provided in workspace).
- Hybrid backend: real auth + profile + posts (FastAPI + MongoDB), rest of UI uses curated mock data.
- JWT-based auth (sign up, sign in, password reset, session persistence, secure logout), guest browsing.
- Use original OurRealm SVG "Orbital Glyph" logo (no asset uploaded) — adapts glow per mode.
- Real-time messaging and live streams use scalable mock implementation; ready for WebRTC/Agora/LiveKit/Mux later.

## Architecture
- Backend: FastAPI under /api with routers /api, /api/auth, /api/profile, /api/posts.
  - Auth: bcrypt password hashing, PyJWT access (1 day) + refresh (30 days), httpOnly cookies + Bearer fallback.
  - Brute force lockout (5 attempts -> 15 min).
  - MongoDB indexes (users.email unique, password_reset TTL, login_attempts).
  - Seeds admin@ourrealm.app / admin123 on startup.
- Frontend: React 19 + react-router + recharts + lucide-react + framer-motion.
  - ThemeContext sets `html[data-mode]` and persists to localStorage.
  - AuthContext exposes user/isGuest/login/register/logout/updateProfile and stores access token.
  - CSS variables under `html[data-mode="..."]` redefine the entire palette/fonts/surfaces per mode.

## Implemented (Iteration 1)
- Landing page with center floating panel + 4 interactive mode quadrants.
- Sign up, Sign in, Browse-as-guest flows; restricted-action guest prompt.
- Mode switcher pill beside logo with 4 mode-specific styles.
- Sidebar nav: Interests (Home), For You feed, Discover, Music, Friends, Messages,
  Notifications, Wallet, Marketplace, Widget Library, Profile, Settings, Sign out.
- For You feed with media filter bar (All / Images / Videos / Lives / Sounds / Posts) + composer.
- Discover page with 13 Netflix-style horizontal rows.
- Music page with distance / genre / sort filters + track detail modal.
- Friends, Messages (working draft sender), Notifications, Wallet (recharts), Marketplace, Widget Library.
- Profile page with default widget bento (live/music/photos/friends/weather/events/tour/merch)
  and per-widget reorder/resize/remove + Edit name/bio with Save (PATCH /api/profile/me).
- Center "+" upload modal with 5 options.
- Sessions persist via cookies + bearer fallback; mode persists via localStorage.

## Tested status
- Backend: 20/20 pytest tests pass.
- Frontend: end-to-end testing agent verified all major flows; only fix applied was pointer-events
  on landing center panel so quadrant clicks now register.

## Backlog (P1)
- Drag-and-drop reordering for widgets (currently arrow buttons).
- Real-time messaging via WebSockets.
- Comments + share APIs.
- Search across users / posts / music.
- Mobile bottom nav.

## Backlog (P2)
- WebRTC live stream provider integration (Agora / LiveKit).
- Social login providers (Google, Apple, X, Discord, Facebook).
- Notification preferences + push.
- AR/VR widget surface.

## Credentials
See `/app/memory/test_credentials.md`.
