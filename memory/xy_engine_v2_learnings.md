# XY Engine V2 rebuild — learnings (Aug 8 2026)

- `arpgXY` (GameRuntime.jsx, search "XY ENGINE V2") only runs for stages with `schema_version:2`. Old `arpgSS` untouched → zero regression path for Dragon Realm.
- Old arpgSS vertical-camera bug: drawWorld ignored camY, only the hero was translated. V2 renders the whole world under scale(kk)+translate(-camX,-camY).
- Geometry gotchas found via E2E:
  - Ramp meeting a solid top: any approach x before the exact meet point leaves feet a few units below the solid top → X-blocked. Fixed with 16u step-up assist in X resolution.
  - Checkpoint capture radius 28u missed fall-through paths → widened to 44/80.
  - Pillar clearance: jump apex is 128u; obstacles must leave ≥ ~40u clearance and ≤ ~86u width to be clearable while chased.
  - Jump gap: ~190u max at run speed 230.
- Planner regression: game_platform/planner.py realigned blueprint runtime to the family engine whenever "compatible", letting top_down (0.6) override action_rpg_2_5d (1.0). Guard now requires engine score >= deterministic pick score.
- Playing unpublished games: /api/games/{id} requires status published (or approved for founder). Gray-box game set to published, access config inherited = founder-only.
- E2E driving: screenshot_tool has a hard deadline (~2min) — long traversals must run via local headless playwright (`pip install playwright; python -m playwright install chromium`), see /app/backend/scripts/e2e_graybox_drive.py. Dispatch KeyboardEvent on the IFRAME document; jump is edge-latched (keyup→keydown per jump). networkidle never settles on this app — use domcontentloaded.
- QA hooks: window.__GB__ (frame state), window.__GBGEO__ (geometry) inside the game iframe.
