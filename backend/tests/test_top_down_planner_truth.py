import json

from services import game_blueprints as gb
from services.runtime_selection import detect_mechanics


def sample_sections():
    return {
        "identity": {
            "title": "Test Kitchen",
            "description": "A boss quest with NPC dialogue and puzzles",
            "genre": "RPG",
        },
        "runtime": {"family": None, "runtime_id": "top_down",
                    "camera_model": "side scroll", "control_model": "combat"},
        "gameplay": {
            "core_loop": "Fight a boss and solve puzzles",
            "player_mechanics": ["4-direction movement", "combat", "inventory loot"],
            "enemies": ["Boss battle", "Patroller with an avoidance puzzle"],
            "bosses": ["Dragon"], "npcs": ["Cook"],
            "levels": [
                {"name": "Room One", "puzzle": "switch doors"},
                {"name": "Room Two", "boss": "dragon"},
            ],
            "worlds": ["Sky Harbor"], "maps": ["Overhead rooms"],
            "objectives": ["Complete quest"], "quests": ["Cook quest"],
            "progression": "loot", "inventory": "ingredients",
            "upgrades": ["weapon"], "abilities": ["spell"],
            "weapons_or_spells": ["fireball"],
        },
        "systems": {
            "ui_hud": ["inventory panel"], "save_requirements": "inventory",
            "achievements": ["Boss Slayer"], "tutorials": ["combat"],
            "fire_power_integrations": ["token purchase"],
        },
        "media": {
            "artwork": ["boss sprite", "overhead tileset"],
            "animation": ["NPC dialogue", "walking"],
            "music": ["score"], "sound_effects": ["hits"], "voice": ["lines"],
            "cinematics": ["intro video"], "promotional": ["boss cover"],
            "accessibility": [],
        },
        "meta": {},
    }


def test_top_down_truth_boundary_removes_unplayable_promises():
    out = gb._sanitize_runtime_sections(
        sample_sections(), "top_down", "Arcane Hearth exactly 2 stages",
        ["game", "image"],
    )
    gp = out["gameplay"]
    for key in ("bosses", "npcs", "quests", "upgrades", "abilities", "weapons_or_spells"):
        assert gp[key] == []
    assert gp["inventory"] == ""
    assert len(gp["levels"]) == 2
    assert "Arcane Hearth finish portal" in gp["core_loop"]
    assert out["media"]["music"] == []
    assert out["media"]["sound_effects"] == []
    assert out["media"]["voice"] == []
    assert out["media"]["cinematics"] == []
    assert out["systems"]["fire_power_integrations"] == []


def test_empty_schema_keys_are_not_detected_as_mechanics():
    out = gb._sanitize_runtime_sections(
        sample_sections(), "top_down", "Generic overhead game", ["game", "image"]
    )
    value_text = gb._content_values_text(out["gameplay"])
    detected = detect_mechanics(value_text)
    support = gb.mechanics_support("top_down", detected, [])
    assert support["unsupported"] == [], (detected, support)
    assert "Arcane Hearth" not in json.dumps(out)


def test_declared_top_down_er_and_checkpoint_capabilities_are_supported():
    support = gb.mechanics_support(
        "top_down",
        ["checkpoints & respawn", "verified resource pickups (Coins, Gems, Stars, Keys)"],
        [],
    )
    assert support["unsupported"] == []


def test_top_down_asset_plan_does_not_request_boss_or_npc_sprites():
    clean = gb._sanitize_runtime_sections(
        sample_sections(), "top_down", "Generic overhead game", ["game", "image"]
    )
    reqs = gb.derive_asset_requirements("top_down", clean, 10)
    slots = {r.get("slot") for r in reqs}
    assert "boss_sprite" not in slots
    assert "npc_sprite" not in slots
