# NEXUS LANDING PAGE — QUEUED DIRECTIVE (next phase AFTER current Spawn Zone pass)

ORDER OF PHASES (founder-confirmed):
1. CURRENT: Spawn Zone pass (city models, bloom, rigged crowds, fallback avatar, device matrix, FPS, repair loop).
2. NEXT: THIS landing page redesign.
3. THEN (only on explicit "START AVATAR PHASE"): six-avatar collection (see avatar_collection_directive.md).
Unity importer stays on hold.

## Reference
AAA landing reference image (mobile portrait, binding):
https://customer-assets-39nsmqrw.emergentagent.net/job_realm-deploy/artifacts/3ewrm60u_078C587C-81C2-46EB-B1E9-FC437EA67281.png
Implement in the real app — do NOT generate another concept image. Old mobile screenshots = "before" only.

## Requirements (full text in founder message 2026-06, this session)
- Mobile-first: 390x844 + 393x852 priority; also 430x932, phone landscape, tablet both, 1366x768, 1920x1080.
  Safe areas/notches, no horizontal scroll, no clipping/overlap, CTA above the fold, touch targets >=44px.
- Hero: cinematic Spawn Zone artwork bg + gradients. Copy exactly:
  "OURREALM NEXUS" / "ONE PROFILE. INFINITE REALMS." /
  "Enter Nexus Central. Meet, explore and travel through living worlds—together."
  Badges: "NEXUS CENTRAL · LIVE" + REAL server online count. One primary ENTER NEXUS button.
  Optional secondary (e.g. EXPLORE WORLDS) only if it links to an existing working page.
  Remove "NEXUS V1" text and long plain intro layout.
- ENTER NEXUS: exactly one primary button; pressed/loading feedback, no duplicate taps, safe load,
  destination nexus_central, correct boulevard/platform spawn, retry/back on failure, never blank/frozen.
- YOUR AVATAR card: real selected avatar preview + name + equipped status + CHANGE (existing selector).
  Safe loading/fallback. Do not hardcode avatars or modify avatar records.
- Feature summary: compact premium section (Multiplayer, Portal Worlds, Proximity Chat, Live World Sync).
  LIVE labels only when backend confirms. No fake counts/statuses.
- EXPLORE THE NEXUS: real destinations (Nexus Central, Community Plaza, Emerald Gardens), real data +
  working links. Mobile swipeable row/compact stack; desktop grid.
- Visuals: deep navy/black glass, cyan/electric-blue/purple neon, premium typography, subtle bloom/
  gradients/motion, ORAi branding. ORAi assistant button must not cover controls.
- Performance: responsive WebP/AVIF hero (no raw 8K to phones), preload critical hero only, lazy-load
  below fold, no 3D on landing, no layout shift, reduced-motion + data-saver respected.
- Accessibility: contrast, labels, focus states, keyboard nav, no gesture conflicts; back/exit/loading/
  error states correct.
- Preserve: Plaza, Gardens, portals, chat, multiplayer, admin tools, world publishing, existing routes.
- Testing matrix (required): 390x844, 393x852, 430x932, mobile landscape, tablet portrait+landscape,
  1366x768, 1920x1080. Verify online count real, avatar real, CHANGE works, ENTER once-per-tap into
  nexus_central, loading/retry/back/failure states, keyboard a11y, safe areas.
- Quality loop vs reference until production-ready; honest numbered gap list if anything remains.
- Final report: files changed, before/after shots mobile+desktop, sizes tested, functional results,
  perf measurements, a11y checks, ENTER destination, preservation confirmation.
