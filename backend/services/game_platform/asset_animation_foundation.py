"""Shared OPC Asset & Animation Foundation — canonical gameplay asset
roles + the common animation-state contract, exposed through the same
versioned Registry engine as runtimes/renderers/templates. Seeds are
DERIVED from the systems the engine actually consumes (game_assets.SLOTS,
asset_wiring.RUNTIME_SLOTS, sprite_studio.ANIMATION_STATES) so this
registry can never drift from the real renderer contract."""
from services import game_assets as ga
from services import sprite_studio
from services.game_platform.asset_wiring import RUNTIME_SLOTS, DEFAULT_SLOTS, AUDIO_SLOTS
from services.game_platform.registry_core import Registry
from services.game_platform.runtime_registry import runtime_registry

# ── Asset roles: every slot the renderers genuinely consume ──────────
_CHARACTER_ROLES = {"player_sprite", "enemy_sprite", "boss_sprite", "npc_sprite",
                    "creature_sprite", "tower_sprite"}

ASSET_ROLE_SEED = {
    key: {
        "label": d["label"], "kind": d["kind"], "transparent": d.get("transparent", False),
        "animatable": key in _CHARACTER_ROLES or bool(d.get("anim")),
        "spritesheet": d.get("anim") or None,
        "tile_grid": d.get("tile") or None,
        "hint": d.get("hint", ""),
        "consumed_by_runtimes": sorted({rt for rt, slots in RUNTIME_SLOTS.items()
                                        if any(s == key for s, _ in slots)}),
    }
    for key, d in ga.SLOTS.items() if not key.endswith(("_l2", "_l3"))
}
ASSET_ROLE_SEED["parallax_layer"] = {
    "label": "Parallax Layer", "kind": "background", "transparent": False,
    "animatable": False, "spritesheet": None, "tile_grid": None,
    "hint": "depth-layered scrolling background band — implemented via the "
            "'background' slot; renderers derive parallax layers from it",
    "implemented_via": "background",
    "consumed_by_runtimes": ["action_rpg_2_5d", "platformer", "top_down", "dodge_collect"],
}

# ── Animation-state contract (sprite_studio is the executable source) ─
_CORE_STATES = {"idle", "walk", "jump"}
_STATE_HINTS = {
    "idle": "default standing loop", "walk": "ground locomotion loop",
    "run": "fast locomotion loop", "jump": "airborne ascent",
    "fall": "airborne descent", "attack": "primary melee/action strike",
    "cast": "spell/ability wind-up + release", "hit": "damage reaction flinch",
    "death": "defeat sequence (respawn re-enters idle)",
    "victory": "win celebration", "special": "runtime-specific extra state",
}
ANIMATION_STATE_SEED = {
    s: {"label": s.replace("_", " ").title(), "core": s in _CORE_STATES,
        "hint": _STATE_HINTS.get(s, ""), "slicer_supported": True,
        "default_fps": 6, "applies_to_roles": sorted(_CHARACTER_ROLES)}
    for s in sprite_studio.ANIMATION_STATES
}

asset_role_registry = Registry(
    "asset_roles", ASSET_ROLE_SEED,
    description="Shared gameplay asset roles consumed by the vetted renderers")
animation_state_registry = Registry(
    "animation_states", ANIMATION_STATE_SEED,
    description="Common animation-state contract (sprite_studio slicer states)")


async def asset_profile(family_or_runtime: str) -> dict:
    """Inspection contract: family/runtime -> renderer slots + animation
    states + sprite pipeline support. Accepts a registry family id OR a
    raw engine runtime id."""
    fam_entry = await runtime_registry.get(family_or_runtime)
    engine = (fam_entry or {}).get("definition", {}).get("engine_runtime") \
        if fam_entry else None
    runtime = engine or (family_or_runtime if family_or_runtime in RUNTIME_SLOTS else None)
    if fam_entry and not engine:
        return {"family": family_or_runtime, "engine_runtime": None,
                "maturity": fam_entry["definition"].get("maturity"),
                "slots": [], "animation_states": [],
                "note": "foundation-only family — no executable renderer, no asset slots yet"}
    if not runtime:
        return {"family": family_or_runtime, "engine_runtime": None, "slots": [],
                "animation_states": [], "note": "unknown family/runtime"}
    slot_rows = RUNTIME_SLOTS.get(runtime, DEFAULT_SLOTS) + AUDIO_SLOTS
    roles = await asset_role_registry.all()
    slots = []
    for key, required in slot_rows:
        role = (roles.get(key) or {}).get("definition") or {}
        slots.append({"slot": key, "required_for_publish": required,
                      "kind": role.get("kind"), "animatable": role.get("animatable", False)})
    animatable = [s["slot"] for s in slots if s["animatable"]]
    return {
        "family": family_or_runtime, "engine_runtime": runtime,
        "maturity": (fam_entry or {}).get("definition", {}).get("maturity") or "generatable",
        "slots": slots,
        "animation_states": sprite_studio.ANIMATION_STATES,
        "core_animation_states": sorted(_CORE_STATES),
        "animatable_slots": animatable,
        "sprite_pipeline": {"slicer": "sprite_studio auto/manual slicing",
                            "manifest": "runtime_export manifest wired into spec.assets",
                            "fallback": "renderer painted primitives when a slot is unwired"},
    }
