# Meshy 10-Model Generation Plan — Arcane Hearth (runs when a real MESHY_API_KEY lands)

BLOCKER: preview MESHY_API_KEY = MESHY_KEY_PENDING. Real key = production secrets only.
Infra ready: services/meshy_provider.py (workflows, idempotency, credit audit, GLB validator),
routers/meshy_admin.py, /admin/meshy founder panel, media adapter kind 'models'.

## Reference inputs (already generated + approved, /app/artifacts/wkq/raw/)
- maeve_ref.png — front/side/back panels → Meshy multi-image-to-3D (Maeve)
- maeve_sprite.png, npc_sean.png, npc_brasso.png, npc_tahir.png, foe_mask_guardian.png
- foe_walker.png (Wind-Up Pantry Imp), item_key.png (Emerald Realm Key, 8K master retained)

## The 10 models (max 3 paid attempts each; 8K texture where supported; 2K runtime derivative)
1. maeve — multi-image-to-3D from maeve_ref panels → refine → texture 8K → RIG → walk animation.
   Wire: spec.assets.player_model.url (ThreeRuntime already loads + auto-scales + plays clip[0]).
2. foe_pantry_imp — image-to-3D from foe_walker.png (enemy family base).
3. foe_mask_guardian — image-to-3D from foe_mask_guardian.png (L5 boss, scale 1.4x).
4. hazard_ember_brazier — text-to-3D: copper ember brazier steam-vent hazard.
5. portal_arcane_hearth — text-to-3D: circular Celtic stone-and-copper portal gate, emerald glow.
6. emerald_realm_key — image-to-3D from item_key.png; 8K texture master retained in R2.
7. ingredient_set — text-to-3D: stylized herb bundle / cheese wheel / fish (one merged set, split on import).
8. env_kit_irish_kitchen — text-to-3D modular kit: counter, hearth, shelf, barrel, table (retexture per level).
9. cooking_station — text-to-3D: copper cauldron cooking station with fire bowl.
10. npc_chef_base — image-to-3D from npc_sean.png; per-level texture variants (Brasso/Tahir) via retexture workflow.

## Wiring slots (spec.assets of wkq-arcane-hearth-3d-v1)
player_model, model_npc_l1/l3/l5, model_guardian, model_boss, model_key, model_portal,
model_station, model_hazard, model_env_kit, model_ingredients.
questLevel.js builds greybox primitives wherever a model slot is missing — swap-in is additive.

## Quality gate
- GLB validator (magic/version/meshes/materials/animations/checksum) must pass before wiring.
- Visual comparison vs founder reference sections; passing target 90+; report every task id,
  credit charge and result in the Meshy audit collection (already built).
- Max 2 repair cycles per milestone; stop category on gate failure.
