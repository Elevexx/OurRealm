# NEXUS AVATAR COLLECTION — COMPLETE (2026-06 continuous run, published v25)
STATUS: All six avatars GENERATED, rigged, 7 animations each, LOD0/1/2, thumbnails, registered
(status premium / eligibility unlock). Fire Power unlock + equip live and tested (iteration_146).
Reference sheet: rp0vfdr3_8828913B (get_assets_tool). Anim action ids: idle 0, walk 1, run 6,
jump 641 (640 broken server-side), fall 502, land 506, greet 28.

PREREQUISITE GATE (reconfirmed 2026-06): Founder re-stated: do NOT begin any avatar backend,
Meshy generation, inventory, Fire Power, database, or UI work until he explicitly says
"START AVATAR PHASE". Spawn Zone must be finished first (city models, bloom, rigged crowds,
fallback avatar, device matrix, FPS, visual repair loop vs references).
REFERENCE IMAGE IS MANDATORY: retrieve the 6-avatar collection sheet via get_assets_tool when
the phase begins. If unavailable → STOP and ask founder to re-upload (founder chose option 2b).
GENERATION STRATEGY (founder confirmed): CANARY FIRST — fully create and test Streetwear,
then WAIT for founder approval before generating the remaining five.

## The six avatars (exact IDs, labels, Fire Power burn costs)
1. avatar_streetwear — STREETWEAR — 1,000 FP (black layered streetwear, gray hoodie, orange accents, cargo pants)
2. avatar_tech_operative — TECH OPERATIVE — 5,000 FP (Korean woman, blue-black bob, cropped white/gray tech jacket, black cargo, cyan holograms)
3. avatar_realm_guardian — REALM GUARDIAN — 10,000 FP (black-green tactical armor, green holographic orb)
4. avatar_aether_champion — AETHER CHAMPION — 25,000 FP (African man, polished black-blue armor, cape, blue illumination)
5. avatar_arcane_sovereign — ARCANE SOVEREIGN — 50,000 FP (lavender hair, purple-gold armor, translucent cape, purple magic)
6. avatar_legendary_void_wizard — LEGENDARY VOID WIZARD — 100,000 FP (older Caucasian wizard, gray beard, black hood/robe, glowing green alien markings, black staff w/ green stone, NO crown; only this one gets LEGENDARY label)

## Key rules (full text in the founder message of this session)
- One avatar at a time: isolate reference crop → multi-image-to-3D master → fix → rig → 7 anims
  (idle, walk, run, jump start, air/fall, landing, greeting) → crossfades → desktop 2K + mobile
  runtime derivs → QA gate ≥95 overall / ≥97 identity / no category <90 before activation.
- Reject GLBs with skins:0 or animations:[] — never present static as animated. Safe upright fallback.
- Fire Power unlocks: use EXISTING server-authoritative FP ledger (same burnable balance as other
  permanent unlocks). Atomic + idempotent burn+entitlement (never burn w/o grant, never grant w/o
  burn, repeat request returns original result). Confirmation copy: "Burn N🔥 to permanently unlock
  X? This action cannot be reversed." Buttons CANCEL / BURN & UNLOCK. Account-bound, no monetary
  language, free switching among unlocked, keep a free default avatar, do not auto-equip.
  Disclaimer text (exact) is in founder message. Under-13 blocked, 13-17 guardian rules apply.
- Inventory UI per reference: thumbnails (never load all 6 GLBs at once), locked/unlocked states,
  FP requirement + balance, preview, selected ring. Admin Avatar Studio extension: draft/testing/
  active/hidden states, validation, versions, rollback, audit — non-destructive to current avatars.
- Transaction test matrix: 16 cases listed in founder message (double-tap, two tabs, forged ID,
  refresh mid-unlock, admin correction, cross-device sync, remote display...).
- Preserve: Spawn Zone, zones, portals, chat, multiplayer, /games single ENTER NEXUS button.

## Suggested execution order for next session
1. Finish Spawn Zone gaps (PRD checkpoint) → founder approval of Spawn Zone.
2. Backend: nexus_avatars extension (fp_cost, state, entitlements collection nexus_avatar_unlocks,
   idempotent POST /api/nexus/avatars/{id}/unlock w/ FP ledger integration — find existing fire
   power service first; grep 'fire' in backend services/routers).
3. Avatar 1 (streetwear) full pipeline as canary → founder gate → remaining 5.
