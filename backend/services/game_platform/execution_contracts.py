"""Runtime Execution Contracts + Diversity/Quality gates.

Ground truth: the playable output is dispatched in GameRuntime.jsx via
`rt = ({quiz_adventure:qa, ...})[S.runtime]`. A runtime is EXECUTABLE
only if it has a real function there. Contracts are validated BEFORE
any AI generation; missing components stop the build with the exact
missing component named. Visual honesty: real sprites render only when
`spec.assets` is wired (library/Asset Studio) — otherwise the shared
painted-primitive presentation is used and MUST be reported as such."""
from core.db import db
from services.game_studio import RUNTIMES, RUNTIME_LABELS, RUNTIME_MECHANICS, WIN_LOSS

# runtime -> executable implementation function in GameRuntime.jsx
IMPLEMENTATION = {
    "quiz_adventure": "qa", "matching": "ma", "sorting": "so", "memory": "me", "rhythm": "rh",
    "top_down": "td", "platformer": "pf", "dodge_collect": "dc", "puzzle_room": "pz",
    "card_battle": "cb", "tower_defense": "tdf", "match3": "m3", "rpg": "rpg",
    "turn_based_creature_rpg": "rpg", "racing": "rac", "farming": "frm", "city_builder": "cbl",
    "roguelike": "rgl", "tactics": "tac", "idle": "idl", "visual_novel": "vn", "fishing": "fsh",
    "action_rpg_2_5d": "arpg",
    "shooter": "sht",
    "open_world_rpg": "owr",
}
SHARED_FOUNDATION = {  # justified implementation reuse (must be disclosed, counts as shared impl)
    "turn_based_creature_rpg": ("rpg", "creature-RPG mode of the rpg engine: exploration, party, "
                                       "capture and turn-based battle are the same executable with a "
                                       "stricter spec contract (catchable creatures + starter required)"),
}
CONTROL_MODEL = {
    "platformer": "arrows/left-right + jump", "dodge_collect": "lane steering",
    "top_down": "4-direction movement", "rpg": "tap-tile walk + battle action buttons",
    "turn_based_creature_rpg": "tap-tile walk + battle action buttons (Attack/Catch/Swap)",
    "card_battle": "click cards to play, end turn", "tower_defense": "click to place/upgrade towers",
    "match3": "click-swap adjacent tiles", "tactics": "select unit → move/act grid",
    "racing": "steer/drift buttons", "farming": "click plots (plant/water/harvest)",
    "city_builder": "click grid to place buildings", "roguelike": "step movement (bump combat)",
    "idle": "click generators/upgrades", "visual_novel": "click choices", "rhythm": "tap on beat",
    "quiz_adventure": "click answers", "matching": "flip cards", "memory": "flip cards",
    "sorting": "click in order", "puzzle_room": "click objects/answers", "fishing": "timed cast/reel",
    "action_rpg_2_5d": "continuous 8-dir movement + melee/spell/dodge/interact "
                       "(keyboard, gamepad, mobile joystick + buttons)",
    "shooter": "WASD/arrows/touch-drag 360° movement + automatic nearest-threat fire",
    "open_world_rpg": "WASD/arrows/touch-drag roaming + NPC proximity interaction + combat",
}
CAMERA = {"platformer": "side-scrolling", "dodge_collect": "vertical scroll", "racing": "chase/top",
          "top_down": "top-down grid", "rpg": "top-down grid + battle overlay",
          "turn_based_creature_rpg": "top-down region grid + battle overlay",
          "tower_defense": "fixed board", "card_battle": "fixed duel table", "match3": "fixed board",
          "tactics": "fixed grid", "city_builder": "fixed board", "roguelike": "top-down dungeon",
          "farming": "fixed plots", "idle": "panel", "visual_novel": "scene panel",
          "rhythm": "lane highway", "quiz_adventure": "panel", "matching": "board", "memory": "board",
          "sorting": "board", "puzzle_room": "panel", "fishing": "side water view",
          "action_rpg_2_5d": "smooth follow camera with look-ahead, bounds, arena lock and shake "
                             "over a layered 2.5D parallax world",
          "shooter": "fixed top-down arena view",
          "open_world_rpg": "smooth top-down world camera following the player across a larger map"}


def execution_contract(rt: str) -> dict:
    impl = IMPLEMENTATION.get(rt)
    shared = SHARED_FOUNDATION.get(rt)
    return {
        "runtime_id": f"runtime_{rt}_v1" if rt != "turn_based_creature_rpg" else "runtime_turn_based_creature_rpg_v1",
        "runtime": rt, "label": RUNTIME_LABELS.get(rt, rt),
        "executable_implementation": f"GameRuntime.{impl}" if impl else None,
        "shared_foundation": ({"with": shared[0], "justification": shared[1]} if shared else None),
        "template_implementation": f"tpl_{rt}_v1",
        "renderers": (["action_rpg_2_5d_layered"] if rt == "action_rpg_2_5d"
                      else ["canvas_2d"] if impl not in ("qa", "vn") else ["dom_ui"]),
        "scene_schema": f"validate_spec[{rt}]",
        "gameplay_systems": RUNTIME_MECHANICS.get(rt, []),
        "control_model": CONTROL_MODEL.get(rt),
        "camera": CAMERA.get(rt),
        "win_loss": WIN_LOSS.get(rt),
        "validation_contract": "services.game_studio.validate_spec",
        "save_adapter": "game_progress autosave (score/stage/best per player)",
        "fire_power_adapter": "fire_economy block + vault ledger (idempotent gfp:* claims)",
        "placeholder_policy": "painted-primitive presentation until spec.assets is wired "
                              "from the asset library / Asset Studio (drawSpr slots)",
        "smoke_test_adapter": "iframe data-testids per runtime (e.g. rpg-tile-*, orai title tap)",
        "status": "executable" if impl else "registered_not_executable",
    }


def validate_execution(rt: str) -> dict:
    """Pre-build gate: every required executable component must exist."""
    c = execution_contract(rt)
    missing = [k for k in ("executable_implementation", "control_model", "camera",
                           "win_loss", "scene_schema") if not c.get(k)]
    if rt not in RUNTIMES:
        missing.insert(0, f"runtime '{rt}' not registered in engine RUNTIMES")
    return {"runtime": rt, "ok": not missing, "status": c["status"], "missing_components": missing,
            "contract": c}


def _placeholder_pct(game: dict) -> int:
    from services.game_platform.asset_wiring import placeholder_pct
    return placeholder_pct(game)


async def diversity_report(game_ids: list) -> dict:
    """Batch diversity & quality gate. A version is rejected when it shares
    implementation + loop + controls + camera + scene structure with an
    earlier accepted version (color/name/text changes don't count)."""
    rows = []
    accepted = []
    for gid in game_ids[:20]:
        g = await db.games.find_one({"id": gid}, {"_id": 0, "id": 1, "title": 1, "runtime": 1,
                                                  "status": 1, "spec": 1, "published": 1})
        if not g:
            rows.append({"game_id": gid, "error": "not found"})
            continue
        rt = g.get("runtime")
        c = execution_contract(rt)
        impl = c["executable_implementation"]
        scene_keys = sorted(((g.get("spec") or {}).get("stages") or [{}])[0].keys())
        fingerprint = {"implementation": impl, "control_model": c["control_model"],
                       "camera": c["camera"], "core_loop": (c["win_loss"] or ("", ""))[0],
                       "scene_structure": ",".join(scene_keys[:8]), "renderer": c["renderers"][0]}
        dup = next((a for a in accepted
                    if a["fingerprint"]["implementation"] == impl
                    and a["fingerprint"]["scene_structure"] == fingerprint["scene_structure"]), None)
        shared = SHARED_FOUNDATION.get(rt)
        eligible = c["status"] == "executable" and (dup is None or bool(shared))
        entry = {
            "game_id": gid, "title": g.get("title"), "runtime": rt,
            "runtime_genuinely_executed": c["status"] == "executable",
            "generic_fallback_used": c["status"] != "executable",
            "implementation": impl, "fingerprint": fingerprint,
            "placeholder_percentage": _placeholder_pct(g),
            "gameplay_difference_from_previous": ("distinct implementation and loop" if not dup else
                                                  (f"shares implementation with {dup['title']} — "
                                                   + (shared[1] if shared else "NOT justified"))),
            "visual_difference_from_previous": ("painted primitives — SAME shared presentation "
                                                "(no assets wired)" if _placeholder_pct(g) == 100
                                                else "custom assets wired"),
            "publish_eligibility": bool(eligible and _placeholder_pct(g) < 100),
            "exact_limitation": ("no spec.assets wired — renders the shared painted-primitive "
                                 "presentation" if _placeholder_pct(g) == 100 else
                                 ("" if eligible else "duplicate implementation without justification")),
        }
        rows.append(entry)
        if eligible:
            accepted.append(entry)
    return {"games": rows,
            "accepted": [r["game_id"] for r in rows if r.get("publish_eligibility")],
            "rejected": [r["game_id"] for r in rows if r.get("publish_eligibility") is False],
            "note": "publish_eligibility requires a genuinely executed runtime, a distinct or "
                    "justified implementation AND at least some wired visual assets"}
