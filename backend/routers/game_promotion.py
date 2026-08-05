"""Founder-only preview→production game promotion controls."""
import json
from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import game_promotion as gp

router = APIRouter(prefix="/api/admin/games/promotion", tags=["game-promotion"])


@router.get("/status")
async def status(current: CurrentUser):
    require_founder(current)
    seeds = {f.stem for f in gp.SEED_DIR.glob("*.json")} if gp.SEED_DIR.is_dir() else set()
    rows = await db.games.find({"status": "published"},
                               {"_id": 0, "id": 1, "title": 1, "runtime": 1, "published_at": 1}) \
        .sort("published_at", -1).to_list(100)
    for r in rows:
        r["seed_bundle"] = r["id"] in seeds
        r["internal_test"] = (r.get("title") or "").startswith("RTTEST")
    hist = await db.game_promotions.count_documents({})
    return {"published_games": rows, "seed_dir": str(gp.SEED_DIR),
            "history_count": hist, "env_db": gp.os.environ.get("DB_NAME", "")}


@router.post("/seed")
async def write_seeds(current: CurrentUser, body: dict):
    """Write promotion bundles into the repo so the NEXT DEPLOY carries them to production."""
    require_founder(current)
    ids = body.get("game_ids") or []
    flt = {"status": "published"}
    if ids:
        flt["id"] = {"$in": ids}
    gp.SEED_DIR.mkdir(exist_ok=True)
    written, skipped = [], []
    async for g in db.games.find(flt):
        title = g.get("title") or ""
        if title.startswith("RTTEST") and not ids:
            skipped.append({"id": g["id"], "title": title, "reason": "internal test record"})
            continue
        bundle = await gp.build_bundle(g)
        if bundle["missing_assets"]:
            skipped.append({"id": g["id"], "title": title,
                            "reason": f"broken assets: {bundle['missing_assets']}"})
            continue
        (gp.SEED_DIR / f"{g['id']}.json").write_text(json.dumps(bundle, default=str))
        written.append({"id": g["id"], "title": title})
        await gp._audit("seed_written", g["id"], title, current.get("username", "founder"))
    return {"written": written, "skipped": skipped}


@router.get("/export/{gid}")
async def export_bundle(gid: str, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": gid})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    if g.get("status") != "published":
        raise HTTPException(status_code=400, detail="Only published games can be promoted")
    return {"bundle": await gp.build_bundle(g)}


@router.post("/import")
async def import_bundle(current: CurrentUser, body: dict):
    require_founder(current)
    bundle = body.get("bundle") or body
    r = await gp.import_bundle(bundle, actor=current.get("username", "founder"),
                               force=bool(body.get("force")))
    return r


@router.post("/unpublish/{gid}")
async def unpublish(gid: str, current: CurrentUser):
    require_founder(current)
    g = await db.games.find_one({"id": gid}, {"title": 1})
    if not g:
        raise HTTPException(status_code=404, detail="Game not found")
    await db.games.update_one({"id": gid}, {"$set": {"status": "approved"}})
    await gp._audit("unpublished", gid, g.get("title", ""), current.get("username", "founder"))
    return {"ok": True, "status": "approved"}


@router.get("/verify/{gid}")
async def verify(gid: str, current: CurrentUser):
    require_founder(current)
    return await gp.verify_game(gid)


@router.get("/history")
async def history(current: CurrentUser):
    require_founder(current)
    rows = await db.game_promotions.find({}, {"_id": 0}).sort("at", -1).to_list(60)
    return {"history": rows}
