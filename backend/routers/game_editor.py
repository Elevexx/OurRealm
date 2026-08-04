"""Universal Game Editor + Remix + Release Modes — founder-only routes.
Editing never regenerates; remixing never mutates the original."""
from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import game_editor as ge
from services.orai_projects import audit

router = APIRouter(prefix="/api/orai/projects", tags=["game-editor"])


async def _game(game_id: str) -> dict:
    g = await db.games.find_one({"id": game_id})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    return g


@router.get("/editor/{game_id}")
async def editor_view(game_id: str, current: CurrentUser):
    require_founder(current)
    return {"editor": ge.editable_view(await _game(game_id))}


@router.patch("/editor/{game_id}")
async def editor_patch(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await _game(game_id)
    res = await ge.apply_patch(g, body.get("patch") or {}, current)
    if res["updated"]:
        await audit(current, "game_edited_no_regen", game_id, ", ".join(res["fields"])[:180])
    return {**res, "editor": ge.editable_view(await _game(game_id))}


@router.get("/editor/{game_id}/versions")
async def editor_versions(game_id: str, current: CurrentUser):
    require_founder(current)
    await _game(game_id)
    rows = await db.game_edit_versions.find(
        {"game_id": game_id}, {"_id": 0, "snapshot": 0}).sort("version", -1).to_list(20)
    return {"versions": rows}


@router.post("/editor/{game_id}/rollback")
async def editor_rollback(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    g = await _game(game_id)
    try:
        ver = body.get("version")
        res = await ge.rollback(g, int(ver if ver is not None else -1), current)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    await audit(current, "game_rolled_back", game_id, f"v{body.get('version')}")
    return {**res, "editor": ge.editable_view(await _game(game_id))}


@router.post("/remix/{game_id}")
async def remix(game_id: str, body: dict, current: CurrentUser):
    """Remix This Game — clone/sequel/theme/art/mechanic/difficulty/holiday.
    The original game is NEVER modified."""
    require_founder(current)
    g = await _game(game_id)
    try:
        doc = await ge.remix_game(g, str(body.get("remix_type") or "clone"), current, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await audit(current, "game_remixed", doc["id"], f"{body.get('remix_type')} of {game_id}")
    return {"remix": {k: doc[k] for k in ("id", "title", "remix_of", "remix_type",
                                          "status", "release", "privacy")},
            "original_modified": False}


@router.get("/release/modes")
async def release_modes(current: CurrentUser):
    require_founder(current)
    return {"modes": ge.RELEASE_MODES, "remix_types": ge.REMIX_TYPES}


@router.patch("/release/{game_id}")
async def set_release(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    await _game(game_id)
    cfg = ge.normalize_release(body or {})
    await db.games.update_one({"id": game_id}, {"$set": {"release": cfg}})
    await audit(current, "game_release_mode_set", game_id, cfg["mode"])
    return {"release": cfg}
