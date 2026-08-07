"""Asset Wiring Pipeline — connects the Asset Library / Asset Studio to the
slots the runtime renderer ACTUALLY consumes (GameRuntime.jsx drawSpr /
sprHtml / bgify call sites). Flow: request -> library search -> reuse ->
generate missing only -> spec.assets -> runtime slot mapping -> renderer."""
import re
import uuid

from core.db import db
from services import game_assets as ga

# (slot, required_for_publish) per executable runtime — ONLY slots the
# renderer genuinely consumes. music_theme plays via the runtime's Audio
# element when a file exists (no generation provider — synth fallback).
_ARCADE = [("player_sprite", True), ("enemy_sprite", True), ("boss_sprite", False),
           ("tileset", True), ("background", True), ("effect_fx", False)]
RUNTIME_SLOTS = {
    "top_down": _ARCADE, "platformer": _ARCADE, "dodge_collect": _ARCADE,
    "action_rpg_2_5d": [("player_sprite", True), ("enemy_sprite", True), ("boss_sprite", True),
                        ("npc_sprite", False), ("background", True), ("background_near", False),
                        ("foreground", False), ("tileset", False),
                        ("projectile_sprite", False), ("effect_fx", False),
                        ("character_portrait", False), ("icon_set", False), ("ui_frame", False)],
    "rpg": [("player_sprite", True), ("enemy_sprite", True), ("creature_sprite", False),
            ("npc_sprite", False), ("background", True), ("battle_scene", False)],
    "turn_based_creature_rpg": [("player_sprite", True), ("creature_sprite", True),
                                ("enemy_sprite", True), ("npc_sprite", False),
                                ("background", True), ("battle_scene", False)],
    "card_battle": [("card_face", True), ("enemy_sprite", True), ("boss_sprite", False),
                    ("battle_scene", False), ("background", True)],
    "tower_defense": [("tower_sprite", True), ("enemy_sprite", True),
                      ("projectile_sprite", False), ("boss_sprite", False), ("background", True)],
    "match3": [("icon_set", True), ("background", False)],
    "tactics": [("player_sprite", True), ("enemy_sprite", True), ("background", False)],
    "roguelike": [("player_sprite", True), ("enemy_sprite", True), ("background", False)],
    "visual_novel": [("character_portrait", True), ("background", False)],
    "quiz_adventure": [("background", False), ("character_portrait", False)],
    "racing": [("background", False)], "farming": [("background", False)],
    "city_builder": [("background", False)], "idle": [("background", False)],
    "fishing": [("background", False)], "rhythm": [("background", False)],
    "puzzle_room": [("background", False)], "matching": [("background", False)],
    "sorting": [("background", False)], "memory": [("background", False)],
}
DEFAULT_SLOTS = [("background", False)]
AUDIO_SLOTS = [("music_theme", False)]  # every runtime can play it; never generated


def slot_defs(runtime: str, game: dict = None) -> list:
    base = RUNTIME_SLOTS.get(runtime or "", DEFAULT_SLOTS) + AUDIO_SLOTS
    if game and runtime == "action_rpg_2_5d":
        stages = ((game.get("spec") or {}).get("stages")) or []
        if any((s or {}).get("mode") == "side_scroll" for s in stages):
            for lvl in (2, 3):
                if len(stages) >= lvl:
                    base = base + [(f"{b}_l{lvl}", False)
                                   for b in ("background", "background_near", "foreground",
                                             "tileset", "enemy_sprite", "boss_sprite")]
    return base


def image_slot_defs(runtime: str, game: dict = None) -> list:
    return [(k, r) for k, r in slot_defs(runtime, game) if ga.SLOTS[k]["kind"] != "audio"]


def placeholder_pct(game: dict) -> int:
    """Placeholder percentage from ACTUAL renderer slot usage (required 2x weight)."""
    defs = image_slot_defs((game or {}).get("runtime"), game)
    assets = (((game or {}).get("spec") or {}).get("assets")) or {}
    total = wired = 0
    for k, req in defs:
        w = 2 if req else 1
        total += w
        if (assets.get(k) or {}).get("url"):
            wired += w
    return int(round(100 * (1 - wired / total))) if total else 0


def validate_wiring(game: dict) -> dict:
    """Required slots block PUBLISHING only; optional never block testing.
    Broken assets are safe — the renderer falls back to painted primitives."""
    assets = (((game or {}).get("spec") or {}).get("assets")) or {}
    rows, blockers, warnings = [], [], []
    for k, req in image_slot_defs(game.get("runtime"), game):
        cur = assets.get(k) or {}
        url = cur.get("url") or ""
        if not url:
            rows.append({"slot": k, "required": req, "status": "placeholder"})
            if req:
                blockers.append(k)
            continue
        meta = cur.get("meta") or {}
        broken = not (url.startswith("/api/") or url.startswith("http"))
        want = ga.SLOTS[k]["kind"]
        if meta.get("kind") and meta["kind"] != want:
            warnings.append(f"{k}: asset kind '{meta['kind']}' differs from slot kind '{want}'")
        if meta.get("width") and meta["width"] < 64:
            warnings.append(f"{k}: low resolution {meta['width']}px")
        rows.append({"slot": k, "required": req, "status": "broken" if broken else "ready",
                     "url": url, **({"fallback": "renderer paints primitives (safe)"} if broken else {})})
        if broken and req:
            blockers.append(k)
    return {"slots": rows, "publish_blockers": blockers, "warnings": warnings,
            "placeholder_pct": placeholder_pct(game), "testing_blocked": False,
            "note": "optional assets never block testing; required assets block publishing only"}


def _tok(t) -> set:
    return {w for w in re.findall(r"[a-z0-9]+", str(t or "").lower()) if len(w) > 2}


async def find_library_match(owner_id: str, game: dict, slot: str):
    """Reuse only assets that are genuinely compatible with this runtime/game.

    Runtime identity is a hard gate. Theme/subject similarity is then scored.
    A weak or cross-runtime match is treated as missing so generation or
    procedural fallback can handle it instead of wiring unrelated artwork.
    """
    if ga.SLOTS[slot]["kind"] == "audio":
        return None

    runtime = str(game.get("runtime") or "").strip().lower()
    spec = game.get("spec") or {}
    theme = spec.get("visual_theme") or {}

    environment = str(
        theme.get("environment")
        or spec.get("environment")
        or ""
    ).strip().lower()

    player_name = str(
        theme.get("player_name")
        or theme.get("player")
        or ""
    ).strip().lower()

    art_preset = str(game.get("art_preset") or "").strip().lower()

    cands = await db.orai_assets.find(
        {
            "archived": {"$ne": True},
            "creator_id": owner_id,
            "type": "game_asset",
            "settings.slot": slot,
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(80)

    want_general = _tok(
        f"{game.get('title')} {game.get('genre')} "
        f"{environment} {art_preset}"
    )
    want_subject = _tok(player_name)

    best = None
    best_score = 0.0

    for a in cands:
        tags = {str(x).strip().lower() for x in (a.get("tags") or [])}

        # HARD GATE:
        # Generated game assets are tagged with the runtime that created them.
        # Never reuse an asset from another executable runtime.
        if runtime and runtime not in tags:
            continue

        have_text = (
            f"{a.get('title')} {a.get('prompt')} "
            f"{' '.join(str(x) for x in (a.get('tags') or []))}"
        )
        have = _tok(have_text)

        general_score = (
            len(want_general & have) / max(1, len(want_general))
            if want_general else 0.0
        )

        subject_score = (
            len(want_subject & have) / max(1, len(want_subject))
            if want_subject else 0.0
        )

        # Character/player slots require some actual subject compatibility.
        # "same runtime + same slot" is not enough to turn a space explorer
        # into an old wizard/dragon avatar.
        if slot in {
            "player_sprite",
            "character_portrait",
            "creature_sprite",
            "npc_sprite",
        }:
            if want_subject and subject_score < 0.34:
                continue
            score = (general_score * 0.55) + (subject_score * 0.45)
        else:
            score = general_score

        if score > best_score:
            best = a
            best_score = score

    # Be intentionally conservative. Generating/falling back is safer than
    # silently wiring unrelated art into a new game.
    return best if best is not None and best_score >= 0.55 else None


async def wire_assets(game: dict, actor: dict, *, mode: str = "generate_missing",
                      art_quality: int = 1, cost_ceiling=None, prompts: dict = None) -> dict:
    """Full pipeline pass: reuse from library first, then generate ONLY what
    is still missing (mode: reuse_only | generate_required_only | generate_missing)."""
    assets = ((game.get("spec") or {}).get("assets")) or {}
    reused, missing, skipped = [], [], []
    for k, req in slot_defs(game.get("runtime"), game):
        if (assets.get(k) or {}).get("url"):
            skipped.append({"slot": k, "status": "already_wired"})
            continue
        if ga.SLOTS[k]["kind"] == "audio":
            m = await find_library_match(actor["id"], game, k)
            skipped.append({"slot": k, "status": "no_audio_provider",
                            "note": "runtime uses procedural synth fallback"})
            continue
        m = await find_library_match(actor["id"], game, k)
        if m:
            refs = m.get("refs") or {}
            url = m.get("public_url") or ga.public_asset_url(refs.get("url") or "")
            meta = refs.get("meta") or ga._asset_meta(k, 0, 0)
            await ga.set_slot_asset(game["id"], k, {"url": url, "meta": meta, "asset_id": m["id"]},
                                    actor, source="library_reuse")
            await db.orai_assets.update_one({"id": m["id"]}, {"$inc": {"usage_count": 1}})
            reused.append({"slot": k, "asset_id": m["id"], "name": m.get("title")})
        else:
            missing.append((k, req))
    to_gen = []
    if mode == "generate_required_only":
        to_gen = [k for k, r in missing if r]
    elif mode in ("generate_missing", "generate_all"):
        to_gen = [k for k, _ in missing]
    job = None
    if to_gen:
        fresh = await db.games.find_one({"id": game["id"]}, {"_id": 0})
        est = ga.estimate_pack(fresh, to_gen, art_quality)
        ceiling = float(cost_ceiling) if cost_ceiling else est["suggested_ceiling"]
        job = await ga.create_job(fresh, to_gen, art_quality, ceiling,
                                  prompts or {}, actor, uuid.uuid4().hex)
    fresh = await db.games.find_one({"id": game["id"]}, {"_id": 0})
    return {"mode": mode, "reused": reused, "skipped": skipped,
            "generation_job": ({"id": job["id"], "slots": to_gen, "status": job["status"],
                                "estimate": job.get("estimate", {}).get("total")} if job else None),
            "not_generated": [k for k, _ in missing if k not in to_gen],
            "placeholder_pct": placeholder_pct(fresh), "validation": validate_wiring(fresh)}
