"""Gameplay System / Economy / Fire-Power-hook / Plugin registries.
Reward tables are registry DATA (founder-editable via registry upsert) —
never hardcoded in build code."""
from services.game_platform.registry_core import Registry


def _sys(label, status, notes=""):
    return {"label": label, "status": status, "notes": notes}


# status: implemented (works in vetted runtimes today) · partial · planned
GAMEPLAY_SYSTEM_SEED = {
    "dialogue": _sys("Dialogue", "implemented", "visual_novel + rpg NPC dialogue"),
    "quests": _sys("Quests", "implemented", "rpg/top_down objectives + quest lists"),
    "inventory": _sys("Inventory", "implemented", "rpg inventory"),
    "crafting": _sys("Crafting", "partial", "farming goods crafting; deep trees planned"),
    "equipment": _sys("Equipment", "implemented", "rpg equipment slots"),
    "abilities": _sys("Abilities", "implemented", "tactics/rpg ability sets"),
    "xp": _sys("Experience (XP)", "implemented", "rpg XP curve"),
    "leveling": _sys("Leveling", "implemented", "rpg/creature levels"),
    "achievements": _sys("Achievements", "implemented", "engine-wide achievement chips"),
    "checkpoints": _sys("Checkpoints", "implemented", "engine checkpoint popups + saves"),
    "save_load": _sys("Save / Load", "implemented", "game_progress collection per player"),
    "autosave": _sys("Autosave", "implemented", "score/stage autosaved on progress events"),
    "world_progression": _sys("World Progression", "implemented", "stage/zone unlock chains"),
    "cutscenes": _sys("Cutscenes", "partial", "scene-graph cutscene slots; timed art planned"),
    "boss_phases": _sys("Boss Phases", "partial", "boss stages exist; multi-phase HP planned"),
    "tutorials": _sys("Tutorials", "implemented", "tutorial scenes + control guides"),
    "settings": _sys("Settings", "implemented", "controls/accessibility panels"),
    "localization": _sys("Localization", "planned", "string tables planned — English only today"),
    "accessibility": _sys("Accessibility", "implemented",
                          "left-handed, reduced motion, high contrast, haptics, control guide"),
}

# Reward tables live HERE as data — founder edits via registry upsert.
ECONOMY_SEED = {
    "fire_power": {"label": "Fire Power", "kind": "platform_currency",
                   "server_authoritative": True, "ledger": "fire_wallets + idempotent gfp:* keys",
                   "reward_table": {"completion": 100, "perfect": 50, "speed": 25,
                                    "hidden_objective": 20, "achievement": 10, "boss": 30,
                                    "daily": 15, "weekly": 40, "final_completion": 150},
                   "limits": {"daily_player_cap": 300, "claim_cooldown_s": 60}},
    "experience": {"label": "Experience", "kind": "progression",
                   "reward_table": {"enemy_defeat": 10, "quest_complete": 50, "boss_defeat": 100,
                                    "level_clear": 25}},
    "coins": {"label": "Coins", "kind": "in_game_soft",
              "reward_table": {"pickup": 1, "enemy_defeat": 5, "quest_complete": 20}},
    "resources": {"label": "Resources", "kind": "in_game_material",
                  "reward_table": {"gather": 1, "harvest": 3, "rare_find": 10}},
    "custom": {"label": "Custom Currency", "kind": "template",
               "reward_table": {}, "notes": "clone this entry per game for bespoke currencies"},
}

# Every hook routes through the EXISTING ledger-backed grant path
# (games_plus _pool_grant → credit_fire): authenticated, server
# authoritative, atomic pool decrement, idempotency key per event.
FIRE_HOOK_SEED = {
    "claims": {"label": "Vault claim", "idempotency": "gfp:{game}:{user}:{event}", "path": "fire/wallet/collect"},
    "burns": {"label": "Burn on use", "idempotency": "burn:{feature}:{user}:{ts}", "path": "access_policy fp_cost"},
    "rewards": {"label": "Score reward", "idempotency": "gfp:{game}:{user}:{kind}:{period}", "path": "_pool_grant"},
    "leaderboards": {"label": "Leaderboard prize", "idempotency": "gfp:{game}:lb:{user}:{period}", "path": "_pool_grant"},
    "achievements": {"label": "Achievement grant", "idempotency": "gfp:{game}:ach:{user}:{ach}", "path": "_pool_grant"},
    "quests": {"label": "Quest reward", "idempotency": "gfp:{game}:quest:{user}:{quest}", "path": "_pool_grant"},
    "battles": {"label": "Battle reward", "idempotency": "gfp:{game}:battle:{user}:{battle}", "path": "_pool_grant"},
    "bosses": {"label": "Boss reward", "idempotency": "gfp:{game}:boss:{user}:{boss}", "path": "_pool_grant"},
    "daily_rewards": {"label": "Daily reward", "idempotency": "gfp:{game}:daily:{user}:{date}", "path": "_pool_grant"},
    "events": {"label": "Event reward", "idempotency": "gfp:{game}:event:{user}:{event}", "path": "_pool_grant"},
}

# Plugin/extension points — new plugins = DB inserts, executed only when
# a matching handler is registered in PLUGIN_HANDLERS by future code.
PLUGIN_SEED = {
    "hook_points": {"label": "Available hook points",
                    "points": ["planning_stage", "validation", "build_stage",
                               "economy_grant", "asset_resolution", "publish"]},
}

system_registry = Registry("gameplay_systems", GAMEPLAY_SYSTEM_SEED,
                           description="Universal reusable game systems")
economy_registry = Registry("economy", ECONOMY_SEED,
                            description="Economy modules — reward tables are editable data")
fire_hook_registry = Registry("fire_hooks", FIRE_HOOK_SEED,
                              description="Ledger-backed Fire Power hooks")
plugin_registry = Registry("plugins", PLUGIN_SEED, description="Plugin/extension registry")
