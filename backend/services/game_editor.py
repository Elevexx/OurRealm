"""Universal Game Editor — edit game content without regeneration, with
versioned snapshots + rollback. Also: Remix This Game (never mutates the
original) and Release Modes. Collections: games, game_edit_versions."""
import logging
import uuid
from datetime import datetime, timezone

from core.db import db

log = logging.getLogger("ourrealm.game_editor")

# Whitelisted editable paths — content only, never build/runtime internals.
EDITABLE_TOP = {"title", "description", "genre"}
EDITABLE_SPEC = {"levels", "maps", "stages", "characters", "bosses", "npcs", "enemies",
                 "quests", "dialogue", "ui", "music", "sound", "animations",
                 "fire_power", "difficulty", "controls", "save_system",
                 "visual_theme", "environment", "assets"}
MAX_VERSIONS = 20

RELEASE_MODES = ["founder_only", "custom", "beta", "launch", "maintenance", "archive"]
REMIX_TYPES = ["clone", "sequel", "theme_swap", "art_swap", "mechanic_swap",
               "difficulty_variant", "holiday_version"]


def _iso():
    return datetime.now(timezone.utc).isoformat()


def editable_view(game: dict) -> dict:
    spec = game.get("spec") or {}
    return {"game_id": game["id"], "title": game.get("title"),
            "description": game.get("description"), "genre": game.get("genre"),
            "runtime": game.get("runtime"), "status": game.get("status"),
            "release": game.get("release") or {"mode": "launch", "requirements": {}},
            "editable_top_fields": sorted(EDITABLE_TOP),
            "editable_spec_sections": sorted(EDITABLE_SPEC),
            "spec": {k: spec.get(k) for k in EDITABLE_SPEC if k in spec},
            "edit_version": game.get("edit_version") or 0}


async def _snapshot(game: dict, actor: dict, reason: str):
    ver = (game.get("edit_version") or 0)
    await db.game_edit_versions.insert_one({
        "id": uuid.uuid4().hex, "game_id": game["id"], "version": ver,
        "snapshot": {"title": game.get("title"), "description": game.get("description"),
                     "genre": game.get("genre"),
                     "spec": {k: (game.get("spec") or {}).get(k)
                              for k in EDITABLE_SPEC if k in (game.get("spec") or {})}},
        "reason": reason[:200], "by": actor.get("username"), "at": _iso()})
    ids = [v["id"] async for v in db.game_edit_versions.find(
        {"game_id": game["id"]}, {"id": 1}).sort("version", -1).skip(MAX_VERSIONS)]
    if ids:
        await db.game_edit_versions.delete_many({"id": {"$in": ids}})


async def apply_patch(game: dict, patch: dict, actor: dict) -> dict:
    """Whitelisted field edits — no regeneration, snapshot first."""
    sets, rejected = {}, []
    for path, value in (patch or {}).items():
        parts = str(path).split(".", 1)
        if len(parts) == 1 and parts[0] in EDITABLE_TOP:
            sets[parts[0]] = str(value)[:600] if isinstance(value, str) else value
        elif parts[0] == "spec" and parts[1].split(".", 1)[0] in EDITABLE_SPEC:
            sets[path] = value
        else:
            rejected.append(path)
    if not sets:
        return {"updated": False, "rejected_paths": rejected}
    await _snapshot(game, actor, f"edit: {', '.join(list(sets)[:5])}")
    await db.games.update_one({"id": game["id"]}, {
        "$set": {**sets, "updated_at": _iso(), "edited_without_regeneration": True},
        "$inc": {"edit_version": 1}})
    return {"updated": True, "fields": sorted(sets), "rejected_paths": rejected}


async def rollback(game: dict, version: int, actor: dict) -> dict:
    snap = await db.game_edit_versions.find_one(
        {"game_id": game["id"], "version": int(version)}, {"_id": 0})
    if not snap:
        raise ValueError("Version not found")
    await _snapshot(game, actor, f"pre-rollback to v{version}")
    sets = {k: v for k, v in snap["snapshot"].items() if k != "spec"}
    for k, v in (snap["snapshot"].get("spec") or {}).items():
        sets[f"spec.{k}"] = v
    await db.games.update_one({"id": game["id"]}, {
        "$set": {**sets, "updated_at": _iso()}, "$inc": {"edit_version": 1}})
    return {"rolled_back_to": version}


# ── Remix This Game — original is never modified ─────────────────────
async def remix_game(game: dict, remix_type: str, actor: dict, opts: dict) -> dict:
    if remix_type not in REMIX_TYPES:
        raise ValueError("Unknown remix type")
    doc = {k: v for k, v in game.items() if k != "_id"}
    doc["id"] = uuid.uuid4().hex
    suffix = {"clone": "Copy", "sequel": "II", "theme_swap": "Rethemed",
              "art_swap": "Restyled", "mechanic_swap": "Remixed",
              "difficulty_variant": "Challenge", "holiday_version": "Holiday"}[remix_type]
    doc["title"] = f"{game.get('title')} — {suffix}"[:120]
    doc["remix_of"] = game["id"]
    doc["remix_type"] = remix_type
    doc["remix_notes"] = str(opts.get("notes") or "")[:400]
    doc["status"] = "draft_remix"
    doc["release"] = {"mode": "founder_only", "requirements": {}}
    doc["privacy"] = "private" if opts.get("private", True) else doc.get("privacy", "private")
    doc["plays"] = 0
    doc["published_at"] = None
    doc["edit_version"] = 0
    doc["created_at"] = _iso()
    doc["updated_at"] = _iso()
    await db.games.insert_one({**doc})
    doc.pop("_id", None)
    return doc


# ── Release Modes ────────────────────────────────────────────────────
def normalize_release(cfg: dict) -> dict:
    mode = cfg.get("mode") if cfg.get("mode") in RELEASE_MODES else "launch"
    req = cfg.get("requirements") or {}
    return {"mode": mode, "requirements": {
        "badges": [str(b)[:40] for b in (req.get("badges") or [])][:10],
        "users": [str(u)[:60] for u in (req.get("users") or [])][:100],
        "min_level": max(int(req.get("min_level") or 0), 0),
        "fire_power_min": max(int(req.get("fire_power_min") or 0), 0),
        "beta_list": [str(u)[:60] for u in (req.get("beta_list") or [])][:200],
    }, "updated_at": _iso()}


def release_allows(game: dict, user: dict, *, is_founder: bool = False) -> bool:
    rel = game.get("release")
    if not rel:
        return True  # legacy games — unrestricted (backward compatible)
    if is_founder:
        return True
    mode = rel.get("mode") or "launch"
    req = rel.get("requirements") or {}
    if mode == "launch":
        pass
    elif mode in ("founder_only", "maintenance", "archive"):
        return False
    elif mode == "beta":
        ids = set(req.get("beta_list") or [])
        if user.get("id") not in ids and user.get("username") not in ids:
            return False
    elif mode == "custom":
        ids = set(req.get("users") or [])
        badges = set(req.get("badges") or [])
        user_badges = set(user.get("badges") or [])
        if ids and user.get("id") not in ids and user.get("username") not in ids:
            return False
        if badges and not (badges & user_badges):
            return False
    if req.get("min_level") and int(user.get("level") or 0) < req["min_level"]:
        return False
    return True
