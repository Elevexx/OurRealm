"""Preview → Production game promotion.

Root cause this solves: preview and production run SEPARATE MongoDB databases;
deployments ship code only, so games published in preview never reach the
production `games` collection. Promotion bundles are portable JSON files that
ship inside the repo (backend/seed_bundles/) and are idempotently imported at
startup on whichever environment boots them. Media itself lives in shared R2
storage, so only DB records need promoting.
"""
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from core.db import db

log = logging.getLogger("ourrealm")
SEED_DIR = Path(__file__).resolve().parent.parent / "seed_bundles"
SCHEMA = 1


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def _audit(action: str, gid: str, title: str, actor: str, detail: str = ""):
    await db.game_promotions.insert_one({
        "action": action, "game_id": gid, "title": title, "actor": actor,
        "detail": detail, "env_db": os.environ.get("DB_NAME", ""), "at": _iso()})


async def build_bundle(game: dict) -> dict:
    """Portable bundle: game doc + the orai_assets records its spec references."""
    g = {k: v for k, v in game.items() if k != "_id"}
    asset_records, missing = [], []
    fnames = set()
    for slot in (g.get("spec", {}).get("assets") or {}).values():
        url = (slot or {}).get("url") or ""
        if url.startswith("/api/public/game-assets/"):
            fnames.add(url.rsplit("/", 1)[-1])
    for fn in sorted(fnames):
        rec = await db.orai_assets.find_one({"file_name": fn}, {"_id": 0})
        if rec:
            asset_records.append(rec)
        else:
            missing.append(fn)
    # make sure every referenced file actually exists in shared storage
    try:
        from services.storage_adapter import get_storage_adapter
        ad = get_storage_adapter()
        for fn in sorted(fnames):
            if not ad.exists("images", fn):
                local = Path("/data/ourrealm/images") / fn
                if local.exists():
                    ad.put("images", fn, local)
                else:
                    missing.append(fn + " (file absent)")
    except Exception as e:
        log.warning(f"[promotion] storage check skipped: {e}")
    return {"schema": SCHEMA, "exported_at": _iso(),
            "source_db": os.environ.get("DB_NAME", ""),
            "game": g, "asset_records": asset_records,
            "missing_assets": missing}


async def import_bundle(bundle: dict, actor: str = "startup", force: bool = False) -> dict:
    g = bundle.get("game") or {}
    gid, title = g.get("id"), g.get("title", "")
    if not gid or g.get("status") != "published":
        return {"action": "rejected", "reason": "not a published game bundle", "game_id": gid}
    existing = await db.games.find_one({"id": gid})
    if existing:
        if not force:
            return {"action": "skipped", "reason": "already present", "game_id": gid}
        newer = (existing.get("updated_at") or existing.get("published_at") or "")
        if newer and newer > (bundle.get("exported_at") or ""):
            await _audit("skip_newer", gid, title, actor, f"production updated_at {newer}")
            return {"action": "skipped", "reason": "production record is newer", "game_id": gid}
        bak = {k: v for k, v in existing.items() if k != "_id"}
        await db.game_promotion_backups.insert_one({"game_id": gid, "backup": bak, "at": _iso(), "actor": actor})
        g["plays"] = existing.get("plays", g.get("plays", 0))  # keep prod counters
        await db.games.replace_one({"id": gid}, g)
        action = "replaced"
    else:
        await db.games.insert_one(dict(g))
        action = "imported"
    n_assets = 0
    for rec in bundle.get("asset_records") or []:
        r = await db.orai_assets.update_one(
            {"file_name": rec.get("file_name")}, {"$setOnInsert": rec}, upsert=True)
        if r.upserted_id:
            n_assets += 1
    await _audit(action, gid, title, actor, f"assets_added={n_assets}")
    return {"action": action, "game_id": gid, "title": title, "assets_added": n_assets}


async def startup_import():
    """Idempotent boot-time import of repo-shipped bundles (never overwrites)."""
    if not SEED_DIR.is_dir():
        return
    results = []
    for f in sorted(SEED_DIR.glob("*.json")):
        try:
            bundle = json.loads(f.read_text())
            r = await import_bundle(bundle, actor="startup-seed", force=False)
            results.append((f.name, r["action"]))
        except Exception as e:
            log.error(f"[promotion] seed {f.name} failed: {e}")
    imported = [n for n, a in results if a == "imported"]
    if imported:
        log.info(f"[promotion] seeded games into this environment: {imported}")
    log.info(f"[promotion] startup seed pass done: {len(results)} bundles, {len(imported)} imported")


async def verify_game(gid: str) -> dict:
    """Environment-local verification: record + status + every asset reachable."""
    g = await db.games.find_one({"id": gid}, {"_id": 0})
    if not g:
        return {"ok": False, "reason": "game not in this environment's database"}
    checks = {"status_published": g.get("status") == "published",
              "has_stages": bool((g.get("spec") or {}).get("stages")),
              "cover": bool(g.get("cover_url"))}
    broken = []
    try:
        from services.storage_adapter import get_storage_adapter
        ad = get_storage_adapter()
        for key, slot in ((g.get("spec") or {}).get("assets") or {}).items():
            url = (slot or {}).get("url") or ""
            if url.startswith("/api/public/game-assets/"):
                fn = url.rsplit("/", 1)[-1]
                has_rec = await db.orai_assets.count_documents({"file_name": fn}) > 0
                in_store = ad.exists("images", fn)
                if not (has_rec and in_store):
                    broken.append({"slot": key, "file": fn, "db_record": has_rec, "in_storage": in_store})
    except Exception as e:
        broken.append({"error": str(e)})
    checks["assets_ok"] = not broken
    return {"ok": all(checks.values()), "checks": checks, "broken_assets": broken,
            "env_db": os.environ.get("DB_NAME", "")}
